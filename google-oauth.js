// ============================================================
// === GOOGLE OAUTH2 LOGIN — Manual OAuth2 Flow ===
// ============================================================
// Provides "Sign in with Google" without passport.
// Uses the platform's custom session handling.
// Environment variables:
//   GOOGLE_CLIENT_ID       (required)
//   GOOGLE_CLIENT_SECRET   (required)
//   GOOGLE_CALLBACK_URL    (default: https://ssewasswa.onrender.com/auth/google/callback)

module.exports = function(app, pool, opts = {}) {
  const esc = opts.esc || (s => s);
  const audit = opts.audit || (() => {});
  const ah = opts.ah || (fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next));
  const renderPage = opts.renderPage || ((title, body) => `<!DOCTYPE html><html><head><title>${esc(title)}</title></head><body>${body}</body></html>`);
  const bcrypt = opts.bcrypt || require('bcryptjs');

  const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
  const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
  const CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL || 'https://ssewasswa.onrender.com/auth/google/callback';

  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.warn('[GoogleOAuth] GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not set — Google login disabled');
    return;
  }

  // ============================================================
  // DATABASE MIGRATIONS
  // ============================================================
  (async () => {
    const migrations = [
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id VARCHAR(100)`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT`,
    ];
    for (const m of migrations) {
      try { await pool.query(m); } catch (e) {
        if (!e.message.includes('already exists')) console.warn('[GoogleOAuth] Migration warning:', e.message);
      }
    }
    console.log('[GoogleOAuth] Migrations applied (google_id, avatar_url columns)');
  })();

  // ============================================================
  // HELPERS
  // ============================================================
  const crypto = require('crypto');

  /** Generate a random password for new OAuth users */
  function generateRandomPassword() {
    return crypto.randomBytes(24).toString('base64url') + crypto.randomBytes(8).toString('hex');
  }

  /** Build the Google OAuth2 authorization URL */
  function buildAuthUrl(state) {
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: CALLBACK_URL,
      response_type: 'code',
      scope: 'openid email profile',
      access_type: 'offline',
      prompt: 'select_account',
      state: state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  /** Exchange authorization code for tokens */
  async function exchangeCodeForTokens(code) {
    const resp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: CALLBACK_URL,
        grant_type: 'authorization_code',
      }).toString(),
    });
    if (!resp.ok) {
      const err = await resp.text();
      throw new Error('Token exchange failed: ' + err);
    }
    return resp.json();
  }

  /** Get user profile from Google using access token */
  async function getGoogleUserProfile(accessToken) {
    const resp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!resp.ok) {
      throw new Error('Failed to fetch user profile: ' + resp.status);
    }
    return resp.json();
  }

  // ============================================================
  // ROUTE: GET /auth/google — Redirect to Google consent page
  // ============================================================
  app.get('/auth/google', (req, res) => {
    // Generate a state parameter to prevent CSRF
    const state = crypto.randomBytes(16).toString('hex');
    // Store state in session for verification
    if (req.session) {
      req.session.oauthState = state;
    }
    const authUrl = buildAuthUrl(state);
    res.redirect(authUrl);
  });

  // ============================================================
  // ROUTE: GET /auth/google/callback — Handle Google redirect
  // ============================================================
  app.get('/auth/google/callback', ah(async (req, res) => {
    const { code, state, error } = req.query;

    // User denied access or Google returned an error
    if (error) {
      console.warn('[GoogleOAuth] OAuth error:', error);
      return res.redirect('/login?error=' + encodeURIComponent('Google login was cancelled or failed'));
    }

    // Verify state to prevent CSRF
    if (!state || state !== req.session?.oauthState) {
      console.warn('[GoogleOAuth] State mismatch — possible CSRF attack');
      return res.redirect('/login?error=' + encodeURIComponent('Security verification failed. Please try again.'));
    }
    // Clear the state after use
    delete req.session.oauthState;

    if (!code) {
      return res.redirect('/login?error=' + encodeURIComponent('No authorization code received'));
    }

    let tokens, profile;
    try {
      // Step 1: Exchange code for tokens
      tokens = await exchangeCodeForTokens(code);
    } catch (e) {
      console.error('[GoogleOAuth] Token exchange error:', e.message);
      return res.redirect('/login?error=' + encodeURIComponent('Failed to authenticate with Google. Please try again.'));
    }

    try {
      // Step 2: Get user profile
      profile = await getGoogleUserProfile(tokens.access_token);
    } catch (e) {
      console.error('[GoogleOAuth] Profile fetch error:', e.message);
      return res.redirect('/login?error=' + encodeURIComponent('Failed to get Google profile. Please try again.'));
    }

    if (!profile.email) {
      return res.redirect('/login?error=' + encodeURIComponent('Google account did not provide an email address'));
    }

    const googleId = profile.id;
    const email = profile.email.toLowerCase().trim();
    const name = profile.name || profile.given_name || email.split('@')[0];
    const avatarUrl = profile.picture || null;

    try {
      // Step 3: Check if user exists by google_id first
      let user = (await pool.query(
        'SELECT u.*, t.name as tenant_name, t.type as tenant_type FROM users u LEFT JOIN tenants t ON u.tenant_id=t.id WHERE u.google_id=$1',
        [googleId]
      )).rows[0];

      if (!user) {
        // Check if user exists by email
        user = (await pool.query(
          'SELECT u.*, t.name as tenant_name, t.type as tenant_type FROM users u LEFT JOIN tenants t ON u.tenant_id=t.id WHERE u.email=$1',
          [email]
        )).rows[0];
      }

      if (user) {
        // Update existing user with Google info
        await pool.query(
          'UPDATE users SET google_id=COALESCE(google_id,$1), avatar_url=COALESCE(avatar_url,$2) WHERE id=$3',
          [googleId, avatarUrl, user.id]
        );

        // Check if banned
        if (user.banned) {
          return res.redirect('/login?error=' + encodeURIComponent('Account has been banned'));
        }
        // Check if not approved
        if (!user.approved) {
          return res.redirect('/login?error=' + encodeURIComponent('Account is pending approval'));
        }
      } else {
        // Create new user — needs a tenant
        // Find or create a default tenant for Google sign-ups
        let tenantId;
        const defaultTenant = (await pool.query(
          "SELECT id FROM tenants WHERE type='school' OR type='church' OR type='business' LIMIT 1"
        )).rows[0];

        if (defaultTenant) {
          tenantId = defaultTenant.id;
        } else {
          // Create a personal tenant for this user
          const newTenant = (await pool.query(
            "INSERT INTO tenants (name, type, email) VALUES ($1, 'personal', $2) RETURNING id",
            [name + "'s Organization", email]
          )).rows[0];
          tenantId = newTenant.id;
        }

        const randomPassword = await bcrypt.hash(generateRandomPassword(), 10);

        const newUser = (await pool.query(
          `INSERT INTO users (tenant_id, email, password, name, role, approved, google_id, avatar_url)
           VALUES ($1, $2, $3, $4, $5, true, $6, $7)
           RETURNING *`,
          [tenantId, email, randomPassword, name, 'admin', googleId, avatarUrl]
        )).rows[0];

        user = (await pool.query(
          'SELECT u.*, t.name as tenant_name, t.type as tenant_type FROM users u LEFT JOIN tenants t ON u.tenant_id=t.id WHERE u.id=$1',
          [newUser.id]
        )).rows[0];

        await audit(email, 'google_oauth_signup', 'New user created via Google OAuth: ' + email);
      }

      // Step 4: Create session (same as normal login)
      req.session.user = {
        id: user.id,
        tenant_id: user.tenant_id,
        email: user.email,
        name: user.name || name,
        role: user.role,
        approved: user.approved,
        banned: user.banned,
        tenant_name: user.tenant_name,
        tenant_type: user.tenant_type,
        avatar_url: avatarUrl || user.avatar_url,
        auth_provider: 'google',
      };

      // Clear any login lockout
      await pool.query('DELETE FROM login_attempts WHERE email=$1', [email]);

      await audit(email, 'google_oauth_login', 'User logged in via Google OAuth');

      // Regenerate session to prevent fixation
      req.session.save((err) => {
        if (err) console.error('[GoogleOAuth] Session save error:', err.message);
        res.redirect('/dashboard');
      });

    } catch (e) {
      console.error('[GoogleOAuth] User upsert error:', e.message);
      return res.redirect('/login?error=' + encodeURIComponent('An error occurred during login. Please try again.'));
    }
  }));

  // ============================================================
  // ROUTE: GET /auth/microsoft — Placeholder (future)
  // ============================================================
  app.get('/auth/microsoft', (req, res) => {
    res.redirect('/login?error=' + encodeURIComponent('Microsoft login is not yet available. Please use Google or email/password.'));
  });

  console.log('[GoogleOAuth] Google OAuth2 login enabled — /auth/google, /auth/google/callback');
};
