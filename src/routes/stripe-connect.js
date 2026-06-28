// src/routes/stripe-connect.js
//
// Stripe Connect onboarding flow for tenants (Gap 7).
//
// Each tenant (school, hospital, business) connects their OWN Stripe account
// so donations/payments can be routed directly to their bank account, minus
// the platform fee (0.5% fundraising, 3% POS, 1% school fees — see
// src/lib/platform-fee.js).
//
// Flow:
//   1. Tenant admin clicks "Connect Stripe" → POST /api/stripe-connect/start
//   2. Backend creates a Stripe Connect Express Account and returns an
//      onboarding URL (Stripe-hosted Account Link).
//   3. Tenant completes onboarding on Stripe → redirected back to
//      /settings/payments?stripe_connected=true
//   4. Backend receives webhook (account.updated) → updates tenant's
//      stripe_charges_enabled / stripe_payouts_enabled / etc.
//   5. Subsequent Stripe payments use transfer_data.destination = tenant's
//      stripe_account_id (handled in src/routes/payments-stripe.js, Track B).
//
// Account type: Express
//   Express is the lowest-friction Stripe Connect account type — Stripe
//   hosts the onboarding form, collects KYC + bank details, and handles
//   payout reconciliation. The platform (us) never sees the tenant's bank
//   account number or tax ID, which keeps our compliance surface small.
//
// Required env vars:
//   - STRIPE_SECRET_KEY               (already used by payments-stripe.js)
//   - STRIPE_CONNECT_WEBHOOK_SECRET   (separate webhook endpoint in the
//                                      Stripe dashboard — DO NOT reuse
//                                      STRIPE_WEBHOOK_SECRET, which is
//                                      for the payment_intent.* events)
//   - BASE_URL                        (for building return_url / refresh_url)
//
// Routes (mounted at /api/stripe-connect in server.js):
//   POST /start             — create Express Account + return onboarding URL
//   GET  /status            — current Stripe Connect status for the tenant
//   GET  /dashboard-link    — Stripe-hosted Express dashboard URL
//   POST /webhook           — Stripe Connect webhook handler (raw body)

const express = require('express');

