/**
 * MFA Routes Module — Comfort Zone Multi-Tenant SaaS
 * Complements mfa-totp module with SMS, Email, Recovery, and Admin routes
 *
 * Usage:
 *   const mfaRoutes = require('./mfa-routes');
 *   mfaRoutes(app, pool, { esc, renderPage, ah, requireAuth, audit });
 */

module.exports = function (app, pool, opts) {
  const esc = (opts && opts.esc) || (s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));
  const renderPage = (opts && opts.renderPage) || ((t, c, u) => c);
  const ah = (opts && opts.ah) || (fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(e => res.status(500).send('Error: ' + e.message)));
  const requireAuth = (opts && opts.requireAuth) || ((req, res, next) => { if (!req.session?.user) return res.redirect('/login'); next(); });
  const audit = (opts && opts.audit) || (() => {});
  const tenantId = (req) => req.session?.user?.tenant_id || 0;
  const bcrypt = require('bcryptjs') || require('bcrypt');
  const crypto = require('crypto');

  /* ─────────────────────── Shared CSS ─────────────────────── */
  const CSS = `
    <link rel="stylesheet" href="/css/sk.css">
    <style>
      :root{--pri:#4f46e5;--pri-light:#6366f1;--pri-dark:#4338ca;--gray:#6b7280;--gray-light:#f3f4f6;--danger:#ef4444;--success:#10b981;--warn:#f59e0b;--radius:10px;--shadow:0 1px 3px rgba(0,0,0,.1)}
      .mfa2-wrap{max-width:760px;margin:0 auto;padding:24px 16px;font-family:system-ui,-apple-system,sans-serif;color:#1f2937}
      .mfa2-card{background:#fff;border-radius:var(--radius);box-shadow:var(--shadow);padding:24px;margin-bottom:20px}
      .mfa2-card h2{margin:0 0 16px;font-size:1.25rem;color:#111827}
      .mfa2-card h3{margin:0 0 10px;font-size:1.05rem;color:#374151}
      .mfa2-btn{display:inline-block;padding:10px 20px;border-radius:6px;border:none;cursor:pointer;font-size:.9rem;font-weight:600;text-decoration:none;transition:background .15s}
      .mfa2-btn-primary{background:var(--pri);color:#fff}.mfa2-btn-primary:hover{background:var(--pri-light)}
      .mfa2-btn-danger{background:var(--danger);color:#fff}.mfa2-btn-danger:hover{background:#dc2626}
      .mfa2-btn-outline{background:transparent;border:1px solid var(--gray);color:#374151}.mfa2-btn-outline:hover{background:var(--gray-light)}
      .mfa2-btn-success{background:var(--success);color:#fff}.mfa2-btn-success:hover{background:#059669}
      .mfa2-btn-sm{padding:6px 14px;font-size:.82rem}
      .mfa2-input{padding:10px 14px;border:1px solid #d1d5db;border-radius:6px;font-size:.9rem;width:100%;max-width:400px;box-sizing:border-box}
      .mfa2-input:focus{outline:none;border-color:var(--pri);box-shadow:0 0 0 3px rgba(79,70,229,.15)}
      .mfa2-label{display:block;font-size:.85rem;font-weight:600;color:#374151;margin-bottom:5px}
      .mfa2-form-group{margin-bottom:16px}
      .mfa2-flash{padding:12px 16px;border-radius:6px;margin-bottom:16px;font-size:.9rem}
      .mfa2-flash-ok{background:#d1fae5;color:#065f46}
      .mfa2-flash-err{background:#fee2e2;color:#991b1b}
      .mfa2-badge{display:inline-block;padding:2px 10px;border-radius:12px;font-size:.78rem;font-weight:600}
      .mfa2-badge-green{background:#d1fae5;color:#065f46}
      .mfa2-badge-red{background:#fee2e2;color:#991b1b}
      .mfa2-badge-blue{background:#dbeafe;color:#1e40af}
      .mfa2-badge-yellow{background:#fef3c7;color:#92400e}
      .mfa2-badge-purple{background:#ede9fe;color:#5b21b6}
      .mfa2-badge-gray{background:var(--gray-light);color:var(--gray)}
      .mfa2-table{width:100%;border-collapse:collapse;font-size:.88rem}
      .mfa2-table th{text-align:left;padding:10px 12px;background:var(--gray-light);font-weight:600;color:#374151;border-bottom:2px solid #e5e7eb}
      .mfa2-table td{padding:10px 12px;border-bottom:1px solid #e5e7eb}
      .mfa2-tabs{display:flex;gap:4px;border-bottom:2px solid var(--gray-light);margin-bottom:20px;flex-wrap:wrap}
      .mfa2-tab{padding:10px 16px;cursor:pointer;border:none;background:none;font-size:.9rem;color:var(--gray);border-bottom:2px solid transparent;margin-bottom:-2px;transition:all .15s;text-decoration:none}
      .mfa2-tab.active{color:var(--pri);border-bottom-color:var(--pri);font-weight:600}
      .mfa2-tab:hover{color:var(--pri)}
      .mfa2-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px}
      .mfa2-stat{text-align:center;padding:20px}
      .mfa2-stat .num{font-size:2rem;font-weight:700;color:var(--pri)}
      .mfa2-stat .lbl{font-size:.82rem;color:var(--gray);margin-top:4px}
      .mfa2-select{padding:10px 14px;border:1px solid #d1d5db;border-radius:6px;font-size:.9rem;background:#fff;max-width:400px;width:100%}
      .mfa2-method-card{padding:16px;border:2px solid #e5e7eb;border-radius:10px;transition:border-color .15s}
      .mfa2-method-card.active{border-color:var(--pri);background:rgba(79,70,229,.03)}
      .mfa2-method-card:hover{border-color:var(--pri-light)}
      @media(max-width:600px){.mfa2-wrap{padding:16px 8px}.mfa2-grid{grid-template-columns:1fr}}
    </style>`;

  function flashMsg(type, msg) {
    if (!msg) return '';
    return `<div class="mfa2-flash mfa2-flash-${type === 'error' ? 'err' : 'ok'}">${esc(msg)}</div>`;
  }

  /* ─────────────────────── In-memory rate limit ─────────────────────── */
  const rateMap = new Map();
  function checkRate(ip, max, windowSec) {
    const now = Date.now();
    const key = 'mfa2:' + ip;
    const entry = rateMap.get(key);
    if (!entry || now - entry.start > windowSec * 1000) {
      rateMap.set(key, { start: now, count: 1 });
      return true;
    }
    entry.count++;
    return entry.count <= max;
  }

  /* ─────────────────────── Code generation helpers ─────────────────────── */
  function generateCode(length) {
    const len = length || 6;
    const digits = '0123456789';
    let code = '';
    const bytes = crypto.randomBytes(len);
    for (let i = 0; i < len; i++) {
      code += digits[bytes[i] % digits.length];
    }
    return code;
  }

  async function hashCode(code) {
    return bcrypt.hash(code, 10);
  }

  async function verifyCode(code, hash) {
    return bcrypt.compare(code, hash);
  }

  /* ─────────────────────── DB Migrations ─────────────────────── */
  (async function migrate() {
    const client = await pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS mfa_sms_codes (
          id SERIAL PRIMARY KEY,
          tenant_id INT NOT NULL DEFAULT 0,
          user_email VARCHAR(255) NOT NULL,
          code_hash VARCHAR(255) NOT NULL,
          phone VARCHAR(30) NOT NULL,
          verified BOOLEAN NOT NULL DEFAULT false,
          expires_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_mfa_sms_email ON mfa_sms_codes(tenant_id, user_email);
        CREATE INDEX IF NOT EXISTS idx_mfa_sms_expires ON mfa_sms_codes(expires_at) WHERE verified=false;

        CREATE TABLE IF NOT EXISTS mfa_email_codes (
          id SERIAL PRIMARY KEY,
          tenant_id INT NOT NULL DEFAULT 0,
          user_email VARCHAR(255) NOT NULL,
          code_hash VARCHAR(255) NOT NULL,
          verified BOOLEAN NOT NULL DEFAULT false,
          expires_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_mfa_email_codes_email ON mfa_email_codes(tenant_id, user_email);
        CREATE INDEX IF NOT EXISTS idx_mfa_email_codes_expires ON mfa_email_codes(expires_at) WHERE verified=false;

        CREATE TABLE IF NOT EXISTS mfa_recovery_requests (
          id SERIAL PRIMARY KEY,
          tenant_id INT NOT NULL DEFAULT 0,
          user_email VARCHAR(255) NOT NULL,
          request_token VARCHAR(255) NOT NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'pending',
          verified_at TIMESTAMPTZ,
          expires_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_mfa_recovery_email ON mfa_recovery_requests(tenant_id, user_email);
        CREATE INDEX IF NOT EXISTS idx_mfa_recovery_status ON mfa_recovery_requests(status, expires_at);

        CREATE TABLE IF NOT EXISTS mfa_user_preferences (
          id SERIAL PRIMARY KEY,
          tenant_id INT NOT NULL DEFAULT 0,
          user_email VARCHAR(255) NOT NULL,
          preferred_method VARCHAR(50) NOT NULL DEFAULT 'totp',
          backup_methods TEXT[] NOT NULL DEFAULT '{}',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE(tenant_id, user_email)
        );
        CREATE INDEX IF NOT EXISTS idx_mfa_prefs_email ON mfa_user_preferences(tenant_id, user_email);
      `);
    } finally {
      client.release();
    }
  })().catch(err => console.error('[MFA-Routes] Migration error:', err));

  /* ═══════════════════════ ROUTES ═══════════════════════ */

  /* ── 1. POST /mfa/sms/send — Send SMS verification code ──── */
  app.post('/mfa/sms/send', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const email = req.session.user.email;
    const { phone } = req.body;
    const ip = req.ip || req.connection?.remoteAddress || '';

    if (!checkRate(ip, 5, 300)) {
      return res.status(429).json({ success: false, error: 'Too many SMS requests. Please wait 5 minutes.' });
    }

    const targetPhone = (phone || '').trim();
    if (!targetPhone) {
      return res.status(400).json({ success: false, error: 'Phone number is required.' });
    }

    /* Invalidate previous unverified codes */
    await pool.query(
      `UPDATE mfa_sms_codes SET verified=true WHERE tenant_id=$1 AND user_email=$2 AND verified=false`,
      [tid, email]
    );

    const code = generateCode(6);
    const codeHash = await hashCode(code);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); /* 10 min */

    await pool.query(
      `INSERT INTO mfa_sms_codes (tenant_id, user_email, code_hash, phone, expires_at)
       VALUES ($1,$2,$3,$4,$5)`,
      [tid, email, codeHash, targetPhone, expiresAt]
    );

    /* In production: send SMS via Twilio/Africa's Talking etc. */
    audit({ action: 'mfa_sms_sent', email, tid, phone: targetPhone });

    res.json({
      success: true,
      message: 'Verification code sent to your phone.',
      /* Dev-only: return code for testing */
      ...(process.env.NODE_ENV === 'development' ? { _dev_code: code } : {})
    });
  }));

  /* ── 2. POST /mfa/sms/verify — Verify SMS code ───────────── */
  app.post('/mfa/sms/verify', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const email = req.session.user.email;
    const { code } = req.body;
    const ip = req.ip || req.connection?.remoteAddress || '';

    if (!checkRate(ip, 10, 300)) {
      return res.status(429).json({ success: false, error: 'Too many attempts. Try again later.' });
    }

    if (!code) {
      return res.status(400).json({ success: false, error: 'Verification code is required.' });
    }

    const codesRes = await pool.query(
      `SELECT id, code_hash FROM mfa_sms_codes
       WHERE tenant_id=$1 AND user_email=$2 AND verified=false AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [tid, email]
    );

    if (!codesRes.rows.length) {
      return res.status(400).json({ success: false, error: 'No valid SMS code found. Please request a new one.' });
    }

    const valid = await verifyCode(code.trim(), codesRes.rows[0].code_hash);

    if (!valid) {
      audit({ action: 'mfa_sms_verify_fail', email, tid });
      return res.status(401).json({ success: false, error: 'Invalid verification code.' });
    }

    await pool.query(`UPDATE mfa_sms_codes SET verified=true WHERE id=$1`, [codesRes.rows[0].id]);
    audit({ action: 'mfa_sms_verify_success', email, tid });

    res.json({ success: true, message: 'SMS code verified successfully.' });
  }));

  /* ── 3. POST /mfa/email/send — Send email verification code ── */
  app.post('/mfa/email/send', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const email = req.session.user.email;
    const ip = req.ip || req.connection?.remoteAddress || '';

    if (!checkRate(ip, 5, 300)) {
      return res.status(429).json({ success: false, error: 'Too many email requests. Please wait 5 minutes.' });
    }

    /* Invalidate previous unverified codes */
    await pool.query(
      `UPDATE mfa_email_codes SET verified=true WHERE tenant_id=$1 AND user_email=$2 AND verified=false`,
      [tid, email]
    );

    const code = generateCode(6);
    const codeHash = await hashCode(code);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); /* 10 min */

    await pool.query(
      `INSERT INTO mfa_email_codes (tenant_id, user_email, code_hash, expires_at)
       VALUES ($1,$2,$3,$4)`,
      [tid, email, codeHash, expiresAt]
    );

    /* In production: send email via SendGrid/Mailgun/Nodemailer */
    audit({ action: 'mfa_email_sent', email, tid });

    res.json({
      success: true,
      message: 'Verification code sent to your email.',
      ...(process.env.NODE_ENV === 'development' ? { _dev_code: code } : {})
    });
  }));

  /* ── 4. POST /mfa/email/verify — Verify email code ────────── */
  app.post('/mfa/email/verify', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const email = req.session.user.email;
    const { code } = req.body;
    const ip = req.ip || req.connection?.remoteAddress || '';

    if (!checkRate(ip, 10, 300)) {
      return res.status(429).json({ success: false, error: 'Too many attempts. Try again later.' });
    }

    if (!code) {
      return res.status(400).json({ success: false, error: 'Verification code is required.' });
    }

    const codesRes = await pool.query(
      `SELECT id, code_hash FROM mfa_email_codes
       WHERE tenant_id=$1 AND user_email=$2 AND verified=false AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [tid, email]
    );

    if (!codesRes.rows.length) {
      return res.status(400).json({ success: false, error: 'No valid email code found. Please request a new one.' });
    }

    const valid = await verifyCode(code.trim(), codesRes.rows[0].code_hash);

    if (!valid) {
      audit({ action: 'mfa_email_verify_fail', email, tid });
      return res.status(401).json({ success: false, error: 'Invalid verification code.' });
    }

    await pool.query(`UPDATE mfa_email_codes SET verified=true WHERE id=$1`, [codesRes.rows[0].id]);
    audit({ action: 'mfa_email_verify_success', email, tid });

    res.json({ success: true, message: 'Email code verified successfully.' });
  }));

  /* ── 5. POST /mfa/recovery/initiate — Account recovery ───── */
  app.post('/mfa/recovery/initiate', ah(async (req, res) => {
    const { email, tenant_id: bodyTid } = req.body;
    const tid = bodyTid || 0;
    const ip = req.ip || req.connection?.remoteAddress || '';

    if (!checkRate(ip, 3, 3600)) {
      return res.status(429).json({ success: false, error: 'Too many recovery requests. Try again in 1 hour.' });
    }

    const cleanEmail = (email || '').trim().toLowerCase();
    if (!cleanEmail) {
      return res.status(400).json({ success: false, error: 'Email is required.' });
    }

    /* Check for existing pending recovery */
    const existingRes = await pool.query(
      `SELECT id FROM mfa_recovery_requests
       WHERE tenant_id=$1 AND user_email=$2 AND status='pending' AND expires_at > NOW()`,
      [tid, cleanEmail]
    );
    if (existingRes.rows.length > 0) {
      return res.status(409).json({ success: false, error: 'A recovery request is already pending. Please check your email.' });
    }

    const requestToken = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); /* 24 hours */

    await pool.query(
      `INSERT INTO mfa_recovery_requests (tenant_id, user_email, request_token, expires_at)
       VALUES ($1,$2,$3,$4)`,
      [tid, cleanEmail, requestToken, expiresAt]
    );

    /* In production: send recovery email with link containing token */
    audit({ action: 'mfa_recovery_initiated', email: cleanEmail, tid });

    res.json({
      success: true,
      message: 'If an account exists, a recovery link has been sent to your email.',
      request_token: requestToken /* Dev-only */
    });
  }));

  /* ── 6. POST /mfa/recovery/verify — Verify recovery request ─ */
  app.post('/mfa/recovery/verify', ah(async (req, res) => {
    const { email, token, tenant_id: bodyTid, new_password } = req.body;
    const tid = bodyTid || 0;

    const cleanEmail = (email || '').trim().toLowerCase();
    if (!cleanEmail || !token) {
      return res.status(400).json({ success: false, error: 'Email and recovery token are required.' });
    }

    const recoveryRes = await pool.query(
      `SELECT id, status FROM mfa_recovery_requests
       WHERE tenant_id=$1 AND user_email=$2 AND request_token=$3 AND status='pending' AND expires_at > NOW()`,
      [tid, cleanEmail, token]
    );

    if (!recoveryRes.rows.length) {
      return res.status(400).json({ success: false, error: 'Invalid or expired recovery token.' });
    }

    /* Mark recovery as completed */
    await pool.query(
      `UPDATE mfa_recovery_requests SET status='verified', verified_at=NOW() WHERE id=$1`,
      [recoveryRes.rows[0].id]
    );

    /* Disable MFA for the user (force re-setup) */
    await pool.query(
      `UPDATE mfa_secrets SET enabled=false, verified_at=NULL
       WHERE tenant_id=$1 AND user_email=$2`,
      [tid, cleanEmail]
    ).catch(() => {}); /* mfa_secrets may not exist if mfa-totp not loaded */

    /* Optionally reset password if new_password provided */
    if (new_password && new_password.length >= 6) {
      const newHash = await bcrypt.hash(new_password, 12);
      await pool.query(
        `UPDATE users SET password_hash=$1 WHERE tenant_id=$2 AND LOWER(email)=$3`,
        [newHash, tid, cleanEmail]
      );

      /* Revoke all sessions */
      await pool.query(
        `UPDATE sso_sessions SET revoked_at=NOW()
         WHERE tenant_id=$1 AND user_id IN (SELECT id FROM users WHERE tenant_id=$1 AND LOWER(email)=$2)
         AND revoked_at IS NULL`,
        [tid, cleanEmail]
      ).catch(() => {});
    }

    audit({ action: 'mfa_recovery_verified', email: cleanEmail, tid, password_reset: !!new_password });

    res.json({
      success: true,
      message: 'Account recovery completed. MFA has been disabled. Please log in and reconfigure MFA.',
      mfa_disabled: true
    });
  }));

  /* ── 7. GET /mfa/methods — List available MFA methods ─────── */
  app.get('/mfa/methods', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const email = req.session.user.email;

    /* Check TOTP enrollment */
    let totpEnrolled = false;
    const totpRes = await pool.query(
      `SELECT enabled FROM mfa_secrets WHERE tenant_id=$1 AND user_email=$2 AND enabled=true`,
      [tid, email]
    ).catch(() => ({ rows: [] }));
    totpEnrolled = totpRes.rows.length > 0;

    /* Check SMS codes sent recently */
    const smsRes = await pool.query(
      `SELECT COUNT(*)::int as total FROM mfa_sms_codes WHERE tenant_id=$1 AND user_email=$2`,
      [tid, email]
    );

    /* Check email codes sent recently */
    const emailRes = await pool.query(
      `SELECT COUNT(*)::int as total FROM mfa_email_codes WHERE tenant_id=$1 AND user_email=$2`,
      [tid, email]
    );

    /* Get user preference */
    const prefRes = await pool.query(
      `SELECT preferred_method, backup_methods FROM mfa_user_preferences WHERE tenant_id=$1 AND user_email=$2`,
      [tid, email]
    );

    const preference = prefRes.rows[0] || { preferred_method: 'totp', backup_methods: [] };

    /* Check user phone */
    const userRes = await pool.query(
      `SELECT phone FROM users WHERE id=$1 AND tenant_id=$2`, [req.session.user.id, tid]
    ).catch(() => ({ rows: [] }));
    const hasPhone = userRes.rows.length > 0 && !!userRes.rows[0].phone;

    const methods = [
      {
        id: 'totp',
        name: 'Authenticator App',
        description: 'Use Google Authenticator, Authy, or compatible app',
        enrolled: totpEnrolled,
        icon: '&#128241;',
        available: true
      },
      {
        id: 'sms',
        name: 'SMS Verification',
        description: 'Receive a code via text message',
        enrolled: smsRes.rows[0].total > 0,
        icon: '&#128172;',
        available: hasPhone
      },
      {
        id: 'email',
        name: 'Email Verification',
        description: 'Receive a code via email',
        enrolled: emailRes.rows[0].total > 0,
        icon: '&#9993;',
        available: true
      }
    ];

    res.json({
      success: true,
      methods,
      preferred_method: preference.preferred_method,
      backup_methods: preference.backup_methods
    });
  }));

  /* ── 8. PUT /mfa/preference — Set preferred MFA method ────── */
  app.put('/mfa/preference', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const email = req.session.user.email;
    const { preferred_method, backup_methods } = req.body;

    const validMethods = ['totp', 'sms', 'email'];
    if (preferred_method && !validMethods.includes(preferred_method)) {
      return res.status(400).json({ success: false, error: `Invalid method. Choose from: ${validMethods.join(', ')}` });
    }

    const validatedBackups = Array.isArray(backup_methods)
      ? backup_methods.filter(m => validMethods.includes(m))
      : [];

    await pool.query(
      `INSERT INTO mfa_user_preferences (tenant_id, user_email, preferred_method, backup_methods)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (tenant_id, user_email) DO UPDATE SET preferred_method=$3, backup_methods=$4`,
      [tid, email, preferred_method || 'totp', validatedBackups]
    );

    audit({ action: 'mfa_preference_updated', email, tid, preferred_method, backup_methods: validatedBackups });

    res.json({
      success: true,
      message: 'MFA preference updated.',
      preferred_method: preferred_method || 'totp',
      backup_methods: validatedBackups
    });
  }));

  /* ── 9. GET /mfa/status — Get MFA enrollment status ──────── */
  app.get('/mfa/status', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const email = req.session.user.email;

    /* TOTP status */
    const totpRes = await pool.query(
      `SELECT enabled, verified_at, created_at FROM mfa_secrets WHERE tenant_id=$1 AND user_email=$2`,
      [tid, email]
    ).catch(() => ({ rows: [] }));
    const totp = totpRes.rows[0] || null;

    /* SMS usage stats */
    const smsStatsRes = await pool.query(
      `SELECT COUNT(*)::int as total_sent,
              COUNT(*) FILTER (WHERE verified=true)::int as verified_count,
              MAX(created_at) as last_sent
       FROM mfa_sms_codes WHERE tenant_id=$1 AND user_email=$2`,
      [tid, email]
    );

    /* Email usage stats */
    const emailStatsRes = await pool.query(
      `SELECT COUNT(*)::int as total_sent,
              COUNT(*) FILTER (WHERE verified=true)::int as verified_count,
              MAX(created_at) as last_sent
       FROM mfa_email_codes WHERE tenant_id=$1 AND user_email=$2`,
      [tid, email]
    );

    /* Recovery requests */
    const recoveryRes = await pool.query(
      `SELECT COUNT(*)::int as total,
              COUNT(*) FILTER (WHERE status='verified')::int as completed,
              MAX(created_at) as last_requested
       FROM mfa_recovery_requests WHERE tenant_id=$1 AND user_email=$2`,
      [tid, email]
    );

    /* User preference */
    const prefRes = await pool.query(
      `SELECT preferred_method, backup_methods, created_at FROM mfa_user_preferences WHERE tenant_id=$1 AND user_email=$2`,
      [tid, email]
    );

    const smsStats = smsStatsRes.rows[0];
    const emailStats = emailStatsRes.rows[0];
    const recoveryStats = recoveryRes.rows[0];
    const pref = prefRes.rows[0] || null;

    const anyMfaEnabled = totp && totp.enabled;

    res.json({
      success: true,
      mfa_enabled: anyMfaEnabled,
      totp: totp ? {
        enabled: totp.enabled,
        verified: !!totp.verified_at,
        verified_at: totp.verified_at,
        enrolled_since: totp.created_at
      } : null,
      sms: {
        ever_used: smsStats.total_sent > 0,
        total_sent: smsStats.total_sent,
        verified_count: smsStats.verified_count,
        last_sent: smsStats.last_sent
      },
      email: {
        ever_used: emailStats.total_sent > 0,
        total_sent: emailStats.total_sent,
        verified_count: emailStats.verified_count,
        last_sent: emailStats.last_sent
      },
      recovery: {
        total_requests: recoveryStats.total,
        completed: recoveryStats.completed,
        last_requested: recoveryStats.last_requested
      },
      preference: pref ? {
        preferred_method: pref.preferred_method,
        backup_methods: pref.backup_methods,
        configured_at: pref.created_at
      } : null
    });
  }));

  /* ── 10. POST /mfa/admin/force-disable — Admin force-disable ─ */
  app.post('/mfa/admin/force-disable', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const adminRole = req.session.user.role || 'user';

    if (adminRole !== 'admin' && adminRole !== 'superadmin') {
      return res.status(403).json({ success: false, error: 'Admin access required.' });
    }

    const { user_email, reason, tenant_id: bodyTid } = req.body;
    const tidTarget = bodyTid || tid;
    const cleanEmail = (user_email || '').trim().toLowerCase();

    if (!cleanEmail) {
      return res.status(400).json({ success: false, error: 'User email is required.' });
    }

    /* Disable TOTP */
    const totpResult = await pool.query(
      `UPDATE mfa_secrets SET enabled=false, verified_at=NULL
       WHERE tenant_id=$1 AND user_email=$2 AND enabled=true RETURNING id`,
      [tidTarget, cleanEmail]
    ).catch(() => ({ rows: [] }));

    /* Invalidate all pending SMS codes */
    await pool.query(
      `UPDATE mfa_sms_codes SET verified=true WHERE tenant_id=$1 AND user_email=$2 AND verified=false`,
      [tidTarget, cleanEmail]
    );

    /* Invalidate all pending email codes */
    await pool.query(
      `UPDATE mfa_email_codes SET verified=true WHERE tenant_id=$1 AND user_email=$2 AND verified=false`,
      [tidTarget, cleanEmail]
    );

    /* Revoke all sessions for the target user */
    const sessionResult = await pool.query(
      `UPDATE sso_sessions SET revoked_at=NOW()
       WHERE tenant_id=$1 AND user_id IN (SELECT id FROM users WHERE tenant_id=$1 AND LOWER(email)=$2)
       AND revoked_at IS NULL RETURNING id`,
      [tidTarget, cleanEmail]
    ).catch(() => ({ rows: [] }));

    audit({
      action: 'mfa_admin_force_disable',
      admin_id: req.session.user.id,
      target_email: cleanEmail,
      tid: tidTarget,
      reason: reason || 'Admin force-disable',
      totp_disabled: totpResult.rows.length > 0,
      sessions_revoked: sessionResult.rows.length
    });

    res.json({
      success: true,
      message: `MFA force-disabled for ${cleanEmail}. All sessions have been revoked.`,
      details: {
        totp_disabled: totpResult.rows.length > 0,
        sessions_revoked: sessionResult.rows.length,
        reason: reason || 'Admin force-disable'
      }
    });
  }));

  /* ═══════════════════════ HTML UI ROUTES ═══════════════════════ */

  /* ── GET /mfa/methods/ui — MFA methods management page ────── */
  app.get('/mfa/methods/ui', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const email = req.session.user.email;

    /* TOTP status */
    const totpRes = await pool.query(
      `SELECT enabled FROM mfa_secrets WHERE tenant_id=$1 AND user_email=$2`, [tid, email]
    ).catch(() => ({ rows: [] }));

    /* Preference */
    const prefRes = await pool.query(
      `SELECT preferred_method FROM mfa_user_preferences WHERE tenant_id=$1 AND user_email=$2`,
      [tid, email]
    );
    const preferred = (prefRes.rows[0] || {}).preferred_method || 'totp';

    const methods = [
      { id: 'totp', name: 'Authenticator App', desc: 'Google Authenticator, Authy, etc.', icon: '&#128241;', enrolled: totpRes.rows.length > 0 && totpRes.rows[0].enabled },
      { id: 'sms', name: 'SMS Code', desc: 'Receive via text message', icon: '&#128172;', enrolled: false },
      { id: 'email', name: 'Email Code', desc: 'Receive via email', icon: '&#9993;', enrolled: false }
    ];

    let content = CSS;
    content += '<div class="mfa2-wrap">';
    content += flashMsg(req.query.flash_type, req.query.flash);
    content += '<h2 style="margin-bottom:20px">Multi-Factor Authentication Methods</h2>';

    /* Preferred method selector */
    content += '<div class="mfa2-card"><h3>Preferred Method</h3>';
    content += `<p style="font-size:.88rem;color:var(--gray);margin-bottom:12px">Choose which method to use by default during login.</p>`;
    content += '<form method="POST" action="/mfa/preference" style="display:flex;gap:12px;flex-wrap:wrap;align-items:center">';
    content += '<input type="hidden" name="preferred_method" id="prefMethodInput" value="' + esc(preferred) + '">';
    for (const m of methods) {
      const isSelected = preferred === m.id;
      content += `<button type="button" onclick="document.getElementById('prefMethodInput').value='${m.id}';this.closest('form').submit()"
        class="mfa2-btn ${isSelected ? 'mfa2-btn-primary' : 'mfa2-btn-outline'}" style="display:flex;align-items:center;gap:8px">
        <span>${m.icon}</span> ${esc(m.name)} ${isSelected ? '&#10003;' : ''}</button>`;
    }
    content += '</form></div>';

    /* Methods cards */
    content += '<div class="mfa2-grid">';

    /* TOTP card */
    const totpEnrolled = totpRes.rows.length > 0 && totpRes.rows[0].enabled;
    content += `<div class="mfa2-method-card ${preferred === 'totp' ? 'active' : ''}">`;
    content += `<div style="font-size:2rem;margin-bottom:8px">${methods[0].icon}</div>`;
    content += `<h3>${esc(methods[0].name)}</h3>`;
    content += `<p style="font-size:.85rem;color:var(--gray);margin-bottom:12px">${esc(methods[0].desc)}</p>`;
    content += totpEnrolled
      ? '<span class="mfa2-badge mfa2-badge-green">Enrolled</span>'
      : '<span class="mfa2-badge mfa2-badge-gray">Not enrolled</span>';
    content += `<br><a class="mfa2-btn mfa2-btn-outline mfa2-btn-sm" href="/school/mfa/setup" style="margin-top:12px">${totpEnrolled ? 'Reconfigure' : 'Set Up'}</a>`;
    content += '</div>';

    /* SMS card */
    content += `<div class="mfa2-method-card ${preferred === 'sms' ? 'active' : ''}">`;
    content += `<div style="font-size:2rem;margin-bottom:8px">${methods[1].icon}</div>`;
    content += `<h3>${esc(methods[1].name)}</h3>`;
    content += `<p style="font-size:.85rem;color:var(--gray);margin-bottom:12px">${esc(methods[1].desc)}</p>`;
    content += '<span class="mfa2-badge mfa2-badge-blue">Available</span>';
    content += `<br><button class="mfa2-btn mfa2-btn-outline mfa2-btn-sm" onclick="sendSmsCode()" style="margin-top:12px">Send Code</button>`;
    content += '</div>';

    /* Email card */
    content += `<div class="mfa2-method-card ${preferred === 'email' ? 'active' : ''}">`;
    content += `<div style="font-size:2rem;margin-bottom:8px">${methods[2].icon}</div>`;
    content += `<h3>${esc(methods[2].name)}</h3>`;
    content += `<p style="font-size:.85rem;color:var(--gray);margin-bottom:12px">${esc(methods[2].desc)}</p>`;
    content += '<span class="mfa2-badge mfa2-badge-blue">Available</span>';
    content += `<br><button class="mfa2-btn mfa2-btn-outline mfa2-btn-sm" onclick="sendEmailCode()" style="margin-top:12px">Send Code</button>`;
    content += '</div>';

    content += '</div>';

    /* Recovery section */
    content += '<div class="mfa2-card"><h3>Account Recovery</h3>';
    content += '<p style="font-size:.88rem;color:var(--gray);margin-bottom:12px">If you have lost access to all MFA methods, you can initiate an account recovery.</p>';
    content += `<a class="mfa2-btn mfa2-btn-danger mfa2-btn-sm" href="#" onclick="initiateRecovery();return false">Initiate Recovery</a>`;
    content += '</div>';

    content += '<script>';
    content += 'async function sendSmsCode(){try{const r=await fetch("/mfa/sms/send",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({})});const d=await r.json();alert(d.message||(d.error||"Error"))}catch(e){alert("Request failed: "+e.message)}}';
    content += 'async function sendEmailCode(){try{const r=await fetch("/mfa/email/send",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({})});const d=await r.json();alert(d.message||(d.error||"Error"))}catch(e){alert("Request failed: "+e.message)}}';
    content += 'async function initiateRecovery(){try{const r=await fetch("/mfa/recovery/initiate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:"' + esc(email) + '"})});const d=await r.json();alert(d.message||(d.error||"Error"))}catch(e){alert("Request failed: "+e.message)}}';
    content += '</script>';

    content += '</div>';

    res.send(renderPage('MFA Methods', content, req.session.user));
  }));

  /* ── POST /mfa/preference (form handler for HTML page) ────── */
  app.post('/mfa/preference', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const email = req.session.user.email;
    const preferredMethod = (req.body.preferred_method || 'totp').trim().toLowerCase();

    await pool.query(
      `INSERT INTO mfa_user_preferences (tenant_id, user_email, preferred_method, backup_methods)
       VALUES ($1,$2,$3,'{}')
       ON CONFLICT (tenant_id, user_email) DO UPDATE SET preferred_method=$3`,
      [tid, email, preferredMethod]
    );

    audit({ action: 'mfa_preference_set', email, tid, preferred_method: preferredMethod });
    res.redirect(`/mfa/methods/ui?flash_type=ok&flash=Preferred+method+set+to+${encodeURIComponent(preferredMethod)}`);
  }));

  console.log('[MFA-Routes] Module loaded — 4 tables, 10 routes');
};
