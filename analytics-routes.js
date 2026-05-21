/**
 * Analytics — KPI dashboards + exports
 * Comfort Zone SaaS Platform
 */
module.exports = function(app, pool, opts) {
  const esc = (opts && opts.esc) || (s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'));
  const renderPage = (opts && opts.renderPage) || ((t,c,u) => c);
  const ah = (opts && opts.ah) || (fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(e => res.status(500).send('Error: '+e.message)));
  const requireAuth = (opts && opts.requireAuth) || ((req,res,next) => { if(!req.session?.user) return res.redirect('/login'); next(); });
  const audit = (opts && opts.audit) || (() => {});
  const tenantId = (req) => req.session?.user?.tenant_id || 0;

  /* ── DB Migration ── */
  async function migrate() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS analytics_events (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 0,
        user_id INTEGER DEFAULT NULL,
        event_name VARCHAR(100) NOT NULL,
        properties JSONB DEFAULT '{}',
        session_id VARCHAR(255),
        ip_address VARCHAR(45),
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_ae_tenant ON analytics_events(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_ae_event ON analytics_events(tenant_id, event_name);
      CREATE INDEX IF NOT EXISTS idx_ae_created ON analytics_events(tenant_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_ae_user ON analytics_events(tenant_id, user_id);
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS analytics_daily (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 0,
        date DATE NOT NULL,
        metric_name VARCHAR(100) NOT NULL,
        value NUMERIC(15,2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(tenant_id, date, metric_name)
      );
      CREATE INDEX IF NOT EXISTS idx_ad_tenant ON analytics_daily(tenant_id, date);
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS analytics_funnels (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 0,
        name VARCHAR(255) NOT NULL,
        steps JSONB DEFAULT '[]',
        created_by INTEGER,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_af_tenant ON analytics_funnels(tenant_id);
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS analytics_saved_reports (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 0,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        config JSONB DEFAULT '{}',
        created_by INTEGER,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_asr_tenant ON analytics_saved_reports(tenant_id);
    `);
  }
  migrate().then(() => console.log('[analytics] migration done')).catch(e => console.error('[analytics] migration error:', e));

  /* ── Helpers ── */
  function chartPage(title, body, req) {
    const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — Comfort Zone</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f0f2f5;color:#1a1a2e}
.topbar{background:linear-gradient(135deg,#f093fb 0%,#f5576c 100%);color:#fff;padding:16px 24px;display:flex;align-items:center;justify-content:space-between}
.topbar h1{font-size:20px;font-weight:600}
.topbar a{color:#ddd;text-decoration:none;font-size:14px}
.container{max-width:1200px;margin:24px auto;padding:0 16px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px}
.stat-card{background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.stat-card h3{font-size:12px;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px}
.stat-card .val{font-size:28px;font-weight:700;color:#f5576c}
.stat-card .sub{font-size:13px;color:#999;margin-top:4px}
.stat-card .up{color:#28a745} .stat-card .down{color:#dc3545}
.card{background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.08);margin-bottom:16px}
.card h2{font-size:18px;margin-bottom:12px;color:#333}
table{width:100%;border-collapse:collapse}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid #eee;font-size:14px}
th{background:#f8f9fa;color:#555;font-weight:600;text-transform:uppercase;font-size:11px;letter-spacing:.3px}
.badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600}
.btn{display:inline-block;padding:8px 18px;border-radius:8px;font-size:14px;font-weight:600;text-decoration:none;cursor:pointer;border:none;transition:all .2s}
.btn-primary{background:#f5576c;color:#fff}.btn-primary:hover{background:#e04a60}
.btn-success{background:#28a745;color:#fff}.btn-success:hover{background:#218838}
.btn-outline{background:transparent;border:1px solid #ddd;color:#333}.btn-outline:hover{background:#f8f9fa}
.btn-sm{padding:5px 12px;font-size:12px}
nav.sub{display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap}
nav.sub a{padding:8px 16px;background:#fff;border-radius:8px;text-decoration:none;color:#333;font-size:14px;font-weight:500;transition:all .2s}
nav.sub a:hover,nav.sub a.active{background:#f5576c;color:#fff}
.chart-bar{display:flex;align-items:end;gap:6px;height:180px;padding:8px 0}
.chart-bar .bar{flex:1;background:linear-gradient(to top,#f093fb,#f5576c);border-radius:4px 4px 0 0;min-width:20px;transition:height .3s;position:relative}
.chart-bar .bar .lbl{position:absolute;bottom:-20px;left:50%;transform:translateX(-50%);font-size:10px;color:#888;white-space:nowrap}
.chart-bar .bar .val{position:absolute;top:-18px;left:50%;transform:translateX(-50%);font-size:11px;font-weight:600;color:#333}
.empty{text-align:center;padding:40px;color:#999}
.form-group{margin-bottom:16px}
.form-group label{display:block;font-weight:600;margin-bottom:4px;font-size:14px;color:#444}
.form-group input,.form-group select,.form-group textarea{width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:8px;font-size:14px}
.metric-row{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #f0f0f0}
.metric-row:last-child{border:none}
</style></head>
<body>
<div class="topbar"><h1>📊 Analytics</h1><a href="/">← Dashboard</a></div>
<div class="container">
<nav class="sub">
<a href="/analytics" class="active">Overview</a>
<a href="/analytics/users">Users</a>
<a href="/analytics/revenue">Revenue</a>
<a href="/analytics/engagement">Engagement</a>
<a href="/analytics/funnels">Funnels</a>
<a href="/analytics/reports">Reports</a>
</nav>
${body}
</div></body></html>`;
    return renderPage('analytics', html, req);
  }

  function fmtNum(n) { return (n || 0).toLocaleString(); }
  function pctChange(curr, prev) {
    if (!prev) return { cls: 'up', text: '—' };
    const p = ((curr - prev) / prev * 100).toFixed(1);
    return { cls: p >= 0 ? 'up' : 'down', text: (p >= 0 ? '+' : '') + p + '%' };
  }

  /* ── GET /analytics ── */
  app.get('/analytics', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const [dayEvents] = await pool.query(
      'SELECT COUNT(*) AS c FROM analytics_events WHERE tenant_id=? AND created_at >= CURDATE()', [tid]);
    const [weekEvents] = await pool.query(
      'SELECT COUNT(*) AS c FROM analytics_events WHERE tenant_id=? AND created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)', [tid]);
    const [totalEvents] = await pool.query(
      'SELECT COUNT(*) AS c FROM analytics_events WHERE tenant_id=?', [tid]);
    const [uniqueUsers] = await pool.query(
      'SELECT COUNT(DISTINCT user_id) AS c FROM analytics_events WHERE tenant_id=? AND created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)', [tid]);
    const [topEvents] = await pool.query(
      'SELECT event_name, COUNT(*) AS c FROM analytics_events WHERE tenant_id=? AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) GROUP BY event_name ORDER BY c DESC LIMIT 8', [tid]);
    const [dailyTrend] = await pool.query(
      `SELECT DATE(created_at) AS day, COUNT(*) AS c FROM analytics_events WHERE tenant_id=? AND created_at >= DATE_SUB(CURDATE(), INTERVAL 14 DAY) GROUP BY DATE(created_at) ORDER BY day`, [tid]);
    const maxTrend = dailyTrend.reduce((m, d) => Math.max(m, d.c), 1);

    res.send(chartPage('Analytics Dashboard', `
<div class="stats">
  <div class="stat-card"><h3>Today's Events</h3><div class="val">${fmtNum(dayEvents[0].c)}</div><div class="sub">Real-time tracking</div></div>
  <div class="stat-card"><h3>This Week</h3><div class="val">${fmtNum(weekEvents[0].c)}</div><div class="sub">Last 7 days</div></div>
  <div class="stat-card"><h3>Total Events</h3><div class="val">${fmtNum(totalEvents[0].c)}</div><div class="sub">All time</div></div>
  <div class="stat-card"><h3>Active Users (30d)</h3><div class="val">${fmtNum(uniqueUsers[0].c)}</div><div class="sub">Unique users</div></div>
</div>
<div style="display:flex;gap:16px;margin-bottom:16px">
  <a href="/analytics/realtime" class="btn btn-primary">⚡ Realtime</a>
  <a href="/analytics/export" class="btn btn-outline">📥 Export</a>
  <a href="/analytics/reports" class="btn btn-outline">📋 Saved Reports</a>
</div>
<div class="card"><h2>14-Day Event Trend</h2>
<div class="chart-bar">${dailyTrend.map(d => {
  const h = Math.max(4, (d.c / maxTrend) * 160);
  return `<div class="bar" style="height:${h}px"><span class="val">${d.c}</span><span class="lbl">${d.day ? new Date(d.day).toLocaleDateString('en', { month: 'short', day: 'numeric' }) : ''}</span></div>`;
}).join('')}</div></div>
<div class="card"><h2>Top Events (7 days)</h2>
<table><thead><tr><th>Event</th><th>Count</th><th>Share</th></tr></thead><tbody>
${topEvents.map(e => { const pct = weekEvents[0].c ? (e.c / weekEvents[0].c * 100).toFixed(1) : '0.0'; return `<tr><td>${esc(e.event_name)}</td><td><strong>${fmtNum(e.c)}</strong></td><td>${pct}%</td></tr>`; }).join('')}
</tbody></table></div>`, req));
  }));

  /* ── GET /analytics/overview ── */
  app.get('/analytics/overview', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const [daily] = await pool.query(
      `SELECT metric_name, SUM(value) AS total FROM analytics_daily WHERE tenant_id=? AND date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) GROUP BY metric_name`, [tid]);
    const metrics = {};
    daily.forEach(d => { metrics[d.metric_name] = parseFloat(d.total) || 0; });
    res.json({
      period: '30d',
      metrics,
      users: metrics.total_users || 0,
      revenue: metrics.revenue || 0,
      sessions: metrics.sessions || 0,
      pageViews: metrics.page_views || 0,
      engagement: metrics.engagement_rate || 0
    });
  }));

  /* ── GET /analytics/users ── */
  app.get('/analytics/users', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const [dailyUsers] = await pool.query(
      `SELECT DATE(created_at) AS day, COUNT(DISTINCT user_id) AS users FROM analytics_events WHERE tenant_id=? AND user_id IS NOT NULL AND created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) GROUP BY DATE(created_at) ORDER BY day`, [tid]);
    const [retention] = await pool.query(
      `SELECT COUNT(DISTINCT session_id) AS sessions, COUNT(DISTINCT user_id) AS users FROM analytics_events WHERE tenant_id=? AND created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)`, [tid]);
    const [cohorts] = await pool.query(
      `SELECT DATE(created_at) AS cohort_day, COUNT(DISTINCT user_id) AS new_users FROM analytics_events WHERE tenant_id=? AND user_id IS NOT NULL AND created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) GROUP BY DATE(created_at) ORDER BY cohort_day DESC LIMIT 10`, [tid]);
    const maxUsers = dailyUsers.reduce((m, d) => Math.max(m, d.users), 1);

    res.send(chartPage('User Analytics', `
<div class="stats">
  <div class="stat-card"><h3>Sessions (7d)</h3><div class="val">${fmtNum(retention[0].sessions)}</div></div>
  <div class="stat-card"><h3>Unique Users (7d)</h3><div class="val">${fmtNum(retention[0].users)}</div></div>
  <div class="stat-card"><h3>Sessions/User</h3><div class="val">${retention[0].users ? (retention[0].sessions / retention[0].users).toFixed(1) : '0'}</div></div>
</div>
<div class="card"><h2>User Growth (30d)</h2>
<div class="chart-bar">${dailyUsers.map(d => {
  const h = Math.max(4, (d.users / maxUsers) * 160);
  return `<div class="bar" style="height:${h}px;background:linear-gradient(to top,#a18cd1,#fbc2eb)"><span class="val">${d.users}</span><span class="lbl">${d.day ? new Date(d.day).toLocaleDateString('en', { month: 'short', day: 'numeric' }) : ''}</span></div>`;
}).join('')}</div></div>
<div class="card"><h2>User Cohorts</h2>
<table><thead><tr><th>Cohort Date</th><th>New Users</th></tr></thead><tbody>
${cohorts.map(c => `<tr><td>${c.cohort_day}</td><td><strong>${c.new_users}</strong></td></tr>`).join('')}
</tbody></table></div>`, req));
  }));

  /* ── GET /analytics/revenue ── */
  app.get('/analytics/revenue', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const [mrrData] = await pool.query(
      `SELECT SUM(CASE WHEN date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) THEN value ELSE 0 END) AS mrr,
              SUM(CASE WHEN date >= DATE_SUB(CURDATE(), INTERVAL 365 DAY) THEN value ELSE 0 END) AS arr
       FROM analytics_daily WHERE tenant_id=? AND metric_name='revenue'`, [tid]);
    const [monthlyRev] = await pool.query(
      `SELECT DATE_FORMAT(date, '%Y-%m') AS month, SUM(value) AS total FROM analytics_daily WHERE tenant_id=? AND metric_name='revenue' AND date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH) GROUP BY DATE_FORMAT(date, '%Y-%m') ORDER BY month`, [tid]);
    const [churn] = await pool.query(
      `SELECT value FROM analytics_daily WHERE tenant_id=? AND metric_name='churn_rate' ORDER BY date DESC LIMIT 1`, [tid]);
    const maxRev = monthlyRev.reduce((m, d) => Math.max(m, parseFloat(d.total) || 0), 1);

    res.send(chartPage('Revenue Analytics', `
<div class="stats">
  <div class="stat-card"><h3>Monthly Recurring Revenue</h3><div class="val">$${fmtNum(Math.round(mrrData[0].mrr || 0))}</div></div>
  <div class="stat-card"><h3>Annual Run Rate</h3><div class="val">$${fmtNum(Math.round(mrrData[0].arr || 0))}</div></div>
  <div class="stat-card"><h3>Churn Rate</h3><div class="val">${(churn[0]?.value || 0).toFixed(1)}%</div></div>
</div>
<div class="card"><h2>Monthly Revenue (12 months)</h2>
<div class="chart-bar">${monthlyRev.map(d => {
  const v = parseFloat(d.total) || 0;
  const h = Math.max(4, (v / maxRev) * 160);
  return `<div class="bar" style="height:${h}px;background:linear-gradient(to top,#4facfe,#00f2fe)"><span class="val">$${Math.round(v).toLocaleString()}</span><span class="lbl">${d.month}</span></div>`;
}).join('')}</div></div>`, req));
  }));

  /* ── GET /analytics/engagement ── */
  app.get('/analytics/engagement', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const [sessions] = await pool.query(
      `SELECT DATE(created_at) AS day, COUNT(DISTINCT session_id) AS sessions, COUNT(*) AS events FROM analytics_events WHERE tenant_id=? AND created_at >= DATE_SUB(CURDATE(), INTERVAL 14 DAY) GROUP BY DATE(created_at) ORDER BY day`, [tid]);
    const [topPages] = await pool.query(
      `SELECT properties->>'$.page' AS page, COUNT(*) AS views FROM analytics_events WHERE tenant_id=? AND event_name='page_view' AND created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) AND properties->>'$.page' IS NOT NULL GROUP BY properties->>'$.page' ORDER BY views DESC LIMIT 10`, [tid]);
    const [actions] = await pool.query(
      `SELECT event_name, COUNT(*) AS c FROM analytics_events WHERE tenant_id=? AND created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) AND event_name NOT IN ('page_view','session_start') GROUP BY event_name ORDER BY c DESC LIMIT 8`, [tid]);
    const maxSess = sessions.reduce((m, d) => Math.max(m, d.sessions), 1);

    res.send(chartPage('Engagement Metrics', `
<div class="stats">
  <div class="stat-card"><h3>Avg Sessions/Day</h3><div class="val">${fmtNum(Math.round(sessions.reduce((s,d) => s + d.sessions, 0) / Math.max(sessions.length, 1)))}</div></div>
  <div class="stat-card"><h3>Avg Events/Day</h3><div class="val">${fmtNum(Math.round(sessions.reduce((s,d) => s + d.events, 0) / Math.max(sessions.length, 1)))}</div></div>
  <div class="stat-card"><h3>Events/Session</h3><div class="val">${(sessions.reduce((s,d) => s + d.events, 0) / Math.max(sessions.reduce((s,d) => s + d.sessions, 0), 1)).toFixed(1)}</div></div>
</div>
<div class="card"><h2>Sessions (14d)</h2>
<div class="chart-bar">${sessions.map(d => {
  const h = Math.max(4, (d.sessions / maxSess) * 160);
  return `<div class="bar" style="height:${h}px;background:linear-gradient(to top,#43e97b,#38f9d7)"><span class="val">${d.sessions}</span><span class="lbl">${d.day ? new Date(d.day).toLocaleDateString('en', { month: 'short', day: 'numeric' }) : ''}</span></div>`;
}).join('')}</div></div>
<div class="card"><h2>Top Actions</h2>
<table><thead><tr><th>Action</th><th>Count</th></tr></thead><tbody>
${actions.map(a => `<tr><td>${esc(a.event_name)}</td><td><strong>${fmtNum(a.c)}</strong></td></tr>`).join('')}
</tbody></table></div>`, req));
  }));

  /* ── GET /analytics/funnels ── */
  app.get('/analytics/funnels', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const [funnels] = await pool.query('SELECT * FROM analytics_funnels WHERE tenant_id=? ORDER BY created_at DESC', [tid]);
    const html = `
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
  <h2>Conversion Funnels</h2>
  <button onclick="document.getElementById('addFunnel').style.display='block'" class="btn btn-primary">+ New Funnel</button>
</div>
<div id="addFunnel" class="card" style="display:none;margin-bottom:16px">
  <h2>Create Funnel</h2>
  <form method="POST" action="/analytics/funnels">
    <div class="form-group"><label>Funnel Name</label><input name="name" required placeholder="e.g., Signup Conversion"></div>
    <div class="form-group"><label>Steps (JSON array of event names)</label>
      <textarea name="steps" rows="3" placeholder='["page_view","signup_start","signup_complete","payment"]'></textarea>
    </div>
    <button type="submit" class="btn btn-success">Create</button>
  </form>
</div>
${funnels.length ? funnels.map(f => {
  const steps = Array.isArray(f.steps) ? f.steps : (typeof f.steps === 'string' ? JSON.parse(f.steps || '[]') : []);
  return `<div class="card"><h2>${esc(f.name)}</h2>
  <div style="display:flex;flex-direction:column;gap:4px;margin-top:12px">
    ${steps.map((s, i) => {
      const w = Math.max(20, 100 - (i * 25));
      return `<div style="background:linear-gradient(90deg,#f093fb,#f5576c);width:${w}%;padding:10px 16px;border-radius:8px;color:#fff;font-weight:600;font-size:14px">
        Step ${i + 1}: ${esc(typeof s === 'string' ? s : s.name || JSON.stringify(s))}
        <span style="float:right;opacity:.8">${i === 0 ? '100%' : (100 - i * 25) + '%'}</span>
      </div>`;
    }).join('')}
  </div></div>`;
}).join('') : '<div class="card"><div class="empty">No funnels defined yet. Create one to track conversions.</div></div>'}`;
    res.send(chartPage('Conversion Funnels', html, req));
  }));

  app.post('/analytics/funnels', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    let steps = [];
    try { steps = JSON.parse(req.body.steps || '[]'); } catch (e) { /* ignore */ }
    await pool.query(
      'INSERT INTO analytics_funnels (tenant_id, name, steps, created_by) VALUES (?, ?, ?, ?)',
      [tid, req.body.name, JSON.stringify(steps), req.session.user.id]);
    res.redirect('/analytics/funnels?msg=Funnel+created');
  }));

  /* ── GET /analytics/realtime ── */
  app.get('/analytics/realtime', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const [recent] = await pool.query(
      'SELECT COUNT(DISTINCT session_id) AS active_sessions, COUNT(DISTINCT user_id) AS active_users, COUNT(*) AS events_last_5min FROM analytics_events WHERE tenant_id=? AND created_at >= DATE_SUB(NOW(), INTERVAL 5 MINUTE)', [tid]);
    const [live] = await pool.query(
      'SELECT event_name, properties, created_at FROM analytics_events WHERE tenant_id=? ORDER BY created_at DESC LIMIT 20', [tid]);
    const html = `
<div class="stats">
  <div class="stat-card"><h3>Active Sessions (5m)</h3><div class="val">${recent[0].active_sessions}</div></div>
  <div class="stat-card"><h3>Active Users (5m)</h3><div class="val">${recent[0].active_users}</div></div>
  <div class="stat-card"><h3>Events (5m)</h3><div class="val">${recent[0].events_last_5min}</div></div>
</div>
<div class="card"><h2>Live Event Stream</h2>
<div style="font-family:monospace;font-size:13px;max-height:400px;overflow-y:auto">
${live.map(e => `<div style="padding:6px 0;border-bottom:1px solid #f0f0f0">
  <span style="color:#888">${new Date(e.created_at).toLocaleTimeString()}</span>
  <span style="color:#f5576c;font-weight:600;margin:0 8px">${esc(e.event_name)}</span>
  <span style="color:#666">${esc(JSON.stringify(e.properties || {}).substring(0, 100))}</span>
</div>`).join('')}
</div></div>
<meta http-equiv="refresh" content="10">`;
    res.send(chartPage('Realtime', html, req));
  }));

  /* ── GET /analytics/export ── */
  app.get('/analytics/export', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const format = req.query.format || 'csv';
    const [events] = await pool.query(
      'SELECT event_name, user_id, session_id, properties, created_at FROM analytics_events WHERE tenant_id=? AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) ORDER BY created_at DESC LIMIT 10000', [tid]);

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename="analytics-export.json"');
      return res.json(events);
    }
    // CSV
    const header = 'event_name,user_id,session_id,created_at\n';
    const rows = events.map(e => `"${e.event_name}",${e.user_id||''},${e.session_id||''},"${e.created_at.toISOString()}"`).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="analytics-export.csv"');
    res.send(header + rows);
  }));

  /* ── GET /analytics/reports ── */
  app.get('/analytics/reports', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const [reports] = await pool.query('SELECT * FROM analytics_saved_reports WHERE tenant_id=? ORDER BY created_at DESC', [tid]);
    const html = `
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
  <h2>Saved Reports</h2>
  <button onclick="document.getElementById('addReport').style.display='block'" class="btn btn-primary">+ New Report</button>
</div>
<div id="addReport" class="card" style="display:none;margin-bottom:16px">
  <form method="POST" action="/analytics/reports">
    <div class="form-group"><label>Report Name</label><input name="name" required></div>
    <div class="form-group"><label>Description</label><textarea name="description" rows="2"></textarea></div>
    <div class="form-group"><label>Config (JSON)</label>
      <textarea name="config" rows="3" placeholder='{"metrics":["revenue","users"],"period":"30d"}'></textarea>
    </div>
    <button type="submit" class="btn btn-success">Save Report</button>
  </form>
</div>
${reports.length ? `<div class="card"><table><thead><tr><th>Name</th><th>Description</th><th>Created</th><th>Actions</th></tr></thead><tbody>
${reports.map(r => `<tr><td><strong>${esc(r.name)}</strong></td><td>${esc(r.description||'')}</td><td>${new Date(r.created_at).toLocaleDateString()}</td>
<td><a href="/analytics/reports/${r.id}" class="btn btn-sm btn-primary">View</a></td></tr>`).join('')}
</tbody></table></div>` : '<div class="card"><div class="empty">No saved reports</div></div>'}`;
    res.send(chartPage('Saved Reports', html, req));
  }));

  /* ── POST /analytics/reports ── */
  app.post('/analytics/reports', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    let config = {};
    try { config = JSON.parse(req.body.config || '{}'); } catch (e) { /* ignore */ }
    await pool.query(
      'INSERT INTO analytics_saved_reports (tenant_id, name, description, config, created_by) VALUES (?,?,?,?,?)',
      [tid, req.body.name, req.body.description || '', JSON.stringify(config), req.session.user.id]);
    res.redirect('/analytics/reports?msg=Report+saved');
  }));

  /* ── GET /analytics/reports/:id ── */
  app.get('/analytics/reports/:id', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const [reports] = await pool.query('SELECT * FROM analytics_saved_reports WHERE id=? AND tenant_id=?', [req.params.id, tid]);
    if (!reports.length) return res.redirect('/analytics/reports');
    const report = reports[0];
    const config = typeof report.config === 'string' ? JSON.parse(report.config || '{}') : (report.config || {});

    // Fetch data based on report config
    const metrics = config.metrics || ['sessions', 'page_views'];
    const period = config.period || '30d';
    const daysMap = { '7d': 7, '30d': 30, '90d': 90, '365d': 365 };
    const days = daysMap[period] || 30;

    const [data] = await pool.query(
      `SELECT metric_name, SUM(value) AS total FROM analytics_daily WHERE tenant_id=? AND date >= DATE_SUB(CURDATE(), INTERVAL ? DAY) AND metric_name IN (?) GROUP BY metric_name`,
      [tid, days, metrics]);
    const metricsObj = {};
    data.forEach(d => { metricsObj[d.metric_name] = parseFloat(d.total) || 0; });

    const html = `
<div class="card"><h2>${esc(report.name)}</h2>
<p style="color:#666;margin-bottom:16px">${esc(report.description || '')} — Period: ${esc(period)}</p>
<div class="stats">
${metrics.map(m => `<div class="stat-card"><h3>${esc(m)}</h3><div class="val">${fmtNum(metricsObj[m] || 0)}</div></div>`).join('')}
</div></div>
<a href="/analytics/reports" class="btn btn-outline">← Back to Reports</a>`;
    res.send(chartPage('Report: ' + report.name, html, req));
  }));

  console.log('[analytics] 4 tables, 11 routes registered');
};
