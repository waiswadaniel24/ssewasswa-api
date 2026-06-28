/**
 * Stripe Live SDK Integration — ssewasswa-api (Track B)
 *
 * Tokenized payment architecture: the server NEVER sees raw credit card numbers.
 * The client uses Stripe.js to tokenize the card, then calls /create-payment-intent
 * to get a client_secret. Stripe confirms the payment and sends a webhook to
 * /webhook. The webhook updates payment_transactions and triggers donation
 * recording + tax receipt generation.
 *
 * Platform fee: 0.5% on fundraising, 3% on POS, 1% on school fees, 0% on subscriptions
 * (configurable via PLATFORM_FEE_PERCENT_* env vars or per-tenant override).
 *
 * For Stripe Connect (each tenant has their own Stripe account and the platform
 * takes a fee), set application_fee_amount and transfer_data.destination. This
 * requires tenants to have a Stripe Connect account ID stored in
 * tenants.stripe_account_id (column to be added in a future migration).
 *
 * Routes (mounted at /api/payments/stripe in server.js):
 *   POST /create-payment-intent  — create a PaymentIntent, return client_secret
 *   POST /webhook                — Stripe webhook handler (signature verified)
 *   POST /refund                 — refund a completed payment (auth required)
 */

const express = require('express');
const { calculatePlatformFee } = require('../lib/platform-fee');

