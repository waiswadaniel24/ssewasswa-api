// ============================================================
// ADMISSIONS MODULE — Multi-Tenant SaaS Platform
// Student applications, enrollment management, pipeline
// tracking (pending → reviewing → accepted/rejected → enrolled),
// admission settings, and analytics reports.
// ============================================================
// Usage in server.js:
//   const admissions = require('./admissions');
//   admissions(app, db, pool, renderPage, esc);
// ============================================================
// Tables this module creates:
//   admission_applications, admission_settings
// Tables this module also uses (must already exist or be created
// by other modules):
//   admissions, enrollments, students
// Add to VALID_TABLES in server.js:
//   ['admission_applications','admission_settings']
//   .forEach(t => VALID_TABLES.add(t));
// ============================================================

'use strict';

module.exports = function admissions(app, db, pool, renderPage, esc) {

  // -- inline helpers ---------------------------------------------------
  const requireAuth = (req, res, next) => {
    if (!req.session?.user) return res.redirect('/login');
    next();
  };
  const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  if (!esc) esc = (s) => String(s == null ? '' : (typeof s === 'object' ? JSON.stringify(s) : s))
    .replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const fmtTime = (t) => t ? String(t).substring(0, 5) : '—';
  const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const today = () => new Date().toISOString().slice(0, 10);
  const genToken = () => require('crypto').randomBytes(24).toString('hex');

  function statusBadge(s) {
    const m = {
      pending: { bg: '#fef3c7', c: '#b45309', l: '⏳ Pending', icon: '⏳' },
      reviewing: { bg: '#dbeafe', c: '#1d4ed8', l: '🔍 Reviewing', icon: '🔍' },
      accepted: { bg: '#dcfce7', c: '#16a34a', l: '✅ Accepted', icon: '✅' },
      rejected: { bg: '#fee2e2', c: '#dc2626', l: '❌ Rejected', icon: '❌' },
      enrolled: { bg: '#eef2ff', c: '#4f46e5', l: '🎓 Enrolled', icon: '🎓' },
      waitlisted: { bg: '#f1f5f9', c: '#64748b', l: '📋 Waitlisted', icon: '📋' },
      withdrawn: { bg: '#f1f5f9', c: '#64748b', l: 'Withdrawn', icon: '↩️' }
    };
    const v = m[s] || { bg: '#f1f5f9', c: '#64748b', l: s || '—', icon: '•' };
    return '<span class="badge" style="background:' + v.bg + ';color:' + v.c + ';font-weight:600">' + v.l + '</span>';
  }

  function pipelineStep(current, step) {
    const order = ['pending', 'reviewing', 'accepted', 'enrolled'];
    const idx = order.indexOf(step);
    const curIdx = order.indexOf(current);
    const isActive = current === step;
    const isCompleted = curIdx > idx && (step === 'accepted' || current === 'enrolled');
    const isRejected = current === 'rejected' && idx > 0;
    if (isActive) return '<div style="background:#4f46e5;color:#fff;border-radius:10px;padding:12px;text-align:center;font-weight:700;font-size:13px">' + step.charAt(0).toUpperCase() + step.slice(1) + '</div>';
    if (isCompleted) return '<div style="background:#dcfce7;color:#16a34a;border-radius:10px;padding:12px;text-align:center;font-weight:700;font-size:13px">✓ ' + step.charAt(0).toUpperCase() + step.slice(1) + '</div>';
    if (isRejected) return '<div style="background:#fee2e2;color:#dc2626;border-radius:10px;padding:12px;text-align:center;font-weight:700;font-size:13px">✗ ' + step.charAt(0).toUpperCase() + step.slice(1) + '</div>';
    return '<div style="background:#f1f5f9;color:#94a3b8;border-radius:10px;padding:12px;text-align:center;font-size:13px">' + step.charAt(0).toUpperCase() + step.slice(1) + '</div>';
  }

  function pipelineArrow(current, step) {
    const order = ['pending', 'reviewing', 'accepted', 'enrolled'];
    const idx = order.indexOf(step);
    const curIdx = order.indexOf(current);
    if (curIdx > idx || current === 'enrolled') return '<div style="color:#16a34a;font-size:18px;text-align:center;padding-top:8px">→</div>';
    if (current === 'rejected' && idx > 0) return '<div style="color:#dc2626;font-size:18px;text-align:center;padding-top:8px">→</div>';
    return '<div style="color:#cbd5e1;font-size:18px;text-align:center;padding-top:8px">→</div>';
  }

  // -- shared CSS --------------------------------------------------------
  const ADM_CSS = '<style>\n\
.adm-nav{display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap}\n\
.adm-nav a{padding:8px 18px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#475569;background:#f1f5f9;transition:.15s}\n\
.adm-nav a:hover{background:#e2e8f0}.adm-nav a.active{background:#4f46e5;color:#fff}\n\
.adm-btn{display:inline-flex;align-items:center;gap:6px;padding:9px 18px;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:.15s}\n\
.adm-btn:hover{opacity:.9;transform:translateY(-1px)}\n\
.adm-btn-primary{background:#4f46e5;color:#fff}.adm-btn-success{background:#059669;color:#fff}\n\
.adm-btn-danger{background:#fee2e2;color:#dc2626}.adm-btn-secondary{background:#f1f5f9;color:#475569}\n\
.adm-btn-warning{background:#fef3c7;color:#b45309}\n\
.adm-table{width:100%;border-collapse:collapse;font-size:13px}\n\
.adm-table th{padding:11px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#f8fafc}\n\
.adm-table td{padding:10px 14px;border-bottom:1px solid #f1f5f9;color:#1e293b}\n\
.adm-table tr:hover{background:#f8fafc}\n\
.adm-filter{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:end}\n\
.adm-filter label{display:block;font-size:12px;font-weight:600;color:#64748b;margin-bottom:4px}\n\
.adm-filter input,.adm-filter select{padding:8px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px;background:#fff}\n\
.adm-filter input:focus,.adm-filter select:focus{outline:none;border-color:#6366f1}\n\
.adm-form label{display:block;font-size:13px;font-weight:600;color:#475569;margin-bottom:4px}\n\
.adm-form input,.adm-form select,.adm-form textarea{width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;box-sizing:border-box}\n\
.adm-form input:focus,.adm-form select:focus,.adm-form textarea:focus{outline:none;border-color:#6366f1}\n\
.adm-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}\n\
.adm-form-grid .full{grid-column:1/-1}\n\
.adm-pipeline{display:grid;grid-template-columns:1fr auto 1fr auto 1fr auto 1fr;gap:8px;align-items:start;margin-bottom:24px}\n\
.adm-applicant-card{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:16px;transition:.15s}\n\
.adm-applicant-card:hover{box-shadow:0 2px 12px rgba(0,0,0,.06)}\n\
.adm-detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:14px}\n\
.adm-detail-label{font-size:12px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:.3px}\n\
.adm-detail-value{color:#1e293b;font-weight:500}\n\
@media(max-width:768px){.adm-pipeline{grid-template-columns:1fr;gap:6px}.adm-nav{gap:4px}.adm-nav a{padding:6px 12px;font-size:12px}.adm-form-grid{grid-template-columns:1fr}}\n\
</style>';

  // -- navigation helper --------------------------------------------------
  const nav = (active) => '<div class="adm-nav">' +
    '<a href="/admissions" class="' + (active === 'dash' ? 'active' : '') + '">📊 Dashboard</a>' +
    '<a href="/admissions/applications" class="' + (active === 'applications' ? 'active' : '') + '">📋 Applications</a>' +
    '<a href="/admissions/apply" class="' + (active === 'apply' ? 'active' : '') + '">+ New Application</a>' +
    '<a href="/admissions/enroll" class="' + (active === 'enroll' ? 'active' : '') + '">🎓 Enroll</a>' +
    '<a href="/admissions/settings" class="' + (active === 'settings' ? 'active' : '') + '">⚙️ Settings</a>' +
    '<a href="/admissions/reports" class="' + (active === 'reports' ? 'active' : '') + '">📈 Reports</a>' +
    '</div>';

  // ============================================================
  // DATABASE MIGRATIONS (async IIFE)
  // ============================================================
  (async () => {
    const c = await pool.connect().catch(() => null);
    if (!c) { console.error('[Admissions] Cannot connect to DB for migrations'); return; }
    try {
      await c.query(`CREATE TABLE IF NOT EXISTS admission_applications (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        applicant_name VARCHAR(255), email VARCHAR(255), phone VARCHAR(50),
        date_of_birth DATE, gender VARCHAR(20), previous_school TEXT,
        applying_class VARCHAR(100), parent_name VARCHAR(255), parent_phone VARCHAR(50),
        address TEXT, medical_notes TEXT, documents JSONB DEFAULT '[]',
        status VARCHAR(20) DEFAULT 'pending',
        interview_date TIMESTAMPTZ, interview_notes TEXT,
        reviewed_by INTEGER, created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await c.query(`CREATE TABLE IF NOT EXISTS admission_settings (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        academic_year VARCHAR(20), term VARCHAR(50),
        application_deadline DATE, interview_required BOOLEAN DEFAULT true,
        required_documents TEXT[], min_age INTEGER, max_age INTEGER,
        fee DECIMAL(12,2) DEFAULT 0, status VARCHAR(20) DEFAULT 'open',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      // ALTER TABLE — admission_applications
      const aaCols = ['applicant_name VARCHAR(255)','email VARCHAR(255)','phone VARCHAR(50)',
        'date_of_birth DATE','gender VARCHAR(20)','previous_school TEXT',
        'applying_class VARCHAR(100)','parent_name VARCHAR(255)','parent_phone VARCHAR(50)',
        'address TEXT','medical_notes TEXT','documents JSONB DEFAULT \'[]\'::jsonb',
        'status VARCHAR(20) DEFAULT \'pending\'',
        'interview_date TIMESTAMPTZ','interview_notes TEXT','reviewed_by INTEGER'];
      for (const col of aaCols) { try { await c.query('ALTER TABLE admission_applications ADD COLUMN IF NOT EXISTS ' + col); } catch(e){} }
      // ALTER TABLE — admission_settings
      const asCols = ['academic_year VARCHAR(20)','term VARCHAR(50)',
        'application_deadline DATE','interview_required BOOLEAN DEFAULT true',
        'required_documents TEXT[]','min_age INTEGER','max_age INTEGER',
        'fee DECIMAL(12,2) DEFAULT 0','status VARCHAR(20) DEFAULT \'open\''];
      for (const col of asCols) { try { await c.query('ALTER TABLE admission_settings ADD COLUMN IF NOT EXISTS ' + col); } catch(e){} }
      // Indexes
      await c.query('CREATE INDEX IF NOT EXISTS idx_aa_tenant ON admission_applications(tenant_id)');
      await c.query('CREATE INDEX IF NOT EXISTS idx_aa_status ON admission_applications(tenant_id, status)');
      await c.query('CREATE INDEX IF NOT EXISTS idx_aa_email ON admission_applications(tenant_id, email)');
      await c.query('CREATE INDEX IF NOT EXISTS idx_aSett_tenant ON admission_settings(tenant_id)');
      console.log('[Admissions] Migrations applied successfully');
    } catch (e) { console.error('[Admissions] Migration error:', e.message); }
    finally { c.release(); }
  })();

  // ============================================================
  // ROUTE 1: GET /admissions — Admissions Dashboard
  // ============================================================
  app.get('/admissions', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    const stats = (await pool.query(`
      SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE status='pending')::int as pending,
        COUNT(*) FILTER (WHERE status='reviewing')::int as reviewing,
        COUNT(*) FILTER (WHERE status='accepted')::int as accepted,
        COUNT(*) FILTER (WHERE status='rejected')::int as rejected,
        COUNT(*) FILTER (WHERE status='enrolled')::int as enrolled,
        COUNT(*) FILTER (WHERE created_at >= date_trunc('month', CURRENT_DATE))::int as this_month
      FROM admission_applications WHERE tenant_id=$1`, [tid]
    )).rows[0];

    const recentApps = (await pool.query(
      'SELECT * FROM admission_applications WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 10', [tid]
    )).rows;

    const recentRows = recentApps.map(a => '<tr>' +
      '<td><a href="/admissions/applications/' + a.id + '" style="color:#4f46e5;text-decoration:none;font-weight:600">' + esc(a.applicant_name || '—') + '</a></td>' +
      '<td class="muted">' + esc(a.applying_class || '—') + '</td>' +
      '<td>' + statusBadge(a.status) + '</td>' +
      '<td class="muted">' + fmtDate(a.created_at) + '</td>' +
    '</tr>').join('');

    const html = ADM_CSS + '<div style="max-width:1200px;margin:0 auto">' +
      nav('dash') +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">' +
        '<div><h1 style="font-size:24px;color:#1e293b">📊 Admissions Dashboard</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Application pipeline overview and statistics</p></div>' +
        '<div style="display:flex;gap:8px">' +
          '<a href="/admissions/apply" class="adm-btn adm-btn-primary">+ New Application</a>' +
          '<a href="/admissions/reports" class="adm-btn adm-btn-secondary">📈 Reports</a>' +
        '</div>' +
      '</div>' +
      '<div class="stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:14px;margin-bottom:24px">' +
        '<div class="stat-card"><div class="stat-num" style="color:#4f46e5">' + stats.total + '</div><div class="muted" style="font-size:11px">Total</div></div>' +
        '<div class="stat-card"><div class="stat-num" style="color:#f59e0b">' + stats.pending + '</div><div class="muted" style="font-size:11px">Pending</div></div>' +
        '<div class="stat-card"><div class="stat-num" style="color:#3b82f6">' + stats.reviewing + '</div><div class="muted" style="font-size:11px">Reviewing</div></div>' +
        '<div class="stat-card"><div class="stat-num" style="color:#16a34a">' + stats.accepted + '</div><div class="muted" style="font-size:11px">Accepted</div></div>' +
        '<div class="stat-card"><div class="stat-num" style="color:#dc2626">' + stats.rejected + '</div><div class="muted" style="font-size:11px">Rejected</div></div>' +
        '<div class="stat-card"><div class="stat-num" style="color:#8b5cf6">' + stats.enrolled + '</div><div class="muted" style="font-size:11px">Enrolled</div></div>' +
        '<div class="stat-card"><div class="stat-num" style="color:#059669">' + stats.this_month + '</div><div class="muted" style="font-size:11px">This Month</div></div>' +
      '</div>' +
      '<div class="card" style="padding:20px">' +
        '<h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">📋 Recent Applications</h3>' +
        '<div style="overflow-x:auto"><table class="adm-table">' +
          '<thead><tr><th>Applicant</th><th>Class</th><th>Status</th><th>Applied</th></tr></thead>' +
          '<tbody>' + (recentRows || '<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:20px">No applications yet</td></tr>') + '</tbody>' +
        '</table></div>' +
      '</div>' +
    '</div>';
    res.send(renderPage('Admissions Dashboard', html, user, req));
  }));

  // ============================================================
  // ROUTE 2: GET /admissions/applications — Application List
  // ============================================================
  app.get('/admissions/applications', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const statusFilter = req.query.status || '';
    const search = req.query.q || '';
    const classFilter = req.query.class || '';

    let where = ['aa.tenant_id=$1'], params = [tid], pi = 2;
    if (statusFilter) { where.push('aa.status=$' + pi++); params.push(statusFilter); }
    if (search) { where.push('(aa.applicant_name ILIKE $' + pi + ' OR aa.email ILIKE $' + pi + ')'); params.push('%' + search + '%'); pi++; }
    if (classFilter) { where.push('aa.applying_class=$' + pi); params.push(classFilter); pi++; }

    const applications = (await pool.query(
      'SELECT * FROM admission_applications aa WHERE ' + where.join(' AND ') + ' ORDER BY aa.created_at DESC LIMIT 200', params
    )).rows;

    const rows = applications.map(a => '<tr>' +
      '<td><a href="/admissions/applications/' + a.id + '" style="color:#4f46e5;text-decoration:none;font-weight:600">' + esc(a.applicant_name || '—') + '</a>' +
        '<span class="muted" style="display:block;font-size:11px">' + esc(a.email || '') + '</span></td>' +
      '<td>' + esc(a.applying_class || '—') + '</td>' +
      '<td>' + statusBadge(a.status) + '</td>' +
      '<td>' + (a.date_of_birth ? fmtDate(a.date_of_birth) : '—') + '</td>' +
      '<td class="muted">' + esc(a.previous_school || '—') + '</td>' +
      '<td class="muted">' + fmtDate(a.created_at) + '</td>' +
    '</tr>').join('');

    const statuses = ['pending','reviewing','accepted','rejected','enrolled','waitlisted','withdrawn'];

    const html = ADM_CSS + '<div style="max-width:1200px;margin:0 auto">' +
      nav('applications') +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">' +
        '<div><h1 style="font-size:24px;color:#1e293b">📋 Applications</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Manage all admission applications</p></div>' +
        '<a href="/admissions/apply" class="adm-btn adm-btn-primary">+ New Application</a>' +
      '</div>' +
      '<div class="adm-filter">' +
        '<div><label>Search</label><form method="GET" style="display:flex;gap:6px"><input type="text" name="q" value="' + esc(search) + '" placeholder="Name or email..."><button type="submit" class="btn btn-sm btn-blue">Search</button></form></div>' +
        '<div><label>Status</label><select onchange="location.href=\'/admissions/applications?status=\'+this.value">' +
          '<option value="">All Statuses</option>' +
          statuses.map(s => '<option value="' + s + '" ' + (statusFilter === s ? 'selected' : '') + '>' + s.charAt(0).toUpperCase() + s.slice(1) + '</option>').join('') +
        '</select></div>' +
        '<div><label>Class</label><input type="text" value="' + esc(classFilter) + '" placeholder="Filter class" onchange="location.href=\'/admissions/applications?status=' + esc(statusFilter) + '&class=\'+this.value"></div>' +
      '</div>' +
      '<div class="card" style="padding:20px">' +
        '<div style="overflow-x:auto"><table class="adm-table">' +
          '<thead><tr><th>Applicant</th><th>Class</th><th>Status</th><th>DOB</th><th>Previous School</th><th>Applied</th></tr></thead>' +
          '<tbody>' + (rows || '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:30px">No applications found</td></tr>') + '</tbody>' +
        '</table></div>' +
      '</div>' +
    '</div>';
    res.send(renderPage('Applications', html, user, req));
  }));

  // ============================================================
  // ROUTE 3: GET /admissions/apply — New Application Form
  // ============================================================
  app.get('/admissions/apply', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const classes = (await pool.query('SELECT id, name FROM classes WHERE tenant_id=$1 ORDER BY name', [tid])).rows;

    const classOpts = classes.map(c => '<option value="' + esc(c.name) + '">' + esc(c.name) + '</option>').join('');

    const html = ADM_CSS + '<div style="max-width:800px;margin:0 auto">' +
      nav('apply') +
      '<a href="/admissions/applications" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Applications</a>' +
      '<div class="card" style="padding:28px">' +
        '<h2 style="color:#1e293b;margin:0 0 4px">📝 New Admission Application</h2>' +
        '<p style="font-size:13px;color:#94a3b8;margin-bottom:24px">Submit a new student application for enrollment</p>' +
        '<form method="POST" action="/admissions/apply" class="adm-form-grid adm-form">' +
          '<div><label>Applicant Name *</label><input type="text" name="applicant_name" required placeholder="Full name"></div>' +
          '<div><label>Email *</label><input type="email" name="email" required placeholder="email@example.com"></div>' +
          '<div><label>Phone</label><input type="tel" name="phone" placeholder="Phone number"></div>' +
          '<div><label>Date of Birth</label><input type="date" name="date_of_birth"></div>' +
          '<div><label>Gender</label><select name="gender"><option value="">— Select —</option><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option></select></div>' +
          '<div><label>Applying Class *</label><select name="applying_class" required>' +
            '<option value="">— Select —</option>' + classOpts + '</select></div>' +
          '<div><label>Parent/Guardian Name</label><input type="text" name="parent_name" placeholder="Parent full name"></div>' +
          '<div><label>Parent Phone</label><input type="tel" name="parent_phone" placeholder="Parent phone"></div>' +
          '<div class="full"><label>Previous School</label><input type="text" name="previous_school" placeholder="Previous school name"></div>' +
          '<div class="full"><label>Address</label><textarea name="address" rows="2" placeholder="Home address..."></textarea></div>' +
          '<div class="full"><label>Medical Notes</label><textarea name="medical_notes" rows="2" placeholder="Any medical conditions or allergies..."></textarea></div>' +
          '<div class="full" style="display:flex;gap:10px;margin-top:8px">' +
            '<button type="submit" class="adm-btn adm-btn-primary" style="padding:12px 28px">Submit Application</button>' +
            '<a href="/admissions/applications" class="adm-btn adm-btn-secondary" style="padding:12px 28px;text-decoration:none">Cancel</a>' +
          '</div>' +
        '</form>' +
      '</div>' +
    '</div>';
    res.send(renderPage('New Application', html, user, req));
  }));

  // ============================================================
  // ROUTE 4: POST /admissions/apply — Submit Application
  // ============================================================
  app.post('/admissions/apply', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { applicant_name, email, phone, date_of_birth, gender, previous_school,
            applying_class, parent_name, parent_phone, address, medical_notes } = req.body;

    if (!applicant_name || !applicant_name.trim() || !email || !email.trim()) {
      return res.redirect('/admissions/apply');
    }

    await pool.query(
      `INSERT INTO admission_applications (tenant_id, applicant_name, email, phone, date_of_birth,
        gender, previous_school, applying_class, parent_name, parent_phone, address, medical_notes, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [tid, applicant_name.trim(), email.trim(), phone || null, date_of_birth || null,
       gender || null, previous_school || null, applying_class || null,
       parent_name || null, parent_phone || null, address || null, medical_notes || null, 'pending']
    );
    console.log('[Admissions] Application submitted by ' + applicant_name.trim());
    res.redirect('/admissions/applications');
  }));

  // ============================================================
  // ROUTE 5: GET /admissions/applications/:id — Application Detail
  // ============================================================
  app.get('/admissions/applications/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, appId = req.params.id;
    const app_data = (await pool.query(
      'SELECT aa.*, u.name as reviewer_name FROM admission_applications aa LEFT JOIN users u ON u.id = aa.reviewed_by WHERE aa.id=$1 AND aa.tenant_id=$2', [appId, tid]
    )).rows[0];
    if (!app_data) return res.redirect('/admissions/applications');

    const detail = (label, value) =>
      '<div><div class="adm-detail-label">' + label + '</div><div class="adm-detail-value">' + esc(value || '—') + '</div></div>';

    const html = ADM_CSS + '<div style="max-width:1000px;margin:0 auto">' +
      nav('applications') +
      '<a href="/admissions/applications" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Applications</a>' +
      '<div class="card" style="padding:24px;margin-bottom:20px">' +
        '<div style="display:flex;justify-content:space-between;align-items:start;flex-wrap:wrap;gap:12px;margin-bottom:20px">' +
          '<div><h1 style="font-size:22px;color:#1e293b;margin:0">' + esc(app_data.applicant_name) + '</h1>' +
            '<p style="font-size:13px;color:#64748b;margin-top:4px">Application #' + app_data.id + ' · Applied ' + fmtDate(app_data.created_at) + '</p>' +
          '</div>' +
          statusBadge(app_data.status) +
        '</div>' +
        '<div style="margin-bottom:20px">' +
          '<div class="adm-pipeline">' +
            pipelineStep(app_data.status, 'pending') +
            pipelineArrow(app_data.status, 'reviewing') +
            pipelineStep(app_data.status, 'reviewing') +
            pipelineArrow(app_data.status, 'accepted') +
            pipelineStep(app_data.status, 'accepted') +
            pipelineArrow(app_data.status, 'enrolled') +
            pipelineStep(app_data.status, 'enrolled') +
          '</div>' +
        '</div>' +
        '<div class="adm-detail-grid">' +
          detail('Applicant Name', app_data.applicant_name) +
          detail('Email', app_data.email) +
          detail('Phone', app_data.phone) +
          detail('Date of Birth', app_data.date_of_birth ? fmtDate(app_data.date_of_birth) : '—') +
          detail('Gender', app_data.gender) +
          detail('Applying Class', app_data.applying_class) +
          detail('Previous School', app_data.previous_school) +
          detail('Parent Name', app_data.parent_name) +
          detail('Parent Phone', app_data.parent_phone) +
          detail('Address', app_data.address) +
          detail('Medical Notes', app_data.medical_notes) +
          detail('Interview Date', app_data.interview_date ? fmtDateTime(app_data.interview_date) : 'Not scheduled') +
        '</div>' +
      '</div>' +
      '<div class="card" style="padding:20px">' +
        '<h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">Review Application</h3>' +
        '<form method="POST" action="/admissions/applications/' + appId + '/review" class="adm-form-grid adm-form">' +
          '<div><label>Status *</label><select name="status" required>' +
            '<option value="pending" ' + (app_data.status === 'pending' ? 'selected' : '') + '>Pending</option>' +
            '<option value="reviewing" ' + (app_data.status === 'reviewing' ? 'selected' : '') + '>Reviewing</option>' +
            '<option value="accepted" ' + (app_data.status === 'accepted' ? 'selected' : '') + '>Accepted</option>' +
            '<option value="rejected" ' + (app_data.status === 'rejected' ? 'selected' : '') + '>Rejected</option>' +
            '<option value="enrolled" ' + (app_data.status === 'enrolled' ? 'selected' : '') + '>Enrolled</option>' +
            '<option value="waitlisted" ' + (app_data.status === 'waitlisted' ? 'selected' : '') + '>Waitlisted</option>' +
            '<option value="withdrawn" ' + (app_data.status === 'withdrawn' ? 'selected' : '') + '>Withdrawn</option>' +
          '</select></div>' +
          '<div><label>Interview Date</label><input type="datetime-local" name="interview_date" value="' + (app_data.interview_date ? new Date(app_data.interview_date).toISOString().slice(0, 16) : '') + '"></div>' +
          '<div class="full"><label>Interview Notes</label><textarea name="interview_notes" rows="3" placeholder="Notes from interview...">' + esc(app_data.interview_notes || '') + '</textarea></div>' +
          '<div class="full" style="display:flex;gap:8px">' +
            '<button type="submit" class="adm-btn adm-btn-success">💾 Save Review</button>' +
            (app_data.status === 'accepted' ? '<a href="/admissions/enroll?application_id=' + appId + '" class="adm-btn adm-btn-primary">🎓 Process Enrollment</a>' : '') +
          '</div>' +
        '</form>' +
      '</div>' +
    '</div>';
    res.send(renderPage('Application: ' + app_data.applicant_name, html, user, req));
  }));

  // ============================================================
  // ROUTE 6: POST /admissions/applications/:id/review — Review
  // ============================================================
  app.post('/admissions/applications/:id/review', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, appId = req.params.id;
    const { status, interview_date, interview_notes } = req.body;

    await pool.query(
      `UPDATE admission_applications SET status=$1, interview_date=$2, interview_notes=$3, reviewed_by=$4
       WHERE id=$5 AND tenant_id=$6`,
      [status || 'pending', interview_date || null, interview_notes || null, user.id, parseInt(appId), tid]
    );
    console.log('[Admissions] Application #' + appId + ' status changed to ' + status + ' by ' + user.email);
    res.redirect('/admissions/applications/' + appId);
  }));

  // ============================================================
  // ROUTE 7: GET /admissions/enroll — Enrollment Management
  // ============================================================
  app.get('/admissions/enroll', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const selAppId = req.query.application_id || '';

    const acceptedApps = (await pool.query(
      "SELECT * FROM admission_applications WHERE tenant_id=$1 AND status='accepted' ORDER BY created_at DESC", [tid]
    )).rows;

    const enrolledStudents = (await pool.query(
      "SELECT * FROM admission_applications WHERE tenant_id=$1 AND status='enrolled' ORDER BY created_at DESC LIMIT 50", [tid]
    )).rows;

    const appOpts = acceptedApps.map(a =>
      '<option value="' + a.id + '" ' + (selAppId == a.id ? 'selected' : '') + '>' + esc(a.applicant_name) + ' — ' + esc(a.applying_class) + '</option>'
    ).join('');

    const enrolledRows = enrolledStudents.map(e => '<tr>' +
      '<td><strong>' + esc(e.applicant_name) + '</strong></td>' +
      '<td>' + esc(e.applying_class || '—') + '</td>' +
      '<td class="muted">' + esc(e.email) + '</td>' +
      '<td class="muted">' + esc(e.parent_name || '—') + '</td>' +
      '<td>' + statusBadge(e.status) + '</td>' +
    '</tr>').join('');

    const html = ADM_CSS + '<div style="max-width:1100px;margin:0 auto">' +
      nav('enroll') +
      '<div class="card" style="padding:24px;margin-bottom:20px">' +
        '<h2 style="color:#1e293b;margin:0 0 4px">🎓 Process Enrollment</h2>' +
        '<p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Select an accepted application to process enrollment</p>' +
        '<form method="POST" action="/admissions/enroll" class="adm-form">' +
          '<div style="margin-bottom:14px"><label>Select Accepted Application *</label>' +
            '<select name="application_id" required>' +
              '<option value="">— Choose an accepted application —</option>' +
              appOpts +
            '</select>' +
          '</div>' +
          '<div style="margin-bottom:14px"><label>Student ID / Roll Number</label><input type="text" name="student_id" placeholder="Auto-generated if blank"></div>' +
          '<div style="margin-bottom:14px"><label>Enrollment Date</label><input type="date" name="enrollment_date" value="' + today() + '"></div>' +
          '<button type="submit" class="adm-btn adm-btn-success" style="padding:12px 28px">🎓 Process Enrollment</button>' +
        '</form>' +
      '</div>' +
      '<div class="card" style="padding:20px">' +
        '<h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">📋 Enrolled Students (' + enrolledStudents.length + ')</h3>' +
        '<div style="overflow-x:auto"><table class="adm-table">' +
          '<thead><tr><th>Student</th><th>Class</th><th>Email</th><th>Parent</th><th>Status</th></tr></thead>' +
          '<tbody>' + (enrolledRows || '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:20px">No enrolled students</td></tr>') + '</tbody>' +
        '</table></div>' +
      '</div>' +
    '</div>';
    res.send(renderPage('Enrollment', html, user, req));
  }));

  // ============================================================
  // ROUTE 8: POST /admissions/enroll — Process Enrollment
  // ============================================================
  app.post('/admissions/enroll', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { application_id, student_id, enrollment_date } = req.body;
    if (!application_id) return res.redirect('/admissions/enroll');

    const app_data = (await pool.query(
      'SELECT * FROM admission_applications WHERE id=$1 AND tenant_id=$2 AND status=\'accepted\'',
      [parseInt(application_id), tid]
    )).rows[0];
    if (!app_data) return res.redirect('/admissions/enroll');

    // Update application status to enrolled
    await pool.query(
      'UPDATE admission_applications SET status=\'enrolled\', reviewed_by=$1 WHERE id=$2 AND tenant_id=$3',
      [user.id, parseInt(application_id), tid]
    );

    // Try to create student record
    try {
      await pool.query(
        `INSERT INTO students (tenant_id, name, email, phone, class, parent_name, parent_phone,
          date_of_birth, gender, address, enrolled_date, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'active')`,
        [tid, app_data.applicant_name, app_data.email, app_data.phone, app_data.applying_class,
         app_data.parent_name, app_data.parent_phone, app_data.date_of_birth, app_data.gender,
         app_data.address, enrollment_date || today()]
      );
    } catch (e) {
      console.warn('[Admissions] Could not create student record (table may not exist):', e.message);
    }

    console.log('[Admissions] Application #' + application_id + ' enrolled: ' + app_data.applicant_name);
    res.redirect('/admissions/enroll');
  }));

  // ============================================================
  // ROUTE 9: GET /admissions/settings — Admission Settings
  // ============================================================
  app.get('/admissions/settings', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const settings = (await pool.query(
      'SELECT * FROM admission_settings WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 1', [tid]
    )).rows[0];

    const html = ADM_CSS + '<div style="max-width:800px;margin:0 auto">' +
      nav('settings') +
      '<div class="card" style="padding:28px">' +
        '<h2 style="color:#1e293b;margin:0 0 4px">⚙️ Admission Settings</h2>' +
        '<p style="font-size:13px;color:#94a3b8;margin-bottom:24px">Configure admission requirements, deadlines, and policies</p>' +
        '<form method="POST" action="/admissions/settings" class="adm-form-grid adm-form">' +
          '<div><label>Academic Year</label><input type="text" name="academic_year" value="' + esc(settings ? settings.academic_year || '' : '') + '" placeholder="e.g. 2025"></div>' +
          '<div><label>Term</label><input type="text" name="term" value="' + esc(settings ? settings.term || '' : '') + '" placeholder="e.g. Term 1"></div>' +
          '<div><label>Application Deadline</label><input type="date" name="application_deadline" value="' + (settings && settings.application_deadline ? settings.application_deadline.toISOString().slice(0, 10) : '') + '"></div>' +
          '<div><label>Admission Status</label><select name="status">' +
            '<option value="open" ' + (settings && settings.status === 'open' ? 'selected' : '') + '>Open</option>' +
            '<option value="closed" ' + (settings && settings.status === 'closed' ? 'selected' : '') + '>Closed</option>' +
            '<option value="upcoming" ' + (settings && settings.status === 'upcoming' ? 'selected' : '') + '>Upcoming</option>' +
          '</select></div>' +
          '<div><label>Min Age</label><input type="number" name="min_age" value="' + (settings ? settings.min_age || '' : '') + '" min="3" max="25"></div>' +
          '<div><label>Max Age</label><input type="number" name="max_age" value="' + (settings ? settings.max_age || '' : '') + '" min="3" max="25"></div>' +
          '<div><label>Application Fee</label><input type="number" name="fee" value="' + (settings ? settings.fee || '0' : '0') + '" step="0.01" min="0"></div>' +
          '<div style="display:flex;align-items:end;padding-bottom:4px"><label><input type="checkbox" name="interview_required" ' + (!settings || settings.interview_required ? 'checked' : '') + '> Interview Required</label></div>' +
          '<div class="full"><label>Required Documents (one per line)</label><textarea name="required_documents" rows="4" placeholder="Birth Certificate\nPrevious School Reports\nPassport Photos\nMedical Certificate">' + esc(settings && settings.required_documents ? (Array.isArray(settings.required_documents) ? settings.required_documents.join('\n') : String(settings.required_documents)) : '') + '</textarea></div>' +
          '<div class="full"><button type="submit" class="adm-btn adm-btn-primary" style="padding:12px 28px">💾 Save Settings</button></div>' +
        '</form>' +
      '</div>' +
    '</div>';
    res.send(renderPage('Admission Settings', html, user, req));
  }));

  // ============================================================
  // ROUTE 10: POST /admissions/settings — Save Settings
  // ============================================================
  app.post('/admissions/settings', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { academic_year, term, application_deadline, status, min_age, max_age, fee, interview_required, required_documents } = req.body;

    const docList = required_documents
      ? required_documents.split('\n').map(d => d.trim()).filter(Boolean)
      : [];

    // Upsert settings
    const existing = (await pool.query(
      'SELECT id FROM admission_settings WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 1', [tid]
    )).rows[0];

    if (existing) {
      await pool.query(
        `UPDATE admission_settings SET academic_year=$1, term=$2, application_deadline=$3,
         interview_required=$4, required_documents=$5, min_age=$6, max_age=$7, fee=$8, status=$9
         WHERE id=$10 AND tenant_id=$11`,
        [academic_year || null, term || null, application_deadline || null,
         interview_required === 'on', docList, min_age ? parseInt(min_age) : null,
         max_age ? parseInt(max_age) : null, parseFloat(fee) || 0, status || 'open',
         existing.id, tid]
      );
    } else {
      await pool.query(
        `INSERT INTO admission_settings (tenant_id, academic_year, term, application_deadline,
         interview_required, required_documents, min_age, max_age, fee, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [tid, academic_year || null, term || null, application_deadline || null,
         interview_required === 'on', docList, min_age ? parseInt(min_age) : null,
         max_age ? parseInt(max_age) : null, parseFloat(fee) || 0, status || 'open']
      );
    }
    console.log('[Admissions] Settings updated by ' + user.email);
    res.redirect('/admissions/settings');
  }));

  // ============================================================
  // ROUTE 11: GET /admissions/reports — Reports & Analytics
  // ============================================================
  app.get('/admissions/reports', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    // Status distribution
    const statusDist = (await pool.query(
      'SELECT status, COUNT(*)::int as cnt FROM admission_applications WHERE tenant_id=$1 GROUP BY status ORDER BY cnt DESC', [tid]
    )).rows;

    // Class distribution
    const classDist = (await pool.query(
      "SELECT applying_class, COUNT(*)::int as cnt FROM admission_applications WHERE tenant_id=$1 AND status IN ('accepted','enrolled') AND applying_class IS NOT NULL GROUP BY applying_class ORDER BY cnt DESC LIMIT 10", [tid]
    )).rows;

    // Monthly trend
    const monthlyTrend = (await pool.query(
      "SELECT to_char(created_at, 'YYYY-MM') as month, COUNT(*)::int as cnt FROM admission_applications WHERE tenant_id=$1 GROUP BY month ORDER BY month DESC LIMIT 12", [tid]
    )).rows;

    // Conversion rates
    const totalApps = statusDist.reduce((s, r) => s + r.cnt, 0);
    const acceptedCount = (statusDist.find(r => r.status === 'accepted') || {}).cnt || 0;
    const enrolledCount = (statusDist.find(r => r.status === 'enrolled') || {}).cnt || 0;
    const rejectedCount = (statusDist.find(r => r.status === 'rejected') || {}).cnt || 0;
    const acceptanceRate = totalApps > 0 ? Math.round((acceptedCount + enrolledCount) / totalApps * 100) : 0;
    const enrollmentRate = (acceptedCount + enrolledCount) > 0 ? Math.round(enrolledCount / (acceptedCount + enrolledCount) * 100) : 0;

    const statusBars = statusDist.map(s => {
      const pct = totalApps > 0 ? Math.round(s.cnt / totalApps * 100) : 0;
      return '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">' +
        '<span style="min-width:80px;font-size:13px;font-weight:600;color:#1e293b">' + statusBadge(s.status) + '</span>' +
        '<div style="flex:1;background:#f1f5f9;border-radius:6px;height:22px;overflow:hidden;position:relative">' +
          '<div style="height:100%;width:' + pct + '%;background:#4f46e5;border-radius:6px;transition:.3s"></div>' +
          '<span style="position:absolute;right:8px;top:2px;font-size:11px;font-weight:700;color:#1e293b">' + s.cnt + '</span>' +
        '</div>' +
        '<span style="font-size:12px;font-weight:600;color:#64748b;min-width:36px;text-align:right">' + pct + '%</span>' +
      '</div>';
    }).join('');

    const classBars = classDist.map(c => {
      const maxCnt = classDist.length ? classDist[0].cnt : 1;
      const pct = Math.round(c.cnt / maxCnt * 100);
      return '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">' +
        '<span style="min-width:100px;font-size:12px;color:#475569">' + esc(c.applying_class || '—') + '</span>' +
        '<div style="flex:1;background:#f1f5f9;border-radius:6px;height:18px;overflow:hidden">' +
          '<div style="height:100%;width:' + pct + '%;background:#059669;border-radius:6px;transition:.3s"></div>' +
        '</div>' +
        '<span style="font-size:12px;font-weight:700;color:#1e293b">' + c.cnt + '</span>' +
      '</div>';
    }).join('');

    const monthlyBars = monthlyTrend.reverse().map(m => {
      const maxCnt = monthlyTrend.length ? Math.max(...monthlyTrend.map(x => x.cnt)) : 1;
      const pct = maxCnt > 0 ? Math.round(m.cnt / maxCnt * 100) : 0;
      return '<div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">' +
        '<span style="min-width:70px;font-size:11px;color:#64748b">' + esc(m.month) + '</span>' +
        '<div style="flex:1;background:#f1f5f9;border-radius:6px;height:18px;overflow:hidden">' +
          '<div style="height:100%;width:' + pct + '%;background:#8b5cf6;border-radius:6px;transition:.3s"></div>' +
        '</div>' +
        '<span style="font-size:11px;font-weight:700;color:#1e293b">' + m.cnt + '</span>' +
      '</div>';
    }).join('');

    const html = ADM_CSS + '<div style="max-width:1100px;margin:0 auto">' +
      nav('reports') +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">' +
        '<div><h1 style="font-size:24px;color:#1e293b">📈 Admission Reports</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Analytics and enrollment metrics</p></div>' +
      '</div>' +
      '<div class="stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-bottom:24px">' +
        '<div class="stat-card"><div class="stat-num" style="color:#4f46e5">' + totalApps + '</div><div class="muted" style="font-size:11px">Total Applications</div></div>' +
        '<div class="stat-card"><div class="stat-num" style="color:#16a34a">' + (acceptedCount + enrolledCount) + '</div><div class="muted" style="font-size:11px">Accepted/Enrolled</div></div>' +
        '<div class="stat-card"><div class="stat-num" style="color:#f59e0b">' + acceptanceRate + '%</div><div class="muted" style="font-size:11px">Acceptance Rate</div></div>' +
        '<div class="stat-card"><div class="stat-num" style="color:#8b5cf6">' + enrollmentRate + '%</div><div class="muted" style="font-size:11px">Enrollment Rate</div></div>' +
        '<div class="stat-card"><div class="stat-num" style="color:#dc2626">' + rejectedCount + '</div><div class="muted" style="font-size:11px">Rejected</div></div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px">' +
        '<div class="card" style="padding:20px"><h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">Status Distribution</h3>' + statusBars + '</div>' +
        '<div class="card" style="padding:20px"><h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">Enrollments by Class</h3>' + classBars + '</div>' +
      '</div>' +
      '<div class="card" style="padding:20px"><h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">Monthly Applications Trend</h3>' + monthlyBars + '</div>' +
    '</div>';
    res.send(renderPage('Admission Reports', html, user, req));
  }));

  // ============================================================
  // ROUTE 12: GET /admissions/api/stats — JSON API
  // ============================================================
  app.get('/admissions/api/stats', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const stats = (await pool.query(`
      SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE status='pending')::int as pending,
        COUNT(*) FILTER (WHERE status='reviewing')::int as reviewing,
        COUNT(*) FILTER (WHERE status='accepted')::int as accepted,
        COUNT(*) FILTER (WHERE status='rejected')::int as rejected,
        COUNT(*) FILTER (WHERE status='enrolled')::int as enrolled
      FROM admission_applications WHERE tenant_id=$1`, [tid]
    )).rows[0];

    const monthly = (await pool.query(
      "SELECT to_char(created_at, 'YYYY-MM') as month, COUNT(*)::int as cnt FROM admission_applications WHERE tenant_id=$1 GROUP BY month ORDER BY month DESC LIMIT 12", [tid]
    )).rows;

    res.json({ success: true, stats, monthly_trend: monthly });
  }));

  // ============================================================
  // END MODULE
  // ============================================================
};