const factory = module.exports = function (ctx) {
  const { pool, ah, requireAuth, audit } = ctx;
  const router = express.Router();

  // Initialize Stripe lazily so the module can be required without
  // STRIPE_SECRET_KEY set (matches the pattern in payments-stripe.js).
  let stripe = null;
  try {
    const Stripe = require('stripe');
    if (process.env.STRIPE_SECRET_KEY) {
      stripe = Stripe(process.env.STRIPE_SECRET_KEY);
    }
  } catch (e) {
    console.warn('[Stripe Connect] SDK not installed:', e.message);
  }

  // Middleware: 503 if Stripe is not configured.
  const requireStripe = (req, res, next) => {
    if (!stripe) {
      return res.status(503).json({
        error: 'Stripe not configured. Set STRIPE_SECRET_KEY env var.',
      });
    }
    next();
  };

  // -----------------------------------------------------------------------
  // POST /start
  // -----------------------------------------------------------------------
  // Creates a Stripe Express Account for the tenant (if none exists yet)
  // and returns a one-time Account Link URL the tenant must visit to
  // complete onboarding. Idempotent: if the tenant already has an
  // account_id, we just create a fresh onboarding link (the previous one
  // expires after ~48 h).
  router.post('/start', requireAuth, requireStripe, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;

    // Fetch tenant row
    const tenantResult = await pool.query('SELECT * FROM tenants WHERE id = $1', [tid]);
    if (!tenantResult.rows.length) {
      return res.status(404).json({ error: 'Tenant not found' });
    }
    const tenant = tenantResult.rows[0];

    let accountId = tenant.stripe_account_id;

    // Create a new Express account if none exists.
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        metadata: {
          tenant_id: String(tid),
          tenant_name: tenant.name || '',
          platform: 'ssewasswa-api',
        },
      });
      accountId = account.id;

      // Persist the new account_id immediately so we don't lose it if
      // accountLinks.create() below fails. The tenant will still need to
      // complete onboarding before charges/payouts are enabled.
      await pool.query(
        `UPDATE tenants SET stripe_account_id = $1 WHERE id = $2`,
        [accountId, tid]
      );
      try {
        await pool.query(
          `INSERT INTO stripe_connect_audit (tenant_id, event_type, account_id, details)
           VALUES ($1, 'account_created', $2, $3)`,
          [tid, accountId, JSON.stringify({ type: 'express' })]
        );
      } catch (e) {
        console.warn('[Stripe Connect] Could not write audit row:', e.message);
      }
      try { await audit(req, 'stripe_connect_start', { account_id: accountId }); } catch (_) {}
    }

    // Build the onboarding URL. Stripe-hosted — we never see the tenant's
    // bank account number or tax ID. The link is single-use and expires
    // after ~48 h, so this endpoint must be called fresh each time the
    // tenant clicks "Connect Stripe".
    const baseUrl = process.env.BASE_URL || 'https://ssewasswa.onrender.com';
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${baseUrl}/settings/payments?stripe_refresh=true`,
      return_url: `${baseUrl}/settings/payments?stripe_connected=true`,
      type: 'account_onboarding',
    });

    res.json({
      onboarding_url: accountLink.url,
      account_id: accountId,
      expires_at: accountLink.expires_at,
    });
  }));

  // -----------------------------------------------------------------------
  // GET /status
  // -----------------------------------------------------------------------
  // Returns the cached Stripe Connect status for the tenant. Pass
  // ?refresh=true to fetch live status from Stripe (one extra API call).
  router.get('/status', requireAuth, requireStripe, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const tenantResult = await pool.query(
      `SELECT stripe_account_id, stripe_onboarding_complete, stripe_charges_enabled,
              stripe_payouts_enabled, stripe_details_submitted
       FROM tenants WHERE id = $1`,
      [tid]
    );
    if (!tenantResult.rows.length) {
      return res.status(404).json({ error: 'Tenant not found' });
    }
    const t = tenantResult.rows[0];

    if (!t.stripe_account_id) {
      return res.json({ connected: false });
    }

    // Optionally refresh from Stripe (slower but accurate). Useful for
    // the "why isn't my Stripe working?" support flow.
    const liveStatus = req.query.refresh === 'true';
    if (liveStatus) {
      try {
        const account = await stripe.accounts.retrieve(t.stripe_account_id);
        await pool.query(
          `UPDATE tenants SET
             stripe_charges_enabled = $1,
             stripe_payouts_enabled = $2,
             stripe_details_submitted = $3,
             stripe_onboarding_complete = $4
           WHERE id = $5`,
          [
            account.charges_enabled,
            account.payouts_enabled,
            account.details_submitted,
            account.details_submitted,
            tid,
          ]
        );
        return res.json({
          connected: true,
          account_id: t.stripe_account_id,
          onboarding_complete: account.details_submitted,
          charges_enabled: account.charges_enabled,
          payouts_enabled: account.payouts_enabled,
          requirements: account.requirements?.currently_due || [],
        });
      } catch (e) {
        return res.status(500).json({
          error: 'Failed to retrieve account status from Stripe',
          detail: e.message,
        });
      }
    }

    res.json({
      connected: true,
      account_id: t.stripe_account_id,
      onboarding_complete: t.stripe_onboarding_complete,
      charges_enabled: t.stripe_charges_enabled,
      payouts_enabled: t.stripe_payouts_enabled,
      details_submitted: t.stripe_details_submitted,
    });
  }));

  // -----------------------------------------------------------------------
  // GET /dashboard-link
  // -----------------------------------------------------------------------
  // Returns a URL to the Stripe-hosted Express dashboard for the tenant.
  // The tenant can view their payouts, refunds, and balance here without
  // ever leaving the platform's iframe / redirect chain.
  router.get('/dashboard-link', requireAuth, requireStripe, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const tenantResult = await pool.query(
      'SELECT stripe_account_id FROM tenants WHERE id = $1',
      [tid]
    );
    if (!tenantResult.rows.length || !tenantResult.rows[0].stripe_account_id) {
      return res.status(400).json({
        error: 'Stripe account not connected. Call POST /api/stripe-connect/start first.',
      });
    }
    const accountId = tenantResult.rows[0].stripe_account_id;
    const link = await stripe.accounts.createLoginLink(accountId);
    res.json({ url: link.url });
  }));

  // -----------------------------------------------------------------------
  // POST /webhook
  // -----------------------------------------------------------------------
  // Stripe Connect webhook handler (separate from the payment webhook at
  // /api/payments/stripe/webhook). Receives account.* events.
  //
  // MUST be registered with its own webhook signing secret
  // (STRIPE_CONNECT_WEBHOOK_SECRET) — Stripe signs each webhook endpoint
  // with a different secret. DO NOT reuse STRIPE_WEBHOOK_SECRET.
  //
  // Uses express.raw() so Stripe's signature can be verified against the
  // raw bytes. (Same pattern as payments-stripe.js /webhook.)
  router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    if (!stripe) return res.status(503).send('Stripe not configured');

    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
    if (!endpointSecret) {
      console.error('[Stripe Connect Webhook] STRIPE_CONNECT_WEBHOOK_SECRET not configured');
      return res.status(503).send('STRIPE_CONNECT_WEBHOOK_SECRET not configured');
    }

    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
      console.error('[Stripe Connect Webhook] Signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      switch (event.type) {
        case 'account.updated':
          await handleAccountUpdated(event.data.object, pool);
          break;
        case 'account.application.deauthorized':
          await handleAccountDeauthorized(event.data.object, pool);
          break;
        default:
          console.log('[Stripe Connect Webhook] Unhandled event type:', event.type);
      }
      res.json({ received: true });
    } catch (err) {
      console.error('[Stripe Connect Webhook] Handler error:', err);
      res.status(500).json({ error: 'Webhook handler failed' });
    }
  });

  return router;
};

// ============================================================
// Webhook helpers (exported for unit testing)
// ============================================================

/**
 * Handle Stripe `account.updated` events.
 *
 * Stripe fires this whenever the tenant's Connect account changes state —
 * most commonly when onboarding is completed (charges_enabled flips to
 * true) or when Stripe needs more info (requirements.currently_due grows).
 *
 * We mirror the relevant flags onto the tenant row so the dashboard can
 * show "Ready to accept payments" without making a live Stripe API call
 * on every page load.
 */
async function handleAccountUpdated(account, pool) {
  const tenantId = parseInt(account.metadata?.tenant_id || '0', 10);
  if (!tenantId) {
    console.warn(
      '[Stripe Connect Webhook] No tenant_id in account metadata for account',
      account.id
    );
    return;
  }
  await pool.query(
    `UPDATE tenants SET
       stripe_charges_enabled = $1,
       stripe_payouts_enabled = $2,
       stripe_details_submitted = $3,
       stripe_onboarding_complete = $4
     WHERE stripe_account_id = $5`,
    [
      account.charges_enabled,
      account.payouts_enabled,
      account.details_submitted,
      account.details_submitted,
      account.id,
    ]
  );
  try {
    await pool.query(
      `INSERT INTO stripe_connect_audit (tenant_id, event_type, account_id, details)
       VALUES ($1, 'account_updated', $2, $3)`,
      [
        tenantId,
        account.id,
        JSON.stringify({
          charges_enabled: account.charges_enabled,
          payouts_enabled: account.payouts_enabled,
          details_submitted: account.details_submitted,
          requirements_currently_due: account.requirements?.currently_due || [],
        }),
      ]
    );
  } catch (e) {
    console.warn('[Stripe Connect Webhook] Could not write audit row:', e.message);
  }
  console.log(
    `[Stripe Connect Webhook] Account ${account.id} updated for tenant ${tenantId}: ` +
    `charges=${account.charges_enabled}, payouts=${account.payouts_enabled}`
  );
}

/**
 * Handle Stripe `account.application.deauthorized` events.
 *
 * The tenant revoked the platform's access to their Stripe account (via
 * their Stripe dashboard or via the platform's "Disconnect" button — to
 * be implemented in a future task). We must clear all stripe_* fields on
 * the tenant row so subsequent payment attempts do not try to route to
 * an account we no longer have access to.
 */
async function handleAccountDeauthorized(account, pool) {
  const tenantId = parseInt(account.metadata?.tenant_id || '0', 10);
  if (!tenantId) {
    console.warn(
      '[Stripe Connect Webhook] No tenant_id in account metadata for deauthorized account',
      account.id
    );
    return;
  }
  await pool.query(
    `UPDATE tenants SET
       stripe_account_id = NULL,
       stripe_onboarding_complete = false,
       stripe_charges_enabled = false,
       stripe_payouts_enabled = false,
       stripe_details_submitted = false
     WHERE stripe_account_id = $1`,
    [account.id]
  );
  try {
    await pool.query(
      `INSERT INTO stripe_connect_audit (tenant_id, event_type, account_id, details)
       VALUES ($1, 'account_deauthorized', $2, '{}')`,
      [tenantId, account.id]
    );
  } catch (e) {
    console.warn('[Stripe Connect Webhook] Could not write audit row:', e.message);
  }
  console.log(
    `[Stripe Connect Webhook] Account ${account.id} deauthorized for tenant ${tenantId}`
  );
}

// Attach helpers to the factory so they can be unit-tested without
// having to spin up an Express app and post fake webhooks.
factory.handleAccountUpdated = handleAccountUpdated;
factory.handleAccountDeauthorized = handleAccountDeauthorized;