module.exports = function (ctx) {
  const { pool, ah, requireAuth, audit } = ctx;
  const router = express.Router();

  // Initialize Stripe lazily so the module can be required without STRIPE_SECRET_KEY set.
  let stripe = null;
  let Stripe = null;
  try {
    Stripe = require('stripe');
    if (process.env.STRIPE_SECRET_KEY) {
      stripe = Stripe(process.env.STRIPE_SECRET_KEY);
    }
  } catch (e) {
    console.warn('[Stripe] SDK not installed:', e.message);
  }

  // Middleware: block if Stripe not configured
  const requireStripe = (req, res, next) => {
    if (!stripe) {
      return res.status(503).json({
        error: 'Stripe not configured. Set STRIPE_SECRET_KEY env var.',
      });
    }
    next();
  };

  /**
   * POST /create-payment-intent
   * Body: { amount, currency, campaign_id?, donor_email?, donor_name?, payment_type? }
   * payment_type: 'fundraising' (default) | 'pos' | 'school_fees' | 'subscription'
   *
   * Returns: { client_secret, payment_intent_id, amount, currency, platform_fee, platform_fee_percent, net_to_tenant }
   */
  router.post('/create-payment-intent', requireAuth, requireStripe, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const {
      amount,
      currency = 'USD',
      campaign_id,
      donor_email,
      donor_name,
      payment_type = 'fundraising',
      tenant_fee_override,
    } = req.body;

    // Validate
    if (!amount || typeof amount !== 'number' || amount < 50) {
      return res.status(400).json({
        error: 'Amount must be a number >= 50 (in smallest currency unit, e.g., cents)',
      });
    }
    if (!currency || currency.length !== 3) {
      return res.status(400).json({
        error: 'Currency must be a 3-letter ISO code (USD, EUR, UGX, etc.)',
      });
    }

    // Calculate platform fee
    const { fee, percent, net } = calculatePlatformFee(amount, payment_type, tenant_fee_override);

    // Look up tenant's Stripe Connect account (if any)
    let stripeAccount = null;
    try {
      const r = await pool.query('SELECT stripe_account_id FROM tenants WHERE id = $1', [tid]);
      stripeAccount = r.rows[0]?.stripe_account_id || null;
    } catch (e) {
      // Column may not exist yet — log and continue without Connect
    }

    // Build PaymentIntent params
    const piParams = {
      amount,
      currency: currency.toLowerCase(),
      metadata: {
        tenant_id: String(tid),
        campaign_id: campaign_id ? String(campaign_id) : '',
        donor_email: donor_email || '',
        donor_name: donor_name || '',
        payment_type,
        platform_fee_percent: String(percent),
        platform_fee_amount: String(fee),
      },
      receipt_email: donor_email || undefined,
    };

    // Stripe Connect: destination charge with application fee
    if (stripeAccount) {
      piParams.application_fee_amount = fee;
      piParams.transfer_data = { destination: stripeAccount };
    }

    const paymentIntent = await stripe.paymentIntents.create(piParams);

    // Log the payment attempt (no card data — just the intent ID)
    try {
      await pool.query(
        `INSERT INTO payment_transactions
           (tenant_id, transaction_ref, amount, currency, fee, net_amount, platform_fee, status, provider, provider_ref, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', 'stripe', $8, $9)`,
        [
          tid,
          paymentIntent.id,
          amount,
          currency.toUpperCase(),
          fee,
          net,
          fee,
          paymentIntent.client_secret,
          JSON.stringify({ campaign_id, donor_email, donor_name, payment_type, percent, stripe_account: stripeAccount }),
        ]
      );
    } catch (e) {
      // If payment_transactions table doesn't have all the columns yet, log but don't fail the request
      console.warn('[Stripe] Could not log to payment_transactions:', e.message);
    }

    res.json({
      client_secret: paymentIntent.client_secret,
      payment_intent_id: paymentIntent.id,
      amount,
      currency: currency.toUpperCase(),
      platform_fee: fee,
      platform_fee_percent: percent,
      net_to_tenant: net,
    });
  }));

  /**
   * POST /webhook
   * Stripe webhook handler. Verifies signature, then processes the event.
   * MUST be registered BEFORE express.json() middleware — Stripe needs the raw body.
   */
  router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    if (!stripe) return res.status(503).send('Stripe not configured');

    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!endpointSecret) {
      console.error('[Stripe Webhook] STRIPE_WEBHOOK_SECRET not configured');
      return res.status(503).send('STRIPE_WEBHOOK_SECRET not configured');
    }

    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
      console.error('[Stripe Webhook] Signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      switch (event.type) {
        case 'payment_intent.succeeded':
          await handlePaymentSuccess(event.data.object, pool);
          break;
        case 'payment_intent.payment_failed':
          await handlePaymentFailure(event.data.object, pool);
          break;
        case 'charge.refunded':
          await handleRefund(event.data.object, pool);
          break;
        default:
          console.log('[Stripe Webhook] Unhandled event type:', event.type);
      }
      res.json({ received: true });
    } catch (err) {
      console.error('[Stripe Webhook] Handler error:', err);
      res.status(500).json({ error: 'Webhook handler failed' });
    }
  });

  /**
   * POST /refund
   * Body: { payment_intent_id, amount?, reason? }
   * Refunds a completed Stripe payment. Auth required.
   */
  router.post('/refund', requireAuth, requireStripe, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { payment_intent_id, amount, reason } = req.body;
    if (!payment_intent_id) {
      return res.status(400).json({ error: 'payment_intent_id required' });
    }

    // Verify the payment belongs to this tenant
    let txRow;
    try {
      const r = await pool.query(
        'SELECT * FROM payment_transactions WHERE transaction_ref = $1 AND tenant_id = $2 AND provider = $3',
        [payment_intent_id, tid, 'stripe']
      );
      if (!r.rows.length) {
        return res.status(404).json({ error: 'Payment not found for this tenant' });
      }
      txRow = r.rows[0];
    } catch (e) {
      return res.status(500).json({ error: 'DB lookup failed', detail: e.message });
    }

    const refund = await stripe.refunds.create({
      payment_intent: payment_intent_id,
      amount: amount || undefined, // undefined = full refund
      reason: reason || 'requested_by_customer',
    });

    try {
      await pool.query(
        `UPDATE payment_transactions
         SET status = 'refunded',
             metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb
         WHERE transaction_ref = $2`,
        [JSON.stringify({ refund_id: refund.id, refund_amount: amount || txRow.amount, refund_reason: reason }), payment_intent_id]
      );
    } catch (e) {
      console.warn('[Stripe] Could not update payment_transactions for refund:', e.message);
    }

    res.json({
      refund_id: refund.id,
      status: refund.status,
      amount: refund.amount,
      currency: refund.currency,
    });
  }));

  return router;
};

