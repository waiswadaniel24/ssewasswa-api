// ============================================================
// STUDENT HEALTH RECORDS MODULE — Multi-Tenant SaaS Platform
// Health profiles, clinic visits, screenings, BMI tracking,
// allergy alerts, emergency contacts, class-wise reports.
// Color theme: #059669 (green/health)
// ============================================================
// Usage in server.js:
//   const studentHealth = require('./student-health');
//   studentHealth(app, db, pool, renderPage, esc);
// ============================================================

'use strict';

module.exports = function studentHealth(app, db, pool, renderPage, esc) {

  // -- inline helpers ---------------------------------------------------
  const requireAuth = (req, res, next) => {
    if (!req.session?.user) return res.redirect('/login');
    next();
  };

  const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  if (!esc) esc = (s) => String(s == null ? '' : (typeof s === 'object' ? JSON.stringify(s) : s))
    .replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  // -- internal helpers ---------------------------------------------------
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const today = () => new Date().toISOString().slice(0, 10);

  function statusBadge(s) {
    const m = {
      completed: { cls: 'badge-success', label: 'Completed' },
      scheduled: { cls: 'badge-warning', label: 'Scheduled' },
      pending: { cls: 'badge-warning', label: 'Pending' },
      normal: { cls: 'badge-success', label: 'Normal' },
      abnormal: { cls: 'badge-error', label: 'Abnormal' },
      follow_up: { cls: 'badge', label: 'Follow-up', style: 'background:#dbeafe;color:#1d4ed8' },
      discharged: { cls: 'badge-success', label: 'Discharged' },
      referred: { cls: 'badge', label: 'Referred', style: 'background:#fef3c7;color:#92400e' },
      severe: { cls: 'badge-error', label: 'Severe' },
      moderate: { cls: 'badge-warning', label: 'Moderate' },
      mild: { cls: 'badge-success', label: 'Mild' },
    };
    const v = m[s] || { cls: 'badge', label: s };
    return `<span class="badge ${v.cls}" ${v.style ? 'style="' + v.style + '"' : ''}>${v.label}</span>`;
  }

  function bmiCategory(bmi) {
    if (bmi < 18.5) return { label: 'Underweight', color: '#3b82f6' };
    if (bmi < 25) return { label: 'Normal', color: '#16a34a' };
    if (bmi < 30) return { label: 'Overweight', color: '#f59e0b' };
    return { label: 'Obese', color: '#dc2626' };
  }

  function calcBMI(height, weight) {
    if (!height || !weight) return null;
    const h = parseFloat(height) / 100; // cm to m
    const w = parseFloat(weight);
    if (h <= 0 || w <= 0) return null;
    return parseFloat((w / (h * h)).toFixed(1));
  }

  // -- shared CSS --------------------------------------------------------
  const SH_CSS = `<style>
    .sh-nav{display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap}
    .sh-nav a{padding:8px 18px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#475569;background:#f1f5f9;transition:.15s}
    .sh-nav a:hover{background:#d1fae5;color:#065f46}.sh-nav a.active{background:#059669;color:#fff}
    .sh-btn{display:inline-flex;align-items:center;gap:6px;padding:9px 18px;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:.15s}
    .sh-btn:hover{opacity:.9;transform:translateY(-1px)}
    .sh-btn-primary{background:#059669;color:#fff}.sh-btn-success{background:#16a34a;color:#fff}
    .sh-btn-danger{background:#fee2e2;color:#dc2626}.sh-btn-secondary{background:#f1f5f9;color:#475569}
    .sh-btn-warning{background:#fef3c7;color:#92400e}
    .sh-table{width:100%;border-collapse:collapse;font-size:13px}
    .sh-table th{padding:11px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#f0fdf4}
    .sh-table td{padding:10px 14px;border-bottom:1px solid #f1f5f9;color:#1e293b}
    .sh-table tr:hover{background:#f0fdf4}
    .sh-filter{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:end}
    .sh-filter label{display:block;font-size:12px;font-weight:600;color:#64748b;margin-bottom:4px}
    .sh-filter input,.sh-filter select{padding:8px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px;background:#fff}
    .sh-filter input:focus,.sh-filter select:focus{outline:none;border-color:#059669}
    .sh-alert{padding:12px 18px;border-radius:10px;margin-bottom:16px;font-size:13px;font-weight:500;display:flex;align-items:center;gap:10px}
    .sh-alert-danger{background:#fef2f2;border:1px solid #fecaca;color:#991b1b}
    .sh-alert-warning{background:#fffbeb;border:1px solid #fde68a;color:#92400e}
    .sh-alert-info{background:#f0fdf4;border:1px solid #bbf7d0;color:#065f46}
    .sh-card-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}
    .sh-form-group{margin-bottom:18px}
    .sh-form-group label{display:block;font-size:13px;font-weight:600;color:#475569;margin-bottom:6px}
    .sh-form-group input,.sh-form-group select,.sh-form-group textarea{width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;background:#fff;box-sizing:border-box}
    .sh-form-group input:focus,.sh-form-group select:focus,.sh-form-group textarea:focus{outline:none;border-color:#059669}
    .sh-form-group textarea{resize:vertical;min-height:80px}
    .sh-form-row{display:grid;grid-template-columns:1fr 1fr;gap:14px}
    .sh-form-row-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px}
    .sh-bmi-bar{height:12px;border-radius:6px;background:linear-gradient(to right,#3b82f6 0%,#3b82f6 25%,#16a34a 25%,#16a34a 50%,#f59e0b 50%,#f59e0b 75%,#dc2626 75%,#dc2626 100%);position:relative;margin:8px 0 4px}
    .sh-bmi-marker{position:absolute;top:-4px;width:4px;height:20px;background:#1e293b;border-radius:2px;transform:translateX(-50%)}
    .sh-section{margin-bottom:24px}
    .sh-section h3{font-size:16px;color:#1e293b;margin:0 0 12px;padding-bottom:8px;border-bottom:2px solid #d1fae5}
    @media(max-width:768px){.sh-nav{gap:4px}.sh-nav a{padding:6px 12px;font-size:12px}.sh-form-row,.sh-form-row-3{grid-template-columns:1fr}}
  </style>`;

  // -- navigation helper --------------------------------------------------
  const nav = (active) => `<div class="sh-nav">
    <a href="/student-health" class="${active === 'dash' ? 'active' : ''}">🏥 Dashboard</a>
    <a href="/student-health/records" class="${active === 'records' ? 'active' : ''}">📋 Health Records</a>
    <a href="/student-health/visits" class="${active === 'visits' ? 'active' : ''}">🩺 Clinic Visits</a>
    <a href="/student-health/screenings" class="${active === 'screenings' ? 'active' : ''}">🔍 Screenings</a>
    <a href="/student-health/reports" class="${active === 'reports' ? 'active' : ''}">📊 Reports</a>
  </div>`;

  // ============================================================
  // DATABASE MIGRATIONS (async IIFE)
  // ============================================================
  (async () => {
    const c = await pool.connect().catch(() => null);
    if (!c) { console.error('[StudentHealth] Cannot connect to DB for migrations'); return; }
    try {
      // -- ALTER student_health: add missing columns ----------------------
      const shCols = [
        ['height', 'NUMERIC(6,2)'],
        ['weight', 'NUMERIC(6,2)'],
        ['vision', 'VARCHAR(50)'],
        ['hearing', 'VARCHAR(50)'],
        ['dental_status', 'VARCHAR(50)'],
        ['insurance_provider', 'VARCHAR(255)'],
        ['insurance_number', 'VARCHAR(100)'],
        ['doctor_name', 'VARCHAR(255)'],
        ['doctor_phone', 'VARCHAR(50)'],
        ['allergies_list', 'JSONB'],
        ['conditions_list', 'JSONB'],
        ['medications', 'TEXT'],
        ['immunizations', 'JSONB'],
        ['created_by', 'INTEGER'],
      ];
      for (const [col, type] of shCols) {
        try { await c.query(`ALTER TABLE student_health ADD COLUMN IF NOT EXISTS ${col} ${type}`); } catch (e) { /* ignore */ }
      }

      // -- CREATE health_visits -------------------------------------------
      await c.query(`CREATE TABLE IF NOT EXISTS health_visits (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        student_id INTEGER NOT NULL,
        visit_date DATE NOT NULL,
        visit_type VARCHAR(50) DEFAULT 'general',
        symptoms TEXT,
        diagnosis TEXT,
        treatment TEXT,
        doctor_name VARCHAR(255),
        follow_up_date DATE,
        status VARCHAR(20) DEFAULT 'completed',
        notes TEXT,
        created_by INTEGER,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      // -- CREATE health_screenings ---------------------------------------
      await c.query(`CREATE TABLE IF NOT EXISTS health_screenings (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        student_id INTEGER NOT NULL,
        screening_date DATE NOT NULL,
        screening_type VARCHAR(50) DEFAULT 'general',
        results TEXT,
        status VARCHAR(20) DEFAULT 'completed',
        notes TEXT,
        created_by INTEGER,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      // -- INDEXES --------------------------------------------------------
      await c.query(`CREATE INDEX IF NOT EXISTS idx_sh_tenant ON student_health(tenant_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_sh_student ON student_health(student_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_sh_blood ON student_health(tenant_id, blood_group)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_hv_tenant ON health_visits(tenant_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_hv_student ON health_visits(student_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_hv_date ON health_visits(visit_date)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_hv_status ON health_visits(tenant_id, status)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_hs_tenant ON health_screenings(tenant_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_hs_student ON health_screenings(student_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_hs_date ON health_screenings(screening_date)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_hs_type ON health_screenings(tenant_id, screening_type)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_hs_status ON health_screenings(tenant_id, status)`);

      console.log('[StudentHealth] Migrations applied successfully');
    } catch (e) {
      console.error('[StudentHealth] Migration error:', e.message);
    } finally {
      c.release();
    }
  })();

  // ============================================================
  // ROUTE 1: GET /student-health — Dashboard
  // ============================================================
  app.get('/student-health', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    // Total health records
    const totalRecords = (await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM student_health WHERE tenant_id=$1`, [tid]
    )).rows[0].cnt;

    // Visits this month
    const visitsMonth = (await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM health_visits
       WHERE tenant_id=$1 AND visit_date >= date_trunc('month', CURRENT_DATE)`, [tid]
    )).rows[0].cnt;

    // Pending / scheduled screenings
    const pendingScreenings = (await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM health_screenings
       WHERE tenant_id=$1 AND status IN ('pending','scheduled')`, [tid]
    )).rows[0].cnt;

    // Allergy alert count (students with severe allergies)
    const allergyAlerts = (await pool.query(
      `SELECT id, student_id, allergies, allergies_list, emergency_contact, emergency_phone,
              (SELECT name FROM students s WHERE s.id = sh.student_id LIMIT 1) AS student_name
       FROM student_health sh
       WHERE tenant_id=$1
       AND (allergies IS NOT NULL AND allergies <> ''
            OR allergies_list IS NOT NULL AND allergies_list::text <> '[]' AND allergies_list::text <> 'null')
       ORDER BY student_id`, [tid]
    )).rows;

    // Overdue screenings (no screening in last 6 months)
    const overdueStudents = (await pool.query(
      `SELECT sh.student_id, sh.last_checkup,
              (SELECT name FROM students s WHERE s.id = sh.student_id LIMIT 1) AS student_name
       FROM student_health sh
       WHERE sh.tenant_id=$1
       AND (sh.last_checkup IS NULL OR sh.last_checkup < CURRENT_DATE - INTERVAL '6 months')
       ORDER BY COALESCE(sh.last_checkup, '1970-01-01') ASC
       LIMIT 15`, [tid]
    )).rows;

    // Recent visits
    const recentVisits = (await pool.query(
      `SELECT hv.*,
              (SELECT name FROM students s WHERE s.id = hv.student_id LIMIT 1) AS student_name
       FROM health_visits hv
       WHERE hv.tenant_id=$1
       ORDER BY hv.visit_date DESC, hv.created_at DESC
       LIMIT 8`, [tid]
    )).rows;

    // BMI distribution
    const bmiRows = (await pool.query(
      `SELECT height, weight FROM student_health WHERE tenant_id=$1 AND height IS NOT NULL AND height > 0 AND weight IS NOT NULL AND weight > 0`, [tid]
    )).rows;
    let bmiUnder = 0, bmiNormal = 0, bmiOver = 0, bmiObese = 0;
    bmiRows.forEach(r => {
      const bmi = calcBMI(r.height, r.weight);
      if (!bmi) return;
      if (bmi < 18.5) bmiUnder++;
      else if (bmi < 25) bmiNormal++;
      else if (bmi < 30) bmiOver++;
      else bmiObese++;
    });
    const bmiTotal = bmiUnder + bmiNormal + bmiOver + bmiObese;
    const bmiBar = (count, color, label) => {
      const pct = bmiTotal > 0 ? Math.round(count / bmiTotal * 100) : 0;
      return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <span style="font-size:12px;color:#64748b;min-width:80px">${label}</span>
        <div style="flex:1;background:#f1f5f9;border-radius:6px;height:20px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:${color};border-radius:6px;display:flex;align-items:center;justify-content:flex-end;padding-right:6px">
            <span style="font-size:11px;font-weight:700;color:#fff">${count > 0 ? count : ''}</span>
          </div>
        </div>
        <span style="font-size:11px;color:#94a3b8;min-width:40px">${pct}%</span>
      </div>`;
    };

    // Allergy alerts HTML
    const allergyHtml = allergyAlerts.length > 0
      ? `<div class="sh-alert sh-alert-danger">
           <span style="font-size:18px">⚠️</span>
           <div>
             <strong>Allergy Alert — ${allergyAlerts.length} student(s) with allergies</strong>
             <div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:8px">
               ${allergyAlerts.slice(0, 8).map(a => {
                 const allergiesStr = a.allergies || (a.allergies_list ? (Array.isArray(a.allergies_list) ? a.allergies_list.join(', ') : a.allergies_list) : 'Unknown');
                 return `<div style="background:#fff;padding:6px 12px;border-radius:8px;font-size:12px;border:1px solid #fecaca">
                   <strong>${esc(a.student_name || 'Student #' + a.student_id)}</strong>:
                   ${esc(String(allergiesStr).substring(0, 60))}${String(allergiesStr).length > 60 ? '...' : ''}
                   ${a.emergency_phone ? ` — 📞 ${esc(a.emergency_phone)}` : ''}
                 </div>`;
               }).join('')}
               ${allergyAlerts.length > 8 ? `<div style="font-size:12px;color:#991b1b;font-weight:600">+${allergyAlerts.length - 8} more</div>` : ''}
             </div>
           </div>
         </div>`
      : `<div class="sh-alert sh-alert-info"><span style="font-size:18px">✅</span> No allergy alerts — all students are clear.</div>`;

    // Overdue screenings HTML
    const overdueHtml = overdueStudents.length > 0
      ? `<div class="sh-alert sh-alert-warning">
           <span style="font-size:18px">🔔</span>
           <div>
             <strong>Overdue Screenings — ${overdueStudents.length} student(s) not screened in 6+ months</strong>
             <div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:8px">
               ${overdueStudents.slice(0, 6).map(s => `<div style="background:#fff;padding:6px 12px;border-radius:8px;font-size:12px;border:1px solid #fde68a">
                 <strong>${esc(s.student_name || 'Student #' + s.student_id)}</strong>
                 ${s.last_checkup ? ` — Last: ${esc(fmtDate(s.last_checkup))}` : ' — Never screened'}
               </div>`).join('')}
               ${overdueStudents.length > 6 ? `<div style="font-size:12px;color:#92400e;font-weight:600">+${overdueStudents.length - 6} more</div>` : ''}
             </div>
           </div>
         </div>`
      : `<div class="sh-alert sh-alert-info"><span style="font-size:18px">✅</span> All screenings are up to date.</div>`;

    // Recent visits HTML
    const visitsHtml = recentVisits.length > 0
      ? recentVisits.map(v => `<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid #f1f5f9">
           <div style="width:36px;height:36px;border-radius:10px;background:#d1fae5;display:flex;align-items:center;justify-content:center;font-size:16px">🩺</div>
           <div style="flex:1">
             <div style="font-size:13px;font-weight:600;color:#1e293b">${esc(v.student_name || 'Student #' + v.student_id)}</div>
             <div style="font-size:12px;color:#64748b">${esc(v.visit_type || 'general')} · ${esc(v.diagnosis || 'No diagnosis')}</div>
           </div>
           <div style="text-align:right">
             ${statusBadge(v.status)}
             <div style="font-size:11px;color:#94a3b8;margin-top:2px">${esc(fmtDate(v.visit_date))}</div>
           </div>
         </div>`).join('')
      : '<p style="text-align:center;color:#94a3b8;padding:20px">No recent clinic visits</p>';

    const html = SH_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('dash')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">🏥 Student Health Dashboard</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Monitor student health records, visits, and screenings</p></div>
        <div style="display:flex;gap:8px">
          <a href="/student-health/records/new" class="sh-btn sh-btn-primary">➕ New Health Record</a>
          <a href="/student-health/visits/new" class="sh-btn sh-btn-secondary">🩺 Record Visit</a>
        </div>
      </div>

      <!-- Alerts -->
      <div class="sh-section">
        ${allergyHtml}
        ${overdueHtml}
      </div>

      <!-- Stats -->
      <div class="stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;margin-bottom:24px">
        <div class="stat-card"><div class="stat-num" style="color:#059669">${totalRecords}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Total Records</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#0d9488">${visitsMonth}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Visits This Month</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${pendingScreenings}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Pending Screenings</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#dc2626">${allergyAlerts.length}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Allergy Alerts</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#8b5cf6">${overdueStudents.length}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Overdue Screenings</div></div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px">
        <!-- BMI Distribution -->
        <div class="card" style="padding:20px">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">📊 BMI Distribution${bmiTotal > 0 ? ' (' + bmiTotal + ' students)' : ''}</h3>
          ${bmiTotal > 0 ? bmiBar(bmiUnder, '#3b82f6', 'Underweight') + bmiBar(bmiNormal, '#16a34a', 'Normal') + bmiBar(bmiOver, '#f59e0b', 'Overweight') + bmiBar(bmiObese, '#dc2626', 'Obese')
            : '<p style="text-align:center;color:#94a3b8;padding:20px">No BMI data available</p>'}
          <div class="sh-bmi-bar" style="margin-top:8px">
            <div style="display:flex;justify-content:space-between;font-size:10px;color:#64748b;margin-top:2px">
              <span>0</span><span>18.5</span><span>25</span><span>30</span><span>40+</span>
            </div>
          </div>
        </div>

        <!-- Recent Visits -->
        <div class="card" style="padding:20px">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">🩺 Recent Clinic Visits</h3>
          ${visitsHtml}
        </div>
      </div>

      <!-- Quick Links -->
      <div class="card" style="padding:20px">
        <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">⚡ Quick Actions</h3>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <a href="/student-health/records/new" class="sh-btn sh-btn-primary">➕ Add Health Record</a>
          <a href="/student-health/visits/new" class="sh-btn sh-btn-secondary">🩺 New Clinic Visit</a>
          <a href="/student-health/screenings" class="sh-btn sh-btn-secondary">🔍 Schedule Screening</a>
          <a href="/student-health/reports" class="sh-btn sh-btn-warning">📊 View Reports</a>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Student Health Dashboard', html, user, req));
  }));

  // ============================================================
  // ROUTE 2: GET /student-health/records — List all records
  // ============================================================
  app.get('/student-health/records', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const search = (req.query.q || '').trim();
    const bloodFilter = req.query.blood_group || '';

    let sql = `SELECT sh.*,
                (SELECT name FROM students s WHERE s.id = sh.student_id LIMIT 1) AS student_name,
                (SELECT class FROM students s WHERE s.id = sh.student_id LIMIT 1) AS student_class
               FROM student_health sh
               WHERE sh.tenant_id=$1`;
    const params = [tid];
    let pi = 2;

    if (search) {
      sql += ` AND ((SELECT name FROM students s WHERE s.id = sh.student_id LIMIT 1) ILIKE '%' || $${pi} || '%'
                 OR (SELECT class FROM students s WHERE s.id = sh.student_id LIMIT 1) ILIKE '%' || $${pi} || '%')`;
      params.push(search);
      pi++;
    }
    if (bloodFilter) {
      sql += ` AND sh.blood_group=$${pi}`;
      params.push(bloodFilter);
      pi++;
    }

    sql += ` ORDER BY sh.created_at DESC LIMIT 200`;

    const records = (await pool.query(sql, params)).rows;

    const rowsHtml = records.map(r => {
      const bmi = calcBMI(r.height, r.weight);
      const bmiCat = bmi ? bmiCategory(bmi) : null;
      const allergiesInfo = r.allergies || (r.allergies_list ? (Array.isArray(r.allergies_list) ? r.allergies_list.join(', ') : String(r.allergies_list)) : '');
      const hasAllergies = allergiesInfo && allergiesInfo !== 'null' && allergiesInfo.trim() !== '';

      return `<tr>
        <td><a href="/student-health/records/${r.id}" style="font-weight:600;color:#059669;text-decoration:none">${esc(r.student_name || 'Student #' + r.student_id)}</a>
          ${hasAllergies ? ' <span class="badge badge-error" style="font-size:10px">⚠ Allergy</span>' : ''}</td>
        <td>${esc(r.student_class || '—')}</td>
        <td><span class="badge" style="background:#fef2f2;color:#dc2626;font-size:11px">${esc(r.blood_group || 'Unknown')}</span></td>
        <td>${r.height && r.weight ? `${esc(String(r.height))} cm / ${esc(String(r.weight))} kg` : '—'}</td>
        <td>${bmi ? `<span style="color:${bmiCat.color};font-weight:600">${bmi}</span> <span style="font-size:11px;color:#64748b">(${bmiCat.label})</span>` : '—'}</td>
        <td>${esc(r.emergency_contact || '—')}</td>
        <td>${esc(r.emergency_phone || '—')}</td>
        <td><a href="/student-health/records/${r.id}" class="sh-btn sh-btn-secondary" style="padding:5px 12px;font-size:12px">View</a></td>
      </tr>`;
    }).join('');

    const html = SH_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('records')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">📋 Student Health Records</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">${records.length} records found</p></div>
        <a href="/student-health/records/new" class="sh-btn sh-btn-primary">➕ New Health Record</a>
      </div>

      <div class="sh-filter">
        <div style="flex:1;min-width:200px"><label>Search by student name or class</label>
          <form method="GET" style="display:flex;gap:8px">
            <input type="text" name="q" value="${esc(search)}" placeholder="Type name or class...">
            <select name="blood_group" style="min-width:100px">
              <option value="">All Blood Groups</option>
              ${['A+','A-','B+','B-','AB+','AB-','O+','O-'].map(bg => `<option value="${bg}" ${bloodFilter === bg ? 'selected' : ''}>${bg}</option>`).join('')}
            </select>
            <button type="submit" class="sh-btn sh-btn-primary" style="padding:8px 16px">🔍 Search</button>
            ${search || bloodFilter ? '<a href="/student-health/records" class="sh-btn sh-btn-secondary" style="padding:8px 16px">✕ Clear</a>' : ''}
          </form>
        </div>
      </div>

      <div class="card" style="padding:0;overflow:hidden">
        <div style="overflow-x:auto">
          <table class="sh-table">
            <thead><tr><th>Student</th><th>Class</th><th>Blood Group</th><th>Height / Weight</th><th>BMI</th><th>Emergency Contact</th><th>Emergency Phone</th><th>Actions</th></tr></thead>
            <tbody>${rowsHtml || '<tr><td colspan="8" style="text-align:center;color:#94a3b8;padding:40px">No health records found. <a href="/student-health/records/new" style="color:#059669">Create one now</a>.</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Health Records', html, user, req));
  }));

  // ============================================================
  // ROUTE 3: GET /student-health/records/:id — View full record
  // ============================================================
  app.get('/student-health/records/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, recordId = req.params.id;

    const record = (await pool.query(
      `SELECT sh.*,
              (SELECT name FROM students s WHERE s.id = sh.student_id LIMIT 1) AS student_name,
              (SELECT class FROM students s WHERE s.id = sh.student_id LIMIT 1) AS student_class
       FROM student_health sh
       WHERE sh.id=$1 AND sh.tenant_id=$2`, [recordId, tid]
    )).rows[0];

    if (!record) {
      return res.send(renderPage('Not Found', '<div class="card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">Health record not found</h2><a href="/student-health/records" class="sh-btn sh-btn-primary" style="margin-top:12px">← Back to Records</a></div>', user, req));
    }

    // Visit history
    const visits = (await pool.query(
      `SELECT * FROM health_visits WHERE tenant_id=$1 AND student_id=$2 ORDER BY visit_date DESC`, [tid, record.student_id]
    )).rows;

    // Screening history
    const screenings = (await pool.query(
      `SELECT * FROM health_screenings WHERE tenant_id=$1 AND student_id=$2 ORDER BY screening_date DESC`, [tid, record.student_id]
    )).rows;

    // BMI calculation
    const bmi = calcBMI(record.height, record.weight);
    const bmiCat = bmi ? bmiCategory(bmi) : null;
    const bmiPct = bmi ? Math.min(Math.max((bmi / 40) * 100, 0), 100) : null;

    // Allergies display
    const allergiesList = record.allergies_list && Array.isArray(record.allergies_list) ? record.allergies_list : [];
    const allergiesText = record.allergies || '';

    // Conditions display
    const conditionsList = record.conditions_list && Array.isArray(record.conditions_list) ? record.conditions_list : [];
    const conditionsText = record.conditions || '';

    // Immunizations display
    const immunizationsList = record.immunizations && Array.isArray(record.immunizations) ? record.immunizations : [];

    // Profile sections
    const infoRow = (label, value) => `<div style="display:flex;padding:8px 0;border-bottom:1px solid #f1f5f9">
      <span style="min-width:180px;font-size:13px;color:#64748b;font-weight:600">${label}</span>
      <span style="font-size:13px;color:#1e293b">${value || '—'}</span>
    </div>`;

    const profileHtml = `<div class="card" style="padding:24px">
      <h3 style="font-size:16px;color:#1e293b;margin:0 0 16px">👤 Student Health Profile</h3>
      ${infoRow('Student Name', `<strong>${esc(record.student_name || 'Unknown')}</strong>`)}
      ${infoRow('Student ID', record.student_id)}
      ${infoRow('Class', record.student_class)}
      ${infoRow('Blood Group', `<span style="background:#fef2f2;color:#dc2626;padding:3px 10px;border-radius:6px;font-weight:700;font-size:13px">${esc(record.blood_group || 'Unknown')}</span>`)}
      ${infoRow('Height', record.height ? `${record.height} cm` : '')}
      ${infoRow('Weight', record.weight ? `${record.weight} kg` : '')}
      ${infoRow('BMI', bmi ? `<span style="color:${bmiCat.color};font-weight:700;font-size:15px">${bmi}</span> — <span style="color:${bmiCat.color}">${bmiCat.label}</span>
        <div style="width:200px;margin-top:4px">
          <div class="sh-bmi-bar"><div class="sh-bmi-marker" style="left:${bmiPct}%"></div></div>
          <div style="display:flex;justify-content:space-between;font-size:9px;color:#94a3b8"><span>0</span><span>18.5</span><span>25</span><span>30</span><span>40</span></div>
        </div>` : '—')}
      ${infoRow('Vision', record.vision)}
      ${infoRow('Hearing', record.hearing)}
      ${infoRow('Dental Status', record.dental_status)}
      ${infoRow('Last Checkup', fmtDate(record.last_checkup))}
      ${infoRow('Insurance Provider', record.insurance_provider)}
      ${infoRow('Insurance Number', record.insurance_number)}
      ${infoRow('Family Doctor', record.doctor_name)}
      ${infoRow("Doctor's Phone", record.doctor_phone)}
      ${infoRow('Medications', record.medications ? `<div style="white-space:pre-wrap">${esc(record.medications)}</div>` : '')}
      ${infoRow('Notes', record.notes ? `<div style="white-space:pre-wrap">${esc(record.notes)}</div>` : '')}
      ${infoRow('Record Created', fmtDateTime(record.created_at))}
    </div>`;

    // Emergency contact card
    const emergencyHtml = `<div class="card" style="padding:24px;border-left:4px solid #dc2626">
      <h3 style="font-size:16px;color:#dc2626;margin:0 0 16px">🚨 Emergency Contact</h3>
      ${infoRow('Contact Name', `<strong style="color:#dc2626">${esc(record.emergency_contact || 'Not provided')}</strong>`)}
      ${infoRow('Phone', `<a href="tel:${esc(record.emergency_phone || '')}" style="color:#059669;font-weight:600;font-size:15px">${esc(record.emergency_phone || 'Not provided')}</a>`)}
    </div>`;

    // Allergies card
    const allergiesHtml = `<div class="card" style="padding:24px;border-left:4px solid #f59e0b">
      <h3 style="font-size:16px;color:#92400e;margin:0 0 16px">⚠️ Allergies</h3>
      ${allergiesList.length > 0 ? allergiesList.map(a => {
        const severity = a.severity || 'moderate';
        return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #fef3c7">
          ${statusBadge(severity)}
          <div>
            <strong style="color:#1e293b">${esc(a.name || a.allergen || 'Unknown')}</strong>
            ${a.reaction ? `<div style="font-size:12px;color:#64748b">Reaction: ${esc(a.reaction)}</div>` : ''}
            ${a.notes ? `<div style="font-size:12px;color:#94a3b8">${esc(a.notes)}</div>` : ''}
          </div>
        </div>`;
      }).join('') : (allergiesText ? `<p style="color:#1e293b;font-size:13px">${esc(allergiesText)}</p>` : '<p style="color:#94a3b8;font-size:13px">No known allergies</p>')}
    </div>`;

    // Conditions card
    const conditionsHtml = `<div class="card" style="padding:24px;border-left:4px solid #8b5cf6">
      <h3 style="font-size:16px;color:#6d28d9;margin:0 0 16px">📋 Medical Conditions</h3>
      ${conditionsList.length > 0 ? conditionsList.map(c => {
        const severity = c.severity || 'moderate';
        return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f3e8ff">
          ${statusBadge(severity)}
          <div>
            <strong style="color:#1e293b">${esc(c.name || c.condition || 'Unknown')}</strong>
            ${c.status ? `<div style="font-size:12px;color:#64748b">Status: ${esc(c.status)}</div>` : ''}
            ${c.notes ? `<div style="font-size:12px;color:#94a3b8">${esc(c.notes)}</div>` : ''}
          </div>
        </div>`;
      }).join('') : (conditionsText ? `<p style="color:#1e293b;font-size:13px">${esc(conditionsText)}</p>` : '<p style="color:#94a3b8;font-size:13px">No known conditions</p>')}
    </div>`;

    // Immunizations card
    const immunizationsHtml = `<div class="card" style="padding:24px;border-left:4px solid #059669">
      <h3 style="font-size:16px;color:#065f46;margin:0 0 16px">💉 Immunizations</h3>
      ${immunizationsList.length > 0 ? immunizationsList.map(im => {
        return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #d1fae5">
          <span style="background:#d1fae5;color:#065f46;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:600">${esc(im.status || 'done')}</span>
          <div>
            <strong style="color:#1e293b">${esc(im.name || im.vaccine || 'Unknown')}</strong>
            ${im.date ? `<div style="font-size:12px;color:#64748b">${esc(fmtDate(im.date))}</div>` : ''}
            ${im.notes ? `<div style="font-size:12px;color:#94a3b8">${esc(im.notes)}</div>` : ''}
          </div>
        </div>`;
      }).join('') : '<p style="color:#94a3b8;font-size:13px">No immunization records</p>'}
    </div>`;

    // Visits table
    const visitsTableHtml = visits.length > 0
      ? `<table class="sh-table"><thead><tr><th>Date</th><th>Type</th><th>Symptoms</th><th>Diagnosis</th><th>Treatment</th><th>Doctor</th><th>Status</th><th>Follow-up</th></tr></thead>
         <tbody>${visits.map(v => `<tr>
           <td>${fmtDate(v.visit_date)}</td><td>${esc(v.visit_type || 'general')}</td>
           <td style="max-width:150px">${esc((v.symptoms || '').substring(0, 80))}</td>
           <td style="max-width:150px">${esc((v.diagnosis || '').substring(0, 80))}</td>
           <td style="max-width:150px">${esc((v.treatment || '').substring(0, 80))}</td>
           <td>${esc(v.doctor_name || '—')}</td><td>${statusBadge(v.status)}</td>
           <td>${v.follow_up_date ? fmtDate(v.follow_up_date) : '—'}</td>
         </tr>`).join('')}</tbody></table>`
      : '<p style="text-align:center;color:#94a3b8;padding:20px">No clinic visits recorded</p>';

    // Screenings table
    const screeningsTableHtml = screenings.length > 0
      ? `<table class="sh-table"><thead><tr><th>Date</th><th>Type</th><th>Results</th><th>Status</th><th>Notes</th></tr></thead>
         <tbody>${screenings.map(s => `<tr>
           <td>${fmtDate(s.screening_date)}</td><td>${esc(s.screening_type || 'general')}</td>
           <td style="max-width:200px">${esc((s.results || '').substring(0, 120))}</td>
           <td>${statusBadge(s.status)}</td><td style="max-width:150px">${esc((s.notes || '').substring(0, 80))}</td>
         </tr>`).join('')}</tbody></table>`
      : '<p style="text-align:center;color:#94a3b8;padding:20px">No screening records</p>';

    const html = SH_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('records')}
      <a href="/student-health/records" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Records</a>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">${esc(record.student_name || 'Student #' + record.student_id)}</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">${esc(record.student_class || '')} ${record.blood_group ? '· Blood Group: ' + record.blood_group : ''}</p></div>
        <div style="display:flex;gap:8px">
          <a href="/student-health/records/new?student_id=${record.student_id}&edit=${record.id}" class="sh-btn sh-btn-primary">✏️ Edit Record</a>
          <a href="/student-health/visits/new?student_id=${record.student_id}" class="sh-btn sh-btn-secondary">🩺 New Visit</a>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
        ${profileHtml}
        <div>
          ${emergencyHtml}
          ${allergiesHtml}
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
        ${conditionsHtml}
        ${immunizationsHtml}
      </div>

      <div class="sh-section">
        <div class="card" style="padding:20px;margin-bottom:16px">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">🩺 Clinic Visit History (${visits.length})</h3>
          <div style="overflow-x:auto">${visitsTableHtml}</div>
        </div>
      </div>

      <div class="sh-section">
        <div class="card" style="padding:20px">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">🔍 Screening History (${screenings.length})</h3>
          <div style="overflow-x:auto">${screeningsTableHtml}</div>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Health Record — ' + (record.student_name || '#' + record.student_id), html, user, req));
  }));

  // ============================================================
  // ROUTE 4: GET /student-health/records/new — Create/update form
  // ============================================================
  app.get('/student-health/records/new', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const editId = req.query.edit ? parseInt(req.query.edit) : null;
    const preStudentId = req.query.student_id ? parseInt(req.query.student_id) : null;

    // Fetch students for dropdown
    const students = (await pool.query(
      `SELECT id, name, class FROM students WHERE tenant_id=$1 ORDER BY name`, [tid]
    )).rows;

    let record = null;
    if (editId) {
      record = (await pool.query(
        `SELECT * FROM student_health WHERE id=$1 AND tenant_id=$2`, [editId, tid]
      )).rows[0];
    }

    // JSON fields for prefill
    const allergiesListJson = record?.allergies_list ? JSON.stringify(record.allergies_list) : '[]';
    const conditionsListJson = record?.conditions_list ? JSON.stringify(record.conditions_list) : '[]';
    const immunizationsJson = record?.immunizations ? JSON.stringify(record.immunizations) : '[]';

    const isEdit = !!record;
    const studentOptions = students.map(s =>
      `<option value="${s.id}" ${(record?.student_id || preStudentId) === s.id ? 'selected' : ''}>${esc(s.name || 'ID ' + s.id)}${s.class ? ' — ' + esc(s.class) : ''}</option>`
    ).join('');

    const bloodOptions = ['', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map(bg =>
      `<option value="${bg}" ${record?.blood_group === bg ? 'selected' : ''}>${bg || 'Select...'}</option>`
    ).join('');

    const html = SH_CSS + `<div style="max-width:900px;margin:0 auto">
      ${nav('records')}
      <a href="/student-health/records" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Records</a>

      <div class="card" style="padding:28px">
        <h2 style="margin:0 0 4px;color:#1e293b">${isEdit ? '✏️ Edit Health Record' : '➕ New Health Record'}</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:24px">${isEdit ? 'Update the student health information below' : 'Create a comprehensive health profile for a student'}</p>

        <form method="POST" action="/student-health/records/save" id="healthRecordForm">
          <input type="hidden" name="id" value="${record?.id || ''}">

          <!-- Student Selection -->
          <div class="sh-section">
            <h3>👤 Student Information</h3>
            <div class="sh-form-group">
              <label>Student *</label>
              <select name="student_id" required ${isEdit ? 'disabled' : ''}>
                <option value="">Select a student...</option>
                ${studentOptions}
              </select>
              ${isEdit ? `<input type="hidden" name="student_id" value="${record.student_id}">` : ''}
            </div>
          </div>

          <!-- Basic Health -->
          <div class="sh-section">
            <h3>🏥 Basic Health Information</h3>
            <div class="sh-form-row-3">
              <div class="sh-form-group"><label>Blood Group</label><select name="blood_group"><option value="">Unknown</option>${bloodOptions}</select></div>
              <div class="sh-form-group"><label>Height (cm)</label><input type="number" name="height" step="0.1" min="0" max="300" value="${record?.height || ''}" placeholder="e.g. 165"></div>
              <div class="sh-form-group"><label>Weight (kg)</label><input type="number" name="weight" step="0.1" min="0" max="500" value="${record?.weight || ''}" placeholder="e.g. 55"></div>
            </div>
            <div class="sh-form-row-3">
              <div class="sh-form-group"><label>Vision</label><input type="text" name="vision" value="${esc(record?.vision || '')}" placeholder="e.g. 20/20, 6/6"></div>
              <div class="sh-form-group"><label>Hearing</label><input type="text" name="hearing" value="${esc(record?.hearing || '')}" placeholder="e.g. Normal"></div>
              <div class="sh-form-group"><label>Dental Status</label><input type="text" name="dental_status" value="${esc(record?.dental_status || '')}" placeholder="e.g. Good, Needs Checkup"></div>
            </div>
            <div class="sh-form-row">
              <div class="sh-form-group"><label>Last Checkup Date</label><input type="date" name="last_checkup" value="${record?.last_checkup ? record.last_checkup.toISOString().slice(0,10) : today()}"></div>
              <div class="sh-form-group"><label>Medications</label><textarea name="medications" placeholder="Current medications, dosages...">${esc(record?.medications || '')}</textarea></div>
            </div>
          </div>

          <!-- Allergies (JSONB) -->
          <div class="sh-section">
            <h3>⚠️ Allergies</h3>
            <div id="allergies-container"></div>
            <button type="button" onclick="addAllergy()" class="sh-btn sh-btn-secondary" style="margin-top:8px">+ Add Allergy</button>
            <div class="sh-form-group" style="margin-top:8px"><label>Or enter as text (legacy)</label><textarea name="allergies" placeholder="List of allergies...">${esc(record?.allergies || '')}</textarea></div>
            <input type="hidden" name="allergies_list" id="allergies_list_input" value='${esc(allergiesListJson)}'>
          </div>

          <!-- Conditions (JSONB) -->
          <div class="sh-section">
            <h3>📋 Medical Conditions</h3>
            <div id="conditions-container"></div>
            <button type="button" onclick="addCondition()" class="sh-btn sh-btn-secondary" style="margin-top:8px">+ Add Condition</button>
            <div class="sh-form-group" style="margin-top:8px"><label>Or enter as text (legacy)</label><textarea name="conditions" placeholder="List of medical conditions...">${esc(record?.conditions || '')}</textarea></div>
            <input type="hidden" name="conditions_list" id="conditions_list_input" value='${esc(conditionsListJson)}'>
          </div>

          <!-- Immunizations (JSONB) -->
          <div class="sh-section">
            <h3>💉 Immunizations</h3>
            <div id="immunizations-container"></div>
            <button type="button" onclick="addImmunization()" class="sh-btn sh-btn-secondary" style="margin-top:8px">+ Add Immunization</button>
            <input type="hidden" name="immunizations" id="immunizations_input" value='${esc(immunizationsJson)}'>
          </div>

          <!-- Emergency Contact -->
          <div class="sh-section">
            <h3>🚨 Emergency Contact</h3>
            <div class="sh-form-row">
              <div class="sh-form-group"><label>Emergency Contact Name *</label><input type="text" name="emergency_contact" value="${esc(record?.emergency_contact || '')}" placeholder="Parent/Guardian name" required></div>
              <div class="sh-form-group"><label>Emergency Phone *</label><input type="tel" name="emergency_phone" value="${esc(record?.emergency_phone || '')}" placeholder="Phone number" required></div>
            </div>
          </div>

          <!-- Insurance & Doctor -->
          <div class="sh-section">
            <h3>🏛️ Insurance & Doctor</h3>
            <div class="sh-form-row">
              <div class="sh-form-group"><label>Insurance Provider</label><input type="text" name="insurance_provider" value="${esc(record?.insurance_provider || '')}" placeholder="e.g. NHIF, AAR"></div>
              <div class="sh-form-group"><label>Insurance Number</label><input type="text" name="insurance_number" value="${esc(record?.insurance_number || '')}" placeholder="Policy/member number"></div>
            </div>
            <div class="sh-form-row">
              <div class="sh-form-group"><label>Family Doctor Name</label><input type="text" name="doctor_name" value="${esc(record?.doctor_name || '')}" placeholder="Dr. ..."></div>
              <div class="sh-form-group"><label>Doctor Phone</label><input type="tel" name="doctor_phone" value="${esc(record?.doctor_phone || '')}" placeholder="Phone number"></div>
            </div>
          </div>

          <!-- Notes -->
          <div class="sh-section">
            <h3>📝 Additional Notes</h3>
            <div class="sh-form-group"><textarea name="notes" rows="3" placeholder="Any additional health notes...">${esc(record?.notes || '')}</textarea></div>
          </div>

          <div style="display:flex;gap:10px;margin-top:20px">
            <button type="submit" class="sh-btn sh-btn-primary" style="padding:14px 32px;font-size:15px">${isEdit ? '💾 Update Record' : '💾 Save Record'}</button>
            <a href="/student-health/records" class="sh-btn sh-btn-secondary" style="padding:14px 24px">Cancel</a>
          </div>
        </form>
      </div>
    </div>

    <script>
      // Allergy management
      let allergies = JSON.parse(document.getElementById('allergies_list_input').value || '[]');
      function renderAllergies() {
        const c = document.getElementById('allergies-container');
        c.innerHTML = allergies.map((a, i) => '<div style="display:flex;gap:8px;margin-bottom:8px;align-items:end;flex-wrap:wrap">' +
          '<div style="flex:1;min-width:150px"><label style="font-size:11px;color:#64748b">Allergen</label><input type="text" value="' + esc(a.name || a.allergen || '') + '" onchange="allergies[' + i + '].name=this.value" class="sh-form-group" style="margin:0"></div>' +
          '<div style="flex:1;min-width:150px"><label style="font-size:11px;color:#64748b">Reaction</label><input type="text" value="' + esc(a.reaction || '') + '" onchange="allergies[' + i + '].reaction=this.value" class="sh-form-group" style="margin:0"></div>' +
          '<div style="min-width:100px"><label style="font-size:11px;color:#64748b">Severity</label><select onchange="allergies[' + i + '].severity=this.value"><option value="mild"' + (a.severity==='mild'?' selected':'') + '>Mild</option><option value="moderate"' + (a.severity==='moderate'||!a.severity?' selected':'') + '>Moderate</option><option value="severe"' + (a.severity==='severe'?' selected':'') + '>Severe</option></select></div>' +
          '<button type="button" onclick="allergies.splice(' + i + ',1);renderAllergies()" style="padding:8px;background:#fee2e2;border:none;border-radius:8px;color:#dc2626;cursor:pointer;font-size:16px">✕</button></div>'
        ).join('');
        document.getElementById('allergies_list_input').value = JSON.stringify(allergies);
      }
      function addAllergy() { allergies.push({name:'',reaction:'',severity:'moderate'}); renderAllergies(); }
      function esc(s){return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
      renderAllergies();

      // Condition management
      let conditions = JSON.parse(document.getElementById('conditions_list_input').value || '[]');
      function renderConditions() {
        const c = document.getElementById('conditions-container');
        c.innerHTML = conditions.map((cd, i) => '<div style="display:flex;gap:8px;margin-bottom:8px;align-items:end;flex-wrap:wrap">' +
          '<div style="flex:1;min-width:150px"><label style="font-size:11px;color:#64748b">Condition</label><input type="text" value="' + esc(cd.name || cd.condition || '') + '" onchange="conditions[' + i + '].name=this.value" class="sh-form-group" style="margin:0"></div>' +
          '<div style="flex:1;min-width:150px"><label style="font-size:11px;color:#64748b">Status</label><input type="text" value="' + esc(cd.status || '') + '" onchange="conditions[' + i + '].status=this.value" class="sh-form-group" style="margin:0"></div>' +
          '<div style="min-width:100px"><label style="font-size:11px;color:#64748b">Severity</label><select onchange="conditions[' + i + '].severity=this.value"><option value="mild"' + (cd.severity==='mild'?' selected':'') + '>Mild</option><option value="moderate"' + (cd.severity==='moderate'||!cd.severity?' selected':'') + '>Moderate</option><option value="severe"' + (cd.severity==='severe'?' selected':'') + '>Severe</option></select></div>' +
          '<button type="button" onclick="conditions.splice(' + i + ',1);renderConditions()" style="padding:8px;background:#fee2e2;border:none;border-radius:8px;color:#dc2626;cursor:pointer;font-size:16px">✕</button></div>'
        ).join('');
        document.getElementById('conditions_list_input').value = JSON.stringify(conditions);
      }
      function addCondition() { conditions.push({name:'',status:'',severity:'moderate'}); renderConditions(); }
      renderConditions();

      // Immunization management
      let immunizations = JSON.parse(document.getElementById('immunizations_input').value || '[]');
      function renderImmunizations() {
        const c = document.getElementById('immunizations-container');
        c.innerHTML = immunizations.map((im, i) => '<div style="display:flex;gap:8px;margin-bottom:8px;align-items:end;flex-wrap:wrap">' +
          '<div style="flex:1;min-width:150px"><label style="font-size:11px;color:#64748b">Vaccine</label><input type="text" value="' + esc(im.name || im.vaccine || '') + '" onchange="immunizations[' + i + '].name=this.value" class="sh-form-group" style="margin:0"></div>' +
          '<div style="min-width:140px"><label style="font-size:11px;color:#64748b">Date</label><input type="date" value="' + (im.date||'') + '" onchange="immunizations[' + i + '].date=this.value" class="sh-form-group" style="margin:0"></div>' +
          '<div style="min-width:100px"><label style="font-size:11px;color:#64748b">Status</label><select onchange="immunizations[' + i + '].status=this.value"><option value="done"' + (im.status==='done'||!im.status?' selected':'') + '>Done</option><option value="scheduled"' + (im.status==='scheduled'?' selected':'') + '>Scheduled</option><option value="overdue"' + (im.status==='overdue'?' selected':'') + '>Overdue</option></select></div>' +
          '<button type="button" onclick="immunizations.splice(' + i + ',1);renderImmunizations()" style="padding:8px;background:#fee2e2;border:none;border-radius:8px;color:#dc2626;cursor:pointer;font-size:16px">✕</button></div>'
        ).join('');
        document.getElementById('immunizations_input').value = JSON.stringify(immunizations);
      }
      function addImmunization() { immunizations.push({name:'',date:'',status:'done'}); renderImmunizations(); }
      renderImmunizations();

      // Save form: update hidden inputs
      document.getElementById('healthRecordForm').addEventListener('submit', function() {
        document.getElementById('allergies_list_input').value = JSON.stringify(allergies);
        document.getElementById('conditions_list_input').value = JSON.stringify(conditions);
        document.getElementById('immunizations_input').value = JSON.stringify(immunizations);
      });
    </script>`;
    res.send(renderPage(isEdit ? 'Edit Health Record' : 'New Health Record', html, user, req));
  }));

  // ============================================================
  // ROUTE 5: POST /student-health/records/save — Save health record
  // ============================================================
  app.post('/student-health/records/save', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const {
      id, student_id, blood_group, height, weight, vision, hearing, dental_status,
      last_checkup, allergies, conditions, emergency_contact, emergency_phone,
      notes, medications, insurance_provider, insurance_number, doctor_name, doctor_phone,
      allergies_list, conditions_list, immunizations
    } = req.body;

    if (!student_id) {
      req.session.flash = { type: 'error', msg: 'Please select a student.' };
      return res.redirect('/student-health/records/new');
    }

    // Parse JSON fields
    let parsedAllergies = null;
    let parsedConditions = null;
    let parsedImmunizations = null;
    try { parsedAllergies = allergies_list ? JSON.parse(allergies_list) : null; } catch (e) { parsedAllergies = null; }
    try { parsedConditions = conditions_list ? JSON.parse(conditions_list) : null; } catch (e) { parsedConditions = null; }
    try { parsedImmunizations = immunizations ? JSON.parse(immunizations) : null; } catch (e) { parsedImmunizations = null; }

    // Filter out empty entries
    if (Array.isArray(parsedAllergies)) parsedAllergies = parsedAllergies.filter(a => a.name || a.allergen);
    if (Array.isArray(parsedConditions)) parsedConditions = parsedConditions.filter(c => c.name || c.condition);
    if (Array.isArray(parsedImmunizations)) parsedImmunizations = parsedImmunizations.filter(im => im.name || im.vaccine);

    if (id) {
      // Update
      await pool.query(
        `UPDATE student_health SET
          student_id=$1, blood_group=$2, height=$3, weight=$4, vision=$5, hearing=$6,
          dental_status=$7, last_checkup=$8, allergies=$9, conditions=$10,
          emergency_contact=$11, emergency_phone=$12, notes=$13, medications=$14,
          insurance_provider=$15, insurance_number=$16, doctor_name=$17, doctor_phone=$18,
          allergies_list=$19, conditions_list=$20, immunizations=$21
        WHERE id=$22 AND tenant_id=$23`,
        [
          parseInt(student_id), blood_group || null,
          height ? parseFloat(height) : null, weight ? parseFloat(weight) : null,
          vision || null, hearing || null, dental_status || null,
          last_checkup || null, allergies || null, conditions || null,
          emergency_contact || null, emergency_phone || null,
          notes || null, medications || null,
          insurance_provider || null, insurance_number || null,
          doctor_name || null, doctor_phone || null,
          parsedAllergies || null, parsedConditions || null, parsedImmunizations || null,
          parseInt(id), tid
        ]
      );
      req.session.flash = { type: 'success', msg: 'Health record updated successfully.' };
    } else {
      // Check if record already exists for this student
      const existing = (await pool.query(
        `SELECT id FROM student_health WHERE tenant_id=$1 AND student_id=$2`, [tid, parseInt(student_id)]
      )).rows[0];

      if (existing) {
        // Update existing
        await pool.query(
          `UPDATE student_health SET
            blood_group=$1, height=$2, weight=$3, vision=$4, hearing=$5,
            dental_status=$6, last_checkup=$7, allergies=$8, conditions=$9,
            emergency_contact=$10, emergency_phone=$11, notes=$12, medications=$13,
            insurance_provider=$14, insurance_number=$15, doctor_name=$16, doctor_phone=$17,
            allergies_list=$18, conditions_list=$19, immunizations=$20, created_by=$21
          WHERE id=$22 AND tenant_id=$23`,
          [
            blood_group || null, height ? parseFloat(height) : null, weight ? parseFloat(weight) : null,
            vision || null, hearing || null, dental_status || null,
            last_checkup || null, allergies || null, conditions || null,
            emergency_contact || null, emergency_phone || null,
            notes || null, medications || null,
            insurance_provider || null, insurance_number || null,
            doctor_name || null, doctor_phone || null,
            parsedAllergies || null, parsedConditions || null, parsedImmunizations || null,
            user.id, existing.id, tid
          ]
        );
        req.session.flash = { type: 'success', msg: 'Health record updated for existing student.' };
      } else {
        // Insert
        await pool.query(
          `INSERT INTO student_health (tenant_id, student_id, blood_group, height, weight, vision, hearing,
            dental_status, last_checkup, allergies, conditions, emergency_contact, emergency_phone,
            notes, medications, insurance_provider, insurance_number, doctor_name, doctor_phone,
            allergies_list, conditions_list, immunizations, created_by)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
          [
            tid, parseInt(student_id), blood_group || null,
            height ? parseFloat(height) : null, weight ? parseFloat(weight) : null,
            vision || null, hearing || null, dental_status || null,
            last_checkup || null, allergies || null, conditions || null,
            emergency_contact || null, emergency_phone || null,
            notes || null, medications || null,
            insurance_provider || null, insurance_number || null,
            doctor_name || null, doctor_phone || null,
            parsedAllergies || null, parsedConditions || null, parsedImmunizations || null,
            user.id
          ]
        );
        req.session.flash = { type: 'success', msg: 'Health record created successfully.' };
      }
    }

    // Redirect to view the record (find it by student_id)
    const saved = (await pool.query(
      `SELECT id FROM student_health WHERE tenant_id=$1 AND student_id=$2`, [tid, parseInt(student_id)]
    )).rows[0];
    res.redirect('/student-health/records/' + (saved ? saved.id : ''));
  }));

  // ============================================================
  // ROUTE 6: GET /student-health/visits — List health visits
  // ============================================================
  app.get('/student-health/visits', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const statusFilter = req.query.status || '';
    const typeFilter = req.query.type || '';
    const search = (req.query.q || '').trim();

    let sql = `SELECT hv.*,
                (SELECT name FROM students s WHERE s.id = hv.student_id LIMIT 1) AS student_name,
                (SELECT class FROM students s WHERE s.id = hv.student_id LIMIT 1) AS student_class
               FROM health_visits hv
               WHERE hv.tenant_id=$1`;
    const params = [tid];
    let pi = 2;

    if (statusFilter) { sql += ` AND hv.status=$${pi++}`; params.push(statusFilter); }
    if (typeFilter) { sql += ` AND hv.visit_type=$${pi++}`; params.push(typeFilter); }
    if (search) { sql += ` AND ((SELECT name FROM students s WHERE s.id = hv.student_id LIMIT 1) ILIKE '%' || $${pi} || '%')`; params.push(search); }

    sql += ` ORDER BY hv.visit_date DESC, hv.created_at DESC LIMIT 200`;

    const visits = (await pool.query(sql, params)).rows;

    // Status counts
    const statusCounts = (await pool.query(
      `SELECT status, COUNT(*)::int AS cnt FROM health_visits WHERE tenant_id=$1 GROUP BY status`, [tid]
    )).rows;
    const statusMap = {};
    statusCounts.forEach(r => { statusMap[r.status] = r.cnt; });

    const rowsHtml = visits.map(v => `<tr>
      <td><a href="/student-health/records/${v.student_id}" style="font-weight:600;color:#059669;text-decoration:none">${esc(v.student_name || 'Student #' + v.student_id)}</a></td>
      <td>${esc(v.student_class || '—')}</td>
      <td>${fmtDate(v.visit_date)}</td>
      <td><span class="badge" style="background:#d1fae5;color:#065f46">${esc(v.visit_type || 'general')}</span></td>
      <td style="max-width:180px">${esc((v.symptoms || '').substring(0, 100))}</td>
      <td style="max-width:180px">${esc((v.diagnosis || '').substring(0, 100))}</td>
      <td>${esc(v.doctor_name || '—')}</td>
      <td>${statusBadge(v.status)}</td>
      <td>${v.follow_up_date ? `<span style="color:#f59e0b">📅 ${esc(fmtDate(v.follow_up_date))}</span>` : '—'}</td>
    </tr>`).join('');

    const html = SH_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('visits')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">🩺 Clinic Visit Log</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">${visits.length} visits recorded</p></div>
        <a href="/student-health/visits/new" class="sh-btn sh-btn-primary">➕ Record New Visit</a>
      </div>

      <!-- Status tabs -->
      <div style="display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap">
        <a href="/student-health/visits" class="sh-btn sh-btn-secondary ${!statusFilter ? 'active' : ''}" style="${!statusFilter ? 'background:#059669;color:#fff' : ''}">All (${visits.length})</a>
        ${['completed','pending','follow_up','referred','discharged'].map(s => `<a href="/student-health/visits?status=${s}" class="sh-btn sh-btn-secondary" style="${statusFilter === s ? 'background:#059669;color:#fff' : ''}">${s.replace('_',' ')} (${statusMap[s] || 0})</a>`).join('')}
      </div>

      <div class="sh-filter">
        <div><label>Visit Type</label><select onchange="location.href='/student-health/visits?status=${esc(statusFilter)}&type='+this.value">
          <option value="">All Types</option>
          ${['general','emergency','follow_up','routine','specialist'].map(t => `<option value="${t}" ${typeFilter === t ? 'selected' : ''}>${t.replace('_',' ')}</option>`).join('')}
        </select></div>
        <div style="flex:1;min-width:180px"><label>Search Student</label>
          <form method="GET" style="display:flex;gap:8px">
            <input type="hidden" name="status" value="${esc(statusFilter)}">
            <input type="hidden" name="type" value="${esc(typeFilter)}">
            <input type="text" name="q" value="${esc(search)}" placeholder="Student name...">
            <button type="submit" class="sh-btn sh-btn-primary" style="padding:8px 16px">🔍</button>
          </form>
        </div>
      </div>

      <div class="card" style="padding:0;overflow:hidden">
        <div style="overflow-x:auto">
          <table class="sh-table">
            <thead><tr><th>Student</th><th>Class</th><th>Date</th><th>Type</th><th>Symptoms</th><th>Diagnosis</th><th>Doctor</th><th>Status</th><th>Follow-up</th></tr></thead>
            <tbody>${rowsHtml || '<tr><td colspan="9" style="text-align:center;color:#94a3b8;padding:40px">No visits recorded yet</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Clinic Visit Log', html, user, req));
  }));

  // ============================================================
  // ROUTE 7: GET /student-health/visits/new — New visit form
  // ============================================================
  app.get('/student-health/visits/new', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const preStudentId = req.query.student_id ? parseInt(req.query.student_id) : null;

    const students = (await pool.query(
      `SELECT id, name, class FROM students WHERE tenant_id=$1 ORDER BY name`, [tid]
    )).rows;

    const studentOptions = students.map(s =>
      `<option value="${s.id}" ${preStudentId === s.id ? 'selected' : ''}>${esc(s.name || 'ID ' + s.id)}${s.class ? ' — ' + esc(s.class) : ''}</option>`
    ).join('');

    const html = SH_CSS + `<div style="max-width:800px;margin:0 auto">
      ${nav('visits')}
      <a href="/student-health/visits" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Visit Log</a>

      <div class="card" style="padding:28px">
        <h2 style="margin:0 0 4px;color:#1e293b">🩺 Record Clinic Visit</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:24px">Document a student's visit to the school clinic</p>

        <form method="POST" action="/student-health/visits/save">
          <div class="sh-form-group"><label>Student *</label>
            <select name="student_id" required><option value="">Select a student...</option>${studentOptions}</select></div>

          <div class="sh-form-row-3">
            <div class="sh-form-group"><label>Visit Date *</label><input type="date" name="visit_date" required value="${today()}"></div>
            <div class="sh-form-group"><label>Visit Type</label>
              <select name="visit_type">
                <option value="general">General</option><option value="emergency">Emergency</option>
                <option value="follow_up">Follow-up</option><option value="routine">Routine</option>
                <option value="specialist">Specialist</option>
              </select></div>
            <div class="sh-form-group"><label>Status</label>
              <select name="status">
                <option value="completed">Completed</option><option value="pending">Pending</option>
                <option value="follow_up">Follow-up</option><option value="referred">Referred</option>
                <option value="discharged">Discharged</option>
              </select></div>
          </div>

          <div class="sh-form-group"><label>Symptoms</label><textarea name="symptoms" rows="2" placeholder="Describe the symptoms..."></textarea></div>
          <div class="sh-form-group"><label>Diagnosis</label><textarea name="diagnosis" rows="2" placeholder="Diagnosis if known..."></textarea></div>
          <div class="sh-form-group"><label>Treatment</label><textarea name="treatment" rows="2" placeholder="Treatment administered..."></textarea></div>

          <div class="sh-form-row">
            <div class="sh-form-group"><label>Doctor/Nurse Name</label><input type="text" name="doctor_name" value="${esc(user.name || '')}" placeholder="Attending physician"></div>
            <div class="sh-form-group"><label>Follow-up Date</label><input type="date" name="follow_up_date" placeholder="If follow-up needed"></div>
          </div>

          <div class="sh-form-group"><label>Additional Notes</label><textarea name="notes" rows="2" placeholder="Additional notes..."></textarea></div>

          <div style="display:flex;gap:10px;margin-top:20px">
            <button type="submit" class="sh-btn sh-btn-primary" style="padding:14px 32px;font-size:15px">💾 Save Visit</button>
            <a href="/student-health/visits" class="sh-btn sh-btn-secondary" style="padding:14px 24px">Cancel</a>
          </div>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Record Clinic Visit', html, user, req));
  }));

  // ============================================================
  // ROUTE 8: POST /student-health/visits/save — Save visit
  // ============================================================
  app.post('/student-health/visits/save', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const {
      student_id, visit_date, visit_type, symptoms, diagnosis, treatment,
      doctor_name, follow_up_date, status, notes
    } = req.body;

    if (!student_id || !visit_date) {
      req.session.flash = { type: 'error', msg: 'Student and visit date are required.' };
      return res.redirect('/student-health/visits/new');
    }

    await pool.query(
      `INSERT INTO health_visits (tenant_id, student_id, visit_date, visit_type, symptoms, diagnosis,
        treatment, doctor_name, follow_up_date, status, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        tid, parseInt(student_id), visit_date, visit_type || 'general',
        symptoms || null, diagnosis || null, treatment || null,
        doctor_name || null, follow_up_date || null, status || 'completed',
        notes || null, user.id
      ]
    );

    // Update last_checkup in student_health if this is a general visit
    if (visit_type === 'general' || visit_type === 'routine') {
      await pool.query(
        `UPDATE student_health SET last_checkup = $1 WHERE tenant_id=$2 AND student_id=$3`,
        [visit_date, tid, parseInt(student_id)]
      );
    }

    req.session.flash = { type: 'success', msg: 'Clinic visit recorded successfully.' };
    res.redirect('/student-health/visits');
  }));

  // ============================================================
  // ROUTE 9: GET /student-health/screenings — List screenings
  // ============================================================
  app.get('/student-health/screenings', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const typeFilter = req.query.type || '';
    const statusFilter = req.query.status || '';

    let sql = `SELECT hs.*,
                (SELECT name FROM students s WHERE s.id = hs.student_id LIMIT 1) AS student_name,
                (SELECT class FROM students s WHERE s.id = hs.student_id LIMIT 1) AS student_class
               FROM health_screenings hs
               WHERE hs.tenant_id=$1`;
    const params = [tid];
    let pi = 2;

    if (typeFilter) { sql += ` AND hs.screening_type=$${pi++}`; params.push(typeFilter); }
    if (statusFilter) { sql += ` AND hs.status=$${pi++}`; params.push(statusFilter); }

    sql += ` ORDER BY hs.screening_date DESC, hs.created_at DESC LIMIT 200`;

    const screenings = (await pool.query(sql, params)).rows;

    // Type counts
    const typeCounts = (await pool.query(
      `SELECT screening_type, COUNT(*)::int AS cnt FROM health_screenings WHERE tenant_id=$1 GROUP BY screening_type`, [tid]
    )).rows;
    const typeMap = {};
    typeCounts.forEach(r => { typeMap[r.screening_type] = r.cnt; });

    // Recent overdue (no screening in 6 months)
    const overdueCount = (await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM student_health sh
       WHERE sh.tenant_id=$1
       AND (sh.last_checkup IS NULL OR sh.last_checkup < CURRENT_DATE - INTERVAL '6 months')`, [tid]
    )).rows[0].cnt;

    const rowsHtml = screenings.map(s => `<tr>
      <td><a href="/student-health/records/${s.student_id}" style="font-weight:600;color:#059669;text-decoration:none">${esc(s.student_name || 'Student #' + s.student_id)}</a></td>
      <td>${esc(s.student_class || '—')}</td>
      <td>${fmtDate(s.screening_date)}</td>
      <td><span class="badge" style="background:#dbeafe;color:#1d4ed8">${esc((s.screening_type || 'general').replace('_',' '))}</span></td>
      <td style="max-width:250px">${esc((s.results || '').substring(0, 150))}</td>
      <td>${statusBadge(s.status)}</td>
      <td style="max-width:150px">${esc((s.notes || '').substring(0, 80))}</td>
    </tr>`).join('');

    const html = SH_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('screenings')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">🔍 Health Screenings</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">${screenings.length} screenings recorded</p></div>
        <div style="display:flex;gap:8px;align-items:center">
          ${overdueCount > 0 ? `<span class="badge badge-error" style="font-size:12px;padding:6px 12px">🔔 ${overdueCount} overdue</span>` : ''}
        </div>
      </div>

      <!-- Type tabs -->
      <div style="display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap">
        <a href="/student-health/screenings" class="sh-btn sh-btn-secondary" style="${!typeFilter ? 'background:#059669;color:#fff' : ''}">All</a>
        ${['general','vision','hearing','dental','bmi','blood_pressure'].map(t => `<a href="/student-health/screenings?type=${t}" class="sh-btn sh-btn-secondary" style="${typeFilter === t ? 'background:#059669;color:#fff' : ''}">${t.replace('_',' ')} (${typeMap[t] || 0})</a>`).join('')}
      </div>

      <!-- Status filter -->
      <div class="sh-filter">
        <div><label>Status</label><select onchange="location.href='/student-health/screenings?type=${esc(typeFilter)}&status='+this.value">
          <option value="">All Statuses</option>
          ${['completed','pending','scheduled','normal','abnormal'].map(s => `<option value="${s}" ${statusFilter === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select></div>
      </div>

      <!-- Save screening form (inline) -->
      <div class="card" style="padding:20px;margin-bottom:16px;border-left:4px solid #059669">
        <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">📝 Record New Screening</h3>
        <form method="POST" action="/student-health/screenings/save" style="display:flex;gap:10px;flex-wrap:wrap;align-items:end">
          <div style="flex:1;min-width:180px"><label style="font-size:11px;color:#64748b;display:block;margin-bottom:4px">Student</label>
            <select name="student_id" required style="width:100%;padding:8px;border:2px solid #e2e8f0;border-radius:8px;font-size:13px">
              <option value="">Select...</option>
              ${(await pool.query(`SELECT id, name, class FROM students WHERE tenant_id=$1 ORDER BY name`, [tid])).rows.map(s =>
                `<option value="${s.id}">${esc(s.name || 'ID ' + s.id)}${s.class ? ' — ' + esc(s.class) : ''}</option>`
              ).join('')}
            </select></div>
          <div style="min-width:140px"><label style="font-size:11px;color:#64748b;display:block;margin-bottom:4px">Date</label>
            <input type="date" name="screening_date" required value="${today()}" style="width:100%;padding:8px;border:2px solid #e2e8f0;border-radius:8px;font-size:13px"></div>
          <div style="min-width:120px"><label style="font-size:11px;color:#64748b;display:block;margin-bottom:4px">Type</label>
            <select name="screening_type" style="width:100%;padding:8px;border:2px solid #e2e8f0;border-radius:8px;font-size:13px">
              <option value="general">General</option><option value="vision">Vision</option>
              <option value="hearing">Hearing</option><option value="dental">Dental</option>
              <option value="bmi">BMI</option><option value="blood_pressure">Blood Pressure</option>
            </select></div>
          <div style="flex:2;min-width:200px"><label style="font-size:11px;color:#64748b;display:block;margin-bottom:4px">Results</label>
            <input type="text" name="results" placeholder="Screening results..." style="width:100%;padding:8px;border:2px solid #e2e8f0;border-radius:8px;font-size:13px"></div>
          <div style="min-width:100px"><label style="font-size:11px;color:#64748b;display:block;margin-bottom:4px">Status</label>
            <select name="status" style="width:100%;padding:8px;border:2px solid #e2e8f0;border-radius:8px;font-size:13px">
              <option value="normal">Normal</option><option value="abnormal">Abnormal</option>
              <option value="completed">Completed</option><option value="pending">Pending</option>
            </select></div>
          <button type="submit" class="sh-btn sh-btn-primary" style="padding:8px 20px">💾 Save</button>
        </form>
      </div>

      <div class="card" style="padding:0;overflow:hidden">
        <div style="overflow-x:auto">
          <table class="sh-table">
            <thead><tr><th>Student</th><th>Class</th><th>Date</th><th>Type</th><th>Results</th><th>Status</th><th>Notes</th></tr></thead>
            <tbody>${rowsHtml || '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:40px">No screenings recorded yet. Use the form above to add one.</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Health Screenings', html, user, req));
  }));

  // ============================================================
  // ROUTE 10: POST /student-health/screenings/save — Save screening
  // ============================================================
  app.post('/student-health/screenings/save', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { student_id, screening_date, screening_type, results, status, notes } = req.body;

    if (!student_id || !screening_date) {
      req.session.flash = { type: 'error', msg: 'Student and screening date are required.' };
      return res.redirect('/student-health/screenings');
    }

    await pool.query(
      `INSERT INTO health_screenings (tenant_id, student_id, screening_date, screening_type, results, status, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [tid, parseInt(student_id), screening_date, screening_type || 'general',
       results || null, status || 'completed', notes || null, user.id]
    );

    // If BMI screening and results contain height/weight, update student_health
    if (screening_type === 'bmi' && results) {
      const bmiMatch = results.match(/height[:\s]*([\d.]+).*weight[:\s]*([\d.]+)/i);
      if (bmiMatch) {
        await pool.query(
          `UPDATE student_health SET height=$1, weight=$2 WHERE tenant_id=$3 AND student_id=$4`,
          [parseFloat(bmiMatch[1]), parseFloat(bmiMatch[2]), tid, parseInt(student_id)]
        );
      }
    }

    // Update last_checkup
    if (screening_type === 'general') {
      await pool.query(
        `UPDATE student_health SET last_checkup = $1 WHERE tenant_id=$2 AND student_id=$3`,
        [screening_date, tid, parseInt(student_id)]
      );
    }

    req.session.flash = { type: 'success', msg: 'Screening recorded successfully.' };
    res.redirect('/student-health/screenings');
  }));

  // ============================================================
  // ROUTE 11: GET /student-health/reports — Health reports
  // ============================================================
  app.get('/student-health/reports', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    // ===== 1. BMI Distribution =====
    const bmiRows = (await pool.query(
      `SELECT height, weight FROM student_health WHERE tenant_id=$1 AND height IS NOT NULL AND height > 0 AND weight IS NOT NULL AND weight > 0`, [tid]
    )).rows;
    let bmiUnder = 0, bmiNormal = 0, bmiOver = 0, bmiObese = 0;
    bmiRows.forEach(r => {
      const bmi = calcBMI(r.height, r.weight);
      if (!bmi) return;
      if (bmi < 18.5) bmiUnder++;
      else if (bmi < 25) bmiNormal++;
      else if (bmi < 30) bmiOver++;
      else bmiObese++;
    });
    const bmiTotal = bmiRows.length;

    const bmiChartBar = (count, total, color, label) => {
      const pct = total > 0 ? Math.round(count / total * 100) : 0;
      return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
        <span style="font-size:12px;color:#475569;min-width:90px;font-weight:600">${label}</span>
        <div style="flex:1;background:#f1f5f9;border-radius:8px;height:24px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:${color};border-radius:8px;display:flex;align-items:center;justify-content:center">
            <span style="font-size:12px;font-weight:700;color:#fff">${count} (${pct}%)</span>
          </div>
        </div>
      </div>`;
    };

    // ===== 2. Allergy Prevalence =====
    const allergyData = (await pool.query(
      `SELECT allergies, allergies_list FROM student_health WHERE tenant_id=$1
       AND (allergies IS NOT NULL AND allergies <> ''
            OR allergies_list IS NOT NULL AND allergies_list::text <> '[]' AND allergies_list::text <> 'null')`, [tid]
    )).rows;

    const allergyCounts = {};
    allergyData.forEach(r => {
      if (r.allergies_list && Array.isArray(r.allergies_list)) {
        r.allergies_list.forEach(a => {
          const name = (a.name || a.allergen || '').trim().toLowerCase();
          if (name) allergyCounts[name] = (allergyCounts[name] || 0) + 1;
        });
      }
      if (r.allergies && r.allergies.trim()) {
        r.allergies.split(/[,;\/\n]/).map(s => s.trim().toLowerCase()).filter(Boolean).forEach(a => {
          allergyCounts[a] = (allergyCounts[a] || 0) + 1;
        });
      }
    });
    const topAllergies = Object.entries(allergyCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const maxAllergyCount = topAllergies.length > 0 ? topAllergies[0][1] : 1;

    // ===== 3. Visit Frequency by Class =====
    const visitByClass = (await pool.query(
      `SELECT (SELECT class FROM students s WHERE s.id = hv.student_id LIMIT 1) AS class_name,
              COUNT(*)::int AS visit_count
       FROM health_visits hv
       WHERE hv.tenant_id=$1 AND hv.visit_date >= date_trunc('year', CURRENT_DATE)
       GROUP BY class_name
       ORDER BY visit_count DESC`, [tid]
    )).rows;
    const maxVisitCount = visitByClass.length > 0 ? visitByClass[0].visit_count : 1;

    // ===== 4. Visit Trends (monthly) =====
    const visitTrends = (await pool.query(
      `SELECT TO_CHAR(visit_date, 'YYYY-MM') AS month, COUNT(*)::int AS cnt
       FROM health_visits
       WHERE tenant_id=$1 AND visit_date >= CURRENT_DATE - INTERVAL '12 months'
       GROUP BY TO_CHAR(visit_date, 'YYYY-MM')
       ORDER BY month`, [tid]
    )).rows;
    const maxTrendCount = visitTrends.length > 0 ? Math.max(...visitTrends.map(r => r.cnt)) : 1;

    // ===== 5. Overdue Screenings by Screening Type =====
    const screeningByType = (await pool.query(
      `SELECT screening_type, COUNT(*)::int AS cnt,
              COUNT(*) FILTER (WHERE status = 'normal')::int AS normal_cnt,
              COUNT(*) FILTER (WHERE status = 'abnormal')::int AS abnormal_cnt
       FROM health_screenings
       WHERE tenant_id=$1
       GROUP BY screening_type
       ORDER BY screening_type`, [tid]
    )).rows;

    // ===== 6. Blood Group Distribution =====
    const bloodDist = (await pool.query(
      `SELECT blood_group, COUNT(*)::int AS cnt
       FROM student_health WHERE tenant_id=$1 AND blood_group IS NOT NULL AND blood_group <> ''
       GROUP BY blood_group ORDER BY cnt DESC`, [tid]
    )).rows;

    // ===== 7. Top visit types =====
    const visitTypes = (await pool.query(
      `SELECT visit_type, COUNT(*)::int AS cnt
       FROM health_visits WHERE tenant_id=$1
       GROUP BY visit_type ORDER BY cnt DESC`, [tid]
    )).rows;

    // ===== 8. Overdue Students for screening detail =====
    const overdueStudentsReport = (await pool.query(
      `SELECT sh.student_id, sh.last_checkup,
              (SELECT name FROM students s WHERE s.id = sh.student_id LIMIT 1) AS student_name,
              (SELECT class FROM students s WHERE s.id = sh.student_id LIMIT 1) AS student_class
       FROM student_health sh
       WHERE sh.tenant_id=$1
       AND (sh.last_checkup IS NULL OR sh.last_checkup < CURRENT_DATE - INTERVAL '6 months')
       ORDER BY COALESCE(sh.last_checkup, '1970-01-01') ASC
       LIMIT 20`, [tid]
    )).rows;

    // ===== Build HTML =====
    const html = SH_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('reports')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">📊 Health Reports</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Comprehensive health analytics and insights</p></div>
      </div>

      <!-- Summary Stats -->
      <div class="stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-bottom:24px">
        <div class="stat-card"><div class="stat-num" style="color:#059669">${bmiTotal}</div><div class="muted" style="font-size:11px">Students with BMI Data</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${allergyData.length}</div><div class="muted" style="font-size:11px">Students with Allergies</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#0d9488">${visitByClass.reduce((s, r) => s + r.visit_count, 0)}</div><div class="muted" style="font-size:11px">Visits This Year</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#8b5cf6">${visitByClass.length}</div><div class="muted" style="font-size:11px">Active Classes</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#dc2626">${topAllergies.length}</div><div class="muted" style="font-size:11px">Unique Allergens</div></div>
      </div>

      <!-- BMI Distribution -->
      <div class="card" style="padding:24px;margin-bottom:20px">
        <h3 style="font-size:16px;color:#1e293b;margin:0 0 16px">📊 BMI Distribution</h3>
        ${bmiTotal > 0
          ? bmiChartBar(bmiUnder, bmiTotal, '#3b82f6', 'Underweight (<18.5)')
            + bmiChartBar(bmiNormal, bmiTotal, '#16a34a', 'Normal (18.5-24.9)')
            + bmiChartBar(bmiOver, bmiTotal, '#f59e0b', 'Overweight (25-29.9)')
            + bmiChartBar(bmiObese, bmiTotal, '#dc2626', 'Obese (30+)')
            + `<div style="margin-top:8px;font-size:12px;color:#64748b">Based on ${bmiTotal} students with height and weight data</div>`
          : '<p style="color:#94a3b8;text-align:center;padding:20px">No BMI data available</p>'}
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px">
        <!-- Allergy Prevalence -->
        <div class="card" style="padding:24px">
          <h3 style="font-size:16px;color:#1e293b;margin:0 0 16px">⚠️ Top Allergies</h3>
          ${topAllergies.length > 0 ? topAllergies.map(([name, count]) => {
            const pct = Math.round((count / maxAllergyCount) * 100);
            return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
              <span style="font-size:12px;color:#475569;min-width:120px;font-weight:500;text-transform:capitalize">${esc(name)}</span>
              <div style="flex:1;background:#fef3c7;border-radius:6px;height:20px;overflow:hidden">
                <div style="height:100%;width:${pct}%;background:#f59e0b;border-radius:6px"></div>
              </div>
              <span style="font-size:12px;font-weight:700;color:#92400e">${count}</span>
            </div>`;
          }).join('') : '<p style="color:#94a3b8;text-align:center;padding:20px">No allergy data</p>'}
        </div>

        <!-- Visit Frequency by Class -->
        <div class="card" style="padding:24px">
          <h3 style="font-size:16px;color:#1e293b;margin:0 0 16px">🩺 Visits by Class (This Year)</h3>
          ${visitByClass.length > 0 ? visitByClass.map(r => {
            const pct = Math.round((r.visit_count / maxVisitCount) * 100);
            return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
              <span style="font-size:12px;color:#475569;min-width:100px;font-weight:600">${esc(r.class_name || 'Unknown')}</span>
              <div style="flex:1;background:#d1fae5;border-radius:6px;height:20px;overflow:hidden">
                <div style="height:100%;width:${pct}%;background:#059669;border-radius:6px"></div>
              </div>
              <span style="font-size:12px;font-weight:700;color:#065f46">${r.visit_count}</span>
            </div>`;
          }).join('') : '<p style="color:#94a3b8;text-align:center;padding:20px">No visit data for this year</p>'}
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px">
        <!-- Monthly Visit Trends -->
        <div class="card" style="padding:24px">
          <h3 style="font-size:16px;color:#1e293b;margin:0 0 16px">📈 Monthly Visit Trends (12 months)</h3>
          <div style="display:flex;align-items:flex-end;gap:6px;height:150px;padding-top:10px">
            ${visitTrends.map(r => {
              const pct = Math.round((r.cnt / maxTrendCount) * 100);
              return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px">
                <span style="font-size:10px;font-weight:700;color:#1e293b">${r.cnt}</span>
                <div style="width:100%;background:#059669;border-radius:4px 4px 0 0;height:${Math.max(pct, 4)}%;min-height:4px;transition:.3s"></div>
                <span style="font-size:9px;color:#94a3b8;writing-mode:vertical-rl">${r.month}</span>
              </div>`;
            }).join('') || '<span style="color:#94a3b8;font-size:13px;margin:auto">No data available</span>'}
          </div>
        </div>

        <!-- Screening Results by Type -->
        <div class="card" style="padding:24px">
          <h3 style="font-size:16px;color:#1e293b;margin:0 0 16px">🔍 Screening Results by Type</h3>
          ${screeningByType.length > 0 ? `<table class="sh-table">
            <thead><tr><th>Type</th><th>Total</th><th>Normal</th><th>Abnormal</th><th>Rate</th></tr></thead>
            <tbody>${screeningByType.map(s => {
              const normalPct = s.cnt > 0 ? Math.round(s.normal_cnt / s.cnt * 100) : 0;
              return `<tr>
                <td><span class="badge" style="background:#dbeafe;color:#1d4ed8">${esc((s.screening_type || 'general').replace('_',' '))}</span></td>
                <td><strong>${s.cnt}</strong></td>
                <td style="color:#16a34a;font-weight:600">${s.normal_cnt}</td>
                <td style="color:#dc2626;font-weight:600">${s.abnormal_cnt}</td>
                <td>
                  <div style="display:flex;align-items:center;gap:6px">
                    <div style="flex:1;background:#f1f5f9;border-radius:4px;height:8px;overflow:hidden">
                      <div style="height:100%;width:${normalPct}%;background:#16a34a;border-radius:4px"></div>
                    </div>
                    <span style="font-size:11px;font-weight:600;color:#64748b">${normalPct}%</span>
                  </div>
                </td>
              </tr>`;
            }).join('')}</tbody>
          </table>` : '<p style="color:#94a3b8;text-align:center;padding:20px">No screening data</p>'}
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px">
        <!-- Blood Group Distribution -->
        <div class="card" style="padding:24px">
          <h3 style="font-size:16px;color:#1e293b;margin:0 0 16px">🩸 Blood Group Distribution</h3>
          ${bloodDist.length > 0 ? `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">
            ${bloodDist.map(b => `<div style="text-align:center;padding:12px;border-radius:10px;background:#fef2f2">
              <div style="font-size:20px;font-weight:800;color:#dc2626">${esc(b.blood_group)}</div>
              <div style="font-size:12px;color:#64748b">${b.cnt} student${b.cnt !== 1 ? 's' : ''}</div>
            </div>`).join('')}
          </div>` : '<p style="color:#94a3b8;text-align:center;padding:20px">No blood group data</p>'}
        </div>

        <!-- Visit Types Breakdown -->
        <div class="card" style="padding:24px">
          <h3 style="font-size:16px;color:#1e293b;margin:0 0 16px">🩺 Visit Types Breakdown</h3>
          ${visitTypes.length > 0 ? visitTypes.map(vt => {
            const totalVisits = visitTypes.reduce((s, v) => s + v.cnt, 0);
            const pct = Math.round((vt.cnt / totalVisits) * 100);
            return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
              <span style="font-size:12px;color:#475569;min-width:90px;font-weight:500;text-transform:capitalize">${esc((vt.visit_type || 'general').replace('_',' '))}</span>
              <div style="flex:1;background:#e0e7ff;border-radius:6px;height:20px;overflow:hidden">
                <div style="height:100%;width:${pct}%;background:#6366f1;border-radius:6px"></div>
              </div>
              <span style="font-size:12px;font-weight:700;color:#4338ca">${vt.cnt} (${pct}%)</span>
            </div>`;
          }).join('') : '<p style="color:#94a3b8;text-align:center;padding:20px">No visit type data</p>'}
        </div>
      </div>

      <!-- Overdue Screenings Detail -->
      <div class="card" style="padding:24px">
        <h3 style="font-size:16px;color:#1e293b;margin:0 0 16px">🔔 Students Needing Screening</h3>
        ${overdueStudentsReport.length > 0
          ? `<table class="sh-table"><thead><tr><th>Student</th><th>Class</th><th>Last Checkup</th><th>Overdue By</th><th>Action</th></tr></thead>
             <tbody>${overdueStudentsReport.map(o => {
               const overdueMonths = o.last_checkup
                 ? Math.floor((new Date() - new Date(o.last_checkup)) / (1000 * 60 * 60 * 24 * 30))
                 : 'Never';
               return `<tr style="background:#fffbeb">
                 <td><strong>${esc(o.student_name || 'Student #' + o.student_id)}</strong></td>
                 <td>${esc(o.student_class || '—')}</td>
                 <td>${o.last_checkup ? fmtDate(o.last_checkup) : '<span style="color:#dc2626;font-weight:600">Never screened</span>'}</td>
                 <td><span class="badge badge-error">${o.last_checkup ? overdueMonths + ' months' : 'N/A'}</span></td>
                 <td><a href="/student-health/visits/new?student_id=${o.student_id}" class="sh-btn sh-btn-primary" style="padding:4px 12px;font-size:11px">Schedule</a></td>
               </tr>`;
             }).join('')}</tbody></table>`
          : '<p style="text-align:center;color:#94a3b8;padding:20px">✅ All students are up to date with screenings!</p>'}
      </div>
    </div>`;
    res.send(renderPage('Health Reports', html, user, req));
  }));

};
