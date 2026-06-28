// src/lib/geo-locale.js
//
// Auto-detect visitor locale and currency from their IP address.
//
// Detection priority (highest first):
//   1. ?locale= query param  — explicit user override (e.g. clicking the
//      language picker to "Switch to Spanish"). Lets us short-circuit the
//      auto-detection entirely.
//   2. CF-IPCountry header   — set automatically by Cloudflare. The platform
//      is already behind Cloudflare, so this is the fast path in production
//      (no network call, no rate limit, no parsing of Accept-Language).
//   3. IP geolocation        — falls back to a free public IP API (ipapi.co)
//      when the CF-IPCountry header is missing (local dev, non-Cloudflare
//      deployments, direct-render requests). Bounded to a 3-second timeout
//      so a slow / unreachable IP API never blocks the request.
//   4. Accept-Language header — last-ditch heuristic based on the browser's
//      declared preferred languages. Useful for visitors behind proxies that
//      strip CF-IPCountry.
//   5. DEFAULT_LOCALE         — en-US / USD / en. The safe fallback that
//      matches what the rest of the platform already assumed.
//
// This module is dependency-free (only Node's built-in `https`). It is safe
// to require from server.js at boot time and from request handlers per-call.
//
// Exports:
//   detectLocale(req)               → Promise<{locale, currency, language, name, source}>
//   COUNTRY_TO_LOCALE              — lookup table (country code → config)
//   SUPPORTED_LOCALES              — array of locale strings ("en-GB", "fr-FR", ...)
//   SUPPORTED_CURRENCIES           — unique array of currency codes ("USD", "EUR", ...)
//   SUPPORTED_LANGUAGES            — unique array of language codes ("en", "de", ...)
//   DEFAULT_LOCALE                 — the fallback config object
//   isPrivateIp(ip)                — true for RFC-1918 / loopback IPs (skip IP lookup)
//   parseAcceptLanguage(header)    — "en-US,en;q=0.9,de;q=0.8" → ['en-US','en','de']
//   localeToConfig(locale)         — locale string → {locale, currency, language, name}
//   getIpFromRequest(req)          — pulls client IP from CF/X-Forwarded-For/req.ip

'use strict';

const https = require('https');

// ---------------------------------------------------------------------------
// COUNTRY → LOCALE / CURRENCY / LANGUAGE MAPPING
// ---------------------------------------------------------------------------
// Currencies are the ISO-4217 code, languages are ISO-639-1.
// Where a country has multiple official languages, we pick the most commonly
// spoken for the donor audience (e.g. Canada → en, Belgium is not in the
// table because en/fr/nl overlap is ambiguous; visitors from BE will fall
// through to Accept-Language).
const COUNTRY_TO_LOCALE = {
  // East Africa
  UG: { locale: 'en-UG', currency: 'UGX', language: 'en', name: 'Uganda' },
  KE: { locale: 'en-KE', currency: 'KES', language: 'en', name: 'Kenya' },
  TZ: { locale: 'en-TZ', currency: 'TZS', language: 'en', name: 'Tanzania' },
  RW: { locale: 'en-RW', currency: 'RWF', language: 'en', name: 'Rwanda' },
  ET: { locale: 'en-ET', currency: 'ETB', language: 'en', name: 'Ethiopia' },
  // West Africa
  NG: { locale: 'en-NG', currency: 'NGN', language: 'en', name: 'Nigeria' },
  GH: { locale: 'en-GH', currency: 'GHS', language: 'en', name: 'Ghana' },
  // North America
  US: { locale: 'en-US', currency: 'USD', language: 'en', name: 'United States' },
  CA: { locale: 'en-CA', currency: 'CAD', language: 'en', name: 'Canada' },
  // Europe
  GB: { locale: 'en-GB', currency: 'GBP', language: 'en', name: 'United Kingdom' },
  IE: { locale: 'en-IE', currency: 'EUR', language: 'en', name: 'Ireland' },
  DE: { locale: 'de-DE', currency: 'EUR', language: 'de', name: 'Germany' },
  FR: { locale: 'fr-FR', currency: 'EUR', language: 'fr', name: 'France' },
  IT: { locale: 'it-IT', currency: 'EUR', language: 'it', name: 'Italy' },
  ES: { locale: 'es-ES', currency: 'EUR', language: 'es', name: 'Spain' },
  NL: { locale: 'nl-NL', currency: 'EUR', language: 'nl', name: 'Netherlands' },
  // Oceania
  AU: { locale: 'en-AU', currency: 'AUD', language: 'en', name: 'Australia' },
  NZ: { locale: 'en-NZ', currency: 'NZD', language: 'en', name: 'New Zealand' },
  // Middle East / Asia
  AE: { locale: 'en-AE', currency: 'AED', language: 'en', name: 'United Arab Emirates' },
  // Southern Africa
  ZA: { locale: 'en-ZA', currency: 'ZAR', language: 'en', name: 'South Africa' },
};

