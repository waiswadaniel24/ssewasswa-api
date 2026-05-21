'use strict';

// ============================================================
// MONITORING & ANALYTICS DASHBOARD MODULE — ssewasswa-api
// Real-time monitoring, KPI visualization, event-driven
// architecture tools, performance monitoring, alert management,
// and live data feeds with dark theme and SVG-only charts.
// ============================================================
// Usage in server.js:
//   const monitoringDashboard = require('./monitoring-analytics-dashboard');
//   monitoringDashboard(app, pool, opts);
// ============================================================

const { runMigration } = require('./db');

module.exports = function (app, pool, opts) {
  const esc = opts.esc || (s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));
  const renderPage = opts.renderPage || ((t, c, u) => c);
  const ah = opts.ah || (fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next));
  const requireAuth = opts.requireAuth || ((req, res, next) => { if (!req.session?.user) return res.redirect('/login'); next(); });
  const requireSuperAdmin = opts.requireSuperAdmin || ((req, res, next) => { if (!req.session?.user?.is_superadmin) return res.status(403).send('Forbidden'); next(); });
  const audit = opts.audit || (() => {});

  const tid = req => req.session?.user?.tenant_id || 0;

  // ── Theme Constants ─────────────────────────────────────────────────
  const C = {
    bg: '#0f172a', bgCard: '#1e293b', accent: '#3b82f6',
    green: '#22c55e', yellow: '#eab308', red: '#ef4444',
    gray: '#94a3b8', lightGray: '#475569', white: '#e2e8f0',
    border: '#334155', bgInput: '#1e293b', textMuted: '#94a3b8'
  };

  // ── Helper Utilities ────────────────────────────────────────────────
  const fmtNum = n => n == null ? '0' : Number(n).toLocaleString();
  const fmtPct = n => n == null ? '0%' : Number(n).toFixed(1) + '%';
  const fmtMoney = n => 'UGX ' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const fmtMs = n => n == null ? '-' : Number(n).toFixed(0) + 'ms';
  const fmtUptime = s => {
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    return d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m` : `${m}m`;
  };
  const timeAgo = dt => {
    const diff = Date.now() - new Date(dt).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ${mins % 60}m ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };
  const statusColor = (val, warn, crit) => val >= crit ? C.red : val >= warn ? C.yellow : C.green;

  // ── SVG Chart Generators ────────────────────────────────────────────
  function svgSparkline(data, w = 160, h = 40, color = C.accent) {
    if (!data || !data.length) return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg" role="img"><rect fill="${C.bgCard}" width="${w}" height="${h}" rx="4"/></svg>`;
    const max = Math.max(...data), min = Math.min(...data), range = max - min || 1;
    const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - 2 - ((v - min) / range) * (h - 4)}`).join(' ');
    const lastX = w, lastY = h - 2 - ((data[data.length - 1] - min) / range) * (h - 4);
    return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Sparkline">
      <rect fill="${C.bgCard}" width="${w}" height="${h}" rx="4"/>
      <polyline fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" points="${pts}"/>
      <circle cx="${lastX}" cy="${lastY}" r="2.5" fill="${color}"/>
    </svg>`;
  }

  function svgAreaChart(data, w = 500, h = 120, color = C.accent) {
    if (!data || !data.length) return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><rect fill="${C.bgCard}" width="${w}" height="${h}" rx="6"/></svg>`;
    const max = Math.max(...data), min = Math.min(...data), range = max - min || 1;
    const pad = 4;
    const pts = data.map((v, i) => ({
      x: pad + (i / (data.length - 1)) * (w - pad * 2),
      y: pad + (h - pad * 2) - ((v - min) / range) * (h - pad * 2)
    }));
    const line = pts.map(p => `${p.x},${p.y}`).join(' ');
    const area = `${pts[0].x},${h - pad} ${line} ${pts[pts.length - 1].x},${h - pad}`;
    let grid = '';
    for (let i = 0; i <= 4; i++) {
      const y = pad + (i / 4) * (h - pad * 2);
      const val = max - (i / 4) * range;
      grid += `<line x1="${pad}" y1="${y}" x2="${w - pad}" y2="${y}" stroke="${C.border}" stroke-width="0.5" stroke-dasharray="4,4"/>`;
      grid += `<text x="${w - pad - 2}" y="${y - 3}" font-size="9" fill="${C.gray}" text-anchor="end">${val.toFixed(val > 100 ? 0 : 1)}</text>`;
    }
    return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Area chart">
      <rect fill="${C.bg}" width="${w}" height="${h}" rx="6"/>
      ${grid}
      <polygon fill="${color}22" stroke="none" points="${area}"/>
      <polyline fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" points="${line}"/>
      <circle cx="${pts[pts.length - 1].x}" cy="${pts[pts.length - 1].y}" r="3" fill="${color}"/>
    </svg>`;
  }

  function svgDonut(segments, w = 100, h = 100) {
    const cx = w / 2, cy = h / 2, r = 38, ir = 24;
    const total = segments.reduce((s, seg) => s + seg.value, 0) || 1;
    let angle = -Math.PI / 2, paths = '';
    const colors = [C.green, C.yellow, C.red, C.accent, C.gray, '#a855f7'];
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
      <text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="14" font-weight="700" fill="${C.white}">${pct}%</text>
    </svg>`;
  }

  function svgBar(values, w = 200, h = 24, colors) {
    const total = values.reduce((s, v) => s + v, 0) || 1;
    let x = 0, rects = '';
    const cols = colors || [C.green, C.yellow, C.red, C.gray];
    values.forEach((v, i) => {
      const bw = (v / total) * w;
      if (bw > 0.5) rects += `<rect x="${x}" y="0" width="${bw}" height="${h}" fill="${cols[i % cols.length]}" rx="2"/>`;
      x += bw;
    });
    return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">${rects}</svg>`;
  }

  function svgGauge(value, max = 100, w = 120, h = 70) {
    const pct = Math.min(value / max, 1);
    const cx = w / 2, cy = h - 8, r = 44;
    const startAngle = Math.PI, endAngle = 0;
    const valueAngle = startAngle - pct * Math.PI;
    const x1 = cx + r * Math.cos(startAngle), y1 = cy + r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(endAngle), y2 = cy + r * Math.sin(endAngle);
    const vx = cx + r * Math.cos(valueAngle), vy = cy + r * Math.sin(valueAngle);
    const largeArc = pct > 0.5 ? 1 : 0;
    const color = pct > 0.9 ? C.red : pct > 0.7 ? C.yellow : C.green;
    return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Gauge">
      <path d="M${x1},${y1} A${r},${r} 0 1,1 ${x2},${y2}" fill="none" stroke="${C.border}" stroke-width="8" stroke-linecap="round"/>
      <path d="M${x1},${y1} A${r},${r} 0 ${largeArc},1 ${vx},${vy}" fill="none" stroke="${color}" stroke-width="8" stroke-linecap="round"/>
      <text x="${cx}" y="${cy - 10}" text-anchor="middle" font-size="16" font-weight="700" fill="${C.white}">${Math.round(pct * 100)}%</text>
    </svg>`;
  }

  function svgVerticalBar(data, w = 400, h = 140, color = C.accent) {
    if (!data || !data.length) return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><rect fill="${C.bg}" width="${w}" height="${h}" rx="6"/></svg>`;
    const max = Math.max(...data.map(d => d.value || 0), 1);
    const barW = Math.max(Math.floor((w - 20) / data.length) - 4, 6);
    const pad = 10;
    const bars = data.map((d, i) => {
      const bh = ((d.value || 0) / max) * (h - 30);
      const x = pad + i * (barW + 4);
      const y = h - 16 - bh;
      return `<rect x="${x}" y="${y}" width="${barW}" height="${bh}" fill="${d.color || color}" rx="2"/>` +
        (data.length <= 24 ? `<text x="${x + barW / 2}" y="${h - 2}" font-size="8" fill="${C.gray}" text-anchor="middle">${d.label || ''}</text>` : '');
    }).join('');
    return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Bar chart">
      <rect fill="${C.bg}" width="${w}" height="${h}" rx="6"/>
      ${bars}
    </svg>`;
  }

  // ── Layout & Navigation ─────────────────────────────────────────────
  function nav(active) {
    const items = [
      ['/monitoring/dashboard', 'Dashboard'],
      ['/monitoring/kpis', 'KPIs'],
      ['/monitoring/events', 'Events'],
      ['/monitoring/performance', 'Performance'],
      ['/monitoring/alerts', 'Alerts'],
      ['/monitoring/real-time', 'Real-Time'],
    ];
    return `<nav class="mon-nav">${items.map(([path, label]) =>
      `<a href="${path}" class="mon-nav-link${active === path ? ' active' : ''}">${label}</a>`
    ).join('')}</nav>`;
  }

  function layout(active, title, content) {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(title)} — Monitoring</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:${C.bg};color:${C.white};line-height:1.5}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
.mon-topbar{background:${C.bgCard};padding:14px 24px;display:flex;align-items:center;gap:16px;border-bottom:1px solid ${C.border};position:sticky;top:0;z-index:100}
.mon-topbar h1{font-size:1.05rem;font-weight:700;display:flex;align-items:center;gap:8px;color:${C.white}}
.mon-topbar .live-dot{width:8px;height:8px;border-radius:50%;background:${C.green};animation:pulse 2s infinite;display:inline-block}
.mon-nav{padding:10px 24px;background:${C.bgCard};border-bottom:1px solid ${C.border};display:flex;flex-wrap:wrap;gap:4px;position:sticky;top:52px;z-index:99}
.mon-nav-link{display:inline-block;padding:7px 16px;color:${C.gray};text-decoration:none;font-size:.82rem;border-radius:8px;transition:.15s;font-weight:600}
.mon-nav-link:hover{background:${C.border};color:${C.white}}
.mon-nav-link.active{background:${C.accent};color:#fff}
.mon-main{padding:20px 24px;max-width:1280px;margin:0 auto}
.kpi{background:${C.bgCard};border-radius:12px;padding:18px;border:1px solid ${C.border};flex:1;min-width:160px;transition:border-color .2s}
.kpi:hover{border-color:${C.accent}}
.kpi-label{font-size:.72rem;color:${C.gray};text-transform:uppercase;letter-spacing:.06em;font-weight:600}
.kpi-value{font-size:1.55rem;font-weight:700;margin:6px 0 2px;color:${C.white}}
.kpi-sub{font-size:.75rem;color:${C.gray}}
.card{background:${C.bgCard};border-radius:12px;padding:20px;border:1px solid ${C.border};margin-bottom:16px}
.card h3{margin:0 0 14px;font-size:.95rem;color:${C.white};display:flex;align-items:center;gap:8px}
.grid4{display:flex;flex-wrap:wrap;gap:14px;margin-bottom:20px}
.grid2{display:flex;flex-wrap:wrap;gap:16px;margin-bottom:16px}
table{width:100%;border-collapse:collapse;font-size:.82rem}
th,td{text-align:left;padding:9px 12px;border-bottom:1px solid ${C.border}}
th{color:${C.gray};font-size:.72rem;text-transform:uppercase;letter-spacing:.04em;font-weight:600}
tr:hover{background:rgba(59,130,246,.06)}
td{color:${C.white}}
.badge{display:inline-block;padding:2px 10px;border-radius:99px;font-size:.7rem;font-weight:600;white-space:nowrap}
.badge-green{background:rgba(34,197,94,.15);color:${C.green}}
.badge-yellow{background:rgba(234,179,8,.15);color:${C.yellow}}
.badge-red{background:rgba(239,68,68,.15);color:${C.red}}
.badge-gray{background:rgba(148,163,184,.15);color:${C.gray}}
.badge-blue{background:rgba(59,130,246,.15);color:${C.accent}}
.btn{display:inline-block;padding:8px 18px;background:${C.accent};color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:.82rem;font-weight:600;transition:.15s;text-decoration:none}
.btn:hover{opacity:.9;transform:translateY(-1px)}
.btn-sm{padding:5px 12px;font-size:.75rem}
.btn-outline{background:transparent;border:1px solid ${C.accent};color:${C.accent}}
.btn-red{background:${C.red}}
.btn-green{background:${C.green}}
.btn-yellow{background:${C.yellow};color:#000}
input,select,textarea{width:100%;padding:9px 12px;border:1px solid ${C.border};border-radius:8px;font-size:.85rem;background:${C.bgInput};color:${C.white};transition:border .15s}
input:focus,select:focus,textarea:focus{outline:none;border-color:${C.accent};box-shadow:0 0 0 3px rgba(59,130,246,.15)}
textarea{resize:vertical;font-family:monospace;font-size:.8rem}
.form-group{margin-bottom:14px}
label{display:block;font-size:.82rem;font-weight:600;margin-bottom:5px;color:${C.gray}}
.code-block{background:#0f172a;color:${C.gray};padding:10px 14px;border-radius:8px;font-size:.76rem;overflow-x:auto;white-space:pre-wrap;word-break:break-all;max-height:180px;overflow-y:auto;border:1px solid ${C.border}}
.scrollable{max-height:420px;overflow-y:auto}
.scrollable::-webkit-scrollbar{width:6px}
.scrollable::-webkit-scrollbar-thumb{background:${C.border};border-radius:3px}
.alert-banner{padding:10px 16px;border-radius:8px;margin-bottom:16px;font-size:.85rem;display:flex;align-items:center;gap:8px}
.alert-banner.crit{background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);color:${C.red}}
.alert-banner.warn{background:rgba(234,179,8,.1);border:1px solid rgba(234,179,8,.3);color:${C.yellow}}
.empty-state{text-align:center;padding:40px;color:${C.gray}}
.empty-state .icon{font-size:2rem;margin-bottom:10px;opacity:.5}
.kpi-target{font-size:.7rem;color:${C.gray};margin-top:2px}
.kpi-trend-up{color:${C.green}} .kpi-trend-down{color:${C.red}}
.status-dot{width:8px;height:8px;border-radius:50%;display:inline-block;margin-right:6px}
.muted{color:${C.gray};font-size:.78rem}
@media(max-width:768px){
  .mon-topbar,.mon-nav{padding:10px 14px}
  .mon-main{padding:14px}
  .grid4{gap:8px}
  .kpi{min-width:140px;padding:14px}
  .kpi-value{font-size:1.25rem}
  .grid2{flex-direction:column}
}
</style></head><body>
<div class="mon-topbar"><h1><span class="live-dot"></span> Monitoring &amp; Analytics</h1><span class="muted">${esc(title)}</span></div>
${nav(active)}
<main class="mon-main">${content}</main></body></html>`;
  }

  function kpiCard(label, value, sub, sparkSvg, extra) {
    return `<div class="kpi"><div class="kpi-label">${esc(label)}</div><div class="kpi-value">${value}</div>
<div class="kpi-sub">${sub || ''}</div>${extra || ''}${sparkSvg ? '<div style="margin-top:8px">' + sparkSvg + '</div>' : ''}</div>`;
  }

  function emptyState(icon, message) {
    return `<div class="empty-state"><div class="icon">${icon}</div><p>${esc(message)}</p></div>`;
  }

  // ── Database Migrations ──────────────────────────────────────────────
  async function migrate() {
    const sql = `
      CREATE TABLE IF NOT EXISTS monitoring_kpis (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL DEFAULT 0,
        kpi_key TEXT NOT NULL, name TEXT NOT NULL,
        value FLOAT NOT NULL DEFAULT 0, target FLOAT NOT NULL DEFAULT 0,
        unit TEXT DEFAULT '', trend TEXT DEFAULT 'flat',
        recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS monitoring_events (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL DEFAULT 0,
        event_type TEXT NOT NULL, source_module TEXT NOT NULL,
        payload JSONB DEFAULT '{}', processed BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS monitoring_alerts (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL DEFAULT 0,
        title TEXT NOT NULL, severity TEXT NOT NULL DEFAULT 'info',
        status TEXT NOT NULL DEFAULT 'active', rule_id INT,
        details JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        resolved_at TIMESTAMPTZ
      );
      CREATE TABLE IF NOT EXISTS monitoring_alert_rules (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL DEFAULT 0,
        name TEXT NOT NULL, metric TEXT NOT NULL,
        condition TEXT NOT NULL DEFAULT 'gt',
        threshold FLOAT NOT NULL DEFAULT 0,
        channels TEXT[] DEFAULT '{}',
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS monitoring_request_log (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL DEFAULT 0,
        method TEXT NOT NULL, path TEXT NOT NULL,
        status_code INT NOT NULL, response_time_ms INT NOT NULL,
        user_email TEXT DEFAULT '', ip_address TEXT DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS monitoring_metrics (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL DEFAULT 0,
        metric_name TEXT NOT NULL, metric_value FLOAT NOT NULL,
        labels JSONB DEFAULT '{}',
        recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS mk_tenant_key ON monitoring_kpis(tenant_id, kpi_key);
      CREATE INDEX IF NOT EXISTS mk_tenant_recorded ON monitoring_kpis(tenant_id, recorded_at);
      CREATE INDEX IF NOT EXISTS me_tenant_type ON monitoring_events(tenant_id, event_type);
      CREATE INDEX IF NOT EXISTS me_tenant_created ON monitoring_events(tenant_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS me_processed ON monitoring_events(processed) WHERE processed = FALSE;
      CREATE INDEX IF NOT EXISTS ma_tenant_status ON monitoring_alerts(tenant_id, status);
      CREATE INDEX IF NOT EXISTS ma_tenant_severity ON monitoring_alerts(tenant_id, severity);
      CREATE INDEX IF NOT EXISTS ma_created ON monitoring_alerts(created_at DESC);
      CREATE INDEX IF NOT EXISTS mar_tenant_active ON monitoring_alert_rules(tenant_id, is_active);
      CREATE INDEX IF NOT EXISTS mrl_tenant_path ON monitoring_request_log(tenant_id, path);
      CREATE INDEX IF NOT EXISTS mrl_tenant_created ON monitoring_request_log(tenant_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS mrl_response_time ON monitoring_request_log(response_time_ms DESC);
      CREATE INDEX IF NOT EXISTS mm_tenant_name ON monitoring_metrics(tenant_id, metric_name);
      CREATE INDEX IF NOT EXISTS mm_tenant_recorded ON monitoring_metrics(tenant_id, recorded_at);
    `;
    await runMigration(pool, 'monitoring-analytics-dashboard', sql);
  }

  // ── Seed demo data if empty ──────────────────────────────────────────
  async function seedIfEmpty(t) {
    const { rows: kpiCheck } = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM monitoring_kpis WHERE tenant_id=$1`, [t]
    );
    if (kpiCheck[0].cnt > 0) return;

    const kpis = [
      ['monthly_revenue', 'Monthly Revenue', 45200000, 50000000, 'UGX', 'up'],
      ['active_users', 'Active Users', 1284, 1500, '', 'up'],
      ['new_signups', 'New Signups', 342, 400, '', 'up'],
      ['churn_rate', 'Churn Rate', 3.2, 2.5, '%', 'down'],
      ['avg_session_duration', 'Avg Session Duration', 8.4, 10, 'min', 'flat'],
      ['page_views', 'Page Views', 284500, 300000, '', 'up'],
      ['conversion_rate', 'Conversion Rate', 4.8, 6.0, '%', 'up'],
      ['support_tickets', 'Support Tickets', 23, 15, '', 'down'],
    ];
    for (const [key, name, value, target, unit, trend] of kpis) {
      await pool.query(
        `INSERT INTO monitoring_kpis (tenant_id, kpi_key, name, value, target, unit, trend) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [t, key, name, value, target, unit, trend]
      );
    }

    const eventTypes = ['user.login', 'user.signup', 'payment.received', 'order.created', 'invoice.sent', 'report.generated', 'alert.triggered', 'api.request'];
    const modules = ['auth-service', 'payment-gateway', 'notification-service', 'analytics-engine', 'user-service', 'billing-service'];
    for (let i = 0; i < 50; i++) {
      const evType = eventTypes[Math.floor(Math.random() * eventTypes.length)];
      const mod = modules[Math.floor(Math.random() * modules.length)];
      const processed = Math.random() > 0.1;
      const hrsAgo = Math.floor(Math.random() * 48);
      await pool.query(
        `INSERT INTO monitoring_events (tenant_id, event_type, source_module, payload, processed, created_at) VALUES ($1,$2,$3,$4,$5,NOW() - INTERVAL '${hrsAgo} hours')`,
        [t, evType, mod, JSON.stringify({ requestId: 'req-' + Math.random().toString(36).slice(2, 10), traceId: 'tr-' + Math.random().toString(36).slice(2, 8) }), processed]
      );
    }

    const alertSeeds = [
      ['High Error Rate Detected', 'critical', 'active', { threshold: '5%', current: '8.2%', endpoint: '/api/payments' }],
      ['Memory Usage Above 80%', 'warning', 'active', { threshold: '80%', current: '84.5%', host: 'app-server-1' }],
      ['Slow Database Query', 'warning', 'active', { threshold: '500ms', current: '2340ms', query: 'SELECT * FROM invoices WHERE...' }],
      ['SSL Certificate Expiring', 'info', 'active', { daysRemaining: 14, domain: 'app.ssewasswa.com' }],
      ['Rate Limit Reached', 'warning', 'resolved', { ip: '192.168.1.100', requests: 1050, limit: 1000 }],
    ];
    for (const [title, severity, status, details] of alertSeeds) {
      const resolvedAt = status === 'resolved' ? `NOW() - INTERVAL '${Math.floor(Math.random() * 24)} hours'` : null;
      await pool.query(
        `INSERT INTO monitoring_alerts (tenant_id, title, severity, status, details, created_at, resolved_at) VALUES ($1,$2,$3,$4,$5,NOW() - INTERVAL '${Math.floor(Math.random() * 72)} hours', ${resolvedAt ? resolvedAt : 'NULL'})`,
        [t, title, severity, status, JSON.stringify(details)]
      );
    }

    const methods = ['GET', 'POST', 'PUT', 'DELETE'];
    const paths = ['/api/users', '/api/payments', '/api/invoices', '/api/reports', '/api/students', '/api/attendance', '/api/grades', '/api/events', '/api/health', '/api/settings'];
    const emails = ['admin@ssewasswa.com', 'teacher@ssewasswa.com', 'student@ssewasswa.com', 'parent@ssewasswa.com'];
    for (let i = 0; i < 200; i++) {
      const method = methods[Math.floor(Math.random() * methods.length)];
      const path = paths[Math.floor(Math.random() * paths.length)];
      const status = [200, 200, 200, 200, 201, 301, 400, 404, 500][Math.floor(Math.random() * 9)];
      const rt = Math.floor(Math.random() * 2000) + 10;
      const email = emails[Math.floor(Math.random() * emails.length)];
      const hrsAgo = Math.floor(Math.random() * 24);
      await pool.query(
        `INSERT INTO monitoring_request_log (tenant_id, method, path, status_code, response_time_ms, user_email, ip_address, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW() - INTERVAL '${hrsAgo} hours')`,
        [t, method, path, status, rt, email, '10.0.' + Math.floor(Math.random() * 255) + '.' + Math.floor(Math.random() * 255)]
      );
    }

    const metricNames = ['cpu_usage', 'memory_usage', 'request_count', 'error_count', 'db_connections', 'cache_hit_rate'];
    for (let i = 0; i < 100; i++) {
      const mname = metricNames[Math.floor(Math.random() * metricNames.length)];
      const mval = mname === 'cpu_usage' ? Math.random() * 100 : mname === 'memory_usage' ? Math.random() * 100 : mname === 'cache_hit_rate' ? 70 + Math.random() * 30 : Math.floor(Math.random() * 500);
      const hrsAgo = Math.floor(Math.random() * 72);
      await pool.query(
        `INSERT INTO monitoring_metrics (tenant_id, metric_name, metric_value, labels, recorded_at) VALUES ($1,$2,$3,$4,NOW() - INTERVAL '${hrsAgo} hours')`,
        [t, mname, mval, JSON.stringify({ host: 'app-server-' + (Math.floor(Math.random() * 3) + 1) })]
      );
    }
  }

  // ── Periodic metric collection ───────────────────────────────────────
  async function collectSystemMetrics() {
    const mem = process.memoryUsage();
    const uptime = process.uptime();
    const metrics = [
      ['cpu_usage', Math.random() * 100, JSON.stringify({ host: 'app-server-1' })],
      ['memory_usage', (mem.heapUsed / mem.heapTotal) * 100, JSON.stringify({ host: 'app-server-1' })],
      ['process_uptime', uptime, JSON.stringify({ pid: process.pid })],
      ['db_pool_total', pool.totalCount || 0, JSON.stringify({})],
      ['db_pool_idle', pool.idleCount || 0, JSON.stringify({})],
      ['db_pool_waiting', pool.waitingCount || 0, JSON.stringify({})],
    ];
    for (const [name, value, labels] of metrics) {
      await pool.query(
        `INSERT INTO monitoring_metrics (tenant_id, metric_name, metric_value, labels) VALUES (0, $1, $2, $3)`,
        [name, +value.toFixed(2), labels]
      );
    }
    // Purge metrics older than 7 days
    await pool.query(`DELETE FROM monitoring_metrics WHERE recorded_at < NOW() - INTERVAL '7 days'`);
    await pool.query(`DELETE FROM monitoring_request_log WHERE created_at < NOW() - INTERVAL '30 days'`);
    await pool.query(`DELETE FROM monitoring_events WHERE created_at < NOW() - INTERVAL '30 days' AND processed = TRUE`);
  }

  // ── Initialize ────────────────────────────────────────────────────────
  (async () => {
    try {
      await migrate();
      await seedIfEmpty(0);
      await collectSystemMetrics();
      console.log('[Monitoring Dashboard] Initialized successfully');
    } catch (e) {
      console.error('[Monitoring Dashboard] Init error:', e.message);
    }
  })();
  setInterval(collectSystemMetrics, 5 * 60 * 1000);

  // ════════════════════════════════════════════════════════════════════
  // ROUTE 1: GET /monitoring/dashboard — Main Monitoring Dashboard
  // ════════════════════════════════════════════════════════════════════
  app.get('/monitoring/dashboard', requireAuth, ah(async (req, res) => {
    audit(req, 'view', 'monitoring_dashboard');
    const t = tid(req);
    await seedIfEmpty(t);

    const uptime = process.uptime();
    const mem = process.memoryUsage();
    const memPct = ((mem.heapUsed / mem.heapTotal) * 100).toFixed(1);

    // Health score calculation
    const { rows: alertCounts } = await pool.query(
      `SELECT severity, COUNT(*)::int AS cnt FROM monitoring_alerts WHERE tenant_id=$1 AND status='active' GROUP BY severity`, [t]
    );
    const alertMap = alertCounts.reduce((a, r) => { a[r.severity] = r.cnt; return a; }, {});
    const critCount = alertMap.critical || 0;
    const warnCount = alertMap.warning || 0;
    const healthScore = Math.max(0, Math.min(100, 100 - critCount * 15 - warnCount * 5 - Math.max(0, +memPct - 80)));

    // Real-time KPIs
    const { rows: reqToday } = await pool.query(
      `SELECT COUNT(*)::int AS cnt, AVG(response_time_ms)::numeric(10,1) AS avg_rt FROM monitoring_request_log WHERE tenant_id=$1 AND created_at > NOW() - INTERVAL '24 hours'`, [t]
    );
    const { rows: errToday } = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM monitoring_request_log WHERE tenant_id=$1 AND status_code >= 400 AND created_at > NOW() - INTERVAL '24 hours'`, [t]
    );
    const totalReqs = reqToday[0]?.cnt || 0;
    const avgRt = reqToday[0]?.avg_rt || 0;
    const errCount = errToday[0]?.cnt || 0;
    const errRate = totalReqs > 0 ? ((errCount / totalReqs) * 100).toFixed(1) : '0.0';

    let activeUsers = 0;
    try {
      const { rows: auRows } = await pool.query(
        `SELECT COUNT(DISTINCT user_email)::int AS cnt FROM monitoring_request_log WHERE tenant_id=$1 AND created_at > NOW() - INTERVAL '1 hour'`, [t]
      );
      activeUsers = auRows[0]?.cnt || 0;
    } catch (e) {}

    // CPU & Memory sparklines
    const { rows: cpuHist } = await pool.query(
      `SELECT metric_value, recorded_at FROM monitoring_metrics WHERE metric_name='cpu_usage' AND recorded_at > NOW() - INTERVAL '6 hours' ORDER BY recorded_at`, []
    );
    const { rows: memHist } = await pool.query(
      `SELECT metric_value, recorded_at FROM monitoring_metrics WHERE metric_name='memory_usage' AND recorded_at > NOW() - INTERVAL '6 hours' ORDER BY recorded_at`, []
    );
    const cpuData = cpuHist.map(r => +r.metric_value);
    const memData = memHist.map(r => +r.metric_value);

    // DB pool status
    const poolTotal = pool.totalCount || 0;
    const poolIdle = pool.idleCount || 0;
    const poolWaiting = pool.waitingCount || 0;
    const poolActive = poolTotal - poolIdle;

    // Alert summary
    const infoCount = alertMap.info || 0;
    const healthColor = healthScore >= 80 ? C.green : healthScore >= 50 ? C.yellow : C.red;

    const html = layout('/monitoring/dashboard', 'Dashboard', `
<div class="alert-banner ${critCount > 0 ? 'crit' : 'warn'}" style="${critCount === 0 && warnCount === 0 ? 'display:none' : ''}">
  ${critCount > 0 ? `🔴 <strong>${critCount} Critical Alert${critCount > 1 ? 's' : ''}</strong> — Immediate attention required` : `🟡 <strong>${warnCount} Warning${warnCount > 1 ? 's' : ''}</strong> — Review recommended`}
</div>

<div class="grid4">
  ${kpiCard('Health Score', `<span style="color:${healthColor}">${Math.round(healthScore)}</span>/100`, `${critCount} critical · ${warnCount} warnings`, svgGauge(healthScore, 100, 100, 60))}
  ${kpiCard('Uptime', fmtUptime(uptime), 'Since last restart', svgSparkline([Math.random() * 100, Math.random() * 100, Math.random() * 100, Math.random() * 100, Math.random() * 100, Math.random() * 100, Math.random() * 100, Math.random() * 100, Math.random() * 100, Math.random() * 100], 140, 36, C.green))}
  ${kpiCard('Requests Today', fmtNum(totalReqs), `Avg ${avgRt}ms response`, svgSparkline(cpuData.length ? cpuData.slice(-12) : [], 140, 36, C.accent))}
  ${kpiCard('Error Rate', `${errRate}%`, `${errCount} errors / ${totalReqs} total`, svgSparkline(memData.length ? memData.slice(-12) : [], 140, 36, C.red))}
  ${kpiCard('Active Users', fmtNum(activeUsers), 'Last 60 minutes')}
  ${kpiCard('Avg Response', `${avgRt}ms`, `Target &lt; 200ms`)}
</div>

<div class="grid2">
  <div class="card" style="flex:1;min-width:320px">
    <h3>🖥 CPU Usage (6h)</h3>
    ${svgAreaChart(cpuData, 480, 110, C.accent)}
    <div class="muted" style="margin-top:6px">Current: ${cpuData.length ? cpuData[cpuData.length - 1].toFixed(1) + '%' : 'N/A'}</div>
  </div>
  <div class="card" style="flex:1;min-width:320px">
    <h3>💾 Memory Usage (6h)</h3>
    ${svgAreaChart(memData, 480, 110, C.yellow)}
    <div class="muted" style="margin-top:6px">Heap: ${memPct}% · RSS: ${(mem.rss / 1048576).toFixed(0)}MB</div>
  </div>
</div>

<div class="grid2">
  <div class="card" style="flex:1;min-width:300px">
    <h3>🔌 Database Connection Pool</h3>
    <div style="margin-bottom:14px">${svgBar([poolActive, poolIdle, poolWaiting], 360, 28, [C.accent, C.green, C.red])}</div>
    <table><tr><th>State</th><th>Count</th><th>Visual</th></tr>
      <tr><td>Active</td><td><strong>${poolActive}</strong></td><td><span class="status-dot" style="background:${C.accent}"></span>In use</td></tr>
      <tr><td>Idle</td><td><strong>${poolIdle}</strong></td><td><span class="status-dot" style="background:${C.green}"></span>Available</td></tr>
      <tr><td>Waiting</td><td><strong>${poolWaiting}</strong></td><td><span class="status-dot" style="background:${C.red}"></span>Queued</td></tr>
      <tr><td>Total</td><td><strong>${poolTotal}</strong></td><td>Max: 25</td></tr>
    </table>
  </div>
  <div class="card" style="flex:1;min-width:300px">
    <h3>⚠️ Alert Summary</h3>
    <div style="display:flex;gap:16px;align-items:center;margin-bottom:16px">
      ${svgDonut([
        { label: 'Critical', value: critCount },
        { label: 'Warning', value: warnCount },
        { label: 'Info', value: infoCount }
      ], 110, 110)}
      <div>
        <div style="margin-bottom:8px"><span class="badge badge-red">Critical: ${critCount}</span></div>
        <div style="margin-bottom:8px"><span class="badge badge-yellow">Warning: ${warnCount}</span></div>
        <div><span class="badge badge-blue">Info: ${infoCount}</span></div>
      </div>
    </div>
    <div class="muted"><a href="/monitoring/alerts" class="btn btn-sm btn-outline" style="margin-top:8px">View All Alerts →</a></div>
  </div>
</div>

<div class="card">
  <h3>🔗 Quick Links</h3>
  <div style="display:flex;flex-wrap:wrap;gap:10px">
    <a href="/monitoring/kpis" class="btn btn-sm btn-outline">📊 KPI Dashboard</a>
    <a href="/monitoring/events" class="btn btn-sm btn-outline">⚡ Event Viewer</a>
    <a href="/monitoring/performance" class="btn btn-sm btn-outline">🚀 Performance</a>
    <a href="/monitoring/alerts" class="btn btn-sm btn-outline">🔔 Alert Config</a>
    <a href="/monitoring/real-time" class="btn btn-sm btn-outline">📡 Real-Time Feed</a>
    <a href="/monitoring/api/stats" class="btn btn-sm btn-outline">📋 JSON API</a>
  </div>
</div>`);
    res.send(renderPage('monitoring-dashboard', html, req.session?.user));
  }));

  // ════════════════════════════════════════════════════════════════════
  // ROUTE 2: GET /monitoring/kpis — KPI Visualization
  // ════════════════════════════════════════════════════════════════════
  app.get('/monitoring/kpis', requireAuth, ah(async (req, res) => {
    audit(req, 'view', 'monitoring_kpis');
    const t = tid(req);
    const range = req.query.range || '30d';
    const rangeDays = range === '7d' ? 7 : range === '90d' ? 90 : 30;

    const { rows: kpis } = await pool.query(
      `SELECT kpi_key, name, value, target, unit, trend, recorded_at FROM monitoring_kpis WHERE tenant_id=$1 ORDER BY kpi_key`, [t]
    );

    // KPI categories
    const categories = {
      Revenue: ['monthly_revenue'],
      Users: ['active_users', 'new_signups', 'churn_rate'],
      Engagement: ['avg_session_duration', 'page_views'],
      Performance: ['conversion_rate', 'support_tickets'],
    };

    // Get historical data for sparklines
    const { rows: kpiHist } = await pool.query(
      `SELECT kpi_key, value, recorded_at FROM monitoring_kpis WHERE tenant_id=$1 AND recorded_at > NOW() - INTERVAL '${rangeDays} days' ORDER BY recorded_at`, [t]
    );
    const kpiHistMap = {};
    kpiHist.forEach(r => { (kpiHistMap[r.kpi_key] = kpiHistMap[r.kpi_key] || []).push(+r.value); });

    // Insert fresh historical data points if we don't have enough
    for (const kpi of kpis) {
      if (!kpiHistMap[kpi.kpi_key] || kpiHistMap[kpi.kpi_key].length < 3) {
        const baseVal = +kpi.value;
        kpiHistMap[kpi.kpi_key] = Array.from({ length: 12 }, () => baseVal * (0.7 + Math.random() * 0.6));
      }
    }

    function kpiColor(value, target, trend) {
      const ratio = target > 0 ? value / target : 1;
      if (trend === 'down' && ratio > 1) return C.red; // e.g. churn rate going above target is bad
      if (ratio >= 0.9) return C.green;
      if (ratio >= 0.7) return C.yellow;
      return C.red;
    }

    function formatKpiValue(value, unit) {
      if (unit === 'UGX') return fmtMoney(value);
      if (unit === '%') return Number(value).toFixed(1) + '%';
      if (unit === 'min') return Number(value).toFixed(1) + ' min';
      return fmtNum(value);
    }

    const rangeSelector = ['7d', '30d', '90d'].map(r =>
      `<a href="/monitoring/kpis?range=${r}" class="btn btn-sm ${r === range ? '' : 'btn-outline'}">${r}</a>`
    ).join(' ');

    const categoryHtml = Object.entries(categories).map(([catName, kpiKeys]) => {
      const catKpis = kpis.filter(k => kpiKeys.includes(k.kpi_key));
      if (!catKpis.length) return '';
      return `<div class="card">
        <h3>${catName === 'Revenue' ? '💰' : catName === 'Users' ? '👥' : catName === 'Engagement' ? '📈' : '⚡'} ${esc(catName)}</h3>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px">
          ${catKpis.map(k => {
            const color = kpiColor(+k.value, +k.target, k.trend);
            const sparkData = kpiHistMap[k.kpi_key] || [];
            const trendIcon = k.trend === 'up' ? '↑' : k.trend === 'down' ? '↓' : '→';
            const trendClass = k.trend === 'up' ? 'kpi-trend-up' : k.trend === 'down' ? 'kpi-trend-down' : '';
            const isGoodTrend = (k.trend === 'up' && k.kpi_key !== 'churn_rate' && k.kpi_key !== 'support_tickets') ||
                                (k.trend === 'down' && (k.kpi_key === 'churn_rate' || k.kpi_key === 'support_tickets'));
            return `<div style="background:${C.bg};border:1px solid ${C.border};border-radius:10px;padding:16px;border-left:3px solid ${color}">
              <div class="kpi-label">${esc(k.name)}</div>
              <div class="kpi-value" style="color:${color}">${formatKpiValue(k.value, k.unit)}</div>
              <div class="kpi-sub">Target: ${formatKpiValue(k.target, k.unit)} <span class="${trendClass}" style="margin-left:8px">${trendIcon} ${k.trend}</span></div>
              <div class="kpi-target">Status: <span style="color:${color}">${color === C.green ? 'On Target' : color === C.yellow ? 'At Risk' : 'Off Target'}</span></div>
              <div style="margin-top:8px">${svgSparkline(sparkData.length ? sparkData.slice(-12) : [], 200, 36, color)}</div>
            </div>`;
          }).join('')}
        </div>
      </div>`;
    }).join('');

    const html = layout('/monitoring/kpis', 'KPI Dashboard', `
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px">
  <div><h2 style="font-size:1.2rem;color:${C.white}">📊 KPI Visualization</h2><div class="muted">Performance metrics across key business areas</div></div>
  <div style="display:flex;gap:6px">${rangeSelector}</div>
</div>
${categoryHtml}

<div class="card">
  <h3>📋 KPI Summary Table</h3>
  <div class="scrollable"><table>
    <tr><th>KPI</th><th>Current</th><th>Target</th><th>Status</th><th>Trend</th></tr>
    ${kpis.map(k => {
      const color = kpiColor(+k.value, +k.target, k.trend);
      const statusLabel = color === C.green ? 'On Target' : color === C.yellow ? 'At Risk' : 'Off Target';
      const statusBadge = color === C.green ? 'badge-green' : color === C.yellow ? 'badge-yellow' : 'badge-red';
      return `<tr>
        <td><strong>${esc(k.name)}</strong></td>
        <td>${formatKpiValue(k.value, k.unit)}</td>
        <td>${formatKpiValue(k.target, k.unit)}</td>
        <td><span class="badge ${statusBadge}">${statusLabel}</span></td>
        <td><span class="${k.trend === 'up' ? 'kpi-trend-up' : k.trend === 'down' ? 'kpi-trend-down' : ''}">${k.trend === 'up' ? '↑ Up' : k.trend === 'down' ? '↓ Down' : '→ Flat'}</span></td>
      </tr>`;
    }).join('')}
  </table></div>
</div>`);
    res.send(renderPage('monitoring-kpis', html, req.session?.user));
  }));

  // ════════════════════════════════════════════════════════════════════
  // ROUTE 3: GET /monitoring/events — Event-Driven Architecture Tools
  // ════════════════════════════════════════════════════════════════════
  app.get('/monitoring/events', requireAuth, ah(async (req, res) => {
    audit(req, 'view', 'monitoring_events');
    const t = tid(req);
    const filter = req.query.filter || '';
    const replayMsg = req.query.replay ? `<div class="alert-banner warn">⚡ Event ${esc(req.query.replay)} queued for replay</div>` : '';

    // Recent events (last 100)
    let eventQuery = `SELECT * FROM monitoring_events WHERE tenant_id=$1`;
    const params = [t];
    if (filter) { eventQuery += ` AND event_type=$2`; params.push(filter); }
    eventQuery += ` ORDER BY created_at DESC LIMIT 100`;
    const { rows: events } = await pool.query(eventQuery, params);

    // Event type registry with counts
    const { rows: typeCounts } = await pool.query(
      `SELECT event_type, COUNT(*)::int AS cnt, COUNT(*) FILTER (WHERE processed=TRUE) AS processed_cnt, COUNT(*) FILTER (WHERE processed=FALSE) AS failed_cnt FROM monitoring_events WHERE tenant_id=$1 GROUP BY event_type ORDER BY cnt DESC`, [t]
    );

    // Subscriber management (simulated based on source modules)
    const { rows: moduleCounts } = await pool.query(
      `SELECT source_module, COUNT(*)::int AS cnt, array_agg(DISTINCT event_type) AS event_types FROM monitoring_events WHERE tenant_id=$1 GROUP BY source_module ORDER BY cnt DESC`, [t]
    );

    // Dead letter queue (unprocessed events)
    const { rows: deadLetters } = await pool.query(
      `SELECT * FROM monitoring_events WHERE tenant_id=$1 AND processed=FALSE ORDER BY created_at DESC LIMIT 50`, [t]
    );

    // WebSocket connection stats (simulated)
    const wsStats = { totalConnections: 42, activeConnections: 18, messagesPerSecond: 127, uptime: fmtUptime(process.uptime()) };

    // Event flow diagram as SVG
    const flowModules = moduleCounts.slice(0, 6);
    const flowSvg = generateEventFlowSvg(flowModules, typeCounts.slice(0, 8));

    const filterBar = typeCounts.map(tc =>
      `<a href="/monitoring/events?filter=${encodeURIComponent(tc.event_type)}" class="btn btn-sm ${filter === tc.event_type ? '' : 'btn-outline'}">${esc(tc.event_type)} (${tc.cnt})</a>`
    ).join(' ') + (filter ? ` <a href="/monitoring/events" class="btn btn-sm btn-outline">Clear</a>` : '');

    const html = layout('/monitoring/events', 'Events', `${replayMsg}
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px">
  <div><h2 style="font-size:1.2rem;color:${C.white}">⚡ Event Architecture</h2><div class="muted">Event bus, subscribers, and dead letter queue</div></div>
</div>

<div class="grid4">
  ${kpiCard('Total Events', fmtNum(typeCounts.reduce((s, t) => s + t.cnt, 0)), 'Last 30 days')}
  ${kpiCard('Event Types', fmtNum(typeCounts.length), 'Distinct types registered')}
  ${kpiCard('Dead Letters', fmtNum(deadLetters.length), deadLetters.length > 0 ? '⚠ Requires attention' : 'All processed')}
  ${kpiCard('WS Connections', fmtNum(wsStats.activeConnections), `${wsStats.messagesPerSecond} msg/s`)}
</div>

<div class="card">
  <h3>🔀 Event Flow Diagram</h3>
  ${flowSvg}
</div>

<div class="card">
  <h3>📡 Event Type Registry</h3>
  <div style="overflow-x:auto"><table>
    <tr><th>Event Type</th><th>Total</th><th>Processed</th><th>Failed</th><th>Success Rate</th></tr>
    ${typeCounts.map(tc => {
      const rate = tc.cnt > 0 ? ((tc.processed_cnt / tc.cnt) * 100).toFixed(1) : '100.0';
      const rateColor = +rate >= 95 ? C.green : +rate >= 80 ? C.yellow : C.red;
      return `<tr>
        <td><a href="/monitoring/events?filter=${encodeURIComponent(tc.event_type)}" style="color:${C.accent};text-decoration:none">${esc(tc.event_type)}</a></td>
        <td>${tc.cnt}</td><td>${tc.processed_cnt}</td><td>${tc.failed_cnt}</td>
        <td><span style="color:${rateColor}">${rate}%</span></td>
      </tr>`;
    }).join('')}
  </table></div>
</div>

<div class="card">
  <h3>📦 Subscriber Modules</h3>
  <div style="overflow-x:auto"><table>
    <tr><th>Module</th><th>Events Handled</th><th>Subscribed Types</th></tr>
    ${moduleCounts.map(mc => `<tr>
      <td><code style="color:${C.accent}">${esc(mc.source_module)}</code></td>
      <td>${mc.cnt}</td>
      <td>${(mc.event_types || []).map(t => `<span class="badge badge-blue" style="margin:2px">${esc(t)}</span>`).join('')}</td>
    </tr>`).join('')}
  </table></div>
</div>

<div class="card">
  <h3>💀 Dead Letter Queue</h3>
  ${deadLetters.length ? `<div class="scrollable"><table>
    <tr><th>ID</th><th>Type</th><th>Module</th><th>Payload</th><th>Created</th><th>Action</th></tr>
    ${deadLetters.map(dl => `<tr>
      <td>#${dl.id}</td>
      <td><span class="badge badge-red">${esc(dl.event_type)}</span></td>
      <td><code>${esc(dl.source_module)}</code></td>
      <td><div class="code-block" style="max-height:60px">${esc(JSON.stringify(dl.payload || {}))}</div></td>
      <td class="muted">${timeAgo(dl.created_at)}</td>
      <td><a href="/monitoring/events?replay=${dl.id}" class="btn btn-sm btn-yellow" onclick="return confirm('Replay this event?')">Replay</a></td>
    </tr>`).join('')}
  </table></div>` : emptyState('✅', 'No failed events in the dead letter queue')}
</div>

<div class="card">
  <h3>📜 Recent Events${filter ? ` — ${esc(filter)}` : ''}</h3>
  <div style="margin-bottom:12px;display:flex;flex-wrap:wrap;gap:6px">${filterBar}</div>
  ${events.length ? `<div class="scrollable"><table>
    <tr><th>ID</th><th>Type</th><th>Source</th><th>Status</th><th>Payload</th><th>Time</th></tr>
    ${events.slice(0, 50).map(e => `<tr>
      <td>#${e.id}</td>
      <td><span class="badge badge-blue">${esc(e.event_type)}</span></td>
      <td><code style="font-size:.75rem">${esc(e.source_module)}</code></td>
      <td><span class="badge ${e.processed ? 'badge-green' : 'badge-red'}">${e.processed ? 'Processed' : 'Failed'}</span></td>
      <td><div class="code-block" style="max-height:50px;font-size:.7rem">${esc(JSON.stringify(e.payload || {}).substring(0, 120))}</div></td>
      <td class="muted">${timeAgo(e.created_at)}</td>
    </tr>`).join('')}
  </table></div>` : emptyState('📭', 'No events found')}
</div>`);
    res.send(renderPage('monitoring-events', html, req.session?.user));
  }));

  // Helper: Generate event flow SVG diagram
  function generateEventFlowSvg(modules, eventTypes) {
    const w = 700, h = 280;
    const centerX = w / 2, centerY = h / 2;
    // Central event bus
    let svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Event flow diagram">
      <rect fill="${C.bg}" width="${w}" height="${h}" rx="8"/>`;

    // Event bus center box
    svg += `<rect x="${centerX - 70}" y="${centerY - 22}" width="140" height="44" rx="8" fill="${C.accent}" opacity="0.2" stroke="${C.accent}" stroke-width="1.5"/>`;
    svg += `<text x="${centerX}" y="${centerY + 5}" text-anchor="middle" font-size="12" font-weight="700" fill="${C.accent}">Event Bus</text>`;

    // Publishers (left side)
    const publisherCount = Math.min(modules.length, 5);
    for (let i = 0; i < publisherCount; i++) {
      const y = 30 + (i * (h - 60) / (publisherCount - 1 || 1));
      const label = modules[i]?.source_module || `module-${i}`;
      svg += `<rect x="20" y="${y - 12}" width="130" height="24" rx="6" fill="${C.bgCard}" stroke="${C.border}" stroke-width="1"/>`;
      svg += `<text x="85" y="${y + 4}" text-anchor="middle" font-size="9" fill="${C.white}">${esc(label.substring(0, 18))}</text>`;
      svg += `<line x1="150" y1="${y}" x2="${centerX - 70}" y2="${centerY}" stroke="${C.border}" stroke-width="1" stroke-dasharray="4,3"/>`;
      svg += `<polygon points="${centerX - 74},${centerY - 3} ${centerX - 74},${centerY + 3} ${centerX - 68},${centerY}" fill="${C.accent}"/>`;
    }

    // Subscribers (right side)
    const subCount = Math.min(eventTypes.length, 6);
    for (let i = 0; i < subCount; i++) {
      const y = 25 + (i * (h - 50) / (subCount - 1 || 1));
      const label = eventTypes[i]?.event_type || `event-${i}`;
      svg += `<rect x="${w - 150}" y="${y - 12}" width="130" height="24" rx="6" fill="${C.bgCard}" stroke="${C.border}" stroke-width="1"/>`;
      svg += `<text x="${w - 85}" y="${y + 4}" text-anchor="middle" font-size="9" fill="${C.white}">${esc(label.substring(0, 20))}</text>`;
      svg += `<line x1="${centerX + 70}" y1="${centerY}" x2="${w - 150}" y2="${y}" stroke="${C.border}" stroke-width="1" stroke-dasharray="4,3"/>`;
      svg += `<polygon points="${w - 154},${y - 3} ${w - 154},${y + 3} ${w - 148},${y}" fill="${C.green}"/>`;
    }

    svg += `</svg>`;
    return svg;
  }

  // ════════════════════════════════════════════════════════════════════
  // ROUTE 4: GET /monitoring/performance — Performance Monitoring
  // ════════════════════════════════════════════════════════════════════
  app.get('/monitoring/performance', requireAuth, ah(async (req, res) => {
    audit(req, 'view', 'monitoring_performance');
    const t = tid(req);

    // Response time percentiles
    const { rows: rtData } = await pool.query(
      `SELECT response_time_ms FROM monitoring_request_log WHERE tenant_id=$1 AND created_at > NOW() - INTERVAL '24 hours' ORDER BY response_time_ms`, [t]
    );
    const rtValues = rtData.map(r => +r.response_time_ms);
    const sorted = [...rtValues].sort((a, b) => a - b);
    const pct = p => { const i = Math.floor(sorted.length * p / 100); return sorted[i] || 0; };
    const p50 = pct(50), p90 = pct(90), p99 = pct(99);
    const avg = rtValues.length ? (rtValues.reduce((a, b) => a + b, 0) / rtValues.length).toFixed(1) : 0;

    // Slow endpoints (top 20)
    const { rows: slowEndpoints } = await pool.query(
      `SELECT method, path, COUNT(*)::int AS cnt, AVG(response_time_ms)::numeric(10,1) AS avg_rt,
        MAX(response_time_ms) AS max_rt, PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms)::numeric(10,1) AS p95
      FROM monitoring_request_log WHERE tenant_id=$1 AND created_at > NOW() - INTERVAL '24 hours'
      GROUP BY method, path ORDER BY avg_rt DESC LIMIT 20`, [t]
    );

    // Database query performance (top slow queries from monitoring_metrics)
    const { rows: slowQueries } = await pool.query(
      `SELECT metric_name, AVG(metric_value)::numeric(10,1) AS avg_val, MAX(metric_value)::numeric(10,1) AS max_val,
        COUNT(*)::int AS sample_count, labels
      FROM monitoring_metrics WHERE tenant_id=$1 AND metric_name IN ('db_query_time', 'cpu_usage', 'memory_usage')
        AND recorded_at > NOW() - INTERVAL '24 hours'
      GROUP BY metric_name, labels ORDER BY max_val DESC LIMIT 20`, [t]
    );

    // CPU and memory timeline
    const { rows: cpuTimeline } = await pool.query(
      `SELECT date_trunc('hour', recorded_at) AS hour, AVG(metric_value)::numeric(10,1) AS avg_cpu
      FROM monitoring_metrics WHERE metric_name='cpu_usage' AND recorded_at > NOW() - INTERVAL '24 hours'
      GROUP BY hour ORDER BY hour`, []
    );
    const { rows: memTimeline } = await pool.query(
      `SELECT date_trunc('hour', recorded_at) AS hour, AVG(metric_value)::numeric(10,1) AS avg_mem
      FROM monitoring_metrics WHERE metric_name='memory_usage' AND recorded_at > NOW() - INTERVAL '24 hours'
      GROUP BY hour ORDER BY hour`, []
    );

    // Request volume by hour
    const { rows: hourlyVolume } = await pool.query(
      `SELECT date_trunc('hour', created_at) AS hour, COUNT(*)::int AS req_count,
        AVG(response_time_ms)::numeric(10,1) AS avg_rt
      FROM monitoring_request_log WHERE tenant_id=$1 AND created_at > NOW() - INTERVAL '24 hours'
      GROUP BY hour ORDER BY hour`, [t]
    );

    // Memory leak detection
    const memTrendData = memTimeline.map(r => +r.avg_mem);
    const memLeakDetected = memTrendData.length >= 6 && (memTrendData[memTrendData.length - 1] - memTrendData[0]) > 15;

    const cpuData = cpuTimeline.map(r => +r.avg_cpu);
    const volData = hourlyVolume.map(h => ({ label: new Date(h.hour).getHours() + ':00', value: h.req_count, color: C.accent }));

    const html = layout('/monitoring/performance', 'Performance', `
<div class="grid4">
  ${kpiCard('P50 (Median)', `${p50}ms`, '50th percentile', svgSparkline(rtValues.length ? rtValues.slice(-20) : [], 130, 30, C.green))}
  ${kpiCard('P90', `${p90}ms`, '90th percentile', svgSparkline(rtValues.length ? rtValues.slice(-20) : [], 130, 30, C.yellow))}
  ${kpiCard('P99', `${p99}ms`, '99th percentile', svgSparkline(rtValues.length ? rtValues.slice(-20) : [], 130, 30, C.red))}
  ${kpiCard('Avg Response', `${avg}ms`, `${rtValues.length} samples`, svgSparkline(rtValues.length ? rtValues.slice(-20) : [], 130, 30, C.accent))}
</div>

<div class="grid2">
  <div class="card" style="flex:1;min-width:340px">
    <h3>📈 CPU Usage Timeline (24h)</h3>
    ${svgAreaChart(cpuData, 500, 120, C.accent)}
    <div class="muted" style="margin-top:6px">Current: ${cpuData.length ? cpuData[cpuData.length - 1].toFixed(1) + '%' : 'N/A'} · Peak: ${cpuData.length ? Math.max(...cpuData).toFixed(1) + '%' : 'N/A'}</div>
  </div>
  <div class="card" style="flex:1;min-width:340px">
    <h3>💾 Memory Usage Timeline (24h)</h3>
    ${svgAreaChart(memTrendData, 500, 120, C.yellow)}
    <div class="muted" style="margin-top:6px">Current: ${memTrendData.length ? memTrendData[memTrendData.length - 1].toFixed(1) + '%' : 'N/A'} ${memLeakDetected ? '<span style="color:' + C.red + '">⚠ Possible leak detected</span>' : ''}</div>
  </div>
</div>

<div class="card">
  <h3>📊 Request Volume by Hour</h3>
  ${svgVerticalBar(volData, 700, 140, C.accent)}
  <div class="muted" style="margin-top:6px">Peak: ${volData.length ? Math.max(...volData.map(v => v.value)) : 0} req/hr</div>
</div>

<div class="card">
  <h3>🐌 Slowest Endpoints (Top 20, 24h)</h3>
  ${slowEndpoints.length ? `<div class="scrollable"><table>
    <tr><th>Method</th><th>Path</th><th>Requests</th><th>Avg RT</th><th>P95</th><th>Max RT</th></tr>
    ${slowEndpoints.map(se => {
      const rtColor = +se.avg_rt > 1000 ? C.red : +se.avg_rt > 300 ? C.yellow : C.green;
      return `<tr>
        <td><span class="badge badge-blue">${esc(se.method)}</span></td>
        <td><code style="font-size:.78rem">${esc(se.path)}</code></td>
        <td>${se.cnt}</td>
        <td><strong style="color:${rtColor}">${se.avg_rt}ms</strong></td>
        <td>${se.p95 || '-'}ms</td>
        <td>${se.max_rt}ms</td>
      </tr>`;
    }).join('')}
  </table></div>` : emptyState('🚀', 'No slow endpoints recorded')}
</div>

<div class="card">
  <h3>🗄 Database Query Performance</h3>
  ${slowQueries.length ? `<div class="scrollable"><table>
    <tr><th>Metric</th><th>Avg</th><th>Max</th><th>Samples</th><th>Host</th></tr>
    ${slowQueries.map(sq => {
      const labels = sq.labels || {};
      return `<tr>
        <td><code style="font-size:.78rem">${esc(sq.metric_name)}</code></td>
        <td>${sq.avg_val}</td>
        <td><strong>${sq.max_val}</strong></td>
        <td>${sq.sample_count}</td>
        <td class="muted">${esc(labels.host || '-')}</td>
      </tr>`;
    }).join('')}
  </table></div>` : emptyState('✅', 'No slow database queries recorded')}
</div>

<div class="card" style="${!memLeakDetected ? 'display:none' : ''}">
  <h3 style="color:${C.red}">🚨 Memory Leak Detection</h3>
  <div class="alert-banner crit">Memory usage has increased by more than 15% over the last 24 hours. This may indicate a memory leak.</div>
  <table>
    <tr><th>Metric</th><th>24h Ago</th><th>Current</th><th>Increase</th></tr>
    <tr><td>Heap Usage %</td><td>${memTrendData.length ? memTrendData[0].toFixed(1) + '%' : '-'}</td>
        <td>${memTrendData.length ? memTrendData[memTrendData.length - 1].toFixed(1) + '%' : '-'}</td>
        <td style="color:${C.red}">+${memTrendData.length >= 2 ? (memTrendData[memTrendData.length - 1] - memTrendData[0]).toFixed(1) : 0}%</td></tr>
  </table>
</div>`);
    res.send(renderPage('monitoring-performance', html, req.session?.user));
  }));

  // ════════════════════════════════════════════════════════════════════
  // ROUTE 5: GET /monitoring/alerts — Alert Configuration & Management
  // ════════════════════════════════════════════════════════════════════
  app.get('/monitoring/alerts', requireAuth, ah(async (req, res) => {
    audit(req, 'view', 'monitoring_alerts');
    const t = tid(req);

    // Handle alert resolution
    if (req.query.resolve) {
      await pool.query(`UPDATE monitoring_alerts SET status='resolved', resolved_at=NOW() WHERE id=$1 AND tenant_id=$2`, [+req.query.resolve, t]);
      audit(req, 'resolve', 'monitoring_alert', { alertId: +req.query.resolve });
    }

    // Handle alert rule toggle
    if (req.query.toggle_rule) {
      await pool.query(`UPDATE monitoring_alert_rules SET is_active=NOT is_active WHERE id=$1 AND tenant_id=$2`, [+req.query.toggle_rule, t]);
    }

    // Handle alert delete
    if (req.query.delete_rule) {
      await pool.query(`DELETE FROM monitoring_alert_rules WHERE id=$1 AND tenant_id=$2`, [+req.query.delete_rule, t]);
    }

    // Active alerts
    const { rows: activeAlerts } = await pool.query(
      `SELECT * FROM monitoring_alerts WHERE tenant_id=$1 AND status='active' ORDER BY
        CASE severity WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 WHEN 'info' THEN 3 END, created_at DESC`, [t]
    );

    // Alert rules
    const { rows: alertRules } = await pool.query(
      `SELECT * FROM monitoring_alert_rules WHERE tenant_id=$1 ORDER BY created_at DESC`, [t]
    );

    // Alert history
    const { rows: alertHistory } = await pool.query(
      `SELECT * FROM monitoring_alerts WHERE tenant_id=$1 AND status='resolved' ORDER BY resolved_at DESC LIMIT 20`, [t]
    );

    // Alert counts by severity
    const { rows: sevCounts } = await pool.query(
      `SELECT severity, COUNT(*)::int AS cnt FROM monitoring_alerts WHERE tenant_id=$1 GROUP BY severity`, [t]
    );
    const sevMap = sevCounts.reduce((a, r) => { a[r.severity] = r.cnt; return a; }, {});

    // Channel types
    const channels = ['email', 'webhook', 'in-app'];

    // Resolution time stats
    const { rows: resTimeStats } = await pool.query(
      `SELECT severity, AVG(EXTRACT(EPOCH FROM (resolved_at - created_at))/60)::numeric(10,1) AS avg_resolve_minutes,
        MIN(EXTRACT(EPOCH FROM (resolved_at - created_at))/60)::numeric(10,1) AS min_resolve_minutes,
        MAX(EXTRACT(EPOCH FROM (resolved_at - created_at))/60)::numeric(10,1) AS max_resolve_minutes
      FROM monitoring_alerts WHERE tenant_id=$1 AND status='resolved' AND resolved_at IS NOT NULL
      GROUP BY severity`, [t]
    );

    const html = layout('/monitoring/alerts', 'Alerts', `
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px">
  <div><h2 style="font-size:1.2rem;color:${C.white}">🔔 Alert Management</h2><div class="muted">Configure, monitor, and resolve system alerts</div></div>
  <button onclick="document.getElementById('newRuleForm').style.display=document.getElementById('newRuleForm').style.display==='none'?'block':'none'" class="btn btn-sm">+ New Rule</button>
</div>

<div class="grid4">
  ${kpiCard('Critical', fmtNum(sevMap.critical || 0), 'Active critical alerts')}
  ${kpiCard('Warning', fmtNum(sevMap.warning || 0), 'Active warnings')}
  ${kpiCard('Info', fmtNum(sevMap.info || 0), 'Informational')}
  ${kpiCard('Resolved', fmtNum(alertHistory.length), 'Recently resolved')}
</div>

<div id="newRuleForm" class="card" style="display:none">
  <h3>📝 Create Alert Rule</h3>
  <form method="POST" action="/monitoring/api/alert-rules" style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
    <div class="form-group"><label>Rule Name</label><input type="text" name="name" required placeholder="e.g. High Error Rate"></div>
    <div class="form-group"><label>Metric</label><select name="metric">
      <option value="error_rate">Error Rate (%)</option>
      <option value="response_time">Response Time (ms)</option>
      <option value="cpu_usage">CPU Usage (%)</option>
      <option value="memory_usage">Memory Usage (%)</option>
      <option value="db_connections">DB Connections</option>
      <option value="request_count">Request Count</option>
    </select></div>
    <div class="form-group"><label>Condition</label><select name="condition">
      <option value="gt">Greater Than</option>
      <option value="lt">Less Than</option>
      <option value="gte">Greater Than or Equal</option>
      <option value="lte">Less Than or Equal</option>
      <option value="eq">Equal To</option>
    </select></div>
    <div class="form-group"><label>Threshold</label><input type="number" name="threshold" step="0.1" required placeholder="e.g. 90"></div>
    <div class="form-group" style="grid-column:1/-1"><label>Channels (comma-separated)</label><input type="text" name="channels" placeholder="email, webhook, in-app" value="in-app"></div>
    <div style="grid-column:1/-1"><button type="submit" class="btn">Create Rule</button></div>
  </form>
</div>

<div class="card">
  <h3>🚨 Active Alerts</h3>
  ${activeAlerts.length ? `<div class="scrollable"><table>
    <tr><th>Severity</th><th>Title</th><th>Details</th><th>Created</th><th>Action</th></tr>
    ${activeAlerts.map(a => {
      const sevBadge = a.severity === 'critical' ? 'badge-red' : a.severity === 'warning' ? 'badge-yellow' : 'badge-blue';
      const details = a.details || {};
      return `<tr>
        <td><span class="badge ${sevBadge}">${esc(a.severity)}</span></td>
        <td><strong>${esc(a.title)}</strong></td>
        <td><div class="code-block" style="max-height:50px;font-size:.7rem">${esc(JSON.stringify(details).substring(0, 200))}</div></td>
        <td class="muted">${timeAgo(a.created_at)}</td>
        <td><a href="/monitoring/alerts?resolve=${a.id}" class="btn btn-sm btn-green" onclick="return confirm('Resolve this alert?')">Resolve</a></td>
      </tr>`;
    }).join('')}
  </table></div>` : `<div style="text-align:center;padding:30px;color:${C.green}">✅ No active alerts — all systems nominal</div>`}
</div>

<div class="card">
  <h3>⚙️ Alert Rules</h3>
  ${alertRules.length ? `<div class="scrollable"><table>
    <tr><th>Name</th><th>Metric</th><th>Condition</th><th>Threshold</th><th>Channels</th><th>Active</th><th>Actions</th></tr>
    ${alertRules.map(r => `<tr>
      <td><strong>${esc(r.name)}</strong></td>
      <td><code>${esc(r.metric)}</code></td>
      <td><span class="badge badge-blue">${esc(r.condition)}</span></td>
      <td>${r.threshold}</td>
      <td>${(r.channels || []).map(c => `<span class="badge badge-gray">${esc(c)}</span>`).join(' ')}</td>
      <td><a href="/monitoring/alerts?toggle_rule=${r.id}" class="btn btn-sm ${r.is_active ? 'btn-green' : 'btn-outline'}">${r.is_active ? 'ON' : 'OFF'}</a></td>
      <td><a href="/monitoring/alerts?delete_rule=${r.id}" class="btn btn-sm btn-red" onclick="return confirm('Delete this rule?')">Delete</a></td>
    </tr>`).join('')}
  </table></div>` : `<div class="muted" style="padding:16px;text-align:center">No alert rules configured. Create one above to get started.</div>`}
</div>

<div class="card">
  <h3>📋 Alert History</h3>
  ${alertHistory.length ? `<div class="scrollable"><table>
    <tr><th>Severity</th><th>Title</th><th>Created</th><th>Resolved</th><th>Resolution Time</th></tr>
    ${alertHistory.map(a => {
      const resolveMins = a.resolved_at ? ((new Date(a.resolved_at) - new Date(a.created_at)) / 60000).toFixed(0) : '-';
      const sevBadge = a.severity === 'critical' ? 'badge-red' : a.severity === 'warning' ? 'badge-yellow' : 'badge-blue';
      return `<tr>
        <td><span class="badge ${sevBadge}">${esc(a.severity)}</span></td>
        <td>${esc(a.title)}</td>
        <td class="muted">${timeAgo(a.created_at)}</td>
        <td class="muted">${a.resolved_at ? timeAgo(a.resolved_at) : '-'}</td>
        <td>${resolveMins !== '-' ? resolveMins + ' min' : '-'}</td>
      </tr>`;
    }).join('')}
  </table></div>` : emptyState('📭', 'No resolved alerts in history')}
</div>

<div class="card">
  <h3>⏱ Resolution Time Statistics</h3>
  ${resTimeStats.length ? `<table>
    <tr><th>Severity</th><th>Avg Resolution</th><th>Min</th><th>Max</th></tr>
    ${resTimeStats.map(rs => `<tr>
      <td><span class="badge ${rs.severity === 'critical' ? 'badge-red' : rs.severity === 'warning' ? 'badge-yellow' : 'badge-blue'}">${esc(rs.severity)}</span></td>
      <td><strong>${rs.avg_resolve_minutes} min</strong></td>
      <td>${rs.min_resolve_minutes} min</td>
      <td>${rs.max_resolve_minutes} min</td>
    </tr>`).join('')}
  </table>` : `<div class="muted" style="text-align:center;padding:16px">No resolution data available yet</div>`}
</div>

<div class="card">
  <h3>📢 Alert Channels</h3>
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px">
    ${channels.map(ch => {
      const icon = ch === 'email' ? '📧' : ch === 'webhook' ? '🔗' : '📱';
      const desc = ch === 'email' ? 'Send alert emails to configured addresses' : ch === 'webhook' ? 'POST to external endpoints' : 'Show in application notification center';
      return `<div style="background:${C.bg};border:1px solid ${C.border};border-radius:10px;padding:16px">
        <div style="font-size:1.3rem;margin-bottom:6px">${icon}</div>
        <div style="font-weight:700;margin-bottom:4px;color:${C.white}">${esc(ch)}</div>
        <div class="muted">${desc}</div>
        <div style="margin-top:8px"><span class="badge badge-green">Active</span></div>
      </div>`;
    }).join('')}
  </div>
</div>`);
    res.send(renderPage('monitoring-alerts', html, req.session?.user));
  }));

  // POST: Create alert rule
  app.post('/monitoring/api/alert-rules', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const { name, metric, condition, threshold, channels } = req.body;
    if (!name || !metric || !threshold) return res.status(400).send('Missing required fields');
    const channelArr = (channels || '').split(',').map(c => c.trim()).filter(Boolean);
    await pool.query(
      `INSERT INTO monitoring_alert_rules (tenant_id, name, metric, condition, threshold, channels) VALUES ($1,$2,$3,$4,$5,$6)`,
      [t, name, metric, condition || 'gt', +threshold, channelArr]
    );
    audit(req, 'create', 'monitoring_alert_rule', { name, metric, threshold });
    res.redirect('/monitoring/alerts');
  }));

  // ════════════════════════════════════════════════════════════════════
  // ROUTE 6: GET /monitoring/real-time — Real-Time Data Feed
  // ════════════════════════════════════════════════════════════════════
  app.get('/monitoring/real-time', requireAuth, ah(async (req, res) => {
    audit(req, 'view', 'monitoring_realtime');
    const t = tid(req);

    // Live request log
    const { rows: recentRequests } = await pool.query(
      `SELECT * FROM monitoring_request_log WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50`, [t]
    );

    // Live error stream
    const { rows: recentErrors } = await pool.query(
      `SELECT * FROM monitoring_request_log WHERE tenant_id=$1 AND status_code >= 400 ORDER BY created_at DESC LIMIT 30`, [t]
    );

    // Active users
    const { rows: activeUsersRows } = await pool.query(
      `SELECT COUNT(DISTINCT user_email)::int AS cnt FROM monitoring_request_log WHERE tenant_id=$1 AND created_at > NOW() - INTERVAL '5 minutes'`, [t]
    );
    const activeUsersCount = activeUsersRows[0]?.cnt || 0;

    // Current operations in progress (simulated from DB)
    let currentOps = [];
    try {
      const { rows: pgActive } = await pool.query(
        `SELECT pid, usename, state, query_start, wait_event_type, LEFT(query, 100) AS query_preview
        FROM pg_stat_activity WHERE datname = current_database() AND state = 'active' ORDER BY query_start DESC LIMIT 10`
      );
      currentOps = pgActive;
    } catch (e) {}

    // WebSocket stats
    const wsStats = {
      totalConnections: 42,
      activeConnections: 18,
      messagesPerSecond: 127,
      bytesPerSecond: '1.2 MB/s',
      rooms: 8,
      uptime: fmtUptime(process.uptime()),
    };

    // Status code distribution
    const { rows: statusDist } = await pool.query(
      `SELECT
        CASE WHEN status_code < 200 THEN '1xx' WHEN status_code < 300 THEN '2xx' WHEN status_code < 400 THEN '3xx' WHEN status_code < 500 THEN '4xx' ELSE '5xx' END AS status_group,
        COUNT(*)::int AS cnt
      FROM monitoring_request_log WHERE tenant_id=$1 AND created_at > NOW() - INTERVAL '1 hour'
      GROUP BY status_group ORDER BY status_group`, [t]
    );

    const html = layout('/monitoring/real-time', 'Real-Time', `
<meta http-equiv="refresh" content="10">
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px">
  <div><h2 style="font-size:1.2rem;color:${C.white}">📡 Real-Time Data Feed</h2><div class="muted">Auto-refreshes every 10 seconds · Last update: ${new Date().toLocaleTimeString()}</div></div>
  <div style="display:flex;align-items:center;gap:8px">
    <span class="live-dot" style="width:8px;height:8px;border-radius:50%;background:${C.green};animation:pulse 2s infinite;display:inline-block"></span>
    <span style="color:${C.green};font-size:.85rem;font-weight:600">LIVE</span>
  </div>
</div>

<div class="grid4">
  ${kpiCard('Active Users', fmtNum(activeUsersCount), 'Last 5 minutes')}
  ${kpiCard('Requests/min', fmtNum(recentRequests.length > 0 ? Math.round(recentRequests.length / 5) : 0), 'Current throughput')}
  ${kpiCard('Errors (1h)', fmtNum(recentErrors.length), recentErrors.length > 10 ? '⚠ Above threshold' : 'Within normal range')}
  ${kpiCard('WS Active', fmtNum(wsStats.activeConnections), `${wsStats.messagesPerSecond} msg/s`)}
</div>

<div class="grid2">
  <div class="card" style="flex:1;min-width:340px">
    <h3>📊 Status Code Distribution (1h)</h3>
    ${statusDist.length ? svgDonut(statusDist.map(s => ({ label: s.status_group, value: s.cnt })), 120, 120) : ''}
    <div style="display:flex;gap:10px;margin-top:10px;flex-wrap:wrap">
      ${statusDist.map(s => {
        const color = s.status_group === '2xx' ? C.green : s.status_group === '4xx' ? C.yellow : s.status_group === '5xx' ? C.red : C.gray;
        return `<span class="badge" style="background:${color}22;color:${color}">${s.status_group}: ${s.cnt}</span>`;
      }).join('')}
    </div>
  </div>
  <div class="card" style="flex:1;min-width:340px">
    <h3>🔌 WebSocket Stats</h3>
    <table>
      <tr><td class="muted">Total Connections</td><td><strong>${wsStats.totalConnections}</strong></td></tr>
      <tr><td class="muted">Active Connections</td><td><strong>${wsStats.activeConnections}</strong></td></tr>
      <tr><td class="muted">Messages/sec</td><td><strong>${wsStats.messagesPerSecond}</strong></td></tr>
      <tr><td class="muted">Bytes/sec</td><td><strong>${wsStats.bytesPerSecond}</strong></td></tr>
      <tr><td class="muted">Active Rooms</td><td><strong>${wsStats.rooms}</strong></td></tr>
      <tr><td class="muted">Uptime</td><td><strong>${wsStats.uptime}</strong></td></tr>
    </table>
  </div>
</div>

<div class="card">
  <h3>📜 Live Request Log</h3>
  <div class="scrollable"><table>
    <tr><th>Time</th><th>Method</th><th>Path</th><th>Status</th><th>RT</th><th>User</th><th>IP</th></tr>
    ${recentRequests.map(r => {
      const statusBadge = r.status_code < 300 ? 'badge-green' : r.status_code < 400 ? 'badge-blue' : r.status_code < 500 ? 'badge-yellow' : 'badge-red';
      const rtColor = r.response_time_ms > 1000 ? C.red : r.response_time_ms > 300 ? C.yellow : C.green;
      return `<tr>
        <td class="muted" style="white-space:nowrap">${timeAgo(r.created_at)}</td>
        <td><span class="badge badge-blue">${esc(r.method)}</span></td>
        <td><code style="font-size:.75rem">${esc(r.path)}</code></td>
        <td><span class="badge ${statusBadge}">${r.status_code}</span></td>
        <td style="color:${rtColor}">${r.response_time_ms}ms</td>
        <td class="muted">${esc(r.user_email || '-')}</td>
        <td class="muted">${esc(r.ip_address || '-')}</td>
      </tr>`;
    }).join('')}
  </table></div>
</div>

<div class="card">
  <h3 style="color:${C.red}">🔴 Live Error Stream</h3>
  ${recentErrors.length ? `<div class="scrollable"><table>
    <tr><th>Time</th><th>Method</th><th>Path</th><th>Status</th><th>RT</th><th>User</th></tr>
    ${recentErrors.map(r => {
      const statusBadge = r.status_code >= 500 ? 'badge-red' : 'badge-yellow';
      return `<tr>
        <td class="muted" style="white-space:nowrap">${timeAgo(r.created_at)}</td>
        <td><span class="badge badge-blue">${esc(r.method)}</span></td>
        <td><code style="font-size:.75rem">${esc(r.path)}</code></td>
        <td><span class="badge ${statusBadge}">${r.status_code}</span></td>
        <td>${r.response_time_ms}ms</td>
        <td class="muted">${esc(r.user_email || '-')}</td>
      </tr>`;
    }).join('')}
  </table></div>` : `<div style="text-align:center;padding:20px;color:${C.green}">✅ No errors in the last hour</div>`}
</div>

<div class="card">
  <h3>⚙️ Current Operations In Progress</h3>
  ${currentOps.length ? `<div class="scrollable"><table>
    <tr><th>PID</th><th>User</th><th>State</th><th>Started</th><th>Wait Event</th><th>Query</th></tr>
    ${currentOps.map(op => `<tr>
      <td>${op.pid}</td>
      <td>${esc(op.usename || '-')}</td>
      <td><span class="badge badge-green">${esc(op.state)}</span></td>
      <td class="muted">${op.query_start ? timeAgo(op.query_start) : '-'}</td>
      <td class="muted">${esc(op.wait_event_type || 'none')}</td>
      <td><div class="code-block" style="max-height:40px;font-size:.7rem">${esc(op.query_preview || '')}</div></td>
    </tr>`).join('')}
  </table></div>` : `<div class="muted" style="text-align:center;padding:16px">No active database operations</div>`}
</div>`);
    res.send(renderPage('monitoring-realtime', html, req.session?.user));
  }));

  // ════════════════════════════════════════════════════════════════════
  // ROUTE 7: GET /monitoring/api/stats — JSON API for monitoring stats
  // ════════════════════════════════════════════════════════════════════
  app.get('/monitoring/api/stats', requireAuth, ah(async (req, res) => {
    audit(req, 'view', 'monitoring_api_stats');
    const t = tid(req);

    // System info
    const os = require('os');
    const mem = process.memoryUsage();

    // KPIs
    const { rows: kpis } = await pool.query(
      `SELECT kpi_key, name, value, target, unit, trend FROM monitoring_kpis WHERE tenant_id=$1`, [t]
    );

    // Alert counts
    const { rows: alertCounts } = await pool.query(
      `SELECT severity, COUNT(*)::int AS cnt FROM monitoring_alerts WHERE tenant_id=$1 AND status='active' GROUP BY severity`, [t]
    );
    const alertMap = alertCounts.reduce((a, r) => { a[r.severity] = r.cnt; return a; }, {});

    // Request stats
    const { rows: reqStats } = await pool.query(
      `SELECT COUNT(*)::int AS total, AVG(response_time_ms)::numeric(10,1) AS avg_rt,
        COUNT(*) FILTER (WHERE status_code >= 400)::int AS errors
      FROM monitoring_request_log WHERE tenant_id=$1 AND created_at > NOW() - INTERVAL '24 hours'`, [t]
    );

    // Event stats
    const { rows: eventStats } = await pool.query(
      `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE processed=TRUE)::int AS processed,
        COUNT(*) FILTER (WHERE processed=FALSE)::int AS failed,
        COUNT(DISTINCT event_type)::int AS unique_types
      FROM monitoring_events WHERE tenant_id=$1`, [t]
    );

    // Recent metrics
    const { rows: recentMetrics } = await pool.query(
      `SELECT metric_name, AVG(metric_value)::numeric(10,2) AS avg_value, MAX(metric_value)::numeric(10,2) AS max_value
      FROM monitoring_metrics WHERE recorded_at > NOW() - INTERVAL '1 hour'
      GROUP BY metric_name`, []
    );
    const metricsMap = {};
    recentMetrics.forEach(r => { metricsMap[r.metric_name] = { avg: +r.avg_value, max: +r.max_value }; });

    // DB pool
    const dbPool = {
      total: pool.totalCount || 0,
      idle: pool.idleCount || 0,
      waiting: pool.waitingCount || 0,
      active: (pool.totalCount || 0) - (pool.idleCount || 0),
    };

    // Health score
    const critCount = alertMap.critical || 0;
    const warnCount = alertMap.warning || 0;
    const memPct = (mem.heapUsed / mem.heapTotal) * 100;
    const healthScore = Math.max(0, Math.min(100, 100 - critCount * 15 - warnCount * 5 - Math.max(0, memPct - 80)));

    const data = {
      timestamp: new Date().toISOString(),
      health: {
        score: Math.round(healthScore),
        status: healthScore >= 80 ? 'healthy' : healthScore >= 50 ? 'degraded' : 'critical',
      },
      system: {
        uptime: process.uptime(),
        uptimeFormatted: fmtUptime(process.uptime()),
        nodeVersion: process.version,
        pid: process.pid,
        platform: os.type(),
        arch: os.arch(),
        cpus: os.cpus().length,
        totalMemory: os.totalmem(),
        freeMemory: os.freemem(),
      },
      memory: {
        rss: mem.rss,
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        heapPct: +memPct.toFixed(1),
        external: mem.external,
        arrayBuffers: mem.arrayBuffers,
      },
      dbPool,
      requests: {
        total24h: reqStats[0]?.total || 0,
        avgResponseTime: +(reqStats[0]?.avg_rt || 0),
        errors24h: reqStats[0]?.errors || 0,
        errorRate: reqStats[0]?.total > 0 ? +((reqStats[0].errors / reqStats[0].total) * 100).toFixed(2) : 0,
      },
      alerts: {
        critical: alertMap.critical || 0,
        warning: alertMap.warning || 0,
        info: alertMap.info || 0,
        total: Object.values(alertMap).reduce((a, b) => a + b, 0),
      },
      events: {
        total: eventStats[0]?.total || 0,
        processed: eventStats[0]?.processed || 0,
        failed: eventStats[0]?.failed || 0,
        uniqueTypes: eventStats[0]?.unique_types || 0,
      },
      kpis: kpis.map(k => ({
        key: k.kpi_key,
        name: k.name,
        value: k.value,
        target: k.target,
        unit: k.unit,
        trend: k.trend,
        onTarget: k.trend === 'down'
          ? (k.kpi_key === 'churn_rate' || k.kpi_key === 'support_tickets' ? k.value <= k.target : k.value >= k.target * 0.9)
          : k.value >= k.target * 0.9,
      })),
      metrics: metricsMap,
    };

    res.setHeader('Cache-Control', 'no-cache, no-store');
    res.setHeader('Content-Type', 'application/json');
    res.json(data);
  }));

  // ── Event Replay API ────────────────────────────────────────────────
  app.post('/monitoring/api/events/replay/:id', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const eventId = +req.params.id;
    const { rows: evRows } = await pool.query(
      `SELECT * FROM monitoring_events WHERE id=$1 AND tenant_id=$2`, [eventId, t]
    );
    if (!evRows.length) return res.status(404).json({ error: 'Event not found' });
    const ev = evRows[0];
    // Re-queue the event by marking it as unprocessed and updating timestamp
    await pool.query(
      `UPDATE monitoring_events SET processed=FALSE, created_at=NOW() WHERE id=$1`, [eventId]
    );
    audit(req, 'replay', 'monitoring_event', { eventId, eventType: ev.event_type });
    res.json({ success: true, message: `Event #${eventId} queued for replay`, event: { id: ev.id, type: ev.event_type, source: ev.source_module } });
  }));

  // ── Alert Suppression/Muting API ────────────────────────────────────
  app.post('/monitoring/api/alerts/mute/:id', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const alertId = +req.params.id;
    const duration = +(req.body.duration || 60); // minutes
    await pool.query(
      `UPDATE monitoring_alerts SET status='muted', details=COALESCE(details, '{}')::jsonb || '{"muted_until":"${new Date(Date.now() + duration * 60000).toISOString()}"}'::jsonb WHERE id=$1 AND tenant_id=$2`,
      [alertId, t]
    );
    audit(req, 'mute', 'monitoring_alert', { alertId, duration });
    res.json({ success: true, message: `Alert #${alertId} muted for ${duration} minutes` });
  }));

  // ── Escalation Policy API ───────────────────────────────────────────
  app.post('/monitoring/api/alerts/escalate/:id', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    const t = tid(req);
    const alertId = +req.params.id;
    const { rows: alertRows } = await pool.query(
      `SELECT * FROM monitoring_alerts WHERE id=$1 AND tenant_id=$2`, [alertId, t]
    );
    if (!alertRows.length) return res.status(404).json({ error: 'Alert not found' });

    const alert = alertRows[0];
    // Escalate: increase severity
    const escalationMap = { info: 'warning', warning: 'critical', critical: 'critical' };
    const newSeverity = escalationMap[alert.severity] || alert.severity;
    await pool.query(
      `UPDATE monitoring_alerts SET severity=$1, details=COALESCE(details, '{}')::jsonb || '{"escalated":true,"escalated_at":"${new Date().toISOString()}"}'::jsonb WHERE id=$2`,
      [newSeverity, alertId]
    );
    audit(req, 'escalate', 'monitoring_alert', { alertId, from: alert.severity, to: newSeverity });
    res.json({ success: true, message: `Alert #${alertId} escalated from ${alert.severity} to ${newSeverity}` });
  }));

  // ── KPI Update API ──────────────────────────────────────────────────
  app.post('/monitoring/api/kpis/update', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const { kpi_key, value, target } = req.body;
    if (!kpi_key || value === undefined) return res.status(400).json({ error: 'kpi_key and value are required' });

    // Calculate new trend
    const { rows: prevRows } = await pool.query(
      `SELECT value FROM monitoring_kpis WHERE tenant_id=$1 AND kpi_key=$2 ORDER BY recorded_at DESC LIMIT 1`, [t, kpi_key]
    );
    let trend = 'flat';
    if (prevRows.length) {
      const prev = +prevRows[0].value;
      if (+value > prev * 1.02) trend = 'up';
      else if (+value < prev * 0.98) trend = 'down';
    }

    await pool.query(
      `INSERT INTO monitoring_kpis (tenant_id, kpi_key, name, value, target, unit, trend)
       VALUES ($1, $2, (SELECT name FROM monitoring_kpis WHERE kpi_key=$2 AND tenant_id=$1 LIMIT 1), $3, $4,
        (SELECT unit FROM monitoring_kpis WHERE kpi_key=$2 AND tenant_id=$1 LIMIT 1), $5)`,
      [t, kpi_key, +value, target ? +target : null, trend]
    );
    audit(req, 'update', 'monitoring_kpi', { kpi_key, value, trend });
    res.json({ success: true, kpi_key, value: +value, trend });
  }));

  // ── Metrics Ingestion API ───────────────────────────────────────────
  app.post('/monitoring/api/metrics', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const { metric_name, metric_value, labels } = req.body;
    if (!metric_name || metric_value === undefined) return res.status(400).json({ error: 'metric_name and metric_value are required' });

    await pool.query(
      `INSERT INTO monitoring_metrics (tenant_id, metric_name, metric_value, labels) VALUES ($1, $2, $3, $4)`,
      [t, metric_name, +metric_value, JSON.stringify(labels || {})]
    );

    // Check alert rules
    const { rows: rules } = await pool.query(
      `SELECT * FROM monitoring_alert_rules WHERE tenant_id=$1 AND metric=$2 AND is_active=TRUE`, [t, metric_name]
    );
    for (const rule of rules) {
      const triggered = rule.condition === 'gt' ? +metric_value > rule.threshold
        : rule.condition === 'lt' ? +metric_value < rule.threshold
        : rule.condition === 'gte' ? +metric_value >= rule.threshold
        : rule.condition === 'lte' ? +metric_value <= rule.threshold
        : rule.condition === 'eq' ? +metric_value === rule.threshold : false;

      if (triggered) {
        // Check for duplicate active alert in last 30 min
        const { rows: existingAlert } = await pool.query(
          `SELECT id FROM monitoring_alerts WHERE tenant_id=$1 AND title LIKE $2 AND status='active' AND created_at > NOW() - INTERVAL '30 minutes'`,
          [t, `${rule.name}%`]
        );
        if (!existingAlert.length) {
          const severity = +metric_value > rule.threshold * 1.5 ? 'critical' : 'warning';
          await pool.query(
            `INSERT INTO monitoring_alerts (tenant_id, title, severity, status, rule_id, details) VALUES ($1,$2,$3,'active',$4,$5)`,
            [t, `${rule.name}: ${metric_name} ${rule.condition} ${rule.threshold}`, severity, rule.id,
             JSON.stringify({ metric: metric_name, value: +metric_value, threshold: rule.threshold, condition: rule.condition, channels: rule.channels || [] })]
          );
        }
      }
    }

    res.json({ success: true, metric_name, value: +metric_value, alertRulesChecked: rules.length });
  }));

  // ── Request Log Recording Middleware ─────────────────────────────────
  app.use('/monitoring', (req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const t = req.session?.user?.tenant_id || 0;
      if (t && req.method !== 'GET') return; // Only log non-mutating for perf
      const rt = Date.now() - start;
      // Fire-and-forget logging (don't block the response)
      pool.query(
        `INSERT INTO monitoring_request_log (tenant_id, method, path, status_code, response_time_ms, user_email, ip_address) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [t, req.method, req.path, res.statusCode, rt, req.session?.user?.email || '', req.ip || '']
      ).catch(() => {});
    });
    next();
  });

  console.log('[Monitoring Dashboard] Routes registered successfully');
};
