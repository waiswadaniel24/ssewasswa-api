// ============================================================
// EVENT MANAGER MODULE — Multi-Tenant SaaS Platform
// Event CRUD, RSVP management, calendar view, check-in,
// attendee export, analytics, publish/unpublish, JSON API.
// ============================================================
// Usage in server.js:
//   const eventManager = require('./event-manager');
//   eventManager(app, db, pool, renderPage, esc);
// ============================================================

'use strict';

// ============================================================
// MODULE ENTRY POINT
// ============================================================
module.exports = function eventManager(app, db, pool, renderPage, esc) {

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
  const fmtTime = (d) => d ? new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
  const today = () => new Date().toISOString().slice(0, 10);

  const TYPE_COLORS = {
    conference: { bg: '#dbeafe', c: '#1d4ed8' },
    workshop: { bg: '#dcfce7', c: '#16a34a' },
    social: { bg: '#fef9c3', c: '#a16207' },
    meeting: { bg: '#f3e8ff', c: '#7c3aed' },
    webinar: { bg: '#ffedd5', c: '#ea580c' },
    general: { bg: '#f1f5f9', c: '#475569' },
  };

  const RSVP_COLORS = {
    going: { bg: '#dcfce7', c: '#16a34a' },
    maybe: { bg: '#fef9c3', c: '#a16207' },
    declined: { bg: '#fee2e2', c: '#dc2626' },
    pending: { bg: '#f1f5f9', c: '#64748b' },
  };

  function typeBadge(type) {
    const t = TYPE_COLORS[type] || TYPE_COLORS.general;
    return `<span class="badge" style="display:inline-block;padding:3px 12px;border-radius:20px;font-size:11px;font-weight:700;background:${t.bg};color:${t.c}">${esc((type || 'general').charAt(0).toUpperCase() + (type || 'general').slice(1))}</span>`;
  }

  function rsvpBadge(status) {
    const r = RSVP_COLORS[status] || RSVP_COLORS.pending;
    return `<span class="badge ${status === 'going' ? 'badge-success' : status === 'maybe' ? 'badge-warning' : ''}" style="display:inline-block;padding:3px 12px;border-radius:20px;font-size:11px;font-weight:700;background:${r.bg};color:${r.c}">${esc((status || 'pending').charAt(0).toUpperCase() + (status || 'pending').slice(1))}</span>`;
  }

  // -- shared CSS --------------------------------------------------------
  const EV_CSS = `<style>
    .ev-nav{display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap}
    .ev-nav a{padding:8px 18px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#475569;background:#f1f5f9;transition:.15s}
    .ev-nav a:hover{background:#e2e8f0}.ev-nav a.active{background:#7c3aed;color:#fff}
    .ev-btn{display:inline-flex;align-items:center;gap:6px;padding:9px 18px;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:.15s}
    .ev-btn:hover{opacity:.9;transform:translateY(-1px)}
    .ev-btn-primary{background:#7c3aed;color:#fff}.ev-btn-success{background:#059669;color:#fff}
    .ev-btn-danger{background:#fee2e2;color:#dc2626}.ev-btn-secondary{background:#f1f5f9;color:#475569}
    .ev-btn-gold{background:#f59e0b;color:#fff}
    .ev-table{width:100%;border-collapse:collapse;font-size:13px}
    .ev-table th{padding:11px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#f8fafc}
    .ev-table td{padding:10px 14px;border-bottom:1px solid #f1f5f9;color:#1e293b}
    .ev-table tr:hover{background:#f8fafc}
    .ev-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px}
    .ev-card{background:#fff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;transition:.2s}
    .ev-card:hover{box-shadow:0 4px 16px rgba(0,0,0,.06);transform:translateY(-2px)}
    .ev-card-cover{height:8px;border-radius:14px 14px 0 0}
    .ev-card-body{padding:18px}
    .ev-cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:2px}
    .ev-cal-day{min-height:90px;background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:6px;font-size:11px;position:relative}
    .ev-cal-day-header{font-weight:700;color:#64748b;text-align:center;padding:8px;background:#f8fafc;border-radius:8px;font-size:12px}
    .ev-cal-today{border-color:#7c3aed;background:#faf5ff}
    .ev-cal-dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin:1px}
    .ev-checkin{display:flex;align-items:center;gap:14px;padding:16px;background:#f8fafc;border-radius:12px;margin-bottom:12px}
    .ev-checkin-code{font-size:28px;font-weight:800;color:#7c3aed;letter-spacing:4px}
    .ev-filter{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:end}
    .ev-filter label{display:block;font-size:12px;font-weight:600;color:#64748b;margin-bottom:4px}
    .ev-filter input,.ev-filter select{padding:8px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px;background:#fff}
    .ev-filter input:focus,.ev-filter select:focus{outline:none;border-color:#7c3aed}
    @media(max-width:768px){.ev-cards{grid-template-columns:1fr}.ev-cal-grid{grid-template-columns:repeat(7,1fr);gap:1px}.ev-cal-day{min-height:60px;padding:4px}}
  </style>`;

  // -- navigation helper --------------------------------------------------
  const nav = (active) => `<div class="ev-nav">
    <a href="/events" class="${active === 'list' ? 'active' : ''}">📅 Events</a>
    <a href="/events/calendar" class="${active === 'calendar' ? 'active' : ''}">📆 Calendar</a>
    <a href="/events/report" class="${active === 'report' ? 'active' : ''}">📊 Analytics</a>
    <a href="/events/new" class="ev-btn ev-btn-primary" style="font-size:12px;padding:8px 14px">+ New Event</a>
  </div>`;

  // ============================================================
  // DATABASE MIGRATIONS (async IIFE)
  // ============================================================
  (async () => {
    const c = await pool.connect().catch(() => null);
    if (!c) { console.error('[Events] Cannot connect to DB for migrations'); return; }
    try {
      await c.query(`CREATE TABLE IF NOT EXISTS events (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL, description TEXT, event_type VARCHAR(50) DEFAULT 'general',
        start_date TIMESTAMPTZ NOT NULL, end_date TIMESTAMPTZ, venue VARCHAR(255),
        address TEXT, max_attendees INTEGER, is_virtual BOOLEAN DEFAULT false,
        meeting_url TEXT, cover_image TEXT, organizer_name VARCHAR(255),
        registration_deadline TIMESTAMPTZ, is_published BOOLEAN DEFAULT false,
        is_free BOOLEAN DEFAULT true, price NUMERIC(10,2) DEFAULT 0,
        tags TEXT[], created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await c.query(`CREATE TABLE IF NOT EXISTS event_rsvps (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id), name VARCHAR(255), email VARCHAR(255),
        phone VARCHAR(20), status VARCHAR(20) DEFAULT 'pending',
        number_of_guests INTEGER DEFAULT 0, dietary_requirements TEXT,
        notes TEXT, checked_in BOOLEAN DEFAULT false,
        checked_in_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      // ALTER TABLE IF NOT EXISTS — events
      const evCols = [
        ['title','VARCHAR(255)'],['description','TEXT'],['event_type',"VARCHAR(50) DEFAULT 'general'"],
        ['start_date','TIMESTAMPTZ NOT NULL'],['end_date','TIMESTAMPTZ'],['venue','VARCHAR(255)'],
        ['address','TEXT'],['max_attendees','INTEGER'],['is_virtual','BOOLEAN DEFAULT false'],
        ['meeting_url','TEXT'],['cover_image','TEXT'],['organizer_name','VARCHAR(255)'],
        ['registration_deadline','TIMESTAMPTZ'],['is_published','BOOLEAN DEFAULT false'],
        ['is_free','BOOLEAN DEFAULT true'],['price','NUMERIC(10,2) DEFAULT 0'],
        ['tags','TEXT[]'],['created_by','INTEGER REFERENCES users(id)'],
        ['created_at','TIMESTAMPTZ DEFAULT NOW()'],['updated_at','TIMESTAMPTZ DEFAULT NOW()']
      ];
      for (const [col, def] of evCols) { try { await c.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS ${col} ${def}`); } catch(e){} }
      // ALTER TABLE IF NOT EXISTS — event_rsvps
      const rsvpCols = [
        ['user_id','INTEGER REFERENCES users(id)'],['name','VARCHAR(255)'],['email','VARCHAR(255)'],
        ['phone','VARCHAR(20)'],['status',"VARCHAR(20) DEFAULT 'pending'"],
        ['number_of_guests','INTEGER DEFAULT 0'],['dietary_requirements','TEXT'],
        ['notes','TEXT'],['checked_in','BOOLEAN DEFAULT false'],
        ['checked_in_at','TIMESTAMPTZ'],['created_at','TIMESTAMPTZ DEFAULT NOW()']
      ];
      for (const [col, def] of rsvpCols) { try { await c.query(`ALTER TABLE event_rsvps ADD COLUMN IF NOT EXISTS ${col} ${def}`); } catch(e){} }
      // Indexes
      await c.query(`CREATE INDEX IF NOT EXISTS idx_ev_tenant ON events(tenant_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_ev_start ON events(start_date)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_ev_type ON events(tenant_id, event_type)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_ev_published ON events(tenant_id, is_published)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_er_tenant ON event_rsvps(tenant_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_er_event ON event_rsvps(event_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_er_status ON event_rsvps(tenant_id, status)`);
      console.log('[Events] Migrations applied successfully');
    } catch (e) { console.error('[Events] Migration error:', e.message); }
    finally { c.release(); }
  })();

  // ============================================================
  // ROUTE 1: GET /events — Event listing
  // ============================================================
  app.get('/events', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const filter = req.query.filter || 'upcoming';
    const search = (req.query.search || '').trim();

    let where = ['tenant_id=$1'], params = [tid], pi = 2;
    if (filter === 'upcoming') { where.push(`start_date >= NOW()`); }
    else if (filter === 'past') { where.push(`start_date < NOW()`); }
    if (search) { where.push(`(title ILIKE $${pi} OR description ILIKE $${pi})`); params.push(`%${search}%`); pi++; }

    const events = (await pool.query(`SELECT * FROM events WHERE ${where.join(' AND ')} ORDER BY start_date ASC`, params)).rows;
    const totalEvents = (await pool.query(`SELECT COUNT(*)::int as cnt FROM events WHERE tenant_id=$1`, [tid])).rows[0].cnt;
    const upcomingCount = (await pool.query(`SELECT COUNT(*)::int as cnt FROM events WHERE tenant_id=$1 AND start_date >= NOW()`, [tid])).rows[0].cnt;
    const publishedCount = (await pool.query(`SELECT COUNT(*)::int as cnt FROM events WHERE tenant_id=$1 AND is_published=true`, [tid])).rows[0].cnt;
    const totalRsvps = (await pool.query(`SELECT COUNT(*)::int as cnt FROM event_rsvps er JOIN events e ON e.id=er.event_id WHERE e.tenant_id=$1`, [tid])).rows[0].cnt;

    const coverColors = ['#7c3aed','#2563eb','#059669','#ea580c','#dc2626','#0891b2','#4f46e5'];
    const rsvpCounts = {};
    for (const ev of events) {
      rsvpCounts[ev.id] = (await pool.query(`SELECT COUNT(*)::int as cnt FROM event_rsvps WHERE event_id=$1 AND status='going'`, [ev.id])).rows[0].cnt;
    }
    const cards = events.map((ev, i) => {
      const rsvpCount = rsvpCounts[ev.id] || 0;
      const color = coverColors[i % coverColors.length];
      return `<div class="ev-card">
        <div class="ev-card-cover" style="background:${color}"></div>
        <div class="ev-card-body">
          <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px">
            <h3 style="margin:0;font-size:16px;color:#1e293b;flex:1">${esc(ev.title)}</h3>
            ${ev.is_published ? '<span class="badge badge-success" style="font-size:10px">Published</span>' : '<span class="badge badge-warning" style="font-size:10px">Draft</span>'}
          </div>
          <div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap">${typeBadge(ev.event_type)}${ev.is_virtual ? '<span class="badge" style="background:#e0e7ff;color:#4338ca;font-size:11px">🌐 Virtual</span>' : ''}${!ev.is_free ? '<span class="badge" style="background:#fef9c3;color:#a16207;font-size:11px">💰 $' + Number(ev.price).toFixed(2) + '</span>' : '<span class="badge" style="background:#dcfce7;color:#16a34a;font-size:11px">Free</span>'}</div>
          <div style="font-size:12px;color:#64748b;margin-bottom:10px">
            <div>📅 ${fmtDateTime(ev.start_date)}${ev.end_date ? ' — ' + fmtTime(ev.end_date) : ''}</div>
            ${ev.venue ? '<div>📍 ' + esc(ev.venue) + '</div>' : ''}
            <div>👥 ${rsvpCount} going${ev.max_attendees ? ' / ' + ev.max_attendees + ' max' : ''}</div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <a href="/events/${ev.id}" class="btn btn-blue btn-sm">View</a>
            <a href="/events/${ev.id}/edit" class="btn btn-sm" style="background:#f1f5f9;color:#475569">Edit</a>
            <a href="/events/${ev.id}/attendees" class="btn btn-sm" style="background:#f1f5f9;color:#475569">Attendees</a>
            <form method="POST" action="/events/${ev.id}/publish" style="display:inline"><button type="submit" class="btn btn-sm ${ev.is_published ? 'btn-red' : 'btn-green'}">${ev.is_published ? 'Unpublish' : 'Publish'}</button></form>
          </div>
        </div>
      </div>`;
    });

    const html = EV_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('list')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">📅 Events</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Manage events and track RSVPs</p></div>
      </div>
      <div class="stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;margin-bottom:20px">
        <div class="stat-card"><div class="stat-num" style="color:#7c3aed">${totalEvents}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Total Events</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#16a34a">${upcomingCount}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Upcoming</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#2563eb">${publishedCount}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Published</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#ea580c">${totalRsvps}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Total RSVPs</div></div>
      </div>
      <div class="ev-filter">
        <div><label>Filter</label><select onchange="location.href='/events?filter='+this.value">
          <option value="upcoming" ${filter==='upcoming'?'selected':''}>Upcoming</option>
          <option value="past" ${filter==='past'?'selected':''}>Past</option>
          <option value="all" ${filter==='all'?'selected':''}>All</option>
        </select></div>
        <div><label>Search</label>
          <form method="GET" action="/events" style="display:flex;gap:6px">
            <input type="text" name="search" value="${esc(search)}" placeholder="Search events..." style="width:220px">
            <button type="submit" class="btn btn-blue btn-sm">Search</button>
          </form>
        </div>
      </div>
      ${events.length ? `<div class="ev-cards">${cards.join('')}</div>` : '<div class="card" style="text-align:center;padding:48px"><p style="font-size:18px;color:#64748b;margin-bottom:16px">No events found</p><a href="/events/new" class="btn btn-blue">Create Your First Event</a></div>'}
    </div>`;
    res.send(renderPage('Events', html, user, req));
  }));

  // ============================================================
  // ROUTE 2: GET /events/new — Create event form
  // ============================================================
  app.get('/events/new', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const html = EV_CSS + `<div style="max-width:750px;margin:0 auto">
      ${nav('list')}
      <a href="/events" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Events</a>
      <div class="card" style="padding:28px">
        <h2 style="margin:0 0 4px;color:#1e293b">🎉 Create New Event</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:24px">Fill in the event details below</p>
        <form method="POST" action="/events/create" style="display:flex;flex-direction:column;gap:16px">
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Event Title *</label>
            <input type="text" name="title" required placeholder="e.g., Annual Tech Conference 2025" style="width:100%;padding:11px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px"></div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Description</label>
            <textarea name="description" rows="3" placeholder="Describe your event..." style="width:100%;padding:11px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;resize:vertical"></textarea></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Event Type</label>
              <select name="event_type" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px">
                <option value="general">General</option><option value="conference">Conference</option><option value="workshop">Workshop</option>
                <option value="social">Social</option><option value="meeting">Meeting</option><option value="webinar">Webinar</option>
              </select></div>
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Organizer</label>
              <input type="text" name="organizer_name" placeholder="Organizer name" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Start Date & Time *</label>
              <input type="datetime-local" name="start_date" required style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">End Date & Time</label>
              <input type="datetime-local" name="end_date" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Venue</label>
              <input type="text" name="venue" placeholder="Venue name" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Max Attendees</label>
              <input type="number" name="max_attendees" placeholder="Leave blank for unlimited" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#475569;padding:12px;background:#f8fafc;border-radius:10px">
              <input type="checkbox" name="is_virtual" value="true" style="accent-color:#7c3aed"> Virtual Event</label>
            <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#475569;padding:12px;background:#f8fafc;border-radius:10px">
              <input type="checkbox" name="is_free" value="true" checked style="accent-color:#7c3aed"> Free Event</label>
          </div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Meeting URL (for virtual events)</label>
            <input type="url" name="meeting_url" placeholder="https://zoom.us/j/..." style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Registration Deadline</label>
              <input type="datetime-local" name="registration_deadline" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Price ($)</label>
              <input type="number" step="0.01" min="0" name="price" value="0" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
          </div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Tags (comma-separated)</label>
            <input type="text" name="tags" placeholder="tech, conference, networking" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
          <button type="submit" class="btn btn-blue" style="padding:14px 28px;font-size:15px">🚀 Create Event</button>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Create Event', html, user, req));
  }));

  // ============================================================
  // ROUTE 3: POST /events/create — Save event
  // ============================================================
  app.post('/events/create', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { title, description, event_type, organizer_name, start_date, end_date, venue, max_attendees,
      is_virtual, meeting_url, registration_deadline, is_free, price, tags, address } = req.body;
    if (!title || !title.trim() || !start_date) return res.redirect('/events/new');
    const tagArr = tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [];
    await pool.query(
      `INSERT INTO events (tenant_id,title,description,event_type,organizer_name,start_date,end_date,venue,max_attendees,is_virtual,meeting_url,registration_deadline,is_free,price,tags,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [tid, title.trim(), (description || '').trim(), event_type || 'general', (organizer_name || '').trim(),
       start_date, end_date || null, (venue || '').trim(), max_attendees ? parseInt(max_attendees) : null,
       is_virtual === 'true', (meeting_url || '').trim() || null, registration_deadline || null,
       is_free !== 'false', parseFloat(price) || 0, tagArr.length ? tagArr : null, user.id]
    );
    req.session.flash = { type: 'success', msg: 'Event created successfully!' };
    res.redirect('/events');
  }));

  // ============================================================
  // ROUTE 4: GET /events/:id — Event detail
  // ============================================================
  app.get('/events/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, id = req.params.id;
    const ev = (await pool.query(`SELECT * FROM events WHERE id=$1 AND tenant_id=$2`, [id, tid])).rows[0];
    if (!ev) return res.send(renderPage('Not Found', '<div class="card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">Event not found</h2><a href="/events" class="btn btn-blue btn-sm" style="margin-top:12px">← Events</a></div>', user, req));

    const rsvps = (await pool.query(`SELECT * FROM event_rsvps WHERE event_id=$1 ORDER BY created_at DESC`, [id])).rows;
    const goingCount = rsvps.filter(r => r.status === 'going').length;
    const maybeCount = rsvps.filter(r => r.status === 'maybe').length;
    const checkedInCount = rsvps.filter(r => r.checked_in).length;
    const myRsvp = rsvps.find(r => r.user_id === user.id);

    const attendeesHtml = rsvps.filter(r => r.status === 'going').slice(0, 10).map(r =>
      `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;font-size:13px">
        <div style="width:32px;height:32px;border-radius:50%;background:#e2e8f0;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#64748b">${esc((r.name || r.email || '?').charAt(0).toUpperCase())}</div>
        <div><strong style="color:#1e293b">${esc(r.name || 'Anonymous')}</strong>${r.checked_in ? ' <span class="badge badge-success" style="font-size:9px">Checked In</span>' : ''}</div>
      </div>`
    ).join('');

    const coverColors = ['#7c3aed','#2563eb','#059669','#ea580c','#dc2626'];
    const coverColor = coverColors[ev.id % coverColors.length];

    const html = EV_CSS + `<div style="max-width:1000px;margin:0 auto">
      ${nav('list')}
      <a href="/events" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Events</a>
      <div class="card" style="overflow:hidden;margin-bottom:20px">
        <div style="height:10px;background:${coverColor}"></div>
        <div style="padding:28px">
          <div style="display:flex;justify-content:space-between;align-items:start;flex-wrap:wrap;gap:12px;margin-bottom:16px">
            <div><h1 style="font-size:24px;color:#1e293b;margin:0 0 6px">${esc(ev.title)}</h1>
              <div style="display:flex;gap:6px;flex-wrap:wrap">${typeBadge(ev.event_type)}${ev.is_published ? '<span class="badge badge-success">Published</span>' : '<span class="badge badge-warning">Draft</span>'}${ev.is_virtual ? '<span class="badge" style="background:#e0e7ff;color:#4338ca">🌐 Virtual</span>' : ''}</div></div>
            <div style="display:flex;gap:6px">
              <a href="/events/${id}/edit" class="btn btn-sm" style="background:#f1f5f9;color:#475569">Edit</a>
              <form method="POST" action="/events/${id}" onsubmit="return confirm('Delete this event?')"><input type="hidden" name="_method" value="DELETE"><button class="btn btn-red btn-sm">Delete</button></form>
            </div>
          </div>
          ${ev.description ? `<p style="font-size:14px;color:#475569;line-height:1.7;margin-bottom:18px">${esc(ev.description)}</p>` : ''}
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin-bottom:20px">
            <div style="font-size:13px;color:#64748b"><strong style="color:#1e293b">📅</strong> ${fmtDateTime(ev.start_date)}${ev.end_date ? ' — ' + fmtTime(ev.end_date) : ''}</div>
            ${ev.venue ? `<div style="font-size:13px;color:#64748b"><strong style="color:#1e293b">📍</strong> ${esc(ev.venue)}</div>` : ''}
            ${ev.organizer_name ? `<div style="font-size:13px;color:#64748b"><strong style="color:#1e293b">👤</strong> ${esc(ev.organizer_name)}</div>` : ''}
            <div style="font-size:13px;color:#64748b"><strong style="color:#1e293b">💰</strong> ${ev.is_free ? 'Free' : '$' + Number(ev.price).toFixed(2)}</div>
            ${ev.max_attendees ? `<div style="font-size:13px;color:#64748b"><strong style="color:#1e293b">👥</strong> Capacity: ${ev.max_attendees}</div>` : ''}
            ${ev.meeting_url ? `<div style="font-size:13px"><strong style="color:#1e293b">🔗</strong> <a href="${esc(ev.meeting_url)}" target="_blank" style="color:#7c3aed">Join Meeting</a></div>` : ''}
          </div>
          ${ev.tags && ev.tags.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px">${ev.tags.map(t => `<span class="badge" style="background:#f1f5f9;color:#64748b">${esc(t)}</span>`).join('')}</div>` : ''}
          <div class="stats" style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px">
            <div class="stat-card"><div class="stat-num" style="color:#16a34a">${goingCount}</div><div class="muted" style="font-size:11px">Going</div></div>
            <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${maybeCount}</div><div class="muted" style="font-size:11px">Maybe</div></div>
            <div class="stat-card"><div class="stat-num" style="color:#7c3aed">${checkedInCount}</div><div class="muted" style="font-size:11px">Checked In</div></div>
            <div class="stat-card"><div class="stat-num" style="color:#2563eb">${rsvps.length}</div><div class="muted" style="font-size:11px">Total RSVPs</div></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
            <div class="card" style="padding:20px">
              <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">${myRsvp ? '✅ Your RSVP' : '📝 RSVP to this Event'}</h3>
              ${myRsvp ? `<p style="font-size:13px;color:#475569">You are ${rsvpBadge(myRsvp.status)}${myRsvp.number_of_guests ? ' with ' + myRsvp.number_of_guests + ' guest(s)' : ''}</p>
                <form method="POST" action="/events/${id}/rsvp" style="margin-top:12px;display:flex;gap:6px">
                  <button name="status" value="going" class="btn ${myRsvp.status==='going'?'btn-green':'btn-sm'}" style="background:${myRsvp.status==='going'?'':'#f1f5f9'};color:${myRsvp.status==='going'?'':'#475569'}">Going</button>
                  <button name="status" value="maybe" class="btn btn-sm" style="background:${myRsvp.status==='maybe'?'#fef9c3':'#f1f5f9'};color:${myRsvp.status==='maybe'?'#a16207':'#475569'}">Maybe</button>
                  <button name="status" value="declined" class="btn btn-sm" style="background:${myRsvp.status==='declined'?'#fee2e2':'#f1f5f9'};color:${myRsvp.status==='declined'?'#dc2626':'#475569'}">Declined</button>
                </form>` : `<form method="POST" action="/events/${id}/rsvp" style="display:flex;flex-direction:column;gap:10px">
                <div style="display:flex;gap:6px"><button name="status" value="going" class="btn btn-green btn-sm">Going</button><button name="status" value="maybe" class="btn btn-gold btn-sm">Maybe</button><button name="status" value="declined" class="btn btn-red btn-sm">Declined</button></div>
                <input type="number" name="number_of_guests" placeholder="Number of guests" value="0" min="0" style="padding:8px 12px;border:2px solid #e2e8f0;border-radius:8px;font-size:13px">
                <input type="text" name="dietary_requirements" placeholder="Dietary requirements" style="padding:8px 12px;border:2px solid #e2e8f0;border-radius:8px;font-size:13px">
                <textarea name="notes" rows="2" placeholder="Notes..." style="padding:8px 12px;border:2px solid #e2e8f0;border-radius:8px;font-size:13px;resize:vertical"></textarea>
                <button type="submit" class="btn btn-blue">Submit RSVP</button>
              </form>`}
            </div>
            <div class="card" style="padding:20px">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
                <h3 style="font-size:15px;color:#1e293b;margin:0">👥 Attendees (${goingCount})</h3>
                <a href="/events/${id}/attendees" class="btn btn-sm" style="background:#f1f5f9;color:#475569">View All</a>
              </div>
              ${attendeesHtml || '<p class="muted" style="font-size:13px;text-align:center;padding:20px">No attendees yet</p>'}
            </div>
          </div>
        </div>
      </div>
    </div>`;
    res.send(renderPage(ev.title, html, user, req));
  }));

  // ============================================================
  // ROUTE 5: GET /events/:id/edit — Edit event
  // ============================================================
  app.get('/events/:id/edit', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, id = req.params.id;
    const ev = (await pool.query(`SELECT * FROM events WHERE id=$1 AND tenant_id=$2`, [id, tid])).rows[0];
    if (!ev) return res.redirect('/events');
    const html = EV_CSS + `<div style="max-width:750px;margin:0 auto">
      ${nav('list')}
      <a href="/events/${id}" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Event</a>
      <div class="card" style="padding:28px">
        <h2 style="margin:0 0 4px;color:#1e293b">✏️ Edit Event</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:24px">Update event details for "${esc(ev.title)}"</p>
        <form method="POST" action="/events/${id}/update" style="display:flex;flex-direction:column;gap:16px">
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Event Title *</label>
            <input type="text" name="title" required value="${esc(ev.title)}" style="width:100%;padding:11px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px"></div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Description</label>
            <textarea name="description" rows="3" style="width:100%;padding:11px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;resize:vertical">${esc(ev.description || '')}</textarea></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Event Type</label>
              <select name="event_type" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px">
                ${['general','conference','workshop','social','meeting','webinar'].map(t => `<option value="${t}" ${ev.event_type===t?'selected':''}>${t.charAt(0).toUpperCase()+t.slice(1)}</option>`).join('')}
              </select></div>
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Organizer</label>
              <input type="text" name="organizer_name" value="${esc(ev.organizer_name||'')}" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Start Date & Time *</label>
              <input type="datetime-local" name="start_date" required value="${ev.start_date ? ev.start_date.toISOString().slice(0,16) : ''}" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">End Date & Time</label>
              <input type="datetime-local" name="end_date" value="${ev.end_date ? ev.end_date.toISOString().slice(0,16) : ''}" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Venue</label>
              <input type="text" name="venue" value="${esc(ev.venue||'')}" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Max Attendees</label>
              <input type="number" name="max_attendees" value="${ev.max_attendees||''}" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#475569;padding:12px;background:#f8fafc;border-radius:10px">
              <input type="checkbox" name="is_virtual" value="true" ${ev.is_virtual?'checked':''} style="accent-color:#7c3aed"> Virtual Event</label>
            <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#475569;padding:12px;background:#f8fafc;border-radius:10px">
              <input type="checkbox" name="is_free" value="true" ${ev.is_free?'checked':''} style="accent-color:#7c3aed"> Free Event</label>
          </div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Meeting URL</label>
            <input type="url" name="meeting_url" value="${esc(ev.meeting_url||'')}" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Price ($)</label>
              <input type="number" step="0.01" min="0" name="price" value="${Number(ev.price||0)}" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Tags (comma-separated)</label>
              <input type="text" name="tags" value="${esc(Array.isArray(ev.tags) ? ev.tags.join(', ') : '')}" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
          </div>
          <button type="submit" class="btn btn-blue" style="padding:14px 28px;font-size:15px">💾 Save Changes</button>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Edit Event', html, user, req));
  }));

  // ============================================================
  // ROUTE 6: POST /events/:id/update — Update event
  // ============================================================
  app.post('/events/:id/update', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, id = req.params.id;
    const ev = (await pool.query(`SELECT id FROM events WHERE id=$1 AND tenant_id=$2`, [id, tid])).rows[0];
    if (!ev) return res.redirect('/events');
    const { title, description, event_type, organizer_name, start_date, end_date, venue, max_attendees,
      is_virtual, meeting_url, is_free, price, tags } = req.body;
    if (!title || !title.trim() || !start_date) return res.redirect(`/events/${id}/edit`);
    const tagArr = tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [];
    await pool.query(
      `UPDATE events SET title=$1,description=$2,event_type=$3,organizer_name=$4,start_date=$5,end_date=$6,venue=$7,max_attendees=$8,is_virtual=$9,meeting_url=$10,is_free=$11,price=$12,tags=$13,updated_at=NOW() WHERE id=$14 AND tenant_id=$15`,
      [title.trim(), (description || '').trim(), event_type || 'general', (organizer_name || '').trim(),
       start_date, end_date || null, (venue || '').trim(), max_attendees ? parseInt(max_attendees) : null,
       is_virtual === 'true', (meeting_url || '').trim() || null, is_free !== 'false', parseFloat(price) || 0,
       tagArr.length ? tagArr : null, id, tid]
    );
    req.session.flash = { type: 'success', msg: 'Event updated!' };
    res.redirect(`/events/${id}`);
  }));

  // ============================================================
  // ROUTE 7: DELETE /events/:id — Delete event
  // ============================================================
  app.delete('/events/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id, id = req.params.id;
    await pool.query(`DELETE FROM event_rsvps WHERE event_id=$1`, [id]);
    await pool.query(`DELETE FROM events WHERE id=$1 AND tenant_id=$2`, [id, tid]);
    req.session.flash = { type: 'success', msg: 'Event deleted.' };
    res.redirect('/events');
  }));

  // ============================================================
  // ROUTE 8: POST /events/:id/rsvp — Submit/update RSVP
  // ============================================================
  app.post('/events/:id/rsvp', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, id = req.params.id;
    const ev = (await pool.query(`SELECT id,max_attendees FROM events WHERE id=$1 AND tenant_id=$2`, [id, tid])).rows[0];
    if (!ev) return res.redirect('/events');
    const { status, number_of_guests, dietary_requirements, notes } = req.body;

    const existing = (await pool.query(`SELECT id FROM event_rsvps WHERE event_id=$1 AND user_id=$2`, [id, user.id])).rows[0];
    if (existing) {
      await pool.query(`UPDATE event_rsvps SET status=$1,number_of_guests=$2,dietary_requirements=$3,notes=$4 WHERE id=$5`,
        [status || 'pending', parseInt(number_of_guests) || 0, (dietary_requirements || '').trim(), (notes || '').trim(), existing.id]);
    } else {
      // Check capacity
      if (ev.max_attendees) {
        const goingCnt = (await pool.query(`SELECT COUNT(*)::int as cnt FROM event_rsvps WHERE event_id=$1 AND status='going'`, [id])).rows[0].cnt;
        if (status === 'going' && goingCnt >= ev.max_attendees) {
          req.session.flash = { type: 'error', msg: 'This event has reached maximum capacity!' };
          return res.redirect(`/events/${id}`);
        }
      }
      await pool.query(
        `INSERT INTO event_rsvps (tenant_id,event_id,user_id,name,email,status,number_of_guests,dietary_requirements,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [tid, id, user.id, user.name || user.email, user.email, status || 'pending', parseInt(number_of_guests) || 0,
         (dietary_requirements || '').trim(), (notes || '').trim()]
      );
    }
    res.redirect(`/events/${id}`);
  }));

  // ============================================================
  // ROUTE 9: POST /events/:id/checkin — Check in attendee
  // ============================================================
  app.post('/events/:id/checkin', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, id = req.params.id;
    const ev = (await pool.query(`SELECT id FROM events WHERE id=$1 AND tenant_id=$2`, [id, tid])).rows[0];
    if (!ev) return res.json({ error: 'Event not found' });
    const { rsvp_id } = req.body;
    if (!rsvp_id) return res.json({ error: 'Missing rsvp_id' });
    const rsvp = (await pool.query(`SELECT id,checked_in FROM event_rsvps WHERE id=$1 AND event_id=$2 AND tenant_id=$3`, [rsvp_id, id, tid])).rows[0];
    if (!rsvp) return res.json({ error: 'RSVP not found' });
    if (rsvp.checked_in) return res.json({ success: true, message: 'Already checked in' });
    await pool.query(`UPDATE event_rsvps SET checked_in=true, checked_in_at=NOW() WHERE id=$1`, [rsvp_id]);
    res.json({ success: true, message: 'Checked in successfully' });
  }));

  // ============================================================
  // ROUTE 10: GET /events/:id/attendees — Attendee list
  // ============================================================
  app.get('/events/:id/attendees', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, id = req.params.id;
    const ev = (await pool.query(`SELECT * FROM events WHERE id=$1 AND tenant_id=$2`, [id, tid])).rows[0];
    if (!ev) return res.redirect('/events');
    const rsvps = (await pool.query(`SELECT * FROM event_rsvps WHERE event_id=$1 ORDER BY status, created_at DESC`, [id])).rows;
    const statusFilter = req.query.status || '';

    const filtered = statusFilter ? rsvps.filter(r => r.status === statusFilter) : rsvps;

    const rowsHtml = filtered.map((r, i) => `<tr>
      <td style="font-size:12px;color:#94a3b8">${i + 1}</td>
      <td><strong>${esc(r.name || 'User #' + (r.user_id || r.id))}</strong></td>
      <td>${esc(r.email || '—')}</td>
      <td>${esc(r.phone || '—')}</td>
      <td>${rsvpBadge(r.status)}</td>
      <td>${r.number_of_guests || 0}</td>
      <td>${r.checked_in ? '<span class="badge badge-success">✓</span>' : '<form method="POST" action="/events/' + id + '/checkin" style="display:inline"><input type="hidden" name="rsvp_id" value="' + r.id + '"><button class="btn btn-green btn-sm" style="padding:3px 10px;font-size:11px">Check In</button></form>'}</td>
      <td class="muted">${esc(r.dietary_requirements || '—')}</td>
      <td class="muted">${fmtDateTime(r.created_at)}</td>
    </tr>`).join('');

    // CSV export link
    const html = EV_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('list')}
      <a href="/events/${id}" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Event</a>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:22px;color:#1e293b">👥 Attendees — ${esc(ev.title)}</h1>
          <p style="font-size:13px;color:#94a3b8;margin-top:2px">${rsvps.length} total · ${rsvps.filter(r=>r.checked_in).length} checked in</p></div>
        <a href="/events/${id}/attendees/export" class="btn btn-blue btn-sm">📥 Export CSV</a>
      </div>
      <div class="ev-filter">
        <div><label>Status</label><select onchange="location.href='/events/${id}/attendees?status='+this.value">
          <option value="">All</option><option value="going" ${statusFilter==='going'?'selected':''}>Going</option>
          <option value="maybe" ${statusFilter==='maybe'?'selected':''}>Maybe</option>
          <option value="declined" ${statusFilter==='declined'?'selected':''}>Declined</option>
          <option value="pending" ${statusFilter==='pending'?'selected':''}>Pending</option>
        </select></div>
      </div>
      <div class="card"><div style="overflow-x:auto"><table class="ev-table">
        <thead><tr><th>#</th><th>Name</th><th>Email</th><th>Phone</th><th>Status</th><th>Guests</th><th>Check-In</th><th>Dietary</th><th>RSVP Date</th></tr></thead>
        <tbody>${rowsHtml || '<tr><td colspan="9" style="text-align:center;color:#94a3b8;padding:30px">No attendees yet</td></tr>'}</tbody>
      </table></div></div>
    </div>`;
    res.send(renderPage('Attendees — ' + ev.title, html, user, req));
  }));

  // Attendee CSV export (support route)
  app.get('/events/:id/attendees/export', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id, id = req.params.id;
    const rsvps = (await pool.query(`SELECT er.* FROM event_rsvps er JOIN events e ON e.id=er.event_id WHERE er.event_id=$1 AND e.tenant_id=$2 ORDER BY er.created_at`, [id, tid])).rows;
    const header = ['Name','Email','Phone','Status','Guests','Dietary','Notes','Checked In','RSVP Date'];
    let csv = header.map(h => '"' + h + '"').join(',') + '\n';
    rsvps.forEach(r => {
      csv += ['"' + (r.name || '').replace(/"/g, '""') + '"','"' + (r.email || '').replace(/"/g, '""') + '"',
        '"' + (r.phone || '').replace(/"/g, '""') + '"', r.status, r.number_of_guests || 0,
        '"' + (r.dietary_requirements || '').replace(/"/g, '""') + '"','"' + (r.notes || '').replace(/"/g, '""') + '"',
        r.checked_in ? 'Yes' : 'No', r.created_at].join(',') + '\n';
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="event-${id}-attendees.csv"`);
    res.send(csv);
  }));

  // ============================================================
  // ROUTE 11: GET /events/calendar — Calendar month view
  // ============================================================
  app.get('/events/calendar', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0);
    const startPad = firstDay.getDay();
    const daysInMonth = lastDay.getDate();
    const todayStr = today();

    const events = (await pool.query(
      `SELECT * FROM events WHERE tenant_id=$1 AND start_date >= $2 AND start_date < $3 ORDER BY start_date`,
      [tid, new Date(year, month - 1, 1).toISOString(), new Date(year, month, 1).toISOString()]
    )).rows;

    const dayEvents = {};
    events.forEach(ev => {
      const d = new Date(ev.start_date).getDate();
      if (!dayEvents[d]) dayEvents[d] = [];
      dayEvents[d].push(ev);
    });

    const dayHeaders = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    let calCells = dayHeaders.map(d => `<div class="ev-cal-day-header">${d}</div>`).join('');
    for (let i = 0; i < startPad; i++) calCells += '<div class="ev-cal-day" style="background:#f8fafc"></div>';
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const isToday = dateStr === todayStr;
      const dayEv = dayEvents[d] || [];
      const dots = dayEv.slice(0, 4).map(ev => {
        const tc = TYPE_COLORS[ev.event_type] || TYPE_COLORS.general;
        return `<div class="ev-cal-dot" style="background:${tc.c}" title="${esc(ev.title)}"></div>`;
      }).join('');
      const more = dayEv.length > 4 ? `<span style="font-size:9px;color:#94a3b8">+${dayEv.length - 4}</span>` : '';
      calCells += `<div class="ev-cal-day ${isToday ? 'ev-cal-today' : ''}">
        <div style="font-weight:${isToday?'800':'600'};color:${isToday?'#7c3aed':'#1e293b'};margin-bottom:4px">${d}</div>
        <div>${dots}${more}</div>
      </div>`;
    }
    const totalCells = startPad + daysInMonth;
    const trailing = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (let i = 0; i < trailing; i++) calCells += '<div class="ev-cal-day" style="background:#f8fafc"></div>';

    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    const monthName = new Date(year, month - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });

    const html = EV_CSS + `<div style="max-width:1100px;margin:0 auto">
      ${nav('calendar')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
        <a href="/events/calendar?year=${prevYear}&month=${prevMonth}" class="btn btn-sm" style="background:#f1f5f9;color:#475569">← Previous</a>
        <h1 style="font-size:22px;color:#1e293b;margin:0">📆 ${monthName}</h1>
        <a href="/events/calendar?year=${nextYear}&month=${nextMonth}" class="btn btn-sm" style="background:#f1f5f9;color:#475569">Next →</a>
      </div>
      <div class="ev-cal-grid">${calCells}</div>
      <div style="margin-top:16px;display:flex;gap:12px;flex-wrap:wrap;justify-content:center">
        ${Object.entries(TYPE_COLORS).filter(([k]) => k !== 'general').map(([type, c]) =>
          `<span style="display:flex;align-items:center;gap:4px;font-size:12px;color:#64748b"><span class="ev-cal-dot" style="background:${c.c}"></span>${type.charAt(0).toUpperCase()+type.slice(1)}</span>`
        ).join('')}
      </div>
    </div>`;
    res.send(renderPage('Event Calendar', html, user, req));
  }));

  // ============================================================
  // ROUTE 12: GET /events/report — Event analytics
  // ============================================================
  app.get('/events/report', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const allEvents = (await pool.query(`SELECT * FROM events WHERE tenant_id=$1`, [tid])).rows;
    const allRsvps = (await pool.query(`SELECT er.* FROM event_rsvps er JOIN events e ON e.id=er.event_id WHERE e.tenant_id=$1`, [tid])).rows;

    const totalEvents = allEvents.length;
    const totalRsvps = allRsvps.length;
    const goingCount = allRsvps.filter(r => r.status === 'going').length;
    const checkedInCount = allRsvps.filter(r => r.checked_in).length;
    const attendanceRate = totalRsvps > 0 ? Math.round(checkedInCount / totalRsvps * 100) : 0;
    const totalRevenue = allEvents.reduce((s, e) => s + (e.is_free ? 0 : Number(e.price || 0) * (allRsvps.filter(r => r.event_id === e.id && r.status === 'going').length)), 0);

    // Type distribution
    const typeCounts = {};
    allEvents.forEach(e => { const t = e.event_type || 'general'; typeCounts[t] = (typeCounts[t] || 0) + 1; });
    const typeHtml = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]).map(([type, cnt]) => {
      const tc = TYPE_COLORS[type] || TYPE_COLORS.general;
      const pct = Math.round(cnt / totalEvents * 100);
      return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        ${typeBadge(type)}<div style="flex:1;background:#f1f5f9;border-radius:6px;height:22px;overflow:hidden"><div style="height:100%;width:${pct}%;background:${tc.c};border-radius:6px;transition:.3s"></div></div>
        <span style="font-size:12px;font-weight:700;color:#1e293b;min-width:50px;text-align:right">${cnt} (${pct}%)</span>
      </div>`;
    }).join('');

    // RSVP status distribution
    const statusCounts = {};
    allRsvps.forEach(r => { statusCounts[r.status] = (statusCounts[r.status] || 0) + 1; });
    const statusHtml = Object.entries(statusCounts).sort((a, b) => b[1] - a[1]).map(([status, cnt]) => {
      const sc = RSVP_COLORS[status] || RSVP_COLORS.pending;
      const pct = totalRsvps > 0 ? Math.round(cnt / totalRsvps * 100) : 0;
      return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        ${rsvpBadge(status)}<div style="flex:1;background:#f1f5f9;border-radius:6px;height:22px;overflow:hidden"><div style="height:100%;width:${pct}%;background:${sc.c};border-radius:6px;transition:.3s"></div></div>
        <span style="font-size:12px;font-weight:700;color:#1e293b;min-width:50px;text-align:right">${cnt} (${pct}%)</span>
      </div>`;
    }).join('');

    // Top events by attendance
    const topEvents = allEvents.map(e => {
      const cnt = allRsvps.filter(r => r.event_id === e.id && r.status === 'going').length;
      return { ...e, goingCount: cnt };
    }).sort((a, b) => b.goingCount - a.goingCount).slice(0, 8);

    const topHtml = topEvents.map((e, i) => `<tr>
      <td style="font-size:12px;color:#94a3b8">${i + 1}</td>
      <td><a href="/events/${e.id}" style="color:#7c3aed;font-weight:600;text-decoration:none;font-size:13px">${esc(e.title)}</a></td>
      <td>${typeBadge(e.event_type)}</td>
      <td>${fmtDate(e.start_date)}</td>
      <td><strong style="color:#16a34a">${e.goingCount}</strong></td>
      <td class="muted">${e.is_free ? 'Free' : '$' + Number(e.price).toFixed(2)}</td>
    </tr>`).join('');

    const html = EV_CSS + `<div style="max-width:1100px;margin:0 auto">
      ${nav('report')}
      <h1 style="font-size:24px;color:#1e293b;margin-bottom:4px">📊 Event Analytics</h1>
      <p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Insights into your events, attendance, and engagement</p>
      <div class="stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;margin-bottom:24px">
        <div class="stat-card"><div class="stat-num" style="color:#7c3aed">${totalEvents}</div><div class="muted" style="font-size:11px">Total Events</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#2563eb">${totalRsvps}</div><div class="muted" style="font-size:11px">Total RSVPs</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#16a34a">${attendanceRate}%</div><div class="muted" style="font-size:11px">Check-In Rate</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#ea580c">$${totalRevenue.toFixed(2)}</div><div class="muted" style="font-size:11px">Est. Revenue</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${checkedInCount}</div><div class="muted" style="font-size:11px">Checked In</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#dc2626">${goingCount}</div><div class="muted" style="font-size:11px">Total Going</div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px">
        <div class="card" style="padding:20px">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">🎯 Event Types</h3>
          ${typeHtml || '<p class="muted" style="font-size:13px">No data</p>'}
        </div>
        <div class="card" style="padding:20px">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">📋 RSVP Distribution</h3>
          ${statusHtml || '<p class="muted" style="font-size:13px">No data</p>'}
        </div>
      </div>
      <div class="card" style="padding:20px">
        <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">🏆 Top Events by Attendance</h3>
        <div style="overflow-x:auto"><table class="ev-table">
          <thead><tr><th>#</th><th>Event</th><th>Type</th><th>Date</th><th>Going</th><th>Price</th></tr></thead>
          <tbody>${topHtml || '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:30px">No events</td></tr>'}</tbody>
        </table></div>
      </div>
    </div>`;
    res.send(renderPage('Event Analytics', html, user, req));
  }));

  // ============================================================
  // ROUTE 13: GET /api/events/upcoming — JSON API
  // ============================================================
  app.get('/api/events/upcoming', ah(async (req, res) => {
    const tid = req.query.tenant_id;
    const limit = parseInt(req.query.limit) || 10;
    const events = (await pool.query(
      `SELECT id,title,description,event_type,start_date,end_date,venue,is_virtual,meeting_url,is_published,is_free,price FROM events WHERE tenant_id=$1 AND start_date >= NOW() AND is_published=true ORDER BY start_date ASC LIMIT $2`,
      [tid, limit]
    )).rows;
    const enriched = await Promise.all(events.map(async (ev) => {
      const rsvpCounts = (await pool.query(`SELECT status, COUNT(*)::int as cnt FROM event_rsvps WHERE event_id=$1 GROUP BY status`, [ev.id])).rows;
      const counts = { going: 0, maybe: 0, declined: 0 };
      rsvpCounts.forEach(r => { counts[r.status] = r.cnt; });
      return { ...ev, rsvps: counts };
    }));
    res.json({ success: true, count: enriched.length, events: enriched });
  }));

  // ============================================================
  // ROUTE 14: POST /events/:id/publish — Publish/unpublish
  // ============================================================
  app.post('/events/:id/publish', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id, id = req.params.id;
    const ev = (await pool.query(`SELECT id,is_published FROM events WHERE id=$1 AND tenant_id=$2`, [id, tid])).rows[0];
    if (!ev) return res.redirect('/events');
    const newVal = !ev.is_published;
    await pool.query(`UPDATE events SET is_published=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3`, [newVal, id, tid]);
    req.session.flash = { type: 'success', msg: newVal ? 'Event published!' : 'Event unpublished.' };
    res.redirect('/events');
  }));

  // ============================================================
  console.log('[Events] Event management loaded');
};
