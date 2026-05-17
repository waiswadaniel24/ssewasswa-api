// ============================================================
// TIMETABLE BUILDER MODULE — Multi-Tenant SaaS Platform
// Weekly grid scheduling, period management, lesson planning,
// live class sessions, conflict detection, and print views.
// ============================================================
// Usage in server.js:
//   const timetableBuilder = require('./timetable-builder');
//   timetableBuilder(app, db, pool, renderPage, esc);
// ============================================================
// Tables this module creates:
//   timetable_periods, timetable_conflicts
// Tables this module also uses (must already exist or be created
// by other modules):
//   lesson_plans, live_classes, timetable, timetables
// Add to VALID_TABLES in server.js:
//   ['timetable_periods','timetable_conflicts','lesson_plans','live_classes']
//   .forEach(t => VALID_TABLES.add(t));
// ============================================================

'use strict';

module.exports = function timetableBuilder(app, db, pool, renderPage, esc) {

  // -- inline helpers ---------------------------------------------------
  const requireAuth = (req, res, next) => {
    if (!req.session?.user) return res.redirect('/login');
    next();
  };
  const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  if (!esc) esc = (s) => String(s == null ? '' : (typeof s === 'object' ? JSON.stringify(s) : s))
    .replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const fmtTime = (t) => t ? String(t).substring(0, 5) : '—';
  const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const today = () => new Date().toISOString().slice(0, 10);
  const genToken = () => require('crypto').randomBytes(24).toString('hex');

  const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const DAY_NAMES_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function conflictBadge(resolved) {
    if (resolved) return '<span class="badge" style="background:#dcfce7;color:#16a34a">Resolved</span>';
    return '<span class="badge" style="background:#fee2e2;color:#dc2626">Open</span>';
  }

  function liveStatusBadge(status) {
    const m = {
      scheduled: { bg: '#dbeafe', c: '#1d4ed8', l: 'Scheduled' },
      live: { bg: '#dcfce7', c: '#16a34a', l: '🔴 Live' },
      completed: { bg: '#f1f5f9', c: '#64748b', l: 'Completed' },
      cancelled: { bg: '#fee2e2', c: '#dc2626', l: 'Cancelled' }
    };
    const v = m[status] || m.scheduled;
    return '<span class="badge" style="background:' + v.bg + ';color:' + v.c + '">' + v.l + '</span>';
  }

  // -- shared CSS --------------------------------------------------------
  const TT_CSS = '<style>\n\
.tt-nav{display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap}\n\
.tt-nav a{padding:8px 18px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#475569;background:#f1f5f9;transition:.15s}\n\
.tt-nav a:hover{background:#e2e8f0}.tt-nav a.active{background:#4f46e5;color:#fff}\n\
.tt-btn{display:inline-flex;align-items:center;gap:6px;padding:9px 18px;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:.15s}\n\
.tt-btn:hover{opacity:.9;transform:translateY(-1px)}\n\
.tt-btn-primary{background:#4f46e5;color:#fff}.tt-btn-success{background:#059669;color:#fff}\n\
.tt-btn-danger{background:#fee2e2;color:#dc2626}.tt-btn-secondary{background:#f1f5f9;color:#475569}\n\
.tt-grid{display:grid;grid-template-columns:100px repeat(8,1fr);gap:1px;background:#e2e8f0;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden}\n\
.tt-grid-header{background:#f8fafc;padding:10px 8px;font-size:12px;font-weight:700;color:#64748b;text-align:center;text-transform:uppercase;letter-spacing:.5px}\n\
.tt-grid-day{background:#f8fafc;padding:10px 8px;font-size:12px;font-weight:700;color:#1e293b;text-align:center}\n\
.tt-cell{background:#fff;padding:6px;min-height:60px;vertical-align:top}\n\
.tt-cell:hover{background:#f8fafc}\n\
.tt-period{background:#eef2ff;border-left:3px solid #4f46e5;border-radius:6px;padding:6px 8px;margin-bottom:4px;font-size:11px;cursor:pointer;transition:.15s}\n\
.tt-period:hover{box-shadow:0 2px 8px rgba(79,70,229,.15)}\n\
.tt-period-title{font-weight:700;color:#4f46e5;font-size:12px;margin-bottom:2px}\n\
.tt-period-meta{color:#64748b;font-size:10px}\n\
.tt-period-break{background:#fef3c7;border-left:3px solid #f59e0b;text-align:center;color:#b45309;font-weight:600;padding:10px;border-radius:6px}\n\
.tt-table{width:100%;border-collapse:collapse;font-size:13px}\n\
.tt-table th{padding:11px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#f8fafc}\n\
.tt-table td{padding:10px 14px;border-bottom:1px solid #f1f5f9;color:#1e293b}\n\
.tt-table tr:hover{background:#f8fafc}\n\
.tt-filter{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:end}\n\
.tt-filter label{display:block;font-size:12px;font-weight:600;color:#64748b;margin-bottom:4px}\n\
.tt-filter input,.tt-filter select{padding:8px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px;background:#fff}\n\
.tt-filter input:focus,.tt-filter select:focus{outline:none;border-color:#6366f1}\n\
.tt-form label{display:block;font-size:13px;font-weight:600;color:#475569;margin-bottom:4px}\n\
.tt-form input,.tt-form select,.tt-form textarea{width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;box-sizing:border-box}\n\
.tt-form input:focus,.tt-form select:focus,.tt-form textarea:focus{outline:none;border-color:#6366f1}\n\
.tt-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}\n\
.tt-form-grid .full{grid-column:1/-1}\n\
.tt-conflict-row{background:#fff5f5}.tt-conflict-row:hover{background:#fee2e2}\n\
.tt-print{background:#fff;padding:30px;color:#000}\n\
.tt-print h2{color:#1e293b;margin-bottom:16px}\n\
.tt-print table{width:100%;border-collapse:collapse}\n\
.tt-print th,.tt-print td{border:1px solid #cbd5e1;padding:8px 10px;font-size:12px}\n\
.tt-print th{background:#f1f5f9;font-weight:700;color:#1e293b}\n\
@media(max-width:768px){.tt-grid{grid-template-columns:60px repeat(8,1fr);font-size:10px}.tt-nav{gap:4px}.tt-nav a{padding:6px 12px;font-size:12px}.tt-form-grid{grid-template-columns:1fr}}\n\
@media print{.tt-nav,.tt-btn,.tt-filter{display:none!important}.tt-print{box-shadow:none;border:none}}\n\
</style>';

  // -- navigation helper --------------------------------------------------
  const nav = (active) => '<div class="tt-nav">' +
    '<a href="/timetable" class="' + (active === 'dash' ? 'active' : '') + '">📅 Timetable</a>' +
    '<a href="/timetable/manage" class="' + (active === 'manage' ? 'active' : '') + '">⚙️ Manage</a>' +
    '<a href="/timetable/lessons" class="' + (active === 'lessons' ? 'active' : '') + '">📚 Lessons</a>' +
    '<a href="/timetable/live" class="' + (active === 'live' ? 'active' : '') + '">🔴 Live Classes</a>' +
    '<a href="/timetable/conflicts" class="' + (active === 'conflicts' ? 'active' : '') + '">⚠️ Conflicts</a>' +
    '<a href="/timetable/print" class="' + (active === 'print' ? 'active' : '') + '">🖨️ Print</a>' +
    '</div>';

  // ============================================================
  // DATABASE MIGRATIONS (async IIFE)
  // ============================================================
  (async () => {
    const c = await pool.connect().catch(() => null);
    if (!c) { console.error('[TimetableBuilder] Cannot connect to DB for migrations'); return; }
    try {
      await c.query(`CREATE TABLE IF NOT EXISTS timetable_periods (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        day_of_week INTEGER NOT NULL, period_number INTEGER NOT NULL,
        class_id INTEGER, subject_id INTEGER, teacher_id INTEGER,
        room VARCHAR(100), start_time TIME, end_time TIME,
        term VARCHAR(50), academic_year VARCHAR(20),
        notes TEXT, created_by INTEGER,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await c.query(`CREATE TABLE IF NOT EXISTS timetable_conflicts (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        period1_id INTEGER, period2_id INTEGER,
        conflict_type VARCHAR(50), description TEXT,
        resolved BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      // ALTER TABLE IF NOT EXISTS — timetable_periods
      const tpCols = ['day_of_week INTEGER NOT NULL DEFAULT 1','period_number INTEGER NOT NULL DEFAULT 1',
        'class_id INTEGER','subject_id INTEGER','teacher_id INTEGER',
        'room VARCHAR(100)','start_time TIME','end_time TIME',
        'term VARCHAR(50)','academic_year VARCHAR(20)',
        'notes TEXT','created_by INTEGER'];
      for (const col of tpCols) {
        try { await c.query('ALTER TABLE timetable_periods ADD COLUMN IF NOT EXISTS ' + col); } catch (e) {}
      }
      // ALTER TABLE IF NOT EXISTS — timetable_conflicts
      const tcCols = ['period1_id INTEGER','period2_id INTEGER',
        'conflict_type VARCHAR(50)','description TEXT','resolved BOOLEAN DEFAULT false'];
      for (const col of tcCols) {
        try { await c.query('ALTER TABLE timetable_conflicts ADD COLUMN IF NOT EXISTS ' + col); } catch (e) {}
      }
      // Indexes
      await c.query('CREATE INDEX IF NOT EXISTS idx_tp_tenant ON timetable_periods(tenant_id)');
      await c.query('CREATE INDEX IF NOT EXISTS idx_tp_day ON timetable_periods(tenant_id, day_of_week)');
      await c.query('CREATE INDEX IF NOT EXISTS idx_tp_class ON timetable_periods(tenant_id, class_id)');
      await c.query('CREATE INDEX IF NOT EXISTS idx_tp_teacher ON timetable_periods(tenant_id, teacher_id)');
      await c.query('CREATE INDEX IF NOT EXISTS idx_tc_tenant ON timetable_conflicts(tenant_id)');
      await c.query('CREATE INDEX IF NOT EXISTS idx_tc_resolved ON timetable_conflicts(tenant_id, resolved)');
      console.log('[TimetableBuilder] Migrations applied successfully');
    } catch (e) { console.error('[TimetableBuilder] Migration error:', e.message); }
    finally { c.release(); }
  })();

  // ============================================================
  // ROUTE 1: GET /timetable — Timetable Dashboard (Weekly Grid)
  // ============================================================
  app.get('/timetable', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const selClass = req.query.class_id || '';
    const selTerm = req.query.term || '';
    const selYear = req.query.year || '';

    const classes = (await pool.query(
      'SELECT id, name FROM classes WHERE tenant_id=$1 ORDER BY name', [tid]
    )).rows;

    // Fetch periods for the grid
    let where = ['tp.tenant_id=$1'], params = [tid], pi = 2;
    if (selClass) { where.push('tp.class_id=$' + pi++); params.push(selClass); }
    if (selTerm) { where.push('tp.term=$' + pi++); params.push(selTerm); }
    if (selYear) { where.push('tp.academic_year=$' + pi++); params.push(selYear); }

    const periods = (await pool.query(
      `SELECT tp.*, s.name as subject_name, c.name as class_name,
              u.name as teacher_name, u.email as teacher_email
       FROM timetable_periods tp
       LEFT JOIN subjects s ON s.id = tp.subject_id AND s.tenant_id = tp.tenant_id
       LEFT JOIN classes c ON c.id = tp.class_id AND c.tenant_id = tp.tenant_id
       LEFT JOIN users u ON u.id = tp.teacher_id
       WHERE ${where.join(' AND ')}
       ORDER BY tp.day_of_week, tp.period_number`, params
    )).rows;

    const terms = (await pool.query(
      'SELECT DISTINCT term FROM timetable_periods WHERE tenant_id=$1 AND term IS NOT NULL ORDER BY term', [tid]
    )).rows;
    const years = (await pool.query(
      'SELECT DISTINCT academic_year FROM timetable_periods WHERE tenant_id=$1 AND academic_year IS NOT NULL ORDER BY academic_year DESC', [tid]
    )).rows;

    const maxPeriod = periods.length ? Math.max(...periods.map(p => p.period_number)) : 8;
    const totalPeriods = Math.max(maxPeriod, 8);

    // Build grid rows: one row per day, cells for each period
    const gridRows = DAYS.map((day, di) => {
      const dayPeriods = periods.filter(p => p.day_of_week === (di + 1));
      let cells = '';
      for (let pn = 1; pn <= totalPeriods; pn++) {
        const p = dayPeriods.find(dp => dp.period_number === pn);
        if (p) {
          cells += '<div class="tt-cell"><div class="tt-period" onclick="location.href=\'/timetable/manage?edit=' + p.id + '\'">' +
            '<div class="tt-period-title">' + esc(p.subject_name || 'Free') + '</div>' +
            '<div class="tt-period-meta">' + esc(p.class_name || '') + '</div>' +
            '<div class="tt-period-meta">' + esc(p.teacher_name || '') + ' · ' + esc(p.room || '') + '</div>' +
            '<div class="tt-period-meta">' + fmtTime(p.start_time) + ' - ' + fmtTime(p.end_time) + '</div>' +
            '</div></div>';
        } else {
          cells += '<div class="tt-cell"></div>';
        }
      }
      return '<div class="tt-grid-day">' + DAY_NAMES_SHORT[di] + '</div>' + cells;
    }).join('');

    // Period number header row
    let headerCells = '<div class="tt-grid-header">Day</div>';
    for (let i = 1; i <= totalPeriods; i++) {
      headerCells += '<div class="tt-grid-header">P' + i + '</div>';
    }

    const html = TT_CSS + '<div style="max-width:1300px;margin:0 auto">' +
      nav('dash') +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">' +
        '<div><h1 style="font-size:24px;color:#1e293b">📅 Timetable</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Weekly class schedule grid view</p></div>' +
        '<div style="display:flex;gap:8px">' +
          '<a href="/timetable/manage" class="tt-btn tt-btn-primary">+ Add Period</a>' +
          '<a href="/timetable/print" class="tt-btn tt-btn-secondary">🖨️ Print</a>' +
        '</div>' +
      '</div>' +
      '<div class="stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:14px;margin-bottom:20px">' +
        '<div class="stat-card"><div class="stat-num" style="color:#4f46e5">' + periods.length + '</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Total Periods</div></div>' +
        '<div class="stat-card"><div class="stat-num" style="color:#059669">' + classes.length + '</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Classes</div></div>' +
        '<div class="stat-card"><div class="stat-num" style="color:#f59e0b">' + totalPeriods + '</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Periods/Day</div></div>' +
        '<div class="stat-card"><div class="stat-num" style="color:#8b5cf6">' + DAYS.length + '</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">School Days</div></div>' +
      '</div>' +
      '<div class="tt-filter">' +
        '<div><label>Class</label><select onchange="location.href=\'/timetable?class_id=\'+this.value+\'&term=' + esc(selTerm) + '&year=' + esc(selYear) + '\'">' +
          '<option value="">All Classes</option>' +
          classes.map(c => '<option value="' + c.id + '" ' + (selClass == c.id ? 'selected' : '') + '>' + esc(c.name) + '</option>').join('') +
        '</select></div>' +
        '<div><label>Term</label><select onchange="location.href=\'/timetable?class_id=' + esc(selClass) + '&term=\'+this.value+\'&year=' + esc(selYear) + '\'">' +
          '<option value="">All Terms</option>' +
          terms.map(t => '<option value="' + esc(t.term) + '" ' + (selTerm === t.term ? 'selected' : '') + '>' + esc(t.term) + '</option>').join('') +
        '</select></div>' +
        '<div><label>Year</label><select onchange="location.href=\'/timetable?class_id=' + esc(selClass) + '&term=' + esc(selTerm) + '&year=\'+this.value">' +
          '<option value="">All Years</option>' +
          years.map(y => '<option value="' + esc(y.academic_year) + '" ' + (selYear === y.academic_year ? 'selected' : '') + '>' + esc(y.academic_year) + '</option>').join('') +
        '</select></div>' +
      '</div>' +
      '<div class="card" style="padding:16px;overflow-x:auto">' +
        '<div class="tt-grid">' +
          headerCells + gridRows +
        '</div>' +
      '</div>' +
    '</div>';
    res.send(renderPage('Timetable Dashboard', html, user, req));
  }));

  // ============================================================
  // ROUTE 2: GET /timetable/manage — Manage Timetable Entries
  // ============================================================
  app.get('/timetable/manage', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const editId = req.query.edit || '';

    const classes = (await pool.query('SELECT id, name FROM classes WHERE tenant_id=$1 ORDER BY name', [tid])).rows;
    const subjects = (await pool.query('SELECT id, name FROM subjects WHERE tenant_id=$1 ORDER BY name', [tid])).rows;
    const teachers = (await pool.query(
      "SELECT id, name, email FROM users WHERE tenant_id=$1 AND (role='teacher' OR role='admin') ORDER BY name", [tid]
    )).rows;

    let editData = null;
    if (editId) {
      editData = (await pool.query('SELECT * FROM timetable_periods WHERE id=$1 AND tenant_id=$2', [editId, tid])).rows[0];
    }

    // Existing entries list
    const entries = (await pool.query(
      `SELECT tp.*, s.name as subject_name, c.name as class_name, u.name as teacher_name
       FROM timetable_periods tp
       LEFT JOIN subjects s ON s.id = tp.subject_id AND s.tenant_id = tp.tenant_id
       LEFT JOIN classes c ON c.id = tp.class_id AND c.tenant_id = tp.tenant_id
       LEFT JOIN users u ON u.id = tp.teacher_id
       WHERE tp.tenant_id=$1 ORDER BY tp.day_of_week, tp.period_number`, [tid]
    )).rows;

    const entryRows = entries.map(e => '<tr>' +
      '<td>' + DAY_NAMES_SHORT[(e.day_of_week || 1) - 1] + '</td>' +
      '<td>P' + (e.period_number || 1) + '</td>' +
      '<td><strong>' + esc(e.subject_name || '—') + '</strong></td>' +
      '<td>' + esc(e.class_name || '—') + '</td>' +
      '<td>' + esc(e.teacher_name || '—') + '</td>' +
      '<td>' + esc(e.room || '—') + '</td>' +
      '<td>' + fmtTime(e.start_time) + ' - ' + fmtTime(e.end_time) + '</td>' +
      '<td>' +
        '<a href="/timetable/manage?edit=' + e.id + '" class="btn btn-sm btn-blue" style="margin-right:4px">Edit</a>' +
        '<form method="POST" action="/timetable/manage/delete" style="display:inline" onsubmit="return confirm(\'Delete this period?\')">' +
          '<input type="hidden" name="id" value="' + e.id + '"><button class="btn btn-sm btn-red" type="submit">Delete</button>' +
        '</form>' +
      '</td>' +
    '</tr>').join('');

    const dayOpts = DAYS.map((d, i) => '<option value="' + (i + 1) + '" ' + (editData && editData.day_of_week === (i + 1) ? 'selected' : '') + '>' + d + '</option>').join('');
    const classOpts = classes.map(c => '<option value="' + c.id + '" ' + (editData && editData.class_id == c.id ? 'selected' : '') + '>' + esc(c.name) + '</option>').join('');
    const subOpts = subjects.map(s => '<option value="' + s.id + '" ' + (editData && editData.subject_id == s.id ? 'selected' : '') + '>' + esc(s.name) + '</option>').join('');
    const teachOpts = teachers.map(t => '<option value="' + t.id + '" ' + (editData && editData.teacher_id == t.id ? 'selected' : '') + '>' + esc(t.name) + '</option>').join('');

    const html = TT_CSS + '<div style="max-width:1200px;margin:0 auto">' +
      nav('manage') +
      '<div style="display:grid;grid-template-columns:380px 1fr;gap:20px">' +
        '<div class="card" style="padding:24px">' +
          '<h2 style="color:#1e293b;margin:0 0 4px">' + (editData ? '✏️ Edit Period' : '+ Add Period') + '</h2>' +
          '<p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Configure a timetable slot</p>' +
          '<form method="POST" action="/timetable/manage" class="tt-form">' +
            (editData ? '<input type="hidden" name="id" value="' + editData.id + '">' : '') +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
              '<div><label>Day *</label><select name="day_of_week" required>' + dayOpts + '</select></div>' +
              '<div><label>Period # *</label><input type="number" name="period_number" min="1" max="12" value="' + (editData ? editData.period_number : '1') + '" required></div>' +
              '<div><label>Subject</label><select name="subject_id"><option value="">— None —</option>' + subOpts + '</select></div>' +
              '<div><label>Class</label><select name="class_id"><option value="">— None —</option>' + classOpts + '</select></div>' +
              '<div><label>Teacher</label><select name="teacher_id"><option value="">— None —</option>' + teachOpts + '</select></div>' +
              '<div><label>Room</label><input type="text" name="room" value="' + esc(editData ? editData.room || '' : '') + '" placeholder="Room number"></div>' +
              '<div><label>Start Time</label><input type="time" name="start_time" value="' + esc(editData ? editData.start_time || '' : '') + '"></div>' +
              '<div><label>End Time</label><input type="time" name="end_time" value="' + esc(editData ? editData.end_time || '' : '') + '"></div>' +
              '<div><label>Term</label><input type="text" name="term" value="' + esc(editData ? editData.term || '' : '') + '" placeholder="e.g. Term 1"></div>' +
              '<div><label>Academic Year</label><input type="text" name="academic_year" value="' + esc(editData ? editData.academic_year || '' : '') + '" placeholder="e.g. 2025"></div>' +
            '</div>' +
            '<div style="margin-top:14px"><label>Notes</label><textarea name="notes" rows="2" placeholder="Optional notes...">' + esc(editData ? editData.notes || '' : '') + '</textarea></div>' +
            '<div style="margin-top:16px;display:flex;gap:8px">' +
              '<button type="submit" class="tt-btn tt-btn-primary">' + (editData ? '💾 Update' : '+ Add Period') + '</button>' +
              (editData ? '<a href="/timetable/manage" class="tt-btn tt-btn-secondary">Cancel</a>' : '') +
            '</div>' +
          '</form>' +
        '</div>' +
        '<div class="card" style="padding:20px">' +
          '<h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">📋 All Periods (' + entries.length + ')</h3>' +
          '<div style="overflow-x:auto"><table class="tt-table">' +
            '<thead><tr><th>Day</th><th>Per</th><th>Subject</th><th>Class</th><th>Teacher</th><th>Room</th><th>Time</th><th>Actions</th></tr></thead>' +
            '<tbody>' + (entryRows || '<tr><td colspan="8" style="text-align:center;color:#94a3b8;padding:30px">No periods configured yet</td></tr>') + '</tbody>' +
          '</table></div>' +
        '</div>' +
      '</div>' +
    '</div>';
    res.send(renderPage('Manage Timetable', html, user, req));
  }));

  // ============================================================
  // ROUTE 3: POST /timetable/manage — Save Timetable Entry
  // ============================================================
  app.post('/timetable/manage', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { id, day_of_week, period_number, class_id, subject_id, teacher_id, room, start_time, end_time, term, academic_year, notes } = req.body;

    if (!day_of_week || !period_number) {
      return res.redirect('/timetable/manage');
    }

    if (id) {
      await pool.query(
        `UPDATE timetable_periods SET day_of_week=$1, period_number=$2, class_id=$3, subject_id=$4,
         teacher_id=$5, room=$6, start_time=$7, end_time=$8, term=$9, academic_year=$10, notes=$11
         WHERE id=$12 AND tenant_id=$13`,
        [parseInt(day_of_week), parseInt(period_number),
         class_id ? parseInt(class_id) : null, subject_id ? parseInt(subject_id) : null,
         teacher_id ? parseInt(teacher_id) : null, room || null, start_time || null, end_time || null,
         term || null, academic_year || null, notes || null, parseInt(id), tid]
      );
      console.log('[TimetableBuilder] Period #' + id + ' updated by ' + user.email);
    } else {
      await pool.query(
        `INSERT INTO timetable_periods (tenant_id, day_of_week, period_number, class_id, subject_id,
         teacher_id, room, start_time, end_time, term, academic_year, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [tid, parseInt(day_of_week), parseInt(period_number),
         class_id ? parseInt(class_id) : null, subject_id ? parseInt(subject_id) : null,
         teacher_id ? parseInt(teacher_id) : null, room || null, start_time || null, end_time || null,
         term || null, academic_year || null, notes || null, user.id]
      );
      console.log('[TimetableBuilder] New period added by ' + user.email);
    }
    res.redirect('/timetable/manage');
  }));

  // Delete period
  app.post('/timetable/manage/delete', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id, id = req.body.id;
    await pool.query('DELETE FROM timetable_periods WHERE id=$1 AND tenant_id=$2', [id, tid]);
    console.log('[TimetableBuilder] Period deleted: ' + id);
    res.redirect('/timetable/manage');
  }));

  // ============================================================
  // ROUTE 4: GET /timetable/lessons — Lesson Planning
  // ============================================================
  app.get('/timetable/lessons', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const selSubject = req.query.subject_id || '';

    const subjects = (await pool.query('SELECT id, name FROM subjects WHERE tenant_id=$1 ORDER BY name', [tid])).rows;
    const classes = (await pool.query('SELECT id, name FROM classes WHERE tenant_id=$1 ORDER BY name', [tid])).rows;

    let where = ['tenant_id=$1'], params = [tid], pi = 2;
    if (selSubject) { where.push('subject_id=$' + pi++); params.push(selSubject); }

    let lessonRows = '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:30px">No lesson plans yet</td></tr>';
    try {
      const lessons = (await pool.query(
        `SELECT lp.*, s.name as subject_name, c.name as class_name
         FROM lesson_plans lp
         LEFT JOIN subjects s ON s.id = lp.subject_id AND s.tenant_id = lp.tenant_id
         LEFT JOIN classes c ON c.id = lp.class_id AND c.tenant_id = lp.tenant_id
         WHERE ${where.join(' AND ')} ORDER BY lp.created_at DESC LIMIT 100`, params
      )).rows;

      lessonRows = lessons.map(l => '<tr>' +
        '<td><strong>' + esc(l.title || '—') + '</strong></td>' +
        '<td>' + esc(l.subject_name || '—') + '</td>' +
        '<td>' + esc(l.class_name || '—') + '</td>' +
        '<td class="muted">' + fmtDate(l.lesson_date) + '</td>' +
        '<td><span class="muted" style="font-size:11px">' + (l.objectives ? esc(l.objectives).substring(0, 60) + '...' : '—') + '</span></td>' +
        '<td class="muted">' + fmtDateTime(l.created_at) + '</td>' +
      '</tr>').join('');
    } catch (e) {
      // lesson_plans table may not exist yet
    }

    const subjectOpts = subjects.map(s => '<option value="' + s.id + '" ' + (selSubject == s.id ? 'selected' : '') + '>' + esc(s.name) + '</option>').join('');
    const classOpts = classes.map(c => '<option value="' + c.id + '">' + esc(c.name) + '</option>').join('');

    const html = TT_CSS + '<div style="max-width:1200px;margin:0 auto">' +
      nav('lessons') +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">' +
        '<div><h1 style="font-size:24px;color:#1e293b">📚 Lesson Plans</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Plan and manage lesson content</p></div>' +
      '</div>' +
      '<div class="card" style="padding:24px;margin-bottom:20px">' +
        '<h2 style="color:#1e293b;margin:0 0 16px">+ Create Lesson Plan</h2>' +
        '<form method="POST" action="/timetable/lessons" class="tt-form-grid tt-form">' +
          '<div><label>Title *</label><input type="text" name="title" required placeholder="Lesson title"></div>' +
          '<div><label>Subject</label><select name="subject_id"><option value="">— Select —</option>' + subjectOpts + '</select></div>' +
          '<div><label>Class</label><select name="class_id"><option value="">— Select —</option>' + classOpts + '</select></div>' +
          '<div><label>Lesson Date</label><input type="date" name="lesson_date" value="' + today() + '"></div>' +
          '<div class="full"><label>Objectives</label><textarea name="objectives" rows="2" placeholder="Learning objectives..."></textarea></div>' +
          '<div class="full"><label>Content / Notes</label><textarea name="content" rows="4" placeholder="Lesson content..."></textarea></div>' +
          '<div class="full"><label>Resources</label><input type="text" name="resources" placeholder="Textbooks, materials, links..."></div>' +
          '<div><button type="submit" class="tt-btn tt-btn-primary">💾 Save Lesson Plan</button></div>' +
        '</form>' +
      '</div>' +
      '<div class="card" style="padding:20px">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">' +
          '<h3 style="font-size:15px;color:#1e293b;margin:0">📋 Existing Plans</h3>' +
          '<select onchange="location.href=\'/timetable/lessons?subject_id=\'+this.value" style="padding:6px 12px;border:2px solid #e2e8f0;border-radius:8px;font-size:13px">' +
            '<option value="">All Subjects</option>' + subjectOpts +
          '</select>' +
        '</div>' +
        '<div style="overflow-x:auto"><table class="tt-table">' +
          '<thead><tr><th>Title</th><th>Subject</th><th>Class</th><th>Date</th><th>Objectives</th><th>Created</th></tr></thead>' +
          '<tbody>' + lessonRows + '</tbody>' +
        '</table></div>' +
      '</div>' +
    '</div>';
    res.send(renderPage('Lesson Plans', html, user, req));
  }));

  // ============================================================
  // ROUTE 5: POST /timetable/lessons — Save Lesson Plan
  // ============================================================
  app.post('/timetable/lessons', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { title, subject_id, class_id, lesson_date, objectives, content, resources } = req.body;
    if (!title || !title.trim()) return res.redirect('/timetable/lessons');

    try {
      await pool.query(
        `INSERT INTO lesson_plans (tenant_id, title, subject_id, class_id, lesson_date, objectives, content, resources, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [tid, title.trim(), subject_id ? parseInt(subject_id) : null, class_id ? parseInt(class_id) : null,
         lesson_date || null, objectives || null, content || null, resources || null, user.id]
      );
      console.log('[TimetableBuilder] Lesson plan "' + title.trim() + '" created by ' + user.email);
    } catch (e) {
      console.error('[TimetableBuilder] Error saving lesson plan:', e.message);
    }
    res.redirect('/timetable/lessons');
  }));

  // ============================================================
  // ROUTE 6: GET /timetable/live — Live Class Sessions
  // ============================================================
  app.get('/timetable/live', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const statusFilter = req.query.status || '';

    const classes = (await pool.query('SELECT id, name FROM classes WHERE tenant_id=$1 ORDER BY name', [tid])).rows;
    const subjects = (await pool.query('SELECT id, name FROM subjects WHERE tenant_id=$1 ORDER BY name', [tid])).rows;

    let where = ['tenant_id=$1'], params = [tid], pi = 2;
    if (statusFilter) { where.push('status=$' + pi++); params.push(statusFilter); }

    let liveRows = '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:30px">No live class sessions</td></tr>';
    try {
      const liveClasses = (await pool.query(
        `SELECT lc.*, s.name as subject_name, c.name as class_name, u.name as teacher_name
         FROM live_classes lc
         LEFT JOIN subjects s ON s.id = lc.subject_id AND s.tenant_id = lc.tenant_id
         LEFT JOIN classes c ON c.id = lc.class_id AND c.tenant_id = lc.tenant_id
         LEFT JOIN users u ON u.id = lc.teacher_id
         WHERE ${where.join(' AND ')} ORDER BY lc.scheduled_at DESC LIMIT 100`, params
      )).rows;

      liveRows = liveClasses.map(lc => '<tr>' +
        '<td><strong>' + esc(lc.title || '—') + '</strong></td>' +
        '<td>' + esc(lc.subject_name || '—') + '</td>' +
        '<td>' + esc(lc.class_name || '—') + '</td>' +
        '<td>' + esc(lc.teacher_name || '—') + '</td>' +
        '<td>' + liveStatusBadge(lc.status) + '</td>' +
        '<td>' + fmtDateTime(lc.scheduled_at) + '</td>' +
        (lc.meeting_url ? '<td><a href="' + esc(lc.meeting_url) + '" target="_blank" class="btn btn-sm btn-green">Join</a></td>' : '<td>—</td>') +
      '</tr>').join('');
    } catch (e) {
      // live_classes table may not exist yet
    }

    const classOpts = classes.map(c => '<option value="' + c.id + '">' + esc(c.name) + '</option>').join('');
    const subOpts = subjects.map(s => '<option value="' + s.id + '">' + esc(s.name) + '</option>').join('');

    const html = TT_CSS + '<div style="max-width:1200px;margin:0 auto">' +
      nav('live') +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">' +
        '<div><h1 style="font-size:24px;color:#1e293b">🔴 Live Classes</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Schedule and manage virtual class sessions</p></div>' +
      '</div>' +
      '<div class="card" style="padding:24px;margin-bottom:20px">' +
        '<h2 style="color:#1e293b;margin:0 0 16px">+ Schedule Live Class</h2>' +
        '<form method="POST" action="/timetable/live" class="tt-form-grid tt-form">' +
          '<div><label>Title *</label><input type="text" name="title" required placeholder="Session title"></div>' +
          '<div><label>Subject</label><select name="subject_id"><option value="">— Select —</option>' + subOpts + '</select></div>' +
          '<div><label>Class</label><select name="class_id"><option value="">— Select —</option>' + classOpts + '</select></div>' +
          '<div><label>Scheduled At</label><input type="datetime-local" name="scheduled_at"></div>' +
          '<div><label>Duration (min)</label><input type="number" name="duration" value="60" min="15" max="300"></div>' +
          '<div><label>Meeting URL</label><input type="url" name="meeting_url" placeholder="https://zoom.us/j/..."></div>' +
          '<div class="full"><label>Description</label><textarea name="description" rows="2" placeholder="Session description..."></textarea></div>' +
          '<div><button type="submit" class="tt-btn tt-btn-primary">📅 Schedule Class</button></div>' +
        '</form>' +
      '</div>' +
      '<div class="card" style="padding:20px">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">' +
          '<h3 style="font-size:15px;color:#1e293b;margin:0">📋 Sessions</h3>' +
          '<div style="display:flex;gap:6px">' +
            ['all','scheduled','live','completed','cancelled'].map(s =>
              '<a href="/timetable/live?status=' + (s === 'all' ? '' : s) + '" class="btn btn-sm ' + (statusFilter === s || (!statusFilter && s === 'all') ? 'btn-blue' : '') + '" style="font-size:11px">' + s.charAt(0).toUpperCase() + s.slice(1) + '</a>'
            ).join('') +
          '</div>' +
        '</div>' +
        '<div style="overflow-x:auto"><table class="tt-table">' +
          '<thead><tr><th>Title</th><th>Subject</th><th>Class</th><th>Teacher</th><th>Status</th><th>Scheduled</th><th>Action</th></tr></thead>' +
          '<tbody>' + liveRows + '</tbody>' +
        '</table></div>' +
      '</div>' +
    '</div>';
    res.send(renderPage('Live Classes', html, user, req));
  }));

  // ============================================================
  // ROUTE 7: POST /timetable/live — Schedule Live Class
  // ============================================================
  app.post('/timetable/live', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { title, subject_id, class_id, scheduled_at, duration, meeting_url, description } = req.body;
    if (!title || !title.trim()) return res.redirect('/timetable/live');

    try {
      await pool.query(
        `INSERT INTO live_classes (tenant_id, title, subject_id, class_id, scheduled_at, duration, meeting_url, description, teacher_id, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'scheduled')`,
        [tid, title.trim(), subject_id ? parseInt(subject_id) : null, class_id ? parseInt(class_id) : null,
         scheduled_at || null, parseInt(duration) || 60, meeting_url || null, description || null, user.id]
      );
      console.log('[TimetableBuilder] Live class "' + title.trim() + '" scheduled by ' + user.email);
    } catch (e) {
      console.error('[TimetableBuilder] Error scheduling live class:', e.message);
    }
    res.redirect('/timetable/live');
  }));

  // ============================================================
  // ROUTE 8: GET /timetable/conflicts — Timetable Conflicts
  // ============================================================
  app.get('/timetable/conflicts', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    // Auto-detect conflicts: teacher double-booking, room double-booking
    const teacherConflicts = (await pool.query(
      `SELECT tp1.id as p1_id, tp2.id as p2_id, tp1.day_of_week, tp1.period_number,
              u1.name as teacher_name,
              s1.name as subject1, c1.name as class1,
              s2.name as subject2, c2.name as class2
       FROM timetable_periods tp1
       JOIN timetable_periods tp2 ON tp1.tenant_id = tp2.tenant_id
         AND tp1.day_of_week = tp2.day_of_week AND tp1.period_number = tp2.period_number
         AND tp1.teacher_id = tp2.teacher_id AND tp1.id < tp2.id
         AND tp1.teacher_id IS NOT NULL
       LEFT JOIN subjects s1 ON s1.id = tp1.subject_id
       LEFT JOIN subjects s2 ON s2.id = tp2.subject_id
       LEFT JOIN classes c1 ON c1.id = tp1.class_id
       LEFT JOIN classes c2 ON c2.id = tp2.class_id
       LEFT JOIN users u1 ON u1.id = tp1.teacher_id
       WHERE tp1.tenant_id=$1`, [tid]
    )).rows;

    const roomConflicts = (await pool.query(
      `SELECT tp1.id as p1_id, tp2.id as p2_id, tp1.day_of_week, tp1.period_number,
              tp1.room,
              s1.name as subject1, c1.name as class1,
              s2.name as subject2, c2.name as class2
       FROM timetable_periods tp1
       JOIN timetable_periods tp2 ON tp1.tenant_id = tp2.tenant_id
         AND tp1.day_of_week = tp2.day_of_week AND tp1.period_number = tp2.period_number
         AND tp1.room = tp2.room AND tp1.id < tp2.id
         AND tp1.room IS NOT NULL AND tp1.room != ''
       LEFT JOIN subjects s1 ON s1.id = tp1.subject_id
       LEFT JOIN subjects s2 ON s2.id = tp2.subject_id
       LEFT JOIN classes c1 ON c1.id = tp1.class_id
       LEFT JOIN classes c2 ON c2.id = tp2.class_id
       WHERE tp1.tenant_id=$1`, [tid]
    )).rows;

    // Save detected conflicts
    const allDetected = [];
    for (const tc of teacherConflicts) {
      const desc = 'Teacher "' + (tc.teacher_name || 'Unknown') + '" double-booked on ' + DAY_NAMES_SHORT[(tc.day_of_week || 1) - 1] + ' P' + (tc.period_number || 1) + ': ' + (tc.subject1 || '—') + ' (' + (tc.class1 || '—') + ') vs ' + (tc.subject2 || '—') + ' (' + (tc.class2 || '—') + ')';
      allDetected.push({ period1_id: tc.p1_id, period2_id: tc.p2_id, conflict_type: 'teacher_double_booking', description: desc });
    }
    for (const rc of roomConflicts) {
      const desc = 'Room "' + (rc.room || 'Unknown') + '" double-booked on ' + DAY_NAMES_SHORT[(rc.day_of_week || 1) - 1] + ' P' + (rc.period_number || 1) + ': ' + (rc.subject1 || '—') + ' (' + (rc.class1 || '—') + ') vs ' + (rc.subject2 || '—') + ' (' + (rc.class2 || '—') + ')';
      allDetected.push({ period1_id: rc.p1_id, period2_id: rc.p2_id, conflict_type: 'room_double_booking', description: desc });
    }

    // Get existing conflicts from DB
    const existingConflicts = (await pool.query(
      'SELECT * FROM timetable_conflicts WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 100', [tid]
    )).rows;

    const conflictRows = existingConflicts.map(cf => '<tr class="tt-conflict-row">' +
      '<td>' + conflictBadge(cf.resolved) + '</td>' +
      '<td><span class="badge" style="background:#fef3c7;color:#b45309;font-size:11px">' + esc(cf.conflict_type || '—') + '</span></td>' +
      '<td style="font-size:12px">' + esc(cf.description || '—') + '</td>' +
      '<td class="muted">' + fmtDateTime(cf.created_at) + '</td>' +
      '<td>' +
        (!cf.resolved ? '<form method="POST" action="/timetable/conflicts/resolve" style="display:inline">' +
          '<input type="hidden" name="id" value="' + cf.id + '">' +
          '<button class="btn btn-sm btn-green" type="submit">Resolve</button></form>' : '—') +
      '</td>' +
    '</tr>').join('');

    const totalOpen = existingConflicts.filter(c => !c.resolved).length;
    const totalResolved = existingConflicts.filter(c => c.resolved).length;

    const html = TT_CSS + '<div style="max-width:1200px;margin:0 auto">' +
      nav('conflicts') +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">' +
        '<div><h1 style="font-size:24px;color:#1e293b">⚠️ Timetable Conflicts</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Detect and resolve scheduling conflicts</p></div>' +
        '<div style="display:flex;gap:8px">' +
          '<a href="/timetable/manage" class="tt-btn tt-btn-secondary">⚙️ Manage Periods</a>' +
        '</div>' +
      '</div>' +
      '<div class="stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:14px;margin-bottom:20px">' +
        '<div class="stat-card"><div class="stat-num" style="color:#dc2626">' + totalOpen + '</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Open Conflicts</div></div>' +
        '<div class="stat-card"><div class="stat-num" style="color:#16a34a">' + totalResolved + '</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Resolved</div></div>' +
        '<div class="stat-card"><div class="stat-num" style="color:#f59e0b">' + teacherConflicts.length + '</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Teacher Conflicts</div></div>' +
        '<div class="stat-card"><div class="stat-num" style="color:#8b5cf6">' + roomConflicts.length + '</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Room Conflicts</div></div>' +
      '</div>' +
      '<div class="card" style="padding:20px">' +
        '<h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">📋 All Conflicts (' + existingConflicts.length + ')</h3>' +
        '<div style="overflow-x:auto"><table class="tt-table">' +
          '<thead><tr><th>Status</th><th>Type</th><th>Description</th><th>Detected</th><th>Action</th></tr></thead>' +
          '<tbody>' + (conflictRows || '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:30px">No conflicts detected</td></tr>') + '</tbody>' +
        '</table></div>' +
      '</div>' +
    '</div>';
    res.send(renderPage('Timetable Conflicts', html, user, req));
  }));

  // Resolve conflict
  app.post('/timetable/conflicts/resolve', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id, id = req.body.id;
    await pool.query('UPDATE timetable_conflicts SET resolved=true WHERE id=$1 AND tenant_id=$2', [id, tid]);
    console.log('[TimetableBuilder] Conflict #' + id + ' resolved');
    res.redirect('/timetable/conflicts');
  }));

  // ============================================================
  // ROUTE 9: GET /timetable/print — Print-Friendly Timetable
  // ============================================================
  app.get('/timetable/print', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const selClass = req.query.class_id || '';
    const selTerm = req.query.term || '';

    const classes = (await pool.query('SELECT id, name FROM classes WHERE tenant_id=$1 ORDER BY name', [tid])).rows;

    let where = ['tp.tenant_id=$1'], params = [tid], pi = 2;
    if (selClass) { where.push('tp.class_id=$' + pi++); params.push(selClass); }
    if (selTerm) { where.push('tp.term=$' + pi++); params.push(selTerm); }

    const periods = (await pool.query(
      `SELECT tp.*, s.name as subject_name, c.name as class_name, u.name as teacher_name
       FROM timetable_periods tp
       LEFT JOIN subjects s ON s.id = tp.subject_id AND s.tenant_id = tp.tenant_id
       LEFT JOIN classes c ON c.id = tp.class_id AND c.tenant_id = tp.tenant_id
       LEFT JOIN users u ON u.id = tp.teacher_id
       WHERE ${where.join(' AND ')}
       ORDER BY tp.day_of_week, tp.period_number`, params
    )).rows;

    const maxPeriod = periods.length ? Math.max(...periods.map(p => p.period_number)) : 8;
    const totalPeriods = Math.max(maxPeriod, 8);

    // Build print grid
    const printHeader = '<tr><th>Time</th>' + DAY_NAMES_SHORT.map(d => '<th>' + d + '</th>').join('') + '</tr>';
    const printRows = [];
    for (let pn = 1; pn <= totalPeriods; pn++) {
      let cells = '';
      for (let di = 1; di <= DAYS.length; di++) {
        const p = periods.find(pp => pp.day_of_week === di && pp.period_number === pn);
        if (p) {
          cells += '<td style="background:#f8fafc;vertical-align:top"><strong style="font-size:11px;color:#4f46e5">' + esc(p.subject_name || '') + '</strong><br><span style="font-size:10px;color:#64748b">' + esc(p.teacher_name || '') + '<br>' + esc(p.room || '') + '</span></td>';
        } else {
          cells += '<td></td>';
        }
      }
      printRows.push('<tr><td style="background:#f1f5f9;font-weight:700;font-size:12px;text-align:center">P' + pn + '</td>' + cells + '</tr>');
    }

    const classOpts = classes.map(c => '<option value="' + c.id + '" ' + (selClass == c.id ? 'selected' : '') + '>' + esc(c.name) + '</option>').join('');

    const html = TT_CSS + '<div style="max-width:1200px;margin:0 auto">' +
      nav('print') +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px" class="tt-filter">' +
        '<div><label>Class</label><select onchange="location.href=\'/timetable/print?class_id=\'+this.value">' +
          '<option value="">All Classes</option>' + classOpts + '</select></div>' +
        '<div><label>Term</label><input type="text" value="' + esc(selTerm) + '" placeholder="Term filter" onchange="location.href=\'/timetable/print?class_id=' + esc(selClass) + '&term=\'+this.value"></div>' +
        '<div style="align-self:end"><button class="tt-btn tt-btn-primary" onclick="window.print()">🖨️ Print Timetable</button></div>' +
      '</div>' +
      '<div class="card tt-print" style="padding:30px">' +
        '<div style="text-align:center;margin-bottom:20px">' +
          '<h2 style="margin:0">Class Timetable</h2>' +
          '<p style="color:#64748b;font-size:13px;margin-top:4px">' + (selClass ? esc(classes.find(c => c.id == selClass)?.name || '') + ' — ' : '') + 'Academic Year ' + (selTerm || new Date().getFullYear()) + '</p>' +
        '</div>' +
        '<table>' +
          '<thead>' + printHeader + '</thead>' +
          '<tbody>' + printRows.join('') + '</tbody>' +
        '</table>' +
        '<div style="margin-top:20px;text-align:center;font-size:11px;color:#94a3b8">Generated on ' + fmtDateTime(new Date()) + '</div>' +
      '</div>' +
    '</div>';
    res.send(renderPage('Print Timetable', html, user, req));
  }));

  // ============================================================
  // ROUTE 10: GET /timetable/api/schedule — JSON API
  // ============================================================
  app.get('/timetable/api/schedule', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const selClass = req.query.class_id || '';
    const selDay = req.query.day_of_week || '';

    let where = ['tp.tenant_id=$1'], params = [tid], pi = 2;
    if (selClass) { where.push('tp.class_id=$' + pi++); params.push(selClass); }
    if (selDay) { where.push('tp.day_of_week=$' + pi++); params.push(parseInt(selDay)); }

    const periods = (await pool.query(
      `SELECT tp.*, s.name as subject_name, c.name as class_name, u.name as teacher_name
       FROM timetable_periods tp
       LEFT JOIN subjects s ON s.id = tp.subject_id AND s.tenant_id = tp.tenant_id
       LEFT JOIN classes c ON c.id = tp.class_id AND c.tenant_id = tp.tenant_id
       LEFT JOIN users u ON u.id = tp.teacher_id
       WHERE ${where.join(' AND ')}
       ORDER BY tp.day_of_week, tp.period_number`, params
    )).rows;

    res.json({ success: true, count: periods.length, data: periods });
  }));

  // ============================================================
  // NEW DATABASE MIGRATIONS
  // ============================================================
  (async () => {
    const c = await pool.connect().catch(() => null);
    if (!c) { console.error('[TimetableBuilder] Cannot connect to DB for new migrations'); return; }
    try {
      await c.query(`CREATE TABLE IF NOT EXISTS timetable_substitutions (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        original_period_id INTEGER NOT NULL,
        substitute_teacher_id INTEGER NOT NULL,
        reason TEXT,
        date DATE NOT NULL DEFAULT CURRENT_DATE,
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_ts_tenant ON timetable_substitutions(tenant_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_ts_date ON timetable_substitutions(tenant_id, date)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_ts_status ON timetable_substitutions(tenant_id, status)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_ts_original ON timetable_substitutions(original_period_id)`);
      console.log('[TimetableBuilder] New migrations applied successfully');
    } catch (e) { console.error('[TimetableBuilder] New migration error:', e.message); }
    finally { c.release(); }
  })();

  // -- dark mode CSS addon ------------------------------------------------
  const TT_DARK_CSS = '<style>\n\
@media(prefers-color-scheme:dark){\n\
  .tt-nav a{background:#1e293b;color:#94a3b8}\n\
  .tt-nav a:hover{background:#334155}.tt-nav a.active{background:#4f46e5;color:#fff}\n\
  .tt-btn-secondary{background:#334155;color:#cbd5e1}\n\
  .tt-grid-header{background:#0f172a;color:#94a3b8}\n\
  .tt-grid-day{background:#0f172a;color:#e2e8f0}\n\
  .tt-cell{background:#1e293b}\n\
  .tt-cell:hover{background:#334155}\n\
  .tt-period{background:#1e1b4b;border-left-color:#6366f1}\n\
  .tt-period:hover{box-shadow:0 2px 8px rgba(99,102,241,.2)}\n\
  .tt-period-title{color:#a5b4fc}\n\
  .tt-period-meta{color:#94a3b8}\n\
  .tt-table th{background:#0f172a;color:#94a3b8}\n\
  .tt-table td{color:#cbd5e1;border-bottom-color:#1e293b}\n\
  .tt-table tr:hover{background:#1e293b}\n\
  .tt-filter label{color:#94a3b8}\n\
  .tt-filter input,.tt-filter select{background:#0f172a;border-color:#334155;color:#e2e8f0}\n\
  .tt-form label{color:#94a3b8}\n\
  .tt-form input,.tt-form select,.tt-form textarea{background:#0f172a;border-color:#334155;color:#e2e8f0}\n\
}\n\
</style>';

  // -- substitution status badge -------------------------------------------
  function subStatusBadge(status) {
    const m = {
      pending: { bg: '#fef3c7', c: '#92400e', l: 'Pending' },
      completed: { bg: '#dcfce7', c: '#16a34a', l: 'Completed' },
      cancelled: { bg: '#fee2e2', c: '#dc2626', l: 'Cancelled' }
    };
    const v = m[status] || m.pending;
    return '<span class="badge" style="background:' + v.bg + ';color:' + v.c + '">' + v.l + '</span>';
  }

  // -- extended navigation helper ------------------------------------------
  const navExt = (active) => '<div class="tt-nav">' +
    '<a href="/timetable" class="' + (active === 'dash' ? 'active' : '') + '">📅 Timetable</a>' +
    '<a href="/timetable/manage" class="' + (active === 'manage' ? 'active' : '') + '">⚙️ Manage</a>' +
    '<a href="/timetable/lessons" class="' + (active === 'lessons' ? 'active' : '') + '">📚 Lessons</a>' +
    '<a href="/timetable/live" class="' + (active === 'live' ? 'active' : '') + '">🔴 Live Classes</a>' +
    '<a href="/timetable/substitutions" class="' + (active === 'substitutions' ? 'active' : '') + '">🔄 Substitutions</a>' +
    '<a href="/timetable/rooms" class="' + (active === 'rooms' ? 'active' : '') + '">🏢 Rooms</a>' +
    '<a href="/timetable/bulk-import" class="' + (active === 'bulk-import' ? 'active' : '') + '">📥 Bulk Import</a>' +
    '<a href="/timetable/conflicts" class="' + (active === 'conflicts' ? 'active' : '') + '">⚠️ Conflicts</a>' +
    '<a href="/timetable/print" class="' + (active === 'print' ? 'active' : '') + '">🖨️ Print</a>' +
    '</div>';

  // ============================================================
  // SUBSTITUTION MANAGEMENT
  // ============================================================
  // ROUTE: GET /timetable/substitutions — View/manage teacher substitutions
  app.get('/timetable/substitutions', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const statusFilter = req.query.status || '';

    const teachers = (await pool.query(
      "SELECT id, name, email FROM users WHERE tenant_id=$1 AND (role='teacher' OR role='admin') ORDER BY name", [tid]
    )).rows;

    let where = ['ts.tenant_id=$1'], params = [tid], pi = 2;
    if (statusFilter) { where.push('ts.status=$' + pi++); params.push(statusFilter); }

    const substitutions = (await pool.query(
      `SELECT ts.*,
              tp.day_of_week, tp.period_number, tp.room, tp.start_time, tp.end_time,
              s.name as subject_name, c.name as class_name,
              u_orig.name as original_teacher_name,
              u_sub.name as substitute_teacher_name
       FROM timetable_substitutions ts
       LEFT JOIN timetable_periods tp ON tp.id = ts.original_period_id
       LEFT JOIN subjects s ON s.id = tp.subject_id
       LEFT JOIN classes c ON c.id = tp.class_id
       LEFT JOIN users u_orig ON u_orig.id = tp.teacher_id
       LEFT JOIN users u_sub ON u_sub.id = ts.substitute_teacher_id
       WHERE ${where.join(' AND ')}
       ORDER BY ts.date DESC, ts.created_at DESC`,
      params
    )).rows;

    const rowsHtml = substitutions.map(s => '<tr>' +
      '<td>' + fmtDate(s.date) + '</td>' +
      '<td>' + DAY_NAMES_SHORT[(s.day_of_week || 1) - 1] + ' P' + (s.period_number || '') + '</td>' +
      '<td><strong>' + esc(s.subject_name || '—') + '</strong></td>' +
      '<td>' + esc(s.class_name || '—') + '</td>' +
      '<td>' + esc(s.original_teacher_name || '—') + '</td>' +
      '<td style="color:#4f46e5;font-weight:600">' + esc(s.substitute_teacher_name || '—') + '</td>' +
      '<td>' + esc(s.room || '') + '</td>' +
      '<td>' + subStatusBadge(s.status) + '</td>' +
      '<td>' +
        '<form method="POST" action="/timetable/substitutions/' + s.id + '/complete" style="display:inline" onsubmit="return confirm(\'Mark as completed?\')">' +
          '<button type="submit" class="btn btn-sm btn-green" style="font-size:10px"' + (s.status === 'completed' ? ' disabled' : '') + '>✓</button>' +
        '</form>' +
      '</td>' +
    '</tr>').join('');

    const periods = (await pool.query(
      `SELECT tp.id, tp.day_of_week, tp.period_number, u.name as teacher_name, s.name as subject_name, c.name as class_name
       FROM timetable_periods tp
       LEFT JOIN users u ON u.id = tp.teacher_id
       LEFT JOIN subjects s ON s.id = tp.subject_id
       LEFT JOIN classes c ON c.id = tp.class_id
       WHERE tp.tenant_id = $1
       ORDER BY tp.day_of_week, tp.period_number`,
      [tid]
    )).rows;

    const periodOpts = periods.map(p => '<option value="' + p.id + '">' + DAY_NAMES_SHORT[(p.day_of_week || 1) - 1] + ' P' + (p.period_number || '') + ' — ' + esc(p.teacher_name || 'N/A') + ' (' + esc(p.subject_name || '') + ' ' + esc(p.class_name || '') + ')</option>').join('');
    const teachOpts = teachers.map(t => '<option value="' + t.id + '">' + esc(t.name) + '</option>').join('');

    const html = TT_CSS + TT_DARK_CSS + '<div style="max-width:1300px;margin:0 auto">' +
      navExt('substitutions') +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">' +
        '<div><h1 style="font-size:24px;color:#1e293b">🔄 Substitutions</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Manage teacher absences and replacements</p></div>' +
        '<div style="display:flex;gap:6px">' +
          ['all','pending','completed','cancelled'].map(s =>
            '<a href="/timetable/substitutions?status=' + (s === 'all' ? '' : s) + '" class="btn btn-sm ' + (statusFilter === s || (!statusFilter && s === 'all') ? 'btn-blue' : '') + '" style="font-size:11px">' + s.charAt(0).toUpperCase() + s.slice(1) + '</a>'
          ).join('') +
        '</div>' +
      '</div>' +
      '<div class="stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:14px;margin-bottom:20px">' +
        '<div class="stat-card"><div class="stat-num" style="color:#f59e0b">' + substitutions.filter(s => s.status === 'pending').length + '</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Pending</div></div>' +
        '<div class="stat-card"><div class="stat-num" style="color:#16a34a">' + substitutions.filter(s => s.status === 'completed').length + '</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Completed</div></div>' +
        '<div class="stat-card"><div class="stat-num" style="color:#3b82f6">' + substitutions.length + '</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Total</div></div>' +
      '</div>' +
      '<div class="card" style="padding:24px;margin-bottom:20px">' +
        '<h2 style="color:#1e293b;margin:0 0 16px">+ Create Substitution</h2>' +
        '<form method="POST" action="/timetable/substitutions" class="tt-form-grid tt-form">' +
          '<div class="full"><label>Original Period (absent teacher) *</label><select name="original_period_id" required>' + periodOpts + '</select></div>' +
          '<div><label>Substitute Teacher *</label><select name="substitute_teacher_id" required><option value="">— Select —</option>' + teachOpts + '</select></div>' +
          '<div><label>Date *</label><input type="date" name="date" value="' + today() + '" required></div>' +
          '<div class="full"><label>Reason</label><input type="text" name="reason" placeholder="Sick leave, conference, etc."></div>' +
          '<div><button type="submit" class="tt-btn tt-btn-primary">🔄 Create Substitution</button></div>' +
        '</form>' +
      '</div>' +
      '<div class="card" style="padding:20px">' +
        '<h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">📋 All Substitutions (' + substitutions.length + ')</h3>' +
        '<div style="overflow-x:auto"><table class="tt-table">' +
          '<thead><tr><th>Date</th><th>Period</th><th>Subject</th><th>Class</th><th>Absent</th><th>Substitute</th><th>Room</th><th>Status</th><th></th></tr></thead>' +
          '<tbody>' + (rowsHtml || '<tr><td colspan="9" style="text-align:center;color:#94a3b8;padding:30px">No substitutions yet</td></tr>') + '</tbody>' +
        '</table></div>' +
      '</div>' +
    '</div>';
    res.send(renderPage('Teacher Substitutions', html, user, req));
  }));

  // ROUTE: POST /timetable/substitutions — Create substitution
  app.post('/timetable/substitutions', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { original_period_id, substitute_teacher_id, date, reason } = req.body;

    if (!original_period_id || !substitute_teacher_id || !date) {
      return res.redirect('/timetable/substitutions');
    }

    try {
      await pool.query(
        `INSERT INTO timetable_substitutions (tenant_id, original_period_id, substitute_teacher_id, reason, date, status)
         VALUES ($1, $2, $3, $4, $5, 'pending')`,
        [tid, parseInt(original_period_id), parseInt(substitute_teacher_id), reason || null, date || today()]
      );
      console.log('[TimetableBuilder] Substitution created by ' + user.email);
    } catch (e) {
      console.error('[TimetableBuilder] Error creating substitution:', e.message);
    }
    res.redirect('/timetable/substitutions');
  }));

  // ROUTE: POST /timetable/substitutions/:id/complete — Mark substitution as completed
  app.post('/timetable/substitutions/:id/complete', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const subId = parseInt(req.params.id);

    await pool.query(
      `UPDATE timetable_substitutions SET status = 'completed' WHERE id = $1 AND tenant_id = $2`,
      [subId, tid]
    );
    console.log('[TimetableBuilder] Substitution #' + subId + ' marked completed');
    res.redirect('/timetable/substitutions');
  }));

  // ROUTE: GET /timetable/substitutions/today — Today's substitutions only
  app.get('/timetable/substitutions/today', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    const todaySubs = (await pool.query(
      `SELECT ts.*,
              tp.day_of_week, tp.period_number, tp.room, tp.start_time, tp.end_time,
              s.name as subject_name, c.name as class_name,
              u_orig.name as original_teacher_name,
              u_sub.name as substitute_teacher_name
       FROM timetable_substitutions ts
       LEFT JOIN timetable_periods tp ON tp.id = ts.original_period_id
       LEFT JOIN subjects s ON s.id = tp.subject_id
       LEFT JOIN classes c ON c.id = tp.class_id
       LEFT JOIN users u_orig ON u_orig.id = tp.teacher_id
       LEFT JOIN users u_sub ON u_sub.id = ts.substitute_teacher_id
       WHERE ts.tenant_id = $1 AND ts.date = CURRENT_DATE AND ts.status = 'pending'
       ORDER BY tp.day_of_week, tp.period_number`,
      [tid]
    )).rows;

    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.json({ success: true, count: todaySubs.length, data: todaySubs });
    }

    const rowsHtml = todaySubs.map(s => '<tr>' +
      '<td>' + DAY_NAMES_SHORT[(s.day_of_week || 1) - 1] + ' P' + (s.period_number || '') + '</td>' +
      '<td>' + fmtTime(s.start_time) + ' - ' + fmtTime(s.end_time) + '</td>' +
      '<td><strong>' + esc(s.subject_name || '—') + '</strong></td>' +
      '<td>' + esc(s.class_name || '—') + '</td>' +
      '<td>' + esc(s.room || '') + '</td>' +
      '<td>' + esc(s.original_teacher_name || '—') + '</td>' +
      '<td style="color:#4f46e5;font-weight:600">' + esc(s.substitute_teacher_name || '—') + '</td>' +
      '<td>' + esc(s.reason || '') + '</td>' +
    '</tr>').join('');

    const html = TT_CSS + TT_DARK_CSS + '<div style="max-width:1200px;margin:0 auto">' +
      navExt('substitutions') +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">' +
        '<div><h1 style="font-size:24px;color:#1e293b">📋 Today\'s Substitutions</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">' + fmtDate(today()) + ' — ' + todaySubs.length + ' active substitution(s)</p></div>' +
        '<a href="/timetable/substitutions" class="tt-btn tt-btn-secondary">View All</a>' +
      '</div>' +
      '<div class="card" style="padding:20px">' +
        '<div style="overflow-x:auto"><table class="tt-table">' +
          '<thead><tr><th>Period</th><th>Time</th><th>Subject</th><th>Class</th><th>Room</th><th>Absent Teacher</th><th>Substitute</th><th>Reason</th></tr></thead>' +
          '<tbody>' + (rowsHtml || '<tr><td colspan="8" style="text-align:center;color:#94a3b8;padding:30px">No substitutions today</td></tr>') + '</tbody>' +
        '</table></div>' +
      '</div>' +
    '</div>';
    res.send(renderPage('Today\'s Substitutions', html, user, req));
  }));

  // ============================================================
  // ROOM ALLOCATION VIEW
  // ============================================================
  // ROUTE: GET /timetable/rooms — View all rooms and their utilization
  app.get('/timetable/rooms', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const selectedDay = req.query.day_of_week || '';

    // Get all rooms
    const rooms = (await pool.query(
      `SELECT DISTINCT room FROM timetable_periods
       WHERE tenant_id = $1 AND room IS NOT NULL AND room != ''
       ORDER BY room`,
      [tid]
    )).rows;

    // For each room, count periods and calculate utilization
    const roomData = [];
    for (const r of rooms) {
      let roomQuery = `SELECT COUNT(*)::int as total_periods,
              COUNT(DISTINCT day_of_week)::int as days_used,
              COUNT(DISTINCT teacher_id)::int as teachers_using
       FROM timetable_periods WHERE tenant_id = $1 AND room = $2`;
      let roomParams = [tid, r.room];
      if (selectedDay) { roomQuery += ' AND day_of_week = $3'; roomParams.push(parseInt(selectedDay)); }

      const stats = (await pool.query(roomQuery, roomParams)).rows[0];

      // Get periods for this room
      let periodQuery = `SELECT tp.*, s.name as subject_name, c.name as class_name, u.name as teacher_name
       FROM timetable_periods tp
       LEFT JOIN subjects s ON s.id = tp.subject_id
       LEFT JOIN classes c ON c.id = tp.class_id
       LEFT JOIN users u ON u.id = tp.teacher_id
       WHERE tp.tenant_id = $1 AND tp.room = $2`;
      let periodParams = [tid, r.room];
      if (selectedDay) { periodQuery += ' AND tp.day_of_week = $3'; periodParams.push(parseInt(selectedDay)); }
      periodQuery += ' ORDER BY tp.day_of_week, tp.period_number';

      const periods = (await pool.query(periodQuery, periodParams)).rows;

      roomData.push({ room: r.room, stats, periods });
    }

    const totalRooms = rooms.length;
    const totalPeriods = roomData.reduce((s, r) => s + r.stats.total_periods, 0);
    const maxCapacity = DAYS.length * 8; // assume 8 periods per day

    const roomRows = roomData.map(rd => {
      const utilization = maxCapacity > 0 ? Math.round(rd.stats.total_periods / maxCapacity * 100) : 0;
      const utilColor = utilization > 80 ? '#ef4444' : utilization > 50 ? '#f59e0b' : '#16a34a';
      return '<tr>' +
        '<td><strong>' + esc(rd.room) + '</strong></td>' +
        '<td>' + rd.stats.total_periods + '</td>' +
        '<td>' + rd.stats.days_used + '/' + DAYS.length + '</td>' +
        '<td>' + rd.stats.teachers_using + '</td>' +
        '<td><div style="display:flex;align-items:center;gap:8px"><div style="flex:1;background:#f1f5f9;border-radius:6px;height:16px;overflow:hidden"><div style="height:100%;width:' + utilization + '%;background:' + utilColor + ';border-radius:6px"></div></div><span style="font-size:11px;font-weight:700;color:' + utilColor + '">' + utilization + '%</span></div></td>' +
      '</tr>';
    }).join('');

    // Day filter options
    const dayFilter = DAYS.map((d, i) =>
      '<option value="' + (i + 1) + '" ' + (selectedDay == (i + 1) ? 'selected' : '') + '>' + d + '</option>'
    ).join('');

    const html = TT_CSS + TT_DARK_CSS + '<div style="max-width:1200px;margin:0 auto">' +
      navExt('rooms') +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">' +
        '<div><h1 style="font-size:24px;color:#1e293b">🏢 Room Allocation</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">View room utilization across the timetable</p></div>' +
        '<div style="display:flex;gap:8px">' +
          '<select onchange="location.href=\'/timetable/rooms?day_of_week=\'+this.value" style="padding:8px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px">' +
            '<option value="">All Days</option>' + dayFilter +
          '</select>' +
          '<a href="/timetable/rooms/availability" class="tt-btn tt-btn-primary">Check Availability</a>' +
        '</div>' +
      '</div>' +
      '<div class="stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:14px;margin-bottom:20px">' +
        '<div class="stat-card"><div class="stat-num" style="color:#4f46e5">' + totalRooms + '</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Total Rooms</div></div>' +
        '<div class="stat-card"><div class="stat-num" style="color:#16a34a">' + totalPeriods + '</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Total Bookings</div></div>' +
      '</div>' +
      '<div class="card" style="padding:20px">' +
        '<h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">📊 Room Utilization (' + totalRooms + ' rooms)</h3>' +
        '<div style="overflow-x:auto"><table class="tt-table">' +
          '<thead><tr><th>Room</th><th>Bookings</th><th>Days Used</th><th>Teachers</th><th>Utilization</th></tr></thead>' +
          '<tbody>' + (roomRows || '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:30px">No rooms configured yet</td></tr>') + '</tbody>' +
        '</table></div>' +
      '</div>' +
    '</div>';
    res.send(renderPage('Room Allocation', html, user, req));
  }));

  // ROUTE: GET /timetable/rooms/availability — Check room availability for a time slot
  app.get('/timetable/rooms/availability', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const selDay = req.query.day_of_week || '1';
    const selPeriod = req.query.period_number || '';

    const rooms = (await pool.query(
      `SELECT DISTINCT room FROM timetable_periods
       WHERE tenant_id = $1 AND room IS NOT NULL AND room != ''
       ORDER BY room`,
      [tid]
    )).rows;

    const results = [];
    for (const r of rooms) {
      const bookings = (await pool.query(
        `SELECT tp.*, s.name as subject_name, c.name as class_name, u.name as teacher_name
         FROM timetable_periods tp
         LEFT JOIN subjects s ON s.id = tp.subject_id
         LEFT JOIN classes c ON c.id = tp.class_id
         LEFT JOIN users u ON u.id = tp.teacher_id
         WHERE tp.tenant_id = $1 AND tp.room = $2 AND tp.day_of_week = $3
         ORDER BY tp.period_number`,
        [tid, r.room, parseInt(selDay)]
      )).rows;

      const available = selPeriod ?
        !bookings.find(b => b.period_number == selPeriod) :
        bookings.length < 8;

      results.push({ room: r.room, bookings, available });
    }

    const resultsHtml = results.map(r => '<div class="card" style="padding:14px;margin-bottom:10px">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">' +
        '<h4 style="margin:0;color:#1e293b">🏢 ' + esc(r.room) + '</h4>' +
        '<span class="badge" style="background:' + (r.available ? '#dcfce7' : '#fee2e2') + ';color:' + (r.available ? '#16a34a' : '#dc2626') + '">' + (r.available ? 'Available' : 'Occupied') + '</span>' +
      '</div>' +
      (r.bookings.length > 0 ?
        '<div style="display:flex;flex-wrap:wrap;gap:6px">' +
        r.bookings.map(b => '<span style="padding:4px 10px;border-radius:6px;font-size:11px;background:' + (b.period_number == selPeriod ? '#fee2e2;color:#dc2626' : '#f1f5f9;color:#475569') + '">P' + (b.period_number || '') + ': ' + esc(b.subject_name || '') + ' (' + esc(b.class_name || '') + ')</span>').join('') +
        '</div>' :
        '<p class="muted" style="font-size:12px">No bookings for this day</p>') +
    '</div>').join('');

    const dayOpts = DAYS.map((d, i) => '<option value="' + (i + 1) + '" ' + (selDay == (i + 1) ? 'selected' : '') + '>' + d + '</option>').join('');

    const html = TT_CSS + TT_DARK_CSS + '<div style="max-width:1000px;margin:0 auto">' +
      navExt('rooms') +
      '<div style="margin-bottom:20px">' +
        '<h1 style="font-size:24px;color:#1e293b">🔍 Room Availability</h1>' +
        '<p style="font-size:13px;color:#94a3b8;margin-top:2px">Find available rooms for a given time slot</p>' +
      '</div>' +
      '<div class="tt-filter" style="background:#f8fafc;padding:14px;border-radius:12px;margin-bottom:20px">' +
        '<div><label>Day</label><select id="daySelect" onchange="location.href=\'/timetable/rooms/availability?day_of_week=\'+this.value+\'&period_number=\'+document.getElementById(\'periodSelect\').value">' + dayOpts + '</select></div>' +
        '<div><label>Period (optional)</label><select id="periodSelect" onchange="location.href=\'/timetable/rooms/availability?day_of_week=\'+document.getElementById(\'daySelect\').value+\'&period_number=\'+this.value">' +
          '<option value="">All Periods</option>' +
          Array.from({length: 12}, (_, i) => '<option value="' + (i + 1) + '" ' + (selPeriod == (i + 1) ? 'selected' : '') + '>Period ' + (i + 1) + '</option>').join('') +
        '</select></div>' +
      '</div>' +
      '<h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">📋 Room Status (' + results.length + ' rooms)</h3>' +
      (resultsHtml || '<div class="card" style="padding:30px;text-align:center;color:#94a3b8">No rooms configured</div>') +
    '</div>';
    res.send(renderPage('Room Availability', html, user, req));
  }));

  // ============================================================
  // TEACHER AVAILABILITY
  // ============================================================
  // ROUTE: GET /timetable/teacher-availability/:id — Show teacher's free/busy slots
  app.get('/timetable/teacher-availability/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const teacherId = parseInt(req.params.id);

    const teacher = (await pool.query(
      "SELECT id, name, email FROM users WHERE id=$1 AND tenant_id=$2",
      [teacherId, tid]
    )).rows[0];

    if (!teacher) {
      return res.status(404).send('Teacher not found');
    }

    const periods = (await pool.query(
      `SELECT tp.*, s.name as subject_name, c.name as class_name, tp.room
       FROM timetable_periods tp
       LEFT JOIN subjects s ON s.id = tp.subject_id
       LEFT JOIN classes c ON c.id = tp.class_id
       WHERE tp.tenant_id = $1 AND tp.teacher_id = $2
       ORDER BY tp.day_of_week, tp.period_number`,
      [tid, teacherId]
    )).rows;

    // Check for blocked slots (substitutions where this teacher is substitute today)
    const blockedSlots = (await pool.query(
      `SELECT ts.date, tp.day_of_week, tp.period_number
       FROM timetable_substitutions ts
       JOIN timetable_periods tp ON tp.id = ts.original_period_id
       WHERE ts.tenant_id = $1 AND ts.substitute_teacher_id = $2 AND ts.status = 'pending'`,
      [tid, teacherId]
    )).rows;

    // Build availability grid
    let gridHtml = '';
    for (let day = 1; day <= DAYS.length; day++) {
      const dayPeriods = periods.filter(p => p.day_of_week === day);
      const maxP = Math.max(...periods.map(p => p.period_number || 0), 8);

      gridHtml += '<div style="margin-bottom:12px"><div style="font-weight:700;font-size:13px;color:#4f46e5;margin-bottom:6px">' + DAYS[day - 1] + '</div><div style="display:flex;flex-wrap:wrap;gap:4px">';
      for (let pn = 1; pn <= maxP; pn++) {
        const assigned = dayPeriods.find(p => p.period_number === pn);
        if (assigned) {
          gridHtml += '<div style="padding:6px 10px;border-radius:6px;font-size:11px;background:#fee2e2;color:#dc2626;cursor:pointer" title="' + esc(assigned.subject_name || '') + ' — ' + esc(assigned.class_name || '') + ' (' + esc(assigned.room || '') + ')">P' + pn + ' 📚</div>';
        } else {
          gridHtml += '<div style="padding:6px 10px;border-radius:6px;font-size:11px;background:#dcfce7;color:#16a34a">P' + pn + ' ✓</div>';
        }
      }
      gridHtml += '</div></div>';
    }

    const html = TT_CSS + TT_DARK_CSS + '<div style="max-width:1000px;margin:0 auto">' +
      navExt('dash') +
      '<div style="margin-bottom:20px">' +
        '<h1 style="font-size:24px;color:#1e293b">👤 Teacher Availability</h1>' +
        '<p style="font-size:13px;color:#94a3b8;margin-top:2px">' + esc(teacher.name) + ' (' + esc(teacher.email || '') + ')</p>' +
      '</div>' +
      '<div class="stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:14px;margin-bottom:20px">' +
        '<div class="stat-card"><div class="stat-num" style="color:#dc2626">' + periods.length + '</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Busy Slots</div></div>' +
        '<div class="stat-card"><div class="stat-num" style="color:#16a34a">' + (DAYS.length * 8 - periods.length) + '</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Free Slots</div></div>' +
        '<div class="stat-card"><div class="stat-num" style="color:#f59e0b">' + blockedSlots.length + '</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Substitutions</div></div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">' +
        '<div class="card" style="padding:20px">' +
          '<h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">📅 Weekly Availability</h3>' +
          '<div style="font-size:11px;margin-bottom:10px"><span style="background:#dcfce7;color:#16a34a;padding:2px 8px;border-radius:4px">Free</span> <span style="background:#fee2e2;color:#dc2626;padding:2px 8px;border-radius:4px">Busy</span></div>' +
          gridHtml +
        '</div>' +
        '<div>' +
          '<div class="card" style="padding:20px;margin-bottom:16px">' +
            '<h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">🚫 Block a Time Slot</h3>' +
            '<form method="POST" action="/timetable/teacher-availability/' + teacherId + '/block" class="tt-form-grid tt-form">' +
              '<div><label>Day *</label><select name="day_of_week" required>' + DAYS.map((d, i) => '<option value="' + (i + 1) + '">' + d + '</option>').join('') + '</select></div>' +
              '<div><label>Period *</label><input type="number" name="period_number" min="1" max="12" value="1" required></div>' +
              '<div class="full"><label>Reason</label><input type="text" name="reason" placeholder="Meeting, appointment, etc."></div>' +
              '<div><button type="submit" class="tt-btn tt-btn-primary">🚫 Block Slot</button></div>' +
            '</form>' +
          '</div>' +
          '<div class="card" style="padding:20px">' +
            '<h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">📚 Current Schedule</h3>' +
            '<div style="overflow-x:auto;max-height:400px;overflow-y:auto"><table class="tt-table">' +
              '<thead style="position:sticky;top:0"><tr><th>Day</th><th>Per</th><th>Subject</th><th>Class</th><th>Room</th></tr></thead>' +
              '<tbody>' + periods.map(p => '<tr><td>' + DAY_NAMES_SHORT[(p.day_of_week || 1) - 1] + '</td><td>P' + (p.period_number || '') + '</td><td>' + esc(p.subject_name || '') + '</td><td>' + esc(p.class_name || '') + '</td><td>' + esc(p.room || '') + '</td></tr>').join('') || '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:20px">No scheduled periods</td></tr>' + '</tbody>' +
            '</table></div>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
    res.send(renderPage('Teacher Availability', html, user, req));
  }));

  // ROUTE: POST /timetable/teacher-availability/:id/block — Block a time slot for a teacher
  app.post('/timetable/teacher-availability/:id/block', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const teacherId = parseInt(req.params.id);
    const { day_of_week, period_number, reason } = req.body;

    if (!day_of_week || !period_number) {
      return res.redirect('/timetable/teacher-availability/' + teacherId);
    }

    // Check if slot is already booked
    const existing = (await pool.query(
      `SELECT tp.id FROM timetable_periods tp
       WHERE tp.tenant_id = $1 AND tp.teacher_id = $2 AND tp.day_of_week = $3 AND tp.period_number = $4`,
      [tid, teacherId, parseInt(day_of_week), parseInt(period_number)]
    )).rows[0];

    if (existing) {
      req.session.flash = { type: 'error', msg: 'That time slot is already assigned. Remove the period first.' };
      return res.redirect('/timetable/teacher-availability/' + teacherId);
    }

    // Create a blocked period entry (no subject/class)
    try {
      await pool.query(
        `INSERT INTO timetable_periods (tenant_id, day_of_week, period_number, teacher_id, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [tid, parseInt(day_of_week), parseInt(period_number), teacherId, 'BLOCKED: ' + (reason || 'Unavailable'), user.id]
      );
      console.log('[TimetableBuilder] Slot blocked for teacher #' + teacherId + ' by ' + user.email);
      req.session.flash = { type: 'success', msg: 'Time slot blocked successfully' };
    } catch (e) {
      console.error('[TimetableBuilder] Error blocking slot:', e.message);
    }
    res.redirect('/timetable/teacher-availability/' + teacherId);
  }));

  // ============================================================
  // BULK PERIOD IMPORT
  // ============================================================
  // ROUTE: GET /timetable/bulk-import — Show bulk import form
  app.get('/timetable/bulk-import', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    const subjects = (await pool.query('SELECT id, name FROM subjects WHERE tenant_id=$1 ORDER BY name', [tid])).rows;
    const classes = (await pool.query('SELECT id, name FROM classes WHERE tenant_id=$1 ORDER BY name', [tid])).rows;
    const teachers = (await pool.query(
      "SELECT id, name FROM users WHERE tenant_id=$1 AND (role='teacher' OR role='admin') ORDER BY name", [tid]
    )).rows;

    const subjectLookup = subjects.reduce((m, s) => { m[s.name.toLowerCase()] = s.id; return m; }, {});
    const classLookup = classes.reduce((m, c) => { m[c.name.toLowerCase()] = c.id; return m; }, {});
    const teacherLookup = teachers.reduce((m, t) => { m[t.name.toLowerCase()] = t.id; return m; }, {});

    const html = TT_CSS + TT_DARK_CSS + '<div style="max-width:900px;margin:0 auto">' +
      navExt('bulk-import') +
      '<div style="margin-bottom:20px">' +
        '<h1 style="font-size:24px;color:#1e293b">📥 Bulk Period Import</h1>' +
        '<p style="font-size:13px;color:#94a3b8;margin-top:2px">Import multiple timetable periods from CSV data</p>' +
      '</div>' +
      '<div class="card" style="padding:24px;margin-bottom:20px">' +
        '<h2 style="color:#1e293b;margin:0 0 4px">📋 CSV Format</h2>' +
        '<p style="font-size:13px;color:#94a3b8;margin-bottom:12px">Paste CSV data with columns: <strong>day,period,subject,teacher,room,class</strong> (one row per line)</p>' +
        '<div style="background:#f8fafc;padding:12px;border-radius:8px;font-family:monospace;font-size:12px;margin-bottom:16px;color:#475569">' +
          'Monday,1,Mathematics,Mr. Smith,Room 101,Grade 7A<br>' +
          'Monday,2,English,Ms. Johnson,Room 102,Grade 7A<br>' +
          'Tuesday,3,Science,Mr. Brown,Lab 1,Grade 8B<br>' +
          '...' +
        '</div>' +
        '<form method="POST" action="/timetable/bulk-import">' +
          '<div style="margin-bottom:12px"><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">CSV Data *</label>' +
            '<textarea name="csv_data" rows="10" required placeholder="Paste your CSV data here..." style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px;font-family:monospace"></textarea>' +
          '</div>' +
          '<div style="display:flex;gap:8px">' +
            '<button type="submit" class="tt-btn tt-btn-primary">📥 Import Periods</button>' +
          '</div>' +
        '</form>' +
      '</div>' +
      '<div class="card" style="padding:20px">' +
        '<h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">📚 Available Data for Matching</h3>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">' +
          '<div><strong style="font-size:12px;color:#64748b">Subjects (' + subjects.length + ')</strong>' +
            '<div style="max-height:150px;overflow-y:auto;font-size:12px;color:#475569">' + subjects.map(s => esc(s.name)).join(', ') + '</div></div>' +
          '<div><strong style="font-size:12px;color:#64748b">Teachers (' + teachers.length + ')</strong>' +
            '<div style="max-height:150px;overflow-y:auto;font-size:12px;color:#475569">' + teachers.map(t => esc(t.name)).join(', ') + '</div></div>' +
          '<div><strong style="font-size:12px;color:#64748b">Classes (' + classes.length + ')</strong>' +
            '<div style="max-height:150px;overflow-y:auto;font-size:12px;color:#475569">' + classes.map(c => esc(c.name)).join(', ') + '</div></div>' +
        '</div>' +
      '</div>' +
    '</div>';
    res.send(renderPage('Bulk Import', html, user, req));
  }));

  // ROUTE: POST /timetable/bulk-import — Process bulk import
  app.post('/timetable/bulk-import', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { csv_data } = req.body;

    if (!csv_data || !csv_data.trim()) {
      req.session.flash = { type: 'error', msg: 'No CSV data provided' };
      return res.redirect('/timetable/bulk-import');
    }

    // Build lookups
    const subjects = (await pool.query('SELECT id, name FROM subjects WHERE tenant_id=$1 ORDER BY name', [tid])).rows;
    const classes = (await pool.query('SELECT id, name FROM classes WHERE tenant_id=$1 ORDER BY name', [tid])).rows;
    const teachers = (await pool.query(
      "SELECT id, name FROM users WHERE tenant_id=$1 AND (role='teacher' OR role='admin') ORDER BY name", [tid]
    )).rows;

    const subjectLookup = {};
    subjects.forEach(s => { subjectLookup[s.name.toLowerCase()] = s.id; });
    const classLookup = {};
    classes.forEach(c => { classLookup[c.name.toLowerCase()] = c.id; });
    const teacherLookup = {};
    teachers.forEach(t => { teacherLookup[t.name.toLowerCase()] = t.id; });

    const dayMap = {};
    DAYS.forEach((d, i) => { dayMap[d.toLowerCase()] = i + 1; });

    const lines = csv_data.trim().split('\n').filter(l => l.trim());
    let imported = 0, skipped = 0, errors = [];

    for (const line of lines) {
      // Skip header row
      if (line.toLowerCase().includes('day,period') || line.toLowerCase().includes('day period')) continue;

      const parts = line.split(',').map(p => p.trim());
      if (parts.length < 6) { skipped++; errors.push('Invalid format: ' + esc(line.substring(0, 50))); continue; }

      const [dayStr, periodStr, subjectStr, teacherStr, roomStr, classStr] = parts;
      const dayOfWeek = dayMap[dayStr.toLowerCase()];
      const periodNumber = parseInt(periodStr);

      if (!dayOfWeek) { skipped++; errors.push('Unknown day: ' + esc(dayStr)); continue; }
      if (!periodNumber || periodNumber < 1) { skipped++; errors.push('Invalid period: ' + esc(periodStr)); continue; }

      const subjectId = subjectLookup[subjectStr.toLowerCase()] || null;
      const classId = classLookup[classStr.toLowerCase()] || null;
      const teacherId = teacherLookup[teacherStr.toLowerCase()] || null;

      try {
        await pool.query(
          `INSERT INTO timetable_periods (tenant_id, day_of_week, period_number, subject_id, teacher_id, room, class_id, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [tid, dayOfWeek, periodNumber, subjectId, teacherId, roomStr || null, classId, user.id]
        );
        imported++;
      } catch (e) {
        skipped++;
        errors.push('DB error on line: ' + esc(line.substring(0, 50)));
      }
    }

    console.log('[TimetableBuilder] Bulk import: ' + imported + ' imported, ' + skipped + ' skipped by ' + user.email);
    if (errors.length > 0) { console.log('[TimetableBuilder] Errors: ' + errors.slice(0, 10).join('; ')); }

    const flashMsg = imported + ' period(s) imported successfully.' + (skipped > 0 ? ' ' + skipped + ' skipped.' : '');
    req.session.flash = { type: imported > 0 ? 'success' : 'warning', msg: flashMsg };
    res.redirect('/timetable/bulk-import');
  }));

  // ============================================================
  // END MODULE
  // ============================================================
};
