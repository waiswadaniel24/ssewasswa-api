// ============================================================
// INTERNSHIP & WORK PLACEMENT TRACKER MODULE
// Multi-Tenant SaaS School Portal — Comfort Zone
// ============================================================
// Tables: internship_companies, internships, internship_applications,
//         internship_timesheets, internship_evaluations
// Usage in server.js:
//   const internshipTracker = require('./internship-tracker');
//   internshipTracker(app, pool, { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT });
// ============================================================

'use strict';

module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5', GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.btn:hover{background:#3730a3}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}.badge{display:inline-block;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600}.badge-green{background:#d1fae5;color:#065f46}.badge-yellow{background:#fef3c7;color:#92400e}.badge-red{background:#fee2e2;color:#991b1b}.badge-blue{background:#dbeafe;color:#1e40af}.badge-gray{background:#f3f4f6;color:#374151}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px}.stat-card{background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;border-radius:12px;padding:20px}.stat-card h3{margin:0 0 4px;font-size:13px;opacity:.85}.stat-card .val{font-size:28px;font-weight:700}.form-group{margin-bottom:16px}.form-group label{display:block;margin-bottom:4px;font-weight:600;font-size:14px;color:#374151}.alert{padding:12px 16px;border-radius:8px;margin-bottom:16px}.alert-success{background:#d1fae5;color:#065f46}.alert-info{background:#dbeafe;color:#1e40af}.flex{display:flex;gap:12px;align-items:center}.mt-2{margin-top:8px}.mb-2{margin-bottom:8px}.text-sm{font-size:14px}.text-muted{color:#6b7280}.text-right{text-align:right}.w-full{width:100%}.btn-danger{background:#ef4444}.btn-danger:hover{background:#dc2626}.btn-sm{padding:4px 12px;font-size:13px}.btn-outline{background:transparent;border:1px solid #d1d5db;color:#374151}.btn-outline:hover{background:#f9fafb}progress{width:100%;height:8px;border-radius:4px;border:none}progress::-webkit-progress-bar{background:#e5e7eb;border-radius:4px}progress::-webkit-progress-value{background:#4f46e5;border-radius:4px}</style>';

  const BREAD = '<div class="breadcrumb" style="margin-bottom:16px"><a href="/school" style="color:#4f46e5">School</a> &rsaquo; <a href="/school/internships" style="color:#4f46e5">Internships</a>';

  // ── Helpers ───────────────────────────────────────────────
  const errJson = (res, msg, code) => res.status(code || 400).json({ success: false, error: msg });
  const okJson = (res, data, code) => res.status(code || 200).json({ success: true, ...data });
  const parseNum = (v, fb) => { const n = parseFloat(v); return isNaN(n) ? (fb || 0) : n; };
  const parseJson = (v, fb) => { try { return typeof v === 'string' ? JSON.parse(v) : (v || fb || {}); } catch(e) { return fb || {}; } };
  const statusBadge = (s) => {
    const map = {
      active: 'badge-green', open: 'badge-green', approved: 'badge-green', completed: 'badge-green',
      pending: 'badge-yellow', in_progress: 'badge-blue', submitted: 'badge-blue',
      rejected: 'badge-red', withdrawn: 'badge-red', cancelled: 'badge-red', closed: 'badge-gray',
      draft: 'badge-gray', expired: 'badge-gray', offered: 'badge-blue',
      interview: 'badge-blue', shortlisted: 'badge-blue', accepted: 'badge-green',
    };
    return `<span class="badge ${map[s] || 'badge-gray'}">${esc(s || 'unknown').replace(/_/g,' ')}</span>`;
  };
  const INDUSTRIES = ['Technology','Healthcare','Finance','Education','Engineering','Marketing','Media','Manufacturing','Retail','Government','NGO','Legal','Agriculture','Hospitality','Creative Arts','Research','Other'];

  // ── Database Migration ────────────────────────────────────
  (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS internship_companies (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        name VARCHAR(255) NOT NULL,
        industry VARCHAR(100),
        contact_person VARCHAR(255),
        email VARCHAR(255),
        phone VARCHAR(50),
        address TEXT,
        website VARCHAR(500),
        description TEXT,
        rating NUMERIC(3,2) DEFAULT 0,
        total_interns INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      await pool.query(`CREATE TABLE IF NOT EXISTS internships (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        company_id INTEGER NOT NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        requirements TEXT,
        duration_weeks INTEGER DEFAULT 12,
        stipend NUMERIC(10,2) DEFAULT 0,
        start_date DATE,
        end_date DATE,
        status VARCHAR(30) DEFAULT 'open',
        max_positions INTEGER DEFAULT 5,
        current_applicants INTEGER DEFAULT 0,
        skills_required JSONB DEFAULT '[]',
        location VARCHAR(255),
        is_remote BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      await pool.query(`CREATE TABLE IF NOT EXISTS internship_applications (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        internship_id INTEGER NOT NULL,
        student_id INTEGER NOT NULL,
        cover_letter TEXT,
        status VARCHAR(30) DEFAULT 'pending',
        applied_at TIMESTAMPTZ DEFAULT NOW(),
        reviewed_at TIMESTAMPTZ,
        interview_date TIMESTAMPTZ,
        interview_notes TEXT,
        offer_date TIMESTAMPTZ,
        accepted_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        certificate_id INTEGER,
        rejection_reason TEXT,
        resume_url VARCHAR(500),
        portfolio_url VARCHAR(500),
        supervisor_name VARCHAR(255),
        supervisor_email VARCHAR(255),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      await pool.query(`CREATE TABLE IF NOT EXISTS internship_timesheets (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        application_id INTEGER NOT NULL,
        week_number INTEGER NOT NULL,
        hours_worked NUMERIC(5,2) DEFAULT 0,
        tasks_completed TEXT,
        supervisor_signoff BOOLEAN DEFAULT false,
        supervisor_notes TEXT,
        submitted_at TIMESTAMPTZ DEFAULT NOW(),
        approved_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      await pool.query(`CREATE TABLE IF NOT EXISTS internship_evaluations (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        application_id INTEGER NOT NULL,
        evaluator_id INTEGER NOT NULL,
        evaluator_type VARCHAR(30) DEFAULT 'supervisor',
        rating NUMERIC(3,2) DEFAULT 0,
        punctuality INTEGER DEFAULT 0,
        teamwork INTEGER DEFAULT 0,
        communication INTEGER DEFAULT 0,
        technical_skills INTEGER DEFAULT 0,
        problem_solving INTEGER DEFAULT 0,
        initiative INTEGER DEFAULT 0,
        comments TEXT,
        strengths TEXT,
        improvements TEXT,
        would_recommend BOOLEAN DEFAULT false,
        skills_acquired JSONB DEFAULT '[]',
        overall_grade VARCHAR(10),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      await pool.query(`CREATE TABLE IF NOT EXISTS internship_interviews (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        application_id INTEGER NOT NULL,
        interviewer_id INTEGER,
        company_contact_id INTEGER,
        scheduled_at TIMESTAMPTZ,
        duration_minutes INTEGER DEFAULT 30,
        location VARCHAR(255),
        meeting_link VARCHAR(500),
        status VARCHAR(30) DEFAULT 'scheduled',
        notes TEXT,
        outcome VARCHAR(30),
        feedback TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      await pool.query(`CREATE TABLE IF NOT EXISTS internship_documents (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        application_id INTEGER NOT NULL,
        document_type VARCHAR(50) NOT NULL,
        file_name VARCHAR(255),
        file_url VARCHAR(500),
        uploaded_by INTEGER,
        description TEXT,
        is_verified BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      await pool.query(`CREATE TABLE IF NOT EXISTS internship_progress_reports (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        application_id INTEGER NOT NULL,
        report_type VARCHAR(50) DEFAULT 'weekly',
        week_number INTEGER DEFAULT 0,
        content TEXT,
        highlights TEXT,
        challenges TEXT,
        goals_next_period TEXT,
        supervisor_comments TEXT,
        status VARCHAR(30) DEFAULT 'draft',
        submitted_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      await pool.query(`CREATE TABLE IF NOT EXISTS internship_certificates (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        application_id INTEGER NOT NULL,
        student_id INTEGER NOT NULL,
        certificate_number VARCHAR(100) UNIQUE,
        title VARCHAR(255),
        description TEXT,
        issued_at TIMESTAMPTZ DEFAULT NOW(),
        skills_list JSONB DEFAULT '[]',
        grade VARCHAR(10),
        hours_completed INTEGER DEFAULT 0,
        company_name VARCHAR(255),
        company_signature VARCHAR(255),
        school_signature VARCHAR(255),
        template_color VARCHAR(20) DEFAULT '#4f46e5',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      // Create indexes
      const indexes = [
        'idx_ic_tenant ON internship_companies(tenant_id)',
        'idx_ic_industry ON internship_companies(tenant_id, industry)',
        'idx_intern_tenant ON internships(tenant_id)',
        'idx_intern_company ON internships(tenant_id, company_id)',
        'idx_intern_status ON internships(tenant_id, status)',
        'idx_ia_tenant ON internship_applications(tenant_id)',
        'idx_ia_intern ON internship_applications(tenant_id, internship_id)',
        'idx_ia_student ON internship_applications(tenant_id, student_id)',
        'idx_ia_status ON internship_applications(tenant_id, status)',
        'idx_it_tenant ON internship_timesheets(tenant_id)',
        'idx_it_app ON internship_timesheets(tenant_id, application_id)',
        'idx_ie_tenant ON internship_evaluations(tenant_id)',
        'idx_ie_app ON internship_evaluations(tenant_id, application_id)',
        'idx_iv_tenant ON internship_interviews(tenant_id)',
        'idx_iv_app ON internship_interviews(tenant_id, application_id)',
        'idx_idoc_tenant ON internship_documents(tenant_id)',
        'idx_ipr_tenant ON internship_progress_reports(tenant_id)',
        'idx_icert_tenant ON internship_certificates(tenant_id)',
        'idx_icert_num ON internship_certificates(certificate_number)'
      ];
      for (const idx of indexes) {
        await pool.query(`CREATE INDEX IF NOT EXISTS ${idx}`);
      }

      console.log('[InternshipTracker] Tables ready');
    } catch(e) {
      console.warn('[InternshipTracker] Migration warning:', e.message);
    }
  })();

  // ============================================================
  // 1. DASHBOARD — Overview with stats
  // ============================================================
  app.get('/school/internships', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const [companies, internships, applications, activePlacements] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS n FROM internship_companies WHERE tenant_id=$1 AND is_active=true`, [tid]),
      pool.query(`SELECT COUNT(*)::int AS n FROM internships WHERE tenant_id=$1 AND status='open'`, [tid]),
      pool.query(`SELECT COUNT(*)::int AS n FROM internship_applications WHERE tenant_id=$1 AND status='pending'`, [tid]),
      pool.query(`SELECT COUNT(*)::int AS n FROM internship_applications WHERE tenant_id=$1 AND status IN ('accepted','in_progress','completed')`, [tid]),
    ]);
    const [completed, totalHours, avgRating] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS n FROM internship_applications WHERE tenant_id=$1 AND status='completed'`, [tid]),
      pool.query(`SELECT COALESCE(SUM(hours_worked),0)::numeric AS t FROM internship_timesheets it JOIN internship_applications ia ON ia.id=it.application_id WHERE ia.tenant_id=$1`, [tid]),
      pool.query(`SELECT COALESCE(AVG(rating),0)::numeric(3,2) AS r FROM internship_evaluations WHERE tenant_id=$1`, [tid]),
    ]);
    const recentApps = await pool.query(
      `SELECT ia.*, i.title AS internship_title, ic.name AS company_name, s.first_name, s.last_name
       FROM internship_applications ia
       JOIN internships i ON i.id=ia.internship_id
       JOIN internship_companies ic ON ic.id=i.company_id
       LEFT JOIN students s ON s.id=ia.student_id
       WHERE ia.tenant_id=$1 ORDER BY ia.applied_at DESC LIMIT 10`, [tid]);

    let html = SKIP + BREAD + '</div>';
    html += '<h1 style="font-size:24px;margin-bottom:20px">Internship & Work Placement Tracker</h1>';
    html += '<div class="grid">';
    html += `<div class="stat-card"><h3>Partner Companies</h3><div class="val">${companies.rows[0].n}</div></div>`;
    html += `<div class="stat-card" style="background:linear-gradient(135deg,#059669,#10b981)"><h3>Open Positions</h3><div class="val">${internships.rows[0].n}</div></div>`;
    html += `<div class="stat-card" style="background:linear-gradient(135deg,#d97706,#f59e0b)"><h3>Pending Applications</h3><div class="val">${applications.rows[0].n}</div></div>`;
    html += `<div class="stat-card" style="background:linear-gradient(135deg,#7c3aed,#a78bfa)"><h3>Active Placements</h3><div class="val">${activePlacements.rows[0].n}</div></div>`;
    html += `<div class="stat-card" style="background:linear-gradient(135deg,#0891b2,#06b6d4)"><h3>Completed</h3><div class="val">${completed.rows[0].n}</div></div>`;
    html += `<div class="stat-card" style="background:linear-gradient(135deg,#64748b,#94a3b8)"><h3>Total Hours Logged</h3><div class="val">${Math.round(parseNum(totalHours.rows[0].t))}</div></div>`;
    html += '</div>';

    html += '<div class="flex" style="margin:20px 0 12px;flex-wrap:wrap;gap:8px">';
    html += '<a href="/school/internships/companies" class="btn btn-outline">Companies</a>';
    html += '<a href="/school/internships/postings" class="btn btn-outline">Internship Postings</a>';
    html += '<a href="/school/internships/applications" class="btn btn-outline">Applications</a>';
    html += '<a href="/school/internships/timesheets" class="btn btn-outline">Timesheets</a>';
    html += '<a href="/school/internships/evaluations" class="btn btn-outline">Evaluations</a>';
    html += '<a href="/school/internships/reports" class="btn btn-outline">Progress Reports</a>';
    html += '<a href="/school/internships/certificates" class="btn btn-outline">Certificates</a>';
    html += '<a href="/school/internships/interviews" class="btn btn-outline">Interviews</a>';
    html += '<a href="/school/internships/documents" class="btn btn-outline">Documents</a>';
    html += '<a href="/school/internships/analytics" class="btn btn-outline">Analytics</a>';
    html += '</div>';

    html += '<div class="card"><h3 style="margin-top:0">Recent Applications</h3>';
    if (recentApps.rows.length === 0) {
      html += '<p class="text-muted">No applications yet.</p>';
    } else {
      html += '<table><thead><tr><th>Student</th><th>Position</th><th>Company</th><th>Status</th><th>Applied</th></tr></thead><tbody>';
      for (const a of recentApps.rows) {
        html += `<tr><td>${esc(a.first_name||'')} ${esc(a.last_name||'')}</td><td>${esc(a.internship_title||'')}</td>`;
        html += `<td>${esc(a.company_name||'')}</td><td>${statusBadge(a.status)}</td>`;
        html += `<td>${a.applied_at ? new Date(a.applied_at).toLocaleDateString() : ''}</td></tr>`;
      }
      html += '</tbody></table>';
    }
    html += '</div>';
    renderPage(req, res, html, 'Internship Tracker');
  }));

  // ============================================================
  // 2. COMPANIES — List, Create, Edit, Delete
  // ============================================================
  app.get('/school/internships/companies', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    let where = ['ic.tenant_id = $1'], params = [tid], pi = 2;
    if (req.query.search) {
      where.push(`(ic.name ILIKE $${pi} OR ic.industry ILIKE $${pi} OR ic.contact_person ILIKE $${pi})`);
      params.push(`%${req.query.search}%`); pi++;
    }
    if (req.query.industry) { where.push(`ic.industry = $${pi}`); params.push(req.query.industry); pi++; }
    const r = await pool.query(
      `SELECT ic.*, (SELECT COUNT(*)::int FROM internships i WHERE i.company_id=ic.id AND i.tenant_id=$1) AS posting_count,
        (SELECT COUNT(*)::int FROM internship_applications ia JOIN internships i2 ON i2.id=ia.internship_id WHERE i2.company_id=ic.id AND ia.tenant_id=$1 AND ia.status='completed') AS completed_interns
       FROM internship_companies ic WHERE ${where.join(' AND ')} ORDER BY ic.name ASC`, params);

    let html = SKIP + BREAD + ' &rsaquo; Companies</div>';
    html += '<h2>Partner Companies</h2>';
    html += '<div class="flex" style="margin-bottom:16px">';
    html += '<form method="get" class="flex" style="flex:1"><input name="search" placeholder="Search companies..." style="max-width:300px;margin:0"> ';
    html += '<select name="industry" style="max-width:200px"><option value="">All Industries</option>';
    for (const ind of INDUSTRIES) html += `<option value="${esc(ind)}">${esc(ind)}</option>`;
    html += '</select><button class="btn" type="submit">Search</button></form>';
    html += '<a href="/school/internships/companies/new" class="btn">+ Add Company</a></div>';

    if (r.rows.length === 0) {
      html += '<div class="card"><p class="text-muted">No companies found. Add your first partner company.</p></div>';
    } else {
      html += '<table><thead><tr><th>Company</th><th>Industry</th><th>Contact</th><th>Postings</th><th>Completed</th><th>Rating</th><th>Actions</th></tr></thead><tbody>';
      for (const c of r.rows) {
        html += `<tr><td><strong>${esc(c.name)}</strong></td><td>${esc(c.industry||'—')}</td>`;
        html += `<td>${esc(c.contact_person||'—')}<br><span class="text-sm text-muted">${esc(c.email||'')}</span></td>`;
        html += `<td>${c.posting_count}</td><td>${c.completed_interns}</td>`;
        html += `<td>${c.rating > 0 ? c.rating + '/5' : '—'}</td>`;
        html += `<td><a href="/school/internships/companies/${c.id}" class="btn btn-sm btn-outline">View</a> `;
        html += `<a href="/school/internships/companies/${c.id}/edit" class="btn btn-sm btn-outline">Edit</a></td></tr>`;
      }
      html += '</tbody></table>';
    }
    renderPage(req, res, html, 'Internship Companies');
  }));

  app.get('/school/internships/companies/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    let html = SKIP + BREAD + ' &rsaquo; Companies &rsaquo; New</div>';
    html += '<h2>Add Partner Company</h2>';
    html += '<form method="post" action="/school/internships/companies" class="card">';
    html += '<div class="grid">';
    html += '<div class="form-group"><label>Company Name *</label><input name="name" required></div>';
    html += '<div class="form-group"><label>Industry</label><select name="industry">';
    html += '<option value="">Select Industry</option>';
    for (const ind of INDUSTRIES) html += `<option value="${esc(ind)}">${esc(ind)}</option>`;
    html += '</select></div>';
    html += '</div><div class="grid">';
    html += '<div class="form-group"><label>Contact Person</label><input name="contact_person"></div>';
    html += '<div class="form-group"><label>Email</label><input name="email" type="email"></div>';
    html += '</div><div class="grid">';
    html += '<div class="form-group"><label>Phone</label><input name="phone"></div>';
    html += '<div class="form-group"><label>Website</label><input name="website" placeholder="https://"></div>';
    html += '</div>';
    html += '<div class="form-group"><label>Address</label><textarea name="address" rows="2"></textarea></div>';
    html += '<div class="form-group"><label>Description</label><textarea name="description" rows="3"></textarea></div>';
    html += '<button class="btn" type="submit">Save Company</button>';
    html += ' <a href="/school/internships/companies" class="btn btn-outline">Cancel</a>';
    html += '</form>';
    renderPage(req, res, html, 'Add Company');
  }));

  app.post('/school/internships/companies', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const { name, industry, contact_person, email, phone, address, website, description } = req.body;
    if (!name || !name.trim()) {
      req.session.flash = { type: 'error', msg: 'Company name is required' };
      return res.redirect('/school/internships/companies/new');
    }
    await pool.query(
      `INSERT INTO internship_companies (tenant_id, name, industry, contact_person, email, phone, address, website, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [tid, name.trim(), industry || null, contact_person || null, email || null, phone || null, address || null, website || null, description || null]
    );
    audit(req, 'internship_company_created', { name: name.trim() });
    req.session.flash = { type: 'success', msg: 'Company added successfully' };
    res.redirect('/school/internships/companies');
  }));

  app.get('/school/internships/companies/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const c = await pool.query(`SELECT * FROM internship_companies WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
    if (!c.rows[0]) return res.status(404).send('Company not found');
    const comp = c.rows[0];
    const postings = await pool.query(
      `SELECT i.*, (SELECT COUNT(*)::int FROM internship_applications ia WHERE ia.internship_id=i.id) AS app_count
       FROM internships i WHERE i.company_id=$1 AND i.tenant_id=$2 ORDER BY i.created_at DESC`, [comp.id, tid]);
    const evaluations = await pool.query(
      `SELECT AVG(ie.rating)::numeric(3,2) AS avg_rating, COUNT(*)::int AS eval_count,
        AVG(ie.punctuality)::numeric(3,2) AS avg_punctuality, AVG(ie.teamwork)::numeric(3,2) AS avg_teamwork,
        AVG(ie.technical_skills)::numeric(3,2) AS avg_tech, AVG(ie.communication)::numeric(3,2) AS avg_comm
       FROM internship_evaluations ie JOIN internship_applications ia ON ia.id=ie.application_id
       JOIN internships i ON i.id=ia.internship_id WHERE i.company_id=$1 AND ie.tenant_id=$2`, [comp.id, tid]);

    let html = SKIP + BREAD + ` &rsaquo; Companies &rsaquo; ${esc(comp.name)}</div>`;
    html += `<h2>${esc(comp.name)}</h2>`;
    html += '<div class="grid">';
    html += `<div class="card"><strong>Industry:</strong> ${esc(comp.industry||'—')}</div>`;
    html += `<div class="card"><strong>Contact:</strong> ${esc(comp.contact_person||'—')}</div>`;
    html += `<div class="card"><strong>Email:</strong> ${esc(comp.email||'—')}</div>`;
    html += `<div class="card"><strong>Phone:</strong> ${esc(comp.phone||'—')}</div>`;
    html += '</div>';
    if (comp.description) html += `<div class="card"><strong>About:</strong><p>${esc(comp.description)}</p></div>`;
    if (evaluations.rows[0] && evaluations.rows[0].eval_count > 0) {
      const ev = evaluations.rows[0];
      html += `<div class="card"><h3>Company Performance</h3>`;
      html += `<div class="grid">`;
      html += `<div class="stat-card"><h3>Average Rating</h3><div class="val">${ev.avg_rating}/5</div></div>`;
      html += `<div class="stat-card" style="background:linear-gradient(135deg,#059669,#10b981)"><h3>Punctuality</h3><div class="val">${ev.avg_punctuality}/5</div></div>`;
      html += `<div class="stat-card" style="background:linear-gradient(135deg,#d97706,#f59e0b)"><h3>Teamwork</h3><div class="val">${ev.avg_teamwork}/5</div></div>`;
      html += `<div class="stat-card" style="background:linear-gradient(135deg,#7c3aed,#a78bfa)"><h3>Technical Skills</h3><div class="val">${ev.avg_tech}/5</div></div>`;
      html += '</div></div>';
    }
    html += '<div class="card"><h3>Internship Postings (' + postings.rows.length + ')</h3>';
    if (postings.rows.length === 0) {
      html += '<p class="text-muted">No postings from this company yet.</p>';
    } else {
      html += '<table><thead><tr><th>Title</th><th>Status</th><th>Duration</th><th>Stipend</th><th>Applicants</th></tr></thead><tbody>';
      for (const p of postings.rows) {
        html += `<tr><td>${esc(p.title)}</td><td>${statusBadge(p.status)}</td><td>${p.duration_weeks} weeks</td>`;
        html += `<td>${p.stipend > 0 ? '$' + p.stipend : 'Unpaid'}</td><td>${p.app_count}</td></tr>`;
      }
      html += '</tbody></table>';
    }
    html += '</div>';
    html += '<a href="/school/internships/companies/' + comp.id + '/edit" class="btn">Edit Company</a> ';
    html += `<form method="post" action="/school/internships/companies/${comp.id}/delete" style="display:inline" onsubmit="return confirm('Delete this company?')"><button class="btn btn-danger" type="submit">Delete</button></form>`;
    renderPage(req, res, html, comp.name);
  }));

  app.get('/school/internships/companies/:id/edit', requireAuth, requireNotBanned, ah(async (req, res) => {
    const c = await pool.query(`SELECT * FROM internship_companies WHERE id=$1 AND tenant_id=$2`, [req.params.id, req.user.tenant_id]);
    if (!c.rows[0]) return res.status(404).send('Company not found');
    const comp = c.rows[0];
    let html = SKIP + BREAD + ` &rsaquo; Companies &rsaquo; ${esc(comp.name)} &rsaquo; Edit</div>`;
    html += '<h2>Edit Company: ' + esc(comp.name) + '</h2>';
    html += `<form method="post" action="/school/internships/companies/${comp.id}" class="card">`;
    html += '<div class="grid">';
    html += `<div class="form-group"><label>Company Name *</label><input name="name" value="${esc(comp.name)}" required></div>`;
    html += `<div class="form-group"><label>Industry</label><select name="industry">`;
    html += '<option value="">Select Industry</option>';
    for (const ind of INDUSTRIES) html += `<option value="${esc(ind)}" ${comp.industry === ind ? 'selected' : ''}>${esc(ind)}</option>`;
    html += '</select></div></div><div class="grid">';
    html += `<div class="form-group"><label>Contact Person</label><input name="contact_person" value="${esc(comp.contact_person||'')}"></div>`;
    html += `<div class="form-group"><label>Email</label><input name="email" type="email" value="${esc(comp.email||'')}"></div>`;
    html += '</div><div class="grid">';
    html += `<div class="form-group"><label>Phone</label><input name="phone" value="${esc(comp.phone||'')}"></div>`;
    html += `<div class="form-group"><label>Website</label><input name="website" value="${esc(comp.website||'')}"></div>`;
    html += '</div>';
    html += `<div class="form-group"><label>Address</label><textarea name="address" rows="2">${esc(comp.address||'')}</textarea></div>`;
    html += `<div class="form-group"><label>Description</label><textarea name="description" rows="3">${esc(comp.description||'')}</textarea></div>`;
    html += '<button class="btn" type="submit">Update Company</button>';
    html += ` <a href="/school/internships/companies/${comp.id}" class="btn btn-outline">Cancel</a>`;
    html += '</form>';
    renderPage(req, res, html, 'Edit Company');
  }));

  app.post('/school/internships/companies/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id, cid = req.params.id;
    const { name, industry, contact_person, email, phone, address, website, description } = req.body;
    const ex = await pool.query(`SELECT id FROM internship_companies WHERE id=$1 AND tenant_id=$2`, [cid, tid]);
    if (!ex.rows[0]) return res.status(404).send('Company not found');
    await pool.query(
      `UPDATE internship_companies SET name=$1, industry=$2, contact_person=$3, email=$4, phone=$5, address=$6, website=$7, description=$8, updated_at=NOW()
       WHERE id=$9 AND tenant_id=$10`,
      [name?.trim(), industry || null, contact_person || null, email || null, phone || null, address || null, website || null, description || null, cid, tid]
    );
    audit(req, 'internship_company_updated', { company_id: cid });
    req.session.flash = { type: 'success', msg: 'Company updated' };
    res.redirect(`/school/internships/companies/${cid}`);
  }));

  app.post('/school/internships/companies/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const r = await pool.query(`DELETE FROM internship_companies WHERE id=$1 AND tenant_id=$2 RETURNING id`, [req.params.id, tid]);
    if (!r.rows[0]) return res.status(404).send('Company not found');
    audit(req, 'internship_company_deleted', { company_id: req.params.id });
    req.session.flash = { type: 'success', msg: 'Company deleted' };
    res.redirect('/school/internships/companies');
  }));

  // ============================================================
  // 3. INTERNSHIP POSTINGS — CRUD
  // ============================================================
  app.get('/school/internships/postings', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    let where = ['i.tenant_id = $1'], params = [tid], pi = 2;
    if (req.query.status) { where.push(`i.status = $${pi}`); params.push(req.query.status); pi++; }
    if (req.query.search) {
      where.push(`(i.title ILIKE $${pi} OR ic.name ILIKE $${pi})`);
      params.push(`%${req.query.search}%`); pi++;
    }
    const r = await pool.query(
      `SELECT i.*, ic.name AS company_name, ic.industry AS company_industry,
        (SELECT COUNT(*)::int FROM internship_applications ia WHERE ia.internship_id=i.id AND ia.tenant_id=$1) AS app_count
       FROM internships i JOIN internship_companies ic ON ic.id=i.company_id
       WHERE ${where.join(' AND ')} ORDER BY i.created_at DESC`, params);

    let html = SKIP + BREAD + ' &rsaquo; Postings</div>';
    html += '<h2>Internship Postings</h2>';
    html += '<div class="flex" style="margin-bottom:16px">';
    html += '<form method="get" class="flex" style="flex:1"><input name="search" placeholder="Search postings..." style="max-width:300px;margin:0"> ';
    html += '<select name="status" style="max-width:160px"><option value="">All Status</option>';
    for (const s of ['open','closed','expired','cancelled']) html += `<option value="${s}">${s}</option>`;
    html += '</select><button class="btn" type="submit">Filter</button></form>';
    html += '<a href="/school/internships/postings/new" class="btn">+ New Posting</a></div>';

    if (r.rows.length === 0) {
      html += '<div class="card"><p class="text-muted">No postings found.</p></div>';
    } else {
      html += '<table><thead><tr><th>Title</th><th>Company</th><th>Status</th><th>Duration</th><th>Stipend</th><th>Applicants</th><th>Actions</th></tr></thead><tbody>';
      for (const p of r.rows) {
        html += `<tr><td><strong>${esc(p.title)}</strong></td><td>${esc(p.company_name)}</td>`;
        html += `<td>${statusBadge(p.status)}</td><td>${p.duration_weeks} weeks</td>`;
        html += `<td>${p.stipend > 0 ? '$' + p.stipend : 'Unpaid'}</td><td>${p.app_count}</td>`;
        html += `<td><a href="/school/internships/postings/${p.id}" class="btn btn-sm btn-outline">View</a> `;
        html += `<a href="/school/internships/postings/${p.id}/edit" class="btn btn-sm btn-outline">Edit</a></td></tr>`;
      }
      html += '</tbody></table>';
    }
    renderPage(req, res, html, 'Internship Postings');
  }));

  app.get('/school/internships/postings/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const companies = await pool.query(`SELECT id, name FROM internship_companies WHERE tenant_id=$1 AND is_active=true ORDER BY name`, [tid]);
    let html = SKIP + BREAD + ' &rsaquo; Postings &rsaquo; New</div>';
    html += '<h2>Create Internship Posting</h2>';
    html += '<form method="post" action="/school/internships/postings" class="card">';
    html += '<div class="grid">';
    html += `<div class="form-group"><label>Company *</label><select name="company_id" required>`;
    html += '<option value="">Select Company</option>';
    for (const c of companies.rows) html += `<option value="${c.id}">${esc(c.name)}</option>`;
    html += '</select></div>';
    html += '<div class="form-group"><label>Title *</label><input name="title" required></div>';
    html += '</div>';
    html += '<div class="form-group"><label>Description</label><textarea name="description" rows="3"></textarea></div>';
    html += '<div class="form-group"><label>Requirements</label><textarea name="requirements" rows="2"></textarea></div>';
    html += '<div class="grid">';
    html += '<div class="form-group"><label>Duration (weeks)</label><input name="duration_weeks" type="number" value="12" min="1"></div>';
    html += '<div class="form-group"><label>Stipend ($)</label><input name="stipend" type="number" value="0" min="0"></div>';
    html += '<div class="form-group"><label>Max Positions</label><input name="max_positions" type="number" value="5" min="1"></div>';
    html += '</div>';
    html += '<div class="grid">';
    html += '<div class="form-group"><label>Start Date</label><input name="start_date" type="date"></div>';
    html += '<div class="form-group"><label>End Date</label><input name="end_date" type="date"></div>';
    html += '</div>';
    html += '<div class="grid">';
    html += '<div class="form-group"><label>Location</label><input name="location"></div>';
    html += '<div class="form-group"><label><input type="checkbox" name="is_remote" value="true"> Remote Position</label></div>';
    html += '</div>';
    html += '<div class="form-group"><label>Skills Required (comma separated)</label><input name="skills_required" placeholder="e.g. Python, Data Analysis, Communication"></div>';
    html += '<button class="btn" type="submit">Create Posting</button>';
    html += ' <a href="/school/internships/postings" class="btn btn-outline">Cancel</a>';
    html += '</form>';
    renderPage(req, res, html, 'New Internship Posting');
  }));

  app.post('/school/internships/postings', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const { company_id, title, description, requirements, duration_weeks, stipend, max_positions, start_date, end_date, location, is_remote, skills_required } = req.body;
    if (!title || !company_id) {
      req.session.flash = { type: 'error', msg: 'Title and company are required' };
      return res.redirect('/school/internships/postings/new');
    }
    const skills = (skills_required || '').split(',').map(s => s.trim()).filter(Boolean);
    await pool.query(
      `INSERT INTO internships (tenant_id, company_id, title, description, requirements, duration_weeks, stipend, start_date, end_date, max_positions, location, is_remote, skills_required, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'open')`,
      [tid, company_id, title.trim(), description || null, requirements || null, parseInt(duration_weeks)||12, parseNum(stipend), start_date||null, end_date||null, parseInt(max_positions)||5, location||null, is_remote==='true', JSON.stringify(skills)]
    );
    audit(req, 'internship_posting_created', { title: title.trim(), company_id });
    req.session.flash = { type: 'success', msg: 'Posting created successfully' };
    res.redirect('/school/internships/postings');
  }));

  app.get('/school/internships/postings/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const p = await pool.query(
      `SELECT i.*, ic.name AS company_name, ic.email AS company_email, ic.phone AS company_phone, ic.address AS company_address
       FROM internships i JOIN internship_companies ic ON ic.id=i.company_id WHERE i.id=$1 AND i.tenant_id=$2`, [req.params.id, tid]);
    if (!p.rows[0]) return res.status(404).send('Posting not found');
    const post = p.rows[0];
    const apps = await pool.query(
      `SELECT ia.*, s.first_name, s.last_name, s.admission_number
       FROM internship_applications ia LEFT JOIN students s ON s.id=ia.student_id
       WHERE ia.internship_id=$1 AND ia.tenant_id=$2 ORDER BY ia.applied_at DESC`, [post.id, tid]);

    let html = SKIP + BREAD + ` &rsaquo; Postings &rsaquo; ${esc(post.title)}</div>`;
    html += `<h2>${esc(post.title)}</h2>`;
    html += '<div class="grid">';
    html += `<div class="card"><strong>Company:</strong> ${esc(post.company_name)}</div>`;
    html += `<div class="card"><strong>Status:</strong> ${statusBadge(post.status)}</div>`;
    html += `<div class="card"><strong>Duration:</strong> ${post.duration_weeks} weeks</div>`;
    html += `<div class="card"><strong>Stipend:</strong> ${post.stipend > 0 ? '$'+post.stipend : 'Unpaid'}</div>`;
    html += `<div class="card"><strong>Positions:</strong> ${apps.rows.filter(a=>a.status==='accepted'||a.status==='in_progress').length}/${post.max_positions}</div>`;
    if (post.location) html += `<div class="card"><strong>Location:</strong> ${esc(post.location)}${post.is_remote?' (Remote)':''}</div>`;
    html += '</div>';
    if (post.description) html += `<div class="card"><strong>Description:</strong><p>${esc(post.description)}</p></div>`;
    if (post.requirements) html += `<div class="card"><strong>Requirements:</strong><p>${esc(post.requirements)}</p></div>`;
    const skills = parseJson(post.skills_required, []);
    if (skills.length) html += `<div class="card"><strong>Skills Required:</strong> ${skills.map(s => `<span class="badge badge-blue">${esc(s)}</span>`).join(' ')}</div>`;

    html += `<div class="card"><h3>Applications (${apps.rows.length})</h3>`;
    if (apps.rows.length === 0) {
      html += '<p class="text-muted">No applications yet.</p>';
    } else {
      html += '<table><thead><tr><th>Student</th><th>Status</th><th>Applied</th><th>Actions</th></tr></thead><tbody>';
      for (const a of apps.rows) {
        html += `<tr><td>${esc(a.first_name||'')} ${esc(a.last_name||'')} ${a.admission_number?'('+esc(a.admission_number)+')':''}</td>`;
        html += `<td>${statusBadge(a.status)}</td><td>${a.applied_at ? new Date(a.applied_at).toLocaleDateString() : ''}</td>`;
        html += `<td><a href="/school/internships/applications/${a.id}" class="btn btn-sm btn-outline">Review</a></td></tr>`;
      }
      html += '</tbody></table>';
    }
    html += '</div>';
    html += `<a href="/school/internships/postings/${post.id}/edit" class="btn">Edit</a> `;
    html += '<a href="/school/internships/postings" class="btn btn-outline">Back</a>';
    renderPage(req, res, html, post.title);
  }));

  app.get('/school/internships/postings/:id/edit', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const [p, companies] = await Promise.all([
      pool.query(`SELECT * FROM internships WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]),
      pool.query(`SELECT id, name FROM internship_companies WHERE tenant_id=$1 AND is_active=true ORDER BY name`, [tid]),
    ]);
    if (!p.rows[0]) return res.status(404).send('Posting not found');
    const post = p.rows[0];
    const skills = (parseJson(post.skills_required, []) || []).join(', ');
    let html = SKIP + BREAD + ` &rsaquo; Postings &rsaquo; ${esc(post.title)} &rsaquo; Edit</div>`;
    html += '<h2>Edit Posting: ' + esc(post.title) + '</h2>';
    html += `<form method="post" action="/school/internships/postings/${post.id}" class="card">`;
    html += '<div class="grid">';
    html += `<div class="form-group"><label>Company *</label><select name="company_id" required>`;
    for (const c of companies.rows) html += `<option value="${c.id}" ${c.id===post.company_id?'selected':''}>${esc(c.name)}</option>`;
    html += '</select></div>';
    html += `<div class="form-group"><label>Title *</label><input name="title" value="${esc(post.title)}" required></div>`;
    html += '</div>';
    html += `<div class="form-group"><label>Description</label><textarea name="description" rows="3">${esc(post.description||'')}</textarea></div>`;
    html += `<div class="form-group"><label>Requirements</label><textarea name="requirements" rows="2">${esc(post.requirements||'')}</textarea></div>`;
    html += '<div class="grid">';
    html += `<div class="form-group"><label>Duration (weeks)</label><input name="duration_weeks" type="number" value="${post.duration_weeks}" min="1"></div>`;
    html += `<div class="form-group"><label>Stipend ($)</label><input name="stipend" type="number" value="${post.stipend}" min="0"></div>`;
    html += `<div class="form-group"><label>Max Positions</label><input name="max_positions" type="number" value="${post.max_positions}" min="1"></div>`;
    html += '</div><div class="grid">';
    html += `<div class="form-group"><label>Start Date</label><input name="start_date" type="date" value="${post.start_date||''}"></div>`;
    html += `<div class="form-group"><label>End Date</label><input name="end_date" type="date" value="${post.end_date||''}"></div>`;
    html += '</div><div class="grid">';
    html += `<div class="form-group"><label>Location</label><input name="location" value="${esc(post.location||'')}"></div>`;
    html += `<div class="form-group"><label>Status</label><select name="status">`;
    for (const s of ['open','closed','expired','cancelled']) html += `<option value="${s}" ${post.status===s?'selected':''}>${s}</option>`;
    html += '</select></div></div>';
    html += `<div class="form-group"><label>Skills Required</label><input name="skills_required" value="${esc(skills)}"></div>`;
    html += '<button class="btn" type="submit">Update Posting</button>';
    html += ` <a href="/school/internships/postings/${post.id}" class="btn btn-outline">Cancel</a></form>`;
    renderPage(req, res, html, 'Edit Posting');
  }));

  app.post('/school/internships/postings/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id, pid = req.params.id;
    const { company_id, title, description, requirements, duration_weeks, stipend, max_positions, start_date, end_date, location, status, is_remote, skills_required } = req.body;
    const ex = await pool.query(`SELECT id FROM internships WHERE id=$1 AND tenant_id=$2`, [pid, tid]);
    if (!ex.rows[0]) return res.status(404).send('Posting not found');
    const skills = (skills_required || '').split(',').map(s => s.trim()).filter(Boolean);
    await pool.query(
      `UPDATE internships SET company_id=$1, title=$2, description=$3, requirements=$4, duration_weeks=$5, stipend=$6,
        max_positions=$7, start_date=$8, end_date=$9, location=$10, status=$11, is_remote=$12, skills_required=$13, updated_at=NOW()
       WHERE id=$14 AND tenant_id=$15`,
      [company_id, title?.trim(), description||null, requirements||null, parseInt(duration_weeks)||12, parseNum(stipend),
       parseInt(max_positions)||5, start_date||null, end_date||null, location||null, status||'open', is_remote==='true',
       JSON.stringify(skills), pid, tid]
    );
    audit(req, 'internship_posting_updated', { posting_id: pid });
    req.session.flash = { type: 'success', msg: 'Posting updated' };
    res.redirect(`/school/internships/postings/${pid}`);
  }));

  // ============================================================
  // 4. APPLICATIONS — List, View, Review, Status Updates
  // ============================================================
  app.get('/school/internships/applications', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    let where = ['ia.tenant_id = $1'], params = [tid], pi = 2;
    if (req.query.status) { where.push(`ia.status = $${pi}`); params.push(req.query.status); pi++; }
    if (req.query.internship_id) { where.push(`ia.internship_id = $${pi}`); params.push(req.query.internship_id); pi++; }
    if (req.query.search) {
      where.push(`(s.first_name ILIKE $${pi} OR s.last_name ILIKE $${pi} OR i.title ILIKE $${pi})`);
      params.push(`%${req.query.search}%`); pi++;
    }
    const r = await pool.query(
      `SELECT ia.*, i.title AS internship_title, ic.name AS company_name, s.first_name, s.last_name, s.admission_number
       FROM internship_applications ia
       JOIN internships i ON i.id=ia.internship_id
       JOIN internship_companies ic ON ic.id=i.company_id
       LEFT JOIN students s ON s.id=ia.student_id
       WHERE ${where.join(' AND ')} ORDER BY ia.applied_at DESC`, params);

    let html = SKIP + BREAD + ' &rsaquo; Applications</div>';
    html += '<h2>Internship Applications</h2>';
    html += '<div class="flex" style="margin-bottom:16px">';
    html += '<form method="get" class="flex" style="flex:1"><input name="search" placeholder="Search..." style="max-width:250px;margin:0"> ';
    html += '<select name="status" style="max-width:160px"><option value="">All Status</option>';
    for (const s of ['pending','shortlisted','interview','offered','accepted','rejected','withdrawn','completed','in_progress']) html += `<option value="${s}">${s.replace(/_/g,' ')}</option>`;
    html += '</select><button class="btn" type="submit">Filter</button></form></div>';

    if (r.rows.length === 0) {
      html += '<div class="card"><p class="text-muted">No applications found.</p></div>';
    } else {
      html += '<table><thead><tr><th>Student</th><th>Position</th><th>Company</th><th>Status</th><th>Applied</th><th>Actions</th></tr></thead><tbody>';
      for (const a of r.rows) {
        html += `<tr><td>${esc(a.first_name||'')} ${esc(a.last_name||'')}</td>`;
        html += `<td>${esc(a.internship_title)}</td><td>${esc(a.company_name)}</td>`;
        html += `<td>${statusBadge(a.status)}</td><td>${a.applied_at ? new Date(a.applied_at).toLocaleDateString() : ''}</td>`;
        html += `<td><a href="/school/internships/applications/${a.id}" class="btn btn-sm btn-outline">Review</a></td></tr>`;
      }
      html += '</tbody></table>';
    }
    renderPage(req, res, html, 'Applications');
  }));

  app.get('/school/internships/applications/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id, aid = req.params.id;
    const a = await pool.query(
      `SELECT ia.*, i.title AS internship_title, i.description AS internship_desc, i.duration_weeks, i.stipend,
        ic.name AS company_name, ic.email AS company_email, ic.phone AS company_phone, ic.address AS company_address,
        s.first_name, s.last_name, s.admission_number, s.email AS student_email
       FROM internship_applications ia
       JOIN internships i ON i.id=ia.internship_id
       JOIN internship_companies ic ON ic.id=i.company_id
       LEFT JOIN students s ON s.id=ia.student_id
       WHERE ia.id=$1 AND ia.tenant_id=$2`, [aid, tid]);
    if (!a.rows[0]) return res.status(404).send('Application not found');
    const app = a.rows[0];
    const timesheets = await pool.query(
      `SELECT * FROM internship_timesheets WHERE application_id=$1 AND tenant_id=$2 ORDER BY week_number`, [aid, tid]);
    const evaluation = await pool.query(
      `SELECT * FROM internship_evaluations WHERE application_id=$1 AND tenant_id=$2 ORDER BY created_at DESC LIMIT 5`, [aid, tid]);
    const interviews = await pool.query(
      `SELECT * FROM internship_interviews WHERE application_id=$1 AND tenant_id=$2 ORDER BY scheduled_at DESC`, [aid, tid]);
    const docs = await pool.query(
      `SELECT * FROM internship_documents WHERE application_id=$1 AND tenant_id=$2 ORDER BY created_at DESC`, [aid, tid]);
    const progressReports = await pool.query(
      `SELECT * FROM internship_progress_reports WHERE application_id=$1 AND tenant_id=$2 ORDER BY week_number`, [aid, tid]);
    const totalHours = await pool.query(
      `SELECT COALESCE(SUM(hours_worked),0)::numeric AS t FROM internship_timesheets WHERE application_id=$1 AND tenant_id=$2`, [aid, tid]);

    let html = SKIP + BREAD + ` &rsaquo; Applications &rsaquo; ${esc(app.first_name||'')} ${esc(app.last_name||'')}</div>`;
    html += `<h2>${esc(app.first_name||'')} ${esc(app.last_name||'')} — ${esc(app.internship_title)}</h2>`;
    html += '<div class="grid">';
    html += `<div class="card"><strong>Company:</strong> ${esc(app.company_name)}</div>`;
    html += `<div class="card"><strong>Status:</strong> ${statusBadge(app.status)}</div>`;
    html += `<div class="card"><strong>Applied:</strong> ${app.applied_at ? new Date(app.applied_at).toLocaleDateString() : '—'}</div>`;
    html += `<div class="card"><strong>Total Hours:</strong> ${parseNum(totalHours.rows[0].t)}</div>`;
    html += '</div>';

    if (app.cover_letter) html += `<div class="card"><h3>Cover Letter</h3><p style="white-space:pre-wrap">${esc(app.cover_letter)}</p></div>`;
    if (app.interview_notes) html += `<div class="card"><h3>Interview Notes</h3><p>${esc(app.interview_notes)}</p></div>`;

    // Timesheets section
    html += '<div class="card"><h3>Timesheets</h3>';
    if (timesheets.rows.length === 0) {
      html += '<p class="text-muted">No timesheets submitted.</p>';
    } else {
      html += '<table><thead><tr><th>Week</th><th>Hours</th><th>Tasks</th><th>Sign-off</th></tr></thead><tbody>';
      for (const t of timesheets.rows) {
        html += `<tr><td>Week ${t.week_number}</td><td>${t.hours_worked}h</td>`;
        html += `<td>${esc(t.tasks_completed||'—')}</td><td>${t.supervisor_signoff?'✅ Signed':'⏳ Pending'}</td></tr>`;
      }
      html += '</tbody></table>';
    }
    html += '</div>';

    // Evaluations
    if (evaluation.rows.length > 0) {
      html += '<div class="card"><h3>Evaluations</h3>';
      for (const ev of evaluation.rows) {
        html += `<div style="border:1px solid #e5e7eb;border-radius:8px;padding:12px;margin-bottom:8px">`;
        html += `<strong>Rating:</strong> ${ev.rating}/5 | <strong>Type:</strong> ${esc(ev.evaluator_type)} | `;
        html += `<strong>Grade:</strong> ${esc(ev.overall_grade||'—')} | `;
        html += `<strong>Would Recommend:</strong> ${ev.would_recommend?'Yes':'No'}`;
        html += `<div style="margin-top:8px"><strong>Comments:</strong> ${esc(ev.comments||'No comments')}</div>`;
        const skills = parseJson(ev.skills_acquired, []);
        if (skills.length) html += `<div style="margin-top:4px"><strong>Skills Acquired:</strong> ${skills.map(s=>`<span class="badge badge-green">${esc(s)}</span>`).join(' ')}</div>`;
        html += '</div>';
      }
      html += '</div>';
    }

    // Interviews
    if (interviews.rows.length > 0) {
      html += '<div class="card"><h3>Interviews</h3>';
      html += '<table><thead><tr><th>Date</th><th>Duration</th><th>Status</th><th>Outcome</th></tr></thead><tbody>';
      for (const iv of interviews.rows) {
        html += `<tr><td>${iv.scheduled_at ? new Date(iv.scheduled_at).toLocaleString() : '—'}</td>`;
        html += `<td>${iv.duration_minutes} min</td><td>${statusBadge(iv.status)}</td>`;
        html += `<td>${esc(iv.outcome||'—')}</td></tr>`;
      }
      html += '</tbody></table></div>';
    }

    // Documents
    if (docs.rows.length > 0) {
      html += '<div class="card"><h3>Documents</h3>';
      for (const d of docs.rows) {
        html += `<div style="margin-bottom:6px">${statusBadge(d.document_type)} ${esc(d.file_name||'')} ${d.is_verified?'✅ Verified':''}`;
        if (d.file_url) html += ` <a href="${esc(d.file_url)}" class="btn btn-sm btn-outline">View</a>`;
        html += '</div>';
      }
      html += '</div>';
    }

    // Progress Reports
    if (progressReports.rows.length > 0) {
      html += '<div class="card"><h3>Progress Reports</h3>';
      for (const pr of progressReports.rows) {
        html += `<div style="border:1px solid #e5e7eb;border-radius:8px;padding:12px;margin-bottom:8px">`;
        html += `<strong>Week ${pr.week_number}</strong> — ${statusBadge(pr.status)} — ${pr.submitted_at ? new Date(pr.submitted_at).toLocaleDateString() : ''}`;
        if (pr.highlights) html += `<div style="margin-top:4px"><strong>Highlights:</strong> ${esc(pr.highlights)}</div>`;
        if (pr.challenges) html += `<div><strong>Challenges:</strong> ${esc(pr.challenges)}</div>`;
        html += '</div>';
      }
      html += '</div>';
    }

    // Action Buttons
    html += '<div style="margin-top:16px">';
    html += '<form method="post" action="/school/internships/applications/' + aid + '/status" style="display:inline">';
    html += '<select name="status" style="display:inline;width:auto;margin-right:8px">';
    for (const s of ['pending','shortlisted','interview','offered','accepted','rejected','withdrawn','completed','in_progress']) {
      html += `<option value="${s}" ${app.status===s?'selected':''}>${s.replace(/_/g,' ')}</option>`;
    }
    html += '</select><button class="btn" type="submit">Update Status</button></form>';
    html += '</div>';
    html += '<div style="margin-top:8px">';
    html += `<a href="/school/internships/timesheets?application_id=${aid}" class="btn btn-outline">Manage Timesheets</a> `;
    html += `<a href="/school/internships/evaluations?application_id=${aid}" class="btn btn-outline">Add Evaluation</a> `;
    html += `<a href="/school/internships/interviews?application_id=${aid}" class="btn btn-outline">Schedule Interview</a> `;
    html += `<a href="/school/internships/certificates/generate?application_id=${aid}" class="btn btn-outline">Generate Certificate</a>`;
    html += '</div>';

    renderPage(req, res, html, `Application - ${app.internship_title}`);
  }));

  app.post('/school/internships/applications/:id/status', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id, aid = req.params.id;
    const { status, rejection_reason } = req.body;
    const ex = await pool.query(`SELECT id, status FROM internship_applications WHERE id=$1 AND tenant_id=$2`, [aid, tid]);
    if (!ex.rows[0]) return res.status(404).send('Application not found');
    const validStatuses = ['pending','shortlisted','interview','offered','accepted','rejected','withdrawn','completed','in_progress'];
    if (!validStatuses.includes(status)) return res.status(400).send('Invalid status');
    await pool.query(
      `UPDATE internship_applications SET status=$1, rejection_reason=$2, updated_at=NOW() WHERE id=$3 AND tenant_id=$4`,
      [status, rejection_reason || null, aid, tid]
    );
    if (status === 'accepted') await pool.query(`UPDATE internship_applications SET accepted_at=NOW() WHERE id=$1 AND tenant_id=$2`, [aid, tid]);
    if (status === 'completed') await pool.query(`UPDATE internship_applications SET completed_at=NOW() WHERE id=$1 AND tenant_id=$2`, [aid, tid]);
    audit(req, 'internship_application_status', { application_id: aid, status });
    req.session.flash = { type: 'success', msg: `Status updated to ${status}` };
    res.redirect(`/school/internships/applications/${aid}`);
  }));

  // ============================================================
  // 5. APPLY — Student application form
  // ============================================================
  app.get('/school/internships/apply/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const i = await pool.query(
      `SELECT i.*, ic.name AS company_name FROM internships i JOIN internship_companies ic ON ic.id=i.company_id
       WHERE i.id=$1 AND i.tenant_id=$2 AND i.status='open'`, [req.params.id, tid]);
    if (!i.rows[0]) return res.status(404).send('Internship not found or not open');
    const post = i.rows[0];
    const existing = await pool.query(
      `SELECT id FROM internship_applications WHERE internship_id=$1 AND student_id=$2 AND tenant_id=$3 AND status NOT IN ('rejected','withdrawn')`,
      [post.id, req.user.id, tid]
    );
    let html = SKIP + BREAD + ` &rsaquo; Apply</div>`;
    html += `<h2>Apply: ${esc(post.title)} at ${esc(post.company_name)}</h2>`;
    html += '<div class="card">';
    html += `<p><strong>Company:</strong> ${esc(post.company_name)}</p>`;
    html += `<p><strong>Duration:</strong> ${post.duration_weeks} weeks</p>`;
    html += `<p><strong>Stipend:</strong> ${post.stipend > 0 ? '$'+post.stipend : 'Unpaid'}</p>`;
    if (post.location) html += `<p><strong>Location:</strong> ${esc(post.location)}${post.is_remote?' (Remote)':''}</p>`;
    if (post.requirements) html += `<p><strong>Requirements:</strong> ${esc(post.requirements)}</p>`;
    const skills = parseJson(post.skills_required, []);
    if (skills.length) html += `<p><strong>Skills:</strong> ${skills.map(s=>`<span class="badge badge-blue">${esc(s)}</span>`).join(' ')}</p>`;
    html += '</div>';

    if (existing.rows[0]) {
      html += '<div class="alert alert-info">You have already applied for this internship. <a href="/school/internships/my-internships">View your applications</a></div>';
    } else {
      html += `<form method="post" action="/school/internships/apply/${post.id}" class="card">`;
      html += '<div class="form-group"><label>Resume URL</label><input name="resume_url" placeholder="Link to your resume"></div>';
      html += '<div class="form-group"><label>Portfolio URL</label><input name="portfolio_url" placeholder="Link to portfolio (optional)"></div>';
      html += '<div class="form-group"><label>Cover Letter *</label><textarea name="cover_letter" rows="6" required placeholder="Why are you interested in this internship? What skills and experience do you bring?"></textarea></div>';
      html += '<button class="btn" type="submit">Submit Application</button>';
      html += ` <a href="/school/internships" class="btn btn-outline">Cancel</a></form>`;
    }
    renderPage(req, res, html, `Apply - ${post.title}`);
  }));

  app.post('/school/internships/apply/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const { cover_letter, resume_url, portfolio_url } = req.body;
    if (!cover_letter || !cover_letter.trim()) {
      req.session.flash = { type: 'error', msg: 'Cover letter is required' };
      return res.redirect(`/school/internships/apply/${req.params.id}`);
    }
    const internship = await pool.query(`SELECT id, max_positions FROM internships WHERE id=$1 AND tenant_id=$2 AND status='open'`, [req.params.id, tid]);
    if (!internship.rows[0]) return res.status(404).send('Internship not found');
    const dup = await pool.query(
      `SELECT id FROM internship_applications WHERE internship_id=$1 AND student_id=$2 AND tenant_id=$3 AND status NOT IN ('rejected','withdrawn')`,
      [req.params.id, req.user.id, tid]
    );
    if (dup.rows[0]) {
      req.session.flash = { type: 'error', msg: 'Already applied' };
      return res.redirect('/school/internships/my-internships');
    }
    await pool.query(
      `INSERT INTO internship_applications (tenant_id, internship_id, student_id, cover_letter, resume_url, portfolio_url, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')`,
      [tid, req.params.id, req.user.id, cover_letter.trim(), resume_url || null, portfolio_url || null]
    );
    await pool.query(`UPDATE internships SET current_applicants = current_applicants + 1, updated_at = NOW() WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
    audit(req, 'internship_application_submitted', { internship_id: req.params.id });
    req.session.flash = { type: 'success', msg: 'Application submitted successfully!' };
    res.redirect('/school/internships/my-internships');
  }));

  // ============================================================
  // 6. MY INTERNSHIPS — Student view of own applications
  // ============================================================
  app.get('/school/internships/my-internships', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const r = await pool.query(
      `SELECT ia.*, i.title AS internship_title, i.duration_weeks, i.stipend, i.start_date, i.end_date,
        ic.name AS company_name, ic.logo_url,
        (SELECT COALESCE(SUM(hours_worked),0)::numeric FROM internship_timesheets WHERE application_id=ia.id) AS total_hours
       FROM internship_applications ia
       JOIN internships i ON i.id=ia.internship_id
       JOIN internship_companies ic ON ic.id=i.company_id
       WHERE ia.student_id=$1 AND ia.tenant_id=$2 ORDER BY ia.applied_at DESC`, [req.user.id, tid]);

    let html = SKIP + BREAD + ' &rsaquo; My Internships</div>';
    html += '<h2>My Internship Applications</h2>';

    // Browse available internships
    const available = await pool.query(
      `SELECT i.*, ic.name AS company_name FROM internships i JOIN internship_companies ic ON ic.id=i.company_id
       WHERE i.tenant_id=$1 AND i.status='open' ORDER BY i.created_at DESC LIMIT 10`, [tid]);
    if (available.rows.length > 0) {
      html += '<div class="card"><h3 style="margin-top:0">Available Internships</h3><div class="grid">';
      for (const av of available.rows) {
        html += `<div class="card" style="border:1px solid #e5e7eb"><strong>${esc(av.title)}</strong><br>`;
        html += `<span class="text-muted">${esc(av.company_name)} · ${av.duration_weeks}w · ${av.stipend > 0 ? '$'+av.stipend : 'Unpaid'}</span><br>`;
        html += `<a href="/school/internships/apply/${av.id}" class="btn btn-sm" style="margin-top:8px">Apply</a></div>`;
      }
      html += '</div></div>';
    }

    if (r.rows.length === 0) {
      html += '<div class="card"><p class="text-muted">You have not applied to any internships yet.</p></div>';
    } else {
      for (const a of r.rows) {
        html += '<div class="card">';
        html += `<div class="flex"><strong>${esc(a.internship_title)}</strong>${statusBadge(a.status)}</div>`;
        html += `<p class="text-muted">${esc(a.company_name)} · Applied: ${a.applied_at ? new Date(a.applied_at).toLocaleDateString() : '—'}</p>`;
        if (['accepted','in_progress','completed'].includes(a.status)) {
          const totalH = parseNum(a.total_hours);
          const maxH = (a.duration_weeks || 12) * 40;
          const pct = maxH > 0 ? Math.min(100, (totalH / maxH) * 100) : 0;
          html += `<div class="mt-2"><span class="text-sm">Hours: ${totalH}/${maxH}</span>`;
          html += `<progress value="${pct}" max="100"></progress> ${Math.round(pct)}%</div>`;
        }
        html += `<a href="/school/internships/applications/${a.id}" class="btn btn-sm btn-outline" style="margin-top:8px">View Details</a>`;
        html += '</div>';
      }
    }
    renderPage(req, res, html, 'My Internships');
  }));

  // ============================================================
  // 7. TIMESHEETS — Submit and manage
  // ============================================================
  app.get('/school/internships/timesheets', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    let where = ['it.tenant_id = $1'], params = [tid], pi = 2;
    if (req.query.application_id) { where.push(`it.application_id = $${pi}`); params.push(req.query.application_id); pi++; }
    const r = await pool.query(
      `SELECT it.*, ia.status AS app_status,
        s.first_name, s.last_name,
        i.title AS internship_title, ic.name AS company_name
       FROM internship_timesheets it
       JOIN internship_applications ia ON ia.id=it.application_id
       JOIN internships i ON i.id=ia.internship_id
       JOIN internship_companies ic ON ic.id=i.company_id
       LEFT JOIN students s ON s.id=ia.student_id
       WHERE ${where.join(' AND ')} ORDER BY it.week_number, it.created_at DESC`, params);

    let html = SKIP + BREAD + ' &rsaquo; Timesheets</div>';
    html += '<h2>Internship Timesheets</h2>';

    if (req.query.application_id) {
      html += `<form method="post" action="/school/internships/timesheets" class="card">`;
      html += `<input type="hidden" name="application_id" value="${esc(req.query.application_id)}">`;
      html += '<div class="grid">';
      html += '<div class="form-group"><label>Week Number *</label><input name="week_number" type="number" min="1" required></div>';
      html += '<div class="form-group"><label>Hours Worked *</label><input name="hours_worked" type="number" min="0" max="80" step="0.5" required></div>';
      html += '</div>';
      html += '<div class="form-group"><label>Tasks Completed</label><textarea name="tasks_completed" rows="3"></textarea></div>';
      html += '<button class="btn" type="submit">Submit Timesheet</button></form>';
    }

    if (r.rows.length === 0) {
      html += '<div class="card"><p class="text-muted">No timesheets found.</p></div>';
    } else {
      html += '<table><thead><tr><th>Student</th><th>Position</th><th>Company</th><th>Week</th><th>Hours</th><th>Tasks</th><th>Sign-off</th><th>Actions</th></tr></thead><tbody>';
      for (const t of r.rows) {
        html += `<tr><td>${esc(t.first_name||'')} ${esc(t.last_name||'')}</td>`;
        html += `<td>${esc(t.internship_title)}</td><td>${esc(t.company_name)}</td>`;
        html += `<td>Week ${t.week_number}</td><td>${t.hours_worked}h</td>`;
        html += `<td>${esc(t.tasks_completed||'—')}</td>`;
        html += `<td>${t.supervisor_signoff ? '✅' : '<a href="/school/internships/timesheets/'+t.id+'/signoff" class="btn btn-sm btn-outline">Sign Off</a>'}</td>`;
        html += `<td><form method="post" action="/school/internships/timesheets/${t.id}/delete" style="display:inline" onsubmit="return confirm('Delete?')"><button class="btn btn-sm btn-danger" type="submit">Del</button></form></td></tr>`;
      }
      html += '</tbody></table>';
    }
    renderPage(req, res, html, 'Timesheets');
  }));

  app.post('/school/internships/timesheets', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const { application_id, week_number, hours_worked, tasks_completed } = req.body;
    if (!application_id || !week_number || !hours_worked) {
      req.session.flash = { type: 'error', msg: 'Application ID, week number, and hours are required' };
      return res.redirect('/school/internships/timesheets' + (application_id ? '?application_id=' + application_id : ''));
    }
    const dup = await pool.query(`SELECT id FROM internship_timesheets WHERE application_id=$1 AND week_number=$2 AND tenant_id=$3`, [application_id, week_number, tid]);
    if (dup.rows[0]) {
      req.session.flash = { type: 'error', msg: 'Timesheet already exists for this week' };
      return res.redirect('/school/internships/timesheets?application_id=' + application_id);
    }
    await pool.query(
      `INSERT INTO internship_timesheets (tenant_id, application_id, week_number, hours_worked, tasks_completed)
       VALUES ($1, $2, $3, $4, $5)`,
      [tid, application_id, parseInt(week_number), parseNum(hours_worked), tasks_completed || null]
    );
    audit(req, 'internship_timesheet_submitted', { application_id, week: week_number });
    req.session.flash = { type: 'success', msg: 'Timesheet submitted' };
    res.redirect('/school/internships/timesheets?application_id=' + application_id);
  }));

  app.get('/school/internships/timesheets/:id/signoff', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const ts = await pool.query(`SELECT * FROM internship_timesheets WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
    if (!ts.rows[0]) return res.status(404).send('Timesheet not found');
    let html = SKIP + BREAD + ' &rsaquo; Timesheets &rsaquo; Sign Off</div>';
    html += '<h2>Supervisor Sign-Off: Week ' + ts.rows[0].week_number + '</h2>';
    html += `<div class="card"><p><strong>Hours:</strong> ${ts.rows[0].hours_worked}h</p>`;
    html += `<p><strong>Tasks:</strong> ${esc(ts.rows[0].tasks_completed||'—')}</p></div>`;
    html += `<form method="post" action="/school/internships/timesheets/${ts.rows[0].id}/signoff" class="card">`;
    html += '<div class="form-group"><label>Supervisor Notes</label><textarea name="supervisor_notes" rows="3"></textarea></div>';
    html += '<div class="form-group"><label><input type="checkbox" name="approved" value="true" required> I confirm these hours are accurate</label></div>';
    html += '<button class="btn" type="submit">Confirm Sign-Off</button></form>';
    renderPage(req, res, html, 'Timesheet Sign-Off');
  }));

  app.post('/school/internships/timesheets/:id/signoff', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const { supervisor_notes } = req.body;
    await pool.query(
      `UPDATE internship_timesheets SET supervisor_signoff=true, supervisor_notes=$1, approved_at=NOW() WHERE id=$2 AND tenant_id=$3`,
      [supervisor_notes || null, req.params.id, tid]
    );
    audit(req, 'internship_timesheet_signed', { timesheet_id: req.params.id });
    req.session.flash = { type: 'success', msg: 'Timesheet signed off' };
    res.redirect('/school/internships/timesheets');
  }));

  app.post('/school/internships/timesheets/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const r = await pool.query(`DELETE FROM internship_timesheets WHERE id=$1 AND tenant_id=$2 RETURNING id, application_id`, [req.params.id, tid]);
    if (!r.rows[0]) return res.status(404).send('Timesheet not found');
    audit(req, 'internship_timesheet_deleted', { timesheet_id: req.params.id });
    req.session.flash = { type: 'success', msg: 'Timesheet deleted' };
    res.redirect('/school/internships/timesheets');
  }));

  // ============================================================
  // 8. EVALUATIONS — Supervisor and student evaluations
  // ============================================================
  app.get('/school/internships/evaluations', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const r = await pool.query(
      `SELECT ie.*, ia.status AS app_status,
        s.first_name, s.last_name, i.title AS internship_title, ic.name AS company_name
       FROM internship_evaluations ie
       JOIN internship_applications ia ON ia.id=ie.application_id
       JOIN internships i ON i.id=ia.internship_id
       JOIN internship_companies ic ON ic.id=i.company_id
       LEFT JOIN students s ON s.id=ia.student_id
       WHERE ie.tenant_id=$1 ORDER BY ie.created_at DESC`, [tid]);

    let html = SKIP + BREAD + ' &rsaquo; Evaluations</div>';
    html += '<h2>Internship Evaluations</h2>';

    if (req.query.application_id) {
      html += '<div class="card"><h3>New Evaluation</h3>';
      html += `<form method="post" action="/school/internships/evaluations" class="card" style="border:none;padding:0">`;
      html += `<input type="hidden" name="application_id" value="${esc(req.query.application_id)}">`;
      html += '<div class="grid">';
      html += '<div class="form-group"><label>Evaluator Type</label><select name="evaluator_type"><option value="supervisor">Supervisor</option><option value="peer">Peer</option><option value="self">Self</option><option value="school">School Coordinator</option></select></div>';
      html += '<div class="form-group"><label>Evaluator ID</label><input name="evaluator_id" type="number" value="' + (req.user.id || '') + '"></div>';
      html += '</div>';
      html += '<div class="grid">';
      html += '<div class="form-group"><label>Rating (1-5) *</label><input name="rating" type="number" min="1" max="5" step="0.1" required></div>';
      html += '<div class="form-group"><label>Overall Grade</label><select name="overall_grade"><option value="">—</option><option>A+</option><option>A</option><option>B+</option><option>B</option><option>C</option><option>D</option><option>F</option></select></div>';
      html += '</div>';
      html += '<p style="font-weight:600;margin:12px 0 8px">Competency Scores (1-5):</p>';
      html += '<div class="grid">';
      html += '<div class="form-group"><label>Punctuality</label><input name="punctuality" type="number" min="1" max="5" value="3"></div>';
      html += '<div class="form-group"><label>Teamwork</label><input name="teamwork" type="number" min="1" max="5" value="3"></div>';
      html += '<div class="form-group"><label>Communication</label><input name="communication" type="number" min="1" max="5" value="3"></div>';
      html += '</div><div class="grid">';
      html += '<div class="form-group"><label>Technical Skills</label><input name="technical_skills" type="number" min="1" max="5" value="3"></div>';
      html += '<div class="form-group"><label>Problem Solving</label><input name="problem_solving" type="number" min="1" max="5" value="3"></div>';
      html += '<div class="form-group"><label>Initiative</label><input name="initiative" type="number" min="1" max="5" value="3"></div>';
      html += '</div>';
      html += '<div class="form-group"><label>Skills Acquired (comma separated)</label><input name="skills_acquired" placeholder="e.g. Project Management, Data Analysis, Team Leadership"></div>';
      html += '<div class="form-group"><label>Comments</label><textarea name="comments" rows="3"></textarea></div>';
      html += '<div class="form-group"><label>Strengths</label><textarea name="strengths" rows="2"></textarea></div>';
      html += '<div class="form-group"><label>Areas for Improvement</label><textarea name="improvements" rows="2"></textarea></div>';
      html += '<div class="form-group"><label><input type="checkbox" name="would_recommend" value="true"> Would Recommend for Future Positions</label></div>';
      html += '<button class="btn" type="submit">Submit Evaluation</button></form></div>';
    }

    if (r.rows.length === 0) {
      html += '<div class="card"><p class="text-muted">No evaluations yet.</p></div>';
    } else {
      html += '<table><thead><tr><th>Student</th><th>Position</th><th>Company</th><th>Rating</th><th>Grade</th><th>Type</th><th>Recommend</th></tr></thead><tbody>';
      for (const e of r.rows) {
        html += `<tr><td>${esc(e.first_name||'')} ${esc(e.last_name||'')}</td>`;
        html += `<td>${esc(e.internship_title)}</td><td>${esc(e.company_name)}</td>`;
        html += `<td>${e.rating}/5</td><td>${esc(e.overall_grade||'—')}</td><td>${esc(e.evaluator_type)}</td>`;
        html += `<td>${e.would_recommend?'✅ Yes':'❌ No'}</td></tr>`;
      }
      html += '</tbody></table>';
    }
    renderPage(req, res, html, 'Evaluations');
  }));

  app.post('/school/internships/evaluations', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const { application_id, evaluator_id, evaluator_type, rating, overall_grade, punctuality, teamwork, communication,
      technical_skills, problem_solving, initiative, skills_acquired, comments, strengths, improvements, would_recommend } = req.body;
    if (!application_id || !rating) {
      req.session.flash = { type: 'error', msg: 'Application ID and rating required' };
      return res.redirect('/school/internships/evaluations');
    }
    const skills = (skills_acquired || '').split(',').map(s => s.trim()).filter(Boolean);
    await pool.query(
      `INSERT INTO internship_evaluations (tenant_id, application_id, evaluator_id, evaluator_type, rating, overall_grade,
        punctuality, teamwork, communication, technical_skills, problem_solving, initiative,
        skills_acquired, comments, strengths, improvements, would_recommend)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [tid, application_id, evaluator_id || req.user.id, evaluator_type || 'supervisor', parseNum(rating),
       overall_grade || null, parseInt(punctuality)||3, parseInt(teamwork)||3, parseInt(communication)||3,
       parseInt(technical_skills)||3, parseInt(problem_solving)||3, parseInt(initiative)||3,
       JSON.stringify(skills), comments || null, strengths || null, improvements || null, would_recommend === 'true']
    );
    audit(req, 'internship_evaluation_submitted', { application_id, rating });
    req.session.flash = { type: 'success', msg: 'Evaluation submitted' };
    res.redirect('/school/internships/evaluations');
  }));

  // ============================================================
  // 9. PROGRESS REPORTS
  // ============================================================
  app.get('/school/internships/reports', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const r = await pool.query(
      `SELECT pr.*, s.first_name, s.last_name, i.title AS internship_title, ic.name AS company_name
       FROM internship_progress_reports pr
       JOIN internship_applications ia ON ia.id=pr.application_id
       JOIN internships i ON i.id=ia.internship_id
       JOIN internship_companies ic ON ic.id=i.company_id
       LEFT JOIN students s ON s.id=ia.student_id
       WHERE pr.tenant_id=$1 ORDER BY pr.created_at DESC`, [tid]);

    let html = SKIP + BREAD + ' &rsaquo; Progress Reports</div>';
    html += '<h2>Internship Progress Reports</h2>';

    if (r.rows.length === 0) {
      html += '<div class="card"><p class="text-muted">No progress reports yet.</p></div>';
    } else {
      html += '<table><thead><tr><th>Student</th><th>Position</th><th>Company</th><th>Type</th><th>Week</th><th>Status</th><th>Submitted</th></tr></thead><tbody>';
      for (const pr of r.rows) {
        html += `<tr><td>${esc(pr.first_name||'')} ${esc(pr.last_name||'')}</td>`;
        html += `<td>${esc(pr.internship_title)}</td><td>${esc(pr.company_name)}</td>`;
        html += `<td>${esc(pr.report_type)}</td><td>${pr.week_number}</td>`;
        html += `<td>${statusBadge(pr.status)}</td>`;
        html += `<td>${pr.submitted_at ? new Date(pr.submitted_at).toLocaleDateString() : '—'}</td></tr>`;
      }
      html += '</tbody></table>';
    }

    // Submit new report form
    html += '<div class="card" style="margin-top:16px"><h3>Submit Progress Report</h3>';
    html += '<form method="post" action="/school/internships/reports">';
    html += '<div class="grid">';
    html += '<div class="form-group"><label>Application ID *</label><input name="application_id" type="number" required></div>';
    html += '<div class="form-group"><label>Report Type</label><select name="report_type"><option value="weekly">Weekly</option><option value="biweekly">Bi-Weekly</option><option value="monthly">Monthly</option><option value="final">Final</option></select></div>';
    html += '<div class="form-group"><label>Week Number</label><input name="week_number" type="number" min="0"></div>';
    html += '</div>';
    html += '<div class="form-group"><label>Content *</label><textarea name="content" rows="4" required></textarea></div>';
    html += '<div class="form-group"><label>Highlights</label><textarea name="highlights" rows="2"></textarea></div>';
    html += '<div class="form-group"><label>Challenges</label><textarea name="challenges" rows="2"></textarea></div>';
    html += '<div class="form-group"><label>Goals for Next Period</label><textarea name="goals_next_period" rows="2"></textarea></div>';
    html += '<button class="btn" type="submit">Submit Report</button></form></div>';

    renderPage(req, res, html, 'Progress Reports');
  }));

  app.post('/school/internships/reports', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const { application_id, report_type, week_number, content, highlights, challenges, goals_next_period } = req.body;
    if (!application_id || !content) {
      req.session.flash = { type: 'error', msg: 'Application ID and content required' };
      return res.redirect('/school/internships/reports');
    }
    await pool.query(
      `INSERT INTO internship_progress_reports (tenant_id, application_id, report_type, week_number, content, highlights, challenges, goals_next_period, status, submitted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'submitted',NOW())`,
      [tid, application_id, report_type || 'weekly', parseInt(week_number) || 0, content, highlights || null, challenges || null, goals_next_period || null]
    );
    audit(req, 'internship_progress_report', { application_id });
    req.session.flash = { type: 'success', msg: 'Progress report submitted' };
    res.redirect('/school/internships/reports');
  }));

  // ============================================================
  // 10. CERTIFICATES — Generate on completion
  // ============================================================
  app.get('/school/internships/certificates', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const r = await pool.query(
      `SELECT c.*, s.first_name, s.last_name, s.admission_number, i.title AS internship_title, ic.name AS company_name
       FROM internship_certificates c
       JOIN internship_applications ia ON ia.id=c.application_id
       JOIN internships i ON i.id=ia.internship_id
       JOIN internship_companies ic ON ic.id=i.company_id
       LEFT JOIN students s ON s.id=c.student_id
       WHERE c.tenant_id=$1 ORDER BY c.issued_at DESC`, [tid]);

    let html = SKIP + BREAD + ' &rsaquo; Certificates</div>';
    html += '<h2>Internship Completion Certificates</h2>';

    if (r.rows.length === 0) {
      html += '<div class="card"><p class="text-muted">No certificates issued yet.</p></div>';
    } else {
      html += '<table><thead><tr><th>Student</th><th>Position</th><th>Company</th><th>Certificate #</th><th>Grade</th><th>Hours</th><th>Issued</th></tr></thead><tbody>';
      for (const c of r.rows) {
        html += `<tr><td>${esc(c.first_name||'')} ${esc(c.last_name||'')}</td>`;
        html += `<td>${esc(c.internship_title)}</td><td>${esc(c.company_name)}</td>`;
        html += `<td><code>${esc(c.certificate_number||'—')}</code></td>`;
        html += `<td>${esc(c.grade||'—')}</td><td>${c.hours_completed}h</td>`;
        html += `<td>${c.issued_at ? new Date(c.issued_at).toLocaleDateString() : ''}</td></tr>`;
      }
      html += '</tbody></table>';
    }
    renderPage(req, res, html, 'Certificates');
  }));

  app.get('/school/internships/certificates/generate', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    if (!req.query.application_id) return res.redirect('/school/internships/certificates');
    const a = await pool.query(
      `SELECT ia.*, s.first_name, s.last_name, s.admission_number, i.title AS internship_title,
        ic.name AS company_name, (SELECT COALESCE(SUM(hours_worked),0)::numeric FROM internship_timesheets WHERE application_id=ia.id) AS total_hours
       FROM internship_applications ia
       JOIN internships i ON i.id=ia.internship_id
       JOIN internship_companies ic ON ic.id=i.company_id
       LEFT JOIN students s ON s.id=ia.student_id
       WHERE ia.id=$1 AND ia.tenant_id=$2`, [req.query.application_id, tid]);
    if (!a.rows[0]) return res.status(404).send('Application not found');
    const app = a.rows[0];
    const existingCert = await pool.query(`SELECT id FROM internship_certificates WHERE application_id=$1 AND tenant_id=$2`, [app.id, tid]);

    let html = SKIP + BREAD + ' &rsaquo; Certificates &rsaquo; Generate</div>';
    html += '<h2>Generate Completion Certificate</h2>';
    html += `<div class="card"><p><strong>Student:</strong> ${esc(app.first_name||'')} ${esc(app.last_name||'')}</p>`;
    html += `<p><strong>Position:</strong> ${esc(app.internship_title)}</p>`;
    html += `<p><strong>Company:</strong> ${esc(app.company_name)}</p>`;
    html += `<p><strong>Total Hours:</strong> ${parseNum(app.total_hours)}</p></div>`;

    if (existingCert.rows[0]) {
      html += '<div class="alert alert-info">Certificate already generated for this application.</div>';
    } else {
      html += `<form method="post" action="/school/internships/certificates/generate" class="card">`;
      html += `<input type="hidden" name="application_id" value="${app.id}">`;
      html += '<div class="form-group"><label>Certificate Title</label><input name="title" value="Internship Completion Certificate"></div>';
      html += '<div class="form-group"><label>Description</label><textarea name="description" rows="2">Successfully completed the internship program demonstrating professional competency and dedication.</textarea></div>';
      html += '<div class="grid">';
      html += `<div class="form-group"><label>Grade</label><select name="grade"><option value="">—</option><option>A+</option><option>A</option><option>B+</option><option>B</option><option>C</option></select></div>`;
      html += `<div class="form-group"><label>Hours Completed</label><input name="hours_completed" type="number" value="${parseNum(app.total_hours)}"></div>`;
      html += '</div>';
      html += `<div class="form-group"><label>Company Signatory</label><input name="company_signature" value="${esc(app.supervisor_name||'')}"></div>`;
      html += '<div class="form-group"><label>School Signatory</label><input name="school_signature"></div>';
      html += '<button class="btn" type="submit">Generate Certificate</button></form>';
    }
    renderPage(req, res, html, 'Generate Certificate');
  }));

  app.post('/school/internships/certificates/generate', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const { application_id, title, description, grade, hours_completed, company_signature, school_signature } = req.body;
    if (!application_id) {
      req.session.flash = { type: 'error', msg: 'Application ID required' };
      return res.redirect('/school/internships/certificates');
    }
    const app = await pool.query(
      `SELECT ia.*, s.id AS student_id, ic.name AS company_name
       FROM internship_applications ia
       JOIN internships i ON i.id=ia.internship_id
       JOIN internship_companies ic ON ic.id=i.company_id
       LEFT JOIN students s ON s.id=ia.student_id
       WHERE ia.id=$1 AND ia.tenant_id=$2`, [application_id, tid]);
    if (!app.rows[0]) return res.status(404).send('Application not found');

    // Gather skills from evaluations
    const evals = await pool.query(`SELECT skills_acquired FROM internship_evaluations WHERE application_id=$1 AND tenant_id=$2`, [application_id, tid]);
    const allSkills = new Set();
    for (const e of evals.rows) { for (const sk of (parseJson(e.skills_acquired, []) || [])) allSkills.add(sk); }

    const certNum = 'INT-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
    await pool.query(
      `INSERT INTO internship_certificates (tenant_id, application_id, student_id, certificate_number, title, description,
        skills_list, grade, hours_completed, company_name, company_signature, school_signature)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [tid, application_id, app.rows[0].student_id, certNum, title || 'Internship Completion Certificate',
       description || null, JSON.stringify([...allSkills]), grade || null, parseInt(hours_completed) || 0,
       app.rows[0].company_name, company_signature || null, school_signature || null]
    );
    await pool.query(`UPDATE internship_applications SET certificate_id=(SELECT id FROM internship_certificates WHERE certificate_number=$1), status='completed', completed_at=NOW(), updated_at=NOW() WHERE id=$2 AND tenant_id=$3`, [certNum, application_id, tid]);
    audit(req, 'internship_certificate_generated', { application_id, certificate_number: certNum });
    req.session.flash = { type: 'success', msg: 'Certificate generated: ' + certNum };
    res.redirect('/school/internships/certificates');
  }));

  // ============================================================
  // 11. INTERVIEWS — Scheduling and management
  // ============================================================
  app.get('/school/internships/interviews', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const r = await pool.query(
      `SELECT iv.*, s.first_name, s.last_name, i.title AS internship_title, ic.name AS company_name
       FROM internship_interviews iv
       JOIN internship_applications ia ON ia.id=iv.application_id
       JOIN internships i ON i.id=ia.internship_id
       JOIN internship_companies ic ON ic.id=i.company_id
       LEFT JOIN students s ON s.id=ia.student_id
       WHERE iv.tenant_id=$1 ORDER BY iv.scheduled_at DESC NULLS LAST`, [tid]);

    let html = SKIP + BREAD + ' &rsaquo; Interviews</div>';
    html += '<h2>Interview Schedule</h2>';

    // Schedule new interview form
    html += '<div class="card"><h3>Schedule Interview</h3>';
    html += '<form method="post" action="/school/internships/interviews">';
    html += '<div class="grid">';
    html += '<div class="form-group"><label>Application ID *</label><input name="application_id" type="number" required></div>';
    html += '<div class="form-group"><label>Scheduled Date/Time *</label><input name="scheduled_at" type="datetime-local" required></div>';
    html += '<div class="form-group"><label>Duration (minutes)</label><input name="duration_minutes" type="number" value="30" min="15"></div>';
    html += '</div><div class="grid">';
    html += '<div class="form-group"><label>Location</label><input name="location"></div>';
    html += '<div class="form-group"><label>Meeting Link</label><input name="meeting_link" placeholder="Zoom/Teams link"></div>';
    html += '</div>';
    html += '<div class="form-group"><label>Notes</label><textarea name="notes" rows="2"></textarea></div>';
    html += '<button class="btn" type="submit">Schedule Interview</button></form></div>';

    if (r.rows.length === 0) {
      html += '<div class="card"><p class="text-muted">No interviews scheduled.</p></div>';
    } else {
      html += '<table><thead><tr><th>Student</th><th>Position</th><th>Company</th><th>Date/Time</th><th>Duration</th><th>Location</th><th>Status</th><th>Outcome</th></tr></thead><tbody>';
      for (const iv of r.rows) {
        html += `<tr><td>${esc(iv.first_name||'')} ${esc(iv.last_name||'')}</td>`;
        html += `<td>${esc(iv.internship_title)}</td><td>${esc(iv.company_name)}</td>`;
        html += `<td>${iv.scheduled_at ? new Date(iv.scheduled_at).toLocaleString() : '—'}</td>`;
        html += `<td>${iv.duration_minutes} min</td><td>${esc(iv.location||iv.meeting_link||'—')}</td>`;
        html += `<td>${statusBadge(iv.status)}</td><td>${esc(iv.outcome||'—')}</td></tr>`;
      }
      html += '</tbody></table>';
    }
    renderPage(req, res, html, 'Interviews');
  }));

  app.post('/school/internships/interviews', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const { application_id, scheduled_at, duration_minutes, location, meeting_link, notes } = req.body;
    if (!application_id || !scheduled_at) {
      req.session.flash = { type: 'error', msg: 'Application ID and scheduled date/time required' };
      return res.redirect('/school/internships/interviews');
    }
    await pool.query(
      `INSERT INTO internship_interviews (tenant_id, application_id, interviewer_id, scheduled_at, duration_minutes, location, meeting_link, notes, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'scheduled')`,
      [tid, application_id, req.user.id, scheduled_at, parseInt(duration_minutes)||30, location||null, meeting_link||null, notes||null]
    );
    await pool.query(`UPDATE internship_applications SET status='interview', interview_date=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3`, [scheduled_at, application_id, tid]);
    // Send email notification
    try {
      const appInfo = await pool.query(
        `SELECT s.first_name, s.last_name, s.email, i.title, ic.name AS company_name
         FROM internship_applications ia
         JOIN students s ON s.id=ia.student_id
         JOIN internships i ON i.id=ia.internship_id
         JOIN internship_companies ic ON ic.id=i.company_id
         WHERE ia.id=$1 AND ia.tenant_id=$2`, [application_id, tid]);
      if (appInfo.rows[0] && appInfo.rows[0].email) {
        queueEmail(appInfo.rows[0].email, 'Interview Scheduled - ' + appInfo.rows[0].title,
          `Dear ${appInfo.rows[0].first_name},\n\nYour interview for "${appInfo.rows[0].title}" at ${appInfo.rows[0].company_name} has been scheduled for ${new Date(scheduled_at).toLocaleString()}.\n\n${location ? 'Location: ' + location + '\n' : ''}${meeting_link ? 'Meeting Link: ' + meeting_link + '\n' : ''}\nGood luck!`);
      }
    } catch(e) { /* best-effort email */ }

    audit(req, 'internship_interview_scheduled', { application_id });
    req.session.flash = { type: 'success', msg: 'Interview scheduled' };
    res.redirect('/school/internships/interviews');
  }));

  // ============================================================
  // 12. DOCUMENTS — Document management
  // ============================================================
  app.get('/school/internships/documents', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const r = await pool.query(
      `SELECT d.*, s.first_name, s.last_name, i.title AS internship_title, ic.name AS company_name
       FROM internship_documents d
       JOIN internship_applications ia ON ia.id=d.application_id
       JOIN internships i ON i.id=ia.internship_id
       JOIN internship_companies ic ON ic.id=i.company_id
       LEFT JOIN students s ON s.id=ia.student_id
       WHERE d.tenant_id=$1 ORDER BY d.created_at DESC`, [tid]);

    let html = SKIP + BREAD + ' &rsaquo; Documents</div>';
    html += '<h2>Internship Documents</h2>';

    html += '<div class="card"><h3>Upload Document</h3>';
    html += '<form method="post" action="/school/internships/documents" enctype="multipart/form-data">';
    html += '<div class="grid">';
    html += '<div class="form-group"><label>Application ID *</label><input name="application_id" type="number" required></div>';
    html += '<div class="form-group"><label>Document Type *</label><select name="document_type" required>';
    for (const dt of ['resume','cover_letter','transcript','recommendation_letter','contract','moa','timesheet_template','evaluation_form','completion_report','other']) {
      html += `<option value="${dt}">${dt.replace(/_/g,' ')}</option>`;
    }
    html += '</select></div>';
    html += '</div>';
    html += '<div class="form-group"><label>File URL</label><input name="file_url" placeholder="Link to document"></div>';
    html += '<div class="form-group"><label>Description</label><textarea name="description" rows="2"></textarea></div>';
    html += '<button class="btn" type="submit">Upload Document</button></form></div>';

    if (r.rows.length === 0) {
      html += '<div class="card"><p class="text-muted">No documents uploaded.</p></div>';
    } else {
      html += '<table><thead><tr><th>Student</th><th>Position</th><th>Type</th><th>File</th><th>Verified</th><th>Uploaded</th></tr></thead><tbody>';
      for (const d of r.rows) {
        html += `<tr><td>${esc(d.first_name||'')} ${esc(d.last_name||'')}</td>`;
        html += `<td>${esc(d.internship_title)}</td><td>${statusBadge(d.document_type)}</td>`;
        html += `<td>${d.file_url ? '<a href="'+esc(d.file_url)+'" target="_blank">'+esc(d.file_name||d.file_url)+'</a>' : esc(d.file_name||'—')}</td>`;
        html += `<td>${d.is_verified ? '✅' : '<a href="/school/internships/documents/'+d.id+'/verify" class="btn btn-sm btn-outline">Verify</a>'}</td>`;
        html += `<td>${d.created_at ? new Date(d.created_at).toLocaleDateString() : ''}</td></tr>`;
      }
      html += '</tbody></table>';
    }
    renderPage(req, res, html, 'Documents');
  }));

  app.post('/school/internships/documents', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const { application_id, document_type, file_url, file_name, description } = req.body;
    if (!application_id || !document_type) {
      req.session.flash = { type: 'error', msg: 'Application ID and document type required' };
      return res.redirect('/school/internships/documents');
    }
    await pool.query(
      `INSERT INTO internship_documents (tenant_id, application_id, document_type, file_name, file_url, uploaded_by, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [tid, application_id, document_type, file_name || null, file_url || null, req.user.id, description || null]
    );
    audit(req, 'internship_document_uploaded', { application_id, document_type });
    req.session.flash = { type: 'success', msg: 'Document uploaded' };
    res.redirect('/school/internships/documents');
  }));

  app.get('/school/internships/documents/:id/verify', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    await pool.query(`UPDATE internship_documents SET is_verified=true WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
    audit(req, 'internship_document_verified', { document_id: req.params.id });
    req.session.flash = { type: 'success', msg: 'Document verified' };
    res.redirect('/school/internships/documents');
  }));

  // ============================================================
  // 13. ANALYTICS DASHBOARD
  // ============================================================
  app.get('/school/internships/analytics', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;

    const [totalCompanies, totalPostings, totalApps, completed] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS n FROM internship_companies WHERE tenant_id=$1 AND is_active=true`, [tid]),
      pool.query(`SELECT COUNT(*)::int AS n FROM internships WHERE tenant_id=$1`, [tid]),
      pool.query(`SELECT COUNT(*)::int AS n FROM internship_applications WHERE tenant_id=$1`, [tid]),
      pool.query(`SELECT COUNT(*)::int AS n FROM internship_applications WHERE tenant_id=$1 AND status='completed'`, [tid]),
    ]);

    const [statusBreakdown, industryBreakdown, avgRating, avgCompletionHours] = await Promise.all([
      pool.query(`SELECT status, COUNT(*)::int AS n FROM internship_applications WHERE tenant_id=$1 GROUP BY status ORDER BY n DESC`, [tid]),
      pool.query(`SELECT ic.industry, COUNT(*)::int AS n FROM internships i JOIN internship_companies ic ON ic.id=i.company_id WHERE i.tenant_id=$1 GROUP BY ic.industry ORDER BY n DESC LIMIT 10`, [tid]),
      pool.query(`SELECT COALESCE(AVG(rating),0)::numeric(3,2) AS r FROM internship_evaluations WHERE tenant_id=$1`, [tid]),
      pool.query(`SELECT AVG(th)::numeric(10,1) AS avg_h FROM (SELECT SUM(it.hours_worked)::int AS th FROM internship_timesheets it JOIN internship_applications ia ON ia.id=it.application_id WHERE ia.tenant_id=$1 AND ia.status='completed' GROUP BY it.application_id) sub`, [tid]),
    ]);

    const [topCompanies, monthlyApps, stipendStats] = await Promise.all([
      pool.query(`SELECT ic.name, COUNT(ia.id)::int AS placements, AVG(ie.rating)::numeric(3,2) AS avg_rating
        FROM internship_companies ic
        LEFT JOIN internships i ON i.company_id=ic.id AND i.tenant_id=$1
        LEFT JOIN internship_applications ia ON ia.internship_id=i.id AND ia.status='completed' AND ia.tenant_id=$1
        LEFT JOIN internship_evaluations ie ON ie.application_id=ia.id AND ie.tenant_id=$1
        WHERE ic.tenant_id=$1 GROUP BY ic.name HAVING COUNT(ia.id) > 0 ORDER BY placements DESC LIMIT 10`, [tid]),
      pool.query(`SELECT TO_CHAR(applied_at, 'YYYY-MM') AS month, COUNT(*)::int AS n
        FROM internship_applications WHERE tenant_id=$1 AND applied_at > NOW() - INTERVAL '12 months'
        GROUP BY TO_CHAR(applied_at, 'YYYY-MM') ORDER BY month DESC LIMIT 12`, [tid]),
      pool.query(`SELECT COALESCE(AVG(stipend),0)::numeric(10,2) AS avg, COALESCE(MAX(stipend),0)::numeric(10,2) AS max_stipend,
        COALESCE(MIN(stipend),0)::numeric(10,2) AS min_stipend FROM internships WHERE tenant_id=$1 AND stipend > 0`, [tid]),
    ]);

    const [skillsDemand, recommendRate] = await Promise.all([
      pool.query(`SELECT skill, COUNT(*)::int AS freq FROM internships, jsonb_array_elements_text(skills_required) AS skill WHERE tenant_id=$1 GROUP BY skill ORDER BY freq DESC LIMIT 15`, [tid]),
      pool.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE would_recommend=true)::int AS recommended FROM internship_evaluations WHERE tenant_id=$1`, [tid]),
    ]);

    let html = SKIP + BREAD + ' &rsaquo; Analytics</div>';
    html += '<h2>Internship Analytics Dashboard</h2>';

    // KPI Cards
    html += '<div class="grid" style="margin-bottom:20px">';
    html += `<div class="stat-card"><h3>Partner Companies</h3><div class="val">${totalCompanies.rows[0].n}</div></div>`;
    html += `<div class="stat-card" style="background:linear-gradient(135deg,#059669,#10b981)"><h3>Total Postings</h3><div class="val">${totalPostings.rows[0].n}</div></div>`;
    html += `<div class="stat-card" style="background:linear-gradient(135deg,#d97706,#f59e0b)"><h3>Total Applications</h3><div class="val">${totalApps.rows[0].n}</div></div>`;
    html += `<div class="stat-card" style="background:linear-gradient(135deg,#7c3aed,#a78bfa)"><h3>Completed</h3><div class="val">${completed.rows[0].n}</div></div>`;
    html += `<div class="stat-card" style="background:linear-gradient(135deg,#0891b2,#06b6d4)"><h3>Avg Rating</h3><div class="val">${parseNum(avgRating.rows[0].r).toFixed(1)}/5</div></div>`;
    const completionRate = totalApps.rows[0].n > 0 ? Math.round((completed.rows[0].n / totalApps.rows[0].n) * 100) : 0;
    html += `<div class="stat-card" style="background:linear-gradient(135deg,#be185d,#ec4899)"><h3>Completion Rate</h3><div class="val">${completionRate}%</div></div>`;
    html += '</div>';

    // Application Status Breakdown
    html += '<div class="grid"><div class="card"><h3>Application Status Breakdown</h3>';
    for (const s of statusBreakdown.rows) {
      const pct = totalApps.rows[0].n > 0 ? Math.round((s.n / totalApps.rows[0].n) * 100) : 0;
      html += `<div style="margin-bottom:8px"><div class="flex"><span>${esc(s.status)}</span><span class="text-muted">${s.n} (${pct}%)</span></div>`;
      html += `<progress value="${pct}" max="100"></progress></div>`;
    }
    html += '</div>';

    // Industry Breakdown
    html += '<div class="card"><h3>Postings by Industry</h3>';
    for (const ind of industryBreakdown.rows) {
      html += `<div style="margin-bottom:6px"><span>${esc(ind.industry || 'Other')}</span> <strong>${ind.n}</strong></div>`;
    }
    html += '</div></div>';

    // Top Companies
    if (topCompanies.rows.length > 0) {
      html += '<div class="card"><h3>Top Partner Companies</h3>';
      html += '<table><thead><tr><th>Company</th><th>Completed Placements</th><th>Avg Rating</th></tr></thead><tbody>';
      for (const c of topCompanies.rows) {
        html += `<tr><td>${esc(c.name)}</td><td>${c.placements}</td><td>${c.avg_rating || '—'}/5</td></tr>`;
      }
      html += '</tbody></table></div>';
    }

    // Skills in Demand
    if (skillsDemand.rows.length > 0) {
      html += '<div class="card"><h3>Skills in Demand</h3>';
      html += '<div style="display:flex;flex-wrap:wrap;gap:6px">';
      for (const sk of skillsDemand.rows) {
        html += `<span class="badge badge-blue" style="font-size:13px;padding:4px 10px">${esc(sk.skill)} (${sk.freq})</span>`;
      }
      html += '</div></div>';
    }

    // Monthly Application Trends
    if (monthlyApps.rows.length > 0) {
      html += '<div class="card"><h3>Monthly Application Trends</h3>';
      const maxApps = Math.max(...monthlyApps.rows.map(r => r.n), 1);
      html += '<table><thead><tr><th>Month</th><th>Applications</th><th>Trend</th></tr></thead><tbody>';
      for (const m of monthlyApps.rows) {
        const pct = Math.round((m.n / maxApps) * 100);
        html += `<tr><td>${esc(m.month)}</td><td>${m.n}</td><td><progress value="${pct}" max="100" style="width:200px"></progress></td></tr>`;
      }
      html += '</tbody></table></div>';
    }

    // Stipend Stats
    html += '<div class="card"><h3>Stipend Statistics</h3>';
    html += `<div class="grid">`;
    html += `<div class="stat-card" style="background:linear-gradient(135deg,#059669,#10b981)"><h3>Average</h3><div class="val">$${parseNum(stipendStats.rows[0].avg)}</div></div>`;
    html += `<div class="stat-card"><h3>Highest</h3><div class="val">$${parseNum(stipendStats.rows[0].max_stipend)}</div></div>`;
    html += `<div class="stat-card" style="background:linear-gradient(135deg,#d97706,#f59e0b)"><h3>Lowest</h3><div class="val">$${parseNum(stipendStats.rows[0].min_stipend)}</div></div>`;
    html += '</div></div>';

    // Recommendation Rate
    const recRate = recommendRate.rows[0];
    const recPct = recRate.total > 0 ? Math.round((recRate.recommended / recRate.total) * 100) : 0;
    html += `<div class="card"><h3>Employer Recommendation Rate</h3>`;
    html += `<div style="font-size:36px;font-weight:700;color:${P}">${recPct}%</div>`;
    html += `<p class="text-muted">${recRate.recommended} out of ${recRate.total} supervisors would recommend their intern</p>`;
    html += `<progress value="${recPct}" max="100"></progress></div>`;

    // Avg Hours for Completion
    html += `<div class="card"><h3>Average Hours for Completion</h3>`;
    html += `<div style="font-size:36px;font-weight:700;color:${P}">${parseNum(avgCompletionHours.rows[0].avg_h)} hours</div></div>`;

    renderPage(req, res, html, 'Internship Analytics');
  }));

  // ============================================================
  // 14. COMPANY FEEDBACK — Bulk feedback & satisfaction
  // ============================================================
  app.get('/school/internships/feedback', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const r = await pool.query(
      `SELECT ic.name AS company_name, ic.id AS company_id,
        COUNT(DISTINCT ia.id) FILTER (WHERE ia.status='completed')::int AS total_interns,
        COALESCE(AVG(ie.rating),0)::numeric(3,2) AS avg_rating,
        COALESCE(AVG(ie.punctuality),0)::numeric(3,2) AS avg_punctuality,
        COALESCE(AVG(ie.teamwork),0)::numeric(3,2) AS avg_teamwork,
        COALESCE(AVG(ie.technical_skills),0)::numeric(3,2) AS avg_tech,
        COALESCE(AVG(ie.communication),0)::numeric(3,2) AS avg_comm,
        COUNT(ie.id) FILTER (WHERE ie.would_recommend=true)::int AS would_recommend,
        COUNT(ie.id)::int AS total_evals,
        AVG(th.hours)::numeric(10,1) AS avg_hours
       FROM internship_companies ic
       LEFT JOIN internships i ON i.company_id=ic.id AND i.tenant_id=$1
       LEFT JOIN internship_applications ia ON ia.internship_id=i.id AND ia.tenant_id=$1
       LEFT JOIN internship_evaluations ie ON ie.application_id=ia.id AND ie.tenant_id=$1
       LEFT JOIN LATERAL (SELECT SUM(hours_worked) AS hours FROM internship_timesheets WHERE application_id=ia.id) th ON true
       WHERE ic.tenant_id=$1 GROUP BY ic.id, ic.name ORDER BY total_interns DESC NULLS LAST`, [tid]);

    let html = SKIP + BREAD + ' &rsaquo; Company Feedback</div>';
    html += '<h2>Company Feedback & Performance</h2>';

    if (r.rows.length === 0) {
      html += '<div class="card"><p class="text-muted">No feedback data available yet.</p></div>';
    } else {
      for (const c of r.rows) {
        html += '<div class="card">';
        html += `<div class="flex" style="justify-content:space-between"><h3 style="margin:0">${esc(c.company_name)}</h3>`;
        html += `<span class="text-muted">${c.total_interns} completed interns</span></div>`;
        html += '<div class="grid" style="margin-top:12px">';
        html += `<div class="stat-card"><h3>Overall Rating</h3><div class="val">${c.avg_rating}/5</div></div>`;
        html += `<div class="stat-card" style="background:linear-gradient(135deg,#059669,#10b981)"><h3>Punctuality</h3><div class="val">${c.avg_punctuality}/5</div></div>`;
        html += `<div class="stat-card" style="background:linear-gradient(135deg,#d97706,#f59e0b)"><h3>Teamwork</h3><div class="val">${c.avg_teamwork}/5</div></div>`;
        html += `<div class="stat-card" style="background:linear-gradient(135deg,#7c3aed,#a78bfa)"><h3>Technical</h3><div class="val">${c.avg_tech}/5</div></div>`;
        html += `<div class="stat-card" style="background:linear-gradient(135deg,#0891b2,#06b6d4)"><h3>Communication</h3><div class="val">${c.avg_comm}/5</div></div>`;
        html += `<div class="stat-card" style="background:linear-gradient(135deg,#be185d,#ec4899)"><h3>Recommend</h3><div class="val">${c.total_evals > 0 ? Math.round((c.would_recommend/c.total_evals)*100) : 0}%</div></div>`;
        html += '</div>';
        if (c.avg_hours) html += `<p class="text-sm text-muted" style="margin-top:8px">Average hours per intern: ${c.avg_hours}</p>`;
        html += '</div>';
      }
    }
    renderPage(req, res, html, 'Company Feedback');
  }));

  // ============================================================
  // 15. PLACEMENT MATCHING — Match students to internships
  // ============================================================
  app.get('/school/internships/matching', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const openInternships = await pool.query(
      `SELECT i.*, ic.name AS company_name FROM internships i JOIN internship_companies ic ON ic.id=i.company_id
       WHERE i.tenant_id=$1 AND i.status='open' ORDER BY i.created_at DESC`, [tid]);
    const students = await pool.query(
      `SELECT s.id, s.first_name, s.last_name, s.admission_number, s.class_id,
        (SELECT COUNT(*)::int FROM internship_applications ia WHERE ia.student_id=s.id AND ia.status IN ('accepted','in_progress') AND ia.tenant_id=$1) AS active_count
       FROM students s WHERE s.tenant_id=$1 AND s.is_active=true ORDER BY s.last_name, s.first_name LIMIT 200`, [tid]);

    let html = SKIP + BREAD + ' &rsaquo; Placement Matching</div>';
    html += '<h2>Placement Matching</h2>';
    html += '<div class="grid">';
    html += '<div class="card"><h3 style="margin-top:0">Open Internships (' + openInternships.rows.length + ')</h3>';
    for (const i of openInternships.rows) {
      html += `<div style="padding:8px 0;border-bottom:1px solid #f3f4f6"><strong>${esc(i.title)}</strong><br>`;
      html += `<span class="text-sm text-muted">${esc(i.company_name)} · ${i.duration_weeks}w · ${i.max_positions - i.current_applicants} spots left</span></div>`;
    }
    html += '</div>';

    html += '<div class="card"><h3 style="margin-top:0">Available Students (' + students.rows.length + ')</h3>';
    if (students.rows.length === 0) {
      html += '<p class="text-muted">No students found.</p>';
    } else {
      html += '<table><thead><tr><th>Student</th><th>Active Placements</th></tr></thead><tbody>';
      for (const s of students.rows) {
        html += `<tr><td>${esc(s.last_name)}, ${esc(s.first_name)} ${s.admission_number ? '('+esc(s.admission_number)+')' : ''}</td>`;
        html += `<td>${s.active_count}</td></tr>`;
      }
      html += '</tbody></table>';
    }
    html += '</div></div>';

    // Manual matching form
    html += '<div class="card"><h3>Quick Match</h3>';
    html += '<form method="post" action="/school/internships/matching">';
    html += '<div class="grid">';
    html += '<div class="form-group"><label>Internship *</label><select name="internship_id" required>';
    for (const i of openInternships.rows) html += `<option value="${i.id}">${esc(i.title)} - ${esc(i.company_name)}</option>`;
    html += '</select></div>';
    html += '<div class="form-group"><label>Student *</label><select name="student_id" required>';
    for (const s of students.rows) html += `<option value="${s.id}">${esc(s.last_name)}, ${esc(s.first_name)}</option>`;
    html += '</select></div>';
    html += '</div>';
    html += '<button class="btn" type="submit">Match & Accept</button></form></div>';

    renderPage(req, res, html, 'Placement Matching');
  }));

  app.post('/school/internships/matching', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const { internship_id, student_id } = req.body;
    if (!internship_id || !student_id) {
      req.session.flash = { type: 'error', msg: 'Internship and student required' };
      return res.redirect('/school/internships/matching');
    }
    const dup = await pool.query(
      `SELECT id FROM internship_applications WHERE internship_id=$1 AND student_id=$2 AND tenant_id=$3 AND status NOT IN ('rejected','withdrawn')`,
      [internship_id, student_id, tid]);
    if (dup.rows[0]) {
      req.session.flash = { type: 'error', msg: 'Student already has an application for this internship' };
      return res.redirect('/school/internships/matching');
    }
    const r = await pool.query(
      `INSERT INTO internship_applications (tenant_id, internship_id, student_id, status, cover_letter, accepted_at)
       VALUES ($1, $2, $3, 'accepted', 'Matched by placement coordinator', NOW()) RETURNING id`,
      [tid, internship_id, student_id]);
    await pool.query(`UPDATE internships SET current_applicants = current_applicants + 1 WHERE id=$1 AND tenant_id=$2`, [internship_id, tid]);
    audit(req, 'internship_matched', { internship_id, student_id, application_id: r.rows[0].id });
    req.session.flash = { type: 'success', msg: 'Student matched and accepted' };
    res.redirect('/school/internships/matching');
  }));

  // ============================================================
  // 16. SKILLS ACQUIRED — Tracking across all internships
  // ============================================================
  app.get('/school/internships/skills', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const r = await pool.query(
      `SELECT skill, COUNT(*)::int AS student_count
       FROM internship_evaluations ie, jsonb_array_elements_text(ie.skills_acquired) AS skill
       WHERE ie.tenant_id=$1 GROUP BY skill ORDER BY student_count DESC LIMIT 30`, [tid]);

    let html = SKIP + BREAD + ' &rsaquo; Skills</div>';
    html += '<h2>Skills Acquired Tracker</h2>';

    if (r.rows.length === 0) {
      html += '<div class="card"><p class="text-muted">No skills data yet. Skills are tracked through evaluations.</p></div>';
    } else {
      const maxCount = r.rows[0].student_count;
      html += '<div class="card"><h3>Most Acquired Skills</h3>';
      for (const s of r.rows) {
        const pct = Math.round((s.student_count / maxCount) * 100);
        html += `<div style="margin-bottom:10px"><div class="flex"><strong>${esc(s.skill)}</strong><span class="text-muted">${s.student_count} students</span></div>`;
        html += `<progress value="${pct}" max="100"></progress></div>`;
      }
      html += '</div>';
    }
    renderPage(req, res, html, 'Skills Tracker');
  }));

  // ============================================================
  // 17. API Endpoints — JSON data for integrations
  // ============================================================
  app.get('/api/internships/stats', requireAuth, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const [companies, postings, applications, completed] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS n FROM internship_companies WHERE tenant_id=$1 AND is_active=true`, [tid]),
      pool.query(`SELECT COUNT(*)::int AS n FROM internships WHERE tenant_id=$1 AND status='open'`, [tid]),
      pool.query(`SELECT COUNT(*)::int AS n FROM internship_applications WHERE tenant_id=$1`, [tid]),
      pool.query(`SELECT COUNT(*)::int AS n FROM internship_applications WHERE tenant_id=$1 AND status='completed'`, [tid]),
    ]);
    okJson(res, {
      companies: companies.rows[0].n,
      open_postings: postings.rows[0].n,
      total_applications: applications.rows[0].n,
      completed: completed.rows[0].n
    });
  }));

  app.get('/api/internships/my', requireAuth, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const r = await pool.query(
      `SELECT ia.id, ia.status, i.title, ic.name AS company_name, i.duration_weeks, i.stipend, ia.applied_at
       FROM internship_applications ia
       JOIN internships i ON i.id=ia.internship_id
       JOIN internship_companies ic ON ic.id=i.company_id
       WHERE ia.student_id=$1 AND ia.tenant_id=$2 ORDER BY ia.applied_at DESC`, [req.user.id, tid]);
    okJson(res, { applications: r.rows });
  }));

  app.post('/api/internships/apply', requireAuth, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const { internship_id, cover_letter, resume_url, portfolio_url } = req.body;
    if (!internship_id || !cover_letter) return errJson(res, 'internship_id and cover_letter required');
    const internship = await pool.query(`SELECT id FROM internships WHERE id=$1 AND tenant_id=$2 AND status='open'`, [internship_id, tid]);
    if (!internship.rows[0]) return errJson(res, 'Internship not found', 404);
    const dup = await pool.query(
      `SELECT id FROM internship_applications WHERE internship_id=$1 AND student_id=$2 AND tenant_id=$3 AND status NOT IN ('rejected','withdrawn')`,
      [internship_id, req.user.id, tid]);
    if (dup.rows[0]) return errJson(res, 'Already applied', 409);
    const r = await pool.query(
      `INSERT INTO internship_applications (tenant_id, internship_id, student_id, cover_letter, resume_url, portfolio_url, status)
       VALUES ($1,$2,$3,$4,$5,$6,'pending') RETURNING id`,
      [tid, internship_id, req.user.id, cover_letter, resume_url || null, portfolio_url || null]);
    okJson(res, { application_id: r.rows[0].id, message: 'Application submitted' }, 201);
  }));

  app.post('/api/internships/timesheets', requireAuth, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const { application_id, week_number, hours_worked, tasks_completed } = req.body;
    if (!application_id || !week_number || hours_worked === undefined) return errJson(res, 'application_id, week_number, and hours_worked required');
    const r = await pool.query(
      `INSERT INTO internship_timesheets (tenant_id, application_id, week_number, hours_worked, tasks_completed)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [tid, application_id, parseInt(week_number), parseNum(hours_worked), tasks_completed || null]);
    okJson(res, { timesheet_id: r.rows[0].id, message: 'Timesheet submitted' }, 201);
  }));

  console.log('[InternshipTracker] Module loaded — 17+ routes registered');
};
