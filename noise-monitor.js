module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5', GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.btn:hover{background:#3730a3}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}</style>';

  (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS noise_sensors (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, location VARCHAR(200) NOT NULL,
        room_id VARCHAR(80), zone_type VARCHAR(60) NOT NULL DEFAULT 'General',
        status VARCHAR(20) NOT NULL DEFAULT 'active', model VARCHAR(100),
        installed_date DATE, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS noise_readings (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, sensor_id INT REFERENCES noise_sensors(id),
        decibel_level NUMERIC(5,1), frequency_band VARCHAR(40),
        duration_sec INT, recorded_at TIMESTAMPTZ DEFAULT NOW(), notes TEXT
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS noise_alerts (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, sensor_id INT REFERENCES noise_sensors(id),
        decibel_level NUMERIC(5,1), threshold NUMERIC(5,1),
        duration_min NUMERIC(5,1), severity VARCHAR(20) NOT NULL DEFAULT 'warning',
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ DEFAULT NOW(), acknowledged_at TIMESTAMPTZ, acknowledged_by VARCHAR(120)
      )`);
      console.log('[Mod] noise-monitor OK');
    } catch(e) { console.warn('[Mod] noise-monitor Warn:', e.message); }
  })();

  /* ─── Helpers ─────────────────────────────────────────────── */
  const dbColor = (db) => {
    if (db <= 40) return '#22c55e';
    if (db <= 55) return '#f59e0b';
    if (db <= 70) return '#f97316';
    if (db <= 85) return '#ef4444';
    return '#7f1d1d';
  };
  const dbLabel = (db) => {
    if (db <= 40) return 'Quiet';
    if (db <= 55) return 'Moderate';
    if (db <= 70) return 'Loud';
    if (db <= 85) return 'Very Loud';
    return 'Dangerous';
  };
  const dbBadge = (v) => {
    const db = parseFloat(v) || 0;
    return `<span style="background:${dbColor(db)};color:#fff;padding:3px 10px;border-radius:20px;font-weight:700;font-size:13px">${db.toFixed(1)} dB — ${dbLabel(db)}</span>`;
  };
  const getBar = (pct, color) => {
    const c = color || (pct > 60 ? '#22c55e' : pct > 30 ? '#f59e0b' : '#ef4444');
    return `<div style="background:#e5e7eb;border-radius:6px;height:10px;width:100%"><div style="background:${c};height:10px;border-radius:6px;width:${Math.min(Math.max(pct,0),100)}%"></div></div>`;
  };
  const sevBadge = (s) => {
    const c = { info: '#3b82f6', warning: '#f59e0b', critical: '#ef4444', ok: '#22c55e' };
    return `<span style="background:${c[s]||'#6b7280'};color:#fff;padding:3px 10px;border-radius:20px;font-size:12px">${esc(s)}</span>`;
  };
  const zoneBadge = (z) => {
    const c = { 'Classroom': '#3b82f6', 'Library': '#8b5cf6', 'Quiet Zone': '#22c55e', 'Outdoor': '#f59e0b', 'Cafeteria': '#f97316', 'Gym': '#ef4444', 'Corridor': '#6b7280', 'General': '#6b7280', 'Admin': '#6366f1' };
    return `<span style="background:${c[z]||'#6b7280'};color:#fff;padding:3px 10px;border-radius:20px;font-size:12px">${esc(z)}</span>`;
  };
  const acousticsScore = (avgDb) => {
    const db = parseFloat(avgDb) || 0;
    if (db <= 35) return { score: 'A+', color: '#22c55e' };
    if (db <= 40) return { score: 'A', color: '#22c55e' };
    if (db <= 45) return { score: 'B', color: '#84cc16' };
    if (db <= 50) return { score: 'C', color: '#f59e0b' };
    if (db <= 60) return { score: 'D', color: '#f97316' };
    return { score: 'F', color: '#ef4444' };
  };

  /* ─── Route 1: Dashboard ──────────────────────────────────── */
  app.get('/school/noise-monitor', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const [sensorStats, activeAlerts, latestReadings, zoneStats] = await Promise.all([
        pool.query(`SELECT COUNT(*) AS total, COUNT(CASE WHEN status='active' THEN 1 END) AS active FROM noise_sensors WHERE tenant_id=$1`, [tid]),
        pool.query(`SELECT COUNT(*) AS cnt FROM noise_alerts WHERE tenant_id=$1 AND status='active'`, [tid]),
        pool.query(`SELECT DISTINCT ON (nr.sensor_id) nr.*, s.location, s.room_id, s.zone_type FROM noise_readings nr JOIN noise_sensors s ON s.id=nr.sensor_id WHERE s.tenant_id=$1 ORDER BY nr.sensor_id, nr.recorded_at DESC`, [tid]),
        pool.query(`SELECT s.zone_type, AVG(nr.decibel_level)::numeric(5,1) AS avg_db, MAX(nr.decibel_level)::numeric(5,1) AS max_db, COUNT(nr.id) AS readings FROM noise_sensors s LEFT JOIN noise_readings nr ON nr.sensor_id=s.id WHERE s.tenant_id=$1 AND nr.recorded_at > NOW() - INTERVAL '24 hours' GROUP BY s.zone_type ORDER BY avg_db DESC NULLS LAST`, [tid])
      ]);
      const sTotal = parseInt(sensorStats.rows[0]?.total) || 0;
      const sActive = parseInt(sensorStats.rows[0]?.active) || 0;
      const aCount = parseInt(activeAlerts.rows[0]?.cnt) || 0;
      let sensorHTML = '';
      for (const r of latestReadings.rows) {
        const db = parseFloat(r.decibel_level) || 0;
        sensorHTML += `<tr><td><strong>${esc(r.location)}</strong>${r.room_id ? '<br><small style="color:'+GRAY+'">'+esc(r.room_id)+'</small>' : ''}</td>
          <td>${zoneBadge(r.zone_type)}</td>
          <td>${dbBadge(db)}</td>
          <td>${esc(r.frequency_band||'—')}</td>
          <td>${r.duration_sec ? Math.round(r.duration_sec/60)+' min' : '—'}</td>
          <td>${r.recorded_at ? new Date(r.recorded_at).toLocaleString() : '—'}</td></tr>`;
      }
      const alertList = await pool.query(`SELECT na.*, s.location, s.room_id, s.zone_type FROM noise_alerts na JOIN noise_sensors s ON s.id=na.sensor_id WHERE na.tenant_id=$1 AND na.status='active' ORDER BY na.created_at DESC LIMIT 8`, [tid]);
      let alertHTML = '';
      if (alertList.rows.length === 0) {
        alertHTML = '<tr><td colspan="5" style="text-align:center;color:#22c55e;font-weight:600">✅ All noise levels within acceptable limits</td></tr>';
      } else {
        for (const a of alertList.rows) {
          alertHTML += `<tr><td>${esc(a.location)}${a.room_id ? ' ('+esc(a.room_id)+')' : ''}</td>
            <td>${zoneBadge(a.zone_type)}</td>
            <td>${parseFloat(a.decibel_level).toFixed(1)} dB (threshold: ${a.threshold} dB)</td>
            <td>${sevBadge(a.severity)}</td>
            <td><a href="/school/noise-monitor/alerts/ack/${a.id}" class="btn" style="font-size:11px;padding:3px 8px;background:#f59e0b">Ack</a></td></tr>`;
        }
      }
      let zoneHTML = '';
      for (const z of zoneStats.rows) {
        const db = parseFloat(z.avg_db) || 0;
        zoneHTML += `<tr><td>${zoneBadge(z.zone_type)}</td>
          <td>${dbBadge(db)}</td>
          <td>${z.max_db ? z.max_db.toFixed(1)+' dB' : '—'}</td>
          <td>${z.readings}</td></tr>`;
      }
      const html = `${SKIP}
      <div class="card" style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;text-align:center">
        <div><div style="font-size:28px;font-weight:700;color:${P}">${sTotal}</div><div style="color:${GRAY}">Sensors</div></div>
        <div><div style="font-size:28px;font-weight:700;color:#22c55e">${sActive}</div><div style="color:${GRAY}">Active</div></div>
        <div><div style="font-size:28px;font-weight:700;color:#ef4444">${aCount}</div><div style="color:${GRAY}">Active Alerts</div></div>
        <div><div style="font-size:28px;font-weight:700;color:${P}">${zoneStats.rows.length}</div><div style="color:${GRAY}">Zones Monitored</div></div>
      </div>
      <div class="card"><h3 style="margin:0 0 10px">Latest Sensor Readings</h3>
        <div style="overflow-x:auto"><table><thead><tr><th>Location</th><th>Zone</th><th>Level</th><th>Frequency</th><th>Duration</th><th>Time</th></tr></thead>
        <tbody>${sensorHTML}</tbody></table></div></div>
      <div class="card"><h3 style="margin:0 0 10px">Zone Summary (24h)</h3>
        <div style="overflow-x:auto"><table><thead><tr><th>Zone Type</th><th>Avg Level</th><th>Peak</th><th>Readings</th></tr></thead>
        <tbody>${zoneHTML}</tbody></table></div></div>
      <div class="card"><h3 style="margin:0 0 10px">⚠️ Active Noise Alerts</h3>
        <div style="overflow-x:auto"><table><thead><tr><th>Location</th><th>Zone</th><th>Level</th><th>Severity</th><th>Action</th></tr></thead>
        <tbody>${alertHTML}</tbody></table></div></div>
      <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
        <a href="/school/noise-monitor/sensors" class="btn" style="text-decoration:none">Manage Sensors</a>
        <a href="/school/noise-monitor/readings" class="btn" style="text-decoration:none;background:#22c55e">Record Reading</a>
        <a href="/school/noise-monitor/analytics" class="btn" style="text-decoration:none;background:#f59e0b">Analytics</a>
        <a href="/school/noise-monitor/quiet-zones" class="btn" style="text-decoration:none;background:#8b5cf6">Quiet Zones</a>
        <a href="/school/noise-monitor/acoustics" class="btn" style="text-decoration:none;background:#06b6d4">Acoustics</a>
      </div>`;
      renderPage(req, res, 'Noise Monitor', html, { activeTab: 'noise-monitor' });
    } catch(e) { ah(e, req, res); }
  });

  /* ─── Route 2: Manage Sensors ─────────────────────────────── */
  app.get('/school/noise-monitor/sensors', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const rows = await pool.query(`SELECT * FROM noise_sensors WHERE tenant_id=$1 ORDER BY location`, [tid]);
      let list = '';
      for (const r of rows.rows) {
        list += `<tr><td>${r.id}</td><td>${esc(r.location)}</td><td>${esc(r.room_id||'—')}</td>
          <td>${zoneBadge(r.zone_type)}</td><td>${esc(r.model||'—')}</td>
          <td><span style="color:${r.status==='active'?'#22c55e':'#ef4444'}">${esc(r.status)}</span></td>
          <td>${r.installed_date ? new Date(r.installed_date).toLocaleDateString() : '—'}</td>
          <td><a href="/school/noise-monitor/sensors/edit/${r.id}" class="btn" style="font-size:12px;padding:4px 10px">Edit</a>
          <form method="POST" action="/school/noise-monitor/sensors/delete" style="display:inline">
            <input type="hidden" name="id" value="${r.id}">
            <button class="btn" style="background:#ef4444;font-size:12px;padding:4px 10px" onclick="return confirm('Delete sensor?')">Del</button></form></td></tr>`;
      }
      const html = `${SKIP}
      <div class="card" style="display:flex;justify-content:space-between;align-items:center">
        <h3 style="margin:0">Noise Sensors</h3>
        <a href="/school/noise-monitor/sensors/add" class="btn" style="text-decoration:none">+ Add Sensor</a>
      </div>
      <div class="card"><div style="overflow-x:auto"><table>
        <thead><tr><th>ID</th><th>Location</th><th>Room</th><th>Zone</th><th>Model</th><th>Status</th><th>Installed</th><th>Actions</th></tr></thead>
        <tbody>${list}</tbody></table></div></div>
      <a href="/school/noise-monitor" class="btn" style="background:${GRAY};text-decoration:none">← Dashboard</a>`;
      renderPage(req, res, 'Noise Sensors', html, { activeTab: 'noise-monitor' });
    } catch(e) { ah(e, req, res); }
  });

  /* ─── Route 3: Add Sensor ─────────────────────────────────── */
  app.get('/school/noise-monitor/sensors/add', requireAuth, requireNotBanned, (req, res) => {
    const html = `${SKIP}
    <div class="card"><h3>Add Noise Sensor</h3>
      <form method="POST" action="/school/noise-monitor/sensors/add" style="display:grid;gap:12px;max-width:550px">
        <label>Location <input name="location" required placeholder="e.g. Building A, Floor 1"></label>
        <label>Room ID <input name="room_id" placeholder="e.g. R-101"></label>
        <label>Zone Type <select name="zone_type"><option>Classroom</option><option>Library</option><option>Quiet Zone</option><option>Outdoor</option><option>Cafeteria</option><option>Gym</option><option>Corridor</option><option>Admin</option><option>General</option></select></label>
        <label>Model <input name="model" placeholder="e.g. PCE-322A"></label>
        <label>Installed Date <input type="date" name="installed_date"></label>
        <label>Notes <textarea name="notes" rows="3"></textarea></label>
        <button type="submit" class="btn">Add Sensor</button>
        <a href="/school/noise-monitor/sensors" class="btn" style="background:${GRAY};text-decoration:none;text-align:center">Cancel</a>
      </form>
    </div>`;
    renderPage(req, res, 'Add Noise Sensor', html, { activeTab: 'noise-monitor' });
  });

  app.post('/school/noise-monitor/sensors/add', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { location, room_id, zone_type, model, installed_date, notes } = req.body;
      const tid = req.user.tenant_id;
      await pool.query(`INSERT INTO noise_sensors (tenant_id,location,room_id,zone_type,model,installed_date,notes) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [tid, location, room_id, zone_type, model, installed_date||null, notes]);
      audit(req, 'noise_sensor_add', { location, zone_type });
      req.flash('success', 'Sensor added');
      res.redirect('/school/noise-monitor/sensors');
    } catch(e) { ah(e, req, res); }
  });

  /* ─── Edit Sensor ─────────────────────────────────────────── */
  app.get('/school/noise-monitor/sensors/edit/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const s = await pool.query(`SELECT * FROM noise_sensors WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
      if (!s.rows.length) return res.redirect('/school/noise-monitor/sensors');
      const r = s.rows[0];
      const zones = ['Classroom','Library','Quiet Zone','Outdoor','Cafeteria','Gym','Corridor','Admin','General'];
      let zoneOpts = zones.map(z => `<option ${r.zone_type===z?'selected':''}>${z}</option>`).join('');
      const html = `${SKIP}
      <div class="card"><h3>Edit Sensor #${r.id}</h3>
        <form method="POST" action="/school/noise-monitor/sensors/edit/${r.id}" style="display:grid;gap:12px;max-width:550px">
          <label>Location <input name="location" value="${esc(r.location)}" required></label>
          <label>Room ID <input name="room_id" value="${esc(r.room_id||'')}"></label>
          <label>Zone Type <select name="zone_type">${zoneOpts}</select></label>
          <label>Model <input name="model" value="${esc(r.model||'')}"></label>
          <label>Installed Date <input type="date" name="installed_date" value="${r.installed_date||''}"></label>
          <label>Status <select name="status"><option value="active" ${r.status==='active'?'selected':''}>Active</option><option value="inactive" ${r.status==='inactive'?'selected':''}>Inactive</option><option value="maintenance" ${r.status==='maintenance'?'selected':''}>Maintenance</option></select></label>
          <label>Notes <textarea name="notes" rows="3">${esc(r.notes||'')}</textarea></label>
          <button type="submit" class="btn">Update</button>
          <a href="/school/noise-monitor/sensors" class="btn" style="background:${GRAY};text-decoration:none;text-align:center">Cancel</a>
        </form>
      </div>`;
      renderPage(req, res, 'Edit Noise Sensor', html, { activeTab: 'noise-monitor' });
    } catch(e) { ah(e, req, res); }
  });

  app.post('/school/noise-monitor/sensors/edit/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { location, room_id, zone_type, model, installed_date, status, notes } = req.body;
      const tid = req.user.tenant_id;
      await pool.query(`UPDATE noise_sensors SET location=$1,room_id=$2,zone_type=$3,model=$4,installed_date=$5,status=$6,notes=$7 WHERE id=$8 AND tenant_id=$9`, [location, room_id, zone_type, model, installed_date||null, status, notes, req.params.id, tid]);
      audit(req, 'noise_sensor_edit', { id: req.params.id });
      req.flash('success', 'Sensor updated');
      res.redirect('/school/noise-monitor/sensors');
    } catch(e) { ah(e, req, res); }
  });

  /* ─── Delete Sensor ───────────────────────────────────────── */
  app.post('/school/noise-monitor/sensors/delete', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      await pool.query(`DELETE FROM noise_alerts WHERE sensor_id=$1 AND tenant_id=$2`, [req.body.id, tid]);
      await pool.query(`DELETE FROM noise_readings WHERE sensor_id=$1 AND tenant_id=$2`, [req.body.id, tid]);
      await pool.query(`DELETE FROM noise_sensors WHERE id=$1 AND tenant_id=$2`, [req.body.id, tid]);
      audit(req, 'noise_sensor_delete', { id: req.body.id });
      req.flash('success', 'Sensor deleted');
      res.redirect('/school/noise-monitor/sensors');
    } catch(e) { ah(e, req, res); }
  });

  /* ─── Route 4: Record Reading ─────────────────────────────── */
  app.get('/school/noise-monitor/readings', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const sensors = await pool.query(`SELECT id, location, room_id, zone_type FROM noise_sensors WHERE tenant_id=$1 AND status='active' ORDER BY location`, [tid]);
      let optHTML = '';
      for (const s of sensors.rows) optHTML += `<option value="${s.id}">${esc(s.location)}${s.room_id ? ' ('+esc(s.room_id)+')' : ''} [${esc(s.zone_type)}]</option>`;
      const html = `${SKIP}
      <div class="card"><h3>Record Noise Reading</h3>
        <form method="POST" action="/school/noise-monitor/readings" style="display:grid;gap:12px;max-width:600px">
          <label>Sensor <select name="sensor_id" required><option value="">Select sensor...</option>${optHTML}</select></label>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <label>Decibel Level (dB) <input type="number" name="decibel_level" step="0.1" min="0" max="200" required></label>
            <label>Frequency Band <select name="frequency_band"><option>Full Spectrum</option><option>Low (20–250 Hz)</option><option>Mid (250–4000 Hz)</option><option>High (4000–20000 Hz)</option></select></label>
            <label>Duration (seconds) <input type="number" name="duration_sec" min="1"></label>
            <label>Notes <input name="notes" placeholder="Source of noise, context..."></label>
          </div>
          <button type="submit" class="btn">Submit Reading</button>
          <a href="/school/noise-monitor" class="btn" style="background:${GRAY};text-decoration:none;text-align:center">Cancel</a>
        </form>
      </div>`;
      renderPage(req, res, 'Record Noise', html, { activeTab: 'noise-monitor' });
    } catch(e) { ah(e, req, res); }
  });

  app.post('/school/noise-monitor/readings', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { sensor_id, decibel_level, frequency_band, duration_sec, notes } = req.body;
      const tid = req.user.tenant_id;
      const sid = parseInt(sensor_id);
      await pool.query(`INSERT INTO noise_readings (tenant_id,sensor_id,decibel_level,frequency_band,duration_sec,notes) VALUES ($1,$2,$3,$4,$5,$6)`, [tid, sid, parseFloat(decibel_level)||0, frequency_band, parseInt(duration_sec)||null, notes]);
      const sensor = await pool.query(`SELECT zone_type FROM noise_sensors WHERE id=$1 AND tenant_id=$2`, [sid, tid]);
      const zone = sensor.rows[0]?.zone_type || 'General';
      const thresholds = {
        'Quiet Zone': 45, 'Library': 40, 'Classroom': 55,
        'Admin': 50, 'General': 65, 'Corridor': 70,
        'Cafeteria': 75, 'Gym': 80, 'Outdoor': 70
      };
      const thresh = thresholds[zone] || 65;
      const db = parseFloat(decibel_level) || 0;
      const durMin = (parseInt(duration_sec)||0) / 60;
      if (db > thresh) {
        const sev = db > thresh + 20 ? 'critical' : 'warning';
        const rec = db > thresh + 20
          ? 'Immediate intervention required. Consider relocating students, installing sound dampening, or investigating noise source.'
          : 'Noise exceeds zone threshold. Monitor and address if persistent.';
        await pool.query(`INSERT INTO noise_alerts (tenant_id,sensor_id,decibel_level,threshold,duration_min,severity) VALUES ($1,$2,$3,$4,$5,$6)`, [tid, sid, db, thresh, durMin||null, sev]);
        if (sev === 'critical') {
          queueEmail(tid, { subject: 'CRITICAL: Noise Alert — ' + db.toFixed(1) + ' dB in ' + zone, body: `Noise level ${db.toFixed(1)} dB exceeds threshold ${thresh} dB in ${zone} zone. ${rec}` });
        }
      }
      audit(req, 'noise_reading_add', { sensor_id, decibel_level, zone });
      req.flash('success', 'Reading recorded');
      res.redirect('/school/noise-monitor');
    } catch(e) { ah(e, req, res); }
  });

  /* ─── Route 5: Alert Management ───────────────────────────── */
  app.get('/school/noise-monitor/alerts', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const sf = req.query.status || 'active';
      let where = 'WHERE na.tenant_id=$1';
      const params = [tid];
      if (sf !== 'all') { where += ' AND na.status=$2'; params.push(sf); }
      const alerts = await pool.query(`SELECT na.*, s.location, s.room_id, s.zone_type FROM noise_alerts na JOIN noise_sensors s ON s.id=na.sensor_id ${where} ORDER BY na.created_at DESC LIMIT 60`, params);
      let list = '';
      for (const a of alerts.rows) {
        list += `<tr><td>${a.id}</td><td>${esc(a.location)}${a.room_id ? ' ('+esc(a.room_id)+')' : ''}</td>
          <td>${zoneBadge(a.zone_type)}</td>
          <td>${parseFloat(a.decibel_level).toFixed(1)} dB</td>
          <td>${a.threshold} dB</td>
          <td>${a.duration_min ? parseFloat(a.duration_min).toFixed(1)+' min' : '—'}</td>
          <td>${sevBadge(a.severity)}</td>
          <td><span style="color:${a.status==='active'?'#ef4444':'#22c55e'}">${esc(a.status)}</span></td>
          <td>${a.status === 'active' ? `<a href="/school/noise-monitor/alerts/ack/${a.id}" class="btn" style="font-size:11px;padding:3px 8px">Ack</a>` : esc(a.acknowledged_by||'—')}</td></tr>`;
      }
      const html = `${SKIP}
      <div class="card" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
        <h3 style="margin:0">Noise Alerts</h3>
        <div style="display:flex;gap:6px">
          <a href="/school/noise-monitor/alerts?status=active" class="btn" style="font-size:12px;padding:4px 10px;${sf==='active'?'background:#ef4444':''}">Active</a>
          <a href="/school/noise-monitor/alerts?status=acknowledged" class="btn" style="font-size:12px;padding:4px 10px;${sf==='acknowledged'?'background:#f59e0b':''}">Acknowledged</a>
          <a href="/school/noise-monitor/alerts?status=all" class="btn" style="font-size:12px;padding:4px 10px;${sf==='all'?'background:#3730a3':''}">All</a>
        </div>
      </div>
      <div class="card"><div style="overflow-x:auto"><table>
        <thead><tr><th>ID</th><th>Location</th><th>Zone</th><th>Level</th><th>Threshold</th><th>Duration</th><th>Severity</th><th>Status</th><th>Ack By</th></tr></thead>
        <tbody>${list}</tbody></table></div></div>
      <a href="/school/noise-monitor" class="btn" style="background:${GRAY};text-decoration:none">← Dashboard</a>`;
      renderPage(req, res, 'Noise Alerts', html, { activeTab: 'noise-monitor' });
    } catch(e) { ah(e, req, res); }
  });

  app.get('/school/noise-monitor/alerts/ack/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      await pool.query(`UPDATE noise_alerts SET status='acknowledged',acknowledged_at=NOW(),acknowledged_by=$1 WHERE id=$2 AND tenant_id=$3`, [req.user.name||req.user.email, req.params.id, tid]);
      audit(req, 'noise_alert_ack', { id: req.params.id });
      req.flash('success', 'Alert acknowledged');
      res.redirect('/school/noise-monitor/alerts');
    } catch(e) { ah(e, req, res); }
  });

  /* ─── Route 6: Analytics ──────────────────────────────────── */
  app.get('/school/noise-monitor/analytics', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const days = parseInt(req.query.days) || 7;
      const dailyStats = await pool.query(`
        SELECT DATE(nr.recorded_at) AS day,
          AVG(nr.decibel_level)::numeric(5,1) AS avg_db,
          MAX(nr.decibel_level)::numeric(5,1) AS max_db,
          MIN(nr.decibel_level)::numeric(5,1) AS min_db,
          AVG(nr.duration_sec)::int AS avg_duration,
          COUNT(nr.id) AS readings
        FROM noise_readings nr JOIN noise_sensors s ON s.id=nr.sensor_id
        WHERE s.tenant_id=$1 AND nr.recorded_at > NOW() - INTERVAL '${days} days'
        GROUP BY DATE(nr.recorded_at) ORDER BY day`, [tid]);
      const locationStats = await pool.query(`
        SELECT s.location, s.room_id, s.zone_type,
          AVG(nr.decibel_level)::numeric(5,1) AS avg_db,
          MAX(nr.decibel_level)::numeric(5,1) AS max_db,
          COUNT(nr.id) AS readings
        FROM noise_sensors s LEFT JOIN noise_readings nr ON nr.sensor_id=s.id
          AND nr.recorded_at > NOW() - INTERVAL '${days} days'
        WHERE s.tenant_id=$1 AND s.status='active'
        GROUP BY s.id ORDER BY avg_db DESC NULLS LAST`, [tid]);
      const freqStats = await pool.query(`
        SELECT frequency_band, COUNT(*) AS cnt, AVG(decibel_level)::numeric(5,1) AS avg_db
        FROM noise_readings nr JOIN noise_sensors s ON s.id=nr.sensor_id
        WHERE s.tenant_id=$1 AND nr.recorded_at > NOW() - INTERVAL '${days} days'
        GROUP BY frequency_band ORDER BY avg_db DESC`, [tid]);
      let dailyHTML = '';
      for (const d of dailyStats.rows) {
        const avg = parseFloat(d.avg_db) || 0;
        dailyHTML += `<tr><td>${new Date(d.day).toLocaleDateString()}</td>
          <td>${dbBadge(avg)}</td><td>${d.max_db ?? '—'} dB</td><td>${d.min_db ?? '—'} dB</td>
          <td>${d.avg_duration ? Math.round(d.avg_duration/60)+' min' : '—'}</td>
          <td>${d.readings}</td></tr>`;
      }
      let locHTML = '';
      for (const l of locationStats.rows) {
        const avg = parseFloat(l.avg_db) || 0;
        const asc = acousticsScore(avg);
        locHTML += `<tr><td>${esc(l.location)}${l.room_id ? '<br><small>'+esc(l.room_id)+'</small>' : ''}</td>
          <td>${zoneBadge(l.zone_type)}</td>
          <td>${dbBadge(avg)}</td>
          <td style="font-size:20px;font-weight:700;color:${asc.color}">${asc.score}</td>
          <td>${l.readings}</td></tr>`;
      }
      let freqHTML = '';
      for (const f of freqStats.rows) {
        freqHTML += `<tr><td>${esc(f.frequency_band)}</td><td>${f.cnt}</td><td>${f.avg_db} dB</td></tr>`;
      }
      const html = `${SKIP}
      <div class="card" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
        <h3 style="margin:0">Noise Analytics</h3>
        <div style="display:flex;gap:6px">
          <a href="/school/noise-monitor/analytics?days=7" class="btn" style="font-size:12px;padding:4px 10px;${days===7?'background:#3730a3':''}">7d</a>
          <a href="/school/noise-monitor/analytics?days=30" class="btn" style="font-size:12px;padding:4px 10px;${days===30?'background:#3730a3':''}">30d</a>
          <a href="/school/noise-monitor/analytics?days=90" class="btn" style="font-size:12px;padding:4px 10px;${days===90?'background:#3730a3':''}">90d</a>
        </div>
      </div>
      <div class="card"><h3 style="margin:0 0 10px">Daily Summary</h3>
        <div style="overflow-x:auto"><table><thead><tr><th>Date</th><th>Avg Level</th><th>Peak</th><th>Min</th><th>Avg Duration</th><th>Readings</th></tr></thead>
        <tbody>${dailyHTML}</tbody></table></div></div>
      <div class="card"><h3 style="margin:0 0 10px">Location Ranking (Loudest First)</h3>
        <div style="overflow-x:auto"><table><thead><tr><th>Location</th><th>Zone</th><th>Avg Level</th><th>Acoustics</th><th>Readings</th></tr></thead>
        <tbody>${locHTML}</tbody></table></div></div>
      <div class="card"><h3 style="margin:0 0 10px">Frequency Analysis</h3>
        <div style="overflow-x:auto"><table><thead><tr><th>Band</th><th>Readings</th><th>Avg dB</th></tr></thead>
        <tbody>${freqHTML}</tbody></table></div></div>
      <a href="/school/noise-monitor" class="btn" style="background:${GRAY};text-decoration:none">← Dashboard</a>`;
      renderPage(req, res, 'Noise Analytics', html, { activeTab: 'noise-monitor' });
    } catch(e) { ah(e, req, res); }
  });

  /* ─── Route 7: Quiet Zone Enforcement ─────────────────────── */
  app.get('/school/noise-monitor/quiet-zones', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const quietSensors = await pool.query(`
        SELECT s.id, s.location, s.room_id, s.zone_type,
          ar.decibel_level, ar.recorded_at
        FROM noise_sensors s
        LEFT JOIN LATERAL (
          SELECT decibel_level, recorded_at FROM noise_readings
          WHERE sensor_id=s.id ORDER BY recorded_at DESC LIMIT 1
        ) ar ON true
        WHERE s.tenant_id=$1 AND s.status='active'
        AND s.zone_type IN ('Quiet Zone','Library','Classroom')
        ORDER BY ar.decibel_level DESC NULLS LAST`, [tid]);
      const violations = await pool.query(`
        SELECT s.location, s.room_id, s.zone_type, COUNT(na.id) AS violations,
          MAX(na.decibel_level)::numeric(5,1) AS max_level
        FROM noise_sensors s
        JOIN noise_alerts na ON na.sensor_id=s.id AND na.status='active'
        WHERE s.tenant_id=$1 AND s.zone_type IN ('Quiet Zone','Library','Classroom')
        GROUP BY s.id ORDER BY violations DESC`, [tid]);
      const thresholds = { 'Quiet Zone': 45, 'Library': 40, 'Classroom': 55 };
      let rows = '';
      for (const s of quietSensors.rows) {
        const db = parseFloat(s.decibel_level) || 0;
        const thresh = thresholds[s.zone_type] || 55;
        const isViolating = db > thresh;
        const status = isViolating
          ? `<span style="color:#ef4444;font-weight:700">🔴 VIOLATING (${db.toFixed(1)} / ${thresh} dB)</span>`
          : `<span style="color:#22c55e;font-weight:700">🟢 Compliant (${db.toFixed(1)} / ${thresh} dB)</span>`;
        rows += `<tr><td>${esc(s.location)}${s.room_id ? '<br><small>'+esc(s.room_id)+'</small>' : ''}</td>
          <td>${zoneBadge(s.zone_type)}</td>
          <td>${getBar(Math.min((db/thresh)*100, 150), isViolating?'#ef4444':'#22c55e')}</td>
          <td>${status}</td>
          <td>${s.recorded_at ? new Date(s.recorded_at).toLocaleString() : '—'}</td></tr>`;
      }
      let violHTML = '';
      for (const v of violations.rows) {
        violHTML += `<tr><td>${esc(v.location)}${v.room_id ? ' ('+esc(v.room_id)+')' : ''}</td>
          <td>${zoneBadge(v.zone_type)}</td>
          <td style="color:#ef4444;font-weight:700">${v.violations}</td>
          <td>${v.max_level ? v.max_level.toFixed(1)+' dB' : '—'}</td></tr>`;
      }
      if (!violHTML) violHTML = '<tr><td colspan="4" style="text-align:center;color:#22c55e">No active violations</td></tr>';
      const html = `${SKIP}
      <div class="card"><h3 style="margin:0 0 10px">🔇 Quiet Zone Enforcement</h3>
        <p style="color:${GRAY};margin:0 0 12px">Monitoring designated quiet zones: Libraries ≤40 dB, Quiet Zones ≤45 dB, Classrooms ≤55 dB</p>
        <div style="overflow-x:auto"><table>
          <thead><tr><th>Location</th><th>Zone</th><th>Level vs Threshold</th><th>Status</th><th>Last Reading</th></tr></thead>
          <tbody>${rows}</tbody></table></div>
      </div>
      <div class="card"><h3 style="margin:0 0 10px">Active Violations</h3>
        <div style="overflow-x:auto"><table>
          <thead><tr><th>Location</th><th>Zone</th><th>Open Alerts</th><th>Peak Level</th></tr></thead>
          <tbody>${violHTML}</tbody></table></div>
      </div>
      <a href="/school/noise-monitor" class="btn" style="background:${GRAY};text-decoration:none">← Dashboard</a>`;
      renderPage(req, res, 'Quiet Zone Enforcement', html, { activeTab: 'noise-monitor' });
    } catch(e) { ah(e, req, res); }
  });

  /* ─── Route 8: Classroom Acoustics Scoring ────────────────── */
  app.get('/school/noise-monitor/acoustics', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const days = parseInt(req.query.days) || 30;
      const classroomData = await pool.query(`
        SELECT s.location, s.room_id, s.zone_type, s.model,
          AVG(nr.decibel_level)::numeric(5,1) AS avg_db,
          MAX(nr.decibel_level)::numeric(5,1) AS max_db,
          MIN(nr.decibel_level)::numeric(5,1) AS min_db,
          STDDEV(nr.decibel_level)::numeric(5,1) AS stddev_db,
          COUNT(nr.id) AS sample_count,
          AVG(nr.duration_sec)::int AS avg_duration
        FROM noise_sensors s
        JOIN noise_readings nr ON nr.sensor_id=s.id
          AND nr.recorded_at > NOW() - INTERVAL '${days} days'
        WHERE s.tenant_id=$1 AND s.status='active'
        GROUP BY s.id ORDER BY avg_db ASC`, [tid]);
      let rows = '';
      let totalRooms = 0, passCount = 0, warnCount = 0, failCount = 0;
      for (const c of classroomData.rows) {
        const avg = parseFloat(c.avg_db) || 0;
        const asc = acousticsScore(avg);
        if (avg <= 45) passCount++;
        else if (avg <= 55) warnCount++;
        else failCount++;
        totalRooms++;
        const recommendation = avg <= 35
          ? '<span style="color:#22c55e">Excellent acoustics — ideal for learning</span>'
          : avg <= 45
          ? '<span style="color:#22c55e">Good — meets WHO classroom standards</span>'
          : avg <= 55
          ? '<span style="color:#f59e0b">Fair — consider acoustic panels or door seals</span>'
          : avg <= 65
          ? '<span style="color:#f97316">Poor — acoustic treatment strongly recommended</span>'
          : '<span style="color:#ef4444">Failing — urgent acoustic intervention needed</span>';
        rows += `<tr><td>${esc(c.location)}${c.room_id ? '<br><small>'+esc(c.room_id)+'</small>' : ''}</td>
          <td>${zoneBadge(c.zone_type)}</td>
          <td>${avg.toFixed(1)} dB</td>
          <td>${(c.max_db||0).toFixed(1)} / ${(c.min_db||0).toFixed(1)}</td>
          <td>${c.stddev_db ? c.stddev_db.toFixed(1)+' dB' : '—'}</td>
          <td style="font-size:22px;font-weight:700;color:${asc.color}">${asc.score}</td>
          <td>${recommendation}</td>
          <td>${c.sample_count}</td></tr>`;
      }
      const html = `${SKIP}
      <div class="card" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
        <h3 style="margin:0">🏫 Classroom Acoustics Scoring</h3>
        <div style="display:flex;gap:6px">
          <a href="/school/noise-monitor/acoustics?days=7" class="btn" style="font-size:12px;padding:4px 10px;${days===7?'background:#3730a3':''}">7d</a>
          <a href="/school/noise-monitor/acoustics?days=30" class="btn" style="font-size:12px;padding:4px 10px;${days===30?'background:#3730a3':''}">30d</a>
          <a href="/school/noise-monitor/acoustics?days=90" class="btn" style="font-size:12px;padding:4px 10px;${days===90?'background:#3730a3':''}">90d</a>
        </div>
      </div>
      <div class="card" style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;text-align:center">
        <div><div style="font-size:24px;font-weight:700;color:${P}">${totalRooms}</div><div style="color:${GRAY}">Rooms Monitored</div></div>
        <div><div style="font-size:24px;font-weight:700;color:#22c55e">${passCount}</div><div style="color:${GRAY}">Good (≤45 dB)</div></div>
        <div><div style="font-size:24px;font-weight:700;color:#f59e0b">${warnCount}</div><div style="color:${GRAY}">Fair (46–55 dB)</div></div>
        <div><div style="font-size:24px;font-weight:700;color:#ef4444">${failCount}</div><div style="color:${GRAY}">Poor (>55 dB)</div></div>
      </div>
      <div class="card">
        <p style="color:${GRAY};margin:0 0 10px">Scoring: A+ (≤35 dB) | A (≤40 dB) | B (≤45 dB) | C (≤50 dB) | D (≤60 dB) | F (>60 dB). WHO recommends ≤35 dB for classrooms.</p>
        <div style="overflow-x:auto"><table>
          <thead><tr><th>Location</th><th>Zone</th><th>Avg dB</th><th>Range</th><th>StdDev</th><th>Grade</th><th>Recommendation</th><th>Samples</th></tr></thead>
          <tbody>${rows}</tbody></table></div>
      </div>
      <a href="/school/noise-monitor" class="btn" style="background:${GRAY};text-decoration:none">← Dashboard</a>`;
      renderPage(req, res, 'Acoustics Report', html, { activeTab: 'noise-monitor' });
    } catch(e) { ah(e, req, res); }
  });

  /* ─── Route 9: Hearing Protection Guide ───────────────────── */
  app.get('/school/noise-monitor/hearing', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const highRisk = await pool.query(`
        SELECT s.location, s.room_id, s.zone_type,
          AVG(nr.decibel_level)::numeric(5,1) AS avg_db,
          MAX(nr.decibel_level)::numeric(5,1) AS max_db,
          COUNT(nr.id) AS readings,
          SUM(CASE WHEN nr.decibel_level > 85 THEN 1 END) AS dangerous_readings
        FROM noise_sensors s
        JOIN noise_readings nr ON nr.sensor_id=s.id
          AND nr.recorded_at > NOW() - INTERVAL '30 days'
        WHERE s.tenant_id=$1 AND s.status='active'
        GROUP BY s.id
        HAVING AVG(nr.decibel_level) > 70
        ORDER BY avg_db DESC`, [tid]);
      let riskHTML = '';
      for (const r of highRisk.rows) {
        const avg = parseFloat(r.avg_db) || 0;
        const danger = parseInt(r.dangerous_readings) || 0;
        const riskLevel = avg > 85 ? '🔴 Critical Risk' : avg > 75 ? '🟠 High Risk' : '🟡 Moderate Risk';
        const maxExposure = avg > 85 ? '15 min/day' : avg > 80 ? '8 hours/day' : avg > 75 ? '24 hours/day' : 'No limit';
        riskHTML += `<tr><td>${esc(r.location)}${r.room_id ? '<br><small>'+esc(r.room_id)+'</small>' : ''}</td>
          <td>${zoneBadge(r.zone_type)}</td>
          <td style="font-weight:700;color:${dbColor(avg)}">${avg.toFixed(1)} dB</td>
          <td>${r.max_db.toFixed(1)} dB</td>
          <td style="color:#ef4444;font-weight:700">${danger}</td>
          <td>${riskLevel}</td>
          <td>${maxExposure}</td></tr>`;
      }
      if (!riskHTML) riskHTML = '<tr><td colspan="7" style="text-align:center;color:#22c55e;font-weight:600">✅ No locations with concerning noise levels</td></tr>';
      const html = `${SKIP}
      <div class="card"><h3 style="margin:0 0 10px">👂 Hearing Protection Recommendations</h3>
        <p style="color:${GRAY};margin:0 0 12px">Locations where noise levels may pose hearing health risks (avg >70 dB, 30-day period).</p>
        <div style="overflow-x:auto"><table>
          <thead><tr><th>Location</th><th>Zone</th><th>Avg Level</th><th>Peak</th><th>Dangerous Readings (>85 dB)</th><th>Risk Level</th><th>Max Safe Exposure</th></tr></thead>
          <tbody>${riskHTML}</tbody></table></div>
      </div>
      <div class="card">
        <h3 style="margin:0 0 10px">📚 Noise Exposure Reference</h3>
        <table><thead><tr><th>Level (dB)</th><th>Example</th><th>Max Exposure</th><th>Risk</th></tr></thead>
        <tbody>
          <tr><td style="color:#22c55e;font-weight:700">0–40</td><td>Whisper, quiet library</td><td>Unlimited</td><td style="color:#22c55e">None</td></tr>
          <tr><td style="color:#22c55e;font-weight:700">40–55</td><td>Moderate rainfall, quiet office</td><td>Unlimited</td><td style="color:#22c55e">None</td></tr>
          <tr><td style="color:#f59e0b;font-weight:700">55–70</td><td>Normal conversation, classroom</td><td>Unlimited</td><td style="color:#f59e0b">Low</td></tr>
          <tr><td style="color:#f97316;font-weight:700">70–85</td><td>Busy traffic, cafeteria</td><td>8 hours</td><td style="color:#f97316">Moderate</td></tr>
          <tr><td style="color:#ef4444;font-weight:700">85–100</td><td>Lawn mower, gym class</td><td>2 hours</td><td style="color:#ef4444">High</td></tr>
          <tr><td style="color:#ef4444;font-weight:700">100–120</td><td>Power tools, concert</td><td>15 min</td><td style="color:#ef4444">Very High</td></tr>
          <tr><td style="color:#7f1d1d;font-weight:700">120+</td><td>Jet engine, explosion</td><td>Immediate damage</td><td style="color:#7f1d1d">Dangerous</td></tr>
        </tbody></table>
      </div>
      <div class="card">
        <h3 style="margin:0 0 10px">🛡️ Recommendations</h3>
        <ul style="line-height:2;color:${GRAY}">
          <li>Provide hearing protection (earplugs) for activities in zones above 85 dB</li>
          <li>Limit student exposure time in loud areas (gym, cafeteria, workshops)</li>
          <li>Install acoustic dampening panels in classrooms with average levels above 50 dB</li>
          <li>Consider noise-absorbing flooring in corridors and hallways</li>
          <li>Schedule noisy activities (PE, music) during non-quiet hours</li>
          <li>Conduct annual audiometric screening for students in high-noise programs</li>
        </ul>
      </div>
      <a href="/school/noise-monitor" class="btn" style="background:${GRAY};text-decoration:none">← Dashboard</a>`;
      renderPage(req, res, 'Hearing Protection', html, { activeTab: 'noise-monitor' });
    } catch(e) { ah(e, req, res); }
  });

  /* ─── Route 10: Sensor History ────────────────────────────── */
  app.get('/school/noise-monitor/history/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const sensor = await pool.query(`SELECT * FROM noise_sensors WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
      if (!sensor.rows.length) return res.redirect('/school/noise-monitor/sensors');
      const s = sensor.rows[0];
      const readings = await pool.query(`SELECT * FROM noise_readings WHERE sensor_id=$1 AND tenant_id=$2 ORDER BY recorded_at DESC LIMIT 50`, [req.params.id, tid]);
      let list = '';
      for (const r of readings.rows) {
        const db = parseFloat(r.decibel_level) || 0;
        list += `<tr><td>${new Date(r.recorded_at).toLocaleString()}</td>
          <td>${dbBadge(db)}</td>
          <td>${esc(r.frequency_band||'—')}</td>
          <td>${r.duration_sec ? Math.round(r.duration_sec/60)+' min' : '—'}</td>
          <td>${esc(r.notes||'—')}</td></tr>`;
      }
      const html = `${SKIP}
      <div class="card"><h3>History — ${esc(s.location)}${s.room_id ? ' ('+esc(s.room_id)+')' : ''}</h3>
        <p style="color:${GRAY};margin:4px 0 12px">${zoneBadge(s.zone_type)} | Model: ${esc(s.model||'N/A')}</p>
        <div style="overflow-x:auto"><table>
          <thead><tr><th>Time</th><th>Level</th><th>Frequency</th><th>Duration</th><th>Notes</th></tr></thead>
          <tbody>${list}</tbody></table></div>
      </div>
      <a href="/school/noise-monitor" class="btn" style="background:${GRAY};text-decoration:none">← Dashboard</a>`;
      renderPage(req, res, 'Sensor History', html, { activeTab: 'noise-monitor' });
    } catch(e) { ah(e, req, res); }
  });
};
