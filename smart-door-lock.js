/**
 * Smart Door Lock Management Module
 * Multi-tenant SaaS platform (schools)
 *
 * Features: Door access management, key card assignment, access schedules,
 *   door status monitoring, unlock logs, emergency unlock, access level
 *   management, visitor temporary access, lock maintenance, battery monitoring
 * 11 routes · PostgreSQL · tenant_id scoped
 */
module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5', GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.btn:hover{background:#3730a3}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}</style>';

  // ── Helpers ────────────────────────────────────────────────────────────────
  function navUrl(a) { return '/school/smart-door-lock' + a; }
  function fmtDate(d) { return d ? new Date(d).toISOString().split('T')[0] : '—'; }
  function fmtTime(d) { return d ? new Date(d).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '—'; }
  function badge(label, color) { return `<span style="background:${color};color:#fff;padding:2px 10px;border-radius:12px;font-size:12px">${esc(label)}</span>`; }

  function nav(active) {
    const links = [
      ['Dashboard', ''], ['Doors', '/doors'], ['Access Cards', '/cards'],
      ['Schedules', '/schedules'], ['Logs', '/logs'], ['Emergency', '/emergency'],
      ['Maintenance', '/maintenance'],
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
        CREATE TABLE IF NOT EXISTS smart_doors (
          id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          name VARCHAR(100) NOT NULL, location VARCHAR(255), lock_type VARCHAR(50) DEFAULT 'electronic',
          status VARCHAR(20) DEFAULT 'locked', battery_level INT DEFAULT 100,
          last_maintenance DATE, model VARCHAR(100), firmware_version VARCHAR(50),
          ip_address VARCHAR(45), auto_lock BOOLEAN DEFAULT true, auto_lock_delay INT DEFAULT 30,
          created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS door_access_cards (
          id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          user_id INTEGER, card_uid VARCHAR(100) NOT NULL, card_name VARCHAR(200),
          access_level VARCHAR(30) DEFAULT 'standard', valid_from DATE DEFAULT CURRENT_DATE,
          valid_to DATE, status VARCHAR(20) DEFAULT 'active',
          notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS door_access_logs (
          id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          door_id INTEGER NOT NULL REFERENCES smart_doors(id) ON DELETE CASCADE,
          user_id INTEGER, card_id INTEGER REFERENCES door_access_cards(id),
          method VARCHAR(50) NOT NULL, granted BOOLEAN DEFAULT false,
          denied_reason VARCHAR(100), timestamp TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS door_schedules (
          id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          door_id INTEGER NOT NULL REFERENCES smart_doors(id) ON DELETE CASCADE,
          day_of_week INT NOT NULL, unlock_time TIME, lock_time TIME,
          access_levels JSONB DEFAULT '["all"]', is_active BOOLEAN DEFAULT true,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS door_maintenance (
          id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          door_id INTEGER NOT NULL REFERENCES smart_doors(id) ON DELETE CASCADE,
          maintenance_type VARCHAR(50) NOT NULL, description TEXT,
          scheduled_date DATE, completed_date DATE, status VARCHAR(20) DEFAULT 'pending',
          technician VARCHAR(100), cost NUMERIC(8,2) DEFAULT 0,
          notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      const idxs = [
        'CREATE INDEX IF NOT EXISTS idx_sd_tenant ON smart_doors(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_sd_status ON smart_doors(status)',
        'CREATE INDEX IF NOT EXISTS idx_dac_tenant ON door_access_cards(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_dac_uid ON door_access_cards(card_uid)',
        'CREATE INDEX IF NOT EXISTS idx_dac_status ON door_access_cards(status)',
        'CREATE INDEX IF NOT EXISTS idx_dal_tenant ON door_access_logs(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_dal_door ON door_access_logs(door_id)',
        'CREATE INDEX IF NOT EXISTS idx_dal_ts ON door_access_logs(timestamp)',
        'CREATE INDEX IF NOT EXISTS idx_dal_granted ON door_access_logs(granted)',
        'CREATE INDEX IF NOT EXISTS idx_dsch_tenant ON door_schedules(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_dsch_door ON door_schedules(door_id)',
        'CREATE INDEX IF NOT EXISTS idx_dm_tenant ON door_maintenance(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_dm_status ON door_maintenance(status)',
      ];
      for (const sql of idxs) { try { await pool.query(sql); } catch (_) {} }
      console.log('[SmartDoorLock] Tables ready');
    } catch (e) { console.warn('[SmartDoorLock] Migration warning:', e.message); }
  })();

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 1 — Dashboard
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/smart-door-lock', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [totalDoors, lockedDoors, unlockedDoors, totalCards, activeCards, lowBattery] = await Promise.all([
      pool.query("SELECT COUNT(*)::int AS c FROM smart_doors WHERE tenant_id=$1", [tid]),
      pool.query("SELECT COUNT(*)::int AS c FROM smart_doors WHERE tenant_id=$1 AND status='locked'", [tid]),
      pool.query("SELECT COUNT(*)::int AS c FROM smart_doors WHERE tenant_id=$1 AND status='unlocked'", [tid]),
      pool.query("SELECT COUNT(*)::int AS c FROM door_access_cards WHERE tenant_id=$1", [tid]),
      pool.query("SELECT COUNT(*)::int AS c FROM door_access_cards WHERE tenant_id=$1 AND status='active'", [tid]),
      pool.query("SELECT COUNT(*)::int AS c FROM smart_doors WHERE tenant_id=$1 AND battery_level < 20", [tid]),
    ]);
    const todayAccess = await pool.query(
      "SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE granted=true)::int AS granted, COUNT(*) FILTER (WHERE granted=false)::int AS denied FROM door_access_logs WHERE tenant_id=$1 AND timestamp >= CURRENT_DATE", [tid]);
    const pendingMaint = await pool.query(
      "SELECT COUNT(*)::int AS c FROM door_maintenance WHERE tenant_id=$1 AND status='pending'", [tid]);

    let html = SKIP + nav('Dashboard');
    html += '<h2 style="margin-bottom:20px">Smart Door Lock Dashboard</h2>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:16px;margin-bottom:24px">';
    html += `<div class="card" style="text-align:center"><div style="font-size:28px;font-weight:700;color:${P}">${totalDoors.rows[0].c}</div><div style="color:${GRAY};font-size:13px">Total Doors</div></div>`;
    html += `<div class="card" style="text-align:center"><div style="font-size:28px;font-weight:700;color:#22c55e">${lockedDoors.rows[0].c}</div><div style="color:${GRAY};font-size:13px">Locked</div></div>`;
    html += `<div class="card" style="text-align:center"><div style="font-size:28px;font-weight:700;color:#f59e0b">${unlockedDoors.rows[0].c}</div><div style="color:${GRAY};font-size:13px">Unlocked</div></div>`;
    html += `<div class="card" style="text-align:center"><div style="font-size:28px;font-weight:700;color:#3b82f6">${activeCards.rows[0].c}</div><div style="color:${GRAY};font-size:13px">Active Cards</div></div>`;
    html += `<div class="card" style="text-align:center"><div style="font-size:28px;font-weight:700;color:#8b5cf6">${todayAccess.rows[0].total}</div><div style="color:${GRAY};font-size:13px">Today Access</div></div>`;
    html += `<div class="card" style="text-align:center"><div style="font-size:28px;font-weight:700;color:#ef4444">${lowBattery.rows[0].c}</div><div style="color:${GRAY};font-size:13px">Low Battery</div></div>`;
    html += `<div class="card" style="text-align:center"><div style="font-size:28px;font-weight:700;color:#f59e0b">${pendingMaint.rows[0].c}</div><div style="color:${GRAY};font-size:13px">Pending Maint.</div></div>`;
    html += '</div>';

    if (lowBattery.rows[0].c > 0) {
      html += `<div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:12px;margin-bottom:16px;color:#92400e">
        <strong>Low Battery Alert:</strong> ${lowBattery.rows[0].c} door lock(s) have battery below 20%.</div>`;
    }

    // Door status overview
    const doors = await pool.query("SELECT * FROM smart_doors WHERE tenant_id=$1 ORDER BY name", [tid]);
    if (doors.rows.length) {
      html += '<div class="card"><h3 style="margin-bottom:12px">Door Status Overview</h3>';
      html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px">';
      doors.rows.forEach(d => {
        const statusColor = d.status === 'locked' ? '#22c55e' : d.status === 'unlocked' ? '#f59e0b' : '#ef4444';
        const battColor = d.battery_level >= 60 ? '#22c55e' : d.battery_level >= 20 ? '#f59e0b' : '#ef4444';
        html += `<div style="border:1px solid ${statusColor};border-radius:10px;padding:14px;background:#fafafa">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <strong>${esc(d.name)}</strong>
            ${badge(d.status, statusColor)}
          </div>
          <div style="font-size:13px;color:${GRAY};margin-bottom:4px">${esc(d.location || '—')}</div>
          <div style="font-size:13px;margin-bottom:8px">Type: ${esc(d.lock_type)}</div>
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div style="font-size:13px"><span style="color:${battColor};font-weight:600">🔋 ${d.battery_level}%</span></div>
            <form method="POST" action="${navUrl('/doors/' + d.id + '/toggle')}" style="display:inline">
              <button class="btn" style="padding:3px 12px;font-size:12px;background:${d.status === 'locked' ? '#f59e0b' : '#22c55e'}">${d.status === 'locked' ? 'Unlock' : 'Lock'}</button>
            </form>
          </div>
        </div>`;
      });
      html += '</div></div>';
    }

    // Recent access logs
    const recentLogs = await pool.query(
      `SELECT dal.*, sd.name AS door_name, dac.card_name
       FROM door_access_logs dal
       JOIN smart_doors sd ON sd.id=dal.door_id
       LEFT JOIN door_access_cards dac ON dac.id=dal.card_id
       WHERE dal.tenant_id=$1 ORDER BY dal.timestamp DESC LIMIT 10`, [tid]);
    if (recentLogs.rows.length) {
      html += '<div class="card"><h3 style="margin-bottom:12px">Recent Access Activity</h3>';
      html += '<table><tr><th>Door</th><th>Card</th><th>Method</th><th>Result</th><th>Time</th></tr>';
      recentLogs.rows.forEach(l => {
        html += `<tr>
          <td><strong>${esc(l.door_name)}</strong></td>
          <td>${esc(l.card_name || 'User #' + (l.user_id || '?'))}</td>
          <td>${badge(l.method, '#e0e7ff')}</td>
          <td>${l.granted ? badge('Granted', '#22c55e') : badge('Denied', '#ef4444')}</td>
          <td>${fmtTime(l.timestamp)}</td></tr>`;
      });
      html += '</table></div>';
    }

    res.send(renderPage('Smart Door Lock Dashboard', html, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 2 — Doors list
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/smart-door-lock/doors', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const doors = await pool.query("SELECT * FROM smart_doors WHERE tenant_id=$1 ORDER BY name", [tid]);

    let html = SKIP + nav('Doors');
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">';
    html += '<h2>Smart Doors</h2>';
    html += `<a href="${navUrl('/doors/new')}" class="btn">+ Add Door</a></div>`;

    if (doors.rows.length) {
      html += '<table><tr><th>Name</th><th>Location</th><th>Type</th><th>Status</th><th>Battery</th><th>Auto-Lock</th><th>Last Maint.</th><th>Actions</th></tr>';
      doors.rows.forEach(d => {
        const statusColor = d.status === 'locked' ? '#22c55e' : d.status === 'unlocked' ? '#f59e0b' : '#ef4444';
        const battColor = d.battery_level >= 60 ? '#22c55e' : d.battery_level >= 20 ? '#f59e0b' : '#ef4444';
        html += `<tr>
          <td><strong>${esc(d.name)}</strong></td>
          <td>${esc(d.location || '—')}</td>
          <td>${badge(d.lock_type, '#e0e7ff')}</td>
          <td>${badge(d.status, statusColor)}</td>
          <td><span style="color:${battColor};font-weight:600">${d.battery_level}%</span></td>
          <td>${d.auto_lock ? d.auto_lock_delay + 's' : 'Off'}</td>
          <td>${fmtDate(d.last_maintenance)}</td>
          <td>
            <form method="POST" action="${navUrl('/doors/' + d.id + '/toggle')}" style="display:inline">
              <button class="btn" style="padding:4px 10px;font-size:12px;background:${d.status === 'locked' ? '#f59e0b' : '#22c55e'}">${d.status === 'locked' ? 'Unlock' : 'Lock'}</button>
            </form>
            <a href="${navUrl('/doors/' + d.id + '/edit')}" class="btn" style="padding:4px 10px;font-size:12px;background:#0ea5e9">Edit</a>
          </td></tr>`;
      });
      html += '</table>';
    } else { html += '<div class="card"><p style="color:#94a3b8">No doors registered.</p></div>'; }
    res.send(renderPage('Smart Doors', html, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 3 — New door + save
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/smart-door-lock/doors/new', requireAuth, requireNotBanned, (req, res) => {
    let html = SKIP + nav('Doors');
    html += '<div class="card"><h2>Register New Door</h2>';
    html += `<form method="POST" action="${navUrl('/doors/create')}">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Door Name *</label>
          <input name="name" required placeholder="e.g. Main Entrance"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Location *</label>
          <input name="location" required placeholder="e.g. Building A, East Wing"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Lock Type</label>
          <select name="lock_type">
            <option value="electronic">Electronic Deadbolt</option><option value="magnetic">Magnetic Lock</option>
            <option value="smartpad">Smart Keypad</option><option value="biometric">Biometric</option>
            <option value="motorized">Motorized Latch</option>
          </select></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Status</label>
          <select name="status"><option value="locked">Locked</option><option value="unlocked">Unlocked</option></select></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Battery Level (%)</label>
          <input name="battery_level" type="number" min="0" max="100" value="100"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Model</label>
          <input name="model" placeholder="e.g. Schlage BE469"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Firmware</label>
          <input name="firmware_version" placeholder="e.g. v3.2.1"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">IP Address</label>
          <input name="ip_address" placeholder="192.168.1.200"></div>
      </div>
      <div style="margin-top:16px;display:flex;gap:16px">
        <label><input type="checkbox" name="auto_lock" checked> Auto-Lock</label>
        <label>Delay: <input name="auto_lock_delay" type="number" min="5" max="300" value="30" style="width:80px;display:inline"> seconds</label>
      </div>
      <div style="margin-top:16px"><button type="submit" class="btn">Register Door</button></div>
    </form></div>`;
    res.send(renderPage('Add Door', html, req.session.user, req));
  });

  app.post('/school/smart-door-lock/doors/create', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { name, location, lock_type, status, battery_level, model, firmware_version, ip_address, auto_lock, auto_lock_delay } = req.body;
    if (!name || !name.trim()) return res.status(400).send('Door name is required.');
    await pool.query(
      `INSERT INTO smart_doors (tenant_id, name, location, lock_type, status, battery_level, model, firmware_version, ip_address, auto_lock, auto_lock_delay)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [tid, name.trim(), location || null, lock_type || 'electronic', status || 'locked',
       Math.min(Math.max(parseInt(battery_level) || 100, 0), 100),
       model || null, firmware_version || null, ip_address || null,
       auto_lock === 'on', Math.min(parseInt(auto_lock_delay) || 30, 300)]);
    audit(req, 'door_registered', { name: name.trim() });
    res.redirect(navUrl('/doors'));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 4 — Toggle door lock
  // ═══════════════════════════════════════════════════════════════════════════
  app.post('/school/smart-door-lock/doors/:id/toggle', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { id } = req.params;
    const door = await pool.query("SELECT status FROM smart_doors WHERE id=$1 AND tenant_id=$2", [id, tid]);
    if (!door.rows.length) return res.status(404).send('Door not found.');
    const newStatus = door.rows[0].status === 'locked' ? 'unlocked' : 'locked';
    await pool.query("UPDATE smart_doors SET status=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3", [newStatus, id, tid]);
    await pool.query(
      "INSERT INTO door_access_logs (tenant_id, door_id, method, granted, user_id) VALUES ($1,$2,$3,$4,$5)",
      [tid, id, 'manual_toggle', true, req.session.user.id]);
    audit(req, 'door_toggled', { door_id: id, to: newStatus });
    res.redirect(req.headers.referer || navUrl(''));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 5 — Edit door
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/smart-door-lock/doors/:id/edit', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const door = await pool.query("SELECT * FROM smart_doors WHERE id=$1 AND tenant_id=$2", [req.params.id, tid]);
    if (!door.rows.length) return res.status(404).send('Door not found.');
    const d = door.rows[0];
    let html = SKIP + nav('Doors');
    html += `<div class="card"><h2>Edit Door: ${esc(d.name)}</h2>`;
    html += `<form method="POST" action="${navUrl('/doors/' + d.id + '/update')}">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Name *</label>
          <input name="name" value="${esc(d.name)}" required></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Location</label>
          <input name="location" value="${esc(d.location || '')}"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Lock Type</label>
          <select name="lock_type">${['electronic','magnetic','smartpad','biometric','motorized'].map(t => `<option value="${t}" ${d.lock_type === t ? 'selected' : ''}>${t.replace(/\b\w/g,l=>l.toUpperCase())}</option>`).join('')}</select></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Battery (%)</label>
          <input name="battery_level" type="number" min="0" max="100" value="${d.battery_level}"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Model</label>
          <input name="model" value="${esc(d.model || '')}"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Firmware</label>
          <input name="firmware_version" value="${esc(d.firmware_version || '')}"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">IP Address</label>
          <input name="ip_address" value="${esc(d.ip_address || '')}"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Last Maintenance</label>
          <input name="last_maintenance" type="date" value="${d.last_maintenance ? fmtDate(d.last_maintenance) : ''}"></div>
      </div>
      <div style="margin-top:16px;display:flex;gap:16px">
        <label><input type="checkbox" name="auto_lock" ${d.auto_lock ? 'checked' : ''}> Auto-Lock</label>
        <label>Delay: <input name="auto_lock_delay" type="number" min="5" max="300" value="${d.auto_lock_delay}" style="width:80px;display:inline"> seconds</label>
      </div>
      <div style="margin-top:16px"><button type="submit" class="btn">Save Changes</button></div>
    </form></div>`;
    res.send(renderPage('Edit Door', html, req.session.user, req));
  }));

  app.post('/school/smart-door-lock/doors/:id/update', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { id } = req.params;
    const { name, location, lock_type, battery_level, model, firmware_version, ip_address, last_maintenance, auto_lock, auto_lock_delay } = req.body;
    await pool.query(
      `UPDATE smart_doors SET name=$1, location=$2, lock_type=$3, battery_level=$4, model=$5,
       firmware_version=$6, ip_address=$7, last_maintenance=$8, auto_lock=$9, auto_lock_delay=$10, updated_at=NOW()
       WHERE id=$11 AND tenant_id=$12`,
      [name.trim(), location || null, lock_type || 'electronic',
       Math.min(Math.max(parseInt(battery_level) || 100, 0), 100),
       model || null, firmware_version || null, ip_address || null,
       last_maintenance || null, auto_lock === 'on',
       Math.min(parseInt(auto_lock_delay) || 30, 300), id, tid]);
    audit(req, 'door_updated', { door_id: id });
    res.redirect(navUrl('/doors'));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 6 — Access cards management
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/smart-door-lock/cards', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const filter = req.query.status || '';
    let where = 'c.tenant_id=$1', params = [tid];
    if (filter) { where += ' AND c.status=$2'; params.push(filter); }
    const cards = await pool.query(`SELECT c.* FROM door_access_cards c WHERE ${where} ORDER BY c.created_at DESC`, params);

    let html = SKIP + nav('Access Cards');
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">';
    html += '<h2>Access Cards</h2>';
    html += `<a href="${navUrl('/cards/new')}" class="btn">+ Issue Card</a></div>`;

    html += '<div style="display:flex;gap:6px;margin-bottom:16px">';
    [['', 'All'], ['active', 'Active'], ['inactive', 'Inactive'], ['expired', 'Expired'], ['lost', 'Lost']].forEach(([v, l]) => {
      html += `<a href="${navUrl('/cards?status=' + v)}" style="padding:6px 14px;border-radius:8px;text-decoration:none;font-size:13px;` +
        (filter === v ? `background:${P};color:#fff` : `background:#f3f4f6;color:${GRAY}`) + `">${l}</a>`;
    });
    html += '</div>';

    if (cards.rows.length) {
      const levelColors = { admin: '#dc2626', staff: '#3b82f6', standard: '#22c55e', visitor: '#f59e0b', restricted: '#ef4444' };
      const statusColors = { active: '#22c55e', inactive: '#94a3b8', expired: '#f59e0b', lost: '#ef4444' };
      html += '<table><tr><th>ID</th><th>Card UID</th><th>Name</th><th>User</th><th>Access Level</th><th>Valid From</th><th>Valid To</th><th>Status</th><th>Actions</th></tr>';
      cards.rows.forEach(c => {
        const isExpired = c.status !== 'expired' && c.valid_to && new Date(c.valid_to) < new Date();
        const displayStatus = isExpired ? 'expired' : c.status;
        html += `<tr>
          <td>#${c.id}</td>
          <td><code style="font-size:12px;background:#f3f4f6;padding:2px 6px;border-radius:4px">${esc(c.card_uid)}</code></td>
          <td>${esc(c.card_name || '—')}</td>
          <td>${c.user_id ? '#' + c.user_id : '—'}</td>
          <td>${badge(c.access_level, levelColors[c.access_level] || '#94a3b8')}</td>
          <td>${fmtDate(c.valid_from)}</td>
          <td>${fmtDate(c.valid_to)}</td>
          <td>${badge(displayStatus, statusColors[displayStatus] || '#94a3b8')}</td>
          <td>
            <a href="${navUrl('/cards/' + c.id + '/edit')}" class="btn" style="padding:4px 10px;font-size:12px;background:#0ea5e9">Edit</a>
            ${c.status === 'active'
              ? `<form method="POST" action="${navUrl('/cards/' + c.id + '/deactivate')}" style="display:inline" onsubmit="return confirm('Deactivate this card?')">
                  <button class="btn" style="padding:4px 10px;font-size:12px;background:#6b7280">Deactivate</button></form>` : ''}
          </td></tr>`;
      });
      html += '</table>';
    } else { html += '<div class="card"><p style="color:#94a3b8">No access cards.</p></div>'; }
    res.send(renderPage('Access Cards', html, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 7 — Issue new card
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/smart-door-lock/cards/new', requireAuth, requireNotBanned, (req, res) => {
    let html = SKIP + nav('Access Cards');
    html += '<div class="card"><h2>Issue Access Card</h2>';
    html += `<form method="POST" action="${navUrl('/cards/create')}">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Card UID *</label>
          <input name="card_uid" required placeholder="e.g. A1B2C3D4E5"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Card Holder Name</label>
          <input name="card_name" placeholder="Full name of card holder"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">User ID</label>
          <input name="user_id" type="number" placeholder="Link to existing user"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Access Level *</label>
          <select name="access_level" required>
            <option value="admin">Admin — All Doors</option>
            <option value="staff">Staff — Most Doors</option>
            <option value="standard" selected>Standard — General Access</option>
            <option value="visitor">Visitor — Limited Temp Access</option>
            <option value="restricted">Restricted — Specific Doors Only</option>
          </select></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Valid From</label>
          <input name="valid_from" type="date" value="${new Date().toISOString().split('T')[0]}"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Valid To</label>
          <input name="valid_to" type="date" placeholder="Leave blank for permanent"></div>
      </div>
      <div style="margin-top:12px"><label style="display:block;margin-bottom:4px;font-weight:600">Notes</label>
        <textarea name="notes" rows="2" placeholder="Card notes..."></textarea></div>
      <div style="margin-top:16px"><button type="submit" class="btn">Issue Card</button></div>
    </form></div>`;
    res.send(renderPage('Issue Access Card', html, req.session.user, req));
  });

  app.post('/school/smart-door-lock/cards/create', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { card_uid, card_name, user_id, access_level, valid_from, valid_to, notes } = req.body;
    if (!card_uid || !card_uid.trim()) return res.status(400).send('Card UID is required.');
    try {
      await pool.query(
        `INSERT INTO door_access_cards (tenant_id, card_uid, card_name, user_id, access_level, valid_from, valid_to, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [tid, card_uid.trim(), card_name || null, user_id ? parseInt(user_id) : null,
         access_level || 'standard', valid_from || new Date().toISOString().split('T')[0],
         valid_to || null, notes || null]);
    } catch (e) {
      if (e.code === '23505') return res.status(400).send('Card UID already exists.');
      throw e;
    }
    audit(req, 'access_card_issued', { card_uid: card_uid.trim(), access_level });
    res.redirect(navUrl('/cards'));
  }));

  app.get('/school/smart-door-lock/cards/:id/edit', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const card = await pool.query("SELECT * FROM door_access_cards WHERE id=$1 AND tenant_id=$2", [req.params.id, tid]);
    if (!card.rows.length) return res.status(404).send('Card not found.');
    const c = card.rows[0];
    let html = SKIP + nav('Access Cards');
    html += `<div class="card"><h2>Edit Card: ${esc(c.card_uid)}</h2>
      <form method="POST" action="${navUrl('/cards/' + c.id + '/update')}">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div><label style="display:block;margin-bottom:4px;font-weight:600">Card UID</label>
            <input name="card_uid" value="${esc(c.card_uid)}" readonly style="background:#f3f4f6"></div>
          <div><label style="display:block;margin-bottom:4px;font-weight:600">Card Name</label>
            <input name="card_name" value="${esc(c.card_name || '')}"></div>
          <div><label style="display:block;margin-bottom:4px;font-weight:600">Access Level</label>
            <select name="access_level">${['admin','staff','standard','visitor','restricted'].map(l => `<option value="${l}" ${c.access_level === l ? 'selected' : ''}>${l.charAt(0).toUpperCase() + l.slice(1)}</option>`).join('')}
            </select></div>
          <div><label style="display:block;margin-bottom:4px;font-weight:600">Status</label>
            <select name="status">${['active','inactive','expired','lost'].map(s => `<option value="${s}" ${c.status === s ? 'selected' : ''}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`).join('')}
            </select></div>
          <div><label style="display:block;margin-bottom:4px;font-weight:600">Valid From</label>
            <input name="valid_from" type="date" value="${fmtDate(c.valid_from)}"></div>
          <div><label style="display:block;margin-bottom:4px;font-weight:600">Valid To</label>
            <input name="valid_to" type="date" value="${fmtDate(c.valid_to)}"></div>
        </div>
        <div style="margin-top:12px"><label style="display:block;margin-bottom:4px;font-weight:600">Notes</label>
          <textarea name="notes" rows="2">${esc(c.notes || '')}</textarea></div>
        <div style="margin-top:16px"><button type="submit" class="btn">Save Changes</button></div>
      </form></div>`;
    res.send(renderPage('Edit Access Card', html, req.session.user, req));
  }));

  app.post('/school/smart-door-lock/cards/:id/update', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { id } = req.params;
    const { card_name, access_level, status, valid_from, valid_to, notes } = req.body;
    await pool.query(
      "UPDATE door_access_cards SET card_name=$1, access_level=$2, status=$3, valid_from=$4, valid_to=$5, notes=$6 WHERE id=$7 AND tenant_id=$8",
      [card_name || null, access_level || 'standard', status || 'active', valid_from || null, valid_to || null, notes || null, id, tid]);
    audit(req, 'access_card_updated', { card_id: id });
    res.redirect(navUrl('/cards'));
  }));

  app.post('/school/smart-door-lock/cards/:id/deactivate', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query("UPDATE door_access_cards SET status='inactive' WHERE id=$1 AND tenant_id=$2", [req.params.id, tid]);
    audit(req, 'access_card_deactivated', { card_id: req.params.id });
    res.redirect(req.headers.referer || navUrl('/cards'));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 8 — Access schedules
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/smart-door-lock/schedules', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const schedules = await pool.query(
      `SELECT ds.*, sd.name AS door_name FROM door_schedules ds
       JOIN smart_doors sd ON sd.id=ds.door_id WHERE ds.tenant_id=$1 ORDER BY sd.name, ds.day_of_week`, [tid]);
    const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

    let html = SKIP + nav('Schedules');
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">';
    html += '<h2>Door Schedules</h2>';
    html += `<a href="${navUrl('/schedules/new')}" class="btn">+ Add Schedule</a></div>`;

    if (schedules.rows.length) {
      html += '<table><tr><th>Door</th><th>Day</th><th>Unlock</th><th>Lock</th><th>Access Levels</th><th>Status</th><th>Actions</th></tr>';
      schedules.rows.forEach(s => {
        html += `<tr>
          <td><strong>${esc(s.door_name)}</strong></td>
          <td>${dayNames[s.day_of_week] || s.day_of_week}</td>
          <td>${s.unlock_time || '24h'}</td><td>${s.lock_time || '24h'}</td>
          <td>${Array.isArray(s.access_levels) ? s.access_levels.join(', ') : esc(JSON.stringify(s.access_levels || '[]'))}</td>
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
    res.send(renderPage('Door Schedules', html, req.session.user, req));
  }));

  app.get('/school/smart-door-lock/schedules/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const doors = await pool.query("SELECT id, name FROM smart_doors WHERE tenant_id=$1 ORDER BY name", [tid]);
    const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    let html = SKIP + nav('Schedules');
    html += '<div class="card"><h2>Add Door Schedule</h2>';
    html += `<form method="POST" action="${navUrl('/schedules/create')}">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Door *</label>
          <select name="door_id" required><option value="">Select Door</option>
            ${doors.rows.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}
          </select></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Day *</label>
          <select name="day_of_week" required>
            ${dayNames.map((d, i) => `<option value="${i}">${d}</option>`).join('')}
          </select></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Unlock Time (blank = always unlocked)</label>
          <input name="unlock_time" type="time" value="07:00"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Lock Time (blank = always locked)</label>
          <input name="lock_time" type="time" value="18:00"></div>
      </div>
      <div style="margin-top:12px"><label style="display:block;margin-bottom:4px;font-weight:600">Access Levels</label>
        <div style="display:flex;gap:12px;flex-wrap:wrap">
          ${['all','admin','staff','standard','visitor'].map(l => `<label><input type="checkbox" name="access_levels" value="${l}" ${l === 'all' ? 'checked' : ''}> ${l}</label>`).join('')}
        </div></div>
      <div style="margin-top:16px"><label><input type="checkbox" name="is_active" checked> Active</label></div>
      <div style="margin-top:16px"><button type="submit" class="btn">Create Schedule</button></div>
    </form></div>`;
    res.send(renderPage('Add Door Schedule', html, req.session.user, req));
  }));

  app.post('/school/smart-door-lock/schedules/create', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { door_id, day_of_week, unlock_time, lock_time, access_levels, is_active } = req.body;
    if (!door_id) return res.status(400).send('Door is required.');
    const levels = Array.isArray(access_levels) ? access_levels : (access_levels ? [access_levels] : ['all']);
    await pool.query(
      `INSERT INTO door_schedules (tenant_id, door_id, day_of_week, unlock_time, lock_time, access_levels, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [tid, parseInt(door_id), parseInt(day_of_week), unlock_time || null, lock_time || null,
       JSON.stringify(levels), is_active !== undefined && is_active !== 'false']);
    audit(req, 'door_schedule_created');
    res.redirect(navUrl('/schedules'));
  }));

  app.post('/school/smart-door-lock/schedules/:id/toggle', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query("UPDATE door_schedules SET is_active=NOT is_active WHERE id=$1 AND tenant_id=$2", [req.params.id, tid]);
    res.redirect(req.headers.referer || navUrl('/schedules'));
  }));

  app.post('/school/smart-door-lock/schedules/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query("DELETE FROM door_schedules WHERE id=$1 AND tenant_id=$2", [req.params.id, tid]);
    res.redirect(req.headers.referer || navUrl('/schedules'));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 9 — Access logs
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/smart-door-lock/logs', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = 30;
    const offset = (page - 1) * limit;
    const doorFilter = req.query.door_id || '';
    const grantedFilter = req.query.granted || '';

    let where = 'l.tenant_id=$1', params = [tid], pNum = 2;
    if (doorFilter) { where += ` AND l.door_id=$${pNum++}`; params.push(parseInt(doorFilter)); }
    if (grantedFilter) { where += ` AND l.granted=$${pNum++}`; params.push(grantedFilter === 'true'); }

    const [logs, doors, countResult] = await Promise.all([
      pool.query(
        `SELECT l.*, d.name AS door_name, c.card_name
         FROM door_access_logs l JOIN smart_doors d ON d.id=l.door_id
         LEFT JOIN door_access_cards c ON c.id=l.card_id
         WHERE ${where} ORDER BY l.timestamp DESC LIMIT $${pNum} OFFSET $${pNum + 1}`,
        [...params, limit, offset]),
      pool.query("SELECT id, name FROM smart_doors WHERE tenant_id=$1 ORDER BY name", [tid]),
      pool.query(`SELECT COUNT(*)::int AS c FROM door_access_logs l WHERE ${where}`, params),
    ]);
    const totalPages = Math.ceil(countResult.rows[0].c / limit);

    let html = SKIP + nav('Logs');
    html += '<h2 style="margin-bottom:16px">Access Logs</h2>';
    html += `<form method="GET" style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap;align-items:end">
      <div><label style="font-size:12px;color:${GRAY}">Door</label><select name="door_id" style="width:200px"><option value="">All Doors</option>
        ${doors.rows.map(d => `<option value="${d.id}" ${d.id == doorFilter ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}
      </select></div>
      <div><label style="font-size:12px;color:${GRAY}">Result</label><select name="granted" style="width:150px"><option value="">All</option>
        <option value="true" ${grantedFilter === 'true' ? 'selected' : ''}>Granted</option>
        <option value="false" ${grantedFilter === 'false' ? 'selected' : ''}>Denied</option>
      </select></div>
      <button type="submit" class="btn" style="background:#6b7280">Filter</button>
      <a href="${navUrl('/logs')}" class="btn" style="background:#94a3b8">Clear</a>
    </form>`;

    html += `<div style="margin-bottom:16px;font-size:14px;color:${GRAY}">${countResult.rows[0].c} records</div>`;

    if (logs.rows.length) {
      html += '<table><tr><th>Door</th><th>Card/User</th><th>Method</th><th>Granted</th><th>Denial Reason</th><th>Timestamp</th></tr>';
      logs.rows.forEach(l => {
        html += `<tr>
          <td><strong>${esc(l.door_name)}</strong></td>
          <td>${esc(l.card_name || 'User #' + (l.user_id || '?'))}</td>
          <td>${badge(l.method, '#e0e7ff')}</td>
          <td>${l.granted ? badge('Granted', '#22c55e') : badge('Denied', '#ef4444')}</td>
          <td>${esc(l.denied_reason || '—')}</td>
          <td>${fmtTime(l.timestamp)}</td></tr>`;
      });
      html += '</table>';
      if (totalPages > 1) {
        html += '<div style="display:flex;gap:8px;margin-top:16px;justify-content:center">';
        for (let i = 1; i <= Math.min(totalPages, 10); i++) {
          html += `<a href="${navUrl('/logs?page=' + i + (doorFilter ? '&door_id=' + doorFilter : '') + (grantedFilter ? '&granted=' + grantedFilter : ''))}" style="padding:6px 12px;border-radius:6px;text-decoration:none;${i === page ? 'background:' + P + ';color:#fff' : 'background:#f3f4f6;color:' + GRAY}">${i}</a>`;
        }
        html += '</div>';
      }
    } else { html += '<div class="card"><p style="color:#94a3b8">No access logs found.</p></div>'; }
    res.send(renderPage('Access Logs', html, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 10 — Emergency unlock
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/smart-door-lock/emergency', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const doors = await pool.query("SELECT * FROM smart_doors WHERE tenant_id=$1 ORDER BY name", [tid]);

    let html = SKIP + nav('Emergency');
    html += '<h2 style="margin-bottom:20px;color:#ef4444">Emergency Access Control</h2>';
    html += alertBox('Emergency unlock overrides all access schedules and restrictions. Use only in actual emergencies.', 'warning');

    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px">';
    html += `<div class="card" style="text-align:center;border:2px solid #ef4444">
      <div style="font-size:48px;margin-bottom:8px">🔓</div>
      <div style="font-size:20px;font-weight:700;color:#ef4444;margin-bottom:4px">Emergency Unlock All</div>
      <form method="POST" action="${navUrl('/emergency/unlock-all')}" style="margin-top:12px">
        <button class="btn" style="background:#ef4444;padding:12px 32px;font-size:16px" onclick="return confirm('EMERGENCY UNLOCK ALL DOORS?')">Unlock All Doors</button>
      </form>
    </div>`;
    html += `<div class="card" style="text-align:center;border:2px solid #22c55e">
      <div style="font-size:48px;margin-bottom:8px">🔒</div>
      <div style="font-size:20px;font-weight:700;color:#22c55e;margin-bottom:4px">Lock All Doors</div>
      <form method="POST" action="${navUrl('/emergency/lock-all')}" style="margin-top:12px">
        <button class="btn" style="background:#22c55e;padding:12px 32px;font-size:16px">Lock All Doors</button>
      </form>
    </div>`;
    html += '</div>';

    // Per-door emergency
    html += '<div class="card"><h3 style="margin-bottom:12px">Per-Door Emergency Control</h3>';
    if (doors.rows.length) {
      html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px">';
      doors.rows.forEach(d => {
        const color = d.status === 'locked' ? '#22c55e' : '#f59e0b';
        html += `<div style="border:1px solid ${color};border-radius:10px;padding:14px;background:#fafafa">
          <strong>${esc(d.name)}</strong>
          <div style="font-size:12px;color:${GRAY};margin:4px 0">${esc(d.location || '—')}</div>
          <form method="POST" action="${navUrl('/doors/' + d.id + '/toggle')}" style="display:inline">
            <button class="btn" style="padding:4px 12px;font-size:12px;background:${d.status === 'locked' ? '#f59e0b' : '#22c55e'}">${d.status === 'locked' ? '🔓 Unlock' : '🔒 Lock'}</button>
          </form>
        </div>`;
      });
      html += '</div>';
    } else { html += '<p style="color:#94a3b8">No doors configured.</p>'; }
    html += '</div>';

    res.send(renderPage('Emergency Access', html, req.session.user, req));
  }));

  app.post('/school/smart-door-lock/emergency/unlock-all', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const doors = await pool.query("SELECT id, status FROM smart_doors WHERE tenant_id=$1", [tid]);
    for (const d of doors.rows) {
      await pool.query("UPDATE smart_doors SET status='unlocked', updated_at=NOW() WHERE id=$1", [d.id]);
      await pool.query(
        "INSERT INTO door_access_logs (tenant_id, door_id, method, granted, user_id) VALUES ($1,$2,$3,$4,$5)",
        [tid, d.id, 'emergency_unlock', true, req.session.user.id]);
    }
    audit(req, 'emergency_unlock_all', { count: doors.rows.length });
    queueEmail(tid, 'Emergency Door Unlock', 'All doors have been unlocked by ' + req.session.user.name + '. This is an emergency action.');
    res.redirect(navUrl('/emergency'));
  }));

  app.post('/school/smart-door-lock/emergency/lock-all', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query("UPDATE smart_doors SET status='locked', updated_at=NOW() WHERE tenant_id=$1", [tid]);
    audit(req, 'emergency_lock_all');
    res.redirect(navUrl('/emergency'));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 11 — Maintenance tracking
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/smart-door-lock/maintenance', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const filter = req.query.status || '';
    let where = 'm.tenant_id=$1', params = [tid];
    if (filter) { where += ' AND m.status=$2'; params.push(filter); }

    const [tasks, doors] = await Promise.all([
      pool.query(
        `SELECT m.*, sd.name AS door_name FROM door_maintenance m
         JOIN smart_doors sd ON sd.id=m.door_id
         WHERE ${where} ORDER BY m.scheduled_date ASC NULLS LAST, m.created_at DESC`, params),
      pool.query("SELECT id, name FROM smart_doors WHERE tenant_id=$1 ORDER BY name", [tid]),
    ]);

    // Battery status for all doors
    const battDoors = await pool.query(
      "SELECT name, battery_level FROM smart_doors WHERE tenant_id=$1 ORDER BY battery_level ASC", [tid]);

    let html = SKIP + nav('Maintenance');
    html += '<h2 style="margin-bottom:20px">Lock Maintenance</h2>';

    // Battery overview
    html += '<div class="card"><h3 style="margin-bottom:12px">Battery Status</h3>';
    if (battDoors.rows.length) {
      html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px">';
      battDoors.rows.forEach(d => {
        const color = d.battery_level >= 60 ? '#22c55e' : d.battery_level >= 20 ? '#f59e0b' : '#ef4444';
        html += `<div style="border:1px solid #e5e7eb;border-radius:8px;padding:10px">
          <div style="display:flex;justify-content:space-between;margin-bottom:4px">
            <strong>${esc(d.name)}</strong>
            <span style="color:${color};font-weight:600">${d.battery_level}%</span>
          </div>
          <div style="background:#e5e7eb;border-radius:4px;height:8px">
            <div style="width:${d.battery_level}%;background:${color};height:8px;border-radius:4px"></div>
          </div>
        </div>`;
      });
      html += '</div>';
    }
    html += '</div>';

    // Maintenance tasks
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;margin-top:8px">';
    html += '<h3>Maintenance Tasks</h3>';
    html += `<a href="${navUrl('/maintenance/new')}" class="btn">+ Add Task</a></div>`;

    html += '<div style="display:flex;gap:6px;margin-bottom:16px">';
    [['', 'All'], ['pending', 'Pending'], ['in_progress', 'In Progress'], ['completed', 'Completed']].forEach(([v, l]) => {
      html += `<a href="${navUrl('/maintenance?status=' + v)}" style="padding:6px 14px;border-radius:8px;text-decoration:none;font-size:13px;` +
        (filter === v ? `background:${P};color:#fff` : `background:#f3f4f6;color:${GRAY}`) + `">${l}</a>`;
    });
    html += '</div>';

    if (tasks.rows.length) {
      const statusColors = { pending: '#f59e0b', in_progress: '#3b82f6', completed: '#22c55e' };
      html += '<table><tr><th>Type</th><th>Door</th><th>Description</th><th>Scheduled</th><th>Completed</th><th>Status</th><th>Actions</th></tr>';
      tasks.rows.forEach(t => {
        html += `<tr>
          <td><strong>${esc(t.maintenance_type)}</strong></td>
          <td>${esc(t.door_name)}</td>
          <td>${esc((t.description || '').substring(0, 60))}</td>
          <td>${fmtDate(t.scheduled_date)}</td>
          <td>${fmtDate(t.completed_date)}</td>
          <td>${badge((t.status || 'pending').replace('_', ' '), statusColors[t.status] || '#94a3b8')}</td>
          <td>
            ${t.status === 'pending' || t.status === 'in_progress'
              ? `<form method="POST" action="${navUrl('/maintenance/' + t.id + '/complete')}" style="display:inline">
                  <button class="btn" style="padding:4px 10px;font-size:12px;background:#22c55e">Complete</button></form>` : ''}
          </td></tr>`;
      });
      html += '</table>';
    } else { html += '<div class="card"><p style="color:#94a3b8">No maintenance tasks.</p></div>'; }
    res.send(renderPage('Lock Maintenance', html, req.session.user, req));
  }));

  app.get('/school/smart-door-lock/maintenance/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const doors = await pool.query("SELECT id, name FROM smart_doors WHERE tenant_id=$1 ORDER BY name", [tid]);
    let html = SKIP + nav('Maintenance');
    html += '<div class="card"><h2>Add Maintenance Task</h2>';
    html += `<form method="POST" action="${navUrl('/maintenance/create')}">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Door *</label>
          <select name="door_id" required><option value="">Select Door</option>
            ${doors.rows.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}
          </select></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Type *</label>
          <select name="maintenance_type" required>
            <option value="battery_replace">Battery Replacement</option>
            <option value="firmware_update">Firmware Update</option>
            <option value="mechanical_repair">Mechanical Repair</option>
            <option value="rekey">Re-key</option>
            <option value="calibration">Calibration</option>
            <option value="cleaning">Cleaning</option>
            <option value="inspection">Inspection</option>
          </select></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Scheduled Date</label>
          <input name="scheduled_date" type="date"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Technician</label>
          <input name="technician" placeholder="Technician name"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Cost ($)</label>
          <input name="cost" type="number" step="0.01" min="0" value="0"></div>
      </div>
      <div style="margin-top:12px"><label style="display:block;margin-bottom:4px;font-weight:600">Description</label>
        <textarea name="description" rows="3" placeholder="Describe the task..."></textarea></div>
      <div style="margin-top:16px"><button type="submit" class="btn">Create Task</button></div>
    </form></div>`;
    res.send(renderPage('Add Maintenance Task', html, req.session.user, req));
  }));

  app.post('/school/smart-door-lock/maintenance/create', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { door_id, maintenance_type, scheduled_date, technician, cost, description } = req.body;
    if (!door_id || !maintenance_type) return res.status(400).send('Door and type are required.');
    await pool.query(
      `INSERT INTO door_maintenance (tenant_id, door_id, maintenance_type, scheduled_date, technician, cost, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [tid, parseInt(door_id), maintenance_type, scheduled_date || null,
       technician || null, parseFloat(cost) || 0, description || null]);
    audit(req, 'door_maintenance_created', { door_id, type: maintenance_type });
    res.redirect(navUrl('/maintenance'));
  }));

  app.post('/school/smart-door-lock/maintenance/:id/complete', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query(
      "UPDATE door_maintenance SET status='completed', completed_date=CURRENT_DATE WHERE id=$1 AND tenant_id=$2",
      [req.params.id, tid]);
    audit(req, 'door_maintenance_completed', { task_id: req.params.id });
    res.redirect(req.headers.referer || navUrl('/maintenance'));
  }));
};
