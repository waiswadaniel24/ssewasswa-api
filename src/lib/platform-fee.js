/**
 * Platform Fee Calculator — ssewasswa-api
 *
 * Configurable per-transaction-type fee percentages:
 * - fundraising: 0.5% (default, per master summary "0.5%-1% transaction cut on raised donor funds")
 * - pos:         3.0% (point-of-sale)
 * - school_fees: 1.0%
 * - subscription: 0.0% (subscriptions are billed separately)
 *
 * Per-tenant overrides supported (pass tenantOverride as a percent number).
 * Per-type env vars: PLATFORM_FEE_PERCENT_FUNDRAISING, _POS, _SCHOOL_FEES, _SUBSCRIPTION
 *
 * Used by:
 *   - src/routes/payments-stripe.js (Track B)
 *   - src/routes/payments-paypal.js (Track B)
 *   - payment-gateway.js (existing 3% calc — can be migrated to use this)
 */

const DEFAULTS = {
  fundraising: 0.5,
  pos: 3.0,
  school_fees: 1.0,
  subscription: 0.0,
};

function calculatePlatformFee(amount, type = 'pos', tenantOverride = null) {
  if (typeof amount !== 'number' || isNaN(amount) || amount < 0) {
    return { fee: 0, percent: 0, net: 0 };
  }

  let percent;
  if (tenantOverride != null && !isNaN(parseFloat(tenantOverride))) {
    percent = parseFloat(tenantOverride);
  } else {
    const envKey = `PLATFORM_FEE_PERCENT_${type.toUpperCase()}`;
    percent = parseFloat(process.env[envKey]);
    if (isNaN(percent)) {
      percent = DEFAULTS[type] != null ? DEFAULTS[type] : DEFAULTS.pos;
    }
  }

  const fee = Math.round(amount * percent / 100);
  return {
    fee,
    percent,
    net: amount - fee,
  };
}

module.exports = { calculatePlatformFee, DEFAULTS };
