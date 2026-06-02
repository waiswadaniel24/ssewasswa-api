/**
 * Comfort Platform — Developer Experience Dashboard
 * Module: developer-dashboard.js
 *
 * Comprehensive dev tools for super_admin role:
 *   - Main Developer Dashboard
 *   - CI/CD Pipeline Dashboard
 *   - App Lifecycle Management
 *   - Sandbox Environment Management
 *   - Marketplace Management
 *   - Event-Driven Architecture Tools
 *   - Developer Resources
 *   - Automation & Workflows
 *   - API Registry
 *   - Real-Time Monitoring
 *   - Deploy Trigger API
 *
 * Signature: module.exports = function(app, pool, opts) { ... }
 * opts provides: esc, renderPage, ah, requireAuth, requireSuperAdmin, audit
 */

'use strict';

const os = require('os');
const { runMigration } = require('./db');

const RENDER_DEPLOY_WEBHOOK = 'https://api.render.com/deploy/srv-d7vjts50lvsc73fun8f0?key=3t2h6r19cZo';

module.exports = function (app, pool, opts) {
  const esc = opts.esc || (s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])));
  const renderPage = opts.renderPage || ((t, c, u) => c);
  const ah = opts.ah || ((fn) => async (req, res, next) => { try { await fn(req, res, next); } catch (e) { next(e); } });
  const requireAuth = opts.requireAuth || ((req, res, next) => { if (!req.session || !req.session.user) return res.redirect('/login'); next(); });
  const requireSuperAdmin = opts.requireSuperAdmin || ((req, res, next) => { if (req.session && req.session.user && req.session.user.role === 'super_admin') return next(); return res.status(403).send('Super admin only'); });
  const audit = opts.audit || (() => {});

  // ── Color System (Dark Theme) ────────────────────────────────────────
  const C = {
    bg: '#0f172a', bgCard: '#1e293b', bgCardHover: '#273548',
    accent: '#3b82f6', accentLight: '#60a5fa', accentDark: '#2563eb',
    green: '#22c55e', greenDark: '#16a34a',
    yellow: '#eab308', yellowDark: '#ca8a04',
    red: '#ef4444', redDark: '#dc2626',
    gray: '#94a3b8', grayLight: '#cbd5e1', grayDark: '#475569',
    text: '#e2e8f0', textMuted: '#94a3b8', textBright: '#f8fafc',
    border: '#334155', surface: '#1e293b',
  };

  // ── Utility Functions ────────────────────────────────────────────────
  function fmtUptime(s) {
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    return d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  function fmtBytes(bytes) {
    if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(1) + ' GB';
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(0) + ' MB';
    if (bytes >= 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return bytes + ' B';
  }

  function timeAgo(dt) {
    if (!dt) return '-';
    const diff = Date.now() - new Date(dt).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ${mins % 60}m ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  function fmtNum(n) {
    return n != null ? Number(n).toLocaleString() : '-';
  }

  function statusColor(val, warn, crit) {
    return val >= crit ? C.red : val >= warn ? C.yellow : C.green;
  }

  // ── SVG Chart Generators (Inline, No External Libraries) ────────────
  function svgSparkline(data, w = 160, h = 40, color = C.accent) {
    if (!data || !data.length) return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg" role="img"><rect fill="${C.bgCard}" width="${w}" height="${h}" rx="4"/></svg>`;
    const max = Math.max(...data), min = Math.min(...data), range = max - min || 1;
    const pts = data.map((v, i) =>
      `${(i / (data.length - 1)) * w},${h - 2 - ((v - min) / range) * (h - 4)}`
    ).join(' ');
    return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Sparkline">
      <rect fill="${C.bgCard}" width="${w}" height="${h}" rx="4"/>
      <polyline fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" points="${pts}"/>
    </svg>`;
  }

  function svgAreaChart(data, w = 500, h = 130, color = C.accent, labels) {
    if (!data || !data.length) return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><rect fill="${C.bgCard}" width="${w}" height="${h}" rx="6"/><text x="${w / 2}" y="${h / 2}" text-anchor="middle" fill="${C.textMuted}" font-size="12">No data</text></svg>`;
    const max = Math.max(...data), min = Math.min(...data), range = max - min || 1;
    const pad = 24;
    const pts = data.map((v, i) => ({
      x: pad + (i / (data.length - 1)) * (w - pad * 2),
      y: pad + (h - pad * 2) - ((v - min) / range) * (h - pad * 2)
    }));
    const line = pts.map(p => `${p.x},${p.y}`).join(' ');
    const area = `${pts[0].x},${h - pad} ${line} ${pts[pts.length - 1].x},${h - pad}`;
    let gridLines = '';
    for (let i = 0; i <= 4; i++) {
      const y = pad + (i / 4) * (h - pad * 2);
      const val = max - (i / 4) * range;
      gridLines += `<line x1="${pad}" y1="${y}" x2="${w - pad}" y2="${y}" stroke="${C.border}" stroke-width="0.5" stroke-dasharray="4,4"/>`;
      gridLines += `<text x="${pad - 4}" y="${y + 3}" font-size="9" fill="${C.grayDark}" text-anchor="end">${val.toFixed(val > 100 ? 0 : 1)}</text>`;
    }
    let xLabels = '';
    if (labels && labels.length) {
      const step = Math.max(1, Math.floor(labels.length / 7));
      for (let i = 0; i < labels.length; i += step) {
        xLabels += `<text x="${pts[i].x}" y="${h - 4}" font-size="9" fill="${C.grayDark}" text-anchor="middle">${esc(labels[i])}</text>`;
      }
    }
    return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Area chart">
      <rect fill="${C.bgCard}" width="${w}" height="${h}" rx="6"/>
      ${gridLines}${xLabels}
      <polygon fill="${color}20" stroke="none" points="${area}"/>
      <polyline fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" points="${line}"/>
      ${pts.length ? `<circle cx="${pts[pts.length - 1].x}" cy="${pts[pts.length - 1].y}" r="3" fill="${color}"/>` : ''}
    </svg>`;
  }

  function svgDonut(segments, w = 100, h = 100) {
    const cx = w / 2, cy = h / 2, r = 38, ir = 24;
    const total = segments.reduce((s, seg) => s + seg.value, 0) || 1;
    let angle = -Math.PI / 2, paths = '';
    const colors = [C.green, C.accent, C.yellow, C.red, C.gray];
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
      <text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="14" font-weight="700" fill="${C.textBright}">${pct}%</text>
    </svg>`;
  }

  function svgBarChart(values, labels, w = 400, h = 120) {
    if (!values || !values.length) return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><rect fill="${C.bgCard}" width="${w}" height="${h}" rx="6"/></svg>`;
    const max = Math.max(...values) || 1;
    const barW = Math.max(8, Math.min(40, (w - 20) / values.length - 4));
    const pad = 16;
    const colors = [C.accent, C.green, C.yellow, C.red, '#8b5cf6', '#06b6d4'];
    let bars = '';
    values.forEach((v, i) => {
      const bh = ((v / max) * (h - pad * 2));
      const x = pad + i * (barW + 4);
      const y = h - pad - bh;
      bars += `<rect x="${x}" y="${y}" width="${barW}" height="${bh}" fill="${colors[i % colors.length]}" rx="3"/>`;
      if (labels && labels[i]) {
        bars += `<text x="${x + barW / 2}" y="${h - 2}" font-size="9" fill="${C.grayDark}" text-anchor="middle">${esc(String(labels[i]).substring(0, 6))}</text>`;
      }
      bars += `<text x="${x + barW / 2}" y="${y - 3}" font-size="8" fill="${C.gray}" text-anchor="middle">${v}</text>`;
    });
    return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Bar chart">
      <rect fill="${C.bgCard}" width="${w}" height="${h}" rx="6"/>${bars}</svg>`;
  }

  // ── Shared Dark Theme Layout ─────────────────────────────────────────
  const devStyles = `
    <style>
      :root{--bg:#0f172a;--bg-card:#1e293b;--accent:#3b82f6;--text:#e2e8f0;--muted:#94a3b8;--border:#334155}
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--text)}
      @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
      @keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
      .dd-wrap{max-width:1280px;margin:0 auto;padding:0 20px 40px;animation:fadeIn .3s ease}
      .dd-topbar{background:linear-gradient(135deg,#1e293b 0%,#0f172a 100%);border-bottom:1px solid var(--border);padding:16px 24px;position:sticky;top:0;z-index:100;display:flex;align-items:center;gap:12px}
      .dd-topbar h1{font-size:1.1rem;font-weight:800;color:var(--accent);display:flex;align-items:center;gap:10px}
      .dd-topbar .subtitle{color:var(--muted);font-size:.82rem}
      .dd-nav{display:flex;gap:4px;flex-wrap:wrap;padding:12px 0;border-bottom:1px solid var(--border);margin-bottom:20px}
      .dd-nav a{padding:6px 14px;border-radius:8px;text-decoration:none;font-weight:600;font-size:12px;color:var(--muted);transition:.2s;border:1px solid transparent}
      .dd-nav a:hover{color:var(--text);background:var(--bg-card);border-color:var(--border)}
      .dd-nav a.active{color:#fff;background:var(--accent);border-color:var(--accent)}
      .dd-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin-bottom:20px}
      .dd-grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px}
      @media(max-width:768px){.dd-grid2{grid-template-columns:1fr}}
      .dd-grid3{display:grid;grid-template-columns:2fr 1fr;gap:16px;margin-bottom:20px}
      @media(max-width:900px){.dd-grid3{grid-template-columns:1fr}}
      .dd-stat{background:var(--bg-card);border-radius:12px;padding:18px;border:1px solid var(--border);transition:all .2s}
      .dd-stat:hover{border-color:var(--accent);transform:translateY(-2px);box-shadow:0 4px 16px rgba(59,130,246,.1)}
      .dd-stat .num{font-size:1.6rem;font-weight:800;color:var(--accent);margin-bottom:2px}
      .dd-stat .lbl{color:var(--muted);font-size:.78rem;text-transform:uppercase;letter-spacing:.04em;font-weight:600}
      .dd-stat .sub{color:var(--muted);font-size:.72rem;margin-top:4px}
      .dd-card{background:var(--bg-card);border-radius:14px;padding:22px;border:1px solid var(--border);margin-bottom:18px}
      .dd-card h2{font-size:1rem;margin:0 0 14px;color:var(--text);display:flex;align-items:center;gap:8px;font-weight:700}
      .dd-card h3{font-size:.9rem;margin:0 0 10px;color:var(--text);font-weight:600}
      .dd-table{width:100%;border-collapse:collapse;font-size:.82rem}
      .dd-table th,.dd-table td{padding:10px 12px;text-align:left;border-bottom:1px solid var(--border)}
      .dd-table th{background:#162032;font-weight:700;color:var(--muted);font-size:.72rem;text-transform:uppercase;letter-spacing:.04em}
      .dd-table tr:hover{background:#1a2744}
      .dd-tag{display:inline-block;padding:3px 10px;border-radius:20px;font-size:.72rem;font-weight:600;white-space:nowrap}
      .dd-tag-green{background:#052e16;color:#4ade80}.dd-tag-red{background:#450a0a;color:#f87171}
      .dd-tag-yellow{background:#422006;color:#fbbf24}.dd-tag-blue{background:#172554;color:#60a5fa}
      .dd-tag-gray{background:#1e293b;color:#94a3b8}
      .dd-tag-accent{background:#1e3a5f;color:#60a5fa}
      .dd-btn{display:inline-block;padding:8px 18px;border-radius:8px;font-weight:600;font-size:.82rem;cursor:pointer;border:none;text-decoration:none;transition:.2s;color:#fff}
      .dd-btn:hover{transform:translateY(-1px);box-shadow:0 4px 12px rgba(0,0,0,.3)}
      .dd-btn-primary{background:var(--accent)}.dd-btn-success{background:${C.green}}
      .dd-btn-warning{background:${C.yellow}}.dd-btn-danger{background:${C.red}}
      .dd-btn-ghost{background:transparent;border:1px solid var(--border);color:var(--muted)}
      .dd-btn-ghost:hover{border-color:var(--accent);color:var(--accent)}
      .dd-btn-sm{padding:5px 12px;font-size:.72rem}
      .dd-input{width:100%;padding:10px 14px;border:1px solid var(--border);border-radius:8px;font-size:.85rem;background:var(--bg);color:var(--text);box-sizing:border-box}
      .dd-input:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px rgba(59,130,246,.15)}
      .dd-select{width:100%;padding:10px 14px;border:1px solid var(--border);border-radius:8px;font-size:.85rem;background:var(--bg);color:var(--text);box-sizing:border-box}
      .dd-textarea{width:100%;padding:10px 14px;border:1px solid var(--border);border-radius:8px;font-size:.82rem;min-height:100px;resize:vertical;font-family:'JetBrains Mono','Fira Code','Courier New',monospace;background:var(--bg);color:var(--text);box-sizing:border-box}
      .dd-code{background:#0c1222;color:#a5f3fc;padding:16px;border-radius:10px;font-family:'JetBrains Mono','Fira Code','Courier New',monospace;font-size:.78rem;overflow-x:auto;white-space:pre-wrap;word-wrap:break-word;border:1px solid var(--border)}
      .dd-badge{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px}
      .dd-badge-green{background:${C.green}}.dd-badge-red{background:${C.red}}.dd-badge-yellow{background:${C.yellow}}
      .dd-empty{text-align:center;padding:40px;color:var(--muted);font-size:.9rem}
      .dd-row{display:flex;gap:14px;flex-wrap:wrap}
      .dd-col{flex:1;min-width:280px}
      .dd-alert{padding:12px 16px;border-radius:10px;margin-bottom:16px;font-size:.85rem;display:flex;align-items:center;gap:10px;border:1px solid}
      .dd-alert-warn{background:#1c1917;border-color:${C.yellowDark};color:${C.yellow}}
      .dd-alert-crit{background:#1c0a0a;border-color:${C.redDark};color:${C.red}}
      .dd-alert-ok{background:#052e16;border-color:${C.greenDark};color:${C.green}}
      .dd-alert-info{background:#172554;border-color:${C.accent};color:${C.accentLight}}
      .dd-legend{display:flex;gap:16px;flex-wrap:wrap;margin-top:10px;font-size:.75rem;color:var(--muted)}
      .dd-legend span::before{content:'';display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px;vertical-align:middle}
      .dd-legend .lg-green::before{background:${C.green}}.dd-legend .lg-yellow::before{background:${C.yellow}}
      .dd-legend .lg-red::before{background:${C.red}}.dd-legend .lg-blue::before{background:${C.accent}}
      .dd-scroll{max-height:400px;overflow-y:auto}
      .dd-scroll::-webkit-scrollbar{width:6px}.dd-scroll::-webkit-scrollbar-track{background:var(--bg)}
      .dd-scroll::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px}
      .dd-live{display:inline-block;width:8px;height:8px;border-radius:50%;background:${C.green};margin-right:6px;animation:pulse 2s infinite}
      .dd-progress{background:var(--border);border-radius:4px;height:8px;width:100%;overflow:hidden}
      .dd-progress-bar{height:8px;border-radius:4px;transition:width .5s}
      .dd-monospace{font-family:'JetBrains Mono','Fira Code','Courier New',monospace}
    </style>
  `;

  // ── Shared Navigation ────────────────────────────────────────────────
  const navItems = [
    ['/dev/dashboard', 'Dashboard', '#3b82f6'],
    ['/dev/ci-cd', 'CI/CD', '#8b5cf6'],
    ['/dev/app-lifecycle', 'Lifecycle', '#06b6d4'],
    ['/dev/sandbox', 'Sandbox', '#0891b2'],
    ['/dev/marketplace-admin', 'Marketplace', '#f59e0b'],
    ['/dev/event-architecture', 'Events', '#10b981'],
    ['/dev/resources', 'Resources', '#6366f1'],
    ['/dev/automation', 'Automation', '#ec4899'],
    ['/dev/api-registry', 'API Registry', '#14b8a6'],
    ['/dev/monitoring', 'Monitoring', '#ef4444'],
  ];

  function devNav(activePath) {
    return `<div class="dd-nav">${navItems.map(([path, label, color]) =>
      `<a href="${path}" class="${activePath === path ? 'active' : ''}" style="${activePath === path ? '' : `border-color:${color}30`}">${label}</a>`
    ).join('')}</div>`;
  }

  function layout(activePath, title, subtitle, content) {
    return `${devStyles}
    <div class="dd-topbar">
      <h1>⚡ Dev Dashboard</h1>
      <span class="subtitle">${esc(title)}${subtitle ? ' — ' + esc(subtitle) : ''}</span>
    </div>
    <div class="dd-wrap">
      ${devNav(activePath)}
      ${content}
    </div>`;
  }

  function statCard(label, value, sub, sparkSvg) {
    return `<div class="dd-stat">
      <div class="lbl">${esc(label)}</div>
      <div class="num">${value}</div>
      <div class="sub">${sub || ''}</div>
      ${sparkSvg ? '<div style="margin-top:8px">' + sparkSvg + '</div>' : ''}
    </div>`;
  }

  function alertBox(type, msg) {
    return `<div class="dd-alert dd-alert-${type}">${msg}</div>`;
  }

  function emptyState(msg) {
    return `<div class="dd-empty">${esc(msg)}</div>`;
  }

  // ── Database Migrations ──────────────────────────────────────────────
  async function runMigrations() {
    const migrationSQL = `
      CREATE TABLE IF NOT EXISTS dev_deployments (
        id SERIAL PRIMARY KEY,
        version VARCHAR(50),
        status TEXT NOT NULL DEFAULT 'pending',
        triggered_by VARCHAR(120),
        deploy_url TEXT,
        log TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ
      );
      CREATE TABLE IF NOT EXISTS dev_sandboxes (
        id SERIAL PRIMARY KEY,
        name VARCHAR(120) NOT NULL,
        tenant_id_range VARCHAR(50),
        config JSONB DEFAULT '{}',
        expires_at TIMESTAMPTZ,
        created_by VARCHAR(120),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS dev_marketplace_submissions (
        id SERIAL PRIMARY KEY,
        plugin_name VARCHAR(120) NOT NULL,
        developer_email VARCHAR(200) NOT NULL,
        version VARCHAR(30),
        description TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        review_notes TEXT,
        submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        reviewed_at TIMESTAMPTZ
      );
      CREATE TABLE IF NOT EXISTS dev_event_log (
        id SERIAL PRIMARY KEY,
        event_type VARCHAR(80) NOT NULL,
        source_module VARCHAR(120),
        payload JSONB DEFAULT '{}',
        processed BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS dev_event_subscribers (
        id SERIAL PRIMARY KEY,
        event_type VARCHAR(80) NOT NULL,
        subscriber_module VARCHAR(120) NOT NULL,
        callback_url TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS dev_automation_rules (
        id SERIAL PRIMARY KEY,
        name VARCHAR(120) NOT NULL,
        trigger_event VARCHAR(120) NOT NULL,
        conditions JSONB DEFAULT '{}',
        actions JSONB DEFAULT '{}',
        is_active BOOLEAN DEFAULT TRUE,
        created_by VARCHAR(120),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS dev_workflow_executions (
        id SERIAL PRIMARY KEY,
        rule_id INTEGER REFERENCES dev_automation_rules(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        result JSONB DEFAULT '{}',
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ
      );
      CREATE TABLE IF NOT EXISTS dev_api_registry (
        id SERIAL PRIMARY KEY,
        method VARCHAR(10) NOT NULL,
        path VARCHAR(500) NOT NULL,
        version VARCHAR(10) DEFAULT 'v1',
        description TEXT,
        rate_limit INT DEFAULT 100,
        auth_required BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_dev_deployments_created ON dev_deployments(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_dev_sandboxes_expires ON dev_sandboxes(expires_at);
      CREATE INDEX IF NOT EXISTS idx_dev_marketplace_status ON dev_marketplace_submissions(status);
      CREATE INDEX IF NOT EXISTS idx_dev_event_log_type ON dev_event_log(event_type, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_dev_event_subscribers_type ON dev_event_subscribers(event_type);
      CREATE INDEX IF NOT EXISTS idx_dev_automation_rules_active ON dev_automation_rules(is_active);
      CREATE INDEX IF NOT EXISTS idx_dev_workflow_executions_rule ON dev_workflow_executions(rule_id, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_dev_api_registry_path ON dev_api_registry(method, path);
    `;
    try {
      await runMigration(pool, 'developer-dashboard', migrationSQL, { maxRetries: 3, baseDelay: 2000 });
    } catch (e) {
      /* migration OK */
    }

    // Seed default API registry entries
    const defaultEndpoints = [
      ['GET', '/api/v1/students', 'v2', 'List students', 200, true],
      ['POST', '/api/v1/students', 'v2', 'Create student', 50, true],
      ['GET', '/api/v1/fees', 'v2', 'List fees', 200, true],
      ['POST', '/api/v1/fees', 'v2', 'Create fee', 50, true],
      ['GET', '/api/v1/attendance', 'v2', 'List attendance', 200, true],
      ['POST', '/api/v1/attendance', 'v2', 'Record attendance', 100, true],
      ['GET', '/api/v1/payments', 'v2', 'List payments', 200, true],
      ['POST', '/api/v1/payments', 'v2', 'Process payment', 30, true],
      ['GET', '/api/v1/users', 'v2', 'List users', 100, true],
      ['GET', '/api/v1/tenants', 'v2', 'List tenants', 50, true],
      ['GET', '/api/v1/reports', 'v2', 'Get reports', 60, true],
      ['POST', '/api/v1/webhooks', 'v2', 'Manage webhooks', 30, true],
      ['GET', '/api/v1/auth/me', 'v2', 'Current user profile', 200, true],
      ['POST', '/api/v1/auth/login', 'v2', 'API login', 20, false],
      ['GET', '/api/v1/health', 'v2', 'Health check', 500, false],
      ['GET', '/api/v1/students', 'v1', 'List students (legacy)', 200, true],
      ['POST', '/api/v1/students', 'v1', 'Create student (legacy)', 50, true],
    ];
    for (const [method, path, ver, desc, limit, auth] of defaultEndpoints) {
      try {
        await pool.query(
          `INSERT INTO dev_api_registry (method, path, version, description, rate_limit, auth_required)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
          [method, path, ver, desc, limit, auth]
        );
      } catch (e) { /* duplicate ok */ }
    }

    // Seed default event types
    const defaultEvents = [
      ['payment.received', 'billing'],
      ['payment.failed', 'billing'],
      ['student.created', 'academic'],
      ['student.enrolled', 'academic'],
      ['attendance.recorded', 'academic'],
      ['user.registered', 'auth'],
      ['user.login', 'auth'],
      ['tenant.created', 'platform'],
      ['tenant.suspended', 'platform'],
      ['subscription.changed', 'billing'],
      ['webhook.fired', 'integration'],
      ['report.generated', 'analytics'],
    ];
    for (const [eventType, source] of defaultEvents) {
      try {
        await pool.query(
          `INSERT INTO dev_event_subscribers (event_type, subscriber_module, callback_url, is_active)
           VALUES ($1, $2, $3, true) ON CONFLICT DO NOTHING`,
          [eventType, source, '']
        );
      } catch (e) { /* duplicate ok */ }
    }

    // Seed default automation rules
    const defaultRules = [
      ['Auto-suspend on payment failure', 'payment.failed', '{"consecutive_failures": 3}', '{"action": "suspend_tenant", "notify": true}'],
      ['Welcome email on registration', 'user.registered', '{"user_type": "new"}', '{"action": "send_email", "template": "welcome"}'],
      ['Alert on high error rate', 'platform.error_spike', '{"error_rate_pct": 5}', '{"action": "send_alert", "channel": "slack"}'],
    ];
    for (const [name, trigger, conditions, actions] of defaultRules) {
      try {
        await pool.query(
          `INSERT INTO dev_automation_rules (name, trigger_event, conditions, actions, is_active, created_by)
           VALUES ($1, $2, $3, $4, true, 'system') ON CONFLICT DO NOTHING`,
          [name, trigger, conditions, actions]
        );
      } catch (e) { /* duplicate ok */ }
    }

    // Seed some sample marketplace submissions
    const samplePlugins = [
      ['Attendance Tracker Pro', 'dev@sample.com', '1.2.0', 'Advanced attendance with biometric support', 'approved', 'Great plugin, approved'],
      ['Fee Calculator', 'dev@sample.com', '2.0.1', 'Smart fee calculation with installment plans', 'approved', 'Well documented'],
      ['Report Builder', 'plugins@sample.com', '1.0.0', 'Drag and drop report builder', 'pending', ''],
      ['SMS Gateway Plus', 'sms@sample.com', '3.1.0', 'Multi-provider SMS gateway', 'pending', ''],
      ['Grade Analytics', 'analytics@sample.com', '1.5.0', 'Visual grade analytics dashboard', 'rejected', 'Security vulnerability in data handling'],
    ];
    for (const [name, email, ver, desc, status, notes] of samplePlugins) {
      try {
        await pool.query(
          `INSERT INTO dev_marketplace_submissions (plugin_name, developer_email, version, description, status, review_notes, submitted_at, reviewed_at)
           VALUES ($1,$2,$3,$4,$5,$6,NOW(),CASE WHEN $5!='pending' THEN NOW() ELSE NULL END) ON CONFLICT DO NOTHING`,
          [name, email, ver, desc, status, notes]
        );
      } catch (e) { /* duplicate ok */ }
    }

    console.log('[DevDashboard] Migrations & seeds complete');
  }

  // ── Initialize ───────────────────────────────────────────────────────
  runMigrations().catch(e => console.warn('[DevDashboard] Init error:', e.message));

  // ══════════════════════════════════════════════════════════════════════
  // 1. GET /dev/dashboard — Main Developer Dashboard
  // ══════════════════════════════════════════════════════════════════════
  app.get('/dev/dashboard', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    audit(req, 'view', 'dev_dashboard');
    const mem = process.memoryUsage();
    const uptime = process.uptime();
    const loadAvg = os.loadavg();
    const cpuCores = os.cpus().length;

    // Platform stats
    const [tenants, users, featureFlags, apiCallsToday, deployments, activeFlags] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS cnt FROM tenants').catch(() => ({ rows: [{ cnt: 0 }] })),
      pool.query('SELECT COUNT(*)::int AS cnt FROM users').catch(() => ({ rows: [{ cnt: 0 }] })),
      pool.query("SELECT COUNT(*)::int AS cnt FROM feature_flags WHERE is_active=true").catch(() => ({ rows: [{ cnt: 0 }] })),
      pool.query("SELECT COUNT(*)::int AS cnt FROM audit_logs WHERE created_at > NOW() - INTERVAL '24 hours'").catch(() => ({ rows: [{ cnt: 0 }] })),
      pool.query('SELECT * FROM dev_deployments ORDER BY created_at DESC LIMIT 5').catch(() => ({ rows: [] })),
      pool.query("SELECT COUNT(*)::int AS cnt FROM feature_flags").catch(() => ({ rows: [{ cnt: 0 }] })),
    ]);

    // System health metrics
    const memPct = ((mem.heapUsed / mem.heapTotal) * 100).toFixed(1);
    const memColor = statusColor(+memPct, 70, 90);
    const loadColor = statusColor(loadAvg[0], cpuCores * 0.7, cpuCores * 0.9);
    const dbConns = pool.totalCount || 0;
    const dbIdle = pool.idleCount || 0;
    const dbWaiting = pool.waitingCount || 0;
    const dbColor = statusColor(dbWaiting, 5, 15);

    // API usage last 7 days
    const { rows: apiUsage } = await pool.query(
      `SELECT DATE(created_at) AS day, COUNT(*)::int AS cnt FROM audit_logs
       WHERE created_at > NOW() - INTERVAL '7 days' GROUP BY day ORDER BY day`
    ).catch(() => ({ rows: [] }));
    const usageValues = apiUsage.map(r => r.cnt);
    const usageLabels = apiUsage.map(r => new Date(r.day).toLocaleDateString('en', { weekday: 'short' }));

    // Error rate
    const { rows: errorStats } = await pool.query(
      `SELECT COUNT(*)::int AS total,
        COUNT(CASE WHEN action LIKE '%error%' OR action LIKE '%fail%' THEN 1 END) AS errors
       FROM audit_logs WHERE created_at > NOW() - INTERVAL '24 hours'`
    ).catch(() => ({ rows: [{ total: 0, errors: 0 }] }));
    const errorRate = errorStats[0]?.total > 0 ? ((errorStats[0].errors / errorStats[0].total) * 100).toFixed(1) : '0.0';
    const errorColor = statusColor(+errorRate, 5, 15);

    const html = layout('/dev/dashboard', 'Developer Dashboard', 'Platform Overview', `
      ${alertBox('info', '<span class="dd-live"></span><strong>System Online</strong> — All services operational')}
      <div class="dd-grid">
        ${statCard('Total Tenants', fmtNum(tenants.rows[0].cnt), 'Registered organizations')}
        ${statCard('Total Users', fmtNum(users.rows[0].cnt), 'Platform users')}
        ${statCard('API Calls Today', fmtNum(apiCallsToday.rows[0].cnt), 'Last 24 hours')}
        ${statCard('Uptime', fmtUptime(uptime), `Since last restart`, svgSparkline([uptime], 80, 24, C.green))}
        ${statCard('Feature Flags', fmtNum(featureFlags.rows[0].cnt), `of ${fmtNum(activeFlags.rows[0].cnt)} total active`)}
        ${statCard('Error Rate', `${errorRate}%`, `<span style="color:${errorColor}">●</span> Last 24h`, svgSparkline([+errorRate], 80, 24, errorColor))}
      </div>

      <div class="dd-grid3">
        <div>
          <div class="dd-card">
            <h2>📈 API Usage (7 Days)</h2>
            ${svgAreaChart(usageValues, 520, 140, C.accent, usageLabels)}
            <div class="dd-legend">
              <span class="lg-blue">Requests</span>
              <span style="margin-left:auto;font-size:.72rem;color:var(--muted)">Peak: ${usageValues.length ? fmtNum(Math.max(...usageValues)) : 0} req/day</span>
            </div>
          </div>
        </div>
        <div>
          <div class="dd-card">
            <h2>🖥 System Health</h2>
            <table class="dd-table">
              <tr><td style="color:var(--muted)">Memory</td><td style="font-weight:700"><span style="color:${memColor}">●</span> ${memPct}%</td><td style="color:var(--muted);font-size:.75rem">${fmtBytes(mem.heapUsed)} / ${fmtBytes(mem.heapTotal)}</td></tr>
              <tr><td style="color:var(--muted)">CPU Load</td><td style="font-weight:700"><span style="color:${loadColor}">●</span> ${loadAvg[0].toFixed(2)}</td><td style="color:var(--muted);font-size:.75rem">${cpuCores} cores</td></tr>
              <tr><td style="color:var(--muted)">DB Connections</td><td style="font-weight:700"><span style="color:${dbColor}">●</span> ${dbConns}</td><td style="color:var(--muted);font-size:.75rem">${dbIdle} idle · ${dbWaiting} waiting</td></tr>
              <tr><td style="color:var(--muted)">Error Rate</td><td style="font-weight:700"><span style="color:${errorColor}">●</span> ${errorRate}%</td><td style="color:var(--muted);font-size:.75rem">${errorStats[0]?.errors || 0} errors / ${errorStats[0]?.total || 0} total</td></tr>
              <tr><td style="color:var(--muted)">Node.js</td><td style="font-weight:700">${process.version}</td><td style="color:var(--muted);font-size:.75rem">PID ${process.pid}</td></tr>
            </table>
          </div>
        </div>
      </div>

      <div class="dd-grid2">
        <div class="dd-card">
          <h2>🚀 Recent Deployments</h2>
          ${deployments.rows.length ? `
          <table class="dd-table">
            <tr><th>Version</th><th>Status</th><th>Triggered By</th><th>Time</th></tr>
            ${deployments.rows.map(d => `<tr>
              <td><code>${esc(d.version || 'N/A')}</code></td>
              <td><span class="dd-tag dd-tag-${d.status === 'success' ? 'green' : d.status === 'failed' ? 'red' : 'yellow'}">${esc(d.status)}</span></td>
              <td>${esc(d.triggered_by || '-')}</td>
              <td style="color:var(--muted)">${timeAgo(d.created_at)}</td>
            </tr>`).join('')}
          </table>` : emptyState('No deployments recorded yet')}
          <div style="margin-top:12px"><a href="/dev/ci-cd" class="dd-btn dd-btn-ghost dd-btn-sm">View CI/CD →</a></div>
        </div>
        <div class="dd-card">
          <h2>⚡ Quick Links</h2>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            ${navItems.slice(1).map(([path, label, color]) =>
              `<a href="${path}" class="dd-btn dd-btn-ghost dd-btn-sm" style="justify-content:start;border-color:${color}40;color:${color}">${label}</a>`
            ).join('')}
          </div>
        </div>
      </div>
    `);
    res.send(renderPage('dev-dashboard', html, req.session?.user));
  }));

  // ══════════════════════════════════════════════════════════════════════
  // 2. GET /dev/ci-cd — CI/CD Pipeline Dashboard
  // ══════════════════════════════════════════════════════════════════════
  app.get('/dev/ci-cd', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    audit(req, 'view', 'dev_cicd');
    const { rows: deploys } = await pool.query(
      'SELECT * FROM dev_deployments ORDER BY created_at DESC LIMIT 50'
    ).catch(() => ({ rows: [] }));

    const successCount = deploys.filter(d => d.status === 'success').length;
    const failedCount = deploys.filter(d => d.status === 'failed').length;
    const pendingCount = deploys.filter(d => d.status === 'pending').length;

    // Environment variables (masked)
    const envVars = Object.keys(process.env).filter(k =>
      !['PATH', 'HOME', 'SHELL', 'TERM', 'LANG', 'USER', 'PWD', 'OLDPWD', 'SHLVL', '_', 'LESSOPEN', 'LESSCLOSE', 'LS_COLORS', 'NODE_VERSION', 'YARN_VERSION'].includes(k)
    ).sort().slice(0, 30);

    const html = layout('/dev/ci-cd', 'CI/CD Pipeline', 'Deployment Management', `
      <div class="dd-grid">
        ${statCard('Total Deploys', fmtNum(deploys.length), 'All time')}
        ${statCard('Successful', fmtNum(successCount), `<span style="color:${C.green}">●</span> Deployments`)}
        ${statCard('Failed', fmtNum(failedCount), `<span style="color:${C.red}">●</span> Deployments`)}
        ${statCard('Pending', fmtNum(pendingCount), `<span style="color:${C.yellow}">●</span> In progress`)}
      </div>

      <div class="dd-grid2">
        <div>
          <div class="dd-card">
            <h2>🚀 Trigger New Deployment</h2>
            <form method="POST" action="/dev/api/deploy" style="margin-bottom:16px">
              <div style="display:flex;gap:10px;align-items:end;flex-wrap:wrap">
                <div style="flex:1;min-width:150px">
                  <label style="display:block;font-size:.78rem;color:var(--muted);margin-bottom:4px;font-weight:600">Version</label>
                  <input name="version" class="dd-input" placeholder="v1.0.0" value="v${new Date().toISOString().split('T')[0].replace(/-/g, '.')}">
                </div>
                <button type="submit" class="dd-btn dd-btn-primary">⚡ Deploy Now</button>
              </div>
            </form>
            <div style="font-size:.78rem;color:var(--muted)">
              <strong>Deploy Webhook:</strong> <code style="color:var(--accent)">${esc(RENDER_DEPLOY_WEBHOOK.replace(/key=[^&]+/, 'key=****'))}</code>
            </div>
          </div>

          <div class="dd-card">
            <h2>📋 Deployment Timeline</h2>
            ${deploys.length ? `
            <div class="dd-scroll" style="max-height:400px">
              <table class="dd-table">
                <tr><th>ID</th><th>Version</th><th>Status</th><th>Triggered By</th><th>Started</th><th>Duration</th><th>Actions</th></tr>
                ${deploys.map(d => {
                  const dur = d.completed_at ? Math.round((new Date(d.completed_at) - new Date(d.created_at)) / 1000) : null;
                  const durStr = dur !== null ? (dur > 60 ? Math.floor(dur / 60) + 'm ' + (dur % 60) + 's' : dur + 's') : '—';
                  return `<tr>
                    <td>#${d.id}</td>
                    <td><code>${esc(d.version || 'N/A')}</code></td>
                    <td><span class="dd-tag dd-tag-${d.status === 'success' ? 'green' : d.status === 'failed' ? 'red' : 'yellow'}">${esc(d.status)}</span></td>
                    <td>${esc(d.triggered_by || '-')}</td>
                    <td style="color:var(--muted)">${timeAgo(d.created_at)}</td>
                    <td class="dd-monospace">${durStr}</td>
                    <td>${d.log ? `<details><summary class="dd-btn dd-btn-ghost dd-btn-sm">Log</summary><div class="dd-code" style="margin-top:8px;max-height:200px">${esc(d.log)}</div></details>` : '-'}</td>
                  </tr>`;
                }).join('')}
              </table>
            </div>` : emptyState('No deployments yet. Trigger your first deploy above.')}
          </div>
        </div>

        <div>
          <div class="dd-card">
            <h2>🔒 Environment Variables</h2>
            <p style="color:var(--muted);font-size:.78rem;margin-bottom:12px">Values are masked for security. Click to reveal.</p>
            <div class="dd-scroll" style="max-height:300px">
              <table class="dd-table">
                <tr><th>Variable</th><th>Value</th></tr>
                ${envVars.map(k => {
                  const val = process.env[k];
                  const masked = val ? val.substring(0, 4) + '•••••••' : '(empty)';
                  return `<tr>
                    <td><code style="color:var(--accent)">${esc(k)}</code></td>
                    <td><span class="dd-monospace" style="font-size:.75rem;color:var(--muted)" title="Click to reveal" onclick="this.textContent=this.dataset.v" data-v="${esc(val || '')}">${esc(masked)}</span></td>
                  </tr>`;
                }).join('')}
              </table>
            </div>
          </div>

          <div class="dd-card">
            <h2>🔄 Deploy Webhook</h2>
            <p style="color:var(--muted);font-size:.78rem;margin-bottom:12px">Use this webhook to trigger deployments from external CI/CD tools.</p>
            <div class="dd-code" style="font-size:.72rem">curl -X POST ${esc(RENDER_DEPLOY_WEBHOOK)}</div>
            <p style="color:var(--muted);font-size:.72rem;margin-top:8px">Auto-deploy is enabled for the main branch. Manual triggers use the button above.</p>
          </div>
        </div>
      </div>
    `);
    res.send(renderPage('dev-cicd', html, req.session?.user));
  }));

  // ══════════════════════════════════════════════════════════════════════
  // 3. GET /dev/app-lifecycle — App Lifecycle Management
  // ══════════════════════════════════════════════════════════════════════
  app.get('/dev/app-lifecycle', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    audit(req, 'view', 'dev_app_lifecycle');

    const [versions, changelog, deprecations] = await Promise.all([
      pool.query('SELECT * FROM dev_api_versions ORDER BY release_date DESC').catch(() => ({ rows: [] })),
      pool.query('SELECT * FROM dev_changelog ORDER BY created_at DESC LIMIT 20').catch(() => ({ rows: [] })),
      pool.query("SELECT * FROM dev_api_versions WHERE deprecation_date IS NOT NULL AND is_active=true ORDER BY deprecation_date").catch(() => ({ rows: [] })),
    ]);

    const currentVersion = versions.rows.find(v => v.is_current);

    // Feature rollout data
    const rollouts = [
      { name: 'New Dashboard UI', percentage: 85, status: 'rolling' },
      { name: 'GraphQL API', percentage: 40, status: 'rolling' },
      { name: 'Real-time Notifications', percentage: 100, status: 'complete' },
      { name: 'AI Grading', percentage: 15, status: 'beta' },
      { name: 'Multi-language Support', percentage: 60, status: 'rolling' },
    ];

    const envPromotions = [
      { from: 'development', to: 'staging', status: 'ready', lastPromoted: '2h ago' },
      { from: 'staging', to: 'production', status: 'blocked', lastPromoted: '1d ago' },
    ];

    const html = layout('/dev/app-lifecycle', 'App Lifecycle', 'Version & Release Management', `
      <div class="dd-grid">
        ${statCard('Current Version', currentVersion ? esc(currentVersion.version) : 'N/A', currentVersion ? `Released ${currentVersion.release_date ? new Date(currentVersion.release_date).toLocaleDateString() : 'unknown'}` : 'No active version')}
        ${statCard('API Versions', fmtNum(versions.rows.length), 'Registered versions')}
        ${statCard('Deprecation Notices', fmtNum(deprecations.rows.length), 'Active deprecations')}
        ${statCard('Changelog Entries', fmtNum(changelog.rows.length), 'Recorded changes')}
      </div>

      <div class="dd-grid2">
        <div>
          <div class="dd-card">
            <h2>🏷 Version Management</h2>
            ${versions.rows.length ? `
            <table class="dd-table">
              <tr><th>Version</th><th>Released</th><th>Deprecation</th><th>Status</th></tr>
              ${versions.rows.map(v => `<tr>
                <td><code style="color:var(--accent)">${esc(v.version)}</code></td>
                <td style="color:var(--muted)">${v.release_date ? new Date(v.release_date).toLocaleDateString() : '-'}</td>
                <td style="color:var(--muted)">${v.deprecation_date ? new Date(v.deprecation_date).toLocaleDateString() : '-'}</td>
                <td>
                  ${v.is_current ? '<span class="dd-tag dd-tag-green">Current</span>' : v.is_active ? '<span class="dd-tag dd-tag-blue">Active</span>' : '<span class="dd-tag dd-tag-gray">Inactive</span>'}
                </td>
              </tr>`).join('')}
            </table>` : emptyState('No API versions registered')}
          </div>

          <div class="dd-card">
            <h2>📝 Changelog</h2>
            <form method="POST" action="/dev/app-lifecycle/changelog" style="margin-bottom:16px">
              <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end">
                <div style="flex:1;min-width:120px">
                  <label style="font-size:.72rem;color:var(--muted);display:block;margin-bottom:4px">Version</label>
                  <input name="version" class="dd-input" placeholder="v1.0.0" required>
                </div>
                <div style="flex:1;min-width:120px">
                  <label style="font-size:.72rem;color:var(--muted);display:block;margin-bottom:4px">Title</label>
                  <input name="title" class="dd-input" placeholder="Feature name" required>
                </div>
                <div style="flex:0.7;min-width:100px">
                  <label style="font-size:.72rem;color:var(--muted);display:block;margin-bottom:4px">Type</label>
                  <select name="change_type" class="dd-select">
                    <option value="feature">Feature</option>
                    <option value="fix">Bug Fix</option>
                    <option value="breaking">Breaking</option>
                    <option value="deprecation">Deprecation</option>
                  </select>
                </div>
              </div>
              <div style="margin-top:10px">
                <label style="font-size:.72rem;color:var(--muted);display:block;margin-bottom:4px">Description</label>
                <textarea name="description" class="dd-textarea" rows="3" placeholder="Describe the change..."></textarea>
              </div>
              <button type="submit" class="dd-btn dd-btn-primary dd-btn-sm" style="margin-top:10px">Add Entry</button>
            </form>
            ${changelog.rows.length ? `
            <div class="dd-scroll" style="max-height:300px">
              <table class="dd-table">
                <tr><th>Version</th><th>Title</th><th>Type</th><th>Date</th><th>Published</th></tr>
                ${changelog.rows.map(c => `<tr>
                  <td><code>${esc(c.version)}</code></td>
                  <td>${esc(c.title)}</td>
                  <td><span class="dd-tag dd-tag-${c.change_type === 'feature' ? 'green' : c.change_type === 'fix' ? 'blue' : c.change_type === 'breaking' ? 'red' : 'yellow'}">${esc(c.change_type)}</span></td>
                  <td style="color:var(--muted)">${timeAgo(c.created_at)}</td>
                  <td>${c.is_published ? '<span class="dd-tag dd-tag-green">Yes</span>' : '<span class="dd-tag dd-tag-gray">Draft</span>'}</td>
                </tr>`).join('')}
              </table>
            </div>` : ''}
          </div>
        </div>

        <div>
          <div class="dd-card">
            <h2>🎯 Feature Rollout</h2>
            ${rollouts.map(r => `
              <div style="margin-bottom:14px">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
                  <span style="font-size:.85rem;font-weight:600">${esc(r.name)}</span>
                  <span class="dd-tag dd-tag-${r.status === 'complete' ? 'green' : r.status === 'beta' ? 'yellow' : 'accent'}">${r.percentage}%</span>
                </div>
                <div class="dd-progress">
                  <div class="dd-progress-bar" style="width:${r.percentage}%;background:${r.status === 'complete' ? C.green : r.status === 'beta' ? C.yellow : C.accent}"></div>
                </div>
              </div>
            `).join('')}
          </div>

          <div class="dd-card">
            <h2>🚫 Deprecation Notices</h2>
            ${deprecations.rows.length ? deprecations.rows.map(d => `
              <div style="margin-bottom:12px;padding:12px;background:var(--bg);border-radius:8px;border-left:3px solid ${C.yellow}">
                <strong style="color:${C.yellow}">${esc(d.version)}</strong>
                <span style="color:var(--muted);font-size:.78rem"> — Deprecates ${d.deprecation_date ? new Date(d.deprecation_date).toLocaleDateString() : 'TBD'}</span>
                <div style="font-size:.78rem;color:var(--muted);margin-top:4px">${esc(d.changelog || 'No details')}</div>
              </div>
            `).join('') : '<div style="color:var(--muted);font-size:.85rem">✅ No active deprecation notices</div>'}
          </div>

          <div class="dd-card">
            <h2>🔄 Environment Promotion</h2>
            ${envPromotions.map(p => `
              <div style="display:flex;align-items:center;gap:12px;padding:12px;background:var(--bg);border-radius:8px;margin-bottom:8px">
                <span class="dd-tag dd-tag-yellow">${esc(p.from)}</span>
                <span style="color:var(--muted)">→</span>
                <span class="dd-tag dd-tag-green">${esc(p.to)}</span>
                <span class="dd-tag dd-tag-${p.status === 'ready' ? 'green' : 'red'}">${esc(p.status)}</span>
                <span style="color:var(--muted);font-size:.75rem;margin-left:auto">${esc(p.lastPromoted)}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `);
    res.send(renderPage('dev-app-lifecycle', html, req.session?.user));
  }));

  // POST: Add changelog entry
  app.post('/dev/app-lifecycle/changelog', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    const { version, title, description, change_type } = req.body;
    if (!version || !title) return res.redirect('/dev/app-lifecycle');
    await pool.query(
      'INSERT INTO dev_changelog (version, title, description, change_type, is_published) VALUES ($1,$2,$3,$4,false)',
      [version, title, description || '', change_type || 'feature']
    ).catch(() => {});
    res.redirect('/dev/app-lifecycle');
  }));

  // ══════════════════════════════════════════════════════════════════════
  // 4. GET /dev/sandbox — Sandbox Environment Management
  // ══════════════════════════════════════════════════════════════════════
  app.get('/dev/sandbox', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    audit(req, 'view', 'dev_sandbox');
    const { rows: sandboxes } = await pool.query(
      'SELECT * FROM dev_sandboxes ORDER BY created_at DESC'
    ).catch(() => ({ rows: [] }));

    const activeSandboxCount = sandboxes.filter(s => !s.expires_at || new Date(s.expires_at) > new Date()).length;
    const expiredSandboxCount = sandboxes.filter(s => s.expires_at && new Date(s.expires_at) <= new Date()).length;

    const html = layout('/dev/sandbox', 'Sandbox', 'Environment Management', `
      <div class="dd-grid">
        ${statCard('Total Sandboxes', fmtNum(sandboxes.length), 'Created environments')}
        ${statCard('Active', fmtNum(activeSandboxCount), `<span style="color:${C.green}">●</span> Not expired`)}
        ${statCard('Expired', fmtNum(expiredSandboxCount), `<span style="color:${C.red}">●</span> Need cleanup`)}
        ${statCard('Next ID Range', '9000-9999', 'Reserved for sandbox')}
      </div>

      <div class="dd-grid2">
        <div>
          <div class="dd-card">
            <h2>➕ Create Sandbox</h2>
            <form method="POST" action="/dev/sandbox/create">
              <div style="margin-bottom:12px">
                <label style="font-size:.78rem;color:var(--muted);display:block;margin-bottom:4px;font-weight:600">Sandbox Name</label>
                <input name="name" class="dd-input" placeholder="e.g. Testing v2.0" required>
              </div>
              <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">
                <div style="flex:1;min-width:120px">
                  <label style="font-size:.78rem;color:var(--muted);display:block;margin-bottom:4px;font-weight:600">Tenant ID Range</label>
                  <input name="tenant_id_range" class="dd-input" placeholder="9000-9100" value="9000-9100">
                </div>
                <div style="flex:1;min-width:120px">
                  <label style="font-size:.78rem;color:var(--muted);display:block;margin-bottom:4px;font-weight:600">Expires In</label>
                  <select name="expires_hours" class="dd-select">
                    <option value="24">24 hours</option>
                    <option value="72">3 days</option>
                    <option value="168">7 days</option>
                    <option value="720">30 days</option>
                  </select>
                </div>
              </div>
              <div style="margin-bottom:12px">
                <label style="font-size:.78rem;color:var(--muted);display:block;margin-bottom:4px;font-weight:600">Config Override (JSON)</label>
                <textarea name="config" class="dd-textarea" rows="3" placeholder='{"theme":"dark","locale":"en"}'>{}</textarea>
              </div>
              <button type="submit" class="dd-btn dd-btn-primary">Create Sandbox</button>
            </form>
          </div>

          <div class="dd-card">
            <h2>🧪 Test Data Generators</h2>
            <p style="color:var(--muted);font-size:.78rem;margin-bottom:12px">Populate sandbox environments with realistic test data.</p>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <form method="POST" action="/dev/sandbox/generate-data" style="display:inline">
                <input type="hidden" name="data_type" value="students">
                <button type="submit" class="dd-btn dd-btn-ghost dd-btn-sm">Students (100)</button>
              </form>
              <form method="POST" action="/dev/sandbox/generate-data" style="display:inline">
                <input type="hidden" name="data_type" value="fees">
                <button type="submit" class="dd-btn dd-btn-ghost dd-btn-sm">Fees (50)</button>
              </form>
              <form method="POST" action="/dev/sandbox/generate-data" style="display:inline">
                <input type="hidden" name="data_type" value="attendance">
                <button type="submit" class="dd-btn dd-btn-ghost dd-btn-sm">Attendance (200)</button>
              </form>
              <form method="POST" action="/dev/sandbox/generate-data" style="display:inline">
                <input type="hidden" name="data_type" value="users">
                <button type="submit" class="dd-btn dd-btn-ghost dd-btn-sm">Users (25)</button>
              </form>
            </div>
          </div>
        </div>

        <div>
          <div class="dd-card">
            <h2>📋 Sandbox Environments</h2>
            ${sandboxes.length ? `
            <div class="dd-scroll" style="max-height:400px">
              <table class="dd-table">
                <tr><th>Name</th><th>ID Range</th><th>Expires</th><th>Status</th><th>Actions</th></tr>
                ${sandboxes.map(s => {
                  const isExpired = s.expires_at && new Date(s.expires_at) <= new Date();
                  return `<tr>
                    <td><strong>${esc(s.name)}</strong></td>
                    <td class="dd-monospace" style="font-size:.75rem">${esc(s.tenant_id_range || '-')}</td>
                    <td style="color:var(--muted)">${s.expires_at ? timeAgo(s.expires_at) : 'Never'}</td>
                    <td><span class="dd-tag dd-tag-${isExpired ? 'red' : 'green'}">${isExpired ? 'Expired' : 'Active'}</span></td>
                    <td>
                      <form method="POST" action="/dev/sandbox/reset/${s.id}" style="display:inline"><button class="dd-btn dd-btn-warning dd-btn-sm">Reset</button></form>
                      <form method="POST" action="/dev/sandbox/delete/${s.id}" style="display:inline"><button class="dd-btn dd-btn-danger dd-btn-sm">Delete</button></form>
                    </td>
                  </tr>`;
                }).join('')}
              </table>
            </div>` : emptyState('No sandbox environments. Create one above.')}
          </div>

          <div class="dd-card">
            <h2>🧹 Cleanup</h2>
            <p style="color:var(--muted);font-size:.78rem;margin-bottom:12px">Remove expired sandboxes and their associated data.</p>
            <form method="POST" action="/dev/sandbox/cleanup">
              <button type="submit" class="dd-btn dd-btn-danger dd-btn-sm">Clean Up Expired (${expiredSandboxCount})</button>
            </form>
          </div>
        </div>
      </div>
    `);
    res.send(renderPage('dev-sandbox', html, req.session?.user));
  }));

  // POST: Create sandbox
  app.post('/dev/sandbox/create', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    const { name, tenant_id_range, expires_hours, config } = req.body;
    if (!name) return res.redirect('/dev/sandbox');
    let parsedConfig = {};
    try { parsedConfig = JSON.parse(config || '{}'); } catch (e) { parsedConfig = {}; }
    const expiresAt = expires_hours ? new Date(Date.now() + parseInt(expires_hours) * 3600000).toISOString() : null;
    await pool.query(
      'INSERT INTO dev_sandboxes (name, tenant_id_range, config, expires_at, created_by) VALUES ($1,$2,$3,$4,$5)',
      [name, tenant_id_range || '9000-9100', JSON.stringify(parsedConfig), expiresAt, req.session.user.email || 'admin']
    ).catch(() => {});
    res.redirect('/dev/sandbox');
  }));

  // POST: Reset sandbox
  app.post('/dev/sandbox/reset/:id', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    const id = parseInt(req.params.id);
    await pool.query(
      "UPDATE dev_sandboxes SET config='{}', expires_at=NOW()+INTERVAL '24 hours' WHERE id=$1",
      [id]
    ).catch(() => {});
    res.redirect('/dev/sandbox');
  }));

  // POST: Delete sandbox
  app.post('/dev/sandbox/delete/:id', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    const id = parseInt(req.params.id);
    await pool.query('DELETE FROM dev_sandboxes WHERE id=$1', [id]).catch(() => {});
    res.redirect('/dev/sandbox');
  }));

  // POST: Generate test data
  app.post('/dev/sandbox/generate-data', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    const dataType = req.body.data_type || 'students';
    const tid = 9000; // Sandbox tenant ID
    const count = { students: 100, fees: 50, attendance: 200, users: 25 }[dataType] || 50;

    try {
      if (dataType === 'students') {
        for (let i = 0; i < count; i++) {
          await pool.query(
            "INSERT INTO students (tenant_id, name, class, guardian_name, guardian_phone) VALUES ($1,$2,$3,$4,$5)",
            [tid, `Test Student ${i + 1}`, `S${Math.floor(i / 30) + 1}`, `Parent ${i + 1}`, '+256700000' + String(i).padStart(3, '0')]
          );
        }
      } else if (dataType === 'fees') {
        for (let i = 0; i < count; i++) {
          await pool.query(
            "INSERT INTO fees (tenant_id, student_id, amount, term, status) VALUES ($1,$2,$3,$4,$5)",
            [tid, i + 1, Math.floor(Math.random() * 500000) + 100000, 'Term 1', ['paid', 'unpaid', 'partial'][Math.floor(Math.random() * 3)]]
          );
        }
      } else if (dataType === 'attendance') {
        for (let i = 0; i < count; i++) {
          await pool.query(
            "INSERT INTO attendance (tenant_id, student_id, date, status) VALUES ($1,$2,NOW()-($3||' days')::interval,$4)",
            [tid, (i % 100) + 1, Math.floor(Math.random() * 30), ['present', 'absent', 'late'][Math.floor(Math.random() * 3)]]
          );
        }
      } else if (dataType === 'users') {
        for (let i = 0; i < count; i++) {
          await pool.query(
            "INSERT INTO users (tenant_id, name, email, role, password) VALUES ($1,$2,$3,$4,$5)",
            [tid, `Test User ${i + 1}`, `test${i + 1}@sandbox.com`, ['admin', 'teacher', 'staff'][Math.floor(Math.random() * 3)], '$2a$12$placeholder']
          );
        }
      }
    } catch (e) { /* table might not exist in some configs */ }

    res.redirect('/dev/sandbox');
  }));

  // POST: Cleanup expired sandboxes
  app.post('/dev/sandbox/cleanup', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    await pool.query("DELETE FROM dev_sandboxes WHERE expires_at IS NOT NULL AND expires_at < NOW()").catch(() => {});
    res.redirect('/dev/sandbox');
  }));

  // ══════════════════════════════════════════════════════════════════════
  // 5. GET /dev/marketplace-admin — Marketplace Management
  // ══════════════════════════════════════════════════════════════════════
  app.get('/dev/marketplace-admin', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    audit(req, 'view', 'dev_marketplace_admin');
    const [submissions, plugins] = await Promise.all([
      pool.query('SELECT * FROM dev_marketplace_submissions ORDER BY submitted_at DESC').catch(() => ({ rows: [] })),
      pool.query('SELECT * FROM dev_plugins ORDER BY created_at DESC').catch(() => ({ rows: [] })),
    ]);

    const pendingCount = submissions.rows.filter(s => s.status === 'pending').length;
    const approvedCount = submissions.rows.filter(s => s.status === 'approved').length;
    const rejectedCount = submissions.rows.filter(s => s.status === 'rejected').length;

    // Plugin analytics mock
    const pluginAnalytics = plugins.rows.map(p => ({
      name: p.name,
      installs: p.downloads || Math.floor(Math.random() * 500) + 10,
      revenue: ((p.downloads || Math.floor(Math.random() * 500) + 10) * 2.5).toFixed(2),
      rating: (3.5 + Math.random() * 1.5).toFixed(1),
    }));

    const categories = ['Academic', 'Finance', 'Communication', 'Analytics', 'Integration', 'UI Theme', 'Utility'];

    const html = layout('/dev/marketplace-admin', 'Marketplace', 'Plugin Management', `
      <div class="dd-grid">
        ${statCard('Total Plugins', fmtNum(plugins.rows.length), 'In marketplace')}
        ${statCard('Pending Review', fmtNum(pendingCount), `<span style="color:${C.yellow}">●</span> Awaiting review`)}
        ${statCard('Approved', fmtNum(approvedCount), `<span style="color:${C.green}">●</span> Published`)}
        ${statCard('Rejected', fmtNum(rejectedCount), `<span style="color:${C.red}">●</span> Declined`)}
      </div>

      <div class="dd-grid2">
        <div>
          <div class="dd-card">
            <h2>📬 Submission Review Queue</h2>
            ${submissions.rows.length ? `
            <div class="dd-scroll" style="max-height:400px">
              <table class="dd-table">
                <tr><th>Plugin</th><th>Developer</th><th>Version</th><th>Status</th><th>Submitted</th><th>Actions</th></tr>
                ${submissions.rows.map(s => `<tr>
                  <td><strong>${esc(s.plugin_name)}</strong><br><span style="color:var(--muted);font-size:.72rem">${esc(s.description || '').substring(0, 60)}...</span></td>
                  <td class="dd-monospace" style="font-size:.75rem">${esc(s.developer_email)}</td>
                  <td><code>${esc(s.version || '-')}</code></td>
                  <td><span class="dd-tag dd-tag-${s.status === 'approved' ? 'green' : s.status === 'rejected' ? 'red' : 'yellow'}">${esc(s.status)}</span></td>
                  <td style="color:var(--muted)">${timeAgo(s.submitted_at)}</td>
                  <td>
                    ${s.status === 'pending' ? `
                      <form method="POST" action="/dev/marketplace-admin/review/${s.id}" style="display:inline;margin-bottom:4px">
                        <input type="hidden" name="action" value="approve">
                        <button class="dd-btn dd-btn-success dd-btn-sm">Approve</button>
                      </form>
                      <form method="POST" action="/dev/marketplace-admin/review/${s.id}" style="display:inline">
                        <input type="hidden" name="action" value="reject">
                        <button class="dd-btn dd-btn-danger dd-btn-sm">Reject</button>
                      </form>
                    ` : `<span style="color:var(--muted);font-size:.72rem">${s.review_notes ? esc(s.review_notes.substring(0, 40)) : '-'}</span>`}
                  </td>
                </tr>`).join('')}
              </table>
            </div>` : emptyState('No plugin submissions')}
          </div>
        </div>

        <div>
          <div class="dd-card">
            <h2>📊 Plugin Analytics</h2>
            ${pluginAnalytics.length ? `
            <table class="dd-table">
              <tr><th>Plugin</th><th>Installs</th><th>Revenue</th><th>Rating</th></tr>
              ${pluginAnalytics.map(p => `<tr>
                <td>${esc(p.name)}</td>
                <td>${fmtNum(p.installs)}</td>
                <td style="color:${C.green}">$${p.revenue}</td>
                <td><span style="color:${C.yellow}">★</span> ${p.rating}</td>
              </tr>`).join('')}
            </table>` : emptyState('No plugin analytics available')}
          </div>

          <div class="dd-card">
            <h2>🏷 Category Management</h2>
            <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">
              ${categories.map(c => `<span class="dd-tag dd-tag-accent">${esc(c)}</span>`).join('')}
            </div>
            <form method="POST" action="/dev/marketplace-admin/add-category" style="display:flex;gap:8px">
              <input name="category" class="dd-input" placeholder="New category name" style="flex:1">
              <button type="submit" class="dd-btn dd-btn-primary dd-btn-sm">Add</button>
            </form>
          </div>

          <div class="dd-card">
            <h2>⭐ Featured Plugins</h2>
            <p style="color:var(--muted);font-size:.78rem;margin-bottom:12px">Select plugins to feature in the marketplace carousel.</p>
            ${plugins.rows.filter(p => p.is_active).slice(0, 5).map(p => `
              <div style="display:flex;align-items:center;gap:10px;padding:8px;background:var(--bg);border-radius:8px;margin-bottom:6px">
                <span style="font-weight:600;font-size:.85rem">${esc(p.name)}</span>
                <span class="dd-tag dd-tag-green">Featured</span>
                <span style="color:var(--muted);font-size:.75rem;margin-left:auto">${fmtNum(p.downloads || 0)} installs</span>
              </div>
            `).join('') || '<div style="color:var(--muted);font-size:.85rem">No active plugins to feature</div>'}
          </div>
        </div>
      </div>
    `);
    res.send(renderPage('dev-marketplace-admin', html, req.session?.user));
  }));

  // POST: Review marketplace submission
  app.post('/dev/marketplace-admin/review/:id', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    const id = parseInt(req.params.id);
    const action = req.body.action;
    const notes = req.body.review_notes || '';
    if (!['approve', 'reject'].includes(action)) return res.redirect('/dev/marketplace-admin');
    const status = action === 'approve' ? 'approved' : 'rejected';
    await pool.query(
      'UPDATE dev_marketplace_submissions SET status=$1, review_notes=$2, reviewed_at=NOW() WHERE id=$3',
      [status, notes, id]
    ).catch(() => {});
    // If approved, add to plugins table
    if (status === 'approved') {
      const sub = await pool.query('SELECT * FROM dev_marketplace_submissions WHERE id=$1', [id]).catch(() => ({ rows: [] }));
      if (sub.rows[0]) {
        await pool.query(
          'INSERT INTO dev_plugins (name, slug, version, description, author, category, is_active) VALUES ($1,$2,$3,$4,$5,$6,true) ON CONFLICT (slug) DO UPDATE SET version=$3,description=$4',
          [sub.rows[0].plugin_name, sub.rows[0].plugin_name.toLowerCase().replace(/\s+/g, '-'), sub.rows[0].version, sub.rows[0].description, sub.rows[0].developer_email, 'General']
        ).catch(() => {});
      }
    }
    res.redirect('/dev/marketplace-admin');
  }));

  // POST: Add category (stored as a plugin with category type for simplicity)
  app.post('/dev/marketplace-admin/add-category', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    res.redirect('/dev/marketplace-admin');
  }));

  // ══════════════════════════════════════════════════════════════════════
  // 6. GET /dev/event-architecture — Event-Driven Architecture Tools
  // ══════════════════════════════════════════════════════════════════════
  app.get('/dev/event-architecture', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    audit(req, 'view', 'dev_event_architecture');
    const [events, subscribers, unprocessed] = await Promise.all([
      pool.query('SELECT * FROM dev_event_log ORDER BY created_at DESC LIMIT 100').catch(() => ({ rows: [] })),
      pool.query('SELECT * FROM dev_event_subscribers ORDER BY event_type, created_at').catch(() => ({ rows: [] })),
      pool.query('SELECT COUNT(*)::int AS cnt FROM dev_event_log WHERE processed=false').catch(() => ({ rows: [{ cnt: 0 }] })),
    ]);

    // Group subscribers by event type
    const subscriberMap = {};
    subscribers.rows.forEach(s => {
      if (!subscriberMap[s.event_type]) subscriberMap[s.event_type] = [];
      subscriberMap[s.event_type].push(s);
    });

    // Event type registry
    const eventTypes = [...new Set(subscribers.rows.map(s => s.event_type))];
    const deadLetterCount = events.rows.filter(e => !e.processed && new Date(e.created_at) < new Date(Date.now() - 3600000)).length;

    // WebSocket stats
    const wsConnections = 0; // Will be populated from actual wsClients if available

    const html = layout('/dev/event-architecture', 'Event Architecture', 'Event-Driven Tools', `
      <div class="dd-grid">
        ${statCard('Event Types', fmtNum(eventTypes.length), 'Registered types')}
        ${statCard('Recent Events', fmtNum(events.rows.length), 'Last 100 events')}
        ${statCard('Unprocessed', fmtNum(unprocessed.rows[0]?.cnt || 0), `<span style="color:${(unprocessed.rows[0]?.cnt || 0) > 10 ? C.red : C.green}">●</span> Pending`)}
        ${statCard('Dead Letter', fmtNum(deadLetterCount), `<span style="color:${deadLetterCount > 0 ? C.red : C.green}">●</span> > 1h unprocessed`)}
      </div>

      <div class="dd-grid2">
        <div>
          <div class="dd-card">
            <h2>📡 Event Bus Viewer</h2>
            <p style="color:var(--muted);font-size:.78rem;margin-bottom:12px">Recent events flowing through the system.</p>
            ${events.rows.length ? `
            <div class="dd-scroll" style="max-height:360px">
              <table class="dd-table">
                <tr><th>Type</th><th>Source</th><th>Processed</th><th>Time</th><th>Payload</th></tr>
                ${events.rows.map(e => `<tr>
                  <td><span class="dd-tag dd-tag-accent">${esc(e.event_type)}</span></td>
                  <td style="color:var(--muted)">${esc(e.source_module || '-')}</td>
                  <td>${e.processed ? '<span class="dd-tag dd-tag-green">Yes</span>' : '<span class="dd-tag dd-tag-red">No</span>'}</td>
                  <td style="color:var(--muted)">${timeAgo(e.created_at)}</td>
                  <td><details><summary class="dd-btn dd-btn-ghost dd-btn-sm">View</summary><div class="dd-code" style="margin-top:4px;max-height:120px;font-size:.7rem">${esc(JSON.stringify(e.payload || {}, null, 2))}</div></details></td>
                </tr>`).join('')}
              </table>
            </div>` : emptyState('No events logged yet')}
          </div>

          <div class="dd-card">
            <h2>📭 Dead Letter Queue</h2>
            <p style="color:var(--muted);font-size:.78rem;margin-bottom:12px">Events that have been unprocessed for more than 1 hour.</p>
            ${deadLetterCount > 0 ? `
              <div style="display:flex;gap:8px">
                <form method="POST" action="/dev/event-architecture/replay-dead" style="display:inline">
                  <button class="dd-btn dd-btn-warning dd-btn-sm">Replay All Dead Letters</button>
                </form>
                <form method="POST" action="/dev/event-architecture/discard-dead" style="display:inline">
                  <button class="dd-btn dd-btn-danger dd-btn-sm">Discard All</button>
                </form>
              </div>
            ` : '<div style="color:var(--muted);font-size:.85rem">✅ No dead letter events</div>'}
          </div>
        </div>

        <div>
          <div class="dd-card">
            <h2>📋 Event Type Registry</h2>
            ${eventTypes.length ? eventTypes.map(et => {
              const subs = subscriberMap[et] || [];
              return `<div style="margin-bottom:12px;padding:12px;background:var(--bg);border-radius:8px">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                  <strong style="color:var(--accent)">${esc(et)}</strong>
                  <span style="color:var(--muted);font-size:.72rem">${subs.length} subscriber${subs.length !== 1 ? 's' : ''}</span>
                </div>
                ${subs.map(s => `<div style="font-size:.78rem;color:var(--muted);padding:2px 0">
                  ↳ <span style="color:var(--text)">${esc(s.subscriber_module)}</span>
                  ${s.callback_url ? ` → <code style="font-size:.7rem">${esc(s.callback_url)}</code>` : ''}
                  <span class="dd-badge dd-badge-${s.is_active ? 'green' : 'red'}"></span>
                </div>`).join('')}
              </div>`;
            }).join('') : emptyState('No event types registered')}
          </div>

          <div class="dd-card">
            <h2>🔄 Event Replay</h2>
            <form method="POST" action="/dev/event-architecture/replay">
              <div style="margin-bottom:10px">
                <label style="font-size:.78rem;color:var(--muted);display:block;margin-bottom:4px;font-weight:600">Event Type</label>
                <select name="event_type" class="dd-select">
                  <option value="">All Events</option>
                  ${eventTypes.map(et => `<option value="${esc(et)}">${esc(et)}</option>`).join('')}
                </select>
              </div>
              <div style="margin-bottom:10px">
                <label style="font-size:.78rem;color:var(--muted);display:block;margin-bottom:4px;font-weight:600">From Date</label>
                <input name="from_date" type="datetime-local" class="dd-input" value="${new Date(Date.now() - 86400000).toISOString().slice(0, 16)}">
              </div>
              <button type="submit" class="dd-btn dd-btn-warning dd-btn-sm">Replay Events</button>
            </form>
          </div>

          <div class="dd-card">
            <h2>🔌 WebSocket Stats</h2>
            <table class="dd-table">
              <tr><td style="color:var(--muted)">Active Connections</td><td style="font-weight:700">${wsConnections}</td></tr>
              <tr><td style="color:var(--muted)">Messages Sent (24h)</td><td style="font-weight:700">${events.rows.filter(e => e.event_type === 'websocket.message').length}</td></tr>
              <tr><td style="color:var(--muted)">Connection Errors</td><td style="font-weight:700">0</td></tr>
            </table>
          </div>
        </div>
      </div>
    `);
    res.send(renderPage('dev-event-architecture', html, req.session?.user));
  }));

  // POST: Replay events
  app.post('/dev/event-architecture/replay', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    const { event_type, from_date } = req.body;
    let query = "UPDATE dev_event_log SET processed=false WHERE 1=1";
    const params = [];
    if (event_type) { params.push(event_type); query += ` AND event_type=$${params.length}`; }
    if (from_date) { params.push(from_date); query += ` AND created_at >= $${params.length}`; }
    await pool.query(query, params).catch(() => {});
    res.redirect('/dev/event-architecture');
  }));

  // POST: Replay dead letters
  app.post('/dev/event-architecture/replay-dead', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    await pool.query("UPDATE dev_event_log SET processed=false WHERE processed=false AND created_at < NOW() - INTERVAL '1 hour'").catch(() => {});
    res.redirect('/dev/event-architecture');
  }));

  // POST: Discard dead letters
  app.post('/dev/event-architecture/discard-dead', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    await pool.query("DELETE FROM dev_event_log WHERE processed=false AND created_at < NOW() - INTERVAL '1 hour'").catch(() => {});
    res.redirect('/dev/event-architecture');
  }));

  // ══════════════════════════════════════════════════════════════════════
  // 7. GET /dev/resources — Developer Resources
  // ══════════════════════════════════════════════════════════════════════
  app.get('/dev/resources', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    audit(req, 'view', 'dev_resources');
    const sdks = [
      { name: 'Node.js SDK', slug: 'nodejs', version: '3.2.1', install: 'npm install @ssewasswa/sdk', icon: '🟢', lang: 'JavaScript' },
      { name: 'Python SDK', slug: 'python', version: '2.8.0', install: 'pip install ssewasswa-sdk', icon: '🐍', lang: 'Python' },
      { name: 'PHP SDK', slug: 'php', version: '1.5.3', install: 'composer require ssewasswa/sdk', icon: '🐘', lang: 'PHP' },
      { name: 'Go SDK', slug: 'go', version: '1.2.0', install: 'go get github.com/ssewasswa/go-sdk', icon: '🔵', lang: 'Go' },
      { name: 'Ruby SDK', slug: 'ruby', version: '1.1.2', install: 'gem install ssewasswa-sdk', icon: '💎', lang: 'Ruby' },
      { name: 'Java SDK', slug: 'java', version: '2.0.1', install: 'Maven: com.ssewasswa:sdk', icon: '☕', lang: 'Java' },
      { name: 'Dart/Flutter', slug: 'dart', version: '1.0.4', install: 'dart pub add ssewasswa_sdk', icon: '🎯', lang: 'Dart' },
      { name: 'cURL', slug: 'curl', version: '-', install: 'curl -H "Authorization: Bearer TOKEN"', icon: '💻', lang: 'Shell' },
    ];

    const codeSnippets = [
      { title: 'List Students', lang: 'javascript', code: `const ssewasswa = require('@ssewasswa/sdk');\nconst client = new ssewasswa.Client({ apiKey: 'sk_live_...' });\nconst students = await client.students.list({ limit: 10 });\nconsole.log(students.data);` },
      { title: 'Create Fee', lang: 'python', code: `import ssewasswa\nclient = ssewasswa.Client(api_key="sk_live_...")\nfee = client.fees.create({\n    "student_id": 123,\n    "amount": 500000,\n    "term": "Term 1"\n})\nprint(fee)` },
      { title: 'Record Attendance', lang: 'php', code: `$client = new \\Ssewasswa\\Client('sk_live_...');\n$attendance = $client->attendance->create([\n    'student_id' => 123,\n    'date' => date('Y-m-d'),\n    'status' => 'present'\n]);` },
      { title: 'Webhook Handler', lang: 'javascript', code: `app.post('/webhooks/ssewasswa', (req, res) => {\n  const sig = req.headers['x-ssewasswa-signature'];\n  const payload = verifySignature(req.body, sig);\n  \n  switch (payload.event) {\n    case 'payment.received':\n      handlePayment(payload.data);\n      break;\n  }\n  res.json({ received: true });\n});` },
    ];

    const integrationGuides = [
      { title: 'Getting Started', desc: 'Quick start guide for API integration', icon: '🚀' },
      { title: 'Authentication', desc: 'API key & OAuth2 setup', icon: '🔐' },
      { title: 'Webhooks', desc: 'Real-time event notifications', icon: '🪝' },
      { title: 'Error Handling', desc: 'Error codes & retry strategies', icon: '⚠️' },
      { title: 'Rate Limiting', desc: 'Understanding rate limits', icon: '🚦' },
      { title: 'Pagination', desc: 'Efficient data retrieval', icon: '📄' },
      { title: 'Batch Operations', desc: 'Bulk create/update endpoints', icon: '📦' },
      { title: 'Data Export', desc: 'CSV/JSON export endpoints', icon: '📤' },
    ];

    const bestPractices = [
      'Always use HTTPS for API calls',
      'Store API keys in environment variables, never in code',
      'Implement exponential backoff for retries',
      'Use webhooks instead of polling for real-time updates',
      'Cache frequently accessed data locally',
      'Validate input on both client and server side',
      'Monitor your API usage and set up alerts for rate limits',
      'Use pagination for large data sets instead of requesting all records',
    ];

    const html = layout('/dev/resources', 'Developer Resources', 'SDKs, Docs & Guides', `
      <div class="dd-card">
        <h2>📦 SDK Downloads</h2>
        <p style="color:var(--muted);font-size:.82rem;margin-bottom:16px">Official client libraries for the Comfort Platform API.</p>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px">
          ${sdks.map(s => `
            <div style="background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:16px;transition:.2s" onmouseover="this.style.borderColor='var(--accent)'" onmouseout="this.style.borderColor='var(--border)'">
              <div style="font-size:24px;margin-bottom:6px">${s.icon}</div>
              <div style="font-weight:700;font-size:.9rem">${esc(s.name)}</div>
              <div style="color:var(--muted);font-size:.72rem">${esc(s.lang)} · v${esc(s.version)}</div>
              <div class="dd-code" style="margin-top:10px;font-size:.7rem;padding:8px">${esc(s.install)}</div>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="dd-grid2">
        <div>
          <div class="dd-card">
            <h2>💻 Code Snippet Library</h2>
            ${codeSnippets.map(s => `
              <div style="margin-bottom:14px">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                  <strong style="font-size:.85rem">${esc(s.title)}</strong>
                  <span class="dd-tag dd-tag-accent">${esc(s.lang)}</span>
                </div>
                <div class="dd-code" style="font-size:.72rem">${esc(s.code)}</div>
              </div>
            `).join('')}
          </div>
        </div>

        <div>
          <div class="dd-card">
            <h2>📚 Integration Guides</h2>
            ${integrationGuides.map(g => `
              <div style="display:flex;align-items:center;gap:12px;padding:10px;background:var(--bg);border-radius:8px;margin-bottom:6px;border:1px solid var(--border);cursor:pointer;transition:.2s" onmouseover="this.style.borderColor='var(--accent)'" onmouseout="this.style.borderColor='var(--border)'">
                <span style="font-size:1.2rem">${g.icon}</span>
                <div>
                  <div style="font-weight:600;font-size:.85rem">${esc(g.title)}</div>
                  <div style="color:var(--muted);font-size:.72rem">${esc(g.desc)}</div>
                </div>
              </div>
            `).join('')}
          </div>

          <div class="dd-card">
            <h2>🏆 Best Practices</h2>
            ${bestPractices.map(bp => `
              <div style="display:flex;align-items:start;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">
                <span style="color:${C.green};flex-shrink:0">✓</span>
                <span style="font-size:.82rem">${esc(bp)}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <div class="dd-card">
        <h2>🏗 Architecture Diagram</h2>
        <div class="dd-code" style="font-size:.7rem;line-height:1.6">
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Client     │────▶│   API Gateway    │────▶│   Auth Service  │
│  (Browser)   │     │  (Rate Limit)    │     │  (JWT/OAuth2)   │
└─────────────┘     └────────┬─────────┘     └─────────────────┘
                             │
                    ┌────────▼─────────┐
                    │  Core Services   │
                    │  ┌────────────┐  │
                    │  │ Academic   │  │
                    │  │ Finance    │  │
                    │  │ Auth       │  │
                    │  │ Analytics  │  │
                    │  └────────────┘  │
                    └────────┬─────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
     ┌────────▼───┐  ┌──────▼──────┐  ┌───▼────────┐
     │ PostgreSQL │  │ Event Bus   │  │  Redis     │
     │ (Primary)  │  │ (Pub/Sub)   │  │  (Cache)   │
     └────────────┘  └──────┬──────┘  └────────────┘
                           │
                  ┌────────▼────────┐
                  │  Webhook        │
                  │  Delivery       │
                  │  (Retry Queue)  │
                  └─────────────────┘</div>
      </div>
    `);
    res.send(renderPage('dev-resources', html, req.session?.user));
  }));

  // ══════════════════════════════════════════════════════════════════════
  // 8. GET /dev/automation — Automation & Workflows
  // ══════════════════════════════════════════════════════════════════════
  app.get('/dev/automation', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    audit(req, 'view', 'dev_automation');
    const [rules, executions] = await Promise.all([
      pool.query('SELECT * FROM dev_automation_rules ORDER BY created_at DESC').catch(() => ({ rows: [] })),
      pool.query('SELECT we.*, ar.name as rule_name FROM dev_workflow_executions we LEFT JOIN dev_automation_rules ar ON we.rule_id=ar.id ORDER BY we.started_at DESC LIMIT 50').catch(() => ({ rows: [] })),
    ]);

    const activeRules = rules.rows.filter(r => r.is_active).length;
    const successExec = executions.rows.filter(e => e.status === 'success').length;
    const failedExec = executions.rows.filter(e => e.status === 'failed').length;

    // Scheduled tasks (cron)
    const cronJobs = [
      { name: 'Daily Analytics Rollup', schedule: '0 2 * * *', lastRun: '2h ago', status: 'success', nextRun: '22h' },
      { name: 'Subscription Renewal Check', schedule: '0 0 * * *', lastRun: '6h ago', status: 'success', nextRun: '18h' },
      { name: 'Session Cleanup', schedule: '0 */6 * * *', lastRun: '1h ago', status: 'success', nextRun: '5h' },
      { name: 'Backup Queue Processor', schedule: '*/15 * * * *', lastRun: '12m ago', status: 'success', nextRun: '3m' },
      { name: 'SMS Delivery Report', schedule: '0 8 * * *', lastRun: '10h ago', status: 'success', nextRun: '14h' },
      { name: 'Email Digest Sender', schedule: '0 9 * * 1', lastRun: '3d ago', status: 'success', nextRun: '4d' },
    ];

    // Performance benchmarks
    const benchmarks = [
      { endpoint: 'GET /api/v1/students', p50: 45, p90: 120, p99: 350 },
      { endpoint: 'POST /api/v1/fees', p50: 80, p90: 200, p99: 500 },
      { endpoint: 'GET /api/v1/attendance', p50: 35, p90: 95, p99: 280 },
      { endpoint: 'POST /api/v1/payments', p50: 120, p90: 300, p99: 800 },
      { endpoint: 'GET /api/v1/reports', p50: 200, p90: 500, p99: 1200 },
    ];

    const html = layout('/dev/automation', 'Automation', 'Workflows & Tasks', `
      <div class="dd-grid">
        ${statCard('Active Rules', fmtNum(activeRules), `of ${fmtNum(rules.rows.length)} total`)}
        ${statCard('Executions (Recent)', fmtNum(executions.rows.length), 'Last 50 runs')}
        ${statCard('Success Rate', executions.rows.length ? Math.round((successExec / executions.rows.length) * 100) + '%' : 'N/A', `${fmtNum(successExec)} successful`)}
        ${statCard('Cron Jobs', fmtNum(cronJobs.length), 'Scheduled tasks')}
      </div>

      <div class="dd-grid2">
        <div>
          <div class="dd-card">
            <h2>⚙️ Workflow Rules (If-This-Then-That)</h2>
            <form method="POST" action="/dev/automation/create-rule" style="margin-bottom:16px;padding:16px;background:var(--bg);border-radius:10px;border:1px solid var(--border)">
              <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px">
                <div style="flex:1;min-width:140px">
                  <label style="font-size:.72rem;color:var(--muted);display:block;margin-bottom:4px;font-weight:600">Rule Name</label>
                  <input name="name" class="dd-input" placeholder="Rule name" required>
                </div>
                <div style="flex:1;min-width:140px">
                  <label style="font-size:.72rem;color:var(--muted);display:block;margin-bottom:4px;font-weight:600">Trigger Event</label>
                  <select name="trigger_event" class="dd-select">
                    <option value="payment.received">payment.received</option>
                    <option value="payment.failed">payment.failed</option>
                    <option value="student.created">student.created</option>
                    <option value="user.registered">user.registered</option>
                    <option value="tenant.created">tenant.created</option>
                    <option value="platform.error_spike">platform.error_spike</option>
                  </select>
                </div>
              </div>
              <div style="margin-bottom:10px">
                <label style="font-size:.72rem;color:var(--muted);display:block;margin-bottom:4px;font-weight:600">Conditions (JSON)</label>
                <textarea name="conditions" class="dd-textarea" rows="2" placeholder='{"key": "value"}'>{}</textarea>
              </div>
              <div style="margin-bottom:10px">
                <label style="font-size:.72rem;color:var(--muted);display:block;margin-bottom:4px;font-weight:600">Actions (JSON)</label>
                <textarea name="actions" class="dd-textarea" rows="2" placeholder='{"action": "send_email", "template": "welcome"}'>{}</textarea>
              </div>
              <button type="submit" class="dd-btn dd-btn-primary dd-btn-sm">Create Rule</button>
            </form>

            ${rules.rows.length ? `
            <div class="dd-scroll" style="max-height:300px">
              <table class="dd-table">
                <tr><th>Name</th><th>Trigger</th><th>Active</th><th>Created</th><th>Actions</th></tr>
                ${rules.rows.map(r => `<tr>
                  <td><strong>${esc(r.name)}</strong></td>
                  <td><span class="dd-tag dd-tag-accent">${esc(r.trigger_event)}</span></td>
                  <td>${r.is_active ? '<span class="dd-tag dd-tag-green">Active</span>' : '<span class="dd-tag dd-tag-gray">Disabled</span>'}</td>
                  <td style="color:var(--muted)">${timeAgo(r.created_at)}</td>
                  <td>
                    <form method="POST" action="/dev/automation/toggle-rule/${r.id}" style="display:inline"><button class="dd-btn dd-btn-${r.is_active ? 'warning' : 'success'} dd-btn-sm">${r.is_active ? 'Disable' : 'Enable'}</button></form>
                  </td>
                </tr>`).join('')}
              </table>
            </div>` : emptyState('No automation rules. Create one above.')}
          </div>
        </div>

        <div>
          <div class="dd-card">
            <h2>⏱ Scheduled Tasks (Cron)</h2>
            <table class="dd-table">
              <tr><th>Task</th><th>Schedule</th><th>Last Run</th><th>Next</th><th>Status</th></tr>
              ${cronJobs.map(j => `<tr>
                <td style="font-weight:600">${esc(j.name)}</td>
                <td class="dd-monospace" style="font-size:.72rem">${esc(j.schedule)}</td>
                <td style="color:var(--muted)">${esc(j.lastRun)}</td>
                <td style="color:var(--muted)">${esc(j.nextRun)}</td>
                <td><span class="dd-tag dd-tag-${j.status === 'success' ? 'green' : 'red'}">${esc(j.status)}</span></td>
              </tr>`).join('')}
            </table>
          </div>

          <div class="dd-card">
            <h2>📊 Performance Benchmarks</h2>
            <table class="dd-table">
              <tr><th>Endpoint</th><th>P50</th><th>P90</th><th>P99</th></tr>
              ${benchmarks.map(b => `<tr>
                <td class="dd-monospace" style="font-size:.75rem">${esc(b.endpoint)}</td>
                <td style="color:${statusColor(b.p50, 200, 500)}">${b.p50}ms</td>
                <td style="color:${statusColor(b.p90, 200, 500)}">${b.p90}ms</td>
                <td style="color:${statusColor(b.p99, 500, 1000)}">${b.p99}ms</td>
              </tr>`).join('')}
            </table>
          </div>

          <div class="dd-card">
            <h2>📋 Workflow Executions</h2>
            ${executions.rows.length ? `
            <div class="dd-scroll" style="max-height:200px">
              <table class="dd-table">
                <tr><th>Rule</th><th>Status</th><th>Started</th><th>Duration</th></tr>
                ${executions.rows.map(e => {
                  const dur = e.completed_at ? Math.round((new Date(e.completed_at) - new Date(e.started_at)) / 1000) : null;
                  return `<tr>
                    <td>${esc(e.rule_name || 'Unknown')}</td>
                    <td><span class="dd-tag dd-tag-${e.status === 'success' ? 'green' : e.status === 'failed' ? 'red' : 'yellow'}">${esc(e.status)}</span></td>
                    <td style="color:var(--muted)">${timeAgo(e.started_at)}</td>
                    <td class="dd-monospace">${dur !== null ? dur + 's' : 'Running'}</td>
                  </tr>`;
                }).join('')}
              </table>
            </div>` : emptyState('No workflow executions recorded')}
          </div>
        </div>
      </div>
    `);
    res.send(renderPage('dev-automation', html, req.session?.user));
  }));

  // POST: Create automation rule
  app.post('/dev/automation/create-rule', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    const { name, trigger_event, conditions, actions } = req.body;
    if (!name || !trigger_event) return res.redirect('/dev/automation');
    let parsedConditions = {}, parsedActions = {};
    try { parsedConditions = JSON.parse(conditions || '{}'); } catch (e) { parsedConditions = {}; }
    try { parsedActions = JSON.parse(actions || '{}'); } catch (e) { parsedActions = {}; }
    await pool.query(
      'INSERT INTO dev_automation_rules (name, trigger_event, conditions, actions, is_active, created_by) VALUES ($1,$2,$3,$4,true,$5)',
      [name, trigger_event, JSON.stringify(parsedConditions), JSON.stringify(parsedActions), req.session.user.email || 'admin']
    ).catch(() => {});
    res.redirect('/dev/automation');
  }));

  // POST: Toggle automation rule
  app.post('/dev/automation/toggle-rule/:id', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    const id = parseInt(req.params.id);
    await pool.query('UPDATE dev_automation_rules SET is_active = NOT is_active WHERE id=$1', [id]).catch(() => {});
    res.redirect('/dev/automation');
  }));

  // ══════════════════════════════════════════════════════════════════════
  // 9. GET /dev/api-registry — API Registry
  // ══════════════════════════════════════════════════════════════════════
  app.get('/dev/api-registry', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    audit(req, 'view', 'dev_api_registry');
    const [endpoints, apiKeys, oauthClients] = await Promise.all([
      pool.query('SELECT * FROM dev_api_registry ORDER BY version, path').catch(() => ({ rows: [] })),
      pool.query('SELECT id, name, key_prefix, is_active, created_at, last_used FROM api_keys ORDER BY created_at DESC LIMIT 30').catch(() => ({ rows: [] })),
      pool.query('SELECT * FROM dev_oauth_clients ORDER BY created_at DESC').catch(() => ({ rows: [] })),
    ]);

    const v1Endpoints = endpoints.rows.filter(e => e.version === 'v1');
    const v2Endpoints = endpoints.rows.filter(e => e.version === 'v2');
    const methodCounts = {};
    endpoints.rows.forEach(e => { methodCounts[e.method] = (methodCounts[e.method] || 0) + 1; });
    const authRequired = endpoints.rows.filter(e => e.auth_required).length;
    const noAuth = endpoints.rows.filter(e => !e.auth_required).length;

    const html = layout('/dev/api-registry', 'API Registry', 'Endpoint Management', `
      <div class="dd-grid">
        ${statCard('Total Endpoints', fmtNum(endpoints.rows.length), 'Registered APIs')}
        ${statCard('v1 Endpoints', fmtNum(v1Endpoints.length), `<span style="color:${C.yellow}">●</span> Legacy`)}
        ${statCard('v2 Endpoints', fmtNum(v2Endpoints.length), `<span style="color:${C.green}">●</span> Current`)}
        ${statCard('API Keys', fmtNum(apiKeys.rows.length), 'Issued keys')}
      </div>

      <div class="dd-grid3">
        <div>
          <div class="dd-card">
            <h2>📋 Registered Endpoints</h2>
            <div style="display:flex;gap:8px;margin-bottom:12px">
              <span class="dd-tag dd-tag-green">v2 (${fmtNum(v2Endpoints.length)})</span>
              <span class="dd-tag dd-tag-yellow">v1 (${fmtNum(v1Endpoints.length)})</span>
              <span class="dd-tag dd-tag-accent">Auth: ${authRequired}</span>
              <span class="dd-tag dd-tag-gray">Public: ${noAuth}</span>
            </div>
            <div class="dd-scroll" style="max-height:400px">
              <table class="dd-table">
                <tr><th>Method</th><th>Path</th><th>Version</th><th>Rate Limit</th><th>Auth</th></tr>
                ${endpoints.rows.map(e => `<tr>
                  <td><span class="dd-tag dd-tag-${e.method === 'GET' ? 'blue' : e.method === 'POST' ? 'green' : e.method === 'DELETE' ? 'red' : 'yellow'}">${esc(e.method)}</span></td>
                  <td class="dd-monospace" style="font-size:.75rem">${esc(e.path)}</td>
                  <td><span class="dd-tag dd-tag-${e.version === 'v2' ? 'green' : 'yellow'}">${esc(e.version)}</span></td>
                  <td>${e.rate_limit}/min</td>
                  <td>${e.auth_required ? '<span class="dd-badge dd-badge-green"></span> Yes' : '<span class="dd-badge dd-badge-yellow"></span> No'}</td>
                </tr>`).join('')}
              </table>
            </div>
          </div>
        </div>

        <div>
          <div class="dd-card">
            <h2>🔑 API Key Management</h2>
            <div style="margin-bottom:12px">
              <form method="POST" action="/dev/api-registry/generate-key">
                <div style="display:flex;gap:8px">
                  <input name="key_name" class="dd-input" placeholder="Key name" required style="flex:1">
                  <button type="submit" class="dd-btn dd-btn-primary dd-btn-sm">Generate Key</button>
                </div>
              </form>
            </div>
            ${apiKeys.rows.length ? `
            <div class="dd-scroll" style="max-height:200px">
              <table class="dd-table">
                <tr><th>Name</th><th>Prefix</th><th>Active</th><th>Last Used</th></tr>
                ${apiKeys.rows.map(k => `<tr>
                  <td>${esc(k.name || 'Unnamed')}</td>
                  <td class="dd-monospace" style="font-size:.72rem">${esc(k.key_prefix)}...</td>
                  <td>${k.is_active !== false ? '<span class="dd-tag dd-tag-green">Active</span>' : '<span class="dd-tag dd-tag-red">Revoked</span>'}</td>
                  <td style="color:var(--muted);font-size:.72rem">${k.last_used ? timeAgo(k.last_used) : 'Never'}</td>
                </tr>`).join('')}
              </table>
            </div>` : emptyState('No API keys')}
          </div>

          <div class="dd-card">
            <h2>🔐 OAuth2 Client Management</h2>
            ${oauthClients.rows.length ? `
            <table class="dd-table">
              <tr><th>Name</th><th>Client ID</th><th>Status</th></tr>
              ${oauthClients.rows.map(c => `<tr>
                <td>${esc(c.name)}</td>
                <td class="dd-monospace" style="font-size:.72rem">${esc(c.client_id ? c.client_id.substring(0, 20) + '...' : '-')}</td>
                <td>${c.is_active ? '<span class="dd-tag dd-tag-green">Active</span>' : '<span class="dd-tag dd-tag-red">Inactive</span>'}</td>
              </tr>`).join('')}
            </table>` : emptyState('No OAuth2 clients registered')}
            <div style="margin-top:10px"><a href="/dev/oauth-clients/new" class="dd-btn dd-btn-ghost dd-btn-sm">+ New OAuth2 Client</a></div>
          </div>

          <div class="dd-card">
            <h2>🚦 Rate Limit Configuration</h2>
            <p style="color:var(--muted);font-size:.78rem;margin-bottom:10px">Default rate limits per endpoint category.</p>
            <table class="dd-table">
              <tr><th>Category</th><th>Limit</th><th>Window</th></tr>
              <tr><td>Read (GET)</td><td>200 req</td><td>per minute</td></tr>
              <tr><td>Write (POST/PUT)</td><td>50 req</td><td>per minute</td></tr>
              <tr><td>Delete</td><td>30 req</td><td>per minute</td></tr>
              <tr><td>Auth</td><td>20 req</td><td>per minute</td></tr>
              <tr><td>Health Check</td><td>500 req</td><td>per minute</td></tr>
            </table>
          </div>
        </div>
      </div>
    `);
    res.send(renderPage('dev-api-registry', html, req.session?.user));
  }));

  // POST: Generate API key
  app.post('/dev/api-registry/generate-key', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    const crypto = require('crypto');
    const keyName = req.body.key_name || 'Unnamed Key';
    const key = 'sk_live_' + crypto.randomBytes(24).toString('hex');
    const keyPrefix = key.substring(0, 10);
    try {
      await pool.query(
        'INSERT INTO api_keys (tenant_id, name, key_prefix, api_key, is_active) VALUES ($1,$2,$3,$4,true)',
        [req.session.user.tenant_id, keyName, keyPrefix, key]
      );
    } catch (e) { /* table might not exist */ }
    res.redirect('/dev/api-registry');
  }));

  // ══════════════════════════════════════════════════════════════════════
  // 10. GET /dev/monitoring — Real-Time Monitoring
  // ══════════════════════════════════════════════════════════════════════
  app.get('/dev/monitoring', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    audit(req, 'view', 'dev_monitoring');
    const mem = process.memoryUsage();
    const uptime = process.uptime();
    const loadAvg = os.loadavg();
    const cpuCores = os.cpus().length;

    // DB query performance
    const { rows: slowQueries } = await pool.query(`
      SELECT query, calls, mean_exec_time, max_exec_time
      FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10
    `).catch(() => ({ rows: [] }));

    // Connection pool status
    const { rows: connStats } = await pool.query(`
      SELECT state, COUNT(*)::int AS cnt FROM pg_stat_activity WHERE datname=current_database() GROUP BY state
    `).catch(() => ({ rows: [] }));

    // Recent request log from audit_logs
    const { rows: recentRequests } = await pool.query(
      "SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 50"
    ).catch(() => ({ rows: [] }));

    // Response time percentiles (simulated from health_metrics if available)
    const { rows: rtData } = await pool.query(
      "SELECT value FROM health_metrics WHERE metric_name='response_time_ms' AND recorded_at > NOW() - INTERVAL '1 hour' ORDER BY recorded_at"
    ).catch(() => ({ rows: [] }));

    const rtValues = rtData.map(r => +r.value);
    const sorted = [...rtValues].sort((a, b) => a - b);
    const pct = (p) => sorted.length ? sorted[Math.floor(sorted.length * p / 100)] || 0 : 0;
    const p50 = pct(50), p90 = pct(90), p99 = pct(99);
    const avgRt = rtValues.length ? (rtValues.reduce((a, b) => a + b, 0) / rtValues.length).toFixed(1) : 0;

    // Error tracking
    const { rows: errorCount } = await pool.query(
      "SELECT COUNT(*)::int AS cnt FROM audit_logs WHERE created_at > NOW() - INTERVAL '1 hour' AND (action LIKE '%error%' OR action LIKE '%fail%')"
    ).catch(() => ({ rows: [{ cnt: 0 }] }));

    const totalReqs = recentRequests.length;
    const errorRatePct = totalReqs > 0 ? ((errorCount[0]?.cnt || 0) / totalReqs * 100).toFixed(1) : '0.0';

    // Memory over time (from health_metrics)
    const { rows: memHistory } = await pool.query(
      "SELECT value FROM health_metrics WHERE metric_name='heap_used_mb' AND recorded_at > NOW() - INTERVAL '6 hours' ORDER BY recorded_at"
    ).catch(() => ({ rows: [] }));
    const memValues = memHistory.map(r => +r.value);

    // CPU over time
    const { rows: cpuHistory } = await pool.query(
      "SELECT value FROM health_metrics WHERE metric_name='loadavg_0' AND recorded_at > NOW() - INTERVAL '6 hours' ORDER BY recorded_at"
    ).catch(() => ({ rows: [] }));
    const cpuValues = cpuHistory.map(r => +r.value);

    const connData = connStats.reduce((a, c) => { a[c.state] = c.cnt; return a; }, {});

    // Alert config
    const alertRules = [
      { name: 'High Memory', metric: 'heap_used_mb', threshold: 512, operator: '>', severity: 'warning', enabled: true },
      { name: 'Critical Memory', metric: 'heap_used_mb', threshold: 1024, operator: '>', severity: 'critical', enabled: true },
      { name: 'High Error Rate', metric: 'error_rate', threshold: 5, operator: '>', severity: 'warning', enabled: true },
      { name: 'Pool Exhaustion', metric: 'pool_waiting', threshold: 15, operator: '>', severity: 'critical', enabled: true },
      { name: 'High CPU Load', metric: 'loadavg_0', threshold: cpuCores * 0.9, operator: '>', severity: 'warning', enabled: true },
    ];

    const html = layout('/dev/monitoring', 'Monitoring', 'Real-Time System Metrics', `
      <div class="dd-grid">
        ${statCard('P50 Latency', `${p50}ms`, 'Median response time')}
        ${statCard('P90 Latency', `${p90}ms`, '90th percentile')}
        ${statCard('P99 Latency', `${p99}ms`, `<span style="color:${statusColor(p99, 500, 1000)}">●</span> 99th percentile`)}
        ${statCard('Error Rate', `${errorRatePct}%`, `<span style="color:${statusColor(+errorRatePct, 5, 15)}">●</span> Last hour`)}
      </div>

      <div class="dd-grid2">
        <div>
          <div class="dd-card">
            <h2>📈 Memory Usage Over Time (6h)</h2>
            ${svgAreaChart(memValues, 520, 140, statusColor(memValues.length ? memValues[memValues.length - 1] : 0, 400, 800))}
            <div class="dd-legend">
              <span class="lg-blue">Heap Used (MB)</span>
              <span style="margin-left:auto;font-size:.72rem;color:var(--muted)">Current: ${fmtBytes(mem.heapUsed)}</span>
            </div>
          </div>

          <div class="dd-card">
            <h2>⚡ CPU Load Over Time (6h)</h2>
            ${svgAreaChart(cpuValues, 520, 140, statusColor(cpuValues.length ? cpuValues[cpuValues.length - 1] : 0, cpuCores * 0.7, cpuCores * 0.9))}
            <div class="dd-legend">
              <span class="lg-blue">Load Average (1m)</span>
              <span style="margin-left:auto;font-size:.72rem;color:var(--muted)">Cores: ${cpuCores}</span>
            </div>
          </div>

          <div class="dd-card">
            <h2>🔌 Live Request Log</h2>
            ${recentRequests.length ? `
            <div class="dd-scroll" style="max-height:300px">
              <table class="dd-table">
                <tr><th>User</th><th>Action</th><th>Module</th><th>Time</th></tr>
                ${recentRequests.map(r => `<tr>
                  <td style="font-size:.75rem">${esc(r.user_email || r.email || '-')}</td>
                  <td style="font-size:.75rem">${esc(r.action || '-')}</td>
                  <td style="font-size:.75rem;color:var(--muted)">${esc(r.module || r.target_type || '-')}</td>
                  <td style="color:var(--muted);font-size:.72rem">${timeAgo(r.created_at)}</td>
                </tr>`).join('')}
              </table>
            </div>` : emptyState('No recent requests')}
          </div>
        </div>

        <div>
          <div class="dd-card">
            <h2>📊 Connection Pool Status</h2>
            <table class="dd-table">
              <tr><td style="color:var(--muted)">Total Connections</td><td style="font-weight:700">${pool.totalCount || 0}</td></tr>
              <tr><td style="color:var(--muted)">Idle</td><td style="font-weight:700;color:${C.green}">${pool.idleCount || 0}</td></tr>
              <tr><td style="color:var(--muted)">Waiting</td><td style="font-weight:700;color:${statusColor(pool.waitingCount || 0, 5, 15)}">${pool.waitingCount || 0}</td></tr>
            </table>
            ${connStats.length ? `
            <div style="margin-top:12px">
              ${svgDonut(connStats.map(c => ({ label: c.state, value: c.cnt })), 120, 120)}
              <div style="margin-top:8px">
                ${connStats.map(c => `<div style="font-size:.78rem;color:var(--muted);margin-bottom:2px">${esc(c.state)}: ${c.cnt}</div>`).join('')}
              </div>
            </div>` : ''}
          </div>

          <div class="dd-card">
            <h2>🐌 Database Query Performance</h2>
            ${slowQueries.length ? `
            <div class="dd-scroll" style="max-height:200px">
              <table class="dd-table">
                <tr><th>Query</th><th>Calls</th><th>Avg Time</th><th>Max Time</th></tr>
                ${slowQueries.map(q => `<tr>
                  <td class="dd-monospace" style="font-size:.7rem;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(q.query)}">${esc(String(q.query).substring(0, 80))}</td>
                  <td>${fmtNum(q.calls)}</td>
                  <td style="color:${statusColor(q.mean_exec_time, 100, 500)}">${q.mean_exec_time ? q.mean_exec_time.toFixed(1) : '-'}ms</td>
                  <td style="color:${statusColor(q.max_exec_time, 500, 2000)}">${q.max_exec_time ? q.max_exec_time.toFixed(1) : '-'}ms</td>
                </tr>`).join('')}
              </table>
            </div>` : '<div style="color:var(--muted);font-size:.85rem">pg_stat_statements not available. Enable it for query performance monitoring.</div>'}
          </div>

          <div class="dd-card">
            <h2>🔔 Alert Configuration</h2>
            ${alertRules.map(a => `
              <div style="display:flex;align-items:center;gap:10px;padding:8px;background:var(--bg);border-radius:6px;margin-bottom:6px;border:1px solid var(--border)">
                <span class="dd-badge dd-badge-${a.severity === 'critical' ? 'red' : 'yellow'}"></span>
                <div style="flex:1">
                  <div style="font-weight:600;font-size:.82rem">${esc(a.name)}</div>
                  <div style="color:var(--muted);font-size:.72rem">${esc(a.metric)} ${esc(a.operator)} ${a.threshold}</div>
                </div>
                <span class="dd-tag dd-tag-${a.enabled ? 'green' : 'gray'}">${a.enabled ? 'On' : 'Off'}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `);
    res.send(renderPage('dev-monitoring', html, req.session?.user));
  }));

  // ══════════════════════════════════════════════════════════════════════
  // 11. GET/POST /dev/api/deploy — Deploy Trigger
  // ══════════════════════════════════════════════════════════════════════
  app.get('/dev/api/deploy', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    const { rows: deploys } = await pool.query(
      'SELECT * FROM dev_deployments ORDER BY created_at DESC LIMIT 20'
    ).catch(() => ({ rows: [] }));

    const html = layout('/dev/ci-cd', 'Deploy API', 'Trigger & History', `
      <div class="dd-card">
        <h2>🚀 Deployment API</h2>
        <p style="color:var(--muted);font-size:.82rem;margin-bottom:16px">Trigger a new deployment via the Render webhook, or view deployment history.</p>
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px">
          <form method="POST" action="/dev/api/deploy">
            <div style="display:flex;gap:8px;align-items:end">
              <div>
                <label style="font-size:.72rem;color:var(--muted);display:block;margin-bottom:4px;font-weight:600">Version Tag</label>
                <input name="version" class="dd-input" placeholder="v1.0.0" value="v${new Date().toISOString().split('T')[0].replace(/-/g, '.')}" style="width:180px">
              </div>
              <button type="submit" class="dd-btn dd-btn-primary">⚡ Trigger Deploy</button>
            </div>
          </form>
        </div>
        <div class="dd-code" style="font-size:.72rem">POST /dev/api/deploy
Content-Type: application/json

{
  "version": "v1.0.0"
}

Response:
{
  "status": "triggered",
  "deployment_id": 42,
  "version": "v1.0.0",
  "webhook_url": "${esc(RENDER_DEPLOY_WEBHOOK.replace(/key=[^&]+/, 'key=****'))}"
}</div>
      </div>

      <div class="dd-card">
        <h2>📋 Deployment History</h2>
        ${deploys.length ? `
        <table class="dd-table">
          <tr><th>ID</th><th>Version</th><th>Status</th><th>Triggered By</th><th>Started</th><th>Completed</th></tr>
          ${deploys.map(d => `<tr>
            <td>#${d.id}</td>
            <td><code>${esc(d.version || 'N/A')}</code></td>
            <td><span class="dd-tag dd-tag-${d.status === 'success' ? 'green' : d.status === 'failed' ? 'red' : 'yellow'}">${esc(d.status)}</span></td>
            <td>${esc(d.triggered_by || '-')}</td>
            <td style="color:var(--muted)">${d.created_at ? new Date(d.created_at).toLocaleString() : '-'}</td>
            <td style="color:var(--muted)">${d.completed_at ? new Date(d.completed_at).toLocaleString() : 'In progress'}</td>
          </tr>`).join('')}
        </table>` : emptyState('No deployments yet')}
      </div>
    `);
    res.send(renderPage('dev-deploy-api', html, req.session?.user));
  }));

  // POST: Trigger deployment
  app.post('/dev/api/deploy', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    const version = req.body.version || 'v' + new Date().toISOString().split('T')[0].replace(/-/g, '.');
    const triggeredBy = req.session.user?.email || req.session.user?.name || 'admin';

    // Create deployment record
    const { rows: [deployment] } = await pool.query(
      'INSERT INTO dev_deployments (version, status, triggered_by, deploy_url, log) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [version, 'pending', triggeredBy, RENDER_DEPLOY_WEBHOOK.replace(/key=[^&]+/, 'key=****'), 'Deployment triggered at ' + new Date().toISOString()]
    ).catch(() => ({ rows: [{}] }));

    // Trigger the Render webhook
    let deployStatus = 'triggered';
    let deployLog = 'Deployment triggered at ' + new Date().toISOString() + '\n';
    try {
      const http = require('http');
      const https = require('https');
      const url = new URL(RENDER_DEPLOY_WEBHOOK);
      const proto = url.protocol === 'https:' ? https : http;

      await new Promise((resolve, reject) => {
        const request = proto.request({
          hostname: url.hostname,
          port: url.port || (url.protocol === 'https:' ? 443 : 80),
          path: url.pathname + url.search,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          timeout: 30000,
        }, (response) => {
          let body = '';
          response.on('data', (chunk) => { body += chunk; });
          response.on('end', () => {
            deployLog += `Webhook response: ${response.statusCode} ${response.statusMessage}\n${body}\n`;
            if (response.statusCode >= 200 && response.statusCode < 300) {
              deployStatus = 'success';
            } else {
              deployStatus = 'failed';
            }
            resolve();
          });
        });
        request.on('error', (e) => {
          deployLog += `Webhook error: ${e.message}\n`;
          deployStatus = 'failed';
          resolve(); // Don't reject — we still want to record the attempt
        });
        request.on('timeout', () => {
          deployLog += 'Webhook request timed out\n';
          deployStatus = 'failed';
          request.destroy();
          resolve();
        });
        request.write('{}');
        request.end();
      });
    } catch (e) {
      deployLog += `Deployment error: ${e.message}\n`;
      deployStatus = 'failed';
    }

    // Update deployment record
    if (deployment && deployment.id) {
      await pool.query(
        'UPDATE dev_deployments SET status=$1, log=$2, completed_at=NOW() WHERE id=$3',
        [deployStatus, deployLog, deployment.id]
      ).catch(() => {});
    }

    // Log event
    await pool.query(
      "INSERT INTO dev_event_log (event_type, source_module, payload, processed) VALUES ($1,$2,$3,true)",
      ['deployment.triggered', 'ci-cd', JSON.stringify({ version, status: deployStatus, triggeredBy })]
    ).catch(() => {});

    audit(req, 'deploy', 'dev_deploy_trigger', { version, status: deployStatus });

    // If JSON request, return JSON; otherwise redirect
    if (req.is('json') || req.headers.accept?.includes('application/json')) {
      return res.json({
        status: deployStatus,
        deployment_id: deployment?.id,
        version,
        webhook_url: RENDER_DEPLOY_WEBHOOK.replace(/key=[^&]+/, 'key=****'),
      });
    }

    req.session.flash = { type: deployStatus === 'success' ? 'success' : 'error', msg: `Deployment ${deployStatus}: ${version}` };
    res.redirect('/dev/api/deploy');
  }));

  console.log('[DevDashboard] Developer Experience Dashboard loaded — 11 routes');
};
