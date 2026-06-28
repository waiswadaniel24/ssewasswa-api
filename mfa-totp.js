/**
 * MFA TOTP Module — School SaaS Portal
 * Time-based One-Time Password Multi-Factor Authentication
 * Compatible with Google Authenticator, Authy, etc.
 *
 * Usage:
 *   const mfaModule = require('./mfa-totp');
 *   mfaModule(app, pool, { esc, renderPage, ah, requireAuth, audit });
 */

const { migrateQuery } = require('./db');
module.exports = function (app, pool, opts) {
  const esc = opts.esc || (s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));
  const renderPage = opts.renderPage || ((t, c, u) => c);
  const ah = opts.ah || ((fn) => async (req, res, next) => { try { await fn(req, res, next); } catch (e) { res.status(500).send('Error: ' + e.message); } });
  const requireAuth = opts.requireAuth || ((req, res, next) => { if (!req.session?.user) return res.redirect('/login'); next(); });
  const audit = opts.audit || (() => {});

  const tenantId = (req) => req.session?.user?.tenant_id || 0;

  /* ─────────────────────── Encryption helpers ─────────────────────── */
  const ENC_KEY = process.env.MFA_ENC_KEY || 's3cur3-mfa-3ncr-key-32byt3s!!';
  const ALGO = 'aes-256-cbc';

  function encryptText(text) {
    const iv = require('crypto').randomBytes(16);
    const key = Buffer.alloc(32, ENC_KEY.slice(0, 32));
    const cipher = require('crypto').createCipheriv(ALGO, key, iv);
    let enc = cipher.update(text, 'utf8', 'hex');
    enc += cipher.final('hex');
    return iv.toString('hex') + ':' + enc;
  }

  function decryptText(blob) {
    try {
      const parts = String(blob).split(':');
      const iv = Buffer.from(parts[0], 'hex');
      const key = Buffer.alloc(32, ENC_KEY.slice(0, 32));
      const decipher = require('crypto').createDecipheriv(ALGO, key, iv);
      let dec = decipher.update(parts[1], 'hex', 'utf8');
      dec += decipher.final('utf8');
      return dec;
    } catch (_) { return null; }
  }

  /* ─────────────────────── TOTP helpers ─────────────────────── */
  const crypto = require('crypto');

  const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

  function base32Encode(buf) {
    let bits = '';
    for (const b of buf) bits += b.toString(2).padStart(8, '0');
    let result = '';
    for (let i = 0; i + 5 <= bits.length; i += 5) {
      result += BASE32_CHARS[parseInt(bits.slice(i, i + 5), 2)];
    }
    return result;
  }

  function generateSecret(len) {
    const bytes = crypto.randomBytes(len || 20);
    return base32Encode(bytes);
  }

  function generateBackupCodes(count) {
    const codes = [];
    for (let i = 0; i < (count || 10); i++) {
      codes.push(crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 8));
    }
    return codes;
  }

  async function hashBackupCode(code) {
    const salt = crypto.randomBytes(8).toString('hex');
    return new Promise((resolve, reject) => {
      require('bcrypt').hash(code, 10).then(resolve).catch(reject);
    });
  }

  async function verifyBackupCode(code, hash) {
    return new Promise((resolve, reject) => {
      require('bcrypt').compare(code, hash).then(resolve).catch(reject);
    });
  }

  function generateTOTP(secret, time) {
    const key = Buffer.from(secret.replace(/\s/g, ''), 'base32');
    const t = Math.floor((time || Date.now()) / 30000);
    const tb = Buffer.alloc(8);
    tb.writeUInt32BE(Math.floor(t / 0x100000000), 0);
    tb.writeUInt32BE(t & 0xffffffff, 4);
    const hmac = crypto.createHmac('sha1', key).update(tb).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const binary = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16)
      | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
    const otp = binary % 1000000;
    return otp.toString().padStart(6, '0');
  }

  function getOtpAuthUri(email, secret) {
    return `otpauth://totp/ComfortZone:${email}?secret=${secret}&issuer=ComfortZone`;
  }

  function getQrUrl(email, secret) {
    return `https://chart.googleapis.com/chart?chs=200x200&cht=qr&chl=${encodeURIComponent(getOtpAuthUri(email, secret))}`;
  }

  function deviceFingerprint(req) {
    const ua = req.headers['user-agent'] || '';
    return crypto.createHash('sha256').update(ua).digest('hex').slice(0, 32);
  }

  /* ─────────────────────── Rate limiter (in-memory) ─────────────────────── */
  const rateMap = new Map();

  function checkRateLimit(ip, max, windowSec) {
    const now = Date.now();
    const key = 'mfa:' + ip;
    const entry = rateMap.get(key);
    if (!entry || now - entry.start > windowSec * 1000) {
      rateMap.set(key, { start: now, count: 1 });
      return true;
    }
    entry.count++;
    return entry.count <= max;
  }

  /* ─────────────────────── DB migrations ─────────────────────── */
  (async function migrate() {
    const sql = `
      CREATE TABLE IF NOT EXISTS mfa_secrets (
        id SERIAL PRIMARY KEY,
        tenant_id INT NOT NULL DEFAULT 0,
        user_email VARCHAR(255) NOT NULL,
        secret_key TEXT NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT false,
        verified_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_mfa_secrets_tenant_email ON mfa_secrets(tenant_id, user_email);

      CREATE TABLE IF NOT EXISTS mfa_backup_codes (
        id SERIAL PRIMARY KEY,
        tenant_id INT NOT NULL DEFAULT 0,
        user_email VARCHAR(255) NOT NULL,
        code_hash VARCHAR(255) NOT NULL,
        used BOOLEAN NOT NULL DEFAULT false,
        used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_backup_codes_tenant_email ON mfa_backup_codes(tenant_id, user_email);

      CREATE TABLE IF NOT EXISTS mfa_verification_log (
        id SERIAL PRIMARY KEY,
        tenant_id INT NOT NULL DEFAULT 0,
        user_email VARCHAR(255) NOT NULL,
        method VARCHAR(50) NOT NULL DEFAULT 'totp',
        success BOOLEAN NOT NULL DEFAULT false,
        ip_address VARCHAR(45),
        user_agent TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_vlog_tenant_email ON mfa_verification_log(tenant_id, user_email, created_at DESC);

      CREATE TABLE IF NOT EXISTS mfa_trusted_devices (
        id SERIAL PRIMARY KEY,
        tenant_id INT NOT NULL DEFAULT 0,
        user_email VARCHAR(255) NOT NULL,
        device_name VARCHAR(255),
        device_fingerprint VARCHAR(64) NOT NULL,
        trusted_until TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_td_tenant_email ON mfa_trusted_devices(tenant_id, user_email, device_fingerprint);

      CREATE TABLE IF NOT EXISTS mfa_settings (
        id SERIAL PRIMARY KEY,
        tenant_id INT NOT NULL DEFAULT 0,
        enforce_mfa BOOLEAN NOT NULL DEFAULT false,
        require_for_roles TEXT[] NOT NULL DEFAULT '{}',
        allow_backup_codes BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(tenant_id)
      );
    `;
    await migrateQuery(pool, 'MFATotp', sql);
    console.log('[mfa-totp] Migrations complete.');
  })().catch(() => {});

  /* ─────────────────────── Shared UI snippets ─────────────────────── */
  const SKIP = `
    <style>
      :root{--pri:#4f46e5;--pri-light:#6366f1;--gray:#6b7280;--gray-light:#f3f4f6;--danger:#ef4444;--success:#10b981;--warn:#f59e0b;--radius:10px;--shadow:0 1px 3px rgba(0,0,0,.1)}
      .mfa-wrap{max-width:960px;margin:0 auto;padding:24px 16px;font-family:system-ui,-apple-system,sans-serif;color:#1f2937}
      .mfa-card{background:#fff;border-radius:var(--radius);box-shadow:var(--shadow);padding:24px;margin-bottom:20px}
      .mfa-card h2{margin:0 0 16px;font-size:1.25rem;color:#111827}
      .mfa-card h3{margin:0 0 10px;font-size:1.05rem;color:#374151}
      .mfa-btn{display:inline-block;padding:10px 20px;border-radius:6px;border:none;cursor:pointer;font-size:.9rem;font-weight:600;text-decoration:none;transition:background .15s}
      .mfa-btn-primary{background:var(--pri);color:#fff}.mfa-btn-primary:hover{background:var(--pri-light)}
      .mfa-btn-danger{background:var(--danger);color:#fff}.mfa-btn-danger:hover{background:#dc2626}
      .mfa-btn-outline{background:transparent;border:1px solid var(--gray);color:#374151}.mfa-btn-outline:hover{background:var(--gray-light)}
      .mfa-btn-success{background:var(--success);color:#fff}.mfa-btn-success:hover{background:#059669}
      .mfa-btn:disabled{opacity:.5;cursor:not-allowed}
      .mfa-tabs{display:flex;gap:4px;border-bottom:2px solid var(--gray-light);margin-bottom:20px;flex-wrap:wrap}
      .mfa-tab{padding:10px 16px;cursor:pointer;border:none;background:none;font-size:.9rem;color:var(--gray);border-bottom:2px solid transparent;margin-bottom:-2px;transition:all .15s}
      .mfa-tab.active{color:var(--pri);border-bottom-color:var(--pri);font-weight:600}
      .mfa-tab:hover{color:var(--pri)}
      .mfa-table{width:100%;border-collapse:collapse;font-size:.88rem}
      .mfa-table th{text-align:left;padding:10px 12px;background:var(--gray-light);font-weight:600;color:#374151;border-bottom:2px solid #e5e7eb}
      .mfa-table td{padding:10px 12px;border-bottom:1px solid #e5e7eb}
      .mfa-table tr:hover td{background:#f9fafb}
      .mfa-badge{display:inline-block;padding:2px 10px;border-radius:12px;font-size:.78rem;font-weight:600}
      .mfa-badge-green{background:#d1fae5;color:#065f46}
      .mfa-badge-red{background:#fee2e2;color:#991b1b}
      .mfa-badge-yellow{background:#fef3c7;color:#92400e}
      .mfa-input{padding:10px 14px;border:1px solid #d1d5db;border-radius:6px;font-size:.9rem;width:100%;max-width:320px;box-sizing:border-box}
      .mfa-input:focus{outline:none;border-color:var(--pri);box-shadow:0 0 0 3px rgba(79,70,229,.15)}
      .mfa-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px}
      .mfa-stat{text-align:center;padding:20px}
      .mfa-stat .num{font-size:2rem;font-weight:700;color:var(--pri)}
      .mfa-stat .lbl{font-size:.82rem;color:var(--gray);margin-top:4px}
      .mfa-qr{text-align:center;padding:20px}
      .mfa-qr img{border:8px solid var(--gray-light);border-radius:8px}
      .mfa-secret{font-family:monospace;font-size:1rem;background:var(--gray-light);padding:10px 16px;border-radius:6px;word-break:break-all;letter-spacing:1px}
      .mfa-codes{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px}
      .mfa-code-item{background:var(--gray-light);padding:8px 12px;border-radius:6px;font-family:monospace;font-size:.92rem;text-align:center}
      .mfa-flash{padding:12px 16px;border-radius:6px;margin-bottom:16px;font-size:.9rem}
      .mfa-flash-ok{background:#d1fae5;color:#065f46}
      .mfa-flash-err{background:#fee2e2;color:#991b1b}
      .mfa-empty{text-align:center;padding:32px;color:var(--gray);font-size:.92rem}
      @media(max-width:600px){.mfa-grid{grid-template-columns:1fr}.mfa-tabs{gap:0}.mfa-tab{padding:8px 10px;font-size:.82rem}}
    </style>
    <link rel="stylesheet" href="/css/sk.css">
  `;

  function navTabs(active) {
    const tabs = [
      ['/school/mfa', 'Dashboard'],
      ['/school/mfa/setup', 'Setup'],
      ['/school/mfa/backup-codes', 'Backup Codes'],
      ['/school/mfa/log', 'Activity Log'],
      ['/school/mfa/admin', 'Admin'],
      ['/school/mfa/stats', 'Statistics']
    ];
    return `<nav class="mfa-tabs">${tabs.map(([href, label]) =>
      `<a class="mfa-tab${active === href ? ' active' : ''}" href="${href}">${esc(label)}</a>`
    ).join('')}</nav>`;
  }

  function flashMsg(type, msg) {
    if (!msg) return '';
    return `<div class="mfa-flash mfa-flash-${type === 'error' ? 'err' : 'ok'}">${esc(msg)}</div>`;
  }

  /* ─────────────────────── Logging helper ─────────────────────── */
  async function logVerification(tid, email, method, success, req) {
    await pool.query(
      `INSERT INTO mfa_verification_log (tenant_id, user_email, method, success, ip_address, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [tid, email, method, success, req.ip || req.connection?.remoteAddress, req.headers['user-agent'] || '']
    );
  }

  /* ═══════════════════════ ROUTES ═══════════════════════ */

  /* ── 1. GET /school/mfa — Dashboard ──────────────────────────── */
  app.get('/school/mfa', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const email = req.session.user.email;
    const userRole = req.session.user.role || 'user';

    const secretRes = await pool.query(
      `SELECT enabled, verified_at, created_at FROM mfa_secrets WHERE tenant_id=$1 AND user_email=$2`,
      [tid, email]
    );
    const mfaData = secretRes.rows[0] || {};

    const codesRes = await pool.query(
      `SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE used=true) as used_count
       FROM mfa_backup_codes WHERE tenant_id=$1 AND user_email=$2`,
      [tid, email]
    );
    const codeStats = codesRes.rows[0];

    const logRes = await pool.query(
      `SELECT method, success, created_at FROM mfa_verification_log
       WHERE tenant_id=$1 AND user_email=$2 ORDER BY created_at DESC LIMIT 10`,
      [tid, email]
    );

    const settingsRes = await pool.query(
      `SELECT enforce_mfa, require_for_roles FROM mfa_settings WHERE tenant_id=$1`, [tid]
    );
    const settings = settingsRes.rows[0] || {};
    const isEnforced = settings.enforce_mfa || (settings.require_for_roles || []).includes(userRole);

    const trustedRes = await pool.query(
      `SELECT device_name, trusted_until FROM mfa_trusted_devices
       WHERE tenant_id=$1 AND user_email=$2 AND trusted_until > NOW()`,
      [tid, email]
    );

    let content = SKIP + navTabs('/school/mfa');
    content += flashMsg(req.query.flash_type, req.query.flash);

    content += `<div class="mfa-card"><h2>Multi-Factor Authentication</h2>`;
    content += `<div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap">`;
    content += `<span style="font-size:1rem;font-weight:600">Status:</span>`;
    if (mfaData.enabled) {
      content += `<span class="mfa-badge mfa-badge-green">Enabled</span>`;
      if (isEnforced) content += `<span class="mfa-badge mfa-badge-yellow">Enforced by admin</span>`;
    } else {
      content += `<span class="mfa-badge mfa-badge-red">Disabled</span>`;
      if (isEnforced) content += `<span class="mfa-badge mfa-badge-yellow">Required — Please enable now</span>`;
    }
    content += `</div>`;

    if (mfaData.enabled) {
      content += `<a class="mfa-btn mfa-btn-danger" href="#" onclick="document.getElementById('disableForm').style.display='block';return false">Disable MFA</a> `;
      content += `<a class="mfa-btn mfa-btn-outline" href="/school/mfa/backup-codes">View Backup Codes</a>`;
      content += `<form id="disableForm" style="display:none;margin-top:16px;padding:16px;background:#fef2f2;border-radius:8px" method="POST" action="/school/mfa/disable">`;
      content += `<h3 style="color:#991b1b;margin-bottom:10px">Disable MFA?</h3>`;
      content += `<p style="font-size:.9rem;color:#6b7280;margin-bottom:12px">Enter your current TOTP code to confirm.</p>`;
      content += `<input class="mfa-input" name="code" placeholder="Enter TOTP code" required autocomplete="off"> `;
      content += `<button class="mfa-btn mfa-btn-danger" type="submit">Confirm Disable</button> `;
      content += `<button class="mfa-btn mfa-btn-outline" type="button" onclick="this.form.style.display='none'">Cancel</button>`;
      content += `</form>`;
    } else {
      content += `<a class="mfa-btn mfa-btn-primary" href="/school/mfa/setup">Set Up MFA</a>`;
      content += `<p style="margin-top:12px;font-size:.88rem;color:var(--gray)">
        Add an extra layer of security to your account using an authenticator app.</p>`;
    }
    content += `</div>`;

    /* stats row */
    content += `<div class="mfa-grid">`;
    content += `<div class="mfa-card mfa-stat"><div class="num">${codeStats.total - codeStats.used_count}</div><div class="lbl">Backup Codes Remaining</div></div>`;
    content += `<div class="mfa-card mfa-stat"><div class="num">${trustedRes.rows.length}</div><div class="lbl">Trusted Devices</div></div>`;
    content += `<div class="mfa-card mfa-stat"><div class="num">${logRes.rows.filter(r => r.success).length}/${logRes.rows.length}</div><div class="lbl">Recent Success Rate</div></div>`;
    content += `</div>`;

    /* recent log */
    content += `<div class="mfa-card"><h3>Recent Verification Activity</h3>`;
    if (logRes.rows.length === 0) {
      content += `<div class="mfa-empty">No verification attempts recorded yet.</div>`;
    } else {
      content += `<div style="overflow-x:auto"><table class="mfa-table"><thead><tr>
        <th>Method</th><th>Result</th><th>Time</th></tr></thead><tbody>`;
      for (const r of logRes.rows) {
        content += `<tr><td>${esc(r.method.toUpperCase())}</td>
          <td><span class="mfa-badge ${r.success ? 'mfa-badge-green' : 'mfa-badge-red'}">${r.success ? 'Success' : 'Failed'}</span></td>
          <td>${esc(new Date(r.created_at).toLocaleString())}</td></tr>`;
      }
      content += `</tbody></table></div>`;
    }
    content += `</div>`;

    res.send(renderPage('MFA Dashboard', content, req.session.user));
  }));

  /* ── 2. GET /school/mfa/setup — QR Code Setup ────────────────── */
  app.get('/school/mfa/setup', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const email = req.session.user.email;

    const existing = await pool.query(
      `SELECT enabled, secret_key FROM mfa_secrets WHERE tenant_id=$1 AND user_email=$2`, [tid, email]
    );

    let secret;
    if (existing.rows[0] && !existing.rows[0].enabled) {
      secret = decryptText(existing.rows[0].secret_key);
    } else if (existing.rows[0] && existing.rows[0].enabled) {
      return res.redirect(`/school/mfa?flash_type=error&flash=${encodeURIComponent('MFA is already enabled. Disable it first to reconfigure.')}`);
    } else {
      secret = generateSecret(20);
      await pool.query(
        `INSERT INTO mfa_secrets (tenant_id, user_email, secret_key) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [tid, email, encryptText(secret)]
      );
    }

    const qrUrl = getQrUrl(email, secret);

    let content = SKIP + navTabs('/school/mfa/setup');
    content += flashMsg(req.query.flash_type, req.query.flash);

    content += `<div class="mfa-card"><h2>Set Up Multi-Factor Authentication</h2>`;
    content += `<div style="display:flex;gap:32px;flex-wrap:wrap;align-items:flex-start">`;
    content += `<div style="flex:1;min-width:240px">
      <h3>Step 1: Scan QR Code</h3>
      <p style="font-size:.9rem;color:var(--gray);margin-bottom:12px">
        Open your authenticator app (Google Authenticator, Authy, etc.) and scan this QR code.</p>
      <div class="mfa-qr"><img src="${esc(qrUrl)}" alt="TOTP QR Code" width="200" height="200"></div>
      <p style="font-size:.85rem;color:var(--gray);margin-top:10px">Or enter this secret key manually:</p>
      <div class="mfa-secret">${esc(secret)}</div>
    </div>`;
    content += `<div style="flex:1;min-width:240px">
      <h3>Step 2: Verify Code</h3>
      <p style="font-size:.9rem;color:var(--gray);margin-bottom:12px">
        Enter the 6-digit code from your authenticator app to confirm setup.</p>
      <form method="POST" action="/school/mfa/setup">
        <input class="mfa-input" name="code" placeholder="6-digit code" required autocomplete="off" pattern="[0-9]{6}" maxlength="6" inputmode="numeric">
        <br><br>
        <button class="mfa-btn mfa-btn-success" type="submit">Verify &amp; Enable MFA</button>
      </form>
    </div>`;
    content += `</div></div>`;

    res.send(renderPage('MFA Setup', content, req.session.user));
  }));

  /* ── 3. POST /school/mfa/setup — Verify first code ──────────── */
  app.post('/school/mfa/setup', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const email = req.session.user.email;
    const code = (req.body.code || '').trim();

    const secretRes = await pool.query(
      `SELECT secret_key FROM mfa_secrets WHERE tenant_id=$1 AND user_email=$2`, [tid, email]
    );
    if (!secretRes.rows[0]) {
      return res.redirect('/school/mfa/setup?flash_type=error&flash=No+MFA+secret+found.+Please+refresh.');
    }

    const secret = decryptText(secretRes.rows[0].secret_key);
    if (!secret) {
      return res.redirect('/school/mfa/setup?flash_type=error&flash=Failed+to+decrypt+secret.+Contact+administrator.');
    }

    const valid = generateTOTP(secret) === code || generateTOTP(secret, Date.now() - 30000) === code
      || generateTOTP(secret, Date.now() + 30000) === code;

    await logVerification(tid, email, 'totp', valid, req);

    if (!valid) {
      return res.redirect('/school/mfa/setup?flash_type=error&flash=Invalid+code.+Please+try+again.');
    }

    await pool.query(
      `UPDATE mfa_secrets SET enabled=true, verified_at=NOW() WHERE tenant_id=$1 AND user_email=$2`,
      [tid, email]
    );

    /* Generate backup codes */
    const codes = generateBackupCodes(10);
    for (const c of codes) {
      const hash = await hashBackupCode(c);
      await pool.query(
        `INSERT INTO mfa_backup_codes (tenant_id, user_email, code_hash) VALUES ($1,$2,$3)`,
        [tid, email, hash]
      );
    }

    audit({ action: 'mfa_enabled', email, tid });
    req.session.user.mfa_enabled = true;

    let content = SKIP + navTabs('/school/mfa/setup');
    content += `<div class="mfa-card"><h2>MFA Enabled Successfully!</h2>`;
    content += `<p style="color:var(--success);font-weight:600;margin-bottom:16px">Your account is now protected with multi-factor authentication.</p>`;
    content += `<h3>Save Your Backup Codes</h3>`;
    content += `<p style="font-size:.9rem;color:var(--gray);margin-bottom:12px">
      Store these codes in a safe place. Each code can only be used once.</p>`;
    content += `<div class="mfa-codes">`;
    for (const c of codes) {
      content += `<div class="mfa-code-item">${esc(c)}</div>`;
    }
    content += `</div>`;
    content += `<p style="margin-top:16px;font-size:.85rem;color:#ef4444;font-weight:600">
      These codes will not be shown again. Make sure to save them now.</p>`;
    content += `<br><a class="mfa-btn mfa-btn-primary" href="/school/mfa">Go to Dashboard</a>`;
    content += `</div>`;

    res.send(renderPage('MFA Enabled', content, req.session.user));
  }));

  /* ── 4. POST /school/mfa/disable ────────────────────────────── */
  app.post('/school/mfa/disable', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const email = req.session.user.email;
    const code = (req.body.code || '').trim();

    const secretRes = await pool.query(
      `SELECT secret_key FROM mfa_secrets WHERE tenant_id=$1 AND user_email=$2 AND enabled=true`,
      [tid, email]
    );
    if (!secretRes.rows[0]) {
      return res.redirect('/school/mfa?flash_type=error&flash=MFA+is+not+enabled.');
    }

    const secret = decryptText(secretRes.rows[0].secret_key);
    const valid = generateTOTP(secret) === code || generateTOTP(secret, Date.now() - 30000) === code
      || generateTOTP(secret, Date.now() + 30000) === code;

    await logVerification(tid, email, 'totp', valid, req);

    if (!valid) {
      return res.redirect('/school/mfa?flash_type=error&flash=Invalid+code.+MFA+was+not+disabled.');
    }

    await pool.query(
      `UPDATE mfa_secrets SET enabled=false, verified_at=NULL WHERE tenant_id=$1 AND user_email=$2`,
      [tid, email]
    );
    await pool.query(`DELETE FROM mfa_backup_codes WHERE tenant_id=$1 AND user_email=$2`, [tid, email]);
    await pool.query(`DELETE FROM mfa_trusted_devices WHERE tenant_id=$1 AND user_email=$2`, [tid, email]);

    audit({ action: 'mfa_disabled', email, tid });
    req.session.user.mfa_enabled = false;

    res.redirect('/school/mfa?flash_type=ok&flash=MFA+has+been+disabled+successfully.');
  }));

  /* ── 5. POST /school/mfa/verify — API endpoint ──────────────── */
  app.post('/school/mfa/verify', ah(async (req, res) => {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';

    if (!checkRateLimit(ip, 5, 60)) {
      return res.status(429).json({ success: false, error: 'Too many attempts. Try again in 1 minute.' });
    }

    const { email, code, method } = req.body;
    if (!email || !code) {
      return res.status(400).json({ success: false, error: 'Email and code are required.' });
    }

    const tid = req.body.tenant_id || 0;
    const cleanEmail = email.trim().toLowerCase();
    const cleanCode = code.trim();
    const verifyMethod = (method || 'totp').toLowerCase();

    /* Check trusted device */
    if (req.body.device_fingerprint) {
      const tdRes = await pool.query(
        `SELECT id FROM mfa_trusted_devices WHERE tenant_id=$1 AND user_email=$2 AND device_fingerprint=$3 AND trusted_until > NOW()`,
        [tid, cleanEmail, req.body.device_fingerprint]
      );
      if (tdRes.rows.length > 0) {
        await logVerification(tid, cleanEmail, 'trusted_device', true, req);
        return res.json({ success: true, method: 'trusted_device' });
      }
    }

    /* Check if MFA is even enabled */
    const secretRes = await pool.query(
      `SELECT secret_key FROM mfa_secrets WHERE tenant_id=$1 AND user_email=$2 AND enabled=true`,
      [tid, cleanEmail]
    );
    if (!secretRes.rows[0]) {
      return res.status(403).json({ success: false, error: 'MFA is not enabled for this account.' });
    }

    let valid = false;

    if (verifyMethod === 'backup') {
      const codesRes = await pool.query(
        `SELECT id, code_hash FROM mfa_backup_codes WHERE tenant_id=$1 AND user_email=$2 AND used=false`,
        [tid, cleanEmail]
      );
      for (const row of codesRes.rows) {
        if (await verifyBackupCode(cleanCode, row.code_hash)) {
          valid = true;
          await pool.query(`UPDATE mfa_backup_codes SET used=true, used_at=NOW() WHERE id=$1`, [row.id]);
          break;
        }
      }
    } else {
      const secret = decryptText(secretRes.rows[0].secret_key);
      if (secret) {
        valid = generateTOTP(secret) === cleanCode || generateTOTP(secret, Date.now() - 30000) === cleanCode
          || generateTOTP(secret, Date.now() + 30000) === cleanCode;
      }
    }

    await logVerification(tid, cleanEmail, verifyMethod, valid, req);
    audit({ action: 'mfa_verify', email: cleanEmail, tid, method: verifyMethod, success: valid });

    if (valid) {
      res.json({ success: true, method: verifyMethod });
    } else {
      res.status(401).json({ success: false, error: 'Invalid verification code.' });
    }
  }));

  /* ── 6. GET /school/mfa/backup-codes ────────────────────────── */
  app.get('/school/mfa/backup-codes', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const email = req.session.user.email;

    const mfaRes = await pool.query(
      `SELECT enabled FROM mfa_secrets WHERE tenant_id=$1 AND user_email=$2`, [tid, email]
    );
    if (!mfaRes.rows[0] || !mfaRes.rows[0].enabled) {
      return res.redirect('/school/mfa?flash_type=error&flash=Enable+MFA+first+to+manage+backup+codes.');
    }

    const codesRes = await pool.query(
      `SELECT id, used, used_at, created_at FROM mfa_backup_codes WHERE tenant_id=$1 AND user_email=$2 ORDER BY id`,
      [tid, email]
    );

    let content = SKIP + navTabs('/school/mfa/backup-codes');
    content += flashMsg(req.query.flash_type, req.query.flash);

    content += `<div class="mfa-card"><h2>Backup Codes</h2>`;
    content += `<p style="font-size:.9rem;color:var(--gray);margin-bottom:16px">
      Use these codes when you don't have access to your authenticator app. Each code can only be used once.</p>`;

    const unused = codesRes.rows.filter(r => !r.used);
    const used = codesRes.rows.filter(r => r.used);

    if (unused.length > 0) {
      content += `<h3>Available Codes (${unused.length})</h3>`;
      content += `<div class="mfa-codes" style="margin-bottom:20px">`;
      content += `<div class="mfa-code-item" style="background:var(--gray-light);color:var(--gray);font-size:.8rem;font-weight:600;font-family:system-ui">These codes are stored hashed and cannot be displayed again.</div>`;
      content += `<div class="mfa-code-item" style="grid-column:1/-1;background:#fffbeb;color:#92400e;font-size:.85rem;font-family:system-ui;text-align:center;padding:12px">
        ⚠️ Original backup codes were shown once during setup. Regenerate below if lost.</div>`;
      content += `</div>`;
    }

    if (used.length > 0) {
      content += `<h3>Used Codes (${used.length})</h3>`;
      content += `<div style="overflow-x:auto"><table class="mfa-table"><thead><tr><th>ID</th><th>Used At</th><th>Created</th></tr></thead><tbody>`;
      for (const r of used) {
        content += `<tr><td>#${r.id}</td><td>${esc(new Date(r.used_at).toLocaleString())}</td><td>${esc(new Date(r.created_at).toLocaleString())}</td></tr>`;
      }
      content += `</tbody></table></div>`;
    }

    content += `<div style="margin-top:20px;padding-top:16px;border-top:1px solid #e5e7eb">`;
    content += `<h3>Regenerate Backup Codes</h3>`;
    content += `<p style="font-size:.88rem;color:var(--gray);margin-bottom:12px">
      This will invalidate all existing backup codes and generate a new set.</p>`;
    content += `<form method="POST" action="/school/mfa/backup-codes/regenerate" onsubmit="return confirm('Are you sure? All existing backup codes will be invalidated.')">`;
    content += `<button class="mfa-btn mfa-btn-danger" type="submit">Regenerate All Codes</button>`;
    content += `</form></div>`;
    content += `</div>`;

    res.send(renderPage('Backup Codes', content, req.session.user));
  }));

  /* ── 7. POST /school/mfa/backup-codes/regenerate ────────────── */
  app.post('/school/mfa/backup-codes/regenerate', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const email = req.session.user.email;

    await pool.query(`DELETE FROM mfa_backup_codes WHERE tenant_id=$1 AND user_email=$2`, [tid, email]);

    const codes = generateBackupCodes(10);
    for (const c of codes) {
      const hash = await hashBackupCode(c);
      await pool.query(
        `INSERT INTO mfa_backup_codes (tenant_id, user_email, code_hash) VALUES ($1,$2,$3)`,
        [tid, email, hash]
      );
    }

    audit({ action: 'backup_codes_regenerated', email, tid });

    let content = SKIP + navTabs('/school/mfa/backup-codes');
    content += `<div class="mfa-card"><h2>New Backup Codes Generated</h2>`;
    content += `<p style="color:var(--warn);font-weight:600;margin-bottom:16px">
      All previous backup codes have been invalidated. Save these new codes now.</p>`;
    content += `<div class="mfa-codes">`;
    for (const c of codes) {
      content += `<div class="mfa-code-item">${esc(c)}</div>`;
    }
    content += `</div>`;
    content += `<p style="margin-top:16px;font-size:.85rem;color:#ef4444;font-weight:600">
      These codes will not be shown again.</p>`;
    content += `<br><a class="mfa-btn mfa-btn-primary" href="/school/mfa/backup-codes">Back to Backup Codes</a>`;
    content += `</div>`;

    res.send(renderPage('Backup Codes Regenerated', content, req.session.user));
  }));

  /* ── 8. GET /school/mfa/log — Verification log ──────────────── */
  app.get('/school/mfa/log', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const email = req.session.user.email;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 25;
    const offset = (page - 1) * limit;

    const countRes = await pool.query(
      `SELECT COUNT(*) as total FROM mfa_verification_log WHERE tenant_id=$1 AND user_email=$2`,
      [tid, email]
    );
    const total = parseInt(countRes.rows[0].total);
    const totalPages = Math.ceil(total / limit);

    const logRes = await pool.query(
      `SELECT method, success, ip_address, user_agent, created_at
       FROM mfa_verification_log WHERE tenant_id=$1 AND user_email=$2
       ORDER BY created_at DESC LIMIT $3 OFFSET $4`,
      [tid, email, limit, offset]
    );

    let content = SKIP + navTabs('/school/mfa/log');
    content += `<div class="mfa-card"><h2>Verification Activity Log</h2>`;

    if (logRes.rows.length === 0) {
      content += `<div class="mfa-empty">No verification attempts recorded yet.</div>`;
    } else {
      content += `<div style="overflow-x:auto"><table class="mfa-table"><thead><tr>
        <th>Method</th><th>Result</th><th>IP Address</th><th>User Agent</th><th>Time</th></tr></thead><tbody>`;
      for (const r of logRes.rows) {
        const uaShort = (r.user_agent || '').slice(0, 50);
        content += `<tr>
          <td>${esc(r.method.toUpperCase())}</td>
          <td><span class="mfa-badge ${r.success ? 'mfa-badge-green' : 'mfa-badge-red'}">${r.success ? 'Success' : 'Failed'}</span></td>
          <td>${esc(r.ip_address || '—')}</td>
          <td title="${esc(r.user_agent || '')}">${esc(uaShort || '—')}</td>
          <td>${esc(new Date(r.created_at).toLocaleString())}</td></tr>`;
      }
      content += `</tbody></table></div>`;
    }

    /* pagination */
    if (totalPages > 1) {
      content += `<div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">`;
      content += `<span style="font-size:.85rem;color:var(--gray)">Page ${page} of ${totalPages}</span>`;
      if (page > 1) {
        content += `<a class="mfa-btn mfa-btn-outline" href="/school/mfa/log?page=${page - 1}">&laquo; Previous</a>`;
      }
      if (page < totalPages) {
        content += `<a class="mfa-btn mfa-btn-outline" href="/school/mfa/log?page=${page + 1}">Next &raquo;</a>`;
      }
      content += `</div>`;
    }

    content += `</div>`;
    res.send(renderPage('MFA Activity Log', content, req.session.user));
  }));

  /* ── 9. POST /school/mfa/trust-device ───────────────────────── */
  app.post('/school/mfa/trust-device', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const email = req.session.user.email;
    const fingerprint = deviceFingerprint(req);
    const deviceName = (req.body.device_name || 'Unknown Device').slice(0, 255);
    const days = parseInt(req.body.days) || 30;
    const trustedUntil = new Date(Date.now() + days * 86400000);

    await pool.query(
      `INSERT INTO mfa_trusted_devices (tenant_id, user_email, device_name, device_fingerprint, trusted_until)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT DO NOTHING`,
      [tid, email, deviceName, fingerprint, trustedUntil]
    );

    audit({ action: 'device_trusted', email, tid, deviceName, fingerprint });
    res.json({ success: true, message: `Device trusted for ${days} days.`, trusted_until: trustedUntil });
  }));

  /* ── 10. GET /school/mfa/admin — Admin view ─────────────────── */
  app.get('/school/mfa/admin', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const role = req.session.user.role || 'user';
    if (role !== 'admin' && role !== 'superadmin') {
      return res.status(403).send('Access denied. Admin role required.');
    }

    const usersRes = await pool.query(
      `SELECT s.user_email, s.enabled, s.verified_at, s.created_at,
              (SELECT COUNT(*) FROM mfa_backup_codes bc WHERE bc.tenant_id=s.tenant_id AND bc.user_email=s.user_email AND bc.used=false) as backup_remaining
       FROM mfa_secrets s WHERE s.tenant_id=$1 ORDER BY s.user_email`,
      [tid]
    );

    const settingsRes = await pool.query(
      `SELECT enforce_mfa, require_for_roles, allow_backup_codes FROM mfa_settings WHERE tenant_id=$1`, [tid]
    );
    const settings = settingsRes.rows[0] || { enforce_mfa: false, require_for_roles: [], allow_backup_codes: true };

    let content = SKIP + navTabs('/school/mfa/admin');
    content += flashMsg(req.query.flash_type, req.query.flash);

    content += `<div class="mfa-card"><h2>MFA Administration</h2>`;

    /* current settings display */
    content += `<div style="margin-bottom:20px;padding:16px;background:var(--gray-light);border-radius:8px">`;
    content += `<h3>Current Settings</h3>`;
    content += `<table class="mfa-table" style="margin-top:8px"><tbody>`;
    content += `<tr><td style="font-weight:600;width:180px">Enforce MFA</td><td>${settings.enforce_mfa ? '<span class="mfa-badge mfa-badge-green">Yes</span>' : '<span class="mfa-badge mfa-badge-red">No</span>'}</td></tr>`;
    content += `<tr><td style="font-weight:600">Required Roles</td><td>${(settings.require_for_roles || []).length > 0 ? esc(settings.require_for_roles.join(', ')) : 'None'}</td></tr>`;
    content += `<tr><td style="font-weight:600">Backup Codes Allowed</td><td>${settings.allow_backup_codes ? 'Yes' : 'No'}</td></tr>`;
    content += `</tbody></table></div>`;

    /* enforce form */
    content += `<form method="POST" action="/school/mfa/admin/enforce" style="margin-bottom:20px">`;
    content += `<h3>Enforce MFA Policy</h3>`;
    content += `<div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">`;
    content += `<label style="font-size:.88rem"><input type="checkbox" name="enforce_mfa" value="1" ${settings.enforce_mfa ? 'checked' : ''}> Enforce MFA for all users</label>`;
    content += `<div><label style="font-size:.82rem;color:var(--gray)">Require for roles (comma separated)</label><br>
      <input class="mfa-input" name="roles" value="${esc((settings.require_for_roles || []).join(', '))}" style="max-width:300px"></div>`;
    content += `<label style="font-size:.88rem"><input type="checkbox" name="allow_backup" value="1" ${settings.allow_backup_codes ? 'checked' : ''}> Allow backup codes</label>`;
    content += `<button class="mfa-btn mfa-btn-primary" type="submit">Save Settings</button>`;
    content += `</div></form>`;

    /* user table */
    content += `<h3>Users with MFA Configured (${usersRes.rows.length})</h3>`;
    if (usersRes.rows.length === 0) {
      content += `<div class="mfa-empty">No users have configured MFA yet.</div>`;
    } else {
      content += `<div style="overflow-x:auto;max-height:400px;overflow-y:auto"><table class="mfa-table"><thead><tr>
        <th>Email</th><th>Status</th><th>Verified</th><th>Backup Codes</th><th>Created</th></tr></thead><tbody>`;
      for (const u of usersRes.rows) {
        content += `<tr>
          <td>${esc(u.user_email)}</td>
          <td><span class="mfa-badge ${u.enabled ? 'mfa-badge-green' : 'mfa-badge-red'}">${u.enabled ? 'Enabled' : 'Disabled'}</span></td>
          <td>${u.verified_at ? esc(new Date(u.verified_at).toLocaleDateString()) : '—'}</td>
          <td>${u.backup_remaining}</td>
          <td>${esc(new Date(u.created_at).toLocaleDateString())}</td></tr>`;
      }
      content += `</tbody></table></div>`;
    }
    content += `</div>`;

    res.send(renderPage('MFA Admin', content, req.session.user));
  }));

  /* ── 11. POST /school/mfa/admin/enforce ─────────────────────── */
  app.post('/school/mfa/admin/enforce', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const role = req.session.user.role || 'user';
    if (role !== 'admin' && role !== 'superadmin') {
      return res.status(403).send('Access denied.');
    }

    const enforceMfa = req.body.enforce_mfa === '1';
    const rolesStr = (req.body.roles || '').trim();
    const roles = rolesStr ? rolesStr.split(',').map(r => r.trim().toLowerCase()).filter(Boolean) : [];
    const allowBackup = req.body.allow_backup !== '0';

    await pool.query(
      `INSERT INTO mfa_settings (tenant_id, enforce_mfa, require_for_roles, allow_backup_codes)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (tenant_id) DO UPDATE SET enforce_mfa=$2, require_for_roles=$3, allow_backup_codes=$4`,
      [tid, enforceMfa, roles, allowBackup]
    );

    audit({ action: 'mfa_policy_updated', tid, enforceMfa, roles, allowBackup });

    res.redirect('/school/mfa/admin?flash_type=ok&flash=MFA+policy+updated+successfully.');
  }));

  /* ── 12. GET /school/mfa/stats — Statistics ─────────────────── */
  app.get('/school/mfa/stats', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const role = req.session.user.role || 'user';
    if (role !== 'admin' && role !== 'superadmin') {
      return res.status(403).send('Access denied. Admin role required.');
    }

    const totalUsers = await pool.query(`SELECT COUNT(DISTINCT user_email) as cnt FROM mfa_secrets WHERE tenant_id=$1`, [tid]);
    const enabledUsers = await pool.query(`SELECT COUNT(*) as cnt FROM mfa_secrets WHERE tenant_id=$1 AND enabled=true`, [tid]);
    const totalVerifications = await pool.query(`SELECT COUNT(*) as cnt FROM mfa_verification_log WHERE tenant_id=$1`, [tid]);
    const successVerifications = await pool.query(`SELECT COUNT(*) as cnt FROM mfa_verification_log WHERE tenant_id=$1 AND success=true`, [tid]);
    const failedVerifications = await pool.query(`SELECT COUNT(*) as cnt FROM mfa_verification_log WHERE tenant_id=$1 AND success=false`, [tid]);
    const totpVerifications = await pool.query(`SELECT COUNT(*) as cnt FROM mfa_verification_log WHERE tenant_id=$1 AND method='totp' AND success=true`, [tid]);
    const backupVerifications = await pool.query(`SELECT COUNT(*) as cnt FROM mfa_verification_log WHERE tenant_id=$1 AND method='backup' AND success=true`, [tid]);
    const trustedDevices = await pool.query(`SELECT COUNT(*) as cnt FROM mfa_trusted_devices WHERE tenant_id=$1 AND trusted_until > NOW()`, [tid]);
    const recentFailures = await pool.query(
      `SELECT user_email, COUNT(*) as fail_count FROM mfa_verification_log
       WHERE tenant_id=$1 AND success=false AND created_at > NOW() - INTERVAL '24 hours'
       GROUP BY user_email ORDER BY fail_count DESC LIMIT 10`, [tid]
    );
    const dailyLog = await pool.query(
      `SELECT DATE(created_at) as day, COUNT(*) FILTER (WHERE success=true) as successes,
              COUNT(*) FILTER (WHERE success=false) as failures
       FROM mfa_verification_log WHERE tenant_id=$1 AND created_at > NOW() - INTERVAL '30 days'
       GROUP BY DATE(created_at) ORDER BY day DESC LIMIT 30`, [tid]
    );

    const total = parseInt(totalUsers.rows[0].cnt) || 0;
    const enabled = parseInt(enabledUsers.rows[0].cnt) || 0;
    const adoptionPct = total > 0 ? Math.round((enabled / total) * 100) : 0;

    let content = SKIP + navTabs('/school/mfa/stats');
    content += `<div class="mfa-card"><h2>MFA Adoption Statistics</h2>`;

    content += `<div class="mfa-grid">`;
    content += `<div class="mfa-card mfa-stat"><div class="num">${total}</div><div class="lbl">Total Users with MFA Config</div></div>`;
    content += `<div class="mfa-card mfa-stat"><div class="num">${enabled}</div><div class="lbl">MFA Enabled</div></div>`;
    content += `<div class="mfa-card mfa-stat"><div class="num">${adoptionPct}%</div><div class="lbl">Adoption Rate</div></div>`;
    content += `<div class="mfa-card mfa-stat"><div class="num">${parseInt(trustedDevices.rows[0].cnt)}</div><div class="lbl">Active Trusted Devices</div></div>`;
    content += `</div>`;

    content += `<div class="mfa-grid">`;
    content += `<div class="mfa-card mfa-stat"><div class="num" style="color:var(--success)">${parseInt(successVerifications.rows[0].cnt)}</div><div class="lbl">Successful Verifications</div></div>`;
    content += `<div class="mfa-card mfa-stat"><div class="num" style="color:var(--danger)">${parseInt(failedVerifications.rows[0].cnt)}</div><div class="lbl">Failed Verifications</div></div>`;
    content += `<div class="mfa-card mfa-stat"><div class="num">${parseInt(totpVerifications.rows[0].cnt)}</div><div class="lbl">TOTP Authentications</div></div>`;
    content += `<div class="mfa-card mfa-stat"><div class="num">${parseInt(backupVerifications.rows[0].cnt)}</div><div class="lbl">Backup Code Uses</div></div>`;
    content += `</div>`;

    /* recent failures table */
    if (recentFailures.rows.length > 0) {
      content += `<div class="mfa-card"><h3>Top Failed Verification Attempts (Last 24h)</h3>`;
      content += `<div style="overflow-x:auto"><table class="mfa-table"><thead><tr><th>Email</th><th>Failed Attempts</th></tr></thead><tbody>`;
      for (const r of recentFailures.rows) {
        content += `<tr><td>${esc(r.user_email)}</td><td><span class="mfa-badge mfa-badge-red">${r.fail_count}</span></td></tr>`;
      }
      content += `</tbody></table></div></div>`;
    }

    /* 30-day trend */
    if (dailyLog.rows.length > 0) {
      content += `<div class="mfa-card"><h3>30-Day Verification Trend</h3>`;
      content += `<div style="overflow-x:auto"><table class="mfa-table"><thead><tr><th>Date</th><th>Successes</th><th>Failures</th><th>Total</th></tr></thead><tbody>`;
      for (const r of dailyLog.rows) {
        const totalDay = parseInt(r.successes) + parseInt(r.failures);
        const pct = totalDay > 0 ? Math.round((parseInt(r.successes) / totalDay) * 100) : 0;
        content += `<tr>
          <td>${esc(new Date(r.day + 'T00:00:00').toLocaleDateString())}</td>
          <td style="color:var(--success);font-weight:600">${r.successes}</td>
          <td style="color:var(--danger)">${r.failures}</td>
          <td>${totalDay} <span style="font-size:.78rem;color:var(--gray)">(${pct}% success)</span></td></tr>`;
      }
      content += `</tbody></table></div></div>`;
    }

    content += `</div>`;
    res.send(renderPage('MFA Statistics', content, req.session.user));
  }));
};
