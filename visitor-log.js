// ============================================================
// VISITOR MANAGEMENT MODULE — Multi-Tenant SaaS Platform
// Check-in/out, pre-registration, analytics, history, API.
// ============================================================
// Usage in server.js:
//   const visitorLog = require('./visitor-log');
//   visitorLog(app, db, pool, renderPage, esc);
// ============================================================

'use strict';

// ============================================================
// INTERNAL HELPERS
// ============================================================
const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
const formatTime = (d) => d ? new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
const formatDateTime = (d) => d ? formatDate(d) + ' ' + formatTime(d) : '-';

function statusBadge(status) {
  const map = {
    checked_in:  { bg: '#dcfce7', c: '#16a34a', l: '🟢 Checked In' },
    checked_out: { bg: '#dcfce7', c: '#16a34a', l: '✅ Checked Out', cls: 'badge badge-success' },
    expected:    { bg: '#dbeafe', c: '#2563eb', l: '🔵 Expected' },
    pending:     { bg: '#fef9c3', c: '#a16207', l: '🟡 Pending', cls: 'badge badge-warning' },
    cancelled:   { bg: '#fee2e2', c: '#dc2626', l: '🔴 Cancelled' }
  };
  const s = map[status] || { bg: '#f1f5f9', c: '#64748b', l: status };
  return `<span class="${s.cls || 'badge'}" style="background:${s.bg};color:${s.c}">${s.l}</span>`;
}

function preRegBadge(status) {
  const map = {
    pending:  { bg: '#fef9c3', c: '#a16207', l: '⏳ Pending' },
    approved: { bg: '#dcfce7', c: '#16a34a', l: '✅ Approved', cls: 'badge badge-success' },
    rejected: { bg: '#fee2e2', c: '#dc2626', l: '❌ Rejected' },
    visited:  { bg: '#e0e7ff', c: '#4f46e5', l: '👤 Visited' }
  };
  const s = map[status] || { bg: '#f1f5f9', c: '#64748b', l: status };
  return `<span class="${s.cls || 'badge'}" style="background:${s.bg};color:${s.c}">${s.l}</span>`;
}

function purposeColor(purpose) {
  const map = {
    meeting: '#4f46e5', interview: '#7c3aed', delivery: '#ea580c',
    maintenance: '#0891b2', personal: '#db2777', contractor: '#ca8a04', other: '#64748b'
  };
  return map[purpose] || map.other;
}

function purposeDot(purpose) {
  return `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${purposeColor(purpose)};margin-right:6px;vertical-align:middle"></span>`;
}

function frequencyBar(count) {
  const max = 10, pct = Math.min(100, (count / max) * 100);
  const color = count >= 8 ? '#dc2626' : count >= 5 ? '#f59e0b' : count >= 3 ? '#3b82f6' : '#22c55e';
  return `<div style="display:flex;align-items:center;gap:8px">
    <div style="background:#e2e8f0;border-radius:10px;height:8px;width:80px;overflow:hidden">
      <div style="background:${color};height:100%;border-radius:10px;width:${pct}%"></div>
    </div>
    <span style="font-size:12px;font-weight:700;color:${color}">${count}x</span>
  </div>`;
}

function durationLabel(checkIn, checkOut) {
  if (!checkIn) return '-';
  const end = checkOut ? new Date(checkOut) : new Date();
  const ms = end - new Date(checkIn);
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return `${h}h ${m}m`;
}

// Shared CSS
const VL_CSS = `<style>
.vl-nav{display:flex;gap:6px;margin-bottom:20px;flex-wrap:wrap}
.vl-nav a{padding:8px 16px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#475569;background:#f1f5f9;transition:.15s}
.vl-nav a:hover{background:#e2e8f0}.vl-nav a.active{background:#4f46e5;color:#fff}
.vl-table{width:100%;border-collapse:collapse;font-size:13px}
.vl-table th{padding:10px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#f8fafc}
.vl-table td{padding:9px 14px;border-bottom:1px solid #f1f5f9;color:#1e293b}
.vl-table tr:hover{background:#f8fafc}
.vl-table tr.active-visitor{background:#f0fdf4;border-left:3px solid #22c55e}
.vl-filter{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:end}
.vl-filter label{display:block;font-size:12px;font-weight:600;color:#64748b;margin-bottom:4px}
.vl-filter input,.vl-filter select{padding:8px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px;background:#fff}
.vl-filter input:focus,.vl-filter select:focus{outline:none;border-color:#6366f1}
.vl-form label{display:block;font-size:13px;font-weight:600;color:#475569;margin-bottom:4px}
.vl-form input,.vl-form select,.vl-form textarea{width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;box-sizing:border-box}
.vl-form input:focus,.vl-form select:focus,.vl-form textarea:focus{outline:none;border-color:#6366f1}
.vl-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.vl-peak-bar{display:flex;align-items:center;gap:8px;margin-bottom:4px}
.vl-peak-label{font-size:12px;color:#64748b;width:70px;text-align:right;flex-shrink:0}
.vl-peak-fill{height:24px;border-radius:6px;background:linear-gradient(90deg,#4f46e5,#7c3aed);color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;padding:0 8px;min-width:20px;transition:.2s}
@media(max-width:768px){.vl-grid{grid-template-columns:1fr}}
</style>`;

