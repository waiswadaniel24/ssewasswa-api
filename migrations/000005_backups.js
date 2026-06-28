/**
 * Migration 000005 — Automated daily database backups (Gap 4)
 *
 * Adds the `backups` table used by src/lib/backup.js and the
 * /api/admin/backups/* routes (src/routes/admin-backups.js).
 *
 * One row per backup attempt:
 *   - backup_id (UNIQUE)      "backup-<ISO date>-<8 hex>" — used as the
 *                             Cloudinary public_id and as the URL slug for
 *                             the restore/download admin endpoints.
 *   - filename                Local filename (e.g. "backup-2026-07-04T02-00-00-abc123.sql.gz").
 *                             The file lives in os.tmpdir() during the
 *                             backup window; after upload, only the cloud
 *                             URL is authoritative.
 *   - size_bytes              Compressed size on disk / in cloud storage.
 *   - checksum                SHA-256 of the backup file. Verified on
 *                             restore to detect bit-rot in cloud storage.
 *   - status                  'local' (just dumped) → 'uploaded' (after
 *                             uploadBackup() succeeds) → 'restored' (after
 *                             restoreBackup() succeeds, tracked via
 *                             restored_at timestamp).
 *   - url                     Cloudinary secure_url (or null for local-only).
 *   - provider                'cloudinary' | 'local' | (future: 's3')
 *   - is_monthly_snapshot     TRUE for the daily backup taken on the 1st
 *                             of each month. pruneOldBackups() skips these
 *                             so we keep ~12 monthly snapshots for long-term
 *                             point-in-time recovery, on top of 30 dailies.
 *   - created_at              When pg_dump finished.
 *   - restored_at             When this backup was last restored (NULL = never).
 *
 * Pattern: uses pgm.sql() with `IF NOT EXISTS` clauses, matching the
 * convention from migrations/000001, 000002, 000003, 000008. Each
 * statement is idempotent so re-running the migration (e.g. after a
 * deploy rollback) is safe.
 *
 * Down: drops the table. Backup metadata is lost but the actual backup
 * blobs in Cloudinary are NOT deleted by this migration — operators must
 * manually purge the `ssewasswa-backups/` Cloudinary folder if they want
 * the blobs gone. This matches the conservative "don't delete data on
 * rollback" pattern from migration 000008.
 */

module.exports = {
  up: (pgm) => {
    pgm.sql(`
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
    `);
    // Most common query: "list recent backups" (admin dashboard).
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_backups_created ON backups(created_at DESC)`);
  },
  down: (pgm) => {
    // Drop the table only — Cloudinary blobs under ssewasswa-backups/ are
    // left in place. See module header for the rationale.
    pgm.sql(`DROP TABLE IF EXISTS backups`);
  },
};
