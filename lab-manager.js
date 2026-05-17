// ============================================================
// LAB MANAGER MODULE — Multi-Tenant SaaS School Portal
// Lab inventory, equipment checkout/return, chemical/reagent
// tracking, safety compliance, lab booking/scheduling, incident
// reporting, maintenance requests, experiment protocols,
// equipment calibration schedules, usage logs, budget tracking,
// safety training records.
// Color theme: #4f46e5 (indigo)
// ============================================================
// Usage in server.js:
//   const labManager = require('./lab-manager');
//   labManager(app, pool, opts);
// ============================================================

module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5', GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.btn:hover{background:#3730a3}.btn-sm{padding:5px 12px;font-size:13px}.btn-danger{background:#dc2626}.btn-danger:hover{background:#b91c1c}.btn-success{background:#059669}.btn-success:hover{background:#047857}.btn-warning{background:#d97706}.btn-warning:hover{background:#b45309}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}.badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600}.badge-active{background:#d1fae5;color:#065f46}.badge-inactive{background:#fee2e2;color:#991b1b}.badge-pending{background:#fef3c7;color:#92400e}.badge-approved{background:#dbeafe;color:#1e40af}.badge-rejected{background:#fee2e2;color:#991b1b}.badge-cancelled{background:#f3f4f6;color:#4b5563}.badge-completed{background:#d1fae5;color:#065f46}.badge-in_use{background:#fef3c7;color:#92400e}.badge-available{background:#d1fae5;color:#065f46}.badge-maintenance{background:#fee2e2;color:#991b1b}.badge-retired{background:#f3f4f6;color:#4b5563}.badge-overdue{background:#fee2e2;color:#dc2626}.badge-due_soon{background:#fef3c7;color:#92400e}.badge-ok{background:#d1fae5;color:#065f46}.badge-low{background:#fef3c7;color:#92400e}.badge-critical{background:#fee2e2;color:#dc2626}.badge-high{background:#fef3c7;color:#92400e}.badge-medium{background:#dbeafe;color:#1e40af}.badge-open{background:#fef3c7;color:#92400e}.badge-resolved{background:#d1fae5;color:#065f46}.badge-in_progress{background:#dbeafe;color:#1e40af}.badge-reported{background:#fef3c7;color:#92400e}.badge-passed{background:#d1fae5;color:#065f46}.badge-failed{background:#fee2e2;color:#dc2626}.badge-expired{background:#fee2e2;color:#dc2626}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}.stat-card{background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.1);text-align:center}.stat-num{font-size:28px;font-weight:700;color:#4f46e5}.stat-label{font-size:13px;color:#6b7280;margin-top:4px}.nav{display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap}.nav a{padding:8px 16px;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;color:#475569;background:#f1f5f9;transition:.15s}.nav a:hover{background:#e2e8f0}.nav a.active{background:#4f46e5;color:#fff}.empty{text-align:center;padding:40px;color:#6b7280}.form-row{display:grid;grid-template-columns:1fr 1fr;gap:14px}.form-row-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px}.progress-bar{height:8px;background:#e5e7eb;border-radius:4px;overflow:hidden}.progress-fill{height:100%;background:#4f46e5;border-radius:4px}</style>';

  /* ── Database Migration ── */
  (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS labs (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, name VARCHAR(200) NOT NULL,
        type VARCHAR(100) DEFAULT 'science', location VARCHAR(200),
        capacity INT DEFAULT 30, status VARCHAR(50) DEFAULT 'active',
        in_charge VARCHAR(200), description TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      await pool.query(`CREATE TABLE IF NOT EXISTS lab_equipment (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, lab_id INT,
        name VARCHAR(200) NOT NULL, serial_number VARCHAR(100),
        condition VARCHAR(50) DEFAULT 'good', status VARCHAR(50) DEFAULT 'available',
        calibration_due DATE, last_calibration DATE,
        purchase_date DATE, cost NUMERIC(10,2) DEFAULT 0,
        checked_out_by INT, checked_out_at TIMESTAMPTZ,
        notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      await pool.query(`CREATE TABLE IF NOT EXISTS lab_bookings (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, lab_id INT,
        user_id INT, purpose VARCHAR(300),
        date DATE NOT NULL, start_time TIME NOT NULL, end_time TIME NOT NULL,
        status VARCHAR(50) DEFAULT 'pending', attendees INT DEFAULT 0,
        notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      await pool.query(`CREATE TABLE IF NOT EXISTS lab_chemicals (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, lab_id INT,
        name VARCHAR(200) NOT NULL, cas_number VARCHAR(50),
        quantity NUMERIC(10,2) DEFAULT 0, unit VARCHAR(20) DEFAULT 'mL',
        hazard_level VARCHAR(20) DEFAULT 'low',
        storage_location VARCHAR(200), expiry_date DATE,
        supplier VARCHAR(200), batch_number VARCHAR(100),
        notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      await pool.query(`CREATE TABLE IF NOT EXISTS lab_incidents (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, lab_id INT,
        reporter_id INT, description TEXT NOT NULL,
        severity VARCHAR(20) DEFAULT 'low', action_taken TEXT,
        date DATE NOT NULL, status VARCHAR(50) DEFAULT 'open',
        follow_up TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      await pool.query(`CREATE TABLE IF NOT EXISTS lab_maintenance (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, lab_id INT,
        equipment_id INT, description TEXT NOT NULL,
        priority VARCHAR(20) DEFAULT 'medium',
        requested_by INT, assigned_to INT,
        scheduled_date DATE, completed_date DATE,
        cost NUMERIC(10,2) DEFAULT 0, status VARCHAR(50) DEFAULT 'reported',
        notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      await pool.query(`CREATE TABLE IF NOT EXISTS lab_safety_training (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL,
        title VARCHAR(200) NOT NULL, description TEXT,
        trainer VARCHAR(200), training_date DATE NOT NULL,
        duration_minutes INT DEFAULT 60, location VARCHAR(200),
        status VARCHAR(50) DEFAULT 'scheduled',
        max_participants INT DEFAULT 30, created_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      await pool.query(`CREATE TABLE IF NOT EXISTS lab_safety_training_attendance (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL,
        training_id INT NOT NULL, user_id INT NOT NULL,
        attended BOOLEAN DEFAULT false, score INT,
        certificate_issued BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      await pool.query(`CREATE TABLE IF NOT EXISTS lab_protocols (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, lab_id INT,
        title VARCHAR(200) NOT NULL, description TEXT,
        procedure TEXT, safety_notes TEXT,
        materials TEXT, created_by INT,
        status VARCHAR(50) DEFAULT 'draft',
        version INT DEFAULT 1, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      await pool.query(`CREATE TABLE IF NOT EXISTS lab_usage_logs (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, lab_id INT,
        user_id INT, activity VARCHAR(100) NOT NULL,
        details TEXT, logged_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      await pool.query(`CREATE TABLE IF NOT EXISTS lab_budget (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, lab_id INT,
        category VARCHAR(100), description VARCHAR(300),
        amount NUMERIC(12,2) DEFAULT 0, budget_type VARCHAR(20) DEFAULT 'expense',
        fiscal_year VARCHAR(10), approved_by INT,
        status VARCHAR(50) DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      /* Indexes */
      const idxs = [
        'CREATE INDEX IF NOT EXISTS idx_labs_tenant ON labs(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_labs_status ON labs(tenant_id, status)',
        'CREATE INDEX IF NOT EXISTS idx_lequip_tenant ON lab_equipment(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_lequip_lab ON lab_equipment(tenant_id, lab_id)',
        'CREATE INDEX IF NOT EXISTS idx_lbook_tenant ON lab_bookings(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_lbook_lab ON lab_bookings(tenant_id, lab_id)',
        'CREATE INDEX IF NOT EXISTS idx_lbook_date ON lab_bookings(date)',
        'CREATE INDEX IF NOT EXISTS idx_lchem_tenant ON lab_chemicals(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_lchem_lab ON lab_chemicals(tenant_id, lab_id)',
        'CREATE INDEX IF NOT EXISTS idx_linc_tenant ON lab_incidents(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_lmaint_tenant ON lab_maintenance(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_lst_tenant ON lab_safety_training(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_lusage_tenant ON lab_usage_logs(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_lbudget_tenant ON lab_budget(tenant_id)'
      ];
      for (const sql of idxs) { try { await pool.query(sql); } catch (_) { /* ignore */ } }

      console.log('[LabManager] Tables ready');
    } catch (e) { console.warn('[LabManager] Migration warning:', e.message); }
  })();

  /* ── Helpers ── */
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const fmtMoney = (n) => '$' + Number(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const today = () => new Date().toISOString().slice(0, 10);

  function nav(active) {
    const links = [
      ['/school/lab-manager', 'Dashboard'],
      ['/school/lab-manager/labs', 'Labs'],
      ['/school/lab-manager/equipment', 'Equipment'],
      ['/school/lab-manager/bookings', 'Bookings'],
      ['/school/lab-manager/chemicals', 'Chemicals'],
      ['/school/lab-manager/incidents', 'Incidents'],
      ['/school/lab-manager/calibration', 'Calibration'],
      ['/school/lab-manager/maintenance', 'Maintenance'],
      ['/school/lab-manager/protocols', 'Protocols'],
      ['/school/lab-manager/budget', 'Budget'],
      ['/school/lab-manager/safety-training', 'Safety Training'],
      ['/school/lab-manager/usage-logs', 'Usage Logs']
    ];
    return '<div class="nav">' + links.map(([href, label]) =>
      `<a href="${href}" class="${active === href ? 'active' : ''}">${label}</a>`
    ).join('') + '</div>';
  }

  /* ════════════════════════════════════════════════════════════════
     ROUTE 1: GET /school/lab-manager — Dashboard
     ════════════════════════════════════════════════════════════════ */
  app.get('/school/lab-manager', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const [labCount] = await pool.query('SELECT COUNT(*) as total, SUM(CASE WHEN status=$1 THEN 1 ELSE 0 END) as active FROM labs WHERE tenant_id=$2', ['active', tid]);
    const [equipCount] = await pool.query('SELECT COUNT(*) as total, SUM(CASE WHEN status=$1 THEN 1 ELSE 0 END) as available, SUM(CASE WHEN status=$2 THEN 1 ELSE 0 END) as in_use, SUM(cost) as total_cost FROM lab_equipment WHERE tenant_id=$3', ['available', 'in_use', tid]);
    const [bookingCount] = await pool.query('SELECT COUNT(*) as total FROM lab_bookings WHERE tenant_id=$1 AND date=$2', [tid, today()]);
    const [incidentCount] = await pool.query('SELECT COUNT(*) as total, SUM(CASE WHEN status=$1 THEN 1 ELSE 0 END) as open FROM lab_incidents WHERE tenant_id=$2', ['open', tid]);
    const [chemicalCount] = await pool.query('SELECT COUNT(*) as total, SUM(CASE WHEN hazard_level=$1 THEN 1 ELSE 0 END) as critical, SUM(CASE WHEN expiry_date < CURRENT_DATE THEN 1 ELSE 0 END) as expired FROM lab_chemicals WHERE tenant_id=$2', ['critical', tid]);
    const [maintCount] = await pool.query('SELECT COUNT(*) as open_req FROM lab_maintenance WHERE tenant_id=$1 AND status IN ($2,$3)', [tid, 'reported', 'in_progress']);
    const [calDue] = await pool.query('SELECT COUNT(*) as due_soon FROM lab_equipment WHERE tenant_id=$1 AND calibration_due IS NOT NULL AND calibration_due <= CURRENT_DATE + INTERVAL $2 AND calibration_due >= CURRENT_DATE', [tid, '30 days']);
    const [calOverdue] = await pool.query('SELECT COUNT(*) as overdue FROM lab_equipment WHERE tenant_id=$1 AND calibration_due IS NOT NULL AND calibration_due < CURRENT_DATE', [tid]);
    const [recentLogs] = await pool.query('SELECT lul.*, l.name as lab_name FROM lab_usage_logs lul LEFT JOIN labs l ON l.id=lul.lab_id WHERE lul.tenant_id=$1 ORDER BY lul.logged_at DESC LIMIT 10', [tid]);
    const [budgetSum] = await pool.query('SELECT COALESCE(SUM(CASE WHEN budget_type=$1 THEN amount ELSE 0 END),0) as expenses, COALESCE(SUM(CASE WHEN budget_type=$2 THEN amount ELSE 0 END),0) as allocations FROM lab_budget WHERE tenant_id=$3', ['expense', 'allocation', tid]);

    const logRows = recentLogs.map(l => `<tr>
      <td>${esc(l.lab_name || '—')}</td>
      <td>${esc(l.activity)}</td>
      <td>${esc(l.details || '').substring(0, 60)}</td>
      <td>${new Date(l.logged_at).toLocaleString()}</td>
    </tr>`).join('');

    const alerts = [];
    if (Number(incidentCount[0].open) > 0) alerts.push(`<div style="background:#fef2f2;border:1px solid #fecaca;color:#991b1b;padding:12px;border-radius:10px;margin-bottom:12px"><strong>${incidentCount[0].open} open incident(s)</strong> require attention</div>`);
    if (Number(chemicalCount[0].expired) > 0) alerts.push(`<div style="background:#fef2f2;border:1px solid #fecaca;color:#991b1b;padding:12px;border-radius:10px;margin-bottom:12px"><strong>${chemicalCount[0].expired} chemical(s) expired</strong></div>`);
    if (Number(calOverdue[0].overdue) > 0) alerts.push(`<div style="background:#fef2f2;border:1px solid #fecaca;color:#991b1b;padding:12px;border-radius:10px;margin-bottom:12px"><strong>${calOverdue[0].overdue} equipment calibration(s) overdue</strong></div>`);
    if (alerts.length === 0) alerts.push(`<div style="background:#f0fdf4;border:1px solid #bbf7d0;color:#166534;padding:12px;border-radius:10px;margin-bottom:12px">All clear — no active alerts.</div>`);

    const html = `${SKIP}<div style="max-width:1200px;margin:0 auto;padding:20px">
      ${nav('/school/lab-manager')}
      <h1 style="color:${P};margin-bottom:4px">🧪 Lab Manager</h1>
      <p style="color:${GRAY};margin-bottom:20px">Laboratory inventory, scheduling, safety and compliance management</p>
      <div class="grid" style="margin-bottom:20px">
        <div class="stat-card"><div class="stat-num">${labCount[0].total}</div><div class="stat-label">Total Labs</div></div>
        <div class="stat-card"><div class="stat-num">${equipCount[0].total}</div><div class="stat-label">Equipment Items</div></div>
        <div class="stat-card"><div class="stat-num">${bookingCount[0].total}</div><div class="stat-label">Today's Bookings</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#dc2626">${incidentCount[0].open}</div><div class="stat-label">Open Incidents</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#d97706">${chemicalCount[0].critical}</div><div class="stat-label">Critical Chemicals</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#dc2626">${calOverdue[0].overdue}</div><div class="stat-label">Overdue Calibrations</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#d97706">${maintCount[0].open_req}</div><div class="stat-label">Open Maint. Requests</div></div>
        <div class="stat-card"><div class="stat-num">${Number(budgetSum[0].allocations) > 0 ? Math.round((Number(budgetSum[0].expenses) / Number(budgetSum[0].allocations)) * 100) : 0}%</div><div class="stat-label">Budget Used</div></div>
      </div>
      ${alerts.join('')}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
        <div class="card">
          <h3 style="margin:0 0 12px">📊 Equipment Summary</h3>
          <div style="display:flex;gap:16px;flex-wrap:wrap">
            <div style="text-align:center"><div style="font-size:24px;font-weight:700;color:#059669">${equipCount[0].available}</div><div style="font-size:12px;color:${GRAY}">Available</div></div>
            <div style="text-align:center"><div style="font-size:24px;font-weight:700;color:#d97706">${equipCount[0].in_use}</div><div style="font-size:12px;color:${GRAY}">In Use</div></div>
            <div style="text-align:center"><div style="font-size:24px;font-weight:700;color:${P}">${calDue[0].due_soon}</div><div style="font-size:12px;color:${GRAY}">Cal Due (30d)</div></div>
            <div style="text-align:center"><div style="font-size:24px;font-weight:700;color:#4f46e5">${fmtMoney(equipCount[0].total_cost)}</div><div style="font-size:12px;color:${GRAY}">Total Value</div></div>
          </div>
        </div>
        <div class="card">
          <h3 style="margin:0 0 12px">🧪 Chemical Summary</h3>
          <div style="display:flex;gap:16px;flex-wrap:wrap">
            <div style="text-align:center"><div style="font-size:24px;font-weight:700;color:${P}">${chemicalCount[0].total}</div><div style="font-size:12px;color:${GRAY}">Total Chemicals</div></div>
            <div style="text-align:center"><div style="font-size:24px;font-weight:700;color:#dc2626">${chemicalCount[0].critical}</div><div style="font-size:12px;color:${GRAY}">Critical</div></div>
            <div style="text-align:center"><div style="font-size:24px;font-weight:700;color:#dc2626">${chemicalCount[0].expired}</div><div style="font-size:12px;color:${GRAY}">Expired</div></div>
          </div>
        </div>
      </div>
      <div class="card">
        <h3 style="margin:0 0 12px">📋 Recent Activity</h3>
        <div style="overflow-x:auto"><table><thead><tr><th>Lab</th><th>Activity</th><th>Details</th><th>Time</th></tr></thead>
        <tbody>${logRows || '<tr><td colspan="4" class="empty">No recent activity</td></tr>'}</tbody></table></div>
      </div>
    </div>`;
    res.send(renderPage(req, html, 'Lab Manager'));
  }));

  /* ════════════════════════════════════════════════════════════════
     ROUTE 2: GET /school/lab-manager/labs — Labs List
     ════════════════════════════════════════════════════════════════ */
  app.get('/school/lab-manager/labs', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const [labs] = await pool.query('SELECT l.*, (SELECT COUNT(*) FROM lab_equipment WHERE lab_id=l.id AND tenant_id=l.tenant_id) as equip_count FROM labs l WHERE l.tenant_id=$1 ORDER BY l.name', [tid]);
    const rows = labs.map(l => `<tr>
      <td><a href="/school/lab-manager/labs/${l.id}" style="color:${P};text-decoration:none;font-weight:600">${esc(l.name)}</a></td>
      <td>${esc(l.type || '—')}</td>
      <td>${esc(l.location || '—')}</td>
      <td>${l.capacity || '—'}</td>
      <td>${l.equip_count || 0}</td>
      <td><span class="badge badge-${l.status}">${esc(l.status)}</span></td>
      <td>${esc(l.in_charge || '—')}</td>
      <td><a href="/school/lab-manager/labs/${l.id}" class="btn btn-sm">View</a>
        <button class="btn btn-sm btn-danger" onclick="deleteLab(${l.id})">Delete</button></td>
    </tr>`).join('');

    const html = `${SKIP}<div style="max-width:1200px;margin:0 auto;padding:20px">
      ${nav('/school/lab-manager/labs')}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h1 style="color:${P};margin:0">🏛️ Labs</h1>
        <a href="/school/lab-manager/labs/new" class="btn">+ Add Lab</a>
      </div>
      <div class="card"><div style="overflow-x:auto"><table>
        <thead><tr><th>Name</th><th>Type</th><th>Location</th><th>Capacity</th><th>Equipment</th><th>Status</th><th>In Charge</th><th>Actions</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="8" class="empty">No labs added yet</td></tr>'}</tbody>
      </table></div></div>
      <script>function deleteLab(id){if(confirm('Delete this lab and all its equipment?'))fetch('/school/lab-manager/labs/'+id,{method:'DELETE',headers:{'X-Requested-With':'XMLHttpRequest'}}).then(r=>{if(r.ok)location.reload()})}</script>
    </div>`;
    res.send(renderPage(req, html, 'Labs'));
  }));

  /* ── Add Lab Form ── */
  app.get('/school/lab-manager/labs/new', requireAuth, requireNotBanned, (req, res) => {
    const html = `${SKIP}<div style="max-width:700px;margin:0 auto;padding:20px">
      ${nav('/school/lab-manager/labs')}
      <h1 style="color:${P};margin-bottom:20px">➕ Add Lab</h1>
      <form method="POST" action="/school/lab-manager/labs" class="card">
        <div class="form-row">
          <div><label>Lab Name *</label><input name="name" required placeholder="e.g. Chemistry Lab A"></div>
          <div><label>Type</label><select name="type">
            <option value="science">Science</option><option value="chemistry">Chemistry</option>
            <option value="physics">Physics</option><option value="biology">Biology</option>
            <option value="computer">Computer</option><option value="multimedia">Multimedia</option>
          </select></div>
        </div>
        <div class="form-row" style="margin-top:12px">
          <div><label>Location</label><input name="location" placeholder="e.g. Building B, Room 201"></div>
          <div><label>Capacity</label><input type="number" name="capacity" value="30" min="1"></div>
        </div>
        <div class="form-row" style="margin-top:12px">
          <div><label>In Charge</label><input name="in_charge" placeholder="e.g. Dr. Smith"></div>
          <div><label>Status</label><select name="status">
            <option value="active">Active</option><option value="inactive">Inactive</option><option value="maintenance">Under Maintenance</option>
          </select></div>
        </div>
        <div style="margin-top:12px"><label>Description</label><textarea name="description" rows="2" placeholder="Optional lab description"></textarea></div>
        <div style="margin-top:16px"><button type="submit" class="btn">Save Lab</button>
          <a href="/school/lab-manager/labs" class="btn" style="background:#6b7280;text-decoration:none;margin-left:8px">Cancel</a></div>
      </form>
    </div>`;
    res.send(renderPage(req, html, 'Add Lab'));
  });

  /* ── Save Lab ── */
  app.post('/school/lab-manager/labs', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const { name, type, location, capacity, status, in_charge, description } = req.body;
    if (!name || !name.trim()) return res.status(400).send('Lab name is required');
    await pool.query(
      'INSERT INTO labs(tenant_id,name,type,location,capacity,status,in_charge,description) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [tid, name.trim(), type || 'science', location || null, parseInt(capacity) || 30, status || 'active', in_charge || null, description || null]
    );
    audit(req, 'lab_create', { name });
    res.redirect('/school/lab-manager/labs');
  }));

  /* ── Lab Detail ── */
  app.get('/school/lab-manager/labs/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const lid = Number(req.params.id);
    const [labs] = await pool.query('SELECT * FROM labs WHERE tenant_id=$1 AND id=$2', [tid, lid]);
    if (!labs.length) return res.status(404).send('Lab not found');
    const lab = labs[0];
    const [equip] = await pool.query('SELECT * FROM lab_equipment WHERE tenant_id=$1 AND lab_id=$2 ORDER BY name', [tid, lid]);
    const [chemicals] = await pool.query('SELECT * FROM lab_chemicals WHERE tenant_id=$1 AND lab_id=$2 ORDER BY name', [tid, lid]);
    const [bookings] = await pool.query('SELECT * FROM lab_bookings WHERE tenant_id=$1 AND lab_id=$2 AND date >= CURRENT_DATE ORDER BY date, start_time LIMIT 10', [tid, lid]);

    const equipRows = equip.map(e => `<tr>
      <td>${esc(e.name)}</td><td>${esc(e.serial_number || '—')}</td>
      <td><span class="badge badge-${e.status}">${esc(e.status)}</span></td>
      <td>${esc(e.condition || '—')}</td>
      <td>${e.calibration_due ? fmtDate(e.calibration_due) : '—'}</td>
      <td>${fmtMoney(e.cost)}</td></tr>`).join('');

    const chemRows = chemicals.map(c => `<tr>
      <td>${esc(c.name)}</td><td>${esc(c.cas_number || '—')}</td>
      <td>${c.quantity} ${esc(c.unit)}</td>
      <td><span class="badge badge-${c.hazard_level}">${esc(c.hazard_level)}</span></td>
      <td>${c.expiry_date ? fmtDate(c.expiry_date) : '—'}</td></tr>`).join('');

    const bookingRows = bookings.map(b => `<tr>
      <td>${fmtDate(b.date)}</td><td>${b.start_time} - ${b.end_time}</td>
      <td>${esc(b.purpose || '—')}</td>
      <td><span class="badge badge-${b.status}">${esc(b.status)}</span></td></tr>`).join('');

    const html = `${SKIP}<div style="max-width:1200px;margin:0 auto;padding:20px">
      ${nav('/school/lab-manager/labs')}
      <a href="/school/lab-manager/labs" style="color:${GRAY};text-decoration:none;font-size:14px">← Back to Labs</a>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;margin-bottom:16px;flex-wrap:wrap;gap:8px">
        <div><h1 style="color:${P};margin:0">${esc(lab.name)}</h1>
          <p style="color:${GRAY};margin:4px 0 0">${esc(lab.type)} · ${esc(lab.location)} · Capacity: ${lab.capacity} · <span class="badge badge-${lab.status}">${esc(lab.status)}</span></p></div>
        <div style="display:flex;gap:8px">
          <a href="/school/lab-manager/equipment/new?lab_id=${lid}" class="btn btn-sm">+ Equipment</a>
          <a href="/school/lab-manager/chemicals/new?lab_id=${lid}" class="btn btn-sm">+ Chemical</a>
          <a href="/school/lab-manager/bookings/new?lab_id=${lid}" class="btn btn-sm btn-success">+ Book</a>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
        <div class="card"><h3 style="margin:0 0 12px">📦 Equipment (${equip.length})</h3>
          <div style="overflow-x:auto"><table><thead><tr><th>Name</th><th>Serial #</th><th>Status</th><th>Condition</th><th>Cal. Due</th><th>Cost</th></tr></thead>
          <tbody>${equipRows || '<tr><td colspan="6" class="empty">No equipment</td></tr>'}</tbody></table></div></div>
        <div class="card"><h3 style="margin:0 0 12px">🧪 Chemicals (${chemicals.length})</h3>
          <div style="overflow-x:auto"><table><thead><tr><th>Name</th><th>CAS #</th><th>Qty</th><th>Hazard</th><th>Expiry</th></tr></thead>
          <tbody>${chemRows || '<tr><td colspan="5" class="empty">No chemicals</td></tr>'}</tbody></table></div></div>
      </div>
      <div class="card"><h3 style="margin:0 0 12px">📅 Upcoming Bookings (${bookings.length})</h3>
        <div style="overflow-x:auto"><table><thead><tr><th>Date</th><th>Time</th><th>Purpose</th><th>Status</th></tr></thead>
        <tbody>${bookingRows || '<tr><td colspan="4" class="empty">No upcoming bookings</td></tr>'}</tbody></table></div></div>
    </div>`;
    res.send(renderPage(req, html, lab.name));
  }));

  /* ── Delete Lab ── */
  app.delete('/school/lab-manager/labs/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const lid = Number(req.params.id);
    await pool.query('DELETE FROM lab_equipment WHERE tenant_id=$1 AND lab_id=$2', [tid, lid]);
    await pool.query('DELETE FROM lab_chemicals WHERE tenant_id=$1 AND lab_id=$2', [tid, lid]);
    await pool.query('DELETE FROM labs WHERE tenant_id=$1 AND id=$2', [tid, lid]);
    audit(req, 'lab_delete', { lab_id: lid });
    res.json({ ok: true });
  }));

  /* ════════════════════════════════════════════════════════════════
     ROUTE 3: Equipment CRUD
     ════════════════════════════════════════════════════════════════ */
  app.get('/school/lab-manager/equipment', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const filter = req.query.status || '';
    let sql = 'SELECT le.*, l.name as lab_name FROM lab_equipment le LEFT JOIN labs l ON l.id=le.lab_id WHERE le.tenant_id=$1';
    const params = [tid];
    if (filter) { sql += ' AND le.status=$2'; params.push(filter); }
    sql += ' ORDER BY le.name';
    const [items] = await pool.query(sql, params);
    const rows = items.map(e => `<tr>
      <td><strong>${esc(e.name)}</strong></td>
      <td>${esc(e.lab_name || '—')}</td>
      <td>${esc(e.serial_number || '—')}</td>
      <td><span class="badge badge-${e.condition}">${esc(e.condition)}</span></td>
      <td><span class="badge badge-${e.status}">${esc(e.status)}</span></td>
      <td>${e.calibration_due ? `<span class="badge badge-${e.calibration_due < today() ? 'overdue' : (e.calibration_due <= new Date(Date.now() + 30*86400000).toISOString().slice(0,10) ? 'due_soon' : 'ok')}">${fmtDate(e.calibration_due)}</span>` : '—'}</td>
      <td>${fmtMoney(e.cost)}</td>
      <td>
        ${e.status === 'available' ? `<form method="POST" action="/school/lab-manager/equipment/${e.id}/checkout" style="display:inline"><button class="btn btn-sm btn-warning">Checkout</button></form>` : ''}
        ${e.status === 'in_use' ? `<form method="POST" action="/school/lab-manager/equipment/${e.id}/return" style="display:inline"><button class="btn btn-sm btn-success">Return</button></form>` : ''}
        <button class="btn btn-sm btn-danger" onclick="deleteEquip(${e.id})">Delete</button>
      </td>
    </tr>`).join('');

    const html = `${SKIP}<div style="max-width:1200px;margin:0 auto;padding:20px">
      ${nav('/school/lab-manager/equipment')}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h1 style="color:${P};margin:0">📦 Equipment</h1>
        <a href="/school/lab-manager/equipment/new" class="btn">+ Add Equipment</a>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
        ${['','available','in_use','maintenance','retired'].map(s => `<a href="/school/lab-manager/equipment${s ? '?status='+s : ''}" class="btn btn-sm" style="background:${(!s && !filter) || s === filter ? P : '#f1f5f9'};text-decoration:none">${s || 'All'}</a>`).join('')}
      </div>
      <div class="card"><div style="overflow-x:auto"><table>
        <thead><tr><th>Name</th><th>Lab</th><th>Serial #</th><th>Condition</th><th>Status</th><th>Calibration</th><th>Cost</th><th>Actions</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="8" class="empty">No equipment found</td></tr>'}</tbody>
      </table></div></div>
      <script>function deleteEquip(id){if(confirm('Delete this equipment?'))fetch('/school/lab-manager/equipment/'+id,{method:'DELETE',headers:{'X-Requested-With':'XMLHttpRequest'}}).then(r=>{if(r.ok)location.reload()})}</script>
    </div>`;
    res.send(renderPage(req, html, 'Equipment'));
  }));

  /* ── Add Equipment Form ── */
  app.get('/school/lab-manager/equipment/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const [labs] = await pool.query('SELECT id, name FROM labs WHERE tenant_id=$1 AND status=$2 ORDER BY name', [tid, 'active']);
    const labOpts = labs.map(l => `<option value="${l.id}" ${String(l.id) === req.query.lab_id ? 'selected' : ''}>${esc(l.name)}</option>`).join('');
    const html = `${SKIP}<div style="max-width:700px;margin:0 auto;padding:20px">
      ${nav('/school/lab-manager/equipment')}
      <h1 style="color:${P};margin-bottom:20px">➕ Add Equipment</h1>
      <form method="POST" action="/school/lab-manager/equipment" class="card">
        <div class="form-row"><div><label>Name *</label><input name="name" required placeholder="e.g. Digital Microscope"></div>
          <div><label>Lab *</label><select name="lab_id" required><option value="">Select lab...</option>${labOpts}</select></div></div>
        <div class="form-row" style="margin-top:12px"><div><label>Serial Number</label><input name="serial_number"></div>
          <div><label>Condition</label><select name="condition"><option value="good">Good</option><option value="fair">Fair</option><option value="poor">Poor</option><option value="broken">Broken</option></select></div></div>
        <div class="form-row" style="margin-top:12px"><div><label>Purchase Date</label><input type="date" name="purchase_date"></div>
          <div><label>Cost ($)</label><input type="number" name="cost" step="0.01" min="0" value="0"></div></div>
        <div class="form-row" style="margin-top:12px"><div><label>Last Calibration</label><input type="date" name="last_calibration"></div>
          <div><label>Calibration Due</label><input type="date" name="calibration_due"></div></div>
        <div style="margin-top:12px"><label>Notes</label><textarea name="notes" rows="2"></textarea></div>
        <div style="margin-top:16px"><button type="submit" class="btn">Save Equipment</button>
          <a href="/school/lab-manager/equipment" class="btn" style="background:#6b7280;text-decoration:none;margin-left:8px">Cancel</a></div>
      </form>
    </div>`;
    res.send(renderPage(req, html, 'Add Equipment'));
  }));

  /* ── Save Equipment ── */
  app.post('/school/lab-manager/equipment', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const { name, lab_id, serial_number, condition, purchase_date, cost, last_calibration, calibration_due, notes } = req.body;
    if (!name || !name.trim() || !lab_id) return res.status(400).send('Name and Lab are required');
    await pool.query(
      'INSERT INTO lab_equipment(tenant_id,lab_id,name,serial_number,condition,status,purchase_date,cost,last_calibration,calibration_due,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [tid, Number(lab_id), name.trim(), serial_number || null, condition || 'good', 'available', purchase_date || null, parseFloat(cost) || 0, last_calibration || null, calibration_due || null, notes || null]
    );
    await pool.query('INSERT INTO lab_usage_logs(tenant_id,lab_id,user_id,activity,details) VALUES($1,$2,$3,$4,$5)',
      [tid, Number(lab_id), req.user.id, 'equipment_added', 'Added equipment: ' + name.trim()]);
    audit(req, 'lab_equipment_create', { name });
    res.redirect('/school/lab-manager/equipment');
  }));

  /* ── Equipment Checkout ── */
  app.post('/school/lab-manager/equipment/:id/checkout', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const eid = Number(req.params.id);
    await pool.query('UPDATE lab_equipment SET status=$1, checked_out_by=$2, checked_out_at=NOW(), updated_at=NOW() WHERE tenant_id=$3 AND id=$4 AND status=$5',
      ['in_use', req.user.id, tid, eid, 'available']);
    const [eq] = await pool.query('SELECT lab_id, name FROM lab_equipment WHERE id=$1 AND tenant_id=$2', [eid, tid]);
    if (eq.length) {
      await pool.query('INSERT INTO lab_usage_logs(tenant_id,lab_id,user_id,activity,details) VALUES($1,$2,$3,$4,$5)',
        [tid, eq[0].lab_id, req.user.id, 'equipment_checkout', 'Checked out: ' + eq[0].name]);
    }
    audit(req, 'lab_equipment_checkout', { equipment_id: eid });
    res.redirect('/school/lab-manager/equipment');
  }));

  /* ── Equipment Return ── */
  app.post('/school/lab-manager/equipment/:id/return', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const eid = Number(req.params.id);
    await pool.query('UPDATE lab_equipment SET status=$1, checked_out_by=NULL, checked_out_at=NULL, updated_at=NOW() WHERE tenant_id=$2 AND id=$3 AND status=$4',
      ['available', tid, eid, 'in_use']);
    const [eq] = await pool.query('SELECT lab_id, name FROM lab_equipment WHERE id=$1 AND tenant_id=$2', [eid, tid]);
    if (eq.length) {
      await pool.query('INSERT INTO lab_usage_logs(tenant_id,lab_id,user_id,activity,details) VALUES($1,$2,$3,$4,$5)',
        [tid, eq[0].lab_id, req.user.id, 'equipment_return', 'Returned: ' + eq[0].name]);
    }
    audit(req, 'lab_equipment_return', { equipment_id: eid });
    res.redirect('/school/lab-manager/equipment');
  }));

  /* ── Delete Equipment ── */
  app.delete('/school/lab-manager/equipment/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    await pool.query('DELETE FROM lab_equipment WHERE tenant_id=$1 AND id=$2', [tid, Number(req.params.id)]);
    res.json({ ok: true });
  }));

  /* ════════════════════════════════════════════════════════════════
     ROUTE 4: Lab Bookings
     ════════════════════════════════════════════════════════════════ */
  app.get('/school/lab-manager/bookings', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const [bookings] = await pool.query(
      'SELECT lb.*, l.name as lab_name, u.name as user_name FROM lab_bookings lb LEFT JOIN labs l ON l.id=lb.lab_id LEFT JOIN users u ON u.id=lb.user_id WHERE lb.tenant_id=$1 ORDER BY lb.date DESC, lb.start_time DESC LIMIT 100', [tid]);
    const rows = bookings.map(b => `<tr>
      <td>${esc(b.lab_name || '—')}</td><td>${fmtDate(b.date)}</td>
      <td>${b.start_time} - ${b.end_time}</td><td>${esc(b.user_name || '—')}</td>
      <td>${esc((b.purpose || '').substring(0, 80))}</td>
      <td>${b.attendees || 0}</td>
      <td><span class="badge badge-${b.status}">${esc(b.status)}</span></td>
      <td>${b.status === 'pending' ? `<form method="POST" action="/school/lab-manager/bookings/${b.id}/approve" style="display:inline"><button class="btn btn-sm btn-success">Approve</button></form>
        <form method="POST" action="/school/lab-manager/bookings/${b.id}/reject" style="display:inline"><button class="btn btn-sm btn-danger">Reject</button></form>` : '—'}</td>
    </tr>`).join('');

    const html = `${SKIP}<div style="max-width:1200px;margin:0 auto;padding:20px">
      ${nav('/school/lab-manager/bookings')}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h1 style="color:${P};margin:0">📅 Lab Bookings</h1>
        <a href="/school/lab-manager/bookings/new" class="btn">+ New Booking</a>
      </div>
      <div class="card"><div style="overflow-x:auto"><table>
        <thead><tr><th>Lab</th><th>Date</th><th>Time</th><th>User</th><th>Purpose</th><th>Attendees</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="8" class="empty">No bookings found</td></tr>'}</tbody>
      </table></div></div>
    </div>`;
    res.send(renderPage(req, html, 'Lab Bookings'));
  }));

  /* ── New Booking Form ── */
  app.get('/school/lab-manager/bookings/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const [labs] = await pool.query('SELECT id, name FROM labs WHERE tenant_id=$1 AND status=$2 ORDER BY name', [tid, 'active']);
    const labOpts = labs.map(l => `<option value="${l.id}" ${String(l.id) === req.query.lab_id ? 'selected' : ''}>${esc(l.name)}</option>`).join('');
    const html = `${SKIP}<div style="max-width:700px;margin:0 auto;padding:20px">
      ${nav('/school/lab-manager/bookings')}
      <h1 style="color:${P};margin-bottom:20px">📅 Book a Lab</h1>
      <form method="POST" action="/school/lab-manager/bookings" class="card">
        <div class="form-row"><div><label>Lab *</label><select name="lab_id" required><option value="">Select...</option>${labOpts}</select></div>
          <div><label>Attendees</label><input type="number" name="attendees" value="0" min="0"></div></div>
        <div style="margin-top:12px"><label>Purpose *</label><textarea name="purpose" rows="2" required placeholder="Describe the purpose of this booking"></textarea></div>
        <div class="form-row-3" style="margin-top:12px">
          <div><label>Date *</label><input type="date" name="date" required value="${today()}"></div>
          <div><label>Start Time *</label><input type="time" name="start_time" required value="08:00"></div>
          <div><label>End Time *</label><input type="time" name="end_time" required value="10:00"></div>
        </div>
        <div style="margin-top:12px"><label>Notes</label><textarea name="notes" rows="2"></textarea></div>
        <div style="margin-top:16px"><button type="submit" class="btn">Submit Booking</button>
          <a href="/school/lab-manager/bookings" class="btn" style="background:#6b7280;text-decoration:none;margin-left:8px">Cancel</a></div>
      </form>
    </div>`;
    res.send(renderPage(req, html, 'New Booking'));
  }));

  /* ── Save Booking ── */
  app.post('/school/lab-manager/bookings', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const { lab_id, purpose, date, start_time, end_time, attendees, notes } = req.body;
    if (!lab_id || !date || !start_time || !end_time) return res.status(400).send('Lab, date, start and end times are required');
    await pool.query(
      'INSERT INTO lab_bookings(tenant_id,lab_id,user_id,purpose,date,start_time,end_time,attendees,status,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [tid, Number(lab_id), req.user.id, purpose || null, date, start_time, end_time, parseInt(attendees) || 0, 'pending', notes || null]
    );
    await pool.query('INSERT INTO lab_usage_logs(tenant_id,lab_id,user_id,activity,details) VALUES($1,$2,$3,$4,$5)',
      [tid, Number(lab_id), req.user.id, 'booking_created', 'Booking for ' + date]);
    res.redirect('/school/lab-manager/bookings');
  }));

  /* ── Approve / Reject Booking ── */
  app.post('/school/lab-manager/bookings/:id/approve', requireAuth, requireNotBanned, ah(async (req, res) => {
    await pool.query("UPDATE lab_bookings SET status='approved' WHERE tenant_id=$1 AND id=$2", [req.tenant_id, Number(req.params.id)]);
    res.redirect('/school/lab-manager/bookings');
  }));

  app.post('/school/lab-manager/bookings/:id/reject', requireAuth, requireNotBanned, ah(async (req, res) => {
    await pool.query("UPDATE lab_bookings SET status='rejected' WHERE tenant_id=$1 AND id=$2", [req.tenant_id, Number(req.params.id)]);
    res.redirect('/school/lab-manager/bookings');
  }));

  /* ════════════════════════════════════════════════════════════════
     ROUTE 5: Chemicals Management
     ════════════════════════════════════════════════════════════════ */
  app.get('/school/lab-manager/chemicals', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const [chemicals] = await pool.query(
      'SELECT lc.*, l.name as lab_name FROM lab_chemicals lc LEFT JOIN labs l ON l.id=lc.lab_id WHERE lc.tenant_id=$1 ORDER BY lc.name', [tid]);
    const rows = chemicals.map(c => {
      const isExpired = c.expiry_date && c.expiry_date < today();
      return `<tr>
        <td><strong>${esc(c.name)}</strong></td>
        <td>${esc(c.lab_name || '—')}</td>
        <td>${esc(c.cas_number || '—')}</td>
        <td>${c.quantity} ${esc(c.unit)}</td>
        <td><span class="badge badge-${c.hazard_level}">${esc(c.hazard_level)}</span></td>
        <td>${esc(c.storage_location || '—')}</td>
        <td>${c.expiry_date ? `<span style="${isExpired ? 'color:#dc2626;font-weight:600' : ''}">${fmtDate(c.expiry_date)}</span>` : '—'}</td>
        <td><button class="btn btn-sm btn-danger" onclick="deleteChem(${c.id})">Delete</button></td>
      </tr>`;
    }).join('');

    const html = `${SKIP}<div style="max-width:1200px;margin:0 auto;padding:20px">
      ${nav('/school/lab-manager/chemicals')}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h1 style="color:${P};margin:0">🧪 Chemicals</h1>
        <a href="/school/lab-manager/chemicals/new" class="btn">+ Add Chemical</a>
      </div>
      <div class="card"><div style="overflow-x:auto"><table>
        <thead><tr><th>Name</th><th>Lab</th><th>CAS #</th><th>Quantity</th><th>Hazard</th><th>Storage</th><th>Expiry</th><th>Actions</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="8" class="empty">No chemicals found</td></tr>'}</tbody>
      </table></div></div>
      <script>function deleteChem(id){if(confirm('Delete this chemical record?'))fetch('/school/lab-manager/chemicals/'+id,{method:'DELETE',headers:{'X-Requested-With':'XMLHttpRequest'}}).then(r=>{if(r.ok)location.reload()})}</script>
    </div>`;
    res.send(renderPage(req, html, 'Chemicals'));
  }));

  /* ── Add Chemical Form ── */
  app.get('/school/lab-manager/chemicals/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const [labs] = await pool.query('SELECT id, name FROM labs WHERE tenant_id=$1 AND status=$2 ORDER BY name', [tid, 'active']);
    const labOpts = labs.map(l => `<option value="${l.id}" ${String(l.id) === req.query.lab_id ? 'selected' : ''}>${esc(l.name)}</option>`).join('');
    const html = `${SKIP}<div style="max-width:700px;margin:0 auto;padding:20px">
      ${nav('/school/lab-manager/chemicals')}
      <h1 style="color:${P};margin-bottom:20px">➕ Add Chemical / Reagent</h1>
      <form method="POST" action="/school/lab-manager/chemicals" class="card">
        <div class="form-row"><div><label>Chemical Name *</label><input name="name" required placeholder="e.g. Hydrochloric Acid"></div>
          <div><label>Lab *</label><select name="lab_id" required><option value="">Select...</option>${labOpts}</select></div></div>
        <div class="form-row" style="margin-top:12px"><div><label>CAS Number</label><input name="cas_number" placeholder="e.g. 7647-01-0"></div>
          <div><label>Supplier</label><input name="supplier"></div></div>
        <div class="form-row-3" style="margin-top:12px">
          <div><label>Quantity</label><input type="number" name="quantity" step="0.01" value="0" min="0"></div>
          <div><label>Unit</label><select name="unit"><option>mL</option><option>L</option><option>g</option><option>kg</option><option>mg</option></select></div>
          <div><label>Hazard Level</label><select name="hazard_level"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></div>
        </div>
        <div class="form-row" style="margin-top:12px"><div><label>Storage Location</label><input name="storage_location" placeholder="e.g. Cabinet A3, Flammable Shelf"></div>
          <div><label>Expiry Date</label><input type="date" name="expiry_date"></div></div>
        <div style="margin-top:12px"><label>Notes</label><textarea name="notes" rows="2"></textarea></div>
        <div style="margin-top:16px"><button type="submit" class="btn">Save Chemical</button>
          <a href="/school/lab-manager/chemicals" class="btn" style="background:#6b7280;text-decoration:none;margin-left:8px">Cancel</a></div>
      </form>
    </div>`;
    res.send(renderPage(req, html, 'Add Chemical'));
  }));

  /* ── Save Chemical ── */
  app.post('/school/lab-manager/chemicals', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const { name, lab_id, cas_number, quantity, unit, hazard_level, storage_location, expiry_date, supplier, notes } = req.body;
    if (!name || !name.trim() || !lab_id) return res.status(400).send('Name and Lab are required');
    await pool.query(
      'INSERT INTO lab_chemicals(tenant_id,lab_id,name,cas_number,quantity,unit,hazard_level,storage_location,expiry_date,supplier,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [tid, Number(lab_id), name.trim(), cas_number || null, parseFloat(quantity) || 0, unit || 'mL', hazard_level || 'low', storage_location || null, expiry_date || null, supplier || null, notes || null]
    );
    audit(req, 'lab_chemical_create', { name, hazard_level });
    res.redirect('/school/lab-manager/chemicals');
  }));

  /* ── Delete Chemical ── */
  app.delete('/school/lab-manager/chemicals/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    await pool.query('DELETE FROM lab_chemicals WHERE tenant_id=$1 AND id=$2', [req.tenant_id, Number(req.params.id)]);
    res.json({ ok: true });
  }));

  /* ════════════════════════════════════════════════════════════════
     ROUTE 6: Incidents
     ════════════════════════════════════════════════════════════════ */
  app.get('/school/lab-manager/incidents', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const [incidents] = await pool.query(
      'SELECT li.*, l.name as lab_name, u.name as reporter_name FROM lab_incidents li LEFT JOIN labs l ON l.id=li.lab_id LEFT JOIN users u ON u.id=li.reporter_id WHERE li.tenant_id=$1 ORDER BY li.date DESC', [tid]);
    const rows = incidents.map(i => `<tr>
      <td>${fmtDate(i.date)}</td>
      <td>${esc(i.lab_name || '—')}</td>
      <td>${esc(i.reporter_name || '—')}</td>
      <td><span class="badge badge-${i.severity}">${esc(i.severity)}</span></td>
      <td>${esc((i.description || '').substring(0, 80))}</td>
      <td><span class="badge badge-${i.status}">${esc(i.status)}</span></td>
      <td>
        ${i.status === 'open' ? `<form method="POST" action="/school/lab-manager/incidents/${i.id}/resolve" style="display:inline"><button class="btn btn-sm btn-success">Resolve</button></form>` : ''}
      </td>
    </tr>`).join('');

    const html = `${SKIP}<div style="max-width:1200px;margin:0 auto;padding:20px">
      ${nav('/school/lab-manager/incidents')}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h1 style="color:${P};margin:0">🚨 Incidents</h1>
        <a href="/school/lab-manager/incidents/new" class="btn btn-danger">+ Report Incident</a>
      </div>
      <div class="card"><div style="overflow-x:auto"><table>
        <thead><tr><th>Date</th><th>Lab</th><th>Reporter</th><th>Severity</th><th>Description</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="7" class="empty">No incidents reported</td></tr>'}</tbody>
      </table></div></div>
    </div>`;
    res.send(renderPage(req, html, 'Incidents'));
  }));

  /* ── Report Incident Form ── */
  app.get('/school/lab-manager/incidents/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const [labs] = await pool.query('SELECT id, name FROM labs WHERE tenant_id=$1 ORDER BY name', [tid]);
    const labOpts = labs.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join('');
    const html = `${SKIP}<div style="max-width:700px;margin:0 auto;padding:20px">
      ${nav('/school/lab-manager/incidents')}
      <h1 style="color:${P};margin-bottom:20px">🚨 Report Incident</h1>
      <form method="POST" action="/school/lab-manager/incidents" class="card">
        <div class="form-row"><div><label>Lab</label><select name="lab_id"><option value="">Select...</option>${labOpts}</select></div>
          <div><label>Date *</label><input type="date" name="date" required value="${today()}"></div></div>
        <div class="form-row" style="margin-top:12px"><div><label>Severity *</label><select name="severity" required>
          <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></div></div>
        <div style="margin-top:12px"><label>Description *</label><textarea name="description" rows="3" required placeholder="Describe the incident in detail..."></textarea></div>
        <div style="margin-top:12px"><label>Action Taken</label><textarea name="action_taken" rows="2" placeholder="Immediate actions taken..."></textarea></div>
        <div style="margin-top:16px"><button type="submit" class="btn btn-danger">Submit Report</button>
          <a href="/school/lab-manager/incidents" class="btn" style="background:#6b7280;text-decoration:none;margin-left:8px">Cancel</a></div>
      </form>
    </div>`;
    res.send(renderPage(req, html, 'Report Incident'));
  }));

  /* ── Save Incident ── */
  app.post('/school/lab-manager/incidents', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const { lab_id, date, severity, description, action_taken } = req.body;
    if (!date || !description) return res.status(400).send('Date and description are required');
    await pool.query(
      'INSERT INTO lab_incidents(tenant_id,lab_id,reporter_id,description,severity,action_taken,date,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [tid, lab_id ? Number(lab_id) : null, req.user.id, description, severity || 'low', action_taken || null, date, 'open']
    );
    if (severity === 'critical' || severity === 'high') {
      queueEmail({ to: 'admin@school.com', subject: 'Lab Incident: ' + severity.toUpperCase(), body: description });
    }
    audit(req, 'lab_incident_report', { severity });
    res.redirect('/school/lab-manager/incidents');
  }));

  /* ── Resolve Incident ── */
  app.post('/school/lab-manager/incidents/:id/resolve', requireAuth, requireNotBanned, ah(async (req, res) => {
    await pool.query("UPDATE lab_incidents SET status='resolved', updated_at=NOW() WHERE tenant_id=$1 AND id=$2", [req.tenant_id, Number(req.params.id)]);
    res.redirect('/school/lab-manager/incidents');
  }));

  /* ════════════════════════════════════════════════════════════════
     ROUTE 7: Calibration Schedule
     ════════════════════════════════════════════════════════════════ */
  app.get('/school/lab-manager/calibration', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const [items] = await pool.query(
      'SELECT le.*, l.name as lab_name FROM lab_equipment le LEFT JOIN labs l ON l.id=le.lab_id WHERE le.tenant_id=$1 AND le.calibration_due IS NOT NULL ORDER BY le.calibration_due ASC', [tid]);
    const overdue = items.filter(i => i.calibration_due < today());
    const dueSoon = items.filter(i => i.calibration_due >= today() && i.calibration_due <= new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10));
    const upcoming = items.filter(i => i.calibration_due > new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10));

    const renderItems = (list, label) => {
      if (!list.length) return '';
      const rows = list.map(i => `<tr>
        <td><strong>${esc(i.name)}</strong></td><td>${esc(i.lab_name || '—')}</td>
        <td>${esc(i.serial_number || '—')}</td><td>${fmtDate(i.last_calibration)}</td>
        <td><strong>${fmtDate(i.calibration_due)}</strong></td>
        <td><span class="badge badge-${i.condition}">${esc(i.condition)}</span></td>
        <td><form method="POST" action="/school/lab-manager/calibration/${i.id}/calibrate" style="display:inline"><button class="btn btn-sm btn-success">Calibrate Now</button></form></td>
      </tr>`).join('');
      return `<div class="card"><h3 style="margin:0 0 12px;color:${label === 'Overdue' ? '#dc2626' : label === 'Due Soon (30 days)' ? '#d97706' : P}">${label} (${list.length})</h3>
        <div style="overflow-x:auto"><table><thead><tr><th>Name</th><th>Lab</th><th>Serial #</th><th>Last Cal.</th><th>Due Date</th><th>Condition</th><th>Actions</th></tr></thead>
        <tbody>${rows}</tbody></table></div></div>`;
    };

    const html = `${SKIP}<div style="max-width:1200px;margin:0 auto;padding:20px">
      ${nav('/school/lab-manager/calibration')}
      <h1 style="color:${P};margin-bottom:20px">📏 Calibration Schedule</h1>
      ${renderItems(overdue, 'Overdue')}
      ${renderItems(dueSoon, 'Due Soon (30 days)')}
      ${renderItems(upcoming, 'Upcoming')}
      ${!items.length ? '<div class="card"><p class="empty">No equipment with calibration schedules</p></div>' : ''}
    </div>`;
    res.send(renderPage(req, html, 'Calibration'));
  }));

  /* ── Record Calibration ── */
  app.post('/school/lab-manager/calibration/:id/calibrate', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const eid = Number(req.params.id);
    const [eq] = await pool.query('SELECT calibration_due, lab_id FROM lab_equipment WHERE id=$1 AND tenant_id=$2', [eid, tid]);
    if (!eq.length) return res.status(404).send('Equipment not found');
    const prevDue = eq[0].calibration_due;
    const nextDue = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);
    await pool.query('UPDATE lab_equipment SET last_calibration=CURRENT_DATE, calibration_due=$1, condition=$2, updated_at=NOW() WHERE tenant_id=$3 AND id=$4',
      [nextDue, 'good', tid, eid]);
    await pool.query('INSERT INTO lab_usage_logs(tenant_id,lab_id,user_id,activity,details) VALUES($1,$2,$3,$4,$5)',
      [tid, eq[0].lab_id, req.user.id, 'calibration', 'Equipment calibrated, next due: ' + nextDue]);
    audit(req, 'lab_calibration', { equipment_id: eid });
    res.redirect('/school/lab-manager/calibration');
  }));

  /* ════════════════════════════════════════════════════════════════
     ROUTE 8: Maintenance Requests
     ════════════════════════════════════════════════════════════════ */
  app.get('/school/lab-manager/maintenance', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const [requests] = await pool.query(
      'SELECT lm.*, l.name as lab_name, le.name as equip_name FROM lab_maintenance lm LEFT JOIN labs l ON l.id=lm.lab_id LEFT JOIN lab_equipment le ON le.id=lm.equipment_id WHERE lm.tenant_id=$1 ORDER BY lm.created_at DESC', [tid]);
    const rows = requests.map(r => `<tr>
      <td>${esc(r.lab_name || '—')}</td><td>${esc(r.equip_name || '—')}</td>
      <td>${esc((r.description || '').substring(0, 80))}</td>
      <td><span class="badge badge-${r.priority}">${esc(r.priority)}</span></td>
      <td>${fmtDate(r.scheduled_date)}</td>
      <td>${fmtMoney(r.cost)}</td>
      <td><span class="badge badge-${r.status}">${esc(r.status)}</span></td>
      <td>${r.status !== 'completed' && r.status !== 'cancelled' ? `<form method="POST" action="/school/lab-manager/maintenance/${r.id}/complete" style="display:inline"><button class="btn btn-sm btn-success">Complete</button></form>` : '—'}</td>
    </tr>`).join('');

    const html = `${SKIP}<div style="max-width:1200px;margin:0 auto;padding:20px">
      ${nav('/school/lab-manager/maintenance')}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h1 style="color:${P};margin:0">🔧 Maintenance Requests</h1>
        <a href="/school/lab-manager/maintenance/new" class="btn">+ New Request</a>
      </div>
      <div class="card"><div style="overflow-x:auto"><table>
        <thead><tr><th>Lab</th><th>Equipment</th><th>Description</th><th>Priority</th><th>Scheduled</th><th>Cost</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="8" class="empty">No maintenance requests</td></tr>'}</tbody>
      </table></div></div>
    </div>`;
    res.send(renderPage(req, html, 'Maintenance'));
  }));

  /* ── New Maintenance Request ── */
  app.get('/school/lab-manager/maintenance/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const [labs] = await pool.query('SELECT id, name FROM labs WHERE tenant_id=$1 ORDER BY name', [tid]);
    const [equip] = await pool.query('SELECT id, name FROM lab_equipment WHERE tenant_id=$1 ORDER BY name', [tid]);
    const labOpts = labs.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join('');
    const eqOpts = equip.map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join('');
    const html = `${SKIP}<div style="max-width:700px;margin:0 auto;padding:20px">
      ${nav('/school/lab-manager/maintenance')}
      <h1 style="color:${P};margin-bottom:20px">🔧 New Maintenance Request</h1>
      <form method="POST" action="/school/lab-manager/maintenance" class="card">
        <div class="form-row"><div><label>Lab</label><select name="lab_id"><option value="">General</option>${labOpts}</select></div>
          <div><label>Equipment</label><select name="equipment_id"><option value="">None</option>${eqOpts}</select></div></div>
        <div class="form-row" style="margin-top:12px"><div><label>Priority</label><select name="priority">
          <option value="low">Low</option><option value="medium" selected>Medium</option><option value="high">High</option><option value="critical">Critical</option></select></div>
          <div><label>Scheduled Date</label><input type="date" name="scheduled_date"></div></div>
        <div style="margin-top:12px"><label>Description *</label><textarea name="description" rows="3" required placeholder="Describe the issue..."></textarea></div>
        <div style="margin-top:16px"><button type="submit" class="btn">Submit Request</button>
          <a href="/school/lab-manager/maintenance" class="btn" style="background:#6b7280;text-decoration:none;margin-left:8px">Cancel</a></div>
      </form>
    </div>`;
    res.send(renderPage(req, html, 'New Maintenance Request'));
  }));

  /* ── Save Maintenance Request ── */
  app.post('/school/lab-manager/maintenance', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const { lab_id, equipment_id, priority, scheduled_date, description } = req.body;
    if (!description) return res.status(400).send('Description is required');
    await pool.query(
      'INSERT INTO lab_maintenance(tenant_id,lab_id,equipment_id,description,priority,requested_by,scheduled_date,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [tid, lab_id ? Number(lab_id) : null, equipment_id ? Number(equipment_id) : null, description, priority || 'medium', req.user.id, scheduled_date || null, 'reported']
    );
    audit(req, 'lab_maintenance_create', { priority });
    res.redirect('/school/lab-manager/maintenance');
  }));

  /* ── Complete Maintenance ── */
  app.post('/school/lab-manager/maintenance/:id/complete', requireAuth, requireNotBanned, ah(async (req, res) => {
    await pool.query("UPDATE lab_maintenance SET status='completed', completed_date=CURRENT_DATE, updated_at=NOW() WHERE tenant_id=$1 AND id=$2",
      [req.tenant_id, Number(req.params.id)]);
    res.redirect('/school/lab-manager/maintenance');
  }));

  /* ════════════════════════════════════════════════════════════════
     ROUTE 9: Protocols
     ════════════════════════════════════════════════════════════════ */
  app.get('/school/lab-manager/protocols', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const [protocols] = await pool.query(
      'SELECT lp.*, l.name as lab_name FROM lab_protocols lp LEFT JOIN labs l ON l.id=lp.lab_id WHERE lp.tenant_id=$1 ORDER BY lp.title', [tid]);
    const rows = protocols.map(p => `<tr>
      <td><a href="/school/lab-manager/protocols/${p.id}" style="color:${P};text-decoration:none;font-weight:600">${esc(p.title)}</a></td>
      <td>${esc(p.lab_name || 'General')}</td>
      <td>${esc((p.description || '').substring(0, 80))}</td>
      <td><span class="badge badge-${p.status}">${esc(p.status)}</span></td>
      <td>v${p.version}</td>
      <td>${fmtDate(p.updated_at)}</td>
      <td><button class="btn btn-sm btn-danger" onclick="deleteProtocol(${p.id})">Delete</button></td>
    </tr>`).join('');

    const html = `${SKIP}<div style="max-width:1200px;margin:0 auto;padding:20px">
      ${nav('/school/lab-manager/protocols')}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h1 style="color:${P};margin:0">📋 Experiment Protocols</h1>
        <a href="/school/lab-manager/protocols/new" class="btn">+ Add Protocol</a>
      </div>
      <div class="card"><div style="overflow-x:auto"><table>
        <thead><tr><th>Title</th><th>Lab</th><th>Description</th><th>Status</th><th>Version</th><th>Updated</th><th>Actions</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="7" class="empty">No protocols yet</td></tr>'}</tbody>
      </table></div></div>
      <script>function deleteProtocol(id){if(confirm('Delete this protocol?'))fetch('/school/lab-manager/protocols/'+id,{method:'DELETE',headers:{'X-Requested-With':'XMLHttpRequest'}}).then(r=>{if(r.ok)location.reload()})}</script>
    </div>`;
    res.send(renderPage(req, html, 'Protocols'));
  }));

  /* ── Add Protocol ── */
  app.get('/school/lab-manager/protocols/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const [labs] = await pool.query('SELECT id, name FROM labs WHERE tenant_id=$1 ORDER BY name', [tid]);
    const labOpts = labs.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join('');
    const html = `${SKIP}<div style="max-width:800px;margin:0 auto;padding:20px">
      ${nav('/school/lab-manager/protocols')}
      <h1 style="color:${P};margin-bottom:20px">📋 Add Experiment Protocol</h1>
      <form method="POST" action="/school/lab-manager/protocols" class="card">
        <div class="form-row"><div><label>Title *</label><input name="title" required placeholder="e.g. Acid-Base Titration"></div>
          <div><label>Lab</label><select name="lab_id"><option value="">General</option>${labOpts}</select></div></div>
        <div style="margin-top:12px"><label>Description</label><textarea name="description" rows="2" placeholder="Brief description"></textarea></div>
        <div style="margin-top:12px"><label>Procedure</label><textarea name="procedure" rows="5" placeholder="Step-by-step procedure..."></textarea></div>
        <div style="margin-top:12px"><label>Safety Notes</label><textarea name="safety_notes" rows="3" placeholder="Safety precautions..."></textarea></div>
        <div style="margin-top:12px"><label>Materials Required</label><textarea name="materials" rows="2" placeholder="List of materials..."></textarea></div>
        <div style="margin-top:16px"><button type="submit" class="btn">Save Protocol</button>
          <a href="/school/lab-manager/protocols" class="btn" style="background:#6b7280;text-decoration:none;margin-left:8px">Cancel</a></div>
      </form>
    </div>`;
    res.send(renderPage(req, html, 'Add Protocol'));
  }));

  /* ── Save Protocol ── */
  app.post('/school/lab-manager/protocols', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const { title, lab_id, description, procedure, safety_notes, materials } = req.body;
    if (!title || !title.trim()) return res.status(400).send('Title is required');
    await pool.query(
      'INSERT INTO lab_protocols(tenant_id,lab_id,title,description,procedure,safety_notes,materials,created_by,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [tid, lab_id ? Number(lab_id) : null, title.trim(), description || null, procedure || null, safety_notes || null, materials || null, req.user.id, 'draft']
    );
    res.redirect('/school/lab-manager/protocols');
  }));

  /* ── Protocol Detail ── */
  app.get('/school/lab-manager/protocols/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const pid = Number(req.params.id);
    const [protocols] = await pool.query('SELECT lp.*, l.name as lab_name FROM lab_protocols lp LEFT JOIN labs l ON l.id=lp.lab_id WHERE lp.tenant_id=$1 AND lp.id=$2', [tid, pid]);
    if (!protocols.length) return res.status(404).send('Protocol not found');
    const p = protocols[0];
    const html = `${SKIP}<div style="max-width:900px;margin:0 auto;padding:20px">
      ${nav('/school/lab-manager/protocols')}
      <a href="/school/lab-manager/protocols" style="color:${GRAY};text-decoration:none;font-size:14px">← Back to Protocols</a>
      <div class="card" style="margin-top:12px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <h1 style="color:${P};margin:0">${esc(p.title)}</h1>
          <span class="badge badge-${p.status}">${esc(p.status)}</span>
        </div>
        <p style="color:${GRAY};margin:8px 0 0">${esc(p.lab_name || 'General')} · Version ${p.version} · Updated ${fmtDate(p.updated_at)}</p>
        ${p.description ? `<h3 style="margin-top:20px">Description</h3><p>${esc(p.description)}</p>` : ''}
        ${p.procedure ? `<h3 style="margin-top:20px">Procedure</h3><p style="white-space:pre-wrap">${esc(p.procedure)}</p>` : ''}
        ${p.safety_notes ? `<h3 style="margin-top:20px">Safety Notes</h3><p style="white-space:pre-wrap;color:#dc2626">${esc(p.safety_notes)}</p>` : ''}
        ${p.materials ? `<h3 style="margin-top:20px">Materials</h3><p style="white-space:pre-wrap">${esc(p.materials)}</p>` : ''}
        <form method="POST" action="/school/lab-manager/protocols/${pid}" style="margin-top:20px">
          <div class="form-row"><div><label>Status</label><select name="status">
            <option value="draft" ${p.status === 'draft' ? 'selected' : ''}>Draft</option>
            <option value="published" ${p.status === 'published' ? 'selected' : ''}>Published</option>
            <option value="archived" ${p.status === 'archived' ? 'selected' : ''}>Archived</option></select></div></div>
          <div style="margin-top:12px"><button type="submit" class="btn btn-sm">Update Status</button></div>
        </form>
      </div>
    </div>`;
    res.send(renderPage(req, html, p.title));
  }));

  /* ── Update Protocol Status ── */
  app.post('/school/lab-manager/protocols/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const pid = Number(req.params.id);
    const { status } = req.body;
    if (status === 'published') {
      await pool.query('UPDATE lab_protocols SET status=$1, version=version+1, updated_at=NOW() WHERE tenant_id=$2 AND id=$3', [status, tid, pid]);
    } else {
      await pool.query('UPDATE lab_protocols SET status=$1, updated_at=NOW() WHERE tenant_id=$2 AND id=$3', [status, tid, pid]);
    }
    res.redirect('/school/lab-manager/protocols/' + pid);
  }));

  /* ── Delete Protocol ── */
  app.delete('/school/lab-manager/protocols/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    await pool.query('DELETE FROM lab_protocols WHERE tenant_id=$1 AND id=$2', [req.tenant_id, Number(req.params.id)]);
    res.json({ ok: true });
  }));

  /* ════════════════════════════════════════════════════════════════
     ROUTE 10: Budget Tracking
     ════════════════════════════════════════════════════════════════ */
  app.get('/school/lab-manager/budget', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const fy = req.query.fy || new Date().getFullYear().toString();
    const [items] = await pool.query(
      'SELECT lb.*, l.name as lab_name FROM lab_budget lb LEFT JOIN labs l ON l.id=lb.lab_id WHERE lb.tenant_id=$1 AND lb.fiscal_year=$2 ORDER BY lb.created_at DESC', [tid, fy]);
    const [summary] = await pool.query(
      'SELECT COALESCE(SUM(CASE WHEN budget_type=$1 THEN amount ELSE 0 END),0) as expenses, COALESCE(SUM(CASE WHEN budget_type=$2 THEN amount ELSE 0 END),0) as allocations FROM lab_budget WHERE tenant_id=$3 AND fiscal_year=$4',
      ['expense', 'allocation', tid, fy]);
    const spent = Number(summary[0].expenses);
    const allocated = Number(summary[0].allocations);
    const remaining = allocated - spent;
    const pct = allocated > 0 ? Math.min(100, Math.round((spent / allocated) * 100)) : 0;

    const rows = items.map(i => `<tr>
      <td>${esc(i.lab_name || 'General')}</td><td>${esc(i.category || '—')}</td>
      <td>${esc((i.description || '').substring(0, 60))}</td>
      <td><span style="color:${i.budget_type === 'allocation' ? '#059669' : '#dc2626'}">${i.budget_type === 'allocation' ? '+' : '-'}${fmtMoney(i.amount)}</span></td>
      <td>${esc(i.fiscal_year)}</td>
      <td><span class="badge badge-${i.status}">${esc(i.status)}</span></td>
    </tr>`).join('');

    const html = `${SKIP}<div style="max-width:1200px;margin:0 auto;padding:20px">
      ${nav('/school/lab-manager/budget')}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h1 style="color:${P};margin:0">💰 Budget Tracking</h1>
        <a href="/school/lab-manager/budget/new" class="btn">+ Add Entry</a>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:16px">
        <form method="GET" style="display:flex;gap:8px">
          <input type="text" name="fy" value="${esc(fy)}" placeholder="Fiscal Year" style="width:120px">
          <button type="submit" class="btn btn-sm">Filter</button>
        </form>
      </div>
      <div class="grid" style="margin-bottom:16px">
        <div class="stat-card"><div class="stat-num" style="color:#059669">${fmtMoney(allocated)}</div><div class="stat-label">Allocated</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#dc2626">${fmtMoney(spent)}</div><div class="stat-label">Expenses</div></div>
        <div class="stat-card"><div class="stat-num" style="color:${remaining >= 0 ? '#059669' : '#dc2626'}">${fmtMoney(remaining)}</div><div class="stat-label">Remaining</div></div>
        <div class="stat-card"><div class="stat-num">${pct}%</div><div class="stat-label">Budget Used</div></div>
      </div>
      ${allocated > 0 ? `<div style="margin-bottom:16px"><div class="progress-bar" style="height:12px"><div class="progress-fill" style="width:${pct}%;background:${pct > 90 ? '#dc2626' : pct > 70 ? '#d97706' : '#059669'}"></div></div></div>` : ''}
      <div class="card"><div style="overflow-x:auto"><table>
        <thead><tr><th>Lab</th><th>Category</th><th>Description</th><th>Amount</th><th>FY</th><th>Status</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="6" class="empty">No budget entries for ' + esc(fy) + '</td></tr>'}</tbody>
      </table></div></div>
    </div>`;
    res.send(renderPage(req, html, 'Budget'));
  }));

  /* ── Add Budget Entry ── */
  app.get('/school/lab-manager/budget/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const [labs] = await pool.query('SELECT id, name FROM labs WHERE tenant_id=$1 ORDER BY name', [tid]);
    const labOpts = labs.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join('');
    const html = `${SKIP}<div style="max-width:700px;margin:0 auto;padding:20px">
      ${nav('/school/lab-manager/budget')}
      <h1 style="color:${P};margin-bottom:20px">💰 Add Budget Entry</h1>
      <form method="POST" action="/school/lab-manager/budget" class="card">
        <div class="form-row"><div><label>Lab</label><select name="lab_id"><option value="">General</option>${labOpts}</select></div>
          <div><label>Type</label><select name="budget_type"><option value="expense">Expense</option><option value="allocation">Allocation</option></select></div></div>
        <div class="form-row" style="margin-top:12px"><div><label>Amount ($) *</label><input type="number" name="amount" step="0.01" min="0" required></div>
          <div><label>Fiscal Year</label><input name="fiscal_year" value="${new Date().getFullYear()}"></div></div>
        <div class="form-row" style="margin-top:12px"><div><label>Category</label><input name="category" placeholder="e.g. Equipment, Chemicals, Maintenance"></div>
          <div><label>Status</label><select name="status"><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select></div></div>
        <div style="margin-top:12px"><label>Description</label><textarea name="description" rows="2"></textarea></div>
        <div style="margin-top:16px"><button type="submit" class="btn">Save Entry</button>
          <a href="/school/lab-manager/budget" class="btn" style="background:#6b7280;text-decoration:none;margin-left:8px">Cancel</a></div>
      </form>
    </div>`;
    res.send(renderPage(req, html, 'Add Budget Entry'));
  }));

  /* ── Save Budget Entry ── */
  app.post('/school/lab-manager/budget', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const { lab_id, budget_type, amount, fiscal_year, category, status, description } = req.body;
    await pool.query(
      'INSERT INTO lab_budget(tenant_id,lab_id,category,description,amount,budget_type,fiscal_year,approved_by,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [tid, lab_id ? Number(lab_id) : null, category || null, description || null, parseFloat(amount) || 0, budget_type || 'expense', fiscal_year || new Date().getFullYear().toString(), req.user.id, status || 'pending']
    );
    audit(req, 'lab_budget_create', { amount, budget_type });
    res.redirect('/school/lab-manager/budget');
  }));

  /* ════════════════════════════════════════════════════════════════
     ROUTE 11: Safety Training
     ════════════════════════════════════════════════════════════════ */
  app.get('/school/lab-manager/safety-training', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const [trainings] = await pool.query(
      'SELECT st.*, (SELECT COUNT(*) FROM lab_safety_training_attendance lsta WHERE lsta.training_id=st.id AND lsta.tenant_id=st.tenant_id) as attendance_count FROM lab_safety_training st WHERE st.tenant_id=$1 ORDER BY st.training_date DESC', [tid]);
    const rows = trainings.map(t => `<tr>
      <td><a href="/school/lab-manager/safety-training/${t.id}" style="color:${P};text-decoration:none;font-weight:600">${esc(t.title)}</a></td>
      <td>${esc(t.trainer || '—')}</td>
      <td>${fmtDate(t.training_date)}</td>
      <td>${t.duration_minutes || 0} min</td>
      <td>${t.attendance_count || 0}/${t.max_participants || 0}</td>
      <td>${esc(t.location || '—')}</td>
      <td><span class="badge badge-${t.status}">${esc(t.status)}</span></td>
    </tr>`).join('');

    const html = `${SKIP}<div style="max-width:1200px;margin:0 auto;padding:20px">
      ${nav('/school/lab-manager/safety-training')}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h1 style="color:${P};margin:0">🛡️ Safety Training</h1>
        <a href="/school/lab-manager/safety-training/new" class="btn">+ Schedule Training</a>
      </div>
      <div class="card"><div style="overflow-x:auto"><table>
        <thead><tr><th>Title</th><th>Trainer</th><th>Date</th><th>Duration</th><th>Attendance</th><th>Location</th><th>Status</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="7" class="empty">No training sessions scheduled</td></tr>'}</tbody>
      </table></div></div>
    </div>`;
    res.send(renderPage(req, html, 'Safety Training'));
  }));

  /* ── Schedule Training ── */
  app.get('/school/lab-manager/safety-training/new', requireAuth, requireNotBanned, (req, res) => {
    const html = `${SKIP}<div style="max-width:700px;margin:0 auto;padding:20px">
      ${nav('/school/lab-manager/safety-training')}
      <h1 style="color:${P};margin-bottom:20px">🛡️ Schedule Safety Training</h1>
      <form method="POST" action="/school/lab-manager/safety-training" class="card">
        <div class="form-row"><div><label>Title *</label><input name="title" required placeholder="e.g. Chemical Handling Safety"></div>
          <div><label>Trainer</label><input name="trainer" placeholder="Trainer name"></div></div>
        <div class="form-row" style="margin-top:12px"><div><label>Date *</label><input type="date" name="training_date" required value="${today()}"></div>
          <div><label>Duration (min)</label><input type="number" name="duration_minutes" value="60" min="15"></div></div>
        <div class="form-row" style="margin-top:12px"><div><label>Location</label><input name="location" placeholder="e.g. Lab Building Auditorium"></div>
          <div><label>Max Participants</label><input type="number" name="max_participants" value="30" min="1"></div></div>
        <div style="margin-top:12px"><label>Description</label><textarea name="description" rows="2" placeholder="Training description..."></textarea></div>
        <div style="margin-top:16px"><button type="submit" class="btn">Schedule Training</button>
          <a href="/school/lab-manager/safety-training" class="btn" style="background:#6b7280;text-decoration:none;margin-left:8px">Cancel</a></div>
      </form>
    </div>`;
    res.send(renderPage(req, html, 'Schedule Training'));
  });

  /* ── Save Training ── */
  app.post('/school/lab-manager/safety-training', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const { title, trainer, training_date, duration_minutes, location, max_participants, description } = req.body;
    if (!title || !training_date) return res.status(400).send('Title and date are required');
    await pool.query(
      'INSERT INTO lab_safety_training(tenant_id,title,description,trainer,training_date,duration_minutes,location,status,max_participants) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [tid, title.trim(), description || null, trainer || null, training_date, parseInt(duration_minutes) || 60, location || null, 'scheduled', parseInt(max_participants) || 30]
    );
    res.redirect('/school/lab-manager/safety-training');
  }));

  /* ── Training Detail with Attendance ── */
  app.get('/school/lab-manager/safety-training/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const trid = Number(req.params.id);
    const [trainings] = await pool.query('SELECT * FROM lab_safety_training WHERE tenant_id=$1 AND id=$2', [tid, trid]);
    if (!trainings.length) return res.status(404).send('Training not found');
    const t = trainings[0];
    const [users] = await pool.query("SELECT id, name FROM users WHERE tenant_id=$1 AND role IN ('student','teacher','staff') ORDER BY name", [tid]);
    const [attendance] = await pool.query(
      'SELECT lsta.*, u.name FROM lab_safety_training_attendance lsta LEFT JOIN users u ON u.id=lsta.user_id WHERE lsta.tenant_id=$1 AND lsta.training_id=$2', [tid, trid]);
    const attendanceMap = {};
    attendance.forEach(a => { attendanceMap[a.user_id] = a; });

    const userRows = users.map(u => {
      const att = attendanceMap[u.id];
      const checked = att ? (att.attended ? 'checked' : '') : '';
      const score = att ? att.score : '';
      return `<tr>
        <td>${esc(u.name)}</td>
        <td><input type="checkbox" name="attended_${u.id}" ${checked} value="1"></td>
        <td><input type="number" name="score_${u.id}" value="${score}" min="0" max="100" style="width:80px"></td>
        <td>${att && att.certificate_issued ? '<span class="badge badge-passed">Issued</span>' : '<span class="badge badge-pending">Pending</span>'}</td>
      </tr>`;
    }).join('');

    const html = `${SKIP}<div style="max-width:1100px;margin:0 auto;padding:20px">
      ${nav('/school/lab-manager/safety-training')}
      <a href="/school/lab-manager/safety-training" style="color:${GRAY};text-decoration:none;font-size:14px">← Back to Safety Training</a>
      <div class="card" style="margin-top:12px">
        <h1 style="color:${P};margin:0">${esc(t.title)}</h1>
        <p style="color:${GRAY};margin:8px 0 0">${esc(t.trainer || '—')} · ${fmtDate(t.training_date)} · ${t.duration_minutes} min · ${esc(t.location || '—')}</p>
        ${t.description ? `<p style="margin-top:12px">${esc(t.description)}</p>` : ''}
      </div>
      <div class="card" style="margin-top:16px">
        <h3 style="margin:0 0 12px">Attendance (${attendance.length} recorded)</h3>
        <form method="POST" action="/school/lab-manager/safety-training/${trid}/attendance">
          <div style="overflow-x:auto"><table>
            <thead><tr><th>Name</th><th>Attended</th><th>Score</th><th>Certificate</th></tr></thead>
            <tbody>${userRows || '<tr><td colspan="4" class="empty">No users found</td></tr>'}</tbody>
          </table></div>
          <div style="margin-top:16px"><button type="submit" class="btn btn-success">Save Attendance</button></div>
        </form>
      </div>
    </div>`;
    res.send(renderPage(req, html, t.title));
  }));

  /* ── Save Attendance ── */
  app.post('/school/lab-manager/safety-training/:id/attendance', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const trid = Number(req.params.id);
    const [users] = await pool.query("SELECT id FROM users WHERE tenant_id=$1", [tid]);
    for (const u of users) {
      const attended = req.body['attended_' + u.id] ? true : false;
      const score = req.body['score_' + u.id] ? parseInt(req.body['score_' + u.id]) : null;
      const [existing] = await pool.query('SELECT id FROM lab_safety_training_attendance WHERE tenant_id=$1 AND training_id=$2 AND user_id=$3', [tid, trid, u.id]);
      if (existing.length) {
        await pool.query('UPDATE lab_safety_training_attendance SET attended=$1, score=$2, certificate_issued=$3 WHERE tenant_id=$4 AND training_id=$5 AND user_id=$6',
          [attended, score, attended && score && score >= 60, tid, trid, u.id]);
      } else {
        await pool.query('INSERT INTO lab_safety_training_attendance(tenant_id,training_id,user_id,attended,score,certificate_issued) VALUES($1,$2,$3,$4,$5,$6)',
          [tid, trid, u.id, attended, score, attended && score && score >= 60]);
      }
    }
    await pool.query("UPDATE lab_safety_training SET status='completed' WHERE tenant_id=$1 AND id=$2", [tid, trid]);
    res.redirect('/school/lab-manager/safety-training/' + trid);
  }));

  /* ════════════════════════════════════════════════════════════════
     ROUTE 12: Usage Logs
     ════════════════════════════════════════════════════════════════ */
  app.get('/school/lab-manager/usage-logs', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const dateFrom = req.query.from || '';
    const dateTo = req.query.to || '';
    let sql = 'SELECT lul.*, l.name as lab_name, u.name as user_name FROM lab_usage_logs lul LEFT JOIN labs l ON l.id=lul.lab_id LEFT JOIN users u ON u.id=lul.user_id WHERE lul.tenant_id=$1';
    const params = [tid];
    let pi = 2;
    if (dateFrom) { sql += ` AND lul.logged_at >= $${pi}`; params.push(dateFrom + ' 00:00:00'); pi++; }
    if (dateTo) { sql += ` AND lul.logged_at <= $${pi}`; params.push(dateTo + ' 23:59:59'); pi++; }
    sql += ' ORDER BY lul.logged_at DESC LIMIT 200';
    const [logs] = await pool.query(sql, params);
    const rows = logs.map(l => `<tr>
      <td>${new Date(l.logged_at).toLocaleString()}</td>
      <td>${esc(l.lab_name || '—')}</td>
      <td>${esc(l.user_name || '—')}</td>
      <td><span class="badge" style="background:#e0e7ff;color:#3730a3">${esc(l.activity)}</span></td>
      <td>${esc((l.details || '').substring(0, 100))}</td>
    </tr>`).join('');

    const html = `${SKIP}<div style="max-width:1200px;margin:0 auto;padding:20px">
      ${nav('/school/lab-manager/usage-logs')}
      <h1 style="color:${P};margin-bottom:20px">📋 Usage Logs</h1>
      <div class="card">
        <form method="GET" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">
          <div><label style="display:block;font-size:12px;color:${GRAY};margin-bottom:4px">From</label><input type="date" name="from" value="${esc(dateFrom)}" style="width:160px"></div>
          <div><label style="display:block;font-size:12px;color:${GRAY};margin-bottom:4px">To</label><input type="date" name="to" value="${esc(dateTo)}" style="width:160px"></div>
          <div style="align-self:end"><button type="submit" class="btn btn-sm">Filter</button>
            ${(dateFrom || dateTo) ? '<a href="/school/lab-manager/usage-logs" class="btn btn-sm" style="background:#6b7280;text-decoration:none;margin-left:4px">Clear</a>' : ''}</div>
        </form>
        <div style="overflow-x:auto"><table>
          <thead><tr><th>Timestamp</th><th>Lab</th><th>User</th><th>Activity</th><th>Details</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="5" class="empty">No usage logs found</td></tr>'}</tbody>
        </table></div>
      </div>
    </div>`;
    res.send(renderPage(req, html, 'Usage Logs'));
  }));

  /* ════════════════════════════════════════════════════════════════
     ROUTE 13: Reports (Aggregated analytics)
     ════════════════════════════════════════════════════════════════ */
  app.get('/school/lab-manager/reports', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const [labUsage] = await pool.query(
      'SELECT l.name as lab_name, COUNT(lb.id) as booking_count, COUNT(lb.id) FILTER (WHERE lb.status=$1) as approved_count FROM labs l LEFT JOIN lab_bookings lb ON lb.lab_id=l.id AND lb.tenant_id=l.tenant_id WHERE l.tenant_id=$2 GROUP BY l.id, l.name ORDER BY booking_count DESC', ['approved', tid]);
    const [incidentBySeverity] = await pool.query(
      'SELECT severity, COUNT(*) as count FROM lab_incidents WHERE tenant_id=$1 GROUP BY severity ORDER BY count DESC', [tid]);
    const [equipByLab] = await pool.query(
      'SELECT l.name as lab_name, COUNT(le.id) as total, SUM(le.cost) as total_cost FROM labs l LEFT JOIN lab_equipment le ON le.lab_id=l.id AND le.tenant_id=l.tenant_id WHERE l.tenant_id=$1 GROUP BY l.id, l.name ORDER BY total DESC', [tid]);
    const [incidentByLab] = await pool.query(
      'SELECT l.name as lab_name, COUNT(li.id) as incidents FROM labs l LEFT JOIN lab_incidents li ON li.lab_id=l.id AND li.tenant_id=l.tenant_id WHERE l.tenant_id=$1 GROUP BY l.id, l.name ORDER BY incidents DESC', [tid]);
    const [maintenanceStats] = await pool.query(
      "SELECT status, COUNT(*) as count FROM lab_maintenance WHERE tenant_id=$1 GROUP BY status", [tid]);

    const usageRows = labUsage.map(r => `<tr>
      <td>${esc(r.lab_name)}</td><td>${r.booking_count}</td><td>${r.approved_count}</td></tr>`).join('');
    const severityRows = incidentBySeverity.map(r => {
      const colors = { low: '#059669', medium: '#d97706', high: '#dc2626', critical: '#7f1d1d' };
      return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <span style="font-size:13px;min-width:80px">${esc(r.severity)}</span>
        <div style="flex:1;background:#f1f5f9;border-radius:6px;height:20px;overflow:hidden">
          <div style="height:100%;width:${Math.min(100, r.count * 20)}%;background:${colors[r.severity] || P};border-radius:6px;display:flex;align-items:center;justify-content:center">
            <span style="font-size:11px;color:#fff;font-weight:600">${r.count}</span></div></div></div>`;
    }).join('');
    const equipRows = equipByLab.map(r => `<tr>
      <td>${esc(r.lab_name)}</td><td>${r.total}</td><td>${fmtMoney(r.total_cost)}</td></tr>`).join('');
    const incidentLabRows = incidentByLab.map(r => `<tr>
      <td>${esc(r.lab_name)}</td><td>${r.incidents}</td></tr>`).join('');
    const maintStats = maintenanceStats.map(r => `<div style="display:inline-block;margin-right:16px"><span class="badge badge-${r.status}">${esc(r.status)}</span> <strong>${r.count}</strong></div>`).join('');

    const html = `${SKIP}<div style="max-width:1200px;margin:0 auto;padding:20px">
      <h1 style="color:${P};margin-bottom:20px">📊 Lab Reports & Analytics</h1>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
        <div class="card"><h3 style="margin:0 0 12px">Lab Usage (Bookings)</h3>
          <div style="overflow-x:auto"><table><thead><tr><th>Lab</th><th>Total</th><th>Approved</th></tr></thead>
          <tbody>${usageRows || '<tr><td colspan="3" class="empty">No data</td></tr>'}</tbody></table></div></div>
        <div class="card"><h3 style="margin:0 0 12px">Incidents by Severity</h3>
          ${severityRows || '<p class="empty">No incidents reported</p>'}</div>
        <div class="card"><h3 style="margin:0 0 12px">Equipment by Lab</h3>
          <div style="overflow-x:auto"><table><thead><tr><th>Lab</th><th>Items</th><th>Total Value</th></tr></thead>
          <tbody>${equipRows || '<tr><td colspan="3" class="empty">No data</td></tr>'}</tbody></table></div></div>
        <div class="card"><h3 style="margin:0 0 12px">Incidents by Lab</h3>
          <div style="overflow-x:auto"><table><thead><tr><th>Lab</th><th>Incidents</th></tr></thead>
          <tbody>${incidentLabRows || '<tr><td colspan="2" class="empty">No data</td></tr>'}</tbody></table></div></div>
      </div>
      <div class="card"><h3 style="margin:0 0 12px">Maintenance Summary</h3>
        ${maintStats || '<p class="empty">No maintenance data</p>'}</div>
    </div>`;
    res.send(renderPage(req, html, 'Lab Reports'));
  }));

};