// ============================================================
// MODULE ENTRY POINT
// ============================================================
module.exports = function visitorLog(app, db, pool, renderPage, esc) {

  if (!esc) esc = (s) => String(s === null || s === undefined ? '' : (typeof s === 'object' ? JSON.stringify(s) : s)).replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
  const requireAuth = (req, res, next) => { if (!req.session || !req.session.user) return res.redirect('/login'); next(); };
  const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  // ============================================================
  // DATABASE MIGRATIONS
  // ============================================================
  const migrations = [
    `CREATE TABLE IF NOT EXISTS visitors (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      full_name VARCHAR(255) NOT NULL, email VARCHAR(255), phone VARCHAR(20),
      company VARCHAR(255), purpose VARCHAR(255) NOT NULL, purpose_details TEXT,
      host_name VARCHAR(255), host_department VARCHAR(100),
      id_type VARCHAR(50), id_number VARCHAR(100),
      vehicle_plate VARCHAR(20), check_in_time TIMESTAMPTZ,
      check_out_time TIMESTAMPTZ, status VARCHAR(20) DEFAULT 'checked_in',
      badge_number VARCHAR(50), photo_url TEXT, notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS pre_registrations (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      visitor_name VARCHAR(255) NOT NULL, email VARCHAR(255), phone VARCHAR(20),
      company VARCHAR(255), purpose VARCHAR(255), host_name VARCHAR(255),
      expected_date DATE, expected_time TIME, status VARCHAR(20) DEFAULT 'pending',
      created_by INTEGER, created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    // ALTER TABLE visitors
    `ALTER TABLE IF EXISTS visitors ADD COLUMN IF NOT EXISTS full_name VARCHAR(255) NOT NULL DEFAULT ''`,
    `ALTER TABLE IF EXISTS visitors ADD COLUMN IF NOT EXISTS email VARCHAR(255)`,
    `ALTER TABLE IF EXISTS visitors ADD COLUMN IF NOT EXISTS phone VARCHAR(20)`,
    `ALTER TABLE IF EXISTS visitors ADD COLUMN IF NOT EXISTS company VARCHAR(255)`,
    `ALTER TABLE IF EXISTS visitors ADD COLUMN IF NOT EXISTS purpose VARCHAR(255) NOT NULL DEFAULT ''`,
    `ALTER TABLE IF EXISTS visitors ADD COLUMN IF NOT EXISTS purpose_details TEXT`,
    `ALTER TABLE IF EXISTS visitors ADD COLUMN IF NOT EXISTS host_name VARCHAR(255)`,
    `ALTER TABLE IF EXISTS visitors ADD COLUMN IF NOT EXISTS host_department VARCHAR(100)`,
    `ALTER TABLE IF EXISTS visitors ADD COLUMN IF NOT EXISTS id_type VARCHAR(50)`,
    `ALTER TABLE IF EXISTS visitors ADD COLUMN IF NOT EXISTS id_number VARCHAR(100)`,
    `ALTER TABLE IF EXISTS visitors ADD COLUMN IF NOT EXISTS vehicle_plate VARCHAR(20)`,
    `ALTER TABLE IF EXISTS visitors ADD COLUMN IF NOT EXISTS check_in_time TIMESTAMPTZ`,
    `ALTER TABLE IF EXISTS visitors ADD COLUMN IF NOT EXISTS check_out_time TIMESTAMPTZ`,
    `ALTER TABLE IF EXISTS visitors ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'checked_in'`,
    `ALTER TABLE IF EXISTS visitors ADD COLUMN IF NOT EXISTS badge_number VARCHAR(50)`,
    `ALTER TABLE IF EXISTS visitors ADD COLUMN IF NOT EXISTS photo_url TEXT`,
    `ALTER TABLE IF EXISTS visitors ADD COLUMN IF NOT EXISTS notes TEXT`,
    // ALTER TABLE pre_registrations
    `ALTER TABLE IF EXISTS pre_registrations ADD COLUMN IF NOT EXISTS visitor_name VARCHAR(255) NOT NULL DEFAULT ''`,
    `ALTER TABLE IF EXISTS pre_registrations ADD COLUMN IF NOT EXISTS email VARCHAR(255)`,
    `ALTER TABLE IF EXISTS pre_registrations ADD COLUMN IF NOT EXISTS phone VARCHAR(20)`,
    `ALTER TABLE IF EXISTS pre_registrations ADD COLUMN IF NOT EXISTS company VARCHAR(255)`,
    `ALTER TABLE IF EXISTS pre_registrations ADD COLUMN IF NOT EXISTS purpose VARCHAR(255)`,
    `ALTER TABLE IF EXISTS pre_registrations ADD COLUMN IF NOT EXISTS host_name VARCHAR(255)`,
    `ALTER TABLE IF EXISTS pre_registrations ADD COLUMN IF NOT EXISTS expected_date DATE`,
    `ALTER TABLE IF EXISTS pre_registrations ADD COLUMN IF NOT EXISTS expected_time TIME`,
    `ALTER TABLE IF EXISTS pre_registrations ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'pending'`,
    `ALTER TABLE IF EXISTS pre_registrations ADD COLUMN IF NOT EXISTS created_by INTEGER`,
    // Indexes
    `CREATE INDEX IF NOT EXISTS idx_visitors_tenant ON visitors(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_visitors_status ON visitors(tenant_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_visitors_checkin ON visitors(tenant_id, check_in_time)`,
    `CREATE INDEX IF NOT EXISTS idx_prereg_tenant ON pre_registrations(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_prereg_status ON pre_registrations(tenant_id, status)`
  ];

  (async () => {
    const client = await pool.connect().catch(() => null);
    if (!client) { console.warn('[Visitors] Cannot connect to DB'); return; }
    try { for (const sql of migrations) await client.query(sql); console.log('[Visitors] Migrations applied'); }
    catch (e) { console.error('[Visitors] Migration error:', e.message); }
    finally { client.release(); }
  })();

  // ============================================================
  // NAV HELPER
  // ============================================================
  const nav = (active) => `<div class="vl-nav">
    <a href="/visitors" class="${active==='dash'?'active':''}">📋 Dashboard</a>
    <a href="/visitors/check-in" class="${active==='checkin'?'active':''}">📥 Check-In</a>
    <a href="/visitors/pre-register" class="${active==='prereg'?'active':''}">📝 Pre-Register</a>
    <a href="/visitors/pre-registrations" class="${active==='preregs'?'active':''}">📋 Pre-Registrations</a>
    <a href="/visitors/history" class="${active==='history'?'active':''}">📜 History</a>
    <a href="/visitors/report" class="${active==='report'?'active':''}">📊 Reports</a>
  </div>`;

  // ============================================================
  // ROUTE 1: GET /visitors — Dashboard
  // ============================================================
  app.get('/visitors', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { status, search } = req.query;

    const nowIn = (await pool.query(`SELECT COUNT(*)::int as cnt FROM visitors WHERE tenant_id=$1 AND status='checked_in'`, [tid])).rows[0].cnt;
    const todayTotal = (await pool.query(`SELECT COUNT(*)::int as cnt FROM visitors WHERE tenant_id=$1 AND check_in_time >= CURRENT_DATE`, [tid])).rows[0].cnt;
    const weekTotal = (await pool.query(`SELECT COUNT(*)::int as cnt FROM visitors WHERE tenant_id=$1 AND check_in_time >= date_trunc('week', NOW())`, [tid])).rows[0].cnt;
    const pendingPre = (await pool.query(`SELECT COUNT(*)::int as cnt FROM pre_registrations WHERE tenant_id=$1 AND status='pending' AND expected_date >= CURRENT_DATE`, [tid])).rows[0].cnt;

    let where = ['tenant_id=$1'], params = [tid], pi = 2;
    if (status) { where.push(`status=$${pi++}`); params.push(status); }
    if (search) { where.push(`(full_name ILIKE $${pi} OR email ILIKE $${pi} OR company ILIKE $${pi})`); params.push('%' + search + '%'); pi++; }

    const visitors = (await pool.query(
      `SELECT * FROM visitors WHERE ${where.join(' AND ')} ORDER BY check_in_time DESC NULLS LAST, created_at DESC LIMIT 100`, params
    )).rows;

    const rows = visitors.map(v => `<tr class="${v.status === 'checked_in' ? 'active-visitor' : ''}">
      <td><a href="/visitors/${v.id}" style="color:#4f46e5;text-decoration:none;font-weight:600">${esc(v.full_name)}</a></td>
      <td>${esc(v.company || '-')}</td>
      <td>${purposeDot(v.purpose)}<span style="font-size:12px">${esc(v.purpose)}</span></td>
      <td>${esc(v.host_name || '-')}</td>
      <td>${statusBadge(v.status)}</td>
      <td style="font-size:12px">${formatDateTime(v.check_in_time)}</td>
      <td style="font-size:12px">${v.status === 'checked_in' ? durationLabel(v.check_in_time) : formatTime(v.check_out_time)}</td>
      <td>
        <div style="display:flex;gap:4px">
          ${v.status === 'checked_in' ? `<form method="POST" action="/visitors/${v.id}/check-out" style="display:inline"><button class="btn btn-sm btn-red" type="submit">Check Out</button></form>` : ''}
          ${v.status === 'checked_out' ? `<form method="POST" action="/visitors/${v.id}/badge" style="display:inline"><button class="btn btn-sm btn-gold" type="submit">🏷 Badge</button></form>` : ''}
          <a href="/visitors/${v.id}" class="btn btn-sm btn-blue">View</a>
        </div>
      </td>
    </tr>`).join('');

    const html = VL_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('dash')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">🚪 Visitor Management</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Track visitors, manage check-ins, and monitor building access</p></div>
        <div style="display:flex;gap:8px">
          <a href="/visitors/check-in" class="btn btn-green">📥 Quick Check-In</a>
          <a href="/visitors/pre-register" class="btn btn-blue">📝 Pre-Register</a>
        </div>
      </div>
      <div class="stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-bottom:20px">
        <div class="stat-card"><div class="stat-num" style="color:#22c55e">${nowIn}</div><div class="muted">Currently In</div></div>
        <div class="stat-card"><div class="stat-num">${todayTotal}</div><div class="muted">Today Total</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#3b82f6">${weekTotal}</div><div class="muted">This Week</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${pendingPre}</div><div class="muted">Pending Pre-Reg</div></div>
      </div>
      <div class="vl-filter">
        <div><label>Status</label><select onchange="location.href='/visitors?status='+this.value"><option value="">All</option>
          <option value="checked_in" ${status==='checked_in'?'selected':''}>Checked In</option>
          <option value="checked_out" ${status==='checked_out'?'selected':''}>Checked Out</option></select></div>
        <div><label>Search</label><form method="GET" style="display:flex;gap:6px"><input type="text" name="search" value="${esc(search||'')}" placeholder="Name, email, company..." style="width:220px"><button class="btn btn-sm" type="submit">🔍</button></form></div>
      </div>
      <div class="card"><div style="overflow-x:auto"><table class="table vl-table">
        <thead><tr><th>Visitor</th><th>Company</th><th>Purpose</th><th>Host</th><th>Status</th><th>Check-In</th><th>Duration</th><th>Actions</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="8" style="text-align:center;color:#94a3b8;padding:40px">No visitors found. Use Quick Check-In to register a visitor.</td></tr>'}</tbody>
      </table></div></div>
    </div>`;
    res.send(renderPage('Visitor Management', html, user, req));
  }));

  // ============================================================
  // ROUTE 2: GET /visitors/check-in — Check-In Form
  // ============================================================
  app.get('/visitors/check-in', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const pendingPre = (await pool.query(
      `SELECT * FROM pre_registrations WHERE tenant_id=$1 AND status='pending' AND expected_date <= CURRENT_DATE ORDER BY expected_time LIMIT 20`, [tid]
    )).rows;

    const preRegOptions = pendingPre.map(p => `<option value="${p.id}">${esc(p.visitor_name)} — ${esc(p.company || 'No company')} — ${formatDate(p.expected_date)}</option>`).join('');
    const successMsg = req.query.success ? `<div class="alert" style="background:#dcfce7;color:#16a34a;padding:12px 16px;border-radius:10px;margin-bottom:16px;font-size:13px;font-weight:600">✅ ${esc(req.query.success)}</div>` : '';

    const html = VL_CSS + `<div style="max-width:800px;margin:0 auto">
      ${nav('checkin')}
      <a href="/visitors" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Dashboard</a>
      ${successMsg}
      <div class="card" style="padding:24px">
        <h2 style="margin:0 0 4px;color:#1e293b">📥 Quick Check-In</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Register a new visitor or check in a pre-registered one</p>
        ${pendingPre.length ? `<div style="background:#eef2ff;border:1px solid #c7d2fe;border-radius:10px;padding:14px;margin-bottom:20px">
          <div style="font-size:13px;font-weight:700;color:#4338ca;margin-bottom:8px">📋 Pending Pre-Registrations</div>
          <select id="preRegSelect" onchange="fillFromPreReg()" style="width:100%;padding:8px 12px;border:2px solid #c7d2fe;border-radius:8px;font-size:13px;background:#fff">
            <option value="">— Select to auto-fill form —</option>${preRegOptions}
          </select>
        </div>` : ''}
        <form method="POST" action="/visitors/check-in" class="vl-form" style="display:flex;flex-direction:column;gap:16px">
          <div class="vl-grid">
            <div><label>Full Name *</label><input type="text" name="full_name" id="ci_name" required placeholder="Visitor full name"></div>
            <div><label>Email</label><input type="email" name="email" id="ci_email" placeholder="visitor@email.com"></div>
          </div>
          <div class="vl-grid">
            <div><label>Phone</label><input type="tel" name="phone" id="ci_phone" placeholder="+1 234 567 890"></div>
            <div><label>Company</label><input type="text" name="company" id="ci_company" placeholder="Company name"></div>
          </div>
          <div class="vl-grid">
            <div><label>Purpose *</label><select name="purpose" required>
              <option value="meeting">Meeting</option><option value="interview">Interview</option>
              <option value="delivery">Delivery</option><option value="maintenance">Maintenance</option>
              <option value="contractor">Contractor</option><option value="personal">Personal</option>
              <option value="other">Other</option></select></div>
            <div><label>Host Name</label><input type="text" name="host_name" id="ci_host" placeholder="Person being visited"></div>
          </div>
          <div><label>Host Department</label><input type="text" name="host_department" placeholder="Department (optional)"></div>
          <div class="vl-grid">
            <div><label>ID Type</label><select name="id_type"><option value="">— Select —</option><option value="national_id">National ID</option><option value="passport">Passport</option><option value="drivers_license">Driver's License</option><option value="business_card">Business Card</option><option value="other">Other</option></select></div>
            <div><label>ID Number</label><input type="text" name="id_number" placeholder="ID number"></div>
          </div>
          <div class="vl-grid">
            <div><label>Vehicle Plate</label><input type="text" name="vehicle_plate" placeholder="License plate (optional)"></div>
            <div><label>Badge Number</label><input type="text" name="badge_number" placeholder="Visitor badge #"></div>
          </div>
          <div><label>Purpose Details / Notes</label><textarea name="notes" rows="3" placeholder="Additional notes..."></textarea></div>
          <div style="display:flex;gap:10px;margin-top:8px">
            <button type="submit" class="btn btn-green" style="padding:12px 28px">✅ Check In Visitor</button>
            <a href="/visitors" class="btn btn-sm" style="padding:12px 28px">Cancel</a>
          </div>
        </form>
      </div>
      <script>
      const preRegData = ${JSON.stringify(pendingPre.map(p => ({ id: p.id, name: p.visitor_name, email: p.email, phone: p.phone, company: p.company, host: p.host_name, purpose: p.purpose })))};
      function fillFromPreReg() {
        const sel = document.getElementById('preRegSelect');
        const d = preRegData.find(p => p.id === parseInt(sel.value));
        if (d) {
          document.getElementById('ci_name').value = d.name || '';
          document.getElementById('ci_email').value = d.email || '';
          document.getElementById('ci_phone').value = d.phone || '';
          document.getElementById('ci_company').value = d.company || '';
          document.getElementById('ci_host').value = d.host || '';
          if (d.purpose) document.querySelector('select[name=purpose]').value = d.purpose;
        }
      }
      </script>
    </div>`;
    res.send(renderPage('Visitor Check-In', html, user, req));
  }));

  // ============================================================
  // ROUTE 3: POST /visitors/check-in — Process Check-In
  // ============================================================
  app.post('/visitors/check-in', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { full_name, email, phone, company, purpose, purpose_details, host_name, host_department, id_type, id_number, vehicle_plate, badge_number, notes } = req.body;
    if (!full_name || !full_name.trim() || !purpose) return res.redirect('/visitors/check-in');
    const result = await pool.query(
      `INSERT INTO visitors (tenant_id, full_name, email, phone, company, purpose, purpose_details, host_name, host_department, id_type, id_number, vehicle_plate, check_in_time, status, badge_number, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW(),'checked_in',$13,$14)`,
      [tid, full_name.trim(), (email || '').trim() || null, (phone || '').trim() || null, (company || '').trim() || null,
       purpose, (purpose_details || '').trim() || null, (host_name || '').trim() || null, (host_department || '').trim() || null,
       (id_type || '').trim() || null, (id_number || '').trim() || null, (vehicle_plate || '').trim() || null,
       (badge_number || '').trim() || null, (notes || '').trim() || null]
    );
    console.log(`[Visitors] Check-in: ${full_name.trim()} by ${user.email}`);
    res.redirect('/visitors/check-in?success=' + encodeURIComponent(full_name.trim() + ' checked in successfully'));
  }));

  // ============================================================
  // ROUTE 4: POST /visitors/:id/check-out — Process Check-Out
  // ============================================================
  app.post('/visitors/:id/check-out', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, vid = req.params.id;
    const result = await pool.query(`UPDATE visitors SET check_out_time=NOW(), status='checked_out' WHERE id=$1 AND tenant_id=$2 AND status='checked_in' RETURNING id`, [vid, tid]);
    if (result.rows.length) console.log(`[Visitors] Check-out: visitor #${vid} by ${user.email}`);
    res.redirect('/visitors');
  }));

  // ============================================================
  // ROUTE 5: GET /visitors/pre-register — Pre-Registration Form
  // ============================================================
  app.get('/visitors/pre-register', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const html = VL_CSS + `<div style="max-width:700px;margin:0 auto">
      ${nav('prereg')}
      <a href="/visitors" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Dashboard</a>
      <div class="card" style="padding:24px">
        <h2 style="margin:0 0 4px;color:#1e293b">📝 Pre-Register Visitor</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Register an expected visitor in advance for faster check-in</p>
        <form method="POST" action="/visitors/pre-register/save" class="vl-form" style="display:flex;flex-direction:column;gap:16px">
          <div><label>Visitor Name *</label><input type="text" name="visitor_name" required placeholder="Full name"></div>
          <div class="vl-grid">
            <div><label>Email</label><input type="email" name="email" placeholder="visitor@email.com"></div>
            <div><label>Phone</label><input type="tel" name="phone" placeholder="+1 234 567 890"></div>
          </div>
          <div class="vl-grid">
            <div><label>Company</label><input type="text" name="company" placeholder="Company name"></div>
            <div><label>Purpose</label><select name="purpose"><option value="meeting">Meeting</option><option value="interview">Interview</option><option value="delivery">Delivery</option><option value="maintenance">Maintenance</option><option value="contractor">Contractor</option><option value="other">Other</option></select></div>
          </div>
          <div><label>Host Name</label><input type="text" name="host_name" placeholder="Person to meet"></div>
          <div class="vl-grid">
            <div><label>Expected Date *</label><input type="date" name="expected_date" required></div>
            <div><label>Expected Time</label><input type="time" name="expected_time"></div>
          </div>
          <div style="display:flex;gap:10px;margin-top:8px">
            <button type="submit" class="btn btn-green" style="padding:12px 28px">📝 Save Pre-Registration</button>
            <a href="/visitors/pre-registrations" class="btn btn-sm" style="padding:12px 28px">View All</a>
          </div>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Pre-Register Visitor', html, user, req));
  }));

  // ============================================================
  // ROUTE 6: POST /visitors/pre-register/save — Save Pre-Registration
  // ============================================================
  app.post('/visitors/pre-register/save', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { visitor_name, email, phone, company, purpose, host_name, expected_date, expected_time } = req.body;
    if (!visitor_name || !visitor_name.trim() || !expected_date) return res.redirect('/visitors/pre-register');
    await pool.query(
      `INSERT INTO pre_registrations (tenant_id, visitor_name, email, phone, company, purpose, host_name, expected_date, expected_time, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10)`,
      [tid, visitor_name.trim(), (email || '').trim() || null, (phone || '').trim() || null, (company || '').trim() || null,
       purpose || 'meeting', (host_name || '').trim() || null, expected_date, expected_time || null, user.id]
    );
    console.log(`[Visitors] Pre-registered: ${visitor_name.trim()} for ${expected_date}`);
    res.redirect('/visitors/pre-registrations');
  }));

  // ============================================================
  // ROUTE 7: GET /visitors/pre-registrations — List Pre-Registrations
  // ============================================================
  app.get('/visitors/pre-registrations', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { status } = req.query;
    let where = ['tenant_id=$1'], params = [tid], pi = 2;
    if (status) { where.push(`status=$${pi++}`); params.push(status); }

    const preRegs = (await pool.query(
      `SELECT pr.*, u.name as creator_name FROM pre_registrations pr LEFT JOIN users u ON u.id = pr.created_by WHERE ${where.join(' AND ')} ORDER BY expected_date, expected_time LIMIT 100`, params
    )).rows;

    const rows = preRegs.map(p => `<tr>
      <td style="font-weight:600;color:#1e293b">${esc(p.visitor_name)}</td>
      <td>${esc(p.company || '-')}</td>
      <td>${esc(p.host_name || '-')}</td>
      <td>${esc(p.purpose || '-')}</td>
      <td style="font-size:12px">${formatDate(p.expected_date)}${p.expected_time ? ' ' + formatTime(p.expected_time) : ''}</td>
      <td>${preRegBadge(p.status)}</td>
      <td style="font-size:12px" class="muted">${formatDate(p.created_at)}</td>
      <td>
        <div style="display:flex;gap:4px">
          ${p.status === 'pending' ? `
            <form method="POST" action="/visitors/pre-registrations/${p.id}/approve" style="display:inline"><button class="btn btn-sm btn-green" type="submit">Approve</button></form>
            <form method="POST" action="/visitors/pre-registrations/${p.id}/reject" style="display:inline"><button class="btn btn-sm btn-red" type="submit">Reject</button></form>
          ` : ''}
          ${p.status === 'approved' ? `<form method="POST" action="/visitors/pre-registrations/${p.id}/checkin" style="display:inline"><button class="btn btn-sm btn-blue" type="submit">Check In</button></form>` : ''}
        </div>
      </td>
    </tr>`).join('');

    const html = VL_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('preregs')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:22px;color:#1e293b">📋 Pre-Registrations</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Manage expected visitors</p></div>
        <a href="/visitors/pre-register" class="btn btn-blue">📝 New Pre-Registration</a>
      </div>
      <div class="vl-filter">
        <div><label>Status</label><select onchange="location.href='/visitors/pre-registrations?status='+this.value"><option value="">All</option>
          <option value="pending" ${status==='pending'?'selected':''}>Pending</option>
          <option value="approved" ${status==='approved'?'selected':''}>Approved</option>
          <option value="visited" ${status==='visited'?'selected':''}>Visited</option>
          <option value="rejected" ${status==='rejected'?'selected':''}>Rejected</option></select></div>
      </div>
      <div class="card"><div style="overflow-x:auto"><table class="vl-table">
        <thead><tr><th>Visitor</th><th>Company</th><th>Host</th><th>Purpose</th><th>Expected</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="8" style="text-align:center;color:#94a3b8;padding:40px">No pre-registrations found</td></tr>'}</tbody>
      </table></div></div>
    </div>`;
    res.send(renderPage('Pre-Registrations', html, user, req));
  }));

  // Pre-reg actions (approve, reject, check-in from pre-reg)
  app.post('/visitors/pre-registrations/:id/approve', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query(`UPDATE pre_registrations SET status='approved' WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
    res.redirect('/visitors/pre-registrations');
  }));
  app.post('/visitors/pre-registrations/:id/reject', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query(`UPDATE pre_registrations SET status='rejected' WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
    res.redirect('/visitors/pre-registrations');
  }));
  app.post('/visitors/pre-registrations/:id/checkin', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const pr = (await pool.query(`SELECT * FROM pre_registrations WHERE id=$1 AND tenant_id=$2 AND status='approved'`, [req.params.id, tid])).rows[0];
    if (!pr) return res.redirect('/visitors/pre-registrations');
    await pool.query(
      `INSERT INTO visitors (tenant_id, full_name, email, phone, company, purpose, host_name, check_in_time, status) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),'checked_in')`,
      [tid, pr.visitor_name, pr.email, pr.phone, pr.company, pr.purpose, pr.host_name]
    );
    await pool.query(`UPDATE pre_registrations SET status='visited' WHERE id=$1`, [pr.id]);
    console.log(`[Visitors] Pre-reg check-in: ${pr.visitor_name}`);
    res.redirect('/visitors');
  }));

  // ============================================================
  // ROUTE 8: GET /visitors/history — Visitor History
  // ============================================================
  app.get('/visitors/history', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { from, to, search } = req.query;
    let where = ['tenant_id=$1'], params = [tid], pi = 2;
    if (from) { where.push(`check_in_time >= $${pi++}`); params.push(from); }
    if (to) { where.push(`check_in_time < ($${pi++}::date + INTERVAL '1 day')`); params.push(to); }
    if (search) { where.push(`(full_name ILIKE $${pi} OR company ILIKE $${pi})`); params.push('%' + search + '%'); pi++; }

    const visitors = (await pool.query(
      `SELECT * FROM visitors WHERE ${where.join(' AND ')} ORDER BY check_in_time DESC LIMIT 200`, params
    )).rows;

    const rows = visitors.map(v => `<tr>
      <td style="font-weight:600">${esc(v.full_name)}</td>
      <td>${esc(v.company || '-')}</td>
      <td>${purposeDot(v.purpose)}<span style="font-size:12px">${esc(v.purpose)}</span></td>
      <td>${esc(v.host_name || '-')}</td>
      <td>${statusBadge(v.status)}</td>
      <td style="font-size:12px">${formatDateTime(v.check_in_time)}</td>
      <td style="font-size:12px">${formatDateTime(v.check_out_time)}</td>
      <td style="font-size:12px;font-weight:600">${durationLabel(v.check_in_time, v.check_out_time)}</td>
      <td><a href="/visitors/${v.id}" class="btn btn-sm btn-blue">View</a></td>
    </tr>`).join('');

    const html = VL_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('history')}
      <h1 style="font-size:22px;color:#1e293b;margin-bottom:16px">📜 Visitor History</h1>
      <div class="vl-filter">
        <div><label>From</label><input type="date" name="from" value="${esc(from||'')}" onchange="updateHistory()"></div>
        <div><label>To</label><input type="date" name="to" value="${esc(to||'')}" onchange="updateHistory()"></div>
        <div><label>Search</label><form method="GET"><input type="text" name="search" value="${esc(search||'')}" placeholder="Name or company..." style="width:200px"><input type="hidden" name="from" value="${esc(from||'')}"><input type="hidden" name="to" value="${esc(to||'')}"><button class="btn btn-sm" type="submit">🔍</button></form></div>
      </div>
      <div class="card"><div style="overflow-x:auto"><table class="vl-table">
        <thead><tr><th>Visitor</th><th>Company</th><th>Purpose</th><th>Host</th><th>Status</th><th>Check-In</th><th>Check-Out</th><th>Duration</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="9" style="text-align:center;color:#94a3b8;padding:40px">No visitor records found for the selected period</td></tr>'}</tbody>
      </table></div></div>
      <script>function updateHistory(){const f=document.querySelector('input[name=from]').value,t=document.querySelector('input[name=to]').value;location.href='/visitors/history?from='+f+'&to='+t;}</script>
    </div>`;
    res.send(renderPage('Visitor History', html, user, req));
  }));

  // ============================================================
  // ROUTE 9: GET /visitors/report — Analytics
  // ============================================================
  app.get('/visitors/report', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const period = req.query.period || '30';

    const interval = period === '7' ? "INTERVAL '7 days'" : period === '90' ? "INTERVAL '90 days'" : "INTERVAL '30 days'";
    const byPurpose = (await pool.query(
      `SELECT purpose, COUNT(*)::int as cnt FROM visitors WHERE tenant_id=$1 AND check_in_time >= NOW() - ${interval} GROUP BY purpose ORDER BY cnt DESC LIMIT 10`, [tid]
    )).rows;
    const byHost = (await pool.query(
      `SELECT host_name, COUNT(*)::int as cnt FROM visitors WHERE tenant_id=$1 AND check_in_time >= NOW() - ${interval} GROUP BY host_name ORDER BY cnt DESC LIMIT 10`, [tid]
    )).rows;
    const frequency = (await pool.query(
      `SELECT full_name, company, COUNT(*)::int as visits FROM visitors WHERE tenant_id=$1 AND check_in_time >= NOW() - ${interval} GROUP BY full_name, company ORDER BY visits DESC LIMIT 15`, [tid]
    )).rows;
    const peakHours = (await pool.query(
      `SELECT EXTRACT(HOUR FROM check_in_time)::int as hour, COUNT(*)::int as cnt
       FROM visitors WHERE tenant_id=$1 AND check_in_time >= NOW() - ${interval}
       GROUP BY EXTRACT(HOUR FROM check_in_time) ORDER BY hour`, [tid]
    )).rows;
    const avgDuration = (await pool.query(
      `SELECT AVG(EXTRACT(EPOCH FROM (check_out_time - check_in_time))/60)::int as avg_min
       FROM visitors WHERE tenant_id=$1 AND check_out_time IS NOT NULL AND check_in_time >= NOW() - ${interval}`, [tid]
    )).rows[0].avg_min || 0;
    const totalVisits = byPurpose.reduce((s, r) => s + r.cnt, 0);
    const maxPeak = peakHours.reduce((m, r) => m > r.cnt ? m : r.cnt, 1);

    const purposeRows = byPurpose.map(r => `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
      ${purposeDot(r.purpose)}<span style="font-size:13px;flex:1;text-transform:capitalize">${esc(r.purpose)}</span>
      <span style="font-weight:700;font-size:13px">${r.cnt}</span>
      <span class="muted" style="font-size:11px">${((r.cnt / totalVisits) * 100).toFixed(0)}%</span>
    </div>`).join('');

    const hostRows = byHost.filter(r => r.host_name).map(r => `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
      <span style="font-size:13px;flex:1">${esc(r.host_name)}</span>
      <span style="font-weight:700;font-size:13px;color:#4f46e5">${r.cnt}</span>
    </div>`).join('');

    const freqRows = frequency.map(r => `<tr>
      <td style="font-weight:600">${esc(r.full_name)}</td>
      <td class="muted">${esc(r.company || '-')}</td>
      <td>${frequencyBar(r.visits)}</td>
    </tr>`).join('');

    const peakBars = Array.from({ length: 24 }, h => {
      const found = peakHours.find(p => p.hour === h);
      const cnt = found ? found.cnt : 0;
      const w = maxPeak > 0 ? (cnt / maxPeak) * 100 : 0;
      if (cnt === 0) return `<div class="vl-peak-bar"><span class="vl-peak-label">${String(h).padStart(2,'0')}:00</span><div style="height:24px;width:${Math.max(w, 4)}%;border-radius:6px;background:#f1f5f9"></div></div>`;
      return `<div class="vl-peak-bar"><span class="vl-peak-label">${String(h).padStart(2,'0')}:00</span><div class="vl-peak-fill" style="width:${Math.max(w, 8)}%">${cnt}</div></div>`;
    }).join('');

    const html = VL_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('report')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:22px;color:#1e293b">📊 Visitor Analytics</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Insights into visitor patterns and trends</p></div>
        <div class="vl-filter" style="margin-bottom:0">
          <select onchange="location.href='/visitors/report?period='+this.value">
            <option value="7" ${period==='7'?'selected':''}>Last 7 days</option>
            <option value="30" ${period==='30'?'selected':''}>Last 30 days</option>
            <option value="90" ${period==='90'?'selected':''}>Last 90 days</option>
          </select>
        </div>
      </div>
      <div class="stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-bottom:20px">
        <div class="stat-card"><div class="stat-num">${totalVisits}</div><div class="muted">Total Visits</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#4f46e5">${avgDuration}</div><div class="muted">Avg Duration (min)</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#7c3aed">${byPurpose.length}</div><div class="muted">Purpose Categories</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#0891b2">${frequency.length > 0 ? frequency[0].visits : 0}</div><div class="muted">Most Frequent</div></div>
      </div>
      <div class="grid" style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:20px">
        <div class="card" style="padding:20px"><h3 style="font-size:15px;color:#1e293b;margin-bottom:14px">🎯 Visits by Purpose</h3>${purposeRows || '<p class="muted">No data</p>'}</div>
        <div class="card" style="padding:20px"><h3 style="font-size:15px;color:#1e293b;margin-bottom:14px">👤 Host Summary</h3>${hostRows || '<p class="muted">No data</p>'}</div>
      </div>
      <div class="grid" style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div class="card" style="padding:20px"><h3 style="font-size:15px;color:#1e293b;margin-bottom:14px">🔁 Visitor Frequency</h3>
          <div style="overflow-x:auto"><table class="vl-table"><thead><tr><th>Visitor</th><th>Company</th><th>Visits</th></tr></thead><tbody>${freqRows || '<tr><td colspan="3" class="muted" style="text-align:center;padding:20px">No data</td></tr>'}</tbody></table></div>
        </div>
        <div class="card" style="padding:20px"><h3 style="font-size:15px;color:#1e293b;margin-bottom:14px">📈 Peak Hours (Check-In)</h3>
          <div style="max-height:400px;overflow-y:auto">${peakBars || '<p class="muted">No data</p>'}</div>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Visitor Analytics', html, user, req));
  }));

  // ============================================================
  // ROUTE 10: DELETE /visitors/:id — Delete Visitor Record
  // ============================================================
  app.delete('/visitors/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, vid = req.params.id;
    await pool.query(`DELETE FROM visitors WHERE id=$1 AND tenant_id=$2`, [vid, tid]);
    console.log(`[Visitors] Deleted visitor #${vid} by ${user.email}`);
    res.json({ success: true });
  }));

  // ============================================================
  // ROUTE 11: GET /visitors/:id — Visitor Detail
  // ============================================================
  app.get('/visitors/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, vid = req.params.id;
    const v = (await pool.query(`SELECT * FROM visitors WHERE id=$1 AND tenant_id=$2`, [vid, tid])).rows[0];
    if (!v) return res.send(renderPage('Not Found', '<div class="card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">Visitor record not found</h2><a href="/visitors" class="btn btn-sm" style="margin-top:12px">← Back</a></div>', user, req));

    const prevVisits = (await pool.query(
      `SELECT id, check_in_time, check_out_time, purpose, host_name FROM visitors WHERE tenant_id=$1 AND full_name=$2 AND email=$3 AND id != $4 ORDER BY check_in_time DESC LIMIT 10`,
      [tid, v.full_name, v.email || '', vid]
    )).rows;

    const prevRows = prevVisits.map(p => `<tr>
      <td>${purposeDot(p.purpose)}<span style="font-size:12px">${esc(p.purpose)}</span></td>
      <td style="font-size:12px">${formatDateTime(p.check_in_time)}</td>
      <td style="font-size:12px">${formatDateTime(p.check_out_time)}</td>
      <td style="font-size:12px">${durationLabel(p.check_in_time, p.check_out_time)}</td>
      <td><a href="/visitors/${p.id}" class="btn btn-sm btn-blue">View</a></td>
    </tr>`).join('');

    const html = VL_CSS + `<div style="max-width:900px;margin:0 auto">
      ${nav('')}
      <a href="/visitors" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Dashboard</a>
      <div class="card" style="padding:24px;margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;align-items:start;flex-wrap:wrap;gap:12px">
          <div>
            <h1 style="margin:0 0 8px;color:#1e293b;font-size:22px">${esc(v.full_name)}</h1>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              ${statusBadge(v.status)}
              ${purposeDot(v.purpose)}<span style="font-size:12px;color:#475569;text-transform:capitalize">${esc(v.purpose)}</span>
              ${v.badge_number ? `<span class="badge badge-warning">🏷 Badge #${esc(v.badge_number)}</span>` : ''}
            </div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            ${v.status === 'checked_in' ? `<form method="POST" action="/visitors/${v.id}/check-out" style="display:inline"><button class="btn btn-red">🔴 Check Out</button></form>` : ''}
            <button class="btn btn-sm btn-red" onclick="if(confirm('Delete this visitor record?')){fetch('/visitors/${v.id}',{method:'DELETE'}).then(()=>location.href='/visitors')}">🗑 Delete</button>
          </div>
        </div>
        <div class="grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-top:20px;padding-top:16px;border-top:1px solid #e2e8f0">
          <div><span class="muted" style="display:block;font-size:11px">Email</span><strong style="font-size:14px">${esc(v.email || '—')}</strong></div>
          <div><span class="muted" style="display:block;font-size:11px">Phone</span><strong style="font-size:14px">${esc(v.phone || '—')}</strong></div>
          <div><span class="muted" style="display:block;font-size:11px">Company</span><strong style="font-size:14px">${esc(v.company || '—')}</strong></div>
          <div><span class="muted" style="display:block;font-size:11px">Host</span><strong style="font-size:14px">${esc(v.host_name || '—')}</strong></div>
          <div><span class="muted" style="display:block;font-size:11px">Department</span><strong style="font-size:14px">${esc(v.host_department || '—')}</strong></div>
          <div><span class="muted" style="display:block;font-size:11px">ID Type</span><strong style="font-size:14px">${esc(v.id_type || '—')}</strong></div>
          <div><span class="muted" style="display:block;font-size:11px">ID Number</span><strong style="font-size:14px">${esc(v.id_number || '—')}</strong></div>
          <div><span class="muted" style="display:block;font-size:11px">Vehicle</span><strong style="font-size:14px">${esc(v.vehicle_plate || '—')}</strong></div>
          <div><span class="muted" style="display:block;font-size:11px">Check-In</span><strong style="font-size:14px">${formatDateTime(v.check_in_time)}</strong></div>
          <div><span class="muted" style="display:block;font-size:11px">Check-Out</span><strong style="font-size:14px">${formatDateTime(v.check_out_time)}</strong></div>
          <div><span class="muted" style="display:block;font-size:11px">Duration</span><strong style="font-size:14px;color:#4f46e5">${durationLabel(v.check_in_time, v.check_out_time)}</strong></div>
          <div><span class="muted" style="display:block;font-size:11px">Registered</span><strong style="font-size:14px">${formatDateTime(v.created_at)}</strong></div>
        </div>
        ${v.purpose_details || v.notes ? `<div style="margin-top:16px;padding:14px;background:#f8fafc;border-radius:10px;font-size:13px;color:#334155">
          ${v.purpose_details ? `<div><strong>Purpose Details:</strong> ${esc(v.purpose_details)}</div>` : ''}
          ${v.notes ? `<div style="margin-top:8px"><strong>Notes:</strong> ${esc(v.notes)}</div>` : ''}
        </div>` : ''}
      </div>
      ${prevVisits.length ? `<div class="card" style="padding:20px">
        <h3 style="font-size:15px;color:#1e293b;margin-bottom:14px">🔄 Previous Visits (${prevVisits.length})</h3>
        <div style="overflow-x:auto"><table class="vl-table">
          <thead><tr><th>Purpose</th><th>Check-In</th><th>Check-Out</th><th>Duration</th><th></th></tr></thead>
          <tbody>${prevRows}</tbody>
        </table></div>
      </div>` : ''}
    </div>`;
    res.send(renderPage('Visitor: ' + v.full_name, html, user, req));
  }));

  // ============================================================
  // ROUTE 12: GET /api/visitors/current — Currently Checked-In (JSON)
  // ============================================================
  app.get('/api/visitors/current', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const visitors = (await pool.query(
      `SELECT id, full_name, email, phone, company, purpose, host_name, host_department, badge_number, check_in_time, vehicle_plate
       FROM visitors WHERE tenant_id=$1 AND status='checked_in' ORDER BY check_in_time DESC`, [tid]
    )).rows;
    res.json({ success: true, count: visitors.length, visitors });
  }));

  // ============================================================
  // ROUTE 13: GET /api/visitors/stats — Visitor Stats (JSON)
  // ============================================================
  app.get('/api/visitors/stats', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const nowIn = (await pool.query(`SELECT COUNT(*)::int as cnt FROM visitors WHERE tenant_id=$1 AND status='checked_in'`, [tid])).rows[0].cnt;
    const todayTotal = (await pool.query(`SELECT COUNT(*)::int as cnt FROM visitors WHERE tenant_id=$1 AND check_in_time >= CURRENT_DATE`, [tid])).rows[0].cnt;
    const weekTotal = (await pool.query(`SELECT COUNT(*)::int as cnt FROM visitors WHERE tenant_id=$1 AND check_in_time >= date_trunc('week', NOW())`, [tid])).rows[0].cnt;
    const monthTotal = (await pool.query(`SELECT COUNT(*)::int as cnt FROM visitors WHERE tenant_id=$1 AND check_in_time >= date_trunc('month', NOW())`, [tid])).rows[0].cnt;
    const pendingPre = (await pool.query(`SELECT COUNT(*)::int as cnt FROM pre_registrations WHERE tenant_id=$1 AND status='pending' AND expected_date >= CURRENT_DATE`, [tid])).rows[0].cnt;
    const avgDuration = (await pool.query(
      `SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (check_out_time - check_in_time))/60)::int, 0) as avg_min
       FROM visitors WHERE tenant_id=$1 AND check_out_time IS NOT NULL AND check_in_time >= date_trunc('month', NOW())`, [tid]
    )).rows[0].avg_min;

    res.json({
      success: true,
      stats: { currently_in: nowIn, today: todayTotal, this_week: weekTotal, this_month: monthTotal, pending_pre_registrations: pendingPre, avg_duration_min: avgDuration }
    });
  }));

  console.log('[Visitors] Visitor management loaded');
};
