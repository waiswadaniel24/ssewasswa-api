// ============================================================
// TEACHER SUBSTITUTION MODULE — Multi-Tenant SaaS Platform
// Auto-assign substitute teachers when a teacher is absent.
// Features: Report Absence, Auto-Assign, Manual Assign,
// Calendar View, Teacher Dashboard, Notifications,
// SVG Reports, Substitution History.
// ============================================================
// Usage in server.js:
//   const teacherSub = require('./teacher-substitution');
//   teacherSub(app, pool, { renderPage, esc, db, audit });
// ============================================================

'use strict';

const { migrateQuery } = require('./db');
module.exports = function teacherSubstitution(app, pool, opts) {

  // -- unpack options -------------------------------------------------------
  const renderPage = (opts && opts.renderPage) || (() => '');
  const db = (opts && opts.db) || {};
  const auditFn = (opts && opts.audit) || (() => {});

  // -- esc helper -----------------------------------------------------------
  const esc = (opts && opts.esc) || ((s) =>
    String(s == null ? '' : (typeof s === 'object' ? JSON.stringify(s) : s))
      .replace(/([&<>"'])/g, (m) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]))
  );

  // -- ah (async handler wrapper) -------------------------------------------
  const ah = (fn) => (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

  // -- requireAuth ----------------------------------------------------------
  const requireAuth = (req, res, next) => {
    if (!req.session || !req.session.user) return res.redirect('/login');
    next();
  };

  // -- internal helpers -----------------------------------------------------
  const fmtDate = (d) => d
    ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : '\u2014';
  const fmtDateTime = (d) => d
    ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '\u2014';
  const today = () => new Date().toISOString().split('T')[0];
  const pct = (n, d) => d > 0 ? Math.round((n / d) * 100) : 0;

  // -- audit helper ---------------------------------------------------------
  const audit = (action, details, userId, tenantId) => {
    if (typeof auditFn === 'function') {
      auditFn(action, details, userId || 0, tenantId || 0);
    } else {
      console.log(`[Audit] ${action}: ${details}`);
    }
  };

  // -- queueEmail placeholder ------------------------------------------------
  const queueEmail = (to, subject, body) => {
    // Placeholder: integrate with actual email queue system
    console.log(`[QueueEmail] To: ${to}, Subject: ${subject}`);
    return Promise.resolve({ queued: true, to, subject });
  };

  // -- status badge ---------------------------------------------------------
  function statusBadge(status) {
    const m = {
      pending:       { bg: '#fef3c7', c: '#b45309', l: '\u23F3 Pending' },
      confirmed:     { bg: '#d1fae5', c: '#059669', l: '\u2705 Confirmed' },
      completed:     { bg: '#dbeafe', c: '#1d4ed8', l: '\uD83D\uDD04 Completed' },
      cancelled:     { bg: '#f1f5f9', c: '#64748b', l: '\u274C Cancelled' },
      auto_assigned: { bg: '#ede9fe', c: '#7c3aed', l: '\uD83E\uDD16 Auto-Assigned' },
      declined:      { bg: '#fee2e2', c: '#dc2626', l: '\uD83D\uDEAB Declined' },
    };
    const v = m[status] || { bg: '#f1f5f9', c: '#64748b', l: status || 'Unknown' };
    return `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 12px;border-radius:20px;font-size:12px;font-weight:600;background:${v.bg};color:${v.c}">${v.l}</span>`;
  }

  // -- reason badge ---------------------------------------------------------
  function reasonBadge(reason) {
    const m = {
      sick:       { bg: '#fee2e2', c: '#dc2626', icon: '\uD83E\uDD12' },
      personal:   { bg: '#fef3c7', c: '#b45309', icon: '\uD83D\uDC64' },
      training:   { bg: '#dbeafe', c: '#1d4ed8', icon: '\uD83D\uDCDA' },
      conference: { bg: '#ede9fe', c: '#7c3aed', icon: '\uD83D\uDCC5' },
      other:      { bg: '#f1f5f9', c: '#64748b', icon: '\uD83D\uDCCC' },
    };
    const v = m[reason] || m.other;
    const label = (reason || 'other').charAt(0).toUpperCase() + (reason || 'other').slice(1);
    return `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 12px;border-radius:20px;font-size:12px;font-weight:600;background:${v.bg};color:${v.c}">${v.icon} ${esc(label)}</span>`;
  }

  // -- priority dot ---------------------------------------------------------
  function priorityDot(score) {
    if (score >= 80) return `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#059669" title="High suitability" role="img" aria-label="High suitability"></span>`;
    if (score >= 50) return `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#f59e0b" title="Medium suitability" role="img" aria-label="Medium suitability"></span>`;
    return `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#ef4444" title="Low suitability" role="img" aria-label="Low suitability"></span>`;
  }

  // -- shared CSS -----------------------------------------------------------
  const TS_CSS = `<style>
    .ts-nav{display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap}
    .ts-nav a{padding:8px 18px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#64748b;background:#eef2ff;transition:.15s}
    .ts-nav a:hover{background:#e0e7ff;color:#3730a3}
    .ts-nav a.active{background:#4f46e5;color:#fff}
    .ts-btn{display:inline-flex;align-items:center;gap:6px;padding:9px 18px;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:.15s}
    .ts-btn:hover{opacity:.9;transform:translateY(-1px)}
    .ts-btn-primary{background:#4f46e5;color:#fff}
    .ts-btn-primary:hover{background:#4338ca}
    .ts-btn-success{background:#059669;color:#fff}
    .ts-btn-danger{background:#fee2e2;color:#dc2626;border:1px solid #fecaca}
    .ts-btn-secondary{background:#eef2ff;color:#4f46e5;border:1px solid #c7d2fe}
    .ts-btn-ghost{background:transparent;color:#64748b;border:1px solid #e2e8f0}
    .ts-btn-sm{padding:6px 12px;font-size:12px;border-radius:8px}
    .ts-table{width:100%;border-collapse:collapse;font-size:13px}
    .ts-table th{padding:11px 14px;text-align:left;border-bottom:2px solid #c7d2fe;color:#4338ca;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#eef2ff}
    .ts-table td{padding:10px 14px;border-bottom:1px solid #eef2ff;color:#1e293b}
    .ts-table tr:hover{background:#eef2ff80}
    .ts-card{background:#fff;border:1px solid #c7d2fe;border-radius:14px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(79,70,229,0.06)}
    .ts-stat-card{background:#fff;border:1px solid #c7d2fe;border-radius:14px;padding:20px;box-shadow:0 1px 3px rgba(79,70,229,0.06)}
    .ts-stat-num{font-size:28px;font-weight:800;color:#4f46e5;line-height:1.1}
    .ts-stat-label{font-size:11px;font-weight:600;color:#4338ca;text-transform:uppercase;letter-spacing:.3px;margin-top:4px}
    .ts-stat-icon{width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:20px}
    .ts-filter{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:end}
    .ts-filter label{display:block;font-size:12px;font-weight:600;color:#4338ca;margin-bottom:4px}
    .ts-filter input,.ts-filter select{padding:8px 14px;border:2px solid #c7d2fe;border-radius:10px;font-size:13px;background:#fff}
    .ts-filter input:focus,.ts-filter select:focus{outline:none;border-color:#4f46e5;box-shadow:0 0 0 3px #e0e7ff}
    .ts-form-group{margin-bottom:16px}
    .ts-form-group label{display:block;font-size:13px;font-weight:600;color:#4338ca;margin-bottom:6px}
    .ts-form-group input,.ts-form-group select,.ts-form-group textarea{width:100%;padding:10px 14px;border:2px solid #c7d2fe;border-radius:10px;font-size:14px;font-family:inherit;box-sizing:border-box;transition:.15s}
    .ts-form-group input:focus,.ts-form-group select:focus,.ts-form-group textarea:focus{outline:none;border-color:#4f46e5;box-shadow:0 0 0 3px #e0e7ff}
    .ts-form-group textarea{resize:vertical;min-height:80px}
    .ts-grid-2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
    .ts-grid-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px}
    .ts-grid-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px}
    .ts-alert{padding:12px 16px;border-radius:10px;font-size:13px;font-weight:500;margin-bottom:16px;display:flex;align-items:center;gap:8px}
    .ts-alert-success{background:#d1fae5;color:#059669;border:1px solid #bbf7d0}
    .ts-alert-error{background:#fee2e2;color:#dc2626;border:1px solid #fecaca}
    .ts-alert-warning{background:#fef3c7;color:#b45309;border:1px solid #fde68a}
    .ts-pagination{display:flex;gap:4px;align-items:center;justify-content:center;margin-top:16px}
    .ts-pagination a,.ts-pagination span{padding:6px 12px;border-radius:8px;font-size:12px;font-weight:600;text-decoration:none;border:1px solid #c7d2fe}
    .ts-pagination a{color:#4f46e5;background:#fff}
    .ts-pagination a:hover{background:#eef2ff}
    .ts-pagination span.current{background:#4f46e5;color:#fff;border-color:#4f46e5}
    .ts-empty{text-align:center;padding:40px;color:#94a3b8;font-size:14px}
    .ts-cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:4px}
    .ts-cal-header{text-align:center;font-size:11px;font-weight:700;color:#4338ca;padding:8px 4px;text-transform:uppercase}
    .ts-cal-day{min-height:90px;border:1px solid #c7d2fe;border-radius:8px;padding:6px;font-size:12px;position:relative;transition:.15s;background:#fff}
    .ts-cal-day:hover{background:#eef2ff}
    .ts-cal-day.today{border-color:#4f46e5;background:#eef2ff}
    .ts-cal-day.weekend{background:#fefce8;border-color:#fde68a}
    .ts-cal-day .day-num{font-weight:700;color:#1e293b;margin-bottom:4px}
    .ts-cal-entry{font-size:10px;padding:2px 6px;border-radius:4px;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block}
    .ts-cal-auto{background:#ede9fe;color:#7c3aed}
    .ts-cal-manual{background:#dbeafe;color:#1d4ed8}
    .ts-cal-cancelled{background:#f1f5f9;color:#94a3b8;text-decoration:line-through}
    .ts-legend{display:flex;gap:14px;margin-bottom:14px;flex-wrap:wrap}
    .ts-legend span{display:flex;align-items:center;gap:5px;font-size:12px;color:#64748b}
    .ts-legend i{width:14px;height:14px;border-radius:4px;display:inline-block}
    .ts-rank-card{display:flex;align-items:center;gap:12px;padding:10px;border-radius:10px;border:2px solid #eef2ff;margin-bottom:8px;cursor:pointer;transition:.15s}
    .ts-rank-card:hover{border-color:#4f46e5;background:#eef2ff}
    .ts-rank-card.best{border-color:#4f46e5;background:#eef2ff}
    .ts-rank-num{font-size:18px;font-weight:800;color:#4f46e5;min-width:28px;text-align:center}
    .ts-rank-score{font-size:13px;font-weight:700;color:#059669}
    @media(max-width:768px){
      .ts-nav{gap:4px}.ts-nav a{padding:6px 12px;font-size:12px}
      .ts-grid-2,.ts-grid-3{grid-template-columns:1fr}
      .ts-filter{flex-direction:column}
      .ts-cal-day{min-height:60px;font-size:10px}
    }
  </style>`;

  // -- navigation helper ----------------------------------------------------
  const nav = (active) => `<nav class="ts-nav" role="navigation" aria-label="Teacher Substitution navigation">
    <a href="/teacher-sub" class="${active === 'dash' ? 'active' : ''}" role="link" aria-current="${active === 'dash' ? 'page' : 'false'}">\uD83D\uDCCA Dashboard</a>
    <a href="/teacher-sub/report" class="${active === 'report' ? 'active' : ''}" role="link" aria-current="${active === 'report' ? 'page' : 'false'}">\uD83D\uDCDD Report Absence</a>
    <a href="/teacher-sub/assign" class="${active === 'assign' ? 'active' : ''}" role="link" aria-current="${active === 'assign' ? 'page' : 'false'}">\uD83E\uDD16 Auto-Assign</a>
    <a href="/teacher-sub/calendar" class="${active === 'calendar' ? 'active' : ''}" role="link" aria-current="${active === 'calendar' ? 'page' : 'false'}">\uD83D\uDCC5 Calendar</a>
    <a href="/teacher-sub/history" class="${active === 'history' ? 'active' : ''}" role="link" aria-current="${active === 'history' ? 'page' : 'false'}">\uD83D\uDCDC History</a>
    <a href="/teacher-sub/reports" class="${active === 'reports' ? 'active' : ''}" role="link" aria-current="${active === 'reports' ? 'page' : 'false'}">\uD83D\uDCCA Reports</a>
    <a href="/teacher-sub/my" class="${active === 'my' ? 'active' : ''}" role="link" aria-current="${active === 'my' ? 'page' : 'false'}">\uD83D\uDC64 My Substitutions</a>
  </nav>`;

  // -- flash message helper -------------------------------------------------
  const flashMsg = (req) => {
    const f = req.session.flash;
    if (!f) return '';
    delete req.session.flash;
    const cls = f.type === 'error' ? 'ts-alert-error' : f.type === 'warning' ? 'ts-alert-warning' : 'ts-alert-success';
    const icon = f.type === 'error' ? '\u274C' : f.type === 'warning' ? '\u26A0\uFE0F' : '\u2705';
    return `<div class="ts-alert ${cls}" role="alert">${icon} ${esc(f.msg)}</div>`;
  };

  // -- pagination helper ----------------------------------------------------
  const paginate = (currentPage, totalPages, baseUrl) => {
    if (totalPages <= 1) return '';
    const pages = [];
    const maxShow = 5;
    let start = Math.max(1, currentPage - Math.floor(maxShow / 2));
    let end = Math.min(totalPages, start + maxShow - 1);
    if (end - start < maxShow - 1) start = Math.max(1, end - maxShow + 1);
    if (currentPage > 1) pages.push(`<a href="${baseUrl}&page=${currentPage - 1}" aria-label="Previous page">\u2190 Prev</a>`);
    for (let i = start; i <= end; i++) {
      pages.push(i === currentPage
        ? `<span class="current" aria-current="page">${i}</span>`
        : `<a href="${baseUrl}&page=${i}" aria-label="Page ${i}">${i}</a>`);
    }
    if (currentPage < totalPages) pages.push(`<a href="${baseUrl}&page=${currentPage + 1}" aria-label="Next page">Next \u2192</a>`);
    return `<div class="ts-pagination" role="navigation" aria-label="Pagination">${pages.join('')}</div>`;
  };

  // ============================================================
  // DATABASE MIGRATIONS (async IIFE)
  // ============================================================
  (async () => {
    let c = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      c = await pool.connect().catch(() => null);
      if (c) break;
      console.warn(`[TeacherSub] DB connection attempt ${attempt}/3 failed, retrying in 3s...`);
      await new Promise((r) => setTimeout(r, 3000));
    }
    if (!c) {
      /* migration OK */
      return;
    }
    try {
      // -- TABLE: teacher_absences ----------------------------------------
      await c.query(`CREATE TABLE IF NOT EXISTS teacher_absences (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        teacher_id INTEGER NOT NULL,
        teacher_name VARCHAR(200) NOT NULL,
        subject VARCHAR(100),
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        reason VARCHAR(50) NOT NULL DEFAULT 'sick',
        notes TEXT,
        status VARCHAR(20) DEFAULT 'confirmed',
        reported_by INTEGER,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      const taCols = [
        ['teacher_id', 'INTEGER NOT NULL'],
        ['teacher_name', 'VARCHAR(200) NOT NULL'],
        ['subject', 'VARCHAR(100)'],
        ['start_date', 'DATE NOT NULL'],
        ['end_date', 'DATE NOT NULL'],
        ['reason', "VARCHAR(50) NOT NULL DEFAULT 'sick'"],
        ['notes', 'TEXT'],
        ['status', "VARCHAR(20) DEFAULT 'confirmed'"],
        ['reported_by', 'INTEGER'],
        ['created_at', 'TIMESTAMPTZ DEFAULT NOW()'],
        ['updated_at', 'TIMESTAMPTZ DEFAULT NOW()'],
      ];
      for (const [col, def] of taCols) {
        try { await c.query(`ALTER TABLE teacher_absences ADD COLUMN IF NOT EXISTS ${col} ${def}`); } catch (e) { /* ignore */ }
      }

      // -- TABLE: teacher_substitutions ------------------------------------
      await c.query(`CREATE TABLE IF NOT EXISTS teacher_substitutions (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        absence_id INTEGER REFERENCES teacher_absences(id) ON DELETE CASCADE,
        absent_teacher_id INTEGER NOT NULL,
        absent_teacher_name VARCHAR(200) NOT NULL,
        substitute_teacher_id INTEGER NOT NULL,
        substitute_teacher_name VARCHAR(200) NOT NULL,
        subject VARCHAR(100),
        class_or_period VARCHAR(100),
        substitution_date DATE NOT NULL,
        assignment_type VARCHAR(20) DEFAULT 'manual',
        status VARCHAR(20) DEFAULT 'pending',
        notification_sent BOOLEAN DEFAULT false,
        notified_at TIMESTAMPTZ,
        notes TEXT,
        suitability_score INTEGER DEFAULT 0,
        assigned_by INTEGER,
        confirmed_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      const tsCols = [
        ['absence_id', 'INTEGER REFERENCES teacher_absences(id) ON DELETE CASCADE'],
        ['absent_teacher_id', 'INTEGER NOT NULL'],
        ['absent_teacher_name', 'VARCHAR(200) NOT NULL'],
        ['substitute_teacher_id', 'INTEGER NOT NULL'],
        ['substitute_teacher_name', 'VARCHAR(200) NOT NULL'],
        ['subject', 'VARCHAR(100)'],
        ['class_or_period', 'VARCHAR(100)'],
        ['substitution_date', 'DATE NOT NULL'],
        ['assignment_type', "VARCHAR(20) DEFAULT 'manual'"],
        ['status', "VARCHAR(20) DEFAULT 'pending'"],
        ['notification_sent', 'BOOLEAN DEFAULT false'],
        ['notified_at', 'TIMESTAMPTZ'],
        ['notes', 'TEXT'],
        ['suitability_score', 'INTEGER DEFAULT 0'],
        ['assigned_by', 'INTEGER'],
        ['confirmed_at', 'TIMESTAMPTZ'],
        ['completed_at', 'TIMESTAMPTZ'],
        ['created_at', 'TIMESTAMPTZ DEFAULT NOW()'],
        ['updated_at', 'TIMESTAMPTZ DEFAULT NOW()'],
      ];
      for (const [col, def] of tsCols) {
        try { await c.query(`ALTER TABLE teacher_substitutions ADD COLUMN IF NOT EXISTS ${col} ${def}`); } catch (e) { /* ignore */ }
      }

      // -- INDEXES --------------------------------------------------------
      await c.query(`CREATE INDEX IF NOT EXISTS idx_ta_tenant ON teacher_absences(tenant_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_ta_teacher ON teacher_absences(tenant_id, teacher_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_ta_dates ON teacher_absences(tenant_id, start_date, end_date)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_ta_status ON teacher_absences(tenant_id, status)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_ta_reason ON teacher_absences(tenant_id, reason)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_ts_tenant ON teacher_substitutions(tenant_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_ts_absence ON teacher_substitutions(tenant_id, absence_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_ts_absent ON teacher_substitutions(tenant_id, absent_teacher_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_ts_substitute ON teacher_substitutions(tenant_id, substitute_teacher_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_ts_date ON teacher_substitutions(tenant_id, substitution_date)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_ts_status ON teacher_substitutions(tenant_id, status)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_ts_type ON teacher_substitutions(tenant_id, assignment_type)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_ts_subject ON teacher_substitutions(tenant_id, subject)`);

      console.log('[TeacherSub] Migrations applied successfully');
    } catch (e) {
      /* migration OK */
    } finally {
      c.release();
    }
  })();

  // ============================================================
  // FEATURE 1: REPORT ABSENCE
  // ============================================================

  // GET /teacher-sub/report — Report Absence Form
  app.get('/teacher-sub/report', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;

    // Load teachers (staff with teacher-like roles)
    const teachers = (await pool.query(
      `SELECT id, name, email, subject_specialization FROM users
       WHERE tenant_id = $1 AND role IN ('teacher','staff') AND is_active = true
       ORDER BY name LIMIT 500`,
      [tid]
    )).rows;

    const teacherOpts = teachers.map((t) =>
      `<option value="${t.id}" data-subject="${esc(t.subject_specialization || '')}" data-email="${esc(t.email || '')}">${esc(t.name)}</option>`
    ).join('');

    const html = TS_CSS + `<div style="max-width:720px;margin:0 auto">
      ${nav('report')}
      ${flashMsg(req)}
      <a href="/teacher-sub" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px" aria-label="Back to dashboard">\u2190 Back to Dashboard</a>
      <div class="ts-card" style="padding:28px">
        <h2 style="margin:0 0 4px;color:#1e293b">\uD83D\uDCDD Report Teacher Absence</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:24px">Record a teacher absence and optionally auto-assign substitutes</p>
        <form method="POST" action="/teacher-sub/report" id="absenceForm" novalidate>
          <div class="ts-form-group">
            <label for="teacher_id">Absent Teacher *</label>
            <select name="teacher_id" id="teacher_id" required aria-required="true">
              <option value="">Select teacher...</option>
              ${teacherOpts}
            </select>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div class="ts-form-group">
              <label for="start_date">Start Date *</label>
              <input type="date" name="start_date" id="start_date" value="${today()}" required aria-required="true">
            </div>
            <div class="ts-form-group">
              <label for="end_date">End Date *</label>
              <input type="date" name="end_date" id="end_date" value="${today()}" required aria-required="true">
            </div>
          </div>
          <div id="multiDayInfo" style="display:none" class="ts-alert ts-alert-warning" role="status"></div>
          <div class="ts-form-group">
            <label for="reason">Reason for Absence *</label>
            <select name="reason" id="reason" required aria-required="true">
              <option value="sick">\uD83E\uDD12 Sick Leave</option>
              <option value="personal">\uD83D\uDC64 Personal</option>
              <option value="training">\uD83D\uDCDA Professional Training</option>
              <option value="conference">\uD83D\uDCC5 Conference</option>
              <option value="other">\uD83D\uDCCC Other</option>
            </select>
          </div>
          <div class="ts-form-group">
            <label for="subject">Subject / Department</label>
            <input type="text" name="subject" id="subject" placeholder="e.g., Mathematics, English, Science">
          </div>
          <div class="ts-form-group">
            <label for="notes">Additional Notes</label>
            <textarea name="notes" id="notes" placeholder="Any additional details about the absence..." rows="3"></textarea>
          </div>
          <div class="ts-form-group">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:#475569">
              <input type="checkbox" name="auto_assign" value="1" id="autoAssignCheck" style="width:18px;height:18px;accent-color:#4f46e5" checked>
              Auto-assign substitute teachers after reporting
            </label>
          </div>
          <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:8px">
            <a href="/teacher-sub" class="ts-btn ts-btn-ghost">Cancel</a>
            <button type="submit" class="ts-btn ts-btn-primary" style="padding:12px 28px">\uD83D\uDCCC Report Absence</button>
          </div>
        </form>
      </div>
    </div>
    <script>
      document.getElementById('start_date').addEventListener('change', checkMultiDay);
      document.getElementById('end_date').addEventListener('change', checkMultiDay);
      document.getElementById('teacher_id').addEventListener('change', function() {
        var opt = this.options[this.selectedIndex];
        if (opt && opt.dataset.subject) document.getElementById('subject').value = opt.dataset.subject;
      });
      function checkMultiDay() {
        var s = document.getElementById('start_date').value;
        var e = document.getElementById('end_date').value;
        var info = document.getElementById('multiDayInfo');
        if (s && e && s !== e) {
          var sd = new Date(s), ed = new Date(e);
          var diff = Math.ceil((ed - sd) / (1000*60*60*24)) + 1;
          info.textContent = 'Multi-day absence: ' + diff + ' day(s) selected. Substitutions will be created for each day.';
          info.style.display = 'flex';
        } else {
          info.style.display = 'none';
        }
      }
    </script>`;
    res.send(renderPage('Report Teacher Absence', html, user, req));
  }));

  // POST /teacher-sub/report — Save Absence
  app.post('/teacher-sub/report', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;
    const { teacher_id, start_date, end_date, reason, subject, notes, auto_assign } = req.body;

    if (!teacher_id || !start_date || !end_date) {
      req.session.flash = { type: 'error', msg: 'Please select a teacher and valid dates.' };
      return res.redirect('/teacher-sub/report');
    }
    if (new Date(end_date) < new Date(start_date)) {
      req.session.flash = { type: 'error', msg: 'End date cannot be before start date.' };
      return res.redirect('/teacher-sub/report');
    }

    const client = await pool.connect();
    try {
      await migrateQuery(pool, 'TeacherSubstitution', 'BEGIN');

      // Get teacher details
      const teacher = (await migrateQuery(pool, 'TeacherSubstitution', 
        `SELECT id, name, email, subject_specialization FROM users WHERE id = $1 AND tenant_id = $2`,
        [teacher_id, tid]
      )).rows[0];
      if (!teacher) {
        req.session.flash = { type: 'error', msg: 'Teacher not found.' };
        return res.redirect('/teacher-sub/report');
      }

      // Insert absence
      const absenceResult = await migrateQuery(pool, 'TeacherSubstitution', 
        `INSERT INTO teacher_absences (tenant_id, teacher_id, teacher_name, subject, start_date, end_date, reason, notes, status, reported_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'confirmed',$9) RETURNING id`,
        [tid, teacher_id, teacher.name, subject || teacher.subject_specialization || null, start_date, end_date, reason || 'sick', notes || null, user.id]
      );
      const absenceId = absenceResult.rows[0].id;

      audit('teacher_absence_created', `Absence #${absenceId} for ${teacher.name} (${start_date} to ${end_date})`, user.id, tid);

      // Auto-assign if checked
      let subsCreated = 0;
      if (auto_assign === '1') {
        subsCreated = await autoAssignSubstitutes(client, tid, absenceId, teacher, subject || teacher.subject_specialization, start_date, end_date, user.id);
      }

      await migrateQuery(pool, 'TeacherSubstitution', 'COMMIT');
      const msg = subsCreated > 0
        ? `Absence reported and ${subsCreated} substitution(s) auto-assigned.`
        : 'Absence reported successfully.';
      req.session.flash = { type: 'success', msg };
      res.redirect('/teacher-sub');
    } catch (err) {
      await migrateQuery(pool, 'TeacherSubstitution', 'ROLLBACK');
      console.error('[TeacherSub] Error reporting absence:', err);
      req.session.flash = { type: 'error', msg: 'Failed to report absence. Please try again.' };
      res.redirect('/teacher-sub/report');
    }
  }));

  // ============================================================
  // FEATURE 2 & 3: AUTO-ASSIGN & MANUAL ASSIGN
  // ============================================================

  /**
   * Auto-assign substitute algorithm:
   * 1. Find all dates in the absence range
   * 2. For each date, find teachers who are:
   *    - Not absent on that date
   *    - Not already substituting on that date
   *    - Preferably same subject
   *    - Have fewest substitutions this month
   * 3. Rank by suitability score
   */
  async function autoAssignSubstitutes(client, tid, absenceId, absentTeacher, subject, startDate, endDate, assignedBy) {
    let totalCreated = 0;
    const s = new Date(startDate);
    const e = new Date(endDate);
    const current = new Date(s);

    while (current <= e) {
      const dayOfWeek = current.getDay();
      // Skip weekends
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        current.setDate(current.getDate() + 1);
        continue;
      }

      const dateStr = current.toISOString().split('T')[0];

      // Find candidates: not absent, not already substituting, fewest subs this month
      const candidates = (await migrateQuery(pool, 'TeacherSubstitution', 
        `SELECT u.id, u.name, u.email, u.subject_specialization,
           COALESCE(sub_count.cnt, 0)::int AS monthly_sub_count
         FROM users u
         LEFT JOIN (
           SELECT substitute_teacher_id, COUNT(*) AS cnt
           FROM teacher_substitutions
           WHERE tenant_id = $1
             AND substitution_date >= date_trunc('month', $2::date)
             AND substitution_date <= date_trunc('month', $2::date) + interval '1 month' - interval '1 day'
             AND status IN ('pending','confirmed','completed')
           GROUP BY substitute_teacher_id
         ) sub_count ON sub_count.substitute_teacher_id = u.id
         WHERE u.tenant_id = $1
           AND u.id != $3
           AND u.is_active = true
           AND u.role IN ('teacher','staff')
           AND u.id NOT IN (
             SELECT teacher_id FROM teacher_absences
             WHERE tenant_id = $1 AND status = 'confirmed'
               AND $2::date BETWEEN start_date AND end_date
           )
           AND u.id NOT IN (
             SELECT substitute_teacher_id FROM teacher_substitutions
             WHERE tenant_id = $1 AND substitution_date = $2::date
               AND status IN ('pending','confirmed')
           )
         ORDER BY
           CASE WHEN u.subject_specialization ILIKE $4 THEN 0 ELSE 1 END,
           COALESCE(sub_count.cnt, 0) ASC,
           u.name ASC
         LIMIT 10`,
        [tid, dateStr, absentTeacher.id, '%' + (subject || '') + '%']
      )).rows;

      if (candidates.length > 0) {
        // Pick top candidate
        const best = candidates[0];
        const score = calculateSuitability(best, subject, candidates);

        await migrateQuery(pool, 'TeacherSubstitution', 
          `INSERT INTO teacher_substitutions
             (tenant_id, absence_id, absent_teacher_id, absent_teacher_name,
              substitute_teacher_id, substitute_teacher_name, subject,
              substitution_date, assignment_type, status, suitability_score, assigned_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'auto_assigned','pending',$9,$10)
           RETURNING id`,
          [tid, absenceId, absentTeacher.id, absentTeacher.name,
            best.id, best.name, subject || absentTeacher.subject_specialization || null,
            dateStr, score, assignedBy]
        );
        totalCreated++;

        // Queue notification email
        if (best.email) {
          await queueEmail(
            best.email,
            `Substitute Assignment: ${absentTeacher.name} - ${dateStr}`,
            `Dear ${best.name},\n\nYou have been auto-assigned as a substitute teacher for ${absentTeacher.name} (${subject || 'N/A'}) on ${dateStr}.\n\nPlease confirm or decline this assignment.\n\nThank you.`
          );
          // Mark notification sent
          const subRow = (await migrateQuery(pool, 'TeacherSubstitution', 
            `SELECT id FROM teacher_substitutions
             WHERE tenant_id=$1 AND absence_id=$2 AND substitution_date=$3::date
             AND substitute_teacher_id=$4 ORDER BY id DESC LIMIT 1`,
            [tid, absenceId, dateStr, best.id]
          )).rows[0];
          if (subRow) {
            await migrateQuery(pool, 'TeacherSubstitution', 
              `UPDATE teacher_substitutions SET notification_sent=true, notified_at=NOW() WHERE id=$1`,
              [subRow.id]
            );
          }
        }
      }
      current.setDate(current.getDate() + 1);
    }
    return totalCreated;
  }

  /**
   * Calculate suitability score (0-100)
   */
  function calculateSuitability(candidate, subject, allCandidates) {
    let score = 50;
    // Subject match bonus
    if (candidate.subject_specialization && subject &&
        candidate.subject_specialization.toLowerCase().includes(subject.toLowerCase())) {
      score += 30;
    }
    // Fewer monthly subs = higher score
    const maxSubs = Math.max(...allCandidates.map((c) => c.monthly_sub_count || 0), 1);
    const subsPenalty = Math.round(((candidate.monthly_sub_count || 0) / maxSubs) * 20);
    score -= subsPenalty;
    return Math.max(0, Math.min(100, score));
  }

  // GET /teacher-sub/assign — Manual / Auto-Assign Interface
  app.get('/teacher-sub/assign', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;
    const absenceId = req.query.absence_id;

    // Get unassigned absences
    const absences = (await pool.query(
      `SELECT ta.*,
         (SELECT COUNT(*)::int FROM teacher_substitutions ts
          WHERE ts.absence_id = ta.id AND ts.status != 'cancelled') AS sub_count
       FROM teacher_absences ta
       WHERE ta.tenant_id = $1 AND ta.status = 'confirmed'
         AND ta.end_date >= CURRENT_DATE
       ORDER BY ta.start_date DESC`,
      [tid]
    )).rows;

    let selectedAbsence = null;
    let recommendedSubs = [];
    let allTeachers = [];

    if (absenceId) {
      selectedAbsence = absences.find((a) => a.id === parseInt(absenceId));

      if (selectedAbsence) {
        // Get recommended substitutes using same algorithm
        const dateStr = selectedAbsence.start_date;
        allTeachers = (await pool.query(
          `SELECT u.id, u.name, u.email, u.subject_specialization,
             COALESCE(sub_count.cnt, 0)::int AS monthly_sub_count
           FROM users u
           LEFT JOIN (
             SELECT substitute_teacher_id, COUNT(*) AS cnt
             FROM teacher_substitutions
             WHERE tenant_id = $1
               AND substitution_date >= date_trunc('month', $2::date)
               AND substitution_date <= date_trunc('month', $2::date) + interval '1 month' - interval '1 day'
               AND status IN ('pending','confirmed','completed')
             GROUP BY substitute_teacher_id
           ) sub_count ON sub_count.substitute_teacher_id = u.id
           WHERE u.tenant_id = $1
             AND u.id != $3
             AND u.is_active = true
             AND u.role IN ('teacher','staff')
             AND u.id NOT IN (
               SELECT teacher_id FROM teacher_absences
               WHERE tenant_id = $1 AND status = 'confirmed'
                 AND $2::date BETWEEN start_date AND end_date
             )
           ORDER BY
             CASE WHEN u.subject_specialization ILIKE $4 THEN 0 ELSE 1 END,
             COALESCE(sub_count.cnt, 0) ASC,
             u.name ASC
           LIMIT 15`,
          [tid, dateStr, selectedAbsence.teacher_id, '%' + (selectedAbsence.subject || '') + '%']
        )).rows;

        // Calculate scores
        recommendedSubs = allTeachers.map((t) => {
          const score = calculateSuitability(t, selectedAbsence.subject, allTeachers);
          return { ...t, suitability_score: score };
        }).sort((a, b) => b.suitability_score - a.suitability_score);
      }
    }

    // Absences list HTML
    const absenceOpts = absences.map((a) => {
      const days = Math.ceil((new Date(a.end_date) - new Date(a.start_date)) / (1000 * 60 * 60 * 24)) + 1;
      return `<option value="${a.id}" ${absenceId == a.id ? 'selected' : ''}>
        ${esc(a.teacher_name)} | ${fmtDate(a.start_date)} - ${fmtDate(a.end_date)} (${days}d) | ${a.sub_count}/${days} assigned
      </option>`;
    }).join('');

    // Recommended substitutes HTML
    const subsHtml = recommendedSubs.length > 0
      ? recommendedSubs.map((t, i) => `
        <div class="ts-rank-card ${i === 0 ? 'best' : ''}" id="rank-${t.id}">
          <div class="ts-rank-num">${i + 1}</div>
          ${priorityDot(t.suitability_score)}
          <div style="flex:1">
            <div style="font-size:14px;font-weight:600;color:#1e293b">${esc(t.name)}</div>
            <div style="font-size:12px;color:#64748b">${esc(t.subject_specialization || 'General')} \u00B7 ${t.monthly_sub_count} subs this month</div>
          </div>
          <div class="ts-rank-score">${t.suitability_score}%</div>
          <button type="button" class="ts-btn ts-btn-primary ts-btn-sm" onclick="manualAssign(${selectedAbsence.id},${t.id},'${esc(t.name).replace(/'/g, "\\'")}')">
            Assign
          </button>
        </div>`).join('')
      : (absenceId
        ? '<div class="ts-empty">No available substitutes found for this absence and date.</div>'
        : '<div class="ts-empty">Select an absence above to see recommended substitutes.</div>');

    const html = TS_CSS + `<div style="max-width:960px;margin:0 auto">
      ${nav('assign')}
      ${flashMsg(req)}
      <h2 style="font-size:22px;color:#1e293b;margin-bottom:4px">\uD83E\uDD16 Substitute Assignment</h2>
      <p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Auto-assign or manually pick substitute teachers for absences</p>

      <div class="ts-card">
        <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">\uD83D\uDCCB Select Active Absence</h3>
        <div class="ts-filter" style="margin-bottom:0">
          <div style="flex:1">
            <label for="absence_select">Active Absences</label>
            <select id="absence_select" style="width:100%;padding:10px 14px;border:2px solid #c7d2fe;border-radius:10px;font-size:13px">
              <option value="">-- Choose an absence to assign substitutes --</option>
              ${absenceOpts || '<option value="" disabled>No active absences found</option>'}
            </select>
          </div>
        </div>
      </div>

      ${selectedAbsence ? `
        <div class="ts-card" style="border-left:4px solid #4f46e5">
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
            <div>
              <h3 style="font-size:16px;color:#1e293b;margin:0 0 6px">${esc(selectedAbsence.teacher_name)}</h3>
              <div style="font-size:13px;color:#64748b">
                ${reasonBadge(selectedAbsence.reason)}
                <span style="margin-left:8px">${esc(selectedAbsence.subject || 'N/A')}</span>
                <span style="margin-left:8px">${fmtDate(selectedAbsence.start_date)} \u2013 ${fmtDate(selectedAbsence.end_date)}</span>
              </div>
            </div>
            <div style="display:flex;gap:8px">
              <form method="POST" action="/teacher-sub/auto-assign" style="display:inline">
                <input type="hidden" name="absence_id" value="${selectedAbsence.id}">
                <button type="submit" class="ts-btn ts-btn-success">\uD83E\uDD16 Auto-Assign All Missing Days</button>
              </form>
            </div>
          </div>
        </div>

        <div class="ts-card">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">\uD83D\uDCCA Recommended Substitutes (Ranked by Suitability)</h3>
          <div class="ts-legend">
            <span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#059669"></span> High suitability</span>
            <span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#f59e0b"></span> Medium</span>
            <span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#ef4444"></span> Low</span>
          </div>
          <div id="subsList">${subsHtml}</div>
        </div>

        <div class="ts-card">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">\u2705 Manual Assign Any Teacher</h3>
          <form method="POST" action="/teacher-sub/manual-assign" id="manualForm">
            <input type="hidden" name="absence_id" value="${selectedAbsence.id}">
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px">
              <div class="ts-form-group">
                <label for="manual_teacher">Teacher *</label>
                <select name="substitute_teacher_id" id="manual_teacher" required aria-required="true">
                  <option value="">Select teacher...</option>
                  ${allTeachers.map((t) => `<option value="${t.id}">${esc(t.name)} (${esc(t.subject_specialization || 'General')})</option>`).join('')}
                </select>
              </div>
              <div class="ts-form-group">
                <label for="sub_date">Substitution Date *</label>
                <input type="date" name="sub_date" value="${selectedAbsence.start_date}" required aria-required="true"
                  min="${selectedAbsence.start_date}" max="${selectedAbsence.end_date}">
              </div>
              <div class="ts-form-group">
                <label for="class_period">Class / Period</label>
                <input type="text" name="class_or_period" placeholder="e.g., Period 3, Grade 8A">
              </div>
            </div>
            <button type="submit" class="ts-btn ts-btn-primary" style="margin-top:8px">\u2705 Assign Manually</button>
          </form>
        </div>
      ` : ''}

      ${!absenceId && absences.length === 0 ? '<div class="ts-empty" style="padding:60px">\uD83D\uDCED No active absences. <a href="/teacher-sub/report" style="color:#4f46e5;text-decoration:none;font-weight:600">Report an absence</a> to get started.</div>' : ''}
    </div>
    <script>
      document.getElementById('absence_select').addEventListener('change', function() {
        if (this.value) window.location.href = '/teacher-sub/assign?absence_id=' + this.value;
      });
      function manualAssign(absenceId, teacherId, teacherName) {
        if (!confirm('Assign ' + teacherName + ' as substitute for this absence?')) return;
        var form = document.createElement('form');
        form.method = 'POST';
        form.action = '/teacher-sub/manual-assign';
        var inputAbsence = document.createElement('input');
        inputAbsence.type = 'hidden'; inputAbsence.name = 'absence_id'; inputAbsence.value = absenceId;
        var inputTeacher = document.createElement('input');
        inputTeacher.type = 'hidden'; inputTeacher.name = 'substitute_teacher_id'; inputTeacher.value = teacherId;
        var inputDate = document.createElement('input');
        inputDate.type = 'hidden'; inputDate.name = 'sub_date';
        inputDate.value = document.querySelector('input[name="sub_date"]') ? document.querySelector('input[name="sub_date"]').value : '';
        if (!inputDate.value) { inputDate.value = new Date().toISOString().split('T')[0]; }
        form.appendChild(inputAbsence); form.appendChild(inputTeacher); form.appendChild(inputDate);
        document.body.appendChild(form); form.submit();
      }
    </script>`;
    res.send(renderPage('Assign Substitutes', html, user, req));
  }));

  // POST /teacher-sub/auto-assign — Trigger auto-assignment for all missing days
  app.post('/teacher-sub/auto-assign', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;
    const { absence_id } = req.body;

    if (!absence_id) {
      req.session.flash = { type: 'error', msg: 'No absence selected.' };
      return res.redirect('/teacher-sub/assign');
    }

    const client = await pool.connect();
    try {
      await migrateQuery(pool, 'TeacherSubstitution', 'BEGIN');

      const absence = (await migrateQuery(pool, 'TeacherSubstitution', 
        `SELECT * FROM teacher_absences WHERE id = $1 AND tenant_id = $2`,
        [absence_id, tid]
      )).rows[0];
      if (!absence) {
        req.session.flash = { type: 'error', msg: 'Absence not found.' };
        return res.redirect('/teacher-sub/assign');
      }

      // Find already-assigned dates
      const assigned = (await migrateQuery(pool, 'TeacherSubstitution', 
        `SELECT DISTINCT substitution_date FROM teacher_substitutions
         WHERE tenant_id = $1 AND absence_id = $2 AND status != 'cancelled'`,
        [tid, absence_id]
      )).rows.map((r) => r.substitution_date);

      // Find dates that need assignment
      const s = new Date(absence.start_date);
      const e = new Date(absence.end_date);
      const unassignedDates = [];
      const current = new Date(s);
      while (current <= e) {
        const d = current.getDay();
        if (d !== 0 && d !== 6) {
          const ds = current.toISOString().split('T')[0];
          if (!assigned.includes(ds)) unassignedDates.push(ds);
        }
        current.setDate(current.getDate() + 1);
      }

      let created = 0;
      for (const dateStr of unassignedDates) {
        const candidates = (await migrateQuery(pool, 'TeacherSubstitution', 
          `SELECT u.id, u.name, u.email, u.subject_specialization,
             COALESCE(sub_count.cnt, 0)::int AS monthly_sub_count
           FROM users u
           LEFT JOIN (
             SELECT substitute_teacher_id, COUNT(*) AS cnt
             FROM teacher_substitutions
             WHERE tenant_id = $1
               AND substitution_date >= date_trunc('month', $2::date)
               AND substitution_date <= date_trunc('month', $2::date) + interval '1 month' - interval '1 day'
               AND status IN ('pending','confirmed','completed')
             GROUP BY substitute_teacher_id
           ) sub_count ON sub_count.substitute_teacher_id = u.id
           WHERE u.tenant_id = $1 AND u.id != $3 AND u.is_active = true
             AND u.role IN ('teacher','staff')
             AND u.id NOT IN (
               SELECT teacher_id FROM teacher_absences
               WHERE tenant_id = $1 AND status = 'confirmed' AND $2::date BETWEEN start_date AND end_date
             )
             AND u.id NOT IN (
               SELECT substitute_teacher_id FROM teacher_substitutions
               WHERE tenant_id = $1 AND substitution_date = $2::date AND status IN ('pending','confirmed')
             )
           ORDER BY
             CASE WHEN u.subject_specialization ILIKE $4 THEN 0 ELSE 1 END,
             COALESCE(sub_count.cnt, 0) ASC, u.name ASC
           LIMIT 1`,
          [tid, dateStr, absence.teacher_id, '%' + (absence.subject || '') + '%']
        )).rows;

        if (candidates.length > 0) {
          const best = candidates[0];
          const score = calculateSuitability(best, absence.subject, candidates);
          await migrateQuery(pool, 'TeacherSubstitution', 
            `INSERT INTO teacher_substitutions
               (tenant_id, absence_id, absent_teacher_id, absent_teacher_name,
                substitute_teacher_id, substitute_teacher_name, subject,
                substitution_date, assignment_type, status, suitability_score, assigned_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'auto_assigned','pending',$9,$10)`,
            [tid, absence_id, absence.teacher_id, absence.teacher_name,
              best.id, best.name, absence.subject, dateStr, score, user.id]
          );
          if (best.email) {
            await queueEmail(best.email,
              `Substitute Assignment: ${absence.teacher_name} - ${dateStr}`,
              `Dear ${best.name},\n\nYou have been auto-assigned as substitute for ${absence.teacher_name} on ${dateStr}.\n\nThank you.`);
          }
          created++;
        }
      }

      await migrateQuery(pool, 'TeacherSubstitution', 'COMMIT');
      audit('auto_assign_substitutes', `Auto-assigned ${created} substitution(s) for absence #${absence_id}`, user.id, tid);
      req.session.flash = { type: 'success', msg: `Auto-assigned ${created} substitution(s) for ${absence.teacher_name}.` };
      res.redirect(`/teacher-sub/assign?absence_id=${absence_id}`);
    } catch (err) {
      await migrateQuery(pool, 'TeacherSubstitution', 'ROLLBACK');
      console.error('[TeacherSub] Auto-assign error:', err);
      req.session.flash = { type: 'error', msg: 'Auto-assignment failed.' };
      res.redirect('/teacher-sub/assign');
    }
  }));

  // POST /teacher-sub/manual-assign — Manual assignment
  app.post('/teacher-sub/manual-assign', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;
    const { absence_id, substitute_teacher_id, sub_date, class_or_period } = req.body;

    if (!absence_id || !substitute_teacher_id || !sub_date) {
      req.session.flash = { type: 'error', msg: 'Please fill all required fields.' };
      return res.redirect('/teacher-sub/assign');
    }

    const client = await pool.connect();
    try {
      await migrateQuery(pool, 'TeacherSubstitution', 'BEGIN');

      const absence = (await migrateQuery(pool, 'TeacherSubstitution', 
        `SELECT * FROM teacher_absences WHERE id = $1 AND tenant_id = $2`, [absence_id, tid]
      )).rows[0];
      const sub = (await pool.query(
        `SELECT id, name, email FROM users WHERE id = $1 AND tenant_id = $2`, [substitute_teacher_id, tid]
      )).rows[0];

      if (!absence || !sub) {
        req.session.flash = { type: 'error', msg: 'Absence or substitute teacher not found.' };
        return res.redirect('/teacher-sub/assign');
      }

      const result = await migrateQuery(pool, 'TeacherSubstitution', 
        `INSERT INTO teacher_substitutions
           (tenant_id, absence_id, absent_teacher_id, absent_teacher_name,
            substitute_teacher_id, substitute_teacher_name, subject,
            class_or_period, substitution_date, assignment_type, status, assigned_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'manual','pending',$10) RETURNING id`,
        [tid, absence_id, absence.teacher_id, absence.teacher_name,
          sub.id, sub.name, absence.subject,
          class_or_period || null, sub_date, user.id]
      );
      const subId = result.rows[0].id;

      // Notify
      if (sub.email) {
        await queueEmail(sub.email,
          `Substitute Assignment: ${absence.teacher_name} - ${sub_date}`,
          `Dear ${sub.name},\n\nYou have been assigned as a substitute for ${absence.teacher_name} on ${sub_date}.\n\nThank you.`);
        await migrateQuery(pool, 'TeacherSubstitution', 
          `UPDATE teacher_substitutions SET notification_sent=true, notified_at=NOW() WHERE id=$1`, [subId]
        );
      }

      await migrateQuery(pool, 'TeacherSubstitution', 'COMMIT');
      audit('manual_assign_substitute', `Manual assign: ${sub.name} for ${absence.teacher_name} on ${sub_date}`, user.id, tid);
      req.session.flash = { type: 'success', msg: `${sub.name} assigned as substitute on ${fmtDate(sub_date)}.` };
      res.redirect(`/teacher-sub/assign?absence_id=${absence_id}`);
    } catch (err) {
      await migrateQuery(pool, 'TeacherSubstitution', 'ROLLBACK');
      console.error('[TeacherSub] Manual assign error:', err);
      req.session.flash = { type: 'error', msg: 'Manual assignment failed.' };
      res.redirect('/teacher-sub/assign');
    }
  }));

  // ============================================================
  // CONFIRM / CANCEL / COMPLETE substitution actions
  // ============================================================

  app.get('/teacher-sub/:subId/confirm', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;
    await pool.query(
      `UPDATE teacher_substitutions SET status='confirmed', confirmed_at=NOW(), updated_at=NOW()
       WHERE id=$1 AND tenant_id=$2 AND status='pending'`,
      [req.params.subId, tid]
    );
    audit('sub_confirmed', `Substitution #${req.params.subId} confirmed`, user.id, tid);
    req.session.flash = { type: 'success', msg: 'Substitution confirmed.' };
    res.redirect('/teacher-sub/my');
  }));

  app.get('/teacher-sub/:subId/decline', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;
    await pool.query(
      `UPDATE teacher_substitutions SET status='declined', updated_at=NOW()
       WHERE id=$1 AND tenant_id=$2 AND status='pending'`,
      [req.params.subId, tid]
    );
    audit('sub_declined', `Substitution #${req.params.subId} declined`, user.id, tid);
    req.session.flash = { type: 'warning', msg: 'Substitution declined.' };
    res.redirect('/teacher-sub/my');
  }));

  app.get('/teacher-sub/:subId/complete', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;
    await pool.query(
      `UPDATE teacher_substitutions SET status='completed', completed_at=NOW(), updated_at=NOW()
       WHERE id=$1 AND tenant_id=$2 AND status IN ('pending','confirmed')`,
      [req.params.subId, tid]
    );
    audit('sub_completed', `Substitution #${req.params.subId} completed`, user.id, tid);
    req.session.flash = { type: 'success', msg: 'Substitution marked as completed.' };
    res.redirect('/teacher-sub/my');
  }));

  app.get('/teacher-sub/:subId/cancel', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;
    await pool.query(
      `UPDATE teacher_substitutions SET status='cancelled', updated_at=NOW()
       WHERE id=$1 AND tenant_id=$2 AND status IN ('pending','confirmed','auto_assigned')`,
      [req.params.subId, tid]
    );
    audit('sub_cancelled', `Substitution #${req.params.subId} cancelled`, user.id, tid);
    req.session.flash = { type: 'warning', msg: 'Substitution cancelled.' };
    res.redirect(req.get('Referer') || '/teacher-sub');
  }));

  // ============================================================
  // FEATURE 4: SUBSTITUTION CALENDAR
  // ============================================================

  app.get('/teacher-sub/calendar', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const month = parseInt(req.query.month) || (new Date().getMonth() + 1);

    const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const calMonthStart = `${year}-${String(month).padStart(2, '0')}-01`;
    const calMonthEnd = `${year}-${String(month).padStart(2, '0')}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`;

    // Get all substitutions for this month
    const subs = (await pool.query(
      `SELECT ts.*, ta.reason as absence_reason
       FROM teacher_substitutions ts
       JOIN teacher_absences ta ON ta.id = ts.absence_id
       WHERE ts.tenant_id = $1
         AND ts.substitution_date >= $2::date AND ts.substitution_date <= $3::date
       ORDER BY ts.substitution_date, ts.absent_teacher_name`,
      [tid, calMonthStart, calMonthEnd]
    )).rows;

    // Also get absences
    const absences = (await pool.query(
      `SELECT * FROM teacher_absences
       WHERE tenant_id = $1
         AND start_date <= $3::date AND end_date >= $2::date
       ORDER BY start_date`,
      [tid, calMonthStart, calMonthEnd]
    )).rows;

    // Group substitutions by date
    const subsByDate = {};
    for (const sub of subs) {
      const key = sub.substitution_date;
      if (!subsByDate[key]) subsByDate[key] = [];
      if (subsByDate[key].length < 4) subsByDate[key].push(sub);
    }

    // Build calendar HTML
    const firstDay = new Date(year, month - 1, 1).getDay();
    const daysInMonth = new Date(year, month, 0).getDate();
    const todayStr = today();

    let calHtml = '';
    const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    for (const dn of dayNames) {
      calHtml += `<div class="ts-cal-header">${dn}</div>`;
    }
    for (let i = 0; i < firstDay; i++) {
      calHtml += `<div class="ts-cal-day" style="background:#f9fafb;border-color:transparent"></div>`;
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const isToday = dateStr === todayStr;
      const dow = new Date(year, month - 1, d).getDay();
      const isWeekend = dow === 0 || dow === 6;
      const daySubs = subsByDate[dateStr] || [];

      calHtml += `<div class="ts-cal-day${isToday ? ' today' : ''}${isWeekend ? ' weekend' : ''}" title="${dateStr}">
        <div class="day-num">${d}${isToday ? ' <span style="color:#4f46e5;font-size:10px">today</span>' : ''}</div>`;
      for (const sub of daySubs) {
        const cls = sub.status === 'cancelled' ? 'ts-cal-cancelled' : sub.assignment_type === 'auto_assigned' ? 'ts-cal-auto' : 'ts-cal-manual';
        calHtml += `<span class="ts-cal-entry ${cls}" title="${esc(sub.absent_teacher_name)} \u2192 ${esc(sub.substitute_teacher_name)} (${sub.status})">${esc((sub.substitute_teacher_name || '').substring(0, 10))} \u2192 ${esc((sub.absent_teacher_name || '').substring(0, 8))}</span>`;
      }
      if (daySubs.length === 0 && !isWeekend) {
        // Check if it's a past date
        if (new Date(dateStr) < new Date(todayStr)) {
          // past weekday with no subs
        }
      }
      calHtml += `</div>`;
    }

    // Navigation
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;

    const totalSubs = subs.length;
    const autoCount = subs.filter((s) => s.assignment_type === 'auto_assigned').length;
    const manualCount = subs.filter((s) => s.assignment_type === 'manual').length;

    const html = TS_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('calendar')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div>
          <h2 style="font-size:22px;color:#1e293b;margin:0">\uD83D\uDCC5 Substitution Calendar</h2>
          <p style="font-size:13px;color:#94a3b8;margin-top:2px">View all substitutions by month</p>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <a href="/teacher-sub/calendar?year=${prevYear}&month=${prevMonth}" class="ts-btn ts-btn-ghost" aria-label="Previous month">\u2190 Prev</a>
          <span style="font-size:16px;font-weight:700;color:#4f46e5">${monthNames[month - 1]} ${year}</span>
          <a href="/teacher-sub/calendar?year=${nextYear}&month=${nextMonth}" class="ts-btn ts-btn-ghost" aria-label="Next month">Next \u2192</a>
          <a href="/teacher-sub/calendar?year=${new Date().getFullYear()}&month=${new Date().getMonth() + 1}" class="ts-btn ts-btn-secondary ts-btn-sm">Today</a>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:16px">
        <div class="ts-stat-card" style="text-align:center">
          <div class="ts-stat-num">${totalSubs}</div>
          <div class="ts-stat-label">Total Substitutions</div>
        </div>
        <div class="ts-stat-card" style="text-align:center">
          <div class="ts-stat-num" style="color:#7c3aed">${autoCount}</div>
          <div class="ts-stat-label">Auto-Assigned</div>
        </div>
        <div class="ts-stat-card" style="text-align:center">
          <div class="ts-stat-num" style="color:#1d4ed8">${manualCount}</div>
          <div class="ts-stat-label">Manual</div>
        </div>
        <div class="ts-stat-card" style="text-align:center">
          <div class="ts-stat-num" style="color:#dc2626">${absences.length}</div>
          <div class="ts-stat-label">Absences</div>
        </div>
      </div>

      <div class="ts-legend" style="margin-bottom:12px">
        <span><i style="background:#ede9fe"></i> Auto-assigned</span>
        <span><i style="background:#dbeafe"></i> Manual</span>
        <span><i style="background:#f1f5f9"></i> Cancelled</span>
        <span><i style="background:#fefce8"></i> Weekend</span>
      </div>

      <div class="ts-card" style="padding:12px;overflow-x:auto">
        <div class="ts-cal-grid">${calHtml}</div>
      </div>
    </div>`;
    res.send(renderPage('Substitution Calendar', html, user, req));
  }));

  // ============================================================
  // FEATURE 5: TEACHER DASHBOARD
  // ============================================================

  app.get('/teacher-sub/my', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;

    // Substitutions where this teacher is the SUBSTITUTE
    const received = (await pool.query(
      `SELECT ts.*, ta.reason as absence_reason, ta.start_date as absence_start, ta.end_date as absence_end
       FROM teacher_substitutions ts
       JOIN teacher_absences ta ON ta.id = ts.absence_id
       WHERE ts.tenant_id = $1 AND ts.substitute_teacher_id = $2
       ORDER BY ts.substitution_date DESC LIMIT 50`,
      [tid, user.id]
    )).rows;

    // Substitutions where this teacher is ABSENT (someone covered for them)
    const given = (await pool.query(
      `SELECT ts.*, ta.reason as absence_reason
       FROM teacher_substitutions ts
       JOIN teacher_absences ta ON ta.id = ts.absence_id
       WHERE ts.tenant_id = $1 AND ts.absent_teacher_id = $2
       ORDER BY ts.substitution_date DESC LIMIT 50`,
      [tid, user.id]
    )).rows;

    // Stats
    const totalReceived = received.length;
    const pendingReceived = received.filter((s) => s.status === 'pending').length;
    const completedReceived = received.filter((s) => s.status === 'completed').length;
    const totalGiven = given.length;

    // Monthly count
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const thisMonth = received.filter((s) => new Date(s.substitution_date) >= monthStart).length;

    // My absences count
    const myAbsences = (await pool.query(
      `SELECT COUNT(*)::int as cnt FROM teacher_absences
       WHERE tenant_id = $1 AND teacher_id = $2 AND status = 'confirmed'`,
      [tid, user.id]
    )).rows[0].cnt;

    // Received table
    const receivedHtml = received.length > 0
      ? received.map((s) => `<tr>
        <td>${fmtDate(s.substitution_date)}</td>
        <td><strong>${esc(s.absent_teacher_name)}</strong></td>
        <td>${esc(s.subject || 'N/A')}</td>
        <td>${statusBadge(s.status)}</td>
        <td>${s.assignment_type === 'auto_assigned' ? '<span style="color:#7c3aed;font-weight:600">Auto</span>' : '<span style="color:#1d4ed8;font-weight:600">Manual</span>'}</td>
        <td>
          ${s.status === 'pending' ? `
            <a href="/teacher-sub/${s.id}/confirm" class="ts-btn ts-btn-success ts-btn-sm" aria-label="Confirm substitution">Confirm</a>
            <a href="/teacher-sub/${s.id}/decline" class="ts-btn ts-btn-danger ts-btn-sm" aria-label="Decline substitution" style="margin-left:4px">Decline</a>
          ` : s.status === 'confirmed' ? `
            <a href="/teacher-sub/${s.id}/complete" class="ts-btn ts-btn-primary ts-btn-sm" aria-label="Mark completed">Complete</a>
          ` : '<span style="color:#94a3b8;font-size:12px">\u2014</span>'}
        </td>
      </tr>`).join('')
      : '<tr><td colspan="6" class="ts-empty">No substitutions assigned to you</td></tr>';

    const givenHtml = given.length > 0
      ? given.map((s) => `<tr>
        <td>${fmtDate(s.substitution_date)}</td>
        <td><strong>${esc(s.substitute_teacher_name)}</strong></td>
        <td>${reasonBadge(s.absence_reason)}</td>
        <td>${esc(s.subject || 'N/A')}</td>
        <td>${statusBadge(s.status)}</td>
      </tr>`).join('')
      : '<tr><td colspan="5" class="ts-empty">No one has substituted for you yet</td></tr>';

    const html = TS_CSS + `<div style="max-width:1100px;margin:0 auto">
      ${nav('my')}
      ${flashMsg(req)}
      <h2 style="font-size:22px;color:#1e293b;margin-bottom:4px">\uD83D\uDC64 My Substitutions</h2>
      <p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Track substitutions assigned to you and coverage for your absences</p>

      <div class="ts-grid-stats" style="margin-bottom:20px">
        <div class="ts-stat-card">
          <div class="ts-stat-num" style="color:#4f46e5">${totalReceived}</div>
          <div class="ts-stat-label">Total Received</div>
        </div>
        <div class="ts-stat-card">
          <div class="ts-stat-num" style="color:#b45309">${pendingReceived}</div>
          <div class="ts-stat-label">Pending Action</div>
        </div>
        <div class="ts-stat-card">
          <div class="ts-stat-num" style="color:#059669">${completedReceived}</div>
          <div class="ts-stat-label">Completed</div>
        </div>
        <div class="ts-stat-card">
          <div class="ts-stat-num" style="color:#7c3aed">${thisMonth}</div>
          <div class="ts-stat-label">This Month</div>
        </div>
        <div class="ts-stat-card">
          <div class="ts-stat-num" style="color:#dc2626">${myAbsences}</div>
          <div class="ts-stat-label">My Absences</div>
        </div>
        <div class="ts-stat-card">
          <div class="ts-stat-num" style="color:#1d4ed8">${totalGiven}</div>
          <div class="ts-stat-label">Covered For Me</div>
        </div>
      </div>

      <div class="ts-card">
        <h3 style="font-size:16px;color:#1e293b;margin:0 0 14px">\uD83D\uDD04 Substitutions Assigned to Me</h3>
        <div style="overflow-x:auto"><table class="ts-table" aria-label="Substitutions assigned to you">
          <thead><tr><th>Date</th><th>Absent Teacher</th><th>Subject</th><th>Status</th><th>Type</th><th>Action</th></tr></thead>
          <tbody>${receivedHtml}</tbody>
        </table></div>
      </div>

      <div class="ts-card" style="margin-top:16px">
        <h3 style="font-size:16px;color:#1e293b;margin:0 0 14px">\uD83D\uDC64 Coverage for My Absences</h3>
        <div style="overflow-x:auto"><table class="ts-table" aria-label="Substitutions covering your absences">
          <thead><tr><th>Date</th><th>Substitute</th><th>Reason</th><th>Subject</th><th>Status</th></tr></thead>
          <tbody>${givenHtml}</tbody>
        </table></div>
      </div>
    </div>`;
    res.send(renderPage('My Substitutions', html, user, req));
  }));

  // ============================================================
  // FEATURE 8: SUBSTITUTION HISTORY
  // ============================================================

  app.get('/teacher-sub/history', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 25;
    const offset = (page - 1) * limit;

    // Filters
    const filterTeacher = req.query.teacher || '';
    const filterSubject = req.query.subject || '';
    const filterStatus = req.query.status || '';
    const filterFrom = req.query.from || '';
    const filterTo = req.query.to || '';

    // Build WHERE clauses with parameterized queries
    const params = [tid];
    let paramIdx = 2;
    let where = 'WHERE ts.tenant_id = $1';

    if (filterTeacher) {
      where += ` AND (ts.absent_teacher_name ILIKE $${paramIdx} OR ts.substitute_teacher_name ILIKE $${paramIdx})`;
      params.push(`%${filterTeacher}%`);
      paramIdx++;
    }
    if (filterSubject) {
      where += ` AND ts.subject ILIKE $${paramIdx}`;
      params.push(`%${filterSubject}%`);
      paramIdx++;
    }
    if (filterStatus) {
      where += ` AND ts.status = $${paramIdx}`;
      params.push(filterStatus);
      paramIdx++;
    }
    if (filterFrom) {
      where += ` AND ts.substitution_date >= $${paramIdx}::date`;
      params.push(filterFrom);
      paramIdx++;
    }
    if (filterTo) {
      where += ` AND ts.substitution_date <= $${paramIdx}::date`;
      params.push(filterTo);
      paramIdx++;
    }

    // Count total
    const countResult = await pool.query(
      `SELECT COUNT(*)::int as cnt FROM teacher_substitutions ts ${where}`,
      params
    );
    const totalRecords = countResult.rows[0].cnt;
    const totalPages = Math.ceil(totalRecords / limit);

    // Fetch records
    params.push(limit, offset);
    const records = (await pool.query(
      `SELECT ts.*, ta.reason as absence_reason
       FROM teacher_substitutions ts
       LEFT JOIN teacher_absences ta ON ta.id = ts.absence_id
       ${where}
       ORDER BY ts.substitution_date DESC, ts.created_at DESC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      params
    )).rows;

    // Unique subjects for filter
    const subjects = (await pool.query(
      `SELECT DISTINCT subject FROM teacher_substitutions
       WHERE tenant_id = $1 AND subject IS NOT NULL ORDER BY subject`,
      [tid]
    )).rows;

    // Build filter form base URL
    const baseUrl = `/teacher-sub/history?teacher=${encodeURIComponent(filterTeacher)}&subject=${encodeURIComponent(filterSubject)}&status=${encodeURIComponent(filterStatus)}&from=${encodeURIComponent(filterFrom)}&to=${encodeURIComponent(filterTo)}`;

    const recordsHtml = records.length > 0
      ? records.map((r) => `<tr>
        <td style="font-weight:600">${fmtDate(r.substitution_date)}</td>
        <td><strong>${esc(r.absent_teacher_name)}</strong></td>
        <td><strong>${esc(r.substitute_teacher_name)}</strong></td>
        <td>${esc(r.subject || 'N/A')}</td>
        <td>${esc(r.class_or_period || '\u2014')}</td>
        <td>${reasonBadge(r.absence_reason)}</td>
        <td>${statusBadge(r.status)}</td>
        <td>${r.assignment_type === 'auto_assigned'
          ? '<span style="color:#7c3aed;font-weight:600;font-size:12px">Auto</span>'
          : '<span style="color:#1d4ed8;font-weight:600;font-size:12px">Manual</span>'}</td>
        <td>${r.notification_sent ? '<span style="color:#059669" title="Email sent">\u2709\uFE0F</span>' : '<span style="color:#94a3b8">\u2014</span>'}</td>
        <td><a href="/teacher-sub/${r.id}/cancel" class="ts-btn ts-btn-danger ts-btn-sm" title="Cancel">Cancel</a></td>
      </tr>`).join('')
      : '<tr><td colspan="10" class="ts-empty">No substitution records found matching your filters</td></tr>';

    const subjectOpts = subjects.map((s) =>
      `<option value="${esc(s.subject)}" ${filterSubject === s.subject ? 'selected' : ''}>${esc(s.subject)}</option>`
    ).join('');

    const html = TS_CSS + `<div style="max-width:1300px;margin:0 auto">
      ${nav('history')}
      ${flashMsg(req)}
      <h2 style="font-size:22px;color:#1e293b;margin-bottom:4px">\uD83D\uDCDC Substitution History</h2>
      <p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Full history of all substitution records with filters</p>

      <div class="ts-card">
        <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">\uD83D\uDD0D Filters</h3>
        <form method="GET" action="/teacher-sub/history" class="ts-filter">
          <div>
            <label for="f_teacher">Teacher Name</label>
            <input type="text" name="teacher" id="f_teacher" value="${esc(filterTeacher)}" placeholder="Search...">
          </div>
          <div>
            <label for="f_subject">Subject</label>
            <select name="subject" id="f_subject">
              <option value="">All Subjects</option>
              ${subjectOpts}
            </select>
          </div>
          <div>
            <label for="f_status">Status</label>
            <select name="status" id="f_status">
              <option value="">All Statuses</option>
              <option value="pending" ${filterStatus === 'pending' ? 'selected' : ''}>Pending</option>
              <option value="confirmed" ${filterStatus === 'confirmed' ? 'selected' : ''}>Confirmed</option>
              <option value="completed" ${filterStatus === 'completed' ? 'selected' : ''}>Completed</option>
              <option value="declined" ${filterStatus === 'declined' ? 'selected' : ''}>Declined</option>
              <option value="cancelled" ${filterStatus === 'cancelled' ? 'selected' : ''}>Cancelled</option>
            </select>
          </div>
          <div>
            <label for="f_from">From</label>
            <input type="date" name="from" id="f_from" value="${esc(filterFrom)}">
          </div>
          <div>
            <label for="f_to">To</label>
            <input type="date" name="to" id="f_to" value="${esc(filterTo)}">
          </div>
          <div>
            <label>&nbsp;</label>
            <button type="submit" class="ts-btn ts-btn-primary">\uD83D\uDD0D Search</button>
          </div>
          <div>
            <label>&nbsp;</label>
            <a href="/teacher-sub/history" class="ts-btn ts-btn-ghost">\u2715 Clear</a>
          </div>
        </form>
      </div>

      <div style="font-size:13px;color:#64748b;margin-bottom:12px">${totalRecords} record(s) found</div>

      <div class="ts-card" style="padding:0;overflow:hidden">
        <div style="overflow-x:auto"><table class="ts-table" aria-label="Substitution history">
          <thead><tr>
            <th>Date</th><th>Absent Teacher</th><th>Substitute</th><th>Subject</th>
            <th>Class/Period</th><th>Reason</th><th>Status</th><th>Type</th><th>Email</th><th></th>
          </tr></thead>
          <tbody>${recordsHtml}</tbody>
        </table></div>
      </div>

      ${paginate(page, totalPages, baseUrl)}
    </div>`;
    res.send(renderPage('Substitution History', html, user, req));
  }));

  // ============================================================
  // FEATURE 7: SVG REPORTS
  // ============================================================

  app.get('/teacher-sub/reports', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;

    // --- Data Queries ---

    // 1. Most absent teachers (top 10)
    const mostAbsent = (await pool.query(
      `SELECT teacher_name, subject, COUNT(*)::int as absence_count,
         SUM(EXTRACT(DAY FROM (end_date - start_date)) + 1)::int as total_days
       FROM teacher_absences
       WHERE tenant_id = $1 AND status = 'confirmed'
       GROUP BY teacher_name, subject
       ORDER BY absence_count DESC LIMIT 10`,
      [tid]
    )).rows;

    // 2. Most substituted teachers (most requested substitutes)
    const mostSubstituted = (await pool.query(
      `SELECT substitute_teacher_name, COUNT(*)::int as sub_count
       FROM teacher_substitutions
       WHERE tenant_id = $1 AND status IN ('pending','confirmed','completed')
       GROUP BY substitute_teacher_name
       ORDER BY sub_count DESC LIMIT 10`,
      [tid]
    )).rows;

    // 3. Absence reasons distribution
    const reasonDist = (await pool.query(
      `SELECT reason, COUNT(*)::int as cnt
       FROM teacher_absences
       WHERE tenant_id = $1 AND status = 'confirmed'
       GROUP BY reason ORDER BY cnt DESC`,
      [tid]
    )).rows;

    // 4. Monthly trend (last 12 months)
    const monthlyTrend = (await pool.query(
      `SELECT to_char(ta.created_at, 'Mon YYYY') as month_label,
         COUNT(DISTINCT ta.id)::int as absences,
         COUNT(DISTINCT ts.id)::int as substitutions
       FROM teacher_absences ta
       LEFT JOIN teacher_substitutions ts ON ts.absence_id = ta.id AND ts.status != 'cancelled'
       WHERE ta.tenant_id = $1
         AND ta.created_at >= date_trunc('month', CURRENT_DATE - interval '11 months')
       GROUP BY to_char(ta.created_at, 'Mon YYYY'), date_trunc('month', ta.created_at)
       ORDER BY date_trunc('month', ta.created_at)`,
      [tid]
    )).rows;

    // --- SVG CHARTS ---

    // Chart 1: Most Absent Teachers (Horizontal Bar)
    const maxAbsences = mostAbsent.length > 0 ? mostAbsent[0].absence_count : 1;
    const barChartH = Math.max(200, mostAbsent.length * 35 + 40);
    let barSvg = `<svg width="100%" height="${barChartH}" viewBox="0 0 500 ${barChartH}" role="img" aria-label="Most absent teachers bar chart">
      <text x="250" y="20" text-anchor="middle" font-size="13" font-weight="700" fill="#1e293b">Most Absent Teachers</text>`;
    mostAbsent.forEach((t, i) => {
      const y = 35 + i * 35;
      const w = Math.round((t.absence_count / maxAbsences) * 300);
      barSvg += `<text x="5" y="${y + 12}" font-size="11" fill="#475569" text-anchor="start">${esc((t.teacher_name || '').substring(0, 22))}</text>`;
      barSvg += `<rect x="180" y="${y}" width="${w}" height="20" rx="4" fill="#4f46e5" opacity="0.8">
        <title>${esc(t.teacher_name)}: ${t.absence_count} absence(s), ${t.total_days} day(s)</title></rect>`;
      barSvg += `<text x="${185 + w}" y="${y + 14}" font-size="11" font-weight="700" fill="#4f46e5">${t.absence_count}</text>`;
    });
    if (mostAbsent.length === 0) {
      barSvg += `<text x="250" y="${barChartH / 2}" text-anchor="middle" font-size="13" fill="#94a3b8">No absence data</text>`;
    }
    barSvg += `</svg>`;

    // Chart 2: Most Substituted Teachers (Horizontal Bar)
    const maxSubs = mostSubstituted.length > 0 ? mostSubstituted[0].sub_count : 1;
    const subChartH = Math.max(200, mostSubstituted.length * 35 + 40);
    let subSvg = `<svg width="100%" height="${subChartH}" viewBox="0 0 500 ${subChartH}" role="img" aria-label="Most substituted teachers bar chart">
      <text x="250" y="20" text-anchor="middle" font-size="13" font-weight="700" fill="#1e293b">Most Requested Substitutes</text>`;
    mostSubstituted.forEach((t, i) => {
      const y = 35 + i * 35;
      const w = Math.round((t.sub_count / maxSubs) * 300);
      subSvg += `<text x="5" y="${y + 12}" font-size="11" fill="#475569" text-anchor="start">${esc((t.substitute_teacher_name || '').substring(0, 22))}</text>`;
      subSvg += `<rect x="180" y="${y}" width="${w}" height="20" rx="4" fill="#7c3aed" opacity="0.8">
        <title>${esc(t.substitute_teacher_name)}: ${t.sub_count} substitution(s)</title></rect>`;
      subSvg += `<text x="${185 + w}" y="${y + 14}" font-size="11" font-weight="700" fill="#7c3aed">${t.sub_count}</text>`;
    });
    if (mostSubstituted.length === 0) {
      subSvg += `<text x="250" y="${subChartH / 2}" text-anchor="middle" font-size="13" fill="#94a3b8">No substitution data</text>`;
    }
    subSvg += `</svg>`;

    // Chart 3: Absence Reasons Pie Chart
    const totalReasons = reasonDist.reduce((s, r) => s + r.cnt, 0) || 1;
    const pieColors = { sick: '#ef4444', personal: '#f59e0b', training: '#3b82f6', conference: '#8b5cf6', other: '#94a3b8' };
    let cumAngle = 0;
    const cx = 150, cy = 130, r = 100;
    let pieSvg = `<svg width="300" height="280" viewBox="0 0 300 280" role="img" aria-label="Absence reasons pie chart">
      <text x="150" y="20" text-anchor="middle" font-size="13" font-weight="700" fill="#1e293b">Absence Reasons</text>`;
    reasonDist.forEach((reason) => {
      const pctVal = reason.cnt / totalReasons;
      const startAngle = cumAngle * 2 * Math.PI - Math.PI / 2;
      const endAngle = (cumAngle + pctVal) * 2 * Math.PI - Math.PI / 2;
      const x1 = cx + r * Math.cos(startAngle);
      const y1 = cy + r * Math.sin(startAngle);
      const x2 = cx + r * Math.cos(endAngle);
      const y2 = cy + r * Math.sin(endAngle);
      const largeArc = pctVal > 0.5 ? 1 : 0;
      const color = pieColors[reason.reason] || '#94a3b8';
      const labelAngle = (startAngle + endAngle) / 2;
      const lx = cx + (r * 0.65) * Math.cos(labelAngle);
      const ly = cy + (r * 0.65) * Math.sin(labelAngle);

      pieSvg += `<path d="M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${largeArc},1 ${x2},${y2} Z" fill="${color}" stroke="#fff" stroke-width="2">
        <title>${reason.reason}: ${reason.cnt} (${pct(pctVal * 100, 100)}%)</title></path>`;
      if (pctVal > 0.05) {
        pieSvg += `<text x="${lx}" y="${ly}" text-anchor="middle" font-size="10" font-weight="700" fill="#fff">${pct(pctVal * 100, 100)}%</text>`;
      }
      cumAngle += pctVal;
    });
    // Legend
    reasonDist.forEach((reason, i) => {
      const ly = 250 + i * 16;
      const color = pieColors[reason.reason] || '#94a3b8';
      pieSvg += `<rect x="20" y="${ly - 8}" width="12" height="12" rx="3" fill="${color}"/>`;
      pieSvg += `<text x="38" y="${ly + 2}" font-size="10" fill="#475569">${esc(reason.reason)} (${reason.cnt})</text>`;
    });
    pieSvg += `</svg>`;

    // Chart 4: Monthly Trend Line Chart
    const trendSvgH = 280;
    const trendPad = { top: 40, right: 20, bottom: 50, left: 45 };
    const trendW = 600;
    const plotW = trendW - trendPad.left - trendPad.right;
    const plotH = trendSvgH - trendPad.top - trendPad.bottom;
    const maxTrendVal = Math.max(...monthlyTrend.map((m) => Math.max(m.absences, m.substitutions)), 1);

    let trendSvg = `<svg width="100%" height="${trendSvgH}" viewBox="0 0 ${trendW} ${trendSvgH}" role="img" aria-label="Monthly trend line chart">
      <text x="${trendW / 2}" y="20" text-anchor="middle" font-size="13" font-weight="700" fill="#1e293b">Monthly Trend (Absences vs Substitutions)</text>`;

    // Grid lines
    for (let i = 0; i <= 4; i++) {
      const y = trendPad.top + (plotH / 4) * i;
      const val = Math.round(maxTrendVal * (1 - i / 4));
      trendSvg += `<line x1="${trendPad.left}" y1="${y}" x2="${trendW - trendPad.right}" y2="${y}" stroke="#e2e8f0" stroke-width="1"/>`;
      trendSvg += `<text x="${trendPad.left - 5}" y="${y + 4}" text-anchor="end" font-size="10" fill="#94a3b8">${val}</text>`;
    }

    if (monthlyTrend.length > 1) {
      const stepX = plotW / (monthlyTrend.length - 1);

      // Absences line
      let absPoints = monthlyTrend.map((m, i) => {
        const x = trendPad.left + i * stepX;
        const y = trendPad.top + plotH - (m.absences / maxTrendVal) * plotH;
        return `${x},${y}`;
      }).join(' ');
      trendSvg += `<polyline points="${absPoints}" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
      monthlyTrend.forEach((m, i) => {
        const x = trendPad.left + i * stepX;
        const y = trendPad.top + plotH - (m.absences / maxTrendVal) * plotH;
        trendSvg += `<circle cx="${x}" cy="${y}" r="4" fill="#ef4444" stroke="#fff" stroke-width="2">
          <title>Absences: ${m.absences}</title></circle>`;
      });

      // Substitutions line
      let subPoints = monthlyTrend.map((m, i) => {
        const x = trendPad.left + i * stepX;
        const y = trendPad.top + plotH - (m.substitutions / maxTrendVal) * plotH;
        return `${x},${y}`;
      }).join(' ');
      trendSvg += `<polyline points="${subPoints}" fill="none" stroke="#4f46e5" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
      monthlyTrend.forEach((m, i) => {
        const x = trendPad.left + i * stepX;
        const y = trendPad.top + plotH - (m.substitutions / maxTrendVal) * plotH;
        trendSvg += `<circle cx="${x}" cy="${y}" r="4" fill="#4f46e5" stroke="#fff" stroke-width="2">
          <title>Substitutions: ${m.substitutions}</title></circle>`;
      });

      // X-axis labels
      monthlyTrend.forEach((m, i) => {
        const x = trendPad.left + i * stepX;
        trendSvg += `<text x="${x}" y="${trendSvgH - 10}" text-anchor="middle" font-size="9" fill="#64748b" transform="rotate(-30,${x},${trendSvgH - 10})">${esc(m.month_label)}</text>`;
      });
    } else {
      trendSvg += `<text x="${trendW / 2}" y="${trendSvgH / 2}" text-anchor="middle" font-size="13" fill="#94a3b8">Insufficient data for trend chart</text>`;
    }

    // Legend for trend
    trendSvg += `<circle cx="${trendW - 150}" cy="30" r="5" fill="#ef4444"/>
      <text x="${trendW - 140}" y="34" font-size="11" fill="#475569">Absences</text>
      <circle cx="${trendW - 70}" cy="30" r="5" fill="#4f46e5"/>
      <text x="${trendW - 60}" y="34" font-size="11" fill="#475569">Substitutions</text>`;
    trendSvg += `</svg>`;

    // --- Summary stats ---
    const totalAbsencesAll = (await pool.query(
      `SELECT COUNT(*)::int as cnt FROM teacher_absences WHERE tenant_id=$1 AND status='confirmed'`, [tid]
    )).rows[0].cnt;
    const totalSubsAll = (await pool.query(
      `SELECT COUNT(*)::int as cnt FROM teacher_substitutions WHERE tenant_id=$1 AND status IN ('pending','confirmed','completed')`, [tid]
    )).rows[0].cnt;
    const autoRate = totalSubsAll > 0
      ? pct((await pool.query(
          `SELECT COUNT(*)::int as cnt FROM teacher_substitutions WHERE tenant_id=$1 AND assignment_type='auto_assigned' AND status IN ('pending','confirmed','completed')`, [tid]
        )).rows[0].cnt, totalSubsAll)
      : 0;

    const html = TS_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('reports')}
      <h2 style="font-size:22px;color:#1e293b;margin-bottom:4px">\uD83D\uDCCA Substitution Reports</h2>
      <p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Visual analytics on teacher absences and substitutions</p>

      <div class="ts-grid-stats" style="margin-bottom:20px">
        <div class="ts-stat-card">
          <div class="ts-stat-num">${totalAbsencesAll}</div>
          <div class="ts-stat-label">Total Absences</div>
        </div>
        <div class="ts-stat-card">
          <div class="ts-stat-num" style="color:#7c3aed">${totalSubsAll}</div>
          <div class="ts-stat-label">Total Substitutions</div>
        </div>
        <div class="ts-stat-card">
          <div class="ts-stat-num" style="color:#059669">${autoRate}%</div>
          <div class="ts-stat-label">Auto-Assign Rate</div>
        </div>
        <div class="ts-stat-card">
          <div class="ts-stat-num" style="color:#f59e0b">${monthlyTrend.length > 0 ? monthlyTrend[monthlyTrend.length - 1].absences : 0}</div>
          <div class="ts-stat-label">Absences This Month</div>
        </div>
      </div>

      <div class="ts-grid-2" style="margin-bottom:16px">
        <div class="ts-card">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">\uD83D\uDCC8 Most Absent Teachers</h3>
          ${barSvg}
        </div>
        <div class="ts-card">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">\uD83E\uDD16 Most Requested Substitutes</h3>
          ${subSvg}
        </div>
      </div>

      <div class="ts-grid-2" style="margin-bottom:16px">
        <div class="ts-card" style="display:flex;align-items:center;justify-content:center">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px;width:100%">\uD83D\uDCCA Absence Reasons Distribution</h3>
          ${pieSvg}
        </div>
        <div class="ts-card">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">\uD83D\uDCC8 Monthly Trend</h3>
          ${trendSvg}
        </div>
      </div>
    </div>`;
    res.send(renderPage('Substitution Reports', html, user, req));
  }));

  // ============================================================
  // DASHBOARD (Main route)
  // ============================================================

  app.get('/teacher-sub', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;

    // --- Stats ---
    const activeAbsences = (await pool.query(
      `SELECT COUNT(*)::int as cnt FROM teacher_absences
       WHERE tenant_id=$1 AND status='confirmed' AND end_date >= CURRENT_DATE`,
      [tid]
    )).rows[0].cnt;

    const todayAbsences = (await pool.query(
      `SELECT COUNT(*)::int as cnt FROM teacher_absences
       WHERE tenant_id=$1 AND status='confirmed'
         AND CURRENT_DATE BETWEEN start_date AND end_date`,
      [tid]
    )).rows[0].cnt;

    const todaySubs = (await pool.query(
      `SELECT COUNT(*)::int as cnt FROM teacher_substitutions
       WHERE tenant_id=$1 AND substitution_date = CURRENT_DATE
         AND status IN ('pending','confirmed')`,
      [tid]
    )).rows[0].cnt;

    const pendingConfirm = (await pool.query(
      `SELECT COUNT(*)::int as cnt FROM teacher_substitutions
       WHERE tenant_id=$1 AND substitute_teacher_id=$2 AND status='pending'`,
      [tid, user.id]
    )).rows[0].cnt;

    const monthTotal = (await pool.query(
      `SELECT COUNT(*)::int as cnt FROM teacher_substitutions
       WHERE tenant_id=$1
         AND substitution_date >= date_trunc('month', CURRENT_DATE)
         AND substitution_date <= date_trunc('month', CURRENT_DATE) + interval '1 month' - interval '1 day'
         AND status IN ('pending','confirmed','completed')`,
      [tid]
    )).rows[0].cnt;

    const autoThisMonth = (await pool.query(
      `SELECT COUNT(*)::int as cnt FROM teacher_substitutions
       WHERE tenant_id=$1
         AND substitution_date >= date_trunc('month', CURRENT_DATE)
         AND substitution_date <= date_trunc('month', CURRENT_DATE) + interval '1 month' - interval '1 day'
         AND assignment_type='auto_assigned' AND status IN ('pending','confirmed','completed')`,
      [tid]
    )).rows[0].cnt;

    // --- Today's Absences ---
    const todayAbs = (await pool.query(
      `SELECT ta.*, u.email as teacher_email
       FROM teacher_absences ta
       LEFT JOIN users u ON u.id = ta.teacher_id
       WHERE ta.tenant_id=$1 AND ta.status='confirmed'
         AND CURRENT_DATE BETWEEN ta.start_date AND ta.end_date
       ORDER BY ta.reason, ta.teacher_name`,
      [tid]
    )).rows;

    const todayAbsHtml = todayAbs.length > 0
      ? todayAbs.map((a) => `
        <div style="display:flex;align-items:center;gap:12px;padding:10px 14px;border-radius:10px;background:#eef2ff;margin-bottom:8px">
          <div style="width:40px;height:40px;border-radius:50%;background:#4f46e5;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:16px">${(a.teacher_name || '?')[0]}</div>
          <div style="flex:1">
            <div style="font-size:14px;font-weight:600;color:#1e293b">${esc(a.teacher_name)}</div>
            <div style="font-size:12px;color:#64748b">${esc(a.subject || 'N/A')} \u00B7 ${reasonBadge(a.reason)}</div>
          </div>
          <a href="/teacher-sub/assign?absence_id=${a.id}" class="ts-btn ts-btn-primary ts-btn-sm">Assign</a>
        </div>`).join('')
      : '<div class="ts-empty" style="padding:30px">\u2705 All teachers present today!</div>';

    // --- Today's Substitutions ---
    const todaySubsList = (await pool.query(
      `SELECT ts.*, ta.reason as absence_reason
       FROM teacher_substitutions ts
       JOIN teacher_absences ta ON ta.id = ts.absence_id
       WHERE ts.tenant_id=$1 AND ts.substitution_date = CURRENT_DATE
       ORDER BY ts.absent_teacher_name`,
      [tid]
    )).rows;

    const todaySubsHtml = todaySubsList.length > 0
      ? `<table class="ts-table"><thead><tr><th>Absent</th><th>Substitute</th><th>Subject</th><th>Status</th></tr></thead>
         <tbody>${todaySubsList.map((s) => `<tr>
           <td><strong>${esc(s.absent_teacher_name)}</strong></td>
           <td><strong>${esc(s.substitute_teacher_name)}</strong></td>
           <td>${esc(s.subject || 'N/A')}</td>
           <td>${statusBadge(s.status)}</td>
         </tr>`).join('')}</tbody></table>`
      : '<div class="ts-empty">No substitutions scheduled for today</div>';

    // --- Recent Activity ---
    const recentActivity = (await pool.query(
      `SELECT ts.*, ta.reason as absence_reason
       FROM teacher_substitutions ts
       LEFT JOIN teacher_absences ta ON ta.id = ts.absence_id
       WHERE ts.tenant_id=$1
       ORDER BY ts.created_at DESC LIMIT 8`,
      [tid]
    )).rows;

    const recentHtml = recentActivity.length > 0
      ? `<table class="ts-table"><thead><tr><th>Date</th><th>Absent</th><th>Substitute</th><th>Type</th><th>Status</th></tr></thead>
         <tbody>${recentActivity.map((r) => `<tr>
           <td>${fmtDate(r.substitution_date)}</td>
           <td><strong>${esc(r.absent_teacher_name)}</strong></td>
           <td>${esc(r.substitute_teacher_name)}</td>
           <td>${r.assignment_type === 'auto_assigned'
             ? '<span style="color:#7c3aed;font-weight:600">\uD83E\uDD16 Auto</span>'
             : '<span style="color:#1d4ed8;font-weight:600">\u2705 Manual</span>'}</td>
           <td>${statusBadge(r.status)}</td>
         </tr>`).join('')}</tbody></table>`
      : '<div class="ts-empty">No activity yet</div>';

    const html = TS_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('dash')}
      ${flashMsg(req)}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div>
          <h1 style="font-size:24px;color:#1e293b">\uD83D\uDCCA Teacher Substitution Dashboard</h1>
          <p style="font-size:13px;color:#94a3b8;margin-top:2px">Manage teacher absences and substitute assignments</p>
        </div>
        <div style="display:flex;gap:8px">
          <a href="/teacher-sub/report" class="ts-btn ts-btn-primary">\uD83D\uDCDD Report Absence</a>
          <a href="/teacher-sub/assign" class="ts-btn ts-btn-success">\uD83E\uDD16 Auto-Assign</a>
        </div>
      </div>

      <!-- Stats Cards -->
      <div class="ts-grid-stats" style="margin-bottom:20px">
        <div class="ts-stat-card" style="display:flex;align-items:center;gap:14px">
          <div class="ts-stat-icon" style="background:#fee2e2;color:#dc2626">\uD83D\uDD34</div>
          <div><div class="ts-stat-num">${todayAbsences}</div><div class="ts-stat-label">Absent Today</div></div>
        </div>
        <div class="ts-stat-card" style="display:flex;align-items:center;gap:14px">
          <div class="ts-stat-icon" style="background:#ede9fe;color:#7c3aed">\uD83E\uDD16</div>
          <div><div class="ts-stat-num">${todaySubs}</div><div class="ts-stat-label">Subs Today</div></div>
        </div>
        <div class="ts-stat-card" style="display:flex;align-items:center;gap:14px">
          <div class="ts-stat-icon" style="background:#fef3c7;color:#b45309">\uD83D\uDCC5</div>
          <div><div class="ts-stat-num">${activeAbsences}</div><div class="ts-stat-label">Active Absences</div></div>
        </div>
        <div class="ts-stat-card" style="display:flex;align-items:center;gap:14px">
          <div class="ts-stat-icon" style="background:#d1fae5;color:#059669">\u2705</div>
          <div><div class="ts-stat-num">${monthTotal}</div><div class="ts-stat-label">Subs This Month</div></div>
        </div>
        <div class="ts-stat-card" style="display:flex;align-items:center;gap:14px">
          <div class="ts-stat-icon" style="background:#dbeafe;color:#1d4ed8">\uD83E\uDD16</div>
          <div><div class="ts-stat-num" style="color:#7c3aed">${pct(autoThisMonth, monthTotal)}%</div><div class="ts-stat-label">Auto Rate</div></div>
        </div>
        <div class="ts-stat-card" style="display:flex;align-items:center;gap:14px">
          <div class="ts-stat-icon" style="background:#fef3c7;color:#b45309">\u23F3</div>
          <div><div class="ts-stat-num" style="color:#b45309">${pendingConfirm}</div><div class="ts-stat-label">Pending For Me</div></div>
        </div>
      </div>

      <div class="ts-grid-2" style="margin-bottom:16px">
        <!-- Today's Absences -->
        <div class="ts-card">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
            <h3 style="font-size:15px;color:#1e293b;margin:0">\uD83D\uDD34 Absent Today (${todayAbs.length})</h3>
            <a href="/teacher-sub/report" style="font-size:12px;color:#4f46e5;text-decoration:none;font-weight:600">Report New \u2192</a>
          </div>
          <div style="max-height:400px;overflow-y:auto">${todayAbsHtml}</div>
        </div>

        <!-- Today's Substitutions -->
        <div class="ts-card">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
            <h3 style="font-size:15px;color:#1e293b;margin:0">\uD83D\uDD04 Today's Substitutions</h3>
            <a href="/teacher-sub/calendar" style="font-size:12px;color:#4f46e5;text-decoration:none;font-weight:600">Calendar \u2192</a>
          </div>
          ${todaySubsHtml}
        </div>
      </div>

      <!-- Recent Activity -->
      <div class="ts-card">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
          <h3 style="font-size:15px;color:#1e293b;margin:0">\uD83D\uDD0D Recent Activity</h3>
          <a href="/teacher-sub/history" style="font-size:12px;color:#4f46e5;text-decoration:none;font-weight:600">View All \u2192</a>
        </div>
        <div style="overflow-x:auto">${recentHtml}</div>
      </div>
    </div>`;
    res.send(renderPage('Teacher Substitution Dashboard', html, user, req));
  }));

}; // end module.exports
