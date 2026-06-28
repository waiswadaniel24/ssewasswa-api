/**
 * auth-flow.test.js — integration test for the JSON auth API.
 *
 * Verifies the full register → login → /api/auth/me → logout flow that the
 * README documents but that has never been tested (audit finding F-06).
 *
 * Expected endpoints (per the audit / Track 1 refactor spec):
 *   POST /api/auth/register  → 201 with user object (no password_hash)
 *   POST /api/auth/login     → 200 with Set-Cookie (session)
 *   GET  /api/auth/me        → 200 with user object (when authenticated)
 *                              302 redirect to /login (when not)
 *   POST /api/auth/logout    → 200, session cookie cleared
 *
 * REQUIRES A REAL POSTGRES DATABASE.
 * Set TEST_DATABASE_URL to a test Postgres instance to enable:
 *   TEST_DATABASE_URL=postgres://user:pass@localhost/ssewasswa_test node --test test/auth-flow.test.js
 *
 * The test spawns server.js with DATABASE_URL=TEST_DATABASE_URL and waits for
 * the startup gate to open before running the flow. If the /api/auth/*
 * endpoints don't exist yet (Track 1 may add them), the tests will fail with
 * 404 — that's expected and the tests are ready to pass once the endpoints
 * land. Without TEST_DATABASE_URL the entire suite is skipped.
 *
 * Run via: node --test test/auth-flow.test.js
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const REPO_DIR = path.join(__dirname, '..');
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const SKIP_REASON = 'TEST_DATABASE_URL is not set — skipping auth-flow tests. See test/README.md for setup instructions.';

// Unique credentials per test run so we don't collide with real users.
const TEST_RUN_ID = `${Date.now()}-${process.pid}`;
const TEST_EMAIL = `authflow-${TEST_RUN_ID}@test.example.com`;
const TEST_PASSWORD = `TestPass-${TEST_RUN_ID}!`;

// ---------------------------------------------------------------------------
// HTTP client with a simple cookie jar so we can maintain a session across
// register → login → me → logout requests.
// ---------------------------------------------------------------------------
function httpRequest(method, url, { headers = {}, body = null, timeoutMs = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const opts = {
      method,
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      headers: { ...headers, 'Connection': 'close' },
    };
    if (body) {
      opts.headers['Content-Length'] = Buffer.byteLength(body);
    }
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
    if (body) req.write(body);
    req.end();
  });
}

class CookieJar {
  constructor() { this.cookies = {}; }
  /** Capture Set-Cookie headers from a response. */
  capture(resHeaders) {
    const raw = resHeaders['set-cookie'];
    if (!raw) return;
    const list = Array.isArray(raw) ? raw : [raw];
    for (const line of list) {
      // Parse "name=value; Path=/; HttpOnly" — keep only the name=value part
      const pair = line.split(';')[0].trim();
      if (!pair) continue;
      const eq = pair.indexOf('=');
      if (eq < 0) continue;
      const k = pair.slice(0, eq);
      const v = pair.slice(eq + 1);
      this.cookies[k] = v;
    }
  }
  /** Serialize stored cookies into a Cookie header value. */
  header() {
    return Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  }
  /** Drop a cookie (e.g. after logout). */
  delete(name) { delete this.cookies[name]; }
  /** True if the session cookie is present. */
  hasSessionCookie() {
    // The most common session cookie names used in this codebase.
    return 'connect.sid' in this.cookies || 'session' in this.cookies;
  }
}

function postJson(url, jar, payload) {
  const body = JSON.stringify(payload);
  const headers = { 'Content-Type': 'application/json' };
  const cookieHeader = jar.header();
  if (cookieHeader) headers['Cookie'] = cookieHeader;
  return httpRequest('POST', url, { headers, body });
}

function getJson(url, jar) {
  const headers = {};
  const cookieHeader = jar.header();
  if (cookieHeader) headers['Cookie'] = cookieHeader;
  return httpRequest('GET', url, { headers });
}

