/**
 * Student Activity Heatmap Module
 * SaaS School Portal — Zone-based tracking, engagement scoring, risk identification
 */

module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5', GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer;font-size:14px}.btn:hover{background:#3730a3}.btn-sm{padding:5px 12px;font-size:12px}.btn-danger{background:#ef4444}.btn-danger:hover{background:#dc2626}.btn-success{background:#10b981}.btn-success:hover{background:#059669}.btn-warning{background:#f59e0b;color:#000}.btn-warning:hover{background:#d97706}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb;font-size:14px}th{background:#f9fafb;font-weight:600}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;font-size:14px}.grid{display:grid;gap:16px}.grid-2{grid-template-columns:1fr 1fr}.grid-3{grid-template-columns:1fr 1fr 1fr}.grid-4{grid-template-columns:1fr 1fr 1fr 1fr}.stat-card{background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.stat-card .label{font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.5px}.stat-card .value{font-size:28px;font-weight:700;color:#111;margin-top:4px}.badge{display:inline-block;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600}.badge-green{background:#d1fae5;color:#065f46}.badge-yellow{background:#fef3c7;color:#92400e}.badge-red{background:#fee2e2;color:#991b1b}.badge-blue{background:#dbeafe;color:#1e40af}.breadcrumb{margin-bottom:16px;font-size:14px}nav.tabs{display:flex;gap:4px;margin-bottom:20px;border-bottom:2px solid #e5e7eb;padding-bottom:0}nav.tabs a{padding:10px 18px;color:#6b7280;text-decoration:none;font-size:14px;border-bottom:2px solid transparent;margin-bottom:-2px;transition:all .2s}nav.tabs a:hover{color:#4f46e5}nav.tabs a.active{color:#4f46e5;border-bottom-color:#4f46e5;font-weight:600}.flex{display:flex;align-items:center;gap:8px}.mt-1{margin-top:8px}.mt-2{margin-top:16px}.mb-1{margin-bottom:8px}.mb-2{margin-bottom:16px}.text-sm{font-size:13px}.text-xs{font-size:11px}.text-muted{color:#6b7280}.fw-bold{font-weight:700}.heatmap-cell{width:100%;aspect-ratio:1;border-radius:4px;transition:all .3s;cursor:pointer;position:relative}.heatmap-cell:hover{transform:scale(1.1);z-index:2;box-shadow:0 4px 12px rgba(0,0,0,.2)}.tooltip{position:absolute;bottom:110%;left:50%;transform:translateX(-50%);background:#1f2937;color:#fff;padding:4px 10px;border-radius:6px;font-size:11px;white-space:nowrap;pointer-events:none;opacity:0;transition:opacity .2s;z-index:10}.heatmap-cell:hover .tooltip{opacity:1}.progress-bar{height:8px;background:#e5e7eb;border-radius:4px;overflow:hidden}.progress-fill{height:100%;border-radius:4px;transition:width .6s ease}</style>';

  // ─── Auto-migrate tables ───
  (async () => {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS student_heatmap_data (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL REFERENCES tenants(id),
          student_id INTEGER NOT NULL,
          zone VARCHAR(120),
          check_in TIMESTAMPTZ DEFAULT NOW(),
          check_out TIMESTAMPTZ,
          activity_type VARCHAR(60) DEFAULT 'general',
          engagement_score NUMERIC(5,2) DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS heatmap_zones (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL REFERENCES tenants(id),
          name VARCHAR(120) NOT NULL,
          zone_type VARCHAR(60) DEFAULT 'classroom',
          capacity INTEGER DEFAULT 30,
          floor VARCHAR(20) DEFAULT '1',
          active BOOLEAN DEFAULT true,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS heatmap_alerts (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL REFERENCES tenants(id),
          student_id INTEGER NOT NULL,
          alert_type VARCHAR(60) DEFAULT 'low_engagement',
          message TEXT,
          resolved BOOLEAN DEFAULT false,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          resolved_at TIMESTAMPTZ
        )`);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_shd_tenant ON student_heatmap_data(tenant_id)`);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_shd_student ON student_heatmap_data(student_id)`);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_shd_zone ON student_heatmap_data(zone)`);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_hz_tenant ON heatmap_zones(tenant_id)`);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_ha_tenant ON heatmap_alerts(tenant_id)`);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_ha_resolved ON heatmap_alerts(resolved)`);
      console.log('[StudentHeatmap] Tables ready');
    } catch(e) { console.warn('[StudentHeatmap] Migration warning:', e.message); }
  })();

  // ─── Helpers ───
  function heatColor(score, maxScore) {
    const ratio = maxScore > 0 ? score / maxScore : 0;
    if (ratio >= 0.7) return '#10b981';
    if (ratio >= 0.4) return '#f59e0b';
    return '#ef4444';
  }

  function heatColorRGB(score, maxScore) {
    const ratio = maxScore > 0 ? Math.min(score / maxScore, 1) : 0;
    if (ratio >= 0.7) return { r: 16, g: 185, b: 129 };
    if (ratio >= 0.4) return { r: 245, g: 158, b: 11 };
    return { r: 239, g: 68, b: 68 };
  }

  function engagementBadge(score) {
    if (score >= 7) return '<span class="badge badge-green">High</span>';
    if (score >= 4) return '<span class="badge badge-yellow">Medium</span>';
    return '<span class="badge badge-red">Low</span>';
  }

  function riskBadge(riskLevel) {
    if (riskLevel === 'high') return '<span class="badge badge-red">High Risk</span>';
    if (riskLevel === 'medium') return '<span class="badge badge-yellow">Medium</span>';
    return '<span class="badge badge-green">Low</span>';
  }

  function svgHeatmapGrid(data, cols, rows, maxVal, cellSize) {
    cellSize = cellSize || 40;
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cols * cellSize + 40}" height="${rows * cellSize + 60}" style="font-family:system-ui,sans-serif">`;
    // Legend
    const legendY = rows * cellSize + 40;
    svg += `<rect x="10" y="${legendY}" width="16" height="16" rx="3" fill="#ef4444"/><text x="32" y="${legendY + 13}" font-size="11" fill="#6b7280">Low</text>`;
    svg += `<rect x="70" y="${legendY}" width="16" height="16" rx="3" fill="#f59e0b"/><text x="92" y="${legendY + 13}" font-size="11" fill="#6b7280">Moderate</text>`;
    svg += `<rect x="160" y="${legendY}" width="16" height="16" rx="3" fill="#10b981"/><text x="182" y="${legendY + 13}" font-size="11" fill="#6b7280">Active</text>`;
    // Cells
    data.forEach((item, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = col * cellSize + 20;
      const y = row * cellSize + 20;
      const color = heatColor(item.value, maxVal);
      svg += `<rect x="${x}" y="${y}" width="${cellSize - 4}" height="${cellSize - 4}" rx="6" fill="${color}" opacity="0.85">`;
      svg += `<title>${esc(item.label || '')}: ${item.value} (${item.detail || ''})</title>`;
      svg += `</rect>`;
      if (cellSize >= 36) {
        svg += `<text x="${x + (cellSize - 4) / 2}" y="${y + (cellSize - 4) / 2 + 4}" text-anchor="middle" font-size="10" fill="#fff" font-weight="600">${item.value}</text>`;
      }
    });
    svg += '</svg>';
    return svg;
  }

  function svgBarChart(data, width, height, barColor) {
    barColor = barColor || P;
    const maxVal = Math.max(...data.map(d => d.value), 1);
    const barWidth = Math.max(8, (width - 40) / data.length - 4);
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" style="font-family:system-ui,sans-serif">`;
    data.forEach((item, i) => {
      const x = 20 + i * (barWidth + 4);
      const barH = (item.value / maxVal) * (height - 50);
      const y = height - 30 - barH;
      svg += `<rect x="${x}" y="${y}" width="${barWidth}" height="${barH}" rx="3" fill="${barColor}" opacity="0.8">`;
      svg += `<title>${esc(item.label)}: ${item.value}</title></rect>`;
      if (data.length <= 20) {
        svg += `<text x="${x + barWidth / 2}" y="${height - 12}" text-anchor="middle" font-size="9" fill="#6b7280" transform="rotate(-45 ${x + barWidth / 2} ${height - 12})">${(item.label || '').substring(0, 6)}</text>`;
      }
    });
    svg += '</svg>';
    return svg;
  }

  function svgMiniLine(data, width, height, lineColor) {
    lineColor = lineColor || '#4f46e5';
    if (!data.length) return '';
    const maxVal = Math.max(...data.map(d => d.value), 1);
    const stepX = width / (data.length - 1 || 1);
    const pts = data.map((d, i) => `${i * stepX},${height - 4 - (d.value / maxVal) * (height - 8)}`).join(' ');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" style="font-family:system-ui,sans-serif"><polyline points="${pts}" fill="none" stroke="${lineColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }

  const ZONE_TYPES = ['classroom', 'library', 'lab', 'cafeteria', 'gym', 'auditorium', 'hallway', 'playground', 'office', 'other'];
  const ACTIVITY_TYPES = ['class', 'study', 'lab_work', 'sports', 'break', 'library', 'club', 'event', 'detention', 'general'];
  const ALERT_TYPES = ['low_engagement', 'high_movement', 'absent_zone', 'behavioral', 'attendance_drop', 'zone_violation'];

  // ─── Routes ───

  // Dashboard — main heatmap overview
  app.get('/school/student-heatmap', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [zones] = await pool.query(`SELECT * FROM heatmap_zones WHERE tenant_id = $1 AND active = true ORDER BY name`, [tid]);
    const [stats] = await pool.query(`
      SELECT
        COUNT(DISTINCT student_id) as total_students,
        COUNT(*) as total_checkins,
        ROUND(AVG(engagement_score)::numeric, 2) as avg_engagement,
        COUNT(*) FILTER (WHERE check_out IS NULL) as active_now,
        COUNT(DISTINCT zone) as active_zones
      FROM student_heatmap_data WHERE tenant_id = $1 AND check_in >= CURRENT_DATE`, [tid]);
    const [alerts] = await pool.query(`
      SELECT COUNT(*) as open_alerts FROM heatmap_alerts
      WHERE tenant_id = $1 AND resolved = false`, [tid]);
    const [atRisk] = await pool.query(`
      SELECT COUNT(DISTINCT student_id) as at_risk_count FROM (
        SELECT student_id, ROUND(AVG(engagement_score)::numeric, 2) as avg_eng
        FROM student_heatmap_data
        WHERE tenant_id = $1 AND check_in >= CURRENT_DATE - INTERVAL '14 days'
        GROUP BY student_id HAVING AVG(engagement_score) < 4
      ) sub`, [tid]);
    // Zone utilization for heatmap
    const [zoneData] = await pool.query(`
      SELECT z.name, z.zone_type, z.capacity, z.floor,
        COALESCE(h.cnt, 0) as checkins,
        COALESCE(h.avg_eng, 0) as avg_engagement
      FROM heatmap_zones z
      LEFT JOIN (
        SELECT zone, COUNT(*) as cnt, ROUND(AVG(engagement_score)::numeric, 2) as avg_eng
        FROM student_heatmap_data WHERE tenant_id = $1 AND check_in >= CURRENT_DATE
        GROUP BY zone
      ) h ON h.zone = z.name
      WHERE z.tenant_id = $1 AND z.active = true
      ORDER BY h.cnt DESC NULLS LAST`, [tid]);
    // Peak hours data
    const [peakHours] = await pool.query(`
      SELECT EXTRACT(HOUR FROM check_in)::int as hr, COUNT(*) as cnt
      FROM student_heatmap_data
      WHERE tenant_id = $1 AND check_in >= CURRENT_DATE - INTERVAL '7 days'
      GROUP BY hr ORDER BY hr`, [tid]);
    const maxCheckins = Math.max(...zoneData.map(z => z.checkins), 1);
    const gridCols = Math.ceil(Math.sqrt(zoneData.length)) || 4;
    const heatmapItems = zoneData.map(z => ({
      value: z.checkins,
      label: z.name,
      detail: `Eng: ${z.avg_engagement} | Cap: ${z.capacity}`
    }));
    // Recent activity
    const [recent] = await pool.query(`
      SELECT hd.*, u.name as student_name
      FROM student_heatmap_data hd
      LEFT JOIN users u ON u.id = hd.student_id
      WHERE hd.tenant_id = $1
      ORDER BY hd.check_in DESC LIMIT 10`, [tid]);
    // Day-of-week heatmap
    const [dowData] = await pool.query(`
      SELECT EXTRACT(DOW FROM check_in)::int as dow, COUNT(*) as cnt
      FROM student_heatmap_data
      WHERE tenant_id = $1 AND check_in >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY dow ORDER BY dow`, [tid]);
    const dowNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dowChart = dowNames.map((name, i) => {
      const found = dowData.find(d => d.dow === i);
      return { label: name, value: found ? found.cnt : 0 };
    });
    const maxDow = Math.max(...dowChart.map(d => d.value), 1);
    // Hourly bar chart
    const hourLabels = [];
    for (let h = 0; h < 24; h++) hourLabels.push({ hr: h, cnt: 0 });
    peakHours.forEach(ph => { if (hourLabels[ph.hr]) hourLabels[ph.hr].cnt = ph.cnt; });
    const hourlyBars = hourLabels.filter(h => h.hr >= 6 && h.hr <= 21).map(h => ({ label: `${h.hr}:00`, value: h.cnt }));

    res.send(renderPage(req, 'Student Activity Heatmap', `
      ${SKIP}
      <div class="breadcrumb" style="margin-bottom:16px"><a href="/school" style="color:${P}">School</a> &rsaquo; Student Heatmap</div>
      <nav class="tabs">
        <a href="/school/student-heatmap" class="active">Dashboard</a>
        <a href="/school/student-heatmap/zones">Zones</a>
        <a href="/school/student-heatmap/alerts">Alerts</a>
        <a href="/school/student-heatmap/behavioral">Behavioral</a>
        <a href="/school/student-heatmap/utilization">Utilization</a>
        <a href="/school/student-heatmap/comparative">Comparative</a>
        <a href="/school/student-heatmap/settings">Settings</a>
      </nav>
      <div class="grid grid-4 mb-2">
        <div class="stat-card">
          <div class="label">Active Students Today</div>
          <div class="value">${stats[0].total_students}</div>
          <div class="text-sm text-muted">Currently active: ${stats[0].active_now}</div>
        </div>
        <div class="stat-card">
          <div class="label">Total Check-ins Today</div>
          <div class="value">${stats[0].total_checkins}</div>
          <div class="text-sm text-muted">Across ${stats[0].active_zones} zones</div>
        </div>
        <div class="stat-card">
          <div class="label">Avg Engagement</div>
          <div class="value">${stats[0].avg_engagement || 0}</div>
          <div class="text-sm text-muted">/ 10 scale</div>
        </div>
        <div class="stat-card">
          <div class="label">At-Risk Students</div>
          <div class="value" style="color:#ef4444">${atRisk[0].at_risk_count}</div>
          <div class="text-sm text-muted">Open alerts: ${alerts[0].open_alerts}</div>
        </div>
      </div>
      <div class="grid grid-2 mb-2">
        <div class="card">
          <h3 style="margin:0 0 16px;font-size:16px">Zone Activity Heatmap — Today</h3>
          ${zoneData.length ? svgHeatmapGrid(heatmapItems, gridCols, Math.ceil(heatmapItems.length / gridCols), maxCheckins, 48) : '<p class="text-muted">No zone data yet. Configure zones first.</p>'}
          <div class="mt-1">
            <div class="flex" style="justify-content:space-between">
              <span class="text-sm text-muted">Zones: ${zoneData.length}</span>
              <a href="/school/student-heatmap/zones" class="btn btn-sm">Manage Zones</a>
            </div>
          </div>
        </div>
        <div class="card">
          <h3 style="margin:0 0 16px;font-size:16px">Peak Activity Hours (7 Days)</h3>
          ${svgBarChart(hourlyBars, 500, 220, '#6366f1')}
        </div>
      </div>
      <div class="grid grid-2 mb-2">
        <div class="card">
          <h3 style="margin:0 0 16px;font-size:16px">Day-of-Week Activity</h3>
          ${svgBarChart(dowChart, 400, 180, '#10b981')}
        </div>
        <div class="card">
          <h3 style="margin:0 0 16px;font-size:16px">Recent Activity</h3>
          ${recent.length ? `<table><tr><th>Student</th><th>Zone</th><th>Time</th><th>Engagement</th></tr>
            ${recent.map(r => `<tr>
              <td><a href="/school/student-heatmap/student-detail/${r.student_id}">${esc(r.student_name || 'Unknown')}</a></td>
              <td>${esc(r.zone || '-')}</td>
              <td class="text-sm">${r.check_in ? new Date(r.check_in).toLocaleTimeString() : '-'}</td>
              <td>${engagementBadge(r.engagement_score)}</td>
            </tr>`).join('')}
          </table>` : '<p class="text-muted">No recent activity recorded.</p>'}
        </div>
      </div>
      <div class="card">
        <h3 style="margin:0 0 12px;font-size:16px">Zone Utilization Details</h3>
        <table>
          <tr><th>Zone</th><th>Type</th><th>Floor</th><th>Capacity</th><th>Check-ins</th><th>Avg Engagement</th><th>Utilization</th></tr>
          ${zoneData.map(z => {
            const utilPct = z.capacity > 0 ? Math.min(Math.round((z.checkins / z.capacity) * 100), 100) : 0;
            const utilColor = utilPct >= 70 ? '#10b981' : utilPct >= 40 ? '#f59e0b' : '#ef4444';
            return `<tr>
              <td><strong>${esc(z.name)}</strong></td>
              <td><span class="badge badge-blue">${esc(z.zone_type)}</span></td>
              <td>${esc(z.floor)}</td>
              <td>${z.capacity}</td>
              <td>${z.checkins}</td>
              <td>${z.avg_engagement} / 10</td>
              <td>
                <div class="progress-bar" style="width:100px"><div class="progress-fill" style="width:${utilPct}%;background:${utilColor}"></div></div>
                <span class="text-xs text-muted">${utilPct}%</span>
              </td>
            </tr>`;
          }).join('')}
        </table>
      </div>
    `));
  }));

  // Zones CRUD — List
  app.get('/school/student-heatmap/zones', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [zones] = await pool.query(`SELECT * FROM heatmap_zones WHERE tenant_id = $1 ORDER BY name`, [tid]);
    res.send(renderPage(req, 'Heatmap Zones', `
      ${SKIP}
      <div class="breadcrumb" style="margin-bottom:16px"><a href="/school" style="color:${P}">School</a> &rsaquo; <a href="/school/student-heatmap" style="color:${P}">Student Heatmap</a> &rsaquo; Zones</div>
      <nav class="tabs">
        <a href="/school/student-heatmap">Dashboard</a>
        <a href="/school/student-heatmap/zones" class="active">Zones</a>
        <a href="/school/student-heatmap/alerts">Alerts</a>
        <a href="/school/student-heatmap/behavioral">Behavioral</a>
        <a href="/school/student-heatmap/utilization">Utilization</a>
        <a href="/school/student-heatmap/comparative">Comparative</a>
        <a href="/school/student-heatmap/settings">Settings</a>
      </nav>
      <div class="card">
        <div class="flex" style="justify-content:space-between;margin-bottom:16px">
          <h3 style="margin:0;font-size:16px">Campus Zones (${zones.length})</h3>
          <a href="/school/student-heatmap/zones/new" class="btn btn-sm">+ Add Zone</a>
        </div>
        ${zones.length ? `<table>
          <tr><th>Name</th><th>Type</th><th>Floor</th><th>Capacity</th><th>Status</th><th>Actions</th></tr>
          ${zones.map(z => `<tr>
            <td><strong>${esc(z.name)}</strong></td>
            <td><span class="badge badge-blue">${esc(z.zone_type)}</span></td>
            <td>${esc(z.floor)}</td>
            <td>${z.capacity}</td>
            <td>${z.active ? '<span class="badge badge-green">Active</span>' : '<span class="badge badge-red">Inactive</span>'}</td>
            <td>
              <a href="/school/student-heatmap/zones/edit/${z.id}" class="btn btn-sm">Edit</a>
              <form method="POST" action="/school/student-heatmap/zones/delete/${z.id}" style="display:inline" onsubmit="return confirm('Delete zone?')">
                <button class="btn btn-sm btn-danger">Delete</button>
              </form>
            </td>
          </tr>`).join('')}
        </table>` : '<p class="text-muted">No zones configured. Add zones to start tracking student activity.</p>'}
      </div>
    `));
  }));

  // Zones — New
  app.get('/school/student-heatmap/zones/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    res.send(renderPage(req, 'Add Zone', `
      ${SKIP}
      <div class="breadcrumb" style="margin-bottom:16px"><a href="/school" style="color:${P}">School</a> &rsaquo; <a href="/school/student-heatmap" style="color:${P}">Student Heatmap</a> &rsaquo; <a href="/school/student-heatmap/zones" style="color:${P}">Zones</a> &rsaquo; New</div>
      <div class="card" style="max-width:560px">
        <h3 style="margin:0 0 16px;font-size:16px">Add Campus Zone</h3>
        <form method="POST" action="/school/student-heatmap/zones/new">
          <div class="mb-1"><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Zone Name</label>
            <input name="name" required placeholder="e.g., Science Lab A"></div>
          <div class="mb-1"><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Zone Type</label>
            <select name="zone_type">${ZONE_TYPES.map(t => `<option value="${t}">${t}</option>`).join('')}</select></div>
          <div class="grid grid-2 mb-1">
            <div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Floor</label>
              <input name="floor" value="1" placeholder="e.g., 1, B1, 2A"></div>
            <div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Capacity</label>
              <input name="capacity" type="number" value="30" min="1"></div>
          </div>
          <div class="mb-1"><label style="display:flex;align-items:center;gap:6px;font-size:14px;cursor:pointer">
            <input type="checkbox" name="active" checked> Active</label></div>
          <button class="btn mt-1" type="submit">Create Zone</button>
        </form>
      </div>
    `));
  }));

  // Zones — New POST
  app.post('/school/student-heatmap/zones/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { name, zone_type, floor, capacity, active } = req.body;
    await pool.query(
      `INSERT INTO heatmap_zones (tenant_id, name, zone_type, capacity, floor, active) VALUES ($1,$2,$3,$4,$5,$6)`,
      [tid, name, zone_type || 'classroom', parseInt(capacity) || 30, floor || '1', active === 'on']
    );
    audit(req, 'heatmap_zone_create', { name, zone_type });
    res.redirect('/school/student-heatmap/zones');
  }));

  // Zones — Edit
  app.get('/school/student-heatmap/zones/edit/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [zones] = await pool.query(`SELECT * FROM heatmap_zones WHERE id = $1 AND tenant_id = $2`, [req.params.id, tid]);
    if (!zones.length) return res.status(404).send('Zone not found');
    const z = zones[0];
    res.send(renderPage(req, 'Edit Zone', `
      ${SKIP}
      <div class="breadcrumb" style="margin-bottom:16px"><a href="/school" style="color:${P}">School</a> &rsaquo; <a href="/school/student-heatmap" style="color:${P}">Student Heatmap</a> &rsaquo; <a href="/school/student-heatmap/zones" style="color:${P}">Zones</a> &rsaquo; Edit</div>
      <div class="card" style="max-width:560px">
        <h3 style="margin:0 0 16px;font-size:16px">Edit Zone: ${esc(z.name)}</h3>
        <form method="POST" action="/school/student-heatmap/zones/edit/${z.id}">
          <div class="mb-1"><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Zone Name</label>
            <input name="name" value="${esc(z.name)}" required></div>
          <div class="mb-1"><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Zone Type</label>
            <select name="zone_type">${ZONE_TYPES.map(t => `<option value="${t}" ${t === z.zone_type ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
          <div class="grid grid-2 mb-1">
            <div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Floor</label>
              <input name="floor" value="${esc(z.floor)}"></div>
            <div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Capacity</label>
              <input name="capacity" type="number" value="${z.capacity}" min="1"></div>
          </div>
          <div class="mb-1"><label style="display:flex;align-items:center;gap:6px;font-size:14px;cursor:pointer">
            <input type="checkbox" name="active" ${z.active ? 'checked' : ''}> Active</label></div>
          <button class="btn mt-1" type="submit">Save Changes</button>
        </form>
      </div>
    `));
  }));

  // Zones — Edit POST
  app.post('/school/student-heatmap/zones/edit/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { name, zone_type, floor, capacity, active } = req.body;
    await pool.query(
      `UPDATE heatmap_zones SET name=$1, zone_type=$2, capacity=$3, floor=$4, active=$5 WHERE id=$6 AND tenant_id=$7`,
      [name, zone_type, parseInt(capacity) || 30, floor || '1', active === 'on', req.params.id, tid]
    );
    audit(req, 'heatmap_zone_update', { id: req.params.id, name });
    res.redirect('/school/student-heatmap/zones');
  }));

  // Zones — Delete POST
  app.post('/school/student-heatmap/zones/delete/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query(`DELETE FROM heatmap_zones WHERE id = $1 AND tenant_id = $2`, [req.params.id, tid]);
    audit(req, 'heatmap_zone_delete', { id: req.params.id });
    res.redirect('/school/student-heatmap/zones');
  }));

  // Student Detail — individual heatmap & movement patterns
  app.get('/school/student-heatmap/student-detail/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const studentId = req.params.id;
    const [student] = await pool.query(`SELECT id, name, email, class FROM users WHERE id = $1 AND tenant_id = $2`, [studentId, tid]);
    if (!student.length) return res.status(404).send('Student not found');
    const s = student[0];
    // Engagement over last 14 days
    const [engData] = await pool.query(`
      SELECT DATE(check_in) as day, ROUND(AVG(engagement_score)::numeric, 2) as avg_eng, COUNT(*) as cnt
      FROM student_heatmap_data
      WHERE tenant_id = $1 AND student_id = $2 AND check_in >= CURRENT_DATE - INTERVAL '14 days'
      GROUP BY DATE(check_in) ORDER BY day`, [tid, studentId]);
    const engTrend = engData.map(d => ({ label: d.day, value: d.avg_eng || 0 }));
    // Zone frequency
    const [zoneFreq] = await pool.query(`
      SELECT zone, COUNT(*) as cnt, ROUND(AVG(engagement_score)::numeric, 2) as avg_eng
      FROM student_heatmap_data
      WHERE tenant_id = $1 AND student_id = $2 AND check_in >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY zone ORDER BY cnt DESC LIMIT 10`, [tid, studentId]);
    const maxZoneCnt = Math.max(...zoneFreq.map(z => z.cnt), 1);
    // Movement pattern — check-in sequence
    const [movements] = await pool.query(`
      SELECT zone, check_in, check_out, activity_type, engagement_score
      FROM student_heatmap_data
      WHERE tenant_id = $1 AND student_id = $2 AND check_in >= CURRENT_DATE - INTERVAL '7 days'
      ORDER BY check_in DESC LIMIT 30`, [tid, studentId]);
    // Risk assessment
    const [riskData] = await pool.query(`
      SELECT ROUND(AVG(engagement_score)::numeric, 2) as avg_eng,
        COUNT(DISTINCT DATE(check_in)) as active_days,
        COUNT(DISTINCT zone) as zones_visited,
        COUNT(*) as total_checkins
      FROM student_heatmap_data
      WHERE tenant_id = $1 AND student_id = $2 AND check_in >= CURRENT_DATE - INTERVAL '14 days'`, [tid, studentId]);
    const rd = riskData[0] || {};
    let riskLevel = 'low';
    if ((rd.avg_eng || 10) < 3.5 || rd.active_days < 5) riskLevel = 'high';
    else if ((rd.avg_eng || 10) < 5.5 || rd.active_days < 8) riskLevel = 'medium';
    // Student alerts
    const [studentAlerts] = await pool.query(`
      SELECT * FROM heatmap_alerts
      WHERE tenant_id = $1 AND student_id = $2 ORDER BY created_at DESC LIMIT 20`, [tid, studentId]);
    // Hourly pattern
    const [hourly] = await pool.query(`
      SELECT EXTRACT(HOUR FROM check_in)::int as hr, COUNT(*) as cnt
      FROM student_heatmap_data
      WHERE tenant_id = $1 AND student_id = $2 AND check_in >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY hr ORDER BY hr`, [tid, studentId]);
    const hourLabels2 = [];
    for (let h = 0; h < 24; h++) hourLabels2.push({ label: `${h}:00`, value: 0 });
    hourly.forEach(ph => { if (hourLabels2[ph.hr]) hourLabels2[ph.hr].value = ph.cnt; });
    const hourBars = hourLabels2.filter(h => parseInt(h.label) >= 6 && parseInt(h.label) <= 21);

    res.send(renderPage(req, `Student: ${s.name}`, `
      ${SKIP}
      <div class="breadcrumb" style="margin-bottom:16px"><a href="/school" style="color:${P}">School</a> &rsaquo; <a href="/school/student-heatmap" style="color:${P}">Student Heatmap</a> &rsaquo; ${esc(s.name)}</div>
      <div class="card" style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
        <div style="font-size:24px;font-weight:700">${esc(s.name)}</div>
        <div class="text-muted">${esc(s.email || '')}</div>
        ${s.class ? `<span class="badge badge-blue">${esc(s.class)}</span>` : ''}
        ${riskBadge(riskLevel)}
      </div>
      <div class="grid grid-4 mb-2">
        <div class="stat-card"><div class="label">Avg Engagement (14d)</div><div class="value">${rd.avg_eng || 0}</div></div>
        <div class="stat-card"><div class="label">Active Days (14d)</div><div class="value">${rd.active_days || 0}</div></div>
        <div class="stat-card"><div class="label">Zones Visited (30d)</div><div class="value">${rd.zones_visited || 0}</div></div>
        <div class="stat-card"><div class="label">Total Check-ins</div><div class="value">${rd.total_checkins || 0}</div></div>
      </div>
      <div class="grid grid-2 mb-2">
        <div class="card">
          <h3 style="margin:0 0 12px;font-size:16px">Engagement Trend (14 Days)</h3>
          ${svgMiniLine(engTrend, 480, 150, '#4f46e5')}
        </div>
        <div class="card">
          <h3 style="margin:0 0 12px;font-size:16px">Hourly Activity Pattern</h3>
          ${svgBarChart(hourBars, 480, 150, '#8b5cf6')}
        </div>
      </div>
      <div class="grid grid-2 mb-2">
        <div class="card">
          <h3 style="margin:0 0 12px;font-size:16px">Zone Frequency (30 Days)</h3>
          ${svgBarChart(zoneFreq.map(z => ({ label: z.zone, value: z.cnt })), 480, 180, '#10b981')}
          <table style="margin-top:12px">
            <tr><th>Zone</th><th>Visits</th><th>Avg Eng</th></tr>
            ${zoneFreq.map(z => `<tr><td>${esc(z.zone || '-')}</td><td>${z.cnt}</td><td>${z.avg_eng} ${engagementBadge(z.avg_eng)}</td></tr>`).join('')}
          </table>
        </div>
        <div class="card">
          <h3 style="margin:0 0 12px;font-size:16px">Recent Movements (7 Days)</h3>
          ${movements.length ? `<table>
            <tr><th>Zone</th><th>Check-in</th><th>Check-out</th><th>Type</th><th>Eng</th></tr>
            ${movements.map(m => `<tr>
              <td>${esc(m.zone || '-')}</td>
              <td class="text-sm">${m.check_in ? new Date(m.check_in).toLocaleString() : '-'}</td>
              <td class="text-sm">${m.check_out ? new Date(m.check_out).toLocaleTimeString() : '<em class="text-muted">active</em>'}</td>
              <td><span class="badge badge-blue">${esc(m.activity_type)}</span></td>
              <td>${engagementBadge(m.engagement_score)}</td>
            </tr>`).join('')}
          </table>` : '<p class="text-muted">No movement data.</p>'}
        </div>
      </div>
      ${studentAlerts.length ? `<div class="card">
        <h3 style="margin:0 0 12px;font-size:16px">Student Alerts (${studentAlerts.length})</h3>
        <table>
          <tr><th>Type</th><th>Message</th><th>Date</th><th>Status</th><th>Action</th></tr>
          ${studentAlerts.map(a => `<tr>
            <td><span class="badge badge-yellow">${esc(a.alert_type)}</span></td>
            <td>${esc(a.message || '-')}</td>
            <td class="text-sm">${a.created_at ? new Date(a.created_at).toLocaleString() : '-'}</td>
            <td>${a.resolved ? '<span class="badge badge-green">Resolved</span>' : '<span class="badge badge-red">Open</span>'}</td>
            <td>${!a.resolved ? `<form method="POST" action="/school/student-heatmap/alerts/resolve/${a.id}" style="display:inline">
              <button class="btn btn-sm btn-success">Resolve</button></form>` : ''}</td>
          </tr>`).join('')}
        </table>
      </div>` : ''}
    `));
  }));

  // Alerts — List
  app.get('/school/student-heatmap/alerts', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const filter = req.query.filter || 'open';
    const where = filter === 'resolved' ? 'AND resolved = true' : filter === 'all' ? '' : 'AND resolved = false';
    const [alerts] = await pool.query(`
      SELECT ha.*, u.name as student_name
      FROM heatmap_alerts ha
      LEFT JOIN users u ON u.id = ha.student_id
      WHERE ha.tenant_id = $1 ${where}
      ORDER BY ha.created_at DESC LIMIT 100`, [tid]);
    const [alertCounts] = await pool.query(`
      SELECT alert_type, COUNT(*) as cnt FROM heatmap_alerts
      WHERE tenant_id = $1 AND resolved = false GROUP BY alert_type ORDER BY cnt DESC`, [tid]);
    res.send(renderPage(req, 'Heatmap Alerts', `
      ${SKIP}
      <div class="breadcrumb" style="margin-bottom:16px"><a href="/school" style="color:${P}">School</a> &rsaquo; <a href="/school/student-heatmap" style="color:${P}">Student Heatmap</a> &rsaquo; Alerts</div>
      <nav class="tabs">
        <a href="/school/student-heatmap">Dashboard</a>
        <a href="/school/student-heatmap/zones">Zones</a>
        <a href="/school/student-heatmap/alerts" class="active">Alerts</a>
        <a href="/school/student-heatmap/behavioral">Behavioral</a>
        <a href="/school/student-heatmap/utilization">Utilization</a>
        <a href="/school/student-heatmap/comparative">Comparative</a>
        <a href="/school/student-heatmap/settings">Settings</a>
      </nav>
      <div class="flex mb-2" style="gap:8px">
        <a href="?filter=open" class="btn btn-sm ${filter === 'open' ? '' : 'btn-warning'}">Open</a>
        <a href="?filter=resolved" class="btn btn-sm ${filter === 'resolved' ? '' : 'btn-warning'}">Resolved</a>
        <a href="?filter=all" class="btn btn-sm ${filter === 'all' ? '' : 'btn-warning'}">All</a>
      </div>
      <div class="grid grid-2 mb-2">
        <div class="card">
          <h3 style="margin:0 0 12px;font-size:16px">Alert Breakdown</h3>
          ${alertCounts.length ? svgBarChart(alertCounts.map(a => ({ label: a.alert_type, value: a.cnt })), 400, 160, '#ef4444') : '<p class="text-muted">No alerts.</p>'}
        </div>
        <div class="card">
          <h3 style="margin:0 0 12px;font-size:16px">Alert Distribution</h3>
          <table>
            <tr><th>Alert Type</th><th>Count</th></tr>
            ${alertCounts.map(a => `<tr><td><span class="badge badge-yellow">${esc(a.alert_type)}</span></td><td><strong>${a.cnt}</strong></td></tr>`).join('')}
          </table>
        </div>
      </div>
      <div class="card">
        <h3 style="margin:0 0 12px;font-size:16px">Alerts (${alerts.length})</h3>
        ${alerts.length ? `<table>
          <tr><th>Student</th><th>Type</th><th>Message</th><th>Date</th><th>Status</th><th>Actions</th></tr>
          ${alerts.map(a => `<tr>
            <td><a href="/school/student-heatmap/student-detail/${a.student_id}">${esc(a.student_name || 'ID:' + a.student_id)}</a></td>
            <td><span class="badge badge-yellow">${esc(a.alert_type)}</span></td>
            <td>${esc(a.message || '-')}</td>
            <td class="text-sm">${a.created_at ? new Date(a.created_at).toLocaleString() : '-'}</td>
            <td>${a.resolved ? '<span class="badge badge-green">Resolved</span>' : '<span class="badge badge-red">Open</span>'}</td>
            <td>
              ${!a.resolved ? `<form method="POST" action="/school/student-heatmap/alerts/resolve/${a.id}" style="display:inline">
                <button class="btn btn-sm btn-success">Resolve</button></form>` : '-'}
            </td>
          </tr>`).join('')}
        </table>` : '<p class="text-muted">No alerts found.</p>'}
      </div>
    `));
  }));

  // Resolve Alert POST
  app.post('/school/student-heatmap/alerts/resolve/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query(`UPDATE heatmap_alerts SET resolved = true, resolved_at = NOW() WHERE id = $1 AND tenant_id = $2`, [req.params.id, tid]);
    audit(req, 'heatmap_alert_resolve', { id: req.params.id });
    const back = req.header('Referer') || '/school/student-heatmap/alerts';
    res.redirect(back);
  }));

  // Behavioral Pattern Analysis
  app.get('/school/student-heatmap/behavioral', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    // Students with behavioral patterns (high movement, low engagement)
    const [behavioral] = await pool.query(`
      SELECT hd.student_id, u.name, u.class,
        COUNT(DISTINCT hd.zone) as zones_visited,
        COUNT(*) as total_visits,
        ROUND(AVG(hd.engagement_score)::numeric, 2) as avg_engagement,
        COUNT(DISTINCT DATE(hd.check_in)) as active_days,
        MIN(hd.check_in) as first_seen,
        MAX(hd.check_in) as last_seen
      FROM student_heatmap_data hd
      JOIN users u ON u.id = hd.student_id
      WHERE hd.tenant_id = $1 AND hd.check_in >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY hd.student_id, u.name, u.class
      ORDER BY avg_engagement ASC LIMIT 50`, [tid]);
    // Movement intensity — students with most zone transitions
    const [movement] = await pool.query(`
      SELECT hd.student_id, u.name,
        COUNT(*) as transitions
      FROM student_heatmap_data hd
      JOIN users u ON u.id = hd.student_id
      WHERE hd.tenant_id = $1 AND hd.check_in >= CURRENT_DATE - INTERVAL '7 days'
      GROUP BY hd.student_id, u.name
      ORDER BY transitions DESC LIMIT 20`, [tid]);
    // Activity type distribution
    const [actTypes] = await pool.query(`
      SELECT activity_type, COUNT(*) as cnt
      FROM student_heatmap_data
      WHERE tenant_id = $1 AND check_in >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY activity_type ORDER BY cnt DESC`, [tid]);
    // High-risk identification
    const [highRisk] = await pool.query(`
      SELECT hd.student_id, u.name, u.class,
        ROUND(AVG(hd.engagement_score)::numeric, 2) as avg_eng
      FROM student_heatmap_data hd
      JOIN users u ON u.id = hd.student_id
      WHERE hd.tenant_id = $1 AND hd.check_in >= CURRENT_DATE - INTERVAL '14 days'
      GROUP BY hd.student_id, u.name, u.class
      HAVING AVG(hd.engagement_score) < 3.5
      ORDER BY avg_eng ASC`, [tid]);
    res.send(renderPage(req, 'Behavioral Pattern Analysis', `
      ${SKIP}
      <div class="breadcrumb" style="margin-bottom:16px"><a href="/school" style="color:${P}">School</a> &rsaquo; <a href="/school/student-heatmap" style="color:${P}">Student Heatmap</a> &rsaquo; Behavioral</div>
      <nav class="tabs">
        <a href="/school/student-heatmap">Dashboard</a>
        <a href="/school/student-heatmap/zones">Zones</a>
        <a href="/school/student-heatmap/alerts">Alerts</a>
        <a href="/school/student-heatmap/behavioral" class="active">Behavioral</a>
        <a href="/school/student-heatmap/utilization">Utilization</a>
        <a href="/school/student-heatmap/comparative">Comparative</a>
        <a href="/school/student-heatmap/settings">Settings</a>
      </nav>
      <div class="grid grid-2 mb-2">
        <div class="card">
          <h3 style="margin:0 0 12px;font-size:16px">Activity Type Distribution</h3>
          ${svgBarChart(actTypes.map(a => ({ label: a.activity_type, value: a.cnt })), 460, 180, '#8b5cf6')}
        </div>
        <div class="card">
          <h3 style="margin:0 0 12px;font-size:16px">High Movement Students (7d)</h3>
          ${svgBarChart(movement.slice(0, 10).map(m => ({ label: m.name, value: m.transitions })), 460, 180, '#f59e0b')}
        </div>
      </div>
      ${highRisk.length ? `<div class="card mb-2" style="border-left:4px solid #ef4444">
        <h3 style="margin:0 0 12px;font-size:16px;color:#ef4444">High-Risk Students (Engagement &lt; 3.5)</h3>
        <table>
          <tr><th>Student</th><th>Class</th><th>Avg Engagement</th><th>Action</th></tr>
          ${highRisk.map(r => `<tr>
            <td><a href="/school/student-heatmap/student-detail/${r.student_id}">${esc(r.name)}</a></td>
            <td>${esc(r.class || '-')}</td>
            <td><span class="badge badge-red">${r.avg_eng}</span></td>
            <td>
              <form method="POST" action="/school/student-heatmap/alerts/create" style="display:inline">
                <input type="hidden" name="student_id" value="${r.student_id}">
                <input type="hidden" name="alert_type" value="low_engagement">
                <input type="hidden" name="message" value="Low engagement detected: ${r.avg_eng}/10 avg">
                <button class="btn btn-sm btn-warning">Create Alert</button>
              </form>
            </td>
          </tr>`).join('')}
        </table>
      </div>` : ''}
      <div class="card">
        <h3 style="margin:0 0 12px;font-size:16px">Behavioral Overview — All Tracked Students (30d)</h3>
        <table>
          <tr><th>Student</th><th>Class</th><th>Zones Visited</th><th>Visits</th><th>Avg Eng</th><th>Active Days</th><th>Risk</th></tr>
          ${behavioral.map(b => {
            let risk = 'low';
            if (b.avg_engagement < 3.5 || b.active_days < 5) risk = 'high';
            else if (b.avg_engagement < 5.5 || b.active_days < 8) risk = 'medium';
            return `<tr>
              <td><a href="/school/student-heatmap/student-detail/${b.student_id}">${esc(b.name)}</a></td>
              <td>${esc(b.class || '-')}</td>
              <td>${b.zones_visited}</td>
              <td>${b.total_visits}</td>
              <td>${engagementBadge(b.avg_engagement)} ${b.avg_engagement}</td>
              <td>${b.active_days}/30</td>
              <td>${riskBadge(risk)}</td>
            </tr>`;
          }).join('')}
        </table>
      </div>
    `));
  }));

  // Create Alert POST
  app.post('/school/student-heatmap/alerts/create', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { student_id, alert_type, message } = req.body;
    await pool.query(
      `INSERT INTO heatmap_alerts (tenant_id, student_id, alert_type, message) VALUES ($1,$2,$3,$4)`,
      [tid, parseInt(student_id), alert_type || 'low_engagement', message || 'Manual alert']
    );
    audit(req, 'heatmap_alert_create', { student_id, alert_type });
    const back = req.header('Referer') || '/school/student-heatmap/alerts';
    res.redirect(back);
  }));

  // Classroom Utilization Heatmap
  app.get('/school/student-heatmap/utilization', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const period = req.query.period || '7';
    const daysBack = parseInt(period) || 7;
    // Hourly zone utilization grid
    const [hourlyZone] = await pool.query(`
      SELECT z.name as zone_name,
        EXTRACT(HOUR FROM hd.check_in)::int as hr,
        COUNT(DISTINCT hd.student_id) as unique_students,
        COUNT(*) as checkins
      FROM heatmap_zones z
      LEFT JOIN student_heatmap_data hd ON hd.zone = z.name AND hd.tenant_id = z.tenant_id
        AND hd.check_in >= CURRENT_DATE - INTERVAL '${daysBack} days'
      WHERE z.tenant_id = $1 AND z.active = true
      GROUP BY z.name, EXTRACT(HOUR FROM hd.check_in)
      ORDER BY z.name, hr`, [tid]);
    // Build heatmap grid: rows=zones, cols=hours (7-21)
    const [zones] = await pool.query(`SELECT name, zone_type, capacity FROM heatmap_zones WHERE tenant_id = $1 AND active = true ORDER BY name`, [tid]);
    const hours = [];
    for (let h = 7; h <= 21; h++) hours.push(h);
    const zoneMap = {};
    hourlyZone.forEach(hz => {
      const key = `${hz.zone_name}_${hz.hr}`;
      zoneMap[key] = hz.unique_students || 0;
    });
    let maxUtil = 1;
    zones.forEach(z => {
      hours.forEach(h => {
        const v = zoneMap[`${z.name}_${h}`] || 0;
        if (v > maxUtil) maxUtil = v;
      });
    });
    // SVG heatmap grid — rows=zones, cols=hours
    const cellW = 42, cellH = 32, labelW = 120, headerH = 30;
    const svgW = labelW + hours.length * cellW + 20;
    const svgH = headerH + zones.length * cellH + 40;
    let utilSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" style="font-family:system-ui,sans-serif">`;
    // Hour headers
    hours.forEach((h, i) => {
      utilSvg += `<text x="${labelW + i * cellW + cellW / 2}" y="${headerH - 8}" text-anchor="middle" font-size="10" fill="#6b7280">${h}:00</text>`;
    });
    // Zone rows
    zones.forEach((z, ri) => {
      const y = headerH + ri * cellH;
      utilSvg += `<text x="${labelW - 8}" y="${y + cellH / 2 + 4}" text-anchor="end" font-size="11" fill="#374151">${esc(z.name.substring(0, 14))}</text>`;
      hours.forEach((h, ci) => {
        const val = zoneMap[`${z.name}_${h}`] || 0;
        const color = heatColor(val, maxUtil);
        const x = labelW + ci * cellW;
        utilSvg += `<rect x="${x + 2}" y="${y + 2}" width="${cellW - 4}" height="${cellH - 4}" rx="4" fill="${color}" opacity="0.85">`;
        utilSvg += `<title>${esc(z.name)} ${h}:00 — ${val} students</title></rect>`;
        if (val > 0) {
          utilSvg += `<text x="${x + cellW / 2}" y="${y + cellH / 2 + 4}" text-anchor="middle" font-size="9" fill="#fff" font-weight="600">${val}</text>`;
        }
      });
    });
    // Legend
    const legY = headerH + zones.length * cellH + 10;
    utilSvg += `<rect x="${labelW}" y="${legY}" width="14" height="14" rx="3" fill="#ef4444"/><text x="${labelW + 20}" y="${legY + 12}" font-size="11" fill="#6b7280">Low</text>`;
    utilSvg += `<rect x="${labelW + 60}" y="${legY}" width="14" height="14" rx="3" fill="#f59e0b"/><text x="${labelW + 80}" y="${legY + 12}" font-size="11" fill="#6b7280">Moderate</text>`;
    utilSvg += `<rect x="${labelW + 150}" y="${legY}" width="14" height="14" rx="3" fill="#10b981"/><text x="${labelW + 170}" y="${legY + 12}" font-size="11" fill="#6b7280">High</text>`;
    utilSvg += '</svg>';
    // Peak times summary
    const [peakSummary] = await pool.query(`
      SELECT EXTRACT(HOUR FROM check_in)::int as hr, COUNT(*) as cnt
      FROM student_heatmap_data
      WHERE tenant_id = $1 AND check_in >= CURRENT_DATE - INTERVAL '${daysBack} days'
      GROUP BY hr ORDER BY cnt DESC LIMIT 5`, [tid]);
    // Floor utilization
    const [floorUtil] = await pool.query(`
      SELECT z.floor, COUNT(DISTINCT hd.student_id) as students,
        COUNT(*) as checkins
      FROM heatmap_zones z
      LEFT JOIN student_heatmap_data hd ON hd.zone = z.name AND hd.tenant_id = z.tenant_id
        AND hd.check_in >= CURRENT_DATE - INTERVAL '${daysBack} days'
      WHERE z.tenant_id = $1 AND z.active = true
      GROUP BY z.floor ORDER BY z.floor`, [tid]);

    res.send(renderPage(req, 'Classroom Utilization', `
      ${SKIP}
      <div class="breadcrumb" style="margin-bottom:16px"><a href="/school" style="color:${P}">School</a> &rsaquo; <a href="/school/student-heatmap" style="color:${P}">Student Heatmap</a> &rsaquo; Utilization</div>
      <nav class="tabs">
        <a href="/school/student-heatmap">Dashboard</a>
        <a href="/school/student-heatmap/zones">Zones</a>
        <a href="/school/student-heatmap/alerts">Alerts</a>
        <a href="/school/student-heatmap/behavioral">Behavioral</a>
        <a href="/school/student-heatmap/utilization" class="active">Utilization</a>
        <a href="/school/student-heatmap/comparative">Comparative</a>
        <a href="/school/student-heatmap/settings">Settings</a>
      </nav>
      <div class="card mb-2">
        <div class="flex" style="justify-content:space-between;align-items:center;margin-bottom:12px">
          <h3 style="margin:0;font-size:16px">Zone Utilization Heatmap — Hourly Grid</h3>
          <div class="flex" style="gap:4px">
            <a href="?period=7" class="btn btn-sm ${period === '7' ? '' : 'btn-warning'}">7d</a>
            <a href="?period=14" class="btn btn-sm ${period === '14' ? '' : 'btn-warning'}">14d</a>
            <a href="?period=30" class="btn btn-sm ${period === '30' ? '' : 'btn-warning'}">30d</a>
          </div>
        </div>
        <div style="overflow-x:auto">${utilSvg}</div>
      </div>
      <div class="grid grid-2 mb-2">
        <div class="card">
          <h3 style="margin:0 0 12px;font-size:16px">Peak Times</h3>
          <table>
            <tr><th>Hour</th><th>Check-ins</th><th>Intensity</th></tr>
            ${peakSummary.map((p, i) => {
              const pct = Math.round((p.cnt / peakSummary[0].cnt) * 100);
              return `<tr><td>${p.hr}:00</td><td>${p.cnt}</td>
                <td><div class="progress-bar" style="width:120px"><div class="progress-fill" style="width:${pct}%;background:${heatColor(pct, 100)}"></div></div></td></tr>`;
            }).join('')}
          </table>
        </div>
        <div class="card">
          <h3 style="margin:0 0 12px;font-size:16px">Floor Utilization</h3>
          ${floorUtil.length ? svgBarChart(floorUtil.map(f => ({ label: `Floor ${f.floor}`, value: f.students })), 400, 160, '#6366f1') : '<p class="text-muted">No floor data.</p>'}
          <table style="margin-top:8px">
            <tr><th>Floor</th><th>Students</th><th>Check-ins</th></tr>
            ${floorUtil.map(f => `<tr><td>Floor ${esc(f.floor)}</td><td>${f.students}</td><td>${f.checkins}</td></tr>`).join('')}
          </table>
        </div>
      </div>
    `));
  }));

  // Comparative Analytics — class vs class
  app.get('/school/student-heatmap/comparative', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    // Engagement by class
    const [classEng] = await pool.query(`
      SELECT u.class,
        COUNT(DISTINCT hd.student_id) as students,
        ROUND(AVG(hd.engagement_score)::numeric, 2) as avg_engagement,
        COUNT(*) as total_checkins,
        COUNT(DISTINCT hd.zone) as zones_covered
      FROM student_heatmap_data hd
      JOIN users u ON u.id = hd.student_id AND u.tenant_id = $1
      WHERE hd.tenant_id = $1 AND hd.check_in >= CURRENT_DATE - INTERVAL '30 days'
        AND u.class IS NOT NULL AND u.class != ''
      GROUP BY u.class ORDER BY avg_engagement DESC`, [tid]);
    // Attendance by day heatmap per class
    const [classDow] = await pool.query(`
      SELECT u.class, EXTRACT(DOW FROM hd.check_in)::int as dow,
        COUNT(DISTINCT hd.student_id) as students
      FROM student_heatmap_data hd
      JOIN users u ON u.id = hd.student_id AND u.tenant_id = $1
      WHERE hd.tenant_id = $1 AND hd.check_in >= CURRENT_DATE - INTERVAL '30 days'
        AND u.class IS NOT NULL AND u.class != ''
      GROUP BY u.class, dow ORDER BY u.class, dow`, [tid]);
    const dowNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    // Build comparative grid
    const classNames = [...new Set(classEng.map(c => c.class))];
    let maxClassEng = 1;
    classEng.forEach(c => { if (c.students > maxClassEng) maxClassEng = c.students; });
    // Movement patterns by class
    const [classMovement] = await pool.query(`
      SELECT u.class,
        ROUND(AVG(zone_count)::numeric, 1) as avg_zones_per_student,
        MAX(zone_count) as max_zones
      FROM (
        SELECT hd.student_id, COUNT(DISTINCT hd.zone) as zone_count
        FROM student_heatmap_data hd
        JOIN users u ON u.id = hd.student_id AND u.tenant_id = $1
        WHERE hd.tenant_id = $1 AND hd.check_in >= CURRENT_DATE - INTERVAL '7 days'
          AND u.class IS NOT NULL AND u.class != ''
        GROUP BY hd.student_id
      ) sub
      JOIN users u ON u.id = sub.student_id
      WHERE u.tenant_id = $1
      GROUP BY u.class ORDER BY avg_zones_per_student DESC`, [tid]);

    res.send(renderPage(req, 'Comparative Analytics', `
      ${SKIP}
      <div class="breadcrumb" style="margin-bottom:16px"><a href="/school" style="color:${P}">School</a> &rsaquo; <a href="/school/student-heatmap" style="color:${P}">Student Heatmap</a> &rsaquo; Comparative</div>
      <nav class="tabs">
        <a href="/school/student-heatmap">Dashboard</a>
        <a href="/school/student-heatmap/zones">Zones</a>
        <a href="/school/student-heatmap/alerts">Alerts</a>
        <a href="/school/student-heatmap/behavioral">Behavioral</a>
        <a href="/school/student-heatmap/utilization">Utilization</a>
        <a href="/school/student-heatmap/comparative" class="active">Comparative</a>
        <a href="/school/student-heatmap/settings">Settings</a>
      </nav>
      <div class="card mb-2">
        <h3 style="margin:0 0 12px;font-size:16px">Class Engagement Comparison (30 Days)</h3>
        ${svgBarChart(classEng.map(c => ({ label: c.class, value: c.avg_engagement })), 500, 200, '#4f46e5')}
      </div>
      <div class="grid grid-2 mb-2">
        <div class="card">
          <h3 style="margin:0 0 12px;font-size:16px">Class Activity Summary</h3>
          <table>
            <tr><th>Class</th><th>Students</th><th>Avg Eng</th><th>Check-ins</th><th>Zones</th></tr>
            ${classEng.map(c => `<tr>
              <td><strong>${esc(c.class)}</strong></td>
              <td>${c.students}</td>
              <td>${engagementBadge(c.avg_engagement)} ${c.avg_engagement}</td>
              <td>${c.total_checkins}</td>
              <td>${c.zones_covered}</td>
            </tr>`).join('')}
          </table>
        </div>
        <div class="card">
          <h3 style="margin:0 0 12px;font-size:16px">Movement by Class (7d avg zones/student)</h3>
          ${classMovement.length ? svgBarChart(classMovement.map(c => ({ label: c.class, value: c.avg_zones_per_student })), 440, 180, '#f59e0b') : '<p class="text-muted">No data.</p>'}
          <table style="margin-top:8px">
            <tr><th>Class</th><th>Avg Zones</th><th>Max Zones</th></tr>
            ${classMovement.map(c => `<tr><td>${esc(c.class)}</td><td>${c.avg_zones_per_student}</td><td>${c.max_zones}</td></tr>`).join('')}
          </table>
        </div>
      </div>
      <div class="card">
        <h3 style="margin:0 0 12px;font-size:16px">Attendance Heatmap by Day — Class Comparison</h3>
        <div style="overflow-x:auto">
          <table>
            <tr><th>Class</th>${dowNames.map(d => `<th>${d}</th>`).join('')}</tr>
            ${classNames.map(cls => {
              const classData = classDow.filter(d => d.class === cls);
              let maxDowVal = 1;
              classData.forEach(d => { if (d.students > maxDowVal) maxDowVal = d.students; });
              return `<tr><td><strong>${esc(cls)}</strong></td>${dowNames.map((_, i) => {
                const found = classData.find(d => d.dow === i);
                const val = found ? found.students : 0;
                const bg = val > 0 ? heatColor(val, maxDowVal) : '#f3f4f6';
                const fg = val > 0 ? '#fff' : '#9ca3af';
                return `<td style="background:${bg};color:${fg};text-align:center;font-weight:600;border-radius:4px">${val || '-'}</td>`;
              }).join('')}</tr>`;
            }).join('')}
          </table>
        </div>
      </div>
    `));
  }));

  // Settings — threshold configuration & manual data entry
  app.get('/school/student-heatmap/settings', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [zones] = await pool.query(`SELECT id, name FROM heatmap_zones WHERE tenant_id = $1 AND active = true ORDER BY name`, [tid]);
    // Recent data entries
    const [recent] = await pool.query(`
      SELECT hd.*, u.name as student_name
      FROM student_heatmap_data hd
      LEFT JOIN users u ON u.id = hd.student_id
      WHERE hd.tenant_id = $1
      ORDER BY hd.created_at DESC LIMIT 20`, [tid]);
    res.send(renderPage(req, 'Heatmap Settings', `
      ${SKIP}
      <div class="breadcrumb" style="margin-bottom:16px"><a href="/school" style="color:${P}">School</a> &rsaquo; <a href="/school/student-heatmap" style="color:${P}">Student Heatmap</a> &rsaquo; Settings</div>
      <nav class="tabs">
        <a href="/school/student-heatmap">Dashboard</a>
        <a href="/school/student-heatmap/zones">Zones</a>
        <a href="/school/student-heatmap/alerts">Alerts</a>
        <a href="/school/student-heatmap/behavioral">Behavioral</a>
        <a href="/school/student-heatmap/utilization">Utilization</a>
        <a href="/school/student-heatmap/comparative">Comparative</a>
        <a href="/school/student-heatmap/settings" class="active">Settings</a>
      </nav>
      <div class="grid grid-2">
        <div class="card">
          <h3 style="margin:0 0 16px;font-size:16px">Manual Check-in</h3>
          <form method="POST" action="/school/student-heatmap/settings/checkin">
            <div class="mb-1"><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Student ID</label>
              <input name="student_id" type="number" required placeholder="Enter student user ID"></div>
            <div class="mb-1"><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Zone</label>
              <select name="zone" required>
                <option value="">Select zone...</option>
                ${zones.map(z => `<option value="${esc(z.name)}">${esc(z.name)}</option>`).join('')}
              </select></div>
            <div class="mb-1"><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Activity Type</label>
              <select name="activity_type">${ACTIVITY_TYPES.map(t => `<option value="${t}">${t}</option>`).join('')}</select></div>
            <div class="mb-1"><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Engagement Score (0-10)</label>
              <input name="engagement_score" type="number" min="0" max="10" step="0.1" value="5"></div>
            <div class="mb-1"><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Check-in Time</label>
              <input name="check_in" type="datetime-local"></div>
            <button class="btn mt-1" type="submit">Record Check-in</button>
          </form>
        </div>
        <div class="card">
          <h3 style="margin:0 0 16px;font-size:16px">Generate Alerts</h3>
          <p class="text-sm text-muted mb-2">Automatically scan for students with low engagement or unusual patterns and create alerts.</p>
          <form method="POST" action="/school/student-heatmap/settings/generate-alerts">
            <div class="mb-1"><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Engagement Threshold</label>
              <input name="threshold" type="number" min="0" max="10" step="0.5" value="3.5"></div>
            <div class="mb-1"><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Lookback Period (days)</label>
              <input name="days" type="number" min="1" max="90" value="14"></div>
            <button class="btn btn-warning mt-1" type="submit">Generate Risk Alerts</button>
          </form>
          <hr style="margin:20px 0;border:none;border-top:1px solid #e5e7eb">
          <h3 style="margin:0 0 12px;font-size:16px">Data Management</h3>
          <div class="flex" style="gap:8px;flex-wrap:wrap">
            <a href="/school/student-heatmap/export" class="btn btn-sm">Export CSV</a>
            <form method="POST" action="/school/student-heatmap/settings/prune" style="display:inline" onsubmit="return confirm('Delete data older than 90 days?')">
              <button class="btn btn-sm btn-danger">Prune Old Data</button>
            </form>
          </div>
        </div>
      </div>
      <div class="card mt-2">
        <h3 style="margin:0 0 12px;font-size:16px">Recent Data Entries</h3>
        ${recent.length ? `<table>
          <tr><th>Student</th><th>Zone</th><th>Type</th><th>Engagement</th><th>Check-in</th><th>Created</th></tr>
          ${recent.map(r => `<tr>
            <td><a href="/school/student-heatmap/student-detail/${r.student_id}">${esc(r.student_name || 'ID:' + r.student_id)}</a></td>
            <td>${esc(r.zone || '-')}</td>
            <td><span class="badge badge-blue">${esc(r.activity_type)}</span></td>
            <td>${engagementBadge(r.engagement_score)}</td>
            <td class="text-sm">${r.check_in ? new Date(r.check_in).toLocaleString() : '-'}</td>
            <td class="text-sm">${r.created_at ? new Date(r.created_at).toLocaleString() : '-'}</td>
          </tr>`).join('')}
        </table>` : '<p class="text-muted">No data entries yet.</p>'}
      </div>
    `));
  }));

  // Manual Check-in POST
  app.post('/school/student-heatmap/settings/checkin', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { student_id, zone, activity_type, engagement_score, check_in } = req.body;
    await pool.query(
      `INSERT INTO student_heatmap_data (tenant_id, student_id, zone, activity_type, engagement_score, check_in)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [tid, parseInt(student_id), zone, activity_type || 'general', parseFloat(engagement_score) || 5, check_in || null]
    );
    audit(req, 'heatmap_manual_checkin', { student_id, zone, activity_type });
    req.flash('success', 'Check-in recorded successfully');
    res.redirect('/school/student-heatmap/settings');
  }));

  // Generate Alerts POST
  app.post('/school/student-heatmap/settings/generate-alerts', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const threshold = parseFloat(req.body.threshold) || 3.5;
    const days = parseInt(req.body.days) || 14;
    const [atRisk] = await pool.query(`
      SELECT student_id, ROUND(AVG(engagement_score)::numeric, 2) as avg_eng
      FROM student_heatmap_data
      WHERE tenant_id = $1 AND check_in >= CURRENT_DATE - INTERVAL '${days} days'
      GROUP BY student_id HAVING AVG(engagement_score) < $2`, [tid, threshold]);
    let created = 0;
    for (const r of atRisk) {
      await pool.query(
        `INSERT INTO heatmap_alerts (tenant_id, student_id, alert_type, message) VALUES ($1,$2,'low_engagement',$3)
         ON CONFLICT DO NOTHING`,
        [tid, r.student_id, `Avg engagement ${r.avg_eng}/10 over ${days} days (threshold: ${threshold})`]
      );
      created++;
    }
    audit(req, 'heatmap_generate_alerts', { threshold, days, created });
    req.flash('success', `Generated ${created} risk alerts`);
    res.redirect('/school/student-heatmap/alerts');
  }));

  // Prune Data POST
  app.post('/school/student-heatmap/settings/prune', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [result] = await pool.query(
      `DELETE FROM student_heatmap_data WHERE tenant_id = $1 AND check_in < CURRENT_DATE - INTERVAL '90 days'`,
      [tid]
    );
    audit(req, 'heatmap_prune', { deleted: result.rowCount });
    req.flash('success', `Pruned ${result.rowCount} old records`);
    res.redirect('/school/student-heatmap/settings');
  }));

  // Export CSV
  app.get('/school/student-heatmap/export', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [data] = await pool.query(`
      SELECT hd.id, hd.student_id, u.name as student_name, u.class,
        hd.zone, hd.check_in, hd.check_out, hd.activity_type, hd.engagement_score, hd.created_at
      FROM student_heatmap_data hd
      LEFT JOIN users u ON u.id = hd.student_id
      WHERE hd.tenant_id = $1
      ORDER BY hd.check_in DESC LIMIT 50000`, [tid]);
    const headers = ['id', 'student_id', 'student_name', 'class', 'zone', 'check_in', 'check_out', 'activity_type', 'engagement_score', 'created_at'];
    let csv = headers.join(',') + '\n';
    data.forEach(row => {
      csv += headers.map(h => {
        const v = row[h] == null ? '' : String(row[h]);
        return '"' + v.replace(/"/g, '""') + '"';
      }).join(',') + '\n';
    });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=student_heatmap_export.csv');
    res.send(csv);
    audit(req, 'heatmap_export', { rows: data.length });
  }));

  // ─── AJAX API Routes ───

  // API: heatmap data for zones (JSON)
  app.get('/school/student-heatmap/api/data', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const days = parseInt(req.query.days) || 7;
    const [zoneData] = await pool.query(`
      SELECT z.name, z.zone_type, z.capacity, z.floor,
        COALESCE(h.cnt, 0) as checkins,
        COALESCE(h.unique_students, 0) as unique_students,
        COALESCE(h.avg_eng, 0) as avg_engagement
      FROM heatmap_zones z
      LEFT JOIN (
        SELECT zone, COUNT(*) as cnt, COUNT(DISTINCT student_id) as unique_students,
          ROUND(AVG(engagement_score)::numeric, 2) as avg_eng
        FROM student_heatmap_data
        WHERE tenant_id = $1 AND check_in >= CURRENT_DATE - INTERVAL '${days} days'
        GROUP BY zone
      ) h ON h.zone = z.name
      WHERE z.tenant_id = $1 AND z.active = true
      ORDER BY z.name`, [tid]);
    const maxCheckins = Math.max(...zoneData.map(z => z.checkins), 1);
    zoneData.forEach(z => {
      z.utilization = z.capacity > 0 ? Math.round((z.unique_students / z.capacity) * 100) : 0;
      z.color = heatColor(z.checkins, maxCheckins);
    });
    res.json({ success: true, data: zoneData, period_days: days });
  }));

  // API: student heatmap for a specific student
  app.get('/school/student-heatmap/api/student/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const days = parseInt(req.query.days) || 14;
    const [engagement] = await pool.query(`
      SELECT DATE(check_in) as date, ROUND(AVG(engagement_score)::numeric, 2) as avg_engagement,
        COUNT(*) as checkins, COUNT(DISTINCT zone) as zones
      FROM student_heatmap_data
      WHERE tenant_id = $1 AND student_id = $2 AND check_in >= CURRENT_DATE - INTERVAL '${days} days'
      GROUP BY DATE(check_in) ORDER BY date`, [tid, req.params.id]);
    const [zones] = await pool.query(`
      SELECT zone, COUNT(*) as cnt, ROUND(AVG(engagement_score)::numeric, 2) as avg_eng
      FROM student_heatmap_data
      WHERE tenant_id = $1 AND student_id = $2 AND check_in >= CURRENT_DATE - INTERVAL '${days} days'
      GROUP BY zone ORDER BY cnt DESC`, [tid, req.params.id]);
    const [summary] = await pool.query(`
      SELECT ROUND(AVG(engagement_score)::numeric, 2) as avg_engagement,
        COUNT(DISTINCT DATE(check_in)) as active_days,
        COUNT(DISTINCT zone) as total_zones,
        COUNT(*) as total_checkins
      FROM student_heatmap_data
      WHERE tenant_id = $1 AND student_id = $2 AND check_in >= CURRENT_DATE - INTERVAL '${days} days'`, [tid, req.params.id]);
    res.json({
      success: true,
      student_id: req.params.id,
      period_days: days,
      engagement_trend: engagement,
      zone_frequency: zones,
      summary: summary[0] || {}
    });
  }));

  // API: hourly heatmap data
  app.get('/school/student-heatmap/api/hourly', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const days = parseInt(req.query.days) || 7;
    const [hourly] = await pool.query(`
      SELECT EXTRACT(HOUR FROM check_in)::int as hour, COUNT(*) as checkins,
        COUNT(DISTINCT student_id) as unique_students
      FROM student_heatmap_data
      WHERE tenant_id = $1 AND check_in >= CURRENT_DATE - INTERVAL '${days} days'
      GROUP BY hour ORDER BY hour`, [tid]);
    const fullHours = [];
    for (let h = 0; h < 24; h++) {
      const found = hourly.find(x => x.hour === h);
      fullHours.push({ hour: h, checkins: found ? found.checkins : 0, unique_students: found ? found.unique_students : 0 });
    }
    res.json({ success: true, period_days: days, hourly: fullHours });
  }));

  // API: zone utilization matrix (for AJAX heatmap rendering)
  app.get('/school/student-heatmap/api/utilization-matrix', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const days = parseInt(req.query.days) || 7;
    const [zones] = await pool.query(`SELECT name FROM heatmap_zones WHERE tenant_id = $1 AND active = true ORDER BY name`, [tid]);
    const [matrix] = await pool.query(`
      SELECT hd.zone, EXTRACT(HOUR FROM hd.check_in)::int as hour,
        COUNT(DISTINCT hd.student_id) as students
      FROM student_heatmap_data hd
      WHERE hd.tenant_id = $1 AND hd.check_in >= CURRENT_DATE - INTERVAL '${days} days'
      GROUP BY hd.zone, EXTRACT(HOUR FROM hd.check_in)`, [tid]);
    const result = {};
    zones.forEach(z => { result[z.name] = {}; });
    matrix.forEach(m => {
      if (!result[m.zone]) result[m.zone] = {};
      result[m.zone][m.hour] = m.students;
    });
    res.json({ success: true, zones: zones.map(z => z.name), matrix: result, period_days: days });
  }));

  // API: risk students list
  app.get('/school/student-heatmap/api/risk-students', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const threshold = parseFloat(req.query.threshold) || 4;
    const days = parseInt(req.query.days) || 14;
    const [riskStudents] = await pool.query(`
      SELECT hd.student_id, u.name, u.class, u.email,
        ROUND(AVG(hd.engagement_score)::numeric, 2) as avg_engagement,
        COUNT(DISTINCT DATE(hd.check_in)) as active_days,
        COUNT(DISTINCT hd.zone) as zones_visited
      FROM student_heatmap_data hd
      JOIN users u ON u.id = hd.student_id AND u.tenant_id = $1
      WHERE hd.tenant_id = $1 AND hd.check_in >= CURRENT_DATE - INTERVAL '${days} days'
      GROUP BY hd.student_id, u.name, u.class, u.email
      HAVING AVG(hd.engagement_score) < $2
      ORDER BY avg_engagement ASC`, [tid, threshold]);
    riskStudents.forEach(s => {
      s.risk_level = s.avg_engagement < 3 ? 'high' : 'medium';
    });
    res.json({ success: true, threshold, period_days: days, students: riskStudents });
  }));

  // API: record check-in via AJAX (for IoT/integration)
  app.post('/school/student-heatmap/api/checkin', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { student_id, zone, activity_type, engagement_score } = req.body;
    if (!student_id || !zone) {
      return res.status(400).json({ success: false, error: 'student_id and zone are required' });
    }
    const [result] = await pool.query(
      `INSERT INTO student_heatmap_data (tenant_id, student_id, zone, activity_type, engagement_score)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [tid, parseInt(student_id), zone, activity_type || 'general', parseFloat(engagement_score) || 5]
    );
    audit(req, 'heatmap_api_checkin', { student_id, zone, activity_type });
    res.json({ success: true, id: result[0].id });
  }));

  // API: check-out via AJAX
  app.post('/school/student-heatmap/api/checkout', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { student_id, zone } = req.body;
    if (!student_id) {
      return res.status(400).json({ success: false, error: 'student_id is required' });
    }
    const [result] = await pool.query(
      `UPDATE student_heatmap_data SET check_out = NOW()
       WHERE tenant_id = $1 AND student_id = $2 AND check_out IS NULL
       ${zone ? 'AND zone = $3' : ''}
       ORDER BY check_in DESC LIMIT 1
       RETURNING id`,
      zone ? [tid, parseInt(student_id), zone] : [tid, parseInt(student_id)]
    );
    res.json({ success: true, updated: result.length > 0 });
  }));

  console.log('[StudentHeatmap] Module loaded — /school/student-heatmap/*');
};
