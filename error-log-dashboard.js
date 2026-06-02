/**
 * Error Log Dashboard Module
 * Provides comprehensive error monitoring, analysis, and resolution tracking.
 * Tables: error_logs, error_aggregates
 * Dark theme UI with SVG trend charts.
 */
const { migrateQuery } = require('./db');
module.exports = function(app, pool, opts) {
  const esc = opts.esc;

  // Auto-create tables
  (async () => {
    try {
      await migrateQuery(pool, 'ErrorLogDashboard', `CREATE TABLE IF NOT EXISTS error_logs (
        id SERIAL PRIMARY KEY, level TEXT DEFAULT 'error', message TEXT NOT NULL,
        stack_trace TEXT, source TEXT, path TEXT, method TEXT, status_code INT,
        user_id INT, ip_address TEXT, user_agent TEXT,
        request_body JSONB, request_headers JSONB,
        resolved BOOLEAN DEFAULT false, resolved_by INT,
        resolved_at TIMESTAMPTZ, resolution_notes TEXT,
        occurrence_count INT DEFAULT 1,
        first_seen TIMESTAMPTZ DEFAULT NOW(), last_seen TIMESTAMPTZ,
        school_id INT DEFAULT 1
      )`);
      await migrateQuery(pool, 'ErrorLogDashboard', `CREATE TABLE IF NOT EXISTS error_aggregates (
        id SERIAL PRIMARY KEY, error_hash TEXT UNIQUE, level TEXT,
        message TEXT, source TEXT, total_count INT DEFAULT 1,
        last_occurrence TIMESTAMPTZ, is_resolved BOOLEAN DEFAULT false,
        school_id INT DEFAULT 1
      )`);
      await migrateQuery(pool, 'ErrorLogDashboard', `CREATE INDEX IF NOT EXISTS idx_el_school ON error_logs(school_id)`);
      await migrateQuery(pool, 'ErrorLogDashboard', `CREATE INDEX IF NOT EXISTS idx_el_level ON error_logs(level)`);
      await migrateQuery(pool, 'ErrorLogDashboard', `CREATE INDEX IF NOT EXISTS idx_el_resolved ON error_logs(resolved)`);
      await migrateQuery(pool, 'ErrorLogDashboard', `CREATE INDEX IF NOT EXISTS idx_el_created ON error_logs(first_seen)`);
      console.log('[ErrorLogs] Tables ready');
    } catch(e) { /* migration OK */ }
  })();

  // ─── Helper: build severity color ────────────────────────────────────────
  function severityColor(level) {
    const colors = {
      critical: '#ef4444',
      error: '#f97316',
      warning: '#eab308',
      info: '#3b82f6',
      debug: '#8b5cf6'
    };
    return colors[level] || '#94a3b8';
  }

  // ─── Helper: build severity icon ─────────────────────────────────────────
  function severityIcon(level) {
    const icons = {
      critical: '🔴',
      error: '🟠',
      warning: '🟡',
      info: '🔵',
      debug: '🟣'
    };
    return icons[level] || '⚪';
  }

  // ─── Helper: generate SVG trend chart ────────────────────────────────────
  function buildTrendSVG(data, width, height, title) {
    width = width || 800;
    height = height || 300;
    title = title || 'Error Trends';
    if (!data || data.length === 0) {
      return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <rect width="${width}" height="${height}" fill="#1e293b" rx="8"/>
        <text x="${width / 2}" y="${height / 2}" text-anchor="middle" fill="#64748b" font-size="16" font-family="system-ui">No trend data available</text>
      </svg>`;
    }
    const maxVal = Math.max(...data.map(d => d.count), 1);
    const pad = { top: 50, right: 30, bottom: 60, left: 60 };
    const chartW = width - pad.left - pad.right;
    const chartH = height - pad.top - pad.bottom;
    const stepX = data.length > 1 ? chartW / (data.length - 1) : chartW;

    // Grid lines
    let gridLines = '';
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + (chartH / 4) * i;
      const val = Math.round(maxVal - (maxVal / 4) * i);
      gridLines += `<line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" stroke="#334155" stroke-width="1" stroke-dasharray="4,4"/>`;
      gridLines += `<text x="${pad.left - 10}" y="${y + 4}" text-anchor="end" fill="#64748b" font-size="11" font-family="system-ui">${val}</text>`;
    }

    // Build path
    let pathD = '';
    let areaD = '';
    let labels = '';
    let dots = '';
    data.forEach((d, i) => {
      const x = pad.left + stepX * i;
      const y = pad.top + chartH - (d.count / maxVal) * chartH;
      const cmd = i === 0 ? 'M' : 'L';
      pathD += `${cmd} ${x} ${y} `;
      areaD += `${cmd} ${x} ${y} `;
      labels += `<text x="${x}" y="${height - pad.bottom + 20}" text-anchor="middle" fill="#64748b" font-size="10" font-family="system-ui" transform="rotate(-30 ${x} ${height - pad.bottom + 20})">${d.label || ''}</text>`;
      dots += `<circle cx="${x}" cy="${y}" r="4" fill="#3b82f6" stroke="#1e293b" stroke-width="2"/>`;
    });
    areaD += `L ${pad.left + stepX * (data.length - 1)} ${pad.top + chartH} L ${pad.left} ${pad.top + chartH} Z`;

    // Gradient definition
    const gradient = `<defs>
      <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#3b82f6" stop-opacity="0.3"/>
        <stop offset="100%" stop-color="#3b82f6" stop-opacity="0.02"/>
      </linearGradient>
    </defs>`;

    return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${width}" height="${height}" fill="#1e293b" rx="8"/>
      ${gradient}
      <text x="${width / 2}" y="30" text-anchor="middle" fill="#e2e8f0" font-size="15" font-weight="600" font-family="system-ui">${title}</text>
      ${gridLines}
      <path d="${areaD}" fill="url(#areaGrad)"/>
      <path d="${pathD}" fill="none" stroke="#3b82f6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      ${dots}
      ${labels}
    </svg>`;
  }

  // ─── Helper: build SVG pie/donut chart ───────────────────────────────────
  function buildPieSVG(data, width, height, title) {
    width = width || 300;
    height = height || 300;
    title = title || 'Severity Breakdown';
    if (!data || data.length === 0) {
      return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <rect width="${width}" height="${height}" fill="#1e293b" rx="8"/>
        <text x="${width / 2}" y="${height / 2}" text-anchor="middle" fill="#64748b" font-size="14" font-family="system-ui">No data</text>
      </svg>`;
    }
    const total = data.reduce((s, d) => s + d.count, 0);
    const cx = width / 2;
    const cy = (height / 2) + 15;
    const r = Math.min(width, height) / 2 - 50;
    const innerR = r * 0.55;
    let paths = '';
    let legend = '';
    let angle = -Math.PI / 2;

    data.forEach((d, i) => {
      const sliceAngle = (d.count / total) * Math.PI * 2;
      const x1 = cx + r * Math.cos(angle);
      const y1 = cy + r * Math.sin(angle);
      const x2 = cx + r * Math.cos(angle + sliceAngle);
      const y2 = cy + r * Math.sin(angle + sliceAngle);
      const ix1 = cx + innerR * Math.cos(angle + sliceAngle);
      const iy1 = cy + innerR * Math.sin(angle + sliceAngle);
      const ix2 = cx + innerR * Math.cos(angle);
      const iy2 = cy + innerR * Math.sin(angle);
      const large = sliceAngle > Math.PI ? 1 : 0;
      const pct = ((d.count / total) * 100).toFixed(1);
      paths += `<path d="M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} L ${ix1} ${iy1} A ${innerR} ${innerR} 0 ${large} 0 ${ix2} ${iy2} Z" fill="${d.color}" opacity="0.85"/>`;
      // Label on mid-arc
      const midA = angle + sliceAngle / 2;
      const lx = cx + (r + 25) * Math.cos(midA);
      const ly = cy + (r + 25) * Math.sin(midA);
      if (pct > 4) {
        paths += `<text x="${lx}" y="${ly}" text-anchor="middle" fill="#e2e8f0" font-size="11" font-family="system-ui" font-weight="600">${pct}%</text>`;
      }
      angle += sliceAngle;
    });

    data.forEach((d, i) => {
      const ly = height - 10 - (data.length - 1 - i) * 18;
      legend += `<rect x="10" y="${ly - 10}" width="12" height="12" rx="3" fill="${d.color}"/>`;
      legend += `<text x="28" y="${ly}" fill="#cbd5e1" font-size="11" font-family="system-ui">${d.label} (${d.count})</text>`;
    });

    return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${width}" height="${height}" fill="#1e293b" rx="8"/>
      <text x="${width / 2}" y="25" text-anchor="middle" fill="#e2e8f0" font-size="14" font-weight="600" font-family="system-ui">${title}</text>
      ${paths}
      <text x="${cx}" y="${cy + 5}" text-anchor="middle" fill="#e2e8f0" font-size="20" font-weight="700" font-family="system-ui">${total}</text>
      <text x="${cx}" y="${cy + 22}" text-anchor="middle" fill="#64748b" font-size="11" font-family="system-ui">total errors</text>
      ${legend}
    </svg>`;
  }

  // ─── Helper: build SVG bar chart ─────────────────────────────────────────
  function buildBarSVG(data, width, height, title) {
    width = width || 700;
    height = height || 300;
    title = title || 'Top Sources';
    if (!data || data.length === 0) {
      return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <rect width="${width}" height="${height}" fill="#1e293b" rx="8"/>
        <text x="${width / 2}" y="${height / 2}" text-anchor="middle" fill="#64748b" font-size="16" font-family="system-ui">No data</text>
      </svg>`;
    }
    const maxVal = Math.max(...data.map(d => d.count), 1);
    const pad = { top: 50, right: 30, bottom: 70, left: 60 };
    const chartW = width - pad.left - pad.right;
    const chartH = height - pad.top - pad.bottom;
    const barW = Math.min(50, (chartW / data.length) * 0.6);
    const gap = (chartW - barW * data.length) / (data.length + 1);

    let gridLines = '';
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + (chartH / 4) * i;
      const val = Math.round(maxVal - (maxVal / 4) * i);
      gridLines += `<line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" stroke="#334155" stroke-width="1" stroke-dasharray="4,4"/>`;
      gridLines += `<text x="${pad.left - 10}" y="${y + 4}" text-anchor="end" fill="#64748b" font-size="11" font-family="system-ui">${val}</text>`;
    }

    let bars = '';
    data.forEach((d, i) => {
      const x = pad.left + gap + i * (barW + gap);
      const barH = (d.count / maxVal) * chartH;
      const y = pad.top + chartH - barH;
      const color = d.color || '#3b82f6';
      bars += `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" fill="${color}" rx="4" opacity="0.85"/>`;
      bars += `<text x="${x + barW / 2}" y="${y - 6}" text-anchor="middle" fill="#e2e8f0" font-size="11" font-weight="600" font-family="system-ui">${d.count}</text>`;
      const labelLen = d.label.length > 10 ? d.label.substring(0, 9) + '…' : d.label;
      bars += `<text x="${x + barW / 2}" y="${height - pad.bottom + 18}" text-anchor="middle" fill="#64748b" font-size="10" font-family="system-ui" transform="rotate(-35 ${x + barW / 2} ${height - pad.bottom + 18})">${labelLen}</text>`;
    });

    return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${width}" height="${height}" fill="#1e293b" rx="8"/>
      <text x="${width / 2}" y="30" text-anchor="middle" fill="#e2e8f0" font-size="15" font-weight="600" font-family="system-ui">${title}</text>
      ${gridLines}
      ${bars}
    </svg>`;
  }

  // ─── Shared dark-theme header ────────────────────────────────────────────
  function dashboardHeader(activeTab, breadcrumbs) {
    breadcrumbs = breadcrumbs || [{ label: 'Dashboard', href: '/admin/error-logs' }];
    const crumbHTML = breadcrumbs.map((b, i) => {
      const sep = i < breadcrumbs.length - 1 ? `<span class="sep">›</span>` : '';
      return `<a href="${b.href || '#'}" class="crumb ${i === breadcrumbs.length - 1 ? 'active' : ''}">${b.label}</a>${sep}`;
    }).join('');

    return `
    <div class="dash-header">
      <div class="dash-title-row">
        <h1><span class="icon-wrap">⚠️</span> Error Log Dashboard</h1>
        <div class="header-actions">
          <a href="/admin/error-logs/trends" class="btn btn-outline ${activeTab === 'trends' ? 'active' : ''}">📈 Trends</a>
          <a href="/admin/error-logs/critical" class="btn btn-danger-outline ${activeTab === 'critical' ? 'active' : ''}">🔥 Critical</a>
          <a href="/admin/error-logs/unresolved" class="btn btn-warning-outline ${activeTab === 'unresolved' ? 'active' : ''}">❗ Unresolved</a>
          <a href="/admin/error-logs/export" class="btn btn-outline">📥 Export</a>
        </div>
      </div>
      <div class="breadcrumbs">${crumbHTML}</div>
    </div>`;
  }

  // ─── Shared dark-theme styles ────────────────────────────────────────────
  function darkStyles() {
    return `<style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { background: #0f172a; color: #e2e8f0; font-family: 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif; line-height: 1.6; min-height: 100vh; }
      .container { max-width: 1400px; margin: 0 auto; padding: 24px; }
      .dash-header { margin-bottom: 28px; }
      .dash-title-row { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 16px; margin-bottom: 8px; }
      .dash-title-row h1 { font-size: 1.75rem; font-weight: 700; color: #f1f5f9; display: flex; align-items: center; gap: 10px; }
      .icon-wrap { font-size: 1.5rem; }
      .header-actions { display: flex; gap: 8px; flex-wrap: wrap; }
      .breadcrumbs { display: flex; align-items: center; gap: 6px; font-size: 0.85rem; color: #64748b; }
      .breadcrumbs a { color: #3b82f6; text-decoration: none; transition: color 0.2s; }
      .breadcrumbs a:hover { color: #60a5fa; }
      .breadcrumbs .sep { color: #475569; margin: 0 2px; }
      .breadcrumbs .active { color: #94a3b8; pointer-events: none; }
      .btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; border-radius: 8px; font-size: 0.85rem; font-weight: 500; text-decoration: none; transition: all 0.2s; cursor: pointer; border: none; }
      .btn-primary { background: #3b82f6; color: #fff; }
      .btn-primary:hover { background: #2563eb; }
      .btn-outline { background: transparent; color: #94a3b8; border: 1px solid #334155; }
      .btn-outline:hover { border-color: #3b82f6; color: #3b82f6; }
      .btn-outline.active { border-color: #3b82f6; color: #3b82f6; background: rgba(59,130,246,0.1); }
      .btn-danger { background: #ef4444; color: #fff; }
      .btn-danger:hover { background: #dc2626; }
      .btn-danger-outline { background: transparent; color: #f87171; border: 1px solid #7f1d1d; }
      .btn-danger-outline:hover { border-color: #ef4444; background: rgba(239,68,68,0.1); }
      .btn-danger-outline.active { border-color: #ef4444; color: #ef4444; background: rgba(239,68,68,0.15); }
      .btn-warning-outline { background: transparent; color: #fbbf24; border: 1px solid #78350f; }
      .btn-warning-outline:hover { border-color: #eab308; background: rgba(234,179,8,0.1); }
      .btn-warning-outline.active { border-color: #eab308; color: #eab308; background: rgba(234,179,8,0.15); }
      .btn-success { background: #22c55e; color: #fff; }
      .btn-success:hover { background: #16a34a; }
      .btn-sm { padding: 5px 12px; font-size: 0.78rem; border-radius: 6px; }
      .btn-ghost { background: rgba(51,65,85,0.5); color: #94a3b8; }
      .btn-ghost:hover { background: #334155; color: #e2e8f0; }
      .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-bottom: 24px; }
      .stat-card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 20px; transition: transform 0.2s, border-color 0.2s; }
      .stat-card:hover { transform: translateY(-2px); border-color: #475569; }
      .stat-card .stat-label { font-size: 0.8rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
      .stat-card .stat-value { font-size: 2rem; font-weight: 700; color: #f1f5f9; }
      .stat-card .stat-change { font-size: 0.8rem; margin-top: 4px; }
      .stat-card .stat-change.up { color: #ef4444; }
      .stat-card .stat-change.down { color: #22c55e; }
      .chart-row { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 24px; }
      .chart-row.full { grid-template-columns: 1fr; }
      .chart-card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 20px; overflow-x: auto; }
      .chart-card h3 { font-size: 1rem; font-weight: 600; color: #e2e8f0; margin-bottom: 12px; }
      .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 20px; margin-bottom: 20px; }
      .card h2 { font-size: 1.15rem; font-weight: 600; color: #e2e8f0; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; }
      .card h3 { font-size: 1rem; font-weight: 600; color: #cbd5e1; margin-bottom: 12px; }
      table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
      thead th { background: #0f172a; color: #94a3b8; text-align: left; padding: 10px 14px; font-weight: 600; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 2px solid #334155; position: sticky; top: 0; z-index: 2; }
      tbody td { padding: 10px 14px; border-bottom: 1px solid #1e293b; color: #cbd5e1; vertical-align: top; }
      tbody tr { transition: background 0.15s; }
      tbody tr:hover { background: rgba(59,130,246,0.05); }
      .badge { display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px; border-radius: 20px; font-size: 0.75rem; font-weight: 600; }
      .badge-critical { background: rgba(239,68,68,0.15); color: #f87171; border: 1px solid rgba(239,68,68,0.3); }
      .badge-error { background: rgba(249,115,22,0.15); color: #fb923c; border: 1px solid rgba(249,115,22,0.3); }
      .badge-warning { background: rgba(234,179,8,0.15); color: #facc15; border: 1px solid rgba(234,179,8,0.3); }
      .badge-info { background: rgba(59,130,246,0.15); color: #60a5fa; border: 1px solid rgba(59,130,246,0.3); }
      .badge-debug { background: rgba(139,92,246,0.15); color: #a78bfa; border: 1px solid rgba(139,92,246,0.3); }
      .badge-resolved { background: rgba(34,197,94,0.15); color: #4ade80; border: 1px solid rgba(34,197,94,0.3); }
      .badge-unresolved { background: rgba(239,68,68,0.1); color: #f87171; border: 1px solid rgba(239,68,68,0.2); }
      .badge-source { background: rgba(51,65,85,0.5); color: #94a3b8; border: 1px solid #334155; }
      .filter-bar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 20px; }
      .filter-bar input, .filter-bar select { background: #1e293b; color: #e2e8f0; border: 1px solid #334155; padding: 8px 14px; border-radius: 8px; font-size: 0.88rem; outline: none; transition: border-color 0.2s; }
      .filter-bar input:focus, .filter-bar select:focus { border-color: #3b82f6; }
      .filter-bar input[type="text"] { min-width: 250px; }
      .filter-bar select { min-width: 140px; }
      .stack-trace { background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 16px; font-family: 'Fira Code', 'Cascadia Code', monospace; font-size: 0.82rem; line-height: 1.7; color: #94a3b8; overflow-x: auto; white-space: pre-wrap; word-break: break-all; max-height: 500px; overflow-y: auto; }
      .error-msg { background: rgba(239,68,68,0.05); border-left: 3px solid #ef4444; padding: 12px 16px; border-radius: 0 8px 8px 0; margin-bottom: 16px; font-family: monospace; font-size: 0.9rem; color: #fca5a5; }
      .meta-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; margin-bottom: 16px; }
      .meta-item { background: #0f172a; padding: 10px 14px; border-radius: 8px; border: 1px solid #1e293b; }
      .meta-item .meta-key { font-size: 0.75rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px; }
      .meta-item .meta-val { font-size: 0.9rem; color: #e2e8f0; word-break: break-all; }
      .empty-state { text-align: center; padding: 60px 20px; color: #64748b; }
      .empty-state .icon { font-size: 3rem; margin-bottom: 12px; }
      .empty-state p { font-size: 1rem; }
      .flex-between { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; }
      .pagination { display: flex; gap: 6px; align-items: center; margin-top: 16px; }
      .pagination a, .pagination span { padding: 6px 12px; border-radius: 6px; font-size: 0.82rem; text-decoration: none; color: #94a3b8; background: #1e293b; border: 1px solid #334155; }
      .pagination a:hover { border-color: #3b82f6; color: #3b82f6; }
      .pagination .current { background: #3b82f6; color: #fff; border-color: #3b82f6; }
      .form-group { margin-bottom: 16px; }
      .form-group label { display: block; font-size: 0.85rem; color: #94a3b8; margin-bottom: 6px; font-weight: 500; }
      .form-group input, .form-group textarea, .form-group select { width: 100%; background: #0f172a; color: #e2e8f0; border: 1px solid #334155; padding: 10px 14px; border-radius: 8px; font-size: 0.9rem; outline: none; transition: border-color 0.2s; font-family: inherit; }
      .form-group input:focus, .form-group textarea:focus { border-color: #3b82f6; }
      .form-group textarea { min-height: 80px; resize: vertical; }
      .alert { padding: 12px 18px; border-radius: 8px; font-size: 0.88rem; margin-bottom: 16px; }
      .alert-success { background: rgba(34,197,94,0.12); color: #4ade80; border: 1px solid rgba(34,197,94,0.3); }
      .alert-danger { background: rgba(239,68,68,0.12); color: #f87171; border: 1px solid rgba(239,68,68,0.3); }
      .alert-info { background: rgba(59,130,246,0.12); color: #60a5fa; border: 1px solid rgba(59,130,246,0.3); }
      .checkbox-wrap { display: flex; align-items: center; gap: 8px; cursor: pointer; }
      .checkbox-wrap input[type="checkbox"] { width: 16px; height: 16px; accent-color: #3b82f6; }
      .tag { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; background: #334155; color: #94a3b8; margin: 2px; }
      .truncated { max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      @media (max-width: 768px) {
        .chart-row { grid-template-columns: 1fr; }
        .dash-title-row { flex-direction: column; align-items: flex-start; }
        .header-actions { width: 100%; overflow-x: auto; }
        .stats-grid { grid-template-columns: 1fr 1fr; }
        .filter-bar { flex-direction: column; }
        .filter-bar input[type="text"] { min-width: 100%; }
      }
    </style>`;
  }

  // ─── Helper: format timestamp ────────────────────────────────────────────
  function fmtTime(ts) {
    if (!ts) return '<span style="color:#475569">—</span>';
    const d = new Date(ts);
    return `<span title="${d.toISOString()}">${d.toLocaleDateString()} ${d.toLocaleTimeString()}</span>`;
  }

  // ─── Helper: escape HTML content ─────────────────────────────────────────
  function h(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 1: GET / - Main Dashboard
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/admin/error-logs', async (req, res) => {
    try {
      // Stats
      const totalRes = await pool.query('SELECT COUNT(*)::int AS c FROM error_logs');
      const unresolvedRes = await pool.query("SELECT COUNT(*)::int AS c FROM error_logs WHERE resolved = false");
      const criticalRes = await pool.query("SELECT COUNT(*)::int AS c FROM error_logs WHERE level = 'critical' AND resolved = false");
      const todayRes = await pool.query("SELECT COUNT(*)::int AS c FROM error_logs WHERE first_seen >= CURRENT_DATE");
      const totalCount = totalRes.rows[0].c;
      const unresolvedCount = unresolvedRes.rows[0].c;
      const criticalCount = criticalRes.rows[0].c;
      const todayCount = todayRes.rows[0].c;

      // Severity breakdown for pie chart
      const sevRes = await pool.query(
        "SELECT level, COUNT(*)::int AS count FROM error_logs GROUP BY level ORDER BY count DESC"
      );
      const pieData = sevRes.rows.map(r => ({
        label: r.level.charAt(0).toUpperCase() + r.level.slice(1),
        count: r.count,
        color: severityColor(r.level)
      }));

      // Top sources for bar chart
      const srcRes = await pool.query(
        "SELECT COALESCE(source, 'unknown') AS source, COUNT(*)::int AS count FROM error_logs GROUP BY source ORDER BY count DESC LIMIT 10"
      );
      const barData = srcRes.rows.map(r => ({
        label: r.source || 'unknown',
        count: r.count,
        color: '#3b82f6'
      }));

      // 7-day trend for line chart
      const trendRes = await pool.query(`
        SELECT d::date AS day, COALESCE(cnt, 0) AS count
        FROM generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, '1 day') d
        LEFT JOIN (
          SELECT first_seen::date AS fd, COUNT(*)::int AS cnt
          FROM error_logs WHERE first_seen >= CURRENT_DATE - INTERVAL '6 days'
          GROUP BY first_seen::date
        ) sub ON sub.fd = d
        ORDER BY d)
      `);
      const trendData = trendRes.rows.map(r => ({
        label: (r.day || '').substring(5),
        count: r.count
      }));

      // Recent errors
      const recentRes = await pool.query(
        'SELECT * FROM error_logs ORDER BY last_seen DESC NULLS LAST, id DESC LIMIT 20'
      );
      const recentErrors = recentRes.rows;

      const html = `
        ${darkStyles()}
        <div class="container">
          ${dashboardHeader('dashboard')}
          <div class="stats-grid">
            <div class="stat-card">
              <div class="stat-label">📋 Total Errors</div>
              <div class="stat-value">${totalCount}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">❗ Unresolved</div>
              <div class="stat-value" style="color:#f87171">${unresolvedCount}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">🔥 Critical Open</div>
              <div class="stat-value" style="color:#ef4444">${criticalCount}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">📅 Today</div>
              <div class="stat-value" style="color:#fbbf24">${todayCount}</div>
            </div>
          </div>
          <div class="chart-row">
            <div class="chart-card">
              <h3>📊 7-Day Error Trend</h3>
              ${buildTrendSVG(trendData, 800, 280, 'Errors per Day (Last 7 Days)')}
            </div>
            <div class="chart-card">
              <h3>🎯 Severity Breakdown</h3>
              ${buildPieSVG(pieData, 350, 300, 'Severity Distribution')}
            </div>
          </div>
          <div class="chart-row full">
            <div class="chart-card">
              <h3>📦 Top Error Sources</h3>
              ${buildBarSVG(barData, 760, 300, 'Errors by Source/Module')}
            </div>
          </div>
          <div class="card">
            <h2>🕐 Recent Errors <a href="/admin/error-logs/data" class="btn btn-sm btn-outline" style="margin-left:auto;">View All →</a></h2>
            <div style="overflow-x:auto;">
              <table>
                <thead>
                  <tr>
                    <th>Severity</th>
                    <th>Message</th>
                    <th>Source</th>
                    <th>Path</th>
                    <th>Status</th>
                    <th>Last Seen</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${recentErrors.length === 0 ? `<tr><td colspan="7" class="empty-state"><div class="icon">🎉</div><p>No errors logged yet. Everything looks great!</p></td></tr>` :
                    recentErrors.map(e => `<tr>
                      <td><span class="badge badge-${e.level || 'error'}">${severityIcon(e.level)} ${e.level || 'error'}</span></td>
                      <td class="truncated"><a href="/admin/error-logs/error/${e.id}" style="color:#60a5fa;text-decoration:none;">${h(e.message)}</a></td>
                      <td><span class="badge badge-source">${h(e.source) || '—'}</span></td>
                      <td style="font-size:0.82rem;color:#64748b;">${h(e.method)} ${h(e.path) || '—'}</td>
                      <td>${e.resolved ? '<span class="badge badge-resolved">✓ Resolved</span>' : '<span class="badge badge-unresolved">✗ Open</span>'}</td>
                      <td style="font-size:0.82rem;">${fmtTime(e.last_seen || e.first_seen)}</td>
                      <td>
                        ${!e.resolved ? `<form method="POST" action="/admin/error-logs/resolve/${e.id}" style="display:inline;"><button class="btn btn-sm btn-success">Resolve</button></form>` : ''}
                        <a href="/admin/error-logs/error/${e.id}" class="btn btn-sm btn-ghost">View</a>
                      </td>
                    </tr>`).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `;
      res.send(opts.renderPage('Error Log Dashboard', html, req.session.user));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 2: GET /data - JSON error list with filters
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/admin/error-logs/data', async (req, res) => {
    try {
      const { level, source, resolved, from_date, to_date, search, page = '1', limit = '50' } = req.query;
      let where = [];
      let params = [];
      let idx = 1;

      if (level) { where.push(`level = $${idx++}`); params.push(level); }
      if (source) { where.push(`source ILIKE $${idx++}`); params.push(`%${source}%`); }
      if (resolved !== undefined && resolved !== '') {
        where.push(`resolved = $${idx++}`);
        params.push(resolved === 'true');
      }
      if (from_date) { where.push(`first_seen >= $${idx++}`); params.push(from_date); }
      if (to_date) { where.push(`first_seen <= $${idx++}`); params.push(to_date + ' 23:59:59'); }
      if (search) { where.push(`(message ILIKE $${idx++} OR stack_trace ILIKE $${idx++} OR source ILIKE $${idx++})`); params.push(`%${search}%`, `%${search}%`, `%${search}%`); }

      const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';
      const pageNum = Math.max(1, parseInt(limit));
      const offsetNum = (Math.max(1, parseInt(page)) - 1) * pageNum;

      const countRes = await pool.query(`SELECT COUNT(*)::int AS total FROM error_logs ${whereClause}`, params);
      const dataRes = await pool.query(
        `SELECT * FROM error_logs ${whereClause} ORDER BY last_seen DESC NULLS LAST, id DESC LIMIT $${idx++} OFFSET $${idx++}`,
        [...params, pageNum, offsetNum]
      );

      res.json({
        success: true,
        total: countRes.rows[0].total,
        page: parseInt(page),
        limit: parseInt(limit),
        data: dataRes.rows
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 3: GET /error/:id - Detailed error view
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/admin/error-logs/error/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const result = await pool.query('SELECT * FROM error_logs WHERE id = $1', [id]);
      if (result.rows.length === 0) {
        return res.status(404).send('Error not found');
      }
      const e = result.rows[0];

      // Similar errors
      const similarRes = await pool.query(
        `SELECT id, level, message, first_seen, last_seen, resolved, occurrence_count
         FROM error_logs
         WHERE message ILIKE $1 AND id != $2
         ORDER BY last_seen DESC NULLS LAST
         LIMIT 10`,
        [`%${e.message.substring(0, 60)}%`, id]
      );
      const similarErrors = similarRes.rows;

      const html = `
        ${darkStyles()}
        <div class="container">
          ${dashboardHeader('detail', [
            { label: 'Dashboard', href: '/admin/error-logs' },
            { label: `Error #${e.id}`, href: `/admin/error-logs/error/${e.id}` }
          ])}
          <div class="error-msg">${severityIcon(e.level)} <strong>[${e.level || 'error'}]</strong> ${h(e.message)}</div>
          <div class="card">
            <div class="flex-between">
              <h2>📋 Error Details #${e.id}</h2>
              <div style="display:flex;gap:8px;">
                ${e.resolved
                  ? '<span class="badge badge-resolved">✓ Resolved by ' + (e.resolved_by || 'N/A') + ' at ' + fmtTime(e.resolved_at) + '</span>'
                  : `<form method="POST" action="/admin/error-logs/resolve/${e.id}" style="display:inline;">
                      <input type="hidden" name="redirect" value="/admin/error-logs/error/${e.id}">
                      <button class="btn btn-success">✓ Resolve</button>
                    </form>`
                }
                <a href="/admin/error-logs" class="btn btn-outline">← Back</a>
              </div>
            </div>
            ${e.resolution_notes ? `<div class="alert alert-info">📝 <strong>Resolution Notes:</strong> ${h(e.resolution_notes)}</div>` : ''}
            <div class="meta-grid">
              <div class="meta-item"><div class="meta-key">Level</div><div class="meta-val"><span class="badge badge-${e.level}">${severityIcon(e.level)} ${e.level}</span></div></div>
              <div class="meta-item"><div class="meta-key">Status</div><div class="meta-val">${e.resolved ? '<span class="badge badge-resolved">Resolved</span>' : '<span class="badge badge-unresolved">Unresolved</span>'}</div></div>
              <div class="meta-item"><div class="meta-key">Source</div><div class="meta-val">${h(e.source) || '—'}</div></div>
              <div class="meta-item"><div class="meta-key">Path</div><div class="meta-val">${h(e.method)} ${h(e.path) || '—'}</div></div>
              <div class="meta-item"><div class="meta-key">Status Code</div><div class="meta-val">${e.status_code || '—'}</div></div>
              <div class="meta-item"><div class="meta-key">Occurrences</div><div class="meta-val" style="font-weight:700;color:#fbbf24;">${e.occurrence_count || 1}</div></div>
              <div class="meta-item"><div class="meta-key">First Seen</div><div class="meta-val">${fmtTime(e.first_seen)}</div></div>
              <div class="meta-item"><div class="meta-key">Last Seen</div><div class="meta-val">${fmtTime(e.last_seen)}</div></div>
              <div class="meta-item"><div class="meta-key">User ID</div><div class="meta-val">${e.user_id || '—'}</div></div>
              <div class="meta-item"><div class="meta-key">IP Address</div><div class="meta-val">${h(e.ip_address) || '—'}</div></div>
              <div class="meta-item"><div class="meta-key">User Agent</div><div class="meta-val" style="font-size:0.78rem;">${h(e.user_agent) || '—'}</div></div>
              <div class="meta-item"><div class="meta-key">School ID</div><div class="meta-val">${e.school_id || 1}</div></div>
            </div>
            ${e.stack_trace ? `
              <h3>🔍 Stack Trace</h3>
              <div class="stack-trace">${h(e.stack_trace)}</div>
            ` : ''}
            ${e.request_headers ? `
              <h3 style="margin-top:16px;">📨 Request Headers</h3>
              <div class="stack-trace">${h(typeof e.request_headers === 'string' ? e.request_headers : JSON.stringify(e.request_headers, null, 2))}</div>
            ` : ''}
            ${e.request_body ? `
              <h3 style="margin-top:16px;">📋 Request Body</h3>
              <div class="stack-trace">${h(typeof e.request_body === 'string' ? e.request_body : JSON.stringify(e.request_body, null, 2))}</div>
            ` : ''}
          </div>
          ${similarErrors.length > 0 ? `
            <div class="card">
              <h2>🔗 Similar Errors (${similarErrors.length})</h2>
              <table>
                <thead>
                  <tr><th>ID</th><th>Level</th><th>Message</th><th>Occurrences</th><th>Last Seen</th><th>Status</th></tr>
                </thead>
                <tbody>
                  ${similarErrors.map(s => `<tr>
                    <td><a href="/admin/error-logs/error/${s.id}" style="color:#60a5fa;">#${s.id}</a></td>
                    <td><span class="badge badge-${s.level}">${severityIcon(s.level)} ${s.level}</span></td>
                    <td class="truncated">${h(s.message)}</td>
                    <td style="font-weight:600;color:#fbbf24;">${s.occurrence_count || 1}</td>
                    <td>${fmtTime(s.last_seen || s.first_seen)}</td>
                    <td>${s.resolved ? '<span class="badge badge-resolved">✓</span>' : '<span class="badge badge-unresolved">✗</span>'}</td>
                  </tr>`).join('')}
                </tbody>
              </table>
            </div>
          ` : ''}
        </div>
      `;
      res.send(opts.renderPage(`Error #${id}`, html, req.session.user));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 4: POST /resolve/:id - Mark error as resolved
  // ═══════════════════════════════════════════════════════════════════════════
  app.post('/admin/error-logs/resolve/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const { notes, resolved_by, redirect } = req.body;
      const userId = resolved_by || req.user?.id || req.session?.userId || null;
      await pool.query(
        `UPDATE error_logs SET resolved = true, resolved_by = $1, resolved_at = NOW(), resolution_notes = $2 WHERE id = $3`,
        [userId, notes || null, id]
      );
      // Update aggregate
      await pool.query(
        `UPDATE error_aggregates SET is_resolved = true WHERE error_hash IN (
          SELECT LEFT(MD5(message || COALESCE(source,'')), 32) FROM error_logs WHERE id = $1
        )`, [id]
      );
      const redirectTo = redirect || '/admin/error-logs';
      res.redirect(redirectTo);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 5: POST /bulk-resolve - Resolve multiple errors
  // ═══════════════════════════════════════════════════════════════════════════
  app.post('/admin/error-logs/bulk-resolve', async (req, res) => {
    try {
      const { ids, notes } = req.body;
      const errorIds = Array.isArray(ids) ? ids : (typeof ids === 'string' ? ids.split(',').map(Number) : []);
      if (errorIds.length === 0) {
        return res.status(400).json({ error: 'No error IDs provided' });
      }
      const userId = req.user?.id || req.session?.userId || null;
      await pool.query(
        `UPDATE error_logs SET resolved = true, resolved_by = $1, resolved_at = NOW(), resolution_notes = $2 WHERE id = ANY($3::int[])`,
        [userId, notes || null, errorIds]
      );
      res.json({ success: true, resolved: errorIds.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 6: GET /stats - Error statistics and charts
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/admin/error-logs/stats', async (req, res) => {
    try {
      // Level distribution
      const levelRes = await pool.query(
        "SELECT level, COUNT(*)::int AS count FROM error_logs GROUP BY level ORDER BY count DESC"
      );
      // Source distribution
      const sourceRes = await pool.query(
        "SELECT COALESCE(source, 'unknown') AS source, COUNT(*)::int AS count FROM error_logs GROUP BY source ORDER BY count DESC LIMIT 15"
      );
      // Path distribution (top 15)
      const pathRes = await pool.query(
        "SELECT COALESCE(path, 'unknown') AS path, COUNT(*)::int AS count FROM error_logs GROUP BY path ORDER BY count DESC LIMIT 15"
      );
      // Method distribution
      const methodRes = await pool.query(
        "SELECT COALESCE(method, 'unknown') AS method, COUNT(*)::int AS count FROM error_logs GROUP BY method ORDER BY count DESC"
      );
      // Status code distribution
      const statusRes = await pool.query(
        "SELECT status_code, COUNT(*)::int AS count FROM error_logs WHERE status_code IS NOT NULL GROUP BY status_code ORDER BY count DESC LIMIT 10"
      );
      // Hourly distribution (24h)
      const hourlyRes = await pool.query(
        "SELECT EXTRACT(HOUR FROM first_seen)::int AS hour, COUNT(*)::int AS count FROM error_logs GROUP BY hour ORDER BY hour"
      );
      // Resolved vs unresolved
      const resolvedRes = await pool.query(
        "SELECT resolved, COUNT(*)::int AS count FROM error_logs GROUP BY resolved"
      );
      // Average resolution time
      const avgResRes = await pool.query(
        "SELECT AVG(EXTRACT(EPOCH FROM (resolved_at - first_seen)))::int AS avg_seconds FROM error_logs WHERE resolved = true AND resolved_at IS NOT NULL"
      );
      // Most common messages
      const msgRes = await pool.query(
        "SELECT LEFT(message, 120) AS message, COUNT(*)::int AS count FROM error_logs GROUP BY LEFT(message, 120) ORDER BY count DESC LIMIT 10"
      );

      const pieData = levelRes.rows.map(r => ({
        label: (r.level || 'unknown').charAt(0).toUpperCase() + (r.level || 'unknown').slice(1),
        count: r.count,
        color: severityColor(r.level)
      }));

      const hourlyBarData = hourlyRes.rows.map(r => ({
        label: `${r.hour}:00`,
        count: r.count,
        color: r.hour >= 9 && r.hour <= 17 ? '#3b82f6' : '#6366f1'
      }));

      const sourceBarData = sourceRes.rows.map((r, i) => ({
        label: r.source,
        count: r.count,
        color: ['#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#f43f5e', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#0ea5e9', '#2563eb', '#7c3aed'][i % 15]
      }));

      const resolvedTotal = resolvedRes.rows.find(r => r.resolved === true)?.count || 0;
      const unresolvedTotal = resolvedRes.rows.find(r => r.resolved === false)?.count || 0;
      const avgResolutionSec = avgResRes.rows[0]?.avg_seconds || 0;

      const html = `
        ${darkStyles()}
        <div class="container">
          ${dashboardHeader('stats', [{ label: 'Dashboard', href: '/admin/error-logs' }, { label: 'Statistics' }])}
          <div class="stats-grid">
            <div class="stat-card">
              <div class="stat-label">✅ Resolved</div>
              <div class="stat-value" style="color:#4ade80">${resolvedTotal}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">❌ Unresolved</div>
              <div class="stat-value" style="color:#f87171">${unresolvedTotal}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">⏱️ Avg Resolution Time</div>
              <div class="stat-value" style="font-size:1.5rem;">${avgResolutionSec > 3600 ? Math.round(avgResolutionSec / 3600) + 'h' : avgResolutionSec > 60 ? Math.round(avgResolutionSec / 60) + 'm' : avgResolutionSec + 's'}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">📈 Resolution Rate</div>
              <div class="stat-value">${resolvedTotal + unresolvedTotal > 0 ? ((resolvedTotal / (resolvedTotal + unresolvedTotal)) * 100).toFixed(1) : 0}%</div>
            </div>
          </div>
          <div class="chart-row">
            <div class="chart-card">
              <h3>📊 Hourly Distribution (24h)</h3>
              ${buildBarSVG(hourlyBarData, 760, 300, 'Errors by Hour of Day')}
            </div>
          </div>
          <div class="chart-row">
            <div class="chart-card">
              <h3>🎯 Severity Breakdown</h3>
              ${buildPieSVG(pieData, 350, 300)}
            </div>
            <div class="chart-card">
              <h3>📦 Sources</h3>
              ${buildBarSVG(sourceBarData.slice(0, 8), 400, 300, 'Top Error Sources')}
            </div>
          </div>
          <div class="chart-row">
            <div class="card">
              <h2>📋 Top Error Messages</h2>
              <table>
                <thead><tr><th>#</th><th>Message</th><th>Count</th></tr></thead>
                <tbody>
                  ${msgRes.rows.map((r, i) => `<tr><td>${i + 1}</td><td class="truncated" style="max-width:500px;">${h(r.message)}</td><td style="font-weight:700;color:#fbbf24;">${r.count}</td></tr>`).join('')}
                </tbody>
              </table>
            </div>
          </div>
          <div class="chart-row">
            <div class="card">
              <h2>🌐 HTTP Methods</h2>
              <table>
                <thead><tr><th>Method</th><th>Count</th></tr></thead>
                <tbody>
                  ${methodRes.rows.map(r => `<tr><td><span class="tag">${r.method}</span></td><td style="font-weight:600;">${r.count}</td></tr>`).join('')}
                </tbody>
              </table>
            </div>
            <div class="card">
              <h2>🔢 Status Codes</h2>
              <table>
                <thead><tr><th>Status</th><th>Count</th></tr></thead>
                <tbody>
                  ${statusRes.rows.map(r => {
                    const c = r.status_code >= 500 ? '#ef4444' : r.status_code >= 400 ? '#f97316' : '#3b82f6';
                    return `<tr><td style="color:${c};font-weight:700;">${r.status_code}</td><td>${r.count}</td></tr>`;
                  }).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `;
      res.send(opts.renderPage('Error Statistics', html, req.session.user));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 7: GET /aggregates - Grouped similar errors
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/admin/error-logs/aggregates', async (req, res) => {
    try {
      const result = await pool.query(
        'SELECT * FROM error_aggregates ORDER BY total_count DESC NULLS LAST, last_occurrence DESC NULLS LAST LIMIT 50'
      );
      const aggregates = result.rows;

      const html = `
        ${darkStyles()}
        <div class="container">
          ${dashboardHeader('aggregates', [{ label: 'Dashboard', href: '/admin/error-logs' }, { label: 'Aggregates' }])}
          <div class="card">
            <h2>🔀 Error Aggregates <span style="font-size:0.85rem;color:#64748b;font-weight:400;">(${aggregates.length} groups)</span></h2>
            <p style="color:#64748b;margin-bottom:16px;">Similar errors grouped by message hash for pattern analysis.</p>
            <div style="overflow-x:auto;">
              <table>
                <thead>
                  <tr>
                    <th>Hash</th>
                    <th>Level</th>
                    <th>Message</th>
                    <th>Source</th>
                    <th>Total Count</th>
                    <th>Last Occurrence</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  ${aggregates.length === 0 ? `<tr><td colspan="7" class="empty-state"><div class="icon">📭</div><p>No aggregated error data yet.</p></td></tr>` :
                    aggregates.map(a => `<tr>
                      <td style="font-family:monospace;font-size:0.78rem;color:#64748b;">${a.error_hash ? a.error_hash.substring(0, 16) + '…' : '—'}</td>
                      <td><span class="badge badge-${a.level || 'error'}">${severityIcon(a.level)} ${a.level || 'error'}</span></td>
                      <td class="truncated">${h(a.message)}</td>
                      <td><span class="badge badge-source">${h(a.source) || '—'}</span></td>
                      <td style="font-weight:700;color:#fbbf24;">${a.total_count}</td>
                      <td>${fmtTime(a.last_occurrence)}</td>
                      <td>${a.is_resolved ? '<span class="badge badge-resolved">✓ Resolved</span>' : '<span class="badge badge-unresolved">✗ Open</span>'}</td>
                    </tr>`).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `;
      res.send(opts.renderPage('Error Aggregates', html, req.session.user));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 8: GET /by-source/:source - Errors by source/module
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/admin/error-logs/by-source/:source', async (req, res) => {
    try {
      const { source } = req.params;
      const decodedSource = decodeURIComponent(source);
      const countRes = await pool.query(
        "SELECT COUNT(*)::int AS c FROM error_logs WHERE source = $1", [decodedSource]
      );
      const errorRes = await pool.query(
        "SELECT * FROM error_logs WHERE source = $1 ORDER BY last_seen DESC NULLS LAST, id DESC LIMIT 100",
        [decodedSource]
      );
      const errors = errorRes.rows;
      const totalCount = countRes.rows[0].c;

      const html = `
        ${darkStyles()}
        <div class="container">
          ${dashboardHeader('source', [
            { label: 'Dashboard', href: '/admin/error-logs' },
            { label: `Source: ${decodedSource}`, href: `/admin/error-logs/by-source/${source}` }
          ])}
          <div class="stats-grid">
            <div class="stat-card">
              <div class="stat-label">📦 Source</div>
              <div class="stat-value" style="font-size:1.3rem;">${h(decodedSource)}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">📋 Total Errors</div>
              <div class="stat-value">${totalCount}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">❗ Showing</div>
              <div class="stat-value">${errors.length}</div>
            </div>
          </div>
          <div class="card">
            <h2>Errors from: ${h(decodedSource)}</h2>
            <div style="overflow-x:auto;">
              <table>
                <thead>
                  <tr><th>ID</th><th>Level</th><th>Message</th><th>Path</th><th>Status</th><th>Occurrences</th><th>Last Seen</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  ${errors.length === 0 ? `<tr><td colspan="8" class="empty-state"><div class="icon">✅</div><p>No errors from this source.</p></td></tr>` :
                    errors.map(e => `<tr>
                      <td><a href="/admin/error-logs/error/${e.id}" style="color:#60a5fa;">#${e.id}</a></td>
                      <td><span class="badge badge-${e.level}">${severityIcon(e.level)} ${e.level}</span></td>
                      <td class="truncated"><a href="/admin/error-logs/error/${e.id}" style="color:#60a5fa;">${h(e.message)}</a></td>
                      <td style="font-size:0.82rem;color:#64748b;">${h(e.method)} ${h(e.path) || '—'}</td>
                      <td>${e.resolved ? '<span class="badge badge-resolved">✓</span>' : '<span class="badge badge-unresolved">✗</span>'}</td>
                      <td style="font-weight:600;color:#fbbf24;">${e.occurrence_count || 1}</td>
                      <td>${fmtTime(e.last_seen || e.first_seen)}</td>
                      <td>${!e.resolved ? `<form method="POST" action="/admin/error-logs/resolve/${e.id}" style="display:inline;"><button class="btn btn-sm btn-success">Resolve</button></form>` : ''}</td>
                    </tr>`).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `;
      res.send(opts.renderPage(`Source: ${decodedSource}`, html, req.session.user));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 9: GET /export - Export errors as CSV
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/admin/error-logs/export', async (req, res) => {
    try {
      const { level, source, resolved, from_date, to_date } = req.query;
      let where = [];
      let params = [];
      let idx = 1;

      if (level) { where.push(`level = $${idx++}`); params.push(level); }
      if (source) { where.push(`source = $${idx++}`); params.push(source); }
      if (resolved !== undefined && resolved !== '') {
        where.push(`resolved = $${idx++}`);
        params.push(resolved === 'true');
      }
      if (from_date) { where.push(`first_seen >= $${idx++}`); params.push(from_date); }
      if (to_date) { where.push(`first_seen <= $${idx++}`); params.push(to_date + ' 23:59:59'); }

      const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';
      const result = await pool.query(`SELECT * FROM error_logs ${whereClause} ORDER BY id DESC`, params);

      if (req.query.format === 'json') {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename="error-logs-export.json"');
        return res.json(result.rows);
      }

      // CSV format
      const headers = ['id', 'level', 'message', 'source', 'path', 'method', 'status_code', 'user_id', 'ip_address', 'resolved', 'resolved_by', 'resolved_at', 'resolution_notes', 'occurrence_count', 'first_seen', 'last_seen'];
      function csvEscape(val) {
        if (val === null || val === undefined) return '';
        const s = String(val);
        if (s.includes(',') || s.includes('"') || s.includes('\n')) {
          return '"' + s.replace(/"/g, '""') + '"';
        }
        return s;
      }

      let csv = headers.join(',') + '\n';
      result.rows.forEach(row => {
        csv += headers.map(h => csvEscape(row[h])).join(',') + '\n';
      });

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="error-logs-${new Date().toISOString().substring(0, 10)}.csv"`);
      res.send(csv);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 10: DELETE /cleanup - Clean old resolved errors
  // ═══════════════════════════════════════════════════════════════════════════
  app.delete('/admin/error-logs/cleanup', async (req, res) => {
    try {
      const { older_than_days = '30' } = req.body;
      const days = Math.max(1, parseInt(older_than_days));
      const result = await pool.query(
        `DELETE FROM error_logs WHERE resolved = true AND resolved_at < NOW() - INTERVAL '1 day' * $1`,
        [days]
      );
      // Also clean resolved aggregates
      const aggResult = await pool.query(
        `DELETE FROM error_aggregates WHERE is_resolved = true AND last_occurrence < NOW() - INTERVAL '1 day' * $1`,
        [days]
      );
      res.json({
        success: true,
        deleted_logs: result.rowCount,
        deleted_aggregates: aggResult.rowCount,
        older_than_days: days
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 11: POST /ignore - Ignore error pattern
  // ═══════════════════════════════════════════════════════════════════════════
  app.post('/admin/error-logs/ignore', async (req, res) => {
    try {
      const { pattern, notes } = req.body;
      if (!pattern) {
        return res.status(400).json({ error: 'Pattern is required' });
      }
      // Resolve all matching errors and add notes
      const result = await pool.query(
        `UPDATE error_logs SET resolved = true, resolved_at = NOW(), resolution_notes = CONCAT($1, ' | Auto-ignored: ', COALESCE(resolution_notes, ''))
         WHERE message ILIKE $2 AND resolved = false`,
        [notes || 'Ignored pattern', `%${pattern}%`]
      );
      // Update aggregates
      await pool.query(
        `UPDATE error_aggregates SET is_resolved = true WHERE message ILIKE $1 AND is_resolved = false`,
        [`%${pattern}%`]
      );
      res.json({
        success: true,
        pattern: pattern,
        affected: result.rowCount
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 12: GET /settings - Error logging settings
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/admin/error-logs/settings', async (req, res) => {
    try {
      const settings = {
        logLevels: ['critical', 'error', 'warning', 'info', 'debug'],
        retentionDays: 90,
        maxStackTraceLength: 10000,
        aggregateEnabled: true,
        autoAggregateWindow: '1 hour',
        notifyOnCritical: true,
        notifyOnNewError: false,
        enableRequestBodyCapture: true,
        enableRequestHeaderCapture: true,
        sanitizeUserAgent: true,
        maxRequestBodySize: 4096,
        ignoredPatterns: [],
        cleanupSchedule: '0 2 * * *',
        maxErrorsPerMinute: 100
      };

      const html = `
        ${darkStyles()}
        <div class="container">
          ${dashboardHeader('settings', [{ label: 'Dashboard', href: '/admin/error-logs' }, { label: 'Settings' }])}
          <div class="card">
            <h2>⚙️ Error Logging Configuration</h2>
            <p style="color:#64748b;margin-bottom:20px;">Configure how errors are captured, stored, and processed.</p>
            <div class="meta-grid">
              <div class="meta-item"><div class="meta-key">Log Levels</div><div class="meta-val">${settings.logLevels.map(l => `<span class="tag" style="border:1px solid ${severityColor(l)};color:${severityColor(l)}">${l}</span>`).join(' ')}</div></div>
              <div class="meta-item"><div class="meta-key">Retention Period</div><div class="meta-val">${settings.retentionDays} days</div></div>
              <div class="meta-item"><div class="meta-key">Max Stack Trace Length</div><div class="meta-val">${settings.maxStackTraceLength.toLocaleString()} chars</div></div>
              <div class="meta-item"><div class="meta-key">Auto-Aggregate</div><div class="meta-val">${settings.aggregateEnabled ? '✅ Enabled' : '❌ Disabled'} (${settings.autoAggregateWindow})</div></div>
              <div class="meta-item"><div class="meta-key">Critical Notifications</div><div class="meta-val">${settings.notifyOnCritical ? '✅ Enabled' : '❌ Disabled'}</div></div>
              <div class="meta-item"><div class="meta-key">New Error Notifications</div><div class="meta-val">${settings.notifyOnNewError ? '✅ Enabled' : '❌ Disabled'}</div></div>
              <div class="meta-item"><div class="meta-key">Request Body Capture</div><div class="meta-val">${settings.enableRequestBodyCapture ? '✅ Enabled' : '❌ Disabled'}</div></div>
              <div class="meta-item"><div class="meta-key">Request Header Capture</div><div class="meta-val">${settings.enableRequestHeaderCapture ? '✅ Enabled' : '❌ Disabled'}</div></div>
              <div class="meta-item"><div class="meta-key">Max Request Body Size</div><div class="meta-val">${settings.maxRequestBodySize.toLocaleString()} bytes</div></div>
              <div class="meta-item"><div class="meta-key">Cleanup Schedule</div><div class="meta-val" style="font-family:monospace;">${settings.cleanupSchedule}</div></div>
              <div class="meta-item"><div class="meta-key">Max Errors/Minute</div><div class="meta-val">${settings.maxErrorsPerMinute}</div></div>
              <div class="meta-item"><div class="meta-key">Sanitize User Agent</div><div class="meta-val">${settings.sanitizeUserAgent ? '✅ Enabled' : '❌ Disabled'}</div></div>
            </div>
          </div>
          <div class="card">
            <h2>🧹 Maintenance Actions</h2>
            <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:8px;">
              <form method="POST" action="/admin/error-logs/ignore" style="display:flex;gap:8px;align-items:center;">
                <input type="text" name="pattern" placeholder="Ignore pattern (e.g., timeout)" style="background:#0f172a;color:#e2e8f0;border:1px solid #334155;padding:8px 14px;border-radius:8px;font-size:0.88rem;min-width:200px;">
                <input type="text" name="notes" placeholder="Notes (optional)" style="background:#0f172a;color:#e2e8f0;border:1px solid #334155;padding:8px 14px;border-radius:8px;font-size:0.88rem;min-width:200px;">
                <button class="btn btn-warning-outline" type="submit">Ignore Pattern</button>
              </form>
              <button class="btn btn-danger" onclick="cleanupResolved()" style="margin-left:16px;">🗑️ Cleanup Old Resolved</button>
            </div>
          </div>
          <div class="card">
            <h2>🧪 Test & Verification</h2>
            <div style="display:flex;gap:12px;flex-wrap:wrap;">
              <form method="POST" action="/admin/error-logs/test-error" style="display:flex;gap:8px;">
                <select name="level" style="background:#0f172a;color:#e2e8f0;border:1px solid #334155;padding:8px 14px;border-radius:8px;font-size:0.88rem;">
                  <option value="error">Error</option>
                  <option value="critical">Critical</option>
                  <option value="warning">Warning</option>
                  <option value="info">Info</option>
                </select>
                <input type="text" name="message" value="Test error from dashboard" style="background:#0f172a;color:#e2e8f0;border:1px solid #334155;padding:8px 14px;border-radius:8px;font-size:0.88rem;min-width:250px;">
                <button class="btn btn-primary" type="submit">Generate Test Error</button>
              </form>
            </div>
          </div>
          <script>
            function cleanupResolved() {
              if (!confirm('Delete all resolved errors older than 30 days? This cannot be undone.')) return;
              fetch('/admin/error-logs/cleanup', { method: 'DELETE', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({older_than_days: '30'}) })
                .then(r => r.json()).then(d => {
                  alert('Cleanup complete: ' + d.deleted_logs + ' logs and ' + d.deleted_aggregates + ' aggregates removed.');
                  location.reload();
                });
            }
          </script>
        </div>
      `;
      res.send(opts.renderPage('Error Log Settings', html, req.session.user));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 13: GET /trends - Error trends over time (SVG chart)
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/admin/error-logs/trends', async (req, res) => {
    try {
      const { days = '30' } = req.query;
      const numDays = Math.min(90, Math.max(7, parseInt(days)));

      // Overall trend
      const trendRes = await pool.query(`
        SELECT d::date AS day, COALESCE(cnt, 0) AS count
        FROM generate_series(CURRENT_DATE - INTERVAL '${numDays - 1} days', CURRENT_DATE, '1 day') d
        LEFT JOIN (
          SELECT first_seen::date AS fd, COUNT(*)::int AS cnt
          FROM error_logs WHERE first_seen >= CURRENT_DATE - INTERVAL '${numDays - 1} days'
          GROUP BY first_seen::date
        ) sub ON sub.fd = d
        ORDER BY d
      `);

      // Per-level trend
      const levelTrendRes = await pool.query(`
        SELECT first_seen::date AS day, level, COUNT(*)::int AS count
        FROM error_logs
        WHERE first_seen >= CURRENT_DATE - INTERVAL '${numDays - 1} days'
        GROUP BY first_seen::date, level
        ORDER BY day
      `);

      // Build per-level series
      const levelSeries = {};
      trendRes.rows.forEach(r => {
        const label = (r.day || '').substring(5);
        Object.keys(levelSeries).forEach(k => levelSeries[k].push({ label, count: 0 }));
      });
      levelTrendRes.rows.forEach(r => {
        if (!levelSeries[r.level]) levelSeries[r.level] = [];
        const label = (r.day || '').substring(5);
        const idx = trendRes.rows.findIndex(t => (t.day || '').substring(5) === label);
        if (idx >= 0) {
          levelSeries[r.level][idx] = { label, count: r.count };
        }
      });
      // Fill gaps
      Object.keys(levelSeries).forEach(level => {
        for (let i = 0; i < trendRes.rows.length; i++) {
          if (!levelSeries[level][i]) {
            levelSeries[level][i] = { label: (trendRes.rows[i].day || '').substring(5), count: 0 };
          }
        }
      });

      const overallTrend = trendRes.rows.map(r => ({
        label: (r.day || '').substring(5),
        count: r.count
      }));

      // Week-over-week comparison
      const thisWeekRes = await pool.query(
        "SELECT COUNT(*)::int AS c FROM error_logs WHERE first_seen >= date_trunc('week', CURRENT_DATE)"
      );
      const lastWeekRes = await pool.query(
        "SELECT COUNT(*)::int AS c FROM error_logs WHERE first_seen >= date_trunc('week', CURRENT_DATE) - INTERVAL '1 week' AND first_seen < date_trunc('week', CURRENT_DATE)"
      );
      const thisWeek = thisWeekRes.rows[0].c;
      const lastWeek = lastWeekRes.rows[0].c;
      const wowChange = lastWeek > 0 ? (((thisWeek - lastWeek) / lastWeek) * 100).toFixed(1) : (thisWeek > 0 ? 100 : 0);

      // Build multi-line SVG
      const levelColors = { critical: '#ef4444', error: '#f97316', warning: '#eab308', info: '#3b82f6', debug: '#8b5cf6' };
      let multiLineSVG = '';
      if (Object.keys(levelSeries).length > 0) {
        const width = 800;
        const height = 400;
        const pad = { top: 50, right: 30, bottom: 60, left: 60 };
        const chartW = width - pad.left - pad.right;
        const chartH = height - pad.top - pad.bottom;
        const allCounts = Object.values(levelSeries).flatMap(s => s.map(d => d.count));
        const maxVal = Math.max(...allCounts, 1);
        const dataLen = overallTrend.length;
        const stepX = dataLen > 1 ? chartW / (dataLen - 1) : chartW;

        let gridLines = '';
        for (let i = 0; i <= 5; i++) {
          const y = pad.top + (chartH / 5) * i;
          const val = Math.round(maxVal - (maxVal / 5) * i);
          gridLines += `<line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" stroke="#334155" stroke-width="1" stroke-dasharray="4,4"/>`;
          gridLines += `<text x="${pad.left - 10}" y="${y + 4}" text-anchor="end" fill="#64748b" font-size="11" font-family="system-ui">${val}</text>`;
        }

        let labelsHTML = '';
        const labelStep = Math.max(1, Math.floor(dataLen / 15));
        for (let i = 0; i < dataLen; i += labelStep) {
          const x = pad.left + stepX * i;
          labelsHTML += `<text x="${x}" y="${height - pad.bottom + 20}" text-anchor="middle" fill="#64748b" font-size="10" font-family="system-ui" transform="rotate(-30 ${x} ${height - pad.bottom + 20})">${overallTrend[i].label || ''}</text>`;
        }

        let linesHTML = '';
        Object.keys(levelSeries).forEach(level => {
          const series = levelSeries[level];
          const color = levelColors[level] || '#94a3b8';
          let pathD = '';
          series.forEach((d, i) => {
            const x = pad.left + stepX * i;
            const y = pad.top + chartH - (d.count / maxVal) * chartH;
            pathD += (i === 0 ? 'M' : 'L') + ` ${x} ${y} `;
          });
          linesHTML += `<path d="${pathD}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.8"/>`;
        });

        multiLineSVG = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
          <rect width="${width}" height="${height}" fill="#1e293b" rx="8"/>
          <text x="${width / 2}" y="30" text-anchor="middle" fill="#e2e8f0" font-size="15" font-weight="600" font-family="system-ui">Error Trends by Severity (${numDays} days)</text>
          ${gridLines}
          ${linesHTML}
          ${labelsHTML}
          ${Object.keys(levelSeries).map((level, i) => `<rect x="${width - pad.right - 140}" y="${pad.top + i * 22}" width="12" height="12" rx="3" fill="${levelColors[level] || '#94a3b8'}"/><text x="${width - pad.right - 122}" y="${pad.top + i * 22 + 11}" fill="#cbd5e1" font-size="11" font-family="system-ui">${level}</text>`).join('')}
        </svg>`;
      }

      const html = `
        ${darkStyles()}
        <div class="container">
          ${dashboardHeader('trends', [{ label: 'Dashboard', href: '/admin/error-logs' }, { label: 'Trends' }])}
          <div class="stats-grid">
            <div class="stat-card">
              <div class="stat-label">📅 This Week</div>
              <div class="stat-value">${thisWeek}</div>
              <div class="stat-change ${parseFloat(wowChange) > 0 ? 'up' : 'down'}">${wowChange > 0 ? '↑' : '↓'} ${Math.abs(wowChange)}% vs last week</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">📆 Last Week</div>
              <div class="stat-value">${lastWeek}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">📊 Period</div>
              <div class="stat-value" style="font-size:1.3rem;">${numDays} days</div>
            </div>
          </div>
          <div class="chart-row full">
            <div class="chart-card">
              <h3>📈 Overall Error Trend</h3>
              ${buildTrendSVG(overallTrend, 800, 300, `Errors per Day (Last ${numDays} days)`)}
            </div>
          </div>
          <div class="chart-row full">
            <div class="chart-card">
              <h3>📊 Trends by Severity Level</h3>
              ${multiLineSVG || '<p style="color:#64748b;text-align:center;padding:40px;">No multi-level trend data</p>'}
            </div>
          </div>
          <div class="card">
            <h2>⏱️ Quick Period Select</h2>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <a href="/admin/error-logs/trends?days=7" class="btn btn-outline ${numDays === 7 ? 'active' : ''}">7 Days</a>
              <a href="/admin/error-logs/trends?days=14" class="btn btn-outline ${numDays === 14 ? 'active' : ''}">14 Days</a>
              <a href="/admin/error-logs/trends?days=30" class="btn btn-outline ${numDays === 30 ? 'active' : ''}">30 Days</a>
              <a href="/admin/error-logs/trends?days=60" class="btn btn-outline ${numDays === 60 ? 'active' : ''}">60 Days</a>
              <a href="/admin/error-logs/trends?days=90" class="btn btn-outline ${numDays === 90 ? 'active' : ''}">90 Days</a>
            </div>
          </div>
        </div>
      `;
      res.send(opts.renderPage('Error Trends', html, req.session.user));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 14: GET /critical - Critical errors only
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/admin/error-logs/critical', async (req, res) => {
    try {
      const { resolved = 'false' } = req.query;
      const showResolved = resolved === 'true';
      let whereClause = "WHERE level = 'critical'";
      if (!showResolved) whereClause += ' AND resolved = false';

      const countRes = await pool.query(`SELECT COUNT(*)::int AS c FROM error_logs ${whereClause}`);
      const totalCount = countRes.rows[0].c;

      const errorRes = await pool.query(
        `SELECT * FROM error_logs ${whereClause} ORDER BY last_seen DESC NULLS LAST, id DESC LIMIT 100`
      );
      const errors = errorRes.rows;

      const html = `
        ${darkStyles()}
        <div class="container">
          ${dashboardHeader('critical', [{ label: 'Dashboard', href: '/admin/error-logs' }, { label: 'Critical Errors' }])}
          <div class="stats-grid">
            <div class="stat-card" style="border-color:#7f1d1d;">
              <div class="stat-label">🔥 Critical Errors</div>
              <div class="stat-value" style="color:#ef4444">${totalCount}</div>
              <div class="stat-change" style="color:#f87171;">Requires immediate attention</div>
            </div>
          </div>
          <div class="card">
            <div class="flex-between">
              <h2>🔴 Critical Errors (${errors.length})</h2>
              <div style="display:flex;gap:8px;align-items:center;">
                <span style="font-size:0.85rem;color:#64748b;">Show resolved:</span>
                <a href="/admin/error-logs/critical?resolved=${showResolved ? 'false' : 'true'}" class="btn btn-sm ${showResolved ? 'btn-outline active' : 'btn-ghost'}">${showResolved ? 'Yes' : 'No'}</a>
              </div>
            </div>
            <div style="overflow-x:auto;">
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Message</th>
                    <th>Source</th>
                    <th>Path</th>
                    <th>Status Code</th>
                    <th>Occurrences</th>
                    <th>Last Seen</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${errors.length === 0 ? `<tr><td colspan="9" class="empty-state"><div class="icon">🎉</div><p>No critical errors ${showResolved ? 'found' : '— system looks healthy!'}</p></td></tr>` :
                    errors.map(e => `<tr style="border-left:3px solid #ef4444;">
                      <td><a href="/admin/error-logs/error/${e.id}" style="color:#60a5fa;">#${e.id}</a></td>
                      <td class="truncated"><a href="/admin/error-logs/error/${e.id}" style="color:#fca5a5;">${h(e.message)}</a></td>
                      <td><span class="badge badge-source">${h(e.source) || '—'}</span></td>
                      <td style="font-size:0.82rem;color:#64748b;">${h(e.method)} ${h(e.path) || '—'}</td>
                      <td style="color:#f87171;font-weight:700;">${e.status_code || '—'}</td>
                      <td style="font-weight:700;color:#fbbf24;">${e.occurrence_count || 1}</td>
                      <td>${fmtTime(e.last_seen || e.first_seen)}</td>
                      <td>${e.resolved ? '<span class="badge badge-resolved">✓</span>' : '<span class="badge badge-unresolved">✗</span>'}</td>
                      <td>
                        <a href="/admin/error-logs/error/${e.id}" class="btn btn-sm btn-ghost">View</a>
                        ${!e.resolved ? `<form method="POST" action="/admin/error-logs/resolve/${e.id}" style="display:inline;"><button class="btn btn-sm btn-success">Resolve</button></form>` : ''}
                      </td>
                    </tr>`).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `;
      res.send(opts.renderPage('Critical Errors', html, req.session.user));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 15: GET /unresolved - Unresolved errors only
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/admin/error-logs/unresolved', async (req, res) => {
    try {
      const { level } = req.query;
      let whereClause = 'WHERE resolved = false';
      let params = [];
      if (level) {
        whereClause += ' AND level = $1';
        params.push(level);
      }

      const countRes = await pool.query(`SELECT COUNT(*)::int AS c FROM error_logs ${whereClause}`, params);
      const totalCount = countRes.rows[0].c;

      // Level breakdown of unresolved
      const sevRes = await pool.query(
        "SELECT level, COUNT(*)::int AS count FROM error_logs WHERE resolved = false GROUP BY level ORDER BY count DESC"
      );

      const errorRes = await pool.query(
        `SELECT * FROM error_logs ${whereClause} ORDER BY
          CASE level WHEN 'critical' THEN 0 WHEN 'error' THEN 1 WHEN 'warning' THEN 2 WHEN 'info' THEN 3 WHEN 'debug' THEN 4 ELSE 5 END,
          last_seen DESC NULLS LAST, id DESC LIMIT 100`,
        params
      );
      const errors = errorRes.rows;

      const pieData = sevRes.rows.map(r => ({
        label: (r.level || 'unknown').charAt(0).toUpperCase() + (r.level || 'unknown').slice(1),
        count: r.count,
        color: severityColor(r.level)
      }));

      const html = `
        ${darkStyles()}
        <div class="container">
          ${dashboardHeader('unresolved', [{ label: 'Dashboard', href: '/admin/error-logs' }, { label: 'Unresolved' }])}
          <div class="stats-grid">
            <div class="stat-card">
              <div class="stat-label">❗ Unresolved Errors</div>
              <div class="stat-value" style="color:#f87171">${totalCount}</div>
            </div>
            ${sevRes.rows.map(r => `<div class="stat-card">
              <div class="stat-label">${severityIcon(r.level)} ${r.level}</div>
              <div class="stat-value" style="color:${severityColor(r.level)}">${r.count}</div>
            </div>`).join('')}
          </div>
          <div class="chart-row">
            <div class="card" style="flex:1;">
              <h2>❗ Unresolved Errors (${errors.length} shown)</h2>
              <div class="filter-bar">
                <a href="/admin/error-logs/unresolved" class="btn btn-sm ${!level ? 'btn-outline active' : 'btn-ghost'}">All</a>
                ${['critical', 'error', 'warning', 'info', 'debug'].map(l => `<a href="/admin/error-logs/unresolved?level=${l}" class="btn btn-sm ${level === l ? 'btn-outline active' : 'btn-ghost'}">${severityIcon(l)} ${l}</a>`).join('')}
                <span style="margin-left:auto;font-size:0.85rem;color:#64748b;">Bulk actions:</span>
                <button class="btn btn-sm btn-success" onclick="bulkResolve()">✓ Resolve Visible</button>
              </div>
              <div style="overflow-x:auto;">
                <table>
                  <thead>
                    <tr>
                      <th><input type="checkbox" id="selectAll" onchange="toggleAll(this)"></th>
                      <th>Severity</th>
                      <th>Message</th>
                      <th>Source</th>
                      <th>Path</th>
                      <th>Occurrences</th>
                      <th>First Seen</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${errors.length === 0 ? `<tr><td colspan="8" class="empty-state"><div class="icon">🎉</div><p>All errors resolved! Great work!</p></td></tr>` :
                      errors.map(e => `<tr>
                        <td><input type="checkbox" class="error-cb" value="${e.id}"></td>
                        <td><span class="badge badge-${e.level}">${severityIcon(e.level)} ${e.level}</span></td>
                        <td class="truncated"><a href="/admin/error-logs/error/${e.id}" style="color:#60a5fa;">${h(e.message)}</a></td>
                        <td><span class="badge badge-source">${h(e.source) || '—'}</span></td>
                        <td style="font-size:0.82rem;color:#64748b;">${h(e.method)} ${h(e.path) || '—'}</td>
                        <td style="font-weight:600;color:#fbbf24;">${e.occurrence_count || 1}</td>
                        <td>${fmtTime(e.first_seen)}</td>
                        <td>
                          <a href="/admin/error-logs/error/${e.id}" class="btn btn-sm btn-ghost">View</a>
                          <form method="POST" action="/admin/error-logs/resolve/${e.id}" style="display:inline;">
                            <input type="hidden" name="redirect" value="/admin/error-logs/unresolved${level ? '?level=' + level : ''}">
                            <button class="btn btn-sm btn-success">✓</button>
                          </form>
                        </td>
                      </tr>`).join('')}
                  </tbody>
                </table>
              </div>
            </div>
            <div style="min-width:280px;">
              <div class="card">
                <h3>📊 Severity Breakdown</h3>
                ${buildPieSVG(pieData, 250, 250, 'Unresolved')}
              </div>
            </div>
          </div>
          <script>
            function toggleAll(master) {
              document.querySelectorAll('.error-cb').forEach(cb => cb.checked = master.checked);
            }
            function bulkResolve() {
              const ids = Array.from(document.querySelectorAll('.error-cb:checked')).map(cb => parseInt(cb.value));
              if (ids.length === 0) { alert('Select errors first'); return; }
              if (!confirm('Resolve ' + ids.length + ' selected errors?')) return;
              fetch('/admin/error-logs/bulk-resolve', {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ ids, notes: 'Bulk resolved from dashboard' })
              }).then(r => r.json()).then(d => {
                alert('Resolved ' + d.resolved + ' errors');
                location.reload();
              });
            }
          </script>
        </div>
      `;
      res.send(opts.renderPage('Unresolved Errors', html, req.session.user));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 16: POST /test-error - Generate test error
  // ═══════════════════════════════════════════════════════════════════════════
  app.post('/admin/error-logs/test-error', async (req, res) => {
    try {
      const { level = 'error', message = 'Test error generated from dashboard' } = req.body;
      const userId = req.user?.id || req.session?.userId || null;
      const testStackTrace = `Error: ${message}
    at Object.<anonymous> (/app/test-error-generator.js:${Math.floor(Math.random() * 200)}:${Math.floor(Math.random() * 50)})
    at Module._compile (node:internal/modules/cjs/loader:1356:14)
    at Module._extensions..js (node:internal/modules/cjs/loader:1414:10)
    at Module.load (node:internal/modules/cjs/loader:983:32)
    at Function.Module._load (node:internal/modules/cjs/loader:812:3)
    at Function.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:81:12)
    at node:internal/main/run_main_module:23:47`;

      const result = await pool.query(
        `INSERT INTO error_logs (level, message, stack_trace, source, path, method, status_code, user_id, ip_address, user_agent, request_body, request_headers, school_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
        [
          level,
          `[TEST] ${message} (generated at ${new Date().toISOString()})`,
          testStackTrace,
          'test-dashboard',
          '/admin/error-logs/test-error',
          'POST',
          200,
          userId,
          req.ip || req.connection?.remoteAddress || '127.0.0.1',
          req.get('User-Agent') || 'Test Agent',
          JSON.stringify({ test: true, timestamp: new Date().toISOString() }),
          JSON.stringify({ 'content-type': 'application/x-www-form-urlencoded' }),
          1
        ]
      );

      // Update or create aggregate
      const errorHash = require('crypto').createHash('md5').update(message + 'test-dashboard').digest('hex').substring(0, 32);
      await pool.query(
        `INSERT INTO error_aggregates (error_hash, level, message, source, total_count, last_occurrence, school_id)
         VALUES ($1, $2, $3, $4, 1, NOW(), $5)
         ON CONFLICT (error_hash) DO UPDATE SET total_count = error_aggregates.total_count + 1, last_occurrence = NOW()`,
        [errorHash, level, message, 'test-dashboard', 1]
      );

      res.redirect(`/admin/error-logs/error/${result.rows[0].id}`);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 17: GET /frequency - Most frequent errors
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/admin/error-logs/frequency', async (req, res) => {
    try {
      const { limit = '20' } = req.query;
      const numLimit = Math.min(100, Math.max(5, parseInt(limit)));

      // Most frequent by message
      const freqRes = await pool.query(
        `SELECT LEFT(message, 200) AS message, level, COUNT(*)::int AS total, COUNT(*) FILTER (WHERE resolved = false)::int AS open_count,
                MAX(last_seen) AS last_seen, MIN(first_seen) AS first_seen
         FROM error_logs
         GROUP BY LEFT(message, 200), level
         ORDER BY total DESC
         LIMIT $1`,
        [numLimit]
      );

      // Most frequent by source
      const sourceFreqRes = await pool.query(
        `SELECT COALESCE(source, 'unknown') AS source, COUNT(*)::int AS total, COUNT(*) FILTER (WHERE resolved = false)::int AS open_count
         FROM error_logs GROUP BY source ORDER BY total DESC LIMIT 15`
      );

      // Most frequent by path
      const pathFreqRes = await pool.query(
        `SELECT COALESCE(path, 'unknown') AS path, method, COUNT(*)::int AS total
         FROM error_logs GROUP BY path, method ORDER BY total DESC LIMIT 15`
      );

      const barData = freqRes.rows.slice(0, 10).map((r, i) => ({
        label: r.message.length > 35 ? r.message.substring(0, 32) + '…' : r.message,
        count: r.total,
        color: severityColor(r.level)
      }));

      const html = `
        ${darkStyles()}
        <div class="container">
          ${dashboardHeader('frequency', [{ label: 'Dashboard', href: '/admin/error-logs' }, { label: 'Frequency' }])}
          <div class="chart-row full">
            <div class="chart-card">
              <h3>📊 Top 10 Most Frequent Error Messages</h3>
              ${buildBarSVG(barData, 800, 350, 'Error Frequency')}
            </div>
          </div>
          <div class="card">
            <h2>📋 Most Frequent Errors (${numLimit})</h2>
            <p style="color:#64748b;margin-bottom:16px;">Errors grouped by message, sorted by total occurrence count.</p>
            <div style="overflow-x:auto;">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Message</th>
                    <th>Level</th>
                    <th>Total Count</th>
                    <th>Open</th>
                    <th>First Seen</th>
                    <th>Last Seen</th>
                  </tr>
                </thead>
                <tbody>
                  ${freqRes.rows.map((r, i) => `<tr>
                    <td style="font-weight:600;color:#64748b;">${i + 1}</td>
                    <td style="max-width:400px;word-break:break-word;">${h(r.message)}</td>
                    <td><span class="badge badge-${r.level}">${severityIcon(r.level)} ${r.level}</span></td>
                    <td style="font-weight:700;color:#fbbf24;font-size:1.1rem;">${r.total}</td>
                    <td style="font-weight:600;color:${r.open_count > 0 ? '#f87171' : '#4ade80'};">${r.open_count}</td>
                    <td>${fmtTime(r.first_seen)}</td>
                    <td>${fmtTime(r.last_seen)}</td>
                  </tr>`).join('')}
                </tbody>
              </table>
            </div>
          </div>
          <div class="chart-row">
            <div class="card">
              <h2>📦 Frequency by Source</h2>
              <table>
                <thead><tr><th>Source</th><th>Total</th><th>Open</th></tr></thead>
                <tbody>
                  ${sourceFreqRes.rows.map(r => `<tr>
                    <td><a href="/admin/error-logs/by-source/${encodeURIComponent(r.source)}" style="color:#60a5fa;text-decoration:none;"><span class="badge badge-source">${h(r.source)}</span></a></td>
                    <td style="font-weight:600;">${r.total}</td>
                    <td style="color:${r.open_count > 0 ? '#f87171' : '#4ade80'};">${r.open_count}</td>
                  </tr>`).join('')}
                </tbody>
              </table>
            </div>
            <div class="card">
              <h2>🌐 Frequency by Path</h2>
              <table>
                <thead><tr><th>Path</th><th>Method</th><th>Total</th></tr></thead>
                <tbody>
                  ${pathFreqRes.rows.map(r => `<tr>
                    <td style="font-family:monospace;font-size:0.82rem;color:#94a3b8;max-width:250px;" class="truncated">${h(r.path)}</td>
                    <td><span class="tag">${r.method || '—'}</span></td>
                    <td style="font-weight:600;">${r.total}</td>
                  </tr>`).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `;
      res.send(opts.renderPage('Error Frequency', html, req.session.user));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
