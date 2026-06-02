'use strict';

const { migrateQuery } = require('./db');
const os = require('os');

module.exports = function (app, pool, opts) {
  const esc = opts.esc || (s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));
  const renderPage = opts.renderPage || ((t, c, u) => c);
  const ah = opts.ah || ((fn) => async (req, res, next) => { try { await fn(req, res, next); } catch (e) { res.status(500).send('Error: ' + e.message); } });
  const requireAuth = opts.requireAuth || ((req, res, next) => { if (!req.session?.user) return res.redirect('/login'); next(); });
  const audit = opts.audit || (() => {});
  const tenantId = (req) => req.session?.user?.tenant_id || 0;
  const COLORS = { primary: '#4f46e5', green: '#22c55e', yellow: '#eab308', red: '#ef4444', gray: '#6b7280', light: '#f3f4f6' };

  // ── Database Migrations ──────────────────────────────────────────────
  async function migrate() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS health_metrics (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL DEFAULT 0,
        metric_type VARCHAR(50) NOT NULL, metric_name VARCHAR(80) NOT NULL,
        value NUMERIC NOT NULL, unit VARCHAR(30),
        recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS hm_tenant_time ON health_metrics(tenant_id, recorded_at)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS hm_name_time ON health_metrics(metric_name, recorded_at)`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS health_slow_queries (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL DEFAULT 0,
        query_text TEXT NOT NULL, duration_ms NUMERIC NOT NULL,
        query_plan TEXT, called_by VARCHAR(120),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS hsq_tenant_dur ON health_slow_queries(tenant_id, duration_ms DESC)`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS health_alerts (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL DEFAULT 0,
        alert_type VARCHAR(50) NOT NULL, metric_name VARCHAR(80),
        threshold NUMERIC, current_value NUMERIC,
        severity VARCHAR(20) DEFAULT 'warning',
        is_resolved BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), resolved_at TIMESTAMPTZ
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS ha_tenant_resolved ON health_alerts(tenant_id, is_resolved)`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS health_cron_log (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL DEFAULT 0,
        task_name VARCHAR(120) NOT NULL, status VARCHAR(20) NOT NULL,
        duration_ms NUMERIC, next_run TIMESTAMPTZ,
        output TEXT, error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS hcl_tenant_created ON health_cron_log(tenant_id, created_at DESC)`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS health_changelog (
        id SERIAL PRIMARY KEY, version VARCHAR(30) NOT NULL,
        title VARCHAR(200) NOT NULL, description TEXT,
        changes JSONB DEFAULT '[]',
        released_by VARCHAR(100), released_at TIMESTAMPTZ DEFAULT NOW()
      )`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS health_maintenance (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL DEFAULT 0,
        is_active BOOLEAN DEFAULT FALSE, message TEXT,
        started_by VARCHAR(100), started_at TIMESTAMPTZ,
        ended_at TIMESTAMPTZ
      )`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS health_error_log (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL DEFAULT 0,
        severity VARCHAR(20) NOT NULL DEFAULT 'error',
        source VARCHAR(120), message TEXT NOT NULL,
        stack_trace TEXT, request_path VARCHAR(500),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS hel_tenant_created ON health_error_log(tenant_id, created_at DESC)`);
  }

  // ── Metric Collection (every 5 min, keep 24h) ────────────────────────
  async function collectMetrics() {
    const mem = process.memoryUsage();
    const metrics = [
      ['system', 'rss_mb', +(mem.rss / 1048576).toFixed(2), 'MB'],
      ['system', 'heap_used_mb', +(mem.heapUsed / 1048576).toFixed(2), 'MB'],
      ['system', 'heap_total_mb', +(mem.heapTotal / 1048576).toFixed(2), 'MB'],
      ['system', 'external_mb', +(mem.external / 1048576).toFixed(2), 'MB'],
      ['system', 'array_buffers_mb', +(mem.arrayBuffers / 1048576).toFixed(2), 'MB'],
      ['system', 'uptime_seconds', +process.uptime().toFixed(0), 's'],
      ['system', 'freemem_mb', +(os.freemem() / 1048576).toFixed(0), 'MB'],
      ['system', 'totalmem_mb', +(os.totalmem() / 1048576).toFixed(0), 'MB'],
      ['db', 'pool_total', pool.totalCount || 0, 'conn'],
      ['db', 'pool_idle', pool.idleCount || 0, 'conn'],
      ['db', 'pool_waiting', pool.waitingCount || 0, 'conn'],
    ];
    const loadAvg = os.loadavg();
    loadAvg.forEach((v, i) => metrics.push(['system', `loadavg_${i}`, +v.toFixed(3), '']));
    for (const [type, name, value, unit] of metrics) {
      await pool.query(
        `INSERT INTO health_metrics (metric_type, metric_name, value, unit) VALUES ($1,$2,$3,$4)`,
        [type, name, value, unit]);
    }
    // Purge data older than 24 hours
    await pool.query(`DELETE FROM health_metrics WHERE recorded_at < NOW() - INTERVAL '24 hours'`);
    // Auto-check alert thresholds
    await checkAlertThresholds(metrics);
  }

  // ── Auto Alert Threshold Checking ─────────────────────────────────────
  const ALERT_THRESHOLDS = {
    heap_used_mb: { warn: 512, crit: 1024, label: 'Heap Memory' },
    pool_waiting: { warn: 5, crit: 15, label: 'Pool Queue Depth' },
    loadavg_0: { warn: null, crit: null, label: 'Load Average (1m)' }, // dynamic: cpu count based
  };

  async function checkAlertThresholds(metrics) {
    const cpuCount = os.cpus().length;
    const metricMap = {};
    metrics.forEach(([, name, value]) => { metricMap[name] = value; });
    // Dynamic load thresholds based on CPU count
    if (!ALERT_THRESHOLDS.loadavg_0.warn) {
      ALERT_THRESHOLDS.loadavg_0.warn = cpuCount * 0.8;
      ALERT_THRESHOLDS.loadavg_0.crit = cpuCount * 1.2;
    }
    for (const [name, cfg] of Object.entries(ALERT_THRESHOLDS)) {
      const val = metricMap[name];
      if (val === undefined) continue;
      const severity = val >= cfg.crit ? 'critical' : val >= cfg.warn ? 'warning' : null;
      if (severity) {
        const { rows: existing } = await pool.query(
          `SELECT id FROM health_alerts WHERE metric_name=$1 AND severity=$2 AND is_resolved=FALSE AND created_at > NOW() - INTERVAL '30 minutes'`,
          [name, severity]);
        if (!existing.length) {
          await pool.query(
            `INSERT INTO health_alerts (alert_type, metric_name, current_value, threshold, severity)
             VALUES ('threshold', $1, $2, $3, $4)`,
            [name, val, severity === 'critical' ? cfg.crit : cfg.warn, severity]);
        }
      }
    }
  }

  // ── Helper Utilities ──────────────────────────────────────────────────
  function statusColor(val, warn, crit) {
    return val >= crit ? COLORS.red : val >= warn ? COLORS.yellow : COLORS.green;
  }

  function fmtUptime(s) {
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    return d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  function fmtBytes(mb) {
    return mb >= 1024 ? (mb / 1024).toFixed(1) + ' GB' : mb.toFixed(0) + ' MB';
  }

  function fmtNum(n) {
    return n != null ? Number(n).toLocaleString() : '-';
  }

  function timeAgo(dt) {
    const diff = Date.now() - new Date(dt).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ${mins % 60}m ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  // ── SVG Chart Generators ──────────────────────────────────────────────
  function svgSparkline(data, w = 160, h = 40, color = COLORS.primary) {
    if (!data.length) return `<svg width="${w}" height="${h}" role="img" aria-label="No data"><rect fill="${COLORS.light}" width="${w}" height="${h}" rx="4"/></svg>`;
    const max = Math.max(...data), min = Math.min(...data), range = max - min || 1;
    const pts = data.map((v, i) =>
      `${(i / (data.length - 1)) * w},${h - 2 - ((v - min) / range) * (h - 4)}`
    ).join(' ');
    return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Sparkline chart">
      <rect fill="${COLORS.light}" width="${w}" height="${h}" rx="4"/>
      <polyline fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" points="${pts}"/>
    </svg>`;
  }

  function svgAreaChart(data, w = 500, h = 120, color = COLORS.primary) {
    if (!data.length) return `<svg width="${w}" height="${h}" role="img" aria-label="No data"><rect fill="${COLORS.light}" width="${w}" height="${h}" rx="6"/></svg>`;
    const max = Math.max(...data), min = Math.min(...data), range = max - min || 1;
    const pad = 4;
    const pts = data.map((v, i) => ({
      x: pad + (i / (data.length - 1)) * (w - pad * 2),
      y: pad + (h - pad * 2) - ((v - min) / range) * (h - pad * 2)
    }));
    const line = pts.map(p => `${p.x},${p.y}`).join(' ');
    const area = `${pts[0].x},${h - pad} ${line} ${pts[pts.length - 1].x},${h - pad}`;
    // Grid lines
    let gridLines = '';
    for (let i = 0; i <= 4; i++) {
      const y = pad + (i / 4) * (h - pad * 2);
      const val = max - (i / 4) * range;
      gridLines += `<line x1="${pad}" y1="${y}" x2="${w - pad}" y2="${y}" stroke="#e5e7eb" stroke-width="0.5" stroke-dasharray="4,4"/>`;
      gridLines += `<text x="${w - pad - 2}" y="${y - 3}" font-size="9" fill="${COLORS.gray}" text-anchor="end">${val.toFixed(val > 100 ? 0 : 1)}</text>`;
    }
    return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Area chart">
      <rect fill="#fff" width="${w}" height="${h}" rx="6"/>
      ${gridLines}
      <polygon fill="${color}15" stroke="none" points="${area}"/>
      <polyline fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" points="${line}"/>
      ${pts.length ? `<circle cx="${pts[pts.length - 1].x}" cy="${pts[pts.length - 1].y}" r="3" fill="${color}"/>` : ''}
    </svg>`;
  }

  function svgDonut(segments, w = 100, h = 100) {
    const cx = w / 2, cy = h / 2, r = 38, ir = 24;
    const total = segments.reduce((s, seg) => s + seg.value, 0) || 1;
    let angle = -Math.PI / 2, paths = '';
    const colors = [COLORS.green, COLORS.yellow, COLORS.red, COLORS.primary, COLORS.gray];
    segments.forEach((seg, i) => {
      const sweep = (seg.value / total) * Math.PI * 2;
      if (sweep < 0.001) return;
      const x1 = cx + r * Math.cos(angle), y1 = cy + r * Math.sin(angle);
      const x2 = cx + r * Math.cos(angle + sweep), y2 = cy + r * Math.sin(angle + sweep);
      const ix1 = cx + ir * Math.cos(angle + sweep), iy1 = cy + ir * Math.sin(angle + sweep);
      const ix2 = cx + ir * Math.cos(angle), iy2 = cy + ir * Math.sin(angle);
      const large = sweep > Math.PI ? 1 : 0;
      paths += `<path d="M${x1},${y1} A${r},${r} 0 ${large},1 ${x2},${y2} L${ix1},${iy1} A${ir},${ir} 0 ${large},0 ${ix2},${iy2} Z" fill="${colors[i % colors.length]}"/>`;
      angle += sweep;
    });
    const pct = segments.length ? ((segments[0].value / total) * 100).toFixed(0) : 0;
    return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Donut chart">
      ${paths}
      <text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="14" font-weight="700" fill="#111827">${pct}%</text>
    </svg>`;
  }

  function svgBar(values, w = 200, h = 24, colors) {
    const total = values.reduce((s, v) => s + v, 0) || 1;
    let x = 0, rects = '';
    const cols = colors || [COLORS.green, COLORS.yellow, COLORS.red, COLORS.gray];
    values.forEach((v, i) => {
      const bw = (v / total) * w;
      if (bw > 0.5) rects += `<rect x="${x}" y="0" width="${bw}" height="${h}" fill="${cols[i % cols.length]}"/>`;
      x += bw;
    });
    return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">${rects}</svg>`;
  }

  // ── Layout & UI Components ────────────────────────────────────────────
  function layout(active, title, content) {
    const nav = [
      ['/', 'Dashboard'], ['/api', 'JSON API'], ['/db', 'Database'], ['/errors', 'Errors'],
      ['/performance', 'Performance'], ['/slow-queries', 'Slow Queries'], ['/sessions', 'Sessions'],
      ['/storage', 'Storage'], ['/cron', 'Cron Tasks'], ['/notifications', 'Alerts'],
      ['/maintenance', 'Maintenance'], ['/changelog', 'Changelog']
    ];
    const links = nav.map(([p, l]) =>
      `<a href="/school/health${p}" class="nv${active === p ? ' active' : ''}">${l}</a>`
    ).join('');
    const liveIndicator = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${COLORS.green};margin-right:6px;animation:pulse 2s infinite"></span>`;
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<link rel="stylesheet" href="/css/sk.css">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f9fafb;color:#111827}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.nv{display:inline-block;padding:6px 12px;color:${COLORS.primary};text-decoration:none;font-size:.83rem;border-radius:6px;margin:2px;transition:.15s}
.nv:hover{background:#eef2ff} .nv.active{background:${COLORS.primary};color:#fff}
.kpi{background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.08);flex:1;min-width:180px;transition:box-shadow .2s}
.kpi:hover{box-shadow:0 4px 12px rgba(0,0,0,.1)}
.kpi-label{font-size:.78rem;color:${COLORS.gray};text-transform:uppercase;letter-spacing:.05em;font-weight:600}
.kpi-value{font-size:1.7rem;font-weight:700;margin:6px 0 2px}
.kpi-sub{font-size:.78rem;color:${COLORS.gray}}
.card{background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.08);margin-bottom:16px}
.card h3{margin:0 0 14px;font-size:1rem;color:#374151;display:flex;align-items:center;gap:8px}
table{width:100%;border-collapse:collapse;font-size:.83rem}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #e5e7eb}
th{background:#f9fafb;font-weight:600;color:${COLORS.gray};font-size:.78rem;text-transform:uppercase;letter-spacing:.03em}
tr:hover{background:#f9fafb}
.badge{display:inline-block;padding:2px 10px;border-radius:99px;font-size:.72rem;font-weight:600;color:#fff;white-space:nowrap}
.badge-green{background:${COLORS.green}} .badge-yellow{background:${COLORS.yellow}} .badge-red{background:${COLORS.red}}
.badge-gray{background:${COLORS.gray}} .badge-blue{background:${COLORS.primary}}
.topbar{background:${COLORS.primary};color:#fff;padding:14px 24px;display:flex;align-items:center;gap:16px;position:sticky;top:0;z-index:100}
.topbar h1{font-size:1.1rem;font-weight:700;display:flex;align-items:center;gap:8px}
.navbar{padding:10px 24px;background:#fff;border-bottom:1px solid #e5e7eb;display:flex;flex-wrap:wrap;gap:2px;position:sticky;top:52px;z-index:99}
.main{padding:20px 24px;max-width:1200px;margin:0 auto}
.grid4{display:flex;flex-wrap:wrap;gap:16px;margin-bottom:20px}
.form-group{margin-bottom:14px}
label{display:block;font-size:.83rem;font-weight:600;margin-bottom:5px;color:#374151}
input,select,textarea{width:100%;padding:9px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:.88rem;transition:border .15s}
input:focus,select:focus,textarea:focus{outline:none;border-color:${COLORS.primary};box-shadow:0 0 0 3px rgba(79,70,229,.1)}
textarea{resize:vertical;font-family:monospace;font-size:.82rem}
.btn{display:inline-block;padding:9px 20px;background:${COLORS.primary};color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:.88rem;font-weight:600;transition:.15s}
.btn:hover{opacity:.9;transform:translateY(-1px)} .btn-sm{padding:5px 12px;font-size:.78rem}
.btn-outline{background:transparent;border:1px solid ${COLORS.primary};color:${COLORS.primary}}
.btn-red{background:${COLORS.red}} .btn-green{background:${COLORS.green}}
.toggler{width:48px;height:26px;border-radius:13px;background:#d1d5db;position:relative;cursor:pointer;transition:.2s;display:inline-block;vertical-align:middle}
.toggler.on{background:${COLORS.green}} .toggler::after{content:'';position:absolute;top:3px;left:3px;width:20px;height:20px;background:#fff;border-radius:50%;transition:.2s}
.toggler.on::after{left:25px}
.code-block{background:#1e293b;color:#e2e8f0;padding:12px 16px;border-radius:8px;font-size:.78rem;overflow-x:auto;white-space:pre-wrap;word-break:break-all;max-height:200px;overflow-y:auto}
.alert-banner{padding:10px 16px;border-radius:8px;margin-bottom:16px;font-size:.85rem;display:flex;align-items:center;gap:8px}
.alert-banner.warn{background:#fefce8;border:1px solid ${COLORS.yellow};color:#854d0e}
.alert-banner.crit{background:#fef2f2;border:1px solid ${COLORS.red};color:#991b1b}
.empty-state{text-align:center;padding:40px;color:${COLORS.gray}}
.empty-state svg{margin-bottom:12px;opacity:.4}
</style></head><body>
<div class="topbar"><h1>🔧 System Health Monitor</h1><span style="opacity:.7;font-size:.85rem">${liveIndicator}${esc(title)}</span></div>
<div class="navbar">${links}</div>
<main class="main">${content}</main></body></html>`;
  }

  function kpiCard(label, value, sub, sparkSvg) {
    return `<div class="kpi"><div class="kpi-label">${esc(label)}</div><div class="kpi-value">${value}</div>
<div class="kpi-sub">${sub || ''}</div>${sparkSvg ? '<div style="margin-top:8px">' + sparkSvg + '</div>' : ''}</div>`;
  }

  function emptyState(icon, message) {
    return `<div class="empty-state"><div style="font-size:2rem">${icon}</div><p>${esc(message)}</p></div>`;
  }

  // ── Initialize ────────────────────────────────────────────────────────
  (async () => { await migrate(); await collectMetrics(); })();
  setInterval(collectMetrics, 5 * 60 * 1000);

  // ── 1. Main Dashboard ─────────────────────────────────────────────────
  app.get('/school/health', requireAuth, ah(async (req, res) => {
    audit(req, 'view', 'health_dashboard');
    const mem = process.memoryUsage();
    const uptime = process.uptime();
    const loadAvg = os.loadavg();
    const cpuCores = os.cpus().length;
    const memPct = ((mem.heapUsed / mem.heapTotal) * 100).toFixed(1);

    // Fetch 6h of metric history for sparklines
    const { rows: recentMetrics } = await pool.query(
      `SELECT metric_name, value, recorded_at FROM health_metrics WHERE recorded_at > NOW() - INTERVAL '6 hours' ORDER BY recorded_at`);
    const grouped = {};
    recentMetrics.forEach(r => { (grouped[r.metric_name] = grouped[r.metric_name] || []).push(+r.value); });

    // Active alerts and cron runs
    const { rows: recentAlerts } = await pool.query(
      `SELECT * FROM health_alerts WHERE is_resolved = FALSE ORDER BY created_at DESC LIMIT 5`);
    const { rows: recentCron } = await pool.query(
      `SELECT * FROM health_cron_log ORDER BY created_at DESC LIMIT 5`);
    const { rows: sessCount } = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM pg_stat_activity WHERE datname = current_database()`);

    const uptimeColor = uptime > 86400 ? COLORS.green : uptime > 3600 ? COLORS.yellow : COLORS.red;
    const memColor = statusColor(+memPct, 70, 90);
    const activeUsers = sessCount[0]?.cnt || 0;
    const loadColor = statusColor(loadAvg[0], cpuCores * 0.7, cpuCores * 0.9);
    const freeMemPct = ((os.freemem() / os.totalmem()) * 100).toFixed(0);

    // Alert banner if critical alerts exist
    const critAlerts = recentAlerts.filter(a => a.severity === 'critical');
    const alertBanner = critAlerts.length
      ? `<div class="alert-banner crit">🔴 <strong>${critAlerts.length} critical alert${critAlerts.length > 1 ? 's' : ''}</strong> — ${critAlerts.map(a => esc(a.metric_name || a.alert_type)).join(', ')}</div>`
      : '';

    const html = layout('/', 'Dashboard', `${alertBanner}
<div class="grid4">
  ${kpiCard('Uptime', fmtUptime(uptime), `<span style="color:${uptimeColor}">●</span> Since last restart`,
    svgSparkline(grouped.uptime_seconds || [], 160, 36, uptimeColor))}
  ${kpiCard('Memory', `${memPct}%`, `Heap ${fmtBytes(mem.heapUsed / 1048576)} / ${fmtBytes(mem.heapTotal / 1048576)}`,
    svgSparkline(grouped.heap_used_mb || [], 160, 36, memColor))}
  ${kpiCard('Active Users', activeUsers, `DB connections · ${pool.waitingCount || 0} waiting`,
    svgSparkline(grouped.pool_total || [], 160, 36, COLORS.primary))}
  ${kpiCard('Load Avg', loadAvg[0].toFixed(2), `${cpuCores} cores · 5m: ${loadAvg[1].toFixed(2)} · 15m: ${loadAvg[2].toFixed(2)}`,
    svgSparkline(grouped.loadavg_0 || [], 160, 36, loadColor))}
</div>
<div style="display:flex;flex-wrap:wrap;gap:16px">
  <div class="card" style="flex:2;min-width:320px"><h3>📈 Memory &amp; Load (6h)</h3>
    ${svgAreaChart(grouped.heap_used_mb || [], 520, 130, memColor)}
    <p style="font-size:.78rem;color:${COLORS.gray};margin-top:8px">Heap Used · RSS: ${fmtBytes(mem.rss / 1048576)} · External: ${fmtBytes(mem.external / 1048576)}</p>
  </div>
  <div class="card" style="flex:1;min-width:260px"><h3>⚠️ Active Alerts</h3>
    ${recentAlerts.length ? recentAlerts.map(a => `<div style="margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid #f3f4f6">
      <span class="badge badge-${a.severity === 'critical' ? 'red' : 'yellow'}">${esc(a.severity)}</span>
      <strong>${esc(a.metric_name || a.alert_type)}</strong>: ${a.current_value ?? '-'}
      <span style="color:${COLORS.gray};font-size:.75rem;display:block;margin-top:2px">${timeAgo(a.created_at)}</span>
    </div>`).join('') : `<div style="color:${COLORS.green};font-size:.88rem;padding:16px 0">✅ All systems nominal</div>`}
  </div>
</div>
<div style="display:flex;flex-wrap:wrap;gap:16px">
  <div class="card" style="flex:1;min-width:280px"><h3>⏱ Recent Cron Runs</h3>
    <table><tr><th>Task</th><th>Status</th><th>Duration</th><th>When</th></tr>
    ${recentCron.map(c => `<tr><td>${esc(c.task_name)}</td>
    <td><span class="badge badge-${c.status === 'success' ? 'green' : 'red'}">${c.status}</span></td>
    <td>${c.duration_ms ? c.duration_ms + 'ms' : '-'}</td><td style="color:${COLORS.gray}">${timeAgo(c.created_at)}</td></tr>`).join('')}
    </table></div>
  <div class="card" style="flex:1;min-width:280px"><h3>🖥 System Info</h3>
    <table>
    <tr><td style="color:${COLORS.gray};width:40%">Platform</td><td>${esc(os.type())} ${esc(os.release())}</td></tr>
    <tr><td style="color:${COLORS.gray}">Architecture</td><td>${esc(os.arch())}</td></tr>
    <tr><td style="color:${COLORS.gray}">CPU</td><td>${cpuCores} core${cpuCores > 1 ? 's' : ''} · ${esc(os.cpus()[0]?.model || 'unknown')}</td></tr>
    <tr><td style="color:${COLORS.gray}">Node.js</td><td>${process.version} · PID ${process.pid}</td></tr>
    <tr><td style="color:${COLORS.gray}">System Memory</td><td>${fmtBytes(os.totalmem() / 1048576)} total · ${freeMemPct}% free</td></tr>
    <tr><td style="color:${COLORS.gray}">DB Connections</td><td>${pool.totalCount || 0} total · ${pool.idleCount || 0} idle · ${pool.waitingCount || 0} queued</td></tr>
    </table></div>
</div>`);
    res.send(renderPage('health-dashboard', html, req.session?.user));
  }));

  // ── 2. JSON API ───────────────────────────────────────────────────────
  app.get('/school/health/api', requireAuth, ah(async (req, res) => {
    const mem = process.memoryUsage();
    const { rows: alerts } = await pool.query(`SELECT COUNT(*)::int AS cnt FROM health_alerts WHERE is_resolved=FALSE`);
    const { rows: crons } = await pool.query(
      `SELECT status, COUNT(*)::int AS cnt FROM health_cron_log WHERE created_at > NOW()-INTERVAL '1 hour' GROUP BY status`);
    const { rows: lastCollect } = await pool.query(
      `SELECT recorded_at FROM health_metrics ORDER BY recorded_at DESC LIMIT 1`);
    const cronMap = crons.reduce((a, c) => { a[c.status] = c.cnt; return a; }, {});
    const data = {
      timestamp: new Date().toISOString(),
      lastCollection: lastCollect[0]?.recorded_at || null,
      uptime: process.uptime(), uptimeFormatted: fmtUptime(process.uptime()),
      memory: {
        rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal,
        external: mem.external, arrayBuffers: mem.arrayBuffers,
        heapPct: +((mem.heapUsed / mem.heapTotal) * 100).toFixed(1)
      },
      os: { freemem: os.freemem(), totalmem: os.totalmem(), loadavg: os.loadavg(), cpus: os.cpus().length, arch: os.arch() },
      dbPool: { total: pool.totalCount || 0, idle: pool.idleCount || 0, waiting: pool.waitingCount || 0 },
      activeAlerts: alerts[0].cnt,
      recentCron: cronMap,
      nodeVersion: process.version, pid: process.pid
    };
    res.setHeader('Cache-Control', 'no-cache, no-store');
    res.json(data);
  }));

  // ── 3. Database Metrics ───────────────────────────────────────────────
  app.get('/school/health/db', requireAuth, ah(async (req, res) => {
    audit(req, 'view', 'health_db');
    const { rows: dbSize } = await pool.query(
      `SELECT pg_size_pretty(pg_database_size(current_database())) AS size`);
    const { rows: tblSizes } = await pool.query(`
      SELECT relname AS table_name, pg_size_pretty(pg_total_relation_size(relid)) AS total,
        pg_size_pretty(pg_relation_size(relid)) AS data_size,
        pg_size_pretty(pg_indexes_size(relid)) AS idx_size,
        n_live_tup AS row_count, n_dead_tup AS dead_rows
      FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 20`);
    const { rows: locks } = await pool.query(
      `SELECT locktype, mode, COUNT(*)::int AS cnt FROM pg_locks GROUP BY locktype, mode ORDER BY cnt DESC`);
    const { rows: conns } = await pool.query(
      `SELECT state, COUNT(*)::int AS cnt FROM pg_stat_activity WHERE datname=current_database() GROUP BY state`);
    const { rows: cache } = await pool.query(`
      SELECT sum(heap_blks_hit)::float / NULLIF(sum(heap_blks_hit)+sum(heap_blks_read),0) * 100 AS hit_rate
      FROM pg_statio_user_tables`);
    const { rows: txStats } = await pool.query(
      `SELECT xact_commit::bigint AS commits, xact_rollback::bigint AS rollbacks FROM pg_stat_database WHERE datname=current_database()`);

    const connData = conns.reduce((a, c) => { a[c.state] = c.cnt; return a; }, {});
    const cachePct = +(cache[0]?.hit_rate || 0).toFixed(1);
    const cacheColor = statusColor(100 - cachePct, 10, 30); // high miss = bad

    const html = layout('/db', 'Database', `
<div class="grid4">
  ${kpiCard('DB Size', dbSize[0]?.size || '?', 'Total database size')}
  ${kpiCard('Cache Hit Rate', `${cachePct}%`, `<span style="color:${cacheColor}">●</span> Heap block hit ratio`)}
  ${kpiCard('Connections', pool.totalCount || 0, `${pool.idleCount || 0} idle · ${pool.waitingCount || 0} waiting`)}
  ${kpiCard('Transactions', `${(txStats[0]?.commits || 0).toLocaleString()}`, `${(txStats[0]?.rollbacks || 0).toLocaleString()} rollbacks`)}
</div>
<div class="card"><h3>📊 Table Sizes, Indexes &amp; Row Counts</h3>
  <div style="overflow-x:auto"><table><tr><th>Table</th><th>Total Size</th><th>Data</th><th>Index</th><th>Live Rows</th><th>Dead Rows</th></tr>
  ${tblSizes.map(t => {
    const bloat = t.dead_rows && t.row_count ? ((t.dead_rows / t.row_count) * 100).toFixed(1) : '0';
    return `<tr><td><code>${esc(t.table_name)}</code></td><td>${t.total}</td><td>${t.data_size}</td><td>${t.idx_size}</td>
    <td>${fmtNum(t.row_count)}</td><td>${fmtNum(t.dead_rows)} <span style="color:${statusColor(+bloat, 5, 15)};font-size:.75rem">(${bloat}%)</span></td></tr>`;
  }).join('')}
  </table></div></div>
<div style="display:flex;flex-wrap:wrap;gap:16px">
  <div class="card" style="flex:1;min-width:280px"><h3>🔗 Lock Distribution</h3>
    ${svgBar(locks.map(l => l.cnt), 300, 20, [COLORS.green, COLORS.yellow, COLORS.primary])}
    <table><tr><th>Type</th><th>Mode</th><th>Count</th></tr>
    ${locks.map(l => `<tr><td>${esc(l.locktype)}</td><td>${esc(l.mode)}</td><td>${l.cnt}</td></tr>`).join('')}
    </table></div>
  <div class="card" style="flex:1;min-width:280px"><h3>🔌 Connection States</h3>
    ${svgDonut(conns.map(c => ({ label: c.state, value: c.cnt })), 120, 120)}
    <table><tr><th>State</th><th>Count</th></tr>
    ${conns.map(s => `<tr><td>${esc(s.state)}</td><td>${s.cnt}</td></tr>`).join('')}
    </table></div>
</div>`);
    res.send(renderPage('health-db', html, req.session?.user));
  }));

  // ── 4. Error Log Dashboard ────────────────────────────────────────────
  app.get('/school/health/errors', requireAuth, ah(async (req, res) => {
    audit(req, 'view', 'health_errors');
    const tid = tenantId(req);
    const severity = req.query.severity || '';

    let errorQuery = `SELECT * FROM health_error_log WHERE tenant_id=$1`;
    const params = [tid];
    if (severity) { errorQuery += ` AND severity=$2`; params.push(severity); }
    errorQuery += ` ORDER BY created_at DESC LIMIT 50`;

    const { rows: errors } = await pool.query(errorQuery, params);
    const { rows: sevCounts } = await pool.query(
      `SELECT severity, COUNT(*)::int AS cnt FROM health_error_log WHERE tenant_id=$1 AND created_at > NOW()-INTERVAL '24 hours' GROUP BY severity`, [tid]);
    const sevMap = sevCounts.reduce((a, c) => { a[c.severity] = c.cnt; return a; }, {});

    const filterBar = ['error', 'warning', 'critical', 'info'].map(s =>
      `<a href="/school/health/errors?severity=${s}" class="btn btn-sm ${severity === s ? '' : 'btn-outline'}">${s} (${sevMap[s] || 0})</a>`
    ).join(' ') + ` <a href="/school/health/errors" class="btn btn-sm ${!severity ? '' : 'btn-outline'}">All</a>`;

    const html = layout('/errors', 'Error Logs', `
<div class="grid4">
  ${kpiCard('Errors (24h)', sevMap.error || 0, 'Application errors')}
  ${kpiCard('Warnings', sevMap.warning || 0, 'Potential issues')}
  ${kpiCard('Critical', sevMap.critical || 0, 'System failures')}
  ${kpiCard('Info', sevMap.info || 0, 'Informational')}
</div>
<div class="card"><h3>🔍 Filter by Severity</h3><div style="display:flex;flex-wrap:wrap;gap:8px">${filterBar}</div></div>
<div class="card"><h3>📋 Error Log${severity ? ` (${esc(severity)})` : ''}</h3>
  ${errors.length ? `<div style="max-height:480px;overflow-y:auto"><table><tr><th>Severity</th><th>Source</th><th>Message</th><th>Path</th><th>Time</th></tr>
  ${errors.map(e => `<tr><td><span class="badge badge-${e.severity === 'critical' ? 'red' : e.severity === 'error' ? 'yellow' : e.severity === 'warning' ? 'yellow' : 'green'}">${esc(e.severity)}</span></td>
  <td>${esc(e.source || '-')}</td>
  <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(e.message)}">${esc(e.message)}</td>
  <td style="font-size:.75rem;color:${COLORS.gray}">${esc(e.request_path || '-')}</td>
  <td style="white-space:nowrap">${timeAgo(e.created_at)}</td></tr>`).join('')}
  </table></div>` : emptyState('📭', 'No errors logged' + (severity ? ` with severity "${severity}"` : ''))}
</div>`);
    res.send(renderPage('health-errors', html, req.session?.user));
  }));

  // ── 5. Performance ────────────────────────────────────────────────────
  app.get('/school/health/performance', requireAuth, ah(async (req, res) => {
    audit(req, 'view', 'health_performance');
    const { rows: rtMetrics } = await pool.query(
      `SELECT metric_name, value, recorded_at FROM health_metrics WHERE metric_name='response_time_ms' AND recorded_at > NOW() - INTERVAL '24 hours' ORDER BY recorded_at`);
    const values = rtMetrics.map(r => +r.value);
    const sorted = [...values].sort((a, b) => a - b);
    const pct = (p) => { const i = Math.floor(sorted.length * p / 100); return sorted[i] || 0; };
    const p50 = pct(50), p90 = pct(90), p99 = pct(99);
    const avg = values.length ? (values.reduce((a, b) => a + b, 0) / values.length).toFixed(1) : 0;
    const max = values.length ? Math.max(...values) : 0;
    const min = values.length ? Math.min(...values) : 0;
    const avgColor = statusColor(+avg, 200, 500);
    const p99Color = statusColor(p99, 500, 1000);

    const { rows: throughput } = await pool.query(
      `SELECT date_trunc('hour', recorded_at) AS hour, COUNT(*)::int AS req_count,
        AVG(value)::numeric(10,1) AS avg_rt
      FROM health_metrics WHERE metric_name='response_time_ms' AND recorded_at > NOW()-INTERVAL '24 hours'
      GROUP BY hour ORDER BY hour`);
    const tpVals = throughput.map(t => t.req_count);
    const rtVals = throughput.map(t => +(t.avg_rt || 0));

    const html = layout('/performance', 'Performance', `
<div class="grid4">
  ${kpiCard('Avg Response', `${avg}ms`, `<span style="color:${avgColor}">●</span> target &lt; 200ms`)}
  ${kpiCard('P50 (Median)', `${p50}ms`, '50th percentile')}
  ${kpiCard('P90', `${p90}ms`, '90th percentile')}
  ${kpiCard('P99', `${p99}ms`, `<span style="color:${p99Color}">●</span> 99th percentile`)}
</div>
<div style="display:flex;flex-wrap:wrap;gap:16px;margin-bottom:16px">
  <div class="card" style="flex:1"><h3>Min</h3><div style="font-size:1.2rem;font-weight:700;color:${COLORS.green}">${min}ms</div></div>
  <div class="card" style="flex:1"><h3>Max</h3><div style="font-size:1.2rem;font-weight:700;color:${max > 500 ? COLORS.red : max > 200 ? COLORS.yellow : COLORS.green}">${max}ms</div></div>
  <div class="card" style="flex:1"><h3>Std Dev</h3><div style="font-size:1.2rem;font-weight:700">${values.length ? Math.sqrt(values.reduce((s, v) => s + (v - avg) ** 2, 0) / values.length).toFixed(1) : 0}ms</div></div>
  <div class="card" style="flex:1"><h3>Data Points</h3><div style="font-size:1.2rem;font-weight:700">${values.length}</div></div>
</div>
<div class="card"><h3>📈 Response Time Distribution (24h)</h3>
  ${svgAreaChart(values, 600, 120, avgColor)}
  <p style="font-size:.78rem;color:${COLORS.gray};margin-top:6px">Line chart of all response time samples over 24 hours</p></div>
<div class="card"><h3>📊 Hourly Throughput &amp; Avg Response Time</h3>
  ${svgAreaChart(tpVals, 600, 100, COLORS.primary)}
  <p style="font-size:.78rem;color:${COLORS.gray};margin-top:6px">Requests per hour · Peak: ${tpVals.length ? Math.max(...tpVals) : 0} req/hr</p></div>`);
    res.send(renderPage('health-performance', html, req.session?.user));
  }));

  // ── 6. Slow Queries ───────────────────────────────────────────────────
  app.get('/school/health/slow-queries', requireAuth, ah(async (req, res) => {
    audit(req, 'view', 'health_slow_queries');
    const tid = tenantId(req);
    const { rows: slowQ } = await pool.query(
      `SELECT * FROM health_slow_queries WHERE tenant_id=$1 ORDER BY duration_ms DESC LIMIT 50`, [tid]);
    const { rows: stats } = await pool.query(
      `SELECT COUNT(*)::int AS total, AVG(duration_ms)::numeric(10,1) AS avg_ms,
        MAX(duration_ms)::numeric(10,1) AS max_ms, MIN(duration_ms)::numeric(10,1) AS min_ms
      FROM health_slow_queries WHERE tenant_id=$1`, [tid]);
    const { rows: topCallers } = await pool.query(
      `SELECT called_by, COUNT(*)::int AS cnt, AVG(duration_ms)::numeric(10,1) AS avg_ms
      FROM health_slow_queries WHERE tenant_id=$1 GROUP BY called_by ORDER BY cnt DESC LIMIT 10`, [tid]);

    const html = layout('/slow-queries', 'Slow Queries', `
<div class="grid4">
  ${kpiCard('Total Slow Queries', stats[0]?.total || 0, 'Queries &gt; 500ms')}
  ${kpiCard('Avg Duration', `${stats[0]?.avg_ms || 0}ms`, 'Mean slow query time')}
  ${kpiCard('Worst', `${stats[0]?.max_ms || 0}ms`, 'Slowest recorded')}
  ${kpiCard('Threshold', '500ms', 'Slow query definition')}
</div>
${stats[0]?.total > 0 ? `<div class="card"><h3>📞 Top Callers</h3>
  <table><tr><th>Caller</th><th>Count</th><th>Avg Duration</th></tr>
  ${topCallers.map(c => `<tr><td>${esc(c.called_by || 'unknown')}</td><td>${c.cnt}</td><td>${c.avg_ms}ms</td></tr>`).join('')}
  </table></div>` : ''}
<div class="card"><h3>🐌 Slow Query Log</h3>
  ${slowQ.length ? `<div style="max-height:500px;overflow-y:auto"><table><tr><th>Duration</th><th>Query</th><th>Caller</th><th>Plan</th><th>Time</th></tr>
  ${slowQ.map(q => `<tr>
  <td><span class="badge badge-${q.duration_ms > 2000 ? 'red' : 'yellow'}">${q.duration_ms}ms</span></td>
  <td><div class="code-block" style="max-height:80px">${esc(String(q.query_text).substring(0, 500))}</div></td>
  <td style="white-space:nowrap">${esc(q.called_by || '-')}</td>
  <td>${q.query_plan ? `<details><summary class="btn btn-sm btn-outline">View Plan</summary><div class="code-block" style="margin-top:6px">${esc(q.query_plan)}</div></details>` : '-'}</td>
  <td style="white-space:nowrap;color:${COLORS.gray}">${timeAgo(q.created_at)}</td></tr>`).join('')}
  </table></div>` : emptyState('🚀', 'No slow queries recorded — all queries under 500ms')}
</div>`);
    res.send(renderPage('health-slow-queries', html, req.session?.user));
  }));

  // ── 7. Sessions ───────────────────────────────────────────────────────
  app.get('/school/health/sessions', requireAuth, ah(async (req, res) => {
    audit(req, 'view', 'health_sessions');
    const { rows: pgSess } = await pool.query(`
      SELECT state, COUNT(*)::int AS cnt FROM pg_stat_activity WHERE datname=current_database() GROUP BY state`);
    const { rows: pgDetail } = await pool.query(`
      SELECT pid, usename, state, query_start, state_change, wait_event_type
      FROM pg_stat_activity WHERE datname=current_database() AND state!='idle' ORDER BY query_start DESC LIMIT 20`);
    // Try to query app sessions if table exists
    let appSess = [];
    try {
      const { rows } = await pool.query(`
        SELECT usertype, COUNT(*)::int AS cnt FROM user_sessions WHERE expires_at > NOW() GROUP BY usertype ORDER BY cnt DESC`);
      appSess = rows;
    } catch (e) { /* table may not exist */ }
    const pgMap = pgSess.reduce((a, c) => { a[c.state] = c.cnt; return a; }, {});
    const totalApp = appSess.reduce((s, r) => s + r.cnt, 0);
    const poolUtil = pool.totalCount ? (((pool.totalCount - (pool.idleCount || 0)) / pool.totalCount) * 100).toFixed(0) : '0';

    const html = layout('/sessions', 'Sessions', `
<div class="grid4">
  ${kpiCard('App Sessions', totalApp, 'Active user sessions')}
  ${kpiCard('DB Active', pgMap.active || 0, `${pgMap.idle || 0} idle`)}
  ${kpiCard('Pool Waiting', pool.waitingCount || 0, 'Clients queued for connection')}
  ${kpiCard('Pool Utilization', `${poolUtil}%`, `${pool.totalCount || 0} total · ${pool.idleCount || 0} free`)}
</div>
${appSess.length ? `<div class="card"><h3>👥 Sessions by Role</h3>
  ${svgDonut(appSess.map(r => ({ label: r.usertype, value: r.cnt })), 120, 120)}
  <table><tr><th>Role</th><th>Count</th><th>%</th></tr>
  ${appSess.map(r => `<tr><td>${esc(r.usertype || 'unknown')}</td><td>${r.cnt}</td><td>${((r.cnt / (totalApp || 1)) * 100).toFixed(1)}%</td></tr>`).join('')}
  </table></div>` : ''}
<div class="card"><h3>🔌 Database Connection States</h3>
  ${svgBar(pgSess.map(s => s.cnt), 300, 24)}
  <table><tr><th>State</th><th>Count</th></tr>
  ${pgSess.map(s => `<tr><td>${esc(s.state)}</td><td>${s.cnt}</td></tr>`).join('')}
  </table></div>
<div class="card"><h3>🔍 Active Database Queries</h3>
  ${pgDetail.length ? `<div style="max-height:360px;overflow-y:auto"><table><tr><th>PID</th><th>User</th><th>State</th><th>Started</th><th>Waiting</th></tr>
  ${pgDetail.map(q => `<tr><td>${q.pid}</td><td>${esc(q.usename)}</td>
  <td><span class="badge badge-${q.state === 'active' ? 'green' : 'yellow'}">${esc(q.state)}</span></td>
  <td style="white-space:nowrap">${q.query_start ? timeAgo(q.query_start) : '-'}</td>
  <td>${esc(q.wait_event_type || 'None')}</td></tr>`).join('')}
  </table></div>` : emptyState('😴', 'No active queries')}
</div>`);
    res.send(renderPage('health-sessions', html, req.session?.user));
  }));

  // ── 8. Storage ────────────────────────────────────────────────────────
  app.get('/school/health/storage', requireAuth, ah(async (req, res) => {
    audit(req, 'view', 'health_storage');
    const { rows: dbSize } = await pool.query(
      `SELECT pg_size_pretty(pg_database_size(current_database())) AS size, pg_database_size(current_database()) AS bytes`);
    const { rows: tables } = await pool.query(`
      SELECT c.relname, pg_size_pretty(pg_total_relation_size(c.oid)) AS total,
        pg_size_pretty(pg_relation_size(c.oid)) AS data_size,
        pg_size_pretty(pg_indexes_size(c.oid)) AS idx_size,
        pg_total_relation_size(c.oid) AS bytes,
        pg_relation_size(c.oid) AS data_bytes,
        pg_indexes_size(c.oid) AS idx_bytes,
        n_live_tup::int AS rows
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind='r' ORDER BY bytes DESC LIMIT 30`);
    const totalBytes = tables.reduce((s, t) => s + (+t.bytes), 0);
    const totalIdx = tables.reduce((s, t) => s + (+t.idx_bytes), 0);
    const osFreeGB = (os.freemem() / 1073741824).toFixed(1);
    const osTotalGB = (os.totalmem() / 1073741824).toFixed(1);
    const osFreePct = ((os.freemem() / os.totalmem()) * 100).toFixed(0);
    const memColor = statusColor(100 - +osFreePct, 70, 90);

    const html = layout('/storage', 'Storage', `
<div class="grid4">
  ${kpiCard('Database Size', dbSize[0]?.size || '?', 'PostgreSQL database')}
  ${kpiCard('Index Size', fmtBytes(totalIdx / 1048576), `${totalBytes ? ((totalIdx / totalBytes) * 100).toFixed(1) : 0}% of total`)}
  ${kpiCard('Tables', tables.length, `${tables.reduce((s, t) => s + (t.rows || 0), 0).toLocaleString()} total rows`)}
  ${kpiCard('System Memory', `${osFreeGB} / ${osTotalGB} GB`, `<span style="color:${memColor}">●</span> ${osFreePct}% free`)}
</div>
<div class="card"><h3>💾 Table Storage Breakdown</h3>
  <div style="max-height:500px;overflow-y:auto"><table><tr><th>Table</th><th>Total</th><th>Data</th><th>Indexes</th><th>%</th><th>Rows</th></tr>
  ${tables.map(t => `<tr><td><code>${esc(t.relname)}</code></td><td>${t.total}</td><td>${t.data_size}</td><td>${t.idx_size}</td>
  <td>${((+t.bytes / (totalBytes || 1)) * 100).toFixed(1)}%</td><td>${fmtNum(t.rows)}</td></tr>`).join('')}
  </table></div></div>`);
    res.send(renderPage('health-storage', html, req.session?.user));
  }));

  // ── 9. Cron Tasks ─────────────────────────────────────────────────────
  app.get('/school/health/cron', requireAuth, ah(async (req, res) => {
    audit(req, 'view', 'health_cron');
    const tid = tenantId(req);
    const { rows: logs } = await pool.query(
      `SELECT * FROM health_cron_log WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50`, [tid]);
    const { rows: stats } = await pool.query(
      `SELECT status, COUNT(*)::int AS cnt, AVG(duration_ms)::numeric(10,1) AS avg_ms,
        MAX(duration_ms)::numeric(10,1) AS max_ms
      FROM health_cron_log WHERE tenant_id=$1 GROUP BY status`, [tid]);
    const { rows: taskNames } = await pool.query(
      `SELECT task_name, COUNT(*)::int AS runs,
        COUNT(*) FILTER (WHERE status='success')::int AS successes,
        AVG(duration_ms)::numeric(10,1) AS avg_ms
      FROM health_cron_log WHERE tenant_id=$1 GROUP BY task_name ORDER BY runs DESC`, [tid]);
    const statMap = stats.reduce((a, c) => { a[c.status] = c; return a; }, {});

    const html = layout('/cron', 'Cron Tasks', `
<div class="grid4">
  ${kpiCard('Total Runs', logs.length, 'All-time executions')}
  ${kpiCard('Success', statMap.success?.cnt || 0, `Avg ${(statMap.success?.avg_ms || 0)}ms`)}
  ${kpiCard('Failed', statMap.failed?.cnt || 0, `Avg ${(statMap.failed?.avg_ms || 0)}ms`)}
  ${kpiCard('Next Scheduled', logs[0]?.next_run ? timeAgo(logs[0].next_run) : '-', 'Upcoming task')}
</div>
<div class="card"><h3>📊 Success / Failure</h3>
  ${svgBar([statMap.success?.cnt || 0, statMap.failed?.cnt || 0], 300, 28, [COLORS.green, COLORS.red])}
  <span style="font-size:.78rem;margin-left:10px">
    <span style="color:${COLORS.green}">● Success (${statMap.success?.cnt || 0})</span> ·
    <span style="color:${COLORS.red}">● Failed (${statMap.failed?.cnt || 0})</span></span>
</div>
${taskNames.length ? `<div class="card"><h3>📋 Task Summary</h3>
  <table><tr><th>Task</th><th>Total Runs</th><th>Successes</th><th>Success Rate</th><th>Avg Duration</th></tr>
  ${taskNames.map(t => {
    const rate = t.runs ? ((t.successes / t.runs) * 100).toFixed(0) : 0;
    const rateColor = statusColor(100 - +rate, 5, 20);
    return `<tr><td>${esc(t.task_name)}</td><td>${t.runs}</td><td>${t.successes}</td>
    <td><span style="color:${rateColor}">${rate}%</span></td><td>${t.avg_ms || 0}ms</td></tr>`;
  }).join('')}
  </table></div>` : ''}
<div class="card"><h3>📝 Execution Log</h3>
  ${logs.length ? `<div style="max-height:400px;overflow-y:auto"><table><tr><th>Task</th><th>Status</th><th>Duration</th><th>Output</th><th>Time</th></tr>
  ${logs.map(l => `<tr>
  <td>${esc(l.task_name)}</td>
  <td><span class="badge badge-${l.status === 'success' ? 'green' : 'red'}">${l.status}</span></td>
  <td>${l.duration_ms ? l.duration_ms + 'ms' : '-'}</td>
  <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(l.error || l.output || '')}">${esc(l.error || l.output || '-')}</td>
  <td style="white-space:nowrap;color:${COLORS.gray}">${timeAgo(l.created_at)}</td></tr>`).join('')}
  </table></div>` : emptyState('⏰', 'No cron tasks logged yet')}
</div>`);
    res.send(renderPage('health-cron', html, req.session?.user));
  }));

  // ── 10. Notifications (Alert Rules) ───────────────────────────────────
  app.get('/school/health/notifications', requireAuth, ah(async (req, res) => {
    audit(req, 'view', 'health_notifications');
    const tid = tenantId(req);
    const { rows: activeAlerts } = await pool.query(
      `SELECT * FROM health_alerts WHERE tenant_id=$1 AND is_resolved=FALSE ORDER BY created_at DESC LIMIT 20`, [tid]);
    const { rows: resolvedAlerts } = await pool.query(
      `SELECT * FROM health_alerts WHERE tenant_id=$1 AND is_resolved=TRUE ORDER BY resolved_at DESC LIMIT 10`, [tid]);

    const html = layout('/notifications', 'Alerts & Notifications', `
<div class="card"><h3>➕ Create Alert Rule</h3>
<form method="POST" action="/school/health/notifications" style="max-width:560px">
  <div style="display:flex;flex-wrap:wrap;gap:14px">
    <div class="form-group" style="flex:1;min-width:200px"><label>Alert Type</label>
      <select name="alert_type"><option value="threshold">Threshold Breach</option><option value="anomaly">Anomaly Detection</option><option value="custom">Custom</option></select></div>
    <div class="form-group" style="flex:1;min-width:200px"><label>Severity</label>
      <select name="severity"><option value="warning">Warning</option><option value="critical">Critical</option></select></div>
  </div>
  <div style="display:flex;flex-wrap:wrap;gap:14px">
    <div class="form-group" style="flex:1;min-width:200px"><label>Metric Name</label>
      <input name="metric_name" placeholder="e.g. heap_used_mb, response_time_ms, pool_waiting" required></div>
    <div class="form-group" style="flex:1;min-width:200px"><label>Threshold Value</label>
      <input name="threshold" type="number" step="any" placeholder="e.g. 1024" required></div>
  </div>
  <div style="display:flex;flex-wrap:wrap;gap:14px">
    <div class="form-group" style="flex:1;min-width:200px"><label>Notify Via</label>
      <select name="notify_via"><option value="email">Email</option><option value="webhook">Webhook</option><option value="both">Email + Webhook</option><option value="none">Log Only</option></select></div>
    <div class="form-group" style="flex:1;min-width:200px"><label>Cooldown (minutes)</label>
      <input name="cooldown" type="number" value="30" min="1"></div>
  </div>
  <div class="form-group"><label>Webhook URL (optional)</label>
    <input name="webhook_url" placeholder="https://hooks.example.com/alerts/..."></div>
  <div class="form-group"><label>Email Recipients (comma-separated, optional)</label>
    <input name="emails" placeholder="admin@school.edu, ops@school.edu"></div>
  <button type="submit" class="btn">💾 Save Alert Rule</button>
</form></div>
<div class="card"><h3>🔴 Active Alerts (${activeAlerts.length})</h3>
  ${activeAlerts.length ? `<table><tr><th>Severity</th><th>Type</th><th>Metric</th><th>Current</th><th>Threshold</th><th>Created</th><th>Actions</th></tr>
  ${activeAlerts.map(r => `<tr>
  <td><span class="badge badge-${r.severity === 'critical' ? 'red' : 'yellow'}">${esc(r.severity)}</span></td>
  <td>${esc(r.alert_type)}</td><td>${esc(r.metric_name || '-')}</td>
  <td>${r.current_value ?? '-'}</td><td>${r.threshold ?? '-'}</td>
  <td style="white-space:nowrap">${timeAgo(r.created_at)}</td>
  <td><form method="POST" action="/school/health/notifications/resolve" style="display:inline">
    <input type="hidden" name="id" value="${r.id}"><button type="submit" class="btn btn-sm btn-green">Resolve</button></form></td></tr>`).join('')}
  </table>` : emptyState('✅', 'No active alerts — all clear!')}
</div>
${resolvedAlerts.length ? `<div class="card"><h3>✅ Recently Resolved</h3>
  <table><tr><th>Severity</th><th>Metric</th><th>Value</th><th>Resolved</th></tr>
  ${resolvedAlerts.map(r => `<tr>
  <td><span class="badge badge-gray">${esc(r.severity)}</span></td>
  <td>${esc(r.metric_name || '-')}</td><td>${r.current_value ?? '-'}</td>
  <td style="color:${COLORS.gray}">${r.resolved_at ? timeAgo(r.resolved_at) : '-'}</td></tr>`).join('')}
  </table></div>` : ''}`);
    res.send(renderPage('health-notifications', html, req.session?.user));
  }));

  // ── 11. Save Alert Configuration ──────────────────────────────────────
  app.post('/school/health/notifications', requireAuth, ah(async (req, res) => {
    audit(req, 'create', 'health_alert');
    const { alert_type, metric_name, threshold, severity } = req.body;
    await pool.query(
      `INSERT INTO health_alerts (tenant_id, alert_type, metric_name, threshold, severity)
       VALUES ($1, $2, $3, $4, $5)`,
      [tenantId(req), alert_type, metric_name, +threshold, severity]);
    res.redirect('/school/health/notifications');
  }));

  // Resolve alert
  app.post('/school/health/notifications/resolve', requireAuth, ah(async (req, res) => {
    audit(req, 'update', 'resolve_alert');
    await pool.query(
      `UPDATE health_alerts SET is_resolved=TRUE, resolved_at=NOW() WHERE id=$1 AND tenant_id=$2`,
      [req.body.id, tenantId(req)]);
    res.redirect('/school/health/notifications');
  }));

  // ── 12. Maintenance Mode ──────────────────────────────────────────────
  app.get('/school/health/maintenance', requireAuth, ah(async (req, res) => {
    audit(req, 'view', 'health_maintenance');
    const tid = tenantId(req);
    const { rows: mode } = await pool.query(
      `SELECT * FROM health_maintenance WHERE tenant_id=$1 AND is_active=TRUE ORDER BY started_at DESC LIMIT 1`, [tid]);
    const { rows: history } = await pool.query(
      `SELECT * FROM health_maintenance WHERE tenant_id=$1 ORDER BY started_at DESC LIMIT 10`, [tid]);
    const active = mode.length > 0 && mode[0].is_active;

    const html = layout('/maintenance', 'Maintenance', `
<div class="card" style="max-width:600px">
  <h3>🔧 Maintenance Mode</h3>
  <p style="margin-bottom:20px;color:${COLORS.gray};font-size:.9rem;line-height:1.6">
    When enabled, all non-admin users will see a maintenance page. Admins retain full access to the system including this dashboard.</p>
  <div style="display:flex;align-items:center;gap:14px;margin-bottom:20px;padding:16px;background:${active ? '#fef2f2' : '#f0fdf4'};border-radius:10px;border:1px solid ${active ? COLORS.red : COLORS.green}">
    <div id="toggle" class="toggler ${active ? 'on' : ''}" onclick="toggleMaintenance()" role="switch" aria-checked="${active}" tabindex="0"></div>
    <div>
      <div style="font-weight:700;font-size:1rem">${active ? '🔴 Maintenance Mode ON' : '🟢 Maintenance Mode OFF'}</div>
      <div style="font-size:.82rem;color:${COLORS.gray}">${active ? 'Non-admin users are blocked from the application' : 'Application is accessible to all users'}</div>
    </div>
  </div>
  ${active ? `<div style="border:1px solid ${COLORS.red};border-radius:10px;padding:14px;margin-bottom:16px;background:#fff">
    <table style="margin:0"><tr><td style="color:${COLORS.gray};width:120px;border:none"><strong>Active since</strong></td><td style="border:none">${mode[0].started_at?.toISOString().replace('T', ' ').slice(0, 19)}</td></tr>
    <tr><td style="color:${COLORS.gray};border:none"><strong>Message</strong></td><td style="border:none">${esc(mode[0].message || 'System under maintenance')}</td></tr>
    <tr><td style="color:${COLORS.gray};border:none"><strong>Started by</strong></td><td style="border:none">${esc(mode[0].started_by || 'Unknown')}</td></tr>
    </table></div>` : `
  <form id="mtForm">
    <div class="form-group"><label>Maintenance Message (shown to users)</label>
      <textarea name="message" rows="3" placeholder="We're performing scheduled maintenance. We'll be back in a few minutes.">We're performing scheduled maintenance. We'll be back shortly.</textarea></div>
    <button type="button" class="btn btn-red" onclick="toggleMaintenance()">⚡ Enable Maintenance Mode</button>
  </form>`}
</div>
${history.length > 1 ? `<div class="card"><h3>📜 Maintenance History</h3>
  <table><tr><th>Status</th><th>Started</th><th>Ended</th><th>Duration</th><th>By</th></tr>
  ${history.map(h => {
    const dur = h.ended_at && h.started_at ? Math.round((new Date(h.ended_at) - new Date(h.started_at)) / 60000) : null;
    return `<tr><td><span class="badge badge-${h.is_active ? 'red' : 'gray'}">${h.is_active ? 'Active' : 'Ended'}</span></td>
    <td>${h.started_at?.toISOString().slice(0, 16)}</td><td>${h.ended_at?.toISOString().slice(0, 16) || '-'}</td>
    <td>${dur !== null ? dur + 'm' : '-'}</td><td>${esc(h.started_by || '-')}</td></tr>`;
  }).join('')}
  </table></div>` : ''}
<script>
function toggleMaintenance(){
  const btn=document.querySelector('.btn-red, .toggler');
  if(btn)btn.disabled=true;
  const msg=document.querySelector('[name=message]')?.value||'System under maintenance';
  fetch('/school/health/maintenance/toggle',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:msg})})
    .then(r=>r.json()).then(d=>{if(d.ok)location.reload();else alert(d.error||'Operation failed');})
    .catch(e=>alert('Network error: '+e.message));
}
document.getElementById('toggle')?.addEventListener('keydown',e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();toggleMaintenance();}});
</script>`);
    res.send(renderPage('health-maintenance', html, req.session?.user));
  }));

  // ── 13. Toggle Maintenance ────────────────────────────────────────────
  app.post('/school/health/maintenance/toggle', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const { rows: current } = await pool.query(
      `SELECT id FROM health_maintenance WHERE tenant_id=$1 AND is_active=TRUE`, [tid]);
    if (current.length) {
      await pool.query(
        `UPDATE health_maintenance SET is_active=FALSE, ended_at=NOW() WHERE tenant_id=$1 AND is_active=TRUE`, [tid]);
      audit(req, 'update', 'maintenance_off');
    } else {
      await pool.query(
        `INSERT INTO health_maintenance (tenant_id, is_active, message, started_by, started_at) VALUES ($1, TRUE, $2, $3, NOW())`,
        [tid, req.body.message || 'System under maintenance', req.session?.user?.email || 'admin']);
      audit(req, 'update', 'maintenance_on');
    }
    res.json({ ok: true });
  }));

  // ── 14. Changelog ─────────────────────────────────────────────────────
  app.get('/school/health/changelog', requireAuth, ah(async (req, res) => {
    audit(req, 'view', 'health_changelog');
    const { rows: entries } = await pool.query(
      `SELECT * FROM health_changelog ORDER BY released_at DESC LIMIT 30`);

    const changeTypeColors = { feature: COLORS.green, fix: COLORS.red, improvement: COLORS.primary, breaking: '#f97316', note: COLORS.gray };

    const html = layout('/changelog', 'Changelog', `
<div class="card"><h3>📜 Release History</h3>
  ${entries.length ? entries.map((e, idx) => {
    const changes = Array.isArray(e.changes) ? e.changes : [];
    return `<div style="border-left:3px solid ${COLORS.primary};padding-left:18px;margin-bottom:24px;${idx === 0 ? 'background:#f9fafb;padding:18px;border-radius:0 12px 12px 0' : ''}">
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px">
      <span class="badge badge-blue" style="font-size:.82rem;padding:3px 12px">${esc(e.version)}</span>
      <span style="font-weight:700;font-size:1.05rem">${esc(e.title)}</span>
      <span style="color:${COLORS.gray};font-size:.8rem">${e.released_at?.toISOString().slice(0, 10)}</span>
      ${e.released_by ? `<span style="color:${COLORS.gray};font-size:.8rem">by ${esc(e.released_by)}</span>` : ''}
    </div>
    ${e.description ? `<p style="color:#4b5563;font-size:.88rem;margin-bottom:8px;line-height:1.5">${esc(e.description)}</p>` : ''}
    ${changes.length ? `<div style="display:flex;flex-direction:column;gap:4px">${changes.map(c => {
      const item = typeof c === 'string' ? { type: 'note', text: c } : c;
      const color = changeTypeColors[item.type] || changeTypeColors.note;
      return `<div style="display:flex;align-items:flex-start;gap:8px;font-size:.85rem">
        <span class="badge" style="background:${color};min-width:60px;text-align:center;font-size:.68rem;margin-top:2px">${esc(item.type || 'note')}</span>
        <span>${esc(item.text || '')}</span></div>`;
    }).join('')}</div>` : ''}
  </div>`;
  }).join('') : emptyState('📝', 'No changelog entries yet. Add your first release note.')}
</div>`);
    res.send(renderPage('health-changelog', html, req.session?.user));
  }));

  // ── Middleware: Maintenance Mode Check ─────────────────────────────────
  // Registered as last middleware so it checks all routes after health pages
  app.use(ah(async (req, res, next) => {
    // Skip health pages, login, static assets, and API health checks
    if (req.path.startsWith('/school/health') || req.path === '/login' ||
        req.path.startsWith('/css/') || req.path.startsWith('/js/') ||
        req.path.startsWith('/_next/') || req.path.startsWith('/api/health')) {
      return next();
    }
    const tid = req.session?.user?.tenant_id || 0;
    const { rows } = await pool.query(
      `SELECT message FROM health_maintenance WHERE tenant_id=$1 AND is_active=TRUE`, [tid]);
    if (rows.length && req.session?.user?.role !== 'admin') {
      res.status(503).setHeader('Retry-After', '300').send(`<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Maintenance Mode</title><link rel="stylesheet" href="/css/sk.css"><style>
body{display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;font-family:-apple-system,sans-serif;background:#f9fafb}
.box{text-align:center;padding:56px 48px;background:#fff;border-radius:20px;box-shadow:0 8px 40px rgba(0,0,0,.06);max-width:480px}
.icon{font-size:3rem;margin-bottom:16px}h1{color:#ef4444;margin:0 0 8px;font-size:1.4rem}p{color:#6b7280;line-height:1.7;margin:0}
.hint{margin-top:24px;font-size:.82rem;color:#9ca3af}</style></head>
<body><div class="box">
<div class="icon">🔧</div><h1>Under Maintenance</h1>
<p>${esc(rows[0].message || "We're performing scheduled maintenance and will be back shortly. Thank you for your patience.")}</p>
<div class="hint">If you believe this is an error, please contact your system administrator.</div>
</div></body></html>`);
      return;
    }
    next();
  }));
};
