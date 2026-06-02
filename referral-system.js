// ============================================================
// === REFERRAL & INVITE SYSTEM — Invite & Earn, Growth Loop ===
// ============================================================
// Tracks referral codes, referral signups, rewards for inviters,
// and provides a public invite page for viral growth.

const { migrateQuery } = require('./db');
module.exports = function(app, pool, requireAuth, ah, esc, renderPage, audit, notify, sendEmail, logger) {
  const BASE_URL = process.env.BASE_URL || 'https://ssewasswa.onrender.com';

  // ============================================================
  // IN-MEMORY RATE LIMITER (max 5 referral tracks per IP per hour)
  // ============================================================
  const _refRateLimit = new Map(); // ip -> { count, resetAt }
  const RATE_LIMIT_MAX = 5;
  const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

  function checkRefRateLimit(ip) {
    const now = Date.now();
    const entry = _refRateLimit.get(ip);
    if (!entry || now > entry.resetAt) {
      _refRateLimit.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
      return { allowed: true, remaining: RATE_LIMIT_MAX - 1 };
    }
    if (entry.count >= RATE_LIMIT_MAX) {
      return { allowed: false, remaining: 0, retryAfterMs: entry.resetAt - now };
    }
    entry.count++;
    return { allowed: true, remaining: RATE_LIMIT_MAX - entry.count };
  }

  // Periodic cleanup of stale rate limit entries (every 30 minutes)
  setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of _refRateLimit) {
      if (now > entry.resetAt) _refRateLimit.delete(ip);
    }
  }, 30 * 60 * 1000);

  // ============================================================
  // DATABASE MIGRATIONS
  // ============================================================
  const REFERRAL_MIGRATIONS = [
    `CREATE TABLE IF NOT EXISTS referral_codes (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      user_email TEXT NOT NULL,
      code TEXT UNIQUE NOT NULL,
      uses INTEGER DEFAULT 0,
      max_uses INTEGER DEFAULT 100,
      is_active BOOLEAN DEFAULT true,
      reward_type TEXT DEFAULT 'plan_upgrade',
      reward_value INTEGER DEFAULT 7,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS referral_signups (
      id SERIAL PRIMARY KEY,
      referral_code_id INTEGER REFERENCES referral_codes(id) ON DELETE CASCADE,
      new_user_email TEXT NOT NULL,
      new_tenant_id INTEGER,
      status TEXT DEFAULT 'pending',
      reward_given BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(referral_code_id, new_user_email)
    )`,
    `CREATE TABLE IF NOT EXISTS referral_rewards (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      user_email TEXT NOT NULL,
      reward_type TEXT NOT NULL,
      reward_value INTEGER DEFAULT 0,
      source_email TEXT,
      claimed BOOLEAN DEFAULT false,
      claimed_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
  ];

  // Push migrations to the global array
  if (typeof migrations !== 'undefined') {
    REFERRAL_MIGRATIONS.forEach(m => migrations.push(m));
  }
  if (typeof VALID_TABLES !== 'undefined') {
    ['referral_codes', 'referral_signups', 'referral_rewards'].forEach(t => VALID_TABLES.add(t));
  }

  // Auto-run migrations directly (for safety when loaded via require())
  (async () => {
    for (const m of REFERRAL_MIGRATIONS) {
      try { await pool.query(m); } catch (e) {
        if (!e.message.includes('already exists')) logger.warn('[Referral] Migration warning:', e.message);
      }
    }
  })();

  // ============================================================
  // HELPERS
  // ============================================================
  function generateReferralCode(email) {
    const prefix = email.split('@')[0].substring(0, 6).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const suffix = Math.random().toString(36).substring(2, 6).toUpperCase();
    return prefix + suffix;
  }

  async function getOrCreateReferralCode(tenantId, email) {
    let existing = (await pool.query('SELECT * FROM referral_codes WHERE user_email = $1 AND tenant_id = $2', [email, tenantId])).rows[0];
    if (existing) return existing;
    let code = generateReferralCode(email);
    // Ensure uniqueness
    let attempts = 0;
    while (attempts < 10) {
      const dup = (await pool.query('SELECT id FROM referral_codes WHERE code = $1', [code])).rows[0];
      if (!dup) break;
      code = generateReferralCode(email) + attempts;
      attempts++;
    }
    const result = (await pool.query(
      'INSERT INTO referral_codes (tenant_id, user_email, code) VALUES ($1, $2, $3) RETURNING *',
      [tenantId, email, code]
    )).rows[0];
    return result;
  }

  // ============================================================
  // ROUTES
  // ============================================================

  // My Referrals Dashboard
  app.get('/referrals', requireAuth, ah(async (req, res) => {
    const u = req.session.user;
    const refCode = await getOrCreateReferralCode(u.tenant_id, u.email);
    const signups = (await pool.query(
      'SELECT rs.*, rc.code as ref_code FROM referral_signups rs JOIN referral_codes rc ON rs.referral_code_id = rc.id WHERE rc.user_email = $1 ORDER BY rs.created_at DESC LIMIT 50',
      [u.email]
    )).rows;
    const rewards = (await pool.query(
      'SELECT * FROM referral_rewards WHERE user_email = $1 ORDER BY created_at DESC LIMIT 20',
      [u.email]
    )).rows;
    const totalSignups = signups.length;
    const completedSignups = signups.filter(s => s.status === 'completed').length;
    const unclaimedRewards = rewards.filter(r => !r.claimed).length;
    const referralLink = `${BASE_URL}/invite/${refCode.code}`;

    res.send(renderPage('My Referrals', `
      <div class="hero" style="background:linear-gradient(135deg,#10b981,#059669)">
        <h1>Invite & Earn</h1>
        <p>Share your link and earn rewards for every friend who joins</p>
      </div>

      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:24px">
        <div class="stat-card"><div class="stat-num" style="color:#10b981">${totalSignups}</div><div>Total Invites</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#6366f1">${completedSignups}</div><div>Completed</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${unclaimedRewards}</div><div>Unclaimed Rewards</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#ef4444">${refCode.uses}/${refCode.max_uses}</div><div>Uses</div></div>
      </div>

      <div class="card" style="margin-bottom:20px">
        <h3>Your Referral Link</h3>
        <div style="display:flex;gap:8px;margin-top:12px;align-items:center">
          <input id="refLink" value="${esc(referralLink)}" readonly style="flex:1;padding:12px;border:2px solid #10b981;border-radius:8px;font-size:15px;font-weight:600;color:#10b981;background:#f0fdf4">
          <button onclick="navigator.clipboard.writeText(document.getElementById('refLink').value);this.textContent='Copied!';setTimeout(()=>this.textContent='Copy',2000)" class="btn" style="background:#10b981;white-space:nowrap">Copy</button>
        </div>
        <div style="display:flex;gap:8px;margin-top:12px">
          <button onclick="shareWhatsApp()" style="background:#25d366;color:white;padding:10px 20px;border-radius:8px;border:none;cursor:pointer;font-weight:600">Share on WhatsApp</button>
          <button onclick="shareTwitter()" style="background:#1da1f2;color:white;padding:10px 20px;border-radius:8px;border:none;cursor:pointer;font-weight:600">Share on Twitter</button>
          <button onclick="shareEmail()" style="background:#6366f1;color:white;padding:10px 20px;border-radius:8px;border:none;cursor:pointer;font-weight:600">Share via Email</button>
        </div>
      </div>

      <div class="card" style="margin-bottom:20px">
        <h3>How It Works</h3>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:12px">
          <div style="padding:16px;background:#f0fdf4;border-radius:12px;text-align:center">
            <div style="font-size:32px;margin-bottom:8px">1</div>
            <h4>Share Your Link</h4>
            <p style="color:#64748b;font-size:13px">Send your unique referral link to friends, colleagues, and organizations</p>
          </div>
          <div style="padding:16px;background:#eff6ff;border-radius:12px;text-align:center">
            <div style="font-size:32px;margin-bottom:8px">2</div>
            <h4>They Sign Up</h4>
            <p style="color:#64748b;font-size:13px">When someone creates an account using your link, it counts as a referral</p>
          </div>
          <div style="padding:16px;background:#fef3c7;border-radius:12px;text-align:center">
            <div style="font-size:32px;margin-bottom:8px">3</div>
            <h4>Earn Rewards</h4>
            <p style="color:#64748b;font-size:13px">Get 7 days of Pro plan free for each successful referral. Stack rewards up to 90 days!</p>
          </div>
        </div>
      </div>

      ${signups.length > 0 ? `<div class="card" style="margin-bottom:20px">
        <h3>Referral History</h3>
        <table style="width:100%;margin-top:12px"><thead><tr style="border-bottom:2px solid #e2e8f0">
          <th style="text-align:left;padding:8px">Email</th><th>Status</th><th>Date</th><th>Reward</th>
        </tr></thead><tbody>
          ${signups.map(s => `<tr style="border-bottom:1px solid #f1f5f9">
            <td style="padding:8px">${esc(s.new_user_email.replace(/(.{2}).+(@.+)/, '$1***$2'))}</td>
            <td style="padding:8px;text-align:center"><span style="background:${s.status==='completed'?'#dcfce7':'#fef3c7'};color:${s.status==='completed'?'#166534':'#92400e'};padding:2px 8px;border-radius:4px;font-size:12px">${s.status}</span></td>
            <td style="padding:8px;text-align:center;color:#94a3b8;font-size:13px">${new Date(s.created_at).toLocaleDateString()}</td>
            <td style="padding:8px;text-align:center">${s.reward_given ? '<span style="color:#10b981">Claimed</span>' : '<span style="color:#f59e0b">Pending</span>'}</td>
          </tr>`).join('')}
        </tbody></table>
      </div>` : ''}
    `, u) + shareScripts);
  }));

  // Public invite landing page
  app.get('/invite/:code', ah(async (req, res) => {
    const code = req.params.code;
    const refCode = (await pool.query('SELECT * FROM referral_codes WHERE code = $1 AND is_active = true', [code])).rows[0];
    if (!refCode) return res.status(404).send('Invalid or expired invite link');

    const inviter = (await pool.query('SELECT u.email, t.name as org_name FROM users u JOIN tenants t ON u.tenant_id = t.id WHERE u.email = $1 AND u.tenant_id = $2', [refCode.user_email, refCode.tenant_id])).rows[0];
    const orgName = inviter ? inviter.org_name : 'Comfort Zone';
    const inviteLink = `${BASE_URL}/invite/${code}`;

    res.send(`<!DOCTYPE html><html><head><title>You're Invited! — ${esc(orgName)}</title>
      <meta name="description" content="Join ${esc(orgName)} on Comfort Zone — the all-in-one management platform for schools, organizations, churches, and businesses in Uganda.">
      <meta property="og:title" content="You're Invited to ${esc(orgName)}">
      <meta property="og:description" content="Join Comfort Zone and manage your organization smarter. Schools, churches, businesses — all in one platform.">
      <meta property="og:image" content="${BASE_URL}/og-image.png">
      <meta name="robots" content="index, follow">
      <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui;background:#f8fafc;color:#1e293b}a{color:inherit;text-decoration:none}.btn{display:inline-block;padding:12px 32px;border-radius:10px;font-weight:700;font-size:16px;border:none;cursor:pointer;transition:transform 0.2s}.btn:hover{transform:translateY(-1px)}.share-btn{display:inline-flex;align-items:center;gap:6px;padding:10px 20px;border-radius:8px;border:none;cursor:pointer;font-weight:600;color:white;font-size:14px;transition:opacity 0.2s}.share-btn:hover{opacity:0.9}</style>
    </head><body>
      <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px">
        <div style="max-width:600px;width:100%;text-align:center">
          <div style="font-size:64px;margin-bottom:16px">&#127881;</div>
          <h1 style="font-size:32px;margin-bottom:8px">You're Invited!</h1>
          <p style="color:#64748b;font-size:18px;margin-bottom:24px">${esc(orgName)} wants you to join Comfort Zone — the all-in-one platform for managing schools, organizations, churches, and businesses.</p>

          <div style="background:white;padding:24px;border-radius:16px;border:1px solid #e2e8f0;margin-bottom:24px;text-align:left">
            <h3 style="margin-bottom:16px;text-align:center">What you get:</h3>
            <div style="display:grid;gap:12px">
              <div style="display:flex;gap:12px;align-items:center"><span style="font-size:20px">&#128202;</span><div><strong>Smart Dashboard</strong><br><span style="color:#64748b;font-size:13px">Track everything in one place</span></div></div>
              <div style="display:flex;gap:12px;align-items:center"><span style="font-size:20px">&#128176;</span><div><strong>Finance Management</strong><br><span style="color:#64748b;font-size:13px">Fees, donations, invoicing & more</span></div></div>
              <div style="display:flex;gap:12px;align-items:center"><span style="font-size:20px">&#128241;</span><div><strong>Mobile Money Payments</strong><br><span style="color:#64748b;font-size:13px">MTN MoMo, Airtel Money, Flutterwave</span></div></div>
              <div style="display:flex;gap:12px;align-items:center"><span style="font-size:20px">&#128200;</span><div><strong>Analytics & Reports</strong><br><span style="color:#64748b;font-size:13px">Deep insights into your data</span></div></div>
              <div style="display:flex;gap:12px;align-items:center"><span style="font-size:20px">&#127379;</span><div><strong>Free to Start</strong><br><span style="color:#64748b;font-size:13px">No credit card required. Free plan with 50 records.</span></div></div>
            </div>
          </div>

          <div style="background:#f0fdf4;padding:16px;border-radius:12px;margin-bottom:24px;border:1px solid #bbf7d0">
            <p style="color:#166534;font-weight:600">&#127873; Bonus: Sign up with this link and get 7 days of Pro plan FREE!</p>
          </div>

          <a href="/register?ref=${esc(code)}" class="btn" style="background:linear-gradient(135deg,#10b981,#059669);color:white;width:100%;text-align:center;font-size:18px;padding:16px">Join Now — It's Free</a>

          <div style="margin-top:20px;padding-top:20px;border-top:1px solid #e2e8f0">
            <p style="color:#64748b;font-size:14px;margin-bottom:12px">Or share this invite with others:</p>
            <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
              <button onclick="shareWhatsApp()" class="share-btn" style="background:#25d366">WhatsApp</button>
              <button onclick="shareTwitter()" class="share-btn" style="background:#1da1f2">Twitter</button>
              <button onclick="shareEmail()" class="share-btn" style="background:#6366f1">Email</button>
              <button onclick="copyLink()" class="share-btn" style="background:#374151">Copy Link</button>
            </div>
          </div>

          <p style="margin-top:12px;color:#94a3b8;font-size:13px">No credit card required &#183; Free plan available &#183; Trusted by thousands in Uganda</p>
        </div>
      </div>
      <script>
        var _inviteLink = ${JSON.stringify(inviteLink)};
        function shareWhatsApp(){window.open('https://wa.me/?text='+encodeURIComponent('Join me on Comfort Zone! Manage your school, church, or business all in one place. '+_inviteLink))}
        function shareTwitter(){window.open('https://twitter.com/intent/tweet?text='+encodeURIComponent('I\\'m using Comfort Zone to manage my organization — you should try it too! '+_inviteLink))}
        function shareEmail(){window.open('mailto:?subject=You\\'re Invited to Comfort Zone&body='+encodeURIComponent('Hey! I\\'ve been using Comfort Zone to manage my organization and thought you might like it too. Sign up here: '+_inviteLink))}
        function copyLink(){navigator.clipboard.writeText(_inviteLink).then(function(){var b=document.querySelector('[onclick=\"copyLink()\"]');b.textContent='Copied!';setTimeout(function(){b.textContent='Copy Link'},2000)})}
      </script>
    </body></html>`);
  }));

  // API: Track referral signup (called from /register route)
  // FIX: Added authentication, rate limiting, referrer verification
  app.post('/api/referrals/track', ah(async (req, res) => {
    const { ref_code, new_user_email, new_tenant_id } = req.body;

    // 1. Require authenticated user
    if (!req.session || !req.session.user) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    if (!ref_code || !new_user_email) return res.json({ success: false, error: 'Missing ref_code or new_user_email' });

    // 2. Rate limit by IP
    const clientIp = req.ip || req.connection.remoteAddress;
    const rateCheck = checkRefRateLimit(clientIp);
    if (!rateCheck.allowed) {
      return res.status(429).json({ success: false, error: 'Rate limit exceeded. Max 5 referral tracks per hour.', retryAfterMs: rateCheck.retryAfterMs });
    }

    // 3. Verify the referral code exists and is active
    const refCodeRow = (await pool.query('SELECT * FROM referral_codes WHERE code = $1 AND is_active = true', [ref_code])).rows[0];
    if (!refCodeRow) return res.json({ success: false, error: 'Invalid code' });
    if (refCodeRow.uses >= refCodeRow.max_uses) return res.json({ success: false, error: 'Code expired' });

    // 4. Validate that the referring user's email matches a real user in the database
    const referrerUser = (await pool.query('SELECT id, email FROM users WHERE email = $1 AND tenant_id = $2', [refCodeRow.user_email, refCodeRow.tenant_id])).rows[0];
    if (!referrerUser) {
      return res.json({ success: false, error: 'Referrer not found in system' });
    }

    // Record the referral signup
    try {
      await pool.query(
        'INSERT INTO referral_signups (referral_code_id, new_user_email, new_tenant_id, status) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
        [refCodeRow.id, new_user_email, new_tenant_id || null, 'completed']
      );
      // Increment uses
      await pool.query('UPDATE referral_codes SET uses = uses + 1 WHERE id = $1', [refCodeRow.id]);

      // Create reward for the inviter
      const rewardDays = refCodeRow.reward_value || 7;
      const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000); // 90 days to claim
      await pool.query(
        'INSERT INTO referral_rewards (tenant_id, user_email, reward_type, reward_value, source_email, expires_at) VALUES ($1, $2, $3, $4, $5, $6)',
        [refCodeRow.tenant_id, refCodeRow.user_email, 'plan_extension', rewardDays, new_user_email, expiresAt]
      );

      // Notify the inviter
      notify(refCodeRow.tenant_id, refCodeRow.user_email, 'New Referral!', `${new_user_email} signed up using your link. You earned ${rewardDays} days of Pro!`, 'success');

      // Give the new user a free trial too
      await pool.query(
        'INSERT INTO referral_rewards (tenant_id, user_email, reward_type, reward_value, source_email, expires_at) VALUES ($1, $2, $3, $4, $5, $6)',
        [new_tenant_id || refCodeRow.tenant_id, new_user_email, 'free_trial', 7, refCodeRow.user_email, expiresAt]
      );

      logger.info('[Referral] Tracked', { ref_code, new_user_email });
      res.json({ success: true });
    } catch (e) {
      logger.warn('[Referral] Track error:', e.message);
      res.json({ success: false, error: e.message });
    }
  }));

  // Claim a referral reward
  app.post('/referrals/claim/:id', requireAuth, ah(async (req, res) => {
    const u = req.session.user;
    const reward = (await pool.query('SELECT * FROM referral_rewards WHERE id = $1 AND user_email = $2 AND claimed = false', [req.params.id, u.email])).rows[0];
    if (!reward) return res.redirect('/referrals');
    if (reward.expires_at && new Date(reward.expires_at) < new Date()) return res.send('Reward expired');

    // Extend their subscription
    if (reward.reward_type === 'plan_extension') {
      const days = reward.reward_value || 7;
      const sub = (await pool.query("SELECT * FROM subscriptions WHERE tenant_id = $1 AND status = 'active' ORDER BY created_at DESC LIMIT 1", [u.tenant_id])).rows[0];
      if (sub) {
        const newExpiry = new Date(Math.max(new Date(sub.current_period_end || sub.created_at).getTime(), Date.now()) + days * 24 * 60 * 60 * 1000);
        await pool.query('UPDATE subscriptions SET current_period_end = $1 WHERE id = $2', [newExpiry, sub.id]);
      } else {
        // Give them a basic plan trial
        await pool.query(
          "INSERT INTO subscriptions (tenant_id, plan, status, current_period_start, current_period_end) VALUES ($1, 'basic', 'active', NOW(), NOW() + INTERVAL '7 days')",
          [u.tenant_id]
        );
      }
    }

    await pool.query('UPDATE referral_rewards SET claimed = true, claimed_at = NOW() WHERE id = $1', [reward.id]);
    audit(u.email, 'referral_reward_claimed', `Claimed ${reward.reward_type} worth ${reward.reward_value}`);
    res.redirect('/referrals');
  }));

  // ============================================================
  // REFERRAL ANALYTICS: GET /api/referrals/stats
  // Returns total referrals, successful signups, pending rewards
  // ============================================================
  app.get('/api/referrals/stats', requireAuth, ah(async (req, res) => {
    const u = req.session.user;

    try {
      // Total referral codes for this user
      const codeStats = (await pool.query(
        `SELECT COUNT(*)::int AS total_codes, COALESCE(SUM(uses),0)::int AS total_uses
         FROM referral_codes WHERE user_email = $1`,
        [u.email]
      )).rows[0];

      // Total referrals (signups via this user's codes)
      const signupStats = (await pool.query(
        `SELECT
           COUNT(*)::int AS total_referrals,
           COUNT(*) FILTER (WHERE rs.status = 'completed')::int AS successful_signups,
           COUNT(*) FILTER (WHERE rs.status = 'pending')::int AS pending_signups
         FROM referral_signups rs
         JOIN referral_codes rc ON rs.referral_code_id = rc.id
         WHERE rc.user_email = $1`,
        [u.email]
      )).rows[0];

      // Reward stats
      const rewardStats = (await pool.query(
        `SELECT
           COUNT(*)::int AS total_rewards,
           COALESCE(SUM(reward_value),0)::int AS total_reward_value,
           COUNT(*) FILTER (WHERE claimed = false)::int AS pending_rewards,
           COUNT(*) FILTER (WHERE claimed = true)::int AS claimed_rewards,
           COUNT(*) FILTER (WHERE claimed = false AND expires_at < NOW())::int AS expired_rewards
         FROM referral_rewards WHERE user_email = $1`,
        [u.email]
      )).rows[0];

      // Recent referral activity (last 10)
      const recentActivity = (await pool.query(
        `SELECT rs.new_user_email, rs.status, rs.created_at, rc.code
         FROM referral_signups rs
         JOIN referral_codes rc ON rs.referral_code_id = rc.id
         WHERE rc.user_email = $1
         ORDER BY rs.created_at DESC LIMIT 10`,
        [u.email]
      )).rows;

      res.json({
        success: true,
        codes: {
          total: codeStats.total_codes || 0,
          total_uses: codeStats.total_uses || 0
        },
        referrals: {
          total: signupStats.total_referrals || 0,
          successful_signups: signupStats.successful_signups || 0,
          pending_signups: signupStats.pending_signups || 0
        },
        rewards: {
          total: rewardStats.total_rewards || 0,
          total_value_days: rewardStats.total_reward_value || 0,
          pending: rewardStats.pending_rewards || 0,
          claimed: rewardStats.claimed_rewards || 0,
          expired: rewardStats.expired_rewards || 0
        },
        recent: recentActivity.map(r => ({
          email: r.new_user_email.replace(/(.{2}).+(@.+)/, '$1***$2'),
          status: r.status,
          date: r.created_at,
          code: r.code
        }))
      });
    } catch (e) {
      logger.warn('[Referral] Stats error:', e.message);
      res.status(500).json({ success: false, error: 'Failed to load referral stats' });
    }
  }));

  // Share helpers (inline JS) — wired into /referrals dashboard and /invite/:code page
  const shareScripts = `
    <script>
    const refLink = document.getElementById('refLink')?.value || '';
    function shareWhatsApp(){window.open('https://wa.me/?text='+encodeURIComponent('Join me on Comfort Zone! Manage your school, church, or business all in one place. '+refLink))}
    function shareTwitter(){window.open('https://twitter.com/intent/tweet?text='+encodeURIComponent('I\\'m using Comfort Zone to manage my organization — you should try it too! '+refLink))}
    function shareEmail(){window.open('mailto:?subject=You\\'re Invited to Comfort Zone&body='+encodeURIComponent('Hey! I\\'ve been using Comfort Zone to manage my organization and thought you might like it too. Sign up here: '+refLink))}
    </script>`;

  console.log('[Referral] LOADED: Referral codes, invite pages, reward tracking, social sharing, rate limiting, analytics');
};