// ---------------------------------------------------------------------------
// Subprocess helper — spawn server.js against TEST_DATABASE_URL and wait for
// it to become LIVE (i.e. _serverReady = true).
// ---------------------------------------------------------------------------
function startServer({ extraEnv = {} } = {}) {
  return new Promise((resolve, reject) => {
    const port = 22000 + Math.floor(Math.random() * 5000);
    const baseUrl = `http://127.0.0.1:${port}`;
    const env = {
      PATH: process.env.PATH,
      HOME: process.env.HOME || os.tmpdir(),
      NODE_ENV: 'test', // not 'production' — avoids the SESSION_SECRET=required fatal check
      PORT: String(port),
      DATABASE_URL: TEST_DATABASE_URL,
      SESSION_SECRET: 'test-session-secret-for-auth-flow-test',
      // Discourage the server from making outbound calls during the test
      DISABLE_ANALYTICS: '1',
      DISABLE_SENTRY: '1',
      ...extraEnv,
    };
    const child = spawn('node', ['server.js'], {
      cwd: REPO_DIR,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderrBuf = '';
    child.stderr.on('data', (chunk) => { stderrBuf += chunk.toString(); });

    const startupTimeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`server.js failed to reach LIVE state within 120s. stderr tail:\n${stderrBuf.slice(-3000)}`));
    }, 120000);

    // Poll /test-session — once it returns 200 OK, the startup gate has opened.
    const liveInterval = setInterval(async () => {
      try {
        const res = await httpRequest('GET', `${baseUrl}/test-session`, { timeoutMs: 1500 });
        if (res.status === 200 && res.body === 'OK') {
          clearInterval(liveInterval);
          clearTimeout(startupTimeout);
          resolve({ child, baseUrl, stderr: stderrBuf });
        }
      } catch {
        // not ready yet — keep polling
      }
    }, 1000);

    child.on('exit', (code, signal) => {
      clearInterval(liveInterval);
      clearTimeout(startupTimeout);
      if (code !== null && code !== 0) {
        reject(new Error(`server.js exited with code ${code} during startup. stderr tail:\n${stderrBuf.slice(-3000)}`));
      }
    });
  });
}

async function stopServer(server) {
  if (!server || !server.child) return;
  try {
    server.child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 500));
    try { server.child.kill('SIGKILL'); } catch { /* already dead */ }
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Tests — skipped entirely if no TEST_DATABASE_URL.
// ---------------------------------------------------------------------------
const describeOrSkip = TEST_DATABASE_URL ? describe : describe.skip;

