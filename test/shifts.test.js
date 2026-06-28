/**
 * Shift scheduling module tests (Gap 5)
 *
 * Tests the route module factory + the pure helpers (recurrence rules and
 * date/time validation) without needing a real database or HTTP server.
 *
 * Uses Node's built-in node:test runner (consistent with the other test
 * files in this repo — see test/README.md).
 *
 * Run via: node --test test/shifts.test.js
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const express = require('express');

const shiftsFactory = require('../src/routes/shifts');
const { shouldApplyOnDay, validateShiftTimes, validateTimeOffDates } = shiftsFactory;

// ---------------------------------------------------------------------------
// Minimal mock ctx — mirrors the shape that server.js's _routeSharedCtx
// passes to every extracted route module, but with no-op implementations
// so the factory can be exercised without a DB.
// ---------------------------------------------------------------------------
function makeMockCtx(overrides = {}) {
  return {
    pool: {
      query: async () => ({ rows: [], rowCount: 0 }),
    },
    ah: (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next),
    requireAuth: (req, res, next) => next(),
    requireSubscription: () => (req, res, next) => next(),
    audit: () => {},
    esc: (s) => String(s == null ? '' : s)
      .replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])),
    ...overrides,
  };
}

// ===========================================================================
// 1. MODULE FACTORY
// ===========================================================================
describe('Shifts route module factory', () => {
  test('exports a function', () => {
    assert.strictEqual(typeof shiftsFactory, 'function');
  });

  test('returns an Express Router when called with a ctx', () => {
    const router = shiftsFactory(makeMockCtx());
    assert.ok(router, 'factory should return a router');
    // Express Router instances expose .handle, .use, .get, .post, etc.
    assert.strictEqual(typeof router.handle, 'function');
    assert.strictEqual(typeof router.get, 'function');
    assert.strictEqual(typeof router.post, 'function');
    assert.strictEqual(typeof router.put, 'function');
    assert.strictEqual(typeof router.delete, 'function');
  });

  test('works without ctx.requireSubscription (falls back to local definition)', () => {
    // Drop requireSubscription from ctx entirely — module should still
    // construct a working router via the local fallback.
    const ctx = makeMockCtx();
    delete ctx.requireSubscription;
    const router = shiftsFactory(ctx);
    assert.ok(router);
    assert.strictEqual(typeof router.handle, 'function');
  });

  test('exposes pure helper functions as static properties', () => {
    assert.strictEqual(typeof shiftsFactory.shouldApplyOnDay, 'function');
    assert.strictEqual(typeof shiftsFactory.validateShiftTimes, 'function');
    assert.strictEqual(typeof shiftsFactory.validateTimeOffDates, 'function');
  });
});

// ===========================================================================
// 2. RECURRENCE LOGIC — shouldApplyOnDay
// ===========================================================================
// Day-of-week reference (JS Date#getDay):
//   0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
describe('shouldApplyOnDay recurrence rules', () => {
  test("'daily' applies to every day of the week", () => {
    for (let dow = 0; dow <= 6; dow++) {
      assert.ok(shouldApplyOnDay('daily', dow), `daily should apply on day ${dow}`);
    }
  });

  test("'weekdays' applies Mon-Fri only (1..5)", () => {
    assert.ok(!shouldApplyOnDay('weekdays', 0), 'Sunday is not a weekday');
    assert.ok(shouldApplyOnDay('weekdays', 1), 'Monday is a weekday');
    assert.ok(shouldApplyOnDay('weekdays', 2), 'Tuesday is a weekday');
    assert.ok(shouldApplyOnDay('weekdays', 3), 'Wednesday is a weekday');
    assert.ok(shouldApplyOnDay('weekdays', 4), 'Thursday is a weekday');
    assert.ok(shouldApplyOnDay('weekdays', 5), 'Friday is a weekday');
    assert.ok(!shouldApplyOnDay('weekdays', 6), 'Saturday is not a weekday');
  });

  test("'weekends' applies Sat+Sun only (0,6)", () => {
    assert.ok(shouldApplyOnDay('weekends', 0), 'Sunday is a weekend day');
    assert.ok(!shouldApplyOnDay('weekends', 1), 'Monday is not a weekend day');
    assert.ok(!shouldApplyOnDay('weekends', 2));
    assert.ok(!shouldApplyOnDay('weekends', 3));
    assert.ok(!shouldApplyOnDay('weekends', 4));
    assert.ok(!shouldApplyOnDay('weekends', 5));
    assert.ok(shouldApplyOnDay('weekends', 6), 'Saturday is a weekend day');
  });

  test("'weekly' applies only on the specified recurrence_day_of_week", () => {
    // Template configured to recur every Monday (day 1)
    assert.ok(shouldApplyOnDay('weekly', 1, 1), 'Monday template applies on Monday');
    assert.ok(!shouldApplyOnDay('weekly', 2, 1), 'Monday template does NOT apply on Tuesday');
    assert.ok(!shouldApplyOnDay('weekly', 0, 1), 'Monday template does NOT apply on Sunday');

    // Template configured to recur every Sunday (day 0)
    assert.ok(shouldApplyOnDay('weekly', 0, 0));
    assert.ok(!shouldApplyOnDay('weekly', 1, 0));

    // Template configured to recur every Saturday (day 6)
    assert.ok(shouldApplyOnDay('weekly', 6, 6));
    assert.ok(!shouldApplyOnDay('weekly', 5, 6));
  });

  test("'none' never applies", () => {
    for (let dow = 0; dow <= 6; dow++) {
      assert.ok(!shouldApplyOnDay('none', dow), `none should NOT apply on day ${dow}`);
    }
  });

  test('unknown recurrence values default to false (safe default)', () => {
    assert.ok(!shouldApplyOnDay('bogus', 1));
    assert.ok(!shouldApplyOnDay('', 1));
    assert.ok(!shouldApplyOnDay(undefined, 1));
  });
});

// ===========================================================================
// 3. TEMPLATE APPLY — counts the number of shifts generated over a date range
//    by walking the same loop the route handler uses, but counting decisions
//    instead of issuing INSERTs. This is the "generates the right number of
//    shifts" test from the task spec.
// ===========================================================================
describe('Template apply — shift count by recurrence (14-day window)', () => {
  // Use a known 14-day window: 2026-01-04 (Sun) .. 2026-01-17 (Sat)
  //   Sun Jan 4, Mon Jan 5, Tue Jan 6, Wed Jan 7, Thu Jan 8, Fri Jan 9, Sat Jan 10,
  //   Sun Jan 11, Mon Jan 12, Tue Jan 13, Wed Jan 14, Thu Jan 15, Fri Jan 16, Sat Jan 17
  //   = 14 days = 2 Sun, 2 Mon, 2 Tue, 2 Wed, 2 Thu, 2 Fri, 2 Sat
  const FROM = '2026-01-04';
  const TO   = '2026-01-17';

  function countGeneratedShifts(recurrence, recurrenceDayOfWeek) {
    const from = new Date(FROM);
    const to = new Date(TO);
    let count = 0;
    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
      if (shouldApplyOnDay(recurrence, d.getDay(), recurrenceDayOfWeek)) count++;
    }
    return count;
  }

  test("'daily' generates 14 shifts over a 14-day window", () => {
    assert.strictEqual(countGeneratedShifts('daily'), 14);
  });

  test("'weekdays' generates 10 shifts over the 14-day window (2 weeks × 5 weekdays)", () => {
    assert.strictEqual(countGeneratedShifts('weekdays'), 10);
  });

  test("'weekends' generates 4 shifts over the 14-day window (2 weeks × 2 weekend days)", () => {
    assert.strictEqual(countGeneratedShifts('weekends'), 4);
  });

  test("'weekly' (Monday) generates 2 shifts over the 14-day window", () => {
    assert.strictEqual(countGeneratedShifts('weekly', 1), 2);
  });

  test("'weekly' (Sunday) generates 2 shifts over the 14-day window", () => {
    assert.strictEqual(countGeneratedShifts('weekly', 0), 2);
  });

  test("'none' generates 0 shifts", () => {
    assert.strictEqual(countGeneratedShifts('none'), 0);
  });
});

// ===========================================================================
// 4. SHIFT TIME VALIDATION — end_time > start_time
// ===========================================================================
describe('validateShiftTimes — end_time must be after start_time', () => {
  test('accepts a valid shift (start before end)', () => {
    const r = validateShiftTimes('2026-01-15T08:00:00Z', '2026-01-15T12:00:00Z');
    assert.ok(r.ok, JSON.stringify(r));
  });

  test('accepts a shift that spans midnight', () => {
    const r = validateShiftTimes('2026-01-15T22:00:00Z', '2026-01-16T06:00:00Z');
    assert.ok(r.ok);
  });

  test('rejects end_time === start_time (must be strictly after)', () => {
    const r = validateShiftTimes('2026-01-15T08:00:00Z', '2026-01-15T08:00:00Z');
    assert.ok(!r.ok);
    assert.match(r.error, /end_time must be after start_time/);
  });

  test('rejects end_time < start_time', () => {
    const r = validateShiftTimes('2026-01-15T12:00:00Z', '2026-01-15T08:00:00Z');
    assert.ok(!r.ok);
    assert.match(r.error, /end_time must be after start_time/);
  });

  test('rejects missing start_time or end_time', () => {
    assert.ok(!validateShiftTimes(null, '2026-01-15T12:00:00Z').ok);
    assert.ok(!validateShiftTimes('2026-01-15T08:00:00Z', null).ok);
    assert.ok(!validateShiftTimes(undefined, undefined).ok);
  });

  test('rejects unparseable date strings', () => {
    const r = validateShiftTimes('not-a-date', '2026-01-15T12:00:00Z');
    assert.ok(!r.ok);
    assert.match(r.error, /valid ISO dates/);
  });
});

// ===========================================================================
// 5. TIME-OFF DATE VALIDATION — end_date >= start_date
// ===========================================================================
describe('validateTimeOffDates — end_date must be on or after start_date', () => {
  test('accepts a single-day request (start === end)', () => {
    const r = validateTimeOffDates('2026-01-15', '2026-01-15');
    assert.ok(r.ok, JSON.stringify(r));
  });

  test('accepts a multi-day request (end after start)', () => {
    const r = validateTimeOffDates('2026-01-15', '2026-01-20');
    assert.ok(r.ok);
  });

  test('rejects end_date < start_date', () => {
    const r = validateTimeOffDates('2026-01-20', '2026-01-15');
    assert.ok(!r.ok);
    assert.match(r.error, /end_date must be on or after start_date/);
  });

  test('rejects missing start_date or end_date', () => {
    assert.ok(!validateTimeOffDates(null, '2026-01-15').ok);
    assert.ok(!validateTimeOffDates('2026-01-15', null).ok);
    assert.ok(!validateTimeOffDates(undefined, undefined).ok);
  });

  test('rejects unparseable date strings', () => {
    const r = validateTimeOffDates('not-a-date', '2026-01-15');
    assert.ok(!r.ok);
    assert.match(r.error, /valid dates/);
  });

  test('ignores time component (same calendar date passes even with different times)', () => {
    // "2026-01-15T08:00" and "2026-01-15T20:00" are the same calendar date —
    // a same-day time-off request should pass.
    const r = validateTimeOffDates('2026-01-15T08:00:00Z', '2026-01-15T20:00:00Z');
    assert.ok(r.ok, JSON.stringify(r));
  });
});

// ===========================================================================
// 6. END-TO-END ROUTE INTEGRATION (lightweight)
//    Spin up an Express app with the shifts router and verify the validation
//    gates return 400 for bad input. Uses supertest-style direct HTTP via
//    node:http — no external deps.
// ===========================================================================
describe('Route integration — validation gates', () => {
  let app, server, baseUrl;

  function startApp() {
    return new Promise((resolve) => {
      const ctx = makeMockCtx({
        // Mock pool.query so INSERT/SELECT/UPDATE/DELETE all succeed
        // without touching a real DB. The first call (templates lookup)
        // returns one template; subsequent INSERTs return one shift row.
        pool: {
          query: async (sql, params) => {
            // /templates/:id/apply SELECT
            if (/SELECT \* FROM shift_templates/.test(sql)) {
              return {
                rows: [{
                  id: 1,
                  tenant_id: 1,
                  name: 'Morning',
                  start_time: '08:00',
                  end_time: '12:00',
                  break_minutes: 30,
                  role: 'cashier',
                  location: 'Store A',
                  recurrence: 'daily',
                  is_active: true,
                }],
              };
            }
            // INSERT (shifts, shift_templates, time_off_requests)
            if (/^INSERT INTO/.test(sql.trim())) {
              return { rows: [{ id: 1, tenant_id: 1 }], rowCount: 1 };
            }
            // Default: empty result set
            return { rows: [], rowCount: 0 };
          },
        },
        // requireAuth: stub a fake user into req.session
        requireAuth: (req, res, next) => {
          req.session = req.session || {};
          req.session.user = { id: 1, email: 'owner@example.com', tenant_id: 1, role: 'owner' };
          next();
        },
        requireSubscription: () => (req, res, next) => next(),
        audit: () => {},
      });

      const expressApp = express();
      expressApp.use(express.json());
      // Stub session middleware — required by the requireAuth stub above
      expressApp.use((req, res, next) => { req.session = {}; next(); });
      expressApp.use('/api/shifts', shiftsFactory(ctx));

      const srv = expressApp.listen(0, '127.0.0.1', () => {
        const { port } = srv.address();
        resolve({ app: expressApp, server: srv, baseUrl: `http://127.0.0.1:${port}` });
      });
    });
  }

  function httpRequest(method, url, body) {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const bodyStr = body != null ? JSON.stringify(body) : null;
      const opts = {
        method,
        hostname: urlObj.hostname,
        port: urlObj.port,
        path: urlObj.pathname + urlObj.search,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': bodyStr ? Buffer.byteLength(bodyStr) : 0,
        },
      };
      const req = require('node:http').request(opts, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      });
      req.on('error', reject);
      req.setTimeout(5000, () => req.destroy(new Error('timeout')));
      if (bodyStr) req.write(bodyStr);
      req.end();
    });
  }

  test('POST /api/shifts rejects end_time <= start_time with 400', async () => {
    const s = await startApp();
    try {
      const res = await httpRequest('POST', `${s.baseUrl}/api/shifts`, {
        employee_id: 1,
        employee_name: 'Alice',
        start_time: '2026-01-15T12:00:00Z',
        end_time: '2026-01-15T08:00:00Z', // before start
      });
      assert.strictEqual(res.status, 400);
      const body = JSON.parse(res.body);
      assert.match(body.error, /end_time must be after start_time/);
    } finally {
      s.server.close();
    }
  });

  test('POST /api/shifts rejects missing required fields with 400', async () => {
    const s = await startApp();
    try {
      const res = await httpRequest('POST', `${s.baseUrl}/api/shifts`, {
        // missing employee_id, employee_name, start_time, end_time
        location: 'Store A',
      });
      assert.strictEqual(res.status, 400);
      const body = JSON.parse(res.body);
      assert.match(body.error, /required/);
    } finally {
      s.server.close();
    }
  });

  test('POST /api/shifts/time-off rejects end_date < start_date with 400', async () => {
    const s = await startApp();
    try {
      const res = await httpRequest('POST', `${s.baseUrl}/api/shifts/time-off`, {
        employee_id: 1,
        employee_name: 'Alice',
        start_date: '2026-01-20',
        end_date: '2026-01-15', // before start
        reason: 'Vacation',
      });
      assert.strictEqual(res.status, 400);
      const body = JSON.parse(res.body);
      assert.match(body.error, /end_date must be on or after start_date/);
    } finally {
      s.server.close();
    }
  });

  test('POST /api/shifts accepts a valid shift and returns 201', async () => {
    const s = await startApp();
    try {
      const res = await httpRequest('POST', `${s.baseUrl}/api/shifts`, {
        employee_id: 1,
        employee_name: 'Alice',
        start_time: '2026-01-15T08:00:00Z',
        end_time: '2026-01-15T12:00:00Z',
        location: 'Store A',
        role: 'cashier',
      });
      assert.strictEqual(res.status, 201, `expected 201, got ${res.status}: ${res.body}`);
    } finally {
      s.server.close();
    }
  });

  test('GET /api/shifts/week/:date rejects an invalid date with 400', async () => {
    const s = await startApp();
    try {
      const res = await httpRequest('GET', `${s.baseUrl}/api/shifts/week/not-a-date`);
      assert.strictEqual(res.status, 400);
      const body = JSON.parse(res.body);
      assert.match(body.error, /Invalid date format/);
    } finally {
      s.server.close();
    }
  });

  test('POST /api/shifts/templates/:id/apply with daily template generates shifts', async () => {
    const s = await startApp();
    try {
      // 7-day window — daily recurrence → 7 shifts
      const res = await httpRequest('POST', `${s.baseUrl}/api/shifts/templates/1/apply`, {
        employee_id: 1,
        employee_name: 'Alice',
        from_date: '2026-01-04',
        to_date: '2026-01-10',
      });
      assert.strictEqual(res.status, 200, `expected 200, got ${res.status}: ${res.body}`);
      const body = JSON.parse(res.body);
      // 7 days × daily recurrence = 7 shifts
      assert.strictEqual(body.count, 7, `expected 7 shifts, got ${body.count}`);
      assert.strictEqual(body.shifts.length, 7);
    } finally {
      s.server.close();
    }
  });
});
