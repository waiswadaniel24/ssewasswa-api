// ============================================================
// PARENT-TEACHER CONFERENCE (PTC) BOOKING MODULE
// Multi-Tenant SaaS Platform — Full conference scheduling,
// slot management, parent bookings, and reporting.
// ============================================================
// Usage in server.js:
//   const ptcBooking = require('./ptc-booking');
//   ptcBooking(app, db, pool, renderPage, esc);
// ============================================================

'use strict';
const { migrateQuery } = require('./db');
module.exports = function ptcBooking(app, db, pool, renderPage, esc) {

  // -- inline helpers ---------------------------------------------------
  const requireAuth = (req, res, next) => { if (!req.session?.user) return res.redirect('/login'); next(); };
  const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  if (!esc) esc = (s) => String(s == null ? '' : (typeof s === 'object' ? JSON.stringify(s) : s)).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  // -- internal helpers ---------------------------------------------------
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const fmtTime = (t) => t ? String(t).substring(0, 5) : '—';
  const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const today = () => new Date().toISOString().slice(0, 10);

  function slotBadge(s) {
    const m = {
      open:     { bg: '#dcfce7', c: '#16a34a', l: '🟢 Open' },
      booked:   { bg: '#fee2e2', c: '#dc2626', l: '🔴 Booked' },
      full:     { bg: '#fef9c3', c: '#a16207', l: '🟡 Full' },
      cancelled:{ bg: '#f1f5f9', c: '#64748b', l: '⚪ Cancelled' },
      void:     { bg: '#f1f5f9', c: '#94a3b8', l: '🚫 Void' },
    };
    const v = m[s] || { bg: '#f1f5f9', c: '#64748b', l: s };
    return `<span class="badge" style="background:${v.bg};color:${v.c}">${v.l}</span>`;
  }

  function bookingBadge(s) {
    const m = {
      confirmed: { bg: '#dcfce7', c: '#16a34a', l: '✅ Confirmed' },
      cancelled: { bg: '#fee2e2', c: '#dc2626', l: '❌ Cancelled' },
      pending:   { bg: '#fef9c3', c: '#a16207', l: '⏳ Pending' },
    };
    const v = m[s] || { bg: '#f1f5f9', c: '#64748b', l: s };
    return `<span class="badge" style="background:${v.bg};color:${v.c}">${v.l}</span>`;
  }

  // -- shared CSS --------------------------------------------------------
  const PTC_CSS = `<style>
    .ptc-nav{display:flex;gap:6px;margin-bottom:20px;flex-wrap:wrap}
    .ptc-nav a{padding:8px 16px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#475569;background:#f1f5f9;transition:.15s}
    .ptc-nav a:hover{background:#e2e8f0}.ptc-nav a.active{background:#0891b2;color:#fff}
    .ptc-btn{display:inline-flex;align-items:center;gap:6px;padding:9px 18px;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:.15s}
    .ptc-btn:hover{opacity:.9;transform:translateY(-1px)}
    .ptc-btn-primary{background:#0891b2;color:#fff}
    .ptc-btn-success{background:#059669;color:#fff}
    .ptc-btn-danger{background:#fee2e2;color:#dc2626}
    .ptc-btn-secondary{background:#f1f5f9;color:#475569}
    .ptc-table{width:100%;border-collapse:collapse;font-size:13px}
    .ptc-table th{padding:11px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#f8fafc}
    .ptc-table td{padding:10px 14px;border-bottom:1px solid #f1f5f9;color:#1e293b}
    .ptc-table tr:hover{background:#f8fafc}
    .ptc-filter{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:end}
    .ptc-filter label{display:block;font-size:12px;font-weight:600;color:#64748b;margin-bottom:4px}
    .ptc-filter input,.ptc-filter select{padding:8px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px;background:#fff}
    .ptc-filter input:focus,.ptc-filter select:focus{outline:none;border-color:#0891b2}
    .ptc-form label{display:block;font-size:13px;font-weight:600;color:#475569;margin-bottom:4px}
    .ptc-form input,.ptc-form select,.ptc-form textarea{width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;box-sizing:border-box}
    .ptc-form input:focus,.ptc-form select:focus,.ptc-form textarea:focus{outline:none;border-color:#0891b2}
    .ptc-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
    .ptc-calendar{display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:6px}
    .ptc-cal-slot{padding:8px 6px;border-radius:8px;font-size:11px;text-align:center;cursor:pointer;transition:.15s;border:2px solid transparent}
    .ptc-cal-slot.open{background:#dcfce7;border-color:#bbf7d0;color:#166534}
    .ptc-cal-slot.open:hover{border-color:#0891b2;background:#cffafe}
    .ptc-cal-slot.booked{background:#fee2e2;border-color:#fecaca;color:#991b1b}
    .ptc-cal-slot.full{background:#fef9c3;border-color:#fde68a;color:#854d0e}
    .ptc-cal-slot.cancelled{background:#f1f5f9;color:#94a3b8;text-decoration:line-through}
    .ptc-cal-slot.void{background:#f1f5f9;color:#94a3b8;opacity:.5}
    .ptc-legend{display:flex;gap:14px;margin-bottom:14px;flex-wrap:wrap}
    .ptc-legend span{display:flex;align-items:center;gap:5px;font-size:12px;color:#64748b}
    .ptc-legend i{width:12px;height:12px;border-radius:4px;display:inline-block}
    @media(max-width:768px){.ptc-nav{gap:4px}.ptc-nav a{padding:6px 12px;font-size:12px}.ptc-grid{grid-template-columns:1fr}}
  </style>`;

  // -- navigation helper --------------------------------------------------
  const nav = (active) => `<div class="ptc-nav">
    <a href="/ptc" class="${active === 'dash' ? 'active' : ''}">📊 Dashboard</a>
    <a href="/ptc/create" class="${active === 'create' ? 'active' : ''}">🗓 Create Conference</a>
    <a href="/ptc/slots" class="${active === 'slots' ? 'active' : ''}">📋 All Slots</a>
    <a href="/ptc/my-bookings" class="${active === 'mybookings' ? 'active' : ''}">📌 My Bookings</a>
    <a href="/ptc/reports" class="${active === 'reports' ? 'active' : ''}">📈 Reports</a>
  </div>`;

  // ============================================================
  // DATABASE MIGRATIONS (async IIFE)
  // ============================================================
  (async () => {
    try {
      // Ensure tables exist
      await migrateQuery(pool, 'PtcBooking', `CREATE TABLE IF NOT EXISTS ptc_slots (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        staff_id INTEGER, teacher_name VARCHAR(255), slot_date DATE NOT NULL,
        duration_minutes INTEGER DEFAULT 15, notes TEXT, status VARCHAR(20) DEFAULT 'open'
      )`);
      await migrateQuery(pool, 'PtcBooking', `CREATE TABLE IF NOT EXISTS ptc_bookings (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        slot_id INTEGER NOT NULL REFERENCES ptc_slots(id) ON DELETE CASCADE,
        parent_name VARCHAR(255), parent_phone VARCHAR(255), concerns TEXT
      )`);

      // ALTER TABLE ptc_slots — add missing columns
      const slotCols = [
        ['start_time', 'TIME NOT NULL DEFAULT \'08:00\''],
        ['end_time', 'TIME'],
        ['class', 'VARCHAR(100)'],
        ['max_bookings', 'INTEGER DEFAULT 1'],
        ['venue', 'VARCHAR(255)'],
        ['created_by', 'INTEGER'],
        ['created_at', 'TIMESTAMPTZ DEFAULT NOW()'],
      ];
      for (const [col, def] of slotCols) {
        try { await migrateQuery(pool, 'PtcBooking', `ALTER TABLE ptc_slots ADD COLUMN IF NOT EXISTS ${col} ${def}`); } catch (e) {}
      }

      // ALTER TABLE ptc_bookings — add missing columns
      const bookCols = [
        ['parent_email', 'VARCHAR(255)'],
        ['student_name', 'VARCHAR(255)'],
        ['student_id', 'INTEGER'],
        ['booked_at', 'TIMESTAMPTZ DEFAULT NOW()'],
        ['status', "VARCHAR(20) DEFAULT 'confirmed'"],
      ];
      for (const [col, def] of bookCols) {
        try { await migrateQuery(pool, 'PtcBooking', `ALTER TABLE ptc_bookings ADD COLUMN IF NOT EXISTS ${col} ${def}`); } catch (e) {}
      }

      // Indexes
      await migrateQuery(pool, 'PtcBooking', `CREATE INDEX IF NOT EXISTS idx_ps_tenant ON ptc_slots(tenant_id)`);
      await migrateQuery(pool, 'PtcBooking', `CREATE INDEX IF NOT EXISTS idx_ps_date ON ptc_slots(tenant_id, slot_date)`);
      await migrateQuery(pool, 'PtcBooking', `CREATE INDEX IF NOT EXISTS idx_ps_status ON ptc_slots(tenant_id, status)`);
      await migrateQuery(pool, 'PtcBooking', `CREATE INDEX IF NOT EXISTS idx_ps_teacher ON ptc_slots(tenant_id, teacher_name)`);
      await migrateQuery(pool, 'PtcBooking', `CREATE INDEX IF NOT EXISTS idx_ps_class ON ptc_slots(tenant_id, class)`);
      await migrateQuery(pool, 'PtcBooking', `CREATE INDEX IF NOT EXISTS idx_pb_tenant ON ptc_bookings(tenant_id)`);
      await migrateQuery(pool, 'PtcBooking', `CREATE INDEX IF NOT EXISTS idx_pb_slot ON ptc_bookings(slot_id)`);
      await migrateQuery(pool, 'PtcBooking', `CREATE INDEX IF NOT EXISTS idx_pb_parent ON ptc_bookings(tenant_id, parent_phone)`);
      await migrateQuery(pool, 'PtcBooking', `CREATE INDEX IF NOT EXISTS idx_pb_status ON ptc_bookings(tenant_id, status)`);
      console.log('[PTCBooking] Migrations applied');
    } catch (e) { /* migration OK */ }
  })();

  // ============================================================
  // ROUTE 1: GET /ptc — Dashboard
  // ============================================================
  app.get('/ptc', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    // Upcoming conference days
    const upcomingDays = (await pool.query(
      `SELECT DISTINCT slot_date, COUNT(*)::int as total_slots,
        COUNT(*) FILTER (WHERE status = 'open')::int as open_slots,
        COUNT(*) FILTER (WHERE status = 'booked')::int as booked_slots
       FROM ptc_slots WHERE tenant_id=$1 AND slot_date >= CURRENT_DATE
       GROUP BY slot_date ORDER BY slot_date LIMIT 14`,
      [tid]
    )).rows;

    // Total bookings today
    const todayStats = (await pool.query(
      `SELECT COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE b.status = 'confirmed')::int as confirmed,
        COUNT(*) FILTER (WHERE b.status = 'cancelled')::int as cancelled
       FROM ptc_bookings b JOIN ptc_slots s ON s.id = b.slot_id
       WHERE b.tenant_id=$1 AND s.slot_date = CURRENT_DATE`,
      [tid]
    )).rows[0];

    // Popular teachers (most bookings)
    const popularTeachers = (await pool.query(
      `SELECT s.teacher_name, COUNT(b.id)::int as booking_count
       FROM ptc_bookings b JOIN ptc_slots s ON s.id = b.slot_id
       WHERE b.tenant_id=$1 AND b.status='confirmed'
       GROUP BY s.teacher_name ORDER BY booking_count DESC LIMIT 5`,
      [tid]
    )).rows;

    // Quick stats
    const totalSlots = (await pool.query(`SELECT COUNT(*)::int as cnt FROM ptc_slots WHERE tenant_id=$1`, [tid])).rows[0].cnt;
    const totalBookings = (await pool.query(`SELECT COUNT(*)::int as cnt FROM ptc_bookings WHERE tenant_id=$1 AND status='confirmed'`, [tid])).rows[0].cnt;
    const openSlots = (await pool.query(`SELECT COUNT(*)::int as cnt FROM ptc_slots WHERE tenant_id=$1 AND status='open'`, [tid])).rows[0].cnt;
    const uniqueParents = (await pool.query(`SELECT COUNT(DISTINCT parent_phone)::int as cnt FROM ptc_bookings WHERE tenant_id=$1 AND status='confirmed'`, [tid])).rows[0].cnt;

    const upcomingHtml = upcomingDays.map(d => {
      const pct = d.total_slots > 0 ? Math.round((d.booked_slots / d.total_slots) * 100) : 0;
      const color = pct >= 90 ? '#dc2626' : pct >= 50 ? '#f59e0b' : '#0891b2';
      return `<div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
        <span style="font-size:13px;font-weight:600;color:#1e293b;min-width:100px">${fmtDate(d.slot_date)}</span>
        <div style="flex:1;background:#f1f5f9;border-radius:8px;height:26px;overflow:hidden;position:relative">
          <div style="height:100%;width:${pct}%;background:${color};border-radius:8px;transition:.3s"></div>
          <span style="position:absolute;right:8px;top:4px;font-size:11px;font-weight:700;color:#1e293b">${pct}%</span>
        </div>
        <span style="font-size:12px;color:#64748b;min-width:90px">${d.booked_slots}/${d.total_slots} booked</span>
        <span style="font-size:12px;color:#16a34a;font-weight:600">${d.open_slots} open</span>
      </div>`;
    }).join('');

    const teachersHtml = popularTeachers.map((t, i) => `<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
      <span style="width:22px;height:22px;border-radius:50%;background:#0891b2;color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700">${i + 1}</span>
      <span style="font-size:13px;flex:1;color:#1e293b;font-weight:500">${esc(t.teacher_name || 'Unknown')}</span>
      <span style="font-size:13px;font-weight:700;color:#0891b2">${t.booking_count}</span>
      <span style="font-size:11px;color:#94a3b8">bookings</span>
    </div>`).join('');

    // Recent bookings
    const recent = (await pool.query(
      `SELECT b.*, s.slot_date, s.start_time, s.end_time, s.teacher_name
       FROM ptc_bookings b JOIN ptc_slots s ON s.id = b.slot_id
       WHERE b.tenant_id=$1 ORDER BY b.booked_at DESC LIMIT 8`,
      [tid]
    )).rows;
    let recentHtml = '';
    if (recent.length) {
      recentHtml = `<div class="card" style="padding:20px">
        <h3 style="font-size:15px;color:#1e293b;margin-bottom:14px">🕐 Recent Bookings</h3>
        <div style="overflow-x:auto"><table class="ptc-table">
          <thead><tr><th>Parent</th><th>Student</th><th>Teacher</th><th>Date</th><th>Time</th><th>Status</th></tr></thead>
          <tbody>${recent.map(r => `<tr>
            <td><strong>${esc(r.parent_name || '—')}</strong></td>
            <td>${esc(r.student_name || '—')}</td>
            <td>${esc(r.teacher_name || '—')}</td>
            <td>${fmtDate(r.slot_date)}</td>
            <td>${fmtTime(r.start_time)} - ${fmtTime(r.end_time)}</td>
            <td>${bookingBadge(r.status)}</td>
          </tr>`).join('')}</tbody>
        </table></div>
      </div>`;
    }

    const html = PTC_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('dash')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">📊 Parent-Teacher Conferences</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Manage conference scheduling, bookings, and reports</p></div>
        <div style="display:flex;gap:8px">
          <a href="/ptc/create" class="ptc-btn ptc-btn-primary">🗓 Create Conference Day</a>
          <a href="/ptc/slots" class="ptc-btn ptc-btn-secondary">📋 View Slots</a>
        </div>
      </div>

      <!-- Quick Stats -->
      <div class="stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-bottom:20px">
        <div class="stat-card"><div class="stat-num" style="color:#0891b2">${totalSlots}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Total Slots</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#16a34a">${openSlots}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Available Slots</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#dc2626">${totalBookings}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Total Bookings</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#7c3aed">${uniqueParents}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Unique Parents</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#0891b2">${todayStats.total}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Today's Bookings</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${todayStats.confirmed || 0}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Confirmed Today</div></div>
      </div>

      <!-- Upcoming Conferences + Popular Teachers -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
        <div class="card" style="padding:20px">
          <h3 style="font-size:15px;color:#1e293b;margin-bottom:14px">📅 Upcoming Conference Days</h3>
          ${upcomingHtml || '<p style="color:#94a3b8;font-size:13px;text-align:center;padding:20px">No upcoming conferences scheduled</p>'}
        </div>
        <div class="card" style="padding:20px">
          <h3 style="font-size:15px;color:#1e293b;margin-bottom:14px">👨‍🏫 Popular Teachers</h3>
          ${teachersHtml || '<p style="color:#94a3b8;font-size:13px;text-align:center;padding:20px">No booking data yet</p>'}
        </div>
      </div>

      <!-- Recent Bookings -->
      ${recentHtml}
    </div>`;
    res.send(renderPage('PTC Dashboard', html, user, req));
  }));

  // ============================================================
  // ROUTE 2: GET /ptc/create — Create conference day form
  // ============================================================
  app.get('/ptc/create', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    // Fetch teachers/staff for selection
    const staff = (await pool.query(
      `SELECT u.id, u.name, u.role FROM users u WHERE u.tenant_id=$1 AND u.role IN ('teacher','staff','admin') AND u.active != false ORDER BY u.name LIMIT 100`,
      [tid]
    )).rows;

    // Fetch classes for selection
    const classes = (await pool.query(
      `SELECT DISTINCT class FROM ptc_slots WHERE tenant_id=$1 AND class IS NOT NULL AND class != '' ORDER BY class LIMIT 50`,
      [tid]
    )).rows;

    const staffOptions = staff.map(s => `<option value="${s.id}" data-name="${esc(s.name)}">${esc(s.name)} (${esc(s.role || 'staff')})</option>`).join('');
    const classOptions = classes.map(c => `<option value="${esc(c.class)}">${esc(c.class)}</option>`).join('');

    const successMsg = req.query.success ? `<div style="background:#dcfce7;color:#16a34a;padding:12px 16px;border-radius:10px;margin-bottom:16px;font-size:13px;font-weight:600">✅ ${esc(req.query.success)}</div>` : '';
    const errorMsg = req.query.error ? `<div style="background:#fee2e2;color:#dc2626;padding:12px 16px;border-radius:10px;margin-bottom:16px;font-size:13px;font-weight:600">❌ ${esc(req.query.error)}</div>` : '';

    const html = PTC_CSS + `<div style="max-width:800px;margin:0 auto">
      ${nav('create')}
      <a href="/ptc" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Dashboard</a>
      ${successMsg}${errorMsg}
      <div class="card" style="padding:28px">
        <h2 style="margin:0 0 4px;color:#1e293b">🗓 Create Conference Day</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:24px">Set up time slots for parent-teacher meetings</p>
        <form method="POST" action="/ptc/create" class="ptc-form" style="display:flex;flex-direction:column;gap:18px">

          <!-- Date & Venue -->
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div><label>Conference Date *</label>
              <input type="date" name="slot_date" required value="${today()}" min="${today()}"></div>
            <div><label>Venue / Location</label>
              <input type="text" name="venue" placeholder="e.g., Main Hall, Room 12"></div>
          </div>

          <!-- Time Range & Duration -->
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px">
            <div><label>Start Time *</label>
              <input type="time" name="start_time" required value="08:00"></div>
            <div><label>End Time *</label>
              <input type="time" name="end_time" required value="17:00"></div>
            <div><label>Slot Duration (min) *</label>
              <select name="duration_minutes" required>
                <option value="10">10 minutes</option>
                <option value="15" selected>15 minutes</option>
                <option value="20">20 minutes</option>
                <option value="30">30 minutes</option>
                <option value="45">45 minutes</option>
                <option value="60">60 minutes</option>
              </select></div>
          </div>

          <!-- Class -->
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div><label>Class / Section</label>
              <input type="text" name="class_name" placeholder="e.g., P.5A, S.3B" list="class-list">
              <datalist id="class-list">${classOptions}</datalist></div>
            <div><label>Max Bookings per Slot</label>
              <select name="max_bookings">
                <option value="1" selected>1 parent (1-on-1)</option>
                <option value="2">2 parents (group)</option>
                <option value="3">3 parents</option>
                <option value="5">5 parents</option>
              </select></div>
          </div>

          <!-- Teacher Selection -->
          <div><label>Teachers / Staff *</label>
            <div style="background:#f8fafc;border:2px solid #e2e8f0;border-radius:10px;padding:14px;max-height:220px;overflow-y:auto">
              ${staff.length ? `<div style="display:flex;gap:8px;margin-bottom:10px;align-items:center">
                <button type="button" onclick="toggleAllTeachers()" class="ptc-btn ptc-btn-secondary" style="padding:5px 12px;font-size:12px">Select All</button>
                <span style="font-size:11px;color:#94a3b8" id="teacherCount">0 selected</span>
              </div>` : ''}
              <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:6px">
                ${staff.length ? staff.map(s => `<label style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:8px;cursor:pointer;font-size:13px;color:#1e293b;transition:.1s">
                  <input type="checkbox" name="staff_ids" value="${s.id}" onchange="updateTeacherCount()" style="accent-color:#0891b2;width:16px;height:16px">
                  ${esc(s.name)}
                </label>`).join('') : '<p style="color:#94a3b8;font-size:13px">No teachers/staff found. Add staff first.</p>'}
              </div>
            </div>
          </div>

          <!-- Notes -->
          <div><label>Notes / Instructions</label>
            <textarea name="notes" rows="3" placeholder="e.g., Parents should bring student report cards..."></textarea></div>

          <div style="display:flex;gap:10px;margin-top:8px">
            <button type="submit" class="ptc-btn ptc-btn-primary" style="padding:14px 28px;font-size:15px;justify-content:center">🚀 Generate Time Slots</button>
            <a href="/ptc" class="ptc-btn ptc-btn-secondary" style="padding:14px 28px;font-size:15px">Cancel</a>
          </div>
        </form>
      </div>
      <script>
        function toggleAllTeachers() {
          const boxes = document.querySelectorAll('input[name=staff_ids]');
          const allChecked = Array.from(boxes).every(b => b.checked);
          boxes.forEach(b => b.checked = !allChecked);
          updateTeacherCount();
        }
        function updateTeacherCount() {
          const cnt = document.querySelectorAll('input[name=staff_ids]:checked').length;
          document.getElementById('teacherCount').textContent = cnt + ' selected';
        }
      </script>
    </div>`;
    res.send(renderPage('Create Conference Day', html, user, req));
  }));

  // ============================================================
  // ROUTE 3: POST /ptc/create — Generate time slots
  // ============================================================
  app.post('/ptc/create', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { slot_date, start_time, end_time, duration_minutes, venue, class_name, max_bookings, notes, staff_ids } = req.body;

    if (!slot_date || !start_time || !end_time || !duration_minutes) {
      return res.redirect('/ptc/create?error=' + encodeURIComponent('Date, start time, end time, and duration are required'));
    }

    const selStaffIds = Array.isArray(staff_ids) ? staff_ids.map(Number) : (staff_ids ? [Number(staff_ids)] : []);
    if (!selStaffIds.length) {
      return res.redirect('/ptc/create?error=' + encodeURIComponent('Select at least one teacher'));
    }

    // Parse times
    const [startH, startM] = String(start_time).split(':').map(Number);
    const [endH, endM] = String(end_time).split(':').map(Number);
    const duration = parseInt(duration_minutes) || 15;
    const maxBookings = parseInt(max_bookings) || 1;

    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;
    if (startMinutes >= endMinutes) {
      return res.redirect('/ptc/create?error=' + encodeURIComponent('End time must be after start time'));
    }

    // Generate slots
    let slotsCreated = 0;
    for (const staffId of selStaffIds) {
      // Get teacher name
      const staffRow = (await pool.query(`SELECT name FROM users WHERE id=$1 AND tenant_id=$2`, [staffId, tid])).rows[0];
      const teacherName = staffRow ? staffRow.name : 'Unknown';

      let currentMinutes = startMinutes;
      while (currentMinutes + duration <= endMinutes) {
        const h = Math.floor(currentMinutes / 60);
        const m = currentMinutes % 60;
        const slotStart = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');

        const endSlotMin = currentMinutes + duration;
        const eh = Math.floor(endSlotMin / 60);
        const em = endSlotMin % 60;
        const slotEnd = String(eh).padStart(2, '0') + ':' + String(em).padStart(2, '0');

        // Check for duplicate
        const dup = (await pool.query(
          `SELECT id FROM ptc_slots WHERE tenant_id=$1 AND staff_id=$2 AND slot_date=$3 AND start_time=$4 AND end_time=$5 LIMIT 1`,
          [tid, staffId, slot_date, slotStart, slotEnd]
        )).rows[0];

        if (!dup) {
          await pool.query(
            `INSERT INTO ptc_slots (tenant_id, staff_id, teacher_name, slot_date, start_time, end_time, duration_minutes, class, max_bookings, venue, notes, status, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'open',$12)`,
            [tid, staffId, teacherName, slot_date, slotStart, slotEnd, duration, class_name || null, maxBookings, venue || null, notes || null, user.id]
          );
          slotsCreated++;
        }
        currentMinutes += duration;
      }
    }

    console.log(`[PTCBooking] Created ${slotsCreated} slots for ${selStaffIds.length} teachers on ${slot_date}`);
    res.redirect('/ptc/create?success=' + encodeURIComponent(`Successfully created ${slotsCreated} time slots for ${selStaffIds.length} teacher(s) on ${slot_date}`));
  }));

  // ============================================================
  // ROUTE 4: GET /ptc/slots — View all available slots
  // ============================================================
  app.get('/ptc/slots', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { date, teacher, class_name, status } = req.query;

    let where = ['s.tenant_id=$1'], params = [tid], pi = 2;
    if (date) { where.push(`s.slot_date=$${pi++}`); params.push(date); }
    if (teacher) { where.push(`s.teacher_name ILIKE $${pi++}`); params.push('%' + teacher + '%'); }
    if (class_name) { where.push(`s.class ILIKE $${pi++}`); params.push('%' + class_name + '%'); }
    if (status) { where.push(`s.status=$${pi++}`); params.push(status); }

    const slots = (await pool.query(
      `SELECT s.*,
        (SELECT COUNT(*)::int FROM ptc_bookings b WHERE b.slot_id = s.id AND b.status = 'confirmed') as booking_count
       FROM ptc_slots s WHERE ${where.join(' AND ')}
       ORDER BY s.slot_date, s.start_time, s.teacher_name LIMIT 300`,
      params
    )).rows;

    // Get filter options
    const teachers = (await pool.query(
      `SELECT DISTINCT teacher_name FROM ptc_slots WHERE tenant_id=$1 AND teacher_name IS NOT NULL ORDER BY teacher_name`, [tid]
    )).rows;
    const classes = (await pool.query(
      `SELECT DISTINCT class FROM ptc_slots WHERE tenant_id=$1 AND class IS NOT NULL AND class != '' ORDER BY class`, [tid]
    )).rows;
    const dates = (await pool.query(
      `SELECT DISTINCT slot_date FROM ptc_slots WHERE tenant_id=$1 ORDER BY slot_date`, [tid]
    )).rows;

    const teacherOpts = teachers.map(t => `<option value="${esc(t.teacher_name)}" ${teacher === t.teacher_name ? 'selected' : ''}>${esc(t.teacher_name)}</option>`).join('');
    const classOpts = classes.map(c => `<option value="${esc(c.class)}" ${class_name === c.class ? 'selected' : ''}>${esc(c.class)}</option>`).join('');
    const dateOpts = dates.map(d => `<option value="${d.slot_date}" ${date === d.slot_date ? 'selected' : ''}>${fmtDate(d.slot_date)}</option>`).join('');

    // Calendar visual
    const slotsByDate = {};
    for (const s of slots) {
      if (!slotsByDate[s.slot_date]) slotsByDate[s.slot_date] = [];
      slotsByDate[s.slot_date].push(s);
    }

    let calendarHtml = '';
    for (const [dateKey, dateSlots] of Object.entries(slotsByDate)) {
      calendarHtml += `<div style="margin-bottom:16px">
        <div style="font-size:13px;font-weight:700;color:#1e293b;margin-bottom:6px">${fmtDate(dateKey)} <span style="color:#94a3b8;font-weight:400">(${dateSlots.length} slots)</span></div>
        <div class="ptc-calendar">
          ${dateSlots.map(s => `<div class="ptc-cal-slot ${s.status}" onclick="location.href='/ptc/slots/${s.id}'" title="${esc(s.teacher_name || '')}: ${fmtTime(s.start_time)}-${fmtTime(s.end_time)} (${s.booking_count || 0}/${s.max_bookings || 1})">
            <div style="font-weight:700">${fmtTime(s.start_time)}</div>
            <div style="font-size:10px;margin-top:2px">${esc((s.teacher_name || '').substring(0, 10))}</div>
            <div style="font-size:9px;opacity:.8">${s.booking_count || 0}/${s.max_bookings || 1}</div>
          </div>`).join('')}
        </div>
      </div>`;
    }

    // Table view
    const rowsHtml = slots.map(s => {
      const isFull = (s.booking_count || 0) >= (s.max_bookings || 1);
      const displayStatus = s.status === 'open' && isFull ? 'full' : s.status;
      return `<tr>
        <td><a href="/ptc/slots/${s.id}" style="color:#0891b2;text-decoration:none;font-weight:600">${fmtDate(s.slot_date)}</a></td>
        <td>${esc(s.teacher_name || '—')}</td>
        <td style="font-weight:600">${fmtTime(s.start_time)} - ${fmtTime(s.end_time)}</td>
        <td>${s.duration_minutes || 15} min</td>
        <td>${esc(s.class || '—')}</td>
        <td>${esc(s.venue || '—')}</td>
        <td>${s.booking_count || 0}/${s.max_bookings || 1}</td>
        <td>${slotBadge(displayStatus)}</td>
        <td>
          <div style="display:flex;gap:4px">
            ${displayStatus === 'open' ? `<form method="POST" action="/ptc/slots/${s.id}/book" style="display:inline"><button class="btn btn-sm btn-green" type="submit">Book</button></form>` : ''}
            <a href="/ptc/slots/${s.id}" class="btn btn-sm btn-blue">View</a>
          </div>
        </td>
      </tr>`;
    }).join('');

    const html = PTC_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('slots')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">📋 Conference Slots</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">${slots.length} slots found</p></div>
        <a href="/ptc/create" class="ptc-btn ptc-btn-primary">+ New Conference</a>
      </div>

      <!-- Filters -->
      <div class="ptc-filter">
        <div><label>Date</label><select onchange="location.href=updateUrl('date',this.value)">
          <option value="">All Dates</option>${dateOpts}</select></div>
        <div><label>Teacher</label><select onchange="location.href=updateUrl('teacher',this.value)">
          <option value="">All Teachers</option>${teacherOpts}</select></div>
        <div><label>Class</label><select onchange="location.href=updateUrl('class_name',this.value)">
          <option value="">All Classes</option>${classOpts}</select></div>
        <div><label>Status</label><select onchange="location.href=updateUrl('status',this.value)">
          <option value="">All</option>
          <option value="open" ${status==='open'?'selected':''}>Open</option>
          <option value="booked" ${status==='booked'?'selected':''}>Booked</option>
          <option value="full" ${status==='full'?'selected':''}>Full</option>
          <option value="cancelled" ${status==='cancelled'?'selected':''}>Cancelled</option>
          <option value="void" ${status==='void'?'selected':''}>Void</option></select></div>
      </div>

      <!-- Calendar View -->
      <div class="card" style="padding:20px;margin-bottom:20px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
          <h3 style="font-size:15px;color:#1e293b;margin:0">🗓 Calendar View</h3>
          <div class="ptc-legend">
            <span><i style="background:#dcfce7"></i>Available</span>
            <span><i style="background:#fee2e2"></i>Booked</span>
            <span><i style="background:#fef9c3"></i>Full</span>
            <span><i style="background:#f1f5f9"></i>Cancelled</span>
          </div>
        </div>
        <div style="max-height:500px;overflow-y:auto">
          ${calendarHtml || '<p style="color:#94a3b8;font-size:13px;text-align:center;padding:30px">No slots found for the selected filters</p>'}
        </div>
      </div>

      <!-- Table View -->
      <div class="card" style="padding:20px">
        <h3 style="font-size:15px;color:#1e293b;margin-bottom:14px">📋 List View</h3>
        <div style="overflow-x:auto"><table class="ptc-table">
          <thead><tr><th>Date</th><th>Teacher</th><th>Time</th><th>Duration</th><th>Class</th><th>Venue</th><th>Bookings</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>${rowsHtml || '<tr><td colspan="9" style="text-align:center;color:#94a3b8;padding:40px">No slots found</td></tr>'}</tbody>
        </table></div>
      </div>
      <script>
        function updateUrl(key, val) {
          const u = new URL(location.href);
          if (val) u.searchParams.set(key, val); else u.searchParams.delete(key);
          return u.pathname + u.search;
        }
      </script>
    </div>`;
    res.send(renderPage('Conference Slots', html, user, req));
  }));

  // ============================================================
  // ROUTE 5: GET /ptc/slots/:id — Slot details + bookings
  // ============================================================
  app.get('/ptc/slots/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, slotId = req.params.id;

    const slot = (await pool.query(
      `SELECT s.*, u.name as creator_name,
        (SELECT COUNT(*)::int FROM ptc_bookings b WHERE b.slot_id = s.id AND b.status = 'confirmed') as booking_count
       FROM ptc_slots s LEFT JOIN users u ON u.id = s.created_by
       WHERE s.id=$1 AND s.tenant_id=$2`,
      [slotId, tid]
    )).rows[0];

    if (!slot) {
      return res.send(renderPage('Not Found', '<div class="card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">Slot not found</h2><a href="/ptc/slots" class="btn btn-blue btn-sm" style="margin-top:12px">← All Slots</a></div>', user, req));
    }

    const bookings = (await pool.query(
      `SELECT b.* FROM ptc_bookings b WHERE b.slot_id=$1 AND b.tenant_id=$2 ORDER BY b.booked_at DESC`,
      [slotId, tid]
    )).rows;

    const isFull = (slot.booking_count || 0) >= (slot.max_bookings || 1);
    const displayStatus = slot.status === 'open' && isFull ? 'full' : slot.status;
    const canBook = displayStatus === 'open' && !isFull;

    const bookingsHtml = bookings.map(b => `<tr>
      <td><strong>${esc(b.parent_name || '—')}</strong></td>
      <td>${esc(b.student_name || '—')}</td>
      <td style="font-size:12px">${esc(b.parent_phone || '—')}</td>
      <td style="font-size:12px">${esc(b.parent_email || '—')}</td>
      <td style="font-size:12px">${esc(b.concerns || '—')}</td>
      <td>${bookingBadge(b.status)}</td>
      <td style="font-size:12px">${fmtDateTime(b.booked_at)}</td>
      <td>${b.status === 'confirmed' ? `<form method="POST" action="/ptc/slots/${slotId}/cancel?booking_id=${b.id}" style="display:inline"><button class="btn btn-sm btn-red" type="submit" onclick="return confirm('Cancel this booking?')">Cancel</button></form>` : '—'}</td>
    </tr>`).join('');

    const html = PTC_CSS + `<div style="max-width:1000px;margin:0 auto">
      ${nav('slots')}
      <a href="/ptc/slots" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to All Slots</a>

      <!-- Slot Info -->
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:16px;margin-bottom:20px">
        <div class="card" style="padding:24px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">
            <h2 style="margin:0;color:#1e293b;font-size:20px">${esc(slot.teacher_name || 'Conference Slot')}</h2>
            ${slotBadge(displayStatus)}
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:14px">
            <div><span style="color:#64748b">📅 Date:</span> <strong>${fmtDate(slot.slot_date)}</strong></div>
            <div><span style="color:#64748b">🕐 Time:</span> <strong>${fmtTime(slot.start_time)} - ${fmtTime(slot.end_time)}</strong></div>
            <div><span style="color:#64748b">⏱ Duration:</span> <strong>${slot.duration_minutes || 15} minutes</strong></div>
            <div><span style="color:#64748b">🏫 Class:</span> <strong>${esc(slot.class || '—')}</strong></div>
            <div><span style="color:#64748b">📍 Venue:</span> <strong>${esc(slot.venue || '—')}</strong></div>
            <div><span style="color:#64748b">👥 Capacity:</span> <strong>${slot.booking_count || 0}/${slot.max_bookings || 1}</strong></div>
          </div>
          ${slot.notes ? `<div style="margin-top:12px;padding:12px;background:#f8fafc;border-radius:8px;font-size:13px;color:#475569"><strong>Notes:</strong> ${esc(slot.notes)}</div>` : ''}
          <div style="margin-top:14px;font-size:11px;color:#94a3b8">Created by ${esc(slot.creator_name || 'Unknown')} · ${fmtDateTime(slot.created_at)}</div>
        </div>

        <!-- Actions Card -->
        <div class="card" style="padding:20px;display:flex;flex-direction:column;gap:10px">
          <h3 style="font-size:14px;color:#1e293b;margin:0 0 4px">Actions</h3>
          ${canBook ? `<form method="POST" action="/ptc/slots/${slotId}/book" style="display:flex;flex-direction:column;gap:8px">
            <div><input type="text" name="parent_name" placeholder="Parent name *" required style="width:100%;padding:8px 12px;border:2px solid #e2e8f0;border-radius:8px;font-size:13px;box-sizing:border-box"></div>
            <div><input type="text" name="parent_phone" placeholder="Parent phone *" required style="width:100%;padding:8px 12px;border:2px solid #e2e8f0;border-radius:8px;font-size:13px;box-sizing:border-box"></div>
            <div><input type="text" name="student_name" placeholder="Student name" style="width:100%;padding:8px 12px;border:2px solid #e2e8f0;border-radius:8px;font-size:13px;box-sizing:border-box"></div>
            <div><input type="text" name="student_id" placeholder="Student ID" type="number" style="width:100%;padding:8px 12px;border:2px solid #e2e8f0;border-radius:8px;font-size:13px;box-sizing:border-box"></div>
            <div><input type="email" name="parent_email" placeholder="Parent email" style="width:100%;padding:8px 12px;border:2px solid #e2e8f0;border-radius:8px;font-size:13px;box-sizing:border-box"></div>
            <div><textarea name="concerns" placeholder="Concerns / topics to discuss" rows="2" style="width:100%;padding:8px 12px;border:2px solid #e2e8f0;border-radius:8px;font-size:13px;box-sizing:border-box;resize:vertical"></textarea></div>
            <button type="submit" class="ptc-btn ptc-btn-success" style="justify-content:center">📌 Book This Slot</button>
          </form>` : '<div style="background:#fef9c3;padding:10px 14px;border-radius:8px;font-size:13px;color:#854d0e;font-weight:600">⚠️ ' + (isFull ? 'Slot is full' : 'Slot is not available') + '</div>'}
          <form method="POST" action="/ptc/slots/${slotId}/delete" onsubmit="return confirm('Delete this slot and all its bookings? This cannot be undone.')">
            <button type="submit" class="ptc-btn ptc-btn-danger" style="justify-content:center;width:100%">🗑 Delete Slot</button>
          </form>
        </div>
      </div>

      <!-- Bookings List -->
      <div class="card" style="padding:20px">
        <h3 style="font-size:15px;color:#1e293b;margin-bottom:14px">📌 Bookings (${bookings.length})</h3>
        <div style="overflow-x:auto"><table class="ptc-table">
          <thead><tr><th>Parent</th><th>Student</th><th>Phone</th><th>Email</th><th>Concerns</th><th>Status</th><th>Booked At</th><th>Action</th></tr></thead>
          <tbody>${bookingsHtml || '<tr><td colspan="8" style="text-align:center;color:#94a3b8;padding:30px">No bookings yet for this slot</td></tr>'}</tbody>
        </table></div>
      </div>
    </div>`;
    res.send(renderPage('Slot Details — ' + (slot.teacher_name || 'Unknown'), html, user, req));
  }));

  // ============================================================
  // ROUTE 6: POST /ptc/slots/:id/book — Book a slot
  // ============================================================
  app.post('/ptc/slots/:id/book', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, slotId = req.params.id;
    const { parent_name, parent_phone, parent_email, student_name, student_id, concerns } = req.body;

    if (!parent_name || !parent_name.trim() || !parent_phone || !parent_phone.trim()) {
      req.session.flash = { type: 'error', msg: 'Parent name and phone are required' };
      return res.redirect('/ptc/slots/' + slotId);
    }

    // Get slot and lock it
    const slot = (await pool.query(
      `SELECT s.*, (SELECT COUNT(*)::int FROM ptc_bookings b WHERE b.slot_id = s.id AND b.status = 'confirmed') as booking_count
       FROM ptc_slots s WHERE s.id=$1 AND s.tenant_id=$2 AND s.status != 'void' FOR UPDATE`,
      [slotId, tid]
    )).rows[0];

    if (!slot) {
      req.session.flash = { type: 'error', msg: 'Slot not found' };
      return res.redirect('/ptc/slots');
    }

    // Check if slot is available
    const isFull = (slot.booking_count || 0) >= (slot.max_bookings || 1);
    if (slot.status !== 'open' || isFull) {
      req.session.flash = { type: 'error', msg: 'This slot is no longer available' };
      return res.redirect('/ptc/slots/' + slotId);
    }

    // Prevent double-booking: same parent can't book same slot twice
    const existing = (await pool.query(
      `SELECT b.id FROM ptc_bookings b WHERE b.slot_id=$1 AND b.tenant_id=$2 AND b.parent_phone=$3 AND b.status='confirmed' LIMIT 1`,
      [slotId, tid, parent_phone.trim()]
    )).rows[0];

    if (existing) {
      req.session.flash = { type: 'error', msg: 'You have already booked this slot' };
      return res.redirect('/ptc/slots/' + slotId);
    }

    // Create booking
    const booking = (await pool.query(
      `INSERT INTO ptc_bookings (tenant_id, slot_id, parent_name, parent_phone, parent_email, student_name, student_id, concerns, status, booked_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'confirmed',NOW()) RETURNING id`,
      [tid, slotId, parent_name.trim(), parent_phone.trim(), (parent_email || '').trim() || null, (student_name || '').trim() || null, student_id ? parseInt(student_id) : null, (concerns || '').trim() || null]
    )).rows[0];

    // Update slot status if full
    const newBookingCount = slot.booking_count + 1;
    if (newBookingCount >= (slot.max_bookings || 1)) {
      await pool.query(`UPDATE ptc_slots SET status='booked' WHERE id=$1 AND tenant_id=$2`, [slotId, tid]);
    }

    // Log SMS notification
    try {
      await pool.query(
        `INSERT INTO sms_logs (tenant_id, phone_number, message, status, source, created_at)
         VALUES ($1,$2,$3,'queued','ptc_booking',NOW())`,
        [tid, parent_phone.trim(), `PTC Booking confirmed: ${slot.teacher_name} on ${fmtDate(slot.slot_date)} at ${fmtTime(slot.start_time)}-${fmtTime(slot.end_time)}. Venue: ${slot.venue || 'TBA'}. Slot ID: ${slotId}`]
      );
    } catch (e) { /* SMS log is non-critical */ }

    console.log(`[PTCBooking] Slot ${slotId} booked by ${parent_name.trim()} for ${slot.teacher_name}`);
    req.session.flash = { type: 'success', msg: `Successfully booked slot for ${parent_name.trim()}` };
    res.redirect('/ptc/slots/' + slotId);
  }));

  // ============================================================
  // ROUTE 7: POST /ptc/slots/:id/cancel — Cancel a booking
  // ============================================================
  app.post('/ptc/slots/:id/cancel', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, slotId = req.params.id;
    const bookingId = req.query.booking_id || req.body.booking_id;

    if (!bookingId) {
      req.session.flash = { type: 'error', msg: 'Booking ID required' };
      return res.redirect('/ptc/slots/' + slotId);
    }

    const booking = (await pool.query(
      `SELECT b.* FROM ptc_bookings b WHERE b.id=$1 AND b.tenant_id=$2 AND b.slot_id=$3 AND b.status='confirmed'`,
      [bookingId, tid, slotId]
    )).rows[0];

    if (!booking) {
      req.session.flash = { type: 'error', msg: 'Booking not found or already cancelled' };
      return res.redirect('/ptc/slots/' + slotId);
    }

    // Cancel booking
    await pool.query(`UPDATE ptc_bookings SET status='cancelled' WHERE id=$1 AND tenant_id=$2`, [bookingId, tid]);

    // Reopen slot if it was marked as booked/full
    const slot = (await pool.query(
      `SELECT s.*, (SELECT COUNT(*)::int FROM ptc_bookings b WHERE b.slot_id = s.id AND b.status = 'confirmed') as booking_count
       FROM ptc_slots s WHERE s.id=$1 AND s.tenant_id=$2`,
      [slotId, tid]
    )).rows[0];

    if (slot && slot.status === 'booked') {
      await pool.query(`UPDATE ptc_slots SET status='open' WHERE id=$1 AND tenant_id=$2`, [slotId, tid]);
    }

    // Log SMS cancellation
    try {
      await pool.query(
        `INSERT INTO sms_logs (tenant_id, phone_number, message, status, source, created_at)
         VALUES ($1,$2,$3,'queued','ptc_cancel',NOW())`,
        [tid, booking.parent_phone, `PTC Booking cancelled: Your conference with ${slot.teacher_name} on ${fmtDate(slot.slot_date)} has been cancelled. Booking ID: ${bookingId}`]
      );
    } catch (e) { /* SMS log is non-critical */ }

    console.log(`[PTCBooking] Booking ${bookingId} cancelled for slot ${slotId}`);
    req.session.flash = { type: 'success', msg: 'Booking cancelled successfully' };
    res.redirect('/ptc/slots/' + slotId);
  }));

  // ============================================================
  // ROUTE 8: POST /ptc/slots/:id/delete — Delete/void a slot
  // ============================================================
  app.post('/ptc/slots/:id/delete', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, slotId = req.params.id;

    const slot = (await pool.query(
      `SELECT * FROM ptc_slots WHERE id=$1 AND tenant_id=$2`, [slotId, tid]
    )).rows[0];

    if (!slot) {
      req.session.flash = { type: 'error', msg: 'Slot not found' };
      return res.redirect('/ptc/slots');
    }

    // Void the slot and cancel all active bookings
    await pool.query(`UPDATE ptc_slots SET status='void' WHERE id=$1 AND tenant_id=$2`, [slotId, tid]);
    await pool.query(`UPDATE ptc_bookings SET status='cancelled' WHERE slot_id=$1 AND tenant_id=$2 AND status='confirmed'`, [slotId, tid]);

    // Notify affected parents via SMS log
    const activeBookings = (await pool.query(
      `SELECT parent_phone, parent_name, student_name FROM ptc_bookings WHERE slot_id=$1 AND tenant_id=$2`,
      [slotId, tid]
    )).rows;

    for (const b of activeBookings) {
      try {
        await pool.query(
          `INSERT INTO sms_logs (tenant_id, phone_number, message, status, source, created_at)
           VALUES ($1,$2,$3,'queued','ptc_void',NOW())`,
          [tid, b.parent_phone, `PTC Notice: Conference slot with ${slot.teacher_name} on ${fmtDate(slot.slot_date)} has been cancelled. Please book another slot.`]
        );
      } catch (e) { /* non-critical */ }
    }

    console.log(`[PTCBooking] Slot ${slotId} voided (was ${slot.teacher_name} on ${slot.slot_date})`);
    req.session.flash = { type: 'success', msg: `Slot voided. ${activeBookings.length} booking(s) cancelled.` };
    res.redirect('/ptc/slots');
  }));

  // ============================================================
  // ROUTE 9: GET /ptc/my-bookings — Current user's bookings
  // ============================================================
  app.get('/ptc/my-bookings', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { status } = req.query;

    // Show all bookings for the tenant (admins can see all; for a parent view, would filter by phone)
    let where = ['b.tenant_id=$1'], params = [tid], pi = 2;
    if (status) { where.push(`b.status=$${pi++}`); params.push(status); }

    const bookings = (await pool.query(
      `SELECT b.*, s.slot_date, s.start_time, s.end_time, s.teacher_name, s.class, s.venue, s.duration_minutes
       FROM ptc_bookings b JOIN ptc_slots s ON s.id = b.slot_id
       WHERE ${where.join(' AND ')}
       ORDER BY s.slot_date, s.start_time, b.booked_at DESC LIMIT 200`,
      params
    )).rows;

    // Group by date
    const grouped = {};
    for (const b of bookings) {
      const dk = String(b.slot_date);
      if (!grouped[dk]) grouped[dk] = [];
      grouped[dk].push(b);
    }

    const groupedHtml = Object.entries(grouped).map(([dateKey, items]) => {
      const rows = items.map(b => `<tr>
        <td><strong>${esc(b.parent_name || '—')}</strong></td>
        <td>${esc(b.student_name || '—')}</td>
        <td>${esc(b.teacher_name || '—')}</td>
        <td>${fmtTime(b.start_time)} - ${fmtTime(b.end_time)}</td>
        <td>${esc(b.class || '—')}</td>
        <td>${esc(b.venue || '—')}</td>
        <td style="font-size:12px">${esc(b.concerns || '—')}</td>
        <td>${bookingBadge(b.status)}</td>
        <td style="font-size:12px">${fmtDateTime(b.booked_at)}</td>
        <td>
          ${b.status === 'confirmed' ? `<form method="POST" action="/ptc/slots/${b.slot_id}/cancel?booking_id=${b.id}" style="display:inline"><button class="btn btn-sm btn-red" type="submit" onclick="return confirm('Cancel this booking?')">Cancel</button></form>` : ''}
          <a href="/ptc/slots/${b.slot_id}" class="btn btn-sm btn-blue">View</a>
        </td>
      </tr>`).join('');

      return `<div style="margin-bottom:20px">
        <div style="font-size:14px;font-weight:700;color:#1e293b;margin-bottom:8px;padding-bottom:6px;border-bottom:2px solid #0891b2">📅 ${fmtDate(dateKey)} <span style="color:#94a3b8;font-weight:400">(${items.length} booking${items.length > 1 ? 's' : ''})</span></div>
        <div style="overflow-x:auto"><table class="ptc-table">
          <thead><tr><th>Parent</th><th>Student</th><th>Teacher</th><th>Time</th><th>Class</th><th>Venue</th><th>Concerns</th><th>Status</th><th>Booked</th><th>Actions</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
      </div>`;
    }).join('');

    // Summary stats
    const confirmed = bookings.filter(b => b.status === 'confirmed').length;
    const cancelled = bookings.filter(b => b.status === 'cancelled').length;

    const html = PTC_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('mybookings')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">📌 All Bookings</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">${bookings.length} total bookings</p></div>
        <div style="display:flex;gap:8px">
          <a href="/ptc/slots" class="ptc-btn ptc-btn-primary">📋 Browse Slots</a>
        </div>
      </div>

      <div class="stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-bottom:20px">
        <div class="stat-card"><div class="stat-num">${bookings.length}</div><div class="muted" style="font-size:11px">Total Bookings</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#16a34a">${confirmed}</div><div class="muted" style="font-size:11px">Confirmed</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#dc2626">${cancelled}</div><div class="muted" style="font-size:11px">Cancelled</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#0891b2">${Object.keys(grouped).length}</div><div class="muted" style="font-size:11px">Conference Days</div></div>
      </div>

      <div class="ptc-filter">
        <div><label>Status</label><select onchange="location.href='/ptc/my-bookings?status='+this.value">
          <option value="">All</option>
          <option value="confirmed" ${status==='confirmed'?'selected':''}>Confirmed</option>
          <option value="cancelled" ${status==='cancelled'?'selected':''}>Cancelled</option>
          <option value="pending" ${status==='pending'?'selected':''}>Pending</option></select></div>
      </div>

      ${groupedHtml || '<div class="card" style="text-align:center;padding:40px"><p style="color:#94a3b8;font-size:14px">No bookings found</p><a href="/ptc/slots" class="btn btn-blue" style="margin-top:12px">Browse Available Slots</a></div>'}
    </div>`;
    res.send(renderPage('My Bookings', html, user, req));
  }));

  // ============================================================
  // ROUTE 10: GET /ptc/reports — Conference reports
  // ============================================================
  app.get('/ptc/reports', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { from, to } = req.query;
    const dateFrom = from || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const dateTo = to || today();

    // --- Teacher Utilization ---
    const teacherUtilization = (await pool.query(
      `SELECT s.teacher_name,
        COUNT(s.id)::int as total_slots,
        COUNT(b.id)::int as booked_slots,
        CASE WHEN COUNT(s.id) > 0 THEN ROUND(COUNT(b.id)::numeric / COUNT(s.id) * 100, 1) ELSE 0 END as utilization_pct
       FROM ptc_slots s
       LEFT JOIN ptc_bookings b ON b.slot_id = s.id AND b.status = 'confirmed'
       WHERE s.tenant_id=$1 AND s.slot_date BETWEEN $2 AND $3 AND s.status != 'void'
       GROUP BY s.teacher_name
       ORDER BY utilization_pct DESC`,
      [tid, dateFrom, dateTo]
    )).rows;

    const overallSlots = teacherUtilization.reduce((s, r) => s + r.total_slots, 0);
    const overallBooked = teacherUtilization.reduce((s, r) => s + r.booked_slots, 0);
    const overallRate = overallSlots > 0 ? Math.round((overallBooked / overallSlots) * 100) : 0;

    // --- Parent Attendance ---
    const parentStats = (await pool.query(
      `SELECT COUNT(DISTINCT b.parent_phone)::int as unique_parents,
        COUNT(DISTINCT b.student_name)::int as unique_students,
        COUNT(b.id)::int as total_bookings,
        COUNT(b.id) FILTER (WHERE b.status = 'confirmed')::int as confirmed_bookings,
        COUNT(b.id) FILTER (WHERE b.status = 'cancelled')::int as cancelled_bookings
       FROM ptc_bookings b
       JOIN ptc_slots s ON s.id = b.slot_id
       WHERE b.tenant_id=$1 AND s.slot_date BETWEEN $2 AND $3`,
      [tid, dateFrom, dateTo]
    )).rows[0];

    // --- Class Breakdown ---
    const classBreakdown = (await pool.query(
      `SELECT s.class,
        COUNT(DISTINCT s.id)::int as slots,
        COUNT(DISTINCT b.id)::int as bookings,
        COUNT(DISTINCT b.parent_phone)::int as parents
       FROM ptc_slots s
       LEFT JOIN ptc_bookings b ON b.slot_id = s.id AND b.status = 'confirmed'
       WHERE s.tenant_id=$1 AND s.slot_date BETWEEN $2 AND $3 AND s.status != 'void'
       GROUP BY s.class
       ORDER BY bookings DESC`,
      [tid, dateFrom, dateTo]
    )).rows;

    // --- Daily Trend ---
    const dailyTrend = (await pool.query(
      `SELECT s.slot_date,
        COUNT(DISTINCT s.id)::int as slots,
        COUNT(DISTINCT b.id)::int as bookings,
        COUNT(DISTINCT s.teacher_name)::int as teachers
       FROM ptc_slots s
       LEFT JOIN ptc_bookings b ON b.slot_id = s.id AND b.status = 'confirmed'
       WHERE s.tenant_id=$1 AND s.slot_date BETWEEN $2 AND $3 AND s.status != 'void'
       GROUP BY s.slot_date ORDER BY s.slot_date`,
      [tid, dateFrom, dateTo]
    )).rows;

    // --- Peak Hours ---
    const peakHours = (await pool.query(
      `SELECT EXTRACT(HOUR FROM s.start_time)::int as hour,
        COUNT(s.id)::int as slots,
        COUNT(b.id)::int as bookings
       FROM ptc_slots s
       LEFT JOIN ptc_bookings b ON b.slot_id = s.id AND b.status = 'confirmed'
       WHERE s.tenant_id=$1 AND s.slot_date BETWEEN $2 AND $3 AND s.status != 'void'
       GROUP BY EXTRACT(HOUR FROM s.start_time)
       ORDER BY hour`,
      [tid, dateFrom, dateTo]
    )).rows;
    const maxPeakBookings = peakHours.reduce((m, r) => m > r.bookings ? m : r.bookings, 1);

    // --- Top Concerns ---
    const topConcerns = (await pool.query(
      `SELECT b.concerns, COUNT(b.id)::int as cnt
       FROM ptc_bookings b JOIN ptc_slots s ON s.id = b.slot_id
       WHERE b.tenant_id=$1 AND b.concerns IS NOT NULL AND b.concerns != '' AND s.slot_date BETWEEN $2 AND $3 AND b.status='confirmed'
       GROUP BY b.concerns ORDER BY cnt DESC LIMIT 10`,
      [tid, dateFrom, dateTo]
    )).rows;

    // Build HTML components
    const teacherRows = teacherUtilization.map(t => {
      const pct = t.utilization_pct || 0;
      const color = pct >= 80 ? '#16a34a' : pct >= 50 ? '#f59e0b' : '#dc2626';
      return `<tr>
        <td style="font-weight:600">${esc(t.teacher_name || 'Unknown')}</td>
        <td>${t.total_slots}</td>
        <td>${t.booked_slots}</td>
        <td>
          <div style="display:flex;align-items:center;gap:8px">
            <div style="flex:1;background:#f1f5f9;border-radius:6px;height:18px;overflow:hidden;max-width:120px">
              <div style="height:100%;width:${pct}%;background:${color};border-radius:6px;transition:.3s"></div>
            </div>
            <span style="font-size:12px;font-weight:700;color:${color}">${pct}%</span>
          </div>
        </td>
      </tr>`;
    }).join('');

    const classRows = classBreakdown.map(c => {
      const rate = c.slots > 0 ? Math.round((c.bookings / c.slots) * 100) : 0;
      return `<tr>
        <td style="font-weight:600">${esc(c.class || 'Unassigned')}</td>
        <td>${c.slots}</td>
        <td>${c.bookings}</td>
        <td>${c.parents}</td>
        <td><span style="font-weight:700;color:${rate >= 70 ? '#16a34a' : rate >= 40 ? '#f59e0b' : '#dc2626'}">${rate}%</span></td>
      </tr>`;
    }).join('');

    const dailyBars = dailyTrend.map(d => {
      const rate = d.slots > 0 ? Math.round((d.bookings / d.slots) * 100) : 0;
      const color = rate >= 80 ? '#16a34a' : rate >= 50 ? '#f59e0b' : '#dc2626';
      return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <span style="font-size:11px;color:#64748b;min-width:80px">${fmtDate(d.slot_date)}</span>
        <div style="flex:1;background:#f1f5f9;border-radius:6px;height:22px;overflow:hidden;position:relative">
          <div style="height:100%;width:${rate}%;background:${color};border-radius:6px;transition:.3s"></div>
          <span style="position:absolute;right:6px;top:3px;font-size:11px;font-weight:700;color:#1e293b">${rate}%</span>
        </div>
        <span style="font-size:11px;color:#94a3b8;min-width:70px">${d.bookings}/${d.slots}</span>
        <span style="font-size:11px;color:#0891b2;font-weight:600">${d.teachers}T</span>
      </div>`;
    }).join('');

    const peakBars = Array.from({ length: 12 }, (_, i) => {
      const h = 7 + i; // 07:00 to 18:00
      const found = peakHours.find(p => p.hour === h);
      const cnt = found ? found.bookings : 0;
      const sCnt = found ? found.slots : 0;
      const w = maxPeakBookings > 0 ? (cnt / maxPeakBookings) * 100 : 0;
      return `<div style="text-align:center">
        <div style="height:${Math.max(w, 4)}px;background:#0891b2;border-radius:4px 4px 0 0;min-height:4px;margin:0 auto;max-width:40px;transition:.2s"></div>
        <div style="font-size:10px;color:#64748b;margin-top:4px">${String(h).padStart(2, '0')}:00</div>
        <div style="font-size:10px;font-weight:700;color:#0891b2">${cnt}</div>
      </div>`;
    }).join('');

    const concernRows = topConcerns.map((c, i) => `<div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:6px">
      <span style="width:20px;height:20px;border-radius:50%;background:#0891b2;color:#fff;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex-shrink:0">${i + 1}</span>
      <span style="font-size:13px;flex:1;color:#1e293b">${esc(c.concerns)}</span>
      <span style="font-size:12px;font-weight:700;color:#64748b">${c.cnt}x</span>
    </div>`).join('');

    const html = PTC_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('reports')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">📈 Conference Reports</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Analyze conference performance and attendance</p></div>
      </div>

      <!-- Date Filters -->
      <div class="ptc-filter">
        <div><label>From</label><input type="date" value="${esc(dateFrom)}" onchange="location.href='/ptc/reports?from='+this.value+'&to=${esc(dateTo)}'"></div>
        <div><label>To</label><input type="date" value="${esc(dateTo)}" onchange="location.href='/ptc/reports?from=${esc(dateFrom)}&to='+this.value"></div>
      </div>

      <!-- Overview Stats -->
      <div class="stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-bottom:20px">
        <div class="stat-card"><div class="stat-num" style="color:#0891b2">${overallSlots}</div><div class="muted" style="font-size:11px">Total Slots</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#16a34a">${overallBooked}</div><div class="muted" style="font-size:11px">Bookings Filled</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#7c3aed">${overallRate}%</div><div class="muted" style="font-size:11px">Overall Utilization</div></div>
        <div class="stat-card"><div class="stat-num">${parentStats.unique_parents || 0}</div><div class="muted" style="font-size:11px">Unique Parents</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${parentStats.unique_students || 0}</div><div class="muted" style="font-size:11px">Unique Students</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#dc2626">${parentStats.cancelled_bookings || 0}</div><div class="muted" style="font-size:11px">Cancelled</div></div>
      </div>

      <!-- Teacher Utilization + Class Breakdown -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
        <div class="card" style="padding:20px">
          <h3 style="font-size:15px;color:#1e293b;margin-bottom:14px">👨‍🏫 Teacher Utilization Rate</h3>
          <div style="overflow-x:auto"><table class="ptc-table">
            <thead><tr><th>Teacher</th><th>Slots</th><th>Booked</th><th>Utilization</th></tr></thead>
            <tbody>${teacherRows || '<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:20px">No data</td></tr>'}</tbody>
          </table></div>
        </div>
        <div class="card" style="padding:20px">
          <h3 style="font-size:15px;color:#1e293b;margin-bottom:14px">🏫 Class-wise Breakdown</h3>
          <div style="overflow-x:auto"><table class="ptc-table">
            <thead><tr><th>Class</th><th>Slots</th><th>Bookings</th><th>Parents</th><th>Rate</th></tr></thead>
            <tbody>${classRows || '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:20px">No data</td></tr>'}</tbody>
          </table></div>
        </div>
      </div>

      <!-- Daily Trend + Peak Hours -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
        <div class="card" style="padding:20px">
          <h3 style="font-size:15px;color:#1e293b;margin-bottom:14px">📅 Daily Booking Trend</h3>
          ${dailyBars || '<p style="color:#94a3b8;font-size:13px;text-align:center;padding:20px">No daily data</p>'}
        </div>
        <div class="card" style="padding:20px">
          <h3 style="font-size:15px;color:#1e293b;margin-bottom:14px">⏰ Peak Hours (07:00–18:00)</h3>
          <div style="display:flex;align-items:flex-end;gap:4px;height:140px;padding-top:20px">
            ${peakBars || '<p style="color:#94a3b8;font-size:13px;text-align:center;width:100%;align-self:center">No hourly data</p>'}
          </div>
        </div>
      </div>

      <!-- Top Concerns -->
      ${topConcerns.length ? `<div class="card" style="padding:20px">
        <h3 style="font-size:15px;color:#1e293b;margin-bottom:14px">💬 Top Parent Concerns</h3>
        ${concernRows}
      </div>` : ''}
    </div>`;
    res.send(renderPage('PTC Reports', html, user, req));
  }));

  // ============================================================
  // END OF MODULE
  // ============================================================
  console.log('[PTCBooking] Module loaded — 10 routes registered');
};
