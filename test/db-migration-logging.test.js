/**
 * db-migration-logging.test.js — verifies the F-07 audit fix.
 *
 * F-07 fix: `db.js#migrateQuery` previously swallowed ALL non-retryable migration
 * errors silently. The fix logs them loudly via `console.error` with a
 * `[MIGRATION FAILED]` prefix while still resolving the promise (so the app
 * doesn't crash). This test verifies both behaviors:
 *   1. console.error is called with `[MIGRATION FAILED]` for non-retryable errors
 *   2. migrateQuery resolves (does NOT reject) — preserving the no-crash behavior
 *
 * This test imports `migrateQuery` from `db.js` directly and passes a fake pool,
 * so it does NOT need a real database. It runs in any environment.
 *
 * Run via: node --test test/db-migration-logging.test.js
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

// Import migrateQuery from db.js — it's a pure function that takes a pool object
// (duck-typed: only needs .query(sql, params)). We pass a fake pool.
const { migrateQuery } = require(path.join(__dirname, '..', 'db.js'));

/**
 * Build a fake pg Pool whose .query() throws the given error.
 * The error message controls whether migrateQuery treats it as retryable.
 * Non-retryable errors go straight to the [MIGRATION FAILED] log path.
 */
function makeFakePool(opts = {}) {
  const { errorMessage = 'syntax error at or near "FOOBAR"', errorName = 'error' } = opts;
  const calls = [];
  return {
    calls,
    query(sql, params) {
      calls.push({ sql, params });
      const err = new Error(errorMessage);
      err.name = errorName;
      // Mimic pg's error code property when applicable
      if (opts.errorCode) err.code = opts.errorCode;
      throw err;
    },
  };
}

