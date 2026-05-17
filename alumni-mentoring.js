// ============================================================
// ALUMNI MENTORING PROGRAM MODULE
// Mentor profile management, mentor-mentee matching, session
// scheduling, goal tracking, meeting notes, progress reports,
// mentor availability calendar, communication log, skill areas,
// industry expertise, success stories, program analytics
// ============================================================
// Tables: mentor_profiles, mentoring_pairs, mentoring_sessions,
//         mentor_availability, communication_log, success_stories
// Usage in server.js:
//   const alumniMentoring = require('./alumni-mentoring');
//   alumniMentoring(app, pool, { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT });
// ============================================================

'use strict';

module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5';
  const PL = '#818cf8';
  const PBG = '#eef2ff';
  const GRAY = '#6b7280';
  const GREEN = '#059669';
  const WARN = '#d97706';
  const RED = '#dc2626';
  const TXT = '#1e1b4b';
  const BG2 = '#f9fafb';

  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.btn:hover{background:#3730a3}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}</style><div class="breadcrumb" style="margin-bottom:16px"><a href="/school" style="color:#4f46e5">School</a> &rsaquo; Alumni Mentoring</div>';

  const parseNum = (v, fb) => { const n = parseFloat(v); return isNaN(n) ? (fb || 0) : n; };
  const parseJson = (v, fb) => { try { return typeof v === 'string' ? JSON.parse(v) : (v || fb || {}); } catch(e) { return fb || {}; }};
  const tid = (req) => req.tenant?.id || req.session?.tenant_id || opts.tenantId || 1;
  const uid = (req) => req.session?.user?.id || req.user?.id;

  // ── Navigation Helper ──────────────────────────────────────────────
  function nav(active) {
    const links = [
      { href: '/school/alumni-mentoring', label: 'Dashboard', key: 'dash' },
      { href: '/school/alumni-mentoring/mentors', label: 'Mentors', key: 'mentors' },
      { href: '/school/alumni-mentoring/become-mentor', label: 'Become a Mentor', key: 'become' },
      { href: '/school/alumni-mentoring/mentees', label: 'Mentees', key: 'mentees' },
      { href: '/school/alumni-mentoring/pairs', label: 'Pairs', key: 'pairs' },
      { href: '/school/alumni-mentoring/schedule-session', label: 'Schedule Session', key: 'schedule' },
      { href: '/school/alumni-mentoring/goals', label: 'Goals', key: 'goals' },
      { href: '/school/alumni-mentoring/reports', label: 'Reports', key: 'reports' },
      { href: '/school/alumni-mentoring/success-stories', label: 'Success Stories', key: 'stories' },
      { href: '/school/alumni-mentoring/analytics', label: 'Analytics', key: 'analytics' }
    ];
    return `<nav style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:20px" aria-label="Alumni Mentoring Navigation">${links.map(l =>
      `<a href="${l.href}" style="padding:8px 16px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:500;${active === l.key ? 'background:' + P + ';color:#fff' : 'color:' + GRAY + ';background:' + BG2}">${l.label}</a>`
    ).join('')}</nav>`;
  }

  // ── Status Badge Helper ────────────────────────────────────────────
  function statusBadge(status) {
    const map = {
      active: { bg: '#dcfce7', color: '#166534', label: 'Active' },
      pending: { bg: '#fef3c7', color: '#92400e', label: 'Pending' },
      completed: { bg: '#dbeafe', color: '#1e40af', label: 'Completed' },
      paused: { bg: '#f3f4f6', color: '#374151', label: 'Paused' },
      cancelled: { bg: '#fee2e2', color: '#991b1b', label: 'Cancelled' },
      scheduled: { bg: '#ede9fe', color: '#5b21b6', label: 'Scheduled' },
      completed_session: { bg: '#d1fae5', color: '#065f46', label: 'Completed' }
    };
    const s = map[status] || map.pending;
    return `<span style="display:inline-block;background:${s.bg};color:${s.color};padding:3px 12px;border-radius:20px;font-size:12px;font-weight:600;">${s.label}</span>`;
  }

  // ── Rating Stars Helper ────────────────────────────────────────────
  function starsHtml(rating, size) {
    size = size || 14;
    let s = '';
    for (let i = 1; i <= 5; i++) {
      const col = i <= Math.round(rating) ? '#f59e0b' : '#d1d5db';
      s += `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${col}" aria-hidden="true"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.27 5.82 22 7 14.14l-5-4.87 6.91-1.01L12 2z"/></svg>`;
    }
    return s;
  }

  // ============================================================
  // DATABASE MIGRATIONS
  // ============================================================
  (async () => {
    const c = await pool.connect().catch(() => null);
    if (!c) { console.error('[AlumniMentoring] Cannot connect to DB'); return; }
    try {
      await c.query(`CREATE TABLE IF NOT EXISTS mentor_profiles (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 1,
        alumni_id INTEGER NOT NULL,
        bio TEXT DEFAULT '',
        expertise JSONB DEFAULT '[]',
        company VARCHAR(255) DEFAULT '',
        position VARCHAR(255) DEFAULT '',
        years_experience INTEGER DEFAULT 0,
        availability JSONB DEFAULT '{"monday":[],"tuesday":[],"wednesday":[],"thursday":[],"friday":[],"saturday":[],"sunday":[]}',
        max_mentees INTEGER DEFAULT 3,
        photo_url VARCHAR(500) DEFAULT '',
        industry VARCHAR(255) DEFAULT '',
        skills TEXT[] DEFAULT '{}',
        linkedin_url VARCHAR(500) DEFAULT '',
        is_active BOOLEAN DEFAULT true,
        rating NUMERIC(3,2) DEFAULT 0,
        total_sessions INTEGER DEFAULT 0,
        total_mentees INTEGER DEFAULT 0,
        current_mentees INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      await c.query(`CREATE TABLE IF NOT EXISTS mentoring_pairs (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 1,
        mentor_id INTEGER NOT NULL REFERENCES mentor_profiles(id),
        mentee_id INTEGER NOT NULL,
        status VARCHAR(30) DEFAULT 'pending',
        goals TEXT DEFAULT '',
        started_at TIMESTAMPTZ DEFAULT NOW(),
        ended_at TIMESTAMPTZ,
        feedback_mentor TEXT DEFAULT '',
        feedback_mentee TEXT DEFAULT '',
        pair_rating NUMERIC(3,2) DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      await c.query(`CREATE TABLE IF NOT EXISTS mentoring_sessions (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 1,
        pair_id INTEGER NOT NULL REFERENCES mentoring_pairs(id),
        mentor_id INTEGER NOT NULL,
        mentee_id INTEGER NOT NULL,
        date DATE NOT NULL,
        duration_min INTEGER DEFAULT 30,
        topic VARCHAR(255) DEFAULT '',
        notes TEXT DEFAULT '',
        action_items JSONB DEFAULT '[]',
        satisfaction_rating INTEGER DEFAULT 0 CHECK (satisfaction_rating >= 0 AND satisfaction_rating <= 5),
        status VARCHAR(30) DEFAULT 'scheduled',
        meeting_link VARCHAR(500) DEFAULT '',
        meeting_type VARCHAR(50) DEFAULT 'virtual',
        location VARCHAR(255) DEFAULT '',
        completed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      await c.query(`CREATE TABLE IF NOT EXISTS mentor_communication_log (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 1,
        pair_id INTEGER NOT NULL REFERENCES mentoring_pairs(id),
        sender_id INTEGER NOT NULL,
        receiver_id INTEGER NOT NULL,
        message_type VARCHAR(30) DEFAULT 'message',
        subject VARCHAR(255) DEFAULT '',
        body TEXT DEFAULT '',
        is_read BOOLEAN DEFAULT false,
        sent_via VARCHAR(30) DEFAULT 'in_app',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      await c.query(`CREATE TABLE IF NOT EXISTS success_stories (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 1,
        pair_id INTEGER REFERENCES mentoring_pairs(id),
        mentor_id INTEGER NOT NULL,
        mentee_id INTEGER NOT NULL,
        title VARCHAR(255) NOT NULL,
        story TEXT DEFAULT '',
        outcome TEXT DEFAULT '',
        photo_url VARCHAR(500) DEFAULT '',
        is_featured BOOLEAN DEFAULT false,
        is_approved BOOLEAN DEFAULT false,
        author_id INTEGER NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      await c.query(`CREATE TABLE IF NOT EXISTS mentor_goals (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 1,
        pair_id INTEGER NOT NULL REFERENCES mentoring_pairs(id),
        goal_text TEXT NOT NULL,
        goal_category VARCHAR(100) DEFAULT 'career',
        target_date DATE,
        status VARCHAR(30) DEFAULT 'not_started',
        progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
        notes TEXT DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      // Indexes
      const idxs = [
        'idx_mp_tenant ON mentor_profiles(tenant_id)',
        'idx_mp_alumni ON mentor_profiles(tenant_id, alumni_id)',
        'idx_mp_active ON mentor_profiles(tenant_id, is_active)',
        'idx_mp_industry ON mentor_profiles(tenant_id, industry)',
        'idx_mp_skills ON mentor_profiles USING GIN(skills)',
        'idx_mp_expertise ON mentor_profiles USING GIN(expertise)',
        'idx_mpair_tenant ON mentoring_pairs(tenant_id)',
        'idx_mpair_mentor ON mentoring_pairs(tenant_id, mentor_id)',
        'idx_mpair_mentee ON mentoring_pairs(tenant_id, mentee_id)',
        'idx_mpair_status ON mentoring_pairs(tenant_id, status)',
        'idx_msess_tenant ON mentoring_sessions(tenant_id)',
        'idx_msess_pair ON mentoring_sessions(tenant_id, pair_id)',
        'idx_msess_date ON mentoring_sessions(tenant_id, date)',
        'idx_msess_status ON mentoring_sessions(tenant_id, status)',
        'idx_mcomlog_tenant ON mentor_communication_log(tenant_id)',
        'idx_mcomlog_pair ON mentor_communication_log(tenant_id, pair_id)',
        'idx_sstories_tenant ON success_stories(tenant_id)',
        'idx_sstories_featured ON success_stories(tenant_id, is_featured)',
        'idx_mgoals_tenant ON mentor_goals(tenant_id)',
        'idx_mgoals_pair ON mentor_goals(tenant_id, pair_id)',
        'idx_mgoals_status ON mentor_goals(tenant_id, status)'
      ];
      for (const i of idxs) {
        try { await c.query(`CREATE INDEX IF NOT EXISTS ${i}`); } catch(e) {}
      }

      console.log('[AlumniMentoring] Tables ready');
    } catch(e) { console.warn('[AlumniMentoring] Migration warning:', e.message); }
    finally { c.release(); }
  })();

  // ============================================================
  // 1. DASHBOARD — Overview stats, recent activity
  // ============================================================
  app.get('/school/alumni-mentoring', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const userId = uid(req);

    const mentorCheck = await pool.query(
      'SELECT id FROM mentor_profiles WHERE tenant_id = $1 AND alumni_id = $2 AND is_active = true', [t, userId]);
    const isMentor = mentorCheck.rows.length > 0;

    const totalMentors = await pool.query('SELECT COUNT(*)::int as c FROM mentor_profiles WHERE tenant_id = $1 AND is_active = true', [t]);
    const activePairs = await pool.query('SELECT COUNT(*)::int as c FROM mentoring_pairs WHERE tenant_id = $1 AND status = $2', [t, 'active']);
    const totalSessions = await pool.query('SELECT COUNT(*)::int as c FROM mentoring_sessions WHERE tenant_id = $1 AND status = $2', [t, 'completed_session']);
    const myPairs = await pool.query(
      'SELECT COUNT(*)::int as c FROM mentoring_pairs WHERE tenant_id = $1 AND (mentor_id IN (SELECT id FROM mentor_profiles WHERE alumni_id = $2) OR mentee_id = $2) AND status = $3',
      [t, userId, 'active']);
    const upcomingSessions = await pool.query(
      `SELECT ms.*, mp.bio as mentor_bio, u1.name as mentor_name, u2.name as mentee_name
       FROM mentoring_sessions ms
       JOIN mentoring_pairs mpair ON mpair.id = ms.pair_id
       LEFT JOIN mentor_profiles mp ON mp.id = ms.mentor_id
       LEFT JOIN users u1 ON u1.id = mp.alumni_id
       LEFT JOIN users u2 ON u2.id = ms.mentee_id
       WHERE ms.tenant_id = $1 AND ms.date >= CURRENT_DATE AND ms.status = $2
       ORDER BY ms.date ASC LIMIT 5`, [t, 'scheduled']);
    const recentStories = await pool.query(
      'SELECT * FROM success_stories WHERE tenant_id = $1 AND is_approved = true ORDER BY created_at DESC LIMIT 3', [t]);

    const html = renderPage('Alumni Mentoring', SKIP + nav('dash') + `
      <div style="max-width:1200px;margin:0 auto;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px;">
          <div>
            <h1 style="margin:0 0 4px;font-size:28px;color:${TXT};">Alumni Mentoring Program</h1>
            <p style="margin:0;color:${GRAY};font-size:15px;">Connect with experienced alumni to guide your career journey</p>
          </div>
          <div style="display:flex;gap:8px;">
            ${isMentor
              ? `<span style="background:${PBG};color:${P};padding:8px 16px;border-radius:8px;font-weight:600;">You are a Mentor</span>`
              : `<a href="/school/alumni-mentoring/become-mentor" class="btn" style="text-decoration:none;">Become a Mentor</a>`}
            <a href="/school/alumni-mentoring/mentors" class="btn" style="text-decoration:none;background:${GREEN};">Find a Mentor</a>
          </div>
        </div>

        <!-- Stats Cards -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px;">
          <div class="card" style="text-align:center;">
            <div style="font-size:32px;font-weight:700;color:${P};">${totalMentors.rows[0].c}</div>
            <div style="color:${GRAY};font-size:14px;">Active Mentors</div>
          </div>
          <div class="card" style="text-align:center;">
            <div style="font-size:32px;font-weight:700;color:${GREEN};">${activePairs.rows[0].c}</div>
            <div style="color:${GRAY};font-size:14px;">Active Pairs</div>
          </div>
          <div class="card" style="text-align:center;">
            <div style="font-size:32px;font-weight:700;color:${WARN};">${totalSessions.rows[0].c}</div>
            <div style="color:${GRAY};font-size:14px;">Sessions Completed</div>
          </div>
          <div class="card" style="text-align:center;">
            <div style="font-size:32px;font-weight:700;color:#7c3aed;">${myPairs.rows[0].c}</div>
            <div style="color:${GRAY};font-size:14px;">My Active Pairs</div>
          </div>
        </div>

        <!-- Two columns -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px;">
          <!-- Upcoming Sessions -->
          <div class="card">
            <h2 style="margin:0 0 12px;font-size:18px;color:${TXT};">Upcoming Sessions</h2>
            ${upcomingSessions.rows.length === 0
              ? `<p style="color:${GRAY};font-size:14px;">No upcoming sessions scheduled.</p>`
              : `<table><tr><th>Date</th><th>Topic</th><th>Mentor</th><th>Mentee</th></tr>
                 ${upcomingSessions.rows.map(s => `<tr>
                   <td>${esc(s.date?.toISOString?.().slice(0,10) || '')}</td>
                   <td>${esc(s.topic || 'General')}</td>
                   <td>${esc(s.mentor_name || 'N/A')}</td>
                   <td>${esc(s.mentee_name || 'N/A')}</td>
                 </tr>`).join('')}
               </table>`}
          </div>

          <!-- Recent Success Stories -->
          <div class="card">
            <h2 style="margin:0 0 12px;font-size:18px;color:${TXT};">Recent Success Stories</h2>
            ${recentStories.rows.length === 0
              ? `<p style="color:${GRAY};font-size:14px;">No success stories yet. Be the first to share!</p>`
              : recentStories.rows.map(st => `
                 <div style="margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid #e5e7eb;">
                   <div style="font-weight:600;color:${TXT};font-size:15px;">${esc(st.title)}</div>
                   <div style="color:${GRAY};font-size:13px;margin-top:4px;">${esc((st.story || '').slice(0, 120))}...</div>
                 </div>`).join('')}
            <a href="/school/alumni-mentoring/success-stories" style="color:${P};font-weight:600;font-size:14px;">View all stories →</a>
          </div>
        </div>
      </div>
    `, req.session?.user);
    res.send(html);
  }));

  // ============================================================
  // 2. MENTORS — Browse all mentor profiles, filter by skill/industry
  // ============================================================
  app.get('/school/alumni-mentoring/mentors', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    let where = ['mp.tenant_id = $1', 'mp.is_active = true'];
    let params = [t];
    let pi = 2;

    if (req.query.industry) {
      where.push(`mp.industry = $${pi}`);
      params.push(req.query.industry);
      pi++;
    }
    if (req.query.skill) {
      where.push(`$${pi} = ANY(mp.skills)`);
      params.push(req.query.skill);
      pi++;
    }
    if (req.query.search) {
      where.push(`(u.name ILIKE $${pi} OR mp.bio ILIKE $${pi} OR mp.company ILIKE $${pi})`);
      params.push(`%${req.query.search}%`);
      pi++;
    }
    if (req.query.years_min) {
      where.push(`mp.years_experience >= $${pi}`);
      params.push(parseNum(req.query.years_min, 0));
      pi++;
    }

    const r = await pool.query(
      `SELECT mp.*, u.name as alumni_name, u.email as alumni_email
       FROM mentor_profiles mp
       LEFT JOIN users u ON u.id = mp.alumni_id
       WHERE ${where.join(' AND ')}
       ORDER BY mp.rating DESC NULLS LAST, mp.total_sessions DESC LIMIT 60`, params);

    const industries = await pool.query(
      'SELECT DISTINCT industry FROM mentor_profiles WHERE tenant_id = $1 AND is_active = true AND industry IS NOT NULL AND industry != \'\' ORDER BY industry', [t]);

    const mentorCards = r.rows.map(m => {
      const expertise = Array.isArray(m.expertise) ? m.expertise : [];
      const skills = Array.isArray(m.skills) ? m.skills : [];
      const tags = expertise.slice(0, 3).concat(skills.slice(0, 3)).slice(0, 4)
        .map(s => `<span style="display:inline-block;background:${PBG};color:${P};padding:2px 10px;border-radius:12px;font-size:11px;margin:2px;">${esc(String(s))}</span>`).join(' ');
      return `
        <div class="card" style="cursor:pointer;" onclick="window.location='/school/alumni-mentoring/mentors/${m.id}'">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">
            <div style="width:52px;height:52px;border-radius:50%;background:linear-gradient(135deg,${P},${PL});display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:20px;">
              ${(m.alumni_name || 'M')[0].toUpperCase()}
            </div>
            <div>
              <div style="font-weight:600;color:${TXT};font-size:16px;">${esc(m.alumni_name || 'Unknown')}</div>
              <div style="color:${GRAY};font-size:13px;">${esc(m.position || '')} ${m.company ? 'at ' + esc(m.company) : ''}</div>
              ${m.industry ? `<div style="color:${GRAY};font-size:12px;">${esc(m.industry)}</div>` : ''}
            </div>
            <div style="margin-left:auto;text-align:right;">
              <div>${starsHtml(parseNum(m.rating, 0), 12)}</div>
              <div style="color:${GRAY};font-size:11px;">${m.total_sessions} sessions</div>
            </div>
          </div>
          ${m.bio ? `<p style="color:${GRAY};font-size:13px;margin:0 0 8px;line-height:1.5;">${esc(m.bio.slice(0, 140))}${m.bio.length > 140 ? '...' : ''}</p>` : ''}
          <div style="display:flex;flex-wrap:wrap;gap:2px;">${tags}</div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;font-size:12px;color:${GRAY};">
            <span>${m.years_experience || 0} years experience</span>
            <span style="color:${P};font-weight:600;">${m.current_mentees || 0}/${m.max_mentees || 3} mentees</span>
          </div>
        </div>`;
    }).join('');

    const html = renderPage('Browse Mentors', SKIP + nav('mentors') + `
      <div style="max-width:1200px;margin:0 auto;">
        <h1 style="margin:0 0 16px;font-size:24px;color:${TXT};">Browse Alumni Mentors</h1>
        <form method="get" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px;">
          <input type="text" name="search" placeholder="Search by name, bio, company..." value="${esc(req.query.search || '')}" style="max-width:280px;">
          <select name="industry" style="max-width:200px;">
            <option value="">All Industries</option>
            ${industries.rows.map(i => `<option value="${esc(i.industry)}" ${req.query.industry === i.industry ? 'selected' : ''}>${esc(i.industry)}</option>`).join('')}
          </select>
          <button type="submit" class="btn">Search</button>
        </form>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:16px;">
          ${mentorCards || `<div class="card" style="text-align:center;padding:40px;color:${GRAY};grid-column:1/-1;">
            <p style="font-size:16px;">No mentors found matching your criteria.</p>
            <a href="/school/alumni-mentoring/become-mentor" style="color:${P};font-weight:600;">Become a mentor →</a>
          </div>`}
        </div>
      </div>
    `, req.session?.user);
    res.send(html);
  }));

  // ============================================================
  // 3. MENTOR PROFILE DETAIL — View individual mentor
  // ============================================================
  app.get('/school/alumni-mentoring/mentors/:id', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const r = await pool.query(
      `SELECT mp.*, u.name as alumni_name, u.email as alumni_email
       FROM mentor_profiles mp
       LEFT JOIN users u ON u.id = mp.alumni_id
       WHERE mp.id = $1 AND mp.tenant_id = $2 AND mp.is_active = true`, [req.params.id, t]);
    if (!r.rows.length) return res.status(404).send('Mentor not found');
    const m = r.rows[0];

    const expertise = Array.isArray(m.expertise) ? m.expertise : [];
    const skills = Array.isArray(m.skills) ? m.skills : [];
    const availability = parseJson(m.availability, {});
    const dayNames = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];

    let availHtml = '';
    for (const d of dayNames) {
      const slots = availability[d] || [];
      if (slots.length > 0) {
        availHtml += `<div style="margin-bottom:4px;"><strong style="text-transform:capitalize;color:${TXT};font-size:13px;">${d}:</strong> <span style="color:${GRAY};font-size:13px;">${esc(slots.join(', '))}</span></div>`;
      }
    }
    if (!availHtml) availHtml = '<p style="color:' + GRAY + ';font-size:13px;">Availability not specified</p>';

    const reviewPairs = await pool.query(
      `SELECT mp2.*, u2.name as mentee_name
       FROM mentoring_pairs mp2
       LEFT JOIN users u2 ON u2.id = mp2.mentee_id
       WHERE mp2.mentor_id = $1 AND mp2.tenant_id = $2 AND mp2.status = 'completed'
       ORDER BY mp2.updated_at DESC LIMIT 5`, [m.id, t]);

    const activeMenteeCount = await pool.query(
      'SELECT COUNT(*)::int as c FROM mentoring_pairs WHERE tenant_id = $1 AND mentor_id = $2 AND status = $3',
      [t, m.id, 'active']);

    const canRequest = activeMenteeCount.rows[0].c < (m.max_mentees || 3);

    const html = renderPage('Mentor Profile', SKIP + nav('mentors') + `
      <div style="max-width:900px;margin:0 auto;">
        <div class="card">
          <div style="display:flex;align-items:center;gap:20px;margin-bottom:20px;flex-wrap:wrap;">
            <div style="width:80px;height:80px;border-radius:50%;background:linear-gradient(135deg,${P},${PL});display:flex;align-items:center;justify-content:center;color:#fff;font-size:28px;font-weight:700;">
              ${(m.alumni_name || 'M')[0].toUpperCase()}
            </div>
            <div style="flex:1;">
              <h1 style="margin:0 0 4px;font-size:24px;color:${TXT};">${esc(m.alumni_name || 'Unknown')}</h1>
              <div style="color:${GRAY};font-size:15px;">${esc(m.position || '')} ${m.company ? 'at <strong>' + esc(m.company) + '</strong>' : ''}</div>
              ${m.industry ? `<div style="color:${P};font-size:13px;font-weight:500;margin-top:2px;">${esc(m.industry)} · ${m.years_experience || 0} years experience</div>` : ''}
              <div style="margin-top:4px;">${starsHtml(parseNum(m.rating, 0), 16)} <span style="color:${GRAY};font-size:13px;">(${m.total_sessions || 0} sessions, ${m.total_mentees || 0} mentees)</span></div>
            </div>
            ${canRequest
              ? `<form method="post" action="/school/alumni-mentoring/api/pairs/request" style="margin-left:auto;">
                   <input type="hidden" name="mentor_id" value="${m.id}">
                   <button type="submit" class="btn" style="padding:10px 24px;font-size:15px;">Request Mentoring</button>
                 </form>`
              : `<span style="background:#fef3c7;color:#92400e;padding:8px 16px;border-radius:8px;font-weight:600;font-size:13px;">Mentor at capacity</span>`}
          </div>
          ${m.bio ? `<div style="background:${BG2};border-radius:10px;padding:16px;margin-bottom:20px;"><p style="margin:0;color:${TXT};line-height:1.7;font-size:14px;">${esc(m.bio)}</p></div>` : ''}
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
            <div>
              <h3 style="margin:0 0 8px;font-size:16px;color:${TXT};">Areas of Expertise</h3>
              <div style="display:flex;flex-wrap:wrap;gap:4px;">
                ${expertise.map(e => `<span style="display:inline-block;background:${PBG};color:${P};padding:4px 14px;border-radius:20px;font-size:13px;font-weight:500;">${esc(String(e))}</span>`).join('') || `<span style="color:${GRAY};font-size:13px;">Not specified</span>`}
              </div>
            </div>
            <div>
              <h3 style="margin:0 0 8px;font-size:16px;color:${TXT};">Skills</h3>
              <div style="display:flex;flex-wrap:wrap;gap:4px;">
                ${skills.map(s => `<span style="display:inline-block;background:#dbeafe;color:#1e40af;padding:4px 14px;border-radius:20px;font-size:13px;font-weight:500;">${esc(String(s))}</span>`).join('') || `<span style="color:${GRAY};font-size:13px;">Not specified</span>`}
              </div>
            </div>
          </div>
          <div style="margin-top:20px;">
            <h3 style="margin:0 0 8px;font-size:16px;color:${TXT};">Availability</h3>
            ${availHtml}
          </div>
        </div>
      </div>
    `, req.session?.user);
    res.send(html);
  }));

  // ============================================================
  // 4. BECOME A MENTOR — Registration / profile creation form
  // ============================================================
  app.get('/school/alumni-mentoring/become-mentor', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const userId = uid(req);
    const existing = await pool.query(
      'SELECT * FROM mentor_profiles WHERE tenant_id = $1 AND alumni_id = $2', [t, userId]);

    const e = existing.rows[0];
    const isEdit = e && e.id;
    const expertise = Array.isArray(e?.expertise) ? e.expertise.join(', ') : '';
    const skills = Array.isArray(e?.skills) ? e.skills.join(', ') : '';

    const html = renderPage(isEdit ? 'Edit Mentor Profile' : 'Become a Mentor', SKIP + nav('become') + `
      <div style="max-width:700px;margin:0 auto;">
        <h1 style="margin:0 0 8px;font-size:24px;color:${TXT};">${isEdit ? 'Edit Your Mentor Profile' : 'Become an Alumni Mentor'}</h1>
        <p style="color:${GRAY};margin:0 0 20px;">Share your experience and guide the next generation.</p>
        <form method="post" action="/school/alumni-mentoring/api/mentor-profile" class="card">
          <div style="margin-bottom:16px;">
            <label style="display:block;font-weight:600;color:${TXT};margin-bottom:4px;">Bio / About You</label>
            <textarea name="bio" rows="4" placeholder="Tell students about your background, passion, and what you can offer...">${esc(e?.bio || '')}</textarea>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
            <div>
              <label style="display:block;font-weight:600;color:${TXT};margin-bottom:4px;">Company</label>
              <input type="text" name="company" value="${esc(e?.company || '')}" placeholder="e.g., Google, MIT, Self-employed">
            </div>
            <div>
              <label style="display:block;font-weight:600;color:${TXT};margin-bottom:4px;">Position / Title</label>
              <input type="text" name="position" value="${esc(e?.position || '')}" placeholder="e.g., Senior Software Engineer">
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:16px;">
            <div>
              <label style="display:block;font-weight:600;color:${TXT};margin-bottom:4px;">Industry</label>
              <input type="text" name="industry" value="${esc(e?.industry || '')}" placeholder="e.g., Technology, Finance">
            </div>
            <div>
              <label style="display:block;font-weight:600;color:${TXT};margin-bottom:4px;">Years of Experience</label>
              <input type="number" name="years_experience" value="${e?.years_experience || ''}" min="0" max="60">
            </div>
            <div>
              <label style="display:block;font-weight:600;color:${TXT};margin-bottom:4px;">Max Mentees</label>
              <input type="number" name="max_mentees" value="${e?.max_mentees || 3}" min="1" max="20">
            </div>
          </div>
          <div style="margin-bottom:16px;">
            <label style="display:block;font-weight:600;color:${TXT};margin-bottom:4px;">Areas of Expertise (comma-separated)</label>
            <input type="text" name="expertise" value="${esc(expertise)}" placeholder="e.g., Machine Learning, Product Management, Startups">
          </div>
          <div style="margin-bottom:16px;">
            <label style="display:block;font-weight:600;color:${TXT};margin-bottom:4px;">Skills (comma-separated)</label>
            <input type="text" name="skills" value="${esc(skills)}" placeholder="e.g., Python, Leadership, Public Speaking">
          </div>
          <div style="margin-bottom:16px;">
            <label style="display:block;font-weight:600;color:${TXT};margin-bottom:4px;">LinkedIn URL (optional)</label>
            <input type="url" name="linkedin_url" value="${esc(e?.linkedin_url || '')}" placeholder="https://linkedin.com/in/yourprofile">
          </div>
          <div style="margin-bottom:16px;">
            <label style="display:block;font-weight:600;color:${TXT};margin-bottom:4px;">Photo URL (optional)</label>
            <input type="url" name="photo_url" value="${esc(e?.photo_url || '')}" placeholder="https://example.com/photo.jpg">
          </div>
          <button type="submit" class="btn" style="width:100%;padding:12px;font-size:16px;">${isEdit ? 'Update Profile' : 'Register as Mentor'}</button>
        </form>
      </div>
    `, req.session?.user);
    res.send(html);
  }));

  // API: Create / Update mentor profile
  app.post('/school/alumni-mentoring/api/mentor-profile', requireAuth, requireNotBanned, ah(async (req, res) => {
    const t = tid(req);
    const userId = uid(req);
    const { bio, company, position, industry, years_experience, max_mentees, expertise, skills, linkedin_url, photo_url } = req.body;
    const expertiseArr = typeof expertise === 'string' ? expertise.split(',').map(s => s.trim()).filter(Boolean) : (Array.isArray(expertise) ? expertise : []);
    const skillsArr = typeof skills === 'string' ? skills.split(',').map(s => s.trim()).filter(Boolean) : (Array.isArray(skills) ? skills : []);

    const existing = await pool.query(
      'SELECT id FROM mentor_profiles WHERE tenant_id = $1 AND alumni_id = $2', [t, userId]);

    let result;
    if (existing.rows.length > 0) {
      result = await pool.query(
        `UPDATE mentor_profiles SET bio = $1, company = $2, position = $3, industry = $4,
          years_experience = $5, max_mentees = $6, expertise = $7, skills = $8,
          linkedin_url = $9, photo_url = $10, updated_at = NOW()
         WHERE tenant_id = $11 AND alumni_id = $12 RETURNING *`,
        [bio || '', company || '', position || '', industry || '', parseNum(years_experience, 0),
         parseNum(max_mentees, 3), JSON.stringify(expertiseArr), skillsArr,
         linkedin_url || '', photo_url || '', t, userId]);
      audit('mentor_profile_updated', { mentorId: existing.rows[0].id, tenant: t });
    } else {
      result = await pool.query(
        `INSERT INTO mentor_profiles (tenant_id, alumni_id, bio, company, position, industry,
          years_experience, max_mentees, expertise, skills, linkedin_url, photo_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
        [t, userId, bio || '', company || '', position || '', industry || '',
         parseNum(years_experience, 0), parseNum(max_mentees, 3),
         JSON.stringify(expertiseArr), skillsArr, linkedin_url || '', photo_url || '']);
      audit('mentor_profile_created', { mentorId: result.rows[0].id, tenant: t });

      if (queueEmail) {
        queueEmail(userId, 'Mentor Registration Successful', `Your alumni mentor profile has been created. Thank you for giving back to the community!`);
      }
    }
    res.redirect('/school/alumni-mentoring/become-mentor');
  }));

  // ============================================================
  // 5. MENTEES — Browse mentees / mentee management
  // ============================================================
  app.get('/school/alumni-mentoring/mentees', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const r = await pool.query(
      `SELECT mp2.id as pair_id, mp2.status as pair_status, mp2.started_at,
        u.id as mentee_id, u.name as mentee_name, u.email as mentee_email,
        mpro.id as mentor_profile_id, mpro.position, mpro.company, mpro.industry,
        u2.name as mentor_name
       FROM mentoring_pairs mp2
       LEFT JOIN users u ON u.id = mp2.mentee_id
       LEFT JOIN mentor_profiles mpro ON mpro.id = mp2.mentor_id
       LEFT JOIN users u2 ON u2.id = mpro.alumni_id
       WHERE mp2.tenant_id = $1
       ORDER BY mp2.started_at DESC`, [t]);

    const html = renderPage('Mentees', SKIP + nav('mentees') + `
      <div style="max-width:1200px;margin:0 auto;">
        <h1 style="margin:0 0 16px;font-size:24px;color:${TXT};">Mentees Overview</h1>
        ${r.rows.length === 0
          ? `<div class="card" style="text-align:center;padding:40px;color:${GRAY};"><p>No mentoring pairs registered yet.</p></div>`
          : `<table>
              <tr><th>Mentee</th><th>Mentor</th><th>Field</th><th>Status</th><th>Started</th></tr>
              ${r.rows.map(r => `<tr>
                <td><strong>${esc(r.mentee_name || 'Unknown')}</strong><br><span style="color:${GRAY};font-size:12px;">${esc(r.mentee_email || '')}</span></td>
                <td>${esc(r.mentor_name || 'N/A')}</td>
                <td>${esc(r.industry || r.company || 'N/A')}</td>
                <td>${statusBadge(r.pair_status)}</td>
                <td style="color:${GRAY};font-size:13px;">${r.started_at ? r.started_at.toISOString().slice(0, 10) : ''}</td>
              </tr>`).join('')}
            </table>`}
      </div>
    `, req.session?.user);
    res.send(html);
  }));

  // ============================================================
  // 6. PAIRS — Mentor-mentee matching and pair management
  // ============================================================
  app.get('/school/alumni-mentoring/pairs', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const userId = uid(req);

    let where = ['mp.tenant_id = $1'];
    let params = [t];
    let pi = 2;

    if (req.query.status) {
      where.push(`mp.status = $${pi}`);
      params.push(req.query.status);
      pi++;
    }

    const r = await pool.query(
      `SELECT mp.*, u1.name as mentor_name, u2.name as mentee_name,
        mpro.position, mpro.company, mpro.industry
       FROM mentoring_pairs mp
       LEFT JOIN mentor_profiles mpro ON mpro.id = mp.mentor_id
       LEFT JOIN users u1 ON u1.id = mpro.alumni_id
       LEFT JOIN users u2 ON u2.id = mp.mentee_id
       WHERE ${where.join(' AND ')}
       ORDER BY mp.started_at DESC LIMIT 100`, params);

    const pairCards = r.rows.map(p => `
      <div class="card">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
          <div style="display:flex;align-items:center;gap:12px;">
            <div style="width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,${P},${PL});display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:16px;">
              ${(p.mentor_name || 'M')[0]}
            </div>
            <div>
              <span style="font-weight:600;color:${TXT};">${esc(p.mentor_name || 'Mentor')}</span>
              <span style="color:${GRAY};margin:0 8px;">→</span>
              <span style="font-weight:600;color:${GREEN};">${esc(p.mentee_name || 'Mentee')}</span>
            </div>
          </div>
          ${statusBadge(p.status)}
        </div>
        <div style="font-size:13px;color:${GRAY};">
          ${esc(p.position || '')} ${p.company ? 'at ' + esc(p.company) : ''}
          ${p.industry ? ' · ' + esc(p.industry) : ''}
        </div>
        ${p.goals ? `<div style="margin-top:8px;font-size:13px;color:${TXT};background:${BG2};padding:8px 12px;border-radius:8px;">${esc(p.goals.slice(0, 150))}${p.goals.length > 150 ? '...' : ''}</div>` : ''}
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;">
          <span style="font-size:12px;color:${GRAY};">Started: ${p.started_at ? p.started_at.toISOString().slice(0, 10) : 'N/A'}</span>
          <div style="display:flex;gap:6px;">
            <a href="/school/alumni-mentoring/session-notes?pair_id=${p.id}" style="font-size:12px;color:${P};font-weight:600;">View Sessions</a>
            <form method="post" action="/school/alumni-mentoring/api/pairs/${p.id}/status" style="display:inline;">
              <input type="hidden" name="status" value="${p.status === 'active' ? 'completed' : 'active'}">
              <button type="submit" style="font-size:12px;color:${P};background:none;border:none;cursor:pointer;font-weight:600;">${p.status === 'active' ? 'Complete' : 'Reactivate'}</button>
            </form>
          </div>
        </div>
      </div>`).join('');

    const html = renderPage('Mentoring Pairs', SKIP + nav('pairs') + `
      <div style="max-width:900px;margin:0 auto;">
        <h1 style="margin:0 0 16px;font-size:24px;color:${TXT};">Mentoring Pairs</h1>
        <form method="get" style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;">
          <select name="status" style="max-width:180px;" onchange="this.form.submit()">
            <option value="">All Statuses</option>
            <option value="active" ${req.query.status === 'active' ? 'selected' : ''}>Active</option>
            <option value="pending" ${req.query.status === 'pending' ? 'selected' : ''}>Pending</option>
            <option value="completed" ${req.query.status === 'completed' ? 'selected' : ''}>Completed</option>
            <option value="paused" ${req.query.status === 'paused' ? 'selected' : ''}>Paused</option>
            <option value="cancelled" ${req.query.status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
          </select>
        </form>
        ${pairCards || `<div class="card" style="text-align:center;padding:40px;color:${GRAY};"><p>No mentoring pairs found.</p></div>`}
      </div>
    `, req.session?.user);
    res.send(html);
  }));

  // API: Request mentoring pair
  app.post('/school/alumni-mentoring/api/pairs/request', requireAuth, requireNotBanned, ah(async (req, res) => {
    const t = tid(req);
    const menteeId = uid(req);
    const mentorId = req.body.mentor_id;

    if (!mentorId) return res.status(400).json({ error: 'Mentor ID required' });

    const mentorCheck = await pool.query(
      'SELECT id, max_mentees, current_mentees FROM mentor_profiles WHERE id = $1 AND tenant_id = $2 AND is_active = true',
      [mentorId, t]);
    if (!mentorCheck.rows.length) return res.status(404).json({ error: 'Mentor not found' });

    const mc = mentorCheck.rows[0];
    if (mc.current_mentees >= mc.max_mentees) return res.status(409).json({ error: 'Mentor is at full capacity' });

    const existingPair = await pool.query(
      'SELECT id, status FROM mentoring_pairs WHERE tenant_id = $1 AND mentor_id = $2 AND mentee_id = $3 AND status IN ($4, $5)',
      [t, mentorId, menteeId, 'pending', 'active']);
    if (existingPair.rows.length) return res.status(409).json({ error: 'Pair already exists (' + existingPair.rows[0].status + ')' });

    const result = await pool.query(
      `INSERT INTO mentoring_pairs (tenant_id, mentor_id, mentee_id, status, goals)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [t, mentorId, menteeId, 'pending', req.body.goals || '']);

    await pool.query(
      'UPDATE mentor_profiles SET current_mentees = current_mentees + 1 WHERE id = $1 AND tenant_id = $2',
      [mentorId, t]);

    audit('mentoring_pair_requested', { pairId: result.rows[0].id, mentorId, menteeId, tenant: t });

    if (queueEmail) {
      queueEmail(menteeId, 'Mentoring Request Sent', 'Your mentoring request has been submitted. You will be notified when the mentor responds.');
    }

    res.redirect('/school/alumni-mentoring/pairs');
  }));

  // API: Update pair status
  app.post('/school/alumni-mentoring/api/pairs/:id/status', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const newStatus = req.body.status;
    if (!['active', 'completed', 'paused', 'cancelled'].includes(newStatus)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    const pair = await pool.query(
      'SELECT * FROM mentoring_pairs WHERE id = $1 AND tenant_id = $2', [req.params.id, t]);
    if (!pair.rows.length) return res.status(404).json({ error: 'Pair not found' });

    await pool.query(
      'UPDATE mentoring_pairs SET status = $1, ended_at = $2, updated_at = NOW() WHERE id = $3 AND tenant_id = $4',
      [newStatus, newStatus === 'completed' || newStatus === 'cancelled' ? new Date() : null, req.params.id, t]);

    if (newStatus === 'completed' || newStatus === 'cancelled') {
      await pool.query(
        'UPDATE mentor_profiles SET current_mentees = GREATEST(current_mentees - 1, 0) WHERE id = $1 AND tenant_id = $2',
        [pair.rows[0].mentor_id, t]);
    }

    audit('mentoring_pair_status_changed', { pairId: +req.params.id, status: newStatus, tenant: t });
    res.redirect('/school/alumni-mentoring/pairs');
  }));

  // API: Accept / Reject pair (for mentors)
  app.post('/school/alumni-mentoring/api/pairs/:id/accept', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    await pool.query(
      'UPDATE mentoring_pairs SET status = $1, started_at = NOW(), updated_at = NOW() WHERE id = $2 AND tenant_id = $3 AND status = $4',
      ['active', req.params.id, t, 'pending']);
    audit('mentoring_pair_accepted', { pairId: +req.params.id, tenant: t });
    res.json({ success: true });
  }));

  app.post('/school/alumni-mentoring/api/pairs/:id/reject', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const pair = await pool.query(
      'SELECT mentor_id FROM mentoring_pairs WHERE id = $1 AND tenant_id = $2', [req.params.id, t]);
    if (pair.rows.length) {
      await pool.query(
        'UPDATE mentor_profiles SET current_mentees = GREATEST(current_mentees - 1, 0) WHERE id = $1 AND tenant_id = $2',
        [pair.rows[0].mentor_id, t]);
    }
    await pool.query(
      'UPDATE mentoring_pairs SET status = $1, ended_at = NOW(), updated_at = NOW() WHERE id = $2 AND tenant_id = $3',
      ['cancelled', req.params.id, t]);
    audit('mentoring_pair_rejected', { pairId: +req.params.id, tenant: t });
    res.json({ success: true });
  }));

  // ============================================================
  // 7. SCHEDULE SESSION — Book mentoring sessions
  // ============================================================
  app.get('/school/alumni-mentoring/schedule-session', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const userId = uid(req);

    const myPairs = await pool.query(
      `SELECT mp.id, u1.name as mentor_name, u2.name as mentee_name, mp.status
       FROM mentoring_pairs mp
       LEFT JOIN mentor_profiles mpro ON mpro.id = mp.mentor_id
       LEFT JOIN users u1 ON u1.id = mpro.alumni_id
       LEFT JOIN users u2 ON u2.id = mp.mentee_id
       WHERE mp.tenant_id = $1 AND mp.status = 'active'
       AND (mpro.alumni_id = $2 OR mp.mentee_id = $2)
       ORDER BY u1.name`, [t, userId]);

    const html = renderPage('Schedule Session', SKIP + nav('schedule') + `
      <div style="max-width:600px;margin:0 auto;">
        <h1 style="margin:0 0 8px;font-size:24px;color:${TXT};">Schedule Mentoring Session</h1>
        <p style="color:${GRAY};margin:0 0 20px;">Set up a meeting with your mentor or mentee.</p>
        <form method="post" action="/school/alumni-mentoring/api/sessions" class="card">
          <div style="margin-bottom:16px;">
            <label style="display:block;font-weight:600;color:${TXT};margin-bottom:4px;">Mentoring Pair</label>
            <select name="pair_id" required>
              <option value="">Select a pair...</option>
              ${myPairs.rows.map(p => `<option value="${p.id}">${esc(p.mentor_name || 'Mentor')} → ${esc(p.mentee_name || 'Mentee')}</option>`).join('')}
            </select>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
            <div>
              <label style="display:block;font-weight:600;color:${TXT};margin-bottom:4px;">Date</label>
              <input type="date" name="date" required>
            </div>
            <div>
              <label style="display:block;font-weight:600;color:${TXT};margin-bottom:4px;">Duration (minutes)</label>
              <select name="duration_min">
                <option value="15">15 minutes</option>
                <option value="30" selected>30 minutes</option>
                <option value="45">45 minutes</option>
                <option value="60">60 minutes</option>
                <option value="90">90 minutes</option>
              </select>
            </div>
          </div>
          <div style="margin-bottom:16px;">
            <label style="display:block;font-weight:600;color:${TXT};margin-bottom:4px;">Meeting Type</label>
            <select name="meeting_type">
              <option value="virtual">Virtual (Video Call)</option>
              <option value="in_person">In Person</option>
              <option value="phone">Phone Call</option>
              <option value="chat">Text Chat</option>
            </select>
          </div>
          <div style="margin-bottom:16px;">
            <label style="display:block;font-weight:600;color:${TXT};margin-bottom:4px;">Topic</label>
            <input type="text" name="topic" placeholder="e.g., Career Planning, Resume Review">
          </div>
          <div style="margin-bottom:16px;">
            <label style="display:block;font-weight:600;color:${TXT};margin-bottom:4px;">Meeting Link / Location</label>
            <input type="text" name="meeting_link" placeholder="Zoom link, Google Meet, or physical address">
          </div>
          <div style="margin-bottom:16px;">
            <label style="display:block;font-weight:600;color:${TXT};margin-bottom:4px;">Notes (optional)</label>
            <textarea name="notes" rows="3" placeholder="Agenda items, things to discuss..."></textarea>
          </div>
          <button type="submit" class="btn" style="width:100%;padding:12px;font-size:16px;">Schedule Session</button>
        </form>
      </div>
    `, req.session?.user);
    res.send(html);
  }));

  // API: Create session
  app.post('/school/alumni-mentoring/api/sessions', requireAuth, requireNotBanned, ah(async (req, res) => {
    const t = tid(req);
    const { pair_id, date, duration_min, topic, meeting_type, meeting_link, notes } = req.body;
    if (!pair_id || !date) return res.status(400).json({ error: 'pair_id and date are required' });

    const pair = await pool.query(
      'SELECT mentor_id, mentee_id FROM mentoring_pairs WHERE id = $1 AND tenant_id = $2 AND status = $3',
      [pair_id, t, 'active']);
    if (!pair.rows.length) return res.status(404).json({ error: 'Active pair not found' });

    const result = await pool.query(
      `INSERT INTO mentoring_sessions (tenant_id, pair_id, mentor_id, mentee_id, date, duration_min,
        topic, meeting_type, meeting_link, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [t, pair_id, pair.rows[0].mentor_id, pair.rows[0].mentee_id, date,
       parseNum(duration_min, 30), topic || '', meeting_type || 'virtual',
       meeting_link || '', notes || '']);

    audit('mentoring_session_created', { sessionId: result.rows[0].id, pairId: pair_id, tenant: t });

    if (queueEmail) {
      queueEmail(pair.rows[0].mentee_id, 'Mentoring Session Scheduled',
        `A new session has been scheduled for ${date}. Topic: ${topic || 'General'}`);
    }

    res.redirect('/school/alumni-mentoring/schedule-session');
  }));

  // ============================================================
  // 8. SESSION NOTES — View and manage session notes by pair or ID
  // ============================================================
  app.get('/school/alumni-mentoring/session-notes/:id', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const session = await pool.query(
      `SELECT ms.*, u1.name as mentor_name, u2.name as mentee_name,
        mpro.position as mentor_position, mpro.company as mentor_company
       FROM mentoring_sessions ms
       LEFT JOIN mentor_profiles mpro ON mpro.id = ms.mentor_id
       LEFT JOIN users u1 ON u1.id = mpro.alumni_id
       LEFT JOIN users u2 ON u2.id = ms.mentee_id
       WHERE ms.id = $1 AND ms.tenant_id = $2`, [req.params.id, t]);
    if (!session.rows.length) return res.status(404).send('Session not found');
    const s = session.rows[0];
    const actionItems = Array.isArray(s.action_items) ? s.action_items : [];

    const html = renderPage('Session Notes', SKIP + nav('schedule') + `
      <div style="max-width:800px;margin:0 auto;">
        <a href="/school/alumni-mentoring/session-notes?pair_id=${s.pair_id}" style="color:${P};font-size:14px;font-weight:600;">← Back to all sessions</a>
        <div class="card" style="margin-top:12px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px;">
            <div>
              <h1 style="margin:0 0 4px;font-size:20px;color:${TXT};">${esc(s.topic || 'Untitled Session')}</h1>
              <p style="margin:0;color:${GRAY};font-size:13px;">
                ${esc(s.mentor_name || 'Mentor')} → ${esc(s.mentee_name || 'Mentee')}
                · ${s.date ? s.date.toISOString().slice(0, 10) : 'N/A'}
                · ${s.duration_min || 30} min
                · ${esc(s.meeting_type || 'virtual')}
              </p>
            </div>
            ${statusBadge(s.status)}
          </div>

          <div style="background:${BG2};border-radius:10px;padding:16px;margin-bottom:16px;">
            <h3 style="margin:0 0 8px;font-size:15px;color:${TXT};">Meeting Notes</h3>
            <p style="margin:0;color:${TXT};line-height:1.7;font-size:14px;white-space:pre-wrap;">${esc(s.notes || 'No notes recorded for this session.')}</p>
          </div>

          ${actionItems.length > 0 ? `
            <div style="margin-bottom:16px;">
              <h3 style="margin:0 0 8px;font-size:15px;color:${TXT};">Action Items</h3>
              ${actionItems.map((item, i) => `
                <div style="display:flex;align-items:start;gap:8px;margin-bottom:6px;">
                  <span style="background:${P};color:#fff;width:22px;height:22px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0;">${i + 1}</span>
                  <span style="color:${TXT};font-size:14px;">${esc(typeof item === 'string' ? item : item.text || JSON.stringify(item))}</span>
                </div>`).join('')}
            </div>` : ''}

          ${s.satisfaction_rating ? `
            <div style="margin-bottom:16px;">
              <h3 style="margin:0 0 8px;font-size:15px;color:${TXT};">Satisfaction Rating</h3>
              ${starsHtml(s.satisfaction_rating, 20)}
            </div>` : ''}

          ${s.status === 'scheduled' ? `
            <form method="post" action="/school/alumni-mentoring/api/sessions/${s.id}/complete" class="card" style="background:${BG2};">
              <h3 style="margin:0 0 12px;font-size:15px;color:${TXT};">Complete This Session</h3>
              <div style="margin-bottom:12px;">
                <label style="display:block;font-weight:600;color:${TXT};margin-bottom:4px;">Session Notes</label>
                <textarea name="notes" rows="4" placeholder="Summary of discussion...">${esc(s.notes || '')}</textarea>
              </div>
              <div style="margin-bottom:12px;">
                <label style="display:block;font-weight:600;color:${TXT};margin-bottom:4px;">Action Items (one per line)</label>
                <textarea name="action_items" rows="3" placeholder="Follow up on resume&#10;Research industry certifications&#10;Schedule mock interview">${actionItems.map(a => typeof a === 'string' ? a : a.text || '').join('\n')}</textarea>
              </div>
              <div style="margin-bottom:12px;">
                <label style="display:block;font-weight:600;color:${TXT};margin-bottom:4px;">Satisfaction Rating</label>
                <select name="satisfaction_rating">
                  <option value="0">Not rated</option>
                  <option value="1">1 - Poor</option>
                  <option value="2">2 - Fair</option>
                  <option value="3">3 - Good</option>
                  <option value="4">4 - Very Good</option>
                  <option value="5">5 - Excellent</option>
                </select>
              </div>
              <button type="submit" class="btn" style="background:${GREEN};">Mark as Completed</button>
            </form>` : ''}
        </div>
      </div>
    `, req.session?.user);
    res.send(html);
  }));

  // Session notes list (by pair)
  app.get('/school/alumni-mentoring/session-notes', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const pairId = req.query.pair_id;

    let sessions;
    if (pairId) {
      sessions = await pool.query(
        `SELECT ms.*, u1.name as mentor_name, u2.name as mentee_name
         FROM mentoring_sessions ms
         LEFT JOIN mentor_profiles mpro ON mpro.id = ms.mentor_id
         LEFT JOIN users u1 ON u1.id = mpro.alumni_id
         LEFT JOIN users u2 ON u2.id = ms.mentee_id
         WHERE ms.tenant_id = $1 AND ms.pair_id = $2
         ORDER BY ms.date DESC`, [t, pairId]);
    } else {
      sessions = await pool.query(
        `SELECT ms.*, u1.name as mentor_name, u2.name as mentee_name
         FROM mentoring_sessions ms
         LEFT JOIN mentor_profiles mpro ON mpro.id = ms.mentor_id
         LEFT JOIN users u1 ON u1.id = mpro.alumni_id
         LEFT JOIN users u2 ON u2.id = ms.mentee_id
         WHERE ms.tenant_id = $1
         ORDER BY ms.date DESC LIMIT 50`, [t]);
    }

    const html = renderPage('Session Notes', SKIP + nav('schedule') + `
      <div style="max-width:1000px;margin:0 auto;">
        <h1 style="margin:0 0 16px;font-size:24px;color:${TXT};">Session Notes</h1>
        ${sessions.rows.length === 0
          ? `<div class="card" style="text-align:center;padding:40px;color:${GRAY};"><p>No sessions recorded yet.</p></div>`
          : `<table>
              <tr><th>Date</th><th>Mentor</th><th>Mentee</th><th>Topic</th><th>Duration</th><th>Rating</th><th>Status</th><th>Actions</th></tr>
              ${sessions.rows.map(s => `<tr>
                <td>${s.date ? s.date.toISOString().slice(0, 10) : 'N/A'}</td>
                <td>${esc(s.mentor_name || 'N/A')}</td>
                <td>${esc(s.mentee_name || 'N/A')}</td>
                <td>${esc(s.topic || '-')}</td>
                <td>${s.duration_min || 30}m</td>
                <td>${s.satisfaction_rating ? starsHtml(s.satisfaction_rating, 12) : '-'}</td>
                <td>${statusBadge(s.status)}</td>
                <td><a href="/school/alumni-mentoring/session-notes/${s.id}" style="color:${P};font-weight:600;font-size:13px;">View</a></td>
              </tr>`).join('')}
            </table>`}
      </div>
    `, req.session?.user);
    res.send(html);
  }));

  // API: Complete session
  app.post('/school/alumni-mentoring/api/sessions/:id/complete', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const { notes, action_items, satisfaction_rating } = req.body;
    const actionArr = typeof action_items === 'string'
      ? action_items.split('\n').map(s => s.trim()).filter(Boolean)
      : (Array.isArray(action_items) ? action_items : []);

    const result = await pool.query(
      `UPDATE mentoring_sessions SET status = $1, notes = $2, action_items = $3,
        satisfaction_rating = $4, completed_at = NOW(), updated_at = NOW()
       WHERE id = $5 AND tenant_id = $6 AND status = $7 RETURNING *`,
      ['completed_session', notes || '', JSON.stringify(actionArr),
       parseNum(satisfaction_rating, 0), req.params.id, t, 'scheduled']);

    if (result.rows.length) {
      await pool.query(
        `UPDATE mentor_profiles SET total_sessions = total_sessions + 1, updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2`,
        [result.rows[0].mentor_id, t]);
    }

    audit('mentoring_session_completed', { sessionId: +req.params.id, tenant: t });
    res.redirect(`/school/alumni-mentoring/session-notes/${req.params.id}`);
  }));

  // ============================================================
  // 9. GOALS — Goal setting and tracking
  // ============================================================
  app.get('/school/alumni-mentoring/goals', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const userId = uid(req);

    const goals = await pool.query(
      `SELECT mg.*, mp2.status as pair_status, u1.name as mentor_name, u2.name as mentee_name
       FROM mentor_goals mg
       LEFT JOIN mentoring_pairs mp2 ON mp2.id = mg.pair_id
       LEFT JOIN mentor_profiles mpro ON mpro.id = mp2.mentor_id
       LEFT JOIN users u1 ON u1.id = mpro.alumni_id
       LEFT JOIN users u2 ON u2.id = mp2.mentee_id
       WHERE mg.tenant_id = $1
       ORDER BY mg.created_at DESC LIMIT 100`, [t]);

    const activePairs = await pool.query(
      `SELECT mp2.id, u1.name as mentor_name, u2.name as mentee_name
       FROM mentoring_pairs mp2
       LEFT JOIN mentor_profiles mpro ON mpro.id = mp2.mentor_id
       LEFT JOIN users u1 ON u1.id = mpro.alumni_id
       LEFT JOIN users u2 ON u2.id = mp2.mentee_id
       WHERE mp2.tenant_id = $1 AND mp2.status = 'active'
       AND (mpro.alumni_id = $2 OR mp2.mentee_id = $2)`, [t, userId]);

    const goalsHtml = goals.rows.map(g => {
      const pct = parseNum(g.progress, 0);
      const barColor = pct >= 75 ? GREEN : pct >= 40 ? WARN : RED;
      return `
        <div class="card">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
            <div style="font-weight:600;color:${TXT};font-size:15px;">${esc(g.goal_text)}</div>
            ${statusBadge(g.status)}
          </div>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
            <span style="font-size:12px;color:${GRAY};background:${BG2};padding:2px 10px;border-radius:10px;">${esc(g.goal_category || 'general')}</span>
            ${g.target_date ? `<span style="font-size:12px;color:${GRAY};">Due: ${g.target_date.toISOString().slice(0, 10)}</span>` : ''}
            <span style="font-size:12px;color:${GRAY};">${esc(g.mentor_name || 'Mentor')} → ${esc(g.mentee_name || 'Mentee')}</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <div style="flex:1;background:#e5e7eb;border-radius:6px;height:8px;overflow:hidden;">
              <div style="background:${barColor};height:100%;width:${pct}%;border-radius:6px;transition:width 0.3s;"></div>
            </div>
            <span style="font-size:13px;font-weight:600;color:${barColor};min-width:36px;text-align:right;">${pct}%</span>
          </div>
          ${g.notes ? `<div style="margin-top:8px;font-size:13px;color:${GRAY};">${esc(g.notes)}</div>` : ''}
          <form method="post" action="/school/alumni-mentoring/api/goals/${g.id}/progress" style="display:flex;gap:6px;margin-top:8px;">
            <input type="number" name="progress" value="${pct}" min="0" max="100" style="width:70px;padding:4px 8px;font-size:13px;">
            <select name="status" style="width:120px;padding:4px 8px;font-size:13px;">
              <option value="not_started" ${g.status === 'not_started' ? 'selected' : ''}>Not Started</option>
              <option value="in_progress" ${g.status === 'in_progress' ? 'selected' : ''}>In Progress</option>
              <option value="completed" ${g.status === 'completed' ? 'selected' : ''}>Completed</option>
              <option value="blocked" ${g.status === 'blocked' ? 'selected' : ''}>Blocked</option>
            </select>
            <button type="submit" class="btn" style="padding:4px 12px;font-size:13px;">Update</button>
          </form>
        </div>`;
    }).join('');

    const html = renderPage('Mentoring Goals', SKIP + nav('goals') + `
      <div style="max-width:900px;margin:0 auto;">
        <h1 style="margin:0 0 16px;font-size:24px;color:${TXT};">Goal Tracking</h1>

        <!-- Add goal form -->
        <form method="post" action="/school/alumni-mentoring/api/goals" class="card" style="background:${BG2};">
          <h3 style="margin:0 0 12px;font-size:16px;color:${TXT};">Add New Goal</h3>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px;">
            <div>
              <label style="display:block;font-weight:600;color:${TXT};margin-bottom:4px;">Mentoring Pair</label>
              <select name="pair_id" required>
                <option value="">Select pair...</option>
                ${activePairs.rows.map(p => `<option value="${p.id}">${esc(p.mentor_name || 'M')} → ${esc(p.mentee_name || 'Me')}</option>`).join('')}
              </select>
            </div>
            <div>
              <label style="display:block;font-weight:600;color:${TXT};margin-bottom:4px;">Category</label>
              <select name="goal_category">
                <option value="career">Career Development</option>
                <option value="academic">Academic</option>
                <option value="skills">Skills Building</option>
                <option value="networking">Networking</option>
                <option value="personal">Personal Growth</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label style="display:block;font-weight:600;color:${TXT};margin-bottom:4px;">Target Date</label>
              <input type="date" name="target_date">
            </div>
          </div>
          <div style="margin-bottom:12px;">
            <label style="display:block;font-weight:600;color:${TXT};margin-bottom:4px;">Goal Description</label>
            <input type="text" name="goal_text" placeholder="e.g., Complete professional certification by June" required>
          </div>
          <button type="submit" class="btn">Add Goal</button>
        </form>

        ${goalsHtml || `<div class="card" style="text-align:center;padding:40px;color:${GRAY};"><p>No goals set yet. Create your first goal above.</p></div>`}
      </div>
    `, req.session?.user);
    res.send(html);
  }));

  // API: Create goal
  app.post('/school/alumni-mentoring/api/goals', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const { pair_id, goal_text, goal_category, target_date } = req.body;
    if (!pair_id || !goal_text) return res.status(400).json({ error: 'pair_id and goal_text required' });
    await pool.query(
      `INSERT INTO mentor_goals (tenant_id, pair_id, goal_text, goal_category, target_date)
       VALUES ($1, $2, $3, $4, $5)`,
      [t, pair_id, goal_text, goal_category || 'career', target_date || null]);
    audit('mentor_goal_created', { pairId: pair_id, tenant: t });
    res.redirect('/school/alumni-mentoring/goals');
  }));

  // API: Update goal progress
  app.post('/school/alumni-mentoring/api/goals/:id/progress', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    await pool.query(
      `UPDATE mentor_goals SET progress = $1, status = $2, updated_at = NOW()
       WHERE id = $3 AND tenant_id = $4`,
      [Math.min(100, Math.max(0, parseNum(req.body.progress, 0))),
       req.body.status || 'in_progress', req.params.id, t]);
    audit('mentor_goal_updated', { goalId: +req.params.id, tenant: t });
    res.redirect('/school/alumni-mentoring/goals');
  }));

  // ============================================================
  // 10. REPORTS — Progress reports for pairs
  // ============================================================
  app.get('/school/alumni-mentoring/reports', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const pairs = await pool.query(
      `SELECT mp2.id, mp2.status, mp2.started_at, mp2.ended_at, mp2.goals,
        u1.name as mentor_name, u2.name as mentee_name,
        mpro.position, mpro.company, mpro.industry,
        COUNT(ms.id)::int as session_count,
        COALESCE(AVG(ms.satisfaction_rating), 0)::numeric(3,2) as avg_rating,
        COALESCE(SUM(ms.duration_min), 0)::int as total_minutes
       FROM mentoring_pairs mp2
       LEFT JOIN mentor_profiles mpro ON mpro.id = mp2.mentor_id
       LEFT JOIN users u1 ON u1.id = mpro.alumni_id
       LEFT JOIN users u2 ON u2.id = mp2.mentee_id
       LEFT JOIN mentoring_sessions ms ON ms.pair_id = mp2.id AND ms.status = 'completed_session'
       WHERE mp2.tenant_id = $1
       GROUP BY mp2.id, u1.name, u2.name, mpro.position, mpro.company, mpro.industry
       ORDER BY mp2.started_at DESC LIMIT 50`, [t]);

    const completedGoals = await pool.query(
      `SELECT pair_id, COUNT(*)::int as completed, COUNT(*) FILTER (WHERE status = 'completed')::int as done
       FROM mentor_goals WHERE tenant_id = $1 GROUP BY pair_id`, [t]);

    const goalMap = {};
    completedGoals.rows.forEach(g => { goalMap[g.pair_id] = g; });

    const reportHtml = pairs.rows.map(p => {
      const gm = goalMap[p.id] || {};
      const hours = Math.round((p.total_minutes || 0) / 60);
      const goalProgress = gm.completed ? Math.round((gm.done || 0) / gm.completed * 100) : 0;
      return `
        <div class="card">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
            <div>
              <div style="font-weight:600;color:${TXT};font-size:16px;">
                ${esc(p.mentor_name || 'Mentor')} → ${esc(p.mentee_name || 'Mentee')}
              </div>
              <div style="color:${GRAY};font-size:13px;">
                ${esc(p.position || '')} ${p.company ? 'at ' + esc(p.company) : ''}
                ${p.industry ? ' · ' + esc(p.industry) : ''}
              </div>
            </div>
            ${statusBadge(p.status)}
          </div>
          <div style="display:grid;grid-template-columns:repeat(4, 1fr);gap:12px;margin-bottom:12px;">
            <div style="text-align:center;background:${BG2};padding:12px;border-radius:8px;">
              <div style="font-size:20px;font-weight:700;color:${P};">${p.session_count || 0}</div>
              <div style="font-size:11px;color:${GRAY};">Sessions</div>
            </div>
            <div style="text-align:center;background:${BG2};padding:12px;border-radius:8px;">
              <div style="font-size:20px;font-weight:700;color:${GREEN};">${hours}h</div>
              <div style="font-size:11px;color:${GRAY};">Total Time</div>
            </div>
            <div style="text-align:center;background:${BG2};padding:12px;border-radius:8px;">
              <div style="font-size:20px;font-weight:700;color:${WARN};">${p.avg_rating > 0 ? p.avg_rating.toFixed(1) : '-'}</div>
              <div style="font-size:11px;color:${GRAY};">Avg Rating</div>
            </div>
            <div style="text-align:center;background:${BG2};padding:12px;border-radius:8px;">
              <div style="font-size:20px;font-weight:700;color:#7c3aed;">${goalProgress}%</div>
              <div style="font-size:11px;color:${GRAY};">Goals Done</div>
            </div>
          </div>
        </div>`;
    }).join('');

    const html = renderPage('Progress Reports', SKIP + nav('reports') + `
      <div style="max-width:900px;margin:0 auto;">
        <h1 style="margin:0 0 16px;font-size:24px;color:${TXT};">Progress Reports</h1>
        ${reportHtml || `<div class="card" style="text-align:center;padding:40px;color:${GRAY};"><p>No mentoring pairs to report on.</p></div>`}
      </div>
    `, req.session?.user);
    res.send(html);
  }));

  // ============================================================
  // 11. SUCCESS STORIES — Share and browse inspiring outcomes
  // ============================================================
  app.get('/school/alumni-mentoring/success-stories', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const stories = await pool.query(
      `SELECT ss.*, u1.name as mentor_name, u2.name as mentee_name
       FROM success_stories ss
       LEFT JOIN mentor_profiles mpro ON mpro.id = ss.mentor_id
       LEFT JOIN users u1 ON u1.id = mpro.alumni_id
       LEFT JOIN users u2 ON u2.id = ss.mentee_id
       WHERE ss.tenant_id = $1 AND ss.is_approved = true
       ORDER BY ss.is_featured DESC, ss.created_at DESC LIMIT 30`, [t]);

    const storiesHtml = stories.rows.map(s => `
      <div class="card" style="${s.is_featured ? 'border-left:4px solid ' + WARN + ';' : ''}">
        ${s.is_featured ? '<span style="background:#fef3c7;color:#92400e;padding:2px 10px;border-radius:10px;font-size:11px;font-weight:600;">Featured</span>' : ''}
        <h3 style="margin:8px 0 4px;font-size:18px;color:${TXT};">${esc(s.title)}</h3>
        <div style="color:${GRAY};font-size:13px;margin-bottom:8px;">
          ${esc(s.mentor_name || 'Mentor')} → ${esc(s.mentee_name || 'Mentee')}
          · ${s.created_at ? s.created_at.toISOString().slice(0, 10) : ''}
        </div>
        <p style="color:${TXT};font-size:14px;line-height:1.6;margin:0 0 8px;">${esc(s.story || '')}</p>
        ${s.outcome ? `<div style="background:${PBG};padding:10px;border-radius:8px;font-size:13px;color:${P};font-weight:500;">Outcome: ${esc(s.outcome)}</div>` : ''}
      </div>`).join('');

    const html = renderPage('Success Stories', SKIP + nav('stories') + `
      <div style="max-width:900px;margin:0 auto;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
          <h1 style="margin:0;font-size:24px;color:${TXT};">Success Stories</h1>
          <a href="/school/alumni-mentoring/success-stories/submit" class="btn" style="text-decoration:none;">Share Your Story</a>
        </div>
        ${storiesHtml || `<div class="card" style="text-align:center;padding:40px;color:${GRAY};">
          <p style="font-size:16px;">No success stories yet.</p>
          <p style="font-size:14px;">Completed a mentoring journey? Share your experience to inspire others!</p>
          <a href="/school/alumni-mentoring/success-stories/submit" style="color:${P};font-weight:600;">Share your story →</a>
        </div>`}
      </div>
    `, req.session?.user);
    res.send(html);
  }));

  // Submit success story
  app.get('/school/alumni-mentoring/success-stories/submit', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const userId = uid(req);

    const completedPairs = await pool.query(
      `SELECT mp2.id, u1.name as mentor_name, u2.name as mentee_name
       FROM mentoring_pairs mp2
       LEFT JOIN mentor_profiles mpro ON mpro.id = mp2.mentor_id
       LEFT JOIN users u1 ON u1.id = mpro.alumni_id
       LEFT JOIN users u2 ON u2.id = mp2.mentee_id
       WHERE mp2.tenant_id = $1 AND mp2.status = 'completed'
       AND (mpro.alumni_id = $2 OR mp2.mentee_id = $2)`, [t, userId]);

    const html = renderPage('Share Success Story', SKIP + nav('stories') + `
      <div style="max-width:700px;margin:0 auto;">
        <h1 style="margin:0 0 8px;font-size:24px;color:${TXT};">Share Your Success Story</h1>
        <p style="color:${GRAY};margin:0 0 20px;">Inspire others by sharing your mentoring experience.</p>
        <form method="post" action="/school/alumni-mentoring/api/success-stories" class="card">
          <div style="margin-bottom:16px;">
            <label style="display:block;font-weight:600;color:${TXT};margin-bottom:4px;">Mentoring Pair</label>
            <select name="pair_id">
              <option value="">Select completed pair...</option>
              ${completedPairs.rows.map(p => `<option value="${p.id}">${esc(p.mentor_name)} → ${esc(p.mentee_name)}</option>`).join('')}
            </select>
          </div>
          <div style="margin-bottom:16px;">
            <label style="display:block;font-weight:600;color:${TXT};margin-bottom:4px;">Title</label>
            <input type="text" name="title" placeholder="e.g., From Student to Software Engineer" required>
          </div>
          <div style="margin-bottom:16px;">
            <label style="display:block;font-weight:600;color:${TXT};margin-bottom:4px;">Your Story</label>
            <textarea name="story" rows="6" placeholder="Describe your mentoring journey, challenges, and how your mentor helped..." required></textarea>
          </div>
          <div style="margin-bottom:16px;">
            <label style="display:block;font-weight:600;color:${TXT};margin-bottom:4px;">Outcome / Result</label>
            <textarea name="outcome" rows="3" placeholder="e.g., Landed a job at Google, Got accepted to MIT..."></textarea>
          </div>
          <div style="margin-bottom:16px;">
            <label style="display:block;font-weight:600;color:${TXT};margin-bottom:4px;">Photo URL (optional)</label>
            <input type="url" name="photo_url" placeholder="https://example.com/photo.jpg">
          </div>
          <button type="submit" class="btn" style="width:100%;padding:12px;font-size:16px;">Submit Story</button>
        </form>
      </div>
    `, req.session?.user);
    res.send(html);
  }));

  // API: Submit success story
  app.post('/school/alumni-mentoring/api/success-stories', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const userId = uid(req);
    const { pair_id, title, story, outcome, photo_url } = req.body;
    if (!title || !story) return res.status(400).json({ error: 'title and story are required' });

    const pair = pair_id
      ? await pool.query('SELECT mentor_id, mentee_id FROM mentoring_pairs WHERE id = $1 AND tenant_id = $2', [pair_id, t])
      : { rows: [{ mentor_id: 0, mentee_id: userId }] };

    await pool.query(
      `INSERT INTO success_stories (tenant_id, pair_id, mentor_id, mentee_id, title, story, outcome, photo_url, author_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [t, pair_id || null, pair.rows[0]?.mentor_id || 0, pair.rows[0]?.mentee_id || userId,
       title, story, outcome || '', photo_url || '', userId]);

    audit('success_story_submitted', { pairId: pair_id, tenant: t });
    res.redirect('/school/alumni-mentoring/success-stories');
  }));

  // ============================================================
  // 12. ANALYTICS — Program analytics and charts
  // ============================================================
  app.get('/school/alumni-mentoring/analytics', requireAuth, ah(async (req, res) => {
    const t = tid(req);

    // Overall stats
    const totalMentors = await pool.query('SELECT COUNT(*)::int as c FROM mentor_profiles WHERE tenant_id = $1 AND is_active = true', [t]);
    const totalPairs = await pool.query('SELECT COUNT(*)::int as c FROM mentoring_pairs WHERE tenant_id = $1', [t]);
    const activePairs = await pool.query('SELECT COUNT(*)::int as c FROM mentoring_pairs WHERE tenant_id = $1 AND status = $2', [t, 'active']);
    const completedPairs = await pool.query('SELECT COUNT(*)::int as c FROM mentoring_pairs WHERE tenant_id = $1 AND status = $2', [t, 'completed']);
    const totalSessions = await pool.query('SELECT COUNT(*)::int as c FROM mentoring_sessions WHERE tenant_id = $1', [t]);
    const completedSessions = await pool.query('SELECT COUNT(*)::int as c FROM mentoring_sessions WHERE tenant_id = $1 AND status = $2', [t, 'completed_session']);
    const totalHours = await pool.query('SELECT COALESCE(SUM(duration_min), 0)::int as c FROM mentoring_sessions WHERE tenant_id = $1 AND status = $2', [t, 'completed_session']);
    const avgRating = await pool.query('SELECT COALESCE(AVG(satisfaction_rating), 0)::numeric(3,2) as c FROM mentoring_sessions WHERE tenant_id = $1 AND satisfaction_rating > 0', [t]);

    // Industry distribution
    const industryDist = await pool.query(
      'SELECT industry, COUNT(*)::int as cnt FROM mentor_profiles WHERE tenant_id = $1 AND is_active = true AND industry IS NOT NULL AND industry != \'\' GROUP BY industry ORDER BY cnt DESC LIMIT 10', [t]);

    // Monthly sessions trend (last 6 months)
    const monthlySessions = await pool.query(
      `SELECT TO_CHAR(date, 'YYYY-MM') as month, COUNT(*)::int as cnt
       FROM mentoring_sessions
       WHERE tenant_id = $1 AND date >= CURRENT_DATE - INTERVAL '6 months'
       GROUP BY TO_CHAR(date, 'YYYY-MM') ORDER BY month`, [t]);

    // Pair status distribution
    const statusDist = await pool.query(
      'SELECT status, COUNT(*)::int as cnt FROM mentoring_pairs WHERE tenant_id = $1 GROUP BY status ORDER BY cnt DESC', [t]);

    // Goals completion
    const goalStats = await pool.query(
      'SELECT COUNT(*)::int as total, COUNT(*) FILTER (WHERE status = $2)::int as completed FROM mentor_goals WHERE tenant_id = $1', [t, 'completed']);

    // Top mentors by sessions
    const topMentors = await pool.query(
      `SELECT mp.id, u.name, mp.total_sessions, mp.rating, mp.company, mp.position
       FROM mentor_profiles mp
       LEFT JOIN users u ON u.id = mp.alumni_id
       WHERE mp.tenant_id = $1 AND mp.is_active = true
       ORDER BY mp.total_sessions DESC LIMIT 5`, [t]);

    // Build SVG bar chart for monthly sessions
    const maxSessions = Math.max(...monthlySessions.rows.map(r => r.cnt), 1);
    const barColors = ['#4f46e5','#7c3aed','#2563eb','#0891b2','#059669','#d97706'];
    let barChart = monthlySessions.rows.map((r, i) => {
      const h = Math.max(4, (r.cnt / maxSessions) * 100);
      return `<div style="display:flex;flex-direction:column;align-items:center;flex:1;">
        <div style="font-size:11px;font-weight:600;color:${TXT};margin-bottom:4px;">${r.cnt}</div>
        <div style="width:32px;height:${h}px;background:${barColors[i % barColors.length]};border-radius:4px 4px 0 0;"></div>
        <div style="font-size:10px;color:${GRAY};margin-top:4px;">${esc(r.month.slice(5))}</div>
      </div>`;
    }).join('');

    // Build pie chart for pair status
    const statusColors = { active: '#059669', completed: '#2563eb', pending: '#d97706', paused: '#6b7280', cancelled: '#dc2626' };
    let totalPairCount = statusDist.rows.reduce((s, r) => s + r.cnt, 0) || 1;
    let pieData = statusDist.rows.map(r => ({
      label: r.status,
      count: r.cnt,
      pct: Math.round((r.cnt / totalPairCount) * 100),
      color: statusColors[r.status] || '#9ca3af'
    }));

    // Build SVG donut for industries
    const indColors = ['#4f46e5','#7c3aed','#2563eb','#0891b2','#059669','#d97706','#dc2626','#db2777','#6366f1','#0ea5e9'];
    let indDonut = '';
    let cumPct = 0;
    const indTotal = industryDist.rows.reduce((s, r) => s + r.cnt, 0) || 1;
    industryDist.rows.forEach((r, i) => {
      const pct = (r.cnt / indTotal) * 100;
      const startAngle = cumPct * 3.6;
      const endAngle = (cumPct + pct) * 3.6;
      const x1 = 50 + 38 * Math.cos((startAngle - 90) * Math.PI / 180);
      const y1 = 50 + 38 * Math.sin((startAngle - 90) * Math.PI / 180);
      const x2 = 50 + 38 * Math.cos((endAngle - 90) * Math.PI / 180);
      const y2 = 50 + 38 * Math.sin((endAngle - 90) * Math.PI / 180);
      const largeArc = pct > 50 ? 1 : 0;
      if (pct > 1) {
        indDonut += `<path d="M${x1},${y1} A38,38 0 ${largeArc},1 ${x2},${y2} L50,50 Z" fill="${indColors[i % indColors.length]}" stroke="white" stroke-width="1.5"/>`;
      }
      cumPct += pct;
    });

    const html = renderPage('Program Analytics', SKIP + nav('analytics') + `
      <div style="max-width:1200px;margin:0 auto;">
        <h1 style="margin:0 0 16px;font-size:24px;color:${TXT};">Program Analytics</h1>

        <!-- Top-level KPIs -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:24px;">
          <div class="card" style="text-align:center;padding:16px;">
            <div style="font-size:28px;font-weight:700;color:${P};">${totalMentors.rows[0].c}</div>
            <div style="color:${GRAY};font-size:12px;">Total Mentors</div>
          </div>
          <div class="card" style="text-align:center;padding:16px;">
            <div style="font-size:28px;font-weight:700;color:${GREEN};">${activePairs.rows[0].c}</div>
            <div style="color:${GRAY};font-size:12px;">Active Pairs</div>
          </div>
          <div class="card" style="text-align:center;padding:16px;">
            <div style="font-size:28px;font-weight:700;color:#2563eb;">${completedSessions.rows[0].c}</div>
            <div style="color:${GRAY};font-size:12px;">Sessions Done</div>
          </div>
          <div class="card" style="text-align:center;padding:16px;">
            <div style="font-size:28px;font-weight:700;color:${WARN};">${Math.round((totalHours.rows[0].c || 0) / 60)}h</div>
            <div style="color:${GRAY};font-size:12px;">Total Hours</div>
          </div>
          <div class="card" style="text-align:center;padding:16px;">
            <div style="font-size:28px;font-weight:700;color:#7c3aed;">${avgRating.rows[0].c > 0 ? avgRating.rows[0].c.toFixed(1) : '-'}</div>
            <div style="color:${GRAY};font-size:12px;">Avg Satisfaction</div>
          </div>
          <div class="card" style="text-align:center;padding:16px;">
            <div style="font-size:28px;font-weight:700;color:#059669;">${goalStats.rows[0].total > 0 ? Math.round(goalStats.rows[0].completed / goalStats.rows[0].total * 100) : 0}%</div>
            <div style="color:${GRAY};font-size:12px;">Goals Completed</div>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px;">
          <!-- Monthly Sessions Bar Chart -->
          <div class="card">
            <h2 style="margin:0 0 16px;font-size:16px;color:${TXT};">Monthly Sessions (Last 6 months)</h2>
            <div style="display:flex;align-items:flex-end;gap:8px;height:140px;padding:0 8px;">
              ${barChart || `<div style="color:${GRAY};font-size:14px;">No session data yet.</div>`}
            </div>
          </div>

          <!-- Pair Status Distribution -->
          <div class="card">
            <h2 style="margin:0 0 16px;font-size:16px;color:${TXT};">Pair Status Distribution</h2>
            <div style="display:flex;flex-wrap:wrap;gap:8px;">
              ${pieData.map(d => `
                <div style="display:flex;align-items:center;gap:6px;background:${BG2};padding:8px 14px;border-radius:8px;">
                  <span style="width:12px;height:12px;border-radius:3px;background:${d.color};"></span>
                  <span style="font-size:13px;color:${TXT};font-weight:500;">${esc(d.label)}</span>
                  <span style="font-size:13px;color:${GRAY};">${d.count} (${d.pct}%)</span>
                </div>`).join('')}
            </div>
          </div>

          <!-- Industry Distribution Donut -->
          <div class="card">
            <h2 style="margin:0 0 16px;font-size:16px;color:${TXT};">Mentor Industries</h2>
            <div style="display:flex;align-items:center;gap:20px;">
              <svg width="140" height="140" viewBox="0 0 100 100" role="img" aria-label="Industry distribution">
                <circle cx="50" cy="50" r="24" fill="white"/>
                ${indDonut}
              </svg>
              <div style="display:flex;flex-direction:column;gap:4px;">
                ${industryDist.rows.map((r, i) => `
                  <div style="display:flex;align-items:center;gap:6px;font-size:12px;">
                    <span style="width:10px;height:10px;border-radius:2px;background:${indColors[i % indColors.length]};"></span>
                    <span style="color:${TXT};">${esc(r.industry)}</span>
                    <span style="color:${GRAY};">${r.cnt}</span>
                  </div>`).join('')}
              </div>
            </div>
          </div>

          <!-- Top Mentors -->
          <div class="card">
            <h2 style="margin:0 0 16px;font-size:16px;color:${TXT};">Top Mentors</h2>
            ${topMentors.rows.length === 0
              ? `<p style="color:${GRAY};font-size:14px;">No mentor data yet.</p>`
              : topMentors.rows.map((m, i) => `
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
                  <span style="font-size:16px;font-weight:700;color:${i === 0 ? WARN : GRAY};">#${i + 1}</span>
                  <div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,${P},${PL});display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:13px;">
                    ${(m.name || 'M')[0]}
                  </div>
                  <div style="flex:1;">
                    <div style="font-weight:600;color:${TXT};font-size:14px;">${esc(m.name || 'Unknown')}</div>
                    <div style="color:${GRAY};font-size:11px;">${esc(m.position || '')} ${m.company ? 'at ' + esc(m.company) : ''}</div>
                  </div>
                  <div style="text-align:right;">
                    <div style="font-weight:600;color:${P};font-size:14px;">${m.total_sessions} sessions</div>
                    <div>${starsHtml(parseNum(m.rating, 0), 11)}</div>
                  </div>
                </div>`).join('')}
          </div>
        </div>

        <!-- Program Health Summary -->
        <div class="card">
          <h2 style="margin:0 0 12px;font-size:16px;color:${TXT};">Program Health Summary</h2>
          <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:16px;">
            <div style="text-align:center;">
              <div style="font-size:13px;color:${GRAY};margin-bottom:4px;">Pair Completion Rate</div>
              <div style="font-size:24px;font-weight:700;color:${GREEN};">${totalPairs.rows[0].c > 0 ? Math.round(completedPairs.rows[0].c / totalPairs.rows[0].c * 100) : 0}%</div>
            </div>
            <div style="text-align:center;">
              <div style="font-size:13px;color:${GRAY};margin-bottom:4px;">Session Completion Rate</div>
              <div style="font-size:24px;font-weight:700;color:#2563eb;">${totalSessions.rows[0].c > 0 ? Math.round(completedSessions.rows[0].c / totalSessions.rows[0].c * 100) : 0}%</div>
            </div>
            <div style="text-align:center;">
              <div style="font-size:13px;color:${GRAY};margin-bottom:4px;">Avg Hours per Pair</div>
              <div style="font-size:24px;font-weight:700;color:${WARN};">${activePairs.rows[0].c > 0 ? (Math.round((totalHours.rows[0].c || 0) / 60 / activePairs.rows[0].c * 10) / 10) : 0}</div>
            </div>
          </div>
        </div>
      </div>
    `, req.session?.user);
    res.send(html);
  }));

  // ============================================================
  // 13. COMMUNICATION LOG — API for logging messages
  // ============================================================
  app.post('/school/alumni-mentoring/api/communication', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const userId = uid(req);
    const { pair_id, receiver_id, message_type, subject, body, sent_via } = req.body;
    if (!pair_id || !receiver_id || !body) return res.status(400).json({ error: 'pair_id, receiver_id, and body are required' });

    await pool.query(
      `INSERT INTO mentor_communication_log (tenant_id, pair_id, sender_id, receiver_id, message_type, subject, body, sent_via)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [t, pair_id, userId, receiver_id, message_type || 'message', subject || '', body, sent_via || 'in_app']);

    audit('mentoring_message_sent', { pairId: pair_id, receiverId: receiver_id, tenant: t });
    res.json({ success: true });
  }));

  app.get('/school/alumni-mentoring/api/communication/:pairId', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const userId = uid(req);
    const messages = await pool.query(
      `SELECT cl.*, u.name as sender_name
       FROM mentor_communication_log cl
       LEFT JOIN users u ON u.id = cl.sender_id
       WHERE cl.tenant_id = $1 AND cl.pair_id = $2
       AND (cl.sender_id = $3 OR cl.receiver_id = $3)
       ORDER BY cl.created_at DESC LIMIT 100`,
      [t, req.params.pairId, userId]);

    res.json({ success: true, messages: messages.rows });
  }));

  // ============================================================
  // 14. API ENDPOINTS — Mentor profiles CRUD
  // ============================================================

  // Get mentor profile by ID (API)
  app.get('/school/alumni-mentoring/api/mentors/:id', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const r = await pool.query(
      `SELECT mp.*, u.name as alumni_name, u.email as alumni_email
       FROM mentor_profiles mp LEFT JOIN users u ON u.id = mp.alumni_id
       WHERE mp.id = $1 AND mp.tenant_id = $2`, [req.params.id, t]);
    if (!r.rows.length) return res.status(404).json({ error: 'Mentor not found' });
    res.json({ success: true, mentor: r.rows[0] });
  }));

  // Toggle mentor active status
  app.post('/school/alumni-mentoring/api/mentors/:id/toggle', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const r = await pool.query(
      'UPDATE mentor_profiles SET is_active = NOT is_active, updated_at = NOW() WHERE id = $1 AND tenant_id = $2 RETURNING is_active',
      [req.params.id, t]);
    if (!r.rows.length) return res.status(404).json({ error: 'Mentor not found' });
    audit('mentor_toggled', { mentorId: +req.params.id, active: r.rows[0].is_active, tenant: t });
    res.json({ success: true, is_active: r.rows[0].is_active });
  }));

  // Delete mentor profile
  app.post('/school/alumni-mentoring/api/mentors/:id/delete', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    await pool.query(
      'UPDATE mentor_profiles SET is_active = false WHERE id = $1 AND tenant_id = $2', [req.params.id, t]);
    audit('mentor_deactivated', { mentorId: +req.params.id, tenant: t });
    res.json({ success: true });
  }));

  // ============================================================
  // 15. ADMIN: Approve/reject success stories
  // ============================================================
  app.post('/school/alumni-mentoring/api/success-stories/:id/approve', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    await pool.query(
      'UPDATE success_stories SET is_approved = true, updated_at = NOW() WHERE id = $1 AND tenant_id = $2',
      [req.params.id, t]);
    audit('success_story_approved', { storyId: +req.params.id, tenant: t });
    res.json({ success: true });
  }));

  app.post('/school/alumni-mentoring/api/success-stories/:id/feature', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    await pool.query(
      'UPDATE success_stories SET is_featured = NOT is_featured, updated_at = NOW() WHERE id = $1 AND tenant_id = $2 RETURNING is_featured',
      [req.params.id, t]);
    res.json({ success: true });
  }));

  // ============================================================
  // 16. ADMIN: Mentor availability calendar management
  // ============================================================
  app.post('/school/alumni-mentoring/api/availability', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const userId = uid(req);
    const { availability } = req.body;
    const availObj = typeof availability === 'object' ? availability : parseJson(availability, {});

    const r = await pool.query(
      'UPDATE mentor_profiles SET availability = $1, updated_at = NOW() WHERE tenant_id = $2 AND alumni_id = $3 RETURNING id',
      [JSON.stringify(availObj), t, userId]);

    if (!r.rows.length) return res.status(404).json({ error: 'Mentor profile not found' });
    audit('mentor_availability_updated', { tenant: t });
    res.json({ success: true });
  }));

  // Get mentor availability
  app.get('/school/alumni-mentoring/api/availability/:mentorId', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const r = await pool.query(
      'SELECT availability FROM mentor_profiles WHERE id = $1 AND tenant_id = $2 AND is_active = true',
      [req.params.mentorId, t]);
    if (!r.rows.length) return res.status(404).json({ error: 'Mentor not found' });
    res.json({ success: true, availability: parseJson(r.rows[0].availability, {}) });
  }));

  console.log('[AlumniMentoring] Module loaded — /school/alumni-mentoring/*');
};
