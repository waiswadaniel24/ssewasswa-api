/**
 * Smart Security Management Module
 * Multi-tenant SaaS platform (schools)
 *
 * Features: Camera management, access control logs, incident management,
 *   visitor tracking, zone security levels, alert rules, security patrol
 *   scheduling, incident response protocols, security reports, gate-pass integration
 * 12 routes · PostgreSQL · tenant_id scoped
 */
module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5', GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.btn:hover{background:#3730a3}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}</style>';

  // ── Helpers ────────────────────────────────────────────────────────────────
  function navUrl(a) { return '/school/smart-security' + a; }
  function fmtDate(d) { return d ? new Date(d).toISOString().split('T')[0] : '—'; }
  function fmtTime(d) { return d ? new Date(d).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '—'; }
  function badge(label, color) { return `<span style="background:${color};color:#fff;padding:2px 10px;border-radius:12px;font-size:12px">${esc(label)}</span>`; }
  function fmtMoney(v) { return '$' + parseFloat(v || 0).toFixed(2); }

  function nav(active) {
    const links = [
      ['Dashboard', ''], ['Cameras', '/cameras'], ['Incidents', '/incidents'],
      ['Zones', '/zones'], ['Visitors', '/visitors'], ['Patrols', '/patrols'],
      ['Alerts', '/alerts'], ['Reports', '/reports'],
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
        CREATE TABLE IF NOT EXISTS security_cameras (
          id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          name VARCHAR(100) NOT NULL, location VARCHAR(255), type VARCHAR(50) DEFAULT 'fixed',
          status VARCHAR(20) DEFAULT 'online', recording_enabled BOOLEAN DEFAULT true,
          storage_days INT DEFAULT 30, ip_address VARCHAR(45), model VARCHAR(100),
          resolution VARCHAR(20) DEFAULT '1080p', night_vision BOOLEAN DEFAULT false,
          ptz_capable BOOLEAN DEFAULT false, last_activity TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS security_incidents (
          id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          type VARCHAR(50) NOT NULL, severity VARCHAR(20) DEFAULT 'medium',
          description TEXT, location VARCHAR(255), reported_by INTEGER,
          assigned_to INTEGER, status VARCHAR(20) DEFAULT 'open',
          resolution TEXT, evidence_notes TEXT, camera_ids INTEGER[],
          created_at TIMESTAMPTZ DEFAULT NOW(), resolved_at TIMESTAMPTZ
        );
        CREATE TABLE IF NOT EXISTS security_zones (
          id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          name VARCHAR(100) NOT NULL, level VARCHAR(20) DEFAULT 'medium',
          access_rules JSONB DEFAULT '{}', cameras JSONB DEFAULT '[]',
          description TEXT, patrol_frequency VARCHAR(50) DEFAULT 'hourly',
          is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS security_patrols (
          id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          zone_id INTEGER REFERENCES security_zones(id) ON DELETE SET NULL,
          guard_name VARCHAR(100), patrol_date DATE NOT NULL,
          start_time TIME, end_time TIME, checkpoints INTEGER DEFAULT 0,
          incidents_found INT DEFAULT 0, notes TEXT, status VARCHAR(20) DEFAULT 'scheduled',
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS security_visitor_logs (
          id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          visitor_name VARCHAR(200) NOT NULL, visitor_id_type VARCHAR(50),
          visitor_id_number VARCHAR(100), purpose VARCHAR(255),
          person_visiting VARCHAR(200), zone_accessed VARCHAR(100),
          check_in TIMESTAMPTZ DEFAULT NOW(), check_out TIMESTAMPTZ,
          gate_pass_id INTEGER, status VARCHAR(20) DEFAULT 'checked_in',
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS security_alert_rules (
          id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          name VARCHAR(100) NOT NULL, description TEXT, trigger_type VARCHAR(50),
          severity VARCHAR(20) DEFAULT 'medium', zone_ids INTEGER[],
          is_active BOOLEAN DEFAULT true, notify_email BOOLEAN DEFAULT true,
          notify_sms BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      const idxs = [
        'CREATE INDEX IF NOT EXISTS idx_sc_tenant ON security_cameras(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_sc_status ON security_cameras(status)',
        'CREATE INDEX IF NOT EXISTS idx_si_tenant ON security_incidents(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_si_status ON security_incidents(status)',
        'CREATE INDEX IF NOT EXISTS idx_si_severity ON security_incidents(severity)',
        'CREATE INDEX IF NOT EXISTS idx_sz_tenant ON security_zones(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_sz_level ON security_zones(level)',
        'CREATE INDEX IF NOT EXISTS idx_sp_tenant ON security_patrols(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_sp_date ON security_patrols(patron_date)',
        'CREATE INDEX IF NOT EXISTS idx_svl_tenant ON security_visitor_logs(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_svl_status ON security_visitor_logs(status)',
        'CREATE INDEX IF NOT EXISTS idx_sar_tenant ON security_alert_rules(tenant_id)',
      ];
      for (const sql of idxs) { try { await pool.query(sql); } catch (_) {} }
      console.log('[SmartSecurity] Tables ready');
    } catch (e) { console.warn('[SmartSecurity] Migration warning:', e.message); }
  })();

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 1 — Dashboard
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/smart-security', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [totalCams, onlineCams, openIncidents, activeZones] = await Promise.all([
      pool.query("SELECT COUNT(*)::int AS c FROM security_cameras WHERE tenant_id=$1", [tid]),
      pool.query("SELECT COUNT(*)::int AS c FROM security_cameras WHERE tenant_id=$1 AND status='online'", [tid]),
      pool.query("SELECT COUNT(*)::int AS c FROM security_incidents WHERE tenant_id=$1 AND status='open'", [tid]),
      pool.query("SELECT COUNT(*)::int AS c FROM security_zones WHERE tenant_id=$1 AND is_active=true", [tid]),
    ]);
    const todayVisitors = await pool.query(
      "SELECT COUNT(*)::int AS c FROM security_visitor_logs WHERE tenant_id=$1 AND check_in >= CURRENT_DATE", [tid]);
    const activeVisitors = await pool.query(
      "SELECT COUNT(*)::int AS c FROM security_visitor_logs WHERE tenant_id=$1 AND status='checked_in'", [tid]);
    const criticalIncidents = await pool.query(
      "SELECT COUNT(*)::int AS c FROM security_incidents WHERE tenant_id=$1 AND status='open' AND severity='critical'", [tid]);
    const todayPatrols = await pool.query(
      "SELECT COUNT(*)::int AS c FROM security_patrols WHERE tenant_id=$1 AND patrol_date=CURRENT_DATE", [tid]);

    let html = SKIP + nav('Dashboard');
    html += '<h2 style="margin-bottom:20px">Smart Security Dashboard</h2>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:16px;margin-bottom:24px">';
    html += `<div class="card" style="text-align:center"><div style="font-size:28px;font-weight:700;color:${P}">${totalCams.rows[0].c}</div><div style="color:${GRAY};font-size:13px">Total Cameras</div></div>`;
    html += `<div class="card" style="text-align:center"><div style="font-size:28px;font-weight:700;color:#22c55e">${onlineCams.rows[0].c}</div><div style="color:${GRAY};font-size:13px">Online Cameras</div></div>`;
    html += `<div class="card" style="text-align:center"><div style="font-size:28px;font-weight:700;color:#ef4444">${openIncidents.rows[0].c}</div><div style="color:${GRAY};font-size:13px">Open Incidents</div></div>`;
    html += `<div class="card" style="text-align:center"><div style="font-size:28px;font-weight:700;color:#dc2626">${criticalIncidents.rows[0].c}</div><div style="color:${GRAY};font-size:13px">Critical</div></div>`;
    html += `<div class="card" style="text-align:center"><div style="font-size:28px;font-weight:700;color:#3b82f6">${activeZones.rows[0].c}</div><div style="color:${GRAY};font-size:13px">Security Zones</div></div>`;
    html += `<div class="card" style="text-align:center"><div style="font-size:28px;font-weight:700;color:#8b5cf6">${todayVisitors.rows[0].c}</div><div style="color:${GRAY};font-size:13px">Today Visitors</div></div>`;
    html += `<div class="card" style="text-align:center"><div style="font-size:28px;font-weight:700;color:#f59e0b">${activeVisitors.rows[0].c}</div><div style="color:${GRAY};font-size:13px">Active On Site</div></div>`;
    html += `<div class="card" style="text-align:center"><div style="font-size:28px;font-weight:700;color:#06b6d4">${todayPatrols.rows[0].c}</div><div style="color:${GRAY};font-size:13px">Today Patrols</div></div>`;
    html += '</div>';

    if (criticalIncidents.rows[0].c > 0) {
      html += `<div style="background:#fee2e2;border:1px solid #ef4444;border-radius:8px;padding:12px 16px;margin-bottom:16px;color:#991b1b">
        <strong>⚠ ${criticalIncidents.rows[0].c} CRITICAL Incident(s) require immediate attention!</strong></div>`;
    }

    // Camera overview
    const cameras = await pool.query("SELECT * FROM security_cameras WHERE tenant_id=$1 ORDER BY name", [tid]);
    if (cameras.rows.length) {
      html += '<div class="card"><h3 style="margin-bottom:12px">Camera Status</h3>';
      html += '<div style="display:flex;gap:10px;flex-wrap:wrap">';
      cameras.rows.forEach(c => {
        const color = c.status === 'online' ? '#22c55e' : c.status === 'offline' ? '#ef4444' : '#f59e0b';
        html += `<div style="border:1px solid ${color};border-radius:10px;padding:10px;min-width:160px;background:#fafafa">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
            <span style="width:10px;height:10px;border-radius:50%;background:${color}"></span>
            <strong>${esc(c.name)}</strong>
          </div>
          <div style="font-size:12px;color:${GRAY}">${esc(c.location || '—')}</div>
          <div style="font-size:11px;color:${GRAY}">${c.recording_enabled ? '🔴 REC' : '⏹ STOP'} | ${esc(c.type)}</div>
        </div>`;
      });
      html += '</div></div>';
    }

    // Recent incidents
    const recentIncidents = await pool.query(
      "SELECT * FROM security_incidents WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 5", [tid]);
    if (recentIncidents.rows.length) {
      html += '<div class="card"><h3 style="margin-bottom:12px">Recent Incidents</h3>';
      const sevColors = { critical: '#dc2626', high: '#ef4444', medium: '#f59e0b', low: '#3b82f6' };
      html += '<table><tr><th>Type</th><th>Severity</th><th>Location</th><th>Status</th><th>Time</th></tr>';
      recentIncidents.rows.forEach(i => {
        html += `<tr><td><strong>${esc(i.type)}</strong></td>
          <td>${badge(i.severity, sevColors[i.severity] || '#94a3b8')}</td>
          <td>${esc(i.location || '—')}</td>
          <td>${badge(i.status, i.status === 'open' ? '#f59e0b' : i.status === 'resolved' ? '#22c55e' : '#3b82f6')}</td>
          <td>${fmtTime(i.created_at)}</td></tr>`;
      });
      html += '</table></div>';
    }

    // Active visitors
    const activeVis = await pool.query(
      "SELECT * FROM security_visitor_logs WHERE tenant_id=$1 AND status='checked_in' ORDER BY check_in DESC LIMIT 5", [tid]);
    if (activeVis.rows.length) {
      html += '<div class="card"><h3 style="margin-bottom:12px">Visitors Currently On Site</h3>';
      html += '<table><tr><th>Name</th><th>ID Type</th><th>Purpose</th><th>Visiting</th><th>Checked In</th></tr>';
      activeVis.rows.forEach(v => {
        html += `<tr><td><strong>${esc(v.visitor_name)}</strong></td>
          <td>${esc(v.visitor_id_type || '—')}</td><td>${esc(v.purpose || '—')}</td>
          <td>${esc(v.person_visiting || '—')}</td><td>${fmtTime(v.check_in)}</td></tr>`;
      });
      html += '</table></div>';
    }

    res.send(renderPage('Smart Security Dashboard', html, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 2 — Cameras list
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/smart-security/cameras', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const cameras = await pool.query("SELECT * FROM security_cameras WHERE tenant_id=$1 ORDER BY name", [tid]);

    let html = SKIP + nav('Cameras');
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">';
    html += '<h2>Security Cameras</h2>';
    html += `<a href="${navUrl('/cameras/new')}" class="btn">+ Add Camera</a></div>`;

    if (cameras.rows.length) {
      html += '<table><tr><th>Name</th><th>Location</th><th>Type</th><th>Status</th><th>Recording</th><th>Resolution</th><th>Night Vision</th><th>PTZ</th><th>Storage</th><th>Actions</th></tr>';
      cameras.rows.forEach(c => {
        const statusColor = c.status === 'online' ? '#22c55e' : c.status === 'offline' ? '#ef4444' : '#f59e0b';
        html += `<tr>
          <td><strong>${esc(c.name)}</strong></td>
          <td>${esc(c.location || '—')}</td>
          <td>${badge(c.type, '#e0e7ff')}</td>
          <td><span style="display:inline-flex;align-items:center;gap:6px"><span style="width:10px;height:10px;border-radius:50%;background:${statusColor}"></span>${esc(c.status)}</span></td>
          <td>${c.recording_enabled ? '🔴 Yes' : '⏹ No'}</td>
          <td>${esc(c.resolution)}</td>
          <td>${c.night_vision ? '✅' : '❌'}</td>
          <td>${c.ptz_capable ? '✅' : '❌'}</td>
          <td>${c.storage_days} days</td>
          <td>
            <a href="${navUrl('/cameras/' + c.id + '/edit')}" class="btn" style="padding:4px 10px;font-size:12px;background:#0ea5e9">Edit</a>
            <form method="POST" action="${navUrl('/cameras/' + c.id + '/toggle-recording')}" style="display:inline">
              <button class="btn" style="padding:4px 10px;font-size:12px;background:${c.recording_enabled ? '#ef4444' : '#22c55e'}">${c.recording_enabled ? 'Stop Rec' : 'Start Rec'}</button>
            </form>
          </td></tr>`;
      });
      html += '</table>';
    } else { html += '<div class="card"><p style="color:#94a3b8">No cameras registered yet.</p></div>'; }
    res.send(renderPage('Security Cameras', html, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 3 — New camera + save
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/smart-security/cameras/new', requireAuth, requireNotBanned, (req, res) => {
    let html = SKIP + nav('Cameras');
    html += '<div class="card"><h2>Register New Camera</h2>';
    html += `<form method="POST" action="${navUrl('/cameras/create')}">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Camera Name *</label>
          <input name="name" required placeholder="e.g. Front Gate Cam"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Location *</label>
          <input name="location" required placeholder="e.g. Main Entrance"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Type</label>
          <select name="type">
            <option value="fixed">Fixed</option><option value="ptz">PTZ (Pan-Tilt-Zoom)</option>
            <option value="dome">Dome</option><option value="bullet">Bullet</option>
            <option value="thermal">Thermal</option><option value="360">360° Fisheye</option>
          </select></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Status</label>
          <select name="status"><option value="online">Online</option><option value="offline">Offline</option><option value="maintenance">Maintenance</option></select></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Model</label>
          <input name="model" placeholder="e.g. Hikvision DS-2CD2143"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">IP Address</label>
          <input name="ip_address" placeholder="e.g. 192.168.1.50"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Resolution</label>
          <select name="resolution"><option value="720p">720p HD</option><option value="1080p">1080p Full HD</option><option value="4k">4K Ultra HD</option></select></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Storage Retention (days)</label>
          <input name="storage_days" type="number" min="1" max="365" value="30"></div>
      </div>
      <div style="margin-top:16px;display:flex;gap:16px">
        <label><input type="checkbox" name="recording_enabled" checked> Recording Enabled</label>
        <label><input type="checkbox" name="night_vision"> Night Vision</label>
        <label><input type="checkbox" name="ptz_capable"> PTZ Capable</label>
      </div>
      <div style="margin-top:16px"><button type="submit" class="btn">Register Camera</button></div>
    </form></div>`;
    res.send(renderPage('Add Camera', html, req.session.user, req));
  });

  app.post('/school/smart-security/cameras/create', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { name, location, type, status, model, ip_address, resolution, storage_days, recording_enabled, night_vision, ptz_capable } = req.body;
    if (!name || !name.trim()) return res.status(400).send('Camera name is required.');
    await pool.query(
      `INSERT INTO security_cameras (tenant_id, name, location, type, status, model, ip_address, resolution, storage_days, recording_enabled, night_vision, ptz_capable)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [tid, name.trim(), location || null, type || 'fixed', status || 'online',
       model || null, ip_address || null, resolution || '1080p', parseInt(storage_days) || 30,
       recording_enabled === 'on', night_vision === 'on', ptz_capable === 'on']);
    audit(req, 'security_camera_created', { name: name.trim() });
    res.redirect(navUrl('/cameras'));
  }));

  app.get('/school/smart-security/cameras/:id/edit', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const cam = await pool.query("SELECT * FROM security_cameras WHERE id=$1 AND tenant_id=$2", [req.params.id, tid]);
    if (!cam.rows.length) return res.status(404).send('Camera not found.');
    const c = cam.rows[0];
    let html = SKIP + nav('Cameras');
    html += `<div class="card"><h2>Edit Camera: ${esc(c.name)}</h2>`;
    html += `<form method="POST" action="${navUrl('/cameras/' + c.id + '/update')}">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Name *</label>
          <input name="name" value="${esc(c.name)}" required></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Location</label>
          <input name="location" value="${esc(c.location || '')}"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Type</label>
          <select name="type">${['fixed','ptz','dome','bullet','thermal','360'].map(t => `<option value="${t}" ${c.type === t ? 'selected' : ''}>${t.toUpperCase()}</option>`).join('')}</select></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Status</label>
          <select name="status">${['online','offline','maintenance'].map(s => `<option value="${s}" ${c.status === s ? 'selected' : ''}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`).join('')}</select></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Model</label>
          <input name="model" value="${esc(c.model || '')}"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">IP Address</label>
          <input name="ip_address" value="${esc(c.ip_address || '')}"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Resolution</label>
          <select name="resolution">${['720p','1080p','4k'].map(r => `<option value="${r}" ${c.resolution === r ? 'selected' : ''}>${r}</option>`).join('')}</select></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Storage (days)</label>
          <input name="storage_days" type="number" value="${c.storage_days}"></div>
      </div>
      <div style="margin-top:16px;display:flex;gap:16px">
        <label><input type="checkbox" name="recording_enabled" ${c.recording_enabled ? 'checked' : ''}> Recording</label>
        <label><input type="checkbox" name="night_vision" ${c.night_vision ? 'checked' : ''}> Night Vision</label>
        <label><input type="checkbox" name="ptz_capable" ${c.ptz_capable ? 'checked' : ''}> PTZ</label>
      </div>
      <div style="margin-top:16px"><button type="submit" class="btn">Save Changes</button></div>
    </form></div>`;
    res.send(renderPage('Edit Camera', html, req.session.user, req));
  }));

  app.post('/school/smart-security/cameras/:id/update', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { id } = req.params;
    const { name, location, type, status, model, ip_address, resolution, storage_days, recording_enabled, night_vision, ptz_capable } = req.body;
    await pool.query(
      `UPDATE security_cameras SET name=$1,location=$2,type=$3,status=$4,model=$5,ip_address=$6,
       resolution=$7,storage_days=$8,recording_enabled=$9,night_vision=$10,ptz_capable=$11,last_activity=NOW()
       WHERE id=$12 AND tenant_id=$13`,
      [name.trim(), location || null, type || 'fixed', status || 'online', model || null, ip_address || null,
       resolution || '1080p', parseInt(storage_days) || 30, recording_enabled === 'on', night_vision === 'on', ptz_capable === 'on', id, tid]);
    res.redirect(navUrl('/cameras'));
  }));

  app.post('/school/smart-security/cameras/:id/toggle-recording', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query("UPDATE security_cameras SET recording_enabled=NOT recording_enabled, last_activity=NOW() WHERE id=$1 AND tenant_id=$2", [req.params.id, tid]);
    audit(req, 'camera_recording_toggled', { camera_id: req.params.id });
    res.redirect(req.headers.referer || navUrl('/cameras'));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 4 — Incidents management
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/smart-security/incidents', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const filter = req.query.status || '';
    let where = 'i.tenant_id=$1', params = [tid];
    if (filter) { where += ' AND i.status=$2'; params.push(filter); }

    const incidents = await pool.query(
      `SELECT i.* FROM security_incidents i WHERE ${where} ORDER BY i.created_at DESC`, params);

    let html = SKIP + nav('Incidents');
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">';
    html += '<h2>Incident Management</h2>';
    html += `<a href="${navUrl('/incidents/new')}" class="btn">+ Report Incident</a></div>`;

    html += '<div style="display:flex;gap:6px;margin-bottom:16px">';
    [['', 'All'], ['open', 'Open'], ['investigating', 'Investigating'], ['resolved', 'Resolved'], ['closed', 'Closed']].forEach(([v, l]) => {
      html += `<a href="${navUrl('/incidents?status=' + v)}" style="padding:6px 14px;border-radius:8px;text-decoration:none;font-size:13px;` +
        (filter === v ? `background:${P};color:#fff` : `background:#f3f4f6;color:${GRAY}`) + `">${l}</a>`;
    });
    html += '</div>';

    if (incidents.rows.length) {
      const sevColors = { critical: '#dc2626', high: '#ef4444', medium: '#f59e0b', low: '#3b82f6' };
      const statusColors = { open: '#f59e0b', investigating: '#3b82f6', resolved: '#22c55e', closed: '#94a3b8' };
      html += '<table><tr><th>ID</th><th>Type</th><th>Severity</th><th>Location</th><th>Description</th><th>Status</th><th>Created</th><th>Actions</th></tr>';
      incidents.rows.forEach(i => {
        html += `<tr style="${i.severity === 'critical' ? 'background:#fef2f2' : ''}">
          <td>#${i.id}</td>
          <td><strong>${esc(i.type)}</strong></td>
          <td>${badge(i.severity, sevColors[i.severity] || '#94a3b8')}</td>
          <td>${esc(i.location || '—')}</td>
          <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(i.description || '—')}</td>
          <td>${badge(i.status, statusColors[i.status] || '#94a3b8')}</td>
          <td>${fmtTime(i.created_at)}</td>
          <td>
            <a href="${navUrl('/incidents/' + i.id + '/edit')}" class="btn" style="padding:4px 10px;font-size:12px;background:#0ea5e9">Edit</a>
            ${i.status !== 'resolved' && i.status !== 'closed'
              ? `<a href="${navUrl('/incidents/' + i.id + '/resolve')}" class="btn" style="padding:4px 10px;font-size:12px;background:#22c55e">Resolve</a>` : ''}
          </td></tr>`;
      });
      html += '</table>';
    } else { html += '<div class="card"><p style="color:#94a3b8">No incidents reported.</p></div>'; }
    res.send(renderPage('Security Incidents', html, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 5 — New incident form + save
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/smart-security/incidents/new', requireAuth, requireNotBanned, (req, res) => {
    let html = SKIP + nav('Incidents');
    html += '<div class="card"><h2>Report New Incident</h2>';
    html += `<form method="POST" action="${navUrl('/incidents/create')}">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Incident Type *</label>
          <select name="type" required>
            <option value="unauthorized_access">Unauthorized Access</option>
            <option value="theft">Theft</option>
            <option value="vandalism">Vandalism</option>
            <option value="altercation">Altercation/Fight</option>
            <option value="fire">Fire</option>
            <option value="medical">Medical Emergency</option>
            <option value="suspicious_activity">Suspicious Activity</option>
            <option value="tailgating">Tailgating</option>
            <option value="equipment_failure">Equipment Failure</option>
            <option value="other">Other</option>
          </select></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Severity *</label>
          <select name="severity" required>
            <option value="low">Low</option><option value="medium" selected>Medium</option>
            <option value="high">High</option><option value="critical">Critical</option>
          </select></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Location *</label>
          <input name="location" required placeholder="e.g. Building A, 2nd Floor"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Assigned To</label>
          <input name="assigned_to" type="number" placeholder="Staff ID"></div>
      </div>
      <div style="margin-top:12px"><label style="display:block;margin-bottom:4px;font-weight:600">Description *</label>
        <textarea name="description" rows="4" required placeholder="Describe the incident in detail..."></textarea></div>
      <div style="margin-top:12px"><label style="display:block;margin-bottom:4px;font-weight:600">Evidence Notes</label>
        <textarea name="evidence_notes" rows="2" placeholder="Camera footage references, witness names, etc."></textarea></div>
      <div style="margin-top:16px"><button type="submit" class="btn">Submit Incident Report</button></div>
    </form></div>`;
    res.send(renderPage('Report Incident', html, req.session.user, req));
  });

  app.post('/school/smart-security/incidents/create', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { type, severity, location, assigned_to, description, evidence_notes } = req.body;
    if (!type || !severity || !location) return res.status(400).send('Type, severity, and location are required.');
    const result = await pool.query(
      `INSERT INTO security_incidents (tenant_id, type, severity, location, reported_by, assigned_to, description, evidence_notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [tid, type, severity, location, req.session.user.id, assigned_to ? parseInt(assigned_to) : null, description || null, evidence_notes || null]);
    audit(req, 'security_incident_reported', { incident_id: result.rows[0].id, type, severity });
    if (severity === 'critical' || severity === 'high') {
      queueEmail(tid, `Security Alert: ${severity.toUpperCase()} - ${type}`, `A ${severity} incident has been reported at ${location}. ${description || ''}`);
    }
    res.redirect(navUrl('/incidents'));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 6 — Resolve incident
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/smart-security/incidents/:id/resolve', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const inc = await pool.query("SELECT * FROM security_incidents WHERE id=$1 AND tenant_id=$2", [req.params.id, tid]);
    if (!inc.rows.length) return res.status(404).send('Incident not found.');
    const i = inc.rows[0];
    let html = SKIP + nav('Incidents');
    html += `<div class="card"><h2>Resolve Incident #${i.id}</h2>
      <div style="padding:12px;background:#f9fafb;border-radius:8px;margin-bottom:16px">
        <div><strong>Type:</strong> ${esc(i.type)}</div>
        <div><strong>Severity:</strong> ${esc(i.severity)}</div>
        <div><strong>Location:</strong> ${esc(i.location)}</div>
        <div><strong>Description:</strong> ${esc(i.description || '—')}</div>
      </div>
      <form method="POST" action="${navUrl('/incidents/' + i.id + '/resolve')}">
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Resolution *</label>
          <textarea name="resolution" rows="4" required placeholder="Describe how the incident was resolved..."></textarea></div>
        <div style="margin-top:16px"><button type="submit" class="btn" style="background:#22c55e">Mark Resolved</button></div>
      </form></div>`;
    res.send(renderPage('Resolve Incident', html, req.session.user, req));
  }));

  app.post('/school/smart-security/incidents/:id/resolve', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { id } = req.params;
    const { resolution } = req.body;
    await pool.query(
      "UPDATE security_incidents SET status='resolved', resolution=$1, resolved_at=NOW() WHERE id=$2 AND tenant_id=$3",
      [resolution || null, id, tid]);
    audit(req, 'security_incident_resolved', { incident_id: id });
    res.redirect(navUrl('/incidents'));
  }));

  app.get('/school/smart-security/incidents/:id/edit', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const inc = await pool.query("SELECT * FROM security_incidents WHERE id=$1 AND tenant_id=$2", [req.params.id, tid]);
    if (!inc.rows.length) return res.status(404).send('Incident not found.');
    const i = inc.rows[0];
    let html = SKIP + nav('Incidents');
    html += `<div class="card"><h2>Edit Incident #${i.id}</h2>
      <form method="POST" action="${navUrl('/incidents/' + i.id + '/update')}">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div><label style="display:block;margin-bottom:4px;font-weight:600">Type</label>
            <select name="type">${['unauthorized_access','theft','vandalism','altercation','fire','medical','suspicious_activity','tailgating','equipment_failure','other']
              .map(t => `<option value="${t}" ${i.type === t ? 'selected' : ''}>${t.replace(/_/g,' ').replace(/\b\w/g,l=>l.toUpperCase())}</option>`).join('')}
            </select></div>
          <div><label style="display:block;margin-bottom:4px;font-weight:600">Severity</label>
            <select name="severity">${['low','medium','high','critical'].map(s => `<option value="${s}" ${i.severity === s ? 'selected' : ''}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`).join('')}
            </select></div>
          <div><label style="display:block;margin-bottom:4px;font-weight:600">Status</label>
            <select name="status">${['open','investigating','resolved','closed'].map(s => `<option value="${s}" ${i.status === s ? 'selected' : ''}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`).join('')}
            </select></div>
          <div><label style="display:block;margin-bottom:4px;font-weight:600">Location</label>
            <input name="location" value="${esc(i.location || '')}"></div>
        </div>
        <div style="margin-top:12px"><label style="display:block;margin-bottom:4px;font-weight:600">Description</label>
          <textarea name="description" rows="3">${esc(i.description || '')}</textarea></div>
        <div style="margin-top:12px"><label style="display:block;margin-bottom:4px;font-weight:600">Resolution</label>
          <textarea name="resolution" rows="3">${esc(i.resolution || '')}</textarea></div>
        <div style="margin-top:16px"><button type="submit" class="btn">Save Changes</button></div>
      </form></div>`;
    res.send(renderPage('Edit Incident', html, req.session.user, req));
  }));

  app.post('/school/smart-security/incidents/:id/update', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { id } = req.params;
    const { type, severity, status, location, description, resolution } = req.body;
    await pool.query(
      `UPDATE security_incidents SET type=$1, severity=$2, status=$3, location=$4, description=$5, resolution=$6,
       resolved_at=CASE WHEN $3 IN ('resolved','closed') AND resolved_at IS NULL THEN NOW() ELSE resolved_at END
       WHERE id=$7 AND tenant_id=$8`,
      [type, severity, status || 'open', location, description, resolution, id, tid]);
    res.redirect(navUrl('/incidents'));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 7 — Security zones
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/smart-security/zones', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const zones = await pool.query("SELECT * FROM security_zones WHERE tenant_id=$1 ORDER BY name", [tid]);
    const levelColors = { high: '#ef4444', medium: '#f59e0b', low: '#22c55e', restricted: '#dc2626', public: '#3b82f6' };

    let html = SKIP + nav('Zones');
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">';
    html += '<h2>Security Zones</h2>';
    html += `<a href="${navUrl('/zones/new')}" class="btn">+ Add Zone</a></div>`;

    if (zones.rows.length) {
      html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px">';
      zones.rows.forEach(z => {
        html += `<div class="card" style="border-left:4px solid ${levelColors[z.level] || '#94a3b8'}">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <h3 style="margin:0">${esc(z.name)}</h3>
            ${badge(z.level, levelColors[z.level] || '#94a3b8')}
          </div>
          <div style="font-size:13px;color:${GRAY};margin-bottom:8px">${esc(z.description || 'No description')}</div>
          <div style="font-size:13px;margin-bottom:4px"><strong>Patrol Frequency:</strong> ${esc(z.patrol_frequency)}</div>
          <div style="font-size:13px;margin-bottom:12px"><strong>Status:</strong> ${z.is_active ? badge('Active', '#22c55e') : badge('Inactive', '#94a3b8')}</div>
          <div style="display:flex;gap:6px">
            <a href="${navUrl('/zones/' + z.id + '/edit')}" class="btn" style="padding:4px 12px;font-size:12px;background:#0ea5e9">Edit</a>
          </div>
        </div>`;
      });
      html += '</div>';
    } else { html += '<div class="card"><p style="color:#94a3b8">No security zones configured.</p></div>'; }
    res.send(renderPage('Security Zones', html, req.session.user, req));
  }));

  app.get('/school/smart-security/zones/new', requireAuth, requireNotBanned, (req, res) => {
    let html = SKIP + nav('Zones');
    html += '<div class="card"><h2>Add Security Zone</h2>';
    html += `<form method="POST" action="${navUrl('/zones/create')}">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Zone Name *</label>
          <input name="name" required placeholder="e.g. Server Room"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Security Level *</label>
          <select name="level" required>
            <option value="public">Public</option><option value="low">Low</option>
            <option value="medium" selected>Medium</option><option value="high">High</option>
            <option value="restricted">Restricted</option>
          </select></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Patrol Frequency</label>
          <select name="patrol_frequency">
            <option value="continuous">Continuous</option><option value="hourly">Hourly</option>
            <option value="every_2h">Every 2 Hours</option><option value="every_4h">Every 4 Hours</option>
            <option value="daily">Daily</option><option value="weekly">Weekly</option>
            <option value="as_needed">As Needed</option>
          </select></div>
      </div>
      <div style="margin-top:12px"><label style="display:block;margin-bottom:4px;font-weight:600">Description</label>
        <textarea name="description" rows="2" placeholder="Zone description..."></textarea></div>
      <div style="margin-top:16px"><label><input type="checkbox" name="is_active" checked> Active</label></div>
      <div style="margin-top:16px"><button type="submit" class="btn">Create Zone</button></div>
    </form></div>`;
    res.send(renderPage('Add Security Zone', html, req.session.user, req));
  });

  app.post('/school/smart-security/zones/create', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { name, level, description, patrol_frequency, is_active } = req.body;
    if (!name || !name.trim()) return res.status(400).send('Zone name is required.');
    await pool.query(
      "INSERT INTO security_zones (tenant_id, name, level, description, patrol_frequency, is_active) VALUES ($1,$2,$3,$4,$5,$6)",
      [tid, name.trim(), level || 'medium', description || null, patrol_frequency || 'hourly', is_active === 'on']);
    audit(req, 'security_zone_created', { name: name.trim() });
    res.redirect(navUrl('/zones'));
  }));

  app.get('/school/smart-security/zones/:id/edit', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const zone = await pool.query("SELECT * FROM security_zones WHERE id=$1 AND tenant_id=$2", [req.params.id, tid]);
    if (!zone.rows.length) return res.status(404).send('Zone not found.');
    const z = zone.rows[0];
    let html = SKIP + nav('Zones');
    html += `<div class="card"><h2>Edit Zone: ${esc(z.name)}</h2>
      <form method="POST" action="${navUrl('/zones/' + z.id + '/update')}">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div><label style="display:block;margin-bottom:4px;font-weight:600">Name</label>
            <input name="name" value="${esc(z.name)}" required></div>
          <div><label style="display:block;margin-bottom:4px;font-weight:600">Level</label>
            <select name="level">${['public','low','medium','high','restricted'].map(l => `<option value="${l}" ${z.level === l ? 'selected' : ''}>${l.charAt(0).toUpperCase() + l.slice(1)}</option>`).join('')}
            </select></div>
          <div><label style="display:block;margin-bottom:4px;font-weight:600">Patrol Frequency</label>
            <select name="patrol_frequency">${['continuous','hourly','every_2h','every_4h','daily','weekly','as_needed'].map(f => `<option value="${f}" ${z.patrol_frequency === f ? 'selected' : ''}>${f.replace(/_/g,' ')}</option>`).join('')}
            </select></div>
        </div>
        <div style="margin-top:12px"><label style="display:block;margin-bottom:4px;font-weight:600">Description</label>
          <textarea name="description" rows="2">${esc(z.description || '')}</textarea></div>
        <div style="margin-top:12px"><label><input type="checkbox" name="is_active" ${z.is_active ? 'checked' : ''}> Active</label></div>
        <div style="margin-top:16px"><button type="submit" class="btn">Save</button></div>
      </form></div>`;
    res.send(renderPage('Edit Security Zone', html, req.session.user, req));
  }));

  app.post('/school/smart-security/zones/:id/update', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { id } = req.params;
    const { name, level, description, patrol_frequency, is_active } = req.body;
    await pool.query(
      "UPDATE security_zones SET name=$1, level=$2, description=$3, patrol_frequency=$4, is_active=$5 WHERE id=$6 AND tenant_id=$7",
      [name.trim(), level || 'medium', description || null, patrol_frequency || 'hourly', is_active === 'on', id, tid]);
    res.redirect(navUrl('/zones'));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 8 — Visitor management
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/smart-security/visitors', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const visitors = await pool.query(
      "SELECT * FROM security_visitor_logs WHERE tenant_id=$1 ORDER BY check_in DESC LIMIT 50", [tid]);

    let html = SKIP + nav('Visitors');
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">';
    html += '<h2>Visitor Management</h2>';
    html += `<a href="${navUrl('/visitors/checkin')}" class="btn">+ Check In Visitor</a></div>`;

    if (visitors.rows.length) {
      html += '<table><tr><th>Name</th><th>ID Type</th><th>ID Number</th><th>Purpose</th><th>Visiting</th><th>Zone</th><th>Check In</th><th>Check Out</th><th>Status</th><th>Actions</th></tr>';
      visitors.rows.forEach(v => {
        const statusColor = v.status === 'checked_in' ? '#22c55e' : v.status === 'checked_out' ? '#94a3b8' : '#f59e0b';
        html += `<tr>
          <td><strong>${esc(v.visitor_name)}</strong></td>
          <td>${esc(v.visitor_id_type || '—')}</td>
          <td>${esc(v.visitor_id_number || '—')}</td>
          <td>${esc(v.purpose || '—')}</td>
          <td>${esc(v.person_visiting || '—')}</td>
          <td>${esc(v.zone_accessed || '—')}</td>
          <td>${fmtTime(v.check_in)}</td>
          <td>${v.check_out ? fmtTime(v.check_out) : '—'}</td>
          <td>${badge(v.status.replace('_', ' '), statusColor)}</td>
          <td>
            ${v.status === 'checked_in'
              ? `<form method="POST" action="${navUrl('/visitors/' + v.id + '/checkout')}" style="display:inline">
                  <button class="btn" style="padding:4px 10px;font-size:12px;background:#f59e0b">Check Out</button></form>` : ''}
          </td></tr>`;
      });
      html += '</table>';
    } else { html += '<div class="card"><p style="color:#94a3b8">No visitor records.</p></div>'; }
    res.send(renderPage('Visitor Management', html, req.session.user, req));
  }));

  app.get('/school/smart-security/visitors/checkin', requireAuth, requireNotBanned, (req, res) => {
    let html = SKIP + nav('Visitors');
    html += '<div class="card"><h2>Visitor Check-In</h2>';
    html += `<form method="POST" action="${navUrl('/visitors/checkin')}">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Visitor Name *</label>
          <input name="visitor_name" required placeholder="Full name"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">ID Type</label>
          <select name="visitor_id_type">
            <option value="national_id">National ID</option><option value="passport">Passport</option>
            <option value="drivers_license">Driver's License</option><option value="other">Other</option>
          </select></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">ID Number</label>
          <input name="visitor_id_number" placeholder="ID number"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Person Visiting</label>
          <input name="person_visiting" placeholder="Who they are visiting"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Zone to Access</label>
          <input name="zone_accessed" placeholder="e.g. Admin Building"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Gate Pass ID</label>
          <input name="gate_pass_id" type="number" placeholder="Optional gate pass reference"></div>
      </div>
      <div style="margin-top:12px"><label style="display:block;margin-bottom:4px;font-weight:600">Purpose</label>
        <textarea name="purpose" rows="2" placeholder="Purpose of visit..."></textarea></div>
      <div style="margin-top:16px"><button type="submit" class="btn">Check In</button></div>
    </form></div>`;
    res.send(renderPage('Visitor Check-In', html, req.session.user, req));
  });

  app.post('/school/smart-security/visitors/checkin', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { visitor_name, visitor_id_type, visitor_id_number, person_visiting, zone_accessed, gate_pass_id, purpose } = req.body;
    if (!visitor_name || !visitor_name.trim()) return res.status(400).send('Visitor name is required.');
    await pool.query(
      `INSERT INTO security_visitor_logs (tenant_id, visitor_name, visitor_id_type, visitor_id_number, person_visiting, zone_accessed, gate_pass_id, purpose, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'checked_in')`,
      [tid, visitor_name.trim(), visitor_id_type || null, visitor_id_number || null,
       person_visiting || null, zone_accessed || null, gate_pass_id ? parseInt(gate_pass_id) : null, purpose || null]);
    audit(req, 'visitor_checked_in', { name: visitor_name.trim() });
    res.redirect(navUrl('/visitors'));
  }));

  app.post('/school/smart-security/visitors/:id/checkout', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query("UPDATE security_visitor_logs SET check_out=NOW(), status='checked_out' WHERE id=$1 AND tenant_id=$2", [req.params.id, tid]);
    audit(req, 'visitor_checked_out', { log_id: req.params.id });
    res.redirect(req.headers.referer || navUrl('/visitors'));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 9 — Patrol management
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/smart-security/patrols', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const patrols = await pool.query(
      `SELECT sp.*, sz.name AS zone_name FROM security_patrols sp
       LEFT JOIN security_zones sz ON sz.id=sp.zone_id
       WHERE sp.tenant_id=$1 ORDER BY sp.patrol_date DESC, sp.start_time DESC LIMIT 30`, [tid]);

    let html = SKIP + nav('Patrols');
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">';
    html += '<h2>Security Patrols</h2>';
    html += `<a href="${navUrl('/patrols/new')}" class="btn">+ Log Patrol</a></div>`;

    if (patrols.rows.length) {
      const statusColors = { scheduled: '#94a3b8', in_progress: '#3b82f6', completed: '#22c55e', missed: '#ef4444' };
      html += '<table><tr><th>Date</th><th>Zone</th><th>Guard</th><th>Start</th><th>End</th><th>Checkpoints</th><th>Incidents</th><th>Status</th></tr>';
      patrols.rows.forEach(p => {
        html += `<tr>
          <td><strong>${fmtDate(p.patrol_date)}</strong></td>
          <td>${esc(p.zone_name || 'General')}</td>
          <td>${esc(p.guard_name || '—')}</td>
          <td>${p.start_time || '—'}</td><td>${p.end_time || '—'}</td>
          <td>${p.checkpoints}</td><td>${p.incidents_found || 0}</td>
          <td>${badge((p.status || 'scheduled').replace('_', ' '), statusColors[p.status] || '#94a3b8')}</td></tr>`;
      });
      html += '</table>';
    } else { html += '<div class="card"><p style="color:#94a3b8">No patrol records.</p></div>'; }
    res.send(renderPage('Security Patrols', html, req.session.user, req));
  }));

  app.get('/school/smart-security/patrols/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const zones = await pool.query("SELECT id, name FROM security_zones WHERE tenant_id=$1 ORDER BY name", [tid]);
    let html = SKIP + nav('Patrols');
    html += '<div class="card"><h2>Log Security Patrol</h2>';
    html += `<form method="POST" action="${navUrl('/patrols/create')}">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Patrol Date *</label>
          <input name="patrol_date" type="date" required value="${new Date().toISOString().split('T')[0]}"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Zone</label>
          <select name="zone_id"><option value="">General Patrol</option>
            ${zones.rows.map(z => `<option value="${z.id}">${esc(z.name)}</option>`).join('')}
          </select></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Guard Name *</label>
          <input name="guard_name" required placeholder="Guard name"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Status</label>
          <select name="status">
            <option value="scheduled">Scheduled</option><option value="in_progress">In Progress</option>
            <option value="completed">Completed</option><option value="missed">Missed</option>
          </select></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Start Time</label>
          <input name="start_time" type="time"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">End Time</label>
          <input name="end_time" type="time"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Checkpoints</label>
          <input name="checkpoints" type="number" min="0" value="0"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Incidents Found</label>
          <input name="incidents_found" type="number" min="0" value="0"></div>
      </div>
      <div style="margin-top:12px"><label style="display:block;margin-bottom:4px;font-weight:600">Notes</label>
        <textarea name="notes" rows="2" placeholder="Patrol observations..."></textarea></div>
      <div style="margin-top:16px"><button type="submit" class="btn">Save Patrol Log</button></div>
    </form></div>`;
    res.send(renderPage('Log Patrol', html, req.session.user, req));
  }));

  app.post('/school/smart-security/patrols/create', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { patrol_date, zone_id, guard_name, status, start_time, end_time, checkpoints, incidents_found, notes } = req.body;
    if (!patrol_date || !guard_name) return res.status(400).send('Date and guard name are required.');
    await pool.query(
      `INSERT INTO security_patrols (tenant_id, zone_id, guard_name, patrol_date, start_time, end_time, checkpoints, incidents_found, status, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [tid, zone_id ? parseInt(zone_id) : null, guard_name.trim(), patrol_date,
       start_time || null, end_time || null, parseInt(checkpoints) || 0,
       parseInt(incidents_found) || 0, status || 'completed', notes || null]);
    audit(req, 'security_patrol_logged');
    res.redirect(navUrl('/patrols'));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 10 — Alert rules
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/smart-security/alerts', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const rules = await pool.query("SELECT * FROM security_alert_rules WHERE tenant_id=$1 ORDER BY name", [tid]);

    let html = SKIP + nav('Alerts');
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">';
    html += '<h2>Alert Rules</h2>';
    html += `<a href="${navUrl('/alerts/new')}" class="btn">+ Create Rule</a></div>`;

    if (rules.rows.length) {
      const sevColors = { critical: '#dc2626', high: '#ef4444', medium: '#f59e0b', low: '#3b82f6' };
      html += '<table><tr><th>Name</th><th>Trigger Type</th><th>Severity</th><th>Email</th><th>SMS</th><th>Status</th><th>Actions</th></tr>';
      rules.rows.forEach(r => {
        html += `<tr>
          <td><strong>${esc(r.name)}</strong></td>
          <td>${badge(r.trigger_type, '#e0e7ff')}</td>
          <td>${badge(r.severity, sevColors[r.severity] || '#94a3b8')}</td>
          <td>${r.notify_email ? '✅' : '❌'}</td>
          <td>${r.notify_sms ? '✅' : '❌'}</td>
          <td>${r.is_active ? badge('Active', '#22c55e') : badge('Inactive', '#94a3b8')}</td>
          <td>
            <form method="POST" action="${navUrl('/alerts/' + r.id + '/toggle')}" style="display:inline">
              <button class="btn" style="padding:4px 10px;font-size:12px;background:${r.is_active ? '#6b7280' : '#22c55e'}">${r.is_active ? 'Disable' : 'Enable'}</button>
            </form>
          </td></tr>`;
      });
      html += '</table>';
    } else { html += '<div class="card"><p style="color:#94a3b8">No alert rules configured.</p></div>'; }

    html += '<div class="card"><h3 style="margin-bottom:12px">Available Trigger Types</h3>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:14px">';
    html += '<div><strong>motion_detected:</strong> Camera motion detected after hours</div>';
    html += '<div><strong>camera_offline:</strong> Camera went offline unexpectedly</div>';
    html += '<div><strong>door_forced:</strong> Door opened without authorization</div>';
    html += '<div><strong>zone_breach:</strong> Unauthorized zone access</div>';
    html += '<div><strong>patrol_missed:</strong> Scheduled patrol not completed</div>';
    html += '<div><strong>incident_created:</strong> New incident reported</div>';
    html += '</div></div>';

    res.send(renderPage('Security Alert Rules', html, req.session.user, req));
  }));

  app.get('/school/smart-security/alerts/new', requireAuth, requireNotBanned, (req, res) => {
    let html = SKIP + nav('Alerts');
    html += '<div class="card"><h2>Create Alert Rule</h2>';
    html += `<form method="POST" action="${navUrl('/alerts/create')}">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Rule Name *</label>
          <input name="name" required placeholder="e.g. After-hours Motion Alert"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Trigger Type *</label>
          <select name="trigger_type" required>
            <option value="motion_detected">Motion Detected</option><option value="camera_offline">Camera Offline</option>
            <option value="door_forced">Door Forced Open</option><option value="zone_breach">Zone Breach</option>
            <option value="patrol_missed">Patrol Missed</option><option value="incident_created">Incident Created</option>
          </select></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Severity</label>
          <select name="severity"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></div>
      </div>
      <div style="margin-top:12px"><label style="display:block;margin-bottom:4px;font-weight:600">Description</label>
        <textarea name="description" rows="2"></textarea></div>
      <div style="margin-top:16px;display:flex;gap:16px">
        <label><input type="checkbox" name="notify_email" checked> Email Notification</label>
        <label><input type="checkbox" name="notify_sms"> SMS Notification</label>
      </div>
      <div style="margin-top:16px"><button type="submit" class="btn">Create Rule</button></div>
    </form></div>`;
    res.send(renderPage('Create Alert Rule', html, req.session.user, req));
  });

  app.post('/school/smart-security/alerts/create', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { name, trigger_type, severity, description, notify_email, notify_sms } = req.body;
    if (!name || !trigger_type) return res.status(400).send('Name and trigger type are required.');
    await pool.query(
      "INSERT INTO security_alert_rules (tenant_id, name, trigger_type, severity, description, notify_email, notify_sms) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [tid, name.trim(), trigger_type, severity || 'medium', description || null, notify_email === 'on', notify_sms === 'on']);
    res.redirect(navUrl('/alerts'));
  }));

  app.post('/school/smart-security/alerts/:id/toggle', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query("UPDATE security_alert_rules SET is_active=NOT is_active WHERE id=$1 AND tenant_id=$2", [req.params.id, tid]);
    res.redirect(req.headers.referer || navUrl('/alerts'));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 11 — Reports
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/smart-security/reports', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const incByType = await pool.query(
      "SELECT type, COUNT(*)::int AS c FROM security_incidents WHERE tenant_id=$1 GROUP BY type ORDER BY c DESC", [tid]);
    const incBySeverity = await pool.query(
      "SELECT severity, COUNT(*)::int AS c FROM security_incidents WHERE tenant_id=$1 GROUP BY severity ORDER BY c DESC", [tid]);
    const incByMonth = await pool.query(
      "SELECT TO_CHAR(created_at, 'YYYY-MM') AS month, COUNT(*)::int AS c FROM security_incidents WHERE tenant_id=$1 GROUP BY month ORDER BY month DESC LIMIT 12", [tid]);
    const visitorByMonth = await pool.query(
      "SELECT TO_CHAR(check_in, 'YYYY-MM') AS month, COUNT(*)::int AS c FROM security_visitor_logs WHERE tenant_id=$1 GROUP BY month ORDER BY month DESC LIMIT 12", [tid]);
    const patrolStats = await pool.query(
      "SELECT status, COUNT(*)::int AS c FROM security_patrols WHERE tenant_id=$1 GROUP BY status", [tid]);
    const camStats = await pool.query(
      "SELECT status, COUNT(*)::int AS c FROM security_cameras WHERE tenant_id=$1 GROUP BY status", [tid]);

    let html = SKIP + nav('Reports');
    html += '<h2 style="margin-bottom:20px">Security Reports</h2>';

    html += '<div class="card"><h3 style="margin-bottom:12px">Incidents by Type</h3>';
    if (incByType.rows.length) {
      html += '<table><tr><th>Type</th><th>Count</th></tr>';
      incByType.rows.forEach(r => { html += `<tr><td><strong>${esc(r.type.replace(/_/g, ' '))}</strong></td><td>${r.c}</td></tr>`; });
      html += '</table>';
    } else { html += '<p style="color:#94a3b8">No incidents reported.</p>'; }
    html += '</div>';

    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">';
    html += '<div class="card"><h3 style="margin-bottom:12px">Incidents by Severity</h3>';
    if (incBySeverity.rows.length) {
      const sevColors = { critical: '#dc2626', high: '#ef4444', medium: '#f59e0b', low: '#3b82f6' };
      incBySeverity.rows.forEach(r => {
        html += `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #e5e7eb">
          <span>${badge(r.severity, sevColors[r.severity] || '#94a3b8')}</span><strong>${r.c}</strong></div>`;
      });
    }
    html += '</div>';

    html += '<div class="card"><h3 style="margin-bottom:12px">Camera Status</h3>';
    if (camStats.rows.length) {
      const sColors = { online: '#22c55e', offline: '#ef4444', maintenance: '#f59e0b' };
      camStats.rows.forEach(r => {
        html += `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #e5e7eb">
          <span>${badge(r.status, sColors[r.status] || '#94a3b8')}</span><strong>${r.c}</strong></div>`;
      });
    }
    html += '</div>';

    html += '<div class="card"><h3 style="margin-bottom:12px">Patrol Status</h3>';
    if (patrolStats.rows.length) {
      const pColors = { completed: '#22c55e', in_progress: '#3b82f6', scheduled: '#94a3b8', missed: '#ef4444' };
      patrolStats.rows.forEach(r => {
        html += `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #e5e7eb">
          <span>${badge((r.status || '').replace('_', ' '), pColors[r.status] || '#94a3b8')}</span><strong>${r.c}</strong></div>`;
      });
    }
    html += '</div>';
    html += '</div>';

    if (incByMonth.rows.length) {
      html += '<div class="card"><h3 style="margin-bottom:12px">Monthly Incidents Trend</h3>';
      html += '<table><tr><th>Month</th><th>Incidents</th></tr>';
      incByMonth.rows.forEach(r => { html += `<tr><td><strong>${esc(r.month)}</strong></td><td>${r.c}</td></tr>`; });
      html += '</table></div>';
    }

    res.send(renderPage('Security Reports', html, req.session.user, req));
  }));
};
