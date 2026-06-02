/**
 * Gamification Engine — Student Points, Badges, Levels, Streaks, Rewards & Leaderboards
 * Module: gamification-engine.js
 */
const { migrateQuery } = require('./db');
module.exports = function(app, pool, opts) {
  const esc = opts.esc || (s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'));
  const renderPage = opts.renderPage || ((t,c,u) => c);
  const ah = opts.ah || ((fn) => async (req,res,next) => { try { await fn(req,res,next); } catch(e) { res.status(500).send('Error: '+e.message); }});
  const requireAuth = opts.requireAuth || ((req,res,next) => { if(!req.session?.user) return res.redirect('/login'); next(); });
  const audit = opts.audit || (() => {});
  const user = (req) => req.session?.user || {};
  const tid = (req) => req.session?.user?.tenant_id || 0;

  // ─── Color palette ───
  const C = {
    primary: '#4f46e5', primaryLight: '#818cf8', primaryDark: '#3730a3',
    gold: '#f59e0b', goldLight: '#fbbf24', goldDark: '#d97706',
    purple: '#8b5cf6', purpleLight: '#a78bfa', purpleDark: '#7c3aed',
    green: '#10b981', greenLight: '#34d399', greenDark: '#059669',
    red: '#ef4444', redLight: '#f87171',
    gray50: '#f9fafb', gray100: '#f3f4f6', gray200: '#e5e7eb', gray300: '#d1d5db',
    gray500: '#6b7280', gray700: '#374151', gray900: '#111827',
    white: '#ffffff',
    bronze: '#cd7f32', silver: '#c0c0c0',
  };

  // ─── Level thresholds ───
  const LEVEL_THRESHOLDS = [
    { level: 1, min: 0, max: 99, title: 'Beginner', color: C.gray500 },
    { level: 2, min: 100, max: 299, title: 'Learner', color: C.green },
    { level: 3, min: 300, max: 599, title: 'Achiever', color: C.primary },
    { level: 4, min: 600, max: 999, title: 'Scholar', color: C.purple },
    { level: 5, min: 1000, max: 1499, title: 'Star', color: C.gold },
    { level: 6, min: 1500, max: 2199, title: 'Champion', color: C.goldDark },
    { level: 7, min: 2200, max: 2999, title: 'Legend', color: C.primaryDark },
    { level: 8, min: 3000, max: 4499, title: 'Master', color: C.purpleDark },
    { level: 9, min: 4500, max: 6999, title: 'Grandmaster', color: C.red },
    { level: 10, min: 7000, max: Infinity, title: 'Supreme', color: '#f59e0b' },
  ];

  // ─── Pre-defined badges ───
  const DEFAULT_BADGES = [
    { badge_key: 'perfect_attendance', badge_name: 'Perfect Attendance', description: 'Attended all classes for 30 consecutive days', icon_emoji: '📅', category: 'attendance', tier: 'bronze', points_required: 50 },
    { badge_key: 'perfect_attendance_silver', badge_name: 'Perfect Attendance Silver', description: 'Attended all classes for 60 consecutive days', icon_emoji: '📅', category: 'attendance', tier: 'silver', points_required: 150 },
    { badge_key: 'perfect_attendance_gold', badge_name: 'Perfect Attendance Gold', description: 'Attended all classes for 100 consecutive days', icon_emoji: '🗓️', category: 'attendance', tier: 'gold', points_required: 300 },
    { badge_key: 'top_scorer', badge_name: 'Top Scorer', description: 'Scored the highest in a class exam', icon_emoji: '🏆', category: 'academic', tier: 'bronze', points_required: 100 },
    { badge_key: 'top_scorer_gold', badge_name: 'Top Scorer Gold', description: 'Scored highest across all sections in an exam', icon_emoji: '🥇', category: 'academic', tier: 'gold', points_required: 500 },
    { badge_key: 'bookworm', badge_name: 'Bookworm', description: 'Read and reviewed 10 books from the library', icon_emoji: '📚', category: 'reading', tier: 'bronze', points_required: 80 },
    { badge_key: 'bookworm_gold', badge_name: 'Bookworm Gold', description: 'Read and reviewed 30 books from the library', icon_emoji: '📖', category: 'reading', tier: 'gold', points_required: 250 },
    { badge_key: 'sports_star', badge_name: 'Sports Star', description: 'Participated in 5 inter-school sports events', icon_emoji: '⭐', category: 'sports', tier: 'bronze', points_required: 120 },
    { badge_key: 'sports_champion', badge_name: 'Sports Champion', description: 'Won first place in a school sports event', icon_emoji: '🏅', category: 'sports', tier: 'gold', points_required: 400 },
    { badge_key: 'kind_heart', badge_name: 'Kind Heart', description: 'Recognized for helping peers 10 times', icon_emoji: '💗', category: 'behavior', tier: 'bronze', points_required: 70 },
    { badge_key: 'kind_heart_gold', badge_name: 'Kind Heart Gold', description: 'Recognized for helping peers 30 times', icon_emoji: '💖', category: 'behavior', tier: 'gold', points_required: 200 },
    { badge_key: 'science_genius', badge_name: 'Science Genius', description: 'Achieved 95%+ in 3 science exams', icon_emoji: '🔬', category: 'academic', tier: 'bronze', points_required: 180 },
    { badge_key: 'science_genius_gold', badge_name: 'Science Genius Gold', description: 'Achieved 95%+ in 6 science exams', icon_emoji: '🧬', category: 'academic', tier: 'gold', points_required: 450 },
    { badge_key: 'math_wizard', badge_name: 'Math Wizard', description: 'Achieved 95%+ in 3 math exams', icon_emoji: '🔢', category: 'academic', tier: 'bronze', points_required: 180 },
    { badge_key: 'math_wizard_gold', badge_name: 'Math Wizard Gold', description: 'Achieved 95%+ in 6 math exams', icon_emoji: '🧮', category: 'academic', tier: 'gold', points_required: 450 },
    { badge_key: 'team_player', badge_name: 'Team Player', description: 'Participated in 5 group projects successfully', icon_emoji: '🤝', category: 'collaboration', tier: 'bronze', points_required: 90 },
    { badge_key: 'team_player_gold', badge_name: 'Team Player Gold', description: 'Led 3 group projects to excellence', icon_emoji: '👥', category: 'collaboration', tier: 'gold', points_required: 300 },
    { badge_key: 'leadership', badge_name: 'Leadership', description: 'Served as class representative for one term', icon_emoji: '👑', category: 'leadership', tier: 'bronze', points_required: 150 },
    { badge_key: 'leadership_gold', badge_name: 'Leadership Gold', description: 'Served as school prefect for one term', icon_emoji: '🌟', category: 'leadership', tier: 'gold', points_required: 500 },
    { badge_key: 'creative_mind', badge_name: 'Creative Mind', description: 'Submitted 5 original creative works', icon_emoji: '🎨', category: 'creativity', tier: 'bronze', points_required: 100 },
    { badge_key: 'creative_mind_gold', badge_name: 'Creative Mind Gold', description: 'Won an art or writing competition', icon_emoji: '🖌️', category: 'creativity', tier: 'gold', points_required: 350 },
  ];

  // ─── Point sources ───
  const POINT_SOURCES = {
    attendance_streak: { label: 'Attendance Streak', defaultPoints: 10 },
    homework_submission: { label: 'Homework Submission', defaultPoints: 5 },
    exam_improvement: { label: 'Exam Improvement', defaultPoints: 15 },
    helping_others: { label: 'Helping Others', defaultPoints: 8 },
    sports: { label: 'Sports Participation', defaultPoints: 12 },
    clubs: { label: 'Club Participation', defaultPoints: 10 },
    reading_books: { label: 'Reading Books', defaultPoints: 7 },
    perfect_behavior: { label: 'Perfect Behavior', defaultPoints: 5 },
    admin_award: { label: 'Admin Award', defaultPoints: 0 },
    streak_bonus: { label: 'Streak Multiplier Bonus', defaultPoints: 0 },
  };

  // ─── Reward items ───
  const DEFAULT_REWARDS = [
    { name: 'Extra Break Time (10 min)', description: 'Enjoy an additional 10 minutes of break time', point_cost: 50, quantity_available: -1 },
    { name: 'Pick Your Seat', description: 'Choose your preferred seat for one week', point_cost: 75, quantity_available: -1 },
    { name: 'Homework Pass', description: 'Skip one homework assignment', point_cost: 100, quantity_available: 5 },
    { name: 'Cafeteria Treat', description: 'Get a free treat from the cafeteria', point_cost: 60, quantity_available: -1 },
    { name: 'School Supplies Pack', description: 'Receive a premium school supplies kit', point_cost: 200, quantity_available: 10 },
    { name: 'Library Priority', description: 'Get priority access to new library books for a week', point_cost: 80, quantity_available: -1 },
    { name: 'Dress Down Day Pass', description: 'Wear casual clothes on a uniform day', point_cost: 120, quantity_available: -1 },
    { name: 'Movie Afternoon Pass', description: 'Join the special movie afternoon event', point_cost: 150, quantity_available: 20 },
  ];

  // ─── Helpers ───
  function getLevel(totalPoints) {
    for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
      if (totalPoints >= LEVEL_THRESHOLDS[i].min) return LEVEL_THRESHOLDS[i];
    }
    return LEVEL_THRESHOLDS[0];
  }

  function getNextLevel(totalPoints) {
    for (const lt of LEVEL_THRESHOLDS) {
      if (totalPoints < lt.min) return lt;
    }
    return null;
  }

  function svgProgressBar(percent, w, h, color, bgColor) {
    const pct = Math.min(100, Math.max(0, percent));
    const r = h / 2;
    return `<svg width="${w}" height="${h}" role="progressbar" aria-valuenow="${Math.round(pct)}" aria-valuemin="0" aria-valuemax="100" aria-label="Progress: ${Math.round(pct)}%">` +
      `<rect x="0" y="0" width="${w}" height="${h}" rx="${r}" ry="${r}" fill="${bgColor || C.gray200}"/>` +
      `<rect x="0" y="0" width="${pct * w / 100}" height="${h}" rx="${r}" ry="${r}" fill="${color || C.primary}"/>` +
      `<text x="${w/2}" y="${h/2+4}" text-anchor="middle" font-size="11" font-weight="600" fill="${C.white}">${Math.round(pct)}%</text></svg>`;
  }

  function svgRankBadge(rank, size) {
    const colors = [C.gold, C.silver, C.bronze, C.primary, C.gray500];
    const c = colors[Math.min(rank - 1, colors.length - 1)];
    const cx = size / 2, cy = size / 2, r = size / 2 - 2;
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="Rank ${rank}">` +
      `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${c}" stroke="${C.white}" stroke-width="2"/>` +
      `<text x="${cx}" y="${cy+5}" text-anchor="middle" font-size="${size*0.4}" font-weight="700" fill="${C.white}">#${rank}</text></svg>`;
  }

  function tierColor(tier) {
    if (tier === 'gold') return C.gold;
    if (tier === 'silver') return C.silver;
    return C.bronze;
  }

  function tierLabel(tier) {
    if (tier === 'gold') return '🥇 Gold';
    if (tier === 'silver') return '🥈 Silver';
    return '🥉 Bronze';
  }

  function navTabs(active) {
    const tabs = [
      { href: '/school/gamification', label: '🏆 Dashboard', id: 'dashboard' },
      { href: '/school/gamification/badges', label: '🎖️ Badges', id: 'badges' },
      { href: '/school/gamification/levels', label: '📊 Levels', id: 'levels' },
      { href: '/school/gamification/store', label: '🎁 Rewards Store', id: 'store' },
      { href: '/school/gamification/streaks', label: '🔥 Streaks', id: 'streaks' },
    ];
    return `<nav style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:24px;border-bottom:2px solid ${C.gray200};padding-bottom:8px;" aria-label="Gamification navigation">` +
      tabs.map(t => `<a href="${t.href}" style="padding:10px 18px;border-radius:8px 8px 0 0;text-decoration:none;font-weight:600;font-size:14px;color:${t.id===active?C.white:C.gray700};background:${t.id===active?C.primary:C.gray100};transition:background 0.2s;" ${t.id===active?'aria-current="page"':''}>${t.label}</a>`).join('') +
      `</nav>`;
  }

  function card(title, body, accentColor) {
    const ac = accentColor || C.primary;
    return `<div style="background:${C.white};border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.1);overflow:hidden;margin-bottom:20px;">` +
      `<div style="background:${ac};padding:16px 20px;"><h3 style="margin:0;color:${C.white};font-size:16px;font-weight:600;">${title}</h3></div>` +
      `<div style="padding:20px;">${body}</div></div>`;
  }

  function statBox(value, label, color) {
    const c = color || C.primary;
    return `<div style="text-align:center;min-width:140px;padding:20px;background:${C.gray50};border-radius:12px;border:2px solid ${c}20;">` +
      `<div style="font-size:32px;font-weight:700;color:${c};line-height:1.2;">${value}</div>` +
      `<div style="font-size:13px;color:${C.gray500};margin-top:4px;">${label}</div></div>`;
  }

  // ─── Database tables ───
  (async () => {
    const ensure = async (name, sql) => {
      try { await pool.query(sql); } catch(e) { /* may already exist */ }
      // Create index hints
    };

    await ensure('gamification_points', `
      CREATE TABLE IF NOT EXISTS gamification_points (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 0,
        student_id INTEGER NOT NULL,
        points INTEGER NOT NULL,
        source VARCHAR(100) NOT NULL DEFAULT 'admin_award',
        description TEXT,
        awarded_by INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS gp_tenant ON gamification_points(tenant_id);
      CREATE INDEX IF NOT EXISTS gp_student ON gamification_points(student_id);
      CREATE INDEX IF NOT EXISTS gp_created ON gamification_points(created_at DESC);
    `);

    await ensure('gamification_badges', `
      CREATE TABLE IF NOT EXISTS gamification_badges (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 0,
        badge_key VARCHAR(200) NOT NULL,
        badge_name VARCHAR(200) NOT NULL,
        description TEXT,
        icon_emoji VARCHAR(10) DEFAULT '🏅',
        category VARCHAR(100),
        tier VARCHAR(20) DEFAULT 'bronze',
        points_required INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tenant_id, badge_key)
      );
      CREATE INDEX IF NOT EXISTS gb_tenant ON gamification_badges(tenant_id);
    `);

    await ensure('gamification_earned_badges', `
      CREATE TABLE IF NOT EXISTS gamification_earned_badges (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 0,
        student_id INTEGER NOT NULL,
        badge_id INTEGER NOT NULL REFERENCES gamification_badges(id),
        earned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        points_at_earning INTEGER DEFAULT 0,
        UNIQUE(tenant_id, student_id, badge_id)
      );
      CREATE INDEX IF NOT EXISTS geb_tenant ON gamification_earned_badges(tenant_id);
      CREATE INDEX IF NOT EXISTS geb_student ON gamification_earned_badges(student_id);
    `);

    await ensure('gamification_rewards', `
      CREATE TABLE IF NOT EXISTS gamification_rewards (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 0,
        name VARCHAR(300) NOT NULL,
        description TEXT,
        point_cost INTEGER NOT NULL DEFAULT 50,
        quantity_available INTEGER DEFAULT -1,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS gr_tenant ON gamification_rewards(tenant_id);
    `);

    await ensure('gamification_redemptions', `
      CREATE TABLE IF NOT EXISTS gamification_redemptions (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 0,
        student_id INTEGER NOT NULL,
        reward_id INTEGER NOT NULL REFERENCES gamification_rewards(id),
        points_spent INTEGER NOT NULL,
        redeemed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS grd_tenant ON gamification_redemptions(tenant_id);
      CREATE INDEX IF NOT EXISTS grd_student ON gamification_redemptions(student_id);
    `);

    await ensure('gamification_streaks', `
      CREATE TABLE IF NOT EXISTS gamification_streaks (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 0,
        student_id INTEGER NOT NULL,
        streak_type VARCHAR(50) NOT NULL,
        current_streak INTEGER DEFAULT 0,
        longest_streak INTEGER DEFAULT 0,
        last_activity_date DATE,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tenant_id, student_id, streak_type)
      );
      CREATE INDEX IF NOT EXISTS gs_tenant ON gamification_streaks(tenant_id);
      CREATE INDEX IF NOT EXISTS gs_student ON gamification_streaks(student_id);
    `);
  })();

  // ─── Seed default badges & rewards for a tenant ───
  async function seedDefaults(tenantId) {
    for (const b of DEFAULT_BADGES) {
      await pool.query(
        `INSERT INTO gamification_badges (tenant_id, badge_key, badge_name, description, icon_emoji, category, tier, points_required)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (tenant_id, badge_key) DO NOTHING`,
        [tenantId, b.badge_key, b.badge_name, b.description, b.icon_emoji, b.category, b.tier, b.points_required]
      );
    }
    const existingRewards = await pool.query(`SELECT COUNT(*) as c FROM gamification_rewards WHERE tenant_id=$1`, [tenantId]);
    if (parseInt(existingRewards.rows[0].c) === 0) {
      for (const r of DEFAULT_REWARDS) {
        await pool.query(
          `INSERT INTO gamification_rewards (tenant_id, name, description, point_cost, quantity_available) VALUES ($1,$2,$3,$4,$5)`,
          [tenantId, r.name, r.description, r.point_cost, r.quantity_available]
        );
      }
    }
  }

  // ─── Award points helper ───
  async function awardPoints(tenantId, studentId, points, source, description, awardedBy) {
    const pts = Math.round(points);
    if (pts === 0) return;
    const res = await pool.query(
      `INSERT INTO gamification_points (tenant_id, student_id, points, source, description, awarded_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, created_at`,
      [tenantId, studentId, pts, source, description || '', awardedBy || null]
    );
    // Check for badge unlocks
    await checkBadgeUnlocks(tenantId, studentId);
    return res.rows[0];
  }

  // ─── Check & award badges ───
  async function checkBadgeUnlocks(tenantId, studentId) {
    const ptsRes = await pool.query(
      `SELECT COALESCE(SUM(points),0) as total FROM gamification_points WHERE tenant_id=$1 AND student_id=$2`,
      [tenantId, studentId]
    );
    const totalPts = parseInt(ptsRes.rows[0].total) || 0;
    const badges = await pool.query(
      `SELECT * FROM gamification_badges WHERE tenant_id=$1 AND points_required > 0 ORDER BY points_required`,
      [tenantId]
    );
    for (const b of badges.rows) {
      if (totalPts >= b.points_required) {
        const existing = await pool.query(
          `SELECT id FROM gamification_earned_badges WHERE tenant_id=$1 AND student_id=$2 AND badge_id=$3`,
          [tenantId, studentId, b.id]
        );
        if (existing.rows.length === 0) {
          await pool.query(
            `INSERT INTO gamification_earned_badges (tenant_id, student_id, badge_id, points_at_earning) VALUES ($1,$2,$3,$4)`,
            [tenantId, studentId, b.id, totalPts]
          );
        }
      }
    }
  }

  // ─── Get student summary ───
  async function getStudentSummary(tenantId, studentId) {
    const ptsRes = await pool.query(
      `SELECT COALESCE(SUM(points),0) as total_points FROM gamification_points WHERE tenant_id=$1 AND student_id=$2`,
      [tenantId, studentId]
    );
    const totalPoints = parseInt(ptsRes.rows[0].total_points) || 0;
    const level = getLevel(totalPoints);
    const nextLvl = getNextLevel(totalPoints);
    const progressPct = nextLvl
      ? ((totalPoints - level.min) / (nextLvl.min - level.min)) * 100
      : 100;
    const badgeCount = await pool.query(
      `SELECT COUNT(*) as c FROM gamification_earned_badges WHERE tenant_id=$1 AND student_id=$2`,
      [tenantId, studentId]
    );
    const streaks = await pool.query(
      `SELECT streak_type, current_streak, longest_streak, last_activity_date FROM gamification_streaks WHERE tenant_id=$1 AND student_id=$2`,
      [tenantId, studentId]
    );
    return {
      totalPoints, level, nextLevel: nextLvl, progressPct,
      badgesEarned: parseInt(badgeCount.rows[0].c) || 0,
      streaks: streaks.rows
    };
  }

  // ═══════════════════════════════════════════════════════
  // ROUTE 1: Dashboard — /school/gamification
  // ═══════════════════════════════════════════════════════
  app.get('/school/gamification', requireAuth, ah(async (req, res) => {
    const tenantId = tid(req);
    await seedDefaults(tenantId);
    const currentUser = user(req);
    const studentId = req.query.student_id || currentUser.id;
    const summary = await getStudentSummary(tenantId, studentId);

    // School-wide leaderboard (top 20)
    const leaderboard = await pool.query(
      `SELECT p.student_id, u.name as student_name, u.class_name,
              COALESCE(SUM(p.points),0) as total_points
       FROM gamification_points p
       LEFT JOIN users u ON u.id = p.student_id AND u.tenant_id = p.tenant_id
       WHERE p.tenant_id = $1
       GROUP BY p.student_id, u.name, u.class_name
       ORDER BY total_points DESC LIMIT 20`,
      [tenantId]
    );

    // Recent point history
    const history = await pool.query(
      `SELECT p.points, p.source, p.description, p.created_at, u.name as awarded_by_name
       FROM gamification_points p
       LEFT JOIN users u ON u.id = p.awarded_by
       WHERE p.tenant_id = $1 AND p.student_id = $2
       ORDER BY p.created_at DESC LIMIT 15`,
      [tenantId, studentId]
    );

    // Class leaderboard if class is known
    let classLeaderboard = [];
    if (currentUser.class_name) {
      classLeaderboard = await pool.query(
        `SELECT p.student_id, u.name as student_name,
                COALESCE(SUM(p.points),0) as total_points
         FROM gamification_points p
         LEFT JOIN users u ON u.id = p.student_id AND u.tenant_id = p.tenant_id
         WHERE p.tenant_id = $1 AND u.class_name = $2
         GROUP BY p.student_id, u.name
         ORDER BY total_points DESC LIMIT 10`,
        [tenantId, currentUser.class_name]
      );
    }

    // Streaks for student
    const streaks = await pool.query(
      `SELECT * FROM gamification_streaks WHERE tenant_id=$1 AND student_id=$2`,
      [tenantId, studentId]
    );

    let content = navTabs('dashboard');

    // Summary stats
    content += `<div style="display:flex;flex-wrap:wrap;gap:16px;margin-bottom:24px;">`;
    content += statBox(summary.totalPoints, 'Total Points', C.primary);
    content += statBox(`Lv.${summary.level.level} ${summary.level.title}`, 'Current Level', C.purple);
    content += statBox(summary.badgesEarned, 'Badges Earned', C.gold);
    const maxStreak = streaks.rows.reduce((m, s) => Math.max(m, s.longest_streak || 0), 0);
    content += statBox(maxStreak + ' days', 'Best Streak', C.gold);
    content += `</div>`;

    // Level progress
    if (summary.nextLevel) {
      content += card(`Level ${summary.level.level} → Level ${summary.nextLevel.level}`,
        `<p style="margin:0 0 12px;color:${C.gray700};">You need <strong>${summary.nextLevel.min - summary.totalPoints}</strong> more points to reach <strong>${summary.nextLevel.title}</strong></p>` +
        svgProgressBar(summary.progressPct, 400, 28, C.primary, C.gray200),
        C.primary
      );
    } else {
      content += card('Maximum Level Reached! 🎉',
        `<p style="margin:0;color:${C.gray700};">Congratulations! You have reached the highest level. You are a <strong>Supreme</strong> achiever!</p>`,
        C.gold
      );
    }

    // School-wide leaderboard
    let lbRows = leaderboard.rows.map((r, i) => {
      const isMe = String(r.student_id) === String(studentId);
      const bg = isMe ? `background:${C.primary}10;border-left:4px solid ${C.primary};` : '';
      return `<tr style="${bg}">` +
        `<td style="padding:10px 12px;">${svgRankBadge(i + 1, 36)}</td>` +
        `<td style="padding:10px 12px;font-weight:${isMe ? '700' : '400'};">${esc(r.student_name || 'Student #' + r.student_id)}</td>` +
        `<td style="padding:10px 12px;color:${C.gray500};">${esc(r.class_name || '—')}</td>` +
        `<td style="padding:10px 12px;text-align:right;font-weight:700;color:${C.primary};">${parseInt(r.total_points).toLocaleString()}</td>` +
        `</tr>`;
    }).join('');

    content += card('🏆 School-Wide Leaderboard',
      `<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;">` +
      `<thead><tr style="background:${C.gray50};"><th style="padding:10px 12px;text-align:left;">Rank</th><th style="padding:10px 12px;text-align:left;">Student</th><th style="padding:10px 12px;text-align:left;">Class</th><th style="padding:10px 12px;text-align:right;">Points</th></tr></thead>` +
      `<tbody>${lbRows}</tbody></table></div>`,
      C.primary
    );

    // Class leaderboard
    if (classLeaderboard.rows.length > 1) {
      let clbRows = classLeaderboard.rows.map((r, i) => {
        const isMe = String(r.student_id) === String(studentId);
        const bg = isMe ? `background:${C.purple}10;border-left:4px solid ${C.purple};` : '';
        return `<tr style="${bg}">` +
          `<td style="padding:8px 10px;">${svgRankBadge(i + 1, 30)}</td>` +
          `<td style="padding:8px 10px;font-weight:${isMe ? '700' : '400'};">${esc(r.student_name || 'Student')}</td>` +
          `<td style="padding:8px 10px;text-align:right;font-weight:600;color:${C.purple};">${parseInt(r.total_points).toLocaleString()}</td></tr>`;
      }).join('');
      content += card('📋 Class Leaderboard',
        `<table style="width:100%;border-collapse:collapse;"><tbody>${clbRows}</tbody></table>`,
        C.purple
      );
    }

    // Point history
    let histRows = history.rows.map(h => {
      const sourceInfo = POINT_SOURCES[h.source] || { label: h.source };
      const isPositive = parseInt(h.points) > 0;
      return `<tr>` +
        `<td style="padding:8px 10px;color:${isPositive ? C.greenDark : C.red};font-weight:700;">${isPositive ? '+' : ''}${parseInt(h.points)}</td>` +
        `<td style="padding:8px 10px;">${esc(sourceInfo.label)}</td>` +
        `<td style="padding:8px 10px;color:${C.gray500};">${esc(h.description || '—')}</td>` +
        `<td style="padding:8px 10px;color:${C.gray500};font-size:12px;">${h.created_at ? new Date(h.created_at).toLocaleDateString() : ''}</td>` +
        `</tr>`;
    }).join('');

    content += card('📜 Recent Point History',
      `<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;">` +
      `<thead><tr style="background:${C.gray50};"><th style="padding:8px 10px;text-align:left;">Points</th><th style="padding:8px 10px;text-align:left;">Source</th><th style="padding:8px 10px;text-align:left;">Description</th><th style="padding:8px 10px;text-align:left;">Date</th></tr></thead>` +
      `<tbody>${histRows}</tbody></table></div>`,
      C.greenDark
    );

    // Admin section: award points
    if (currentUser.role === 'admin' || currentUser.role === 'teacher') {
      content += card('⚙️ Admin: Award Points',
        `<form method="POST" action="/school/gamification/award" style="display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;">` +
        `<div><label style="display:block;font-size:13px;font-weight:600;margin-bottom:4px;color:${C.gray700};">Student ID</label><input type="number" name="student_id" required style="padding:8px 12px;border:1px solid ${C.gray300};border-radius:8px;width:120px;" /></div>` +
        `<div><label style="display:block;font-size:13px;font-weight:600;margin-bottom:4px;color:${C.gray700};">Points</label><input type="number" name="points" required style="padding:8px 12px;border:1px solid ${C.gray300};border-radius:8px;width:100px;" /></div>` +
        `<div><label style="display:block;font-size:13px;font-weight:600;margin-bottom:4px;color:${C.gray700};">Source</label><select name="source" style="padding:8px 12px;border:1px solid ${C.gray300};border-radius:8px;">` +
        Object.entries(POINT_SOURCES).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('') +
        `</select></div>` +
        `<div><label style="display:block;font-size:13px;font-weight:600;margin-bottom:4px;color:${C.gray700};">Description</label><input type="text" name="description" style="padding:8px 12px;border:1px solid ${C.gray300};border-radius:8px;width:220px;" placeholder="Reason for award..." /></div>` +
        `<button type="submit" style="padding:8px 20px;background:${C.primary};color:${C.white};border:none;border-radius:8px;font-weight:600;cursor:pointer;">Award</button>` +
        `</form>`,
        C.primaryDark
      );
    }

    res.send(renderPage('Gamification Dashboard', content, currentUser));
  }));

  // POST: Award points
  app.post('/school/gamification/award', requireAuth, ah(async (req, res) => {
    const tenantId = tid(req);
    const currentUser = user(req);
    if (currentUser.role !== 'admin' && currentUser.role !== 'teacher') {
      return res.status(403).send('Forbidden');
    }
    const { student_id, points, source, description } = req.body;
    if (!student_id || points === undefined || isNaN(points)) {
      return res.status(400).send('Missing student_id or points');
    }
    await awardPoints(tenantId, parseInt(student_id), parseInt(points), source || 'admin_award', description, currentUser.id);
    audit('gamification_award', { tenantId, studentId: parseInt(student_id), points: parseInt(points), source, by: currentUser.id });
    res.redirect('/school/gamification');
  }));

  // ═══════════════════════════════════════════════════════
  // ROUTE 2: Badges — /school/gamification/badges
  // ═══════════════════════════════════════════════════════
  app.get('/school/gamification/badges', requireAuth, ah(async (req, res) => {
    const tenantId = tid(req);
    const currentUser = user(req);
    await seedDefaults(tenantId);
    const studentId = req.query.student_id || currentUser.id;

    const allBadges = await pool.query(
      `SELECT b.*, CASE WHEN eb.id IS NOT NULL THEN TRUE ELSE FALSE END as earned,
              eb.earned_at, eb.points_at_earning
       FROM gamification_badges b
       LEFT JOIN gamification_earned_badges eb ON eb.badge_id = b.id AND eb.student_id = $2 AND eb.tenant_id = $1
       WHERE b.tenant_id = $1
       ORDER BY b.category, b.tier, b.points_required`,
      [tenantId, studentId]
    );

    const earned = allBadges.rows.filter(b => b.earned);
    const notEarned = allBadges.rows.filter(b => !b.earned);

    // Group earned badges by category
    const categories = {};
    for (const b of earned) {
      if (!categories[b.category]) categories[b.category] = [];
      categories[b.category].push(b);
    }
    // Also group not earned
    const notEarnedByCategory = {};
    for (const b of notEarned) {
      if (!notEarnedByCategory[b.category]) notEarnedByCategory[b.category] = [];
      notEarnedByCategory[b.category].push(b);
    }

    let content = navTabs('badges');

    // Badges summary
    content += `<div style="display:flex;flex-wrap:wrap;gap:16px;margin-bottom:24px;">`;
    content += statBox(earned.length, 'Badges Earned', C.gold);
    content += statBox(notEarned.length, 'Badges Available', C.gray500);
    const goldCount = earned.filter(b => b.tier === 'gold').length;
    const silverCount = earned.filter(b => b.tier === 'silver').length;
    const bronzeCount = earned.filter(b => b.tier === 'bronze').length;
    content += statBox(`🥇${goldCount} 🥈${silverCount} 🥉${bronzeCount}`, 'By Tier', C.purple);
    content += `</div>`;

    // Badge progression bar
    const totalBadges = allBadges.rows.length;
    const pct = totalBadges > 0 ? (earned.length / totalBadges) * 100 : 0;
    content += card('🎖️ Badge Collection Progress',
      svgProgressBar(pct, 500, 32, C.purple, C.gray200) +
      `<p style="margin:10px 0 0;color:${C.gray500};font-size:13px;">${earned.length} of ${totalBadges} badges collected</p>`,
      C.purple
    );

    // Earned badges showcase
    function renderBadgeGrid(badges, showEarned) {
      if (badges.length === 0) return `<p style="color:${C.gray500};font-style:italic;">No badges ${showEarned ? 'earned yet' : 'in this category'}.</p>`;
      return `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px;">` +
        badges.map(b => {
          const tc = tierColor(b.tier);
          const opacity = showEarned ? '1' : '0.5';
          return `<div style="background:${C.gray50};border-radius:12px;padding:20px;text-align:center;border:2px solid ${tc};opacity:${opacity};transition:transform 0.2s;" ` +
            (showEarned ? `title="Earned on ${b.earned_at ? new Date(b.earned_at).toLocaleDateString() : 'Unknown'}"` : `title="Requires ${b.points_required} points"`) +
            `>` +
            `<div style="font-size:48px;margin-bottom:8px;" role="img" aria-label="${esc(b.badge_name)}">${esc(b.icon_emoji)}</div>` +
            `<div style="font-weight:700;color:${C.gray900};font-size:14px;margin-bottom:4px;">${esc(b.badge_name)}</div>` +
            `<div style="font-size:12px;color:${C.gray500};margin-bottom:8px;">${esc(b.description)}</div>` +
            `<span style="display:inline-block;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:600;background:${tc}20;color:${tc};">${tierLabel(b.tier)}</span>` +
            (showEarned && b.earned_at ? `<div style="font-size:11px;color:${C.gray500};margin-top:6px;">Earned ${new Date(b.earned_at).toLocaleDateString()}</div>` : '') +
            `</div>`;
        }).join('') + `</div>`;
    }

    content += card('🏆 Earned Badges', renderBadgeGrid(earned, true), C.gold);

    // Available badges by category
    for (const [cat, badges] of Object.entries(notEarnedByCategory)) {
      content += card(`${cat.charAt(0).toUpperCase() + cat.slice(1)} — Available Badges`,
        renderBadgeGrid(badges, false),
        C.gray500
      );
    }

    // Admin: Create custom badge
    if (currentUser.role === 'admin' || currentUser.role === 'teacher') {
      content += card('✨ Admin: Create Custom Badge',
        `<form method="POST" action="/school/gamification/badges/create" style="display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;">` +
        `<div><label style="display:block;font-size:13px;font-weight:600;margin-bottom:4px;color:${C.gray700};">Badge Name</label><input type="text" name="badge_name" required style="padding:8px 12px;border:1px solid ${C.gray300};border-radius:8px;width:180px;" /></div>` +
        `<div><label style="display:block;font-size:13px;font-weight:600;margin-bottom:4px;color:${C.gray700};">Key</label><input type="text" name="badge_key" required style="padding:8px 12px;border:1px solid ${C.gray300};border-radius:8px;width:160px;" placeholder="custom_badge_1" /></div>` +
        `<div><label style="display:block;font-size:13px;font-weight:600;margin-bottom:4px;color:${C.gray700};">Emoji</label><input type="text" name="icon_emoji" maxlength="10" style="padding:8px 12px;border:1px solid ${C.gray300};border-radius:8px;width:60px;" value="🎖️" /></div>` +
        `<div><label style="display:block;font-size:13px;font-weight:600;margin-bottom:4px;color:${C.gray700};">Category</label><input type="text" name="category" style="padding:8px 12px;border:1px solid ${C.gray300};border-radius:8px;width:120px;" placeholder="special" /></div>` +
        `<div><label style="display:block;font-size:13px;font-weight:600;margin-bottom:4px;color:${C.gray700};">Tier</label><select name="tier" style="padding:8px 12px;border:1px solid ${C.gray300};border-radius:8px;"><option value="bronze">Bronze</option><option value="silver">Silver</option><option value="gold">Gold</option></select></div>` +
        `<div><label style="display:block;font-size:13px;font-weight:600;margin-bottom:4px;color:${C.gray700};">Points Required</label><input type="number" name="points_required" required style="padding:8px 12px;border:1px solid ${C.gray300};border-radius:8px;width:100px;" value="100" /></div>` +
        `<div><label style="display:block;font-size:13px;font-weight:600;margin-bottom:4px;color:${C.gray700};">Description</label><input type="text" name="description" style="padding:8px 12px;border:1px solid ${C.gray300};border-radius:8px;width:220px;" /></div>` +
        `<button type="submit" style="padding:8px 20px;background:${C.purple};color:${C.white};border:none;border-radius:8px;font-weight:600;cursor:pointer;">Create Badge</button>` +
        `</form>`,
        C.purpleDark
      );
    }

    res.send(renderPage('Badges', content, currentUser));
  }));

  // POST: Create custom badge
  app.post('/school/gamification/badges/create', requireAuth, ah(async (req, res) => {
    const tenantId = tid(req);
    const currentUser = user(req);
    if (currentUser.role !== 'admin' && currentUser.role !== 'teacher') {
      return res.status(403).send('Forbidden');
    }
    const { badge_name, badge_key, icon_emoji, category, tier, points_required, description } = req.body;
    if (!badge_name || !badge_key) return res.status(400).send('Badge name and key are required');
    await pool.query(
      `INSERT INTO gamification_badges (tenant_id, badge_key, badge_name, description, icon_emoji, category, tier, points_required)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (tenant_id, badge_key) DO NOTHING`,
      [tenantId, badge_key, badge_name, description || '', icon_emoji || '🏅', category || 'special', tier || 'bronze', parseInt(points_required) || 0]
    );
    audit('gamification_badge_create', { tenantId, badge_key, badge_name, by: currentUser.id });
    res.redirect('/school/gamification/badges');
  }));

  // ═══════════════════════════════════════════════════════
  // ROUTE 3: Levels — /school/gamification/levels
  // ═══════════════════════════════════════════════════════
  app.get('/school/gamification/levels', requireAuth, ah(async (req, res) => {
    const tenantId = tid(req);
    const currentUser = user(req);
    const studentId = req.query.student_id || currentUser.id;
    const summary = await getStudentSummary(tenantId, studentId);

    // Count students at each level
    const levelDist = await pool.query(
      `SELECT lv.level, COUNT(*) as student_count FROM (
        SELECT p.student_id,
          CASE
            WHEN SUM(p.points) >= 7000 THEN 10
            WHEN SUM(p.points) >= 4500 THEN 9
            WHEN SUM(p.points) >= 3000 THEN 8
            WHEN SUM(p.points) >= 2200 THEN 7
            WHEN SUM(p.points) >= 1500 THEN 6
            WHEN SUM(p.points) >= 1000 THEN 5
            WHEN SUM(p.points) >= 600 THEN 4
            WHEN SUM(p.points) >= 300 THEN 3
            WHEN SUM(p.points) >= 100 THEN 2
            ELSE 1
          END as level
        FROM gamification_points p
        WHERE p.tenant_id = $1
        GROUP BY p.student_id
      ) lv GROUP BY lv.level ORDER BY lv.level`,
      [tenantId]
    );
    const distMap = {};
    for (const r of levelDist.rows) distMap[r.level] = parseInt(r.student_count);

    let content = navTabs('levels');

    // Student level card
    content += `<div style="background:linear-gradient(135deg,${summary.level.color},${summary.level.color}cc);border-radius:16px;padding:32px;color:${C.white};margin-bottom:24px;text-align:center;">` +
      `<div style="font-size:20px;font-weight:300;opacity:0.9;">Current Level</div>` +
      `<div style="font-size:72px;font-weight:800;line-height:1.1;">${summary.level.level}</div>` +
      `<div style="font-size:22px;font-weight:600;margin-bottom:8px;">${summary.level.title}</div>` +
      `<div style="font-size:16px;opacity:0.9;">${summary.totalPoints.toLocaleString()} Points</div>` +
      (summary.nextLevel
        ? `<div style="margin-top:16px;">${svgProgressBar(summary.progressPct, 400, 28, C.white, 'rgba(255,255,255,0.3)')}</div>` +
          `<p style="margin:8px 0 0;font-size:14px;opacity:0.85;">${summary.nextLevel.min - summary.totalPoints} points to Level ${summary.nextLevel.level} (${summary.nextLevel.title})</p>`
        : `<p style="margin-top:12px;font-size:16px;font-weight:600;">🎉 Maximum Level Reached!</p>`)
      + `</div>`;

    // Level benefits
    const benefits = [
      'Access to exclusive rewards',
      'Priority in school events',
      'Custom profile badge',
      'Mentorship opportunities',
      'Special library privileges',
      'Leadership nominations',
    ];
    content += card(`Level ${summary.level.level} Benefits`,
      `<ul style="margin:0;padding-left:20px;color:${C.gray700};">` +
      benefits.map(b => `<li style="padding:6px 0;border-bottom:1px solid ${C.gray200};">${b}</li>`).join('') +
      `</ul>`,
      summary.level.color
    );

    // All levels reference
    content += card('📊 All Levels', `
      <div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;">
        <thead><tr style="background:${C.gray50};">
          <th style="padding:10px 12px;text-align:left;">Level</th>
          <th style="padding:10px 12px;text-align:left;">Title</th>
          <th style="padding:10px 12px;text-align:left;">Points Range</th>
          <th style="padding:10px 12px;text-align:right;">Students</th>
          <th style="padding:10px 12px;text-align:center;">Your Status</th>
        </tr></thead>
        <tbody>${LEVEL_THRESHOLDS.map(lt => {
          const isCurrent = lt.level === summary.level.level;
          const isPast = lt.level < summary.level.level;
          const maxStr = lt.max === Infinity ? '∞' : lt.max;
          const count = distMap[lt.level] || 0;
          const statusIcon = isCurrent ? '📍' : isPast ? '✅' : '🔒';
          const rowBg = isCurrent ? `background:${lt.color}15;border-left:4px solid ${lt.color};` : '';
          return `<tr style="${rowBg}">
            <td style="padding:10px 12px;font-weight:700;color:${lt.color};">${lt.level}</td>
            <td style="padding:10px 12px;">${lt.title}</td>
            <td style="padding:10px 12px;color:${C.gray500};">${lt.min.toLocaleString()} – ${maxStr}</td>
            <td style="padding:10px 12px;text-align:right;">${count}</td>
            <td style="padding:10px 12px;text-align:center;">${statusIcon}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>`, C.gray700);

    res.send(renderPage('Levels', content, currentUser));
  }));

  // ═══════════════════════════════════════════════════════
  // ROUTE 4: Rewards Store — /school/gamification/store
  // ═══════════════════════════════════════════════════════
  app.get('/school/gamification/store', requireAuth, ah(async (req, res) => {
    const tenantId = tid(req);
    const currentUser = user(req);
    await seedDefaults(tenantId);
    const studentId = currentUser.id;
    const summary = await getStudentSummary(tenantId, studentId);

    const rewards = await pool.query(
      `SELECT r.*,
              CASE WHEN r.quantity_available = -1 THEN NULL ELSE
                (r.quantity_available - COALESCE(red.c, 0))
              END as remaining
       FROM gamification_rewards r
       LEFT JOIN (SELECT reward_id, COUNT(*) as c FROM gamification_redemptions WHERE tenant_id=$1 GROUP BY reward_id) red ON red.reward_id = r.id
       WHERE r.tenant_id = $1 AND r.is_active = TRUE
       ORDER BY r.point_cost`,
      [tenantId]
    );

    const redemptions = await pool.query(
      `SELECT rd.*, r.name as reward_name, r.point_cost
       FROM gamification_redemptions rd
       JOIN gamification_rewards r ON r.id = rd.reward_id
       WHERE rd.tenant_id = $1 AND rd.student_id = $2
       ORDER BY rd.redeemed_at DESC LIMIT 20`,
      [tenantId, studentId]
    );

    let content = navTabs('store');

    // Balance card
    content += `<div style="background:linear-gradient(135deg,${C.primary},${C.primaryDark});border-radius:16px;padding:24px 32px;color:${C.white};margin-bottom:24px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px;">` +
      `<div><div style="font-size:14px;opacity:0.8;">Your Points Balance</div><div style="font-size:42px;font-weight:800;">${summary.totalPoints.toLocaleString()}</div></div>` +
      `<div style="text-align:right;"><div style="font-size:14px;opacity:0.8;">Items Redeemed</div><div style="font-size:28px;font-weight:700;">${redemptions.rows.length}</div></div>` +
      `</div>`;

    // Rewards grid
    let rewardsHtml = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px;">`;
    for (const r of rewards.rows) {
      const canAfford = summary.totalPoints >= parseInt(r.point_cost);
      const isAvailable = r.remaining === null || parseInt(r.remaining) > 0;
      const borderCol = canAfford && isAvailable ? C.green : C.gray300;
      const btnDisabled = !canAfford || !isAvailable;
      const btnBg = btnDisabled ? C.gray300 : C.primary;
      const btnText = !isAvailable ? 'Sold Out' : !canAfford ? `Need ${parseInt(r.point_cost) - summary.totalPoints} more` : 'Redeem';
      rewardsHtml += `<div style="background:${C.white};border-radius:12px;padding:20px;border:2px solid ${borderCol};box-shadow:0 1px 3px rgba(0,0,0,0.08);">` +
        `<h4 style="margin:0 0 8px;color:${C.gray900};font-size:16px;">${esc(r.name)}</h4>` +
        `<p style="margin:0 0 12px;color:${C.gray500};font-size:13px;">${esc(r.description || '')}</p>` +
        `<div style="font-size:24px;font-weight:800;color:${C.primary};margin-bottom:4px;">${parseInt(r.point_cost)} pts</div>` +
        (r.remaining !== null ? `<div style="font-size:12px;color:${C.gray500};margin-bottom:12px;">${r.remaining} remaining</div>` : '<div style="margin-bottom:12px;"></div>') +
        `<form method="POST" action="/school/gamification/store/redeem" style="margin:0;">` +
        `<input type="hidden" name="reward_id" value="${r.id}" />` +
        `<button type="submit" ${btnDisabled ? 'disabled' : ''} style="width:100%;padding:10px;background:${btnBg};color:${C.white};border:none;border-radius:8px;font-weight:600;font-size:14px;cursor:${btnDisabled ? 'not-allowed' : 'pointer'};opacity:${btnDisabled ? '0.6' : '1'};">${btnText}</button>` +
        `</form></div>`;
    }
    rewardsHtml += `</div>`;
    content += card('🎁 Rewards Store', rewardsHtml, C.primary);

    // Redemption history
    if (redemptions.rows.length > 0) {
      let redRows = redemptions.rows.map(r => `<tr>` +
        `<td style="padding:8px 10px;">${esc(r.reward_name)}</td>` +
        `<td style="padding:8px 10px;color:${C.red};font-weight:600;">-${parseInt(r.points_spent).toLocaleString()} pts</td>` +
        `<td style="padding:8px 10px;color:${C.gray500};font-size:12px;">${r.redeemed_at ? new Date(r.redeemed_at).toLocaleDateString() : ''}</td>` +
        `</tr>`).join('');
      content += card('📋 Redemption History',
        `<table style="width:100%;border-collapse:collapse;">` +
        `<thead><tr style="background:${C.gray50};"><th style="padding:8px 10px;text-align:left;">Reward</th><th style="padding:8px 10px;text-align:left;">Points Spent</th><th style="padding:8px 10px;text-align:left;">Date</th></tr></thead>` +
        `<tbody>${redRows}</tbody></table>`,
        C.gray700
      );
    }

    // Admin: Manage rewards
    if (currentUser.role === 'admin' || currentUser.role === 'teacher') {
      content += card('⚙️ Admin: Add Reward Item',
        `<form method="POST" action="/school/gamification/store/add" style="display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;">` +
        `<div><label style="display:block;font-size:13px;font-weight:600;margin-bottom:4px;color:${C.gray700};">Name</label><input type="text" name="name" required style="padding:8px 12px;border:1px solid ${C.gray300};border-radius:8px;width:200px;" /></div>` +
        `<div><label style="display:block;font-size:13px;font-weight:600;margin-bottom:4px;color:${C.gray700};">Description</label><input type="text" name="description" style="padding:8px 12px;border:1px solid ${C.gray300};border-radius:8px;width:220px;" /></div>` +
        `<div><label style="display:block;font-size:13px;font-weight:600;margin-bottom:4px;color:${C.gray700};">Point Cost</label><input type="number" name="point_cost" required style="padding:8px 12px;border:1px solid ${C.gray300};border-radius:8px;width:100px;" value="50" /></div>` +
        `<div><label style="display:block;font-size:13px;font-weight:600;margin-bottom:4px;color:${C.gray700};">Quantity (-1=unlimited)</label><input type="number" name="quantity_available" style="padding:8px 12px;border:1px solid ${C.gray300};border-radius:8px;width:80px;" value="-1" /></div>` +
        `<button type="submit" style="padding:8px 20px;background:${C.primary};color:${C.white};border:none;border-radius:8px;font-weight:600;cursor:pointer;">Add Reward</button>` +
        `</form>`,
        C.primaryDark
      );

      // List all rewards for management
      const allRewards = await pool.query(
        `SELECT r.* FROM gamification_rewards r WHERE r.tenant_id=$1 ORDER BY r.created_at DESC`,
        [tenantId]
      );
      if (allRewards.rows.length > 0) {
        let mgmtRows = allRewards.rows.map(r => `<tr>` +
          `<td style="padding:8px 10px;">${esc(r.name)}</td>` +
          `<td style="padding:8px 10px;">${parseInt(r.point_cost)} pts</td>` +
          `<td style="padding:8px 10px;">${r.quantity_available === -1 ? '∞' : r.quantity_available}</td>` +
          `<td style="padding:8px 10px;">${r.is_active ? '<span style="color:#10b981;">Active</span>' : '<span style="color:#ef4444;">Inactive</span>'}</td>` +
          `<td style="padding:8px 10px;">` +
          `<form method="POST" action="/school/gamification/store/toggle" style="display:inline;"><input type="hidden" name="reward_id" value="${r.id}" /><button type="submit" style="padding:4px 10px;background:${C.gray200};border:none;border-radius:4px;cursor:pointer;font-size:12px;">${r.is_active ? 'Deactivate' : 'Activate'}</button></form>` +
          `</td></tr>`).join('');
        content += card('📋 Manage Rewards',
          `<table style="width:100%;border-collapse:collapse;">` +
          `<thead><tr style="background:${C.gray50};"><th style="padding:8px 10px;text-align:left;">Reward</th><th style="padding:8px 10px;">Cost</th><th style="padding:8px 10px;">Qty</th><th style="padding:8px 10px;">Status</th><th style="padding:8px 10px;">Action</th></tr></thead>` +
          `<tbody>${mgmtRows}</tbody></table>`,
          C.gray700
        );
      }
    }

    res.send(renderPage('Rewards Store', content, currentUser));
  }));

  // POST: Redeem reward
  app.post('/school/gamification/store/redeem', requireAuth, ah(async (req, res) => {
    const tenantId = tid(req);
    const currentUser = user(req);
    const studentId = currentUser.id;
    const rewardId = parseInt(req.body.reward_id);
    if (!rewardId) return res.status(400).send('Missing reward_id');

    const summary = await getStudentSummary(tenantId, studentId);
    const reward = await pool.query(`SELECT * FROM gamification_rewards WHERE id=$1 AND tenant_id=$2 AND is_active=TRUE`, [rewardId, tenantId]);
    if (reward.rows.length === 0) return res.status(404).send('Reward not found');
    const r = reward.rows[0];
    if (summary.totalPoints < parseInt(r.point_cost)) {
      return res.status(400).send('Not enough points');
    }

    // Check quantity
    if (parseInt(r.quantity_available) >= 0) {
      const redCount = await pool.query(`SELECT COUNT(*) as c FROM gamification_redemptions WHERE reward_id=$1 AND tenant_id=$2`, [rewardId, tenantId]);
      if (parseInt(redCount.rows[0].c) >= parseInt(r.quantity_available)) {
        return res.status(400).send('Reward out of stock');
      }
    }

    await pool.query('BEGIN');
    try {
      // Deduct points
      await awardPoints(tenantId, studentId, -parseInt(r.point_cost), 'store_redemption', `Redeemed: ${r.name}`, studentId);
      // Record redemption
      await pool.query(
        `INSERT INTO gamification_redemptions (tenant_id, student_id, reward_id, points_spent) VALUES ($1,$2,$3,$4)`,
        [tenantId, studentId, rewardId, parseInt(r.point_cost)]
      );
      await pool.query('COMMIT');
    } catch (e) {
      await pool.query('ROLLBACK');
      throw e;
    }
    audit('gamification_redeem', { tenantId, studentId, rewardId, points: parseInt(r.point_cost) });
    res.redirect('/school/gamification/store');
  }));

  // POST: Add reward
  app.post('/school/gamification/store/add', requireAuth, ah(async (req, res) => {
    const tenantId = tid(req);
    const currentUser = user(req);
    if (currentUser.role !== 'admin' && currentUser.role !== 'teacher') return res.status(403).send('Forbidden');
    const { name, description, point_cost, quantity_available } = req.body;
    if (!name) return res.status(400).send('Name is required');
    await pool.query(
      `INSERT INTO gamification_rewards (tenant_id, name, description, point_cost, quantity_available) VALUES ($1,$2,$3,$4,$5)`,
      [tenantId, name, description || '', parseInt(point_cost) || 50, parseInt(quantity_available) !== undefined ? parseInt(quantity_available) : -1]
    );
    audit('gamification_reward_add', { tenantId, name, by: currentUser.id });
    res.redirect('/school/gamification/store');
  }));

  // POST: Toggle reward
  app.post('/school/gamification/store/toggle', requireAuth, ah(async (req, res) => {
    const tenantId = tid(req);
    const currentUser = user(req);
    if (currentUser.role !== 'admin' && currentUser.role !== 'teacher') return res.status(403).send('Forbidden');
    const rewardId = parseInt(req.body.reward_id);
    if (!rewardId) return res.status(400).send('Missing reward_id');
    await pool.query(`UPDATE gamification_rewards SET is_active = NOT is_active WHERE id=$1 AND tenant_id=$2`, [rewardId, tenantId]);
    res.redirect('/school/gamification/store');
  }));

  // ═══════════════════════════════════════════════════════
  // ROUTE 5: Student Profile — /school/gamification/profile/:studentId
  // ═══════════════════════════════════════════════════════
  app.get('/school/gamification/profile/:studentId', requireAuth, ah(async (req, res) => {
    const tenantId = tid(req);
    const currentUser = user(req);
    const profileStudentId = parseInt(req.params.studentId);
    if (!profileStudentId) return res.status(400).send('Invalid student ID');

    const summary = await getStudentSummary(tenantId, profileStudentId);

    // Student info
    const studentInfo = await pool.query(
      `SELECT id, name, class_name, email FROM users WHERE id=$1 AND tenant_id=$2`,
      [profileStudentId, tenantId]
    );
    const student = studentInfo.rows[0] || { name: 'Unknown Student', class_name: 'N/A' };

    // Class average
    let classAvg = 0;
    if (student.class_name && student.class_name !== 'N/A') {
      const avgRes = await pool.query(
        `SELECT AVG(sub.total) as avg_pts FROM (
          SELECT p.student_id, SUM(p.points) as total
          FROM gamification_points p
          JOIN users u ON u.id = p.student_id AND u.tenant_id = p.tenant_id
          WHERE p.tenant_id = $1 AND u.class_name = $2
          GROUP BY p.student_id
        ) sub`,
        [tenantId, student.class_name]
      );
      classAvg = parseFloat(avgRes.rows[0]?.avg_pts) || 0;
    }

    // Full point history
    const history = await pool.query(
      `SELECT points, source, description, created_at FROM gamification_points
       WHERE tenant_id=$1 AND student_id=$2 ORDER BY created_at DESC LIMIT 50`,
      [tenantId, profileStudentId]
    );

    // Earned badges
    const badges = await pool.query(
      `SELECT b.*, eb.earned_at, eb.points_at_earning
       FROM gamification_earned_badges eb
       JOIN gamification_badges b ON b.id = eb.badge_id
       WHERE eb.tenant_id=$1 AND eb.student_id=$2
       ORDER BY eb.earned_at DESC`,
      [tenantId, profileStudentId]
    );

    // School rank
    const rankRes = await pool.query(
      `SELECT rank FROM (
        SELECT student_id, RANK() OVER (ORDER BY total DESC) as rank FROM (
          SELECT student_id, SUM(points) as total FROM gamification_points WHERE tenant_id=$1 GROUP BY student_id
        ) t
      ) r WHERE student_id = $2`,
      [tenantId, profileStudentId]
    );
    const schoolRank = rankRes.rows[0] ? parseInt(rankRes.rows[0].rank) : null;

    let content = navTabs('');

    // Profile header
    content += `<div style="background:linear-gradient(135deg,${C.primary},${C.purple});border-radius:16px;padding:32px;color:${C.white};margin-bottom:24px;">` +
      `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:24px;">` +
      `<div style="width:80px;height:80px;border-radius:50%;background:${C.white}30;display:flex;align-items:center;justify-content:center;font-size:36px;">👤</div>` +
      `<div style="flex:1;min-width:200px;">` +
      `<h2 style="margin:0;font-size:24px;font-weight:700;">${esc(student.name)}</h2>` +
      `<p style="margin:4px 0 0;opacity:0.85;font-size:14px;">${esc(student.class_name)} ${schoolRank ? `• Rank #${schoolRank}` : ''}</p>` +
      `</div>` +
      `<div style="text-align:right;">` +
      `<div style="font-size:14px;opacity:0.8;">Level ${summary.level.level} ${summary.level.title}</div>` +
      `<div style="font-size:36px;font-weight:800;">${summary.totalPoints.toLocaleString()} pts</div>` +
      `</div></div></div>`;

    // Stats
    content += `<div style="display:flex;flex-wrap:wrap;gap:16px;margin-bottom:24px;">`;
    content += statBox(summary.totalPoints, 'Total Points', C.primary);
    content += statBox(`Lv.${summary.level.level}`, 'Level', C.purple);
    content += statBox(summary.badgesEarned, 'Badges', C.gold);
    if (classAvg > 0) {
      const diff = summary.totalPoints - classAvg;
      const diffColor = diff >= 0 ? C.green : C.red;
      const diffStr = diff >= 0 ? `+${Math.round(diff)}` : `${Math.round(diff)}`;
      content += statBox(`${diffStr}`, 'vs Class Avg', diffColor);
      content += statBox(Math.round(classAvg).toLocaleString(), 'Class Average', C.gray500);
    }
    content += `</div>`;

    // Level progress
    if (summary.nextLevel) {
      content += card('Level Progress',
        svgProgressBar(summary.progressPct, 500, 30, summary.level.color, C.gray200) +
        `<p style="margin:8px 0 0;color:${C.gray500};font-size:13px;">${summary.nextLevel.min - summary.totalPoints} points to reach Level ${summary.nextLevel.level}</p>`,
        summary.level.color
      );
    }

    // Achievement wall — badges
    let badgeWall = badges.rows.length > 0
      ? `<div style="display:flex;flex-wrap:wrap;gap:12px;">` +
        badges.rows.map(b => `<div style="background:${tierColor(b.tier)}15;border:2px solid ${tierColor(b.tier)};border-radius:12px;padding:12px 16px;text-align:center;min-width:120px;">` +
          `<div style="font-size:32px;">${esc(b.icon_emoji)}</div>` +
          `<div style="font-size:12px;font-weight:600;color:${C.gray900};margin-top:4px;">${esc(b.badge_name)}</div>` +
          `<span style="font-size:10px;color:${tierColor(b.tier)};">${tierLabel(b.tier)}</span>` +
          `</div>`).join('') + `</div>`
      : `<p style="color:${C.gray500};font-style:italic;">No badges earned yet.</p>`;
    content += card('🏆 Achievement Wall', badgeWall, C.gold);

    // Point history timeline
    let timeline = history.rows.map(h => {
      const isPos = parseInt(h.points) > 0;
      const dotColor = isPos ? C.green : C.red;
      const sourceInfo = POINT_SOURCES[h.source] || { label: h.source };
      return `<div style="display:flex;gap:12px;padding:8px 0;border-left:3px solid ${C.gray200};padding-left:16px;position:relative;">` +
        `<div style="position:absolute;left:-7px;top:14px;width:10px;height:10px;border-radius:50%;background:${dotColor};"></div>` +
        `<div style="flex:1;"><div style="font-weight:600;font-size:14px;color:${C.gray900};">${esc(sourceInfo.label)}</div>` +
        `<div style="font-size:13px;color:${C.gray500};">${esc(h.description || '')}</div></div>` +
        `<div style="text-align:right;"><div style="font-weight:700;color:${dotColor};font-size:15px;">${isPos ? '+' : ''}${parseInt(h.points)}</div>` +
        `<div style="font-size:11px;color:${C.gray500};">${h.created_at ? new Date(h.created_at).toLocaleDateString() : ''}</div></div>` +
        `</div>`;
    }).join('');

    content += card('📜 Points History Timeline',
      timeline || `<p style="color:${C.gray500};font-style:italic;">No point history yet.</p>`,
      C.primary
    );

    res.send(renderPage(`Profile: ${student.name}`, content, currentUser));
  }));

  // ═══════════════════════════════════════════════════════
  // ROUTE 6: Streaks — /school/gamification/streaks
  // ═══════════════════════════════════════════════════════
  app.get('/school/gamification/streaks', requireAuth, ah(async (req, res) => {
    const tenantId = tid(req);
    const currentUser = user(req);
    const studentId = currentUser.id;
    const summary = await getStudentSummary(tenantId, studentId);

    const streaks = await pool.query(
      `SELECT * FROM gamification_streaks WHERE tenant_id=$1 AND student_id=$2`,
      [tenantId, studentId]
    );

    const STREAK_TYPES = [
      { type: 'attendance', label: 'Attendance Streak', emoji: '📅', description: 'Consecutive days present at school', color: C.green },
      { type: 'homework', label: 'Homework Streak', emoji: '📝', description: 'Consecutive assignments submitted on time', color: C.primary },
      { type: 'reading', label: 'Reading Streak', emoji: '📚', description: 'Consecutive days with library visits or reading logged', color: C.purple },
    ];

    const streakMap = {};
    for (const s of streaks.rows) streakMap[s.streak_type] = s;

    let content = navTabs('streaks');

    // Multiplier info
    const maxCurrentStreak = Math.max(...STREAK_TYPES.map(st => streakMap[st.type]?.current_streak || 0), 0);
    const multiplier = maxCurrentStreak >= 30 ? 3 : maxCurrentStreak >= 14 ? 2 : maxCurrentStreak >= 7 ? 1.5 : 1;

    content += `<div style="background:linear-gradient(135deg,${C.gold},${C.goldDark});border-radius:16px;padding:24px 32px;color:${C.white};margin-bottom:24px;text-align:center;">` +
      `<div style="font-size:16px;opacity:0.9;">Streak Multiplier</div>` +
      `<div style="font-size:56px;font-weight:800;">${multiplier}x</div>` +
      `<p style="margin:8px 0 0;font-size:14px;opacity:0.85;">${maxCurrentStreak >= 30 ? '🔥 30+ day streak — Triple bonus!' : maxCurrentStreak >= 14 ? '⚡ 14+ day streak — Double bonus!' : maxCurrentStreak >= 7 ? '✨ 7+ day streak — 1.5x bonus!' : 'Build a 7-day streak to earn bonus points!'}</p>` +
      `</div>`;

    // Streak cards
    for (const st of STREAK_TYPES) {
      const data = streakMap[st.type] || { current_streak: 0, longest_streak: 0, last_activity_date: null };
      const current = parseInt(data.current_streak) || 0;
      const longest = parseInt(data.longest_streak) || 0;
      const milestonePct = Math.min(100, (current / 30) * 100);

      content += card(`${st.emoji} ${st.label}`,
        `<p style="margin:0 0 12px;color:${C.gray500};font-size:13px;">${st.description}</p>` +
        `<div style="display:flex;gap:24px;margin-bottom:16px;">` +
        `<div style="text-align:center;flex:1;padding:16px;background:${C.gray50};border-radius:10px;border:2px solid ${st.color}30;">` +
        `<div style="font-size:36px;font-weight:800;color:${st.color};">${current}</div>` +
        `<div style="font-size:13px;color:${C.gray500};">Current Streak</div></div>` +
        `<div style="text-align:center;flex:1;padding:16px;background:${C.gray50};border-radius:10px;border:2px solid ${C.gold}30;">` +
        `<div style="font-size:36px;font-weight:800;color:${C.gold};">${longest}</div>` +
        `<div style="font-size:13px;color:${C.gray500};">Longest Streak</div></div>` +
        `</div>` +
        `<p style="margin:0 0 6px;font-size:12px;color:${C.gray500};">30-day milestone: ${svgProgressBar(milestonePct, 300, 20, st.color, C.gray200)}</p>` +
        (data.last_activity_date ? `<p style="margin:8px 0 0;font-size:12px;color:${C.gray500};">Last activity: ${new Date(data.last_activity_date).toLocaleDateString()}</p>` : '') +
        (currentUser.role === 'admin' || currentUser.role === 'teacher'
          ? `<form method="POST" action="/school/gamification/streaks/update" style="margin-top:12px;display:flex;gap:8px;align-items:center;">` +
            `<input type="hidden" name="streak_type" value="${st.type}" />` +
            `<label style="font-size:12px;color:${C.gray700};">Set current:</label>` +
            `<input type="number" name="current_streak" value="${current}" min="0" style="padding:4px 8px;border:1px solid ${C.gray300};border-radius:6px;width:80px;" />` +
            `<button type="submit" style="padding:4px 12px;background:${st.color};color:${C.white};border:none;border-radius:6px;font-size:12px;cursor:pointer;">Update</button>` +
            `</form>`
          : ''),
        st.color
      );
    }

    // Streak bonuses info
    content += card('💡 Streak Bonus System',
      `<div style="display:flex;flex-wrap:wrap;gap:16px;">` +
      `<div style="flex:1;min-width:200px;padding:16px;background:${C.gray50};border-radius:10px;text-align:center;">` +
      `<div style="font-size:24px;font-weight:700;color:${C.gray700};">7 Days</div>` +
      `<div style="font-size:14px;color:${C.primary};font-weight:600;">1.5x Multiplier</div>` +
      `<div style="font-size:12px;color:${C.gray500};">Bonus points on streak activities</div></div>` +
      `<div style="flex:1;min-width:200px;padding:16px;background:${C.gray50};border-radius:10px;text-align:center;">` +
      `<div style="font-size:24px;font-weight:700;color:${C.gray700};">14 Days</div>` +
      `<div style="font-size:14px;color:${C.primary};font-weight:600;">2x Multiplier</div>` +
      `<div style="font-size:12px;color:${C.gray500};">Double points on streak activities</div></div>` +
      `<div style="flex:1;min-width:200px;padding:16px;background:${C.gray50};border-radius:10px;text-align:center;">` +
      `<div style="font-size:24px;font-weight:700;color:${C.gray700};">30 Days</div>` +
      `<div style="font-size:14px;color:${C.gold};font-weight:600;">3x Multiplier</div>` +
      `<div style="font-size:12px;color:${C.gray500};">Triple points + special badge</div></div>` +
      `</div>`,
      C.goldDark
    );

    // Top streakers
    const topStreakers = await pool.query(
      `SELECT s.student_id, u.name as student_name, s.streak_type, s.current_streak, s.longest_streak
       FROM gamification_streaks s
       LEFT JOIN users u ON u.id = s.student_id AND u.tenant_id = s.tenant_id
       WHERE s.tenant_id = $1
       ORDER BY s.current_streak DESC LIMIT 15`,
      [tenantId]
    );
    if (topStreakers.rows.length > 0) {
      const streakEmojiMap = { attendance: '📅', homework: '📝', reading: '📚' };
      let tsRows = topStreakers.rows.map((r, i) => `<tr>` +
        `<td style="padding:8px 10px;">${svgRankBadge(i + 1, 30)}</td>` +
        `<td style="padding:8px 10px;">${esc(r.student_name || 'Student')}</td>` +
        `<td style="padding:8px 10px;">${streakEmojiMap[r.streak_type] || '🔥'} ${r.streak_type}</td>` +
        `<td style="padding:8px 10px;font-weight:700;color:${C.gold};">${parseInt(r.current_streak)} days</td>` +
        `<td style="padding:8px 10px;color:${C.gray500};">${parseInt(r.longest_streak)} days best</td>` +
        `</tr>`).join('');
      content += card('🔥 Top Streakers (All Students)',
        `<table style="width:100%;border-collapse:collapse;">` +
        `<thead><tr style="background:${C.gray50};"><th style="padding:8px 10px;">Rank</th><th style="padding:8px 10px;text-align:left;">Student</th><th style="padding:8px 10px;text-align:left;">Type</th><th style="padding:8px 10px;text-align:left;">Current</th><th style="padding:8px 10px;text-align:left;">Best</th></tr></thead>` +
        `<tbody>${tsRows}</tbody></table>`,
        C.goldDark
      );
    }

    res.send(renderPage('Streaks', content, currentUser));
  }));

  // POST: Update streak
  app.post('/school/gamification/streaks/update', requireAuth, ah(async (req, res) => {
    const tenantId = tid(req);
    const currentUser = user(req);
    if (currentUser.role !== 'admin' && currentUser.role !== 'teacher') return res.status(403).send('Forbidden');
    const { streak_type, current_streak } = req.body;
    const studentId = parseInt(req.query.student_id) || currentUser.id;
    if (!streak_type || current_streak === undefined) return res.status(400).send('Missing parameters');
    const current = Math.max(0, parseInt(current_streak) || 0);

    await pool.query(
      `INSERT INTO gamification_streaks (tenant_id, student_id, streak_type, current_streak, longest_streak, last_activity_date, updated_at)
       VALUES ($1,$2,$3,$4,GREATEST($4, COALESCE((SELECT longest_streak FROM gamification_streaks WHERE tenant_id=$1 AND student_id=$2 AND streak_type=$3),0)),CURRENT_DATE,CURRENT_TIMESTAMP)
       ON CONFLICT (tenant_id, student_id, streak_type) DO UPDATE
       SET current_streak = $4,
           longest_streak = GREATEST($4, gamification_streaks.longest_streak),
           last_activity_date = CURRENT_DATE,
           updated_at = CURRENT_TIMESTAMP`,
      [tenantId, studentId, streak_type, current]
    );

    // Award streak bonus points
    const oldStreak = streakMap?.current_streak || 0;
    const multiplier = current >= 30 ? 3 : current >= 14 ? 2 : current >= 7 ? 1.5 : 1;
    if (multiplier > 1 && current > (parseInt(oldStreak) || 0)) {
      const bonusPts = Math.round(5 * multiplier);
      await awardPoints(tenantId, studentId, bonusPts, 'streak_bonus', `${streak_type} streak multiplier (${multiplier}x)`, currentUser.id);
    }

    audit('gamification_streak_update', { tenantId, studentId, streak_type, current, by: currentUser.id });
    res.redirect('/school/gamification/streaks');
  }));

  // ═══════════════════════════════════════════════════════
  // API ENDPOINTS (for programmatic access)
  // ═══════════════════════════════════════════════════════

  // API: Get student summary
  app.get('/api/gamification/summary/:studentId', requireAuth, ah(async (req, res) => {
    const tenantId = tid(req);
    const studentId = parseInt(req.params.studentId);
    if (!studentId) return res.status(400).json({ error: 'Invalid student ID' });
    const summary = await getStudentSummary(tenantId, studentId);
    res.json({
      student_id: studentId,
      total_points: summary.totalPoints,
      level: summary.level.level,
      level_title: summary.level.title,
      next_level: summary.nextLevel ? { level: summary.nextLevel.level, title: summary.nextLevel.title, points_needed: summary.nextLevel.min - summary.totalPoints } : null,
      progress_percent: Math.round(summary.progressPct),
      badges_earned: summary.badgesEarned,
      streaks: summary.streaks,
    });
  }));

  // API: Award points
  app.post('/api/gamification/award', requireAuth, ah(async (req, res) => {
    const tenantId = tid(req);
    const currentUser = user(req);
    if (currentUser.role !== 'admin' && currentUser.role !== 'teacher') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const { student_id, points, source, description } = req.body;
    if (!student_id || points === undefined) return res.status(400).json({ error: 'Missing student_id or points' });
    const result = await awardPoints(tenantId, parseInt(student_id), parseInt(points), source || 'admin_award', description, currentUser.id);
    audit('api_gamification_award', { tenantId, student_id, points, source, by: currentUser.id });
    res.json({ success: true, id: result?.id });
  }));

  // API: Get leaderboard
  app.get('/api/gamification/leaderboard', requireAuth, ah(async (req, res) => {
    const tenantId = tid(req);
    const scope = req.query.scope || 'school';
    const className = req.query.class_name;
    let query = `SELECT p.student_id, u.name as student_name, u.class_name,
                         COALESCE(SUM(p.points),0) as total_points
                  FROM gamification_points p
                  LEFT JOIN users u ON u.id = p.student_id AND u.tenant_id = p.tenant_id
                  WHERE p.tenant_id = $1`;
    const params = [tenantId];
    if (scope === 'class' && className) {
      query += ` AND u.class_name = $2`;
      params.push(className);
    }
    query += ` GROUP BY p.student_id, u.name, u.class_name ORDER BY total_points DESC LIMIT 50`;
    const result = await pool.query(query, params);
    res.json(result.rows);
  }));

  // API: Record streak activity
  app.post('/api/gamification/streak/record', requireAuth, ah(async (req, res) => {
    const tenantId = tid(req);
    const currentUser = user(req);
    const { student_id, streak_type } = req.body;
    if (!student_id || !streak_type) return res.status(400).json({ error: 'Missing student_id or streak_type' });
    const validTypes = ['attendance', 'homework', 'reading'];
    if (!validTypes.includes(streak_type)) return res.status(400).json({ error: 'Invalid streak type' });

    const today = new Date().toISOString().slice(0, 10);
    const existing = await pool.query(
      `SELECT * FROM gamification_streaks WHERE tenant_id=$1 AND student_id=$2 AND streak_type=$3`,
      [tenantId, parseInt(student_id), streak_type]
    );

    let newStreak = 1;
    if (existing.rows.length > 0) {
      const s = existing.rows[0];
      const lastDate = s.last_activity_date ? new Date(s.last_activity_date) : null;
      const todayDate = new Date(today);
      if (lastDate) {
        const diffDays = Math.floor((todayDate - lastDate) / (1000 * 60 * 60 * 24));
        if (diffDays === 1) {
          newStreak = (parseInt(s.current_streak) || 0) + 1;
        } else if (diffDays === 0) {
          newStreak = parseInt(s.current_streak) || 1;
        } else {
          newStreak = 1; // Reset streak
        }
      }
      await pool.query(
        `UPDATE gamification_streaks SET current_streak=$1, longest_streak=GREATEST($1,longest_streak),
         last_activity_date=$2, updated_at=CURRENT_TIMESTAMP
         WHERE tenant_id=$3 AND student_id=$4 AND streak_type=$5`,
        [newStreak, today, tenantId, parseInt(student_id), streak_type]
      );
    } else {
      await pool.query(
        `INSERT INTO gamification_streaks (tenant_id, student_id, streak_type, current_streak, longest_streak, last_activity_date)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [tenantId, parseInt(student_id), streak_type, newStreak, newStreak, today]
      );
    }

    // Apply multiplier bonus
    const multiplier = newStreak >= 30 ? 3 : newStreak >= 14 ? 2 : newStreak >= 7 ? 1.5 : 1;
    if (multiplier > 1) {
      const bonusPts = Math.round(5 * multiplier);
      await awardPoints(tenantId, parseInt(student_id), bonusPts, 'streak_bonus',
        `${streak_type} streak: ${newStreak} days (${multiplier}x)`, currentUser.id);
    }

    audit('api_gamification_streak_record', { tenantId, student_id, streak_type, new_streak: newStreak });
    res.json({ success: true, current_streak: newStreak, multiplier });
  }));

  // API: Get badges for student
  app.get('/api/gamification/badges/:studentId', requireAuth, ah(async (req, res) => {
    const tenantId = tid(req);
    const studentId = parseInt(req.params.studentId);
    if (!studentId) return res.status(400).json({ error: 'Invalid student ID' });
    const badges = await pool.query(
      `SELECT b.*, eb.earned_at, eb.points_at_earning
       FROM gamification_earned_badges eb
       JOIN gamification_badges b ON b.id = eb.badge_id
       WHERE eb.tenant_id=$1 AND eb.student_id=$2
       ORDER BY eb.earned_at DESC`,
      [tenantId, studentId]
    );
    res.json(badges.rows);
  }));

  // ─── Export helpers for other modules ───
  app.locals.gamification = {
    awardPoints,
    getStudentSummary,
    checkBadgeUnlocks,
    recordStreak: async (tenantId, studentId, streakType) => {
      const today = new Date().toISOString().slice(0, 10);
      const existing = await pool.query(
        `SELECT * FROM gamification_streaks WHERE tenant_id=$1 AND student_id=$2 AND streak_type=$3`,
        [tenantId, studentId, streakType]
      );
      let newStreak = 1;
      if (existing.rows.length > 0) {
        const s = existing.rows[0];
        const lastDate = s.last_activity_date ? new Date(s.last_activity_date) : null;
        const todayDate = new Date(today);
        if (lastDate) {
          const diffDays = Math.floor((todayDate - lastDate) / (1000 * 60 * 60 * 24));
          if (diffDays === 1) newStreak = (parseInt(s.current_streak) || 0) + 1;
          else if (diffDays === 0) newStreak = parseInt(s.current_streak) || 1;
          else newStreak = 1;
        }
        await pool.query(
          `UPDATE gamification_streaks SET current_streak=$1, longest_streak=GREATEST($1,longest_streak),
           last_activity_date=$2, updated_at=CURRENT_TIMESTAMP WHERE tenant_id=$3 AND student_id=$4 AND streak_type=$5`,
          [newStreak, today, tenantId, studentId, streakType]
        );
      } else {
        await pool.query(
          `INSERT INTO gamification_streaks (tenant_id, student_id, streak_type, current_streak, longest_streak, last_activity_date)
           VALUES ($1,$2,$3,$4,$4,$5)`, [tenantId, studentId, streakType, newStreak, today]
        );
      }
      return newStreak;
    }
  };
};
