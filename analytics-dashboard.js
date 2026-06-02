// ============================================================
// ANALYTICS DASHBOARD MODULE — Multi-Tenant SaaS Platform
// Platform-wide analytics and reporting dashboard with KPIs,
// trend charts, academic performance, finance, attendance,
// user engagement analytics, and CSV export.
// ============================================================
// Usage in server.js:
//   const analyticsDashboard = require('./analytics-dashboard');
//   analyticsDashboard(app, db, pool, renderPage, esc);
// ============================================================

'use strict';

// ============================================================
// MODULE ENTRY POINT
// ============================================================
const { migrateQuery } = require('./db');
module.exports = function analyticsDashboard(app, db, pool, renderPage, esc) {

  // -- inline helpers ---------------------------------------------------
  const requireAuth = (req, res, next) => {
    if (!req.session?.user) return res.redirect('/login');
    next();
  };

  const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  if (!esc) esc = (s) => String(s == null ? '' : (typeof s === 'object' ? JSON.stringify(s) : s))
    .replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  // -- internal helpers ---------------------------------------------------
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const fmtTime = (t) => t ? String(t).substring(0, 5) : '—';
  const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const today = () => new Date().toISOString().slice(0, 10);
  const genToken = () => require('crypto').randomBytes(24).toString('hex');
  const fmtNum = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 1 });
  const fmtPct = (n) => Math.round(Number(n || 0)) + '%';
  const fmtMoney = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // -- shared CSS --------------------------------------------------------
  const AD_CSS = `<style>
    .ad-nav{display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap}
    .ad-nav a{padding:8px 18px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#475569;background:#f1f5f9;transition:.15s}
    .ad-nav a:hover{background:#e2e8f0}.ad-nav a.active{background:#4f46e5;color:#fff}
    .ad-btn{display:inline-flex;align-items:center;gap:6px;padding:9px 18px;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:.15s}
    .ad-btn:hover{opacity:.9;transform:translateY(-1px)}
    .ad-btn-primary{background:#4f46e5;color:#fff}.ad-btn-success{background:#059669;color:#fff}
    .ad-btn-danger{background:#fee2e2;color:#dc2626}.ad-btn-secondary{background:#f1f5f9;color:#475569}
    .ad-table{width:100%;border-collapse:collapse;font-size:13px}
    .ad-table th{padding:11px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#f8fafc}
    .ad-table td{padding:10px 14px;border-bottom:1px solid #f1f5f9;color:#1e293b}
    .ad-table tr:hover{background:#f8fafc}
    .ad-filter{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:end}
    .ad-filter label{display:block;font-size:12px;font-weight:600;color:#64748b;margin-bottom:4px}
    .ad-filter input,.ad-filter select{padding:8px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px;background:#fff}
    .ad-filter input:focus,.ad-filter select:focus{outline:none;border-color:#6366f1}
    .ad-kpi{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:20px;text-align:center;transition:.2s}
    .ad-kpi:hover{box-shadow:0 4px 16px rgba(0,0,0,.06);transform:translateY(-2px)}
    .ad-kpi-value{font-size:28px;font-weight:800;margin:8px 0 4px}
    .ad-kpi-label{font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.5px;font-weight:600}
    .ad-kpi-delta{font-size:11px;margin-top:4px;font-weight:600}
    .ad-kpi-delta.up{color:#16a34a}.ad-kpi-delta.down{color:#dc2626}
    .ad-chart{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:20px;margin-bottom:16px}
    .ad-bar-row{display:flex;align-items:center;gap:8px;margin-bottom:5px}
    .ad-bar-label{font-size:11px;color:#64748b;min-width:80px;text-align:right}
    .ad-bar-track{flex:1;background:#f1f5f9;border-radius:6px;height:24px;overflow:hidden;position:relative}
    .ad-bar-fill{height:100%;border-radius:6px;transition:.3s}
    .ad-bar-value{position:absolute;right:6px;top:3px;font-size:11px;font-weight:700;color:#1e293b}
    @media(max-width:768px){.ad-nav{gap:4px}.ad-nav a{padding:6px 12px;font-size:12px}}
  </style>`;

  // -- navigation helper --------------------------------------------------
  const nav = (active) => `<div class="ad-nav">
    <a href="/analytics" class="${active === 'overview' ? 'active' : ''}">📊 Overview</a>
    <a href="/analytics/academics" class="${active === 'academics' ? 'active' : ''}">🎓 Academics</a>
    <a href="/analytics/finance" class="${active === 'finance' ? 'active' : ''}">💰 Finance</a>
    <a href="/analytics/attendance" class="${active === 'attendance' ? 'active' : ''}">📅 Attendance</a>
    <a href="/analytics/users" class="${active === 'users' ? 'active' : ''}">👥 Users</a>
    <a href="/analytics/export" class="${active === 'export' ? 'active' : ''}">📥 Export</a>
  </div>`;

  // ============================================================
  // DATABASE MIGRATIONS (async IIFE)
  // ============================================================
  (async () => {
    try {
      await migrateQuery(pool, 'AnalyticsDashboard', `CREATE TABLE IF NOT EXISTS analytics_snapshots (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        metric_name VARCHAR(100), metric_value DECIMAL(15,2) DEFAULT 0,
        dimensions JSONB DEFAULT '{}', snapshot_date DATE NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      const asCols = [
        ['metric_name','VARCHAR(100)'],['metric_value','DECIMAL(15,2) DEFAULT 0'],
        ['dimensions',"JSONB DEFAULT '{}'"],['snapshot_date','DATE NOT NULL'],['created_at','TIMESTAMPTZ DEFAULT NOW()']
      ];
      for (const [col, def] of asCols) { try { await migrateQuery(pool, 'AnalyticsDashboard', `ALTER TABLE analytics_snapshots ADD COLUMN IF NOT EXISTS ${col} ${def}`); } catch(e){} }
      await migrateQuery(pool, 'AnalyticsDashboard', `CREATE INDEX IF NOT EXISTS idx_asnap_tenant ON analytics_snapshots(tenant_id)`);
      await migrateQuery(pool, 'AnalyticsDashboard', `CREATE INDEX IF NOT EXISTS idx_asnap_date ON analytics_snapshots(snapshot_date)`);
      await migrateQuery(pool, 'AnalyticsDashboard', `CREATE INDEX IF NOT EXISTS idx_asnap_metric ON analytics_snapshots(tenant_id, metric_name)`);
      console.log('[Analytics] Migrations applied successfully');
    } catch (e) { console.error('[Analytics] Migration error:', e.message); }
  })();

  // Helper: bar chart HTML from data
  const barChart = (data, maxVal, color) => {
    const mx = maxVal || Math.max(...data.map(d => Number(d.value || d.total || d.cnt || 0)), 1);
    return data.map(d => {
      const val = Number(d.value || d.total || d.cnt || 0);
      const pct = Math.round(val / mx * 100);
      const label = d.label || d.name || d.period || d.date || String(d.key);
      return `<div class="ad-bar-row">
        <span class="ad-bar-label">${esc(String(label))}</span>
        <div class="ad-bar-track">
          <div class="ad-bar-fill" style="width:${pct}%;background:${color || '#4f46e5'}"></div>
          <span class="ad-bar-value">${d.fmt ? d.fmt(val) : fmtNum(val)}</span>
        </div>
      </div>`;
    }).join('');
  };

  // Helper: safe table check
  const tableExists = async (tbl) => {
    try {
      const r = await pool.query(`SELECT 1 FROM information_schema.tables WHERE table_name=$1`, [tbl]);
      return r.rows.length > 0;
    } catch(e) { return false; }
  };

  // ============================================================
  // ROUTE 1: GET /analytics — Main Dashboard
  // ============================================================
  app.get('/analytics', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    // KPI Data - try multiple tables gracefully
    let studentCount = 0, memberCount = 0, eventCount = 0, revenueTotal = 0;

    try { studentCount = (await pool.query(`SELECT COUNT(*)::int as cnt FROM students WHERE tenant_id=$1`, [tid])).rows[0].cnt; } catch(e){}
    try { memberCount = (await pool.query(`SELECT COUNT(*)::int as cnt FROM church_members WHERE tenant_id=$1`, [tid])).rows[0].cnt; } catch(e){}
    try { eventCount = (await pool.query(`SELECT COUNT(*)::int as cnt FROM analytics_events WHERE tenant_id=$1 AND created_at > NOW() - INTERVAL '30 days'`, [tid])).rows[0].cnt; } catch(e){}
    try { revenueTotal = (await pool.query(`SELECT COALESCE(SUM(amount),0) as total FROM donations WHERE tenant_id=$1 AND created_at > NOW() - INTERVAL '30 days'`, [tid])).rows[0].total; } catch(e){}

    const totalPeople = studentCount + memberCount;

    // Recent activity
    let activityRows = [];
    try { activityRows = (await pool.query(`SELECT * FROM activity_feed WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 15`, [tid])).rows; } catch(e){}

    const activityHtml = activityRows.map(a => `<div style="padding:10px 0;border-bottom:1px solid #f1f5f9">
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:12px;font-weight:600;color:#475569">${esc(a.user_email || 'System')}</span>
        <span class="muted" style="font-size:11px">${fmtDateTime(a.created_at)}</span>
      </div>
      <div style="font-size:13px;color:#1e293b;margin-top:2px">${esc(a.action || a.description || '—')}</div>
    </div>`).join('');

    // Monthly event trend
    let eventTrend = [];
    try {
      eventTrend = (await pool.query(
        `SELECT to_char(created_at,'Mon') as label, COUNT(*)::int as cnt FROM analytics_events WHERE tenant_id=$1 AND created_at > NOW() - INTERVAL '6 months' GROUP BY label ORDER BY MIN(created_at)`,
        [tid]
      )).rows;
    } catch(e){}
    const maxEvents = Math.max(...eventTrend.map(r => r.cnt), 1);

    const html = AD_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('overview')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">📊 Analytics Dashboard</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Platform-wide performance insights</p></div>
        <div style="display:flex;gap:8px">
          <a href="/analytics/export" class="ad-btn ad-btn-success">📥 Export CSV</a>
          <a href="/analytics/api/kpis" class="ad-btn ad-btn-secondary" target="_blank">🔗 KPI JSON</a>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:20px">
        <div class="ad-kpi"><div class="ad-kpi-value" style="color:#4f46e5">${fmtNum(totalPeople)}</div><div class="ad-kpi-label">Total People</div><div class="ad-kpi-delta up">👥 Students + Members</div></div>
        <div class="ad-kpi"><div class="ad-kpi-value" style="color:#16a34a">${fmtMoney(revenueTotal)}</div><div class="ad-kpi-label">Revenue (30d)</div><div class="ad-kpi-delta up">💰 Donations</div></div>
        <div class="ad-kpi"><div class="ad-kpi-value" style="color:#3b82f6">${fmtNum(eventCount)}</div><div class="ad-kpi-label">Events (30d)</div><div class="ad-kpi-delta up">📈 Tracked</div></div>
        <div class="ad-kpi"><div class="ad-kpi-value" style="color:#a855f7">${fmtNum(studentCount)}</div><div class="ad-kpi-label">Students</div><div class="ad-kpi-delta">🎓 Enrolled</div></div>
        <div class="ad-kpi"><div class="ad-kpi-value" style="color:#f59e0b">${fmtNum(memberCount)}</div><div class="ad-kpi-label">Members</div><div class="ad-kpi-delta">⛪ Registered</div></div>
      </div>
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:16px;margin-bottom:20px">
        <div class="ad-chart">
          <h3 style="font-size:15px;color:#1e293b;margin-bottom:14px">📈 Event Activity Trend (6 months)</h3>
          ${eventTrend.length ? barChart(eventTrend, maxEvents, '#3b82f6') : '<p class="muted" style="font-size:13px">No event data available</p>'}
        </div>
        <div class="ad-chart">
          <h3 style="font-size:15px;color:#1e293b;margin-bottom:14px">⚡ Recent Activity</h3>
          <div style="max-height:300px;overflow-y:auto">
            ${activityHtml || '<p class="muted" style="font-size:13px">No recent activity</p>'}
          </div>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Analytics Dashboard', html, user, req));
  }));

  // ============================================================
  // ROUTE 2: GET /analytics/academics — Academic analytics
  // ============================================================
  app.get('/analytics/academics', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    let gradeData = [], subjectAvg = [], classPerformance = [];
    try {
      gradeData = (await pool.query(
        `SELECT CASE WHEN grade >= 80 THEN 'A (80-100)' WHEN grade >= 70 THEN 'B (70-79)' WHEN grade >= 60 THEN 'C (60-69)' WHEN grade >= 50 THEN 'D (50-59)' ELSE 'F (<50)' END as label, COUNT(*)::int as cnt FROM marks WHERE tenant_id=$1 GROUP BY label ORDER BY MIN(grade) DESC`,
        [tid]
      )).rows;
    } catch(e){}

    try {
      subjectAvg = (await pool.query(
        `SELECT subject, ROUND(AVG(grade),1)::numeric as avg_grade, COUNT(*)::int as cnt FROM marks WHERE tenant_id=$1 GROUP BY subject ORDER BY avg_grade DESC LIMIT 15`,
        [tid]
      )).rows;
    } catch(e){}

    try {
      classPerformance = (await pool.query(
        `SELECT class_name, ROUND(AVG(grade),1)::numeric as avg_grade, COUNT(*)::int as cnt FROM marks WHERE tenant_id=$1 GROUP BY class_name ORDER BY avg_grade DESC LIMIT 10`,
        [tid]
      )).rows;
    } catch(e){}

    const maxGradeCnt = Math.max(...gradeData.map(r => r.cnt), 1);
    const maxSubjAvg = Math.max(...subjectAvg.map(r => Number(r.avg_grade)), 1);
    const maxClassAvg = Math.max(...classPerformance.map(r => Number(r.avg_grade)), 1);

    const html = AD_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('academics')}
      <h1 style="font-size:24px;color:#1e293b;margin-bottom:20px">🎓 Academic Performance Analytics</h1>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
        <div class="ad-chart">
          <h3 style="font-size:15px;color:#1e293b;margin-bottom:14px">Grade Distribution</h3>
          ${gradeData.length ? barChart(gradeData, maxGradeCnt, '#4f46e5') : '<p class="muted" style="font-size:13px">No marks data found</p>'}
        </div>
        <div class="ad-chart">
          <h3 style="font-size:15px;color:#1e293b;margin-bottom:14px">Average by Subject</h3>
          ${subjectAvg.length ? barChart(subjectAvg.map(s => ({label: s.subject, value: s.avg_grade, fmt: v => v + '%'})), maxSubjAvg, '#16a34a') : '<p class="muted" style="font-size:13px">No subject data found</p>'}
        </div>
      </div>
      <div class="ad-chart">
        <h3 style="font-size:15px;color:#1e293b;margin-bottom:14px">Class Performance Comparison</h3>
        ${classPerformance.length ? barChart(classPerformance.map(c => ({label: c.class_name || 'Unknown', value: c.avg_grade, fmt: v => v + '%'})), maxClassAvg, '#3b82f6') : '<p class="muted" style="font-size:13px">No class data found</p>'}
      </div>
      <div class="card" style="padding:16px;margin-top:16px">
        <h3 style="font-size:15px;color:#1e293b;margin-bottom:12px">Top Subjects (Average Grade)</h3>
        <div style="overflow-x:auto"><table class="ad-table">
          <thead><tr><th>Subject</th><th>Avg Grade</th><th>Entries</th><th>Performance</th></tr></thead>
          <tbody>${subjectAvg.map(s => {
            const perf = s.avg_grade >= 70 ? {c:'badge-success',l:'Good'} : s.avg_grade >= 50 ? {c:'badge-warning',l:'Average'} : {c:'badge-error',l:'Below Avg'};
            return `<tr><td><strong>${esc(s.subject)}</strong></td><td>${s.avg_grade}%</td><td>${s.cnt}</td><td><span class="badge ${perf.c}">${perf.l}</span></td></tr>`;
          }).join('') || '<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:20px">No data</td></tr>'}</tbody>
        </table></div>
      </div>
    </div>`;
    res.send(renderPage('Academic Analytics', html, user, req));
  }));

  // ============================================================
  // ROUTE 3: GET /analytics/finance — Financial analytics
  // ============================================================
  app.get('/analytics/finance', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    let monthlyRevenue = [], donationByType = [], recentDonations = [];
    try {
      monthlyRevenue = (await pool.query(
        `SELECT to_char(created_at,'Mon YYYY') as label, COALESCE(SUM(amount),0)::numeric as total FROM donations WHERE tenant_id=$1 AND created_at > NOW() - INTERVAL '12 months' GROUP BY label ORDER BY MIN(created_at)`,
        [tid]
      )).rows;
    } catch(e){}

    try {
      donationByType = (await pool.query(
        `SELECT COALESCE(type,'General') as label, COALESCE(SUM(amount),0)::numeric as total, COUNT(*)::int as cnt FROM donations WHERE tenant_id=$1 GROUP BY type ORDER BY total DESC`,
        [tid]
      )).rows;
    } catch(e){}

    try {
      recentDonations = (await pool.query(
        `SELECT * FROM donations WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 10`,
        [tid]
      )).rows;
    } catch(e){}

    const totalRevenue = monthlyRevenue.reduce((s, r) => s + Number(r.total), 0);
    const maxRev = Math.max(...monthlyRevenue.map(r => Number(r.total)), 1);
    const maxType = Math.max(...donationByType.map(r => Number(r.total)), 1);

    const html = AD_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('finance')}
      <h1 style="font-size:24px;color:#1e293b;margin-bottom:20px">💰 Financial Analytics</h1>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:20px">
        <div class="stat-card"><div class="stat-num" style="color:#16a34a">${fmtMoney(totalRevenue)}</div><div class="muted" style="font-size:11px;text-transform:uppercase">12-Month Revenue</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#4f46e5">${donationByType.length}</div><div class="muted" style="font-size:11px;text-transform:uppercase">Donation Types</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#3b82f6">${fmtNum(recentDonations.length)}</div><div class="muted" style="font-size:11px;text-transform:uppercase">Recent Donations</div></div>
      </div>
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:16px;margin-bottom:16px">
        <div class="ad-chart">
          <h3 style="font-size:15px;color:#1e293b;margin-bottom:14px">📈 Monthly Revenue (12 months)</h3>
          ${monthlyRevenue.length ? barChart(monthlyRevenue.map(r => ({label: r.label, value: r.total, fmt: fmtMoney})), maxRev, '#16a34a') : '<p class="muted" style="font-size:13px">No revenue data</p>'}
        </div>
        <div class="ad-chart">
          <h3 style="font-size:15px;color:#1e293b;margin-bottom:14px">📊 Revenue by Type</h3>
          ${donationByType.length ? barChart(donationByType.map(r => ({label: r.label, value: r.total, fmt: fmtMoney})), maxType, '#4f46e5') : '<p class="muted" style="font-size:13px">No type data</p>'}
        </div>
      </div>
      <div class="card" style="padding:20px">
        <h3 style="font-size:15px;color:#1e293b;margin-bottom:14px">Recent Donations</h3>
        <div style="overflow-x:auto"><table class="ad-table">
          <thead><tr><th>Date</th><th>Donor</th><th>Amount</th><th>Type</th></tr></thead>
          <tbody>${recentDonations.map(d => `<tr>
            <td>${fmtDate(d.created_at)}</td><td><strong>${esc(d.donor_name || d.name || '—')}</strong></td>
            <td style="font-weight:700;color:#16a34a">${fmtMoney(d.amount)}</td><td class="muted">${esc(d.type || 'General')}</td>
          </tr>`).join('') || '<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:20px">No data</td></tr>'}</tbody>
        </table></div>
      </div>
    </div>`;
    res.send(renderPage('Financial Analytics', html, user, req));
  }));

  // ============================================================
  // ROUTE 4: GET /analytics/attendance — Attendance analytics
  // ============================================================
  app.get('/analytics/attendance', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    let dailyAttendance = [], statusBreakdown = [], weeklyTrend = [];
    try {
      dailyAttendance = (await pool.query(
        `SELECT date, COUNT(*)::int as total, COUNT(*) FILTER (WHERE status IN ('present','late'))::int as present_count, COUNT(*) FILTER (WHERE status='absent')::int as absent_count FROM attendance WHERE tenant_id=$1 AND date > NOW() - INTERVAL '30 days' GROUP BY date ORDER BY date`,
        [tid]
      )).rows;
    } catch(e){
      // fallback to attendance_records
      try {
        dailyAttendance = (await pool.query(
          `SELECT date, COUNT(*)::int as total, COUNT(*) FILTER (WHERE status IN ('present','late'))::int as present_count, COUNT(*) FILTER (WHERE status='absent')::int as absent_count FROM attendance_records WHERE tenant_id=$1 AND date > NOW() - INTERVAL '30 days' GROUP BY date ORDER BY date`,
          [tid]
        )).rows;
      } catch(e2){}
    }

    try {
      statusBreakdown = (await pool.query(
        `SELECT status, COUNT(*)::int as cnt FROM attendance WHERE tenant_id=$1 GROUP BY status ORDER BY cnt DESC`,
        [tid]
      )).rows;
    } catch(e){
      try {
        statusBreakdown = (await pool.query(
          `SELECT status, COUNT(*)::int as cnt FROM attendance_records WHERE tenant_id=$1 GROUP BY status ORDER BY cnt DESC`,
          [tid]
        )).rows;
      } catch(e2){}
    }

    try {
      weeklyTrend = (await pool.query(
        `SELECT to_char(date,'WW/YYYY') as label, COUNT(*)::int as total, COUNT(*) FILTER (WHERE status IN ('present','late'))::int as present_count FROM attendance WHERE tenant_id=$1 AND date > NOW() - INTERVAL '12 weeks' GROUP BY label ORDER BY MIN(date)`,
        [tid]
      )).rows;
    } catch(e){
      try {
        weeklyTrend = (await pool.query(
          `SELECT to_char(date,'WW/YYYY') as label, COUNT(*)::int as total, COUNT(*) FILTER (WHERE status IN ('present','late'))::int as present_count FROM attendance_records WHERE tenant_id=$1 AND date > NOW() - INTERVAL '12 weeks' GROUP BY label ORDER BY MIN(date)`,
          [tid]
        )).rows;
      } catch(e2){}
    }

    const avgRate = dailyAttendance.length > 0 ? Math.round(dailyAttendance.reduce((s, d) => s + (d.total > 0 ? d.present_count / d.total * 100 : 0), 0) / dailyAttendance.length) : 0;
    const maxTotal = Math.max(...dailyAttendance.map(d => d.total), 1);
    const maxWeekTotal = Math.max(...weeklyTrend.map(w => w.total), 1);

    const html = AD_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('attendance')}
      <h1 style="font-size:24px;color:#1e293b;margin-bottom:20px">📅 Attendance Analytics</h1>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;margin-bottom:20px">
        <div class="stat-card"><div class="stat-num" style="color:#16a34a">${avgRate}%</div><div class="muted" style="font-size:11px;text-transform:uppercase">Avg Attendance Rate</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#4f46e5">${dailyAttendance.length}</div><div class="muted" style="font-size:11px;text-transform:uppercase">Days Tracked</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#3b82f6">${statusBreakdown.length}</div><div class="muted" style="font-size:11px;text-transform:uppercase">Status Types</div></div>
      </div>
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:16px;margin-bottom:16px">
        <div class="ad-chart">
          <h3 style="font-size:15px;color:#1e293b;margin-bottom:14px">Weekly Attendance Rate</h3>
          ${weeklyTrend.length ? barChart(weeklyTrend.map(w => ({label: w.label, value: w.total > 0 ? Math.round(w.present_count / w.total * 100) : 0, fmt: v => v + '%'})), 100, '#4f46e5') : '<p class="muted" style="font-size:13px">No weekly data</p>'}
        </div>
        <div class="ad-chart">
          <h3 style="font-size:15px;color:#1e293b;margin-bottom:14px">Status Breakdown</h3>
          ${statusBreakdown.length ? barChart(statusBreakdown, null, '#16a34a') : '<p class="muted" style="font-size:13px">No data</p>'}
        </div>
      </div>
      <div class="card" style="padding:20px">
        <h3 style="font-size:15px;color:#1e293b;margin-bottom:14px">Daily Attendance (Last 30 days)</h3>
        <div style="max-height:400px;overflow-y:auto">
          ${dailyAttendance.map(d => {
            const rate = d.total > 0 ? Math.round(d.present_count / d.total * 100) : 0;
            const color = rate >= 80 ? '#16a34a' : rate >= 50 ? '#f59e0b' : '#dc2626';
            return `<div class="ad-bar-row">
              <span class="ad-bar-label">${fmtDate(d.date)}</span>
              <div class="ad-bar-track">
                <div class="ad-bar-fill" style="width:${rate}%;background:${color}"></div>
                <span class="ad-bar-value">${rate}% (${d.present_count}/${d.total})</span>
              </div>
            </div>`;
          }).join('') || '<p class="muted" style="font-size:13px;padding:20px">No attendance data</p>'}
        </div>
      </div>
    </div>`;
    res.send(renderPage('Attendance Analytics', html, user, req));
  }));

  // ============================================================
  // ROUTE 5: GET /analytics/users — User engagement
  // ============================================================
  app.get('/analytics/users', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    let totalUsers = 0, activeToday = 0, roleBreakdown = [], eventTypeBreakdown = [];
    try { totalUsers = (await pool.query(`SELECT COUNT(*)::int as cnt FROM users WHERE tenant_id=$1`, [tid])).rows[0].cnt; } catch(e){}
    try { activeToday = (await pool.query(`SELECT COUNT(DISTINCT user_email)::int as cnt FROM analytics_events WHERE tenant_id=$1 AND created_at > NOW() - INTERVAL '1 day'`, [tid])).rows[0].cnt; } catch(e){}

    try {
      roleBreakdown = (await pool.query(
        `SELECT COALESCE(role,'user') as label, COUNT(*)::int as cnt FROM users WHERE tenant_id=$1 GROUP BY role ORDER BY cnt DESC`,
        [tid]
      )).rows;
    } catch(e){}

    try {
      eventTypeBreakdown = (await pool.query(
        `SELECT event_type as label, COUNT(*)::int as cnt FROM analytics_events WHERE tenant_id=$1 GROUP BY event_type ORDER BY cnt DESC LIMIT 15`,
        [tid]
      )).rows;
    } catch(e){}

    const maxRole = Math.max(...roleBreakdown.map(r => r.cnt), 1);
    const maxEventType = Math.max(...eventTypeBreakdown.map(r => r.cnt), 1);

    const html = AD_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('users')}
      <h1 style="font-size:24px;color:#1e293b;margin-bottom:20px">👥 User Engagement Analytics</h1>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:20px">
        <div class="stat-card"><div class="stat-num" style="color:#4f46e5">${fmtNum(totalUsers)}</div><div class="muted" style="font-size:11px;text-transform:uppercase">Total Users</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#16a34a">${fmtNum(activeToday)}</div><div class="muted" style="font-size:11px;text-transform:uppercase">Active Today</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#3b82f6">${totalUsers > 0 ? fmtPct(activeToday / totalUsers * 100) : '0%'}</div><div class="muted" style="font-size:11px;text-transform:uppercase">Engagement Rate</div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
        <div class="ad-chart">
          <h3 style="font-size:15px;color:#1e293b;margin-bottom:14px">Users by Role</h3>
          ${roleBreakdown.length ? barChart(roleBreakdown, maxRole, '#4f46e5') : '<p class="muted" style="font-size:13px">No user data</p>'}
        </div>
        <div class="ad-chart">
          <h3 style="font-size:15px;color:#1e293b;margin-bottom:14px">Event Types</h3>
          ${eventTypeBreakdown.length ? barChart(eventTypeBreakdown, maxEventType, '#3b82f6') : '<p class="muted" style="font-size:13px">No event data</p>'}
        </div>
      </div>
      <div class="card" style="padding:20px">
        <h3 style="font-size:15px;color:#1e293b;margin-bottom:14px">Event Type Breakdown</h3>
        <div style="overflow-x:auto"><table class="ad-table">
          <thead><tr><th>Event Type</th><th>Count</th><th>Share</th></tr></thead>
          <tbody>${eventTypeBreakdown.map(e => {
            const total = eventTypeBreakdown.reduce((s, r) => s + r.cnt, 0);
            return `<tr><td><strong>${esc(e.label)}</strong></td><td>${e.cnt}</td><td>${total > 0 ? fmtPct(e.cnt / total * 100) : '0%'}</td></tr>`;
          }).join('') || '<tr><td colspan="3" style="text-align:center;color:#94a3b8;padding:20px">No data</td></tr>'}</tbody>
        </table></div>
      </div>
    </div>`;
    res.send(renderPage('User Engagement', html, user, req));
  }));

  // ============================================================
  // ROUTE 6: GET /analytics/export — Export as CSV
  // ============================================================
  app.get('/analytics/export', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { type } = req.query;
    const exportType = type || 'summary';

    let csv = '', filename = 'analytics-export.csv';

    if (exportType === 'donations') {
      try {
        const rows = (await pool.query(`SELECT * FROM donations WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 5000`, [tid])).rows;
        csv = 'Date,Donor,Amount,Type,Created\n' + rows.map(r =>
          `"${fmtDate(r.created_at)}","${(r.donor_name || r.name || '').replace(/"/g,'""')}","${r.amount}","${r.type || ''}","${fmtDateTime(r.created_at)}"`
        ).join('\n');
        filename = 'donations-export.csv';
      } catch(e) { csv = 'Error generating donation export'; }
    } else if (exportType === 'attendance') {
      try {
        const rows = (await pool.query(`SELECT * FROM attendance WHERE tenant_id=$1 ORDER BY date DESC LIMIT 5000`, [tid])).rows;
        csv = 'Date,Student,Status,Created\n' + rows.map(r =>
          `"${fmtDate(r.date)}","${(r.student_name || '').replace(/"/g,'""')}","${r.status || ''}","${fmtDateTime(r.created_at)}"`
        ).join('\n');
        filename = 'attendance-export.csv';
      } catch(e) { csv = 'Error generating attendance export'; }
    } else if (exportType === 'events') {
      try {
        const rows = (await pool.query(`SELECT * FROM analytics_events WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 5000`, [tid])).rows;
        csv = 'Date,Event Type,Entity,User\n' + rows.map(r =>
          `"${fmtDateTime(r.created_at)}","${(r.event_type || '').replace(/"/g,'""')}","${(r.entity_type || '').replace(/"/g,'""')}","${(r.user_email || '').replace(/"/g,'""')}"`
        ).join('\n');
        filename = 'events-export.csv';
      } catch(e) { csv = 'Error generating events export'; }
    } else {
      // Summary export
      let totalDonations = 0, totalStudents = 0, totalEvents = 0;
      try { totalDonations = (await pool.query(`SELECT COALESCE(SUM(amount),0)::numeric as total FROM donations WHERE tenant_id=$1`, [tid])).rows[0].total; } catch(e){}
      try { totalStudents = (await pool.query(`SELECT COUNT(*)::int as cnt FROM students WHERE tenant_id=$1`, [tid])).rows[0].cnt; } catch(e){}
      try { totalEvents = (await pool.query(`SELECT COUNT(*)::int as cnt FROM analytics_events WHERE tenant_id=$1`, [tid])).rows[0].cnt; } catch(e){}
      csv = 'Metric,Value\nTotal Students,' + totalStudents + '\nTotal Donation Revenue,' + totalDonations + '\nTotal Events Tracked,' + totalEvents + '\nExport Date,' + today();
      filename = 'analytics-summary.csv';
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  }));

  // ============================================================
  // ROUTE 7: GET /analytics/api/kpis — JSON KPI API
  // ============================================================
  app.get('/analytics/api/kpis', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    let students = 0, members = 0, donations30 = 0, donationsTotal = 0, events30 = 0, activeUsers = 0;
    try { students = (await pool.query(`SELECT COUNT(*)::int as cnt FROM students WHERE tenant_id=$1`, [tid])).rows[0].cnt; } catch(e){}
    try { members = (await pool.query(`SELECT COUNT(*)::int as cnt FROM church_members WHERE tenant_id=$1`, [tid])).rows[0].cnt; } catch(e){}
    try { donations30 = (await pool.query(`SELECT COALESCE(SUM(amount),0)::numeric as total FROM donations WHERE tenant_id=$1 AND created_at > NOW() - INTERVAL '30 days'`, [tid])).rows[0].total; } catch(e){}
    try { donationsTotal = (await pool.query(`SELECT COALESCE(SUM(amount),0)::numeric as total FROM donations WHERE tenant_id=$1`, [tid])).rows[0].total; } catch(e){}
    try { events30 = (await pool.query(`SELECT COUNT(*)::int as cnt FROM analytics_events WHERE tenant_id=$1 AND created_at > NOW() - INTERVAL '30 days'`, [tid])).rows[0].cnt; } catch(e){}
    try { activeUsers = (await pool.query(`SELECT COUNT(DISTINCT user_email)::int as cnt FROM analytics_events WHERE tenant_id=$1 AND created_at > NOW() - INTERVAL '1 day'`, [tid])).rows[0].cnt; } catch(e){}

    res.json({
      timestamp: new Date().toISOString(),
      tenant_id: tid,
      kpis: {
        total_students: students,
        total_members: members,
        total_people: students + members,
        donations_last_30_days: Number(donations30),
        donations_total: Number(donationsTotal),
        events_last_30_days: events30,
        active_users_today: activeUsers,
      }
    });
  }));

  // ============================================================
  // ROUTE 8: GET /analytics/api/trends — JSON Trends API
  // ============================================================
  app.get('/analytics/api/trends', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { metric, months } = req.query;
    const numMonths = parseInt(months) || 6;
    const metricName = metric || 'revenue';

    let data = [];
    try {
      if (metricName === 'revenue') {
        data = (await pool.query(
          `SELECT to_char(created_at,'Mon YYYY') as period, COALESCE(SUM(amount),0)::numeric as value FROM donations WHERE tenant_id=$1 AND created_at > NOW() - INTERVAL '${numMonths} months' GROUP BY period ORDER BY MIN(created_at)`,
          [tid]
        )).rows;
      } else if (metricName === 'events') {
        data = (await pool.query(
          `SELECT to_char(created_at,'Mon YYYY') as period, COUNT(*)::int as value FROM analytics_events WHERE tenant_id=$1 AND created_at > NOW() - INTERVAL '${numMonths} months' GROUP BY period ORDER BY MIN(created_at)`,
          [tid]
        )).rows;
      } else if (metricName === 'attendance') {
        data = (await pool.query(
          `SELECT to_char(date,'Mon YYYY') as period, COUNT(*)::int as value FROM attendance WHERE tenant_id=$1 AND date > NOW() - INTERVAL '${numMonths} months' GROUP BY period ORDER BY MIN(date)`,
          [tid]
        )).rows;
      } else {
        // Snapshots
        data = (await pool.query(
          `SELECT snapshot_date as period, metric_value as value, metric_name, dimensions FROM analytics_snapshots WHERE tenant_id=$1 AND metric_name=$2 ORDER BY snapshot_date`,
          [tid, metricName]
        )).rows;
      }
    } catch(e){}

    res.json({
      metric: metricName,
      months: numMonths,
      data: data.map(d => ({ period: d.period, value: Number(d.value) })),
    });
  }));

};
