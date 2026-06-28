// src/routes/auth-saml-oidc.js
//
// SAML and OIDC SSO authentication routes (extracted from server.js as
// part of the Conservative route-extraction refactor — Track 1, Task t1).
//
// Behavior is identical to the original inline handlers in server.js.
// The module exports a factory that accepts a shared context object so the
// route handlers can close over the same `pool`, `ah`, `audit`, `crypto`,
// `renderPage`, etc. that the rest of server.js uses — no behavior changes,
// no re-definitions.
//
// Mount point in server.js:
//   app.use('/auth', require('./src/routes/auth-saml-oidc')(sharedCtx));

module.exports = function createSamlOidcRouter(ctx) {
  const express = require('express');
  const router = express.Router();
  const { pool, ah, audit, crypto, renderPage } = ctx;

  // SAML SSO login (replaces placeholder)
  // GET /auth/saml/:tenantId
  router.get('/saml/:tenantId', ah(async (req, res) => {
    const config = (await pool.query('SELECT * FROM sso_configs WHERE tenant_id=$1 AND active=true AND protocol=$2', [req.params.tenantId, 'saml'])).rows[0];
    if (!config) return res.status(404).send('No active SAML configuration found for this tenant.');
    // Redirect to IdP SSO URL
    if (config.entry_point) {
      // In production, this would build a proper SAML AuthnRequest
      // For now, redirect to the entry point with relay state
      const relayState = Buffer.from(JSON.stringify({ tenant_id: req.params.tenantId })).toString('base64');
      return res.redirect(`${config.entry_point}?SAMLRequest=...&RelayState=${relayState}`);
    }
    res.send(renderPage('SSO Login', '<div class="card alert alert-info"><h2>SSO Configuration Found</h2><p>Your SAML identity provider is configured. SAML request generation requires the @boxyhq/saml-jackson library for production use.</p></div>', null));
  }));

  // POST /auth/saml/callback
  router.post('/saml/callback', ah(async (req, res) => {
    // Process SAML assertion (simplified — production uses @boxyhq/saml-jackson or passport-saml)
    const relayState = req.body.RelayState;
    try {
      const state = JSON.parse(Buffer.from(relayState || '', 'base64').toString());
      // In production: validate SAML response, extract email, find/create user, set session
      res.redirect('/dashboard');
    } catch (e) {
      res.redirect('/login');
    }
  }));

  // ============================================================
  // Task 3.2: OIDC Support (Auth0, Okta, etc.)
  // ============================================================
  // OIDC authorization flow
  // GET /auth/oidc/:configId
  router.get('/oidc/:configId', ah(async (req, res) => {
    const config = (await pool.query('SELECT * FROM sso_configs WHERE id=$1 AND active=true AND protocol=$2', [req.params.configId, 'oidc'])).rows[0];
    if (!config) return res.status(404).send('No active OIDC configuration found.');
    if (!config.auth_endpoint || !config.client_id) return res.status(400).send('OIDC configuration incomplete. Missing auth endpoint or client ID.');
    // Build OIDC authorization URL
    const redirectUri = `${process.env.BASE_URL || 'https://ssewasswa.onrender.com'}/auth/oidc/callback`;
    const state = crypto.randomBytes(16).toString('hex');
    const authUrl = new URL(config.auth_endpoint);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', config.client_id);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('scope', 'openid email profile');
    authUrl.searchParams.set('state', state);
    // Store state in session for CSRF protection
    req.session.oidcState = state;
    req.session.oidcConfigId = config.id;
    res.redirect(authUrl.toString());
  }));

  // OIDC callback
  // GET /auth/oidc/callback
  router.get('/oidc/callback', ah(async (req, res) => {
    const { code, state } = req.query;
    // Verify state to prevent CSRF
    if (!state || state !== req.session.oidcState) {
      return res.status(400).send('Invalid OAuth state parameter. Possible CSRF attack.');
    }
    const config = (await pool.query('SELECT * FROM sso_configs WHERE id=$1', [req.session.oidcConfigId])).rows[0];
    if (!config) return res.status(404).send('SSO configuration not found.');
    try {
      // Exchange code for tokens
      const redirectUri = `${process.env.BASE_URL || 'https://ssewasswa.onrender.com'}/auth/oidc/callback`;
      const tokenResponse = await fetch(config.token_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: config.client_id, client_secret: config.client_secret_encrypted || '' })
      });
      const tokens = await tokenResponse.json();
      if (!tokens.access_token && !tokens.id_token) {
        return res.status(400).send('Failed to obtain tokens from identity provider.');
      }
      // Decode JWT id_token to get user info (without external library)
      const idToken = tokens.id_token;
      const payloadB64 = idToken.split('.')[1];
      const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
      const email = payload.email || payload.preferred_username;
      if (!email) return res.status(400).send('Email not found in OIDC response.');
      // Find or create user
      let user = (await pool.query('SELECT * FROM users WHERE email=$1', [email])).rows[0];
      if (user) {
        if (user.banned) return res.redirect('/login?error=Account+banned');
        req.session.user = { id: user.id, email: user.email, name: user.name, role: user.role, tenant_id: user.tenant_id };
      } else {
        // Auto-create user under the SSO config's tenant (if applicable)
        return res.redirect('/login?error=No+account+found.+Please+contact+your+administrator.');
      }
      delete req.session.oidcState;
      delete req.session.oidcConfigId;
      await audit(email, 'oidc_login', `OIDC login via ${config.provider_name}`, user?.tenant_id, req);
      res.redirect('/dashboard');
    } catch (e) {
      console.error('[OIDC Error]', e.message);
      res.redirect('/login?error=SSO+authentication+failed');
    }
  }));

  return router;
};
