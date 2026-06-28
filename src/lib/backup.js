// src/lib/backup.js
//
// Automated database backup system. Runs daily via a node-cron schedule
// mounted in worker.js (the long-running background process). Backs up the
// full PostgreSQL database to Cloudinary (already integrated for image
// storage) and optionally to other S-compatible storage in the future.
//
// Backup strategy:
//   - Daily: full pg_dump (custom format, gzipped), uploaded to Cloudinary
//   - Retention: 30 days (configurable via BACKUP_RETENTION_DAYS env var)
//   - On the 1st of each month: the daily backup is also flagged as a
//     monthly snapshot — pruneOldBackups() skips rows where
//     is_monthly_snapshot = true, so we always keep ~12 monthly snapshots
//     for long-term point-in-time recovery.
//   - Restoration: POST /api/admin/backups/:id/restore (super-admin only)
//
// Security:
//   - The DATABASE_URL is parsed and the password is passed to pg_dump via
//     the PGPASSWORD env var, NOT as a --password flag (which would expose
//     it in `ps aux` and in shell history).
//   - --no-owner --no-privileges on dump and restore makes the backup
//     portable across DB users (the restore user does not need to be the
//     same as the dump user, and we don't try to SET ROLE to a user that
//     may not exist on the restore target).
//   - --clean --if-exists on both ends makes restore idempotent: every
//     existing object is DROP IF EXISTS'd before CREATE, so the restore
//     can be re-run after a partial failure without manual cleanup.
//
// Constraints (see worklog Gap 4 entry):
//   - This module requires the `pg_dump` and `pg_restore` PostgreSQL client
//     binaries on $PATH. Render web services do NOT ship these by default;
//     a Render Background Worker (separate service type) or a custom Docker
//     image with postgresql-client installed is required for production use.
//     On self-hosted deployments (Docker, VPS, on-prem), the operator just
//     needs to `apt install postgresql-client` (or equivalent) on the host
//     running worker.js.

'use strict';

const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const crypto = require('crypto');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');

const RETENTION_DAYS = parseInt(process.env.BACKUP_RETENTION_DAYS || '30', 10);

// Cloudinary public_id prefix used for all backup blobs. Kept in sync with
// uploadBackup() (which uploads with this prefix) and pruneOldBackups()
// (which destroys with this prefix). Changing this string breaks lookup of
// existing backups uploaded under the old prefix.
const CLOUDINARY_BACKUP_FOLDER = 'ssewasswa-backups';

/**
 * Run a full database backup.
 *
 * Steps:
 *   1. Parse DATABASE_URL into host/port/user/password/dbname so we can
 *      invoke pg_dump with explicit --host/--port/--username/--dbname args
 *      (avoids leaking the password via the process list or shell history).
 *   2. pg_dump --format=custom, piped through gzip, written to a temp file.
 *   3. Compute the file size and SHA-256 checksum (integrity verification
 *      on restore — the restore route can re-hash the downloaded file and
 *      compare against the stored checksum before running pg_restore).
 *   4. Insert a row into the `backups` table with status='local'. The
 *      caller (worker.js or the admin route) updates this row to
 *      status='uploaded' after uploadBackup() succeeds.
 *
 * @param {import('pg').Pool} pool - PostgreSQL connection pool (used to record metadata)
 * @returns {Promise<{ backupId: string, filename: string, sizeBytes: number, checksum: string, localPath: string }>}
 * @throws {Error} if DATABASE_URL is not set, if the URL cannot be parsed,
 *                 or if pg_dump exits non-zero.
 */
