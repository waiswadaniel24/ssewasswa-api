/**
 * SSO Unified Auth Module — Comfort Zone Multi-Tenant SaaS
 * Replaces 5 separate auth systems (main, student, church, worker, parent)
 *
 * Usage:
 *   const ssoAuth = require('./sso-auth');
 *   ssoAuth(app, pool, { esc, renderPage, ah, requireAuth, audit });
 */

const { migrateQuery } = require('./db');
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
      .sso-wrap{max-width:720px;margin:0 auto;padding:24px 16px;font-family:system-ui,-apple-system,sans-serif;color:#1f2937}
      .sso-card{background:#fff;border-radius:var(--radius);box-shadow:var(--shadow);padding:24px;margin-bottom:20px}
      .sso-card h2{margin:0 0 16px;font-size:1.25rem;color:#111827}
      .sso-card h3{margin:0 0 10px;font-size:1.05rem;color:#374151}
      .sso-btn{display:inline-block;padding:10px 20px;border-radius:6px;border:none;cursor:pointer;font-size:.9rem;font-weight:600;text-decoration:none;transition:background .15s}
      .sso-btn-primary{background:var(--pri);color:#fff}.sso-btn-primary:hover{background:var(--pri-light)}
      .sso-btn-danger{background:var(--danger);color:#fff}.sso-btn-danger:hover{background:#dc2626}
      .sso-btn-outline{background:transparent;border:1px solid var(--gray);color:#374151}.sso-btn-outline:hover{background:var(--gray-light)}
      .sso-btn-success{background:var(--success);color:#fff}.sso-btn-success:hover{background:#059669}
      .sso-input{padding:10px 14px;border:1px solid #d1d5db;border-radius:6px;font-size:.9rem;width:100%;max-width:400px;box-sizing:border-box}
      .sso-input:focus{outline:none;border-color:var(--pri);box-shadow:0 0 0 3px rgba(79,70,229,.15)}
      .sso-label{display:block;font-size:.85rem;font-weight:600;color:#374151;margin-bottom:5px}
      .sso-form-group{margin-bottom:16px}
      .sso-flash{padding:12px 16px;border-radius:6px;margin-bottom:16px;font-size:.9rem}
      .sso-flash-ok{background:#d1fae5;color:#065f46}
      .sso-flash-err{background:#fee2e2;color:#991b1b}
      .sso-badge{display:inline-block;padding:2px 10px;border-radius:12px;font-size:.78rem;font-weight:600}
      .sso-badge-green{background:#d1fae5;color:#065f46}
      .sso-badge-red{background:#fee2e2;color:#991b1b}
      .sso-badge-blue{background:#dbeafe;color:#1e40af}
      .sso-badge-yellow{background:#fef3c7;color:#92400e}
      .sso-table{width:100%;border-collapse:collapse;font-size:.88rem}
      .sso-table th{text-align:left;padding:10px 12px;background:var(--gray-light);font-weight:600;color:#374151;border-bottom:2px solid #e5e7eb}
      .sso-table td{padding:10px 12px;border-bottom:1px solid #e5e7eb}
      .sso-tabs{display:flex;gap:4px;border-bottom:2px solid var(--gray-light);margin-bottom:20px;flex-wrap:wrap}
      .sso-tab{padding:10px 16px;cursor:pointer;border:none;background:none;font-size:.9rem;color:var(--gray);border-bottom:2px solid transparent;margin-bottom:-2px;transition:all .15s;text-decoration:none}
      .sso-tab.active{color:var(--pri);border-bottom-color:var(--pri);font-weight:600}
      .sso-tab:hover{color:var(--pri)}
      .sso-select{padding:10px 14px;border:1px solid #d1d5db;border-radius:6px;font-size:.9rem;background:#fff;max-width:400px;width:100%}
      @media(max-width:600px){.sso-wrap{padding:16px 8px}}
    </style>`;

  function flashMsg(type, msg) {
    if (!msg) return '';
    return `<div class="sso-flash sso-flash-${type === 'error' ? 'err' : 'ok'}">${esc(msg)}</div>`;
  }

  function generateToken() {
    return crypto.randomBytes(32).toString('hex');
  }

  async function hashToken(token) {
    return bcrypt.hash(token, 12);
  }

  /* ─────────────────────── DB Migrations ─────────────────────── */
  (async function migrate() {
    const sql = `
      CREATE TABLE IF NOT EXISTS sso_sessions (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL DEFAULT 0,
        tenant_id INT NOT NULL DEFAULT 0,
        token_hash VARCHAR(255) NOT NULL,
        ip_address VARCHAR(45),
        user_agent TEXT,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        revoked_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_sso_sessions_tenant_user ON sso_sessions(tenant_id, user_id);
      CREATE INDEX IF NOT EXISTS idx_sso_sessions_token ON sso_sessions(token_hash);
      CREATE INDEX IF NOT EXISTS idx_sso_sessions_expires ON sso_sessions(expires_at) WHERE revoked_at IS NULL;

      CREATE TABLE IF NOT EXISTS sso_login_log (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL DEFAULT 0,
        tenant_id INT NOT NULL DEFAULT 0,
        method VARCHAR(50) NOT NULL DEFAULT 'password',
        ip_address VARCHAR(45),
        user_agent TEXT,
        success BOOLEAN NOT NULL DEFAULT true,
        failure_reason TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_sso_login_log_tenant ON sso_login_log(tenant_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_sso_login_log_user ON sso_login_log(tenant_id, user_id);

      CREATE TABLE IF NOT EXISTS sso_password_resets (
        id SERIAL PRIMARY KEY,
        tenant_id INT NOT NULL DEFAULT 0,
        email VARCHAR(255) NOT NULL,
        token_hash VARCHAR(255) NOT NULL,
        used BOOLEAN NOT NULL DEFAULT false,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_sso_pw_resets_email ON sso_password_resets(tenant_id, email);
      CREATE INDEX IF NOT EXISTS idx_sso_pw_resets_token ON sso_password_resets(token_hash);

      CREATE TABLE IF NOT EXISTS sso_email_verifications (
        id SERIAL PRIMARY KEY,
        tenant_id INT NOT NULL DEFAULT 0,
        email VARCHAR(255) NOT NULL,
        token_hash VARCHAR(255) NOT NULL,
        verified BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_sso_email_verif_email ON sso_email_verifications(tenant_id, email);

      CREATE TABLE IF NOT EXISTS sso_portal_access (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL DEFAULT 0,
        tenant_id INT NOT NULL DEFAULT 0,
        portal_type VARCHAR(50) NOT NULL DEFAULT 'main',
        granted_by INT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_sso_portal_user ON sso_portal_access(tenant_id, user_id, portal_type);
    `;
    await migrateQuery(pool, 'SSOAuth', sql);
  })().catch(() => {});

  /* ═══════════════════════ ROUTES ═══════════════════════ */

  /* ── 1. POST /sso/login — Unified login ──────────────────── */
  app.post('/sso/login', ah(async (req, res) => {
    const { identifier, password, tenant_id: bodyTid } = req.body;
    if (!identifier || !password) {
      return res.status(400).json({ success: false, error: 'Email/phone and password are required.' });
    }

    const tid = bodyTid || 0;
    const ip = req.ip || req.connection?.remoteAddress || '';
    const ua = req.headers['user-agent'] || '';
    const loginIdentifier = identifier.trim().toLowerCase();
    let userId = 0;
    let storedHash = '';
    let userRow = null;

    /* Look up user by email or phone across portal types */
    const userRes = await pool.query(
      `SELECT id, email, phone, password_hash, full_name, role, avatar_url, tenant_id, portal_type, email_verified
       FROM users WHERE tenant_id=$1 AND (LOWER(email)=$2 OR phone=$3) LIMIT 1`,
      [tid, loginIdentifier, loginIdentifier]
    );

    if (!userRes.rows.length) {
      /* Log failed attempt */
      await pool.query(
        `INSERT INTO sso_login_log (tenant_id, method, ip_address, user_agent, success, failure_reason, created_at)
         VALUES ($1,'password',$2,$3,false,'User not found',NOW())`,
        [tid, ip, ua]
      );
      return res.status(401).json({ success: false, error: 'Invalid credentials.' });
    }

    userRow = userRes.rows[0];
    storedHash = userRow.password_hash;

    /* Handle legacy plain-text passwords (auto-migrate) */
    let valid = false;
    if (storedHash && storedHash.startsWith('$2')) {
      valid = await bcrypt.compare(password, storedHash);
    } else if (storedHash && storedHash === password) {
      valid = true;
      /* Auto-migrate to bcrypt */
      const newHash = await bcrypt.hash(password, 12);
      await pool.query(`UPDATE users SET password_hash=$1 WHERE id=$2`, [newHash, userRow.id]);
    }

    if (!valid) {
      await pool.query(
        `INSERT INTO sso_login_log (user_id, tenant_id, method, ip_address, user_agent, success, failure_reason, created_at)
         VALUES ($1,$2,'password',$3,$4,false,'Wrong password',NOW())`,
        [userRow.id, tid, ip, ua]
      );
      return res.status(401).json({ success: false, error: 'Invalid credentials.' });
    }

    /* Create session token */
    const token = generateToken();
    const tokenHash = await hashToken(token);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); /* 30 days */

    await pool.query(
      `INSERT INTO sso_sessions (user_id, tenant_id, token_hash, ip_address, user_agent, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [userRow.id, tid, tokenHash, ip, ua, expiresAt]
    );

    /* Log successful login */
    await pool.query(
      `INSERT INTO sso_login_log (user_id, tenant_id, method, ip_address, user_agent, success, created_at)
       VALUES ($1,$2,'password',$3,$4,true,NOW())`,
      [userRow.id, tid, ip, ua]
    );

    /* Set session */
    req.session.user = {
      id: userRow.id,
      email: userRow.email,
      full_name: userRow.full_name,
      role: userRow.role,
      tenant_id: userRow.tenant_id || tid,
      portal_type: userRow.portal_type || 'main',
      avatar_url: userRow.avatar_url,
      email_verified: userRow.email_verified
    };

    audit({ action: 'sso_login', userId: userRow.id, tid, method: 'password' });

    /* Check available portal types */
    const portalsRes = await pool.query(
      `SELECT portal_type FROM sso_portal_access WHERE tenant_id=$1 AND user_id=$2`, [tid, userRow.id]
    );
    const availablePortals = portalsRes.rows.map(r => r.portal_type);

    res.json({
      success: true,
      token,
      expires_at: expiresAt.toISOString(),
      user: {
        id: userRow.id,
        email: userRow.email,
        full_name: userRow.full_name,
        role: userRow.role,
        portal_type: userRow.portal_type,
        available_portals: availablePortals
      }
    });
  }));

  /* ── 2. POST /sso/logout — Unified logout ─────────────────── */
  app.post('/sso/logout', ah(async (req, res) => {
    const userId = req.session?.user?.id || 0;
    const tid = tenantId(req);
    const token = req.headers['x-sso-token'] || req.body.token || '';

    /* Revoke specific token if provided */
    if (token) {
      const tokenHash = await hashToken(token);
      await pool.query(
        `UPDATE sso_sessions SET revoked_at=NOW() WHERE token_hash=$1 AND tenant_id=$2 AND revoked_at IS NULL`,
        [tokenHash, tid]
      );
    }

    /* Revoke all active sessions for the user */
    if (userId) {
      await pool.query(
        `UPDATE sso_sessions SET revoked_at=NOW() WHERE user_id=$1 AND tenant_id=$2 AND revoked_at IS NULL`,
        [userId, tid]
      );
    }

    /* Destroy session */
    req.session.destroy(() => {});

    audit({ action: 'sso_logout', userId, tid });
    res.json({ success: true, message: 'Logged out successfully.' });
  }));

  /* ── 3. POST /sso/register — Unified registration ─────────── */
  app.post('/sso/register', ah(async (req, res) => {
    const { email, phone, password, full_name, role, tenant_id: bodyTid } = req.body;
    const tid = bodyTid || 0;

    if (!email && !phone) {
      return res.status(400).json({ success: false, error: 'Email or phone is required.' });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters.' });
    }

    const cleanEmail = (email || '').trim().toLowerCase();
    const cleanPhone = (phone || '').trim();
    const cleanName = (full_name || '').trim();

    /* Auto-assign portal type based on role */
    let portalType = 'main';
    if (role === 'student') portalType = 'student';
    else if (role === 'church') portalType = 'church';
    else if (role === 'worker' || role === 'staff') portalType = 'worker';
    else if (role === 'parent') portalType = 'parent';

    /* Check for existing user */
    const existingRes = await pool.query(
      `SELECT id FROM users WHERE tenant_id=$1 AND (LOWER(email)=$2 OR ($3 != '' AND phone=$3))`,
      [tid, cleanEmail, cleanPhone]
    );
    if (existingRes.rows.length > 0) {
      return res.status(409).json({ success: false, error: 'An account with this email or phone already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const insertRes = await pool.query(
      `INSERT INTO users (tenant_id, email, phone, password_hash, full_name, role, portal_type, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()) RETURNING id, email, full_name, role, portal_type`,
      [tid, cleanEmail || null, cleanPhone || null, passwordHash, cleanName || 'New User', role || 'user', portalType]
    );

    const newUser = insertRes.rows[0];

    /* Grant portal access */
    await pool.query(
      `INSERT INTO sso_portal_access (user_id, tenant_id, portal_type) VALUES ($1,$2,$3)`,
      [newUser.id, tid, portalType]
    );

    /* Create email verification token */
    if (cleanEmail) {
      const verifToken = generateToken();
      const verifHash = await hashToken(verifToken);
      await pool.query(
        `INSERT INTO sso_email_verifications (tenant_id, email, token_hash) VALUES ($1,$2,$3)`,
        [tid, cleanEmail, verifHash]
      );
      /* In production: send verification email here */
    }

    /* Auto-login */
    const token = generateToken();
    const tokenHash = await hashToken(token);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await pool.query(
      `INSERT INTO sso_sessions (user_id, tenant_id, token_hash, ip_address, user_agent, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [newUser.id, tid, tokenHash, req.ip || '', req.headers['user-agent'] || '', expiresAt]
    );

    req.session.user = {
      id: newUser.id,
      email: newUser.email,
      full_name: newUser.full_name,
      role: newUser.role,
      tenant_id: tid,
      portal_type: newUser.portal_type
    };

    audit({ action: 'sso_register', userId: newUser.id, tid, role: newUser.role, portal_type: portalType });

    res.status(201).json({
      success: true,
      token,
      expires_at: expiresAt.toISOString(),
      user: {
        id: newUser.id,
        email: newUser.email,
        full_name: newUser.full_name,
        role: newUser.role,
        portal_type: newUser.portal_type
      }
    });
  }));

  /* ── 4. GET /sso/profile — Get current user profile ───────── */
  app.get('/sso/profile', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const userId = req.session.user.id;

    const userRes = await pool.query(
      `SELECT id, email, phone, full_name, role, avatar_url, portal_type, email_verified,
              created_at, last_login_at FROM users WHERE id=$1 AND tenant_id=$2`,
      [userId, tid]
    );

    if (!userRes.rows.length) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    const user = userRes.rows[0];

    /* Get portal access list */
    const portalsRes = await pool.query(
      `SELECT portal_type, created_at FROM sso_portal_access WHERE tenant_id=$1 AND user_id=$2`,
      [tid, userId]
    );

    /* Get active session count */
    const sessionsRes = await pool.query(
      `SELECT COUNT(*)::int as active_sessions FROM sso_sessions
       WHERE user_id=$1 AND tenant_id=$2 AND expires_at > NOW() AND revoked_at IS NULL`,
      [userId, tid]
    );

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        full_name: user.full_name,
        role: user.role,
        avatar_url: user.avatar_url,
        portal_type: user.portal_type,
        email_verified: user.email_verified,
        created_at: user.created_at,
        last_login_at: user.last_login_at,
        available_portals: portalsRes.rows.map(r => r.portal_type),
        active_sessions: sessionsRes.rows[0].active_sessions
      }
    });
  }));

  /* ── 5. PUT /sso/profile — Update profile ─────────────────── */
  app.put('/sso/profile', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const userId = req.session.user.id;
    const { full_name, phone, avatar_url, current_password, new_password } = req.body;

    /* If changing password, verify current first */
    if (new_password) {
      if (!current_password) {
        return res.status(400).json({ success: false, error: 'Current password required to set new password.' });
      }
      const pwRes = await pool.query(
        `SELECT password_hash FROM users WHERE id=$1 AND tenant_id=$2`, [userId, tid]
      );
      if (!pwRes.rows.length) {
        return res.status(404).json({ success: false, error: 'User not found.' });
      }
      const valid = await bcrypt.compare(current_password, pwRes.rows[0].password_hash);
      if (!valid) {
        return res.status(401).json({ success: false, error: 'Current password is incorrect.' });
      }
      if (new_password.length < 6) {
        return res.status(400).json({ success: false, error: 'New password must be at least 6 characters.' });
      }
    }

    /* Build dynamic update */
    const updates = [];
    const params = [];
    let paramIdx = 1;

    if (full_name !== undefined) { updates.push(`full_name=$${paramIdx++}`); params.push(full_name.trim().slice(0, 200)); }
    if (phone !== undefined) { updates.push(`phone=$${paramIdx++}`); params.push(phone.trim().slice(0, 30)); }
    if (avatar_url !== undefined) { updates.push(`avatar_url=$${paramIdx++}`); params.push(avatar_url.trim().slice(0, 500)); }
    if (new_password) { updates.push(`password_hash=$${paramIdx++}`); params.push(await bcrypt.hash(new_password, 12)); }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: 'No fields to update.' });
    }

    updates.push(`updated_at=NOW()`);
    params.push(userId, tid);

    const resultRes = await pool.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id=$${paramIdx++} AND tenant_id=$${paramIdx}
       RETURNING id, email, full_name, phone, avatar_url, portal_type`,
      params
    );

    if (!resultRes.rows.length) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    audit({ action: 'sso_profile_update', userId, tid, fields: updates.length });
    res.json({ success: true, user: resultRes.rows[0] });
  }));

  /* ── 6. POST /sso/change-password ──────────────────────────── */
  app.post('/sso/change-password', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const userId = req.session.user.id;
    const { current_password, new_password, confirm_password } = req.body;

    if (!current_password || !new_password) {
      return res.status(400).json({ success: false, error: 'Current and new password are required.' });
    }
    if (new_password !== confirm_password) {
      return res.status(400).json({ success: false, error: 'New password and confirmation do not match.' });
    }
    if (new_password.length < 6) {
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters.' });
    }

    const pwRes = await pool.query(
      `SELECT password_hash FROM users WHERE id=$1 AND tenant_id=$2`, [userId, tid]
    );
    if (!pwRes.rows.length) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    const valid = await bcrypt.compare(current_password, pwRes.rows[0].password_hash);
    if (!valid) {
      return res.status(401).json({ success: false, error: 'Current password is incorrect.' });
    }

    const newHash = await bcrypt.hash(new_password, 12);
    await pool.query(`UPDATE users SET password_hash=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3`, [newHash, userId, tid]);

    /* Revoke all other sessions for security */
    await pool.query(
      `UPDATE sso_sessions SET revoked_at=NOW() WHERE user_id=$1 AND tenant_id=$2 AND revoked_at IS NULL`,
      [userId, tid]
    );

    /* Issue new token */
    const token = generateToken();
    const tokenHash = await hashToken(token);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await pool.query(
      `INSERT INTO sso_sessions (user_id, tenant_id, token_hash, ip_address, user_agent, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [userId, tid, tokenHash, req.ip || '', req.headers['user-agent'] || '', expiresAt]
    );

    audit({ action: 'sso_password_change', userId, tid });
    res.json({ success: true, message: 'Password changed successfully. All other sessions have been revoked.', token, expires_at: expiresAt.toISOString() });
  }));

  /* ── 7. POST /sso/forgot-password ──────────────────────────── */
  app.post('/sso/forgot-password', ah(async (req, res) => {
    const { email, tenant_id: bodyTid } = req.body;
    const tid = bodyTid || 0;
    const cleanEmail = (email || '').trim().toLowerCase();

    if (!cleanEmail) {
      return res.status(400).json({ success: false, error: 'Email is required.' });
    }

    /* Rate limit: max 3 requests per hour per email */
    const recentRes = await pool.query(
      `SELECT COUNT(*)::int as cnt FROM sso_password_resets
       WHERE tenant_id=$1 AND email=$2 AND created_at > NOW() - INTERVAL '1 hour'`,
      [tid, cleanEmail]
    );
    if (recentRes.rows[0].cnt >= 3) {
      return res.status(429).json({ success: false, error: 'Too many reset requests. Please try again later.' });
    }

    /* Check user exists */
    const userRes = await pool.query(
      `SELECT id FROM users WHERE tenant_id=$1 AND LOWER(email)=$2`, [tid, cleanEmail]
    );

    /* Always return success to prevent email enumeration */
    if (userRes.rows.length > 0) {
      const token = generateToken();
      const tokenHash = await hashToken(token);
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); /* 1 hour */

      /* Invalidate previous tokens */
      await pool.query(
        `UPDATE sso_password_resets SET used=true WHERE tenant_id=$1 AND email=$2 AND used=false`,
        [tid, cleanEmail]
      );

      await pool.query(
        `INSERT INTO sso_password_resets (tenant_id, email, token_hash, expires_at)
         VALUES ($1,$2,$3,$4)`,
        [tid, cleanEmail, tokenHash, expiresAt]
      );

      /* In production: send reset email with token here */
      audit({ action: 'sso_forgot_password', userId: userRes.rows[0].id, tid });
    }

    res.json({ success: true, message: 'If an account exists with that email, a reset link has been sent.' });
  }));

  /* ── 8. POST /sso/reset-password ──────────────────────────── */
  app.post('/sso/reset-password', ah(async (req, res) => {
    const { token, new_password, tenant_id: bodyTid } = req.body;
    const tid = bodyTid || 0;

    if (!token || !new_password) {
      return res.status(400).json({ success: false, error: 'Token and new password are required.' });
    }
    if (new_password.length < 6) {
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters.' });
    }

    /* Find valid reset token */
    const resetRes = await pool.query(
      `SELECT id, email FROM sso_password_resets
       WHERE tenant_id=$1 AND used=false AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [tid]
    );

    /* Verify token hash against all recent unexpired tokens for tenant */
    const allResetsRes = await pool.query(
      `SELECT id, email, token_hash FROM sso_password_resets
       WHERE tenant_id=$1 AND used=false AND expires_at > NOW()`,
      [tid]
    );

    let matchedReset = null;
    for (const row of allResetsRes.rows) {
      if (await bcrypt.compare(token, row.token_hash)) {
        matchedReset = row;
        break;
      }
    }

    if (!matchedReset) {
      return res.status(400).json({ success: false, error: 'Invalid or expired reset token.' });
    }

    /* Mark token as used */
    await pool.query(`UPDATE sso_password_resets SET used=true WHERE id=$1`, [matchedReset.id]);

    /* Update password */
    const newHash = await bcrypt.hash(new_password, 12);
    await pool.query(
      `UPDATE users SET password_hash=$1, updated_at=NOW() WHERE tenant_id=$2 AND LOWER(email)=$3`,
      [newHash, tid, matchedReset.email]
    );

    /* Revoke all sessions for this user */
    await pool.query(
      `UPDATE sso_sessions SET revoked_at=NOW()
       WHERE tenant_id=$1 AND user_id IN (SELECT id FROM users WHERE tenant_id=$1 AND LOWER(email)=$2)
       AND revoked_at IS NULL`,
      [tid, matchedReset.email]
    );

    audit({ action: 'sso_password_reset', email: matchedReset.email, tid });
    res.json({ success: true, message: 'Password reset successfully. You can now log in with your new password.' });
  }));

  /* ── 9. GET /sso/verify-email/:token ──────────────────────── */
  app.get('/sso/verify-email/:token', ah(async (req, res) => {
    const token = req.params.token;
    const tid = parseInt(req.query.tenant_id) || 0;

    if (!token) {
      let content = CSS + '<div class="sso-wrap"><div class="sso-card"><h2>Email Verification</h2>';
      content += '<div class="sso-flash sso-flash-err">No verification token provided.</div>';
      content += '<a class="sso-btn sso-btn-primary" href="/login">Back to Login</a></div></div>';
      return res.send(renderPage('Email Verification', content, null));
    }

    /* Find matching token */
    const verifRes = await pool.query(
      `SELECT id, email, token_hash FROM sso_email_verifications
       WHERE tenant_id=$1 AND verified=false ORDER BY created_at DESC`,
      [tid]
    );

    let matched = null;
    for (const row of verifRes.rows) {
      if (await bcrypt.compare(token, row.token_hash)) {
        matched = row;
        break;
      }
    }

    if (!matched) {
      let content = CSS + '<div class="sso-wrap"><div class="sso-card"><h2>Email Verification</h2>';
      content += '<div class="sso-flash sso-flash-err">Invalid or expired verification link.</div>';
      content += '<a class="sso-btn sso-btn-primary" href="/login">Back to Login</a></div></div>';
      return res.send(renderPage('Email Verification', content, null));
    }

    /* Mark as verified */
    await pool.query(`UPDATE sso_email_verifications SET verified=true WHERE id=$1`, [matched.id]);
    await pool.query(
      `UPDATE users SET email_verified=true WHERE tenant_id=$1 AND LOWER(email)=$2`,
      [tid, matched.email]
    );

    audit({ action: 'sso_email_verified', email: matched.email, tid });

    let content = CSS + '<div class="sso-wrap"><div class="sso-card" style="text-align:center;padding:48px 24px">';
    content += '<div style="font-size:3rem;margin-bottom:16px">&#10003;</div>';
    content += '<h2 style="color:var(--success)">Email Verified Successfully!</h2>';
    content += `<p style="color:var(--gray);margin:16px 0">${esc(matched.email)} has been verified.</p>`;
    content += '<a class="sso-btn sso-btn-primary" href="/login">Continue to Login</a>';
    content += '</div></div>';

    res.send(renderPage('Email Verified', content, null));
  }));

  /* ── 10. POST /sso/switch-portal — Switch portal type ──────── */
  app.post('/sso/switch-portal', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const userId = req.session.user.id;
    const { portal_type } = req.body;

    if (!portal_type) {
      return res.status(400).json({ success: false, error: 'Portal type is required.' });
    }

    const validPortals = ['main', 'student', 'church', 'worker', 'parent'];
    if (!validPortals.includes(portal_type)) {
      return res.status(400).json({ success: false, error: `Invalid portal type. Must be one of: ${validPortals.join(', ')}` });
    }

    /* Check if user has access to this portal */
    const accessRes = await pool.query(
      `SELECT id FROM sso_portal_access WHERE tenant_id=$1 AND user_id=$2 AND portal_type=$3`,
      [tid, userId, portal_type]
    );

    if (!accessRes.rows.length) {
      return res.status(403).json({ success: false, error: 'You do not have access to the requested portal.' });
    }

    /* Update user's active portal */
    await pool.query(
      `UPDATE users SET portal_type=$1 WHERE id=$2 AND tenant_id=$3`,
      [portal_type, userId, tid]
    );

    /* Update session */
    req.session.user.portal_type = portal_type;

    /* Log the portal switch */
    await pool.query(
      `INSERT INTO sso_login_log (user_id, tenant_id, method, ip_address, user_agent, success, failure_reason, created_at)
       VALUES ($1,$2,'portal_switch',$3,$4,true,'Switched to ' || $5,NOW())`,
      [userId, tid, req.ip || '', req.headers['user-agent'] || '', portal_type]
    );

    audit({ action: 'sso_portal_switch', userId, tid, from: req.session.user.portal_type, to: portal_type });

    const redirectMap = {
      main: '/school/dashboard',
      student: '/student/dashboard',
      church: '/church/dashboard',
      worker: '/worker/dashboard',
      parent: '/parent/dashboard'
    };

    res.json({
      success: true,
      portal_type,
      redirect: redirectMap[portal_type] || '/school/dashboard',
      message: `Switched to ${portal_type} portal.`
    });
  }));

  /* ═══════════════════════ HTML UI ROUTES ═══════════════════════ */

  /* ── GET /sso/settings — SSO Settings page ─────────────────── */
  app.get('/sso/settings', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const userId = req.session.user.id;

    const [userRes, portalsRes, sessionsRes, logRes] = await Promise.all([
      pool.query(
        `SELECT email, phone, full_name, role, portal_type, email_verified, created_at
         FROM users WHERE id=$1 AND tenant_id=$2`, [userId, tid]
      ),
      pool.query(
        `SELECT portal_type, created_at FROM sso_portal_access WHERE tenant_id=$1 AND user_id=$2`, [tid, userId]
      ),
      pool.query(
        `SELECT COUNT(*)::int as total FROM sso_sessions
         WHERE user_id=$1 AND tenant_id=$2 AND expires_at > NOW() AND revoked_at IS NULL`, [userId, tid]
      ),
      pool.query(
        `SELECT method, success, ip_address, created_at FROM sso_login_log
         WHERE user_id=$1 AND tenant_id=$2 ORDER BY created_at DESC LIMIT 10`, [userId, tid]
      )
    ]);

    const user = userRes.rows[0];
    const portals = portalsRes.rows;
    const activeSessions = sessionsRes.rows[0].total;

    const portalLabels = { main: 'Main', student: 'Student', church: 'Church', worker: 'Worker', parent: 'Parent' };

    let content = CSS;
    content += '<div class="sso-wrap">';
    content += flashMsg(req.query.flash_type, req.query.flash);
    content += '<h2 style="margin-bottom:20px">SSO Settings</h2>';

    /* Profile card */
    content += '<div class="sso-card"><h2>Profile</h2>';
    content += '<table class="sso-table"><tbody>';
    content += `<tr><td style="font-weight:600;width:160px">Name</td><td>${esc(user.full_name || '—')}</td></tr>`;
    content += `<tr><td style="font-weight:600">Email</td><td>${esc(user.email || '—')} ${user.email_verified ? '<span class="sso-badge sso-badge-green">Verified</span>' : '<span class="sso-badge sso-badge-yellow">Unverified</span>'}</td></tr>`;
    content += `<tr><td style="font-weight:600">Phone</td><td>${esc(user.phone || '—')}</td></tr>`;
    content += `<tr><td style="font-weight:600">Role</td><td><span class="sso-badge sso-badge-blue">${esc(user.role || 'user')}</span></td></tr>`;
    content += `<tr><td style="font-weight:600">Active Sessions</td><td>${activeSessions}</td></tr>`;
    content += `<tr><td style="font-weight:600">Member Since</td><td>${esc(new Date(user.created_at).toLocaleDateString())}</td></tr>`;
    content += '</tbody></table></div>';

    /* Portal Access card */
    content += '<div class="sso-card"><h2>Portal Access</h2>';
    if (portals.length === 0) {
      content += '<p style="color:var(--gray)">No portal access configured.</p>';
    } else {
      content += '<div style="display:flex;gap:10px;flex-wrap:wrap">';
      for (const p of portals) {
        const isActive = user.portal_type === p.portal_type;
        content += `<div style="padding:12px 20px;border-radius:8px;border:2px solid ${isActive ? 'var(--pri)' : '#e5e7eb'};${isActive ? 'background:rgba(79,70,229,.05)' : ''}">`;
        content += `<strong>${esc(portalLabels[p.portal_type] || p.portal_type)}</strong>`;
        content += isActive ? ' <span class="sso-badge sso-badge-green">Active</span>' : '';
        content += `<br><span style="font-size:.8rem;color:var(--gray)">Granted ${esc(new Date(p.created_at).toLocaleDateString())}</span>`;
        content += '</div>';
      }
      content += '</div>';
    }
    content += '</div>';

    /* Recent logins */
    content += '<div class="sso-card"><h2>Recent Login Activity</h2>';
    if (logRes.rows.length === 0) {
      content += '<p style="color:var(--gray)">No recent login activity.</p>';
    } else {
      content += '<table class="sso-table"><thead><tr><th>Method</th><th>Result</th><th>IP</th><th>Time</th></tr></thead><tbody>';
      for (const l of logRes.rows) {
        content += `<tr>
          <td>${esc(l.method)}</td>
          <td><span class="sso-badge ${l.success ? 'sso-badge-green' : 'sso-badge-red'}">${l.success ? 'Success' : 'Failed'}</span></td>
          <td>${esc(l.ip_address || '—')}</td>
          <td>${esc(new Date(l.created_at).toLocaleString())}</td></tr>`;
      }
      content += '</tbody></table>';
    }
    content += '</div></div>';

    res.send(renderPage('SSO Settings', content, req.session.user));
  }));

  console.log('[SSO] Module loaded — 5 tables, 10 routes');
};