// ============================================================
// Webhook helpers
// ============================================================

async function handlePaymentSuccess(pi, pool) {
  const tid = parseInt(pi.metadata?.tenant_id || '0', 10);
  if (!tid) {
    console.warn('[Stripe Webhook] No tenant_id in metadata for PI', pi.id);
    return;
  }
  const campaign_id = pi.metadata?.campaign_id ? parseInt(pi.metadata.campaign_id, 10) : null;
  const donor_email = pi.metadata?.donor_email || '';
  const donor_name = pi.metadata?.donor_name || '';
  const platform_fee = parseInt(pi.metadata?.platform_fee_amount || '0', 10);

  // Update the payment_transactions row
  try {
    await pool.query(
      `UPDATE payment_transactions
       SET status = 'completed', provider_ref = $1, completed_at = NOW()
       WHERE transaction_ref = $2`,
      [pi.latest_charge || pi.id, pi.id]
    );
  } catch (e) {
    console.warn('[Stripe Webhook] Could not update payment_transactions:', e.message);
  }

  // Record donation in donations table (if campaign_id present)
  if (campaign_id) {
    try {
      await pool.query(
        `INSERT INTO donations
           (tenant_id, donor_name, donor_email, amount, currency, type, method, reference, campaign_id, created_at)
         VALUES ($1, $2, $3, $4, $5, 'donation', 'stripe', $6, $7, NOW())`,
        [tid, donor_name, donor_email, pi.amount, pi.currency.toUpperCase(), pi.id, campaign_id]
      );
      // Update campaign raised total
      await pool.query(
        'UPDATE campaigns SET raised = raised + $1 WHERE id = $2 AND tenant_id = $3',
        [pi.amount, campaign_id, tid]
      );
    } catch (e) {
      console.warn('[Stripe Webhook] Could not record donation:', e.message);
    }
  }

  // Record platform commission
  if (platform_fee > 0) {
    try {
      await pool.query(
        `INSERT INTO platform_commissions
           (tenant_id, transaction_ref, amount, currency, type, status, created_at)
         VALUES ($1, $2, $3, $4, 'stripe_fee', 'completed', NOW())`,
        [tid, pi.id, platform_fee, pi.currency.toUpperCase()]
      );
    } catch (e) {
      console.warn('[Stripe Webhook] Could not record platform_commission:', e.message);
    }
  }

  console.log(
    `[Stripe Webhook] Payment succeeded: ${pi.id} | tenant=${tid} | campaign=${campaign_id} | ` +
    `amount=${pi.amount} ${pi.currency.toUpperCase()} | platform_fee=${platform_fee} | donor=${donor_email}`
  );

  // TODO: trigger tax receipt email to donor_email via the existing email-campaigns.js module.
  // For now, log the intent — the existing /api/email/campaign endpoints can pick this up.
}

async function handlePaymentFailure(pi, pool) {
  try {
    await pool.query(
      `UPDATE payment_transactions SET status = 'failed' WHERE transaction_ref = $1`,
      [pi.id]
    );
  } catch (e) {
    console.warn('[Stripe Webhook] Could not update payment_transactions for failure:', e.message);
  }
  console.log(`[Stripe Webhook] Payment failed: ${pi.id}`);
}

async function handleRefund(charge, pool) {
  try {
    await pool.query(
      `UPDATE payment_transactions SET status = 'refunded' WHERE provider_ref = $1`,
      [charge.id]
    );
  } catch (e) {
    console.warn('[Stripe Webhook] Could not update payment_transactions for refund:', e.message);
  }
  console.log(`[Stripe Webhook] Charge refunded: ${charge.id}`);
}
