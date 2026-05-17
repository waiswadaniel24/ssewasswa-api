/**
 * Transport Management Module
 * Multi-tenant SaaS platform (schools)
 *
 * Features: Vehicles, Routes, Passengers, Incidents, Reports
 * 14 routes • PostgreSQL • tenant_id scoped
 */
module.exports = function transport(app, db, pool, renderPage, esc) {

  // ── Helpers ────────────────────────────────────────────────────────────────
  const requireAuth = (req, res, next) => {
    if (!req.session || !req.session.user) return res.redirect('/login');
    next();
  };
  const navUrl = (action) => `/transport${action}`;
  const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  // -- subscription gate --------------------------------------------------
  const _PLAN_LEVELS = { free: 0, basic: 1, pro: 2 };
  const _SUB_PAGE = '<div style="max-width:600px;margin:60px auto;text-align:center"><h2>Subscription Required</h2><p>This feature requires a paid subscription.</p><a href="/billing" style="padding:12px 24px;background:#f59e0b;color:white;text-decoration:none;border-radius:8px;font-weight:700">Subscribe Now</a></div>';
  const requireSubscription = (minPlan) => async (req, res, next) => {
    if (req.session?.user?.role === 'super_admin') return next();
    try {
      const sub = await pool.query("SELECT plan FROM subscriptions WHERE tenant_id=$1 AND status='active'", [req.session.user.tenant_id]);
      const plan = sub.rows[0]?.plan || 'free';
      if ((_PLAN_LEVELS[plan] || 0) < (_PLAN_LEVELS[minPlan] || 0)) return res.send(_SUB_PAGE);
    } catch (e) { /* allow through on DB error */ }
    next();
  };
  function fmtDate(d) { return d ? new Date(d).toISOString().split('T')[0] : '—'; }

  // ── Migrations ─────────────────────────────────────────────────────────────
  async function migrate() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS transport_vehicles (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        plate_number VARCHAR(20) NOT NULL, vehicle_type VARCHAR(50) DEFAULT 'bus',
        capacity INTEGER DEFAULT 50, driver_name VARCHAR(255), driver_phone VARCHAR(20),
        route_name VARCHAR(255), insurance_expiry DATE, next_service DATE,
        status VARCHAR(20) DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS transport_routes (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL, description TEXT,
        stops TEXT[], estimated_time VARCHAR(50),
        distance_km NUMERIC(6,2), fare NUMERIC(8,2) DEFAULT 0,
        vehicle_id INTEGER REFERENCES transport_vehicles(id),
        is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS transport_passengers (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        route_id INTEGER NOT NULL REFERENCES transport_routes(id) ON DELETE CASCADE,
        passenger_name VARCHAR(255) NOT NULL, passenger_id VARCHAR(50),
        stop_name VARCHAR(100), parent_phone VARCHAR(20),
        status VARCHAR(20) DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS transport_incidents (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        vehicle_id INTEGER REFERENCES transport_vehicles(id),
        incident_type VARCHAR(50), description TEXT,
        date TIMESTAMPTZ, resolved BOOLEAN DEFAULT false,
        reported_by VARCHAR(255), created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    const alters = [
      'ALTER TABLE transport_vehicles ADD COLUMN IF NOT EXISTS plate_number VARCHAR(20) NOT NULL DEFAULT \'\';',
      'ALTER TABLE transport_vehicles ADD COLUMN IF NOT EXISTS vehicle_type VARCHAR(50) DEFAULT \'bus\';',
      'ALTER TABLE transport_vehicles ADD COLUMN IF NOT EXISTS capacity INTEGER DEFAULT 50;',
      'ALTER TABLE transport_vehicles ADD COLUMN IF NOT EXISTS driver_name VARCHAR(255);',
      'ALTER TABLE transport_vehicles ADD COLUMN IF NOT EXISTS driver_phone VARCHAR(20);',
      'ALTER TABLE transport_vehicles ADD COLUMN IF NOT EXISTS route_name VARCHAR(255);',
      'ALTER TABLE transport_vehicles ADD COLUMN IF NOT EXISTS insurance_expiry DATE;',
      'ALTER TABLE transport_vehicles ADD COLUMN IF NOT EXISTS next_service DATE;',
      'ALTER TABLE transport_vehicles ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT \'active\';',
      'ALTER TABLE transport_routes ADD COLUMN IF NOT EXISTS name VARCHAR(255) NOT NULL DEFAULT \'\';',
      'ALTER TABLE transport_routes ADD COLUMN IF NOT EXISTS description TEXT;',
      'ALTER TABLE transport_routes ADD COLUMN IF NOT EXISTS stops TEXT[];',
      'ALTER TABLE transport_routes ADD COLUMN IF NOT EXISTS estimated_time VARCHAR(50);',
      'ALTER TABLE transport_routes ADD COLUMN IF NOT EXISTS distance_km NUMERIC(6,2);',
      'ALTER TABLE transport_routes ADD COLUMN IF NOT EXISTS fare NUMERIC(8,2) DEFAULT 0;',
      'ALTER TABLE transport_routes ADD COLUMN IF NOT EXISTS vehicle_id INTEGER;',
      'ALTER TABLE transport_routes ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;',
      'ALTER TABLE transport_passengers ADD COLUMN IF NOT EXISTS passenger_name VARCHAR(255) NOT NULL DEFAULT \'\';',
      'ALTER TABLE transport_passengers ADD COLUMN IF NOT EXISTS passenger_id VARCHAR(50);',
      'ALTER TABLE transport_passengers ADD COLUMN IF NOT EXISTS stop_name VARCHAR(100);',
      'ALTER TABLE transport_passengers ADD COLUMN IF NOT EXISTS parent_phone VARCHAR(20);',
      'ALTER TABLE transport_passengers ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT \'active\';',
      'ALTER TABLE transport_incidents ADD COLUMN IF NOT EXISTS vehicle_id INTEGER;',
      'ALTER TABLE transport_incidents ADD COLUMN IF NOT EXISTS incident_type VARCHAR(50);',
      'ALTER TABLE transport_incidents ADD COLUMN IF NOT EXISTS description TEXT;',
      'ALTER TABLE transport_incidents ADD COLUMN IF NOT EXISTS date TIMESTAMPTZ;',
      'ALTER TABLE transport_incidents ADD COLUMN IF NOT EXISTS resolved BOOLEAN DEFAULT false;',
      'ALTER TABLE transport_incidents ADD COLUMN IF NOT EXISTS reported_by VARCHAR(255);',
    ];
    for (const sql of alters) { try { await pool.query(sql); } catch (_) {} }

    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_tv_tenant ON transport_vehicles(tenant_id);',
      'CREATE INDEX IF NOT EXISTS idx_tv_status ON transport_vehicles(status);',
      'CREATE INDEX IF NOT EXISTS idx_tr_tenant ON transport_routes(tenant_id);',
      'CREATE INDEX IF NOT EXISTS idx_tr_vehicle ON transport_routes(vehicle_id);',
      'CREATE INDEX IF NOT EXISTS idx_tr_active ON transport_routes(is_active);',
      'CREATE INDEX IF NOT EXISTS idx_tp_tenant ON transport_passengers(tenant_id);',
      'CREATE INDEX IF NOT EXISTS idx_tp_route ON transport_passengers(route_id);',
      'CREATE INDEX IF NOT EXISTS idx_tp_status ON transport_passengers(status);',
      'CREATE INDEX IF NOT EXISTS idx_ti_tenant ON transport_incidents(tenant_id);',
      'CREATE INDEX IF NOT EXISTS idx_ti_vehicle ON transport_incidents(vehicle_id);',
      'CREATE INDEX IF NOT EXISTS idx_ti_status ON transport_incidents(resolved);',
    ];
    for (const sql of indexes) { try { await pool.query(sql); } catch (_) {} }
  }

  // ── Shared nav ─────────────────────────────────────────────────────────────
  function nav(active) {
    const links = [
      ['Dashboard', navUrl('')], ['Vehicles', navUrl('/vehicles')],
      ['Routes', navUrl('/routes')], ['Incidents', navUrl('/incidents')], ['Reports', navUrl('/report')],
    ];
    return '<nav class="grid" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin-bottom:24px;">' +
      links.map(([l, h]) =>
        `<a href="${h}" class="btn btn-sm ${active === l ? 'btn-green' : 'btn-blue'}">${l}</a>`
      ).join('') + '</nav>';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 1 — Dashboard
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/transport', requireAuth, requireSubscription('basic'), async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [vehicles, routes, passengers, incidents] = await Promise.all([
      pool.query("SELECT COUNT(*)::int AS c FROM transport_vehicles WHERE tenant_id=$1 AND status='active'", [tid]),
      pool.query("SELECT COUNT(*)::int AS c FROM transport_routes WHERE tenant_id=$1 AND is_active=true", [tid]),
      pool.query("SELECT COUNT(*)::int AS c FROM transport_passengers WHERE tenant_id=$1 AND status='active'", [tid]),
      pool.query("SELECT COUNT(*)::int AS c FROM transport_incidents WHERE tenant_id=$1 AND resolved=false", [tid]),
    ]);
    const vc = vehicles.rows[0].c, rc = routes.rows[0].c;
    const pc = passengers.rows[0].c, ic = incidents.rows[0].c;

    const serviceDue = await pool.query(
      `SELECT id, plate_number, vehicle_type, driver_name, next_service
       FROM transport_vehicles
       WHERE tenant_id=$1 AND status='active' AND next_service <= NOW() + INTERVAL '7 days'
       ORDER BY next_service ASC LIMIT 5`, [tid]);

    const openInc = await pool.query(
      `SELECT i.*, v.plate_number
       FROM transport_incidents i
       LEFT JOIN transport_vehicles v ON v.id=i.vehicle_id
       WHERE i.tenant_id=$1 AND i.resolved=false ORDER BY i.date DESC LIMIT 5`, [tid]);

    const routeUtil = await pool.query(
      `SELECT r.id, r.name, v.plate_number,
        (SELECT COUNT(*)::int FROM transport_passengers p WHERE p.route_id=r.id AND p.status='active') AS pax_count,
        COALESCE(v.capacity,0) AS cap
       FROM transport_routes r LEFT JOIN transport_vehicles v ON v.id=r.vehicle_id
       WHERE r.tenant_id=$1 AND r.is_active=true ORDER BY pax_count DESC LIMIT 6`, [tid]);

    let html = nav('Dashboard');
    html += '<div class="stats">';
    html += `<div class="stat-card"><div class="stat-num">${vc}</div><div>Active Vehicles</div></div>`;
    html += `<div class="stat-card"><div class="stat-num">${rc}</div><div>Active Routes</div></div>`;
    html += `<div class="stat-card"><div class="stat-num">${pc}</div><div>Passengers</div></div>`;
    html += `<div class="stat-card"><div class="stat-num">${ic}</div><div>Open Incidents</div></div>`;
    html += '</div>';
    html += '<div class="grid" style="grid-template-columns:1fr 1fr;gap:20px;">';

    // Service due
    html += '<div class="card"><h3>Service Due Soon</h3>';
    if (serviceDue.rows.length) {
      html += '<table><tr><th>Plate</th><th>Type</th><th>Driver</th><th>Service</th></tr>';
      serviceDue.rows.forEach(v => {
        const od = new Date(v.next_service) < new Date();
        html += `<tr><td>${esc(v.plate_number)}</td><td>${esc(v.vehicle_type)}</td>` +
          `<td>${esc(v.driver_name||'—')}</td>` +
          `<td>${od?'<span class="badge badge-warning">Overdue</span> ':''}${fmtDate(v.next_service)}</td></tr>`;
      });
      html += '</table>';
    } else { html += '<p class="muted">No vehicles due for service soon.</p>'; }
    html += '</div>';

    // Recent incidents
    html += '<div class="card"><h3>Recent Incidents</h3>';
    if (openInc.rows.length) {
      html += '<table><tr><th>Type</th><th>Vehicle</th><th>Date</th><th>Action</th></tr>';
      openInc.rows.forEach(i => {
        html += `<tr><td>${esc(i.incident_type||'N/A')}</td><td>${esc(i.plate_number||'—')}</td>` +
          `<td>${fmtDate(i.date)}</td>` +
          `<td><a href="${navUrl('/incidents')}" class="btn btn-sm btn-blue">View</a></td></tr>`;
      });
      html += '</table>';
    } else { html += '<p class="muted">No open incidents. All clear!</p>'; }
    html += '</div></div>';

    // Route utilization
    html += '<div class="card" style="margin-top:20px;"><h3>Route Utilization</h3>';
    if (routeUtil.rows.length) {
      html += '<table><tr><th>Route</th><th>Vehicle</th><th>Passengers</th><th>Capacity</th><th>Fill %</th></tr>';
      routeUtil.rows.forEach(r => {
        const pct = r.cap > 0 ? ((r.pax_count/r.cap)*100).toFixed(0) : '—';
        const warn = r.cap>0 && (r.pax_count/r.cap)>0.9 ? ' <span class="badge badge-warning">Near Full</span>' : '';
        html += `<tr><td><a href="${navUrl('/routes/'+r.id)}">${esc(r.name)}</a></td>` +
          `<td>${esc(r.plate_number||'Unassigned')}</td><td>${r.pax_count}</td><td>${r.cap}</td>` +
          `<td>${pct}%${warn}</td></tr>`;
      });
      html += '</table>';
    } else { html += '<p class="muted">No routes configured yet.</p>'; }
    html += '</div>';
    res.send(renderPage('Transport Dashboard', html, req.session.user, req));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 2 — Vehicle fleet list
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/transport/vehicles', requireAuth, requireSubscription('basic'), async (req, res) => {
    const tid = req.session.user.tenant_id;
    const sf = req.query.status || '';
    let where = 'v.tenant_id=$1', params = [tid];
    if (sf) { where += ' AND v.status=$2'; params.push(sf); }

    const result = await pool.query(
      `SELECT v.*,
        (SELECT COUNT(*)::int FROM transport_routes r WHERE r.vehicle_id=v.id AND r.is_active=true) AS route_count,
        (SELECT COUNT(*)::int FROM transport_passengers p
          JOIN transport_routes r ON r.id=p.route_id
          WHERE r.vehicle_id=v.id AND p.status='active') AS pax_count
       FROM transport_vehicles v WHERE ${where} ORDER BY v.plate_number`, params);

    let html = nav('Vehicles');
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">' +
      '<h2>Vehicle Fleet</h2>' + `<a href="${navUrl('/vehicles/new')}" class="btn btn-green">+ Add Vehicle</a></div>`;
    const filters = [['','All'],['active','Active'],['maintenance','Maintenance'],['inactive','Inactive']];
    html += '<div style="margin-bottom:16px;">';
    filters.forEach(([v,l]) => {
      html += `<a href="${navUrl('/vehicles?status='+v)}" class="btn btn-sm ${sf===v?'btn-green':''}">${l}</a> `;
    });
    html += '</div>';

    if (result.rows.length) {
      html += '<table><tr><th>Plate #</th><th>Type</th><th>Capacity</th><th>Driver</th>' +
        '<th>Insurance</th><th>Service</th><th>Routes</th><th>Status</th></tr>';
      const today = Date.now();
      result.rows.forEach(v => {
        const insW = v.insurance_expiry && new Date(v.insurance_expiry) <= new Date(today + 30*864e5);
        const svcW = v.next_service && new Date(v.next_service) <= new Date(today + 7*864e5);
        const sb = v.status==='active' ? '<span class="badge badge-success">Active</span>'
          : v.status==='maintenance' ? '<span class="badge badge-warning">Maintenance</span>'
          : '<span class="badge">Inactive</span>';
        html += `<tr><td><strong>${esc(v.plate_number)}</strong></td><td>${esc(v.vehicle_type)}</td>` +
          `<td>${v.capacity}</td><td>${esc(v.driver_name||'—')}</td>` +
          `<td>${insW?'<span class="badge badge-warning">!</span> ':''}${fmtDate(v.insurance_expiry)}</td>` +
          `<td>${svcW?'<span class="badge badge-warning">!</span> ':''}${fmtDate(v.next_service)}</td>` +
          `<td>${v.route_count} (${v.pax_count} pax)</td><td>${sb}</td></tr>`;
      });
      html += '</table>';
    } else { html += '<div class="card"><p class="muted">No vehicles found.</p></div>'; }
    res.send(renderPage('Vehicle Fleet', html, req.session.user, req));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 3 — Add vehicle form
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/transport/vehicles/new', requireAuth, requireSubscription('basic'), (req, res) => {
    let html = nav('Vehicles');
    html += '<div class="card"><h2>Add New Vehicle</h2>';
    html += `<form method="POST" action="${navUrl('/vehicles/create')}">
      <table>
        <tr><td><label>Plate Number *</label></td><td><input name="plate_number" required style="width:200px;padding:8px;" placeholder="ABC-1234"></td></tr>
        <tr><td><label>Vehicle Type</label></td><td><select name="vehicle_type" style="padding:8px;">
          <option value="bus">Bus</option><option value="mini_bus">Mini Bus</option>
          <option value="van">Van</option><option value="car">Car</option><option value="suv">SUV</option>
        </select></td></tr>
        <tr><td><label>Capacity</label></td><td><input name="capacity" type="number" min="1" value="50" style="width:120px;padding:8px;"></td></tr>
        <tr><td><label>Driver Name</label></td><td><input name="driver_name" style="width:250px;padding:8px;"></td></tr>
        <tr><td><label>Driver Phone</label></td><td><input name="driver_phone" style="width:200px;padding:8px;"></td></tr>
        <tr><td><label>Insurance Expiry</label></td><td><input name="insurance_expiry" type="date" style="padding:8px;"></td></tr>
        <tr><td><label>Next Service Date</label></td><td><input name="next_service" type="date" style="padding:8px;"></td></tr>
        <tr><td><label>Status</label></td><td><select name="status" style="padding:8px;">
          <option value="active">Active</option><option value="maintenance">Maintenance</option><option value="inactive">Inactive</option>
        </select></td></tr>
      </table><br>
      <button type="submit" class="btn btn-green">Save Vehicle</button>
      <a href="${navUrl('/vehicles')}" class="btn btn-sm">Cancel</a>
    </form></div>`;
    res.send(renderPage('Add Vehicle', html, req.session.user, req));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 4 — Save vehicle
  // ═══════════════════════════════════════════════════════════════════════════
  app.post('/transport/vehicles/create', requireAuth, requireSubscription('basic'), async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { plate_number, vehicle_type, capacity, driver_name, driver_phone,
            insurance_expiry, next_service, status } = req.body;
    if (!plate_number || !plate_number.trim()) {
      return res.send('<div class="alert">Plate number is required.</div><a href="javascript:history.back()">Go back</a>');
    }
    const dup = await pool.query(
      'SELECT id FROM transport_vehicles WHERE tenant_id=$1 AND plate_number=$2', [tid, plate_number.trim()]);
    if (dup.rows.length) {
      return res.send('<div class="alert">A vehicle with this plate number already exists.</div><a href="javascript:history.back()">Go back</a>');
    }
    await pool.query(
      `INSERT INTO transport_vehicles (tenant_id,plate_number,vehicle_type,capacity,driver_name,driver_phone,insurance_expiry,next_service,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [tid, plate_number.trim(), vehicle_type||'bus', parseInt(capacity)||50,
        driver_name||null, driver_phone||null, insurance_expiry||null, next_service||null, status||'active']);
    res.redirect(navUrl('/vehicles'));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 5 — Route management list
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/transport/routes', requireAuth, requireSubscription('basic'), async (req, res) => {
    const tid = req.session.user.tenant_id;
    const result = await pool.query(
      `SELECT r.*, v.plate_number AS vehicle_plate, v.driver_name AS driver_name,
        (SELECT COUNT(*)::int FROM transport_passengers p WHERE p.route_id=r.id AND p.status='active') AS pax_count,
        COALESCE(v.capacity,0) AS vehicle_capacity
       FROM transport_routes r LEFT JOIN transport_vehicles v ON v.id=r.vehicle_id
       WHERE r.tenant_id=$1 ORDER BY r.name`, [tid]);

    let html = nav('Routes');
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">' +
      '<h2>Transport Routes</h2>' + `<a href="${navUrl('/routes/new')}" class="btn btn-green">+ Add Route</a></div>`;

    if (result.rows.length) {
      html += '<table><tr><th>Route</th><th>Vehicle</th><th>Driver</th>' +
        '<th>Passengers</th><th>Fare</th><th>Distance</th><th>Status</th><th>Actions</th></tr>';
      result.rows.forEach(r => {
        const sb = r.is_active ? '<span class="badge badge-success">Active</span>' : '<span class="badge badge-warning">Inactive</span>';
        const fp = r.vehicle_capacity > 0 ? ((r.pax_count/r.vehicle_capacity)*100).toFixed(0) : '—';
        const sc = (r.stops||[]).length;
        html += `<tr>
          <td><strong><a href="${navUrl('/routes/'+r.id)}">${esc(r.name)}</a></strong><br><small class="muted">${sc} stop${sc!==1?'s':''}</small></td>
          <td>${esc(r.vehicle_plate||'Unassigned')}</td><td>${esc(r.driver_name||'—')}</td>
          <td>${r.pax_count}/${r.vehicle_capacity} (${fp}%)</td>
          <td>$${parseFloat(r.fare||0).toFixed(2)}</td>
          <td>${r.distance_km ? r.distance_km+' km' : '—'}</td>
          <td>${sb}</td><td><a href="${navUrl('/routes/'+r.id)}" class="btn btn-sm btn-blue">View</a></td>
        </tr>`;
      });
      html += '</table>';
    } else { html += '<div class="card"><p class="muted">No routes configured yet.</p></div>'; }
    res.send(renderPage('Transport Routes', html, req.session.user, req));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 6 — Add route form
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/transport/routes/new', requireAuth, requireSubscription('basic'), async (req, res) => {
    const tid = req.session.user.tenant_id;
    const vehs = await pool.query(
      "SELECT id, plate_number, vehicle_type, driver_name FROM transport_vehicles WHERE tenant_id=$1 AND status='active' ORDER BY plate_number", [tid]);

    let html = nav('Routes');
    html += '<div class="card"><h2>Add New Route</h2>';
    html += `<form method="POST" action="${navUrl('/routes/create')}">
      <table>
        <tr><td><label>Route Name *</label></td><td><input name="name" required style="width:300px;padding:8px;" placeholder="e.g. North Campus Loop"></td></tr>
        <tr><td><label>Description</label></td><td><textarea name="description" rows="2" style="width:100%;max-width:400px;padding:8px;"></textarea></td></tr>
        <tr><td><label>Stops</label></td><td><textarea name="stops" rows="4" style="width:100%;max-width:400px;padding:8px;"
          placeholder="One stop per line&#10;Main Gate&#10;Library Junction&#10;North Campus"></textarea><br><small class="muted">One stop per line</small></td></tr>
        <tr><td><label>Estimated Time</label></td><td><input name="estimated_time" style="width:150px;padding:8px;" placeholder="e.g. 45 min"></td></tr>
        <tr><td><label>Distance (km)</label></td><td><input name="distance_km" type="number" step="0.01" min="0" style="width:150px;padding:8px;"></td></tr>
        <tr><td><label>Fare</label></td><td><input name="fare" type="number" step="0.01" min="0" value="0" style="width:150px;padding:8px;"></td></tr>
        <tr><td><label>Assign Vehicle</label></td><td><select name="vehicle_id" style="padding:8px;">
          <option value="">-- None --</option>
          ${vehs.rows.map(v=>`<option value="${v.id}">${esc(v.plate_number)} (${esc(v.vehicle_type)}) - ${esc(v.driver_name||'No driver')}</option>`).join('')}
        </select></td></tr>
        <tr><td><label><input type="checkbox" name="is_active" checked> Active</label></td><td></td></tr>
      </table><br>
      <button type="submit" class="btn btn-green">Save Route</button>
      <a href="${navUrl('/routes')}" class="btn btn-sm">Cancel</a>
    </form></div>`;
    res.send(renderPage('Add Route', html, req.session.user, req));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 7 — Save route
  // ═══════════════════════════════════════════════════════════════════════════
  app.post('/transport/routes/create', requireAuth, requireSubscription('basic'), async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { name, description, stops, estimated_time, distance_km, fare, vehicle_id, is_active } = req.body;
    if (!name || !name.trim()) {
      return res.send('<div class="alert">Route name is required.</div><a href="javascript:history.back()">Go back</a>');
    }
    const stopsArr = stops ? stops.split('\n').map(s=>s.trim()).filter(Boolean) : [];
    await pool.query(
      `INSERT INTO transport_routes (tenant_id,name,description,stops,estimated_time,distance_km,fare,vehicle_id,is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [tid, name.trim(), description||null, stopsArr,
        estimated_time||null, parseFloat(distance_km)||null,
        parseFloat(fare)||0, vehicle_id||null, is_active!==undefined && is_active!=='false']);
    res.redirect(navUrl('/routes'));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 8 — Route detail with stops and passengers
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/transport/routes/:id', requireAuth, requireSubscription('basic'), async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { id } = req.params;
    const route = await pool.query(
      `SELECT r.*, v.plate_number, v.driver_name, v.driver_phone, v.capacity AS vehicle_capacity, v.vehicle_type
       FROM transport_routes r LEFT JOIN transport_vehicles v ON v.id=r.vehicle_id
       WHERE r.id=$1 AND r.tenant_id=$2`, [id, tid]);
    if (!route.rows.length) return res.status(404).send('Route not found.');
    const r = route.rows[0];

    const pax = await pool.query(
      "SELECT * FROM transport_passengers WHERE route_id=$1 AND tenant_id=$2 AND status='active' ORDER BY stop_name, passenger_name", [id, tid]);
    const avVehs = await pool.query(
      "SELECT id, plate_number, vehicle_type, driver_name, capacity FROM transport_vehicles WHERE tenant_id=$1 AND status='active' ORDER BY plate_number", [tid]);

    const stops = r.stops || [];
    const stopsHtml = stops.length ? '<ol>'+stops.map(s=>`<li>${esc(s)}</li>`).join('')+'</ol>' : '<span class="muted">No stops defined</span>';

    let html = nav('Routes');
    html += `<a href="${navUrl('/routes')}" class="btn btn-sm btn-blue" style="margin-bottom:12px;">&larr; All Routes</a>`;
    html += '<div class="card">';
    html += `<h2>${esc(r.name)}</h2>`;
    html += `<p><strong>Description:</strong> ${esc(r.description||'—')}</p>`;
    html += `<p><strong>Vehicle:</strong> ${esc(r.plate_number||'Unassigned')}${r.driver_name?' &middot; <strong>Driver:</strong> '+esc(r.driver_name):''}${r.driver_phone?' &middot; <strong>Phone:</strong> '+esc(r.driver_phone):''}</p>`;
    html += `<p><strong>Capacity:</strong> ${r.vehicle_capacity||'—'} &middot; <strong>Passengers:</strong> ${pax.rows.length}` +
      ` &middot; <strong>Fare:</strong> $${parseFloat(r.fare||0).toFixed(2)}` +
      ` &middot; <strong>Distance:</strong> ${r.distance_km?r.distance_km+' km':'—'}` +
      ` &middot; <strong>Est. Time:</strong> ${esc(r.estimated_time||'—')}</p>`;
    html += `<p><strong>Status:</strong> ${r.is_active?'<span class="badge badge-success">Active</span>':'<span class="badge badge-warning">Inactive</span>'}</p>`;
    html += '</div>';

    // Stops
    html += '<div class="card"><h3>Route Stops</h3>' + stopsHtml + '</div>';

    // Assign vehicle
    html += '<div class="card"><h3>Assign Vehicle</h3>';
    html += `<form method="POST" action="${navUrl('/routes/'+id+'/assign-vehicle')}" style="display:inline;">
      <select name="vehicle_id" style="padding:8px;">
        <option value="">-- Unassign --</option>
        ${avVehs.rows.map(v=>`<option value="${v.id}" ${String(v.id)===String(r.vehicle_id)?'selected':''}>${esc(v.plate_number)} (${esc(v.vehicle_type)}) — ${esc(v.driver_name||'No driver')}, cap ${v.capacity}</option>`).join('')}
      </select> <button type="submit" class="btn btn-sm btn-gold">Update</button>
    </form></div>`;

    // Passengers
    html += `<div class="card" style="margin-top:20px;"><h3>Passengers (${pax.rows.length})</h3>`;
    if (pax.rows.length) {
      html += '<table><tr><th>Name</th><th>ID</th><th>Stop</th><th>Parent Phone</th><th>Actions</th></tr>';
      pax.rows.forEach(p => {
        html += `<tr><td>${esc(p.passenger_name)}</td><td>${esc(p.passenger_id||'—')}</td>` +
          `<td>${esc(p.stop_name||'—')}</td><td>${esc(p.parent_phone||'—')}</td>` +
          `<td><form method="POST" action="${navUrl('/passengers/'+p.id+'/remove')}" style="display:inline" ` +
          `onsubmit="return confirm('Remove ${esc(p.passenger_name)}?')">` +
          `<button class="btn btn-sm btn-red">Remove</button></form></td></tr>`;
      });
      html += '</table>';
    } else { html += '<p class="muted">No passengers on this route yet.</p>'; }
    html += '</div>';

    // Add passenger
    html += '<div class="card" style="margin-top:20px;"><h3>Add Passenger</h3>';
    html += `<form method="POST" action="${navUrl('/passengers/add')}">
      <input type="hidden" name="route_id" value="${r.id}">
      <table>
        <tr><td><label>Passenger Name *</label></td><td><input name="passenger_name" required style="width:250px;padding:8px;"></td></tr>
        <tr><td><label>Passenger ID</label></td><td><input name="passenger_id" style="width:200px;padding:8px;"></td></tr>
        <tr><td><label>Stop</label></td><td><select name="stop_name" style="padding:8px;">
          <option value="">-- Select --</option>
          ${stops.map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join('')}
        </select> <input name="stop_name_custom" style="width:200px;padding:8px;" placeholder="Or custom"></td></tr>
        <tr><td><label>Parent Phone</label></td><td><input name="parent_phone" style="width:200px;padding:8px;"></td></tr>
      </table><br>
      <button type="submit" class="btn btn-green">Add Passenger</button>
    </form></div>`;
    res.send(renderPage('Route: ' + r.name, html, req.session.user, req));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 9 — Assign vehicle to route
  // ═══════════════════════════════════════════════════════════════════════════
  app.post('/transport/routes/:id/assign-vehicle', requireAuth, requireSubscription('basic'), async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { id } = req.params;
    const { vehicle_id } = req.body;
    const rc = await pool.query('SELECT id FROM transport_routes WHERE id=$1 AND tenant_id=$2', [id, tid]);
    if (!rc.rows.length) return res.status(404).send('Route not found.');
    const vid = vehicle_id && vehicle_id.trim() ? parseInt(vehicle_id) : null;
    if (vid) {
      const vc = await pool.query('SELECT id FROM transport_vehicles WHERE id=$1 AND tenant_id=$2', [vid, tid]);
      if (!vc.rows.length) return res.status(404).send('Vehicle not found.');
    }
    await pool.query('UPDATE transport_routes SET vehicle_id=$1 WHERE id=$2 AND tenant_id=$3', [vid, id, tid]);
    res.redirect(navUrl('/routes/' + id));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 10 — Add passenger to route
  // ═══════════════════════════════════════════════════════════════════════════
  app.post('/transport/passengers/add', requireAuth, requireSubscription('basic'), async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { route_id, passenger_name, passenger_id, stop_name, stop_name_custom, parent_phone } = req.body;
    if (!passenger_name || !passenger_name.trim() || !route_id) {
      return res.send('<div class="alert">Passenger name and route are required.</div><a href="javascript:history.back()">Go back</a>');
    }
    const rc = await pool.query('SELECT id FROM transport_routes WHERE id=$1 AND tenant_id=$2', [route_id, tid]);
    if (!rc.rows.length) return res.status(404).send('Route not found.');
    const routeData = await pool.query('SELECT id, name, fare FROM transport_routes WHERE id=$1 AND tenant_id=$2', [route_id, tid]);
    const fare = parseFloat(routeData.rows[0]?.fare || 0);
    const routeName = routeData.rows[0]?.name || route_id;
    const finalStop = (stop_name_custom && stop_name_custom.trim()) ? stop_name_custom.trim() : (stop_name || null);
    await pool.query(
      `INSERT INTO transport_passengers (tenant_id,route_id,passenger_name,passenger_id,stop_name,parent_phone)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [tid, route_id, passenger_name.trim(), passenger_id||null, finalStop, parent_phone||null]);
    try { await global.trackRevenue('transport_fare', fare, `Transport fare for ${passenger_name.trim()} on route ${routeName}`, `transport-${route_id}-${Date.now()}`); } catch(e) {}
    res.redirect(navUrl('/routes/' + route_id));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 11 — Remove passenger
  // ═══════════════════════════════════════════════════════════════════════════
  app.post('/transport/passengers/:id/remove', requireAuth, requireSubscription('basic'), async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { id } = req.params;
    const p = await pool.query(
      "SELECT route_id FROM transport_passengers WHERE id=$1 AND tenant_id=$2 AND status='active'", [id, tid]);
    if (!p.rows.length) return res.status(404).send('Passenger not found.');
    await pool.query("UPDATE transport_passengers SET status='removed' WHERE id=$1 AND tenant_id=$2", [id, tid]);
    res.redirect(navUrl('/routes/' + p.rows[0].route_id));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 12 — Incident log
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/transport/incidents', requireAuth, requireSubscription('basic'), async (req, res) => {
    const tid = req.session.user.tenant_id;
    const flt = req.query.filter || '';
    let where = 'i.tenant_id=$1', params = [tid];
    if (flt === 'open') where += ' AND i.resolved=false';
    else if (flt === 'resolved') where += ' AND i.resolved=true';

    const incidents = await pool.query(
      `SELECT i.*, v.plate_number, v.vehicle_type FROM transport_incidents i
       LEFT JOIN transport_vehicles v ON v.id=i.vehicle_id
       WHERE ${where} ORDER BY i.date DESC NULLS LAST, i.created_at DESC`, params);
    const vehs = await pool.query(
      "SELECT id, plate_number, vehicle_type FROM transport_vehicles WHERE tenant_id=$1 AND status='active' ORDER BY plate_number", [tid]);

    let html = nav('Incidents');
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">' +
      '<h2>Incident Log</h2><div><a href="#report-form" class="btn btn-gold">+ Report Incident</a></div></div>';

    [['','All'],['open','Open'],['resolved','Resolved']].forEach(([v,l]) => {
      html += `<a href="${navUrl('/incidents?filter='+v)}" class="btn btn-sm ${flt===v?'btn-green':''}">${l}</a> `;
    });
    html += '<br><br>';

    const openC = incidents.rows.filter(i=>!i.resolved).length;
    const resC = incidents.rows.filter(i=>i.resolved).length;
    html += '<div class="stats">';
    html += `<div class="stat-card"><div class="stat-num">${incidents.rows.length}</div><div>Total</div></div>`;
    html += `<div class="stat-card"><div class="stat-num">${openC}</div><div>Open</div></div>`;
    html += `<div class="stat-card"><div class="stat-num">${resC}</div><div>Resolved</div></div>`;
    html += '</div>';

    if (incidents.rows.length) {
      html += '<table><tr><th>ID</th><th>Type</th><th>Vehicle</th><th>Description</th><th>Date</th><th>By</th><th>Status</th></tr>';
      incidents.rows.forEach(i => {
        const sb = i.resolved ? '<span class="badge badge-success">Resolved</span>' : '<span class="badge badge-warning">Open</span>';
        const tb = (i.incident_type==='accident'||i.incident_type==='breakdown')
          ? '<span class="badge badge-warning">'+esc(i.incident_type)+'</span>'
          : '<span class="badge">'+esc(i.incident_type||'Other')+'</span>';
        const desc = (i.description||'').substring(0,80);
        html += `<tr><td>#${i.id}</td><td>${tb}</td><td>${esc(i.plate_number||'—')}</td>` +
          `<td>${esc(desc)}${(i.description||'').length>80?'…':''}</td>` +
          `<td>${fmtDate(i.date)}</td><td>${esc(i.reported_by||'—')}</td><td>${sb}</td></tr>`;
      });
      html += '</table>';
    } else { html += '<p class="muted">No incidents recorded.</p>'; }

    // Report form
    html += `<div id="report-form" class="card" style="margin-top:24px;"><h3>Report New Incident</h3>
      <form method="POST" action="${navUrl('/incidents/new')}">
        <table>
          <tr><td><label>Vehicle</label></td><td><select name="vehicle_id" style="padding:8px;">
            <option value="">-- Select --</option>
            ${vehs.rows.map(v=>`<option value="${v.id}">${esc(v.plate_number)} (${esc(v.vehicle_type)})</option>`).join('')}
          </select></td></tr>
          <tr><td><label>Type</label></td><td><select name="incident_type" style="padding:8px;">
            <option value="breakdown">Breakdown</option><option value="accident">Accident</option>
            <option value="delay">Delay</option><option value="traffic_violation">Traffic Violation</option>
            <option value="flat_tire">Flat Tire</option><option value="other">Other</option>
          </select></td></tr>
          <tr><td><label>Date</label></td><td><input name="date" type="datetime-local" style="padding:8px;"></td></tr>
          <tr><td><label>Description *</label></td><td><textarea name="description" rows="3" style="width:100%;max-width:400px;padding:8px;" required></textarea></td></tr>
          <tr><td><label>Reported By</label></td><td><input name="reported_by" value="${esc(req.session.user.name||'')}" style="width:250px;padding:8px;"></td></tr>
        </table><br>
        <button type="submit" class="btn btn-green">Submit Report</button>
      </form></div>`;
    res.send(renderPage('Incident Log', html, req.session.user, req));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 13 — Report incident
  // ═══════════════════════════════════════════════════════════════════════════
  app.post('/transport/incidents/new', requireAuth, requireSubscription('basic'), async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { vehicle_id, incident_type, date, description, reported_by } = req.body;
    if (!description || !description.trim()) {
      return res.send('<div class="alert">Description is required.</div><a href="javascript:history.back()">Go back</a>');
    }
    await pool.query(
      `INSERT INTO transport_incidents (tenant_id,vehicle_id,incident_type,description,date,reported_by)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [tid, vehicle_id||null, incident_type||'other', description.trim(), date||null, reported_by||null]);
    res.redirect(navUrl('/incidents'));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 14 — Transport reports
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/transport/report', requireAuth, requireSubscription('basic'), async (req, res) => {
    const tid = req.session.user.tenant_id;

    const [vUtil, paxRoute, stopPop, typeBreak, incSummary, routeStats] = await Promise.all([
      pool.query(`
        SELECT v.id, v.plate_number, v.vehicle_type, v.capacity, v.status,
          (SELECT COUNT(DISTINCT r.id)::int FROM transport_routes r WHERE r.vehicle_id=v.id AND r.is_active=true) AS routes_assigned,
          (SELECT COUNT(*)::int FROM transport_passengers p JOIN transport_routes r ON r.id=p.route_id
            WHERE r.vehicle_id=v.id AND p.status='active') AS total_pax
        FROM transport_vehicles v WHERE v.tenant_id=$1 ORDER BY v.vehicle_type, v.plate_number`, [tid]),
      pool.query(`
        SELECT r.id, r.name, r.is_active, COALESCE(v.plate_number,'Unassigned') AS vp,
          COALESCE(v.capacity,0) AS vcap,
          COUNT(p.id)::int AS pax_cnt, COUNT(p.id) FILTER (WHERE p.stop_name IS NOT NULL)::int AS with_stop
        FROM transport_routes r LEFT JOIN transport_vehicles v ON v.id=r.vehicle_id
        LEFT JOIN transport_passengers p ON p.route_id=r.id AND p.status='active'
        WHERE r.tenant_id=$1 GROUP BY r.id,r.name,r.is_active,v.plate_number,v.capacity
        ORDER BY pax_cnt DESC`, [tid]),
      pool.query(`
        SELECT stop_name, COUNT(*)::int AS cnt FROM transport_passengers
        WHERE tenant_id=$1 AND status='active' AND stop_name IS NOT NULL AND stop_name!=''
        GROUP BY stop_name ORDER BY cnt DESC LIMIT 15`, [tid]),
      pool.query(`
        SELECT vehicle_type, COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status='active')::int AS active, SUM(capacity)::int AS cap
        FROM transport_vehicles WHERE tenant_id=$1 GROUP BY vehicle_type ORDER BY vehicle_type`, [tid]),
      pool.query(`
        SELECT incident_type, COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE resolved=false)::int AS open,
          COUNT(*) FILTER (WHERE resolved=true)::int AS resolved
        FROM transport_incidents WHERE tenant_id=$1 AND incident_type IS NOT NULL
        GROUP BY incident_type ORDER BY total DESC`, [tid]),
      pool.query(`
        SELECT COUNT(*)::int AS total_routes,
          COUNT(*) FILTER (WHERE is_active=true)::int AS active_routes,
          COALESCE(SUM(distance_km),0)::numeric AS total_dist,
          COALESCE(AVG(distance_km),0)::numeric AS avg_dist,
          COALESCE(SUM(fare),0)::numeric AS total_fare,
          COALESCE(AVG(fare),0)::numeric AS avg_fare
        FROM transport_routes WHERE tenant_id=$1`, [tid]),
    ]);

    const rs = routeStats.rows[0];
    const totalPax = paxRoute.rows.reduce((s,r)=>s+r.pax_cnt, 0);
    const activeV = vUtil.rows.filter(v=>v.status==='active').length;
    const unassigned = paxRoute.rows.filter(r=>r.vp==='Unassigned'&&r.is_active).length;

    let html = nav('Reports');
    html += '<h2>Transport Reports</h2>';
    html += '<div class="stats">';
    html += `<div class="stat-card"><div class="stat-num">${vUtil.rows.length}</div><div>Vehicles</div></div>`;
    html += `<div class="stat-card"><div class="stat-num">${activeV}</div><div>Active</div></div>`;
    html += `<div class="stat-card"><div class="stat-num">${rs.active_routes}</div><div>Active Routes</div></div>`;
    html += `<div class="stat-card"><div class="stat-num">${totalPax}</div><div>Passengers</div></div>`;
    html += `<div class="stat-card"><div class="stat-num">${unassigned}</div><div>Unassigned Routes</div></div>`;
    html += '</div>';

    // Vehicle utilization
    html += '<div class="card"><h3>Vehicle Utilization</h3>';
    if (vUtil.rows.length) {
      html += '<table><tr><th>Plate</th><th>Type</th><th>Status</th><th>Cap</th><th>Routes</th><th>Pax</th><th>Util %</th></tr>';
      vUtil.rows.forEach(v => {
        const u = v.capacity>0 ? ((v.total_pax/v.capacity)*100).toFixed(0) : '—';
        const sb = v.status==='active' ? '<span class="badge badge-success">Active</span>'
          : v.status==='maintenance' ? '<span class="badge badge-warning">Maint.</span>'
          : '<span class="badge">Inactive</span>';
        const wb = v.capacity>0 && (v.total_pax/v.capacity)>0.9 ? ' <span class="badge badge-warning">High</span>' : '';
        html += `<tr><td>${esc(v.plate_number)}</td><td>${esc(v.vehicle_type)}</td><td>${sb}</td>` +
          `<td>${v.capacity}</td><td>${v.routes_assigned}</td><td>${v.total_pax}</td><td>${u}%${wb}</td></tr>`;
      });
      html += '</table>';
    } else { html += '<p class="muted">No vehicle data.</p>'; }
    html += '</div>';

    // Passengers per route
    html += '<div class="card"><h3>Passengers per Route</h3>';
    if (paxRoute.rows.length) {
      html += '<table><tr><th>Route</th><th>Vehicle</th><th>Cap</th><th>Pax</th><th>Fill</th><th>With Stop</th><th>Status</th></tr>';
      paxRoute.rows.forEach(r => {
        const pct = r.vcap>0 ? ((r.pax_cnt/r.vcap)*100).toFixed(0) : '—';
        const sb = r.is_active ? '<span class="badge badge-success">Active</span>' : '<span class="badge badge-warning">Inactive</span>';
        html += `<tr><td><a href="${navUrl('/routes/'+r.id)}">${esc(r.name)}</a></td><td>${esc(r.vp)}</td>` +
          `<td>${r.vcap}</td><td>${r.pax_cnt}</td><td>${pct}%</td><td>${r.with_stop}</td><td>${sb}</td></tr>`;
      });
      html += '</table>';
    } else { html += '<p class="muted">No route data.</p>'; }
    html += '</div>';

    html += '<div class="grid" style="grid-template-columns:1fr 1fr;gap:20px;">';

    // Type breakdown
    html += '<div class="card"><h3>Vehicle Type Breakdown</h3>';
    if (typeBreak.rows.length) {
      html += '<table><tr><th>Type</th><th>Total</th><th>Active</th><th>Capacity</th></tr>';
      typeBreak.rows.forEach(t => {
        html += `<tr><td>${esc(t.vehicle_type)}</td><td>${t.total}</td><td>${t.active}</td><td>${t.cap}</td></tr>`;
      });
      html += '</table>';
    } else { html += '<p class="muted">No data.</p>'; }
    html += '</div>';

    // Popular stops
    html += '<div class="card"><h3>Most Popular Stops</h3>';
    if (stopPop.rows.length) {
      html += '<table><tr><th>Stop</th><th>Passengers</th></tr>';
      stopPop.rows.forEach(s => {
        const pct = totalPax>0 ? ((s.cnt/totalPax)*100).toFixed(1) : 0;
        html += `<tr><td>${esc(s.stop_name)}</td><td>${s.cnt} (${pct}%)</td></tr>`;
      });
      html += '</table>';
    } else { html += '<p class="muted">No stop data.</p>'; }
    html += '</div></div>';

    html += '<div class="grid" style="grid-template-columns:1fr 1fr;gap:20px;margin-top:20px;">';

    // Route stats
    html += '<div class="card"><h3>Route Statistics</h3>';
    html += '<table><tr><th>Metric</th><th>Value</th></tr>';
    html += `<tr><td>Total Routes</td><td>${rs.total_routes}</td></tr>`;
    html += `<tr><td>Active Routes</td><td>${rs.active_routes}</td></tr>`;
    html += `<tr><td>Total Distance</td><td>${parseFloat(rs.total_dist||0).toFixed(2)} km</td></tr>`;
    html += `<tr><td>Avg Distance</td><td>${parseFloat(rs.avg_dist||0).toFixed(2)} km</td></tr>`;
    html += `<tr><td>Total Fare Revenue</td><td>$${parseFloat(rs.total_fare||0).toFixed(2)}</td></tr>`;
    html += `<tr><td>Avg Fare</td><td>$${parseFloat(rs.avg_fare||0).toFixed(2)}</td></tr>`;
    html += '</table></div>';

    // Incident summary
    html += '<div class="card"><h3>Incident Summary</h3>';
    if (incSummary.rows.length) {
      html += '<table><tr><th>Type</th><th>Total</th><th>Open</th><th>Resolved</th></tr>';
      incSummary.rows.forEach(i => {
        html += `<tr><td>${esc(i.incident_type)}</td><td>${i.total}</td><td>${i.open}</td><td>${i.resolved}</td></tr>`;
      });
      html += '</table>';
    } else { html += '<p class="muted">No incidents.</p>'; }
    html += '</div></div>';

    res.send(renderPage('Transport Reports', html, req.session.user, req));
  });

  // ── Boot ──────────────────────────────────────────────────────────────────
  migrate().then(() => {
    console.log('[Transport] Transport management loaded');
  }).catch(err => {
    console.error('[Transport] Migration failed:', err.message);
  });
};
