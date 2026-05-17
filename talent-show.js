/**
 * Talent Show Management Module
 * SaaS School Portal – Event creation, participant registration, scoring, voting, gallery & certificates
 * Routes prefix: /school/talent-show
 */
module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5', GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.btn:hover{background:#3730a3}.btn-sm{padding:5px 12px;font-size:13px}.btn-danger{background:#ef4444}.btn-danger:hover{background:#dc2626}.btn-success{background:#10b981}.btn-success:hover{background:#059669}.btn-outline{background:transparent;border:1px solid #d1d5db;color:#374151}.btn-outline:hover{background:#f3f4f6}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb;font-weight:600;color:#374151}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;font-size:14px}label{display:block;font-weight:600;margin-bottom:4px;font-size:14px;color:#374151}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}.stat-card{background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.1);text-align:center}.stat-card h3{font-size:28px;color:#4f46e5;margin:0}.stat-card p{color:#6b7280;margin-top:4px}.badge{display:inline-block;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:600}.badge-green{background:#d1fae5;color:#065f46}.badge-yellow{background:#fef3c7;color:#92400e}.badge-blue{background:#dbeafe;color:#1e40af}.badge-red{background:#fee2e2;color:#991b1b}.badge-purple{background:#ede9fe;color:#5b21b6}.tab-bar{display:flex;gap:0;margin-bottom:20px;border-bottom:2px solid #e5e7eb}.tab-bar a{padding:10px 18px;color:#6b7280;text-decoration:none;border-bottom:2px solid transparent;margin-bottom:-2px}.tab-bar a.active{color:#4f46e5;border-bottom-color:#4f46e5;font-weight:600}.progress-bar{height:8px;background:#e5e7eb;border-radius:4px;overflow:hidden}.progress-fill{height:100%;background:#4f46e5;border-radius:4px}.empty-state{text-align:center;padding:60px 20px;color:#9ca3af}.empty-state svg{width:64px;height:64px;margin-bottom:16px;opacity:.4}h2.page-title{font-size:24px;margin:0 0 20px;color:#111827}.flex-between{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}.star-rating{color:#f59e0b;font-size:20px}</style><div class="breadcrumb" style="margin-bottom:16px"><a href="/school" style="color:#4f46e5">School</a> &rsaquo; Talent Show</div>';

  /* ─── Migration ───────────────────────────────────────────────────────── */
  (async () => {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS talent_events (
          id SERIAL PRIMARY KEY,
          tenant_id INT NOT NULL,
          title VARCHAR(255) NOT NULL,
          description TEXT,
          date DATE NOT NULL,
          venue VARCHAR(255),
          max_participants INT DEFAULT 0,
          status VARCHAR(50) DEFAULT 'draft',
          categories JSONB DEFAULT '["music","dance","drama","comedy","art"]'::jsonb,
          rounds INT DEFAULT 1,
          max_score DECIMAL(5,2) DEFAULT 100.00,
          judge_ids INT[] DEFAULT '{}',
          registration_deadline DATE,
          created_by INT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT now(),
          updated_at TIMESTAMPTZ DEFAULT now()
        )`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS talent_registrations (
          id SERIAL PRIMARY KEY,
          tenant_id INT NOT NULL,
          event_id INT NOT NULL REFERENCES talent_events(id) ON DELETE CASCADE,
          student_id INT NOT NULL,
          category VARCHAR(100) NOT NULL,
          performance_title VARCHAR(255),
          description TEXT,
          status VARCHAR(50) DEFAULT 'pending',
          round INT DEFAULT 1,
          audition_time TIMESTAMPTZ,
          audition_venue VARCHAR(255),
          media_urls JSONB DEFAULT '[]'::jsonb,
          created_at TIMESTAMPTZ DEFAULT now()
        )`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS talent_scores (
          id SERIAL PRIMARY KEY,
          tenant_id INT NOT NULL,
          registration_id INT NOT NULL REFERENCES talent_registrations(id) ON DELETE CASCADE,
          judge_id INT NOT NULL,
          round INT DEFAULT 1,
          score DECIMAL(5,2) NOT NULL,
          comments TEXT,
          criteria_scores JSONB DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ DEFAULT now(),
          UNIQUE(registration_id, judge_id, round)
        )`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS talent_votes (
          id SERIAL PRIMARY KEY,
          tenant_id INT NOT NULL,
          registration_id INT NOT NULL REFERENCES talent_registrations(id) ON DELETE CASCADE,
          voter_id INT NOT NULL,
          score INT DEFAULT 5,
          created_at TIMESTAMPTZ DEFAULT now(),
          UNIQUE(registration_id, voter_id)
        )`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS talent_gallery (
          id SERIAL PRIMARY KEY,
          tenant_id INT NOT NULL,
          event_id INT REFERENCES talent_events(id) ON DELETE SET NULL,
          registration_id INT REFERENCES talent_registrations(id) ON DELETE SET NULL,
          title VARCHAR(255),
          media_type VARCHAR(20) DEFAULT 'photo',
          url TEXT NOT NULL,
          thumbnail_url TEXT,
          uploaded_by INT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT now()
        )`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS talent_certificates (
          id SERIAL PRIMARY KEY,
          tenant_id INT NOT NULL,
          event_id INT REFERENCES talent_events(id) ON DELETE CASCADE,
          registration_id INT REFERENCES talent_registrations(id) ON DELETE CASCADE,
          student_id INT NOT NULL,
          certificate_type VARCHAR(50) DEFAULT 'participation',
          rank VARCHAR(50),
          title VARCHAR(255),
          template_data JSONB DEFAULT '{}'::jsonb,
          generated_at TIMESTAMPTZ DEFAULT now()
        )`);
      console.log('[TalentShow] Tables ready');
    } catch(e) { console.warn('[TalentShow] Migration warning:', e.message); }
  })();

  const CATEGORIES = ['music','dance','drama','comedy','art','poetry','singing','instruments','band','magic','mime','fashion'];
  const STATUS_COLORS = {
    draft: 'badge-yellow', upcoming: 'badge-blue', registration_open: 'badge-green',
    audition_phase: 'badge-purple', judging: 'badge-purple', completed: 'badge-green', cancelled: 'badge-red'
  };
  const REG_STATUS_COLORS = {
    pending: 'badge-yellow', approved: 'badge-green', rejected: 'badge-red', shortlisted: 'badge-blue', winner: 'badge-green'
  };
  const CRITERIA = ['technique','creativity','stage_presence','entertainment','originality'];

  /* ─── Helper: event owner/organiser check ─────────────────────────────── */
  async function canManage(req, eventId) {
    const r = await pool.query(`SELECT created_by FROM talent_events WHERE id=$1 AND tenant_id=$2`, [eventId, req.user.tenant_id]);
    if (!r.rows.length) return false;
    if (req.user.role === 'admin' || req.user.role === 'superadmin') return true;
    return r.rows[0].created_by === req.user.id;
  }

  /* ─── Helper: is judge for event ──────────────────────────────────────── */
  async function isJudge(req, eventId) {
    const r = await pool.query(`SELECT judge_ids FROM talent_events WHERE id=$1 AND tenant_id=$2`, [eventId, req.user.tenant_id]);
    if (!r.rows.length) return false;
    const ids = r.rows[0].judge_ids || [];
    return ids.includes(req.user.id);
  }

  /* ─── 1. Dashboard ────────────────────────────────────────────────────── */
  app.get('/school/talent-show', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const [evts, regs, pending] = await Promise.all([
        pool.query(`SELECT COUNT(*) FROM talent_events WHERE tenant_id=$1`, [tid]),
        pool.query(`SELECT COUNT(*) FROM talent_registrations r JOIN talent_events e ON r.event_id=e.id WHERE e.tenant_id=$1`, [tid]),
        pool.query(`SELECT COUNT(*) FROM talent_registrations r JOIN talent_events e ON r.event_id=e.id WHERE e.tenant_id=$1 AND r.status='pending'`, [tid])
      ]);
      const upcomingEvts = await pool.query(
        `SELECT id, title, date, status, venue FROM talent_events WHERE tenant_id=$1 AND date >= CURRENT_DATE ORDER BY date LIMIT 5`, [tid]);
      const recentWinners = await pool.query(
        `SELECT c.rank, c.title, s.name as student_name, e.title as event_title
         FROM talent_certificates c
         LEFT JOIN users s ON c.student_id=s.id
         LEFT JOIN talent_events e ON c.event_id=e.id
         WHERE c.tenant_id=$1 AND c.rank IS NOT NULL
         ORDER BY c.generated_at DESC LIMIT 5`, [tid]);

      let html = `${SKIP}
        <h2 class="page-title">Talent Show Dashboard</h2>
        <div class="grid">
          <div class="stat-card"><h3>${evts.rows[0].count}</h3><p>Total Events</p></div>
          <div class="stat-card"><h3>${regs.rows[0].count}</h3><p>Registrations</p></div>
          <div class="stat-card"><h3>${pending.rows[0].count}</h3><p>Pending Approvals</p></div>
          <div class="stat-card"><h3>${upcomingEvts.rows.length}</h3><p>Upcoming Events</p></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:20px">
          <div class="card">
            <h3 style="margin:0 0 12px">Upcoming Events</h3>`;
      if (upcomingEvts.rows.length === 0) {
        html += `<p style="color:${GRAY}">No upcoming events</p>`;
      } else {
        upcomingEvts.rows.forEach(ev => {
          html += `<div style="padding:10px 0;border-bottom:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center">
            <div><strong>${esc(ev.title)}</strong><br><small style="color:${GRAY}">${ev.date.toLocaleDateString()} · ${esc(ev.venue || 'TBD')}</small></div>
            <span class="badge ${STATUS_COLORS[ev.status] || 'badge-yellow'}">${ev.status.replace(/_/g,' ')}</span>
          </div>`;
        });
      }
      html += `</div><div class="card"><h3 style="margin:0 0 12px">Recent Winners</h3>`;
      if (recentWinners.rows.length === 0) {
        html += `<p style="color:${GRAY}">No winners announced yet</p>`;
      } else {
        recentWinners.rows.forEach(w => {
          html += `<div style="padding:8px 0;border-bottom:1px solid #e5e7eb">
            <span class="badge ${w.rank === '1st' ? 'badge-yellow' : w.rank === '2nd' ? 'badge-blue' : 'badge-purple'}">${w.rank}</span>
            <strong>${esc(w.student_name || 'Unknown')}</strong> — ${esc(w.event_title || '')}<br>
            <small style="color:${GRAY}">${esc(w.title || '')}</small>
          </div>`;
        });
      }
      html += `</div></div>
        <div style="margin-top:16px">
          <a href="/school/talent-show/events" class="btn btn-success">Manage Events</a>
          <a href="/school/talent-show/gallery" class="btn btn-outline" style="margin-left:8px">Gallery</a>
          <a href="/school/talent-show/analytics" class="btn btn-outline" style="margin-left:8px">Analytics</a>
        </div>`;
      res.send(renderPage(req, html, 'Talent Show'));
    } catch(e) { res.status(500).send(ah(e, 'Dashboard load failed')); }
  });

  /* ─── 2. Events List ──────────────────────────────────────────────────── */
  app.get('/school/talent-show/events', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { search, status: sf } = req.query;
      let where = `WHERE e.tenant_id=$1`;
      const params = [req.user.tenant_id];
      let pi = 2;
      if (sf) { where += ` AND e.status=$${pi++}`; params.push(sf); }
      if (search) { where += ` AND (e.title ILIKE $${pi} OR e.venue ILIKE $${pi})`; params.push(`%${search}%`); pi++; }

      const events = await pool.query(
        `SELECT e.*, u.name as creator_name,
         (SELECT COUNT(*) FROM talent_registrations r WHERE r.event_id=e.id) as reg_count
         FROM talent_events e LEFT JOIN users u ON e.created_by=u.id
         ${where} ORDER BY e.created_at DESC`, params);

      let html = `${SKIP}
        <div class="flex-between">
          <h2 class="page-title">Events</h2>
          <a href="/school/talent-show/events/new" class="btn">+ New Event</a>
        </div>
        <form method="get" style="display:flex;gap:8px;margin-bottom:16px">
          <input type="text" name="search" placeholder="Search events..." value="${esc(search||'')}" style="max-width:300px">
          <select name="status" style="max-width:180px">
            <option value="">All Status</option>
            <option value="draft" ${sf==='draft'?'selected':''}>Draft</option>
            <option value="upcoming" ${sf==='upcoming'?'selected':''}>Upcoming</option>
            <option value="registration_open" ${sf==='registration_open'?'selected':''}>Registration Open</option>
            <option value="audition_phase" ${sf==='audition_phase'?'selected':''}>Audition Phase</option>
            <option value="judging" ${sf==='judging'?'selected':''}>Judging</option>
            <option value="completed" ${sf==='completed'?'selected':''}>Completed</option>
          </select>
          <button class="btn btn-sm">Filter</button>
        </form>`;

      if (events.rows.length === 0) {
        html += `<div class="empty-state"><p>No events found. Create your first talent show event!</p></div>`;
      } else {
        html += `<table><thead><tr><th>Title</th><th>Date</th><th>Venue</th><th>Categories</th><th>Registrations</th><th>Status</th><th>Actions</th></tr></thead><tbody>`;
        events.rows.forEach(ev => {
          const cats = Array.isArray(ev.categories) ? ev.categories : [];
          html += `<tr>
            <td><strong>${esc(ev.title)}</strong></td>
            <td>${ev.date.toLocaleDateString()}</td>
            <td>${esc(ev.venue||'—')}</td>
            <td>${cats.slice(0,3).map(c=>`<span class="badge badge-blue">${esc(c)}</span>`).join(' ')}${cats.length>3?` +${cats.length-3}`:''}</td>
            <td>${ev.reg_count}/${ev.max_participants||'∞'}</td>
            <td><span class="badge ${STATUS_COLORS[ev.status]||'badge-yellow'}">${ev.status.replace(/_/g,' ')}</span></td>
            <td>
              <a href="/school/talent-show/events/${ev.id}" class="btn btn-sm btn-outline">View</a>
              <a href="/school/talent-show/register/${ev.id}" class="btn btn-sm btn-outline">Register</a>
            </td>
          </tr>`;
        });
        html += `</tbody></table>`;
      }
      res.send(renderPage(req, html, 'Talent Events'));
    } catch(e) { res.status(500).send(ah(e, 'Events list failed')); }
  });

  /* ─── 3. New Event Form ───────────────────────────────────────────────── */
  app.get('/school/talent-show/events/new', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const staff = await pool.query(
        `SELECT id, name, role FROM users WHERE tenant_id=$1 AND role IN ('admin','teacher','staff') ORDER BY name`, [req.user.tenant_id]);
      let html = `${SKIP}
        <h2 class="page-title">Create Talent Event</h2>
        <div class="card" style="max-width:700px">
          <form method="post" action="/school/talent-show/events/new">
            <div style="margin-bottom:14px"><label>Event Title *</label>
              <input type="text" name="title" required placeholder="Annual Talent Show 2025"></div>
            <div style="margin-bottom:14px"><label>Description</label>
              <textarea name="description" rows="4" placeholder="Describe the event, theme, rules..."></textarea></div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">
              <div><label>Event Date *</label><input type="date" name="date" required></div>
              <div><label>Registration Deadline</label><input type="date" name="registration_deadline"></div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">
              <div><label>Venue *</label><input type="text" name="venue" required placeholder="School Auditorium"></div>
              <div><label>Max Participants (0=unlimited)</label><input type="number" name="max_participants" min="0" value="0"></div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">
              <div><label>Number of Rounds</label><input type="number" name="rounds" min="1" max="10" value="1"></div>
              <div><label>Max Score per Judge</label><input type="number" name="max_score" min="1" max="100" value="100"></div>
            </div>
            <div style="margin-bottom:14px"><label>Status</label>
              <select name="status">
                <option value="draft">Draft</option>
                <option value="upcoming">Upcoming</option>
                <option value="registration_open">Registration Open</option>
              </select></div>
            <div style="margin-bottom:14px"><label>Categories</label>
              <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:4px">`;
      CATEGORIES.forEach(c => {
        html += `<label style="display:inline-flex;align-items:center;gap:4px;font-weight:normal;cursor:pointer">
          <input type="checkbox" name="categories" value="${esc(c)}" ${['music','dance','drama','comedy','art'].includes(c)?'checked':''}> ${esc(c)}</label>`;
      });
      html += `</div></div>
            <div style="margin-bottom:14px"><label>Judge Panel</label>
              <select name="judge_ids" multiple style="height:120px">`;
      staff.rows.forEach(s => {
        html += `<option value="${s.id}">${esc(s.name)} (${esc(s.role)})</option>`;
      });
      html += `</select><small style="color:${GRAY}">Hold Ctrl/Cmd to select multiple</small></div>
            <div style="margin-top:20px;display:flex;gap:8px">
              <button type="submit" class="btn">Create Event</button>
              <a href="/school/talent-show/events" class="btn btn-outline">Cancel</a>
            </div>
          </form>
        </div>`;
      res.send(renderPage(req, html, 'Create Event'));
    } catch(e) { res.status(500).send(ah(e, 'New event form failed')); }
  });

  /* ─── 4. Create Event POST ────────────────────────────────────────────── */
  app.post('/school/talent-show/events/new', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { title, description, date, venue, max_participants, status, rounds, max_score, registration_deadline } = req.body;
      const categories = req.body.categories ? (Array.isArray(req.body.categories) ? req.body.categories : [req.body.categories]) : ['music','dance','drama','comedy','art'];
      const judge_ids = req.body.judge_ids ? (Array.isArray(req.body.judge_ids) ? req.body.judge_ids.map(Number) : [Number(req.body.judge_ids)]) : [];
      await pool.query(
        `INSERT INTO talent_events (tenant_id, title, description, date, venue, max_participants, status, categories, rounds, max_score, judge_ids, registration_deadline, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [req.user.tenant_id, title, description, date, venue, parseInt(max_participants)||0, status || 'draft', JSON.stringify(categories), parseInt(rounds)||1, parseFloat(max_score)||100, judge_ids, registration_deadline || null, req.user.id]);
      audit(req, 'talent_event_created', { title });
      req.flash('success', 'Event created successfully');
      res.redirect('/school/talent-show/events');
    } catch(e) { res.status(500).send(ah(e, 'Create event failed')); }
  });

  /* ─── 5. Event Detail ─────────────────────────────────────────────────── */
  app.get('/school/talent-show/events/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const eventId = parseInt(req.params.id);
      const ev = await pool.query(
        `SELECT e.*, u.name as creator_name FROM talent_events e LEFT JOIN users u ON e.created_by=u.id WHERE e.id=$1 AND e.tenant_id=$2`,
        [eventId, req.user.tenant_id]);
      if (!ev.rows.length) return res.status(404).send('Event not found');

      const event = ev.rows[0];
      const regs = await pool.query(
        `SELECT r.*, s.name as student_name FROM talent_registrations r LEFT JOIN users s ON r.student_id=s.id WHERE r.event_id=$1 AND r.tenant_id=$2 ORDER BY r.category, r.created_at`,
        [eventId, req.user.tenant_id]);
      const regByCat = {};
      regs.rows.forEach(r => { (regByCat[r.category] = regByCat[r.category] || []).push(r); });
      const canManageEv = await canManage(req, eventId);
      const isJudgeEv = await isJudge(req, eventId);

      let html = `${SKIP}
        <div class="flex-between">
          <h2 class="page-title">${esc(event.title)}</h2>
          <div>
            <span class="badge ${STATUS_COLORS[event.status]||'badge-yellow'}" style="font-size:14px;padding:6px 14px">${event.status.replace(/_/g,' ')}</span>
            ${canManageEv ? `<a href="/school/talent-show/events/${eventId}/edit" class="btn btn-sm btn-outline" style="margin-left:8px">Edit</a>` : ''}
          </div>
        </div>
        <div class="card">
          <p>${esc(event.description || 'No description')}</p>
          <p style="margin-top:8px"><strong>Date:</strong> ${event.date.toLocaleDateString()} &nbsp; <strong>Venue:</strong> ${esc(event.venue||'TBD')}
            &nbsp; <strong>Deadline:</strong> ${event.registration_deadline ? event.registration_deadline.toLocaleDateString() : 'N/A'}
            &nbsp; <strong>Rounds:</strong> ${event.rounds} &nbsp; <strong>Max Score:</strong> ${event.max_score}</p>
        </div>
        <div class="tab-bar">
          <a href="#registrations" class="active" onclick="showTab('registrations',this)">Registrations (${regs.rows.length})</a>
          <a href="#auditions" onclick="showTab('auditions',this)">Auditions</a>
          ${isJudgeEv || canManageEv ? `<a href="#scoring" onclick="showTab('scoring',this)">Scoring</a>` : ''}
          <a href="#results" onclick="showTab('results',this)">Results</a>
          <a href="/school/talent-show/gallery?event_id=${eventId}">Gallery</a>
          <a href="/school/talent-show/analytics?event_id=${eventId}">Analytics</a>
        </div>
        <div id="tab-registrations">
          <div class="flex-between">
            <h3>Registrations (${regs.rows.length}/${event.max_participants||'∞'})</h3>
            <a href="/school/talent-show/register/${eventId}" class="btn btn-sm">+ Register</a>
          </div>`;

      const cats = Array.isArray(event.categories) ? event.categories : [];
      cats.forEach(cat => {
        const catRegs = regByCat[cat] || [];
        if (catRegs.length === 0) return;
        html += `<div class="card"><h4 style="margin:0 0 10px;color:${P}">${esc(cat.charAt(0).toUpperCase()+cat.slice(1))}</h4>
          <table><thead><tr><th>Student</th><th>Performance</th><th>Status</th><th>Actions</th></tr></thead><tbody>`;
        catRegs.forEach(r => {
          html += `<tr><td>${esc(r.student_name||'Unknown')}</td><td>${esc(r.performance_title||'—')}</td>
            <td><span class="badge ${REG_STATUS_COLORS[r.status]||'badge-yellow'}">${r.status}</span></td>
            <td>`;
          if (canManageEv && r.status === 'pending') {
            html += `<form method="post" action="/school/talent-show/registrations/${r.id}/approve" style="display:inline">
              <button class="btn btn-sm btn-success">Approve</button></form>
              <form method="post" action="/school/talent-show/registrations/${r.id}/reject" style="display:inline">
                <button class="btn btn-sm btn-danger">Reject</button></form>`;
          }
          html += `</td></tr>`;
        });
        html += `</tbody></table></div>`;
      });

      if (regs.rows.length === 0) {
        html += `<div class="empty-state"><p>No registrations yet. Share this event with students!</p></div>`;
      }

      html += `</div>
        <div id="tab-auditions" style="display:none">
          <h3 style="margin-bottom:12px">Audition Schedule</h3>`;
      if (canManageEv) {
        html += `<div class="card" style="max-width:500px">
          <form method="post" action="/school/talent-show/events/${eventId}/schedule-auditions">
            <p><label>Set Audition Date & Time</label><input type="datetime-local" name="audition_datetime" required></p>
            <p><label>Audition Venue</label><input type="text" name="audition_venue" value="${esc(event.venue||'')}"></p>
            <button class="btn btn-sm" type="submit">Schedule All Approved</button>
          </form>
        </div>`;
      }
      const auditionRegs = regs.rows.filter(r => r.audition_time);
      if (auditionRegs.length) {
        html += `<table><thead><tr><th>Student</th><th>Category</th><th>Time</th><th>Venue</th></tr></thead><tbody>`;
        auditionRegs.forEach(r => {
          html += `<tr><td>${esc(r.student_name||'')}</td><td>${esc(r.category)}</td>
            <td>${r.audition_time ? new Date(r.audition_time).toLocaleString() : '—'}</td>
            <td>${esc(r.audition_venue||'—')}</td></tr>`;
        });
        html += `</tbody></table>`;
      } else {
        html += `<p style="color:${GRAY}">No auditions scheduled yet.</p>`;
      }
      html += `</div>`;

      if (isJudgeEv || canManageEv) {
        html += `<div id="tab-scoring" style="display:none">
          <h3 style="margin-bottom:12px">Judge Scoring Panel</h3>
          <a href="/school/talent-show/scoring/${eventId}" class="btn">Open Scoring Panel</a>
        </div>`;
      }

      html += `<div id="tab-results" style="display:none">
          <h3 style="margin-bottom:12px">Event Results</h3>
          <a href="/school/talent-show/results/${eventId}" class="btn">View Results</a>
        </div>

        <script>
        function showTab(name, el) {
          document.querySelectorAll('[id^="tab-"]').forEach(t => t.style.display = 'none');
          document.getElementById('tab-' + name).style.display = 'block';
          document.querySelectorAll('.tab-bar a').forEach(a => a.classList.remove('active'));
          if (el) el.classList.add('active');
        }
        </script>`;
      res.send(renderPage(req, html, event.title));
    } catch(e) { res.status(500).send(ah(e, 'Event detail failed')); }
  });

  /* ─── 6. Edit Event Form ──────────────────────────────────────────────── */
  app.get('/school/talent-show/events/:id/edit', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const eventId = parseInt(req.params.id);
      if (!(await canManage(req, eventId))) return res.status(403).send('Access denied');
      const ev = await pool.query(`SELECT * FROM talent_events WHERE id=$1 AND tenant_id=$2`, [eventId, req.user.tenant_id]);
      if (!ev.rows.length) return res.status(404).send('Event not found');
      const event = ev.rows[0];
      const staff = await pool.query(`SELECT id, name, role FROM users WHERE tenant_id=$1 AND role IN ('admin','teacher','staff') ORDER BY name`, [req.user.tenant_id]);
      const selCats = Array.isArray(event.categories) ? event.categories : [];
      const selJudges = Array.isArray(event.judge_ids) ? event.judge_ids : [];

      let html = `${SKIP}
        <h2 class="page-title">Edit Event: ${esc(event.title)}</h2>
        <div class="card" style="max-width:700px">
          <form method="post" action="/school/talent-show/events/${eventId}/edit">
            <div style="margin-bottom:14px"><label>Title *</label><input type="text" name="title" value="${esc(event.title)}" required></div>
            <div style="margin-bottom:14px"><label>Description</label><textarea name="description" rows="4">${esc(event.description||'')}</textarea></div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">
              <div><label>Event Date *</label><input type="date" name="date" value="${event.date.toISOString().slice(0,10)}" required></div>
              <div><label>Registration Deadline</label><input type="date" name="registration_deadline" value="${event.registration_deadline ? event.registration_deadline.toISOString().slice(0,10) : ''}"></div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">
              <div><label>Venue</label><input type="text" name="venue" value="${esc(event.venue||'')}"></div>
              <div><label>Max Participants</label><input type="number" name="max_participants" value="${event.max_participants}" min="0"></div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">
              <div><label>Rounds</label><input type="number" name="rounds" value="${event.rounds}" min="1" max="10"></div>
              <div><label>Max Score</label><input type="number" name="max_score" value="${event.max_score}" min="1" max="100"></div>
            </div>
            <div style="margin-bottom:14px"><label>Status</label><select name="status">`;
      ['draft','upcoming','registration_open','audition_phase','judging','completed','cancelled'].forEach(s => {
        html += `<option value="${s}" ${event.status===s?'selected':''}>${s.replace(/_/g,' ')}</option>`;
      });
      html += `</select></div>
            <div style="margin-bottom:14px"><label>Categories</label><div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:4px">`;
      CATEGORIES.forEach(c => {
        html += `<label style="display:inline-flex;align-items:center;gap:4px;font-weight:normal"><input type="checkbox" name="categories" value="${esc(c)}" ${selCats.includes(c)?'checked':''}> ${esc(c)}</label>`;
      });
      html += `</div></div>
            <div style="margin-bottom:14px"><label>Judge Panel</label><select name="judge_ids" multiple style="height:120px">`;
      staff.rows.forEach(s => {
        html += `<option value="${s.id}" ${selJudges.includes(s.id)?'selected':''}>${esc(s.name)} (${esc(s.role)})</option>`;
      });
      html += `</select></div>
            <div style="margin-top:20px;display:flex;gap:8px">
              <button type="submit" class="btn">Save Changes</button>
              <a href="/school/talent-show/events/${eventId}" class="btn btn-outline">Cancel</a>
            </div>
          </form>
        </div>`;
      res.send(renderPage(req, html, 'Edit Event'));
    } catch(e) { res.status(500).send(ah(e, 'Edit event form failed')); }
  });

  /* ─── 7. Edit Event POST ──────────────────────────────────────────────── */
  app.post('/school/talent-show/events/:id/edit', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const eventId = parseInt(req.params.id);
      if (!(await canManage(req, eventId))) return res.status(403).send('Access denied');
      const { title, description, date, venue, max_participants, status, rounds, max_score, registration_deadline } = req.body;
      const categories = req.body.categories ? (Array.isArray(req.body.categories) ? req.body.categories : [req.body.categories]) : [];
      const judge_ids = req.body.judge_ids ? (Array.isArray(req.body.judge_ids) ? req.body.judge_ids.map(Number) : [Number(req.body.judge_ids)]) : [];
      await pool.query(
        `UPDATE talent_events SET title=$1, description=$2, date=$3, venue=$4, max_participants=$5, status=$6, categories=$7, rounds=$8, max_score=$9, judge_ids=$10, registration_deadline=$11, updated_at=now()
         WHERE id=$12 AND tenant_id=$13`,
        [title, description, date, venue, parseInt(max_participants)||0, status, JSON.stringify(categories), parseInt(rounds)||1, parseFloat(max_score)||100, judge_ids, registration_deadline||null, eventId, req.user.tenant_id]);
      audit(req, 'talent_event_updated', { event_id: eventId, title });
      req.flash('success', 'Event updated');
      res.redirect(`/school/talent-show/events/${eventId}`);
    } catch(e) { res.status(500).send(ah(e, 'Edit event failed')); }
  });

  /* ─── 8. Delete Event ─────────────────────────────────────────────────── */
  app.post('/school/talent-show/events/:id/delete', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const eventId = parseInt(req.params.id);
      if (!(await canManage(req, eventId))) return res.status(403).send('Access denied');
      await pool.query(`DELETE FROM talent_events WHERE id=$1 AND tenant_id=$2`, [eventId, req.user.tenant_id]);
      audit(req, 'talent_event_deleted', { event_id: eventId });
      req.flash('success', 'Event deleted');
      res.redirect('/school/talent-show/events');
    } catch(e) { res.status(500).send(ah(e, 'Delete event failed')); }
  });

  /* ─── 9. Schedule Auditions POST ──────────────────────────────────────── */
  app.post('/school/talent-show/events/:id/schedule-auditions', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const eventId = parseInt(req.params.id);
      if (!(await canManage(req, eventId))) return res.status(403).send('Access denied');
      const { audition_datetime, audition_venue } = req.body;
      const baseTime = new Date(audition_datetime);
      const approved = await pool.query(
        `SELECT id FROM talent_registrations WHERE event_id=$1 AND tenant_id=$2 AND status='approved' AND audition_time IS NULL ORDER BY id`,
        [eventId, req.user.tenant_id]);
      const INTERVAL_MS = 15 * 60 * 1000; // 15 min slots
      for (let i = 0; i < approved.rows.length; i++) {
        const slotTime = new Date(baseTime.getTime() + i * INTERVAL_MS);
        await pool.query(
          `UPDATE talent_registrations SET audition_time=$1, audition_venue=$2 WHERE id=$3`,
          [slotTime, audition_venue, approved.rows[i].id]);
      }
      audit(req, 'talent_auditions_scheduled', { event_id: eventId, count: approved.rows.length });
      req.flash('success', `Scheduled ${approved.rows.length} auditions`);
      res.redirect(`/school/talent-show/events/${eventId}`);
    } catch(e) { res.status(500).send(ah(e, 'Schedule auditions failed')); }
  });

  /* ─── 10. Registration Form ───────────────────────────────────────────── */
  app.get('/school/talent-show/register/:event_id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const eventId = parseInt(req.params.event_id);
      const ev = await pool.query(`SELECT * FROM talent_events WHERE id=$1 AND tenant_id=$2`, [eventId, req.user.tenant_id]);
      if (!ev.rows.length) return res.status(404).send('Event not found');
      const event = ev.rows[0];

      // Check if already registered
      const existing = await pool.query(
        `SELECT id FROM talent_registrations WHERE event_id=$1 AND student_id=$2 AND tenant_id=$3`,
        [eventId, req.user.id, req.user.tenant_id]);
      const isRegistered = existing.rows.length > 0;

      const cats = Array.isArray(event.categories) ? event.categories : [];
      const regCount = await pool.query(
        `SELECT COUNT(*) FROM talent_registrations WHERE event_id=$1 AND tenant_id=$2`, [eventId, req.user.tenant_id]);
      const isFull = event.max_participants > 0 && parseInt(regCount.rows[0].count) >= event.max_participants;

      let html = `${SKIP}
        <h2 class="page-title">Register: ${esc(event.title)}</h2>`;
      if (isRegistered) {
        html += `<div class="card"><p style="color:#059669;font-weight:600">You have already registered for this event.</p>
          <a href="/school/talent-show/events/${eventId}" class="btn btn-outline" style="margin-top:12px">Back to Event</a></div>`;
      } else if (isFull) {
        html += `<div class="card"><p style="color:#dc2626;font-weight:600">Registration is full. Max participants reached.</p></div>`;
      } else if (event.registration_deadline && new Date() > new Date(event.registration_deadline)) {
        html += `<div class="card"><p style="color:#dc2626;font-weight:600">Registration deadline has passed.</p></div>`;
      } else {
        html += `<div class="card" style="max-width:600px">
          <form method="post" action="/school/talent-show/register/${eventId}">
            <div style="margin-bottom:14px"><label>Category *</label>
              <select name="category" required>`;
        cats.forEach(c => { html += `<option value="${esc(c)}">${esc(c.charAt(0).toUpperCase()+c.slice(1))}</option>`; });
        html += `</select></div>
            <div style="margin-bottom:14px"><label>Performance Title *</label>
              <input type="text" name="performance_title" required placeholder="Name of your performance"></div>
            <div style="margin-bottom:14px"><label>Description</label>
              <textarea name="description" rows="3" placeholder="Briefly describe your act, props needed, duration..."></textarea></div>
            <div style="margin-bottom:14px"><label>Media Links (optional)</label>
              <input type="text" name="media_urls" placeholder="YouTube, SoundCloud, or image URLs (comma-separated)"></div>
            <div style="margin-top:20px;display:flex;gap:8px">
              <button type="submit" class="btn">Submit Registration</button>
              <a href="/school/talent-show/events/${eventId}" class="btn btn-outline">Cancel</a>
            </div>
          </form>
        </div>`;
      }
      res.send(renderPage(req, html, 'Register'));
    } catch(e) { res.status(500).send(ah(e, 'Registration form failed')); }
  });

  /* ─── 11. Registration POST ───────────────────────────────────────────── */
  app.post('/school/talent-show/register/:event_id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const eventId = parseInt(req.params.event_id);
      const { category, performance_title, description, media_urls } = req.body;
      const existing = await pool.query(
        `SELECT id FROM talent_registrations WHERE event_id=$1 AND student_id=$2 AND tenant_id=$3`,
        [eventId, req.user.id, req.user.tenant_id]);
      if (existing.rows.length) { req.flash('error', 'Already registered'); return res.redirect(`/school/talent-show/register/${eventId}`); }

      const urls = media_urls ? media_urls.split(',').map(u => u.trim()).filter(Boolean) : [];
      await pool.query(
        `INSERT INTO talent_registrations (tenant_id, event_id, student_id, category, performance_title, description, media_urls, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'pending')`,
        [req.user.tenant_id, eventId, req.user.id, category, performance_title, description, JSON.stringify(urls)]);
      audit(req, 'talent_registration', { event_id: eventId, category });
      req.flash('success', 'Registration submitted! Awaiting approval.');
      res.redirect(`/school/talent-show/events/${eventId}`);
    } catch(e) { res.status(500).send(ah(e, 'Registration failed')); }
  });

  /* ─── 12. Approve/Reject Registration ─────────────────────────────────── */
  app.post('/school/talent-show/registrations/:id/approve', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const regId = parseInt(req.params.id);
      const reg = await pool.query(`SELECT event_id, tenant_id, student_id FROM talent_registrations WHERE id=$1`, [regId]);
      if (!reg.rows.length) return res.status(404).send('Not found');
      if (!(await canManage(req, reg.rows[0].event_id))) return res.status(403).send('Access denied');
      await pool.query(`UPDATE talent_registrations SET status='approved' WHERE id=$1`, [regId]);
      // Notify student
      const student = await pool.query(`SELECT email, name FROM users WHERE id=$1`, [reg.rows[0].student_id]);
      if (student.rows.length && student.rows[0].email) {
        queueEmail({ to: student.rows[0].email, subject: 'Talent Show Registration Approved', body: `Your registration has been approved!` });
      }
      audit(req, 'talent_reg_approved', { registration_id: regId });
      req.flash('success', 'Registration approved');
      res.redirect('back');
    } catch(e) { res.status(500).send(ah(e, 'Approve failed')); }
  });

  app.post('/school/talent-show/registrations/:id/reject', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const regId = parseInt(req.params.id);
      const reg = await pool.query(`SELECT event_id, tenant_id, student_id FROM talent_registrations WHERE id=$1`, [regId]);
      if (!reg.rows.length) return res.status(404).send('Not found');
      if (!(await canManage(req, reg.rows[0].event_id))) return res.status(403).send('Access denied');
      await pool.query(`UPDATE talent_registrations SET status='rejected' WHERE id=$1`, [regId]);
      audit(req, 'talent_reg_rejected', { registration_id: regId });
      req.flash('success', 'Registration rejected');
      res.redirect('back');
    } catch(e) { res.status(500).send(ah(e, 'Reject failed')); }
  });

  /* ─── 13. Scoring Panel ───────────────────────────────────────────────── */
  app.get('/school/talent-show/scoring/:event_id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const eventId = parseInt(req.params.event_id);
      const ev = await pool.query(`SELECT * FROM talent_events WHERE id=$1 AND tenant_id=$2`, [eventId, req.user.tenant_id]);
      if (!ev.rows.length) return res.status(404).send('Event not found');
      const event = ev.rows[0];
      const isJudgeEv = await isJudge(req, eventId);
      const canManageEv = await canManage(req, eventId);
      if (!isJudgeEv && !canManageEv) return res.status(403).send('Only judges or organizers can access scoring');

      const regs = await pool.query(
        `SELECT r.*, s.name as student_name,
         (SELECT AVG(score)::numeric(5,2) FROM talent_scores WHERE registration_id=r.id AND round=r.round) as avg_score,
         (SELECT COUNT(*) FROM talent_scores WHERE registration_id=r.id) as score_count,
         (SELECT COUNT(*) FROM talent_votes WHERE registration_id=r.id) as vote_count
         FROM talent_registrations r LEFT JOIN users s ON r.student_id=s.id
         WHERE r.event_id=$1 AND r.tenant_id=$2 AND r.status='approved' ORDER BY r.category`,
        [eventId, req.user.tenant_id]);

      const myScores = isJudgeEv ? await pool.query(
        `SELECT registration_id, score, round FROM talent_scores WHERE judge_id=$1 AND registration_id IN (SELECT id FROM talent_registrations WHERE event_id=$2)`,
        [req.user.id, eventId]) : { rows: [] };
      const scoreMap = {};
      myScores.rows.forEach(s => { scoreMap[s.registration_id] = s.score; });

      let html = `${SKIP}
        <h2 class="page-title">Scoring Panel: ${esc(event.title)}</h2>
        <p style="margin-bottom:16px;color:${GRAY}">Round: <strong>1</strong> of ${event.rounds} · Max score per criterion: ${(parseFloat(event.max_score)/CRITERIA.length).toFixed(1)}</p>
        <form method="post" action="/school/talent-show/scoring/${eventId}">
        <table><thead><tr><th>Student</th><th>Category</th><th>Performance</th>`;
      CRITERIA.forEach(c => { html += `<th>${c.replace(/_/g,' ').replace(/\b\w/g,l=>l.toUpperCase())}</th>`; });
      html += `<th>Total</th><th>Comments</th></tr></thead><tbody>`;

      regs.rows.forEach((r, idx) => {
        const myTotal = scoreMap[r.id] || null;
        html += `<tr>
          <td><strong>${esc(r.student_name||'')}</strong></td>
          <td><span class="badge badge-blue">${esc(r.category)}</span></td>
          <td>${esc(r.performance_title||'')}</td>`;
        CRITERIA.forEach((c, ci) => {
          html += `<td><input type="number" name="score_${r.id}_${c}" min="0" max="${(parseFloat(event.max_score)/CRITERIA.length).toFixed(1)}" step="0.5" value="0" style="width:70px;text-align:center"></td>`;
        });
        html += `<td><strong style="color:${P}">${r.avg_score !== null ? r.avg_score : '—'}</strong></td>
          <td><input type="text" name="comments_${r.id}" placeholder="Feedback..." style="width:180px"></td>
        </tr>`;
      });

      html += `</tbody></table>
        <input type="hidden" name="round" value="1">
        <button type="submit" class="btn" style="margin-top:16px">Submit Scores (Round 1)</button>
        </form>`;
      res.send(renderPage(req, html, 'Scoring Panel'));
    } catch(e) { res.status(500).send(ah(e, 'Scoring panel failed')); }
  });

  /* ─── 14. Submit Scores POST ──────────────────────────────────────────── */
  app.post('/school/talent-show/scoring/:event_id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const eventId = parseInt(req.params.event_id);
      const { round } = req.body;
      const ev = await pool.query(`SELECT max_score FROM talent_events WHERE id=$1 AND tenant_id=$2`, [eventId, req.user.tenant_id]);
      if (!ev.rows.length) return res.status(404).send('Event not found');

      // Parse all score fields: score_{regId}_{criterion}
      const regIds = new Set();
      const criteriaScores = {};
      for (const key of Object.keys(req.body)) {
        const match = key.match(/^score_(\d+)_(.+)$/);
        if (match) {
          const regId = parseInt(match[1]);
          const criterion = match[2];
          regIds.add(regId);
          if (!criteriaScores[regId]) criteriaScores[regId] = {};
          criteriaScores[regId][criterion] = parseFloat(req.body[key]) || 0;
        }
      }

      for (const regId of regIds) {
        const cs = criteriaScores[regId] || {};
        const totalScore = Object.values(cs).reduce((a, b) => a + b, 0);
        const comments = req.body[`comments_${regId}`] || '';

        await pool.query(`
          INSERT INTO talent_scores (tenant_id, registration_id, judge_id, round, score, comments, criteria_scores)
          VALUES ($1,$2,$3,$4,$5,$6,$7)
          ON CONFLICT (registration_id, judge_id, round)
          DO UPDATE SET score=$5, comments=$6, criteria_scores=$7`,
          [req.user.tenant_id, regId, req.user.id, parseInt(round)||1, totalScore, comments, JSON.stringify(cs)]);
      }

      audit(req, 'talent_scores_submitted', { event_id: eventId, round: round||1, registrations: regIds.size });
      req.flash('success', `Scores submitted for ${regIds.size} performances`);
      res.redirect(`/school/talent-show/scoring/${eventId}`);
    } catch(e) { res.status(500).send(ah(e, 'Score submission failed')); }
  });

  /* ─── 15. Voting ──────────────────────────────────────────────────────── */
  app.post('/school/talent-show/vote/:registration_id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const regId = parseInt(req.params.registration_id);
      const { score } = req.body;
      const voteScore = Math.max(1, Math.min(10, parseInt(score) || 5));

      // Verify the registration belongs to same tenant
      const reg = await pool.query(
        `SELECT r.id, r.tenant_id, e.status FROM talent_registrations r JOIN talent_events e ON r.event_id=e.id WHERE r.id=$1`,
        [regId]);
      if (!reg.rows.length) return res.status(404).send('Registration not found');
      if (reg.rows[0].status !== 'approved') return res.status(400).send('Cannot vote for unapproved registrations');
      if (reg.rows[0].tenant_id !== req.user.tenant_id) return res.status(403).send('Access denied');

      await pool.query(`
        INSERT INTO talent_votes (tenant_id, registration_id, voter_id, score)
        VALUES ($1,$2,$3,$4)
        ON CONFLICT (registration_id, voter_id)
        DO UPDATE SET score=$4`,
        [req.user.tenant_id, regId, req.user.id, voteScore]);

      audit(req, 'talent_vote', { registration_id: regId, score: voteScore });
      req.flash('success', 'Vote recorded!');
      res.redirect('back');
    } catch(e) { res.status(500).send(ah(e, 'Voting failed')); }
  });

  /* ─── 16. Results ─────────────────────────────────────────────────────── */
  app.get('/school/talent-show/results/:event_id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const eventId = parseInt(req.params.event_id);
      const ev = await pool.query(
        `SELECT e.*, (SELECT COUNT(DISTINCT s.judge_id) FROM talent_scores s JOIN talent_registrations r ON s.registration_id=r.id WHERE r.event_id=e.id) as total_judges
         FROM talent_events e WHERE e.id=$1 AND e.tenant_id=$2`,
        [eventId, req.user.tenant_id]);
      if (!ev.rows.length) return res.status(404).send('Event not found');
      const event = ev.rows[0];
      const canManageEv = await canManage(req, eventId);

      // Calculate results per category
      const categories = Array.isArray(event.categories) ? event.categories : [];
      let html = `${SKIP}
        <h2 class="page-title">Results: ${esc(event.title)}</h2>
        <p style="color:${GRAY};margin-bottom:20px">${ev.rows[0].total_judges} judges have scored · Scoring based on ${CRITERIA.length} criteria</p>`;

      for (const cat of categories) {
        const results = await pool.query(`
          SELECT r.id, r.student_id, r.performance_title, s.name as student_name, r.category,
            (SELECT AVG(sc.score)::numeric(5,2) FROM talent_scores sc WHERE sc.registration_id=r.id) as avg_score,
            (SELECT COUNT(*) FROM talent_scores sc WHERE sc.registration_id=r.id) as judge_count,
            (SELECT AVG(v.score)::numeric(5,2) FROM talent_votes v WHERE v.registration_id=r.id) as avg_vote,
            (SELECT COUNT(*) FROM talent_votes v WHERE v.registration_id=r.id) as vote_count
          FROM talent_registrations r LEFT JOIN users s ON r.student_id=s.id
          WHERE r.event_id=$1 AND r.tenant_id=$2 AND r.status='approved' AND r.category=$3
          ORDER BY avg_score DESC NULLS LAST, avg_vote DESC NULLS LAST`,
          [eventId, req.user.tenant_id, cat]);

        if (results.rows.length === 0) continue;

        html += `<div class="card">
          <h3 style="color:${P};margin:0 0 12px">${esc(cat.charAt(0).toUpperCase()+cat.slice(1))}</h3>
          <table><thead><tr><th>Rank</th><th>Student</th><th>Performance</th><th>Judge Avg</th><th>Audience Avg</th><th>Combined</th></tr></thead><tbody>`;

        results.rows.forEach((r, idx) => {
          const judgeAvg = parseFloat(r.avg_score) || 0;
          const audAvg = parseFloat(r.avg_vote) || 0;
          const combined = ((judgeAvg * 0.7) + (audAvg * 3 * 0.3)).toFixed(1); // Weight: 70% judges, 30% audience (scaled)
          const rank = idx + 1;
          const rankLabel = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}`;
          html += `<tr>
            <td style="font-size:20px;text-align:center">${rankLabel}</td>
            <td><strong>${esc(r.student_name||'Unknown')}</strong></td>
            <td>${esc(r.performance_title||'—')}</td>
            <td><span class="star-rating">${'★'.repeat(Math.round(judgeAvg/20))}${'☆'.repeat(5-Math.round(judgeAvg/20))}</span> ${r.avg_score || '—'}</td>
            <td>${r.avg_vote || '—'} (${r.vote_count} votes)</td>
            <td><strong style="color:${P}">${combined}</strong></td>
          </tr>`;
        });

        html += `</tbody></table></div>`;
      }

      // Announce winners button for organizers
      if (canManageEv && event.status !== 'completed') {
        html += `<div style="margin-top:20px">
          <form method="post" action="/school/talent-show/results/${eventId}/announce" onsubmit="return confirm('This will set event status to completed and generate certificates. Continue?')">
            <button class="btn btn-success">Announce Winners & Complete Event</button>
          </form>
        </div>`;
      }

      // Voting section
      html += `<div class="card" style="margin-top:20px">
        <h3 style="margin:0 0 12px">Audience Voting</h3>
        <p style="color:${GRAY};margin-bottom:12px">Vote for your favorite performances (1-10 scale)</p>`;
      const votableRegs = await pool.query(
        `SELECT r.id, r.performance_title, s.name as student_name, r.category,
         (SELECT AVG(v.score)::numeric(5,2) FROM talent_votes v WHERE v.registration_id=r.id) as avg_vote,
         (SELECT COUNT(*) FROM talent_votes v WHERE v.registration_id=r.id) as vote_count,
         (SELECT score FROM talent_votes WHERE registration_id=r.id AND voter_id=$3) as my_vote
         FROM talent_registrations r LEFT JOIN users s ON r.student_id=s.id
         WHERE r.event_id=$1 AND r.tenant_id=$2 AND r.status='approved'
         ORDER BY avg_vote DESC NULLS LAST`,
        [eventId, req.user.tenant_id, req.user.id]);

      votableRegs.rows.forEach(r => {
        html += `<form method="post" action="/school/talent-show/vote/${r.id}" style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid #e5e7eb">
          <div style="flex:1"><strong>${esc(r.student_name||'')}</strong> — ${esc(r.performance_title||'')} <span class="badge badge-blue">${esc(r.category)}</span>
            <br><small style="color:${GRAY}">Avg: ${r.avg_vote || '—'} · ${r.vote_count} votes${r.my_vote ? ` · Your vote: ${r.my_vote}` : ''}</small></div>
          <input type="number" name="score" min="1" max="10" value="${r.my_vote||5}" style="width:60px;text-align:center">
          <button type="submit" class="btn btn-sm">${r.my_vote ? 'Update' : 'Vote'}</button>
        </form>`;
      });
      html += `</div>`;

      res.send(renderPage(req, html, 'Results'));
    } catch(e) { res.status(500).send(ah(e, 'Results page failed')); }
  });

  /* ─── 17. Announce Winners ────────────────────────────────────────────── */
  app.post('/school/talent-show/results/:event_id/announce', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const eventId = parseInt(req.params.event_id);
      if (!(await canManage(req, eventId))) return res.status(403).send('Access denied');

      // Mark event as completed
      await pool.query(`UPDATE talent_events SET status='completed', updated_at=now() WHERE id=$1 AND tenant_id=$2`, [eventId, req.user.tenant_id]);

      // Calculate winners per category and create certificates
      const categories = await pool.query(
        `SELECT DISTINCT category FROM talent_registrations WHERE event_id=$1 AND tenant_id=$2 AND status='approved'`,
        [eventId, req.user.tenant_id]);

      for (const cat of categories.rows) {
        const winners = await pool.query(`
          SELECT r.id, r.student_id, r.performance_title,
            (SELECT AVG(sc.score)::numeric(5,2) FROM talent_scores sc WHERE sc.registration_id=r.id) as avg_score,
            (SELECT AVG(v.score)::numeric(5,2) FROM talent_votes v WHERE v.registration_id=r.id) as avg_vote
          FROM talent_registrations r
          WHERE r.event_id=$1 AND r.tenant_id=$2 AND r.status='approved' AND r.category=$3
          ORDER BY avg_score DESC NULLS LAST, avg_vote DESC NULLS LAST
          LIMIT 3`, [eventId, req.user.tenant_id, cat.category]);

        const ranks = ['1st', '2nd', '3rd'];
        winners.rows.forEach((w, i) => {
          const certTitle = i === 0 ? 'Winner' : i === 1 ? 'Runner-Up' : 'Second Runner-Up';
          pool.query(`
            INSERT INTO talent_certificates (tenant_id, event_id, registration_id, student_id, certificate_type, rank, title, template_data)
            VALUES ($1,$2,$3,$4,'winner',$5,$6,$7)
            ON CONFLICT DO NOTHING`,
            [req.user.tenant_id, eventId, w.id, w.student_id, ranks[i], certTitle,
              JSON.stringify({ category: cat.category, performance: w.performance_title, avg_score: w.avg_score, avg_vote: w.avg_vote })]);
        });

        // Participation certificates for remaining
        await pool.query(`
          INSERT INTO talent_certificates (tenant_id, event_id, registration_id, student_id, certificate_type, rank, title, template_data)
          SELECT $1, $2, r.id, r.student_id, 'participation', NULL, 'Certificate of Participation',
            jsonb_build_object('category', r.category, 'performance', r.performance_title)
          FROM talent_registrations r
          WHERE r.event_id=$2 AND r.tenant_id=$1 AND r.status='approved' AND r.category=$3
          AND r.id NOT IN (SELECT registration_id FROM talent_certificates WHERE event_id=$2 AND tenant_id=$1)
          ON CONFLICT DO NOTHING`,
          [req.user.tenant_id, eventId, cat.category]);
      }

      audit(req, 'talent_winners_announced', { event_id: eventId });
      req.flash('success', 'Winners announced! Certificates generated.');
      res.redirect(`/school/talent-show/results/${eventId}`);
    } catch(e) { res.status(500).send(ah(e, 'Announce winners failed')); }
  });

  /* ─── 18. Gallery ─────────────────────────────────────────────────────── */
  app.get('/school/talent-show/gallery', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { event_id, media_type } = req.query;
      let where = `WHERE g.tenant_id=$1`;
      const params = [req.user.tenant_id];
      let pi = 2;
      if (event_id) { where += ` AND g.event_id=$${pi++}`; params.push(parseInt(event_id)); }
      if (media_type) { where += ` AND g.media_type=$${pi++}`; params.push(media_type); }

      const media = await pool.query(
        `SELECT g.*, e.title as event_title, u.name as uploader_name
         FROM talent_gallery g
         LEFT JOIN talent_events e ON g.event_id=e.id
         LEFT JOIN users u ON g.uploaded_by=u.id
         ${where} ORDER BY g.created_at DESC LIMIT 100`, params);

      const events = await pool.query(`SELECT id, title FROM talent_events WHERE tenant_id=$1 ORDER BY title`, [req.user.tenant_id]);

      let html = `${SKIP}
        <div class="flex-between">
          <h2 class="page-title">Talent Show Gallery</h2>
          <a href="#upload" class="btn">+ Upload Media</a>
        </div>
        <form method="get" style="display:flex;gap:8px;margin-bottom:16px">
          <select name="event_id" style="max-width:250px">
            <option value="">All Events</option>`;
      events.rows.forEach(ev => {
        html += `<option value="${ev.id}" ${parseInt(event_id)===ev.id?'selected':''}>${esc(ev.title)}</option>`;
      });
      html += `</select>
          <select name="media_type" style="max-width:150px">
            <option value="">All Types</option>
            <option value="photo" ${media_type==='photo'?'selected':''}>Photos</option>
            <option value="video" ${media_type==='video'?'selected':''}>Videos</option>
            <option value="audio" ${media_type==='audio'?'selected':''}>Audio</option>
          </select>
          <button class="btn btn-sm">Filter</button>
        </form>`;

      if (media.rows.length === 0) {
        html += `<div class="empty-state"><p>No media yet. Upload photos and videos from talent show events!</p></div>`;
      } else {
        html += `<div class="grid">`;
        media.rows.forEach(m => {
          html += `<div class="card" style="padding:0;overflow:hidden">
            <div style="height:200px;background:#f3f4f6;display:flex;align-items:center;justify-content:center;color:${GRAY};font-size:40px">
              ${m.media_type === 'video' ? '🎬' : m.media_type === 'audio' ? '🎵' : '📸'}
            </div>
            <div style="padding:12px">
              <strong>${esc(m.title||'Untitled')}</strong><br>
              <small style="color:${GRAY}">${esc(m.event_title||'General')} · by ${esc(m.uploader_name||'')} · ${new Date(m.created_at).toLocaleDateString()}</small><br>
              <span class="badge ${m.media_type==='photo'?'badge-blue':m.media_type==='video'?'badge-purple':'badge-green'}">${m.media_type}</span>
            </div>
          </div>`;
        });
        html += `</div>`;
      }

      // Upload form
      html += `<div class="card" id="upload" style="margin-top:24px;max-width:600px">
        <h3 style="margin:0 0 12px">Upload Media</h3>
        <form method="post" action="/school/talent-show/gallery/upload" enctype="multipart/form-data">
          <div style="margin-bottom:12px"><label>Event</label>
            <select name="event_id" required>`;
      events.rows.forEach(ev => { html += `<option value="${ev.id}">${esc(ev.title)}</option>`; });
      html += `</select></div>
          <div style="margin-bottom:12px"><label>Title</label><input type="text" name="title" required></div>
          <div style="margin-bottom:12px"><label>Media Type</label>
            <select name="media_type"><option value="photo">Photo</option><option value="video">Video</option><option value="audio">Audio</option></select></div>
          <div style="margin-bottom:12px"><label>URL *</label><input type="url" name="url" required placeholder="https://..."></div>
          <div style="margin-bottom:12px"><label>Thumbnail URL</label><input type="url" name="thumbnail_url" placeholder="https://..."></div>
          <button type="submit" class="btn">Upload</button>
        </form>
      </div>`;

      res.send(renderPage(req, html, 'Gallery'));
    } catch(e) { res.status(500).send(ah(e, 'Gallery failed')); }
  });

  /* ─── 19. Gallery Upload POST ─────────────────────────────────────────── */
  app.post('/school/talent-show/gallery/upload', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { event_id, title, media_type, url, thumbnail_url } = req.body;
      if (!url) { req.flash('error', 'URL is required'); return res.redirect('/school/talent-show/gallery'); }

      await pool.query(
        `INSERT INTO talent_gallery (tenant_id, event_id, title, media_type, url, thumbnail_url, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [req.user.tenant_id, parseInt(event_id)||null, title, media_type||'photo', url, thumbnail_url||null, req.user.id]);

      audit(req, 'talent_gallery_upload', { event_id, title, media_type });
      req.flash('success', 'Media uploaded successfully');
      res.redirect('/school/talent-show/gallery');
    } catch(e) { res.status(500).send(ah(e, 'Gallery upload failed')); }
  });

  /* ─── 20. Certificates ────────────────────────────────────────────────── */
  app.get('/school/talent-show/certificates', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { event_id, type } = req.query;
      let where = `WHERE c.tenant_id=$1`;
      const params = [req.user.tenant_id];
      let pi = 2;
      if (event_id) { where += ` AND c.event_id=$${pi++}`; params.push(parseInt(event_id)); }
      if (type) { where += ` AND c.certificate_type=$${pi++}`; params.push(type); }

      const certs = await pool.query(
        `SELECT c.*, s.name as student_name, s.email as student_email, e.title as event_title
         FROM talent_certificates c
         LEFT JOIN users s ON c.student_id=s.id
         LEFT JOIN talent_events e ON c.event_id=e.id
         ${where} ORDER BY c.generated_at DESC`, params);

      const events = await pool.query(`SELECT id, title FROM talent_events WHERE tenant_id=$1 ORDER BY title`, [req.user.tenant_id]);

      let html = `${SKIP}
        <div class="flex-between">
          <h2 class="page-title">Certificates</h2>
          ${event_id ? `<form method="post" action="/school/talent-show/certificates/send-all" style="display:inline">
            <input type="hidden" name="event_id" value="${event_id}">
            <button class="btn btn-sm btn-success" onclick="return confirm('Send all certificates for this event via email?')">Email All</button></form>` : ''}
        </div>
        <form method="get" style="display:flex;gap:8px;margin-bottom:16px">
          <select name="event_id" style="max-width:250px">
            <option value="">All Events</option>`;
      events.rows.forEach(ev => {
        html += `<option value="${ev.id}" ${parseInt(event_id)===ev.id?'selected':''}>${esc(ev.title)}</option>`;
      });
      html += `</select>
          <select name="type" style="max-width:180px">
            <option value="">All Types</option>
            <option value="winner" ${type==='winner'?'selected':''}>Winner</option>
            <option value="participation" ${type==='participation'?'selected':''}>Participation</option>
          </select>
          <button class="btn btn-sm">Filter</button>
        </form>`;

      if (certs.rows.length === 0) {
        html += `<div class="empty-state"><p>No certificates yet. Certificates are auto-generated when winners are announced.</p></div>`;
      } else {
        html += `<table><thead><tr><th>Student</th><th>Event</th><th>Type</th><th>Rank</th><th>Title</th><th>Generated</th><th>Actions</th></tr></thead><tbody>`;
        certs.rows.forEach(c => {
          html += `<tr>
            <td>${esc(c.student_name||'Unknown')}</td>
            <td>${esc(c.event_title||'—')}</td>
            <td><span class="badge ${c.certificate_type==='winner'?'badge-yellow':'badge-blue'}">${c.certificate_type}</span></td>
            <td>${c.rank ? `<strong style="color:${P}">${c.rank}</strong>` : '—'}</td>
            <td>${esc(c.title||'')}</td>
            <td>${new Date(c.generated_at).toLocaleDateString()}</td>
            <td>
              <a href="/school/talent-show/certificates/${c.id}/view" class="btn btn-sm btn-outline">View</a>
              ${c.student_email ? `<form method="post" action="/school/talent-show/certificates/${c.id}/send" style="display:inline">
                <button class="btn btn-sm btn-outline">Email</button></form>` : ''}
            </td>
          </tr>`;
        });
        html += `</tbody></table>`;
      }

      res.send(renderPage(req, html, 'Certificates'));
    } catch(e) { res.status(500).send(ah(e, 'Certificates list failed')); }
  });

  /* ─── 21. View Certificate ────────────────────────────────────────────── */
  app.get('/school/talent-show/certificates/:id/view', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const certId = parseInt(req.params.id);
      const cert = await pool.query(
        `SELECT c.*, s.name as student_name, e.title as event_title, e.date as event_date
         FROM talent_certificates c
         LEFT JOIN users s ON c.student_id=s.id
         LEFT JOIN talent_events e ON c.event_id=e.id
         WHERE c.id=$1 AND c.tenant_id=$2`, [certId, req.user.tenant_id]);
      if (!cert.rows.length) return res.status(404).send('Certificate not found');
      const c = cert.rows[0];
      const td = c.template_data || {};

      let html = `<link rel="stylesheet" href="/css/sk.css">
        <style>
          body{margin:0;padding:40px;background:#f3f4f6;font-family:Georgia,serif}
          .cert-frame{max-width:800px;margin:0 auto;background:linear-gradient(135deg,#fef3c7,#fffbeb);border:8px solid #d97706;border-radius:16px;padding:60px;text-align:center;box-shadow:0 10px 40px rgba(0,0,0,.15)}
          .cert-frame h1{font-size:36px;color:#92400e;margin:0 0 8px;letter-spacing:3px}
          .cert-frame h2{font-size:22px;color:#78350f;margin:0 0 30px;font-weight:normal}
          .cert-name{font-size:42px;color:#1e40af;margin:20px 0;border-bottom:3px solid #d97706;display:inline-block;padding-bottom:8px}
          .cert-body{font-size:16px;color:#44403c;line-height:1.8;margin:20px 0}
          .cert-rank{font-size:28px;color:#b45309;font-weight:bold;margin:16px 0}
          .cert-footer{margin-top:40px;font-size:13px;color:#78716c}
          .cert-seal{width:80px;height:80px;border-radius:50%;background:linear-gradient(135deg,#d97706,#f59e0b);margin:20px auto;display:flex;align-items:center;justify-content:center;font-size:14px;color:#fff;font-weight:bold}
          .back-link{display:block;text-align:center;margin:20px 0;color:#4f46e5}
        </style>
        <a href="/school/talent-show/certificates" class="back-link">&larr; Back to Certificates</a>
        <div class="cert-frame">
          <h1>CERTIFICATE</h1>
          <h2>of ${c.certificate_type === 'winner' ? 'Achievement' : 'Participation'}</h2>
          <p style="color:#78716c;font-size:14px;margin:0">This is to certify that</p>
          <div class="cert-name">${esc(c.student_name||'')}</div>
          <div class="cert-body">
            has ${c.certificate_type === 'winner' ? 'won' : 'participated in'} the
            <strong>${esc(c.event_title||'Talent Show')}</strong>
            ${td.category ? ` in <strong>${esc(td.category)}</strong>` : ''}
            ${td.performance ? `<br>Performance: "${esc(td.performance)}"` : ''}
            ${c.event_date ? `<br>held on ${new Date(c.event_date).toLocaleDateString()}` : ''}
          </div>`;

      if (c.rank) {
        html += `<div class="cert-rank">${c.rank} Place ${c.title || ''}</div>`;
      } else {
        html += `<div class="cert-rank" style="color:#4f46e5;font-size:22px">${esc(c.title||'Certificate of Participation')}</div>`;
      }

      html += `<div class="cert-seal">&#10003;</div>
          <div class="cert-footer">
            Certificate ID: TS-${String(c.id).padStart(6,'0')}<br>
            Generated: ${new Date(c.generated_at).toLocaleDateString()}
          </div>
        </div>`;
      res.send(html);
    } catch(e) { res.status(500).send(ah(e, 'Certificate view failed')); }
  });

  /* ─── 22. Send Certificate Email ──────────────────────────────────────── */
  app.post('/school/talent-show/certificates/:id/send', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const certId = parseInt(req.params.id);
      const cert = await pool.query(
        `SELECT c.*, s.name as student_name, s.email as student_email, e.title as event_title
         FROM talent_certificates c LEFT JOIN users s ON c.student_id=s.id
         LEFT JOIN talent_events e ON c.event_id=e.id WHERE c.id=$1 AND c.tenant_id=$2`,
        [certId, req.user.tenant_id]);
      if (!cert.rows.length) return res.status(404).send('Not found');
      const c = cert.rows[0];
      if (!c.student_email) { req.flash('error', 'No email for student'); return res.redirect('back'); }

      queueEmail({
        to: c.student_email,
        subject: `Your Talent Show Certificate - ${c.event_title || 'Congratulations!'}`,
        body: `Dear ${c.student_name},\n\nCongratulations! You have received a certificate: ${c.title}.\n\nView your certificate at: /school/talent-show/certificates/${c.id}/view\n\nKeep shining!\nSchool Administration`
      });

      audit(req, 'talent_certificate_sent', { certificate_id: certId, student_id: c.student_id });
      req.flash('success', `Certificate emailed to ${c.student_name}`);
      res.redirect('back');
    } catch(e) { res.status(500).send(ah(e, 'Send certificate failed')); }
  });

  /* ─── 23. Send All Certificates for Event ─────────────────────────────── */
  app.post('/school/talent-show/certificates/send-all', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const eventId = parseInt(req.body.event_id);
      if (!(await canManage(req, eventId))) return res.status(403).send('Access denied');

      const certs = await pool.query(
        `SELECT c.id, s.name, s.email FROM talent_certificates c
         LEFT JOIN users s ON c.student_id=s.id
         WHERE c.event_id=$1 AND c.tenant_id=$2 AND s.email IS NOT NULL`,
        [eventId, req.user.tenant_id]);

      let sent = 0;
      certs.rows.forEach(c => {
        queueEmail({
          to: c.email,
          subject: 'Your Talent Show Certificate!',
          body: `Dear ${c.name},\n\nCongratulations! Your certificate is ready.\nView at: /school/talent-show/certificates/${c.id}/view\n\nKeep shining!`
        });
        sent++;
      });

      audit(req, 'talent_certificates_bulk_sent', { event_id: eventId, count: sent });
      req.flash('success', `${sent} certificate emails queued`);
      res.redirect('/school/talent-show/certificates');
    } catch(e) { res.status(500).send(ah(e, 'Bulk send certificates failed')); }
  });

  /* ─── 24. Analytics ───────────────────────────────────────────────────── */
  app.get('/school/talent-show/analytics', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const { event_id } = req.query;

      // Overall stats
      const overallStats = await pool.query(`
        SELECT
          (SELECT COUNT(*) FROM talent_events WHERE tenant_id=$1) as total_events,
          (SELECT COUNT(*) FROM talent_registrations r JOIN talent_events e ON r.event_id=e.id WHERE e.tenant_id=$1) as total_registrations,
          (SELECT COUNT(*) FROM talent_scores s JOIN talent_registrations r ON s.registration_id=r.id JOIN talent_events e ON r.event_id=e.id WHERE e.tenant_id=$1) as total_scores,
          (SELECT COUNT(*) FROM talent_votes WHERE tenant_id=$1) as total_votes,
          (SELECT COUNT(*) FROM talent_gallery WHERE tenant_id=$1) as total_media,
          (SELECT COUNT(*) FROM talent_certificates WHERE tenant_id=$1) as total_certificates`,
        [tid]);

      // Category distribution
      const catDist = await pool.query(`
        SELECT r.category, COUNT(*) as count
        FROM talent_registrations r JOIN talent_events e ON r.event_id=e.id
        WHERE e.tenant_id=$1 GROUP BY r.category ORDER BY count DESC`, [tid]);

      // Events by status
      const statusDist = await pool.query(`
        SELECT status, COUNT(*) as count FROM talent_events WHERE tenant_id=$1 GROUP BY status ORDER BY count DESC`, [tid]);

      // Top performers
      const topPerformers = await pool.query(`
        SELECT r.student_id, s.name, AVG(sc.score)::numeric(5,2) as avg_score, COUNT(DISTINCT sc.registration_id) as performances
        FROM talent_scores sc
        JOIN talent_registrations r ON sc.registration_id=r.id
        LEFT JOIN users s ON r.student_id=s.id
        WHERE sc.tenant_id=$1
        GROUP BY r.student_id, s.name
        ORDER BY avg_score DESC LIMIT 10`, [tid]);

      // Monthly registrations
      const monthlyRegs = await pool.query(`
        SELECT TO_CHAR(r.created_at, 'YYYY-MM') as month, COUNT(*) as count
        FROM talent_registrations r JOIN talent_events e ON r.event_id=e.id
        WHERE e.tenant_id=$1
        GROUP BY TO_CHAR(r.created_at, 'YYYY-MM') ORDER BY month DESC LIMIT 12`, [tid]);

      // Most active voters
      const topVoters = await pool.query(`
        SELECT voter_id, u.name, COUNT(*) as votes_cast
        FROM talent_votes v LEFT JOIN users u ON v.voter_id=u.id
        WHERE v.tenant_id=$1 GROUP BY voter_id, u.name ORDER BY votes_cast DESC LIMIT 10`, [tid]);

      // Event-specific stats
      let eventStats = null;
      if (event_id) {
        eventStats = await pool.query(`
          SELECT
            (SELECT COUNT(*) FROM talent_registrations WHERE event_id=$1 AND tenant_id=$2) as regs,
            (SELECT COUNT(DISTINCT judge_id) FROM talent_scores s JOIN talent_registrations r ON s.registration_id=r.id WHERE r.event_id=$1) as judges,
            (SELECT AVG(score)::numeric(5,2) FROM talent_scores s JOIN talent_registrations r ON s.registration_id=r.id WHERE r.event_id=$1) as avg_all_scores,
            (SELECT COUNT(*) FROM talent_votes v JOIN talent_registrations r ON v.registration_id=r.id WHERE r.event_id=$1) as total_votes,
            (SELECT COUNT(*) FROM talent_gallery WHERE event_id=$1) as media_count`,
          [parseInt(event_id), tid]);
      }

      const os = overallStats.rows[0];
      let html = `${SKIP}
        <h2 class="page-title">Talent Show Analytics</h2>
        <div class="grid">
          <div class="stat-card"><h3>${os.total_events}</h3><p>Total Events</p></div>
          <div class="stat-card"><h3>${os.total_registrations}</h3><p>Registrations</p></div>
          <div class="stat-card"><h3>${os.total_scores}</h3><p>Scores Given</p></div>
          <div class="stat-card"><h3>${os.total_votes}</h3><p>Audience Votes</p></div>
          <div class="stat-card"><h3>${os.total_media}</h3><p>Gallery Items</p></div>
          <div class="stat-card"><h3>${os.total_certificates}</h3><p>Certificates</p></div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:24px">
          <div class="card">
            <h3 style="margin:0 0 12px">Registrations by Category</h3>`;
      if (catDist.rows.length) {
        const maxCat = catDist.rows[0].count;
        catDist.rows.forEach(c => {
          const pct = Math.round((c.count / maxCat) * 100);
          html += `<div style="margin-bottom:8px">
            <span style="display:inline-block;width:100px;font-size:13px">${esc(c.category)}</span>
            <div class="progress-bar" style="display:inline-block;width:60%;vertical-align:middle"><div class="progress-fill" style="width:${pct}%"></div></div>
            <span style="font-size:13px;color:${GRAY};margin-left:8px">${c.count}</span>
          </div>`;
        });
      } else {
        html += `<p style="color:${GRAY}">No data</p>`;
      }
      html += `</div>

          <div class="card">
            <h3 style="margin:0 0 12px">Events by Status</h3>`;
      statusDist.rows.forEach(s => {
        html += `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #e5e7eb">
          <span class="badge ${STATUS_COLORS[s.status]||'badge-yellow'}">${s.status.replace(/_/g,' ')}</span>
          <strong>${s.count}</strong>
        </div>`;
      });
      html += `</div>

          <div class="card">
            <h3 style="margin:0 0 12px">Top Performers</h3>
            <table><thead><tr><th>Student</th><th>Avg Score</th><th>Performances</th></tr></thead><tbody>`;
      topPerformers.rows.forEach((p, i) => {
        html += `<tr><td>${i+1}. ${esc(p.name||'Unknown')}</td>
          <td><strong style="color:${P}">${p.avg_score}</strong></td>
          <td>${p.performances}</td></tr>`;
      });
      html += `</tbody></table></div>

          <div class="card">
            <h3 style="margin:0 0 12px">Most Active Voters</h3>
            <table><thead><tr><th>Voter</th><th>Votes Cast</th></tr></thead><tbody>`;
      topVoters.rows.forEach((v, i) => {
        html += `<tr><td>${i+1}. ${esc(v.name||'Unknown')}</td><td>${v.votes_cast}</td></tr>`;
      });
      html += `</tbody></table></div>
        </div>`;

      if (monthlyRegs.rows.length) {
        html += `<div class="card" style="margin-top:16px">
          <h3 style="margin:0 0 12px">Monthly Registration Trend</h3>
          <div style="display:flex;align-items:flex-end;gap:8px;height:150px">`;
        const maxMonth = monthlyRegs.rows[0].count;
        monthlyRegs.rows.slice().reverse().forEach(m => {
          const pct = Math.round((m.count / maxMonth) * 100);
          html += `<div style="flex:1;text-align:center">
            <div style="background:${P};height:${pct}%;min-height:4px;border-radius:4px 4px 0 0;margin:0 auto;max-width:40px"></div>
            <small style="color:${GRAY};font-size:11px">${m.month}</small><br>
            <small>${m.count}</small>
          </div>`;
        });
        html += `</div></div>`;
      }

      if (eventStats && eventStats.rows.length) {
        const es = eventStats.rows[0];
        html += `<div class="card" style="margin-top:16px">
          <h3 style="margin:0 0 12px">Event-Specific Stats (ID: ${event_id})</h3>
          <div class="grid">
            <div class="stat-card"><h3>${es.regs}</h3><p>Registrations</p></div>
            <div class="stat-card"><h3>${es.judges}</h3><p>Active Judges</p></div>
            <div class="stat-card"><h3>${es.avg_all_scores}</h3><p>Avg Score</p></div>
            <div class="stat-card"><h3>${es.total_votes}</h3><p>Audience Votes</p></div>
            <div class="stat-card"><h3>${es.media_count}</h3><p>Gallery Items</p></div>
          </div>
        </div>`;
      }

      res.send(renderPage(req, html, 'Analytics'));
    } catch(e) { res.status(500).send(ah(e, 'Analytics failed')); }
  });

  /* ─── 25. My Registrations (Student View) ─────────────────────────────── */
  app.get('/school/talent-show/my-registrations', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const regs = await pool.query(
        `SELECT r.*, e.title as event_title, e.date as event_date, e.venue as event_venue
         FROM talent_registrations r
         JOIN talent_events e ON r.event_id=e.id
         WHERE r.student_id=$1 AND r.tenant_id=$2
         ORDER BY r.created_at DESC`,
        [req.user.id, req.user.tenant_id]);

      let html = `${SKIP}
        <h2 class="page-title">My Registrations</h2>`;

      if (regs.rows.length === 0) {
        html += `<div class="empty-state"><p>You haven't registered for any talent shows yet.</p>
          <a href="/school/talent-show/events" class="btn" style="margin-top:12px">Browse Events</a></div>`;
      } else {
        html += `<div class="grid">`;
        regs.rows.forEach(r => {
          html += `<div class="card">
            <div class="flex-between">
              <strong style="font-size:16px">${esc(r.event_title)}</strong>
              <span class="badge ${REG_STATUS_COLORS[r.status]||'badge-yellow'}">${r.status}</span>
            </div>
            <p style="color:${GRAY};margin:4px 0">${r.event_date ? r.event_date.toLocaleDateString() : ''} · ${esc(r.event_venue||'')}</p>
            <p><span class="badge badge-blue">${esc(r.category)}</span> ${esc(r.performance_title||'')}</p>
            ${r.description ? `<p style="font-size:13px;color:#555;margin-top:8px">${esc(r.description.substring(0,120))}${r.description.length>120?'...':''}</p>` : ''}
            ${r.audition_time ? `<p style="margin-top:8px;font-size:13px"><strong>Audition:</strong> ${new Date(r.audition_time).toLocaleString()} · ${esc(r.audition_venue||'')}</p>` : ''}
            <div style="margin-top:10px">
              <a href="/school/talent-show/events/${r.event_id}" class="btn btn-sm btn-outline">View Event</a>
            </div>
          </div>`;
        });
        html += `</div>`;
      }

      res.send(renderPage(req, html, 'My Registrations'));
    } catch(e) { res.status(500).send(ah(e, 'My registrations failed')); }
  });

  /* ─── 26. Shortlist Registration ──────────────────────────────────────── */
  app.post('/school/talent-show/registrations/:id/shortlist', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const regId = parseInt(req.params.id);
      const reg = await pool.query(`SELECT event_id FROM talent_registrations WHERE id=$1`, [regId]);
      if (!reg.rows.length) return res.status(404).send('Not found');
      if (!(await canManage(req, reg.rows[0].event_id))) return res.status(403).send('Access denied');
      await pool.query(`UPDATE talent_registrations SET status='shortlisted' WHERE id=$1`, [regId]);
      audit(req, 'talent_reg_shortlisted', { registration_id: regId });
      req.flash('success', 'Registration shortlisted for next round');
      res.redirect('back');
    } catch(e) { res.status(500).send(ah(e, 'Shortlist failed')); }
  });

  /* ─── 27. Delete Registration ─────────────────────────────────────────── */
  app.post('/school/talent-show/registrations/:id/delete', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const regId = parseInt(req.params.id);
      const reg = await pool.query(`SELECT event_id, student_id, tenant_id FROM talent_registrations WHERE id=$1`, [regId]);
      if (!reg.rows.length) return res.status(404).send('Not found');
      const r = reg.rows[0];
      if (r.student_id !== req.user.id && !(await canManage(req, r.event_id))) return res.status(403).send('Access denied');
      await pool.query(`DELETE FROM talent_registrations WHERE id=$1`, [regId]);
      audit(req, 'talent_reg_deleted', { registration_id: regId });
      req.flash('success', 'Registration removed');
      res.redirect('back');
    } catch(e) { res.status(500).send(ah(e, 'Delete registration failed')); }
  });

  /* ─── 28. Leaderboard (Cross-Event) ───────────────────────────────────── */
  app.get('/school/talent-show/leaderboard', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const leaders = await pool.query(`
        SELECT r.student_id, s.name as student_name, s.avatar,
          COUNT(DISTINCT r.event_id) as events_participated,
          COUNT(DISTINCT CASE WHEN c.certificate_type='winner' THEN c.id END) as wins,
          AVG(sc.score)::numeric(5,2) as avg_score
        FROM talent_registrations r
        LEFT JOIN users s ON r.student_id=s.id
        LEFT JOIN talent_certificates c ON r.id=c.registration_id
        LEFT JOIN talent_scores sc ON r.id=sc.registration_id
        WHERE r.tenant_id=$1
        GROUP BY r.student_id, s.name, s.avatar
        HAVING COUNT(DISTINCT r.event_id) > 0
        ORDER BY wins DESC, avg_score DESC NULLS LAST
        LIMIT 20`, [req.user.tenant_id]);

      let html = `${SKIP}
        <h2 class="page-title">Talent Show Leaderboard</h2>
        <p style="color:${GRAY};margin-bottom:20px">Top performers across all events</p>
        <table>
          <thead><tr><th>Rank</th><th>Student</th><th>Events</th><th>Wins</th><th>Avg Score</th></tr></thead>
          <tbody>`;
      leaders.rows.forEach((l, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}`;
        html += `<tr>
          <td style="font-size:22px;text-align:center">${medal}</td>
          <td><strong>${esc(l.student_name||'Unknown')}</strong></td>
          <td>${l.events_participated}</td>
          <td><strong style="color:${P}">${l.wins}</strong></td>
          <td>${l.avg_score || '—'}</td>
        </tr>`;
      });
      html += `</tbody></table>`;

      if (leaders.rows.length === 0) {
        html += `<div class="empty-state"><p>No leaderboard data yet. Complete events to generate rankings!</p></div>`;
      }

      res.send(renderPage(req, html, 'Leaderboard'));
    } catch(e) { res.status(500).send(ah(e, 'Leaderboard failed')); }
  });

  /* ─── 29. Manage Rounds ───────────────────────────────────────────────── */
  app.post('/school/talent-show/events/:id/advance-round', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const eventId = parseInt(req.params.id);
      if (!(await canManage(req, eventId))) return res.status(403).send('Access denied');

      const ev = await pool.query(`SELECT rounds FROM talent_events WHERE id=$1 AND tenant_id=$2`, [eventId, req.user.tenant_id]);
      if (!ev.rows.length) return res.status(404).send('Event not found');
      const maxRounds = ev.rows[0].rounds || 1;

      const currentRound = await pool.query(
        `SELECT COALESCE(MAX(round),1) as cr FROM talent_registrations WHERE event_id=$1 AND tenant_id=$2`,
        [eventId, req.user.tenant_id]);
      const nextRound = Math.min(currentRound.rows[0].cr + 1, maxRounds);

      if (nextRound > maxRounds) {
        req.flash('error', 'Maximum rounds reached');
        return res.redirect('back');
      }

      // Advance shortlisted regs to next round
      const result = await pool.query(
        `UPDATE talent_registrations SET round=$1 WHERE event_id=$2 AND tenant_id=$3 AND status='shortlisted' AND round < $1`,
        [nextRound, eventId, req.user.tenant_id]);

      audit(req, 'talent_round_advanced', { event_id: eventId, round: nextRound });
      req.flash('success', `Advanced to Round ${nextRound}`);
      res.redirect('back');
    } catch(e) { res.status(500).send(ah(e, 'Advance round failed')); }
  });

  console.log('[TalentShow] Module loaded – 29 routes registered');
};
