// ============================================================
// VOLUNTEER MANAGER MODULE — Multi-Tenant SaaS Platform
// Volunteer registration, scheduling, hours tracking, event
// assignments, check-in/out, reports, and analytics.
// ============================================================
// Usage in server.js:
//   const volunteerManager = require('./volunteer-manager');
//   volunteerManager(app, db, pool, renderPage, esc);
// ============================================================

'use strict';

// ============================================================
// MODULE ENTRY POINT
// ============================================================
module.exports = function volunteerManager(app, db, pool, renderPage, esc) {

  const requireAuth = (req, res, next) => {
    if (!req.session || !req.session.user) return res.redirect('/login');
    next();
  };

  const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  if (!esc) esc = (s) => String(s == null ? '' : (typeof s === 'object' ? JSON.stringify(s) : s)).replace(/([&<>"'])/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  const fmtMoney = (n) => 'UGX ' + Number(n || 0).toLocaleString();
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '\u2014';
  const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '\u2014';
  const today = () => new Date().toISOString().split('T')[0];
  const pct = (n, d) => d > 0 ? Math.round((n / d) * 100) : 0;

  // ============================================================
  // BADGE HELPERS
  // ============================================================
  function statusBadge(s) {
    const m = {
      active:      { bg: '#dcfce7', color: '#15803d', label: 'Active' },
      inactive:    { bg: '#f1f5f9', color: '#64748b', label: 'Inactive' },
      suspended:   { bg: '#fef9c3', color: '#a16207', label: 'Suspended' },
      blacklisted: { bg: '#fee2e2', color: '#dc2626', label: 'Blacklisted' },
      upcoming:    { bg: '#ccfbf1', color: '#0d9488', label: 'Upcoming' },
      in_progress: { bg: '#dbeafe', color: '#1d4ed8', label: 'In Progress' },
      completed:   { bg: '#dcfce7', color: '#15803d', label: 'Completed' },
      cancelled:   { bg: '#fee2e2', color: '#dc2626', label: 'Cancelled' },
      confirmed:   { bg: '#dcfce7', color: '#15803d', label: 'Confirmed' },
      tentatively: { bg: '#fef9c3', color: '#a16207', label: 'Tentative' },
      declined:    { bg: '#fee2e2', color: '#dc2626', label: 'Declined' },
      no_show:     { bg: '#f1f5f9', color: '#64748b', label: 'No Show' }
    };
    const v = m[s] || { bg: '#f1f5f9', color: '#475569', label: s || 'Unknown' };
    return '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600;background:' + v.bg + ';color:' + v.color + '">' + esc(v.label) + '</span>';
  }

  function starsHtml(rating) {
    if (!rating || rating < 1) return '<span style="color:#cbd5e1;font-size:13px">No rating</span>';
    let html = '';
    for (let i = 1; i <= 5; i++) {
      html += i <= rating
        ? '<span style="color:#f59e0b;font-size:16px">\u2605</span>'
        : '<span style="color:#e2e8f0;font-size:16px">\u2605</span>';
    }
    return html + ' <span style="font-size:12px;color:#64748b;font-weight:600">' + rating + '.0</span>';
  }

  function eventTypeBadge(t) {
    const colors = {
      community_service: '#0d9488', school_support: '#1d4ed8', church_ministry: '#7c3aed',
      sports: '#ea580c', fundraiser: '#059669', cleanup: '#0891b2',
      mentoring: '#c2410c', tutoring: '#6366f1'
    };
    const label = (t || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const col = colors[t] || '#475569';
    return '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600;background:' + col + '14;color:' + col + '">' + esc(label) + '</span>';
  }

  function progressBar(current, max, color) {
    const p = max > 0 ? Math.min(pct(current, max), 100) : 0;
    const col = color || '#0d9488';
    return '<div style="display:flex;align-items:center;gap:8px">' +
      '<div style="flex:1;height:8px;background:#f1f5f9;border-radius:10px;overflow:hidden">' +
      '<div style="height:100%;width:' + p + '%;background:' + col + ';border-radius:10px;transition:.3s"></div>' +
      '</div>' +
      '<span style="font-size:12px;font-weight:700;color:' + col + '">' + current + (max > 0 ? '/' + max : '') + '</span>' +
      '</div>';
  }

  function skillTag(skill) {
    return '<span style="display:inline-flex;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;background:#ccfbf1;color:#0d9488;border:1px solid #99f6e4">' + esc(skill) + '</span>';
  }

  // ============================================================
  // SHARED CSS
  // ============================================================
  const VOL_CSS = '<style>' +
    '.vol-nav{display:flex;gap:6px;margin-bottom:20px;flex-wrap:wrap}' +
    '.vol-nav a{padding:8px 16px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#475569;background:#f0fdfa;transition:.15s;border:1px solid #ccfbf1}' +
    '.vol-nav a:hover{background:#ccfbf1;color:#0d9488}.vol-nav a.active{background:#0d9488;color:#fff;border-color:#0d9488}' +
    '.vol-btn{display:inline-flex;align-items:center;gap:6px;padding:9px 18px;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:.15s}' +
    '.vol-btn:hover{opacity:.9;transform:translateY(-1px)}' +
    '.vol-btn-primary{background:#0d9488;color:#fff}.vol-btn-primary:hover{background:#0f766e}' +
    '.vol-btn-accent{background:#2dd4bf;color:#fff}.vol-btn-accent:hover{background:#14b8a6}' +
    '.vol-btn-success{background:#059669;color:#fff}.vol-btn-success:hover{background:#047857}' +
    '.vol-btn-danger{background:#fee2e2;color:#dc2626;border:1px solid #fecaca}' +
    '.vol-btn-secondary{background:#f0fdfa;color:#0d9488;border:1px solid #99f6e4}' +
    '.vol-btn-ghost{background:transparent;color:#64748b;border:1px solid #e2e8f0}' +
    '.vol-btn-warning{background:#fef9c3;color:#a16207;border:1px solid #fde68a}' +
    '.vol-table{width:100%;border-collapse:collapse;font-size:13px}' +
    '.vol-table th{padding:11px 14px;text-align:left;border-bottom:2px solid #ccfbf1;color:#0f766e;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#f0fdfa}' +
    '.vol-table td{padding:10px 14px;border-bottom:1px solid #f0fdfa;color:#1e293b}' +
    '.vol-table tr:hover{background:#f0fdfa80}' +
    '.vol-filter{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:end}' +
    '.vol-filter label{display:block;font-size:12px;font-weight:600;color:#0f766e;margin-bottom:4px}' +
    '.vol-filter input,.vol-filter select{padding:8px 14px;border:2px solid #ccfbf1;border-radius:10px;font-size:13px;background:#fff}' +
    '.vol-filter input:focus,.vol-filter select:focus{outline:none;border-color:#0d9488;box-shadow:0 0 0 3px #ccfbf1}' +
    '.vol-card{background:#fff;border:1px solid #ccfbf1;border-radius:14px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(13,148,136,0.06)}' +
    '.vol-stat-card{background:#fff;border:1px solid #ccfbf1;border-radius:14px;padding:20px;box-shadow:0 1px 3px rgba(13,148,136,0.06)}' +
    '.vol-stat-num{font-size:28px;font-weight:800;color:#0d9488;line-height:1.1}' +
    '.vol-stat-label{font-size:11px;font-weight:600;color:#0f766e;text-transform:uppercase;letter-spacing:.3px;margin-top:4px}' +
    '.vol-stat-icon{width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:20px}' +
    '.vol-form-group{margin-bottom:16px}' +
    '.vol-form-group label{display:block;font-size:13px;font-weight:600;color:#0f766e;margin-bottom:6px}' +
    '.vol-form-group input,.vol-form-group select,.vol-form-group textarea{width:100%;padding:10px 14px;border:2px solid #ccfbf1;border-radius:10px;font-size:14px;font-family:inherit;box-sizing:border-box;transition:.15s}' +
    '.vol-form-group input:focus,.vol-form-group select:focus,.vol-form-group textarea:focus{outline:none;border-color:#0d9488;box-shadow:0 0 0 3px #ccfbf1}' +
    '.vol-form-group textarea{resize:vertical;min-height:80px}' +
    '.vol-grid-2{display:grid;grid-template-columns:1fr 1fr;gap:16px}' +
    '.vol-grid-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px}' +
    '.vol-grid-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px}' +
    '.vol-pagination{display:flex;gap:4px;align-items:center;justify-content:center;margin-top:16px}' +
    '.vol-pagination a,.vol-pagination span{padding:6px 12px;border-radius:8px;font-size:12px;font-weight:600;text-decoration:none;border:1px solid #ccfbf1}' +
    '.vol-pagination a{color:#0d9488;background:#fff}.vol-pagination a:hover{background:#f0fdfa}' +
    '.vol-pagination span.current{background:#0d9488;color:#fff;border-color:#0d9488}' +
    '.vol-timeline{position:relative;padding-left:28px}' +
    '.vol-timeline::before{content:"";position:absolute;left:10px;top:0;bottom:0;width:2px;background:#ccfbf1}' +
    '.vol-timeline-item{position:relative;margin-bottom:18px}' +
    '.vol-timeline-item::before{content:"";position:absolute;left:-22px;top:4px;width:12px;height:12px;border-radius:50%;background:#0d9488;border:2px solid #fff;box-shadow:0 0 0 2px #ccfbf1}' +
    '.vol-timeline-item.checkout::before{background:#059669}' +
    '.vol-timeline-item.noshow::before{background:#dc2626}' +
    '.vol-alert{padding:12px 16px;border-radius:10px;font-size:13px;font-weight:500;margin-bottom:16px;display:flex;align-items:center;gap:8px}' +
    '.vol-alert-success{background:#dcfce7;color:#15803d;border:1px solid #bbf7d0}' +
    '.vol-alert-error{background:#fee2e2;color:#dc2626;border:1px solid #fecaca}' +
    '.vol-alert-warning{background:#fef3c7;color:#b45309;border:1px solid #fde68a}' +
    '.vol-volunteer-card{background:#fff;border:1px solid #ccfbf1;border-radius:14px;padding:16px;display:flex;gap:14px;align-items:flex-start;transition:.15s;box-shadow:0 1px 2px rgba(13,148,136,0.04)}' +
    '.vol-volunteer-card:hover{border-color:#2dd4bf;box-shadow:0 4px 12px rgba(13,148,136,0.1)}' +
    '.vol-volunteer-avatar{width:48px;height:48px;border-radius:12px;background:linear-gradient(135deg,#ccfbf1,#99f6e4);display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:800;color:#0d9488;flex-shrink:0}' +
    '.vol-event-card{background:#fff;border:1px solid #ccfbf1;border-radius:14px;padding:18px;transition:.15s;box-shadow:0 1px 2px rgba(13,148,136,0.04)}' +
    '.vol-event-card:hover{border-color:#2dd4bf;box-shadow:0 4px 12px rgba(13,148,136,0.1)}' +
    '.vol-empty{text-align:center;padding:40px;color:#94a3b8;font-size:14px}' +
    '.vol-checkbox-grid{display:flex;flex-wrap:wrap;gap:8px}' +
    '.vol-checkbox-grid label{display:flex;align-items:center;gap:6px;padding:6px 12px;border:2px solid #ccfbf1;border-radius:10px;font-size:13px;cursor:pointer;transition:.15s;background:#f0fdfa;color:#0f766e}' +
    '.vol-checkbox-grid label:hover{border-color:#2dd4bf;background:#ccfbf1}' +
    '.vol-checkbox-grid input:checked + span{font-weight:700;color:#0d9488}' +
    '.vol-checkbox-grid input{accent-color:#0d9488}' +
    '@media(max-width:768px){' +
    '.vol-nav{gap:4px}.vol-nav a{padding:6px 12px;font-size:12px}' +
    '.vol-grid-2,.vol-grid-3{grid-template-columns:1fr}' +
    '.vol-filter{flex-direction:column}' +
    '}' +
    '</style>';

  // ============================================================
  // NAVIGATION HELPER
  // ============================================================
  const nav = (active) => '<div class="vol-nav">' +
    '<a href="/volunteers" class="' + (active === 'dash' ? 'active' : '') + '">\uD83D\uDCCA Dashboard</a>' +
    '<a href="/volunteers/directory" class="' + (active === 'directory' ? 'active' : '') + '">\uD83D\uDC65 Volunteers</a>' +
    '<a href="/volunteers/register" class="' + (active === 'register' ? 'active' : '') + '">\u2795 Register</a>' +
    '<a href="/volunteers/events" class="' + (active === 'events' ? 'active' : '') + '">\uD83D\uDCC5 Events</a>' +
    '<a href="/volunteers/reports" class="' + (active === 'reports' ? 'active' : '') + '">\uD83D\uDCCA Reports</a>' +
    '</div>';

  // ============================================================
  // FLASH MESSAGE HELPER
  // ============================================================
  const flashMsg = (req) => {
    const f = req.session.flash;
    if (!f) return '';
    delete req.session.flash;
    var cls = f.type === 'error' ? 'vol-alert-error' : f.type === 'warning' ? 'vol-alert-warning' : 'vol-alert-success';
    var icon = f.type === 'error' ? '\u274C' : f.type === 'warning' ? '\u26A0\uFE0F' : '\u2705';
    return '<div class="vol-alert ' + cls + '">' + icon + ' ' + esc(f.msg) + '</div>';
  };

  // ============================================================
  // PAGINATION HELPER
  // ============================================================
  const paginate = (currentPage, totalPages, baseUrl) => {
    if (totalPages <= 1) return '';
    var pages = [];
    var maxShow = 5;
    var start = Math.max(1, currentPage - Math.floor(maxShow / 2));
    var end = Math.min(totalPages, start + maxShow - 1);
    if (end - start < maxShow - 1) start = Math.max(1, end - maxShow + 1);
    if (currentPage > 1) pages.push('<a href="' + baseUrl + '&page=' + (currentPage - 1) + '">\u2190 Prev</a>');
    for (var i = start; i <= end; i++) {
      pages.push(i === currentPage ? '<span class="current">' + i + '</span>' : '<a href="' + baseUrl + '&page=' + i + '">' + i + '</a>');
    }
    if (currentPage < totalPages) pages.push('<a href="' + baseUrl + '&page=' + (currentPage + 1) + '">Next \u2192</a>');
    return '<div class="vol-pagination">' + pages.join('') + '</div>';
  };

  // ============================================================
  // DATABASE MIGRATIONS
  // ============================================================
  (async () => {
    var c = await pool.connect().catch(function() { return null; });
    if (!c) { console.error('[Volunteers] Cannot connect to DB'); return; }
    try {
      // -- Table 1: volunteers ----------------------------------
      await c.query('CREATE TABLE IF NOT EXISTS volunteers (' +
        'id SERIAL PRIMARY KEY,' +
        'tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,' +
        'first_name VARCHAR(100) NOT NULL,' +
        'last_name VARCHAR(100) NOT NULL,' +
        'email VARCHAR(200),' +
        'phone VARCHAR(30),' +
        'address TEXT,' +
        'date_of_birth DATE,' +
        'gender VARCHAR(10),' +
        'occupation VARCHAR(100),' +
        'organization VARCHAR(200),' +
        'skills TEXT[],' +
        'emergency_contact_name VARCHAR(200),' +
        'emergency_contact_phone VARCHAR(30),' +
        'id_number VARCHAR(100),' +
        'photo_path VARCHAR(500),' +
        'status VARCHAR(20) DEFAULT \'active\',' +
        'background_check BOOLEAN DEFAULT false,' +
        'background_check_date DATE,' +
        'notes TEXT,' +
        'total_hours DECIMAL(8,1) DEFAULT 0,' +
        'total_events INTEGER DEFAULT 0,' +
        'joined_date DATE DEFAULT CURRENT_DATE,' +
        'created_at TIMESTAMPTZ DEFAULT NOW(),' +
        'updated_at TIMESTAMPTZ DEFAULT NOW()' +
      ')');

      var vCols = [
        ['first_name', 'VARCHAR(100) NOT NULL DEFAULT \'\''],
        ['last_name', 'VARCHAR(100) NOT NULL DEFAULT \'\''],
        ['email', 'VARCHAR(200)'],
        ['phone', 'VARCHAR(30)'],
        ['address', 'TEXT'],
        ['date_of_birth', 'DATE'],
        ['gender', 'VARCHAR(10)'],
        ['occupation', 'VARCHAR(100)'],
        ['organization', 'VARCHAR(200)'],
        ['skills', 'TEXT[]'],
        ['emergency_contact_name', 'VARCHAR(200)'],
        ['emergency_contact_phone', 'VARCHAR(30)'],
        ['id_number', 'VARCHAR(100)'],
        ['photo_path', 'VARCHAR(500)'],
        ['status', 'VARCHAR(20) DEFAULT \'active\''],
        ['background_check', 'BOOLEAN DEFAULT false'],
        ['background_check_date', 'DATE'],
        ['notes', 'TEXT'],
        ['total_hours', 'DECIMAL(8,1) DEFAULT 0'],
        ['total_events', 'INTEGER DEFAULT 0'],
        ['joined_date', 'DATE DEFAULT CURRENT_DATE'],
        ['created_at', 'TIMESTAMPTZ DEFAULT NOW()'],
        ['updated_at', 'TIMESTAMPTZ DEFAULT NOW()']
      ];
      for (var vi = 0; vi < vCols.length; vi++) {
        try { await c.query('ALTER TABLE volunteers ADD COLUMN IF NOT EXISTS ' + vCols[vi][0] + ' ' + vCols[vi][1]); } catch(e) {}
      }

      // -- Table 2: volunteer_events ----------------------------
      await c.query('CREATE TABLE IF NOT EXISTS volunteer_events (' +
        'id SERIAL PRIMARY KEY,' +
        'tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,' +
        'name VARCHAR(200) NOT NULL,' +
        'description TEXT,' +
        'event_type VARCHAR(30),' +
        'location VARCHAR(200),' +
        'start_date TIMESTAMPTZ NOT NULL,' +
        'end_date TIMESTAMPTZ NOT NULL,' +
        'max_volunteers INTEGER DEFAULT 0,' +
        'required_skills TEXT[],' +
        'coordinator_id INTEGER REFERENCES users(id),' +
        'status VARCHAR(20) DEFAULT \'upcoming\',' +
        'volunteer_count INTEGER DEFAULT 0,' +
        'total_hours_contributed DECIMAL(8,1) DEFAULT 0,' +
        'created_by INTEGER REFERENCES users(id),' +
        'created_at TIMESTAMPTZ DEFAULT NOW(),' +
        'updated_at TIMESTAMPTZ DEFAULT NOW()' +
      ')');

      var eCols = [
        ['name', 'VARCHAR(200) NOT NULL DEFAULT \'\''],
        ['description', 'TEXT'],
        ['event_type', 'VARCHAR(30)'],
        ['location', 'VARCHAR(200)'],
        ['start_date', 'TIMESTAMPTZ NOT NULL'],
        ['end_date', 'TIMESTAMPTZ NOT NULL'],
        ['max_volunteers', 'INTEGER DEFAULT 0'],
        ['required_skills', 'TEXT[]'],
        ['coordinator_id', 'INTEGER REFERENCES users(id)'],
        ['status', 'VARCHAR(20) DEFAULT \'upcoming\''],
        ['volunteer_count', 'INTEGER DEFAULT 0'],
        ['total_hours_contributed', 'DECIMAL(8,1) DEFAULT 0'],
        ['created_by', 'INTEGER REFERENCES users(id)'],
        ['created_at', 'TIMESTAMPTZ DEFAULT NOW()'],
        ['updated_at', 'TIMESTAMPTZ DEFAULT NOW()']
      ];
      for (var ei = 0; ei < eCols.length; ei++) {
        try { await c.query('ALTER TABLE volunteer_events ADD COLUMN IF NOT EXISTS ' + eCols[ei][0] + ' ' + eCols[ei][1]); } catch(e) {}
      }

      // -- Table 3: volunteer_assignments -----------------------
      await c.query('CREATE TABLE IF NOT EXISTS volunteer_assignments (' +
        'id SERIAL PRIMARY KEY,' +
        'tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,' +
        'volunteer_id INTEGER NOT NULL REFERENCES volunteers(id) ON DELETE CASCADE,' +
        'event_id INTEGER NOT NULL REFERENCES volunteer_events(id) ON DELETE CASCADE,' +
        'role VARCHAR(100),' +
        'assigned_by INTEGER REFERENCES users(id),' +
        'assigned_at TIMESTAMPTZ DEFAULT NOW(),' +
        'status VARCHAR(20) DEFAULT \'confirmed\',' +
        'check_in_time TIMESTAMPTZ,' +
        'check_out_time TIMESTAMPTZ,' +
        'hours_worked DECIMAL(5,1) DEFAULT 0,' +
        'rating INTEGER,' +
        'feedback TEXT,' +
        'notes TEXT,' +
        'created_at TIMESTAMPTZ DEFAULT NOW(),' +
        'updated_at TIMESTAMPTZ DEFAULT NOW()' +
      ')');

      var aCols = [
        ['volunteer_id', 'INTEGER NOT NULL REFERENCES volunteers(id) ON DELETE CASCADE'],
        ['event_id', 'INTEGER NOT NULL REFERENCES volunteer_events(id) ON DELETE CASCADE'],
        ['role', 'VARCHAR(100)'],
        ['assigned_by', 'INTEGER REFERENCES users(id)'],
        ['assigned_at', 'TIMESTAMPTZ DEFAULT NOW()'],
        ['status', 'VARCHAR(20) DEFAULT \'confirmed\''],
        ['check_in_time', 'TIMESTAMPTZ'],
        ['check_out_time', 'TIMESTAMPTZ'],
        ['hours_worked', 'DECIMAL(5,1) DEFAULT 0'],
        ['rating', 'INTEGER'],
        ['feedback', 'TEXT'],
        ['notes', 'TEXT'],
        ['created_at', 'TIMESTAMPTZ DEFAULT NOW()'],
        ['updated_at', 'TIMESTAMPTZ DEFAULT NOW()']
      ];
      for (var ai = 0; ai < aCols.length; ai++) {
        try { await c.query('ALTER TABLE volunteer_assignments ADD COLUMN IF NOT EXISTS ' + aCols[ai][0] + ' ' + aCols[ai][1]); } catch(e) {}
      }

      // -- Indexes ----------------------------------------------
      await c.query('CREATE INDEX IF NOT EXISTS idx_vol_tenant ON volunteers(tenant_id)');
      await c.query('CREATE INDEX IF NOT EXISTS idx_vol_status ON volunteers(tenant_id, status)');
      await c.query('CREATE INDEX IF NOT EXISTS idx_vol_name ON volunteers(tenant_id, first_name, last_name)');
      await c.query('CREATE INDEX IF NOT EXISTS idx_vol_email ON volunteers(tenant_id, email)');
      await c.query('CREATE INDEX IF NOT EXISTS idx_vol_phone ON volunteers(tenant_id, phone)');
      await c.query('CREATE INDEX IF NOT EXISTS idx_vol_joined ON volunteers(tenant_id, joined_date)');
      await c.query('CREATE INDEX IF NOT EXISTS idx_vol_skills ON volunteers USING gin(tenant_id, skills)');
      await c.query('CREATE INDEX IF NOT EXISTS idx_ve_tenant ON volunteer_events(tenant_id)');
      await c.query('CREATE INDEX IF NOT EXISTS idx_ve_status ON volunteer_events(tenant_id, status)');
      await c.query('CREATE INDEX IF NOT EXISTS idx_ve_type ON volunteer_events(tenant_id, event_type)');
      await c.query('CREATE INDEX IF NOT EXISTS idx_ve_dates ON volunteer_events(tenant_id, start_date, end_date)');
      await c.query('CREATE INDEX IF NOT EXISTS idx_ve_coordinator ON volunteer_events(tenant_id, coordinator_id)');
      await c.query('CREATE INDEX IF NOT EXISTS idx_va_tenant ON volunteer_assignments(tenant_id)');
      await c.query('CREATE INDEX IF NOT EXISTS idx_va_volunteer ON volunteer_assignments(tenant_id, volunteer_id)');
      await c.query('CREATE INDEX IF NOT EXISTS idx_va_event ON volunteer_assignments(tenant_id, event_id)');
      await c.query('CREATE INDEX IF NOT EXISTS idx_va_status ON volunteer_assignments(tenant_id, status)');
      await c.query('CREATE INDEX IF NOT EXISTS idx_va_unique ON volunteer_assignments(tenant_id, volunteer_id, event_id)');
      await c.query('CREATE INDEX IF NOT EXISTS idx_va_assigned ON volunteer_assignments(tenant_id, assigned_by)');

      // Unique constraint to prevent duplicate assignments
      try { await c.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_va_no_dupes ON volunteer_assignments(tenant_id, volunteer_id, event_id)'); } catch(e) {}

      console.log('[Volunteers] Migrations applied successfully');
    } catch (e) { console.error('[Volunteers] Migration error:', e.message); }
    finally { c.release(); }
  })();

  // ============================================================
  // ALL AVAILABLE SKILLS
  // ============================================================
  const ALL_SKILLS = ['Teaching', 'First Aid', 'IT', 'Carpentry', 'Counseling', 'Music', 'Cooking', 'Driving', 'Photography', 'Sports Coaching', 'Event Planning', 'Child Care', 'Elder Care', 'Translation', 'Writing', 'Graphic Design', 'Electrical', 'Plumbing', 'Farming', 'Public Speaking'];

  const EVENT_TYPES = ['community_service', 'school_support', 'church_ministry', 'sports', 'fundraiser', 'cleanup', 'mentoring', 'tutoring'];

  const ROLES = ['Team Lead', 'Helper', 'Facilitator', 'Medic', 'Coordinator', 'Photographer', 'Driver', 'Registration Desk', 'Setup Crew', 'Teardown Crew', 'General Volunteer', 'Mentor', 'Tutor'];

  // ============================================================
  // ROUTE 1: GET /volunteers — Dashboard
  // ============================================================
  app.get('/volunteers', requireAuth, ah(async function(req, res) {
    var user = req.session.user, tid = user.tenant_id;

    var totalVol = (await pool.query('SELECT COUNT(*)::int as cnt FROM volunteers WHERE tenant_id=$1', [tid])).rows[0].cnt;
    var activeMonth = (await pool.query(
      'SELECT COUNT(DISTINCT va.volunteer_id)::int as cnt FROM volunteer_assignments va JOIN volunteer_events ve ON ve.id = va.event_id WHERE va.tenant_id=$1 AND va.status IN (\'confirmed\',\'completed\') AND ve.start_date >= date_trunc(\'month\', CURRENT_DATE)', [tid]
    )).rows[0].cnt;
    var upcomingEvts = (await pool.query('SELECT COUNT(*)::int as cnt FROM volunteer_events WHERE tenant_id=$1 AND status IN (\'upcoming\',\'in_progress\')', [tid])).rows[0].cnt;
    var totalHours = (await pool.query('SELECT COALESCE(SUM(total_hours),0)::float as hrs FROM volunteers WHERE tenant_id=$1', [tid])).rows[0].hrs;

    // Recent activity (last 10 assignments)
    var recentActivity = (await pool.query(
      'SELECT va.*, v.first_name as vfn, v.last_name as vln, ve.name as event_name FROM volunteer_assignments va JOIN volunteers v ON v.id = va.volunteer_id JOIN volunteer_events ve ON ve.id = va.event_id WHERE va.tenant_id=$1 ORDER BY va.updated_at DESC NULLS LAST, va.created_at DESC LIMIT 10', [tid]
    )).rows;

    // Upcoming events list
    var upcomingList = (await pool.query(
      'SELECT ve.*, (SELECT COUNT(*)::int FROM volunteer_assignments WHERE tenant_id=$1 AND event_id=ve.id AND status!=\'declined\') as assigned_count FROM volunteer_events ve WHERE ve.tenant_id=$1 AND ve.status IN (\'upcoming\',\'in_progress\') ORDER BY ve.start_date ASC LIMIT 5', [tid]
    )).rows;

    // Top volunteers by hours
    var topVolunteers = (await pool.query(
      'SELECT id, first_name, last_name, total_hours, total_events, skills FROM volunteers WHERE tenant_id=$1 AND status=\'active\' ORDER BY total_hours DESC LIMIT 5', [tid]
    )).rows;

    var actRows = recentActivity.map(function(a) {
      return '<tr>' +
        '<td><a href="/volunteers/' + a.volunteer_id + '" style="color:#0d9488;text-decoration:none;font-weight:600">' + esc(a.vfn) + ' ' + esc(a.vln) + '</a></td>' +
        '<td><a href="/volunteers/events/' + a.event_id + '" style="color:#0d9488;text-decoration:none">' + esc(a.event_name) + '</a></td>' +
        '<td>' + statusBadge(a.status) + '</td>' +
        '<td>' + (a.check_in_time ? fmtDateTime(a.check_in_time) : '\u2014') + '</td>' +
        '<td style="font-weight:700">' + (a.hours_worked || 0) + 'h</td>' +
        '</tr>';
    }).join('');

    var evtCards = upcomingList.map(function(e) {
      var prog = progressBar(e.assigned_count, e.max_volunteers);
      return '<div class="vol-event-card">' +
        '<div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px;flex-wrap:wrap;gap:8px">' +
        '<div>' +
        '<a href="/volunteers/events/' + e.id + '" style="color:#0d9488;text-decoration:none;font-weight:700;font-size:14px">' + esc(e.name) + '</a>' +
        '<div style="font-size:12px;color:#64748b;margin-top:2px">' + eventTypeBadge(e.event_type) + ' \u00B7 ' + esc(e.location || 'TBD') + '</div>' +
        '</div>' +
        statusBadge(e.status) +
        '</div>' +
        '<div style="font-size:12px;color:#64748b;margin-bottom:8px">\uD83D\uDCC5 ' + fmtDateTime(e.start_date) + '</div>' +
        '<div>' + prog + '</div>' +
        '</div>';
    }).join('');

    var topRows = topVolunteers.map(function(v, i) {
      var initials = (v.first_name || '?')[0] + (v.last_name || '?')[0];
      var skillsHtml = (v.skills || []).slice(0, 3).map(skillTag).join(' ');
      return '<div class="vol-volunteer-card">' +
        '<div class="vol-volunteer-avatar">' + esc(initials) + '</div>' +
        '<div style="flex:1;min-width:0">' +
        '<a href="/volunteers/' + v.id + '" style="color:#1e293b;text-decoration:none;font-weight:700;font-size:14px">' + esc(v.first_name) + ' ' + esc(v.last_name) + '</a>' +
        '<div style="font-size:12px;color:#64748b;margin-top:2px">' + Number(v.total_hours || 0).toFixed(1) + ' hours \u00B7 ' + (v.total_events || 0) + ' events</div>' +
        '<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px">' + skillsHtml + '</div>' +
        '</div>' +
        '<div style="text-align:right;flex-shrink:0">' +
        '<div style="font-size:11px;color:#94a3b8">#' + (i + 1) + '</div>' +
        '<div style="font-size:18px;font-weight:800;color:#0d9488">' + Number(v.total_hours || 0).toFixed(1) + 'h</div>' +
        '</div>' +
        '</div>';
    }).join('');

    var html = VOL_CSS + '<div style="max-width:1200px;margin:0 auto">' +
      nav('dash') +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">' +
      '<div><h1 style="font-size:24px;color:#1e293b">\uD83D\uDC65 Volunteer Management</h1>' +
      '<p style="font-size:13px;color:#94a3b8;margin-top:2px">Manage volunteers, events, schedules, and track hours</p></div>' +
      '<div style="display:flex;gap:8px">' +
      '<a href="/volunteers/register" class="vol-btn vol-btn-primary">\u2795 Register Volunteer</a>' +
      '<a href="/volunteers/events/create" class="vol-btn vol-btn-secondary">\uD83D\uDCC5 Create Event</a>' +
      '</div></div>' +

      // Stats cards
      '<div class="vol-grid-stats" style="margin-bottom:20px">' +
      '<div class="vol-stat-card" style="display:flex;align-items:center;gap:14px">' +
      '<div class="vol-stat-icon" style="background:#ccfbf1;color:#0d9488">\uD83D\uDC65</div>' +
      '<div><div class="vol-stat-num">' + totalVol + '</div><div class="vol-stat-label">Total Volunteers</div></div></div>' +
      '<div class="vol-stat-card" style="display:flex;align-items:center;gap:14px">' +
      '<div class="vol-stat-icon" style="background:#dbeafe;color:#1d4ed8">\uD83D\uDD04</div>' +
      '<div><div class="vol-stat-num">' + activeMonth + '</div><div class="vol-stat-label">Active This Month</div></div></div>' +
      '<div class="vol-stat-card" style="display:flex;align-items:center;gap:14px">' +
      '<div class="vol-stat-icon" style="background:#f3e8ff;color:#7c3aed">\uD83D\uDCC5</div>' +
      '<div><div class="vol-stat-num">' + upcomingEvts + '</div><div class="vol-stat-label">Upcoming Events</div></div></div>' +
      '<div class="vol-stat-card" style="display:flex;align-items:center;gap:14px">' +
      '<div class="vol-stat-icon" style="background:#fef9c3;color:#a16207">\u23F1</div>' +
      '<div><div class="vol-stat-num">' + Number(totalHours).toFixed(0) + '</div><div class="vol-stat-label">Total Hours</div></div></div>' +
      '</div>' +

      // Top Volunteers + Upcoming Events
      '<div class="vol-grid-2" style="margin-bottom:16px">' +
      '<div class="vol-card">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">' +
      '<h3 style="font-size:15px;color:#1e293b;margin:0">\uD83C\uDFC6 Top Volunteers</h3>' +
      '<a href="/volunteers/directory" style="font-size:12px;color:#0d9488;text-decoration:none">View All \u2192</a>' +
      '</div>' +
      '<div style="display:flex;flex-direction:column;gap:10px">' + (topRows || '<p class="vol-empty">No volunteers yet</p>') + '</div>' +
      '</div>' +
      '<div class="vol-card">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">' +
      '<h3 style="font-size:15px;color:#1e293b;margin:0">\uD83D\uDCC5 Upcoming Events</h3>' +
      '<a href="/volunteers/events" style="font-size:12px;color:#0d9488;text-decoration:none">View All \u2192</a>' +
      '</div>' +
      '<div style="display:flex;flex-direction:column;gap:10px">' + (evtCards || '<p class="vol-empty">No upcoming events</p>') + '</div>' +
      '</div>' +
      '</div>' +

      // Recent Activity
      '<div class="vol-card">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">' +
      '<h3 style="font-size:15px;color:#1e293b;margin:0">\uD83D\uDD04 Recent Activity</h3>' +
      '</div>' +
      '<div style="overflow-x:auto"><table class="vol-table">' +
      '<thead><tr><th>Volunteer</th><th>Event</th><th>Status</th><th>Check-In</th><th>Hours</th></tr></thead>' +
      '<tbody>' + (actRows || '<tr><td colspan="5" class="vol-empty">No recent activity</td></tr>') + '</tbody>' +
      '</table></div></div>' +
      '</div>';

    res.send(renderPage('Volunteer Dashboard', html, user, req));
  }));

  // ============================================================
  // ROUTE 2: GET /volunteers/register — Registration Form
  // ============================================================
  app.get('/volunteers/register', requireAuth, ah(async function(req, res) {
    var user = req.session.user;
    var skillsCheckboxes = ALL_SKILLS.map(function(s) {
      return '<label><input type="checkbox" name="skills" value="' + esc(s) + '"> <span>' + esc(s) + '</span></label>';
    }).join('');

    var html = VOL_CSS + '<div style="max-width:800px;margin:0 auto">' +
      nav('register') +
      flashMsg(req) +
      '<a href="/volunteers" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">\u2190 Back to Dashboard</a>' +
      '<div class="vol-card" style="padding:28px">' +
      '<h2 style="margin:0 0 4px;color:#1e293b">\u2795 Register New Volunteer</h2>' +
      '<p style="font-size:13px;color:#94a3b8;margin-bottom:24px">Add a new volunteer to the platform with their personal info, skills, and emergency contact</p>' +
      '<form method="POST" action="/volunteers/register" style="display:flex;flex-direction:column;gap:20px">' +

      // Personal Info Section
      '<div>' +
      '<h3 style="font-size:14px;color:#0f766e;margin:0 0 12px;font-weight:700">\uD83D\uDC64 Personal Information</h3>' +
      '<div class="vol-grid-2">' +
      '<div class="vol-form-group"><label>First Name *</label><input type="text" name="first_name" required placeholder="Enter first name"></div>' +
      '<div class="vol-form-group"><label>Last Name *</label><input type="text" name="last_name" required placeholder="Enter last name"></div>' +
      '</div>' +
      '<div class="vol-grid-2">' +
      '<div class="vol-form-group"><label>Email</label><input type="email" name="email" placeholder="volunteer@email.com"></div>' +
      '<div class="vol-form-group"><label>Phone *</label><input type="tel" name="phone" required placeholder="+256 700 000 000"></div>' +
      '</div>' +
      '<div class="vol-grid-2">' +
      '<div class="vol-form-group"><label>Date of Birth</label><input type="date" name="date_of_birth"></div>' +
      '<div class="vol-form-group"><label>Gender</label><select name="gender"><option value="">Select...</option><option value="Male">Male</option><option value="Female">Female</option><option value="Other">Other</option></select></div>' +
      '</div>' +
      '<div class="vol-grid-2">' +
      '<div class="vol-form-group"><label>Occupation</label><input type="text" name="occupation" placeholder="e.g., Teacher, Student, Engineer"></div>' +
      '<div class="vol-form-group"><label>Organization / Church</label><input type="text" name="organization" placeholder="Company or church name"></div>' +
      '</div>' +
      '<div class="vol-form-group"><label>Address</label><textarea name="address" rows="2" placeholder="Physical address"></textarea></div>' +
      '<div class="vol-form-group"><label>ID Number</label><input type="text" name="id_number" placeholder="National ID or passport number"></div>' +
      '</div>' +

      // Skills Section
      '<div>' +
      '<h3 style="font-size:14px;color:#0f766e;margin:0 0 12px;font-weight:700">\uD83D\uDEE0\uFE0F Skills</h3>' +
      '<div class="vol-checkbox-grid">' + skillsCheckboxes + '</div>' +
      '</div>' +

      // Emergency Contact Section
      '<div>' +
      '<h3 style="font-size:14px;color:#0f766e;margin:0 0 12px;font-weight:700">\uD83D\uDCDE Emergency Contact</h3>' +
      '<div class="vol-grid-2">' +
      '<div class="vol-form-group"><label>Contact Name</label><input type="text" name="emergency_contact_name" placeholder="Emergency contact name"></div>' +
      '<div class="vol-form-group"><label>Contact Phone</label><input type="tel" name="emergency_contact_phone" placeholder="+256 700 000 000"></div>' +
      '</div></div>' +

      // Background Check & Notes
      '<div>' +
      '<h3 style="font-size:14px;color:#0f766e;margin:0 0 12px;font-weight:700">\u2705 Additional</h3>' +
      '<div class="vol-form-group"><label style="display:flex;align-items:center;gap:8px;cursor:pointer">' +
      '<input type="checkbox" name="background_check" value="true" style="width:18px;height:18px;accent-color:#0d9488"> Background Check Passed</label></div>' +
      '<div class="vol-form-group"><label>Notes</label><textarea name="notes" rows="3" placeholder="Additional notes about the volunteer..."></textarea></div>' +
      '</div>' +

      '<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:8px">' +
      '<a href="/volunteers" class="vol-btn vol-btn-ghost">Cancel</a>' +
      '<button type="submit" class="vol-btn vol-btn-primary" style="padding:12px 28px">\u2795 Register Volunteer</button>' +
      '</div>' +
      '</form></div></div>';

    res.send(renderPage('Register Volunteer', html, user, req));
  }));

  // ============================================================
  // ROUTE 3: POST /volunteers/register — Save Volunteer
  // ============================================================
  app.post('/volunteers/register', requireAuth, ah(async function(req, res) {
    var user = req.session.user, tid = user.tenant_id;
    var body = req.body;
    var firstName = (body.first_name || '').trim();
    var lastName = (body.last_name || '').trim();
    var phone = (body.phone || '').trim();
    var email = (body.email || '').trim() || null;

    if (!firstName || !lastName || !phone) {
      req.session.flash = { type: 'error', msg: 'First name, last name, and phone are required.' };
      return res.redirect('/volunteers/register');
    }

    // Check phone uniqueness
    var phoneExists = (await pool.query('SELECT id FROM volunteers WHERE tenant_id=$1 AND phone=$2', [tid, phone])).rows[0];
    if (phoneExists) {
      req.session.flash = { type: 'error', msg: 'A volunteer with this phone number already exists.' };
      return res.redirect('/volunteers/register');
    }

    // Check email uniqueness if provided
    if (email) {
      var emailExists = (await pool.query('SELECT id FROM volunteers WHERE tenant_id=$1 AND email=$2', [tid, email])).rows[0];
      if (emailExists) {
        req.session.flash = { type: 'error', msg: 'A volunteer with this email already exists.' };
        return res.redirect('/volunteers/register');
      }
    }

    // Collect skills
    var skills = body.skills;
    if (!Array.isArray(skills)) skills = skills ? [skills] : [];

    var bgCheck = body.background_check === 'true';
    var result = await pool.query(
      'INSERT INTO volunteers (tenant_id, first_name, last_name, email, phone, address, date_of_birth, gender, occupation, organization, skills, emergency_contact_name, emergency_contact_phone, id_number, background_check, background_check_date, notes, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,\'active\') RETURNING id',
      [tid, firstName, lastName, email, phone || null,
       (body.address || '').trim() || null,
       body.date_of_birth || null,
       body.gender || null,
       (body.occupation || '').trim() || null,
       (body.organization || '').trim() || null,
       skills.length > 0 ? skills : null,
       (body.emergency_contact_name || '').trim() || null,
       (body.emergency_contact_phone || '').trim() || null,
       (body.id_number || '').trim() || null,
       bgCheck,
       bgCheck ? new Date() : null,
       (body.notes || '').trim() || null]
    );

    console.log('[Volunteers] Registered: ' + firstName + ' ' + lastName + ' (#' + result.rows[0].id + ')');
    req.session.flash = { type: 'success', msg: firstName + ' ' + lastName + ' has been registered successfully!' };
    res.redirect('/volunteers/directory');
  }));

  // ============================================================
  // ROUTE 4: GET /volunteers/directory — Volunteer Directory
  // ============================================================
  app.get('/volunteers/directory', requireAuth, ah(async function(req, res) {
    var user = req.session.user, tid = user.tenant_id;
    var search = req.query.search || '';
    var skill = req.query.skill || '';
    var status = req.query.status || '';
    var page = parseInt(req.query.page) || 1;
    var perPage = 20;
    var offset = (page - 1) * perPage;

    var where = ['v.tenant_id=$1'];
    var params = [tid];
    var pi = 2;

    if (search) {
      where.push('(v.first_name ILIKE $' + pi + ' OR v.last_name ILIKE $' + pi + ' OR v.email ILIKE $' + pi + ' OR v.organization ILIKE $' + pi + ')');
      params.push('%' + search + '%');
      pi++;
    }
    if (skill) {
      where.push('v.skills @> $' + pi);
      params.push('{' + skill + '}');
      pi++;
    }
    if (status) {
      where.push('v.status=$' + pi);
      params.push(status);
      pi++;
    }

    var countResult = await pool.query('SELECT COUNT(*)::int as cnt FROM volunteers v WHERE ' + where.join(' AND '), params);
    var totalRows = countResult.rows[0].cnt;
    var totalPages = Math.ceil(totalRows / perPage);

    var volunteers = (await pool.query(
      'SELECT v.* FROM volunteers v WHERE ' + where.join(' AND ') + ' ORDER BY v.created_at DESC LIMIT $' + pi + ' OFFSET $' + (pi + 1), params.concat([perPage, offset])
    )).rows;

    var baseUrl = '/volunteers/directory?search=' + encodeURIComponent(search) + '&skill=' + encodeURIComponent(skill) + '&status=' + encodeURIComponent(status);

    var rows = volunteers.map(function(v) {
      var initials = (v.first_name || '?')[0] + (v.last_name || '?')[0];
      var skillsHtml = (v.skills || []).slice(0, 3).map(skillTag).join(' ');
      var extra = (v.skills || []).length > 3 ? '<span style="font-size:11px;color:#94a3b8">+' + (v.skills.length - 3) + ' more</span>' : '';
      return '<tr>' +
        '<td>' +
        '<div style="display:flex;align-items:center;gap:10px">' +
        '<div class="vol-volunteer-avatar" style="width:36px;height:36px;font-size:13px;border-radius:8px">' + esc(initials) + '</div>' +
        '<a href="/volunteers/' + v.id + '" style="color:#0d9488;text-decoration:none;font-weight:700">' + esc(v.first_name) + ' ' + esc(v.last_name) + '</a>' +
        '</div></td>' +
        '<td style="font-size:12px">' + esc(v.email || '\u2014') + '</td>' +
        '<td style="font-size:12px">' + esc(v.phone || '\u2014') + '</td>' +
        '<td>' + statusBadge(v.status) + '</td>' +
        '<td><div style="display:flex;flex-wrap:wrap;gap:4px">' + skillsHtml + ' ' + extra + '</div></td>' +
        '<td style="font-weight:700;color:#0d9488">' + Number(v.total_hours || 0).toFixed(1) + 'h</td>' +
        '<td>' + fmtDate(v.joined_date) + '</td>' +
        '<td><a href="/volunteers/' + v.id + '" class="vol-btn vol-btn-secondary" style="padding:5px 12px">View</a></td>' +
        '</tr>';
    }).join('');

    var skillOptions = ALL_SKILLS.map(function(s) {
      return '<option value="' + esc(s) + '"' + (skill === s ? ' selected' : '') + '>' + esc(s) + '</option>';
    }).join('');

    var html = VOL_CSS + '<div style="max-width:1200px;margin:0 auto">' +
      nav('directory') +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">' +
      '<div><h1 style="font-size:22px;color:#1e293b">\uD83D\uDC65 Volunteer Directory</h1>' +
      '<p style="font-size:13px;color:#94a3b8;margin-top:2px">' + totalRows + ' volunteer' + (totalRows !== 1 ? 's' : '') + ' registered</p></div>' +
      '<a href="/volunteers/register" class="vol-btn vol-btn-primary">\u2795 Register Volunteer</a>' +
      '</div>' +

      '<div class="vol-filter">' +
      '<div><label>Search</label><form method="GET" style="display:flex;gap:6px"><input type="text" name="search" value="' + esc(search) + '" placeholder="Name, email, organization..." style="width:220px"><input type="hidden" name="skill" value="' + esc(skill) + '"><input type="hidden" name="status" value="' + esc(status) + '"><button class="vol-btn vol-btn-primary" style="padding:8px 14px" type="submit">\uD83D\uDD0D</button></form></div>' +
      '<div><label>Skill</label><select onchange="location.href=\'/volunteers/directory?skill=\'+this.value+\'&search=' + encodeURIComponent(search) + '\'"><option value="">All Skills</option>' + skillOptions + '</select></div>' +
      '<div><label>Status</label><select onchange="location.href=\'/volunteers/directory?status=\'+this.value+\'&search=' + encodeURIComponent(search) + '\'><option value="">All</option><option value="active"' + (status === 'active' ? ' selected' : '') + '>Active</option><option value="inactive"' + (status === 'inactive' ? ' selected' : '') + '>Inactive</option><option value="suspended"' + (status === 'suspended' ? ' selected' : '') + '>Suspended</option><option value="blacklisted"' + (status === 'blacklisted' ? ' selected' : '') + '>Blacklisted</option></select></div>' +
      '</div>' +

      '<div class="vol-card"><div style="overflow-x:auto"><table class="vol-table">' +
      '<thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Status</th><th>Skills</th><th>Hours</th><th>Joined</th><th></th></tr></thead>' +
      '<tbody>' + (rows || '<tr><td colspan="8" class="vol-empty">No volunteers found. Register your first volunteer!</td></tr>') + '</tbody>' +
      '</table></div></div>' +
      paginate(page, totalPages, baseUrl) +
      '</div>';

    res.send(renderPage('Volunteer Directory', html, user, req));
  }));

  // ============================================================
  // ROUTE 5: GET /volunteers/:id — Volunteer Profile
  // ============================================================
  app.get('/volunteers/:id', requireAuth, ah(async function(req, res) {
    var user = req.session.user, tid = user.tenant_id, vid = req.params.id;

    var volunteer = (await pool.query('SELECT * FROM volunteers WHERE id=$1 AND tenant_id=$2', [vid, tid])).rows[0];
    if (!volunteer) return res.redirect('/volunteers/directory');

    // Event history
    var assignments = (await pool.query(
      'SELECT va.*, ve.name as event_name, ve.event_type, ve.start_date as event_start, ve.status as event_status FROM volunteer_assignments va JOIN volunteer_events ve ON ve.id = va.event_id WHERE va.tenant_id=$1 AND va.volunteer_id=$2 ORDER BY va.assigned_at DESC', [tid, vid]
    )).rows;

    // Average rating
    var avgRating = (await pool.query(
      'SELECT AVG(rating)::float as avg_r FROM volunteer_assignments WHERE tenant_id=$1 AND volunteer_id=$2 AND rating IS NOT NULL', [tid, vid]
    )).rows[0].avg_r;

    var initials = (volunteer.first_name || '?')[0] + (volunteer.last_name || '?')[0];
    var skillsHtml = (volunteer.skills || []).map(skillTag).join(' ');
    var bgStatus = volunteer.background_check
      ? '<span style="color:#059669;font-weight:600">\u2705 Passed</span> (' + fmtDate(volunteer.background_check_date) + ')'
      : '<span style="color:#dc2626;font-weight:600">\u274C Not Done</span>';

    var timelineHtml = assignments.map(function(a) {
      var cls = a.status === 'completed' ? 'checkout' : a.status === 'no_show' ? 'noshow' : '';
      var roleStr = a.role ? '<span style="font-size:12px;color:#0d9488;font-weight:600">' + esc(a.role) + '</span>' : '';
      return '<div class="vol-timeline-item ' + cls + '">' +
        '<div style="display:flex;justify-content:space-between;align-items:start;flex-wrap:wrap;gap:4px">' +
        '<a href="/volunteers/events/' + a.event_id + '" style="color:#1e293b;text-decoration:none;font-weight:700;font-size:13px">' + esc(a.event_name) + '</a>' +
        statusBadge(a.status) +
        '</div>' +
        '<div style="font-size:12px;color:#64748b;margin-top:2px">' +
        eventTypeBadge(a.event_type) + ' \u00B7 ' + fmtDate(a.event_start) +
        (a.hours_worked > 0 ? ' \u00B7 <strong style="color:#0d9488">' + Number(a.hours_worked).toFixed(1) + 'h</strong>' : '') +
        '</div>' +
        (roleStr ? '<div style="margin-top:4px">' + roleStr + '</div>' : '') +
        (a.rating ? '<div style="margin-top:4px">' + starsHtml(a.rating) + '</div>' : '') +
        '</div>';
    }).join('');

    var html = VOL_CSS + '<div style="max-width:1000px;margin:0 auto">' +
      nav('directory') +
      flashMsg(req) +
      '<a href="/volunteers/directory" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">\u2190 Back to Directory</a>' +

      // Profile Header
      '<div class="vol-card" style="display:flex;gap:20px;align-items:flex-start;flex-wrap:wrap">' +
      '<div class="vol-volunteer-avatar" style="width:72px;height:72px;font-size:28px;border-radius:16px">' + esc(initials) + '</div>' +
      '<div style="flex:1;min-width:200px">' +
      '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
      '<h1 style="font-size:22px;color:#1e293b;margin:0">' + esc(volunteer.first_name) + ' ' + esc(volunteer.last_name) + '</h1>' +
      statusBadge(volunteer.status) +
      '</div>' +
      '<div style="font-size:13px;color:#64748b;margin-top:4px">' +
      (volunteer.occupation ? esc(volunteer.occupation) + ' \u00B7 ' : '') +
      (volunteer.organization ? esc(volunteer.organization) + ' \u00B7 ' : '') +
      'Joined ' + fmtDate(volunteer.joined_date) +
      '</div>' +
      '<div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px">' + skillsHtml + '</div>' +
      '</div>' +
      '<div style="display:flex;gap:8px;flex-shrink:0;flex-wrap:wrap">' +
      '<form method="POST" action="/volunteers/' + vid + '/edit"><input type="hidden" name="action" value="toggle_bg"><button class="vol-btn vol-btn-warning" type="submit">\uD83D\uDD0C Toggle BG Check</button></form>' +
      '<a href="/volunteers/' + vid + '/edit" class="vol-btn vol-btn-secondary">\u270F Edit</a>' +
      '</div></div>' +

      // Stats
      '<div class="vol-grid-stats" style="margin-bottom:16px">' +
      '<div class="vol-stat-card" style="text-align:center"><div class="vol-stat-num">' + Number(volunteer.total_hours || 0).toFixed(1) + '</div><div class="vol-stat-label">Total Hours</div></div>' +
      '<div class="vol-stat-card" style="text-align:center"><div class="vol-stat-num">' + (volunteer.total_events || 0) + '</div><div class="vol-stat-label">Events</div></div>' +
      '<div class="vol-stat-card" style="text-align:center"><div class="vol-stat-num">' + (avgRating ? avgRating.toFixed(1) : '\u2014') + '</div><div class="vol-stat-label">Avg Rating</div></div>' +
      '<div class="vol-stat-card" style="text-align:center"><div class="vol-stat-num">' + assignments.length + '</div><div class="vol-stat-label">Assignments</div></div>' +
      '</div>' +

      // Contact Info + Background Check
      '<div class="vol-grid-2" style="margin-bottom:16px">' +
      '<div class="vol-card">' +
      '<h3 style="font-size:15px;color:#1e293b;margin:0 0 12px">\uD83D\uDCDE Contact Information</h3>' +
      '<div style="display:flex;flex-direction:column;gap:8px;font-size:13px">' +
      '<div><strong style="color:#64748b">Email:</strong> ' + esc(volunteer.email || '\u2014') + '</div>' +
      '<div><strong style="color:#64748b">Phone:</strong> ' + esc(volunteer.phone || '\u2014') + '</div>' +
      '<div><strong style="color:#64748b">Address:</strong> ' + esc(volunteer.address || '\u2014') + '</div>' +
      '<div><strong style="color:#64748b">ID Number:</strong> ' + esc(volunteer.id_number || '\u2014') + '</div>' +
      '<div><strong style="color:#64748b">Date of Birth:</strong> ' + fmtDate(volunteer.date_of_birth) + '</div>' +
      '<div><strong style="color:#64748b">Gender:</strong> ' + esc(volunteer.gender || '\u2014') + '</div>' +
      '</div></div>' +
      '<div class="vol-card">' +
      '<h3 style="font-size:15px;color:#1e293b;margin:0 0 12px">\uD83D\uDCDE Emergency Contact</h3>' +
      '<div style="display:flex;flex-direction:column;gap:8px;font-size:13px">' +
      '<div><strong style="color:#64748b">Name:</strong> ' + esc(volunteer.emergency_contact_name || '\u2014') + '</div>' +
      '<div><strong style="color:#64748b">Phone:</strong> ' + esc(volunteer.emergency_contact_phone || '\u2014') + '</div>' +
      '</div>' +
      '<h3 style="font-size:15px;color:#1e293b;margin:16px 0 12px">\u2705 Background Check</h3>' +
      '<div style="font-size:13px">' + bgStatus + '</div>' +
      (volunteer.notes ? '<h3 style="font-size:15px;color:#1e293b;margin:16px 0 12px">\uD83D\uDCDD Notes</h3><div style="font-size:13px;color:#475569">' + esc(volunteer.notes) + '</div>' : '') +
      '</div></div>' +

      // Event History Timeline
      '<div class="vol-card">' +
      '<h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">\uD83D\uDCC5 Event History & Hours Timeline</h3>' +
      (timelineHtml || '<p class="vol-empty">No event assignments yet</p>') +
      '</div>' +
      '</div>';

    res.send(renderPage(volunteer.first_name + ' ' + volunteer.last_name, html, user, req));
  }));

  // ============================================================
  // ROUTE 6: POST /volunteers/:id/edit — Edit Volunteer
  // ============================================================
  app.post('/volunteers/:id/edit', requireAuth, ah(async function(req, res) {
    var user = req.session.user, tid = user.tenant_id, vid = req.params.id;
    var body = req.body;

    // Toggle background check
    if (body.action === 'toggle_bg') {
      await pool.query(
        'UPDATE volunteers SET background_check = NOT background_check, background_check_date = CASE WHEN background_check = false THEN CURRENT_DATE ELSE NULL END, updated_at = NOW() WHERE id=$1 AND tenant_id=$2',
        [vid, tid]
      );
      return res.redirect('/volunteers/' + vid);
    }

    var firstName = (body.first_name || '').trim();
    var lastName = (body.last_name || '').trim();
    if (!firstName || !lastName) {
      req.session.flash = { type: 'error', msg: 'First name and last name are required.' };
      return res.redirect('/volunteers/' + vid);
    }

    var skills = body.skills;
    if (!Array.isArray(skills)) skills = skills ? [skills] : [];

    await pool.query(
      'UPDATE volunteers SET first_name=$1, last_name=$2, email=$3, phone=$4, address=$5, date_of_birth=$6, gender=$7, occupation=$8, organization=$9, skills=$10, emergency_contact_name=$11, emergency_contact_phone=$12, id_number=$13, status=$14, notes=$15, updated_at=NOW() WHERE id=$16 AND tenant_id=$17',
      [firstName, lastName, (body.email || '').trim() || null, (body.phone || '').trim() || null,
       (body.address || '').trim() || null, body.date_of_birth || null, body.gender || null,
       (body.occupation || '').trim() || null, (body.organization || '').trim() || null,
       skills.length > 0 ? skills : null,
       (body.emergency_contact_name || '').trim() || null, (body.emergency_contact_phone || '').trim() || null,
       (body.id_number || '').trim() || null, body.status || 'active',
       (body.notes || '').trim() || null, vid, tid]
    );

    console.log('[Volunteers] Updated volunteer #' + vid);
    req.session.flash = { type: 'success', msg: 'Volunteer updated successfully.' };
    res.redirect('/volunteers/' + vid);
  }));

  // ============================================================
  // ROUTE 7: GET /volunteers/events — Events List
  // ============================================================
  app.get('/volunteers/events', requireAuth, ah(async function(req, res) {
    var user = req.session.user, tid = user.tenant_id;
    var type = req.query.type || '';
    var status = req.query.status || '';
    var page = parseInt(req.query.page) || 1;
    var perPage = 15;
    var offset = (page - 1) * perPage;

    var where = ['tenant_id=$1'];
    var params = [tid];
    var pi = 2;

    if (type) { where.push('event_type=$' + pi++); params.push(type); }
    if (status) { where.push('status=$' + pi++); params.push(status); }

    var countResult = await pool.query('SELECT COUNT(*)::int as cnt FROM volunteer_events WHERE ' + where.join(' AND '), params);
    var totalRows = countResult.rows[0].cnt;
    var totalPages = Math.ceil(totalRows / perPage);

    var events = (await pool.query(
      'SELECT ve.*, (SELECT COUNT(*)::int FROM volunteer_assignments WHERE tenant_id=$1 AND event_id=ve.id AND status!=\'declined\') as assigned_count FROM volunteer_events ve WHERE ' + where.join(' AND ') + ' ORDER BY ve.start_date DESC LIMIT $' + pi + ' OFFSET $' + (pi + 1), params.concat([perPage, offset])
    )).rows;

    var baseUrl = '/volunteers/events?type=' + encodeURIComponent(type) + '&status=' + encodeURIComponent(status);

    var rows = events.map(function(e) {
      var prog = progressBar(e.assigned_count, e.max_volunteers);
      return '<div class="vol-event-card">' +
        '<div style="display:flex;justify-content:space-between;align-items:start;flex-wrap:wrap;gap:8px">' +
        '<div style="flex:1;min-width:200px">' +
        '<a href="/volunteers/events/' + e.id + '" style="color:#0d9488;text-decoration:none;font-weight:700;font-size:15px">' + esc(e.name) + '</a>' +
        '<div style="font-size:12px;color:#64748b;margin-top:3px">' +
        eventTypeBadge(e.event_type) + ' \u00B7 ' + esc(e.location || 'TBD') +
        '</div></div>' +
        '<div style="display:flex;gap:8px;align-items:center;flex-shrink:0">' +
        statusBadge(e.status) +
        '</div></div>' +
        '<div style="font-size:12px;color:#64748b;margin-top:6px">' +
        '\uD83D\uDCC5 ' + fmtDateTime(e.start_date) + ' \u2192 ' + fmtDate(e.end_date) +
        '</div>' +
        (e.description ? '<div style="font-size:13px;color:#475569;margin-top:6px">' + esc(e.description.substring(0, 120)) + (e.description.length > 120 ? '...' : '') + '</div>' : '') +
        '<div style="margin-top:10px">' + prog + '</div>' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px">' +
        '<span style="font-size:12px;color:#64748b">' + Number(e.total_hours_contributed || 0).toFixed(1) + ' total hours contributed</span>' +
        '<a href="/volunteers/events/' + e.id + '" class="vol-btn vol-btn-secondary" style="padding:5px 12px">View Details</a>' +
        '</div></div>';
    }).join('');

    var html = VOL_CSS + '<div style="max-width:1000px;margin:0 auto">' +
      nav('events') +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">' +
      '<div><h1 style="font-size:22px;color:#1e293b">\uD83D\uDCC5 Volunteer Events</h1>' +
      '<p style="font-size:13px;color:#94a3b8;margin-top:2px">' + totalRows + ' event' + (totalRows !== 1 ? 's' : '') + '</p></div>' +
      '<a href="/volunteers/events/create" class="vol-btn vol-btn-primary">\u2795 Create Event</a>' +
      '</div>' +

      '<div class="vol-filter">' +
      '<div><label>Type</label><select onchange="location.href=\'/volunteers/events?type=\'+this.value"><option value="">All Types</option>' +
      EVENT_TYPES.map(function(t) { return '<option value="' + t + '"' + (type === t ? ' selected' : '') + '>' + t.replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); }) + '</option>'; }).join('') +
      '</select></div>' +
      '<div><label>Status</label><select onchange="location.href=\'/volunteers/events?status=\'+this.value"><option value="">All</option>' +
      '<option value="upcoming"' + (status === 'upcoming' ? ' selected' : '') + '>Upcoming</option>' +
      '<option value="in_progress"' + (status === 'in_progress' ? ' selected' : '') + '>In Progress</option>' +
      '<option value="completed"' + (status === 'completed' ? ' selected' : '') + '>Completed</option>' +
      '<option value="cancelled"' + (status === 'cancelled' ? ' selected' : '') + '>Cancelled</option>' +
      '</select></div></div>' +

      '<div style="display:flex;flex-direction:column;gap:12px">' +
      (rows || '<p class="vol-empty">No events found. Create your first event!</p>') +
      '</div>' +
      paginate(page, totalPages, baseUrl) +
      '</div>';

    res.send(renderPage('Volunteer Events', html, user, req));
  }));

  // ============================================================
  // ROUTE 8: GET /volunteers/events/create — Create Event Form
  // ============================================================
  app.get('/volunteers/events/create', requireAuth, ah(async function(req, res) {
    var user = req.session.user, tid = user.tenant_id;

    // Load coordinators (users)
    var coordinators = (await pool.query(
      'SELECT id, display_name, name, email FROM users WHERE tenant_id=$1 ORDER BY display_name, name LIMIT 100', [tid]
    )).rows;

    var coordOptions = coordinators.map(function(u) {
      var name = u.display_name || u.name || u.email;
      return '<option value="' + u.id + '">' + esc(name) + '</option>';
    }).join('');

    var skillsCheckboxes = ALL_SKILLS.map(function(s) {
      return '<label><input type="checkbox" name="required_skills" value="' + esc(s) + '"> <span>' + esc(s) + '</span></label>';
    }).join('');

    var typeOptions = EVENT_TYPES.map(function(t) {
      var label = t.replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
      return '<option value="' + t + '">' + esc(label) + '</option>';
    }).join('');

    var html = VOL_CSS + '<div style="max-width:800px;margin:0 auto">' +
      nav('events') +
      flashMsg(req) +
      '<a href="/volunteers/events" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">\u2190 Back to Events</a>' +
      '<div class="vol-card" style="padding:28px">' +
      '<h2 style="margin:0 0 4px;color:#1e293b">\uD83D\uDCC5 Create New Event</h2>' +
      '<p style="font-size:13px;color:#94a3b8;margin-bottom:24px">Create a volunteer event with scheduling, roles, and skill requirements</p>' +
      '<form method="POST" action="/volunteers/events/create" style="display:flex;flex-direction:column;gap:20px">' +

      '<div class="vol-grid-2">' +
      '<div class="vol-form-group"><label>Event Name *</label><input type="text" name="name" required placeholder="e.g., Community Cleanup Day"></div>' +
      '<div class="vol-form-group"><label>Event Type *</label><select name="event_type" required><option value="">Select type...</option>' + typeOptions + '</select></div>' +
      '</div>' +

      '<div class="vol-form-group"><label>Description</label><textarea name="description" rows="3" placeholder="Describe the event purpose, goals, and activities..."></textarea></div>' +

      '<div class="vol-grid-2">' +
      '<div class="vol-form-group"><label>Location *</label><input type="text" name="location" required placeholder="e.g., City Park, School Hall"></div>' +
      '<div class="vol-form-group"><label>Max Volunteers (0 = unlimited)</label><input type="number" name="max_volunteers" min="0" value="0"></div>' +
      '</div>' +

      '<div class="vol-grid-2">' +
      '<div class="vol-form-group"><label>Start Date & Time *</label><input type="datetime-local" name="start_date" required></div>' +
      '<div class="vol-form-group"><label>End Date & Time *</label><input type="datetime-local" name="end_date" required></div>' +
      '</div>' +

      '<div class="vol-form-group"><label>Coordinator</label><select name="coordinator_id"><option value="">No coordinator assigned</option>' + coordOptions + '</select></div>' +

      '<div>' +
      '<h3 style="font-size:14px;color:#0f766e;margin:0 0 12px;font-weight:700">\uD83D\uDEE0\uFE0F Required Skills</h3>' +
      '<div class="vol-checkbox-grid">' + skillsCheckboxes + '</div>' +
      '</div>' +

      '<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:8px">' +
      '<a href="/volunteers/events" class="vol-btn vol-btn-ghost">Cancel</a>' +
      '<button type="submit" class="vol-btn vol-btn-primary" style="padding:12px 28px">\uD83D\uDCC5 Create Event</button>' +
      '</div>' +
      '</form></div></div>';

    res.send(renderPage('Create Event', html, user, req));
  }));

  // ============================================================
  // ROUTE 9: POST /volunteers/events/create — Save Event
  // ============================================================
  app.post('/volunteers/events/create', requireAuth, ah(async function(req, res) {
    var user = req.session.user, tid = user.tenant_id;
    var body = req.body;
    var name = (body.name || '').trim();

    if (!name || !body.event_type || !body.start_date || !body.end_date || !body.location) {
      req.session.flash = { type: 'error', msg: 'Event name, type, location, start, and end dates are required.' };
      return res.redirect('/volunteers/events/create');
    }

    var reqSkills = body.required_skills;
    if (!Array.isArray(reqSkills)) reqSkills = reqSkills ? [reqSkills] : [];

    await pool.query(
      'INSERT INTO volunteer_events (tenant_id, name, description, event_type, location, start_date, end_date, max_volunteers, required_skills, coordinator_id, status, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,\'upcoming\',$11)',
      [tid, name, (body.description || '').trim() || null, body.event_type, (body.location || '').trim(),
       body.start_date, body.end_date, parseInt(body.max_volunteers) || 0,
       reqSkills.length > 0 ? reqSkills : null,
       body.coordinator_id ? parseInt(body.coordinator_id) : null,
       user.id]
    );

    console.log('[Volunteers] Event created: ' + name);
    req.session.flash = { type: 'success', msg: 'Event "' + name + '" has been created successfully!' };
    res.redirect('/volunteers/events');
  }));

  // ============================================================
  // ROUTE 10: GET /volunteers/events/:id — Event Detail
  // ============================================================
  app.get('/volunteers/events/:id', requireAuth, ah(async function(req, res) {
    var user = req.session.user, tid = user.tenant_id, eid = req.params.id;

    var evt = (await pool.query(
      'SELECT ve.*, u.display_name as coord_name FROM volunteer_events ve LEFT JOIN users u ON u.id = ve.coordinator_id WHERE ve.id=$1 AND ve.tenant_id=$2', [eid, tid]
    )).rows[0];
    if (!evt) return res.redirect('/volunteers/events');

    // Assigned volunteers
    var assignments = (await pool.query(
      'SELECT va.*, v.first_name as vfn, v.last_name as vln, v.email as vemail, v.phone as vphone, v.skills as vskills FROM volunteer_assignments va JOIN volunteers v ON v.id = va.volunteer_id WHERE va.tenant_id=$1 AND va.event_id=$2 ORDER BY va.assigned_at', [tid, eid]
    )).rows;

    // Available volunteers (active, not already assigned)
    var available = (await pool.query(
      'SELECT v.id, v.first_name, v.last_name, v.skills FROM volunteers v WHERE v.tenant_id=$1 AND v.status=\'active\' AND v.id NOT IN (SELECT volunteer_id FROM volunteer_assignments WHERE tenant_id=$1 AND event_id=$2 AND status!=\'declined\') ORDER BY v.last_name, v.first_name LIMIT 200', [tid, eid]
    )).rows;

    var reqSkills = (evt.required_skills || []).map(skillTag).join(' ');

    var assignRows = assignments.map(function(a) {
      var initials = (a.vfn || '?')[0] + (a.vln || '?')[0];
      var skillsHtml = (a.vskills || []).slice(0, 2).map(skillTag).join(' ');
      var canCheckIn = (evt.status === 'in_progress' || evt.status === 'upcoming') && !a.check_in_time && a.status !== 'declined';
      var canCheckOut = a.check_in_time && !a.check_out_time && a.status !== 'declined';
      return '<tr>' +
        '<td>' +
        '<div style="display:flex;align-items:center;gap:8px">' +
        '<div class="vol-volunteer-avatar" style="width:32px;height:32px;font-size:12px;border-radius:8px">' + esc(initials) + '</div>' +
        '<a href="/volunteers/' + a.volunteer_id + '" style="color:#0d9488;text-decoration:none;font-weight:600">' + esc(a.vfn) + ' ' + esc(a.vln) + '</a>' +
        '</div></td>' +
        '<td style="font-size:12px">' + esc(a.role || 'Volunteer') + '</td>' +
        '<td>' + statusBadge(a.status) + '</td>' +
        '<td style="font-size:12px">' + (a.check_in_time ? fmtDateTime(a.check_in_time) : '\u2014') + '</td>' +
        '<td style="font-size:12px">' + (a.check_out_time ? fmtDateTime(a.check_out_time) : '\u2014') + '</td>' +
        '<td style="font-weight:700">' + (a.hours_worked > 0 ? Number(a.hours_worked).toFixed(1) + 'h' : '\u2014') + '</td>' +
        '<td>' + (a.rating ? starsHtml(a.rating) : '\u2014') + '</td>' +
        '<td>' +
        '<div style="display:flex;gap:4px;flex-wrap:wrap">' +
        (canCheckIn ? '<form method="POST" action="/volunteers/assignments/' + a.id + '/check-in"><input type="hidden" name="action" value="checkin"><button class="vol-btn vol-btn-success" style="padding:4px 10px;font-size:11px" type="submit">\u2705 In</button></form>' : '') +
        (canCheckOut ? '<form method="POST" action="/volunteers/assignments/' + a.id + '/check-in"><input type="hidden" name="action" value="checkout"><button class="vol-btn vol-btn-danger" style="padding:4px 10px;font-size:11px" type="submit">\uD83D\uDD04 Out</button></form>' : '') +
        (a.feedback ? '<span style="font-size:11px;color:#64748b" title="' + esc(a.feedback) + '">\uD83D\uDCAC</span>' : '') +
        '</div></td>' +
        '</tr>';
    }).join('');

    var availOptions = available.map(function(v) {
      return '<option value="' + v.id + '">' + esc(v.last_name) + ', ' + esc(v.first_name) + '</option>';
    }).join('');

    var roleOptions = ROLES.map(function(r) {
      return '<option value="' + esc(r) + '">' + esc(r) + '</option>';
    }).join('');

    var volunteerProg = progressBar(assignments.filter(function(a) { return a.status !== 'declined'; }).length, evt.max_volunteers);

    var html = VOL_CSS + '<div style="max-width:1100px;margin:0 auto">' +
      nav('events') +
      flashMsg(req) +
      '<a href="/volunteers/events" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">\u2190 Back to Events</a>' +

      // Event Header
      '<div class="vol-card" style="padding:24px">' +
      '<div style="display:flex;justify-content:space-between;align-items:start;flex-wrap:wrap;gap:12px">' +
      '<div>' +
      '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
      '<h1 style="font-size:22px;color:#1e293b;margin:0">' + esc(evt.name) + '</h1>' +
      statusBadge(evt.status) +
      eventTypeBadge(evt.event_type) +
      '</div>' +
      '<div style="font-size:13px;color:#64748b;margin-top:6px">' +
      '\uD83D\uDCCD ' + esc(evt.location || 'TBD') + ' \u00B7 ' +
      '\uD83D\uDCC5 ' + fmtDateTime(evt.start_date) + ' \u2192 ' + fmtDate(evt.end_date) +
      (evt.coord_name ? ' \u00B7 \uD83D\uDC65 Coordinator: ' + esc(evt.coord_name) : '') +
      '</div></div></div>' +
      (evt.description ? '<div style="font-size:14px;color:#475569;margin-top:14px;line-height:1.6">' + esc(evt.description) + '</div>' : '') +
      '<div style="margin-top:16px;display:flex;flex-wrap:wrap;gap:16px">' +
      '<div><span style="font-size:12px;color:#64748b;font-weight:600">Volunteers:</span> ' + volunteerProg + '</div>' +
      '<div><span style="font-size:12px;color:#64748b;font-weight:600">Total Hours:</span> <span style="font-weight:700;color:#0d9488">' + Number(evt.total_hours_contributed || 0).toFixed(1) + 'h</span></div>' +
      '</div>' +
      (reqSkills ? '<div style="margin-top:12px"><span style="font-size:12px;color:#64748b;font-weight:600">Required Skills:</span> ' + reqSkills + '</div>' : '') +
      '</div>' +

      // Assign Volunteer Form
      '<div class="vol-card" style="padding:20px">' +
      '<h3 style="font-size:15px;color:#1e293b;margin:0 0 12px">\u2795 Assign Volunteer</h3>' +
      (available.length > 0 ?
        '<form method="POST" action="/volunteers/events/' + eid + '/assign" style="display:flex;gap:10px;align-items:end;flex-wrap:wrap">' +
        '<div class="vol-form-group" style="margin:0;flex:1;min-width:200px"><label>Volunteer</label><select name="volunteer_id" required><option value="">Select volunteer...</option>' + availOptions + '</select></div>' +
        '<div class="vol-form-group" style="margin:0;min-width:150px"><label>Role</label><select name="role">' + roleOptions + '</select></div>' +
        '<button class="vol-btn vol-btn-primary" type="submit" style="height:42px">\u2795 Assign</button>' +
        '</form>'
        : '<p style="font-size:13px;color:#94a3b8">All active volunteers are already assigned or none available.</p>') +
      '</div>' +

      // Assigned Volunteers Table
      '<div class="vol-card">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">' +
      '<h3 style="font-size:15px;color:#1e293b;margin:0">\uD83D\uDC65 Assigned Volunteers (' + assignments.length + ')</h3>' +
      '</div>' +
      '<div style="overflow-x:auto"><table class="vol-table">' +
      '<thead><tr><th>Volunteer</th><th>Role</th><th>Status</th><th>Check-In</th><th>Check-Out</th><th>Hours</th><th>Rating</th><th>Actions</th></tr></thead>' +
      '<tbody>' + (assignRows || '<tr><td colspan="8" class="vol-empty">No volunteers assigned yet. Use the form above to assign.</td></tr>') + '</tbody>' +
      '</table></div></div>' +
      '</div>';

    res.send(renderPage(evt.name, html, user, req));
  }));

  // ============================================================
  // ROUTE 11: POST /volunteers/events/:id/assign — Assign Volunteer
  // ============================================================
  app.post('/volunteers/events/:id/assign', requireAuth, ah(async function(req, res) {
    var user = req.session.user, tid = user.tenant_id, eid = req.params.id;
    var volunteerId = parseInt(req.body.volunteer_id);
    var role = (req.body.role || '').trim() || 'General Volunteer';

    if (!volunteerId) {
      req.session.flash = { type: 'error', msg: 'Please select a volunteer.' };
      return res.redirect('/volunteers/events/' + eid);
    }

    // Check for duplicate assignment
    var dup = (await pool.query(
      'SELECT id FROM volunteer_assignments WHERE tenant_id=$1 AND volunteer_id=$2 AND event_id=$3', [tid, volunteerId, eid]
    )).rows[0];

    if (dup) {
      req.session.flash = { type: 'warning', msg: 'This volunteer is already assigned to this event.' };
      return res.redirect('/volunteers/events/' + eid);
    }

    // Check max volunteers
    var evt = (await pool.query('SELECT max_volunteers FROM volunteer_events WHERE id=$1 AND tenant_id=$2', [eid, tid])).rows[0];
    if (evt && evt.max_volunteers > 0) {
      var currentCount = (await pool.query(
        'SELECT COUNT(*)::int as cnt FROM volunteer_assignments WHERE tenant_id=$1 AND event_id=$2 AND status!=\'declined\'', [tid, eid]
      )).rows[0].cnt;
      if (currentCount >= evt.max_volunteers) {
        req.session.flash = { type: 'error', msg: 'This event has reached its maximum volunteer capacity (' + evt.max_volunteers + ').' };
        return res.redirect('/volunteers/events/' + eid);
      }
    }

    await pool.query(
      'INSERT INTO volunteer_assignments (tenant_id, volunteer_id, event_id, role, assigned_by, status) VALUES ($1,$2,$3,$4,$5,\'confirmed\')',
      [tid, volunteerId, eid, role, user.id]
    );

    // Update event volunteer count
    await pool.query(
      'UPDATE volunteer_events SET volunteer_count = (SELECT COUNT(*)::int FROM volunteer_assignments WHERE tenant_id=$1 AND event_id=$2 AND status!=\'declined\'), updated_at = NOW() WHERE id=$2 AND tenant_id=$1',
      [tid, eid]
    );

    console.log('[Volunteers] Assigned volunteer #' + volunteerId + ' to event #' + eid);
    req.session.flash = { type: 'success', msg: 'Volunteer assigned successfully!' };
    res.redirect('/volunteers/events/' + eid);
  }));

  // ============================================================
  // ROUTE 12: POST /volunteers/assignments/:id/check-in — Check In/Out
  // ============================================================
  app.post('/volunteers/assignments/:id/check-in', requireAuth, ah(async function(req, res) {
    var user = req.session.user, tid = user.tenant_id, aid = req.params.id;
    var action = req.body.action;

    var assignment = (await pool.query(
      'SELECT * FROM volunteer_assignments WHERE id=$1 AND tenant_id=$2', [aid, tid]
    )).rows[0];

    if (!assignment) return res.redirect('/volunteers/events');

    if (action === 'checkin') {
      // Check in
      await pool.query(
        'UPDATE volunteer_assignments SET check_in_time = NOW(), status = \'confirmed\', updated_at = NOW() WHERE id=$1 AND tenant_id=$2',
        [aid, tid]
      );

      // Update event status to in_progress if needed
      await pool.query(
        "UPDATE volunteer_events SET status = 'in_progress', updated_at = NOW() WHERE id=$1 AND tenant_id=$2 AND status='upcoming' AND start_date <= NOW()",
        [assignment.event_id, tid]
      );

      console.log('[Volunteers] Checked in assignment #' + aid);
      req.session.flash = { type: 'success', msg: 'Volunteer checked in successfully!' };
    } else if (action === 'checkout') {
      // Check out - calculate hours
      var checkIn = assignment.check_in_time;
      if (!checkIn) {
        req.session.flash = { type: 'error', msg: 'Cannot check out without a check-in time.' };
        return res.redirect('/volunteers/events/' + assignment.event_id);
      }

      var hours = Math.round(((new Date() - new Date(checkIn)) / 3600000) * 10) / 10;
      hours = Math.max(0.1, hours);

      await pool.query(
        'UPDATE volunteer_assignments SET check_out_time = NOW(), hours_worked = $3, status = \'completed\', updated_at = NOW() WHERE id=$1 AND tenant_id=$2',
        [aid, tid, hours]
      );

      // Update volunteer totals
      await pool.query(
        'UPDATE volunteers SET total_hours = (SELECT COALESCE(SUM(hours_worked),0) FROM volunteer_assignments WHERE tenant_id=$2 AND volunteer_id=$3 AND status=\'completed\'), total_events = (SELECT COUNT(DISTINCT event_id)::int FROM volunteer_assignments WHERE tenant_id=$2 AND volunteer_id=$3 AND status=\'completed\'), updated_at = NOW() WHERE id=$3 AND tenant_id=$2',
        [tid, tid, assignment.volunteer_id]
      );

      // Update event totals
      await pool.query(
        'UPDATE volunteer_events SET total_hours_contributed = (SELECT COALESCE(SUM(hours_worked),0) FROM volunteer_assignments WHERE tenant_id=$2 AND event_id=$1 AND status=\'completed\'), volunteer_count = (SELECT COUNT(*)::int FROM volunteer_assignments WHERE tenant_id=$2 AND event_id=$1 AND status!=\'declined\'), updated_at = NOW() WHERE id=$1 AND tenant_id=$2',
        [assignment.event_id, tid]
      );

      // Check if event should be marked completed
      var evtInfo = (await pool.query(
        'SELECT end_date, (SELECT COUNT(*)::int FROM volunteer_assignments WHERE tenant_id=$2 AND event_id=$1 AND status IN (\'confirmed\',\'tentatively\') AND check_in_time IS NOT NULL AND check_out_time IS NULL) as active_count FROM volunteer_events WHERE id=$1 AND tenant_id=$2',
        [assignment.event_id, tid]
      )).rows[0];

      if (evtInfo && evtInfo.active_count === 0 && new Date(evtInfo.end_date) <= new Date()) {
        await pool.query(
          "UPDATE volunteer_events SET status = 'completed', updated_at = NOW() WHERE id=$1 AND tenant_id=$2",
          [assignment.event_id, tid]
        );
      }

      console.log('[Volunteers] Checked out assignment #' + aid + ' (' + hours + 'h)');
      req.session.flash = { type: 'success', msg: 'Volunteer checked out. ' + hours.toFixed(1) + ' hours recorded.' };
    }

    res.redirect('/volunteers/events/' + assignment.event_id);
  }));

  // ============================================================
  // ROUTE 13: GET /volunteers/reports — Reports & Analytics
  // ============================================================
  app.get('/volunteers/reports', requireAuth, ah(async function(req, res) {
    var user = req.session.user, tid = user.tenant_id;

    // Hours by volunteer (top 15)
    var hoursByVol = (await pool.query(
      'SELECT v.id, v.first_name, v.last_name, v.total_hours, v.total_events FROM volunteers v WHERE v.tenant_id=$1 AND v.status=\'active\' ORDER BY v.total_hours DESC LIMIT 15', [tid]
    )).rows;

    // Events by type
    var eventsByType = (await pool.query(
      'SELECT event_type, COUNT(*)::int as cnt, COALESCE(SUM(total_hours_contributed),0)::float as total_hrs FROM volunteer_events WHERE tenant_id=$1 GROUP BY event_type ORDER BY cnt DESC', [tid]
    )).rows;

    // Monthly participation trends (last 12 months)
    var monthlyTrend = (await pool.query(
      "SELECT to_char(ve.start_date, 'Mon YYYY') as month_label, COUNT(DISTINCT va.volunteer_id)::int as volunteers, COUNT(DISTINCT ve.id)::int as events, COALESCE(SUM(va.hours_worked),0)::float as hours FROM volunteer_events ve LEFT JOIN volunteer_assignments va ON va.event_id = ve.id AND va.tenant_id=$1 AND va.status='completed' WHERE ve.tenant_id=$1 AND ve.start_date >= date_trunc('month', CURRENT_DATE - interval '11 months') GROUP BY to_char(ve.start_date, 'Mon YYYY'), date_trunc('month', ve.start_date) ORDER BY date_trunc('month', ve.start_date)", [tid]
    )).rows;

    // Skills distribution
    var skillsDist = (await pool.query(
      "SELECT UNNEST(skills) as skill, COUNT(*)::int as cnt FROM volunteers WHERE tenant_id=$1 AND skills IS NOT NULL AND array_length(skills, 1) > 0 GROUP BY skill ORDER BY cnt DESC LIMIT 12", [tid]
    )).rows;

    // Volunteer retention: joined per month, active per month
    var retentionData = (await pool.query(
      "SELECT to_char(joined_date, 'YYYY-MM') as month, COUNT(*)::int as joined FROM volunteers WHERE tenant_id=$1 AND joined_date >= date_trunc('month', CURRENT_DATE - interval '11 months') GROUP BY to_char(joined_date, 'YYYY-MM'), date_trunc('month', joined_date) ORDER BY date_trunc('month', joined_date)", [tid]
    )).rows;

    // Status distribution
    var statusDist = (await pool.query(
      'SELECT status, COUNT(*)::int as cnt FROM volunteers WHERE tenant_id=$1 GROUP BY status ORDER BY cnt DESC', [tid]
    )).rows;

    // Assignment status breakdown
    var assignStatusDist = (await pool.query(
      'SELECT status, COUNT(*)::int as cnt FROM volunteer_assignments WHERE tenant_id=$1 GROUP BY status ORDER BY cnt DESC', [tid]
    )).rows;

    var totalVolunteers = hoursByVol.length;
    var totalEvents = eventsByType.reduce(function(s, r) { return s + r.cnt; }, 0);
    var totalTypeHours = eventsByType.reduce(function(s, r) { return s + Number(r.total_hrs || 0); }, 0);

    // Hours by volunteer chart
    var maxVolHours = Math.max.apply(null, hoursByVol.map(function(v) { return Number(v.total_hours || 0); }).concat([1]));
    var volBars = hoursByVol.map(function(v) {
      var h = Math.round(pct(Number(v.total_hours || 0), maxVolHours));
      return '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">' +
        '<span style="font-size:12px;font-weight:600;color:#1e293b;min-width:120px;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(v.first_name) + ' ' + esc(v.last_name) + '</span>' +
        '<div style="flex:1;height:24px;background:#f0fdfa;border-radius:6px;overflow:hidden">' +
        '<div style="height:100%;width:' + h + '%;background:linear-gradient(90deg,#0d9488,#2dd4bf);border-radius:6px;transition:.3s"></div>' +
        '</div>' +
        '<span style="font-size:12px;font-weight:700;color:#0d9488;min-width:60px">' + Number(v.total_hours || 0).toFixed(1) + 'h</span>' +
        '</div>';
    }).join('');

    // Events by type chart
    var maxEvtCount = Math.max.apply(null, eventsByType.map(function(e) { return e.cnt; }).concat([1]));
    var typeColors = { community_service: '#0d9488', school_support: '#1d4ed8', church_ministry: '#7c3aed', sports: '#ea580c', fundraiser: '#059669', cleanup: '#0891b2', mentoring: '#c2410c', tutoring: '#6366f1' };
    var typeBars = eventsByType.map(function(e) {
      var p = pct(e.cnt, maxEvtCount);
      var col = typeColors[e.event_type] || '#475569';
      var label = (e.event_type || '').replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
      return '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">' +
        '<span style="font-size:12px;font-weight:600;color:#1e293b;min-width:130px">' + esc(label) + '</span>' +
        '<div style="flex:1;height:24px;background:#f0fdfa;border-radius:6px;overflow:hidden">' +
        '<div style="height:100%;width:' + p + '%;background:' + col + ';border-radius:6px;transition:.3s"></div>' +
        '</div>' +
        '<span style="font-size:12px;font-weight:700;color:#1e293b;min-width:50px">' + e.cnt + '</span>' +
        '</div>';
    }).join('');

    // Monthly trend chart
    var maxTrendHrs = Math.max.apply(null, monthlyTrend.map(function(m) { return Number(m.hours || 0); }).concat([1]));
    var trendBars = monthlyTrend.map(function(m) {
      var h = Math.round(pct(Number(m.hours || 0), maxTrendHrs));
      return '<div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex:1;min-width:60px">' +
        '<span style="font-size:10px;font-weight:700;color:#0d9488">' + Number(m.hours || 0).toFixed(0) + 'h</span>' +
        '<div style="width:100%;max-width:40px;background:#f0fdfa;border-radius:6px;height:100px;position:relative;overflow:hidden">' +
        '<div style="position:absolute;bottom:0;width:100%;height:' + Math.max(h, 4) + '%;background:linear-gradient(to top,#0d9488,#2dd4bf);border-radius:6px;transition:.3s"></div>' +
        '</div>' +
        '<span style="font-size:9px;color:#64748b;white-space:nowrap;text-align:center">' + esc(m.month_label || '') + '</span>' +
        '</div>';
    }).join('');

    // Skills distribution
    var maxSkillCount = Math.max.apply(null, skillsDist.map(function(s) { return s.cnt; }).concat([1]));
    var skillBars = skillsDist.map(function(s) {
      var p = pct(s.cnt, maxSkillCount);
      return '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">' +
        skillTag(s.skill) +
        '<div style="flex:1;height:20px;background:#f0fdfa;border-radius:10px;overflow:hidden">' +
        '<div style="height:100%;width:' + p + '%;background:#2dd4bf;border-radius:10px;transition:.3s"></div>' +
        '</div>' +
        '<span style="font-size:12px;font-weight:700;color:#0f766e">' + s.cnt + '</span>' +
        '</div>';
    }).join('');

    // Retention chart
    var maxRetention = Math.max.apply(null, retentionData.map(function(r) { return r.joined; }).concat([1]));
    var retentionBars = retentionData.map(function(r) {
      var p = pct(r.joined, maxRetention);
      return '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">' +
        '<span style="font-size:12px;font-weight:600;color:#1e293b;min-width:80px">' + esc(r.month) + '</span>' +
        '<div style="flex:1;height:24px;background:#f0fdfa;border-radius:6px;overflow:hidden">' +
        '<div style="height:100%;width:' + p + '%;background:linear-gradient(90deg,#0d9488,#14b8a6);border-radius:6px;transition:.3s"></div>' +
        '</div>' +
        '<span style="font-size:12px;font-weight:700;color:#0d9488">' + r.joined + ' joined</span>' +
        '</div>';
    }).join('');

    // Status distribution
    var totalStatusVols = statusDist.reduce(function(s, r) { return s + r.cnt; }, 0) || 1;
    var statusRows = statusDist.map(function(s) {
      return '<div style="display:inline-flex;align-items:center;gap:6px;margin-right:12px;margin-bottom:8px">' +
        statusBadge(s.status) +
        '<span style="font-size:13px;font-weight:700">' + s.cnt + '</span>' +
        '<span style="font-size:11px;color:#94a3b8">(' + pct(s.cnt, totalStatusVols) + '%)</span>' +
        '</div>';
    }).join('');

    var html = VOL_CSS + '<div style="max-width:1200px;margin:0 auto">' +
      nav('reports') +
      '<div style="margin-bottom:20px">' +
      '<h1 style="font-size:24px;color:#1e293b">\uD83D\uDCCA Volunteer Reports & Analytics</h1>' +
      '<p style="font-size:13px;color:#94a3b8;margin-top:2px">Comprehensive insights into volunteer activity, events, skills, and retention</p>' +
      '</div>' +

      // Summary Stats
      '<div class="vol-grid-stats" style="margin-bottom:20px">' +
      '<div class="vol-stat-card" style="text-align:center"><div class="vol-stat-num">' + totalVolunteers + '</div><div class="vol-stat-label">Active Volunteers</div></div>' +
      '<div class="vol-stat-card" style="text-align:center"><div class="vol-stat-num">' + totalEvents + '</div><div class="vol-stat-label">Total Events</div></div>' +
      '<div class="vol-stat-card" style="text-align:center"><div class="vol-stat-num">' + Number(totalTypeHours).toFixed(0) + '</div><div class="vol-stat-label">Total Hours</div></div>' +
      '<div class="vol-stat-card" style="text-align:center"><div class="vol-stat-num">' + skillsDist.length + '</div><div class="vol-stat-label">Unique Skills</div></div>' +
      '</div>' +

      // Hours by Volunteer + Events by Type
      '<div class="vol-grid-2" style="margin-bottom:16px">' +
      '<div class="vol-card">' +
      '<h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">\u23F1 Hours by Volunteer (Top 15)</h3>' +
      (volBars || '<p class="vol-empty">No volunteer hours data</p>') +
      '</div>' +
      '<div class="vol-card">' +
      '<h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">\uD83C\uDFC5 Events by Type</h3>' +
      (typeBars || '<p class="vol-empty">No events data</p>') +
      '</div></div>' +

      // Monthly Trends + Skills Distribution
      '<div class="vol-grid-2" style="margin-bottom:16px">' +
      '<div class="vol-card">' +
      '<h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">\uD83D\uDCC8 Monthly Participation (12 Months)</h3>' +
      '<div style="display:flex;gap:6px;align-items:end;height:160px;overflow-x:auto;padding-bottom:8px">' + (trendBars || '<p class="vol-empty" style="width:100%">No trend data</p>') + '</div>' +
      '</div>' +
      '<div class="vol-card">' +
      '<h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">\uD83D\uDEE0\uFE0F Skills Distribution</h3>' +
      (skillBars || '<p class="vol-empty">No skills data</p>') +
      '</div></div>' +

      // Volunteer Retention + Status Distribution
      '<div class="vol-grid-2" style="margin-bottom:16px">' +
      '<div class="vol-card">' +
      '<h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">\uD83D\uDD04 Volunteer Retention (New per Month)</h3>' +
      (retentionBars || '<p class="vol-empty">No retention data</p>') +
      '</div>' +
      '<div class="vol-card">' +
      '<h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">\uD83D\uDCCB Volunteer Status Distribution</h3>' +
      '<div style="display:flex;flex-wrap:wrap;margin-bottom:14px">' + (statusRows || '<p class="vol-empty">No data</p>') + '</div>' +
      '<h4 style="font-size:13px;color:#64748b;margin:16px 0 10px">\uD83D\uDD04 Assignment Status</h4>' +
      '<div style="display:flex;flex-wrap:wrap">' +
      assignStatusDist.map(function(a) {
        return '<div style="display:inline-flex;align-items:center;gap:6px;margin-right:12px;margin-bottom:8px">' +
          statusBadge(a.status) +
          '<span style="font-size:13px;font-weight:700">' + a.cnt + '</span>' +
          '</div>';
      }).join('') +
      '</div></div></div>' +
      '</div>';

    res.send(renderPage('Volunteer Reports', html, user, req));
  }));

  // ============================================================
  // DONE
  // ============================================================
  console.log('[Volunteers] Module loaded: /volunteers');
};
