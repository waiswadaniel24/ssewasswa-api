module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5', GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.btn:hover{background:#3730a3}.btn-sm{padding:4px 10px;font-size:12px}.btn-green{background:#059669}.btn-green:hover{background:#047857}.btn-yellow{background:#d97706}.btn-yellow:hover{background:#b45309}.btn-red{background:#dc2626}.btn-red:hover{background:#b91c1c}.btn-purple{background:#7c3aed}.btn-purple:hover{background:#6d28d9}.btn-gray{background:#6b7280}.btn-gray:hover{background:#4b5563}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}.grid-2{display:grid;grid-template-columns:1fr 1fr;gap:16px}.grid-3{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.grid-4{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.badge{display:inline-block;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600}.badge-green{background:#d1fae5;color:#059669}.badge-yellow{background:#fef3c7;color:#d97706}.badge-red{background:#fee2e2;color:#dc2626}.badge-blue{background:#dbeafe;color:#2563eb}.badge-purple{background:#ede9fe;color:#7c3aed}.metric-card{text-align:center;padding:16px}.metric-card h3{font-size:28px;margin:4px 0}.metric-card small{color:#6b7280}.health-bar{height:8px;border-radius:4px;background:#e5e7eb;overflow:hidden}.health-fill{height:100%;border-radius:4px;transition:width 0.3s}.alert-banner{background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px 16px;margin-bottom:16px;color:#dc2626}</style>';

  (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS maintenance_assets (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL,
        name VARCHAR(200) NOT NULL, asset_type VARCHAR(50),
        location VARCHAR(100), building VARCHAR(100), floor VARCHAR(20),
        install_date DATE, warranty_end DATE, purchase_cost NUMERIC(12,2),
        condition_score NUMERIC(5,2) DEFAULT 100,
        last_maintenance DATE, next_maintenance DATE,
        maintenance_interval_days INT DEFAULT 90,
        vendor VARCHAR(200), vendor_contact VARCHAR(200), vendor_email VARCHAR(200),
        serial_number VARCHAR(100), model_number VARCHAR(100),
        criticality VARCHAR(20) DEFAULT 'medium',
        specifications JSONB DEFAULT '{}',
        image_url TEXT, notes TEXT,
        total_maintenance_cost NUMERIC(12,2) DEFAULT 0,
        maintenance_count INT DEFAULT 0,
        status VARCHAR(20) DEFAULT 'operational',
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS maintenance_work_orders (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL,
        asset_id INT REFERENCES maintenance_assets(id),
        wo_number VARCHAR(30),
        title VARCHAR(200) NOT NULL, description TEXT,
        priority VARCHAR(20) DEFAULT 'medium',
        status VARCHAR(20) DEFAULT 'open',
        assigned_to INT, assigned_name VARCHAR(100),
        scheduled_date DATE, completed_date DATE,
        estimated_cost NUMERIC(10,2), actual_cost NUMERIC(10,2),
        parts_used JSONB DEFAULT '[]',
        labor_hours NUMERIC(5,1),
        failure_mode VARCHAR(100),
        root_cause TEXT, corrective_action TEXT,
        photos JSONB DEFAULT '[]',
        signature VARCHAR(50),
        created_by INT, approved_by INT,
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS maintenance_sensor_data (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL,
        asset_id INT REFERENCES maintenance_assets(id),
        metric_name VARCHAR(100), value NUMERIC(12,4),
        unit VARCHAR(20), threshold_min NUMERIC(12,4),
        threshold_max NUMERIC(12,4), alert_triggered BOOLEAN DEFAULT false,
        alert_message TEXT, recorded_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      console.log('[Mod] predictive-maintenance OK');
    } catch(e) { console.warn('[Mod] predictive-maintenance Warn:', e.message); }
  })();

  /* ─── Helper: generate WO number ─── */
  async function generateWONumber(tid) {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const [res] = await pool.query(
      'SELECT COUNT(*) AS c FROM maintenance_work_orders WHERE tenant_id=$1 AND created_at >= CURRENT_DATE', [tid]);
    return `WO-${today}-${String(res.c + 1).padStart(3, '0')}`;
  }

  /* ─── Dashboard ─── */
  app.get('/school/predictive-maintenance', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const [assets] = await pool.query('SELECT COUNT(*) AS c FROM maintenance_assets WHERE tenant_id=$1', [tid]);
    const [openWO] = await pool.query("SELECT COUNT(*) AS c FROM maintenance_work_orders WHERE tenant_id=$1 AND status NOT IN ('completed','cancelled')", [tid]);
    const [alerts] = await pool.query('SELECT COUNT(*) AS c FROM maintenance_sensor_data WHERE tenant_id=$1 AND alert_triggered=true AND recorded_at > NOW() - INTERVAL \'24 hours\'', [tid]);
    const [overdue] = await pool.query('SELECT COUNT(*) AS c FROM maintenance_assets WHERE tenant_id=$1 AND next_maintenance < CURRENT_DATE AND status=\'operational\'', [tid]);
    const [totalCost] = await pool.query('SELECT COALESCE(SUM(actual_cost),0)::numeric(12,2) AS total FROM maintenance_work_orders WHERE tenant_id=$1 AND status=\'completed\'', [tid]);
    const [recentWO] = await pool.query(
      'SELECT wo.*, a.name AS asset_name FROM maintenance_work_orders wo LEFT JOIN maintenance_assets a ON wo.asset_id=a.id WHERE wo.tenant_id=$1 ORDER BY wo.created_at DESC LIMIT 8', [tid]);
    const [criticalAssets] = await pool.query(
      'SELECT name, condition_score, criticality, status FROM maintenance_assets WHERE tenant_id=$1 AND (condition_score < 50 OR status=\'degraded\') ORDER BY condition_score ASC LIMIT 5', [tid]);
    const [recentAlerts] = await pool.query(
      'SELECT sd.*, a.name AS asset_name FROM maintenance_sensor_data sd LEFT JOIN maintenance_assets a ON sd.asset_id=a.id WHERE sd.tenant_id=$1 AND sd.alert_triggered=true ORDER BY sd.recorded_at DESC LIMIT 6', [tid]);
    const [byStatus] = await pool.query(
      "SELECT status, COUNT(*) AS c FROM maintenance_work_orders WHERE tenant_id=$1 GROUP BY status ORDER BY c DESC", [tid]);
    res.send(renderPage(req, 'Predictive Maintenance', SKIP + `
      <div class="card">
        <h2 style="color:${P}">Predictive Maintenance Hub</h2>
        ${overdue.c > 0 ? `<div class="alert-banner">⚠ ${overdue.c} asset(s) have overdue maintenance. <a href="/school/predictive-maintenance/assets?filter=overdue" style="color:#dc2626;text-decoration:underline">Review Now →</a></div>` : ''}
        <div class="grid-4" style="margin:20px 0">
          <div class="card metric-card" style="border-left:4px solid ${P}"><h3 style="color:${P}">${assets.c}</h3><small>Total Assets</small></div>
          <div class="card metric-card" style="border-left:4px solid #d97706"><h3 style="color:#d97706">${openWO.c}</h3><small>Open Work Orders</small></div>
          <div class="card metric-card" style="border-left:4px solid #dc2626"><h3 style="color:#dc2626">${alerts.c}</h3><small>Sensor Alerts (24h)</small></div>
          <div class="card metric-card" style="border-left:4px solid #059669"><h3 style="color:#059669">$${totalCost.total}</h3><small>Total Cost (YTD)</small></div>
        </div>
        <div style="display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap">
          ${byStatus.map(s => `<span class="badge ${s.status==='completed'?'badge-green':s.status==='open'?'badge-red':s.status==='in_progress'?'badge-blue':'badge-yellow'}">${esc(s.status)}: ${s.c}</span>`).join('')}
        </div>
        <div class="grid-2">
          <div class="card"><h3 style="color:${P}">Recent Work Orders</h3>
            <table><tr><th>WO#</th><th>Title</th><th>Asset</th><th>Priority</th><th>Status</th></tr>
            ${recentWO.map(w => `<tr>
              <td><small>${esc(w.wo_number||'-')}</small></td>
              <td>${esc(w.title)}</td>
              <td><small>${esc(w.asset_name||'-')}</small></td>
              <td><span class="badge ${w.priority==='critical'?'badge-red':w.priority==='high'?'badge-yellow':'badge-blue'}">${esc(w.priority)}</span></td>
              <td><span class="badge ${w.status==='completed'?'badge-green':w.status==='open'?'badge-red':w.status==='in_progress'?'badge-blue':'badge-yellow'}">${esc(w.status)}</span></td>
            </tr>`).join('')}
          </table></div>
          <div class="card">
            ${criticalAssets.length > 0 ? `<h3 style="color:#dc2626">⚠ Critical Assets</h3>
              <table><tr><th>Asset</th><th>Health</th><th>Criticality</th><th>Status</th></tr>
              ${criticalAssets.map(a => `<tr>
                <td>${esc(a.name)}</td>
                <td><div class="health-bar" style="width:80px;display:inline-block">
                  <div class="health-fill" style="width:${a.condition_score}%;background:${a.condition_score<30?'#dc2626':a.condition_score<60?'#d97706':'#059669'}"></div></div> ${a.condition_score}%</td>
                <td><span class="badge ${a.criticality==='high'?'badge-red':a.criticality==='medium'?'badge-yellow':'badge-green'}">${esc(a.criticality)}</span></td>
                <td>${esc(a.status)}</td></tr>`).join('')}</table>` : ''}
            ${recentAlerts.length > 0 ? `<h3 style="color:#dc2626;margin-top:12px">Recent Sensor Alerts</h3>
              <table><tr><th>Asset</th><th>Metric</th><th>Value</th><th>Time</th></tr>
              ${recentAlerts.map(a => `<tr>
                <td>${esc(a.asset_name||'-')}</td><td>${esc(a.metric_name)}</td>
                <td style="color:#dc2626;font-weight:600">${a.value} ${esc(a.unit||'')}</td>
                <td><small>${new Date(a.recorded_at).toLocaleString()}</small></td></tr>`).join('')}</table>` : ''}
          </div>
        </div>
        <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">
          <a class="btn" href="/school/predictive-maintenance/assets">Assets</a>
          <a class="btn btn-green" href="/school/predictive-maintenance/work-orders">Work Orders</a>
          <a class="btn btn-yellow" href="/school/predictive-maintenance/sensor-data">Sensor Data</a>
          <a class="btn btn-purple" href="/school/predictive-maintenance/analytics">Analytics</a>
          <a class="btn btn-red" href="/school/predictive-maintenance/vendors">Vendors</a>
          <a class="btn btn-gray" href="/school/predictive-maintenance/spare-parts">Spare Parts</a>
        </div>
      </div>`, {activeNav: 'predictive-maintenance'}));
  }));

  /* ─── Assets List ─── */
  app.get('/school/predictive-maintenance/assets', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const filter = req.query.filter || '';
    const typeFilter = req.query.type || '';
    let where = 'WHERE a.tenant_id=$1', params = [tid], pIdx = 2;
    if (filter === 'overdue') { where += ` AND a.next_maintenance < CURRENT_DATE AND a.status='operational'`; }
    else if (filter === 'degraded') { where += ` AND a.condition_score < 60`; }
    else if (filter === 'critical') { where += ` AND a.criticality='high'`; }
    if (typeFilter) { where += ` AND a.asset_type=$${pIdx++}`; params.push(typeFilter); }
    const [rows] = await pool.query(
      `SELECT a.*, (SELECT COUNT(*) FROM maintenance_work_orders wo WHERE wo.asset_id=a.id AND wo.status NOT IN ('completed','cancelled')) AS open_wo_count
       FROM maintenance_assets a ${where} ORDER BY a.condition_score ASC`, params);
    const [types] = await pool.query('SELECT asset_type, COUNT(*) AS c FROM maintenance_assets WHERE tenant_id=$1 GROUP BY asset_type ORDER BY c DESC', [tid]);
    res.send(renderPage(req, 'Maintenance Assets', SKIP + `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <h2 style="color:${P}">Assets (${rows.length})</h2>
          <a class="btn" href="/school/predictive-maintenance/assets/new">+ Add Asset</a>
        </div>
        <div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap">
          <a href="/school/predictive-maintenance/assets" class="btn btn-sm ${!filter?'':'btn-gray'}">All</a>
          <a href="/school/predictive-maintenance/assets?filter=overdue" class="btn btn-sm ${filter==='overdue'?'btn-red':'btn-gray'}">Overdue</a>
          <a href="/school/predictive-maintenance/assets?filter=degraded" class="btn btn-sm ${filter==='degraded'?'btn-yellow':'btn-gray'}">Degraded</a>
          <a href="/school/predictive-maintenance/assets?filter=critical" class="btn btn-sm ${filter==='critical'?'btn-red':'btn-gray'}">Critical</a>
        </div>
        <div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap">
          ${types.map(t => `<a href="/school/predictive-maintenance/assets?type=${t.asset_type}" class="btn btn-sm btn-gray">${esc(t.asset_type)} (${t.c})</a>`).join('')}
        </div>
        <table><tr><th>Asset</th><th>Type</th><th>Location</th><th>Health</th><th>Criticality</th><th>Next Maint.</th><th>Open WOs</th><th>Actions</th></tr>
        ${rows.map(a => {
          const healthColor = a.condition_score >= 80 ? '#059669' : a.condition_score >= 50 ? '#d97706' : '#dc2626';
          const isOverdue = a.next_maintenance && new Date(a.next_maintenance) < new Date();
          return `<tr>
            <td><strong>${esc(a.name)}</strong><br><small style="color:${GRAY}">${esc(a.serial_number||'')}</small></td>
            <td><span class="badge badge-blue">${esc(a.asset_type||'-')}</span></td>
            <td>${esc(a.location||'-')}</td>
            <td><div style="display:flex;align-items:center;gap:6px"><div class="health-bar" style="width:60px">
              <div class="health-fill" style="width:${a.condition_score}%;background:${healthColor}"></div></div>
              <small style="color:${healthColor};font-weight:600">${a.condition_score}%</small></div></td>
            <td><span class="badge ${a.criticality==='high'?'badge-red':a.criticality==='medium'?'badge-yellow':'badge-green'}">${esc(a.criticality)}</span></td>
            <td>${isOverdue ? `<span style="color:#dc2626;font-weight:600">${a.next_maintenance}</span>` : (a.next_maintenance || '-')}</td>
            <td>${a.open_wo_count > 0 ? `<span class="badge badge-red">${a.open_wo_count}</span>` : '0'}</td>
            <td><a href="/school/predictive-maintenance/assets/${a.id}/view" style="color:${P}">View</a> |
                <a href="/school/predictive-maintenance/assets/${a.id}/edit" style="color:#059669">Edit</a></td>
          </tr>`;
        }).join('')}
      </table></div>`, {activeNav: 'predictive-maintenance'}));
  }));

  /* ─── Add Asset ─── */
  app.get('/school/predictive-maintenance/assets/new', requireAuth, requireNotBanned, (req, res) => {
    res.send(renderPage(req, 'Add Asset', SKIP + `
      <div class="card"><h2 style="color:${P}">Register New Asset</h2>
      <form method="POST" action="/school/predictive-maintenance/assets/new">
        <div class="grid-2">
          <div><label>Asset Name *</label><input name="name" required></div>
          <div><label>Asset Type *</label><select name="asset_type" required>
            <option value="hvac">HVAC System</option><option value="electrical">Electrical Panel</option>
            <option value="plumbing">Plumbing</option><option value="elevator">Elevator</option>
            <option value="fire_safety">Fire Safety</option><option value="generator">Generator</option>
            <option value="water_heater">Water Heater</option><option value="boiler">Boiler</option>
            <option value="rooftop">Rooftop Unit</option><option value="kitchen">Kitchen Equipment</option>
            <option value="lab">Lab Equipment</option><option value="it_infra">IT Infrastructure</option>
            <option value="vehicle">Vehicle</option><option value="other">Other</option></select></div>
          <div><label>Location</label><input name="location" placeholder="Building, Wing, Room"></div>
          <div><label>Building</label><input name="building"></div>
          <div><label>Serial Number</label><input name="serial_number"></div>
          <div><label>Model Number</label><input name="model_number"></div>
          <div><label>Install Date</label><input name="install_date" type="date"></div>
          <div><label>Warranty End</label><input name="warranty_end" type="date"></div>
          <div><label>Purchase Cost ($)</label><input name="purchase_cost" type="number" step="0.01"></div>
          <div><label>Criticality</label><select name="criticality">
            <option value="low">Low</option><option value="medium" selected>Medium</option>
            <option value="high">High</option><option value="critical">Critical</option></select></div>
          <div><label>Maintenance Interval (days)</label><input name="maintenance_interval_days" type="number" value="90"></div>
          <div><label>Condition Score (%)</label><input name="condition_score" type="number" min="0" max="100" value="100"></div>
          <div><label>Vendor</label><input name="vendor"></div>
          <div><label>Vendor Contact</label><input name="vendor_contact"></div>
          <div><label>Vendor Email</label><input name="vendor_email" type="email"></div>
          <div style="grid-column:span 2"><label>Notes</label><textarea name="notes" rows="3"></textarea></div>
        </div>
        <button class="btn" type="submit" style="margin-top:16px">Register Asset</button>
        <a href="/school/predictive-maintenance/assets" class="btn btn-gray">Cancel</a>
      </form></div>`, {activeNav: 'predictive-maintenance'}));
  });

  app.post('/school/predictive-maintenance/assets/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const { name, asset_type, location, building, serial_number, model_number, install_date,
            warranty_end, purchase_cost, criticality, maintenance_interval_days, condition_score,
            vendor, vendor_contact, vendor_email, notes } = req.body;
    const nextMaint = req.body.install_date
      ? new Date(new Date(req.body.install_date).getTime() + (maintenance_interval_days || 90) * 86400000).toISOString().slice(0, 10)
      : null;
    await pool.query(
      `INSERT INTO maintenance_assets (tenant_id, name, asset_type, location, building, serial_number, model_number,
       install_date, warranty_end, purchase_cost, criticality, maintenance_interval_days, condition_score,
       last_maintenance, next_maintenance, vendor, vendor_contact, vendor_email, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [tid, name, asset_type, location, building, serial_number, model_number,
       install_date, warranty_end, purchase_cost, criticality, maintenance_interval_days || 90,
       condition_score || 100, install_date, nextMaint, vendor, vendor_contact, vendor_email, notes]);
    await audit(req, 'asset_registered', { name, asset_type });
    res.redirect('/school/predictive-maintenance/assets');
  }));

  /* ─── View Asset ─── */
  app.get('/school/predictive-maintenance/assets/:id/view', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const [assets] = await pool.query('SELECT * FROM maintenance_assets WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    if (!assets.length) return res.send('Not found');
    const a = assets[0];
    const [workOrders] = await pool.query(
      'SELECT * FROM maintenance_work_orders WHERE tenant_id=$1 AND asset_id=$2 ORDER BY created_at DESC LIMIT 10', [tid, a.id]);
    const [sensorData] = await pool.query(
      'SELECT * FROM maintenance_sensor_data WHERE tenant_id=$1 AND asset_id=$2 ORDER BY recorded_at DESC LIMIT 20', [tid, a.id]);
    const [sensorAlerts] = await pool.query(
      'SELECT COUNT(*) AS c FROM maintenance_sensor_data WHERE tenant_id=$1 AND asset_id=$2 AND alert_triggered=true AND recorded_at > NOW() - INTERVAL \'7 days\'', [tid, a.id]);
    const healthColor = a.condition_score >= 80 ? '#059669' : a.condition_score >= 50 ? '#d97706' : '#dc2626';
    const warrantyExpired = a.warranty_end && new Date(a.warranty_end) < new Date();
    res.send(renderPage(req, `Asset: ${a.name}`, SKIP + `
      <div class="card">
        <a href="/school/predictive-maintenance/assets" style="color:${P}">← Back to Assets</a>
        <div style="display:flex;justify-content:space-between;align-items:start;margin-top:12px">
          <div>
            <h2 style="color:${P}">${esc(a.name)}</h2>
            <span class="badge badge-blue">${esc(a.asset_type)}</span>
            <span class="badge ${a.criticality==='high'||a.criticality==='critical'?'badge-red':a.criticality==='medium'?'badge-yellow':'badge-green'}" style="margin-left:4px">${esc(a.criticality)}</span>
            <span class="badge ${a.status==='operational'?'badge-green':'badge-red'}" style="margin-left:4px">${esc(a.status)}</span>
            ${warrantyExpired ? '<span class="badge badge-red" style="margin-left:4px">Warranty Expired</span>' : ''}
          </div>
          <div style="display:flex;gap:8px">
            <a href="/school/predictive-maintenance/assets/${a.id}/edit" class="btn">Edit</a>
            <a href="/school/predictive-maintenance/work-orders/new?asset_id=${a.id}" class="btn btn-green">Create WO</a>
          </div>
        </div>
        <div class="grid-3" style="margin:20px 0">
          <div class="card metric-card" style="border-left:4px solid ${healthColor}">
            <h3 style="color:${healthColor}">${a.condition_score}%</h3><small>Condition Score</small>
            <div class="health-bar" style="margin-top:8px;width:100%"><div class="health-fill" style="width:${a.condition_score}%;background:${healthColor}"></div></div>
          </div>
          <div class="card metric-card" style="border-left:4px solid #2563eb">
            <h3 style="color:#2563eb">${a.next_maintenance || 'N/A'}</h3><small>Next Maintenance</small></div>
          <div class="card metric-card" style="border-left:4px solid ${sensorAlerts.c > 0 ? '#dc2626' : '#059669'}">
            <h3 style="color:${sensorAlerts.c > 0 ? '#dc2626' : '#059669'}">${sensorAlerts.c}</h3><small>Sensor Alerts (7d)</small></div>
        </div>
        <div class="grid-2">
          <div class="card"><h3 style="color:${P}">Asset Details</h3>
            <table style="border:none"><tr style="border:none"><td style="border:none;color:${GRAY}">Serial Number:</td><td style="border:none">${esc(a.serial_number||'-')}</td></tr>
              <tr style="border:none"><td style="border:none;color:${GRAY}">Model:</td><td style="border:none">${esc(a.model_number||'-')}</td></tr>
              <tr style="border:none"><td style="border:none;color:${GRAY}">Location:</td><td style="border:none">${esc(a.location||'-')}, ${esc(a.building||'-')}</td></tr>
              <tr style="border:none"><td style="border:none;color:${GRAY}">Installed:</td><td style="border:none">${a.install_date||'-'}</td></tr>
              <tr style="border:none"><td style="border:none;color:${GRAY}">Warranty End:</td><td style="border:none;color:${warrantyExpired?'#dc2626':'inherit'}">${a.warranty_end||'-'}</td></tr>
              <tr style="border:none"><td style="border:none;color:${GRAY}">Purchase Cost:</td><td style="border:none">$${a.purchase_cost||'0'}</td></tr>
              <tr style="border:none"><td style="border:none;color:${GRAY}">Total Maint. Cost:</td><td style="border:none">$${a.total_maintenance_cost||'0'}</td></tr>
              <tr style="border:none"><td style="border:none;color:${GRAY}">Maintenance Count:</td><td style="border:none">${a.maintenance_count}</td></tr>
              <tr style="border:none"><td style="border:none;color:${GRAY}">Vendor:</td><td style="border:none">${esc(a.vendor||'-')}</td></tr>
              <tr style="border:none"><td style="border:none;color:${GRAY}">Vendor Contact:</td><td style="border:none">${esc(a.vendor_contact||'-')} ${a.vendor_email ? '('+esc(a.vendor_email)+')' : ''}</td></tr>
            </table>
          </div>
          <div class="card"><h3 style="color:${P}">Maintenance History</h3>
            ${workOrders.length === 0 ? '<p style="color:'+GRAY+'">No work orders recorded.</p>' :
              `<table><tr><th>WO#</th><th>Title</th><th>Priority</th><th>Status</th><th>Date</th></tr>
              ${workOrders.map(w => `<tr>
                <td><small>${esc(w.wo_number||'-')}</small></td><td>${esc(w.title)}</td>
                <td><span class="badge ${w.priority==='critical'?'badge-red':w.priority==='high'?'badge-yellow':'badge-blue'}">${esc(w.priority)}</span></td>
                <td><span class="badge ${w.status==='completed'?'badge-green':w.status==='open'?'badge-red':'badge-blue'}">${esc(w.status)}</span></td>
                <td><small>${w.created_at ? new Date(w.created_at).toLocaleDateString() : '-'}</small></td></tr>`).join('')}</table>`}
          </div>
        </div>
        ${sensorData.length > 0 ? `<div class="card" style="margin-top:16px"><h3 style="color:${P}">Recent Sensor Readings</h3>
          <table><tr><th>Metric</th><th>Value</th><th>Threshold</th><th>Alert</th><th>Time</th></tr>
          ${sensorData.slice(0, 10).map(s => `<tr>
            <td>${esc(s.metric_name)}</td><td style="font-weight:600">${s.value} ${esc(s.unit||'')}</td>
            <td>${s.threshold_min||'-'} / ${s.threshold_max||'-'}</td>
            <td>${s.alert_triggered ? '<span class="badge badge-red">ALERT</span>' : 'OK'}</td>
            <td><small>${new Date(s.recorded_at).toLocaleString()}</small></td></tr>`).join('')}</table></div>` : ''}
        ${a.notes ? `<div class="card" style="margin-top:16px"><h3 style="color:${P}">Notes</h3><p>${esc(a.notes)}</p></div>` : ''}
      </div>`, {activeNav: 'predictive-maintenance'}));
  }));

  /* ─── Edit Asset ─── */
  app.get('/school/predictive-maintenance/assets/:id/edit', requireAuth, requireNotBanned, ah(async (req, res) => {
    const [rows] = await pool.query('SELECT * FROM maintenance_assets WHERE id=$1 AND tenant_id=$2', [req.params.id, req.user.tenant_id]);
    if (!rows.length) return res.send('Not found');
    const a = rows[0];
    const typeOpts = ['hvac','electrical','plumbing','elevator','fire_safety','generator','water_heater','boiler','rooftop','kitchen','lab','it_infra','vehicle','other'];
    res.send(renderPage(req, 'Edit Asset', SKIP + `
      <div class="card"><h2 style="color:${P}">Edit: ${esc(a.name)}</h2>
      <form method="POST" action="/school/predictive-maintenance/assets/${a.id}/edit">
        <div class="grid-2">
          <div><label>Name *</label><input name="name" value="${esc(a.name)}" required></div>
          <div><label>Type *</label><select name="asset_type">${typeOpts.map(t => `<option value="${t}" ${a.asset_type===t?'selected':''}>${t}</option>`).join('')}</select></div>
          <div><label>Location</label><input name="location" value="${esc(a.location||'')}"></div>
          <div><label>Building</label><input name="building" value="${esc(a.building||'')}"></div>
          <div><label>Serial Number</label><input name="serial_number" value="${esc(a.serial_number||'')}"></div>
          <div><label>Model Number</label><input name="model_number" value="${esc(a.model_number||'')}"></div>
          <div><label>Install Date</label><input name="install_date" type="date" value="${a.install_date||''}"></div>
          <div><label>Warranty End</label><input name="warranty_end" type="date" value="${a.warranty_end||''}"></div>
          <div><label>Purchase Cost</label><input name="purchase_cost" type="number" step="0.01" value="${a.purchase_cost||''}"></div>
          <div><label>Criticality</label><select name="criticality">
            ${['low','medium','high','critical'].map(c => `<option value="${c}" ${a.criticality===c?'selected':''}>${c}</option>`).join('')}</select></div>
          <div><label>Maint. Interval (days)</label><input name="maintenance_interval_days" type="number" value="${a.maintenance_interval_days}"></div>
          <div><label>Condition Score (%)</label><input name="condition_score" type="number" min="0" max="100" value="${a.condition_score}"></div>
          <div><label>Vendor</label><input name="vendor" value="${esc(a.vendor||'')}"></div>
          <div><label>Vendor Contact</label><input name="vendor_contact" value="${esc(a.vendor_contact||'')}"></div>
          <div><label>Vendor Email</label><input name="vendor_email" value="${esc(a.vendor_email||'')}"></div>
          <div><label>Status</label><select name="status">
            ${['operational','degraded','offline','retired'].map(s => `<option value="${s}" ${a.status===s?'selected':''}>${s}</option>`).join('')}</select></div>
          <div style="grid-column:span 2"><label>Notes</label><textarea name="notes" rows="3">${esc(a.notes||'')}</textarea></div>
        </div>
        <button class="btn" type="submit" style="margin-top:16px">Save</button>
        <a href="/school/predictive-maintenance/assets/${a.id}/view" class="btn btn-gray">Cancel</a>
      </form></div>`, {activeNav: 'predictive-maintenance'}));
  }));

  app.post('/school/predictive-maintenance/assets/:id/edit', requireAuth, requireNotBanned, ah(async (req, res) => {
    const { name, asset_type, location, building, serial_number, model_number, install_date,
            warranty_end, purchase_cost, criticality, maintenance_interval_days, condition_score,
            vendor, vendor_contact, vendor_email, status, notes } = req.body;
    await pool.query(
      `UPDATE maintenance_assets SET name=$1, asset_type=$2, location=$3, building=$4, serial_number=$5,
       model_number=$6, install_date=$7, warranty_end=$8, purchase_cost=$9, criticality=$10,
       maintenance_interval_days=$11, condition_score=$12, vendor=$13, vendor_contact=$14,
       vendor_email=$15, status=$16, notes=$17, updated_at=NOW() WHERE id=$18 AND tenant_id=$19`,
      [name, asset_type, location, building, serial_number, model_number, install_date, warranty_end,
       purchase_cost, criticality, maintenance_interval_days, condition_score, vendor, vendor_contact,
       vendor_email, status, notes, req.params.id, req.user.tenant_id]);
    await audit(req, 'asset_updated', { id: req.params.id });
    res.redirect(`/school/predictive-maintenance/assets/${req.params.id}/view`);
  }));

  /* ─── Work Orders List ─── */
  app.get('/school/predictive-maintenance/work-orders', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const statusFilter = req.query.status || '';
    const priorityFilter = req.query.priority || '';
    let where = 'WHERE wo.tenant_id=$1', params = [tid], pIdx = 2;
    if (statusFilter) { where += ` AND wo.status=$${pIdx++}`; params.push(statusFilter); }
    if (priorityFilter) { where += ` AND wo.priority=$${pIdx++}`; params.push(priorityFilter); }
    const [rows] = await pool.query(
      `SELECT wo.*, a.name AS asset_name FROM maintenance_work_orders wo
       LEFT JOIN maintenance_assets a ON wo.asset_id=a.id ${where} ORDER BY wo.created_at DESC`, params);
    res.send(renderPage(req, 'Work Orders', SKIP + `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <h2 style="color:${P}">Work Orders (${rows.length})</h2>
          <a class="btn btn-green" href="/school/predictive-maintenance/work-orders/new">+ Create Work Order</a>
        </div>
        <div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap">
          <a href="/school/predictive-maintenance/work-orders" class="btn btn-sm btn-gray">All</a>
          ${['open','in_progress','on_hold','completed','cancelled'].map(s => `<a href="/school/predictive-maintenance/work-orders?status=${s}" class="btn btn-sm ${statusFilter===s ? (s==='completed'?'btn-green':'btn-purple') : 'btn-gray'}">${esc(s)}</a>`).join('')}
          <span style="margin-left:8px;color:${GRAY}">Priority:</span>
          ${['critical','high','medium','low'].map(p => `<a href="/school/predictive-maintenance/work-orders?priority=${p}" class="btn btn-sm ${priorityFilter===p?'btn-red':'btn-gray'}">${esc(p)}</a>`).join('')}
        </div>
        <table><tr><th>WO#</th><th>Title</th><th>Asset</th><th>Priority</th><th>Status</th><th>Assigned</th><th>Scheduled</th><th>Actions</th></tr>
        ${rows.map(w => `<tr>
          <td><strong>${esc(w.wo_number||'-')}</strong></td>
          <td>${esc(w.title)}</td>
          <td>${esc(w.asset_name||'-')}</td>
          <td><span class="badge ${w.priority==='critical'?'badge-red':w.priority==='high'?'badge-yellow':'badge-blue'}">${esc(w.priority)}</span></td>
          <td><span class="badge ${w.status==='completed'?'badge-green':w.status==='open'?'badge-red':w.status==='in_progress'?'badge-blue':'badge-yellow'}">${esc(w.status)}</span></td>
          <td>${esc(w.assigned_name||'-')}</td>
          <td>${w.scheduled_date || '-'}</td>
          <td><a href="/school/predictive-maintenance/work-orders/${w.id}/view" style="color:${P}">View</a> |
              <a href="/school/predictive-maintenance/work-orders/${w.id}/edit" style="color:#059669">Edit</a></td>
        </tr>`).join('')}
      </table></div>`, {activeNav: 'predictive-maintenance'}));
  }));

  /* ─── Create Work Order ─── */
  app.get('/school/predictive-maintenance/work-orders/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    const [assets] = await pool.query('SELECT id, name FROM maintenance_assets WHERE tenant_id=$1 AND status != \'retired\' ORDER BY name', [req.user.tenant_id]);
    const preselectedAsset = req.query.asset_id || '';
    res.send(renderPage(req, 'Create Work Order', SKIP + `
      <div class="card"><h2 style="color:${P}">Create Work Order</h2>
      <form method="POST" action="/school/predictive-maintenance/work-orders/new">
        <div class="grid-2">
          <div><label>Asset *</label><select name="asset_id" required>
            <option value="">-- Select Asset --</option>
            ${assets.map(a => `<option value="${a.id}" ${String(a.id)===preselectedAsset?'selected':''}>${esc(a.name)}</option>`).join('')}
          </select></div>
          <div><label>Priority *</label><select name="priority" required>
            <option value="low">Low</option><option value="medium" selected>Medium</option>
            <option value="high">High</option><option value="critical">Critical</option></select></div>
          <div><label>Title *</label><input name="title" required placeholder="Brief description of work needed"></div>
          <div><label>Scheduled Date</label><input name="scheduled_date" type="date"></div>
          <div><label>Assigned To (Staff ID)</label><input name="assigned_to" type="number" placeholder="User ID"></div>
          <div><label>Assigned Name</label><input name="assigned_name"></div>
          <div><label>Estimated Cost ($)</label><input name="estimated_cost" type="number" step="0.01"></div>
          <div><label>Failure Mode</label><input name="failure_mode" placeholder="e.g. bearing wear, overload"></div>
          <div style="grid-column:span 2"><label>Description *</label><textarea name="description" rows="4" required placeholder="Detailed description of the issue and required maintenance..."></textarea></div>
          <div style="grid-column:span 2"><label>Root Cause Analysis</label><textarea name="root_cause" rows="2"></textarea></div>
          <div style="grid-column:span 2"><label>Corrective Action</label><textarea name="corrective_action" rows="2"></textarea></div>
        </div>
        <button class="btn btn-green" type="submit" style="margin-top:16px">Create Work Order</button>
        <a href="/school/predictive-maintenance/work-orders" class="btn btn-gray">Cancel</a>
      </form></div>`, {activeNav: 'predictive-maintenance'}));
  }));

  app.post('/school/predictive-maintenance/work-orders/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const { asset_id, title, description, priority, assigned_to, assigned_name,
            scheduled_date, estimated_cost, failure_mode, root_cause, corrective_action } = req.body;
    const woNumber = await generateWONumber(tid);
    await pool.query(
      `INSERT INTO maintenance_work_orders (tenant_id, asset_id, wo_number, title, description, priority,
       status, assigned_to, assigned_name, scheduled_date, estimated_cost, failure_mode,
       root_cause, corrective_action, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,'open',$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [tid, asset_id, woNumber, title, description, priority, assigned_to || null,
       assigned_name, scheduled_date, estimated_cost, failure_mode, root_cause, corrective_action, req.user.id]);
    await audit(req, 'work_order_created', { woNumber, title, priority });
    if (priority === 'critical') {
      const [asset] = await pool.query('SELECT name FROM maintenance_assets WHERE id=$1', [asset_id]);
      queueEmail(tid, {
        to: 'maintenance-team',
        subject: `CRITICAL Work Order: ${woNumber}`,
        body: `Critical maintenance work order created for ${asset?.[0]?.name || 'Unknown Asset'}.\n\nTitle: ${title}\nPriority: CRITICAL\n\nDescription: ${description}`
      });
    }
    res.redirect('/school/predictive-maintenance/work-orders');
  }));

  /* ─── View Work Order ─── */
  app.get('/school/predictive-maintenance/work-orders/:id/view', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const [rows] = await pool.query(
      `SELECT wo.*, a.name AS asset_name FROM maintenance_work_orders wo
       LEFT JOIN maintenance_assets a ON wo.asset_id=a.id WHERE wo.id=$1 AND wo.tenant_id=$2`, [req.params.id, tid]);
    if (!rows.length) return res.send('Not found');
    const w = rows[0];
    const parts = Array.isArray(w.parts_used) ? w.parts_used : JSON.parse(w.parts_used || '[]');
    res.send(renderPage(req, `WO: ${w.wo_number}`, SKIP + `
      <div class="card">
        <a href="/school/predictive-maintenance/work-orders" style="color:${P}">← Back to Work Orders</a>
        <div style="display:flex;justify-content:space-between;align-items:start;margin-top:12px">
          <div>
            <h2 style="color:${P}">${esc(w.wo_number || 'WO')}</h2>
            <h3>${esc(w.title)}</h3>
            <span class="badge ${w.priority==='critical'?'badge-red':w.priority==='high'?'badge-yellow':'badge-blue'}">${esc(w.priority)}</span>
            <span class="badge ${w.status==='completed'?'badge-green':w.status==='open'?'badge-red':w.status==='in_progress'?'badge-blue':'badge-yellow'}" style="margin-left:4px">${esc(w.status)}</span>
          </div>
          <div style="display:flex;gap:8px">
            ${w.status==='open' ? `<a href="/school/predictive-maintenance/work-orders/${w.id}/start" class="btn btn-purple">Start Work</a>` : ''}
            ${w.status==='in_progress' ? `<a href="/school/predictive-maintenance/work-orders/${w.id}/complete" class="btn btn-green">Complete</a>` : ''}
            <a href="/school/predictive-maintenance/work-orders/${w.id}/edit" class="btn">Edit</a>
          </div>
        </div>
        <div class="grid-2" style="margin-top:16px">
          <div class="card"><h4 style="color:${P}">Details</h4>
            <p><strong>Asset:</strong> <a href="/school/predictive-maintenance/assets/${w.asset_id}/view" style="color:${P}">${esc(w.asset_name||'-')}</a></p>
            <p><strong>Assigned:</strong> ${esc(w.assigned_name||'-')}</p>
            <p><strong>Scheduled:</strong> ${w.scheduled_date||'Not scheduled'}</p>
            <p><strong>Completed:</strong> ${w.completed_date||'-'}</p>
            <p><strong>Est. Cost:</strong> $${w.estimated_cost||'0'}</p>
            <p><strong>Actual Cost:</strong> $${w.actual_cost||'0'}</p>
            <p><strong>Labor Hours:</strong> ${w.labor_hours||'0'}</p>
            <p><strong>Failure Mode:</strong> ${esc(w.failure_mode||'N/A')}</p>
          </div>
          <div class="card"><h4 style="color:${P}">Description</h4><p>${esc(w.description)}</p>
            ${w.root_cause ? `<h4 style="color:${P};margin-top:12px">Root Cause</h4><p>${esc(w.root_cause)}</p>` : ''}
            ${w.corrective_action ? `<h4 style="color:${P};margin-top:12px">Corrective Action</h4><p>${esc(w.corrective_action)}</p>` : ''}
          </div>
        </div>
        ${parts.length > 0 ? `<div class="card" style="margin-top:16px"><h4 style="color:${P}">Parts Used</h4>
          <table><tr><th>Part</th><th>Quantity</th><th>Cost</th></tr>
          ${parts.map(p => `<tr><td>${esc(p.name)}</td><td>${p.qty}</td><td>$${p.cost}</td></tr>`).join('')}</table></div>` : ''}
      </div>`, {activeNav: 'predictive-maintenance'}));
  }));

  /* ─── Start Work Order ─── */
  app.get('/school/predictive-maintenance/work-orders/:id/start', requireAuth, requireNotBanned, ah(async (req, res) => {
    await pool.query("UPDATE maintenance_work_orders SET status='in_progress', updated_at=NOW() WHERE id=$1 AND tenant_id=$2", [req.params.id, req.user.tenant_id]);
    await audit(req, 'work_order_started', { id: req.params.id });
    res.redirect(`/school/predictive-maintenance/work-orders/${req.params.id}/view`);
  }));

  /* ─── Complete Work Order ─── */
  app.get('/school/predictive-maintenance/work-orders/:id/complete', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const [wo] = await pool.query('SELECT * FROM maintenance_work_orders WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    if (!wo.length) return res.send('Not found');
    const w = wo[0];
    res.send(renderPage(req, 'Complete Work Order', SKIP + `
      <div class="card" style="max-width:600px"><h2 style="color:#059669">Complete: ${esc(w.wo_number)}</h2>
        <form method="POST" action="/school/predictive-maintenance/work-orders/${w.id}/complete">
          <div style="margin:12px 0"><label>Actual Cost ($)</label><input name="actual_cost" type="number" step="0.01" value="${w.estimated_cost||0}"></div>
          <div style="margin:12px 0"><label>Labor Hours</label><input name="labor_hours" type="number" step="0.1"></div>
          <div style="margin:12px 0"><label>Root Cause</label><textarea name="root_cause" rows="2">${esc(w.root_cause||'')}</textarea></div>
          <div style="margin:12px 0"><label>Corrective Action</label><textarea name="corrective_action" rows="2">${esc(w.corrective_action||'')}</textarea></div>
          <button class="btn btn-green" type="submit">Mark Complete</button>
          <a href="/school/predictive-maintenance/work-orders/${w.id}/view" class="btn btn-gray">Cancel</a>
        </form></div>`, {activeNav: 'predictive-maintenance'}));
  }));

  app.post('/school/predictive-maintenance/work-orders/:id/complete', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const { actual_cost, labor_hours, root_cause, corrective_action } = req.body;
    const [wo] = await pool.query('SELECT * FROM maintenance_work_orders WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    if (!wo.length) return res.send('Not found');
    await pool.query(
      `UPDATE maintenance_work_orders SET status='completed', completed_date=CURRENT_DATE, actual_cost=$1,
       labor_hours=$2, root_cause=$3, corrective_action=$4, updated_at=NOW() WHERE id=$5 AND tenant_id=$6`,
      [actual_cost, labor_hours, root_cause, corrective_action, req.params.id, tid]);
    if (wo[0].asset_id) {
      await pool.query(
        `UPDATE maintenance_assets SET last_maintenance=CURRENT_DATE,
         next_maintenance=CURRENT_DATE + (maintenance_interval_days || ' days')::INTERVAL,
         condition_score = LEAST(100, condition_score + 5),
         total_maintenance_cost = total_maintenance_cost + $1,
         maintenance_count = maintenance_count + 1,
         updated_at=NOW() WHERE id=$2 AND tenant_id=$3`,
        [actual_cost || 0, wo[0].asset_id, tid]);
    }
    await audit(req, 'work_order_completed', { id: req.params.id, cost: actual_cost });
    res.redirect('/school/predictive-maintenance/work-orders');
  }));

  /* ─── Sensor Data ─── */
  app.get('/school/predictive-maintenance/sensor-data', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const [assets] = await pool.query('SELECT id, name FROM maintenance_assets WHERE tenant_id=$1 ORDER BY name', [tid]);
    const [data] = await pool.query(
      `SELECT sd.*, a.name AS asset_name FROM maintenance_sensor_data sd
       LEFT JOIN maintenance_assets a ON sd.asset_id=a.id
       WHERE sd.tenant_id=$1 ORDER BY sd.recorded_at DESC LIMIT 100`, [tid]);
    const [alertCount] = await pool.query(
      'SELECT COUNT(*) AS c FROM maintenance_sensor_data WHERE tenant_id=$1 AND alert_triggered=true AND recorded_at > NOW() - INTERVAL \'24 hours\'', [tid]);
    const [byMetric] = await pool.query(
      'SELECT metric_name, AVG(value)::numeric(10,2) AS avg_val, MAX(value)::numeric(10,2) AS max_val, COUNT(*) AS readings FROM maintenance_sensor_data WHERE tenant_id=$1 AND recorded_at > NOW() - INTERVAL \'7 days\' GROUP BY metric_name ORDER BY metric_name',
      [tid]);
    res.send(renderPage(req, 'Sensor Data', SKIP + `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <h2 style="color:${P}">Sensor Data Monitor</h2>
          <div style="display:flex;gap:8px">
            <a class="btn btn-green" href="/school/predictive-maintenance/sensor-data/ingest">Ingest Data</a>
          </div>
        </div>
        ${alertCount.c > 0 ? `<div class="alert-banner">⚠ ${alertCount.c} sensor alert(s) in the last 24 hours.</div>` : ''}
        <div class="grid-3" style="margin-bottom:16px">
          ${byMetric.map(m => `<div class="card" style="text-align:center">
            <h4 style="color:${P}">${esc(m.metric_name)}</h4>
            <p style="font-size:24px;font-weight:600;color:${GRAY}">${m.avg_val}</p>
            <small>Avg (7d) | Max: ${m.max_val} | ${m.readings} readings</small>
          </div>`).join('')}
        </div>
        <table><tr><th>Time</th><th>Asset</th><th>Metric</th><th>Value</th><th>Threshold</th><th>Alert</th></tr>
        ${data.map(d => `<tr>
          <td><small>${new Date(d.recorded_at).toLocaleString()}</small></td>
          <td>${esc(d.asset_name||'-')}</td>
          <td>${esc(d.metric_name)}</td>
          <td style="font-weight:600">${d.value} ${esc(d.unit||'')}</td>
          <td>${d.threshold_min||'-'} ~ ${d.threshold_max||'-'}</td>
          <td>${d.alert_triggered ? `<span class="badge badge-red">${esc(d.alert_message||'ALERT')}</span>` : '<span class="badge badge-green">OK</span>'}</td>
        </tr>`).join('')}
      </table></div>`, {activeNav: 'predictive-maintenance'}));
  }));

  /* ─── Ingest Sensor Data ─── */
  app.get('/school/predictive-maintenance/sensor-data/ingest', requireAuth, requireNotBanned, ah(async (req, res) => {
    const [assets] = await pool.query('SELECT id, name FROM maintenance_assets WHERE tenant_id=$1 AND status != \'retired\' ORDER BY name', [req.user.tenant_id]);
    res.send(renderPage(req, 'Ingest Sensor Data', SKIP + `
      <div class="card" style="max-width:600px"><h2 style="color:${P}">Ingest Sensor Reading</h2>
        <form method="POST" action="/school/predictive-maintenance/sensor-data/ingest">
          <div style="margin:12px 0"><label>Asset *</label><select name="asset_id" required>
            <option value="">-- Select --</option>
            ${assets.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}
          </select></div>
          <div style="margin:12px 0"><label>Metric Name *</label><input name="metric_name" required placeholder="e.g. temperature, vibration, pressure"></div>
          <div style="margin:12px 0"><label>Value *</label><input name="value" type="number" step="0.0001" required></div>
          <div style="margin:12px 0"><label>Unit</label><input name="unit" placeholder="e.g. °C, Hz, PSI"></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div><label>Min Threshold</label><input name="threshold_min" type="number" step="0.0001"></div>
            <div><label>Max Threshold</label><input name="threshold_max" type="number" step="0.0001"></div>
          </div>
          <button class="btn btn-green" type="submit" style="margin-top:16px">Submit Reading</button>
          <a href="/school/predictive-maintenance/sensor-data" class="btn btn-gray">Cancel</a>
        </form></div>`, {activeNav: 'predictive-maintenance'}));
  }));

  app.post('/school/predictive-maintenance/sensor-data/ingest', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const { asset_id, metric_name, value, unit, threshold_min, threshold_max } = req.body;
    const numVal = parseFloat(value);
    const tMin = threshold_min ? parseFloat(threshold_min) : null;
    const tMax = threshold_max ? parseFloat(threshold_max) : null;
    const alertTriggered = (tMin !== null && numVal < tMin) || (tMax !== null && numVal > tMax);
    let alertMessage = null;
    if (alertTriggered) {
      alertMessage = `${metric_name} value ${numVal} ${unit} is ${tMin !== null && numVal < tMin ? 'below minimum ' + tMin : 'above maximum ' + tMax}`;
      const [asset] = await pool.query('SELECT name, condition_score FROM maintenance_assets WHERE id=$1', [asset_id]);
      if (asset.length) {
        await pool.query(
          'UPDATE maintenance_assets SET condition_score = GREATEST(0, condition_score - 2), updated_at=NOW() WHERE id=$1',
          [asset_id]);
        if (numVal < (tMin || 0) * 0.8 || numVal > (tMax || Infinity) * 1.2) {
          await pool.query('UPDATE maintenance_assets SET condition_score = GREATEST(0, condition_score - 5), updated_at=NOW() WHERE id=$1', [asset_id]);
        }
      }
    }
    await pool.query(
      `INSERT INTO maintenance_sensor_data (tenant_id, asset_id, metric_name, value, unit, threshold_min, threshold_max, alert_triggered, alert_message)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [tid, asset_id, metric_name, numVal, unit, tMin, tMax, alertTriggered, alertMessage]);
    if (alertTriggered) {
      await audit(req, 'sensor_alert', { asset_id, metric_name, value: numVal, message: alertMessage });
    }
    res.redirect('/school/predictive-maintenance/sensor-data');
  }));

  /* ─── Analytics ─── */
  app.get('/school/predictive-maintenance/analytics', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const [costByMonth] = await pool.query(
      "SELECT TO_CHAR(completed_date, 'YYYY-MM') AS month, SUM(actual_cost)::numeric(12,2) AS total FROM maintenance_work_orders WHERE tenant_id=$1 AND status='completed' AND completed_date > CURRENT_DATE - INTERVAL '12 months' GROUP BY month ORDER BY month",
      [tid]);
    const [byType] = await pool.query(
      "SELECT asset_type, SUM(wo.actual_cost)::numeric(12,2) AS total, COUNT(wo.id) AS wo_count FROM maintenance_work_orders wo JOIN maintenance_assets a ON wo.asset_id=a.id WHERE wo.tenant_id=$1 AND wo.status='completed' GROUP BY asset_type ORDER BY total DESC",
      [tid]);
    const [byPriority] = await pool.query(
      "SELECT priority, COUNT(*) AS c, AVG(actual_cost)::numeric(10,2) AS avg_cost FROM maintenance_work_orders WHERE tenant_id=$1 AND status='completed' GROUP BY priority ORDER BY priority",
      [tid]);
    const [avgResponse] = await pool.query(
      "SELECT AVG(completed_date - created_at)::numeric AS avg_days FROM maintenance_work_orders WHERE tenant_id=$1 AND status='completed' AND completed_date IS NOT NULL",
      [tid]);
    const [healthDist] = await pool.query(
      "SELECT CASE WHEN condition_score >= 80 THEN 'Healthy' WHEN condition_score >= 50 THEN 'Fair' ELSE 'Poor' END AS health, COUNT(*) AS c FROM maintenance_assets WHERE tenant_id=$1 GROUP BY health ORDER BY health",
      [tid]);
    const [topExpensive] = await pool.query(
      "SELECT a.name, SUM(wo.actual_cost)::numeric(12,2) AS total_cost, COUNT(wo.id) AS wo_count FROM maintenance_work_orders wo JOIN maintenance_assets a ON wo.asset_id=a.id WHERE wo.tenant_id=$1 AND wo.status='completed' GROUP BY a.name ORDER BY total_cost DESC LIMIT 10",
      [tid]);
    res.send(renderPage(req, 'Maintenance Analytics', SKIP + `
      <div class="card">
        <h2 style="color:${P}">Maintenance Analytics Dashboard</h2>
        <div class="grid-3" style="margin:16px 0">
          <div class="card metric-card" style="border-left:4px solid #2563eb">
            <h3 style="color:#2563eb">${avgResponse.avg_days || 0} days</h3><small>Avg Response Time</small></div>
          <div class="card metric-card" style="border-left:4px solid #d97706">
            <h3 style="color:#d97706">${costByMonth.reduce((s,r) => s + parseFloat(r.total), 0).toFixed(2)}</h3><small>Total Cost (12m)</small></div>
          <div class="card metric-card" style="border-left:4px solid #059669">
            <h3 style="color:#059669">${healthDist.find(h=>h.health==='Healthy')?.c || 0}</h3><small>Healthy Assets</small></div>
        </div>
        <div class="grid-2">
          <div class="card"><h3 style="color:${P}">Asset Health Distribution</h3>
            <div style="display:flex;gap:16px;margin:12px 0">
              ${healthDist.map(h => `<div style="text-align:center;flex:1">
                <div style="font-size:28px;font-weight:600;color:${h.health==='Healthy'?'#059669':h.health==='Fair'?'#d97706':'#dc2626'}">${h.c}</div>
                <small>${esc(h.health)}</small></div>`).join('')}
            </div></div>
          <div class="card"><h3 style="color:${P}">Cost by Priority</h3>
            <table><tr><th>Priority</th><th>Count</th><th>Avg Cost</th></tr>
            ${byPriority.map(p => `<tr><td><span class="badge ${p.priority==='critical'?'badge-red':p.priority==='high'?'badge-yellow':'badge-blue'}">${esc(p.priority)}</span></td>
              <td>${p.c}</td><td>$${p.avg_cost||0}</td></tr>`).join('')}
          </table></div>
        </div>
        <div class="grid-2" style="margin-top:16px">
          <div class="card"><h3 style="color:${P}">Monthly Cost Trend (12m)</h3>
            <table><tr><th>Month</th><th>Total Cost</th></tr>
            ${costByMonth.map(m => `<tr><td>${m.month}</td><td style="font-weight:600">$${m.total}</td></tr>`).join('')}
          </table></div>
          <div class="card"><h3 style="color:${P}">Cost by Asset Type</h3>
            <table><tr><th>Type</th><th>WO Count</th><th>Total Cost</th></tr>
            ${byType.map(t => `<tr><td>${esc(t.asset_type)}</td><td>${t.wo_count}</td><td>$${t.total}</td></tr>`).join('')}
          </table></div>
        </div>
        <div class="card" style="margin-top:16px"><h3 style="color:${P}">Most Expensive Assets</h3>
          <table><tr><th>Asset</th><th>Work Orders</th><th>Total Cost</th></tr>
          ${topExpensive.map(a => `<tr><td>${esc(a.name)}</td><td>${a.wo_count}</td><td style="font-weight:600">$${a.total_cost}</td></tr>`).join('')}
        </table></div>
      </div>`, {activeNav: 'predictive-maintenance'}));
  }));

  /* ─── Vendors Management ─── */
  app.get('/school/predictive-maintenance/vendors', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const [rows] = await pool.query(
      'SELECT DISTINCT vendor, vendor_contact, vendor_email, COUNT(*) AS asset_count FROM maintenance_assets WHERE tenant_id=$1 AND vendor IS NOT NULL GROUP BY vendor, vendor_contact, vendor_email ORDER BY asset_count DESC',
      [tid]);
    res.send(renderPage(req, 'Vendors', SKIP + `
      <div class="card">
        <h2 style="color:${P}">Vendor Directory (${rows.length})</h2>
        <table><tr><th>Vendor</th><th>Contact Person</th><th>Email</th><th>Assets Serviced</th></tr>
        ${rows.map(v => `<tr>
          <td><strong>${esc(v.vendor)}</strong></td>
          <td>${esc(v.vendor_contact||'-')}</td>
          <td>${v.vendor_email ? `<a href="mailto:${esc(v.vendor_email)}" style="color:${P}">${esc(v.vendor_email)}</a>` : '-'}</td>
          <td>${v.asset_count}</td>
        </tr>`).join('')}
      </table></div>`, {activeNav: 'predictive-maintenance'}));
  }));

  /* ─── Spare Parts (Analytics View) ─── */
  app.get('/school/predictive-maintenance/spare-parts', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const [partsData] = await pool.query(
      `SELECT wo.parts_used FROM maintenance_work_orders wo WHERE wo.tenant_id=$1 AND wo.parts_used IS NOT NULL AND wo.status='completed'`,
      [tid]);
    const partsMap = {};
    partsData.forEach(row => {
      const parts = Array.isArray(row.parts_used) ? row.parts_used : JSON.parse(row.parts_used || '[]');
      parts.forEach(p => {
        if (!partsMap[p.name]) partsMap[p.name] = { name: p.name, totalQty: 0, totalCost: 0 };
        partsMap[p.name].totalQty += (parseInt(p.qty) || 0);
        partsMap[p.name].totalCost += (parseFloat(p.cost) || 0);
      });
    });
    const partsList = Object.values(partsMap).sort((a, b) => b.totalCost - a.totalCost);
    res.send(renderPage(req, 'Spare Parts Usage', SKIP + `
      <div class="card">
        <h2 style="color:${P}">Spare Parts Usage Analytics</h2>
        <p style="color:${GRAY}">Aggregated from completed work order parts lists.</p>
        <table><tr><th>Part</th><th>Total Qty Used</th><th>Total Cost</th><th>Avg Cost/Unit</th></tr>
        ${partsList.length === 0 ? '<tr><td colspan="4" style="color:'+GRAY+';text-align:center">No parts data available yet.</td></tr>' :
          partsList.map(p => `<tr>
            <td><strong>${esc(p.name)}</strong></td><td>${p.totalQty}</td>
            <td>$${p.totalCost.toFixed(2)}</td>
            <td>$${p.totalQty > 0 ? (p.totalCost / p.totalQty).toFixed(2) : '0.00'}</td>
          </tr>`).join('')}
      </table></div>`, {activeNav: 'predictive-maintenance'}));
  }));

  /* ─── API: Predictive Health Score ─── */
  app.get('/school/predictive-maintenance/api/health-prediction/:assetId', requireAuth, ah(async (req, res) => {
    const [asset] = await pool.query('SELECT * FROM maintenance_assets WHERE id=$1 AND tenant_id=$2', [req.params.assetId, req.user.tenant_id]);
    if (!asset.length) return res.json({ error: 'Asset not found' });
    const a = asset[0];
    const [alerts] = await pool.query(
      'SELECT COUNT(*) AS c FROM maintenance_sensor_data WHERE tenant_id=$1 AND asset_id=$2 AND alert_triggered=true AND recorded_at > NOW() - INTERVAL \'30 days\'',
      [req.user.tenant_id, a.id]);
    const [recentMetrics] = await pool.query(
      'SELECT metric_name, AVG(value)::numeric(10,2) AS avg_val, COUNT(alert_triggered) AS alert_count FROM maintenance_sensor_data WHERE tenant_id=$1 AND asset_id=$2 AND recorded_at > NOW() - INTERVAL \'30 days\' GROUP BY metric_name',
      [req.user.tenant_id, a.id]);
    const alertRate = alerts[0].c / 30;
    const riskScore = Math.max(0, Math.min(100, a.condition_score - (alertRate * 10) - (recentMetrics.reduce((s, m) => s + (m.alert_count > 0 ? 3 : 0), 0))));
    const prediction = riskScore >= 70 ? { level: 'low', message: 'Asset is performing well. No immediate maintenance needed.' }
      : riskScore >= 40 ? { level: 'medium', message: 'Asset showing signs of wear. Schedule preventive maintenance within 30 days.' }
      : { level: 'high', message: 'Asset health declining rapidly. Immediate maintenance recommended.' };
    res.json({
      asset: { id: a.id, name: a.name, currentScore: a.condition_score },
      predictedScore: Math.round(riskScore * 10) / 10,
      recentAlerts: alerts[0].c,
      metrics: recentMetrics,
      prediction,
      nextMaintenance: a.next_maintenance,
      daysUntilMaintenance: a.next_maintenance ? Math.ceil((new Date(a.next_maintenance) - new Date()) / 86400000) : null
    });
  }));
};