async function runBackup(pool) {
  const backupId = `backup-${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(4).toString('hex')}`;
  const filename = `${backupId}.sql.gz`;
  const localPath = path.join(os.tmpdir(), filename);

  console.log(`[Backup] Starting backup ${backupId}`);

  // Get DATABASE_URL from env (the pool doesn't expose it directly)
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error('DATABASE_URL not set');

  // Parse the connection string to extract connection params.
  // pg_dump needs them as separate args, not a URL, so the password can
  // be passed via PGPASSWORD env var (NOT as a --password flag, which
  // would expose it in `ps aux`).
  const url = new URL(dbUrl);
  const dbHost = url.hostname;
  const dbPort = url.port || '5432';
  const dbName = url.pathname.substring(1);
  const dbUser = url.username;
  const dbPassword = decodeURIComponent(url.password || '');

  const env = { ...process.env, PGPASSWORD: dbPassword };

  // pg_dump custom format is already internally compressed; piping through
  // gzip adds another layer (cheap CPU, modest size reduction). The double
  // compression is fine because pg_restore reads the gunzipped stream from
  // stdin on restore (see restoreBackup).
  //
  // --no-owner --no-privileges: makes the backup portable across DB users
  // --clean --if-exists: makes restore idempotent (DROP IF EXISTS before CREATE)
  const pgDumpCmd = `pg_dump --host=${dbHost} --port=${dbPort} --username=${dbUser} --no-owner --no-privileges --clean --if-exists --format=custom ${dbName} | gzip > ${localPath}`;

  try {
    await execAsync(pgDumpCmd, { env, maxBuffer: 100 * 1024 * 1024 }); // 100MB stdout buffer
  } catch (e) {
    console.error('[Backup] pg_dump failed:', e.message);
    // Clean up the partial file so a later prune doesn't see a zero-byte
    // orphan that looks like a real backup.
    try { await fs.unlink(localPath); } catch (_) { /* ignore */ }
    throw new Error(`pg_dump failed: ${e.message}`);
  }

  // Get file size and SHA-256 checksum. We read the whole file into memory
  // to hash it — backups are typically a few MB to a few hundred MB, which
  // is fine on a 384MB Render container. If backups ever exceed ~500MB,
  // switch to a streaming hash (crypto.createHash + fs.createReadStream).
  const stats = await fs.stat(localPath);
  const sizeBytes = stats.size;
  const fileBuffer = await fs.readFile(localPath);
  const checksum = crypto.createHash('sha256').update(fileBuffer).digest('hex');

  console.log(
    `[Backup] Backup ${backupId} complete: ${sizeBytes} bytes, sha256=${checksum.substring(0, 16)}...`
  );

  // Record in backups table. Try INSERT first; if the table doesn't exist
  // yet (first run on a fresh deploy before migrations have run), create
  // it and retry. This is a defensive fallback — the canonical table
  // creation lives in migrations/000005_backups.js.
  try {
    await pool.query(
      `INSERT INTO backups (backup_id, filename, size_bytes, checksum, status, created_at)
       VALUES ($1, $2, $3, $4, 'local', NOW())
       ON CONFLICT (backup_id) DO NOTHING`,
      [backupId, filename, sizeBytes, checksum]
    );
  } catch (e) {
    console.warn('[Backup] backups table missing, creating it:', e.message);
    await ensureBackupsTable(pool);
    await pool.query(
      `INSERT INTO backups (backup_id, filename, size_bytes, checksum, status, created_at)
       VALUES ($1, $2, $3, $4, 'local', NOW())
       ON CONFLICT (backup_id) DO NOTHING`,
      [backupId, filename, sizeBytes, checksum]
    );
  }

  return { backupId, filename, sizeBytes, checksum, localPath };
}

/**
 * Upload a backup to Cloudinary (or fall back to local-only).
 *
 * Cloudinary is already configured for image storage (server.js uses
 * CLOUDINARY_URL). We reuse the same account but upload with
 * resource_type='raw' (not 'image') so Cloudinary doesn't try to transform
 * the binary .sql.gz file. The public_id is `ssewasswa-backups/<backupId>`
 * so the prune step can find and delete old blobs by ID.
 *
 * @param {string} localPath - path to the local backup file
 * @param {string} backupId  - backup ID for naming in cloud storage
 * @returns {Promise<{ url: string|null, provider: string }>}
 *          - url: the secure_url returned by the cloud provider, or null
 *                 if no cloud provider is configured (backup remains local).
 *          - provider: 'cloudinary' | 'local'
 */
