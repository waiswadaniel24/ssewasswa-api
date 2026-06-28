/**
 * geo-locale.test.js — unit tests for src/lib/geo-locale.js (Gap 3)
 *
 * Covers the locale detection priority chain and the exported helpers:
 *
 *   detectLocale(req):
 *     1. ?locale= query override          → source: 'query'
 *     2. CF-IPCountry header              → source: 'cloudflare'
 *     3. (skipped: IP lookup — would hit network, covered by isPrivateIp)
 *     4. Accept-Language header           → source: 'accept_language'
 *     5. DEFAULT_LOCALE                   → source: 'default'
 *
 *   isPrivateIp(ip)          — RFC-1918 / loopback / link-local detection
 *   parseAcceptLanguage(hdr) — "en-US,en;q=0.9,de;q=0.8" → ['en-US','en','de']
 *   SUPPORTED_CURRENCIES     — must include the major donor currencies
 *   SUPPORTED_LANGUAGES      — must include the platform's UI languages
 *
 * No DB and no network required — these tests run in milliseconds.
 * The IP-lookup branch is exercised only via isPrivateIp / lookupIpCountry's
 * timeout behavior, which we avoid here to keep the suite hermetic.
 *
 * Run via: node --test test/geo-locale.test.js
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const REPO_DIR = path.join(__dirname, '..');
const geoLocale = require(path.join(REPO_DIR, 'src', 'lib', 'geo-locale'));

const {
  detectLocale,
  COUNTRY_TO_LOCALE,
  SUPPORTED_LOCALES,
  SUPPORTED_CURRENCIES,
  SUPPORTED_LANGUAGES,
  DEFAULT_LOCALE,
  isPrivateIp,
  parseAcceptLanguage,
  localeToConfig,
  getIpFromRequest,
} = geoLocale;

// Minimal mock Express request. detectLocale only reads req.headers, req.query,
// req.ip, req.connection?.remoteAddress — we don't need the full Express surface.
function mockReq({ headers = {}, query = {}, ip = undefined, connection = undefined } = {}) {
  return { headers, query, ip, connection };
}

describe('detectLocale — priority chain', () => {
  test('?locale=en-GB query param returns en-GB config (source: query)', async () => {
    const req = mockReq({
      headers: { 'cf-ipcountry': 'US' }, // should be IGNORED because query wins
      query: { locale: 'en-GB' },
    });
    const result = await detectLocale(req);
    assert.strictEqual(result.locale, 'en-GB');
    assert.strictEqual(result.currency, 'GBP');
    assert.strictEqual(result.language, 'en');
    assert.strictEqual(result.source, 'query');
  });

  test('unknown ?locale=xx-XX query param falls through (does not short-circuit)', async () => {
    // An unsupported locale in the query should NOT win — we fall through to
    // the next strategy. Here, no other signal exists, so we land on default.
    const req = mockReq({ query: { locale: 'xx-XX' } });
    const result = await detectLocale(req);
    assert.strictEqual(result.source, 'default');
    assert.strictEqual(result.locale, 'en-US');
  });

  test('CF-IPCountry: US header returns en-US config (source: cloudflare)', async () => {
    // Express lowercases header keys; we read them case-insensitively anyway.
    const req = mockReq({ headers: { 'cf-ipcountry': 'US' } });
    const result = await detectLocale(req);
    assert.strictEqual(result.locale, 'en-US');
    assert.strictEqual(result.currency, 'USD');
    assert.strictEqual(result.language, 'en');
    assert.strictEqual(result.name, 'United States');
    assert.strictEqual(result.source, 'cloudflare');
  });

  test('CF-IPCountry: us (lowercase) is matched case-insensitively', async () => {
    const req = mockReq({ headers: { 'cf-ipcountry': 'us' } });
    const result = await detectLocale(req);
    assert.strictEqual(result.locale, 'en-US');
    assert.strictEqual(result.source, 'cloudflare');
  });

  test('CF-IPCountry: GB header returns en-GB / GBP', async () => {
    const req = mockReq({ headers: { 'cf-ipcountry': 'GB' } });
    const result = await detectLocale(req);
    assert.strictEqual(result.locale, 'en-GB');
    assert.strictEqual(result.currency, 'GBP');
    assert.strictEqual(result.source, 'cloudflare');
  });

  test('CF-IPCountry: FR returns fr-FR / EUR (non-English locale)', async () => {
    const req = mockReq({ headers: { 'cf-ipcountry': 'FR' } });
    const result = await detectLocale(req);
    assert.strictEqual(result.locale, 'fr-FR');
    assert.strictEqual(result.currency, 'EUR');
    assert.strictEqual(result.language, 'fr');
    assert.strictEqual(result.source, 'cloudflare');
  });

  test('CF-IPCountry: UG returns en-UG / UGX (home market)', async () => {
    const req = mockReq({ headers: { 'cf-ipcountry': 'UG' } });
    const result = await detectLocale(req);
    assert.strictEqual(result.locale, 'en-UG');
    assert.strictEqual(result.currency, 'UGX');
    assert.strictEqual(result.source, 'cloudflare');
  });

  test('CF-IPCountry for unsupported country falls through to default', async () => {
    // Country not in COUNTRY_TO_LOCALE (e.g. Japan). No Accept-Language, no
    // public IP — should land on default en-US/USD.
    const req = mockReq({ headers: { 'cf-ipcountry': 'JP' } });
    const result = await detectLocale(req);
    assert.strictEqual(result.source, 'default');
    assert.strictEqual(result.locale, 'en-US');
  });

  test('Accept-Language: de-DE,de;q=0.9 returns de-DE config (source: accept_language)', async () => {
    const req = mockReq({
      headers: { 'accept-language': 'de-DE,de;q=0.9' },
    });
    const result = await detectLocale(req);
    assert.strictEqual(result.locale, 'de-DE');
    assert.strictEqual(result.currency, 'EUR');
    assert.strictEqual(result.language, 'de');
    assert.strictEqual(result.source, 'accept_language');
  });

  test('Accept-Language with only language code (e.g. "de") matches first de-* country', async () => {
    const req = mockReq({
      headers: { 'accept-language': 'de' },
    });
    const result = await detectLocale(req);
    assert.strictEqual(result.language, 'de');
    assert.strictEqual(result.source, 'accept_language');
  });

  test('Accept-Language exact match wins over language-only match', async () => {
    // "en-GB,en" — the exact en-GB match should win, not just any en-* locale.
    const req = mockReq({
      headers: { 'accept-language': 'en-GB,en;q=0.9' },
    });
    const result = await detectLocale(req);
    assert.strictEqual(result.locale, 'en-GB');
    assert.strictEqual(result.currency, 'GBP');
  });

  test('Accept-Language with no supported language falls through to default', async () => {
    const req = mockReq({
      headers: { 'accept-language': 'zh-CN,ja;q=0.9' },
    });
    const result = await detectLocale(req);
    assert.strictEqual(result.source, 'default');
    assert.strictEqual(result.locale, 'en-US');
  });

  test('No headers and no IP returns default (en-US / USD / source: default)', async () => {
    // getIpFromRequest returns null when nothing is set, isPrivateIp(null)
    // returns true, so the IP-lookup branch is skipped — no network call.
    const req = mockReq();
    const result = await detectLocale(req);
    assert.strictEqual(result.locale, 'en-US');
    assert.strictEqual(result.currency, 'USD');
    assert.strictEqual(result.language, 'en');
    assert.strictEqual(result.source, 'default');
  });

  test('Private IP (192.168.x.x) skips IP lookup and falls through to default', async () => {
    // Even though req.ip is set to a private IP, we should NOT call the
    // public IP API — isPrivateIp returns true, so the lookup branch is
    // skipped and we land on default.
    const req = mockReq({ ip: '192.168.1.50' });
    const result = await detectLocale(req);
    assert.strictEqual(result.source, 'default');
    assert.strictEqual(result.locale, 'en-US');
  });

  test('Priority: query > CF header (query wins)', async () => {
    const req = mockReq({
      headers: { 'cf-ipcountry': 'GB' },
      query: { locale: 'en-US' },
    });
    const result = await detectLocale(req);
    assert.strictEqual(result.source, 'query');
    assert.strictEqual(result.locale, 'en-US');
  });

  test('Priority: CF header > Accept-Language (CF wins)', async () => {
    const req = mockReq({
      headers: {
        'cf-ipcountry': 'US',
        'accept-language': 'de-DE,de;q=0.9',
      },
    });
    const result = await detectLocale(req);
    assert.strictEqual(result.source, 'cloudflare');
    assert.strictEqual(result.locale, 'en-US');
  });

  test('detectLocale(null/undefined) does not throw — returns default', async () => {
    const r1 = await detectLocale(undefined);
    const r2 = await detectLocale(null);
    assert.strictEqual(r1.source, 'default');
    assert.strictEqual(r2.source, 'default');
  });
});

describe('isPrivateIp', () => {
  test('192.168.1.1 (RFC 1918) → true', () => {
    assert.strictEqual(isPrivateIp('192.168.1.1'), true);
  });

  test('10.0.0.5 (RFC 1918) → true', () => {
    assert.strictEqual(isPrivateIp('10.0.0.5'), true);
  });

  test('172.16.0.1 (RFC 1918, lower bound) → true', () => {
    assert.strictEqual(isPrivateIp('172.16.0.1'), true);
  });

  test('172.31.255.255 (RFC 1918, upper bound) → true', () => {
    assert.strictEqual(isPrivateIp('172.31.255.255'), true);
  });

  test('172.32.0.1 (just outside RFC 1918 range) → false', () => {
    assert.strictEqual(isPrivateIp('172.32.0.1'), false);
  });

  test('8.8.8.8 (Google DNS, public) → false', () => {
    assert.strictEqual(isPrivateIp('8.8.8.8'), false);
  });

  test('127.0.0.1 (IPv4 loopback) → true', () => {
    assert.strictEqual(isPrivateIp('127.0.0.1'), true);
  });

  test('::1 (IPv6 loopback) → true', () => {
    assert.strictEqual(isPrivateIp('::1'), true);
  });

  test('localhost (string) → true', () => {
    assert.strictEqual(isPrivateIp('localhost'), true);
  });

  test('null / undefined / empty → true (safe default)', () => {
    assert.strictEqual(isPrivateIp(null), true);
    assert.strictEqual(isPrivateIp(undefined), true);
    assert.strictEqual(isPrivateIp(''), true);
  });

  test('169.254.x.x (link-local) → true', () => {
    assert.strictEqual(isPrivateIp('169.254.1.1'), true);
  });

  test('IPv4-mapped IPv6 (::ffff:10.0.0.1) → true', () => {
    assert.strictEqual(isPrivateIp('::ffff:10.0.0.1'), true);
  });
});

describe('parseAcceptLanguage', () => {
  test('"en-US,en;q=0.9,de;q=0.8" → [en-US, en, de]', () => {
    assert.deepStrictEqual(
      parseAcceptLanguage('en-US,en;q=0.9,de;q=0.8'),
      ['en-US', 'en', 'de']
    );
  });

  test('preserves order (browser pre-sorts by quality)', () => {
    assert.deepStrictEqual(
      parseAcceptLanguage('de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7'),
      ['de-DE', 'de', 'en-US', 'en']
    );
  });

  test('single language', () => {
    assert.deepStrictEqual(parseAcceptLanguage('fr-FR'), ['fr-FR']);
  });

  test('empty / null / undefined → []', () => {
    assert.deepStrictEqual(parseAcceptLanguage(''), []);
    assert.deepStrictEqual(parseAcceptLanguage(null), []);
    assert.deepStrictEqual(parseAcceptLanguage(undefined), []);
  });

  test('trims whitespace', () => {
    assert.deepStrictEqual(
      parseAcceptLanguage(' en-US , en;q=0.9 , de;q=0.8 '),
      ['en-US', 'en', 'de']
    );
  });
});

describe('SUPPORTED_* constants', () => {
  test('SUPPORTED_CURRENCIES includes major donor currencies', () => {
    ['USD', 'EUR', 'GBP', 'UGX', 'KES'].forEach(code => {
      assert.ok(
        SUPPORTED_CURRENCIES.includes(code),
        `SUPPORTED_CURRENCIES must include ${code} (got: ${SUPPORTED_CURRENCIES.join(',')})`
      );
    });
  });

  test('SUPPORTED_CURRENCIES is de-duplicated', () => {
    // Many countries share EUR — it should appear only once.
    const eurCount = SUPPORTED_CURRENCIES.filter(c => c === 'EUR').length;
    assert.strictEqual(eurCount, 1, 'EUR must be de-duplicated');
  });

  test('SUPPORTED_LANGUAGES includes the locale-manager preset languages', () => {
    // The locale-manager.js PRESET_LOCALES table includes en, fr, de, es, it, nl, sw.
    // Our geo-locale table covers en, de, fr, es, it, nl (sw is missing because
    // no Swahili-speaking country is in the table — Tanzania/KE use en-*).
    ['en', 'de', 'fr', 'es', 'it', 'nl'].forEach(code => {
      assert.ok(
        SUPPORTED_LANGUAGES.includes(code),
        `SUPPORTED_LANGUAGES must include ${code} (got: ${SUPPORTED_LANGUAGES.join(',')})`
      );
    });
  });

  test('SUPPORTED_LANGUAGES is de-duplicated', () => {
    const enCount = SUPPORTED_LANGUAGES.filter(l => l === 'en').length;
    assert.strictEqual(enCount, 1, 'en must be de-duplicated');
  });

  test('SUPPORTED_LOCALES contains expected entries', () => {
    ['en-US', 'en-GB', 'en-UG', 'fr-FR', 'de-DE', 'en-KE'].forEach(loc => {
      assert.ok(SUPPORTED_LOCALES.includes(loc), `SUPPORTED_LOCALES must include ${loc}`);
    });
  });

  test('every COUNTRY_TO_LOCALE entry has locale + currency + language + name', () => {
    Object.entries(COUNTRY_TO_LOCALE).forEach(([cc, cfg]) => {
      assert.ok(cfg.locale, `${cc} must have a locale`);
      assert.ok(cfg.currency, `${cc} must have a currency`);
      assert.ok(cfg.language, `${cc} must have a language`);
      assert.ok(cfg.name, `${cc} must have a name`);
      // Locale should match the language-CC pattern.
      assert.match(cfg.locale, /^[a-z]{2}-[A-Z]{2}$/, `${cc} locale "${cfg.locale}" must be language-COUNTRY`);
      // Currency is 3 letters (ISO-4217).
      assert.match(cfg.currency, /^[A-Z]{3}$/, `${cc} currency "${cfg.currency}" must be ISO-4217 (3 letters)`);
      // Language is 2 letters (ISO-639-1).
      assert.match(cfg.language, /^[a-z]{2}$/, `${cc} language "${cfg.language}" must be ISO-639-1 (2 letters)`);
    });
  });
});

describe('localeToConfig', () => {
  test('en-GB → returns the GB config', () => {
    const cfg = localeToConfig('en-GB');
    assert.strictEqual(cfg.locale, 'en-GB');
    assert.strictEqual(cfg.currency, 'GBP');
    assert.strictEqual(cfg.language, 'en');
  });

  test('unknown locale returns DEFAULT_LOCALE', () => {
    const cfg = localeToConfig('xx-XX');
    assert.strictEqual(cfg.locale, DEFAULT_LOCALE.locale);
    assert.strictEqual(cfg.currency, DEFAULT_LOCALE.currency);
  });

  test('null/undefined returns DEFAULT_LOCALE', () => {
    assert.deepStrictEqual(localeToConfig(null), { ...DEFAULT_LOCALE });
    assert.deepStrictEqual(localeToConfig(undefined), { ...DEFAULT_LOCALE });
  });
});

describe('getIpFromRequest', () => {
  test('X-Forwarded-For (single) returns that IP', () => {
    const req = { headers: { 'x-forwarded-for': '8.8.8.8' } };
    assert.strictEqual(getIpFromRequest(req), '8.8.8.8');
  });

  test('X-Forwarded-For (chain) returns the FIRST entry (closest to client)', () => {
    const req = { headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1, 10.0.0.2' } };
    assert.strictEqual(getIpFromRequest(req), '203.0.113.5');
  });

  test('CF-Connecting-IP is used when X-Forwarded-For is missing', () => {
    const req = { headers: { 'cf-connecting-ip': '198.51.100.7' } };
    assert.strictEqual(getIpFromRequest(req), '198.51.100.7');
  });

  test('X-Forwarded-For takes precedence over CF-Connecting-IP', () => {
    const req = {
      headers: {
        'x-forwarded-for': '203.0.113.5',
        'cf-connecting-ip': '198.51.100.7',
      },
    };
    assert.strictEqual(getIpFromRequest(req), '203.0.113.5');
  });

  test('falls back to req.ip', () => {
    const req = { headers: {}, ip: '192.0.2.1' };
    assert.strictEqual(getIpFromRequest(req), '192.0.2.1');
  });

  test('falls back to req.connection.remoteAddress', () => {
    const req = { headers: {}, connection: { remoteAddress: '198.18.0.1' } };
    assert.strictEqual(getIpFromRequest(req), '198.18.0.1');
  });

  test('returns null when nothing is set', () => {
    assert.strictEqual(getIpFromRequest({ headers: {} }), null);
    assert.strictEqual(getIpFromRequest(null), null);
    assert.strictEqual(getIpFromRequest(undefined), null);
  });
});
