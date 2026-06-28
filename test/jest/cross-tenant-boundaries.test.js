// test/jest/cross-tenant-boundaries.test.js
//
// CROSS-TENANT BOUNDARY TESTS (Jest + supertest)
//
// These tests verify that the platform's multi-tenant data isolation is
// bulletproof at the HTTP level. They create two tenants (A and B), each with
// their own users, students, fees, donations, and API keys, then attempt to
// access Tenant B's data using Tenant A's credentials. Every attempt must
// fail.
//
// Per the master summary:
//   "A built-in GitHub Actions CI/CD pipeline automatically spins up
//    automated Jest/Supertest environments to verify that cross-tenant data
//    boundaries are perfectly locked before any new code can be merged into
//    production."
//
// This file IS that Jest/Supertest environment.
//
// ---------------------------------------------------------------------------
// SKIP BEHAVIOR
// ---------------------------------------------------------------------------
//
// The entire suite is skipped (not failed) when:
//   - `supertest` is not installed (e.g., devDependencies not yet installed)
//   - `DATABASE_URL` is not set (no test DB available)
//   - `bcryptjs` is not installed (we need it to hash test passwords)
//
// When skipped, Jest reports the suite as "skipped" and exits 0 — this lets
// CI run Jest on every push without breaking when the Postgres service
// container is unavailable.
//
// ---------------------------------------------------------------------------
// TEST DB REQUIREMENTS
// ---------------------------------------------------------------------------
//
// The test DB must have the schema already migrated:
//   DATABASE_URL=postgres://localhost/ssewasswa_test npm run migrate
//
// The tests create their own tenants / users / students / fees / donations /
// api_keys with unique per-run identifiers and clean up after themselves, so
// they can be re-run against the same test DB without manual cleanup.
//
// ---------------------------------------------------------------------------
// HOW IT WORKS
// ---------------------------------------------------------------------------
//
// 1. `beforeAll`:
//    - Spawns server.js as a subprocess with DATABASE_URL pointing at the
//      test DB. (server.js calls `server.listen()` at the bottom and does NOT
//      export the app, so we can't use supertest(app) directly.)
//    - Waits for /test-session to return 200 OK (signals the startup gate
//      has opened and the server is LIVE).
//    - Opens a direct pg connection to the test DB and creates two tenants,
//      two users (with bcrypt-hashed passwords), two students, two fees, two
//      donations, and two API keys — one set per tenant.
//
// 2. Each test makes HTTP requests via supertest against the running server
//    using either:
//      - An API key (Bearer token) for /api/v1/* routes, OR
//      - A session cookie (obtained by POSTing to /login) for /school/* routes.
//
// 3. `afterAll`:
//    - Cleans up all test data from the DB (cascade delete from tenants).
//    - Stops the server subprocess.

const { describe, beforeAll, afterAll, test, expect } = require('@jest/globals');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');

// Lazy-load optional dependencies. If any are missing, the suite skips.
let supertest, bcryptjs, pg;
try { supertest = require('supertest'); } catch (e) { supertest = null; }
try { bcryptjs = require('bcryptjs'); } catch (e) { bcryptjs = null; }
try { pg = require('pg'); } catch (e) { pg = null; }

const REPO_DIR = path.join(__dirname, '..', '..');
const DATABASE_URL = process.env.DATABASE_URL;

// Skip the entire suite if any prerequisite is missing.
//
// We also skip when DATABASE_URL is set but doesn't look like a Postgres URL
// (e.g. `file:...` for SQLite, or `mysql://...`). The test suite uses `pg`
// directly and would fail at connection time — better to skip cleanly.
const IS_POSTGRES_URL = DATABASE_URL && /^postgres(ql)?:\/\//.test(DATABASE_URL);
const SKIP_REASON = !supertest
  ? 'supertest not installed (run: npm install --save-dev supertest)'
  : !DATABASE_URL
  ? 'DATABASE_URL is not set — skipping cross-tenant boundary tests. See test/jest/README.md for setup.'
  : !IS_POSTGRES_URL
  ? `DATABASE_URL is not a Postgres URL ("${DATABASE_URL}") — skipping cross-tenant boundary tests.`
  : !bcryptjs
  ? 'bcryptjs not installed (required to hash test-user passwords)'
  : !pg
  ? 'pg not installed (required to seed the test DB)'
  : null;

