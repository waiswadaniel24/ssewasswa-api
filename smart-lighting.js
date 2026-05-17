/**
 * Smart Lighting Management Module
 * Multi-tenant SaaS platform (schools)
 *
 * Features: Zone-based lighting control, schedule management, occupancy-based
 *   automation, energy monitoring, manual overrides, classroom lighting presets,
 *   emergency lighting, energy savings reports
 * 10 routes · PostgreSQL · tenant_id scoped
 */
module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5', GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.btn:hover{background:#3730a3}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}</style>';

  // ── Helpers ────────────────────────────────────────────────────────────────
  function navUrl(a) { return '/school/smart-lighting' + a; }
  function fmtDate(d) { return d ? new Date(d).toISOString().split('T')[0] : '—'; }
  function fmtTime(d) { return d ? new Date(d).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '—'; }
  function badge(label, color) { return `<span style="background:${color};color:#fff;padding:2px 10px;border-radius:12px;font-size:12px">${esc(label)}</span>`; }
  function kwh(v) { return parseFloat(v || 0).toFixed(2) + ' kWh'; }

  function nav(active) {
    const links = [
      ['Dashboard', ''], ['Zones', '/zones'], ['Schedules', '/schedules'],
      ['Presets', '/presets'], ['Energy', '/energy'], ['Logs', '/logs'],
      ['Emergency', '/emergency'], ['Settings', '/settings'],
    ];
    return '<nav style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:24px">' +
      links.map(([l, h]) =>
        `<a href="${navUrl(h)}" style="padding:8px 16px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:500;` +
        (active === l ? `background:${P};color:#fff` : `background:#f3f4f6;color:${GRAY}`) + `">${l}</a>`
      ).join('') + '</nav>';
  }

  function alertBox(msg, type) {
    const colors = { success: '#dcfce7', error: '#fee2e2', warning: '#fef3c7', info: '#dbeafe' };
    const borders = { success: '#22c55e', error: '#ef4444', warning: '#f59e0b', info: '#3b82f6' };
    return `<div style="background:${colors[type]||colors.info};border:1px solid ${borders[type]||borders.info};border-radius:8px;padding:12px 16px;margin-bottom:16px;color:#1f2937">${msg}</div>`;
  }

  // ── Database Migration ─────────────────────────────────────────────────────
  (async () => {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS lighting_zones (
          id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          name VARCHAR(100) NOT NULL, location VARCHAR(255), type VARCHAR(50) DEFAULT 'classroom',
          schedule JSONB DEFAULT '{}', auto_mode BOOLEAN DEFAULT true,
          current_state VARCHAR(30) DEFAULT 'off', energy_kwh NUMERIC(10,2) DEFAULT 0,
          brightness INT DEFAULT 0, max_brightness INT DEFAULT 100,
          occupancy_sensor BOOLEAN DEFAULT false, emergency_mode BOOLEAN DEFAULT false,
          created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS lighting_schedules (
          id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          zone_id INTEGER NOT NULL REFERENCES lighting_zones(id) ON DELETE CASCADE,
          day_of_week INT NOT NULL, on_time TIME NOT NULL, off_time TIME NOT NULL,
          brightness INT DEFAULT 100, is_active BOOLEAN DEFAULT true,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS lighting_logs (
          id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          zone_id INTEGER NOT NULL REFERENCES lighting_zones(id) ON DELETE CASCADE,
          action VARCHAR(100) NOT NULL, previous_state TEXT, new_state TEXT,
          triggered_by VARCHAR(50) DEFAULT 'system', timestamp TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS lighting_presets (
          id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          name VARCHAR(100) NOT NULL, description TEXT, brightness INT DEFAULT 100,
          color_temp VARCHAR(20) DEFAULT 'neutral', zones TEXT[],
          is_default BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      const idxs = [
        'CREATE INDEX IF NOT EXISTS idx_lz_tenant ON lighting_zones(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_lz_type ON lighting_zones(type)',
        'CREATE INDEX IF NOT EXISTS idx_ls_tenant ON lighting_schedules(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_ls_zone ON lighting_schedules(zone_id)',
        'CREATE INDEX IF NOT EXISTS idx_ll_tenant ON lighting_logs(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_ll_zone ON lighting_logs(zone_id)',
        'CREATE INDEX IF NOT EXISTS idx_ll_ts ON lighting_logs(timestamp)',
        'CREATE INDEX IF NOT EXISTS idx_lp_tenant ON lighting_presets(tenant_id)',
      ];
      for (const sql of idxs) { try { await pool.query(sql); } catch (_) {} }
      console.log('[SmartLighting] Tables ready');
    } catch (e) { console.warn('[SmartLighting] Migration warning:', e.message); }
  })();

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 1 — Dashboard
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/smart-lighting', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [totalZones, activeZones, emergencyZones, autoZones] = await Promise.all([
      pool.query("SELECT COUNT(*)::int AS c FROM lighting_zones WHERE tenant_id=$1", [tid]),
      pool.query("SELECT COUNT(*)::int AS c FROM lighting_zones WHERE tenant_id=$1 AND current_state='on'", [tid]),
      pool.query("SELECT COUNT(*)::int AS c FROM lighting_zones WHERE tenant_id=$1 AND emergency_mode=true", [tid]),
      pool.query("SELECT COUNT(*)::int AS c FROM lighting_zones WHERE tenant_id=$1 AND auto_mode=true", [tid]),
    ]);
    const energyStats = await pool.query(
      "SELECT COALESCE(SUM(energy_kwh),0)::numeric AS total FROM lighting_zones WHERE tenant_id=$1", [tid]);
    const todayLogs = await pool.query(
      "SELECT COUNT(*)::int AS c FROM lighting_logs WHERE tenant_id=$1 AND timestamp >= CURRENT_DATE", [tid]);
    const recentLogs = await pool.query(
      `SELECT ll.*, lz.name AS zone_name FROM lighting_logs ll
       JOIN lighting_zones lz ON lz.id=ll.zone_id
       WHERE ll.tenant_id=$1 ORDER BY ll.timestamp DESC LIMIT 8`, [tid]);
    const zoneBreakdown = await pool.query(
      "SELECT type, COUNT(*)::int AS c, COALESCE(SUM(energy_kwh),0)::numeric AS energy FROM lighting_zones WHERE tenant_id=$1 GROUP BY type ORDER BY type", [tid]);

    let html = SKIP + nav('Dashboard');
    html += '<h2 style="margin-bottom:20px">Smart Lighting Dashboard</h2>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:16px;margin-bottom:24px">';
    html += `<div class="card" style="text-align:center"><div style="font-size:28px;font-weight:700;color:${P}">${totalZones.rows[0].c}</div><div style="color:${GRAY};font-size:13px">Total Zones</div></div>`;
    html += `<div class="card" style="text-align:center"><div style="font-size:28px;font-weight:700;color:#22c55e">${activeZones.rows[0].c}</div><div style="color:${GRAY};font-size:13px">Active Lights</div></div>`;
    html += `<div class="card" style="text-align:center"><div style="font-size:28px;font-weight:700;color:#3b82f6">${autoZones.rows[0].c}</div><div style="color:${GRAY};font-size:13px">Auto Mode</div></div>`;
    html += `<div class="card" style="text-align:center"><div style="font-size:28px;font-weight:700;color:#ef4444">${emergencyZones.rows[0].c}</div><div style="color:${GRAY};font-size:13px">Emergency</div></div>`;
    html += `<div class="card" style="text-align:center"><div style="font-size:28px;font-weight:700;color:#8b5cf6">${kwh(energyStats.rows[0].total)}</div><div style="color:${GRAY};font-size:13px">Total Energy</div></div>`;
    html += `<div class="card" style="text-align:center"><div style="font-size:28px;font-weight:700;color:#f59e0b">${todayLogs.rows[0].c}</div><div style="color:${GRAY};font-size:13px">Today Events</div></div>`;
    html += '</div>';

    // Zone energy by type
    html += '<div class="card"><h3 style="margin-bottom:12px">Energy by Zone Type</h3>';
    if (zoneBreakdown.rows.length) {
      html += '<table><tr><th>Type</th><th>Zones</th><th>Energy Usage</th><th>Bar</th></tr>';
      const maxEnergy = Math.max(...zoneBreakdown.rows.map(r => parseFloat(r.energy || 0)), 1);
      zoneBreakdown.rows.forEach(z => {
        const pct = ((parseFloat(z.energy || 0) / maxEnergy) * 100).toFixed(0);
        const barColor = pct > 70 ? '#ef4444' : pct > 40 ? '#f59e0b' : '#22c55e';
        html += `<tr><td><strong>${esc(z.type)}</strong></td><td>${z.c}</td><td>${kwh(z.energy)}</td>
          <td><div style="display:flex;align-items:center;gap:6px"><div style="flex:1;background:#e5e7eb;border-radius:4px;height:10px;max-width:200px"><div style="width:${pct}%;background:${barColor};height:10px;border-radius:4px"></div></div><span style="font-size:12px;color:${GRAY}">${pct}%</span></div></td></tr>`;
      });
      html += '</table>';
    } else { html += '<p style="color:#94a3b8">No zones configured yet.</p>'; }
    html += '</div>';

    // Quick zone controls
    const zones = await pool.query("SELECT * FROM lighting_zones WHERE tenant_id=$1 ORDER BY name", [tid]);
    if (zones.rows.length) {
      html += '<div class="card"><h3 style="margin-bottom:12px">Quick Zone Controls</h3>';
      html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px">';
      zones.rows.forEach(z => {
        const stateColor = z.current_state === 'on' ? '#22c55e' : '#94a3b8';
        const isEmerg = z.emergency_mode;
        html += `<div style="border:1px solid ${isEmerg ? '#ef4444' : '#e5e7eb'};border-radius:10px;padding:14px;background:${isEmerg ? '#fef2f2' : '#fafafa'}">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <strong>${esc(z.name)}</strong>
            <span style="width:12px;height:12px;border-radius:50%;background:${stateColor};display:inline-block"></span>
          </div>
          <div style="font-size:12px;color:${GRAY};margin-bottom:8px">${esc(z.location || z.type)}</div>
          <div style="display:flex;gap:6px">
            <form method="POST" action="${navUrl('/zones/' + z.id + '/toggle')}" style="display:inline">
              <button class="btn" style="padding:4px 12px;font-size:12px;background:${z.current_state === 'on' ? '#6b7280' : '#22c55e'}">${z.current_state === 'on' ? 'OFF' : 'ON'}</button>
            </form>
            <a href="${navUrl('/zones/' + z.id)}" class="btn" style="padding:4px 12px;font-size:12px;background:#0ea5e9">Details</a>
          </div>
          ${z.auto_mode ? '<div style="margin-top:6px;font-size:11px;color:#3b82f6">Auto Mode ON</div>' : ''}
        </div>`;
      });
      html += '</div></div>';
    }

    // Recent activity
    if (recentLogs.rows.length) {
      html += '<div class="card"><h3 style="margin-bottom:12px">Recent Activity</h3>';
      html += '<table><tr><th>Zone</th><th>Action</th><th>Triggered By</th><th>Timestamp</th></tr>';
      recentLogs.rows.forEach(l => {
        const actionColor = l.action.includes('on') ? '#22c55e' : l.action.includes('off') ? '#ef4444' : '#f59e0b';
        html += `<tr><td><strong>${esc(l.zone_name)}</strong></td>
          <td>${badge(l.action, actionColor)}</td>
          <td>${esc(l.triggered_by)}</td><td>${fmtTime(l.timestamp)}</td></tr>`;
      });
      html += '</table></div>';
    }

    res.send(renderPage('Smart Lighting Dashboard', html, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 2 — Zones list
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/smart-lighting/zones', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const zones = await pool.query(
      "SELECT * FROM lighting_zones WHERE tenant_id=$1 ORDER BY name", [tid]);

    let html = SKIP + nav('Zones');
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">';
    html += '<h2>Lighting Zones</h2>';
    html += `<a href="${navUrl('/zones/new')}" class="btn">+ Add Zone</a></div>`;

    if (zones.rows.length) {
      html += '<table><tr><th>Name</th><th>Location</th><th>Type</th><th>State</th><th>Brightness</th><th>Energy</th><th>Auto</th><th>Emergency</th><th>Actions</th></tr>';
      zones.rows.forEach(z => {
        const stateColor = z.current_state === 'on' ? '#22c55e' : '#94a3b8';
        html += `<tr>
          <td><strong>${esc(z.name)}</strong></td>
          <td>${esc(z.location || '—')}</td>
          <td>${badge(z.type, '#e0e7ff')}</td>
          <td><span style="display:inline-flex;align-items:center;gap:6px"><span style="width:10px;height:10px;border-radius:50%;background:${stateColor}"></span>${esc(z.current_state)}</span></td>
          <td>${z.brightness}%</td>
          <td>${kwh(z.energy_kwh)}</td>
          <td>${z.auto_mode ? '✅' : '❌'}</td>
          <td>${z.emergency_mode ? badge('EMERGENCY', '#ef4444') : '—'}</td>
          <td>
            <form method="POST" action="${navUrl('/zones/' + z.id + '/toggle')}" style="display:inline">
              <button class="btn" style="padding:4px 10px;font-size:12px;background:${z.current_state === 'on' ? '#6b7280' : '#22c55e'}">${z.current_state === 'on' ? 'OFF' : 'ON'}</button>
            </form>
            <a href="${navUrl('/zones/' + z.id + '/edit')}" class="btn" style="padding:4px 10px;font-size:12px;background:#0ea5e9">Edit</a>
          </td></tr>`;
      });
      html += '</table>';
    } else {
      html += '<div class="card"><p style="color:#94a3b8">No lighting zones configured yet. Create your first zone to get started.</p></div>';
    }
    res.send(renderPage('Lighting Zones', html, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 3 — Create zone form
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/smart-lighting/zones/new', requireAuth, requireNotBanned, (req, res) => {
    let html = SKIP + nav('Zones');
    html += '<div class="card"><h2>Add New Lighting Zone</h2>';
    html += `<form method="POST" action="${navUrl('/zones/create')}">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Zone Name *</label>
          <input name="name" required placeholder="e.g. Classroom 101"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Type</label>
          <select name="type">
            <option value="classroom">Classroom</option><option value="corridor">Corridor/Hallway</option>
            <option value="laboratory">Laboratory</option><option value="library">Library</option>
            <option value="cafeteria">Cafeteria</option><option value="gymnasium">Gymnasium</option>
            <option value="parking">Parking Lot</option><option value="outdoor">Outdoor</option>
            <option value="admin">Admin Office</option><option value="restroom">Restroom</option>
          </select></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Location</label>
          <input name="location" placeholder="e.g. Building A, Floor 2"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Max Brightness (%)</label>
          <input name="max_brightness" type="number" min="10" max="100" value="100"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Default Brightness (%)</label>
          <input name="brightness" type="number" min="0" max="100" value="80"></div>
      </div>
      <div style="margin-top:16px;display:flex;gap:16px">
        <label><input type="checkbox" name="auto_mode" checked> Auto Mode (Occupancy-based)</label>
        <label><input type="checkbox" name="occupancy_sensor"> Occupancy Sensor</label>
      </div>
      <div style="margin-top:16px">
        <button type="submit" class="btn">Create Zone</button>
        <a href="${navUrl('/zones')}" style="margin-left:8px;color:${GRAY}">Cancel</a>
      </div>
    </form></div>`;
    res.send(renderPage('Add Lighting Zone', html, req.session.user, req));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 4 — Save zone
  // ═══════════════════════════════════════════════════════════════════════════
  app.post('/school/smart-lighting/zones/create', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { name, type, location, max_brightness, brightness, auto_mode, occupancy_sensor } = req.body;
    if (!name || !name.trim()) return res.status(400).send('Zone name is required.');
    const result = await pool.query(
      `INSERT INTO lighting_zones (tenant_id, name, location, type, auto_mode, occupancy_sensor, brightness, max_brightness)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [tid, name.trim(), location || null, type || 'classroom',
       auto_mode === 'on', occupancy_sensor === 'on',
       Math.min(parseInt(brightness) || 80, 100), Math.min(parseInt(max_brightness) || 100, 100)]);
    audit(req, 'lighting_zone_created', { zone_id: result.rows[0].id, name: name.trim() });
    await pool.query(
      "INSERT INTO lighting_logs (tenant_id, zone_id, action, new_state, triggered_by) VALUES ($1, $2, $3, $4, $5)",
      [tid, result.rows[0].id, 'zone_created', 'off', 'admin']);
    res.redirect(navUrl('/zones'));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 5 — Toggle zone light
  // ═══════════════════════════════════════════════════════════════════════════
  app.post('/school/smart-lighting/zones/:id/toggle', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { id } = req.params;
    const zone = await pool.query("SELECT * FROM lighting_zones WHERE id=$1 AND tenant_id=$2", [id, tid]);
    if (!zone.rows.length) return res.status(404).send('Zone not found.');
    const z = zone.rows[0];
    const newState = z.current_state === 'on' ? 'off' : 'on';
    const newBrightness = newState === 'on' ? (z.brightness > 0 ? z.brightness : 80) : 0;
    await pool.query(
      "UPDATE lighting_zones SET current_state=$1, brightness=$2, updated_at=NOW() WHERE id=$3 AND tenant_id=$4",
      [newState, newBrightness, id, tid]);
    await pool.query(
      "INSERT INTO lighting_logs (tenant_id, zone_id, action, previous_state, new_state, triggered_by) VALUES ($1, $2, $3, $4, $5, $6)",
      [tid, id, 'manual_toggle', z.current_state, newState, 'manual']);
    audit(req, 'lighting_toggled', { zone_id: id, from: z.current_state, to: newState });
    res.redirect(req.headers.referer || navUrl(''));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 6 — Edit zone form
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/smart-lighting/zones/:id/edit', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const zone = await pool.query("SELECT * FROM lighting_zones WHERE id=$1 AND tenant_id=$2", [req.params.id, tid]);
    if (!zone.rows.length) return res.status(404).send('Zone not found.');
    const z = zone.rows[0];
    let html = SKIP + nav('Zones');
    html += `<div class="card"><h2>Edit Zone: ${esc(z.name)}</h2>`;
    html += `<form method="POST" action="${navUrl('/zones/' + z.id + '/update')}">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Zone Name *</label>
          <input name="name" value="${esc(z.name)}" required></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Type</label>
          <select name="type">
            ${['classroom','corridor','laboratory','library','cafeteria','gymnasium','parking','outdoor','admin','restroom']
              .map(t => `<option value="${t}" ${z.type === t ? 'selected' : ''}>${t.charAt(0).toUpperCase() + t.slice(1)}</option>`).join('')}
          </select></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Location</label>
          <input name="location" value="${esc(z.location || '')}"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Max Brightness (%)</label>
          <input name="max_brightness" type="number" min="10" max="100" value="${z.max_brightness}"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Brightness (%)</label>
          <input name="brightness" type="number" min="0" max="100" value="${z.brightness}"></div>
      </div>
      <div style="margin-top:16px;display:flex;gap:16px">
        <label><input type="checkbox" name="auto_mode" ${z.auto_mode ? 'checked' : ''}> Auto Mode</label>
        <label><input type="checkbox" name="occupancy_sensor" ${z.occupancy_sensor ? 'checked' : ''}> Occupancy Sensor</label>
      </div>
      <div style="margin-top:16px">
        <button type="submit" class="btn">Save Changes</button>
        <a href="${navUrl('/zones')}" style="margin-left:8px;color:${GRAY}">Cancel</a>
      </div>
    </form></div>`;
    res.send(renderPage('Edit Lighting Zone', html, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 7 — Update zone
  // ═══════════════════════════════════════════════════════════════════════════
  app.post('/school/smart-lighting/zones/:id/update', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { id } = req.params;
    const { name, type, location, max_brightness, brightness, auto_mode, occupancy_sensor } = req.body;
    if (!name || !name.trim()) return res.status(400).send('Zone name is required.');
    await pool.query(
      `UPDATE lighting_zones SET name=$1, type=$2, location=$3, max_brightness=$4, brightness=$5,
       auto_mode=$6, occupancy_sensor=$7, updated_at=NOW() WHERE id=$8 AND tenant_id=$9`,
      [name.trim(), type || 'classroom', location || null,
       Math.min(parseInt(max_brightness) || 100, 100), Math.min(parseInt(brightness) || 0, 100),
       auto_mode === 'on', occupancy_sensor === 'on', id, tid]);
    audit(req, 'lighting_zone_updated', { zone_id: id });
    res.redirect(navUrl('/zones'));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 8 — Zone detail
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/smart-lighting/zones/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const zone = await pool.query("SELECT * FROM lighting_zones WHERE id=$1 AND tenant_id=$2", [req.params.id, tid]);
    if (!zone.rows.length) return res.status(404).send('Zone not found.');
    const z = zone.rows[0];
    const schedules = await pool.query(
      "SELECT * FROM lighting_schedules WHERE zone_id=$1 AND tenant_id=$2 ORDER BY day_of_week, on_time", [z.id, tid]);
    const logs = await pool.query(
      "SELECT * FROM lighting_logs WHERE zone_id=$1 AND tenant_id=$2 ORDER BY timestamp DESC LIMIT 20", [z.id, tid]);
    const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

    let html = SKIP + nav('Zones');
    html += `<a href="${navUrl('/zones')}" style="color:${P};text-decoration:none;margin-bottom:12px;display:inline-block">&larr; Back to Zones</a>`;
    html += `<div class="card"><h2>${esc(z.name)}</h2>`;
    html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-top:12px">';
    html += `<div><strong>Location:</strong> ${esc(z.location || '—')}</div>`;
    html += `<div><strong>Type:</strong> ${badge(z.type, '#e0e7ff')}</div>`;
    html += `<div><strong>State:</strong> ${badge(z.current_state, z.current_state === 'on' ? '#22c55e' : '#94a3b8')}</div>`;
    html += `<div><strong>Brightness:</strong> ${z.brightness}%</div>`;
    html += `<div><strong>Energy Used:</strong> ${kwh(z.energy_kwh)}</div>`;
    html += `<div><strong>Auto Mode:</strong> ${z.auto_mode ? 'Yes' : 'No'}</div>`;
    html += `<div><strong>Occupancy Sensor:</strong> ${z.occupancy_sensor ? 'Yes' : 'No'}</div>`;
    html += `<div><strong>Emergency:</strong> ${z.emergency_mode ? badge('ACTIVE', '#ef4444') : 'Normal'}</div>`;
    html += '</div>';

    // Brightness slider
    html += `<form method="POST" action="${navUrl('/zones/' + z.id + '/brightness')}" style="margin-top:20px">
      <label style="font-weight:600">Adjust Brightness: <span id="bVal">${z.brightness}%</span></label>
      <input type="range" name="brightness" min="0" max="${z.max_brightness}" value="${z.brightness}" style="width:100%;margin:8px 0"
        oninput="document.getElementById('bVal').textContent=this.value+'%'" ${z.current_state === 'off' ? 'disabled' : ''}>
      <button type="submit" class="btn" style="margin-top:8px">Apply Brightness</button>
    </form>`;
    html += '</div>';

    // Schedules
    html += '<div class="card"><h3 style="margin-bottom:12px">Schedules</h3>';
    if (schedules.rows.length) {
      html += '<table><tr><th>Day</th><th>On Time</th><th>Off Time</th><th>Brightness</th><th>Status</th><th>Actions</th></tr>';
      schedules.rows.forEach(s => {
        html += `<tr><td>${dayNames[s.day_of_week] || s.day_of_week}</td>
          <td>${s.on_time}</td><td>${s.off_time}</td><td>${s.brightness}%</td>
          <td>${s.is_active ? badge('Active', '#22c55e') : badge('Inactive', '#94a3b8')}</td>
          <td>
            <form method="POST" action="${navUrl('/schedules/' + s.id + '/toggle')}" style="display:inline">
              <button class="btn" style="padding:4px 10px;font-size:12px;background:${s.is_active ? '#6b7280' : '#22c55e'}">${s.is_active ? 'Disable' : 'Enable'}</button>
            </form>
            <form method="POST" action="${navUrl('/schedules/' + s.id + '/delete')}" style="display:inline" onsubmit="return confirm('Delete this schedule?')">
              <button class="btn" style="padding:4px 10px;font-size:12px;background:#ef4444">Delete</button>
            </form>
          </td></tr>`;
      });
      html += '</table>';
    } else { html += '<p style="color:#94a3b8">No schedules configured for this zone.</p>'; }
    html += `<a href="${navUrl('/schedules/new?zone_id=' + z.id)}" class="btn" style="margin-top:12px;display:inline-block">+ Add Schedule</a>`;
    html += '</div>';

    // Activity logs
    if (logs.rows.length) {
      html += '<div class="card"><h3 style="margin-bottom:12px">Activity Log</h3>';
      html += '<table><tr><th>Action</th><th>Previous State</th><th>New State</th><th>Triggered By</th><th>Timestamp</th></tr>';
      logs.rows.forEach(l => {
        html += `<tr><td><strong>${esc(l.action)}</strong></td><td>${esc(l.previous_state || '—')}</td>
          <td>${esc(l.new_state || '—')}</td><td>${esc(l.triggered_by)}</td><td>${fmtTime(l.timestamp)}</td></tr>`;
      });
      html += '</table></div>';
    }

    res.send(renderPage('Zone Details', html, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 9 — Adjust brightness
  // ═══════════════════════════════════════════════════════════════════════════
  app.post('/school/smart-lighting/zones/:id/brightness', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { id } = req.params;
    const { brightness } = req.body;
    const zone = await pool.query("SELECT * FROM lighting_zones WHERE id=$1 AND tenant_id=$2", [id, tid]);
    if (!zone.rows.length) return res.status(404).send('Zone not found.');
    const prev = zone.rows[0].brightness;
    const newBri = Math.min(Math.max(parseInt(brightness) || 0, 0), zone.rows[0].max_brightness);
    await pool.query("UPDATE lighting_zones SET brightness=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3", [newBri, id, tid]);
    await pool.query(
      "INSERT INTO lighting_logs (tenant_id, zone_id, action, previous_state, new_state, triggered_by) VALUES ($1,$2,$3,$4,$5,$6)",
      [tid, id, 'brightness_adjusted', prev + '%', newBri + '%', 'manual']);
    res.redirect(navUrl('/zones/' + id));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 10 — Schedules management
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/smart-lighting/schedules', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const schedules = await pool.query(
      `SELECT ls.*, lz.name AS zone_name FROM lighting_schedules ls
       JOIN lighting_zones lz ON lz.id=ls.zone_id
       WHERE ls.tenant_id=$1 ORDER BY lz.name, ls.day_of_week, ls.on_time`, [tid]);
    const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

    let html = SKIP + nav('Schedules');
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">';
    html += '<h2>Lighting Schedules</h2>';
    html += `<a href="${navUrl('/schedules/new')}" class="btn">+ Add Schedule</a></div>`;

    if (schedules.rows.length) {
      html += '<table><tr><th>Zone</th><th>Day</th><th>On Time</th><th>Off Time</th><th>Brightness</th><th>Status</th><th>Actions</th></tr>';
      schedules.rows.forEach(s => {
        html += `<tr><td><strong>${esc(s.zone_name)}</strong></td><td>${dayNames[s.day_of_week]}</td>
          <td>${s.on_time}</td><td>${s.off_time}</td><td>${s.brightness}%</td>
          <td>${s.is_active ? badge('Active', '#22c55e') : badge('Inactive', '#94a3b8')}</td>
          <td>
            <form method="POST" action="${navUrl('/schedules/' + s.id + '/toggle')}" style="display:inline">
              <button class="btn" style="padding:4px 10px;font-size:12px;background:${s.is_active ? '#6b7280' : '#22c55e'}">${s.is_active ? 'Disable' : 'Enable'}</button>
            </form>
            <form method="POST" action="${navUrl('/schedules/' + s.id + '/delete')}" style="display:inline" onsubmit="return confirm('Delete?')">
              <button class="btn" style="padding:4px 10px;font-size:12px;background:#ef4444">Delete</button>
            </form>
          </td></tr>`;
      });
      html += '</table>';
    } else { html += '<div class="card"><p style="color:#94a3b8">No schedules configured yet.</p></div>'; }
    res.send(renderPage('Lighting Schedules', html, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 11 — New schedule form
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/smart-lighting/schedules/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const zones = await pool.query("SELECT id, name FROM lighting_zones WHERE tenant_id=$1 ORDER BY name", [tid]);
    const preselectedZone = req.query.zone_id || '';
    const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

    let html = SKIP + nav('Schedules');
    html += '<div class="card"><h2>Add New Schedule</h2>';
    html += `<form method="POST" action="${navUrl('/schedules/create')}">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Zone *</label>
          <select name="zone_id" required>
            <option value="">Select Zone</option>
            ${zones.rows.map(z => `<option value="${z.id}" ${z.id == preselectedZone ? 'selected' : ''}>${esc(z.name)}</option>`).join('')}
          </select></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Day of Week *</label>
          <select name="day_of_week" required>
            ${dayNames.map((d, i) => `<option value="${i}">${d}</option>`).join('')}
          </select></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">On Time *</label>
          <input name="on_time" type="time" required value="07:00"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Off Time *</label>
          <input name="off_time" type="time" required value="17:00"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Brightness (%)</label>
          <input name="brightness" type="number" min="0" max="100" value="100"></div>
      </div>
      <div style="margin-top:16px">
        <label><input type="checkbox" name="is_active" checked> Active</label>
      </div>
      <div style="margin-top:16px">
        <button type="submit" class="btn">Create Schedule</button>
        <a href="${navUrl('/schedules')}" style="margin-left:8px;color:${GRAY}">Cancel</a>
      </div>
    </form></div>`;
    res.send(renderPage('Add Lighting Schedule', html, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 12 — Save schedule
  // ═══════════════════════════════════════════════════════════════════════════
  app.post('/school/smart-lighting/schedules/create', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { zone_id, day_of_week, on_time, off_time, brightness, is_active } = req.body;
    if (!zone_id) return res.status(400).send('Zone is required.');
    await pool.query(
      `INSERT INTO lighting_schedules (tenant_id, zone_id, day_of_week, on_time, off_time, brightness, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [tid, parseInt(zone_id), parseInt(day_of_week), on_time, off_time,
       Math.min(parseInt(brightness) || 100, 100), is_active !== undefined && is_active !== 'false']);
    audit(req, 'lighting_schedule_created', { zone_id, day_of_week });
    res.redirect(navUrl('/schedules'));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 13 — Toggle schedule
  // ═══════════════════════════════════════════════════════════════════════════
  app.post('/school/smart-lighting/schedules/:id/toggle', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { id } = req.params;
    const sch = await pool.query("SELECT is_active FROM lighting_schedules WHERE id=$1 AND tenant_id=$2", [id, tid]);
    if (!sch.rows.length) return res.status(404).send('Schedule not found.');
    await pool.query("UPDATE lighting_schedules SET is_active=NOT is_active WHERE id=$1 AND tenant_id=$2", [id, tid]);
    res.redirect(req.headers.referer || navUrl('/schedules'));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 14 — Delete schedule
  // ═══════════════════════════════════════════════════════════════════════════
  app.post('/school/smart-lighting/schedules/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query("DELETE FROM lighting_schedules WHERE id=$1 AND tenant_id=$2", [req.params.id, tid]);
    res.redirect(req.headers.referer || navUrl('/schedules'));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 15 — Presets
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/smart-lighting/presets', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const presets = await pool.query(
      "SELECT * FROM lighting_presets WHERE tenant_id=$1 ORDER BY name", [tid]);
    const zones = await pool.query(
      "SELECT id, name FROM lighting_zones WHERE tenant_id=$1 ORDER BY name", [tid]);

    let html = SKIP + nav('Presets');
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">';
    html += '<h2>Lighting Presets</h2>';
    html += `<a href="${navUrl('/presets/new')}" class="btn">+ Create Preset</a></div>`;

    if (presets.rows.length) {
      html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px">';
      presets.rows.forEach(p => {
        html += `<div class="card">
          <div style="display:flex;justify-content:space-between;align-items:start">
            <h3 style="margin:0 0 8px 0">${esc(p.name)}</h3>
            ${p.is_default ? badge('Default', '#f59e0b') : ''}
          </div>
          <p style="color:${GRAY};font-size:13px;margin-bottom:8px">${esc(p.description || 'No description')}</p>
          <div style="font-size:13px;margin-bottom:8px">
            <strong>Brightness:</strong> ${p.brightness}% |
            <strong>Color Temp:</strong> ${esc(p.color_temp)}
          </div>
          <div style="font-size:13px;margin-bottom:12px"><strong>Zones:</strong> ${p.zones ? p.zones.length : 0} zones linked</div>
          <div style="display:flex;gap:6px">
            <form method="POST" action="${navUrl('/presets/' + p.id + '/apply')}" style="display:inline">
              <button class="btn" style="padding:4px 12px;font-size:12px">Apply</button>
            </form>
            <a href="${navUrl('/presets/' + p.id + '/edit')}" class="btn" style="padding:4px 12px;font-size:12px;background:#0ea5e9">Edit</a>
            <form method="POST" action="${navUrl('/presets/' + p.id + '/delete')}" style="display:inline" onsubmit="return confirm('Delete this preset?')">
              <button class="btn" style="padding:4px 12px;font-size:12px;background:#ef4444">Delete</button>
            </form>
          </div>
        </div>`;
      });
      html += '</div>';
    } else { html += '<div class="card"><p style="color:#94a3b8">No presets configured. Create preset lighting scenes for common scenarios.</p></div>'; }
    res.send(renderPage('Lighting Presets', html, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 16 — Create preset form
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/smart-lighting/presets/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const zones = await pool.query("SELECT id, name FROM lighting_zones WHERE tenant_id=$1 ORDER BY name", [tid]);
    let html = SKIP + nav('Presets');
    html += '<div class="card"><h2>Create New Preset</h2>';
    html += `<form method="POST" action="${navUrl('/presets/create')}">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Preset Name *</label>
          <input name="name" required placeholder="e.g. Exam Mode"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Color Temperature</label>
          <select name="color_temp">
            <option value="warm">Warm (2700K)</option><option value="neutral" selected>Neutral (4000K)</option>
            <option value="cool">Cool (5000K)</option><option value="daylight">Daylight (6500K)</option>
          </select></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Brightness (%)</label>
          <input name="brightness" type="number" min="0" max="100" value="100"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Description</label>
          <input name="description" placeholder="Brief description"></div>
      </div>
      <div style="margin-top:12px"><label style="display:block;margin-bottom:4px;font-weight:600">Assign Zones</label>`;
    zones.rows.forEach(z => {
      html += `<label style="display:block;padding:4px 0"><input type="checkbox" name="zones" value="${z.id}"> ${esc(z.name)}</label>`;
    });
    html += '</div>';
    html += '<div style="margin-top:12px"><label><input type="checkbox" name="is_default"> Set as Default Preset</label></div>';
    html += '<div style="margin-top:16px"><button type="submit" class="btn">Create Preset</button></div>';
    html += '</form></div>';
    res.send(renderPage('Create Preset', html, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 17 — Save preset
  // ═══════════════════════════════════════════════════════════════════════════
  app.post('/school/smart-lighting/presets/create', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { name, description, brightness, color_temp, zones, is_default } = req.body;
    if (!name || !name.trim()) return res.status(400).send('Preset name is required.');
    const zoneArr = Array.isArray(zones) ? zones : (zones ? [zones] : []);
    if (is_default === 'on') {
      await pool.query("UPDATE lighting_presets SET is_default=false WHERE tenant_id=$1", [tid]);
    }
    await pool.query(
      "INSERT INTO lighting_presets (tenant_id, name, description, brightness, color_temp, zones, is_default) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [tid, name.trim(), description || null, Math.min(parseInt(brightness) || 100, 100),
       color_temp || 'neutral', zoneArr, is_default === 'on']);
    audit(req, 'lighting_preset_created', { name: name.trim() });
    res.redirect(navUrl('/presets'));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 18 — Apply preset
  // ═══════════════════════════════════════════════════════════════════════════
  app.post('/school/smart-lighting/presets/:id/apply', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { id } = req.params;
    const preset = await pool.query("SELECT * FROM lighting_presets WHERE id=$1 AND tenant_id=$2", [id, tid]);
    if (!preset.rows.length) return res.status(404).send('Preset not found.');
    const p = preset.rows[0];
    if (p.zones && p.zones.length) {
      for (const zid of p.zones) {
        const zone = await pool.query("SELECT current_state, brightness FROM lighting_zones WHERE id=$1 AND tenant_id=$2", [zid, tid]);
        if (zone.rows.length) {
          await pool.query(
            "UPDATE lighting_zones SET current_state='on', brightness=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3",
            [p.brightness, zid, tid]);
          await pool.query(
            "INSERT INTO lighting_logs (tenant_id, zone_id, action, previous_state, new_state, triggered_by) VALUES ($1,$2,$3,$4,$5,$6)",
            [tid, zid, 'preset_applied', zone.rows[0].current_state + '/' + zone.rows[0].brightness + '%',
             'on/' + p.brightness + '%', 'preset:' + p.name]);
        }
      }
    }
    audit(req, 'lighting_preset_applied', { preset_id: id, name: p.name, zones: p.zones });
    res.redirect(navUrl('/presets'));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 19 — Delete preset
  // ═══════════════════════════════════════════════════════════════════════════
  app.post('/school/smart-lighting/presets/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query("DELETE FROM lighting_presets WHERE id=$1 AND tenant_id=$2", [req.params.id, tid]);
    res.redirect(navUrl('/presets'));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 20 — Energy monitoring
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/smart-lighting/energy', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const zones = await pool.query(
      "SELECT * FROM lighting_zones WHERE tenant_id=$1 ORDER BY energy_kwh DESC", [tid]);
    const totalEnergy = await pool.query(
      "SELECT COALESCE(SUM(energy_kwh),0)::numeric AS total FROM lighting_zones WHERE tenant_id=$1", [tid]);
    const autoCount = await pool.query(
      "SELECT COUNT(*)::int AS c FROM lighting_zones WHERE tenant_id=$1 AND auto_mode=true", [tid]);
    const schedCount = await pool.query(
      "SELECT COUNT(*)::int AS c FROM lighting_schedules WHERE tenant_id=$1 AND is_active=true", [tid]);
    const estSavings = parseFloat(totalEnergy.rows[0].total) * 0.35;

    let html = SKIP + nav('Energy');
    html += '<h2 style="margin-bottom:20px">Energy Monitoring & Savings</h2>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px;margin-bottom:24px">';
    html += `<div class="card" style="text-align:center;border-left:4px solid ${P}"><div style="font-size:24px;font-weight:700;color:${P}">${kwh(totalEnergy.rows[0].total)}</div><div style="color:${GRAY};font-size:13px">Total Energy Used</div></div>`;
    html += `<div class="card" style="text-align:center;border-left:4px solid #22c55e"><div style="font-size:24px;font-weight:700;color:#22c55e">${kwh(estSavings)}</div><div style="color:${GRAY};font-size:13px">Est. Auto Savings</div></div>`;
    html += `<div class="card" style="text-align:center;border-left:4px solid #3b82f6"><div style="font-size:24px;font-weight:700;color:#3b82f6">${autoCount.rows[0].c}</div><div style="color:${GRAY};font-size:13px">Zones in Auto Mode</div></div>`;
    html += `<div class="card" style="text-align:center;border-left:4px solid #8b5cf6"><div style="font-size:24px;font-weight:700;color:#8b5cf6">${schedCount.rows[0].c}</div><div style="color:${GRAY};font-size:13px">Active Schedules</div></div>`;
    html += '</div>';

    html += '<div class="card"><h3 style="margin-bottom:12px">Energy Usage by Zone</h3>';
    if (zones.rows.length) {
      const maxE = Math.max(...zones.rows.map(z => parseFloat(z.energy_kwh || 0)), 1);
      html += '<table><tr><th>Zone</th><th>Type</th><th>State</th><th>Brightness</th><th>Energy</th><th>Usage Bar</th><th>Auto</th></tr>';
      zones.rows.forEach(z => {
        const pct = ((parseFloat(z.energy_kwh || 0) / maxE) * 100).toFixed(0);
        const barColor = pct > 75 ? '#ef4444' : pct > 50 ? '#f59e0b' : '#22c55e';
        html += `<tr><td><strong>${esc(z.name)}</strong></td><td>${esc(z.type)}</td>
          <td>${badge(z.current_state, z.current_state === 'on' ? '#22c55e' : '#94a3b8')}</td>
          <td>${z.brightness}%</td><td>${kwh(z.energy_kwh)}</td>
          <td><div style="display:flex;align-items:center;gap:6px"><div style="flex:1;background:#e5e7eb;border-radius:4px;height:10px;max-width:150px"><div style="width:${pct}%;background:${barColor};height:10px;border-radius:4px"></div></div><span style="font-size:11px;color:${GRAY}">${pct}%</span></div></td>
          <td>${z.auto_mode ? '✅' : '❌'}</td></tr>`;
      });
      html += '</table>';
    } else { html += '<p style="color:#94a3b8">No zones configured.</p>'; }
    html += '</div>';

    html += '<div class="card"><h3 style="margin-bottom:12px">Energy Saving Tips</h3>';
    html += '<ul style="line-height:2;color:#374151">';
    html += '<li>Enable occupancy sensors in low-traffic areas to automatically turn off unused lights</li>';
    html += '<li>Use scheduling to turn off lights after school hours and during weekends</li>';
    html += '<li>Reduce brightness in corridors and restrooms to 60-70% for optimal comfort</li>';
    html += '<li>Use natural daylight by adjusting brightness based on time of day</li>';
    html += '<li>Set up classroom presets for different activities (lectures, exams, presentations)</li>';
    html += '</ul></div>';

    res.send(renderPage('Energy Monitoring', html, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 21 — Activity logs
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/smart-lighting/logs', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = 25;
    const offset = (page - 1) * limit;
    const filterZone = req.query.zone_id || '';
    const filterAction = req.query.action || '';

    let where = 'll.tenant_id=$1', params = [tid], pNum = 2;
    if (filterZone) { where += ` AND ll.zone_id=$${pNum++}`; params.push(parseInt(filterZone)); }
    if (filterAction) { where += ` AND ll.action ILIKE $${pNum++}`; params.push('%' + filterAction + '%'); }

    const [logs, zones] = await Promise.all([
      pool.query(`SELECT ll.*, lz.name AS zone_name FROM lighting_logs ll
        JOIN lighting_zones lz ON lz.id=ll.zone_id WHERE ${where}
        ORDER BY ll.timestamp DESC LIMIT $${pNum} OFFSET $${pNum + 1}`,
        [...params, limit, offset]),
      pool.query("SELECT id, name FROM lighting_zones WHERE tenant_id=$1 ORDER BY name", [tid]),
    ]);
    const countResult = await pool.query(`SELECT COUNT(*)::int AS c FROM lighting_logs ll WHERE ${where}`, params);
    const totalPages = Math.ceil(countResult.rows[0].c / limit);

    let html = SKIP + nav('Logs');
    html += '<h2 style="margin-bottom:16px">Activity Logs</h2>';
    html += `<form method="GET" style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap">
      <select name="zone_id" style="width:200px"><option value="">All Zones</option>
        ${zones.rows.map(z => `<option value="${z.id}" ${z.id == filterZone ? 'selected' : ''}>${esc(z.name)}</option>`).join('')}
      </select>
      <input name="action" placeholder="Filter action..." value="${esc(filterAction)}" style="width:200px">
      <button type="submit" class="btn" style="background:#6b7280">Filter</button>
      <a href="${navUrl('/logs')}" class="btn" style="background:#94a3b8">Clear</a>
    </form>`;

    if (logs.rows.length) {
      html += '<table><tr><th>Zone</th><th>Action</th><th>Previous State</th><th>New State</th><th>Triggered By</th><th>Timestamp</th></tr>';
      logs.rows.forEach(l => {
        html += `<tr><td><strong>${esc(l.zone_name)}</strong></td>
          <td>${esc(l.action)}</td><td>${esc(l.previous_state || '—')}</td><td>${esc(l.new_state || '—')}</td>
          <td>${badge(l.triggered_by, l.triggered_by === 'manual' ? '#f59e0b' : '#3b82f6')}</td>
          <td>${fmtTime(l.timestamp)}</td></tr>`;
      });
      html += '</table>';
      if (totalPages > 1) {
        html += '<div style="display:flex;gap:8px;margin-top:16px;justify-content:center">';
        for (let i = 1; i <= totalPages; i++) {
          html += `<a href="${navUrl('/logs?page=' + i + (filterZone ? '&zone_id=' + filterZone : '') + (filterAction ? '&action=' + encodeURIComponent(filterAction) : ''))}" style="padding:6px 12px;border-radius:6px;text-decoration:none;${i === page ? 'background:' + P + ';color:#fff' : 'background:#f3f4f6;color:' + GRAY}">${i}</a>`;
        }
        html += '</div>';
      }
    } else { html += '<div class="card"><p style="color:#94a3b8">No log entries found.</p></div>'; }
    res.send(renderPage('Lighting Logs', html, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 22 — Emergency lighting control
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/smart-lighting/emergency', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const zones = await pool.query(
      "SELECT * FROM lighting_zones WHERE tenant_id=$1 ORDER BY name", [tid]);
    const emergencyCount = await pool.query(
      "SELECT COUNT(*)::int AS c FROM lighting_zones WHERE tenant_id=$1 AND emergency_mode=true", [tid]);

    let html = SKIP + nav('Emergency');
    html += '<h2 style="margin-bottom:20px;color:#ef4444">Emergency Lighting Control</h2>';
    html += alertBox('Emergency mode forces all lights to maximum brightness. Use only in actual emergencies.', 'warning');

    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px">';
    html += `<div class="card" style="text-align:center;border:2px solid #ef4444">
      <div style="font-size:48px;margin-bottom:8px">🚨</div>
      <div style="font-size:20px;font-weight:700;color:#ef4444;margin-bottom:4px">${emergencyCount.rows[0].c} Zones in Emergency</div>
      <form method="POST" action="${navUrl('/emergency/activate-all')}" style="margin-top:12px">
        <button class="btn" style="background:#ef4444;padding:12px 32px;font-size:16px" onclick="return confirm('ACTIVATE EMERGENCY LIGHTING FOR ALL ZONES?')">Activate All Emergency</button>
      </form>
    </div>`;
    html += `<div class="card" style="text-align:center;border:2px solid #22c55e">
      <div style="font-size:48px;margin-bottom:8px">✅</div>
      <div style="font-size:20px;font-weight:700;color:#22c55e;margin-bottom:4px">Deactivate Emergency</div>
      <form method="POST" action="${navUrl('/emergency/deactivate-all')}" style="margin-top:12px">
        <button class="btn" style="background:#22c55e;padding:12px 32px;font-size:16px" onclick="return confirm('Deactivate all emergency lighting?')">Deactivate All</button>
      </form>
    </div>`;
    html += '</div>';

    // Per-zone emergency toggle
    html += '<div class="card"><h3 style="margin-bottom:12px">Per-Zone Emergency Control</h3>';
    if (zones.rows.length) {
      html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px">';
      zones.rows.forEach(z => {
        html += `<div style="border:1px solid ${z.emergency_mode ? '#ef4444' : '#e5e7eb'};border-radius:10px;padding:14px;background:${z.emergency_mode ? '#fef2f2' : '#fafafa'}">
          <strong>${esc(z.name)}</strong>
          <div style="font-size:12px;color:${GRAY};margin:4px 0">${esc(z.location || z.type)}</div>
          ${z.emergency_mode ? '<div style="color:#ef4444;font-weight:600;font-size:13px;margin-bottom:8px">EMERGENCY ACTIVE</div>' : ''}
          <form method="POST" action="${navUrl('/zones/' + z.id + '/emergency-toggle')}" style="display:inline">
            <button class="btn" style="padding:4px 12px;font-size:12px;background:${z.emergency_mode ? '#22c55e' : '#ef4444'}">${z.emergency_mode ? 'Deactivate' : 'Activate'}</button>
          </form>
        </div>`;
      });
      html += '</div>';
    } else { html += '<p style="color:#94a3b8">No zones configured.</p>'; }
    html += '</div>';

    res.send(renderPage('Emergency Lighting', html, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 23 — Activate all emergency
  // ═══════════════════════════════════════════════════════════════════════════
  app.post('/school/smart-lighting/emergency/activate-all', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const zones = await pool.query("SELECT id, current_state, brightness FROM lighting_zones WHERE tenant_id=$1", [tid]);
    for (const z of zones.rows) {
      await pool.query(
        "UPDATE lighting_zones SET current_state='on', brightness=100, emergency_mode=true, updated_at=NOW() WHERE id=$1 AND tenant_id=$2",
        [z.id, tid]);
      await pool.query(
        "INSERT INTO lighting_logs (tenant_id, zone_id, action, previous_state, new_state, triggered_by) VALUES ($1,$2,$3,$4,$5,$6)",
        [tid, z.id, 'emergency_activated', z.current_state + '/' + z.brightness + '%', 'on/100%', 'emergency']);
    }
    audit(req, 'emergency_all_activated');
    queueEmail(tid, 'Emergency Lighting Activated', 'All school lighting has been set to emergency mode by ' + req.session.user.name);
    res.redirect(navUrl('/emergency'));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 24 — Deactivate all emergency
  // ═══════════════════════════════════════════════════════════════════════════
  app.post('/school/smart-lighting/emergency/deactivate-all', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query(
      "UPDATE lighting_zones SET emergency_mode=false, current_state='off', brightness=0, updated_at=NOW() WHERE tenant_id=$1", [tid]);
    audit(req, 'emergency_all_deactivated');
    res.redirect(navUrl('/emergency'));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 25 — Per-zone emergency toggle
  // ═══════════════════════════════════════════════════════════════════════════
  app.post('/school/smart-lighting/zones/:id/emergency-toggle', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { id } = req.params;
    const zone = await pool.query("SELECT emergency_mode FROM lighting_zones WHERE id=$1 AND tenant_id=$2", [id, tid]);
    if (!zone.rows.length) return res.status(404).send('Zone not found.');
    const newMode = !zone.rows[0].emergency_mode;
    await pool.query(
      `UPDATE lighting_zones SET emergency_mode=$1, current_state=$2, brightness=$3, updated_at=NOW() WHERE id=$4 AND tenant_id=$5`,
      [newMode, newMode ? 'on' : 'off', newMode ? 100 : 0, id, tid]);
    await pool.query(
      "INSERT INTO lighting_logs (tenant_id, zone_id, action, new_state, triggered_by) VALUES ($1,$2,$3,$4,$5)",
      [tid, id, newMode ? 'emergency_activated' : 'emergency_deactivated', newMode ? 'emergency_on' : 'emergency_off', 'manual']);
    audit(req, 'emergency_zone_toggled', { zone_id: id, mode: newMode });
    res.redirect(req.headers.referer || navUrl('/emergency'));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 26 — Settings page
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/smart-lighting/settings', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const zoneCount = await pool.query("SELECT COUNT(*)::int AS c FROM lighting_zones WHERE tenant_id=$1", [tid]);
    const logCount = await pool.query("SELECT COUNT(*)::int AS c FROM lighting_logs WHERE tenant_id=$1", [tid]);

    let html = SKIP + nav('Settings');
    html += '<h2 style="margin-bottom:20px">Lighting Settings</h2>';
    html += '<div class="card"><h3 style="margin-bottom:12px">Maintenance Actions</h3>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">';
    html += `<div>
      <strong>Reset All Energy Counters</strong>
      <p style="font-size:13px;color:${GRAY};margin:4px 0">Set all zone energy counters to zero. Use at start of billing period.</p>
      <form method="POST" action="${navUrl('/settings/reset-energy')}" style="display:inline" onsubmit="return confirm('Reset all energy counters?')">
        <button class="btn" style="background:#f59e0b">Reset Energy</button>
      </form>
    </div>`;
    html += `<div>
      <strong>Purge Old Logs</strong>
      <p style="font-size:13px;color:${GRAY};margin:4px 0">Delete logs older than 90 days. Currently ${logCount.rows[0].c} log entries.</p>
      <form method="POST" action="${navUrl('/settings/purge-logs')}" style="display:inline" onsubmit="return confirm('Delete logs older than 90 days?')">
        <button class="btn" style="background:#ef4444">Purge Logs</button>
      </form>
    </div>`;
    html += `<div>
      <strong>Turn Off All Lights</strong>
      <p style="font-size:13px;color:${GRAY};margin:4px 0">Set all zones to off state. ${zoneCount.rows[0].c} zones will be affected.</p>
      <form method="POST" action="${navUrl('/settings/all-off')}" style="display:inline" onsubmit="return confirm('Turn off ALL lights?')">
        <button class="btn" style="background:#6b7280">All Lights Off</button>
      </form>
    </div>`;
    html += `<div>
      <strong>Enable Auto Mode All</strong>
      <p style="font-size:13px;color:${GRAY};margin:4px 0">Enable automatic mode for all zones.</p>
      <form method="POST" action="${navUrl('/settings/auto-all')}" style="display:inline">
        <button class="btn" style="background:#22c55e">Enable Auto All</button>
      </form>
    </div>`;
    html += '</div></div>';

    html += '<div class="card"><h3 style="margin-bottom:12px">System Information</h3>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:14px">';
    html += `<div><strong>Module:</strong> Smart Lighting</div>`;
    html += `<div><strong>Version:</strong> 1.0.0</div>`;
    html += `<div><strong>Configured Zones:</strong> ${zoneCount.rows[0].c}</div>`;
    html += `<div><strong>Total Log Entries:</strong> ${logCount.rows[0].c}</div>`;
    html += '</div></div>';

    res.send(renderPage('Lighting Settings', html, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 27 — Settings actions
  // ═══════════════════════════════════════════════════════════════════════════
  app.post('/school/smart-lighting/settings/reset-energy', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query("UPDATE lighting_zones SET energy_kwh=0 WHERE tenant_id=$1", [tid]);
    audit(req, 'lighting_energy_reset');
    res.redirect(navUrl('/settings'));
  }));

  app.post('/school/smart-lighting/settings/purge-logs', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query("DELETE FROM lighting_logs WHERE tenant_id=$1 AND timestamp < NOW() - INTERVAL '90 days'", [tid]);
    audit(req, 'lighting_logs_purged');
    res.redirect(navUrl('/settings'));
  }));

  app.post('/school/smart-lighting/settings/all-off', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const zones = await pool.query("SELECT id, current_state FROM lighting_zones WHERE tenant_id=$1 AND current_state='on'", [tid]);
    for (const z of zones.rows) {
      await pool.query("UPDATE lighting_zones SET current_state='off', brightness=0, updated_at=NOW() WHERE id=$1", [z.id]);
      await pool.query("INSERT INTO lighting_logs (tenant_id, zone_id, action, previous_state, new_state, triggered_by) VALUES ($1,$2,$3,$4,$5,$6)",
        [tid, z.id, 'bulk_off', z.current_state, 'off', 'admin']);
    }
    audit(req, 'lighting_all_off');
    res.redirect(navUrl('/settings'));
  }));

  app.post('/school/smart-lighting/settings/auto-all', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query("UPDATE lighting_zones SET auto_mode=true WHERE tenant_id=$1", [tid]);
    audit(req, 'lighting_auto_all');
    res.redirect(navUrl('/settings'));
  }));
};