describe('migrateQuery — F-07 audit fix: migration error logging', () => {
  let originalConsoleError;
  let originalConsoleWarn;
  let originalConsoleLog;
  let consoleErrorCalls;
  let consoleWarnCalls;
  let consoleLogCalls;

  beforeEach(() => {
    originalConsoleError = console.error;
    originalConsoleWarn = console.warn;
    originalConsoleLog = console.log;
    consoleErrorCalls = [];
    consoleWarnCalls = [];
    consoleLogCalls = [];
    console.error = (...args) => { consoleErrorCalls.push(args.map(String).join(' ')); };
    console.warn = (...args) => { consoleWarnCalls.push(args.map(String).join(' ')); };
    console.log = (...args) => { consoleLogCalls.push(args.map(String).join(' ')); };
  });

  afterEach(() => {
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
    console.log = originalConsoleLog;
  });

  test('logs `[MIGRATION FAILED]` when SQL has a syntax error', async () => {
    const fakePool = makeFakePool({
      errorMessage: 'syntax error at or near "FOOBAR"',
    });
    const badSql = 'CREATE TABLE permissions_test_table_with_invalid_sql syntax error here;';

    // migrateQuery should resolve (not reject) — that's the no-crash behavior
    let result;
    let threw = false;
    try {
      result = await migrateQuery(fakePool, 'TestModule', badSql);
    } catch (e) {
      threw = true;
    }
    assert.strictEqual(threw, false, 'migrateQuery must NOT reject on migration failure (no-crash behavior preserved)');
    assert.ok(result, 'migrateQuery must resolve with a result object');
    assert.ok(result.rows !== undefined, 'migrateQuery must resolve with an object containing a rows array');

    // Verify the [MIGRATION FAILED] log line was emitted
    const failedLogs = consoleErrorCalls.filter(line => line.includes('[MIGRATION FAILED]'));
    assert.ok(
      failedLogs.length >= 1,
      `console.error must be called with [MIGRATION FAILED] prefix. Got calls: ${JSON.stringify(consoleErrorCalls)}`
    );

    // The first [MIGRATION FAILED] line should mention the module name
    const firstFailLog = failedLogs[0];
    assert.ok(
      firstFailLog.includes('TestModule'),
      `[MIGRATION FAILED] log must mention the module name. Got: ${firstFailLog}`
    );

    // The log should include the error message
    assert.ok(
      firstFailLog.includes('syntax error'),
      `[MIGRATION FAILED] log must include the error message. Got: ${firstFailLog}`
    );
  });

  test('logs the failing SQL (truncated to 200 chars) in a second [MIGRATION FAILED] line', async () => {
    const fakePool = makeFakePool({
      errorMessage: 'relation "nonexistent_table" does not exist',
    });
    const badSql = 'SELECT * FROM nonexistent_table;';

    await migrateQuery(fakePool, 'TestModuleSqlLog', badSql);

    const failedLogs = consoleErrorCalls.filter(line => line.includes('[MIGRATION FAILED]'));
    assert.ok(failedLogs.length >= 2, 'expected at least 2 [MIGRATION FAILED] log lines (message + SQL)');
    const sqlLog = failedLogs.find(line => line.includes('SQL was'));
    assert.ok(sqlLog, `one of the [MIGRATION FAILED] log lines must include the SQL. Got: ${JSON.stringify(failedLogs)}`);
    assert.ok(
      sqlLog.includes('SELECT * FROM nonexistent_table'),
      'the SQL log line must contain the failing SQL'
    );
  });

  test('truncates SQL longer than 200 chars in the log', async () => {
    const fakePool = makeFakePool({ errorMessage: 'syntax error' });
    // 400-char SQL string
    const longSql = 'CREATE TABLE foo (' + 'col_x TEXT, '.repeat(30) + 'last_col TEXT);';
    assert.ok(longSql.length > 200, 'test SQL must be longer than 200 chars');

    await migrateQuery(fakePool, 'TestModuleLongSql', longSql);

    const sqlLog = consoleErrorCalls.find(line => line.includes('[MIGRATION FAILED]') && line.includes('SQL was'));
    assert.ok(sqlLog, 'expected a [MIGRATION FAILED] SQL log line');
    // The log line should include the truncation marker `...`
    assert.ok(sqlLog.includes('...'), `long SQL log must be truncated with "...". Got: ${sqlLog}`);
  });

  test('"already exists" errors are NOT logged as failures (expected idempotent migrations)', async () => {
    const fakePool = makeFakePool({ errorMessage: 'relation "foo" already exists' });
    const sql = 'CREATE TABLE IF NOT EXISTS foo (id INT);';

    await migrateQuery(fakePool, 'TestModuleAlreadyExists', sql);

    const failedLogs = consoleErrorCalls.filter(line => line.includes('[MIGRATION FAILED]'));
    assert.strictEqual(
      failedLogs.length,
      0,
      `"already exists" is the expected case for CREATE TABLE IF NOT EXISTS and must NOT be logged as a failure. Got: ${JSON.stringify(consoleErrorCalls)}`
    );
  });

  test('retryable errors (e.g. "Connection terminated") are retried, not immediately logged as failure', async () => {
    // For a retryable error, the queue retries up to 2 times before giving up.
    // We use a fake pool that always throws "Connection terminated" — after the
    // retries are exhausted, it should land on the [MIGRATION FAILED] path.
    const fakePool = makeFakePool({ errorMessage: 'Connection terminated' });
    const sql = 'CREATE TABLE foo (id INT);';

    const start = Date.now();
    await migrateQuery(fakePool, 'TestModuleRetryable', sql);
    const elapsed = Date.now() - start;

    // It should have retried (delay between attempts), so this takes at least 3s (1s + jitter, 2 attempts)
    // — but we only assert that retries happened (>= 1 retry call beyond the initial).
    assert.ok(
      fakePool.calls.length >= 2,
      `retryable errors must be retried at least once. Pool.query was called ${fakePool.calls.length} times`
    );

    // After retries are exhausted, the failure should be logged
    const failedLogs = consoleErrorCalls.filter(line => line.includes('[MIGRATION FAILED]'));
    assert.ok(
      failedLogs.length >= 1,
      'after retries are exhausted, the failure must be logged with [MIGRATION FAILED]'
    );

    // Document the elapsed time so the test output makes the retry behavior visible
    assert.ok(elapsed > 0, `retries took ${elapsed}ms`);
  });

  test('successful migration does NOT log [MIGRATION FAILED]', async () => {
    const fakePool = {
      query() { return Promise.resolve({ rows: [{ id: 1 }] }); },
    };
    await migrateQuery(fakePool, 'TestModuleSuccess', 'CREATE TABLE foo (id INT);');

    const failedLogs = consoleErrorCalls.filter(line => line.includes('[MIGRATION FAILED]'));
    assert.strictEqual(
      failedLogs.length,
      0,
      `successful migrations must NOT log [MIGRATION FAILED]. Got: ${JSON.stringify(consoleErrorCalls)}`
    );
  });
});