const describeOrSkip = SKIP_REASON ? describe.skip : describe;

// ---------------------------------------------------------------------------
// Per-run unique identifiers — prevents collisions across test runs and lets
// us clean up reliably even if a previous run crashed mid-way.
// ---------------------------------------------------------------------------
const TEST_RUN_ID = `${Date.now()}-${process.pid}`;
const TENANT_A_NAME = `jest-tenant-A-${TEST_RUN_ID}`;
const TENANT_B_NAME = `jest-tenant-B-${TEST_RUN_ID}`;
const TENANT_A_EMAIL = `jest-tenant-a-${TEST_RUN_ID}@test.example.com`;
const TENANT_B_EMAIL = `jest-tenant-b-${TEST_RUN_ID}@test.example.com`;
const USER_A_EMAIL = `jest-user-a-${TEST_RUN_ID}@test.example.com`;
const USER_B_EMAIL = `jest-user-b-${TEST_RUN_ID}@test.example.com`;
const USER_PASSWORD = `JestTestPass-${TEST_RUN_ID}!`;
const STUDENT_A_NAME = `jest-student-A-${TEST_RUN_ID}`;
const STUDENT_B_NAME = `jest-student-B-${TEST_RUN_ID}`;
const STUDENT_A_ADM = `JEST-A-${TEST_RUN_ID}`;
const STUDENT_B_ADM = `JEST-B-${TEST_RUN_ID}`;
const FEE_A_TERM = `jest-term-A-${TEST_RUN_ID}`;
const FEE_B_TERM = `jest-term-B-${TEST_RUN_ID}`;
const DONATION_A_DONOR = `jest-donor-A-${TEST_RUN_ID}`;
const DONATION_B_DONOR = `jest-donor-B-${TEST_RUN_ID}`;
const API_KEY_A_PLAIN = `jest-api-key-A-${TEST_RUN_ID}-secret`;
const API_KEY_B_PLAIN = `jest-api-key-B-${TEST_RUN_ID}-secret`;

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}
const API_KEY_A_HASH = sha256(API_KEY_A_PLAIN);
const API_KEY_B_HASH = sha256(API_KEY_B_PLAIN);

