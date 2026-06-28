/**
 * health.test.js — integration tests for /ping and /api/health endpoints.
 *
 * Verifies:
 *   - GET  /ping         → 200, body "pong"
 *   - HEAD /ping         → 200, empty body
 *   - GET  /api/health   → 200/503 with the documented JSON shape:
 *       status: "ok"       when DB has tables (mocked to 374)
 *       status: "degraded" when DB is connected but has 0 tables
 *       status: "down"     when DB is unreachable (503)
 *
 * The DB is mocked via test/_pg-mock.js (preloaded with `--require`) so the
 * server can boot in milliseconds without a real Postgres. The health probe
 * behavior is controlled by writing "ok" / "degraded" / "down" to a temp
 * state file that the mock reads on each call.
 *
 * Run via: node --test test/health.test.js
 */

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const REPO_DIR = path.join(__dirname, '..');
const PG_MOCK_PATH = path.join(__dirname, '_pg-mock.js');

// ---------------------------------------------------------------------------
// HTTP helper — minimal Promise-based HTTP client built on node:http.
// We avoid adding `supertest` as a devDependency per the task constraints.
// ---------------------------------------------------------------------------
function httpRequest(method, url, { timeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const opts = {
      method,
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      headers: { 'Connection': 'close' },
    };
    const req = http.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`HTTP ${method} ${url} timed out after ${timeoutMs}ms`));
    });
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Subprocess helper — spawn server.js with the pg mock preloaded, wait until
// /ping responds, return the child process and base URL.
// ---------------------------------------------------------------------------
function startServer({ stateFile, extraEnv = {} } = {}) {
  return new Promise((resolve, reject) => {
    // Pick a random high port to avoid collisions with parallel test runs
    const port = 18000 + Math.floor(Math.random() * 5000);
    const baseUrl = `http://127.0.0.1:${port}`;

    const env = {
      // Minimum env to keep server.js's NODE_ENV=production guards happy
      PATH: process.env.PATH,
      HOME: process.env.HOME || os.tmpdir(),
      NODE_ENV: 'test',
      PORT: String(port),
      DATABASE_URL: 'postgres://mock:mock@127.0.0.1:1/mock',
      SESSION_SECRET: 'test-session-secret-for-health-test-only',
      // pg mock configuration
      PG_MOCK_STATE_FILE: stateFile || '',
      ...extraEnv,
    };

    const child = spawn('node', ['--require', PG_MOCK_PATH, 'server.js'], {
      cwd: REPO_DIR,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderrBuf = '';
    child.stderr.on('data', (chunk) => { stderrBuf += chunk.toString(); });

    const startupTimeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`server.js failed to start within 40s. stderr:\n${stderrBuf.slice(-3000)}`));
    }, 40000);

    // Poll /ping until it responds 200
    const pingInterval = setInterval(async () => {
      try {
        const res = await httpRequest('GET', `${baseUrl}/ping`, { timeoutMs: 1000 });
        if (res.status === 200 && res.body === 'pong') {
          clearInterval(pingInterval);
          clearTimeout(startupTimeout);
          resolve({ child, baseUrl, stderr: stderrBuf });
        }
      } catch {
        // server not ready yet — keep polling
      }
    }, 500);

    child.on('exit', (code, signal) => {
      clearInterval(pingInterval);
      clearTimeout(startupTimeout);
      if (code !== null && code !== 0) {
        reject(new Error(`server.js exited with code ${code} during startup. stderr:\n${stderrBuf.slice(-3000)}`));
      }
    });
  });
}

async function stopServer(server) {
  if (!server || !server.child) return;
  try {
    server.child.kill('SIGTERM');
    // Give it a moment to clean up, then SIGKILL if still alive
    await new Promise((r) => setTimeout(r, 300));
    try { server.child.kill('SIGKILL'); } catch { /* already dead */ }
  } catch { /* ignore */ }
}

// Wait for the server to be "LIVE" — i.e. _startupMigrationsDone = true and
// _serverReady = true. We need this for the "down" test case because the
// startup guard wraps pool.query and converts thrown errors into { rows: [] }
// resolutions, which would make /api/health return "degraded" instead of "down".
// Once the guard is disabled (after the drain), pool.query goes straight to
// our mock and the throw propagates to the /api/health catch block.
async function waitForServerLive(server, { timeoutMs = 60000 }) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    // Once _serverReady is true, the startup-gate middleware stops emitting
    // its "Starting Up" HTML and starts passing requests through. We can
    // detect this by hitting a non-allow-listed path and checking the status.
    try {
      const res = await httpRequest('GET', `${server.baseUrl}/test-session`, { timeoutMs: 1000 });
      if (res.status === 200 && res.body === 'OK') {
        return true;
      }
    } catch {
      // server not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server.js did not reach LIVE state within ${timeoutMs}ms`);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /ping', () => {
  let server;
  let stateFile;

  before(async () => {
    stateFile = path.join(os.tmpdir(), `pg-mock-state-ping-${process.pid}.txt`);
    fs.writeFileSync(stateFile, 'ok');
    server = await startServer({ stateFile });
  });

  after(async () => {
    await stopServer(server);
    try { fs.unlinkSync(stateFile); } catch { /* ignore */ }
  });

  test('returns 200 with body "pong"', async () => {
    const res = await httpRequest('GET', `${server.baseUrl}/ping`);
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    assert.strictEqual(res.body, 'pong', `expected body "pong", got ${JSON.stringify(res.body)}`);
    // The endpoint sets Content-Type: text/plain explicitly
    assert.ok(
      /text\/plain/.test(res.headers['content-type'] || ''),
      `expected Content-Type to include text/plain, got ${res.headers['content-type']}`
    );
  });

  test('HEAD /ping returns 200 with empty body', async () => {
    const res = await httpRequest('HEAD', `${server.baseUrl}/ping`);
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    assert.strictEqual(res.body, '', `expected empty body for HEAD, got ${JSON.stringify(res.body)}`);
  });
});

