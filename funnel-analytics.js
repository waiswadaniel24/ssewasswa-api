/**
 * Funnel Analytics Module — School SaaS Portal
 * Conversion funnel visualization for enrollment, payment, attendance & custom funnels.
 */
module.exports = function (app, pool, opts) {
  const esc = opts.esc || (s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));
  const tenantId = (req) => req.session?.user?.tenant_id || 0;
  const { renderPage, ah, requireAuth, audit } = opts;
  const prefix = '/school/funnels';

  /* ── Schema bootstrap ─────────────────────────────────────────── */
  const initSQL = `
    CREATE TABLE IF NOT EXISTS analytics_funnels (
      id SERIAL PRIMARY KEY, tenant_id INT NOT NULL DEFAULT 0,
      name VARCHAR(255) NOT NULL, description TEXT,
      funnel_type VARCHAR(50) DEFAULT 'custom',
      stages JSONB DEFAULT '[]'::jsonb,
      data_source VARCHAR(50) DEFAULT 'manual',
      is_active BOOLEAN DEFAULT true,
      created_by VARCHAR(255), created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS funnel_stage_data (
      id SERIAL PRIMARY KEY, tenant_id INT NOT NULL DEFAULT 0,
      funnel_id INT NOT NULL REFERENCES analytics_funnels(id) ON DELETE CASCADE,
      stage_name VARCHAR(255) NOT NULL, stage_order INT NOT NULL DEFAULT 0,
      count INT DEFAULT 0,
      conversion_from_previous NUMERIC(5,2),
      conversion_overall NUMERIC(5,2),
      recorded_date DATE DEFAULT CURRENT_DATE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;
  pool.query(initSQL).catch(e => console.error('[funnel-analytics] init error', e.message));

  /* ── Helpers ──────────────────────────────────────────────────── */
  function funnelPage(req, res, title, body, extraHead) {
    const css = `
      .funnel-wrap{max-width:960px;margin:0 auto;font-family:system-ui,sans-serif}
      .funnel-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;flex-wrap:wrap;gap:12px}
      .funnel-header h1{font-size:1.6rem;color:#1e1b4b;margin:0}
      .btn{display:inline-block;padding:8px 18px;border-radius:8px;font-size:.875rem;font-weight:600;
        text-decoration:none;cursor:pointer;border:none;transition:all .15s}
      .btn-primary{background:#4f46e5;color:#fff}.btn-primary:hover{background:#4338ca}
      .btn-outline{background:transparent;color:#4f46e5;border:1.5px solid #4f46e5}.btn-outline:hover{background:#eef2ff}
      .btn-danger{background:#ef4444;color:#fff}.btn-danger:hover{background:#dc2626}
      .btn-success{background:#22c55e;color:#fff}.btn-success:hover{background:#16a34a}
      .btn-sm{padding:5px 12px;font-size:.78rem}
      .card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px;margin-bottom:16px}
      .card-title{font-size:1rem;font-weight:700;color:#312e81;margin-bottom:12px}
      .funnel-svg-wrap{overflow-x:auto;padding:8px 0}
      .stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:20px}
      .stat-box{background:#f5f3ff;border-radius:10px;padding:16px;text-align:center}
      .stat-box .val{font-size:1.5rem;font-weight:800;color:#4f46e5}
      .stat-box .lbl{font-size:.75rem;color:#6b7280;margin-top:2px}
      .stage-table{width:100%;border-collapse:collapse;font-size:.85rem}
      .stage-table th{text-align:left;padding:8px 10px;background:#f9fafb;border-bottom:2px solid #e5e7eb;color:#374151}
      .stage-table td{padding:8px 10px;border-bottom:1px solid #f3f4f6}
      .stage-table tr:hover td{background:#faf5ff}
      .form-group{margin-bottom:14px}
      .form-group label{display:block;font-weight:600;font-size:.85rem;color:#374151;margin-bottom:4px}
      .form-group input,.form-group textarea,.form-group select{width:100%;padding:8px 12px;
        border:1px solid #d1d5db;border-radius:8px;font-size:.9rem;box-sizing:border-box}
      .form-group textarea{resize:vertical;min-height:80px}
      .stage-row{display:flex;gap:8px;align-items:center;margin-bottom:8px}
      .stage-row input{flex:1;padding:6px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:.85rem}
      .stage-row .num{width:28px;height:28px;background:#4f46e5;color:#fff;border-radius:50%;
        display:flex;align-items:center;justify-content:center;font-size:.75rem;font-weight:700;flex-shrink:0}
      .badge{display:inline-block;padding:2px 8px;border-radius:9999px;font-size:.7rem;font-weight:600}
      .badge-active{background:#dcfce7;color:#166534}.badge-inactive{background:#fef2f2;color:#991b1b}
      .badge-prebuilt{background:#eef2ff;color:#4f46e5}
      .empty-state{text-align:center;padding:48px 20px;color:#9ca3af}
      .empty-state svg{width:64px;height:64px;margin-bottom:12px;opacity:.5}
      .trend-chart{width:100%;height:280px}
      .toast{position:fixed;top:20px;right:20px;padding:12px 20px;border-radius:10px;color:#fff;
        font-size:.85rem;font-weight:600;z-index:9999;animation:slideIn .3s}
      .toast-success{background:#22c55e}.toast-error{background:#ef4444}
      @keyframes slideIn{from{transform:translateX(100%);opacity:0}to{transform:translateX(0);opacity:1}}
      .insight-row{display:flex;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid #f3f4f6}
      .insight-icon{width:24px;height:24px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:.75rem;flex-shrink:0}
      .insight-good{background:#dcfce7;color:#166534}
      .insight-warn{background:#fef9c3;color:#854d0e}
      .insight-bad{background:#fef2f2;color:#991b1b}
      .data-entry-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;margin-bottom:14px}
      .data-entry-item{padding:10px;border:1px solid #e5e7eb;border-radius:8px}
      .data-entry-item label{font-size:.78rem;font-weight:600;color:#4b5563;margin-bottom:4px;display:block}
      .data-entry-item input{width:100%;padding:6px 8px;border:1px solid #d1d5db;border-radius:6px;font-size:.9rem}
      .search-bar{display:flex;gap:8px;margin-bottom:16px}
      .search-bar input{flex:1;padding:8px 14px;border:1px solid #d1d5db;border-radius:8px;font-size:.9rem}
    `;
    const head = `<link rel="stylesheet" href="/css/sk.css"><style>${css}</style>${extraHead || ''}`;
    renderPage(req, res, title, `<div class="funnel-wrap">${body}</div>`, head);
  }

  /* Build SVG funnel chart — horizontal trapezoid bars */
  function buildFunnelSVG(stages, width = 800, height = 380) {
    if (!stages.length) return '<p class="empty-state">No stage data available</p>';
    const maxVal = Math.max(...stages.map(s => s.count || 1));
    const barH = Math.min(48, (height - 40) / stages.length - 10);
    const cx = width / 2;
    const colors = ['#4f46e5','#6366f1','#818cf8','#a5b4fc','#c7d2fe','#7c3aed','#8b5cf6','#a78bfa'];
    let svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" style="font-family:system-ui,sans-serif">`;
    svg += `<defs><linearGradient id="fg" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#4f46e5"/><stop offset="100%" stop-color="#818cf8"/>
    </linearGradient></defs>`;
    let y = 16;
    stages.forEach((st, i) => {
      const ratio = (st.count || 0) / maxVal;
      const bw = Math.max(80, ratio * (width - 160));
      const x = cx - bw / 2;
      const prevBw = i > 0 ? Math.max(80, (stages[i - 1].count || 0) / maxVal * (width - 160)) : bw;
      const c = colors[i % colors.length];
      const pts = `${x},${y} ${x + bw},${y} ${cx + prevBw / 2},${y + barH} ${cx - prevBw / 2},${y + barH}`;
      svg += `<polygon points="${pts}" fill="${c}" opacity="0.88"/>`;
      const label = `${esc(st.stage_name)}: ${Number(st.count).toLocaleString()}`;
      svg += `<text x="${cx}" y="${y + barH / 2 + 5}" text-anchor="middle" fill="#fff" font-size="13" font-weight="700">${label}</text>`;
      if (i > 0 && st.conversion_from_previous != null) {
        const pct = Number(st.conversion_from_previous).toFixed(1);
        const arrowY = y - 4;
        const arrowColor = parseFloat(pct) >= 60 ? '#22c55e' : parseFloat(pct) >= 40 ? '#f59e0b' : '#ef4444';
        svg += `<text x="${cx}" y="${arrowY}" text-anchor="middle" fill="${arrowColor}" font-size="11" font-weight="700">▼ ${pct}%</text>`;
      }
      y += barH + 16;
    });
    svg += '</svg>';
    return `<div class="funnel-svg-wrap">${svg}</div>`;
  }

  /* Build SVG line chart for trends */
  function buildTrendSVG(trendData, width = 760, height = 260) {
    if (!trendData.length) return '<p class="empty-state">No trend data available</p>';
    const stages = Object.keys(trendData[0]).filter(k => k !== 'date');
    const pad = { t: 20, r: 20, b: 40, l: 50 };
    const cw = width - pad.l - pad.r, ch = height - pad.t - pad.b;
    let maxV = 0;
    trendData.forEach(r => stages.forEach(s => { if (r[s] > maxV) maxV = r[s]; }));
    maxV = maxV || 100;
    const colors = ['#4f46e5','#f59e0b','#22c55e','#ef4444','#8b5cf6','#06b6d4'];
    let svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" style="font-family:system-ui,sans-serif">`;
    svg += `<line x1="${pad.l}" y1="${pad.t}" x2="${pad.l}" y2="${pad.t + ch}" stroke="#e5e7eb"/>`;
    svg += `<line x1="${pad.l}" y1="${pad.t + ch}" x2="${pad.l + cw}" y2="${pad.t + ch}" stroke="#e5e7eb"/>`;
    for (let i = 0; i <= 4; i++) {
      const yy = pad.t + ch - (ch * i / 4);
      const val = Math.round(maxV * i / 4);
      svg += `<text x="${pad.l - 8}" y="${yy + 4}" text-anchor="end" fill="#6b7280" font-size="10">${val}</text>`;
      svg += `<line x1="${pad.l}" y1="${yy}" x2="${pad.l + cw}" y2="${yy}" stroke="#f3f4f6"/>`;
    }
    const xStep = trendData.length > 1 ? cw / (trendData.length - 1) : 0;
    stages.forEach((st, si) => {
      const c = colors[si % colors.length];
      let pts = '';
      trendData.forEach((r, ri) => {
        const px = pad.l + ri * xStep;
        const py = pad.t + ch - (r[st] / maxV * ch);
        pts += `${px},${py} `;
      });
      svg += `<polyline points="${pts.trim()}" fill="none" stroke="${c}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
      trendData.forEach((r, ri) => {
        const px = pad.l + ri * xStep;
        const py = pad.t + ch - (r[st] / maxV * ch);
        svg += `<circle cx="${px}" cy="${py}" r="3.5" fill="${c}" stroke="#fff" stroke-width="1.5"/>`;
      });
    });
    trendData.forEach((r, ri) => {
      const px = pad.l + ri * xStep;
      svg += `<text x="${px}" y="${pad.t + ch + 18}" text-anchor="middle" fill="#6b7280" font-size="10">${String(r.date).slice(5)}</text>`;
    });
    stages.forEach((st, si) => {
      const lx = pad.l + si * 130;
      svg += `<rect x="${lx}" y="${height - 10}" width="10" height="10" rx="2" fill="${colors[si % colors.length]}"/>`;
      svg += `<text x="${lx + 14}" y="${height - 1}" fill="#374151" font-size="10">${esc(st)}</text>`;
    });
    svg += '</svg>';
    return `<div class="trend-chart">${svg}</div>`;
  }

  /* Simulated pre-built data generator */
  function prebuiltData(type) {
    const sets = {
      enrollment: [
        { stage_name: 'Inquiries Received', count: 1250 },
        { stage_name: 'Applications Started', count: 890 },
        { stage_name: 'Documents Submitted', count: 620 },
        { stage_name: 'Assessment Completed', count: 480 },
        { stage_name: 'Offer Extended', count: 340 },
        { stage_name: 'Enrollment Confirmed', count: 275 }
      ],
      payments: [
        { stage_name: 'Invoices Generated', count: 980 },
        { stage_name: 'Payment Initiated', count: 720 },
        { stage_name: 'Payment Completed', count: 590 },
        { stage_name: 'Receipt Issued', count: 560 },
        { stage_name: 'Refunds Processed', count: 42 }
      ],
      attendance: [
        { stage_name: 'Students Registered', count: 1400 },
        { stage_name: 'Present Today', count: 1180 },
        { stage_name: 'On Time', count: 1050 },
        { stage_name: 'Late Arrival', count: 130 },
        { stage_name: 'Absent', count: 220 }
      ]
    };
    let stages = sets[type] || sets.enrollment;
    let prev = 0;
    return stages.map(s => {
      const fromPrev = prev > 0 ? (s.count / prev * 100) : 100;
      const overall = stages[0].count > 0 ? (s.count / stages[0].count * 100) : 0;
      prev = s.count;
      return { ...s, conversion_from_previous: Math.round(fromPrev * 100) / 100, conversion_overall: Math.round(overall * 100) / 100 };
    });
  }

  /* Generate conversion insights from stages */
  function buildInsights(stages) {
    if (stages.length < 2) return '';
    let html = '<div class="card"><div class="card-title">💡 Conversion Insights</div>';
    let maxDrop = 0, maxDropName = '';
    stages.forEach((s, i) => {
      if (i === 0) return;
      const drop = 100 - Number(s.conversion_from_previous);
      if (drop > maxDrop) { maxDrop = drop; maxDropName = `${stages[i - 1].stage_name} → ${s.stage_name}`; }
    });
    const worstColor = maxDrop >= 50 ? 'insight-bad' : maxDrop >= 30 ? 'insight-warn' : 'insight-good';
    html += `<div class="insight-row"><span class="insight-icon ${worstColor}">⚠</span>
      <span><strong>Biggest drop-off:</strong> ${esc(maxDropName)} (${maxDrop.toFixed(1)}%)</span></div>`;
    const lastStage = stages[stages.length - 1];
    const overallRate = Number(lastStage.conversion_overall);
    const rateColor = overallRate >= 50 ? 'insight-good' : overallRate >= 25 ? 'insight-warn' : 'insight-bad';
    html += `<div class="insight-row"><span class="insight-icon ${rateColor}">${overallRate >= 50 ? '✓' : '↘'}</span>
      <span><strong>Overall conversion:</strong> ${overallRate.toFixed(1)}% from top to bottom</span></div>`;
    const avgRate = stages.slice(1).reduce((sum, s) => sum + Number(s.conversion_from_previous), 0) / (stages.length - 1);
    html += `<div class="insight-row"><span class="insight-icon ${avgRate >= 70 ? 'insight-good' : 'insight-warn'}">∑</span>
      <span><strong>Average stage-to-stage:</strong> ${avgRate.toFixed(1)}%</span></div>`;
    html += '</div>';
    return html;
  }

  /* Shared stage table builder */
  function buildStageTable(stages) {
    let rows = '';
    stages.forEach((s, i) => {
      const cp = s.conversion_from_previous != null ? Number(s.conversion_from_previous).toFixed(1) + '%' : '—';
      const co = s.conversion_overall != null ? Number(s.conversion_overall).toFixed(1) + '%' : '—';
      const barW = stages[0].count > 0 ? (s.count / stages[0].count * 100) : 0;
      rows += `<tr><td>${i + 1}</td><td><strong>${esc(s.stage_name)}</strong></td>
        <td>${Number(s.count).toLocaleString()}</td><td>${cp}</td><td>${co}</td>
        <td style="min-width:100px"><div style="background:#e5e7eb;border-radius:4px;height:8px;width:100%">
          <div style="background:#4f46e5;height:8px;border-radius:4px;width:${barW.toFixed(1)}%"></div></div></td></tr>`;
    });
    return `<div class="card"><div class="card-title">Stage Details</div>
      <div style="overflow-x:auto"><table class="stage-table">
        <thead><tr><th>#</th><th>Stage</th><th>Count</th><th>From Prev</th><th>Overall</th><th>Distribution</th></tr></thead>
        <tbody>${rows}</tbody></table></div></div>`;
  }

  /* ── 1. Dashboard ─────────────────────────────────────────────── */
  app.get(`${prefix}`, requireAuth, async (req, res) => {
    const tid = tenantId(req);
    const { rows: funnels } = await pool.query(
      'SELECT * FROM analytics_funnels WHERE tenant_id=$1 ORDER BY created_at DESC', [tid]);
    const prebuilt = [
      { type: 'enrollment', name: 'Student Enrollment Funnel', icon: '🎓', desc: 'Track inquiry-to-enrollment pipeline' },
      { type: 'payments', name: 'Payment Conversion Funnel', icon: '💳', desc: 'Monitor invoice-to-payment completion' },
      { type: 'attendance', name: 'Daily Attendance Funnel', icon: '📋', desc: 'Visualize student attendance flow' }
    ];
    let cards = '';
    prebuilt.forEach(p => {
      cards += `<div class="card" style="cursor:pointer" onclick="location.href='${prefix}/${p.type}'">
        <div class="card-title">${p.icon} ${esc(p.name)} <span class="badge badge-prebuilt">Pre-built</span></div>
        <p style="color:#6b7280;font-size:.85rem;margin:0 0 8px">${esc(p.desc)}</p>
        <a href="${prefix}/${p.type}" class="btn btn-outline btn-sm">View Funnel →</a></div>`;
    });
    if (funnels.length) {
      cards += `<h3 style="color:#312e81;margin:24px 0 10px;font-size:1.1rem">Custom Funnels</h3>`;
      funnels.forEach(f => {
        const badge = f.is_active ? '<span class="badge badge-active">Active</span>' : '<span class="badge badge-inactive">Inactive</span>';
        const srcLabel = f.data_source ? `<span style="color:#9ca3af;font-size:.72rem">Source: ${esc(f.data_source)}</span><br>` : '';
        cards += `<div class="card" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <div><div class="card-title" style="margin-bottom:4px">${esc(f.name)} ${badge}</div>
          ${srcLabel}<span style="color:#9ca3af;font-size:.78rem">Created ${f.created_at.toLocaleDateString()}</span></div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <a href="${prefix}/${f.id}" class="btn btn-primary btn-sm">View</a>
            <a href="${prefix}/${f.id}/edit" class="btn btn-outline btn-sm">Edit</a>
            <a href="${prefix}/${f.id}/trends" class="btn btn-outline btn-sm">📈 Trends</a>
            <form method="POST" action="${prefix}/${f.id}/clone" style="display:inline">
              <button class="btn btn-outline btn-sm">📋</button></form>
            <form method="POST" action="${prefix}/${f.id}" style="display:inline" onsubmit="return confirm('Delete this funnel?')">
              <input type="hidden" name="_method" value="delete"><button class="btn btn-danger btn-sm">Delete</button></form>
          </div></div>`;
      });
    } else {
      cards += `<div class="empty-state">
        <p style="margin-top:8px">No custom funnels yet. Create your first funnel to start tracking conversions.</p>
        <a href="${prefix}/create" class="btn btn-primary" style="margin-top:12px">+ Create Funnel</a></div>`;
    }
    const body = `
      <div class="funnel-header"><h1>📊 Funnel Analytics</h1>
        <a href="${prefix}/create" class="btn btn-primary">+ Create Funnel</a></div>
      <div class="stats-grid">
        <div class="stat-box"><div class="val">${funnels.length}</div><div class="lbl">Custom Funnels</div></div>
        <div class="stat-box"><div class="val">3</div><div class="lbl">Pre-Built Funnels</div></div>
        <div class="stat-box"><div class="val">${funnels.filter(f => f.is_active).length}</div><div class="lbl">Active Funnels</div></div>
        <div class="stat-box"><div class="val">${funnels.filter(f => !f.is_active).length}</div><div class="lbl">Archived</div></div>
      </div>
      <h2 style="color:#312e81;font-size:1.15rem;margin:20px 0 10px">Pre-Built Funnels</h2>
      ${cards}`;
    funnelPage(req, res, 'Funnel Analytics', body);
  });

  /* ── 2. Create funnel form ────────────────────────────────────── */
  app.get(`${prefix}/create`, requireAuth, (req, res) => {
    const body = `
      <div class="funnel-header"><h1>Create Custom Funnel</h1>
        <a href="${prefix}" class="btn btn-outline">← Back</a></div>
      <form method="POST" action="${prefix}/create" id="funnelForm">
        <div class="card">
          <div class="form-group"><label>Funnel Name *</label>
            <input type="text" name="name" required placeholder="e.g. Admissions Pipeline 2025"></div>
          <div class="form-group"><label>Description</label>
            <textarea name="description" placeholder="Describe this funnel's purpose and what it tracks..."></textarea></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div class="form-group"><label>Data Source</label>
              <select name="data_source">
                <option value="manual">Manual Entry</option>
                <option value="enrollment">Enrollment Data</option>
                <option value="payments">Payment Data</option>
                <option value="attendance">Attendance Data</option>
              </select></div>
            <div class="form-group"><label>Status</label>
              <select name="is_active">
                <option value="true">Active</option>
                <option value="false">Draft / Inactive</option>
              </select></div>
          </div>
        </div>
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
            <div class="card-title" style="margin:0">Funnel Stages (top to bottom)</div>
            <button type="button" class="btn btn-outline btn-sm" onclick="addStage()">+ Add Stage</button>
          </div>
          <p style="color:#6b7280;font-size:.8rem;margin-bottom:12px">Define each step in your conversion funnel. The first stage represents the widest entry point.</p>
          <div id="stagesContainer">
            <div class="stage-row"><span class="num">1</span><input name="stages[]" placeholder="Stage name (e.g. Leads)" required></div>
            <div class="stage-row"><span class="num">2</span><input name="stages[]" placeholder="Stage name (e.g. Qualified)" required></div>
            <div class="stage-row"><span class="num">3</span><input name="stages[]" placeholder="Stage name (e.g. Converted)" required></div>
          </div>
        </div>
        <div style="display:flex;gap:8px">
          <button type="submit" class="btn btn-primary" style="flex:1;padding:12px">Create Funnel</button>
          <a href="${prefix}" class="btn btn-outline" style="padding:12px 20px">Cancel</a>
        </div>
      </form>
      <script>
        function addStage(){const c=document.getElementById('stagesContainer');const n=c.children.length+1;
          const d=document.createElement('div');d.className='stage-row';
          d.innerHTML='<span class="num">'+n+'</span><input name="stages[]" placeholder="Stage name" required>';
          c.appendChild(d)}
      </script>`;
    funnelPage(req, res, 'Create Funnel', body);
  });

  /* ── 3. Save funnel ───────────────────────────────────────────── */
  app.post(`${prefix}/create`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const { name, description, data_source, stages, is_active } = req.body;
    const stageArr = Array.isArray(stages) ? stages : [stages];
    const stagesJSON = JSON.stringify(stageArr.filter(Boolean));
    const active = is_active !== 'false' && is_active !== false;
    const { rows } = await pool.query(
      `INSERT INTO analytics_funnels (tenant_id,name,description,funnel_type,stages,data_source,is_active,created_by)
       VALUES ($1,$2,$3,'custom',$4,$5,$6,$7) RETURNING id`,
      [tid, name, description || '', stagesJSON, data_source || 'manual', active, req.session.user?.email || '']);
    audit(req, 'funnel_created', `Created funnel: ${name}`);
    res.redirect(`${prefix}/${rows[0].id}`);
  }));

  /* ── 4. View funnel ───────────────────────────────────────────── */
  app.get(`${prefix}/:id`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const fid = req.params.id;
    if (['enrollment', 'payments', 'attendance'].includes(fid)) {
      return res.redirect(`${prefix}/${fid}`);
    }
    const { rows: [funnel] } = await pool.query(
      'SELECT * FROM analytics_funnels WHERE id=$1 AND tenant_id=$2', [fid, tid]);
    if (!funnel) return res.status(404).send('Funnel not found');
    const { rows: data } = await pool.query(
      'SELECT * FROM funnel_stage_data WHERE funnel_id=$1 AND tenant_id=$2 ORDER BY stage_order', [fid, tid]);
    let stages;
    if (data.length) {
      stages = data.map(d => ({ stage_name: d.stage_name, stage_order: d.stage_order, count: d.count,
        conversion_from_previous: d.conversion_from_previous, conversion_overall: d.conversion_overall }));
    } else {
      const names = funnel.stages || [];
      const counts = names.map((n, i) => Math.max(10, Math.round(1000 * Math.pow(0.7, i) + Math.random() * 80)));
      stages = names.map((n, i) => ({
        stage_name: n, stage_order: i, count: counts[i],
        conversion_from_previous: i === 0 ? 100 : Math.round(counts[i] / counts[i - 1] * 10000) / 100,
        conversion_overall: Math.round(counts[i] / counts[0] * 10000) / 100
      }));
    }
    const svgChart = buildFunnelSVG(stages);
    const insights = buildInsights(stages);
    let tableRows = '';
    stages.forEach((s, i) => {
      const cp = s.conversion_from_previous != null ? Number(s.conversion_from_previous).toFixed(1) + '%' : '—';
      const co = s.conversion_overall != null ? Number(s.conversion_overall).toFixed(1) + '%' : '—';
      tableRows += `<tr><td>${i + 1}</td><td><strong>${esc(s.stage_name)}</strong></td>
        <td>${Number(s.count).toLocaleString()}</td><td>${cp}</td><td>${co}</td></tr>`;
    });
    // Data entry form for stage counts
    let dataEntry = '';
    if (funnel.is_active) {
      dataEntry = `<div class="card"><div class="card-title">📝 Update Stage Counts</div>
        <form method="POST" action="${prefix}/${fid}/data" class="data-entry-grid">`;
      stages.forEach((s, i) => {
        dataEntry += `<div class="data-entry-item"><label>${esc(s.stage_name)}</label>
          <input type="number" name="counts[]" value="${s.count}" min="0"></div>`;
      });
      dataEntry += `</div><button type="submit" class="btn btn-success btn-sm" style="margin-top:8px">Save Counts</button></form></div>`;
    }
    const body = `
      <div class="funnel-header"><h1>${esc(funnel.name)}</h1>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <a href="${prefix}/${fid}/trends" class="btn btn-outline btn-sm">📈 Trends</a>
          <form method="POST" action="${prefix}/${fid}/clone" style="display:inline">
            <button class="btn btn-outline btn-sm">📋 Clone</button></form>
          <a href="${prefix}" class="btn btn-outline btn-sm">← Back</a></div></div>
      ${insights}
      <div class="card"><div class="card-title">Funnel Visualization</div>${svgChart}</div>
      ${dataEntry}
      <div class="card"><div class="card-title">Stage Breakdown</div>
        <div style="overflow-x:auto"><table class="stage-table">
          <thead><tr><th>#</th><th>Stage</th><th>Count</th><th>From Previous</th><th>Overall</th></tr></thead>
          <tbody>${tableRows}</tbody></table></div></div>`;
    funnelPage(req, res, `Funnel: ${funnel.name}`, body);
  }));

  /* Save stage counts data */
  app.post(`${prefix}/:id/data`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const fid = req.params.id;
    const { counts } = req.body;
    const countArr = Array.isArray(counts) ? counts.map(Number) : [Number(counts)];
    const { rows: [funnel] } = await pool.query(
      'SELECT * FROM analytics_funnels WHERE id=$1 AND tenant_id=$2', [fid, tid]);
    if (!funnel) return res.status(404).send('Funnel not found');
    const names = funnel.stages || [];
    // Clear old data for today
    const today = new Date().toISOString().slice(0, 10);
    await pool.query(
      'DELETE FROM funnel_stage_data WHERE funnel_id=$1 AND tenant_id=$2 AND recorded_date=$3', [fid, tid, today]);
    // Insert new
    for (let i = 0; i < names.length && i < countArr.length; i++) {
      const cnt = Math.max(0, countArr[i] || 0);
      const fromPrev = i === 0 ? 100 : (cnt / (countArr[i - 1] || 1) * 100);
      const overall = (cnt / (countArr[0] || 1) * 100);
      await pool.query(
        `INSERT INTO funnel_stage_data (tenant_id,funnel_id,stage_name,stage_order,count,conversion_from_previous,conversion_overall,recorded_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [tid, fid, names[i], i, cnt, Math.round(fromPrev * 100) / 100, Math.round(overall * 100) / 100, today]);
    }
    audit(req, 'funnel_data_updated', `Updated stage counts for funnel id=${fid}`);
    res.redirect(`${prefix}/${fid}`);
  }));

  /* ── 5. Edit funnel form + POST ───────────────────────────────── */
  app.get(`${prefix}/:id/edit`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const fid = req.params.id;
    const { rows: [funnel] } = await pool.query(
      'SELECT * FROM analytics_funnels WHERE id=$1 AND tenant_id=$2', [fid, tid]);
    if (!funnel) return res.status(404).send('Funnel not found');
    const names = funnel.stages || [];
    let stageRows = '';
    names.forEach((n, i) => {
      stageRows += `<div class="stage-row"><span class="num">${i + 1}</span>
        <input name="stages[]" value="${esc(n)}" required></div>`;
    });
    const body = `
      <div class="funnel-header"><h1>Edit Funnel</h1>
        <a href="${prefix}/${fid}" class="btn btn-outline">← Back</a></div>
      <form method="POST" action="${prefix}/${fid}/edit">
        <div class="card">
          <div class="form-group"><label>Funnel Name *</label>
            <input type="text" name="name" value="${esc(funnel.name)}" required></div>
          <div class="form-group"><label>Description</label>
            <textarea name="description">${esc(funnel.description || '')}</textarea></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div class="form-group"><label>Data Source</label>
              <select name="data_source">
                ${['manual','enrollment','payments','attendance'].map(s =>
                  `<option value="${s}" ${funnel.data_source === s ? 'selected' : ''}>${s}</option>`).join('')}
              </select></div>
            <div class="form-group"><label>Status</label>
              <select name="is_active">
                <option value="true" ${funnel.is_active ? 'selected' : ''}>Active</option>
                <option value="false" ${!funnel.is_active ? 'selected' : ''}>Inactive</option>
              </select></div>
          </div>
        </div>
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
            <div class="card-title" style="margin:0">Funnel Stages</div>
            <button type="button" class="btn btn-outline btn-sm" onclick="addStage()">+ Add Stage</button>
          </div>
          <div id="stagesContainer">${stageRows}</div>
        </div>
        <div style="display:flex;gap:8px">
          <button type="submit" class="btn btn-primary" style="flex:1;padding:12px">Save Changes</button>
          <a href="${prefix}/${fid}" class="btn btn-outline" style="padding:12px 20px">Cancel</a>
        </div>
      </form>
      <script>
        function addStage(){const c=document.getElementById('stagesContainer');const n=c.children.length+1;
          const d=document.createElement('div');d.className='stage-row';
          d.innerHTML='<span class="num">'+n+'</span><input name="stages[]" placeholder="Stage name" required>';
          c.appendChild(d)}
      </script>`;
    funnelPage(req, res, `Edit: ${funnel.name}`, body);
  }));

  app.post(`${prefix}/:id/edit`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const fid = req.params.id;
    const { name, description, data_source, stages, is_active } = req.body;
    const stageArr = Array.isArray(stages) ? stages : [stages];
    const active = is_active !== 'false' && is_active !== false;
    await pool.query(
      'UPDATE analytics_funnels SET name=$1,description=$2,stages=$3,data_source=$4,is_active=$5 WHERE id=$6 AND tenant_id=$7',
      [name, description || '', JSON.stringify(stageArr.filter(Boolean)), data_source || 'manual', active, fid, tid]);
    audit(req, 'funnel_updated', `Updated funnel: ${name}`);
    res.redirect(`${prefix}/${fid}`);
  }));

  /* ── 6. Delete funnel ─────────────────────────────────────────── */
  app.delete(`${prefix}/:id`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    await pool.query('DELETE FROM analytics_funnels WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    audit(req, 'funnel_deleted', `Deleted funnel id=${req.params.id}`);
    res.redirect(prefix);
  }));
  app.post(`${prefix}/:id`, requireAuth, ah(async (req, res) => {
    if (req.body._method === 'delete') {
      const tid = tenantId(req);
      await pool.query('DELETE FROM analytics_funnels WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
      audit(req, 'funnel_deleted', `Deleted funnel id=${req.params.id}`);
      return res.redirect(prefix);
    }
    res.status(405).send('Method not allowed');
  }));

  /* ── 7. Trends ────────────────────────────────────────────────── */
  app.get(`${prefix}/:id/trends`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const fid = req.params.id;
    const { rows: [funnel] } = await pool.query(
      'SELECT * FROM analytics_funnels WHERE id=$1 AND tenant_id=$2', [fid, tid]);
    if (!funnel) return res.status(404).send('Funnel not found');
    const { rows: data } = await pool.query(
      `SELECT recorded_date AS date, stage_name, count
       FROM funnel_stage_data WHERE funnel_id=$1 AND tenant_id=$2
       ORDER BY recorded_date, stage_order`, [fid, tid]);
    let trendData = [];
    if (data.length >= 2) {
      const dateMap = {};
      data.forEach(d => {
        if (!dateMap[d.date]) dateMap[d.date] = { date: d.date };
        dateMap[d.date][d.stage_name] = d.count;
      });
      trendData = Object.values(dateMap);
    } else {
      const names = funnel.stages || ['Stage 1', 'Stage 2', 'Stage 3'];
      for (let d = 6; d >= 0; d--) {
        const date = new Date(); date.setDate(date.getDate() - d);
        const row = { date: date.toISOString().slice(0, 10) };
        names.forEach((n, i) => { row[n] = Math.round(800 * Math.pow(0.7, i) + Math.random() * 100); });
        trendData.push(row);
      }
    }
    const chart = buildTrendSVG(trendData);
    let body = `
      <div class="funnel-header"><h1>📈 Trends — ${esc(funnel.name)}</h1>
        <a href="${prefix}/${fid}" class="btn btn-outline">← Funnel</a></div>
      <div class="card"><div class="card-title">Conversion Trends (Last 7 Days)</div>${chart}</div>
      <div class="card"><div class="card-title">Data Table</div>
        <div style="overflow-x:auto"><table class="stage-table"><thead><tr><th>Date</th>`;
    const stageNames = Object.keys(trendData[0] || {}).filter(k => k !== 'date');
    stageNames.forEach(s => { body += `<th>${esc(s)}</th>`; });
    body += '</tr></thead><tbody>';
    trendData.forEach(r => {
      body += `<tr><td>${r.date}</td>`;
      stageNames.forEach(s => { body += `<td>${Number(r[s] || 0).toLocaleString()}</td>`; });
      body += '</tr>';
    });
    body += '</tbody></table></div></div>';
    funnelPage(req, res, `Trends: ${funnel.name}`, body);
  }));

  /* ── 8. Pre-built: Enrollment ─────────────────────────────────── */
  app.get(`${prefix}/enrollment`, requireAuth, (req, res) => {
    const stages = prebuiltData('enrollment');
    const overall = (stages[stages.length - 1].count / stages[0].count * 100).toFixed(1);
    const body = `
      <div class="funnel-header"><h1>🎓 Student Enrollment Funnel</h1>
        <a href="${prefix}" class="btn btn-outline">← Dashboard</a></div>
      <div class="stats-grid">
        <div class="stat-box"><div class="val">${stages[0].count.toLocaleString()}</div><div class="lbl">Total Inquiries</div></div>
        <div class="stat-box"><div class="val">${stages[stages.length - 1].count.toLocaleString()}</div><div class="lbl">Enrolled</div></div>
        <div class="stat-box"><div class="val">${overall}%</div><div class="lbl">Overall Conversion</div></div>
        <div class="stat-box"><div class="val">${(stages[0].count - stages[stages.length - 1].count).toLocaleString()}</div><div class="lbl">Drop-offs</div></div>
      </div>
      ${buildInsights(stages)}
      <div class="card"><div class="card-title">Enrollment Pipeline</div>${buildFunnelSVG(stages)}</div>
      ${buildStageTable(stages)}`;
    funnelPage(req, res, 'Enrollment Funnel', body);
  });

  /* ── 9. Pre-built: Payments ───────────────────────────────────── */
  app.get(`${prefix}/payments`, requireAuth, (req, res) => {
    const stages = prebuiltData('payments');
    const completion = (stages[2].count / stages[0].count * 100).toFixed(1);
    const body = `
      <div class="funnel-header"><h1>💳 Payment Conversion Funnel</h1>
        <a href="${prefix}" class="btn btn-outline">← Dashboard</a></div>
      <div class="stats-grid">
        <div class="stat-box"><div class="val">${stages[0].count.toLocaleString()}</div><div class="lbl">Invoices</div></div>
        <div class="stat-box"><div class="val">${stages[2].count.toLocaleString()}</div><div class="lbl">Completed</div></div>
        <div class="stat-box"><div class="val">${completion}%</div><div class="lbl">Completion Rate</div></div>
        <div class="stat-box"><div class="val">${stages[3].count.toLocaleString()}</div><div class="lbl">Receipts Issued</div></div>
      </div>
      ${buildInsights(stages)}
      <div class="card"><div class="card-title">Payment Pipeline</div>${buildFunnelSVG(stages)}</div>
      ${buildStageTable(stages)}`;
    funnelPage(req, res, 'Payment Funnel', body);
  });

  /* ── 10. Pre-built: Attendance ────────────────────────────────── */
  app.get(`${prefix}/attendance`, requireAuth, (req, res) => {
    const stages = prebuiltData('attendance');
    const rate = ((stages[1].count + stages[3].count) / stages[0].count * 100).toFixed(1);
    const body = `
      <div class="funnel-header"><h1>📋 Daily Attendance Funnel</h1>
        <a href="${prefix}" class="btn btn-outline">← Dashboard</a></div>
      <div class="stats-grid">
        <div class="stat-box"><div class="val">${stages[0].count.toLocaleString()}</div><div class="lbl">Registered</div></div>
        <div class="stat-box"><div class="val">${stages[1].count.toLocaleString()}</div><div class="lbl">Present</div></div>
        <div class="stat-box"><div class="val">${rate}%</div><div class="lbl">Attendance Rate</div></div>
        <div class="stat-box"><div class="val">${stages[3].count.toLocaleString()}</div><div class="lbl">Late Arrivals</div></div>
      </div>
      ${buildInsights(stages)}
      <div class="card"><div class="card-title">Attendance Flow</div>${buildFunnelSVG(stages)}</div>
      ${buildStageTable(stages)}`;
    funnelPage(req, res, 'Attendance Funnel', body);
  });

  /* ── 11. API endpoint (JSON for chart libraries) ──────────────── */
  app.get(`${prefix}/api/:id`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const fid = req.params.id;
    if (['enrollment', 'payments', 'attendance'].includes(fid)) {
      return res.json({ id: fid, type: 'prebuilt', stages: prebuiltData(fid) });
    }
    const { rows: [funnel] } = await pool.query(
      'SELECT * FROM analytics_funnels WHERE id=$1 AND tenant_id=$2', [fid, tid]);
    if (!funnel) return res.status(404).json({ error: 'Funnel not found' });
    const { rows: data } = await pool.query(
      'SELECT * FROM funnel_stage_data WHERE funnel_id=$1 ORDER BY stage_order', [fid]);
    const stages = data.length
      ? data.map(d => ({ stage_name: d.stage_name, count: d.count,
          conversion_from_previous: d.conversion_from_previous,
          conversion_overall: d.conversion_overall }))
      : (funnel.stages || []).map((n, i) => ({ stage_name: n, count: 0 }));
    res.json({ id: +fid, name: funnel.name, type: funnel.funnel_type, is_active: funnel.is_active, stages });
  }));

  /* ── 12. Clone funnel ─────────────────────────────────────────── */
  app.post(`${prefix}/:id/clone`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const fid = req.params.id;
    const { rows: [src] } = await pool.query(
      'SELECT * FROM analytics_funnels WHERE id=$1 AND tenant_id=$2', [fid, tid]);
    if (!src) return res.status(404).send('Source funnel not found');
    const { rows } = await pool.query(
      `INSERT INTO analytics_funnels (tenant_id,name,description,funnel_type,stages,data_source,is_active,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [tid, src.name + ' (Copy)', src.description, src.funnel_type, src.stages, src.data_source, true,
       req.session.user?.email || '']);
    const { rows: sData } = await pool.query(
      'SELECT * FROM funnel_stage_data WHERE funnel_id=$1', [fid]);
    for (const sd of sData) {
      await pool.query(
        `INSERT INTO funnel_stage_data (tenant_id,funnel_id,stage_name,stage_order,count,conversion_from_previous,conversion_overall,recorded_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [tid, rows[0].id, sd.stage_name, sd.stage_order, sd.count, sd.conversion_from_previous,
         sd.conversion_overall, sd.recorded_date]);
    }
    audit(req, 'funnel_cloned', `Cloned funnel id=${fid} → ${rows[0].id}`);
    res.redirect(`${prefix}/${rows[0].id}`);
  }));
};
