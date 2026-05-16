// ============================================================
// LEAVE MANAGER MODULE
// Multi-Tenant SaaS Platform — Staff & Student leave requests,
// approval workflows, balance tracking, and calendar views.
// ============================================================
// Usage in server.js:
//   const leaveManager = require('./leave-manager');
//   leaveManager(app, db, pool, renderPage, esc);
// ============================================================

'use strict';
module.exports = function leaveManager(app, db, pool, renderPage, esc) {

  // -- inline helpers ---------------------------------------------------
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

  // -- business days calculator ------------------------------------------
  function businessDaysBetween(start, end) {
    const s = new Date(start);
    const e = new Date(end);
    let count = 0;
    const current = new Date(s);
    while (current <= e) {
      const day = current.getDay();
      if (day !== 0 && day !== 6) count++;
      current.setDate(current.getDate() + 1);
    }
    return count;
  }

  // -- status badge helper ----------------------------------------------
  function statusBadge(status) {
    const m = {
      pending:   { bg: '#fef3c7', c: '#b45309', l: '\u23f3 Pending' },
      approved:  { bg: '#d1fae5', c: '#059669', l: '\u2705 Approved' },
      rejected:  { bg: '#fee2e2', c: '#dc2626', l: '\u274c Rejected' },
      cancelled: { bg: '#f1f5f9', c: '#64748b', l: '\u274c Cancelled' },
    };
    const v = m[status] || { bg: '#f1f5f9', c: '#64748b', l: status };
    return `<span class="lv-badge" style="background:${v.bg};color:${v.c};padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;display:inline-block">${v.l}</span>`;
  }

  // -- user type badge --------------------------------------------------
  function userTypeBadge(ut) {
    if (ut === 'staff') return `<span style="background:#d1fae5;color:#059669;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:700">\uD83D\uDC68\u200D\uD83D\uDCBB Staff</span>`;
    return `<span style="background:#dbeafe;color:#2563eb;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:700">\uD83D\uDC39 Student</span>`;
  }

  // -- balance bar helper -----------------------------------------------
  function balanceBar(used, total, color) {
    const remaining = Math.max(0, total - used);
    const usedPct = total > 0 ? Math.round((used / total) * 100) : 0;
    const barColor = color || '#059669';
    return `<div style="display:flex;align-items:center;gap:10px">
      <div style="flex:1;background:#e5e7eb;border-radius:6px;height:14px;overflow:hidden;min-width:100px">
        <div style="height:100%;width:${usedPct}%;background:${barColor};border-radius:6px;transition:width .3s"></div>
      </div>
      <span style="font-size:12px;color:#374151;font-weight:600;min-width:60px">${used}/${total} days</span>
      <span style="font-size:11px;color:#6b7280">${remaining} left</span>
    </div>`;
  }

  // -- shared CSS --------------------------------------------------------
  const LV_CSS = `<style>
    .lv-nav{display:flex;gap:6px;margin-bottom:20px;flex-wrap:wrap}
    .lv-nav a{padding:8px 16px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#475569;background:#f1f5f9;transition:.15s}
    .lv-nav a:hover{background:#e2e8f0}.lv-nav a.active{background:#059669;color:#fff}
    .lv-btn{display:inline-flex;align-items:center;gap:6px;padding:9px 18px;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:.15s}
    .lv-btn:hover{opacity:.9;transform:translateY(-1px)}
    .lv-btn-primary{background:#059669;color:#fff}
    .lv-btn-success{background:#10b981;color:#fff}
    .lv-btn-danger{background:#fee2e2;color:#dc2626}
    .lv-btn-warning{background:#fef3c7;color:#b45309}
    .lv-btn-secondary{background:#f1f5f9;color:#475569}
    .lv-btn-sm{padding:6px 12px;font-size:12px;border-radius:8px}
    .lv-table{width:100%;border-collapse:collapse;font-size:13px}
    .lv-table th{padding:11px 14px;text-align:left;border-bottom:2px solid #d1d5db;color:#6b7280;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#f9fafb}
    .lv-table td{padding:10px 14px;border-bottom:1px solid #e5e7eb;color:#1f2937}
    .lv-table tr:hover{background:#f9fafb}
    .lv-card{background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,0.05)}
    .lv-stat-card{background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:20px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,0.05)}
    .lv-stat-num{font-size:32px;font-weight:800;line-height:1.1;margin-bottom:4px}
    .lv-stat-label{font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#6b7280;font-weight:600}
    .lv-filter{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:end}
    .lv-filter label{display:block;font-size:12px;font-weight:600;color:#6b7280;margin-bottom:4px}
    .lv-filter input,.lv-filter select{padding:8px 14px;border:2px solid #e5e7eb;border-radius:10px;font-size:13px;background:#fff}
    .lv-filter input:focus,.lv-filter select:focus{outline:none;border-color:#059669;box-shadow:0 0 0 3px rgba(5,150,105,0.1)}
    .lv-form label{display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:4px}
    .lv-form input,.lv-form select,.lv-form textarea{width:100%;padding:10px 14px;border:2px solid #e5e7eb;border-radius:10px;font-size:14px;box-sizing:border-box;transition:.15s}
    .lv-form input:focus,.lv-form select:focus,.lv-form textarea:focus{outline:none;border-color:#059669;box-shadow:0 0 0 3px rgba(5,150,105,0.1)}
    .lv-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
    .lv-grid-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px}
    .lv-grid-4{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
    .lv-alert{padding:12px 16px;border-radius:10px;font-size:13px;font-weight:600;margin-bottom:16px}
    .lv-alert-success{background:#d1fae5;color:#059669}
    .lv-alert-error{background:#fee2e2;color:#dc2626}
    .lv-alert-warning{background:#fef3c7;color:#b45309}
    .lv-badge{padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;display:inline-block}
    .lv-calendar-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:4px}
    .lv-cal-header{text-align:center;font-size:11px;font-weight:700;color:#6b7280;padding:8px 4px;text-transform:uppercase}
    .lv-cal-day{min-height:80px;border:1px solid #e5e7eb;border-radius:8px;padding:6px;font-size:12px;position:relative;transition:.15s}
    .lv-cal-day:hover{background:#f0fdf4}
    .lv-cal-day.today{border-color:#059669;background:#ecfdf5}
    .lv-cal-day.empty{background:#f9fafb;border-color:transparent}
    .lv-cal-day .day-num{font-weight:700;color:#374151;margin-bottom:4px}
    .lv-cal-leave{font-size:10px;padding:2px 6px;border-radius:4px;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block}
    .lv-cal-staff{background:#d1fae5;color:#059669}
    .lv-cal-student{background:#dbeafe;color:#2563eb}
    .lv-section{margin-bottom:24px}
    .lv-section-title{font-size:16px;font-weight:700;color:#1f2937;margin-bottom:14px;display:flex;align-items:center;gap:8px}
    .lv-legend{display:flex;gap:14px;margin-bottom:14px;flex-wrap:wrap}
    .lv-legend span{display:flex;align-items:center;gap:5px;font-size:12px;color:#6b7280}
    .lv-legend i{width:14px;height:14px;border-radius:4px;display:inline-block}
    .lv-type-card{background:#fff;border:2px solid #e5e7eb;border-radius:12px;padding:16px;transition:.15s}
    .lv-type-card:hover{border-color:#059669;box-shadow:0 2px 8px rgba(5,150,105,0.1)}
    .lv-type-dot{width:12px;height:12px;border-radius:50%;display:inline-block}
    .lv-balance-row{display:flex;align-items:center;gap:14px;padding:12px 0;border-bottom:1px solid #f3f4f6}
    .lv-balance-row:last-child{border-bottom:none}
    .lv-avatar{width:36px;height:36px;border-radius:50%;background:#d1fae5;color:#059669;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px}
    .lv-empty{text-align:center;padding:40px 20px;color:#9ca3af;font-size:14px}
    .lv-empty svg{margin:0 auto 12px;opacity:.3}
    .lv-tab-bar{display:flex;gap:2px;background:#f3f4f6;border-radius:10px;padding:3px;margin-bottom:20px}
    .lv-tab{padding:8px 18px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;color:#6b7280;transition:.15s}
    .lv-tab.active{background:#fff;color:#059669;box-shadow:0 1px 3px rgba(0,0,0,0.08)}
    .lv-tab:hover{color:#1f2937}
    @media(max-width:768px){
      .lv-nav{gap:4px}.lv-nav a{padding:6px 10px;font-size:11px}
      .lv-grid,.lv-grid-3,.lv-grid-4{grid-template-columns:1fr}
      .lv-filter{flex-direction:column}.lv-filter input,.lv-filter select{width:100%}
      .lv-cal-day{min-height:50px;font-size:10px}
    }
  </style>`;

  // -- navigation helper --------------------------------------------------
  const nav = (active) => `<div class="lv-nav">
    <a href="/leave" class="${active === 'dash' ? 'active' : ''}">\uD83D\uDCCA Dashboard</a>
    <a href="/leave/request" class="${active === 'request' ? 'active' : ''}">\uD83D\uDCDD Request Leave</a>
    <a href="/leave/my-requests" class="${active === 'myrequests' ? 'active' : ''}">\uD83D\uDCCB My Requests</a>
    <a href="/leave/approvals" class="${active === 'approvals' ? 'active' : ''}">\u2705 Approvals</a>
    <a href="/leave/calendar" class="${active === 'calendar' ? 'active' : ''}">\uD83D\uDCC5 Calendar</a>
    <a href="/leave/balances" class="${active === 'balances' ? 'active' : ''}">\uD83D\uDCC8 Balances</a>
    <a href="/leave/types" class="${active === 'types' ? 'active' : ''}">\u2699\uFE0F Leave Types</a>
  </div>`;

  // ============================================================
  // DATABASE MIGRATIONS (async IIFE)
  // ============================================================
  (async () => {
    const c = await pool.connect().catch(() => null);
    if (!c) { console.error('[LeaveManager] Cannot connect to DB for migrations'); return; }
    try {
      // ---- TABLE 1: leave_types ----
      await c.query(`CREATE TABLE IF NOT EXISTS leave_types (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL,
        category VARCHAR(20) DEFAULT 'staff',
        description TEXT,
        default_days INTEGER DEFAULT 0,
        paid BOOLEAN DEFAULT true,
        requires_document BOOLEAN DEFAULT false,
        color VARCHAR(20) DEFAULT '#059669',
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      const ltCols = [
        ['name', 'VARCHAR(100) NOT NULL'],
        ['category', "VARCHAR(20) DEFAULT 'staff'"],
        ['description', 'TEXT'],
        ['default_days', 'INTEGER DEFAULT 0'],
        ['paid', 'BOOLEAN DEFAULT true'],
        ['requires_document', 'BOOLEAN DEFAULT false'],
        ['color', "VARCHAR(20) DEFAULT '#059669'"],
        ['is_active', 'BOOLEAN DEFAULT true'],
        ['created_at', 'TIMESTAMPTZ DEFAULT NOW()'],
      ];
      for (const [col, def] of ltCols) {
        try { await c.query(`ALTER TABLE leave_types ADD COLUMN IF NOT EXISTS ${col} ${def}`); } catch (e) {}
      }

      // ---- TABLE 2: leave_balances ----
      await c.query(`CREATE TABLE IF NOT EXISTS leave_balances (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_type VARCHAR(20) NOT NULL,
        user_id INTEGER NOT NULL,
        leave_type_id INTEGER REFERENCES leave_types(id) ON DELETE SET NULL,
        academic_year VARCHAR(20),
        total_days INTEGER DEFAULT 0,
        used_days INTEGER DEFAULT 0,
        remaining_days INTEGER DEFAULT 0,
        carry_forward_days INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      const lbCols = [
        ['user_type', 'VARCHAR(20) NOT NULL'],
        ['user_id', 'INTEGER NOT NULL'],
        ['leave_type_id', 'INTEGER REFERENCES leave_types(id) ON DELETE SET NULL'],
        ['academic_year', 'VARCHAR(20)'],
        ['total_days', 'INTEGER DEFAULT 0'],
        ['used_days', 'INTEGER DEFAULT 0'],
        ['remaining_days', 'INTEGER DEFAULT 0'],
        ['carry_forward_days', 'INTEGER DEFAULT 0'],
        ['created_at', 'TIMESTAMPTZ DEFAULT NOW()'],
        ['updated_at', 'TIMESTAMPTZ DEFAULT NOW()'],
      ];
      for (const [col, def] of lbCols) {
        try { await c.query(`ALTER TABLE leave_balances ADD COLUMN IF NOT EXISTS ${col} ${def}`); } catch (e) {}
      }

      // ---- TABLE 3: leave_requests ----
      await c.query(`CREATE TABLE IF NOT EXISTS leave_requests (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_type VARCHAR(20) NOT NULL,
        user_id INTEGER NOT NULL,
        leave_type_id INTEGER REFERENCES leave_types(id) ON DELETE SET NULL,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        total_days INTEGER NOT NULL,
        reason TEXT,
        contact_during_leave VARCHAR(200),
        document_path VARCHAR(500),
        status VARCHAR(20) DEFAULT 'pending',
        approved_by INTEGER,
        approved_at TIMESTAMPTZ,
        reject_reason TEXT,
        academic_year VARCHAR(20),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      const lrCols = [
        ['user_type', 'VARCHAR(20) NOT NULL'],
        ['user_id', 'INTEGER NOT NULL'],
        ['leave_type_id', 'INTEGER REFERENCES leave_types(id) ON DELETE SET NULL'],
        ['start_date', 'DATE NOT NULL'],
        ['end_date', 'DATE NOT NULL'],
        ['total_days', 'INTEGER NOT NULL'],
        ['reason', 'TEXT'],
        ['contact_during_leave', 'VARCHAR(200)'],
        ['document_path', 'VARCHAR(500)'],
        ['status', "VARCHAR(20) DEFAULT 'pending'"],
        ['approved_by', 'INTEGER'],
        ['approved_at', 'TIMESTAMPTZ'],
        ['reject_reason', 'TEXT'],
        ['academic_year', 'VARCHAR(20)'],
        ['created_at', 'TIMESTAMPTZ DEFAULT NOW()'],
        ['updated_at', 'TIMESTAMPTZ DEFAULT NOW()'],
      ];
      for (const [col, def] of lrCols) {
        try { await c.query(`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS ${col} ${def}`); } catch (e) {}
      }

      // ---- INDEXES ----
      await c.query(`CREATE INDEX IF NOT EXISTS idx_lt_tenant ON leave_types(tenant_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_lt_category ON leave_types(tenant_id, category)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_lt_active ON leave_types(tenant_id, is_active)`);

      await c.query(`CREATE INDEX IF NOT EXISTS idx_lb_tenant ON leave_balances(tenant_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_lb_user ON leave_balances(tenant_id, user_type, user_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_lb_type ON leave_balances(tenant_id, leave_type_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_lb_year ON leave_balances(tenant_id, academic_year)`);

      await c.query(`CREATE INDEX IF NOT EXISTS idx_lr_tenant ON leave_requests(tenant_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_lr_user ON leave_requests(tenant_id, user_type, user_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_lr_status ON leave_requests(tenant_id, status)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_lr_dates ON leave_requests(tenant_id, start_date, end_date)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_lr_type ON leave_requests(tenant_id, leave_type_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_lr_approver ON leave_requests(tenant_id, approved_by)`);

      console.log('[LeaveManager] Migrations applied successfully');
    } catch (e) { console.error('[LeaveManager] Migration error:', e.message); }
    finally { c.release(); }
  })();

  // ============================================================
  // ROUTE 1: GET /leave — Dashboard
  // ============================================================
  app.get('/leave', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    // -- Stats --
    const pendingCount = (await pool.query(
      `SELECT COUNT(*)::int as cnt FROM leave_requests WHERE tenant_id=$1 AND status='pending'`, [tid]
    )).rows[0].cnt;

    const onLeaveToday = (await pool.query(
      `SELECT COUNT(*)::int as cnt FROM leave_requests
       WHERE tenant_id=$1 AND status='approved' AND start_date <= CURRENT_DATE AND end_date >= CURRENT_DATE`, [tid]
    )).rows[0].cnt;

    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0);
    const monthStartStr = monthStart.toISOString().split('T')[0];
    const totalThisMonth = (await pool.query(
      `SELECT COUNT(*)::int as cnt FROM leave_requests
       WHERE tenant_id=$1 AND created_at >= $2::date`, [tid, monthStartStr]
    )).rows[0].cnt;

    const approvedThisMonth = (await pool.query(
      `SELECT COUNT(*)::int as cnt FROM leave_requests
       WHERE tenant_id=$1 AND status='approved' AND created_at >= $2::date`, [tid, monthStartStr]
    )).rows[0].cnt;

    const rejectedThisMonth = (await pool.query(
      `SELECT COUNT(*)::int as cnt FROM leave_requests
       WHERE tenant_id=$1 AND status='rejected' AND created_at >= $2::date`, [tid, monthStartStr]
    )).rows[0].cnt;

    // -- By type breakdown --
    const byType = (await pool.query(
      `SELECT lt.name, lt.color, COUNT(lr.id)::int as cnt
       FROM leave_requests lr
       JOIN leave_types lt ON lt.id = lr.leave_type_id
       WHERE lr.tenant_id=$1 AND lr.status='approved' AND lr.created_at >= $2::date
       GROUP BY lt.name, lt.color ORDER BY cnt DESC LIMIT 6`, [tid, monthStartStr]
    )).rows;

    // -- Today's absentees --
    const absentees = (await pool.query(
      `SELECT lr.*, lt.name as type_name, lt.color, lt.category,
        COALESCE(u.name, s.name) as person_name
       FROM leave_requests lr
       JOIN leave_types lt ON lt.id = lr.leave_type_id
       LEFT JOIN users u ON u.id = lr.user_id AND lr.user_type='staff'
       LEFT JOIN students s ON s.id = lr.user_id AND lr.user_type='student'
       WHERE lr.tenant_id=$1 AND lr.status='approved'
       AND lr.start_date <= CURRENT_DATE AND lr.end_date >= CURRENT_DATE
       ORDER BY lt.category, person_name`, [tid]
    )).rows;

    // -- Recent requests --
    const recent = (await pool.query(
      `SELECT lr.*, lt.name as type_name, lt.color, lt.category,
        COALESCE(u.name, s.name) as person_name
       FROM leave_requests lr
       JOIN leave_types lt ON lt.id = lr.leave_type_id
       LEFT JOIN users u ON u.id = lr.user_id AND lr.user_type='staff'
       LEFT JOIN students s ON s.id = lr.user_id AND lr.user_type='student'
       WHERE lr.tenant_id=$1
       ORDER BY lr.created_at DESC LIMIT 10`, [tid]
    )).rows;

    // -- Calendar mini: this month approved leaves grouped by day --
    const now = new Date();
    const year = now.getFullYear(), month = now.getMonth();
    const calMonthStart = new Date(year, month, 1).toISOString().split('T')[0];
    const calMonthEnd = new Date(year, month + 1, 0).toISOString().split('T')[0];
    const calLeaves = (await pool.query(
      `SELECT lr.start_date, lr.end_date, lr.total_days, lt.category, lt.name as type_name, lt.color,
        COALESCE(u.name, s.name) as person_name
       FROM leave_requests lr
       JOIN leave_types lt ON lt.id = lr.leave_type_id
       LEFT JOIN users u ON u.id = lr.user_id AND lr.user_type='staff'
       LEFT JOIN students s ON s.id = lr.user_id AND lr.user_type='student'
       WHERE lr.tenant_id=$1 AND lr.status='approved'
       AND lr.start_date <= $3::date AND lr.end_date >= $2::date`, [tid, calMonthStart, calMonthEnd]
    )).rows;

    // Build calendar HTML
    const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const todayStr = today();

    // Group leaves by date
    const leavesByDate = {};
    for (const lv of calLeaves) {
      const s = new Date(lv.start_date);
      const e = new Date(lv.end_date);
      const cur = new Date(s);
      while (cur <= e) {
        const key = cur.toISOString().split('T')[0];
        if (!leavesByDate[key]) leavesByDate[key] = [];
        if (leavesByDate[key].length < 3) {
          leavesByDate[key].push(lv);
        }
        cur.setDate(cur.getDate() + 1);
      }
    }

    let calHtml = `<div class="lv-section"><div class="lv-section-title">\uD83D\uDCC5 ${monthNames[month]} ${year} — Approved Leaves</div>`;
    calHtml += `<div class="lv-legend">
      <span><i style="background:#d1fae5"></i> Staff on leave</span>
      <span><i style="background:#dbeafe"></i> Students on leave</span>
    </div>`;
    calHtml += `<div class="lv-calendar-grid">`;
    const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    for (const dn of dayNames) calHtml += `<div class="lv-cal-header">${dn}</div>`;
    for (let i = 0; i < firstDay; i++) calHtml += `<div class="lv-cal-day empty"></div>`;
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const isToday = dateStr === todayStr;
      const dayLeaves = leavesByDate[dateStr] || [];
      calHtml += `<div class="lv-cal-day${isToday ? ' today' : ''}">
        <div class="day-num">${d}${isToday ? ' <span style="color:#059669;font-size:10px">today</span>' : ''}</div>`;
      for (const lv of dayLeaves) {
        const cls = lv.category === 'staff' ? 'lv-cal-staff' : 'lv-cal-student';
        calHtml += `<span class="lv-cal-leave ${cls}" title="${esc(lv.person_name)}: ${esc(lv.type_name)}">${esc((lv.person_name||'').substring(0,8))}</span>`;
      }
      if (dayLeaves.length === 0) {
        // no leaves
      }
      calHtml += `</div>`;
    }
    calHtml += `</div></div>`;

    // -- Build type breakdown HTML --
    const typeBreakdownHtml = byType.map(t => {
      const maxCnt = byType.length > 0 ? byType[0].cnt : 1;
      const w = pct(t.cnt, maxCnt);
      return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <span style="width:14px;height:14px;border-radius:50%;background:${t.color};display:inline-block;flex-shrink:0"></span>
        <span style="font-size:13px;font-weight:500;color:#1f2937;min-width:100px">${esc(t.name)}</span>
        <div style="flex:1;background:#e5e7eb;border-radius:6px;height:18px;overflow:hidden">
          <div style="height:100%;width:${w}%;background:${t.color};border-radius:6px;transition:.3s;min-width:${t.cnt > 0 ? '8px' : '0'}"></div>
        </div>
        <span style="font-size:13px;font-weight:700;color:#374151;min-width:30px;text-align:right">${t.cnt}</span>
      </div>`;
    }).join('');

    // -- Absentees HTML --
    const absenteesHtml = absentees.length ? absentees.map(a => `
      <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:8px;background:#f9fafb;margin-bottom:6px">
        <div class="lv-avatar" style="background:${a.category==='staff'?'#d1fae5':'#dbeafe'};color:${a.category==='staff'?'#059669':'#2563eb'};width:32px;height:32px;font-size:12px">${(a.person_name||'?')[0]}</div>
        <div style="flex:1">
          <div style="font-size:13px;font-weight:600;color:#1f2937">${esc(a.person_name)}</div>
          <div style="font-size:11px;color:#6b7280">${esc(a.type_name)} · ${fmtDate(a.start_date)} - ${fmtDate(a.end_date)}</div>
        </div>
        ${userTypeBadge(a.category)}
      </div>`).join('') : '<div class="lv-empty">Everyone is present today!</div>';

    // -- Recent requests HTML --
    const recentHtml = recent.length ? `<table class="lv-table"><thead><tr>
      <th>Person</th><th>Type</th><th>Dates</th><th>Days</th><th>Status</th><th>Requested</th>
    </tr></thead><tbody>${recent.map(r => `<tr>
      <td><strong>${esc(r.person_name || 'Unknown')}</strong> ${userTypeBadge(r.category)}</td>
      <td><span style="color:${r.color};font-weight:600">${esc(r.type_name)}</span></td>
      <td style="font-size:12px">${fmtDate(r.start_date)} - ${fmtDate(r.end_date)}</td>
      <td style="font-weight:700">${r.total_days}</td>
      <td>${statusBadge(r.status)}</td>
      <td style="font-size:11px;color:#6b7280">${fmtDateTime(r.created_at)}</td>
    </tr>`).join('')}</tbody></table>` : '<div class="lv-empty">No leave requests yet</div>';

    const html = LV_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('dash')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div>
          <h1 style="font-size:24px;color:#1f2937;margin:0">\uD83D\uDCCA Leave Management</h1>
          <p style="font-size:13px;color:#9ca3af;margin-top:2px">Track staff and student leave requests, approvals, and balances</p>
        </div>
        <div style="display:flex;gap:8px">
          <a href="/leave/request" class="lv-btn lv-btn-primary">\uD83D\uDCDD Request Leave</a>
          <a href="/leave/approvals" class="lv-btn lv-btn-warning">\u2705 Approvals (${pendingCount})</a>
        </div>
      </div>

      <!-- Stat Cards -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;margin-bottom:24px">
        <div class="lv-stat-card">
          <div class="lv-stat-num" style="color:#b45309">${pendingCount}</div>
          <div class="lv-stat-label">Pending Approvals</div>
        </div>
        <div class="lv-stat-card">
          <div class="lv-stat-num" style="color:#059669">${onLeaveToday}</div>
          <div class="lv-stat-label">On Leave Today</div>
        </div>
        <div class="lv-stat-card">
          <div class="lv-stat-num" style="color:#2563eb">${totalThisMonth}</div>
          <div class="lv-stat-label">Requests This Month</div>
        </div>
        <div class="lv-stat-card">
          <div class="lv-stat-num" style="color:#059669">${approvedThisMonth}</div>
          <div class="lv-stat-label">Approved</div>
        </div>
        <div class="lv-stat-card">
          <div class="lv-stat-num" style="color:#dc2626">${rejectedThisMonth}</div>
          <div class="lv-stat-label">Rejected</div>
        </div>
      </div>

      <!-- Main Grid -->
      <div class="lv-grid">
        <!-- Today's Absentees -->
        <div class="lv-card">
          <div class="lv-section-title">\uD83D\uDC64 Today's Absentees (${absentees.length})</div>
          <div style="max-height:360px;overflow-y:auto">${absenteesHtml}</div>
        </div>

        <!-- By Type Breakdown -->
        <div class="lv-card">
          <div class="lv-section-title">\uD83D\uDCCA Approved by Type (This Month)</div>
          ${typeBreakdownHtml || '<div class="lv-empty">No approved leaves this month</div>'}
        </div>
      </div>

      <!-- Mini Calendar -->
      ${calHtml}

      <!-- Recent Requests -->
      <div class="lv-card" style="margin-top:20px">
        <div class="lv-section-title">\uD83D\uDD0D Recent Requests</div>
        <div style="overflow-x:auto">${recentHtml}</div>
      </div>
    </div>`;
    res.send(renderPage('Leave Dashboard', html, user, req));
  }));

  // ============================================================
  // ROUTE 2: GET /leave/request — Request leave form
  // ============================================================
  app.get('/leave/request', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    const successMsg = req.query.success ? `<div class="lv-alert lv-alert-success">\u2705 ${esc(req.query.success)}</div>` : '';
    const errorMsg = req.query.error ? `<div class="lv-alert lv-alert-error">\u274C ${esc(req.query.error)}</div>` : '';

    // Get active leave types (staff and student)
    const leaveTypes = (await pool.query(
      `SELECT * FROM leave_types WHERE tenant_id=$1 AND is_active=true ORDER BY category, name`, [tid]
    )).rows;

    const staffTypes = leaveTypes.filter(t => t.category === 'staff');
    const studentTypes = leaveTypes.filter(t => t.category === 'student');

    const staffTypeOpts = staffTypes.map(t => `<option value="${t.id}" data-days="${t.default_days}" data-doc="${t.requires_document}" data-color="${t.color}" data-paid="${t.paid}">${esc(t.name)} (${t.default_days} days${t.paid ? ', paid' : ', unpaid'}${t.requires_document ? ', doc required' : ''})</option>`).join('');
    const studentTypeOpts = studentTypes.map(t => `<option value="${t.id}" data-days="${t.default_days}" data-doc="${t.requires_document}" data-color="${t.color}" data-paid="${t.paid}">${esc(t.name)} (${t.default_days} days)</option>`).join('');

    // Get current user's balances
    const balances = (await pool.query(
      `SELECT lb.*, lt.name as type_name, lt.color
       FROM leave_balances lb
       JOIN leave_types lt ON lt.id = lb.leave_type_id
       WHERE lb.tenant_id=$1 AND lb.user_type='staff' AND lb.user_id=$2
       ORDER BY lt.name`, [tid, user.id]
    )).rows;

    const balanceCards = balances.map(b => `
      <div style="display:flex;align-items:center;gap:10px;padding:10px;border-radius:8px;background:#f9fafb;margin-bottom:6px">
        <span style="width:10px;height:10px;border-radius:50%;background:${b.color};flex-shrink:0"></span>
        <span style="font-size:13px;font-weight:600;color:#1f2937;min-width:100px">${esc(b.type_name)}</span>
        ${balanceBar(b.used_days, b.total_days, b.color)}
      </div>`).join('');

    const html = LV_CSS + `<div style="max-width:800px;margin:0 auto">
      ${nav('request')}
      <a href="/leave" style="color:#6b7280;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">\u2190 Back to Dashboard</a>
      ${successMsg}${errorMsg}
      <div class="lv-card" style="padding:28px">
        <h2 style="margin:0 0 4px;color:#1f2937">\uD83D\uDCDD Request Leave</h2>
        <p style="font-size:13px;color:#9ca3af;margin-bottom:24px">Submit a new leave request for approval</p>

        <!-- User Type Tabs -->
        <div class="lv-tab-bar">
          <a class="lv-tab active" id="tabStaff" onclick="switchUserType('staff')">\uD83D\uDC68\u200D\uD83D\uDCBB Staff Leave</a>
          <a class="lv-tab" id="tabStudent" onclick="switchUserType('student')">\uD83D\uDC39 Student Leave</a>
        </div>

        <form method="POST" action="/leave/request" class="lv-form" id="leaveForm">
          <input type="hidden" name="user_type" id="userTypeInput" value="staff">

          <!-- Staff Type Selection -->
          <div id="staffTypeGroup">
            <label>Leave Type *</label>
            <select name="leave_type_id" id="leaveTypeSelect" onchange="onTypeChange()" required>
              <option value="">-- Select Leave Type --</option>
              ${staffTypeOpts}
            </select>
          </div>

          <!-- Student Type Selection (hidden by default) -->
          <div id="studentTypeGroup" style="display:none">
            <label>Leave Type *</label>
            <select name="student_leave_type_id" id="studentTypeSelect" onchange="onStudentTypeChange()">
              <option value="">-- Select Leave Type --</option>
              ${studentTypeOpts}
            </select>
          </div>

          <!-- Student selector (hidden by default) -->
          <div id="studentSelectorGroup" style="display:none;margin-top:14px">
            <label>Student *</label>
            <select name="student_id" id="studentIdSelect" required>
              <option value="">-- Select Student --</option>
            </select>
          </div>

          <!-- Balance Display -->
          <div id="balanceDisplay" style="margin-top:14px;display:none">
            <label>Current Balance</label>
            <div id="balanceInfo" style="background:#ecfdf5;border:2px solid #d1fae5;border-radius:10px;padding:12px"></div>
          </div>

          <!-- Date Range -->
          <div class="lv-grid" style="margin-top:14px">
            <div>
              <label>Start Date *</label>
              <input type="date" name="start_date" id="startDate" onchange="calcDays()" required min="${today()}">
            </div>
            <div>
              <label>End Date *</label>
              <input type="date" name="end_date" id="endDate" onchange="calcDays()" required min="${today()}">
            </div>
          </div>

          <!-- Calculated Days -->
          <div id="daysCalc" style="margin-top:10px;display:none">
            <div style="background:#f0fdf4;border:2px solid #bbf7d0;border-radius:10px;padding:12px;text-align:center">
              <span style="font-size:13px;color:#374151">Business Days: </span>
              <strong id="calculatedDays" style="font-size:20px;color:#059669">0</strong>
              <span style="font-size:12px;color:#6b7280"> (excludes weekends)</span>
            </div>
          </div>

          <!-- Reason -->
          <div style="margin-top:14px">
            <label>Reason *</label>
            <textarea name="reason" rows="3" required placeholder="Please provide the reason for your leave request..."></textarea>
          </div>

          <!-- Contact During Leave -->
          <div style="margin-top:14px">
            <label>Contact During Leave</label>
            <input type="text" name="contact_during_leave" placeholder="Phone number or email while on leave">
          </div>

          <!-- Document Upload -->
          <div id="docUploadGroup" style="margin-top:14px;display:none">
            <label>Supporting Document ${'<span style="color:#dc2626;font-weight:700">(Required)</span>'}</label>
            <input type="file" name="document" accept=".pdf,.jpg,.jpeg,.png">
            <span style="font-size:11px;color:#6b7280;margin-top:4px;display:block">Accepted: PDF, JPG, PNG</span>
          </div>

          <div style="display:flex;gap:10px;margin-top:24px">
            <button type="submit" class="lv-btn lv-btn-primary" style="padding:14px 28px;font-size:15px;justify-content:center">\uD83D\uDCE7 Submit Request</button>
            <a href="/leave/my-requests" class="lv-btn lv-btn-secondary" style="padding:14px 28px;font-size:15px">View My Requests</a>
          </div>
        </form>
      </div>

      <!-- My Balance Summary -->
      ${balanceCards ? `<div class="lv-card" style="margin-top:20px">
        <div class="lv-section-title">\uD83D\uDCC8 My Leave Balances</div>
        ${balanceCards}
      </div>` : ''}
    </div>
    <script>
      let currentUserType = 'staff';
      function switchUserType(type) {
        currentUserType = type;
        document.getElementById('userTypeInput').value = type;
        document.getElementById('tabStaff').className = 'lv-tab' + (type==='staff' ? ' active' : '');
        document.getElementById('tabStudent').className = 'lv-tab' + (type==='student' ? ' active' : '');
        document.getElementById('staffTypeGroup').style.display = type==='staff' ? 'block' : 'none';
        document.getElementById('studentTypeGroup').style.display = type==='student' ? 'block' : 'none';
        document.getElementById('studentSelectorGroup').style.display = type==='student' ? 'block' : 'none';
        if (type==='student') loadStudents();
        onTypeChange();
      }
      async function loadStudents() {
        try {
          const resp = await fetch('/api/students?limit=500');
          const data = await resp.json();
          const sel = document.getElementById('studentIdSelect');
          sel.innerHTML = '<option value="">-- Select Student --</option>';
          (data.students || data || []).forEach(s => {
            sel.innerHTML += '<option value="'+s.id+'">'+(s.name||s.first_name+' '+(s.last_name||''))+'</option>';
          });
        } catch(e) { console.error(e); }
      }
      function onTypeChange() {
        const sel = document.getElementById('leaveTypeSelect');
        const opt = sel.options[sel.selectedIndex];
        if (!opt || !opt.value) { document.getElementById('balanceDisplay').style.display='none'; return; }
        const requiresDoc = opt.getAttribute('data-doc') === 'true';
        document.getElementById('docUploadGroup').style.display = requiresDoc ? 'block' : 'none';
        // show balance
        document.getElementById('balanceDisplay').style.display='block';
        const days = parseInt(opt.getAttribute('data-days'))||0;
        document.getElementById('balanceInfo').innerHTML = '<span style="font-size:14px;color:#059669;font-weight:600">Default entitlement: '+days+' days per year</span>';
        calcDays();
      }
      function onStudentTypeChange() {
        const sel = document.getElementById('studentTypeSelect');
        const opt = sel.options[sel.selectedIndex];
        if (!opt || !opt.value) { document.getElementById('balanceDisplay').style.display='none'; return; }
        const requiresDoc = opt.getAttribute('data-doc') === 'true';
        document.getElementById('docUploadGroup').style.display = requiresDoc ? 'block' : 'none';
        const days = parseInt(opt.getAttribute('data-days'))||0;
        document.getElementById('balanceDisplay').style.display='block';
        document.getElementById('balanceInfo').innerHTML = '<span style="font-size:14px;color:#059669;font-weight:600">Default entitlement: '+days+' days per year</span>';
        calcDays();
      }
      function calcDays() {
        const s = document.getElementById('startDate').value;
        const e = document.getElementById('endDate').value;
        if (!s || !e) { document.getElementById('daysCalc').style.display='none'; return; }
        const start = new Date(s), end = new Date(e);
        if (end < start) { document.getElementById('daysCalc').style.display='block'; document.getElementById('calculatedDays').textContent='0'; return; }
        let count = 0;
        const cur = new Date(start);
        while (cur <= end) { const d=cur.getDay(); if(d!==0&&d!==6) count++; cur.setDate(cur.getDate()+1); }
        document.getElementById('daysCalc').style.display='block';
        document.getElementById('calculatedDays').textContent=count;
      }
    </script>`;
    res.send(renderPage('Request Leave', html, user, req));
  }));

  // ============================================================
  // ROUTE 3: POST /leave/request — Submit leave request
  // ============================================================
  app.post('/leave/request', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    let { user_type, leave_type_id, student_leave_type_id, student_id, start_date, end_date, reason, contact_during_leave, academic_year } = req.body;

    // Determine user_type and ids
    if (user_type === 'student') {
      leave_type_id = student_leave_type_id;
      if (!student_id) return res.redirect('/leave/request?error=' + encodeURIComponent('Please select a student'));
      req.body.user_id = parseInt(student_id);
    } else {
      user_type = 'staff';
      req.body.user_id = user.id;
    }

    if (!leave_type_id) return res.redirect('/leave/request?error=' + encodeURIComponent('Please select a leave type'));
    if (!start_date || !end_date) return res.redirect('/leave/request?error=' + encodeURIComponent('Start and end dates are required'));
    if (!reason || !reason.trim()) return res.redirect('/leave/request?error=' + encodeURIComponent('Please provide a reason'));

    const startDate = new Date(start_date);
    const endDate = new Date(end_date);
    if (endDate < startDate) return res.redirect('/leave/request?error=' + encodeURIComponent('End date must be on or after start date'));

    const totalDays = businessDaysBetween(start_date, end_date);
    if (totalDays <= 0) return res.redirect('/leave/request?error=' + encodeURIComponent('Leave must include at least 1 business day'));

    const typeId = parseInt(leave_type_id);
    const userId = parseInt(req.body.user_id);

    // Check for overlapping approved leaves
    const overlap = (await pool.query(
      `SELECT id FROM leave_requests
       WHERE tenant_id=$1 AND user_type=$2 AND user_id=$3
       AND status IN ('pending','approved')
       AND start_date <= $6::date AND end_date >= $5::date`, [tid, user_type, userId, typeId, start_date, end_date]
    )).rows[0];
    if (overlap) return res.redirect('/leave/request?error=' + encodeURIComponent('You already have an overlapping leave request (pending or approved)'));

    // Insert leave request
    await pool.query(
      `INSERT INTO leave_requests (tenant_id, user_type, user_id, leave_type_id, start_date, end_date, total_days, reason, contact_during_leave, academic_year, status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5::date,$6::date,$7,$8,$9,$10,'pending',NOW(),NOW())`,
      [tid, user_type, userId, typeId, start_date, end_date, totalDays, reason.trim(), contact_during_leave || null, academic_year || null]
    );

    console.log(`[LeaveManager] Leave request created: user=${userId} type=${typeId} days=${totalDays}`);
    res.redirect('/leave/request?success=' + encodeURIComponent('Leave request submitted successfully! ' + totalDays + ' business day(s)'));
  }));

  // ============================================================
  // ROUTE 4: GET /leave/my-requests — User's own leave history
  // ============================================================
  app.get('/leave/my-requests', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { status, user_type: utFilter } = req.query;

    // Determine user_type filter
    const userTypes = utFilter ? [utFilter] : ['staff', 'student'];
    const statusFilter = status || '';

    let where = [`lr.tenant_id=$1`, `(lr.user_type='staff' AND lr.user_id=$2)`];
    const params = [tid, user.id];
    let pi = 3;
    if (statusFilter) { where.push(`lr.status=$${pi++}`); params.push(statusFilter); }

    const requests = (await pool.query(
      `SELECT lr.*, lt.name as type_name, lt.color, lt.category, lt.paid as is_paid,
        ap.name as approver_name
       FROM leave_requests lr
       JOIN leave_types lt ON lt.id = lr.leave_type_id
       LEFT JOIN users ap ON ap.id = lr.approved_by
       WHERE ${where.join(' AND ')}
       ORDER BY lr.created_at DESC LIMIT 100`, params
    )).rows;

    // Balance summary for staff
    const balances = (await pool.query(
      `SELECT lb.*, lt.name as type_name, lt.color, lt.category
       FROM leave_balances lb
       JOIN leave_types lt ON lt.id = lb.leave_type_id
       WHERE lb.tenant_id=$1 AND lb.user_type='staff' AND lb.user_id=$2
       ORDER BY lt.name`, [tid, user.id]
    )).rows;

    const balanceCards = balances.map(b => `
      <div class="lv-type-card">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <span style="width:10px;height:10px;border-radius:50%;background:${b.color}"></span>
          <span style="font-size:14px;font-weight:700;color:#1f2937">${esc(b.type_name)}</span>
          ${userTypeBadge(b.category)}
        </div>
        ${balanceBar(b.used_days, b.total_days, b.color)}
      </div>`).join('');

    // Tab bar for status filter
    const tabStatuses = [
      { key: '', label: 'All' },
      { key: 'pending', label: '\u23F3 Pending' },
      { key: 'approved', label: '\u2705 Approved' },
      { key: 'rejected', label: '\u274C Rejected' },
      { key: 'cancelled', label: '\u274C Cancelled' },
    ];

    const tabsHtml = `<div class="lv-tab-bar">${tabStatuses.map(t => `<a class="lv-tab${statusFilter === t.key ? ' active' : ''}" href="/leave/my-requests?status=${t.key}">${t.label}</a>`).join('')}</div>`;

    // Table rows
    const rowsHtml = requests.length ? requests.map(r => `<tr>
      <td><span style="color:${r.color};font-weight:700">${esc(r.type_name)}</span></td>
      <td>${fmtDate(r.start_date)}</td>
      <td>${fmtDate(r.end_date)}</td>
      <td style="font-weight:700;text-align:center">${r.total_days}</td>
      <td>${statusBadge(r.status)}</td>
      <td style="font-size:12px;color:#6b7280">${fmtDateTime(r.created_at)}</td>
      <td style="font-size:12px">${esc(r.approver_name || '\u2014')}</td>
      <td>
        ${r.status === 'pending' ? `<form method="POST" action="/leave/approvals/${r.id}/cancel" style="display:inline">
          <button class="lv-btn lv-btn-sm lv-btn-danger" type="submit" onclick="return confirm('Cancel this request?')">Cancel</button></form>` : ''}
        ${r.reject_reason ? `<span style="font-size:11px;color:#dc2626;display:block;margin-top:2px" title="${esc(r.reject_reason)}">${esc(r.reject_reason.substring(0,40))}${r.reject_reason.length>40?'...':''}</span>` : ''}
      </td>
    </tr>`).join('') : `<tr><td colspan="8" class="lv-empty">No leave requests found</td></tr>`;

    const html = LV_CSS + `<div style="max-width:1100px;margin:0 auto">
      ${nav('myrequests')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div>
          <h1 style="font-size:24px;color:#1f2937;margin:0">\uD83D\uDCCB My Leave Requests</h1>
          <p style="font-size:13px;color:#9ca3af;margin-top:2px">${requests.length} request(s) found</p>
        </div>
        <a href="/leave/request" class="lv-btn lv-btn-primary">+ New Request</a>
      </div>

      <!-- Balance Summary -->
      ${balanceCards ? `<div class="lv-section">
        <div class="lv-section-title">\uD83D\uDCC8 My Leave Balances</div>
        <div class="lv-grid-3">${balanceCards}</div>
      </div>` : ''}

      <!-- Status Tabs -->
      ${tabsHtml}

      <!-- Requests Table -->
      <div class="lv-card">
        <div style="overflow-x:auto">
          <table class="lv-table">
            <thead><tr><th>Type</th><th>Start</th><th>End</th><th>Days</th><th>Status</th><th>Requested</th><th>Approved By</th><th>Actions</th></tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
      </div>
    </div>`;
    res.send(renderPage('My Leave Requests', html, user, req));
  }));

  // POST /leave/approvals/:id/cancel — Cancel own request
  app.post('/leave/approvals/:id/cancel', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, reqId = req.params.id;
    const result = await pool.query(
      `UPDATE leave_requests SET status='cancelled', updated_at=NOW() WHERE id=$1 AND tenant_id=$2 AND user_id=$3 AND status='pending'`,
      [reqId, tid, user.id]
    );
    if (result.rowCount > 0) {
      console.log(`[LeaveManager] Request ${reqId} cancelled by user ${user.id}`);
    }
    res.redirect('/leave/my-requests');
  }));

  // ============================================================
  // ROUTE 5: GET /leave/approvals — Pending approval queue
  // ============================================================
  app.get('/leave/approvals', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { status: statusFilter, user_type: utFilter, leave_type_id: ltFilter } = req.query;

    let where = ['lr.tenant_id=$1'];
    const params = [tid];
    let pi = 2;
    if (statusFilter) { where.push(`lr.status=$${pi++}`); params.push(statusFilter); }
    else { where.push(`lr.status IN ('pending','approved','rejected')`); }
    if (utFilter) { where.push(`lr.user_type=$${pi++}`); params.push(utFilter); }
    if (ltFilter) { where.push(`lr.leave_type_id=$${pi++}`); params.push(parseInt(ltFilter)); }

    const requests = (await pool.query(
      `SELECT lr.*, lt.name as type_name, lt.color, lt.category, lt.paid as is_paid, lt.requires_document,
        COALESCE(u.name, s.name) as person_name,
        ap.name as approver_name
       FROM leave_requests lr
       JOIN leave_types lt ON lt.id = lr.leave_type_id
       LEFT JOIN users u ON u.id = lr.user_id AND lr.user_type='staff'
       LEFT JOIN students s ON s.id = lr.user_id AND lr.user_type='student'
       LEFT JOIN users ap ON ap.id = lr.approved_by
       WHERE ${where.join(' AND ')}
       ORDER BY lr.created_at DESC LIMIT 100`, params
    )).rows;

    // Get leave types for filter
    const leaveTypes = (await pool.query(
      `SELECT id, name, category FROM leave_types WHERE tenant_id=$1 AND is_active=true ORDER BY name`, [tid]
    )).rows;

    const typeOpts = leaveTypes.map(t => `<option value="${t.id}" ${ltFilter==String(t.id)?'selected':''}>${esc(t.name)} (${t.category})</option>`).join('');

    // Pending count
    const pendingCount = (await pool.query(
      `SELECT COUNT(*)::int as cnt FROM leave_requests WHERE tenant_id=$1 AND status='pending'`, [tid]
    )).rows[0].cnt;

    // Tab statuses
    const tabStatuses = [
      { key: '', label: `All (${requests.length})` },
      { key: 'pending', label: `\u23F3 Pending (${pendingCount})` },
      { key: 'approved', label: '\u2705 Approved' },
      { key: 'rejected', label: '\u274C Rejected' },
    ];
    const tabsHtml = `<div class="lv-tab-bar">${tabStatuses.map(t => `<a class="lv-tab${(!statusFilter && t.key === '') || statusFilter === t.key ? ' active' : ''}" href="/leave/approvals?status=${t.key}">${t.label}</a>`).join('')}</div>`;

    const rowsHtml = requests.length ? requests.map(r => `<tr>
      <td>
        <div style="display:flex;align-items:center;gap:8px">
          <div class="lv-avatar" style="background:${r.category==='staff'?'#d1fae5':'#dbeafe'};color:${r.category==='staff'?'#059669':'#2563eb'};width:32px;height:32px;font-size:12px">${(r.person_name||'?')[0]}</div>
          <div>
            <div style="font-weight:600;color:#1f2937">${esc(r.person_name || 'Unknown')}</div>
            <div style="font-size:11px;color:#6b7280">${userTypeBadge(r.category)}</div>
          </div>
        </div>
      </td>
      <td><span style="color:${r.color};font-weight:700">${esc(r.type_name)}</span></td>
      <td style="font-size:12px">${fmtDate(r.start_date)}</td>
      <td style="font-size:12px">${fmtDate(r.end_date)}</td>
      <td style="font-weight:700;text-align:center">${r.total_days}</td>
      <td style="font-size:12px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.reason||'')}">${esc(r.reason || '\u2014')}</td>
      <td>${statusBadge(r.status)}</td>
      <td style="font-size:12px;color:#6b7280">${fmtDateTime(r.created_at)}</td>
      <td style="font-size:12px">${esc(r.approver_name || '\u2014')}</td>
      <td>
        ${r.status === 'pending' ? `
          <div style="display:flex;gap:4px;flex-direction:column">
            <form method="POST" action="/leave/approvals/${r.id}?action=approve" style="display:inline">
              <button class="lv-btn lv-btn-sm lv-btn-success" type="submit" onclick="return confirm('Approve this leave request?')">\u2705 Approve</button></form>
            <form method="POST" action="/leave/approvals/${r.id}?action=reject" style="display:inline">
              <input type="text" name="reject_reason" placeholder="Reason (optional)" style="width:100%;padding:4px 8px;border:1px solid #e5e7eb;border-radius:6px;font-size:11px;margin-bottom:4px;box-sizing:border-box">
              <button class="lv-btn lv-btn-sm lv-btn-danger" type="submit" onclick="return confirm('Reject this leave request?')">\u274C Reject</button></form>
          </div>
        ` : '\u2014'}
      </td>
    </tr>`).join('') : `<tr><td colspan="10" class="lv-empty">No leave requests found</td></tr>`;

    const html = LV_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('approvals')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div>
          <h1 style="font-size:24px;color:#1f2937;margin:0">\u2705 Leave Approvals</h1>
          <p style="font-size:13px;color:#9ca3af;margin-top:2px">${pendingCount} pending approval(s)</p>
        </div>
      </div>

      ${tabsHtml}

      <!-- Filters -->
      <div class="lv-filter">
        <div>
          <label>User Type</label>
          <select onchange="location.href=updateUrl('user_type',this.value)">
            <option value="">All Types</option>
            <option value="staff" ${utFilter==='staff'?'selected':''}>Staff</option>
            <option value="student" ${utFilter==='student'?'selected':''}>Student</option>
          </select>
        </div>
        <div>
          <label>Leave Type</label>
          <select onchange="location.href=updateUrl('leave_type_id',this.value)">
            <option value="">All Categories</option>
            ${typeOpts}
          </select>
        </div>
      </div>

      <!-- Approvals Table -->
      <div class="lv-card">
        <div style="overflow-x:auto">
          <table class="lv-table">
            <thead><tr><th>Person</th><th>Type</th><th>Start</th><th>End</th><th>Days</th><th>Reason</th><th>Status</th><th>Requested</th><th>By</th><th>Actions</th></tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
      </div>
      <script>
        function updateUrl(key, val) {
          const u = new URL(location.href);
          if (val) u.searchParams.set(key, val); else u.searchParams.delete(key);
          return u.pathname + u.search;
        }
      </script>
    </div>`;
    res.send(renderPage('Leave Approvals', html, user, req));
  }));

  // ============================================================
  // ROUTE 6: POST /leave/approvals/:id — Approve or reject
  // ============================================================
  app.post('/leave/approvals/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const reqId = req.params.id;
    const { action, reject_reason } = req.query;

    if (action !== 'approve' && action !== 'reject') {
      return res.redirect('/leave/approvals?error=' + encodeURIComponent('Invalid action'));
    }

    const client = await pool.connect().catch(() => null);
    if (!client) return res.redirect('/leave/approvals?error=' + encodeURIComponent('Database error'));

    try {
      await client.query('BEGIN');

      // Fetch the leave request
      const lr = (await client.query(
        `SELECT * FROM leave_requests WHERE id=$1 AND tenant_id=$2 AND status='pending' FOR UPDATE`,
        [reqId, tid]
      )).rows[0];

      if (!lr) {
        await client.query('ROLLBACK');
        return res.redirect('/leave/approvals?error=' + encodeURIComponent('Request not found or already processed'));
      }

      if (action === 'approve') {
        // Update request status
        await client.query(
          `UPDATE leave_requests SET status='approved', approved_by=$3, approved_at=NOW(), updated_at=NOW()
           WHERE id=$1 AND tenant_id=$2`,
          [reqId, tid, user.id]
        );

        // Deduct from balance (or create balance if not exists)
        const existing = (await client.query(
          `SELECT * FROM leave_balances
           WHERE tenant_id=$1 AND user_type=$2 AND user_id=$3 AND leave_type_id=$4`,
          [tid, lr.user_type, lr.user_id, lr.leave_type_id]
        )).rows[0];

        if (existing) {
          const newUsed = existing.used_days + lr.total_days;
          const newRemaining = Math.max(0, existing.total_days + existing.carry_forward_days - newUsed);
          await client.query(
            `UPDATE leave_balances SET used_days=$3, remaining_days=$4, updated_at=NOW()
             WHERE id=$1 AND tenant_id=$2`,
            [existing.id, tid, newUsed, newRemaining]
          );
        } else {
          // Get default days from leave type
          const lt = (await client.query(
            `SELECT default_days FROM leave_types WHERE id=$1 AND tenant_id=$2`, [lr.leave_type_id, tid]
          )).rows[0];
          const totalDays = lt ? lt.default_days : 0;
          const remaining = Math.max(0, totalDays - lr.total_days);
          await client.query(
            `INSERT INTO leave_balances (tenant_id, user_type, user_id, leave_type_id, academic_year, total_days, used_days, remaining_days, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())`,
            [tid, lr.user_type, lr.user_id, lr.leave_type_id, lr.academic_year, totalDays, lr.total_days, remaining]
          );
        }

        console.log(`[LeaveManager] Request ${reqId} approved by ${user.id}, ${lr.total_days} days deducted`);
      } else {
        // Reject
        await client.query(
          `UPDATE leave_requests SET status='rejected', approved_by=$3, reject_reason=$4, updated_at=NOW()
           WHERE id=$1 AND tenant_id=$2`,
          [reqId, tid, user.id, reject_reason || null]
        );
        console.log(`[LeaveManager] Request ${reqId} rejected by ${user.id}`);
      }

      await client.query('COMMIT');
      res.redirect('/leave/approvals?success=' + encodeURIComponent(`Request ${action === 'approve' ? 'approved' : 'rejected'} successfully`));
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[LeaveManager] Approval error:', err.message);
      res.redirect('/leave/approvals?error=' + encodeURIComponent('Error processing request: ' + err.message));
    } finally {
      client.release();
    }
  }));

  // ============================================================
  // ROUTE 7: GET /leave/calendar — Visual calendar view
  // ============================================================
  app.get('/leave/calendar', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { month: monthParam, year: yearParam, user_type: utFilter } = req.query;

    const now = new Date();
    const viewMonth = monthParam ? parseInt(monthParam) - 1 : now.getMonth();
    const viewYear = yearParam ? parseInt(yearParam) : now.getFullYear();

    const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];

    const calStart = new Date(viewYear, viewMonth, 1).toISOString().split('T')[0];
    const calEnd = new Date(viewYear, viewMonth + 1, 0).toISOString().split('T')[0];

    let where = [`lr.tenant_id=$1`, `lr.status='approved'`, `lr.start_date <= $4::date`, `lr.end_date >= $3::date`];
    const params = [tid, utFilter || null, calStart, calEnd];
    let pi = 5;
    if (utFilter) { where.push(`lr.user_type=$${pi++}`); }

    const leaves = (await pool.query(
      `SELECT lr.start_date, lr.end_date, lr.total_days, lt.category, lt.name as type_name, lt.color,
        COALESCE(u.name, s.name) as person_name, lr.id, lr.reason
       FROM leave_requests lr
       JOIN leave_types lt ON lt.id = lr.leave_type_id
       LEFT JOIN users u ON u.id = lr.user_id AND lr.user_type='staff'
       LEFT JOIN students s ON s.id = lr.user_id AND lr.user_type='student'
       WHERE ${where.join(' AND ')} ORDER BY lr.start_date`, params
    )).rows;

    // Group leaves by date
    const leavesByDate = {};
    for (const lv of leaves) {
      const s = new Date(lv.start_date);
      const e = new Date(lv.end_date);
      const cur = new Date(s);
      while (cur <= e) {
        const key = cur.toISOString().split('T')[0];
        if (!leavesByDate[key]) leavesByDate[key] = [];
        leavesByDate[key].push(lv);
        cur.setDate(cur.getDate() + 1);
      }
    }

    // Build calendar
    const firstDay = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const todayStr = today();

    // Prev/next month navigation
    const prevMonth = viewMonth === 0 ? 12 : viewMonth;
    const prevYear = viewMonth === 0 ? viewYear - 1 : viewYear;
    const nextMonth = viewMonth === 11 ? 1 : viewMonth + 2;
    const nextYear = viewMonth === 11 ? viewYear + 1 : viewYear;
    const filterParam = utFilter ? `&user_type=${utFilter}` : '';

    // Summary stats
    const staffLeaveDays = leaves.filter(l => l.category === 'staff').reduce((sum, l) => sum + l.total_days, 0);
    const studentLeaveDays = leaves.filter(l => l.category === 'student').reduce((sum, l) => sum + l.total_days, 0);
    const uniqueStaff = new Set(leaves.filter(l => l.category === 'staff').map(l => l.person_name)).size;
    const uniqueStudents = new Set(leaves.filter(l => l.category === 'student').map(l => l.person_name)).size;

    let calHtml = `<div class="lv-calendar-grid">`;
    const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    for (const dn of dayNames) calHtml += `<div class="lv-cal-header">${dn}</div>`;
    for (let i = 0; i < firstDay; i++) calHtml += `<div class="lv-cal-day empty"></div>`;
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${viewYear}-${String(viewMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const isToday = dateStr === todayStr;
      const dayLeaves = leavesByDate[dateStr] || [];
      calHtml += `<div class="lv-cal-day${isToday ? ' today' : ''}" title="${dayLeaves.length} leave(s) on this day">
        <div class="day-num">${d}${isToday ? ' <span style="color:#059669;font-size:9px">TODAY</span>' : ''}</div>`;
      for (const lv of dayLeaves.slice(0, 4)) {
        const cls = lv.category === 'staff' ? 'lv-cal-staff' : 'lv-cal-student';
        calHtml += `<span class="lv-cal-leave ${cls}" title="${esc(lv.person_name)}: ${esc(lv.type_name)} (${lv.total_days} days)">${esc((lv.person_name||'?').substring(0,10))}</span>`;
      }
      if (dayLeaves.length > 4) {
        calHtml += `<span style="font-size:9px;color:#6b7280">+${dayLeaves.length-4} more</span>`;
      }
      calHtml += `</div>`;
    }
    calHtml += `</div>`;

    // Detail list for the month
    const detailHtml = leaves.length ? `<table class="lv-table"><thead><tr><th>Person</th><th>Type</th><th>Category</th><th>Start</th><th>End</th><th>Days</th></tr></thead><tbody>
      ${leaves.map(l => `<tr>
        <td style="font-weight:600">${esc(l.person_name)}</td>
        <td style="color:${l.color};font-weight:600">${esc(l.type_name)}</td>
        <td>${userTypeBadge(l.category)}</td>
        <td>${fmtDate(l.start_date)}</td>
        <td>${fmtDate(l.end_date)}</td>
        <td style="font-weight:700">${l.total_days}</td>
      </tr>`).join('')}
    </tbody></table>` : '<div class="lv-empty">No approved leaves in this period</div>';

    const html = LV_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('calendar')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div>
          <h1 style="font-size:24px;color:#1f2937;margin:0">\uD83D\uDCC5 Leave Calendar</h1>
          <p style="font-size:13px;color:#9ca3af;margin-top:2px">Visual overview of all approved leaves</p>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <select onchange="location.href=updateCalUrl('user_type',this.value)" class="lv-filter" style="margin:0">
            <option value="">All</option>
            <option value="staff" ${utFilter==='staff'?'selected':''}>Staff Only</option>
            <option value="student" ${utFilter==='student'?'selected':''}>Students Only</option>
          </select>
        </div>
      </div>

      <!-- Summary Stats -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:14px;margin-bottom:20px">
        <div class="lv-stat-card">
          <div class="lv-stat-num" style="color:#059669">${staffLeaveDays}</div>
          <div class="lv-stat-label">Staff Leave Days</div>
        </div>
        <div class="lv-stat-card">
          <div class="lv-stat-num" style="color:#2563eb">${studentLeaveDays}</div>
          <div class="lv-stat-label">Student Leave Days</div>
        </div>
        <div class="lv-stat-card">
          <div class="lv-stat-num" style="color:#059669">${uniqueStaff}</div>
          <div class="lv-stat-label">Staff on Leave</div>
        </div>
        <div class="lv-stat-card">
          <div class="lv-stat-num" style="color:#2563eb">${uniqueStudents}</div>
          <div class="lv-stat-label">Students on Leave</div>
        </div>
      </div>

      <!-- Month Navigator -->
      <div class="lv-card" style="margin-bottom:20px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
          <a href="/leave/calendar?month=${prevMonth}&year=${prevYear}${filterParam}" class="lv-btn lv-btn-secondary lv-btn-sm">\u2190 ${monthNames[prevMonth-1]}</a>
          <h2 style="margin:0;color:#1f2937;font-size:20px">${monthNames[viewMonth]} ${viewYear}</h2>
          <a href="/leave/calendar?month=${nextMonth}&year=${nextYear}${filterParam}" class="lv-btn lv-btn-secondary lv-btn-sm">${monthNames[nextMonth-1]} \u2192</a>
        </div>

        <div class="lv-legend">
          <span><i style="background:#d1fae5"></i> Staff on leave</span>
          <span><i style="background:#dbeafe"></i> Students on leave</span>
        </div>

        ${calHtml}
      </div>

      <!-- Detail Table -->
      <div class="lv-card">
        <div class="lv-section-title">\uD83D\uDCDD Leave Details — ${monthNames[viewMonth]} ${viewYear}</div>
        <div style="overflow-x:auto">${detailHtml}</div>
      </div>
      <script>
        function updateCalUrl(key, val) {
          const u = new URL(location.href);
          if (val) u.searchParams.set(key, val); else u.searchParams.delete(key);
          return u.pathname + u.search;
        }
      </script>
    </div>`;
    res.send(renderPage('Leave Calendar', html, user, req));
  }));

  // ============================================================
  // ROUTE 8: GET /leave/types — Manage leave types
  // ============================================================
  app.get('/leave/types', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { category: catFilter } = req.query;

    const successMsg = req.query.success ? `<div class="lv-alert lv-alert-success">\u2705 ${esc(req.query.success)}</div>` : '';
    const errorMsg = req.query.error ? `<div class="lv-alert lv-alert-error">\u274C ${esc(req.query.error)}</div>` : '';

    let where = ['tenant_id=$1'];
    const params = [tid];
    if (catFilter) { where.push(`category=$2`); params.push(catFilter); }

    const leaveTypes = (await pool.query(
      `SELECT lt.*,
        (SELECT COUNT(*)::int FROM leave_requests lr WHERE lr.tenant_id=lt.tenant_id AND lr.leave_type_id=lt.id AND lr.status='approved') as approved_count
       FROM leave_types lt
       WHERE ${where.join(' AND ')}
       ORDER BY lt.category, lt.name`, params
    )).rows;

    const staffTypes = leaveTypes.filter(t => t.category === 'staff');
    const studentTypes = leaveTypes.filter(t => t.category === 'student');

    function typeCard(t, canEdit) {
      return `<div class="lv-type-card">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
          <div style="display:flex;align-items:center;gap:8px">
            <span class="lv-type-dot" style="background:${t.color}"></span>
            <strong style="font-size:15px;color:#1f2937">${esc(t.name)}</strong>
            <span style="background:${t.category==='staff'?'#d1fae5':'#dbeafe'};color:${t.category==='staff'?'#059669':'#2563eb'};padding:2px 10px;border-radius:12px;font-size:11px;font-weight:700">${t.category}</span>
            ${t.is_active ? '' : '<span style="background:#fee2e2;color:#dc2626;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:700">Inactive</span>'}
          </div>
          ${canEdit ? `<div style="display:flex;gap:4px">
            <button class="lv-btn lv-btn-sm lv-btn-secondary" onclick="editType(${t.id},'${esc(t.name).replace(/'/g,"\\'")}','${t.category}',${t.default_days},${t.paid},${t.requires_document},'${t.color}','${esc(t.description||'').replace(/'/g,"\\'")}')">Edit</button>
            <form method="POST" action="/leave/types/${t.id}/toggle" style="display:inline">
              <button class="lv-btn lv-btn-sm ${t.is_active ? 'lv-btn-danger' : 'lv-btn-success'}" type="submit">${t.is_active ? 'Deactivate' : 'Activate'}</button>
            </form>
          </div>` : ''}
        </div>
        <p style="font-size:13px;color:#6b7280;margin:0 0 10px">${esc(t.description || 'No description')}</p>
        <div style="display:flex;gap:14px;flex-wrap:wrap">
          <span style="font-size:12px;color:#374151"><strong>Default:</strong> ${t.default_days} days</span>
          <span style="font-size:12px;color:#374151"><strong>Paid:</strong> ${t.paid ? 'Yes' : 'No'}</span>
          <span style="font-size:12px;color:#374151"><strong>Document:</strong> ${t.requires_document ? 'Required' : 'Optional'}</span>
          <span style="font-size:12px;color:#374151"><strong>Used:</strong> ${t.approved_count || 0} times</span>
        </div>
      </div>`;
    }

    const staffHtml = staffTypes.map(t => typeCard(t, true)).join('');
    const studentHtml = studentTypes.map(t => typeCard(t, true)).join('');

    // Default colors for new type
    const defaultColors = ['#059669','#0891b2','#7c3aed','#dc2626','#ea580c','#ca8a04','#2563eb','#be185d'];

    const html = LV_CSS + `<div style="max-width:1000px;margin:0 auto">
      ${nav('types')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div>
          <h1 style="font-size:24px;color:#1f2937;margin:0">\u2699\uFE0F Leave Types</h1>
          <p style="font-size:13px;color:#9ca3af;margin-top:2px">${leaveTypes.length} type(s) configured</p>
        </div>
        <button class="lv-btn lv-btn-primary" onclick="showCreateForm()">+ Add Leave Type</button>
      </div>
      ${successMsg}${errorMsg}

      <!-- Create/Edit Form (hidden) -->
      <div id="typeFormCard" class="lv-card" style="display:none;margin-bottom:20px;border:2px solid #059669">
        <h3 style="margin:0 0 16px;color:#1f2937" id="formTitle">Create Leave Type</h3>
        <form method="POST" action="/leave/types/create" class="lv-form" id="typeForm">
          <input type="hidden" name="edit_id" id="editId" value="">
          <div class="lv-grid">
            <div><label>Name *</label><input type="text" name="name" id="typeName" required placeholder="e.g., Annual Leave"></div>
            <div><label>Category *</label>
              <select name="category" id="typeCategory" required>
                <option value="staff">Staff</option>
                <option value="student">Student</option>
              </select>
            </div>
          </div>
          <div class="lv-grid" style="margin-top:14px">
            <div><label>Default Days *</label><input type="number" name="default_days" id="typeDefaultDays" required min="0" value="0"></div>
            <div><label>Color</label><input type="color" name="color" id="typeColor" value="#059669" style="height:40px;padding:2px"></div>
          </div>
          <div class="lv-grid" style="margin-top:14px">
            <div>
              <label>Paid Leave</label>
              <select name="paid" id="typePaid">
                <option value="true">Yes - Paid</option>
                <option value="false">No - Unpaid</option>
              </select>
            </div>
            <div>
              <label>Requires Document</label>
              <select name="requires_document" id="typeRequiresDoc">
                <option value="false">No - Optional</option>
                <option value="true">Yes - Required</option>
              </select>
            </div>
          </div>
          <div style="margin-top:14px">
            <label>Description</label>
            <textarea name="description" id="typeDescription" rows="2" placeholder="Brief description of this leave type..."></textarea>
          </div>
          <div style="display:flex;gap:10px;margin-top:18px">
            <button type="submit" class="lv-btn lv-btn-primary" style="padding:12px 24px" id="formSubmitBtn">Create Type</button>
            <button type="button" class="lv-btn lv-btn-secondary" onclick="hideCreateForm()">Cancel</button>
          </div>
        </form>
      </div>

      <!-- Staff Types -->
      <div class="lv-section">
        <div class="lv-section-title">\uD83D\uDC68\u200D\uD83D\uDCBB Staff Leave Types (${staffTypes.length})</div>
        <div style="display:grid;gap:12px">${staffHtml || '<div class="lv-empty">No staff leave types configured</div>'}</div>
      </div>

      <!-- Student Types -->
      <div class="lv-section">
        <div class="lv-section-title">\uD83D\uDC39 Student Leave Types (${studentTypes.length})</div>
        <div style="display:grid;gap:12px">${studentHtml || '<div class="lv-empty">No student leave types configured</div>'}</div>
      </div>
    </div>
    <script>
      function showCreateForm() {
        document.getElementById('typeFormCard').style.display='block';
        document.getElementById('formTitle').textContent='Create Leave Type';
        document.getElementById('formSubmitBtn').textContent='Create Type';
        document.getElementById('typeForm').action='/leave/types/create';
        document.getElementById('editId').value='';
        document.getElementById('typeName').value='';
        document.getElementById('typeCategory').value='staff';
        document.getElementById('typeDefaultDays').value='0';
        document.getElementById('typeColor').value='#059669';
        document.getElementById('typePaid').value='true';
        document.getElementById('typeRequiresDoc').value='false';
        document.getElementById('typeDescription').value='';
        document.getElementById('typeName').focus();
      }
      function hideCreateForm() { document.getElementById('typeFormCard').style.display='none'; }
      function editType(id,name,category,days,paid,reqDoc,color,desc) {
        document.getElementById('typeFormCard').style.display='block';
        document.getElementById('formTitle').textContent='Edit Leave Type';
        document.getElementById('formSubmitBtn').textContent='Save Changes';
        document.getElementById('typeForm').action='/leave/types/'+id+'/edit';
        document.getElementById('editId').value=id;
        document.getElementById('typeName').value=name;
        document.getElementById('typeCategory').value=category;
        document.getElementById('typeDefaultDays').value=days;
        document.getElementById('typeColor').value=color;
        document.getElementById('typePaid').value=String(paid);
        document.getElementById('typeRequiresDoc').value=String(reqDoc);
        document.getElementById('typeDescription').value=desc;
        document.getElementById('typeName').focus();
      }
    </script>`;
    res.send(renderPage('Leave Types', html, user, req));
  }));

  // ============================================================
  // ROUTE 9: POST /leave/types/create — Create new leave type
  // ============================================================
  app.post('/leave/types/create', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { name, category, default_days, paid, requires_document, color, description } = req.body;

    if (!name || !name.trim()) return res.redirect('/leave/types?error=' + encodeURIComponent('Name is required'));
    if (!category) return res.redirect('/leave/types?error=' + encodeURIComponent('Category is required'));

    // Check for duplicate name within tenant and category
    const dup = (await pool.query(
      `SELECT id FROM leave_types WHERE tenant_id=$1 AND name=$2 AND category=$3`,
      [tid, name.trim(), category]
    )).rows[0];
    if (dup) return res.redirect('/leave/types?error=' + encodeURIComponent('A leave type with this name already exists in this category'));

    await pool.query(
      `INSERT INTO leave_types (tenant_id, name, category, default_days, paid, requires_document, color, description, is_active, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,NOW())`,
      [tid, name.trim(), category, parseInt(default_days) || 0, paid === 'true', requires_document === 'true', color || '#059669', description || null]
    );

    console.log(`[LeaveManager] Leave type created: ${name.trim()} (${category})`);
    res.redirect('/leave/types?success=' + encodeURIComponent(`Leave type "${name.trim()}" created successfully`));
  }));

  // ============================================================
  // ROUTE 10: POST /leave/types/:id/edit — Edit leave type
  // ============================================================
  app.post('/leave/types/:id/edit', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const typeId = req.params.id;
    const { name, category, default_days, paid, requires_document, color, description } = req.body;

    if (!name || !name.trim()) return res.redirect('/leave/types?error=' + encodeURIComponent('Name is required'));

    await pool.query(
      `UPDATE leave_types SET name=$2, category=$3, default_days=$4, paid=$5, requires_document=$6, color=$7, description=$8
       WHERE id=$1 AND tenant_id=$9`,
      [typeId, name.trim(), category, parseInt(default_days) || 0, paid === 'true', requires_document === 'true', color || '#059669', description || null, tid]
    );

    console.log(`[LeaveManager] Leave type ${typeId} updated`);
    res.redirect('/leave/types?success=' + encodeURIComponent(`Leave type "${name.trim()}" updated successfully`));
  }));

  // POST /leave/types/:id/toggle — Toggle active status
  app.post('/leave/types/:id/toggle', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const typeId = req.params.id;
    await pool.query(
      `UPDATE leave_types SET is_active = NOT is_active WHERE id=$1 AND tenant_id=$2`,
      [typeId, tid]
    );
    res.redirect('/leave/types?success=' + encodeURIComponent('Leave type status updated'));
  }));

  // ============================================================
  // ROUTE 11: GET /leave/balances — View all balances
  // ============================================================
  app.get('/leave/balances', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { user_type: utFilter, search } = req.query;

    let where = ['lb.tenant_id=$1'];
    const params = [tid];
    let pi = 2;
    if (utFilter) { where.push(`lb.user_type=$${pi++}`); params.push(utFilter); }
    if (search) { where.push(`(p.name ILIKE $${pi++})`); params.push('%' + search + '%'); }

    const balances = (await pool.query(
      `SELECT lb.*, lt.name as type_name, lt.color, lt.category,
        COALESCE(p.name, 'Unknown') as person_name
       FROM leave_balances lb
       JOIN leave_types lt ON lt.id = lb.leave_type_id
       LEFT JOIN (
         SELECT u.id, u.name, 'staff' as ut FROM users u
         UNION ALL
         SELECT s.id, COALESCE(s.first_name || ' ' || s.last_name, s.name), 'student' FROM students s
       ) p ON p.id = lb.user_id AND p.ut = lb.user_type
       WHERE ${where.join(' AND ')}
       ORDER BY lb.user_type, p.name, lt.name`, params
    )).rows;

    // Group by user
    const grouped = {};
    for (const b of balances) {
      const key = `${b.user_type}-${b.user_id}`;
      if (!grouped[key]) grouped[key] = { user_type: b.user_type, user_id: b.user_id, person_name: b.person_name, types: [] };
      grouped[key].types.push(b);
    }

    const staffCount = Object.values(grouped).filter(g => g.user_type === 'staff').length;
    const studentCount = Object.values(grouped).filter(g => g.user_type === 'student').length;

    const userRows = Object.values(grouped).map(g => {
      const totalUsed = g.types.reduce((s, t) => s + (t.used_days || 0), 0);
      const totalEntitled = g.types.reduce((s, t) => s + (t.total_days || 0), 0);
      return `<div class="lv-card" style="margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
          <div class="lv-avatar" style="background:${g.user_type==='staff'?'#d1fae5':'#dbeafe'};color:${g.user_type==='staff'?'#059669':'#2563eb'}">${(g.person_name||'?')[0]}</div>
          <div style="flex:1">
            <div style="font-size:15px;font-weight:700;color:#1f2937">${esc(g.person_name)}</div>
            <div style="font-size:12px;color:#6b7280">${userTypeBadge(g.user_type)} · Total: ${totalUsed} used / ${totalEntitled} entitled</div>
          </div>
        </div>
        <div style="display:grid;gap:8px">
          ${g.types.map(t => `<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid #f3f4f6">
            <span style="width:10px;height:10px;border-radius:50%;background:${t.color};flex-shrink:0"></span>
            <span style="font-size:13px;font-weight:600;color:#374151;min-width:120px">${esc(t.type_name)}</span>
            ${balanceBar(t.used_days, t.total_days, t.color)}
            ${t.carry_forward_days > 0 ? `<span style="font-size:11px;color:#6b7280">+${t.carry_forward_days} carried</span>` : ''}
          </div>`).join('')}
        </div>
      </div>`;
    }).join('');

    const html = LV_CSS + `<div style="max-width:1000px;margin:0 auto">
      ${nav('balances')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div>
          <h1 style="font-size:24px;color:#1f2937;margin:0">\uD83D\uDCC8 Leave Balances</h1>
          <p style="font-size:13px;color:#9ca3af;margin-top:2px">${staffCount} staff, ${studentCount} students</p>
        </div>
        <button class="lv-btn lv-btn-primary" onclick="document.getElementById('adjustForm').style.display='block'">\u2795 Adjust Balance</button>
      </div>

      <!-- Adjust Balance Form (hidden) -->
      <div id="adjustForm" class="lv-card" style="display:none;margin-bottom:20px;border:2px solid #059669">
        <h3 style="margin:0 0 16px;color:#1f2937">\u2795 Adjust Leave Balance</h3>
        <form method="POST" action="/leave/balances/adjust" class="lv-form">
          <div class="lv-grid">
            <div><label>User Type *</label>
              <select name="user_type" required>
                <option value="staff">Staff</option>
                <option value="student">Student</option>
              </select>
            </div>
            <div><label>User ID *</label>
              <input type="number" name="user_id" required min="1" placeholder="Enter user or student ID">
            </div>
          </div>
          <div class="lv-grid" style="margin-top:14px">
            <div><label>Leave Type *</label>
              <select name="leave_type_id" required>
                ${balances.length ? [...new Set(balances.map(b => `<option value="${b.leave_type_id}">${esc(b.type_name)} (${b.category})</option>`))].join('') : '<option value="">No types configured</option>'}
              </select>
            </div>
            <div><label>Adjustment *</label>
              <select name="adjustment_type" required>
                <option value="add_days">Add Days</option>
                <option value="remove_days">Remove Days</option>
                <option value="set_total">Set Total</option>
              </select>
            </div>
          </div>
          <div class="lv-grid" style="margin-top:14px">
            <div><label>Days *</label>
              <input type="number" name="adjustment_days" required min="0" value="0" placeholder="Number of days">
            </div>
            <div><label>Academic Year</label>
              <input type="text" name="academic_year" placeholder="e.g., 2025">
            </div>
          </div>
          <div style="margin-top:14px">
            <label>Reason *</label>
            <textarea name="reason" rows="2" required placeholder="Reason for this adjustment..."></textarea>
          </div>
          <div style="display:flex;gap:10px;margin-top:18px">
            <button type="submit" class="lv-btn lv-btn-primary" style="padding:12px 24px">Apply Adjustment</button>
            <button type="button" class="lv-btn lv-btn-secondary" onclick="document.getElementById('adjustForm').style.display='none'">Cancel</button>
          </div>
        </form>
      </div>

      <!-- Filters -->
      <div class="lv-filter">
        <div>
          <label>User Type</label>
          <select onchange="location.href=updateBalUrl('user_type',this.value)">
            <option value="">All</option>
            <option value="staff" ${utFilter==='staff'?'selected':''}>Staff</option>
            <option value="student" ${utFilter==='student'?'selected':''}>Students</option>
          </select>
        </div>
        <div>
          <label>Search</label>
          <form method="GET" action="/leave/balances" style="display:flex;gap:6px">
            <input type="text" name="search" placeholder="Search by name..." value="${esc(search||'')}" style="padding:8px 14px;border:2px solid #e5e7eb;border-radius:10px;font-size:13px">
            <button type="submit" class="lv-btn lv-btn-sm lv-btn-secondary">Search</button>
          </form>
        </div>
      </div>

      <!-- Balance Cards -->
      ${userRows || '<div class="lv-empty">No leave balances found. Balances are created when leave requests are approved.</div>'}
      <script>
        function updateBalUrl(key, val) {
          const u = new URL(location.href);
          if (val) u.searchParams.set(key, val); else u.searchParams.delete(key);
          return u.pathname + u.search;
        }
      </script>
    </div>`;
    res.send(renderPage('Leave Balances', html, user, req));
  }));

  // ============================================================
  // ROUTE 12: POST /leave/balances/adjust — Admin adjust balance
  // ============================================================
  app.post('/leave/balances/adjust', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { user_type, user_id, leave_type_id, adjustment_type, adjustment_days, academic_year, reason } = req.body;

    if (!user_type || !user_id || !leave_type_id || !adjustment_type) {
      return res.redirect('/leave/balances?error=' + encodeURIComponent('All required fields must be filled'));
    }

    const days = parseInt(adjustment_days) || 0;
    const uid = parseInt(user_id);
    const ltid = parseInt(leave_type_id);

    if (days < 0) return res.redirect('/leave/balances?error=' + encodeURIComponent('Days must be 0 or greater'));

    // Get or create balance
    const existing = (await pool.query(
      `SELECT * FROM leave_balances WHERE tenant_id=$1 AND user_type=$2 AND user_id=$3 AND leave_type_id=$4`,
      [tid, user_type, uid, ltid]
    )).rows[0];

    if (existing) {
      let newTotal = existing.total_days;
      let newRemaining = existing.remaining_days;

      if (adjustment_type === 'add_days') {
        newTotal = existing.total_days + days;
        newRemaining = existing.remaining_days + days;
      } else if (adjustment_type === 'remove_days') {
        newTotal = Math.max(0, existing.total_days - days);
        newRemaining = Math.max(0, existing.remaining_days - days);
      } else if (adjustment_type === 'set_total') {
        const diff = days - existing.total_days;
        newTotal = days;
        newRemaining = Math.max(0, existing.remaining_days + diff);
      }

      await pool.query(
        `UPDATE leave_balances SET total_days=$3, remaining_days=$4, updated_at=NOW()
         WHERE id=$1 AND tenant_id=$2`,
        [existing.id, tid, newTotal, newRemaining]
      );
      console.log(`[LeaveManager] Balance adjusted for user ${uid} type ${ltid}: ${adjustment_type} ${days} days by ${user.id}. Reason: ${reason}`);
    } else {
      // Create new balance
      let newRemaining = 0;
      if (adjustment_type === 'add_days' || adjustment_type === 'set_total') {
        newRemaining = days;
      }
      await pool.query(
        `INSERT INTO leave_balances (tenant_id, user_type, user_id, leave_type_id, academic_year, total_days, used_days, remaining_days, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,0,$7,NOW(),NOW())`,
        [tid, user_type, uid, ltid, academic_year || null, adjustment_type === 'set_total' ? days : days, newRemaining]
      );
      console.log(`[LeaveManager] Balance created for user ${uid} type ${ltid}: ${days} days by ${user.id}`);
    }

    res.redirect('/leave/balances?success=' + encodeURIComponent(`Balance adjusted successfully: ${adjustment_type.replace('_', ' ')} ${days} day(s)`));
  }));

  // ============================================================
  // END OF MODULE
  // ============================================================
  console.log('[LeaveManager] Module loaded — 12 routes registered');
};
