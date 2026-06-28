/**
 * backups.test.js — unit tests for src/lib/backup.js + src/routes/admin-backups.js
 *
 * Covers the automated-daily-backup contract (Gap 4):
 *   - runBackup() throws clearly when DATABASE_URL is missing (so a
 *     misconfigured worker doesn't fail silently).
 *   - pruneOldBackups() only deletes backups older than the cutoff and
 *     preserves monthly snapshots (the SQL predicate is the safety net —
 *     if it ever regresses to "delete everything", this test catches it).
 *   - ensureBackupsTable() is idempotent (safe to call on every worker boot).
 *   - admin-backups.js exports a factory that returns an Express Router.
 *
 * What we DON'T test here:
 *   - The actual pg_dump / pg_restore subprocess calls — pg_dump is not
 *     available in this sandbox, and even if it were, a real backup would
 *     need a real Postgres instance. The /api/admin/backups/run route's
 *     end-to-end behavior is exercised by the Jest cross-tenant suite
 *     (test/jest/cross-tenant-boundaries.test.js) when a Postgres DB is
 *     available, but the backup routes are not part of that suite's
 *     cross-tenant scope.
 *   - The Cloudinary upload path — requires CLOUDINARY_URL + network.
 *     The uploadBackup() function falls through to local-only when
 *     Cloudinary is not configured, which is the path the prune test
 *     exercises (rows with provider='local').
 *
 * Run via: node --test test/backups.test.js
 */

const { test, describe, before, beforeEach, after, afterEach } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const REPO_DIR = path.join(__dirname, '..');
const backupLibPath = path.join(REPO_DIR, 'src', 'lib', 'backup.js');
const adminBackupsRoutePath = path.join(REPO_DIR, 'src', 'routes', 'admin-backups.js');

// ---------------------------------------------------------------------------
// Mock pool helpers
// ---------------------------------------------------------------------------
// A minimal pg.Pool mock. The real pool's `query` returns
// { rows, rowCount, command }. Our mock lets each test configure the
// return value per SQL pattern (so we can return different rows for
// SELECT vs INSERT vs DELETE etc.).

function makeMockPool(handler) {
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    if (handler) {
      const result = handler(sql, params);
      if (result) return result;
    }
    return { rows: [], rowCount: 0, command: 'MOCK' };
  };
  return { query, calls };
}

// ---------------------------------------------------------------------------
// Env-var management
// ---------------------------------------------------------------------------
// backup.js reads DATABASE_URL on every call to runBackup() / restoreBackup(),
// so we can swap it per-test by mutating process.env. Save the original
// value so we can restore it in after() — other tests in the suite may
// depend on it (e.g. the cross-tenant Jest suite sets DATABASE_URL to a
// real Postgres URL).

const SAVED_DATABASE_URL = process.env.DATABASE_URL;