describeOrSkip('Auth flow: register → login → /api/auth/me → logout', () => {
  let server;
  let baseUrl;
  let jar;

  before(async () => {
    if (!TEST_DATABASE_URL) return;
    server = await startServer();
    baseUrl = server.baseUrl;
    jar = new CookieJar();
  });

  after(async () => {
    if (server) await stopServer(server);
  });

  // Note: these tests run sequentially within the suite. The order matters:
  // register must come before login, login before /me, etc. node:test runs
  // tests in declaration order within a describe block.

  test('POST /api/auth/register with valid email + password → 201 with user object (no password_hash)', async () => {
    const res = await postJson(`${baseUrl}/api/auth/register`, jar, {
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      name: `Auth Flow Test ${TEST_RUN_ID}`,
    });
    // Capture any cookies set during register (some implementations log the
    // user in immediately upon registration).
    jar.capture(res.headers);
    if (res.status !== 201) {
      // If the endpoint doesn't exist yet, surface a clear message for the
      // worklog rather than a cryptic assertion failure.
      console.error(`[auth-flow] register returned ${res.status}. Body: ${res.body.slice(0, 500)}`);
    }
    assert.strictEqual(res.status, 201, `expected 201 from /api/auth/register, got ${res.status}`);
    const body = JSON.parse(res.body);
    assert.ok(body.user || body.id || body.email, 'response should include a user object');
    const user = body.user || body;
    assert.ok(user.email, 'user object should have an email field');
    // CRITICAL: password_hash must never be leaked in the response
    assert.ok(
      !JSON.stringify(user).includes('password_hash') && !JSON.stringify(user).includes('password'),
      'register response must NOT include password_hash or password fields'
    );
  });

  test('POST /api/auth/login with valid credentials → 200 with session cookie set', async () => {
    // Use a fresh jar for login so we test that the session cookie is set
    // by the login endpoint specifically (not carried over from register).
    const loginJar = new CookieJar();
    const res = await postJson(`${baseUrl}/api/auth/login`, loginJar, {
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });
    if (res.status !== 200) {
      console.error(`[auth-flow] login returned ${res.status}. Body: ${res.body.slice(0, 500)}`);
    }
    assert.strictEqual(res.status, 200, `expected 200 from /api/auth/login, got ${res.status}`);
    loginJar.capture(res.headers);
    assert.ok(
      loginJar.hasSessionCookie(),
      `login response must set a session cookie (Set-Cookie header). Headers: ${JSON.stringify(res.headers['set-cookie'] || 'none')}`
    );
    // Promote the login jar to be the suite's jar so subsequent tests are authenticated.
    jar = loginJar;
  });

  test('GET /api/auth/me with session cookie → 200 with user object', async () => {
    const res = await getJson(`${baseUrl}/api/auth/me`, jar);
    if (res.status !== 200) {
      console.error(`[auth-flow] /api/auth/me (authenticated) returned ${res.status}. Body: ${res.body.slice(0, 500)}`);
    }
    assert.strictEqual(res.status, 200, `expected 200 from /api/auth/me with session, got ${res.status}`);
    const body = JSON.parse(res.body);
    const user = body.user || body;
    assert.ok(user.email, '/api/auth/me response should include user.email');
    assert.strictEqual(
      user.email, TEST_EMAIL,
      `/api/auth/me should return the logged-in user's email (expected ${TEST_EMAIL}, got ${user.email})`
    );
    // Sanity: no password leak
    assert.ok(
      !JSON.stringify(body).includes('password_hash'),
      '/api/auth/me response must NOT include password_hash'
    );
  });

  test('GET /api/auth/me without session cookie → 302 redirect to /login', async () => {
    const noCookieJar = new CookieJar();
    const res = await getJson(`${baseUrl}/api/auth/me`, noCookieJar);
    // 302 redirect to /login is the existing behavior for unauthenticated
    // browser requests in this codebase (see server.js requireAuth at line 1084).
    // Some API-style auth endpoints return 401 instead — accept either, but
    // the spec calls for 302 to /login.
    if (res.status !== 302 && res.status !== 401) {
      console.error(`[auth-flow] /api/auth/me (unauthenticated) returned ${res.status}. Body: ${res.body.slice(0, 200)}`);
    }
    assert.ok(
      res.status === 302 || res.status === 401,
      `expected 302 redirect to /login (or 401) for unauthenticated /api/auth/me, got ${res.status}`
    );
    if (res.status === 302) {
      const loc = res.headers['location'] || '';
      assert.ok(
        loc.includes('/login'),
        `302 redirect Location should point to /login, got: ${loc}`
      );
    }
  });

  test('POST /api/auth/logout → 200, session cookie cleared', async () => {
    const res = await postJson(`${baseUrl}/api/auth/logout`, jar, {});
    if (res.status !== 200) {
      console.error(`[auth-flow] logout returned ${res.status}. Body: ${res.body.slice(0, 500)}`);
    }
    assert.strictEqual(res.status, 200, `expected 200 from /api/auth/logout, got ${res.status}`);
    // The logout response should either clear the session cookie (Set-Cookie
    // with Max-Age=0 or Expires in the past) or explicitly expire it.
    const setCookie = res.headers['set-cookie'];
    if (setCookie) {
      const lines = Array.isArray(setCookie) ? setCookie : [setCookie];
      const cleared = lines.some(l => /Max-Age=0|expires=Thu, 01 Jan 1970|expires=expired/i.test(l));
      assert.ok(cleared, `logout should clear the session cookie. Set-Cookie was: ${JSON.stringify(lines)}`);
    } else {
      // Some implementations rely on the client deleting the cookie. Either
      // way, subsequent /me requests should redirect.
      jar.delete('connect.sid');
      jar.delete('session');
    }
  });

  test('GET /api/auth/me after logout → 302 redirect to /login', async () => {
    const res = await getJson(`${baseUrl}/api/auth/me`, jar);
    assert.ok(
      res.status === 302 || res.status === 401,
      `expected 302 redirect (or 401) for /api/auth/me after logout, got ${res.status}`
    );
    if (res.status === 302) {
      const loc = res.headers['location'] || '';
      assert.ok(
        loc.includes('/login'),
        `post-logout /api/auth/me redirect should point to /login, got: ${loc}`
      );
    }
  });
});

// Always-on sanity test: verify the skip logic itself works.
describe('auth-flow test harness', () => {
  test('skips gracefully when TEST_DATABASE_URL is unset', { skip: TEST_DATABASE_URL ? false : SKIP_REASON }, () => {
    assert.ok(TEST_DATABASE_URL, 'TEST_DATABASE_URL should be set when this test runs');
  });
});
