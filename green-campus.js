/**
 * Green Campus & Sustainability Module
 * School SaaS Portal - Environmental Management & Sustainability Tracking
 *
 * Features:
 *   1. Dashboard       - Overview with SVG charts, KPIs, carbon footprint summary
 *   2. Initiatives     - CRUD for green initiatives, categories, progress tracking
 *   3. Energy Tracking - Meter readings, consumption trends, cost analysis
 *   4. Waste Management - Waste recording, disposal methods, recycling rates
 *   5. Water Usage     - Water meter tracking, consumption patterns, conservation
 *   6. Challenges      - Green competitions, participation, leaderboards
 *   7. Tree Planting   - Tree tracker, species, location, survival rates
 *   8. Reports         - Monthly sustainability reports, PDF export
 *   9. Education       - Environmental education resources, lesson plans
 *  10. Certifications  - Green school certifications, audit tracking
 *  11. Eco Clubs       - Eco-club management, memberships, activities
 *  12. Carbon Calc     - Carbon footprint calculator with category breakdowns
 *
 * Routes prefix: /school/green-campus
 */

'use strict';

module.exports = function (app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#16a34a';
  const GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>'
    + '.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}'
    + '.btn{background:#16a34a;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}'
    + '.btn:hover{background:#15803d}'
    + '.btn-outline{background:transparent;color:#16a34a;border:1px solid #16a34a;padding:8px 16px;border-radius:8px;cursor:pointer}'
    + '.btn-outline:hover{background:#f0fdf4}'
    + '.btn-danger{background:#dc2626;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}'
    + '.btn-danger:hover{background:#b91c1c}'
    + 'table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}'
    + 'th{background:#f9fafb;font-weight:600}'
    + 'input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}'
    + '.kpi{display:inline-block;text-align:center;padding:16px 24px;margin:8px;background:#f0fdf4;border-radius:12px;min-width:140px}'
    + '.kpi .val{font-size:28px;font-weight:700;color:#16a34a}.kpi .lbl{font-size:12px;color:#6b7280;margin-top:4px}'
    + '.progress-bar{background:#e5e7eb;border-radius:8px;height:12px;overflow:hidden}'
    + '.progress-fill{height:100%;border-radius:8px;background:linear-gradient(90deg,#16a34a,#4ade80)}'
    + '.badge{display:inline-block;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600}'
    + '.badge-green{background:#dcfce7;color:#166534}.badge-yellow{background:#fef9c3;color:#854d0e}'
    + '.badge-red{background:#fee2e2;color:#991b1b}.badge-blue{background:#dbeafe;color:#1e40af}'
    + '.nav-tab{display:inline-block;padding:8px 16px;margin:0 4px;border-radius:8px 8px 0 0;cursor:pointer;text-decoration:none;color:#6b7280}'
    + '.nav-tab.active{background:#fff;color:#16a34a;font-weight:600;border:1px solid #e5e7eb;border-bottom:none}'
    + '.stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px}'
    + '.form-row{display:flex;gap:16px;margin-bottom:12px}.form-row>div{flex:1}'
    + '</style>'
    + '<div class="breadcrumb" style="margin-bottom:16px"><a href="/school" style="color:#16a34a">School</a> &rsaquo; <strong>Green Campus</strong></div>';

  // ── utility helpers ──────────────────────────────────────────────────
  function todayStr() { return new Date().toISOString().slice(0, 10); }
  function nowStr() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }
  function monthStr() { return todayStr().slice(0, 7); }

  function paginate(req) {
    var page = Math.max(1, parseInt(req.query.page, 10) || 1);
    var limit = Math.min(100, Math.max(1, parseInt(req.query.per_page, 10) || 25));
    var offset = (page - 1) * limit;
    return { page: page, limit: limit, offset: offset };
  }

  function flashMsg(req, type, msg) {
    if (req.session) { req.session.flash = req.session.flash || {}; req.session.flash[type] = msg; }
  }

  function getFlash(req) {
    var f = (req.session && req.session.flash) || {};
    req.session.flash = {};
    return f;
  }

  function navTabs(active) {
    var tabs = [
      { id: 'dashboard', label: 'Dashboard', href: '/school/green-campus/' },
      { id: 'initiatives', label: 'Initiatives', href: '/school/green-campus/initiatives' },
      { id: 'energy', label: 'Energy', href: '/school/green-campus/energy' },
      { id: 'waste', label: 'Waste', href: '/school/green-campus/waste' },
      { id: 'water', label: 'Water', href: '/school/green-campus/water' },
      { id: 'challenges', label: 'Challenges', href: '/school/green-campus/challenges' },
      { id: 'trees', label: 'Trees', href: '/school/green-campus/trees' },
      { id: 'reports', label: 'Reports', href: '/school/green-campus/reports' },
      { id: 'education', label: 'Education', href: '/school/green-campus/education' },
      { id: 'clubs', label: 'Eco Clubs', href: '/school/green-campus/clubs' },
      { id: 'carbon', label: 'Carbon Calc', href: '/school/green-campus/carbon' },
      { id: 'certifications', label: 'Certifications', href: '/school/green-campus/certifications' },
    ];
    tabs.forEach(function (t) { t.active = t.id === active; });
    return tabs;
  }

  function svgBarChart(data, width, height, color) {
    if (!data || !data.length) return '<p style="color:' + GRAY + '">No data available</p>';
    var maxVal = Math.max.apply(null, data.map(function (d) { return d.value; })) || 1;
    var barW = Math.max(8, Math.min(40, (width - 60) / data.length - 6));
    var chartH = height - 40;
    var svg = '<svg width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '">';
    svg += '<rect width="100%" height="100%" fill="#f9fafb" rx="8"/>';
    // Grid lines
    for (var g = 0; g <= 4; g++) {
      var gy = 10 + (chartH / 4) * g;
      svg += '<line x1="40" y1="' + gy + '" x2="' + (width - 10) + '" y2="' + gy + '" stroke="#e5e7eb" stroke-dasharray="3,3"/>';
      svg += '<text x="35" y="' + (gy + 4) + '" font-size="9" fill="#9ca3af" text-anchor="end">' + Math.round(maxVal - (maxVal / 4) * g) + '</text>';
    }
    data.forEach(function (d, i) {
      var barH = Math.max(1, (d.value / maxVal) * chartH);
      var x = 45 + i * (barW + 6);
      var y = 10 + chartH - barH;
      var opacity = 0.6 + (d.value / maxVal) * 0.4;
      svg += '<rect x="' + x + '" y="' + y + '" width="' + barW + '" height="' + barH + '" fill="' + (color || P) + '" rx="3" opacity="' + opacity.toFixed(2) + '"/>';
      svg += '<text x="' + (x + barW / 2) + '" y="' + (height - 5) + '" font-size="8" fill="#6b7280" text-anchor="middle" transform="rotate(-30,' + (x + barW / 2) + ',' + (height - 5) + ')">' + esc(d.label || '') + '</text>';
    });
    svg += '</svg>';
    return svg;
  }

  function svgLineChart(data, width, height, color) {
    if (!data || data.length < 2) return '<p style="color:' + GRAY + '">Insufficient data for trend chart</p>';
    var maxVal = Math.max.apply(null, data.map(function (d) { return d.value; })) || 1;
    var minVal = Math.min.apply(null, data.map(function (d) { return d.value; }));
    if (minVal === maxVal) { minVal -= 1; maxVal += 1; }
    var chartW = width - 60;
    var chartH = height - 40;
    var stepX = chartW / (data.length - 1);

    var points = data.map(function (d, i) {
      return {
        x: 40 + i * stepX,
        y: 10 + chartH - ((d.value - minVal) / (maxVal - minVal)) * chartH
      };
    });

    var pathD = points.map(function (p, i) { return (i === 0 ? 'M' : 'L') + p.x.toFixed(1) + ',' + p.y.toFixed(1); }).join(' ');
    var areaD = pathD + ' L' + points[points.length - 1].x.toFixed(1) + ',' + (10 + chartH) + ' L' + points[0].x.toFixed(1) + ',' + (10 + chartH) + ' Z';
    var c = color || P;

    var svg = '<svg width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '">';
    svg += '<rect width="100%" height="100%" fill="#f9fafb" rx="8"/>';
    // Grid
    for (var g = 0; g <= 4; g++) {
      var gy = 10 + (chartH / 4) * g;
      svg += '<line x1="40" y1="' + gy + '" x2="' + (width - 10) + '" y2="' + gy + '" stroke="#e5e7eb" stroke-dasharray="3,3"/>';
      var gridVal = maxVal - ((maxVal - minVal) / 4) * g;
      svg += '<text x="35" y="' + (gy + 4) + '" font-size="9" fill="#9ca3af" text-anchor="end">' + gridVal.toFixed(1) + '</text>';
    }
    // Area fill
    svg += '<path d="' + areaD + '" fill="' + c + '" opacity="0.1"/>';
    // Line
    svg += '<path d="' + pathD + '" fill="none" stroke="' + c + '" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>';
    // Dots and labels
    points.forEach(function (p, i) {
      svg += '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="4" fill="' + c + '" stroke="#fff" stroke-width="2"/>';
      svg += '<text x="' + p.x.toFixed(1) + '" y="' + (height - 5) + '" font-size="8" fill="#6b7280" text-anchor="middle" transform="rotate(-30,' + p.x.toFixed(1) + ',' + (height - 5) + ')">' + esc(data[i].label || '') + '</text>';
    });
    svg += '</svg>';
    return svg;
  }

  function svgDonutChart(legend, size) {
    if (!legend || !legend.length) return '';
    var total = 0;
    legend.forEach(function (d) { total += d.value; });
    if (total === 0) return '<p style="color:' + GRAY + '">No data</p>';
    var cx = size / 2, cy = size / 2, r = size / 2 - 20, ir = r * 0.55;
    var angle = -Math.PI / 2;
    var svg = '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">';
    svg += '<rect width="100%" height="100%" fill="#f9fafb" rx="8"/>';
    legend.forEach(function (d) {
      var sweep = (d.value / total) * 2 * Math.PI;
      var x1 = cx + r * Math.cos(angle);
      var y1 = cy + r * Math.sin(angle);
      var x2 = cx + r * Math.cos(angle + sweep);
      var y2 = cy + r * Math.sin(angle + sweep);
      var ix1 = cx + ir * Math.cos(angle);
      var iy1 = cy + ir * Math.sin(angle);
      var ix2 = cx + ir * Math.cos(angle + sweep);
      var iy2 = cy + ir * Math.sin(angle + sweep);
      var large = sweep > Math.PI ? 1 : 0;
      svg += '<path d="M' + x1.toFixed(1) + ',' + y1.toFixed(1) + ' A' + r + ',' + r + ' 0 ' + large + ' 1 ' + x2.toFixed(1) + ',' + y2.toFixed(1) + ' L' + ix2.toFixed(1) + ',' + iy2.toFixed(1) + ' A' + ir + ',' + ir + ' 0 ' + large + ' 0 ' + ix1.toFixed(1) + ',' + iy1.toFixed(1) + ' Z" fill="' + (d.color || P) + '" opacity="0.85"/>';
      angle += sweep;
    });
    svg += '<text x="' + cx + '" y="' + (cy - 4) + '" font-size="16" font-weight="700" fill="#1f2937" text-anchor="middle">' + total.toFixed(1) + '</text>';
    svg += '<text x="' + cx + '" y="' + (cy + 12) + '" font-size="10" fill="#6b7280" text-anchor="middle">Total</text>';
    svg += '</svg>';
    return svg;
  }

  function carbonBadge(level) {
    var colors = { 'excellent': 'badge-green', 'good': 'badge-blue', 'moderate': 'badge-yellow', 'poor': 'badge-red' };
    return '<span class="badge ' + (colors[level] || 'badge-yellow') + '">' + (level || 'unknown').toUpperCase() + '</span>';
  }

  // ── table migrations ─────────────────────────────────────────────────
  (async function () {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS green_initiatives (
        id BIGSERIAL PRIMARY KEY,
        tenant_id BIGINT NOT NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        category TEXT DEFAULT 'energy',
        target DECIMAL(12,2) DEFAULT 0,
        current_progress DECIMAL(12,2) DEFAULT 0,
        unit VARCHAR(50) DEFAULT 'units',
        start_date DATE,
        end_date DATE,
        status TEXT DEFAULT 'planned',
        coordinator_id BIGINT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      `);

      await pool.query(`CREATE TABLE IF NOT EXISTS energy_readings (
        id BIGSERIAL PRIMARY KEY,
        tenant_id BIGINT NOT NULL,
        meter_id VARCHAR(100) NOT NULL,
        reading_type TEXT DEFAULT 'electricity',
        value DECIMAL(12,2) NOT NULL,
        unit VARCHAR(20) DEFAULT 'kWh',
        cost DECIMAL(10,2) DEFAULT 0,
        recorded_at TIMESTAMPTZ NOT NULL,
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      `);

      await pool.query(`CREATE TABLE IF NOT EXISTS waste_records (
        id BIGSERIAL PRIMARY KEY,
        tenant_id BIGINT NOT NULL,
        waste_type TEXT DEFAULT 'general',
        weight_kg DECIMAL(10,2) NOT NULL,
        disposal_method TEXT DEFAULT 'landfill',
        recorded_at TIMESTAMPTZ NOT NULL,
        recorded_by BIGINT,
        location VARCHAR(255),
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      `);

      await pool.query(`CREATE TABLE IF NOT EXISTS green_challenges (
        id BIGSERIAL PRIMARY KEY,
        tenant_id BIGINT NOT NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        participants JSON DEFAULT NULL,
        metric VARCHAR(100) DEFAULT 'points',
        created_by BIGINT,
        status TEXT DEFAULT 'draft',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      `);

      await pool.query(`CREATE TABLE IF NOT EXISTS water_readings (
        id BIGSERIAL PRIMARY KEY,
        tenant_id BIGINT NOT NULL,
        meter_id VARCHAR(100) NOT NULL,
        value DECIMAL(12,2) NOT NULL,
        unit VARCHAR(20) DEFAULT 'litres',
        recorded_at TIMESTAMPTZ NOT NULL,
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      `);

      await pool.query(`CREATE TABLE IF NOT EXISTS tree_planting (
        id BIGSERIAL PRIMARY KEY,
        tenant_id BIGINT NOT NULL,
        species VARCHAR(255) NOT NULL,
        quantity INT DEFAULT 1,
        location VARCHAR(500),
        planted_by BIGINT,
        planted_at DATE NOT NULL,
        status TEXT DEFAULT 'planned',
        survival_rate DECIMAL(5,2) DEFAULT 100.00,
        co2_offset_kg DECIMAL(10,2) DEFAULT 0,
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      `);

      await pool.query(`CREATE TABLE IF NOT EXISTS sustainability_goals (
        id BIGSERIAL PRIMARY KEY,
        tenant_id BIGINT NOT NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        category TEXT DEFAULT 'energy',
        target_value DECIMAL(12,2) DEFAULT 0,
        current_value DECIMAL(12,2) DEFAULT 0,
        unit VARCHAR(50) DEFAULT '',
        deadline DATE,
        status TEXT DEFAULT 'on_track',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      `);

      await pool.query(`CREATE TABLE IF NOT EXISTS green_certifications (
        id BIGSERIAL PRIMARY KEY,
        tenant_id BIGINT NOT NULL,
        cert_name VARCHAR(255) NOT NULL,
        issuing_body VARCHAR(255),
        cert_level VARCHAR(100),
        achieved_date DATE,
        expiry_date DATE,
        status TEXT DEFAULT 'pending',
        audit_score DECIMAL(5,2) DEFAULT 0,
        criteria JSON DEFAULT NULL,
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      `);

      await pool.query(`CREATE TABLE IF NOT EXISTS eco_clubs (
        id BIGSERIAL PRIMARY KEY,
        tenant_id BIGINT NOT NULL,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        president_id BIGINT,
        teacher_advisor_id BIGINT,
        member_count INT DEFAULT 0,
        meeting_schedule VARCHAR(255),
        status TEXT DEFAULT 'active',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      `);

      console.log('[GreenCampus] Tables ready');
    } catch (e) {
      console.warn('[GreenCampus] Migration warning:', e.message);
    }
  })();

  // ====================================================================
  //  ROUTE 1 - DASHBOARD
  // ====================================================================
  app.get('/school/green-campus/', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const html = SKIP;

    // Navigation tabs
    html += '<div style="margin-bottom:20px;overflow-x:auto">';
    navTabs('dashboard').forEach(function (t) {
      html += '<a href="' + t.href + '" class="nav-tab' + (t.active ? ' active' : '') + '">' + t.label + '</a>';
    });
    html += '</div>';

    // KPI cards
    const { rows: initCount } = await pool.query(
      'SELECT COUNT(*) AS total, SUM(CASE WHEN status=\'active\' THEN 1 ELSE 0 END) AS active FROM green_initiatives WHERE tenant_id = $1', [tid]
    );
    const { rows: energyMonth } = await pool.query(
      'SELECT COALESCE(SUM(value),0) AS total_kwh FROM energy_readings WHERE tenant_id = $1 AND reading_type=\'electricity\' AND recorded_at >= DATE_FORMAT(NOW(),\'%Y-%m-01\')', [tid]
    );
    const { rows: wasteMonth } = await pool.query(
      'SELECT COALESCE(SUM(weight_kg),0) AS total_kg, SUM(CASE WHEN disposal_method=\'recycled\' THEN weight_kg ELSE 0 END) AS recycled_kg FROM waste_records WHERE tenant_id = $1 AND recorded_at >= DATE_FORMAT(NOW(),\'%Y-%m-01\')', [tid]
    );
    const { rows: waterMonth } = await pool.query(
      'SELECT COALESCE(SUM(value),0) AS total_litres FROM water_readings WHERE tenant_id = $1 AND recorded_at >= DATE_FORMAT(NOW(),\'%Y-%m-01\')', [tid]
    );
    const { rows: treeCount } = await pool.query(
      'SELECT COALESCE(SUM(quantity),0) AS total_trees, COALESCE(SUM(co2_offset_kg),0) AS total_co2 FROM tree_planting WHERE tenant_id = $1 AND status IN (\'planted\',\'growing\',\'mature\')', [tid]
    );
    const { rows: challengeCount } = await pool.query(
      'SELECT COUNT(*) AS total FROM green_challenges WHERE tenant_id = $1 AND status = \'active\'', [tid]
    );

    var init = initCount[0] || {};
    var en = energyMonth[0] || {};
    var ws = wasteMonth[0] || {};
    var wt = waterMonth[0] || {};
    var tr = treeCount[0] || {};
    var ch = challengeCount[0] || {};

    var recyclingRate = ws.total_kg > 0 ? ((ws.recycled_kg / ws.total_kg) * 100).toFixed(1) : 0;

    html += '<h2 style="color:#1f2937;margin-bottom:16px">&#127807; Green Campus Dashboard</h2>';
    html += '<div class="stat-grid">';
    html += '<div class="kpi"><div class="val">' + (init.active || 0) + '</div><div class="lbl">Active Initiatives</div></div>';
    html += '<div class="kpi"><div class="val">' + Number(en.total_kwh || 0).toFixed(0) + '</div><div class="lbl">Energy (kWh) this month</div></div>';
    html += '<div class="kpi"><div class="val">' + Number(ws.total_kg || 0).toFixed(1) + '</div><div class="lbl">Waste (kg) this month</div></div>';
    html += '<div class="kpi"><div class="val">' + recyclingRate + '%</div><div class="lbl">Recycling Rate</div></div>';
    html += '<div class="kpi"><div class="val">' + Number(wt.total_litres || 0).toFixed(0) + '</div><div class="lbl">Water (L) this month</div></div>';
    html += '<div class="kpi"><div class="val">' + (tr.total_trees || 0) + '</div><div class="lbl">Trees Planted</div></div>';
    html += '<div class="kpi"><div class="val">' + Number(tr.total_co2 || 0).toFixed(0) + '</div><div class="lbl">CO\u2082 Offset (kg)</div></div>';
    html += '<div class="kpi"><div class="val">' + (ch.total || 0) + '</div><div class="lbl">Active Challenges</div></div>';
    html += '</div>';

    // Energy trend chart (last 12 months)
    const { rows: energyTrend } = await pool.query(
      'SELECT DATE_FORMAT(recorded_at,\'%b %Y\') AS label, SUM(value) AS value FROM energy_readings WHERE tenant_id = $1 AND reading_type=\'electricity\' AND recorded_at >= NOW() - INTERVAL \'12 MONTH\' GROUP BY DATE_FORMAT(recorded_at,\'%Y-%m\') ORDER BY MIN(recorded_at) ASC LIMIT 12', [tid]
    );
    html += '<div class="card"><h3 style="color:#1f2937">Energy Consumption Trend (12 months)</h3>';
    html += svgBarChart(energyTrend, 700, 220, '#16a34a');
    html += '</div>';

    // Waste breakdown donut
    const { rows: wasteBreakdown } = await pool.query(
      'SELECT waste_type, SUM(weight_kg) AS value FROM waste_records WHERE tenant_id = $1 AND recorded_at >= NOW() - INTERVAL \'6 MONTH\' GROUP BY waste_type ORDER BY value DESC', [tid]
    );
    var wasteColors = { 'recyclable': '#16a34a', 'organic': '#92400e', 'general': '#6b7280', 'hazardous': '#dc2626', 'e_waste': '#7c3aed', 'construction': '#f59e0b' };
    var wasteLegend = wasteBreakdown.map(function (w) { return { label: w.waste_type, value: w.value, color: wasteColors[w.waste_type] || P }; });
    html += '<div class="card"><h3 style="color:#1f2937">Waste Breakdown (6 months)</h3>';
    html += '<div style="display:flex;flex-wrap:wrap;gap:20px;align-items:center">';
    html += svgDonutChart(wasteLegend, 220);
    html += '<div>';
    wasteLegend.forEach(function (w) {
      var pct = wasteLegend.reduce(function (s, x) { return s + x.value; }, 0);
      html += '<div style="margin:6px 0"><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:' + w.color + ';margin-right:8px"></span>' + esc(w.label) + ': ' + Number(w.value).toFixed(1) + ' kg (' + (pct > 0 ? ((w.value / pct) * 100).toFixed(1) : 0) + '%)</div>';
    });
    html += '</div></div></div>';

    // Active initiatives
    const { rows: activeInit } = await pool.query(
      'SELECT gi.*, u.display_name AS coordinator_name FROM green_initiatives gi LEFT JOIN users u ON u.id = gi.coordinator_id WHERE gi.tenant_id = $1 AND gi.status = \'active\' ORDER BY gi.created_at DESC LIMIT 5', [tid]
    );
    if (activeInit.length) {
      html += '<div class="card"><h3 style="color:#1f2937">Active Green Initiatives</h3><table><tr><th>Title</th><th>Category</th><th>Progress</th><th>Coordinator</th></tr>';
      activeInit.forEach(function (i) {
        var pct = i.target > 0 ? Math.min(100, ((i.current_progress / i.target) * 100)).toFixed(1) : 0;
        html += '<tr><td><a href="/school/green-campus/initiatives/' + i.id + '" style="color:#16a34a">' + esc(i.title) + '</a></td>';
        html += '<td><span class="badge badge-green">' + esc(i.category) + '</span></td>';
        html += '<td><div class="progress-bar" style="width:120px;display:inline-block;vertical-align:middle"><div class="progress-fill" style="width:' + pct + '%"></div></div> ' + pct + '%</td>';
        html += '<td>' + esc(i.coordinator_name || '-') + '</td></tr>';
      });
      html += '</table><a href="/school/green-campus/initiatives" class="btn-outline" style="margin-top:12px;display:inline-block">View All Initiatives</a></div>';
    }

    // Active challenges
    const { rows: activeCh } = await pool.query(
      'SELECT * FROM green_challenges WHERE tenant_id = $1 AND status = \'active\' ORDER BY end_date ASC LIMIT 3', [tid]
    );
    if (activeCh.length) {
      html += '<div class="card"><h3 style="color:#1f2937">&#127942; Active Green Challenges</h3>';
      activeCh.forEach(function (c) {
        var parts = c.participants ? (typeof c.participants === 'string' ? JSON.parse(c.participants) : c.participants) : [];
        html += '<div class="card" style="border-left:4px solid #16a34a"><strong>' + esc(c.title) + '</strong>';
        html += '<p style="color:' + GRAY + ';font-size:13px">' + esc(c.description || '').substring(0, 120) + '</p>';
        html += '<span class="badge badge-blue">' + (parts.length || 0) + ' participants</span> ';
        html += '<span style="color:' + GRAY + ';font-size:12px">Ends: ' + esc(c.end_date) + '</span></div>';
      });
      html += '</div>';
    }

    renderPage(req, res, 'raw', { html: html, title: 'Green Campus Dashboard' });
  }));

  // ====================================================================
  //  ROUTE 2 - INITIATIVES (List, Create, View, Edit, Delete)
  // ====================================================================
  app.get('/school/green-campus/initiatives', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    var pg = paginate(req);
    var statusFilter = req.query.status || '';
    var catFilter = req.query.category || '';

    let pIdx = 1;
    var where = 'WHERE gi.tenant_id = $$' + pIdx++;
    var params = [tid];
    if (statusFilter) { where += ' AND gi.status = $$' + pIdx++; params.push(statusFilter); }
    if (catFilter) { where += ' AND gi.category = $$' + pIdx++; params.push(catFilter); }

    const { rows: initiatives } = await pool.query(
      'SELECT gi.*, u.display_name AS coordinator_name FROM green_initiatives gi LEFT JOIN users u ON u.id = gi.coordinator_id ' + where + ' ORDER BY gi.created_at DESC LIMIT $$' + pIdx++ + ' OFFSET $$' + pIdx++,
      params.concat([pg.limit, pg.offset])
    );
    const { rows: total } = await pool.query('SELECT COUNT(*) AS cnt FROM green_initiatives gi ' + where, params);

    const html = SKIP;
    html += '<div style="margin-bottom:20px;overflow-x:auto">';
    navTabs('initiatives').forEach(function (t) {
      html += '<a href="' + t.href + '" class="nav-tab' + (t.active ? ' active' : '') + '">' + t.label + '</a>';
    });
    html += '</div>';
    html += '<h2 style="color:#1f2937">&#127793; Green Initiatives</h2>';

    // Filters
    html += '<div class="card" style="padding:12px">';
    html += '<form method="get" style="display:flex;gap:12px;flex-wrap:wrap;align-items:center">';
    html += '<select name="status"><option value="">All Status</option><option value="planned"' + (statusFilter === 'planned' ? ' selected' : '') + '>Planned</option><option value="active"' + (statusFilter === 'active' ? ' selected' : '') + '>Active</option><option value="completed"' + (statusFilter === 'completed' ? ' selected' : '') + '>Completed</option><option value="on_hold"' + (statusFilter === 'on_hold' ? ' selected' : '') + '>On Hold</option></select>';
    html += '<select name="category"><option value="">All Categories</option><option value="energy"' + (catFilter === 'energy' ? ' selected' : '') + '>Energy</option><option value="waste"' + (catFilter === 'waste' ? ' selected' : '') + '>Waste</option><option value="water"' + (catFilter === 'water' ? ' selected' : '') + '>Water</option><option value="biodiversity"' + (catFilter === 'biodiversity' ? ' selected' : '') + '>Biodiversity</option><option value="transport"' + (catFilter === 'transport' ? ' selected' : '') + '>Transport</option><option value="education"' + (catFilter === 'education' ? ' selected' : '') + '>Education</option><option value="community"' + (catFilter === 'community' ? ' selected' : '') + '>Community</option></select>';
    html += '<button class="btn" type="submit">Filter</button>';
    html += '<a href="/school/green-campus/initiatives/create" class="btn" style="margin-left:auto">+ New Initiative</a>';
    html += '</form></div>';

    if (initiatives.length) {
      html += '<table><tr><th>Title</th><th>Category</th><th>Status</th><th>Progress</th><th>Target</th><th>Coordinator</th><th>Actions</th></tr>';
      initiatives.forEach(function (i) {
        var pct = i.target > 0 ? Math.min(100, ((i.current_progress / i.target) * 100)).toFixed(1) : 0;
        var statusCls = i.status === 'active' ? 'badge-green' : i.status === 'completed' ? 'badge-blue' : i.status === 'on_hold' ? 'badge-yellow' : 'badge-blue';
        html += '<tr><td><a href="/school/green-campus/initiatives/' + i.id + '" style="color:#16a34a;font-weight:600">' + esc(i.title) + '</a></td>';
        html += '<td>' + esc(i.category) + '</td>';
        html += '<td><span class="badge ' + statusCls + '">' + esc(i.status) + '</span></td>';
        html += '<td><div class="progress-bar" style="width:100px;display:inline-block;vertical-align:middle"><div class="progress-fill" style="width:' + pct + '%"></div></div> ' + pct + '%</td>';
        html += '<td>' + esc(i.target + ' ' + (i.unit || '')) + '</td>';
        html += '<td>' + esc(i.coordinator_name || '-') + '</td>';
        html += '<td><a href="/school/green-campus/initiatives/' + i.id + '/edit" class="btn-outline" style="padding:4px 10px;font-size:12px">Edit</a></td></tr>';
      });
      html += '</table>';
    } else {
      html += '<div class="card" style="text-align:center;padding:40px;color:' + GRAY + '">No initiatives found. <a href="/school/green-campus/initiatives/create" style="color:#16a34a">Create your first initiative</a></div>';
    }

    renderPage(req, res, 'raw', { html: html, title: 'Green Initiatives' });
  }));

  app.get('/school/green-campus/initiatives/create', requireAuth, ah(async function (req, res) {
    const html = SKIP;
    html += '<div style="margin-bottom:20px;overflow-x:auto">';
    navTabs('initiatives').forEach(function (t) {
      html += '<a href="' + t.href + '" class="nav-tab' + (t.active ? ' active' : '') + '">' + t.label + '</a>';
    });
    html += '</div>';
    html += '<h2 style="color:#1f2937">Create Green Initiative</h2>';
    html += '<div class="card"><form method="post" action="/school/green-campus/initiatives/create">';
    html += '<div class="form-row"><div><label>Title *</label><input name="title" required></div>';
    html += '<div><label>Category</label><select name="category"><option value="energy">Energy</option><option value="waste">Waste</option><option value="water">Water</option><option value="biodiversity">Biodiversity</option><option value="transport">Transport</option><option value="education">Education</option><option value="community">Community</option></select></div></div>';
    html += '<div style="margin-bottom:12px"><label>Description</label><textarea name="description" rows="3"></textarea></div>';
    html += '<div class="form-row"><div><label>Target Value</label><input type="number" step="0.01" name="target" value="100"></div>';
    html += '<div><label>Unit</label><input name="unit" value="units" placeholder="e.g. kWh, kg, trees"></div></div>';
    html += '<div class="form-row"><div><label>Start Date</label><input type="date" name="start_date" value="' + todayStr() + '"></div>';
    html += '<div><label>End Date</label><input type="date" name="end_date"></div></div>';
    html += '<div style="margin-bottom:12px"><button type="submit" class="btn">Create Initiative</button>';
    html += '<a href="/school/green-campus/initiatives" class="btn-outline" style="margin-left:8px">Cancel</a></div>';
    html += '</form></div>';
    renderPage(req, res, 'raw', { html: html, title: 'Create Initiative' });
  }));

  app.post('/school/green-campus/initiatives/create', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const body = req.body;
    if (!body.title) { return res.redirect('/school/green-campus/initiatives/create'); }
    await pool.query(
      'INSERT INTO green_initiatives (tenant_id, title, description, category, target, current_progress, unit, start_date, end_date, status, coordinator_id) VALUES ($1,$2,$3,$4,$5,0,$6,$7,$8,$9,$10)',
      [tid, body.title, body.description || '', body.category || 'energy', parseFloat(body.target) || 0, body.unit || 'units', body.start_date || null, body.end_date || null, body.status || 'planned', uid]
    );
    audit(req, 'green_initiative_create', 'Created initiative: ' + body.title);
    res.redirect('/school/green-campus/initiatives');
  }));

  app.get('/school/green-campus/initiatives/:id', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    var initId = parseInt(req.params.id, 10);
    const { rows } = await pool.query(
      'SELECT gi.*, u.display_name AS coordinator_name FROM green_initiatives gi LEFT JOIN users u ON u.id = gi.coordinator_id WHERE gi.tenant_id = $1 AND gi.id = $2', [tid, initId]
    );
    if (!rows.length) { return res.redirect('/school/green-campus/initiatives'); }
    var init = rows[0];
    var pct = init.target > 0 ? Math.min(100, ((init.current_progress / init.target) * 100)).toFixed(1) : 0;

    const html = SKIP;
    html += '<div style="margin-bottom:20px;overflow-x:auto">';
    navTabs('initiatives').forEach(function (t) {
      html += '<a href="' + t.href + '" class="nav-tab' + (t.active ? ' active' : '') + '">' + t.label + '</a>';
    });
    html += '</div>';
    html += '<div class="card"><h2 style="color:#1f2937">' + esc(init.title) + '</h2>';
    html += '<p style="color:' + GRAY + '">' + esc(init.description || '') + '</p>';
    html += '<div class="stat-grid" style="margin-top:16px">';
    html += '<div class="kpi"><div class="val">' + esc(init.category) + '</div><div class="lbl">Category</div></div>';
    html += '<div class="kpi"><div class="val">' + pct + '%</div><div class="lbl">Progress</div></div>';
    html += '<div class="kpi"><div class="val">' + esc(init.target + ' ' + (init.unit || '')) + '</div><div class="lbl">Target</div></div>';
    html += '<div class="kpi"><div class="val">' + esc(init.status) + '</div><div class="lbl">Status</div></div>';
    html += '</div>';
    html += '<div class="progress-bar" style="height:20px;margin-top:16px"><div class="progress-fill" style="width:' + pct + '%;font-size:12px;color:#fff;text-align:center;line-height:20px">' + pct + '%</div></div>';
    html += '<p style="margin-top:12px;color:' + GRAY + '">Coordinator: ' + esc(init.coordinator_name || '-') + ' | Start: ' + esc(init.start_date || '-') + ' | End: ' + esc(init.end_date || '-') + '</p>';
    html += '<div style="margin-top:16px">';
    html += '<a href="/school/green-campus/initiatives/' + initId + '/edit" class="btn">Edit</a> ';
    html += '<a href="/school/green-campus/initiatives" class="btn-outline">Back to List</a>';
    html += '</div></div>';

    // Update progress form
    html += '<div class="card"><h3 style="color:#1f2937">Update Progress</h3>';
    html += '<form method="post" action="/school/green-campus/initiatives/' + initId + '/progress">';
    html += '<div class="form-row"><div><label>Current Progress (' + esc(init.unit || 'units') + ')</label><input type="number" step="0.01" name="progress" value="' + init.current_progress + '"></div>';
    html += '<div><label>Status</label><select name="status"><option value="planned"' + (init.status === 'planned' ? ' selected' : '') + '>Planned</option><option value="active"' + (init.status === 'active' ? ' selected' : '') + '>Active</option><option value="completed"' + (init.status === 'completed' ? ' selected' : '') + '>Completed</option><option value="on_hold"' + (init.status === 'on_hold' ? ' selected' : '') + '>On Hold</option></select></div></div>';
    html += '<button type="submit" class="btn" style="margin-top:12px">Update</button></form></div>';

    renderPage(req, res, 'raw', { html: html, title: init.title });
  }));

  app.post('/school/green-campus/initiatives/:id/progress', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    var initId = parseInt(req.params.id, 10);
    var progress = parseFloat(req.body.progress) || 0;
    var status = req.body.status || 'active';
    await pool.query(
      'UPDATE green_initiatives SET current_progress = $1, status = $2 WHERE tenant_id = $3 AND id = $4',
      [progress, status, tid, initId]
    );
    audit(req, 'green_initiative_progress', 'Updated progress to ' + progress + ' for initiative ' + initId);
    res.redirect('/school/green-campus/initiatives/' + initId);
  }));

  app.get('/school/green-campus/initiatives/:id/edit', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    var initId = parseInt(req.params.id, 10);
    const { rows } = await pool.query('SELECT * FROM green_initiatives WHERE tenant_id = $1 AND id = $2', [tid, initId]);
    if (!rows.length) { return res.redirect('/school/green-campus/initiatives'); }
    var i = rows[0];
    const html = SKIP;
    html += '<h2 style="color:#1f2937">Edit Initiative</h2>';
    html += '<div class="card"><form method="post" action="/school/green-campus/initiatives/' + initId + '/edit">';
    html += '<div class="form-row"><div><label>Title *</label><input name="title" value="' + esc(i.title) + '" required></div>';
    html += '<div><label>Category</label><select name="category">';
    ['energy', 'waste', 'water', 'biodiversity', 'transport', 'education', 'community'].forEach(function (c) {
      html += '<option value="' + c + '"' + (i.category === c ? ' selected' : '') + '>' + c + '</option>';
    });
    html += '</select></div></div>';
    html += '<div style="margin-bottom:12px"><label>Description</label><textarea name="description" rows="3">' + esc(i.description || '') + '</textarea></div>';
    html += '<div class="form-row"><div><label>Target</label><input type="number" step="0.01" name="target" value="' + i.target + '"></div>';
    html += '<div><label>Unit</label><input name="unit" value="' + esc(i.unit || 'units') + '"></div></div>';
    html += '<div class="form-row"><div><label>Start Date</label><input type="date" name="start_date" value="' + (i.start_date || '') + '"></div>';
    html += '<div><label>End Date</label><input type="date" name="end_date" value="' + (i.end_date || '') + '"></div></div>';
    html += '<div class="form-row"><div><label>Status</label><select name="status">';
    ['planned', 'active', 'completed', 'on_hold'].forEach(function (s) {
      html += '<option value="' + s + '"' + (i.status === s ? ' selected' : '') + '>' + s + '</option>';
    });
    html += '</select></div></div>';
    html += '<button type="submit" class="btn">Save Changes</button> <a href="/school/green-campus/initiatives/' + initId + '" class="btn-outline">Cancel</a>';
    html += '</form></div>';
    renderPage(req, res, 'raw', { html: html, title: 'Edit Initiative' });
  }));

  app.post('/school/green-campus/initiatives/:id/edit', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    var initId = parseInt(req.params.id, 10);
    var b = req.body;
    await pool.query(
      'UPDATE green_initiatives SET title=$1, description=$2, category=$3, target=$4, unit=$5, start_date=$6, end_date=$7, status=$8 WHERE tenant_id = $9 AND id = $10',
      [b.title, b.description || '', b.category || 'energy', parseFloat(b.target) || 0, b.unit || 'units', b.start_date || null, b.end_date || null, b.status || 'planned', tid, initId]
    );
    audit(req, 'green_initiative_update', 'Updated initiative ' + initId);
    res.redirect('/school/green-campus/initiatives/' + initId);
  }));

  app.post('/school/green-campus/initiatives/:id/delete', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    var initId = parseInt(req.params.id, 10);
    await pool.query('DELETE FROM green_initiatives WHERE tenant_id = $1 AND id = $2', [tid, initId]);
    audit(req, 'green_initiative_delete', 'Deleted initiative ' + initId);
    res.redirect('/school/green-campus/initiatives');
  }));

  // ====================================================================
  //  ROUTE 3 - ENERGY TRACKING
  // ====================================================================
  app.get('/school/green-campus/energy', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    var meterFilter = req.query.meter_id || '';

    let pIdx = 1;
    var whereClause = 'WHERE er.tenant_id = $$' + pIdx++;
    var params = [tid];
    if (meterFilter) { whereClause += ' AND er.meter_id = $$' + pIdx++; params.push(meterFilter); }

    const { rows: readings } = await pool.query(
      'SELECT er.* FROM energy_readings er ' + whereClause + ' ORDER BY er.recorded_at DESC LIMIT 50', params
    );

    // Monthly totals for chart
    const { rows: monthlyData } = await pool.query(
      'SELECT DATE_FORMAT(recorded_at,\'%b %Y\') AS label, SUM(CASE WHEN reading_type=\'electricity\' THEN value ELSE 0 END) AS electricity, SUM(CASE WHEN reading_type=\'gas\' THEN value ELSE 0 END) AS gas, SUM(CASE WHEN reading_type=\'solar_generation\' THEN value ELSE 0 END) AS solar FROM energy_readings WHERE tenant_id = $1 AND recorded_at >= NOW() - INTERVAL \'12 MONTH\' GROUP BY DATE_FORMAT(recorded_at,\'%Y-%m\') ORDER BY MIN(recorded_at) LIMIT 12', [tid]
    );

    // Meters list
    const { rows: meters } = await pool.query(
      'SELECT DISTINCT meter_id FROM energy_readings WHERE tenant_id = $1 ORDER BY meter_id', [tid]
    );

    const html = SKIP;
    html += '<div style="margin-bottom:20px;overflow-x:auto">';
    navTabs('energy').forEach(function (t) {
      html += '<a href="' + t.href + '" class="nav-tab' + (t.active ? ' active' : '') + '">' + t.label + '</a>';
    });
    html += '</div>';
    html += '<h2 style="color:#1f2937">&#9889; Energy Monitoring</h2>';

    // Add reading form
    html += '<div class="card"><h3 style="color:#1f2937">Record New Reading</h3>';
    html += '<form method="post" action="/school/green-campus/energy/add" style="display:flex;gap:12px;flex-wrap:wrap;align-items:end">';
    html += '<div style="flex:1;min-width:120px"><label>Meter ID</label><input name="meter_id" required placeholder="e.g. MTR-001"></div>';
    html += '<div style="flex:1;min-width:120px"><label>Type</label><select name="reading_type"><option value="electricity">Electricity</option><option value="gas">Gas</option><option value="solar_generation">Solar Generation</option><option value="solar_export">Solar Export</option></select></div>';
    html += '<div style="flex:1;min-width:100px"><label>Value</label><input type="number" step="0.01" name="value" required></div>';
    html += '<div style="flex:1;min-width:100px"><label>Unit</label><select name="unit"><option value="kWh">kWh</option><option value="m3">m3</option><option value="therms">Therms</option></select></div>';
    html += '<div style="flex:1;min-width:100px"><label>Cost ($)</label><input type="number" step="0.01" name="cost" value="0"></div>';
    html += '<div style="flex:1;min-width:140px"><label>Date/Time</label><input type="datetime-local" name="recorded_at" value="' + nowStr() + '"></div>';
    html += '<div><button class="btn" type="submit">+ Add</button></div>';
    html += '</form></div>';

    // Filter
    if (meters.length > 1) {
      html += '<div class="card" style="padding:10px"><form method="get"><select name="meter_id"><option value="">All Meters</option>';
      meters.forEach(function (m) { html += '<option value="' + esc(m.meter_id) + '"' + (meterFilter === m.meter_id ? ' selected' : '') + '>' + esc(m.meter_id) + '</option>'; });
      html += '</select><button class="btn" type="submit" style="margin-left:8px">Filter</button></form></div>';
    }

    // Chart
    html += '<div class="card"><h3 style="color:#1f2937">Monthly Energy Trend</h3>';
    html += svgLineChart(monthlyData.map(function (m) { return { label: m.label, value: m.electricity }; }), 700, 200, '#16a34a');
    html += '</div>';

    // Readings table
    html += '<div class="card"><h3 style="color:#1f2937">Recent Readings</h3>';
    if (readings.length) {
      html += '<table><tr><th>Meter</th><th>Type</th><th>Value</th><th>Unit</th><th>Cost</th><th>Recorded</th><th>Actions</th></tr>';
      readings.forEach(function (r) {
        html += '<tr><td>' + esc(r.meter_id) + '</td><td>' + esc(r.reading_type) + '</td>';
        html += '<td>' + r.value + '</td><td>' + esc(r.unit) + '</td><td>$' + Number(r.cost).toFixed(2) + '</td>';
        html += '<td>' + esc(r.recorded_at) + '</td>';
        html += '<td><form method="post" action="/school/green-campus/energy/' + r.id + '/delete" style="display:inline"><button class="btn-danger" style="padding:4px 10px;font-size:12px" onclick="return confirm(\'Delete this reading?\')">Delete</button></form></td></tr>';
      });
      html += '</table>';
    } else {
      html += '<p style="color:' + GRAY + ';text-align:center">No energy readings recorded yet.</p>';
    }
    html += '</div>';

    renderPage(req, res, 'raw', { html: html, title: 'Energy Monitoring' });
  }));

  app.post('/school/green-campus/energy/add', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    var b = req.body;
    if (!b.meter_id || !b.value) { return res.redirect('/school/green-campus/energy'); }
    await pool.query(
      'INSERT INTO energy_readings (tenant_id, meter_id, reading_type, value, unit, cost, recorded_at, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [tid, b.meter_id, b.reading_type || 'electricity', parseFloat(b.value) || 0, b.unit || 'kWh', parseFloat(b.cost) || 0, b.recorded_at || nowStr(), b.notes || '']
    );
    audit(req, 'energy_reading_add', 'Added energy reading for meter ' + b.meter_id);
    res.redirect('/school/green-campus/energy');
  }));

  app.post('/school/green-campus/energy/:id/delete', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    await pool.query('DELETE FROM energy_readings WHERE tenant_id = $1 AND id = $2', [tid, parseInt(req.params.id, 10)]);
    res.redirect('/school/green-campus/energy');
  }));

  // ====================================================================
  //  ROUTE 4 - WASTE MANAGEMENT
  // ====================================================================
  app.get('/school/green-campus/waste', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;

    const { rows: records } = await pool.query(
      'SELECT wr.*, u.display_name AS recorded_by_name FROM waste_records wr LEFT JOIN users u ON u.id = wr.recorded_by WHERE wr.tenant_id = $1 ORDER BY wr.recorded_at DESC LIMIT 50', [tid]
    );

    // Monthly waste trend
    const { rows: wasteTrend } = await pool.query(
      'SELECT DATE_FORMAT(recorded_at,\'%b %Y\') AS label, SUM(weight_kg) AS value FROM waste_records WHERE tenant_id = $1 AND recorded_at >= NOW() - INTERVAL \'12 MONTH\' GROUP BY DATE_FORMAT(recorded_at,\'%Y-%m\') ORDER BY MIN(recorded_at) LIMIT 12', [tid]
    );

    // Disposal breakdown
    const { rows: disposalStats } = await pool.query(
      'SELECT disposal_method, SUM(weight_kg) AS total FROM waste_records WHERE tenant_id = $1 AND recorded_at >= NOW() - INTERVAL \'6 MONTH\' GROUP BY disposal_method ORDER BY total DESC', [tid]
    );
    var disposalColors = { 'recycled': '#16a34a', 'composted': '#92400e', 'landfill': '#6b7280', 'incinerated': '#dc2626', 'specialized': '#7c3aed' };
    var disposalLegend = disposalStats.map(function (d) { return { label: d.disposal_method, value: d.total, color: disposalColors[d.disposal_method] || P }; });

    const html = SKIP;
    html += '<div style="margin-bottom:20px;overflow-x:auto">';
    navTabs('waste').forEach(function (t) {
      html += '<a href="' + t.href + '" class="nav-tab' + (t.active ? ' active' : '') + '">' + t.label + '</a>';
    });
    html += '</div>';
    html += '<h2 style="color:#1f2937">&#9851; Waste Management</h2>';

    // Add waste form
    html += '<div class="card"><h3 style="color:#1f2937">Record Waste</h3>';
    html += '<form method="post" action="/school/green-campus/waste/add" style="display:flex;gap:12px;flex-wrap:wrap;align-items:end">';
    html += '<div style="flex:1;min-width:140px"><label>Waste Type</label><select name="waste_type"><option value="recyclable">Recyclable</option><option value="organic">Organic</option><option value="general">General</option><option value="hazardous">Hazardous</option><option value="e_waste">E-Waste</option><option value="construction">Construction</option></select></div>';
    html += '<div style="flex:1;min-width:100px"><label>Weight (kg)</label><input type="number" step="0.01" name="weight_kg" required></div>';
    html += '<div style="flex:1;min-width:140px"><label>Disposal Method</label><select name="disposal_method"><option value="recycled">Recycled</option><option value="composted">Composted</option><option value="landfill">Landfill</option><option value="incinerated">Incinerated</option><option value="specialized">Specialized</option></select></div>';
    html += '<div style="flex:1;min-width:140px"><label>Location</label><input name="location" placeholder="e.g. Main Building"></div>';
    html += '<div style="flex:1;min-width:140px"><label>Date</label><input type="datetime-local" name="recorded_at" value="' + nowStr() + '"></div>';
    html += '<div><button class="btn" type="submit">+ Add</button></div>';
    html += '</form></div>';

    // Chart
    html += '<div class="card"><h3 style="color:#1f2937">Waste Trend (12 months)</h3>';
    html += svgBarChart(wasteTrend, 700, 220, '#92400e');
    html += '</div>';

    // Disposal donut
    html += '<div class="card"><h3 style="color:#1f2937">Disposal Methods</h3>';
    html += '<div style="display:flex;flex-wrap:wrap;gap:20px;align-items:center">';
    html += svgDonutChart(disposalLegend, 200);
    html += '<div>';
    disposalLegend.forEach(function (d) {
      html += '<div style="margin:4px 0"><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:' + d.color + ';margin-right:8px"></span>' + esc(d.label) + ': ' + Number(d.value).toFixed(1) + ' kg</div>';
    });
    html += '</div></div></div>';

    // Records table
    html += '<div class="card"><h3 style="color:#1f2937">Waste Records</h3>';
    if (records.length) {
      html += '<table><tr><th>Type</th><th>Weight (kg)</th><th>Disposal</th><th>Location</th><th>Recorded By</th><th>Date</th></tr>';
      records.forEach(function (r) {
        html += '<tr><td>' + esc(r.waste_type) + '</td><td>' + r.weight_kg + '</td><td>' + esc(r.disposal_method) + '</td>';
        html += '<td>' + esc(r.location || '-') + '</td><td>' + esc(r.recorded_by_name || '-') + '</td><td>' + esc(r.recorded_at) + '</td></tr>';
      });
      html += '</table>';
    } else {
      html += '<p style="color:' + GRAY + ';text-align:center">No waste records yet.</p>';
    }
    html += '</div>';

    renderPage(req, res, 'raw', { html: html, title: 'Waste Management' });
  }));

  app.post('/school/green-campus/waste/add', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    var b = req.body;
    if (!b.weight_kg) { return res.redirect('/school/green-campus/waste'); }
    await pool.query(
      'INSERT INTO waste_records (tenant_id, waste_type, weight_kg, disposal_method, recorded_at, recorded_by, location, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [tid, b.waste_type || 'general', parseFloat(b.weight_kg) || 0, b.disposal_method || 'landfill', b.recorded_at || nowStr(), req.session.user.id, b.location || '', b.notes || '']
    );
    audit(req, 'waste_record_add', 'Recorded ' + b.weight_kg + 'kg ' + (b.waste_type || 'general') + ' waste');
    res.redirect('/school/green-campus/waste');
  }));

  // ====================================================================
  //  ROUTE 5 - WATER USAGE
  // ====================================================================
  app.get('/school/green-campus/water', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    var meterFilter = req.query.meter_id || '';

    let pIdx = 1;
    var whereClause = 'WHERE wr.tenant_id = $$' + pIdx++;
    var wparams = [tid];
    if (meterFilter) { whereClause += ' AND wr.meter_id = $$' + pIdx++; wparams.push(meterFilter); }

    const { rows: readings } = await pool.query(
      'SELECT wr.* FROM water_readings wr ' + whereClause + ' ORDER BY wr.recorded_at DESC LIMIT 50', wparams
    );

    const { rows: monthlyData } = await pool.query(
      'SELECT DATE_FORMAT(recorded_at,\'%b %Y\') AS label, SUM(value) AS value FROM water_readings WHERE tenant_id = $1 AND recorded_at >= NOW() - INTERVAL \'12 MONTH\' GROUP BY DATE_FORMAT(recorded_at,\'%Y-%m\') ORDER BY MIN(recorded_at) LIMIT 12', [tid]
    );

    const { rows: meters } = await pool.query(
      'SELECT DISTINCT meter_id FROM water_readings WHERE tenant_id = $1 ORDER BY meter_id', [tid]
    );

    const html = SKIP;
    html += '<div style="margin-bottom:20px;overflow-x:auto">';
    navTabs('water').forEach(function (t) {
      html += '<a href="' + t.href + '" class="nav-tab' + (t.active ? ' active' : '') + '">' + t.label + '</a>';
    });
    html += '</div>';
    html += '<h2 style="color:#1f2937">&#128167; Water Usage Tracking</h2>';

    // Add reading
    html += '<div class="card"><h3 style="color:#1f2937">Record Water Reading</h3>';
    html += '<form method="post" action="/school/green-campus/water/add" style="display:flex;gap:12px;flex-wrap:wrap;align-items:end">';
    html += '<div style="flex:1;min-width:140px"><label>Meter ID</label><input name="meter_id" required placeholder="e.g. WTR-001"></div>';
    html += '<div style="flex:1;min-width:100px"><label>Value (litres)</label><input type="number" step="0.01" name="value" required></div>';
    html += '<div style="flex:1;min-width:140px"><label>Date/Time</label><input type="datetime-local" name="recorded_at" value="' + nowStr() + '"></div>';
    html += '<div><button class="btn" type="submit">+ Add</button></div>';
    html += '</form></div>';

    // Filter
    if (meters.length > 1) {
      html += '<div class="card" style="padding:10px"><form method="get"><select name="meter_id"><option value="">All Meters</option>';
      meters.forEach(function (m) { html += '<option value="' + esc(m.meter_id) + '"' + (meterFilter === m.meter_id ? ' selected' : '') + '>' + esc(m.meter_id) + '</option>'; });
      html += '</select><button class="btn" type="submit" style="margin-left:8px">Filter</button></form></div>';
    }

    // Chart
    html += '<div class="card"><h3 style="color:#1f2937">Monthly Water Consumption</h3>';
    html += svgLineChart(monthlyData, 700, 200, '#0ea5e9');
    html += '</div>';

    // Table
    html += '<div class="card"><h3 style="color:#1f2937">Recent Readings</h3>';
    if (readings.length) {
      html += '<table><tr><th>Meter</th><th>Value (L)</th><th>Recorded</th><th>Notes</th></tr>';
      readings.forEach(function (r) {
        html += '<tr><td>' + esc(r.meter_id) + '</td><td>' + r.value + '</td><td>' + esc(r.recorded_at) + '</td><td>' + esc(r.notes || '-') + '</td></tr>';
      });
      html += '</table>';
    } else {
      html += '<p style="color:' + GRAY + ';text-align:center">No water readings yet.</p>';
    }
    html += '</div>';

    // Water conservation tips
    html += '<div class="card"><h3 style="color:#1f2937">&#128161; Water Conservation Tips</h3>';
    html += '<ul style="padding-left:20px;color:#374151">';
    html += '<li>Fix leaky taps and pipes promptly</li>';
    html += '<li>Install water-efficient fixtures in restrooms</li>';
    html += '<li>Use rainwater harvesting for garden irrigation</li>';
    html += '<li>Monitor meter readings weekly to detect anomalies</li>';
    html += '<li>Educate students on water-saving practices</li>';
    html += '</ul></div>';

    renderPage(req, res, 'raw', { html: html, title: 'Water Usage Tracking' });
  }));

  app.post('/school/green-campus/water/add', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    var b = req.body;
    if (!b.meter_id || !b.value) { return res.redirect('/school/green-campus/water'); }
    await pool.query(
      'INSERT INTO water_readings (tenant_id, meter_id, value, unit, recorded_at, notes) VALUES ($1,$2,$3,$4,$5,$6)',
      [tid, b.meter_id, parseFloat(b.value) || 0, b.unit || 'litres', b.recorded_at || nowStr(), b.notes || '']
    );
    audit(req, 'water_reading_add', 'Added water reading for meter ' + b.meter_id);
    res.redirect('/school/green-campus/water');
  }));

  // ====================================================================
  //  ROUTE 6 - GREEN CHALLENGES
  // ====================================================================
  app.get('/school/green-campus/challenges', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;

    const { rows: challenges } = await pool.query(
      'SELECT gc.*, u.display_name AS creator_name FROM green_challenges gc LEFT JOIN users u ON u.id = gc.created_by WHERE gc.tenant_id = $1 ORDER BY gc.created_at DESC', [tid]
    );

    const html = SKIP;
    html += '<div style="margin-bottom:20px;overflow-x:auto">';
    navTabs('challenges').forEach(function (t) {
      html += '<a href="' + t.href + '" class="nav-tab' + (t.active ? ' active' : '') + '">' + t.label + '</a>';
    });
    html += '</div>';
    html += '<h2 style="color:#1f2937">&#127942; Green Challenges & Competitions</h2>';
    html += '<div class="card" style="text-align:right"><a href="/school/green-campus/challenges/create" class="btn">+ New Challenge</a></div>';

    if (challenges.length) {
      challenges.forEach(function (c) {
        var parts = c.participants ? (typeof c.participants === 'string' ? JSON.parse(c.participants) : c.participants) : [];
        var isJoined = parts.indexOf(uid) !== -1;
        var statusCls = c.status === 'active' ? 'badge-green' : c.status === 'completed' ? 'badge-blue' : c.status === 'cancelled' ? 'badge-red' : 'badge-yellow';
        var daysLeft = Math.max(0, Math.ceil((new Date(c.end_date) - new Date()) / 86400000));

        html += '<div class="card" style="border-left:4px solid ' + (c.status === 'active' ? '#16a34a' : '#d1d5db') + '">';
        html += '<div style="display:flex;justify-content:space-between;align-items:start;flex-wrap:wrap">';
        html += '<div>';
        html += '<h3 style="color:#1f2937;margin:0 0 4px">' + esc(c.title) + '</h3>';
        html += '<span class="badge ' + statusCls + '">' + esc(c.status) + '</span> ';
        html += '<span style="color:' + GRAY + ';font-size:13px">By ' + esc(c.creator_name || '-') + ' | ' + esc(c.start_date) + ' to ' + esc(c.end_date) + '</span>';
        if (c.status === 'active') {
          html += ' <span class="badge badge-blue">' + daysLeft + ' days left</span>';
        }
        html += '<p style="color:#374151;margin-top:8px">' + esc(c.description || '') + '</p>';
        html += '<span class="badge badge-green">' + (parts.length || 0) + ' participants</span> | Metric: ' + esc(c.metric || 'points');
        html += '</div>';
        if (c.status === 'active') {
          html += '<div style="display:flex;gap:8px">';
          if (!isJoined) {
            html += '<form method="post" action="/school/green-campus/challenges/' + c.id + '/join"><button class="btn">Join Challenge</button></form>';
          } else {
            html += '<form method="post" action="/school/green-campus/challenges/' + c.id + '/leave"><button class="btn-outline">Leave</button></form>';
          }
          html += '</div>';
        }
        html += '</div></div>';
      });
    } else {
      html += '<div class="card" style="text-align:center;padding:40px;color:' + GRAY + '">No challenges yet. <a href="/school/green-campus/challenges/create" style="color:#16a34a">Create one</a></div>';
    }

    renderPage(req, res, 'raw', { html: html, title: 'Green Challenges' });
  }));

  app.get('/school/green-campus/challenges/create', requireAuth, ah(async function (req, res) {
    const html = SKIP;
    html += '<h2 style="color:#1f2937">Create Green Challenge</h2>';
    html += '<div class="card"><form method="post" action="/school/green-campus/challenges/create">';
    html += '<div class="form-row"><div><label>Title *</label><input name="title" required></div>';
    html += '<div><label>Metric</label><select name="metric"><option value="points">Points</option><option value="hours">Volunteer Hours</option><option value="kg_waste">Kg Waste Reduced</option><option value="trees">Trees Planted</option><option value="energy_saved">Energy Saved (kWh)</option></select></div></div>';
    html += '<div style="margin-bottom:12px"><label>Description</label><textarea name="description" rows="3"></textarea></div>';
    html += '<div class="form-row"><div><label>Start Date *</label><input type="date" name="start_date" value="' + todayStr() + '" required></div>';
    html += '<div><label>End Date *</label><input type="date" name="end_date" required></div></div>';
    html += '<button type="submit" class="btn">Create Challenge</button> <a href="/school/green-campus/challenges" class="btn-outline">Cancel</a>';
    html += '</form></div>';
    renderPage(req, res, 'raw', { html: html, title: 'Create Challenge' });
  }));

  app.post('/school/green-campus/challenges/create', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    var b = req.body;
    if (!b.title || !b.start_date || !b.end_date) { return res.redirect('/school/green-campus/challenges/create'); }
    await pool.query(
      'INSERT INTO green_challenges (tenant_id, title, description, start_date, end_date, metric, created_by, status, participants) VALUES ($1,$2,$3,$4,$5,$6,' + req.session.user.id + ',\'active\',\'[]\')',
      [tid, b.title, b.description || '', b.start_date, b.end_date, b.metric || 'points']
    );
    audit(req, 'green_challenge_create', 'Created challenge: ' + b.title);
    res.redirect('/school/green-campus/challenges');
  }));

  app.post('/school/green-campus/challenges/:id/join', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    var chId = parseInt(req.params.id, 10);
    const { rows } = await pool.query('SELECT participants FROM green_challenges WHERE tenant_id = $1 AND id = $2', [tid, chId]);
    if (!rows.length) { return res.redirect('/school/green-campus/challenges'); }
    var parts = rows[0].participants ? (typeof rows[0].participants === 'string' ? JSON.parse(rows[0].participants) : rows[0].participants) : [];
    if (parts.indexOf(uid) === -1) { parts.push(uid); }
    await pool.query('UPDATE green_challenges SET participants = $1 WHERE tenant_id = $2 AND id = $3', [JSON.stringify(parts), tid, chId]);
    audit(req, 'green_challenge_join', 'Joined challenge ' + chId);
    res.redirect('/school/green-campus/challenges');
  }));

  app.post('/school/green-campus/challenges/:id/leave', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    var chId = parseInt(req.params.id, 10);
    const { rows } = await pool.query('SELECT participants FROM green_challenges WHERE tenant_id = $1 AND id = $2', [tid, chId]);
    if (!rows.length) { return res.redirect('/school/green-campus/challenges'); }
    var parts = rows[0].participants ? (typeof rows[0].participants === 'string' ? JSON.parse(rows[0].participants) : rows[0].participants) : [];
    parts = parts.filter(function (p) { return p !== uid; });
    await pool.query('UPDATE green_challenges SET participants = $1 WHERE tenant_id = $2 AND id = $3', [JSON.stringify(parts), tid, chId]);
    res.redirect('/school/green-campus/challenges');
  }));

  // ====================================================================
  //  ROUTE 7 - TREE PLANTING
  // ====================================================================
  app.get('/school/green-campus/trees', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;

    const { rows: trees } = await pool.query(
      'SELECT tp.*, u.display_name AS planted_by_name FROM tree_planting tp LEFT JOIN users u ON u.id = tp.planted_by WHERE tp.tenant_id = $1 ORDER BY tp.planted_at DESC', [tid]
    );

    const { rows: summary } = await pool.query(
      'SELECT status, SUM(quantity) AS total, SUM(co2_offset_kg) AS co2 FROM tree_planting WHERE tenant_id = $1 GROUP BY status', [tid]
    );

    const html = SKIP;
    html += '<div style="margin-bottom:20px;overflow-x:auto">';
    navTabs('trees').forEach(function (t) {
      html += '<a href="' + t.href + '" class="nav-tab' + (t.active ? ' active' : '') + '">' + t.label + '</a>';
    });
    html += '</div>';
    html += '<h2 style="color:#1f2937">&#127794; Tree Planting Tracker</h2>';

    // Summary
    var totalTrees = 0, totalCO2 = 0;
    if (summary.length) {
      html += '<div class="stat-grid">';
      summary.forEach(function (s) {
        totalTrees += s.total;
        totalCO2 += s.co2;
        var statusCls = s.status === 'planted' || s.status === 'growing' || s.status === 'mature' ? 'badge-green' : 'badge-yellow';
        html += '<div class="kpi"><div class="val">' + s.total + '</div><div class="lbl">' + esc(s.status) + ' trees</div></div>';
      });
      html += '<div class="kpi"><div class="val">' + totalCO2.toFixed(0) + '</div><div class="lbl">Total CO\u2082 Offset (kg)</div></div>';
      html += '</div>';
    }

    // Add tree form
    html += '<div class="card"><h3 style="color:#1f2937">Record Tree Planting</h3>';
    html += '<form method="post" action="/school/green-campus/trees/add" style="display:flex;gap:12px;flex-wrap:wrap;align-items:end">';
    html += '<div style="flex:1;min-width:140px"><label>Species *</label><input name="species" required placeholder="e.g. Oak, Pine"></div>';
    html += '<div style="flex:1;min-width:80px"><label>Quantity</label><input type="number" name="quantity" value="1" min="1"></div>';
    html += '<div style="flex:1;min-width:140px"><label>Location</label><input name="location" placeholder="e.g. North Garden"></div>';
    html += '<div style="flex:1;min-width:100px"><label>CO\u2082 Offset (kg/tree)</label><input type="number" step="0.01" name="co2_offset_kg" value="21"></div>';
    html += '<div style="flex:1;min-width:120px"><label>Date Planted</label><input type="date" name="planted_at" value="' + todayStr() + '"></div>';
    html += '<div><button class="btn" type="submit">+ Add</button></div>';
    html += '</form></div>';

    // Trees table
    html += '<div class="card"><h3 style="color:#1f2937">All Trees</h3>';
    if (trees.length) {
      html += '<table><tr><th>Species</th><th>Quantity</th><th>Location</th><th>Status</th><th>CO\u2082 Offset</th><th>Planted</th><th>Planted By</th></tr>';
      trees.forEach(function (t) {
        var sCls = t.status === 'mature' ? 'badge-green' : t.status === 'planted' || t.status === 'growing' ? 'badge-blue' : t.status === 'diseased' || t.status === 'removed' ? 'badge-red' : 'badge-yellow';
        html += '<tr><td>' + esc(t.species) + '</td><td>' + t.quantity + '</td><td>' + esc(t.location || '-') + '</td>';
        html += '<td><span class="badge ' + sCls + '">' + esc(t.status) + '</span></td>';
        html += '<td>' + Number(t.co2_offset_kg).toFixed(1) + ' kg</td><td>' + esc(t.planted_at) + '</td><td>' + esc(t.planted_by_name || '-') + '</td></tr>';
      });
      html += '</table>';
    } else {
      html += '<p style="color:' + GRAY + ';text-align:center">No trees recorded yet. Start planting!</p>';
    }
    html += '</div>';

    renderPage(req, res, 'raw', { html: html, title: 'Tree Planting Tracker' });
  }));

  app.post('/school/green-campus/trees/add', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    var b = req.body;
    if (!b.species) { return res.redirect('/school/green-campus/trees'); }
    var qty = parseInt(b.quantity, 10) || 1;
    var co2PerTree = parseFloat(b.co2_offset_kg) || 21;
    await pool.query(
      'INSERT INTO tree_planting (tenant_id, species, quantity, location, planted_by, planted_at, status, co2_offset_kg, notes) VALUES ($1,$2,$3,$4,$5,$6,\'planted\',$7,$8)',
      [tid, b.species, qty, b.location || '', req.session.user.id, b.planted_at || todayStr(), co2PerTree * qty, b.notes || '']
    );
    audit(req, 'tree_planting_add', 'Recorded ' + qty + ' ' + b.species + ' trees');
    res.redirect('/school/green-campus/trees');
  }));

  app.post('/school/green-campus/trees/:id/update', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    var treeId = parseInt(req.params.id, 10);
    await pool.query(
      'UPDATE tree_planting SET status = $1, survival_rate = $2, notes = $3 WHERE tenant_id = $4 AND id = $5',
      [req.body.status || 'planted', parseFloat(req.body.survival_rate) || 100, req.body.notes || '', tid, treeId]
    );
    audit(req, 'tree_planting_update', 'Updated tree record ' + treeId);
    res.redirect('/school/green-campus/trees');
  }));

  // ====================================================================
  //  ROUTE 8 - REPORTS
  // ====================================================================
  app.get('/school/green-campus/reports', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    var month = req.query.month || monthStr();

    var startDate = month + '-01';
    const { rows: energyData } = await pool.query(
      'SELECT reading_type, SUM(value) AS total, SUM(cost) AS total_cost FROM energy_readings WHERE tenant_id = $1 AND recorded_at >= $2 AND recorded_at < ($3::date + INTERVAL \'1 MONTH\') GROUP BY reading_type', [tid, startDate, startDate]
    );
    const { rows: wasteData } = await pool.query(
      'SELECT waste_type, SUM(weight_kg) AS total FROM waste_records WHERE tenant_id = $1 AND recorded_at >= $2 AND recorded_at < ($3::date + INTERVAL \'1 MONTH\') GROUP BY waste_type', [tid, startDate, startDate]
    );
    const { rows: waterData } = await pool.query(
      'SELECT SUM(value) AS total FROM water_readings WHERE tenant_id = $1 AND recorded_at >= $2 AND recorded_at < ($3::date + INTERVAL \'1 MONTH\')', [tid, startDate, startDate]
    );
    const { rows: treeData } = await pool.query(
      'SELECT SUM(quantity) AS new_trees, SUM(co2_offset_kg) AS new_co2 FROM tree_planting WHERE tenant_id = $1 AND planted_at >= $2 AND planted_at < ($3::date + INTERVAL \'1 MONTH\')', [tid, startDate, startDate]
    );
    const { rows: initData } = await pool.query(
      'SELECT COUNT(*) AS total, SUM(CASE WHEN status=\'completed\' THEN 1 ELSE 0 END) AS completed, SUM(CASE WHEN status=\'active\' THEN 1 ELSE 0 END) AS active FROM green_initiatives WHERE tenant_id = $1', [tid]
    );

    const html = SKIP;
    html += '<div style="margin-bottom:20px;overflow-x:auto">';
    navTabs('reports').forEach(function (t) {
      html += '<a href="' + t.href + '" class="nav-tab' + (t.active ? ' active' : '') + '">' + t.label + '</a>';
    });
    html += '</div>';
    html += '<h2 style="color:#1f2937">&#128202; Monthly Sustainability Report</h2>';

    // Month selector
    html += '<div class="card" style="padding:12px"><form method="get"><label style="font-weight:600;margin-right:8px">Report Month:</label>';
    html += '<input type="month" name="month" value="' + esc(month) + '" style="width:auto">';
    html += '<button class="btn" type="submit" style="margin-left:8px">Generate</button></form></div>';

    html += '<div class="card" style="background:linear-gradient(135deg,#f0fdf4,#dcfce7);border:1px solid #bbf7d0">';
    html += '<h3 style="color:#166534">Sustainability Report - ' + esc(month) + '</h3>';

    // Energy summary
    html += '<h4 style="color:#1f2937;margin-top:16px">&#9889; Energy</h4>';
    if (energyData.length) {
      html += '<table><tr><th>Type</th><th>Consumption</th><th>Cost</th></tr>';
      energyData.forEach(function (e) {
        html += '<tr><td>' + esc(e.reading_type) + '</td><td>' + Number(e.total).toFixed(1) + ' kWh</td><td>$' + Number(e.total_cost).toFixed(2) + '</td></tr>';
      });
      html += '</table>';
    } else {
      html += '<p style="color:' + GRAY + '">No energy data for this month.</p>';
    }

    // Waste summary
    html += '<h4 style="color:#1f2937;margin-top:16px">&#9851; Waste</h4>';
    if (wasteData.length) {
      var totalWaste = 0, recycledWaste = 0;
      html += '<table><tr><th>Type</th><th>Weight (kg)</th></tr>';
      wasteData.forEach(function (w) {
        totalWaste += w.total;
        if (w.waste_type === 'recyclable') recycledWaste += w.total;
        html += '<tr><td>' + esc(w.waste_type) + '</td><td>' + Number(w.total).toFixed(1) + '</td></tr>';
      });
      html += '</table>';
      html += '<p>Recycling rate: <strong>' + (totalWaste > 0 ? ((recycledWaste / totalWaste) * 100).toFixed(1) : 0) + '%</strong></p>';
    } else {
      html += '<p style="color:' + GRAY + '">No waste data for this month.</p>';
    }

    // Water summary
    html += '<h4 style="color:#1f2937;margin-top:16px">&#128167; Water</h4>';
    var wd = waterData[0] || {};
    html += '<p>Total consumption: <strong>' + Number(wd.total || 0).toFixed(1) + ' litres</strong></p>';

    // Trees summary
    html += '<h4 style="color:#1f2937;margin-top:16px">&#127794; Trees</h4>';
    var td = treeData[0] || {};
    html += '<p>New trees planted: <strong>' + (td.new_trees || 0) + '</strong> | CO\u2082 offset: <strong>' + Number(td.new_co2 || 0).toFixed(1) + ' kg</strong></p>';

    // Initiatives summary
    html += '<h4 style="color:#1f2937;margin-top:16px">&#127793; Initiatives</h4>';
    var ind = initData[0] || {};
    html += '<p>Total: ' + (ind.total || 0) + ' | Active: ' + (ind.active || 0) + ' | Completed: ' + (ind.completed || 0) + '</p>';

    html += '<hr style="margin:16px 0;border-color:#bbf7d0">';
    html += '<p style="font-size:12px;color:#6b7280">Generated on ' + nowStr() + '</p>';
    html += '</div>';

    renderPage(req, res, 'raw', { html: html, title: 'Sustainability Report' });
  }));

  // ====================================================================
  //  ROUTE 9 - EDUCATION RESOURCES
  // ====================================================================
  app.get('/school/green-campus/education', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;

    const html = SKIP;
    html += '<div style="margin-bottom:20px;overflow-x:auto">';
    navTabs('education').forEach(function (t) {
      html += '<a href="' + t.href + '" class="nav-tab' + (t.active ? ' active' : '') + '">' + t.label + '</a>';
    });
    html += '</div>';
    html += '<h2 style="color:#1f2937">&#128218; Environmental Education Resources</h2>';

    // Curriculum resources
    var resources = [
      { title: 'Understanding Climate Change', category: 'Climate', level: 'All Levels', desc: 'Interactive lesson plans about greenhouse gases, global warming, and their effects on ecosystems.', icon: '&#127777;' },
      { title: 'Recycling 101', category: 'Waste', level: 'Elementary', desc: 'Hands-on activities teaching students how to sort waste, understand recycling symbols, and reduce landfill.', icon: '&#9851;' },
      { title: 'Energy Conservation at School', category: 'Energy', level: 'Middle School', desc: 'Audit your classroom energy use and create action plans to reduce consumption.', icon: '&#9889;' },
      { title: 'Water Cycle & Conservation', category: 'Water', level: 'Elementary', desc: 'Experiments and activities demonstrating the water cycle and practical conservation methods.', icon: '&#128167;' },
      { title: 'Biodiversity in Your Schoolyard', category: 'Biodiversity', level: 'All Levels', desc: 'Species identification guides and habitat surveys for school grounds.', icon: '&#127793;' },
      { title: 'Carbon Footprint Calculator Activity', category: 'Carbon', level: 'High School', desc: 'Students calculate their personal and school carbon footprint using real data.', icon: '&#127807;' },
      { title: 'Sustainable Agriculture', category: 'Food', level: 'Middle School', desc: 'School garden project guide covering composting, seasonal planting, and organic methods.', icon: '&#127806;' },
      { title: 'Ocean & Marine Conservation', category: 'Marine', level: 'All Levels', desc: 'Explore ocean ecosystems, plastic pollution, and marine protection efforts.', icon: '&#127754;' },
      { title: 'Renewable Energy Technologies', category: 'Energy', level: 'High School', desc: 'Deep dive into solar, wind, hydro, and geothermal energy with build projects.', icon: '&#9728;' },
      { title: 'Environmental Policy & Advocacy', category: 'Social', level: 'High School', desc: 'Guide to understanding environmental legislation and how students can advocate for change.', icon: '&#128221;' },
      { title: 'Zero-Waste Challenge Guide', category: 'Waste', level: 'All Levels', desc: 'Step-by-step guide to running a school-wide zero-waste challenge.', icon: '&#127942;' },
      { title: 'Urban Ecology', category: 'Biodiversity', level: 'High School', desc: 'Study how cities function as ecosystems and design greener urban spaces.', icon: '&#127961;' },
    ];

    html += '<div class="stat-grid">';
    resources.forEach(function (r) {
      html += '<div class="card" style="margin-bottom:0">';
      html += '<div style="font-size:28px;margin-bottom:8px">' + r.icon + '</div>';
      html += '<h4 style="color:#1f2937;margin:0 0 4px">' + esc(r.title) + '</h4>';
      html += '<div style="margin-bottom:8px"><span class="badge badge-green">' + esc(r.category) + '</span> <span class="badge badge-blue">' + esc(r.level) + '</span></div>';
      html += '<p style="color:' + GRAY + ';font-size:13px;margin:0">' + esc(r.desc) + '</p>';
      html += '</div>';
    });
    html += '</div>';

    // External links
    html += '<div class="card" style="margin-top:16px"><h3 style="color:#1f2937">&#127760; External Resources</h3>';
    html += '<ul style="padding-left:20px">';
    var extLinks = [
      { name: 'NASA Climate Kids', url: 'https://climatekids.nasa.gov/', desc: 'Fun activities and games about climate change' },
      { name: 'EPA Student Resources', url: 'https://www.epa.gov/students', desc: 'Environmental protection learning materials' },
      { name: 'National Geographic Education', url: 'https://education.nationalgeographic.org/', desc: 'Explorer-minded resources for classrooms' },
      { name: 'UNESCO Education for Sustainable Development', url: 'https://en.unesco.org/themes/education-sustainable-development', desc: 'Global sustainability education framework' },
      { name: 'WWF Free Resources', url: 'https://www.wwf.org.uk/learn/resources', desc: 'Wildlife and nature conservation teaching materials' },
    ];
    extLinks.forEach(function (l) {
      html += '<li style="margin-bottom:8px"><a href="' + esc(l.url) + '" target="_blank" style="color:#16a34a;font-weight:600">' + esc(l.name) + '</a> - ' + esc(l.desc) + '</li>';
    });
    html += '</ul></div>';

    renderPage(req, res, 'raw', { html: html, title: 'Environmental Education' });
  }));

  // ====================================================================
  //  ROUTE 10 - ECO CLUBS
  // ====================================================================
  app.get('/school/green-campus/clubs', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;

    const { rows: clubs } = await pool.query(
      'SELECT ec.*, u1.display_name AS president_name, u2.display_name AS advisor_name FROM eco_clubs ec LEFT JOIN users u1 ON u1.id = ec.president_id LEFT JOIN users u2 ON u2.id = ec.teacher_advisor_id WHERE ec.tenant_id = $1 ORDER BY ec.name ASC', [tid]
    );

    const html = SKIP;
    html += '<div style="margin-bottom:20px;overflow-x:auto">';
    navTabs('clubs').forEach(function (t) {
      html += '<a href="' + t.href + '" class="nav-tab' + (t.active ? ' active' : '') + '">' + t.label + '</a>';
    });
    html += '</div>';
    html += '<h2 style="color:#1f2937">&#127793; Eco Clubs</h2>';
    html += '<div class="card" style="text-align:right"><a href="/school/green-campus/clubs/create" class="btn">+ New Club</a></div>';

    if (clubs.length) {
      clubs.forEach(function (c) {
        var statusCls = c.status === 'active' ? 'badge-green' : c.status === 'inactive' ? 'badge-yellow' : 'badge-red';
        html += '<div class="card" style="border-left:4px solid ' + (c.status === 'active' ? '#16a34a' : '#d1d5db') + '">';
        html += '<h3 style="color:#1f2937;margin:0 0 4px">' + esc(c.name) + ' <span class="badge ' + statusCls + '">' + esc(c.status) + '</span></h3>';
        html += '<p style="color:#374151">' + esc(c.description || '') + '</p>';
        html += '<div style="margin-top:8px;color:' + GRAY + ';font-size:13px">';
        html += 'President: ' + esc(c.president_name || '-') + ' | Advisor: ' + esc(c.advisor_name || '-');
        html += ' | Members: <strong>' + (c.member_count || 0) + '</strong>';
        if (c.meeting_schedule) html += ' | Schedule: ' + esc(c.meeting_schedule);
        html += '</div></div>';
      });
    } else {
      html += '<div class="card" style="text-align:center;padding:40px;color:' + GRAY + '">No eco clubs yet. <a href="/school/green-campus/clubs/create" style="color:#16a34a">Start one</a></div>';
    }

    renderPage(req, res, 'raw', { html: html, title: 'Eco Clubs' });
  }));

  app.get('/school/green-campus/clubs/create', requireAuth, ah(async function (req, res) {
    const html = SKIP;
    html += '<h2 style="color:#1f2937">Create Eco Club</h2>';
    html += '<div class="card"><form method="post" action="/school/green-campus/clubs/create">';
    html += '<div class="form-row"><div><label>Club Name *</label><input name="name" required></div>';
    html += '<div><label>Meeting Schedule</label><input name="meeting_schedule" placeholder="e.g. Every Wednesday 3pm"></div></div>';
    html += '<div style="margin-bottom:12px"><label>Description</label><textarea name="description" rows="3"></textarea></div>';
    html += '<div class="form-row"><div><label>President (User ID)</label><input type="number" name="president_id"></div>';
    html += '<div><label>Teacher Advisor (User ID)</label><input type="number" name="teacher_advisor_id"></div></div>';
    html += '<button type="submit" class="btn">Create Club</button> <a href="/school/green-campus/clubs" class="btn-outline">Cancel</a>';
    html += '</form></div>';
    renderPage(req, res, 'raw', { html: html, title: 'Create Eco Club' });
  }));

  app.post('/school/green-campus/clubs/create', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    var b = req.body;
    if (!b.name) { return res.redirect('/school/green-campus/clubs/create'); }
    await pool.query(
      'INSERT INTO eco_clubs (tenant_id, name, description, president_id, teacher_advisor_id, meeting_schedule, member_count, status) VALUES ($1,$2,$3,$4,$5,$6,' + (parseInt(b.member_count, 10) || 0) + ',\'active\')',
      [tid, b.name, b.description || '', b.president_id || null, b.teacher_advisor_id || null, b.meeting_schedule || '']
    );
    audit(req, 'eco_club_create', 'Created eco club: ' + b.name);
    res.redirect('/school/green-campus/clubs');
  }));

  app.post('/school/green-campus/clubs/:id/delete', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    await pool.query('DELETE FROM eco_clubs WHERE tenant_id = $1 AND id = $2', [tid, parseInt(req.params.id, 10)]);
    audit(req, 'eco_club_delete', 'Deleted eco club ' + req.params.id);
    res.redirect('/school/green-campus/clubs');
  }));

  // ====================================================================
  //  ROUTE 11 - CARBON FOOTPRINT CALCULATOR
  // ====================================================================
  app.get('/school/green-campus/carbon', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;

    // Get last 12 months aggregated data
    const { rows: energyCO2 } = await pool.query(
      'SELECT SUM(value) AS total_kwh FROM energy_readings WHERE tenant_id = $1 AND reading_type=\'electricity\' AND recorded_at >= NOW() - INTERVAL \'12 MONTH\'', [tid]
    );
    const { rows: gasCO2 } = await pool.query(
      'SELECT SUM(value) AS total_m3 FROM energy_readings WHERE tenant_id = $1 AND reading_type=\'gas\' AND recorded_at >= NOW() - INTERVAL \'12 MONTH\'', [tid]
    );
    const { rows: wasteCO2 } = await pool.query(
      'SELECT disposal_method, SUM(weight_kg) AS total_kg FROM waste_records WHERE tenant_id = $1 AND recorded_at >= NOW() - INTERVAL \'12 MONTH\' GROUP BY disposal_method', [tid]
    );
    const { rows: treeOffset } = await pool.query(
      'SELECT SUM(co2_offset_kg) AS total_offset FROM tree_planting WHERE tenant_id = $1 AND status IN (\'planted\',\'growing\',\'mature\')', [tid]
    );

    // Emission factors (kg CO2 per unit)
    var elecFactor = 0.42;  // kg CO2 per kWh
    var gasFactor = 2.0;    // kg CO2 per m3
    var wasteFactors = { 'landfill': 0.60, 'incinerated': 0.30, 'recycled': 0.05, 'composted': 0.02, 'specialized': 0.15 };

    var elecEmissions = Number((energyCO2[0] && energyCO2[0].total_kwh) || 0) * elecFactor;
    var gasEmissions = Number((gasCO2[0] && gasCO2[0].total_m3) || 0) * gasFactor;
    var wasteEmissions = 0;
    if (wasteCO2.length) {
      wasteCO2.forEach(function (w) {
        wasteEmissions += w.total_kg * (wasteFactors[w.disposal_method] || 0.3);
      });
    }
    var offsetTotal = Number((treeOffset[0] && treeOffset[0].total_offset) || 0);
    var grossEmissions = elecEmissions + gasEmissions + wasteEmissions;
    var netEmissions = Math.max(0, grossEmissions - offsetTotal);

    var level = netEmissions < 5000 ? 'excellent' : netEmissions < 15000 ? 'good' : netEmissions < 30000 ? 'moderate' : 'poor';

    const html = SKIP;
    html += '<div style="margin-bottom:20px;overflow-x:auto">';
    navTabs('carbon').forEach(function (t) {
      html += '<a href="' + t.href + '" class="nav-tab' + (t.active ? ' active' : '') + '">' + t.label + '</a>';
    });
    html += '</div>';
    html += '<h2 style="color:#1f2937">&#127807; Carbon Footprint Calculator</h2>';
    html += '<p style="color:' + GRAY + '">Estimated annual CO\u2082 emissions based on your energy, waste, and offset data (last 12 months).</p>';

    // Results card
    html += '<div class="card" style="background:linear-gradient(135deg,#f0fdf4,#dcfce7);border:1px solid #bbf7d0;text-align:center;padding:30px">';
    html += '<h3 style="color:#166534">Net Carbon Footprint</h3>';
    html += '<div style="font-size:48px;font-weight:700;color:#16a34a;margin:16px 0">' + Number(netEmissions).toFixed(0) + '</div>';
    html += '<div style="font-size:18px;color:#6b7280">kg CO\u2082 per year</div>';
    html += '<div style="margin-top:12px">Rating: ' + carbonBadge(level) + '</div>';
    html += '</div>';

    // Breakdown
    html += '<div class="card"><h3 style="color:#1f2937">Emission Breakdown</h3>';
    html += '<div class="stat-grid">';
    html += '<div class="kpi"><div class="val">' + Number(elecEmissions).toFixed(0) + '</div><div class="lbl">Electricity (kg CO\u2082)</div></div>';
    html += '<div class="kpi"><div class="val">' + Number(gasEmissions).toFixed(0) + '</div><div class="lbl">Gas (kg CO\u2082)</div></div>';
    html += '<div class="kpi"><div class="val">' + Number(wasteEmissions).toFixed(0) + '</div><div class="lbl">Waste (kg CO\u2082)</div></div>';
    html += '<div class="kpi"><div class="val" style="color:#16a34a">-' + Number(offsetTotal).toFixed(0) + '</div><div class="lbl">Tree Offsets (kg CO\u2082)</div></div>';
    html += '</div>';

    // Chart
    var breakdownData = [
      { label: 'Electricity', value: elecEmissions },
      { label: 'Gas', value: gasEmissions },
      { label: 'Waste', value: wasteEmissions },
      { label: 'Tree Offset', value: -offsetTotal },
    ];
    html += svgBarChart(breakdownData.map(function (d) { return { label: d.label, value: Math.abs(d.value) }; }), 600, 200, '#16a34a');
    html += '</div>';

    // Reduction tips
    html += '<div class="card"><h3 style="color:#1f2937">&#128161; Reduction Strategies</h3>';
    html += '<div class="stat-grid">';
    html += '<div class="card" style="margin-bottom:0"><h4 style="color:#16a34a">&#9889; Energy</h4><ul style="padding-left:16px;font-size:13px"><li>Switch to LED lighting</li><li>Install solar panels</li><li>Improve insulation</li><li>Use smart thermostats</li></ul></div>';
    html += '<div class="card" style="margin-bottom:0"><h4 style="color:#92400e">&#9851; Waste</h4><ul style="padding-left:16px;font-size:13px"><li>Increase recycling rates</li><li>Start composting program</li><li>Reduce single-use items</li><li>Paperless initiatives</li></ul></div>';
    html += '<div class="card" style="margin-bottom:0"><h4 style="color:#166534">&#127794; Offsets</h4><ul style="padding-left:16px;font-size:13px"><li>Plant more trees</li><li>Support reforestation</li><li>Maintain green spaces</li><li>Create biodiversity areas</li></ul></div>';
    html += '</div></div>';

    renderPage(req, res, 'raw', { html: html, title: 'Carbon Footprint Calculator' });
  }));

  // ====================================================================
  //  ROUTE 12 - CERTIFICATIONS
  // ====================================================================
  app.get('/school/green-campus/certifications', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;

    const { rows: certs } = await pool.query(
      'SELECT * FROM green_certifications WHERE tenant_id = $1 ORDER BY achieved_date DESC', [tid]
    );

    const html = SKIP;
    html += '<div style="margin-bottom:20px;overflow-x:auto">';
    navTabs('certifications').forEach(function (t) {
      html += '<a href="' + t.href + '" class="nav-tab' + (t.active ? ' active' : '') + '">' + t.label + '</a>';
    });
    html += '</div>';
    html += '<h2 style="color:#1f2937">&#127941; Green Certifications</h2>';
    html += '<div class="card" style="text-align:right"><a href="/school/green-campus/certifications/create" class="btn">+ Add Certification</a></div>';

    if (certs.length) {
      certs.forEach(function (c) {
        var statusCls = c.status === 'achieved' ? 'badge-green' : c.status === 'pending' ? 'badge-yellow' : c.status === 'expired' ? 'badge-red' : 'badge-blue';
        html += '<div class="card" style="border-left:4px solid ' + (c.status === 'achieved' ? '#16a34a' : '#d1d5db') + '">';
        html += '<h3 style="color:#1f2937;margin:0 0 4px">' + esc(c.cert_name) + ' <span class="badge ' + statusCls + '">' + esc(c.status) + '</span></h3>';
        html += '<div style="color:' + GRAY + ';font-size:13px">';
        html += 'Issuing Body: ' + esc(c.issuing_body || '-') + ' | Level: ' + esc(c.cert_level || '-');
        if (c.achieved_date) html += ' | Achieved: ' + esc(c.achieved_date);
        if (c.expiry_date) html += ' | Expires: ' + esc(c.expiry_date);
        if (c.audit_score > 0) html += ' | Audit Score: <strong>' + c.audit_score + '%</strong>';
        html += '</div>';
        if (c.notes) html += '<p style="color:#374151;margin-top:8px;font-size:13px">' + esc(c.notes) + '</p>';
        html += '</div>';
      });
    } else {
      html += '<div class="card" style="text-align:center;padding:40px;color:' + GRAY + '">No certifications tracked yet.</div>';
    }

    renderPage(req, res, 'raw', { html: html, title: 'Green Certifications' });
  }));

  app.get('/school/green-campus/certifications/create', requireAuth, ah(async function (req, res) {
    const html = SKIP;
    html += '<h2 style="color:#1f2937">Add Green Certification</h2>';
    html += '<div class="card"><form method="post" action="/school/green-campus/certifications/create">';
    html += '<div class="form-row"><div><label>Certification Name *</label><input name="cert_name" required placeholder="e.g. Green Flag Award"></div>';
    html += '<div><label>Issuing Body</label><input name="issuing_body" placeholder="e.g. Eco-Schools"></div></div>';
    html += '<div class="form-row"><div><label>Certification Level</label><input name="cert_level" placeholder="e.g. Bronze, Silver, Gold"></div>';
    html += '<div><label>Audit Score (%)</label><input type="number" step="0.01" min="0" max="100" name="audit_score" value="0"></div></div>';
    html += '<div class="form-row"><div><label>Achieved Date</label><input type="date" name="achieved_date"></div>';
    html += '<div><label>Expiry Date</label><input type="date" name="expiry_date"></div></div>';
    html += '<div class="form-row"><div><label>Status</label><select name="status"><option value="pending">Pending</option><option value="achieved">Achieved</option><option value="expired">Expired</option><option value="renewed">Renewed</option></select></div></div>';
    html += '<div style="margin-bottom:12px"><label>Notes</label><textarea name="notes" rows="2"></textarea></div>';
    html += '<button type="submit" class="btn">Add Certification</button> <a href="/school/green-campus/certifications" class="btn-outline">Cancel</a>';
    html += '</form></div>';
    renderPage(req, res, 'raw', { html: html, title: 'Add Certification' });
  }));

  app.post('/school/green-campus/certifications/create', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    var b = req.body;
    if (!b.cert_name) { return res.redirect('/school/green-campus/certifications/create'); }
    await pool.query(
      'INSERT INTO green_certifications (tenant_id, cert_name, issuing_body, cert_level, achieved_date, expiry_date, status, audit_score, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [tid, b.cert_name, b.issuing_body || '', b.cert_level || '', b.achieved_date || null, b.expiry_date || null, b.status || 'pending', parseFloat(b.audit_score) || 0, b.notes || '']
    );
    audit(req, 'green_certification_add', 'Added certification: ' + b.cert_name);
    res.redirect('/school/green-campus/certifications');
  }));

  app.post('/school/green-campus/certifications/:id/delete', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    await pool.query('DELETE FROM green_certifications WHERE tenant_id = $1 AND id = $2', [tid, parseInt(req.params.id, 10)]);
    audit(req, 'green_certification_delete', 'Deleted certification ' + req.params.id);
    res.redirect('/school/green-campus/certifications');
  }));

  // ====================================================================
  //  SUSTAINABILITY GOALS (sub-route under dashboard)
  // ====================================================================
  app.get('/school/green-campus/goals', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;

    const { rows: goals } = await pool.query(
      'SELECT * FROM sustainability_goals WHERE tenant_id = $1 ORDER BY deadline ASC', [tid]
    );

    const html = SKIP;
    html += '<h2 style="color:#1f2937">&#127919; Sustainability Goals</h2>';
    html += '<div class="card" style="text-align:right"><a href="/school/green-campus/goals/create" class="btn">+ New Goal</a></div>';

    if (goals.length) {
      goals.forEach(function (g) {
        var pct = g.target_value > 0 ? Math.min(100, ((g.current_value / g.target_value) * 100)).toFixed(1) : 0;
        var statusCls = g.status === 'achieved' ? 'badge-green' : g.status === 'on_track' ? 'badge-blue' : g.status === 'at_risk' ? 'badge-yellow' : 'badge-red';
        html += '<div class="card" style="border-left:4px solid ' + (g.status === 'achieved' ? '#16a34a' : g.status === 'on_track' ? '#0ea5e9' : '#f59e0b') + '">';
        html += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap">';
        html += '<div>';
        html += '<h3 style="color:#1f2937;margin:0 0 4px">' + esc(g.title) + ' <span class="badge ' + statusCls + '">' + esc(g.status) + '</span></h3>';
        html += '<p style="color:' + GRAY + ';font-size:13px">' + esc(g.description || '') + '</p>';
        html += '</div>';
        html += '<div style="text-align:right;min-width:200px">';
        html += '<div style="font-size:24px;font-weight:700;color:#16a34a">' + pct + '%</div>';
        if (g.deadline) html += '<div style="color:' + GRAY + ';font-size:12px">Deadline: ' + esc(g.deadline) + '</div>';
        html += '</div></div>';
        html += '<div class="progress-bar" style="margin-top:12px"><div class="progress-fill" style="width:' + pct + '%"></div></div>';
        html += '<div style="margin-top:8px;color:' + GRAY + ';font-size:12px">' + Number(g.current_value).toFixed(1) + ' / ' + Number(g.target_value).toFixed(1) + ' ' + esc(g.unit || '') + ' | Category: ' + esc(g.category) + '</div>';
        html += '</div>';
      });
    } else {
      html += '<div class="card" style="text-align:center;padding:40px;color:' + GRAY + '">No sustainability goals set yet.</div>';
    }

    renderPage(req, res, 'raw', { html: html, title: 'Sustainability Goals' });
  }));

  app.get('/school/green-campus/goals/create', requireAuth, ah(async function (req, res) {
    const html = SKIP;
    html += '<h2 style="color:#1f2937">Set Sustainability Goal</h2>';
    html += '<div class="card"><form method="post" action="/school/green-campus/goals/create">';
    html += '<div class="form-row"><div><label>Goal Title *</label><input name="title" required></div>';
    html += '<div><label>Category</label><select name="category"><option value="energy">Energy</option><option value="waste">Waste</option><option value="water">Water</option><option value="carbon">Carbon</option><option value="biodiversity">Biodiversity</option><option value="education">Education</option></select></div></div>';
    html += '<div style="margin-bottom:12px"><label>Description</label><textarea name="description" rows="2"></textarea></div>';
    html += '<div class="form-row"><div><label>Target Value</label><input type="number" step="0.01" name="target_value" required></div>';
    html += '<div><label>Unit</label><input name="unit" placeholder="e.g. kWh, kg, tonnes"></div>';
    html += '<div><label>Deadline</label><input type="date" name="deadline"></div></div>';
    html += '<button type="submit" class="btn">Set Goal</button> <a href="/school/green-campus/goals" class="btn-outline">Cancel</a>';
    html += '</form></div>';
    renderPage(req, res, 'raw', { html: html, title: 'Set Sustainability Goal' });
  }));

  app.post('/school/green-campus/goals/create', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    var b = req.body;
    if (!b.title) { return res.redirect('/school/green-campus/goals/create'); }
    await pool.query(
      'INSERT INTO sustainability_goals (tenant_id, title, description, category, target_value, current_value, unit, deadline, status) VALUES ($1,$2,$3,$4,$5,0,$6,$7,\'on_track\')',
      [tid, b.title, b.description || '', b.category || 'energy', parseFloat(b.target_value) || 0, b.unit || '', b.deadline || null]
    );
    audit(req, 'sustainability_goal_create', 'Created goal: ' + b.title);
    res.redirect('/school/green-campus/goals');
  }));

  app.post('/school/green-campus/goals/:id/update', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    var goalId = parseInt(req.params.id, 10);
    var newVal = parseFloat(req.body.current_value) || 0;
    var status = req.body.status || 'on_track';
    await pool.query(
      'UPDATE sustainability_goals SET current_value = $1, status = $2 WHERE tenant_id = $3 AND id = $4',
      [newVal, status, tid, goalId]
    );
    audit(req, 'sustainability_goal_update', 'Updated goal ' + goalId + ' to ' + newVal);
    res.redirect('/school/green-campus/goals');
  }));

  console.log('[GreenCampus] Module loaded - 15 routes registered');
};
