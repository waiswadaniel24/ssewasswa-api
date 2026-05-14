// ============================================================
// ADVANCED CALENDAR & SCHEDULING MODULE — SSEWASSWA Comfort Platform
// Monthly/week/day views, event CRUD, attendees, RSVP,
// reminders, recurrence, color-coded events, JSON API.
// ============================================================
// Usage in server.js:
//   const calendarScheduler = require('./calendar-scheduler');
//   calendarScheduler(app, pool, requireAuth, logger, audit, notify, ah, esc, renderPage, bcrypt);
// ============================================================

'use strict';

// ============================================================
// INTERNAL HELPERS
// ============================================================
const formatDate = d => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const formatTime = d => d ? new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
const formatDateTime = d => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const COLORS = ['#4f46e5', '#dc2626', '#059669', '#f59e0b', '#8b5cf6', '#ec4899'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function rsvpBadge(r) {
  const m = { pending: { bg: '#f1f5f9', c: '#64748b', l: 'Pending' }, accepted: { bg: '#dcfce7', c: '#16a34a', l: 'Accepted' }, declined: { bg: '#fee2e2', c: '#dc2626', l: 'Declined' }, maybe: { bg: '#fef9c3', c: '#a16207', l: 'Maybe' } };
  const s = m[r] || m.pending;
  return `<span style="display:inline-block;padding:3px 12px;border-radius:20px;font-size:11px;font-weight:700;background:${s.bg};color:${s.c}">${s.l}</span>`;
}

function visLabel(v) {
  const m = { public: '🌍 Public', private: '🔒 Private', team: '👥 Team' };
  return m[v] || '—';
}

function recurLabel(r) {
  const m = { none: '—', daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };
  return m[r] || '—';
}

// Shared CSS
const CS_CSS = `<style>
.cs-nav{display:flex;gap:6px;margin-bottom:20px;flex-wrap:wrap;align-items:center}
.cs-nav a{padding:8px 16px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#475569;background:#f1f5f9;transition:.15s}
.cs-nav a:hover{background:#e2e8f0}.cs-nav a.active{background:#4f46e5;color:#fff}
.cs-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;margin-bottom:20px}
.cs-stat{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:18px;text-align:center;transition:.15s}
.cs-stat:hover{box-shadow:0 2px 12px rgba(0,0,0,.06)}
.cs-stat-val{font-size:28px;font-weight:800;color:#1e293b}.cs-stat-lbl{font-size:11px;color:#94a3b8;margin-top:4px;text-transform:uppercase;letter-spacing:.3px}
.cs-btn{display:inline-flex;align-items:center;gap:6px;padding:9px 18px;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:.15s}
.cs-btn:hover{opacity:.9;transform:translateY(-1px)}
.cs-btn-primary{background:#4f46e5;color:#fff}.cs-btn-danger{background:#fee2e2;color:#dc2626}.cs-btn-secondary{background:#f1f5f9;color:#475569}.cs-btn-success{background:#059669;color:#fff}
.cs-table{width:100%;border-collapse:collapse;font-size:13px}
.cs-table th{padding:10px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#f8fafc}
.cs-table td{padding:9px 14px;border-bottom:1px solid #f1f5f9;color:#1e293b}.cs-table tr:hover{background:#f8fafc}
.cs-cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:3px}
.cs-cal-head{text-align:center;padding:8px;font-weight:700;color:#475569;background:#f1f5f9;border-radius:6px;font-size:12px}
.cs-cal-day{min-height:100px;padding:6px;background:#fff;border:1px solid #f1f5f9;border-radius:6px;overflow:hidden}
.cs-cal-day.today{border-color:#4f46e5;background:#eef2ff}
.cs-cal-day.other{opacity:.4}.cs-cal-day-num{font-weight:700;color:#1e293b;font-size:12px;margin-bottom:4px}
.cs-cal-evt{font-size:10px;padding:2px 6px;border-radius:4px;margin-bottom:2px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block;color:#fff;font-weight:600}
.cs-week-grid{display:grid;grid-template-columns:60px repeat(7,1fr);border:1px solid #e2e8f0;border-radius:8px;overflow:hidden}
.cs-week-hdr{background:#f8fafc;padding:10px 6px;text-align:center;font-size:12px;font-weight:700;color:#475569;border-bottom:1px solid #e2e8f0}
.cs-week-hdr.today-col{background:#eef2ff;color:#4f46e5}
.cs-week-hour{background:#f8fafc;padding:6px;text-align:right;font-size:11px;color:#94a3b8;border-bottom:1px solid #f1f5f9;border-right:1px solid #e2e8f0}
.cs-week-cell{border-bottom:1px solid #f1f5f9;border-right:1px solid #f1f5f9;position:relative;min-height:48px}
.cs-week-evt{position:absolute;left:2px;right:2px;border-radius:6px;padding:3px 6px;font-size:10px;color:#fff;font-weight:600;overflow:hidden;cursor:pointer;z-index:2}
.cs-day-timeline{max-width:800px;margin:0 auto;position:relative}
.cs-day-hour{display:flex;align-items:start;padding:8px 0;border-bottom:1px solid #f1f5f9;min-height:52px;position:relative}
.cs-day-hour-label{width:70px;font-size:12px;color:#94a3b8;font-weight:600;text-align:right;padding-right:14px;flex-shrink:0}
.cs-day-hour-content{flex:1;position:relative;min-height:44px}
.cs-day-evt{position:absolute;left:4px;right:4px;border-radius:8px;padding:8px 12px;color:#fff;cursor:pointer;z-index:2;overflow:hidden}
.cs-day-evt h4{margin:0 0 2px;font-size:13px}.cs-day-evt p{margin:0;font-size:11px;opacity:.85}
.cs-color-dot{width:18px;height:18px;border-radius:50%;display:inline-block;cursor:pointer;border:3px solid transparent;transition:.15s}
.cs-color-dot.sel{border-color:#1e293b;transform:scale(1.2)}
.cs-form-row{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.cs-form-row-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px}
.cs-form label{font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px}
.cs-form input,.cs-form textarea,.cs-form select{width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px;background:#fff;box-sizing:border-box}
.cs-form input:focus,.cs-form textarea:focus,.cs-form select:focus{outline:none;border-color:#6366f1}
.cs-rsvp-btn{padding:20px 40px;border:3px solid;border-radius:16px;font-size:18px;font-weight:700;cursor:pointer;transition:.2s;text-decoration:none;display:inline-flex;flex-direction:column;align-items:center;gap:6px}
.cs-rsvp-btn:hover{transform:translateY(-3px);box-shadow:0 8px 24px rgba(0,0,0,.12)}
@media(max-width:768px){.cs-cal-grid{font-size:10px}.cs-cal-day{min-height:60px}.cs-week-grid{font-size:10px}.cs-stats{grid-template-columns:1fr 1fr}.cs-form-row,.cs-form-row-3{grid-template-columns:1fr}.cs-nav{gap:4px}.cs-nav a{padding:6px 10px;font-size:12px}}
</style>`;

// ============================================================
// MODULE ENTRY POINT
// ============================================================
module.exports = function calendarScheduler(app, pool, requireAuth, logger, audit, notify, ah, esc, renderPage, bcrypt) {
  if (!esc) esc = s => String(s == null ? '' : typeof s === 'object' ? JSON.stringify(s) : s).replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
  if (!ah) ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  // ============================================================
  // DATABASE MIGRATIONS
  // ============================================================
  (async () => {
    const c = await pool.connect().catch(() => null);
    if (!c) { logger.warn('[CalendarScheduler] DB connect failed'); return; }
    try {
      // calendar_events already exists — extend it
      const extCols = [
        `ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS color VARCHAR(20) DEFAULT '#4f46e5'`,
        `ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS location TEXT`,
        `ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS is_all_day BOOLEAN DEFAULT false`,
        `ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS recurrence VARCHAR(20) DEFAULT 'none'`,
        `ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS recurrence_end DATE`,
        `ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS visibility VARCHAR(20) DEFAULT 'team'`,
        `ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS attendee_emails TEXT[]`
      ];
      for (const sql of extCols) { try { await c.query(sql); } catch(e) { /* column may already exist */ } }

      await c.query(`CREATE TABLE IF NOT EXISTS event_attendees (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        event_id INTEGER NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
        user_email VARCHAR(255) NOT NULL, response VARCHAR(20) DEFAULT 'pending',
        comment TEXT, responded_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await c.query(`CREATE TABLE IF NOT EXISTS event_reminders (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        event_id INTEGER NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
        reminder_at TIMESTAMPTZ NOT NULL, method VARCHAR(20) DEFAULT 'both',
        sent BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_ea_tenant ON event_attendees(tenant_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_ea_event ON event_attendees(event_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_ea_email ON event_attendees(user_email)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_er_tenant ON event_reminders(tenant_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_er_event ON event_reminders(event_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_ce_start ON calendar_events(start_time)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_ce_tenant ON calendar_events(tenant_id)`);
      logger.info({ msg: '[CalendarScheduler] Migrations applied' });
    } catch (e) { logger.error({ msg: '[CalendarScheduler] Migration error', error: e.message }); }
    finally { c.release(); }
  })();

  // Nav helper
  const nav = (active) => `<div class="cs-nav">
    <a href="/calendar" class="${active==='month'?'active':''}">🗓 Month</a>
    <a href="/calendar/week" class="${active==='week'?'active':''}">📅 Week</a>
    <a href="/calendar/day" class="${active==='day'?'active':''}">🕐 Day</a>
    <a href="/calendar/upcoming" class="${active==='upcoming'?'active':''}">📋 Upcoming</a>
    <a href="/calendar/events/new" class="cs-btn cs-btn-primary" style="margin-left:auto;padding:8px 16px">+ New Event</a>
  </div>`;

  // ============================================================
  // ROUTE 1: GET /calendar — Monthly Grid View
  // ============================================================
  app.get('/calendar', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const now = new Date();
    const y = parseInt(req.query.year) || now.getFullYear();
    const m = parseInt(req.query.month) || now.getMonth(); // 0-based
    const firstDay = new Date(y, m, 1);
    const lastDay = new Date(y, m + 1, 0);
    const startPad = firstDay.getDay();
    const totalDays = lastDay.getDate();
    const prevMonthLast = new Date(y, m, 0).getDate();

    const monthStart = new Date(y, m, 1).toISOString();
    const monthEnd = new Date(y, m + 1, 0, 23, 59, 59).toISOString();
    const events = (await pool.query(`SELECT * FROM calendar_events WHERE tenant_id=$1 AND start_time >= $2 AND start_time <= $3 ORDER BY start_time`, [tid, monthStart, monthEnd])).rows;

    const todayStr = now.toISOString().slice(0, 10);
    const todayEvents = events.filter(e => e.start_time.toISOString().slice(0, 10) === todayStr);
    const weekEnd = new Date(now); weekEnd.setDate(weekEnd.getDate() + 7);
    const weekEvents = events.filter(e => new Date(e.start_time) <= weekEnd && new Date(e.start_time) >= now);

    // Build calendar grid cells
    let cells = '';
    // Previous month padding
    for (let i = startPad - 1; i >= 0; i--) {
      const d = prevMonthLast - i;
      cells += `<div class="cs-cal-day other"><div class="cs-cal-day-num">${d}</div></div>`;
    }
    // Current month days
    for (let d = 1; d <= totalDays; d++) {
      const dateStr = new Date(y, m, d).toISOString().slice(0, 10);
      const isToday = dateStr === todayStr;
      const dayEvents = events.filter(e => e.start_time.toISOString().slice(0, 10) === dateStr);
      const dots = dayEvents.slice(0, 4).map(e => `<a href="/calendar/events/${e.id}" class="cs-cal-evt" style="background:${e.color || '#4f46e5'}">${esc(e.title)}</a>`).join('');
      const more = dayEvents.length > 4 ? `<span style="font-size:9px;color:#94a3b8;font-weight:600">+${dayEvents.length - 4} more</span>` : '';
      cells += `<div class="cs-cal-day${isToday ? ' today' : ''}"><div class="cs-cal-day-num">${d}</div>${dots}${more}</div>`;
    }
    // Next month padding
    const totalCells = startPad + totalDays;
    const remaining = (7 - (totalCells % 7)) % 7;
    for (let d = 1; d <= remaining; d++) {
      cells += `<div class="cs-cal-day other"><div class="cs-cal-day-num">${d}</div></div>`;
    }

    const prevM = m === 0 ? 11 : m - 1;
    const prevY = m === 0 ? y - 1 : y;
    const nextM = m === 11 ? 0 : m + 1;
    const nextY = m === 11 ? y + 1 : y;

    const html = CS_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('month')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div style="display:flex;align-items:center;gap:10px">
          <a href="/calendar?year=${prevY}&month=${prevM}" class="cs-btn cs-btn-secondary">← Prev</a>
          <h1 style="font-size:22px;color:#1e293b;margin:0">${MONTHS[m]} ${y}</h1>
          <a href="/calendar?year=${nextY}&month=${nextM}" class="cs-btn cs-btn-secondary">Next →</a>
          <a href="/calendar" class="cs-btn cs-btn-secondary" style="font-size:12px;padding:6px 12px">Today</a>
        </div>
      </div>
      <div class="cs-stats">
        <div class="cs-stat"><div class="cs-stat-val" style="color:#4f46e5">${todayEvents.length}</div><div class="cs-stat-lbl">Today's Events</div></div>
        <div class="cs-stat"><div class="cs-stat-val" style="color:#059669">${weekEvents.length}</div><div class="cs-stat-lbl">This Week</div></div>
        <div class="cs-stat"><div class="cs-stat-val" style="color:#f59e0b">${events.length}</div><div class="cs-stat-lbl">This Month</div></div>
      </div>
      <div class="card" style="padding:16px;overflow-x:auto">
        <div class="cs-cal-grid">
          ${DAYS.map(d => `<div class="cs-cal-head">${d}</div>`).join('')}
          ${cells}
        </div>
      </div>
    </div>`;
    res.send(renderPage('Calendar', html, user));
  }));

  // ============================================================
  // ROUTE 2: GET /calendar/week — Week View
  // ============================================================
  app.get('/calendar/week', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const now = new Date();
    const offset = parseInt(req.query.weekOffset) || 0;
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay() + (offset * 7));
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const events = (await pool.query(`SELECT * FROM calendar_events WHERE tenant_id=$1 AND start_time >= $2 AND start_time < $3 ORDER BY start_time`, [tid, weekStart.toISOString(), weekEnd.toISOString()])).rows;
    const todayStr = now.toISOString().slice(0, 10);
    const hours = [];
    for (let h = 6; h <= 22; h++) hours.push(h);

    // Build week header + cells
    const dayHeaders = [];
    const allCells = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(weekStart);
      date.setDate(date.getDate() + d);
      const dateStr = date.toISOString().slice(0, 10);
      const isToday = dateStr === todayStr;
      dayHeaders.push(`<div class="cs-week-hdr${isToday ? ' today-col' : ''}"><div style="font-size:11px;color:#94a3b8">${DAYS[d]}</div><div style="font-size:16px;font-weight:800;${isToday ? 'color:#4f46e5' : 'color:#1e293b'}">${date.getDate()}</div></div>`);
    }

    for (const h of hours) {
      const label = `${String(h).padStart(2, '0')}:00`;
      let row = `<div class="cs-week-hour">${label}</div>`;
      for (let d = 0; d < 7; d++) {
        const date = new Date(weekStart);
        date.setDate(date.getDate() + d);
        date.setHours(h, 0, 0, 0);
        const dateStr = date.toISOString().slice(0, 10);
        const dayEvts = events.filter(e => {
          const es = new Date(e.start_time);
          return es.toISOString().slice(0, 10) === dateStr && es.getHours() === h;
        });
        const evtBlocks = dayEvts.map(e => {
          const endH = new Date(e.end_time).getHours();
          const span = Math.max(1, endH - h);
          return `<a href="/calendar/events/${e.id}" class="cs-week-evt" style="background:${e.color || '#4f46e5'};top:2px;height:${span * 48 - 4}px">${esc(e.title)}</a>`;
        }).join('');
        row += `<div class="cs-week-cell">${evtBlocks}</div>`;
      }
      allCells.push(row);
    }

    const html = CS_CSS + `<div style="max-width:1400px;margin:0 auto">
      ${nav('week')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div style="display:flex;align-items:center;gap:10px">
          <a href="/calendar/week?weekOffset=${offset - 1}" class="cs-btn cs-btn-secondary">← Prev</a>
          <h1 style="font-size:22px;color:#1e293b;margin:0">Week of ${formatDate(weekStart)}</h1>
          <a href="/calendar/week?weekOffset=${offset + 1}" class="cs-btn cs-btn-secondary">Next →</a>
          <a href="/calendar/week?weekOffset=0" class="cs-btn cs-btn-secondary" style="font-size:12px;padding:6px 12px">Today</a>
        </div>
      </div>
      <div class="card" style="overflow-x:auto;padding:0">
        <div class="cs-week-grid">
          <div class="cs-week-hdr"></div>
          ${dayHeaders.join('')}
          ${allCells.join('')}
        </div>
      </div>
    </div>`;
    res.send(renderPage('Week View', html, user));
  }));

  // ============================================================
  // ROUTE 3: GET /calendar/day — Day View
  // ============================================================
  app.get('/calendar/day', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const now = new Date();
    const dateStr = req.query.date || now.toISOString().slice(0, 10);
    const dayStart = new Date(dateStr + 'T00:00:00');
    const dayEnd = new Date(dateStr + 'T23:59:59');
    const events = (await pool.query(`SELECT * FROM calendar_events WHERE tenant_id=$1 AND start_time >= $2 AND start_time < $3 ORDER BY start_time`, [tid, dayStart.toISOString(), dayEnd.toISOString()])).rows;

    const prevDate = new Date(dayStart); prevDate.setDate(prevDate.getDate() - 1);
    const nextDate = new Date(dayStart); nextDate.setDate(nextDate.getDate() + 1);

    const hours = [];
    for (let h = 0; h <= 23; h++) {
      const label = h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`;
      const dayEvts = events.filter(e => new Date(e.start_time).getHours() === h);
      const evtBlocks = dayEvts.map(e => {
        const startMins = new Date(e.start_time).getMinutes();
        const endMins = new Date(e.end_time).getHours() * 60 + new Date(e.end_time).getMinutes();
        const startTotal = h * 60 + startMins;
        const duration = Math.max(30, endMins - startTotal);
        const topPx = (startMins / 60) * 52;
        return `<a href="/calendar/events/${e.id}" class="cs-day-evt" style="background:${e.color || '#4f46e5'};top:${topPx}px;min-height:${(duration / 60) * 52}px"><h4>${esc(e.title)}</h4><p>${formatTime(e.start_time)} – ${formatTime(e.end_time)}</p></a>`;
      }).join('');
      hours.push(`<div class="cs-day-hour"><div class="cs-day-hour-label">${label}</div><div class="cs-day-hour-content">${evtBlocks}</div></div>`);
    }

    const html = CS_CSS + `<div style="max-width:900px;margin:0 auto">
      ${nav('day')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div style="display:flex;align-items:center;gap:10px">
          <a href="/calendar/day?date=${prevDate.toISOString().slice(0, 10)}" class="cs-btn cs-btn-secondary">← Prev</a>
          <h1 style="font-size:22px;color:#1e293b;margin:0">${formatDate(dayStart)}</h1>
          <a href="/calendar/day?date=${nextDate.toISOString().slice(0, 10)}" class="cs-btn cs-btn-secondary">Next →</a>
          <a href="/calendar/day?date=${now.toISOString().slice(0, 10)}" class="cs-btn cs-btn-secondary" style="font-size:12px;padding:6px 12px">Today</a>
        </div>
        <span style="font-size:13px;color:#94a3b8">${events.length} events</span>
      </div>
      <div class="card" style="padding:20px;overflow-x:auto">
        <div class="cs-day-timeline">${hours.join('')}</div>
      </div>
    </div>`;
    res.send(renderPage('Day View', html, user));
  }));

  // ============================================================
  // ROUTE 4: GET /calendar/events/new — Create Event Form
  // ============================================================
  app.get('/calendar/events/new', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const users = (await pool.query(`SELECT email, full_name FROM users WHERE tenant_id=$1 AND email IS NOT NULL ORDER BY full_name`, [tid])).rows;
    const colorPicker = COLORS.map((c, i) => `<span class="cs-color-dot${i === 0 ? ' sel' : ''}" style="background:${c}" data-color="${c}" onclick="document.querySelectorAll('.cs-color-dot').forEach(d=>d.classList.remove('sel'));this.classList.add('sel');document.getElementById('evt-color').value='${c}'"></span>`).join('');
    const userOptions = users.map(u => `<option value="${esc(u.email)}">${esc(u.full_name || u.email)}</option>`).join('');

    const html = CS_CSS + `<div style="max-width:750px;margin:0 auto">
      ${nav('')}
      <a href="/calendar" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Calendar</a>
      <div class="card" style="padding:28px">
        <h2 style="margin:0 0 4px;color:#1e293b">📅 Create Event</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:24px">Add a new event to the calendar</p>
        <form method="POST" action="/calendar/events/save" class="cs-form" style="display:flex;flex-direction:column;gap:16px">
          <div><label>Title *</label><input type="text" name="title" required placeholder="Event title"></div>
          <div><label>Description</label><textarea name="description" rows="3" placeholder="Event details..." style="resize:vertical"></textarea></div>
          <div class="cs-form-row">
            <div><label>Start *</label><input type="datetime-local" name="start_time" required></div>
            <div><label>End *</label><input type="datetime-local" name="end_time" required></div>
          </div>
          <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" name="is_all_day" value="true"> All Day</label>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" name="reminder" value="true" checked> Reminder (15 min before)</label>
          </div>
          <div class="cs-form-row">
            <div><label>Location</label><input type="text" name="location" placeholder="Event location"></div>
            <div><label>Color</label>
              <div style="display:flex;gap:8px;padding:8px 0">${colorPicker}<input type="hidden" id="evt-color" name="color" value="#4f46e5"></div>
            </div>
          </div>
          <div class="cs-form-row-3">
            <div><label>Recurrence</label><select name="recurrence"><option value="none">None</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></div>
            <div><label>Recurrence End</label><input type="date" name="recurrence_end"></div>
            <div><label>Visibility</label><select name="visibility"><option value="team">Team</option><option value="public">Public</option><option value="private">Private</option></select></div>
          </div>
          <div><label>Attendees</label>
            <select name="attendees" multiple style="min-height:100px">${userOptions}</select>
            <span style="font-size:11px;color:#94a3b8">Hold Ctrl/Cmd to select multiple</span>
          </div>
          <div style="display:flex;gap:10px;margin-top:8px">
            <button type="submit" class="cs-btn cs-btn-primary" style="padding:12px 28px">💾 Save Event</button>
            <a href="/calendar" class="cs-btn cs-btn-secondary" style="padding:12px 28px">Cancel</a>
          </div>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Create Event', html, user));
  }));

  // ============================================================
  // ROUTE 5: POST /calendar/events/save — Save Event
  // ============================================================
  app.post('/calendar/events/save', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { title, description, start_time, end_time, is_all_day, color, location, recurrence, recurrence_end, visibility, reminder, attendees } = req.body;
    if (!title || !title.trim() || !start_time || !end_time) return res.redirect('/calendar/events/new');

    const result = await pool.query(
      `INSERT INTO calendar_events (tenant_id, title, description, start_time, end_time, is_all_day, color, location, recurrence, recurrence_end, visibility, attendee_emails, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [tid, title.trim(), (description || '').trim(), start_time, end_time, is_all_day === 'true', color || '#4f46e5', (location || '').trim() || null, recurrence || 'none', recurrence_end || null, visibility || 'team', attendees && Array.isArray(attendees) ? attendees : (attendees ? [attendees] : []), user.email]
    );
    const eventId = result.rows[0].id;

    // Insert attendees
    const attendeeList = attendees && Array.isArray(attendees) ? attendees : (attendees ? [attendees] : []);
    for (const email of attendeeList) {
      if (email && email.trim()) {
        await pool.query(`INSERT INTO event_attendees (tenant_id, event_id, user_email) VALUES ($1,$2,$3)`, [tid, eventId, email.trim()]);
        try { await notify(email.trim(), `Event: ${title.trim()}`, `You're invited to "${title.trim()}" on ${formatDateTime(start_time)}. RSVP: /calendar/events/${eventId}/rsvp`); } catch (e) { /* non-critical */ }
      }
    }

    // Create reminder
    if (reminder === 'true') {
      const reminderAt = new Date(new Date(start_time).getTime() - 15 * 60000);
      if (reminderAt > new Date()) {
        await pool.query(`INSERT INTO event_reminders (tenant_id, event_id, reminder_at, method) VALUES ($1,$2,$3,$4)`, [tid, eventId, reminderAt.toISOString(), 'both']);
      }
    }

    audit(user.email, 'event_created', `Event "${title.trim()}" created (ID: ${eventId})`);
    logger.info({ msg: '[CalendarScheduler] Event created', id: eventId, title: title.trim(), by: user.email });
    res.redirect('/calendar/events/' + eventId);
  }));

  // ============================================================
  // ROUTE 6: GET /calendar/events/:id — Event Detail
  // ============================================================
  app.get('/calendar/events/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, eid = req.params.id;
    const evt = (await pool.query(`SELECT * FROM calendar_events WHERE id=$1 AND tenant_id=$2`, [eid, tid])).rows[0];
    if (!evt) return res.send(renderPage('Not Found', '<div class="card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">Event not found</h2><a href="/calendar" class="cs-btn cs-btn-primary" style="margin-top:12px">← Calendar</a></div>', user));

    const attendees = (await pool.query(`SELECT * FROM event_attendees WHERE event_id=$1 AND tenant_id=$2 ORDER BY created_at`, [eid, tid])).rows;
    const reminders = (await pool.query(`SELECT * FROM event_reminders WHERE event_id=$1 AND tenant_id=$2 ORDER BY reminder_at`, [eid, tid])).rows;
    const isOrganizer = evt.created_by === user.email;
    const attendeeRows = attendees.map(a => `<tr>
      <td style="font-size:13px;font-weight:600;color:#1e293b">${esc(a.user_email)}</td>
      <td>${rsvpBadge(a.response)}</td>
      <td style="font-size:12px;color:#94a3b8">${esc(a.comment || '—')}</td>
      <td style="font-size:12px;color:#94a3b8">${a.responded_at ? formatDateTime(a.responded_at) : '—'}</td>
    </tr>`).join('');
    const reminderRows = reminders.map(r => `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px"><span style="color:#1e293b">${formatDateTime(r.reminder_at)}</span><span style="font-size:11px;padding:2px 8px;border-radius:12px;background:${r.sent ? '#dcfce7;color:#16a34a' : '#fef9c3;color:#a16207'}">${r.sent ? 'Sent' : 'Pending'}</span><span style="color:#94a3b8;font-size:12px">${r.method}</span></div>`).join('');

    const html = CS_CSS + `<div style="max-width:900px;margin:0 auto">
      ${nav('')}
      <a href="/calendar" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Calendar</a>
      <div class="card" style="padding:24px;margin-bottom:16px;border-top:4px solid ${evt.color || '#4f46e5'}">
        <div style="display:flex;justify-content:space-between;align-items:start;flex-wrap:wrap;gap:12px">
          <div>
            <h1 style="margin:0 0 8px;color:#1e293b;font-size:22px">${esc(evt.title)}</h1>
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
              <span style="font-size:13px;color:#475569">📅 ${evt.is_all_day ? formatDate(evt.start_time) + (evt.start_time.toISOString().slice(0,10) !== evt.end_time.toISOString().slice(0,10) ? ' – ' + formatDate(evt.end_time) : ' (All Day)') : formatDateTime(evt.start_time) + ' – ' + formatDateTime(evt.end_time)}</span>
              ${evt.location ? `<span style="font-size:13px;color:#475569">📍 ${esc(evt.location)}</span>` : ''}
            </div>
          </div>
          ${isOrganizer ? `<div style="display:flex;gap:6px">
            <a href="/calendar/events/${eid}/edit" class="cs-btn cs-btn-secondary" style="padding:6px 14px;font-size:12px">✏️ Edit</a>
            <form method="POST" action="/calendar/events/${eid}/delete" onsubmit="return confirm('Delete this event?')"><button class="cs-btn cs-btn-danger" style="padding:6px 14px;font-size:12px">🗑 Delete</button></form>
          </div>` : ''}
        </div>
        ${evt.description ? `<div style="margin-top:16px;padding:14px;background:#f8fafc;border-radius:10px;font-size:14px;color:#334155;white-space:pre-wrap">${esc(evt.description)}</div>` : ''}
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-top:16px;padding-top:16px;border-top:1px solid #e2e8f0">
          <div><span style="font-size:11px;color:#94a3b8;display:block">Organizer</span><span style="font-size:14px;font-weight:600;color:#1e293b">${esc(evt.created_by)}</span></div>
          <div><span style="font-size:11px;color:#94a3b8;display:block">Recurrence</span><span style="font-size:14px;font-weight:600;color:#1e293b">${recurLabel(evt.recurrence)}</span></div>
          <div><span style="font-size:11px;color:#94a3b8;display:block">Visibility</span><span style="font-size:14px;font-weight:600;color:#1e293b">${visLabel(evt.visibility)}</span></div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div class="card" style="padding:20px">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">👥 Attendees (${attendees.length})</h3>
          ${attendees.length ? `<div style="overflow-x:auto"><table class="cs-table"><thead><tr><th>Email</th><th>RSVP</th><th>Comment</th><th>Responded</th></tr></thead><tbody>${attendeeRows}</tbody></table></div>` : '<p style="color:#94a3b8;font-size:13px">No attendees</p>'}
        </div>
        <div class="card" style="padding:20px">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">🔔 Reminders (${reminders.length})</h3>
          ${reminderRows || '<p style="color:#94a3b8;font-size:13px">No reminders set</p>'}
        </div>
      </div>
    </div>`;
    res.send(renderPage(evt.title, html, user));
  }));

  // ============================================================
  // ROUTE 7: GET /calendar/events/:id/edit — Edit Event Form
  // ============================================================
  app.get('/calendar/events/:id/edit', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, eid = req.params.id;
    const evt = (await pool.query(`SELECT * FROM calendar_events WHERE id=$1 AND tenant_id=$2`, [eid, tid])).rows[0];
    if (!evt) return res.redirect('/calendar');
    const users = (await pool.query(`SELECT email, full_name FROM users WHERE tenant_id=$1 AND email IS NOT NULL ORDER BY full_name`, [tid])).rows;
    const existingAttendees = (await pool.query(`SELECT user_email FROM event_attendees WHERE event_id=$1 AND tenant_id=$2`, [eid, tid])).rows.map(r => r.user_email);

    const colorPicker = COLORS.map(c => `<span class="cs-color-dot${(evt.color || '#4f46e5') === c ? ' sel' : ''}" style="background:${c}" data-color="${c}" onclick="document.querySelectorAll('.cs-color-dot').forEach(d=>d.classList.remove('sel'));this.classList.add('sel');document.getElementById('evt-color').value='${c}'"></span>`).join('');
    const userOptions = users.map(u => `<option value="${esc(u.email)}" ${existingAttendees.includes(u.email) ? 'selected' : ''}>${esc(u.full_name || u.email)}</option>`).join('');
    const toLocal = d => d ? new Date(d).toISOString().slice(0, 16) : '';

    const html = CS_CSS + `<div style="max-width:750px;margin:0 auto">
      ${nav('')}
      <a href="/calendar/events/${eid}" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Event</a>
      <div class="card" style="padding:28px">
        <h2 style="margin:0 0 4px;color:#1e293b">✏️ Edit Event</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:24px">${esc(evt.title)}</p>
        <form method="POST" action="/calendar/events/${eid}/update" class="cs-form" style="display:flex;flex-direction:column;gap:16px">
          <div><label>Title *</label><input type="text" name="title" required value="${esc(evt.title)}"></div>
          <div><label>Description</label><textarea name="description" rows="3" style="resize:vertical">${esc(evt.description || '')}</textarea></div>
          <div class="cs-form-row">
            <div><label>Start *</label><input type="datetime-local" name="start_time" required value="${toLocal(evt.start_time)}"></div>
            <div><label>End *</label><input type="datetime-local" name="end_time" required value="${toLocal(evt.end_time)}"></div>
          </div>
          <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" name="is_all_day" value="true" ${evt.is_all_day ? 'checked' : ''}> All Day</label>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" name="reminder" value="true" checked> Reminder (15 min before)</label>
          </div>
          <div class="cs-form-row">
            <div><label>Location</label><input type="text" name="location" value="${esc(evt.location || '')}"></div>
            <div><label>Color</label><div style="display:flex;gap:8px;padding:8px 0">${colorPicker}<input type="hidden" id="evt-color" name="color" value="${evt.color || '#4f46e5'}"></div></div>
          </div>
          <div class="cs-form-row-3">
            <div><label>Recurrence</label><select name="recurrence">${['none','daily','weekly','monthly'].map(r => `<option value="${r}" ${evt.recurrence === r ? 'selected' : ''}>${recurLabel(r)}</option>`).join('')}</select></div>
            <div><label>Recurrence End</label><input type="date" name="recurrence_end" value="${evt.recurrence_end ? evt.recurrence_end.toISOString().slice(0, 10) : ''}"></div>
            <div><label>Visibility</label><select name="visibility">${['team','public','private'].map(v => `<option value="${v}" ${evt.visibility === v ? 'selected' : ''}>${visLabel(v)}</option>`).join('')}</select></div>
          </div>
          <div><label>Attendees</label><select name="attendees" multiple style="min-height:100px">${userOptions}</select><span style="font-size:11px;color:#94a3b8">Hold Ctrl/Cmd to select multiple</span></div>
          <div style="display:flex;gap:10px;margin-top:8px">
            <button type="submit" class="cs-btn cs-btn-primary" style="padding:12px 28px">💾 Update Event</button>
            <a href="/calendar/events/${eid}" class="cs-btn cs-btn-secondary" style="padding:12px 28px">Cancel</a>
          </div>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Edit Event', html, user));
  }));

  // ============================================================
  // ROUTE 8: POST /calendar/events/:id/update — Update Event
  // ============================================================
  app.post('/calendar/events/:id/update', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, eid = req.params.id;
    const evt = (await pool.query(`SELECT id FROM calendar_events WHERE id=$1 AND tenant_id=$2`, [eid, tid])).rows[0];
    if (!evt) return res.redirect('/calendar');
    const { title, description, start_time, end_time, is_all_day, color, location, recurrence, recurrence_end, visibility, reminder, attendees } = req.body;
    if (!title || !title.trim()) return res.redirect(`/calendar/events/${eid}/edit`);
    const attList = attendees && Array.isArray(attendees) ? attendees : (attendees ? [attendees] : []);

    await pool.query(
      `UPDATE calendar_events SET title=$1, description=$2, start_time=$3, end_time=$4, is_all_day=$5, color=$6, location=$7, recurrence=$8, recurrence_end=$9, visibility=$10, attendee_emails=$11, updated_at=NOW() WHERE id=$12 AND tenant_id=$13`,
      [title.trim(), (description || '').trim(), start_time, end_time, is_all_day === 'true', color || '#4f46e5', (location || '').trim() || null, recurrence || 'none', recurrence_end || null, visibility || 'team', attList, eid, tid]
    );
    // Sync attendees
    await pool.query(`DELETE FROM event_attendees WHERE event_id=$1 AND tenant_id=$2`, [eid, tid]);
    for (const email of attList) {
      if (email && email.trim()) {
        await pool.query(`INSERT INTO event_attendees (tenant_id, event_id, user_email) VALUES ($1,$2,$3)`, [tid, eid, email.trim()]);
        try { await notify(email.trim(), `Updated: ${title.trim()}`, `Event "${title.trim()}" was updated. View: /calendar/events/${eid}`); } catch (e) { /* non-critical */ }
      }
    }
    // Update reminders
    await pool.query(`DELETE FROM event_reminders WHERE event_id=$1 AND tenant_id=$2 AND sent=false`, [eid, tid]);
    if (reminder === 'true') {
      const reminderAt = new Date(new Date(start_time).getTime() - 15 * 60000);
      if (reminderAt > new Date()) await pool.query(`INSERT INTO event_reminders (tenant_id, event_id, reminder_at, method) VALUES ($1,$2,$3,$4)`, [tid, eid, reminderAt.toISOString(), 'both']);
    }
    audit(user.email, 'event_updated', `Event "${title.trim()}" updated (ID: ${eid})`);
    res.redirect('/calendar/events/' + eid);
  }));

  // ============================================================
  // ROUTE 9: POST /calendar/events/:id/delete — Delete Event
  // ============================================================
  app.post('/calendar/events/:id/delete', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, eid = req.params.id;
    const evt = (await pool.query(`SELECT title FROM calendar_events WHERE id=$1 AND tenant_id=$2`, [eid, tid])).rows[0];
    if (!evt) return res.redirect('/calendar');
    await pool.query(`DELETE FROM event_reminders WHERE event_id=$1 AND tenant_id=$2`, [eid, tid]);
    await pool.query(`DELETE FROM event_attendees WHERE event_id=$1 AND tenant_id=$2`, [eid, tid]);
    await pool.query(`DELETE FROM calendar_events WHERE id=$1 AND tenant_id=$2`, [eid, tid]);
    audit(user.email, 'event_deleted', `Event "${evt.title}" deleted (ID: ${eid})`);
    logger.info({ msg: '[CalendarScheduler] Event deleted', id: eid, title: evt.title, by: user.email });
    req.session.flash = { type: 'success', msg: `Event "${evt.title}" deleted successfully.` };
    res.redirect('/calendar');
  }));

  // ============================================================
  // ROUTE 10: GET /calendar/events/:id/rsvp — RSVP Page
  // ============================================================
  app.get('/calendar/events/:id/rsvp', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, eid = req.params.id;
    const evt = (await pool.query(`SELECT * FROM calendar_events WHERE id=$1 AND tenant_id=$2`, [eid, tid])).rows[0];
    if (!evt) return res.redirect('/calendar');
    const existing = (await pool.query(`SELECT * FROM event_attendees WHERE event_id=$1 AND user_email=$2`, [eid, user.email])).rows[0];

    const html = CS_CSS + `<div style="max-width:600px;margin:0 auto;text-align:center">
      <div style="margin-bottom:30px">
        <div style="width:64px;height:64px;border-radius:16px;background:${evt.color || '#4f46e5'};margin:0 auto 16px;display:flex;align-items:center;justify-content:center;font-size:28px;color:#fff">📅</div>
        <h1 style="font-size:24px;color:#1e293b;margin:0 0 8px">${esc(evt.title)}</h1>
        <p style="font-size:14px;color:#64748b">${formatDateTime(evt.start_time)}${evt.location ? ' · 📍 ' + esc(evt.location) : ''}</p>
        ${evt.description ? `<p style="font-size:13px;color:#94a3b8;margin-top:8px">${esc(evt.description)}</p>` : ''}
        ${existing ? `<div style="margin-top:12px">${rsvpBadge(existing.response)}</div>` : ''}
      </div>
      <div style="display:flex;gap:16px;justify-content:center;flex-wrap:wrap">
        <form method="POST" action="/calendar/events/${eid}/rsvp" style="display:inline">
          <input type="hidden" name="response" value="accepted">
          <button type="submit" class="cs-rsvp-btn" style="background:#dcfce7;border-color:#16a34a;color:#16a34a">✅<span>Accept</span></button>
        </form>
        <form method="POST" action="/calendar/events/${eid}/rsvp" style="display:inline">
          <input type="hidden" name="response" value="maybe">
          <button type="submit" class="cs-rsvp-btn" style="background:#fef9c3;border-color:#a16207;color:#a16207">🤔<span>Maybe</span></button>
        </form>
        <form method="POST" action="/calendar/events/${eid}/rsvp" style="display:inline">
          <input type="hidden" name="response" value="declined">
          <button type="submit" class="cs-rsvp-btn" style="background:#fee2e2;border-color:#dc2626;color:#dc2626">❌<span>Decline</span></button>
        </form>
      </div>
      <div style="margin-top:24px">
        <form method="POST" action="/calendar/events/${eid}/rsvp" style="max-width:400px;margin:0 auto">
          <label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px;text-align:left">Add a comment (optional)</label>
          <textarea name="comment" rows="2" placeholder="Leave a comment..." style="width:100%;padding:10px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px;resize:vertical;box-sizing:border-box"></textarea>
          <div style="display:flex;gap:8px;margin-top:10px">
            <input type="hidden" name="response" value="${existing ? existing.response : 'accepted'}">
            <button type="submit" class="cs-btn cs-btn-primary" style="padding:10px 24px">💾 Save Comment</button>
          </div>
        </form>
      </div>
      <a href="/calendar/events/${eid}" class="cs-btn cs-btn-secondary" style="margin-top:20px">← Back to Event</a>
    </div>`;
    res.send(renderPage('RSVP — ' + evt.title, html, user));
  }));

  // ============================================================
  // ROUTE 11: POST /calendar/events/:id/rsvp — Submit RSVP
  // ============================================================
  app.post('/calendar/events/:id/rsvp', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, eid = req.params.id;
    const evt = (await pool.query(`SELECT title, created_by FROM calendar_events WHERE id=$1 AND tenant_id=$2`, [eid, tid])).rows[0];
    if (!evt) return res.redirect('/calendar');
    const { response, comment } = req.body;
    const existing = (await pool.query(`SELECT id FROM event_attendees WHERE event_id=$1 AND user_email=$2`, [eid, user.email])).rows[0];

    if (existing) {
      await pool.query(`UPDATE event_attendees SET response=$1, comment=$2, responded_at=NOW() WHERE id=$3`, [response || 'pending', (comment || '').trim() || null, existing.id]);
    } else {
      await pool.query(`INSERT INTO event_attendees (tenant_id, event_id, user_email, response, comment, responded_at) VALUES ($1,$2,$3,$4,$5,NOW())`, [tid, eid, user.email, response || 'pending', (comment || '').trim() || null]);
    }
    audit(user.email, 'event_rsvp', `RSVP "${response}" for event "${evt.title}" (ID: ${eid})`);
    try { if (evt.created_by) await notify(evt.created_by, `RSVP: ${user.email}`, `${user.email} ${response} "${evt.title}"`); } catch (e) { /* non-critical */ }
    req.session.flash = { type: 'success', msg: `Your response "${response}" has been recorded.` };
    res.redirect(`/calendar/events/${eid}/rsvp`);
  }));

  // ============================================================
  // ROUTE 12: GET /calendar/upcoming — Upcoming Events List
  // ============================================================
  app.get('/calendar/upcoming', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const now = new Date();
    const future = new Date(now); future.setDate(future.getDate() + 30);
    const events = (await pool.query(`SELECT * FROM calendar_events WHERE tenant_id=$1 AND start_time >= $2 AND start_time <= $3 ORDER BY start_time ASC`, [tid, now.toISOString(), future.toISOString()])).rows;

    const listHtml = events.length ? events.map(e => `<div style="display:flex;gap:16px;align-items:start;padding:16px;border-bottom:1px solid #f1f5f9;transition:.15s;cursor:pointer" onclick="location.href='/calendar/events/${e.id}'" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='transparent'">
      <div style="width:4px;min-height:48px;border-radius:4px;background:${e.color || '#4f46e5'};flex-shrink:0"></div>
      <div style="flex:1;min-width:0">
        <div style="font-size:15px;font-weight:700;color:#1e293b;margin-bottom:4px">${esc(e.title)}</div>
        <div style="display:flex;gap:12px;flex-wrap:wrap;font-size:13px;color:#64748b">
          <span>📅 ${formatDateTime(e.start_time)}</span>
          ${e.location ? `<span>📍 ${esc(e.location)}</span>` : ''}
          ${e.recurrence && e.recurrence !== 'none' ? `<span>🔄 ${recurLabel(e.recurrence)}</span>` : ''}
        </div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-size:12px;color:#94a3b8">${e.is_all_day ? 'All Day' : formatTime(e.start_time)}</div>
        ${e.visibility ? `<div style="font-size:11px;color:#94a3b8;margin-top:2px">${visLabel(e.visibility)}</div>` : ''}
      </div>
    </div>`).join('') : '<div style="text-align:center;padding:48px;color:#94a3b8"><div style="font-size:48px;margin-bottom:12px">📭</div><p style="font-size:16px">No upcoming events in the next 30 days</p><a href="/calendar/events/new" class="cs-btn cs-btn-primary" style="margin-top:16px">+ Create Event</a></div>';

    const html = CS_CSS + `<div style="max-width:900px;margin:0 auto">
      ${nav('upcoming')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:22px;color:#1e293b">📋 Upcoming Events</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Next 30 days · ${events.length} events</p></div>
        <a href="/calendar/events/new" class="cs-btn cs-btn-primary">+ New Event</a>
      </div>
      <div class="card" style="padding:0;overflow:hidden">${listHtml}</div>
    </div>`;
    res.send(renderPage('Upcoming Events', html, user));
  }));

  // ============================================================
  // ROUTE 13: GET /calendar/api — JSON API
  // ============================================================
  app.get('/calendar/api', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const start = req.query.start || new Date().toISOString();
    const end = req.query.end || new Date(Date.now() + 30 * 86400000).toISOString();
    const events = (await pool.query(`SELECT id, title, description, start_time, end_time, is_all_day, color, location, recurrence, visibility, created_by FROM calendar_events WHERE tenant_id=$1 AND start_time >= $2 AND start_time <= $3 ORDER BY start_time ASC`, [tid, start, end])).rows;
    const results = await Promise.all(events.map(async e => {
      const attendees = (await pool.query(`SELECT user_email, response FROM event_attendees WHERE event_id=$1`, [e.id])).rows;
      return { id: e.id, title: e.title, description: e.description, start: e.start_time, end: e.end_time, allDay: e.is_all_day, color: e.color, location: e.location, recurrence: e.recurrence, visibility: e.visibility, organizer: e.created_by, attendees };
    }));
    res.json({ success: true, count: results.length, events: results });
  }));
};