const DEFAULT_LOCALE = {
  locale: 'en-US',
  currency: 'USD',
  language: 'en',
  name: 'Unknown',
};

const SUPPORTED_LOCALES = Object.values(COUNTRY_TO_LOCALE).map(c => c.locale);
const SUPPORTED_CURRENCIES = [...new Set(Object.values(COUNTRY_TO_LOCALE).map(c => c.currency))];
const SUPPORTED_LANGUAGES = [...new Set(Object.values(COUNTRY_TO_LOCALE).map(c => c.language))];

/**
 * Detect visitor locale from request.
 *
 * @param {object} req — Express request (needs `.headers`, optional `.query`)
 * @returns {Promise<{locale:string, currency:string, language:string, name:string, source:string}>}
 *
 * `source` is one of: 'query' | 'cloudflare' | 'ip_lookup' | 'accept_language' | 'default'
 */
async function detectLocale(req) {
  req = req || {};
  req.headers = req.headers || {};
  req.query = req.query || {};

  // 1. Explicit override via ?locale= query param
  //    Lets a returning visitor pin a locale that differs from their geo.
  const queryLocale = req.query.locale;
  if (queryLocale && SUPPORTED_LOCALES.includes(queryLocale)) {
    return { ...localeToConfig(queryLocale), source: 'query' };
  }

  // 2. Cloudflare CF-IPCountry header
  //    Fast path — no network call, no parsing. Cloudflare sets this on every
  //    request that passes through their network.
  const cfCountry = req.headers['cf-ipcountry'];
  if (cfCountry && COUNTRY_TO_LOCALE[cfCountry.toUpperCase()]) {
    return { ...COUNTRY_TO_LOCALE[cfCountry.toUpperCase()], source: 'cloudflare' };
  }

  // 3. IP geolocation fallback (async — only if Cloudflare header is missing)
  //    Uses a public IP API. Bounded to a 3-second timeout; failures fall
  //    through to Accept-Language. Private IPs (RFC-1918 / loopback) are
  //    skipped because they're not routable on the public internet.
  const ip = getIpFromRequest(req);
  if (ip && !isPrivateIp(ip)) {
    try {
      const geo = await lookupIpCountry(ip);
      if (geo && COUNTRY_TO_LOCALE[geo.countryCode]) {
        return { ...COUNTRY_TO_LOCALE[geo.countryCode], source: 'ip_lookup' };
      }
    } catch (_e) {
      // IP lookup failed — continue to next fallback
    }
  }

  // 4. Accept-Language header
  //    "en-US,en;q=0.9,de;q=0.8" → ['en-US', 'en', 'de']
  //    Try exact locale match first, then language-only match.
  const acceptLang = req.headers['accept-language'];
  if (acceptLang) {
    const parsed = parseAcceptLanguage(acceptLang);
    for (const lang of parsed) {
      const exactMatch = Object.values(COUNTRY_TO_LOCALE).find(
        c => c.locale.toLowerCase() === lang.toLowerCase()
      );
      if (exactMatch) return { ...exactMatch, source: 'accept_language' };

      const langMatch = Object.values(COUNTRY_TO_LOCALE).find(
        c => c.language === lang.split('-')[0].toLowerCase()
      );
      if (langMatch) return { ...langMatch, source: 'accept_language' };
    }
  }

  // 5. Default
  return { ...DEFAULT_LOCALE, source: 'default' };
}

