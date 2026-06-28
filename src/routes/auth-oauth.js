// src/routes/auth-oauth.js
//
// OAuth2 (Google + Microsoft) authentication routes (extracted from
// server.js as part of the Conservative route-extraction refactor —
// Track 1, Task t1).
//
// Behavior is identical to the original inline handlers in server.js.
// The module exports a factory that accepts a shared context object so the
// route handlers can close over the same `pool`, `bcrypt`, `audit`, `ah`,
// `renderPage`, `esc`, `crypto`, etc. that the rest of server.js uses —
// no behavior changes, no re-definitions.
//
// Mount point in server.js:
//   app.use('/auth', require('./src/routes/auth-oauth')(sharedCtx));
//
// NOTE: The inline `require('crypto')` calls in the original handlers are
// preserved verbatim — they re-require the already-cached `crypto` module
// (negligible cost) and behavior is unchanged.

module.exports = function createAuthOauthRouter(ctx) {
  const express = require('express');
  const router = express.Router();
  const { pool, bcrypt, audit, ah, renderPage, esc, crypto } = ctx;

  // =====================================================================
  // v6.0 placeholders (legacy /auth/oauth/* paths)
  // =====================================================================

  // GET /auth/oauth/google — redirect to Google consent screen
  router.get('/oauth/google', (req, res) => {
    if (!process.env.GOOGLE_CLIENT_ID) return res.send(renderPage('OAuth', '<div class="card"><div class="alert alert-info"><h2>Google OAuth</h2><p>Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET env vars to enable Google login.</p></div><a href="/login" class="btn">Back to Login</a></div>', null));
    const redirectUri = encodeURIComponent(`${process.env.BASE_URL || 'https://ssewasswa.onrender.com'}/auth/oauth/google/callback`);
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?client_id=${process.env.GOOGLE_CLIENT_ID}&redirect_uri=${redirectUri}&response_type=code&scope=openid+email+profile`);
  });

  // GET /auth/oauth/microsoft — redirect to Microsoft consent screen
  router.get('/oauth/microsoft', (req, res) => {
    if (!process.env.MS_CLIENT_ID) return res.send(renderPage('OAuth', '<div class="card"><div class="alert alert-info"><h2>Microsoft OAuth</h2><p>Set MS_CLIENT_ID and MS_CLIENT_SECRET env vars to enable Microsoft login.</p></div><a href="/login" class="btn">Back to Login</a></div>', null));
    const state = crypto.randomBytes(16).toString('hex');
    res.redirect(`https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${process.env.MS_CLIENT_ID}&response_type=code&scope=openid+email+profile&state=${state}`);
  });

  // =====================================================================
  // v6.0 OAuth2 callback (full implementation for /auth/oauth/google/callback)
  // =====================================================================

  // GET /auth/oauth/google/callback
  router.get('/oauth/google/callback', ah(async (req, res) => {
    const { code } = req.query;
    if (!code) return res.redirect('/login');
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) return res.redirect('/login');
    try {
      const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: `${process.env.BASE_URL || 'https://ssewasswa.onrender.com'}/auth/oauth/google/callback`, grant_type: 'authorization_code' })
      });
      const tokens = await tokenResp.json();
      if (tokens.id_token) {
        const payload = JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64').toString());
        const email = payload.email;
        const name = payload.name || email.split('@')[0];
        // Find or create user
        let user = (await pool.query('SELECT * FROM users WHERE email=$1', [email])).rows[0];
        if (!user) {
          // Auto-register with first tenant or create new
          const tenant = (await pool.query('SELECT * FROM tenants ORDER BY id LIMIT 1')).rows[0];
          if (tenant) {
            const pwd = crypto.randomBytes(16).toString('hex');
            const hash = await bcrypt.hash(pwd, 12);
            await pool.query('INSERT INTO users(tenant_id,email,password,password_hash,role,approved) VALUES($1,$2,$3,$4,$5,$6)', [tenant.id, email, pwd, hash, 'user', true]);
            user = (await pool.query('SELECT * FROM users WHERE email=$1', [email])).rows[0];
          }
        }
        if (user) {
          req.session.user = { id: user.id, email: user.email, role: user.role, tenant_id: user.tenant_id, dark_mode: user.dark_mode, banned: user.banned };
          await audit(email, 'oauth_login', 'Google', user?.tenant_id, req);
          return res.redirect('/dashboard');
        }
      }
    } catch(e) { console.warn('Google OAuth error:', e.message); }
    res.redirect('/login');
  }));

  // =====================================================================
  // FEATURE 6: OAUTH2 LOGIN (Google + Microsoft) — newer /auth/* paths
  // =====================================================================

  // GET /auth/google
  router.get('/google', (req, res) => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = (process.env.BASE_URL || '') + '/auth/google/callback';
    if (!clientId) return res.send(renderPage('OAuth2', '<div class="card" style="max-width:500px;margin:40px auto;text-align:center"><h2>Google Login Not Configured</h2><p class="muted">Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET env vars to enable Google OAuth2 login.</p><a href="/login" class="btn">Back to Login</a></div>', null));
    const scope = 'openid email profile';
    const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}&access_type=offline&prompt=select_account`;
    res.redirect(url);
  });

  // GET /auth/google/callback
  router.get('/google/callback', ah(async (req, res) => {
    const { code, error } = req.query;
    if (error) return res.send(renderPage('OAuth2 Error', `<div class="card" style="max-width:500px;margin:40px auto"><h2>Google Login Error</h2><p>${esc(error)}</p><a href="/login" class="btn">Back to Login</a></div>`, null));
    if (!code || !process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) return res.redirect('/login');
    try {
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `code=${code}&client_id=${process.env.GOOGLE_CLIENT_ID}&client_secret=${process.env.GOOGLE_CLIENT_SECRET}&redirect_uri=${encodeURIComponent((process.env.BASE_URL||'')+'/auth/google/callback')}&grant_type=authorization_code`
      });
      const tokens = await tokenRes.json();
      if (!tokens.access_token) return res.send(renderPage('OAuth2 Error', '<div class="card" style="max-width:500px;margin:40px auto"><h2>Token Error</h2><p>Could not obtain access token from Google.</p><a href="/login" class="btn">Back to Login</a></div>', null));
      const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: `Bearer ${tokens.access_token}` } });
      const profile = await profileRes.json();
      let u = (await pool.query('SELECT u.*,t.name as tenant_name,t.type as tenant_type FROM users u LEFT JOIN tenants t ON u.tenant_id=t.id WHERE u.email=$1', [profile.email])).rows[0];
      if (!u) {
        // Auto-create account via OAuth2
        const googleSubdomain = 'google-' + Math.floor(Math.random() * 9999);
        const tenantResult = await pool.query('INSERT INTO tenants (name, type, email, verified, approved, subdomain) VALUES ($1, $2, $3, true, true, $4) RETURNING id', [profile.name || 'Google User', 'individual', profile.email, googleSubdomain]);
        const tenantId = tenantResult.rows[0].id;
        const hash = await bcrypt.hash(require('crypto').randomBytes(32).toString('hex'), 12);
        u = (await pool.query('INSERT INTO users (tenant_id, email, password, role, approved) VALUES ($1, $2, $3, $4, true) RETURNING id, tenant_id, email, role, approved, dark_mode, created_at', [tenantId, profile.email, hash, 'admin'])).rows[0];
        await pool.query('INSERT INTO subscriptions (tenant_id, plan, status, expires_at) VALUES ($1, \'starter\', \'active\', NOW() + INTERVAL \'30 days\')', [tenantId]);
        u = (await pool.query('SELECT u.*,t.name as tenant_name,t.type as tenant_type FROM users u LEFT JOIN tenants t ON u.tenant_id=t.id WHERE u.email=$1', [profile.email])).rows[0];
      }
      if (u.banned) return res.send(renderPage('Banned', '<div class="card"><div class="alert alert-error">Account banned</div><a href="/login" class="btn">Back</a></div>', null));
      req.session.user = u;
      audit(u.email, 'oauth2_google_login', 'Google OAuth2 login');
      res.redirect('/dashboard');
    } catch (e) {
      res.send(renderPage('OAuth2 Error', `<div class="card" style="max-width:500px;margin:40px auto"><h2>Error</h2><p>${esc(e.message)}</p><a href="/login" class="btn">Back to Login</a></div>`, null));
    }
  }));

  // GET /auth/microsoft
  router.get('/microsoft', (req, res) => {
    const clientId = process.env.MS_CLIENT_ID;
    const redirectUri = (process.env.BASE_URL || '') + '/auth/microsoft/callback';
    if (!clientId) return res.send(renderPage('OAuth2', '<div class="card" style="max-width:500px;margin:40px auto;text-align:center"><h2>Microsoft Login Not Configured</h2><p class="muted">Set MS_CLIENT_ID and MS_CLIENT_SECRET env vars to enable Microsoft OAuth2 login.</p><a href="/login" class="btn">Back to Login</a></div>', null));
    const scope = 'openid email profile User.Read';
    const url = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}`;
    res.redirect(url);
  });

  // GET /auth/microsoft/callback
  router.get('/microsoft/callback', ah(async (req, res) => {
    const { code, error } = req.query;
    if (error) return res.send(renderPage('OAuth2 Error', `<div class="card" style="max-width:500px;margin:40px auto"><h2>Microsoft Login Error</h2><p>${esc(error)}</p><a href="/login" class="btn">Back to Login</a></div>`, null));
    if (!code || !process.env.MS_CLIENT_ID || !process.env.MS_CLIENT_SECRET) return res.redirect('/login');
    try {
      const tokenRes = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `code=${code}&client_id=${process.env.MS_CLIENT_ID}&client_secret=${process.env.MS_CLIENT_SECRET}&redirect_uri=${encodeURIComponent((process.env.BASE_URL||'')+'/auth/microsoft/callback')}&grant_type=authorization_code&scope=openid email profile`
      });
      const tokens = await tokenRes.json();
      if (!tokens.access_token) return res.send(renderPage('OAuth2 Error', '<div class="card" style="max-width:500px;margin:40px auto"><h2>Token Error</h2><p>Could not obtain access token from Microsoft.</p><a href="/login" class="btn">Back to Login</a></div>', null));
      const profileRes = await fetch('https://graph.microsoft.com/v1.0/me', { headers: { Authorization: 'Bearer ' + tokens.access_token } });
      const profile = await profileRes.json();
      const email = profile.mail || profile.userPrincipalName;
      if (!email) return res.redirect('/login');
      let u = (await pool.query('SELECT u.*,t.name as tenant_name,t.type as tenant_type FROM users u LEFT JOIN tenants t ON u.tenant_id=t.id WHERE u.email=$1', [email])).rows[0];
      if (!u) {
        const msSubdomain = 'ms-' + Math.floor(Math.random() * 9999);
        const tenantResult = await pool.query('INSERT INTO tenants (name, type, email, verified, approved, subdomain) VALUES ($1, $2, $3, true, true, $4) RETURNING id', [profile.displayName || 'Microsoft User', 'individual', email, msSubdomain]);
        const tenantId = tenantResult.rows[0].id;
        const hash = await bcrypt.hash(require('crypto').randomBytes(32).toString('hex'), 12);
        u = (await pool.query('INSERT INTO users (tenant_id, email, password, role, approved) VALUES ($1, $2, $3, $4, true) RETURNING id, tenant_id, email, role, approved, dark_mode, created_at', [tenantId, email, hash, 'admin'])).rows[0];
        await pool.query('INSERT INTO subscriptions (tenant_id, plan, status, expires_at) VALUES ($1, \'starter\', \'active\', NOW() + INTERVAL \'30 days\')', [tenantId]);
        u = (await pool.query('SELECT u.*,t.name as tenant_name,t.type as tenant_type FROM users u LEFT JOIN tenants t ON u.tenant_id=t.id WHERE u.email=$1', [email])).rows[0];
      }
      if (u.banned) return res.send(renderPage('Banned', '<div class="card"><div class="alert alert-error">Account banned</div><a href="/login" class="btn">Back</a></div>', null));
      req.session.user = u;
      audit(u.email, 'oauth2_microsoft_login', 'Microsoft OAuth2 login');
      res.redirect('/dashboard');
    } catch (e) {
      res.send(renderPage('OAuth2 Error', `<div class="card" style="max-width:500px;margin:40px auto"><h2>Error</h2><p>${esc(e.message)}</p><a href="/login" class="btn">Back to Login</a></div>`, null));
    }
  }));

  return router;
};
