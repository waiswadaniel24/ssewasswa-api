// src/routes/admin-backups.js
//
// Admin-only HTTP routes for managing automated database backups.
//
// Mount point in server.js:
//   app.use('/api/admin/backups', require('./src/routes/admin-backups')(_routeSharedCtx));
//
// All routes require an authenticated super-admin session (see requireSuperAdmin
// in server.js — checks req.session.user.role === 'super_admin'). The backup
// metadata is stored in the `backups` table (migration 000005); the backup
// blobs live in Cloudinary under the `ssewasswa-backups/` folder (or in
// os.tmpdir() when Cloudinary is not configured).
//
// Routes:
//   GET    /api/admin/backups               — list recent backups (100 most recent)
//   POST   /api/admin/backups/run           — manually trigger a backup
//   POST   /api/admin/backups/prune         — manually prune old backups
//   POST   /api/admin/backups/:id/restore   — restore from a backup
//   GET    /api/admin/backups/:id/download  — download a backup file
//
// Audit: every action calls audit() (server.js:1299) with the actor's email,
// the action name, and a JSON details payload — so backup/restore events
// show up in the existing audit_logs table alongside user logins, settings
// changes, etc.

'use strict';

module.exports = function createAdminBackupsRouter(ctx) {
  const express = require('express');
  const router = express.Router();
  const path = require('path');
  const os = require('os');
  const fs = require('fs').promises;

  const {
    pool,
    ah,
    requireAuth,
    requireSuperAdmin,
    audit,
  } = ctx;

  // All routes in this router require a super-admin session. Using
  // router.use() with two middlewares matches the pattern from
  // src/routes/clinic-hipaa.js (requireAuth + requireNotBanned).
  router.use(requireAuth, requireSuperAdmin);

  // -----------------------------------------------------------------------
  // GET /api/admin/backups — list recent backups
  // -----------------------------------------------------------------------
  router.get('/', ah(async (req, res) => {
    // LIMIT 100 — the admin UI paginates anyway, and a larger result would
    // be slow on a backups table with thousands of rows.
    const result = await pool.query(
      'SELECT * FROM backups ORDER BY created_at DESC LIMIT 100'
    );
    res.json({ backups: result.rows });
  }));

  // -----------------------------------------------------------------------
  // POST /api/admin/backups/run — manually trigger a backup
  // -----------------------------------------------------------------------
  // Body: (none)
  // Response: { backupId, sizeBytes, url, provider }
  //
  // This is the same flow that worker.js runs daily at 2 AM UTC, exposed
  // as a manual trigger so an operator can take an ad-hoc snapshot before
  // a risky migration or schema change.
  router.post('/run', ah(async (req, res) => {
    const { runBackup, uploadBackup } = require('../lib/backup');

    const { backupId, localPath, sizeBytes, checksum } = await runBackup(pool);
    const { url, provider } = await uploadBackup(localPath, backupId);

    // Update the row created by runBackup() with the cloud URL + provider.
    // status flips to 'uploaded' (or stays 'local' if no cloud provider).
    await pool.query(
      'UPDATE backups SET url = $1, provider = $2, status = $3 WHERE backup_id = $4',
      [url, provider, provider === 'local' ? 'local' : 'uploaded', backupId]
    );

    // audit() signature: (email, action, details, tenantId, req)
    if (typeof audit === 'function') {
      audit(req.session?.user?.email, 'backup_run_manual', { backupId, sizeBytes, checksum }, null, req);
    }

    res.json({ backupId, sizeBytes, url, provider });
  }));

  // -----------------------------------------------------------------------
  // POST /api/admin/backups/prune — manually prune old backups
  // -----------------------------------------------------------------------
  // Body: { retention_days?: number }  (optional; defaults to BACKUP_RETENTION_DAYS env var)
  // Response: { message, pruned }
  router.post('/prune', ah(async (req, res) => {
    const { pruneOldBackups } = require('../lib/backup');
    const body = req.body || {};
    const retentionDays = body.retention_days
      ? parseInt(body.retention_days, 10)
      : undefined;

    const pruned = await pruneOldBackups(pool, retentionDays);

    if (typeof audit === 'function') {
      audit(req.session?.user?.email, 'backup_prune_manual', { retentionDays, pruned }, null, req);
    }

    res.json({ message: 'Pruning complete', pruned });
  }));

  // -----------------------------------------------------------------------
  // POST /api/admin/backups/:id/restore — restore from a backup
  // -----------------------------------------------------------------------
  // Body: (none)
  // Response: { message, backupId }
  //
  // DESTRUCTIVE: drops and recreates every object in the target database.
  // The route does NOT prompt for confirmation — that's the UI's job.
  //
  // Currently requires the backup file to be available locally (in os.tmpdir()).
  // For backups that exist only in Cloudinary, the operator must download
  // them first via GET /:id/download and place them in os.tmpdir() with the
  // original filename. A future enhancement would auto-download from
  // Cloudinary when the local file is missing.
  router.post('/:id/restore', ah(async (req, res) => {
    const { restoreBackup } = require('../lib/backup');
    const backupId = req.params.id;

    const result = await pool.query(
      'SELECT * FROM backups WHERE backup_id = $1',
      [backupId]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Backup not found' });
    }
    const backup = result.rows[0];

    const localPath = path.join(os.tmpdir(), backup.filename);
    try {
      await fs.access(localPath);
    } catch (e) {
      return res.status(400).json({
        error: 'Backup file not available locally. Download from cloud storage first via GET /api/admin/backups/:id/download.',
        url: backup.url,
      });
    }

    if (typeof audit === 'function') {
      audit(req.session?.user?.email, 'backup_restore_start', { backupId }, null, req);
    }

    await restoreBackup(pool, backupId, localPath);
    res.json({ message: 'Restore complete', backupId });
  }));

  // -----------------------------------------------------------------------
  // GET /api/admin/backups/:id/download — download a backup file
  // -----------------------------------------------------------------------
  // If the backup has a cloud URL, redirects to it (Cloudinary's signed URL
  // is the canonical source — the local tmpdir copy is transient). Otherwise
  // streams the local file as an attachment.
  router.get('/:id/download', ah(async (req, res) => {
    const backupId = req.params.id;
    const result = await pool.query(
      'SELECT * FROM backups WHERE backup_id = $1',
      [backupId]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Backup not found' });
    }
    const backup = result.rows[0];

    if (backup.url) {
      // Redirect to cloud storage — Cloudinary's secure_url is HTTPS and
      // signed (if signed URLs are configured). The browser will download
      // the file directly from Cloudinary's CDN, bypassing our bandwidth.
      return res.redirect(backup.url);
    }

    const localPath = path.join(os.tmpdir(), backup.filename);
    try {
      await fs.access(localPath);
      res.download(localPath, backup.filename);
    } catch (e) {
      res.status(404).json({ error: 'Backup file not found locally and no cloud URL is recorded' });
    }
  }));

  return router;
};
