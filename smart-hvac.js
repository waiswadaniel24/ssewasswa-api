/**
 * Smart HVAC Management Module
 * Multi-tenant SaaS platform (schools)
 *
 * Features: HVAC zone management, temperature monitoring, scheduling,
 *   energy optimization, maintenance tracking, filter replacement alerts,
 *   air quality integration, cost tracking, comfort scoring
 * 11 routes · PostgreSQL · tenant_id scoped
 */
module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5', GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.btn:hover{background:#3730a3}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}</style>';

  // ── Helpers ────────────────────────────────────────────────────────────────
  function navUrl(a) { return '/school/smart-hvac' + a; }
  function fmtDate(d) { return d ? new Date(d).toISOString().split('T')[0] : '—'; }
  function fmtTime(d) { return d ? new Date(d).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '—'; }
  function badge(label, color) { return `<span style="background:${color};color:#fff;padding:2px 10px;border-radius:12px;font-size:12px">${esc(label)}</span>`; }
  function fmtTemp(t) { return t !== null && t !== undefined ? parseFloat(t).toFixed(1) + '°C' : '—'; }
  function fmtMoney(v) { return '$' + parseFloat(v || 0).toFixed(2); }

  function nav(active) {
    const links = [
      ['Dashboard', ''], ['Zones', '/zones'], ['Schedules', '/schedules'],
      ['Maintenance', '/maintenance'], ['Costs', '/costs'], ['Air Quality', '/air-quality'],
    ];
    return '<nav style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:24px">' +
      links.map(([l, h]) =>
        `<a href="${navUrl(h)}" style="padding:8px 16px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:500;` +
        (active === l ? `background:${P};color:#fff` : `background:#f3f4f6;color:${GRAY}`) + `">${l}</a>`
      ).join('') + '</nav>';
  }

  function comfortScore(temp, humidity) {
    let score = 100;
    const t = parseFloat(temp) || 22;
    const h = parseFloat(humidity) || 50;
    if (t < 18 || t > 28) score -= 30;
    else if (t < 20 || t > 25) score -= 15;
    if (h < 30 || h > 70) score -= 20;
    else if (h < 40 || h > 60) score -= 10;
    return Math.max(0, Math.min(100, score));
  }

  // ── Database Migration ─────────────────────────────────────────────────────
  (async () => {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS hvac_zones (
          id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          name VARCHAR(100) NOT NULL, location VARCHAR(255), type VARCHAR(50) DEFAULT 'classroom',
          current_temp NUMERIC(5,2) DEFAULT 22.0, target_temp NUMERIC(5,2) DEFAULT 22.0,
          humidity NUMERIC(5,2) DEFAULT 50.0, mode VARCHAR(20) DEFAULT 'auto',
          energy_kwh NUMERIC(10,2) DEFAULT 0, comfort_score INT DEFAULT 80,
          is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS hvac_schedules (
          id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          zone_id INTEGER NOT NULL REFERENCES hvac_zones(id) ON DELETE CASCADE,
          day_of_week INT NOT NULL, start_time TIME NOT NULL, end_time TIME NOT NULL,
          target_temp NUMERIC(5,2) DEFAULT 22.0, mode VARCHAR(20) DEFAULT 'auto',
          is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS hvac_maintenance (
          id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          zone_id INTEGER REFERENCES hvac_zones(id) ON DELETE SET NULL,
          maintenance_type VARCHAR(50) NOT NULL, description TEXT,
          due_date DATE, completed_date DATE, cost NUMERIC(8,2) DEFAULT 0,
          status VARCHAR(20) DEFAULT 'pending', priority VARCHAR(20) DEFAULT 'normal',
          assigned_to VARCHAR(100), notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS hvac_logs (
          id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          zone_id INTEGER REFERENCES hvac_zones(id) ON DELETE SET NULL,
          action VARCHAR(100) NOT NULL, details TEXT,
          temperature NUMERIC(5,2), energy_delta NUMERIC(8,2) DEFAULT 0,
          timestamp TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      const idxs = [
        'CREATE INDEX IF NOT EXISTS idx_hz_tenant ON hvac_zones(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_hz_type ON hvac_zones(type)',
        'CREATE INDEX IF NOT EXISTS idx_hs_tenant ON hvac_schedules(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_hs_zone ON hvac_schedules(zone_id)',
        'CREATE INDEX IF NOT EXISTS idx_hm_tenant ON hvac_maintenance(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_hm_status ON hvac_maintenance(status)',
        'CREATE INDEX IF NOT EXISTS idx_hm_due ON hvac_maintenance(due_date)',
        'CREATE INDEX IF NOT EXISTS idx_hlg_tenant ON hvac_logs(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_hlg_zone ON hvac_logs(zone_id)',
      ];
      for (const sql of idxs) { try { await pool.query(sql); } catch (_) {} }
      console.log('[SmartHVAC] Tables ready');
    } catch (e) { console.warn('[SmartHVAC] Migration warning:', e.message); }
  })();

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 1 — Dashboard
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/smart-hvac', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [totalZones, activeZones, pendingMaint] = await Promise.all([
      pool.query("SELECT COUNT(*)::int AS c FROM hvac_zones WHERE tenant_id=$1", [tid]),
      pool.query("SELECT COUNT(*)::int AS c FROM hvac_zones WHERE tenant_id=$1 AND is_active=true", [tid]),
      pool.query("SELECT COUNT(*)::int AS c FROM hvac_maintenance WHERE tenant_id=$1 AND status='pending'", [tid]),
    ]);
    const tempStats = await pool.query(
      "SELECT AVG(current_temp)::numeric AS avg_temp, AVG(target_temp)::numeric AS avg_target, AVG(humidity)::numeric AS avg_humidity, SUM(energy_kwh)::numeric AS total_energy FROM hvac_zones WHERE tenant_id=$1", [tid]);
    const zones = await pool.query(
      "SELECT * FROM hvac_zones WHERE tenant_id=$1 ORDER BY name", [tid]);
    const overdueMaint = await pool.query(
      "SELECT COUNT(*)::int AS c FROM hvac_maintenance WHERE tenant_id=$1 AND status='pending' AND due_date < CURRENT_DATE", [tid]);
    const totalCost = await pool.query(
      "SELECT COALESCE(SUM(cost),0)::numeric AS total FROM hvac_maintenance WHERE tenant_id=$1 AND status='completed'", [tid]);

    let html = SKIP + nav('Dashboard');
    html += '<h2 style="margin-bottom:20px">Smart HVAC Dashboard</h2>';

    // Summary cards
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:16px;margin-bottom:24px">';
    html += `<div class="card" style="text-align:center"><div style="font-size:28px;font-weight:700;color:${P}">${totalZones.rows[0].c}</div><div style="color:${GRAY};font-size:13px">Total Zones</div></div>`;
    html += `<div class="card" style="text-align:center"><div style="font-size:28px;font-weight:700;color:#22c55e">${activeZones.rows[0].c}</div><div style="color:${GRAY};font-size:13px">Active Zones</div></div>`;
    html += `<div class="card" style="text-align:center"><div style="font-size:28px;font-weight:700;color:#3b82f6">${fmtTemp(tempStats.rows[0].avg_temp)}</div><div style="color:${GRAY};font-size:13px">Avg Temperature</div></div>`;
    html += `<div class="card" style="text-align:center"><div style="font-size:28px;font-weight:700;color:#8b5cf6">${parseFloat(tempStats.rows[0].avg_humidity || 0).toFixed(1)}%</div><div style="color:${GRAY};font-size:13px">Avg Humidity</div></div>`;
    html += `<div class="card" style="text-align:center"><div style="font-size:28px;font-weight:700;color:#f59e0b">${parseFloat(tempStats.rows[0].total_energy || 0).toFixed(1)} kWh</div><div style="color:${GRAY};font-size:13px">Total Energy</div></div>`;
    html += `<div class="card" style="text-align:center"><div style="font-size:28px;font-weight:700;color:#ef4444">${overdueMaint.rows[0].c}</div><div style="color:${GRAY};font-size:13px">Overdue Tasks</div></div>`;
    html += `<div class="card" style="text-align:center"><div style="font-size:28px;font-weight:700;color:#06b6d4">${fmtMoney(totalCost.rows[0].total)}</div><div style="color:${GRAY};font-size:13px">Maintenance Cost</div></div>`;
    html += '</div>';

    // Overdue maintenance alert
    if (overdueMaint.rows[0].c > 0) {
      html += `<div style="background:#fee2e2;border:1px solid #ef4444;border-radius:8px;padding:12px 16px;margin-bottom:16px;color:#991b1b">
        <strong>⚠ ${overdueMaint.rows[0].c} Overdue Maintenance Task(s)</strong> — Please address these items promptly.
      </div>`;
    }

    // Zone overview
    if (zones.rows.length) {
      html += '<div class="card"><h3 style="margin-bottom:12px">Zone Overview</h3>';
      html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px">';
      zones.rows.forEach(z => {
        const cs = comfortScore(z.current_temp, z.humidity);
        const csColor = cs >= 80 ? '#22c55e' : cs >= 60 ? '#f59e0b' : '#ef4444';
        const tempDiff = parseFloat(z.current_temp || 0) - parseFloat(z.target_temp || 0);
        const tempColor = Math.abs(tempDiff) <= 1 ? '#22c55e' : Math.abs(tempDiff) <= 3 ? '#f59e0b' : '#ef4444';
        const modeColors = { cool: '#3b82f6', heat: '#ef4444', auto: '#22c55e', fan: '#8b5cf6', off: '#94a3b8' };

        html += `<div style="border:1px solid #e5e7eb;border-radius:10px;padding:14px;background:#fafafa">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <strong>${esc(z.name)}</strong>
            ${badge(z.mode, modeColors[z.mode] || '#94a3b8')}
          </div>
          <div style="font-size:13px;color:${GRAY};margin-bottom:8px">${esc(z.location || z.type)}</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:13px">
            <div><span style="color:${GRAY}">Current:</span> <span style="color:${tempColor};font-weight:600">${fmtTemp(z.current_temp)}</span></div>
            <div><span style="color:${GRAY}">Target:</span> ${fmtTemp(z.target_temp)}</div>
            <div><span style="color:${GRAY}">Humidity:</span> ${parseFloat(z.humidity || 0).toFixed(1)}%</div>
            <div><span style="color:${GRAY}">Comfort:</span> <span style="color:${csColor};font-weight:600">${cs}/100</span></div>
            <div><span style="color:${GRAY}">Energy:</span> ${parseFloat(z.energy_kwh || 0).toFixed(2)} kWh</div>
            <div><span style="color:${GRAY}">Status:</span> ${z.is_active ? badge('Active', '#22c55e') : badge('Inactive', '#94a3b8')}</div>
          </div>
          <div style="margin-top:8px;display:flex;gap:6px">
            <a href="${navUrl('/zones/' + z.id + '/control')}" class="btn" style="padding:3px 10px;font-size:11px">Control</a>
            <a href="${navUrl('/zones/' + z.id)}" class="btn" style="padding:3px 10px;font-size:11px;background:#0ea5e9">Details</a>
          </div>
        </div>`;
      });
      html += '</div></div>';
    }

    // Comfort score summary
    html += '<div class="card"><h3 style="margin-bottom:12px">Comfort Score Guide</h3>';
    html += '<div style="display:flex;gap:24px;font-size:14px">';
    html += '<div><span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:#22c55e;margin-right:6px"></span><strong>80-100:</strong> Optimal comfort</div>';
    html += '<div><span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:#f59e0b;margin-right:6px"></span><strong>60-79:</strong> Acceptable</div>';
    html += '<div><span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:#ef4444;margin-right:6px"></span><strong>0-59:</strong> Needs adjustment</div>';
    html += '</div></div>';

    res.send(renderPage('Smart HVAC Dashboard', html, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 2 — Zones list
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/smart-hvac/zones', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const zones = await pool.query("SELECT * FROM hvac_zones WHERE tenant_id=$1 ORDER BY name", [tid]);

    let html = SKIP + nav('Zones');
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">';
    html += '<h2>HVAC Zones</h2>';
    html += `<a href="${navUrl('/zones/new')}" class="btn">+ Add Zone</a></div>`;

    if (zones.rows.length) {
      html += '<table><tr><th>Name</th><th>Location</th><th>Type</th><th>Current</th><th>Target</th><th>Humidity</th><th>Comfort</th><th>Mode</th><th>Energy</th><th>Actions</th></tr>';
      zones.rows.forEach(z => {
        const cs = comfortScore(z.current_temp, z.humidity);
        const csColor = cs >= 80 ? '#22c55e' : cs >= 60 ? '#f59e0b' : '#ef4444';
        const modeColors = { cool: '#3b82f6', heat: '#ef4444', auto: '#22c55e', fan: '#8b5cf6', off: '#94a3b8' };
        html += `<tr>
          <td><strong>${esc(z.name)}</strong></td>
          <td>${esc(z.location || '—')}</td>
          <td>${badge(z.type, '#e0e7ff')}</td>
          <td>${fmtTemp(z.current_temp)}</td>
          <td>${fmtTemp(z.target_temp)}</td>
          <td>${parseFloat(z.humidity || 0).toFixed(1)}%</td>
          <td><span style="color:${csColor};font-weight:600">${cs}/100</span></td>
          <td>${badge(z.mode, modeColors[z.mode] || '#94a3b8')}</td>
          <td>${parseFloat(z.energy_kwh || 0).toFixed(2)} kWh</td>
          <td>
            <a href="${navUrl('/zones/' + z.id + '/control')}" class="btn" style="padding:4px 10px;font-size:12px">Control</a>
            <a href="${navUrl('/zones/' + z.id + '/edit')}" class="btn" style="padding:4px 10px;font-size:12px;background:#0ea5e9">Edit</a>
          </td></tr>`;
      });
      html += '</table>';
    } else { html += '<div class="card"><p style="color:#94a3b8">No HVAC zones configured yet.</p></div>'; }
    res.send(renderPage('HVAC Zones', html, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 3 — Create zone form
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/smart-hvac/zones/new', requireAuth, requireNotBanned, (req, res) => {
    let html = SKIP + nav('Zones');
    html += '<div class="card"><h2>Add New HVAC Zone</h2>';
    html += `<form method="POST" action="${navUrl('/zones/create')}">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Zone Name *</label>
          <input name="name" required placeholder="e.g. Science Lab A"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Type</label>
          <select name="type">
            <option value="classroom">Classroom</option><option value="laboratory">Laboratory</option>
            <option value="office">Office</option><option value="library">Library</option>
            <option value="cafeteria">Cafeteria</option><option value="gymnasium">Gymnasium</option>
            <option value="auditorium">Auditorium</option><option value="server_room">Server Room</option>
            <option value="corridor">Corridor</option><option value="restroom">Restroom</option>
          </select></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Location</label>
          <input name="location" placeholder="e.g. Building B, Floor 3"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Target Temperature (°C)</label>
          <input name="target_temp" type="number" step="0.5" min="16" max="30" value="22.0"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Default Mode</label>
          <select name="mode">
            <option value="auto">Auto</option><option value="cool">Cool Only</option>
            <option value="heat">Heat Only</option><option value="fan">Fan Only</option>
            <option value="off">Off</option>
          </select></div>
      </div>
      <div style="margin-top:16px">
        <button type="submit" class="btn">Create Zone</button>
        <a href="${navUrl('/zones')}" style="margin-left:8px;color:${GRAY}">Cancel</a>
      </div>
    </form></div>`;
    res.send(renderPage('Add HVAC Zone', html, req.session.user, req));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 4 — Save zone
  // ═══════════════════════════════════════════════════════════════════════════
  app.post('/school/smart-hvac/zones/create', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { name, type, location, target_temp, mode } = req.body;
    if (!name || !name.trim()) return res.status(400).send('Zone name is required.');
    const result = await pool.query(
      `INSERT INTO hvac_zones (tenant_id, name, location, type, target_temp, mode, comfort_score)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [tid, name.trim(), location || null, type || 'classroom',
       parseFloat(target_temp) || 22.0, mode || 'auto']);
    audit(req, 'hvac_zone_created', { zone_id: result.rows[0].id, name: name.trim() });
    await pool.query(
      "INSERT INTO hvac_logs (tenant_id, zone_id, action, details) VALUES ($1, $2, $3, $4)",
      [tid, result.rows[0].id, 'zone_created', 'Zone ' + name.trim() + ' created']);
    res.redirect(navUrl('/zones'));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 5 — Zone control panel
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/smart-hvac/zones/:id/control', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const zone = await pool.query("SELECT * FROM hvac_zones WHERE id=$1 AND tenant_id=$2", [req.params.id, tid]);
    if (!zone.rows.length) return res.status(404).send('Zone not found.');
    const z = zone.rows[0];
    const cs = comfortScore(z.current_temp, z.humidity);
    const csColor = cs >= 80 ? '#22c55e' : cs >= 60 ? '#f59e0b' : '#ef4444';

    let html = SKIP + nav('Zones');
    html += `<a href="${navUrl('/zones')}" style="color:${P};text-decoration:none;margin-bottom:12px;display:inline-block">&larr; Back to Zones</a>`;
    html += `<div class="card"><h2>Control: ${esc(z.name)}</h2>`;

    // Temperature gauge
    html += `<div style="text-align:center;margin:20px 0">
      <div style="font-size:64px;font-weight:700;color:${P}">${fmtTemp(z.current_temp)}</div>
      <div style="font-size:18px;color:${GRAY}">Current Temperature</div>
      <div style="font-size:14px;color:${GRAY};margin-top:4px">Target: ${fmtTemp(z.target_temp)} | Humidity: ${parseFloat(z.humidity || 0).toFixed(1)}%</div>
      <div style="margin-top:12px"><span style="background:${csColor};color:#fff;padding:6px 20px;border-radius:20px;font-size:16px;font-weight:600">Comfort: ${cs}/100</span></div>
    </div>`;

    // Control form
    html += `<form method="POST" action="${navUrl('/zones/' + z.id + '/control')}" style="max-width:400px;margin:0 auto">
      <div style="margin-bottom:16px"><label style="display:block;margin-bottom:4px;font-weight:600">Set Target Temperature (°C)</label>
        <input name="target_temp" type="number" step="0.5" min="16" max="30" value="${z.target_temp}" style="font-size:20px;text-align:center"></div>
      <div style="margin-bottom:16px"><label style="display:block;margin-bottom:4px;font-weight:600">Mode</label>
        <select name="mode">
          ${['auto','cool','heat','fan','off'].map(m => `<option value="${m}" ${z.mode === m ? 'selected' : ''}>${m.charAt(0).toUpperCase() + m.slice(1)}</option>`).join('')}
        </select></div>
      <div style="margin-bottom:16px"><label style="display:block;margin-bottom:4px;font-weight:600">Update Current Temp (°C) — simulate sensor reading</label>
        <input name="current_temp" type="number" step="0.1" min="-10" max="50" value="${z.current_temp}"></div>
      <div style="margin-bottom:16px"><label style="display:block;margin-bottom:4px;font-weight:600">Update Humidity (%)</label>
        <input name="humidity" type="number" step="0.1" min="0" max="100" value="${z.humidity}"></div>
      <button type="submit" class="btn" style="width:100%;padding:12px;font-size:16px">Apply Changes</button>
    </form>`;
    html += '</div>';
    res.send(renderPage('Zone Control', html, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 6 — Apply zone control
  // ═══════════════════════════════════════════════════════════════════════════
  app.post('/school/smart-hvac/zones/:id/control', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { id } = req.params;
    const { target_temp, mode, current_temp, humidity } = req.body;
    const zone = await pool.query("SELECT * FROM hvac_zones WHERE id=$1 AND tenant_id=$2", [id, tid]);
    if (!zone.rows.length) return res.status(404).send('Zone not found.');
    const z = zone.rows[0];
    const prevTarget = z.target_temp;
    const newTarget = parseFloat(target_temp) || 22.0;
    const newMode = mode || 'auto';
    const newTemp = parseFloat(current_temp);
    const newHumidity = parseFloat(humidity);
    const cs = comfortScore(newTemp !== null ? newTemp : z.current_temp, newHumidity !== null ? newHumidity : z.humidity);

    await pool.query(
      `UPDATE hvac_zones SET target_temp=$1, mode=$2, current_temp=COALESCE($3, current_temp),
       humidity=COALESCE($4, humidity), comfort_score=$5, updated_at=NOW() WHERE id=$6 AND tenant_id=$7`,
      [newTarget, newMode, newTemp !== null && !isNaN(newTemp) ? newTemp : null,
       newHumidity !== null && !isNaN(newHumidity) ? newHumidity : null, cs, id, tid]);

    const details = [];
    if (prevTarget !== newTarget) details.push('Target: ' + fmtTemp(prevTarget) + ' → ' + fmtTemp(newTarget));
    if (z.mode !== newMode) details.push('Mode: ' + z.mode + ' → ' + newMode);

    await pool.query(
      "INSERT INTO hvac_logs (tenant_id, zone_id, action, details, temperature) VALUES ($1,$2,$3,$4,$5)",
      [tid, id, 'control_update', details.join(', ') || 'Updated', newTemp || z.current_temp]);
    audit(req, 'hvac_control_update', { zone_id: id, target: newTarget, mode: newMode });
    res.redirect(navUrl('/zones/' + id + '/control'));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 7 — Edit zone
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/smart-hvac/zones/:id/edit', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const zone = await pool.query("SELECT * FROM hvac_zones WHERE id=$1 AND tenant_id=$2", [req.params.id, tid]);
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
            ${['classroom','laboratory','office','library','cafeteria','gymnasium','auditorium','server_room','corridor','restroom']
              .map(t => `<option value="${t}" ${z.type === t ? 'selected' : ''}>${t.replace('_',' ').replace(/\b\w/g,l=>l.toUpperCase())}</option>`).join('')}
          </select></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Location</label>
          <input name="location" value="${esc(z.location || '')}"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Target Temp (°C)</label>
          <input name="target_temp" type="number" step="0.5" value="${z.target_temp}"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Mode</label>
          <select name="mode">
            ${['auto','cool','heat','fan','off'].map(m => `<option value="${m}" ${z.mode === m ? 'selected' : ''}>${m.charAt(0).toUpperCase() + m.slice(1)}</option>`).join('')}
          </select></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Active</label>
          <select name="is_active">
            <option value="true" ${z.is_active ? 'selected' : ''}>Active</option>
            <option value="false" ${!z.is_active ? 'selected' : ''}>Inactive</option>
          </select></div>
      </div>
      <div style="margin-top:16px">
        <button type="submit" class="btn">Save Changes</button>
        <a href="${navUrl('/zones')}" style="margin-left:8px;color:${GRAY}">Cancel</a>
      </div>
    </form></div>`;
    res.send(renderPage('Edit HVAC Zone', html, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 8 — Update zone
  // ═══════════════════════════════════════════════════════════════════════════
  app.post('/school/smart-hvac/zones/:id/update', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { id } = req.params;
    const { name, type, location, target_temp, mode, is_active } = req.body;
    if (!name || !name.trim()) return res.status(400).send('Zone name is required.');
    await pool.query(
      `UPDATE hvac_zones SET name=$1, type=$2, location=$3, target_temp=$4, mode=$5,
       is_active=$6, updated_at=NOW() WHERE id=$7 AND tenant_id=$8`,
      [name.trim(), type || 'classroom', location || null,
       parseFloat(target_temp) || 22.0, mode || 'auto',
       is_active === 'true', id, tid]);
    audit(req, 'hvac_zone_updated', { zone_id: id });
    res.redirect(navUrl('/zones'));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 9 — Zone detail with logs
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/smart-hvac/zones/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const zone = await pool.query("SELECT * FROM hvac_zones WHERE id=$1 AND tenant_id=$2", [req.params.id, tid]);
    if (!zone.rows.length) return res.status(404).send('Zone not found.');
    const z = zone.rows[0];
    const cs = comfortScore(z.current_temp, z.humidity);
    const schedules = await pool.query(
      "SELECT * FROM hvac_schedules WHERE zone_id=$1 AND tenant_id=$2 ORDER BY day_of_week, start_time", [z.id, tid]);
    const logs = await pool.query(
      "SELECT * FROM hvac_logs WHERE zone_id=$1 AND tenant_id=$2 ORDER BY timestamp DESC LIMIT 20", [z.id, tid]);
    const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

    let html = SKIP + nav('Zones');
    html += `<a href="${navUrl('/zones')}" style="color:${P};text-decoration:none;margin-bottom:12px;display:inline-block">&larr; Back</a>`;
    html += `<div class="card"><h2>${esc(z.name)}</h2>`;
    html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-top:12px">';
    html += `<div><strong>Location:</strong> ${esc(z.location || '—')}</div>`;
    html += `<div><strong>Type:</strong> ${esc(z.type)}</div>`;
    html += `<div><strong>Mode:</strong> ${badge(z.mode, { cool:'#3b82f6', heat:'#ef4444', auto:'#22c55e', fan:'#8b5cf6', off:'#94a3b8' }[z.mode] || '#94a3b8')}</div>`;
    html += `<div><strong>Current Temp:</strong> ${fmtTemp(z.current_temp)}</div>`;
    html += `<div><strong>Target Temp:</strong> ${fmtTemp(z.target_temp)}</div>`;
    html += `<div><strong>Humidity:</strong> ${parseFloat(z.humidity || 0).toFixed(1)}%</div>`;
    html += `<div><strong>Energy:</strong> ${parseFloat(z.energy_kwh || 0).toFixed(2)} kWh</div>`;
    html += `<div><strong>Comfort:</strong> ${cs}/100</div>`;
    html += `<div><strong>Status:</strong> ${z.is_active ? 'Active' : 'Inactive'}</div>`;
    html += '</div></div>';

    // Schedules
    html += '<div class="card"><h3 style="margin-bottom:12px">Schedules</h3>';
    if (schedules.rows.length) {
      html += '<table><tr><th>Day</th><th>Start</th><th>End</th><th>Target</th><th>Mode</th><th>Status</th><th>Actions</th></tr>';
      schedules.rows.forEach(s => {
        html += `<tr><td>${dayNames[s.day_of_week] || s.day_of_week}</td>
          <td>${s.start_time}</td><td>${s.end_time}</td><td>${fmtTemp(s.target_temp)}</td>
          <td>${badge(s.mode, '#e0e7ff')}</td>
          <td>${s.is_active ? badge('Active', '#22c55e') : badge('Inactive', '#94a3b8')}</td>
          <td>
            <form method="POST" action="${navUrl('/schedules/' + s.id + '/toggle')}" style="display:inline">
              <button class="btn" style="padding:4px 10px;font-size:12px;background:${s.is_active ? '#6b7280' : '#22c55e'}">${s.is_active ? 'Disable' : 'Enable'}</button>
            </form>
            <form method="POST" action="${navUrl('/schedules/' + s.id + '/delete')}" style="display:inline" onsubmit="return confirm('Delete?')">
              <button class="btn" style="padding:4px 10px;font-size:12px;background:#ef4444">Del</button>
            </form>
          </td></tr>`;
      });
      html += '</table>';
    } else { html += '<p style="color:#94a3b8">No schedules.</p>'; }
    html += `<a href="${navUrl('/schedules/new?zone_id=' + z.id)}" class="btn" style="margin-top:12px;display:inline-block">+ Add Schedule</a></div>`;

    // Logs
    if (logs.rows.length) {
      html += '<div class="card"><h3 style="margin-bottom:12px">Activity Log</h3>';
      html += '<table><tr><th>Action</th><th>Details</th><th>Temp</th><th>Timestamp</th></tr>';
      logs.rows.forEach(l => {
        html += `<tr><td><strong>${esc(l.action)}</strong></td><td>${esc(l.details || '—')}</td>
          <td>${l.temperature !== null ? fmtTemp(l.temperature) : '—'}</td><td>${fmtTime(l.timestamp)}</td></tr>`;
      });
      html += '</table></div>';
    }

    res.send(renderPage('Zone Details', html, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 10 — Schedules management
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/smart-hvac/schedules', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const schedules = await pool.query(
      `SELECT hs.*, hz.name AS zone_name FROM hvac_schedules hs
       JOIN hvac_zones hz ON hz.id=hs.zone_id WHERE hs.tenant_id=$1 ORDER BY hz.name, hs.day_of_week, hs.start_time`, [tid]);
    const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

    let html = SKIP + nav('Schedules');
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">';
    html += '<h2>HVAC Schedules</h2>';
    html += `<a href="${navUrl('/schedules/new')}" class="btn">+ Add Schedule</a></div>`;

    if (schedules.rows.length) {
      html += '<table><tr><th>Zone</th><th>Day</th><th>Start</th><th>End</th><th>Target</th><th>Mode</th><th>Status</th><th>Actions</th></tr>';
      schedules.rows.forEach(s => {
        html += `<tr><td><strong>${esc(s.zone_name)}</strong></td><td>${dayNames[s.day_of_week]}</td>
          <td>${s.start_time}</td><td>${s.end_time}</td><td>${fmtTemp(s.target_temp)}</td>
          <td>${badge(s.mode, '#e0e7ff')}</td>
          <td>${s.is_active ? badge('Active', '#22c55e') : badge('Inactive', '#94a3b8')}</td>
          <td>
            <form method="POST" action="${navUrl('/schedules/' + s.id + '/toggle')}" style="display:inline">
              <button class="btn" style="padding:4px 10px;font-size:12px;background:${s.is_active ? '#6b7280' : '#22c55e'}">${s.is_active ? 'Disable' : 'Enable'}</button>
            </form>
            <form method="POST" action="${navUrl('/schedules/' + s.id + '/delete')}" style="display:inline" onsubmit="return confirm('Delete?')">
              <button class="btn" style="padding:4px 10px;font-size:12px;background:#ef4444">Del</button>
            </form>
          </td></tr>`;
      });
      html += '</table>';
    } else { html += '<div class="card"><p style="color:#94a3b8">No schedules configured.</p></div>'; }
    res.send(renderPage('HVAC Schedules', html, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 11 — New schedule form + save
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/smart-hvac/schedules/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const zones = await pool.query("SELECT id, name FROM hvac_zones WHERE tenant_id=$1 ORDER BY name", [tid]);
    const preselected = req.query.zone_id || '';
    const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    let html = SKIP + nav('Schedules');
    html += '<div class="card"><h2>Add New Schedule</h2>';
    html += `<form method="POST" action="${navUrl('/schedules/create')}">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Zone *</label>
          <select name="zone_id" required><option value="">Select Zone</option>
            ${zones.rows.map(z => `<option value="${z.id}" ${z.id == preselected ? 'selected' : ''}>${esc(z.name)}</option>`).join('')}
          </select></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Day *</label>
          <select name="day_of_week" required>
            ${dayNames.map((d, i) => `<option value="${i}">${d}</option>`).join('')}
          </select></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Start Time *</label>
          <input name="start_time" type="time" required value="07:00"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">End Time *</label>
          <input name="end_time" type="time" required value="17:00"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Target Temp (°C)</label>
          <input name="target_temp" type="number" step="0.5" min="16" max="30" value="22.0"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Mode</label>
          <select name="mode">
            <option value="auto">Auto</option><option value="cool">Cool</option><option value="heat">Heat</option><option value="fan">Fan</option>
          </select></div>
      </div>
      <div style="margin-top:16px"><label><input type="checkbox" name="is_active" checked> Active</label></div>
      <div style="margin-top:16px"><button type="submit" class="btn">Create Schedule</button></div>
    </form></div>`;
    res.send(renderPage('Add HVAC Schedule', html, req.session.user, req));
  }));

  app.post('/school/smart-hvac/schedules/create', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { zone_id, day_of_week, start_time, end_time, target_temp, mode, is_active } = req.body;
    if (!zone_id) return res.status(400).send('Zone is required.');
    await pool.query(
      `INSERT INTO hvac_schedules (tenant_id, zone_id, day_of_week, start_time, end_time, target_temp, mode, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [tid, parseInt(zone_id), parseInt(day_of_week), start_time, end_time,
       parseFloat(target_temp) || 22.0, mode || 'auto', is_active !== undefined && is_active !== 'false']);
    audit(req, 'hvac_schedule_created', { zone_id, day_of_week });
    res.redirect(navUrl('/schedules'));
  }));

  app.post('/school/smart-hvac/schedules/:id/toggle', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query("UPDATE hvac_schedules SET is_active=NOT is_active WHERE id=$1 AND tenant_id=$2", [req.params.id, tid]);
    res.redirect(req.headers.referer || navUrl('/schedules'));
  }));

  app.post('/school/smart-hvac/schedules/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query("DELETE FROM hvac_schedules WHERE id=$1 AND tenant_id=$2", [req.params.id, tid]);
    res.redirect(req.headers.referer || navUrl('/schedules'));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 12 — Maintenance management
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/smart-hvac/maintenance', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const filter = req.query.status || '';
    let where = 'm.tenant_id=$1', params = [tid];
    if (filter) { where += ' AND m.status=$2'; params.push(filter); }

    const [tasks, zones] = await Promise.all([
      pool.query(
        `SELECT m.*, hz.name AS zone_name FROM hvac_maintenance m
         LEFT JOIN hvac_zones hz ON hz.id=m.zone_id
         WHERE ${where} ORDER BY m.due_date ASC NULLS LAST, m.created_at DESC`, params),
      pool.query("SELECT id, name FROM hvac_zones WHERE tenant_id=$1 ORDER BY name", [tid]),
    ]);
    const stats = await pool.query(
      "SELECT status, COUNT(*)::int AS c FROM hvac_maintenance WHERE tenant_id=$1 GROUP BY status", [tid]);

    let html = SKIP + nav('Maintenance');
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">';
    html += '<h2>Maintenance Tracker</h2>';
    html += `<a href="${navUrl('/maintenance/new')}" class="btn">+ Add Task</a></div>`;

    // Status summary
    const statusMap = {};
    stats.rows.forEach(s => { statusMap[s.status] = s.c; });
    html += '<div style="display:flex;gap:12px;margin-bottom:16px">';
    [['', 'All (' + tasks.rows.length + ')'], ['pending', 'Pending (' + (statusMap.pending || 0) + ')'],
     ['in_progress', 'In Progress (' + (statusMap.in_progress || 0) + ')'],
     ['completed', 'Completed (' + (statusMap.completed || 0) + ')']
    ].forEach(([v, l]) => {
      html += `<a href="${navUrl('/maintenance?status=' + v)}" style="padding:6px 14px;border-radius:8px;text-decoration:none;font-size:13px;` +
        (filter === v ? `background:${P};color:#fff` : `background:#f3f4f6;color:${GRAY}`) + `">${l}</a>`;
    });
    html += '</div>';

    // Overdue alert
    const overdue = await pool.query(
      "SELECT COUNT(*)::int AS c FROM hvac_maintenance WHERE tenant_id=$1 AND status='pending' AND due_date < CURRENT_DATE", [tid]);
    if (overdue.rows[0].c > 0) {
      html += `<div style="background:#fee2e2;border:1px solid #ef4444;border-radius:8px;padding:12px;margin-bottom:16px;color:#991b1b">
        <strong>⚠ ${overdue.rows[0].c} Overdue Task(s)</strong></div>`;
    }

    if (tasks.rows.length) {
      const priorityColors = { urgent: '#ef4444', high: '#f59e0b', normal: '#3b82f6', low: '#94a3b8' };
      const statusColors = { pending: '#f59e0b', in_progress: '#3b82f6', completed: '#22c55e', cancelled: '#94a3b8' };
      html += '<table><tr><th>Type</th><th>Zone</th><th>Description</th><th>Priority</th><th>Due Date</th><th>Cost</th><th>Status</th><th>Actions</th></tr>';
      tasks.rows.forEach(t => {
        const isOverdue = t.status === 'pending' && t.due_date && new Date(t.due_date) < new Date();
        html += `<tr style="${isOverdue ? 'background:#fef2f2' : ''}">
          <td><strong>${esc(t.maintenance_type)}</strong></td>
          <td>${esc(t.zone_name || '—')}</td>
          <td>${esc((t.description || '').substring(0, 60))}</td>
          <td>${badge(t.priority, priorityColors[t.priority] || '#94a3b8')}</td>
          <td>${isOverdue ? '<span style="color:#ef4444;font-weight:600">' + fmtDate(t.due_date) + ' (overdue)</span>' : fmtDate(t.due_date)}</td>
          <td>${fmtMoney(t.cost)}</td>
          <td>${badge(t.status, statusColors[t.status] || '#94a3b8')}</td>
          <td>
            ${t.status === 'pending' || t.status === 'in_progress'
              ? `<form method="POST" action="${navUrl('/maintenance/' + t.id + '/complete')}" style="display:inline">
                  <button class="btn" style="padding:4px 10px;font-size:12px;background:#22c55e">Complete</button>
                </form>` : ''}
            <a href="${navUrl('/maintenance/' + t.id + '/edit')}" class="btn" style="padding:4px 10px;font-size:12px;background:#0ea5e9">Edit</a>
          </td></tr>`;
      });
      html += '</table>';
    } else { html += '<div class="card"><p style="color:#94a3b8">No maintenance tasks.</p></div>'; }
    res.send(renderPage('HVAC Maintenance', html, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 13 — New maintenance task form
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/smart-hvac/maintenance/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const zones = await pool.query("SELECT id, name FROM hvac_zones WHERE tenant_id=$1 ORDER BY name", [tid]);
    let html = SKIP + nav('Maintenance');
    html += '<div class="card"><h2>Add Maintenance Task</h2>';
    html += `<form method="POST" action="${navUrl('/maintenance/create')}">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Type *</label>
          <select name="maintenance_type" required>
            <option value="filter_replacement">Filter Replacement</option>
            <option value="refrigerant_check">Refrigerant Check</option>
            <option value="duct_cleaning">Duct Cleaning</option>
            <option value="thermostat_calibration">Thermostat Calibration</option>
            <option value="coil_cleaning">Coil Cleaning</option>
            <option value="motor_inspection">Motor Inspection</option>
            <option value="electrical_check">Electrical Check</option>
            <option value="general_service">General Service</option>
            <option value="emergency_repair">Emergency Repair</option>
          </select></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Zone</label>
          <select name="zone_id"><option value="">General (no zone)</option>
            ${zones.rows.map(z => `<option value="${z.id}">${esc(z.name)}</option>`).join('')}
          </select></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Priority</label>
          <select name="priority">
            <option value="low">Low</option><option value="normal" selected>Normal</option>
            <option value="high">High</option><option value="urgent">Urgent</option>
          </select></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Due Date</label>
          <input name="due_date" type="date"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Estimated Cost ($)</label>
          <input name="cost" type="number" step="0.01" min="0" value="0"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Assigned To</label>
          <input name="assigned_to" placeholder="Technician name"></div>
      </div>
      <div style="margin-top:12px"><label style="display:block;margin-bottom:4px;font-weight:600">Description</label>
        <textarea name="description" rows="3" placeholder="Describe the maintenance task..."></textarea></div>
      <div style="margin-top:12px"><label style="display:block;margin-bottom:4px;font-weight:600">Notes</label>
        <textarea name="notes" rows="2" placeholder="Additional notes..."></textarea></div>
      <div style="margin-top:16px"><button type="submit" class="btn">Create Task</button></div>
    </form></div>`;
    res.send(renderPage('Add Maintenance Task', html, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 14 — Save maintenance task
  // ═══════════════════════════════════════════════════════════════════════════
  app.post('/school/smart-hvac/maintenance/create', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { maintenance_type, zone_id, priority, due_date, cost, assigned_to, description, notes } = req.body;
    await pool.query(
      `INSERT INTO hvac_maintenance (tenant_id, zone_id, maintenance_type, priority, due_date, cost, assigned_to, description, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [tid, zone_id ? parseInt(zone_id) : null, maintenance_type || 'general_service',
       priority || 'normal', due_date || null, parseFloat(cost) || 0,
       assigned_to || null, description || null, notes || null]);
    audit(req, 'hvac_maintenance_created', { type: maintenance_type });
    res.redirect(navUrl('/maintenance'));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 15 — Complete maintenance task
  // ═══════════════════════════════════════════════════════════════════════════
  app.post('/school/smart-hvac/maintenance/:id/complete', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { id } = req.params;
    await pool.query(
      "UPDATE hvac_maintenance SET status='completed', completed_date=CURRENT_DATE WHERE id=$1 AND tenant_id=$2", [id, tid]);
    audit(req, 'hvac_maintenance_completed', { task_id: id });
    res.redirect(req.headers.referer || navUrl('/maintenance'));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 16 — Edit maintenance task
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/smart-hvac/maintenance/:id/edit', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const task = await pool.query("SELECT * FROM hvac_maintenance WHERE id=$1 AND tenant_id=$2", [req.params.id, tid]);
    if (!task.rows.length) return res.status(404).send('Task not found.');
    const t = task.rows[0];
    const zones = await pool.query("SELECT id, name FROM hvac_zones WHERE tenant_id=$1 ORDER BY name", [tid]);
    let html = SKIP + nav('Maintenance');
    html += `<div class="card"><h2>Edit Task: ${esc(t.maintenance_type)}</h2>`;
    html += `<form method="POST" action="${navUrl('/maintenance/' + t.id + '/update')}">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Type</label>
          <select name="maintenance_type">
            ${['filter_replacement','refrigerant_check','duct_cleaning','thermostat_calibration','coil_cleaning','motor_inspection','electrical_check','general_service','emergency_repair']
              .map(v => `<option value="${v}" ${t.maintenance_type === v ? 'selected' : ''}>${v.replace(/_/g,' ').replace(/\b\w/g,l=>l.toUpperCase())}</option>`).join('')}
          </select></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Zone</label>
          <select name="zone_id"><option value="">General</option>
            ${zones.rows.map(z => `<option value="${z.id}" ${t.zone_id === z.id ? 'selected' : ''}>${esc(z.name)}</option>`).join('')}
          </select></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Priority</label>
          <select name="priority">
            ${['low','normal','high','urgent'].map(v => `<option value="${v}" ${t.priority === v ? 'selected' : ''}>${v.charAt(0).toUpperCase() + v.slice(1)}</option>`).join('')}
          </select></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Status</label>
          <select name="status">
            ${['pending','in_progress','completed','cancelled'].map(v => `<option value="${v}" ${t.status === v ? 'selected' : ''}>${v.replace(/_/g,' ').replace(/\b\w/g,l=>l.toUpperCase())}</option>`).join('')}
          </select></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Due Date</label>
          <input name="due_date" type="date" value="${t.due_date ? fmtDate(t.due_date) : ''}"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Cost ($)</label>
          <input name="cost" type="number" step="0.01" value="${t.cost}"></div>
      </div>
      <div style="margin-top:12px"><label style="display:block;margin-bottom:4px;font-weight:600">Description</label>
        <textarea name="description" rows="3">${esc(t.description || '')}</textarea></div>
      <div style="margin-top:12px"><label style="display:block;margin-bottom:4px;font-weight:600">Notes</label>
        <textarea name="notes" rows="2">${esc(t.notes || '')}</textarea></div>
      <div style="margin-top:16px"><button type="submit" class="btn">Save Changes</button></div>
    </form></div>`;
    res.send(renderPage('Edit Maintenance Task', html, req.session.user, req));
  }));

  app.post('/school/smart-hvac/maintenance/:id/update', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { id } = req.params;
    const { maintenance_type, zone_id, priority, status, due_date, cost, description, notes } = req.body;
    await pool.query(
      `UPDATE hvac_maintenance SET maintenance_type=$1, zone_id=$2, priority=$3, status=$4,
       due_date=$5, cost=$6, description=$7, notes=$8
       WHERE id=$9 AND tenant_id=$10`,
      [maintenance_type || 'general_service', zone_id ? parseInt(zone_id) : null,
       priority || 'normal', status || 'pending', due_date || null, parseFloat(cost) || 0,
       description || null, notes || null, id, tid]);
    audit(req, 'hvac_maintenance_updated', { task_id: id });
    res.redirect(navUrl('/maintenance'));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 17 — Cost tracking
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/smart-hvac/costs', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const totalMaintCost = await pool.query(
      "SELECT COALESCE(SUM(cost),0)::numeric AS total FROM hvac_maintenance WHERE tenant_id=$1 AND status='completed'", [tid]);
    const totalEnergy = await pool.query(
      "SELECT COALESCE(SUM(energy_kwh),0)::numeric AS total FROM hvac_zones WHERE tenant_id=$1", [tid]);
    const estEnergyCost = parseFloat(totalEnergy.rows[0].total) * 0.12;
    const costByType = await pool.query(
      "SELECT maintenance_type, COALESCE(SUM(cost),0)::numeric AS total, COUNT(*)::int AS c FROM hvac_maintenance WHERE tenant_id=$1 AND status='completed' GROUP BY maintenance_type ORDER BY total DESC", [tid]);
    const monthlyMaint = await pool.query(
      "SELECT TO_CHAR(completed_date, 'YYYY-MM') AS month, COALESCE(SUM(cost),0)::numeric AS total FROM hvac_maintenance WHERE tenant_id=$1 AND status='completed' AND completed_date IS NOT NULL GROUP BY month ORDER BY month DESC LIMIT 12", [tid]);

    let html = SKIP + nav('Costs');
    html += '<h2 style="margin-bottom:20px">Cost Tracking</h2>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px;margin-bottom:24px">';
    html += `<div class="card" style="text-align:center;border-left:4px solid ${P}"><div style="font-size:24px;font-weight:700;color:${P}">${fmtMoney(totalMaintCost.rows[0].total)}</div><div style="color:${GRAY};font-size:13px">Total Maintenance</div></div>`;
    html += `<div class="card" style="text-align:center;border-left:4px solid #f59e0b"><div style="font-size:24px;font-weight:700;color:#f59e0b">${fmtMoney(estEnergyCost)}</div><div style="color:${GRAY};font-size:13px">Est. Energy Cost</div></div>`;
    html += `<div class="card" style="text-align:center;border-left:4px solid #22c55e"><div style="font-size:24px;font-weight:700;color:#22c55e">${parseFloat(totalEnergy.rows[0].total).toFixed(1)} kWh</div><div style="color:${GRAY};font-size:13px">Total Energy</div></div>`;
    html += `<div class="card" style="text-align:center;border-left:4px solid #8b5cf6"><div style="font-size:24px;font-weight:700;color:#8b5cf6">${fmtMoney(parseFloat(totalMaintCost.rows[0].total) + estEnergyCost)}</div><div style="color:${GRAY};font-size:13px">Total HVAC Cost</div></div>`;
    html += '</div>';

    if (costByType.rows.length) {
      html += '<div class="card"><h3 style="margin-bottom:12px">Cost by Maintenance Type</h3>';
      html += '<table><tr><th>Type</th><th>Tasks</th><th>Total Cost</th></tr>';
      costByType.rows.forEach(c => {
        html += `<tr><td><strong>${esc(c.maintenance_type.replace(/_/g, ' '))}</strong></td><td>${c.c}</td><td>${fmtMoney(c.total)}</td></tr>`;
      });
      html += '</table></div>';
    }

    if (monthlyMaint.rows.length) {
      html += '<div class="card"><h3 style="margin-bottom:12px">Monthly Maintenance Spending</h3>';
      html += '<table><tr><th>Month</th><th>Cost</th></tr>';
      monthlyMaint.rows.forEach(m => {
        html += `<tr><td><strong>${esc(m.month)}</strong></td><td>${fmtMoney(m.total)}</td></tr>`;
      });
      html += '</table></div>';
    }

    res.send(renderPage('HVAC Costs', html, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 18 — Air quality integration
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/smart-hvac/air-quality', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const zones = await pool.query(
      "SELECT id, name, location, current_temp, humidity, comfort_score FROM hvac_zones WHERE tenant_id=$1 ORDER BY name", [tid]);

    let html = SKIP + nav('Air Quality');
    html += '<h2 style="margin-bottom:20px">Air Quality & Comfort Analysis</h2>';

    html += '<div class="card"><h3 style="margin-bottom:12px">Comfort Assessment by Zone</h3>';
    if (zones.rows.length) {
      html += '<table><tr><th>Zone</th><th>Location</th><th>Temp</th><th>Humidity</th><th>Comfort Score</th><th>Rating</th><th>Recommendation</th></tr>';
      zones.rows.forEach(z => {
        const cs = comfortScore(z.current_temp, z.humidity);
        const csColor = cs >= 80 ? '#22c55e' : cs >= 60 ? '#f59e0b' : '#ef4444';
        const t = parseFloat(z.current_temp) || 22;
        const h = parseFloat(z.humidity) || 50;
        let rec = '';
        if (t < 18) rec = 'Increase heating immediately';
        else if (t > 26) rec = 'Increase cooling';
        else if (t < 20) rec = 'Slightly increase temperature';
        else if (t > 24) rec = 'Slightly decrease temperature';
        if (h < 30) rec += (rec ? '; ' : '') + 'Add humidifier';
        else if (h > 65) rec += (rec ? '; ' : '') + 'Improve ventilation';
        if (!rec) rec = 'Conditions optimal';
        html += `<tr>
          <td><strong>${esc(z.name)}</strong></td><td>${esc(z.location || '—')}</td>
          <td>${fmtTemp(z.current_temp)}</td><td>${h.toFixed(1)}%</td>
          <td><span style="color:${csColor};font-weight:600">${cs}/100</span></td>
          <td>${cs >= 80 ? badge('Excellent', '#22c55e') : cs >= 60 ? badge('Acceptable', '#f59e0b') : badge('Poor', '#ef4444')}</td>
          <td style="font-size:13px;color:${GRAY}">${esc(rec)}</td></tr>`;
      });
      html += '</table>';
    } else { html += '<p style="color:#94a3b8">No zones configured.</p>'; }
    html += '</div>';

    html += '<div class="card"><h3 style="margin-bottom:12px">Recommended HVAC Settings</h3>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;font-size:14px">';
    html += '<div><strong>Classrooms:</strong> 20-24°C, 40-60% humidity</div>';
    html += '<div><strong>Laboratories:</strong> 20-22°C, 30-50% humidity</div>';
    html += '<div><strong>Library:</strong> 20-23°C, 40-55% humidity</div>';
    html += '<div><strong>Gymnasium:</strong> 18-22°C, 40-60% humidity</div>';
    html += '<div><strong>Server Room:</strong> 18-24°C, 35-45% humidity</div>';
    html += '<div><strong>Office:</strong> 21-24°C, 40-60% humidity</div>';
    html += '</div></div>';

    res.send(renderPage('Air Quality', html, req.session.user, req));
  }));
};
