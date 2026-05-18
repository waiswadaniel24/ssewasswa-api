// ============================================================
// SLOW QUERY MONITOR MODULE — School SaaS Portal
// Tracks, analyzes, and optimizes slow database queries.
// Provides dashboards, EXPLAIN ANALYZE, optimization rules,
// auto-explain toggling, CSV export, and cleanup tools.
// ============================================================
// Usage in server.js:
//   const slowQueryMonitor = require('./slow-query-monitor');
//   slowQueryMonitor(app, pool, opts);
// ============================================================

'use strict';

module.exports = function (app, pool, opts) {
  const esc = opts.esc || (s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));
  const renderPage = opts.renderPage || ((req, res, title, html) => res.send(html));
  const ah = opts.ah || ((fn) => async (req, res, next) => { try { await fn(req, res, next); } catch (e) { res.status(500).send('Error: ' + e.message); } });
  const requireAuth = opts.requireAuth || ((req, res, next) => { if (!req.session?.user) return res.redirect('/login'); next(); });
  const audit = opts.audit || (() => {});
  const tenantId = (req) => req.session?.user?.tenant_id || req.session?.user?.school_id || 1;

  // ── Color Palette (Dark Theme with Blue Accents) ──────────────────────
  const C = {
    bg: '#0f172a', surface: '#1e293b', surface2: '#334155', border: '#475569',
    text: '#f1f5f9', text2: '#94a3b8', text3: '#64748b',
    primary: '#3b82f6', primaryHover: '#2563eb', primaryDim: 'rgba(59,130,246,0.15)',
    green: '#22c55e', greenDim: 'rgba(34,197,94,0.15)',
    yellow: '#eab308', yellowDim: 'rgba(234,179,8,0.15)',
    red: '#ef4444', redDim: 'rgba(239,68,68,0.15)',
    purple: '#a855f7', orange: '#f97316', cyan: '#06b6d4',
  };

  // ── Helper Utilities ──────────────────────────────────────────────────
  function fmtNum(n) { return n != null ? Number(n).toLocaleString() : '0'; }
  function timeAgo(dt) {
    if (!dt) return '-';
    const diff = Date.now() - new Date(dt).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ${mins % 60}m ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }
  function fmtDT(d) {
    if (!d) return '-';
    return new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function truncate(s, len) { return s && s.length > len ? s.substring(0, len) + '...' : (s || ''); }
  function statusBadge(status) {
    const m = {
      active: `background:${C.redDim};color:${C.red}`,
      optimized: `background:${C.greenDim};color:${C.green}`,
      dismissed: `background:${C.yellowDim};color:${C.yellow}`,
      resolved: `background:${C.greenDim};color:${C.green}`,
    };
    return `<span style="display:inline-block;padding:3px 12px;border-radius:99px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;${m[status] || `background:${C.primaryDim};color:${C.primary}`}">${esc(status || 'unknown')}</span>`;
  }
  function severityBadge(sev) {
    const m = {
      low: `background:${C.greenDim};color:${C.green}`,
      medium: `background:${C.yellowDim};color:${C.yellow}`,
      high: `background:${C.redDim};color:${C.red}`,
      critical: `background:${C.redDim};color:${C.red}`,
    };
    return `<span style="display:inline-block;padding:3px 12px;border-radius:99px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;${m[sev] || m.medium}">${esc(sev || 'medium')}</span>`;
  }

  // ── SVG Chart Generators ──────────────────────────────────────────────
  function svgBarChart(data, w = 600, h = 200, color = C.primary) {
    if (!data || !data.length) return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect fill="${C.surface}" width="${w}" height="${h}" rx="8"/><text x="${w/2}" y="${h/2}" text-anchor="middle" fill="${C.text3}" font-size="13">No data</text></svg>`;
    const pad = { t: 20, r: 20, b: 50, l: 50 };
    const cw = w - pad.l - pad.r, ch = h - pad.t - pad.b;
    const maxVal = Math.max(...data.map(d => d.value), 1);
    const barW = Math.min(40, Math.max(8, (cw / data.length) - 4));
    const gap = (cw - barW * data.length) / (data.length + 1);

    let svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">`;
    svg += `<rect fill="${C.surface}" width="${w}" height="${h}" rx="8"/>`;

    // Grid lines
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + (ch / 4) * i;
      const val = maxVal - (maxVal / 4) * i;
      svg += `<line x1="${pad.l}" y1="${y}" x2="${w - pad.r}" y2="${y}" stroke="${C.border}" stroke-width="0.5" stroke-dasharray="3,3" opacity="0.5"/>`;
      svg += `<text x="${pad.l - 6}" y="${y + 4}" text-anchor="end" font-size="10" fill="${C.text3}">${val >= 1000 ? (val/1000).toFixed(1)+'k' : val.toFixed(val >= 10 ? 0 : 1)}</text>`;
    }

    data.forEach((d, i) => {
      const bh = Math.max(2, (d.value / maxVal) * ch);
      const x = pad.l + gap + i * (barW + gap);
      const y = pad.t + ch - bh;
      const c = d.color || color;
      svg += `<rect x="${x}" y="${y}" width="${barW}" height="${bh}" rx="4" fill="${c}" opacity="0.85">`;
      svg += `<title>${esc(d.label)}: ${d.value}</title></rect>`;
      // X label (rotate if many bars)
      if (data.length <= 15 || i % 2 === 0) {
        const lbl = truncate(d.label, 10);
        svg += `<text x="${x + barW/2}" y="${h - pad.b + 14}" text-anchor="middle" font-size="9" fill="${C.text3}" transform="rotate(-25 ${x + barW/2} ${h - pad.b + 14})">${esc(lbl)}</text>`;
      }
    });
    svg += '</svg>';
    return svg;
  }

  function svgTimelineChart(data, w = 600, h = 160, color = C.primary) {
    if (!data || !data.length) return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect fill="${C.surface}" width="${w}" height="${h}" rx="8"/><text x="${w/2}" y="${h/2}" text-anchor="middle" fill="${C.text3}" font-size="13">No data</text></svg>`;
    const pad = { t: 16, r: 16, b: 36, l: 44 };
    const cw = w - pad.l - pad.r, ch = h - pad.t - pad.b;
    const values = data.map(d => d.value);
    const maxVal = Math.max(...values, 1);
    const minVal = Math.min(...values, 0);
    const range = maxVal - minVal || 1;

    let svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">`;
    svg += `<rect fill="${C.surface}" width="${w}" height="${h}" rx="8"/>`;

    // Grid
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + (ch / 4) * i;
      const val = maxVal - (range / 4) * i;
      svg += `<line x1="${pad.l}" y1="${y}" x2="${w - pad.r}" y2="${y}" stroke="${C.border}" stroke-width="0.5" stroke-dasharray="3,3" opacity="0.4"/>`;
      svg += `<text x="${pad.l - 6}" y="${y + 4}" text-anchor="end" font-size="9" fill="${C.text3}">${val >= 1000 ? (val/1000).toFixed(1)+'k' : val.toFixed(val >= 10 ? 0 : 1)}</text>`;
    }

    // Area path
    const pts = data.map((d, i) => ({
      x: pad.l + (i / (data.length - 1)) * cw,
      y: pad.t + ch - ((d.value - minVal) / range) * ch,
      label: d.label
    }));

    if (pts.length > 1) {
      const linePath = pts.map(p => `${p.x},${p.y}`).join(' ');
      const areaPath = `${pts[0].x},${pad.t + ch} ${linePath} ${pts[pts.length-1].x},${pad.t + ch}`;
      svg += `<polygon points="${areaPath}" fill="${color}" opacity="0.12"/>`;
      svg += `<polyline points="${linePath}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
      svg += `<circle cx="${pts[pts.length-1].x}" cy="${pts[pts.length-1].y}" r="4" fill="${color}"/>`;
    }

    // X labels
    const step = Math.max(1, Math.floor(data.length / 8));
    data.forEach((d, i) => {
      if (i % step === 0 || i === data.length - 1) {
        const x = pad.l + (i / (data.length - 1)) * cw;
        svg += `<text x="${x}" y="${h - pad.b + 14}" text-anchor="middle" font-size="9" fill="${C.text3}">${esc(truncate(d.label, 6))}</text>`;
      }
    });
    svg += '</svg>';
    return svg;
  }

  // ── Shared Dark Theme CSS ──────────────────────────────────────────────
  const DARK_CSS = `
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:${C.bg};color:${C.text};line-height:1.6}
    a{color:${C.primary};text-decoration:none;transition:color .15s}
    a:hover{color:${C.primaryHover}}
    .sqm-topbar{background:${C.surface};border-bottom:1px solid ${C.border};padding:14px 24px;display:flex;align-items:center;gap:14px;position:sticky;top:0;z-index:100;backdrop-filter:blur(12px)}
    .sqm-topbar h1{font-size:1.1rem;font-weight:700;color:${C.text};display:flex;align-items:center;gap:8px}
    .sqm-topbar .live{width:8px;height:8px;border-radius:50%;background:${C.green};display:inline-block;animation:pulse 2s infinite}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
    .sqm-nav{display:flex;gap:4px;padding:10px 24px;background:${C.bg};border-bottom:1px solid ${C.border};flex-wrap:wrap}
    .sqm-nav a{padding:7px 14px;border-radius:8px;font-size:12px;font-weight:600;color:${C.text2};transition:all .15s}
    .sqm-nav a:hover{background:${C.surface2};color:${C.text}}
    .sqm-nav a.active{background:${C.primary};color:#fff}
    .sqm-main{padding:20px 24px;max-width:1280px;margin:0 auto}
    .sqm-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-bottom:20px}
    .sqm-card{background:${C.surface};border:1px solid ${C.border};border-radius:12px;padding:20px;margin-bottom:16px}
    .sqm-card h3{font-size:.92rem;font-weight:700;color:${C.text};margin-bottom:14px;display:flex;align-items:center;gap:8px}
    .sqm-kpi{background:${C.surface};border:1px solid ${C.border};border-radius:12px;padding:20px;transition:transform .15s,box-shadow .15s}
    .sqm-kpi:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(0,0,0,.3)}
    .sqm-kpi-label{font-size:.72rem;color:${C.text3};text-transform:uppercase;letter-spacing:.06em;font-weight:700;margin-bottom:6px}
    .sqm-kpi-value{font-size:1.8rem;font-weight:800;color:${C.text};margin-bottom:4px}
    .sqm-kpi-sub{font-size:.78rem;color:${C.text3}}
    .sqm-table{width:100%;border-collapse:collapse;font-size:.82rem}
    .sqm-table th{padding:10px 14px;text-align:left;border-bottom:2px solid ${C.border};color:${C.text3};font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;font-weight:700;background:${C.bg}}
    .sqm-table td{padding:9px 14px;border-bottom:1px solid ${C.border};color:${C.text2};vertical-align:top}
    .sqm-table tr:hover td{background:rgba(59,130,246,.04)}
    .sqm-btn{display:inline-flex;align-items:center;gap:6px;padding:8px 18px;border:none;border-radius:8px;font-size:.82rem;font-weight:700;cursor:pointer;transition:all .15s;text-decoration:none}
    .sqm-btn:hover{transform:translateY(-1px)}
    .sqm-btn-primary{background:${C.primary};color:#fff}.sqm-btn-primary:hover{background:${C.primaryHover}}
    .sqm-btn-danger{background:${C.red};color:#fff}.sqm-btn-danger:hover{opacity:.85}
    .sqm-btn-success{background:${C.green};color:#fff}.sqm-btn-success:hover{opacity:.85}
    .sqm-btn-ghost{background:transparent;color:${C.text2};border:1px solid ${C.border}}.sqm-btn-ghost:hover{background:${C.surface2};color:${C.text}}
    .sqm-btn-sm{padding:5px 12px;font-size:.75rem}
    .sqm-input,.sqm-select,.sqm-textarea{width:100%;padding:9px 14px;background:${C.bg};border:1px solid ${C.border};border-radius:8px;color:${C.text};font-size:.85rem;transition:border .15s}
    .sqm-input:focus,.sqm-select:focus,.sqm-textarea:focus{outline:none;border-color:${C.primary};box-shadow:0 0 0 3px ${C.primaryDim}}
    .sqm-textarea{resize:vertical;font-family:'Fira Code',monospace;font-size:.82rem}
    .sqm-label{display:block;font-size:.78rem;font-weight:700;color:${C.text2};margin-bottom:5px;text-transform:uppercase;letter-spacing:.04em}
    .sqm-code{background:${C.bg};color:${C.text2};padding:14px 18px;border-radius:8px;border:1px solid ${C.border};font-family:'Fira Code',monospace;font-size:.78rem;overflow-x:auto;white-space:pre-wrap;word-break:break-all;max-height:220px;overflow-y:auto;line-height:1.7}
    .sqm-empty{text-align:center;padding:48px 20px;color:${C.text3}}
    .sqm-empty svg{margin-bottom:12px;opacity:.3}
    .sqm-alert{padding:12px 18px;border-radius:10px;margin-bottom:16px;font-size:.85rem;display:flex;align-items:center;gap:10px}
    .sqm-alert-warn{background:${C.yellowDim};border:1px solid ${C.yellow};color:${C.yellow}}
    .sqm-alert-danger{background:${C.redDim};border:1px solid ${C.red};color:${C.red}}
    .sqm-alert-info{background:${C.primaryDim};border:1px solid ${C.primary};color:${C.primary}}
    .sqm-flex{display:flex;gap:16px;flex-wrap:wrap}
    .sqm-flex>*{flex:1;min-width:280px}
    .sqm-badge{display:inline-block;padding:3px 12px;border-radius:99px;font-size:11px;font-weight:700;letter-spacing:.3px}
    @media(max-width:768px){.sqm-main{padding:14px}.sqm-grid{grid-template-columns:1fr 1fr}.sqm-flex{flex-direction:column}}
  `;

  // ── Layout Shell ──────────────────────────────────────────────────────
  function layout(active, title, content) {
    const navItems = [
      ['/', 'Dashboard'], ['/data', 'Query Log'], ['/top-worst', 'Top Worst'],
      ['/rules', 'Rules'], ['/stats', 'Statistics'], ['/settings', 'Settings'],
    ];
    const prefix = '/admin/slow-queries';
    const nav = navItems.map(([p, l]) =>
      `<a href="${prefix}${p}" class="${active === p ? 'active' : ''}">${l}</a>`
    ).join('');
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(title)} — Slow Query Monitor</title>
<style>${DARK_CSS}</style></head><body>
<div class="sqm-topbar">
  <h1>🐢 Slow Query Monitor</h1>
  <span style="color:${C.text3};font-size:.83rem"><span class="live"></span> ${esc(title)}</span>
</div>
<div class="sqm-nav">${nav}</div>
<main class="sqm-main">${content}</main>
</body></html>`;
  }

  function kpiCard(label, value, sub, color) {
    const c = color || C.primary;
    return `<div class="sqm-kpi">
      <div class="sqm-kpi-label">${esc(label)}</div>
      <div class="sqm-kpi-value" style="color:${c}">${value}</div>
      <div class="sqm-kpi-sub">${sub || ''}</div>
    </div>`;
  }

  // ── Database Migrations ──────────────────────────────────────────────
  async function migrate() {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS migrations (
          id SERIAL PRIMARY KEY,
          name VARCHAR(200) NOT NULL UNIQUE,
          applied_at TIMESTAMPTZ DEFAULT NOW()
        )`);
    } catch (e) { /* migrations table may already exist */ }

    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS slow_queries_log (
          id SERIAL PRIMARY KEY,
          query_text TEXT,
          execution_time_ms FLOAT,
          calls_count INT DEFAULT 1,
          mean_time FLOAT,
          rows_affected INT,
          query_hash TEXT,
          db_user TEXT,
          query_plan TEXT,
          first_seen TIMESTAMPTZ DEFAULT NOW(),
          last_seen TIMESTAMPTZ DEFAULT NOW(),
          status TEXT DEFAULT 'active',
          notes TEXT,
          school_id INT DEFAULT 1
        )`);
      await pool.query(`CREATE INDEX IF NOT EXISTS sql_status_idx ON slow_queries_log(status)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS sql_hash_idx ON slow_queries_log(query_hash)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS sql_school_idx ON slow_queries_log(school_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS sql_time_idx ON slow_queries_log(execution_time_ms DESC)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS sql_last_seen_idx ON slow_queries_log(last_seen DESC)`);
    } catch (e) { /* table/index may already exist */ }

    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS query_optimization_rules (
          id SERIAL PRIMARY KEY,
          pattern TEXT NOT NULL,
          suggestion TEXT NOT NULL,
          severity TEXT DEFAULT 'medium',
          created_at TIMESTAMPTZ DEFAULT NOW(),
          school_id INT DEFAULT 1
        )`);
      await pool.query(`CREATE INDEX IF NOT EXISTS qor_school_idx ON query_optimization_rules(school_id)`);
    } catch (e) { /* table/index may already exist */ }

    try {
      await pool.query(`
        INSERT INTO migrations (name) VALUES ('slow_query_monitor_tables')
        ON CONFLICT DO NOTHING`);
    } catch (e) { /* already recorded */ }
  }

  // ── Initialize ────────────────────────────────────────────────────────
  (async () => { await migrate(); })();

  // ================================================================
  // ROUTE 1: GET / - Dashboard with KPI Cards
  // ================================================================
  app.get('/admin/slow-queries', requireAuth, ah(async (req, res) => {
    audit(req, 'view', 'slow_query_dashboard');
    const sid = tenantId(req);

    let totalQueries = 0, avgExecTime = 0, worstQuery = null, needAttention = 0;
    let recentQueries = [];
    let hourlyData = [];

    try {
      const { rows: stats } = await pool.query(
        `SELECT COUNT(*)::int AS total,
                COALESCE(AVG(execution_time_ms), 0)::numeric(10,1) AS avg_time,
                COALESCE(MAX(execution_time_ms), 0)::numeric(10,1) AS max_time
         FROM slow_queries_log WHERE school_id = $1`, [sid]);
      totalQueries = stats[0]?.total || 0;
      avgExecTime = stats[0]?.avg_time || 0;

      const { rows: worst } = await pool.query(
        `SELECT id, query_text, execution_time_ms FROM slow_queries_log
         WHERE school_id = $1 AND status = 'active'
         ORDER BY execution_time_ms DESC LIMIT 1`, [sid]);
      worstQuery = worst[0] || null;

      const { rows: attn } = await pool.query(
        `SELECT COUNT(*)::int AS cnt FROM slow_queries_log
         WHERE school_id = $1 AND status = 'active' AND execution_time_ms > 2000`, [sid]);
      needAttention = attn[0]?.cnt || 0;
    } catch (e) { /* db error */ }

    try {
      const { rows: recent } = await pool.query(
        `SELECT * FROM slow_queries_log WHERE school_id = $1 ORDER BY last_seen DESC LIMIT 10`, [sid]);
      recentQueries = recent;
    } catch (e) { /* db error */ }

    try {
      const { rows: hourly } = await pool.query(
        `SELECT date_trunc('hour', last_seen) AS hour, COUNT(*)::int AS cnt,
                AVG(execution_time_ms)::numeric(10,1) AS avg_ms
         FROM slow_queries_log WHERE school_id = $1 AND last_seen > NOW() - INTERVAL '48 hours'
         GROUP BY hour ORDER BY hour`, [sid]);
      hourlyData = hourly;
    } catch (e) { /* db error */ }

    // Bar chart — Top queries by execution time
    const barData = recentQueries.slice(0, 8).map(q => ({
      label: truncate(q.query_text || 'N/A', 20),
      value: q.execution_time_ms || 0,
      color: q.execution_time_ms > 5000 ? C.red : q.execution_time_ms > 2000 ? C.yellow : C.primary,
    }));

    // Timeline chart — hourly
    const timelineData = hourlyData.map(h => ({
      label: h.hour ? new Date(h.hour).toLocaleString('en-GB', { hour: '2-digit', day: '2-digit', month: 'short' }) : '',
      value: h.cnt || 0,
    }));

    const avgColor = avgExecTime > 3000 ? C.red : avgExecTime > 1000 ? C.yellow : C.green;

    const html = layout('/', 'Dashboard', `
      <div class="sqm-grid">
        ${kpiCard('Total Slow Queries', fmtNum(totalQueries), 'Queries exceeding threshold', C.primary)}
        ${kpiCard('Avg Execution Time', `${avgExecTime} ms`, 'Mean across all logged queries', avgColor)}
        ${kpiCard('Worst Query', worstQuery ? `${worstQuery.execution_time_ms} ms` : 'N/A',
          worstQuery ? truncate(worstQuery.query_text, 40) : 'No queries recorded', C.red)}
        ${kpiCard('Needs Attention', fmtNum(needAttention), 'Active queries > 2s', needAttention > 0 ? C.red : C.green)}
      </div>

      ${needAttention > 0 ? `<div class="sqm-alert sqm-alert-danger">⚠️ <strong>${needAttention} queries</strong> are taking over 2 seconds — review immediately</div>` : ''}

      <div class="sqm-flex" style="margin-bottom:16px">
        <div class="sqm-card">
          <h3>📊 Top Slow Queries by Execution Time</h3>
          ${svgBarChart(barData, 580, 200, C.primary)}
        </div>
        <div class="sqm-card">
          <h3>📈 Query Volume (48h Timeline)</h3>
          ${svgTimelineChart(timelineData, 580, 180, C.cyan)}
        </div>
      </div>

      <div class="sqm-card">
        <h3>🕐 Recent Slow Queries</h3>
        ${recentQueries.length ? `<div style="overflow-x:auto"><table class="sqm-table">
          <thead><tr><th>ID</th><th>Query</th><th>Time (ms)</th><th>Status</th><th>Last Seen</th><th>Actions</th></tr></thead>
          <tbody>
          ${recentQueries.map(q => `<tr>
            <td style="font-weight:600;color:${C.primary}">#${q.id}</td>
            <td style="max-width:300px"><div class="sqm-code" style="max-height:60px;margin:0">${esc(truncate(q.query_text, 120))}</div></td>
            <td><span style="color:${q.execution_time_ms > 5000 ? C.red : q.execution_time_ms > 2000 ? C.yellow : C.green};font-weight:700">${(q.execution_time_ms || 0).toFixed(1)}</span></td>
            <td>${statusBadge(q.status)}</td>
            <td style="white-space:nowrap;font-size:.78rem;color:${C.text3}">${timeAgo(q.last_seen)}</td>
            <td style="white-space:nowrap">
              <a href="/admin/slow-queries/query/${q.id}" class="sqm-btn sqm-btn-primary sqm-btn-sm">View</a>
              ${q.status === 'active' ? `<a href="#" onclick="dismissQuery(${q.id});return false" class="sqm-btn sqm-btn-ghost sqm-btn-sm">Dismiss</a>` : ''}
            </td>
          </tr>`).join('')}
          </tbody>
        </table></div>` : `<div class="sqm-empty"><p>No slow queries recorded yet.</p></div>`}
      </div>
    `);
    renderPage(req, res, 'admin/slow-queries', { title: 'Slow Query Monitor', html });
  }));

  // ================================================================
  // ROUTE 2: GET /data - JSON list of slow queries with filtering
  // ================================================================
  app.get('/admin/slow-queries/data', requireAuth, ah(async (req, res) => {
    const sid = tenantId(req);
    const status = req.query.status || '';
    const minTime = parseFloat(req.query.min_time) || 0;
    const search = (req.query.search || '').trim();
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(10, parseInt(req.query.limit) || 25));
    const offset = (page - 1) * limit;

    let where = 'WHERE school_id = $1';
    const params = [sid];
    let pi = 2;

    if (status) { where += ` AND status = $${pi++}`; params.push(status); }
    if (minTime > 0) { where += ` AND execution_time_ms >= $${pi++}`; params.push(minTime); }
    if (search) { where += ` AND (query_text ILIKE $${pi} OR notes ILIKE $${pi})`; params.push('%' + search + '%'); pi++; }

    let total = 0, queries = [];

    try {
      const { rows: cnt } = await pool.query(`SELECT COUNT(*)::int AS cnt FROM slow_queries_log ${where}`, params);
      total = cnt[0]?.cnt || 0;
    } catch (e) { /* db error */ }

    try {
      const dataParams = [...params, limit, offset];
      const { rows } = await pool.query(
        `SELECT * FROM slow_queries_log ${where} ORDER BY last_seen DESC LIMIT $${pi++} OFFSET $${pi++}`, dataParams);
      queries = rows;
    } catch (e) { /* db error */ }

    res.json({
      success: true,
      data: queries,
      pagination: {
        page, limit, total,
        totalPages: Math.ceil(total / limit),
      },
      filters: { status, min_time: minTime, search },
    });
  }));

  // ================================================================
  // ROUTE 3: GET /query/:id - Detailed view with EXPLAIN ANALYZE
  // ================================================================
  app.get('/admin/slow-queries/query/:id', requireAuth, ah(async (req, res) => {
    audit(req, 'view', 'slow_query_detail', { id: req.params.id });
    const sid = tenantId(req);
    const queryId = parseInt(req.params.id);

    let query = null;
    try {
      const { rows } = await pool.query(
        `SELECT * FROM slow_queries_log WHERE id = $1 AND school_id = $2`, [queryId, sid]);
      query = rows[0] || null;
    } catch (e) { /* db error */ }

    if (!query) {
      const html = layout('/data', 'Query Not Found', `
        <div class="sqm-card">
          <div class="sqm-empty">
            <p style="font-size:2rem;margin-bottom:12px">🔍</p>
            <p>Query #${esc(String(queryId))} not found.</p>
            <a href="/admin/slow-queries" class="sqm-btn sqm-btn-primary" style="margin-top:16px">Back to Dashboard</a>
          </div>
        </div>
      `);
      renderPage(req, res, 'admin/slow-queries', { title: 'Query Not Found', html });
      return;
    }

    // Find matching optimization rules
    let matchingRules = [];
    try {
      const { rows: rules } = await pool.query(
        `SELECT * FROM query_optimization_rules WHERE school_id = $1`, [sid]);
      matchingRules = rules.filter(r => query.query_text && query.query_text.toLowerCase().includes(r.pattern.toLowerCase()));
    } catch (e) { /* db error */ }

    const execColor = query.execution_time_ms > 5000 ? C.red : query.execution_time_ms > 2000 ? C.yellow : C.green;

    const html = layout('/data', `Query #${queryId}`, `
      <a href="/admin/slow-queries" class="sqm-btn sqm-btn-ghost" style="margin-bottom:16px">← Back to Dashboard</a>

      <div class="sqm-grid">
        ${kpiCard('Query ID', '#' + query.id, '', C.primary)}
        ${kpiCard('Execution Time', (query.execution_time_ms || 0).toFixed(1) + ' ms', '', execColor)}
        ${kpiCard('Calls Count', fmtNum(query.calls_count), 'Times executed', C.cyan)}
        ${kpiCard('Mean Time', (query.mean_time || 0).toFixed(1) + ' ms', 'Average per call', C.purple)}
      </div>

      <div class="sqm-flex">
        <div class="sqm-card">
          <h3>📝 Query Text</h3>
          <div class="sqm-code">${esc(query.query_text || 'No query text available')}</div>
        </div>
        <div class="sqm-card">
          <h3>📋 Details</h3>
          <table class="sqm-table">
            <tr><td style="color:${C.text3};width:40%">Status</td><td>${statusBadge(query.status)}</td></tr>
            <tr><td style="color:${C.text3}">DB User</td><td>${esc(query.db_user || '-')}</td></tr>
            <tr><td style="color:${C.text3}">Query Hash</td><td><code style="color:${C.cyan}">${esc(truncate(query.query_hash, 24))}</code></td></tr>
            <tr><td style="color:${C.text3}">Rows Affected</td><td>${fmtNum(query.rows_affected)}</td></tr>
            <tr><td style="color:${C.text3}">First Seen</td><td>${fmtDT(query.first_seen)}</td></tr>
            <tr><td style="color:${C.text3}">Last Seen</td><td>${fmtDT(query.last_seen)}</td></tr>
            <tr><td style="color:${C.text3}">Notes</td><td>${esc(query.notes || 'None')}</td></tr>
          </table>
        </div>
      </div>

      ${query.query_plan ? `<div class="sqm-card"><h3>🔍 EXPLAIN ANALYZE Result</h3><div class="sqm-code" style="max-height:400px">${esc(query.query_plan)}</div></div>` : ''}

      ${matchingRules.length ? `<div class="sqm-card"><h3>💡 Matching Optimization Rules (${matchingRules.length})</h3>
        ${matchingRules.map(r => `<div style="padding:10px;background:${C.bg};border-radius:8px;margin-bottom:8px;border:1px solid ${C.border}">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">${severityBadge(r.severity)} <strong>${esc(truncate(r.suggestion, 80))}</strong></div>
          <div style="font-size:.78rem;color:${C.text3}">Pattern: <code>${esc(r.pattern)}</code></div>
        </div>`).join('')}
      </div>` : ''}

      <div class="sqm-card">
        <h3>⚙️ Actions</h3>
        <form method="POST" action="/admin/slow-queries/analyze" style="margin-bottom:12px">
          <input type="hidden" name="query_id" value="${query.id}">
          <button type="submit" class="sqm-btn sqm-btn-primary">🔬 Run EXPLAIN ANALYZE</button>
        </form>
        ${query.status === 'active' ? `
        <form method="POST" action="/admin/slow-queries/optimize/${query.id}" style="margin-bottom:12px;display:inline-block">
          <button type="submit" class="sqm-btn sqm-btn-success">✅ Mark as Optimized</button>
        </form>
        <form method="POST" action="/admin/slow-queries/dismiss/${query.id}" style="display:inline-block">
          <button type="submit" class="sqm-btn sqm-btn-ghost">🚫 Dismiss Alert</button>
        </form>` : ''}
      </div>
    `);
    renderPage(req, res, 'admin/slow-queries', { title: `Slow Query #${queryId}`, html });
  }));

  // ================================================================
  // ROUTE 4: POST /analyze - Run EXPLAIN ANALYZE on a query
  // ================================================================
  app.post('/admin/slow-queries/analyze', requireAuth, ah(async (req, res) => {
    audit(req, 'run', 'slow_query_analyze', { id: req.body.query_id });
    const sid = tenantId(req);
    const queryId = parseInt(req.body.query_id) || parseInt(req.query.id) || 0;

    let query = null;
    try {
      const { rows } = await pool.query(
        `SELECT * FROM slow_queries_log WHERE id = $1 AND school_id = $2`, [queryId, sid]);
      query = rows[0] || null;
    } catch (e) { /* db error */ }

    if (!query || !query.query_text) {
      return res.redirect('/admin/slow-queries');
    }

    let planResult = 'Error running EXPLAIN ANALYZE';
    try {
      const { rows: explainRows } = await pool.query(`EXPLAIN ANALYZE ${query.query_text}`);
      planResult = explainRows.map(r => r['QUERY PLAN']).join('\n');
    } catch (e) {
      planResult = 'EXPLAIN ANALYZE failed: ' + e.message;
    }

    try {
      await pool.query(
        `UPDATE slow_queries_log SET query_plan = $1, last_seen = NOW() WHERE id = $2 AND school_id = $3`,
        [planResult, queryId, sid]);
    } catch (e) { /* db error */ }

    res.redirect('/admin/slow-queries/query/' + queryId);
  }));

  // ================================================================
  // ROUTE 5: POST /optimize/:id - Mark as optimized
  // ================================================================
  app.post('/admin/slow-queries/optimize/:id', requireAuth, ah(async (req, res) => {
    audit(req, 'update', 'slow_query_optimize', { id: req.params.id });
    const sid = tenantId(req);
    const queryId = parseInt(req.params.id);

    try {
      await pool.query(
        `UPDATE slow_queries_log SET status = 'optimized', notes = COALESCE(notes || ' | ', '') || 'Optimized by ' || $3 || ' at ' || NOW()::text, last_seen = NOW()
         WHERE id = $1 AND school_id = $2`,
        [queryId, sid, req.session?.user?.email || 'admin']);
    } catch (e) { /* db error */ }

    res.redirect('/admin/slow-queries/query/' + queryId);
  }));

  // ================================================================
  // ROUTE 6: POST /dismiss/:id - Dismiss alert
  // ================================================================
  app.post('/admin/slow-queries/dismiss/:id', requireAuth, ah(async (req, res) => {
    audit(req, 'update', 'slow_query_dismiss', { id: req.params.id });
    const sid = tenantId(req);
    const queryId = parseInt(req.params.id);

    try {
      await pool.query(
        `UPDATE slow_queries_log SET status = 'dismissed', notes = COALESCE(notes || ' | ', '') || 'Dismissed by ' || $3 || ' at ' || NOW()::text
         WHERE id = $1 AND school_id = $2`,
        [queryId, sid, req.session?.user?.email || 'admin']);
    } catch (e) { /* db error */ }

    const referer = req.headers.referer || '/admin/slow-queries';
    res.redirect(referer);
  }));

  // ================================================================
  // ROUTE 7: POST /rules - Add new optimization rule
  // ================================================================
  app.post('/admin/slow-queries/rules', requireAuth, ah(async (req, res) => {
    audit(req, 'create', 'optimization_rule');
    const sid = tenantId(req);
    const { pattern, suggestion, severity } = req.body;

    if (!pattern || !suggestion) {
      return res.json({ success: false, error: 'Pattern and suggestion are required.' });
    }

    try {
      const { rows } = await pool.query(
        `INSERT INTO query_optimization_rules (pattern, suggestion, severity, school_id)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [pattern.trim(), suggestion.trim(), severity || 'medium', sid]);
      res.json({ success: true, rule: rows[0] });
    } catch (e) {
      res.json({ success: false, error: e.message });
    }
  }));

  // ================================================================
  // ROUTE 8: GET /rules - List all optimization rules
  // ================================================================
  app.get('/admin/slow-queries/rules', requireAuth, ah(async (req, res) => {
    audit(req, 'view', 'optimization_rules');
    const sid = tenantId(req);

    let rules = [];
    try {
      const { rows } = await pool.query(
        `SELECT * FROM query_optimization_rules WHERE school_id = $1 ORDER BY created_at DESC`, [sid]);
      rules = rows;
    } catch (e) { /* db error */ }

    const html = layout('/rules', 'Optimization Rules', `
      <div class="sqm-grid" style="margin-bottom:20px">
        ${kpiCard('Total Rules', fmtNum(rules.length), 'Active optimization rules', C.primary)}
        ${kpiCard('High Severity', fmtNum(rules.filter(r => r.severity === 'high' || r.severity === 'critical').length), 'Require immediate action', C.red)}
        ${kpiCard('Medium Severity', fmtNum(rules.filter(r => r.severity === 'medium').length), 'Should review soon', C.yellow)}
        ${kpiCard('Low Severity', fmtNum(rules.filter(r => r.severity === 'low').length), 'Nice to have', C.green)}
      </div>

      <div class="sqm-card" style="margin-bottom:20px">
        <h3>➕ Add New Optimization Rule</h3>
        <form method="POST" action="/admin/slow-queries/rules" id="addRuleForm">
          <div class="sqm-flex" style="gap:12px;margin-bottom:12px">
            <div style="flex:2"><label class="sqm-label">Pattern (SQL keyword or phrase)</label>
              <input class="sqm-input" name="pattern" placeholder="e.g. SELECT * FROM" required></div>
            <div style="flex:1"><label class="sqm-label">Severity</label>
              <select class="sqm-select" name="severity">
                <option value="low">Low</option>
                <option value="medium" selected>Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select></div>
          </div>
          <div style="margin-bottom:12px"><label class="sqm-label">Suggestion</label>
            <textarea class="sqm-textarea" name="suggestion" rows="2" placeholder="e.g. Use specific columns instead of SELECT *" required></textarea></div>
          <button type="submit" class="sqm-btn sqm-btn-primary">Add Rule</button>
        </form>
      </div>

      <div class="sqm-card">
        <h3>📋 Optimization Rules (${rules.length})</h3>
        ${rules.length ? `<div style="overflow-x:auto"><table class="sqm-table">
          <thead><tr><th>ID</th><th>Pattern</th><th>Suggestion</th><th>Severity</th><th>Created</th><th>Actions</th></tr></thead>
          <tbody>
          ${rules.map(r => `<tr>
            <td style="font-weight:600;color:${C.primary}">#${r.id}</td>
            <td><code style="color:${C.cyan}">${esc(r.pattern)}</code></td>
            <td>${esc(truncate(r.suggestion, 80))}</td>
            <td>${severityBadge(r.severity)}</td>
            <td style="white-space:nowrap;font-size:.78rem;color:${C.text3}">${fmtDT(r.created_at)}</td>
            <td><form method="POST" action="/admin/slow-queries/rules/${r.id}/delete" style="display:inline"
                  onsubmit="return confirm('Delete this rule?')">
              <button type="submit" class="sqm-btn sqm-btn-danger sqm-btn-sm">Delete</button></form></td>
          </tr>`).join('')}
          </tbody>
        </table></div>` : `<div class="sqm-empty"><p>No optimization rules defined yet. Add rules to get automated suggestions for slow queries.</p></div>`}
      </div>

      <script>
      document.getElementById('addRuleForm').addEventListener('submit', async function(e) {
        e.preventDefault();
        const fd = new FormData(this);
        const res = await fetch('/admin/slow-queries/rules', { method: 'POST', body: fd });
        const data = await res.json();
        if (data.success) { location.reload(); }
        else { alert('Error: ' + (data.error || 'Unknown error')); }
      });
      </script>
    `);
    renderPage(req, res, 'admin/slow-queries', { title: 'Optimization Rules', html });
  }));

  // ================================================================
  // ROUTE 9: DELETE /rules/:id - Delete an optimization rule
  // ================================================================
  app.delete('/admin/slow-queries/rules/:id', requireAuth, ah(async (req, res) => {
    audit(req, 'delete', 'optimization_rule', { id: req.params.id });
    const sid = tenantId(req);
    const ruleId = parseInt(req.params.id);

    try {
      await pool.query(
        `DELETE FROM query_optimization_rules WHERE id = $1 AND school_id = $2`, [ruleId, sid]);
      res.json({ success: true });
    } catch (e) {
      res.json({ success: false, error: e.message });
    }
  }));

  // Also support POST for form-based deletion
  app.post('/admin/slow-queries/rules/:id/delete', requireAuth, ah(async (req, res) => {
    audit(req, 'delete', 'optimization_rule', { id: req.params.id });
    const sid = tenantId(req);
    const ruleId = parseInt(req.params.id);

    try {
      await pool.query(
        `DELETE FROM query_optimization_rules WHERE id = $1 AND school_id = $2`, [ruleId, sid]);
    } catch (e) { /* db error */ }

    res.redirect('/admin/slow-queries/rules');
  }));

  // ================================================================
  // ROUTE 10: GET /stats - Aggregated statistics
  // ================================================================
  app.get('/admin/slow-queries/stats', requireAuth, ah(async (req, res) => {
    audit(req, 'view', 'slow_query_stats');
    const sid = tenantId(req);

    let queriesByHour = [];
    let avgTimeByDay = [];
    let statusDist = [];
    let userDist = [];
    let totalQueries = 0;

    try {
      const { rows: byHour } = await pool.query(
        `SELECT date_trunc('hour', last_seen) AS hour, COUNT(*)::int AS cnt,
                AVG(execution_time_ms)::numeric(10,1) AS avg_ms,
                MAX(execution_time_ms)::numeric(10,1) AS max_ms
         FROM slow_queries_log WHERE school_id = $1 AND last_seen > NOW() - INTERVAL '7 days'
         GROUP BY hour ORDER BY hour`, [sid]);
      queriesByHour = byHour;
    } catch (e) { /* db error */ }

    try {
      const { rows: byDay } = await pool.query(
        `SELECT DATE(last_seen) AS day, COUNT(*)::int AS cnt,
                AVG(execution_time_ms)::numeric(10,1) AS avg_ms
         FROM slow_queries_log WHERE school_id = $1 AND last_seen > NOW() - INTERVAL '30 days'
         GROUP BY day ORDER BY day`, [sid]);
      avgTimeByDay = byDay;
    } catch (e) { /* db error */ }

    try {
      const { rows: sDist } = await pool.query(
        `SELECT status, COUNT(*)::int AS cnt FROM slow_queries_log WHERE school_id = $1 GROUP BY status ORDER BY cnt DESC`, [sid]);
      statusDist = sDist;
    } catch (e) { /* db error */ }

    try {
      const { rows: uDist } = await pool.query(
        `SELECT db_user, COUNT(*)::int AS cnt, AVG(execution_time_ms)::numeric(10,1) AS avg_ms
         FROM slow_queries_log WHERE school_id = $1 AND db_user IS NOT NULL
         GROUP BY db_user ORDER BY cnt DESC LIMIT 10`, [sid]);
      userDist = uDist;
    } catch (e) { /* db error */ }

    try {
      const { rows: t } = await pool.query(
        `SELECT COUNT(*)::int AS cnt FROM slow_queries_log WHERE school_id = $1`, [sid]);
      totalQueries = t[0]?.cnt || 0;
    } catch (e) { /* db error */ }

    // Chart data
    const hourlyChartData = queriesByHour.map(h => ({
      label: h.hour ? new Date(h.hour).toLocaleString('en-GB', { hour: '2-digit', day: '2-digit', month: 'short' }) : '',
      value: h.cnt || 0,
    }));

    const dailyTimeChartData = avgTimeByDay.map(d => ({
      label: d.day ? new Date(d.day).toLocaleString('en-GB', { day: '2-digit', month: 'short' }) : '',
      value: +(d.avg_ms || 0),
    }));

    const statusChartData = statusDist.map(s => ({
      label: s.status || 'unknown',
      value: s.cnt,
      color: s.status === 'active' ? C.red : s.status === 'optimized' ? C.green : s.status === 'dismissed' ? C.yellow : C.primary,
    }));

    const userChartData = userDist.map(u => ({
      label: u.db_user || 'unknown',
      value: u.cnt,
    }));

    const html = layout('/stats', 'Statistics', `
      <div class="sqm-grid" style="margin-bottom:20px">
        ${kpiCard('Total Logged', fmtNum(totalQueries), 'All time', C.primary)}
        ${kpiCard('Active', fmtNum(statusDist.find(s => s.status === 'active')?.cnt || 0), 'Needs attention', C.red)}
        ${kpiCard('Optimized', fmtNum(statusDist.find(s => s.status === 'optimized')?.cnt || 0), 'Fixed queries', C.green)}
        ${kpiCard('Dismissed', fmtNum(statusDist.find(s => s.status === 'dismissed')?.cnt || 0), 'Ignored alerts', C.yellow)}
      </div>

      <div class="sqm-card" style="margin-bottom:16px">
        <h3>📊 Queries by Hour (7 days)</h3>
        ${svgBarChart(hourlyChartData, 700, 220, C.primary)}
      </div>

      <div class="sqm-card" style="margin-bottom:16px">
        <h3>📈 Average Execution Time by Day (30 days)</h3>
        ${svgTimelineChart(dailyTimeChartData, 700, 200, C.orange)}
      </div>

      <div class="sqm-flex">
        <div class="sqm-card">
          <h3>🏷️ Status Distribution</h3>
          ${svgBarChart(statusChartData, 320, 180, C.primary)}
          <table class="sqm-table" style="margin-top:12px">
            ${statusDist.map(s => `<tr><td>${statusBadge(s.status)}</td><td style="text-align:right;font-weight:700">${fmtNum(s.cnt)}</td></tr>`).join('')}
          </table>
        </div>
        <div class="sqm-card">
          <h3>👤 Queries by Database User</h3>
          ${svgBarChart(userChartData, 320, 180, C.cyan)}
          <table class="sqm-table" style="margin-top:12px">
            ${userDist.map(u => `<tr><td><code style="color:${C.cyan}">${esc(u.db_user)}</code></td><td style="text-align:right">${fmtNum(u.cnt)}</td><td style="text-align:right;color:${u.avg_ms > 3000 ? C.red : C.text3}">${u.avg_ms}ms</td></tr>`).join('')}
          </table>
        </div>
      </div>
    `);
    renderPage(req, res, 'admin/slow-queries', { title: 'Slow Query Statistics', html });
  }));

  // ================================================================
  // ROUTE 11: GET /top-worst - Top 10 worst performing queries
  // ================================================================
  app.get('/admin/slow-queries/top-worst', requireAuth, ah(async (req, res) => {
    audit(req, 'view', 'top_worst_queries');
    const sid = tenantId(req);

    let worstQueries = [];
    try {
      const { rows } = await pool.query(
        `SELECT * FROM slow_queries_log
         WHERE school_id = $1 AND status = 'active'
         ORDER BY execution_time_ms DESC LIMIT 10`, [sid]);
      worstQueries = rows;
    } catch (e) { /* db error */ }

    const chartData = worstQueries.map((q, i) => ({
      label: `Q#${q.id}`,
      value: q.execution_time_ms || 0,
      color: i < 3 ? C.red : i < 6 ? C.orange : C.yellow,
    }));

    const html = layout('/top-worst', 'Top 10 Worst Queries', `
      <div class="sqm-alert sqm-alert-danger">🔥 These are the 10 slowest active queries that need immediate attention.</div>

      <div class="sqm-card" style="margin-bottom:20px">
        <h3>📊 Execution Time Comparison</h3>
        ${svgBarChart(chartData, 700, 240, C.red)}
      </div>

      <div class="sqm-card">
        <h3>🏷️ Top 10 Worst Queries</h3>
        ${worstQueries.length ? `<div style="overflow-x:auto"><table class="sqm-table">
          <thead><tr><th>#</th><th>ID</th><th>Query</th><th>Time (ms)</th><th>Calls</th><th>Mean</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
          ${worstQueries.map((q, i) => `<tr>
            <td style="font-weight:800;color:${i < 3 ? C.red : C.text3}">${i + 1}</td>
            <td style="font-weight:600;color:${C.primary}">#${q.id}</td>
            <td style="max-width:280px"><div class="sqm-code" style="max-height:50px;margin:0;font-size:.72rem">${esc(truncate(q.query_text, 100))}</div></td>
            <td><span style="color:${C.red};font-weight:800;font-size:1rem">${(q.execution_time_ms || 0).toFixed(1)}</span></td>
            <td>${fmtNum(q.calls_count)}</td>
            <td>${(q.mean_time || 0).toFixed(1)} ms</td>
            <td>${statusBadge(q.status)}</td>
            <td style="white-space:nowrap">
              <a href="/admin/slow-queries/query/${q.id}" class="sqm-btn sqm-btn-primary sqm-btn-sm">Analyze</a>
              <form method="POST" action="/admin/slow-queries/dismiss/${q.id}" style="display:inline">
                <button type="submit" class="sqm-btn sqm-btn-ghost sqm-btn-sm">Dismiss</button></form>
            </td>
          </tr>`).join('')}
          </tbody>
        </table></div>` : `<div class="sqm-empty"><p>🎉 No active slow queries found! Your database is running smoothly.</p></div>`}
      </div>
    `);
    renderPage(req, res, 'admin/slow-queries', { title: 'Top 10 Worst Queries', html });
  }));

  // ================================================================
  // ROUTE 12: POST /auto-explain-toggle - Enable/disable auto_explain
  // ================================================================
  app.post('/admin/slow-queries/auto-explain-toggle', requireAuth, ah(async (req, res) => {
    audit(req, 'update', 'auto_explain_toggle');
    const enable = req.body.enable === 'true' || req.body.enable === '1';

    let success = false;
    try {
      if (enable) {
        await pool.query(`LOAD 'auto_explain'`);
        await pool.query(`SET auto_explain.log_min_duration = '500'`);
        await pool.query(`SET auto_explain.log_analyze = true`);
        await pool.query(`SET auto_explain.log_format = 'text'`);
      } else {
        await pool.query(`RESET auto_explain.log_min_duration`);
        await pool.query(`RESET auto_explain.log_analyze`);
      }
      success = true;
    } catch (e) {
      success = false;
    }

    // Get current state
    let currentState = 'unknown';
    try {
      const { rows: settingRows } = await pool.query(
        `SELECT setting FROM pg_settings WHERE name = 'auto_explain.log_min_duration'`);
      currentState = settingRows.length > 0 && settingRows[0].setting !== '0' ? 'enabled' : 'disabled';
    } catch (e) { /* pg_settings may not be accessible */ }

    res.json({ success, enabled: enable, currentState });
  }));

  // ================================================================
  // ROUTE 13: GET /export/csv - Export slow queries to CSV
  // ================================================================
  app.get('/admin/slow-queries/export/csv', requireAuth, ah(async (req, res) => {
    audit(req, 'export', 'slow_queries_csv');
    const sid = tenantId(req);
    const status = req.query.status || '';

    let where = 'WHERE school_id = $1';
    const params = [sid];
    if (status) { where += ` AND status = $2`; params.push(status); }

    let rows = [];
    try {
      const result = await pool.query(
        `SELECT id, query_text, execution_time_ms, calls_count, mean_time, rows_affected,
                query_hash, db_user, status, first_seen, last_seen, notes
         FROM slow_queries_log ${where} ORDER BY execution_time_ms DESC LIMIT 50000`, params);
      rows = result.rows;
    } catch (e) { /* db error */ }

    const headers = ['ID', 'Query Text', 'Execution Time (ms)', 'Calls Count', 'Mean Time (ms)',
      'Rows Affected', 'Query Hash', 'DB User', 'Status', 'First Seen', 'Last Seen', 'Notes'];

    const lines = [headers.map(h => '"' + h.replace(/"/g, '""') + '"').join(',')];
    rows.forEach(r => {
      lines.push([
        r.id || '',
        (r.query_text || '').replace(/"/g, '""').replace(/\n/g, ' '),
        r.execution_time_ms || 0,
        r.calls_count || 0,
        r.mean_time || 0,
        r.rows_affected || 0,
        r.query_hash || '',
        r.db_user || '',
        r.status || '',
        r.first_seen ? new Date(r.first_seen).toISOString() : '',
        r.last_seen ? new Date(r.last_seen).toISOString() : '',
        (r.notes || '').replace(/"/g, '""'),
      ].map(v => '"' + v + '"').join(','));
    });

    const ts = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="slow-queries-export-${ts}.csv"`);
    res.send(lines.join('\r\n'));
  }));

  // ================================================================
  // ROUTE 14: DELETE /cleanup - Clean up resolved queries older than 30 days
  // ================================================================
  app.delete('/admin/slow-queries/cleanup', requireAuth, ah(async (req, res) => {
    audit(req, 'delete', 'slow_queries_cleanup');
    const sid = tenantId(req);

    let deletedCount = 0;
    try {
      const { rows: delRes } = await pool.query(
        `DELETE FROM slow_queries_log
         WHERE school_id = $1 AND status IN ('optimized', 'dismissed', 'resolved')
         AND last_seen < NOW() - INTERVAL '30 days' RETURNING id`, [sid]);
      deletedCount = delRes.length;
    } catch (e) { /* db error */ }

    res.json({ success: true, deleted: deletedCount, message: `Cleaned up ${deletedCount} resolved queries older than 30 days.` });
  }));

  // Also support POST for form-based cleanup
  app.post('/admin/slow-queries/cleanup', requireAuth, ah(async (req, res) => {
    audit(req, 'delete', 'slow_queries_cleanup');
    const sid = tenantId(req);

    let deletedCount = 0;
    try {
      const { rows: delRes } = await pool.query(
        `DELETE FROM slow_queries_log
         WHERE school_id = $1 AND status IN ('optimized', 'dismissed', 'resolved')
         AND last_seen < NOW() - INTERVAL '30 days' RETURNING id`, [sid]);
      deletedCount = delRes.length;
    } catch (e) { /* db error */ }

    if (req.headers.accept?.includes('application/json')) {
      res.json({ success: true, deleted: deletedCount });
    } else {
      res.redirect('/admin/slow-queries/settings?cleanup=' + deletedCount);
    }
  }));

  // ================================================================
  // ROUTE 15: GET /settings - View slow query threshold settings
  // ================================================================
  app.get('/admin/slow-queries/settings', requireAuth, ah(async (req, res) => {
    audit(req, 'view', 'slow_query_settings');
    const sid = tenantId(req);
    const cleanupResult = req.query.cleanup || '';

    let autoExplainState = 'unknown';
    try {
      const { rows: aeRows } = await pool.query(
        `SELECT setting FROM pg_settings WHERE name = 'auto_explain.log_min_duration'`);
      autoExplainState = aeRows.length > 0 && aeRows[0].setting !== '0' ? 'enabled' : 'disabled';
    } catch (e) { /* pg_settings may not be accessible */ }

    let totalQueries = 0, activeQueries = 0, resolvedQueries = 0;
    try {
      const { rows: counts } = await pool.query(
        `SELECT COUNT(*) FILTER (WHERE status = 'active')::int AS active,
                COUNT(*) FILTER (WHERE status IN ('optimized','dismissed','resolved'))::int AS resolved,
                COUNT(*)::int AS total
         FROM slow_queries_log WHERE school_id = $1`, [sid]);
      activeQueries = counts[0]?.active || 0;
      resolvedQueries = counts[0]?.resolved || 0;
      totalQueries = counts[0]?.total || 0;
    } catch (e) { /* db error */ }

    let pgSettings = [];
    try {
      const { rows: settings } = await pool.query(`
        SELECT name, setting, unit FROM pg_settings
        WHERE name IN ('log_min_duration_statement', 'auto_explain.log_min_duration',
                        'statement_timeout', 'deadlock_timeout', 'work_mem', 'shared_buffers',
                        'effective_cache_size', 'max_connections', 'random_page_cost')
        ORDER BY name`);
      pgSettings = settings;
    } catch (e) { /* pg_settings may not be accessible */ }

    const html = layout('/settings', 'Settings', `
      ${cleanupResult ? `<div class="sqm-alert sqm-alert-info">✅ Cleanup completed: ${esc(cleanupResult)} resolved queries removed.</div>` : ''}

      <div class="sqm-grid" style="margin-bottom:20px">
        ${kpiCard('Total Queries', fmtNum(totalQueries), 'All logged', C.primary)}
        ${kpiCard('Active', fmtNum(activeQueries), 'Needs attention', C.red)}
        ${kpiCard('Resolved', fmtNum(resolvedQueries), 'Optimized or dismissed', C.green)}
        ${kpiCard('Auto-Explain', autoExplainState, autoExplainState === 'enabled' ? 'Currently active' : 'Currently off', autoExplainState === 'enabled' ? C.green : C.text3)}
      </div>

      <div class="sqm-flex" style="margin-bottom:16px">
        <div class="sqm-card">
          <h3>🔧 Auto-Explain Control</h3>
          <p style="font-size:.85rem;color:${C.text2};margin-bottom:14px">
            Auto-explain automatically runs EXPLAIN ANALYZE on queries exceeding the minimum duration threshold.
            This helps capture execution plans for slow queries without manual intervention.
          </p>
          <div style="display:flex;gap:10px;align-items:center;margin-bottom:16px">
            <span style="font-size:.85rem;color:${C.text2};font-weight:600">Current Status:</span>
            <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${autoExplainState === 'enabled' ? C.green : C.red}"></span>
            <span style="font-weight:700;color:${autoExplainState === 'enabled' ? C.green : C.text3}">${autoExplainState.toUpperCase()}</span>
          </div>
          <div style="display:flex;gap:10px">
            <button onclick="toggleAutoExplain(true)" class="sqm-btn sqm-btn-success" ${autoExplainState === 'enabled' ? 'disabled style="opacity:.5;cursor:not-allowed"' : ''}>
              Enable Auto-Explain
            </button>
            <button onclick="toggleAutoExplain(false)" class="sqm-btn sqm-btn-ghost" ${autoExplainState !== 'enabled' ? 'disabled style="opacity:.5;cursor:not-allowed"' : ''}>
              Disable Auto-Explain
            </button>
          </div>
          <div id="autoExplainMsg" style="margin-top:10px;font-size:.82rem"></div>
        </div>

        <div class="sqm-card">
          <h3>🧹 Data Cleanup</h3>
          <p style="font-size:.85rem;color:${C.text2};margin-bottom:14px">
            Remove resolved (optimized, dismissed) queries that are older than 30 days.
            This frees up storage and keeps the log focused on recent activity.
          </p>
          <div style="padding:12px;background:${C.bg};border-radius:8px;margin-bottom:14px;border:1px solid ${C.border}">
            <div style="font-size:.78rem;color:${C.text3};margin-bottom:4px">ELIGIBLE FOR CLEANUP</div>
            <div style="font-size:1.2rem;font-weight:700;color:${C.yellow}">${fmtNum(resolvedQueries)} queries</div>
          </div>
          <form method="POST" action="/admin/slow-queries/cleanup"
                onsubmit="return confirm('Delete ${resolvedQueries} resolved queries older than 30 days? This cannot be undone.')">
            <button type="submit" class="sqm-btn sqm-btn-danger" ${resolvedQueries === 0 ? 'disabled style="opacity:.5;cursor:not-allowed"' : ''}>
              Run Cleanup
            </button>
          </form>
        </div>
      </div>

      <div class="sqm-card" style="margin-bottom:16px">
        <h3>📤 Export Data</h3>
        <p style="font-size:.85rem;color:${C.text2};margin-bottom:14px">
          Export slow query data to CSV for analysis in external tools or for compliance reporting.
        </p>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <a href="/admin/slow-queries/export/csv" class="sqm-btn sqm-btn-primary">📥 Export All as CSV</a>
          <a href="/admin/slow-queries/export/csv?status=active" class="sqm-btn sqm-btn-ghost">Export Active Only</a>
          <a href="/admin/slow-queries/export/csv?status=optimized" class="sqm-btn sqm-btn-ghost">Export Optimized Only</a>
          <a href="/admin/slow-queries/export/csv?status=dismissed" class="sqm-btn sqm-btn-ghost">Export Dismissed Only</a>
        </div>
      </div>

      <div class="sqm-card">
        <h3>⚙️ PostgreSQL Settings</h3>
        <p style="font-size:.85rem;color:${C.text2};margin-bottom:14px">
          Current PostgreSQL configuration relevant to query performance.
        </p>
        ${pgSettings.length ? `<table class="sqm-table">
          <thead><tr><th>Setting</th><th>Value</th><th>Unit</th></tr></thead>
          <tbody>
          ${pgSettings.map(s => `<tr>
            <td><code style="color:${C.cyan}">${esc(s.name)}</code></td>
            <td style="font-weight:600;color:${C.text}">${esc(s.setting)}</td>
            <td style="color:${C.text3}">${esc(s.unit || '')}</td>
          </tr>`).join('')}
          </tbody>
        </table>` : `<div class="sqm-empty"><p>Unable to read PostgreSQL settings.</p></div>`}
      </div>

      <script>
      async function toggleAutoExplain(enable) {
        const msg = document.getElementById('autoExplainMsg');
        msg.textContent = enable ? 'Enabling...' : 'Disabling...';
        msg.style.color = '${C.primary}';
        try {
          const fd = new FormData();
          fd.append('enable', enable ? 'true' : 'false');
          const res = await fetch('/admin/slow-queries/auto-explain-toggle', { method: 'POST', body: fd });
          const data = await res.json();
          if (data.success) {
            msg.textContent = enable ? 'Auto-explain enabled successfully!' : 'Auto-explain disabled.';
            msg.style.color = '${C.green}';
            setTimeout(() => location.reload(), 1000);
          } else {
            msg.textContent = 'Error: ' + (data.error || 'Unknown error');
            msg.style.color = '${C.red}';
          }
        } catch (e) {
          msg.textContent = 'Network error: ' + e.message;
          msg.style.color = '${C.red}';
        }
      }

      function dismissQuery(id) {
        if (!confirm('Dismiss this slow query alert?')) return;
        const fd = new FormData();
        fetch('/admin/slow-queries/dismiss/' + id, { method: 'POST', body: fd })
          .then(r => { if (r.ok) location.reload(); else alert('Error dismissing query'); });
      }
      </script>
    `);
    renderPage(req, res, 'admin/slow-queries', { title: 'Slow Query Settings', html });
  }));

  // ================================================================
  // END OF SLOW QUERY MONITOR MODULE
  // ================================================================
};
