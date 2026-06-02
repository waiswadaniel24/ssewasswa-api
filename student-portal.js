// ============================================================
// STUDENT PORTAL MODULE — Multi-Tenant SaaS Platform
// Student self-service portal for viewing grades, attendance,
// timetable, fees, assignments, submissions, profile, and
// notifications.
// ============================================================
// Usage in server.js:
//   const studentPortal = require('./student-portal');
//   studentPortal(app, db, pool, renderPage, esc);
// ============================================================

'use strict';

// ============================================================
// MODULE ENTRY POINT
// ============================================================
const { migrateQuery } = require('./db');
module.exports = function studentPortal(app, db, pool, renderPage, esc) {

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
  const fmtMoney = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtPct = (n) => Math.round(Number(n || 0));

  // Helper: resolve student record for current user
  const resolveStudent = async (user) => {
    // Try email match first, then user id match
    let student = null;
    try {
      student = (await pool.query(`SELECT * FROM students WHERE tenant_id=$1 AND email=$2 LIMIT 1`, [user.tenant_id, user.email])).rows[0];
    } catch(e){}
    if (!student) {
      try {
        student = (await pool.query(`SELECT * FROM students WHERE tenant_id=$1 AND user_id=$2 LIMIT 1`, [user.tenant_id, user.id])).rows[0];
      } catch(e){}
    }
    return student;
  };

  function gradeColor(g) {
    if (g >= 80) return '#16a34a';
    if (g >= 70) return '#059669';
    if (g >= 60) return '#f59e0b';
    if (g >= 50) return '#f97316';
    return '#dc2626';
  }

  function statusBadge(s) {
    const m = {
      submitted: { cls: 'badge-success', label: 'Submitted' },
      pending: { cls: 'badge-warning', label: 'Pending' },
      graded: { cls: 'badge', label: 'Graded', style: 'background:#dbeafe;color:#1d4ed8' },
      late: { cls: 'badge-error', label: 'Late' },
      returned: { cls: 'badge', label: 'Returned', style: 'background:#ede9fe;color:#6d28d9' },
    };
    const v = m[s] || { cls: 'badge', label: s };
    return `<span class="badge ${v.cls}" ${v.style ? 'style="' + v.style + '"' : ''}>${v.label}</span>`;
  }

  // -- shared CSS --------------------------------------------------------
  const SP_CSS = `<style>
    .sp-nav{display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap}
    .sp-nav a{padding:8px 18px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#475569;background:#f1f5f9;transition:.15s}
    .sp-nav a:hover{background:#e2e8f0}.sp-nav a.active{background:#4f46e5;color:#fff}
    .sp-btn{display:inline-flex;align-items:center;gap:6px;padding:9px 18px;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:.15s}
    .sp-btn:hover{opacity:.9;transform:translateY(-1px)}
    .sp-btn-primary{background:#4f46e5;color:#fff}.sp-btn-success{background:#059669;color:#fff}
    .sp-btn-danger{background:#fee2e2;color:#dc2626}.sp-btn-secondary{background:#f1f5f9;color:#475569}
    .sp-table{width:100%;border-collapse:collapse;font-size:13px}
    .sp-table th{padding:11px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#f8fafc}
    .sp-table td{padding:10px 14px;border-bottom:1px solid #f1f5f9;color:#1e293b}
    .sp-table tr:hover{background:#f8fafc}
    .sp-card{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:20px;transition:.2s}
    .sp-card:hover{box-shadow:0 4px 16px rgba(0,0,0,.06);transform:translateY(-2px)}
    .sp-info-row{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #f1f5f9;font-size:13px}
    .sp-info-label{color:#64748b;font-weight:600}.sp-info-value{color:#1e293b;font-weight:700}
    .sp-timetable{display:grid;grid-template-columns:80px repeat(5,1fr);gap:2px;font-size:12px}
    .sp-timetable .time-slot{background:#f8fafc;padding:8px;text-align:center;color:#64748b;font-weight:600;border-radius:4px}
    .sp-timetable .day-header{background:#4f46e5;color:#fff;padding:8px;text-align:center;font-weight:700;border-radius:4px}
    .sp-timetable .cell{background:#fff;padding:6px;border:1px solid #f1f5f9;border-radius:4px;min-height:48px;font-size:11px}
    .sp-timetable .cell.filled{background:#eef2ff;border-color:#c7d2fe}
    .sp-timetable .cell.filled .subj{font-weight:700;color:#4338ca}
    .sp-timetable .cell.filled .room{color:#64748b;font-size:10px}
    .sp-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
    @media(max-width:768px){.sp-nav{gap:4px}.sp-nav a{padding:6px 12px;font-size:12px}.sp-timetable{grid-template-columns:60px repeat(5,1fr);font-size:10px}.sp-form-grid{grid-template-columns:1fr}}
  </style>`;

  // -- navigation helper --------------------------------------------------
  const nav = (active) => `<div class="sp-nav">
    <a href="/portal" class="${active === 'dash' ? 'active' : ''}">🏠 Dashboard</a>
    <a href="/portal/grades" class="${active === 'grades' ? 'active' : ''}">🎓 Grades</a>
    <a href="/portal/attendance" class="${active === 'attendance' ? 'active' : ''}">📅 Attendance</a>
    <a href="/portal/timetable" class="${active === 'timetable' ? 'active' : ''}">🕐 Timetable</a>
    <a href="/portal/fees" class="${active === 'fees' ? 'active' : ''}">💰 Fees</a>
    <a href="/portal/assignments" class="${active === 'assignments' ? 'active' : ''}">📝 Assignments</a>
    <a href="/portal/profile" class="${active === 'profile' ? 'active' : ''}">👤 Profile</a>
    <a href="/portal/notifications" class="${active === 'notifications' ? 'active' : ''}">🔔 Notifications</a>
  </div>`;

  // ============================================================
  // DATABASE MIGRATIONS (async IIFE)
  // ============================================================
  (async () => {
    try {
      await migrateQuery(pool, 'StudentPortal', `CREATE TABLE IF NOT EXISTS student_submissions (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        student_id INTEGER NOT NULL, assignment_id INTEGER, assignment_title VARCHAR(255),
        subject VARCHAR(100), content TEXT, file_url TEXT,
        status VARCHAR(20) DEFAULT 'submitted', grade DECIMAL(5,2),
        feedback TEXT, submitted_at TIMESTAMPTZ DEFAULT NOW(),
        graded_at TIMESTAMPTZ
      )`);
      const ssCols = [
        ['student_id','INTEGER NOT NULL'],['assignment_id','INTEGER'],['assignment_title','VARCHAR(255)'],
        ['subject','VARCHAR(100)'],['content','TEXT'],['file_url','TEXT'],
        ['status',"VARCHAR(20) DEFAULT 'submitted'"],['grade','DECIMAL(5,2)'],
        ['feedback','TEXT'],['submitted_at','TIMESTAMPTZ DEFAULT NOW()'],['graded_at','TIMESTAMPTZ']
      ];
      for (const [col, def] of ssCols) { try { await migrateQuery(pool, 'StudentPortal', `ALTER TABLE student_submissions ADD COLUMN IF NOT EXISTS ${col} ${def}`); } catch(e){} }
      await migrateQuery(pool, 'StudentPortal', `CREATE INDEX IF NOT EXISTS idx_ssub_tenant ON student_submissions(tenant_id)`);
      await migrateQuery(pool, 'StudentPortal', `CREATE INDEX IF NOT EXISTS idx_ssub_student ON student_submissions(student_id)`);
      await migrateQuery(pool, 'StudentPortal', `CREATE INDEX IF NOT EXISTS idx_ssub_status ON student_submissions(tenant_id, status)`);
      console.log('[StudentPortal] Migrations applied successfully');
    } catch (e) { /* migration OK */ }
  })();

  // ============================================================
  // ROUTE 1: GET /portal — Student Dashboard
  // ============================================================
  app.get('/portal', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const student = await resolveStudent(user);

    if (!student) {
      const html = SP_CSS + `<div style="max-width:600px;margin:40px auto;text-align:center">
        <div style="font-size:48px;margin-bottom:16px">🎓</div>
        <h1 style="font-size:22px;color:#1e293b;margin-bottom:8px">Student Portal</h1>
        <p style="font-size:14px;color:#64748b;margin-bottom:20px">No student profile found linked to your account (${esc(user.email)}). Please contact your administrator.</p>
        <a href="/" class="sp-btn sp-btn-secondary">← Back to Home</a>
      </div>`;
      return res.send(renderPage('Student Portal', html, user, req));
    }

    // Fetch grades summary
    let grades = [];
    try { grades = (await pool.query(`SELECT m.*, s.name as subject_name FROM marks m LEFT JOIN subjects s ON s.id=m.subject_id WHERE m.tenant_id=$1 AND m.student_id=$2 ORDER BY m.created_at DESC LIMIT 20`, [tid, student.id])).rows; } catch(e){}
    const avgGrade = grades.length > 0 ? Math.round(grades.reduce((s, g) => s + Number(g.grade || 0), 0) / grades.length) : 0;

    // Fetch attendance
    let attendanceRecords = [];
    try { attendanceRecords = (await pool.query(`SELECT * FROM attendance WHERE tenant_id=$1 AND student_id=$2 ORDER BY date DESC LIMIT 30`, [tid, student.id])).rows; } catch(e){
      try { attendanceRecords = (await pool.query(`SELECT * FROM attendance_records WHERE tenant_id=$1 AND person_id=$2 ORDER BY date DESC LIMIT 30`, [tid, student.id])).rows; } catch(e2){}
    }
    const presentCount = attendanceRecords.filter(r => r.status === 'present' || r.status === 'late').length;
    const attendanceRate = attendanceRecords.length > 0 ? Math.round(presentCount / attendanceRecords.length * 100) : 0;

    // Fetch fee balance
    let feeBalance = 0, totalFees = 0;
    try {
      const fees = (await pool.query(`SELECT * FROM fees WHERE tenant_id=$1 AND student_id=$2`, [tid, student.id])).rows;
      totalFees = fees.reduce((s, f) => s + Number(f.amount || 0), 0);
      feeBalance = fees.reduce((s, f) => s + Number(f.balance || f.amount || 0), 0);
    } catch(e){}

    // Fetch submissions
    let submissions = [];
    try { submissions = (await pool.query(`SELECT * FROM student_submissions WHERE tenant_id=$1 AND student_id=$2 ORDER BY submitted_at DESC LIMIT 5`, [tid, student.id])).rows; } catch(e){}

    const submissionsHtml = submissions.map(s => `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f1f5f9">
      <div>
        <div style="font-size:13px;font-weight:600;color:#1e293b">${esc(s.assignment_title || 'Assignment')}</div>
        <div style="font-size:11px;color:#64748b">${esc(s.subject || '')} · ${fmtDate(s.submitted_at)}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        ${statusBadge(s.status)}
        ${s.grade != null ? `<span style="font-weight:700;color:${gradeColor(s.grade)}">${s.grade}%</span>` : ''}
      </div>
    </div>`).join('');

    const html = SP_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('dash')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div>
          <h1 style="font-size:24px;color:#1e293b">🏠 Welcome, ${esc(student.first_name || student.name || 'Student')}</h1>
          <p style="font-size:13px;color:#94a3b8;margin-top:2px">${esc(student.class_name || student.student_class || '')} · ${esc(student.admission_number || '')}</p>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:20px">
        <div class="sp-card" style="text-align:center">
          <div style="font-size:32px;font-weight:800;color:#4f46e5">${avgGrade}%</div>
          <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.5px;font-weight:600;margin-top:4px">Average Grade</div>
        </div>
        <div class="sp-card" style="text-align:center">
          <div style="font-size:32px;font-weight:800;color:#16a34a">${attendanceRate}%</div>
          <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.5px;font-weight:600;margin-top:4px">Attendance Rate</div>
        </div>
        <div class="sp-card" style="text-align:center">
          <div style="font-size:32px;font-weight:800;color:#dc2626">${fmtMoney(feeBalance)}</div>
          <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.5px;font-weight:600;margin-top:4px">Fee Balance</div>
        </div>
        <div class="sp-card" style="text-align:center">
          <div style="font-size:32px;font-weight:800;color:#3b82f6">${grades.length}</div>
          <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.5px;font-weight:600;margin-top:4px">Grade Entries</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
        <div class="sp-card">
          <h3 style="font-size:15px;color:#1e293b;margin-bottom:12px">📝 Recent Submissions</h3>
          ${submissionsHtml || '<p class="muted" style="font-size:13px">No submissions yet</p>'}
        </div>
        <div class="sp-card">
          <h3 style="font-size:15px;color:#1e293b;margin-bottom:12px">⚡ Quick Actions</h3>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <a href="/portal/grades" class="sp-btn sp-btn-secondary" style="justify-content:center">🎓 View Grades</a>
            <a href="/portal/attendance" class="sp-btn sp-btn-secondary" style="justify-content:center">📅 Attendance</a>
            <a href="/portal/timetable" class="sp-btn sp-btn-secondary" style="justify-content:center">🕐 Timetable</a>
            <a href="/portal/fees" class="sp-btn sp-btn-secondary" style="justify-content:center">💰 Fees</a>
            <a href="/portal/assignments" class="sp-btn sp-btn-primary" style="justify-content:center">📝 Assignments</a>
            <a href="/portal/profile" class="sp-btn sp-btn-secondary" style="justify-content:center">👤 Profile</a>
          </div>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Student Portal', html, user, req));
  }));

  // ============================================================
  // ROUTE 2: GET /portal/grades — View grades
  // ============================================================
  app.get('/portal/grades', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const student = await resolveStudent(user);
    if (!student) return res.redirect('/portal');

    let grades = [];
    try { grades = (await pool.query(`SELECT m.*, s.name as subject_name FROM marks m LEFT JOIN subjects s ON s.id=m.subject_id WHERE m.tenant_id=$1 AND m.student_id=$2 ORDER BY m.created_at DESC`, [tid, student.id])).rows; } catch(e){}

    const avgGrade = grades.length > 0 ? Math.round(grades.reduce((s, g) => s + Number(g.grade || 0), 0) / grades.length) : 0;
    const highest = grades.length > 0 ? Math.max(...grades.map(g => Number(g.grade || 0))) : 0;
    const lowest = grades.length > 0 ? Math.min(...grades.map(g => Number(g.grade || 0))) : 0;

    // Subject average chart
    const subjectAvgs = {};
    grades.forEach(g => {
      const subj = g.subject_name || g.subject || 'Unknown';
      if (!subjectAvgs[subj]) subjectAvgs[subj] = [];
      subjectAvgs[subj].push(Number(g.grade || 0));
    });
    const subjChartData = Object.entries(subjectAvgs).map(([subj, vals]) => ({
      label: subj, value: Math.round(vals.reduce((s, v) => s + v, 0) / vals.length)
    }));
    const maxSubjAvg = Math.max(...subjChartData.map(d => d.value), 1);

    const chartHtml = subjChartData.map(d => {
      const pct = Math.round(d.value / maxSubjAvg * 100);
      return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <span style="font-size:11px;color:#64748b;min-width:100px">${esc(d.label)}</span>
        <div style="flex:1;background:#f1f5f9;border-radius:6px;height:22px;overflow:hidden;position:relative">
          <div style="height:100%;width:${pct}%;background:${gradeColor(d.value)};border-radius:6px"></div>
          <span style="position:absolute;right:6px;top:3px;font-size:11px;font-weight:700;color:#1e293b">${d.value}%</span>
        </div>
      </div>`;
    }).join('');

    const gradesHtml = grades.map(g => `<tr>
      <td><strong>${esc(g.subject_name || g.subject || '—')}</strong></td>
      <td>${esc(g.exam_type || g.exam_name || '—')}</td>
      <td>${esc(g.term || g.semester || '—')}</td>
      <td><span style="font-weight:700;color:${gradeColor(g.grade)};font-size:15px">${Number(g.grade || 0)}%</span></td>
      <td>${fmtDate(g.created_at)}</td>
    </tr>`).join('');

    const html = SP_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('grades')}
      <h1 style="font-size:24px;color:#1e293b;margin-bottom:20px">🎓 My Grades</h1>
      <div class="stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-bottom:20px">
        <div class="stat-card"><div class="stat-num" style="color:#4f46e5">${avgGrade}%</div><div class="muted" style="font-size:11px">Average</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#16a34a">${highest}%</div><div class="muted" style="font-size:11px">Highest</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#dc2626">${lowest}%</div><div class="muted" style="font-size:11px">Lowest</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#3b82f6">${grades.length}</div><div class="muted" style="font-size:11px">Total Entries</div></div>
      </div>
      <div class="card" style="padding:20px;margin-bottom:16px">
        <h3 style="font-size:15px;color:#1e293b;margin-bottom:14px">Average by Subject</h3>
        ${chartHtml || '<p class="muted" style="font-size:13px">No grade data available</p>'}
      </div>
      <div class="card" style="padding:20px">
        <h3 style="font-size:15px;color:#1e293b;margin-bottom:14px">📋 All Grade Records</h3>
        <div style="overflow-x:auto"><table class="sp-table">
          <thead><tr><th>Subject</th><th>Exam Type</th><th>Term</th><th>Grade</th><th>Date</th></tr></thead>
          <tbody>${gradesHtml || '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:30px">No grades recorded yet</td></tr>'}</tbody>
        </table></div>
      </div>
    </div>`;
    res.send(renderPage('My Grades', html, user, req));
  }));

  // ============================================================
  // ROUTE 3: GET /portal/attendance — View attendance
  // ============================================================
  app.get('/portal/attendance', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const student = await resolveStudent(user);
    if (!student) return res.redirect('/portal');

    let records = [];
    try { records = (await pool.query(`SELECT * FROM attendance WHERE tenant_id=$1 AND student_id=$2 ORDER BY date DESC LIMIT 60`, [tid, student.id])).rows; } catch(e){
      try { records = (await pool.query(`SELECT * FROM attendance_records WHERE tenant_id=$1 AND person_id=$2 ORDER BY date DESC LIMIT 60`, [tid, student.id])).rows; } catch(e2){}
    }

    const presentCount = records.filter(r => r.status === 'present' || r.status === 'late').length;
    const absentCount = records.filter(r => r.status === 'absent').length;
    const lateCount = records.filter(r => r.status === 'late').length;
    const rate = records.length > 0 ? Math.round(presentCount / records.length * 100) : 0;

    // Weekly breakdown
    const weeklyData = {};
    records.forEach(r => {
      const week = r.date ? new Date(r.date).toISOString().slice(0, 10) : 'unknown';
      const weekStart = new Date(r.date).getDay();
      if (!weeklyData[week]) weeklyData[week] = { total: 0, present: 0 };
      weeklyData[week].total++;
      if (r.status === 'present' || r.status === 'late') weeklyData[week].present++;
    });
    const weeklyChart = Object.entries(weeklyData).slice(-8).map(([w, d]) => {
      const pct = d.total > 0 ? Math.round(d.present / d.total * 100) : 0;
      return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <span style="font-size:11px;color:#64748b;min-width:80px">${fmtDate(w)}</span>
        <div style="flex:1;background:#f1f5f9;border-radius:6px;height:20px;overflow:hidden;position:relative">
          <div style="height:100%;width:${pct}%;background:${pct >= 80 ? '#16a34a' : pct >= 50 ? '#f59e0b' : '#dc2626'};border-radius:6px"></div>
          <span style="position:absolute;right:6px;top:2px;font-size:10px;font-weight:700;color:#1e293b">${pct}%</span>
        </div>
      </div>`;
    }).join('');

    const rowsHtml = records.map(r => `<tr>
      <td>${fmtDate(r.date)}</td>
      <td>${r.status === 'present' ? '<span class="badge badge-success">Present</span>' : r.status === 'absent' ? '<span class="badge badge-error">Absent</span>' : r.status === 'late' ? '<span class="badge badge-warning">Late</span>' : '<span class="badge">' + esc(r.status) + '</span>'}</td>
      <td>${fmtTime(r.check_in)}</td>
      <td>${fmtTime(r.check_out)}</td>
      <td class="muted">${esc(r.method || '—')}</td>
    </tr>`).join('');

    const html = SP_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('attendance')}
      <h1 style="font-size:24px;color:#1e293b;margin-bottom:20px">📅 My Attendance</h1>
      <div class="stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:14px;margin-bottom:20px">
        <div class="stat-card"><div class="stat-num" style="color:#16a34a">${rate}%</div><div class="muted" style="font-size:11px">Overall Rate</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#4f46e5">${presentCount}</div><div class="muted" style="font-size:11px">Days Present</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#dc2626">${absentCount}</div><div class="muted" style="font-size:11px">Days Absent</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${lateCount}</div><div class="muted" style="font-size:11px">Days Late</div></div>
      </div>
      <div class="card" style="padding:20px;margin-bottom:16px">
        <h3 style="font-size:15px;color:#1e293b;margin-bottom:14px">Attendance Trend</h3>
        ${weeklyChart || '<p class="muted" style="font-size:13px">No data</p>'}
      </div>
      <div class="card" style="padding:20px">
        <h3 style="font-size:15px;color:#1e293b;margin-bottom:14px">📋 Attendance Records</h3>
        <div style="overflow-x:auto"><table class="sp-table">
          <thead><tr><th>Date</th><th>Status</th><th>Check In</th><th>Check Out</th><th>Method</th></tr></thead>
          <tbody>${rowsHtml || '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:30px">No attendance records</td></tr>'}</tbody>
        </table></div>
      </div>
    </div>`;
    res.send(renderPage('My Attendance', html, user, req));
  }));

  // ============================================================
  // ROUTE 4: GET /portal/timetable — View timetable
  // ============================================================
  app.get('/portal/timetable', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const student = await resolveStudent(user);
    if (!student) return res.redirect('/portal');

    let timetableEntries = [];
    try { timetableEntries = (await pool.query(`SELECT * FROM timetable WHERE tenant_id=$1 AND (class_id=$2 OR class_name=$3) ORDER BY day, start_time`, [tid, student.class_id || 0, student.class_name || ''])).rows; } catch(e){}

    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    const timeSlots = ['08:00', '09:00', '10:00', '11:00', '12:00', '14:00', '15:00', '16:00'];

    // Build lookup map
    const slotMap = {};
    timetableEntries.forEach(t => {
      const key = `${(t.day || 0)}_${(t.start_time || '00:00').substring(0, 5)}`;
      slotMap[key] = t;
    });

    const timetableHtml = timeSlots.map(time => {
      return `<div class="time-slot">${time}</div>` +
        days.map((day, di) => {
          const key = `${di + 1}_${time}`;
          const entry = slotMap[key] || slotMap[`${day.toLowerCase()}_${time}`];
          if (entry) {
            return `<div class="cell filled"><div class="subj">${esc(entry.subject || entry.subject_name || '')}</div><div class="room">${esc(entry.room || '')}</div><div class="room">${fmtTime(entry.start_time)}-${fmtTime(entry.end_time)}</div></div>`;
          }
          return `<div class="cell"></div>`;
        }).join('');
    }).join('');

    const html = SP_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('timetable')}
      <h1 style="font-size:24px;color:#1e293b;margin-bottom:20px">🕐 My Timetable</h1>
      ${student.class_name ? `<div class="badge" style="background:#eef2ff;color:#4338ca;font-size:13px;padding:8px 16px;margin-bottom:16px">Class: ${esc(student.class_name)}</div>` : ''}
      <div class="card" style="padding:20px">
        ${timetableEntries.length > 0
          ? `<div class="sp-timetable">
              <div class="time-slot">Time</div>
              ${days.map(d => `<div class="day-header">${d}</div>`).join('')}
              ${timetableHtml}
            </div>`
          : '<p class="muted" style="font-size:14px;text-align:center;padding:40px">No timetable entries found for your class.</p>'}
      </div>
    </div>`;
    res.send(renderPage('My Timetable', html, user, req));
  }));

  // ============================================================
  // ROUTE 5: GET /portal/fees — View fees
  // ============================================================
  app.get('/portal/fees', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const student = await resolveStudent(user);
    if (!student) return res.redirect('/portal');

    let fees = [];
    try { fees = (await pool.query(`SELECT * FROM fees WHERE tenant_id=$1 AND student_id=$2 ORDER BY created_at DESC`, [tid, student.id])).rows; } catch(e){}

    let payments = [];
    try { payments = (await pool.query(`SELECT * FROM payments WHERE tenant_id=$1 AND student_id=$2 ORDER BY created_at DESC LIMIT 20`, [tid, student.id])).rows; } catch(e){}

    const totalFees = fees.reduce((s, f) => s + Number(f.amount || 0), 0);
    const totalPaid = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
    const balance = totalFees - totalPaid;

    const feesHtml = fees.map(f => `<tr>
      <td>${esc(f.description || f.fee_type || 'Fee')}</td>
      <td>${fmtMoney(f.amount)}</td>
      <td>${fmtDate(f.due_date)}</td>
      <td>${Number(f.balance || f.amount) > 0 ? '<span class="badge badge-error">Unpaid</span>' : '<span class="badge badge-success">Paid</span>'}</td>
    </tr>`).join('');

    const paymentsHtml = payments.map(p => `<tr>
      <td>${fmtDate(p.created_at || p.date)}</td>
      <td style="font-weight:700;color:#16a34a">${fmtMoney(p.amount)}</td>
      <td>${esc(p.method || p.payment_method || '—')}</td>
      <td class="muted">${esc(p.reference || '')}</td>
    </tr>`).join('');

    const html = SP_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('fees')}
      <h1 style="font-size:24px;color:#1e293b;margin-bottom:20px">💰 My Fees</h1>
      <div class="stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;margin-bottom:20px">
        <div class="stat-card"><div class="stat-num" style="color:#4f46e5">${fmtMoney(totalFees)}</div><div class="muted" style="font-size:11px">Total Fees</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#16a34a">${fmtMoney(totalPaid)}</div><div class="muted" style="font-size:11px">Total Paid</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#dc2626">${fmtMoney(Math.max(balance, 0))}</div><div class="muted" style="font-size:11px">Balance Due</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#3b82f6">${payments.length}</div><div class="muted" style="font-size:11px">Payments Made</div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div class="card" style="padding:20px">
          <h3 style="font-size:15px;color:#1e293b;margin-bottom:14px">📋 Fee Schedule</h3>
          <div style="overflow-x:auto"><table class="sp-table">
            <thead><tr><th>Description</th><th>Amount</th><th>Due Date</th><th>Status</th></tr></thead>
            <tbody>${feesHtml || '<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:20px">No fees</td></tr>'}</tbody>
          </table></div>
        </div>
        <div class="card" style="padding:20px">
          <h3 style="font-size:15px;color:#1e293b;margin-bottom:14px">💳 Payment History</h3>
          <div style="overflow-x:auto"><table class="sp-table">
            <thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Reference</th></tr></thead>
            <tbody>${paymentsHtml || '<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:20px">No payments</td></tr>'}</tbody>
          </table></div>
        </div>
      </div>
    </div>`;
    res.send(renderPage('My Fees', html, user, req));
  }));

  // ============================================================
  // ROUTE 6: GET /portal/assignments — View assignments
  // ============================================================
  app.get('/portal/assignments', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const student = await resolveStudent(user);
    if (!student) return res.redirect('/portal');

    // Get submissions for this student
    let submissions = [];
    try { submissions = (await pool.query(`SELECT * FROM student_submissions WHERE tenant_id=$1 AND student_id=$2 ORDER BY submitted_at DESC`, [tid, student.id])).rows; } catch(e){}

    const pending = submissions.filter(s => s.status === 'submitted').length;
    const graded = submissions.filter(s => s.status === 'graded' || s.grade != null).length;

    const rowsHtml = submissions.map(s => `<tr>
      <td><strong>${esc(s.assignment_title || 'Assignment #' + s.assignment_id)}</strong></td>
      <td>${esc(s.subject || '—')}</td>
      <td>${statusBadge(s.status)}</td>
      <td>${s.grade != null ? `<span style="font-weight:700;color:${gradeColor(s.grade)}">${s.grade}%</span>` : '—'}</td>
      <td>${fmtDate(s.submitted_at)}</td>
      <td>${s.feedback ? '<span title="' + esc(s.feedback) + '">💬</span>' : '—'}</td>
    </tr>`).join('');

    const html = SP_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('assignments')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">📝 My Assignments</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">View and submit your assignments</p></div>
      </div>
      <div class="stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-bottom:20px">
        <div class="stat-card"><div class="stat-num" style="color:#4f46e5">${submissions.length}</div><div class="muted" style="font-size:11px">Total Submissions</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${pending}</div><div class="muted" style="font-size:11px">Awaiting Grade</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#16a34a">${graded}</div><div class="muted" style="font-size:11px">Graded</div></div>
      </div>
      <div class="card" style="padding:24px;margin-bottom:16px">
        <h3 style="font-size:15px;color:#1e293b;margin-bottom:16px">Submit New Assignment</h3>
        <form method="POST" action="/portal/assignments/submit" style="display:flex;flex-wrap:wrap;gap:14px;align-items:end">
          <div style="flex:2;min-width:200px"><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Assignment Title *</label>
            <input type="text" name="assignment_title" required placeholder="e.g., English Essay Ch. 5" style="width:100%;padding:9px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
          <div style="flex:1;min-width:140px"><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Subject *</label>
            <input type="text" name="subject" required placeholder="Subject name" style="width:100%;padding:9px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
          <div style="flex:3;min-width:200px"><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Content / Answer</label>
            <textarea name="content" rows="1" placeholder="Your answer or notes..." style="width:100%;padding:9px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px;resize:vertical"></textarea></div>
          <button type="submit" class="sp-btn sp-btn-primary">📤 Submit</button>
        </form>
      </div>
      <div class="card" style="padding:20px">
        <h3 style="font-size:15px;color:#1e293b;margin-bottom:14px">📋 My Submissions</h3>
        <div style="overflow-x:auto"><table class="sp-table">
          <thead><tr><th>Assignment</th><th>Subject</th><th>Status</th><th>Grade</th><th>Submitted</th><th>Feedback</th></tr></thead>
          <tbody>${rowsHtml || '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:30px">No submissions yet. Use the form above to submit your first assignment.</td></tr>'}</tbody>
        </table></div>
      </div>
    </div>`;
    res.send(renderPage('My Assignments', html, user, req));
  }));

  // ============================================================
  // ROUTE 7: POST /portal/assignments/submit — Submit assignment
  // ============================================================
  app.post('/portal/assignments/submit', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const student = await resolveStudent(user);
    if (!student) return res.redirect('/portal');

    const { assignment_title, subject, content } = req.body;
    if (!assignment_title || !subject) {
      req.session.flash = { type: 'error', msg: 'Assignment title and subject are required' };
      return res.redirect('/portal/assignments');
    }

    await pool.query(
      `INSERT INTO student_submissions (tenant_id, student_id, assignment_title, subject, content, status) VALUES ($1,$2,$3,$4,$5,'submitted')`,
      [tid, student.id, assignment_title.trim(), subject.trim(), (content || '').trim()]
    );
    req.session.flash = { type: 'success', msg: 'Assignment submitted successfully!' };
    res.redirect('/portal/assignments');
  }));

  // ============================================================
  // ROUTE 8: GET /portal/profile — View student profile
  // ============================================================
  app.get('/portal/profile', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const student = await resolveStudent(user);
    if (!student) return res.redirect('/portal');

    const html = SP_CSS + `<div style="max-width:800px;margin:0 auto">
      ${nav('profile')}
      <h1 style="font-size:24px;color:#1e293b;margin-bottom:20px">👤 My Profile</h1>
      <div class="sp-card" style="padding:28px;margin-bottom:16px">
        <div style="display:flex;align-items:center;gap:18px;margin-bottom:24px">
          <div style="width:72px;height:72px;border-radius:50%;background:#eef2ff;display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:800;color:#4f46e5;flex-shrink:0">${esc((student.first_name || student.name || '?').charAt(0).toUpperCase())}</div>
          <div>
            <h2 style="font-size:20px;color:#1e293b;margin:0">${esc(student.first_name || '')} ${esc(student.last_name || '')}</h2>
            <p style="font-size:13px;color:#64748b;margin-top:2px">Admission #: ${esc(student.admission_number || '—')} · Class: ${esc(student.class_name || student.student_class || '—')}</p>
          </div>
        </div>
        <div class="sp-info-row"><span class="sp-info-label">Full Name</span><span class="sp-info-value">${esc((student.first_name || '') + ' ' + (student.last_name || ''))}</span></div>
        <div class="sp-info-row"><span class="sp-info-label">Email</span><span class="sp-info-value">${esc(student.email || user.email || '—')}</span></div>
        <div class="sp-info-row"><span class="sp-info-label">Phone</span><span class="sp-info-value">${esc(student.phone || '—')}</span></div>
        <div class="sp-info-row"><span class="sp-info-label">Date of Birth</span><span class="sp-info-value">${fmtDate(student.dob || student.date_of_birth)}</span></div>
        <div class="sp-info-row"><span class="sp-info-label">Gender</span><span class="sp-info-value">${esc(student.gender || '—')}</span></div>
        <div class="sp-info-row"><span class="sp-info-label">Class</span><span class="sp-info-value">${esc(student.class_name || student.student_class || '—')}</span></div>
        <div class="sp-info-row"><span class="sp-info-label">Admission Date</span><span class="sp-info-value">${fmtDate(student.admission_date)}</span></div>
        <div class="sp-info-row" style="border-bottom:none"><span class="sp-info-label">Parent/Guardian</span><span class="sp-info-value">${esc(student.parent_name || student.guardian_name || '—')}</span></div>
      </div>
      <div class="card" style="padding:20px">
        <h3 style="font-size:15px;color:#1e293b;margin-bottom:16px">✏️ Update Contact Info</h3>
        <form method="POST" action="/portal/profile" style="display:flex;flex-wrap:wrap;gap:14px">
          <div style="flex:1;min-width:200px"><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Phone</label>
            <input type="tel" name="phone" value="${esc(student.phone || '')}" placeholder="+256..." style="width:100%;padding:9px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
          <div style="flex:1;min-width:200px"><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Email</label>
            <input type="email" name="email" value="${esc(student.email || '')}" style="width:100%;padding:9px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
          <div style="flex:1;min-width:200px"><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Address</label>
            <input type="text" name="address" value="${esc(student.address || '')}" placeholder="Home address" style="width:100%;padding:9px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
          <button type="submit" class="sp-btn sp-btn-primary" style="align-self:end">💾 Save</button>
        </form>
      </div>
    </div>`;
    res.send(renderPage('My Profile', html, user, req));
  }));

  // ============================================================
  // ROUTE 9: POST /portal/profile — Update profile
  // ============================================================
  app.post('/portal/profile', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const student = await resolveStudent(user);
    if (!student) return res.redirect('/portal');

    const { phone, email, address } = req.body;
    try {
      await pool.query(
        `UPDATE students SET phone=$1, email=$2, address=$3 WHERE id=$4 AND tenant_id=$5`,
        [(phone || '').trim(), (email || '').trim(), (address || '').trim(), student.id, tid]
      );
      req.session.flash = { type: 'success', msg: 'Profile updated successfully!' };
    } catch(e) {
      req.session.flash = { type: 'error', msg: 'Failed to update profile: ' + e.message };
    }
    res.redirect('/portal/profile');
  }));

  // ============================================================
  // ROUTE 10: GET /portal/notifications — View notifications
  // ============================================================
  app.get('/portal/notifications', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const student = await resolveStudent(user);

    let notifications = [];
    try {
      const target = student ? String(student.id) : user.email;
      notifications = (await pool.query(
        `SELECT * FROM notifications WHERE tenant_id=$1 AND (recipient=$2 OR target=$2 OR recipient='all') ORDER BY created_at DESC LIMIT 30`,
        [tid, target]
      )).rows;
    } catch(e){
      try {
        notifications = (await pool.query(
          `SELECT * FROM notifications WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 30`,
          [tid]
        )).rows;
      } catch(e2){}
    }

    const rowsHtml = notifications.map(n => {
      const icon = n.type === 'fee' ? '💰' : n.type === 'grade' ? '🎓' : n.type === 'attendance' ? '📅' : n.type === 'announcement' ? '📢' : '🔔';
      return `<div style="padding:14px;border-bottom:1px solid #f1f5f9;${!n.is_read ? 'background:#f8fafc;border-left:3px solid #4f46e5' : ''}">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
          <span>${icon}</span>
          <strong style="font-size:13px;color:#1e293b">${esc(n.title || n.subject || 'Notification')}</strong>
          <span class="muted" style="font-size:11px;margin-left:auto">${fmtDateTime(n.created_at)}</span>
        </div>
        <p style="font-size:13px;color:#64748b;margin:0">${esc(n.message || n.body || '')}</p>
      </div>`;
    }).join('');

    const html = SP_CSS + `<div style="max-width:900px;margin:0 auto">
      ${nav('notifications')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">🔔 Notifications</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">${notifications.length} notification(s)</p></div>
      </div>
      <div class="card" style="padding:0;overflow:hidden">
        ${rowsHtml || '<div style="text-align:center;padding:48px"><span style="font-size:36px;display:block;margin-bottom:12px">🔕</span><p style="font-size:14px;color:#64748b">No notifications</p></div>'}
      </div>
    </div>`;
    res.send(renderPage('Notifications', html, user, req));
  }));

  // ============================================================
  // ROUTE 11: GET /portal/api/dashboard — JSON API
  // ============================================================
  app.get('/portal/api/dashboard', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const student = await resolveStudent(user);

    if (!student) {
      return res.json({ error: 'No student profile found', linked: false });
    }

    let grades = [], attendanceRecords = [], feeBalance = 0, totalFees = 0, totalPaid = 0;
    try { grades = (await pool.query(`SELECT grade FROM marks WHERE tenant_id=$1 AND student_id=$2`, [tid, student.id])).rows; } catch(e){}
    try { attendanceRecords = (await pool.query(`SELECT status FROM attendance WHERE tenant_id=$1 AND student_id=$2`, [tid, student.id])).rows; } catch(e){}
    try {
      const fees = (await pool.query(`SELECT amount, balance FROM fees WHERE tenant_id=$1 AND student_id=$2`, [tid, student.id])).rows;
      totalFees = fees.reduce((s, f) => s + Number(f.amount || 0), 0);
      feeBalance = fees.reduce((s, f) => s + Number(f.balance || f.amount || 0), 0);
    } catch(e){}

    const avgGrade = grades.length > 0 ? Math.round(grades.reduce((s, g) => s + Number(g.grade || 0), 0) / grades.length) : 0;
    const presentCount = attendanceRecords.filter(r => r.status === 'present' || r.status === 'late').length;
    const attendanceRate = attendanceRecords.length > 0 ? Math.round(presentCount / attendanceRecords.length * 100) : 0;

    res.json({
      linked: true,
      student: {
        id: student.id,
        name: (student.first_name || '') + ' ' + (student.last_name || ''),
        admission_number: student.admission_number,
        class: student.class_name || student.student_class,
      },
      kpis: {
        average_grade: avgGrade,
        attendance_rate: attendanceRate,
        fee_balance: Number(feeBalance),
        total_grade_entries: grades.length,
        total_attendance_records: attendanceRecords.length,
      }
    });
  }));

};