/**
 * Extract the client IP from an Express request, honoring Cloudflare and
 * standard X-Forwarded-For conventions. Returns null if nothing usable.
 */
function getIpFromRequest(req) {
  if (!req) return null;
  const headers = req.headers || {};
  // X-Forwarded-For may be a comma-separated list; the first entry is the
  // original client (closest to the user). Subsequent entries are proxies.
  const xff = headers['x-forwarded-for'];
  if (xff) {
    const first = String(xff).split(',')[0];
    if (first && first.trim()) return first.trim();
  }
  if (headers['cf-connecting-ip']) return String(headers['cf-connecting-ip']).trim();
  if (req.ip) return req.ip;
  if (req.connection && req.connection.remoteAddress) return req.connection.remoteAddress;
  return null;
}

/**
 * True for RFC-1918 private ranges, loopback, and link-local. We skip the IP
 * lookup for these because the public IP APIs would either fail or return
 * nonsensical results.
 */
function isPrivateIp(ip) {
  if (!ip) return true;
  const v = String(ip).trim().toLowerCase();
  if (v === 'localhost' || v === '::1' || v === '127.0.0.1' || v === '::') return true;
  // IPv4-mapped IPv6 (::ffff:10.0.0.1)
  const stripped = v.replace(/^::ffff:/, '');
  if (stripped.startsWith('10.')) return true;
  if (stripped.startsWith('192.168.')) return true;
  // 172.16.0.0/12 — 172.16.x through 172.31.x
  const m172 = stripped.match(/^172\.(\d+)\./);
  if (m172) {
    const octet = parseInt(m172[1], 10);
    if (octet >= 16 && octet <= 31) return true;
  }
  if (stripped.startsWith('169.254.')) return true; // link-local
  if (stripped === '::' || stripped.startsWith('fc') || stripped.startsWith('fd')) return true; // IPv6 ULA
  if (stripped.startsWith('fe80')) return true; // IPv6 link-local
  return false;
}

/**
 * Look up the country code for a public IP using ipapi.co's free tier.
 * Resolves to { countryCode, countryName } or null on any failure.
 * In production, prefer MaxMind GeoLite2 (self-hosted, no rate limit).
 *
 * The function never throws — failures resolve to null so callers can
 * fall through to the next detection strategy.
 */
function lookupIpCountry(ip) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (val) => {
      if (settled) return;
      settled = true;
      resolve(val);
    };

    const req = https.get(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, { timeout: 3000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json && json.country_code) {
            finish({ countryCode: json.country_code.toUpperCase(), countryName: json.country_name || '' });
          } else {
            finish(null);
          }
        } catch (_e) {
          finish(null);
        }
      });
    });

    req.on('error', () => finish(null));
    req.on('timeout', () => { req.destroy(); finish(null); });
  });
}

/**
 * Parse an Accept-Language header into an ordered list of language tags.
 * "en-US,en;q=0.9,de;q=0.8" → ['en-US', 'en', 'de']
 * Quality values are pre-sorted by the browser, so we preserve order.
 */
function parseAcceptLanguage(header) {
  if (!header) return [];
  return String(header)
    .split(',')
    .map(part => part.trim().split(';')[0].trim())
    .filter(Boolean);
}

/**
 * Convert a locale string ("en-GB") back into its full config (currency +
 * language + name). Falls back to DEFAULT_LOCALE for unknown locales.
 */
function localeToConfig(locale) {
  if (!locale) return { ...DEFAULT_LOCALE };
  const found = Object.values(COUNTRY_TO_LOCALE).find(c => c.locale === locale);
  return found ? { ...found } : { ...DEFAULT_LOCALE };
}

module.exports = {
  detectLocale,
  COUNTRY_TO_LOCALE,
  SUPPORTED_LOCALES,
  SUPPORTED_CURRENCIES,
  SUPPORTED_LANGUAGES,
  DEFAULT_LOCALE,
  // Exported for unit tests + re-use by other modules
  isPrivateIp,
  parseAcceptLanguage,
  localeToConfig,
  getIpFromRequest,
  lookupIpCountry,
};
