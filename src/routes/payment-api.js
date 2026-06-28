// src/routes/payment-api.js
//
// Country-aware payment method API (extracted from server.js as part of the
// Conservative route-extraction refactor — Track 1, Task t1).
//
// Behavior is identical to the original inline handlers in server.js.
// The module exports a factory that accepts a shared context object so the
// route handlers can close over the same `pool`, `requireAuth`, `ah`,
// `COUNTRY_PAYMENT_CONFIG`, `getProvidersForCountry`, `getTenantCountry`,
// and `audit` that the rest of server.js uses — no behavior changes, no
// re-definitions.
//
// Mount point in server.js:
//   app.use('/api', require('./src/routes/payment-api')(sharedCtx));
//
// NOTE: Mounts at /api (not /api/payment-methods) so /api/settings/country
// is also served by this router.

module.exports = function createPaymentApiRouter(ctx) {
  const express = require('express');
  const router = express.Router();
  const { pool, requireAuth, ah, audit, COUNTRY_PAYMENT_CONFIG, getProvidersForCountry, getTenantCountry } = ctx;

  // Get available payment methods for a country
  // GET /api/payment-methods/:country
  router.get('/payment-methods/:country', ah(async (req, res) => {
    const country = (req.params.country || 'UG').toUpperCase();
    const providers = getProvidersForCountry(country);
    res.json(providers);
  }));

  // Get payment methods for current tenant (auto-detect country)
  // GET /api/payment-methods
  router.get('/payment-methods', requireAuth, ah(async (req, res) => {
    const country = await getTenantCountry(req.session.user.tenant_id);
    const providers = getProvidersForCountry(country);
    res.json({ ...providers, detectedCountry: country });
  }));

  // Set tenant country preference
  // POST /api/settings/country
  router.post('/settings/country', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { country_code, currency, preferred_payment, flutterwave_enabled } = req.body;
    const cc = (country_code || 'UG').toUpperCase();
    const cfg = COUNTRY_PAYMENT_CONFIG[cc];
    if (!cfg) return res.status(400).json({ error: 'Unsupported country code' });

    await pool.query('UPDATE tenants SET country=$1, currency=$2 WHERE id=$3', [cc, currency || cfg.currency, t]);
    await pool.query(`INSERT INTO tenant_country_settings(tenant_id, country_code, currency, preferred_payment, flutterwave_enabled, updated_at)
      VALUES($1,$2,$3,$4,$5,NOW()) ON CONFLICT(tenant_id) DO UPDATE SET country_code=$2, currency=$3, preferred_payment=$4, flutterwave_enabled=$5, updated_at=NOW()`,
      [t, cc, currency || cfg.currency, preferred_payment || cfg.providers[0], flutterwave_enabled !== undefined ? flutterwave_enabled : cfg.flutterwave_supported]);

    await audit(req.session.user.email, 'country_settings_updated', { country: cc, currency }, req.session.user.tenant_id, req);
    res.json({ success: true, country: cc, currency: currency || cfg.currency, availableProviders: cfg.providers });
  }));

  return router;
};
