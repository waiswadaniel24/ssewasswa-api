// ============================================================
// === ENGAGEMENT ENGINE — Daily Challenges, Leaderboard, ===
// === Achievements, Rewards Store, Streaks, Levels ===
// ============================================================

const ENG_MIGRATIONS = [
  // Daily Challenges
  `CREATE TABLE IF NOT EXISTS daily_challenges (
    id SERIAL PRIMARY KEY, challenge_text TEXT NOT NULL,
    challenge_type TEXT DEFAULT 'visit', reward_points INTEGER DEFAULT 10,
    is_active BOOLEAN DEFAULT true, date DATE DEFAULT CURRENT_DATE,
    completions INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS challenge_completions (
    id SERIAL PRIMARY KEY, challenge_id INTEGER REFERENCES daily_challenges(id) ON DELETE CASCADE,
    user_email TEXT, completed_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(challenge_id, user_email)
  )`,
  // Achievements / Badges)
  `CREATE TABLE IF NOT EXISTS achievements (
    id SERIAL PRIMARY KEY, badge_name TEXT UNIQUE NOT NULL,
    description TEXT, icon TEXT DEFAULT '🏆',
    requirement_type TEXT, requirement_value INTEGER DEFAULT 1,
    category TEXT DEFAULT 'general', created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS user_achievements (
    id SERIAL PRIMARY KEY, user_email TEXT NOT NULL,
    achievement_id INTEGER REFERENCES achievements(id) ON DELETE CASCADE,
    earned_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_email, achievement_id)
  )`,
  // Rewards Store)
  `CREATE TABLE IF NOT EXISTS rewards_store (
    id SERIAL PRIMARY KEY, reward_name TEXT NOT NULL,
    description TEXT, icon TEXT DEFAULT '🎁',
    cost_points INTEGER DEFAULT 100,
    reward_type TEXT DEFAULT 'digital',
    is_available BOOLEAN DEFAULT true,
    redemption_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS reward_redemptions (
    id SERIAL PRIMARY KEY, reward_id INTEGER REFERENCES rewards_store(id) ON DELETE CASCADE,
    user_email TEXT, points_spent INTEGER,
    status TEXT DEFAULT 'pending', redeemed_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  // User Streaks)
  `CREATE TABLE IF NOT EXISTS user_streaks (
    id SERIAL PRIMARY KEY, user_email TEXT UNIQUE NOT NULL,
    current_streak INTEGER DEFAULT 0, longest_streak INTEGER DEFAULT 0,
    last_active DATE, streak_start DATE,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  // Leaderboard (materialized view replacement)
  `CREATE TABLE IF NOT EXISTS leaderboard_cache (
    id SERIAL PRIMARY KEY, user_email TEXT NOT NULL,
    display_name TEXT, total_points INTEGER DEFAULT 0,
    level INTEGER DEFAULT 1, rank INTEGER DEFAULT 0,
    category TEXT DEFAULT 'overall', updated_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  // Gamification Events)
  `CREATE TABLE IF NOT EXISTS gamification_events (
    id SERIAL PRIMARY KEY, user_email TEXT NOT NULL,
    event_type TEXT NOT NULL, event_data JSONB,
    points_earned INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
];
ENG_MIGRATIONS.forEach(m => migrations.push(m));
['daily_challenges','challenge_completions','achievements','user_achievements',
 'rewards_store','reward_redemptions','user_streaks','leaderboard_cache','gamification_events'
].forEach(t => VALID_TABLES.add(t));

// ============================================================
// === 1. DAILY CHALLENGES ===
// ============================================================

const CHALLENGE_TEMPLATES = [
  { text: 'Log in today and check your dashboard', type: 'login', points: 10 },
  { text: 'Read any 3 news articles on /discover', type: 'read', points: 15 },
  { text: 'Share any content on WhatsApp', type: 'share', points: 20 },
  { text: 'Take a quiz and share your score', type: 'quiz', points: 25 },
  { text: 'Vote in today\'s community poll', type: 'poll', points: 15 },
  { text: 'Invite a friend to join Comfort Zone', type: 'refer', points: 50 },
  { text: 'Submit feedback about the platform', type: 'feedback', points: 20 },
  { text: 'Read any premium article', type: 'premium', points: 15 },
  { text: 'Visit 5 different pages', type: 'browse', points: 20 },
  { text: 'Comment on a forum topic', type: 'forum', points: 15 },
  { text: 'Submit a business listing', type: 'listing', points: 30 },
  { text: 'Complete your profile information', type: 'profile', points: 25 },
];

// Generate daily challenges
async function generateDailyChallenges() {
  const today = new Date().toISOString().split('T')[0];
  const existing = (await pool.query('SELECT COUNT(*) FROM daily_challenges WHERE date = $1', [today])).rows[0].count;
  if (parseInt(existing) > 0) return;
  // Pick 3 random challenges
  const shuffled = [...CHALLENGE_TEMPLATES].sort(() => Math.random() - 0.5);
  for (const ch of shuffled.slice(0, 3)) {
    await pool.query(
      `INSERT INTO daily_challenges (challenge_text, challenge_type, reward_points, date) VALUES ($1, $2, $3, $4)`,
      [ch.text, ch.type, ch.points, today]
    ).catch(() => {});
  }
}

// Public daily challenges page
app.get('/challenges', ah(async (req, res) => {
  await generateDailyChallenges();
  const today = new Date().toISOString().split('T')[0];
  const challenges = (await pool.query('SELECT * FROM daily_challenges WHERE date = $1 ORDER BY reward_points DESC', [today])).rows;
  const userEmail = req.session?.user?.email;
  let userCompletions = [];
  if (userEmail) {
    userCompletions = (await pool.query('SELECT challenge_id FROM challenge_completions WHERE user_email = $1', [userEmail])).rows.map(r => r.challenge_id);
  }
  const totalPossible = challenges.reduce((s, c) => s + c.reward_points, 0);
  const totalEarned = challenges.filter(c => userCompletions.includes(c.id)).reduce((s, c) => s + c.reward_points, 0);

  res.send(renderPage('Daily Challenges', `
    <div class="hero" style="background:linear-gradient(135deg,#f59e0b,#d97706)"><h1>Daily Challenges</h1><p>Complete challenges to earn points and level up! ${userEmail ? `Today's progress: ${totalEarned}/${totalPossible} pts` : 'Log in to participate'}</p></div>
    <div style="max-width:600px;margin:0 auto">
      ${!userEmail ? '<div class="card" style="text-align:center;padding:24px"><p style="color:#64748b;margin-bottom:12px">Log in or create an account to participate in daily challenges</p><a href="/login" class="btn" style="background:#6366f1">Log In</a> <a href="/register" class="btn" style="background:#10b981">Sign Up</a></div>' : ''}
      <div style="background:#f1f5f9;border-radius:12px;height:8px;margin-bottom:24px;overflow:hidden">
        <div style="height:100%;background:linear-gradient(90deg,#f59e0b,#ef4444);border-radius:12px;width:${totalPossible > 0 ? (totalEarned/totalPossible*100) : 0}%;transition:width 0.5s"></div>
      </div>
      ${challenges.map(c => {
        const done = userCompletions.includes(c.id);
        return `<div class="card" style="margin-bottom:12px;${done?'opacity:0.6':''}">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div>
              <div style="display:flex;gap:8px;align-items:center">
                <span style="font-size:20px">${done ? '✅' : '🎯'}</span>
                <span style="font-weight:500;font-size:15px">${esc(c.challenge_text)}</span>
              </div>
              <div style="font-size:12px;color:#94a3b8;margin-top:4px;margin-left:28px">${c.completions || 0} people completed</div>
            </div>
            <div style="text-align:right">
              <span style="color:#f59e0b;font-weight:700;font-size:16px">+${c.reward_points}</span>
              <div style="font-size:11px;color:#94a3b8">points</div>
            </div>
          </div>
        </div>`;
      }).join('')}
      <div class="card" style="text-align:center;margin-top:16px">
        <h3>How Points Work</h3>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:12px;font-size:13px">
          <div style="padding:12px;background:#f8fafc;border-radius:8px"><div style="font-weight:700;color:#f59e0b;font-size:18px">10-25 pts</div>Daily tasks</div>
          <div style="padding:12px;background:#f8fafc;border-radius:8px"><div style="font-weight:700;color:#6366f1;font-size:18px">50 pts</div>Referrals</div>
          <div style="padding:12px;background:#f8fafc;border-radius:8px"><div style="font-weight:700;color:#10b981;font-size:18px">Redeem</div>Reward store</div>
        </div>
      </div>
    </div>
  `, req.session.user, true));
}));

// Complete a challenge
app.post('/api/challenges/complete/:id', requireAuth, ah(async (req, res) => {
  const user = req.session.user;
  const existing = (await pool.query('SELECT id FROM challenge_completions WHERE challenge_id = $1 AND user_email = $2', [req.params.id, user.email])).rows[0];
  if (existing) return res.json({ success: false, message: 'Already completed' });
  const challenge = (await pool.query('SELECT * FROM daily_challenges WHERE id = $1', [req.params.id])).rows[0];
  if (!challenge) return res.json({ success: false });
  await pool.query('INSERT INTO challenge_completions (challenge_id, user_email) VALUES ($1, $2)', [req.params.id, user.email]);
  await pool.query('UPDATE daily_challenges SET completions = completions + 1 WHERE id = $1', [req.params.id]);
  await awardPoints(user.email, 'daily_challenge', 'challenge');
  await updateStreak(user.email);
  await trackRevenue('challenge_complete', 0.01, `Challenge: ${challenge.challenge_text}`);
  res.json({ success: true, points: challenge.reward_points });
}));

// ============================================================
// === 2. STREAKS SYSTEM ===
// ============================================================
async function updateStreak(email) {
  const today = new Date().toISOString().split('T')[0];
  const streak = (await pool.query('SELECT * FROM user_streaks WHERE user_email = $1', [email])).rows[0];
  if (!streak) {
    await pool.query('INSERT INTO user_streaks (user_email, current_streak, longest_streak, last_active, streak_start) VALUES ($1, 1, 1, $2, $2)', [email, today]);
  } else {
    const lastActive = streak.last_active ? new Date(streak.last_active).toISOString().split('T')[0] : null;
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    if (lastActive === today) {
      // Already active today, no change
    } else if (lastActive === yesterday) {
      // Streak continues
      const newStreak = streak.current_streak + 1;
      const longest = Math.max(newStreak, streak.longest_streak);
      await pool.query('UPDATE user_streaks SET current_streak = $1, longest_streak = $2, last_active = $3 WHERE user_email = $4', [newStreak, longest, today, email]);
      // Streak bonus
      if (newStreak % 7 === 0) {
        await awardPoints(email, 'streak_bonus', 'weekly_streak');
      }
    } else {
      // Streak broken
      await pool.query('UPDATE user_streaks SET current_streak = 1, last_active = $1, streak_start = $1 WHERE user_email = $2', [today, email]);
    }
  }
}

// ============================================================
// === 3. ACHIEVEMENTS ===
// ============================================================

const ACHIEVEMENT_DEFS = [
  { name: 'First Login', desc: 'Logged in for the first time', icon: '🚀', type: 'login', value: 1, cat: 'general' },
  { name: 'Early Adopter', desc: 'Signed up in the first month', icon: '⭐', type: 'early', value: 1, cat: 'general' },
  { name: 'Social Butterfly', desc: 'Shared 10 pieces of content', icon: '🦋', type: 'share', value: 10, cat: 'social' },
  { name: 'Quiz Master', desc: 'Completed 5 quizzes', icon: '🧠', type: 'quiz', value: 5, cat: 'knowledge' },
  { name: 'Community Voice', desc: 'Posted 5 forum replies', icon: '💬', type: 'forum_post', value: 5, cat: 'community' },
  { name: 'Influencer', desc: 'Referred 10 friends', icon: '📢', type: 'referral', value: 10, cat: 'social' },
  { name: 'Streak Warrior', desc: '7-day login streak', icon: '🔥', type: 'streak', value: 7, cat: 'engagement' },
  { name: 'Streak Legend', desc: '30-day login streak', icon: '💎', type: 'streak', value: 30, cat: 'engagement' },
  { name: 'Bookworm', desc: 'Read 50 articles', icon: '📚', type: 'read', value: 50, cat: 'knowledge' },
  { name: 'Poll Veteran', desc: 'Voted in 20 polls', icon: '🗳️', type: 'poll', value: 20, cat: 'engagement' },
  { name: 'Feedback Hero', desc: 'Submitted 3 feedbacks', icon: '💎', type: 'feedback', value: 3, cat: 'community' },
  { name: 'Business Mogul', desc: 'Listed 3 businesses in directory', icon: '🏢', type: 'listing', value: 3, cat: 'business' },
  { name: 'Generous Soul', desc: 'Made a donation', icon: '❤️', type: 'donation', value: 1, cat: 'generosity' },
  { name: 'Content Creator', desc: 'Submitted a success story', icon: '✍️', type: 'story', value: 1, cat: 'content' },
  { name: 'Challenge Champion', desc: 'Completed 30 daily challenges', icon: '🏆', type: 'challenge', value: 30, cat: 'engagement' },
];

async function seedAchievements() {
  const count = (await pool.query('SELECT COUNT(*) FROM achievements')).rows[0].count;
  if (parseInt(count) < ACHIEVEMENT_DEFS.length) {
    for (const a of ACHIEVEMENT_DEFS) {
      await pool.query(
        `INSERT INTO achievements (badge_name, description, icon, requirement_type, requirement_value, category) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
        [a.name, a.desc, a.icon, a.type, a.value, a.cat]
      ).catch(() => {});
    }
  }
}

async function checkAchievement(email, type, count) {
  const ach = (await pool.query('SELECT * FROM achievements WHERE requirement_type = $1 AND requirement_value <= $2', [type, count])).rows;
  for (const a of ach) {
    const existing = (await pool.query('SELECT id FROM user_achievements WHERE user_email = $1 AND achievement_id = $2', [email, a.id])).rows[0];
    if (!existing) {
      await pool.query('INSERT INTO user_achievements (user_email, achievement_id) VALUES ($1, $2)', [email, a.id]);
      await awardPoints(email, 'achievement', a.name);
      // Store badge
      await pool.query(`INSERT INTO notification_badges (user_email, badge_type, badge_name, badge_icon, description) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
        [email, a.name, a.name, a.icon, a.desc]);
      console.log(`[Achievement] ${email} earned "${a.name}" ${a.icon}`);
    }
  }
}

// Public achievements page
app.get('/achievements', requireAuth, ah(async (req, res) => {
  const user = req.session.user;
  const allAch = (await pool.query('SELECT * FROM achievements ORDER BY category, requirement_value')).rows;
  const earned = (await pool.query('SELECT achievement_id FROM user_achievements WHERE user_email = $1', [user.email])).rows.map(r => r.achievement_id);
  const userPoints = (await pool.query('SELECT points, level FROM user_points WHERE user_email = $1', [user.email])).rows[0];
  const streak = (await pool.query('SELECT * FROM user_streaks WHERE user_email = $1', [user.email])).rows[0];

  res.send(renderPage('My Achievements', `
    <div class="hero" style="background:linear-gradient(135deg,#f59e0b,#ef4444)"><h1>My Achievements</h1><p>${earned.length}/${allAch.length} badges earned</p></div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:24px;max-width:700px;margin-left:auto;margin-right:auto">
      <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${userPoints ? userPoints.points : 0}</div><div>Total Points</div></div>
      <div class="stat-card"><div class="stat-num" style="color:#6366f1">Level ${userPoints ? userPoints.level : 1}</div><div>Current Level</div></div>
      <div class="stat-card"><div class="stat-num" style="color:#ef4444">${streak ? streak.current_streak : 0}</div><div>Day Streak</div></div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;max-width:900px;margin:0 auto">
      ${allAch.map(a => {
        const isEarned = earned.includes(a.id);
        return `<div style="padding:16px;background:${isEarned ? 'linear-gradient(135deg,#fef3c7,#fde68a)' : '#f8fafc'};border:1px solid ${isEarned ? '#f59e0b' : '#e2e8f0'};border-radius:12px;text-align:center;${isEarned?'':'opacity:0.5'}">
          <div style="font-size:32px">${isEarned ? a.icon : '🔒'}</div>
          <div style="font-weight:600;margin-top:6px;font-size:14px">${esc(a.badge_name)}</div>
          <div style="color:#64748b;font-size:12px;margin-top:2px">${esc(a.description)}</div>
          ${isEarned ? '<div style="color:#f59e0b;font-size:11px;font-weight:600;margin-top:4px">EARNED</div>' : `<div style="color:#94a3b8;font-size:11px;margin-top:4px">${a.category}</div>`}
        </div>`;
      }).join('')}
    </div>
  `, req.session.user, true));
}));

// ============================================================
// === 4. REWARDS STORE ===
// ============================================================

const REWARD_ITEMS = [
  { name: 'Premium Badge', desc: 'Show a special Premium badge on your profile for 30 days', icon: '⭐', cost: 200, type: 'digital' },
  { name: 'Featured Listing', desc: 'Feature your business in the directory for 7 days', icon: '🏢', cost: 500, type: 'listing' },
  { name: 'Extra Storage', desc: 'Get 1GB extra file storage for your account', icon: '💾', cost: 300, type: 'digital' },
  { name: 'Custom Theme', desc: 'Unlock custom color themes for your dashboard', icon: '🎨', cost: 150, type: 'digital' },
  { name: 'Priority Support', desc: 'Get priority support for 30 days', icon: '🎯', cost: 400, type: 'digital' },
  { name: 'Ad-Free Experience', desc: 'Remove all ads for 7 days', icon: '🚫', cost: 250, type: 'digital' },
  { name: 'Bulk SMS Credits', desc: 'Get 100 free SMS credits', icon: '📱', cost: 350, type: 'credits' },
  { name: 'Certificate Template', desc: 'Unlock premium certificate templates', icon: '📜', cost: 200, type: 'digital' },
];

async function seedRewardsStore() {
  const count = (await pool.query('SELECT COUNT(*) FROM rewards_store')).rows[0].count;
  if (parseInt(count) < REWARD_ITEMS.length) {
    for (const r of REWARD_ITEMS) {
      await pool.query(`INSERT INTO rewards_store (reward_name, description, icon, cost_points, reward_type) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
        [r.name, r.desc, r.icon, r.cost, r.type]).catch(() => {});
    }
  }
}

// Public rewards store
app.get('/rewards', requireAuth, ah(async (req, res) => {
  const user = req.session.user;
  await seedRewardsStore();
  const rewards = (await pool.query('SELECT * FROM rewards_store WHERE is_available = true ORDER BY cost_points')).rows;
  const userPoints = (await pool.query('SELECT points FROM user_points WHERE user_email = $1', [user.email])).rows[0];
  const pts = userPoints ? userPoints.points : 0;
  const myRedemptions = (await pool.query('SELECT * FROM reward_redemptions WHERE user_email = $1 ORDER BY redeemed_at DESC LIMIT 10', [user.email])).rows;

  res.send(renderPage('Rewards Store', `
    <div class="hero" style="background:linear-gradient(135deg,#8b5cf6,#6366f1)"><h1>Rewards Store</h1><p>You have <span style="font-size:24px;font-weight:700;color:#f59e0b">${pts.toLocaleString()}</span> points to spend</p></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px;max-width:900px;margin:0 auto">
      ${rewards.map(r => {
        const canAfford = pts >= r.cost_points;
        return `<div class="card" style="text-align:center;${canAfford?'':'opacity:0.6'}">
          <div style="font-size:40px;margin-bottom:8px">${r.icon}</div>
          <h3 style="font-size:15px">${esc(r.reward_name)}</h3>
          <p style="color:#64748b;font-size:12px;margin-top:4px">${esc(r.description)}</p>
          <div style="margin-top:12px;font-size:18px;font-weight:700;color:#f59e0b">${r.cost_points} pts</div>
          <form method="POST" action="/rewards/redeem/${r.id}" style="margin-top:8px">
            <button type="submit" ${canAfford ? '' : 'disabled'} style="width:100%;padding:8px;border-radius:8px;border:none;cursor:pointer;font-weight:600;${canAfford?'background:#6366f1;color:white':'background:#e2e8f0;color:#94a3b8;cursor:not-allowed'}">${canAfford ? 'Redeem' : 'Need ' + (r.cost_points - pts) + ' more pts'}</button>
          </form>
          <div style="font-size:11px;color:#94a3b8;margin-top:4px">${r.redemption_count || 0} redeemed</div>
        </div>`;
      }).join('')}
    </div>
    ${myRedemptions.length > 0 ? `<div style="max-width:600px;margin:24px auto"><div class="card"><h3>My Redemptions</h3>
      ${myRedemptions.map(r => `<div style="padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:13px"><span style="font-weight:500">${esc(r.reward_name || 'Reward #'+r.id)}</span> · <span style="color:${r.status==='completed'?'#10b981':'#f59e0b'}">${r.status}</span> · ${r.redeemed_at ? new Date(r.redeemed_at).toLocaleDateString() : ''}</div>`).join('')}
    </div></div>` : ''}
  `, req.session.user, true));
}));

app.post('/rewards/redeem/:id', requireAuth, ah(async (req, res) => {
  const user = req.session.user;
  const reward = (await pool.query('SELECT * FROM rewards_store WHERE id = $1', [req.params.id])).rows[0];
  if (!reward) return res.send('Reward not found');
  const userPts = (await pool.query('SELECT points FROM user_points WHERE user_email = $1', [user.email])).rows[0];
  const pts = userPts ? userPts.points : 0;
  if (pts < reward.cost_points) return res.send('Not enough points');
  // Deduct points
  await pool.query('UPDATE user_points SET points = points - $1 WHERE user_email = $2', [reward.cost_points, user.email]);
  await pool.query('INSERT INTO reward_redemptions (reward_id, user_email, points_spent) VALUES ($1, $2, $3)', [reward.id, user.email, reward.cost_points]);
  await pool.query('UPDATE rewards_store SET redemption_count = redemption_count + 1 WHERE id = $1', [reward.id]);
  res.send(renderPage('Reward Redeemed!', `
    <div style="max-width:400px;margin:60px auto;text-align:center">
      <div style="font-size:64px">${reward.icon}</div>
      <h1 style="margin-top:12px">Redeemed!</h1>
      <p style="color:#64748b;margin-top:8px">You redeemed "${esc(reward.reward_name)}" for ${reward.cost_points} points</p>
      <p style="color:#64748b;margin-top:4px">Remaining balance: ${(pts - reward.cost_points).toLocaleString()} points</p>
      <a href="/rewards" class="btn" style="background:#6366f1;margin-top:20px;display:inline-block">Back to Store</a>
    </div>
  `, req.session.user, true));
}));

// ============================================================
// === 5. LEADERBOARD ===
// ============================================================

app.get('/leaderboard', ah(async (req, res) => {
  const period = req.query.period || 'all';
  let orderBy = 'total_score DESC';
  let dateFilter = '';
  if (period === 'weekly') { dateFilter = "WHERE created_at >= NOW() - INTERVAL '7 days'"; }
  else if (period === 'monthly') { dateFilter = "WHERE created_at >= DATE_TRUNC('month', CURRENT_DATE)"; }

  const leaders = (await pool.query(`
    SELECT user_email, SUM(points) as total_score, COUNT(*) as activities
    FROM point_transactions ${dateFilter}
    GROUP BY user_email ORDER BY total_score DESC LIMIT 50)
  `)).rows;

  const medals = ['🥇', '🥈', '🥉'];
  res.send(renderPage('Leaderboard', `
    <div class="hero" style="background:linear-gradient(135deg,#f59e0b,#ef4444)"><h1>Leaderboard</h1><p>Top contributors earn recognition and rewards</p></div>
    <div style="display:flex;gap:8px;justify-content:center;margin-bottom:24px">
      <a href="/leaderboard?period=weekly" style="padding:8px 16px;border-radius:8px;text-decoration:none;font-size:13px;${period==='weekly'?'background:#6366f1;color:white':'background:#f1f5f9;color:#475569'}">This Week</a>
      <a href="/leaderboard?period=monthly" style="padding:8px 16px;border-radius:8px;text-decoration:none;font-size:13px;${period==='monthly'?'background:#6366f1;color:white':'background:#f1f5f9;color:#475569'}">This Month</a>
      <a href="/leaderboard?period=all" style="padding:8px 16px;border-radius:8px;text-decoration:none;font-size:13px;${period==='all'?'background:#6366f1;color:white':'background:#f1f5f9;color:#475569'}">All Time</a>
    </div>
    <div style="max-width:600px;margin:0 auto">
      ${leaders.slice(0, 3).map((l, i) => `<div style="background:${i===0?'linear-gradient(135deg,#fef3c7,#fde68a)':i===1?'linear-gradient(135deg,#f1f5f9,#e2e8f0)':'linear-gradient(135deg,#fed7aa,#fdba74)'};padding:20px;border-radius:12px;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between">
        <div style="display:flex;align-items:center;gap:12px">
          <span style="font-size:32px">${medals[i]}</span>
          <div><div style="font-weight:700;font-size:16px">${esc(l.user_email)}</div><div style="font-size:12px;color:#64748b">${l.activities} activities</div></div>
        </div>
        <div style="text-align:right"><div style="font-size:20px;font-weight:700;color:#f59e0b">${Number(l.total_score).toLocaleString()}</div><div style="font-size:11px;color:#94a3b8">points</div></div>
      </div>`).join('')}
      ${leaders.slice(3).map((l, i) => `<div class="card" style="margin-bottom:4px;display:flex;justify-content:space-between;align-items:center;padding:12px 16px">
        <div style="display:flex;align-items:center;gap:12px"><span style="font-weight:600;color:#94a3b8;font-size:14px">#${i+4}</span><span style="font-size:14px">${esc(l.user_email)}</span></div>
        <span style="font-weight:600;color:#f59e0b">${Number(l.total_score).toLocaleString()} pts</span>
      </div>`).join('')}
    </div>
  `, null, true));
}));

// ============================================================
// === 6. USER PROFILE (public gamification) ===
// ============================================================

app.get('/profile/:email', ah(async (req, res) => {
  const email = req.params.email;
  const [points, streak, achievements, recentActivity] = await Promise.all([
    pool.query('SELECT * FROM user_points WHERE user_email = $1', [email]),
    pool.query('SELECT * FROM user_streaks WHERE user_email = $1', [email]),
    pool.query('SELECT a.* FROM achievements a JOIN user_achievements ua ON a.id = ua.achievement_id WHERE ua.user_email = $1', [email]),
    pool.query('SELECT * FROM point_transactions WHERE user_email = $1 ORDER BY created_at DESC LIMIT 20', [email])
  ]);
  const pts = points.rows[0];
  const stk = streak.rows[0];
  // Calculate level
  const totalPts = pts ? pts.points : 0;
  const level = Math.floor(totalPts / 100) + 1;
  const nextLevelPts = level * 100;
  const currentLevelPts = (level - 1) * 100;
  const progressPct = Math.min(((totalPts - currentLevelPts) / (nextLevelPts - currentLevelPts)) * 100, 100);

  res.send(renderPage('User Profile', `
    <div style="max-width:600px;margin:0 auto;text-align:center">
      <div style="font-size:48px;margin-bottom:8px">${achievements.rows.length >= 10 ? '👑' : achievements.rows.length >= 5 ? '⭐' : '👤'}</div>
      <h1 style="font-size:24px">${esc(email)}</h1>
      <div style="margin-top:8px;font-size:14px;color:#64748b">Level ${level} · ${achievements.rows.length} badges</div>
      <div style="background:#f1f5f9;border-radius:12px;height:8px;margin:16px auto;max-width:300px;overflow:hidden">
        <div style="height:100%;background:linear-gradient(90deg,#6366f1,#8b5cf6);border-radius:12px;width:${progressPct}%"></div>
      </div>
      <div style="font-size:12px;color:#94a3b8">${totalPts}/${nextLevelPts} points to Level ${level+1}</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:24px 0">
        <div style="padding:12px;background:#f8fafc;border-radius:8px"><div style="font-size:20px;font-weight:700;color:#f59e0b">${totalPts}</div><div style="font-size:12px;color:#64748b">Points</div></div>
        <div style="padding:12px;background:#f8fafc;border-radius:8px"><div style="font-size:20px;font-weight:700;color:#ef4444">${stk ? stk.current_streak : 0}</div><div style="font-size:12px;color:#64748b">Day Streak</div></div>
        <div style="padding:12px;background:#f8fafc;border-radius:8px"><div style="font-size:20px;font-weight:700;color:#6366f1">${stk ? stk.longest_streak : 0}</div><div style="font-size:12px;color:#64748b">Best Streak</div></div>
      </div>
      ${achievements.rows.length > 0 ? `<div style="text-align:left;margin-top:24px"><h3>Badges</h3><div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px">${achievements.rows.map(a => `<span title="${esc(a.description)}" style="background:#fef3c7;padding:4px 10px;border-radius:6px;font-size:12px">${a.icon} ${esc(a.badge_name)}</span>`).join('')}</div></div>` : ''}
      <div style="text-align:left;margin-top:24px"><h3>Recent Activity</h3>
        ${(recentActivity.rows || []).slice(0, 10).map(a => `<div style="padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:13px;display:flex;justify-content:space-between"><span>${esc(a.reason || a.source || 'Activity')}</span><span style="color:#10b981;font-weight:600">+${a.points} pts</span></div>`).join('')}
      </div>
    </div>
  `, null, true));
}));

// ============================================================
// === SEED & INIT ===
// ============================================================
seedAchievements().catch(e => console.warn('[Engagement] Seed error:', e.message));
seedRewardsStore().catch(e => console.warn('[Engagement] Seed error:', e.message));
generateDailyChallenges().catch(e => console.warn('[Engagement] Challenge gen error:', e.message));
console.log('[Engagement] LOADED: Daily Challenges, Streaks, Achievements (15 badges), Rewards Store (8 items), Leaderboard, User Profiles');
