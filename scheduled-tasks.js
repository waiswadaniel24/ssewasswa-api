'use strict';

module.exports = function(app, pool, opts) {
  const esc = opts.esc;
  const ah = opts.ah || ((fn) => async (req, res, next) => { try { await fn(req, res, next); } catch (e) { res.status(500).json({ error: e.message }); } });
  const requireAuth = opts.requireAuth || ((req, res, next) => { if (!req.session?.user) return res.redirect('/login'); next(); });
  const audit = opts.audit || (() => {});
  const schoolId = (req) => req.session?.user?.school_id || 1;

  // ── Color palette ────────────────────────────────────────────────────────
  const C = {
    primary: '#3b82f6', primaryDark: '#2563eb', primaryLight: '#60a5fa',
    green: '#22c55e', greenDark: '#16a34a', yellow: '#eab308', yellowDark: '#ca8a04',
    red: '#ef4444', redDark: '#dc2626', gray: '#6b7280', grayLight: '#9ca3af',
    bg: '#0f172a', bgCard: '#1e293b', bgCardHover: '#334155',
    border: '#334155', text: '#f1f5f9', textMuted: '#94a3b8', textDim: '#64748b'
  };

  // ── Database Migrations ──────────────────────────────────────────────────
  async function migrate() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS scheduled_tasks (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        cron_expression TEXT,
        task_type TEXT DEFAULT 'custom',
        handler_path TEXT,
        payload JSONB,
        is_active BOOLEAN DEFAULT true,
        last_run_at TIMESTAMPTZ,
        next_run_at TIMESTAMPTZ,
        run_count INT DEFAULT 0,
        fail_count INT DEFAULT 0,
        last_error TEXT,
        timeout_seconds INT DEFAULT 300,
        retry_limit INT DEFAULT 3,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ,
        school_id INT DEFAULT 1
      )`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS task_execution_logs (
        id SERIAL PRIMARY KEY,
        task_id INT REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
        status TEXT DEFAULT 'running',
        started_at TIMESTAMPTZ DEFAULT NOW(),
        finished_at TIMESTAMPTZ,
        duration_ms INT,
        output TEXT,
        error TEXT,
        trigger_type TEXT DEFAULT 'scheduled',
        school_id INT DEFAULT 1
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS st_school_active ON scheduled_tasks(school_id, is_active)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS st_next_run ON scheduled_tasks(next_run_at) WHERE is_active = true`);
    await pool.query(`CREATE INDEX IF NOT EXISTS tel_task_id ON task_execution_logs(task_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS tel_school_started ON task_execution_logs(school_id, started_at DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS tel_status ON task_execution_logs(status, started_at DESC)`);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  function timeAgo(dt) {
    if (!dt) return 'never';
    const diff = Date.now() - new Date(dt).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ${m % 60}m ago`;
    const d = Math.floor(h / 24);
    return `${d}d ago`;
  }

  function fmtDuration(ms) {
    if (!ms) return '-';
    if (ms < 1000) return `${ms}ms`;
    const s = (ms / 1000).toFixed(1);
    if (ms < 60000) return `${s}s`;
    const m = Math.floor(ms / 60000);
    return `${m}m ${Math.round((ms % 60000) / 1000)}s`;
  }

  function fmtDate(dt) {
    if (!dt) return '-';
    return new Date(dt).toLocaleString();
  }

  function badge(text, color) {
    const c = color || C.gray;
    return `<span style="display:inline-block;padding:3px 10px;border-radius:99px;font-size:.72rem;font-weight:600;color:#fff;background:${c};white-space:nowrap">${esc(String(text))}</span>`;
  }

  function statusBadge(status) {
    const map = { running: C.primary, success: C.green, failed: C.red, timeout: C.yellow, cancelled: C.gray };
    return badge(status, map[status] || C.gray);
  }

  function toggleBadge(active) {
    return badge(active ? 'Active' : 'Inactive', active ? C.green : C.gray);
  }

  // ── SVG Chart Generators ─────────────────────────────────────────────────
  function svgTimelineChart(data, w = 700, h = 160) {
    if (!data || !data.length) {
      return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
        <rect width="${w}" height="${h}" rx="8" fill="${C.bgCard}"/>
        <text x="${w / 2}" y="${h / 2}" text-anchor="middle" fill="${C.textDim}" font-size="13">No execution data</text></svg>`;
    }
    const pad = { t: 20, r: 16, b: 32, l: 50 };
    const chartW = w - pad.l - pad.r;
    const chartH = h - pad.t - pad.b;
    const maxVal = Math.max(...data.map(d => d.value), 1);
    const barW = Math.max(4, Math.min(20, (chartW / data.length) - 2));
    const gap = chartW / data.length;

    let bars = '';
    let labels = '';
    let gridLines = '';
    const colorMap = { success: C.green, failed: C.red, running: C.primary, timeout: C.yellow };

    // Y-axis grid lines
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + (i / 4) * chartH;
      const val = Math.round(maxVal - (i / 4) * maxVal);
      gridLines += `<line x1="${pad.l}" y1="${y}" x2="${w - pad.r}" y2="${y}" stroke="${C.border}" stroke-width="0.5" stroke-dasharray="3,3"/>`;
      gridLines += `<text x="${pad.l - 8}" y="${y + 4}" text-anchor="end" font-size="10" fill="${C.textDim}">${val}</text>`;
    }

    data.forEach((d, i) => {
      const barH = Math.max(2, (d.value / maxVal) * chartH);
      const x = pad.l + i * gap + (gap - barW) / 2;
      const y = pad.t + chartH - barH;
      const color = colorMap[d.status] || C.primary;
      bars += `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" rx="3" fill="${color}" opacity="0.85">
        <title>${esc(d.label || '')}: ${d.value}${d.unit || ''} (${d.status})</title></rect>`;
      // X-axis labels (every nth)
      if (data.length <= 12 || i % Math.ceil(data.length / 12) === 0) {
        labels += `<text x="${x + barW / 2}" y="${h - 8}" text-anchor="middle" font-size="9" fill="${C.textDim}">${esc(d.label || '')}</text>`;
      }
    });

    return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Execution Timeline Chart">
      <rect width="${w}" height="${h}" rx="8" fill="${C.bgCard}"/>
      ${gridLines}
      ${bars}
      ${labels}
      <text x="${pad.l}" y="14" font-size="10" fill="${C.textDim}">Duration (ms)</text>
    </svg>`;
  }

  function svgDonutChart(segments, w = 120, h = 120) {
    const cx = w / 2, cy = h / 2, r = 44, ir = 28;
    const total = segments.reduce((s, seg) => s + seg.value, 0) || 1;
    let angle = -Math.PI / 2;
    let paths = '';
    const colors = [C.green, C.red, C.yellow, C.primary, C.gray];

    segments.forEach((seg, i) => {
      const sweep = (seg.value / total) * Math.PI * 2;
      if (sweep < 0.001) return;
      const x1 = cx + r * Math.cos(angle), y1 = cy + r * Math.sin(angle);
      const x2 = cx + r * Math.cos(angle + sweep), y2 = cy + r * Math.sin(angle + sweep);
      const ix1 = cx + ir * Math.cos(angle + sweep), iy1 = cy + ir * Math.sin(angle + sweep);
      const ix2 = cx + ir * Math.cos(angle), iy2 = cy + ir * Math.sin(angle);
      const large = sweep > Math.PI ? 1 : 0;
      paths += `<path d="M${x1},${y1} A${r},${r} 0 ${large},1 ${x2},${y2} L${ix1},${iy1} A${ir},${ir} 0 ${large},0 ${ix2},${iy2} Z" fill="${colors[i % colors.length]}">
        <title>${esc(seg.label)}: ${seg.value} (${((seg.value / total) * 100).toFixed(1)}%)</title></path>`;
      angle += sweep;
    });

    const pct = segments.length ? ((segments[0].value / total) * 100).toFixed(0) : 0;
    return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      ${paths}
      <text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="14" font-weight="700" fill="${C.text}">${pct}%</text>
    </svg>`;
  }

  function svgSparkline(data, w = 120, h = 32, color = C.primary) {
    if (!data || !data.length) return `<svg width="${w}" height="${h}"><rect fill="${C.bgCard}" width="${w}" height="${h}" rx="4"/></svg>`;
    const max = Math.max(...data), min = Math.min(...data), range = max - min || 1;
    const pts = data.map((v, i) =>
      `${(i / (data.length - 1)) * w},${h - 2 - ((v - min) / range) * (h - 4)}`
    ).join(' ');
    return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <polyline fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" points="${pts}"/></svg>`;
  }

  function svgAreaChart(data, w = 600, h = 140, color = C.primary) {
    if (!data || !data.length) {
      return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
        <rect width="${w}" height="${h}" rx="8" fill="${C.bgCard}"/>
        <text x="${w / 2}" y="${h / 2}" text-anchor="middle" fill="${C.textDim}" font-size="13">No data</text></svg>`;
    }
    const pad = 8;
    const max = Math.max(...data), min = Math.min(...data), range = max - min || 1;
    const pts = data.map((v, i) => ({
      x: pad + (i / Math.max(data.length - 1, 1)) * (w - pad * 2),
      y: pad + (h - pad * 2) - ((v - min) / range) * (h - pad * 2)
    }));
    const line = pts.map(p => `${p.x},${p.y}`).join(' ');
    const area = `${pts[0].x},${h - pad} ${line} ${pts[pts.length - 1].x},${h - pad}`;
    let grid = '';
    for (let i = 0; i <= 4; i++) {
      const y = pad + (i / 4) * (h - pad * 2);
      const val = (max - (i / 4) * range).toFixed(val > 100 ? 0 : 1);
      grid += `<line x1="${pad}" y1="${y}" x2="${w - pad}" y2="${y}" stroke="${C.border}" stroke-width="0.5" stroke-dasharray="3,3"/>`;
      grid += `<text x="${w - pad - 4}" y="${y - 3}" font-size="9" fill="${C.textDim}" text-anchor="end">${val}</text>`;
    }
    return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Area chart">
      <rect fill="${C.bgCard}" width="${w}" height="${h}" rx="8"/>
      ${grid}
      <polygon fill="${color}20" stroke="none" points="${area}"/>
      <polyline fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" points="${line}"/>
      ${pts.length ? `<circle cx="${pts[pts.length - 1].x}" cy="${pts[pts.length - 1].y}" r="3" fill="${color}"/>` : ''}
    </svg>`;
  }

  // ── Shared Page Shell ────────────────────────────────────────────────────
  function buildPage(title, bodyHtml, req) {
    const pageContent = buildDashboardHTML(title, bodyHtml, req);
    res.send(opts.renderPage('Scheduled Tasks — ' + title, pageContent, req.session.user));
  }

  function pageWrap(title, inner) {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(title)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:${C.bg};color:${C.text};line-height:1.5}
a{color:${C.primaryLight};text-decoration:none}a:hover{text-decoration:underline}
.page-header{background:linear-gradient(135deg,${C.bgCard},${C.bg});border-bottom:1px solid ${C.border};padding:28px 32px}
.page-header h1{font-size:1.6rem;font-weight:700;margin-bottom:4px;display:flex;align-items:center;gap:10px}
.page-header p{color:${C.textMuted};font-size:.9rem}
.container{max-width:1280px;margin:0 auto;padding:24px 32px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px;margin-bottom:24px}
.grid-2{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px}
.grid-3{display:grid;grid-template-columns:2fr 1fr;gap:16px;margin-bottom:24px}
.card{background:${C.bgCard};border:1px solid ${C.border};border-radius:12px;padding:20px;transition:border-color .2s}
.card:hover{border-color:${C.primary}40}
.card h2{font-size:1rem;font-weight:600;margin-bottom:14px;display:flex;align-items:center;gap:8px;color:${C.text}}
.card h2 svg{width:18px;height:18px;opacity:.7}
.kpi{background:${C.bgCard};border:1px solid ${C.border};border-radius:12px;padding:20px;transition:transform .15s,border-color .2s}
.kpi:hover{transform:translateY(-2px);border-color:${C.primary}40}
.kpi-icon{width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;margin-bottom:12px;font-size:1.2rem}
.kpi-icon.blue{background:${C.primary}20;color:${C.primary}}
.kpi-icon.green{background:${C.green}20;color:${C.green}}
.kpi-icon.red{background:${C.red}20;color:${C.red}}
.kpi-icon.yellow{background:${C.yellow}20;color:${C.yellow}}
.kpi-label{font-size:.78rem;color:${C.textMuted};text-transform:uppercase;letter-spacing:.05em;font-weight:600}
.kpi-value{font-size:1.75rem;font-weight:700;margin:4px 0 2px}
.kpi-sub{font-size:.78rem;color:${C.textDim}}
table{width:100%;border-collapse:collapse;font-size:.85rem}
thead th{text-align:left;padding:10px 12px;border-bottom:2px solid ${C.border};font-weight:600;font-size:.76rem;text-transform:uppercase;letter-spacing:.04em;color:${C.textMuted}}
tbody td{padding:10px 12px;border-bottom:1px solid ${C.border}22}
tbody tr:hover{background:${C.bgCardHover}}
.btn{display:inline-flex;align-items:center;gap:6px;padding:8px 18px;border:none;border-radius:8px;cursor:pointer;font-size:.85rem;font-weight:600;transition:all .15s;color:#fff}
.btn:hover{opacity:.9;transform:translateY(-1px)}
.btn-primary{background:${C.primary}}.btn-primary:hover{background:${C.primaryDark}}
.btn-green{background:${C.green}}.btn-red{background:${C.red}}.btn-yellow{background:${C.yellow}}
.btn-ghost{background:transparent;border:1px solid ${C.border};color:${C.textMuted}}
.btn-ghost:hover{border-color:${C.primary};color:${C.primaryLight}}
.btn-sm{padding:5px 12px;font-size:.78rem}
.form-group{margin-bottom:16px}
.form-group label{display:block;font-size:.83rem;font-weight:600;margin-bottom:5px;color:${C.textMuted}}
.form-group input,.form-group select,.form-group textarea{width:100%;padding:10px 14px;background:${C.bg};border:1px solid ${C.border};border-radius:8px;color:${C.text};font-size:.88rem;transition:border-color .15s}
.form-group input:focus,.form-group select:focus,.form-group textarea:focus{outline:none;border-color:${C.primary};box-shadow:0 0 0 3px ${C.primary}20}
.form-group textarea{resize:vertical;font-family:monospace;font-size:.82rem;min-height:80px}
.form-row{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.code-block{background:${C.bg};color:${C.textMuted};padding:12px 16px;border-radius:8px;font-size:.8rem;overflow-x:auto;white-space:pre-wrap;word-break:break-all;max-height:200px;overflow-y:auto;border:1px solid ${C.border}22}
.toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:16px}
.toolbar input,.toolbar select{padding:8px 14px;background:${C.bg};border:1px solid ${C.border};border-radius:8px;color:${C.text};font-size:.85rem}
.toolbar input:focus,.toolbar select:focus{outline:none;border-color:${C.primary}}
.empty-state{text-align:center;padding:48px 24px;color:${C.textDim}}
.empty-state .icon{font-size:2.5rem;margin-bottom:12px;opacity:.5}
.tabs{display:flex;gap:4px;border-bottom:1px solid ${C.border};margin-bottom:20px}
.tab{padding:10px 18px;color:${C.textMuted};font-size:.85rem;font-weight:500;border-bottom:2px solid transparent;cursor:pointer;transition:.15s}
.tab:hover{color:${C.text}}.tab.active{color:${C.primaryLight};border-bottom-color:${C.primary}}
.badge{display:inline-block;padding:3px 10px;border-radius:99px;font-size:.72rem;font-weight:600;color:#fff;white-space:nowrap}
.pulse{animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.pagination{display:flex;gap:4px;align-items:center;margin-top:16px}
.pagination button{padding:6px 12px;background:${C.bgCard};border:1px solid ${C.border};border-radius:6px;color:${C.textMuted};cursor:pointer;font-size:.8rem}
.pagination button.active{background:${C.primary};border-color:${C.primary};color:#fff}
.chip{display:inline-flex;align-items:center;gap:4px;padding:4px 12px;border-radius:99px;font-size:.76rem;font-weight:500;background:${C.primary}15;color:${C.primaryLight};border:1px solid ${C.primary}30}
.modal-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.6);z-index:1000;display:flex;align-items:center;justify-content:center}
.modal{background:${C.bgCard};border:1px solid ${C.border};border-radius:16px;padding:28px;max-width:560px;width:90%;max-height:90vh;overflow-y:auto}
.modal h2{margin-bottom:16px}
</style></head><body>
${inner}</body></html>`;
  }

  // ── 1. GET / — Dashboard ─────────────────────────────────────────────────
  app.get('/admin/scheduled-tasks', requireAuth, ah(async (req, res) => {
    audit(req, 'view', 'scheduled_tasks_dashboard');
    const sid = schoolId(req);

    const { rows: tasks } = await pool.query(
      `SELECT * FROM scheduled_tasks WHERE school_id = $1 ORDER BY created_at DESC`, [sid]);
    const { rows: recentLogs } = await pool.query(
      `SELECT tel.*, st.name AS task_name FROM task_execution_logs tel
       JOIN scheduled_tasks st ON st.id = tel.task_id
       WHERE tel.school_id = $1 ORDER BY tel.started_at DESC LIMIT 20`, [sid]);
    const { rows: stats } = await pool.query(
      `SELECT COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE is_active) AS active,
        COUNT(*) FILTER (WHERE NOT is_active) AS inactive,
        SUM(run_count)::int AS total_runs,
        SUM(fail_count)::int AS total_fails,
        AVG(run_count)::numeric(8,1) AS avg_runs
       FROM scheduled_tasks WHERE school_id = $1`, [sid]);
    const { rows: logStats } = await pool.query(
      `SELECT status, COUNT(*)::int AS cnt FROM task_execution_logs
       WHERE school_id = $1 AND started_at > NOW() - INTERVAL '24 hours' GROUP BY status`, [sid]);

    const statMap = logStats.reduce((a, c) => { a[c.status] = c.cnt; return a; }, {});
    const s = stats[0] || {};
    const chartData = recentLogs.slice(0, 24).reverse().map(l => ({
      label: new Date(l.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      value: l.duration_ms || 0, status: l.status, unit: 'ms'
    }));

    const donutData = [
      { label: 'Success', value: statMap.success || 0 },
      { label: 'Failed', value: statMap.failed || 0 },
      { label: 'Running', value: statMap.running || 0 },
      { label: 'Timeout', value: statMap.timeout || 0 }
    ];

    const failRate = s.total_runs > 0 ? ((s.total_fails / s.total_runs) * 100).toFixed(1) : '0.0';
    const successRate = (100 - parseFloat(failRate)).toFixed(1);

    const html = pageWrap('Scheduled Tasks Dashboard', `
<div class="page-header">
  <h1>⏱️ Scheduled Tasks Manager</h1>
  <p>Monitor, configure, and manage automated tasks for your school</p>
</div>
<div class="container">
  <div class="grid">
    <div class="kpi">
      <div class="kpi-icon blue">📋</div>
      <div class="kpi-label">Total Tasks</div>
      <div class="kpi-value">${s.total || 0}</div>
      <div class="kpi-sub">${s.active || 0} active · ${s.inactive || 0} inactive</div>
    </div>
    <div class="kpi">
      <div class="kpi-icon green">✅</div>
      <div class="kpi-label">Success Rate (24h)</div>
      <div class="kpi-value">${successRate}%</div>
      <div class="kpi-sub">${statMap.success || 0} successful executions</div>
    </div>
    <div class="kpi">
      <div class="kpi-icon red">❌</div>
      <div class="kpi-label">Fail Rate (24h)</div>
      <div class="kpi-value">${failRate}%</div>
      <div class="kpi-sub">${statMap.failed || 0} failed · ${statMap.timeout || 0} timeout</div>
    </div>
    <div class="kpi">
      <div class="kpi-icon yellow">🔄</div>
      <div class="kpi-label">Total Executions</div>
      <div class="kpi-value">${(s.total_runs || 0).toLocaleString()}</div>
      <div class="kpi-sub">Avg ${(s.avg_runs || 0).toLocaleString()} per task</div>
    </div>
  </div>

  <div class="grid-3">
    <div class="card">
      <h2>📈 Execution Timeline (Recent)</h2>
      ${svgTimelineChart(chartData, 700, 180)}
      <p style="font-size:.78rem;color:${C.textDim};margin-top:8px">Duration in milliseconds per recent execution run</p>
    </div>
    <div class="card" style="display:flex;flex-direction:column;align-items:center;justify-content:center">
      <h2 style="align-self:flex-start">📊 Status Distribution (24h)</h2>
      ${svgDonutChart(donutData, 140, 140)}
      <div style="margin-top:16px;width:100%">
        ${donutData.map((d, i) => {
          const colors = [C.green, C.red, C.primary, C.yellow];
          return `<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;font-size:.82rem">
            <span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${colors[i]};margin-right:6px"></span>${esc(d.label)}</span>
            <strong>${d.value}</strong></div>`;
        }).join('')}
      </div>
    </div>
  </div>

  <div class="card" style="margin-bottom:24px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px">
      <h2 style="margin:0">🔧 All Tasks</h2>
      <div class="toolbar">
        <button class="btn btn-primary" onclick="showCreateModal()">+ New Task</button>
        <a href="/admin/scheduled-tasks/cron-help" class="btn btn-ghost">📖 Cron Help</a>
        <a href="/admin/scheduled-tasks/logs" class="btn btn-ghost">📋 All Logs</a>
        <a href="/admin/scheduled-tasks/stats" class="btn btn-ghost">📊 Stats</a>
      </div>
    </div>
    ${tasks.length ? `
    <div style="overflow-x:auto">
    <table>
      <thead><tr>
        <th>Name</th><th>Type</th><th>Cron</th><th>Status</th>
        <th>Runs</th><th>Fails</th><th>Last Run</th><th>Next Run</th><th>Actions</th>
      </tr></thead>
      <tbody>
      ${tasks.map(t => `<tr>
        <td><strong>${esc(t.name)}</strong>${t.description ? `<br><span style="font-size:.75rem;color:${C.textDim}">${esc(t.description).substring(0, 60)}</span>` : ''}</td>
        <td><span class="chip">${esc(t.task_type || 'custom')}</span></td>
        <td><code style="font-size:.8rem;color:${C.primaryLight}">${esc(t.cron_expression || '-')}</code></td>
        <td>${toggleBadge(t.is_active)}</td>
        <td>${(t.run_count || 0).toLocaleString()}</td>
        <td style="color:${t.fail_count > 0 ? C.red : C.textMuted}">${t.fail_count || 0}</td>
        <td style="font-size:.82rem;color:${C.textMuted};white-space:nowrap">${timeAgo(t.last_run_at)}</td>
        <td style="font-size:.82rem;color:${C.textMuted};white-space:nowrap">${t.next_run_at ? fmtDate(t.next_run_at) : '-'}</td>
        <td style="white-space:nowrap">
          <button class="btn btn-sm btn-primary" onclick="runTaskNow(${t.id})">▶ Run</button>
          <button class="btn btn-sm btn-ghost" onclick="toggleTask(${t.id})">${t.is_active ? 'Pause' : 'Resume'}</button>
          <a href="/admin/scheduled-tasks/${t.id}/logs" class="btn btn-sm btn-ghost">Logs</a>
        </td>
      </tr>`).join('')}
      </tbody>
    </table>
    </div>` : '<div class="empty-state"><div class="icon">📭</div><p>No scheduled tasks yet. Create your first task to get started.</p></div>'}
  </div>

  <div class="card">
    <h2>🕐 Recent Execution Logs</h2>
    ${recentLogs.length ? `
    <div style="overflow-x:auto">
    <table>
      <thead><tr><th>Task</th><th>Status</th><th>Trigger</th><th>Duration</th><th>Started</th></tr></thead>
      <tbody>
      ${recentLogs.map(l => `<tr>
        <td>${esc(l.task_name)}</td>
        <td>${statusBadge(l.status)}</td>
        <td><span class="chip">${esc(l.trigger_type || 'scheduled')}</span></td>
        <td>${fmtDuration(l.duration_ms)}</td>
        <td style="font-size:.82rem;color:${C.textMuted}">${timeAgo(l.started_at)}</td>
      </tr>`).join('')}
      </tbody>
    </table>
    </div>` : '<div class="empty-state"><div class="icon">📭</div><p>No execution logs yet.</p></div>'}
  </div>
</div>

<script>
function showCreateModal(){
  const m=document.createElement('div');m.className='modal-overlay';
  m.innerHTML='<div class="modal"><h2>Create New Scheduled Task</h2><form id="createTaskForm" method="POST" action="/admin/scheduled-tasks/create">'+
  '<div class="form-group"><label>Task Name *</label><input name="name" required placeholder="e.g. Daily Attendance Sync"></div>'+
  '<div class="form-group"><label>Description</label><textarea name="description" placeholder="What does this task do?"></textarea></div>'+
  '<div class="form-row"><div class="form-group"><label>Cron Expression *</label><input name="cron_expression" required placeholder="0 2 * * *"></div>'+
  '<div class="form-group"><label>Task Type</label><select name="task_type"><option value="custom">Custom</option><option value="email">Email</option><option value="report">Report</option><option value="backup">Backup</option><option value="sync">Sync</option><option value="cleanup">Cleanup</option><option value="notification">Notification</option></select></div></div>'+
  '<div class="form-group"><label>Handler Path</label><input name="handler_path" placeholder="/path/to/handler.js"></div>'+
  '<div class="form-row"><div class="form-group"><label>Timeout (seconds)</label><input name="timeout_seconds" type="number" value="300" min="10" max="3600"></div>'+
  '<div class="form-group"><label>Retry Limit</label><input name="retry_limit" type="number" value="3" min="0" max="10"></div></div>'+
  '<div class="form-group"><label>Payload (JSON)</label><textarea name="payload" placeholder=\'{"key":"value"}\'></textarea></div>'+
  '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">'+
  '<button type="button" class="btn btn-ghost" onclick="this.closest(\'.modal-overlay\').remove()">Cancel</button>'+
  '<button type="submit" class="btn btn-primary">Create Task</button></div></form></div>';
  document.body.appendChild(m);m.addEventListener('click',e=>{if(e.target===m)m.remove()});
}
function toggleTask(id){fetch('/admin/scheduled-tasks/'+id+'/toggle',{method:'POST',headers:{'Content-Type':'application/json'}}).then(r=>r.json()).then(d=>location.reload())}
function runTaskNow(id){if(!confirm('Run this task now?'))return;fetch('/admin/scheduled-tasks/'+id+'/run',{method:'POST',headers:{'Content-Type':'application/json'}}).then(r=>r.json()).then(d=>{alert(d.message||'Triggered');location.reload()})}
</script>`);
    res.send(opts.renderPage('Scheduled Tasks Dashboard', html, req.session.user));
  }));

  // ── 2. GET /data — JSON tasks list with filters ─────────────────────────
  app.get('/admin/scheduled-tasks/data', requireAuth, ah(async (req, res) => {
    const sid = schoolId(req);
    const { status, type, search, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    let where = 'WHERE school_id = $1';
    const params = [sid];
    let pi = 2;

    if (status === 'active') { where += ` AND is_active = true`; }
    else if (status === 'inactive') { where += ` AND is_active = false`; }
    if (type) { where += ` AND task_type = $${pi++}`; params.push(type); }
    if (search) { where += ` AND (name ILIKE $${pi} OR description ILIKE $${pi})`; params.push(`%${search}%`); pi++; }

    const { rows } = await pool.query(
      `SELECT * FROM scheduled_tasks ${where} ORDER BY created_at DESC LIMIT $${pi} OFFSET $${pi + 1}`,
      [...params, +limit, +offset]);
    const { rows: countResult } = await pool.query(
      `SELECT COUNT(*)::int AS total FROM scheduled_tasks ${where}`, params);

    res.json({ tasks: rows, total: countResult[0]?.total || 0, page: +page, limit: +limit });
  }));

  // ── 3. POST /create — Create new scheduled task ─────────────────────────
  app.post('/admin/scheduled-tasks/create', requireAuth, ah(async (req, res) => {
    audit(req, 'create', 'scheduled_task');
    const sid = schoolId(req);
    const { name, description, cron_expression, task_type, handler_path, payload, timeout_seconds, retry_limit } = req.body;

    if (!name || !cron_expression) {
      return res.status(400).json({ error: 'Task name and cron expression are required.' });
    }

    let parsedPayload = null;
    if (payload) {
      try { parsedPayload = JSON.parse(payload); }
      catch (e) { return res.status(400).json({ error: 'Invalid JSON payload.' }); }
    }

    const { rows } = await pool.query(
      `INSERT INTO scheduled_tasks (name, description, cron_expression, task_type, handler_path, payload, timeout_seconds, retry_limit, school_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [name, description || null, cron_expression, task_type || 'custom', handler_path || null,
       parsedPayload, +timeout_seconds || 300, +retry_limit || 3, sid]);

    res.json({ success: true, task: rows[0], message: `Task "${name}" created successfully.` });
  }));

  // ── 4. PUT /:id — Update task settings ──────────────────────────────────
  app.put('/admin/scheduled-tasks/:id', requireAuth, ah(async (req, res) => {
    audit(req, 'update', 'scheduled_task', { taskId: req.params.id });
    const sid = schoolId(req);
    const { name, description, cron_expression, task_type, handler_path, payload, timeout_seconds, retry_limit } = req.body;
    const id = req.params.id;

    const { rows: existing } = await pool.query(
      `SELECT id FROM scheduled_tasks WHERE id = $1 AND school_id = $2`, [id, sid]);
    if (!existing.length) return res.status(404).json({ error: 'Task not found.' });

    let parsedPayload = null;
    if (payload) {
      try { parsedPayload = JSON.parse(payload); }
      catch (e) { return res.status(400).json({ error: 'Invalid JSON payload.' }); }
    }

    const { rows } = await pool.query(
      `UPDATE scheduled_tasks SET
        name = COALESCE($1, name), description = COALESCE($2, description),
        cron_expression = COALESCE($3, cron_expression), task_type = COALESCE($4, task_type),
        handler_path = COALESCE($5, handler_path), payload = COALESCE($6, payload),
        timeout_seconds = COALESCE($7, timeout_seconds), retry_limit = COALESCE($8, retry_limit),
        updated_at = NOW()
       WHERE id = $9 AND school_id = $10 RETURNING *`,
      [name, description, cron_expression, task_type, handler_path,
       parsedPayload, timeout_seconds ? +timeout_seconds : null, retry_limit ? +retry_limit : null, +id, sid]);

    res.json({ success: true, task: rows[0], message: 'Task updated successfully.' });
  }));

  // ── 5. DELETE /:id — Delete task ────────────────────────────────────────
  app.delete('/admin/scheduled-tasks/:id', requireAuth, ah(async (req, res) => {
    audit(req, 'delete', 'scheduled_task', { taskId: req.params.id });
    const sid = schoolId(req);
    const id = req.params.id;

    const { rows: existing } = await pool.query(
      `SELECT id, name FROM scheduled_tasks WHERE id = $1 AND school_id = $2`, [id, sid]);
    if (!existing.length) return res.status(404).json({ error: 'Task not found.' });

    await pool.query(`DELETE FROM task_execution_logs WHERE task_id = $1`, [id]);
    await pool.query(`DELETE FROM scheduled_tasks WHERE id = $1 AND school_id = $2`, [id, sid]);

    res.json({ success: true, message: `Task "${existing[0].name}" deleted successfully.` });
  }));

  // ── 6. POST /:id/toggle — Enable/disable task ───────────────────────────
  app.post('/admin/scheduled-tasks/:id/toggle', requireAuth, ah(async (req, res) => {
    audit(req, 'update', 'scheduled_task_toggle', { taskId: req.params.id });
    const sid = schoolId(req);
    const id = req.params.id;

    const { rows: existing } = await pool.query(
      `SELECT id, is_active FROM scheduled_tasks WHERE id = $1 AND school_id = $2`, [id, sid]);
    if (!existing.length) return res.status(404).json({ error: 'Task not found.' });

    const newStatus = !existing[0].is_active;
    await pool.query(
      `UPDATE scheduled_tasks SET is_active = $1, updated_at = NOW() WHERE id = $2 AND school_id = $3`,
      [newStatus, id, sid]);

    res.json({ success: true, is_active: newStatus, message: `Task ${newStatus ? 'activated' : 'paused'}.` });
  }));

  // ── 7. POST /:id/run — Manual trigger execution ─────────────────────────
  app.post('/admin/scheduled-tasks/:id/run', requireAuth, ah(async (req, res) => {
    audit(req, 'execute', 'scheduled_task_manual', { taskId: req.params.id });
    const sid = schoolId(req);
    const id = req.params.id;

    const { rows: task } = await pool.query(
      `SELECT * FROM scheduled_tasks WHERE id = $1 AND school_id = $2`, [id, sid]);
    if (!task.length) return res.status(404).json({ error: 'Task not found.' });
    if (!task[0].is_active) return res.status(400).json({ error: 'Task is inactive. Enable it first.' });

    // Create execution log
    const { rows: log } = await pool.query(
      `INSERT INTO task_execution_logs (task_id, trigger_type, school_id, status)
       VALUES ($1, 'manual', $2, 'running') RETURNING id`, [id, sid]);

    const startTime = Date.now();
    let output = '', error = null, status = 'success';

    try {
      if (task[0].handler_path) {
        // Attempt dynamic require of handler
        const handler = require(task[0].handler_path);
        if (typeof handler === 'function') {
          output = await Promise.race([
            handler(task[0].payload || {}, { pool, task: task[0] }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), (task[0].timeout_seconds || 300) * 1000))
          ]);
          output = typeof output === 'string' ? output : JSON.stringify(output);
        }
      } else {
        output = `Manual execution triggered for task "${task[0].name}" (ID: ${id}). No handler configured.`;
      }
    } catch (e) {
      error = e.message;
      status = 'failed';
    }

    const durationMs = Date.now() - startTime;
    await pool.query(
      `UPDATE task_execution_logs SET status = $1, finished_at = NOW(), duration_ms = $2, output = $3, error = $4
       WHERE id = $5`,
      [status, durationMs, output || null, error, log[0].id]);
    await pool.query(
      `UPDATE scheduled_tasks SET last_run_at = NOW(), run_count = run_count + 1,
        fail_count = CASE WHEN $1 = 'failed' THEN fail_count + 1 ELSE fail_count END,
        last_error = $2, updated_at = NOW() WHERE id = $3`,
      [status, error, id]);

    res.json({ success: status === 'success', status, duration_ms: durationMs, output: output || null, error });
  }));

  // ── 8. GET /:id/logs — Execution logs for a task ────────────────────────
  app.get('/admin/scheduled-tasks/:id/logs', requireAuth, ah(async (req, res) => {
    audit(req, 'view', 'scheduled_task_logs', { taskId: req.params.id });
    const sid = schoolId(req);
    const id = req.params.id;
    const { page = 1, limit = 25 } = req.query;
    const offset = (page - 1) * limit;

    const { rows: task } = await pool.query(
      `SELECT * FROM scheduled_tasks WHERE id = $1 AND school_id = $2`, [id, sid]);
    if (!task.length) return res.status(404).json({ error: 'Task not found.' });

    const { rows: logs } = await pool.query(
      `SELECT * FROM task_execution_logs WHERE task_id = $1 AND school_id = $2
       ORDER BY started_at DESC LIMIT $3 OFFSET $4`, [id, sid, +limit, +offset]);
    const { rows: countResult } = await pool.query(
      `SELECT COUNT(*)::int AS total FROM task_execution_logs WHERE task_id = $1 AND school_id = $2`, [id, sid]);

    // Timeline data for chart
    const { rows: chartLogs } = await pool.query(
      `SELECT duration_ms, status, started_at FROM task_execution_logs
       WHERE task_id = $1 AND school_id = $2 ORDER BY started_at DESC LIMIT 30`, [id, sid]);

    const chartData = chartLogs.reverse().map(l => ({
      label: new Date(l.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      value: l.duration_ms || 0, status: l.status
    }));

    const t = task[0];
    const html = pageWrap(`Execution Logs — ${t.name}`, `
<div class="page-header">
  <h1>📋 Execution Logs</h1>
  <p>Task: <strong>${esc(t.name)}</strong> — ${esc(t.description || 'No description')} · ${esc(t.cron_expression || 'No schedule')}</p>
</div>
<div class="container">
  <div style="margin-bottom:20px;display:flex;gap:8px">
    <a href="/admin/scheduled-tasks" class="btn btn-ghost">← Back to Tasks</a>
    <button class="btn btn-primary" onclick="runTaskNow(${t.id})">▶ Run Now</button>
  </div>

  <div class="grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:20px">
    <div class="kpi">
      <div class="kpi-icon blue">🔄</div>
      <div class="kpi-label">Total Runs</div>
      <div class="kpi-value">${(t.run_count || 0).toLocaleString()}</div>
    </div>
    <div class="kpi">
      <div class="kpi-icon green">✅</div>
      <div class="kpi-label">Success</div>
      <div class="kpi-value">${(t.run_count - (t.fail_count || 0)).toLocaleString()}</div>
    </div>
    <div class="kpi">
      <div class="kpi-icon red">❌</div>
      <div class="kpi-label">Failures</div>
      <div class="kpi-value">${(t.fail_count || 0).toLocaleString()}</div>
      ${t.last_error ? `<div class="kpi-sub" style="color:${C.red}">${esc(t.last_error).substring(0, 50)}</div>` : ''}
    </div>
  </div>

  <div class="card" style="margin-bottom:20px">
    <h2>📈 Execution Timeline</h2>
    ${svgTimelineChart(chartData, 700, 160)}
  </div>

  <div class="card">
    <h2>📋 Log Entries (${countResult[0]?.total || 0} total)</h2>
    ${logs.length ? `<table>
      <thead><tr><th>ID</th><th>Status</th><th>Trigger</th><th>Duration</th><th>Started</th><th>Finished</th><th>Output / Error</th></tr></thead>
      <tbody>
      ${logs.map(l => `<tr>
        <td>#${l.id}</td>
        <td>${statusBadge(l.status)}</td>
        <td><span class="chip">${esc(l.trigger_type || 'scheduled')}</span></td>
        <td>${fmtDuration(l.duration_ms)}</td>
        <td style="font-size:.82rem;color:${C.textMuted}">${fmtDate(l.started_at)}</td>
        <td style="font-size:.82rem;color:${C.textMuted}">${fmtDate(l.finished_at)}</td>
        <td style="max-width:250px">
          ${l.error ? `<div class="code-block" style="color:${C.red};max-height:60px">${esc(l.error).substring(0, 200)}</div>` :
            l.output ? `<div class="code-block" style="max-height:60px">${esc(l.output).substring(0, 200)}</div>` : '<span style="color:' + C.textDim + '">—</span>'}
        </td>
      </tr>`).join('')}
      </tbody>
    </table>` : '<div class="empty-state"><div class="icon">📭</div><p>No execution logs for this task.</p></div>'}
  </div>
</div>
<script>
function runTaskNow(id){if(!confirm('Run this task now?'))return;fetch('/admin/scheduled-tasks/'+id+'/run',{method:'POST',headers:{'Content-Type':'application/json'}}).then(r=>r.json()).then(d=>{alert(d.message||'Triggered');location.reload()})}
</script>`);
    res.send(opts.renderPage(`Logs — ${t.name}`, html, req.session.user));
  }));

  // ── 9. GET /logs — All execution logs with filters ───────────────────────
  app.get('/admin/scheduled-tasks/logs', requireAuth, ah(async (req, res) => {
    audit(req, 'view', 'all_execution_logs');
    const sid = schoolId(req);
    const { status, trigger_type, task_id, from, to, page = 1, limit = 30 } = req.query;
    const offset = (page - 1) * limit;

    let where = 'WHERE tel.school_id = $1';
    const params = [sid];
    let pi = 2;

    if (status) { where += ` AND tel.status = $${pi++}`; params.push(status); }
    if (trigger_type) { where += ` AND tel.trigger_type = $${pi++}`; params.push(trigger_type); }
    if (task_id) { where += ` AND tel.task_id = $${pi++}`; params.push(task_id); }
    if (from) { where += ` AND tel.started_at >= $${pi++}`; params.push(from); }
    if (to) { where += ` AND tel.started_at <= $${pi++}`; params.push(to); }

    const { rows: logs } = await pool.query(
      `SELECT tel.*, st.name AS task_name, st.cron_expression
       FROM task_execution_logs tel
       LEFT JOIN scheduled_tasks st ON st.id = tel.task_id
       ${where} ORDER BY tel.started_at DESC LIMIT $${pi} OFFSET $${pi + 1}`,
      [...params, +limit, +offset]);
    const { rows: countResult } = await pool.query(
      `SELECT COUNT(*)::int AS total FROM task_execution_logs tel ${where}`, params);
    const { rows: statusCounts } = await pool.query(
      `SELECT tel.status, COUNT(*)::int AS cnt FROM task_execution_logs tel WHERE tel.school_id = $1 GROUP BY tel.status`, [sid]);

    const statusMap = statusCounts.reduce((a, c) => { a[c.status] = c.cnt; return a; }, {});

    const html = pageWrap('All Execution Logs', `
<div class="page-header">
  <h1>📋 All Execution Logs</h1>
  <p>Browse and filter task execution history across all scheduled tasks</p>
</div>
<div class="container">
  <div style="margin-bottom:16px;display:flex;gap:8px">
    <a href="/admin/scheduled-tasks" class="btn btn-ghost">← Back to Tasks</a>
    <a href="/admin/scheduled-tasks/export/logs" class="btn btn-ghost">📥 Export CSV</a>
  </div>

  <div class="card" style="margin-bottom:16px">
    <h2>🔍 Filters</h2>
    <form method="GET" action="/admin/scheduled-tasks/logs" style="display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end">
      <div class="form-group" style="margin:0;min-width:140px"><label>Status</label>
        <select name="status"><option value="">All</option><option value="success" ${status === 'success' ? 'selected' : ''}>Success</option><option value="failed" ${status === 'failed' ? 'selected' : ''}>Failed</option><option value="running" ${status === 'running' ? 'selected' : ''}>Running</option><option value="timeout" ${status === 'timeout' ? 'selected' : ''}>Timeout</option></select></div>
      <div class="form-group" style="margin:0;min-width:140px"><label>Trigger</label>
        <select name="trigger_type"><option value="">All</option><option value="scheduled" ${trigger_type === 'scheduled' ? 'selected' : ''}>Scheduled</option><option value="manual" ${trigger_type === 'manual' ? 'selected' : ''}>Manual</option></select></div>
      <div class="form-group" style="margin:0;min-width:140px"><label>From</label><input type="date" name="from" value="${from || ''}"></div>
      <div class="form-group" style="margin:0;min-width:140px"><label>To</label><input type="date" name="to" value="${to || ''}"></div>
      <button type="submit" class="btn btn-primary" style="height:42px">Apply</button>
      <a href="/admin/scheduled-tasks/logs" class="btn btn-ghost" style="height:42px;display:flex;align-items:center">Clear</a>
    </form>
  </div>

  <div class="grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:16px">
    <div class="kpi"><div class="kpi-icon blue">📊</div><div class="kpi-label">Total Logs</div><div class="kpi-value">${(countResult[0]?.total || 0).toLocaleString()}</div></div>
    <div class="kpi"><div class="kpi-icon green">✅</div><div class="kpi-label">Success</div><div class="kpi-value">${(statusMap.success || 0).toLocaleString()}</div></div>
    <div class="kpi"><div class="kpi-icon red">❌</div><div class="kpi-label">Failed</div><div class="kpi-value">${(statusMap.failed || 0).toLocaleString()}</div></div>
    <div class="kpi"><div class="kpi-icon yellow">⏱</div><div class="kpi-label">Timeout</div><div class="kpi-value">${(statusMap.timeout || 0).toLocaleString()}</div></div>
  </div>

  <div class="card">
    <h2>📋 Log Entries</h2>
    ${logs.length ? `<div style="overflow-x:auto"><table>
      <thead><tr><th>ID</th><th>Task</th><th>Status</th><th>Trigger</th><th>Duration</th><th>Started</th><th>Finished</th><th>Details</th></tr></thead>
      <tbody>
      ${logs.map(l => `<tr>
        <td>#${l.id}</td>
        <td><a href="/admin/scheduled-tasks/${l.task_id}/logs" style="color:${C.primaryLight}">${esc(l.task_name || 'Deleted Task')}</a></td>
        <td>${statusBadge(l.status)}</td>
        <td><span class="chip">${esc(l.trigger_type || 'scheduled')}</span></td>
        <td>${fmtDuration(l.duration_ms)}</td>
        <td style="font-size:.82rem;color:${C.textMuted}">${fmtDate(l.started_at)}</td>
        <td style="font-size:.82rem;color:${C.textMuted}">${fmtDate(l.finished_at)}</td>
        <td style="max-width:200px">
          ${l.error ? `<span style="color:${C.red};font-size:.8rem" title="${esc(l.error)}">${esc(l.error).substring(0, 60)}...</span>` :
            l.output ? `<span style="color:${C.textMuted};font-size:.8rem" title="${esc(l.output)}">${esc(l.output).substring(0, 60)}...</span>` : '—'}
        </td>
      </tr>`).join('')}
      </tbody>
    </table></div>` : '<div class="empty-state"><div class="icon">📭</div><p>No logs match the current filters.</p></div>'}
  </div>
</div>`);
    res.send(opts.renderPage('All Execution Logs', html, req.session.user));
  }));

  // ── 10. GET /stats — Execution statistics ───────────────────────────────
  app.get('/admin/scheduled-tasks/stats', requireAuth, ah(async (req, res) => {
    audit(req, 'view', 'scheduled_tasks_stats');
    const sid = schoolId(req);

    const { rows: taskStats } = await pool.query(`
      SELECT st.id, st.name, st.run_count, st.fail_count, st.is_active,
        AVG(tel.duration_ms)::numeric(12,1) AS avg_duration,
        MIN(tel.duration_ms) AS min_duration,
        MAX(tel.duration_ms) AS max_duration,
        COUNT(tel.id) AS log_count,
        COUNT(tel.id) FILTER (WHERE tel.status = 'success') AS success_count,
        COUNT(tel.id) FILTER (WHERE tel.status = 'failed') AS failed_count
      FROM scheduled_tasks st
      LEFT JOIN task_execution_logs tel ON tel.task_id = st.id
      WHERE st.school_id = $1
      GROUP BY st.id ORDER BY st.run_count DESC`, [sid]);

    const { rows: hourlyStats } = await pool.query(`
      SELECT date_trunc('hour', started_at) AS hour,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'success') AS successes,
        COUNT(*) FILTER (WHERE status = 'failed') AS failures,
        AVG(duration_ms)::numeric(12,1) AS avg_duration
      FROM task_execution_logs
      WHERE school_id = $1 AND started_at > NOW() - INTERVAL '7 days'
      GROUP BY hour ORDER BY hour`, [sid]);

    const { rows: topFailing } = taskStats.filter(t => t.failed_count > 0).sort((a, b) => b.failed_count - a.failed_count).slice(0, 5);
    const totalRuns = taskStats.reduce((s, t) => s + (t.run_count || 0), 0);
    const totalFails = taskStats.reduce((s, t) => s + (t.fail_count || 0), 0);

    const areaData = hourlyStats.map(h => +(h.avg_duration || 0));
    const barData = hourlyStats.map(h => h.total || 0);

    const html = pageWrap('Execution Statistics', `
<div class="page-header">
  <h1>📊 Execution Statistics</h1>
  <p>Detailed performance metrics and analytics for all scheduled tasks</p>
</div>
<div class="container">
  <div style="margin-bottom:16px"><a href="/admin/scheduled-tasks" class="btn btn-ghost">← Back to Tasks</a></div>

  <div class="grid">
    <div class="kpi"><div class="kpi-icon blue">🔄</div><div class="kpi-label">Total Executions</div><div class="kpi-value">${totalRuns.toLocaleString()}</div></div>
    <div class="kpi"><div class="kpi-icon green">✅</div><div class="kpi-label">Overall Success</div><div class="kpi-value">${totalRuns > 0 ? ((1 - totalFails / totalRuns) * 100).toFixed(1) : '—'}%</div></div>
    <div class="kpi"><div class="kpi-icon red">❌</div><div class="kpi-label">Total Failures</div><div class="kpi-value">${totalFails.toLocaleString()}</div></div>
    <div class="kpi"><div class="kpi-icon yellow">📋</div><div class="kpi-label">Total Tasks</div><div class="kpi-value">${taskStats.length}</div></div>
  </div>

  <div class="grid-2" style="margin-bottom:20px">
    <div class="card">
      <h2>📈 Avg Duration (7d hourly)</h2>
      ${svgAreaChart(areaData, 500, 140, C.primary)}
    </div>
    <div class="card">
      <h2>📊 Execution Volume (7d hourly)</h2>
      ${svgAreaChart(barData, 500, 140, C.green)}
    </div>
  </div>

  ${topFailing.length ? `<div class="card" style="margin-bottom:20px">
    <h2 style="color:${C.red}">⚠️ Top Failing Tasks</h2>
    <table>
      <thead><tr><th>Task</th><th>Total Runs</th><th>Failed</th><th>Fail Rate</th><th>Avg Duration</th></tr></thead>
      <tbody>
      ${topFailing.map(t => {
        const rate = t.run_count > 0 ? ((t.failed_count / t.run_count) * 100).toFixed(1) : '0.0';
        return `<tr>
          <td><a href="/admin/scheduled-tasks/${t.id}/logs" style="color:${C.primaryLight}">${esc(t.name)}</a></td>
          <td>${(t.run_count || 0).toLocaleString()}</td>
          <td style="color:${C.red};font-weight:600">${t.failed_count}</td>
          <td>${badge(rate + '%', +rate > 20 ? C.red : +rate > 5 ? C.yellow : C.green)}</td>
          <td>${fmtDuration(t.avg_duration)}</td>
        </tr>`;
      }).join('')}
      </tbody>
    </table>
  </div>` : ''}

  <div class="card">
    <h2>📋 Per-Task Statistics</h2>
    <div style="overflow-x:auto"><table>
      <thead><tr><th>Task</th><th>Status</th><th>Runs</th><th>Success</th><th>Failed</th><th>Avg Duration</th><th>Min</th><th>Max</th></tr></thead>
      <tbody>
      ${taskStats.map(t => `<tr>
        <td><a href="/admin/scheduled-tasks/${t.id}/logs" style="color:${C.primaryLight}">${esc(t.name)}</a></td>
        <td>${toggleBadge(t.is_active)}</td>
        <td>${(t.run_count || 0).toLocaleString()}</td>
        <td style="color:${C.green}">${(t.success_count || 0).toLocaleString()}</td>
        <td style="color:${C.red}">${(t.failed_count || 0).toLocaleString()}</td>
        <td>${fmtDuration(t.avg_duration)}</td>
        <td style="color:${C.green}">${fmtDuration(t.min_duration)}</td>
        <td style="color:${C.red}">${fmtDuration(t.max_duration)}</td>
      </tr>`).join('')}
      </tbody>
    </table></div>
  </div>
</div>`);
    res.send(opts.renderPage('Execution Statistics', html, req.session.user));
  }));

  // ── 11. POST /bulk-toggle — Enable/disable multiple tasks ────────────────
  app.post('/admin/scheduled-tasks/bulk-toggle', requireAuth, ah(async (req, res) => {
    audit(req, 'update', 'scheduled_tasks_bulk_toggle');
    const sid = schoolId(req);
    const { ids, is_active } = req.body;

    if (!Array.isArray(ids) || !ids.length) {
      return res.status(400).json({ error: 'Provide an array of task IDs.' });
    }

    const result = await pool.query(
      `UPDATE scheduled_tasks SET is_active = $1, updated_at = NOW()
       WHERE id = ANY($2) AND school_id = $3`,
      [is_active, ids, sid]);

    res.json({ success: true, updated: result.rowCount, message: `${result.rowCount} tasks ${is_active ? 'activated' : 'paused'}.` });
  }));

  // ── 12. GET /cron-help — Cron expression reference ──────────────────────
  app.get('/admin/scheduled-tasks/cron-help', requireAuth, ah(async (req, res) => {
    audit(req, 'view', 'cron_help');
    const examples = [
      { expr: '* * * * *', desc: 'Every minute' },
      { expr: '0 * * * *', desc: 'Every hour' },
      { expr: '0 */2 * * *', desc: 'Every 2 hours' },
      { expr: '0 0 * * *', desc: 'Daily at midnight' },
      { expr: '0 6 * * *', desc: 'Daily at 6:00 AM' },
      { expr: '0 6 * * 1', desc: 'Weekly on Monday at 6:00 AM' },
      { expr: '0 0 1 * *', desc: 'Monthly on the 1st at midnight' },
      { expr: '0 0 * * 0', desc: 'Weekly on Sunday at midnight' },
      { expr: '*/15 * * * *', desc: 'Every 15 minutes' },
      { expr: '*/30 6-18 * * 1-5', desc: 'Every 30 min, 6 AM–6 PM, weekdays' },
      { expr: '0 8 1,15 * *', desc: '1st and 15th of each month at 8 AM' },
      { expr: '0 0 25 12 *', desc: 'December 25th at midnight' },
      { expr: '0 4 * * 1-5', desc: 'Weekdays at 4:00 AM' },
      { expr: '30 5 1,15 * 1-5', desc: '1st and 15th, weekdays, 5:30 AM' },
      { expr: '0 0 1 1,4,7,10 *', desc: 'Quarterly on the 1st at midnight' }
    ];

    const html = pageWrap('Cron Expression Reference', `
<div class="page-header">
  <h1>📖 Cron Expression Reference</h1>
  <p>Understand and build cron expressions for scheduling your tasks</p>
</div>
<div class="container">
  <div style="margin-bottom:16px"><a href="/admin/scheduled-tasks" class="btn btn-ghost">← Back to Tasks</a></div>

  <div class="card" style="margin-bottom:20px">
    <h2>🔢 Cron Syntax</h2>
    <p style="color:${C.textMuted};margin-bottom:12px">A cron expression has 5 fields separated by spaces:</p>
    <div style="overflow-x:auto"><table>
      <thead><tr><th>Field</th><th>Allowed Values</th><th>Special Characters</th></tr></thead>
      <tbody>
        <tr><td><strong>Minute</strong></td><td>0–59</td><td>, - * /</td></tr>
        <tr><td><strong>Hour</strong></td><td>0–23</td><td>, - * /</td></tr>
        <tr><td><strong>Day of Month</strong></td><td>1–31</td><td>, - * /</td></tr>
        <tr><td><strong>Month</strong></td><td>1–12 or JAN–DEC</td><td>, - * /</td></tr>
        <tr><td><strong>Day of Week</strong></td><td>0–7 (0 and 7 = Sunday)</td><td>, - * /</td></tr>
      </tbody>
    </table></div>
  </div>

  <div class="card" style="margin-bottom:20px">
    <h2>✨ Special Characters</h2>
    <div style="overflow-x:auto"><table>
      <thead><tr><th>Symbol</th><th>Meaning</th><th>Example</th><th>Description</th></tr></thead>
      <tbody>
        <tr><td><code style="color:${C.primaryLight}">*</code></td><td>Any value</td><td><code style="color:${C.primaryLight}">* * * * *</code></td><td>Run every minute of every hour of every day</td></tr>
        <tr><td><code style="color:${C.primaryLight}">,</code></td><td>Value list separator</td><td><code style="color:${C.primaryLight}">0 6,18 * * *</code></td><td>Run at 6 AM and 6 PM</td></tr>
        <tr><td><code style="color:${C.primaryLight}">-</code></td><td>Range</td><td><code style="color:${C.primaryLight}">0 9-17 * * *</code></td><td>Run every hour from 9 AM to 5 PM</td></tr>
        <tr><td><code style="color:${C.primaryLight}">/</code></td><td>Step values</td><td><code style="color:${C.primaryLight}">*/15 * * * *</code></td><td>Run every 15 minutes</td></tr>
      </tbody>
    </table></div>
  </div>

  <div class="card">
    <h2>📋 Common Examples</h2>
    <div style="overflow-x:auto"><table>
      <thead><tr><th>Expression</th><th>Description</th><th></th></tr></thead>
      <tbody>
      ${examples.map(e => `<tr>
        <td><code style="color:${C.primaryLight};font-weight:600;font-size:.88rem">${esc(e.expr)}</code></td>
        <td>${esc(e.desc)}</td>
        <td><button class="btn btn-sm btn-ghost" onclick="navigator.clipboard.writeText('${e.expr}');this.textContent='Copied!'">Copy</button></td>
      </tr>`).join('')}
      </tbody>
    </table></div>
  </div>
</div>`);
    res.send(opts.renderPage('Cron Help', html, req.session.user));
  }));

  // ── 13. POST /validate-cron — Validate a cron expression ─────────────────
  app.post('/admin/scheduled-tasks/validate-cron', requireAuth, ah(async (req, res) => {
    const { expression } = req.body;
    if (!expression || typeof expression !== 'string') {
      return res.status(400).json({ valid: false, error: 'Cron expression is required.' });
    }

    const parts = expression.trim().split(/\s+/);
    if (parts.length !== 5) {
      return res.json({ valid: false, error: `Expected 5 fields, got ${parts.length}. A cron expression must have: minute hour day month weekday.` });
    }

    const validators = [
      { name: 'minute', min: 0, max: 59 },
      { name: 'hour', min: 0, max: 23 },
      { name: 'day of month', min: 1, max: 31 },
      { name: 'month', min: 1, max: 12 },
      { name: 'day of week', min: 0, max: 7 }
    ];

    for (let i = 0; i < 5; i++) {
      const field = parts[i];
      const v = validators[i];
      if (!/^[\d,\-\/\*]+$/.test(field)) {
        return res.json({ valid: false, error: `Invalid character in "${v.name}" field: "${field}". Only digits, commas, hyphens, slashes, and asterisks are allowed.` });
      }
      const components = field.split(',');
      for (const comp of components) {
        if (comp.includes('/')) {
          const [range, step] = comp.split('/');
          if (!step || isNaN(step) || +step < 1) {
            return res.json({ valid: false, error: `Invalid step value in "${v.name}": "${comp}". Step must be a positive integer.` });
          }
          if (range !== '*' && range.includes('-')) {
            const [lo, hi] = range.split('-');
            if (isNaN(lo) || isNaN(hi) || +lo < v.min || +hi > v.max) {
              return res.json({ valid: false, error: `"${v.name}" range out of bounds (${v.min}–${v.max}): "${comp}".` });
            }
          }
        } else if (comp.includes('-')) {
          const [lo, hi] = comp.split('-');
          if (isNaN(lo) || isNaN(hi) || +lo < v.min || +hi > v.max || +lo > +hi) {
            return res.json({ valid: false, error: `Invalid range in "${v.name}" (${v.min}–${v.max}): "${comp}".` });
          }
        } else if (comp !== '*' && (isNaN(comp) || +comp < v.min || +comp > v.max)) {
          return res.json({ valid: false, error: `"${v.name}" must be ${v.min}–${v.max}, got "${comp}".` });
        }
      }
    }

    // Generate next 5 run times
    const nextRuns = generateNextRuns(parts);
    res.json({ valid: true, expression, next_runs: nextRuns });
  }));

  // Generate approximate next run times (simplified cron parser)
  function generateNextRuns(parts) {
    const runs = [];
    const now = new Date();
    const d = new Date(now);
    const [minP, hourP, domP, monP, dowP] = parts;

    function matches(date) {
      const vals = [date.getMinutes(), date.getHours(), date.getDate(), date.getMonth() + 1, date.getDay()];
      return parts.every((p, i) => {
        if (p === '*') return true;
        return matchField(p, vals[i]);
      });
    }

    function matchField(pattern, value) {
      if (pattern.includes('/')) {
        const [range, step] = pattern.split('/');
        const s = +step;
        if (range === '*') return value % s === 0;
        const [lo] = range.split('-').map(Number);
        return value >= lo && (value - lo) % s === 0;
      }
      if (pattern.includes('-')) {
        const [lo, hi] = pattern.split('-').map(Number);
        return value >= lo && value <= hi;
      }
      if (pattern.includes(',')) {
        return pattern.split(',').map(Number).includes(value);
      }
      return +pattern === value;
    }

    d.setMinutes(d.getMinutes() + 1, 0, 0);
    let safety = 0;
    while (runs.length < 5 && safety < 100000) {
      if (matches(d)) {
        runs.push(new Date(d).toISOString());
        d.setMinutes(d.getMinutes() + 1);
      } else {
        d.setMinutes(d.getMinutes() + 1);
      }
      safety++;
    }
    return runs;
  }

  // ── 14. GET /export/logs — Export execution logs CSV ─────────────────────
  app.get('/admin/scheduled-tasks/export/logs', requireAuth, ah(async (req, res) => {
    audit(req, 'export', 'execution_logs_csv');
    const sid = schoolId(req);
    const { status, from, to } = req.query;

    let where = 'WHERE tel.school_id = $1';
    const params = [sid];
    let pi = 2;

    if (status) { where += ` AND tel.status = $${pi++}`; params.push(status); }
    if (from) { where += ` AND tel.started_at >= $${pi++}`; params.push(from); }
    if (to) { where += ` AND tel.started_at <= $${pi++}`; params.push(to); }

    const { rows } = await pool.query(
      `SELECT tel.id, st.name AS task_name, tel.status, tel.trigger_type,
        tel.started_at, tel.finished_at, tel.duration_ms, tel.output, tel.error
       FROM task_execution_logs tel
       LEFT JOIN scheduled_tasks st ON st.id = tel.task_id
       ${where} ORDER BY tel.started_at DESC LIMIT 10000`, params);

    const header = 'ID,Task Name,Status,Trigger,Started,Finished,Duration (ms),Output,Error';
    const csvRows = rows.map(r => [
      r.id,
      `"${(r.task_name || '').replace(/"/g, '""')}"`,
      r.status || '',
      r.trigger_type || '',
      r.started_at || '',
      r.finished_at || '',
      r.duration_ms || 0,
      `"${(r.output || '').replace(/"/g, '""').replace(/\n/g, ' ')}"`,
      `"${(r.error || '').replace(/"/g, '""').replace(/\n/g, ' ')}"`
    ].join(','));

    const csv = [header, ...csvRows].join('\n');
    const filename = `execution-logs-${new Date().toISOString().slice(0, 10)}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  }));

  // ── 15. DELETE /cleanup-logs — Clean old execution logs ──────────────────
  app.delete('/admin/scheduled-tasks/cleanup-logs', requireAuth, ah(async (req, res) => {
    audit(req, 'delete', 'cleanup_execution_logs');
    const sid = schoolId(req);
    const { days = 30, status } = req.body;
    const daysNum = Math.max(1, Math.min(365, +days));

    let where = 'WHERE school_id = $1 AND started_at < NOW() - INTERVAL $2';
    const params = [sid, daysNum + ' days'];

    if (status) {
      where += ' AND status = $3';
      params.push(status);
    }

    const { rows: countResult } = await pool.query(
      `SELECT COUNT(*)::int AS total FROM task_execution_logs ${where}`, params);

    await pool.query(`DELETE FROM task_execution_logs ${where}`, params);

    res.json({
      success: true,
      deleted: countResult[0]?.total || 0,
      message: `Deleted ${countResult[0]?.total || 0} log entries older than ${daysNum} days.`
    });
  }));

  // ── 16. GET /settings — Task runner settings ────────────────────────────
  app.get('/admin/scheduled-tasks/settings', requireAuth, ah(async (req, res) => {
    audit(req, 'view', 'scheduled_tasks_settings');
    const sid = schoolId(req);

    const { rows: tasks } = await pool.query(
      `SELECT id, name, is_active, timeout_seconds, retry_limit, cron_expression FROM scheduled_tasks WHERE school_id = $1 ORDER BY name`, [sid]);
    const { rows: logCount } = await pool.query(
      `SELECT COUNT(*)::int AS total FROM task_execution_logs WHERE school_id = $1`, [sid]);
    const { rows: oldestLog } = await pool.query(
      `SELECT MIN(started_at) AS oldest FROM task_execution_logs WHERE school_id = $1`, [sid]);
    const { rows: recentLogs } = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM task_execution_logs WHERE school_id = $1 AND started_at > NOW() - INTERVAL '24 hours'`, [sid]);

    const activeTasks = tasks.filter(t => t.is_active).length;

    const html = pageWrap('Task Runner Settings', `
<div class="page-header">
  <h1>⚙️ Task Runner Settings</h1>
  <p>Configure and manage the task execution environment</p>
</div>
<div class="container">
  <div style="margin-bottom:16px"><a href="/admin/scheduled-tasks" class="btn btn-ghost">← Back to Tasks</a></div>

  <div class="grid" style="margin-bottom:20px">
    <div class="kpi"><div class="kpi-icon green">⚡</div><div class="kpi-label">Active Tasks</div><div class="kpi-value">${activeTasks}</div></div>
    <div class="kpi"><div class="kpi-icon blue">📊</div><div class="kpi-label">Total Logs</div><div class="kpi-value">${(logCount[0]?.total || 0).toLocaleString()}</div></div>
    <div class="kpi"><div class="kpi-icon yellow">🕐</div><div class="kpi-label">Runs (24h)</div><div class="kpi-value">${(recentLogs[0]?.cnt || 0).toLocaleString()}</div></div>
    <div class="kpi"><div class="kpi-icon red">📅</div><div class="kpi-label">Oldest Log</div><div class="kpi-value" style="font-size:1rem">${oldestLog[0]?.oldest ? timeAgo(oldestLog[0].oldest) : '—'}</div></div>
  </div>

  <div class="grid-2" style="margin-bottom:20px">
    <div class="card">
      <h2>🧹 Log Cleanup</h2>
      <p style="color:${C.textMuted};font-size:.85rem;margin-bottom:14px">Remove old execution logs to free up database space. Logs are stored in the <code>task_execution_logs</code> table.</p>
      <div class="form-row">
        <div class="form-group"><label>Delete logs older than (days)</label>
          <input type="number" id="cleanupDays" value="30" min="1" max="365"></div>
        <div class="form-group"><label>Only specific status</label>
          <select id="cleanupStatus"><option value="">All statuses</option><option value="success">Success only</option><option value="failed">Failed only</option></select></div>
      </div>
      <button class="btn btn-red" onclick="cleanupLogs()">🗑 Cleanup Logs</button>
      <div id="cleanupResult" style="margin-top:10px;font-size:.85rem"></div>
    </div>
    <div class="card">
      <h2>🔄 Bulk Toggle Tasks</h2>
      <p style="color:${C.textMuted};font-size:.85rem;margin-bottom:14px">Enable or disable multiple tasks at once. Useful for maintenance windows.</p>
      <div class="form-group"><label>Action</label>
        <select id="bulkAction"><option value="true">Activate All</option><option value="false">Pause All</option></select></div>
      <button class="btn btn-yellow" onclick="bulkToggle()">Apply to All Tasks</button>
      <div id="bulkResult" style="margin-top:10px;font-size:.85rem"></div>
    </div>
  </div>

  <div class="card" style="margin-bottom:20px">
    <h2>📋 Task Configuration Overview</h2>
    <div style="overflow-x:auto"><table>
      <thead><tr><th>Task</th><th>Active</th><th>Cron</th><th>Timeout</th><th>Retry Limit</th></tr></thead>
      <tbody>
      ${tasks.map(t => `<tr>
        <td><a href="/admin/scheduled-tasks/${t.id}/logs" style="color:${C.primaryLight}">${esc(t.name)}</a></td>
        <td>${toggleBadge(t.is_active)}</td>
        <td><code style="color:${C.primaryLight}">${esc(t.cron_expression || '-')}</code></td>
        <td>${t.timeout_seconds || 300}s</td>
        <td>${t.retry_limit || 3}</td>
      </tr>`).join('')}
      </tbody>
    </table></div>
  </div>

  <div class="card">
    <h2>📖 About Task Runner</h2>
    <div style="color:${C.textMuted};font-size:.88rem;line-height:1.7">
      <p><strong style="color:${C.text}">Scheduled Tasks Manager</strong> provides a comprehensive system for managing automated background jobs in your school portal.</p>
      <ul style="margin-top:8px;padding-left:20px">
        <li><strong style="color:${C.text}">Handler Path</strong> — Path to a Node.js module that exports a function. The function receives <code>(payload, context)</code> where context has <code>pool</code> and <code>task</code>.</li>
        <li><strong style="color:${C.text}">Timeout</strong> — Maximum execution time per run (default: 300s). Tasks exceeding this are marked as "timeout".</li>
        <li><strong style="color:${C.text}">Retry Limit</strong> — Number of retries on failure before giving up (default: 3).</li>
        <li><strong style="color:${C.text}">Payload</strong> — JSON data passed to the handler function on each execution.</li>
        <li><strong style="color:${C.text}">Manual Execution</strong> — Any active task can be triggered immediately via the "Run" button.</li>
      </ul>
    </div>
  </div>
</div>
<script>
function cleanupLogs(){
  const days=document.getElementById('cleanupDays').value;
  const status=document.getElementById('cleanupStatus').value;
  fetch('/admin/scheduled-tasks/cleanup-logs',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({days:+days,status:status||null})})
  .then(r=>r.json()).then(d=>{document.getElementById('cleanupResult').innerHTML='<span style="color:${C.green}">✅ '+d.message+'</span>'})
  .catch(e=>{document.getElementById('cleanupResult').innerHTML='<span style="color:${C.red}">❌ '+e.message+'</span>'});
}
function bulkToggle(){
  const active=document.getElementById('bulkAction').value==='true';
  fetch('/admin/scheduled-tasks/data').then(r=>r.json()).then(d=>{
    const ids=d.tasks.map(t=>t.id);
    fetch('/admin/scheduled-tasks/bulk-toggle',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids,is_active:active})})
    .then(r=>r.json()).then(d=>{document.getElementById('bulkResult').innerHTML='<span style="color:${C.green}">✅ '+d.message+'</span>';setTimeout(()=>location.reload(),1500)})
    .catch(e=>{document.getElementById('bulkResult').innerHTML='<span style="color:${C.red}">❌ '+e.message+'</span>'});
  });
}
</script>`);
    res.send(opts.renderPage('Task Runner Settings', html, req.session.user));
  }));

  // ── Internal: buildDashboardHTML for renderPage integration ──────────────
  function buildDashboardHTML(title, bodyHtml, req) {
    // This function is called by buildPage — used for renderPage integration
    return bodyHtml;
  }

  // ── Initialize ───────────────────────────────────────────────────────────
  (async () => { await migrate(); })();
};
