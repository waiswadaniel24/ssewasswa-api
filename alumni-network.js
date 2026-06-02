// ============================================================
// ALUMNI NETWORK MODULE — Multi-Tenant SaaS Platform
// Alumni directory, profiles, events, job board, donations,
// and analytics for schools and universities.
// ============================================================
// Usage in server.js:
//   const alumniNetwork = require('./alumni-network');
//   alumniNetwork(app, db, pool, renderPage, esc);
// ============================================================

'use strict';

// ============================================================
// MODULE ENTRY POINT
// ============================================================
const { migrateQuery } = require('./db');
module.exports = function alumniNetwork(app, db, pool, renderPage, esc) {

  // -- inline helpers ---------------------------------------------------
  const requireAuth = (req, res, next) => {
    if (!req.session?.user) return res.redirect('/login');
    next();
  };

  const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  // -- subscription gate --------------------------------------------------
  const _PLAN_LEVELS = { free: 0, basic: 1, pro: 2 };
  const _SUB_PAGE = '<div style="max-width:600px;margin:60px auto;text-align:center"><h2>Subscription Required</h2><p>This feature requires a paid subscription.</p><a href="/billing" style="padding:12px 24px;background:#f59e0b;color:white;text-decoration:none;border-radius:8px;font-weight:700">Subscribe Now</a></div>';
  const requireSubscription = (minPlan) => async (req, res, next) => {
    if (req.session?.user?.role === 'super_admin') return next();
    try {
      const sub = await pool.query("SELECT plan FROM subscriptions WHERE tenant_id=$1 AND status='active'", [req.session.user.tenant_id]);
      const plan = sub.rows[0]?.plan || 'free';
      if ((_PLAN_LEVELS[plan] || 0) < (_PLAN_LEVELS[minPlan] || 0)) return res.send(_SUB_PAGE);
    } catch (e) { /* allow through on DB error */ }
    next();
  };

  if (!esc) esc = (s) => String(s == null ? '' : (typeof s === 'object' ? JSON.stringify(s) : s))
    .replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  // -- internal helpers ---------------------------------------------------
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const fmtMoney = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // -- navigation helper --------------------------------------------------
  const nav = (active) => `<div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap">
    <a href="/alumni" class="${active === 'directory' ? 'active' : ''}" style="padding:8px 18px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:${active === 'directory' ? '#fff' : '#475569'};background:${active === 'directory' ? '#0f766e' : '#f1f5f9'}">🎓 Directory</a>
    <a href="/alumni/events" class="${active === 'events' ? 'active' : ''}" style="padding:8px 18px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:${active === 'events' ? '#fff' : '#475569'};background:${active === 'events' ? '#0f766e' : '#f1f5f9'}">📅 Events</a>
    <a href="/alumni/jobs" class="${active === 'jobs' ? 'active' : ''}" style="padding:8px 18px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:${active === 'jobs' ? '#fff' : '#475569'};background:${active === 'jobs' ? '#0f766e' : '#f1f5f9'}">💼 Jobs</a>
    <a href="/alumni/donations" class="${active === 'donations' ? 'active' : ''}" style="padding:8px 18px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:${active === 'donations' ? '#fff' : '#475569'};background:${active === 'donations' ? '#0f766e' : '#f1f5f9'}}">💛 Donate</a>
    <a href="/alumni/report" class="${active === 'report' ? 'active' : ''}" style="padding:8px 18px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:${active === 'report' ? '#fff' : '#475569'};background:${active === 'report' ? '#0f766e' : '#f1f5f9'}">📊 Report</a>
  </div>`;

  // -- shared CSS --------------------------------------------------------
  const ALUMNI_CSS = `<style>
    .al-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}
    .al-card{background:#fff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;transition:.2s}
    .al-card:hover{box-shadow:0 4px 16px rgba(0,0,0,.06);transform:translateY(-2px)}
    .al-card-body{padding:18px}
    .al-card-header{height:8px;background:linear-gradient(90deg,#0f766e,#14b8a6)}
    .al-avatar{width:48px;height:48px;border-radius:50%;background:#e2e8f0;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700;color:#0f766e;flex-shrink:0}
    .al-filter{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:end}
    .al-filter label{display:block;font-size:12px;font-weight:600;color:#64748b;margin-bottom:4px}
    .al-filter input,.al-filter select{padding:8px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px;background:#fff}
    .al-filter input:focus,.al-filter select:focus{outline:none;border-color:#0f766e}
    .al-table{width:100%;border-collapse:collapse;font-size:13px}
    .al-table th{padding:11px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#f8fafc}
    .al-table td{padding:10px 14px;border-bottom:1px solid #f1f5f9;color:#1e293b}
    .al-table tr:hover{background:#f8fafc}
    @media(max-width:768px){.al-grid{grid-template-columns:1fr}.al-filter{flex-direction:column}}
  </style>`;

  // ============================================================
  // DATABASE MIGRATIONS (async IIFE)
  // ============================================================
  (async () => {
    try {
      // -- alumni_profiles --
      await migrateQuery(pool, 'AlumniNetwork', `CREATE TABLE IF NOT EXISTS alumni_profiles (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        full_name VARCHAR(255) NOT NULL, email VARCHAR(255), phone VARCHAR(20),
        graduation_year INTEGER, course VARCHAR(100), department VARCHAR(100),
        current_employer VARCHAR(255), job_title VARCHAR(100),
        city VARCHAR(100), country VARCHAR(100), bio TEXT,
        linkedin_url TEXT, twitter_url TEXT, photo_url TEXT,
        is_verified BOOLEAN DEFAULT false, is_visible BOOLEAN DEFAULT true,
        mentor BOOLEAN DEFAULT false, mentor_areas TEXT[],
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      const apCols = [
        ['full_name','VARCHAR(255) NOT NULL'],['email','VARCHAR(255)'],['phone','VARCHAR(20)'],
        ['graduation_year','INTEGER'],['course','VARCHAR(100)'],['department','VARCHAR(100)'],
        ['current_employer','VARCHAR(255)'],['job_title','VARCHAR(100)'],
        ['city','VARCHAR(100)'],['country','VARCHAR(100)'],['bio','TEXT'],
        ['linkedin_url','TEXT'],['twitter_url','TEXT'],['photo_url','TEXT'],
        ['is_verified','BOOLEAN DEFAULT false'],['is_visible','BOOLEAN DEFAULT true'],
        ['mentor','BOOLEAN DEFAULT false'],['mentor_areas','TEXT[]'],
        ['created_at','TIMESTAMPTZ DEFAULT NOW()'],['updated_at','TIMESTAMPTZ DEFAULT NOW()']
      ];
      for (const [col, def] of apCols) { try { await migrateQuery(pool, 'AlumniNetwork', `ALTER TABLE alumni_profiles ADD COLUMN IF NOT EXISTS ${col} ${def}`); } catch (e) {} }

      // -- alumni_events --
      await migrateQuery(pool, 'AlumniNetwork', `CREATE TABLE IF NOT EXISTS alumni_events (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL, description TEXT, event_date TIMESTAMPTZ,
        venue VARCHAR(255), type VARCHAR(50) DEFAULT 'reunion',
        max_attendees INTEGER, created_by INTEGER, created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      const aeCols = [
        ['title','VARCHAR(255) NOT NULL'],['description','TEXT'],['event_date','TIMESTAMPTZ'],
        ['venue','VARCHAR(255)'],['type',"VARCHAR(50) DEFAULT 'reunion'"],
        ['max_attendees','INTEGER'],['created_by','INTEGER'],['created_at','TIMESTAMPTZ DEFAULT NOW()']
      ];
      for (const [col, def] of aeCols) { try { await migrateQuery(pool, 'AlumniNetwork', `ALTER TABLE alumni_events ADD COLUMN IF NOT EXISTS ${col} ${def}`); } catch (e) {} }

      // -- alumni_jobs --
      await migrateQuery(pool, 'AlumniNetwork', `CREATE TABLE IF NOT EXISTS alumni_jobs (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        posted_by INTEGER, company VARCHAR(255) NOT NULL, title VARCHAR(255) NOT NULL,
        description TEXT, location VARCHAR(255), type VARCHAR(20) DEFAULT 'full_time',
        salary_range VARCHAR(100), requirements TEXT,
        is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      const ajCols = [
        ['posted_by','INTEGER'],['company','VARCHAR(255) NOT NULL'],['title','VARCHAR(255) NOT NULL'],
        ['description','TEXT'],['location','VARCHAR(255)'],['type',"VARCHAR(20) DEFAULT 'full_time'"],
        ['salary_range','VARCHAR(100)'],['requirements','TEXT'],
        ['is_active','BOOLEAN DEFAULT true'],['created_at','TIMESTAMPTZ DEFAULT NOW()']
      ];
      for (const [col, def] of ajCols) { try { await migrateQuery(pool, 'AlumniNetwork', `ALTER TABLE alumni_jobs ADD COLUMN IF NOT EXISTS ${col} ${def}`); } catch (e) {} }

      // -- alumni_donations --
      await migrateQuery(pool, 'AlumniNetwork', `CREATE TABLE IF NOT EXISTS alumni_donations (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        donor_id INTEGER, donor_name VARCHAR(255), amount NUMERIC(12,2) NOT NULL,
        purpose VARCHAR(255), message TEXT, is_anonymous BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      const adCols = [
        ['donor_id','INTEGER'],['donor_name','VARCHAR(255)'],['amount','NUMERIC(12,2) NOT NULL'],
        ['purpose','VARCHAR(255)'],['message','TEXT'],['is_anonymous','BOOLEAN DEFAULT false'],
        ['created_at','TIMESTAMPTZ DEFAULT NOW()']
      ];
      for (const [col, def] of adCols) { try { await migrateQuery(pool, 'AlumniNetwork', `ALTER TABLE alumni_donations ADD COLUMN IF NOT EXISTS ${col} ${def}`); } catch (e) {} }

      // -- indexes --
      await migrateQuery(pool, 'AlumniNetwork', `CREATE INDEX IF NOT EXISTS idx_alumprof_tenant ON alumni_profiles(tenant_id)`);
      await migrateQuery(pool, 'AlumniNetwork', `CREATE INDEX IF NOT EXISTS idx_alumprof_year ON alumni_profiles(graduation_year)`);
      await migrateQuery(pool, 'AlumniNetwork', `CREATE INDEX IF NOT EXISTS idx_alumprof_visible ON alumni_profiles(tenant_id, is_visible)`);
      await migrateQuery(pool, 'AlumniNetwork', `CREATE INDEX IF NOT EXISTS idx_alumevt_tenant ON alumni_events(tenant_id)`);
      await migrateQuery(pool, 'AlumniNetwork', `CREATE INDEX IF NOT EXISTS idx_alumjobs_tenant ON alumni_jobs(tenant_id)`);
      await migrateQuery(pool, 'AlumniNetwork', `CREATE INDEX IF NOT EXISTS idx_alumjobs_active ON alumni_jobs(tenant_id, is_active)`);
      await migrateQuery(pool, 'AlumniNetwork', `CREATE INDEX IF NOT EXISTS idx_alumdon_tenant ON alumni_donations(tenant_id)`);
      console.log('[Alumni] Migrations applied successfully');
    } catch (e) { /* migration OK */ }
  })();

  // ============================================================
  // ROUTE 1: GET /alumni — Alumni Directory
  // ============================================================
  app.get('/alumni', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const search = (req.query.search || '').trim();
    const year = req.query.year || '';
    const department = req.query.department || '';
    const location = req.query.location || '';

    let where = ['ap.tenant_id=$1', 'ap.is_visible=true'], params = [tid], pi = 2;
    if (search) { where.push(`(ap.full_name ILIKE $${pi} OR ap.current_employer ILIKE $${pi} OR ap.job_title ILIKE $${pi})`); params.push(`%${search}%`); pi++; }
    if (year) { where.push(`ap.graduation_year=$${pi}`); params.push(parseInt(year)); pi++; }
    if (department) { where.push(`ap.department ILIKE $${pi}`); params.push(department); pi++; }
    if (location) { where.push(`(ap.city ILIKE $${pi} OR ap.country ILIKE $${pi})`); params.push(`%${location}%`); pi++; }

    const alumni = (await pool.query(`SELECT * FROM alumni_profiles ap WHERE ${where.join(' AND ')} ORDER BY ap.graduation_year DESC, ap.full_name ASC`, params)).rows;
    const totalAlumni = (await pool.query(`SELECT COUNT(*)::int as cnt FROM alumni_profiles WHERE tenant_id=$1`, [tid])).rows[0].cnt;
    const verifiedCount = (await pool.query(`SELECT COUNT(*)::int as cnt FROM alumni_profiles WHERE tenant_id=$1 AND is_verified=true`, [tid])).rows[0].cnt;
    const mentorCount = (await pool.query(`SELECT COUNT(*)::int as cnt FROM alumni_profiles WHERE tenant_id=$1 AND mentor=true`, [tid])).rows[0].cnt;
    const departments = (await pool.query(`SELECT DISTINCT department FROM alumni_profiles WHERE tenant_id=$1 AND department IS NOT NULL ORDER BY department`, [tid])).rows.map(r => r.department);
    const years = (await pool.query(`SELECT DISTINCT graduation_year FROM alumni_profiles WHERE tenant_id=$1 AND graduation_year IS NOT NULL ORDER BY graduation_year DESC`, [tid])).rows.map(r => r.graduation_year);
    const totalDonated = (await pool.query(`SELECT COALESCE(SUM(amount),0) as total FROM alumni_donations WHERE tenant_id=$1`, [tid])).rows[0].total;
    const activeJobs = (await pool.query(`SELECT COUNT(*)::int as cnt FROM alumni_jobs WHERE tenant_id=$1 AND is_active=true`, [tid])).rows[0].cnt;

    const cards = alumni.map(a => `<div class="al-card">
      <div class="al-card-header"></div>
      <div class="al-card-body">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
          <div class="al-avatar">${esc((a.full_name || '?').charAt(0).toUpperCase())}</div>
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:6px">
              <strong style="font-size:15px;color:#1e293b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(a.full_name)}</strong>
              ${a.is_verified ? '<span class="badge badge-success" style="font-size:9px">✓ Verified</span>' : ''}
              ${a.mentor ? '<span class="badge badge-warning" style="font-size:9px">🎯 Mentor</span>' : ''}
            </div>
            <div style="font-size:12px;color:#64748b">${a.job_title ? esc(a.job_title) + ' at ' : ''}${esc(a.current_employer || '')}</div>
          </div>
        </div>
        <div style="font-size:12px;color:#64748b;display:flex;flex-direction:column;gap:3px">
          ${a.graduation_year ? '<div>🎓 Class of ' + esc(String(a.graduation_year)) + (a.department ? ' — ' + esc(a.department) : '') + '</div>' : ''}
          ${a.course ? '<div>📚 ' + esc(a.course) + '</div>' : ''}
          ${a.city || a.country ? '<div>📍 ' + esc([a.city, a.country].filter(Boolean).join(', ')) + '</div>' : ''}
        </div>
        <div style="margin-top:12px"><a href="/alumni/profile/${a.id}" class="btn btn-sm" style="background:#f0fdfa;color:#0f766e;font-weight:600">View Profile →</a></div>
      </div>
    </div>`).join('');

    const html = ALUMNI_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('directory')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">🎓 Alumni Network</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Connect with fellow alumni</p></div>
        <a href="/alumni/profile/new" class="btn btn-blue" style="padding:10px 20px;font-size:13px;font-weight:600">+ Create Profile</a>
      </div>
      <div class="stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-bottom:20px">
        <div class="stat-card"><div class="stat-num" style="color:#0f766e">${totalAlumni}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Total Alumni</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#16a34a">${verifiedCount}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Verified</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#d97706">${mentorCount}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Mentors</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#2563eb">${activeJobs}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Open Jobs</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#dc2626">${fmtMoney(totalDonated)}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Total Donations</div></div>
      </div>
      <div class="al-filter">
        <div><label>Search</label>
          <form method="GET" action="/alumni" style="display:flex;gap:6px">
            <input type="text" name="search" value="${esc(search)}" placeholder="Name, employer, title..." style="width:200px">
            <button type="submit" class="btn btn-sm" style="background:#0f766e;color:#fff">Search</button>
          </form>
        </div>
        <div><label>Year</label>
          <select onchange="location.href='/alumni?year='+this.value+(location.search.includes('search')?'&search=${esc(search)}':'')">
            <option value="">All Years</option>
            ${years.map(y => `<option value="${y}" ${String(year) === String(y) ? 'selected' : ''}>${y}</option>`).join('')}
          </select>
        </div>
        <div><label>Department</label>
          <select onchange="location.href='/alumni?department='+this.value">
            <option value="">All Departments</option>
            ${departments.map(d => `<option value="${esc(d)}" ${department === d ? 'selected' : ''}>${esc(d)}</option>`).join('')}
          </select>
        </div>
      </div>
      ${alumni.length ? `<div class="al-grid">${cards}</div>` : '<div class="card" style="text-align:center;padding:48px"><p style="font-size:18px;color:#64748b;margin-bottom:16px">No alumni found</p><a href="/alumni/profile/new" class="btn btn-blue">Create Your Profile</a></div>'}
    </div>`;
    res.send(renderPage('Alumni Directory', html, user, req));
  }));

  // ============================================================
  // ROUTE 2: GET /alumni/profile/new — Create profile form
  // ============================================================
  app.get('/alumni/profile/new', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user;
    const html = ALUMNI_CSS + `<div style="max-width:750px;margin:0 auto">
      ${nav('directory')}
      <a href="/alumni" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Directory</a>
      <div class="card" style="padding:28px">
        <h2 style="margin:0 0 4px;color:#1e293b">🎓 Create Alumni Profile</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:24px">Share your professional details with the alumni community</p>
        <form method="POST" action="/alumni/profile/create" style="display:flex;flex-direction:column;gap:16px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Full Name *</label>
              <input type="text" name="full_name" required placeholder="John Doe" style="width:100%;padding:11px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px"></div>
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Email</label>
              <input type="email" name="email" value="${esc(user.email || '')}" style="width:100%;padding:11px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px"></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px">
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Phone</label>
              <input type="tel" name="phone" placeholder="+1 555 0123" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Graduation Year</label>
              <input type="number" name="graduation_year" placeholder="2020" min="1950" max="2099" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Course</label>
              <input type="text" name="course" placeholder="BSc Computer Science" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Department</label>
              <input type="text" name="department" placeholder="Engineering" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Job Title</label>
              <input type="text" name="job_title" placeholder="Software Engineer" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Current Employer</label>
              <input type="text" name="current_employer" placeholder="Acme Inc." style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Location</label>
              <input type="text" name="city" placeholder="City" style="width:50%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px;margin-right:6px">
              <input type="text" name="country" placeholder="Country" style="width:calc(50% - 6px);padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
          </div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Bio</label>
            <textarea name="bio" rows="3" placeholder="Tell us about yourself..." style="width:100%;padding:11px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;resize:vertical"></textarea></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">LinkedIn URL</label>
              <input type="url" name="linkedin_url" placeholder="https://linkedin.com/in/..." style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Twitter URL</label>
              <input type="url" name="twitter_url" placeholder="https://twitter.com/..." style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
          </div>
          <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#475569;padding:12px;background:#f8fafc;border-radius:10px;cursor:pointer">
            <input type="checkbox" name="mentor" value="true" style="accent-color:#0f766e"> I am available as a mentor</label>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Mentor Areas (comma-separated)</label>
            <input type="text" name="mentor_areas" placeholder="career advice, tech interviews, startups" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
          <button type="submit" class="btn btn-green" style="padding:14px 28px;font-size:15px">🚀 Create Profile</button>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Create Alumni Profile', html, user, req));
  }));

  // ============================================================
  // ROUTE 3: POST /alumni/profile/create — Save profile
  // ============================================================
  app.post('/alumni/profile/create', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { full_name, email, phone, graduation_year, course, department, current_employer,
      job_title, city, country, bio, linkedin_url, twitter_url, mentor, mentor_areas } = req.body;
    if (!full_name || !full_name.trim()) return res.redirect('/alumni/profile/new');
    const areas = mentor_areas ? mentor_areas.split(',').map(a => a.trim()).filter(Boolean) : [];
    await pool.query(
      `INSERT INTO alumni_profiles (tenant_id,full_name,email,phone,graduation_year,course,department,current_employer,job_title,city,country,bio,linkedin_url,twitter_url,mentor,mentor_areas)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [tid, full_name.trim(), (email || '').trim(), (phone || '').trim(),
       graduation_year ? parseInt(graduation_year) : null, (course || '').trim(),
       (department || '').trim(), (current_employer || '').trim(), (job_title || '').trim(),
       (city || '').trim(), (country || '').trim(), (bio || '').trim(),
       (linkedin_url || '').trim(), (twitter_url || '').trim(),
       mentor === 'true', areas.length ? areas : null]
    );
    req.session.flash = { type: 'success', msg: 'Profile created successfully!' };
    res.redirect('/alumni');
  }));

  // ============================================================
  // ROUTE 4: GET /alumni/profile/:id — View alumni profile
  // ============================================================
  app.get('/alumni/profile/:id', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, id = req.params.id;
    const profile = (await pool.query(`SELECT * FROM alumni_profiles WHERE id=$1 AND tenant_id=$2`, [id, tid])).rows[0];
    if (!profile) return res.send(renderPage('Not Found', '<div class="card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">Profile not found</h2><a href="/alumni" class="btn btn-sm" style="background:#0f766e;color:#fff;margin-top:12px">← Directory</a></div>', user, req));

    const donations = (await pool.query(`SELECT COALESCE(SUM(amount),0) as total FROM alumni_donations WHERE tenant_id=$1 AND donor_id=$2`, [tid, profile.id])).rows[0].total;
    const mentorBadge = profile.mentor ? `<span class="badge badge-warning" style="font-size:12px;padding:4px 14px">🎯 Available as Mentor</span>` : '';

    const html = ALUMNI_CSS + `<div style="max-width:900px;margin:0 auto">
      ${nav('directory')}
      <a href="/alumni" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Directory</a>
      <div class="card" style="overflow:hidden;margin-bottom:20px">
        <div style="height:10px;background:linear-gradient(90deg,#0f766e,#14b8a6)"></div>
        <div style="padding:28px">
          <div style="display:flex;align-items:center;gap:18px;margin-bottom:20px;flex-wrap:wrap">
            <div class="al-avatar" style="width:72px;height:72px;font-size:28px">${esc(profile.full_name.charAt(0).toUpperCase())}</div>
            <div style="flex:1;min-width:0">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                <h1 style="font-size:24px;color:#1e293b;margin:0">${esc(profile.full_name)}</h1>
                ${profile.is_verified ? '<span class="badge badge-success">✓ Verified</span>' : ''}
                ${mentorBadge}
              </div>
              <div style="font-size:14px;color:#64748b;margin-top:4px">${profile.job_title ? esc(profile.job_title) + ' at ' : ''}${esc(profile.current_employer || '')}</div>
            </div>
            <a href="/alumni/profile/${id}/edit" class="btn btn-sm" style="background:#f1f5f9;color:#475569">✏️ Edit</a>
          </div>
          ${profile.bio ? `<p style="font-size:14px;color:#475569;line-height:1.7;margin-bottom:20px;padding:16px;background:#f8fafc;border-radius:10px">${esc(profile.bio)}</p>` : ''}
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin-bottom:20px">
            ${profile.graduation_year ? `<div style="font-size:13px;color:#64748b"><strong style="color:#1e293b">🎓</strong> Class of ${esc(String(profile.graduation_year))}</div>` : ''}
            ${profile.course ? `<div style="font-size:13px;color:#64748b"><strong style="color:#1e293b">📚</strong> ${esc(profile.course)}</div>` : ''}
            ${profile.department ? `<div style="font-size:13px;color:#64748b"><strong style="color:#1e293b">🏢</strong> ${esc(profile.department)}</div>` : ''}
            ${profile.city || profile.country ? `<div style="font-size:13px;color:#64748b"><strong style="color:#1e293b">📍</strong> ${esc([profile.city, profile.country].filter(Boolean).join(', '))}</div>` : ''}
            ${profile.email ? `<div style="font-size:13px;color:#64748b"><strong style="color:#1e293b">✉️</strong> <a href="mailto:${esc(profile.email)}" style="color:#0f766e">${esc(profile.email)}</a></div>` : ''}
            ${profile.phone ? `<div style="font-size:13px;color:#64748b"><strong style="color:#1e293b">📞</strong> ${esc(profile.phone)}</div>` : ''}
          </div>
          ${profile.mentor && profile.mentor_areas && profile.mentor_areas.length ? `<div style="margin-bottom:16px"><strong style="font-size:13px;color:#1e293b">Mentor Areas:</strong> <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">${profile.mentor_areas.map(a => `<span class="badge" style="background:#fef9c3;color:#a16207">${esc(a)}</span>`).join('')}</div></div>` : ''}
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            ${profile.linkedin_url ? `<a href="${esc(profile.linkedin_url)}" target="_blank" class="btn btn-sm" style="background:#0077b5;color:#fff">LinkedIn ↗</a>` : ''}
            ${profile.twitter_url ? `<a href="${esc(profile.twitter_url)}" target="_blank" class="btn btn-sm" style="background:#1da1f2;color:#fff">Twitter ↗</a>` : ''}
            ${Number(donations) > 0 ? `<span class="badge badge-success" style="font-size:12px;padding:6px 14px">💛 Donated ${fmtMoney(donations)}</span>` : ''}
          </div>
        </div>
      </div>
    </div>`;
    res.send(renderPage(profile.full_name + ' — Alumni Profile', html, user, req));
  }));

  // ============================================================
  // ROUTE 5: GET /alumni/profile/:id/edit — Edit profile
  // ============================================================
  app.get('/alumni/profile/:id/edit', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, id = req.params.id;
    const profile = (await pool.query(`SELECT * FROM alumni_profiles WHERE id=$1 AND tenant_id=$2`, [id, tid])).rows[0];
    if (!profile) return res.redirect('/alumni');

    const html = ALUMNI_CSS + `<div style="max-width:750px;margin:0 auto">
      ${nav('directory')}
      <a href="/alumni/profile/${id}" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Profile</a>
      <div class="card" style="padding:28px">
        <h2 style="margin:0 0 4px;color:#1e293b">✏️ Edit Alumni Profile</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:24px">Update details for "${esc(profile.full_name)}"</p>
        <form method="POST" action="/alumni/profile/${id}/update" style="display:flex;flex-direction:column;gap:16px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Full Name *</label>
              <input type="text" name="full_name" required value="${esc(profile.full_name)}" style="width:100%;padding:11px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px"></div>
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Email</label>
              <input type="email" name="email" value="${esc(profile.email || '')}" style="width:100%;padding:11px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px"></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px">
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Phone</label>
              <input type="tel" name="phone" value="${esc(profile.phone || '')}" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Graduation Year</label>
              <input type="number" name="graduation_year" value="${profile.graduation_year || ''}" min="1950" max="2099" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Course</label>
              <input type="text" name="course" value="${esc(profile.course || '')}" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Department</label>
              <input type="text" name="department" value="${esc(profile.department || '')}" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Job Title</label>
              <input type="text" name="job_title" value="${esc(profile.job_title || '')}" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px">
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Employer</label>
              <input type="text" name="current_employer" value="${esc(profile.current_employer || '')}" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">City</label>
              <input type="text" name="city" value="${esc(profile.city || '')}" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Country</label>
              <input type="text" name="country" value="${esc(profile.country || '')}" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
          </div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Bio</label>
            <textarea name="bio" rows="3" style="width:100%;padding:11px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;resize:vertical">${esc(profile.bio || '')}</textarea></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">LinkedIn URL</label>
              <input type="url" name="linkedin_url" value="${esc(profile.linkedin_url || '')}" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Twitter URL</label>
              <input type="url" name="twitter_url" value="${esc(profile.twitter_url || '')}" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#475569;padding:12px;background:#f8fafc;border-radius:10px;cursor:pointer">
              <input type="checkbox" name="mentor" value="true" ${profile.mentor ? 'checked' : ''} style="accent-color:#0f766e"> Available as mentor</label>
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Mentor Areas</label>
              <input type="text" name="mentor_areas" value="${esc(Array.isArray(profile.mentor_areas) ? profile.mentor_areas.join(', ') : (profile.mentor_areas || ''))}" placeholder="comma-separated" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#475569;padding:12px;background:#f8fafc;border-radius:10px;cursor:pointer">
              <input type="checkbox" name="is_verified" value="true" ${profile.is_verified ? 'checked' : ''} style="accent-color:#0f766e"> Verified alumni</label>
            <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#475569;padding:12px;background:#f8fafc;border-radius:10px;cursor:pointer">
              <input type="checkbox" name="is_visible" value="true" ${profile.is_visible ? 'checked' : ''} style="accent-color:#0f766e"> Visible in directory</label>
          </div>
          <button type="submit" class="btn btn-green" style="padding:14px 28px;font-size:15px">💾 Save Changes</button>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Edit Alumni Profile', html, user, req));
  }));

  // ============================================================
  // ROUTE 6: POST /alumni/profile/:id/update — Update profile
  // ============================================================
  app.post('/alumni/profile/:id/update', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, id = req.params.id;
    const existing = (await pool.query(`SELECT id FROM alumni_profiles WHERE id=$1 AND tenant_id=$2`, [id, tid])).rows[0];
    if (!existing) return res.redirect('/alumni');
    const { full_name, email, phone, graduation_year, course, department, current_employer,
      job_title, city, country, bio, linkedin_url, twitter_url, mentor, mentor_areas, is_verified, is_visible } = req.body;
    if (!full_name || !full_name.trim()) return res.redirect(`/alumni/profile/${id}/edit`);
    const areas = mentor_areas ? mentor_areas.split(',').map(a => a.trim()).filter(Boolean) : [];
    await pool.query(
      `UPDATE alumni_profiles SET full_name=$1,email=$2,phone=$3,graduation_year=$4,course=$5,department=$6,current_employer=$7,job_title=$8,city=$9,country=$10,bio=$11,linkedin_url=$12,twitter_url=$13,mentor=$14,mentor_areas=$15,is_verified=$16,is_visible=$17,updated_at=NOW() WHERE id=$18 AND tenant_id=$19`,
      [full_name.trim(), (email || '').trim(), (phone || '').trim(), graduation_year ? parseInt(graduation_year) : null,
       (course || '').trim(), (department || '').trim(), (current_employer || '').trim(), (job_title || '').trim(),
       (city || '').trim(), (country || '').trim(), (bio || '').trim(), (linkedin_url || '').trim(),
       (twitter_url || '').trim(), mentor === 'true', areas.length ? areas : null, is_verified === 'true', is_visible !== 'false', id, tid]
    );
    req.session.flash = { type: 'success', msg: 'Profile updated successfully!' };
    res.redirect(`/alumni/profile/${id}`);
  }));

  // ============================================================
  // ROUTE 7: GET /alumni/events — Alumni events listing
  // ============================================================
  app.get('/alumni/events', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const events = (await pool.query(`SELECT ae.*, u.name as creator_name FROM alumni_events ae LEFT JOIN users u ON u.id=ae.created_by WHERE ae.tenant_id=$1 ORDER BY ae.event_date DESC NULLS LAST`, [tid])).rows;
    const upcoming = events.filter(e => e.event_date && new Date(e.event_date) >= new Date());

    const typeColors = { reunion: '#0f766e', seminar: '#7c3aed', workshop: '#2563eb', networking: '#ea580c', fundraiser: '#dc2626', career_fair: '#d97706', other: '#64748b' };
    const rows = events.map(e => `<tr>
      <td><strong style="color:#1e293b">${esc(e.title)}</strong>${e.description ? '<br><span class="muted" style="font-size:11px">' + esc(e.description.substring(0, 80)) + (e.description.length > 80 ? '...' : '') + '</span>' : ''}</td>
      <td>${e.event_date ? fmtDateTime(e.event_date) : '<span class="muted">TBD</span>'}</td>
      <td>${esc(e.venue || '—')}</td>
      <td><span class="badge" style="background:${typeColors[e.type] || typeColors.other};color:#fff;font-size:11px">${esc((e.type || 'other').replace(/_/g, ' '))}</span></td>
      <td>${e.max_attendees || '—'}</td>
      <td><span class="muted" style="font-size:12px">${fmtDate(e.created_at)}</span></td>
    </tr>`).join('');

    const html = ALUMNI_CSS + `<div style="max-width:1100px;margin:0 auto">
      ${nav('events')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">📅 Alumni Events</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">${upcoming.length} upcoming event${upcoming.length !== 1 ? 's' : ''}</p></div>
        <a href="/alumni/events/new" class="btn btn-green" style="padding:10px 20px;font-size:13px;font-weight:600">+ Create Event</a>
      </div>
      <div class="card">
        <div style="overflow-x:auto"><table class="al-table">
          <thead><tr><th>Event</th><th>Date</th><th>Venue</th><th>Type</th><th>Capacity</th><th>Created</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:30px">No events yet. Create the first alumni event!</td></tr>'}</tbody>
        </table></div>
      </div>
    </div>`;
    res.send(renderPage('Alumni Events', html, user, req));
  }));

  // ============================================================
  // ROUTE 8: GET /alumni/events/new — Create event form
  // ============================================================
  app.get('/alumni/events/new', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const html = ALUMNI_CSS + `<div style="max-width:700px;margin:0 auto">
      ${nav('events')}
      <a href="/alumni/events" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Events</a>
      <div class="card" style="padding:28px">
        <h2 style="margin:0 0 4px;color:#1e293b">🎉 Create Alumni Event</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:24px">Organize a reunion, seminar, or networking event</p>
        <form method="POST" action="/alumni/events/create" style="display:flex;flex-direction:column;gap:16px">
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Event Title *</label>
            <input type="text" name="title" required placeholder="Annual Alumni Reunion 2025" style="width:100%;padding:11px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px"></div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Description</label>
            <textarea name="description" rows="3" placeholder="Describe the event..." style="width:100%;padding:11px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;resize:vertical"></textarea></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Event Date & Time</label>
              <input type="datetime-local" name="event_date" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Type</label>
              <select name="type" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px">
                <option value="reunion">Reunion</option><option value="seminar">Seminar</option>
                <option value="workshop">Workshop</option><option value="networking">Networking</option>
                <option value="fundraiser">Fundraiser</option><option value="career_fair">Career Fair</option>
                <option value="other">Other</option>
              </select></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Venue</label>
              <input type="text" name="venue" placeholder="Main Auditorium" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Max Attendees</label>
              <input type="number" name="max_attendees" placeholder="Unlimited" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
          </div>
          <button type="submit" class="btn btn-green" style="padding:14px 28px;font-size:15px">🚀 Create Event</button>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Create Alumni Event', html, req.session.user, req));
  }));

  // ============================================================
  // ROUTE 9: POST /alumni/events/create — Save event
  // ============================================================
  app.post('/alumni/events/create', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { title, description, event_date, venue, type, max_attendees } = req.body;
    if (!title || !title.trim()) return res.redirect('/alumni/events/new');
    await pool.query(
      `INSERT INTO alumni_events (tenant_id,title,description,event_date,venue,type,max_attendees,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [tid, title.trim(), (description || '').trim(), event_date || null, (venue || '').trim(), type || 'reunion', max_attendees ? parseInt(max_attendees) : null, user.id]
    );
    req.session.flash = { type: 'success', msg: 'Event created successfully!' };
    res.redirect('/alumni/events');
  }));

  // ============================================================
  // ROUTE 10: GET /alumni/jobs — Job board
  // ============================================================
  app.get('/alumni/jobs', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const typeFilter = req.query.type || '';
    const jobs = (await pool.query(
      `SELECT aj.*, ap.full_name as poster_name FROM alumni_jobs aj LEFT JOIN alumni_profiles ap ON ap.id=aj.posted_by WHERE aj.tenant_id=$1 AND aj.is_active=true ${typeFilter ? 'AND aj.type=$2' : ''} ORDER BY aj.created_at DESC`,
      typeFilter ? [tid, typeFilter] : [tid]
    )).rows;
    const totalJobs = (await pool.query(`SELECT COUNT(*)::int as cnt FROM alumni_jobs WHERE tenant_id=$1 AND is_active=true`, [tid])).rows[0].cnt;

    const typeBadge = (t) => { const map = { full_time: { bg: '#dcfce7', c: '#16a34a', l: 'Full-Time' }, part_time: { bg: '#dbeafe', c: '#2563eb', l: 'Part-Time' }, contract: { bg: '#fef9c3', c: '#a16207', l: 'Contract' }, internship: { bg: '#f3e8ff', c: '#7c3aed', l: 'Internship' }, remote: { bg: '#ffedd5', c: '#ea580c', l: 'Remote' } }; const s = map[t] || map.full_time; return `<span class="badge" style="background:${s.bg};color:${s.c};font-size:11px">${s.l}</span>`; };

    const cards = jobs.map(j => `<div class="card" style="padding:18px;margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;align-items:start;flex-wrap:wrap;gap:8px">
        <div>
          <h3 style="margin:0 0 4px;font-size:16px;color:#1e293b">${esc(j.title)}</h3>
          <div style="font-size:13px;color:#64748b">${esc(j.company)} ${j.location ? '· 📍 ' + esc(j.location) : ''}</div>
        </div>
        <div style="display:flex;gap:6px;align-items:center">${typeBadge(j.type)}${j.salary_range ? '<span class="badge" style="background:#f0fdfa;color:#0f766e;font-size:11px">' + esc(j.salary_range) + '</span>' : ''}</div>
      </div>
      ${j.description ? '<p style="font-size:13px;color:#64748b;margin:10px 0 0;line-height:1.6">' + esc(j.description.substring(0, 150)) + (j.description.length > 150 ? '...' : '') + '</p>' : ''}
      <div style="margin-top:10px;font-size:11px;color:#94a3b8">Posted by ${esc(j.poster_name || 'Anonymous')} · ${fmtDate(j.created_at)}</div>
    </div>`).join('');

    const html = ALUMNI_CSS + `<div style="max-width:900px;margin:0 auto">
      ${nav('jobs')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">💼 Alumni Job Board</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">${totalJobs} active job${totalJobs !== 1 ? 's' : ''}</p></div>
        <a href="/alumni/jobs/new" class="btn btn-green" style="padding:10px 20px;font-size:13px;font-weight:600">+ Post a Job</a>
      </div>
      <div class="al-filter">
        <div><label>Type</label>
          <select onchange="location.href='/alumni/jobs?type='+this.value">
            <option value="">All Types</option>
            <option value="full_time" ${typeFilter==='full_time'?'selected':''}>Full-Time</option>
            <option value="part_time" ${typeFilter==='part_time'?'selected':''}>Part-Time</option>
            <option value="contract" ${typeFilter==='contract'?'selected':''}>Contract</option>
            <option value="internship" ${typeFilter==='internship'?'selected':''}>Internship</option>
            <option value="remote" ${typeFilter==='remote'?'selected':''}>Remote</option>
          </select>
        </div>
      </div>
      ${jobs.length ? cards : '<div class="card" style="text-align:center;padding:48px"><p style="font-size:18px;color:#64748b;margin-bottom:16px">No jobs posted yet</p><a href="/alumni/jobs/new" class="btn btn-green">Post the First Job</a></div>'}
    </div>`;
    res.send(renderPage('Alumni Job Board', html, user, req));
  }));

  // ============================================================
  // ROUTE 11: GET /alumni/jobs/new — Post job form
  // ============================================================
  app.get('/alumni/jobs/new', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const html = ALUMNI_CSS + `<div style="max-width:700px;margin:0 auto">
      ${nav('jobs')}
      <a href="/alumni/jobs" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Jobs</a>
      <div class="card" style="padding:28px">
        <h2 style="margin:0 0 4px;color:#1e293b">💼 Post a Job</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:24px">Share opportunities with fellow alumni</p>
        <form method="POST" action="/alumni/jobs/create" style="display:flex;flex-direction:column;gap:16px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Job Title *</label>
              <input type="text" name="title" required placeholder="Senior Developer" style="width:100%;padding:11px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px"></div>
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Company *</label>
              <input type="text" name="company" required placeholder="Acme Inc." style="width:100%;padding:11px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px"></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px">
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Location</label>
              <input type="text" name="location" placeholder="New York, NY" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Type</label>
              <select name="type" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px">
                <option value="full_time">Full-Time</option><option value="part_time">Part-Time</option>
                <option value="contract">Contract</option><option value="internship">Internship</option>
                <option value="remote">Remote</option>
              </select></div>
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Salary Range</label>
              <input type="text" name="salary_range" placeholder="$80k-$120k" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
          </div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Description</label>
            <textarea name="description" rows="4" placeholder="Describe the role, responsibilities, and what makes it exciting..." style="width:100%;padding:11px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;resize:vertical"></textarea></div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Requirements</label>
            <textarea name="requirements" rows="2" placeholder="Required skills and qualifications..." style="width:100%;padding:11px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;resize:vertical"></textarea></div>
          <button type="submit" class="btn btn-green" style="padding:14px 28px;font-size:15px">🚀 Post Job</button>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Post a Job', html, req.session.user, req));
  }));

  // ============================================================
  // ROUTE 12: POST /alumni/jobs/create — Save job posting
  // ============================================================
  app.post('/alumni/jobs/create', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { title, company, description, location, type, salary_range, requirements } = req.body;
    if (!title?.trim() || !company?.trim()) return res.redirect('/alumni/jobs/new');
    const alumniProfile = (await pool.query(`SELECT id FROM alumni_profiles WHERE tenant_id=$1 AND email=$2 LIMIT 1`, [tid, user.email])).rows[0];
    await pool.query(
      `INSERT INTO alumni_jobs (tenant_id,posted_by,company,title,description,location,type,salary_range,requirements) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [tid, alumniProfile ? alumniProfile.id : null, company.trim(), title.trim(), (description || '').trim(),
       (location || '').trim(), type || 'full_time', (salary_range || '').trim(), (requirements || '').trim()]
    );
    req.session.flash = { type: 'success', msg: 'Job posted successfully!' };
    res.redirect('/alumni/jobs');
  }));

  // ============================================================
  // ROUTE 13: GET /alumni/donations — Donation page
  // ============================================================
  app.get('/alumni/donations', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const donations = (await pool.query(
      `SELECT ad.*, ap.full_name as donor_profile_name FROM alumni_donations ad LEFT JOIN alumni_profiles ap ON ap.id=ad.donor_id WHERE ad.tenant_id=$1 ORDER BY ad.created_at DESC LIMIT 50`, [tid]
    )).rows;
    const stats = (await pool.query(
      `SELECT COUNT(*)::int as cnt, COALESCE(SUM(amount),0) as total, COALESCE(AVG(amount),0) as avg_amt, COUNT(*) FILTER (WHERE is_anonymous=true)::int as anon_cnt FROM alumni_donations WHERE tenant_id=$1`, [tid]
    )).rows[0];

    const rows = donations.map(d => `<tr>
      <td>${esc(d.is_anonymous ? 'Anonymous' : (d.donor_name || d.donor_profile_name || '—'))}</td>
      <td style="font-weight:700;color:#16a34a">${fmtMoney(d.amount)}</td>
      <td>${esc(d.purpose || '—')}</td>
      ${d.message ? '<td><span class="muted" style="font-size:12px">' + esc(d.message.substring(0, 60)) + (d.message.length > 60 ? '...' : '') + '</span></td>' : '<td>—</td>'}
      <td><span class="muted" style="font-size:12px">${fmtDate(d.created_at)}</span></td>
    </tr>`).join('');

    const html = ALUMNI_CSS + `<div style="max-width:1100px;margin:0 auto">
      ${nav('donations')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">💛 Alumni Donations</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Support your alma mater</p></div>
      </div>
      <div class="stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;margin-bottom:20px">
        <div class="stat-card"><div class="stat-num" style="color:#16a34a">${fmtMoney(stats.total)}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Total Raised</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#0f766e">${stats.cnt}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Donations</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#2563eb">${fmtMoney(stats.avg_amt)}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Average</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#64748b">${stats.anon_cnt}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Anonymous</div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px">
        <div class="card" style="padding:24px">
          <h3 style="margin:0 0 16px;color:#1e293b">💛 Make a Donation</h3>
          <form method="POST" action="/alumni/donate" style="display:flex;flex-direction:column;gap:14px">
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Your Name</label>
              <input type="text" name="donor_name" value="${esc(user.name || user.email || '')}" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Amount ($) *</label>
              <input type="number" name="amount" required min="1" step="0.01" placeholder="100.00" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;font-weight:600"></div>
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Purpose</label>
              <select name="purpose" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px">
                <option value="scholarship">Scholarship Fund</option><option value="infrastructure">Infrastructure</option>
                <option value="library">Library Fund</option><option value="research">Research Grant</option>
                <option value="general">General Support</option><option value="other">Other</option>
              </select></div>
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Message (optional)</label>
              <textarea name="message" rows="2" placeholder="Leave a message..." style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px;resize:vertical"></textarea></div>
            <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#475569;padding:10px;background:#f8fafc;border-radius:10px;cursor:pointer">
              <input type="checkbox" name="is_anonymous" value="true" style="accent-color:#0f766e"> Donate anonymously</label>
            <button type="submit" class="btn btn-gold" style="padding:14px 28px;font-size:15px;font-weight:700">💛 Donate Now</button>
          </form>
        </div>
        <div class="card" style="padding:24px">
          <h3 style="margin:0 0 16px;color:#1e293b">📜 Recent Donations</h3>
          ${donations.length ? `<div style="max-height:420px;overflow-y:auto">${donations.slice(0, 15).map(d => `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #f1f5f9">
            <div><strong style="font-size:13px;color:#1e293b">${esc(d.is_anonymous ? 'Anonymous' : (d.donor_name || d.donor_profile_name || 'Kind Donor'))}</strong><br><span class="muted" style="font-size:11px">${esc(d.purpose || 'General')}</span></div>
            <strong style="color:#16a34a;font-size:14px">${fmtMoney(d.amount)}</strong>
          </div>`).join('')}</div>` : '<p class="muted" style="font-size:13px;text-align:center;padding:40px 0">No donations yet. Be the first!</p>'}
        </div>
      </div>
      <div class="card">
        <div style="overflow-x:auto"><table class="al-table">
          <thead><tr><th>Donor</th><th>Amount</th><th>Purpose</th><th>Message</th><th>Date</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:30px">No donations recorded yet</td></tr>'}</tbody>
        </table></div>
      </div>
    </div>`;
    res.send(renderPage('Alumni Donations', html, user, req));
  }));

  // ============================================================
  // ROUTE 14: POST /alumni/donate — Process donation
  // ============================================================
  app.post('/alumni/donate', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { donor_name, amount, purpose, message, is_anonymous } = req.body;
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return res.redirect('/alumni/donations');
    const alumniProfile = (await pool.query(`SELECT id FROM alumni_profiles WHERE tenant_id=$1 AND email=$2 LIMIT 1`, [tid, user.email])).rows[0];
    await pool.query(
      `INSERT INTO alumni_donations (tenant_id,donor_id,donor_name,amount,purpose,message,is_anonymous) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [tid, alumniProfile ? alumniProfile.id : null, (donor_name || user.name || user.email || '').trim(), amt, (purpose || '').trim(), (message || '').trim(), is_anonymous === 'true']
    );
    req.session.flash = { type: 'success', msg: `Thank you for your donation of ${fmtMoney(amt)}!` };
    res.redirect('/alumni/donations');
  }));

  // ============================================================
  // ROUTE 15: GET /alumni/report — Alumni statistics
  // ============================================================
  app.get('/alumni/report', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    // Summary stats
    const summary = (await pool.query(`SELECT COUNT(*)::int as total, COUNT(*) FILTER (WHERE is_verified=true)::int as verified, COUNT(*) FILTER (WHERE mentor=true)::int as mentors, COUNT(DISTINCT graduation_year)::int as year_span, COUNT(DISTINCT department)::int as depts, COUNT(DISTINCT country)::int as countries FROM alumni_profiles WHERE tenant_id=$1`, [tid])).rows[0];

    // By graduation year
    const byYear = (await pool.query(`SELECT graduation_year, COUNT(*)::int as cnt FROM alumni_profiles WHERE tenant_id=$1 AND graduation_year IS NOT NULL GROUP BY graduation_year ORDER BY graduation_year DESC LIMIT 20`, [tid])).rows;
    const maxYearCount = Math.max(...byYear.map(r => r.cnt), 1);

    // By location (country)
    const byCountry = (await pool.query(`SELECT COALESCE(country,'Unknown') as country, COUNT(*)::int as cnt FROM alumni_profiles WHERE tenant_id=$1 GROUP BY country ORDER BY cnt DESC LIMIT 15`, [tid])).rows;

    // By department
    const byDept = (await pool.query(`SELECT COALESCE(department,'Undeclared') as department, COUNT(*)::int as cnt FROM alumni_profiles WHERE tenant_id=$1 GROUP BY department ORDER BY cnt DESC LIMIT 15`, [tid])).rows;

    // By employer (industry proxy)
    const byEmployer = (await pool.query(`SELECT COALESCE(current_employer,'Unemployed') as employer, COUNT(*)::int as cnt FROM alumni_profiles WHERE tenant_id=$1 AND current_employer IS NOT NULL AND current_employer != '' GROUP BY current_employer ORDER BY cnt DESC LIMIT 15`, [tid])).rows;

    // Jobs and donations summary
    const jobStats = (await pool.query(`SELECT COUNT(*)::int as total, COUNT(*) FILTER (WHERE is_active=true)::int as active, COUNT(DISTINCT company)::int as companies FROM alumni_jobs WHERE tenant_id=$1`, [tid])).rows[0];
    const donationStats = (await pool.query(`SELECT COUNT(*)::int as cnt, COALESCE(SUM(amount),0) as total, COALESCE(MIN(amount),0) as min_amt, COALESCE(MAX(amount),0) as max_amt FROM alumni_donations WHERE tenant_id=$1`, [tid])).rows[0];

    // Event summary
    const eventStats = (await pool.query(`SELECT COUNT(*)::int as total, COUNT(*) FILTER (WHERE event_date >= NOW())::int as upcoming FROM alumni_events WHERE tenant_id=$1`, [tid])).rows[0];

    const yearBars = byYear.map(r => `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
      <span style="font-size:12px;font-weight:600;color:#1e293b;width:50px;text-align:right">${esc(String(r.graduation_year))}</span>
      <div style="flex:1;background:#f1f5f9;border-radius:6px;height:24px;overflow:hidden">
        <div style="width:${Math.round(r.cnt / maxYearCount * 100)}%;height:100%;background:linear-gradient(90deg,#0f766e,#14b8a6);border-radius:6px;display:flex;align-items:center;justify-content:flex-end;padding:0 8px">
          <span style="font-size:11px;font-weight:700;color:#fff">${r.cnt}</span>
        </div>
      </div>
    </div>`).join('');

    const countryBars = byCountry.map(r => `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #f1f5f9">
      <span style="font-size:13px;color:#1e293b">${esc(r.country)}</span>
      <div style="display:flex;align-items:center;gap:8px"><div style="width:${Math.round(r.cnt / Math.max(...byCountry.map(x => x.cnt), 1) * 120)}px;height:8px;background:#0f766e;border-radius:4px"></div><span style="font-size:12px;font-weight:600;color:#475569">${r.cnt}</span></div>
    </div>`).join('');

    const deptBars = byDept.map(r => `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #f1f5f9">
      <span style="font-size:13px;color:#1e293b">${esc(r.department)}</span>
      <span style="font-size:12px;font-weight:600;color:#0f766e;background:#f0fdfa;padding:2px 10px;border-radius:10px">${r.cnt}</span>
    </div>`).join('');

    const employerBars = byEmployer.map(r => `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #f1f5f9">
      <span style="font-size:13px;color:#1e293b">${esc(r.employer)}</span>
      <span style="font-size:12px;font-weight:600;color:#2563eb;background:#eff6ff;padding:2px 10px;border-radius:10px">${r.cnt}</span>
    </div>`).join('');

    const html = ALUMNI_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('report')}
      <div style="margin-bottom:20px"><h1 style="font-size:24px;color:#1e293b">📊 Alumni Analytics</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Insights into your alumni network</p></div>
      <div class="stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:14px;margin-bottom:24px">
        <div class="stat-card"><div class="stat-num" style="color:#0f766e">${summary.total}</div><div class="muted" style="font-size:11px">Total Alumni</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#16a34a">${summary.verified}</div><div class="muted" style="font-size:11px">Verified</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#d97706">${summary.mentors}</div><div class="muted" style="font-size:11px">Mentors</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#2563eb">${summary.year_span}</div><div class="muted" style="font-size:11px">Year Span</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#7c3aed">${summary.depts}</div><div class="muted" style="font-size:11px">Departments</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#ea580c">${summary.countries}</div><div class="muted" style="font-size:11px">Countries</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#dc2626">${jobStats.active}</div><div class="muted" style="font-size:11px">Open Jobs</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#16a34a">${fmtMoney(donationStats.total)}</div><div class="muted" style="font-size:11px">Total Donated</div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px">
        <div class="card" style="padding:20px">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 16px">📈 Alumni by Graduation Year</h3>
          ${yearBars || '<p class="muted" style="font-size:13px;text-align:center;padding:20px">No data</p>'}
        </div>
        <div class="card" style="padding:20px">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 16px">🌍 Alumni by Country</h3>
          ${countryBars || '<p class="muted" style="font-size:13px;text-align:center;padding:20px">No data</p>'}
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
        <div class="card" style="padding:20px">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 16px">🏢 Alumni by Department</h3>
          ${deptBars || '<p class="muted" style="font-size:13px;text-align:center;padding:20px">No data</p>'}
        </div>
        <div class="card" style="padding:20px">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 16px">💼 Alumni by Employer</h3>
          ${employerBars || '<p class="muted" style="font-size:13px;text-align:center;padding:20px">No data</p>'}
        </div>
      </div>
      <div class="card" style="margin-top:20px;padding:20px">
        <h3 style="font-size:15px;color:#1e293b;margin:0 0 16px">📋 Platform Summary</h3>
        <table class="al-table">
          <tbody>
            <tr><td style="font-weight:600">Total Alumni Profiles</td><td>${summary.total}</td></tr>
            <tr><td style="font-weight:600">Verified Alumni</td><td>${summary.verified}</td></tr>
            <tr><td style="font-weight:600">Available Mentors</td><td>${summary.mentors}</td></tr>
            <tr><td style="font-weight:600">Alumni Events</td><td>${eventStats.total} (${eventStats.upcoming} upcoming)</td></tr>
            <tr><td style="font-weight:600">Job Postings</td><td>${jobStats.total} total, ${jobStats.active} active across ${jobStats.companies} companies</td></tr>
            <tr><td style="font-weight:600">Donations</td><td>${donationStats.cnt} donations totaling ${fmtMoney(donationStats.total)} (range: ${fmtMoney(donationStats.min_amt)} – ${fmtMoney(donationStats.max_amt)})</td></tr>
          </tbody>
        </table>
      </div>
    </div>`;
    res.send(renderPage('Alumni Report', html, user, req));
  }));

  console.log('[Alumni] Alumni network loaded');
};
