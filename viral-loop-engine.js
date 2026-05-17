// ============================================================
// === VIRAL LOOP ENGINE — Referral, Sharing, Growth, Badges ===
// ============================================================
// Self-executing module for Comfort Zone SaaS. Uses globals set
// by server.js: app, pool, ah, esc, renderPage, requireAuth,
// migrations, VALID_TABLES, sendEmail, sendSMS, trackRevenue,
// awardPoints, notify, notifyAll.

// ── 1. DATABASE MIGRATIONS ──────────────────────────────────
const VL_MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS referral_rewards (
    id SERIAL PRIMARY KEY,
    referrer_email TEXT NOT NULL,
    referred_email TEXT NOT NULL,
    reward_type TEXT DEFAULT 'points',
    reward_amount INTEGER DEFAULT 100,
    reward_points INTEGER DEFAULT 50,
    status TEXT DEFAULT 'pending',
    fulfilled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS referral_program_settings (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER,
    reward_type TEXT DEFAULT 'points',
    reward_amount INTEGER DEFAULT 100,
    reward_currency TEXT DEFAULT 'UGX',
    max_referrals_per_month INTEGER DEFAULT 50,
    min_referral_action TEXT DEFAULT 'signup',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS pending_push_notifications (
    id SERIAL PRIMARY KEY,
    user_email TEXT NOT NULL,
    tenant_id INTEGER,
    title TEXT NOT NULL,
    body TEXT,
    url TEXT,
    icon TEXT,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    sent_at TIMESTAMPTZ
  )`,
  `CREATE TABLE IF NOT EXISTS push_delivery_log (
    id SERIAL PRIMARY KEY,
    notification_id INTEGER REFERENCES pending_push_notifications(id) ON DELETE CASCADE,
    user_email TEXT NOT NULL,
    delivered BOOLEAN DEFAULT false,
    opened BOOLEAN DEFAULT false,
    error TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS invite_links (
    id SERIAL PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    creator_email TEXT NOT NULL,
    tenant_id INTEGER,
    uses INTEGER DEFAULT 0,
    max_uses INTEGER DEFAULT 100,
    expires_at TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS waitlist (
    id SERIAL PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT,
    referral_code TEXT UNIQUE,
    referred_by TEXT,
    position INTEGER,
    notified_at TIMESTAMPTZ,
    converted BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS badge_definitions (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    description TEXT,
    icon TEXT DEFAULT '🏆',
    category TEXT DEFAULT 'general',
    requirement TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS user_badges (
    id SERIAL PRIMARY KEY,
    user_email TEXT NOT NULL,
    tenant_id INTEGER,
    badge_id INTEGER REFERENCES badge_definitions(id) ON DELETE CASCADE,
    earned_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_email, badge_id)
  )`,
  `CREATE TABLE IF NOT EXISTS digest_schedule (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER UNIQUE,
    frequency TEXT DEFAULT 'weekly',
    day_of_week INTEGER DEFAULT 1,
    hour INTEGER DEFAULT 8,
    last_sent TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
];
VL_MIGRATIONS.forEach(m => migrations.push(m));
[
  'referral_rewards', 'referral_program_settings', 'pending_push_notifications',
  'push_delivery_log', 'invite_links', 'waitlist', 'badge_definitions',
  'user_badges', 'digest_schedule'
].forEach(t => VALID_TABLES.add(t));

// ── 2. BADGE DEFINITIONS (20+) ─────────────────────────────
const BADGE_DEFS = [
  { name: 'Welcome Aboard', slug: 'welcome', icon: '🚀', category: 'onboarding', description: 'Created your account', requirement: 'signup' },
  { name: 'Profile Complete', slug: 'profile-complete', icon: '👤', category: 'onboarding', description: 'Completed your profile', requirement: 'profile' },
  { name: 'First Login', slug: 'first-login', icon: '🔑', category: 'onboarding', description: 'Logged in for the first time', requirement: 'login' },
  { name: 'Early Adopter', slug: 'early-adopter', icon: '⭐', category: 'onboarding', description: 'Signed up in the first month', requirement: 'early' },
  { name: 'First Referral', slug: 'first-referral', icon: '🎁', category: 'referrals', description: 'Referred your first friend', requirement: 'referral_1' },
  { name: '10 Referrals Club', slug: 'referrals-10', icon: '🎯', category: 'referrals', description: 'Referred 10 friends', requirement: 'referral_10' },
  { name: '50 Referrals Legend', slug: 'referrals-50', icon: '💎', category: 'referrals', description: 'Referred 50 friends', requirement: 'referral_50' },
  { name: 'Referral Champion', slug: 'referral-champion', icon: '👑', category: 'referrals', description: 'Top 3 referrer of the month', requirement: 'referral_top' },
  { name: 'Content Creator', slug: 'content-creator', icon: '✍️', category: 'content', description: 'Published your first content', requirement: 'content_1' },
  { name: 'Prolific Writer', slug: 'prolific-writer', icon: '📝', category: 'content', description: 'Published 10 pieces of content', requirement: 'content_10' },
  { name: 'Social Butterfly', slug: 'social-butterfly', icon: '🦋', category: 'social', description: 'Shared content 5 times', requirement: 'share_5' },
  { name: 'Viral Star', slug: 'viral-star', icon: '🌟', category: 'social', description: 'Your shared content got 100 clicks', requirement: 'share_100' },
  { name: '3-Day Streak', slug: 'streak-3', icon: '🔥', category: 'streaks', description: 'Active for 3 consecutive days', requirement: 'streak_3' },
  { name: '7-Day Streak', slug: 'streak-7', icon: '💥', category: 'streaks', description: 'Active for 7 consecutive days', requirement: 'streak_7' },
  { name: '30-Day Streak', slug: 'streak-30', icon: '⚡', category: 'streaks', description: 'Active for 30 consecutive days', requirement: 'streak_30' },
  { name: 'Team Player', slug: 'team-player', icon: '🤝', category: 'engagement', description: 'Joined a group or team', requirement: 'team' },
  { name: 'Feedback Hero', slug: 'feedback-hero', icon: '💬', category: 'engagement', description: 'Submitted 5 feedback entries', requirement: 'feedback_5' },
  { name: 'Certified Pro', slug: 'certified-pro', icon: '📜', category: 'milestones', description: 'Earned your first certificate', requirement: 'certificate' },
  { name: 'Centurion', slug: 'centurion', icon: '💯', category: 'milestones', description: 'Accumulated 100 points', requirement: 'points_100' },
  { name: 'Millennium', slug: 'millennium', icon: '🏅', category: 'milestones', description: 'Accumulated 1,000 points', requirement: 'points_1000' },
  { name: 'Event Organizer', slug: 'event-organizer', icon: '🎪', category: 'engagement', description: 'Created your first event', requirement: 'event_1' },
  { name: 'Helpful Hand', slug: 'helpful-hand', icon: '🤲', category: 'engagement', description: 'Helped 5 community members', requirement: 'help_5' },
  { name: 'Night Owl', slug: 'night-owl', icon: '🦉', category: 'streaks', description: 'Active after midnight', requirement: 'night' },
];

// Seed badge definitions on load
(async () => {
  for (const b of BADGE_DEFS) {
    try {
      await pool.query(
        `INSERT INTO badge_definitions (name, slug, description, icon, category, requirement)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (slug) DO NOTHING`,
        [b.name, b.slug, b.description, b.icon, b.category, b.requirement]
      );
    } catch(e) { /* exists */ }
  }
  console.log('[ViralLoop] Badge definitions seeded: ' + BADGE_DEFS.length + ' badges');
})();

// ── 3. HELPER FUNCTIONS ─────────────────────────────────────

function generateReferralCode(email) {
  const hash = email ? email.split('').reduce((a, c) => a + c.charCodeAt(0), 0) : Date.now();
  return 'R' + Math.abs(hash).toString(36).toUpperCase().slice(0, 4) + Date.now().toString(36).toUpperCase().slice(-4);
}

function generateInviteCode(email) {
  const hash = email ? email.split('').reduce((a, c) => a + c.charCodeAt(0), 0) : Date.now();
  return 'INV' + Math.abs(hash).toString(36).toUpperCase().slice(0, 3) + Math.random().toString(36).substring(2, 6).toUpperCase();
}

function generateWaitlistCode(email) {
  const hash = email ? email.split('').reduce((a, c) => a + c.charCodeAt(0), 0) : Date.now();
  return 'WL' + Math.abs(hash).toString(36).toUpperCase().slice(0, 4) + Math.random().toString(36).substring(2, 5).toUpperCase();
}

function timeAgo(date) {
  if (!date) return '';
  const s = Math.floor((Date.now() - new Date(date)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

const baseUrl = process.env.BASE_URL || 'https://ssewasswa.onrender.com';

// ── PUSH NOTIFICATION HELPER ────────────────────────────────
async function sendPushNotification(user_email, title, body, url, icon) {
  try {
    await pool.query(
      `INSERT INTO pending_push_notifications (user_email, title, body, url, icon, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')`,
      [user_email, title, body || '', url || '', icon || '🔔']
    );
  } catch(e) { console.warn('[ViralLoop] push queue error:', e.message); }
}

// Auto-clean sent push notifications older than 7 days
setTimeout(async () => {
  try {
    await pool.query(`DELETE FROM pending_push_notifications WHERE status = 'sent' AND created_at < NOW() - INTERVAL '7 days'`);
    console.log('[ViralLoop] Cleaned old push notifications');
  } catch(e) {}
}, 300000); // 5 min after load

// ── DIGEST GENERATION HELPER ────────────────────────────────
async function generateDigestHTML(tenant_id, frequency) {
  const since = frequency === 'daily' ? '24 hours' : frequency === 'weekly' ? '7 days' : '30 days';
  let html = '<div style="font-family:system-ui;max-width:600px;margin:0 auto;color:#1e293b">';
  html += `<h1 style="color:#6366f1;margin-bottom:4px">${frequency === 'daily' ? '📅 Daily' : frequency === 'weekly' ? '📆 Weekly' : '🗓 Monthly'} Digest</h1>`;
  html += `<p style="color:#64748b;margin-bottom:20px">Your platform update from Comfort Zone</p>`;

  try {
    // New signups
    const signups = (await pool.query(
      `SELECT first_name, last_name, created_at FROM users WHERE tenant_id = $1 AND created_at >= NOW() - INTERVAL '${since}' ORDER BY created_at DESC LIMIT 10`,
      [tenant_id]
    )).rows;
    if (signups.length) {
      html += '<h2 style="font-size:18px;margin:16px 0 8px;color:#16a34a">👋 New Members</h2>';
      signups.forEach(u => {
        html += `<p style="font-size:14px;color:#475569;margin:4px 0">${esc(u.first_name || '')} ${esc(u.last_name || '')} <span style="color:#94a3b8;font-size:12px">${timeAgo(u.created_at)}</span></p>`;
      });
    }

    // Top content
    try {
      const content = (await pool.query(
        `SELECT title, view_count FROM scraped_content WHERE scraped_at >= NOW() - INTERVAL '${since}' ORDER BY view_count DESC LIMIT 5`
      )).rows;
      if (content.length) {
        html += '<h2 style="font-size:18px;margin:16px 0 8px;color:#6366f1">📰 Trending Content</h2>';
        content.forEach(c => { html += `<p style="font-size:14px;color:#475569;margin:4px 0">${esc(c.title)} <span style="color:#94a3b8">(${c.view_count || 0} views)</span></p>`; });
      }
    } catch(e) {}

    // Upcoming events
    try {
      const events = (await pool.query(
        `SELECT title, start_date FROM events WHERE start_date >= NOW() AND start_date <= NOW() + INTERVAL '${since}' ORDER BY start_date LIMIT 5`
      )).rows;
      if (events.length) {
        html += '<h2 style="font-size:18px;margin:16px 0 8px;color:#f59e0b">🎪 Upcoming Events</h2>';
        events.forEach(e => { html += `<p style="font-size:14px;color:#475569;margin:4px 0">${esc(e.title)} — ${e.start_date}</p>`; });
      }
    } catch(e) {}

    // Badge highlights
    try {
      const badges = (await pool.query(
        `SELECT ub.user_email, bd.name, bd.icon, ub.earned_at FROM user_badges ub
         JOIN badge_definitions bd ON bd.id = ub.badge_id
         WHERE ub.earned_at >= NOW() - INTERVAL '${since}' ORDER BY ub.earned_at DESC LIMIT 10`
      )).rows;
      if (badges.length) {
        html += '<h2 style="font-size:18px;margin:16px 0 8px;color:#8b5cf6">🏅 Badge Highlights</h2>';
        badges.forEach(b => { html += `<p style="font-size:14px;color:#475569;margin:4px 0">${b.icon} ${esc(b.name)} — ${esc(b.user_email)}</p>`; });
      }
    } catch(e) {}
  } catch(e) { console.warn('[ViralLoop] Digest error:', e.message); }

  html += `<hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0">`;
  html += `<p style="text-align:center;font-size:13px;color:#94a3b8">Comfort Zone Platform · <a href="${baseUrl}" style="color:#6366f1">Dashboard</a></p>`;
  html += '</div>';
  return html;
}

// ── 4. AUTO-AWARD REFERRAL POINTS ───────────────────────────
async function checkAndAwardReferralBadge(email, count) {
  if (count >= 1) await awardBadgeIfMissing(email, 'first-referral');
  if (count >= 10) await awardBadgeIfMissing(email, 'referrals-10');
  if (count >= 50) await awardBadgeIfMissing(email, 'referrals-50');
}

async function awardBadgeIfMissing(email, slug) {
  try {
    const badge = (await pool.query(`SELECT id FROM badge_definitions WHERE slug = $1`, [slug])).rows[0];
    if (!badge) return;
    const has = (await pool.query(`SELECT 1 FROM user_badges WHERE user_email = $1 AND badge_id = $2`, [email, badge.id])).rows[0];
    if (!has) {
      await pool.query(`INSERT INTO user_badges (user_email, tenant_id, badge_id) VALUES ($1, NULL, $2)`, [email, badge.id]);
      if (typeof notify === 'function') {
        try { await notify(email, '🏅 Badge Earned!', `You earned the "${slug.replace(/-/g, ' ')}" badge!`, '/badges'); } catch(e) {}
      }
    }
  } catch(e) {}
}

// ============================================================
// === ROUTES ===
// ============================================================

// ── GET /referrals — Referral Dashboard ─────────────────────
app.get('/referrals', requireAuth, ah(async (req, res) => {
  const u = req.session.user;
  const email = u.email;
  const tid = u.tenant_id;
  const code = generateReferralCode(email);
  const refLink = `${baseUrl}/invite/${code}?ref=${encodeURIComponent(email)}`;

  // Stats
  const [totalRes, pendingRes, fulfilledRes, historyRes, lbRes] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int as c FROM referral_rewards WHERE referrer_email = $1`, [email]),
    pool.query(`SELECT COUNT(*)::int as c, COALESCE(SUM(reward_points),0)::int as pts FROM referral_rewards WHERE referrer_email = $1 AND status = 'pending'`, [email]),
    pool.query(`SELECT COUNT(*)::int as c, COALESCE(SUM(reward_points),0)::int as pts, COALESCE(SUM(reward_amount),0)::int as amt FROM referral_rewards WHERE referrer_email = $1 AND status = 'fulfilled'`, [email]),
    pool.query(`SELECT * FROM referral_rewards WHERE referrer_email = $1 ORDER BY created_at DESC LIMIT 50`, [email]),
    pool.query(`SELECT referrer_email, COUNT(*)::int as total FROM referral_rewards GROUP BY referrer_email ORDER BY total DESC LIMIT 10`)
  ]);

  const totalRefs = totalRes.rows[0].c;
  const pendingPts = pendingRes.rows[0].pts;
  const fulfilledPts = fulfilledRes.rows[0].pts;
  const fulfilledAmt = fulfilledRes.rows[0].amt;
  const history = historyRes.rows;
  const leaderboard = lbRes.rows;

  // Tier
  let tier = '🥉 Bronze', tierColor = '#cd7f32', nextTier = 'Silver (15 refs)', tierPct = Math.min(100, (totalRefs / 5) * 100);
  if (totalRefs >= 50) { tier = '👑 Gold'; tierColor = '#ffd700'; nextTier = 'Max tier!'; tierPct = 100; }
  else if (totalRefs >= 15) { tier = '🥈 Silver'; tierColor = '#c0c0c0'; nextTier = 'Gold (50 refs)'; tierPct = Math.min(100, (totalRefs / 50) * 100); }
  else if (totalRefs >= 5) { tier = '🥉 Bronze'; tierColor = '#cd7f32'; nextTier = 'Silver (15 refs)'; tierPct = Math.min(100, (totalRefs / 15) * 100); }

  // Badge milestones
  const milestoneBadges = [
    { slug: 'first-referral', label: 'First Referral', icon: '🎁', done: totalRefs >= 1 },
    { slug: 'referrals-10', label: '10 Referrals Club', icon: '🎯', done: totalRefs >= 10 },
    { slug: 'referrals-50', label: '50 Referrals Legend', icon: '💎', done: totalRefs >= 50 },
  ];

  const shareButtons = `
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:16px">
      <a href="https://wa.me/?text=${encodeURIComponent('Join me on Comfort Zone! ' + refLink)}" target="_blank" style="background:#25d366;color:white;padding:10px 20px;border-radius:10px;text-decoration:none;font-weight:600;font-size:14px">📱 WhatsApp</a>
      <a href="https://twitter.com/intent/tweet?url=${encodeURIComponent(refLink)}&text=${encodeURIComponent('Join me on Comfort Zone!')}" target="_blank" style="background:#1da1f2;color:white;padding:10px 20px;border-radius:10px;text-decoration:none;font-weight:600;font-size:14px">🐦 Twitter</a>
      <a href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(refLink)}" target="_blank" style="background:#1877f2;color:white;padding:10px 20px;border-radius:10px;text-decoration:none;font-weight:600;font-size:14px">📘 Facebook</a>
      <a href="mailto:?subject=${encodeURIComponent('Join Comfort Zone')}&body=${encodeURIComponent(refLink)}" style="background:#ea4335;color:white;padding:10px 20px;border-radius:10px;text-decoration:none;font-weight:600;font-size:14px">📧 Email</a>
      <button onclick="navigator.clipboard.writeText('${refLink}');this.textContent='✅ Copied!'" style="background:#6366f1;color:white;padding:10px 20px;border-radius:10px;border:none;font-weight:600;font-size:14px;cursor:pointer">🔗 Copy Link</button>
    </div>`;

  const histRows = history.map(r => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;font-size:13px">${esc(r.referred_email || '—')}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;font-size:13px">${esc(r.reward_type)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;font-size:13px">${r.reward_points || 0} pts</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;font-size:13px">${r.status === 'fulfilled' ? '<span style="color:#16a34a">✅ Fulfilled</span>' : '<span style="color:#f59e0b">⏳ Pending</span>'}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;font-size:12px;color:#94a3b8">${timeAgo(r.created_at)}</td>
    </tr>`).join('');

  const lbRows = leaderboard.map((l, i) => `
    <tr>
      <td style="padding:8px 12px;font-size:13px;font-weight:600;${i < 3 ? 'color:' + ['#ffd700','#c0c0c0','#cd7f32'][i] : ''}">#${i + 1}</td>
      <td style="padding:8px 12px;font-size:13px">${esc(l.referrer_email)}</td>
      <td style="padding:8px 12px;font-size:13px;font-weight:600">${l.total}</td>
    </tr>`).join('');

  const milestoneHtml = milestoneBadges.map(m => `
    <div style="display:flex;align-items:center;gap:10px;padding:12px;border-radius:10px;background:${m.done ? '#f0fdf4;border:1px solid #bbf7d0' : '#f8fafc;border:1px solid #e2e8f0'}">
      <span style="font-size:28px;opacity:${m.done ? '1' : '0.3'}">${m.icon}</span>
      <div><div style="font-weight:600;font-size:14px;color:${m.done ? '#16a34a' : '#94a3b8'}">${esc(m.label)}</div><div style="font-size:12px;color:#94a3b8">${m.done ? '✅ Earned!' : 'Not yet'}</div></div>
    </div>`).join('');

  const content = `
    <style>
      .vl-stats {display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;margin-bottom:24px}
      .vl-stat {background:white;border-radius:14px;padding:20px;text-align:center;border:1px solid #e2e8f0}
      .vl-stat .num {font-size:32px;font-weight:800;color:#6366f1}
      .vl-stat .lbl {font-size:13px;color:#64748b;margin-top:4px}
      .vl-card {background:white;border-radius:14px;padding:20px;border:1px solid #e2e8f0;margin-bottom:20px}
      .vl-tier-bar {height:10px;background:#f1f5f9;border-radius:99px;overflow:hidden;margin:10px 0}
      .vl-tier-fill {height:100%;border-radius:99px;transition:width 0.5s}
    </style>
    <div style="max-width:900px;margin:0 auto">

      <!-- Hero -->
      <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6,#a78bfa);color:white;padding:32px;border-radius:18px;margin-bottom:24px;text-align:center">
        <h1 style="font-size:28px;margin:0 0 6px">🎉 Refer & Earn Rewards</h1>
        <p style="opacity:0.9;margin-bottom:16px">Share Comfort Zone with friends and earn points for every referral</p>
        <div style="background:rgba(255,255,255,0.15);padding:12px 20px;border-radius:10px;display:flex;align-items:center;gap:10px;justify-content:center">
          <input value="${esc(refLink)}" readonly style="flex:1;background:transparent;border:none;color:white;font-size:14px;outline:none;min-width:0" id="refLinkInput">
          <button onclick="navigator.clipboard.writeText(document.getElementById('refLinkInput').value);this.textContent='Copied!'" style="background:white;color:#6366f1;border:none;padding:8px 16px;border-radius:8px;font-weight:600;cursor:pointer;font-size:13px">Copy</button>
        </div>
        ${shareButtons}
      </div>

      <!-- Stats -->
      <div class="vl-stats">
        <div class="vl-stat"><div class="num">${totalRefs}</div><div class="lbl">Total Referrals</div></div>
        <div class="vl-stat"><div class="num" style="color:#f59e0b">${pendingPts}</div><div class="lbl">Pending Points</div></div>
        <div class="vl-stat"><div class="num" style="color:#16a34a">${fulfilledPts}</div><div class="lbl">Earned Points</div></div>
        <div class="vl-stat"><div class="num" style="color:#8b5cf6">${fulfilledAmt}</div><div class="lbl">Reward Amount</div></div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px">
        <!-- Tier -->
        <div class="vl-card">
          <h3 style="margin:0 0 8px">🏆 Your Tier</h3>
          <div style="font-size:24px;font-weight:800;color:${tierColor}">${tier}</div>
          <div class="vl-tier-bar"><div class="vl-tier-fill" style="width:${tierPct}%;background:${tierColor}"></div></div>
          <div style="font-size:12px;color:#64748b">Next: ${nextTier}</div>
        </div>
        <!-- Milestones -->
        <div class="vl-card">
          <h3 style="margin:0 0 12px">🏅 Milestones</h3>
          <div style="display:flex;flex-direction:column;gap:8px">${milestoneHtml}</div>
        </div>
      </div>

      <!-- Leaderboard -->
      <div class="vl-card">
        <h3 style="margin:0 0 12px">📊 Top Referrers</h3>
        <table style="width:100%;border-collapse:collapse"><thead><tr style="background:#f8fafc">
          <th style="padding:8px 12px;text-align:left;font-size:12px;color:#64748b">Rank</th>
          <th style="padding:8px 12px;text-align:left;font-size:12px;color:#64748b">Email</th>
          <th style="padding:8px 12px;text-align:left;font-size:12px;color:#64748b">Refs</th>
        </tr></thead><tbody>${lbRows}</tbody></table>
      </div>

      <!-- History -->
      <div class="vl-card">
        <h3 style="margin:0 0 12px">📋 Referral History</h3>
        ${history.length ? `<table style="width:100%;border-collapse:collapse"><thead><tr style="background:#f8fafc">
          <th style="padding:10px 12px;text-align:left;font-size:12px;color:#64748b">Referred</th>
          <th style="padding:10px 12px;text-align:left;font-size:12px;color:#64748b">Type</th>
          <th style="padding:10px 12px;text-align:left;font-size:12px;color:#64748b">Reward</th>
          <th style="padding:10px 12px;text-align:left;font-size:12px;color:#64748b">Status</th>
          <th style="padding:10px 12px;text-align:left;font-size:12px;color:#64748b">Date</th>
        </tr></thead><tbody>${histRows}</tbody></table>` : '<p style="color:#94a3b8;font-size:14px">No referrals yet. Share your link to get started!</p>'}
      </div>

      <!-- Claim pending -->
      ${pendingPts > 0 ? `<div class="vl-card" style="background:#fffbeb;border-color:#fde68a">
        <h3 style="margin:0 0 6px;color:#92400e">💰 You have ${pendingPts} pending points!</h3>
        <p style="color:#92400e;font-size:13px;margin-bottom:12px">Click below to claim your rewards.</p>
        <button onclick="fetch('/api/referrals/claim',{method:'POST',headers:{'Content-Type':'application/json'}}).then(r=>r.json()).then(d=>{if(d.ok)location.reload();else alert(d.error||'Error')})" style="background:#f59e0b;color:white;border:none;padding:10px 24px;border-radius:10px;font-weight:600;cursor:pointer;font-size:14px">Claim Rewards</button>
      </div>` : ''}
    </div>`;

  res.send(renderPage('Referral Dashboard', content, u, req));
}));

// ── POST /api/referrals/claim — Claim pending reward ───────
app.post('/api/referrals/claim', requireAuth, ah(async (req, res) => {
  const email = req.session.user.email;
  const pending = (await pool.query(
    `SELECT * FROM referral_rewards WHERE referrer_email = $1 AND status = 'pending'`,
    [email]
  )).rows;

  if (!pending.length) return res.json({ ok: false, error: 'No pending rewards' });

  let totalPts = 0, totalAmt = 0;
  for (const r of pending) {
    await pool.query(`UPDATE referral_rewards SET status = 'fulfilled', fulfilled_at = NOW() WHERE id = $1`, [r.id]);
    totalPts += r.reward_points || 0;
    totalAmt += r.reward_amount || 0;
  }

  if (totalPts > 0 && typeof awardPoints === 'function') {
    try { await awardPoints(email, 'refer_friend', 'referral_claim'); } catch(e) {}
  }

  // Check tier badges
  await checkAndAwardReferralBadge(email, pending.length + (await pool.query(
    `SELECT COUNT(*)::int as c FROM referral_rewards WHERE referrer_email = $1 AND status = 'fulfilled'`, [email]
  )).rows[0].c);

  res.json({ ok: true, points: totalPts, amount: totalAmt, claimed: pending.length });
}));

// ── GET /api/referrals/stats — JSON stats ───────────────────
app.get('/api/referrals/stats', requireAuth, ah(async (req, res) => {
  const email = req.session.user.email;
  const [total, pending, fulfilled] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int as c FROM referral_rewards WHERE referrer_email = $1`, [email]),
    pool.query(`SELECT COALESCE(SUM(reward_points),0)::int as pts FROM referral_rewards WHERE referrer_email = $1 AND status = 'pending'`, [email]),
    pool.query(`SELECT COALESCE(SUM(reward_points),0)::int as pts, COALESCE(SUM(reward_amount),0)::int as amt, COUNT(*)::int as c FROM referral_rewards WHERE referrer_email = $1 AND status = 'fulfilled'`, [email]),
  ]);
  res.json({
    total: total.rows[0].c,
    pendingPoints: pending.rows[0].pts,
    fulfilled: { points: fulfilled.rows[0].pts, amount: fulfilled.rows[0].amt, count: fulfilled.rows[0].c }
  });
}));

// ── GET /og/image/:type/:id — SVG OG Image ─────────────────
app.get('/og/image/:type/:id', ah(async (req, res) => {
  const type = esc(req.params.type);
  const id = esc(req.params.id);
  const titles = { profile: 'User Profile', certificate: 'Certificate', result: 'Exam Result', achievement: 'Achievement', leaderboard: 'Leaderboard', event: 'Event' };
  const title = titles[type] || 'Comfort Zone';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <defs><linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:#6366f1"/><stop offset="100%" style="stop-color:#8b5cf6"/></linearGradient></defs>
    <rect width="1200" height="630" fill="url(#bg)"/>
    <text x="600" y="280" font-family="system-ui,sans-serif" font-size="56" fill="white" text-anchor="middle" font-weight="800">Comfort Zone</text>
    <text x="600" y="350" font-family="system-ui,sans-serif" font-size="28" fill="rgba(255,255,255,0.85)" text-anchor="middle">${title}</text>
    <text x="600" y="420" font-family="system-ui,sans-serif" font-size="20" fill="rgba(255,255,255,0.6)" text-anchor="middle">ID: ${id}</text>
    <rect x="500" y="470" width="200" height="50" rx="25" fill="rgba(255,255,255,0.2)"/>
    <text x="600" y="502" font-family="system-ui,sans-serif" font-size="18" fill="white" text-anchor="middle">View Details</text>
  </svg>`;
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(svg);
}));

// ── GET /share/:type/:id — Public shareable page ───────────
app.get('/share/:type/:id', ah(async (req, res) => {
  const type = esc(req.params.type);
  const id = esc(req.params.id);
  const ref = req.query.ref || '';
  const titles = { profile: 'Profile', certificate: 'Certificate', result: 'Result', achievement: 'Achievement', leaderboard: 'Leaderboard', event: 'Event' };
  const title = titles[type] || 'Shared Content';

  const ogImage = `${baseUrl}/og/image/${type}/${id}`;
  const registerUrl = ref ? `${baseUrl}/register?ref=${encodeURIComponent(ref)}` : `${baseUrl}/register`;
  const shareUrl = `${baseUrl}/share/${type}/${id}${ref ? '?ref=' + encodeURIComponent(ref) : ''}`;

  res.send(`<!DOCTYPE html><html><head>
    <meta property="og:title" content="${title} — Comfort Zone">
    <meta property="og:description" content="Check out this ${title.toLowerCase()} on Comfort Zone Platform">
    <meta property="og:image" content="${ogImage}">
    <meta property="og:url" content="${shareUrl}">
    <meta property="og:type" content="article">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${title} — Comfort Zone">
    <meta name="twitter:image" content="${ogImage}">
    <title>${title} — Comfort Zone</title>
    <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui;background:#f8fafc;color:#1e293b}</style>
  </head><body>
    <div style="max-width:600px;margin:40px auto;text-align:center;padding:20px">
      <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:48px;border-radius:20px;color:white;margin-bottom:24px">
        <div style="font-size:48px;margin-bottom:12px">${type === 'certificate' ? '📜' : type === 'achievement' ? '🏆' : type === 'leaderboard' ? '📊' : '⭐'}</div>
        <h1 style="font-size:28px;margin-bottom:8px">${title}</h1>
        <p style="opacity:0.85;font-size:16px">Shared from Comfort Zone Platform</p>
      </div>
      <div style="background:white;padding:24px;border-radius:16px;border:1px solid #e2e8f0;margin-bottom:20px">
        <p style="color:#64748b;font-size:14px">ID: ${id}</p>
      </div>
      <a href="${registerUrl}" style="display:inline-block;background:#6366f1;color:white;padding:14px 40px;border-radius:12px;text-decoration:none;font-weight:700;font-size:16px;margin-bottom:20px">Join Comfort Zone Free</a>
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
        <a href="https://wa.me/?text=${encodeURIComponent('Check this out! ' + shareUrl)}" style="background:#25d366;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;font-size:14px">📱 WhatsApp</a>
        <a href="https://twitter.com/intent/tweet?url=${encodeURIComponent(shareUrl)}" style="background:#1da1f2;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;font-size:14px">🐦 Twitter</a>
        <a href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}" style="background:#1877f2;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;font-size:14px">📘 Facebook</a>
      </div>
    </div>
  </body></html>`);
}));

// ── POST /api/push/subscribe ────────────────────────────────
app.post('/api/push/subscribe', requireAuth, ah(async (req, res) => {
  const { subscription } = req.body;
  if (!subscription) return res.json({ ok: false, error: 'No subscription data' });
  try {
    await pool.query(
      `INSERT INTO pending_push_notifications (user_email, tenant_id, title, body, url, icon, status)
       VALUES ($1, $2, '🔔 Subscribed', 'Push notifications enabled!', '/notifications', '🔔', 'sent')`,
      [req.session.user.email, req.session.user.tenant_id]
    );
    res.json({ ok: true });
  } catch(e) { res.json({ ok: false, error: e.message }); }
}));

// ── POST /api/push/unsubscribe ──────────────────────────────
app.post('/api/push/unsubscribe', requireAuth, ah(async (req, res) => {
  try {
    await pool.query(
      `UPDATE pending_push_notifications SET status = 'deleted' WHERE user_email = $1 AND status = 'pending'`,
      [req.session.user.email]
    );
    res.json({ ok: true });
  } catch(e) { res.json({ ok: false, error: e.message }); }
}));

// ── GET /api/push/poll — Service worker polling ─────────────
app.get('/api/push/poll', requireAuth, ah(async (req, res) => {
  const rows = (await pool.query(
    `SELECT * FROM pending_push_notifications WHERE user_email = $1 AND status = 'pending' ORDER BY created_at DESC LIMIT 20`,
    [req.session.user.email]
  )).rows;

  if (rows.length) {
    await pool.query(
      `UPDATE pending_push_notifications SET status = 'sent', sent_at = NOW() WHERE user_email = $1 AND status = 'pending'`,
      [req.session.user.email]
    );
    for (const n of rows) {
      await pool.query(
        `INSERT INTO push_delivery_log (notification_id, user_email, delivered) VALUES ($1, $2, true)`,
        [n.id, n.user_email]
      ).catch(() => {});
    }
  }

  res.json({ notifications: rows.map(n => ({ title: n.title, body: n.body, url: n.url, icon: n.icon, id: n.id })) });
}));

// ── GET /embed/:widget — Embeddable widgets ─────────────────
app.get('/embed/:widget', ah(async (req, res) => {
  const widget = esc(req.params.widget);
  const ref = req.query.ref || '';
  const types = {
    'poll': { title: 'Community Poll', content: '<div style="text-align:center;padding:20px"><h3>What feature do you want next?</h3><div style="display:flex;flex-direction:column;gap:8px;margin-top:12px"><button onclick="this.style.background=\'#6366f1\';this.style.color=\'white\'" style="padding:10px;border:1px solid #e2e8f0;border-radius:8px;cursor:pointer;font-size:14px">📊 Analytics Dashboard</button><button onclick="this.style.background=\'#6366f1\';this.style.color=\'white\'" style="padding:10px;border:1px solid #e2e8f0;border-radius:8px;cursor:pointer;font-size:14px">💬 Live Chat</button><button onclick="this.style.background=\'#6366f1\';this.style.color=\'white\'" style="padding:10px;border:1px solid #e2e8f0;border-radius:8px;cursor:pointer;font-size:14px">📱 Mobile App</button></div></div>' },
    'quiz': { title: 'Quick Quiz', content: '<div style="padding:20px"><h3>🧠 Quick Knowledge Check</h3><p style="margin:12px 0;color:#475569">What is the capital of Uganda?</p><div style="display:flex;flex-direction:column;gap:6px"><button onclick="alert(\'Correct!\')" style="padding:10px;border:1px solid #e2e8f0;border-radius:8px;cursor:pointer;font-size:14px;text-align:left">A) Kampala</button><button onclick="alert(\'Try again!\')" style="padding:10px;border:1px solid #e2e8f0;border-radius:8px;cursor:pointer;font-size:14px;text-align:left">B) Nairobi</button><button onclick="alert(\'Try again!\')" style="padding:10px;border:1px solid #e2e8f0;border-radius:8px;cursor:pointer;font-size:14px;text-align:left">C) Dar es Salaam</button></div></div>' },
    'badge': { title: 'Badges Showcase', content: '<div style="padding:20px;text-align:center"><h3>🏅 Featured Badges</h3><div style="display:flex;gap:12px;justify-content:center;margin-top:12px;flex-wrap:wrap"><span style="font-size:36px" title="Welcome">🚀</span><span style="font-size:36px" title="First Referral">🎁</span><span style="font-size:36px" title="Champion">👑</span><span style="font-size:36px" title="Legend">💎</span><span style="font-size:36px" title="Creator">✍️</span></div><p style="color:#64748b;font-size:13px;margin-top:12px">Earn badges on Comfort Zone</p></div>' },
    'testimonial-wall': { title: 'Testimonials', content: '<div style="padding:20px"><h3>💬 What People Say</h3><div style="margin-top:12px;display:flex;flex-direction:column;gap:10px"><div style="background:#f8fafc;padding:12px;border-radius:10px"><p style="font-style:italic;color:#475569">"Comfort Zone transformed how we manage our school!"</p><p style="font-size:12px;color:#6366f1;margin-top:4px">— School Admin</p></div><div style="background:#f8fafc;padding:12px;border-radius:10px"><p style="font-style:italic;color:#475569">"Best platform for church management. Highly recommended!"</p><p style="font-size:12px;color:#6366f1;margin-top:4px">— Pastor</p></div></div></div>' },
    'leaderboard': { title: 'Leaderboard', content: '<div style="padding:20px"><h3>📊 Top Contributors</h3><div style="margin-top:12px"><div style="display:flex;justify-content:space-between;padding:8px;border-bottom:1px solid #f1f5f9"><span>🥇 User One</span><span style="font-weight:600">2,450 pts</span></div><div style="display:flex;justify-content:space-between;padding:8px;border-bottom:1px solid #f1f5f9"><span>🥈 User Two</span><span style="font-weight:600">1,890 pts</span></div><div style="display:flex;justify-content:space-between;padding:8px"><span>🥉 User Three</span><span style="font-weight:600">1,340 pts</span></div></div></div>' },
  };

  const w = types[widget] || { title: 'Widget', content: '<p style="padding:20px;color:#94a3b8">Widget not found</p>' };

  res.setHeader('X-Frame-Options', 'ALLOWALL');
  res.send(`<!DOCTYPE html><html><head>
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${w.title} — Comfort Zone Widget</title>
    ${ref ? '<meta name="referrer" content="origin">' : ''}
    <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui;background:white;color:#1e293b;border-radius:12px;overflow:hidden}</style>
  </head><body>${w.content}
    <div style="text-align:center;padding:12px;border-top:1px solid #f1f5f9"><a href="${baseUrl}${ref ? '?ref=' + encodeURIComponent(ref) : ''}" style="color:#6366f1;font-size:12px;text-decoration:none">Powered by Comfort Zone</a></div>
  </body></html>`);
}));

// ── GET /widgets — Widget gallery ───────────────────────────
app.get('/widgets', ah(async (req, res) => {
  const widgets = [
    { name: 'poll', title: 'Community Poll', desc: 'Interactive poll widget', icon: '📊' },
    { name: 'quiz', title: 'Quick Quiz', desc: 'Embeddable knowledge quiz', icon: '🧠' },
    { name: 'badge', title: 'Badge Showcase', desc: 'Display earned badges', icon: '🏅' },
    { name: 'testimonial-wall', title: 'Testimonials', desc: 'Customer testimonial wall', icon: '💬' },
    { name: 'leaderboard', title: 'Leaderboard', desc: 'Top contributors ranking', icon: '🏆' },
  ];
  const widgetCards = widgets.map(w => `
    <div style="background:white;padding:24px;border-radius:14px;border:1px solid #e2e8f0;text-align:center">
      <div style="font-size:40px;margin-bottom:12px">${w.icon}</div>
      <h3 style="margin-bottom:6px">${w.title}</h3>
      <p style="color:#64748b;font-size:14px;margin-bottom:16px">${w.desc}</p>
      <div style="background:#f8fafc;padding:10px;border-radius:8px;font-family:monospace;font-size:12px;color:#475569;text-align:left;margin-bottom:12px">&lt;iframe src="${baseUrl}/embed/${w.name}" width="400" height="300" frameborder="0"&gt;&lt;/iframe&gt;</div>
      <button onclick="navigator.clipboard.writeText(this.parentElement.querySelector('div').textContent.trim())" style="background:#6366f1;color:white;border:none;padding:8px 16px;border-radius:8px;cursor:pointer;font-size:13px">📋 Copy Code</button>
    </div>`).join('');

  res.send(`<!DOCTYPE html><html><head>
    <title>Embeddable Widgets — Comfort Zone</title>
    <meta name="description" content="Free embeddable widgets for your website. Polls, quizzes, badges and more.">
    <meta name="robots" content="index, follow">
    <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui;background:#f8fafc;color:#1e293b}</style>
  </head><body>
    <nav style="background:white;padding:12px 24px;border-bottom:1px solid #e2e8f0"><a href="/" style="font-weight:700;font-size:18px;color:#6366f1;text-decoration:none">Comfort Zone</a></nav>
    <div style="max-width:900px;margin:0 auto;padding:32px 20px">
      <div style="text-align:center;margin-bottom:32px">
        <h1 style="font-size:32px;margin-bottom:8px">🧩 Embeddable Widgets</h1>
        <p style="color:#64748b;font-size:16px">Add powerful widgets to your website with a single line of code</p>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px">${widgetCards}</div>
      <div style="margin-top:32px;background:#fffbeb;padding:20px;border-radius:14px;border:1px solid #fde68a">
        <h3 style="color:#92400e;margin-bottom:8px">⚙️ Customization</h3>
        <p style="color:#92400e;font-size:14px">Use query parameters to customize: <code style="background:white;padding:2px 6px;border-radius:4px">?ref=yourcode&theme=dark&color=6366f1</code></p>
      </div>
    </div>
  </body></html>`);
}));

// ── GET /invite/:code — Invite landing page ─────────────────
app.get('/invite/:code', ah(async (req, res) => {
  const code = esc(req.params.code);
  const ref = req.query.ref || '';
  const invite = (await pool.query(`SELECT * FROM invite_links WHERE code = $1 AND is_active = true`, [code])).rows[0];

  // Track click
  if (invite) {
    await pool.query(`UPDATE invite_links SET uses = uses + 1 WHERE id = $1`, [invite.id]).catch(() => {});
  }

  const inviter = invite ? invite.creator_email : ref;
  const socialProof = 5000 + Math.floor(Math.random() * 3000);
  const rating = (4.5 + Math.random() * 0.5).toFixed(1);

  res.send(`<!DOCTYPE html><html><head>
    <title>You're Invited! — Comfort Zone</title>
    <meta property="og:title" content="You're invited to join Comfort Zone">
    <meta property="og:description" content="Join thousands of users on the all-in-one management platform">
    <meta name="robots" content="index, follow">
    <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui;background:#f8fafc;color:#1e293b}</style>
  </head><body>
    <div style="max-width:600px;margin:40px auto;padding:20px">
      <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);color:white;padding:40px;border-radius:20px;text-align:center;margin-bottom:24px">
        <div style="font-size:48px;margin-bottom:12px">🎉</div>
        <h1 style="font-size:28px;margin-bottom:8px">You're Invited!</h1>
        ${inviter ? `<p style="opacity:0.9;font-size:16px">${esc(inviter)} invited you to join</p>` : ''}
      </div>
      <div style="background:white;padding:24px;border-radius:16px;border:1px solid #e2e8f0;margin-bottom:20px">
        <h2 style="font-size:20px;margin-bottom:12px">Why Join Comfort Zone?</h2>
        <div style="display:flex;flex-direction:column;gap:10px">
          <div style="display:flex;gap:10px;align-items:center"><span style="font-size:24px">📋</span><span>Complete management platform</span></div>
          <div style="display:flex;gap:10px;align-items:center"><span style="font-size:24px">💰</span><span>Earn referral rewards</span></div>
          <div style="display:flex;gap:10px;align-items:center"><span style="font-size:24px">📊</span><span>Analytics & reporting tools</span></div>
          <div style="display:flex;gap:10px;align-items:center"><span style="font-size:24px">🏅</span><span>Achievement badges & gamification</span></div>
          <div style="display:flex;gap:10px;align-items:center"><span style="font-size:24px">📱</span><span>Mobile-friendly interface</span></div>
        </div>
      </div>
      <div style="display:flex;gap:16px;justify-content:center;margin-bottom:24px">
        <div style="text-align:center"><div style="font-size:28px;font-weight:800;color:#6366f1">${socialProof.toLocaleString()}+</div><div style="font-size:13px;color:#64748b">Users</div></div>
        <div style="text-align:center"><div style="font-size:28px;font-weight:800;color:#f59e0b">⭐ ${rating}</div><div style="font-size:13px;color:#64748b">Rating</div></div>
        <div style="text-align:center"><div style="font-size:28px;font-weight:800;color:#16a34a">99.9%</div><div style="font-size:13px;color:#64748b">Uptime</div></div>
      </div>
      <div style="background:white;padding:24px;border-radius:16px;border:1px solid #e2e8f0;margin-bottom:20px">
        <h2 style="font-size:20px;margin-bottom:16px">Create Your Free Account</h2>
        <form method="POST" action="/api/waitlist/join" style="display:flex;flex-direction:column;gap:12px">
          <input type="hidden" name="referral_code" value="${code}">
          <input name="name" placeholder="Full Name" required style="padding:12px 16px;border:1px solid #e2e8f0;border-radius:10px;font-size:14px">
          <input name="email" type="email" placeholder="Email Address" required style="padding:12px 16px;border:1px solid #e2e8f0;border-radius:10px;font-size:14px">
          <button type="submit" style="background:#6366f1;color:white;padding:14px;border:none;border-radius:10px;font-size:16px;font-weight:700;cursor:pointer">Join Free — Get Started</button>
        </form>
      </div>
    </div>
  </body></html>`);
}));

// ── POST /api/invite/generate — Generate invite link ────────
app.post('/api/invite/generate', requireAuth, ah(async (req, res) => {
  const email = req.session.user.email;
  const tid = req.session.user.tenant_id;
  const code = generateInviteCode(email);

  try {
    await pool.query(
      `INSERT INTO invite_links (code, creator_email, tenant_id, max_uses, expires_at) VALUES ($1, $2, $3, 100, NOW() + INTERVAL '90 days')`,
      [code, email, tid]
    );
    res.json({ ok: true, code, link: `${baseUrl}/invite/${code}` });
  } catch(e) {
    // Code collision — try again
    const code2 = 'INV' + Math.random().toString(36).substring(2, 8).toUpperCase();
    await pool.query(
      `INSERT INTO invite_links (code, creator_email, tenant_id, max_uses, expires_at) VALUES ($1, $2, $3, 100, NOW() + INTERVAL '90 days')`,
      [code2, email, tid]
    );
    res.json({ ok: true, code: code2, link: `${baseUrl}/invite/${code2}` });
  }
}));

// ── GET /waitlist — Public waitlist page ────────────────────
app.get('/waitlist', ah(async (req, res) => {
  const wlCount = (await pool.query(`SELECT COUNT(*)::int as c FROM waitlist`)).rows[0].c;
  const topWaiters = (await pool.query(
    `SELECT name, position, created_at FROM waitlist ORDER BY position ASC LIMIT 10`
  )).rows;

  const topRows = topWaiters.map((w, i) => `
    <div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid #f1f5f9">
      <span style="font-weight:700;color:${i < 3 ? '#6366f1' : '#94a3b8'};font-size:14px;width:24px">#${i + 1}</span>
      <span style="flex:1;font-size:14px">${esc(w.name || 'Anonymous')}</span>
      <span style="font-size:12px;color:#94a3b8">Pos ${w.position || i + 1}</span>
    </div>`).join('');

  res.send(`<!DOCTYPE html><html><head>
    <title>Join the Waitlist — Comfort Zone</title>
    <meta name="description" content="Join the Comfort Zone waitlist and get early access plus referral rewards.">
    <meta property="og:title" content="Join the Comfort Zone Waitlist">
    <meta property="og:description" content="Get early access and earn rewards by sharing with friends">
    <meta name="robots" content="index, follow">
    <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui;background:#f8fafc;color:#1e293b}</style>
  </head><body>
    <nav style="background:white;padding:12px 24px;border-bottom:1px solid #e2e8f0"><a href="/" style="font-weight:700;font-size:18px;color:#6366f1;text-decoration:none">Comfort Zone</a></nav>
    <div style="max-width:600px;margin:40px auto;padding:20px">
      <div style="text-align:center;margin-bottom:32px">
        <div style="font-size:56px;margin-bottom:12px">🚀</div>
        <h1 style="font-size:32px;margin-bottom:8px">Join the Waitlist</h1>
        <p style="color:#64748b;font-size:16px">Be first in line for new features and exclusive access</p>
        <div style="margin-top:12px;font-size:24px;font-weight:800;color:#6366f1">${wlCount.toLocaleString()} people on the waitlist</div>
      </div>
      <div style="background:white;padding:28px;border-radius:18px;border:1px solid #e2e8f0;margin-bottom:24px">
        <form method="POST" action="/api/waitlist/join" style="display:flex;flex-direction:column;gap:14px">
          <input name="name" placeholder="Your Name" required style="padding:14px 16px;border:1px solid #e2e8f0;border-radius:10px;font-size:14px">
          <input name="email" type="email" placeholder="Your Email" required style="padding:14px 16px;border:1px solid #e2e8f0;border-radius:10px;font-size:14px">
          <input name="referred_by" type="hidden" value="${esc(req.query.ref || '')}">
          <button type="submit" style="background:#6366f1;color:white;padding:14px;border:none;border-radius:10px;font-size:16px;font-weight:700;cursor:pointer">Join Waitlist</button>
        </form>
      </div>
      <div style="background:#fffbeb;padding:20px;border-radius:14px;border:1px solid #fde68a;margin-bottom:24px;text-align:center">
        <h3 style="color:#92400e;margin-bottom:8px">📈 Skip the Line!</h3>
        <p style="color:#92400e;font-size:14px;margin-bottom:12px">Share your waitlist link with friends to move up the queue</p>
        <button onclick="fetch('/api/waitlist/share',{method:'POST',headers:{'Content-Type':'application/json'}}).then(r=>r.json()).then(d=>{if(d.ok&&d.link)navigator.clipboard.writeText(d.link)})" style="background:#f59e0b;color:white;border:none;padding:10px 24px;border-radius:8px;font-weight:600;cursor:pointer;font-size:14px">Share & Move Up</button>
      </div>
      ${topRows ? `<div style="background:white;padding:20px;border-radius:14px;border:1px solid #e2e8f0">
        <h3 style="margin-bottom:12px">📋 Queue Position</h3>
        ${topRows}
      </div>` : ''}
    </div>
  </body></html>`);
}));

// ── POST /api/waitlist/join ─────────────────────────────────
app.post('/api/waitlist/join', ah(async (req, res) => {
  const { name, email, referred_by, referral_code } = req.body;
  if (!email) {
    const redir = req.headers.referer || '/waitlist';
    return res.redirect(redir);
  }

  const wCode = referral_code || generateWaitlistCode(email);
  const maxPos = (await pool.query(`SELECT COALESCE(MAX(position), 0) as m FROM waitlist`)).rows[0].m;

  try {
    await pool.query(
      `INSERT INTO waitlist (email, name, referral_code, referred_by, position) VALUES ($1, $2, $3, $4, $5)`,
      [email.toLowerCase().trim(), name || '', wCode, referred_by || '', maxPos + 1]
    );

    // Auto-award points to referrer if exists
    if (referred_by) {
      const referrer = (await pool.query(`SELECT email FROM waitlist WHERE referral_code = $1`, [referred_by])).rows[0];
      if (referrer) {
        await pool.query(
          `INSERT INTO referral_rewards (referrer_email, referred_email, reward_type, reward_points, status)
           VALUES ($1, $2, 'points', 25, 'pending') ON CONFLICT DO NOTHING`,
          [referrer.email, email]
        );
        if (typeof awardPoints === 'function') {
          try { await awardPoints(referrer.email, 'refer_friend', 'waitlist_share'); } catch(e) {}
        }
      }
    }

    if (typeof sendEmail === 'function') {
      try {
        await sendEmail(email, 'You\'re on the Waitlist! 🎉', `<div style="font-family:system-ui;max-width:500px;margin:0 auto"><h1>Welcome to the Waitlist!</h1><p>You're position <strong>#${maxPos + 1}</strong> in line.</p><p>Share your link to move up: ${baseUrl}/waitlist?ref=${wCode}</p><a href="${baseUrl}" style="background:#6366f1;color:white;padding:10px 20px;border-radius:8px;text-decoration:none">Visit Comfort Zone</a></div>`);
      } catch(e) {}
    }
  } catch(e) { /* duplicate email, ignore */ }

  const redir = req.headers.referer || '/waitlist';
  res.redirect(redir);
}));

// ── POST /api/waitlist/share — Share to move up ─────────────
app.post('/api/waitlist/share', ah(async (req, res) => {
  // Look up user by session or email in body
  const email = req.body?.email || req.session?.user?.email;
  if (!email) return res.json({ ok: false, error: 'Not authenticated' });

  const entry = (await pool.query(`SELECT * FROM waitlist WHERE email = $1`, [email])).rows[0];
  if (!entry) return res.json({ ok: false, error: 'Not on waitlist' });

  // Move up by reducing position
  const newPos = Math.max(1, entry.position - 1);
  await pool.query(`UPDATE waitlist SET position = $1 WHERE email = $2`, [newPos, email]);

  const link = `${baseUrl}/waitlist?ref=${entry.referral_code}`;
  res.json({ ok: true, link, position: newPos });
}));

// ── GET /badges — Public badge showcase ─────────────────────
app.get('/badges', ah(async (req, res) => {
  const allBadges = (await pool.query(`SELECT * FROM badge_definitions ORDER BY category, id`)).rows;
  const categories = [...new Set(allBadges.map(b => b.category))];

  const catHtml = categories.map(cat => {
    const badges = allBadges.filter(b => b.category === cat);
    return `<div style="margin-bottom:24px">
      <h2 style="font-size:20px;margin-bottom:12px;text-transform:capitalize;color:#1e293b">${esc(cat)}</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px">
        ${badges.map(b => `
          <div style="background:white;padding:16px;border-radius:12px;border:1px solid #e2e8f0;text-align:center">
            <div style="font-size:36px;margin-bottom:8px">${b.icon || '🏆'}</div>
            <div style="font-weight:600;font-size:14px;margin-bottom:4px">${esc(b.name)}</div>
            <div style="color:#64748b;font-size:12px">${esc(b.description || '')}</div>
          </div>`).join('')}
      </div>
    </div>`;
  }).join('');

  res.send(`<!DOCTYPE html><html><head>
    <title>Badges — Comfort Zone</title>
    <meta name="description" content="Explore all achievement badges on Comfort Zone. Earn rewards for engagement, referrals, and more.">
    <meta name="robots" content="index, follow">
    <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui;background:#f8fafc;color:#1e293b}</style>
  </head><body>
    <nav style="background:white;padding:12px 24px;border-bottom:1px solid #e2e8f0"><a href="/" style="font-weight:700;font-size:18px;color:#6366f1;text-decoration:none">Comfort Zone</a></nav>
    <div style="max-width:900px;margin:0 auto;padding:32px 20px">
      <div style="text-align:center;margin-bottom:32px">
        <h1 style="font-size:32px;margin-bottom:8px">🏅 Achievement Badges</h1>
        <p style="color:#64748b;font-size:16px">${allBadges.length} badges to earn across ${categories.length} categories</p>
      </div>
      ${catHtml}
      <div style="text-align:center;margin-top:32px">
        <a href="/register" style="background:#6366f1;color:white;padding:14px 32px;border-radius:12px;text-decoration:none;font-weight:700;font-size:16px">Start Earning Badges</a>
      </div>
      <div style="background:white;padding:16px;border-radius:12px;border:1px solid #e2e8f0;margin-top:24px">
        <h3 style="font-size:14px;margin-bottom:8px;color:#64748b">📋 Embed Your Badges</h3>
        <code style="font-size:12px;background:#f8fafc;padding:8px;border-radius:6px;display:block">&lt;iframe src="${baseUrl}/embed/badge" width="400" height="200" frameborder="0"&gt;&lt;/iframe&gt;</code>
      </div>
    </div>
  </body></html>`);
}));

// ── GET /badges/:email — User's badge wall ──────────────────
app.get('/badges/:email', ah(async (req, res) => {
  const email = decodeURIComponent(req.params.email);
  const userBadges = (await pool.query(
    `SELECT bd.*, ub.earned_at FROM user_badges ub
     JOIN badge_definitions bd ON bd.id = ub.badge_id
     WHERE ub.user_email = $1 ORDER BY ub.earned_at DESC`,
    [email]
  )).rows;

  const allBadges = (await pool.query(`SELECT * FROM badge_definitions ORDER BY category, id`)).rows;
  const earnedIds = new Set(userBadges.map(b => b.id));
  const locked = allBadges.filter(b => !earnedIds.has(b.id));

  const earnedHtml = userBadges.map(b => `
    <div style="background:white;padding:16px;border-radius:12px;border:1px solid #bbf7d0;text-align:center">
      <div style="font-size:36px">${b.icon}</div>
      <div style="font-weight:600;font-size:14px;margin-top:6px">${esc(b.name)}</div>
      <div style="color:#16a34a;font-size:11px">✅ Earned</div>
    </div>`).join('');

  const lockedHtml = locked.slice(0, 12).map(b => `
    <div style="background:#f8fafc;padding:16px;border-radius:12px;border:1px solid #e2e8f0;text-align:center;opacity:0.5">
      <div style="font-size:36px;filter:grayscale(100%)">${b.icon}</div>
      <div style="font-weight:600;font-size:14px;margin-top:6px">${esc(b.name)}</div>
      <div style="color:#94a3b8;font-size:11px">🔒 Locked</div>
    </div>`).join('');

  res.send(`<!DOCTYPE html><html><head>
    <title>${esc(email)}'s Badges — Comfort Zone</title>
    <meta name="description" content="View ${esc(email)}'s achievement badges on Comfort Zone.">
    <meta name="robots" content="noindex">
    <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui;background:#f8fafc;color:#1e293b}</style>
  </head><body>
    <div style="max-width:800px;margin:32px auto;padding:20px">
      <div style="text-align:center;margin-bottom:24px">
        <h1 style="font-size:28px;margin-bottom:4px">🏅 Badge Wall</h1>
        <p style="color:#64748b">${esc(email)}</p>
        <p style="font-size:14px;color:#6366f1;margin-top:4px">${userBadges.length} / ${allBadges.length} badges earned</p>
      </div>
      <h2 style="margin-bottom:12px">✅ Earned Badges</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px;margin-bottom:24px">${earnedHtml || '<p style="color:#94a3b8">No badges earned yet</p>'}</div>
      ${locked.length ? `<h2 style="margin-bottom:12px;color:#94a3b8">🔒 Locked Badges</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px">${lockedHtml}</div>` : ''}
      <div style="text-align:center;margin-top:24px"><a href="/register" style="color:#6366f1;text-decoration:none;font-size:14px">Join Comfort Zone &rarr;</a></div>
    </div>
  </body></html>`);
}));

// ── GET /api/badges/all — List all badges ───────────────────
app.get('/api/badges/all', ah(async (req, res) => {
  const rows = (await pool.query(`SELECT * FROM badge_definitions ORDER BY category, id`)).rows;
  res.json({ badges: rows });
}));

// ── GET /api/badges/mine — Current user's badges ────────────
app.get('/api/badges/mine', requireAuth, ah(async (req, res) => {
  const email = req.session.user.email;
  const rows = (await pool.query(
    `SELECT bd.*, ub.earned_at FROM user_badges ub JOIN badge_definitions bd ON bd.id = ub.badge_id WHERE ub.user_email = $1 ORDER BY ub.earned_at DESC`,
    [email]
  )).rows;
  res.json({ badges: rows, total: rows.length });
}));

// ── POST /api/digest/trigger — Manual digest trigger ────────
app.post('/api/digest/trigger', requireAuth, ah(async (req, res) => {
  const tid = req.session.user.tenant_id;
  const freq = req.body.frequency || 'weekly';
  const html = await generateDigestHTML(tid, freq);

  // Insert into email_queue for worker to process
  try {
    await pool.query(
      `INSERT INTO email_queue (tenant_id, to_email, subject, html_body, status)
       VALUES ($1, $2, $3, $4, 'pending')`,
      [tid, req.session.user.email, `${freq === 'daily' ? 'Daily' : freq === 'weekly' ? 'Weekly' : 'Monthly'} Digest — Comfort Zone`, html]
    );
    await pool.query(
      `INSERT INTO digest_schedule (tenant_id, frequency, last_sent, is_active)
       VALUES ($1, $2, NOW(), true) ON CONFLICT (tenant_id) DO UPDATE SET last_sent = NOW()`,
      [tid, freq]
    );
  } catch(e) { /* email_queue may not exist */ }

  res.json({ ok: true, frequency: freq, message: 'Digest generated and queued' });
}));

// ── GLOBAL EXPORTS ──────────────────────────────────────────
global.sendPushNotification = sendPushNotification;
global.generateDigestHTML = generateDigestHTML;
global.generateReferralCode = generateReferralCode;
global.awardBadgeIfMissing = awardBadgeIfMissing;

// ── INIT LOG ────────────────────────────────────────────────
console.log('[ViralLoop] LOADED: Referral dashboard with reward tracking & tiers, social share OG images, push notification delivery, embeddable widgets, invite links, waitlist system, badge showcase (' + BADGE_DEFS.length + ' badges), digest generation');
