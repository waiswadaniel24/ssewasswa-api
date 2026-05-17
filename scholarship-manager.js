// ============================================================
// SCHOLARSHIP MANAGER MODULE — Multi-Tenant School Management SaaS
// Scholarships, bursaries, financial aid, applications,
// review workflow, disbursements, and reporting.
// Usage in server.js:
//   const scholarshipManager = require('./scholarship-manager');
//   scholarshipManager(app, db, pool, renderPage, esc);
// ============================================================

'use strict';

module.exports = function scholarshipManager(app, db, pool, renderPage, esc) {

  // ── inline fallbacks ──────────────────────────────────────
  if (!esc) esc = (s) => String(s === null || s === undefined ? '' : (typeof s === 'object' ? JSON.stringify(s) : s))
    .replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  const requireAuth = (req, res, next) => {
    if (!req.session || !req.session.user) return res.redirect('/login');
    next();
  };
  const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  // ── formatters ───────────────────────────────────────────
  const fmtMoney = (n) => 'UGX ' + Number(n || 0).toLocaleString();
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '\u2014';
  const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '\u2014';
  const today = () => new Date().toISOString().split('T')[0];
  const pct = (n, d) => d > 0 ? Math.round((n / d) * 100) : 0;

  // ── vulnerability score calculator ────────────────────────
  function calcVulnerability(gpa, attendance, income, familyMembers, scholarshipType) {
    let score = 0;
    // GPA factor (0-30): lower GPA = more need for merit-based, higher GPA = more merit
    const gpaVal = Number(gpa) || 2.0;
    if (scholarshipType === 'need' || scholarshipType === 'bursary') {
      score += Math.max(0, 30 - (gpaVal / 4.0) * 30);
    } else {
      score += (gpaVal / 4.0) * 30;
    }
    // Attendance factor (0-20): lower attendance = higher need
    const attVal = Number(attendance) || 75;
    score += Math.max(0, 20 - (attVal / 100) * 20);
    // Income factor (0-35): lower income = higher need
    const incVal = Number(income) || 0;
    if (incVal <= 200000) score += 35;
    else if (incVal <= 500000) score += 28;
    else if (incVal <= 1000000) score += 18;
    else if (incVal <= 2000000) score += 8;
    else score += 2;
    // Family size factor (0-15): larger family = higher need
    const famVal = Number(familyMembers) || 1;
    if (famVal >= 8) score += 15;
    else if (famVal >= 6) score += 12;
    else if (famVal >= 4) score += 8;
    else if (famVal >= 3) score += 4;
    else score += 0;
    return Math.min(100, Math.max(0, Math.round(score)));
  }

  // ── status badge helpers ──────────────────────────────────
  function scholarshipBadge(status) {
    const m = {
      open:       { bg: '#dcfce7', c: '#16a34a', l: 'Open' },
      closed:     { bg: '#fee2e2', c: '#dc2626', l: 'Closed' },
      paused:     { bg: '#fef3c7', c: '#d97706', l: 'Paused' },
      completed:  { bg: '#e0e7ff', c: '#4f46e5', l: 'Completed' }
    };
    const s = m[status] || { bg: '#f1f5f9', c: '#64748b', l: status || 'Unknown' };
    return '<span class="sch-badge" style="background:' + s.bg + ';color:' + s.c + '">' + s.l + '</span>';
  }

  function applicationBadge(status) {
    const m = {
      pending:       { bg: '#f1f5f9', c: '#64748b', l: 'Pending' },
      under_review:  { bg: '#dbeafe', c: '#2563eb', l: 'Under Review' },
      shortlisted:   { bg: '#fef3c7', c: '#d97706', l: 'Shortlisted' },
      approved:      { bg: '#dcfce7', c: '#16a34a', l: 'Approved' },
      rejected:      { bg: '#fee2e2', c: '#dc2626', l: 'Rejected' },
      disbursed:     { bg: '#e0e7ff', c: '#4f46e5', l: 'Disbursed' }
    };
    const s = m[status] || { bg: '#f1f5f9', c: '#64748b', l: status || 'Unknown' };
    return '<span class="sch-badge" style="background:' + s.bg + ';color:' + s.c + '">' + s.l + '</span>';
  }

  function disbursementBadge(status) {
    const m = {
      pending:    { bg: '#f1f5f9', c: '#64748b', l: 'Pending' },
      approved:   { bg: '#dbeafe', c: '#2563eb', l: 'Approved' },
      disbursed:  { bg: '#dcfce7', c: '#16a34a', l: 'Disbursed' },
      failed:     { bg: '#fee2e2', c: '#dc2626', l: 'Failed' }
    };
    const s = m[status] || { bg: '#f1f5f9', c: '#64748b', l: status || 'Unknown' };
    return '<span class="sch-badge" style="background:' + s.bg + ';color:' + s.c + '">' + s.l + '</span>';
  }

  function typeBadge(type) {
    const m = {
      merit:    { bg: '#e0e7ff', c: '#4f46e5', l: 'Merit' },
      need:     { bg: '#fef3c7', c: '#d97706', l: 'Need-Based' },
      sports:   { bg: '#dcfce7', c: '#16a34a', l: 'Sports' },
      arts:     { bg: '#fce7f3', c: '#db2777', l: 'Arts' },
      special:  { bg: '#e0e2ff', c: '#7c3aed', l: 'Special' },
      bursary:  { bg: '#ccfbf1', c: '#0d9488', l: 'Bursary' }
    };
    const s = m[type] || { bg: '#f1f5f9', c: '#64748b', l: type || 'General' };
    return '<span class="sch-badge" style="background:' + s.bg + ';color:' + s.c + '">' + s.l + '</span>';
  }

  function progressBar(current, total, width) {
    const p = pct(current, total);
    const color = p >= 80 ? '#dc2626' : p >= 60 ? '#d97706' : '#7c3aed';
    return '<div style="display:flex;align-items:center;gap:8px">' +
      '<div style="flex:1;background:#ede9fe;border-radius:6px;height:8px;overflow:hidden">' +
      '<div style="height:100%;width:' + p + '%;background:' + color + ';border-radius:6px;transition:width .3s"></div>' +
      '</div><span style="font-size:11px;font-weight:700;color:#64748b;min-width:36px;text-align:right">' + p + '%</span></div>';
  }

  // ── shared CSS ────────────────────────────────────────────
  const SCH_CSS = `<style>
    /* ── Navigation ── */
    .sch-nav{display:flex;gap:6px;margin-bottom:20px;flex-wrap:wrap}
    .sch-nav a{padding:8px 16px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#475569;background:#f1f5f9;transition:.15s}
    .sch-nav a:hover{background:#e2e8f0}.sch-nav a.active{background:#7c3aed;color:#fff}
    /* ── Buttons ── */
    .sch-btn{display:inline-flex;align-items:center;gap:6px;padding:9px 18px;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:.15s}
    .sch-btn:hover{opacity:.9;transform:translateY(-1px)}
    .sch-btn-primary{background:#7c3aed;color:#fff}
    .sch-btn-success{background:#059669;color:#fff}
    .sch-btn-danger{background:#fee2e2;color:#dc2626}
    .sch-btn-secondary{background:#f1f5f9;color:#475569}
    .sch-btn-warning{background:#fef3c7;color:#d97706}
    .sch-btn-sm{padding:5px 12px;font-size:11px;border-radius:8px}
    /* ── Cards ── */
    .sch-card{background:#fff;border-radius:14px;border:1px solid #f1f5f9;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.04)}
    .sch-card-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px}
    .sch-stat-card{background:#fff;border-radius:14px;border:1px solid #ede9fe;padding:20px;position:relative;overflow:hidden}
    .sch-stat-card::before{content:'';position:absolute;top:0;right:0;width:80px;height:80px;border-radius:50%;opacity:.08}
    .sch-stat-card.purple::before{background:#7c3aed}
    .sch-stat-card.green::before{background:#059669}
    .sch-stat-card.amber::before{background:#d97706}
    .sch-stat-card.red::before{background:#dc2626}
    .sch-stat-num{font-size:28px;font-weight:800;color:#1e293b;margin-bottom:4px}
    .sch-stat-label{font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.3px}
    /* ── Tables ── */
    .sch-table{width:100%;border-collapse:collapse;font-size:13px}
    .sch-table th{padding:11px 14px;text-align:left;border-bottom:2px solid #ede9fe;color:#7c3aed;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#faf5ff}
    .sch-table td{padding:10px 14px;border-bottom:1px solid #f5f3ff;color:#1e293b}
    .sch-table tr:nth-child(even){background:#fdfcff}
    .sch-table tr:hover{background:#ede9fe}
    /* ── Badges ── */
    .sch-badge{display:inline-block;padding:4px 12px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:.3px;white-space:nowrap}
    /* ── Forms ── */
    .sch-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
    .sch-form-grid .sch-full{grid-column:1/-1}
    .sch-label{display:block;font-size:12px;font-weight:600;color:#6b7280;margin-bottom:4px}
    .sch-input{width:100%;padding:10px 14px;border:2px solid #e5e7eb;border-radius:10px;font-size:13px;transition:.15s;background:#fff;box-sizing:border-box}
    .sch-input:focus{outline:none;border-color:#7c3aed;box-shadow:0 0 0 3px rgba(124,58,237,.1)}
    .sch-select{width:100%;padding:10px 14px;border:2px solid #e5e7eb;border-radius:10px;font-size:13px;background:#fff;cursor:pointer}
    .sch-select:focus{outline:none;border-color:#7c3aed}
    .sch-textarea{width:100%;padding:10px 14px;border:2px solid #e5e7eb;border-radius:10px;font-size:13px;resize:vertical;box-sizing:border-box}
    .sch-textarea:focus{outline:none;border-color:#7c3aed}
    .sch-checkbox{display:flex;align-items:center;gap:8px;padding:8px 0;font-size:13px;color:#374151;cursor:pointer}
    .sch-checkbox input{width:18px;height:18px;accent-color:#7c3aed}
    /* ── Filters ── */
    .sch-filter{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:end;background:#faf5ff;padding:14px;border-radius:12px;border:1px solid #ede9fe}
    .sch-filter label{display:block;font-size:12px;font-weight:600;color:#7c3aed;margin-bottom:4px}
    /* ── Utilization Chart ── */
    .sch-bar-chart{display:flex;flex-direction:column;gap:8px}
    .sch-bar-row{display:flex;align-items:center;gap:10px}
    .sch-bar-label{font-size:12px;color:#6b7280;min-width:120px;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .sch-bar-track{flex:1;background:#ede9fe;border-radius:6px;height:24px;overflow:hidden;position:relative}
    .sch-bar-fill{height:100%;border-radius:6px;transition:width .4s}
    .sch-bar-value{position:absolute;right:8px;top:3px;font-size:11px;font-weight:700;color:#1e293b}
    /* ── Coverage Tags ── */
    .sch-coverage-tag{display:inline-block;padding:3px 10px;border-radius:6px;font-size:11px;font-weight:600;background:#ede9fe;color:#7c3aed;margin:2px}
    /* ── Score Indicator ── */
    .sch-score{display:inline-flex;align-items:center;justify-content:center;width:42px;height:42px;border-radius:50%;font-size:13px;font-weight:800}
    .sch-score-high{background:#dcfce7;color:#16a34a}
    .sch-score-med{background:#fef3c7;color:#d97706}
    .sch-score-low{background:#fee2e2;color:#dc2626}
    /* ── Responsive ── */
    @media(max-width:768px){
      .sch-nav{flex-direction:column;gap:4px}
      .sch-nav a{padding:6px 12px;font-size:12px}
      .sch-form-grid{grid-template-columns:1fr}
      .sch-filter{flex-direction:column}
      .sch-stat-card{padding:14px}
      .sch-stat-num{font-size:22px}
    }
    /* ── Scrollbar ── */
    .sch-scroll{max-height:400px;overflow-y:auto}
    .sch-scroll::-webkit-scrollbar{width:6px}
    .sch-scroll::-webkit-scrollbar-track{background:#f5f3ff;border-radius:3px}
    .sch-scroll::-webkit-scrollbar-thumb{background:#a78bfa;border-radius:3px}
    .sch-scroll::-webkit-scrollbar-thumb:hover{background:#7c3aed}
  </style>`;

  // ── navigation helper ─────────────────────────────────────
  function nav(active) {
    const links = [
      ['/scholarships', 'Dashboard', '\uD83C\uDF93'],
      ['/scholarships/create', 'New Scholarship', '\u2795'],
      ['/scholarships/manage', 'Manage', '\uD83D\uDCCB'],
      ['/scholarships/applications', 'Applications', '\uD83D\uDCC4'],
      ['/scholarships/disbursements', 'Disbursements', '\uD83D\uDCB0'],
      ['/scholarships/reports', 'Reports', '\uD83D\uDCCA']
    ];
    return '<div class="sch-nav">' + links.map(function(l) {
      return '<a href="' + l[0] + '" class="' + (active === l[0] ? 'active' : '') + '">' + l[2] + ' ' + l[1] + '</a>';
    }).join('') + '</div>';
  }

  // ── form field helper ─────────────────────────────────────
  function field(label, name, type, val, opts) {
    var req = (opts && opts.required) ? ' required' : '';
    var ro = (opts && opts.readonly) ? ' readonly' : '';
    var ph = (opts && opts.placeholder) ? ' placeholder="' + esc(opts.placeholder) + '"' : '';
    var cls = opts && opts.cls ? ' ' + opts.cls : '';
    var extra = opts && opts.extra ? ' ' + opts.extra : '';
    var min = opts && opts.min !== undefined ? ' min="' + opts.min + '"' : '';
    var step = opts && opts.step ? ' step="' + opts.step + '"' : '';
    return '<div' + (opts && opts.full ? ' class="sch-full"' : '') + '><label class="sch-label">' + label + '</label>' +
      '<input type="' + type + '" name="' + name + '" value="' + esc(String(val || '')) + '"' + req + ro + ph + cls + extra + min + step +
      ' class="sch-input"></div>';
  }

  // ============================================================
  // DATABASE MIGRATIONS (async IIFE)
  // ============================================================
  (async () => {
    var client = await pool.connect().catch(function() { return null; });
    if (!client) { console.error('[ScholarshipManager] Cannot connect to DB for migrations'); return; }
    try {
      // ── Table 1: scholarships ──
      await client.query(`CREATE TABLE IF NOT EXISTS scholarships (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name VARCHAR(200) NOT NULL,
        description TEXT,
        scholarship_type VARCHAR(30) DEFAULT 'merit',
        funding_source VARCHAR(100),
        sponsor_name VARCHAR(200),
        sponsor_contact VARCHAR(200),
        total_fund_amount INTEGER DEFAULT 0,
        awarded_amount INTEGER DEFAULT 0,
        remaining_amount INTEGER DEFAULT 0,
        max_awards INTEGER DEFAULT 0,
        current_awards INTEGER DEFAULT 0,
        min_gpa DECIMAL(4,2) DEFAULT 2.0,
        min_attendance INTEGER DEFAULT 75,
        income_threshold INTEGER DEFAULT 0,
        covers_tuition BOOLEAN DEFAULT true,
        covers_feeding BOOLEAN DEFAULT false,
        covers_transport BOOLEAN DEFAULT false,
        covers_books BOOLEAN DEFAULT false,
        covers_uniform BOOLEAN DEFAULT false,
        application_deadline DATE,
        academic_year VARCHAR(20),
        status VARCHAR(20) DEFAULT 'open',
        created_by INTEGER,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      // ── Table 2: scholarship_applications ──
      await client.query(`CREATE TABLE IF NOT EXISTS scholarship_applications (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        scholarship_id INTEGER REFERENCES scholarships(id) ON DELETE CASCADE,
        student_id INTEGER,
        application_date DATE DEFAULT CURRENT_DATE,
        status VARCHAR(20) DEFAULT 'pending',
        gpa DECIMAL(4,2),
        attendance_rate INTEGER,
        household_income INTEGER,
        family_members INTEGER DEFAULT 0,
        vulnerability_score INTEGER DEFAULT 0,
        recommendation_letter TEXT,
        personal_statement TEXT,
        supporting_documents TEXT[] DEFAULT '{}',
        reviewer_id INTEGER,
        review_notes TEXT,
        reviewed_at TIMESTAMPTZ,
        approved_amount INTEGER DEFAULT 0,
        disbursement_status VARCHAR(20) DEFAULT 'pending',
        disbursed_amount INTEGER DEFAULT 0,
        disbursement_schedule JSONB DEFAULT '[]',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      // ── Table 3: scholarship_disbursements ──
      await client.query(`CREATE TABLE IF NOT EXISTS scholarship_disbursements (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        application_id INTEGER REFERENCES scholarship_applications(id) ON DELETE CASCADE,
        scholarship_id INTEGER REFERENCES scholarships(id) ON DELETE CASCADE,
        student_id INTEGER,
        amount INTEGER NOT NULL,
        disbursement_date DATE,
        term VARCHAR(30),
        academic_year VARCHAR(20),
        payment_method VARCHAR(30),
        payment_ref VARCHAR(100),
        recipient_name VARCHAR(200),
        recipient_phone VARCHAR(20),
        status VARCHAR(20) DEFAULT 'pending',
        notes TEXT,
        created_by INTEGER,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      // ── ALTER TABLE fallbacks: scholarships ──
      var schCols = [
        'tenant_id INTEGER NOT NULL DEFAULT 0', 'name VARCHAR(200)', 'description TEXT',
        'scholarship_type VARCHAR(30) DEFAULT \'merit\'', 'funding_source VARCHAR(100)',
        'sponsor_name VARCHAR(200)', 'sponsor_contact VARCHAR(200)',
        'total_fund_amount INTEGER DEFAULT 0', 'awarded_amount INTEGER DEFAULT 0',
        'remaining_amount INTEGER DEFAULT 0', 'max_awards INTEGER DEFAULT 0',
        'current_awards INTEGER DEFAULT 0', 'min_gpa DECIMAL(4,2) DEFAULT 2.0',
        'min_attendance INTEGER DEFAULT 75', 'income_threshold INTEGER DEFAULT 0',
        'covers_tuition BOOLEAN DEFAULT true', 'covers_feeding BOOLEAN DEFAULT false',
        'covers_transport BOOLEAN DEFAULT false', 'covers_books BOOLEAN DEFAULT false',
        'covers_uniform BOOLEAN DEFAULT false', 'application_deadline DATE',
        'academic_year VARCHAR(20)', 'status VARCHAR(20) DEFAULT \'open\'',
        'created_by INTEGER', 'created_at TIMESTAMPTZ DEFAULT NOW()', 'updated_at TIMESTAMPTZ DEFAULT NOW()'
      ];
      for (var i = 0; i < schCols.length; i++) {
        var colName = schCols[i].split(' ')[0];
        try { await client.query('ALTER TABLE IF EXISTS scholarships ADD COLUMN IF NOT EXISTS ' + colName + ' ' + schCols[i].substring(colName.length)); } catch(e) {}
      }

      // ── ALTER TABLE fallbacks: scholarship_applications ──
      var appCols = [
        'tenant_id INTEGER NOT NULL DEFAULT 0', 'scholarship_id INTEGER', 'student_id INTEGER',
        'application_date DATE DEFAULT CURRENT_DATE', 'status VARCHAR(20) DEFAULT \'pending\'',
        'gpa DECIMAL(4,2)', 'attendance_rate INTEGER', 'household_income INTEGER',
        'family_members INTEGER DEFAULT 0', 'vulnerability_score INTEGER DEFAULT 0',
        'recommendation_letter TEXT', 'personal_statement TEXT',
        'supporting_documents TEXT[] DEFAULT \'{}\'',
        'reviewer_id INTEGER', 'review_notes TEXT', 'reviewed_at TIMESTAMPTZ',
        'approved_amount INTEGER DEFAULT 0', 'disbursement_status VARCHAR(20) DEFAULT \'pending\'',
        'disbursed_amount INTEGER DEFAULT 0', 'disbursement_schedule JSONB DEFAULT \'[]\'',
        'created_at TIMESTAMPTZ DEFAULT NOW()'
      ];
      for (var j = 0; j < appCols.length; j++) {
        var appColName = appCols[j].split(' ')[0];
        try { await client.query('ALTER TABLE IF EXISTS scholarship_applications ADD COLUMN IF NOT EXISTS ' + appColName + ' ' + appCols[j].substring(appColName.length)); } catch(e) {}
      }

      // ── ALTER TABLE fallbacks: scholarship_disbursements ──
      var disCols = [
        'tenant_id INTEGER NOT NULL DEFAULT 0', 'application_id INTEGER', 'scholarship_id INTEGER',
        'student_id INTEGER', 'amount INTEGER DEFAULT 0', 'disbursement_date DATE',
        'term VARCHAR(30)', 'academic_year VARCHAR(20)', 'payment_method VARCHAR(30)',
        'payment_ref VARCHAR(100)', 'recipient_name VARCHAR(200)', 'recipient_phone VARCHAR(20)',
        'status VARCHAR(20) DEFAULT \'pending\'', 'notes TEXT', 'created_by INTEGER',
        'created_at TIMESTAMPTZ DEFAULT NOW()'
      ];
      for (var k = 0; k < disCols.length; k++) {
        var disColName = disCols[k].split(' ')[0];
        try { await client.query('ALTER TABLE IF EXISTS scholarship_disbursements ADD COLUMN IF NOT EXISTS ' + disColName + ' ' + disCols[k].substring(disColName.length)); } catch(e) {}
      }

      // ── Indexes ──
      await client.query('CREATE INDEX IF NOT EXISTS idx_scholarships_tenant ON scholarships(tenant_id)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_scholarships_status ON scholarships(tenant_id, status)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_scholarships_type ON scholarships(tenant_id, scholarship_type)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_scholarships_year ON scholarships(tenant_id, academic_year)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_scholarships_created ON scholarships(created_at DESC)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_sch_applications_tenant ON scholarship_applications(tenant_id)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_sch_applications_scholarship ON scholarship_applications(scholarship_id)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_sch_applications_student ON scholarship_applications(student_id)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_sch_applications_status ON scholarship_applications(tenant_id, status)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_sch_applications_vuln ON scholarship_applications(vulnerability_score DESC)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_sch_disbursements_tenant ON scholarship_disbursements(tenant_id)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_sch_disbursements_app ON scholarship_disbursements(application_id)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_sch_disbursements_scholarship ON scholarship_disbursements(scholarship_id)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_sch_disbursements_status ON scholarship_disbursements(tenant_id, status)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_sch_disbursements_date ON scholarship_disbursements(disbursement_date DESC)');

      console.log('[ScholarshipManager] Migrations applied successfully');
    } catch (e) {
      console.error('[ScholarshipManager] Migration error:', e.message);
    } finally {
      client.release();
    }
  })();

  // ============================================================
  // ROUTE 1: GET /scholarships — Dashboard
  // ============================================================
  app.get('/scholarships', requireAuth, ah(async (req, res) => {
    var user = req.session.user, tid = user.tenant_id;

    // Dashboard stats
    var stats = (await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM scholarships WHERE tenant_id=$1) as total_scholarships,
        (SELECT COUNT(*) FROM scholarships WHERE tenant_id=$1 AND status='open') as open_scholarships,
        (SELECT COUNT(*) FROM scholarship_applications WHERE tenant_id=$1 AND status IN ('pending','under_review')) as open_applications,
        (SELECT COUNT(*) FROM scholarship_applications WHERE tenant_id=$1 AND status='approved') as approved_applications,
        (SELECT COALESCE(SUM(awarded_amount), 0) FROM scholarships WHERE tenant_id=$1) as total_awarded,
        (SELECT COALESCE(SUM(remaining_amount), 0) FROM scholarships WHERE tenant_id=$1 AND status='open') as funds_remaining,
        (SELECT COALESCE(SUM(total_fund_amount), 0) FROM scholarships WHERE tenant_id=$1) as total_funds,
        (SELECT COALESCE(SUM(disbursed_amount), 0) FROM scholarship_disbursements WHERE tenant_id=$1 AND status='disbursed') as total_disbursed
    `, [tid])).rows[0];

    // Recent applications
    var recentApps = (await pool.query(`
      SELECT sa.*, s.first_name, s.last_name, s.admission_number, sc.name as scholarship_name
      FROM scholarship_applications sa
      LEFT JOIN students s ON s.id = sa.student_id
      LEFT JOIN scholarships sc ON sc.id = sa.scholarship_id
      WHERE sa.tenant_id=$1
      ORDER BY sa.created_at DESC LIMIT 8
    `, [tid])).rows;

    // Upcoming deadlines (next 30 days)
    var upcoming = (await pool.query(`
      SELECT sc.name, sc.application_deadline, sc.scholarship_type, sc.total_fund_amount,
        (SELECT COUNT(*) FROM scholarship_applications WHERE scholarship_id=sc.id) as app_count
      FROM scholarships sc
      WHERE sc.tenant_id=$1 AND sc.status='open' AND sc.application_deadline >= CURRENT_DATE
        AND sc.application_deadline <= CURRENT_DATE + INTERVAL '30 days'
      ORDER BY sc.application_deadline ASC LIMIT 5
    `, [tid])).rows;

    // Awards by type for mini chart
    var byType = (await pool.query(`
      SELECT scholarship_type, COUNT(*) as cnt, COALESCE(SUM(total_fund_amount), 0) as total_fund
      FROM scholarships WHERE tenant_id=$1
      GROUP BY scholarship_type ORDER BY cnt DESC
    `, [tid])).rows;

    var fundUtil = pct(Number(stats.total_awarded), Number(stats.total_funds));
    var maxTypeFund = Math.max.apply(null, byType.map(function(t) { return Number(t.total_fund) || 0; }).concat([1]));

    var appsHtml = recentApps.map(function(a) {
      var studentName = a.first_name ? esc(a.first_name + ' ' + a.last_name) : '<span style="color:#94a3b8">Student ID: ' + a.student_id + '</span>';
      return '<tr>' +
        '<td><strong>' + studentName + '</strong></td>' +
        '<td>' + esc(a.admission_number || '') + '</td>' +
        '<td><a href="/scholarships/' + a.scholarship_id + '" style="color:#7c3aed;text-decoration:none;font-weight:600">' + esc(a.scholarship_name || 'N/A') + '</a></td>' +
        '<td>' + applicationBadge(a.status) + '</td>' +
        '<td>' + fmtDate(a.created_at) + '</td>' +
        '</tr>';
    }).join('');

    var upcomingHtml = upcoming.map(function(u) {
      var daysLeft = Math.ceil((new Date(u.application_deadline) - new Date()) / 86400000);
      var urgency = daysLeft <= 7 ? 'color:#dc2626;font-weight:700' : daysLeft <= 14 ? 'color:#d97706;font-weight:600' : 'color:#16a34a';
      return '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:#fdfcff;border-radius:10px;border:1px solid #ede9fe">' +
        '<div><strong style="font-size:13px;color:#1e293b">' + esc(u.name) + '</strong>' +
        '<span style="margin-left:8px">' + typeBadge(u.scholarship_type) + '</span></div>' +
        '<div style="text-align:right"><div style="font-size:13px;font-weight:700;color:#1e293b">' + fmtDate(u.application_deadline) + '</div>' +
        '<div style="font-size:11px;' + urgency + '">' + daysLeft + ' day' + (daysLeft !== 1 ? 's' : '') + ' left &middot; ' + u.app_count + ' apps</div></div></div>';
    }).join('');

    var typeChartHtml = byType.map(function(t) {
      var barPct = pct(Number(t.total_fund), maxTypeFund);
      var colors = { merit: '#7c3aed', need: '#d97706', sports: '#059669', arts: '#db2777', special: '#6366f1', bursary: '#0d9488' };
      var color = colors[t.scholarship_type] || '#7c3aed';
      return '<div class="sch-bar-row">' +
        '<div class="sch-bar-label">' + typeBadge(t.scholarship_type) + '</div>' +
        '<div class="sch-bar-track"><div class="sch-bar-fill" style="width:' + barPct + '%;background:' + color + '"></div>' +
        '<span class="sch-bar-value">' + fmtMoney(t.total_fund) + ' (' + t.cnt + ')</span></div></div>';
    }).join('');

    var html = SCH_CSS + '<div style="max-width:1200px;margin:0 auto">' +
      nav('/scholarships') +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">' +
      '<div><h1 style="font-size:24px;color:#1e293b">\uD83C\uDF93 Scholarship Manager</h1>' +
      '<p style="font-size:13px;color:#94a3b8;margin-top:2px">Manage scholarships, applications, and financial aid</p></div>' +
      '<div style="display:flex;gap:8px">' +
      '<a href="/scholarships/create" class="sch-btn sch-btn-primary">\u2795 New Scholarship</a>' +
      '<a href="/scholarships/reports" class="sch-btn sch-btn-secondary">\uD83D\uDCCA Reports</a></div></div>' +

      // Stat cards
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin-bottom:20px">' +
      '<div class="sch-stat-card purple"><div class="sch-stat-num" style="color:#7c3aed">' + stats.total_scholarships + '</div>' +
      '<div class="sch-stat-label">Total Scholarships</div></div>' +
      '<div class="sch-stat-card green"><div class="sch-stat-num" style="color:#059669">' + stats.open_applications + '</div>' +
      '<div class="sch-stat-label">Open Applications</div></div>' +
      '<div class="sch-stat-card amber"><div class="sch-stat-num" style="color:#d97706">' + fmtMoney(stats.total_awarded) + '</div>' +
      '<div class="sch-stat-label">Total Awarded</div></div>' +
      '<div class="sch-stat-card red"><div class="sch-stat-num" style="color:#dc2626">' + fmtMoney(stats.funds_remaining) + '</div>' +
      '<div class="sch-stat-label">Funds Remaining</div></div></div>' +

      // Fund utilization bar
      '<div class="sch-card" style="margin-bottom:20px">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
      '<h3 style="font-size:15px;color:#1e293b;margin:0">Fund Utilization</h3>' +
      '<span style="font-size:14px;font-weight:700;color:#7c3aed">' + fundUtil + '% allocated</span></div>' +
      progressBar(Number(stats.total_awarded), Number(stats.total_funds), '100%') +
      '<div style="display:flex;justify-content:space-between;margin-top:8px;font-size:12px;color:#6b7280">' +
      '<span>Awarded: ' + fmtMoney(stats.total_awarded) + '</span>' +
      '<span>Remaining: ' + fmtMoney(stats.funds_remaining) + '</span>' +
      '<span>Disbursed: ' + fmtMoney(stats.total_disbursed) + '</span></div></div>' +

      // Main content grid
      '<div style="display:grid;grid-template-columns:2fr 1fr;gap:16px;margin-bottom:20px">' +
      // Recent applications
      '<div class="sch-card"><div class="sch-card-header">' +
      '<h3 style="font-size:15px;color:#1e293b;margin:0">Recent Applications</h3>' +
      '<a href="/scholarships/applications" style="font-size:13px;color:#7c3aed;text-decoration:none">View All \u2192</a></div>' +
      '<div style="overflow-x:auto"><table class="sch-table">' +
      '<thead><tr><th>Student</th><th>Adm#</th><th>Scholarship</th><th>Status</th><th>Date</th></tr></thead>' +
      '<tbody>' + (appsHtml || '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:30px">No applications yet</td></tr>') + '</tbody></table></div></div>' +

      // Upcoming deadlines
      '<div class="sch-card"><div class="sch-card-header">' +
      '<h3 style="font-size:15px;color:#1e293b;margin:0">Upcoming Deadlines</h3>' +
      '<a href="/scholarships/manage" style="font-size:13px;color:#7c3aed;text-decoration:none">All \u2192</a></div>' +
      '<div style="display:flex;flex-direction:column;gap:8px">' +
      (upcomingHtml || '<p style="text-align:center;color:#94a3b8;padding:20px;font-size:13px">No upcoming deadlines</p>') +
      '</div></div></div>' +

      // Awards by type chart
      '<div class="sch-card"><h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">Funds by Scholarship Type</h3>' +
      '<div class="sch-bar-chart">' + (typeChartHtml || '<p style="text-align:center;color:#94a3b8;padding:20px;font-size:13px">No data available</p>') + '</div></div>' +

      '</div>';

    res.send(renderPage('Scholarship Dashboard', html, user, req));
  }));

  // ============================================================
  // ROUTE 2: GET /scholarships/create — Create scholarship form
  // ============================================================
  app.get('/scholarships/create', requireAuth, ah(async (req, res) => {
    var user = req.session.user;

    var html = SCH_CSS + '<div style="max-width:900px;margin:0 auto">' +
      nav('/scholarships/create') +
      '<a href="/scholarships/manage" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">\u2190 Back to Scholarships</a>' +
      '<div class="sch-card" style="padding:24px">' +
      '<h2 style="color:#1e293b;margin:0 0 4px">\u2795 Create New Scholarship</h2>' +
      '<p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Define scholarship details, eligibility criteria, and funding information</p>' +
      '<form method="POST" action="/scholarships/create">' +

      // Section: Basic Info
      '<h3 style="font-size:14px;color:#7c3aed;margin:16px 0 12px;padding-bottom:8px;border-bottom:2px solid #ede9fe">\uD83D\uDCCB Basic Information</h3>' +
      '<div class="sch-form-grid">' +
      '<div class="sch-full">' + fieldLabel('Scholarship Name *') +
      '<input type="text" name="name" required placeholder="e.g., Excel Academic Award" class="sch-input"></div>' +
      '<div class="sch-full">' + fieldLabel('Description') +
      '<textarea name="description" rows="3" placeholder="Brief description of the scholarship purpose..." class="sch-textarea"></textarea></div>' +
      '<div>' + fieldLabel('Scholarship Type *') +
      '<select name="scholarship_type" required class="sch-select">' +
      '<option value="merit">Merit-Based</option><option value="need">Need-Based</option>' +
      '<option value="sports">Sports</option><option value="arts">Arts &amp; Culture</option>' +
      '<option value="special">Special Needs</option><option value="bursary">Bursary</option></select></div>' +
      '<div>' + fieldLabel('Academic Year') +
      '<input type="text" name="academic_year" placeholder="2025/2026" class="sch-input" value="' + new Date().getFullYear() + '/' + (new Date().getFullYear() + 1) + '"></div>' +
      '</div>' +

      // Section: Funding
      '<h3 style="font-size:14px;color:#7c3aed;margin:16px 0 12px;padding-bottom:8px;border-bottom:2px solid #ede9fe">\uD83D\uDCB0 Funding Information</h3>' +
      '<div class="sch-form-grid">' +
      '<div>' + fieldLabel('Funding Source') +
      '<select name="funding_source" class="sch-select">' +
      '<option value="internal">Internal (School)</option><option value="government">Government</option>' +
      '<option value="ngo">NGO</option><option value="private">Private Sponsor</option></select></div>' +
      '<div>' + fieldLabel('Total Fund Amount (UGX) *') +
      '<input type="number" name="total_fund_amount" required min="0" placeholder="5000000" class="sch-input"></div>' +
      '<div>' + fieldLabel('Maximum Awards') +
      '<input type="number" name="max_awards" min="0" placeholder="10" class="sch-input"></div>' +
      '<div>' + fieldLabel('Application Deadline') +
      '<input type="date" name="application_deadline" class="sch-input"></div>' +
      '<div>' + fieldLabel('Sponsor Name') +
      '<input type="text" name="sponsor_name" placeholder="Organization or individual" class="sch-input"></div>' +
      '<div>' + fieldLabel('Sponsor Contact') +
      '<input type="text" name="sponsor_contact" placeholder="Email or phone" class="sch-input"></div>' +
      '</div>' +

      // Section: Eligibility
      '<h3 style="font-size:14px;color:#7c3aed;margin:16px 0 12px;padding-bottom:8px;border-bottom:2px solid #ede9fe">\uD83D\uDD0D Eligibility Criteria</h3>' +
      '<div class="sch-form-grid">' +
      '<div>' + fieldLabel('Minimum GPA') +
      '<input type="number" name="min_gpa" step="0.01" min="0" max="4.0" value="2.0" class="sch-input"></div>' +
      '<div>' + fieldLabel('Minimum Attendance (%)') +
      '<input type="number" name="min_attendance" min="0" max="100" value="75" class="sch-input"></div>' +
      '<div>' + fieldLabel('Income Threshold (UGX)') +
      '<input type="number" name="income_threshold" min="0" placeholder="Household income ceiling" class="sch-input"></div>' +
      '</div>' +

      // Section: Coverage
      '<h3 style="font-size:14px;color:#7c3aed;margin:16px 0 12px;padding-bottom:8px;border-bottom:2px solid #ede9fe">\uD83C\uDFE2 Coverage Options</h3>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px">' +
      '<label class="sch-checkbox"><input type="checkbox" name="covers_tuition" value="true" checked> \uD83D\uDCDA Tuition Fees</label>' +
      '<label class="sch-checkbox"><input type="checkbox" name="covers_feeding" value="true"> \uD83C\uDF5C Feeding</label>' +
      '<label class="sch-checkbox"><input type="checkbox" name="covers_transport" value="true"> \uD83D\uDE97 Transport</label>' +
      '<label class="sch-checkbox"><input type="checkbox" name="covers_books" value="true"> \uD83D\uDCDA Books &amp; Materials</label>' +
      '<label class="sch-checkbox"><input type="checkbox" name="covers_uniform" value="true"> \uD83D\uDEE5\uFE0F Uniform</label>' +
      '</div>' +

      // Submit
      '<div style="display:flex;gap:10px;margin-top:24px;padding-top:16px;border-top:2px solid #ede9fe">' +
      '<button type="submit" class="sch-btn sch-btn-primary" style="padding:12px 28px">\uD83D\uDCCC Create Scholarship</button>' +
      '<a href="/scholarships/manage" class="sch-btn sch-btn-secondary" style="padding:12px 28px">Cancel</a></div>' +
      '</form></div></div>';

    res.send(renderPage('Create Scholarship', html, user, req));
  }));

  function fieldLabel(text) {
    return '<label class="sch-label">' + text + '</label>';
  }

  // ============================================================
  // ROUTE 3: POST /scholarships/create — Save new scholarship
  // ============================================================
  app.post('/scholarships/create', requireAuth, ah(async (req, res) => {
    var user = req.session.user, tid = user.tenant_id;
    var body = req.body;
    if (!body.name || !body.name.trim()) {
      req.session.flash = { type: 'error', msg: 'Scholarship name is required.' };
      return res.redirect('/scholarships/create');
    }

    var totalFund = parseInt(body.total_fund_amount) || 0;
    var maxAwards = parseInt(body.max_awards) || 0;

    var result = await pool.query(`
      INSERT INTO scholarships (
        tenant_id, name, description, scholarship_type, funding_source,
        sponsor_name, sponsor_contact, total_fund_amount, awarded_amount,
        remaining_amount, max_awards, current_awards, min_gpa, min_attendance,
        income_threshold, covers_tuition, covers_feeding, covers_transport,
        covers_books, covers_uniform, application_deadline, academic_year,
        status, created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,$9,$10,0,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,'open',$21)
      RETURNING id
    `, [
      tid, body.name.trim(), (body.description || '').trim() || null,
      body.scholarship_type || 'merit', body.funding_source || 'internal',
      (body.sponsor_name || '').trim() || null, (body.sponsor_contact || '').trim() || null,
      totalFund, totalFund, maxAwards,
      parseFloat(body.min_gpa) || 2.0, parseInt(body.min_attendance) || 75,
      parseInt(body.income_threshold) || 0,
      !!body.covers_tuition, !!body.covers_feeding, !!body.covers_transport,
      !!body.covers_books, !!body.covers_uniform,
      body.application_deadline || null, (body.academic_year || '').trim() || null,
      user.id
    ]);

    console.log('[ScholarshipManager] Created scholarship ID=' + result.rows[0].id + ' by user=' + user.id + ' tenant=' + tid);
    req.session.flash = { type: 'success', msg: 'Scholarship "' + body.name.trim() + '" created successfully.' };
    res.redirect('/scholarships/manage');
  }));

  // ============================================================
  // ROUTE 4: GET /scholarships/manage — List all scholarships
  // ============================================================
  app.get('/scholarships/manage', requireAuth, ah(async (req, res) => {
    var user = req.session.user, tid = user.tenant_id;
    var qType = req.query.type || '';
    var qStatus = req.query.status || '';
    var qYear = req.query.year || '';
    var qSearch = req.query.search || '';
    var page = Math.max(1, parseInt(req.query.page) || 1);
    var perPage = 20;
    var offset = (page - 1) * perPage;

    var where = ['s.tenant_id=$1'];
    var params = [tid];
    var pi = 2;

    if (qType) { where.push('s.scholarship_type=$' + pi); params.push(qType); pi++; }
    if (qStatus) { where.push('s.status=$' + pi); params.push(qStatus); pi++; }
    if (qYear) { where.push('s.academic_year=$' + pi); params.push(qYear); pi++; }
    if (qSearch) {
      where.push('(s.name ILIKE $' + pi + ' OR s.sponsor_name ILIKE $' + pi + ' OR s.description ILIKE $' + pi + ')');
      params.push('%' + qSearch + '%'); pi++;
    }

    var countResult = await pool.query(
      'SELECT COUNT(*) as total FROM scholarships s WHERE ' + where.join(' AND '), params
    );
    var totalScholarships = parseInt(countResult.rows[0].total);
    var totalPages = Math.ceil(totalScholarships / perPage);

    var scholarships = (await pool.query(
      'SELECT s.*, ' +
      '(SELECT COUNT(*) FROM scholarship_applications WHERE scholarship_id=s.id) as application_count, ' +
      '(SELECT COUNT(*) FROM scholarship_applications WHERE scholarship_id=s.id AND status=\'approved\') as approved_count ' +
      'FROM scholarships s WHERE ' + where.join(' AND ') +
      ' ORDER BY s.created_at DESC LIMIT $' + pi + ' OFFSET $' + (pi + 1),
      params.concat([perPage, offset])
    )).rows;

    // Academic years for filter
    var years = (await pool.query(
      'SELECT DISTINCT academic_year FROM scholarships WHERE tenant_id=$1 AND academic_year IS NOT NULL ORDER BY academic_year DESC',
      [tid]
    )).rows;

    var rowsHtml = scholarships.map(function(s) {
      var fundPct = pct(Number(s.awarded_amount), Math.max(Number(s.total_fund_amount), 1));
      var awardPct = s.max_awards > 0 ? pct(Number(s.current_awards), s.max_awards) : 0;
      var deadlineDate = s.application_deadline ? new Date(s.application_deadline) : null;
      var isExpired = deadlineDate && deadlineDate < new Date();
      return '<tr>' +
        '<td><a href="/scholarships/' + s.id + '" style="color:#7c3aed;text-decoration:none;font-weight:600">' + esc(s.name) + '</a>' +
        '<br><span style="font-size:11px;color:#94a3b8">' + esc(s.description || '').substring(0, 60) + '</span></td>' +
        '<td>' + typeBadge(s.scholarship_type) + '</td>' +
        '<td>' + scholarshipBadge(s.status) + '</td>' +
        '<td style="font-weight:700;color:#1e293b">' + fmtMoney(s.total_fund_amount) +
        '<br><span style="font-size:11px;color:#6b7280">Awarded: ' + fmtMoney(s.awarded_amount) + '</span></td>' +
        '<td>' + progressBar(Number(s.awarded_amount), Number(s.total_fund_amount)) + '</td>' +
        '<td style="text-align:center"><strong>' + s.application_count + '</strong>' +
        '<br><span style="font-size:11px;color:#6b7280">' + s.approved_count + ' approved</span></td>' +
        '<td>' + (s.application_deadline ?
          (isExpired ? '<span style="color:#dc2626;font-weight:600;text-decoration:line-through">' + fmtDate(s.application_deadline) + '</span>' : fmtDate(s.application_deadline)) :
          '\u2014') + '</td>' +
        '<td><a href="/scholarships/' + s.id + '" class="sch-btn sch-btn-primary sch-btn-sm">View</a></td>' +
        '</tr>';
    }).join('');

    // Pagination
    var paginationHtml = '';
    if (totalPages > 1) {
      paginationHtml = '<div style="display:flex;justify-content:center;gap:6px;margin-top:16px">';
      for (var p = 1; p <= totalPages; p++) {
        if (p === page) {
          paginationHtml += '<span class="sch-btn sch-btn-primary sch-btn-sm" style="cursor:default">' + p + '</span>';
        } else {
          var pageUrl = '/scholarships/manage?page=' + p;
          if (qType) pageUrl += '&type=' + qType;
          if (qStatus) pageUrl += '&status=' + qStatus;
          if (qYear) pageUrl += '&year=' + qYear;
          if (qSearch) pageUrl += '&search=' + encodeURIComponent(qSearch);
          paginationHtml += '<a href="' + pageUrl + '" class="sch-btn sch-btn-secondary sch-btn-sm">' + p + '</a>';
        }
      }
      paginationHtml += '</div>';
    }

    var html = SCH_CSS + '<div style="max-width:1200px;margin:0 auto">' +
      nav('/scholarships/manage') +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">' +
      '<div><h1 style="font-size:24px;color:#1e293b">\uD83D\uDCCB Manage Scholarships</h1>' +
      '<p style="font-size:13px;color:#94a3b8;margin-top:2px">' + totalScholarships + ' scholarship' + (totalScholarships !== 1 ? 's' : '') + ' found</p></div>' +
      '<a href="/scholarships/create" class="sch-btn sch-btn-primary">\u2795 New Scholarship</a></div>' +

      // Filters
      '<div class="sch-filter">' +
      '<div><label>Search</label><input type="text" name="search" value="' + esc(qSearch) + '" placeholder="Name, sponsor..." class="sch-input" style="width:180px" onchange="location.href=\'/scholarships/manage?search=\'+this.value"></div>' +
      '<div><label>Type</label><select onchange="location.href=\'/scholarships/manage?type=\'+this.value" class="sch-select" style="width:140px">' +
      '<option value="">All Types</option>' +
      '<option value="merit"' + (qType === 'merit' ? ' selected' : '') + '>Merit</option>' +
      '<option value="need"' + (qType === 'need' ? ' selected' : '') + '>Need-Based</option>' +
      '<option value="sports"' + (qType === 'sports' ? ' selected' : '') + '>Sports</option>' +
      '<option value="arts"' + (qType === 'arts' ? ' selected' : '') + '>Arts</option>' +
      '<option value="special"' + (qType === 'special' ? ' selected' : '') + '>Special</option>' +
      '<option value="bursary"' + (qType === 'bursary' ? ' selected' : '') + '>Bursary</option></select></div>' +
      '<div><label>Status</label><select onchange="location.href=\'/scholarships/manage?status=\'+this.value" class="sch-select" style="width:130px">' +
      '<option value="">All Status</option>' +
      '<option value="open"' + (qStatus === 'open' ? ' selected' : '') + '>Open</option>' +
      '<option value="closed"' + (qStatus === 'closed' ? ' selected' : '') + '>Closed</option>' +
      '<option value="paused"' + (qStatus === 'paused' ? ' selected' : '') + '>Paused</option>' +
      '<option value="completed"' + (qStatus === 'completed' ? ' selected' : '') + '>Completed</option></select></div>' +
      '<div><label>Year</label><select onchange="location.href=\'/scholarships/manage?year=\'+this.value" class="sch-select" style="width:140px">' +
      '<option value="">All Years</option>' +
      years.map(function(y) { return '<option value="' + esc(y.academic_year) + '"' + (qYear === y.academic_year ? ' selected' : '') + '>' + esc(y.academic_year) + '</option>'; }).join('') +
      '</select></div></div>' +

      // Table
      '<div class="sch-card" style="padding:0;overflow:hidden">' +
      '<div style="overflow-x:auto"><table class="sch-table">' +
      '<thead><tr><th>Scholarship</th><th>Type</th><th>Status</th><th>Funding</th><th>Utilization</th><th>Applications</th><th>Deadline</th><th>Action</th></tr></thead>' +
      '<tbody>' + (rowsHtml || '<tr><td colspan="8" style="text-align:center;color:#94a3b8;padding:40px">No scholarships found. <a href="/scholarships/create" style="color:#7c3aed">Create one</a></td></tr>') + '</tbody></table></div></div>' +
      paginationHtml +
      '</div>';

    res.send(renderPage('Manage Scholarships', html, user, req));
  }));

  // ============================================================
  // ROUTE 5: GET /scholarships/:id — Scholarship detail view
  // ============================================================
  app.get('/scholarships/:id', requireAuth, ah(async (req, res) => {
    var user = req.session.user, tid = user.tenant_id, id = req.params.id;

    var scholarship = (await pool.query(
      'SELECT * FROM scholarships WHERE id=$1 AND tenant_id=$2', [id, tid]
    )).rows[0];
    if (!scholarship) {
      return res.send(renderPage('Not Found', '<div class="sch-card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">Scholarship not found</h2><a href="/scholarships/manage" class="sch-btn sch-btn-primary" style="margin-top:12px">Back to Scholarships</a></div>', user, req));
    }

    // Applications for this scholarship
    var applications = (await pool.query(`
      SELECT sa.*, s.first_name, s.last_name, s.admission_number, c.name as class_name, s.gender
      FROM scholarship_applications sa
      LEFT JOIN students s ON s.id = sa.student_id
      LEFT JOIN classes c ON c.id = s.class_id
      WHERE sa.tenant_id=$1 AND sa.scholarship_id=$2
      ORDER BY sa.created_at DESC
    `, [tid, id])).rows;

    // Disbursement history
    var disbursements = (await pool.query(`
      SELECT sd.*, s.first_name, s.last_name, s.admission_number
      FROM scholarship_disbursements sd
      LEFT JOIN students s ON s.id = sd.student_id
      WHERE sd.tenant_id=$1 AND sd.scholarship_id=$2
      ORDER BY sd.created_at DESC LIMIT 20
    `, [tid, id])).rows;

    // Status distribution
    var statusCounts = {};
    applications.forEach(function(a) {
      statusCounts[a.status] = (statusCounts[a.status] || 0) + 1;
    });

    var fundPct = pct(Number(scholarship.awarded_amount), Math.max(Number(scholarship.total_fund_amount), 1));
    var awardPct = scholarship.max_awards > 0 ? pct(Number(scholarship.current_awards), scholarship.max_awards) : 0;
    var remaining = Number(scholarship.total_fund_amount) - Number(scholarship.awarded_amount);

    // Coverage tags
    var coverageItems = [];
    if (scholarship.covers_tuition) coverageItems.push('\uD83D\uDCDA Tuition');
    if (scholarship.covers_feeding) coverageItems.push('\uD83C\uDF5C Feeding');
    if (scholarship.covers_transport) coverageItems.push('\uD83D\uDE97 Transport');
    if (scholarship.covers_books) coverageItems.push('\uD83D\uDCDA Books');
    if (scholarship.covers_uniform) coverageItems.push('\uD83D\uDEE5\uFE0F Uniform');
    var coverageHtml = coverageItems.length > 0 ?
      coverageItems.map(function(c) { return '<span class="sch-coverage-tag">' + c + '</span>'; }).join('') :
      '<span style="color:#94a3b8;font-size:13px">Not specified</span>';

    // Status distribution summary
    var statusSummaryHtml = Object.keys(statusCounts).map(function(st) {
      return '<div style="display:flex;align-items:center;gap:8px;padding:6px 0">' +
        '<span style="min-width:120px">' + applicationBadge(st) + '</span>' +
        '<span style="font-weight:700;color:#1e293b">' + statusCounts[st] + '</span></div>';
    }).join('');

    // Applications table
    var appsHtml = applications.map(function(a) {
      var name = a.first_name ? esc(a.first_name + ' ' + a.last_name) : '<span style="color:#94a3b8">Student #' + a.student_id + '</span>';
      var scoreClass = a.vulnerability_score >= 70 ? 'sch-score-high' : a.vulnerability_score >= 40 ? 'sch-score-med' : 'sch-score-low';
      return '<tr>' +
        '<td><strong>' + name + '</strong><br><span style="font-size:11px;color:#94a3b8">' + esc(a.admission_number || '') + ' &middot; ' + esc(a.class_name || '') + '</span></td>' +
        '<td style="text-align:center"><div class="sch-score ' + scoreClass + '">' + (a.vulnerability_score || 0) + '</div></td>' +
        '<td>' + (a.gpa ? Number(a.gpa).toFixed(2) : '\u2014') + '<br><span style="font-size:11px;color:#94a3b8">Att: ' + (a.attendance_rate || 0) + '%</span></td>' +
        '<td>' + applicationBadge(a.status) + '</td>' +
        '<td style="font-weight:700;color:#7c3aed">' + fmtMoney(a.approved_amount) + '</td>' +
        '<td>' + fmtDate(a.created_at) + '</td>' +
        '<td>' +
        (a.status === 'pending' || a.status === 'under_review' || a.status === 'shortlisted' ?
          '<a href="/scholarships/applications/' + a.id + '/review" class="sch-btn sch-btn-primary sch-btn-sm">Review</a>' : '') +
        '</td></tr>';
    }).join('');

    // Disbursements table
    var disbHtml = disbursements.map(function(d) {
      var name = d.first_name ? esc(d.first_name + ' ' + d.last_name) : 'Student #' + d.student_id;
      return '<tr>' +
        '<td><strong>' + name + '</strong></td>' +
        '<td style="font-weight:700;color:#059669">' + fmtMoney(d.amount) + '</td>' +
        '<td>' + esc(d.term || '') + '</td>' +
        '<td>' + esc(d.payment_method || '') + '</td>' +
        '<td>' + esc(d.payment_ref || '') + '</td>' +
        '<td>' + disbursementBadge(d.status) + '</td>' +
        '<td>' + fmtDate(d.disbursement_date) + '</td></tr>';
    }).join('');

    var html = SCH_CSS + '<div style="max-width:1200px;margin:0 auto">' +
      nav('/scholarships/manage') +
      '<a href="/scholarships/manage" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">\u2190 Back to Scholarships</a>' +

      // Header
      '<div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">' +
      '<div><h1 style="font-size:24px;color:#1e293b">' + esc(scholarship.name) + '</h1>' +
      '<div style="display:flex;gap:8px;margin-top:6px">' + typeBadge(scholarship.scholarship_type) + scholarshipBadge(scholarship.status) +
      '<span class="sch-badge" style="background:#f1f5f9;color:#64748b">' + esc(scholarship.academic_year || '') + '</span></div></div></div>' +

      // Info cards row
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin-bottom:20px">' +
      '<div class="sch-stat-card purple"><div class="sch-stat-num" style="color:#7c3aed">' + fmtMoney(scholarship.total_fund_amount) + '</div>' +
      '<div class="sch-stat-label">Total Fund</div></div>' +
      '<div class="sch-stat-card green"><div class="sch-stat-num" style="color:#059669">' + fmtMoney(scholarship.awarded_amount) + '</div>' +
      '<div class="sch-stat-label">Awarded (' + fundPct + '%)</div></div>' +
      '<div class="sch-stat-card amber"><div class="sch-stat-num" style="color:#d97706">' + fmtMoney(remaining) + '</div>' +
      '<div class="sch-stat-label">Remaining</div></div>' +
      '<div class="sch-stat-card red"><div class="sch-stat-num" style="color:#1e293b">' + applications.length + '</div>' +
      '<div class="sch-stat-label">Total Applications</div></div></div>' +

      // Fund utilization
      '<div class="sch-card" style="margin-bottom:20px">' +
      '<h3 style="font-size:15px;color:#1e293b;margin:0 0 12px">Fund Utilization</h3>' +
      progressBar(Number(scholarship.awarded_amount), Number(scholarship.total_fund_amount)) +
      '</div>' +

      // Details grid
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">' +
      // Left: Details
      '<div class="sch-card"><h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">Scholarship Details</h3>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:13px">' +
      '<div><span class="sch-stat-label">Funding Source</span><div style="font-weight:600;color:#1e293b;margin-top:2px">' + esc(scholarship.funding_source || 'Internal') + '</div></div>' +
      '<div><span class="sch-stat-label">Sponsor</span><div style="font-weight:600;color:#1e293b;margin-top:2px">' + esc(scholarship.sponsor_name || '\u2014') + '</div></div>' +
      '<div><span class="sch-stat-label">Max Awards</span><div style="font-weight:600;color:#1e293b;margin-top:2px">' + (scholarship.max_awards || 'Unlimited') + ' (' + scholarship.current_awards + ' given)</div></div>' +
      '<div><span class="sch-stat-label">Deadline</span><div style="font-weight:600;color:#1e293b;margin-top:2px">' + fmtDate(scholarship.application_deadline) + '</div></div>' +
      '<div><span class="sch-stat-label">Min GPA</span><div style="font-weight:600;color:#1e293b;margin-top:2px">' + Number(scholarship.min_gpa).toFixed(2) + '</div></div>' +
      '<div><span class="sch-stat-label">Min Attendance</span><div style="font-weight:600;color:#1e293b;margin-top:2px">' + scholarship.min_attendance + '%</div></div>' +
      '<div><span class="sch-stat-label">Income Threshold</span><div style="font-weight:600;color:#1e293b;margin-top:2px">' + (scholarship.income_threshold ? fmtMoney(scholarship.income_threshold) : 'None') + '</div></div>' +
      '<div class="sch-full"><span class="sch-stat-label">Coverage</span><div style="margin-top:6px">' + coverageHtml + '</div></div>' +
      '</div></div>' +

      // Right: Status distribution
      '<div class="sch-card"><h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">Application Status</h3>' +
      statusSummaryHtml +
      '<div style="margin-top:14px;padding-top:14px;border-top:1px solid #ede9fe;font-size:13px">' +
      '<p>' + esc(scholarship.description || 'No description provided.') + '</p></div></div></div>' +

      // Applications table
      '<div class="sch-card" style="padding:0;overflow:hidden;margin-bottom:20px">' +
      '<div class="sch-card-header" style="padding:16px 20px;margin-bottom:0">' +
      '<h3 style="font-size:15px;color:#1e293b;margin:0">Applications (' + applications.length + ')</h3></div>' +
      '<div style="overflow-x:auto"><table class="sch-table">' +
      '<thead><tr><th>Student</th><th>Score</th><th>GPA / Att</th><th>Status</th><th>Amount</th><th>Applied</th><th>Action</th></tr></thead>' +
      '<tbody>' + (appsHtml || '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:40px">No applications for this scholarship</td></tr>') + '</tbody></table></div></div>' +

      // Disbursement history
      '<div class="sch-card" style="padding:0;overflow:hidden">' +
      '<div class="sch-card-header" style="padding:16px 20px;margin-bottom:0">' +
      '<h3 style="font-size:15px;color:#1e293b;margin:0">Disbursement History (' + disbursements.length + ')</h3></div>' +
      '<div style="overflow-x:auto"><table class="sch-table">' +
      '<thead><tr><th>Student</th><th>Amount</th><th>Term</th><th>Method</th><th>Reference</th><th>Status</th><th>Date</th></tr></thead>' +
      '<tbody>' + (disbHtml || '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:40px">No disbursements yet</td></tr>') + '</tbody></table></div></div>' +

      '</div>';

    res.send(renderPage('Scholarship: ' + scholarship.name, html, user, req));
  }));

  // ============================================================
  // ROUTE 6: GET /scholarships/applications — All applications
  // ============================================================
  app.get('/scholarships/applications', requireAuth, ah(async (req, res) => {
    var user = req.session.user, tid = user.tenant_id;
    var qStatus = req.query.status || '';
    var qScholarship = req.query.scholarship_id || '';
    var qSearch = req.query.search || '';
    var page = Math.max(1, parseInt(req.query.page) || 1);
    var perPage = 25;
    var offset = (page - 1) * perPage;

    var where = ['sa.tenant_id=$1'];
    var params = [tid];
    var pi = 2;

    if (qStatus) { where.push('sa.status=$' + pi); params.push(qStatus); pi++; }
    if (qScholarship) { where.push('sa.scholarship_id=$' + pi); params.push(qScholarship); pi++; }
    if (qSearch) {
      where.push('(s.first_name ILIKE $' + pi + ' OR s.last_name ILIKE $' + pi + ' OR s.admission_number ILIKE $' + pi + ')');
      params.push('%' + qSearch + '%'); pi++;
    }

    var countResult = await pool.query(
      'SELECT COUNT(*) as total FROM scholarship_applications sa LEFT JOIN students s ON s.id=sa.student_id WHERE ' + where.join(' AND '), params
    );
    var totalApps = parseInt(countResult.rows[0].total);
    var totalPages = Math.ceil(totalApps / perPage);

    var applications = (await pool.query(`
      SELECT sa.*, s.first_name, s.last_name, s.admission_number, s.gender, c.name as class_name,
        sc.name as scholarship_name, sc.scholarship_type, u.name as reviewer_name
      FROM scholarship_applications sa
      LEFT JOIN students s ON s.id = sa.student_id
      LEFT JOIN classes c ON c.id = s.class_id
      LEFT JOIN scholarships sc ON sc.id = sa.scholarship_id
      LEFT JOIN users u ON u.id = sa.reviewer_id
      WHERE ${where.join(' AND ')}
      ORDER BY sa.created_at DESC LIMIT $${pi} OFFSET $${pi + 1}
    `, params.concat([perPage, offset]))).rows;

    var scholarships = (await pool.query(
      'SELECT id, name FROM scholarships WHERE tenant_id=$1 ORDER BY name', [tid]
    )).rows;

    // Status counts for quick stats
    var allStatuses = (await pool.query(`
      SELECT status, COUNT(*) as cnt FROM scholarship_applications WHERE tenant_id=$1 GROUP BY status
    `, [tid])).rows;
    var statusStats = {};
    allStatuses.forEach(function(s) { statusStats[s.status] = s.cnt; });

    var rowsHtml = applications.map(function(a) {
      var name = a.first_name ? esc(a.first_name + ' ' + a.last_name) : '<span style="color:#94a3b8">Student #' + a.student_id + '</span>';
      var scoreClass = a.vulnerability_score >= 70 ? 'sch-score-high' : a.vulnerability_score >= 40 ? 'sch-score-med' : 'sch-score-low';
      var canReview = a.status === 'pending' || a.status === 'under_review' || a.status === 'shortlisted';
      return '<tr' + (canReview ? ' style="background:#fdfcff"' : '') + '>' +
        '<td><input type="checkbox" name="app_ids" value="' + a.id + '" class="sch-bulk-check" style="width:16px;height:16px;accent-color:#7c3aed"></td>' +
        '<td><strong>' + name + '</strong><br><span style="font-size:11px;color:#94a3b8">' + esc(a.admission_number || '') + ' &middot; ' + esc(a.class_name || '') + '</span></td>' +
        '<td><a href="/scholarships/' + a.scholarship_id + '" style="color:#7c3aed;text-decoration:none;font-size:12px">' + esc(a.scholarship_name || 'N/A') + '</a></td>' +
        '<td style="text-align:center"><div class="sch-score ' + scoreClass + '">' + (a.vulnerability_score || 0) + '</div></td>' +
        '<td>' + (a.gpa ? Number(a.gpa).toFixed(2) : '\u2014') + '</td>' +
        '<td>' + applicationBadge(a.status) + '</td>' +
        '<td style="font-weight:700">' + fmtMoney(a.approved_amount) + '</td>' +
        '<td>' + fmtDate(a.created_at) + '</td>' +
        '<td>' +
        (canReview ? '<a href="/scholarships/applications/' + a.id + '/review" class="sch-btn sch-btn-primary sch-btn-sm">Review</a>' : '') +
        '</td></tr>';
    }).join('');

    var html = SCH_CSS + '<div style="max-width:1200px;margin:0 auto">' +
      nav('/scholarships/applications') +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">' +
      '<div><h1 style="font-size:24px;color:#1e293b">\uD83D\uDCC4 Scholarship Applications</h1>' +
      '<p style="font-size:13px;color:#94a3b8;margin-top:2px">' + totalApps + ' applications total</p></div></div>' +

      // Quick status overview
      '<div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">' +
      '<a href="/scholarships/applications" class="sch-btn sch-btn-secondary sch-btn-sm">All (' + totalApps + ')</a>' +
      '<a href="/scholarships/applications?status=pending" class="sch-btn ' + (qStatus === 'pending' ? 'sch-btn-warning' : 'sch-btn-secondary') + ' sch-btn-sm">Pending (' + (statusStats.pending || 0) + ')</a>' +
      '<a href="/scholarships/applications?status=under_review" class="sch-btn ' + (qStatus === 'under_review' ? 'sch-btn-primary' : 'sch-btn-secondary') + ' sch-btn-sm">Under Review (' + (statusStats.under_review || 0) + ')</a>' +
      '<a href="/scholarships/applications?status=shortlisted" class="sch-btn ' + (qStatus === 'shortlisted' ? 'sch-btn-warning' : 'sch-btn-secondary') + ' sch-btn-sm">Shortlisted (' + (statusStats.shortlisted || 0) + ')</a>' +
      '<a href="/scholarships/applications?status=approved" class="sch-btn ' + (qStatus === 'approved' ? 'sch-btn-success' : 'sch-btn-secondary') + ' sch-btn-sm">Approved (' + (statusStats.approved || 0) + ')</a>' +
      '<a href="/scholarships/applications?status=rejected" class="sch-btn ' + (qStatus === 'rejected' ? 'sch-btn-danger' : 'sch-btn-secondary') + ' sch-btn-sm">Rejected (' + (statusStats.rejected || 0) + ')</a></div>' +

      // Filters
      '<div class="sch-filter">' +
      '<div><label>Search</label><input type="text" value="' + esc(qSearch) + '" placeholder="Student name or adm#..." class="sch-input" style="width:200px" onchange="location.href=\'/scholarships/applications?search=\'+this.value"></div>' +
      '<div><label>Scholarship</label><select onchange="location.href=\'/scholarships/applications?scholarship_id=\'+this.value" class="sch-select" style="width:200px">' +
      '<option value="">All Scholarships</option>' +
      scholarships.map(function(s) { return '<option value="' + s.id + '"' + (qScholarship == s.id ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join('') +
      '</select></div>' +
      '<div><label>Status</label><select onchange="location.href=\'/scholarships/applications?status=\'+this.value" class="sch-select" style="width:140px">' +
      '<option value="">All Status</option>' +
      '<option value="pending"' + (qStatus === 'pending' ? ' selected' : '') + '>Pending</option>' +
      '<option value="under_review"' + (qStatus === 'under_review' ? ' selected' : '') + '>Under Review</option>' +
      '<option value="shortlisted"' + (qStatus === 'shortlisted' ? ' selected' : '') + '>Shortlisted</option>' +
      '<option value="approved"' + (qStatus === 'approved' ? ' selected' : '') + '>Approved</option>' +
      '<option value="rejected"' + (qStatus === 'rejected' ? ' selected' : '') + '>Rejected</option>' +
      '<option value="disbursed"' + (qStatus === 'disbursed' ? ' selected' : '') + '>Disbursed</option></select></div></div>' +

      // Bulk actions
      '<div style="display:flex;gap:8px;margin-bottom:12px;align-items:center">' +
      '<label style="font-size:12px;color:#6b7280">Bulk Actions:</label>' +
      '<button onclick="bulkAction(\'approve\')" class="sch-btn sch-btn-success sch-btn-sm">\u2705 Approve Selected</button>' +
      '<button onclick="bulkAction(\'reject\')" class="sch-btn sch-btn-danger sch-btn-sm">\u274C Reject Selected</button></div>' +

      // Table
      '<div class="sch-card" style="padding:0;overflow:hidden">' +
      '<div class="sch-scroll"><table class="sch-table">' +
      '<thead style="position:sticky;top:0"><tr><th><input type="checkbox" id="sch-select-all" style="width:16px;height:16px;accent-color:#7c3aed"></th><th>Student</th><th>Scholarship</th><th>Score</th><th>GPA</th><th>Status</th><th>Amount</th><th>Applied</th><th>Action</th></tr></thead>' +
      '<tbody>' + (rowsHtml || '<tr><td colspan="9" style="text-align:center;color:#94a3b8;padding:40px">No applications found</td></tr>') + '</tbody></table></div></div>' +

      '</div>' +
      '<script>' +
      'document.getElementById("sch-select-all").addEventListener("change",function(){document.querySelectorAll(".sch-bulk-check").forEach(function(c){c.checked=this.checked}.bind(this))});' +
      'function bulkAction(action){var ids=[];document.querySelectorAll(".sch-bulk-check:checked").forEach(function(c){ids.push(c.value)});if(ids.length===0){alert("Select at least one application");return}if(!confirm("Are you sure you want to "+action+" "+ids.length+" application(s)?"))return;fetch("/scholarships/applications/bulk",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ids:ids,action:action})}).then(function(r){return r.json()}).then(function(d){if(d.ok)location.reload();else alert(d.error||"Action failed")}).catch(function(e){alert("Error: "+e.message)})}' +
      '</script>';

    res.send(renderPage('Scholarship Applications', html, user, req));
  }));

  // Bulk action endpoint
  app.post('/scholarships/applications/bulk', requireAuth, ah(async (req, res) => {
    var user = req.session.user, tid = user.tenant_id;
    var ids = req.body.ids || [];
    var action = req.body.action;
    if (!ids || ids.length === 0 || !action) {
      return res.json({ ok: false, error: 'No applications selected' });
    }
    var newStatus = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : null;
    if (!newStatus) return res.json({ ok: false, error: 'Invalid action' });

    var client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (var i = 0; i < ids.length; i++) {
        var app = (await client.query(
          'SELECT * FROM scholarship_applications WHERE id=$1 AND tenant_id=$2', [ids[i], tid]
        )).rows[0];
        if (!app) continue;

        await client.query(
          'UPDATE scholarship_applications SET status=$1, reviewer_id=$2, reviewed_at=NOW() WHERE id=$3 AND tenant_id=$4',
          [newStatus, user.id, ids[i], tid]
        );

        if (newStatus === 'approved') {
          var approvedAmount = Number(app.approved_amount) || 0;
          if (approvedAmount <= 0) {
            // Try to get scholarship default
            var sch = (await client.query(
              'SELECT total_fund_amount, remaining_amount, current_awards FROM scholarships WHERE id=$1 AND tenant_id=$2',
              [app.scholarship_id, tid]
            )).rows[0];
            if (sch) {
              approvedAmount = Math.floor(Number(sch.remaining_amount) / Math.max(1, Number(sch.current_awards) + 1));
              await client.query(
                'UPDATE scholarship_applications SET approved_amount=$1 WHERE id=$2 AND tenant_id=$3',
                [approvedAmount, ids[i], tid]
              );
            }
          }
          // Update scholarship counters
          await client.query(
            'UPDATE scholarships SET awarded_amount = awarded_amount + $1, current_awards = current_awards + 1, ' +
            'remaining_amount = GREATEST(0, remaining_amount - $1), updated_at = NOW() WHERE id = $2 AND tenant_id = $3',
            [approvedAmount, app.scholarship_id, tid]
          );
        }
      }
      await client.query('COMMIT');
      console.log('[ScholarshipManager] Bulk ' + action + ' for ' + ids.length + ' applications by user=' + user.id);
      res.json({ ok: true, message: ids.length + ' application(s) ' + action + 'd' });
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('[ScholarshipManager] Bulk action error:', e.message);
      res.json({ ok: false, error: e.message });
    } finally {
      client.release();
    }
  }));

  // ============================================================
  // ROUTE 7: POST /scholarships/applications/:id/review — Review
  // ============================================================
  app.get('/scholarships/applications/:id/review', requireAuth, ah(async (req, res) => {
    var user = req.session.user, tid = user.tenant_id, id = req.params.id;

    var application = (await pool.query(`
      SELECT sa.*, s.first_name, s.last_name, s.admission_number, s.gender, c.name as class_name,
        sc.name as scholarship_name, sc.scholarship_type, sc.total_fund_amount, sc.remaining_amount,
        sc.min_gpa as sch_min_gpa, sc.min_attendance as sch_min_attendance, sc.income_threshold
      FROM scholarship_applications sa
      LEFT JOIN students s ON s.id = sa.student_id
      LEFT JOIN classes c ON c.id = s.class_id
      LEFT JOIN scholarships sc ON sc.id = sa.scholarship_id
      WHERE sa.id=$1 AND sa.tenant_id=$2
    `, [id, tid])).rows[0];
    if (!application) {
      return res.send(renderPage('Not Found', '<div class="sch-card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">Application not found</h2><a href="/scholarships/applications" class="sch-btn sch-btn-primary" style="margin-top:12px">Back to Applications</a></div>', user, req));
    }

    var name = application.first_name ? esc(application.first_name + ' ' + application.last_name) : 'Student #' + application.student_id;
    var scoreClass = application.vulnerability_score >= 70 ? 'sch-score-high' : application.vulnerability_score >= 40 ? 'sch-score-med' : 'sch-score-low';

    // Eligibility checks
    var checks = [];
    if (application.sch_min_gpa && Number(application.gpa || 0) < Number(application.sch_min_gpa)) {
      checks.push({ pass: false, text: 'GPA ' + Number(application.gpa).toFixed(2) + ' below minimum ' + Number(application.sch_min_gpa).toFixed(2) });
    } else {
      checks.push({ pass: true, text: 'GPA meets requirement (' + Number(application.gpa || 0).toFixed(2) + ')' });
    }
    if (application.sch_min_attendance && Number(application.attendance_rate || 0) < Number(application.sch_min_attendance)) {
      checks.push({ pass: false, text: 'Attendance ' + application.attendance_rate + '% below minimum ' + application.sch_min_attendance + '%' });
    } else {
      checks.push({ pass: true, text: 'Attendance meets requirement (' + (application.attendance_rate || 0) + '%)' });
    }
    if (application.income_threshold && Number(application.household_income || 0) > Number(application.income_threshold)) {
      checks.push({ pass: false, text: 'Income exceeds threshold (' + fmtMoney(application.household_income) + ')' });
    } else if (application.income_threshold) {
      checks.push({ pass: true, text: 'Income within threshold' });
    }

    var checksHtml = checks.map(function(c) {
      return '<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:8px;' +
        (c.pass ? 'background:#dcfce7' : 'background:#fee2e2') + '">' +
        '<span style="font-size:16px">' + (c.pass ? '\u2705' : '\u274C') + '</span>' +
        '<span style="font-size:13px;color:' + (c.pass ? '#16a34a' : '#dc2626') + '">' + c.text + '</span></div>';
    }).join('');

    var html = SCH_CSS + '<div style="max-width:900px;margin:0 auto">' +
      nav('/scholarships/applications') +
      '<a href="/scholarships/applications" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">\u2190 Back to Applications</a>' +

      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">' +
      '<div><h1 style="font-size:22px;color:#1e293b">Review Application</h1>' +
      '<p style="font-size:13px;color:#94a3b8">' + name + ' &middot; ' + esc(application.scholarship_name || '') + '</p></div>' +
      applicationBadge(application.status) + '</div>' +

      // Student info + Eligibility
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">' +
      '<div class="sch-card"><h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">Student Information</h3>' +
      '<div style="display:grid;gap:8px;font-size:13px">' +
      '<div><span class="sch-stat-label">Name</span><div style="font-weight:600;color:#1e293b">' + name + '</div></div>' +
      '<div><span class="sch-stat-label">Admission #</span><div style="font-weight:600;color:#1e293b">' + esc(application.admission_number || '') + '</div></div>' +
      '<div><span class="sch-stat-label">Class</span><div style="font-weight:600;color:#1e293b">' + esc(application.class_name || '') + '</div></div>' +
      '<div><span class="sch-stat-label">Vulnerability Score</span><div style="margin-top:4px"><div class="sch-score ' + scoreClass + '" style="width:52px;height:52px;font-size:16px">' + (application.vulnerability_score || 0) + '</div></div></div>' +
      '</div></div>' +

      '<div class="sch-card"><h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">Eligibility Check</h3>' +
      '<div style="display:flex;flex-direction:column;gap:8px">' + checksHtml + '</div></div></div>' +

      // Financial info
      '<div class="sch-card" style="margin-bottom:20px"><h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">Financial Details</h3>' +
      '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;text-align:center">' +
      '<div style="background:#faf5ff;padding:14px;border-radius:10px"><div class="sch-stat-label">GPA</div><div style="font-size:20px;font-weight:800;color:#7c3aed;margin-top:4px">' + Number(application.gpa || 0).toFixed(2) + '</div></div>' +
      '<div style="background:#faf5ff;padding:14px;border-radius:10px"><div class="sch-stat-label">Attendance</div><div style="font-size:20px;font-weight:800;color:#059669;margin-top:4px">' + (application.attendance_rate || 0) + '%</div></div>' +
      '<div style="background:#faf5ff;padding:14px;border-radius:10px"><div class="sch-stat-label">Household Income</div><div style="font-size:20px;font-weight:800;color:#d97706;margin-top:4px">' + fmtMoney(application.household_income) + '</div></div>' +
      '<div style="background:#faf5ff;padding:14px;border-radius:10px"><div class="sch-stat-label">Family Size</div><div style="font-size:20px;font-weight:800;color:#6366f1;margin-top:4px">' + (application.family_members || 0) + '</div></div>' +
      '</div></div>' +

      // Personal statement
      (application.personal_statement ?
      '<div class="sch-card" style="margin-bottom:20px"><h3 style="font-size:15px;color:#1e293b;margin:0 0 10px">Personal Statement</h3>' +
      '<p style="font-size:13px;color:#374151;line-height:1.7;white-space:pre-wrap">' + esc(application.personal_statement) + '</p></div>' : '') +

      // Review form
      '<div class="sch-card" style="padding:24px">' +
      '<h3 style="font-size:15px;color:#1e293b;margin:0 0 16px">\uD83D\uDCDD Review Decision</h3>' +
      '<form method="POST" action="/scholarships/applications/' + id + '/review">' +
      '<div class="sch-form-grid">' +
      '<div>' + fieldLabel('Decision *') +
      '<select name="decision" required class="sch-select" style="font-size:14px;padding:12px 14px">' +
      '<option value="">Select...</option>' +
      '<option value="approved">Approve</option>' +
      '<option value="shortlisted">Shortlist</option>' +
      '<option value="rejected">Reject</option></select></div>' +
      '<div>' + fieldLabel('Approved Amount (UGX)') +
      '<input type="number" name="approved_amount" min="0" value="' + Math.floor(Number(application.approved_amount) || 0) + '" placeholder="0" class="sch-input" style="font-size:14px;padding:12px 14px"></div>' +
      '<div class="sch-full">' + fieldLabel('Review Notes') +
      '<textarea name="review_notes" rows="3" placeholder="Add review comments, reasons for decision..." class="sch-textarea" style="font-size:14px;padding:12px 14px">' + esc(application.review_notes || '') + '</textarea></div>' +
      '</div>' +
      '<div style="display:flex;gap:10px;margin-top:20px;padding-top:16px;border-top:2px solid #ede9fe">' +
      '<button type="submit" class="sch-btn sch-btn-success" style="padding:12px 28px">\u2705 Submit Review</button>' +
      '<a href="/scholarships/applications" class="sch-btn sch-btn-secondary" style="padding:12px 28px">Cancel</a></div>' +
      '</form></div></div>';

    res.send(renderPage('Review Application: ' + name, html, user, req));
  }));

  app.post('/scholarships/applications/:id/review', requireAuth, ah(async (req, res) => {
    var user = req.session.user, tid = user.tenant_id, id = req.params.id;
    var body = req.body;
    var decision = body.decision;
    if (!decision || !['approved', 'shortlisted', 'rejected'].includes(decision)) {
      req.session.flash = { type: 'error', msg: 'Please select a valid decision.' };
      return res.redirect('/scholarships/applications/' + id + '/review');
    }

    var client = await pool.connect();
    try {
      await client.query('BEGIN');

      var application = (await client.query(
        'SELECT * FROM scholarship_applications WHERE id=$1 AND tenant_id=$2', [id, tid]
      )).rows[0];
      if (!application) {
        await client.query('ROLLBACK');
        return res.redirect('/scholarships/applications');
      }

      var approvedAmount = parseInt(body.approved_amount) || 0;

      // Update application
      await client.query(`
        UPDATE scholarship_applications SET status=$1, approved_amount=$2, review_notes=$3,
        reviewer_id=$4, reviewed_at=NOW()
        WHERE id=$5 AND tenant_id=$6
      `, [decision, approvedAmount, (body.review_notes || '').trim() || null, user.id, id, tid]);

      // If approved, update scholarship counters
      if (decision === 'approved' && approvedAmount > 0) {
        await client.query(`
          UPDATE scholarships SET awarded_amount = awarded_amount + $1,
          current_awards = current_awards + 1,
          remaining_amount = GREATEST(0, remaining_amount - $1),
          updated_at = NOW()
          WHERE id = $2 AND tenant_id = $3
        `, [approvedAmount, application.scholarship_id, tid]);
      }

      await client.query('COMMIT');
      console.log('[ScholarshipManager] Application ' + id + ' reviewed: ' + decision + ' by user=' + user.id);
      req.session.flash = { type: 'success', msg: 'Application ' + decision + ' successfully.' };
      res.redirect('/scholarships/applications');
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('[ScholarshipManager] Review error:', e.message);
      req.session.flash = { type: 'error', msg: 'Review failed: ' + e.message };
      res.redirect('/scholarships/applications/' + id + '/review');
    } finally {
      client.release();
    }
  }));

  // ============================================================
  // ROUTE 8: GET /scholarships/disbursements — Disbursement dashboard
  // ============================================================
  app.get('/scholarships/disbursements', requireAuth, ah(async (req, res) => {
    var user = req.session.user, tid = user.tenant_id;
    var qStatus = req.query.status || '';
    var qScholarship = req.query.scholarship_id || '';
    var page = Math.max(1, parseInt(req.query.page) || 1);
    var perPage = 25;
    var offset = (page - 1) * perPage;

    // Stats
    var stats = (await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM scholarship_disbursements WHERE tenant_id=$1 AND status='pending') as pending_count,
        (SELECT COALESCE(SUM(amount), 0) FROM scholarship_disbursements WHERE tenant_id=$1 AND status='pending') as pending_amount,
        (SELECT COUNT(*) FROM scholarship_disbursements WHERE tenant_id=$1 AND status='approved') as approved_count,
        (SELECT COALESCE(SUM(amount), 0) FROM scholarship_disbursements WHERE tenant_id=$1 AND status='approved') as approved_amount,
        (SELECT COUNT(*) FROM scholarship_disbursements WHERE tenant_id=$1 AND status='disbursed') as disbursed_count,
        (SELECT COALESCE(SUM(amount), 0) FROM scholarship_disbursements WHERE tenant_id=$1 AND status='disbursed') as disbursed_amount,
        (SELECT COUNT(*) FROM scholarship_disbursements WHERE tenant_id=$1 AND status='failed') as failed_count
    `, [tid])).rows[0];

    // Approved applications awaiting disbursement
    var approvedApps = (await pool.query(`
      SELECT sa.*, s.first_name, s.last_name, s.admission_number, c.name as class_name,
        sc.name as scholarship_name,
        sa.approved_amount - COALESCE(sa.disbursed_amount, 0) as remaining_disbursement
      FROM scholarship_applications sa
      LEFT JOIN students s ON s.id = sa.student_id
      LEFT JOIN classes c ON c.id = s.class_id
      LEFT JOIN scholarships sc ON sc.id = sa.scholarship_id
      WHERE sa.tenant_id=$1 AND sa.status='approved'
        AND sa.disbursement_status IN ('pending', 'partial')
      ORDER BY sa.created_at DESC
    `, [tid])).rows;

    // Disbursement history
    var where = ['sd.tenant_id=$1'];
    var params = [tid];
    var pi = 2;
    if (qStatus) { where.push('sd.status=$' + pi); params.push(qStatus); pi++; }
    if (qScholarship) { where.push('sd.scholarship_id=$' + pi); params.push(qScholarship); pi++; }

    var disbursements = (await pool.query(`
      SELECT sd.*, s.first_name, s.last_name, s.admission_number, sc.name as scholarship_name,
        u.name as created_by_name
      FROM scholarship_disbursements sd
      LEFT JOIN students s ON s.id = sd.student_id
      LEFT JOIN scholarships sc ON sc.id = sd.scholarship_id
      LEFT JOIN users u ON u.id = sd.created_by
      WHERE ${where.join(' AND ')}
      ORDER BY sd.created_at DESC LIMIT $${pi} OFFSET $${pi + 1}
    `, params.concat([perPage, offset]))).rows;

    var scholarships = (await pool.query(
      'SELECT id, name FROM scholarships WHERE tenant_id=$1 ORDER BY name', [tid]
    )).rows;

    var appsHtml = approvedApps.map(function(a) {
      var name = a.first_name ? esc(a.first_name + ' ' + a.last_name) : 'Student #' + a.student_id;
      var remaining = Number(a.remaining_disbursement) || 0;
      return '<tr>' +
        '<td><strong>' + name + '</strong><br><span style="font-size:11px;color:#94a3b8">' + esc(a.admission_number || '') + '</span></td>' +
        '<td>' + esc(a.scholarship_name || '') + '</td>' +
        '<td style="font-weight:700;color:#7c3aed">' + fmtMoney(a.approved_amount) + '</td>' +
        '<td style="font-weight:700;color:#059669">' + fmtMoney(remaining) + '</td>' +
        '<td>' + applicationBadge(a.disbursement_status || 'pending') + '</td>' +
        '<td><a href="/scholarships/disburse?application_id=' + a.id + '" class="sch-btn sch-btn-success sch-btn-sm">Disburse</a></td></tr>';
    }).join('');

    var disbHtml = disbursements.map(function(d) {
      var name = d.first_name ? esc(d.first_name + ' ' + d.last_name) : 'Student #' + d.student_id;
      return '<tr>' +
        '<td><strong>' + name + '</strong></td>' +
        '<td><a href="/scholarships/' + d.scholarship_id + '" style="color:#7c3aed;text-decoration:none;font-size:12px">' + esc(d.scholarship_name || '') + '</a></td>' +
        '<td style="font-weight:700;color:#059669">' + fmtMoney(d.amount) + '</td>' +
        '<td>' + esc(d.term || '') + '</td>' +
        '<td>' + esc(d.payment_method || '') + '</td>' +
        '<td style="font-family:monospace;font-size:12px">' + esc(d.payment_ref || '') + '</td>' +
        '<td>' + disbursementBadge(d.status) + '</td>' +
        '<td>' + fmtDate(d.disbursement_date) + '</td>' +
        '<td>' + fmtDate(d.created_at) + '</td></tr>';
    }).join('');

    var html = SCH_CSS + '<div style="max-width:1200px;margin:0 auto">' +
      nav('/scholarships/disbursements') +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">' +
      '<div><h1 style="font-size:24px;color:#1e293b">\uD83D\uDCB0 Disbursements</h1>' +
      '<p style="font-size:13px;color:#94a3b8;margin-top:2px">Track and process scholarship payments</p></div>' +
      '<a href="/scholarships/disburse" class="sch-btn sch-btn-success">\u2795 New Disbursement</a></div>' +

      // Stats
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin-bottom:20px">' +
      '<div class="sch-stat-card amber"><div class="sch-stat-num" style="color:#d97706">' + stats.pending_count + '</div>' +
      '<div class="sch-stat-label">Pending (' + fmtMoney(stats.pending_amount) + ')</div></div>' +
      '<div class="sch-stat-card purple"><div class="sch-stat-num" style="color:#7c3aed">' + stats.approved_count + '</div>' +
      '<div class="sch-stat-label">Approved (' + fmtMoney(stats.approved_amount) + ')</div></div>' +
      '<div class="sch-stat-card green"><div class="sch-stat-num" style="color:#059669">' + stats.disbursed_count + '</div>' +
      '<div class="sch-stat-label">Disbursed (' + fmtMoney(stats.disbursed_amount) + ')</div></div>' +
      '<div class="sch-stat-card red"><div class="sch-stat-num" style="color:#dc2626">' + stats.failed_count + '</div>' +
      '<div class="sch-stat-label">Failed</div></div></div>' +

      // Pending disbursements
      '<div class="sch-card" style="padding:0;overflow:hidden;margin-bottom:20px">' +
      '<div class="sch-card-header" style="padding:16px 20px;margin-bottom:0">' +
      '<h3 style="font-size:15px;color:#1e293b;margin:0">Approved Applications Awaiting Disbursement (' + approvedApps.length + ')</h3></div>' +
      '<div class="sch-scroll"><table class="sch-table">' +
      '<thead style="position:sticky;top:0"><tr><th>Student</th><th>Scholarship</th><th>Approved</th><th>Remaining</th><th>Disb. Status</th><th>Action</th></tr></thead>' +
      '<tbody>' + (appsHtml || '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:40px">No pending disbursements</td></tr>') + '</tbody></table></div></div>' +

      // Filters
      '<div class="sch-filter" style="margin-bottom:12px">' +
      '<div><label>Scholarship</label><select onchange="location.href=\'/scholarships/disbursements?scholarship_id=\'+this.value" class="sch-select" style="width:200px">' +
      '<option value="">All Scholarships</option>' +
      scholarships.map(function(s) { return '<option value="' + s.id + '"' + (qScholarship == s.id ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join('') +
      '</select></div>' +
      '<div><label>Status</label><select onchange="location.href=\'/scholarships/disbursements?status=\'+this.value" class="sch-select" style="width:140px">' +
      '<option value="">All</option>' +
      '<option value="pending"' + (qStatus === 'pending' ? ' selected' : '') + '>Pending</option>' +
      '<option value="approved"' + (qStatus === 'approved' ? ' selected' : '') + '>Approved</option>' +
      '<option value="disbursed"' + (qStatus === 'disbursed' ? ' selected' : '') + '>Disbursed</option>' +
      '<option value="failed"' + (qStatus === 'failed' ? ' selected' : '') + '>Failed</option></select></div></div>' +

      // History table
      '<div class="sch-card" style="padding:0;overflow:hidden">' +
      '<div class="sch-card-header" style="padding:16px 20px;margin-bottom:0">' +
      '<h3 style="font-size:15px;color:#1e293b;margin:0">Disbursement History</h3></div>' +
      '<div class="sch-scroll"><table class="sch-table">' +
      '<thead style="position:sticky;top:0"><tr><th>Student</th><th>Scholarship</th><th>Amount</th><th>Term</th><th>Method</th><th>Ref</th><th>Status</th><th>Date</th><th>Recorded</th></tr></thead>' +
      '<tbody>' + (disbHtml || '<tr><td colspan="9" style="text-align:center;color:#94a3b8;padding:40px">No disbursements recorded</td></tr>') + '</tbody></table></div></div>' +

      '</div>';

    res.send(renderPage('Scholarship Disbursements', html, user, req));
  }));

  // ============================================================
  // ROUTE 9: GET+POST /scholarships/disburse — Process disbursement
  // ============================================================
  app.get('/scholarships/disburse', requireAuth, ah(async (req, res) => {
    var user = req.session.user, tid = user.tenant_id;
    var appId = req.query.application_id || '';

    // Get approved applications for selection
    var approvedApps = (await pool.query(`
      SELECT sa.id, sa.student_id, sa.approved_amount, sa.disbursed_amount,
        sa.approved_amount - COALESCE(sa.disbursed_amount, 0) as remaining,
        s.first_name, s.last_name, s.admission_number, s.phone,
        sc.name as scholarship_name, sc.id as scholarship_id, sc.academic_year
      FROM scholarship_applications sa
      LEFT JOIN students s ON s.id = sa.student_id
      LEFT JOIN scholarships sc ON sc.id = sa.scholarship_id
      WHERE sa.tenant_id=$1 AND sa.status='approved'
        AND (sa.disbursement_status IN ('pending', 'partial'))
      ORDER BY sa.created_at DESC
    `, [tid])).rows;

    var selectedApp = null;
    if (appId) {
      selectedApp = approvedApps.find(function(a) { return a.id == appId; });
    }

    var appOptions = approvedApps.map(function(a) {
      var name = a.first_name ? esc(a.first_name + ' ' + a.last_name) : 'Student #' + a.student_id;
      var remaining = Number(a.remaining) || 0;
      return '<option value="' + a.id + '"' + (selectedApp && selectedApp.id == a.id ? ' selected' : '') + '>' +
        name + ' \u2014 ' + esc(a.scholarship_name || '') + ' \u2014 Remaining: ' + fmtMoney(remaining) + '</option>';
    }).join('');

    var html = SCH_CSS + '<div style="max-width:800px;margin:0 auto">' +
      nav('/scholarships/disbursements') +
      '<a href="/scholarships/disbursements" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">\u2190 Back to Disbursements</a>' +
      '<div class="sch-card" style="padding:24px">' +
      '<h2 style="color:#1e293b;margin:0 0 4px">\uD83D\uDCB0 Process Disbursement</h2>' +
      '<p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Record a scholarship disbursement payment</p>' +
      '<form method="POST" action="/scholarships/disburse">' +
      '<div class="sch-form-grid">' +

      // Application selection
      '<div class="sch-full"><label class="sch-label">Select Application *</label>' +
      '<select name="application_id" required class="sch-select" id="app-select" onchange="updateForm(this.value)" style="font-size:14px;padding:12px 14px">' +
      '<option value="">Choose an approved application...</option>' + appOptions + '</select></div>' +

      '<input type="hidden" name="scholarship_id" id="f-scholarship_id" value="' + (selectedApp ? selectedApp.scholarship_id : '') + '">' +
      '<input type="hidden" name="student_id" id="f-student_id" value="' + (selectedApp ? selectedApp.student_id : '') + '">' +

      '<div><label class="sch-label">Recipient Name</label>' +
      '<input type="text" name="recipient_name" id="f-recipient" class="sch-input" value="' + (selectedApp ? esc(selectedApp.first_name + ' ' + selectedApp.last_name) : '') + '"></div>' +
      '<div><label class="sch-label">Recipient Phone</label>' +
      '<input type="tel" name="recipient_phone" id="f-phone" class="sch-input" value="' + (selectedApp ? esc(selectedApp.phone || '') : '') + '"></div>' +

      '<div><label class="sch-label">Amount (UGX) *</label>' +
      '<input type="number" name="amount" required min="0" id="f-amount" class="sch-input" value="' + (selectedApp ? (selectedApp.remaining || 0) : '') + '" style="font-size:16px;font-weight:700"></div>' +
      '<div><label class="sch-label">Max Available</label>' +
      '<input type="text" id="f-max" class="sch-input" value="' + (selectedApp ? fmtMoney(selectedApp.remaining) : 'Select application') + '" readonly style="background:#faf5ff"></div>' +

      '<div><label class="sch-label">Payment Method *</label>' +
      '<select name="payment_method" required class="sch-select">' +
      '<option value="bank_transfer">Bank Transfer</option><option value="mobile_money">Mobile Money</option>' +
      '<option value="cash">Cash</option><option value="cheque">Cheque</option>' +
      '<option value="direct_school">Direct to School</option></select></div>' +
      '<div><label class="sch-label">Payment Reference</label>' +
      '<input type="text" name="payment_ref" class="sch-input" placeholder="Transaction reference"></div>' +

      '<div><label class="sch-label">Term *</label>' +
      '<select name="term" required class="sch-select">' +
      '<option value="Term 1">Term 1</option><option value="Term 2">Term 2</option><option value="Term 3">Term 3</option></select></div>' +
      '<div><label class="sch-label">Academic Year</label>' +
      '<input type="text" name="academic_year" id="f-year" class="sch-input" value="' + (selectedApp ? esc(selectedApp.academic_year || '') : '') + '"></div>' +

      '<div class="sch-full"><label class="sch-label">Disbursement Date</label>' +
      '<input type="date" name="disbursement_date" class="sch-input" value="' + today() + '"></div>' +

      '<div class="sch-full"><label class="sch-label">Notes</label>' +
      '<textarea name="notes" rows="2" class="sch-textarea" placeholder="Optional notes about this disbursement..."></textarea></div>' +
      '</div>' +

      '<div style="display:flex;gap:10px;margin-top:20px;padding-top:16px;border-top:2px solid #ede9fe">' +
      '<button type="submit" class="sch-btn sch-btn-success" style="padding:12px 28px">\uD83D\uDCB0 Process Disbursement</button>' +
      '<a href="/scholarships/disbursements" class="sch-btn sch-btn-secondary" style="padding:12px 28px">Cancel</a></div>' +
      '</form></div></div>' +

      '<script>' +
      'var apps=' + JSON.stringify(approvedApps.map(function(a) {
        return { id: a.id, scholarship_id: a.scholarship_id, student_id: a.student_id, name: a.first_name + ' ' + a.last_name, phone: a.phone || '', remaining: a.remaining, year: a.academic_year || '' };
      })) + ';' +
      'function updateForm(appId){var app=apps.find(function(a){return String(a.id)===String(appId)});' +
      'if(app){document.getElementById("f-recipient").value=app.name;' +
      'document.getElementById("f-phone").value=app.phone;' +
      'document.getElementById("f-amount").value=app.remaining;' +
      'document.getElementById("f-max").value="UGX "+Number(app.remaining).toLocaleString();' +
      'document.getElementById("f-scholarship_id").value=app.scholarship_id;' +
      'document.getElementById("f-student_id").value=app.student_id;' +
      'document.getElementById("f-year").value=app.year}}' +
      '</script>';

    res.send(renderPage('Process Disbursement', html, user, req));
  }));

  app.post('/scholarships/disburse', requireAuth, ah(async (req, res) => {
    var user = req.session.user, tid = user.tenant_id;
    var body = req.body;
    var applicationId = parseInt(body.application_id);
    var amount = parseInt(body.amount);

    if (!applicationId || !amount || amount <= 0) {
      req.session.flash = { type: 'error', msg: 'Please select an application and enter a valid amount.' };
      return res.redirect('/scholarships/disburse');
    }

    var client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Verify application and check remaining
      var application = (await client.query(
        'SELECT * FROM scholarship_applications WHERE id=$1 AND tenant_id=$2 AND status=\'approved\'',
        [applicationId, tid]
      )).rows[0];
      if (!application) {
        await client.query('ROLLBACK');
        req.session.flash = { type: 'error', msg: 'Application not found or not approved.' };
        return res.redirect('/scholarships/disburse');
      }

      var disbursed = Number(application.disbursed_amount) || 0;
      var approved = Number(application.approved_amount) || 0;
      var remaining = approved - disbursed;

      if (amount > remaining) {
        await client.query('ROLLBACK');
        req.session.flash = { type: 'error', msg: 'Amount exceeds remaining disbursement of ' + fmtMoney(remaining) + '.' };
        return res.redirect('/scholarships/disburse?application_id=' + applicationId);
      }

      // Create disbursement record
      await client.query(`
        INSERT INTO scholarship_disbursements (
          tenant_id, application_id, scholarship_id, student_id, amount,
          disbursement_date, term, academic_year, payment_method, payment_ref,
          recipient_name, recipient_phone, status, notes, created_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'disbursed',$13,$14)
      `, [
        tid, applicationId, body.scholarship_id || application.scholarship_id,
        body.student_id || application.student_id, amount,
        body.disbursement_date || today(), body.term || 'Term 1',
        (body.academic_year || '').trim() || null, body.payment_method || 'cash',
        (body.payment_ref || '').trim() || null,
        (body.recipient_name || '').trim() || null,
        (body.recipient_phone || '').trim() || null,
        (body.notes || '').trim() || null, user.id
      ]);

      // Update application disbursement tracking
      var newDisbursed = disbursed + amount;
      var newDisbursementStatus = newDisbursed >= approved ? 'fully_disbursed' : 'partial';
      await client.query(`
        UPDATE scholarship_applications
        SET disbursed_amount=$1, disbursement_status=$2
        WHERE id=$3 AND tenant_id=$4
      `, [newDisbursed, newDisbursementStatus, applicationId, tid]);

      // If fully disbursed, update application status
      if (newDisbursementStatus === 'fully_disbursed') {
        await client.query(`
          UPDATE scholarship_applications SET status='disbursed' WHERE id=$1 AND tenant_id=$2
        `, [applicationId, tid]);
      }

      await client.query('COMMIT');
      console.log('[ScholarshipManager] Disbursement of ' + fmtMoney(amount) + ' processed for application ' + applicationId + ' by user=' + user.id);
      req.session.flash = { type: 'success', msg: 'Disbursement of ' + fmtMoney(amount) + ' processed successfully.' };
      res.redirect('/scholarships/disbursements');
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('[ScholarshipManager] Disbursement error:', e.message);
      req.session.flash = { type: 'error', msg: 'Disbursement failed: ' + e.message };
      res.redirect('/scholarships/disburse');
    } finally {
      client.release();
    }
  }));

  // ============================================================
  // ROUTE 10: GET /scholarships/reports — Reports page
  // ============================================================
  app.get('/scholarships/reports', requireAuth, ah(async (req, res) => {
    var user = req.session.user, tid = user.tenant_id;
    var year = req.query.year || '';

    var yearFilter = year ? " AND EXTRACT(YEAR FROM sa.created_at) = '" + parseInt(year) + "'" : '';

    // 1. Awards by type
    var byType = (await pool.query(`
      SELECT sc.scholarship_type,
        COUNT(sa.id) as applications,
        COUNT(CASE WHEN sa.status='approved' THEN 1 END) as approved,
        COALESCE(SUM(CASE WHEN sa.status='approved' THEN sa.approved_amount ELSE 0 END), 0) as total_approved_amount
      FROM scholarships sc
      LEFT JOIN scholarship_applications sa ON sa.scholarship_id = sc.id AND sa.tenant_id = sc.tenant_id ${yearFilter}
      WHERE sc.tenant_id=$1
      GROUP BY sc.scholarship_type
      ORDER BY applications DESC
    `, [tid])).rows;

    // 2. Gender distribution
    var genderStats = (await pool.query(`
      SELECT s.gender,
        COUNT(sa.id) as applications,
        COUNT(CASE WHEN sa.status='approved' THEN 1 END) as approved,
        COALESCE(SUM(CASE WHEN sa.status='approved' THEN sa.approved_amount ELSE 0 END), 0) as total_amount
      FROM scholarship_applications sa
      LEFT JOIN students s ON s.id = sa.student_id
      WHERE sa.tenant_id=$1 ${yearFilter}
      GROUP BY s.gender
      ORDER BY applications DESC
    `, [tid])).rows;

    // 3. Fund utilization per scholarship
    var fundUtil = (await pool.query(`
      SELECT sc.id, sc.name, sc.scholarship_type,
        sc.total_fund_amount,
        sc.awarded_amount,
        sc.remaining_amount,
        sc.current_awards,
        sc.max_awards,
        (SELECT COUNT(*) FROM scholarship_applications WHERE scholarship_id=sc.id) as total_apps,
        (SELECT COUNT(*) FROM scholarship_applications WHERE scholarship_id=sc.id AND status='approved') as approved_apps
      FROM scholarships sc
      WHERE sc.tenant_id=$1
      ORDER BY sc.awarded_amount DESC
    `, [tid])).rows;

    // 4. Top performing students by vulnerability score
    var topStudents = (await pool.query(`
      SELECT sa.*, s.first_name, s.last_name, s.admission_number, s.gender, c.name as class_name,
        sc.name as scholarship_name
      FROM scholarship_applications sa
      LEFT JOIN students s ON s.id = sa.student_id
      LEFT JOIN classes c ON c.id = s.class_id
      LEFT JOIN scholarships sc ON sc.id = sa.scholarship_id
      WHERE sa.tenant_id=$1 ${yearFilter}
      ORDER BY sa.vulnerability_score DESC
      LIMIT 20
    `, [tid])).rows;

    // 5. Monthly application trend
    var monthlyTrend = (await pool.query(`
      SELECT TO_CHAR(sa.created_at, 'Mon YYYY') as month,
        COUNT(*) as applications,
        COUNT(CASE WHEN sa.status='approved' THEN 1 END) as approved
      FROM scholarship_applications sa
      WHERE sa.tenant_id=$1 ${yearFilter}
      GROUP BY TO_CHAR(sa.created_at, 'Mon YYYY'), date_trunc('month', sa.created_at)
      ORDER BY date_trunc('month', sa.created_at) DESC
      LIMIT 12
    `, [tid])).rows;

    // Available years
    var years = (await pool.query(`
      SELECT DISTINCT EXTRACT(YEAR FROM created_at)::int as yr
      FROM scholarship_applications WHERE tenant_id=$1
      ORDER BY yr DESC
    `, [tid])).rows;

    // Render helpers
    var typeColors = { merit: '#7c3aed', need: '#d97706', sports: '#059669', arts: '#db2777', special: '#6366f1', bursary: '#0d9488' };
    var maxApps = Math.max.apply(null, byType.map(function(t) { return t.applications; }).concat([1]));
    var maxFund = Math.max.apply(null, fundUtil.map(function(f) { return Number(f.total_fund_amount) || 0; }).concat([1]));

    // By Type chart
    var typeChartHtml = byType.map(function(t) {
      var color = typeColors[t.scholarship_type] || '#7c3aed';
      var barPct = pct(t.applications, maxApps);
      return '<div class="sch-bar-row">' +
        '<div class="sch-bar-label">' + typeBadge(t.scholarship_type) + '</div>' +
        '<div class="sch-bar-track"><div class="sch-bar-fill" style="width:' + barPct + '%;background:' + color + '"></div>' +
        '<span class="sch-bar-value">' + t.applications + ' apps / ' + t.approved + ' approved / ' + fmtMoney(t.total_approved_amount) + '</span></div></div>';
    }).join('');

    // Gender distribution
    var genderColors = { Male: '#2563eb', Female: '#db2777', Other: '#7c3aed' };
    var totalGenderApps = genderStats.reduce(function(s, g) { return s + Number(g.applications); }, 0);
    var genderHtml = genderStats.map(function(g) {
      var genderPct = pct(Number(g.applications), totalGenderApps);
      var color = genderColors[g.gender] || '#6b7280';
      return '<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid #f5f3ff">' +
        '<div style="width:12px;height:12px;border-radius:50%;background:' + color + ';flex-shrink:0"></div>' +
        '<div style="flex:1"><div style="font-weight:600;color:#1e293b;font-size:14px">' + esc(g.gender || 'Unknown') + '</div>' +
        '<div style="font-size:12px;color:#6b7280">' + g.applications + ' applications (' + genderPct + '%)</div></div>' +
        '<div style="text-align:right"><div style="font-weight:700;color:#059669">' + fmtMoney(g.total_amount) + '</div>' +
        '<div style="font-size:12px;color:#6b7280">' + g.approved + ' approved</div></div></div>';
    }).join('');

    // Fund utilization per scholarship
    var fundHtml = fundUtil.map(function(f) {
      var fundPct = pct(Number(f.awarded_amount), Math.max(Number(f.total_fund_amount), 1));
      var color = fundPct >= 80 ? '#dc2626' : fundPct >= 60 ? '#d97706' : '#7c3aed';
      return '<div style="padding:12px 0;border-bottom:1px solid #f5f3ff">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
        '<a href="/scholarships/' + f.id + '" style="color:#7c3aed;text-decoration:none;font-weight:600;font-size:14px">' + esc(f.name) + '</a>' +
        '<span style="font-size:12px;font-weight:700;color:' + color + '">' + fundPct + '% utilized</span></div>' +
        progressBar(Number(f.awarded_amount), Number(f.total_fund_amount)) +
        '<div style="display:flex;justify-content:space-between;margin-top:4px;font-size:11px;color:#6b7280">' +
        '<span>Fund: ' + fmtMoney(f.total_fund_amount) + '</span>' +
        '<span>Awarded: ' + fmtMoney(f.awarded_amount) + '</span>' +
        '<span>Remaining: ' + fmtMoney(f.remaining_amount) + '</span>' +
        '<span>Awards: ' + f.current_awards + '/' + (f.max_awards || '\u221E') + '</span></div></div>';
    }).join('');

    // Top students table
    var studentsHtml = topStudents.map(function(s, idx) {
      var name = s.first_name ? esc(s.first_name + ' ' + s.last_name) : 'Student #' + s.student_id;
      var scoreClass = s.vulnerability_score >= 70 ? 'sch-score-high' : s.vulnerability_score >= 40 ? 'sch-score-med' : 'sch-score-low';
      return '<tr>' +
        '<td style="font-weight:700;color:#7c3aed">' + (idx + 1) + '</td>' +
        '<td><strong>' + name + '</strong><br><span style="font-size:11px;color:#94a3b8">' + esc(s.admission_number || '') + ' &middot; ' + esc(s.class_name || '') + '</span></td>' +
        '<td>' + esc(s.scholarship_name || '') + '</td>' +
        '<td style="text-align:center"><div class="sch-score ' + scoreClass + '">' + (s.vulnerability_score || 0) + '</div></td>' +
        '<td>' + Number(s.gpa || 0).toFixed(2) + '</td>' +
        '<td>' + applicationBadge(s.status) + '</td>' +
        '<td style="font-weight:700">' + fmtMoney(s.approved_amount) + '</td></tr>';
    }).join('');

    // Monthly trend
    var maxMonthlyApps = Math.max.apply(null, monthlyTrend.map(function(m) { return m.applications; }).concat([1]));
    var trendHtml = monthlyTrend.reverse().map(function(m) {
      var barPct = pct(m.applications, maxMonthlyApps);
      return '<div class="sch-bar-row">' +
        '<div class="sch-bar-label">' + esc(m.month) + '</div>' +
        '<div class="sch-bar-track"><div class="sch-bar-fill" style="width:' + barPct + '%;background:#7c3aed"></div>' +
        '<span class="sch-bar-value">' + m.applications + ' total / ' + m.approved + ' approved</span></div></div>';
    }).join('');

    var html = SCH_CSS + '<div style="max-width:1200px;margin:0 auto">' +
      nav('/scholarships/reports') +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">' +
      '<div><h1 style="font-size:24px;color:#1e293b">\uD83D\uDCCA Scholarship Reports</h1>' +
      '<p style="font-size:13px;color:#94a3b8;margin-top:2px">Analytics and insights on scholarships, applications, and fund utilization</p></div>' +
      '<div class="sch-filter" style="margin:0;padding:8px 14px">' +
      '<label style="margin:0">Academic Year:</label>' +
      '<select onchange="location.href=\'/scholarships/reports?year=\'+this.value" class="sch-select" style="width:120px;padding:6px 10px;font-size:12px">' +
      '<option value="">All Years</option>' +
      years.map(function(y) { return '<option value="' + y.yr + '"' + (year == y.yr ? ' selected' : '') + '>' + y.yr + '</option>'; }).join('') +
      '</select></div></div>' +

      // By Type and Gender
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">' +
      '<div class="sch-card"><h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">Awards by Scholarship Type</h3>' +
      '<div class="sch-bar-chart">' + (typeChartHtml || '<p style="text-align:center;color:#94a3b8;padding:20px;font-size:13px">No data</p>') + '</div></div>' +

      '<div class="sch-card"><h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">Gender Distribution</h3>' +
      genderHtml + '</div></div>' +

      // Fund utilization
      '<div class="sch-card" style="margin-bottom:20px">' +
      '<div class="sch-card-header"><h3 style="font-size:15px;color:#1e293b;margin:0">Fund Utilization Per Scholarship</h3>' +
      '<span style="font-size:12px;color:#94a3b8">' + fundUtil.length + ' scholarships</span></div>' +
      (fundHtml || '<p style="text-align:center;color:#94a3b8;padding:20px;font-size:13px">No scholarships found</p>') +
      '</div>' +

      // Trend and Top Students
      '<div style="display:grid;grid-template-columns:1fr 2fr;gap:16px;margin-bottom:20px">' +
      '<div class="sch-card"><h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">Application Trend</h3>' +
      '<div class="sch-bar-chart">' + (trendHtml || '<p style="text-align:center;color:#94a3b8;padding:20px;font-size:13px">No data</p>') + '</div></div>' +

      '<div class="sch-card" style="padding:0;overflow:hidden">' +
      '<div class="sch-card-header" style="padding:16px 20px;margin-bottom:0">' +
      '<h3 style="font-size:15px;color:#1e293b;margin:0">Top Students by Vulnerability Score</h3></div>' +
      '<div class="sch-scroll"><table class="sch-table">' +
      '<thead style="position:sticky;top:0"><tr><th>#</th><th>Student</th><th>Scholarship</th><th>Score</th><th>GPA</th><th>Status</th><th>Amount</th></tr></thead>' +
      '<tbody>' + (studentsHtml || '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:40px">No data available</td></tr>') + '</tbody></table></div></div></div>' +

      '</div>';

    res.send(renderPage('Scholarship Reports', html, user, req));
  }));

  // ============================================================
  // POST: Toggle scholarship status (open/close/pause)
  // ============================================================
  app.post('/scholarships/:id/toggle-status', requireAuth, ah(async (req, res) => {
    var user = req.session.user, tid = user.tenant_id, id = req.params.id;
    var newStatus = req.body.status;
    var validStatuses = ['open', 'closed', 'paused', 'completed'];
    if (!validStatuses.includes(newStatus)) {
      return res.json({ ok: false, error: 'Invalid status' });
    }

    await pool.query(
      'UPDATE scholarships SET status=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3',
      [newStatus, id, tid]
    );
    console.log('[ScholarshipManager] Scholarship ' + id + ' status changed to ' + newStatus + ' by user=' + user.id);
    req.session.flash = { type: 'success', msg: 'Scholarship status updated to ' + newStatus + '.' };
    res.redirect('/scholarships/' + id);
  }));

  // ============================================================
  // POST: Edit scholarship
  // ============================================================
  app.post('/scholarships/:id/edit', requireAuth, ah(async (req, res) => {
    var user = req.session.user, tid = user.tenant_id, id = req.params.id;
    var body = req.body;

    var scholarship = (await pool.query(
      'SELECT * FROM scholarships WHERE id=$1 AND tenant_id=$2', [id, tid]
    )).rows[0];
    if (!scholarship) {
      return res.redirect('/scholarships/manage');
    }

    var totalFund = parseInt(body.total_fund_amount) || Number(scholarship.total_fund_amount) || 0;
    var awarded = Number(scholarship.awarded_amount) || 0;
    var remaining = totalFund - awarded;

    await pool.query(`
      UPDATE scholarships SET
        name=$1, description=$2, scholarship_type=$3, funding_source=$4,
        sponsor_name=$5, sponsor_contact=$6, total_fund_amount=$7,
        remaining_amount=$8, max_awards=$9, min_gpa=$10, min_attendance=$11,
        income_threshold=$12, covers_tuition=$13, covers_feeding=$14,
        covers_transport=$15, covers_books=$16, covers_uniform=$17,
        application_deadline=$18, academic_year=$19, updated_at=NOW()
      WHERE id=$20 AND tenant_id=$21
    `, [
      (body.name || '').trim() || scholarship.name,
      (body.description || '').trim() || scholarship.description,
      body.scholarship_type || scholarship.scholarship_type,
      body.funding_source || scholarship.funding_source,
      (body.sponsor_name || '').trim() || scholarship.sponsor_name,
      (body.sponsor_contact || '').trim() || scholarship.sponsor_contact,
      totalFund, Math.max(0, remaining),
      parseInt(body.max_awards) || scholarship.max_awards,
      parseFloat(body.min_gpa) || scholarship.min_gpa,
      parseInt(body.min_attendance) || scholarship.min_attendance,
      parseInt(body.income_threshold) || scholarship.income_threshold,
      !!body.covers_tuition, !!body.covers_feeding, !!body.covers_transport,
      !!body.covers_books, !!body.covers_uniform,
      body.application_deadline || scholarship.application_deadline,
      (body.academic_year || '').trim() || scholarship.academic_year,
      id, tid
    ]);

    console.log('[ScholarshipManager] Scholarship ' + id + ' edited by user=' + user.id);
    req.session.flash = { type: 'success', msg: 'Scholarship updated successfully.' };
    res.redirect('/scholarships/' + id);
  }));

  console.log('[ScholarshipManager] Module loaded successfully');
};
