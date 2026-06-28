/**
 * Stripe Connect onboarding tests (Gap 7)
 *
 * Tests the route module factory (without making real API calls to Stripe)
 * and the webhook helper functions (handleAccountUpdated,
 * handleAccountDeauthorized) directly with a mock pg pool.
 *
 * Uses Node's built-in node:test runner (consistent with the other tests
 * in this directory). For routes that require an HTTP round-trip, we use
 * supertest (already a devDependency) with a minimal Express app that
 * mounts only the stripe-connect router.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const request = require('supertest');

// Path to the module under test.
const MODULE_PATH = require.resolve('../src/routes/stripe-connect');

// Snapshot of STRIPE_SECRET_KEY so we can restore it after each test that
// manipulates the env var. Clearing the env var (and the require cache)
// is the only way to make the factory load with stripe === null.
const SAVED_STRIPE_KEY = process.env.STRIPE_SECRET_KEY;

function clearModuleCache() {
  delete require.cache[MODULE_PATH];
}

function restoreStripeKey() {
  if (SAVED_STRIPE_KEY === undefined) {
    delete process.env.STRIPE_SECRET_KEY;
  } else {
    process.env.STRIPE_SECRET_KEY = SAVED_STRIPE_KEY;
  }
  clearModuleCache();
}

// Build a mock pg pool that records every query it receives. Each query
// is stored in `calls` as { sql, params }. The `nextResult` field lets a
// test control what the next query() call returns (e.g. a tenant row).
function makeMockPool(nextResult) {
  const calls = [];
  const pool = {
    calls,
    query: async function (sql, params) {
      calls.push({ sql, params: params || [] });
      if (typeof nextResult === 'function') return nextResult({ sql, params: params || [] });
      if (nextResult) return nextResult;
      return { rows: [], rowCount: 0 };
    },
  };
  return pool;
}

// Build a minimal ctx object that matches the shape the route factory
// expects (see server.js _routeSharedCtx). requireAuth is stubbed to
// call next() so the tests can hit the protected routes.
function makeMockCtx(pool) {
  return {
    pool,
    ah: (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next),
    requireAuth: (req, res, next) => next(),
    requireSuperAdmin: (req, res, next) => next(),
    audit: async () => {},
  };
}

describe('stripe-connect route module factory', () => {
  beforeEach(() => { clearModuleCache(); });
  afterEach(() => { restoreStripeKey(); });

  test('exports a function that returns an Express Router', () => {
    delete process.env.STRIPE_SECRET_KEY;
    const factory = require('../src/routes/stripe-connect');
    assert.strictEqual(typeof factory, 'function', 'module.exports should be a function');

    const router = factory(makeMockCtx(makeMockPool()));
    assert.ok(router, 'factory should return a router');
    // Express Router instances expose a `handle` function.
    assert.strictEqual(typeof router.handle, 'function');
  });

  test('factory exposes handleAccountUpdated and handleAccountDeauthorized for testing', () => {
    delete process.env.STRIPE_SECRET_KEY;
    const factory = require('../src/routes/stripe-connect');
    assert.strictEqual(typeof factory.handleAccountUpdated, 'function');
    assert.strictEqual(typeof factory.handleAccountDeauthorized, 'function');
  });

  test('POST /start returns 503 when STRIPE_SECRET_KEY is not set', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const factory = require('../src/routes/stripe-connect');
    const router = factory(makeMockCtx(makeMockPool()));

    const app = express();
    app.use(express.json());
    app.use('/api/stripe-connect', router);

    const res = await request(app)
      .post('/api/stripe-connect/start')
      .set('Content-Type', 'application/json')
      .send({});

    assert.strictEqual(res.status, 503);
    assert.match(res.body.error, /Stripe not configured/i);
  });

  test('GET /status returns { connected: false } when tenant has no stripe_account_id', async () => {
    // For /status to even reach the tenant lookup, the requireStripe
    // middleware must pass — so we set a fake STRIPE_SECRET_KEY. The
    // stripe SDK is loaded but no API call is made because the tenant
    // row's stripe_account_id is null and we don't pass ?refresh=true.
    process.env.STRIPE_SECRET_KEY = 'sk_test_fake_key_for_unit_test';
    const factory = require('../src/routes/stripe-connect');

    // Mock pool: the first query (SELECT tenant) returns a row with no
    // stripe_account_id. /status should short-circuit with connected:false.
    const pool = makeMockPool(({ sql }) => {
      if (/SELECT.*stripe_account_id/i.test(sql)) {
        return {
          rows: [{
            stripe_account_id: null,
            stripe_onboarding_complete: false,
            stripe_charges_enabled: false,
            stripe_payouts_enabled: false,
            stripe_details_submitted: false,
          }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const router = factory(makeMockCtx(pool));
    const app = express();
    app.use(express.json());
    app.use('/api/stripe-connect', router);

    // Fake session — requireAuth is stubbed to call next(), but the
    // handler reads req.session.user.tenant_id, so we set it.
    app.use((req, _res, next) => {
      req.session = { user: { tenant_id: 42 } };
      next();
    });
    // Re-mount after the session middleware so it runs first.
    // (Express runs middleware in registration order — the session
    //  stub above is registered AFTER the router, so we need to mount
    //  the router on a fresh app instead.)

    const app2 = express();
    app2.use(express.json());
    app2.use((req, _res, next) => {
      req.session = { user: { tenant_id: 42 } };
      next();
    });
    app2.use('/api/stripe-connect', router);

    const res = await request(app2)
      .get('/api/stripe-connect/status')
      .set('Accept', 'application/json');

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, { connected: false });
  });
});

describe('handleAccountUpdated', () => {
  beforeEach(() => { clearModuleCache(); });
  afterEach(() => { restoreStripeKey(); });

  test('updates the tenant record and writes an audit row', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const factory = require('../src/routes/stripe-connect');

    const pool = makeMockPool();
    const account = {
      id: 'acct_1QXYABCDEFGHIJKLMNOP',
      metadata: { tenant_id: '7' },
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
      requirements: { currently_due: [] },
    };

    await factory.handleAccountUpdated(account, pool);

    // Should have issued exactly two queries:
    //   1. UPDATE tenants SET ... WHERE stripe_account_id = $5
    //   2. INSERT INTO stripe_connect_audit ...
    assert.strictEqual(pool.calls.length, 2, 'expected exactly two queries');

    const updateCall = pool.calls[0];
    assert.match(updateCall.sql, /UPDATE tenants SET/i);
    assert.match(updateCall.sql, /stripe_charges_enabled/i);
    assert.match(updateCall.sql, /stripe_payouts_enabled/i);
    assert.match(updateCall.sql, /stripe_details_submitted/i);
    assert.match(updateCall.sql, /stripe_onboarding_complete/i);
    assert.match(updateCall.sql, /WHERE stripe_account_id = \$5/i);
    assert.strictEqual(updateCall.params[0], true, 'charges_enabled');
    assert.strictEqual(updateCall.params[1], true, 'payouts_enabled');
    assert.strictEqual(updateCall.params[2], true, 'details_submitted');
    assert.strictEqual(updateCall.params[3], true, 'onboarding_complete');
    assert.strictEqual(updateCall.params[4], account.id, 'account_id');

    const auditCall = pool.calls[1];
    assert.match(auditCall.sql, /INSERT INTO stripe_connect_audit/i);
    assert.strictEqual(auditCall.params[0], 7, 'tenant_id');
    assert.strictEqual(auditCall.params[1], account.id, 'account_id');
    // details is a JSON string — parse it and verify the shape.
    const details = JSON.parse(auditCall.params[2]);
    assert.strictEqual(details.charges_enabled, true);
    assert.strictEqual(details.payouts_enabled, true);
    assert.strictEqual(details.details_submitted, true);
    assert.deepStrictEqual(details.requirements_currently_due, []);
  });

  test('no-ops when account metadata has no tenant_id', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const factory = require('../src/routes/stripe-connect');

    const pool = makeMockPool();
    const account = {
      id: 'acct_orphan',
      metadata: {}, // no tenant_id
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: false,
      requirements: { currently_due: ['individual.verification.document'] },
    };

    await factory.handleAccountUpdated(account, pool);
    assert.strictEqual(pool.calls.length, 0, 'should not issue any queries');
  });
});

describe('handleAccountDeauthorized', () => {
  beforeEach(() => { clearModuleCache(); });
  afterEach(() => { restoreStripeKey(); });

  test('clears all stripe_* fields on the tenant and writes an audit row', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const factory = require('../src/routes/stripe-connect');

    const pool = makeMockPool();
    const account = {
      id: 'acct_1QXYABCDEFGHIJKLMNOP',
      metadata: { tenant_id: '99' },
    };

    await factory.handleAccountDeauthorized(account, pool);

    // Two queries: UPDATE + INSERT audit.
    assert.strictEqual(pool.calls.length, 2, 'expected exactly two queries');

    const updateCall = pool.calls[0];
    assert.match(updateCall.sql, /UPDATE tenants SET/i);
    assert.match(updateCall.sql, /stripe_account_id = NULL/i);
    assert.match(updateCall.sql, /stripe_onboarding_complete = false/i);
    assert.match(updateCall.sql, /stripe_charges_enabled = false/i);
    assert.match(updateCall.sql, /stripe_payouts_enabled = false/i);
    assert.match(updateCall.sql, /stripe_details_submitted = false/i);
    assert.match(updateCall.sql, /WHERE stripe_account_id = \$1/i);
    assert.strictEqual(updateCall.params[0], account.id);

    const auditCall = pool.calls[1];
    assert.match(auditCall.sql, /INSERT INTO stripe_connect_audit/i);
    assert.strictEqual(auditCall.params[0], 99, 'tenant_id');
    assert.strictEqual(auditCall.params[1], account.id, 'account_id');
  });

  test('no-ops when account metadata has no tenant_id', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const factory = require('../src/routes/stripe-connect');

    const pool = makeMockPool();
    const account = { id: 'acct_orphan', metadata: {} };

    await factory.handleAccountDeauthorized(account, pool);
    assert.strictEqual(pool.calls.length, 0, 'should not issue any queries');
  });
});
