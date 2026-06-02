/**
 * Bus Route Optimizer Module
 * School SaaS Portal — Transport Management & Optimization
 *
 * Features: Route Management, Bus Fleet, Student Assignment, Stop Management,
 *           Route Optimization (clustering), Live Tracking, Trip Log,
 *           Parent Notifications, Fleet Maintenance, Analytics Dashboard
 *
 * 22 routes • PostgreSQL • tenant_id scoped
 */
const { migrateQuery } = require('./db');
module.exports = function(app, pool, opts) {

  const esc = opts.esc || (s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'));
  const renderPage = opts.renderPage || ((t,c,u) => c);
  const ah = opts.ah || ((fn) => async (req,res,next) => { try { await fn(req,res,next); } catch(e) { res.status(500).send('Error: '+e.message); }});
  const requireAuth = opts.requireAuth || ((req,res,next) => { if(!req.session?.user) return res.redirect('/login'); next(); });
  const audit = opts.audit || (() => {});

  const BASE = '/school/bus-routes';

  // ── Helpers ────────────────────────────────────────────────────────────────
  function fmtDate(d) {
    if (!d) return '—';
    try { return new Date(d).toISOString().split('T')[0]; } catch(_) { return '—'; }
  }
  function fmtDateTime(d) {
    if (!d) return '—';
    try { return new Date(d).toLocaleString(); } catch(_) { return '—'; }
  }
  function now() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }
  function pct(a, b) { return b > 0 ? ((a / b) * 100).toFixed(1) : '0.0'; }

  // ── Shared CSS (transport theme) ──────────────────────────────────────────
  const CSS = `
    .bro-wrap{max-width:1280px;margin:0 auto;font-family:'Segoe UI',system-ui,sans-serif;color:#1e293b}
    .bro-nav{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:20px;padding:12px 16px;background:#f0f9ff;border-radius:10px;border:1px solid #bae6fd}
    .bro-nav a{display:inline-block;padding:8px 16px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600;color:#0369a1;background:#e0f2fe;transition:all .15s}
    .bro-nav a:hover,.bro-nav a.active{background:#0284c7;color:#fff}
    .bro-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:24px}
    .bro-stat{background:#fff;border-radius:10px;padding:20px;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.07);border-left:4px solid #0284c7}
    .bro-stat.green{border-color:#16a34a} .bro-stat.amber{border-color:#d97706} .bro-stat.red{border-color:#dc2626} .bro-stat.purple{border-color:#7c3aed}
    .bro-stat h3{font-size:28px;margin:0;color:#0f172a} .bro-stat p{margin:4px 0 0;font-size:13px;color:#64748b}
    .bro-card{background:#fff;border-radius:10px;padding:20px;margin-bottom:20px;box-shadow:0 1px 4px rgba(0,0,0,.07)}
    .bro-card h2{margin:0 0 14px;font-size:18px;color:#0f172a} .bro-card h3{margin:0 0 12px;font-size:15px;color:#334155}
    .bro-table{width:100%;border-collapse:collapse;font-size:13px}
    .bro-table th{background:#f0f9ff;text-align:left;padding:10px 12px;font-weight:600;color:#475569;border-bottom:2px solid #bae6fd;white-space:nowrap}
    .bro-table td{padding:9px 12px;border-bottom:1px solid #f1f5f9;vertical-align:middle}
    .bro-table tr:hover{background:#f8fafc}
    .bro-btn{display:inline-block;padding:8px 18px;border-radius:6px;font-size:13px;font-weight:600;text-decoration:none;cursor:pointer;border:none;transition:all .15s}
    .bro-btn.primary{background:#0284c7;color:#fff} .bro-btn.primary:hover{background:#0369a1}
    .bro-btn.success{background:#16a34a;color:#fff} .bro-btn.success:hover{background:#15803d}
    .bro-btn.danger{background:#dc2626;color:#fff} .bro-btn.danger:hover{background:#b91c1c}
    .bro-btn.warn{background:#d97706;color:#fff} .bro-btn.warn:hover{background:#b45309}
    .bro-btn.sm{padding:5px 12px;font-size:12px} .bro-btn.outline{background:transparent;border:1px solid #cbd5e1;color:#475569}
    .bro-badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600}
    .bro-badge.green{background:#dcfce7;color:#15803d} .bro-badge.amber{background:#fef3c7;color:#92400e}
    .bro-badge.red{background:#fee2e2;color:#991b1b} .bro-badge.blue{background:#dbeafe;color:#1e40af}
    .bro-badge.gray{background:#f1f5f9;color:#64748b}
    .bro-form table{border-collapse:collapse} .bro-form td{padding:8px 12px;vertical-align:top}
    .bro-form label{display:block;font-size:12px;font-weight:600;color:#475569;margin-bottom:4px}
    .bro-form input,.bro-form select,.bro-form textarea{padding:8px 12px;border:1px solid #cbd5e1;border-radius:6px;font-size:13px;width:100%;max-width:320px;box-sizing:border-box}
    .bro-form textarea{resize:vertical;min-height:60px}
    .bro-map{width:100%;height:400px;background:#e0f2fe;border-radius:10px;display:flex;align-items:center;justify-content:center;color:#64748b;font-size:14px;position:relative;overflow:hidden}
    .bro-map::before{content:'';position:absolute;inset:0;background:repeating-linear-gradient(0deg,transparent,transparent 39px,#bae6fd 39px,#bae6fd 40px),repeating-linear-gradient(90deg,transparent,transparent 39px,#bae6fd 39px,#bae6fd 40px);opacity:.5}
    .bro-map-inner{position:relative;z-index:1;text-align:center}
    .bro-grid-2{display:grid;grid-template-columns:1fr 1fr;gap:20px}
    .bro-flex{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
    .bro-stop{display:inline-flex;align-items:center;gap:6px;padding:6px 14px;border-radius:20px;font-size:12px;font-weight:600;margin:3px}
    .bro-stop.green{background:#dcfce7;color:#15803d} .bro-stop.amber{background:#fef3c7;color:#92400e} .bro-stop.red{background:#fee2e2;color:#991b1b}
    .bro-stop.blue{background:#dbeafe;color:#1e40af} .bro-stop.gray{background:#f1f5f9;color:#64748b}
    .bro-icon{font-size:20px} .bro-muted{color:#94a3b8;font-size:12px}
    .bro-alert{padding:12px 16px;border-radius:8px;margin-bottom:14px;font-size:13px}
    .bro-alert.info{background:#dbeafe;color:#1e40af} .bro-alert.warn{background:#fef3c7;color:#92400e}
    .bro-alert.error{background:#fee2e2;color:#991b1b} .bro-alert.success{background:#dcfce7;color:#15803d}
    .bro-progress{height:8px;background:#e2e8f0;border-radius:4px;overflow:hidden;margin:4px 0}
    .bro-progress-bar{height:100%;border-radius:4px;transition:width .3s}
    .bro-tab-bar{display:flex;gap:4px;margin-bottom:16px;border-bottom:2px solid #e2e8f0;padding-bottom:0}
    .bro-tab{padding:8px 18px;font-size:13px;font-weight:600;color:#64748b;cursor:pointer;border-bottom:3px solid transparent;margin-bottom:-2px}
    .bro-tab.active{color:#0284c7;border-color:#0284c7}
  `;

  // ── Navigation bar ────────────────────────────────────────────────────────
  function nav(active) {
    const links = [
      ['Dashboard', BASE + '/'],
      ['Routes', BASE + '/routes'],
      ['Buses', BASE + '/buses'],
      ['Stops', BASE + '/stops'],
      ['Assignments', BASE + '/assign'],
      ['Optimize', BASE + '/optimize'],
      ['Tracking', BASE + '/tracking'],
      ['Trips', BASE + '/trips'],
      ['Maintenance', BASE + '/maintenance'],
      ['Analytics', BASE + '/analytics'],
      ['Settings', BASE + '/settings'],
    ];
    return '<nav class="bro-nav">' + links.map(([label, href]) =>
      `<a href="${href}" class="${active === label ? 'active' : ''}">${esc(label)}</a>`
    ).join('') + '</nav>';
  }

  // ── Bus icon SVG snippet ───────────────────────────────────────────────────
  const BUS_ICON = '<span class="bro-icon">🚌</span>';

  // ═══════════════════════════════════════════════════════════════════════════
  // DATABASE MIGRATIONS
  // ═══════════════════════════════════════════════════════════════════════════
  async function migrate() {
    // 1. bus_routes
    await migrateQuery(pool, 'BusRoute', `
      CREATE TABLE IF NOT EXISTS bus_routes (
        id SERIAL PRIMARY KEY,
        tenant_id INT NOT NULL,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        waypoints JSON,
        distance_km DECIMAL(8,2) DEFAULT 0,
        estimated_time_min INT DEFAULT 0,
        assigned_bus_id INT,
        assigned_driver_id INT,
        operating_days JSON,
        morning_departure TIME,
        afternoon_departure TIME,
        status TEXT DEFAULT 'draft',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 2. bus_fleet
    await migrateQuery(pool, 'BusRoute', `
      CREATE TABLE IF NOT EXISTS bus_fleet (
        id SERIAL PRIMARY KEY,
        tenant_id INT NOT NULL,
        registration_number VARCHAR(50) NOT NULL,
        model VARCHAR(100),
        capacity INT DEFAULT 50,
        driver_name VARCHAR(255),
        driver_phone VARCHAR(30),
        driver_license VARCHAR(50),
        insurance_expiry DATE,
        last_service_mileage INT DEFAULT 0,
        current_mileage INT DEFAULT 0,
        fuel_type TEXT DEFAULT 'diesel',
        fuel_capacity_litres INT DEFAULT 80,
        status TEXT DEFAULT 'active',
        purchase_date DATE,
        purchase_cost DECIMAL(10,2) DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uk_bf_reg_tenant UNIQUE (tenant_id, registration_number)
      )
    `);

    // 3. bus_stops
    await migrateQuery(pool, 'BusRoute', `
      CREATE TABLE IF NOT EXISTS bus_stops (
        id SERIAL PRIMARY KEY,
        tenant_id INT NOT NULL,
        name VARCHAR(255) NOT NULL,
        latitude DECIMAL(10,7) DEFAULT 0,
        longitude DECIMAL(10,7) DEFAULT 0,
        stop_type TEXT DEFAULT 'both',
        route_id INT,
        stop_order INT DEFAULT 0,
        estimated_arrival_min INT DEFAULT 0,
        estimated_departure_min INT DEFAULT 0,
        landmark VARCHAR(255),
        status TEXT DEFAULT 'active',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 4. bus_student_assignments
    await migrateQuery(pool, 'BusRoute', `
      CREATE TABLE IF NOT EXISTS bus_student_assignments (
        id SERIAL PRIMARY KEY,
        tenant_id INT NOT NULL,
        student_id INT NOT NULL,
        student_name VARCHAR(255),
        route_id INT,
        pickup_stop_id INT,
        dropoff_stop_id INT,
        pickup_time TIME,
        dropoff_time TIME,
        parent_name VARCHAR(255),
        parent_phone VARCHAR(30),
        parent_email VARCHAR(255),
        status TEXT DEFAULT 'active',
        change_request_reason TEXT,
        assigned_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 5. bus_trips
    await migrateQuery(pool, 'BusRoute', `
      CREATE TABLE IF NOT EXISTS bus_trips (
        id SERIAL PRIMARY KEY,
        tenant_id INT NOT NULL,
        route_id INT,
        bus_id INT,
        driver_name VARCHAR(255),
        trip_type TEXT DEFAULT 'morning',
        trip_date DATE NOT NULL,
        planned_departure TIMESTAMPTZ,
        actual_departure TIMESTAMPTZ,
        planned_arrival TIMESTAMPTZ,
        actual_arrival TIMESTAMPTZ,
        distance_km DECIMAL(8,2) DEFAULT 0,
        fuel_used_litres DECIMAL(6,2) DEFAULT 0,
        students_onboard INT DEFAULT 0,
        incidents TEXT,
        delay_minutes INT DEFAULT 0,
        status TEXT DEFAULT 'planned',
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 6. bus_maintenance
    await migrateQuery(pool, 'BusRoute', `
      CREATE TABLE IF NOT EXISTS bus_maintenance (
        id SERIAL PRIMARY KEY,
        tenant_id INT NOT NULL,
        bus_id INT NOT NULL,
        maintenance_type TEXT DEFAULT 'oil_change',
        description TEXT,
        scheduled_date DATE,
        completed_date DATE,
        mileage_at_service INT DEFAULT 0,
        cost DECIMAL(10,2) DEFAULT 0,
        vendor VARCHAR(255),
        status TEXT DEFAULT 'scheduled',
        next_service_mileage INT DEFAULT 0,
        next_service_date DATE,
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 7. bus_notifications_log
    await migrateQuery(pool, 'BusRoute', `
      CREATE TABLE IF NOT EXISTS bus_notifications_log (
        id SERIAL PRIMARY KEY,
        tenant_id INT NOT NULL,
        student_assignment_id INT,
        route_id INT,
        parent_phone VARCHAR(30),
        parent_email VARCHAR(255),
        notification_type TEXT DEFAULT 'general',
        message TEXT,
        sent_via TEXT DEFAULT 'in_app',
        status TEXT DEFAULT 'pending',
        sent_at TIMESTAMPTZ,
        delivered_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  // ── Run migrations ─────────────────────────────────────────────────────────
  setTimeout(() => {
  migrate().then(() => {
    console.log('[bus-route-optimizer] Migrations complete.');
  }).catch(err => {
    console.error('[bus-route-optimizer] Migration error:', err.message);
  });
  }, Math.random() * 10000);

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 1 — Dashboard
  // ═══════════════════════════════════════════════════════════════════════════
  app.get(BASE + '/', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;

    const [routesR, busesR, assignR, tripsR, maintR] = await Promise.all([
      pool.query("SELECT COUNT(*) AS c FROM bus_routes WHERE tenant_id=$1", [tid]),
      pool.query("SELECT COUNT(*) AS c FROM bus_fleet WHERE tenant_id=$1 AND status='active'", [tid]),
      pool.query("SELECT COUNT(*) AS c FROM bus_student_assignments WHERE tenant_id=$1 AND status='active'", [tid]),
      pool.query("SELECT COUNT(*) AS c FROM bus_trips WHERE tenant_id=$1 AND trip_date::date=CURRENT_DATE", [tid]),
      pool.query("SELECT COUNT(*) AS c FROM bus_maintenance WHERE tenant_id=$1 AND status='scheduled'", [tid]),
    ]);

    const routeCount = routesR[0][0].c;
    const busCount = busesR[0][0].c;
    const studentCount = assignR[0][0].c;
    const todayTrips = tripsR[0][0].c;
    const maintDue = maintR[0][0].c;

    // Recent trips
    const recentTrips = await pool.query(
      `SELECT t.*, r.name AS route_name, f.registration_number
       FROM bus_trips t
       LEFT JOIN bus_routes r ON r.id=t.route_id
       LEFT JOIN bus_fleet f ON f.id=t.bus_id
       WHERE t.tenant_id=$1 ORDER BY t.trip_date DESC LIMIT 8`, [tid]);

    // Active routes with utilization
    const routeUtil = await pool.query(
      `SELECT r.id, r.name, r.distance_km, r.estimated_time_min, r.status,
              f.registration_number, f.capacity AS bus_cap,
              (SELECT COUNT(*) FROM bus_student_assignments sa WHERE sa.route_id=r.id AND sa.status='active') AS stu_count
       FROM bus_routes r
       LEFT JOIN bus_fleet f ON f.id=r.assigned_bus_id
       WHERE r.tenant_id=$1 AND r.status='active'
       ORDER BY r.name LIMIT 10`, [tid]);

    // Upcoming maintenance
    const upcomingMaint = await pool.query(
      `SELECT m.*, f.registration_number, f.model
       FROM bus_maintenance m
       LEFT JOIN bus_fleet f ON f.id=m.bus_id
       WHERE m.tenant_id=$1 AND m.status='scheduled'
       ORDER BY m.scheduled_date ASC LIMIT 5`, [tid]);

    // Recent notifications
    const recentNotifs = await pool.query(
      `SELECT n.*, sa.student_name
       FROM bus_notifications_log n
       LEFT JOIN bus_student_assignments sa ON sa.id=n.student_assignment_id
       WHERE n.tenant_id=$1 ORDER BY n.created_at DESC LIMIT 5`, [tid]);

    let h = '<div class="bro-wrap">' + CSS + nav('Dashboard');

    // Stats
    h += '<div class="bro-stats">';
    h += `<div class="bro-stat"><h3>${routeCount}</h3><p>${BUS_ICON} Active Routes</p></div>`;
    h += `<div class="bro-stat green"><h3>${busCount}</h3><p>Active Buses</p></div>`;
    h += `<div class="bro-stat purple"><h3>${studentCount}</h3><p>Students Assigned</p></div>`;
    h += `<div class="bro-stat amber"><h3>${todayTrips}</h3><p>Today's Trips</p></div>`;
    h += `<div class="bro-stat red"><h3>${maintDue}</h3><p>Maintenance Due</p></div>`;
    h += '</div>';

    // Map placeholder
    h += '<div class="bro-map"><div class="bro-map-inner">';
    h += '<div style="font-size:48px;margin-bottom:8px">🗺️</div>';
    h += '<strong>Live Bus Map</strong><br><span class="bro-muted">GPS tracking integration — click "Tracking" for details</span>';
    h += '</div></div>';

    h += '<div class="bro-grid-2">';
    // Route utilization
    h += '<div class="bro-card"><h3>Route Utilization</h3>';
    if (routeUtil.length) {
      h += '<table class="bro-table"><tr><th>Route</th><th>Bus</th><th>Students</th><th>Fill %</th><th>Status</th></tr>';
      routeUtil.forEach(r => {
        const fillPct = pct(r.stu_count, r.bus_cap);
        const barColor = fillPct > 90 ? '#dc2626' : fillPct > 70 ? '#d97706' : '#16a34a';
        h += `<tr><td><strong>${esc(r.name)}</strong></td><td>${esc(r.registration_number || '—')}</td>`;
        h += `<td>${r.stu_count}/${r.bus_cap || '∞'}</td>`;
        h += `<td><div class="bro-progress"><div class="bro-progress-bar" style="width:${fillPct}%;background:${barColor}"></div></div>${fillPct}%</td>`;
        h += `<td><span class="bro-badge green">Active</span></td></tr>`;
      });
      h += '</table>';
    } else {
      h += '<p class="bro-muted">No active routes configured yet.</p>';
    }
    h += '</div>';

    // Upcoming maintenance
    h += '<div class="bro-card"><h3>🔧 Upcoming Maintenance</h3>';
    if (upcomingMaint.length) {
      h += '<table class="bro-table"><tr><th>Bus</th><th>Type</th><th>Date</th><th>Cost</th></tr>';
      upcomingMaint.forEach(m => {
        h += `<tr><td>${esc(m.registration_number)}<br><span class="bro-muted">${esc(m.model||'')}</span></td>`;
        h += `<td><span class="bro-badge amber">${esc(m.maintenance_type)}</span></td>`;
        h += `<td>${fmtDate(m.scheduled_date)}</td>`;
        h += `<td>$${parseFloat(m.cost||0).toFixed(2)}</td></tr>`;
      });
      h += '</table>';
    } else {
      h += '<p class="bro-muted">No scheduled maintenance.</p>';
    }
    h += '</div>';
    h += '</div>';

    // Recent trips
    h += '<div class="bro-card"><h3>📋 Recent Trips</h3>';
    if (recentTrips.length) {
      h += '<table class="bro-table"><tr><th>Date</th><th>Route</th><th>Bus</th><th>Type</th><th>Delay</th><th>Status</th></tr>';
      recentTrips.forEach(t => {
        const statusBadge = t.status === 'completed' ? 'green' : t.status === 'cancelled' ? 'red' : 'blue';
        h += `<tr><td>${fmtDate(t.trip_date)}</td><td>${esc(t.route_name || '—')}</td>`;
        h += `<td>${esc(t.registration_number || '—')}</td><td>${esc(t.trip_type)}</td>`;
        h += `<td>${t.delay_minutes > 0 ? '<span class="bro-badge red">+' + t.delay_minutes + ' min</span>' : '<span class="bro-badge green">On time</span>'}</td>`;
        h += `<td><span class="bro-badge ${statusBadge}">${esc(t.status)}</span></td></tr>`;
      });
      h += '</table>';
    } else {
      h += '<p class="bro-muted">No trips recorded yet.</p>';
    }
    h += '</div>';

    // Recent notifications
    h += '<div class="bro-card"><h3>📢 Recent Notifications</h3>';
    if (recentNotifs.length) {
      h += '<table class="bro-table"><tr><th>Time</th><th>Student</th><th>Type</th><th>Message</th><th>Status</th></tr>';
      recentNotifs.forEach(n => {
        const typeBadge = n.notification_type === 'delay' ? 'red' : n.notification_type === 'bus_arrived' ? 'green' : 'blue';
        h += `<tr><td>${fmtDateTime(n.created_at)}</td><td>${esc(n.student_name || '—')}</td>`;
        h += `<td><span class="bro-badge ${typeBadge}">${esc(n.notification_type)}</span></td>`;
        h += `<td>${esc((n.message||'').substring(0, 80))}</td>`;
        h += `<td><span class="bro-badge gray">${esc(n.status)}</span></td></tr>`;
      });
      h += '</table>';
    } else {
      h += '<p class="bro-muted">No notifications yet.</p>';
    }
    h += '</div>';

    h += '</div>';
    res.send(renderPage('Bus Route Dashboard', h, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 2 — Routes list
  // ═══════════════════════════════════════════════════════════════════════════
  app.get(BASE + '/routes', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const statusFilter = req.query.status || '';

    let sql = `SELECT r.*, f.registration_number, f.driver_name, f.capacity AS bus_cap,
               (SELECT COUNT(*) FROM bus_student_assignments sa WHERE sa.route_id=r.id AND sa.status='active') AS stu_count,
               (SELECT COUNT(*) FROM bus_stops s WHERE s.route_id=r.id AND s.status='active') AS stop_count
               FROM bus_routes r LEFT JOIN bus_fleet f ON f.id=r.assigned_bus_id
               WHERE r.tenant_id=$1`;
    const params = [tid];
    if (statusFilter) { sql += ' AND r.status=$2'; params.push(statusFilter); }
    sql += ' ORDER BY r.name';

    const routes = await pool.query(sql, params);

    let h = '<div class="bro-wrap">' + CSS + nav('Routes');
    h += '<div class="bro-flex" style="margin-bottom:16px">';
    h += '<h2 style="margin:0">Route Management</h2>';
    h += `<a href="${BASE}/routes?action=new" class="bro-btn success">+ New Route</a>`;
    h += '</div>';

    // Status filters
    const statuses = [['', 'All'], ['active', 'Active'], ['draft', 'Draft'], ['inactive', 'Inactive']];
    h += '<div class="bro-flex" style="margin-bottom:16px">';
    statuses.forEach(([val, label]) => {
      h += `<a href="${BASE}/routes?status=${val}" class="bro-btn sm ${statusFilter === val ? 'primary' : 'outline'}">${label}</a>`;
    });
    h += '</div>';

    if (routes.length) {
      h += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:16px">';
      routes.forEach(r => {
        const wp = (() => { try { return JSON.parse(r.waypoints || '[]'); } catch(_) { return []; } })();
        const days = (() => { try { return JSON.parse(r.operating_days || '[]'); } catch(_) { return []; } })();
        const statusBadge = r.status === 'active' ? 'green' : r.status === 'draft' ? 'amber' : 'gray';
        const fillPct = pct(r.stu_count, r.bus_cap);
        const barColor = fillPct > 90 ? '#dc2626' : fillPct > 70 ? '#d97706' : '#16a34a';

        h += `<div class="bro-card" style="margin:0">`;
        h += `<div class="bro-flex"><h3 style="margin:0;flex:1">${BUS_ICON} ${esc(r.name)}</h3>`;
        h += `<span class="bro-badge ${statusBadge}">${esc(r.status)}</span></div>`;
        h += `<p class="bro-muted" style="margin:4px 0">${esc(r.description || 'No description')}</p>`;
        h += `<div style="display:flex;gap:12px;font-size:12px;margin:8px 0">`;
        h += `<span>📏 ${r.distance_km || 0} km</span>`;
        h += `<span>⏱ ${r.estimated_time_min || 0} min</span>`;
        h += `<span>🛑 ${r.stop_count} stops</span>`;
        h += `<span>👤 ${r.stu_count} students</span></div>`;
        h += `<div class="bro-progress"><div class="bro-progress-bar" style="width:${fillPct}%;background:${barColor}"></div></div>`;
        h += `<span class="bro-muted">${fillPct}% capacity used</span>`;
        h += `<div style="margin:8px 0"><strong>Bus:</strong> ${esc(r.registration_number || 'Not assigned')} | <strong>Driver:</strong> ${esc(r.driver_name || 'Not assigned')}</div>`;
        h += `<div style="margin:8px 0"><strong>Days:</strong> ${days.length ? days.map(d => `<span class="bro-stop blue">${esc(d)}</span>`).join('') : '<span class="bro-muted">Not set</span>'}</div>`;
        h += `<div class="bro-flex" style="margin-top:12px">`;
        h += `<a href="${BASE}/routes?action=edit&id=${r.id}" class="bro-btn sm primary">Edit</a>`;
        h += `<a href="${BASE}/routes?action=view&id=${r.id}" class="bro-btn sm outline">View</a>`;
        h += `<a href="${BASE}/routes" class="bro-btn sm danger" onclick="return confirm('Delete route ${esc(r.name)}?')" style="float:right">Delete</a>`;
        h += `</div></div>`;
      });
      h += '</div>';
    } else {
      h += '<div class="bro-card"><p class="bro-muted">No routes found. Create your first route to get started.</p></div>';
    }

    h += '</div>';
    res.send(renderPage('Route Management', h, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 3 — Save route (create/update)
  // ═══════════════════════════════════════════════════════════════════════════
  app.post(BASE + '/routes/save', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { id, name, description, waypoints, distance_km, estimated_time_min,
            assigned_bus_id, assigned_driver_id, operating_days,
            morning_departure, afternoon_departure, status } = req.body;

    if (!name || !name.trim()) {
      return res.send('<div class="bro-alert error">Route name is required.</div><a href="javascript:history.back()">Go back</a>');
    }

    let wpParsed = [];
    try { wpParsed = JSON.parse(waypoints || '[]'); } catch (_) {
      wpParsed = [];
    }

    let daysParsed = [];
    try { daysParsed = JSON.parse(operating_days || '[]'); } catch (_) {
      // Accept comma-separated string
      daysParsed = (operating_days || '').split(',').map(s => s.trim()).filter(Boolean);
    }

    if (id) {
      await pool.query(
        `UPDATE bus_routes SET name=$1, description=$2, waypoints=$3, distance_km=$4, estimated_time_min=$5,
         assigned_bus_id=$6, assigned_driver_id=$7, operating_days=$8, morning_departure=$9, afternoon_departure=$10, status=$11
         WHERE id=$12 AND tenant_id=$13`,
        [name.trim(), description || '', JSON.stringify(wpParsed), parseFloat(distance_km) || 0,
         parseInt(estimated_time_min) || 0, assigned_bus_id || null, assigned_driver_id || null,
         JSON.stringify(daysParsed), morning_departure || null, afternoon_departure || null,
         status || 'active', parseInt(id), tid]);
      audit(req, 'bus_route_update', { routeId: id, name: name.trim() });
    } else {
      await pool.query(
        `INSERT INTO bus_routes (tenant_id, name, description, waypoints, distance_km, estimated_time_min,
         assigned_bus_id, assigned_driver_id, operating_days, morning_departure, afternoon_departure, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [tid, name.trim(), description || '', JSON.stringify(wpParsed), parseFloat(distance_km) || 0,
         parseInt(estimated_time_min) || 0, assigned_bus_id || null, assigned_driver_id || null,
         JSON.stringify(daysParsed), morning_departure || null, afternoon_departure || null,
         status || 'active']);
      audit(req, 'bus_route_create', { name: name.trim() });
    }

    res.redirect(BASE + '/routes');
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 4 — Delete route
  // ═══════════════════════════════════════════════════════════════════════════
  app.delete(BASE + '/routes/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { id } = req.params;
    await pool.query('DELETE FROM bus_routes WHERE id=$1 AND tenant_id=$2', [id, tid]);
    audit(req, 'bus_route_delete', { routeId: id });
    res.json({ ok: true });
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 5 — Bus fleet list
  // ═══════════════════════════════════════════════════════════════════════════
  app.get(BASE + '/buses', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const statusFilter = req.query.status || '';

    let sql = `SELECT f.*,
               (SELECT COUNT(*) FROM bus_routes r WHERE r.assigned_bus_id=f.id AND r.status='active') AS route_count
               FROM bus_fleet f WHERE f.tenant_id=$1`;
    const params = [tid];
    if (statusFilter) { sql += ' AND f.status=$2'; params.push(statusFilter); }
    sql += ' ORDER BY f.registration_number';

    const buses = await pool.query(sql, params);

    let h = '<div class="bro-wrap">' + CSS + nav('Buses');
    h += '<div class="bro-flex" style="margin-bottom:16px">';
    h += '<h2 style="margin:0">Bus Fleet</h2>';
    h += `<a href="${BASE}/buses?action=new" class="bro-btn success">+ Register Bus</a>`;
    h += '</div>';

    // Status filters
    const statuses = [['', 'All'], ['active', 'Active'], ['maintenance', 'Maintenance'], ['inactive', 'Inactive'], ['retired', 'Retired']];
    h += '<div class="bro-flex" style="margin-bottom:16px">';
    statuses.forEach(([val, label]) => {
      h += `<a href="${BASE}/buses?status=${val}" class="bro-btn sm ${statusFilter === val ? 'primary' : 'outline'}">${label}</a>`;
    });
    h += '</div>';

    if (buses.length) {
      h += '<table class="bro-table"><tr><th>Registration</th><th>Model</th><th>Capacity</th><th>Driver</th>';
      h += '<th>Phone</th><th>Fuel</th><th>Mileage</th><th>Insurance</th><th>Routes</th><th>Status</th><th>Actions</th></tr>';
      buses.forEach(b => {
        const statusBadge = b.status === 'active' ? 'green' : b.status === 'maintenance' ? 'amber' : b.status === 'retired' ? 'red' : 'gray';
        const insWarn = b.insurance_expiry && new Date(b.insurance_expiry) <= new Date(Date.now() + 30 * 86400000);
        h += `<tr>`;
        h += `<td><strong>${esc(b.registration_number)}</strong></td>`;
        h += `<td>${esc(b.model || '—')}</td>`;
        h += `<td>${b.capacity}</td>`;
        h += `<td>${esc(b.driver_name || '—')}</td>`;
        h += `<td>${esc(b.driver_phone || '—')}</td>`;
        h += `<td>${esc(b.fuel_type)}</td>`;
        h += `<td>${b.current_mileage.toLocaleString()} km</td>`;
        h += `<td>${insWarn ? '<span class="bro-badge red">⚠️</span> ' : ''}${fmtDate(b.insurance_expiry)}</td>`;
        h += `<td>${b.route_count}</td>`;
        h += `<td><span class="bro-badge ${statusBadge}">${esc(b.status)}</span></td>`;
        h += `<td><a href="${BASE}/buses?action=edit&id=${b.id}" class="bro-btn sm primary">Edit</a></td>`;
        h += `</tr>`;
      });
      h += '</table>';
    } else {
      h += '<div class="bro-card"><p class="bro-muted">No buses registered yet.</p></div>';
    }

    h += '</div>';
    res.send(renderPage('Bus Fleet', h, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 6 — Save bus (create/update)
  // ═══════════════════════════════════════════════════════════════════════════
  app.post(BASE + '/buses/save', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { id, registration_number, model, capacity, driver_name, driver_phone, driver_license,
            insurance_expiry, current_mileage, fuel_type, fuel_capacity_litres,
            status, purchase_date, purchase_cost } = req.body;

    if (!registration_number || !registration_number.trim()) {
      return res.send('<div class="bro-alert error">Registration number is required.</div><a href="javascript:history.back()">Go back</a>');
    }

    if (id) {
      await pool.query(
        `UPDATE bus_fleet SET registration_number=$1, model=$2, capacity=$3, driver_name=$4, driver_phone=$5,
         driver_license=$6, insurance_expiry=$7, current_mileage=$8, fuel_type=$9, fuel_capacity_litres=$10,
         status=$11, purchase_date=$12, purchase_cost=$13
         WHERE id=$14 AND tenant_id=$15`,
        [registration_number.trim(), model || '', parseInt(capacity) || 50, driver_name || '', driver_phone || '',
         driver_license || '', insurance_expiry || null, parseInt(current_mileage) || 0,
         fuel_type || 'diesel', parseInt(fuel_capacity_litres) || 80, status || 'active',
         purchase_date || null, parseFloat(purchase_cost) || 0, parseInt(id), tid]);
      audit(req, 'bus_update', { busId: id });
    } else {
      // Check duplicate
      const dup = await pool.query('SELECT id FROM bus_fleet WHERE tenant_id=$1 AND registration_number=$2', [tid, registration_number.trim()]);
      if (dup.length) {
        return res.send('<div class="bro-alert warn">A bus with this registration number already exists.</div><a href="javascript:history.back()">Go back</a>');
      }
      await pool.query(
        `INSERT INTO bus_fleet (tenant_id, registration_number, model, capacity, driver_name, driver_phone,
         driver_license, insurance_expiry, current_mileage, fuel_type, fuel_capacity_litres,
         status, purchase_date, purchase_cost)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [tid, registration_number.trim(), model || '', parseInt(capacity) || 50, driver_name || '',
         driver_phone || '', driver_license || '', insurance_expiry || null,
         parseInt(current_mileage) || 0, fuel_type || 'diesel', parseInt(fuel_capacity_litres) || 80,
         status || 'active', purchase_date || null, parseFloat(purchase_cost) || 0]);
      audit(req, 'bus_create', { registration: registration_number.trim() });
    }

    res.redirect(BASE + '/buses');
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 7 — Delete bus
  // ═══════════════════════════════════════════════════════════════════════════
  app.delete(BASE + '/buses/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { id } = req.params;
    await pool.query('DELETE FROM bus_fleet WHERE id=$1 AND tenant_id=$2', [id, tid]);
    audit(req, 'bus_delete', { busId: id });
    res.json({ ok: true });
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 8 — Stops list
  // ═══════════════════════════════════════════════════════════════════════════
  app.get(BASE + '/stops', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const routeFilter = req.query.route_id || '';

    let sql = `SELECT s.*, r.name AS route_name
               FROM bus_stops s LEFT JOIN bus_routes r ON r.id=s.route_id
               WHERE s.tenant_id=$1`;
    const params = [tid];
    if (routeFilter) { sql += ' AND s.route_id=$2'; params.push(parseInt(routeFilter)); }
    sql += ' ORDER BY s.route_id, s.stop_order';

    const stops = await pool.query(sql, params);
    const routes = await pool.query('SELECT id, name FROM bus_routes WHERE tenant_id=$1 AND status=\'active\' ORDER BY name', [tid]);

    let h = '<div class="bro-wrap">' + CSS + nav('Stops');
    h += '<div class="bro-flex" style="margin-bottom:16px">';
    h += '<h2 style="margin:0">Stop Management</h2>';
    h += `<a href="${BASE}/stops?action=new" class="bro-btn success">+ Add Stop</a>`;
    h += '</div>';

    // Route filter
    h += '<div class="bro-flex" style="margin-bottom:16px">';
    h += `<select onchange="location.href='${BASE}/stops?route_id='+this.value" style="padding:8px;border:1px solid #cbd5e1;border-radius:6px;font-size:13px">`;
    h += '<option value="">All Routes</option>';
    routes.forEach(r => {
      h += `<option value="${r.id}" ${routeFilter === String(r.id) ? 'selected' : ''}>${esc(r.name)}</option>`;
    });
    h += '</select></div>';

    // Stops grouped by route with color coding
    const grouped = {};
    stops.forEach(s => {
      const key = s.route_id || 0;
      if (!grouped[key]) grouped[key] = { route_name: s.route_name || 'Unassigned', stops: [] };
      grouped[key].stops.push(s);
    });

    Object.values(grouped).forEach(group => {
      h += `<div class="bro-card"><h3>📍 ${esc(group.route_name)} (${group.stops.length} stops)</h3>`;
      h += '<table class="bro-table"><tr><th>Order</th><th>Name</th><th>Type</th><th>Lat</th><th>Lng</th>';
      h += '<th>ETA</th><th>Landmark</th><th>Status</th><th>Actions</th></tr>';
      group.stops.forEach(s => {
        // Color code by time status
        const timeStatus = s.estimated_arrival_min <= 15 ? 'green' : s.estimated_arrival_min <= 30 ? 'amber' : 'red';
        h += `<tr>`;
        h += `<td><span class="bro-stop blue">#${s.stop_order}</span></td>`;
        h += `<td><strong>${esc(s.name)}</strong></td>`;
        h += `<td><span class="bro-badge ${s.stop_type === 'pickup' ? 'blue' : s.stop_type === 'dropoff' ? 'amber' : 'green'}">${esc(s.stop_type)}</span></td>`;
        h += `<td>${s.latitude}</td><td>${s.longitude}</td>`;
        h += `<td><span class="bro-stop ${timeStatus}">${s.estimated_arrival_min} min</span></td>`;
        h += `<td>${esc(s.landmark || '—')}</td>`;
        h += `<td><span class="bro-badge ${s.status === 'active' ? 'green' : 'gray'}">${esc(s.status)}</span></td>`;
        h += `<td><a href="${BASE}/stops?action=edit&id=${s.id}" class="bro-btn sm primary">Edit</a></td>`;
        h += `</tr>`;
      });
      h += '</table></div>';
    });

    if (!stops.length) {
      h += '<div class="bro-card"><p class="bro-muted">No stops configured yet.</p></div>';
    }

    h += '</div>';
    res.send(renderPage('Stop Management', h, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 9 — Save stop (create/update)
  // ═══════════════════════════════════════════════════════════════════════════
  app.post(BASE + '/stops/save', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { id, name, latitude, longitude, stop_type, route_id, stop_order,
            estimated_arrival_min, estimated_departure_min, landmark, status } = req.body;

    if (!name || !name.trim()) {
      return res.send('<div class="bro-alert error">Stop name is required.</div><a href="javascript:history.back()">Go back</a>');
    }

    if (id) {
      await pool.query(
        `UPDATE bus_stops SET name=$1, latitude=$2, longitude=$3, stop_type=$4, route_id=$5, stop_order=$6,
         estimated_arrival_min=$7, estimated_departure_min=$8, landmark=$9, status=$10
         WHERE id=$11 AND tenant_id=$12`,
        [name.trim(), parseFloat(latitude) || 0, parseFloat(longitude) || 0,
         stop_type || 'both', route_id || null, parseInt(stop_order) || 0,
         parseInt(estimated_arrival_min) || 0, parseInt(estimated_departure_min) || 0,
         landmark || '', status || 'active', parseInt(id), tid]);
      audit(req, 'bus_stop_update', { stopId: id });
    } else {
      await pool.query(
        `INSERT INTO bus_stops (tenant_id, name, latitude, longitude, stop_type, route_id, stop_order,
         estimated_arrival_min, estimated_departure_min, landmark, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [tid, name.trim(), parseFloat(latitude) || 0, parseFloat(longitude) || 0,
         stop_type || 'both', route_id || null, parseInt(stop_order) || 0,
         parseInt(estimated_arrival_min) || 0, parseInt(estimated_departure_min) || 0,
         landmark || '', status || 'active']);
      audit(req, 'bus_stop_create', { name: name.trim() });
    }

    res.redirect(BASE + '/stops');
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 10 — Delete stop
  // ═══════════════════════════════════════════════════════════════════════════
  app.delete(BASE + '/stops/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { id } = req.params;
    await pool.query('DELETE FROM bus_stops WHERE id=$1 AND tenant_id=$2', [id, tid]);
    audit(req, 'bus_stop_delete', { stopId: id });
    res.json({ ok: true });
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 11 — Student assignments list
  // ═══════════════════════════════════════════════════════════════════════════
  app.get(BASE + '/assign', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const routeFilter = req.query.route_id || '';
    const statusFilter = req.query.status || '';

    let sql = `SELECT sa.*, r.name AS route_name, ps.name AS pickup_name, ds.name AS dropoff_name
               FROM bus_student_assignments sa
               LEFT JOIN bus_routes r ON r.id=sa.route_id
               LEFT JOIN bus_stops ps ON ps.id=sa.pickup_stop_id
               LEFT JOIN bus_stops ds ON ds.id=sa.dropoff_stop_id
               WHERE sa.tenant_id=$1`;
    const params = [tid];
    if (routeFilter) { sql += ' AND sa.route_id=$2'; params.push(parseInt(routeFilter)); }
    if (statusFilter) { sql += ' AND sa.status=$3'; params.push(statusFilter); }
    sql += ' ORDER BY sa.route_id, sa.student_name';

    const assignments = await pool.query(sql, params);
    const routes = await pool.query('SELECT id, name FROM bus_routes WHERE tenant_id=$1 AND status=\'active\' ORDER BY name', [tid]);

    let h = '<div class="bro-wrap">' + CSS + nav('Assignments');
    h += '<div class="bro-flex" style="margin-bottom:16px">';
    h += '<h2 style="margin:0">Student Assignments</h2>';
    h += `<a href="${BASE}/assign?action=new" class="bro-btn success">+ Assign Student</a>`;
    h += `<a href="${BASE}/assign?action=bulk" class="bro-btn primary">Bulk Assign</a>`;
    h += '</div>';

    // Filters
    h += '<div class="bro-flex" style="margin-bottom:16px">';
    h += `<select onchange="location.href='${BASE}/assign?route_id='+this.value+'&status=${statusFilter}'" style="padding:8px;border:1px solid #cbd5e1;border-radius:6px;font-size:13px">`;
    h += '<option value="">All Routes</option>';
    routes.forEach(r => { h += `<option value="${r.id}" ${routeFilter === String(r.id) ? 'selected' : ''}>${esc(r.name)}</option>`; });
    h += '</select>';
    const statuses = [['', 'All'], ['active', 'Active'], ['change_requested', 'Change Requested'], ['transferred', 'Transferred']];
    statuses.forEach(([val, label]) => {
      h += `<a href="${BASE}/assign?status=${val}&route_id=${routeFilter}" class="bro-btn sm ${statusFilter === val ? 'primary' : 'outline'}">${label}</a>`;
    });
    h += '</div>';

    if (assignments.length) {
      h += '<table class="bro-table"><tr><th>Student</th><th>Route</th><th>Pickup</th><th>Dropoff</th>';
      h += '<th>Pickup Time</th><th>Parent</th><th>Phone</th><th>Status</th><th>Actions</th></tr>';
      assignments.forEach(a => {
        const statusBadge = a.status === 'active' ? 'green' : a.status === 'change_requested' ? 'amber' : 'gray';
        h += `<tr>`;
        h += `<td><strong>${esc(a.student_name)}</strong><br><span class="bro-muted">ID: ${a.student_id}</span></td>`;
        h += `<td>${esc(a.route_name || '—')}</td>`;
        h += `<td><span class="bro-stop green">🟢 ${esc(a.pickup_name || '—')}</span></td>`;
        h += `<td><span class="bro-stop amber">🟡 ${esc(a.dropoff_name || '—')}</span></td>`;
        h += `<td>${a.pickup_time || '—'}</td>`;
        h += `<td>${esc(a.parent_name || '—')}</td>`;
        h += `<td>${esc(a.parent_phone || '—')}</td>`;
        h += `<td><span class="bro-badge ${statusBadge}">${esc(a.status)}</span></td>`;
        h += `<td><a href="${BASE}/assign?action=edit&id=${a.id}" class="bro-btn sm primary">Edit</a></td>`;
        h += `</tr>`;
      });
      h += '</table>';
    } else {
      h += '<div class="bro-card"><p class="bro-muted">No student assignments found.</p></div>';
    }

    h += '</div>';
    res.send(renderPage('Student Assignments', h, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 12 — Save assignment (create/update)
  // ═══════════════════════════════════════════════════════════════════════════
  app.post(BASE + '/assign/save', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { id, student_id, student_name, route_id, pickup_stop_id, dropoff_stop_id,
            pickup_time, dropoff_time, parent_name, parent_phone, parent_email,
            status, change_request_reason } = req.body;

    if (!student_id || !route_id) {
      return res.send('<div class="bro-alert error">Student ID and Route are required.</div><a href="javascript:history.back()">Go back</a>');
    }

    if (id) {
      await pool.query(
        `UPDATE bus_student_assignments SET student_id=$1, student_name=$2, route_id=$3, pickup_stop_id=$4,
         dropoff_stop_id=$5, pickup_time=$6, dropoff_time=$7, parent_name=$8, parent_phone=$9, parent_email=$10,
         status=$11, change_request_reason=$12
         WHERE id=$13 AND tenant_id=$14`,
        [student_id, student_name || '', parseInt(route_id), pickup_stop_id || null,
         dropoff_stop_id || null, pickup_time || null, dropoff_time || null,
         parent_name || '', parent_phone || '', parent_email || '',
         status || 'active', change_request_reason || '', parseInt(id), tid]);
      audit(req, 'assignment_update', { assignmentId: id });
    } else {
      // Check for duplicate
      const dup = await pool.query(
        'SELECT id FROM bus_student_assignments WHERE tenant_id=$1 AND student_id=$2 AND route_id=$3 AND status=\'active\'',
        [tid, student_id, parseInt(route_id)]);
      if (dup.length) {
        return res.send('<div class="bro-alert warn">Student is already assigned to this route.</div><a href="javascript:history.back()">Go back</a>');
      }
      await pool.query(
        `INSERT INTO bus_student_assignments (tenant_id, student_id, student_name, route_id, pickup_stop_id,
         dropoff_stop_id, pickup_time, dropoff_time, parent_name, parent_phone, parent_email, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [tid, student_id, student_name || '', parseInt(route_id), pickup_stop_id || null,
         dropoff_stop_id || null, pickup_time || null, dropoff_time || null,
         parent_name || '', parent_phone || '', parent_email || '', status || 'active']);
      audit(req, 'assignment_create', { studentId: student_id, routeId: route_id });
    }

    res.redirect(BASE + '/assign');
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 13 — Bulk assign students
  // ═══════════════════════════════════════════════════════════════════════════
  app.post(BASE + '/assign/bulk', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { route_id, bulk_data } = req.body;

    if (!route_id || !bulk_data) {
      return res.send('<div class="bro-alert error">Route and student data are required.</div><a href="javascript:history.back()">Go back</a>');
    }

    let students = [];
    try {
      students = JSON.parse(bulk_data);
    } catch (_) {
      // Parse line-by-line format: student_id, student_name, parent_name, parent_phone
      students = bulk_data.split('\n').filter(Boolean).map(line => {
        const parts = line.split(',').map(s => s.trim());
        return {
          student_id: parts[0] || '',
          student_name: parts[1] || '',
          parent_name: parts[2] || '',
          parent_phone: parts[3] || '',
        };
      });
    }

    let added = 0, skipped = 0;
    for (const s of students) {
      if (!s.student_id) { skipped++; continue; }
      const dup = await pool.query(
        'SELECT id FROM bus_student_assignments WHERE tenant_id=$1 AND student_id=$2 AND route_id=$3 AND status=\'active\'',
        [tid, s.student_id, parseInt(route_id)]);
      if (dup.length) { skipped++; continue; }
      await pool.query(
        `INSERT INTO bus_student_assignments (tenant_id, student_id, student_name, route_id, parent_name, parent_phone, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [tid, s.student_id, s.student_name || '', parseInt(route_id), s.parent_name || '', s.parent_phone || '', 'active']);
      added++;
    }

    audit(req, 'assignment_bulk', { routeId: route_id, added, skipped });
    res.redirect(BASE + '/assign');
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 14 — Route optimization page
  // ═══════════════════════════════════════════════════════════════════════════
  app.get(BASE + '/optimize', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;

    // Get unassigned students
    const unassigned = await pool.query(
      `SELECT sa.*, ps.name AS nearest_stop, ps.latitude, ps.longitude
       FROM bus_student_assignments sa
       LEFT JOIN bus_stops ps ON ps.id=sa.pickup_stop_id
       WHERE sa.tenant_id=$1 AND (sa.route_id IS NULL OR sa.route_id=0) AND sa.status='active'`, [tid]);

    const activeRoutes = await pool.query(
      `SELECT r.*, f.registration_number, f.capacity
       FROM bus_routes r LEFT JOIN bus_fleet f ON f.id=r.assigned_bus_id
       WHERE r.tenant_id=$1 AND r.status='active'`, [tid]);

    const allStops = await pool.query(
      'SELECT * FROM bus_stops WHERE tenant_id=$1 AND status=\'active\' ORDER BY route_id, stop_order', [tid]);

    let h = '<div class="bro-wrap">' + CSS + nav('Optimize');
    h += '<h2 style="margin-bottom:16px">🧠 Route Optimization</h2>';

    h += '<div class="bro-stats">';
    h += `<div class="bro-stat amber"><h3>${unassigned.length}</h3><p>Unassigned Students</p></div>`;
    h += `<div class="bro-stat green"><h3>${activeRoutes.length}</h3><p>Active Routes</p></div>`;
    h += `<div class="bro-stat"><h3>${allStops.length}</h3><p>Total Stops</p></div>`;
    h += '</div>';

    h += '<div class="bro-grid-2">';

    // Optimization controls
    h += '<div class="bro-card"><h3>Optimization Settings</h3>';
    h += `<form method="POST" action="${BASE}/optimize/run" class="bro-form">`;
    h += '<table>';
    h += `<tr><td><label>Algorithm</label></td><td>
      <select name="algorithm">
        <option value="cluster">Area Clustering</option>
        <option value="nearest_stop">Nearest Stop Assignment</option>
        <option value="capacity_balance">Capacity Balancing</option>
      </select></td></tr>`;
    h += `<tr><td><label>Max Students per Route</label></td><td><input type="number" name="max_per_route" value="40" min="1" max="100"></td></tr>`;
    h += `<tr><td><label>Max Route Distance (km)</label></td><td><input type="number" name="max_distance" value="30" min="1" step="0.5"></td></tr>`;
    h += `<tr><td><label>Prioritize</label></td><td>
      <select name="priority">
        <option value="distance">Minimize Distance</option>
        <option value="balance">Balance Capacity</option>
        <option value="time">Minimize Time</option>
      </select></td></tr>`;
    h += '</table>';
    h += `<button type="submit" class="bro-btn primary" style="margin-top:12px">▶ Run Optimization</button>`;
    h += '</form></div>';

    // Unassigned students
    h += '<div class="bro-card"><h3>Unassigned Students</h3>';
    if (unassigned.length) {
      h += '<table class="bro-table"><tr><th>Student</th><th>ID</th><th>Nearest Stop</th><th>Coords</th></tr>';
      unassigned.forEach(s => {
        h += `<tr><td>${esc(s.student_name || '—')}</td><td>${s.student_id}</td>`;
        h += `<td>${esc(s.nearest_stop || '—')}</td>`;
        h += `<td>${s.latitude || '—'}, ${s.longitude || '—'}</td></tr>`;
      });
      h += '</table>';
    } else {
      h += '<p class="bro-muted">All students are assigned to routes.</p>';
    }
    h += '</div>';
    h += '</div>';

    // Current route distribution
    h += '<div class="bro-card"><h3>Current Route Distribution</h3>';
    if (activeRoutes.length) {
      h += '<table class="bro-table"><tr><th>Route</th><th>Bus</th><th>Capacity</th><th>Assigned</th><th>Available</th><th>Utilization</th></tr>';
      for (const r of activeRoutes) {
        const cntR = await pool.query(
          'SELECT COUNT(*) AS c FROM bus_student_assignments WHERE tenant_id=$1 AND route_id=$2 AND status=\'active\'',
          [tid, r.id]);
        const assigned = cntR[0][0].c;
        const available = (r.capacity || 50) - assigned;
        const util = pct(assigned, r.capacity || 50);
        const barColor = util > 90 ? '#dc2626' : util > 70 ? '#d97706' : '#16a34a';
        h += `<tr><td><strong>${esc(r.name)}</strong></td>`;
        h += `<td>${esc(r.registration_number || '—')}</td>`;
        h += `<td>${r.capacity || 50}</td>`;
        h += `<td>${assigned}</td>`;
        h += `<td style="color:${available < 5 ? '#dc2626' : '#16a34a'}">${available}</td>`;
        h += `<td><div class="bro-progress" style="width:120px"><div class="bro-progress-bar" style="width:${util}%;background:${barColor}"></div></div> ${util}%</td></tr>`;
      }
      h += '</table>';
    } else {
      h += '<p class="bro-muted">No active routes to analyze.</p>';
    }
    h += '</div>';

    h += '</div>';
    res.send(renderPage('Route Optimization', h, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 15 — Run optimization algorithm
  // ═══════════════════════════════════════════════════════════════════════════
  app.post(BASE + '/optimize/run', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { algorithm, max_per_route, max_distance, priority } = req.body;

    const maxPerRoute = parseInt(max_per_route) || 40;
    const maxDist = parseFloat(max_distance) || 30;
    const algo = algorithm || 'cluster';

    // Get all students needing assignment (active without route)
    const students = await pool.query(
      `SELECT * FROM bus_student_assignments
       WHERE tenant_id=$1 AND status='active' AND (route_id IS NULL OR route_id=0)`, [tid]);

    if (!students.length) {
      return res.redirect(BASE + '/optimize');
    }

    // Get active routes with capacity info
    const routes = await pool.query(
      `SELECT r.*, f.capacity, (SELECT COUNT(*) FROM bus_student_assignments sa
        WHERE sa.route_id=r.id AND sa.status='active') AS current_count
       FROM bus_routes r
       LEFT JOIN bus_fleet f ON f.id=r.assigned_bus_id
       WHERE r.tenant_id=$1 AND r.status='active' AND f.id IS NOT NULL`, [tid]);

    if (!routes.length) {
      return res.send('<div class="bro-alert warn">No active routes with assigned buses. Create routes and assign buses first.</div><a href="javascript:history.back()">Go back</a>');
    }

    // Get all stops with coordinates
    const stops = await pool.query(
      'SELECT * FROM bus_stops WHERE tenant_id=$1 AND status=\'active\' AND latitude != 0 AND longitude != 0', [tid]);

    let assignments = 0;
    const routeCapacities = {};
    routes.forEach(r => {
      routeCapacities[r.id] = { max: r.capacity || 50, current: r.current_count || 0 };
    });

    // Simple clustering: group students by nearest stop, assign to route
    if (algo === 'cluster' || algo === 'nearest_stop') {
      // Build stop lookup by route
      const stopsByRoute = {};
      stops.forEach(s => {
        if (s.route_id) {
          if (!stopsByRoute[s.route_id]) stopsByRoute[s.route_id] = [];
          stopsByRoute[s.route_id].push(s);
        }
      });

      for (const student of students) {
        // Try to find the best route based on priority
        let bestRoute = null;
        let bestScore = Infinity;

        for (const route of routes) {
          const cap = routeCapacities[route.id];
          if (cap.current >= cap.max) continue; // Skip full routes

          let score = 0;

          if (algo === 'nearest_stop') {
            // Find nearest stop on this route
            const routeStops = stopsByRoute[route.id] || [];
            let minDist = Infinity;
            for (const stop of routeStops) {
              const dist = Math.sqrt(
                Math.pow((stop.latitude || 0) - 0, 2) +
                Math.pow((stop.longitude || 0) - 0, 2)
              );
              if (dist < minDist) minDist = dist;
            }
            score = minDist;
          } else {
            // Clustering: prefer routes with more available capacity
            const availRatio = (cap.max - cap.current) / cap.max;
            score = route.distance_km || 0;
            if (priority === 'balance') {
              score = -availRatio * 100; // Negative so higher availability = lower score
            } else if (priority === 'time') {
              score = route.estimated_time_min || 0;
            }
          }

          if (score < bestScore) {
            bestScore = score;
            bestRoute = route;
          }
        }

        if (bestRoute) {
          // Find nearest stop on the chosen route
          const routeStops = stopsByRoute[bestRoute.id] || [];
          let nearestStop = routeStops[0] || null;

          // Assign student to route
          await pool.query(
            'UPDATE bus_student_assignments SET route_id=$1, pickup_stop_id=$2, status=\'active\' WHERE id=$3 AND tenant_id=$4',
            [bestRoute.id, nearestStop ? nearestStop.id : null, student.id, tid]);
          routeCapacities[bestRoute.id].current++;
          assignments++;
        }
      }
    } else if (algo === 'capacity_balance') {
      // Sort students by ID for deterministic assignment
      const sorted = [...students].sort((a, b) => a.student_id - b.student_id);

      for (const student of sorted) {
        // Find route with most available capacity
        let bestRoute = null;
        let bestAvail = -1;

        for (const route of routes) {
          const cap = routeCapacities[route.id];
          const avail = cap.max - cap.current;
          if (avail > 0 && avail > bestAvail) {
            bestAvail = avail;
            bestRoute = route;
          }
        }

        if (bestRoute) {
          await pool.query(
            'UPDATE bus_student_assignments SET route_id=$1 WHERE id=$2 AND tenant_id=$3',
            [bestRoute.id, student.id, tid]);
          routeCapacities[bestRoute.id].current++;
          assignments++;
        }
      }
    }

    audit(req, 'optimization_run', { algorithm: algo, assignments, students: students.length });

    // Redirect with result
    let h = '<div class="bro-wrap">' + CSS + nav('Optimize');
    h += '<div class="bro-card">';
    h += '<h2>✅ Optimization Complete</h2>';
    h += '<div class="bro-alert success">';
    h += `<strong>${algorithm}</strong> algorithm assigned <strong>${assignments}</strong> of <strong>${students.length}</strong> students.`;
    h += '</div>';
    h += `<a href="${BASE}/assign" class="bro-btn primary">View Assignments</a>`;
    h += `<a href="${BASE}/optimize" class="bro-btn outline" style="margin-left:8px">Run Again</a>`;
    h += '</div></div>';

    res.send(renderPage('Optimization Result', h, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 16 — Live tracking page
  // ═══════════════════════════════════════════════════════════════════════════
  app.get(BASE + '/tracking', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;

    const activeRoutes = await pool.query(
      `SELECT r.*, f.registration_number, f.driver_name, f.driver_phone, f.capacity,
              (SELECT COUNT(*) FROM bus_student_assignments sa WHERE sa.route_id=r.id AND sa.status='active') AS stu_count
       FROM bus_routes r LEFT JOIN bus_fleet f ON f.id=r.assigned_bus_id
       WHERE r.tenant_id=$1 AND r.status='active' ORDER BY r.name`, [tid]);

    const inProgressTrips = await pool.query(
      `SELECT t.*, r.name AS route_name, f.registration_number
       FROM bus_trips t
       LEFT JOIN bus_routes r ON r.id=t.route_id
       LEFT JOIN bus_fleet f ON f.id=t.bus_id
       WHERE t.tenant_id=$1 AND t.status='in_progress'`, [tid]);

    // Generate simulated bus positions for display
    const busPositions = activeRoutes.map(r => {
      const wp = (() => { try { return JSON.parse(r.waypoints || '[]'); } catch(_) { return []; } })();
      const currentWp = wp.length > 0 ? wp[Math.floor(Math.random() * wp.length)] : null;
      return {
        ...r,
        simulated_lat: currentWp ? currentWp.lat : (33.7 + Math.random() * 0.1).toFixed(4),
        simulated_lng: currentWp ? currentWp.lng : (-84.4 + Math.random() * 0.1).toFixed(4),
        simulated_status: ['on_time', 'approaching', 'delayed'][Math.floor(Math.random() * 3)],
        simulated_eta: Math.floor(Math.random() * 20) + 3,
      };
    });

    let h = '<div class="bro-wrap">' + CSS + nav('Tracking');
    h += '<h2 style="margin-bottom:16px">📍 Live Bus Tracking</h2>';

    // Map placeholder
    h += '<div class="bro-map" style="height:500px"><div class="bro-map-inner">';
    h += '<div style="font-size:64px;margin-bottom:12px">🗺️</div>';
    h += '<h3 style="margin:0">GPS Map View</h3>';
    h += '<p class="bro-muted" style="max-width:400px;margin:8px auto">Integrate with Google Maps / Mapbox for real-time bus positions. Configure API key in Settings.</p>';

    // Show simulated bus markers
    h += '<div style="margin-top:20px;display:flex;flex-wrap:wrap;gap:12px;justify-content:center">';
    busPositions.forEach(bus => {
      const statusColor = bus.simulated_status === 'on_time' ? 'green' : bus.simulated_status === 'approaching' ? 'amber' : 'red';
      const statusLabel = bus.simulated_status === 'on_time' ? 'On Time' : bus.simulated_status === 'approaching' ? 'Approaching' : 'Delayed';
      h += `<div class="bro-card" style="margin:0;padding:12px;min-width:200px;border:2px solid var(--color-${statusColor}, #16a34a)">`;
      h += `<div style="font-size:24px">${BUS_ICON}</div>`;
      h += `<strong>${esc(bus.name)}</strong><br>`;
      h += `<span class="bro-muted">${esc(bus.registration_number || '')}</span><br>`;
      h += `<span class="bro-badge ${statusColor}">${statusLabel}</span>`;
      h += `<br><small class="bro-muted">ETA: ${bus.simulated_eta} min</small>`;
      h += `</div>`;
    });
    h += '</div></div></div>';

    // Active trips
    if (inProgressTrips.length) {
      h += '<div class="bro-card"><h3>🚀 Trips In Progress</h3>';
      h += '<table class="bro-table"><tr><th>Route</th><th>Bus</th><th>Type</th><th>Departed</th><th>Students</th><th>Delay</th></tr>';
      inProgressTrips.forEach(t => {
        h += `<tr><td>${esc(t.route_name || '—')}</td>`;
        h += `<td>${esc(t.registration_number || '—')}</td>`;
        h += `<td>${esc(t.trip_type)}</td>`;
        h += `<td>${fmtDateTime(t.actual_departure)}</td>`;
        h += `<td>${t.students_onboard}</td>`;
        h += `<td>${t.delay_minutes > 0 ? '<span class="bro-badge red">+' + t.delay_minutes + ' min</span>' : '<span class="bro-badge green">On time</span>'}</td></tr>`;
      });
      h += '</table></div>';
    }

    // All buses status overview
    h += '<div class="bro-card"><h3>Fleet Status Overview</h3>';
    h += '<table class="bro-table"><tr><th>Bus</th><th>Route</th><th>Driver</th><th>Students</th><th>Capacity</th><th>Status</th></tr>';
    busPositions.forEach(bus => {
      const statusColor = bus.simulated_status === 'on_time' ? 'green' : bus.simulated_status === 'approaching' ? 'amber' : 'red';
      const statusLabel = bus.simulated_status === 'on_time' ? 'On Time' : bus.simulated_status === 'approaching' ? 'Approaching' : 'Delayed';
      h += `<tr>`;
      h += `<td>${BUS_ICON} ${esc(bus.registration_number || '—')}</td>`;
      h += `<td>${esc(bus.name)}</td>`;
      h += `<td>${esc(bus.driver_name || '—')}</td>`;
      h += `<td>${bus.stu_count}</td>`;
      h += `<td>${bus.capacity}</td>`;
      h += `<td><span class="bro-badge ${statusColor}">${statusLabel}</span> ETA: ${bus.simulated_eta}m</td></tr>`;
    });
    h += '</table></div>';

    h += '</div>';
    res.send(renderPage('Live Tracking', h, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 17 — Trip log list
  // ═══════════════════════════════════════════════════════════════════════════
  app.get(BASE + '/trips', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const dateFilter = req.query.date || '';
    const statusFilter = req.query.status || '';

    let sql = `SELECT t.*, r.name AS route_name, f.registration_number, f.model
               FROM bus_trips t
               LEFT JOIN bus_routes r ON r.id=t.route_id
               LEFT JOIN bus_fleet f ON f.id=t.bus_id
               WHERE t.tenant_id=$1`;
    const params = [tid];
    if (dateFilter) { sql += ' AND t.trip_date=$2'; params.push(dateFilter); }
    if (statusFilter) { sql += ' AND t.status=$3'; params.push(statusFilter); }
    sql += ' ORDER BY t.trip_date DESC, t.planned_departure DESC LIMIT 50';

    const trips = await pool.query(sql, params);

    // Summary stats
    const summary = await pool.query(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN t.status='completed' THEN 1 ELSE 0 END) AS completed,
              SUM(CASE WHEN t.status='cancelled' THEN 1 ELSE 0 END) AS cancelled,
              SUM(t.distance_km) AS total_km,
              SUM(t.fuel_used_litres) AS total_fuel,
              AVG(t.delay_minutes) AS avg_delay
       FROM bus_trips t WHERE t.tenant_id=$1 AND t.trip_date = CURRENT_DATE`, [tid]);

    const s = summary[0] ? summary[0] : {};

    let h = '<div class="bro-wrap">' + CSS + nav('Trips');
    h += '<div class="bro-flex" style="margin-bottom:16px">';
    h += '<h2 style="margin:0">Trip Log</h2>';
    h += `<a href="${BASE}/trips?action=new" class="bro-btn success">+ Log Trip</a>`;
    h += '</div>';

    // Today's stats
    h += '<div class="bro-stats">';
    h += `<div class="bro-stat"><h3>${s.total || 0}</h3><p>Today's Trips</p></div>`;
    h += `<div class="bro-stat green"><h3>${s.completed || 0}</h3><p>Completed</p></div>`;
    h += `<div class="bro-stat red"><h3>${s.cancelled || 0}</h3><p>Cancelled</p></div>`;
    h += `<div class="bro-stat amber"><h3>${parseFloat(s.total_km || 0).toFixed(1)}</h3><p>Total KM</p></div>`;
    h += `<div class="bro-stat purple"><h3>${parseFloat(s.total_fuel || 0).toFixed(1)}L</h3><p>Fuel Used</p></div>`;
    h += `<div class="bro-stat"><h3>${parseFloat(s.avg_delay || 0).toFixed(1)}</h3><p>Avg Delay (min)</p></div>`;
    h += '</div>';

    // Filters
    h += '<div class="bro-flex" style="margin-bottom:16px">';
    h += `<input type="date" value="${dateFilter}" onchange="location.href='${BASE}/trips?date='+this.value+'&status=${statusFilter}'" style="padding:8px;border:1px solid #cbd5e1;border-radius:6px;font-size:13px">`;
    const statuses = [['', 'All'], ['planned', 'Planned'], ['in_progress', 'In Progress'], ['completed', 'Completed'], ['cancelled', 'Cancelled']];
    statuses.forEach(([val, label]) => {
      h += `<a href="${BASE}/trips?status=${val}&date=${dateFilter}" class="bro-btn sm ${statusFilter === val ? 'primary' : 'outline'}">${label}</a>`;
    });
    h += '</div>';

    if (trips.length) {
      h += '<table class="bro-table"><tr><th>Date</th><th>Route</th><th>Bus</th><th>Type</th>';
      h += '<th>Departure</th><th>Arrival</th><th>Distance</th><th>Fuel</th><th>Students</th>';
      h += '<th>Delay</th><th>Status</th><th>Notes</th></tr>';
      trips.forEach(t => {
        const statusBadge = t.status === 'completed' ? 'green' : t.status === 'cancelled' ? 'red' : t.status === 'in_progress' ? 'amber' : 'blue';
        h += `<tr>`;
        h += `<td>${fmtDate(t.trip_date)}</td>`;
        h += `<td>${esc(t.route_name || '—')}</td>`;
        h += `<td>${esc(t.registration_number || '—')}</td>`;
        h += `<td>${esc(t.trip_type)}</td>`;
        h += `<td>${t.actual_departure ? fmtDateTime(t.actual_departure) : (t.planned_departure ? fmtDateTime(t.planned_departure) : '—')}</td>`;
        h += `<td>${t.actual_arrival ? fmtDateTime(t.actual_arrival) : '—'}</td>`;
        h += `<td>${t.distance_km || 0} km</td>`;
        h += `<td>${t.fuel_used_litres || 0}L</td>`;
        h += `<td>${t.students_onboard || 0}</td>`;
        h += `<td>${t.delay_minutes > 0 ? '<span class="bro-badge red">+' + t.delay_minutes + '</span>' : '—'}</td>`;
        h += `<td><span class="bro-badge ${statusBadge}">${esc(t.status)}</span></td>`;
        h += `<td style="max-width:120px;overflow:hidden;text-overflow:ellipsis">${esc((t.notes || '').substring(0, 50))}</td></tr>`;
      });
      h += '</table>';
    } else {
      h += '<div class="bro-card"><p class="bro-muted">No trips recorded.</p></div>';
    }

    h += '</div>';
    res.send(renderPage('Trip Log', h, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 18 — Save trip
  // ═══════════════════════════════════════════════════════════════════════════
  app.post(BASE + '/trips/save', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { id, route_id, bus_id, driver_name, trip_type, trip_date,
            planned_departure, actual_departure, planned_arrival, actual_arrival,
            distance_km, fuel_used_litres, students_onboard, incidents,
            delay_minutes, status, notes } = req.body;

    if (!trip_date) {
      return res.send('<div class="bro-alert error">Trip date is required.</div><a href="javascript:history.back()">Go back</a>');
    }

    if (id) {
      await pool.query(
        `UPDATE bus_trips SET route_id=$1, bus_id=$2, driver_name=$3, trip_type=$4, trip_date=$5,
         planned_departure=$6, actual_departure=$7, planned_arrival=$8, actual_arrival=$9,
         distance_km=$10, fuel_used_litres=$11, students_onboard=$12, incidents=$13,
         delay_minutes=$14, status=$15, notes=$16
         WHERE id=$17 AND tenant_id=$18`,
        [route_id || null, bus_id || null, driver_name || '', trip_type || 'morning', trip_date,
         planned_departure || null, actual_departure || null, planned_arrival || null, actual_arrival || null,
         parseFloat(distance_km) || 0, parseFloat(fuel_used_litres) || 0, parseInt(students_onboard) || 0,
         incidents || '', parseInt(delay_minutes) || 0, status || 'planned', notes || '',
         parseInt(id), tid]);
      audit(req, 'trip_update', { tripId: id });
    } else {
      await pool.query(
        `INSERT INTO bus_trips (tenant_id, route_id, bus_id, driver_name, trip_type, trip_date,
         planned_departure, actual_departure, planned_arrival, actual_arrival,
         distance_km, fuel_used_litres, students_onboard, incidents, delay_minutes, status, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [tid, route_id || null, bus_id || null, driver_name || '', trip_type || 'morning', trip_date,
         planned_departure || null, actual_departure || null, planned_arrival || null, actual_arrival || null,
         parseFloat(distance_km) || 0, parseFloat(fuel_used_litres) || 0, parseInt(students_onboard) || 0,
         incidents || '', parseInt(delay_minutes) || 0, status || 'planned', notes || '']);
      audit(req, 'trip_create', { routeId: route_id, date: trip_date });
    }

    res.redirect(BASE + '/trips');
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 19 — Maintenance list
  // ═══════════════════════════════════════════════════════════════════════════
  app.get(BASE + '/maintenance', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const statusFilter = req.query.status || '';

    let sql = `SELECT m.*, f.registration_number, f.model, f.current_mileage
               FROM bus_maintenance m
               LEFT JOIN bus_fleet f ON f.id=m.bus_id
               WHERE m.tenant_id=$1`;
    const params = [tid];
    if (statusFilter) { sql += ' AND m.status=$2'; params.push(statusFilter); }
    sql += ' ORDER BY m.scheduled_date DESC';

    const records = await pool.query(sql, params);
    const buses = await pool.query('SELECT id, registration_number, model FROM bus_fleet WHERE tenant_id=$1 ORDER BY registration_number', [tid]);

    // Stats
    const stats = await pool.query(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status='scheduled' THEN 1 ELSE 0 END) AS scheduled,
              SUM(CASE WHEN status='in_progress' THEN 1 ELSE 0 END) AS in_progress,
              SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed,
              SUM(cost) AS total_cost
       FROM bus_maintenance WHERE tenant_id=$1`, [tid]);
    const st = stats[0] ? stats[0] : {};

    let h = '<div class="bro-wrap">' + CSS + nav('Maintenance');
    h += '<div class="bro-flex" style="margin-bottom:16px">';
    h += '<h2 style="margin:0">🔧 Fleet Maintenance</h2>';
    h += `<a href="${BASE}/maintenance?action=new" class="bro-btn success">+ Schedule Service</a>`;
    h += '</div>';

    h += '<div class="bro-stats">';
    h += `<div class="bro-stat"><h3>${st.total || 0}</h3><p>Total Records</p></div>`;
    h += `<div class="bro-stat amber"><h3>${st.scheduled || 0}</h3><p>Scheduled</p></div>`;
    h += `<div class="bro-stat blue"><h3>${st.in_progress || 0}</h3><p>In Progress</p></div>`;
    h += `<div class="bro-stat green"><h3>${st.completed || 0}</h3><p>Completed</p></div>`;
    h += `<div class="bro-stat purple"><h3>$${parseFloat(st.total_cost || 0).toFixed(2)}</h3><p>Total Cost</p></div>`;
    h += '</div>';

    // Filters
    h += '<div class="bro-flex" style="margin-bottom:16px">';
    const statuses = [['', 'All'], ['scheduled', 'Scheduled'], ['in_progress', 'In Progress'], ['completed', 'Completed'], ['cancelled', 'Cancelled']];
    statuses.forEach(([val, label]) => {
      h += `<a href="${BASE}/maintenance?status=${val}" class="bro-btn sm ${statusFilter === val ? 'primary' : 'outline'}">${label}</a>`;
    });
    h += '</div>';

    if (records.length) {
      h += '<table class="bro-table"><tr><th>Bus</th><th>Model</th><th>Type</th><th>Scheduled</th>';
      h += '<th>Completed</th><th>Mileage</th><th>Cost</th><th>Vendor</th><th>Next Service</th><th>Status</th></tr>';
      records.forEach(m => {
        const statusBadge = m.status === 'completed' ? 'green' : m.status === 'in_progress' ? 'amber' : m.status === 'scheduled' ? 'blue' : 'gray';
        const typeIcons = { oil_change: '🛢️', tire_rotation: '🛞', brake_service: '🛑', engine_service: '⚙️', inspection: '🔍', repair: '🔧', bodywork: '🎨', other: '📝' };
        h += `<tr>`;
        h += `<td><strong>${esc(m.registration_number || '—')}</strong></td>`;
        h += `<td>${esc(m.model || '—')}</td>`;
        h += `<td>${typeIcons[m.maintenance_type] || '📝'} ${esc(m.maintenance_type)}</td>`;
        h += `<td>${fmtDate(m.scheduled_date)}</td>`;
        h += `<td>${fmtDate(m.completed_date)}</td>`;
        h += `<td>${m.mileage_at_service ? m.mileage_at_service.toLocaleString() : '—'} km</td>`;
        h += `<td>$${parseFloat(m.cost || 0).toFixed(2)}</td>`;
        h += `<td>${esc(m.vendor || '—')}</td>`;
        h += `<td>${fmtDate(m.next_service_date)}${m.next_service_mileage ? '<br><span class="bro-muted">' + m.next_service_mileage.toLocaleString() + ' km</span>' : ''}</td>`;
        h += `<td><span class="bro-badge ${statusBadge}">${esc(m.status)}</span></td></tr>`;
      });
      h += '</table>';
    } else {
      h += '<div class="bro-card"><p class="bro-muted">No maintenance records.</p></div>';
    }

    h += '</div>';
    res.send(renderPage('Fleet Maintenance', h, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 20 — Save maintenance record
  // ═══════════════════════════════════════════════════════════════════════════
  app.post(BASE + '/maintenance/save', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { id, bus_id, maintenance_type, description, scheduled_date,
            completed_date, mileage_at_service, cost, vendor,
            status, next_service_mileage, next_service_date, notes } = req.body;

    if (!bus_id) {
      return res.send('<div class="bro-alert error">Bus is required.</div><a href="javascript:history.back()">Go back</a>');
    }

    if (id) {
      await pool.query(
        `UPDATE bus_maintenance SET bus_id=$1, maintenance_type=$2, description=$3, scheduled_date=$4,
         completed_date=$5, mileage_at_service=$6, cost=$7, vendor=$8, status=$9,
         next_service_mileage=$10, next_service_date=$11, notes=$12
         WHERE id=$13 AND tenant_id=$14`,
        [parseInt(bus_id), maintenance_type || 'oil_change', description || '', scheduled_date || null,
         completed_date || null, parseInt(mileage_at_service) || 0, parseFloat(cost) || 0, vendor || '',
         status || 'scheduled', parseInt(next_service_mileage) || 0, next_service_date || null,
         notes || '', parseInt(id), tid]);

      // Update bus mileage if completed
      if (status === 'completed' && mileage_at_service) {
        await pool.query('UPDATE bus_fleet SET current_mileage=$1, last_service_mileage=$2 WHERE id=$3 AND tenant_id=$4',
          [parseInt(mileage_at_service), parseInt(mileage_at_service), parseInt(bus_id), tid]);
      }
      audit(req, 'maintenance_update', { maintenanceId: id });
    } else {
      await pool.query(
        `INSERT INTO bus_maintenance (tenant_id, bus_id, maintenance_type, description, scheduled_date,
         completed_date, mileage_at_service, cost, vendor, status, next_service_mileage, next_service_date, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [tid, parseInt(bus_id), maintenance_type || 'oil_change', description || '', scheduled_date || null,
         completed_date || null, parseInt(mileage_at_service) || 0, parseFloat(cost) || 0, vendor || '',
         status || 'scheduled', parseInt(next_service_mileage) || 0, next_service_date || null, notes || '']);
      audit(req, 'maintenance_create', { busId: bus_id, type: maintenance_type });
    }

    res.redirect(BASE + '/maintenance');
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 21 — Analytics dashboard
  // ═══════════════════════════════════════════════════════════════════════════
  app.get(BASE + '/analytics', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;

    // Core metrics
    const metrics = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM bus_routes WHERE tenant_id=$1 AND status='active') AS active_routes,
        (SELECT COUNT(*) FROM bus_fleet WHERE tenant_id=$2 AND status='active') AS active_buses,
        (SELECT COUNT(*) FROM bus_student_assignments WHERE tenant_id=$3 AND status='active') AS total_students,
        (SELECT COUNT(*) FROM bus_stops WHERE tenant_id=$4 AND status='active') AS total_stops,
        (SELECT AVG(t.delay_minutes) FROM bus_trips t WHERE t.tenant_id=$5 AND t.status='completed' AND t.trip_date >= CURRENT_DATE - INTERVAL '30 days') AS avg_delay,
        (SELECT SUM(t.distance_km) FROM bus_trips t WHERE t.tenant_id=$6 AND t.status='completed' AND t.trip_date >= CURRENT_DATE - INTERVAL '30 days') AS total_km_30d,
        (SELECT SUM(t.fuel_used_litres) FROM bus_trips t WHERE t.tenant_id=$7 AND t.status='completed' AND t.trip_date >= CURRENT_DATE - INTERVAL '30 days') AS total_fuel_30d,
        (SELECT SUM(m.cost) FROM bus_maintenance m WHERE m.tenant_id=$8 AND m.status='completed' AND m.completed_date >= CURRENT_DATE - INTERVAL '90 days') AS maint_cost_90d,
        (SELECT COUNT(*) FROM bus_trips t WHERE t.tenant_id=$9 AND t.status='completed' AND t.trip_date >= CURRENT_DATE - INTERVAL '30 days') AS trips_30d)
    `, [tid, tid, tid, tid, tid, tid, tid, tid, tid]);

    const m = metrics[0] ? metrics[0] : {};
    const fuelCostEst = parseFloat(m.total_fuel_30d || 0) * 1.50; // $1.50/L estimated fuel cost

    // Route performance
    const routePerf = await pool.query(
      `SELECT r.id, r.name, r.distance_km, r.estimated_time_min,
              f.registration_number, f.capacity,
              (SELECT COUNT(*) FROM bus_student_assignments sa WHERE sa.route_id=r.id AND sa.status='active') AS stu_count,
              (SELECT AVG(t.delay_minutes) FROM bus_trips t WHERE t.route_id=r.id AND t.tenant_id=$1 AND t.status='completed' AND t.trip_date >= CURRENT_DATE - INTERVAL '30 days') AS avg_delay,
              (SELECT COUNT(*) FROM bus_trips t WHERE t.route_id=r.id AND t.tenant_id=$2 AND t.status='completed' AND t.trip_date >= CURRENT_DATE - INTERVAL '30 days') AS trip_count_30d
       FROM bus_routes r
       LEFT JOIN bus_fleet f ON f.id=r.assigned_bus_id
       WHERE r.tenant_id=$3 AND r.status='active'
       ORDER BY r.name`, [tid, tid, tid]);

    // Daily trip counts (last 14 days)
    const dailyTrips = await pool.query(
      `SELECT trip_date, COUNT(*) AS trip_count, SUM(distance_km) AS total_km,
              AVG(delay_minutes) AS avg_delay, SUM(fuel_used_litres) AS fuel
       FROM bus_trips
       WHERE tenant_id=$1 AND status='completed' AND trip_date >= CURRENT_DATE - INTERVAL '14 days'
       GROUP BY trip_date ORDER BY trip_date`, [tid]);

    // Bus utilization
    const busUtil = await pool.query(
      `SELECT f.id, f.registration_number, f.model, f.capacity, f.current_mileage, f.status,
              (SELECT COUNT(*) FROM bus_routes r WHERE r.assigned_bus_id=f.id AND r.status='active') AS route_count,
              (SELECT COUNT(*) FROM bus_trips t WHERE t.bus_id=f.id AND t.tenant_id=$1 AND t.status='completed' AND t.trip_date >= CURRENT_DATE - INTERVAL '30 days') AS trips_30d
       FROM bus_fleet f WHERE f.tenant_id=$2 ORDER BY f.registration_number`, [tid, tid]);

    // Notification stats
    const notifStats = await pool.query(
      `SELECT notification_type, COUNT(*) AS cnt,
              SUM(CASE WHEN status='delivered' THEN 1 ELSE 0 END) AS delivered,
              SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed
       FROM bus_notifications_log WHERE tenant_id=$1
       GROUP BY notification_type ORDER BY cnt DESC`, [tid]);

    let h = '<div class="bro-wrap">' + CSS + nav('Analytics');
    h += '<h2 style="margin-bottom:16px">📊 Analytics Dashboard</h2>';

    // Key metrics
    h += '<div class="bro-stats">';
    h += `<div class="bro-stat"><h3>${m.active_routes || 0}</h3><p>Active Routes</p></div>`;
    h += `<div class="bro-stat green"><h3>${m.active_buses || 0}</h3><p>Active Buses</p></div>`;
    h += `<div class="bro-stat purple"><h3>${m.total_students || 0}</h3><p>Students Transported</p></div>`;
    h += `<div class="bro-stat"><h3>${m.total_stops || 0}</h3><p>Total Stops</p></div>`;
    h += `<div class="bro-stat amber"><h3>${parseFloat(m.avg_delay || 0).toFixed(1)} min</h3><p>Avg Delay (30d)</p></div>`;
    h += `<div class="bro-stat blue"><h3>${parseFloat(m.total_km_30d || 0).toFixed(0)} km</h3><p>Distance (30d)</p></div>`;
    h += `<div class="bro-stat"><h3>${fuelCostEst.toFixed(2)}</h3><p>Est. Fuel Cost (30d)</p></div>`;
    h += `<div class="bro-stat red"><h3>$${parseFloat(m.maint_cost_90d || 0).toFixed(2)}</h3><p>Maint Cost (90d)</p></div>`;
    h += '</div>';

    // Route performance
    h += '<div class="bro-card"><h3>Route Performance (30 days)</h3>';
    if (routePerf.length) {
      h += '<table class="bro-table"><tr><th>Route</th><th>Bus</th><th>Students</th><th>Capacity</th>';
      h += '<th>Fill %</th><th>Avg Delay</th><th>Trips</th><th>Distance</th></tr>';
      routePerf.forEach(r => {
        const fill = pct(r.stu_count, r.capacity || 50);
        const barColor = fill > 90 ? '#dc2626' : fill > 70 ? '#d97706' : '#16a34a';
        const delayBadge = r.avg_delay > 5 ? 'red' : r.avg_delay > 2 ? 'amber' : 'green';
        h += `<tr><td><strong>${esc(r.name)}</strong></td>`;
        h += `<td>${esc(r.registration_number || '—')}</td>`;
        h += `<td>${r.stu_count}</td><td>${r.capacity || 50}</td>`;
        h += `<td><div class="bro-progress" style="width:80px"><div class="bro-progress-bar" style="width:${fill}%;background:${barColor}"></div></div> ${fill}%</td>`;
        h += `<td><span class="bro-badge ${delayBadge}">${parseFloat(r.avg_delay || 0).toFixed(1)} min</span></td>`;
        h += `<td>${r.trip_count_30d || 0}</td>`;
        h += `<td>${r.distance_km || 0} km</td></tr>`;
      });
      h += '</table>';
    } else {
      h += '<p class="bro-muted">No route data available.</p>';
    }
    h += '</div>';

    // Daily activity chart (text-based bar chart)
    h += '<div class="bro-card"><h3>Daily Activity (14 days)</h3>';
    if (dailyTrips.length) {
      const maxTrips = Math.max(...dailyTrips.map(d => d.trip_count), 1);
      dailyTrips.forEach(d => {
        const barLen = Math.round((d.trip_count / maxTrips) * 40);
        const bar = '█'.repeat(barLen) + '░'.repeat(Math.max(0, 40 - barLen));
        h += `<div style="display:flex;align-items:center;gap:8px;margin:3px 0;font-size:12px">`;
        h += `<span style="width:80px;color:#64748b">${fmtDate(d.trip_date)}</span>`;
        h += `<span style="color:#0284c7;font-family:monospace">${bar}</span>`;
        h += `<span style="width:60px;font-weight:600">${d.trip_count} trips</span>`;
        h += `<span style="width:60px;color:#64748b">${parseFloat(d.total_km || 0).toFixed(0)} km</span>`;
        h += `<span style="color:${parseFloat(d.avg_delay || 0) > 5 ? '#dc2626' : '#16a34a'}">${parseFloat(d.avg_delay || 0).toFixed(1)}m delay</span>`;
        h += '</div>';
      });
    } else {
      h += '<p class="bro-muted">No trip data for the last 14 days.</p>';
    }
    h += '</div>';

    // Bus utilization
    h += '<div class="bro-card"><h3>Bus Utilization</h3>';
    if (busUtil.length) {
      h += '<table class="bro-table"><tr><th>Registration</th><th>Model</th><th>Status</th>';
      h += '<th>Routes</th><th>Trips (30d)</th><th>Mileage</th></tr>';
      busUtil.forEach(b => {
        const statusBadge = b.status === 'active' ? 'green' : b.status === 'maintenance' ? 'amber' : 'gray';
        const utilizationPct = b.capacity > 0 ? Math.min(pct(b.route_count * 40, b.capacity), 100) : 0;
        h += `<tr><td><strong>${esc(b.registration_number)}</strong></td>`;
        h += `<td>${esc(b.model || '—')}</td>`;
        h += `<td><span class="bro-badge ${statusBadge}">${esc(b.status)}</span></td>`;
        h += `<td>${b.route_count}</td>`;
        h += `<td>${b.trips_30d || 0}</td>`;
        h += `<td>${b.current_mileage.toLocaleString()} km</td></tr>`;
      });
      h += '</table>';
    } else {
      h += '<p class="bro-muted">No bus data.</p>';
    }
    h += '</div>';

    // Notification analytics
    h += '<div class="bro-card"><h3>Notification Analytics</h3>';
    if (notifStats.length) {
      h += '<table class="bro-table"><tr><th>Type</th><th>Total</th><th>Delivered</th><th>Failed</th><th>Delivery Rate</th></tr>';
      notifStats.forEach(n => {
        const rate = n.cnt > 0 ? pct(n.delivered, n.cnt) : '0.0';
        h += `<tr><td><strong>${esc(n.notification_type)}</strong></td>`;
        h += `<td>${n.cnt}</td><td>${n.delivered}</td><td>${n.failed}</td>`;
        h += `<td>${rate}%</td></tr>`;
      });
      h += '</table>';
    } else {
      h += '<p class="bro-muted">No notification data.</p>';
    }
    h += '</div>';

    h += '</div>';
    res.send(renderPage('Analytics Dashboard', h, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 22 — Settings page (GET)
  // ═══════════════════════════════════════════════════════════════════════════
  app.get(BASE + '/settings', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;

    // Get settings from a simple key-value approach using a dedicated table or JSON column
    // For simplicity, we store in a settings table if it exists
    let settings = {};
    try {
      const settingsRows = await pool.query(
        "SELECT setting_key, setting_value FROM bus_settings WHERE tenant_id=$1", [tid]);
      if (settingsRows && settingsRows.length) {
        settingsRows.forEach(row => { settings[row.setting_key] = row.setting_value; });
      }
    } catch (_) {
      // Table might not exist yet
    }

    let h = '<div class="bro-wrap">' + CSS + nav('Settings');
    h += '<h2 style="margin-bottom:16px">⚙️ Transport Settings</h2>';

    h += '<div class="bro-grid-2">';

    // General settings
    h += '<div class="bro-card"><h3>General Settings</h3>';
    h += `<form method="POST" action="${BASE}/settings/save" class="bro-form">`;
    h += '<input type="hidden" name="section" value="general">';
    h += '<table>';
    h += `<tr><td><label>School Name</label></td><td><input name="school_name" value="${esc(settings.school_name || '')}"></td></tr>`;
    h += `<tr><td><label>Transport Manager Name</label></td><td><input name="manager_name" value="${esc(settings.manager_name || '')}"></td></tr>`;
    h += `<tr><td><label>Manager Phone</label></td><td><input name="manager_phone" value="${esc(settings.manager_phone || '')}"></td></tr>`;
    h += `<tr><td><label>Manager Email</label></td><td><input name="manager_email" value="${esc(settings.manager_email || '')}"></td></tr>`;
    h += `<tr><td><label>Default Trip Start Time (AM)</label></td><td><input type="time" name="morning_default" value="${esc(settings.morning_default || '07:00')}"></td></tr>`;
    h += `<tr><td><label>Default Trip Start Time (PM)</label></td><td><input type="time" name="afternoon_default" value="${esc(settings.afternoon_default || '15:00')}"></td></tr>`;
    h += `<tr><td><label>Max Bus Capacity</label></td><td><input type="number" name="max_bus_capacity" value="${esc(settings.max_bus_capacity || '50')}"></td></tr>`;
    h += `<tr><td><label>Max Route Distance (km)</label></td><td><input type="number" name="max_route_distance" value="${esc(settings.max_route_distance || '50')}" step="0.5"></td></tr>`;
    h += '</table>';
    h += `<button type="submit" class="bro-btn primary" style="margin-top:12px">Save General Settings</button>`;
    h += '</form></div>';

    // Notification settings
    h += '<div class="bro-card"><h3>Notification Settings</h3>';
    h += `<form method="POST" action="${BASE}/settings/save" class="bro-form">`;
    h += '<input type="hidden" name="section" value="notifications">';
    h += '<table>';
    h += `<tr><td><label>Enable SMS Notifications</label></td><td><select name="sms_enabled"><option value="1" ${settings.sms_enabled === '1' ? 'selected' : ''}>Yes</option><option value="0" ${settings.sms_enabled !== '1' ? 'selected' : ''}>No</option></select></td></tr>`;
    h += `<tr><td><label>Enable Email Notifications</label></td><td><select name="email_enabled"><option value="1" ${settings.email_enabled === '1' ? 'selected' : ''}>Yes</option><option value="0" ${settings.email_enabled !== '1' ? 'selected' : ''}>No</option></select></td></tr>`;
    h += `<tr><td><label>Notify Before Arrival (min)</label></td><td><input type="number" name="notify_before_min" value="${esc(settings.notify_before_min || '10')}"></td></tr>`;
    h += `<tr><td><label>Delay Alert Threshold (min)</label></td><td><input type="number" name="delay_threshold_min" value="${esc(settings.delay_threshold_min || '5')}"></td></tr>`;
    h += `<tr><td><label>SMS Provider</label></td><td><select name="sms_provider"><option value="twilio" ${settings.sms_provider === 'twilio' ? 'selected' : ''}>Twilio</option><option value="bulk_sms" ${settings.sms_provider === 'bulk_sms' ? 'selected' : ''}>Bulk SMS</option><option value="custom" ${settings.sms_provider === 'custom' ? 'selected' : ''}>Custom</option></select></td></tr>`;
    h += `<tr><td><label>SMS API Key</label></td><td><input type="password" name="sms_api_key" value="${esc(settings.sms_api_key || '')}" placeholder="Enter API key"></td></tr>`;
    h += `<tr><td><label>Email Sender Address</label></td><td><input type="email" name="email_sender" value="${esc(settings.email_sender || '')}"></td></tr>`;
    h += '</table>';
    h += `<button type="submit" class="bro-btn primary" style="margin-top:12px">Save Notification Settings</button>`;
    h += '</form></div>';

    // Map/GPS settings
    h += '<div class="bro-card"><h3>Map & GPS Settings</h3>';
    h += `<form method="POST" action="${BASE}/settings/save" class="bro-form">`;
    h += '<input type="hidden" name="section" value="gps">';
    h += '<table>';
    h += `<tr><td><label>Map Provider</label></td><td><select name="map_provider"><option value="google" ${settings.map_provider === 'google' ? 'selected' : ''}>Google Maps</option><option value="mapbox" ${settings.map_provider === 'mapbox' ? 'selected' : ''}>Mapbox</option><option value="leaflet" ${settings.map_provider === 'leaflet' ? 'selected' : ''}>Leaflet (OpenStreetMap)</option></select></td></tr>`;
    h += `<tr><td><label>Map API Key</label></td><td><input type="password" name="map_api_key" value="${esc(settings.map_api_key || '')}" placeholder="Enter API key"></td></tr>`;
    h += `<tr><td><label>Default Map Center (Lat)</label></td><td><input type="number" step="0.0001" name="default_lat" value="${esc(settings.default_lat || '33.7490')}"></td></tr>`;
    h += `<tr><td><label>Default Map Center (Lng)</label></td><td><input type="number" step="0.0001" name="default_lng" value="${esc(settings.default_lng || '-84.3880')}"></td></tr>`;
    h += `<tr><td><label>Default Zoom Level</label></td><td><input type="number" name="default_zoom" value="${esc(settings.default_zoom || '12')}" min="1" max="20"></td></tr>`;
    h += `<tr><td><label>GPS Update Interval (sec)</label></td><td><input type="number" name="gps_interval" value="${esc(settings.gps_interval || '30')}" min="5" max="300"></td></tr>`;
    h += `<tr><td><label>Geofence Radius (meters)</label></td><td><input type="number" name="geofence_radius" value="${esc(settings.geofence_radius || '200')}"></td></tr>`;
    h += '</table>';
    h += `<button type="submit" class="bro-btn primary" style="margin-top:12px">Save GPS Settings</button>`;
    h += '</form></div>';

    // Maintenance settings
    h += '<div class="bro-card"><h3>Maintenance Settings</h3>';
    h += `<form method="POST" action="${BASE}/settings/save" class="bro-form">`;
    h += '<input type="hidden" name="section" value="maintenance">';
    h += '<table>';
    h += `<tr><td><label>Service Interval (km)</label></td><td><input type="number" name="service_interval_km" value="${esc(settings.service_interval_km || '10000')}"></td></tr>`;
    h += `<tr><td><label>Oil Change Interval (km)</label></td><td><input type="number" name="oil_change_interval" value="${esc(settings.oil_change_interval || '5000')}"></td></tr>`;
    h += `<tr><td><label>Tire Rotation Interval (km)</label></td><td><input type="number" name="tire_rotation_interval" value="${esc(settings.tire_rotation_interval || '20000')}"></td></tr>`;
    h += `<tr><td><label>Insurance Reminder (days before)</label></td><td><input type="number" name="insurance_reminder_days" value="${esc(settings.insurance_reminder_days || '30')}"></td></tr>`;
    h += '</table>';
    h += `<button type="submit" class="bro-btn primary" style="margin-top:12px">Save Maintenance Settings</button>`;
    h += '</form></div>';

    h += '</div>';

    // Data management
    h += '<div class="bro-card" style="margin-top:20px"><h3>🛠 Data Management</h3>';
    h += '<div class="bro-flex">';
    h += `<a href="${BASE}/settings?action=export" class="bro-btn primary">Export All Data (CSV)</a>`;
    h += `<span class="bro-muted" style="margin-left:12px">Export routes, buses, stops, and assignments</span>`;
    h += '</div></div>';

    h += '</div>';
    res.send(renderPage('Transport Settings', h, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 23 — Save settings (POST)
  // ═══════════════════════════════════════════════════════════════════════════
  app.post(BASE + '/settings/save', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { section } = req.body;

    // Ensure settings table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bus_settings (
        id SERIAL PRIMARY KEY,
        tenant_id INT NOT NULL,
        setting_key VARCHAR(100) NOT NULL,
        setting_value TEXT,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uk_bs_tenant_key UNIQUE (tenant_id, setting_key)
      )
    `);

    // Define which fields belong to which section
    const sectionFields = {
      general: ['school_name', 'manager_name', 'manager_phone', 'manager_email', 'morning_default', 'afternoon_default', 'max_bus_capacity', 'max_route_distance'],
      notifications: ['sms_enabled', 'email_enabled', 'notify_before_min', 'delay_threshold_min', 'sms_provider', 'sms_api_key', 'email_sender'],
      gps: ['map_provider', 'map_api_key', 'default_lat', 'default_lng', 'default_zoom', 'gps_interval', 'geofence_radius'],
      maintenance: ['service_interval_km', 'oil_change_interval', 'tire_rotation_interval', 'insurance_reminder_days'],
    };

    const fields = sectionFields[section] || [];
    for (const key of fields) {
      const value = req.body[key] || '';
      await pool.query(
        `INSERT INTO bus_settings (tenant_id, setting_key, setting_value) VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, setting_key) DO UPDATE SET setting_value=EXCLUDED.setting_value, updated_at=NOW()`,
        [tid, key, value]);
    }

    audit(req, 'settings_save', { section });
    res.redirect(BASE + '/settings');
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER: Parent notification logging function
  // ═══════════════════════════════════════════════════════════════════════════
  async function logParentNotification(tid, data) {
    try {
      await pool.query(
        `INSERT INTO bus_notifications_log (tenant_id, student_assignment_id, route_id, parent_phone, parent_email, notification_type, message, sent_via, status, sent_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())`,
        [tid, data.assignment_id || null, data.route_id || null,
         data.parent_phone || null, data.parent_email || null,
         data.notification_type || 'general', data.message || '',
         data.sent_via || 'in_app', data.status || 'sent']);
    } catch (err) {
      console.error('[bus-route-optimizer] Notification log error:', err.message);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER: Send delay notifications for trips
  // ═══════════════════════════════════════════════════════════════════════════
  async function sendDelayNotifications(tid, tripId, delayMinutes) {
    try {
      const trip = await pool.query('SELECT route_id FROM bus_trips WHERE id=$1 AND tenant_id=$2', [tripId, tid]);
      if (!trip.length) return;
      const routeId = trip[0].route_id;

      const assignments = await pool.query(
        `SELECT id, student_name, parent_phone, parent_email
         FROM bus_student_assignments
         WHERE tenant_id=$1 AND route_id=$2 AND status='active'`, [tid, routeId]);

      for (const a of assignments) {
        await logParentNotification(tid, {
          assignment_id: a.id,
          route_id: routeId,
          parent_phone: a.parent_phone,
          parent_email: a.parent_email,
          notification_type: 'delay',
          message: `Bus is delayed by approximately ${delayMinutes} minutes. We apologize for the inconvenience. Student: ${a.student_name}.`,
          sent_via: 'in_app',
          status: 'sent'
        });
      }
    } catch (err) {
      console.error('[bus-route-optimizer] Delay notification error:', err.message);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER: Simple optimization clustering (exported for testing)
  // ═══════════════════════════════════════════════════════════════════════════
  function clusterStudentsByArea(students, stops, maxClusterSize) {
    const clusters = [];
    const assigned = new Set();

    for (const stop of stops) {
      if (!stop.latitude || !stop.longitude) continue;
      const nearby = students.filter(s => {
        if (assigned.has(s.id)) return false;
        // Simple distance check (using lat/lng difference as proxy)
        const latDiff = Math.abs((s.latitude || 0) - stop.latitude);
        const lngDiff = Math.abs((s.longitude || 0) - stop.longitude);
        return latDiff < 0.01 && lngDiff < 0.01; // Roughly ~1km radius
      });

      if (nearby.length > 0) {
        const clusterStudents = nearby.slice(0, maxClusterSize);
        clusterStudents.forEach(s => assigned.add(s.id));
        clusters.push({
          stopId: stop.id,
          stopName: stop.name,
          routeId: stop.route_id,
          students: clusterStudents,
          center: { lat: stop.latitude, lng: stop.longitude }
        });
      }
    }

    // Assign remaining students to nearest cluster
    const remaining = students.filter(s => !assigned.has(s.id));
    remaining.forEach(s => {
      let nearestCluster = null;
      let minDist = Infinity;
      for (const cluster of clusters) {
        const dist = Math.sqrt(
          Math.pow((s.latitude || 0) - cluster.center.lat, 2) +
          Math.pow((s.longitude || 0) - cluster.center.lng, 2)
        );
        if (dist < minDist) { minDist = dist; nearestCluster = cluster; }
      }
      if (nearestCluster) nearestCluster.students.push(s);
    });

    return clusters;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER: Calculate route distance from waypoints
  // ═══════════════════════════════════════════════════════════════════════════
  function calculateRouteDistance(waypoints) {
    if (!waypoints || waypoints.length < 2) return 0;
    let total = 0;
    for (let i = 1; i < waypoints.length; i++) {
      const d = Math.sqrt(
        Math.pow(waypoints[i].lat - waypoints[i - 1].lat, 2) +
        Math.pow(waypoints[i].lng - waypoints[i - 1].lng, 2)
      );
      total += d; // This gives degrees; multiply by ~111km per degree
    }
    return Math.round(total * 111 * 10) / 10; // Approximate km
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER: Balance route capacities
  // ═══════════════════════════════════════════════════════════════════════════
  function balanceCapacities(routes, studentsPerRoute) {
    const routeCaps = routes.map(r => ({
      id: r.id,
      name: r.name,
      max: r.capacity || 50,
      current: studentsPerRoute[r.id] || 0,
      available: () => (r.capacity || 50) - (studentsPerRoute[r.id] || 0)
    }));

    const totalStudents = Object.values(studentsPerRoute).reduce((a, b) => a + b, 0);
    const totalCapacity = routeCaps.reduce((a, r) => a + r.max, 0);
    const avgFill = totalCapacity > 0 ? (totalStudents / routeCaps.length) : 0;

    return {
      routes: routeCaps,
      totalStudents,
      totalCapacity,
      avgFill: avgFill.toFixed(1),
      utilizationRate: totalCapacity > 0 ? ((totalStudents / totalCapacity) * 100).toFixed(1) : '0.0',
      overloadedRoutes: routeCaps.filter(r => r.current > r.max),
      underutilizedRoutes: routeCaps.filter(r => r.current < r.max * 0.5),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Module exports for external use
  // ═══════════════════════════════════════════════════════════════════════════
  return {
    clusterStudentsByArea,
    calculateRouteDistance,
    balanceCapacities,
    logParentNotification,
    sendDelayNotifications,
  };
};
