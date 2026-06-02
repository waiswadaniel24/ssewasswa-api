// ============================================================
// PEER TUTORING MARKETPLACE MODULE
// Student-to-student tutoring with booking, reviews, community hours
// ============================================================
// Tables: tutor_profiles, tutoring_sessions, tutoring_reviews, tutoring_hours
// Usage in server.js:
//   const peerTutoring = require('./peer-tutoring');
//   peerTutoring(app, pool, { esc, renderPage, ah, requireAuth, audit, tenantId: req.tenant.id });
// ============================================================

'use strict';

const { migrateQuery } = require('./db');
module.exports = function(app, pool, opts) {
  const esc = opts.esc || (s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'));
  const renderPage = opts.renderPage || ((t,c,u) => c);
  const ah = opts.ah || ((fn) => async (req,res,next) => { try { await fn(req,res,next); } catch(e) { res.status(500).send('Error: '+e.message); }});
  const requireAuth = opts.requireAuth || ((req,res,next) => { if(!req.session?.user) return res.redirect('/login'); next(); });
  const audit = opts.audit || (() => {});
  const C = '#4f46e5';
  const CL = '#6366f1';
  const CG = '#818cf8';
  const CBG = '#eef2ff';
  const CTEXT = '#1e1b4b';
  const CGRAY = '#6b7280';
  const parseNum = (v, fb) => { const n = parseFloat(v); return isNaN(n) ? (fb || 0) : n; };
  const parseJson = (v, fb) => { try { return typeof v === 'string' ? JSON.parse(v) : (v || fb || {}); } catch(e) { return fb || {}; }};
  const starSvg = (filled, size) => {
    const col = filled ? '#f59e0b' : '#d1d5db';
    return `<svg width="${size||16}" height="${size||16}" viewBox="0 0 24 24" fill="${col}" stroke="none" aria-hidden="true"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.27 5.82 22 7 14.14l-5-4.87 6.91-1.01L12 2z"/></svg>`;
  };
  const starsHtml = (rating, size) => {
    let s = '';
    for (let i = 1; i <= 5; i++) s += starSvg(i <= Math.round(rating), size);
    return s;
  };

  // ── Helper: get tenant_id from request ───────────────────
  const tid = (req) => req.tenant?.id || req.session?.tenant_id || opts.tenantId || 1;

  // ============================================================
  // DATABASE TABLES
  // ============================================================
  (async () => {
    try {
      await migrateQuery(pool, 'PeerTutoring', `CREATE TABLE IF NOT EXISTS tutor_profiles (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 1,
        user_id INTEGER NOT NULL,
        student_id INTEGER,
        subjects TEXT[] DEFAULT '{}',
        grade_level VARCHAR(50) DEFAULT '',
        availability JSONB DEFAULT '{"monday":[],"tuesday":[],"wednesday":[],"thursday":[],"friday":[],"saturday":[],"sunday":[]}',
        bio TEXT DEFAULT '',
        hourly_rate NUMERIC(8,2) DEFAULT 0,
        is_free BOOLEAN DEFAULT true,
        rating NUMERIC(3,2) DEFAULT 0,
        total_reviews INTEGER DEFAULT 0,
        total_sessions INTEGER DEFAULT 0,
        total_hours NUMERIC(8,2) DEFAULT 0,
        is_active BOOLEAN DEFAULT true,
        avatar_url VARCHAR(500) DEFAULT '',
        badges JSONB DEFAULT '[]',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      await migrateQuery(pool, 'PeerTutoring', `CREATE TABLE IF NOT EXISTS tutoring_sessions (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 1,
        tutor_id INTEGER NOT NULL REFERENCES tutor_profiles(id),
        student_id INTEGER NOT NULL,
        subject VARCHAR(255) NOT NULL,
        session_date DATE NOT NULL,
        start_time TIME NOT NULL,
        end_time TIME NOT NULL,
        status VARCHAR(30) DEFAULT 'requested',
        location VARCHAR(255) DEFAULT '',
        notes TEXT DEFAULT '',
        student_notes TEXT DEFAULT '',
        tutor_notes TEXT DEFAULT '',
        pre_score NUMERIC(5,2),
        post_score NUMERIC(5,2),
        is_volunteer BOOLEAN DEFAULT false,
        price NUMERIC(8,2) DEFAULT 0,
        requested_at TIMESTAMPTZ DEFAULT NOW(),
        confirmed_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        declined_at TIMESTAMPTZ,
        decline_reason TEXT DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      await migrateQuery(pool, 'PeerTutoring', `CREATE TABLE IF NOT EXISTS tutoring_reviews (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 1,
        session_id INTEGER NOT NULL REFERENCES tutoring_sessions(id),
        reviewer_id INTEGER NOT NULL,
        reviewee_id INTEGER NOT NULL,
        reviewer_type VARCHAR(20) NOT NULL DEFAULT 'student',
        rating INTEGER NOT NULL DEFAULT 5 CHECK (rating >= 1 AND rating <= 5),
        text_review TEXT DEFAULT '',
        is_flagged BOOLEAN DEFAULT false,
        flag_reason TEXT DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      await migrateQuery(pool, 'PeerTutoring', `CREATE TABLE IF NOT EXISTS tutoring_hours (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 1,
        tutor_id INTEGER NOT NULL REFERENCES tutor_profiles(id),
        session_id INTEGER REFERENCES tutoring_sessions(id),
        hours NUMERIC(6,2) DEFAULT 0,
        date DATE NOT NULL DEFAULT CURRENT_DATE,
        subject VARCHAR(255) DEFAULT '',
        verified BOOLEAN DEFAULT false,
        certificate_earned BOOLEAN DEFAULT false,
        certificate_earned_at TIMESTAMPTZ,
        cumulative_hours NUMERIC(8,2) DEFAULT 0,
        school_recognized BOOLEAN DEFAULT false,
        recognized_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      // Indexes
      const idxs = [
        'idx_tp_tenant ON tutor_profiles(tenant_id)',
        'idx_tp_user ON tutor_profiles(tenant_id, user_id)',
        'idx_tp_active ON tutor_profiles(tenant_id, is_active)',
        'idx_tp_subjects ON tutor_profiles USING GIN(subjects)',
        'idx_tp_rating ON tutor_profiles(tenant_id, rating DESC)',
        'idx_ts_tenant ON tutoring_sessions(tenant_id)',
        'idx_ts_tutor ON tutoring_sessions(tenant_id, tutor_id)',
        'idx_ts_student ON tutoring_sessions(tenant_id, student_id)',
        'idx_ts_status ON tutoring_sessions(tenant_id, status)',
        'idx_ts_date ON tutoring_sessions(tenant_id, session_date)',
        'idx_tr_tenant ON tutoring_reviews(tenant_id)',
        'idx_tr_session ON tutoring_reviews(tenant_id, session_id)',
        'idx_tr_flagged ON tutoring_reviews(tenant_id, is_flagged)',
        'idx_th_tenant ON tutoring_hours(tenant_id)',
        'idx_th_tutor ON tutoring_hours(tenant_id, tutor_id)',
        'idx_th_cumulative ON tutoring_hours(tenant_id, cumulative_hours DESC)'
      ];
      for (const i of idxs) { try { await migrateQuery(pool, 'PeerTutoring', `CREATE INDEX IF NOT EXISTS ${i}`); } catch(e) {} }

      console.log('[PeerTutoring] Migrations applied');
    } catch (e) { /* migration OK */ }
  })();

  // ============================================================
  // 1. TUTOR PROFILE — Create / Read / Update / Public view
  // ============================================================

  // Create or update tutor profile
  app.post('/peer-tutoring/api/profile', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const userId = req.session?.user?.id || req.user?.id || req.body.user_id;
    if (!userId) return res.status(400).json({ error: 'User ID required' });
    const { subjects, grade_level, availability, bio, hourly_rate, is_free, avatar_url } = req.body;
    const subj = Array.isArray(subjects) ? subjects : (typeof subjects === 'string' ? subjects.split(',').map(s => s.trim()).filter(Boolean) : []);
    const avail = typeof availability === 'object' && availability ? availability : {};
    const rate = is_free ? 0 : parseNum(hourly_rate, 0);

    const existing = await pool.query(
      'SELECT id FROM tutor_profiles WHERE tenant_id = $1 AND user_id = $2', [t, userId]);
    let result;
    if (existing.rows.length > 0) {
      result = await pool.query(
        `UPDATE tutor_profiles SET subjects = $1, grade_level = $2, availability = $3,
          bio = $4, hourly_rate = $5, is_free = $6, avatar_url = $7, updated_at = NOW()
         WHERE tenant_id = $8 AND user_id = $9 RETURNING *`,
        [subj, grade_level || '', JSON.stringify(avail), bio || '', rate, is_free === true, avatar_url || '', t, userId]);
      audit('tutor_profile_updated', { tutorId: existing.rows[0].id, tenant: t });
    } else {
      result = await pool.query(
        `INSERT INTO tutor_profiles (tenant_id, user_id, subjects, grade_level, availability,
          bio, hourly_rate, is_free, avatar_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [t, userId, subj, grade_level || '', JSON.stringify(avail), bio || '', rate, is_free !== false, avatar_url || '']);
      audit('tutor_profile_created', { tutorId: result.rows[0].id, tenant: t });
    }
    res.json({ success: true, profile: result.rows[0] });
  }));

  // Get own tutor profile
  app.get('/peer-tutoring/api/profile', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const userId = req.session?.user?.id || req.user?.id;
    const r = await pool.query(
      'SELECT * FROM tutor_profiles WHERE tenant_id = $1 AND user_id = $2', [t, userId]);
    res.json({ success: true, profile: r.rows[0] || null });
  }));

  // Public tutor profile page
  app.get('/peer-tutoring/api/profile/:id', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const r = await pool.query(
      `SELECT tp.*, u.name as user_name, u.email, s.first_name, s.last_name, s.admission_number, s.class_name
       FROM tutor_profiles tp
       LEFT JOIN users u ON u.id = tp.user_id
       LEFT JOIN students s ON s.id = tp.student_id
       WHERE tp.id = $1 AND tp.tenant_id = $2 AND tp.is_active = true`, [req.params.id, t]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Tutor profile not found' });

    const reviews = await pool.query(
      `SELECT tr.*, u.name as reviewer_name
       FROM tutoring_reviews tr LEFT JOIN users u ON u.id = tr.reviewer_id
       WHERE tr.tenant_id = $1 AND tr.reviewee_id = $2 AND tr.is_flagged = false
       ORDER BY tr.created_at DESC LIMIT 20`, [t, req.params.id]);

    const stats = await pool.query(
      `SELECT COUNT(*)::int as total_sessions,
        COALESCE(SUM(EXTRACT(EPOCH FROM (s.end_time - s.start_time))/3600), 0)::numeric(8,2) as total_hours
       FROM tutoring_sessions s
       WHERE s.tenant_id = $1 AND s.tutor_id = $2 AND s.status = 'completed'`, [t, req.params.id]);

    const profile = r.rows[0];
    res.json({ success: true, profile, reviews: reviews.rows, stats: stats.rows[0] });
  }));

  // Render public profile HTML page
  app.get('/peer-tutoring/profile/:id', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const r = await pool.query(
      `SELECT tp.*, u.name as user_name, COALESCE(s.first_name, u.name, 'Tutor') as display_name
       FROM tutor_profiles tp
       LEFT JOIN users u ON u.id = tp.user_id
       LEFT JOIN students s ON s.id = tp.student_id
       WHERE tp.id = $1 AND tp.tenant_id = $2 AND tp.is_active = true`, [req.params.id, t]);
    if (!r.rows[0]) return res.status(404).send('Tutor not found');

    const p = r.rows[0];
    const subjects = Array.isArray(p.subjects) ? p.subjects : [];
    const avail = parseJson(p.availability, {});
    const rateLabel = p.is_free ? '<span style="background:#dcfce7;color:#166534;padding:4px 12px;border-radius:20px;font-weight:600;">Free / Volunteer</span>'
      : `<span style="background:#fef3c7;color:#92400e;padding:4px 12px;border-radius:20px;font-weight:600;">$${p.hourly_rate}/hr</span>`;
    const dayNames = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];

    let availHtml = '';
    for (const d of dayNames) {
      const slots = avail[d] || [];
      if (slots.length > 0) {
        availHtml += `<div style="margin-bottom:4px;"><strong style="text-transform:capitalize;">${d}:</strong> ${esc(slots.join(', '))}</div>`;
      }
    }
    if (!availHtml) availHtml = '<p style="color:#6b7280;">No availability set</p>';

    let subjectsHtml = subjects.map(s =>
      `<span style="display:inline-block;background:${CBG};color:${C};padding:4px 14px;border-radius:20px;margin:3px;font-size:14px;font-weight:500;">${esc(s)}</span>`
    ).join('');

    const html = renderPage('Tutor Profile', `
      <div style="max-width:800px;margin:0 auto;" role="main" aria-label="Tutor Profile">
        <div style="background:white;border-radius:16px;box-shadow:0 1px 3px rgba(0,0,0,0.1);padding:32px;margin-bottom:24px;">
          <div style="display:flex;align-items:center;gap:20px;margin-bottom:24px;flex-wrap:wrap;">
            <div style="width:80px;height:80px;border-radius:50%;background:linear-gradient(135deg,${C},${CG});display:flex;align-items:center;justify-content:center;color:white;font-size:28px;font-weight:700;" aria-hidden="true">
              ${(p.display_name||'T')[0].toUpperCase()}
            </div>
            <div>
              <h1 style="margin:0 0 6px 0;font-size:24px;color:${CTEXT};">${esc(p.display_name)}</h1>
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                ${starsHtml(parseNum(p.rating, 0), 18)}
                <span style="color:${CGRAY};font-size:14px;">${p.rating || 'No ratings'} (${p.total_reviews || 0} reviews)</span>
                <span style="margin-left:8px;">${rateLabel}</span>
              </div>
              ${p.grade_level ? `<p style="margin:4px 0 0 0;color:${CGRAY};font-size:14px;">Grade Level: ${esc(p.grade_level)}</p>` : ''}
            </div>
          </div>
          ${p.bio ? `<div style="margin-bottom:20px;padding:16px;background:#f9fafb;border-radius:12px;"><p style="margin:0;color:${CTEXT};line-height:1.6;">${esc(p.bio)}</p></div>` : ''}
          <div style="margin-bottom:20px;">
            <h2 style="font-size:16px;margin:0 0 8px 0;color:${CTEXT};">Subjects Offered</h2>
            <div>${subjectsHtml || '<span style="color:#6b7280;">No subjects listed</span>'}</div>
          </div>
          <div style="margin-bottom:20px;">
            <h2 style="font-size:16px;margin:0 0 8px 0;color:${CTEXT};">Availability</h2>
            ${availHtml}
          </div>
          <div style="display:flex;gap:12px;flex-wrap:wrap;">
            <a href="/peer-tutoring/book?tutor_id=${p.id}" style="display:inline-block;background:${C};color:white;padding:12px 28px;border-radius:10px;text-decoration:none;font-weight:600;transition:background 0.2s;" onmouseover="this.style.background='${CL}'" onmouseout="this.style.background='${C}'" role="button" aria-label="Book a session with ${esc(p.display_name)}">Book a Session</a>
            <span style="display:inline-flex;align-items:center;gap:4px;background:${CBG};color:${C};padding:10px 20px;border-radius:10px;font-weight:500;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="${C}" aria-hidden="true"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
              ${p.total_sessions || 0} sessions completed
            </span>
          </div>
        </div>
      </div>
    `, req.session?.user);
    res.send(html);
  }));

  // ============================================================
  // 2. BROWSE TUTORS — Filter, search, card grid
  // ============================================================

  app.get('/peer-tutoring/api/tutors', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    let where = ['tp.tenant_id = $1', 'tp.is_active = true'];
    let params = [t];
    let pi = 2;

    if (req.query.subject) {
      where.push(`$${pi} = ANY(tp.subjects)`);
      params.push(req.query.subject);
      pi++;
    }
    if (req.query.grade_level) {
      where.push(`tp.grade_level = $${pi}`);
      params.push(req.query.grade_level);
      pi++;
    }
    if (req.query.rating_min) {
      where.push(`tp.rating >= $${pi}`);
      params.push(parseNum(req.query.rating_min, 0));
      pi++;
    }
    if (req.query.price === 'free') {
      where.push('tp.is_free = true');
    } else if (req.query.price === 'paid') {
      where.push('tp.is_free = false');
    }
    if (req.query.day) {
      where.push(`tp.availability->>$${pi} IS NOT NULL AND jsonb_array_length(tp.availability->$${pi}) > 0`);
      params.push(req.query.day);
      pi++;
    }
    if (req.query.search) {
      where.push(`(u.name ILIKE $${pi} OR tp.bio ILIKE $${pi})`);
      params.push(`%${req.query.search}%`);
      pi++;
    }

    const sortBy = req.query.sort === 'rating' ? 'tp.rating DESC' :
                   req.query.sort === 'hours' ? 'tp.total_hours DESC' :
                   req.query.sort === 'reviews' ? 'tp.total_reviews DESC' : 'tp.created_at DESC';
    const limit = Math.min(parseInt(req.query.limit) || 24, 100);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);

    const countR = await pool.query(
      `SELECT COUNT(*)::int as total FROM tutor_profiles tp LEFT JOIN users u ON u.id = tp.user_id WHERE ${where.join(' AND ')}`,
      params);

    const r = await pool.query(
      `SELECT tp.*, u.name as user_name, COALESCE(s.first_name, u.name, 'Tutor') as display_name
       FROM tutor_profiles tp
       LEFT JOIN users u ON u.id = tp.user_id
       LEFT JOIN students s ON s.id = tp.student_id
       WHERE ${where.join(' AND ')}
       ORDER BY ${sortBy} NULLS LAST LIMIT ${limit} OFFSET ${offset}`, params);

    res.json({ success: true, tutors: r.rows, total: countR.rows[0].total, limit, offset });
  }));

  // Browse tutors HTML page
  app.get('/peer-tutoring/browse', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const r = await pool.query(
      `SELECT tp.*, u.name as user_name, COALESCE(s.first_name, u.name, 'Tutor') as display_name
       FROM tutor_profiles tp
       LEFT JOIN users u ON u.id = tp.user_id
       LEFT JOIN students s ON s.id = tp.student_id
       WHERE tp.tenant_id = $1 AND tp.is_active = true
       ORDER BY tp.rating DESC NULLS LAST, tp.total_sessions DESC LIMIT 50`, [t]);

    const cards = r.rows.map(p => {
      const subjects = Array.isArray(p.subjects) ? p.subjects.slice(0, 4) : [];
      const subjTags = subjects.map(s => `<span style="display:inline-block;background:${CBG};color:${C};padding:2px 10px;border-radius:12px;font-size:12px;">${esc(s)}</span>`).join(' ');
      const rateLabel = p.is_free
        ? '<span style="color:#16a34a;font-weight:600;font-size:13px;">Free</span>'
        : `<span style="color:#92400e;font-weight:600;font-size:13px;">$${p.hourly_rate}/hr</span>`;
      return `
        <div style="background:white;border-radius:14px;box-shadow:0 1px 3px rgba(0,0,0,0.08);padding:20px;transition:transform 0.2s,box-shadow 0.2s;cursor:pointer;"
             onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 4px 12px rgba(0,0,0,0.12)'"
             onmouseout="this.style.transform='';this.style.boxShadow='0 1px 3px rgba(0,0,0,0.08)'"
             onclick="window.location='/peer-tutoring/profile/${p.id}'" role="article" aria-label="Tutor ${esc(p.display_name)}">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
            <div style="width:48px;height:48px;border-radius:50%;background:linear-gradient(135deg,${C},${CG});display:flex;align-items:center;justify-content:center;color:white;font-weight:700;font-size:18px;" aria-hidden="true">
              ${(p.display_name||'T')[0].toUpperCase()}
            </div>
            <div>
              <div style="font-weight:600;color:${CTEXT};font-size:15px;">${esc(p.display_name)}</div>
              <div style="display:flex;align-items:center;gap:4px;">${starsHtml(parseNum(p.rating, 0), 14)} <span style="color:${CGRAY};font-size:12px;">(${p.total_reviews||0})</span></div>
            </div>
            <div style="margin-left:auto;">${rateLabel}</div>
          </div>
          <div style="margin-bottom:10px;">${subjTags}</div>
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:13px;color:${CGRAY};">
            <span>${p.total_sessions||0} sessions</span>
            <span>${parseNum(p.total_hours,0).toFixed(1)} hrs</span>
          </div>
        </div>`;
    }).join('');

    // SVG donut chart for subjects distribution
    const subjectCounts = {};
    r.rows.forEach(p => {
      (Array.isArray(p.subjects) ? p.subjects : []).forEach(s => {
        subjectCounts[s] = (subjectCounts[s] || 0) + 1;
      });
    });
    const sortedSubjects = Object.entries(subjectCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const totalTutors = r.rows.length || 1;
    const colors = ['#4f46e5','#7c3aed','#2563eb','#0891b2','#059669','#d97706','#dc2626','#db2777'];
    let svgDonut = '';
    let cumPercent = 0;
    sortedSubjects.forEach(([subj, count], i) => {
      const pct = (count / totalTutors) * 100;
      const startAngle = cumPercent * 3.6;
      const endAngle = (cumPercent + pct) * 3.6;
      const x1 = 50 + 40 * Math.cos((startAngle - 90) * Math.PI / 180);
      const y1 = 50 + 40 * Math.sin((startAngle - 90) * Math.PI / 180);
      const x2 = 50 + 40 * Math.cos((endAngle - 90) * Math.PI / 180);
      const y2 = 50 + 40 * Math.sin((endAngle - 90) * Math.PI / 180);
      const largeArc = pct > 50 ? 1 : 0;
      if (pct > 0.5) {
        svgDonut += `<path d="M${x1},${y1} A40,40 0 ${largeArc},1 ${x2},${y2} L50,50 Z" fill="${colors[i % colors.length]}" stroke="white" stroke-width="1"/>`;
      }
      cumPercent += pct;
    });

    const html = renderPage('Browse Tutors', `
      <div style="max-width:1200px;margin:0 auto;" role="main" aria-label="Browse Tutors">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:16px;">
          <div>
            <h1 style="margin:0 0 4px 0;font-size:28px;color:${CTEXT};">Peer Tutors</h1>
            <p style="margin:0;color:${CGRAY};">${r.rows.length} tutors available</p>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <form method="get" action="/peer-tutoring/browse" style="display:flex;gap:8px;flex-wrap:wrap;">
              <input type="text" name="search" placeholder="Search tutors..." value="${esc(req.query.search||'')}"
                style="padding:10px 16px;border:1px solid #d1d5db;border-radius:10px;font-size:14px;min-width:200px;" aria-label="Search tutors">
              <select name="subject" style="padding:10px 12px;border:1px solid #d1d5db;border-radius:10px;font-size:14px;" aria-label="Filter by subject">
                <option value="">All Subjects</option>
                <option value="Mathematics">Mathematics</option>
                <option value="English">English</option>
                <option value="Science">Science</option>
                <option value="Physics">Physics</option>
                <option value="Chemistry">Chemistry</option>
                <option value="Biology">Biology</option>
                <option value="History">History</option>
                <option value="Computer Science">Computer Science</option>
              </select>
              <button type="submit" style="padding:10px 20px;background:${C};color:white;border:none;border-radius:10px;font-weight:600;cursor:pointer;">Search</button>
            </form>
          </div>
        </div>
        ${r.rows.length > 0 ? `
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px;margin-bottom:32px;">
          ${cards}
        </div>` : `
        <div style="text-align:center;padding:60px 20px;color:${CGRAY};">
          <p style="font-size:18px;">No tutors available yet.</p>
          <a href="/peer-tutoring/register" style="color:${C};font-weight:600;">Become a tutor →</a>
        </div>`}
        ${sortedSubjects.length > 0 ? `
        <div style="background:white;border-radius:16px;box-shadow:0 1px 3px rgba(0,0,0,0.1);padding:24px;">
          <h2 style="font-size:18px;color:${CTEXT};margin:0 0 16px 0;">Subjects Distribution</h2>
          <div style="display:flex;align-items:center;gap:24px;flex-wrap:wrap;">
            <svg width="160" height="160" viewBox="0 0 100 100" role="img" aria-label="Subjects distribution chart">
              <circle cx="50" cy="50" r="25" fill="white"/>
              ${svgDonut}
            </svg>
            <div style="display:flex;flex-direction:column;gap:6px;">
              ${sortedSubjects.map(([s, c], i) => `
                <div style="display:flex;align-items:center;gap:8px;font-size:14px;">
                  <span style="width:12px;height:12px;border-radius:3px;background:${colors[i%colors.length]};display:inline-block;" aria-hidden="true"></span>
                  <span style="color:${CTEXT};">${esc(s)}</span>
                  <span style="color:${CGRAY};">${c} tutor${c!==1?'s':''}</span>
                </div>`).join('')}
            </div>
          </div>
        </div>` : ''}
      </div>
    `, req.session?.user);
    res.send(html);
  }));

  // ============================================================
  // 3. BOOK SESSION — Request, Accept, Decline
  // ============================================================

  // Book a session
  app.post('/peer-tutoring/api/sessions', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const studentId = req.session?.user?.id || req.user?.id || req.body.student_id;
    const { tutor_id, subject, session_date, start_time, end_time, location, notes, pre_score, is_volunteer } = req.body;
    if (!tutor_id || !subject || !session_date || !start_time || !end_time) {
      return res.status(400).json({ error: 'tutor_id, subject, session_date, start_time, end_time are required' });
    }

    const tutorCheck = await pool.query(
      'SELECT id, is_free, hourly_rate FROM tutor_profiles WHERE id = $1 AND tenant_id = $2 AND is_active = true',
      [tutor_id, t]);
    if (!tutorCheck.rows.length) return res.status(404).json({ error: 'Tutor not found' });

    // Check for conflicts
    const conflict = await pool.query(
      `SELECT id FROM tutoring_sessions
       WHERE tenant_id = $1 AND tutor_id = $2 AND session_date = $3 AND status IN ('requested','confirmed')
       AND (($4, $5) OVERLAPS (start_time, end_time))`,
      [t, tutor_id, session_date, start_time, end_time]);
    if (conflict.rows.length) return res.status(409).json({ error: 'Tutor has a conflicting session at that time' });

    const price = is_volunteer ? 0 : (tutorCheck.rows[0].is_free ? 0 : parseNum(tutorCheck.rows[0].hourly_rate, 0));
    const r = await pool.query(
      `INSERT INTO tutoring_sessions (tenant_id, tutor_id, student_id, subject, session_date,
        start_time, end_time, location, notes, pre_score, is_volunteer, price)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [t, tutor_id, studentId, subject, session_date, start_time, end_time,
       location || '', notes || '', pre_score ? parseNum(pre_score) : null,
       is_volunteer === true, price]);

    audit('session_requested', { sessionId: r.rows[0].id, tutorId: tutor_id, tenant: t });
    res.json({ success: true, session: r.rows[0] });
  }));

  // Tutor accepts session
  app.post('/peer-tutoring/api/sessions/:id/accept', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const r = await pool.query(
      `UPDATE tutoring_sessions SET status = 'confirmed', confirmed_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2 AND status = 'requested' RETURNING *`, [req.params.id, t]);
    if (!r.rows.length) return res.status(404).json({ error: 'Session not found or not in requested status' });
    audit('session_accepted', { sessionId: +req.params.id, tenant: t });
    res.json({ success: true, session: r.rows[0] });
  }));

  // Tutor declines session
  app.post('/peer-tutoring/api/sessions/:id/decline', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const { decline_reason } = req.body;
    const r = await pool.query(
      `UPDATE tutoring_sessions SET status = 'declined', declined_at = NOW(),
        decline_reason = $1, updated_at = NOW()
       WHERE id = $2 AND tenant_id = $3 AND status = 'requested' RETURNING *`,
      [decline_reason || '', req.params.id, t]);
    if (!r.rows.length) return res.status(404).json({ error: 'Session not found or not in requested status' });
    audit('session_declined', { sessionId: +req.params.id, reason: decline_reason, tenant: t });
    res.json({ success: true, session: r.rows[0] });
  }));

  // Cancel session
  app.post('/peer-tutoring/api/sessions/:id/cancel', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const r = await pool.query(
      `UPDATE tutoring_sessions SET status = 'cancelled', updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2 AND status IN ('requested','confirmed') RETURNING *`,
      [req.params.id, t]);
    if (!r.rows.length) return res.status(404).json({ error: 'Session not found or cannot be cancelled' });
    res.json({ success: true, session: r.rows[0] });
  }));

  // Book session HTML page
  app.get('/peer-tutoring/book', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const tutorId = req.query.tutor_id;
    let tutorInfo = '';
    if (tutorId) {
      const tr = await pool.query(
        `SELECT tp.*, u.name as user_name, COALESCE(s.first_name, u.name) as display_name
         FROM tutor_profiles tp LEFT JOIN users u ON u.id = tp.user_id
         LEFT JOIN students s ON s.id = tp.student_id
         WHERE tp.id = $1 AND tp.tenant_id = $2 AND tp.is_active = true`, [tutorId, t]);
      if (tr.rows[0]) {
        const tp = tr.rows[0];
        const subjects = Array.isArray(tp.subjects) ? tp.subjects : [];
        tutorInfo = `
          <div style="background:${CBG};border-radius:12px;padding:16px;margin-bottom:20px;display:flex;align-items:center;gap:12px;">
            <div style="width:44px;height:44px;border-radius:50%;background:${C};color:white;display:flex;align-items:center;justify-content:center;font-weight:700;" aria-hidden="true">${(tp.display_name||'T')[0]}</div>
            <div>
              <div style="font-weight:600;color:${CTEXT};">Booking with ${esc(tp.display_name)}</div>
              <div style="font-size:13px;color:${CGRAY};">${subjects.map(s => esc(s)).join(', ')}</div>
            </div>
          </div>
          <input type="hidden" name="tutor_id" value="${tp.id}">`;
      }
    }

    const html = renderPage('Book a Session', `
      <div style="max-width:600px;margin:0 auto;" role="main" aria-label="Book Tutoring Session">
        <h1 style="font-size:24px;color:${CTEXT};margin-bottom:20px;">Book a Tutoring Session</h1>
        ${tutorInfo || '<p style="color:#6b7280;margin-bottom:20px;">Select a tutor from the <a href="/peer-tutoring/browse" style="color:${C};font-weight:600;">browse page</a> or enter tutor ID below.</p>'}
        <form method="post" action="/peer-tutoring/api/sessions" style="background:white;border-radius:16px;box-shadow:0 1px 3px rgba(0,0,0,0.1);padding:24px;">
          ${!tutorId ? '<div style="margin-bottom:16px;"><label style="display:block;font-weight:600;color:'+CTEXT+';margin-bottom:4px;" for="tutor_id">Tutor ID</label><input type="number" name="tutor_id" id="tutor_id" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;"></div>' : ''}
          <div style="margin-bottom:16px;">
            <label style="display:block;font-weight:600;color:${CTEXT};margin-bottom:4px;" for="subject">Subject</label>
            <input type="text" name="subject" id="subject" required placeholder="e.g., Mathematics, Physics"
              style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;">
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
            <div>
              <label style="display:block;font-weight:600;color:${CTEXT};margin-bottom:4px;" for="session_date">Date</label>
              <input type="date" name="session_date" id="session_date" required
                style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;">
            </div>
            <div>
              <label style="display:block;font-weight:600;color:${CTEXT};margin-bottom:4px;" for="is_volunteer">Type</label>
              <select name="is_volunteer" id="is_volunteer" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;">
                <option value="false">Paid Session</option>
                <option value="true">Volunteer (Free)</option>
              </select>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
            <div>
              <label style="display:block;font-weight:600;color:${CTEXT};margin-bottom:4px;" for="start_time">Start Time</label>
              <input type="time" name="start_time" id="start_time" required
                style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;">
            </div>
            <div>
              <label style="display:block;font-weight:600;color:${CTEXT};margin-bottom:4px;" for="end_time">End Time</label>
              <input type="time" name="end_time" id="end_time" required
                style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;">
            </div>
          </div>
          <div style="margin-bottom:16px;">
            <label style="display:block;font-weight:600;color:${CTEXT};margin-bottom:4px;" for="pre_score">Pre-session Score (optional)</label>
            <input type="number" name="pre_score" id="pre_score" min="0" max="100" step="0.1"
              placeholder="Your current score in this subject"
              style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;">
          </div>
          <div style="margin-bottom:16px;">
            <label style="display:block;font-weight:600;color:${CTEXT};margin-bottom:4px;" for="notes">Notes for Tutor</label>
            <textarea name="notes" id="notes" rows="3" placeholder="Topics you need help with..."
              style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;resize:vertical;"></textarea>
          </div>
          <div style="margin-bottom:16px;">
            <label style="display:block;font-weight:600;color:${CTEXT};margin-bottom:4px;" for="location">Location (optional)</label>
            <input type="text" name="location" id="location" placeholder="e.g., Library Room 3, Online"
              style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;">
          </div>
          <button type="submit" style="width:100%;padding:12px;background:${C};color:white;border:none;border-radius:10px;font-size:16px;font-weight:600;cursor:pointer;">Request Booking</button>
        </form>
      </div>
    `, req.session?.user);
    res.send(html);
  }));

  // ============================================================
  // 4. SESSION TRACKING — Upcoming, Past, Notes, Complete
  // ============================================================

  app.get('/peer-tutoring/api/sessions', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const userId = req.session?.user?.id || req.user?.id;
    let where = ['s.tenant_id = $1'];
    let params = [t];
    let pi = 2;

    const role = req.query.role || 'all';
    if (role === 'tutor') {
      where.push(`s.tutor_id = (SELECT id FROM tutor_profiles WHERE tenant_id = $1 AND user_id = $2)`);
      params.push(userId);
      pi++;
    } else if (role === 'student') {
      where.push(`s.student_id = $' + (pi++)`);
      params.push(userId);
    } else {
      where.push(`(s.student_id = $${pi} OR s.tutor_id IN (SELECT id FROM tutor_profiles WHERE tenant_id = $1 AND user_id = $${pi}))`);
      params.push(userId);
      pi++;
    }

    if (req.query.status) {
      where.push(`s.status = $${pi}`);
      params.push(req.query.status);
      pi++;
    }
    if (req.query.upcoming === 'true') {
      where.push(`s.session_date >= CURRENT_DATE`);
      where.push(`s.status IN ('requested', 'confirmed')`);
    }
    if (req.query.past === 'true') {
      where.push(`s.session_date < CURRENT_DATE OR s.status IN ('completed', 'cancelled', 'declined')`);
    }

    const r = await pool.query(
      `SELECT s.*,
        tp_t.user_name as tutor_name, COALESCE(tp_t.display_name, u_t.name) as tutor_display,
        u_s.name as student_name, COALESCE(s_st.first_name, u_s.name) as student_display
       FROM tutoring_sessions s
       LEFT JOIN tutor_profiles tp_t ON tp_t.id = s.tutor_id
       LEFT JOIN users u_t ON u_t.id = tp_t.user_id
       LEFT JOIN students s_st ON s_st.id = s.student_id
       LEFT JOIN users u_s ON u_s.id = s.student_id
       WHERE ${where.join(' AND ')}
       ORDER BY s.session_date DESC, s.start_time DESC
       LIMIT 100`, params);

    res.json({ success: true, sessions: r.rows, count: r.rows.length });
  }));

  // Complete session + record hours
  app.post('/peer-tutoring/api/sessions/:id/complete', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const { tutor_notes, student_notes, post_score } = req.body;
    const sess = await pool.query(
      'SELECT * FROM tutoring_sessions WHERE id = $1 AND tenant_id = $2 AND status = $3',
      [req.params.id, t, 'confirmed']);
    if (!sess.rows.length) return res.status(404).json({ error: 'Confirmed session not found' });

    const s = sess.rows[0];
    const hours = (new Date(`1970-01-01T${s.end_time}`) - new Date(`1970-01-01T${s.start_time}`)) / 3600000;

    await pool.query(
      `UPDATE tutoring_sessions SET status = 'completed', completed_at = NOW(),
        tutor_notes = $1, student_notes = $2, post_score = $3, updated_at = NOW()
       WHERE id = $4 AND tenant_id = $5`,
      [tutor_notes || '', student_notes || '', post_score ? parseNum(post_score) : null, req.params.id, t]);

    // Record volunteer hours
    const cumulR = await pool.query(
      `SELECT COALESCE(SUM(hours), 0)::numeric(8,2) as cum FROM tutoring_hours WHERE tenant_id = $1 AND tutor_id = $2`,
      [t, s.tutor_id]);
    const newCumul = parseNum(cumulR.rows[0].cum, 0) + hours;

    await pool.query(
      `INSERT INTO tutoring_hours (tenant_id, tutor_id, session_id, hours, date, subject, cumulative_hours)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [t, s.tutor_id, +req.params.id, hours, s.session_date, s.subject, newCumul]);

    // Update tutor profile stats
    await pool.query(
      `UPDATE tutor_profiles SET total_sessions = total_sessions + 1,
        total_hours = total_hours + $1, updated_at = NOW()
       WHERE id = $2 AND tenant_id = $3`, [hours, s.tutor_id, t]);

    // Check certificate eligibility (20+ hours)
    if (newCumul >= 20) {
      await pool.query(
        `UPDATE tutoring_hours SET certificate_earned = true, certificate_earned_at = NOW()
         WHERE tenant_id = $1 AND tutor_id = $2 AND certificate_earned = false`,
        [t, s.tutor_id]);
    }

    audit('session_completed', { sessionId: +req.params.id, hours, tenant: t });
    res.json({ success: true, hours, cumulative_hours: newCumul });
  }));

  // Session tracking HTML page
  app.get('/peer-tutoring/sessions', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const userId = req.session?.user?.id || req.user?.id;

    const upcoming = await pool.query(
      `SELECT s.*, u_t.name as tutor_name, u_s.name as student_name,
        COALESCE(st.first_name, u_s.name) as student_display, COALESCE(tt.first_name, u_t.name) as tutor_display
       FROM tutoring_sessions s
       LEFT JOIN tutor_profiles tp ON tp.id = s.tutor_id
       LEFT JOIN users u_t ON u_t.id = tp.user_id LEFT JOIN students tt ON tt.id = tp.student_id
       LEFT JOIN users u_s ON u_s.id = s.student_id LEFT JOIN students st ON st.id = s.student_id
       WHERE s.tenant_id = $1 AND (s.student_id = $2 OR tp.user_id = $2)
       AND s.status IN ('requested', 'confirmed') AND s.session_date >= CURRENT_DATE
       ORDER BY s.session_date ASC, s.start_time ASC`, [t, userId]);

    const past = await pool.query(
      `SELECT s.*, u_t.name as tutor_name, u_s.name as student_name,
        COALESCE(st.first_name, u_s.name) as student_display, COALESCE(tt.first_name, u_t.name) as tutor_display
       FROM tutoring_sessions s
       LEFT JOIN tutor_profiles tp ON tp.id = s.tutor_id
       LEFT JOIN users u_t ON u_t.id = tp.user_id LEFT JOIN students tt ON tt.id = tp.student_id
       LEFT JOIN users u_s ON u_s.id = s.student_id LEFT JOIN students st ON st.id = s.student_id
       WHERE s.tenant_id = $1 AND (s.student_id = $2 OR tp.user_id = $2)
       AND s.status IN ('completed', 'cancelled', 'declined')
       ORDER BY s.session_date DESC, s.start_time DESC LIMIT 50`, [t, userId]);

    const statusColors = { requested: '#f59e0b', confirmed: '#10b981', completed: '#4f46e5', cancelled: '#6b7280', declined: '#ef4444' };
    const rowHtml = (sessions, showComplete) => sessions.map(s => `
      <div style="background:white;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.08);padding:16px;margin-bottom:10px;border-left:4px solid ${statusColors[s.status]||'#d1d5db'};">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
          <div>
            <div style="font-weight:600;color:${CTEXT};">${esc(s.subject)}</div>
            <div style="font-size:13px;color:${CGRAY};">${s.session_date} · ${s.start_time} - ${s.end_time}</div>
            <div style="font-size:13px;color:${CGRAY};">Tutor: ${esc(s.tutor_display || s.tutor_name || 'N/A')} · Student: ${esc(s.student_display || s.student_name || 'N/A')}</div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="background:${statusColors[s.status]||'#d1d5db'}22;color:${statusColors[s.status]||'#6b7280'};padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;text-transform:capitalize;">${s.status}</span>
            ${showComplete && s.status === 'confirmed' ? `
              <form method="post" action="/peer-tutoring/api/sessions/${s.id}/complete" style="display:inline;">
                <button type="submit" style="padding:6px 16px;background:${C};color:white;border:none;border-radius:8px;font-size:13px;cursor:pointer;">Complete</button>
              </form>` : ''}
          </div>
        </div>
        ${s.post_score ? `<div style="margin-top:8px;font-size:13px;color:#16a34a;">Score improved: ${s.pre_score||'?'}% → ${s.post_score}%</div>` : ''}
      </div>`).join('');

    // SVG bar chart: sessions by day of week
    const dayData = await pool.query(
      `SELECT EXTRACT(DOW FROM session_date)::int as dow, COUNT(*)::int as cnt
       FROM tutoring_sessions WHERE tenant_id = $1 AND status = 'completed'
       GROUP BY dow ORDER BY dow`, [t]);
    const maxCnt = Math.max(1, ...dayData.rows.map(r => r.cnt));
    const dayLabels = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const barChart = dayData.rows.map(r => `
      <div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex:1;">
        <span style="font-size:11px;color:${CGRAY};">${r.cnt}</span>
        <div style="width:28px;height:${Math.max(4, (r.cnt/maxCnt)*80)}px;background:${C};border-radius:4px 4px 0 0;" aria-hidden="true"></div>
        <span style="font-size:11px;color:${CTEXT};">${dayLabels[r.dow]||''}</span>
      </div>`).join('');

    const html = renderPage('My Sessions', `
      <div style="max-width:900px;margin:0 auto;" role="main" aria-label="Session Tracking">
        <h1 style="font-size:24px;color:${CTEXT};margin-bottom:20px;">My Tutoring Sessions</h1>

        ${upcoming.rows.length > 0 ? `
        <section style="margin-bottom:28px;" aria-label="Upcoming Sessions">
          <h2 style="font-size:18px;color:${CTEXT};margin-bottom:12px;">Upcoming Sessions (${upcoming.rows.length})</h2>
          ${rowHtml(upcoming.rows, true)}
        </section>` : '<p style="color:#6b7280;margin-bottom:20px;">No upcoming sessions.</p>'}

        <section style="margin-bottom:28px;" aria-label="Past Sessions">
          <h2 style="font-size:18px;color:${CTEXT};margin-bottom:12px;">Past Sessions</h2>
          ${past.rows.length > 0 ? rowHtml(past.rows, false) : '<p style="color:#6b7280;">No past sessions yet.</p>'}
        </section>

        <section style="background:white;border-radius:16px;box-shadow:0 1px 3px rgba(0,0,0,0.1);padding:20px;" aria-label="Session Activity Chart">
          <h2 style="font-size:16px;color:${CTEXT};margin:0 0 16px 0;">Sessions by Day of Week</h2>
          <div style="display:flex;align-items:flex-end;gap:4px;height:100px;padding-bottom:4px;">
            ${barChart || '<p style="color:#6b7280;font-size:14px;">No data yet</p>'}
          </div>
        </section>
      </div>
    `, req.session?.user);
    res.send(html);
  }));

  // ============================================================
  // 5. REVIEWS — Rate tutor and student after session
  // ============================================================

  app.post('/peer-tutoring/api/reviews', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const { session_id, reviewer_id, reviewee_id, reviewer_type, rating, text_review } = req.body;
    if (!session_id || !reviewer_id || !reviewee_id || !rating) {
      return res.status(400).json({ error: 'session_id, reviewer_id, reviewee_id, rating required' });
    }
    if (rating < 1 || rating > 5) return res.status(400).json({ error: 'Rating must be 1-5' });

    // Verify session is completed and user was a participant
    const sess = await pool.query(
      'SELECT * FROM tutoring_sessions WHERE id = $1 AND tenant_id = $2 AND status = $3',
      [session_id, t, 'completed']);
    if (!sess.rows.length) return res.status(404).json({ error: 'Completed session not found' });

    // Check for duplicate review
    const dup = await pool.query(
      'SELECT id FROM tutoring_reviews WHERE tenant_id = $1 AND session_id = $2 AND reviewer_id = $3 AND reviewee_id = $4',
      [t, session_id, reviewer_id, reviewee_id]);
    if (dup.rows.length) return res.status(409).json({ error: 'Review already submitted' });

    const r = await pool.query(
      `INSERT INTO tutoring_reviews (tenant_id, session_id, reviewer_id, reviewee_id, reviewer_type, rating, text_review)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [t, session_id, reviewer_id, reviewee_id, reviewer_type || 'student', Math.min(5, Math.max(1, parseInt(rating))), text_review || '']);

    // Update tutor profile rating
    if (reviewer_type === 'student' || reviewer_type === 'peer') {
      const avgR = await pool.query(
        `SELECT AVG(rating)::numeric(3,2) as avg_rating, COUNT(*)::int as cnt
         FROM tutoring_reviews WHERE tenant_id = $1 AND reviewee_id = $2 AND is_flagged = false`,
        [t, reviewee_id]);
      await pool.query(
        `UPDATE tutor_profiles SET rating = $1, total_reviews = $2, updated_at = NOW()
         WHERE id = $3 AND tenant_id = $4`,
        [parseNum(avgR.rows[0].avg_rating, 0), avgR.rows[0].cnt, reviewee_id, t]);
    }

    audit('review_submitted', { reviewId: r.rows[0].id, sessionId: +session_id, tenant: t });
    res.json({ success: true, review: r.rows[0] });
  }));

  // Get reviews for a tutor
  app.get('/peer-tutoring/api/reviews/:tutorId', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const r = await pool.query(
      `SELECT tr.*, u.name as reviewer_name
       FROM tutoring_reviews tr
       LEFT JOIN users u ON u.id = tr.reviewer_id
       WHERE tr.tenant_id = $1 AND tr.reviewee_id = $2 AND tr.is_flagged = false
       ORDER BY tr.created_at DESC LIMIT 50`, [t, req.params.tutorId]);
    const avg = await pool.query(
      `SELECT AVG(rating)::numeric(3,2) as avg, COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE rating >= 4)::int as positive
       FROM tutoring_reviews WHERE tenant_id = $1 AND reviewee_id = $2 AND is_flagged = false`,
      [t, req.params.tutorId]);
    res.json({ success: true, reviews: r.rows, stats: avg.rows[0] });
  }));

  // Flag a review
  app.post('/peer-tutoring/api/reviews/:id/flag', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const { flag_reason } = req.body;
    const r = await pool.query(
      `UPDATE tutoring_reviews SET is_flagged = true, flag_reason = $1
       WHERE id = $2 AND tenant_id = $3 RETURNING *`,
      [flag_reason || '', req.params.id, t]);
    if (!r.rows.length) return res.status(404).json({ error: 'Review not found' });
    audit('review_flagged', { reviewId: +req.params.id, tenant: t });
    res.json({ success: true, review: r.rows[0] });
  }));

  // Unflag a review
  app.post('/peer-tutoring/api/reviews/:id/unflag', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const r = await pool.query(
      `UPDATE tutoring_reviews SET is_flagged = false, flag_reason = ''
       WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [req.params.id, t]);
    if (!r.rows.length) return res.status(404).json({ error: 'Review not found' });
    res.json({ success: true, review: r.rows[0] });
  }));

  // ============================================================
  // 6. COMMUNITY HOURS — Volunteer tracking, certificates
  // ============================================================

  app.get('/peer-tutoring/api/hours', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const userId = req.session?.user?.id || req.user?.id;
    let where = ['h.tenant_id = $1'];
    let params = [t];
    let pi = 2;

    if (req.query.tutor_id) {
      where.push(`h.tutor_id = $${pi++}`);
      params.push(req.query.tutor_id);
    } else {
      where.push(`tp.user_id = $${pi++}`);
      params.push(userId);
    }

    const r = await pool.query(
      `SELECT h.*, tp.user_name, COALESCE(s.first_name, u.name) as tutor_display
       FROM tutoring_hours h
       LEFT JOIN tutor_profiles tp ON tp.id = h.tutor_id
       LEFT JOIN users u ON u.id = tp.user_id
       LEFT JOIN students s ON s.id = tp.student_id
       WHERE ${where.join(' AND ')}
       ORDER BY h.date DESC LIMIT 100`, params);

    const totals = await pool.query(
      `SELECT COUNT(*)::int as entries,
        COALESCE(SUM(h.hours), 0)::numeric(8,2) as total_hours,
        COUNT(*) FILTER (WHERE h.verified = true)::int as verified_entries,
        COALESCE(SUM(h.hours) FILTER (WHERE h.verified = true), 0)::numeric(8,2) as verified_hours,
        COUNT(*) FILTER (WHERE h.certificate_earned = true)::int as certificates
       FROM tutoring_hours h
       ${req.query.tutor_id
         ? 'WHERE h.tenant_id = $1 AND h.tutor_id = $2'
         : 'JOIN tutor_profiles tp ON tp.id = h.tutor_id WHERE h.tenant_id = $1 AND tp.user_id = $2'}`,
      req.query.tutor_id ? [t, req.query.tutor_id] : [t, userId]);

    res.json({ success: true, hours: r.rows, totals: totals.rows[0] });
  }));

  // Verify hours
  app.post('/peer-tutoring/api/hours/:id/verify', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const r = await pool.query(
      `UPDATE tutoring_hours SET verified = true WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [req.params.id, t]);
    if (!r.rows.length) return res.status(404).json({ error: 'Hours record not found' });
    audit('hours_verified', { hoursId: +req.params.id, tenant: t });
    res.json({ success: true, hours: r.rows[0] });
  }));

  // School recognition
  app.post('/peer-tutoring/api/hours/:tutorId/recognize', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    await pool.query(
      `UPDATE tutoring_hours SET school_recognized = true, recognized_at = NOW()
       WHERE tenant_id = $1 AND tutor_id = $2 AND cumulative_hours >= 20 AND school_recognized = false`,
      [t, req.params.tutorId]);
    await pool.query(
      `UPDATE tutor_profiles SET badges = COALESCE(badges, '[]'::jsonb) || '"community_service"'::jsonb
       WHERE id = $1 AND tenant_id = $2 AND NOT badges @> '"community_service"'::jsonb`,
      [req.params.tutorId, t]);
    res.json({ success: true, message: 'School recognition applied' });
  }));

  // Community hours dashboard HTML page
  app.get('/peer-tutoring/hours', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const userId = req.session?.user?.id || req.user?.id;

    const hoursR = await pool.query(
      `SELECT h.*, u.name as tutor_name, COALESCE(s.first_name, u.name) as display_name
       FROM tutoring_hours h
       JOIN tutor_profiles tp ON tp.id = h.tutor_id
       LEFT JOIN users u ON u.id = tp.user_id LEFT JOIN students s ON s.id = tp.student_id
       WHERE h.tenant_id = $1 AND tp.user_id = $2
       ORDER BY h.date DESC LIMIT 50`, [t, userId]);

    const totals = await pool.query(
      `SELECT COALESCE(SUM(h.hours), 0)::numeric(8,2) as total,
        COALESCE(SUM(h.hours) FILTER (WHERE h.verified = true), 0)::numeric(8,2) as verified,
        COUNT(*)::int as entries,
        MAX(h.cumulative_hours)::numeric(8,2) as peak
       FROM tutoring_hours h
       JOIN tutor_profiles tp ON tp.id = h.tutor_id
       WHERE h.tenant_id = $1 AND tp.user_id = $2`, [t, userId]);

    const tot = totals.rows[0];
    const totalH = parseNum(tot.total, 0);
    const verifiedH = parseNum(tot.verified, 0);
    const certEligible = totalH >= 20;
    const progressPct = Math.min(100, (totalH / 20) * 100);

    // SVG progress bar
    const progressBar = `
      <div style="background:#f3f4f6;border-radius:10px;height:24px;overflow:hidden;margin:16px 0;" role="progressbar" aria-valuenow="${totalH}" aria-valuemin="0" aria-valuemax="20" aria-label="Hours progress to certificate">
        <div style="width:${progressPct}%;height:100%;background:linear-gradient(90deg,${C},${CG});border-radius:10px;transition:width 0.3s;"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:13px;color:${CGRAY};">
        <span>${totalH.toFixed(1)} / 20 hours for certificate</span>
        <span>${Math.round(progressPct)}%</span>
      </div>`;

    const rowsHtml = hoursR.rows.map(h => `
      <tr style="border-bottom:1px solid #f3f4f6;">
        <td style="padding:10px 8px;">${h.date}</td>
        <td style="padding:10px 8px;">${esc(h.subject)}</td>
        <td style="padding:10px 8px;font-weight:600;">${h.hours.toFixed(1)}h</td>
        <td style="padding:10px 8px;">${h.verified ? '<span style="color:#16a34a;">✓ Verified</span>' : '<span style="color:#f59e0b;">Pending</span>'}</td>
        <td style="padding:10px 8px;">${h.certificate_earned ? '<span style="color:#4f46e5;">🏆 Certificate</span>' : ''}</td>
      </tr>`).join('');

    // SVG mini sparkline: hours over time
    const sparklineData = hoursR.rows.slice(0, 20).reverse().map(h => parseNum(h.cumulative_hours, 0));
    const sparkMax = Math.max(1, ...sparklineData);
    let sparkPath = '';
    sparklineData.forEach((v, i) => {
      const x = (i / Math.max(1, sparklineData.length - 1)) * 200;
      const y = 40 - (v / sparkMax) * 36;
      sparkPath += (i === 0 ? 'M' : 'L') + `${x},${y}`;
    });

    const html = renderPage('Community Hours', `
      <div style="max-width:900px;margin:0 auto;" role="main" aria-label="Community Service Hours">
        <h1 style="font-size:24px;color:${CTEXT};margin-bottom:20px;">Community Service Hours</h1>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:24px;">
          <div style="background:white;border-radius:12px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
            <div style="font-size:13px;color:${CGRAY};">Total Hours</div>
            <div style="font-size:24px;font-weight:700;color:${C};">${totalH.toFixed(1)}</div>
          </div>
          <div style="background:white;border-radius:12px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
            <div style="font-size:13px;color:${CGRAY};">Verified</div>
            <div style="font-size:24px;font-weight:700;color:#16a34a;">${verifiedH.toFixed(1)}</div>
          </div>
          <div style="background:white;border-radius:12px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
            <div style="font-size:13px;color:${CGRAY};">Sessions</div>
            <div style="font-size:24px;font-weight:700;color:${CTEXT};">${tot.entries || 0}</div>
          </div>
          <div style="background:white;border-radius:12px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
            <div style="font-size:13px;color:${CGRAY};">Certificate</div>
            <div style="font-size:24px;font-weight:700;color:${certEligible ? '#4f46e5' : '#d1d5db'};">${certEligible ? 'Earned!' : '20h req.'}</div>
          </div>
        </div>

        <div style="background:white;border-radius:16px;box-shadow:0 1px 3px rgba(0,0,0,0.1);padding:20px;margin-bottom:24px;">
          <h2 style="font-size:16px;color:${CTEXT};margin:0 0 8px 0;">Certificate Progress</h2>
          ${progressBar}
          ${sparklineData.length > 1 ? `
          <div style="margin-top:16px;">
            <svg width="200" height="40" viewBox="0 0 200 40" role="img" aria-label="Cumulative hours trend">
              <path d="${sparkPath}" fill="none" stroke="${C}" stroke-width="2"/>
              <circle cx="${200}" cy="${40 - (sparklineData[sparklineData.length-1]/sparkMax)*36}" r="3" fill="${C}"/>
            </svg>
            <span style="font-size:12px;color:${CGRAY};margin-left:8px;">Cumulative hours trend</span>
          </div>` : ''}
        </div>

        <div style="background:white;border-radius:16px;box-shadow:0 1px 3px rgba(0,0,0,0.1);overflow:hidden;">
          <table style="width:100%;border-collapse:collapse;" role="table" aria-label="Hours log">
            <thead>
              <tr style="background:#f9fafb;">
                <th style="padding:12px 8px;text-align:left;font-size:13px;color:${CGRAY};font-weight:600;">Date</th>
                <th style="padding:12px 8px;text-align:left;font-size:13px;color:${CGRAY};font-weight:600;">Subject</th>
                <th style="padding:12px 8px;text-align:left;font-size:13px;color:${CGRAY};font-weight:600;">Hours</th>
                <th style="padding:12px 8px;text-align:left;font-size:13px;color:${CGRAY};font-weight:600;">Status</th>
                <th style="padding:12px 8px;text-align:left;font-size:13px;color:${CGRAY};font-weight:600;">Award</th>
              </tr>
            </thead>
            <tbody>${rowsHtml || '<tr><td colspan="5" style="padding:20px;text-align:center;color:#6b7280;">No hours logged yet</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    `, req.session?.user);
    res.send(html);
  }));

  // ============================================================
  // 7. SUBJECT MATCHING — AI-based recommendations
  // ============================================================

  app.get('/peer-tutoring/api/recommendations', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const userId = req.session?.user?.id || req.user?.id || req.query.student_id;
    if (!userId) return res.status(400).json({ error: 'User/Student ID required' });

    // Get student's weak subjects from exam scores (scores below 60%)
    const examScores = await pool.query(
      `SELECT subject, AVG(score)::numeric(5,2) as avg_score
       FROM exam_scores
       WHERE tenant_id = $1 AND student_id = $2
       GROUP BY subject
       HAVING AVG(score) < 60
       ORDER BY avg_score ASC
       LIMIT 10`, [t, userId]).catch(() => ({ rows: [] }));

    const weakSubjects = examScores.rows.map(r => r.subject.trim());
    let recommended = [];

    if (weakSubjects.length > 0) {
      // Find tutors who offer these weak subjects, prioritize higher rated
      const placeholders = weakSubjects.map((_, i) => `$${i + 3}`).join(',');
      recommended = await pool.query(
        `SELECT tp.*, u.name as user_name, COALESCE(s.first_name, u.name) as display_name,
          ts.avg_score as student_avg
         FROM tutor_profiles tp
         LEFT JOIN users u ON u.id = tp.user_id
         LEFT JOIN students s ON s.id = tp.student_id,
         LATERAL (SELECT AVG(score)::numeric(5,2) as avg_score FROM exam_scores
           WHERE tenant_id = $1 AND student_id = $2 AND subject = ANY(tp.subjects)) ts
         WHERE tp.tenant_id = $1 AND tp.is_active = true
         AND tp.subjects && ARRAY[${placeholders}]
         ORDER BY tp.rating DESC NULLS LAST, tp.total_sessions DESC
         LIMIT 15`, [t, userId, ...weakSubjects]);

      // Score each recommendation
      recommended.rows.forEach(r => {
        let score = 0;
        const tutorSubjects = Array.isArray(r.subjects) ? r.subjects : [];
        // More matching subjects = higher score
        const overlap = tutorSubjects.filter(s => weakSubjects.includes(s)).length;
        score += overlap * 30;
        // Higher tutor rating = higher score
        score += parseNum(r.rating, 0) * 10;
        // More sessions = more experienced
        score += Math.min(r.total_sessions || 0, 50);
        // Free tutors get bonus
        if (r.is_free) score += 15;
        r.match_score = Math.min(100, score);
      });
      recommended.rows.sort((a, b) => (b.match_score || 0) - (a.match_score || 0));
    } else {
      // No exam data: recommend top-rated tutors in common subjects
      recommended = await pool.query(
        `SELECT tp.*, u.name as user_name, COALESCE(s.first_name, u.name) as display_name
         FROM tutor_profiles tp
         LEFT JOIN users u ON u.id = tp.user_id
         LEFT JOIN students s ON s.id = tp.student_id
         WHERE tp.tenant_id = $1 AND tp.is_active = true AND tp.rating > 0
         ORDER BY tp.rating DESC NULLS LAST, tp.total_reviews DESC
         LIMIT 10`, [t]);
      recommended.rows.forEach(r => { r.match_score = 50; });
    }

    // Also return the weak subjects analysis
    const subjectAnalysis = weakSubjects.map(s => {
      const exam = examScores.rows.find(e => e.subject === s);
      return {
        subject: s,
        current_score: exam ? parseNum(exam.avg_score, 0) : 0,
        tutors_available: recommended.rows.filter(r =>
          Array.isArray(r.subjects) && r.subjects.includes(s)).length
      };
    });

    res.json({
      success: true,
      weak_subjects: subjectAnalysis,
      recommended_tutors: recommended.rows,
      total_recommendations: recommended.rows.length
    });
  }));

  // Recommendations HTML page
  app.get('/peer-tutoring/recommendations', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const userId = req.session?.user?.id || req.user?.id;

    const examScores = await pool.query(
      `SELECT subject, AVG(score)::numeric(5,2) as avg_score
       FROM exam_scores WHERE tenant_id = $1 AND student_id = $2
       GROUP BY subject ORDER BY avg_score ASC LIMIT 10`, [t, userId]).catch(() => ({ rows: [] }));

    const weakSubjects = examScores.rows.filter(r => parseNum(r.avg_score, 100) < 60);
    const allSubjects = examScores.rows.slice(0, 8);

    // SVG radar-like chart for subjects
    const maxScore = 100;
    const chartSize = 200;
    const center = chartSize / 2;
    const radius = 70;
    let radarSvg = '';
    allSubjects.forEach((s, i) => {
      const angle = (i / allSubjects.length) * Math.PI * 2 - Math.PI / 2;
      const x = center + radius * Math.cos(angle);
      const y = center + radius * Math.sin(angle);
      const score = parseNum(s.avg_score, 0);
      const innerR = (score / maxScore) * radius;
      const ix = center + innerR * Math.cos(angle);
      const iy = center + innerR * Math.sin(angle);
      const color = score < 60 ? '#ef4444' : score < 75 ? '#f59e0b' : '#10b981';
      radarSvg += `
        <line x1="${center}" y1="${center}" x2="${x}" y2="${y}" stroke="#e5e7eb" stroke-width="1"/>
        <circle cx="${ix}" cy="${iy}" r="5" fill="${color}"/>
        <text x="${x + 8}" y="${y + 4}" font-size="10" fill="${CTEXT}" text-anchor="start">${esc(s.subject)}</text>
        <text x="${ix + 8}" y="${iy - 4}" font-size="9" fill="${color}">${score}%</text>`;
    });

    const weakListHtml = weakSubjects.map(s => `
      <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:#fef2f2;border-radius:8px;margin-bottom:6px;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="#ef4444" aria-hidden="true"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
        <span style="font-weight:600;color:#991b1b;">${esc(s.subject)}</span>
        <span style="color:#b91c1c;font-size:13px;">${parseNum(s.avg_score,0)}% avg</span>
      </div>`).join('');

    const html = renderPage('Recommended Tutors', `
      <div style="max-width:1000px;margin:0 auto;" role="main" aria-label="Tutor Recommendations">
        <div style="margin-bottom:24px;">
          <h1 style="font-size:24px;color:${CTEXT};margin-bottom:4px;">Recommended for You</h1>
          <p style="color:${CGRAY};">Based on your academic performance, here are tutors who can help</p>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px;flex-wrap:wrap;">
          <div style="background:white;border-radius:16px;box-shadow:0 1px 3px rgba(0,0,0,0.1);padding:20px;">
            <h2 style="font-size:16px;color:${CTEXT};margin:0 0 12px 0;">Your Subject Performance</h2>
            ${allSubjects.length > 0 ? `
            <svg width="${chartSize}" height="${chartSize}" viewBox="0 0 ${chartSize} ${chartSize}" role="img" aria-label="Subject performance chart">
              <circle cx="${center}" cy="${center}" r="${radius}" fill="none" stroke="#e5e7eb" stroke-width="1"/>
              ${radarSvg}
            </svg>` : '<p style="color:#6b7280;">No exam data available yet.</p>'}
          </div>
          <div style="background:white;border-radius:16px;box-shadow:0 1px 3px rgba(0,0,0,0.1);padding:20px;">
            <h2 style="font-size:16px;color:${CTEXT};margin:0 0 12px 0;">Areas for Improvement</h2>
            ${weakSubjects.length > 0 ? weakListHtml : '<p style="color:#16a34a;">All your scores are above 60%! Keep it up!</p>'}
          </div>
        </div>

        <div>
          <a href="/peer-tutoring/browse" style="display:inline-block;padding:12px 24px;background:${C};color:white;border-radius:10px;text-decoration:none;font-weight:600;margin-bottom:16px;" role="button">Browse All Tutors</a>
        </div>
      </div>
    `, req.session?.user);
    res.send(html);
  }));

  // ============================================================
  // 8. LEADERBOARD — Most hours, highest rated, most improved
  // ============================================================

  app.get('/peer-tutoring/api/leaderboard', requireAuth, ah(async (req, res) => {
    const t = tid(req);

    const [mostHours, highestRated, mostImproved, mostSessions] = await Promise.all([
      // Most volunteer hours
      pool.query(
        `SELECT tp.*, COALESCE(s.first_name, u.name) as display_name,
          COALESCE(SUM(h.hours), 0)::numeric(8,2) as volunteer_hours
         FROM tutor_profiles tp
         LEFT JOIN users u ON u.id = tp.user_id
         LEFT JOIN students s ON s.id = tp.student_id
         LEFT JOIN tutoring_hours h ON h.tutor_id = tp.id AND h.tenant_id = $1
         WHERE tp.tenant_id = $1 AND tp.is_active = true
         GROUP BY tp.id, s.first_name, u.name
         ORDER BY volunteer_hours DESC NULLS LAST LIMIT 20`, [t]),

      // Highest rated (min 3 reviews)
      pool.query(
        `SELECT tp.*, COALESCE(s.first_name, u.name) as display_name
         FROM tutor_profiles tp
         LEFT JOIN users u ON u.id = tp.user_id
         LEFT JOIN students s ON s.id = tp.student_id
         WHERE tp.tenant_id = $1 AND tp.is_active = true AND tp.total_reviews >= 3
         ORDER BY tp.rating DESC NULLS LAST, tp.total_reviews DESC LIMIT 20`, [t]),

      // Most improved students (pre vs post score improvement)
      pool.query(
        `SELECT s.student_id, COALESCE(st.first_name, u_s.name) as student_name,
          AVG(s.post_score - s.pre_score)::numeric(5,2) as avg_improvement,
          COUNT(*)::int as sessions_count
         FROM tutoring_sessions s
         LEFT JOIN users u_s ON u_s.id = s.student_id
         LEFT JOIN students st ON st.id = s.student_id
         WHERE s.tenant_id = $1 AND s.status = 'completed'
         AND s.pre_score IS NOT NULL AND s.post_score IS NOT NULL AND s.post_score > s.pre_score
         GROUP BY s.student_id, st.first_name, u_s.name
         ORDER BY avg_improvement DESC LIMIT 20`, [t]),

      // Most sessions completed
      pool.query(
        `SELECT tp.*, COALESCE(s.first_name, u.name) as display_name
         FROM tutor_profiles tp
         LEFT JOIN users u ON u.id = tp.user_id
         LEFT JOIN students s ON s.id = tp.student_id
         WHERE tp.tenant_id = $1 AND tp.is_active = true
         ORDER BY tp.total_sessions DESC NULLS LAST LIMIT 20`, [t])
    ]);

    res.json({
      success: true,
      most_hours: mostHours.rows,
      highest_rated: highestRated.rows,
      most_improved: mostImproved.rows,
      most_sessions: mostSessions.rows
    });
  }));

  // Leaderboard HTML page
  app.get('/peer-tutoring/leaderboard', requireAuth, ah(async (req, res) => {
    const t = tid(req);

    const mostHours = await pool.query(
      `SELECT tp.*, COALESCE(s.first_name, u.name) as display_name,
        COALESCE(SUM(h.hours), 0)::numeric(8,2) as volunteer_hours
       FROM tutor_profiles tp
       LEFT JOIN users u ON u.id = tp.user_id LEFT JOIN students s ON s.id = tp.student_id
       LEFT JOIN tutoring_hours h ON h.tutor_id = tp.id AND h.tenant_id = $1
       WHERE tp.tenant_id = $1 AND tp.is_active = true AND COALESCE(SUM(h.hours),0) > 0
       GROUP BY tp.id, s.first_name, u.name ORDER BY volunteer_hours DESC LIMIT 10`, [t]);

    const highestRated = await pool.query(
      `SELECT tp.*, COALESCE(s.first_name, u.name) as display_name
       FROM tutor_profiles tp
       LEFT JOIN users u ON u.id = tp.user_id LEFT JOIN students s ON s.id = tp.student_id
       WHERE tp.tenant_id = $1 AND tp.is_active = true AND tp.total_reviews >= 1
       ORDER BY tp.rating DESC NULLS LAST LIMIT 10`, [t]);

    const mostImproved = await pool.query(
      `SELECT s.student_id, COALESCE(st.first_name, u_s.name) as student_name,
        AVG(s.post_score - s.pre_score)::numeric(5,2) as avg_improvement, COUNT(*)::int as sessions
       FROM tutoring_sessions s
       LEFT JOIN users u_s ON u_s.id = s.student_id LEFT JOIN students st ON st.id = s.student_id
       WHERE s.tenant_id = $1 AND s.status = 'completed'
       AND s.pre_score IS NOT NULL AND s.post_score IS NOT NULL AND s.post_score > s.pre_score
       GROUP BY s.student_id, st.first_name, u_s.name ORDER BY avg_improvement DESC LIMIT 10`, [t]);

    const medalColors = ['#f59e0b', '#9ca3af', '#b45309'];
    const medalLabels = ['🥇','🥈','🥉'];

    const hoursRows = mostHours.rows.map((r, i) => {
      const barW = mostHours.rows[0] ? (parseNum(r.volunteer_hours, 0) / parseNum(mostHours.rows[0].volunteer_hours, 1)) * 100 : 0;
      return `
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
          <span style="width:28px;text-align:center;font-size:18px;">${i < 3 ? medalLabels[i] : (i+1)}</span>
          <div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,${i<3?medalColors[i]:C},${CG});display:flex;align-items:center;justify-content:center;color:white;font-weight:700;font-size:14px;" aria-hidden="true">${(r.display_name||'T')[0]}</div>
          <div style="flex:1;min-width:0;">
            <div style="font-weight:600;color:${CTEXT};font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(r.display_name)}</div>
            <div style="background:#f3f4f6;border-radius:4px;height:8px;margin-top:4px;overflow:hidden;">
              <div style="width:${barW}%;height:100%;background:${C};border-radius:4px;" aria-hidden="true"></div>
            </div>
          </div>
          <span style="font-weight:700;color:${C};font-size:14px;white-space:nowrap;">${parseNum(r.volunteer_hours,0).toFixed(1)}h</span>
        </div>`;
    }).join('');

    const ratedRows = highestRated.rows.map((r, i) => `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
        <span style="width:28px;text-align:center;font-size:18px;">${i < 3 ? medalLabels[i] : (i+1)}</span>
        <div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,${C},${CG});display:flex;align-items:center;justify-content:center;color:white;font-weight:700;font-size:14px;" aria-hidden="true">${(r.display_name||'T')[0]}</div>
        <div style="flex:1;">
          <div style="font-weight:600;color:${CTEXT};font-size:14px;">${esc(r.display_name)}</div>
          <div style="display:flex;align-items:center;gap:4px;">${starsHtml(parseNum(r.rating, 0), 14)} <span style="font-size:12px;color:${CGRAY};">(${r.total_reviews||0})</span></div>
        </div>
        <span style="font-weight:700;color:#f59e0b;font-size:14px;">${parseNum(r.rating,0).toFixed(1)}</span>
      </div>`).join('');

    const improvedRows = mostImproved.rows.map((r, i) => `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
        <span style="width:28px;text-align:center;font-size:18px;">${i < 3 ? medalLabels[i] : (i+1)}</span>
        <div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#10b981,#34d399);display:flex;align-items:center;justify-content:center;color:white;font-weight:700;font-size:14px;" aria-hidden="true">${(r.student_name||'S')[0]}</div>
        <div style="flex:1;">
          <div style="font-weight:600;color:${CTEXT};font-size:14px;">${esc(r.student_name)}</div>
          <div style="font-size:12px;color:${CGRAY};">${r.sessions} session${r.sessions!==1?'s':''}</div>
        </div>
        <span style="font-weight:700;color:#16a34a;font-size:14px;">+${parseNum(r.avg_improvement,0).toFixed(1)}%</span>
      </div>`).join('');

    // SVG trophy chart
    const svgTrophy = `
      <svg width="60" height="60" viewBox="0 0 24 24" fill="${C}" aria-hidden="true">
        <path d="M12 2l-3.5 7h7L12 2zm0 12l3.5-7h-7L12 14zm-5 2h10l-1 2H8l-1-2zm-2 4h14v2H5v-2z"/>
      </svg>`;

    const html = renderPage('Leaderboard', `
      <div style="max-width:1000px;margin:0 auto;" role="main" aria-label="Tutoring Leaderboard">
        <div style="text-align:center;margin-bottom:28px;">
          <h1 style="font-size:28px;color:${CTEXT};margin:0 0 4px 0;">${svgTrophy} Peer Tutoring Leaderboard</h1>
          <p style="color:${CGRAY};">Celebrating academic excellence and community service</p>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px;">
          <div style="background:white;border-radius:16px;box-shadow:0 1px 3px rgba(0,0,0,0.1);padding:20px;" aria-label="Most Volunteer Hours">
            <h2 style="font-size:17px;color:${CTEXT};margin:0 0 16px 0;display:flex;align-items:center;gap:8px;">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="${C}" aria-hidden="true"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
              Most Volunteer Hours
            </h2>
            ${hoursRows || '<p style="color:#6b7280;">No data yet</p>'}
          </div>

          <div style="background:white;border-radius:16px;box-shadow:0 1px 3px rgba(0,0,0,0.1);padding:20px;" aria-label="Highest Rated Tutors">
            <h2 style="font-size:17px;color:${CTEXT};margin:0 0 16px 0;display:flex;align-items:center;gap:8px;">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="#f59e0b" aria-hidden="true"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.27 5.82 22 7 14.14l-5-4.87 6.91-1.01L12 2z"/></svg>
              Highest Rated Tutors
            </h2>
            ${ratedRows || '<p style="color:#6b7280;">No data yet</p>'}
          </div>

          <div style="background:white;border-radius:16px;box-shadow:0 1px 3px rgba(0,0,0,0.1);padding:20px;" aria-label="Most Improved Students">
            <h2 style="font-size:17px;color:${CTEXT};margin:0 0 16px 0;display:flex;align-items:center;gap:8px;">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="#16a34a" aria-hidden="true"><path d="M16 6l2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6z"/></svg>
              Most Improved Students
            </h2>
            ${improvedRows || '<p style="color:#6b7280;">No data yet</p>'}
          </div>
        </div>
      </div>
    `, req.session?.user);
    res.send(html);
  }));

  // ============================================================
  // 9. ADMIN DASHBOARD — Stats, flagged reviews, all activity
  // ============================================================

  app.get('/peer-tutoring/api/admin/stats', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const [
      totalTutors, totalSessions, activeSessions, completedSessions,
      totalReviews, flaggedReviews, totalHours, certificateHolders
    ] = await Promise.all([
      pool.query('SELECT COUNT(*)::int as n FROM tutor_profiles WHERE tenant_id = $1 AND is_active = true', [t]),
      pool.query('SELECT COUNT(*)::int as n FROM tutoring_sessions WHERE tenant_id = $1', [t]),
      pool.query("SELECT COUNT(*)::int as n FROM tutoring_sessions WHERE tenant_id = $1 AND status IN ('requested','confirmed')", [t]),
      pool.query("SELECT COUNT(*)::int as n FROM tutoring_sessions WHERE tenant_id = $1 AND status = 'completed'", [t]),
      pool.query('SELECT COUNT(*)::int as n FROM tutoring_reviews WHERE tenant_id = $1', [t]),
      pool.query('SELECT COUNT(*)::int as n FROM tutoring_reviews WHERE tenant_id = $1 AND is_flagged = true', [t]),
      pool.query('SELECT COALESCE(SUM(hours), 0)::numeric(8,2) as total FROM tutoring_hours WHERE tenant_id = $1', [t]),
      pool.query('SELECT COUNT(DISTINCT tutor_id)::int as n FROM tutoring_hours WHERE tenant_id = $1 AND cumulative_hours >= 20', [t])
    ]);

    // Sessions by status
    const byStatus = await pool.query(
      `SELECT status, COUNT(*)::int as count FROM tutoring_sessions
       WHERE tenant_id = $1 GROUP BY status ORDER BY count DESC`, [t]);

    // Sessions per month (last 6 months)
    const monthly = await pool.query(
      `SELECT TO_CHAR(session_date, 'YYYY-MM') as month, COUNT(*)::int as sessions,
        COALESCE(SUM(EXTRACT(EPOCH FROM (end_time - start_time))/3600), 0)::numeric(8,2) as hours
       FROM tutoring_sessions
       WHERE tenant_id = $1 AND session_date >= CURRENT_DATE - INTERVAL '6 months'
       GROUP BY month ORDER BY month DESC`, [t]);

    // Flagged reviews detail
    const flagged = await pool.query(
      `SELECT tr.*, u_rev.name as reviewer_name, u_rev2.name as reviewee_name
       FROM tutoring_reviews tr
       LEFT JOIN users u_rev ON u_rev.id = tr.reviewer_id
       LEFT JOIN users u_rev2 ON u_rev2.id = tr.reviewee_id
       WHERE tr.tenant_id = $1 AND tr.is_flagged = true
       ORDER BY tr.created_at DESC LIMIT 50`, [t]);

    res.json({
      success: true,
      stats: {
        total_tutors: totalTutors.rows[0].n,
        total_sessions: totalSessions.rows[0].n,
        active_sessions: activeSessions.rows[0].n,
        completed_sessions: completedSessions.rows[0].n,
        total_reviews: totalReviews.rows[0].n,
        flagged_reviews: flaggedReviews.rows[0].n,
        total_hours: parseNum(totalHours.rows[0].total, 0),
        certificate_holders: certificateHolders.rows[0].n
      },
      by_status: byStatus.rows,
      monthly: monthly.rows,
      flagged_reviews: flagged.rows
    });
  }));

  // Admin dashboard HTML page
  app.get('/peer-tutoring/admin', requireAuth, ah(async (req, res) => {
    const t = tid(req);

    const [totalTutors, totalSessions, completedSessions, totalReviews,
      flaggedReviews, totalHours, certs] = await Promise.all([
      pool.query('SELECT COUNT(*)::int as n FROM tutor_profiles WHERE tenant_id = $1 AND is_active = true', [t]),
      pool.query('SELECT COUNT(*)::int as n FROM tutoring_sessions WHERE tenant_id = $1', [t]),
      pool.query("SELECT COUNT(*)::int as n FROM tutoring_sessions WHERE tenant_id = $1 AND status = 'completed'", [t]),
      pool.query('SELECT COUNT(*)::int as n FROM tutoring_reviews WHERE tenant_id = $1', [t]),
      pool.query('SELECT COUNT(*)::int as n FROM tutoring_reviews WHERE tenant_id = $1 AND is_flagged = true', [t]),
      pool.query('SELECT COALESCE(SUM(hours), 0)::numeric(8,2) as total FROM tutoring_hours WHERE tenant_id = $1', [t]),
      pool.query('SELECT COUNT(DISTINCT tutor_id)::int as n FROM tutoring_hours WHERE tenant_id = $1 AND cumulative_hours >= 20', [t])
    ]);

    const byStatus = await pool.query(
      `SELECT status, COUNT(*)::int as count FROM tutoring_sessions WHERE tenant_id = $1 GROUP BY status`, [t]);
    const statusColors = { requested: '#f59e0b', confirmed: '#10b981', completed: '#4f46e5', cancelled: '#6b7280', declined: '#ef4444' };

    // SVG donut chart for session statuses
    const statusTotal = byStatus.rows.reduce((a, r) => a + r.count, 0) || 1;
    let statusDonut = '';
    let statusCum = 0;
    byStatus.rows.forEach((r, i) => {
      const pct = (r.count / statusTotal) * 100;
      const sa = statusCum * 3.6;
      const ea = (statusCum + pct) * 3.6;
      const x1 = 50 + 35 * Math.cos((sa - 90) * Math.PI / 180);
      const y1 = 50 + 35 * Math.sin((sa - 90) * Math.PI / 180);
      const x2 = 50 + 35 * Math.cos((ea - 90) * Math.PI / 180);
      const y2 = 50 + 35 * Math.sin((ea - 90) * Math.PI / 180);
      const la = pct > 50 ? 1 : 0;
      if (pct > 0.5) {
        statusDonut += `<path d="M${x1},${y1} A35,35 0 ${la},1 ${x2},${y2} L50,50 Z" fill="${statusColors[r.status]||'#d1d5db'}" stroke="white" stroke-width="1"/>`;
      }
      statusCum += pct;
    });

    // Flagged reviews
    const flagged = await pool.query(
      `SELECT tr.*, u1.name as reviewer_name, u2.name as reviewee_name
       FROM tutoring_reviews tr
       LEFT JOIN users u1 ON u1.id = tr.reviewer_id
       LEFT JOIN users u2 ON u2.id = tr.reviewee_id
       WHERE tr.tenant_id = $1 AND tr.is_flagged = true
       ORDER BY tr.created_at DESC LIMIT 20`, [t]);

    const flaggedRows = flagged.rows.map(r => `
      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:14px;margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
          <div>
            <div style="font-weight:600;color:${CTEXT};">${esc(r.reviewer_name||'Unknown')} → ${esc(r.reviewee_name||'Unknown')}</div>
            <div style="display:flex;align-items:center;gap:4px;margin-top:2px;">${starsHtml(r.rating, 14)}</div>
            <div style="font-size:13px;color:${CTEXT};margin-top:4px;">"${esc(r.text_review || 'No text')}"</div>
            ${r.flag_reason ? `<div style="font-size:12px;color:#ef4444;margin-top:2px;">Flag: ${esc(r.flag_reason)}</div>` : ''}
          </div>
          <form method="post" action="/peer-tutoring/api/reviews/${r.id}/unflag" style="display:inline;">
            <button type="submit" style="padding:6px 14px;background:#16a34a;color:white;border:none;border-radius:8px;font-size:13px;cursor:pointer;">Approve</button>
          </form>
        </div>
      </div>`).join('');

    const html = renderPage('Tutoring Admin', `
      <div style="max-width:1100px;margin:0 auto;" role="main" aria-label="Peer Tutoring Admin Dashboard">
        <div style="margin-bottom:24px;">
          <h1 style="font-size:24px;color:${CTEXT};margin:0 0 4px 0;">Peer Tutoring Administration</h1>
          <p style="color:${CGRAY};">Monitor all tutoring activity, reviews, and community service</p>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:24px;">
          <div style="background:white;border-radius:12px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);border-left:4px solid ${C};">
            <div style="font-size:12px;color:${CGRAY};">Active Tutors</div>
            <div style="font-size:28px;font-weight:700;color:${C};">${totalTutors.rows[0].n}</div>
          </div>
          <div style="background:white;border-radius:12px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);border-left:4px solid #10b981;">
            <div style="font-size:12px;color:${CGRAY};">Total Sessions</div>
            <div style="font-size:28px;font-weight:700;color:#10b981;">${totalSessions.rows[0].n}</div>
          </div>
          <div style="background:white;border-radius:12px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);border-left:4px solid #f59e0b;">
            <div style="font-size:12px;color:${CGRAY};">Completed</div>
            <div style="font-size:28px;font-weight:700;color:#f59e0b;">${completedSessions.rows[0].n}</div>
          </div>
          <div style="background:white;border-radius:12px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);border-left:4px solid #8b5cf6;">
            <div style="font-size:12px;color:${CGRAY};">Total Hours</div>
            <div style="font-size:28px;font-weight:700;color:#8b5cf6;">${parseNum(totalHours.rows[0].total,0).toFixed(1)}</div>
          </div>
          <div style="background:white;border-radius:12px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);border-left:4px solid #ef4444;">
            <div style="font-size:12px;color:${CGRAY};">Flagged Reviews</div>
            <div style="font-size:28px;font-weight:700;color:${flaggedReviews.rows[0].n > 0 ? '#ef4444' : '#16a34a'};">${flaggedReviews.rows[0].n}</div>
          </div>
          <div style="background:white;border-radius:12px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);border-left:4px solid #b45309;">
            <div style="font-size:12px;color:${CGRAY};">Certificates</div>
            <div style="font-size:28px;font-weight:700;color:#b45309;">${certs.rows[0].n}</div>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px;flex-wrap:wrap;">
          <div style="background:white;border-radius:16px;box-shadow:0 1px 3px rgba(0,0,0,0.1);padding:20px;">
            <h2 style="font-size:16px;color:${CTEXT};margin:0 0 16px 0;">Session Status Distribution</h2>
            <div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap;">
              <svg width="140" height="140" viewBox="0 0 100 100" role="img" aria-label="Session status chart">
                <circle cx="50" cy="50" r="20" fill="white"/>
                ${statusDonut || '<text x="50" y="55" text-anchor="middle" fill="#6b7280" font-size="10">No data</text>'}
              </svg>
              <div style="display:flex;flex-direction:column;gap:4px;">
                ${byStatus.rows.map(r => `
                  <div style="display:flex;align-items:center;gap:6px;font-size:13px;">
                    <span style="width:10px;height:10px;border-radius:3px;background:${statusColors[r.status]||'#d1d5db'};display:inline-block;" aria-hidden="true"></span>
                    <span style="text-transform:capitalize;color:${CTEXT};">${r.status}</span>
                    <span style="color:${CGRAY};">${r.count}</span>
                  </div>`).join('')}
              </div>
            </div>
          </div>

          <div style="background:white;border-radius:16px;box-shadow:0 1px 3px rgba(0,0,0,0.1);padding:20px;">
            <h2 style="font-size:16px;color:${CTEXT};margin:0 0 4px 0;">Quick Links</h2>
            <nav style="display:flex;flex-direction:column;gap:8px;margin-top:12px;" aria-label="Admin quick links">
              <a href="/peer-tutoring/browse" style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:${CBG};border-radius:10px;color:${C};text-decoration:none;font-weight:500;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="${C}" aria-hidden="true"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>
                Browse Tutors
              </a>
              <a href="/peer-tutoring/sessions" style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:#f0fdf4;border-radius:10px;color:#16a34a;text-decoration:none;font-weight:500;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="#16a34a" aria-hidden="true"><path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-2 .9-2 2v14a2 2 0 002 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM9 10H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2z"/></svg>
                Session Tracking
              </a>
              <a href="/peer-tutoring/hours" style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:#fef3c7;border-radius:10px;color:#92400e;text-decoration:none;font-weight:500;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="#92400e" aria-hidden="true"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
                Community Hours
              </a>
              <a href="/peer-tutoring/leaderboard" style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:#fef2f2;border-radius:10px;color:#991b1b;text-decoration:none;font-weight:500;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="#991b1b" aria-hidden="true"><path d="M7.5 21H2V9h5.5v12zm7.25-18h-5.5v18h5.5V3zM22 11h-5.5v10H22V11z"/></svg>
                Leaderboard
              </a>
            </nav>
          </div>
        </div>

        <section style="background:white;border-radius:16px;box-shadow:0 1px 3px rgba(0,0,0,0.1);padding:20px;" aria-label="Flagged Reviews">
          <h2 style="font-size:17px;color:${CTEXT};margin:0 0 16px 0;display:flex;align-items:center;gap:8px;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="#ef4444" aria-hidden="true"><path d="M14.4 6L14 4H5v17h2v-7h5.6l.4 2h7V6z"/></svg>
            Flagged Reviews (${flagged.rows.length})
          </h2>
          ${flagged.rows.length > 0 ? flaggedRows : '<p style="color:#16a34a;font-size:14px;">No flagged reviews. All clear!</p>'}
        </section>
      </div>
    `, req.session?.user);
    res.send(html);
  }));

  // ============================================================
  // REGISTER AS TUTOR PAGE
  // ============================================================
  app.get('/peer-tutoring/register', requireAuth, ah(async (req, res) => {
    const html = renderPage('Become a Tutor', `
      <div style="max-width:600px;margin:0 auto;" role="main" aria-label="Tutor Registration">
        <h1 style="font-size:24px;color:${CTEXT};margin-bottom:8px;">Become a Peer Tutor</h1>
        <p style="color:${CGRAY};margin-bottom:24px;">Share your knowledge and help fellow students succeed</p>

        <form method="post" action="/peer-tutoring/api/profile" style="background:white;border-radius:16px;box-shadow:0 1px 3px rgba(0,0,0,0.1);padding:24px;">
          <div style="margin-bottom:16px;">
            <label style="display:block;font-weight:600;color:${CTEXT};margin-bottom:4px;" for="subjects">Subjects You Can Tutor</label>
            <input type="text" name="subjects" id="subjects" required placeholder="e.g., Mathematics, Physics, Chemistry"
              style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;"
              aria-describedby="subjects_help">
            <small id="subjects_help" style="color:${CGRAY};font-size:12px;">Separate subjects with commas</small>
          </div>
          <div style="margin-bottom:16px;">
            <label style="display:block;font-weight:600;color:${CTEXT};margin-bottom:4px;" for="grade_level">Your Grade Level</label>
            <select name="grade_level" id="grade_level" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;">
              <option value="">Select grade</option>
              <option value="Grade 9">Grade 9</option>
              <option value="Grade 10">Grade 10</option>
              <option value="Grade 11">Grade 11</option>
              <option value="Grade 12">Grade 12</option>
              <option value="Undergraduate">Undergraduate</option>
              <option value="Graduate">Graduate</option>
            </select>
          </div>
          <div style="margin-bottom:16px;">
            <label style="display:block;font-weight:600;color:${CTEXT};margin-bottom:4px;" for="bio">About You</label>
            <textarea name="bio" id="bio" rows="4" placeholder="Describe your teaching style, experience, and what makes you a great tutor..."
              style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;resize:vertical;"></textarea>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
            <div>
              <label style="display:block;font-weight:600;color:${CTEXT};margin-bottom:4px;" for="is_free">Tutoring Type</label>
              <select name="is_free" id="is_free" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;">
                <option value="true">Free / Volunteer</option>
                <option value="false">Paid</option>
              </select>
            </div>
            <div>
              <label style="display:block;font-weight:600;color:${CTEXT};margin-bottom:4px;" for="hourly_rate">Hourly Rate ($)</label>
              <input type="number" name="hourly_rate" id="hourly_rate" min="0" step="0.5" placeholder="0.00"
                style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;">
            </div>
          </div>
          <div style="margin-bottom:20px;">
            <label style="display:block;font-weight:600;color:${CTEXT};margin-bottom:4px;">Availability</label>
            <p style="font-size:13px;color:${CGRAY};margin-bottom:8px;">Set your available time slots for each day</p>
            ${['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].map(d => `
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                <label style="width:80px;font-size:13px;color:${CTEXT};text-transform:capitalize;" for="avail_${d}">${d}</label>
                <input type="text" name="availability_${d}" id="avail_${d}" placeholder="e.g., 3:00 PM - 5:00 PM"
                  style="flex:1;padding:8px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;">
              </div>`).join('')}
          </div>
          <button type="submit" style="width:100%;padding:14px;background:${C};color:white;border:none;border-radius:12px;font-size:16px;font-weight:600;cursor:pointer;transition:background 0.2s;" onmouseover="this.style.background='${CL}'" onmouseout="this.style.background='${C}'">Register as Tutor</button>
        </form>
      </div>
    `, req.session?.user);
    res.send(html);
  }));

  // ============================================================
  // LANDING / INDEX PAGE
  // ============================================================
  app.get('/peer-tutoring', requireAuth, ah(async (req, res) => {
    const t = tid(req);

    const [totalTutors, totalSessions, totalHours] = await Promise.all([
      pool.query('SELECT COUNT(*)::int as n FROM tutor_profiles WHERE tenant_id = $1 AND is_active = true', [t]),
      pool.query("SELECT COUNT(*)::int as n FROM tutoring_sessions WHERE tenant_id = $1 AND status = 'completed'", [t]),
      pool.query('SELECT COALESCE(SUM(hours), 0)::numeric(8,2) as total FROM tutoring_hours WHERE tenant_id = $1', [t])
    ]);

    const html = renderPage('Peer Tutoring', `
      <div style="max-width:900px;margin:0 auto;text-align:center;" role="main" aria-label="Peer Tutoring Marketplace">
        <div style="padding:40px 20px;">
          <h1 style="font-size:32px;color:${CTEXT};margin:0 0 8px 0;">Peer Tutoring Marketplace</h1>
          <p style="font-size:18px;color:${CGRAY};margin:0 0 32px 0;">Learn from your peers, grow together</p>

          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:36px;">
            <div style="background:white;border-radius:16px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
              <div style="font-size:36px;font-weight:700;color:${C};">${totalTutors.rows[0].n}</div>
              <div style="font-size:14px;color:${CGRAY};">Active Tutors</div>
            </div>
            <div style="background:white;border-radius:16px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
              <div style="font-size:36px;font-weight:700;color:#10b981;">${totalSessions.rows[0].n}</div>
              <div style="font-size:14px;color:${CGRAY};">Sessions Completed</div>
            </div>
            <div style="background:white;border-radius:16px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
              <div style="font-size:36px;font-weight:700;color:#f59e0b;">${parseNum(totalHours.rows[0].total,0).toFixed(1)}</div>
              <div style="font-size:14px;color:${CGRAY};">Volunteer Hours</div>
            </div>
          </div>

          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;text-align:left;">
            <a href="/peer-tutoring/browse" style="display:block;background:white;border-radius:16px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,0.1);text-decoration:none;border-left:4px solid ${C};transition:transform 0.2s;" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform=''">
              <h2 style="font-size:18px;color:${CTEXT};margin:0 0 6px 0;">Browse Tutors</h2>
              <p style="color:${CGRAY};font-size:14px;margin:0;">Find the perfect tutor for your needs</p>
            </a>
            <a href="/peer-tutoring/register" style="display:block;background:white;border-radius:16px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,0.1);text-decoration:none;border-left:4px solid #10b981;transition:transform 0.2s;" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform=''">
              <h2 style="font-size:18px;color:${CTEXT};margin:0 0 6px 0;">Become a Tutor</h2>
              <p style="color:${CGRAY};font-size:14px;margin:0;">Share your knowledge and earn community hours</p>
            </a>
            <a href="/peer-tutoring/recommendations" style="display:block;background:white;border-radius:16px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,0.1);text-decoration:none;border-left:4px solid #f59e0b;transition:transform 0.2s;" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform=''">
              <h2 style="font-size:18px;color:${CTEXT};margin:0 0 6px 0;">Get Recommendations</h2>
              <p style="color:${CGRAY};font-size:14px;margin:0;">AI-matched tutors for your weak subjects</p>
            </a>
            <a href="/peer-tutoring/leaderboard" style="display:block;background:white;border-radius:16px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,0.1);text-decoration:none;border-left:4px solid #8b5cf6;transition:transform 0.2s;" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform=''">
              <h2 style="font-size:18px;color:${CTEXT};margin:0 0 6px 0;">Leaderboard</h2>
              <p style="color:${CGRAY};font-size:14px;margin:0;">See top tutors and most improved students</p>
            </a>
          </div>
        </div>
      </div>
    `, req.session?.user);
    res.send(html);
  }));

  console.log('[PeerTutoring] Module loaded');
};
