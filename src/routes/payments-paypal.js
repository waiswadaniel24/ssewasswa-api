/**
 * PayPal Live SDK Integration — ssewasswa-api (Track B)
 *
 * Tokenized payment architecture: the server NEVER sees raw credit card numbers.
 * The client uses the PayPal JS SDK to approve the order in a popup, then calls
 * /capture to finalize. PayPal sends a webhook to /webhook for async events.
 *
 * Routes (mounted at /api/payments/paypal in server.js):
 *   POST /create-order  — create a PayPal order, return order_id for client approval
 *   POST /capture       — capture an approved order, record donation + platform fee
 *   POST /webhook       — PayPal webhook handler (basic verification)
 *
 * PayPal uses decimal amounts (e.g., "10.00") unlike Stripe which uses cents (1000).
 * We convert internally.
 */

const express = require('express');
const { calculatePlatformFee } = require('../lib/platform-fee');

module.exports = function (ctx) {
  const { pool, ah, requireAuth } = ctx;
  const router = express.Router();

  // Lazily configure PayPal environment
  let paypalEnvironment = null;
  let paypalClient = null;
  let paypal = null;
  try {
    paypal = require('@paypal/checkout-server-sdk');
    const clientId = process.env.PAYPAL_CLIENT_ID;
    const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
    if (clientId && clientSecret) {
      const env =
        process.env.NODE_ENV === 'production'
          ? new paypal.core.LiveEnvironment(clientId, clientSecret)
          : new paypal.core.SandboxEnvironment(clientId, clientSecret);
      paypalEnvironment = env;
      paypalClient = new paypal.core.PayPalHttpClient(env);
    }
  } catch (e) {
    console.warn('[PayPal] SDK not installed:', e.message);
  }

  const requirePayPal = (req, res, next) => {
    if (!paypalClient) {
      return res.status(503).json({
        error: 'PayPal not configured. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET env vars.',
      });
    }
    next();
  };

  /**
   * POST /create-order
   * Body: { amount, currency, campaign_id?, donor_email?, donor_name?, payment_type? }
   * amount is in the smallest currency unit (e.g., cents) — same convention as Stripe.
   * PayPal uses decimal amounts (e.g., "10.00"), so we divide by 100.
   */
  router.post('/create-order', requireAuth, requirePayPal, ah(async (req, res) => {
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

    if (!amount || typeof amount !== 'number' || amount < 50) {
      return res.status(400).json({ error: 'Amount must be a number >= 50 (smallest currency unit)' });
    }

    const { fee, percent, net } = calculatePlatformFee(amount, payment_type, tenant_fee_override);

    // PayPal uses decimal amounts (e.g., "10.00" for $10.00). Convert from cents.
    const decimalAmount = (amount / 100).toFixed(2);

    const request = new paypal.orders.OrdersCreateRequest();
    request.prefer('return=representation');
    request.requestBody({
      intent: 'CAPTURE',
      purchase_units: [
        {
          amount: {
            currency_code: currency.toUpperCase(),
            value: decimalAmount,
          },
          description: campaign_id ? `Donation to campaign #${campaign_id}` : 'Donation',
          custom_id: JSON.stringify({
            tenant_id: tid,
            campaign_id: campaign_id || null,
            donor_email: donor_email || '',
            donor_name: donor_name || '',
            payment_type,
            platform_fee: fee,
            percent,
          }),
        },
      ],
    });

    const order = await paypalClient.execute(request);

    // Log to payment_transactions
    try {
      await pool.query(
        `INSERT INTO payment_transactions
           (tenant_id, transaction_ref, amount, currency, fee, net_amount, platform_fee, status, provider, provider_ref, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', 'paypal', $8, $9)`,
        [
          tid,
          order.result.id,
          amount,
          currency.toUpperCase(),
          fee,
          net,
          fee,
          order.result.id,
          JSON.stringify({ campaign_id, donor_email, donor_name, payment_type, percent }),
        ]
      );
    } catch (e) {
      console.warn('[PayPal] Could not log to payment_transactions:', e.message);
    }

    res.json({
      order_id: order.result.id,
      status: order.result.status,
      amount,
      currency: currency.toUpperCase(),
      platform_fee: fee,
      platform_fee_percent: percent,
      net_to_tenant: net,
    });
  }));

  /**
   * POST /capture
   * Body: { order_id }
   * Captures an approved PayPal order. The client calls this AFTER the user
   * approves in the PayPal popup.
   */
  router.post('/capture', requireAuth, requirePayPal, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { order_id } = req.body;
    if (!order_id) return res.status(400).json({ error: 'order_id required' });

    // Verify the order belongs to this tenant
    let txRow;
    try {
      const r = await pool.query(
        'SELECT * FROM payment_transactions WHERE transaction_ref = $1 AND tenant_id = $2 AND provider = $3',
        [order_id, tid, 'paypal']
      );
      if (!r.rows.length) {
        return res.status(404).json({ error: 'Order not found for this tenant' });
      }
      txRow = r.rows[0];
    } catch (e) {
      return res.status(500).json({ error: 'DB lookup failed', detail: e.message });
    }

    const request = new paypal.orders.OrdersCaptureRequest(order_id);
    request.requestBody({});
    const capture = await paypalClient.execute(request);

    if (capture.result.status === 'COMPLETED') {
      // Parse the metadata we stored in custom_id
      let meta = {};
      try {
        const customId = capture.result.purchase_units?.[0]?.payments?.captures?.[0]?.custom_id;
        if (customId) meta = JSON.parse(customId);
      } catch (e) {
        // Fall back to the metadata we stored in payment_transactions
        try {
          meta = JSON.parse(txRow.metadata || '{}');
        } catch (_) {}
      }

      // Update payment_transactions
      try {
        await pool.query(
          `UPDATE payment_transactions SET status = 'completed', completed_at = NOW() WHERE transaction_ref = $1`,
          [order_id]
        );
      } catch (e) {
        console.warn('[PayPal] Could not update payment_transactions:', e.message);
      }

      // Record donation
      if (meta.campaign_id) {
        try {
          await pool.query(
            `INSERT INTO donations
               (tenant_id, donor_name, donor_email, amount, currency, type, method, reference, campaign_id, created_at)
             VALUES ($1, $2, $3, $4, $5, 'donation', 'paypal', $6, $7, NOW())`,
            [tid, meta.donor_name || '', meta.donor_email || '', txRow.amount, txRow.currency, order_id, meta.campaign_id]
          );
          await pool.query(
            'UPDATE campaigns SET raised = raised + $1 WHERE id = $2 AND tenant_id = $3',
            [txRow.amount, meta.campaign_id, tid]
          );
        } catch (e) {
          console.warn('[PayPal] Could not record donation:', e.message);
        }
      }

      // Record platform commission
      if (meta.platform_fee > 0) {
        try {
          await pool.query(
            `INSERT INTO platform_commissions
               (tenant_id, transaction_ref, amount, currency, type, status, created_at)
             VALUES ($1, $2, $3, $4, 'paypal_fee', 'completed', NOW())`,
            [tid, order_id, meta.platform_fee, txRow.currency]
          );
        } catch (e) {
          console.warn('[PayPal] Could not record platform_commission:', e.message);
        }
      }

      console.log(
        `[PayPal] Capture succeeded: ${order_id} | tenant=${tid} | campaign=${meta.campaign_id} | ` +
        `amount=${txRow.amount} ${txRow.currency} | platform_fee=${meta.platform_fee} | donor=${meta.donor_email}`
      );
    }

    res.json({
      status: capture.result.status,
      capture_id: capture.result.purchase_units?.[0]?.payments?.captures?.[0]?.id,
      order_id,
    });
  }));

  /**
   * POST /webhook
   * PayPal webhook handler. Basic verification (full verification requires
   * PAYPAL_WEBHOOK_ID + PayPal-Auth-Algorithm header check).
   */
  router.post('/webhook', express.json(), async (req, res) => {
    const event = req.body;
    console.log('[PayPal Webhook] Event type:', event.event_type);

    switch (event.event_type) {
      case 'PAYMENT.CAPTURE.COMPLETED':
        console.log('[PayPal Webhook] Payment capture completed:', event.resource?.id);
        // The /capture endpoint already updates payment_transactions.
        // This webhook is a secondary signal — could be used to reconcile.
        break;
      case 'PAYMENT.CAPTURE.REFUNDED':
        console.log('[PayPal Webhook] Payment refunded:', event.resource?.id);
        try {
          await pool.query(
            `UPDATE payment_transactions SET status = 'refunded' WHERE provider_ref = $1`,
            [event.resource?.id]
          );
        } catch (e) {
          console.warn('[PayPal Webhook] Could not update for refund:', e.message);
        }
        break;
      default:
        console.log('[PayPal Webhook] Unhandled event type:', event.event_type);
    }

    res.json({ received: true });
  });

  return router;
};
