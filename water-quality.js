module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5', GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.btn:hover{background:#3730a3}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}</style>';

  (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS water_sources (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, name VARCHAR(150) NOT NULL,
        location VARCHAR(200) NOT NULL, type VARCHAR(60) NOT NULL DEFAULT 'Tap',
        filter_type VARCHAR(100), status VARCHAR(20) NOT NULL DEFAULT 'active',
        last_filter_change DATE, created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS water_readings (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, source_id INT REFERENCES water_sources(id),
        ph_level NUMERIC(4,2), turbidity NUMERIC(6,2), chlorine_ppm NUMERIC(5,2),
        tds_ppm INT, temperature NUMERIC(5,2), sampled_by VARCHAR(120),
        sampled_at TIMESTAMPTZ DEFAULT NOW(), notes TEXT
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS water_alerts (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, source_id INT REFERENCES water_sources(id),
        parameter VARCHAR(60) NOT NULL, value NUMERIC(10,2), threshold NUMERIC(10,2),
        severity VARCHAR(20) NOT NULL DEFAULT 'warning', status VARCHAR(20) NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ DEFAULT NOW(), acknowledged_at TIMESTAMPTZ, acknowledged_by VARCHAR(120)
      )`);
      console.log('[Mod] water-quality OK');
    } catch(e) { console.warn('[Mod] water-quality Warn:', e.message); }
  })();

  /* ─── Helpers ─────────────────────────────────────────────── */
  const paramColor = (param, val) => {
    const ranges = {
      ph_level:       { ok: [6.5, 8.5], warn: [6.0, 9.0] },
      turbidity:      { ok: [0, 4], warn: [0, 5] },
      chlorine_ppm:   { ok: [0.2, 2.0], warn: [0.1, 4.0] },
      tds_ppm:        { ok: [0, 500], warn: [0, 600] },
      temperature:    { ok: [15, 25], warn: [10, 30] }
    };
    const r = ranges[param];
    if (!r) return '#6b7280';
    if (val >= r.ok[0] && val <= r.ok[1]) return '#22c55e';
    if (val >= r.warn[0] && val <= r.warn[1]) return '#f59e0b';
    return '#ef4444';
  };
  const sevBadge = (s) => {
    const c = { info: '#3b82f6', warning: '#f59e0b', critical: '#ef4444', ok: '#22c55e' };
    return `<span style="background:${c[s]||'#6b7280'};color:#fff;padding:3px 10px;border-radius:20px;font-size:12px">${esc(s)}</span>`;
  };
  const getBar = (pct, color) => {
    const c = color || (pct > 60 ? '#22c55e' : pct > 30 ? '#f59e0b' : '#ef4444');
    return `<div style="background:#e5e7eb;border-radius:6px;height:10px;width:100%"><div style="background:${c};height:10px;border-radius:6px;width:${Math.min(Math.max(pct,0),100)}%"></div></div>`;
  };
  const fmtParam = (p, v) => {
    const units = { ph_level: '', turbidity: ' NTU', chlorine_ppm: ' ppm', tds_ppm: ' ppm', temperature: ' °C' };
    return (v !== null && v !== undefined) ? parseFloat(v).toFixed(2) + (units[p]||'') : '—';
  };

  /* ─── Route 1: Dashboard ──────────────────────────────────── */
  app.get('/school/water-quality', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const [sources, activeAlerts, latestReadings] = await Promise.all([
        pool.query(`SELECT COUNT(*) AS total, COUNT(CASE WHEN status='active' THEN 1 END) AS active FROM water_sources WHERE tenant_id=$1`, [tid]),
        pool.query(`SELECT COUNT(*) AS cnt FROM water_alerts WHERE tenant_id=$1 AND status='active'`, [tid]),
        pool.query(`SELECT DISTINCT ON (wr.source_id) wr.*, ws.name, ws.location FROM water_readings wr JOIN water_sources ws ON ws.id=wr.source_id WHERE ws.tenant_id=$1 ORDER BY wr.source_id, wr.sampled_at DESC`, [tid])
      ]);
      const srcTotal = parseInt(sources.rows[0]?.total) || 0;
      const srcActive = parseInt(sources.rows[0]?.active) || 0;
      const alertCount = parseInt(activeAlerts.rows[0]?.cnt) || 0;
      let readHTML = '';
      for (const r of latestReadings.rows) {
        const cells = ['ph_level','turbidity','chlorine_ppm','tds_ppm','temperature'];
        readHTML += `<tr><td><strong>${esc(r.name)}</strong><br><small style="color:${GRAY}">${esc(r.location)}</small></td>`;
        for (const c of cells) {
          const v = r[c];
          const col = v !== null && v !== undefined ? paramColor(c, parseFloat(v)) : GRAY;
          readHTML += `<td style="color:${col};font-weight:600">${fmtParam(c, v)}</td>`;
        }
        readHTML += `<td>${r.sampled_at ? new Date(r.sampled_at).toLocaleDateString() : '—'}</td></tr>`;
      }
      const alerts = await pool.query(`SELECT wa.*, ws.name, ws.location FROM water_alerts wa JOIN water_sources ws ON ws.id=wa.source_id WHERE wa.tenant_id=$1 AND wa.status='active' ORDER BY wa.created_at DESC LIMIT 10`, [tid]);
      let alertHTML = '';
      if (alerts.rows.length === 0) {
        alertHTML = '<tr><td colspan="5" style="text-align:center;color:#22c55e;font-weight:600">✅ All water sources within safe limits</td></tr>';
      } else {
        for (const a of alerts.rows) {
          alertHTML += `<tr><td>${esc(a.name)}</td><td>${esc(a.parameter)}</td>
            <td>${fmtParam(a.parameter, a.value)} vs ${fmtParam(a.parameter, a.threshold)}</td>
            <td>${sevBadge(a.severity)}</td>
            <td><a href="/school/water-quality/alerts/acknowledge/${a.id}" class="btn" style="font-size:11px;padding:3px 8px">Acknowledge</a></td></tr>`;
        }
      }
      const html = `${SKIP}
      <div class="card" style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;text-align:center">
        <div><div style="font-size:28px;font-weight:700;color:${P}">${srcTotal}</div><div style="color:${GRAY}">Water Sources</div></div>
        <div><div style="font-size:28px;font-weight:700;color:#22c55e">${srcActive}</div><div style="color:${GRAY}">Active Sources</div></div>
        <div><div style="font-size:28px;font-weight:700;color:#ef4444">${alertCount}</div><div style="color:${GRAY}">Active Alerts</div></div>
        <div><div style="font-size:28px;font-weight:700;color:${P}">${latestReadings.rows.length}</div><div style="color:${GRAY}">Latest Readings</div></div>
      </div>
      <div class="card"><h3 style="margin:0 0 10px">Latest Readings</h3>
        <div style="overflow-x:auto"><table><thead><tr><th>Source</th><th>pH</th><th>Turbidity</th><th>Chlorine</th><th>TDS</th><th>Temp</th><th>Sampled</th></tr></thead>
        <tbody>${readHTML}</tbody></table></div></div>
      <div class="card"><h3 style="margin:0 0 10px">⚠️ Active Alerts</h3>
        <div style="overflow-x:auto"><table><thead><tr><th>Source</th><th>Parameter</th><th>Value vs Threshold</th><th>Severity</th><th>Action</th></tr></thead>
        <tbody>${alertHTML}</tbody></table></div></div>
      <div style="display:flex;gap:8px;margin-top:8px">
        <a href="/school/water-quality/sources" class="btn" style="text-decoration:none">Manage Sources</a>
        <a href="/school/water-quality/readings" class="btn" style="text-decoration:none;background:#22c55e">Record Reading</a>
        <a href="/school/water-quality/analytics" class="btn" style="text-decoration:none;background:#f59e0b">Analytics</a>
      </div>`;
      renderPage(req, res, 'Water Quality Monitor', html, { activeTab: 'water-quality' });
    } catch(e) { ah(e, req, res); }
  });

  /* ─── Route 2: Manage Sources ─────────────────────────────── */
  app.get('/school/water-quality/sources', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const rows = await pool.query(`SELECT * FROM water_sources WHERE tenant_id=$1 ORDER BY name`, [tid]);
      let list = '';
      for (const r of rows.rows) {
        list += `<tr><td>${r.id}</td><td>${esc(r.name)}</td><td>${esc(r.location)}</td><td>${esc(r.type)}</td>
          <td>${esc(r.filter_type||'—')}</td><td><span style="color:${r.status==='active'?'#22c55e':'#ef4444'}">${esc(r.status)}</span></td>
          <td>${r.last_filter_change ? new Date(r.last_filter_change).toLocaleDateString() : '—'}</td>
          <td><a href="/school/water-quality/sources/edit/${r.id}" class="btn" style="font-size:12px;padding:4px 10px">Edit</a>
          <form method="POST" action="/school/water-quality/sources/delete" style="display:inline">
            <input type="hidden" name="id" value="${r.id}">
            <button class="btn" style="background:#ef4444;font-size:12px;padding:4px 10px" onclick="return confirm('Delete?')">Delete</button></form></td></tr>`;
      }
      const html = `${SKIP}
      <div class="card" style="display:flex;justify-content:space-between;align-items:center">
        <h3 style="margin:0">Water Sources</h3>
        <a href="/school/water-quality/sources/add" class="btn" style="text-decoration:none">+ Add Source</a>
      </div>
      <div class="card"><div style="overflow-x:auto"><table>
        <thead><tr><th>ID</th><th>Name</th><th>Location</th><th>Type</th><th>Filter</th><th>Status</th><th>Last Filter Change</th><th>Actions</th></tr></thead>
        <tbody>${list}</tbody></table></div></div>
      <a href="/school/water-quality" class="btn" style="background:${GRAY};text-decoration:none">← Dashboard</a>`;
      renderPage(req, res, 'Water Sources', html, { activeTab: 'water-quality' });
    } catch(e) { ah(e, req, res); }
  });

  /* ─── Route 3: Add Source ─────────────────────────────────── */
  app.get('/school/water-quality/sources/add', requireAuth, requireNotBanned, (req, res) => {
    const html = `${SKIP}
    <div class="card"><h3>Add Water Source</h3>
      <form method="POST" action="/school/water-quality/sources/add" style="display:grid;gap:12px;max-width:550px">
        <label>Source Name <input name="name" required placeholder="e.g. Main Building Tap #1"></label>
        <label>Location <input name="location" required placeholder="e.g. Building A, Ground Floor"></label>
        <label>Type <select name="type"><option>Tap</option><option>Fountain</option><option>Water Cooler</option><option>Tank</option><option>Well</option><option>Borehole</option></select></label>
        <label>Filter Type <input name="filter_type" placeholder="e.g. RO, UV, Carbon"></label>
        <label>Last Filter Change <input type="date" name="last_filter_change"></label>
        <button type="submit" class="btn">Add Source</button>
        <a href="/school/water-quality/sources" class="btn" style="background:${GRAY};text-decoration:none;text-align:center">Cancel</a>
      </form>
    </div>`;
    renderPage(req, res, 'Add Water Source', html, { activeTab: 'water-quality' });
  });

  app.post('/school/water-quality/sources/add', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { name, location, type, filter_type, last_filter_change } = req.body;
      const tid = req.user.tenant_id;
      await pool.query(`INSERT INTO water_sources (tenant_id,name,location,type,filter_type,last_filter_change) VALUES ($1,$2,$3,$4,$5,$6)`, [tid, name, location, type, filter_type, last_filter_change||null]);
      audit(req, 'water_source_add', { name, location, type });
      req.flash('success', 'Source added');
      res.redirect('/school/water-quality/sources');
    } catch(e) { ah(e, req, res); }
  });

  /* ─── Edit Source ─────────────────────────────────────────── */
  app.get('/school/water-quality/sources/edit/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const src = await pool.query(`SELECT * FROM water_sources WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
      if (!src.rows.length) return res.redirect('/school/water-quality/sources');
      const s = src.rows[0];
      const html = `${SKIP}
      <div class="card"><h3>Edit Water Source</h3>
        <form method="POST" action="/school/water-quality/sources/edit/${s.id}" style="display:grid;gap:12px;max-width:550px">
          <label>Name <input name="name" value="${esc(s.name)}" required></label>
          <label>Location <input name="location" value="${esc(s.location)}" required></label>
          <label>Type <select name="type"><option ${s.type==='Tap'?'selected':''}>Tap</option><option ${s.type==='Fountain'?'selected':''}>Fountain</option><option ${s.type==='Water Cooler'?'selected':''}>Water Cooler</option><option ${s.type==='Tank'?'selected':''}>Tank</option><option ${s.type==='Well'?'selected':''}>Well</option><option ${s.type==='Borehole'?'selected':''}>Borehole</option></select></label>
          <label>Filter Type <input name="filter_type" value="${esc(s.filter_type||'')}"></label>
          <label>Last Filter Change <input type="date" name="last_filter_change" value="${s.last_filter_change||''}"></label>
          <label>Status <select name="status"><option value="active" ${s.status==='active'?'selected':''}>Active</option><option value="inactive" ${s.status==='inactive'?'selected':''}>Inactive</option><option value="maintenance" ${s.status==='maintenance'?'selected':''}>Under Maintenance</option></select></label>
          <button type="submit" class="btn">Update</button>
          <a href="/school/water-quality/sources" class="btn" style="background:${GRAY};text-decoration:none;text-align:center">Cancel</a>
        </form>
      </div>`;
      renderPage(req, res, 'Edit Water Source', html, { activeTab: 'water-quality' });
    } catch(e) { ah(e, req, res); }
  });

  app.post('/school/water-quality/sources/edit/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { name, location, type, filter_type, last_filter_change, status } = req.body;
      const tid = req.user.tenant_id;
      await pool.query(`UPDATE water_sources SET name=$1,location=$2,type=$3,filter_type=$4,last_filter_change=$5,status=$6 WHERE id=$7 AND tenant_id=$8`, [name, location, type, filter_type, last_filter_change||null, status, req.params.id, tid]);
      audit(req, 'water_source_edit', { id: req.params.id });
      req.flash('success', 'Source updated');
      res.redirect('/school/water-quality/sources');
    } catch(e) { ah(e, req, res); }
  });

  /* ─── Delete Source ───────────────────────────────────────── */
  app.post('/school/water-quality/sources/delete', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      await pool.query(`DELETE FROM water_alerts WHERE source_id=$1 AND tenant_id=$2`, [req.body.id, tid]);
      await pool.query(`DELETE FROM water_readings WHERE source_id=$1 AND tenant_id=$2`, [req.body.id, tid]);
      await pool.query(`DELETE FROM water_sources WHERE id=$1 AND tenant_id=$2`, [req.body.id, tid]);
      audit(req, 'water_source_delete', { id: req.body.id });
      req.flash('success', 'Source deleted');
      res.redirect('/school/water-quality/sources');
    } catch(e) { ah(e, req, res); }
  });

  /* ─── Route 4: Record Reading ─────────────────────────────── */
  app.get('/school/water-quality/readings', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const sources = await pool.query(`SELECT id, name, location FROM water_sources WHERE tenant_id=$1 AND status='active' ORDER BY name`, [tid]);
      let optHTML = '';
      for (const s of sources.rows) optHTML += `<option value="${s.id}">${esc(s.name)} — ${esc(s.location)}</option>`;
      const html = `${SKIP}
      <div class="card"><h3>Record Water Quality Reading</h3>
        <form method="POST" action="/school/water-quality/readings" style="display:grid;gap:12px;max-width:600px">
          <label>Water Source <select name="source_id" required><option value="">Select source...</option>${optHTML}</select></label>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <label>pH Level (6.5–8.5 ideal) <input type="number" name="ph_level" step="0.01" min="0" max="14" required></label>
            <label>Turbidity (NTU, <5 ideal) <input type="number" name="turbidity" step="0.01" min="0" required></label>
            <label>Chlorine (ppm, 0.2–2.0 ideal) <input type="number" name="chlorine_ppm" step="0.01" min="0" required></label>
            <label>TDS (ppm, <500 ideal) <input type="number" name="tds_ppm" min="0" required></label>
            <label>Temperature (°C) <input type="number" name="temperature" step="0.1" min="0" max="100"></label>
            <label>Sampled By <input name="sampled_by" value="${esc(req.user.name||req.user.email)}"></label>
          </div>
          <label>Notes <textarea name="notes" rows="3"></textarea></label>
          <button type="submit" class="btn">Submit Reading</button>
          <a href="/school/water-quality" class="btn" style="background:${GRAY};text-decoration:none;text-align:center">Cancel</a>
        </form>
      </div>`;
      renderPage(req, res, 'Record Reading', html, { activeTab: 'water-quality' });
    } catch(e) { ah(e, req, res); }
  });

  app.post('/school/water-quality/readings', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { source_id, ph_level, turbidity, chlorine_ppm, tds_ppm, temperature, sampled_by, notes } = req.body;
      const tid = req.user.tenant_id;
      await pool.query(`INSERT INTO water_readings (tenant_id,source_id,ph_level,turbidity,chlorine_ppm,tds_ppm,temperature,sampled_by,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [tid, parseInt(source_id), parseFloat(ph_level)||null, parseFloat(turbidity)||null, parseFloat(chlorine_ppm)||null, parseInt(tds_ppm)||null, parseFloat(temperature)||null, sampled_by, notes]);
      const thresholds = {
        ph_level:     { min: 6.5, max: 8.5, param: 'pH' },
        turbidity:    { max: 4, param: 'Turbidity' },
        chlorine_ppm: { min: 0.2, max: 2.0, param: 'Chlorine' },
        tds_ppm:      { max: 500, param: 'TDS' }
      };
      const check = { ph_level: parseFloat(ph_level), turbidity: parseFloat(turbidity), chlorine_ppm: parseFloat(chlorine_ppm), tds_ppm: parseInt(tds_ppm) };
      for (const [key, th] of Object.entries(thresholds)) {
        const val = check[key];
        if (val === undefined || val === null) continue;
        let triggered = false;
        let thresholdVal = 0;
        if (th.min !== undefined && val < th.min) { triggered = true; thresholdVal = th.min; }
        if (th.max !== undefined && val > th.max) { triggered = true; thresholdVal = th.max; }
        if (triggered) {
          const sev = (key === 'ph_level' && (val < 6 || val > 9)) || (key === 'tds_ppm' && val > 600) ? 'critical' : 'warning';
          await pool.query(`INSERT INTO water_alerts (tenant_id,source_id,parameter,value,threshold,severity) VALUES ($1,$2,$3,$4,$5,$6)`, [tid, parseInt(source_id), th.param, val, thresholdVal, sev]);
          if (sev === 'critical') {
            queueEmail(tid, { subject: 'CRITICAL: Water Quality Alert — ' + th.param, body: `${th.param} reading ${val} exceeds threshold ${thresholdVal} at source ${source_id}` });
          }
        }
      }
      audit(req, 'water_reading_add', { source_id, ph_level, turbidity });
      req.flash('success', 'Reading recorded');
      res.redirect('/school/water-quality');
    } catch(e) { ah(e, req, res); }
  });

  /* ─── Route 5: Alert Management ───────────────────────────── */
  app.get('/school/water-quality/alerts', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const statusFilter = req.query.status || 'active';
      let where = 'WHERE wa.tenant_id=$1';
      const params = [tid];
      if (statusFilter !== 'all') { where += ' AND wa.status=$2'; params.push(statusFilter); }
      const alerts = await pool.query(`SELECT wa.*, ws.name, ws.location FROM water_alerts wa JOIN water_sources ws ON ws.id=wa.source_id ${where} ORDER BY wa.created_at DESC LIMIT 50`, params);
      let list = '';
      for (const a of alerts.rows) {
        list += `<tr><td>${a.id}</td><td>${esc(a.name)}</td><td>${esc(a.parameter)}</td>
          <td>${a.value} vs ${a.threshold}</td><td>${sevBadge(a.severity)}</td><td><span style="color:${a.status==='active'?'#ef4444':'#22c55e'}">${esc(a.status)}</span></td>
          <td>${new Date(a.created_at).toLocaleString()}</td>
          <td>${a.status === 'active' ? `<a href="/school/water-quality/alerts/acknowledge/${a.id}" class="btn" style="font-size:11px;padding:3px 8px;background:#f59e0b">Acknowledge</a>` : (a.acknowledged_by ? esc(a.acknowledged_by) : '—')}</td></tr>`;
      }
      const html = `${SKIP}
      <div class="card" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
        <h3 style="margin:0">Water Quality Alerts</h3>
        <div style="display:flex;gap:8px">
          <a href="/school/water-quality/alerts?status=active" class="btn" style="font-size:12px;padding:4px 10px;${statusFilter==='active'?'background:#ef4444':''}">Active</a>
          <a href="/school/water-quality/alerts?status=acknowledged" class="btn" style="font-size:12px;padding:4px 10px;${statusFilter==='acknowledged'?'background:#f59e0b':''}">Acknowledged</a>
          <a href="/school/water-quality/alerts?status=all" class="btn" style="font-size:12px;padding:4px 10px;${statusFilter==='all'?'background:#3730a3':''}">All</a>
        </div>
      </div>
      <div class="card"><div style="overflow-x:auto"><table>
        <thead><tr><th>ID</th><th>Source</th><th>Parameter</th><th>Value vs Threshold</th><th>Severity</th><th>Status</th><th>Created</th><th>Acknowledged By</th></tr></thead>
        <tbody>${list}</tbody></table></div></div>
      <a href="/school/water-quality" class="btn" style="background:${GRAY};text-decoration:none">← Dashboard</a>`;
      renderPage(req, res, 'Water Alerts', html, { activeTab: 'water-quality' });
    } catch(e) { ah(e, req, res); }
  });

  app.get('/school/water-quality/alerts/acknowledge/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      await pool.query(`UPDATE water_alerts SET status='acknowledged',acknowledged_at=NOW(),acknowledged_by=$1 WHERE id=$2 AND tenant_id=$3`, [req.user.name||req.user.email, req.params.id, tid]);
      audit(req, 'water_alert_acknowledge', { id: req.params.id });
      req.flash('success', 'Alert acknowledged');
      res.redirect('/school/water-quality/alerts');
    } catch(e) { ah(e, req, res); }
  });

  /* ─── Route 6: Analytics ──────────────────────────────────── */
  app.get('/school/water-quality/analytics', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const days = parseInt(req.query.days) || 30;
      const sourceStats = await pool.query(`
        SELECT ws.name, ws.location,
          AVG(wr.ph_level)::numeric(4,2) AS avg_ph,
          AVG(wr.turbidity)::numeric(6,2) AS avg_turbidity,
          AVG(wr.chlorine_ppm)::numeric(5,2) AS avg_chlorine,
          AVG(wr.tds_ppm)::int AS avg_tds,
          COUNT(wr.id) AS readings_count
        FROM water_sources ws
        LEFT JOIN water_readings wr ON wr.source_id=ws.id
          AND wr.sampled_at > NOW() - INTERVAL '${days} days'
        WHERE ws.tenant_id=$1 AND ws.status='active'
        GROUP BY ws.id ORDER BY ws.name`, [tid]);
      const compliance = await pool.query(`
        SELECT COUNT(CASE WHEN ph_level >= 6.5 AND ph_level <= 8.5 THEN 1 END) AS ph_ok,
          COUNT(CASE WHEN turbidity <= 4 THEN 1 END) AS turb_ok,
          COUNT(CASE WHEN chlorine_ppm >= 0.2 AND chlorine_ppm <= 2.0 THEN 1 END) AS cl_ok,
          COUNT(CASE WHEN tds_ppm <= 500 THEN 1 END) AS tds_ok,
          COUNT(*) AS total
        FROM water_readings wr JOIN water_sources ws ON ws.id=wr.source_id
        WHERE ws.tenant_id=$1 AND wr.sampled_at > NOW() - INTERVAL '${days} days'`, [tid]);
      const trendData = await pool.query(`
        SELECT DATE(sampled_at) AS day,
          AVG(ph_level)::numeric(4,2) AS avg_ph,
          AVG(turbidity)::numeric(6,2) AS avg_turb,
          AVG(chlorine_ppm)::numeric(5,2) AS avg_cl,
          AVG(tds_ppm)::int AS avg_tds
        FROM water_readings wr JOIN water_sources ws ON ws.id=wr.source_id
        WHERE ws.tenant_id=$1 AND wr.sampled_at > NOW() - INTERVAL '${days} days'
        GROUP BY DATE(sampled_at) ORDER BY day DESC LIMIT 14`, [tid]);
      const c = compliance.rows[0] || {};
      const total = parseInt(c.total) || 0;
      const compPct = (key) => total > 0 ? Math.round(((parseInt(c[key])||0)/total)*100) : 0;
      let srcHTML = '';
      for (const s of sourceStats.rows) {
        srcHTML += `<tr><td>${esc(s.name)}<br><small style="color:${GRAY}">${esc(s.location)}</small></td>
          <td>${s.avg_ph ?? '—'}</td><td>${s.avg_turbidity ?? '—'}</td>
          <td>${s.avg_chlorine ?? '—'}</td><td>${s.avg_tds ?? '—'}</td>
          <td>${s.readings_count}</td></tr>`;
      }
      let trendHTML = '';
      for (const t of trendData.rows) {
        trendHTML += `<tr><td>${new Date(t.day).toLocaleDateString()}</td>
          <td>${t.avg_ph ?? '—'}</td><td>${t.avg_turb ?? '—'}</td>
          <td>${t.avg_cl ?? '—'}</td><td>${t.avg_tds ?? '—'}</td></tr>`;
      }
      const html = `${SKIP}
      <div class="card" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
        <h3 style="margin:0">Water Quality Analytics</h3>
        <div style="display:flex;gap:6px">
          <a href="/school/water-quality/analytics?days=7" class="btn" style="font-size:12px;padding:4px 10px;${days===7?'background:#3730a3':''}">7d</a>
          <a href="/school/water-quality/analytics?days=30" class="btn" style="font-size:12px;padding:4px 10px;${days===30?'background:#3730a3':''}">30d</a>
          <a href="/school/water-quality/analytics?days=90" class="btn" style="font-size:12px;padding:4px 10px;${days===90?'background:#3730a3':''}">90d</a>
        </div>
      </div>
      <div class="card"><h3 style="margin:0 0 10px">Compliance (Last ${days}d)</h3>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;text-align:center">
          <div><div style="font-weight:700;font-size:20px">${compPct('ph_ok')}%</div><div style="color:${GRAY}">pH in Range</div>${getBar(compPct('ph_ok'))}</div>
          <div><div style="font-weight:700;font-size:20px">${compPct('turb_ok')}%</div><div style="color:${GRAY}">Turbidity OK</div>${getBar(compPct('turb_ok'))}</div>
          <div><div style="font-weight:700;font-size:20px">${compPct('cl_ok')}%</div><div style="color:${GRAY}">Chlorine OK</div>${getBar(compPct('cl_ok'))}</div>
          <div><div style="font-weight:700;font-size:20px">${compPct('tds_ok')}%</div><div style="color:${GRAY}">TDS OK</div>${getBar(compPct('tds_ok'))}</div>
        </div>
      </div>
      <div class="card"><h3 style="margin:0 0 10px">Source Averages</h3>
        <div style="overflow-x:auto"><table><thead><tr><th>Source</th><th>Avg pH</th><th>Avg Turbidity</th><th>Avg Chlorine</th><th>Avg TDS</th><th>Readings</th></tr></thead>
        <tbody>${srcHTML}</tbody></table></div></div>
      <div class="card"><h3 style="margin:0 0 10px">Daily Trends (Last 14d)</h3>
        <div style="overflow-x:auto"><table><thead><tr><th>Date</th><th>Avg pH</th><th>Avg Turbidity</th><th>Avg Chlorine</th><th>Avg TDS</th></tr></thead>
        <tbody>${trendHTML}</tbody></table></div></div>
      <a href="/school/water-quality" class="btn" style="background:${GRAY};text-decoration:none">← Dashboard</a>`;
      renderPage(req, res, 'Water Quality Analytics', html, { activeTab: 'water-quality' });
    } catch(e) { ah(e, req, res); }
  });

  /* ─── Route 7: Filter Maintenance ─────────────────────────── */
  app.get('/school/water-quality/filters', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const sources = await pool.query(`SELECT * FROM water_sources WHERE tenant_id=$1 AND status='active' AND filter_type IS NOT NULL AND filter_type != '' ORDER BY name`, [tid]);
      let rows = '';
      for (const s of sources.rows) {
        const lastChange = s.last_filter_change ? new Date(s.last_filter_change) : null;
        const daysSince = lastChange ? Math.round((Date.now() - lastChange.getTime()) / 86400000) : 999;
        const urgency = daysSince > 180 ? '🔴 Overdue' : daysSince > 120 ? '🟡 Due Soon' : daysSince > 90 ? '🟡 Approaching' : '🟢 OK';
        const urgencyColor = daysSince > 180 ? '#ef4444' : daysSince > 90 ? '#f59e0b' : '#22c55e';
        rows += `<tr><td>${esc(s.name)}</td><td>${esc(s.location)}</td><td>${esc(s.filter_type)}</td>
          <td>${s.last_filter_change ? new Date(s.last_filter_change).toLocaleDateString() : '<em>Never</em>'}</td>
          <td style="color:${urgencyColor};font-weight:600">${daysSince > 500 ? 'N/A' : daysSince + ' days'}</td>
          <td>${urgency}</td>
          <td><form method="POST" action="/school/water-quality/filters/change" style="display:inline">
            <input type="hidden" name="source_id" value="${s.id}">
            <button type="submit" class="btn" style="font-size:11px;padding:3px 8px;background:#22c55e">Log Change</button>
          </form></td></tr>`;
      }
      if (!rows) rows = '<tr><td colspan="7" style="text-align:center;color:'+GRAY+'">No filtered sources found</td></tr>';
      const html = `${SKIP}
      <div class="card"><h3>Filter Maintenance Tracker</h3>
        <p style="color:${GRAY};margin:0 0 12px">Filters should be changed every 90–180 days depending on type and usage.</p>
        <div style="overflow-x:auto"><table>
          <thead><tr><th>Source</th><th>Location</th><th>Filter Type</th><th>Last Changed</th><th>Days Since</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>${rows}</tbody></table></div>
      </div>
      <a href="/school/water-quality" class="btn" style="background:${GRAY};text-decoration:none">← Dashboard</a>`;
      renderPage(req, res, 'Filter Maintenance', html, { activeTab: 'water-quality' });
    } catch(e) { ah(e, req, res); }
  });

  app.post('/school/water-quality/filters/change', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      await pool.query(`UPDATE water_sources SET last_filter_change=NOW() WHERE id=$1 AND tenant_id=$2`, [req.body.source_id, tid]);
      audit(req, 'water_filter_change', { source_id: req.body.source_id });
      req.flash('success', 'Filter change logged');
      res.redirect('/school/water-quality/filters');
    } catch(e) { ah(e, req, res); }
  });

  /* ─── Route 8: History for a Source ────────────────────────── */
  app.get('/school/water-quality/history/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const src = await pool.query(`SELECT * FROM water_sources WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
      if (!src.rows.length) return res.redirect('/school/water-quality/sources');
      const s = src.rows[0];
      const readings = await pool.query(`SELECT * FROM water_readings WHERE source_id=$1 AND tenant_id=$2 ORDER BY sampled_at DESC LIMIT 50`, [req.params.id, tid]);
      let list = '';
      for (const r of readings.rows) {
        list += `<tr><td>${new Date(r.sampled_at).toLocaleString()}</td>
          <td style="color:${paramColor('ph_level', parseFloat(r.ph_level||0))}">${r.ph_level ?? '—'}</td>
          <td style="color:${paramColor('turbidity', parseFloat(r.turbidity||0))}">${r.turbidity ?? '—'} NTU</td>
          <td style="color:${paramColor('chlorine_ppm', parseFloat(r.chlorine_ppm||0))}">${r.chlorine_ppm ?? '—'} ppm</td>
          <td style="color:${paramColor('tds_ppm', parseFloat(r.tds_ppm||0))}">${r.tds_ppm ?? '—'} ppm</td>
          <td>${r.temperature ?? '—'}°C</td>
          <td>${esc(r.sampled_by||'—')}</td></tr>`;
      }
      const html = `${SKIP}
      <div class="card"><h3>History — ${esc(s.name)}</h3><p style="color:${GRAY};margin:4px 0 12px">${esc(s.location)} | Type: ${esc(s.type)}</p>
        <div style="overflow-x:auto"><table>
          <thead><tr><th>Sampled</th><th>pH</th><th>Turbidity</th><th>Chlorine</th><th>TDS</th><th>Temp</th><th>By</th></tr></thead>
          <tbody>${list}</tbody></table></div>
      </div>
      <a href="/school/water-quality" class="btn" style="background:${GRAY};text-decoration:none">← Dashboard</a>`;
      renderPage(req, res, 'Source History', html, { activeTab: 'water-quality' });
    } catch(e) { ah(e, req, res); }
  });

  /* ─── Route 9: Compliance Report ──────────────────────────── */
  app.get('/school/water-quality/compliance', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const days = parseInt(req.query.days) || 30;
      const data = await pool.query(`
        SELECT ws.id, ws.name, ws.location,
          COUNT(wr.id) AS total_samples,
          COUNT(CASE WHEN wr.ph_level >= 6.5 AND wr.ph_level <= 8.5 THEN 1 END) AS ph_pass,
          COUNT(CASE WHEN wr.turbidity <= 4 THEN 1 END) AS turb_pass,
          COUNT(CASE WHEN wr.chlorine_ppm >= 0.2 AND wr.chlorine_ppm <= 2.0 THEN 1 END) AS cl_pass,
          COUNT(CASE WHEN wr.tds_ppm <= 500 THEN 1 END) AS tds_pass
        FROM water_sources ws
        LEFT JOIN water_readings wr ON wr.source_id=ws.id
          AND wr.sampled_at > NOW() - INTERVAL '${days} days'
        WHERE ws.tenant_id=$1 AND ws.status='active'
        GROUP BY ws.id ORDER BY ws.name`, [tid]);
      let rows = '';
      for (const d of data.rows) {
        const tot = parseInt(d.total_samples) || 0;
        const overall = tot > 0 ? Math.round(((parseInt(d.ph_pass)+parseInt(d.turb_pass)+parseInt(d.cl_pass)+parseInt(d.tds_pass))/(tot*4))*100) : 0;
        const oColor = overall >= 90 ? '#22c55e' : overall >= 70 ? '#f59e0b' : '#ef4444';
        rows += `<tr><td>${esc(d.name)}</td><td>${esc(d.location)}</td><td>${tot}</td>
          <td>${tot > 0 ? Math.round((parseInt(d.ph_pass)/tot)*100) : 0}%</td>
          <td>${tot > 0 ? Math.round((parseInt(d.turb_pass)/tot)*100) : 0}%</td>
          <td>${tot > 0 ? Math.round((parseInt(d.cl_pass)/tot)*100) : 0}%</td>
          <td>${tot > 0 ? Math.round((parseInt(d.tds_pass)/tot)*100) : 0}%</td>
          <td><strong style="color:${oColor}">${overall}%</strong></td></tr>`;
      }
      const html = `${SKIP}
      <div class="card" style="display:flex;justify-content:space-between;align-items:center">
        <h3 style="margin:0">Compliance Report</h3>
        <div style="display:flex;gap:6px">
          <a href="/school/water-quality/compliance?days=7" class="btn" style="font-size:12px;padding:4px 10px;${days===7?'background:#3730a3':''}">7d</a>
          <a href="/school/water-quality/compliance?days=30" class="btn" style="font-size:12px;padding:4px 10px;${days===30?'background:#3730a3':''}">30d</a>
          <a href="/school/water-quality/compliance?days=90" class="btn" style="font-size:12px;padding:4px 10px;${days===90?'background:#3730a3':''}">90d</a>
        </div>
      </div>
      <div class="card">
        <p style="color:${GRAY};margin:0 0 10px">Standards: pH 6.5–8.5 | Turbidity ≤4 NTU | Chlorine 0.2–2.0 ppm | TDS ≤500 ppm</p>
        <div style="overflow-x:auto"><table>
          <thead><tr><th>Source</th><th>Location</th><th>Samples</th><th>pH Pass %</th><th>Turbidity Pass %</th><th>Chlorine Pass %</th><th>TDS Pass %</th><th>Overall</th></tr></thead>
          <tbody>${rows}</tbody></table></div>
      </div>
      <a href="/school/water-quality" class="btn" style="background:${GRAY};text-decoration:none">← Dashboard</a>`;
      renderPage(req, res, 'Compliance Report', html, { activeTab: 'water-quality' });
    } catch(e) { ah(e, req, res); }
  });
};
