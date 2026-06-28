// src/routes/locale.js
//
// Public-facing locale detection endpoint + middleware.
//
// Mounted at /api/locale in server.js. Provides:
//   GET  /api/locale   — returns the detected locale + supported lists
//   POST /api/locale   — manually override locale/currency (user picks
//                        "Switch to Spanish" in the UI)
//
// The middleware here runs only on /api/locale itself. The broader
// "detect on every public request" middleware is wired in server.js
// (so it can be scoped to /public, /api/public, /donate, /campaigns
// without forcing every authenticated API call through detection).
//
// Cookies used:
//   visitor_locale    — e.g. "en-GB"   (1-year expiry, httpOnly:false so
//                                            the frontend can read it)
//   visitor_currency  — e.g. "GBP"     (1-year expiry, httpOnly:false)
//
// Why cookies? So we don't re-run the IP lookup on every page load. The
// IP lookup is bounded to 3s but is still a network call; caching the
// result in a cookie for a year makes subsequent page loads instant.
// (User can still override by clicking the language picker, which POSTs
// to /api/locale and overwrites the cookie.)

'use strict';

const express = require('express');
const geoLocale = require('../lib/geo-locale');
const { detectLocale, SUPPORTED_LOCALES, SUPPORTED_CURRENCIES, SUPPORTED_LANGUAGES } = geoLocale;

const COOKIE_OPTS = { maxAge: 365 * 24 * 60 * 60 * 1000, httpOnly: false };

module.exports = function (_ctx) {
  // _ctx is the shared route context passed by server.js. We don't need
  // pool/requireAuth here because /api/locale is intentionally public —
  // visitors see the locale picker before they log in. We accept the
  // argument anyway so server.js can wire us in the same way as every
  // other route module under src/routes/.
  const router = express.Router();

  // ---- Middleware: detect locale and attach to req + cookie ----
  // Re-uses the cookie cache if present; otherwise runs the full
  // detection priority chain (query → CF header → IP lookup →
  // Accept-Language → default). Never blocks the request — on any
  // error it falls back to en-US/USD.
  router.use(async (req, res, next) => {
    try {
      const cookies = req.cookies || {};
      const cachedLocale = cookies.visitor_locale;
      const cachedCurrency = cookies.visitor_currency;
      if (cachedLocale && cachedCurrency) {
        req.detectedLocale = { locale: cachedLocale, currency: cachedCurrency, source: 'cookie' };
        return next();
      }

      const detected = await detectLocale(req);
      req.detectedLocale = detected;

      res.cookie('visitor_locale', detected.locale, COOKIE_OPTS);
      res.cookie('visitor_currency', detected.currency, COOKIE_OPTS);

      next();
    } catch (_e) {
      // Locale detection must NEVER break a public page render.
      req.detectedLocale = { locale: 'en-US', currency: 'USD', source: 'error' };
      next();
    }
  });

  // ---- GET /api/locale — read the detected locale for the current visitor ----
  router.get('/', (req, res) => {
    res.json({
      ...(req.detectedLocale || { locale: 'en-US', currency: 'USD', source: 'default' }),
      supported_locales: SUPPORTED_LOCALES,
      supported_currencies: SUPPORTED_CURRENCIES,
      supported_languages: SUPPORTED_LANGUAGES,
    });
  });

  // ---- POST /api/locale — manually override locale/currency ----
  // Body: { locale?: "en-GB", currency?: "GBP" }
  // Either or both may be set. We don't validate against SUPPORTED_* here
  // because the UI is the one offering the picker; if a misbehaving client
  // posts an unsupported code, the worst case is that downstream pages
  // render with the unsupported code in their cookie (cosmetic — they can
  // re-POST a valid one). Validating here would couple this route to the
  // SUPPORTED_* list, which can grow over time.
  router.post('/', (req, res) => {
    const { locale, currency } = req.body || {};
    if (locale) res.cookie('visitor_locale', locale, COOKIE_OPTS);
    if (currency) res.cookie('visitor_currency', currency, COOKIE_OPTS);
    res.json({
      message: 'Locale updated',
      locale: locale || null,
      currency: currency || null,
    });
  });

  return router;
};
