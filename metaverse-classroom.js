module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5', GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.btn:hover{background:#3730a3}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}</style>';

  (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS metaverse_spaces (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, name VARCHAR(255) NOT NULL,
        layout_type VARCHAR(50) DEFAULT 'classroom', capacity INT DEFAULT 30,
        scene_url TEXT, created_by INT, status VARCHAR(20) DEFAULT 'active',
        description TEXT, theme VARCHAR(50) DEFAULT 'default', accessibility_opts JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS metaverse_sessions (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, space_id INT REFERENCES metaverse_spaces(id),
        title VARCHAR(255) NOT NULL, description TEXT, scheduled_at TIMESTAMPTZ,
        duration_min INT DEFAULT 60, attendees JSONB DEFAULT '[]',
        recording_url TEXT, status VARCHAR(20) DEFAULT 'scheduled',
        breakout_rooms JSONB DEFAULT '[]', whiteboard_data JSONB DEFAULT '{}',
        lab_equipment JSONB DEFAULT '[]', created_by INT,
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS avatar_profiles (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, student_id INT NOT NULL,
        display_name VARCHAR(100) NOT NULL, appearance JSONB DEFAULT '{}',
        accessories JSONB DEFAULT '[]', custom_colors JSONB DEFAULT '{}',
        accessibility_prefs JSONB DEFAULT '{}', mood VARCHAR(50) DEFAULT 'neutral',
        last_active TIMESTAMPTZ DEFAULT NOW(), created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS metaverse_attendance (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, session_id INT REFERENCES metaverse_sessions(id),
        student_id INT NOT NULL, join_time TIMESTAMPTZ, leave_time TIMESTAMPTZ,
        duration_min INT DEFAULT 0, avatar_used INT, engagement_score DECIMAL(5,2) DEFAULT 0,
        status VARCHAR(20) DEFAULT 'present', verified BOOLEAN DEFAULT false
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS metaverse_whiteboards (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, session_id INT REFERENCES metaverse_sessions(id),
        title VARCHAR(255), content JSONB DEFAULT '{}', pages JSONB DEFAULT '[]',
        owner_id INT, shared_with JSONB DEFAULT '[]', locked BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS metaverse_breakout_rooms (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, session_id INT REFERENCES metaverse_sessions(id),
        name VARCHAR(255), capacity INT DEFAULT 10, participants JSONB DEFAULT '[]',
        task_description TEXT, status VARCHAR(20) DEFAULT 'active',
        time_limit_min INT DEFAULT 15, created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      console.log('[Mod] metaverse-classroom OK');
    } catch(e) { console.warn('[Mod] metaverse-classroom Warn:', e.message); }
  })();

  /* ─── Helper: layout options ─── */
  const LAYOUT_TYPES = ['classroom','auditorium','lab','roundtable','theater','open_space','custom'];
  const THEMES = ['default','space','underwater','forest','retro','minimal','neon'];

  /* ════════════════════════════════════════════════
     ROUTE 1 — Dashboard
     ════════════════════════════════════════════════ */
  app.get('/school/metaverse-classroom', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.tenant_id;
      const [spaces, sessions, avatars] = await Promise.all([
        pool.query('SELECT * FROM metaverse_spaces WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 10', [tid]),
        pool.query(`SELECT s.*, sp.name AS space_name FROM metaverse_sessions s
          LEFT JOIN metaverse_spaces sp ON s.space_id=sp.id
          WHERE s.tenant_id=$1 ORDER BY s.scheduled_at DESC LIMIT 10`, [tid]),
        pool.query('SELECT COUNT(*) AS cnt FROM avatar_profiles WHERE tenant_id=$1', [tid])
      ]);
      const rows = `
        <div class="stats-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px">
          <div class="card" style="text-align:center"><div style="font-size:2em;color:${P}">${spaces.rows.length}</div><div style="color:${GRAY}">Virtual Spaces</div></div>
          <div class="card" style="text-align:center"><div style="font-size:2em;color:${P}">${sessions.rows.length}</div><div style="color:${GRAY}">Sessions</div></div>
          <div class="card" style="text-align:center"><div style="font-size:2em;color:${P}">${avatars.rows[0].cnt}</div><div style="color:${GRAY}">Avatar Profiles</div></div>
        </div>
        <div class="card"><h3 style="margin-top:0">Recent Spaces</h3>
          <table><tr><th>Name</th><th>Layout</th><th>Capacity</th><th>Status</th><th>Actions</th></tr>
          ${spaces.rows.map(s => `<tr><td>${esc(s.name)}</td><td>${esc(s.layout_type)}</td><td>${s.capacity}</td><td><span style="color:${s.status==='active'?'#10b981':'#ef4444'}">${esc(s.status)}</span></td><td><a class="btn" href="/school/metaverse-classroom/spaces/${s.id}">View</a></td></tr>`).join('')}
          ${spaces.rows.length===0?'<tr><td colspan="5" style="text-align:center;color:'+GRAY+'">No spaces yet</td></tr>':''}
          </table>
        </div>
        <div class="card"><h3 style="margin-top:0">Upcoming Sessions</h3>
          <table><tr><th>Title</th><th>Space</th><th>Scheduled</th><th>Status</th><th>Actions</th></tr>
          ${sessions.rows.map(s => `<tr><td>${esc(s.title)}</td><td>${esc(s.space_name||'—')}</td><td>${s.scheduled_at?new Date(s.scheduled_at).toLocaleDateString():'—'}</td><td>${esc(s.status)}</td><td><a class="btn" href="/school/metaverse-classroom/sessions/${s.id}">View</a></td></tr>`).join('')}
          ${sessions.rows.length===0?'<tr><td colspan="5" style="text-align:center;color:'+GRAY+'">No sessions yet</td></tr>':''}
          </table>
        </div>`;
      renderPage(req, res, 'Metaverse Classroom', rows, SKIP, '/school/metaverse-classroom');
    } catch(e) { ah(e, req, res); }
  });

  /* ════════════════════════════════════════════════
     ROUTE 2 — List Spaces
     ════════════════════════════════════════════════ */
  app.get('/school/metaverse-classroom/spaces', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { search, layout, status: st } = req.query;
      let sql = 'SELECT * FROM metaverse_spaces WHERE tenant_id=$1';
      const params = [req.tenant_id];
      let i = 2;
      if (search) { sql += ` AND name ILIKE $${i++}`; params.push(`%${search}%`); }
      if (layout) { sql += ` AND layout_type=$${i++}`; params.push(layout); }
      if (st) { sql += ` AND status=$${i++}`; params.push(st); }
      sql += ' ORDER BY created_at DESC';
      const result = await pool.query(sql, params);
      const html = `
        <div class="card"><h3 style="margin-top:0">Virtual Spaces</h3>
          <form method="get" style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
            <input name="search" placeholder="Search spaces..." value="${esc(req.query.search||'')}" style="width:200px">
            <select name="layout" style="width:150px"><option value="">All Layouts</option>${LAYOUT_TYPES.map(l=>`<option value="${l}" ${layout===l?'selected':''}>${l}</option>`).join('')}</select>
            <select name="status" style="width:120px"><option value="">All Status</option><option value="active" ${st==='active'?'selected':''}>Active</option><option value="inactive" ${st==='inactive'?'selected':''}>Inactive</option><option value="maintenance" ${st==='maintenance'?'selected':''}>Maintenance</option></select>
            <button class="btn" type="submit">Filter</button>
            <a class="btn" href="/school/metaverse-classroom/spaces/new" style="background:#10b981;text-decoration:none">+ New Space</a>
          </form>
          <table><tr><th>Name</th><th>Layout</th><th>Capacity</th><th>Theme</th><th>Status</th><th>Actions</th></tr>
          ${result.rows.map(s => `<tr><td>${esc(s.name)}</td><td>${esc(s.layout_type)}</td><td>${s.capacity}</td><td>${esc(s.theme||'default')}</td><td><span style="color:${s.status==='active'?'#10b981':'#ef4444'}">${esc(s.status)}</span></td><td><a class="btn" href="/school/metaverse-classroom/spaces/${s.id}">Manage</a></td></tr>`).join('')}
          ${result.rows.length===0?'<tr><td colspan="6" style="text-align:center;color:'+GRAY+'">No spaces found</td></tr>':''}
          </table>
        </div>`;
      renderPage(req, res, 'Virtual Spaces', html, SKIP, '/school/metaverse-classroom');
    } catch(e) { ah(e, req, res); }
  });

  /* ════════════════════════════════════════════════
     ROUTE 3 — Create Space
     ════════════════════════════════════════════════ */
  app.get('/school/metaverse-classroom/spaces/new', requireAuth, requireNotBanned, (req, res) => {
    const html = `
      <div class="card"><h3 style="margin-top:0">Create Virtual Space</h3>
        <form method="post" action="/school/metaverse-classroom/spaces/new">
          <div style="margin-bottom:12px"><label>Space Name *</label><input name="name" required placeholder="e.g. Physics Lab 3D"></div>
          <div style="margin-bottom:12px"><label>Description</label><textarea name="description" rows="3" placeholder="Describe the virtual space..."></textarea></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div><label>Layout Type *</label><select name="layout_type" required>${LAYOUT_TYPES.map(l=>`<option value="${l}">${l}</option>`).join('')}</select></div>
            <div><label>Capacity *</label><input name="capacity" type="number" min="1" max="500" value="30" required></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">
            <div><label>Theme</label><select name="theme">${THEMES.map(t=>`<option value="${t}">${t}</option>`).join('')}</select></div>
            <div><label>Scene URL</label><input name="scene_url" placeholder="https://..."></div>
          </div>
          <div style="margin-top:12px"><label>Accessibility Options (JSON)</label><textarea name="accessibility_opts" rows="2" placeholder='{"screenReader":true,"closedCaptions":true}'></textarea></div>
          <div style="margin-top:16px"><button class="btn" type="submit">Create Space</button> <a class="btn" href="/school/metaverse-classroom/spaces" style="background:${GRAY}">Cancel</a></div>
        </form>
      </div>`;
    renderPage(req, res, 'New Virtual Space', html, SKIP, '/school/metaverse-classroom');
  });

  app.post('/school/metaverse-classroom/spaces/new', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { name, description, layout_type, capacity, theme, scene_url, accessibility_opts } = req.body;
      let accOpts = {};
      try { accOpts = JSON.parse(accessibility_opts || '{}'); } catch(_) {}
      await pool.query(`INSERT INTO metaverse_spaces (tenant_id,name,description,layout_type,capacity,theme,scene_url,accessibility_opts,created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [req.tenant_id, name, description, layout_type, parseInt(capacity)||30, theme||'default', scene_url, JSON.stringify(accOpts), req.user_id]);
      audit(req, 'metaverse_space_created', { name, layout_type });
      req.flash('success', 'Virtual space created successfully');
      res.redirect('/school/metaverse-classroom/spaces');
    } catch(e) { ah(e, req, res); }
  });

  /* ════════════════════════════════════════════════
     ROUTE 4 — View / Manage Space
     ════════════════════════════════════════════════ */
  app.get('/school/metaverse-classroom/spaces/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const sp = await pool.query('SELECT * FROM metaverse_spaces WHERE id=$1 AND tenant_id=$2', [req.params.id, req.tenant_id]);
      if (!sp.rows[0]) return res.status(404).send('Space not found');
      const s = sp.rows[0];
      const sess = await pool.query('SELECT * FROM metaverse_sessions WHERE space_id=$1 AND tenant_id=$2 ORDER BY scheduled_at DESC LIMIT 20', [s.id, req.tenant_id]);
      const html = `
        <div class="card"><h3 style="margin-top:0">${esc(s.name)}</h3>
          <p style="color:${GRAY}">${esc(s.description||'No description')}</p>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">
            <div><strong>Layout:</strong> ${esc(s.layout_type)}</div>
            <div><strong>Capacity:</strong> ${s.capacity}</div>
            <div><strong>Theme:</strong> ${esc(s.theme||'default')}</div>
            <div><strong>Status:</strong> <span style="color:${s.status==='active'?'#10b981':'#ef4444'}">${esc(s.status)}</span></div>
            <div><strong>Scene URL:</strong> ${s.scene_url?`<a href="${esc(s.scene_url)}" target="_blank">Open</a>`:'Not set'}</div>
            <div><strong>Created:</strong> ${new Date(s.created_at).toLocaleDateString()}</div>
          </div>
          <div style="margin-top:12px"><strong>Accessibility:</strong><pre style="background:#f3f4f6;padding:8px;border-radius:8px;overflow:auto">${esc(JSON.stringify(s.accessibility_opts||{},null,2))}</pre></div>
          <div style="margin-top:16px">
            <a class="btn" href="/school/metaverse-classroom/spaces/${s.id}/edit" style="background:#f59e0b">Edit Space</a>
            <a class="btn" href="/school/metaverse-classroom/sessions/new?space_id=${s.id}" style="background:#10b981">Schedule Session</a>
          </div>
        </div>
        <div class="card"><h3 style="margin-top:0">Sessions in this Space (${sess.rows.length})</h3>
          <table><tr><th>Title</th><th>Scheduled</th><th>Duration</th><th>Status</th></tr>
          ${sess.rows.map(x => `<tr><td><a href="/school/metaverse-classroom/sessions/${x.id}">${esc(x.title)}</a></td><td>${x.scheduled_at?new Date(x.scheduled_at).toLocaleString():'TBD'}</td><td>${x.duration_min}m</td><td>${esc(x.status)}</td></tr>`).join('')}
          ${sess.rows.length===0?'<tr><td colspan="4" style="text-align:center;color:'+GRAY+'">No sessions in this space</td></tr>':''}
          </table>
        </div>`;
      renderPage(req, res, s.name, html, SKIP, '/school/metaverse-classroom');
    } catch(e) { ah(e, req, res); }
  });

  /* ════════════════════════════════════════════════
     ROUTE 5 — Edit Space
     ════════════════════════════════════════════════ */
  app.get('/school/metaverse-classroom/spaces/:id/edit', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const sp = await pool.query('SELECT * FROM metaverse_spaces WHERE id=$1 AND tenant_id=$2', [req.params.id, req.tenant_id]);
      if (!sp.rows[0]) return res.status(404).send('Not found');
      const s = sp.rows[0];
      const html = `
        <div class="card"><h3 style="margin-top:0">Edit: ${esc(s.name)}</h3>
          <form method="post" action="/school/metaverse-classroom/spaces/${s.id}/edit">
            <div style="margin-bottom:12px"><label>Name *</label><input name="name" value="${esc(s.name)}" required></div>
            <div style="margin-bottom:12px"><label>Description</label><textarea name="description" rows="3">${esc(s.description||'')}</textarea></div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div><label>Layout</label><select name="layout_type">${LAYOUT_TYPES.map(l=>`<option value="${l}" ${s.layout_type===l?'selected':''}>${l}</option>`).join('')}</select></div>
              <div><label>Capacity</label><input name="capacity" type="number" value="${s.capacity}" min="1" max="500" required></div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">
              <div><label>Theme</label><select name="theme">${THEMES.map(t=>`<option value="${t}" ${s.theme===t?'selected':''}>${t}</option>`).join('')}</select></div>
              <div><label>Status</label><select name="status"><option value="active" ${s.status==='active'?'selected':''}>Active</option><option value="inactive" ${s.status==='inactive'?'selected':''}>Inactive</option><option value="maintenance" ${s.status==='maintenance'?'selected':''}>Maintenance</option></select></div>
            </div>
            <div style="margin-top:12px"><label>Scene URL</label><input name="scene_url" value="${esc(s.scene_url||'')}"></div>
            <div style="margin-top:12px"><label>Accessibility (JSON)</label><textarea name="accessibility_opts" rows="2">${esc(JSON.stringify(s.accessibility_opts||{}))}</textarea></div>
            <div style="margin-top:16px"><button class="btn" type="submit">Save Changes</button> <a class="btn" href="/school/metaverse-classroom/spaces/${s.id}" style="background:${GRAY}">Cancel</a></div>
          </form>
        </div>`;
      renderPage(req, res, 'Edit Space', html, SKIP, '/school/metaverse-classroom');
    } catch(e) { ah(e, req, res); }
  });

  app.post('/school/metaverse-classroom/spaces/:id/edit', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { name, description, layout_type, capacity, theme, status, scene_url, accessibility_opts } = req.body;
      let accOpts = {};
      try { accOpts = JSON.parse(accessibility_opts || '{}'); } catch(_) {}
      await pool.query(`UPDATE metaverse_spaces SET name=$1,description=$2,layout_type=$3,capacity=$4,theme=$5,status=$6,scene_url=$7,accessibility_opts=$8,updated_at=NOW() WHERE id=$9 AND tenant_id=$10`,
        [name, description, layout_type, parseInt(capacity)||30, theme, status, scene_url, JSON.stringify(accOpts), req.params.id, req.tenant_id]);
      audit(req, 'metaverse_space_updated', { id: req.params.id, name });
      req.flash('success', 'Space updated');
      res.redirect('/school/metaverse-classroom/spaces/' + req.params.id);
    } catch(e) { ah(e, req, res); }
  });

  /* ════════════════════════════════════════════════
     ROUTE 6 — Sessions List
     ════════════════════════════════════════════════ */
  app.get('/school/metaverse-classroom/sessions', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { status: st } = req.query;
      let sql = `SELECT s.*, sp.name AS space_name FROM metaverse_sessions s LEFT JOIN metaverse_spaces sp ON s.space_id=sp.id WHERE s.tenant_id=$1`;
      const params = [req.tenant_id];
      if (st) { sql += ` AND s.status=$2`; params.push(st); }
      sql += ' ORDER BY s.scheduled_at DESC NULLS LAST LIMIT 50';
      const result = await pool.query(sql, params);
      const html = `
        <div class="card"><h3 style="margin-top:0">Sessions</h3>
          <form method="get" style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
            <select name="status" style="width:150px"><option value="">All Status</option><option value="scheduled" ${st==='scheduled'?'selected':''}>Scheduled</option><option value="live" ${st==='live'?'selected':''}>Live</option><option value="completed" ${st==='completed'?'selected':''}>Completed</option><option value="cancelled" ${st==='cancelled'?'selected':''}>Cancelled</option></select>
            <button class="btn" type="submit">Filter</button>
            <a class="btn" href="/school/metaverse-classroom/sessions/new" style="background:#10b981;text-decoration:none">+ New Session</a>
          </form>
          <table><tr><th>Title</th><th>Space</th><th>Scheduled</th><th>Duration</th><th>Attendees</th><th>Status</th><th>Actions</th></tr>
          ${result.rows.map(s => `<tr><td>${esc(s.title)}</td><td>${esc(s.space_name||'—')}</td><td>${s.scheduled_at?new Date(s.scheduled_at).toLocaleString():'TBD'}</td><td>${s.duration_min}m</td><td>${(s.attendees||[]).length}</td><td><span style="color:${s.status==='live'?'#ef4444':s.status==='completed'?'#10b981':s.status==='scheduled'?'#f59e0b':GRAY}">${esc(s.status)}</span></td><td><a class="btn" href="/school/metaverse-classroom/sessions/${s.id}">View</a></td></tr>`).join('')}
          ${result.rows.length===0?'<tr><td colspan="7" style="text-align:center;color:'+GRAY+'">No sessions found</td></tr>':''}
          </table>
        </div>`;
      renderPage(req, res, 'Sessions', html, SKIP, '/school/metaverse-classroom');
    } catch(e) { ah(e, req, res); }
  });

  /* ════════════════════════════════════════════════
     ROUTE 7 — Create Session
     ════════════════════════════════════════════════ */
  app.get('/school/metaverse-classroom/sessions/new', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const spaces = await pool.query('SELECT id,name FROM metaverse_spaces WHERE tenant_id=$1 AND status=$2 ORDER BY name', [req.tenant_id, 'active']);
      const html = `
        <div class="card"><h3 style="margin-top:0">Schedule Session</h3>
          <form method="post" action="/school/metaverse-classroom/sessions/new">
            <div style="margin-bottom:12px"><label>Title *</label><input name="title" required placeholder="e.g. Quantum Physics Lecture"></div>
            <div style="margin-bottom:12px"><label>Description</label><textarea name="description" rows="3" placeholder="Session details..."></textarea></div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div><label>Virtual Space *</label><select name="space_id" required><option value="">Select space...</option>${spaces.rows.map(s=>`<option value="${s.id}" ${req.query.space_id==s.id?'selected':''}>${esc(s.name)}</option>`).join('')}</select></div>
              <div><label>Duration (min) *</label><input name="duration_min" type="number" value="60" min="5" required></div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">
              <div><label>Scheduled At</label><input name="scheduled_at" type="datetime-local"></div>
              <div><label>Enable Recording</label><select name="recording"><option value="yes">Yes</option><option value="no">No</option></select></div>
            </div>
            <div style="margin-top:12px"><label>Breakout Rooms (JSON array)</label><textarea name="breakout_rooms" rows="2" placeholder='[{"name":"Group A","capacity":5}]'></textarea></div>
            <div style="margin-top:12px"><label>Lab Equipment (JSON array)</label><textarea name="lab_equipment" rows="2" placeholder='[{"name":"Virtual Microscope","qty":10}]'></textarea></div>
            <div style="margin-top:16px"><button class="btn" type="submit">Schedule Session</button> <a class="btn" href="/school/metaverse-classroom/sessions" style="background:${GRAY}">Cancel</a></div>
          </form>
        </div>`;
      renderPage(req, res, 'New Session', html, SKIP, '/school/metaverse-classroom');
    } catch(e) { ah(e, req, res); }
  });

  app.post('/school/metaverse-classroom/sessions/new', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { title, description, space_id, duration_min, scheduled_at, recording, breakout_rooms, lab_equipment } = req.body;
      let br = [], le = [];
      try { br = JSON.parse(breakout_rooms || '[]'); } catch(_) {}
      try { le = JSON.parse(lab_equipment || '[]'); } catch(_) {}
      await pool.query(`INSERT INTO metaverse_sessions (tenant_id,space_id,title,description,scheduled_at,duration_min,breakout_rooms,lab_equipment,created_by,status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'scheduled')`,
        [req.tenant_id, parseInt(space_id), title, description, scheduled_at||null, parseInt(duration_min)||60, JSON.stringify(br), JSON.stringify(le), req.user_id]);
      audit(req, 'metaverse_session_created', { title, space_id });
      req.flash('success', 'Session scheduled');
      res.redirect('/school/metaverse-classroom/sessions');
    } catch(e) { ah(e, req, res); }
  });

  /* ════════════════════════════════════════════════
     ROUTE 8 — View Session Detail
     ════════════════════════════════════════════════ */
  app.get('/school/metaverse-classroom/sessions/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const sess = await pool.query(`SELECT s.*, sp.name AS space_name FROM metaverse_sessions s LEFT JOIN metaverse_spaces sp ON s.space_id=sp.id WHERE s.id=$1 AND s.tenant_id=$2`, [req.params.id, req.tenant_id]);
      if (!sess.rows[0]) return res.status(404).send('Session not found');
      const s = sess.rows[0];
      const att = await pool.query('SELECT a.*, u.name AS student_name FROM metaverse_attendance a LEFT JOIN users u ON a.student_id=u.id WHERE a.session_id=$1 AND a.tenant_id=$2', [s.id, req.tenant_id]);
      const wb = await pool.query('SELECT * FROM metaverse_whiteboards WHERE session_id=$1 AND tenant_id=$2', [s.id, req.tenant_id]);
      const html = `
        <div class="card"><h3 style="margin-top:0">${esc(s.title)}</h3>
          <p>${esc(s.description||'')}</p>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">
            <div><strong>Space:</strong> ${esc(s.space_name||'—')}</div>
            <div><strong>Scheduled:</strong> ${s.scheduled_at?new Date(s.scheduled_at).toLocaleString():'TBD'}</div>
            <div><strong>Duration:</strong> ${s.duration_min} min</div>
            <div><strong>Status:</strong> <span style="color:${s.status==='live'?'#ef4444':s.status==='completed'?'#10b981':'#f59e0b'}">${esc(s.status)}</span></div>
            <div><strong>Recording:</strong> ${s.recording_url?'<a href="'+esc(s.recording_url)+'" target="_blank">Watch</a>':'Not available'}</div>
            <div><strong>Attendees:</strong> ${(s.attendees||[]).length}</div>
          </div>
          <div style="margin-top:16px;display:flex;gap:8px">
            ${s.status==='scheduled'?`<form method="post" action="/school/metaverse-classroom/sessions/${s.id}/start"><button class="btn" style="background:#10b981">Start Session</button></form>`:''}
            ${s.status==='live'?`<form method="post" action="/school/metaverse-classroom/sessions/${s.id}/end"><button class="btn" style="background:#ef4444">End Session</button></form>`:''}
            <a class="btn" href="/school/metaverse-classroom/sessions/${s.id}/whiteboard" style="background:#8b5cf6">Whiteboard</a>
          </div>
        </div>
        ${s.breakout_rooms&&s.breakout_rooms.length?`<div class="card"><h3 style="margin-top:0">Breakout Rooms</h3>
          <table><tr><th>Name</th><th>Capacity</th><th>Participants</th></tr>
          ${s.breakout_rooms.map(b=>`<tr><td>${esc(b.name||'Room')}</td><td>${b.capacity||10}</td><td>${(b.participants||[]).length}</td></tr>`).join('')}
          </table></div>`:''}
        ${s.lab_equipment&&s.lab_equipment.length?`<div class="card"><h3 style="margin-top:0">Lab Equipment</h3>
          <table><tr><th>Equipment</th><th>Quantity</th></tr>
          ${s.lab_equipment.map(e=>`<tr><td>${esc(e.name)}</td><td>${e.qty||1}</td></tr>`).join('')}
          </table></div>`:''}
        <div class="card"><h3 style="margin-top:0">Attendance (${att.rows.length})</h3>
          <table><tr><th>Student</th><th>Joined</th><th>Left</th><th>Duration</th><th>Engagement</th><th>Status</th></tr>
          ${att.rows.map(a=>`<tr><td>${esc(a.student_name||'ID:'+a.student_id)}</td><td>${a.join_time?new Date(a.join_time).toLocaleTimeString():'—'}</td><td>${a.leave_time?new Date(a.leave_time).toLocaleTimeString():'—'}</td><td>${a.duration_min}m</td><td>${a.engagement_score}%</td><td>${esc(a.status)}</td></tr>`).join('')}
          ${att.rows.length===0?'<tr><td colspan="6" style="text-align:center;color:'+GRAY+'">No attendance records</td></tr>':''}
          </table>
        </div>`;
      renderPage(req, res, s.title, html, SKIP, '/school/metaverse-classroom');
    } catch(e) { ah(e, req, res); }
  });

  /* ════════════════════════════════════════════════
     ROUTE 9 — Start / End Session
     ════════════════════════════════════════════════ */
  app.post('/school/metaverse-classroom/sessions/:id/start', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const r = await pool.query('UPDATE metaverse_sessions SET status=$1,updated_at=NOW() WHERE id=$2 AND tenant_id=$3 AND status=$4 RETURNING *', ['live', req.params.id, req.tenant_id, 'scheduled']);
      if (!r.rows[0]) { req.flash('error','Cannot start this session'); return res.redirect('back'); }
      audit(req, 'metaverse_session_started', { id: req.params.id });
      req.flash('success', 'Session is now live!');
      res.redirect('/school/metaverse-classroom/sessions/' + req.params.id);
    } catch(e) { ah(e, req, res); }
  });

  app.post('/school/metaverse-classroom/sessions/:id/end', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const r = await pool.query('UPDATE metaverse_sessions SET status=$1,updated_at=NOW() WHERE id=$2 AND tenant_id=$3 AND status=$4 RETURNING *', ['completed', req.params.id, req.tenant_id, 'live']);
      if (!r.rows[0]) { req.flash('error','Cannot end this session'); return res.redirect('back'); }
      await pool.query('UPDATE metaverse_attendance SET leave_time=NOW(), status=$1 WHERE session_id=$2 AND tenant_id=$3 AND leave_time IS NULL', ['completed', req.params.id, req.tenant_id]);
      audit(req, 'metaverse_session_ended', { id: req.params.id });
      req.flash('success', 'Session ended');
      res.redirect('/school/metaverse-classroom/sessions/' + req.params.id);
    } catch(e) { ah(e, req, res); }
  });

  /* ════════════════════════════════════════════════
     ROUTE 10 — Whiteboard
     ════════════════════════════════════════════════ */
  app.get('/school/metaverse-classroom/sessions/:id/whiteboard', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const sess = await pool.query('SELECT id,title FROM metaverse_sessions WHERE id=$1 AND tenant_id=$2', [req.params.id, req.tenant_id]);
      if (!sess.rows[0]) return res.status(404).send('Not found');
      const wb = await pool.query('SELECT * FROM metaverse_whiteboards WHERE session_id=$1 AND tenant_id=$2 ORDER BY created_at', [req.params.id, req.tenant_id]);
      const html = `
        <div class="card"><h3 style="margin-top:0">Whiteboards — ${esc(sess.rows[0].title)}</h3>
          <form method="post" action="/school/metaverse-classroom/sessions/${req.params.id}/whiteboard" style="margin-bottom:16px">
            <div style="display:flex;gap:8px"><input name="title" placeholder="Whiteboard title..." required style="width:300px">
            <button class="btn" type="submit">Create Whiteboard</button></div>
          </form>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:16px">
            ${wb.rows.map(w=>`<div class="card" style="text-align:center"><h4>${esc(w.title||'Untitled')}</h4><p style="color:${GRAY};font-size:0.9em">Pages: ${(w.pages||[]).length} | ${w.locked?'🔒 Locked':'🔓 Open'}</p><a class="btn" href="/school/metaverse-classroom/whiteboard/${w.id}">Open</a></div>`).join('')}
            ${wb.rows.length===0?'<p style="color:'+GRAY+';grid-column:1/-1;text-align:center">No whiteboards yet. Create one above.</p>':''}
          </div>
        </div>`;
      renderPage(req, res, 'Whiteboards', html, SKIP, '/school/metaverse-classroom');
    } catch(e) { ah(e, req, res); }
  });

  app.post('/school/metaverse-classroom/sessions/:id/whiteboard', requireAuth, requireNotBanned, async (req, res) => {
    try {
      await pool.query(`INSERT INTO metaverse_whiteboards (tenant_id,session_id,title,owner_id) VALUES ($1,$2,$3,$4)`, [req.tenant_id, req.params.id, req.body.title, req.user_id]);
      audit(req, 'whiteboard_created', { session_id: req.params.id });
      req.flash('success', 'Whiteboard created');
      res.redirect('/school/metaverse-classroom/sessions/' + req.params.id + '/whiteboard');
    } catch(e) { ah(e, req, res); }
  });

  /* ════════════════════════════════════════════════
     ROUTE 11 — Avatar Profile Management
     ════════════════════════════════════════════════ */
  app.get('/school/metaverse-classroom/avatars', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const isStudent = req.user_role === 'student';
      let avatars;
      if (isStudent) {
        avatars = await pool.query('SELECT * FROM avatar_profiles WHERE tenant_id=$1 AND student_id=$2 ORDER BY last_active DESC', [req.tenant_id, req.user_id]);
      } else {
        avatars = await pool.query('SELECT a.*, u.name AS student_name FROM avatar_profiles a LEFT JOIN users u ON a.student_id=u.id WHERE a.tenant_id=$1 ORDER BY a.last_active DESC LIMIT 50', [req.tenant_id]);
      }
      const html = `
        <div class="card"><h3 style="margin-top:0">Avatar Profiles</h3>
          <a class="btn" href="/school/metaverse-classroom/avatars/new" style="background:#10b981;display:inline-block;margin-bottom:16px">+ Create Avatar</a>
          <table><tr><th>Name</th><th>Appearance</th><th>Accessories</th><th>Mood</th><th>Last Active</th><th>Actions</th></tr>
          ${avatars.rows.map(a => {
            const appearance = a.appearance || {};
            const accessories = a.accessories || [];
            return `<tr><td>${esc(a.display_name)}</td><td>${esc(appearance.bodyType||'default')}/${esc(appearance.skinTone||'default')}</td><td>${accessories.length} items</td><td>${esc(a.mood||'neutral')}</td><td>${new Date(a.last_active).toLocaleDateString()}</td><td><a class="btn" href="/school/metaverse-classroom/avatars/${a.id}/edit">Edit</a></td></tr>`;
          }).join('')}
          ${avatars.rows.length===0?'<tr><td colspan="6" style="text-align:center;color:'+GRAY+'">No avatars yet</td></tr>':''}
          </table>
        </div>`;
      renderPage(req, res, 'Avatar Profiles', html, SKIP, '/school/metaverse-classroom');
    } catch(e) { ah(e, req, res); }
  });

  app.get('/school/metaverse-classroom/avatars/new', requireAuth, requireNotBanned, (req, res) => {
    const html = `
      <div class="card"><h3 style="margin-top:0">Create Avatar</h3>
        <form method="post" action="/school/metaverse-classroom/avatars/new">
          <div style="margin-bottom:12px"><label>Display Name *</label><input name="display_name" required placeholder="Your avatar name"></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div><label>Body Type</label><select name="body_type"><option value="standard">Standard</option><option value="slim">Slim</option><option value="athletic">Athletic</option><option value="custom">Custom</option></select></div>
            <div><label>Skin Tone</label><select name="skin_tone"><option value="light">Light</option><option value="medium">Medium</option><option value="dark">Dark</option><option value="custom">Custom</option></select></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">
            <div><label>Hair Style</label><input name="hair_style" placeholder="e.g. short, long, curly"></div>
            <div><label>Hair Color</label><input name="hair_color" placeholder="e.g. #333333"></div>
          </div>
          <div style="margin-top:12px"><label>Accessories (JSON array)</label><textarea name="accessories" rows="2" placeholder='["glasses","backpack","headphones"]'></textarea></div>
          <div style="margin-top:12px"><label>Custom Colors (JSON)</label><textarea name="custom_colors" rows="2" placeholder='{"shirt":"#4f46e5","pants":"#1f2937"}'></textarea></div>
          <div style="margin-top:12px"><label>Mood</label><select name="mood"><option value="neutral">Neutral</option><option value="happy">Happy</option><option value="focused">Focused</option><option value="creative">Creative</option><option value="energetic">Energetic</option></select></div>
          <div style="margin-top:16px"><button class="btn" type="submit">Create Avatar</button> <a class="btn" href="/school/metaverse-classroom/avatars" style="background:${GRAY}">Cancel</a></div>
        </form>
      </div>`;
    renderPage(req, res, 'New Avatar', html, SKIP, '/school/metaverse-classroom');
  });

  app.post('/school/metaverse-classroom/avatars/new', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { display_name, body_type, skin_tone, hair_style, hair_color, accessories, custom_colors, mood } = req.body;
      let acc = [], cc = {};
      try { acc = JSON.parse(accessories || '[]'); } catch(_) {}
      try { cc = JSON.parse(custom_colors || '{}'); } catch(_) {}
      const appearance = { bodyType: body_type, skinTone: skin_tone, hairStyle: hair_style, hairColor: hair_color };
      await pool.query(`INSERT INTO avatar_profiles (tenant_id,student_id,display_name,appearance,accessories,custom_colors,mood)
        VALUES ($1,$2,$3,$4,$5,$6,$7)`, [req.tenant_id, req.user_id, display_name, JSON.stringify(appearance), JSON.stringify(acc), JSON.stringify(cc), mood]);
      audit(req, 'avatar_created', { display_name });
      req.flash('success', 'Avatar created');
      res.redirect('/school/metaverse-classroom/avatars');
    } catch(e) { ah(e, req, res); }
  });

  /* ════════════════════════════════════════════════
     ROUTE 12 — VR Attendance Check-in
     ════════════════════════════════════════════════ */
  app.post('/school/metaverse-classroom/sessions/:id/checkin', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const sess = await pool.query('SELECT id,status FROM metaverse_sessions WHERE id=$1 AND tenant_id=$2', [req.params.id, req.tenant_id]);
      if (!sess.rows[0] || sess.rows[0].status !== 'live') {
        return res.json({ ok: false, error: 'Session is not live' });
      }
      const existing = await pool.query('SELECT id FROM metaverse_attendance WHERE session_id=$1 AND student_id=$2 AND tenant_id=$3', [req.params.id, req.user_id, req.tenant_id]);
      if (existing.rows.length > 0) {
        return res.json({ ok: true, msg: 'Already checked in' });
      }
      await pool.query(`INSERT INTO metaverse_attendance (tenant_id,session_id,student_id,join_time,avatar_used,engagement_score,status,verified)
        VALUES ($1,$2,$3,NOW(),$4,0,'present',true)`, [req.tenant_id, req.params.id, req.user_id, req.body.avatar_id || null]);
      await pool.query(`UPDATE metaverse_sessions SET attendees = attendees || $1::jsonb WHERE id=$2 AND tenant_id=$3`, [JSON.stringify(req.user_id), req.params.id, req.tenant_id]);
      audit(req, 'vr_checkin', { session_id: req.params.id });
      res.json({ ok: true, msg: 'Checked in successfully' });
    } catch(e) { ah(e, req, res, true); }
  });

  app.post('/school/metaverse-classroom/sessions/:id/checkout', requireAuth, requireNotBanned, async (req, res) => {
    try {
      await pool.query(`UPDATE metaverse_attendance SET leave_time=NOW(), duration_min=EXTRACT(EPOCH FROM(NOW()-join_time))/60, status=$1 WHERE session_id=$2 AND student_id=$3 AND tenant_id=$4 AND leave_time IS NULL`,
        ['completed', req.params.id, req.user_id, req.tenant_id]);
      audit(req, 'vr_checkout', { session_id: req.params.id });
      res.json({ ok: true, msg: 'Checked out' });
    } catch(e) { ah(e, req, res, true); }
  });

  /* ════════════════════════════════════════════════
     ROUTE 13 — Attendance Reports
     ════════════════════════════════════════════════ */
  app.get('/school/metaverse-classroom/attendance', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { from, to, session_id } = req.query;
      let sql = `SELECT a.*, s.title AS session_title, u.name AS student_name FROM metaverse_attendance a
        JOIN metaverse_sessions s ON a.session_id=s.id LEFT JOIN users u ON a.student_id=u.id WHERE a.tenant_id=$1`;
      const params = [req.tenant_id];
      let i = 2;
      if (from) { sql += ` AND a.join_time >= $${i++}`; params.push(from); }
      if (to) { sql += ` AND a.join_time <= $${i++}`; params.push(to); }
      if (session_id) { sql += ` AND a.session_id = $${i++}`; params.push(session_id); }
      sql += ' ORDER BY a.join_time DESC LIMIT 100';
      const result = await pool.query(sql, params);
      const html = `
        <div class="card"><h3 style="margin-top:0">VR Attendance Report</h3>
          <form method="get" style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
            <input name="from" type="date" value="${esc(from||'')}" style="width:150px">
            <input name="to" type="date" value="${esc(to||'')}" style="width:150px">
            <input name="session_id" placeholder="Session ID" value="${esc(session_id||'')}" style="width:120px">
            <button class="btn" type="submit">Filter</button>
          </form>
          <table><tr><th>Student</th><th>Session</th><th>Joined</th><th>Left</th><th>Duration</th><th>Engagement</th><th>Verified</th></tr>
          ${result.rows.map(a=>`<tr><td>${esc(a.student_name||'ID:'+a.student_id)}</td><td>${esc(a.session_title)}</td><td>${a.join_time?new Date(a.join_time).toLocaleString():'—'}</td><td>${a.leave_time?new Date(a.leave_time).toLocaleString():'—'}</td><td>${Math.round(a.duration_min)}m</td><td>${a.engagement_score}%</td><td>${a.verified?'✅':'❌'}</td></tr>`).join('')}
          ${result.rows.length===0?'<tr><td colspan="7" style="text-align:center;color:'+GRAY+'">No records found</td></tr>':''}
          </table>
        </div>`;
      renderPage(req, res, 'VR Attendance', html, SKIP, '/school/metaverse-classroom');
    } catch(e) { ah(e, req, res); }
  });

  /* ════════════════════════════════════════════════
     ROUTE 14 — Accessibility Settings
     ════════════════════════════════════════════════ */
  app.get('/school/metaverse-classroom/accessibility', requireAuth, requireNotBanned, (req, res) => {
    const html = `
      <div class="card"><h3 style="margin-top:0">Accessibility Settings</h3>
        <p style="color:${GRAY};margin-bottom:16px">Configure accessibility features for virtual classroom environments.</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div class="card"><h4>Screen Reader Support</h4><p>Full NVDA/JAWS compatibility for 3D navigation</p><label style="display:flex;align-items:center;gap:8px"><input type="checkbox" checked> Enable screen reader descriptions</label></div>
          <div class="card"><h4>Closed Captions</h4><p>Real-time captions for immersive lectures</p><label style="display:flex;align-items:center;gap:8px"><input type="checkbox" checked> Enable auto-captions</label></div>
          <div class="card"><h4>Color Blind Mode</h4><p>Adjust colors for daltonism accessibility</p><select style="margin-top:8px"><option>Normal</option><option>Protanopia</option><option>Deuteranopia</option><option>Tritanopia</option></select></div>
          <div class="card"><h4>Motion Sensitivity</h4><p>Reduce motion for vestibular comfort</p><label style="display:flex;align-items:center;gap:8px"><input type="checkbox"> Reduce motion effects</label></div>
          <div class="card"><h4>Keyboard Navigation</h4><p>Full keyboard control of 3D environments</p><label style="display:flex;align-items:center;gap:8px"><input type="checkbox" checked> Enhanced keyboard nav</label></div>
          <div class="card"><h4>Text-to-Speech</h4><p>Read out virtual whiteboard content aloud</p><label style="display:flex;align-items:center;gap:8px"><input type="checkbox"> Enable TTS for whiteboard</label></div>
        </div>
      </div>`;
    renderPage(req, res, 'Accessibility', html, SKIP, '/school/metaverse-classroom');
  });

  /* ════════════════════════════════════════════════
     ROUTE 15 — API: List spaces (JSON)
     ════════════════════════════════════════════════ */
  app.get('/school/metaverse-classroom/api/spaces', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const result = await pool.query('SELECT id,name,layout_type,capacity,theme,status FROM metaverse_spaces WHERE tenant_id=$1 ORDER BY name', [req.tenant_id]);
      res.json({ ok: true, spaces: result.rows });
    } catch(e) { ah(e, req, res, true); }
  });

  app.get('/school/metaverse-classroom/api/sessions', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const result = await pool.query(`SELECT id,title,scheduled_at,duration_min,status,space_id FROM metaverse_sessions WHERE tenant_id=$1 ORDER BY scheduled_at DESC NULLS LAST LIMIT 50`, [req.tenant_id]);
      res.json({ ok: true, sessions: result.rows });
    } catch(e) { ah(e, req, res, true); }
  });
};
