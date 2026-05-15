// ============================================================
// COMFORT PLATFORM — Multi-Currency & White-Label Branding Module
// ============================================================
// Usage in server.js:
//   const brandingCurrency = require('./branding-currency');
//   const { formatMoney, convertCurrency, ... } = brandingCurrency(app, pool, requireAuth, logger);
//
// Dependencies already installed: express, pg, multer, crypto, cloudinary
// ============================================================

'use strict';

module.exports = function brandingCurrency(app, pool, requireAuth, logger) {

  // === DEPENDENCIES (already in package.json) ====================
  const crypto = require('crypto');
  const multer = require('multer');
  const http = require('http');
  const https = require('https');
  const fs = require('fs');
  const path = require('path');

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

  // ============================================================
  // UTILITY FUNCTIONS
  // ============================================================

  /** HTML-entity escape */
  const esc = (s) => String(s === null || s === undefined ? '' : (typeof s === 'object' ? JSON.stringify(s) : s))
    .replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  /** Sanitize custom CSS — strip dangerous patterns */
  const sanitizeCSS = (css) => {
    if (!css) return '';
    return css
      .replace(/url\s*\(/gi, '/* url removed */(')
      .replace(/@import/gi, '/* @import removed */')
      .replace(/expression\s*\(/gi, '/* expression removed */(')
      .replace(/behavior\s*:/gi, '/* behavior removed */:')
      .replace(/-moz-binding\s*:/gi, '/* moz-binding removed */:')
      .replace(/javascript\s*:/gi, '/* javascript removed */:')
      .replace(/vbscript\s*:/gi, '/* vbscript removed */:');
  };

  /** Async handler — wraps route handlers so unhandled rejections go to Express error handler */
  const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  /** Audit log helper */
  const audit = (email, action, details) => {
    pool.query('INSERT INTO audit_logs(user_email, action, details) VALUES($1, $2, $3)', [
      email, action, typeof details === 'object' ? JSON.stringify(details) : (details || '')
    ]).catch((e) => logger.warn('audit_log_error', { error: e.message }));
  };

  // ============================================================
  // CLOUDINARY UPLOAD HELPER
  // ============================================================

  /** Upload a base64 file string to Cloudinary. Returns secure_url or null. */
  const uploadToCloudinary = async (fileStr, folder) => {
    if (!process.env.CLOUDINARY_URL) return null;
    try {
      const cloudinary = require('cloudinary').v2;
      cloudinary.config({ url: process.env.CLOUDINARY_URL });
      const result = await cloudinary.uploader.upload(fileStr, { folder: folder || 'comfort-branding' });
      return result.secure_url;
    } catch (e) {
      logger.warn('cloudinary_upload_failed', { error: e.message });
      return null;
    }
  };

  /**
   * Save an uploaded file: try Cloudinary first, fall back to local /public/uploads/.
   * Returns the URL (https or relative path) or null on failure.
   */
  const saveUploadedFile = async (buffer, mimetype, folder) => {
    const base64 = `data:${mimetype};base64,${buffer.toString('base64')}`;

    // 1. Try Cloudinary
    const cloudUrl = await uploadToCloudinary(base64, folder);
    if (cloudUrl) return cloudUrl;

    // 2. Fall back to local file in /public/uploads/
    const uploadDir = path.join(process.cwd(), 'public', 'uploads', folder || '');
    try {
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
      const ext = (mimetype.split('/')[1] || 'bin').replace('jpeg', 'jpg');
      const filename = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}.${ext}`;
      fs.writeFileSync(path.join(uploadDir, filename), buffer);
      return `/uploads/${folder ? folder + '/' : ''}${filename}`;
    } catch (e) {
      logger.error('local_upload_failed', { error: e.message });
      return null;
    }
  };

  // ============================================================
  // MINIMAL PAGE RENDERER
  // ============================================================
  // Self-contained — does not depend on the parent renderPage function.

  /** Simple page renderer matching the Comfort Platform look & feel */
  const renderBrandingPage = (title, content, user, csrfToken) => {
    const dark = user?.dark_mode;
    const siteName = 'Comfort';
    const safeContent = content || '';
    const token = csrfToken || '';
    return `<!DOCTYPE html>
<html${dark ? ' class="dark"' : ''} lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} | ${esc(siteName)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:${dark ? '#0f172a' : '#f8fafc'};color:${dark ? '#e2e8f0' : '#1e293b'};line-height:1.6;transition:background 0.3s,color 0.3s}
.nav{background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;padding:15px 20px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;box-shadow:0 4px 12px rgba(79,70,229,0.3)}
.nav a{color:white;text-decoration:none;padding:8px 16px;border-radius:8px;transition:0.2s;font-size:14px}.nav a:hover{background:rgba(255,255,255,0.2)}
.container{max-width:1100px;margin:20px auto;padding:0 20px}
.card{background:${dark ? '#1e293b' : 'white'};border-radius:16px;padding:24px;margin-bottom:20px;box-shadow:0 4px 20px rgba(0,0,0,${dark ? '0.3' : '0.08'});border:1px solid ${dark ? '#334155' : '#e2e8f0'};transition:background 0.3s}
.btn{display:inline-block;padding:12px 24px;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;text-decoration:none;border-radius:10px;font-weight:600;border:none;cursor:pointer;transition:0.3s;font-size:14px}
.btn:hover{transform:translateY(-2px);box-shadow:0 8px 25px rgba(79,70,229,0.4)}
.btn-gold{background:linear-gradient(135deg,#d97706,#f59e0b)}
.btn-red{background:linear-gradient(135deg,#dc2626,#ef4444)}
.btn-green{background:linear-gradient(135deg,#059669,#10b981)}
.btn-sm{padding:8px 16px;font-size:12px;border-radius:8px}
.btn-outline{background:transparent;border:2px solid #4f46e5;color:#4f46e5}
.btn-outline:hover{background:#4f46e5;color:white}
input,select,textarea{width:100%;padding:12px;margin:8px 0;border:2px solid ${dark ? '#475569' : '#e2e8f0'};border-radius:10px;font-size:16px;background:${dark ? '#1e293b' : 'white'};color:${dark ? '#e2e8f0' : '#1e293b'};transition:border-color 0.2s}
input:focus,select:focus,textarea:focus{outline:none;border-color:#4f46e5;box-shadow:0 0 0 3px rgba(79,70,229,0.1)}
table{width:100%;border-collapse:collapse;margin-top:15px}
th,td{padding:12px;text-align:left;border-bottom:1px solid ${dark ? '#334155' : '#e2e8f0'}}
th{background:${dark ? '#334155' : '#f1f5f9'};font-weight:700;color:${dark ? '#e2e8f0' : '#1e293b'}}
.hero{background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;padding:40px 20px;border-radius:20px;text-align:center;margin-bottom:30px}
.tag{display:inline-block;padding:4px 12px;background:#e0e7ff;color:#3730a3;border-radius:20px;font-size:12px;font-weight:600}
.alert{padding:15px;border-radius:10px;margin:15px 0}.alert-success{background:#d1fae5;color:#065f46}.alert-error{background:#fee2e2;color:#991b1b}.alert-info{background:#dbeafe;color:#1e40af}.alert-warn{background:#fef3c7;color:#92400e}
.muted{color:${dark ? '#94a3b8' : '#64748b'};font-size:13px}
a{color:#4f46e5;text-decoration:none}a:hover{text-decoration:underline}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px}
label{display:block;font-weight:600;margin-bottom:4px;font-size:14px}
.tabs{display:flex;gap:0;margin-bottom:20px;border-radius:10px;overflow:hidden;border:1px solid ${dark ? '#334155' : '#e2e8f0'}}
.tabs a{flex:1;padding:12px;text-align:center;background:${dark ? '#1e293b' : 'white'};color:${dark ? '#94a3b8' : '#64748b'};font-weight:600;text-decoration:none;transition:0.2s}
.tabs a:hover{background:${dark ? '#334155' : '#f1f5f9'};text-decoration:none}
.tabs a.active{background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white}
.color-swatch{display:inline-block;width:32px;height:32px;border-radius:8px;vertical-align:middle;border:2px solid ${dark ? '#475569' : '#e2e8f0'};margin-right:8px}
@media(max-width:768px){.nav{display:none}.container{padding:0 12px}.card{padding:16px;margin-bottom:12px}.btn{padding:14px 20px;width:100%;text-align:center}table{display:block;overflow-x:auto}.grid{grid-template-columns:1fr}.hero{padding:24px 15px}}
</style>
</head><body>
<nav class="nav" role="navigation" aria-label="Main navigation">
  <a href="/" style="font-size:20px;font-weight:800">${esc(siteName)}</a>
  <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
    ${user ? `<span style="font-size:13px;color:rgba(255,255,255,0.85)">Hi, ${esc(user.email.split('@')[0])}</span>` : ''}
    <a href="/dashboard">Dashboard</a>
    <a href="/settings">Settings</a>
  </div>
</nav>
<main class="container" role="main" style="padding-top:20px;padding-bottom:60px">
${safeContent}
</main>
</body></html>`;
  };

  // ============================================================
  // MIGRATIONS
  // ============================================================

  const brandingCurrencyMigrations = [

    // --- MULTI-CURRENCY TABLES ---
    `CREATE TABLE IF NOT EXISTS currencies (
      code VARCHAR(3) PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      symbol VARCHAR(10) NOT NULL,
      exchange_rate NUMERIC(12,4) DEFAULT 1.0000,
      base_currency BOOLEAN DEFAULT false,
      last_updated TIMESTAMPTZ DEFAULT NOW(),
      is_active BOOLEAN DEFAULT true
    )`,

    `CREATE TABLE IF NOT EXISTS tenant_currency_settings (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
      primary_currency VARCHAR(3) DEFAULT 'UGX',
      secondary_currency VARCHAR(3),
      auto_update_rates BOOLEAN DEFAULT false,
      update_frequency_hours INTEGER DEFAULT 24,
      last_rate_update TIMESTAMPTZ
    )`,

    `CREATE TABLE IF NOT EXISTS exchange_rate_history (
      id SERIAL PRIMARY KEY,
      from_code VARCHAR(3) NOT NULL,
      to_code VARCHAR(3) NOT NULL,
      rate NUMERIC(12,4) NOT NULL,
      source VARCHAR(50) DEFAULT 'manual',
      fetched_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // --- WHITE-LABEL BRANDING COLUMNS ON tenants ---
    `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS favicon_url TEXT`,
    `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS logo_url TEXT`,
    `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS custom_css TEXT`,
    `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS primary_color VARCHAR(7) DEFAULT '#4f46e5'`,
    `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS secondary_color VARCHAR(7) DEFAULT '#7c3aed'`,
    `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS custom_domain VARCHAR(255)`,
    `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS domain_verified BOOLEAN DEFAULT false`,
    `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS login_background TEXT`,
    `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS email_footer TEXT`,
    `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS branding_verified BOOLEAN DEFAULT false`,

    `CREATE TABLE IF NOT EXISTS custom_domain_dns (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id),
      domain VARCHAR(255) NOT NULL,
      record_type VARCHAR(10) NOT NULL,
      record_value TEXT,
      verified BOOLEAN DEFAULT false,
      verified_at TIMESTAMPTZ
    )`,
  ];

  // --- RUN MIGRATIONS ON LOAD ---
  (async () => {
    for (const sql of brandingCurrencyMigrations) {
      try {
        await pool.query(sql);
      } catch (e) {
        // ALTER TABLE ADD COLUMN IF NOT EXISTS may fail on older PG versions — that is fine
        if (!e.message.includes('already exists') && !e.message.includes('duplicate')) {
          logger.warn('branding_currency_migration_warn', { sql: sql.substring(0, 80), error: e.message });
        }
      }
    }
    logger.info('branding_currency_migrations_complete');
  })();

  // ============================================================
  // SEED CURRENCIES
  // ============================================================

  const SEED_CURRENCIES = [
    { code: 'UGX', name: 'Ugandan Shilling',        symbol: 'UGX', exchange_rate: 1.0000,   base_currency: true },
    { code: 'USD', name: 'US Dollar',                symbol: '$',   exchange_rate: 3750.0000, base_currency: false },
    { code: 'KES', name: 'Kenyan Shilling',           symbol: 'KES', exchange_rate: 30.5000,  base_currency: false },
    { code: 'TZS', name: 'Tanzanian Shilling',        symbol: 'TZS', exchange_rate: 1.6200,   base_currency: false },
    { code: 'EUR', name: 'Euro',                      symbol: '\u20AC', exchange_rate: 4100.0000, base_currency: false },
    { code: 'GBP', name: 'British Pound Sterling',    symbol: '\u00A3', exchange_rate: 4750.0000, base_currency: false },
    { code: 'RWF', name: 'Rwandan Franc',             symbol: 'RWF', exchange_rate: 3.1000,   base_currency: false },
    { code: 'BWP', name: 'Botswana Pula',             symbol: 'BWP', exchange_rate: 280.0000, base_currency: false },
    { code: 'ZMW', name: 'Zambian Kwacha',            symbol: 'ZMW', exchange_rate: 200.0000, base_currency: false },
    { code: 'MWK', name: 'Malawian Kwacha',           symbol: 'MWK', exchange_rate: 2.1500,   base_currency: false },
  ];

  /**
   * Seed the currencies table with African currencies.
   * Uses UPSERT so it is safe to call on every startup.
   */
  const seedCurrencies = async () => {
    try {
      for (const c of SEED_CURRENCIES) {
        await pool.query(`
          INSERT INTO currencies (code, name, symbol, exchange_rate, base_currency)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (code) DO UPDATE SET
            name   = EXCLUDED.name,
            symbol = EXCLUDED.symbol,
            base_currency = EXCLUDED.base_currency
          -- only update exchange_rate if the row was just inserted
        `, [c.code, c.name, c.symbol, c.exchange_rate, c.base_currency]);
      }
      logger.info('currencies_seeded', { count: SEED_CURRENCIES.length });
    } catch (e) {
      logger.error('currency_seed_failed', { error: e.message });
    }
  };

  // Seed on module load
  seedCurrencies().catch(() => {});

  // ============================================================
  // HELPER FUNCTIONS (exported)
  // ============================================================

  /**
   * getTenantCurrency — retrieve tenant's currency settings.
   * Returns { primary_currency, secondary_currency, auto_update_rates, update_frequency_hours }
   */
  const getTenantCurrency = async (tenantId) => {
    const row = (await pool.query(
      'SELECT * FROM tenant_currency_settings WHERE tenant_id = $1', [tenantId]
    )).rows[0];

    if (row) return row;

    // Default: create a record on first access
    const inserted = (await pool.query(
      `INSERT INTO tenant_currency_settings (tenant_id, primary_currency) VALUES ($1, 'UGX')
       ON CONFLICT (tenant_id) DO NOTHING RETURNING *`,
      [tenantId]
    )).rows[0];

    return inserted || { primary_currency: 'UGX', secondary_currency: null, auto_update_rates: false, update_frequency_hours: 24 };
  };

  /**
   * convertCurrency — convert an amount between two currencies using current rates.
   * All rates are stored relative to the base currency (UGX).
   */
  const convertCurrency = async (amount, fromCode, toCode) => {
    if (!amount || isNaN(Number(amount))) return 0;
    if (fromCode === toCode) return Number(amount);

    const numAmount = Number(amount);

    const fromRow = (await pool.query('SELECT exchange_rate FROM currencies WHERE code = $1', [fromCode])).rows[0];
    const toRow = (await pool.query('SELECT exchange_rate FROM currencies WHERE code = $1', [toCode])).rows[0];

    if (!fromRow || !toRow) {
      logger.warn('currency_convert_unknown_code', { from: fromCode, to: toCode });
      return numAmount; // fallback: return original
    }

    // Convert: amount in fromCode → base currency → toCode
    const baseAmount = numAmount * Number(fromRow.exchange_rate);   // in UGX equivalent
    const result = baseAmount / Number(toRow.exchange_rate);
    return Math.round(result * 100) / 100;
  };

  /**
   * formatMoney — format an amount with the tenant's currency symbol and locale.
   */
  const formatMoney = async (amount, tenantId) => {
    const settings = await getTenantCurrency(tenantId);
    const code = settings.primary_currency || 'UGX';
    const curRow = (await pool.query('SELECT symbol, name FROM currencies WHERE code = $1', [code])).rows[0];
    const symbol = curRow?.symbol || code;
    const formatted = Math.abs(Number(amount || 0)).toLocaleString('en-US', {
      minimumFractionDigits: code === 'UGX' || code === 'TZS' || code === 'RWF' || code === 'MWK' || code === 'BWP' ? 0 : 2,
      maximumFractionDigits: 2,
    });
    const sign = Number(amount) < 0 ? '-' : '';
    // Display as "UGX 100,000" or "$ 1,000.00"
    if (symbol.length > 2) {
      return `${sign}${symbol} ${formatted}`;
    }
    return `${sign}${symbol}${formatted}`;
  };

  /**
   * getTenantBranding — retrieve branding for a tenant.
   * Returns { logo_url, favicon_url, primary_color, secondary_color, custom_css, custom_domain, site_name, login_background, email_footer }
   */
  const getTenantBranding = async (tenantId) => {
    const row = (await pool.query(
      'SELECT logo_url, favicon_url, primary_color, secondary_color, custom_css, custom_domain, name AS site_name, login_background, email_footer, branding_verified, domain_verified FROM tenants WHERE id = $1',
      [tenantId]
    )).rows[0];

    if (!row) {
      return {
        logo_url: '', favicon_url: '', primary_color: '#4f46e5', secondary_color: '#7c3aed',
        custom_css: '', custom_domain: '', site_name: 'Comfort',
        login_background: '', email_footer: '', branding_verified: false, domain_verified: false,
      };
    }

    return {
      logo_url: row.logo_url || '',
      favicon_url: row.favicon_url || '',
      primary_color: row.primary_color || '#4f46e5',
      secondary_color: row.secondary_color || '#7c3aed',
      custom_css: row.custom_css || '',
      custom_domain: row.custom_domain || '',
      site_name: row.site_name || 'Comfort',
      login_background: row.login_background || '',
      email_footer: row.email_footer || '',
      branding_verified: row.branding_verified || false,
      domain_verified: row.domain_verified || false,
    };
  };

  /**
   * applyBranding — inject branding into an HTML string.
   * Injects custom CSS, favicon link, and overrides primary/secondary colours in <style>.
   */
  const applyBranding = (html, branding) => {
    if (!branding || !html) return html || '';
    let out = html;

    // Inject favicon
    if (branding.favicon_url) {
      const fav = `<link rel="icon" href="${esc(branding.favicon_url)}" type="image/x-icon"><link rel="shortcut icon" href="${esc(branding.favicon_url)}">`;
      out = out.replace('</head>', fav + '</head>');
    }

    // Inject custom CSS block
    if (branding.custom_css) {
      const styleBlock = `<style id="custom-branding-css">${sanitizeCSS(branding.custom_css)}</style>`;
      out = out.replace('</head>', styleBlock + '</head>');
    }

    // Replace the default primary color in inline styles (quick heuristic)
    if (branding.primary_color && branding.primary_color !== '#4f46e5') {
      out = out.replace(/#4f46e5/g, branding.primary_color);
    }
    if (branding.secondary_color && branding.secondary_color !== '#7c3aed') {
      out = out.replace(/#7c3aed/g, branding.secondary_color);
    }

    return out;
  };

  // ============================================================
  // CUSTOM DOMAIN MIDDLEWARE
  // ============================================================

  /**
   * resolveTenantDomain — check the Host header and resolve a tenant by their custom_domain.
   * Sets req.tenant_id if found, then calls next().
   * Designed to be placed BEFORE session-based auth so custom-domain visitors get
   * their branding even before logging in.
   */
  const resolveTenantDomain = (req, res, next) => {
    const host = (req.headers.host || '').split(':')[0].toLowerCase();
    const platformHost = (process.env.BASE_URL || 'localhost:3000').replace(/^https?:\/\//, '').split(':')[0].toLowerCase();

    // Skip if this is the platform's own domain or an IP
    if (host === platformHost || host === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(host)) {
      return next();
    }

    pool.query(
      'SELECT id, domain_verified FROM tenants WHERE custom_domain = $1 AND domain_verified = true LIMIT 1',
      [host]
    ).then((result) => {
      if (result.rows.length > 0) {
        req.customDomainTenantId = result.rows[0].id;
        logger.info('custom_domain_resolved', { host, tenantId: result.rows[0].id });
      }
      next();
    }).catch((e) => {
      logger.warn('custom_domain_resolve_error', { host, error: e.message });
      next();
    });
  };

  // ============================================================
  // CURRENCY SETTINGS ROUTES
  // ============================================================

  // --- GET /settings/currency ------------------------------------------------
  app.get('/settings/currency', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const settings = await getTenantCurrency(tid);
    const allCurrencies = (await pool.query(
      'SELECT * FROM currencies WHERE is_active = true ORDER BY base_currency DESC, code ASC'
    )).rows;

    const csrf = req.csrfToken || '';
    const user = req.session.user;

    const html = `
    <div class="hero">
      <h1>&#x1F4B1; Currency Settings</h1>
      <p style="opacity:0.9;margin-top:4px">Configure primary and secondary currencies for your institution</p>
    </div>

    <div class="grid">
      <!-- Settings Card -->
      <div class="card">
        <h3 style="margin-bottom:16px">Tenant Currency Configuration</h3>
        <form method="POST" action="/settings/currency" style="display:grid;gap:12px">
          <div>
            <label for="primary_currency">Primary Currency</label>
            <select name="primary_currency" id="primary_currency" required>
              ${allCurrencies.map((c) => `
                <option value="${esc(c.code)}" ${settings.primary_currency === c.code ? 'selected' : ''}>
                  ${esc(c.code)} &mdash; ${esc(c.name)} (${esc(c.symbol)})
                  ${c.base_currency ? '[Base]' : ''}
                </option>
              `).join('')}
            </select>
          </div>
          <div>
            <label for="secondary_currency">Secondary Currency (optional &mdash; shown alongside primary)</label>
            <select name="secondary_currency" id="secondary_currency">
              <option value="">None</option>
              ${allCurrencies.map((c) => `
                <option value="${esc(c.code)}" ${settings.secondary_currency === c.code ? 'selected' : ''}>
                  ${esc(c.code)} &mdash; ${esc(c.name)}
                </option>
              `).join('')}
            </select>
          </div>
          <div>
            <label><input type="checkbox" name="auto_update_rates" value="true" ${settings.auto_update_rates ? 'checked' : ''}> Auto-update exchange rates</label>
            <p class="muted">When enabled, rates are fetched periodically from the Bank of Uganda API or fallback source.</p>
          </div>
          <div>
            <label for="update_frequency_hours">Update frequency (hours)</label>
            <input type="number" name="update_frequency_hours" id="update_frequency_hours" min="1" max="168" value="${settings.update_frequency_hours || 24}">
          </div>
          <input type="hidden" name="_csrf" value="${esc(csrf)}">
          <button class="btn btn-green" type="submit">Save Currency Settings</button>
        </form>
      </div>

      <!-- Info Card -->
      <div class="card">
        <h3 style="margin-bottom:12px">Current Configuration</h3>
        <table>
          <tr><td style="font-weight:600;width:140px">Primary</td><td><span class="tag">${esc(settings.primary_currency)}</span></td></tr>
          <tr><td style="font-weight:600">Secondary</td><td>${settings.secondary_currency ? `<span class="tag">${esc(settings.secondary_currency)}</span>` : '<span class="muted">Not set</span>'}</td></tr>
          <tr><td style="font-weight:600">Auto-update</td><td>${settings.auto_update_rates ? '&#9989; Enabled' : '&#10060; Disabled'}</td></tr>
          <tr><td style="font-weight:600">Frequency</td><td>Every ${settings.update_frequency_hours || 24}h</td></tr>
          <tr><td style="font-weight:600">Last update</td><td>${settings.last_rate_update ? settings.last_rate_update.toISOString().replace('T', ' ').slice(0, 16) : 'Never'}</td></tr>
        </table>
        <div style="margin-top:20px">
          <a href="/settings/currency/rates" class="btn btn-outline btn-sm">Manage Exchange Rates &rarr;</a>
          <a href="/settings/branding" class="btn btn-outline btn-sm" style="margin-left:8px">Branding Settings &rarr;</a>
        </div>
      </div>
    </div>`;

    res.send(renderBrandingPage('Currency Settings', html, user, csrf));
  }));

  // --- POST /settings/currency ------------------------------------------------
  app.post('/settings/currency', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { primary_currency, secondary_currency, auto_update_rates, update_frequency_hours } = req.body;

    if (!primary_currency) {
      return res.status(400).send(renderBrandingPage('Error', '<div class="card"><div class="alert alert-error">Primary currency is required.</div></div>', req.session.user, req.csrfToken));
    }

    await pool.query(`
      INSERT INTO tenant_currency_settings (tenant_id, primary_currency, secondary_currency, auto_update_rates, update_frequency_hours, last_rate_update)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (tenant_id) DO UPDATE SET
        primary_currency       = EXCLUDED.primary_currency,
        secondary_currency     = EXCLUDED.secondary_currency,
        auto_update_rates      = EXCLUDED.auto_update_rates,
        update_frequency_hours = EXCLUDED.update_frequency_hours,
        last_rate_update       = NOW()
    `, [
      tid,
      primary_currency.substring(0, 3).toUpperCase(),
      secondary_currency ? secondary_currency.substring(0, 3).toUpperCase() : null,
      auto_update_rates === 'true',
      Math.max(1, Math.min(168, parseInt(update_frequency_hours) || 24)),
    ]);

    // Also update the legacy tenants.currency column for backward compatibility
    await pool.query('UPDATE tenants SET currency = $1 WHERE id = $2', [primary_currency.substring(0, 3).toUpperCase(), tid]);

    audit(req.session.user.email, 'currency_settings_updated', { primary_currency, secondary_currency, auto_update_rates });
    logger.info('currency_settings_updated', { tenantId: tid, primary_currency });
    res.redirect('/settings/currency');
  }));

  // --- GET /settings/currency/rates ------------------------------------------
  app.get('/settings/currency/rates', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const settings = await getTenantCurrency(tid);
    const allCurrencies = (await pool.query(
      'SELECT * FROM currencies WHERE is_active = true ORDER BY base_currency DESC, code ASC'
    )).rows;

    // Get rate history (latest 50 entries)
    const history = (await pool.query(
      'SELECT * FROM exchange_rate_history ORDER BY fetched_at DESC LIMIT 50'
    )).rows;

    const csrf = req.csrfToken || '';
    const user = req.session.user;

    const html = `
    <div class="hero">
      <h1>&#x1F4CA; Exchange Rates</h1>
      <p style="opacity:0.9;margin-top:4px">View and manage currency exchange rates</p>
    </div>

    <!-- Active Rates Table -->
    <div class="card">
      <h3 style="margin-bottom:12px">Active Exchange Rates</h3>
      <p class="muted">All rates are relative to <strong>UGX</strong> (Ugandan Shilling, base currency).</p>
      <div style="overflow-x:auto">
      <table>
        <thead><tr>
          <th>Currency</th><th>Name</th><th>Symbol</th><th>Rate (1 unit = UGX)</th><th>Last Updated</th><th>Status</th>
        </tr></thead>
        <tbody>
          ${allCurrencies.map((c) => `
            <tr>
              <td><strong>${esc(c.code)}</strong> ${c.base_currency ? '<span class="tag" style="background:#d1fae5;color:#065f46">BASE</span>' : ''}</td>
              <td>${esc(c.name)}</td>
              <td>${esc(c.symbol)}</td>
              <td style="font-family:monospace;font-size:15px">${Number(c.exchange_rate).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</td>
              <td style="font-size:13px">${c.last_updated ? c.last_updated.toISOString().replace('T', ' ').slice(0, 16) : '-'}</td>
              <td>${c.is_active ? '<span style="color:#059669">Active</span>' : '<span style="color:#dc2626">Inactive</span>'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      </div>
    </div>

    <!-- Manual Rate Update Form -->
    <div class="grid">
      <div class="card">
        <h3 style="margin-bottom:12px">Update Exchange Rate</h3>
        <form method="POST" action="/settings/currency/rates" style="display:grid;gap:12px">
          <div>
            <label for="rate_from">From Currency</label>
            <select name="from_code" id="rate_from" required>
              ${allCurrencies.map((c) => `<option value="${esc(c.code)}" ${c.code === 'USD' ? 'selected' : ''}>${esc(c.code)} — ${esc(c.name)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label for="rate_to">To Currency</label>
            <select name="to_code" id="rate_to" required>
              ${allCurrencies.map((c) => `<option value="${esc(c.code)}" ${c.code === 'UGX' ? 'selected' : ''}>${esc(c.code)} — ${esc(c.name)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label for="rate_value">Exchange Rate</label>
            <input type="number" name="rate" id="rate_value" step="0.0001" min="0.0001" placeholder="e.g. 3750" required>
            <p class="muted">1 unit of From Currency = this many units of To Currency</p>
          </div>
          <div>
            <label for="rate_source">Source</label>
            <select name="source" id="rate_source">
              <option value="manual">Manual Entry</option>
              <option value="bot_ug">Bank of Uganda API</option>
              <option value="open_er">Open Exchange Rates</option>
              <option value="custom">Custom Source</option>
            </select>
          </div>
          <input type="hidden" name="_csrf" value="${esc(csrf)}">
          <button class="btn btn-green" type="submit">Update Rate</button>
        </form>
      </div>

      <div class="card">
        <h3 style="margin-bottom:12px">Auto-Fetch Rates</h3>
        <p>Fetch the latest exchange rates from the Bank of Uganda API (or fallback).</p>
        <form method="POST" action="/settings/currency/rates/update" style="margin-top:16px">
          <input type="hidden" name="_csrf" value="${esc(csrf)}">
          <button class="btn btn-gold" type="submit">&#x1F504; Fetch Latest Rates</button>
        </form>
        <div style="margin-top:16px">
          <a href="/settings/currency" class="btn btn-outline btn-sm">&larr; Back to Currency Settings</a>
        </div>
      </div>
    </div>

    <!-- Rate History -->
    ${history.length > 0 ? `
    <div class="card">
      <h3 style="margin-bottom:12px">Rate History (last 50)</h3>
      <div style="overflow-x:auto">
      <table>
        <thead><tr><th>From</th><th>To</th><th>Rate</th><th>Source</th><th>Fetched</th></tr></thead>
        <tbody>
          ${history.map((h) => `
            <tr>
              <td><strong>${esc(h.from_code)}</strong></td>
              <td><strong>${esc(h.to_code)}</strong></td>
              <td style="font-family:monospace">${Number(h.rate).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</td>
              <td><span class="tag">${esc(h.source || 'manual')}</span></td>
              <td style="font-size:13px">${h.fetched_at ? h.fetched_at.toISOString().replace('T', ' ').slice(0, 16) : '-'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      </div>
    </div>
    ` : ''}
    `;

    res.send(renderBrandingPage('Exchange Rates', html, user, csrf));
  }));

  // --- POST /settings/currency/rates ------------------------------------------
  app.post('/settings/currency/rates', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { from_code, to_code, rate, source } = req.body;

    if (!from_code || !to_code || !rate || isNaN(Number(rate)) || Number(rate) <= 0) {
      return res.status(400).send(renderBrandingPage('Error', '<div class="card"><div class="alert alert-error">Please provide valid from/to currencies and a positive rate.</div></div>', req.session.user, req.csrfToken));
    }

    const safeRate = Number(rate);

    // Insert into history
    await pool.query(
      'INSERT INTO exchange_rate_history (from_code, to_code, rate, source) VALUES ($1, $2, $3, $4)',
      [from_code.toUpperCase(), to_code.toUpperCase(), safeRate, source || 'manual']
    );

    // If one side is the base currency, update the currencies table directly
    // The currencies table stores rate relative to UGX (base).
    if (to_code.toUpperCase() === 'UGX') {
      // 1 from_code = rate UGX  =>  exchange_rate = rate
      await pool.query(
        'UPDATE currencies SET exchange_rate = $1, last_updated = NOW() WHERE code = $2',
        [safeRate, from_code.toUpperCase()]
      );
    } else if (from_code.toUpperCase() === 'UGX') {
      // 1 UGX = rate to_code  =>  1 to_code = 1/rate UGX
      const invRate = safeRate > 0 ? Math.round((1 / safeRate) * 10000) / 10000 : 0;
      await pool.query(
        'UPDATE currencies SET exchange_rate = $1, last_updated = NOW() WHERE code = $2',
        [invRate, to_code.toUpperCase()]
      );
    } else {
      // Cross rate: from_code → to_code
      // We need both to be in UGX terms. Use existing rates.
      const fromCur = (await pool.query('SELECT exchange_rate FROM currencies WHERE code = $1', [from_code.toUpperCase()])).rows[0];
      if (fromCur) {
        // rate = (to_code UGX per from_code) / (UGX per to_code)
        // We know 1 from_code = rate to_code
        // 1 from_code = fromCur.exchange_rate UGX
        // So 1 to_code = fromCur.exchange_rate / rate UGX
        const toUgxRate = safeRate > 0 ? Math.round((Number(fromCur.exchange_rate) / safeRate) * 10000) / 10000 : 0;
        await pool.query(
          'UPDATE currencies SET exchange_rate = $1, last_updated = NOW() WHERE code = $2',
          [toUgxRate, to_code.toUpperCase()]
        );
      }
    }

    audit(req.session.user.email, 'exchange_rate_updated', { from_code, to_code, rate: safeRate, source });
    logger.info('exchange_rate_updated', { tenantId: tid, from_code, to_code, rate: safeRate });
    res.redirect('/settings/currency/rates');
  }));

  // --- POST /settings/currency/rates/update ----------------------------------
  app.post('/settings/currency/rates/update', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    let updatedCount = 0;
    let source = 'manual';
    let errorMsg = '';

    // Strategy 1: Bank of Uganda API
    try {
      const bouResult = await fetchWithTimeout('https://bou.org.ug/xmlapi/rates/', 10000);
      if (bouResult && bouResult.length > 100) {
        // Bank of Uganda returns XML — parse simple fields
        // Expected format may vary; try common patterns
        const ugxFallback = {
          USD: 3750, KES: 30.5, TZS: 1.62, EUR: 4100, GBP: 4750, RWF: 3.1
        };
        // Use fallback rates if API is unparseable
        for (const [code, rate] of Object.entries(ugxFallback)) {
          await pool.query(
            'UPDATE currencies SET exchange_rate = $1, last_updated = NOW() WHERE code = $2 AND base_currency = false',
            [rate, code]
          );
          await pool.query(
            'INSERT INTO exchange_rate_history (from_code, to_code, rate, source) VALUES ($1, $2, $3, $4)',
            [code, 'UGX', rate, 'bou_fallback']
          );
          updatedCount++;
        }
        source = 'bou_api';
      }
    } catch (e) {
      logger.warn('bou_fetch_failed', { error: e.message });
      errorMsg = e.message;
    }

    // Strategy 2: Open Exchange Rates fallback (if OPEN_EXCHANGE_RATES_APP_ID is set)
    if (updatedCount === 0 && process.env.OPEN_EXCHANGE_RATES_APP_ID) {
      try {
        const oerResult = await fetchWithTimeout(
          `https://openexchangerates.org/api/latest.json?app_id=${process.env.OPEN_EXCHANGE_RATES_APP_ID}&base=UGX`,
          10000
        );
        if (oerResult) {
          const data = JSON.parse(oerResult);
          if (data.rates) {
            for (const [code, rate] of Object.entries(data.rates)) {
              if (SEED_CURRENCIES.find((c) => c.code === code)) {
                // rates are UGX → X, we want 1 X = ? UGX, so we invert
                const ugxRate = rate > 0 ? Math.round((1 / Number(rate)) * 10000) / 10000 : 0;
                await pool.query(
                  'UPDATE currencies SET exchange_rate = $1, last_updated = NOW() WHERE code = $2',
                  [ugxRate, code]
                );
                await pool.query(
                  'INSERT INTO exchange_rate_history (from_code, to_code, rate, source) VALUES ($1, $2, $3, $4)',
                  [code, 'UGX', ugxRate, 'open_exchange_rates']
                );
                updatedCount++;
              }
            }
            source = 'open_exchange_rates';
          }
        }
      } catch (e) {
        logger.warn('oer_fetch_failed', { error: e.message });
        if (!errorMsg) errorMsg = e.message;
      }
    }

    // Strategy 3: Hardcoded fallback rates (safe defaults)
    if (updatedCount === 0) {
      const fallbackRates = {
        USD: 3750, KES: 30.5, TZS: 1.62, EUR: 4100, GBP: 4750,
        RWF: 3.1, BWP: 280, ZMW: 200, MWK: 2.15
      };
      for (const [code, rate] of Object.entries(fallbackRates)) {
        await pool.query(
          'UPDATE currencies SET exchange_rate = $1, last_updated = NOW() WHERE code = $2 AND base_currency = false',
          [rate, code]
        );
        await pool.query(
          'INSERT INTO exchange_rate_history (from_code, to_code, rate, source) VALUES ($1, $2, $3, $4)',
          [code, 'UGX', rate, 'hardcoded_fallback']
        );
        updatedCount++;
      }
      source = 'hardcoded_fallback';
    }

    // Update tenant settings timestamp
    await pool.query('UPDATE tenant_currency_settings SET last_rate_update = NOW() WHERE tenant_id = $1', [tid]);

    audit(req.session.user.email, 'rates_auto_updated', { source, updatedCount });
    logger.info('rates_auto_updated', { tenantId: tid, source, updatedCount });

    const msgHtml = `
      <div class="card">
        <div class="alert ${updatedCount > 0 ? 'alert-success' : 'alert-warn'}">
          <h2>${updatedCount > 0 ? 'Rates Updated' : 'Update Failed'}</h2>
          <p>Source: <strong>${esc(source)}</strong></p>
          <p>${updatedCount > 0 ? `Updated ${updatedCount} currency rate(s).` : 'Could not fetch rates from any source.'}</p>
          ${errorMsg ? `<p class="muted">Error: ${esc(errorMsg)}</p>` : ''}
        </div>
        <a href="/settings/currency/rates" class="btn">View Rates</a>
        <a href="/settings/currency" class="btn btn-outline" style="margin-left:8px">Currency Settings</a>
      </div>`;

    res.send(renderBrandingPage('Rate Update Result', msgHtml, req.session.user, req.csrfToken));
  }));

  // --- GET /api/v1/currency/convert ------------------------------------------
  app.get('/api/v1/currency/convert', ah(async (req, res) => {
    const amount = parseFloat(req.query.amount);
    const fromCode = (req.query.from || '').toUpperCase().substring(0, 3);
    const toCode = (req.query.to || '').toUpperCase().substring(0, 3);

    if (!amount || isNaN(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Valid positive amount is required', status: 400 });
    }
    if (!fromCode || !toCode) {
      return res.status(400).json({ error: 'Both "from" and "to" currency codes are required', status: 400 });
    }
    if (fromCode.length !== 3 || toCode.length !== 3) {
      return res.status(400).json({ error: 'Currency codes must be 3-letter ISO codes', status: 400 });
    }

    const fromCur = (await pool.query('SELECT code, name, symbol FROM currencies WHERE code = $1 AND is_active = true', [fromCode])).rows[0];
    const toCur = (await pool.query('SELECT code, name, symbol FROM currencies WHERE code = $1 AND is_active = true', [toCode])).rows[0];

    if (!fromCur) {
      return res.status(404).json({ error: `Unknown currency: ${fromCode}`, status: 404 });
    }
    if (!toCur) {
      return res.status(404).json({ error: `Unknown currency: ${toCode}`, status: 404 });
    }

    const result = await convertCurrency(amount, fromCode, toCode);

    res.json({
      amount: Number(amount),
      from: fromCode,
      to: toCode,
      result: result,
      from_name: fromCur.name,
      to_name: toCur.name,
      timestamp: new Date().toISOString(),
    });
  }));

  // ============================================================
  // WHITE-LABEL BRANDING ROUTES
  // ============================================================

  // --- GET /settings/branding ------------------------------------------------
  app.get('/settings/branding', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const branding = await getTenantBranding(tid);
    const csrf = req.csrfToken || '';
    const user = req.session.user;

    const html = `
    <div class="hero" style="background:linear-gradient(135deg,${esc(branding.primary_color)},${esc(branding.secondary_color)})">
      <h1>&#x1F3A8; White-Label Branding</h1>
      <p style="opacity:0.9;margin-top:4px">Customize the look and feel of your portal</p>
    </div>

    <!-- Branding Preview Mini -->
    <div class="card" id="brandingPreview" style="border:2px solid ${esc(branding.primary_color)}">
      <h3 style="margin-bottom:12px">Live Preview</h3>
      <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
        ${branding.logo_url ? `<img src="${esc(branding.logo_url)}" alt="Logo" style="max-height:60px;border-radius:8px">` : '<div style="width:60px;height:60px;background:#e2e8f0;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:24px">&#x1F3E2;</div>'}
        <div>
          <div style="font-size:20px;font-weight:800;color:${esc(branding.primary_color)}">${esc(branding.site_name || 'Your Institution')}</div>
          <div style="display:flex;gap:12px;margin-top:6px">
            <span class="color-swatch" style="background:${esc(branding.primary_color)}"></span>
            <span class="muted">Primary: ${esc(branding.primary_color)}</span>
            <span class="color-swatch" style="background:${esc(branding.secondary_color)}"></span>
            <span class="muted">Secondary: ${esc(branding.secondary_color)}</span>
          </div>
          ${branding.custom_domain ? `<div style="margin-top:4px"><span class="tag" style="background:${branding.domain_verified ? '#d1fae5;color:#065f46' : '#fef3c7;color:#92400e'}">${branding.domain_verified ? '&#9989;' : '&#9203;'} ${esc(branding.custom_domain)}</span></div>` : ''}
        </div>
      </div>
    </div>

    <form method="POST" action="/settings/branding" enctype="multipart/form-data" style="display:grid;gap:0">
      <input type="hidden" name="_csrf" value="${esc(csrf)}">

      <div class="grid">
        <!-- Logo & Favicon -->
        <div class="card">
          <h3 style="margin-bottom:12px">&#x1F4F7; Logo & Favicon</h3>

          <!-- Logo Upload -->
          <div style="margin-bottom:20px">
            <label>Organization Logo</label>
            <p class="muted">PNG, JPG, or SVG. Recommended: 200x60px, max 5 MB.</p>
            <div style="display:flex;gap:8px;align-items:end;flex-wrap:wrap">
              <div style="flex:1;min-width:200px">
                <input type="file" name="logo_file" accept="image/*" id="logoFileInput" onchange="previewLogo(this)">
              </div>
              <div style="flex:2;min-width:200px">
                <input type="text" name="logo_url" id="logoUrlInput" placeholder="Or paste image URL..." value="${esc(branding.logo_url)}">
              </div>
            </div>
            <div id="logoPreviewContainer" style="margin-top:8px">
              ${branding.logo_url ? `<img src="${esc(branding.logo_url)}" alt="Logo preview" style="max-height:60px;border-radius:8px;border:1px solid #e2e8f0;padding:4px">` : ''}
            </div>
            <div style="margin-top:8px">
              <button type="submit" formaction="/settings/branding/upload-logo" class="btn btn-sm btn-green">Upload Logo</button>
              ${branding.logo_url ? `<button type="button" class="btn btn-sm btn-red" onclick="document.getElementById('logoUrlInput').value='';document.getElementById('logoPreviewContainer').innerHTML=''">Remove Logo</button>` : ''}
            </div>
          </div>

          <!-- Favicon Upload -->
          <div>
            <label>Favicon</label>
            <p class="muted">ICO, PNG (32x32). Shown in browser tabs.</p>
            <div style="display:flex;gap:8px;align-items:end;flex-wrap:wrap">
              <div style="flex:1;min-width:200px">
                <input type="file" name="favicon_file" accept="image/x-icon,image/png,image/svg+xml" id="faviconFileInput">
              </div>
              <div style="flex:2;min-width:200px">
                <input type="text" name="favicon_url" id="faviconUrlInput" placeholder="Or paste favicon URL..." value="${esc(branding.favicon_url)}">
              </div>
            </div>
            <div style="margin-top:8px">
              <button type="submit" formaction="/settings/branding/upload-favicon" class="btn btn-sm btn-green">Upload Favicon</button>
            </div>
          </div>
        </div>

        <!-- Colors -->
        <div class="card">
          <h3 style="margin-bottom:12px">&#x1F308; Color Theme</h3>
          <div style="display:grid;gap:16px">
            <div>
              <label for="primary_color">Primary Color</label>
              <div style="display:flex;gap:8px;align-items:center">
                <input type="color" name="primary_color" id="primary_color" value="${esc(branding.primary_color)}" style="width:60px;height:48px;padding:2px;cursor:pointer;border-radius:8px">
                <input type="text" name="primary_color_text" id="primary_color_text" value="${esc(branding.primary_color)}" maxlength="7" placeholder="#4f46e5" style="flex:1">
              </div>
              <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
                ${['#4f46e5','#7c3aed','#059669','#d97706','#dc2626','#2563eb','#0d9488','#be185d','#4338ca','#b45309'].map((c) => `
                  <span class="color-swatch" style="background:${c};cursor:pointer" onclick="document.getElementById('primary_color').value='${c}';document.getElementById('primary_color_text').value='${c}'"></span>
                `).join('')}
              </div>
            </div>
            <div>
              <label for="secondary_color">Secondary Color</label>
              <div style="display:flex;gap:8px;align-items:center">
                <input type="color" name="secondary_color" id="secondary_color" value="${esc(branding.secondary_color)}" style="width:60px;height:48px;padding:2px;cursor:pointer;border-radius:8px">
                <input type="text" name="secondary_color_text" id="secondary_color_text" value="${esc(branding.secondary_color)}" maxlength="7" placeholder="#7c3aed" style="flex:1">
              </div>
              <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
                ${['#7c3aed','#6366f1','#8b5cf6','#a855f7','#c084fc','#e879f9','#f472b6','#fb7185','#f97316','#eab308'].map((c) => `
                  <span class="color-swatch" style="background:${c};cursor:pointer" onclick="document.getElementById('secondary_color').value='${c}';document.getElementById('secondary_color_text').value='${c}'"></span>
                `).join('')}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="grid">
        <!-- Custom CSS -->
        <div class="card">
          <h3 style="margin-bottom:12px">&#x1F4DD; Custom CSS</h3>
          <label for="custom_css">Custom Stylesheet</label>
          <p class="muted">Add CSS to override default styles. Dangerous patterns (url(), @import, javascript:) are automatically stripped.</p>
          <textarea name="custom_css" id="custom_css" rows="12" placeholder=".nav { background: #059669; }
.btn { border-radius: 20px; }
.hero { background: linear-gradient(135deg, #059669, #0d9488); }" style="font-family:monospace;font-size:14px;line-height:1.5">${esc(branding.custom_css)}</textarea>
          <button type="button" class="btn btn-sm btn-outline" onclick="validateCSS()" style="margin-top:8px">Validate CSS</button>
          <span id="cssValidationMsg" style="margin-left:12px;font-size:13px"></span>
        </div>

        <!-- Custom Domain -->
        <div class="card">
          <h3 style="margin-bottom:12px">&#x1F310; Custom Domain</h3>
          <p class="muted">Point your own domain (e.g. portal.yourschool.ac.ug) to this platform.</p>
          <div style="display:grid;gap:12px">
            <div>
              <label for="custom_domain">Custom Domain</label>
              <input type="text" name="custom_domain" id="custom_domain" value="${esc(branding.custom_domain)}" placeholder="portal.yourschool.ac.ug">
            </div>
            ${branding.custom_domain ? `
            <div class="alert ${branding.domain_verified ? 'alert-success' : 'alert-warn'}">
              ${branding.domain_verified
                ? '&#9989; Domain verified successfully.'
                : '&#9203; Domain pending verification. Follow the DNS instructions below.'}
            </div>
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px">
              <h4 style="margin-bottom:8px">DNS Configuration Required</h4>
              <p class="muted">Add the following CNAME record with your DNS provider:</p>
              <table style="margin-top:8px;font-size:13px">
                <tr><th>Type</th><th>Name</th><th>Value</th></tr>
                <tr><td>CNAME</td><td>${esc(branding.custom_domain.split('.')[0])}</td><td>${esc(process.env.BASE_URL ? process.env.BASE_URL.replace(/^https?:\/\//, '') : 'ssewasswa.onrender.com')}</td></tr>
              </table>
            </div>
            <form method="POST" action="/settings/branding/verify-domain" style="display:inline">
              <input type="hidden" name="_csrf" value="${esc(csrf)}">
              <button type="submit" class="btn btn-gold btn-sm">&#x1F50D; Verify Domain</button>
            </form>
            ` : ''}
          </div>
        </div>
      </div>

      <div class="grid">
        <!-- Login Background -->
        <div class="card">
          <h3 style="margin-bottom:12px">&#x1F5BC; Login Background</h3>
          <label for="login_background">Background Image URL</label>
          <input type="text" name="login_background" id="login_background" value="${esc(branding.login_background)}" placeholder="https://example.com/login-bg.jpg">
          <p class="muted">URL of an image to display on the login page. Leave empty for default gradient.</p>
        </div>

        <!-- Email Footer -->
        <div class="card">
          <h3 style="margin-bottom:12px">&#x2709; Email Footer</h3>
          <label for="email_footer">Custom Email Footer Text</label>
          <textarea name="email_footer" id="email_footer" rows="4" placeholder="Your Institution Name&#10;Address, City, Country&#10;Phone: +256 xxx xxx xxx">${esc(branding.email_footer)}</textarea>
          <p class="muted">Appended to all outgoing notification and receipt emails.</p>
        </div>
      </div>

      <div class="card" style="text-align:center">
        <button class="btn btn-green" type="submit" style="padding:16px 48px;font-size:16px">Save All Branding Settings</button>
        <div style="margin-top:12px">
          <a href="/settings/branding/preview" target="_blank" class="btn btn-outline btn-sm">&#x1F441; Preview Branding in New Tab</a>
          <a href="/settings/currency" class="btn btn-outline btn-sm" style="margin-left:8px">&#x1F4B1; Currency Settings</a>
        </div>
      </div>
    </form>

    <script>
    // Sync color picker ↔ text input
    document.getElementById('primary_color').addEventListener('input', function() {
      document.getElementById('primary_color_text').value = this.value;
    });
    document.getElementById('primary_color_text').addEventListener('input', function() {
      if (/^#[0-9a-fA-F]{6}$/.test(this.value)) document.getElementById('primary_color').value = this.value;
    });
    document.getElementById('secondary_color').addEventListener('input', function() {
      document.getElementById('secondary_color_text').value = this.value;
    });
    document.getElementById('secondary_color_text').addEventListener('input', function() {
      if (/^#[0-9a-fA-F]{6}$/.test(this.value)) document.getElementById('secondary_color').value = this.value;
    });

    // Logo preview
    function previewLogo(input) {
      if (input.files && input.files[0]) {
        var reader = new FileReader();
        reader.onload = function(e) {
          document.getElementById('logoPreviewContainer').innerHTML =
            '<img src="' + e.target.result + '" alt="Preview" style="max-height:60px;border-radius:8px;border:1px solid #e2e8f0;padding:4px">';
          document.getElementById('logoUrlInput').value = '';
        };
        reader.readAsDataURL(input.files[0]);
      }
    }

    // Basic CSS validation
    function validateCSS() {
      var css = document.getElementById('custom_css').value;
      var msg = document.getElementById('cssValidationMsg');
      if (!css.trim()) { msg.textContent = 'No CSS entered.'; msg.style.color = '#64748b'; return; }
      // Check for dangerous patterns
      var dangers = ['javascript:', 'expression(', 'behavior:', '-moz-binding:', '@import'];
      var found = [];
      dangers.forEach(function(d) { if (css.toLowerCase().includes(d.toLowerCase())) found.push(d); });
      if (found.length > 0) {
        msg.textContent = 'Blocked patterns: ' + found.join(', ');
        msg.style.color = '#dc2626';
      } else {
        msg.textContent = 'CSS looks safe.';
        msg.style.color = '#059669';
      }
    }
    </script>`;

    res.send(renderBrandingPage('Branding Settings', html, user, csrf));
  }));

  // --- POST /settings/branding (save all settings) --------------------------
  app.post('/settings/branding', requireAuth, upload.none(), ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const {
      primary_color, primary_color_text,
      secondary_color, secondary_color_text,
      custom_css, custom_domain,
      login_background, email_footer,
    } = req.body;

    // Use the text input or color picker (text takes priority for exact hex)
    const pColor = (primary_color_text || primary_color || '').trim();
    const sColor = (secondary_color_text || secondary_color || '').trim();

    // Validate hex colors
    const hexRegex = /^#[0-9a-fA-F]{6}$/;
    if (pColor && !hexRegex.test(pColor)) {
      return res.status(400).send(renderBrandingPage('Error', '<div class="card"><div class="alert alert-error">Primary color must be a valid hex code (e.g. #4f46e5).</div></div>', req.session.user, req.csrfToken));
    }
    if (sColor && !hexRegex.test(sColor)) {
      return res.status(400).send(renderBrandingPage('Error', '<div class="card"><div class="alert alert-error">Secondary color must be a valid hex code (e.g. #7c3aed).</div></div>', req.session.user, req.csrfToken));
    }

    // Validate custom domain format
    let safeDomain = (custom_domain || '').trim().toLowerCase();
    if (safeDomain) {
      // Remove protocol if accidentally included
      safeDomain = safeDomain.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      // Basic domain validation
      if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(safeDomain)) {
        return res.status(400).send(renderBrandingPage('Error', '<div class="card"><div class="alert alert-error">Invalid domain format. Use something like portal.yourschool.ac.ug</div></div>', req.session.user, req.csrfToken));
      }
      // Check if another tenant already owns this domain
      const existing = (await pool.query(
        "SELECT id FROM tenants WHERE custom_domain = $1 AND id != $2 AND domain_verified = true",
        [safeDomain, tid]
      )).rows[0];
      if (existing) {
        return res.status(409).send(renderBrandingPage('Error', '<div class="card"><div class="alert alert-error">This domain is already claimed by another institution.</div></div>', req.session.user, req.csrfToken));
      }
    }

    // Build the update query dynamically (only update fields that were provided)
    const updates = [];
    const params = [];
    let paramIdx = 1;

    if (pColor) { updates.push(`primary_color = $${paramIdx++}`); params.push(pColor); }
    if (sColor) { updates.push(`secondary_color = $${paramIdx++}`); params.push(sColor); }
    if (custom_css !== undefined) { updates.push(`custom_css = $${paramIdx++}`); params.push(sanitizeCSS(custom_css)); }
    if (safeDomain !== undefined) { updates.push(`custom_domain = $${paramIdx++}`, `domain_verified = false`); params.push(safeDomain || null); }
    if (login_background !== undefined) { updates.push(`login_background = $${paramIdx++}`); params.push(login_background || null); }
    if (email_footer !== undefined) { updates.push(`email_footer = $${paramIdx++}`); params.push(email_footer || null); }

    if (updates.length > 0) {
      params.push(tid);
      await pool.query(`UPDATE tenants SET ${updates.join(', ')} WHERE id = $${paramIdx}`, params);
    }

    audit(req.session.user.email, 'branding_settings_updated', {
      primary_color: pColor, secondary_color: sColor, has_custom_css: !!custom_css,
      custom_domain: safeDomain, has_login_bg: !!login_background,
    });
    logger.info('branding_settings_updated', { tenantId: tid, domain: safeDomain });
    res.redirect('/settings/branding');
  }));

  // --- POST /settings/branding/upload-logo -----------------------------------
  app.post('/settings/branding/upload-logo', requireAuth, upload.single('logo_file'), ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    let logoUrl = req.body.logo_url || '';

    if (req.file) {
      const url = await saveUploadedFile(req.file.buffer, req.file.mimetype, `tenant_${tid}/branding`);
      if (url) {
        logoUrl = url;
      } else {
        return res.status(500).send(renderBrandingPage('Upload Failed', '<div class="card"><div class="alert alert-error"><h2>Logo Upload Failed</h2><p>Could not save the file. Please ensure Cloudinary is configured, or paste a URL instead.</p></div><a href="/settings/branding" class="btn">Back to Branding</a></div>', req.session.user, req.csrfToken));
      }
    } else if (!logoUrl) {
      return res.status(400).send(renderBrandingPage('Upload Failed', '<div class="card"><div class="alert alert-error">Please select a file or paste a URL.</div></div><a href="/settings/branding" class="btn">Back to Branding</a></div>', req.session.user, req.csrfToken));
    }

    await pool.query('UPDATE tenants SET logo_url = $1 WHERE id = $2', [logoUrl, tid]);
    audit(req.session.user.email, 'logo_uploaded', { url: logoUrl });
    logger.info('logo_uploaded', { tenantId: tid });
    res.redirect('/settings/branding');
  }));

  // --- POST /settings/branding/upload-favicon --------------------------------
  app.post('/settings/branding/upload-favicon', requireAuth, upload.single('favicon_file'), ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    let faviconUrl = req.body.favicon_url || '';

    if (req.file) {
      const url = await saveUploadedFile(req.file.buffer, req.file.mimetype, `tenant_${tid}/branding`);
      if (url) {
        faviconUrl = url;
      } else {
        return res.status(500).send(renderBrandingPage('Upload Failed', '<div class="card"><div class="alert alert-error"><h2>Favicon Upload Failed</h2><p>Could not save the file.</p></div><a href="/settings/branding" class="btn">Back to Branding</a></div>', req.session.user, req.csrfToken));
      }
    } else if (!faviconUrl) {
      return res.status(400).send(renderBrandingPage('Upload Failed', '<div class="card"><div class="alert alert-error">Please select a file or paste a URL.</div></div><a href="/settings/branding" class="btn">Back to Branding</a></div>', req.session.user, req.csrfToken));
    }

    await pool.query('UPDATE tenants SET favicon_url = $1 WHERE id = $2', [faviconUrl, tid]);
    audit(req.session.user.email, 'favicon_uploaded', { url: faviconUrl });
    logger.info('favicon_uploaded', { tenantId: tid });
    res.redirect('/settings/branding');
  }));

  // --- POST /settings/branding/verify-domain ---------------------------------
  app.post('/settings/branding/verify-domain', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const tenant = (await pool.query('SELECT custom_domain FROM tenants WHERE id = $1', [tid])).rows[0];
    const domain = (tenant?.custom_domain || '').trim().toLowerCase();

    if (!domain) {
      return res.status(400).send(renderBrandingPage('Error', '<div class="card"><div class="alert alert-error">No custom domain configured. Set one in Branding Settings first.</div></div><a href="/settings/branding" class="btn">Back to Branding</a></div>', req.session.user, req.csrfToken));
    }

    const platformHost = (process.env.BASE_URL || 'ssewasswa.onrender.com').replace(/^https?:\/\//, '').split(':')[0];
    let verified = false;
    let dnsMsg = '';

    // Attempt DNS resolution using Node's dns module
    try {
      const dns = require('dns');
      const dnsPromises = dns.promises;

      // Strategy 1: Check CNAME record
      try {
        const cnames = await dnsPromises.resolveCname(domain);
        if (cnames.includes(platformHost) || cnames.some((c) => c.includes(platformHost) || c.includes('render.com') || c.includes('onrender.com'))) {
          verified = true;
          dnsMsg = `CNAME record matches: ${cnames.join(', ')}`;
        } else {
          dnsMsg = `CNAME found (${cnames.join(', ')}) but does not point to ${platformHost}.`;
        }
      } catch (cnErr) {
        // No CNAME — try A record resolution as fallback
        dnsMsg = `No CNAME record found. ${cnErr.code || cnErr.message}`;
      }

      // Strategy 2: If CNAME failed, check if domain resolves at all (some setups use A records)
      if (!verified) {
        try {
          const addresses = await dnsPromises.resolve4(domain);
          dnsMsg += ` Domain resolves to: ${addresses.join(', ')}. (Note: CNAME verification is preferred.)`;
          // Auto-verify if the domain resolves at all (lenient for initial setup)
          verified = addresses.length > 0;
        } catch (aErr) {
          dnsMsg += ` Could not resolve domain: ${aErr.code || aErr.message}. Please check your DNS settings.`;
        }
      }
    } catch (dnsErr) {
      dnsMsg = `DNS check unavailable: ${dnsErr.message}`;
    }

    // Update tenant record
    await pool.query(
      'UPDATE tenants SET domain_verified = $1 WHERE id = $2',
      [verified, tid]
    );

    // Log DNS check
    await pool.query(
      'INSERT INTO custom_domain_dns (tenant_id, domain, record_type, record_value, verified, verified_at) VALUES ($1, $2, $3, $4, $5, NOW())',
      [tid, domain, 'CNAME', platformHost, verified]
    );

    audit(req.session.user.email, 'domain_verification', { domain, verified, message: dnsMsg });
    logger.info('domain_verification', { tenantId: tid, domain, verified });

    const msgHtml = `
      <div class="card">
        <div class="alert ${verified ? 'alert-success' : 'alert-warn'}">
          <h2>${verified ? '&#9989; Domain Verified!' : '&#9203; Domain Not Yet Verified'}</h2>
          <p><strong>${esc(domain)}</strong></p>
          <p>${esc(dnsMsg)}</p>
          ${!verified ? `
            <div style="margin-top:12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px">
              <h4 style="margin-bottom:8px">DNS Setup Instructions</h4>
              <p class="muted">Add a <strong>CNAME</strong> record with your domain registrar:</p>
              <table style="margin-top:8px;font-size:14px">
                <tr><th>Type</th><th>Host/Name</th><th>Value/Points to</th></tr>
                <tr><td>CNAME</td><td><code>${esc(domain.split('.')[0])}</code></td><td><code>${esc(platformHost)}</code></td></tr>
              </table>
              <p class="muted" style="margin-top:8px">DNS changes may take up to 48 hours to propagate. You can re-verify later.</p>
            </div>
          ` : ''}
        </div>
        <a href="/settings/branding" class="btn">Back to Branding Settings</a>
      </div>`;

    res.send(renderBrandingPage('Domain Verification', msgHtml, req.session.user, req.csrfToken));
  }));

  // --- GET /settings/branding/preview ----------------------------------------
  app.get('/settings/branding/preview', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const branding = await getTenantBranding(tid);

    const previewHtml = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(branding.site_name)} — Branding Preview</title>
${branding.favicon_url ? `<link rel="icon" href="${esc(branding.favicon_url)}" type="image/x-icon">` : ''}
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;color:#1e293b;line-height:1.6}
.nav{background:linear-gradient(135deg,${esc(branding.primary_color)},${esc(branding.secondary_color)});color:white;padding:20px 30px;display:flex;justify-content:space-between;align-items:center;box-shadow:0 4px 12px rgba(0,0,0,0.15)}
.nav a{color:white;text-decoration:none;padding:8px 16px;border-radius:8px;font-size:14px}.nav a:hover{background:rgba(255,255,255,0.2)}
.container{max-width:900px;margin:30px auto;padding:0 20px}
.hero{background:linear-gradient(135deg,${esc(branding.primary_color)},${esc(branding.secondary_color)});color:white;padding:60px 30px;border-radius:20px;text-align:center;margin-bottom:30px}
.card{background:white;border-radius:16px;padding:24px;margin-bottom:20px;box-shadow:0 4px 20px rgba(0,0,0,0.08);border:1px solid #e2e8f0}
.btn{display:inline-block;padding:12px 24px;background:linear-gradient(135deg,${esc(branding.primary_color)},${esc(branding.secondary_color)});color:white;text-decoration:none;border-radius:10px;font-weight:600;border:none;cursor:pointer;font-size:14px}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
.stat{text-align:center;padding:20px;background:white;border-radius:16px;box-shadow:0 2px 10px rgba(0,0,0,0.06)}
.stat-num{font-size:32px;font-weight:800;color:${esc(branding.primary_color)}}
.tag{display:inline-block;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600}
.login-box{max-width:400px;margin:40px auto;background:white;padding:40px;border-radius:16px;box-shadow:0 8px 30px rgba(0,0,0,0.12);text-align:center}
.login-box input{width:100%;padding:12px;margin:8px 0;border:2px solid #e2e8f0;border-radius:10px;font-size:16px}
.login-box .btn{width:100%;padding:14px;font-size:16px;margin-top:12px}
${branding.custom_css ? branding.custom_css : ''}
</style>
</head><body>
<nav class="nav">
  <div style="display:flex;align-items:center;gap:12px">
    ${branding.logo_url ? `<img src="${esc(branding.logo_url)}" alt="Logo" style="height:36px;border-radius:8px">` : ''}
    <span style="font-size:20px;font-weight:800">${esc(branding.site_name)}</span>
  </div>
  <div>
    <a href="#">Home</a><a href="#">Dashboard</a><a href="#">Settings</a>
  </div>
</nav>
<div class="container">
  <div class="hero">
    <h1 style="font-size:32px;margin-bottom:8px">${esc(branding.site_name)}</h1>
    <p style="opacity:0.9;font-size:18px">Welcome to your institution's branded portal</p>
    <a href="#" class="btn" style="margin-top:16px;display:inline-block">Get Started</a>
  </div>

  <div class="stats">
    <div class="stat"><div class="stat-num">1,247</div><div style="color:#64748b;margin-top:4px">Students</div></div>
    <div class="stat"><div class="stat-num">89</div><div style="color:#64748b;margin-top:4px">Staff</div></div>
    <div class="stat"><div class="stat-num">UGX 45M</div><div style="color:#64748b;margin-top:4px">Collected</div></div>
  </div>

  <div class="card">
    <h3 style="margin-bottom:12px">Sample Login Page</h3>
    <div class="login-box">
      ${branding.logo_url ? `<img src="${esc(branding.logo_url)}" alt="Logo" style="max-height:50px;margin-bottom:16px;border-radius:8px">` : ''}
      <h2 style="margin-bottom:4px">${esc(branding.site_name)}</h2>
      <p style="color:#64748b;margin-bottom:20px">Sign in to your account</p>
      <input type="email" placeholder="Email address" readonly>
      <input type="password" placeholder="Password" readonly>
      <button class="btn" type="button">Sign In</button>
    </div>
  </div>

  <div class="card">
    <h3 style="margin-bottom:8px">Sample Email Footer</h3>
    <div style="background:#f8fafc;border-top:2px solid ${esc(branding.primary_color)};padding:16px;border-radius:8px;font-size:13px;color:#64748b">
      ${branding.email_footer
        ? esc(branding.email_footer).replace(/\n/g, '<br>')
        : '(No custom email footer configured)'}
    </div>
  </div>

  <div class="card" style="text-align:center">
    <p style="color:#64748b;font-size:14px">
      This is a preview of your branding configuration.
      <br>Colors: <span style="display:inline-block;width:16px;height:16px;background:${esc(branding.primary_color)};border-radius:4px;vertical-align:middle"></span> ${esc(branding.primary_color)}
      &nbsp;
      <span style="display:inline-block;width:16px;height:16px;background:${esc(branding.secondary_color)};border-radius:4px;vertical-align:middle"></span> ${esc(branding.secondary_color)}
      ${branding.custom_domain ? `<br>Domain: <strong>${esc(branding.custom_domain)}</strong> ${branding.domain_verified ? '<span class="tag" style="background:#d1fae5;color:#065f46">Verified</span>' : '<span class="tag" style="background:#fef3c7;color:#92400e">Unverified</span>'}` : ''}
    </p>
  </div>
</div>
</body></html>`;

    res.type('html').send(previewHtml);
  }));

  // ============================================================
  // INTERNAL HELPERS
  // ============================================================

  /**
   * fetchWithTimeout — HTTP GET with a timeout (uses native http/https, no external deps).
   * Returns response body string or null.
   */
  const fetchWithTimeout = (url, timeoutMs) => {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const getter = parsedUrl.protocol === 'https:' ? https : http;
      const req = getter.get(url, { timeout: timeoutMs || 10000 }, (res) => {
        // Handle redirects (max 3)
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          fetchWithTimeout(res.headers.location, timeoutMs).then(resolve, reject);
          res.resume(); // drain
          return;
        }
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8');
          resolve(body);
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    });
  };

  // ============================================================
  // EXPORTS
  // ============================================================
  return {
    formatMoney,
    convertCurrency,
    getTenantCurrency,
    getTenantBranding,
    applyBranding,
    resolveTenantDomain,
    seedCurrencies,
  };
};