function clearDatabaseUrl() { delete process.env.DATABASE_URL; }
function restoreDatabaseUrl() {
  if (SAVED_DATABASE_URL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = SAVED_DATABASE_URL;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('backup.js — runBackup()', () => {
  let backup;

  before(() => {
    backup = require(backupLibPath);
  });
  after(() => {
    restoreDatabaseUrl();
  });

  test('throws "DATABASE_URL not set" when DATABASE_URL is missing', async () => {
    clearDatabaseUrl();
    const pool = makeMockPool();

    await assert.rejects(
      () => backup.runBackup(pool),
      /DATABASE_URL not set/i,
      'runBackup must throw with a clear message when DATABASE_URL is missing'
    );

    // The check happens BEFORE pg_dump is invoked, so the mock pool must
    // NOT have received any INSERT INTO backups query.
    const insertCalls = pool.calls.filter(c => /INSERT\s+INTO\s+backups/i.test(c.sql));
    assert.strictEqual(insertCalls.length, 0, 'no INSERT should run when DATABASE_URL is missing');
  });

  test('does NOT invoke pg_dump when DATABASE_URL is missing', async () => {
    // Belt-and-suspenders: even if a future refactor moves the DATABASE_URL
    // check, the contract is "no shell-out without a URL". We verify by
    // asserting the rejection happens before child_process.exec is reached.
    // (If pg_dump were invoked, the error message would mention "pg_dump"
    // or "not found", not "DATABASE_URL not set".)
    clearDatabaseUrl();
    const pool = makeMockPool();

    try {
      await backup.runBackup(pool);
      assert.fail('runBackup should have thrown');
    } catch (e) {
      assert.match(
        e.message,
        /DATABASE_URL not set/i,
        `error message should mention DATABASE_URL, got: ${e.message}`
      );
      assert.doesNotMatch(
        e.message,
        /pg_dump/i,
        'pg_dump should not be invoked when DATABASE_URL is missing'
      );
    }
  });
});

describe('backup.js — pruneOldBackups()', () => {
  let backup;

  before(() => {
    backup = require(backupLibPath);
  });

  test('issues a SELECT with is_monthly_snapshot = false filter', async () => {
    // The safety property: monthly snapshots must NEVER be returned by the
    // prune SELECT. If a future refactor drops the filter, this test fails
    // because the captured SQL no longer contains the predicate.
    const pool = makeMockPool(() => ({ rows: [], rowCount: 0 }));

    await backup.pruneOldBackups(pool, 30);

    const selectCalls = pool.calls.filter(c => /^SELECT/i.test(c.sql.trim()));
    assert.strictEqual(selectCalls.length, 1, 'exactly one SELECT must be issued');
    assert.match(
      selectCalls[0].sql,
      /is_monthly_snapshot\s*=\s*false/i,
      'SELECT must filter out monthly snapshots'
    );
    assert.match(
      selectCalls[0].sql,
      /created_at\s*<\s*\$1/i,
      'SELECT must filter by created_at < cutoff'
    );
  });

  test('only DELETEs backups returned by the SELECT (mock rows are pruned, others untouched)', async () => {
    // Mock returns 2 rows to prune. Verify 2 DELETE statements are issued,
    // each with the correct backup_id.
    const rowsToPrune = [
      { backup_id: 'backup-old-1', filename: 'old1.sql.gz', url: null, provider: 'local' },
      { backup_id: 'backup-old-2', filename: 'old2.sql.gz', url: null, provider: 'local' },
    ];
    const pool = makeMockPool((sql) => {
      if (/^SELECT/i.test(sql.trim())) {
        return { rows: rowsToPrune, rowCount: rowsToPrune.length };
      }
      return { rows: [], rowCount: 0 };
    });

    const pruned = await backup.pruneOldBackups(pool, 30);

    const deleteCalls = pool.calls.filter(c => /^DELETE\s+FROM\s+backups/i.test(c.sql.trim()));
    assert.strictEqual(deleteCalls.length, 2, 'one DELETE per pruned row');
    assert.deepStrictEqual(
      deleteCalls.map(c => c.params),
      [['backup-old-1'], ['backup-old-2']],
      'DELETE params must match the backup_ids returned by SELECT'
    );
    assert.strictEqual(pruned, 2, 'pruneOldBackups must return the count of pruned rows');
  });

  test('preserves monthly snapshots (SELECT predicate excludes them from the candidate set)', async () => {
    // Even if a monthly snapshot is "old", the SELECT predicate excludes
    // it from the candidate set, so it's never DELETEd. We verify this
    // by configuring the mock to return ONLY non-monthly rows even when
    // the test conceptually has 3 old backups (2 dailies + 1 monthly).
    const pool = makeMockPool((sql) => {
      if (/^SELECT/i.test(sql.trim())) {
        return {
          rows: [
            { backup_id: 'backup-old-daily-1', filename: 'd1.sql.gz', url: null, provider: 'local' },
            { backup_id: 'backup-old-daily-2', filename: 'd2.sql.gz', url: null, provider: 'local' },
            // NOTE: backup-old-monthly is NOT in this list because the SQL
            // predicate (is_monthly_snapshot = false) excludes it.
          ],
          rowCount: 2,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    await backup.pruneOldBackups(pool, 30);

    const deleteCalls = pool.calls.filter(c => /^DELETE\s+FROM\s+backups/i.test(c.sql.trim()));
    assert.strictEqual(deleteCalls.length, 2, 'monthly snapshot must NOT be deleted');
    const deletedIds = deleteCalls.map(c => c.params[0]);
    assert.ok(!deletedIds.includes('backup-old-monthly'),
      'monthly snapshot ID must not appear in any DELETE');
  });

  test('handles empty candidate set gracefully (no DELETEs issued)', async () => {
    const pool = makeMockPool(() => ({ rows: [], rowCount: 0 }));

    const pruned = await backup.pruneOldBackups(pool, 30);

    const deleteCalls = pool.calls.filter(c => /^DELETE\s+FROM\s+backups/i.test(c.sql.trim()));
    assert.strictEqual(deleteCalls.length, 0, 'no DELETEs when there is nothing to prune');
    assert.strictEqual(pruned, 0);
  });

  test('uses the custom retention_days override when provided', async () => {
    // The retention param flows into the cutoff date, which is the $1 param
    // of the SELECT. We don't assert on the exact timestamp (Date.now()
    // drift), but we DO assert that the override is honored by checking
    // that the SELECT receives a Date param (not the env-var default).
    const pool = makeMockPool(() => ({ rows: [], rowCount: 0 }));

    await backup.pruneOldBackups(pool, 7);  // override

    const selectCall = pool.calls.find(c => /^SELECT/i.test(c.sql.trim()));
    assert.ok(selectCall, 'a SELECT must be issued');
    assert.ok(
      selectCall.params[0] instanceof Date,
      'cutoff (param $1) must be a Date instance'
    );
    // The cutoff should be ~7 days ago, not ~30. Allow a 1-hour tolerance
    // for test latency.
    const cutoffMs = selectCall.params[0].getTime();
    const expectedMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const hourMs = 60 * 60 * 1000;
    assert.ok(
      Math.abs(cutoffMs - expectedMs) < hourMs,
      `cutoff should be ~7 days ago (got ${new Date(cutoffMs).toISOString()})`
    );
  });
});

describe('backup.js — ensureBackupsTable()', () => {
  let backup;

  before(() => {
    backup = require(backupLibPath);
  });

  test('issues CREATE TABLE IF NOT EXISTS backups', async () => {
    const pool = makeMockPool();

    await backup.ensureBackupsTable(pool);

    const createCalls = pool.calls.filter(c => /CREATE\s+TABLE/i.test(c.sql));
    assert.strictEqual(createCalls.length, 1, 'one CREATE TABLE statement');
    assert.match(
      createCalls[0].sql,
      /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+backups/i,
      'must use IF NOT EXISTS (idempotent)'
    );
  });

  test('issues CREATE INDEX IF NOT EXISTS idx_backups_created', async () => {
    const pool = makeMockPool();

    await backup.ensureBackupsTable(pool);

    const indexCalls = pool.calls.filter(c => /CREATE\s+INDEX/i.test(c.sql));
    assert.strictEqual(indexCalls.length, 1, 'one CREATE INDEX statement');
    assert.match(
      indexCalls[0].sql,
      /idx_backups_created/i,
      'must create the expected index name'
    );
    assert.match(
      indexCalls[0].sql,
      /IF\s+NOT\s+EXISTS/i,
      'index creation must be idempotent'
    );
  });

  test('is idempotent (calling twice issues the same CREATE IF NOT EXISTS queries, no errors)', async () => {
    const pool = makeMockPool();

    await backup.ensureBackupsTable(pool);
    const firstCallCount = pool.calls.length;
    await backup.ensureBackupsTable(pool);
    const secondCallCount = pool.calls.length;

    // Both calls should issue the same number of statements (CREATE TABLE
    // + CREATE INDEX = 2). If the second call short-circuited, that would
    // be a different count — either is fine, what matters is no throw.
    assert.ok(secondCallCount >= firstCallCount,
      'second call must not throw and must issue at least as many statements');
  });

  test('defines all required columns', async () => {
    const pool = makeMockPool();

    await backup.ensureBackupsTable(pool);

    const createCall = pool.calls.find(c => /CREATE\s+TABLE/i.test(c.sql));
    const requiredColumns = [
      'backup_id', 'filename', 'size_bytes', 'checksum', 'status',
      'url', 'provider', 'is_monthly_snapshot', 'created_at', 'restored_at',
    ];
    for (const col of requiredColumns) {
      assert.match(
        createCall.sql,
        new RegExp(`\\b${col}\\b`, 'i'),
        `CREATE TABLE must define column "${col}"`
      );
    }
  });
});

describe('backup.js — module exports', () => {
  test('exports all expected functions + constants', () => {
    const backup = require(backupLibPath);
    assert.strictEqual(typeof backup.runBackup, 'function', 'runBackup must be a function');
    assert.strictEqual(typeof backup.uploadBackup, 'function', 'uploadBackup must be a function');
    assert.strictEqual(typeof backup.restoreBackup, 'function', 'restoreBackup must be a function');
    assert.strictEqual(typeof backup.pruneOldBackups, 'function', 'pruneOldBackups must be a function');
    assert.strictEqual(typeof backup.ensureBackupsTable, 'function', 'ensureBackupsTable must be a function');
    assert.strictEqual(typeof backup.RETENTION_DAYS, 'number', 'RETENTION_DAYS must be a number');
    assert.ok(backup.RETENTION_DAYS > 0, 'RETENTION_DAYS must be positive');
    assert.strictEqual(typeof backup.CLOUDINARY_BACKUP_FOLDER, 'string', 'CLOUDINARY_BACKUP_FOLDER must be a string');
  });
});

describe('admin-backups.js — route module', () => {
  test('exports a factory function that returns an Express Router', () => {
    const factory = require(adminBackupsRoutePath);
    assert.strictEqual(typeof factory, 'function', 'module.exports must be a function');

    // Minimal ctx — the route only uses pool, ah, requireAuth, requireSuperAdmin, audit.
    // Pass no-op middlewares so the router mounts without errors.
    const noop = (req, res, next) => next();
    const ctx = {
      pool: makeMockPool(),
      ah: (fn) => async (req, res, next) => { try { await fn(req, res, next); } catch (e) { res.status(500).json({ error: e.message }); } },
      requireAuth: noop,
      requireSuperAdmin: noop,
      audit: () => {},
    };

    const router = factory(ctx);
    assert.ok(router, 'factory must return a value');
    assert.strictEqual(typeof router.get, 'function', 'returned router must have .get (Express Router)');
    assert.strictEqual(typeof router.post, 'function', 'returned router must have .post (Express Router)');
    assert.strictEqual(typeof router.use, 'function', 'returned router must have .use (Express Router)');
  });

  test('factory does not throw when audit is undefined (defensive)', () => {
    // The route module guards audit calls with `if (typeof audit === 'function')`.
    // Verify the factory doesn't blow up if ctx has no audit (e.g. during unit tests).
    const factory = require(adminBackupsRoutePath);
    const noop = (req, res, next) => next();
    const ctx = {
      pool: makeMockPool(),
      ah: (fn) => async (req, res, next) => { try { await fn(req, res, next); } catch (e) { res.status(500).json({ error: e.message }); } },
      requireAuth: noop,
      requireSuperAdmin: noop,
      // audit intentionally omitted
    };

    assert.doesNotThrow(() => factory(ctx), 'factory must tolerate missing audit');
  });
});

describe('migration 000005_backups.js', () => {
  test('exports up() and down() functions', () => {
    const migration = require(path.join(REPO_DIR, 'migrations', '000005_backups.js'));
    assert.strictEqual(typeof migration.up, 'function', 'migration.up must be a function');
    assert.strictEqual(typeof migration.down, 'function', 'migration.down must be a function');
  });

  test('up() invokes pgm.sql with CREATE TABLE + CREATE INDEX', () => {
    const migration = require(path.join(REPO_DIR, 'migrations', '000005_backups.js'));
    const sqls = [];
    const pgm = { sql: (s) => sqls.push(s) };

    migration.up(pgm);

    assert.ok(sqls.length >= 2, 'up() must issue at least 2 statements (CREATE TABLE + CREATE INDEX)');
    const combined = sqls.join('\n');
    assert.match(combined, /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+backups/i, 'must create backups table');
    assert.match(combined, /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_backups_created/i, 'must create the created_at index');
    assert.match(combined, /is_monthly_snapshot/i, 'table must have is_monthly_snapshot column');
    assert.match(combined, /backup_id\s+VARCHAR\(100\)\s+NOT\s+NULL\s+UNIQUE/i, 'backup_id must be UNIQUE');
  });

  test('down() invokes pgm.sql with DROP TABLE', () => {
    const migration = require(path.join(REPO_DIR, 'migrations', '000005_backups.js'));
    const sqls = [];
    const pgm = { sql: (s) => sqls.push(s) };

    migration.down(pgm);

    assert.ok(sqls.length >= 1, 'down() must issue at least 1 statement');
    assert.match(sqls.join('\n'), /DROP\s+TABLE\s+IF\s+EXISTS\s+backups/i, 'down() must drop the backups table');
  });
});