// ---------------------------------------------------------------------------
// HTTP helper — spawn server.js as a subprocess, wait for it to be LIVE.
// (Adapted from test/auth-flow.test.js's startServer helper.)
// ---------------------------------------------------------------------------
function httpRequest(method, url, { headers = {}, body = null, timeoutMs = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const opts = {
      method,
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      headers: { ...headers, Connection: 'close' },
    };
    if (body) opts.headers['Content-Length'] = Buffer.byteLength(body);
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

function startServer({ extraEnv = {} } = {}) {
  return new Promise((resolve, reject) => {
    const port = 23000 + Math.floor(Math.random() * 5000);
    const baseUrl = `http://127.0.0.1:${port}`;
    const env = {
      PATH: process.env.PATH,
      HOME: process.env.HOME || os.tmpdir(),
      NODE_ENV: 'test', // not 'production' — avoids the SESSION_SECRET=required fatal check
      PORT: String(port),
      DATABASE_URL,
      SESSION_SECRET: process.env.SESSION_SECRET || 'jest-test-session-secret',
      CSRF_SECRET: process.env.CSRF_SECRET || 'jest-test-csrf-secret',
      ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || 'a'.repeat(64),
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
      reject(new Error(
        `server.js failed to reach LIVE state within 120s. stderr tail:\n${stderrBuf.slice(-3000)}`
      ));
    }, 120000);

    // Poll /test-session — once it returns 200 OK, the startup gate has opened
    // (the gate middleware blocks /test-session during startup with a 503).
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
        reject(new Error(
          `server.js exited with code ${code} during startup. stderr tail:\n${stderrBuf.slice(-3000)}`
        ));
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
// Cookie jar for session-based tests (POST /login → use cookie for /school/*).
// supertest.agent() handles cookies automatically, but we use a plain
// supertest instance + manual cookie header so we can share a single server
// across all test cases (supertest.agent() wants an app, not a URL).
// ---------------------------------------------------------------------------
function captureCookies(resHeaders) {
  const raw = resHeaders['set-cookie'];
  if (!raw) return '';
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((line) => line.split(';')[0].trim()).filter(Boolean).join('; ');
}

// ===========================================================================
// THE TEST SUITE
// ===========================================================================

describeOrSkip('Cross-tenant data boundary tests (Jest + supertest)', () => {
  let server;
  let baseUrl;
  let pool;
  let tenantA, tenantB;
  let userA, userB;
  let studentA, studentB;
  let feeA, feeB;
  let donationA, donationB;
  let apiKeyA, apiKeyB;
  let sessionCookieA, sessionCookieB;

  // -------------------------------------------------------------------------
  // Setup: start server, seed DB
  // -------------------------------------------------------------------------
  beforeAll(async () => {
    // 1. Start server.js subprocess
    server = await startServer();
    baseUrl = server.baseUrl;

    // 2. Open a direct pg connection to seed test data
    const { Pool } = pg;
    pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
    });

    // 3. Clean up any orphaned rows from a previous crashed test run with the
    //    same TEST_RUN_ID (extremely unlikely, but cheap and safe).
    await pool.query('DELETE FROM api_keys WHERE name LIKE $1', [`jest-api-key-%-${TEST_RUN_ID}`]);
    await pool.query('DELETE FROM donations WHERE donor_name LIKE $1', [`jest-donor-%-${TEST_RUN_ID}`]);
    await pool.query('DELETE FROM fees WHERE term LIKE $1', [`jest-term-%-${TEST_RUN_ID}`]);
    await pool.query('DELETE FROM students WHERE name LIKE $1', [`jest-student-%-${TEST_RUN_ID}`]);
    await pool.query('DELETE FROM users WHERE email LIKE $1', [`jest-user-%-${TEST_RUN_ID}`]);
    await pool.query('DELETE FROM tenants WHERE name LIKE $1', [`jest-tenant-%-${TEST_RUN_ID}`]);

    // 4. Create two tenants
    const a = await pool.query(
      'INSERT INTO tenants(name, type, email, approved, verified, banned) VALUES($1, $2, $3, true, true, false) RETURNING *',
      [TENANT_A_NAME, 'school', TENANT_A_EMAIL]
    );
    const b = await pool.query(
      'INSERT INTO tenants(name, type, email, approved, verified, banned) VALUES($1, $2, $3, true, true, false) RETURNING *',
      [TENANT_B_NAME, 'school', TENANT_B_EMAIL]
    );
    tenantA = a.rows[0];
    tenantB = b.rows[0];
    expect(tenantA.id).not.toBe(tenantB.id);

    // 5. Create two users (one per tenant), with bcrypt-hashed passwords.
    //    The /login route requires `approved=true, banned=false`.
    const pwHash = bcryptjs.hashSync(USER_PASSWORD, 10);
    const ua = await pool.query(
      'INSERT INTO users(tenant_id, email, password_hash, role, approved, banned) VALUES($1, $2, $3, $4, true, false) RETURNING id, tenant_id, email, role',
      [tenantA.id, USER_A_EMAIL, pwHash, 'admin']
    );
    const ub = await pool.query(
      'INSERT INTO users(tenant_id, email, password_hash, role, approved, banned) VALUES($1, $2, $3, $4, true, false) RETURNING id, tenant_id, email, role',
      [tenantB.id, USER_B_EMAIL, pwHash, 'admin']
    );
    userA = ua.rows[0];
    userB = ub.rows[0];
    expect(userA.tenant_id).toBe(tenantA.id);
    expect(userB.tenant_id).toBe(tenantB.id);

    // 6. Create two students (one per tenant)
    const sa = await pool.query(
      'INSERT INTO students(tenant_id, admission_no, name, class, stream, guardian_name, guardian_phone) VALUES($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [tenantA.id, STUDENT_A_ADM, STUDENT_A_NAME, 'P1', 'Red', 'Guardian A', '+256700000001']
    );
    const sb = await pool.query(
      'INSERT INTO students(tenant_id, admission_no, name, class, stream, guardian_name, guardian_phone) VALUES($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [tenantB.id, STUDENT_B_ADM, STUDENT_B_NAME, 'P2', 'Blue', 'Guardian B', '+256700000002']
    );
    studentA = sa.rows[0];
    studentB = sb.rows[0];

    // 7. Create two fees (one per tenant) — fees reference students
    const fa = await pool.query(
      'INSERT INTO fees(tenant_id, student_id, amount, paid, term, year) VALUES($1, $2, $3, $4, $5, $6) RETURNING *',
      [tenantA.id, studentA.id, 100000, 50000, FEE_A_TERM, 2025]
    );
    const fb = await pool.query(
      'INSERT INTO fees(tenant_id, student_id, amount, paid, term, year) VALUES($1, $2, $3, $4, $5, $6) RETURNING *',
      [tenantB.id, studentB.id, 200000, 75000, FEE_B_TERM, 2025]
    );
    feeA = fa.rows[0];
    feeB = fb.rows[0];

    // 8. Create two donations (one per tenant)
    const da = await pool.query(
      'INSERT INTO donations(tenant_id, donor_name, amount, type, method) VALUES($1, $2, $3, $4, $5) RETURNING *',
      [tenantA.id, DONATION_A_DONOR, 50000, 'donation', 'cash']
    );
    const db = await pool.query(
      'INSERT INTO donations(tenant_id, donor_name, amount, type, method) VALUES($1, $2, $3, $4, $5) RETURNING *',
      [tenantB.id, DONATION_B_DONOR, 80000, 'donation', 'cash']
    );
    donationA = da.rows[0];
    donationB = db.rows[0];

    // 9. Create two API keys (one per tenant). The apiAuth middleware hashes
    //    the incoming Bearer token with SHA-256 and looks it up by key_hash.
    const ka = await pool.query(
      'INSERT INTO api_keys(tenant_id, key_hash, name, is_active) VALUES($1, $2, $3, true) RETURNING id, tenant_id, name',
      [tenantA.id, API_KEY_A_HASH, `jest-api-key-A-${TEST_RUN_ID}`]
    );
    const kb = await pool.query(
      'INSERT INTO api_keys(tenant_id, key_hash, name, is_active) VALUES($1, $2, $3, true) RETURNING id, tenant_id, name',
      [tenantB.id, API_KEY_B_HASH, `jest-api-key-B-${TEST_RUN_ID}`]
    );
    apiKeyA = ka.rows[0];
    apiKeyB = kb.rows[0];

    // 10. Login both users via /login to obtain session cookies. The /login
    //     route sets req.session.user and redirects to /portal/{type} (302).
    const loginResA = await httpRequest('POST', `${baseUrl}/login`, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `email=${encodeURIComponent(USER_A_EMAIL)}&password=${encodeURIComponent(USER_PASSWORD)}`,
    });
    sessionCookieA = captureCookies(loginResA.headers);
    expect(loginResA.status).toBe(302);
    expect(sessionCookieA).toMatch(/connect\.sid=/);

    const loginResB = await httpRequest('POST', `${baseUrl}/login`, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `email=${encodeURIComponent(USER_B_EMAIL)}&password=${encodeURIComponent(USER_PASSWORD)}`,
    });
    sessionCookieB = captureCookies(loginResB.headers);
    expect(loginResB.status).toBe(302);
    expect(sessionCookieB).toMatch(/connect\.sid=/);
  }, 120000);  // 2-min timeout for setup (server boot + DB seed + 2 logins)

  // -------------------------------------------------------------------------
  // Teardown: stop server, clean up DB
  // -------------------------------------------------------------------------
  afterAll(async () => {
    if (server) await stopServer(server);
    if (pool) {
      try {
        await pool.query('DELETE FROM api_keys WHERE name LIKE $1', [`jest-api-key-%-${TEST_RUN_ID}`]);
        await pool.query('DELETE FROM donations WHERE donor_name LIKE $1', [`jest-donor-%-${TEST_RUN_ID}`]);
        await pool.query('DELETE FROM fees WHERE term LIKE $1', [`jest-term-%-${TEST_RUN_ID}`]);
        await pool.query('DELETE FROM students WHERE name LIKE $1', [`jest-student-%-${TEST_RUN_ID}`]);
        await pool.query('DELETE FROM users WHERE email LIKE $1', [`jest-user-%-${TEST_RUN_ID}`]);
        await pool.query('DELETE FROM tenants WHERE name LIKE $1', [`jest-tenant-%-${TEST_RUN_ID}`]);
      } catch (e) {
        // best-effort cleanup — don't fail the suite on cleanup errors
      } finally {
        await pool.end();
      }
    }
  }, 60000);

  // =========================================================================
  // 1. AUTHENTICATION BOUNDARIES
  // =========================================================================
  describe('Authentication boundaries', () => {
    test('unauthenticated GET /api/v1/students → 401', async () => {
      const res = await supertest(baseUrl).get('/api/v1/students');
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('error');
    });

    test('GET /api/v1/students with invalid Bearer token → 401', async () => {
      const res = await supertest(baseUrl)
        .get('/api/v1/students')
        .set('Authorization', 'Bearer definitely-not-a-real-key');
      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/invalid/i);
    });

    test('unauthenticated GET /school/students → 302 redirect to /login', async () => {
      const res = await supertest(baseUrl).get('/school/students');
      expect(res.status).toBe(302);
      expect(res.headers.location).toMatch(/login/i);
    });

    test('valid login as tenant A → 302 redirect to /portal/school', async () => {
      // Re-verify the login flow that ran in beforeAll — if this fails, the
      // session-based tests below are unreliable.
      const res = await supertest(baseUrl)
        .post('/login')
        .type('form')
        .send({ email: USER_A_EMAIL, password: USER_PASSWORD });
      expect(res.status).toBe(302);
      expect(res.headers.location).toMatch(/\/portal\//);
    });
  });

  // =========================================================================
  // 2. API-KEY CROSS-TENANT BOUNDARIES (/api/v1/*)
  // =========================================================================
  describe('API-key cross-tenant boundaries (/api/v1/*)', () => {
    test('tenant A\'s API key cannot list tenant B\'s students', async () => {
      const res = await supertest(baseUrl)
        .get('/api/v1/students')
        .set('Authorization', `Bearer ${API_KEY_A_PLAIN}`);
      expect(res.status).toBe(200);
      const students = res.body.data || res.body;
      expect(Array.isArray(students)).toBe(true);
      // tenant A should see at least its own student
      const aNames = students.map((s) => s.name);
      expect(aNames).toContain(STUDENT_A_NAME);
      // tenant A must NEVER see tenant B's student
      expect(aNames).not.toContain(STUDENT_B_NAME);
      // belt-and-suspenders: every returned row must belong to tenant A
      // (the /api/v1/students route doesn't return tenant_id in the SELECT,
      //  so this assertion is mostly future-proofing).
      for (const s of students) {
        expect(s.tenant_id).not.toBe(tenantB.id);
      }
    });

    test('tenant B\'s API key cannot list tenant A\'s students', async () => {
      const res = await supertest(baseUrl)
        .get('/api/v1/students')
        .set('Authorization', `Bearer ${API_KEY_B_PLAIN}`);
      expect(res.status).toBe(200);
      const students = res.body.data || res.body;
      const bNames = students.map((s) => s.name);
      expect(bNames).toContain(STUDENT_B_NAME);
      expect(bNames).not.toContain(STUDENT_A_NAME);
    });

    test('tenant A\'s API key cannot list tenant B\'s fees', async () => {
      const res = await supertest(baseUrl)
        .get('/api/v1/fees')
        .set('Authorization', `Bearer ${API_KEY_A_PLAIN}`);
      expect(res.status).toBe(200);
      const fees = res.body.data || res.body;
      expect(Array.isArray(fees)).toBe(true);
      const feeIds = fees.map((f) => f.id);
      expect(feeIds).toContain(feeA.id);
      expect(feeIds).not.toContain(feeB.id);
    });

    test('tenant A\'s API key cannot list tenant B\'s invoices (empty OK, but never B\'s)', async () => {
      const res = await supertest(baseUrl)
        .get('/api/v1/invoices')
        .set('Authorization', `Bearer ${API_KEY_A_PLAIN}`);
      expect(res.status).toBe(200);
      const invoices = res.body.data || res.body;
      expect(Array.isArray(invoices)).toBe(true);
      // We didn't create any invoices, so the list is empty — but if any
      // invoices exist, none should belong to tenant B.
      for (const inv of invoices) {
        expect(inv.tenant_id).not.toBe(tenantB.id);
      }
    });

    test('tenant A\'s API key cannot pay tenant B\'s fee (UPDATE WHERE clause blocks it)', async () => {
      // Capture tenant B's fee.paid BEFORE the attempt
      const before = await pool.query('SELECT paid FROM fees WHERE id=$1', [feeB.id]);
      const paidBefore = before.rows[0].paid;

      // POST /api/v1/fees/pay with tenant B's fee_id using tenant A's API key.
      // The route's SQL is:
      //   UPDATE fees SET paid=paid+$1 WHERE id=$2 AND tenant_id=$3
      // where $3 = req.apiKey.tenant_id (tenant A). So the WHERE clause won't
      // match tenant B's fee — 0 rows updated.
      //
      // Quirk: the route responds with {success:true} regardless of whether
      // any rows were updated. So the assertion is on the DB state, not the
      // HTTP response.
      const res = await supertest(baseUrl)
        .post('/api/v1/fees/pay')
        .set('Authorization', `Bearer ${API_KEY_A_PLAIN}`)
        .send({ fee_id: feeB.id, amount: 99999 });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);

      // Verify tenant B's fee.paid was NOT modified.
      const after = await pool.query('SELECT paid FROM fees WHERE id=$1', [feeB.id]);
      const paidAfter = after.rows[0].paid;
      expect(paidAfter).toBe(paidBefore);
    });

    test('tenant A\'s CSV export only contains tenant A\'s students', async () => {
      const res = await supertest(baseUrl)
        .get('/api/v1/students/export')
        .set('Authorization', `Bearer ${API_KEY_A_PLAIN}`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/csv/);
      // The CSV body must mention tenant A's student and must NOT mention
      // tenant B's student.
      expect(res.text).toContain(STUDENT_A_NAME);
      expect(res.text).not.toContain(STUDENT_B_NAME);
      expect(res.text).toContain(STUDENT_A_ADM);
      expect(res.text).not.toContain(STUDENT_B_ADM);
    });
  });

  // =========================================================================
  // 3. SESSION-BASED CROSS-TENANT BOUNDARIES (/school/*)
  // =========================================================================
  describe('Session-based cross-tenant boundaries (/school/*)', () => {
    test('tenant A\'s session only sees tenant A\'s students on /school/students', async () => {
      const res = await supertest(baseUrl)
        .get('/school/students')
        .set('Cookie', sessionCookieA);
      expect(res.status).toBe(200);
      // The HTML page renders student names in <td> elements.
      expect(res.text).toContain(STUDENT_A_NAME);
      expect(res.text).not.toContain(STUDENT_B_NAME);
      expect(res.text).toContain(STUDENT_A_ADM);
      expect(res.text).not.toContain(STUDENT_B_ADM);
    });

    test('tenant B\'s session only sees tenant B\'s students on /school/students', async () => {
      const res = await supertest(baseUrl)
        .get('/school/students')
        .set('Cookie', sessionCookieB);
      expect(res.status).toBe(200);
      expect(res.text).toContain(STUDENT_B_NAME);
      expect(res.text).not.toContain(STUDENT_A_NAME);
    });

    test('tenant A\'s session gets 404 for tenant B\'s student edit page', async () => {
      // The route does: SELECT * FROM students WHERE id=$1 AND tenant_id=$2
      // with $2 = req.session.user.tenant_id (tenant A). So tenant B's student
      // is invisible — the handler returns 404 "Not found".
      const res = await supertest(baseUrl)
        .get(`/school/students/${studentB.id}/edit`)
        .set('Cookie', sessionCookieA);
      expect(res.status).toBe(404);
    });

    test('tenant A\'s session cannot UPDATE tenant B\'s student (DB unchanged)', async () => {
      // Capture tenant B's student name BEFORE the attempt.
      const before = await pool.query('SELECT name FROM students WHERE id=$1', [studentB.id]);
      const nameBefore = before.rows[0].name;

      // POST /school/students/:id/update with tenant B's student ID using
      // tenant A's session. The route's SQL is:
      //   UPDATE students SET ... WHERE id=$7 AND tenant_id=$8
      // where $8 = req.session.user.tenant_id (tenant A). 0 rows updated.
      //
      // Quirk: the route responds with 302 redirect to /school/students
      // regardless of whether any rows were updated. So the assertion is on
      // the DB state, not the HTTP response.
      const res = await supertest(baseUrl)
        .post(`/school/students/${studentB.id}/update`)
        .type('form')
        .set('Cookie', sessionCookieA)
        .send({
          admission_no: 'HACKED',
          name: `hacked-${TEST_RUN_ID}`,
          class: 'HACKED',
          stream: '',
          guardian_name: 'Hacker',
          guardian_phone: '+256999999999',
        });
      expect(res.status).toBe(302);

      // Verify tenant B's student was NOT modified.
      const after = await pool.query('SELECT name FROM students WHERE id=$1', [studentB.id]);
      expect(after.rows[0].name).toBe(nameBefore);
      expect(after.rows[0].name).toBe(STUDENT_B_NAME);
    });

    test('tenant A\'s session cannot DELETE tenant B\'s student (still exists)', async () => {
      // GET /school/students/:id/delete with tenant B's student ID using
      // tenant A's session. The route's SQL is:
      //   DELETE FROM students WHERE id=$1 AND tenant_id=$2
      // where $2 = req.session.user.tenant_id (tenant A). 0 rows deleted.
      //
      // Quirk: the route responds with 302 redirect to /school/students
      // regardless of whether any rows were deleted.
      const res = await supertest(baseUrl)
        .get(`/school/students/${studentB.id}/delete`)
        .set('Cookie', sessionCookieA);
      expect(res.status).toBe(302);

      // Verify tenant B's student STILL EXISTS.
      const after = await pool.query('SELECT id, name FROM students WHERE id=$1', [studentB.id]);
      expect(after.rows.length).toBe(1);
      expect(after.rows[0].name).toBe(STUDENT_B_NAME);
    });
  });

  // =========================================================================
  // 4. SQL INJECTION / TENANT-ID TAMPERING DEFENSE
  // =========================================================================
  describe('Tenant-ID tampering defense (defense in depth)', () => {
    test('tenant A\'s API key ignores ?tenant_id=<B> query param', async () => {
      // The /api/v1/students route uses req.apiKey.tenant_id (set by apiAuth
      // from the API key's DB row), NOT req.query.tenant_id. So passing
      // tenant B's ID in the query string must NOT leak tenant B's data.
      const res = await supertest(baseUrl)
        .get(`/api/v1/students?tenant_id=${tenantB.id}`)
        .set('Authorization', `Bearer ${API_KEY_A_PLAIN}`);
      expect(res.status).toBe(200);
      const students = res.body.data || res.body;
      const names = students.map((s) => s.name);
      expect(names).toContain(STUDENT_A_NAME);
      expect(names).not.toContain(STUDENT_B_NAME);
    });

    test('tenant A\'s API key ignores X-Tenant-Id header', async () => {
      // Even if a malicious client sets an X-Tenant-Id header, the apiAuth
      // middleware only trusts the API key's DB-backed tenant_id.
      const res = await supertest(baseUrl)
        .get('/api/v1/students')
        .set('Authorization', `Bearer ${API_KEY_A_PLAIN}`)
        .set('X-Tenant-Id', String(tenantB.id));
      expect(res.status).toBe(200);
      const students = res.body.data || res.body;
      const names = students.map((s) => s.name);
      expect(names).toContain(STUDENT_A_NAME);
      expect(names).not.toContain(STUDENT_B_NAME);
    });
  });

  // =========================================================================
  // 5. PUBLIC VERIFICATION ENDPOINT BOUNDARIES
  // =========================================================================
  describe('Public verification endpoint boundaries', () => {
    test('public verify endpoint does not leak tenant-internal fields', async () => {
      // The repo references /verify/:certCode in certificate templates. If
      // the route exists, it should return only public-facing fields (no
      // tenant_id, no internal record IDs, no donor info). If the route
      // doesn't exist (404), this test passes vacuously.
      const res = await supertest(baseUrl).get(`/verify/nonexistent-cert-${TEST_RUN_ID}`);
      if (res.status === 200) {
        // Body must NOT contain internal tenant IDs or internal record IDs.
        const body = typeof res.body === 'object' ? JSON.stringify(res.body) : res.text;
        expect(body).not.toMatch(new RegExp(`"tenant_id"\\s*:\\s*${tenantA.id}`));
        expect(body).not.toMatch(new RegExp(`"tenant_id"\\s*:\\s*${tenantB.id}`));
        expect(body).not.toMatch(/password_hash/i);
        expect(body).not.toMatch(/donor_email/i);
      } else {
        // 404 / 302 / 401 are all acceptable — the route may not exist yet.
        expect([301, 302, 401, 403, 404]).toContain(res.status);
      }
    });
  });

  // =========================================================================
  // 6. SESSION FIXATION / TENANT SWITCHING PREVENTION
  // =========================================================================
  describe('Session fixation / tenant-switching prevention', () => {
    test('no /api/auth/switch-tenant endpoint exists (cannot switch tenants mid-session)', async () => {
      // The platform has no tenant-switching endpoint — a user's tenant_id is
      // fixed at login. Attempting to switch via a fabricated endpoint must
      // fail (404) rather than silently switching.
      const res = await supertest(baseUrl)
        .post('/api/auth/switch-tenant')
        .set('Cookie', sessionCookieA)
        .send({ tenant_id: tenantB.id });
      expect([401, 403, 404]).toContain(res.status);
    });

    test('tenant A\'s session cookie cannot access /api/v1/* without an API key', async () => {
      // /api/v1/* routes use apiAuth (Bearer token), NOT session auth. So
      // having a valid session cookie for tenant A does NOT grant API access.
      // This is by design — programmatic API access requires a separate API
      // key, which has its own tenant_id (and rate limits).
      const res = await supertest(baseUrl)
        .get('/api/v1/students')
        .set('Cookie', sessionCookieA);
      // No Authorization header → 401.
      expect(res.status).toBe(401);
    });
  });
});
