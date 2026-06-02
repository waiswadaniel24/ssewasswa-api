// ============================================================
// ATTENDANCE TRACKER MODULE — Multi-Tenant SaaS Platform
// Dashboard, marking, sessions, QR check-in, reports, CSV
// export, leave/exception management, JSON APIs.
// ============================================================
// Usage in server.js:
//   const attendanceTracker = require('./attendance-tracker');
//   attendanceTracker(app, db, pool, renderPage, esc);
// ============================================================

'use strict';

// ============================================================
// MODULE ENTRY POINT
// ============================================================
const { migrateQuery } = require('./db');
module.exports = function attendanceTracker(app, db, pool, renderPage, esc) {

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
  const fmtTime = (t) => t ? String(t).substring(0, 5) : '—';
  const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const today = () => new Date().toISOString().slice(0, 10);
  const genToken = () => require('crypto').randomBytes(24).toString('hex');

  function statusBadge(s) {
    const m = {
      present: { cls: 'badge-success', label: 'Present' },
      absent: { cls: 'badge-error', label: 'Absent' },
      late: { cls: 'badge-warning', label: 'Late' },
      excused: { cls: 'badge', label: 'Excused', style: 'background:#dbeafe;color:#1d4ed8' },
      pending: { cls: 'badge-warning', label: 'Pending' },
      approved: { cls: 'badge-success', label: 'Approved' },
      rejected: { cls: 'badge-error', label: 'Rejected' },
    };
    const v = m[s] || { cls: 'badge', label: s };
    return `<span class="badge ${v.cls}" ${v.style ? 'style="' + v.style + '"' : ''}>${v.label}</span>`;
  }

  // -- shared CSS --------------------------------------------------------
  const AT_CSS = `<style>
    .at-nav{display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap}
    .at-nav a{padding:8px 18px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#475569;background:#f1f5f9;transition:.15s}
    .at-nav a:hover{background:#e2e8f0}.at-nav a.active{background:#4f46e5;color:#fff}
    .at-btn{display:inline-flex;align-items:center;gap:6px;padding:9px 18px;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:.15s}
    .at-btn:hover{opacity:.9;transform:translateY(-1px)}
    .at-btn-primary{background:#4f46e5;color:#fff}.at-btn-success{background:#059669;color:#fff}
    .at-btn-danger{background:#fee2e2;color:#dc2626}.at-btn-secondary{background:#f1f5f9;color:#475569}
    .at-table{width:100%;border-collapse:collapse;font-size:13px}
    .at-table th{padding:11px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#f8fafc}
    .at-table td{padding:10px 14px;border-bottom:1px solid #f1f5f9;color:#1e293b}
    .at-table tr:hover{background:#f8fafc}
    .at-filter{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:end}
    .at-filter label{display:block;font-size:12px;font-weight:600;color:#64748b;margin-bottom:4px}
    .at-filter input,.at-filter select{padding:8px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px;background:#fff}
    .at-filter input:focus,.at-filter select:focus{outline:none;border-color:#6366f1}
    .at-qr{width:220px;height:220px;border:3px solid #e2e8f0;border-radius:14px;display:flex;align-items:center;justify-content:center;background:#fff;margin:16px auto}
    @media(max-width:768px){.at-nav{gap:4px}.at-nav a{padding:6px 12px;font-size:12px}}
  </style>`;

  // -- navigation helper --------------------------------------------------
  const nav = (active) => `<div class="at-nav">
    <a href="/attendance" class="${active === 'dash' ? 'active' : ''}">📊 Dashboard</a>
    <a href="/attendance/session/new" class="${active === 'sessions' ? 'active' : ''}">📷 Sessions</a>
    <a href="/attendance/report" class="${active === 'reports' ? 'active' : ''}">📈 Reports</a>
    <a href="/attendance/exceptions" class="${active === 'exceptions' ? 'active' : ''}">📋 Exceptions</a>
  </div>`;

  // ============================================================
  // DATABASE MIGRATIONS (async IIFE)
  // ============================================================
  (async () => {
    try {
      await migrateQuery(pool, 'AttendanceTracker', `CREATE TABLE IF NOT EXISTS attendance_records (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        person_id INTEGER NOT NULL, person_type VARCHAR(20) DEFAULT 'student',
        person_name VARCHAR(255), date DATE NOT NULL, check_in TIME, check_out TIME,
        status VARCHAR(20) DEFAULT 'present', method VARCHAR(20) DEFAULT 'manual',
        location TEXT, notes TEXT, verified_by INTEGER,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await migrateQuery(pool, 'AttendanceTracker', `CREATE TABLE IF NOT EXISTS attendance_sessions (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name VARCHAR(255), session_date DATE NOT NULL, session_type VARCHAR(50) DEFAULT 'morning',
        created_by INTEGER, qr_token VARCHAR(100) UNIQUE, is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await migrateQuery(pool, 'AttendanceTracker', `CREATE TABLE IF NOT EXISTS attendance_exceptions (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        person_id INTEGER, person_type VARCHAR(20), start_date DATE, end_date DATE,
        reason TEXT, type VARCHAR(20) DEFAULT 'leave', approved_by INTEGER,
        status VARCHAR(20) DEFAULT 'pending', created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      // ALTER TABLE IF NOT EXISTS — attendance_records
      const arCols = ['person_id','person_type','person_name','date','check_in','check_out','status','method','location','notes','verified_by'];
      for (const col of arCols) { try { await migrateQuery(pool, 'AttendanceTracker', `ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS ${col} ${col==='date'?'DATE':col==='check_in'||col==='check_out'?'TIME':col==='verified_by'||col==='person_id'?'INTEGER':'TEXT'}`); } catch(e){} }
      // ALTER TABLE IF NOT EXISTS — attendance_sessions
      const asCols = ['name','session_date','session_type','created_by','qr_token','is_active'];
      for (const col of asCols) { try { await migrateQuery(pool, 'AttendanceTracker', `ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS ${col} ${col==='session_date'?'DATE':col==='created_by'?'INTEGER':col==='is_active'?'BOOLEAN DEFAULT true':'TEXT'}`); } catch(e){} }
      // ALTER TABLE IF NOT EXISTS — attendance_exceptions
      const aeCols = ['person_id','person_type','start_date','end_date','reason','type','approved_by','status'];
      for (const col of aeCols) { try { await migrateQuery(pool, 'AttendanceTracker', `ALTER TABLE attendance_exceptions ADD COLUMN IF NOT EXISTS ${col} ${col==='start_date'||col==='end_date'?'DATE':col==='person_id'||col==='approved_by'?'INTEGER':'TEXT'}`); } catch(e){} }
      // Indexes
      await migrateQuery(pool, 'AttendanceTracker', `CREATE INDEX IF NOT EXISTS idx_ar_tenant ON attendance_records(tenant_id)`);
      await migrateQuery(pool, 'AttendanceTracker', `CREATE INDEX IF NOT EXISTS idx_ar_date ON attendance_records(date)`);
      await migrateQuery(pool, 'AttendanceTracker', `CREATE INDEX IF NOT EXISTS idx_ar_status ON attendance_records(tenant_id, status)`);
      await migrateQuery(pool, 'AttendanceTracker', `CREATE INDEX IF NOT EXISTS idx_as_tenant ON attendance_sessions(tenant_id)`);
      await migrateQuery(pool, 'AttendanceTracker', `CREATE INDEX IF NOT EXISTS idx_as_date ON attendance_sessions(session_date)`);
      await migrateQuery(pool, 'AttendanceTracker', `CREATE INDEX IF NOT EXISTS idx_as_status ON attendance_sessions(tenant_id, is_active)`);
      await migrateQuery(pool, 'AttendanceTracker', `CREATE INDEX IF NOT EXISTS idx_ae_tenant ON attendance_exceptions(tenant_id)`);
      await migrateQuery(pool, 'AttendanceTracker', `CREATE INDEX IF NOT EXISTS idx_ae_date ON attendance_exceptions(start_date)`);
      await migrateQuery(pool, 'AttendanceTracker', `CREATE INDEX IF NOT EXISTS idx_ae_status ON attendance_exceptions(tenant_id, status)`);
      console.log('[Attendance] Migrations applied successfully');
    } catch (e) { console.error('[Attendance] Migration error:', e.message); }
  })();

  // ============================================================
  // ROUTE 1: GET /attendance — Dashboard
  // ============================================================
  app.get('/attendance', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const selectedDate = req.query.date || today();
    const personType = req.query.person_type || '';
    const status = req.query.status || '';

    let where = ['tenant_id=$1', 'date=$2'], params = [tid, selectedDate], pi = 3;
    if (personType) { where.push(`person_type=$${pi++}`); params.push(personType); }
    if (status) { where.push(`status=$${pi++}`); params.push(status); }

    const records = (await pool.query(`SELECT * FROM attendance_records WHERE ${where.join(' AND ')} ORDER BY check_in DESC`, params)).rows;

    // Stats
    const todayStats = (await pool.query(`SELECT status, COUNT(*)::int as cnt FROM attendance_records WHERE tenant_id=$1 AND date=$2 GROUP BY status`, [tid, selectedDate])).rows;
    const totalToday = todayStats.reduce((s, r) => s + r.cnt, 0);
    const presentToday = (todayStats.find(r => r.status === 'present') || {}).cnt || 0;
    const absentToday = (todayStats.find(r => r.status === 'absent') || {}).cnt || 0;
    const lateToday = (todayStats.find(r => r.status === 'late') || {}).cnt || 0;
    const rateToday = totalToday > 0 ? Math.round((presentToday + lateToday) / totalToday * 100) : 0;

    // Weekly rate
    const weekRows = (await pool.query(`SELECT status, COUNT(*)::int as cnt FROM attendance_records WHERE tenant_id=$1 AND date >= date_trunc('week', CURRENT_DATE) AND status IN ('present','late','absent') GROUP BY status`, [tid])).rows;
    const weekTotal = weekRows.reduce((s, r) => s + r.cnt, 0);
    const weekPresent = weekRows.filter(r => r.status !== 'absent').reduce((s, r) => s + r.cnt, 0);
    const rateWeek = weekTotal > 0 ? Math.round(weekPresent / weekTotal * 100) : 0;

    // Monthly rate
    const monthRows = (await pool.query(`SELECT status, COUNT(*)::int as cnt FROM attendance_records WHERE tenant_id=$1 AND date >= date_trunc('month', CURRENT_DATE) AND status IN ('present','late','absent') GROUP BY status`, [tid])).rows;
    const monthTotal = monthRows.reduce((s, r) => s + r.cnt, 0);
    const monthPresent = monthRows.filter(r => r.status !== 'absent').reduce((s, r) => s + r.cnt, 0);
    const rateMonth = monthTotal > 0 ? Math.round(monthPresent / monthTotal * 100) : 0;

    const rowsHtml = records.map(r => `<tr>
      <td><strong>${esc(r.person_name || 'ID ' + r.person_id)}</strong></td>
      <td>${r.person_type}</td>
      <td>${statusBadge(r.status)}</td>
      <td>${fmtTime(r.check_in)}</td>
      <td>${fmtTime(r.check_out)}</td>
      <td class="muted">${esc(r.method || 'manual')}</td>
      <td>${fmtDateTime(r.created_at)}</td>
    </tr>`).join('');

    const html = AT_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('dash')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">📊 Attendance Dashboard</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Track daily attendance and session check-ins</p></div>
        <div style="display:flex;gap:8px">
          <a href="/attendance/session/new" class="at-btn at-btn-primary">📷 New Session</a>
          <a href="/attendance/report/export?date=${selectedDate}" class="at-btn at-btn-secondary">📥 Export</a>
        </div>
      </div>
      <div class="stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;margin-bottom:20px">
        <div class="stat-card"><div class="stat-num" style="color:#4f46e5">${totalToday}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Total Today</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#16a34a">${rateToday}%</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Today's Rate</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#3b82f6">${rateWeek}%</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Weekly Rate</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#a855f7">${rateMonth}%</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Monthly Rate</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#ef4444">${absentToday}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Absent Today</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${lateToday}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Late Today</div></div>
      </div>
      <div class="at-filter">
        <div><label>Date</label><input type="date" name="date" value="${esc(selectedDate)}" onchange="location.href='/attendance?date='+this.value"></div>
        <div><label>Person Type</label><select onchange="location.href='/attendance?date=${esc(selectedDate)}&person_type='+this.value">
          <option value="">All</option><option value="student" ${personType==='student'?'selected':''}>Student</option><option value="staff" ${personType==='staff'?'selected':''}>Staff</option><option value="teacher" ${personType==='teacher'?'selected':''}>Teacher</option>
        </select></div>
        <div><label>Status</label><select onchange="location.href='/attendance?date=${esc(selectedDate)}&status='+this.value">
          <option value="">All</option><option value="present" ${status==='present'?'selected':''}>Present</option><option value="absent" ${status==='absent'?'selected':''}>Absent</option><option value="late" ${status==='late'?'selected':''}>Late</option><option value="excused" ${status==='excused'?'selected':''}>Excused</option>
        </select></div>
        <div><label>&nbsp;</label><form method="POST" action="/attendance/mark" style="display:flex;gap:6px">
          <input type="hidden" name="date" value="${esc(selectedDate)}">
          <input type="text" name="person_name" placeholder="Person name" required style="padding:8px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px">
          <select name="status" style="padding:8px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"><option value="present">Present</option><option value="absent">Absent</option><option value="late">Late</option><option value="excused">Excused</option></select>
          <button type="submit" class="btn btn-green btn-sm">✓ Mark</button>
        </form></div>
      </div>
      <div class="card"><div style="overflow-x:auto"><table class="at-table">
        <thead><tr><th>Person</th><th>Type</th><th>Status</th><th>Check In</th><th>Check Out</th><th>Method</th><th>Recorded</th></tr></thead>
        <tbody>${rowsHtml || '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:30px">No attendance records for this date</td></tr>'}</tbody>
      </table></div></div>
    </div>`;
    res.send(renderPage('Attendance Dashboard', html, user, req));
  }));

  // ============================================================
  // ROUTE 2: POST /attendance/mark — Mark single attendance
  // ============================================================
  app.post('/attendance/mark', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { person_id, person_name, person_type, date, check_in, check_out, status, method, location, notes } = req.body;
    const recordDate = date || today();
    const checkInTime = check_in || new Date().toTimeString().slice(0, 5);

    // Upsert: if record exists for same person + date, update; else insert
    const existing = (await pool.query(
      `SELECT id FROM attendance_records WHERE tenant_id=$1 AND person_id=$2 AND date=$3 LIMIT 1`,
      [tid, person_id || 0, recordDate]
    )).rows[0];

    if (existing) {
      await pool.query(`UPDATE attendance_records SET status=$1, check_in=$2, check_out=$3, method=$4, location=$5, notes=$6, person_name=$7, person_type=$8 WHERE id=$9 AND tenant_id=$10`,
        [status || 'present', checkInTime, check_out || null, method || 'manual', location || null, notes || null, person_name, person_type || 'student', existing.id, tid]);
    } else {
      await pool.query(
        `INSERT INTO attendance_records (tenant_id, person_id, person_name, person_type, date, check_in, check_out, status, method, location, notes, verified_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [tid, person_id || 0, person_name || 'Unknown', person_type || 'student', recordDate, checkInTime, check_out || null, status || 'present', method || 'manual', location || null, notes || null, user.id]
      );
    }
    res.redirect('/attendance?date=' + recordDate);
  }));

  // ============================================================
  // ROUTE 3: POST /attendance/batch — Batch mark attendance
  // ============================================================
  app.post('/attendance/batch', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { date, person_type, status, person_ids } = req.body;
    const recordDate = date || today();
    const pType = person_type || 'student';
    const batchStatus = status || 'present';
    const ids = Array.isArray(person_ids) ? person_ids : [person_ids].filter(Boolean);

    if (!ids.length) {
      req.session.flash = { type: 'error', msg: 'No persons selected for batch marking' };
      return res.redirect('/attendance?date=' + recordDate);
    }

    let marked = 0;
    for (const pid of ids) {
      const name = req.body['name_' + pid] || ('Person ' + pid);
      const existing = (await pool.query(`SELECT id FROM attendance_records WHERE tenant_id=$1 AND person_id=$2 AND date=$3 LIMIT 1`, [tid, pid, recordDate])).rows[0];
      if (!existing) {
        await pool.query(`INSERT INTO attendance_records (tenant_id, person_id, person_name, person_type, date, status, method, verified_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [tid, pid, name, pType, recordDate, batchStatus, 'batch', user.id]);
        marked++;
      }
    }
    req.session.flash = { type: 'success', msg: `Batch marked ${marked} records as ${batchStatus}` };
    res.redirect('/attendance?date=' + recordDate);
  }));

  // ============================================================
  // ROUTE 4: GET /attendance/session/new — New session form
  // ============================================================
  app.get('/attendance/session/new', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const html = AT_CSS + `<div style="max-width:700px;margin:0 auto">
      ${nav('sessions')}
      <a href="/attendance" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Dashboard</a>
      <div class="card" style="padding:28px">
        <h2 style="margin:0 0 4px;color:#1e293b">📷 New Attendance Session</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:24px">Create a session to generate a QR code for check-ins</p>
        <form method="POST" action="/attendance/session/create" style="display:flex;flex-direction:column;gap:18px">
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Session Name *</label>
            <input type="text" name="name" required placeholder="e.g., Morning Assembly" style="width:100%;padding:11px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px"></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Session Date *</label>
              <input type="date" name="session_date" required value="${today()}" style="width:100%;padding:11px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px"></div>
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Session Type</label>
              <select name="session_type" style="width:100%;padding:11px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px">
                <option value="morning">Morning</option><option value="afternoon">Afternoon</option><option value="evening">Evening</option><option value="event">Event</option></select></div>
          </div>
          <button type="submit" class="at-btn at-btn-primary" style="padding:14px 28px;font-size:15px;justify-content:center">🚀 Create Session</button>
        </form>
      </div>
    </div>`;
    res.send(renderPage('New Attendance Session', html, user, req));
  }));

  // ============================================================
  // ROUTE 5: POST /attendance/session/create — Save session
  // ============================================================
  app.post('/attendance/session/create', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { name, session_date, session_type } = req.body;
    if (!name || !name.trim() || !session_date) return res.redirect('/attendance/session/new');
    const token = genToken();
    const result = await pool.query(
      `INSERT INTO attendance_sessions (tenant_id, name, session_date, session_type, created_by, qr_token) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [tid, name.trim(), session_date, session_type || 'morning', user.id, token]
    );
    res.redirect('/attendance/session/' + result.rows[0].id);
  }));

  // ============================================================
  // ROUTE 6: GET /attendance/session/:id — Session detail + QR
  // ============================================================
  app.get('/attendance/session/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, sessionId = req.params.id;
    const session = (await pool.query(`SELECT * FROM attendance_sessions WHERE id=$1 AND tenant_id=$2`, [sessionId, tid])).rows[0];
    if (!session) return res.send(renderPage('Not Found', '<div class="card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">Session not found</h2><a href="/attendance/session/new" class="btn btn-blue btn-sm" style="margin-top:12px">← Sessions</a></div>', user, req));

    const checkins = (await pool.query(
      `SELECT ar.* FROM attendance_records ar JOIN attendance_sessions ase ON ase.id=ar.session_id WHERE ar.tenant_id=$1 AND ar.date=$2 AND ar.method='qr' ORDER BY ar.check_in DESC`,
      [tid, session.session_date]
    )).rows;

    // Also get all records for the session date (broader view)
    const allRecords = (await pool.query(
      `SELECT * FROM attendance_records WHERE tenant_id=$1 AND date=$2 ORDER BY check_in DESC LIMIT 100`,
      [tid, session.session_date]
    )).rows;

    const rowsHtml = allRecords.map(r => `<tr>
      <td><strong>${esc(r.person_name || 'ID ' + r.person_id)}</strong></td>
      <td>${r.person_type}</td>
      <td>${statusBadge(r.status)}</td>
      <td>${fmtTime(r.check_in)}</td>
      <td>${fmtTime(r.check_out)}</td>
      <td class="muted">${esc(r.method || 'manual')}</td>
    </tr>`).join('');

    // Inline SVG QR placeholder
    const qrSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180">
      <rect width="180" height="180" fill="#fff"/>
      <rect x="10" y="10" width="50" height="50" rx="4" fill="#1e293b"/><rect x="120" y="10" width="50" height="50" rx="4" fill="#1e293b"/><rect x="10" y="120" width="50" height="50" rx="4" fill="#1e293b"/>
      <rect x="18" y="18" width="34" height="34" rx="2" fill="#fff"/><rect x="128" y="18" width="34" height="34" rx="2" fill="#fff"/><rect x="18" y="128" width="34" height="34" rx="2" fill="#fff"/>
      <rect x="26" y="26" width="18" height="18" rx="1" fill="#4f46e5"/><rect x="136" y="26" width="18" height="18" rx="1" fill="#4f46e5"/><rect x="26" y="136" width="18" height="18" rx="1" fill="#4f46e5"/>
      <rect x="70" y="10" width="8" height="8" fill="#1e293b"/><rect x="86" y="10" width="8" height="8" fill="#1e293b"/><rect x="102" y="10" width="8" height="8" fill="#1e293b"/>
      <rect x="70" y="26" width="8" height="8" fill="#1e293b"/><rect x="94" y="26" width="8" height="8" fill="#1e293b"/><rect x="70" y="42" width="8" height="8" fill="#1e293b"/><rect x="86" y="42" width="8" height="8" fill="#1e293b"/>
      <rect x="10" y="70" width="8" height="8" fill="#1e293b"/><rect x="26" y="70" width="8" height="8" fill="#1e293b"/><rect x="42" y="70" width="8" height="8" fill="#1e293b"/><rect x="70" y="70" width="8" height="8" fill="#1e293b"/>
      <rect x="102" y="70" width="8" height="8" fill="#1e293b"/><rect x="118" y="70" width="8" height="8" fill="#1e293b"/><rect x="150" y="70" width="8" height="8" fill="#1e293b"/><rect x="162" y="70" width="8" height="8" fill="#1e293b"/>
      <rect x="10" y="86" width="8" height="8" fill="#1e293b"/><rect x="42" y="86" width="8" height="8" fill="#1e293b"/><rect x="86" y="86" width="8" height="8" fill="#1e293b"/><rect x="118" y="86" width="8" height="8" fill="#1e293b"/><rect x="134" y="86" width="8" height="8" fill="#1e293b"/><rect x="162" y="86" width="8" height="8" fill="#1e293b"/>
      <rect x="10" y="102" width="8" height="8" fill="#1e293b"/><rect x="26" y="102" width="8" height="8" fill="#1e293b"/><rect x="70" y="102" width="8" height="8" fill="#1e293b"/><rect x="94" y="102" width="8" height="8" fill="#1e293b"/><rect x="134" y="102" width="8" height="8" fill="#1e293b"/><rect x="150" y="102" width="8" height="8" fill="#1e293b"/>
      <rect x="70" y="118" width="8" height="8" fill="#1e293b"/><rect x="86" y="118" width="8" height="8" fill="#1e293b"/><rect x="118" y="118" width="8" height="8" fill="#1e293b"/><rect x="150" y="118" width="8" height="8" fill="#1e293b"/><rect x="162" y="118" width="8" height="8" fill="#1e293b"/>
      <rect x="70" y="134" width="8" height="8" fill="#1e293b"/><rect x="102" y="134" width="8" height="8" fill="#1e293b"/><rect x="118" y="134" width="8" height="8" fill="#1e293b"/><rect x="134" y="134" width="8" height="8" fill="#1e293b"/><rect x="162" y="134" width="8" height="8" fill="#1e293b"/>
      <rect x="70" y="150" width="8" height="8" fill="#1e293b"/><rect x="86" y="150" width="8" height="8" fill="#1e293b"/><rect x="102" y="150" width="8" height="8" fill="#1e293b"/><rect x="150" y="150" width="8" height="8" fill="#1e293b"/>
      <rect x="70" y="162" width="8" height="8" fill="#1e293b"/><rect x="118" y="162" width="8" height="8" fill="#1e293b"/><rect x="150" y="162" width="8" height="8" fill="#1e293b"/><rect x="162" y="162" width="8" height="8" fill="#1e293b"/>
      <text x="90" y="174" text-anchor="middle" font-size="8" fill="#94a3b8">QR CHECK-IN</text>
    </svg>`;

    const html = AT_CSS + `<div style="max-width:1100px;margin:0 auto">
      ${nav('sessions')}
      <a href="/attendance" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Dashboard</a>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px">
        <div class="card" style="padding:24px">
          <h2 style="margin:0 0 8px;color:#1e293b;font-size:20px">${esc(session.name)}</h2>
          <div style="font-size:13px;color:#64748b;margin-bottom:16px">
            <div>📅 ${fmtDate(session.session_date)} &nbsp;·&nbsp; 🕐 ${esc(session.session_type)}</div>
            <div>Token: <code style="background:#f1f5f9;padding:2px 8px;border-radius:4px;font-size:11px">${esc(session.qr_token)}</code></div>
            <div>Status: ${session.is_active ? '<span class="badge badge-success">Active</span>' : '<span class="badge badge-error">Inactive</span>'}</div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <a href="/attendance/session/new" class="at-btn at-btn-secondary btn-sm">+ New Session</a>
            ${session.is_active
              ? `<form method="POST" action="/attendance/session/${session.id}/toggle" style="display:inline"><button class="btn btn-red btn-sm">Deactivate</button></form>`
              : `<form method="POST" action="/attendance/session/${session.id}/toggle" style="display:inline"><button class="btn btn-green btn-sm">Activate</button></form>`}
          </div>
        </div>
        <div class="card" style="padding:24px;text-align:center">
          <h3 style="margin:0 0 8px;color:#1e293b;font-size:15px">QR Check-In Code</h3>
          <div class="at-qr">${qrSvg}</div>
          <p style="font-size:11px;color:#94a3b8;margin-top:8px">Token: ${esc(session.qr_token ? session.qr_token.substring(0, 20) + '...' : '—')}</p>
        </div>
      </div>
      <div class="card" style="padding:20px">
        <h3 style="font-size:15px;color:#1e293b;margin-bottom:14px">📋 Check-In List (${allRecords.length} records)</h3>
        <div style="overflow-x:auto"><table class="at-table">
          <thead><tr><th>Person</th><th>Type</th><th>Status</th><th>Check In</th><th>Check Out</th><th>Method</th></tr></thead>
          <tbody>${rowsHtml || '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:30px">No check-ins yet</td></tr>'}</tbody>
        </table></div>
      </div>
    </div>
    <script>setTimeout(()=>location.reload(),30000);</script>`;
    res.send(renderPage('Session — ' + session.name, html, user, req));
  }));

  // Session toggle (activate/deactivate) — support route
  app.post('/attendance/session/:id/toggle', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id, sid = req.params.id;
    await pool.query(`UPDATE attendance_sessions SET is_active = NOT is_active WHERE id=$1 AND tenant_id=$2`, [sid, tid]);
    res.redirect('/attendance/session/' + sid);
  }));

  // ============================================================
  // ROUTE 7: POST /attendance/qr-checkin — QR check-in endpoint
  // ============================================================
  app.post('/attendance/qr-checkin', ah(async (req, res) => {
    const { qr_token, person_id, person_name, person_type } = req.body;
    if (!qr_token || !person_id) return res.status(400).json({ error: 'Missing qr_token or person_id' });

    const session = (await pool.query(`SELECT * FROM attendance_sessions WHERE qr_token=$1 AND is_active=true`, [qr_token])).rows[0];
    if (!session) return res.status(404).json({ error: 'Invalid or inactive session token' });

    const existing = (await pool.query(
      `SELECT id FROM attendance_records WHERE tenant_id=$1 AND person_id=$2 AND date=$3 AND method='qr' LIMIT 1`,
      [session.tenant_id, person_id, session.session_date]
    )).rows[0];

    if (existing) {
      return res.json({ success: true, message: 'Already checked in', record_id: existing.id });
    }

    const result = await pool.query(
      `INSERT INTO attendance_records (tenant_id, person_id, person_name, person_type, date, check_in, status, method) VALUES ($1,$2,$3,$4,$5,NOW()::time,'present','qr') RETURNING id`,
      [session.tenant_id, person_id, person_name || 'Unknown', person_type || 'student', session.session_date]
    );
    res.json({ success: true, record_id: result.rows[0].id, message: 'Checked in successfully' });
  }));

  // ============================================================
  // ROUTE 8: GET /attendance/report — Reports
  // ============================================================
  app.get('/attendance/report', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { from, to, person_type } = req.query;
    const dateFrom = from || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const dateTo = to || today();

    let where = ['ar.tenant_id=$1', 'ar.date >= $2', 'ar.date <= $3'], params = [tid, dateFrom, dateTo], pi = 4;
    if (person_type) { where.push(`ar.person_type=$${pi++}`); params.push(person_type); }

    const records = (await pool.query(`SELECT ar.* FROM attendance_records ar WHERE ${where.join(' AND ')} ORDER BY ar.date DESC, ar.person_name`, params)).rows;
    const summary = (await pool.query(
      `SELECT ar.status, COUNT(*)::int as cnt FROM attendance_records ar WHERE ${where.join(' AND ')} GROUP BY ar.status ORDER BY cnt DESC`,
      params
    )).rows;

    const total = summary.reduce((s, r) => s + r.cnt, 0);
    const presentCnt = summary.filter(r => r.status !== 'absent').reduce((s, r) => s + r.cnt, 0);
    const overallRate = total > 0 ? Math.round(presentCnt / total * 100) : 0;

    // Daily breakdown for chart
    const daily = (await pool.query(
      `SELECT ar.date, COUNT(*)::int as total, COUNT(*) FILTER (WHERE ar.status IN ('present','late'))::int as present_count FROM attendance_records ar WHERE ${where.join(' AND ')} GROUP BY ar.date ORDER BY ar.date`,
      params
    )).rows;

    const barChart = daily.map(d => {
      const rate = d.total > 0 ? Math.round(d.present_count / d.total * 100) : 0;
      const color = rate >= 80 ? '#16a34a' : rate >= 50 ? '#f59e0b' : '#dc2626';
      return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <span style="font-size:11px;color:#64748b;min-width:80px">${fmtDate(d.date)}</span>
        <div style="flex:1;background:#f1f5f9;border-radius:6px;height:22px;overflow:hidden;position:relative">
          <div style="height:100%;width:${rate}%;background:${color};border-radius:6px;transition:.3s"></div>
          <span style="position:absolute;right:6px;top:3px;font-size:11px;font-weight:700;color:#1e293b">${rate}%</span>
        </div>
        <span style="font-size:11px;color:#94a3b8;min-width:60px">${d.present_count}/${d.total}</span>
      </div>`;
    }).join('');

    const summaryHtml = summary.map(s => `<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
      ${statusBadge(s.status)}<span style="flex:1;font-size:13px;color:#475569">${s.cnt} records</span>
      <span style="font-size:12px;font-weight:700;color:#1e293b">${total > 0 ? Math.round(s.cnt / total * 100) : 0}%</span>
    </div>`).join('');

    const html = AT_CSS + `<div style="max-width:1100px;margin:0 auto">
      ${nav('reports')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">📈 Attendance Reports</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Analyze attendance trends over time</p></div>
        <a href="/attendance/report/export?from=${esc(dateFrom)}&to=${esc(dateTo)}${person_type ? '&person_type=' + person_type : ''}" class="at-btn at-btn-success">📥 Export CSV</a>
      </div>
      <div class="stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;margin-bottom:20px">
        <div class="stat-card"><div class="stat-num" style="color:#4f46e5">${total}</div><div class="muted" style="font-size:11px">Total Records</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#16a34a">${overallRate}%</div><div class="muted" style="font-size:11px">Overall Rate</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#3b82f6">${daily.length}</div><div class="muted" style="font-size:11px">Days Covered</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${records.length}</div><div class="muted" style="font-size:11px">Rows in Range</div></div>
      </div>
      <div class="at-filter">
        <div><label>From</label><input type="date" value="${esc(dateFrom)}" onchange="location.href='/attendance/report?from='+this.value+'&to=${esc(dateTo)}'"></div>
        <div><label>To</label><input type="date" value="${esc(dateTo)}" onchange="location.href='/attendance/report?from=${esc(dateFrom)}&to='+this.value"></div>
        <div><label>Type</label><select onchange="location.href='/attendance/report?from=${esc(dateFrom)}&to=${esc(dateTo)}&person_type='+this.value">
          <option value="">All</option><option value="student" ${person_type==='student'?'selected':''}>Student</option><option value="staff" ${person_type==='staff'?'selected':''}>Staff</option><option value="teacher" ${person_type==='teacher'?'selected':''}>Teacher</option>
        </select></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
        <div class="card" style="padding:20px">
          <h3 style="font-size:15px;color:#1e293b;margin-bottom:14px">Status Summary</h3>
          ${summaryHtml || '<p class="muted" style="font-size:13px">No data for this range</p>'}
        </div>
        <div class="card" style="padding:20px">
          <h3 style="font-size:15px;color:#1e293b;margin-bottom:14px">Daily Attendance Rate</h3>
          ${barChart || '<p class="muted" style="font-size:13px">No daily data available</p>'}
        </div>
      </div>
      <div class="card" style="padding:20px">
        <h3 style="font-size:15px;color:#1e293b;margin-bottom:14px">📋 All Records (${records.length})</h3>
        <div style="overflow-x:auto"><table class="at-table">
          <thead><tr><th>Person</th><th>Type</th><th>Date</th><th>Status</th><th>Check In</th><th>Check Out</th><th>Method</th></tr></thead>
          <tbody>${records.slice(0, 100).map(r => `<tr>
            <td><strong>${esc(r.person_name || 'ID ' + r.person_id)}</strong></td>
            <td>${r.person_type}</td><td>${fmtDate(r.date)}</td><td>${statusBadge(r.status)}</td>
            <td>${fmtTime(r.check_in)}</td><td>${fmtTime(r.check_out)}</td><td class="muted">${esc(r.method)}</td>
          </tr>`).join('') || '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:30px">No records found</td></tr>'}</tbody>
        </table></div>
      </div>
    </div>`;
    res.send(renderPage('Attendance Reports', html, user, req));
  }));

  // ============================================================
  // ROUTE 9: GET /attendance/report/export — CSV export
  // ============================================================
  app.get('/attendance/report/export', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { from, to, person_type } = req.query;
    const dateFrom = from || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const dateTo = to || today();

    let where = ['ar.tenant_id=$1', 'ar.date >= $2', 'ar.date <= $3'], params = [tid, dateFrom, dateTo], pi = 4;
    if (person_type) { where.push(`ar.person_type=$${pi++}`); params.push(person_type); }

    const records = (await pool.query(`SELECT ar.* FROM attendance_records ar WHERE ${where.join(' AND ')} ORDER BY ar.date, ar.person_name`, params)).rows;
    const header = ['ID', 'Person ID', 'Person Name', 'Type', 'Date', 'Check In', 'Check Out', 'Status', 'Method', 'Location', 'Notes', 'Created At'];
    let csv = header.map(h => '"' + h.replace(/"/g, '""') + '"').join(',') + '\n';
    records.forEach(r => {
      csv += [r.id, r.person_id, r.person_name || '', r.person_type || '', r.date, fmtTime(r.check_in), fmtTime(r.check_out), r.status || '', r.method || '', r.location || '', (r.notes || '').replace(/"/g, '""'), fmtDateTime(r.created_at)]
        .map(v => '"' + String(v || '').replace(/"/g, '""') + '"').join(',') + '\n';
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="attendance-report-${dateFrom}-to-${dateTo}.csv"`);
    res.send(csv);
  }));

  // ============================================================
  // ROUTE 10: GET /attendance/exceptions — Exception management
  // ============================================================
  app.get('/attendance/exceptions', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { status: filterStatus } = req.query;

    let where = ['tenant_id=$1'], params = [tid], pi = 2;
    if (filterStatus) { where.push(`status=$${pi++}`); params.push(filterStatus); }

    const exceptions = (await pool.query(
      `SELECT ae.*, u.email as approver_email FROM attendance_exceptions ae LEFT JOIN users u ON u.id=ae.approved_by WHERE ${where.join(' AND ')} ORDER BY ae.created_at DESC`,
      params
    )).rows;

    const pending = exceptions.filter(e => e.status === 'pending').length;
    const approved = exceptions.filter(e => e.status === 'approved').length;
    const rejected = exceptions.filter(e => e.status === 'rejected').length;

    const rowsHtml = exceptions.map(e => `<tr>
      <td><strong>${esc(e.person_name || 'ID ' + e.person_id)}</strong></td>
      <td>${e.person_type || '—'}</td>
      <td>${e.type || 'leave'}</td>
      <td>${fmtDate(e.start_date)} ${e.end_date && e.end_date !== e.start_date ? '→ ' + fmtDate(e.end_date) : ''}</td>
      <td>${statusBadge(e.status)}</td>
      <td class="muted">${esc((e.reason || '').substring(0, 60))}</td>
      <td>${esc(e.approver_email || '—')}</td>
      <td style="white-space:nowrap">
        ${e.status === 'pending' ? `
          <form method="POST" action="/attendance/exceptions/${e.id}/approve" style="display:inline">
            <input type="hidden" name="action" value="approve"><button class="btn btn-green btn-sm">✓</button>
          </form>
          <form method="POST" action="/attendance/exceptions/${e.id}/approve" style="display:inline">
            <input type="hidden" name="action" value="reject"><button class="btn btn-red btn-sm">✕</button>
          </form>
        ` : '—'}
      </td>
    </tr>`).join('');

    const html = AT_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('exceptions')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">📋 Leave &amp; Absence Management</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Manage exceptions, leave requests, and approvals</p></div>
        <a href="#add-form" class="at-btn at-btn-primary">+ Add Exception</a>
      </div>
      <div class="stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;margin-bottom:20px">
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${pending}</div><div class="muted" style="font-size:11px">Pending</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#16a34a">${approved}</div><div class="muted" style="font-size:11px">Approved</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#dc2626">${rejected}</div><div class="muted" style="font-size:11px">Rejected</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#4f46e5">${exceptions.length}</div><div class="muted" style="font-size:11px">Total</div></div>
      </div>
      <div class="at-filter">
        <div><label>Status</label><select onchange="location.href='/attendance/exceptions?status='+this.value">
          <option value="">All</option><option value="pending" ${filterStatus==='pending'?'selected':''}>Pending</option><option value="approved" ${filterStatus==='approved'?'selected':''}>Approved</option><option value="rejected" ${filterStatus==='rejected'?'selected':''}>Rejected</option>
        </select></div>
      </div>
      <div class="card" style="padding:20px;margin-bottom:20px">
        <div style="overflow-x:auto"><table class="at-table">
          <thead><tr><th>Person</th><th>Type</th><th>Exception</th><th>Dates</th><th>Status</th><th>Reason</th><th>Approved By</th><th>Actions</th></tr></thead>
          <tbody>${rowsHtml || '<tr><td colspan="8" style="text-align:center;color:#94a3b8;padding:30px">No exceptions found</td></tr>'}</tbody>
        </table></div>
      </div>
      <div class="card" style="padding:24px" id="add-form">
        <h3 style="font-size:15px;color:#1e293b;margin-bottom:14px">➕ Add Exception / Leave Request</h3>
        <form method="POST" action="/attendance/exceptions/add" style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
          <div><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Person Name *</label>
            <input type="text" name="person_name" required placeholder="Full name" style="width:100%;padding:9px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
          <div><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Person Type</label>
            <select name="person_type" style="width:100%;padding:9px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"><option value="student">Student</option><option value="staff">Staff</option><option value="teacher">Teacher</option></select></div>
          <div><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Start Date *</label>
            <input type="date" name="start_date" required value="${today()}" style="width:100%;padding:9px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
          <div><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">End Date</label>
            <input type="date" name="end_date" value="${today()}" style="width:100%;padding:9px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
          <div><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Exception Type</label>
            <select name="type" style="width:100%;padding:9px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"><option value="leave">Leave</option><option value="sick">Sick</option><option value="holiday">Holiday</option><option value="suspension">Suspension</option><option value="other">Other</option></select></div>
          <div><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Reason</label>
            <input type="text" name="reason" placeholder="Reason for exception" style="width:100%;padding:9px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
          <div style="grid-column:1/-1"><button type="submit" class="btn btn-blue" style="padding:11px 28px;font-size:14px;font-weight:600">💾 Submit Exception</button></div>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Attendance Exceptions', html, user, req));
  }));

  // ============================================================
  // ROUTE 11: POST /attendance/exceptions/add — Add exception
  // ============================================================
  app.post('/attendance/exceptions/add', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { person_id, person_name, person_type, start_date, end_date, type, reason } = req.body;
    if (!start_date || !person_name) return res.redirect('/attendance/exceptions');
    await pool.query(
      `INSERT INTO attendance_exceptions (tenant_id, person_id, person_name, person_type, start_date, end_date, type, reason, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending')`,
      [tid, person_id || null, person_name, person_type || 'student', start_date, end_date || start_date, type || 'leave', (reason || '').trim()]
    );
    res.redirect('/attendance/exceptions');
  }));

  // ============================================================
  // ROUTE 12: POST /attendance/exceptions/:id/approve — Approve/reject
  // ============================================================
  app.post('/attendance/exceptions/:id/approve', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const exceptionId = req.params.id;
    const { action } = req.body;
    const newStatus = action === 'approve' ? 'approved' : 'rejected';
    if (!['approved', 'rejected'].includes(newStatus)) return res.redirect('/attendance/exceptions');

    const exception = (await pool.query(`SELECT * FROM attendance_exceptions WHERE id=$1 AND tenant_id=$2`, [exceptionId, tid])).rows[0];
    if (!exception) return res.redirect('/attendance/exceptions');

    await pool.query(`UPDATE attendance_exceptions SET status=$1, approved_by=$2 WHERE id=$3 AND tenant_id=$4`, [newStatus, user.id, exceptionId, tid]);

    // If approved, create absent records for each day in the exception range
    if (newStatus === 'approved') {
      const startDate = new Date(exception.start_date);
      const endDate = new Date(exception.end_date || exception.start_date);
      for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().slice(0, 10);
        const existing = (await pool.query(
          `SELECT id FROM attendance_records WHERE tenant_id=$1 AND person_id=$2 AND date=$3 LIMIT 1`,
          [tid, exception.person_id, dateStr]
        )).rows[0];
        if (!existing && exception.person_id) {
          await pool.query(
            `INSERT INTO attendance_records (tenant_id, person_id, person_name, person_type, date, status, method, notes) VALUES ($1,$2,$3,$4,$5,'excused','exception',$6)`,
            [tid, exception.person_id, exception.person_name, exception.person_type, dateStr, exception.type + ': ' + (exception.reason || '')]
          );
        }
      }
    }
    res.redirect('/attendance/exceptions');
  }));

  // ============================================================
  // ROUTE 13: GET /api/attendance/stats — JSON API dashboard stats
  // ============================================================
  app.get('/api/attendance/stats', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const dateFilter = req.query.date || today();

    const todayRows = (await pool.query(
      `SELECT status, COUNT(*)::int as cnt FROM attendance_records WHERE tenant_id=$1 AND date=$2 GROUP BY status`, [tid, dateFilter]
    )).rows;
    const totalToday = todayRows.reduce((s, r) => s + r.cnt, 0);
    const presentToday = todayRows.filter(r => r.status !== 'absent').reduce((s, r) => s + r.cnt, 0);

    const weekRows = (await pool.query(
      `SELECT COUNT(*)::int as total, COUNT(*) FILTER (WHERE status IN ('present','late'))::int as attended FROM attendance_records WHERE tenant_id=$1 AND date >= date_trunc('week', CURRENT_DATE)`,
      [tid]
    )).rows[0];

    const monthRows = (await pool.query(
      `SELECT COUNT(*)::int as total, COUNT(*) FILTER (WHERE status IN ('present','late'))::int as attended FROM attendance_records WHERE tenant_id=$1 AND date >= date_trunc('month', CURRENT_DATE)`,
      [tid]
    )).rows[0];

    const activeSessions = (await pool.query(
      `SELECT COUNT(*)::int as cnt FROM attendance_sessions WHERE tenant_id=$1 AND is_active=true AND session_date=$2`, [tid, dateFilter]
    )).rows[0].cnt;

    const pendingExceptions = (await pool.query(
      `SELECT COUNT(*)::int as cnt FROM attendance_exceptions WHERE tenant_id=$1 AND status='pending'`, [tid]
    )).rows[0].cnt;

    res.json({
      date: dateFilter,
      today: { total: totalToday, attended: presentToday, rate: totalToday > 0 ? Math.round(presentToday / totalToday * 100) : 0, by_status: todayRows },
      weekly: { total: weekRows.total, attended: weekRows.attended, rate: weekRows.total > 0 ? Math.round(weekRows.attended / weekRows.total * 100) : 0 },
      monthly: { total: monthRows.total, attended: monthRows.attended, rate: monthRows.total > 0 ? Math.round(monthRows.attended / monthRows.total * 100) : 0 },
      active_sessions: activeSessions,
      pending_exceptions: pendingExceptions
    });
  }));

  // ============================================================
  // ROUTE 14: GET /api/attendance/today — JSON API today's list
  // ============================================================
  app.get('/api/attendance/today', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const dateFilter = req.query.date || today();
    const { person_type, status } = req.query;

    let where = ['tenant_id=$1', 'date=$2'], params = [tid, dateFilter], pi = 3;
    if (person_type) { where.push(`person_type=$${pi++}`); params.push(person_type); }
    if (status) { where.push(`status=$${pi++}`); params.push(status); }

    const records = (await pool.query(
      `SELECT id, person_id, person_name, person_type, check_in, check_out, status, method, location, notes, created_at FROM attendance_records WHERE ${where.join(' AND ')} ORDER BY check_in DESC`,
      params
    )).rows;

    res.json({ date: dateFilter, count: records.length, records });
  }));

  console.log('[Attendance] Attendance tracker loaded');
};
