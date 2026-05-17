module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5', GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.btn:hover{background:#3730a3}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}</style>';

  (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS aq_sensors (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, location VARCHAR(200) NOT NULL,
        room_id VARCHAR(80), type VARCHAR(60) NOT NULL DEFAULT 'Indoor',
        status VARCHAR(20) NOT NULL DEFAULT 'active', model VARCHAR(100),
        firmware VARCHAR(60), last_calibrated DATE,
        last_reading TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS aq_readings (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, sensor_id INT REFERENCES aq_sensors(id),
        pm25 NUMERIC(6,1), pm10 NUMERIC(6,1), co2 NUMERIC(7,1),
        temperature NUMERIC(5,2), humidity NUMERIC(5,1),
        aqi INT, recorded_at TIMESTAMPTZ DEFAULT NOW(), notes TEXT
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS aq_alerts (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, sensor_id INT REFERENCES aq_sensors(id),
        parameter VARCHAR(60) NOT NULL, value NUMERIC(10,2), threshold NUMERIC(10,2),
        recommendation TEXT, severity VARCHAR(20) NOT NULL DEFAULT 'warning',
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ DEFAULT NOW(), acknowledged_at TIMESTAMPTZ, acknowledged_by VARCHAR(120)
      )`);
      console.log('[Mod] air-quality-monitor OK');
    } catch(e) { console.warn('[Mod] air-quality-monitor Warn:', e.message); }
  })();

  /* ─── Helpers ─────────────────────────────────────────────── */
  const aqiColor = (aqi) => {
    if (aqi <= 50) return '#22c55e';
    if (aqi <= 100) return '#f59e0b';
    if (aqi <= 150) return '#f97316';
    if (aqi <= 200) return '#ef4444';
    if (aqi <= 300) return '#a855f7';
    return '#7f1d1d';
  };
  const aqiLabel = (aqi) => {
    if (aqi <= 50) return 'Good';
    if (aqi <= 100) return 'Moderate';
    if (aqi <= 150) return 'Unhealthy (Sensitive)';
    if (aqi <= 200) return 'Unhealthy';
    if (aqi <= 300) return 'Very Unhealthy';
    return 'Hazardous';
  };
  const aqiBadge = (v) => {
    const aqi = parseInt(v) || 0;
    return `<span style="background:${aqiColor(aqi)};color:#fff;padding:4px 12px;border-radius:20px;font-weight:700;font-size:14px">${aqi} — ${aqiLabel(aqi)}</span>`;
  };
  const getBar = (pct, color) => {
    const c = color || (pct > 60 ? '#22c55e' : pct > 30 ? '#f59e0b' : '#ef4444');
    return `<div style="background:#e5e7eb;border-radius:6px;height:10px;width:100%"><div style="background:${c};height:10px;border-radius:6px;width:${Math.min(Math.max(pct,0),100)}%"></div></div>`;
  };
  const sevBadge = (s) => {
    const c = { info: '#3b82f6', warning: '#f59e0b', critical: '#ef4444', ok: '#22c55e' };
    return `<span style="background:${c[s]||'#6b7280'};color:#fff;padding:3px 10px;border-radius:20px;font-size:12px">${esc(s)}</span>`;
  };
  const paramStatus = (param, val) => {
    const ranges = {
      pm25: { good: 12, moderate: 35, bad: 55 },
      pm10: { good: 54, moderate: 154, bad: 254 },
      co2: { good: 800, moderate: 1000, bad: 1500 },
      temperature: { good: [20, 26], moderate: [18, 28] },
      humidity: { good: [30, 60], moderate: [25, 70] }
    };
    const r = ranges[param];
    if (!r) return GRAY;
    if (Array.isArray(r.good)) {
      if (val >= r.good[0] && val <= r.good[1]) return '#22c55e';
      if (val >= r.moderate[0] && val <= r.moderate[1]) return '#f59e0b';
      return '#ef4444';
    }
    if (val <= r.good) return '#22c55e';
    if (val <= r.moderate) return '#f59e0b';
    return '#ef4444';
  };

  /* ─── Route 1: Dashboard ──────────────────────────────────── */
  app.get('/school/air-quality', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const [sensorCount, activeAlerts, latestReadings, roomStats] = await Promise.all([
        pool.query(`SELECT COUNT(*) AS total, COUNT(CASE WHEN status='active' THEN 1 END) AS active FROM aq_sensors WHERE tenant_id=$1`, [tid]),
        pool.query(`SELECT COUNT(*) AS cnt FROM aq_alerts WHERE tenant_id=$1 AND status='active'`, [tid]),
        pool.query(`SELECT DISTINCT ON (ar.sensor_id) ar.*, s.location, s.room_id, s.type FROM aq_readings ar JOIN aq_sensors s ON s.id=ar.sensor_id WHERE s.tenant_id=$1 ORDER BY ar.sensor_id, ar.recorded_at DESC`, [tid]),
        pool.query(`SELECT s.location, s.room_id, AVG(ar.co2)::int AS avg_co2, AVG(ar.pm25)::numeric(5,1) AS avg_pm25, MAX(ar.aqi) AS max_aqi FROM aq_sensors s LEFT JOIN aq_readings ar ON ar.sensor_id=s.id WHERE s.tenant_id=$1 AND ar.recorded_at > NOW() - INTERVAL '24 hours' GROUP BY s.id ORDER BY max_aqi DESC NULLS LAST`, [tid])
      ]);
      const sCount = parseInt(sensorCount.rows[0]?.total) || 0;
      const sActive = parseInt(sensorCount.rows[0]?.active) || 0;
      const aCount = parseInt(activeAlerts.rows[0]?.cnt) || 0;
      let sensorHTML = '';
      for (const r of latestReadings.rows) {
        const aqi = r.aqi || 0;
        sensorHTML += `<tr><td><strong>${esc(r.location)}</strong>${r.room_id ? '<br><small style="color:'+GRAY+'">'+esc(r.room_id)+'</small>' : ''}</td>
          <td>${aqiBadge(aqi)}</td>
          <td style="color:${paramStatus('pm25', parseFloat(r.pm25||0))}">${r.pm25 ?? '—'}</td>
          <td style="color:${paramStatus('pm10', parseFloat(r.pm10||0))}">${r.pm10 ?? '—'}</td>
          <td style="color:${paramStatus('co2', parseFloat(r.co2||0))}">${r.co2 ?? '—'}</td>
          <td>${r.temperature ?? '—'}°C</td>
          <td>${r.humidity ?? '—'}%</td></tr>`;
      }
      const alertList = await pool.query(`SELECT aq.*, s.location, s.room_id FROM aq_alerts aq JOIN aq_sensors s ON s.id=aq.sensor_id WHERE aq.tenant_id=$1 AND aq.status='active' ORDER BY aq.created_at DESC LIMIT 8`, [tid]);
      let alertHTML = '';
      if (alertList.rows.length === 0) {
        alertHTML = '<tr><td colspan="5" style="text-align:center;color:#22c55e;font-weight:600">✅ All air quality parameters within safe limits</td></tr>';
      } else {
        for (const a of alertList.rows) {
          alertHTML += `<tr><td>${esc(a.location)}${a.room_id ? ' ('+esc(a.room_id)+')' : ''}</td>
            <td>${esc(a.parameter)}</td><td>${a.value} (threshold: ${a.threshold})</td>
            <td>${sevBadge(a.severity)}</td>
            <td><a href="/school/air-quality/alerts/ack/${a.id}" class="btn" style="font-size:11px;padding:3px 8px;background:#f59e0b">Ack</a></td></tr>`;
        }
      }
      const html = `${SKIP}
      <div class="card" style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;text-align:center">
        <div><div style="font-size:28px;font-weight:700;color:${P}">${sCount}</div><div style="color:${GRAY}">Sensors</div></div>
        <div><div style="font-size:28px;font-weight:700;color:#22c55e">${sActive}</div><div style="color:${GRAY}">Active</div></div>
        <div><div style="font-size:28px;font-weight:700;color:#ef4444">${aCount}</div><div style="color:${GRAY}">Active Alerts</div></div>
        <div><div style="font-size:28px;font-weight:700;color:#22c55e">${roomStats.rows.filter(r => (r.max_aqi||0) <= 50).length}/${roomStats.rows.length}</div><div style="color:${GRAY}">Rooms with Good AQI</div></div>
      </div>
      <div class="card"><h3 style="margin:0 0 10px">Latest Sensor Readings</h3>
        <div style="overflow-x:auto"><table><thead><tr><th>Location</th><th>AQI</th><th>PM2.5</th><th>PM10</th><th>CO₂ (ppm)</th><th>Temp</th><th>Humidity</th></tr></thead>
        <tbody>${sensorHTML}</tbody></table></div></div>
      <div class="card"><h3 style="margin:0 0 10px">⚠️ Active Alerts</h3>
        <div style="overflow-x:auto"><table><thead><tr><th>Location</th><th>Parameter</th><th>Value</th><th>Severity</th><th>Action</th></tr></thead>
        <tbody>${alertHTML}</tbody></table></div></div>
      <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
        <a href="/school/air-quality/sensors" class="btn" style="text-decoration:none">Manage Sensors</a>
        <a href="/school/air-quality/readings" class="btn" style="text-decoration:none;background:#22c55e">Record Reading</a>
        <a href="/school/air-quality/analytics" class="btn" style="text-decoration:none;background:#f59e0b">Analytics</a>
        <a href="/school/air-quality/alerts" class="btn" style="text-decoration:none;background:#ef4444">All Alerts</a>
        <a href="/school/air-quality/health" class="btn" style="text-decoration:none;background:#8b5cf6">Health Guide</a>
      </div>`;
      renderPage(req, res, 'Air Quality Monitor', html, { activeTab: 'air-quality' });
    } catch(e) { ah(e, req, res); }
  });

  /* ─── Route 2: Manage Sensors ─────────────────────────────── */
  app.get('/school/air-quality/sensors', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const rows = await pool.query(`SELECT * FROM aq_sensors WHERE tenant_id=$1 ORDER BY location`, [tid]);
      let list = '';
      for (const r of rows.rows) {
        list += `<tr><td>${r.id}</td><td>${esc(r.location)}</td><td>${esc(r.room_id||'—')}</td>
          <td>${esc(r.type)}</td><td>${esc(r.model||'—')}</td>
          <td><span style="color:${r.status==='active'?'#22c55e':'#ef4444'}">${esc(r.status)}</span></td>
          <td>${r.last_calibrated ? new Date(r.last_calibrated).toLocaleDateString() : '—'}</td>
          <td><a href="/school/air-quality/sensors/edit/${r.id}" class="btn" style="font-size:12px;padding:4px 10px">Edit</a>
          <form method="POST" action="/school/air-quality/sensors/delete" style="display:inline">
            <input type="hidden" name="id" value="${r.id}">
            <button class="btn" style="background:#ef4444;font-size:12px;padding:4px 10px" onclick="return confirm('Delete sensor?')">Del</button></form></td></tr>`;
      }
      const html = `${SKIP}
      <div class="card" style="display:flex;justify-content:space-between;align-items:center">
        <h3 style="margin:0">Air Quality Sensors</h3>
        <a href="/school/air-quality/sensors/add" class="btn" style="text-decoration:none">+ Add Sensor</a>
      </div>
      <div class="card"><div style="overflow-x:auto"><table>
        <thead><tr><th>ID</th><th>Location</th><th>Room</th><th>Type</th><th>Model</th><th>Status</th><th>Calibrated</th><th>Actions</th></tr></thead>
        <tbody>${list}</tbody></table></div></div>
      <a href="/school/air-quality" class="btn" style="background:${GRAY};text-decoration:none">← Dashboard</a>`;
      renderPage(req, res, 'AQ Sensors', html, { activeTab: 'air-quality' });
    } catch(e) { ah(e, req, res); }
  });

  /* ─── Route 3: Add Sensor ─────────────────────────────────── */
  app.get('/school/air-quality/sensors/add', requireAuth, requireNotBanned, (req, res) => {
    const html = `${SKIP}
    <div class="card"><h3>Add Air Quality Sensor</h3>
      <form method="POST" action="/school/air-quality/sensors/add" style="display:grid;gap:12px;max-width:550px">
        <label>Location <input name="location" required placeholder="e.g. Building A, Floor 2"></label>
        <label>Room ID <input name="room_id" placeholder="e.g. R-201"></label>
        <label>Type <select name="type"><option>Indoor</option><option>Outdoor</option><option>HVAC</option><option>Laboratory</option></select></label>
        <label>Model <input name="model" placeholder="e.g. SenseAir S8"></label>
        <label>Firmware Version <input name="firmware" placeholder="e.g. v2.1.3"></label>
        <label>Last Calibrated <input type="date" name="last_calibrated"></label>
        <button type="submit" class="btn">Add Sensor</button>
        <a href="/school/air-quality/sensors" class="btn" style="background:${GRAY};text-decoration:none;text-align:center">Cancel</a>
      </form>
    </div>`;
    renderPage(req, res, 'Add AQ Sensor', html, { activeTab: 'air-quality' });
  });

  app.post('/school/air-quality/sensors/add', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { location, room_id, type, model, firmware, last_calibrated } = req.body;
      const tid = req.user.tenant_id;
      await pool.query(`INSERT INTO aq_sensors (tenant_id,location,room_id,type,model,firmware,last_calibrated) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [tid, location, room_id, type, model, firmware, last_calibrated||null]);
      audit(req, 'aq_sensor_add', { location, type });
      req.flash('success', 'Sensor added');
      res.redirect('/school/air-quality/sensors');
    } catch(e) { ah(e, req, res); }
  });

  /* ─── Edit Sensor ─────────────────────────────────────────── */
  app.get('/school/air-quality/sensors/edit/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const s = await pool.query(`SELECT * FROM aq_sensors WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
      if (!s.rows.length) return res.redirect('/school/air-quality/sensors');
      const r = s.rows[0];
      const html = `${SKIP}
      <div class="card"><h3>Edit Sensor #${r.id}</h3>
        <form method="POST" action="/school/air-quality/sensors/edit/${r.id}" style="display:grid;gap:12px;max-width:550px">
          <label>Location <input name="location" value="${esc(r.location)}" required></label>
          <label>Room ID <input name="room_id" value="${esc(r.room_id||'')}"></label>
          <label>Type <select name="type"><option ${r.type==='Indoor'?'selected':''}>Indoor</option><option ${r.type==='Outdoor'?'selected':''}>Outdoor</option><option ${r.type==='HVAC'?'selected':''}>HVAC</option><option ${r.type==='Laboratory'?'selected':''}>Laboratory</option></select></label>
          <label>Model <input name="model" value="${esc(r.model||'')}"></label>
          <label>Firmware <input name="firmware" value="${esc(r.firmware||'')}"></label>
          <label>Last Calibrated <input type="date" name="last_calibrated" value="${r.last_calibrated||''}"></label>
          <label>Status <select name="status"><option value="active" ${r.status==='active'?'selected':''}>Active</option><option value="inactive" ${r.status==='inactive'?'selected':''}>Inactive</option><option value="maintenance" ${r.status==='maintenance'?'selected':''}>Maintenance</option></select></label>
          <button type="submit" class="btn">Update</button>
          <a href="/school/air-quality/sensors" class="btn" style="background:${GRAY};text-decoration:none;text-align:center">Cancel</a>
        </form>
      </div>`;
      renderPage(req, res, 'Edit Sensor', html, { activeTab: 'air-quality' });
    } catch(e) { ah(e, req, res); }
  });

  app.post('/school/air-quality/sensors/edit/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { location, room_id, type, model, firmware, last_calibrated, status } = req.body;
      const tid = req.user.tenant_id;
      await pool.query(`UPDATE aq_sensors SET location=$1,room_id=$2,type=$3,model=$4,firmware=$5,last_calibrated=$6,status=$7 WHERE id=$8 AND tenant_id=$9`, [location, room_id, type, model, firmware, last_calibrated||null, status, req.params.id, tid]);
      audit(req, 'aq_sensor_edit', { id: req.params.id });
      req.flash('success', 'Sensor updated');
      res.redirect('/school/air-quality/sensors');
    } catch(e) { ah(e, req, res); }
  });

  /* ─── Delete Sensor ───────────────────────────────────────── */
  app.post('/school/air-quality/sensors/delete', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      await pool.query(`DELETE FROM aq_alerts WHERE sensor_id=$1 AND tenant_id=$2`, [req.body.id, tid]);
      await pool.query(`DELETE FROM aq_readings WHERE sensor_id=$1 AND tenant_id=$2`, [req.body.id, tid]);
      await pool.query(`DELETE FROM aq_sensors WHERE id=$1 AND tenant_id=$2`, [req.body.id, tid]);
      audit(req, 'aq_sensor_delete', { id: req.body.id });
      req.flash('success', 'Sensor deleted');
      res.redirect('/school/air-quality/sensors');
    } catch(e) { ah(e, req, res); }
  });

  /* ─── Route 4: Record Reading ─────────────────────────────── */
  app.get('/school/air-quality/readings', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const sensors = await pool.query(`SELECT id, location, room_id FROM aq_sensors WHERE tenant_id=$1 AND status='active' ORDER BY location`, [tid]);
      let optHTML = '';
      for (const s of sensors.rows) optHTML += `<option value="${s.id}">${esc(s.location)}${s.room_id ? ' ('+esc(s.room_id)+')' : ''}</option>`;
      const html = `${SKIP}
      <div class="card"><h3>Record Air Quality Reading</h3>
        <form method="POST" action="/school/air-quality/readings" style="display:grid;gap:12px;max-width:600px">
          <label>Sensor <select name="sensor_id" required><option value="">Select sensor...</option>${optHTML}</select></label>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <label>PM2.5 (µg/m³, ≤12 good) <input type="number" name="pm25" step="0.1" min="0"></label>
            <label>PM10 (µg/m³, ≤54 good) <input type="number" name="pm10" step="0.1" min="0"></label>
            <label>CO₂ (ppm, ≤800 good) <input type="number" name="co2" step="0.1" min="0"></label>
            <label>Temperature (°C) <input type="number" name="temperature" step="0.1"></label>
            <label>Humidity (%) <input type="number" name="humidity" step="0.1" min="0" max="100"></label>
            <label>AQI (0–500) <input type="number" name="aqi" min="0" max="500"></label>
          </div>
          <label>Notes <textarea name="notes" rows="3"></textarea></label>
          <button type="submit" class="btn">Submit Reading</button>
          <a href="/school/air-quality" class="btn" style="background:${GRAY};text-decoration:none;text-align:center">Cancel</a>
        </form>
      </div>`;
      renderPage(req, res, 'Record AQ Reading', html, { activeTab: 'air-quality' });
    } catch(e) { ah(e, req, res); }
  });

  app.post('/school/air-quality/readings', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { sensor_id, pm25, pm10, co2, temperature, humidity, aqi, notes } = req.body;
      const tid = req.user.tenant_id;
      await pool.query(`INSERT INTO aq_readings (tenant_id,sensor_id,pm25,pm10,co2,temperature,humidity,aqi,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [tid, parseInt(sensor_id), pm25||null, pm10||null, co2||null, temperature||null, humidity||null, aqi||null, notes]);
      await pool.query(`UPDATE aq_sensors SET last_reading=NOW() WHERE id=$1 AND tenant_id=$2`, [sensor_id, tid]);
      const checks = [
        { key: 'pm25', val: parseFloat(pm25), warn: 35, crit: 55, param: 'PM2.5', unit: 'µg/m³', rec: 'Open windows, run air purifiers' },
        { key: 'pm10', val: parseFloat(pm10), warn: 154, crit: 254, param: 'PM10', unit: 'µg/m³', rec: 'Reduce outdoor activities, close windows' },
        { key: 'co2', val: parseFloat(co2), warn: 1000, crit: 1500, param: 'CO₂', unit: 'ppm', rec: 'Increase ventilation, open doors/windows' }
      ];
      for (const c of checks) {
        if (!c.val) continue;
        const sev = c.val >= c.crit ? 'critical' : c.val >= c.warn ? 'warning' : null;
        if (sev) {
          const thresh = c.val >= c.crit ? c.crit : c.warn;
          await pool.query(`INSERT INTO aq_alerts (tenant_id,sensor_id,parameter,value,threshold,recommendation,severity) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [tid, parseInt(sensor_id), c.param, c.val, thresh, c.rec, sev]);
          if (sev === 'critical') {
            queueEmail(tid, { subject: 'CRITICAL: Air Quality Alert — ' + c.param + ' ' + c.val + c.unit, body: `${c.param} at ${c.val}${c.unit} exceeds threshold. ${c.rec}` });
          }
        }
      }
      audit(req, 'aq_reading_add', { sensor_id, pm25, pm10, co2, aqi });
      req.flash('success', 'Reading recorded');
      res.redirect('/school/air-quality');
    } catch(e) { ah(e, req, res); }
  });

  /* ─── Route 5: Alert Management ───────────────────────────── */
  app.get('/school/air-quality/alerts', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const sf = req.query.status || 'active';
      let where = 'WHERE a.tenant_id=$1';
      const params = [tid];
      if (sf !== 'all') { where += ' AND a.status=$2'; params.push(sf); }
      const alerts = await pool.query(`SELECT a.*, s.location, s.room_id FROM aq_alerts a JOIN aq_sensors s ON s.id=a.sensor_id ${where} ORDER BY a.created_at DESC LIMIT 60`, params);
      let list = '';
      for (const a of alerts.rows) {
        list += `<tr><td>${a.id}</td><td>${esc(a.location)}${a.room_id ? ' ('+esc(a.room_id)+')' : ''}</td>
          <td>${esc(a.parameter)}</td><td>${a.value}</td><td>${a.threshold}</td>
          <td>${sevBadge(a.severity)}</td><td><span style="color:${a.status==='active'?'#ef4444':'#22c55e'}">${esc(a.status)}</span></td>
          <td>${a.recommendation ? esc(a.recommendation.slice(0,40))+'...' : '—'}</td>
          <td>${a.status === 'active' ? `<a href="/school/air-quality/alerts/ack/${a.id}" class="btn" style="font-size:11px;padding:3px 8px">Ack</a>` : esc(a.acknowledged_by||'—')}</td></tr>`;
      }
      const html = `${SKIP}
      <div class="card" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
        <h3 style="margin:0">Air Quality Alerts</h3>
        <div style="display:flex;gap:6px">
          <a href="/school/air-quality/alerts?status=active" class="btn" style="font-size:12px;padding:4px 10px;${sf==='active'?'background:#ef4444':''}">Active</a>
          <a href="/school/air-quality/alerts?status=acknowledged" class="btn" style="font-size:12px;padding:4px 10px;${sf==='acknowledged'?'background:#f59e0b':''}">Acknowledged</a>
          <a href="/school/air-quality/alerts?status=all" class="btn" style="font-size:12px;padding:4px 10px;${sf==='all'?'background:#3730a3':''}">All</a>
        </div>
      </div>
      <div class="card"><div style="overflow-x:auto"><table>
        <thead><tr><th>ID</th><th>Location</th><th>Parameter</th><th>Value</th><th>Threshold</th><th>Severity</th><th>Status</th><th>Recommendation</th><th>Action</th></tr></thead>
        <tbody>${list}</tbody></table></div></div>
      <a href="/school/air-quality" class="btn" style="background:${GRAY};text-decoration:none">← Dashboard</a>`;
      renderPage(req, res, 'Air Quality Alerts', html, { activeTab: 'air-quality' });
    } catch(e) { ah(e, req, res); }
  });

  app.get('/school/air-quality/alerts/ack/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      await pool.query(`UPDATE aq_alerts SET status='acknowledged',acknowledged_at=NOW(),acknowledged_by=$1 WHERE id=$2 AND tenant_id=$3`, [req.user.name||req.user.email, req.params.id, tid]);
      audit(req, 'aq_alert_ack', { id: req.params.id });
      req.flash('success', 'Alert acknowledged');
      res.redirect('/school/air-quality/alerts');
    } catch(e) { ah(e, req, res); }
  });

  /* ─── Route 6: Analytics ──────────────────────────────────── */
  app.get('/school/air-quality/analytics', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const days = parseInt(req.query.days) || 7;
      const dailyStats = await pool.query(`
        SELECT DATE(ar.recorded_at) AS day,
          AVG(ar.pm25)::numeric(5,1) AS avg_pm25,
          MAX(ar.pm25)::numeric(5,1) AS max_pm25,
          AVG(ar.co2)::int AS avg_co2,
          MAX(ar.co2)::int AS max_co2,
          AVG(ar.aqi)::int AS avg_aqi,
          MAX(ar.aqi) AS max_aqi,
          COUNT(ar.id) AS readings
        FROM aq_readings ar JOIN aq_sensors s ON s.id=ar.sensor_id
        WHERE s.tenant_id=$1 AND ar.recorded_at > NOW() - INTERVAL '${days} days'
        GROUP BY DATE(ar.recorded_at) ORDER BY day`, [tid]);
      const roomRanking = await pool.query(`
        SELECT s.location, s.room_id,
          AVG(ar.aqi)::int AS avg_aqi, AVG(ar.co2)::int AS avg_co2, AVG(ar.pm25)::numeric(5,1) AS avg_pm25
        FROM aq_sensors s JOIN aq_readings ar ON ar.sensor_id=s.id
        WHERE s.tenant_id=$1 AND ar.recorded_at > NOW() - INTERVAL '${days} days'
        GROUP BY s.id ORDER BY avg_aqi ASC`, [tid]);
      let dailyHTML = '';
      for (const d of dailyStats.rows) {
        const aqi = parseInt(d.avg_aqi) || 0;
        dailyHTML += `<tr><td>${new Date(d.day).toLocaleDateString()}</td>
          <td>${aqiBadge(aqi)}</td>
          <td>${d.avg_pm25 ?? '—'}</td><td>${d.max_pm25 ?? '—'}</td>
          <td>${d.avg_co2 ?? '—'} ppm</td><td>${d.max_co2 ?? '—'} ppm</td>
          <td>${d.readings}</td></tr>`;
      }
      let roomHTML = '';
      for (const r of roomRanking.rows) {
        const aqi = parseInt(r.avg_aqi) || 0;
        roomHTML += `<tr><td>${esc(r.location)}${r.room_id ? ' ('+esc(r.room_id)+')' : ''}</td>
          <td>${aqiBadge(aqi)}</td><td>${r.avg_co2} ppm</td><td>${r.avg_pm25} µg/m³</td></tr>`;
      }
      const html = `${SKIP}
      <div class="card" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
        <h3 style="margin:0">Air Quality Analytics</h3>
        <div style="display:flex;gap:6px">
          <a href="/school/air-quality/analytics?days=7" class="btn" style="font-size:12px;padding:4px 10px;${days===7?'background:#3730a3':''}">7d</a>
          <a href="/school/air-quality/analytics?days=30" class="btn" style="font-size:12px;padding:4px 10px;${days===30?'background:#3730a3':''}">30d</a>
          <a href="/school/air-quality/analytics?days=90" class="btn" style="font-size:12px;padding:4px 10px;${days===90?'background:#3730a3':''}">90d</a>
        </div>
      </div>
      <div class="card"><h3 style="margin:0 0 10px">Daily Summary</h3>
        <div style="overflow-x:auto"><table><thead><tr><th>Date</th><th>Avg AQI</th><th>Avg PM2.5</th><th>Max PM2.5</th><th>Avg CO₂</th><th>Max CO₂</th><th>Readings</th></tr></thead>
        <tbody>${dailyHTML}</tbody></table></div></div>
      <div class="card"><h3 style="margin:0 0 10px">Room Ranking (Best to Worst)</h3>
        <div style="overflow-x:auto"><table><thead><tr><th>Location</th><th>Avg AQI</th><th>Avg CO₂</th><th>Avg PM2.5</th></tr></thead>
        <tbody>${roomHTML}</tbody></table></div></div>
      <a href="/school/air-quality" class="btn" style="background:${GRAY};text-decoration:none">← Dashboard</a>`;
      renderPage(req, res, 'Air Quality Analytics', html, { activeTab: 'air-quality' });
    } catch(e) { ah(e, req, res); }
  });

  /* ─── Route 7: Health Recommendations ─────────────────────── */
  app.get('/school/air-quality/health', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const latest = await pool.query(`
        SELECT DISTINCT ON (ar.sensor_id) ar.*, s.location, s.room_id, s.type
        FROM aq_readings ar JOIN aq_sensors s ON s.id=ar.sensor_id
        WHERE s.tenant_id=$1 AND s.status='active'
        ORDER BY ar.sensor_id, ar.recorded_at DESC`, [tid]);
      let recsHTML = '';
      for (const r of latest.rows) {
        const recs = [];
        const pm25 = parseFloat(r.pm25) || 0;
        const co2 = parseFloat(r.co2) || 0;
        const temp = parseFloat(r.temperature) || 0;
        const hum = parseFloat(r.humidity) || 0;
        if (pm25 > 35) recs.push('<span style="color:#ef4444">🔴 High PM2.5 — use air purifiers, reduce outdoor exposure</span>');
        else if (pm25 > 12) recs.push('<span style="color:#f59e0b">🟡 Moderate PM2.5 — sensitive groups limit outdoor activity</span>');
        else recs.push('<span style="color:#22c55e">🟢 PM2.5 levels are good</span>');
        if (co2 > 1500) recs.push('<span style="color:#ef4444">🔴 High CO₂ — immediately increase ventilation</span>');
        else if (co2 > 1000) recs.push('<span style="color:#f59e0b">🟡 Elevated CO₂ — open windows between classes</span>');
        else recs.push('<span style="color:#22c55e">🟢 CO₂ levels are adequate</span>');
        if (temp < 18 || temp > 28) recs.push('<span style="color:#ef4444">🔴 Temperature outside comfort zone (18–26°C)</span>');
        else recs.push('<span style="color:#22c55e">🟢 Temperature is comfortable</span>');
        if (hum < 30 || hum > 60) recs.push('<span style="color:#f59e0b">🟡 Humidity outside ideal range (30–60%)</span>');
        else recs.push('<span style="color:#22c55e">🟢 Humidity is optimal</span>');
        recsHTML += `<tr><td><strong>${esc(r.location)}</strong>${r.room_id ? '<br><small>'+esc(r.room_id)+'</small>' : ''}</td>
          <td>${recs.join('<br>')}</td></tr>`;
      }
      const html = `${SKIP}
      <div class="card"><h3 style="margin:0 0 10px">🏥 Health Recommendations by Location</h3>
        <p style="color:${GRAY};margin:0 0 12px">Based on the latest sensor readings, here are recommended actions for each area.</p>
        <div style="overflow-x:auto"><table>
          <thead><tr><th>Location</th><th>Recommendations</th></tr></thead>
          <tbody>${recsHTML}</tbody></table></div>
      </div>
      <div class="card">
        <h3 style="margin:0 0 10px">📚 Quick Reference Guide</h3>
        <table><thead><tr><th>Parameter</th><th>Good</th><th>Moderate</th><th>Unhealthy</th></tr></thead>
        <tbody>
          <tr><td>PM2.5 (µg/m³)</td><td style="color:#22c55e">0–12</td><td style="color:#f59e0b">12.1–35.4</td><td style="color:#ef4444">35.5+</td></tr>
          <tr><td>PM10 (µg/m³)</td><td style="color:#22c55e">0–54</td><td style="color:#f59e0b">55–154</td><td style="color:#ef4444">155+</td></tr>
          <tr><td>CO₂ (ppm)</td><td style="color:#22c55e">0–800</td><td style="color:#f59e0b">801–1000</td><td style="color:#ef4444">1000+</td></tr>
          <tr><td>Temperature (°C)</td><td style="color:#22c55e">20–26</td><td style="color:#f59e0b">18–28</td><td style="color:#ef4444">&lt;18 or &gt;28</td></tr>
          <tr><td>Humidity (%)</td><td style="color:#22c55e">30–60</td><td style="color:#f59e0b">25–70</td><td style="color:#ef4444">&lt;25 or &gt;70</td></tr>
        </tbody></table>
      </div>
      <a href="/school/air-quality" class="btn" style="background:${GRAY};text-decoration:none">← Dashboard</a>`;
      renderPage(req, res, 'Health Recommendations', html, { activeTab: 'air-quality' });
    } catch(e) { ah(e, req, res); }
  });

  /* ─── Route 8: Sensor History ─────────────────────────────── */
  app.get('/school/air-quality/history/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const sensor = await pool.query(`SELECT * FROM aq_sensors WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
      if (!sensor.rows.length) return res.redirect('/school/air-quality/sensors');
      const s = sensor.rows[0];
      const readings = await pool.query(`SELECT * FROM aq_readings WHERE sensor_id=$1 AND tenant_id=$2 ORDER BY recorded_at DESC LIMIT 50`, [req.params.id, tid]);
      let list = '';
      for (const r of readings.rows) {
        list += `<tr><td>${new Date(r.recorded_at).toLocaleString()}</td>
          <td>${r.aqi ? aqiBadge(r.aqi) : '—'}</td>
          <td style="color:${paramStatus('pm25', parseFloat(r.pm25||0))}">${r.pm25 ?? '—'}</td>
          <td style="color:${paramStatus('pm10', parseFloat(r.pm10||0))}">${r.pm10 ?? '—'}</td>
          <td style="color:${paramStatus('co2', parseFloat(r.co2||0))}">${r.co2 ?? '—'}</td>
          <td>${r.temperature ?? '—'}°C</td><td>${r.humidity ?? '—'}%</td></tr>`;
      }
      const html = `${SKIP}
      <div class="card"><h3>History — ${esc(s.location)}${s.room_id ? ' ('+esc(s.room_id)+')' : ''}</h3>
        <div style="overflow-x:auto"><table>
          <thead><tr><th>Time</th><th>AQI</th><th>PM2.5</th><th>PM10</th><th>CO₂</th><th>Temp</th><th>Humidity</th></tr></thead>
          <tbody>${list}</tbody></table></div>
      </div>
      <a href="/school/air-quality" class="btn" style="background:${GRAY};text-decoration:none">← Dashboard</a>`;
      renderPage(req, res, 'Sensor History', html, { activeTab: 'air-quality' });
    } catch(e) { ah(e, req, res); }
  });

  /* ─── Route 9: Ventilation Control ────────────────────────── */
  app.get('/school/air-quality/ventilation', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const rooms = await pool.query(`
        SELECT s.id, s.location, s.room_id, s.type,
          ar.co2, ar.aqi, ar.pm25, ar.temperature, ar.humidity, ar.recorded_at
        FROM aq_sensors s
        LEFT JOIN LATERAL (
          SELECT co2, aqi, pm25, temperature, humidity, recorded_at
          FROM aq_readings WHERE sensor_id=s.id ORDER BY recorded_at DESC LIMIT 1
        ) ar ON true
        WHERE s.tenant_id=$1 AND s.status='active'
        ORDER BY ar.co2 DESC NULLS LAST`, [tid]);
      let rows = '';
      for (const r of rooms.rows) {
        const co2 = parseFloat(r.co2) || 0;
        let action = '—';
        let actionColor = '#22c55e';
        if (co2 > 1500) { action = '🔴 URGENT: Open all windows/doors, activate exhaust fans'; actionColor = '#ef4444'; }
        else if (co2 > 1000) { action = '🟡 Open windows during breaks, check HVAC'; actionColor = '#f59e0b'; }
        else if (co2 > 800) { action = '🟢 Normal; monitor between classes'; actionColor = '#22c55e'; }
        else { action = '🟢 Excellent ventilation'; actionColor = '#22c55e'; }
        rows += `<tr><td>${esc(r.location)}${r.room_id ? '<br><small>'+esc(r.room_id)+'</small>' : ''}</td>
          <td style="color:${co2>1000?'#ef4444':co2>800?'#f59e0b':'#22c55e'};font-weight:700">${r.co2 ?? '—'} ppm</td>
          <td>${r.aqi ? aqiBadge(r.aqi) : '—'}</td>
          <td style="color:${actionColor}">${action}</td></tr>`;
      }
      const html = `${SKIP}
      <div class="card"><h3 style="margin:0 0 10px">💨 Ventilation Control Recommendations</h3>
        <p style="color:${GRAY};margin:0 0 12px">CO₂ levels directly indicate ventilation effectiveness. Above 1000 ppm, action is needed.</p>
        <div style="overflow-x:auto"><table>
          <thead><tr><th>Room</th><th>CO₂ Level</th><th>AQI</th><th>Recommended Action</th></tr></thead>
          <tbody>${rows}</tbody></table></div>
      </div>
      <a href="/school/air-quality" class="btn" style="background:${GRAY};text-decoration:none">← Dashboard</a>`;
      renderPage(req, res, 'Ventilation Control', html, { activeTab: 'air-quality' });
    } catch(e) { ah(e, req, res); }
  });

  /* ─── Route 10: Compliance Report ─────────────────────────── */
  app.get('/school/air-quality/compliance', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const days = parseInt(req.query.days) || 30;
      const data = await pool.query(`
        SELECT s.location, s.room_id,
          COUNT(ar.id) AS total,
          COUNT(CASE WHEN ar.aqi <= 50 THEN 1 END) AS good,
          COUNT(CASE WHEN ar.aqi > 50 AND ar.aqi <= 100 THEN 1 END) AS moderate,
          COUNT(CASE WHEN ar.aqi > 100 THEN 1 END) AS unhealthy,
          COUNT(CASE WHEN ar.co2 <= 1000 THEN 1 END) AS co2_ok
        FROM aq_sensors s
        LEFT JOIN aq_readings ar ON ar.sensor_id=s.id
          AND ar.recorded_at > NOW() - INTERVAL '${days} days'
        WHERE s.tenant_id=$1 AND s.status='active'
        GROUP BY s.id ORDER BY s.location`, [tid]);
      let rows = '';
      for (const d of data.rows) {
        const tot = parseInt(d.total) || 0;
        const goodPct = tot > 0 ? Math.round((parseInt(d.good)/tot)*100) : 0;
        const modPct = tot > 0 ? Math.round((parseInt(d.moderate)/tot)*100) : 0;
        const unPct = tot > 0 ? Math.round((parseInt(d.unhealthy)/tot)*100) : 0;
        const co2Pct = tot > 0 ? Math.round((parseInt(d.co2_ok)/tot)*100) : 0;
        rows += `<tr><td>${esc(d.location)}${d.room_id ? ' ('+esc(d.room_id)+')' : ''}</td>
          <td>${tot}</td>
          <td>${getBar(goodPct,'#22c55e')} ${goodPct}%</td>
          <td>${getBar(modPct,'#f59e0b')} ${modPct}%</td>
          <td>${getBar(unPct,'#ef4444')} ${unPct}%</td>
          <td>${getBar(co2Pct)} ${co2Pct}%</td></tr>`;
      }
      const html = `${SKIP}
      <div class="card" style="display:flex;justify-content:space-between;align-items:center">
        <h3 style="margin:0">Air Quality Compliance Report</h3>
        <div style="display:flex;gap:6px">
          <a href="/school/air-quality/compliance?days=7" class="btn" style="font-size:12px;padding:4px 10px;${days===7?'background:#3730a3':''}">7d</a>
          <a href="/school/air-quality/compliance?days=30" class="btn" style="font-size:12px;padding:4px 10px;${days===30?'background:#3730a3':''}">30d</a>
          <a href="/school/air-quality/compliance?days=90" class="btn" style="font-size:12px;padding:4px 10px;${days===90?'background:#3730a3':''}">90d</a>
        </div>
      </div>
      <div class="card">
        <p style="color:${GRAY};margin:0 0 10px">Standards: AQI ≤50 Good | CO₂ ≤1000 ppm | WHO guidelines</p>
        <div style="overflow-x:auto"><table>
          <thead><tr><th>Room</th><th>Readings</th><th>Good AQI %</th><th>Moderate %</th><th>Unhealthy %</th><th>CO₂ OK %</th></tr></thead>
          <tbody>${rows}</tbody></table></div>
      </div>
      <a href="/school/air-quality" class="btn" style="background:${GRAY};text-decoration:none">← Dashboard</a>`;
      renderPage(req, res, 'Compliance Report', html, { activeTab: 'air-quality' });
    } catch(e) { ah(e, req, res); }
  });
};