describe('GET /api/health — DB connected with tables (status: "ok")', () => {
  let server;
  let stateFile;

  before(async () => {
    stateFile = path.join(os.tmpdir(), `pg-mock-state-ok-${process.pid}.txt`);
    fs.writeFileSync(stateFile, 'ok');
    server = await startServer({ stateFile });
  });

  after(async () => {
    await stopServer(server);
    try { fs.unlinkSync(stateFile); } catch { /* ignore */ }
  });

  test('returns 200 with status: "ok" and table_count: 374', async () => {
    const res = await httpRequest('GET', `${server.baseUrl}/api/health`);
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.status, 'ok', `expected status "ok", got ${body.status}`);
    assert.strictEqual(body.db.connected, true, 'db.connected should be true');
    assert.strictEqual(body.db.table_count, 374, `expected table_count 374, got ${body.db.table_count}`);
    assert.ok(body.db.latency_ms >= 0, 'db.latency_ms should be a non-negative number');
  });

  test('response includes all required fields', async () => {
    const res = await httpRequest('GET', `${server.baseUrl}/api/health`);
    assert.strictEqual(res.status, 200);
    const body = JSON.parse(res.body);
    const requiredFields = [
      'status', 'timestamp', 'uptime_seconds', 'db', 'redis', 'version', 'node', 'env'
    ];
    for (const f of requiredFields) {
      assert.ok(f in body, `response is missing required field: ${f}`);
    }
    // Validate types
    assert.strictEqual(typeof body.status, 'string');
    assert.strictEqual(typeof body.timestamp, 'string');
    assert.ok(new Date(body.timestamp).toString() !== 'Invalid Date', 'timestamp must be a valid ISO date');
    assert.strictEqual(typeof body.uptime_seconds, 'number');
    assert.strictEqual(typeof body.db, 'object');
    assert.strictEqual(typeof body.redis, 'object');
    assert.strictEqual(typeof body.version, 'string');
    assert.strictEqual(typeof body.node, 'string');
    assert.strictEqual(typeof body.env, 'string');
  });

  test('response Content-Type is application/json', async () => {
    const res = await httpRequest('GET', `${server.baseUrl}/api/health`);
    assert.ok(
      /application\/json/.test(res.headers['content-type'] || ''),
      `expected Content-Type to include application/json, got ${res.headers['content-type']}`
    );
  });
});

describe('GET /api/health — DB connected but 0 tables (status: "degraded")', () => {
  let server;
  let stateFile;

  before(async () => {
    stateFile = path.join(os.tmpdir(), `pg-mock-state-degraded-${process.pid}.txt`);
    fs.writeFileSync(stateFile, 'degraded');
    server = await startServer({ stateFile });
  });

  after(async () => {
    await stopServer(server);
    try { fs.unlinkSync(stateFile); } catch { /* ignore */ }
  });

  test('returns 200 with status: "degraded" and table_count: 0', async () => {
    const res = await httpRequest('GET', `${server.baseUrl}/api/health`);
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.status, 'degraded', `expected status "degraded", got ${body.status}`);
    assert.strictEqual(body.db.connected, true, 'db.connected should still be true (DB is reachable, just empty)');
    assert.strictEqual(body.db.table_count, 0, `expected table_count 0, got ${body.db.table_count}`);
    // The endpoint adds a warning string explaining the situation (audit finding F-02)
    assert.ok(body.db.warning, 'db.warning should be present when DB is empty');
  });
});

describe('GET /api/health — DB unreachable (status: "down", HTTP 503)', () => {
  let server;
  let stateFile;

  before(async () => {
    stateFile = path.join(os.tmpdir(), `pg-mock-state-down-${process.pid}.txt`);
    fs.writeFileSync(stateFile, 'down');
    server = await startServer({ stateFile });
    // CRITICAL: For the "down" case, we MUST wait for the startup guard to
    // be disabled. During startup, pool.query is wrapped and any thrown error
    // is converted to a { rows: [] } resolution — which would make /api/health
    // return "degraded" instead of "down". Once _serverReady = true (after the
    // migration drain), pool.query bypasses the guard and our mock's throw
    // propagates to the /api/health catch block.
    await waitForServerLive(server, { timeoutMs: 90000 });
  });

  after(async () => {
    await stopServer(server);
    try { fs.unlinkSync(stateFile); } catch { /* ignore */ }
  });

  test('returns 503 with status: "down" and db.connected: false', async () => {
    const res = await httpRequest('GET', `${server.baseUrl}/api/health`);
    assert.strictEqual(res.status, 503, `expected 503, got ${res.status}`);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.status, 'down', `expected status "down", got ${body.status}`);
    assert.strictEqual(body.db.connected, false, 'db.connected should be false when DB is unreachable');
    assert.ok(body.db.error, 'db.error should contain the error message');
  });
});

describe('HEAD /api/health', () => {
  let server;
  let stateFile;

  before(async () => {
    stateFile = path.join(os.tmpdir(), `pg-mock-state-head-${process.pid}.txt`);
    fs.writeFileSync(stateFile, 'ok');
    server = await startServer({ stateFile });
  });

  after(async () => {
    await stopServer(server);
    try { fs.unlinkSync(stateFile); } catch { /* ignore */ }
  });

  test('returns 200 with empty body (used by Render health-check pinger)', async () => {
    const res = await httpRequest('HEAD', `${server.baseUrl}/api/health`);
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    assert.strictEqual(res.body, '', `expected empty body for HEAD, got ${JSON.stringify(res.body)}`);
  });
});
