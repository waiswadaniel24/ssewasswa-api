/**
 * School SaaS Portal — Custom Dashboard Builder
 * Admins create personalized dashboards with widget cards (KPIs, charts, tables, quick actions).
 * Self-contained Express module with inline CSS and SVG chart rendering.
 */
const { migrateQuery } = require('./db');
module.exports = function(app, pool, opts) {
  const esc = opts.esc || (s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'));
  const renderPage = opts.renderPage || ((t,c,u) => c);
  const ah = opts.ah || ((fn) => async (req,res,next) => { try { await fn(req,res,next); } catch(e) { res.status(500).send('Error: '+e.message); }});
  const requireAuth = opts.requireAuth || ((req,res,next) => { if(!req.session?.user) return res.redirect('/login'); next(); });
  const audit = opts.audit || (() => {});
  const tenantId = (req) => req.session?.user?.tenant_id || 0;
  const userSlug = (req) => req.session?.user?.username || req.session?.user?.email || 'unknown';

  // ──────────────────────────── Migrations ────────────────────────────
  (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS custom_dashboards (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, title VARCHAR(255),
        description TEXT, is_default BOOLEAN DEFAULT false,
        shared_with JSONB DEFAULT '[]', columns INT DEFAULT 3,
        created_by VARCHAR(255), created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
    await migrateQuery(pool, 'DashboardBuilder', `
      CREATE TABLE IF NOT EXISTS dashboard_widgets (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL,
        dashboard_id INT REFERENCES custom_dashboards(id) ON DELETE CASCADE,
        widget_type VARCHAR(50), title VARCHAR(255), position INT DEFAULT 0,
        col INT DEFAULT 1, config JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
    await migrateQuery(pool, 'DashboardBuilder', `CREATE INDEX IF NOT EXISTS idx_cd_tenant ON custom_dashboards(tenant_id)`);
    await migrateQuery(pool, 'DashboardBuilder', `CREATE INDEX IF NOT EXISTS idx_dw_tenant_did ON dashboard_widgets(tenant_id, dashboard_id)`);
  })();

  // ──────────────────────────── Inline CSS ────────────────────────────
  const CSS = `
    <style>
      .db-wrap{font-family:'Segoe UI',system-ui,-apple-system,sans-serif;max-width:1400px;margin:0 auto;padding:24px;color:#1f2937}
      .db-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:28px;flex-wrap:wrap;gap:12px}
      .db-header h1{font-size:1.75rem;font-weight:700;margin:0;color:#111827}
      .db-header p.sub{margin:4px 0 0;color:#6b7280;font-size:.95rem}
      .db-btn{display:inline-flex;align-items:center;gap:6px;padding:8px 18px;border-radius:8px;border:none;cursor:pointer;font-size:.875rem;font-weight:600;transition:all .15s}
      .db-btn-primary{background:#4f46e5;color:#fff}.db-btn-primary:hover{background:#4338ca}
      .db-btn-secondary{background:#f3f4f6;color:#374151;border:1px solid #d1d5db}.db-btn-secondary:hover{background:#e5e7eb}
      .db-btn-danger{background:#fee2e2;color:#dc2626;border:1px solid #fecaca}.db-btn-danger:hover{background:#fecaca}
      .db-btn-sm{padding:5px 12px;font-size:.8rem;border-radius:6px}
      .db-grid{display:grid;gap:20px}
      .db-grid-2{grid-template-columns:repeat(auto-fill,minmax(320px,1fr))}
      .db-grid-3{grid-template-columns:repeat(auto-fill,minmax(300px,1fr))}
      .db-grid-4{grid-template-columns:repeat(auto-fill,minmax(260px,1fr))}
      .db-card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px;transition:box-shadow .15s}
      .db-card:hover{box-shadow:0 4px 16px rgba(0,0,0,.07)}
      .db-card h3{margin:0 0 6px;font-size:1rem;font-weight:600;color:#111827}
      .db-card .desc{font-size:.85rem;color:#6b7280;margin-bottom:12px}
      .db-card .meta{font-size:.75rem;color:#9ca3af}
      .db-form-group{margin-bottom:18px}
      .db-form-group label{display:block;font-size:.85rem;font-weight:600;margin-bottom:5px;color:#374151}
      .db-input,.db-select,.db-textarea{width:100%;padding:9px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:.9rem;color:#1f2937;background:#fff;box-sizing:border-box}
      .db-input:focus,.db-select:focus,.db-textarea:focus{outline:none;border-color:#4f46e5;box-shadow:0 0 0 3px rgba(79,70,229,.12)}
      .db-textarea{resize:vertical;min-height:80px}
      .db-widget{background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;transition:box-shadow .15s}
      .db-widget:hover{box-shadow:0 4px 16px rgba(0,0,0,.07)}
      .db-widget-head{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid #f3f4f6}
      .db-widget-head h4{margin:0;font-size:.9rem;font-weight:600;color:#111827}
      .db-widget-body{padding:18px}
      .db-stat{display:flex;align-items:center;gap:16px}
      .db-stat-icon{width:52px;height:52px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:1.4rem;flex-shrink:0}
      .db-stat-label{font-size:.82rem;color:#6b7280;margin-bottom:2px}
      .db-stat-value{font-size:1.6rem;font-weight:700;color:#111827}
      .db-stat-change{font-size:.75rem;margin-top:2px}
      .db-stat-change.up{color:#059669}.db-stat-change.down{color:#dc2626}
      .db-table{width:100%;border-collapse:collapse;font-size:.85rem}
      .db-table th{text-align:left;padding:8px 10px;background:#f9fafb;color:#6b7280;font-weight:600;border-bottom:2px solid #e5e7eb}
      .db-table td{padding:8px 10px;border-bottom:1px solid #f3f4f6;color:#374151}
      .db-table tr:hover td{background:#f9fafb}
      .db-activity{list-style:none;padding:0;margin:0}
      .db-activity li{display:flex;gap:10px;padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:.85rem}
      .db-activity li:last-child{border-bottom:none}
      .db-activity-dot{width:8px;height:8px;border-radius:50%;margin-top:6px;flex-shrink:0}
      .db-activity-text{color:#374151}.db-activity-time{color:#9ca3af;font-size:.75rem}
      .db-actions-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px}
      .db-action-btn{display:flex;flex-direction:column;align-items:center;gap:6px;padding:14px 8px;border:1px solid #e5e7eb;border-radius:10px;background:#fff;cursor:pointer;font-size:.78rem;font-weight:500;color:#374151;transition:all .15s;text-decoration:none}
      .db-action-btn:hover{border-color:#4f46e5;color:#4f46e5;background:#eef2ff}
      .db-action-btn .icon{font-size:1.3rem}
      .db-progress-item{margin-bottom:14px}.db-progress-item:last-child{margin-bottom:0}
      .db-progress-label{display:flex;justify-content:space-between;font-size:.83rem;margin-bottom:4px;color:#374151}
      .db-progress-bar{height:8px;background:#f3f4f6;border-radius:4px;overflow:hidden}
      .db-progress-fill{height:100%;border-radius:4px;transition:width .4s}
      .db-announce{display:flex;gap:12px;padding:10px 0;border-bottom:1px solid #f3f4f6}
      .db-announce:last-child{border-bottom:none}
      .db-announce-badge{padding:2px 8px;border-radius:6px;font-size:.7rem;font-weight:600;flex-shrink:0}
      .db-announce-body h5{margin:0 0 2px;font-size:.85rem;font-weight:600;color:#111827}
      .db-announce-body p{margin:0;font-size:.8rem;color:#6b7280}
      .db-calendar{width:100%}.db-calendar th,.db-calendar td{text-align:center;padding:6px;font-size:.8rem}
      .db-calendar th{color:#6b7280;font-weight:600}.db-calendar td{color:#374151;cursor:default;border-radius:6px}
      .db-calendar td.today{background:#4f46e5;color:#fff;font-weight:700;border-radius:6px}
      .db-calendar td.other{color:#d1d5db}
      .db-empty{text-align:center;padding:60px 20px;color:#6b7280}
      .db-empty .icon{font-size:3rem;margin-bottom:12px}
      .db-toast{position:fixed;bottom:24px;right:24px;padding:12px 20px;background:#111827;color:#fff;border-radius:10px;font-size:.85rem;z-index:9999;animation:slideIn .3s}
      @keyframes slideIn{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}
      .db-badge{display:inline-block;padding:2px 10px;border-radius:20px;font-size:.72rem;font-weight:600}
      .db-badge-purple{background:#ede9fe;color:#7c3aed}.db-badge-green{background:#d1fae5;color:#059669}
      .db-badge-amber{background:#fef3c7;color:#d97706}.db-badge-gray{background:#f3f4f6;color:#6b7280}
      .db-edit-widget{border:2px dashed #4f46e5;background:#f5f3ff;cursor:grab}
      .db-edit-widget:active{cursor:grabbing;opacity:.7}
      .db-widget-actions{display:flex;gap:6px}
      .db-tabs{display:flex;gap:4px;border-bottom:2px solid #e5e7eb;margin-bottom:20px}
      .db-tab{padding:8px 16px;font-size:.85rem;font-weight:500;color:#6b7280;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;transition:all .15s}
      .db-tab.active{color:#4f46e5;border-bottom-color:#4f46e5}
      .db-catalog-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}
      .db-catalog-card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px;text-align:center;transition:all .15s}
      .db-catalog-card:hover{border-color:#4f46e5;box-shadow:0 4px 16px rgba(79,70,229,.1)}
      .db-catalog-card .icon{font-size:2rem;margin-bottom:10px}
      .db-catalog-card h4{margin:0 0 4px;font-size:.95rem;font-weight:600}
      .db-catalog-card p{margin:0;color:#6b7280;font-size:.8rem}
      @media(max-width:640px){.db-grid-2,.db-grid-3,.db-grid-4{grid-template-columns:1fr!important}.db-header{flex-direction:column;align-items:flex-start}}
      .db-stat-value{letter-spacing:-.02em}
      .db-widget{animation:fadeUp .3s ease-out}
      @keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
    </style>`;

  // ──────────────────────────── SVG Chart Helpers ────────────────────────────
  function svgBarChart(config = {}) {
    const { data = [], labels = [], width = 340, height = 200, colors = ['#4f46e5','#7c3aed','#2563eb','#0891b2','#059669'] } = config;
    if (!data.length) return '<div style="color:#9ca3af;text-align:center;padding:20px">No data</div>';
    const max = Math.max(...data, 1);
    const padL = 40, padR = 15, padTop = 10, padBot = 30;
    const chartW = width - padL - padR, chartH = height - padTop - padBot;
    const barW = Math.max(14, Math.min(38, chartW / data.length - 8));
    const step = chartW / data.length;
    // Y-axis grid lines and labels
    let grid = '';
    const ticks = 4;
    for (let i = 0; i <= ticks; i++) {
      const y = padTop + chartH - (i / ticks) * chartH;
      const val = Math.round((i / ticks) * max);
      grid += `<line x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}" stroke="#f3f4f6" stroke-width="1"/>`;
      grid += `<text x="${padL - 6}" y="${y + 3}" text-anchor="end" font-size="9" fill="#9ca3af">${val}</text>`;
    }
    let bars = '';
    data.forEach((v, i) => {
      const h = Math.max(2, (v / max) * chartH);
      const x = padL + i * step + (step - barW) / 2;
      const y = padTop + chartH - h;
      const c = colors[i % colors.length];
      bars += `<rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="4" fill="${c}"><title>${labels[i]||''}: ${v}</title></rect>`;
      bars += `<text x="${x + barW/2}" y="${height - 6}" text-anchor="middle" font-size="9" fill="#6b7280">${esc(String(labels[i]||''))}</text>`;
    });
    return `<svg viewBox="0 0 ${width} ${height}" style="width:100%;height:auto">${grid}${bars}</svg>`;
  }

  function svgLineChart(config = {}) {
    const { data = [], labels = [], width = 340, height = 200, color = '#4f46e5' } = config;
    if (!data.length) return '<div style="color:#9ca3af;text-align:center;padding:20px">No data</div>';
    const max = Math.max(...data, 1);
    const padL = 40, padR = 15, padTop = 15, padBot = 30;
    const chartW = width - padL - padR, chartH = height - padTop - padBot;
    // Y-axis grid lines
    let grid = '';
    const ticks = 4;
    for (let i = 0; i <= ticks; i++) {
      const y = padTop + chartH - (i / ticks) * chartH;
      const val = Math.round((i / ticks) * max);
      grid += `<line x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}" stroke="#f3f4f6" stroke-width="1"/>`;
      grid += `<text x="${padL - 6}" y="${y + 3}" text-anchor="end" font-size="9" fill="#9ca3af">${val}</text>`;
    }
    const pts = data.map((v, i) => {
      const x = padL + (i / Math.max(data.length - 1, 1)) * chartW;
      const y = padTop + chartH - (v / max) * chartH;
      return `${x},${y}`;
    });
    let labelsSvg = '';
    labels.forEach((l, i) => {
      const x = padL + (i / Math.max(labels.length - 1, 1)) * chartW;
      labelsSvg += `<text x="${x}" y="${height - 6}" text-anchor="middle" font-size="9" fill="#6b7280">${esc(String(l))}</text>`;
    });
    const first = pts[0], last = pts[pts.length - 1];
    const areaPath = `M${first} ${pts.map(p => `L${p}`).join(' ')} L${last.split(',')[0]},${padTop + chartH} L${first.split(',')[0]},${padTop + chartH} Z`;
    return `<svg viewBox="0 0 ${width} ${height}" style="width:100%;height:auto">
      <defs><linearGradient id="lg-${color.replace('#','')}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${color}" stop-opacity="0.2"/><stop offset="100%" stop-color="${color}" stop-opacity="0.01"/></linearGradient></defs>
      ${grid}
      <path d="${areaPath}" fill="url(#lg-${color.replace('#','')})"/>
      <polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      ${data.map((v, i) => { const [x,y] = pts[i].split(','); return `<circle cx="${x}" cy="${y}" r="3.5" fill="#fff" stroke="${color}" stroke-width="2"/>`; }).join('')}
      ${labelsSvg}</svg>`;
  }

  function svgPieChart(config = {}) {
    const { data = [], labels = [], width = 220, height = 220, colors = ['#4f46e5','#7c3aed','#2563eb','#0891b2','#059669','#d97706','#dc2626'] } = config;
    if (!data.length) return '<div style="color:#9ca3af;text-align:center;padding:20px">No data</div>';
    const total = data.reduce((a, b) => a + b, 0) || 1;
    const cx = width / 2, cy = height / 2, r = 80, ir = 50;
    let accum = -Math.PI / 2;
    let slices = '', legend = '';
    data.forEach((v, i) => {
      const angle = (v / total) * Math.PI * 2;
      const end = accum + angle;
      const x1 = cx + r * Math.cos(accum), y1 = cy + r * Math.sin(accum);
      const x2 = cx + r * Math.cos(end), y2 = cy + r * Math.sin(end);
      const ix1 = cx + ir * Math.cos(end), iy1 = cy + ir * Math.sin(end);
      const ix2 = cx + ir * Math.cos(accum), iy2 = cy + ir * Math.sin(accum);
      const large = angle > Math.PI ? 1 : 0;
      const c = colors[i % colors.length];
      slices += `<path d="M${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2} L${ix1},${iy1} A${ir},${ir} 0 ${large} 0 ${ix2},${iy2} Z" fill="${c}"><title>${labels[i]||''}: ${Math.round(v/total*100)}%</title></path>`;
      legend += `<div style="display:flex;align-items:center;gap:6px;font-size:.78rem;color:#374151;margin-bottom:3px"><span style="width:10px;height:10px;border-radius:3px;background:${c};flex-shrink:0"></span>${esc(String(labels[i]||''))} (${Math.round(v/total*100)}%)</div>`;
      accum = end;
    });
    return `<div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
      <svg viewBox="0 0 ${width} ${height}" style="width:140px;height:140px;flex-shrink:0">${slices}<text x="${cx}" y="${cy+4}" text-anchor="middle" font-size="14" font-weight="700" fill="#111827">${total}</text></svg>
      <div>${legend}</div></div>`;
  }

  // ──────────────────────────── Widget Renderer ────────────────────────────
  function renderWidget(w) {
    const cfg = w.config || {};
    const type = w.widget_type;
    let body = '';

    if (type === 'stat-card') {
      const bg = cfg.color || '#eef2ff';
      const val = cfg.value || '—';
      const lbl = cfg.label || 'KPI';
      const icon = cfg.icon || '📊';
      const chg = cfg.change || '';
      const chgDir = cfg.changeDir || 'up';
      body = `<div class="db-stat"><div class="db-stat-icon" style="background:${bg}">${icon}</div>
        <div><div class="db-stat-label">${esc(lbl)}</div><div class="db-stat-value">${esc(String(val))}</div>
        ${chg ? `<div class="db-stat-change ${chgDir}">${chgDir === 'up' ? '↑' : '↓'} ${esc(chg)}</div>` : ''}</div></div>`;
    } else if (type === 'chart-bar') {
      body = svgBarChart(cfg);
    } else if (type === 'chart-line') {
      body = svgLineChart(cfg);
    } else if (type === 'chart-pie') {
      body = svgPieChart(cfg);
    } else if (type === 'table-list') {
      const cols = cfg.columns || [];
      const rows = cfg.rows || [];
      body = `<div style="max-height:260px;overflow-y:auto"><table class="db-table"><thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>
        ${rows.map(r => `<tr>${cols.map((_, ci) => `<td>${esc(String(r[ci] ?? ''))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    } else if (type === 'recent-activity') {
      const items = cfg.items || [];
      body = `<ul class="db-activity">${items.map(a => `<li>
        <span class="db-activity-dot" style="background:${a.color || '#4f46e5'}"></span>
        <div><div class="db-activity-text">${esc(a.text || '')}</div>
        <div class="db-activity-time">${esc(a.time || '')}</div></div></li>`).join('')}</ul>`;
    } else if (type === 'calendar-mini') {
      const now = new Date();
      const yr = cfg.year || now.getFullYear();
      const mo = cfg.month !== undefined ? cfg.month : now.getMonth();
      const firstDow = new Date(yr, mo, 1).getDay();
      const days = new Date(yr, mo + 1, 0).getDate();
      const prevDays = new Date(yr, mo, 0).getDate();
      const today = (yr === now.getFullYear() && mo === now.getMonth()) ? now.getDate() : -1;
      const events = cfg.events || {};
      const mNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      // Build all day cells into proper rows
      let allCells = [];
      for (let i = 0; i < firstDow; i++) allCells.push({ num: prevDays - firstDow + i + 1, cls: 'other' });
      for (let d = 1; d <= days; d++) {
        const isToday = d === today;
        const ev = events[d] ? ` title="${esc(events[d])}"` : '';
        const evStyle = events[d] ? ' style="font-weight:600;position:relative"' : '';
        allCells.push({ num: d, cls: isToday ? 'today' : '', extra: ev + evStyle });
      }
      const rem = allCells.length % 7;
      if (rem) for (let i = 1; i <= 7 - rem; i++) allCells.push({ num: i, cls: 'other' });
      let calRows = '';
      for (let r = 0; r < allCells.length; r += 7) {
        const row = allCells.slice(r, r + 7).map(c => `<td class="${c.cls}"${c.extra || ''}>${c.num}</td>`).join('');
        calRows += `<tr>${row}</tr>`;
      }
      const prevMo = mo === 0 ? 11 : mo - 1;
      const prevYr = mo === 0 ? yr - 1 : yr;
      const nextMo = mo === 11 ? 0 : mo + 1;
      const nextYr = mo === 11 ? yr + 1 : yr;
      body = `<table class="db-calendar"><thead><tr>
        <th style="cursor:pointer" title="Previous month">◀</th>
        <th colspan="5" style="font-size:.88rem;color:#111827">${mNames[mo]} ${yr}</th>
        <th style="cursor:pointer" title="Next month">▶</th></tr></thead>
        <tbody><tr><th>Su</th><th>Mo</th><th>Tu</th><th>We</th><th>Th</th><th>Fr</th><th>Sa</th></tr>${calRows}</tbody></table>`;
      if (Object.keys(events).length) {
        body += `<div style="margin-top:10px;padding-top:10px;border-top:1px solid #f3f4f6;font-size:.78rem;color:#6b7280">
          <strong style="color:#374151">Events:</strong> ${Object.entries(events).map(([d, t]) => `<span style="margin-left:8px">${d}: ${esc(t)}</span>`).join('')}</div>`;
      }
    } else if (type === 'quick-actions') {
      const actions = cfg.actions || [];
      body = `<div class="db-actions-grid">${actions.map(a =>
        `<a href="${esc(a.url || '#')}" class="db-action-btn"><span class="icon">${a.icon || '⚡'}</span>${esc(a.label || 'Action')}</a>`).join('')}</div>`;
    } else if (type === 'progress-tracker') {
      const items = cfg.items || [];
      body = items.map(p => {
        const w = Math.min(100, Math.max(0, p.percent || 0));
        const c = w >= 80 ? '#059669' : w >= 50 ? '#d97706' : '#dc2626';
        return `<div class="db-progress-item"><div class="db-progress-label"><span>${esc(p.label || '')}</span><span style="font-weight:600">${w}%</span></div>
          <div class="db-progress-bar"><div class="db-progress-fill" style="width:${w}%;background:${c}"></div></div></div>`;
      }).join('');
    } else if (type === 'announcement-feed') {
      const items = cfg.items || [];
      body = items.map(a => {
        const badgeBg = a.priority === 'urgent' ? '#fee2e2' : a.priority === 'info' ? '#dbeafe' : '#f3f4f6';
        const badgeColor = a.priority === 'urgent' ? '#dc2626' : a.priority === 'info' ? '#2563eb' : '#6b7280';
        return `<div class="db-announce"><span class="db-announce-badge" style="background:${badgeBg};color:${badgeColor}">${esc(a.priority || 'info')}</span>
          <div class="db-announce-body"><h5>${esc(a.title || '')}</h5><p>${esc(a.body || '')}</p></div></div>`;
      }).join('');
    } else {
      body = `<div style="color:#9ca3af;text-align:center;padding:20px">Unknown widget: ${esc(type)}</div>`;
    }

    return `<div class="db-widget" data-widget-id="${w.id}">
      <div class="db-widget-head"><h4>${esc(w.title || type)}</h4></div>
      <div class="db-widget-body">${body}</div></div>`;
  }

  // ──────────────────────────── Widget Add Form ────────────────────────────
  function widgetTypeOptions(selected = '') {
    const types = [
      ['stat-card','📊 Stat Card'],['chart-bar','📈 Bar Chart'],['chart-line','📉 Line Chart'],
      ['chart-pie','🥧 Pie/Donut Chart'],['table-list','📋 Data Table'],['recent-activity','🕐 Recent Activity'],
      ['calendar-mini','📅 Mini Calendar'],['quick-actions','⚡ Quick Actions'],
      ['progress-tracker','📊 Progress Tracker'],['announcement-feed','📢 Announcement Feed']
    ];
    return types.map(([v, l]) => `<option value="${v}" ${v === selected ? 'selected' : ''}>${l}</option>`).join('');
  }

  function widgetConfigForm(type, existing = {}) {
    const cfg = typeof existing === 'string' ? {} : (existing || {});
    const field = (label, name, val, ph = '') => `<div class="db-form-group"><label>${label}</label><input class="db-input" name="cfg_${name}" value="${esc(String(val ?? ''))}" placeholder="${ph}"></div>`;
    const textarea = (label, name, val) => `<div class="db-form-group"><label>${label}</label><textarea class="db-textarea" name="cfg_${name}" rows="3">${esc(String(val ?? ''))}</textarea></div>`;
    const color = (label, name, val) => `<div class="db-form-group"><label>${label}</label><input class="db-input" name="cfg_${name}" type="color" value="${val || '#4f46e5'}"></div>`;

    switch (type) {
      case 'stat-card': return field('Label','label',cfg.label,'e.g. Total Students') + field('Value','value',cfg.value,'e.g. 1,250') + color('Icon BG Color','color',cfg.color) + field('Icon (emoji)','icon',cfg.icon,'📊') + field('Change Text','change',cfg.change,'+12%') + field('Change Direction','changeDir',cfg.changeDir,'up');
      case 'chart-bar': case 'chart-line': {
        const dl = field('Labels (comma-separated)','labels',Array.isArray(cfg.labels) ? cfg.labels.join(', ') : cfg.labels,'Mon,Tue,Wed') + field('Data (comma-separated)','data',Array.isArray(cfg.data) ? cfg.data.join(', ') : cfg.data,'10,25,18,30,22');
        return type === 'chart-line' ? dl + color('Line Color','color',cfg.color) : dl;
      }
      case 'chart-pie': return field('Labels (comma-separated)','labels',Array.isArray(cfg.labels) ? cfg.labels.join(', ') : cfg.labels,'A,B,C') + field('Data (comma-separated)','data',Array.isArray(cfg.data) ? cfg.data.join(', ') : cfg.data,'40,30,30');
      case 'table-list': return field('Column Names (comma-separated)','columns',Array.isArray(cfg.columns) ? cfg.columns.join(', ') : cfg.columns,'Name,Grade,Score') + textarea('Rows (JSON array)','rows',Array.isArray(cfg.rows) ? JSON.stringify(cfg.rows) : cfg.rows,'[["Alice","A",95],["Bob","B",88]]');
      case 'recent-activity': return textarea('Items (JSON array)','items',Array.isArray(cfg.items) ? JSON.stringify(cfg.items) : cfg.items,'[{"text":"New student enrolled","time":"2h ago","color":"#059669"}]');
      case 'calendar-mini': return field('Year','year',cfg.year || new Date().getFullYear()) + field('Month (0-11)','month',cfg.month ?? new Date().getMonth()) + textarea('Events (JSON: {day: text})','events',typeof cfg.events === 'object' ? JSON.stringify(cfg.events) : cfg.events,'{"15":"PTM Meeting","22":"Holiday"}');
      case 'quick-actions': return textarea('Actions (JSON array)','actions',Array.isArray(cfg.actions) ? JSON.stringify(cfg.actions) : cfg.actions,'[{"icon":"➕","label":"Add Student","url":"/students/new"}]');
      case 'progress-tracker': return textarea('Items (JSON array)','items',Array.isArray(cfg.items) ? JSON.stringify(cfg.items) : cfg.items,'[{"label":"Fee Collection","percent":75}]');
      case 'announcement-feed': return textarea('Items (JSON array)','items',Array.isArray(cfg.items) ? JSON.stringify(cfg.items) : cfg.items,'[{"title":"School Closed","body":"Tomorrow is a holiday","priority":"urgent"}]');
      default: return '<div class="db-form-group"><p style="color:#6b7280">Select a widget type to see configuration options.</p></div>';
    }
  }

  // ──────────────────────────── Parse Config Fields ────────────────────────────
  function parseConfigFromBody(body, type) {
    const cfg = {};
    const get = (k) => body[`cfg_${k}`] || '';
    const getJSON = (k) => { try { return JSON.parse(get(k)); } catch { return []; } };

    switch (type) {
      case 'stat-card':
        cfg.label = get('label'); cfg.value = get('value'); cfg.color = get('color'); cfg.icon = get('icon'); cfg.change = get('change'); cfg.changeDir = get('changeDir');
        break;
      case 'chart-bar': case 'chart-line':
        cfg.labels = typeof get('labels') === 'string' ? get('labels').split(',').map(s => s.trim()) : get('labels');
        cfg.data = typeof get('data') === 'string' ? get('data').split(',').map(s => parseFloat(s.trim()) || 0) : get('data');
        if (type === 'chart-line') cfg.color = get('color');
        break;
      case 'chart-pie':
        cfg.labels = get('labels').split(',').map(s => s.trim());
        cfg.data = get('data').split(',').map(s => parseFloat(s.trim()) || 0);
        break;
      case 'table-list':
        cfg.columns = typeof get('columns') === 'string' ? get('columns').split(',').map(s => s.trim()) : get('columns');
        cfg.rows = getJSON('rows');
        break;
      default:
        cfg.items = getJSON('items'); cfg.actions = getJSON('actions'); cfg.events = getJSON('events');
        if (type === 'calendar-mini') { cfg.year = parseInt(get('year')) || new Date().getFullYear(); cfg.month = parseInt(get('month')); }
        break;
    }
    return cfg;
  }

  // ═══════════════════════════ ROUTES ═══════════════════════════

  // 1. Dashboard Gallery
  app.get('/school/dashboard-builder', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const { rows } = await pool.query(`SELECT d.*, (SELECT COUNT(*)::int FROM dashboard_widgets w WHERE w.dashboard_id = d.id) as widget_count
      FROM custom_dashboards d WHERE d.tenant_id = $1 ORDER BY d.updated_at DESC`, [tid]);
    const list = rows.length ? rows.map(d => `<div class="db-card">
        <div style="display:flex;align-items:start;justify-content:space-between">
          <h3>${esc(d.title)}</h3>
          ${d.is_default ? '<span class="db-badge db-badge-purple">Default</span>' : ''}
        </div>
        <p class="desc">${esc(d.description || 'No description')}</p>
        <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
          <span class="db-badge db-badge-gray">${d.columns}-column</span>
          <span class="db-badge db-badge-gray">${d.widget_count} widgets</span>
        </div>
        <div class="meta" style="margin-top:10px">Created ${d.created_at.toISOString().slice(0,10)} · by ${esc(d.created_by || '')}</div>
        <div style="display:flex;gap:6px;margin-top:14px;flex-wrap:wrap">
          <a href="/school/dashboard-builder/${d.id}" class="db-btn db-btn-primary db-btn-sm">View</a>
          <a href="/school/dashboard-builder/${d.id}/edit" class="db-btn db-btn-secondary db-btn-sm">Edit Layout</a>
          <form method="POST" action="/school/dashboard-builder/${d.id}/clone" style="display:inline"><button class="db-btn db-btn-secondary db-btn-sm" type="submit">Clone</button></form>
          <form method="POST" action="/school/dashboard-builder/${d.id}/settings" style="display:inline"><button class="db-btn db-btn-secondary db-btn-sm" type="submit">Settings</button></form>
          <form method="POST" action="/school/dashboard-builder/${d.id}" style="display:inline" onsubmit="return confirm('Delete this dashboard?')">
            <input type="hidden" name="_method" value="DELETE"><button class="db-btn db-btn-danger db-btn-sm" type="submit">Delete</button></form>
        </div></div>`).join('') : `<div class="db-empty"><div class="icon">📋</div><h3>No dashboards yet</h3><p>Create your first custom dashboard to get started.</p></div>`;

    const html = `${CSS}<div class="db-wrap">
      <div class="db-header"><div><h1>Dashboard Builder</h1><p class="sub">Create and manage personalized dashboards for your school</p></div>
        <a href="/school/dashboard-builder/create" class="db-btn db-btn-primary">+ New Dashboard</a></div>
      <div class="db-grid db-grid-3">${list}</div></div>`;
    res.send(renderPage('Dashboard Builder', html, req.session?.user));
  }));

  // 2. Create Dashboard Form
  app.get('/school/dashboard-builder/create', requireAuth, ah(async (req, res) => {
    const html = `${CSS}<div class="db-wrap">
      <div class="db-header"><div><h1>Create Dashboard</h1><p class="sub">Set up a new custom dashboard</p></div>
        <a href="/school/dashboard-builder" class="db-btn db-btn-secondary">← Back</a></div>
      <div class="db-card" style="max-width:600px">
        <form method="POST" action="/school/dashboard-builder/create">
          <div class="db-form-group"><label>Dashboard Title *</label><input class="db-input" name="title" required placeholder="e.g. Principal's Overview"></div>
          <div class="db-form-group"><label>Description</label><textarea class="db-textarea" name="description" placeholder="What is this dashboard for?"></textarea></div>
          <div class="db-form-group"><label>Column Layout</label><select class="db-select" name="columns">
            <option value="2">2 Columns</option><option value="3" selected>3 Columns</option><option value="4">4 Columns</option></select></div>
          <div class="db-form-group"><label>Set as Default</label><label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:400">
            <input type="checkbox" name="is_default" value="true"> Make this the default dashboard</label></div>
          <div style="display:flex;gap:8px;margin-top:20px">
            <button class="db-btn db-btn-primary" type="submit">Create Dashboard</button>
            <a href="/school/dashboard-builder" class="db-btn db-btn-secondary">Cancel</a></div>
        </form></div></div>`;
    res.send(renderPage('Create Dashboard', html, req.session?.user));
  }));

  // 3. Save Dashboard
  app.post('/school/dashboard-builder/create', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const { title, description = '', columns = 3, is_default } = req.body;
    if (!title?.trim()) return res.redirect('/school/dashboard-builder/create');
    const isDef = is_default === 'true';
    if (isDef) await pool.query(`UPDATE custom_dashboards SET is_default = false WHERE tenant_id = $1 AND is_default = true`, [tid]);
    const { rows } = await pool.query(
      `INSERT INTO custom_dashboards (tenant_id, title, description, columns, is_default, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [tid, title.trim(), description.trim(), parseInt(columns) || 3, isDef, userSlug(req)]);
    audit(req, 'dashboard_create', { id: rows[0].id, title });
    res.redirect(`/school/dashboard-builder/${rows[0].id}`);
  }));

  // 4. View Dashboard
  app.get('/school/dashboard-builder/:id', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const { id } = req.params;
    const { rows: [dash] } = await pool.query(`SELECT * FROM custom_dashboards WHERE id = $1 AND tenant_id = $2`, [id, tid]);
    if (!dash) return res.status(404).send('Dashboard not found');
    const { rows: widgets } = await pool.query(`SELECT * FROM dashboard_widgets WHERE dashboard_id = $1 AND tenant_id = $2 ORDER BY position, col ASC`, [id, tid]);
    const gridClass = `db-grid-${dash.columns}`;
    const widgetHtml = widgets.map(renderWidget).join('');
    const html = `${CSS}<div class="db-wrap">
      <div class="db-header"><div><h1>${esc(dash.title)}</h1><p class="sub">${esc(dash.description || '')}</p></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <a href="/school/dashboard-builder/${id}/edit" class="db-btn db-btn-secondary">Edit Layout</a>
          <a href="/school/dashboard-builder/${id}/widget/add" class="db-btn db-btn-primary">+ Add Widget</a>
          <a href="/school/dashboard-builder" class="db-btn db-btn-secondary">← Gallery</a></div></div>
      ${widgets.length ? `<div class="db-grid ${gridClass}">${widgetHtml}</div>` : `<div class="db-empty"><div class="icon">📦</div><h3>No widgets yet</h3>
        <p>Add widgets to populate this dashboard.</p><a href="/school/dashboard-builder/${id}/widget/add" class="db-btn db-btn-primary" style="margin-top:16px">+ Add Widget</a></div>`}
      </div>`;
    res.send(renderPage(dash.title, html, req.session?.user));
  }));

  // 5. Add Widget
  app.get('/school/dashboard-builder/:id/widget/add', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const { id } = req.params;
    const { rows: [dash] } = await pool.query(`SELECT * FROM custom_dashboards WHERE id = $1 AND tenant_id = $2`, [id, tid]);
    if (!dash) return res.status(404).send('Dashboard not found');
    const html = `${CSS}<div class="db-wrap">
      <div class="db-header"><div><h1>Add Widget</h1><p class="sub">To: ${esc(dash.title)}</p></div>
        <a href="/school/dashboard-builder/${id}" class="db-btn db-btn-secondary">← Back</a></div>
      <div class="db-card" style="max-width:640px">
        <form method="POST" action="/school/dashboard-builder/${id}/widget/add" id="wform">
          <div class="db-form-group"><label>Widget Title *</label><input class="db-input" name="title" required placeholder="e.g. Enrollment Stats"></div>
          <div class="db-form-group"><label>Widget Type *</label><select class="db-select" name="widget_type" onchange="updateConfigForm(this.value)" id="wtype">
            ${widgetTypeOptions()}</select></div>
          <div class="db-form-group"><label>Column</label><select class="db-select" name="col">
            ${Array.from({length: dash.columns}, (_, i) => `<option value="${i+1}">${i+1}</option>`).join('')}</select></div>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0">
          <h3 style="font-size:.9rem;margin:0 0 14px;color:#374151">Widget Configuration</h3>
          <div id="config-fields">${widgetConfigForm('stat-card')}</div>
          <div style="display:flex;gap:8px;margin-top:20px">
            <button class="db-btn db-btn-primary" type="submit">Add Widget</button>
            <a href="/school/dashboard-builder/${id}" class="db-btn db-btn-secondary">Cancel</a></div>
        </form></div>
      <script>
        function updateConfigForm(type) {
          fetch('/school/dashboard-builder/widgets?type=' + encodeURIComponent(type) + '&partial=1', {headers:{'Accept':'text/html'}})
            .then(r => r.text()).then(h => { document.getElementById('config-fields').innerHTML = h; });
        }
      </script></div>`;
    res.send(renderPage('Add Widget', html, req.session?.user));
  }));

  app.post('/school/dashboard-builder/:id/widget/add', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const { id } = req.params;
    const { title, widget_type, col = 1 } = req.body;
    if (!title?.trim() || !widget_type) return res.redirect(`/school/dashboard-builder/${id}/widget/add`);
    const { rows: [maxPos] } = await pool.query(`SELECT COALESCE(MAX(position), -1) + 1 as pos FROM dashboard_widgets WHERE dashboard_id = $1`, [id]);
    const config = parseConfigFromBody(req.body, widget_type);
    await pool.query(
      `INSERT INTO dashboard_widgets (tenant_id, dashboard_id, widget_type, title, position, col, config) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [tid, id, widget_type, title.trim(), maxPos.pos, parseInt(col) || 1, JSON.stringify(config)]);
    audit(req, 'widget_add', { dashboard_id: id, widget_type, title: title.trim() });
    res.redirect(`/school/dashboard-builder/${id}`);
  }));

  // 6. Move Widget
  app.post('/school/dashboard-builder/:id/widget/move', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const { id } = req.params;
    const { widget_id, direction } = req.body;
    if (!widget_id || !direction) return res.redirect(`/school/dashboard-builder/${id}`);
    const { rows: [w] } = await pool.query(`SELECT * FROM dashboard_widgets WHERE id = $1 AND tenant_id = $2 AND dashboard_id = $3`, [widget_id, tid, id]);
    if (!w) return res.redirect(`/school/dashboard-builder/${id}`);
    const targetPos = direction === 'up' ? w.position - 1 : w.position + 1;
    const { rows: [swap] } = await pool.query(`SELECT * FROM dashboard_widgets WHERE dashboard_id = $1 AND tenant_id = $2 AND position = $3`, [id, tid, targetPos]);
    if (swap) {
      await pool.query(`UPDATE dashboard_widgets SET position = $1 WHERE id = $2`, [w.position, swap.id]);
      await pool.query(`UPDATE dashboard_widgets SET position = $1 WHERE id = $2`, [targetPos, w.id]);
    }
    audit(req, 'widget_move', { widget_id, direction });
    res.redirect(`/school/dashboard-builder/${id}/edit`);
  }));

  // 7. Remove Widget
  app.post('/school/dashboard-builder/:id/widget/:wid/remove', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const { id, wid } = req.params;
    await pool.query(`DELETE FROM dashboard_widgets WHERE id = $1 AND tenant_id = $2 AND dashboard_id = $3`, [wid, tid, id]);
    audit(req, 'widget_remove', { widget_id: wid, dashboard_id: id });
    res.redirect(`/school/dashboard-builder/${id}`);
  }));

  // 8. Edit Layout
  app.get('/school/dashboard-builder/:id/edit', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const { id } = req.params;
    const { rows: [dash] } = await pool.query(`SELECT * FROM custom_dashboards WHERE id = $1 AND tenant_id = $2`, [id, tid]);
    if (!dash) return res.status(404).send('Dashboard not found');
    const { rows: widgets } = await pool.query(`SELECT * FROM dashboard_widgets WHERE dashboard_id = $1 AND tenant_id = $2 ORDER BY position, col ASC`, [id, tid]);
    const gridClass = `db-grid-${dash.columns}`;
    const widgetCards = widgets.map((w, i) => `<div class="db-widget db-edit-widget">
      <div class="db-widget-head"><h4>${esc(w.title || w.widget_type)}</h4>
        <div class="db-widget-actions">
          ${i > 0 ? `<form method="POST" action="/school/dashboard-builder/${id}/widget/move" style="display:inline"><input type="hidden" name="widget_id" value="${w.id}"><input type="hidden" name="direction" value="up"><button class="db-btn db-btn-secondary db-btn-sm" type="submit">↑</button></form>` : ''}
          ${i < widgets.length - 1 ? `<form method="POST" action="/school/dashboard-builder/${id}/widget/move" style="display:inline"><input type="hidden" name="widget_id" value="${w.id}"><input type="hidden" name="direction" value="down"><button class="db-btn db-btn-secondary db-btn-sm" type="submit">↓</button></form>` : ''}
          <form method="POST" action="/school/dashboard-builder/${id}/widget/${w.id}/remove" style="display:inline" onsubmit="return confirm('Remove this widget?')">
            <button class="db-btn db-btn-danger db-btn-sm" type="submit">✕</button></form>
        </div></div>
      <div class="db-widget-body" style="opacity:.65;pointer-events:none">${renderWidget(w).match(/class="db-widget-body">([\s\S]*?)<\/div>/)?.[1] || ''}</div></div>`).join('');

    const html = `${CSS}<div class="db-wrap">
      <div class="db-header"><div><h1>Edit Layout</h1><p class="sub">${esc(dash.title)} — Rearrange widgets</p></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <a href="/school/dashboard-builder/${id}/widget/add" class="db-btn db-btn-primary">+ Add Widget</a>
          <a href="/school/dashboard-builder/${id}" class="db-btn db-btn-secondary">← View Dashboard</a></div></div>
      ${widgets.length ? `<div class="db-grid ${gridClass}">${widgetCards}</div>` : `<div class="db-empty"><div class="icon">📦</div><h3>No widgets</h3>
        <p>Add widgets to start building your dashboard.</p></div>`}
      </div>`;
    res.send(renderPage('Edit Layout', html, req.session?.user));
  }));

  // 9. Settings
  app.get('/school/dashboard-builder/:id/settings', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const { id } = req.params;
    const { rows: [dash] } = await pool.query(`SELECT * FROM custom_dashboards WHERE id = $1 AND tenant_id = $2`, [id, tid]);
    if (!dash) return res.status(404).send('Dashboard not found');
    const html = `${CSS}<div class="db-wrap">
      <div class="db-header"><div><h1>Dashboard Settings</h1><p class="sub">${esc(dash.title)}</p></div>
        <a href="/school/dashboard-builder/${id}" class="db-btn db-btn-secondary">← Back</a></div>
      <div class="db-card" style="max-width:600px">
        <form method="POST" action="/school/dashboard-builder/${id}/settings">
          <div class="db-form-group"><label>Title *</label><input class="db-input" name="title" value="${esc(dash.title)}" required></div>
          <div class="db-form-group"><label>Description</label><textarea class="db-textarea" name="description">${esc(dash.description || '')}</textarea></div>
          <div class="db-form-group"><label>Column Layout</label><select class="db-select" name="columns">
            <option value="2" ${dash.columns === 2 ? 'selected' : ''}>2 Columns</option>
            <option value="3" ${dash.columns === 3 ? 'selected' : ''}>3 Columns</option>
            <option value="4" ${dash.columns === 4 ? 'selected' : ''}>4 Columns</option></select></div>
          <div class="db-form-group"><label>Set as Default</label><label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:400">
            <input type="checkbox" name="is_default" value="true" ${dash.is_default ? 'checked' : ''}> Make this the default dashboard</label></div>
          <div class="db-form-group"><label>Shared With (JSON array of usernames)</label>
            <textarea class="db-textarea" name="shared_with" rows="2">${esc(Array.isArray(dash.shared_with) ? JSON.stringify(dash.shared_with) : dash.shared_with || '[]')}</textarea></div>
          <button class="db-btn db-btn-primary" type="submit">Save Settings</button></form></div></div>`;
    res.send(renderPage('Dashboard Settings', html, req.session?.user));
  }));

  app.post('/school/dashboard-builder/:id/settings', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const { id } = req.params;
    const { title, description = '', columns = 3, is_default, shared_with } = req.body;
    const isDef = is_default === 'true';
    if (isDef) await pool.query(`UPDATE custom_dashboards SET is_default = false WHERE tenant_id = $1 AND is_default = true AND id != $2`, [tid, id]);
    let sharedParsed = [];
    try { sharedParsed = JSON.parse(shared_with); if (!Array.isArray(sharedParsed)) sharedParsed = []; } catch { sharedParsed = []; }
    await pool.query(`UPDATE custom_dashboards SET title=$1, description=$2, columns=$3, is_default=$4, shared_with=$5, updated_at=NOW() WHERE id=$6 AND tenant_id=$7`,
      [title?.trim() || 'Untitled', description.trim(), parseInt(columns) || 3, isDef, JSON.stringify(sharedParsed), id, tid]);
    audit(req, 'dashboard_settings', { id, title });
    res.redirect(`/school/dashboard-builder/${id}`);
  }));

  // 10. Delete Dashboard
  app.delete('/school/dashboard-builder/:id', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const { id } = req.params;
    await pool.query(`DELETE FROM custom_dashboards WHERE id = $1 AND tenant_id = $2`, [id, tid]);
    audit(req, 'dashboard_delete', { id });
    res.redirect('/school/dashboard-builder');
  }));

  // 11. Clone Dashboard
  app.post('/school/dashboard-builder/:id/clone', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const { id } = req.params;
    const { rows: [dash] } = await pool.query(`SELECT * FROM custom_dashboards WHERE id = $1 AND tenant_id = $2`, [id, tid]);
    if (!dash) return res.status(404).send('Dashboard not found');
    const { rows: [newDash] } = await pool.query(
      `INSERT INTO custom_dashboards (tenant_id, title, description, columns, is_default, created_by) VALUES ($1,$2,$3,$4,false,$5) RETURNING id`,
      [tid, `${dash.title} (Copy)`, dash.description || '', dash.columns, userSlug(req)]);
    const { rows: widgets } = await pool.query(`SELECT * FROM dashboard_widgets WHERE dashboard_id = $1 AND tenant_id = $2`, [id, tid]);
    for (const w of widgets) {
      await pool.query(`INSERT INTO dashboard_widgets (tenant_id, dashboard_id, widget_type, title, position, col, config) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [tid, newDash.id, w.widget_type, w.title, w.position, w.col, JSON.stringify(w.config)]);
    }
    audit(req, 'dashboard_clone', { source_id: id, new_id: newDash.id });
    res.redirect(`/school/dashboard-builder/${newDash.id}`);
  }));

  // 12. Widget Catalog
  app.get('/school/dashboard-builder/widgets', requireAuth, ah(async (req, res) => {
    const isPartial = req.query.partial === '1';
    const selType = req.query.type || '';
    if (isPartial && selType) {
      res.type('html').send(widgetConfigForm(selType));
      return;
    }
    const catalog = [
      { type: 'stat-card', icon: '📊', title: 'Stat Card', desc: 'Single KPI with label, value, trend indicator and icon' },
      { type: 'chart-bar', icon: '📈', title: 'Bar Chart', desc: 'SVG bar chart with custom data points and colors' },
      { type: 'chart-line', icon: '📉', title: 'Line Chart', desc: 'SVG line chart with gradient fill and data points' },
      { type: 'chart-pie', icon: '🥧', title: 'Pie / Donut Chart', desc: 'SVG donut chart with legend and percentage labels' },
      { type: 'table-list', icon: '📋', title: 'Data Table', desc: 'Configurable table with custom columns and row data' },
      { type: 'recent-activity', icon: '🕐', title: 'Recent Activity', desc: 'Timeline feed showing recent actions and events' },
      { type: 'calendar-mini', icon: '📅', title: 'Mini Calendar', desc: 'Compact monthly calendar with event highlights' },
      { type: 'quick-actions', icon: '⚡', title: 'Quick Actions', desc: 'Grid of clickable action buttons with icons' },
      { type: 'progress-tracker', icon: '📊', title: 'Progress Tracker', desc: 'Progress bars with labels, percentages, and color coding' },
      { type: 'announcement-feed', icon: '📢', title: 'Announcement Feed', desc: 'Priority-tagged announcement cards with dates' }
    ];
    const cards = catalog.map(c => `<div class="db-catalog-card"><div class="icon">${c.icon}</div><h4>${c.title}</h4><p>${c.desc}</p>
      <div style="margin-top:12px"><span class="db-badge db-badge-gray">${c.type}</span></div></div>`).join('');

    const html = `${CSS}<div class="db-wrap">
      <div class="db-header"><div><h1>Widget Catalog</h1><p class="sub">Available widget types for your dashboards</p></div>
        <a href="/school/dashboard-builder" class="db-btn db-btn-secondary">← Gallery</a></div>
      <div class="db-catalog-grid">${cards}</div></div>`;
    res.send(renderPage('Widget Catalog', html, req.session?.user));
  }));
};
