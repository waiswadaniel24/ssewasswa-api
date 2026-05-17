// ============================================================
// CLINIC MANAGEMENT MODULE — Multi-Tenant SaaS Platform
// Patient registry, appointments, consultations, prescriptions,
// pharmacy dispensing, lab requests, patient queue management.
// Color theme: #0891b2 (cyan/medical)
// ============================================================
// Usage in server.js:
//   const clinicManagement = require('./clinic-management');
//   clinicManagement(app, db, pool, renderPage, esc);
// ============================================================

'use strict';

module.exports = function clinicManagement(app, db, pool, renderPage, esc) {

  // -- inline helpers ---------------------------------------------------
  const requireAuth = (req, res, next) => {
    if (!req.session?.user) return res.redirect('/login');
    next();
  };

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

  if (!esc) esc = (s) => String(s == null ? '' : (typeof s === 'object' ? JSON.stringify(s) : s))
    .replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const fmtTime = (t) => t ? String(t).substring(0, 5) : '—';
  const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const today = () => new Date().toISOString().slice(0, 10);
  const genToken = () => require('crypto').randomBytes(24).toString('hex');

  function statusBadge(s) {
    const m = {
      scheduled: { cls: 'badge-warning', label: 'Scheduled' },
      completed: { cls: 'badge-success', label: 'Completed' },
      cancelled: { cls: 'badge-error', label: 'Cancelled' },
      no_show: { cls: 'badge', label: 'No Show', style: 'background:#f1f5f9;color:#475569' },
      in_progress: { cls: 'badge', label: 'In Progress', style: 'background:#dbeafe;color:#1d4ed8' },
      pending: { cls: 'badge-warning', label: 'Pending' },
      waiting: { cls: 'badge-warning', label: 'Waiting' },
      active: { cls: 'badge-success', label: 'Active' },
      dispensed: { cls: 'badge-success', label: 'Dispensed' },
      requested: { cls: 'badge', label: 'Requested', style: 'background:#e0e7ff;color:#3730a3' },
      processing: { cls: 'badge-warning', label: 'Processing' },
      results_ready: { cls: 'badge-success', label: 'Results Ready' },
      critical: { cls: 'badge-error', label: 'Critical' },
      normal: { cls: 'badge-success', label: 'Normal' },
    };
    const v = m[s] || { cls: 'badge', label: s };
    return `<span class="badge ${v.cls}" ${v.style ? 'style="' + v.style + '"' : ''}>${v.label}</span>`;
  }

  // -- shared CSS --------------------------------------------------------
  const CM_CSS = `<style>
    .cm-nav{display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap}
    .cm-nav a{padding:8px 18px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#475569;background:#f1f5f9;transition:.15s}
    .cm-nav a:hover{background:#cffafe;color:#0e7490}.cm-nav a.active{background:#0891b2;color:#fff}
    .cm-btn{display:inline-flex;align-items:center;gap:6px;padding:9px 18px;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:.15s}
    .cm-btn:hover{opacity:.9;transform:translateY(-1px)}
    .cm-btn-primary{background:#0891b2;color:#fff}.cm-btn-success{background:#16a34a;color:#fff}
    .cm-btn-danger{background:#fee2e2;color:#dc2626}.cm-btn-secondary{background:#f1f5f9;color:#475569}
    .cm-btn-warning{background:#fef3c7;color:#92400e}
    .cm-table{width:100%;border-collapse:collapse;font-size:13px}
    .cm-table th{padding:11px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#ecfeff}
    .cm-table td{padding:10px 14px;border-bottom:1px solid #f1f5f9;color:#1e293b}
    .cm-table tr:hover{background:#ecfeff}
    .cm-filter{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:end}
    .cm-filter label{display:block;font-size:12px;font-weight:600;color:#64748b;margin-bottom:4px}
    .cm-filter input,.cm-filter select{padding:8px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px;background:#fff}
    .cm-filter input:focus,.cm-filter select:focus{outline:none;border-color:#0891b2}
    .cm-alert{padding:12px 18px;border-radius:10px;margin-bottom:16px;font-size:13px;font-weight:500;display:flex;align-items:center;gap:10px}
    .cm-alert-danger{background:#fef2f2;border:1px solid #fecaca;color:#991b1b}
    .cm-alert-warning{background:#fffbeb;border:1px solid #fde68a;color:#92400e}
    .cm-alert-info{background:#ecfeff;border:1px solid #a5f3fc;color:#0e7490}
    .cm-card-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}
    .cm-form-group{margin-bottom:18px}
    .cm-form-group label{display:block;font-size:13px;font-weight:600;color:#475569;margin-bottom:6px}
    .cm-form-group input,.cm-form-group select,.cm-form-group textarea{width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;background:#fff;box-sizing:border-box}
    .cm-form-group input:focus,.cm-form-group select:focus,.cm-form-group textarea:focus{outline:none;border-color:#0891b2}
    .cm-form-group textarea{resize:vertical;min-height:80px}
    .cm-form-row{display:grid;grid-template-columns:1fr 1fr;gap:14px}
    .cm-form-row-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px}
    .cm-section{margin-bottom:24px}
    .cm-section h3{font-size:16px;color:#1e293b;margin:0 0 12px;padding-bottom:8px;border-bottom:2px solid #cffafe}
    @media(max-width:768px){.cm-nav{gap:4px}.cm-nav a{padding:6px 12px;font-size:12px}.cm-form-row,.cm-form-row-3{grid-template-columns:1fr}}
  </style>`;

  // -- navigation helper --------------------------------------------------
  const nav = (active) => `<div class="cm-nav">
    <a href="/clinic" class="${active === 'dash' ? 'active' : ''}">🏥 Dashboard</a>
    <a href="/clinic/patients" class="${active === 'patients' ? 'active' : ''}">👥 Patients</a>
    <a href="/clinic/appointments" class="${active === 'appointments' ? 'active' : ''}">📅 Appointments</a>
    <a href="/clinic/consultations" class="${active === 'consultations' ? 'active' : ''}">🩺 Consultations</a>
    <a href="/clinic/prescriptions" class="${active === 'prescriptions' ? 'active' : ''}">💊 Prescriptions</a>
    <a href="/clinic/pharmacy" class="${active === 'pharmacy' ? 'active' : ''}">🏪 Pharmacy</a>
    <a href="/clinic/lab" class="${active === 'lab' ? 'active' : ''}">🔬 Lab</a>
    <a href="/clinic/queue" class="${active === 'queue' ? 'active' : ''}">📋 Queue</a>
  </div>`;

  // -- inline bar chart helper -------------------------------------------
  const barChart = (items, maxVal) => {
    const mx = maxVal || Math.max(...items.map(i => i.value), 1);
    return items.map(item => {
      const pct = Math.round(item.value / mx * 100);
      return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <span style="font-size:12px;color:#64748b;min-width:90px">${esc(item.label)}</span>
        <div style="flex:1;background:#f1f5f9;border-radius:6px;height:20px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:${item.color};border-radius:6px;display:flex;align-items:center;justify-content:flex-end;padding-right:6px">
            <span style="font-size:11px;font-weight:700;color:#fff">${item.value > 0 ? item.value : ''}</span>
          </div>
        </div>
        <span style="font-size:11px;color:#94a3b8;min-width:40px">${pct}%</span>
      </div>`;
    }).join('');
  };

  // ============================================================
  // DATABASE MIGRATIONS (async IIFE)
  // ============================================================
  (async () => {
    const c = await pool.connect().catch(() => null);
    if (!c) { console.error('[ClinicMgmt] Cannot connect to DB for migrations'); return; }
    try {
      await c.query(`CREATE TABLE IF NOT EXISTS clinic_visit_history (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        patient_id INTEGER NOT NULL,
        visit_date DATE NOT NULL,
        visit_type VARCHAR(50),
        chief_complaint TEXT,
        diagnosis TEXT,
        treatment TEXT,
        follow_up_date DATE,
        doctor_id INTEGER,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      await c.query(`CREATE TABLE IF NOT EXISTS immunization_records (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        patient_id INTEGER NOT NULL,
        vaccine_name VARCHAR(200),
        batch_number VARCHAR(100),
        administered_date DATE,
        next_due_date DATE,
        administered_by INTEGER,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      const idxs = [
        'CREATE INDEX IF NOT EXISTS idx_cvh_tenant ON clinic_visit_history(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_cvh_patient ON clinic_visit_history(patient_id)',
        'CREATE INDEX IF NOT EXISTS idx_cvh_date ON clinic_visit_history(visit_date)',
        'CREATE INDEX IF NOT EXISTS idx_ir_tenant ON immunization_records(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_ir_patient ON immunization_records(patient_id)',
        'CREATE INDEX IF NOT EXISTS idx_ir_vaccine ON immunization_records(vaccine_name)',
        'CREATE INDEX IF NOT EXISTS idx_cp_queue ON patient_queue(tenant_id, status)',
      ];
      for (const sql of idxs) { try { await c.query(sql); } catch (_) { /* ignore */ } }

      console.log('[ClinicMgmt] Migrations applied successfully');
    } catch (e) {
      console.error('[ClinicMgmt] Migration error:', e.message);
    } finally {
      c.release();
    }
  })();

  // ============================================================
  // ROUTE 1: GET /clinic — Dashboard
  // ============================================================
  app.get('/clinic', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    const [patientCount, todayAppts, queueList, apptTypeRows, visitRows] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS cnt FROM clinic_patients WHERE tenant_id=$1`, [tid]),
      pool.query(`SELECT COUNT(*)::int AS cnt FROM clinic_appointments WHERE tenant_id=$1 AND appointment_date=$2`, [tid, today()]),
      pool.query(`SELECT pq.*, cp.patient_name FROM patient_queue pq
        LEFT JOIN clinic_patients cp ON cp.id = pq.patient_id AND cp.tenant_id = pq.tenant_id
        WHERE pq.tenant_id=$1 AND pq.queue_date=$2 ORDER BY pq.arrival_time ASC`, [tid, today()]),
      pool.query(`SELECT COALESCE(appointment_type,'general') AS t, COUNT(*)::int AS c FROM clinic_appointments
        WHERE tenant_id=$1 AND appointment_date >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY appointment_type ORDER BY c DESC`, [tid]),
      pool.query(`SELECT visit_type, COUNT(*)::int AS c FROM clinic_visit_history
        WHERE tenant_id=$1 AND visit_date >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY visit_type ORDER BY c DESC LIMIT 6`, [tid]),
    ]);

    const waiting = queueList.rows.filter(q => q.status === 'waiting').length;
    const lowStock = (await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM pharmacy_inventory pi
       JOIN pharmacy_drugs pd ON pd.id = pi.drug_id AND pd.tenant_id = $1
       WHERE pi.tenant_id=$1 AND pi.quantity_in_stock <= pi.reorder_level`, [tid]
    )).rows[0].cnt;

    const labPending = (await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM lab_requests WHERE tenant_id=$1 AND status IN ('requested','processing')`, [tid]
    )).rows[0].cnt;

    const recentAppts = (await pool.query(
      `SELECT ca.*, cp.patient_name FROM clinic_appointments ca
       LEFT JOIN clinic_patients cp ON cp.id = ca.patient_id AND cp.tenant_id = ca.tenant_id
       WHERE ca.tenant_id=$1 ORDER BY ca.appointment_date DESC LIMIT 8`, [tid]
    )).rows;

    const apptChart = barChart(
      apptTypeRows.rows.map(r => ({ label: r.t || 'general', value: r.c, color: '#0891b2' })),
      Math.max(...apptTypeRows.rows.map(r => r.c), 1)
    );

    const visitChart = barChart(
      visitRows.rows.map((r, i) => ({ label: r.visit_type || 'General', value: r.c, color: ['#0891b2','#0d9488','#059669','#d97706','#dc2626','#7c3aed'][i % 6] })),
      Math.max(...visitRows.rows.map(r => r.c), 1)
    );

    const alertsHtml = [];
    if (labPending > 0) alertsHtml.push(`<div class="cm-alert cm-alert-warning"><span style="font-size:18px">🔬</span><div><strong>${labPending} lab request(s) pending results</strong></div></div>`);
    if (lowStock > 0) alertsHtml.push(`<div class="cm-alert cm-alert-danger"><span style="font-size:18px">⚠️</span><div><strong>${lowStock} medication(s) below reorder level</strong></div></div>`);
    if (alertsHtml.length === 0) alertsHtml.push(`<div class="cm-alert cm-alert-info"><span style="font-size:18px">✅</span> No alerts — clinic operations are running smoothly.</div>`);

    const queueHtml = queueList.rows.length > 0
      ? queueList.rows.slice(0, 10).map(q => `<div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid #f1f5f9">
          <div style="width:36px;height:36px;border-radius:10px;background:#cffafe;display:flex;align-items:center;justify-content:center;font-size:16px">👤</div>
          <div style="flex:1">
            <div style="font-size:13px;font-weight:600;color:#1e293b">${esc(q.patient_name || 'Patient #' + q.patient_id)}</div>
            <div style="font-size:12px;color:#64748b">${esc(q.complaint || q.reason || 'No complaint noted')} · ${fmtTime(q.arrival_time)}</div>
          </div>
          <div>${statusBadge(q.status || 'waiting')}</div>
        </div>`).join('')
      : '<p style="text-align:center;color:#94a3b8;padding:20px">No patients in queue today</p>';

    const recentApptsHtml = recentAppts.map(a => `<div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid #f1f5f9">
        <div style="width:36px;height:36px;border-radius:10px;background:#e0f2fe;display:flex;align-items:center;justify-content:center;font-size:16px">📅</div>
        <div style="flex:1">
          <div style="font-size:13px;font-weight:600;color:#1e293b">${esc(a.patient_name || 'Patient #' + a.patient_id)}</div>
          <div style="font-size:12px;color:#64748b">${esc(a.appointment_type || 'General')} · ${esc(a.doctor_name || 'Unassigned')}</div>
        </div>
        <div style="text-align:right">
          ${statusBadge(a.status)}
          <div style="font-size:11px;color:#94a3b8;margin-top:2px">${fmtDate(a.appointment_date)}</div>
        </div>
      </div>`).join('');

    const html = CM_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('dash')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">🏥 Clinic Dashboard</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Manage patients, appointments, and clinic operations</p></div>
        <div style="display:flex;gap:8px">
          <a href="/clinic/patients" class="cm-btn cm-btn-primary">👥 Patient Registry</a>
          <a href="/clinic/appointments" class="cm-btn cm-btn-secondary">📅 New Appointment</a>
        </div>
      </div>

      <div class="cm-section">${alertsHtml.join('')}</div>

      <div class="stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;margin-bottom:24px">
        <div class="stat-card"><div class="stat-num" style="color:#0891b2">${patientCount.rows[0].cnt}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Total Patients</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#0d9488">${todayAppts.rows[0].cnt}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Today's Appointments</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${waiting}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Waiting in Queue</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#dc2626">${labPending}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Pending Labs</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#8b5cf6">${lowStock}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Low Stock Meds</div></div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px">
        <div class="card" style="padding:20px">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">📋 Today's Queue (${queueList.rows.length})</h3>
          ${queueHtml}
        </div>
        <div class="card" style="padding:20px">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">📅 Recent Appointments</h3>
          ${recentApptsHtml || '<p style="text-align:center;color:#94a3b8;padding:20px">No recent appointments</p>'}
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px">
        <div class="card" style="padding:20px">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">📊 Appointment Types (30 days)</h3>
          ${apptTypeRows.rows.length > 0 ? apptChart : '<p style="text-align:center;color:#94a3b8;padding:20px">No appointment data</p>'}
        </div>
        <div class="card" style="padding:20px">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">🩺 Visit Types (30 days)</h3>
          ${visitRows.rows.length > 0 ? visitChart : '<p style="text-align:center;color:#94a3b8;padding:20px">No visit data</p>'}
        </div>
      </div>
    </div>`;
    res.send(renderPage('Clinic Dashboard', html, user, req));
  }));

  // ============================================================
  // ROUTE 2: GET /clinic/patients — Patient registry
  // ============================================================
  app.get('/clinic/patients', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const search = (req.query.q || '').trim();
    const genderFilter = req.query.gender || '';

    let sql = `SELECT * FROM clinic_patients WHERE tenant_id=$1`;
    const params = [tid];
    let pi = 2;
    if (search) {
      sql += ` AND (patient_name ILIKE '%' || $${pi} || '%' OR email ILIKE '%' || $${pi} || '%' OR phone ILIKE '%' || $${pi} || '%')`;
      params.push(search); pi++;
    }
    if (genderFilter) {
      sql += ` AND gender=$${pi}`;
      params.push(genderFilter); pi++;
    }
    sql += ` ORDER BY created_at DESC LIMIT 200`;

    const patients = (await pool.query(sql, params)).rows;
    const rowsHtml = patients.map(p => `<tr>
      <td><a href="/clinic/patients/${p.id}" style="font-weight:600;color:#0891b2;text-decoration:none">${esc(p.patient_name || 'Patient #' + p.id)}</a></td>
      <td>${esc(p.gender || '—')}</td>
      <td>${esc(p.date_of_birth ? String(p.date_of_birth).substring(0, 10) : '—')}</td>
      <td>${esc(p.phone || '—')}</td>
      <td>${esc(p.blood_group || '—')}</td>
      <td>${fmtDate(p.created_at)}</td>
      <td><a href="/clinic/patients/${p.id}" class="cm-btn cm-btn-secondary" style="padding:5px 12px;font-size:12px">View</a></td>
    </tr>`).join('');

    const html = CM_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('patients')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">👥 Patient Registry</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">${patients.length} patients found</p></div>
        <a href="/clinic/patients" class="cm-btn cm-btn-primary" onclick="document.getElementById('regForm').style.display='block';return false">➕ Register Patient</a>
      </div>

      <div class="cm-filter">
        <div style="flex:1;min-width:200px"><label>Search by name, email, phone</label>
          <form method="GET" style="display:flex;gap:8px">
            <input type="text" name="q" value="${esc(search)}" placeholder="Type name, email or phone...">
            <select name="gender" style="min-width:100px">
              <option value="">All Genders</option>
              <option value="male" ${genderFilter === 'male' ? 'selected' : ''}>Male</option>
              <option value="female" ${genderFilter === 'female' ? 'selected' : ''}>Female</option>
              <option value="other" ${genderFilter === 'other' ? 'selected' : ''}>Other</option>
            </select>
            <button type="submit" class="cm-btn cm-btn-primary" style="padding:8px 16px">🔍 Search</button>
            ${search || genderFilter ? '<a href="/clinic/patients" class="cm-btn cm-btn-secondary" style="padding:8px 16px">✕ Clear</a>' : ''}
          </form>
        </div>
      </div>

      <div class="card" style="padding:0;overflow:hidden">
        <div style="overflow-x:auto">
          <table class="cm-table">
            <thead><tr><th>Name</th><th>Gender</th><th>Date of Birth</th><th>Phone</th><th>Blood Group</th><th>Registered</th><th>Actions</th></tr></thead>
            <tbody>${rowsHtml || '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:40px">No patients found.</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Patient Registry', html, user, req));
  }));

  // ============================================================
  // ROUTE 3: GET /clinic/patients/:id — Patient profile
  // ============================================================
  app.get('/clinic/patients/:id', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, pid = req.params.id;

    const patient = (await pool.query(
      `SELECT * FROM clinic_patients WHERE id=$1 AND tenant_id=$2`, [pid, tid]
    )).rows[0];

    if (!patient) {
      return res.send(renderPage('Not Found', '<div class="card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">Patient not found</h2><a href="/clinic/patients" class="cm-btn cm-btn-primary" style="margin-top:12px">← Back to Patients</a></div>', user, req));
    }

    const [vitals, allergies, medications, chronic, visitHistory, immunizations, prescriptions] = await Promise.all([
      pool.query(`SELECT * FROM patient_vitals WHERE tenant_id=$1 AND patient_id=$2 ORDER BY recorded_at DESC LIMIT 10`, [tid, pid]),
      pool.query(`SELECT * FROM patient_allergies WHERE tenant_id=$1 AND patient_id=$2`, [tid, pid]),
      pool.query(`SELECT * FROM patient_medications WHERE tenant_id=$1 AND patient_id=$2 AND is_active=true`, [tid, pid]),
      pool.query(`SELECT * FROM patient_chronic_conditions WHERE tenant_id=$1 AND patient_id=$2`, [tid, pid]),
      pool.query(`SELECT * FROM clinic_visit_history WHERE tenant_id=$1 AND patient_id=$2 ORDER BY visit_date DESC LIMIT 15`, [tid, pid]),
      pool.query(`SELECT * FROM immunization_records WHERE tenant_id=$1 AND patient_id=$2 ORDER BY administered_date DESC`, [tid, pid]),
      pool.query(`SELECT cp.id, cp.prescription_date, cp.notes, cs.staff_name AS doctor_name
        FROM clinic_prescriptions cp
        LEFT JOIN clinic_staff cs ON cs.id = cp.doctor_id AND cs.tenant_id = cp.tenant_id
        WHERE cp.tenant_id=$1 AND cp.patient_id=$2 ORDER BY cp.prescription_date DESC LIMIT 10`, [tid, pid]),
    ]);

    const infoRow = (label, value) => `<div style="display:flex;padding:8px 0;border-bottom:1px solid #f1f5f9">
      <span style="min-width:180px;font-size:13px;color:#64748b;font-weight:600">${label}</span>
      <span style="font-size:13px;color:#1e293b">${value || '—'}</span>
    </div>`;

    const profileHtml = `<div class="card" style="padding:24px">
      <h3 style="font-size:16px;color:#1e293b;margin:0 0 16px">👤 Patient Profile</h3>
      ${infoRow('Name', `<strong>${esc(patient.patient_name || 'Unknown')}</strong>`)}
      ${infoRow('Date of Birth', patient.date_of_birth ? String(patient.date_of_birth).substring(0, 10) : '')}
      ${infoRow('Gender', patient.gender)}
      ${infoRow('Phone', esc(patient.phone || '—'))}
      ${infoRow('Email', esc(patient.email || '—'))}
      ${infoRow('Blood Group', `<span style="background:#fef2f2;color:#dc2626;padding:3px 10px;border-radius:6px;font-weight:700;font-size:13px">${esc(patient.blood_group || 'Unknown')}</span>`)}
      ${infoRow('Address', esc(patient.address || '—'))}
      ${infoRow('Emergency Contact', esc(patient.emergency_contact || '—'))}
      ${infoRow('Emergency Phone', esc(patient.emergency_phone || '—'))}
      ${infoRow('Insurance Provider', esc(patient.insurance_provider || '—'))}
      ${infoRow('Insurance Number', esc(patient.insurance_number || '—'))}
      ${infoRow('Registered', fmtDateTime(patient.created_at))}
    </div>`;

    const allergiesHtml = allergies.rows.length > 0
      ? allergies.rows.map(a => `<div style="padding:6px 0;border-bottom:1px solid #fef3c7"><strong style="color:#dc2626">${esc(a.allergen || a.substance || 'Unknown')}</strong><span style="font-size:12px;color:#64748b"> — ${esc(a.reaction || 'No reaction noted')}</span></div>`).join('')
      : '<p style="color:#94a3b8;font-size:13px">No known allergies</p>';

    const medsHtml = medications.rows.length > 0
      ? medications.rows.map(m => `<div style="padding:6px 0;border-bottom:1px solid #d1fae5"><strong>${esc(m.medication_name || 'Unknown')}</strong> <span style="font-size:12px;color:#64748b">${esc(m.dosage || '')}</span></div>`).join('')
      : '<p style="color:#94a3b8;font-size:13px">No active medications</p>';

    const vitalsHtml = vitals.rows.length > 0
      ? `<table class="cm-table"><thead><tr><th>Date</th><th>BP</th><th>Pulse</th><th>Temp</th><th>Weight</th><th>SpO2</th></tr></thead>
         <tbody>${vitals.rows.map(v => `<tr>
           <td>${fmtDate(v.recorded_at)}</td><td>${esc(v.blood_pressure || '—')}</td>
           <td>${esc(v.pulse_rate || '—')}</td><td>${esc(v.temperature || '—')}</td>
           <td>${esc(v.weight || '—')}</td><td>${esc(v.spo2 || '—')}</td>
         </tr>`).join('')}</tbody></table>`
      : '<p style="color:#94a3b8;font-size:13px">No vitals recorded</p>';

    const visitsHtml = visitHistory.rows.length > 0
      ? `<table class="cm-table"><thead><tr><th>Date</th><th>Type</th><th>Complaint</th><th>Diagnosis</th><th>Treatment</th><th>Follow-up</th></tr></thead>
         <tbody>${visitHistory.rows.map(v => `<tr>
           <td>${fmtDate(v.visit_date)}</td><td>${esc(v.visit_type || 'General')}</td>
           <td style="max-width:150px">${esc((v.chief_complaint || '').substring(0, 80))}</td>
           <td style="max-width:150px">${esc((v.diagnosis || '').substring(0, 80))}</td>
           <td style="max-width:150px">${esc((v.treatment || '').substring(0, 80))}</td>
           <td>${fmtDate(v.follow_up_date)}</td>
         </tr>`).join('')}</tbody></table>`
      : '<p style="color:#94a3b8;font-size:13px">No visit history</p>';

    const immHtml = immunizations.rows.length > 0
      ? `<table class="cm-table"><thead><tr><th>Vaccine</th><th>Batch #</th><th>Administered</th><th>Next Due</th></tr></thead>
         <tbody>${immunizations.rows.map(i => `<tr>
           <td>${esc(i.vaccine_name || '—')}</td><td>${esc(i.batch_number || '—')}</td>
           <td>${fmtDate(i.administered_date)}</td><td>${fmtDate(i.next_due_date)}</td>
         </tr>`).join('')}</tbody></table>`
      : '<p style="color:#94a3b8;font-size:13px">No immunization records</p>';

    const html = CM_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('patients')}
      <a href="/clinic/patients" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Patients</a>
      <h1 style="font-size:24px;color:#1e293b;margin-bottom:20px">${esc(patient.patient_name || 'Patient #' + pid)}</h1>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
        ${profileHtml}
        <div>
          <div class="card" style="padding:24px;border-left:4px solid #f59e0b;margin-bottom:16px">
            <h3 style="font-size:16px;color:#92400e;margin:0 0 12px">⚠️ Allergies</h3>
            ${allergiesHtml}
          </div>
          <div class="card" style="padding:24px;border-left:4px solid #059669">
            <h3 style="font-size:16px;color:#065f46;margin:0 0 12px">💊 Active Medications</h3>
            ${medsHtml}
          </div>
        </div>
      </div>

      <div class="cm-section">
        <div class="card" style="padding:20px;margin-bottom:16px">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">❤️ Vitals History (${vitals.rows.length})</h3>
          <div style="overflow-x:auto">${vitalsHtml}</div>
        </div>
      </div>

      <div class="cm-section">
        <div class="card" style="padding:20px;margin-bottom:16px">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">🩺 Visit History (${visitHistory.rows.length})</h3>
          <div style="overflow-x:auto">${visitsHtml}</div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
        <div class="card" style="padding:20px">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">💉 Immunizations (${immunizations.rows.length})</h3>
          <div style="overflow-x:auto">${immHtml}</div>
        </div>
        <div class="card" style="padding:20px">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">📋 Chronic Conditions (${chronic.rows.length})</h3>
          ${chronic.rows.length > 0 ? chronic.rows.map(c => `<div style="padding:6px 0;border-bottom:1px solid #f3e8ff"><strong>${esc(c.condition_name || 'Unknown')}</strong> <span style="font-size:12px;color:#64748b">— ${esc(c.status || 'Active')}</span></div>`).join('') : '<p style="color:#94a3b8;font-size:13px">No chronic conditions</p>'}
        </div>
      </div>
    </div>`;
    res.send(renderPage('Patient — ' + (patient.patient_name || '#' + pid), html, user, req));
  }));

  // ============================================================
  // ROUTE 4: POST /clinic/patients — Register new patient
  // ============================================================
  app.post('/clinic/patients', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { patient_name, date_of_birth, gender, phone, email, blood_group, address, emergency_contact, emergency_phone, insurance_provider, insurance_number } = req.body;

    if (!patient_name || !patient_name.trim()) {
      return res.send(renderPage('Error', '<div class="card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">Patient name is required</h2><a href="/clinic/patients" class="cm-btn cm-btn-primary" style="margin-top:12px">← Back</a></div>', user, req));
    }

    await pool.query(
      `INSERT INTO clinic_patients (tenant_id, patient_name, date_of_birth, gender, phone, email, blood_group, address, emergency_contact, emergency_phone, insurance_provider, insurance_number)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [tid, patient_name.trim(), date_of_birth || null, gender || null, phone || null, email || null, blood_group || null, address || null, emergency_contact || null, emergency_phone || null, insurance_provider || null, insurance_number || null]
    );

    res.redirect('/clinic/patients');
  }));

  // ============================================================
  // ROUTE 5: GET /clinic/appointments — Appointment list
  // ============================================================
  app.get('/clinic/appointments', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const statusFilter = req.query.status || '';
    const dateFrom = req.query.from || '';
    const dateTo = req.query.to || '';

    let sql = `SELECT ca.*, cp.patient_name FROM clinic_appointments ca
      LEFT JOIN clinic_patients cp ON cp.id = ca.patient_id AND cp.tenant_id = ca.tenant_id
      WHERE ca.tenant_id=$1`;
    const params = [tid];
    let pi = 2;
    if (statusFilter) { sql += ` AND ca.status=$${pi}`; params.push(statusFilter); pi++; }
    if (dateFrom) { sql += ` AND ca.appointment_date >= $${pi}`; params.push(dateFrom); pi++; }
    if (dateTo) { sql += ` AND ca.appointment_date <= $${pi}`; params.push(dateTo); pi++; }
    sql += ` ORDER BY ca.appointment_date DESC, ca.appointment_time ASC LIMIT 200`;

    const [appointments, staffList] = await Promise.all([
      pool.query(sql, params),
      pool.query(`SELECT id, staff_name FROM clinic_staff WHERE tenant_id=$1 ORDER BY staff_name`, [tid]),
    ]);

    const statusCounts = {};
    ['scheduled','completed','cancelled','no_show'].forEach(s => { statusCounts[s] = 0; });
    appointments.rows.forEach(a => { if (statusCounts[a.status] !== undefined) statusCounts[a.status]++; });

    const rowsHtml = appointments.rows.map(a => `<tr>
      <td><a href="/clinic/patients/${a.patient_id}" style="font-weight:600;color:#0891b2;text-decoration:none">${esc(a.patient_name || 'Patient #' + a.patient_id)}</a></td>
      <td>${fmtDate(a.appointment_date)}</td>
      <td>${fmtTime(a.appointment_time)}</td>
      <td>${esc(a.appointment_type || 'General')}</td>
      <td>${esc(a.doctor_name || 'Unassigned')}</td>
      <td>${statusBadge(a.status)}</td>
      <td>
        ${a.status === 'scheduled' ? `<form method="POST" action="/clinic/appointments/${a.id}/status" style="display:inline">
          <input type="hidden" name="status" value="completed"><button class="cm-btn cm-btn-success" style="padding:5px 10px;font-size:11px">Complete</button></form>
          <form method="POST" action="/clinic/appointments/${a.id}/status" style="display:inline">
          <input type="hidden" name="status" value="cancelled"><button class="cm-btn cm-btn-danger" style="padding:5px 10px;font-size:11px">Cancel</button></form>` : '—'}
      </td>
    </tr>`).join('');

    const html = CM_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('appointments')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">📅 Appointments</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">${appointments.rows.length} appointments</p></div>
      </div>

      <div class="stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:14px;margin-bottom:20px">
        <div class="stat-card"><div class="stat-num" style="color:#0891b2">${appointments.rows.length}</div><div class="muted" style="font-size:11px">Total</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${statusCounts.scheduled}</div><div class="muted" style="font-size:11px">Scheduled</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#16a34a">${statusCounts.completed}</div><div class="muted" style="font-size:11px">Completed</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#dc2626">${statusCounts.cancelled}</div><div class="muted" style="font-size:11px">Cancelled</div></div>
      </div>

      <div class="cm-filter">
        <form method="GET" style="display:flex;gap:8px;flex-wrap:wrap">
          <div><label>Status</label><select name="status">
            <option value="">All</option>
            <option value="scheduled" ${statusFilter === 'scheduled' ? 'selected' : ''}>Scheduled</option>
            <option value="completed" ${statusFilter === 'completed' ? 'selected' : ''}>Completed</option>
            <option value="cancelled" ${statusFilter === 'cancelled' ? 'selected' : ''}>Cancelled</option>
          </select></div>
          <div><label>From</label><input type="date" name="from" value="${esc(dateFrom)}"></div>
          <div><label>To</label><input type="date" name="to" value="${esc(dateTo)}"></div>
          <div style="align-self:end"><button type="submit" class="cm-btn cm-btn-primary" style="padding:8px 16px">Filter</button></div>
          ${statusFilter || dateFrom || dateTo ? '<a href="/clinic/appointments" class="cm-btn cm-btn-secondary" style="padding:8px 16px;align-self:end">Clear</a>' : ''}
        </form>
      </div>

      <div class="card" style="padding:0;overflow:hidden">
        <div style="overflow-x:auto">
          <table class="cm-table">
            <thead><tr><th>Patient</th><th>Date</th><th>Time</th><th>Type</th><th>Doctor</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>${rowsHtml || '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:40px">No appointments found.</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Appointments', html, user, req));
  }));

  // ============================================================
  // ROUTE 6: POST /clinic/appointments — Book appointment
  // ============================================================
  app.post('/clinic/appointments', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { patient_id, appointment_date, appointment_time, appointment_type, doctor_name, notes } = req.body;

    if (!patient_id || !appointment_date) {
      return res.send(renderPage('Error', '<div class="card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">Patient and date are required</h2><a href="/clinic/appointments" class="cm-btn cm-btn-primary" style="margin-top:12px">← Back</a></div>', user, req));
    }

    await pool.query(
      `INSERT INTO clinic_appointments (tenant_id, patient_id, appointment_date, appointment_time, appointment_type, doctor_name, notes, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'scheduled')`,
      [tid, parseInt(patient_id), appointment_date, appointment_time || null, appointment_type || 'general', doctor_name || null, notes || null]
    );

    res.redirect('/clinic/appointments');
  }));

  // ============================================================
  // ROUTE 7: POST /clinic/appointments/:id/status
  // ============================================================
  app.post('/clinic/appointments/:id/status', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { status } = req.body;
    const validStatuses = ['scheduled', 'completed', 'cancelled', 'no_show', 'in_progress'];

    if (!validStatuses.includes(status)) return res.redirect('/clinic/appointments');

    await pool.query(
      `UPDATE clinic_appointments SET status=$1 WHERE id=$2 AND tenant_id=$3`,
      [status, req.params.id, tid]
    );

    res.redirect('/clinic/appointments');
  }));

  // ============================================================
  // ROUTE 8: GET /clinic/consultations — Consultation records
  // ============================================================
  app.get('/clinic/consultations', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    const consultations = (await pool.query(
      `SELECT cc.*, cp.patient_name, cs.staff_name AS doctor_name
       FROM clinic_consultations cc
       LEFT JOIN clinic_patients cp ON cp.id = cc.patient_id AND cp.tenant_id = cc.tenant_id
       LEFT JOIN clinic_staff cs ON cs.id = cc.doctor_id AND cs.tenant_id = cc.tenant_id
       WHERE cc.tenant_id=$1 ORDER BY cc.consultation_date DESC LIMIT 200`, [tid]
    )).rows;

    const rowsHtml = consultations.map(c => `<tr>
      <td><a href="/clinic/patients/${c.patient_id}" style="font-weight:600;color:#0891b2;text-decoration:none">${esc(c.patient_name || 'Patient #' + c.patient_id)}</a></td>
      <td>${fmtDate(c.consultation_date)}</td>
      <td>${esc(c.doctor_name || '—')}</td>
      <td style="max-width:180px">${esc((c.diagnosis || '').substring(0, 100))}</td>
      <td style="max-width:180px">${esc((c.notes || '').substring(0, 100))}</td>
      <td>${statusBadge(c.status)}</td>
    </tr>`).join('');

    const html = CM_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('consultations')}
      <h1 style="font-size:24px;color:#1e293b;margin-bottom:20px">🩺 Consultation Records</h1>
      <div class="card" style="padding:0;overflow:hidden">
        <div style="overflow-x:auto">
          <table class="cm-table">
            <thead><tr><th>Patient</th><th>Date</th><th>Doctor</th><th>Diagnosis</th><th>Notes</th><th>Status</th></tr></thead>
            <tbody>${rowsHtml || '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:40px">No consultations recorded.</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Consultations', html, user, req));
  }));

  // ============================================================
  // ROUTE 9: POST /clinic/consultations — Create consultation
  // ============================================================
  app.post('/clinic/consultations', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { patient_id, doctor_id, consultation_date, diagnosis, notes, treatment, follow_up_date } = req.body;

    if (!patient_id || !consultation_date) {
      return res.send(renderPage('Error', '<div class="card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">Patient and date are required</h2><a href="/clinic/consultations" class="cm-btn cm-btn-primary" style="margin-top:12px">← Back</a></div>', user, req));
    }

    await pool.query(
      `INSERT INTO clinic_consultations (tenant_id, patient_id, doctor_id, consultation_date, diagnosis, notes, treatment, follow_up_date, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'completed')`,
      [tid, parseInt(patient_id), doctor_id ? parseInt(doctor_id) : null, consultation_date, diagnosis || null, notes || null, treatment || null, follow_up_date || null]
    );

    // Also add to visit history
    await pool.query(
      `INSERT INTO clinic_visit_history (tenant_id, patient_id, visit_date, visit_type, chief_complaint, diagnosis, treatment, follow_up_date, doctor_id)
       VALUES ($1,$2,$3,'consultation',$4,$5,$6,$7,$8)`,
      [tid, parseInt(patient_id), consultation_date, notes || null, diagnosis || null, treatment || null, follow_up_date || null, doctor_id ? parseInt(doctor_id) : null]
    );

    res.redirect('/clinic/consultations');
  }));

  // ============================================================
  // ROUTE 10: GET /clinic/prescriptions — Prescription list
  // ============================================================
  app.get('/clinic/prescriptions', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    const prescriptions = (await pool.query(
      `SELECT cp.id, cp.prescription_date, cp.notes AS prescription_notes, cp.status AS rx_status,
              cp.patient_id, cpp.patient_name, cs.staff_name AS doctor_name,
              (SELECT COUNT(*)::int FROM clinic_prescription_items WHERE prescription_id = cp.id) AS item_count
       FROM clinic_prescriptions cp
       LEFT JOIN clinic_patients cpp ON cpp.id = cp.patient_id AND cpp.tenant_id = cp.tenant_id
       LEFT JOIN clinic_staff cs ON cs.id = cp.doctor_id AND cs.tenant_id = cp.tenant_id
       WHERE cp.tenant_id=$1 ORDER BY cp.prescription_date DESC LIMIT 200`, [tid]
    )).rows;

    const rowsHtml = prescriptions.map(p => `<tr>
      <td><a href="/clinic/patients/${p.patient_id}" style="font-weight:600;color:#0891b2;text-decoration:none">${esc(p.patient_name || 'Patient #' + p.patient_id)}</a></td>
      <td>${fmtDate(p.prescription_date)}</td>
      <td>${esc(p.doctor_name || '—')}</td>
      <td>${p.item_count}</td>
      <td style="max-width:200px">${esc((p.prescription_notes || '').substring(0, 80))}</td>
      <td>${statusBadge(p.rx_status || 'active')}</td>
    </tr>`).join('');

    const html = CM_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('prescriptions')}
      <h1 style="font-size:24px;color:#1e293b;margin-bottom:20px">💊 Prescriptions</h1>
      <div class="card" style="padding:0;overflow:hidden">
        <div style="overflow-x:auto">
          <table class="cm-table">
            <thead><tr><th>Patient</th><th>Date</th><th>Doctor</th><th>Items</th><th>Notes</th><th>Status</th></tr></thead>
            <tbody>${rowsHtml || '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:40px">No prescriptions found.</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Prescriptions', html, user, req));
  }));

  // ============================================================
  // ROUTE 11: POST /clinic/prescriptions — Create prescription
  // ============================================================
  app.post('/clinic/prescriptions', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { patient_id, doctor_id, notes, items } = req.body;

    if (!patient_id) {
      return res.send(renderPage('Error', '<div class="card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">Patient is required</h2><a href="/clinic/prescriptions" class="cm-btn cm-btn-primary" style="margin-top:12px">← Back</a></div>', user, req));
    }

    const result = await pool.query(
      `INSERT INTO clinic_prescriptions (tenant_id, patient_id, doctor_id, prescription_date, notes, status)
       VALUES ($1,$2,$3,CURRENT_DATE,$4,'active') RETURNING id`,
      [tid, parseInt(patient_id), doctor_id ? parseInt(doctor_id) : null, notes || null]
    );

    const rxId = result.rows[0].id;

    // Parse items if JSON string or array
    let parsedItems = [];
    if (items) {
      try { parsedItems = typeof items === 'string' ? JSON.parse(items) : items; } catch (_) { /* skip */ }
    }

    for (const item of parsedItems) {
      if (!item.drug_name) continue;
      await pool.query(
        `INSERT INTO clinic_prescription_items (tenant_id, prescription_id, drug_name, dosage, frequency, duration, instructions)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [tid, rxId, item.drug_name, item.dosage || null, item.frequency || null, item.duration || null, item.instructions || null]
      );
    }

    res.redirect('/clinic/prescriptions');
  }));

  // ============================================================
  // ROUTE 12: GET /clinic/pharmacy — Pharmacy inventory
  // ============================================================
  app.get('/clinic/pharmacy', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const search = (req.query.q || '').trim();

    let sql = `SELECT pi.*, pd.drug_name, pd.generic_name, pd.category
      FROM pharmacy_inventory pi
      JOIN pharmacy_drugs pd ON pd.id = pi.drug_id AND pd.tenant_id = pi.tenant_id
      WHERE pi.tenant_id=$1`;
    const params = [tid];
    if (search) {
      sql += ` AND (pd.drug_name ILIKE '%' || $2 || '%' OR pd.generic_name ILIKE '%' || $2 || '%')`;
      params.push(search);
    }
    sql += ` ORDER BY pd.drug_name LIMIT 200`;

    const [inventory, dispensing] = await Promise.all([
      pool.query(sql, params),
      pool.query(`SELECT pdi.*, pd.drug_name, cp.patient_name
        FROM pharmacy_dispensing pdi
        JOIN pharmacy_drugs pd ON pd.id = pdi.drug_id AND pd.tenant_id = pdi.tenant_id
        LEFT JOIN clinic_patients cp ON cp.id = pdi.patient_id AND cp.tenant_id = pdi.tenant_id
        WHERE pdi.tenant_id=$1 ORDER BY pdi.dispensed_at DESC LIMIT 20`, [tid]),
    ]);

    const lowStockCount = inventory.rows.filter(i => parseFloat(i.quantity_in_stock) <= parseFloat(i.reorder_level)).length;

    const rowsHtml = inventory.rows.map(i => {
      const qty = parseFloat(i.quantity_in_stock || 0);
      const reorder = parseFloat(i.reorder_level || 0);
      const isLow = qty <= reorder;
      return `<tr style="${isLow ? 'background:#fff7ed;' : ''}">
        <td><strong>${esc(i.drug_name || '—')}</strong>${i.generic_name ? `<br><span style="font-size:11px;color:#94a3b8">${esc(i.generic_name)}</span>` : ''}</td>
        <td>${esc(i.category || '—')}</td>
        <td><span style="font-weight:600;color:${isLow ? '#dc2626' : '#16a34a'}">${qty}</span></td>
        <td>${reorder}</td>
        <td>${esc(i.unit || '—')}</td>
        <td>${isLow ? statusBadge('low') : statusBadge('ok')}</td>
      </tr>`;
    }).join('');

    const dispHtml = dispensing.rows.map(d => `<tr>
      <td>${esc(d.patient_name || '—')}</td>
      <td>${esc(d.drug_name || '—')}</td>
      <td>${esc(d.quantity_dispensed || '—')}</td>
      <td>${esc(d.dispensed_by || '—')}</td>
      <td>${fmtDateTime(d.dispensed_at)}</td>
    </tr>`).join('');

    const html = CM_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('pharmacy')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">🏪 Pharmacy</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">${inventory.rows.length} drugs in inventory · ${lowStockCount} low stock</p></div>
      </div>

      <div class="stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;margin-bottom:20px">
        <div class="stat-card"><div class="stat-num" style="color:#0891b2">${inventory.rows.length}</div><div class="muted" style="font-size:11px">Total Drugs</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#dc2626">${lowStockCount}</div><div class="muted" style="font-size:11px">Low Stock</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#16a34a">${dispensing.rows.length}</div><div class="muted" style="font-size:11px">Recent Dispensing</div></div>
      </div>

      <div class="cm-filter">
        <form method="GET" style="display:flex;gap:8px">
          <input type="text" name="q" value="${esc(search)}" placeholder="Search drug name..." style="min-width:250px;padding:8px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px">
          <button type="submit" class="cm-btn cm-btn-primary" style="padding:8px 16px">🔍 Search</button>
          ${search ? '<a href="/clinic/pharmacy" class="cm-btn cm-btn-secondary" style="padding:8px 16px">✕ Clear</a>' : ''}
        </form>
      </div>

      <div class="card" style="padding:0;overflow:hidden;margin-bottom:20px">
        <div style="overflow-x:auto">
          <table class="cm-table">
            <thead><tr><th>Drug</th><th>Category</th><th>In Stock</th><th>Reorder Level</th><th>Unit</th><th>Status</th></tr></thead>
            <tbody>${rowsHtml || '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:40px">No drugs in inventory.</td></tr>'}</tbody>
          </table>
        </div>
      </div>

      <div class="card" style="padding:20px">
        <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">📋 Recent Dispensing</h3>
        ${dispensing.rows.length > 0 ? `<table class="cm-table"><thead><tr><th>Patient</th><th>Drug</th><th>Quantity</th><th>Dispensed By</th><th>Date</th></tr></thead><tbody>${dispHtml}</tbody></table>` : '<p style="color:#94a3b8;font-size:13px">No recent dispensing records</p>'}
      </div>
    </div>`;
    res.send(renderPage('Pharmacy', html, user, req));
  }));

  // ============================================================
  // ROUTE 13: POST /clinic/pharmacy/dispense — Dispense medication
  // ============================================================
  app.post('/clinic/pharmacy/dispense', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { patient_id, drug_id, quantity_dispensed, notes } = req.body;

    if (!patient_id || !drug_id || !quantity_dispensed) {
      return res.send(renderPage('Error', '<div class="card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">Patient, drug, and quantity are required</h2><a href="/clinic/pharmacy" class="cm-btn cm-btn-primary" style="margin-top:12px">← Back</a></div>', user, req));
    }

    const qty = parseInt(quantity_dispensed);

    // Check stock
    const stock = (await pool.query(
      `SELECT quantity_in_stock FROM pharmacy_inventory WHERE drug_id=$1 AND tenant_id=$2`,
      [parseInt(drug_id), tid]
    )).rows[0];

    if (!stock || parseFloat(stock.quantity_in_stock) < qty) {
      return res.send(renderPage('Error', '<div class="card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">Insufficient stock</h2><a href="/clinic/pharmacy" class="cm-btn cm-btn-primary" style="margin-top:12px">← Back</a></div>', user, req));
    }

    // Deduct stock
    await pool.query(
      `UPDATE pharmacy_inventory SET quantity_in_stock = quantity_in_stock - $1 WHERE drug_id=$2 AND tenant_id=$3`,
      [qty, parseInt(drug_id), tid]
    );

    // Record dispensing
    await pool.query(
      `INSERT INTO pharmacy_dispensing (tenant_id, patient_id, drug_id, quantity_dispensed, dispensed_by, dispensed_at, notes)
       VALUES ($1,$2,$3,$4,$5,NOW(),$6)`,
      [tid, parseInt(patient_id), parseInt(drug_id), qty, esc(user.name || user.email || 'Staff'), notes || null]
    );

    res.redirect('/clinic/pharmacy');
  }));

  // ============================================================
  // ROUTE 14: GET /clinic/lab — Lab requests and results
  // ============================================================
  app.get('/clinic/lab', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    const [labRequests, labResults] = await Promise.all([
      pool.query(`SELECT lr.*, cp.patient_name
        FROM lab_requests lr
        LEFT JOIN clinic_patients cp ON cp.id = lr.patient_id AND cp.tenant_id = lr.tenant_id
        WHERE lr.tenant_id=$1 ORDER BY lr.request_date DESC LIMIT 100`, [tid]),
      pool.query(`SELECT labr.*, cp.patient_name
        FROM lab_results labr
        LEFT JOIN clinic_patients cp ON cp.id = labr.patient_id AND cp.tenant_id = labr.tenant_id
        WHERE labr.tenant_id=$1 ORDER BY labr.result_date DESC LIMIT 50`, [tid]),
    ]);

    const pendingLabs = labRequests.rows.filter(l => l.status === 'requested' || l.status === 'processing').length;

    const reqRowsHtml = labRequests.rows.map(l => `<tr>
      <td><a href="/clinic/patients/${l.patient_id}" style="font-weight:600;color:#0891b2;text-decoration:none">${esc(l.patient_name || 'Patient #' + l.patient_id)}</a></td>
      <td>${esc(l.test_name || '—')}</td>
      <td>${fmtDate(l.request_date)}</td>
      <td>${esc(l.requested_by || '—')}</td>
      <td>${statusBadge(l.status)}</td>
    </tr>`).join('');

    const resRowsHtml = labResults.rows.map(r => `<tr>
      <td><a href="/clinic/patients/${r.patient_id}" style="font-weight:600;color:#0891b2;text-decoration:none">${esc(r.patient_name || 'Patient #' + r.patient_id)}</a></td>
      <td>${esc(r.test_name || '—')}</td>
      <td>${esc(r.result_value || '—')}</td>
      <td>${statusBadge(r.status || 'normal')}</td>
      <td>${fmtDate(r.result_date)}</td>
    </tr>`).join('');

    const html = CM_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('lab')}
      <h1 style="font-size:24px;color:#1e293b;margin-bottom:20px">🔬 Lab Management</h1>

      <div class="stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;margin-bottom:20px">
        <div class="stat-card"><div class="stat-num" style="color:#0891b2">${labRequests.rows.length}</div><div class="muted" style="font-size:11px">Total Requests</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${pendingLabs}</div><div class="muted" style="font-size:11px">Pending</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#16a34a">${labResults.rows.length}</div><div class="muted" style="font-size:11px">Results Recorded</div></div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
        <div class="card" style="padding:20px">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">📋 Lab Requests</h3>
          <div style="overflow-x:auto">
            <table class="cm-table"><thead><tr><th>Patient</th><th>Test</th><th>Date</th><th>Requested By</th><th>Status</th></tr></thead>
              <tbody>${reqRowsHtml || '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:20px">No lab requests</td></tr>'}</tbody>
            </table>
          </div>
        </div>
        <div class="card" style="padding:20px">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">📊 Lab Results</h3>
          <div style="overflow-x:auto">
            <table class="cm-table"><thead><tr><th>Patient</th><th>Test</th><th>Result</th><th>Status</th><th>Date</th></tr></thead>
              <tbody>${resRowsHtml || '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:20px">No lab results</td></tr>'}</tbody>
            </table>
          </div>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Lab Management', html, user, req));
  }));

  // ============================================================
  // ROUTE 15: POST /clinic/lab — Create lab request / record results
  // ============================================================
  app.post('/clinic/lab', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { action, patient_id, test_name, result_value, result_status, request_id } = req.body;

    if (action === 'request') {
      if (!patient_id || !test_name) {
        return res.send(renderPage('Error', '<div class="card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">Patient and test name required</h2><a href="/clinic/lab" class="cm-btn cm-btn-primary" style="margin-top:12px">← Back</a></div>', user, req));
      }
      await pool.query(
        `INSERT INTO lab_requests (tenant_id, patient_id, test_name, requested_by, request_date, status)
         VALUES ($1,$2,$3,$4,CURRENT_DATE,'requested')`,
        [tid, parseInt(patient_id), test_name, esc(user.name || user.email || 'Staff')]
      );
    } else if (action === 'result') {
      if (!request_id || !result_value) {
        return res.send(renderPage('Error', '<div class="card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">Request ID and result value required</h2><a href="/clinic/lab" class="cm-btn cm-btn-primary" style="margin-top:12px">← Back</a></div>', user, req));
      }
      const labReq = (await pool.query(`SELECT * FROM lab_requests WHERE id=$1 AND tenant_id=$2`, [parseInt(request_id), tid])).rows[0];
      if (labReq) {
        await pool.query(
          `INSERT INTO lab_results (tenant_id, request_id, patient_id, test_name, result_value, result_date, status)
           VALUES ($1,$2,$3,$4,$5,CURRENT_DATE,$6)`,
          [tid, parseInt(request_id), labReq.patient_id, labReq.test_name, result_value, result_status || 'normal']
        );
        await pool.query(`UPDATE lab_requests SET status='completed' WHERE id=$1 AND tenant_id=$2`, [parseInt(request_id), tid]);
      }
    }

    res.redirect('/clinic/lab');
  }));

  // ============================================================
  // ROUTE 16: GET /clinic/queue — Today's patient queue
  // ============================================================
  app.get('/clinic/queue', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    const queueList = (await pool.query(
      `SELECT pq.*, cp.patient_name, cp.phone
       FROM patient_queue pq
       LEFT JOIN clinic_patients cp ON cp.id = pq.patient_id AND cp.tenant_id = pq.tenant_id
       WHERE pq.tenant_id=$1 AND pq.queue_date=$2
       ORDER BY pq.arrival_time ASC`, [tid, today()]
    )).rows;

    const waitingCount = queueList.filter(q => q.status === 'waiting').length;
    const inProgressCount = queueList.filter(q => q.status === 'in_progress').length;
    const completedCount = queueList.filter(q => q.status === 'completed').length;

    const rowsHtml = queueList.map((q, i) => `<tr>
      <td><strong style="color:#0891b2">#${i + 1}</strong></td>
      <td><a href="/clinic/patients/${q.patient_id}" style="font-weight:600;color:#0891b2;text-decoration:none">${esc(q.patient_name || 'Patient #' + q.patient_id)}</a></td>
      <td>${esc(q.phone || '—')}</td>
      <td>${esc(q.complaint || q.reason || '—')}</td>
      <td>${fmtTime(q.arrival_time)}</td>
      <td>${statusBadge(q.status || 'waiting')}</td>
      <td>
        ${q.status === 'waiting' ? `<form method="POST" action="/clinic/queue/${q.id}/status" style="display:inline">
          <input type="hidden" name="status" value="in_progress"><button class="cm-btn cm-btn-primary" style="padding:5px 10px;font-size:11px">Start</button></form>` : ''}
        ${q.status === 'in_progress' ? `<form method="POST" action="/clinic/queue/${q.id}/status" style="display:inline">
          <input type="hidden" name="status" value="completed"><button class="cm-btn cm-btn-success" style="padding:5px 10px;font-size:11px">Complete</button></form>` : ''}
      </td>
    </tr>`).join('');

    const html = CM_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('queue')}
      <h1 style="font-size:24px;color:#1e293b;margin-bottom:20px">📋 Patient Queue — ${fmtDate(today())}</h1>

      <div class="stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:14px;margin-bottom:20px">
        <div class="stat-card"><div class="stat-num" style="color:#0891b2">${queueList.length}</div><div class="muted" style="font-size:11px">Total in Queue</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${waitingCount}</div><div class="muted" style="font-size:11px">Waiting</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#3b82f6">${inProgressCount}</div><div class="muted" style="font-size:11px">In Progress</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#16a34a">${completedCount}</div><div class="muted" style="font-size:11px">Completed</div></div>
      </div>

      <div class="card" style="padding:0;overflow:hidden">
        <div style="overflow-x:auto">
          <table class="cm-table">
            <thead><tr><th>#</th><th>Patient</th><th>Phone</th><th>Complaint</th><th>Arrived</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>${rowsHtml || '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:40px">No patients in queue today.</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Patient Queue', html, user, req));
  }));

  // Queue status update endpoint
  app.post('/clinic/queue/:id/status', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const validStatuses = ['waiting', 'in_progress', 'completed', 'cancelled'];
    const { status } = req.body;
    if (!validStatuses.includes(status)) return res.redirect('/clinic/queue');

    await pool.query(
      `UPDATE patient_queue SET status=$1 WHERE id=$2 AND tenant_id=$3`,
      [status, req.params.id, tid]
    );

    res.redirect('/clinic/queue');
  }));

  // ============================================================
  // ROUTE 17: GET /clinic/api/stats — JSON API
  // ============================================================
  app.get('/clinic/api/stats', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    const [patientCount, todayAppts, queueLen, labPending, lowStock] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS cnt FROM clinic_patients WHERE tenant_id=$1`, [tid]),
      pool.query(`SELECT COUNT(*)::int AS cnt FROM clinic_appointments WHERE tenant_id=$1 AND appointment_date=$2`, [tid, today()]),
      pool.query(`SELECT COUNT(*)::int AS cnt FROM patient_queue WHERE tenant_id=$1 AND queue_date=$2 AND status='waiting'`, [tid, today()]),
      pool.query(`SELECT COUNT(*)::int AS cnt FROM lab_requests WHERE tenant_id=$1 AND status IN ('requested','processing')`, [tid]),
      pool.query(`SELECT COUNT(*)::int AS cnt FROM pharmacy_inventory pi
        JOIN pharmacy_drugs pd ON pd.id = pi.drug_id AND pd.tenant_id = $1
        WHERE pi.tenant_id=$1 AND pi.quantity_in_stock <= pi.reorder_level`, [tid]),
    ]);

    res.json({
      totalPatients: patientCount.rows[0].cnt,
      todayAppointments: todayAppts.rows[0].cnt,
      waitingInQueue: queueLen.rows[0].cnt,
      pendingLabRequests: labPending.rows[0].cnt,
      lowStockMedications: lowStock.rows[0].cnt,
      timestamp: new Date().toISOString(),
    });
  }));

  // ============================================================
  // NEW MIGRATIONS — Prescription Templates, Vaccination Records,
  // Growth Charts, Emergency Alert Broadcast
  // ============================================================
  (async () => {
    const c = await pool.connect().catch(() => null);
    if (!c) { console.error('[ClinicMgmt] Cannot connect for new migrations'); return; }
    try {
      const NEW_MIGRATIONS = [
        `CREATE TABLE IF NOT EXISTS prescription_templates (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          name VARCHAR(255) NOT NULL,
          medicines_json TEXT,
          dosage TEXT,
          instructions TEXT,
          created_by INTEGER,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )`,
        `CREATE TABLE IF NOT EXISTS vaccination_records (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          patient_id INTEGER NOT NULL,
          vaccine_name VARCHAR(200),
          date_given DATE,
          next_due DATE,
          given_by INTEGER,
          notes TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )`,
        `CREATE TABLE IF NOT EXISTS clinic_health_alerts (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          title VARCHAR(255) NOT NULL,
          message TEXT,
          severity VARCHAR(20) DEFAULT 'info',
          target_audience VARCHAR(50) DEFAULT 'all_parents',
          sent_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )`,
      ];
      NEW_MIGRATIONS.forEach(m => { try { c.query(m); } catch(e) {} });
      try { NEW_MIGRATIONS.forEach(t => { const m = t.match(/IF NOT EXISTS (\w+)/); if (m) { try { /* VALID_TABLES add if available */ } catch(e) {} } }); } catch(e) {}

      const newIdxs = [
        'CREATE INDEX IF NOT EXISTS idx_pt_tenant ON prescription_templates(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_vr_tenant ON vaccination_records(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_vr_patient ON vaccination_records(patient_id)',
        'CREATE INDEX IF NOT EXISTS idx_vr_next_due ON vaccination_records(next_due)',
        'CREATE INDEX IF NOT EXISTS idx_cha_tenant ON clinic_health_alerts(tenant_id)',
      ];
      for (const sql of newIdxs) { try { await c.query(sql); } catch (_) {} }

      console.log('[ClinicMgmt] New migrations applied (prescription_templates, vaccination_records, clinic_health_alerts)');
    } catch (e) {
      console.error('[ClinicMgmt] New migration error:', e.message);
    } finally {
      c.release();
    }
  })();

  // ============================================================
  // PRESCRIPTION TEMPLATES — GET /clinic/prescriptions/templates
  // ============================================================
  app.get('/clinic/prescriptions/templates', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    const templates = (await pool.query(
      `SELECT pt.*, u.name AS creator_name FROM prescription_templates pt
       LEFT JOIN users u ON u.id = pt.created_by
       WHERE pt.tenant_id=$1 ORDER BY pt.created_at DESC LIMIT 100`, [tid]
    )).rows;

    const rowsHtml = templates.map(t => {
      let meds = [];
      try { meds = JSON.parse(t.medicines_json || '[]'); } catch(e) {}
      return `<tr>
        <td><strong>${esc(t.name)}</strong></td>
        <td>${esc(t.dosage || '—')}</td>
        <td style="max-width:200px">${esc((t.instructions || '').substring(0, 80))}${(t.instructions || '').length > 80 ? '...' : ''}</td>
        <td>${meds.length} medicine(s)</td>
        <td>${esc(t.creator_name || '—')}</td>
        <td>${fmtDate(t.created_at)}</td>
      </tr>`;
    }).join('');

    const html = CM_CSS + CM_DARK_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('prescriptions')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">📝 Prescription Templates</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">${templates.length} templates</p></div>
        <a href="#createTemplate" class="cm-btn cm-btn-primary" onclick="document.getElementById('createTemplateForm').style.display='block';return false">➕ New Template</a>
      </div>

      <div id="createTemplateForm" style="display:none" class="card" style="padding:24px;margin-bottom:20px">
        <div class="card" style="padding:24px;margin-bottom:20px;border-left:4px solid #0891b2">
          <h3 style="font-size:16px;color:#1e293b;margin:0 0 16px">Create Prescription Template</h3>
          <form method="POST" action="/clinic/prescriptions/templates">
            <div class="cm-form-group"><label>Template Name *</label><input type="text" name="name" required placeholder="e.g. Common Cold Medication"></div>
            <div class="cm-form-group"><label>Medicines (one per line)</label><textarea name="medicines" rows="4" placeholder="Paracetamol 500mg&#10;Cetirizine 10mg&#10;Amoxicillin 250mg"></textarea></div>
            <div class="cm-form-row">
              <div class="cm-form-group"><label>Dosage</label><input type="text" name="dosage" placeholder="e.g. 3 times daily after meals"></div>
              <div class="cm-form-group"><label>Instructions</label><input type="text" name="instructions" placeholder="e.g. Complete full course"></div>
            </div>
            <button type="submit" class="cm-btn cm-btn-primary">💾 Save Template</button>
            <button type="button" class="cm-btn cm-btn-secondary" onclick="document.getElementById('createTemplateForm').style.display='none'">Cancel</button>
          </form>
        </div>
      </div>

      <div class="card" style="padding:0;overflow:hidden">
        <div style="overflow-x:auto">
          <table class="cm-table">
            <thead><tr><th>Template Name</th><th>Dosage</th><th>Instructions</th><th>Medicines</th><th>Created By</th><th>Date</th></tr></thead>
            <tbody>${rowsHtml || '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:40px">No prescription templates yet.</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Prescription Templates', html, user, req));
  }));

  // ============================================================
  // PRESCRIPTION TEMPLATES — POST /clinic/prescriptions/templates
  // ============================================================
  app.post('/clinic/prescriptions/templates', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { name, medicines, dosage, instructions } = req.body;

    if (!name || !name.trim()) {
      return res.send(renderPage('Error', '<div class="card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">Template name is required</h2><a href="/clinic/prescriptions/templates" class="cm-btn cm-btn-primary" style="margin-top:12px">← Back</a></div>', user, req));
    }

    const medicinesArray = (medicines || '').split('\n').map(m => m.trim()).filter(m => m.length > 0);
    const medicinesJson = JSON.stringify(medicinesArray);

    await pool.query(
      `INSERT INTO prescription_templates (tenant_id, name, medicines_json, dosage, instructions, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [tid, name.trim(), medicinesJson, dosage || null, instructions || null, user.id]
    );

    console.log('[ClinicMgmt] Prescription template "' + name.trim() + '" created');
    res.redirect('/clinic/prescriptions/templates');
  }));

  // ============================================================
  // VACCINATION RECORDS — POST /clinic/patients/:id/vaccinations
  // ============================================================
  app.post('/clinic/patients/:id/vaccinations', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, pid = req.params.id;
    const { vaccine_name, date_given, next_due, notes } = req.body;

    if (!vaccine_name || !vaccine_name.trim()) {
      return res.redirect('/clinic/patients/' + pid);
    }

    await pool.query(
      `INSERT INTO vaccination_records (tenant_id, patient_id, vaccine_name, date_given, next_due, given_by, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [tid, parseInt(pid), vaccine_name.trim(), date_given || null, next_due || null, user.id, notes || null]
    );

    console.log('[ClinicMgmt] Vaccination "' + vaccine_name.trim() + '" recorded for patient #' + pid);
    res.redirect('/clinic/patients/' + pid + '#vaccinations');
  }));

  // ============================================================
  // VACCINATION RECORDS — GET /clinic/vaccinations/due
  // ============================================================
  app.get('/clinic/vaccinations/due', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    const dueRecords = (await pool.query(
      `SELECT vr.*, cp.patient_name, cp.phone, cp.emergency_contact, cp.emergency_phone
       FROM vaccination_records vr
       LEFT JOIN clinic_patients cp ON cp.id = vr.patient_id AND cp.tenant_id = vr.tenant_id
       WHERE vr.tenant_id=$1 AND vr.next_due IS NOT NULL AND vr.next_due <= CURRENT_DATE + INTERVAL '30 days'
       ORDER BY vr.next_due ASC LIMIT 200`, [tid]
    )).rows;

    const overdueCount = dueRecords.filter(r => r.next_due && new Date(r.next_due) < new Date()).length;
    const upcomingCount = dueRecords.length - overdueCount;

    const rowsHtml = dueRecords.map(r => {
      const isOverdue = r.next_due && new Date(r.next_due) < new Date();
      return `<tr>
        <td><a href="/clinic/patients/${r.patient_id}" style="font-weight:600;color:#0891b2;text-decoration:none">${esc(r.patient_name || 'Patient #' + r.patient_id)}</a></td>
        <td>${esc(r.vaccine_name || '—')}</td>
        <td>${fmtDate(r.date_given)}</td>
        <td>${isOverdue
          ? '<span style="color:#dc2626;font-weight:700">' + fmtDate(r.next_due) + ' — OVERDUE</span>'
          : '<span style="color:#f59e0b;font-weight:600">' + fmtDate(r.next_due) + '</span>'
        }</td>
        <td>${esc(r.notes || '—')}</td>
        <td>
          <a href="/clinic/patients/${r.patient_id}#vaccinations" class="cm-btn cm-btn-secondary" style="padding:4px 10px;font-size:11px">View Patient</a>
        </td>
      </tr>`;
    }).join('');

    const html = CM_CSS + CM_DARK_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('patients')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">💉 Vaccination Schedule</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Students with upcoming or overdue vaccinations</p></div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;margin-bottom:24px">
        <div class="stat-card"><div class="stat-num" style="color:#dc2626">${overdueCount}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Overdue</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${upcomingCount}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Upcoming (30 days)</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#0891b2">${dueRecords.length}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Total Due</div></div>
      </div>

      ${overdueCount > 0 ? '<div class="cm-alert cm-alert-danger"><span style="font-size:18px">⚠️</span><div><strong>' + overdueCount + ' student(s) have overdue vaccinations!</strong></div></div>' : ''}

      <div class="card" style="padding:0;overflow:hidden">
        <div style="overflow-x:auto">
          <table class="cm-table">
            <thead><tr><th>Patient</th><th>Vaccine</th><th>Last Given</th><th>Next Due</th><th>Notes</th><th>Actions</th></tr></thead>
            <tbody>${rowsHtml || '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:40px">No vaccinations due in the next 30 days.</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Vaccination Schedule', html, user, req));
  }));

  // ============================================================
  // VACCINATION RECORDS — GET /clinic/patients/:id/vaccinations
  // ============================================================
  app.get('/clinic/patients/:id/vaccinations', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, pid = req.params.id;

    const patient = (await pool.query(
      `SELECT * FROM clinic_patients WHERE id=$1 AND tenant_id=$2`, [pid, tid]
    )).rows[0];

    if (!patient) {
      return res.send(renderPage('Not Found', '<div class="card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">Patient not found</h2><a href="/clinic/patients" class="cm-btn cm-btn-primary" style="margin-top:12px">← Back to Patients</a></div>', user, req));
    }

    const vaccinations = (await pool.query(
      `SELECT vr.*, u.name AS giver_name FROM vaccination_records vr
       LEFT JOIN users u ON u.id = vr.given_by
       WHERE vr.tenant_id=$1 AND vr.patient_id=$2 ORDER BY vr.date_given DESC`, [tid, pid]
    )).rows;

    const rowsHtml = vaccinations.map(v => {
      const isOverdue = v.next_due && new Date(v.next_due) < new Date();
      return `<tr>
        <td>${esc(v.vaccine_name || '—')}</td>
        <td>${fmtDate(v.date_given)}</td>
        <td>${isOverdue
          ? '<span style="color:#dc2626;font-weight:700">' + fmtDate(v.next_due) + ' OVERDUE</span>'
          : fmtDate(v.next_due)
        }</td>
        <td>${esc(v.giver_name || '—')}</td>
        <td>${esc(v.notes || '—')}</td>
      </tr>`;
    }).join('');

    const html = CM_CSS + CM_DARK_CSS + `<div style="max-width:1000px;margin:0 auto">
      ${nav('patients')}
      <a href="/clinic/patients/${pid}" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Patient</a>
      <h1 style="font-size:24px;color:#1e293b;margin-bottom:20px">💉 Vaccination History — ${esc(patient.patient_name || 'Patient #' + pid)}</h1>

      <div class="card" style="padding:24px;margin-bottom:20px;border-left:4px solid #0891b2">
        <h3 style="font-size:16px;color:#1e293b;margin:0 0 16px">Add Vaccination Record</h3>
        <form method="POST" action="/clinic/patients/${pid}/vaccinations">
          <div class="cm-form-row">
            <div class="cm-form-group"><label>Vaccine Name *</label><input type="text" name="vaccine_name" required placeholder="e.g. BCG, MMR, DPT"></div>
            <div class="cm-form-group"><label>Date Given</label><input type="date" name="date_given" value="${today()}"></div>
          </div>
          <div class="cm-form-row">
            <div class="cm-form-group"><label>Next Due Date</label><input type="date" name="next_due"></div>
            <div class="cm-form-group"><label>Notes</label><input type="text" name="notes" placeholder="Batch #, site, reactions..."></div>
          </div>
          <button type="submit" class="cm-btn cm-btn-success">💉 Record Vaccination</button>
        </form>
      </div>

      <div class="card" style="padding:0;overflow:hidden">
        <div style="overflow-x:auto">
          <table class="cm-table">
            <thead><tr><th>Vaccine</th><th>Date Given</th><th>Next Due</th><th>Given By</th><th>Notes</th></tr></thead>
            <tbody>${rowsHtml || '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:40px">No vaccination records.</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Vaccination History', html, user, req));
  }));

  // ============================================================
  // GROWTH CHARTS — GET /clinic/patients/:id/growth
  // ============================================================
  app.get('/clinic/patients/:id/growth', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, pid = req.params.id;

    const patient = (await pool.query(
      `SELECT * FROM clinic_patients WHERE id=$1 AND tenant_id=$2`, [pid, tid]
    )).rows[0];

    if (!patient) {
      return res.send(renderPage('Not Found', '<div class="card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">Patient not found</h2><a href="/clinic/patients" class="cm-btn cm-btn-primary" style="margin-top:12px">← Back to Patients</a></div>', user, req));
    }

    const vitalsData = (await pool.query(
      `SELECT recorded_at, weight, height_cm
       FROM patient_vitals
       WHERE tenant_id=$1 AND patient_id=$2 AND (weight IS NOT NULL OR height_cm IS NOT NULL)
       ORDER BY recorded_at ASC`, [tid, pid]
    )).rows;

    const growthData = vitalsData.filter(v => v.weight && v.height_cm).map(v => {
      const h = parseFloat(v.height_cm) / 100;
      const w = parseFloat(v.weight);
      const bmi = h > 0 ? (w / (h * h)).toFixed(1) : null;
      return {
        date: v.recorded_at,
        label: fmtDate(v.recorded_at),
        weight: parseFloat(v.weight),
        height: parseFloat(v.height_cm),
        bmi: bmi ? parseFloat(bmi) : null,
      };
    });

    let svgChart = '';
    if (growthData.length >= 2) {
      const W = 700, H = 350, pad = 60;
      const dates = growthData.map(d => d.label);
      const weights = growthData.map(d => d.weight);
      const heights = growthData.map(d => d.height);
      const bmis = growthData.map(d => d.bmi).filter(b => b !== null);

      const wMin = Math.min(...weights) * 0.9;
      const wMax = Math.max(...weights) * 1.1;
      const hMin = Math.min(...heights) * 0.95;
      const hMax = Math.max(...heights) * 1.05;

      const xStep = (W - 2 * pad) / Math.max(growthData.length - 1, 1);

      const toX = (i) => pad + i * xStep;
      const toYW = (v) => pad + (H - 2 * pad) * (1 - (v - wMin) / Math.max(wMax - wMin, 0.1));
      const toYH = (v) => pad + (H - 2 * pad) * (1 - (v - hMin) / Math.max(hMax - hMin, 0.1));

      const weightLine = growthData.map((d, i) => `${toX(i)},${toYW(d.weight)}`).join(' ');
      const heightLine = growthData.map((d, i) => `${toX(i)},${toYH(d.height)}`).join(' ');
      const dots = growthData.map((d, i) =>
        `<circle cx="${toX(i)}" cy="${toYW(d.weight)}" r="4" fill="#0891b2" stroke="#fff" stroke-width="2"/>` +
        `<circle cx="${toX(i)}" cy="${toYH(d.height)}" r="4" fill="#f59e0b" stroke="#fff" stroke-width="2"/>` +
        `<text x="${toX(i)}" y="${H - pad + 15}" text-anchor="middle" font-size="9" fill="#94a3b8" transform="rotate(-30,${toX(i)},${H - pad + 15})">${dates[i]}</text>`
      ).join('');

      let bmiSvg = '';
      if (bmis.length >= 2) {
        const bmiMin = Math.min(...bmis, 15);
        const bmiMax = Math.max(...bmis, 30);
        const toYB = (v) => pad + (H - 2 * pad) * (1 - (v - bmiMin) / Math.max(bmiMax - bmiMin, 0.1));
        const bmiLine = growthData.filter(d => d.bmi !== null).map(d => {
          const idx = growthData.indexOf(d);
          return `${toX(idx)},${toYB(d.bmi)}`;
        }).join(' ');
        const bmiDots = growthData.filter(d => d.bmi !== null).map(d => {
          const idx = growthData.indexOf(d);
          return `<circle cx="${toX(idx)}" cy="${toYB(d.bmi)}" r="4" fill="#dc2626" stroke="#fff" stroke-width="2"/>`;
        }).join('');
        bmiSvg = '<polyline points="' + bmiLine + '" fill="none" stroke="#dc2626" stroke-width="2" stroke-linejoin="round" stroke-dasharray="3,3"/>' + bmiDots +
          '<rect x="' + (pad + 200) + '" y="8" width="12" height="4" rx="2" fill="#dc2626"/><text x="' + (pad + 218) + '" y="13" font-size="10" fill="#475569">BMI</text>';
      }

      svgChart = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:700px;background:#fff;border-radius:12px;border:1px solid #e2e8f0">
        <line x1="${pad}" y1="${pad}" x2="${pad}" y2="${H - pad}" stroke="#e2e8f0" stroke-width="1"/>
        <line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="#e2e8f0" stroke-width="1"/>
        <text x="${pad - 10}" y="${pad}" text-anchor="end" font-size="10" fill="#64748b">${wMax.toFixed(0)}kg</text>
        <text x="${pad - 10}" y="${H - pad}" text-anchor="end" font-size="10" fill="#64748b">${wMin.toFixed(0)}kg</text>
        <polyline points="${weightLine}" fill="none" stroke="#0891b2" stroke-width="2.5" stroke-linejoin="round"/>
        <polyline points="${heightLine}" fill="none" stroke="#f59e0b" stroke-width="2.5" stroke-linejoin="round" stroke-dasharray="6,3"/>
        ${bmiSvg}
        ${dots}
        <rect x="${pad}" y="8" width="12" height="4" rx="2" fill="#0891b2"/>
        <text x="${pad + 18}" y="13" font-size="10" fill="#475569">Weight (kg)</text>
        <rect x="${pad + 100}" y="8" width="12" height="4" rx="2" fill="#f59e0b"/>
        <text x="${pad + 118}" y="13" font-size="10" fill="#475569">Height (cm)</text>
      </svg>`;
    }

    const tableRows = growthData.map(d => `<tr>
      <td>${d.label}</td>
      <td>${d.weight} kg</td>
      <td>${d.height} cm</td>
      <td>${d.bmi !== null ? '<span style="font-weight:700;color:' + (d.bmi < 18.5 ? '#f59e0b' : d.bmi > 25 ? '#dc2626' : '#16a34a') + '">' + d.bmi + '</span>' : '—'}</td>
    </tr>`).join('');

    const html = CM_CSS + CM_DARK_CSS + `<div style="max-width:1000px;margin:0 auto">
      ${nav('patients')}
      <a href="/clinic/patients/${pid}" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Patient</a>
      <h1 style="font-size:24px;color:#1e293b;margin-bottom:20px">📈 Growth Chart — ${esc(patient.patient_name || 'Patient #' + pid)}</h1>

      <div class="card" style="padding:24px;margin-bottom:20px">
        <h3 style="font-size:15px;color:#1e293b;margin:0 0 16px">Height / Weight / BMI Trends</h3>
        ${svgChart || '<p style="text-align:center;color:#94a3b8;padding:40px">Insufficient growth data. At least 2 records with both height and weight are needed.</p>'}
      </div>

      <div class="card" style="padding:0;overflow:hidden">
        <div style="overflow-x:auto">
          <table class="cm-table">
            <thead><tr><th>Date</th><th>Weight</th><th>Height</th><th>BMI</th></tr></thead>
            <tbody>${tableRows || '<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:40px">No growth data available.</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Growth Chart', html, user, req));
  }));

  // ============================================================
  // EMERGENCY ALERT BROADCAST — GET /clinic/alerts
  // ============================================================
  app.get('/clinic/alerts', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    const alerts = (await pool.query(
      `SELECT * FROM clinic_health_alerts WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 100`, [tid]
    )).rows;

    const severityBadge = (s) => {
      const m = {
        critical: { bg: '#fef2f2', c: '#dc2626', label: '🔴 Critical' },
        warning: { bg: '#fffbeb', c: '#d97706', label: '🟡 Warning' },
        info: { bg: '#ecfeff', c: '#0891b2', label: '🔵 Info' },
        low: { bg: '#f0fdf4', c: '#16a34a', label: '🟢 Low' },
      };
      const v = m[s] || m.info;
      return `<span style="background:${v.bg};color:${v.c};padding:4px 12px;border-radius:8px;font-size:12px;font-weight:600">${v.label}</span>`;
    };

    const rowsHtml = alerts.map(a => `<tr>
      <td><strong>${esc(a.title)}</strong></td>
      <td>${severityBadge(a.severity)}</td>
      <td style="max-width:250px">${esc((a.message || '').substring(0, 100))}</td>
      <td>${esc(a.target_audience || 'all_parents')}</td>
      <td>${a.sent_at ? fmtDateTime(a.sent_at) : '<span style="color:#94a3b8">Not sent</span>'}</td>
      <td>${fmtDate(a.created_at)}</td>
    </tr>`).join('');

    const html = CM_CSS + CM_DARK_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('dash')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">🚨 Health Alerts</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">${alerts.length} alerts</p></div>
      </div>

      <div class="card" style="padding:24px;margin-bottom:20px;border-left:4px solid #dc2626">
        <h3 style="font-size:16px;color:#1e293b;margin:0 0 16px">Broadcast Health Alert</h3>
        <form method="POST" action="/clinic/alerts/broadcast">
          <div class="cm-form-group"><label>Alert Title *</label><input type="text" name="title" required placeholder="e.g. Flu Outbreak Warning"></div>
          <div class="cm-form-group"><label>Message *</label><textarea name="message" rows="3" required placeholder="Detailed alert message for parents..."></textarea></div>
          <div class="cm-form-row">
            <div class="cm-form-group"><label>Severity</label>
              <select name="severity">
                <option value="info">Info</option>
                <option value="low">Low</option>
                <option value="warning" selected>Warning</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <div class="cm-form-group"><label>Target Audience</label>
              <select name="target_audience">
                <option value="all_parents">All Parents</option>
                <option value="specific_class">Specific Class</option>
                <option value="teaching_staff">Teaching Staff</option>
                <option value="all">Everyone</option>
              </select>
            </div>
          </div>
          <button type="submit" class="cm-btn" style="background:#dc2626;color:#fff">🚨 Send Alert Broadcast</button>
        </form>
      </div>

      <div class="card" style="padding:0;overflow:hidden">
        <div style="overflow-x:auto">
          <table class="cm-table">
            <thead><tr><th>Title</th><th>Severity</th><th>Message</th><th>Audience</th><th>Sent At</th><th>Created</th></tr></thead>
            <tbody>${rowsHtml || '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:40px">No alerts yet.</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Health Alerts', html, user, req));
  }));

  // ============================================================
  // EMERGENCY ALERT BROADCAST — POST /clinic/alerts/broadcast
  // ============================================================
  app.post('/clinic/alerts/broadcast', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { title, message, severity, target_audience } = req.body;

    if (!title || !title.trim() || !message || !message.trim()) {
      return res.send(renderPage('Error', '<div class="card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">Title and message are required</h2><a href="/clinic/alerts" class="cm-btn cm-btn-primary" style="margin-top:12px">← Back</a></div>', user, req));
    }

    await pool.query(
      `INSERT INTO clinic_health_alerts (tenant_id, title, message, severity, target_audience, sent_at, created_at)
       VALUES ($1,$2,$3,$4,$5,NOW(),NOW())`,
      [tid, title.trim(), message.trim(), severity || 'info', target_audience || 'all_parents']
    );

    try {
      const parents = (await pool.query(
        `SELECT phone, email FROM clinic_patients WHERE tenant_id=$1 AND email IS NOT NULL LIMIT 500`, [tid]
      )).rows;
      console.log('[ClinicMgmt] Alert broadcast "' + title.trim() + '" sent to ' + parents.length + ' contacts (severity: ' + (severity || 'info') + ', audience: ' + (target_audience || 'all_parents') + ')');
      try { await global.trackRevenue('clinic_alert_broadcast', 0, 'Health alert broadcast by ' + user.email + ': ' + title.trim(), 'clinic-alert-' + tid + '-' + Date.now()); } catch(e) {}
    } catch (e) {
      console.error('[ClinicMgmt] Error broadcasting alert:', e.message);
    }

    res.redirect('/clinic/alerts');
  }));

  // ============================================================
  // DARK MODE CSS — Medical theme for clinic pages
  // ============================================================
  const CM_DARK_CSS = `<style>
    @media (prefers-color-scheme: dark) {
      .cm-table th { background: #1e293b; color: #94a3b8; border-bottom-color: #334155; }
      .cm-table td { color: #e2e8f0; border-bottom-color: #1e293b; }
      .cm-table tr:hover { background: #1e293b; }
      .cm-nav a { background: #1e293b; color: #94a3b8; }
      .cm-nav a:hover { background: #334155; color: #cffafe; }
      .cm-nav a.active { background: #0891b2; color: #fff; }
      .cm-filter input, .cm-filter select,
      .cm-form-group input, .cm-form-group select, .cm-form-group textarea {
        background: #1e293b; border-color: #334155; color: #e2e8f0;
      }
      .cm-filter input:focus, .cm-filter select:focus,
      .cm-form-group input:focus, .cm-form-group select:focus, .cm-form-group textarea:focus {
        border-color: #0891b2; outline: none;
      }
      .cm-filter label, .cm-form-group label { color: #94a3b8; }
      .cm-alert-danger { background: #1c1917; border-color: #44403c; color: #fca5a5; }
      .cm-alert-warning { background: #1c1917; border-color: #44403c; color: #fde68a; }
      .cm-alert-info { background: #0c4a6e; border-color: #155e75; color: #a5f3fc; }
      .cm-section h3 { color: #e2e8f0; border-bottom-color: #164e63; }
    }
  </style>`;

};