async function uploadBackup(localPath, backupId) {
  // Try Cloudinary first (already integrated for image uploads)
  try {
    const cloudinary = require('cloudinary').v2;
    // Match the config pattern used by server.js (lines 1843-1845, 9362-9364,
    // 15969-15971): prefer CLOUDINARY_URL; fall back to separate env vars.
    if (process.env.CLOUDINARY_URL) {
      cloudinary.config({ url: process.env.CLOUDINARY_URL });
    } else if (
      process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET
    ) {
      cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET,
      });
    } else {
      // No Cloudinary credentials configured — fall through to local-only.
      throw new Error('CLOUDINARY_URL (or CLOUDINARY_CLOUD_NAME+API_KEY+API_SECRET) not set');
    }

    const result = await cloudinary.uploader.upload(localPath, {
      resource_type: 'raw',  // non-image file (Cloudinary would otherwise try to parse it as an image)
      folder: CLOUDINARY_BACKUP_FOLDER,
      public_id: backupId,  // full public_id becomes `${CLOUDINARY_BACKUP_FOLDER}/${backupId}`
    });
    console.log(`[Backup] Uploaded to Cloudinary: ${result.secure_url}`);
    return { url: result.secure_url, provider: 'cloudinary' };
  } catch (e) {
    console.warn('[Backup] Cloudinary upload failed:', e.message);
  }

  // TODO: S3-compatible fallback (would need @aws-sdk/client-s3 installed).
  // For now, backups remain local-only when Cloudinary is not configured.
  // Local-only backups are lost if the worker container restarts (Render's
  // filesystem is ephemeral) — operators should configure Cloudinary for
  // any production deployment.
  console.warn(
    '[Backup] No cloud storage provider configured. Backup remains local only ' +
    '(WARNING: local files are ephemeral on Render — set CLOUDINARY_URL).'
  );
  return { url: null, provider: 'local' };
}

/**
 * Restore a backup.
 *
 * Runs `gunzip -c <file> | pg_restore --clean --if-exists --no-owner ...`.
 * The restore is destructive: every existing object in the target database
 * is dropped and recreated from the backup. Callers MUST ensure no other
 * connections are writing to the DB during restore.
 *
 * @param {import('pg').Pool} pool
 * @param {string} backupId   - backup ID being restored (for the audit row update)
 * @param {string} localPath  - path to the local .sql.gz backup file
 * @throws {Error} if DATABASE_URL is not set or pg_restore exits non-zero.
 */
async function restoreBackup(pool, backupId, localPath) {
  console.log(`[Backup] Starting restore from ${backupId}`);
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error('DATABASE_URL not set');
  const url = new URL(dbUrl);
  const env = { ...process.env, PGPASSWORD: decodeURIComponent(url.password || '') };

  // Restore with pg_restore (custom format, un-gzipped on the fly).
  // --clean --if-exists: drop existing objects before recreating (idempotent restore)
  // --no-owner --no-privileges: don't try to set ownership (we may not have permission)
  const restoreCmd =
    `gunzip -c ${localPath} | pg_restore` +
    ` --host=${url.hostname}` +
    ` --port=${url.port || '5432'}` +
    ` --username=${url.username}` +
    ` --no-owner --no-privileges --clean --if-exists` +
    ` --dbname=${url.pathname.substring(1)}`;

  try {
    await execAsync(restoreCmd, { env, maxBuffer: 100 * 1024 * 1024 });
    console.log(`[Backup] Restore from ${backupId} complete`);
    await pool.query(
      'UPDATE backups SET restored_at = NOW() WHERE backup_id = $1',
      [backupId]
    );
  } catch (e) {
    // pg_restore often exits non-zero even on a successful restore because
    // it complains about pre-existing objects that --clean already dropped.
    // We log the error but re-throw so the caller can decide whether to
    // treat it as fatal. The `restored_at` timestamp is only set on a
    // clean exit, which is the conservative choice.
    console.error('[Backup] Restore failed:', e.message);
    throw new Error(`pg_restore failed: ${e.message}`);
  }
}

