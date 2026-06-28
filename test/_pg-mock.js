/**
 * _pg-mock.js — test helper that mocks the `pg` module so server.js can boot
 * without a real database. Preloaded via `node --require test/_pg-mock.js server.js`.
 *
 * Why this exists:
 *   The real server.js wraps `pool.query` in a startup guard that retries
 *   connection failures for ~18s each. With a fake DATABASE_URL (ECONNREFUSED),
 *   the /api/health endpoint would queue behind hundreds of migration retries
 *   and take minutes to respond — too slow for tests. By mocking `pg` we make
 *   every migration query resolve instantly, and we can control what the
 *   /api/health probe sees.
 *
 * Behavior:
 *   - Migration queries (everything except the health-check SELECT) → { rows: [] }
 *   - The health-check query (SELECT count(*) ... information_schema.tables) →
 *     controlled by the file at $PG_MOCK_STATE_FILE:
 *       "ok"       → { rows: [{ n: 374 }] }
 *       "degraded" → { rows: [{ n: 0 }] }
 *       "down"     → throws Error("mock: DB unreachable")
 *     Default mode if no state file exists or env var unset: "ok".
 *
 * This file is NOT a test file — it is a preload hook. It must not throw on
 * load (it would crash the spawned server before any test runs).
 */

const Module = require('module');
const fs = require('fs');

// Match the /api/health probe SQL regardless of clause order:
//   SELECT count(*)::int AS n FROM information_schema.tables WHERE ...
const HEALTH_CHECK_SQL_PATTERN = /information_schema\.tables/i;
const HEALTH_CHECK_COUNT_PATTERN = /count\s*\(\s*\*\s*\)/i;

function readMockMode() {
  const stateFile = process.env.PG_MOCK_STATE_FILE;
  if (!stateFile) return 'ok';
  try {
    const raw = fs.readFileSync(stateFile, 'utf8').trim();
    if (raw === 'ok' || raw === 'degraded' || raw === 'down') return raw;
    return 'ok';
  } catch {
    return 'ok';
  }
}

function makeMockQueryFn() {
  return function query(sql, params) {
    if (
      typeof sql === 'string' &&
      HEALTH_CHECK_SQL_PATTERN.test(sql) &&
      HEALTH_CHECK_COUNT_PATTERN.test(sql)
    ) {
      const mode = readMockMode();
      if (mode === 'down') {
        return Promise.reject(new Error('mock: DB unreachable (set by _pg-mock.js for the down-state test)'));
      }
      const n = mode === 'degraded' ? 0 : 374;
      return Promise.resolve({ rows: [{ n }], rowCount: 1, command: 'SELECT' });
    }
    // All other queries (migrations, session table checks, etc.) succeed
    return Promise.resolve({ rows: [], rowCount: 0, command: 'CREATE' });
  };
}

class MockPool {
  constructor(config) {
    this.options = config || {};
    this.options.max = this.options.max || 15;
    this.options.connectionTimeoutMillis = this.options.connectionTimeoutMillis || 30000;
    this.query = makeMockQueryFn();
  }
  connect() {
    const pool = this;
    return Promise.resolve({
      query: pool.query,
      release() { /* no-op */ },
    });
  }
  on() { /* no-op — swallow 'error' event listener registration */ }
  end() { return Promise.resolve(); }
  totalCount() { return 0; }
  idleCount() { return 0; }
  waitingCount() { return 0; }
}

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'pg') {
    return { Pool: MockPool };
  }
  return originalLoad.apply(this, arguments);
};

// Print a marker line so tests can detect when the mock is active
process.stderr.write('[pg-mock] installed (state file: ' + (process.env.PG_MOCK_STATE_FILE || '<unset, default=ok>') + ')\n');