/**
 * Delete backups older than the retention period.
 *
 * Skips rows where is_monthly_snapshot = true (those are kept for long-term
 * point-in-time recovery). For each pruned backup:
 *   1. Delete the blob from Cloudinary (if it was uploaded there).
 *   2. Delete the local file (if it still exists in os.tmpdir()).
 *   3. Delete the row from the `backups` table.
 *
 * @param {import('pg').Pool} pool
 * @param {number} [retentionDays=RETENTION_DAYS] - delete backups older than this many days
 */
async function pruneOldBackups(pool, retentionDays = RETENTION_DAYS) {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  console.log(`[Backup] Pruning backups older than ${cutoff.toISOString()} (retention=${retentionDays}d)`);

  // Note the `is_monthly_snapshot = false` filter — monthly snapshots are
  // kept indefinitely (or until a separate monthly-retention sweep deletes
  // them, which we don't implement here). This gives us 30 dailies + ~12
  // monthlies on a running system.
  const oldBackups = await pool.query(
    'SELECT backup_id, filename, url, provider FROM backups WHERE created_at < $1 AND is_monthly_snapshot = false',
    [cutoff]
  );

  let pruned = 0;
  for (const backup of oldBackups.rows) {
    // Delete from cloud storage if applicable
    if (backup.provider === 'cloudinary' || (backup.url && backup.url.includes('cloudinary'))) {
      try {
        const cloudinary = require('cloudinary').v2;
        if (process.env.CLOUDINARY_URL) {
          cloudinary.config({ url: process.env.CLOUDINARY_URL });
        }
        const publicId = `${CLOUDINARY_BACKUP_FOLDER}/${backup.backup_id}`;
        await cloudinary.uploader.destroy(publicId, { resource_type: 'raw' });
      } catch (e) {
        // Log but continue — the blob may have already been deleted manually,
        // or Cloudinary may be temporarily unavailable. Either way we still
        // want to delete the DB row so the dashboard doesn't show a stale
        // "uploaded" entry.
        console.warn(
          `[Backup] Could not delete ${backup.backup_id} from Cloudinary:`,
          e.message
        );
      }
    }
    // Delete from local disk (if it exists). Render's tmpdir is ephemeral
    // so this is usually a no-op on production, but it matters for local dev.
    const localPath = path.join(os.tmpdir(), backup.filename);
    try { await fs.unlink(localPath); } catch (e) { /* file may not exist */ }

    // Delete from DB
    await pool.query('DELETE FROM backups WHERE backup_id = $1', [backup.backup_id]);
    console.log(`[Backup] Pruned ${backup.backup_id}`);
    pruned++;
  }

  console.log(`[Backup] Pruned ${pruned} old backup(s) (of ${oldBackups.rows.length} eligible)`);
  return pruned;
}

/**
 * Create the `backups` table if it doesn't already exist.
 *
 * This is a defensive fallback used by runBackup() on the first run after
 * deploy, before migrations have run. The canonical schema lives in
 * migrations/000005_backups.js — both definitions are kept in sync.
 *
 * @param {import('pg').Pool} pool
 */
async function ensureBackupsTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS backups (
      id BIGSERIAL PRIMARY KEY,
      backup_id VARCHAR(100) NOT NULL UNIQUE,
      filename TEXT NOT NULL,
      size_bytes BIGINT NOT NULL,
      checksum VARCHAR(64) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'local',
      url TEXT,
      provider VARCHAR(20),
      is_monthly_snapshot BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      restored_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_backups_created ON backups(created_at DESC);
  `);
}

module.exports = {
  runBackup,
  uploadBackup,
  restoreBackup,
  pruneOldBackups,
  ensureBackupsTable,
  RETENTION_DAYS,
  CLOUDINARY_BACKUP_FOLDER,
};
