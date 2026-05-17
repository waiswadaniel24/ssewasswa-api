module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5', GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.btn:hover{background:#3730a3}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}</style>';

  (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS plays (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        title VARCHAR(255) NOT NULL,
        author VARCHAR(255),
        genre VARCHAR(100),
        description TEXT,
        status VARCHAR(50) DEFAULT 'planning',
        director_id INTEGER,
        audition_date DATE,
        performance_date DATE,
        created_at TIMESTAMP DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS cast_crew (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        play_id INTEGER NOT NULL,
        student_id INTEGER NOT NULL,
        role VARCHAR(255),
        department VARCHAR(100),
        status VARCHAR(50) DEFAULT 'assigned'
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS rehearsals (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        play_id INTEGER NOT NULL,
        date DATE,
        time TIME,
        venue VARCHAR(255),
        scene_focus VARCHAR(255),
        notes TEXT,
        status VARCHAR(50) DEFAULT 'scheduled'
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS scripts (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        title VARCHAR(255) NOT NULL,
        content TEXT,
        genre VARCHAR(100),
        author VARCHAR(255),
        category VARCHAR(100),
        created_at TIMESTAMP DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS costumes (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        play_id INTEGER,
        name VARCHAR(255) NOT NULL,
        size VARCHAR(50),
        condition VARCHAR(50) DEFAULT 'good',
        assigned_to INTEGER,
        notes TEXT
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS props (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        play_id INTEGER,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        quantity INTEGER DEFAULT 1,
        status VARCHAR(50) DEFAULT 'available',
        storage_location VARCHAR(255)
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS drama_tickets (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        play_id INTEGER NOT NULL,
        buyer_name VARCHAR(255),
        buyer_email VARCHAR(255),
        performance_date DATE,
        ticket_type VARCHAR(50) DEFAULT 'general',
        quantity INTEGER DEFAULT 1,
        total_price NUMERIC(10,2) DEFAULT 0,
        status VARCHAR(50) DEFAULT 'confirmed'
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS drama_workshops (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        title VARCHAR(255) NOT NULL,
        instructor VARCHAR(255),
        date DATE,
        time TIME,
        venue VARCHAR(255),
        max_participants INTEGER DEFAULT 20,
        description TEXT,
        status VARCHAR(50) DEFAULT 'upcoming'
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS auditions (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        play_id INTEGER NOT NULL,
        student_id INTEGER NOT NULL,
        role_applied VARCHAR(255),
        audition_date DATE,
        status VARCHAR(50) DEFAULT 'pending',
        feedback TEXT
      )`);
      console.log('[DramaClub] Tables ready');
    } catch(e) { console.warn('[DramaClub] Migration warning:', e.message); }
  })();

  const BASE = '/school/drama-club';
  const GENRES = ['Comedy','Tragedy','Drama','Musical','Mystery','Fantasy','Historical','Experimental','One-Act','Improv'];
  const DEPARTMENTS = ['Acting','Directing','Stage Management','Lighting','Sound','Set Design','Costumes','Props','Makeup','Front of House'];
  const STATUSES = ['planning','auditions','rehearsals','tech-week','performing','completed','archived'];

  function page(title, body) {
    return renderPage(title, SKIP + `<div style="max-width:1200px;margin:0 auto;padding:20px">${body}</div>`);
  }

  function nav(active) {
    const links = [
      ['Dashboard', BASE], ['Plays', BASE+'/plays'], ['Cast & Crew', BASE+'/cast-crew'],
      ['Rehearsals', BASE+'/rehearsals'], ['Scripts', BASE+'/scripts'],
      ['Costumes', BASE+'/costumes'], ['Props', BASE+'/props'],
      ['Ticketing', BASE+'/ticketing'], ['Workshops', BASE+'/workshops'], ['Auditions', BASE+'/auditions']
    ];
    let h = '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:20px;padding:12px;background:#f9fafb;border-radius:10px">';
    links.forEach(([l, u]) => { h += `<a href="${u}" style="padding:6px 12px;border-radius:6px;text-decoration:none;font-size:13px;${u===active?'background:'+P+';color:#fff':'background:#fff;color:'+GRAY+';border:1px solid #e5e7eb'}">${l}</a>`; });
    return h + '</div>';
  }

  // ---------- Dashboard ----------
  app.get(BASE, requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [plays, cast, rehearsals, scripts, costumes, props, tickets, workshops] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS c FROM plays WHERE tenant_id=$1', [tid]),
      pool.query('SELECT COUNT(*)::int AS c FROM cast_crew WHERE tenant_id=$1', [tid]),
      pool.query("SELECT COUNT(*)::int AS c FROM rehearsals WHERE tenant_id=$1 AND status='scheduled'", [tid]),
      pool.query('SELECT COUNT(*)::int AS c FROM scripts WHERE tenant_id=$1', [tid]),
      pool.query('SELECT COUNT(*)::int AS c FROM costumes WHERE tenant_id=$1', [tid]),
      pool.query('SELECT COUNT(*)::int AS c FROM props WHERE tenant_id=$1', [tid]),
      pool.query("SELECT COALESCE(SUM(quantity),0)::int AS c FROM drama_tickets WHERE tenant_id=$1 AND status='confirmed'", [tid]),
      pool.query("SELECT COUNT(*)::int AS c FROM drama_workshops WHERE tenant_id=$1 AND status='upcoming'", [tid])
    ]);
    const upcomingRehearsals = await pool.query("SELECT r.*, p.title AS play_title FROM rehearsals r JOIN plays p ON p.id=r.play_id WHERE r.tenant_id=$1 AND r.date >= CURRENT_DATE ORDER BY r.date ASC LIMIT 5", [tid]);
    const activePlays = await pool.query("SELECT p.*, u.name AS director_name FROM plays p LEFT JOIN users u ON u.id=p.director_id WHERE p.tenant_id=$1 AND p.status NOT IN ('completed','archived') ORDER BY p.created_at DESC", [tid]);
    const stats = [
      { label: 'Active Plays', value: plays.rows[0].c, icon: '🎭', color: P },
      { label: 'Cast & Crew', value: cast.rows[0].c, icon: '👥', color: '#059669' },
      { label: 'Upcoming Rehearsals', value: rehearsals.rows[0].c, icon: '📋', color: '#d97706' },
      { label: 'Scripts', value: scripts.rows[0].c, icon: '📜', color: '#7c3aed' },
      { label: 'Costumes', value: costumes.rows[0].c, icon: '👔', color: '#dc2626' },
      { label: 'Props', value: props.rows[0].c, icon: '🔑', color: '#0891b2' },
      { label: 'Tickets Sold', value: tickets.rows[0].c, icon: '🎫', color: '#be185d' },
      { label: 'Upcoming Workshops', value: workshops.rows[0].c, icon: '🎓', color: '#4338ca' }
    ];
    let html = nav(BASE) + '<h1 style="font-size:24px;margin-bottom:20px">🎭 Drama Club Dashboard</h1>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:24px">';
    stats.forEach(s => {
      html += `<div class="card" style="text-align:center;border-top:3px solid ${s.color}"><div style="font-size:24px">${s.icon}</div><div style="font-size:22px;font-weight:700;color:${s.color}">${s.value}</div><div style="font-size:11px;color:${GRAY}">${s.label}</div></div>`;
    });
    html += '</div>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">';
    html += '<div class="card"><h2 style="margin-bottom:12px">🎭 Active Productions</h2>';
    if (activePlays.rows.length === 0) {
      html += '<p style="color:'+GRAY+';font-size:13px">No active productions.</p>';
    } else {
      activePlays.rows.forEach(p => {
        const sc = p.status==='rehearsals'?'#d97706':p.status==='performing'?'#059669':'#2563eb';
        html += `<div style="padding:8px 0;border-bottom:1px solid #f3f4f6;display:flex;justify-content:space-between;align-items:center"><div><strong>${esc(p.title)}</strong><div style="font-size:12px;color:${GRAY}">Dir: ${esc(p.director_name||'TBD')} · ${esc(p.genre||'')}</div></div><span style="padding:2px 10px;border-radius:12px;font-size:11px;background:${sc}22;color:${sc}">${esc(p.status)}</span></div>`;
      });
    }
    html += '</div>';
    html += '<div class="card"><h2 style="margin-bottom:12px">📋 Upcoming Rehearsals</h2>';
    if (upcomingRehearsals.rows.length === 0) {
      html += '<p style="color:'+GRAY+';font-size:13px">No upcoming rehearsals.</p>';
    } else {
      upcomingRehearsals.rows.forEach(r => {
        html += `<div style="padding:6px 0;border-bottom:1px solid #f3f4f6"><strong>${esc(r.play_title)}</strong><div style="font-size:12px;color:${GRAY}">${r.date?r.date.toISOString().split('T')[0]:''} ${r.time||''} · ${esc(r.venue||'TBD')} · ${esc(r.scene_focus||'')}</div></div>`;
      });
    }
    html += '</div></div>';
    res.send(page('Drama Club', html));
  }));

  // ---------- Plays ----------
  app.get(BASE+'/plays', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { rows } = await pool.query('SELECT p.*, u.name AS director_name FROM plays p LEFT JOIN users u ON u.id=p.director_id WHERE p.tenant_id=$1 ORDER BY p.created_at DESC', [tid]);
    let html = nav(BASE+'/plays') + '<h1 style="font-size:24px;margin-bottom:20px">🎭 Play Productions</h1>';
    html += '<a href="'+BASE+'/create-play" class="btn" style="display:inline-block;margin-bottom:16px;background:#059669">+ New Production</a>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px">';
    rows.forEach(p => {
      const sc = STATUSES.includes(p.status)?p.status:'planning';
      const statusColors = {planning:'#6b7280',auditions:'#d97706',rehearsals:'#2563eb','tech-week':'#7c3aed',performing:'#059669',completed:'#059669',archived:'#9ca3af'};
      const col = statusColors[sc]||'#6b7280';
      html += `<div class="card" style="border-left:4px solid ${col}">
        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px"><h3 style="font-size:16px">${esc(p.title)}</h3><span style="padding:2px 10px;border-radius:12px;font-size:11px;font-weight:600;background:${col}22;color:${col}">${esc(p.status)}</span></div>
        <p style="font-size:12px;color:${GRAY}">by ${esc(p.author||'Unknown')} · ${esc(p.genre||'N/A')}</p>
        <p style="font-size:12px;color:${GRAY}">Director: ${esc(p.director_name||'TBD')}</p>
        ${p.audition_date?'<p style="font-size:11px;color:#d97706;margin-top:4px">Auditions: '+p.audition_date.toISOString().split('T')[0]+'</p>':''}
        ${p.performance_date?'<p style="font-size:11px;color:#059669">Performance: '+p.performance_date.toISOString().split('T')[0]+'</p>':''}
        <div style="margin-top:8px;display:flex;gap:8px"><a href="${BASE}/edit-play/${p.id}" class="btn" style="padding:4px 10px;font-size:12px">Edit</a><a href="${BASE+'/cast-crew?play_id='+p.id}" class="btn" style="padding:4px 10px;font-size:12px;background:#6b7280">Cast</a></div>
      </div>`;
    });
    html += '</div>';
    res.send(page('Play Productions', html));
  }));

  app.get(BASE+'/create-play', requireAuth, requireNotBanned, ah(async (req, res) => {
    let html = nav(BASE+'/plays') + '<h1 style="font-size:24px;margin-bottom:20px">🎭 New Production</h1>';
    html += '<div class="card"><form method="post" action="'+BASE+'/create-play"><div style="display:grid;gap:16px">';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Play Title *</label><input name="title" required placeholder="e.g. A Midsummer Night\'s Dream"></div>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Author</label><input name="author" placeholder="Playwright"></div><div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Genre</label><select name="genre"><option value="">Select</option>';
    GENRES.forEach(g => { html += `<option value="${g}">${g}</option>`; });
    html += '</select></div></div>';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Description</label><textarea name="description" rows="3" placeholder="Brief synopsis"></textarea></div>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Audition Date</label><input type="date" name="audition_date"></div><div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Performance Date</label><input type="date" name="performance_date"></div></div>';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Status</label><select name="status">';
    STATUSES.forEach(s => { html += `<option value="${s}" ${s==='planning'?'selected':''}>${s.replace(/-/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}</option>`; });
    html += '</select></div>';
    html += '<button type="submit" class="btn">Create Production</button></div></form></div>';
    res.send(page('New Production', html));
  }));

  app.post(BASE+'/create-play', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { title, author, genre, description, audition_date, performance_date, status } = req.body;
    await pool.query('INSERT INTO plays (tenant_id,title,author,genre,description,director_id,audition_date,performance_date,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [tid, title, author, genre, description, req.session.user.id, audition_date || null, performance_date || null, status || 'planning']);
    audit(req, 'play_create', 'Created production: ' + title);
    res.redirect(BASE + '/plays');
  }));

  app.get(BASE+'/edit-play/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM plays WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
    if (!rows.length) return res.status(404).send(page('Not Found', '<p>Play not found.</p>'));
    const p = rows[0];
    let html = nav(BASE+'/plays') + '<h1 style="font-size:24px;margin-bottom:20px">✏️ Edit Production</h1>';
    html += '<div class="card"><form method="post" action="'+BASE+'/edit-play/'+p.id+'"><div style="display:grid;gap:16px">';
    html += `<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Title *</label><input name="title" value="${esc(p.title)}" required></div>`;
    html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Author</label><input name="author" value="${esc(p.author||'')}"></div><div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Genre</label><select name="genre"><option value="">Select</option>`;
    GENRES.forEach(g => { html += `<option value="${g}" ${p.genre===g?'selected':''}>${g}</option>`; });
    html += '</select></div></div>';
    html += `<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Description</label><textarea name="description" rows="3">${esc(p.description||'')}</textarea></div>`;
    html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Audition Date</label><input type="date" name="audition_date" value="${p.audition_date?p.audition_date.toISOString().split('T')[0]:''}"></div><div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Performance Date</label><input type="date" name="performance_date" value="${p.performance_date?p.performance_date.toISOString().split('T')[0]:''}"></div></div>`;
    html += `<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Status</label><select name="status">`;
    STATUSES.forEach(s => { html += `<option value="${s}" ${p.status===s?'selected':''}>${s.replace(/-/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}</option>`; });
    html += '</select></div>';
    html += '<div style="display:flex;gap:12px"><button type="submit" class="btn">Save</button><a href="'+BASE+'/plays" class="btn" style="background:'+GRAY+'">Cancel</a></div>';
    html += '</div></form></div>';
    res.send(page('Edit Production', html));
  }));

  app.post(BASE+'/edit-play/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { title, author, genre, description, audition_date, performance_date, status } = req.body;
    await pool.query('UPDATE plays SET title=$1,author=$2,genre=$3,description=$4,audition_date=$5,performance_date=$6,status=$7 WHERE id=$8 AND tenant_id=$9',
      [title, author, genre, description, audition_date || null, performance_date || null, status, req.params.id, tid]);
    audit(req, 'play_edit', 'Edited production: ' + title);
    res.redirect(BASE + '/plays');
  }));

  app.post(BASE+'/delete-play/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query('DELETE FROM plays WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    audit(req, 'play_delete', 'Deleted play #' + req.params.id);
    res.redirect(BASE + '/plays');
  }));

  // ---------- Cast & Crew ----------
  app.get(BASE+'/cast-crew', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const playId = req.query.play_id || '';
    let q = 'SELECT cc.*, p.title AS play_title, u.name AS student_name FROM cast_crew cc JOIN plays p ON p.id=cc.play_id LEFT JOIN users u ON u.id=cc.student_id WHERE cc.tenant_id=$1';
    const params = [tid];
    if (playId) { q += ' AND cc.play_id=$2'; params.push(playId); }
    q += ' ORDER BY cc.department, cc.role';
    const { rows } = await pool.query(q, params);
    const plays = await pool.query('SELECT id, title FROM plays WHERE tenant_id=$1 ORDER BY title', [tid]);
    let html = nav(BASE+'/cast-crew') + '<h1 style="font-size:24px;margin-bottom:20px">👥 Cast & Crew</h1>';
    html += '<div style="display:flex;gap:12px;margin-bottom:16px;align-items:center">';
    html += '<a href="'+BASE+'/add-cast-crew" class="btn" style="background:#059669">+ Add Member</a>';
    html += '<form method="get" style="display:flex;gap:8px"><select name="play_id" style="width:auto;padding:6px 10px;border-radius:8px;border:1px solid #d1d5db"><option value="">All Plays</option>';
    plays.rows.forEach(p => { html += `<option value="${p.id}" ${playId==p.id?'selected':''}>${esc(p.title)}</option>`; });
    html += '</select><button class="btn" type="submit" style="padding:6px 12px">Filter</button></form></div>';
    html += '<div class="card"><table><thead><tr><th>Play</th><th>Member</th><th>Role</th><th>Department</th><th>Status</th><th>Actions</th></tr></thead><tbody>';
    rows.forEach(cc => {
      const deptColor = cc.department==='Acting'?'#dc2626':cc.department==='Directing'?'#7c3aed':cc.department==='Lighting'?'#d97706':'#2563eb';
      html += `<tr><td>${esc(cc.play_title)}</td><td>${esc(cc.student_name||'N/A')}</td><td>${esc(cc.role||'-')}</td><td><span style="color:${deptColor};font-weight:600">${esc(cc.department||'-')}</span></td><td>${esc(cc.status)}</td><td><a href="${BASE}/edit-cast-crew/${cc.id}" class="btn" style="padding:4px 10px;font-size:12px">Edit</a></td></tr>`;
    });
    html += '</tbody></table></div>';
    res.send(page('Cast & Crew', html));
  }));

  app.get(BASE+'/add-cast-crew', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const plays = await pool.query('SELECT id, title FROM plays WHERE tenant_id=$1 ORDER BY title', [tid]);
    let html = nav(BASE+'/cast-crew') + '<h1 style="font-size:24px;margin-bottom:20px">👥 Add Cast/Crew Member</h1>';
    html += '<div class="card"><form method="post" action="'+BASE+'/add-cast-crew"><div style="display:grid;gap:16px;max-width:500px">';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Play *</label><select name="play_id" required><option value="">Select play</option>';
    plays.rows.forEach(p => { html += `<option value="${p.id}">${esc(p.title)}</option>`; });
    html += '</select></div>';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Student ID *</label><input name="student_id" type="number" required placeholder="Student user ID"></div>';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Role</label><input name="role" placeholder="e.g. Hamlet, Stage Manager"></div>';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Department</label><select name="department"><option value="">Select</option>';
    DEPARTMENTS.forEach(d => { html += `<option value="${d}">${d}</option>`; });
    html += '</select></div>';
    html += '<button type="submit" class="btn">Add Member</button></div></form></div>';
    res.send(page('Add Cast/Crew', html));
  }));

  app.post(BASE+'/add-cast-crew', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { play_id, student_id, role, department } = req.body;
    if (!play_id || !student_id) return res.redirect(BASE + '/add-cast-crew');
    await pool.query('INSERT INTO cast_crew (tenant_id,play_id,student_id,role,department) VALUES ($1,$2,$3,$4,$5)',
      [tid, play_id, student_id, role, department]);
    audit(req, 'cast_add', 'Added cast/crew member to play #' + play_id);
    res.redirect(BASE + '/cast-crew');
  }));

  app.get(BASE+'/edit-cast-crew/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM cast_crew WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
    if (!rows.length) return res.status(404).send(page('Not Found', '<p>Record not found.</p>'));
    const cc = rows[0];
    let html = nav(BASE+'/cast-crew') + '<h1 style="font-size:24px;margin-bottom:20px">✏️ Edit Cast/Crew</h1>';
    html += '<div class="card"><form method="post" action="'+BASE+'/edit-cast-crew/'+cc.id+'"><div style="display:grid;gap:16px;max-width:500px">';
    html += `<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Student ID</label><input name="student_id" type="number" value="${cc.student_id}"></div>`;
    html += `<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Role</label><input name="role" value="${esc(cc.role||'')}"></div>`;
    html += `<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Department</label><select name="department">`;
    DEPARTMENTS.forEach(d => { html += `<option value="${d}" ${cc.department===d?'selected':''}>${d}</option>`; });
    html += `</select></div><div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Status</label><select name="status">`;
    ['assigned','confirmed','standby','withdrawn'].forEach(s => { html += `<option value="${s}" ${cc.status===s?'selected':''}>${s.charAt(0).toUpperCase()+s.slice(1)}</option>`; });
    html += '</select></div>';
    html += '<div style="display:flex;gap:12px"><button type="submit" class="btn">Save</button><a href="'+BASE+'/cast-crew" class="btn" style="background:'+GRAY+'">Cancel</a></div>';
    html += '</div></form></div>';
    res.send(page('Edit Cast/Crew', html));
  }));

  app.post(BASE+'/edit-cast-crew/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { student_id, role, department, status } = req.body;
    await pool.query('UPDATE cast_crew SET student_id=$1,role=$2,department=$3,status=$4 WHERE id=$5 AND tenant_id=$6',
      [student_id, role, department, status, req.params.id, tid]);
    res.redirect(BASE + '/cast-crew');
  }));

  // ---------- Rehearsals ----------
  app.get(BASE+'/rehearsals', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { rows } = await pool.query('SELECT r.*, p.title AS play_title FROM rehearsals r JOIN plays p ON p.id=r.play_id WHERE r.tenant_id=$1 ORDER BY r.date DESC, r.time DESC LIMIT 50', [tid]);
    let html = nav(BASE+'/rehearsals') + '<h1 style="font-size:24px;margin-bottom:20px">📋 Rehearsal Schedule</h1>';
    html += '<a href="'+BASE+'/schedule-rehearsal" class="btn" style="display:inline-block;margin-bottom:16px;background:#d97706">+ Schedule Rehearsal</a>';
    html += '<div class="card"><table><thead><tr><th>Play</th><th>Date</th><th>Time</th><th>Venue</th><th>Scene Focus</th><th>Status</th><th>Actions</th></tr></thead><tbody>';
    rows.forEach(r => {
      const sc = r.status==='scheduled'?'#2563eb':r.status==='completed'?'#059669':r.status==='cancelled'?'#dc2626':'#6b7280';
      html += `<tr><td>${esc(r.play_title)}</td><td>${r.date?r.date.toISOString().split('T')[0]:'-'}</td><td>${r.time||''}</td><td>${esc(r.venue||'TBD')}</td><td>${esc(r.scene_focus||'Full run')}</td><td><span style="color:${sc};font-weight:600">${esc(r.status)}</span></td><td><a href="${BASE}/edit-rehearsal/${r.id}" class="btn" style="padding:4px 10px;font-size:12px">Edit</a></td></tr>`;
    });
    html += '</tbody></table></div>';
    res.send(page('Rehearsals', html));
  }));

  app.get(BASE+'/schedule-rehearsal', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const plays = await pool.query("SELECT id, title FROM plays WHERE tenant_id=$1 AND status NOT IN ('completed','archived') ORDER BY title", [tid]);
    let html = nav(BASE+'/rehearsals') + '<h1 style="font-size:24px;margin-bottom:20px">📋 Schedule Rehearsal</h1>';
    html += '<div class="card"><form method="post" action="'+BASE+'/schedule-rehearsal"><div style="display:grid;gap:16px;max-width:500px">';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Play *</label><select name="play_id" required><option value="">Select play</option>';
    plays.rows.forEach(p => { html += `<option value="${p.id}">${esc(p.title)}</option>`; });
    html += '</select></div>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Date *</label><input type="date" name="date" required></div><div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Time</label><input type="time" name="time"></div></div>';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Venue</label><input name="venue" placeholder="e.g. Main Hall, Drama Studio"></div>';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Scene Focus</label><input name="scene_focus" placeholder="e.g. Act 2 Scene 3, Full run"></div>';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Notes</label><textarea name="notes" rows="3" placeholder="Special instructions, what to bring"></textarea></div>';
    html += '<button type="submit" class="btn">Schedule</button></div></form></div>';
    res.send(page('Schedule Rehearsal', html));
  }));

  app.post(BASE+'/schedule-rehearsal', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { play_id, date, time, venue, scene_focus, notes } = req.body;
    if (!play_id || !date) return res.redirect(BASE + '/schedule-rehearsal');
    await pool.query('INSERT INTO rehearsals (tenant_id,play_id,date,time,venue,scene_focus,notes) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [tid, play_id, date, time, venue, scene_focus, notes]);
    audit(req, 'rehearsal_schedule', 'Scheduled rehearsal for play #' + play_id);
    res.redirect(BASE + '/rehearsals');
  }));

  app.get(BASE+'/edit-rehearsal/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM rehearsals WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
    if (!rows.length) return res.status(404).send(page('Not Found', '<p>Rehearsal not found.</p>'));
    const r = rows[0];
    let html = nav(BASE+'/rehearsals') + '<h1 style="font-size:24px;margin-bottom:20px">✏️ Edit Rehearsal</h1>';
    html += '<div class="card"><form method="post" action="'+BASE+'/edit-rehearsal/'+r.id+'"><div style="display:grid;gap:16px;max-width:500px">';
    html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Date</label><input type="date" name="date" value="${r.date?r.date.toISOString().split('T')[0]:''}"></div><div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Time</label><input type="time" name="time" value="${r.time||''}"></div></div>`;
    html += `<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Venue</label><input name="venue" value="${esc(r.venue||'')}"></div>`;
    html += `<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Scene Focus</label><input name="scene_focus" value="${esc(r.scene_focus||'')}"></div>`;
    html += `<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Notes</label><textarea name="notes" rows="3">${esc(r.notes||'')}</textarea></div>`;
    html += `<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Status</label><select name="status">`;
    ['scheduled','completed','cancelled'].forEach(s => { html += `<option value="${s}" ${r.status===s?'selected':''}>${s.charAt(0).toUpperCase()+s.slice(1)}</option>`; });
    html += '</select></div>';
    html += '<div style="display:flex;gap:12px"><button type="submit" class="btn">Save</button><a href="'+BASE+'/rehearsals" class="btn" style="background:'+GRAY+'">Cancel</a></div>';
    html += '</div></form></div>';
    res.send(page('Edit Rehearsal', html));
  }));

  app.post(BASE+'/edit-rehearsal/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { date, time, venue, scene_focus, notes, status } = req.body;
    await pool.query('UPDATE rehearsals SET date=$1,time=$2,venue=$3,scene_focus=$4,notes=$5,status=$6 WHERE id=$7 AND tenant_id=$8',
      [date, time, venue, scene_focus, notes, status, req.params.id, tid]);
    res.redirect(BASE + '/rehearsals');
  }));

  // ---------- Scripts ----------
  app.get(BASE+'/scripts', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { rows } = await pool.query('SELECT * FROM scripts WHERE tenant_id=$1 ORDER BY title', [tid]);
    let html = nav(BASE+'/scripts') + '<h1 style="font-size:24px;margin-bottom:20px">📜 Script Library</h1>';
    html += '<a href="'+BASE+'/add-script" class="btn" style="display:inline-block;margin-bottom:16px;background:#7c3aed">+ Add Script</a>';
    html += '<div class="card"><table><thead><tr><th>Title</th><th>Author</th><th>Genre</th><th>Category</th><th>Added</th><th>Actions</th></tr></thead><tbody>';
    rows.forEach(s => {
      html += `<tr><td>${esc(s.title)}</td><td>${esc(s.author||'-')}</td><td>${esc(s.genre||'-')}</td><td>${esc(s.category||'-')}</td><td>${s.created_at?s.created_at.toISOString().split('T')[0]:'-'}</td><td><a href="${BASE}/edit-script/${s.id}" class="btn" style="padding:4px 10px;font-size:12px">Edit</a></td></tr>`;
    });
    html += '</tbody></table></div>';
    res.send(page('Script Library', html));
  }));

  app.get(BASE+'/add-script', requireAuth, requireNotBanned, ah(async (req, res) => {
    let html = nav(BASE+'/scripts') + '<h1 style="font-size:24px;margin-bottom:20px">📜 Add Script</h1>';
    html += '<div class="card"><form method="post" action="'+BASE+'/add-script"><div style="display:grid;gap:16px;max-width:600px">';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Title *</label><input name="title" required placeholder="Script title"></div>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Author</label><input name="author" placeholder="Playwright"></div><div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Genre</label><select name="genre"><option value="">Select</option>';
    GENRES.forEach(g => { html += `<option value="${g}">${g}</option>`; });
    html += '</select></div></div>';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Category</label><input name="category" placeholder="e.g. One-Act, Full-Length, Monologue"></div>';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Content / Script Text</label><textarea name="content" rows="8" placeholder="Paste script content or a synopsis here..."></textarea></div>';
    html += '<button type="submit" class="btn">Add Script</button></div></form></div>';
    res.send(page('Add Script', html));
  }));

  app.post(BASE+'/add-script', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { title, author, genre, category, content } = req.body;
    await pool.query('INSERT INTO scripts (tenant_id,title,author,genre,category,content) VALUES ($1,$2,$3,$4,$5,$6)',
      [tid, title, author, genre, category, content]);
    audit(req, 'script_add', 'Added script: ' + title);
    res.redirect(BASE + '/scripts');
  }));

  app.get(BASE+'/edit-script/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM scripts WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
    if (!rows.length) return res.status(404).send(page('Not Found', '<p>Script not found.</p>'));
    const s = rows[0];
    let html = nav(BASE+'/scripts') + '<h1 style="font-size:24px;margin-bottom:20px">✏️ Edit Script</h1>';
    html += '<div class="card"><form method="post" action="'+BASE+'/edit-script/'+s.id+'"><div style="display:grid;gap:16px;max-width:600px">';
    html += `<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Title *</label><input name="title" value="${esc(s.title)}" required></div>`;
    html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Author</label><input name="author" value="${esc(s.author||'')}"></div><div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Genre</label><select name="genre"><option value="">Select</option>`;
    GENRES.forEach(g => { html += `<option value="${g}" ${s.genre===g?'selected':''}>${g}</option>`; });
    html += '</select></div></div>';
    html += `<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Category</label><input name="category" value="${esc(s.category||'')}"></div>`;
    html += `<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Content</label><textarea name="content" rows="8">${esc(s.content||'')}</textarea></div>`;
    html += '<div style="display:flex;gap:12px"><button type="submit" class="btn">Save</button><a href="'+BASE+'/scripts" class="btn" style="background:'+GRAY+'">Cancel</a></div>';
    html += '</div></form></div>';
    res.send(page('Edit Script', html));
  }));

  app.post(BASE+'/edit-script/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { title, author, genre, category, content } = req.body;
    await pool.query('UPDATE scripts SET title=$1,author=$2,genre=$3,category=$4,content=$5 WHERE id=$6 AND tenant_id=$7',
      [title, author, genre, category, content, req.params.id, tid]);
    res.redirect(BASE + '/scripts');
  }));

  // ---------- Costumes ----------
  app.get(BASE+'/costumes', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { rows } = await pool.query('SELECT c.*, p.title AS play_title, u.name AS assigned_name FROM costumes c LEFT JOIN plays p ON p.id=c.play_id LEFT JOIN users u ON u.id=c.assigned_to WHERE c.tenant_id=$1 ORDER BY c.name', [tid]);
    let html = nav(BASE+'/costumes') + '<h1 style="font-size:24px;margin-bottom:20px">👔 Costume Inventory</h1>';
    html += '<a href="'+BASE+'/add-costume" class="btn" style="display:inline-block;margin-bottom:16px;background:#dc2626">+ Add Costume</a>';
    html += '<div class="card"><table><thead><tr><th>Name</th><th>Play</th><th>Size</th><th>Condition</th><th>Assigned To</th><th>Notes</th><th>Actions</th></tr></thead><tbody>';
    rows.forEach(c => {
      const condColor = c.condition==='excellent'?'#059669':c.condition==='good'?'#2563eb':c.condition==='fair'?'#d97706':'#dc2626';
      html += `<tr><td>${esc(c.name)}</td><td>${esc(c.play_title||'-')}</td><td>${esc(c.size||'-')}</td><td><span style="color:${condColor};font-weight:600">${esc(c.condition)}</span></td><td>${esc(c.assigned_name||'Unassigned')}</td><td>${esc((c.notes||'').substring(0,40))}</td><td><a href="${BASE}/edit-costume/${c.id}" class="btn" style="padding:4px 10px;font-size:12px">Edit</a></td></tr>`;
    });
    html += '</tbody></table></div>';
    res.send(page('Costumes', html));
  }));

  app.get(BASE+'/add-costume', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const plays = await pool.query('SELECT id, title FROM plays WHERE tenant_id=$1 ORDER BY title', [tid]);
    let html = nav(BASE+'/costumes') + '<h1 style="font-size:24px;margin-bottom:20px">👔 Add Costume</h1>';
    html += '<div class="card"><form method="post" action="'+BASE+'/add-costume"><div style="display:grid;gap:16px;max-width:500px">';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Costume Name *</label><input name="name" required placeholder="e.g. Hamlet\'s black attire"></div>';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Play</label><select name="play_id"><option value="">No specific play</option>';
    plays.rows.forEach(p => { html += `<option value="${p.id}">${esc(p.title)}</option>`; });
    html += '</select></div>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Size</label><input name="size" placeholder="e.g. M, L, 42"></div><div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Condition</label><select name="condition"><option value="excellent">Excellent</option><option value="good" selected>Good</option><option value="fair">Fair</option><option value="poor">Poor</option></select></div></div>';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Notes</label><textarea name="notes" rows="2" placeholder="Details about the costume"></textarea></div>';
    html += '<button type="submit" class="btn">Add Costume</button></div></form></div>';
    res.send(page('Add Costume', html));
  }));

  app.post(BASE+'/add-costume', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { name, play_id, size, condition, notes } = req.body;
    await pool.query('INSERT INTO costumes (tenant_id,play_id,name,size,condition,notes) VALUES ($1,$2,$3,$4,$5,$6)',
      [tid, play_id || null, name, size, condition || 'good', notes]);
    audit(req, 'costume_add', 'Added costume: ' + name);
    res.redirect(BASE + '/costumes');
  }));

  app.get(BASE+'/edit-costume/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { rows } = await pool.query('SELECT * FROM costumes WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    if (!rows.length) return res.status(404).send(page('Not Found', '<p>Costume not found.</p>'));
    const c = rows[0];
    const plays = await pool.query('SELECT id, title FROM plays WHERE tenant_id=$1 ORDER BY title', [tid]);
    let html = nav(BASE+'/costumes') + '<h1 style="font-size:24px;margin-bottom:20px">✏️ Edit Costume</h1>';
    html += '<div class="card"><form method="post" action="'+BASE+'/edit-costume/'+c.id+'"><div style="display:grid;gap:16px;max-width:500px">';
    html += `<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Name *</label><input name="name" value="${esc(c.name)}" required></div>`;
    html += `<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Play</label><select name="play_id"><option value="">No specific play</option>`;
    plays.rows.forEach(p => { html += `<option value="${p.id}" ${c.play_id===p.id?'selected':''}>${esc(p.title)}</option>`; });
    html += '</select></div>';
    html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Size</label><input name="size" value="${esc(c.size||'')}"></div><div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Condition</label><select name="condition">`;
    ['excellent','good','fair','poor'].forEach(co => { html += `<option value="${co}" ${c.condition===co?'selected':''}>${co.charAt(0).toUpperCase()+co.slice(1)}</option>`; });
    html += '</select></div></div>';
    html += `<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Notes</label><textarea name="notes" rows="2">${esc(c.notes||'')}</textarea></div>`;
    html += '<div style="display:flex;gap:12px"><button type="submit" class="btn">Save</button><a href="'+BASE+'/costumes" class="btn" style="background:'+GRAY+'">Cancel</a></div>';
    html += '</div></form></div>';
    res.send(page('Edit Costume', html));
  }));

  app.post(BASE+'/edit-costume/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { name, play_id, size, condition, notes } = req.body;
    await pool.query('UPDATE costumes SET name=$1,play_id=$2,size=$3,condition=$4,notes=$5 WHERE id=$6 AND tenant_id=$7',
      [name, play_id || null, size, condition, notes, req.params.id, tid]);
    res.redirect(BASE + '/costumes');
  }));

  // ---------- Props ----------
  app.get(BASE+'/props', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { rows } = await pool.query('SELECT pr.*, p.title AS play_title FROM props pr LEFT JOIN plays p ON p.id=pr.play_id WHERE pr.tenant_id=$1 ORDER BY pr.name', [tid]);
    let html = nav(BASE+'/props') + '<h1 style="font-size:24px;margin-bottom:20px">🔑 Props Management</h1>';
    html += '<a href="'+BASE+'/add-prop" class="btn" style="display:inline-block;margin-bottom:16px;background:#0891b2">+ Add Prop</a>';
    html += '<div class="card"><table><thead><tr><th>Name</th><th>Play</th><th>Quantity</th><th>Status</th><th>Storage</th><th>Description</th><th>Actions</th></tr></thead><tbody>';
    rows.forEach(p => {
      const sc = p.status==='available'?'#059669':p.status==='in-use'?'#2563eb':p.status==='repair'?'#d97706':'#6b7280';
      html += `<tr><td>${esc(p.name)}</td><td>${esc(p.play_title||'-')}</td><td>${p.quantity}</td><td><span style="color:${sc};font-weight:600">${esc(p.status)}</span></td><td>${esc(p.storage_location||'-')}</td><td>${esc((p.description||'').substring(0,40))}</td><td><a href="${BASE}/edit-prop/${p.id}" class="btn" style="padding:4px 10px;font-size:12px">Edit</a></td></tr>`;
    });
    html += '</tbody></table></div>';
    res.send(page('Props', html));
  }));

  app.get(BASE+'/add-prop', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const plays = await pool.query('SELECT id, title FROM plays WHERE tenant_id=$1 ORDER BY title', [tid]);
    let html = nav(BASE+'/props') + '<h1 style="font-size:24px;margin-bottom:20px">🔑 Add Prop</h1>';
    html += '<div class="card"><form method="post" action="'+BASE+'/add-prop"><div style="display:grid;gap:16px;max-width:500px">';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Prop Name *</label><input name="name" required placeholder="e.g. Yorick\'s skull, Sword"></div>';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Play</label><select name="play_id"><option value="">No specific play</option>';
    plays.rows.forEach(p => { html += `<option value="${p.id}">${esc(p.title)}</option>`; });
    html += '</select></div>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Quantity</label><input type="number" name="quantity" min="1" value="1"></div><div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Status</label><select name="status"><option value="available">Available</option><option value="in-use">In Use</option><option value="repair">Needs Repair</option><option value="retired">Retired</option></select></div></div>';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Storage Location</label><input name="storage_location" placeholder="e.g. Prop Room Shelf A3"></div>';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Description</label><textarea name="description" rows="2" placeholder="Details about the prop"></textarea></div>';
    html += '<button type="submit" class="btn">Add Prop</button></div></form></div>';
    res.send(page('Add Prop', html));
  }));

  app.post(BASE+'/add-prop', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { name, play_id, quantity, status, storage_location, description } = req.body;
    await pool.query('INSERT INTO props (tenant_id,play_id,name,quantity,status,storage_location,description) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [tid, play_id || null, name, quantity || 1, status || 'available', storage_location, description]);
    audit(req, 'prop_add', 'Added prop: ' + name);
    res.redirect(BASE + '/props');
  }));

  app.get(BASE+'/edit-prop/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { rows } = await pool.query('SELECT * FROM props WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    if (!rows.length) return res.status(404).send(page('Not Found', '<p>Prop not found.</p>'));
    const p = rows[0];
    const plays = await pool.query('SELECT id, title FROM plays WHERE tenant_id=$1 ORDER BY title', [tid]);
    let html = nav(BASE+'/props') + '<h1 style="font-size:24px;margin-bottom:20px">✏️ Edit Prop</h1>';
    html += '<div class="card"><form method="post" action="'+BASE+'/edit-prop/'+p.id+'"><div style="display:grid;gap:16px;max-width:500px">';
    html += `<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Name *</label><input name="name" value="${esc(p.name)}" required></div>`;
    html += `<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Play</label><select name="play_id"><option value="">No specific play</option>`;
    plays.rows.forEach(pl => { html += `<option value="${pl.id}" ${p.play_id===pl.id?'selected':''}>${esc(pl.title)}</option>`; });
    html += '</select></div>';
    html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Quantity</label><input type="number" name="quantity" min="1" value="${p.quantity}"></div><div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Status</label><select name="status">`;
    ['available','in-use','repair','retired'].forEach(s => { html += `<option value="${s}" ${p.status===s?'selected':''}>${s}</option>`; });
    html += '</select></div></div>';
    html += `<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Storage Location</label><input name="storage_location" value="${esc(p.storage_location||'')}"></div>`;
    html += `<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Description</label><textarea name="description" rows="2">${esc(p.description||'')}</textarea></div>`;
    html += '<div style="display:flex;gap:12px"><button type="submit" class="btn">Save</button><a href="'+BASE+'/props" class="btn" style="background:'+GRAY+'">Cancel</a></div>';
    html += '</div></form></div>';
    res.send(page('Edit Prop', html));
  }));

  app.post(BASE+'/edit-prop/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { name, play_id, quantity, status, storage_location, description } = req.body;
    await pool.query('UPDATE props SET name=$1,play_id=$2,quantity=$3,status=$4,storage_location=$5,description=$6 WHERE id=$7 AND tenant_id=$8',
      [name, play_id || null, quantity || 1, status, storage_location, description, req.params.id, tid]);
    res.redirect(BASE + '/props');
  }));

  // ---------- Ticketing ----------
  app.get(BASE+'/ticketing', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const plays = await pool.query("SELECT id, title FROM plays WHERE tenant_id=$1 AND status IN ('rehearsals','tech-week','performing') ORDER BY title", [tid]);
    const tickets = await pool.query('SELECT dt.*, p.title AS play_title FROM drama_tickets dt JOIN plays p ON p.id=dt.play_id WHERE dt.tenant_id=$1 ORDER BY dt.created_at DESC LIMIT 50', [tid]);
    const revenue = await pool.query("SELECT COALESCE(SUM(total_price),0)::numeric(10,2) AS total FROM drama_tickets WHERE tenant_id=$1 AND status='confirmed'", [tid]);
    const totalSold = await pool.query("SELECT COALESCE(SUM(quantity),0)::int AS total FROM drama_tickets WHERE tenant_id=$1 AND status='confirmed'", [tid]);
    let html = nav(BASE+'/ticketing') + '<h1 style="font-size:24px;margin-bottom:20px">🎫 Performance Ticketing</h1>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:20px">';
    html += `<div class="card" style="text-align:center;border-top:3px solid #059669"><div style="font-size:24px;font-weight:700;color:#059669">$${revenue.rows[0].total}</div><div style="font-size:12px;color:${GRAY}">Total Revenue</div></div>`;
    html += `<div class="card" style="text-align:center;border-top:3px solid #2563eb"><div style="font-size:24px;font-weight:700;color:#2563eb">${totalSold.rows[0].total}</div><div style="font-size:12px;color:${GRAY}">Tickets Sold</div></div>`;
    html += '</div>';
    html += '<div class="card"><h2 style="margin-bottom:12px">Sell Tickets</h2><form method="post" action="'+BASE+'/ticketing"><div style="display:grid;gap:12px;max-width:500px">';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Play *</label><select name="play_id" required><option value="">Select play</option>';
    plays.rows.forEach(p => { html += `<option value="${p.id}">${esc(p.title)}</option>`; });
    html += '</select></div>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Buyer Name *</label><input name="buyer_name" required placeholder="Full name"></div><div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Email *</label><input type="email" name="buyer_email" required placeholder="email@example.com"></div></div>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px"><div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Performance Date</label><input type="date" name="performance_date"></div><div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Ticket Type</label><select name="ticket_type"><option value="general">General ($5)</option><option value="vip">VIP ($10)</option><option value="student">Student ($3)</option></select></div><div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Quantity</label><input type="number" name="quantity" min="1" value="1"></div></div>';
    html += '<button type="submit" class="btn">Sell Tickets</button></div></form></div>';
    html += '<div class="card"><h2 style="margin-bottom:12px">Recent Sales</h2><table><thead><tr><th>Play</th><th>Buyer</th><th>Date</th><th>Type</th><th>Qty</th><th>Total</th><th>Status</th></tr></thead><tbody>';
    tickets.rows.forEach(t => {
      html += `<tr><td>${esc(t.play_title)}</td><td>${esc(t.buyer_name)}</td><td>${t.performance_date?t.performance_date.toISOString().split('T')[0]:'-'}</td><td>${esc(t.ticket_type)}</td><td>${t.quantity}</td><td>$${t.total_price}</td><td>${esc(t.status)}</td></tr>`;
    });
    html += '</tbody></table></div>';
    res.send(page('Ticketing', html));
  }));

  app.post(BASE+'/ticketing', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { play_id, buyer_name, buyer_email, performance_date, ticket_type, quantity } = req.body;
    if (!play_id || !buyer_name || !buyer_email) return res.redirect(BASE + '/ticketing');
    const prices = { general: 5, vip: 10, student: 3 };
    const price = prices[ticket_type] || 5;
    const qty = parseInt(quantity) || 1;
    const total = price * qty;
    await pool.query('INSERT INTO drama_tickets (tenant_id,play_id,buyer_name,buyer_email,performance_date,ticket_type,quantity,total_price) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [tid, play_id, buyer_name, buyer_email, performance_date || null, ticket_type || 'general', qty, total]);
    audit(req, 'ticket_sell', `Sold ${qty} ${ticket_type} ticket(s) for $${total}`);
    if (buyer_email) {
      queueEmail(buyer_email, 'Drama Club - Tickets Confirmed', `Thank you ${buyer_name}! Your ${qty} ${ticket_type} ticket(s) totaling $${total} have been confirmed.`);
    }
    res.redirect(BASE + '/ticketing');
  }));

  // ---------- Workshops ----------
  app.get(BASE+'/workshops', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { rows } = await pool.query('SELECT * FROM drama_workshops WHERE tenant_id=$1 ORDER BY date DESC', [tid]);
    let html = nav(BASE+'/workshops') + '<h1 style="font-size:24px;margin-bottom:20px">🎓 Acting Workshops</h1>';
    html += '<a href="'+BASE+'/create-workshop" class="btn" style="display:inline-block;margin-bottom:16px;background:#4338ca">+ Create Workshop</a>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px">';
    rows.forEach(w => {
      const sc = w.status==='upcoming'?'#059669':w.status==='completed'?'#6b7280':'#dc2626';
      html += `<div class="card" style="border-left:4px solid ${sc}">
        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px"><h3 style="font-size:16px">${esc(w.title)}</h3><span style="padding:2px 10px;border-radius:12px;font-size:11px;font-weight:600;background:${sc}22;color:${sc}">${esc(w.status)}</span></div>
        <p style="font-size:13px;color:${GRAY}">Instructor: ${esc(w.instructor||'TBD')}</p>
        <p style="font-size:13px;color:${GRAY}">${w.date?w.date.toISOString().split('T')[0]:''} ${w.time||''} · ${esc(w.venue||'TBD')}</p>
        <p style="font-size:12px;color:${GRAY}">Max ${w.max_participants} participants</p>
        ${w.description?'<p style="font-size:13px;margin-top:6px;color:#374151">'+esc(w.description).substring(0,100)+'...</p>':''}
        <div style="margin-top:8px"><a href="${BASE}/edit-workshop/${w.id}" class="btn" style="padding:4px 10px;font-size:12px">Edit</a></div>
      </div>`;
    });
    html += '</div>';
    res.send(page('Workshops', html));
  }));

  app.get(BASE+'/create-workshop', requireAuth, requireNotBanned, ah(async (req, res) => {
    let html = nav(BASE+'/workshops') + '<h1 style="font-size:24px;margin-bottom:20px">🎓 Create Workshop</h1>';
    html += '<div class="card"><form method="post" action="'+BASE+'/create-workshop"><div style="display:grid;gap:16px;max-width:500px">';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Workshop Title *</label><input name="title" required placeholder="e.g. Improv Basics"></div>';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Instructor</label><input name="instructor" placeholder="Workshop leader"></div>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Date</label><input type="date" name="date"></div><div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Time</label><input type="time" name="time"></div></div>';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Venue</label><input name="venue" placeholder="Room location"></div>';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Max Participants</label><input type="number" name="max_participants" min="1" value="20"></div>';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Description</label><textarea name="description" rows="3" placeholder="What participants will learn"></textarea></div>';
    html += '<button type="submit" class="btn">Create Workshop</button></div></form></div>';
    res.send(page('Create Workshop', html));
  }));

  app.post(BASE+'/create-workshop', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { title, instructor, date, time, venue, max_participants, description } = req.body;
    await pool.query('INSERT INTO drama_workshops (tenant_id,title,instructor,date,time,venue,max_participants,description) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [tid, title, instructor, date || null, time, venue, max_participants || 20, description]);
    audit(req, 'workshop_create', 'Created workshop: ' + title);
    res.redirect(BASE + '/workshops');
  }));

  app.get(BASE+'/edit-workshop/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM drama_workshops WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
    if (!rows.length) return res.status(404).send(page('Not Found', '<p>Workshop not found.</p>'));
    const w = rows[0];
    let html = nav(BASE+'/workshops') + '<h1 style="font-size:24px;margin-bottom:20px">✏️ Edit Workshop</h1>';
    html += '<div class="card"><form method="post" action="'+BASE+'/edit-workshop/'+w.id+'"><div style="display:grid;gap:16px;max-width:500px">';
    html += `<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Title *</label><input name="title" value="${esc(w.title)}" required></div>`;
    html += `<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Instructor</label><input name="instructor" value="${esc(w.instructor||'')}"></div>`;
    html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Date</label><input type="date" name="date" value="${w.date?w.date.toISOString().split('T')[0]:''}"></div><div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Time</label><input type="time" name="time" value="${w.time||''}"></div></div>`;
    html += `<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Venue</label><input name="venue" value="${esc(w.venue||'')}"></div>`;
    html += `<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Max Participants</label><input type="number" name="max_participants" min="1" value="${w.max_participants}"></div>`;
    html += `<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Description</label><textarea name="description" rows="3">${esc(w.description||'')}</textarea></div>`;
    html += `<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Status</label><select name="status">`;
    ['upcoming','completed','cancelled'].forEach(s => { html += `<option value="${s}" ${w.status===s?'selected':''}>${s.charAt(0).toUpperCase()+s.slice(1)}</option>`; });
    html += '</select></div>';
    html += '<div style="display:flex;gap:12px"><button type="submit" class="btn">Save</button><a href="'+BASE+'/workshops" class="btn" style="background:'+GRAY+'">Cancel</a></div>';
    html += '</div></form></div>';
    res.send(page('Edit Workshop', html));
  }));

  app.post(BASE+'/edit-workshop/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { title, instructor, date, time, venue, max_participants, description, status } = req.body;
    await pool.query('UPDATE drama_workshops SET title=$1,instructor=$2,date=$3,time=$4,venue=$5,max_participants=$6,description=$7,status=$8 WHERE id=$9 AND tenant_id=$10',
      [title, instructor, date, time, venue, max_participants || 20, description, status, req.params.id, tid]);
    res.redirect(BASE + '/workshops');
  }));

  // ---------- Auditions ----------
  app.get(BASE+'/auditions', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { rows } = await pool.query('SELECT a.*, p.title AS play_title, u.name AS student_name FROM auditions a JOIN plays p ON p.id=a.play_id LEFT JOIN users u ON u.id=a.student_id WHERE a.tenant_id=$1 ORDER BY a.audition_date DESC', [tid]);
    const plays = await pool.query("SELECT id, title FROM plays WHERE tenant_id=$1 AND status IN ('planning','auditions') ORDER BY title", [tid]);
    let html = nav(BASE+'/auditions') + '<h1 style="font-size:24px;margin-bottom:20px">🎤 Auditions</h1>';
    html += '<a href="'+BASE+'/apply-audition" class="btn" style="display:inline-block;margin-bottom:16px;background:#be185d">+ Apply for Audition</a>';
    const statusCounts = { pending: 0, accepted: 0, rejected: 0 };
    rows.forEach(r => { if (statusCounts[r.status] !== undefined) statusCounts[r.status]++; });
    html += '<div style="display:flex;gap:12px;margin-bottom:16px">';
    html += `<span style="padding:4px 12px;border-radius:20px;font-size:12px;background:#fef3c7;color:#92400e">⏳ ${statusCounts.pending} Pending</span>`;
    html += `<span style="padding:4px 12px;border-radius:20px;font-size:12px;background:#d1fae5;color:#065f46">✅ ${statusCounts.accepted} Accepted</span>`;
    html += `<span style="padding:4px 12px;border-radius:20px;font-size:12px;background:#fee2e2;color:#991b1b">❌ ${statusCounts.rejected} Rejected</span>`;
    html += '</div>';
    html += '<div class="card"><table><thead><tr><th>Play</th><th>Student</th><th>Role Applied</th><th>Date</th><th>Status</th><th>Actions</th></tr></thead><tbody>';
    rows.forEach(a => {
      const sc = a.status==='pending'?'#d97706':a.status==='accepted'?'#059669':'#dc2626';
      html += `<tr><td>${esc(a.play_title)}</td><td>${esc(a.student_name||'N/A')}</td><td>${esc(a.role_applied||'-')}</td><td>${a.audition_date?a.audition_date.toISOString().split('T')[0]:'-'}</td><td><span style="color:${sc};font-weight:600">${esc(a.status)}</span></td><td><a href="${BASE}/manage-audition/${a.id}" class="btn" style="padding:4px 10px;font-size:12px">Manage</a></td></tr>`;
    });
    html += '</tbody></table></div>';
    res.send(page('Auditions', html));
  }));

  app.get(BASE+'/apply-audition', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const plays = await pool.query("SELECT id, title FROM plays WHERE tenant_id=$1 AND status IN ('planning','auditions') ORDER BY title", [tid]);
    let html = nav(BASE+'/auditions') + '<h1 style="font-size:24px;margin-bottom:20px">🎤 Apply for Audition</h1>';
    html += '<div class="card"><form method="post" action="'+BASE+'/apply-audition"><div style="display:grid;gap:16px;max-width:500px">';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Play *</label><select name="play_id" required><option value="">Select play</option>';
    plays.rows.forEach(p => { html += `<option value="${p.id}">${esc(p.title)}</option>`; });
    html += '</select></div>';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Student ID *</label><input name="student_id" type="number" required placeholder="Your student user ID"></div>';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Role Applied For</label><input name="role_applied" placeholder="e.g. Hamlet, Ophelia, Any"></div>';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Preferred Audition Date</label><input type="date" name="audition_date"></div>';
    html += '<button type="submit" class="btn">Submit Application</button></div></form></div>';
    res.send(page('Apply for Audition', html));
  }));

  app.post(BASE+'/apply-audition', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { play_id, student_id, role_applied, audition_date } = req.body;
    if (!play_id || !student_id) return res.redirect(BASE + '/apply-audition');
    await pool.query('INSERT INTO auditions (tenant_id,play_id,student_id,role_applied,audition_date) VALUES ($1,$2,$3,$4,$5)',
      [tid, play_id, student_id, role_applied, audition_date || null]);
    audit(req, 'audition_apply', 'Applied for audition in play #' + play_id);
    res.redirect(BASE + '/auditions');
  }));

  app.get(BASE+'/manage-audition/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { rows } = await pool.query('SELECT a.*, p.title AS play_title, u.name AS student_name FROM auditions a JOIN plays p ON p.id=a.play_id LEFT JOIN users u ON u.id=a.student_id WHERE a.id=$1 AND a.tenant_id=$2', [req.params.id, tid]);
    if (!rows.length) return res.status(404).send(page('Not Found', '<p>Audition not found.</p>'));
    const a = rows[0];
    let html = nav(BASE+'/auditions') + '<h1 style="font-size:24px;margin-bottom:20px">🎤 Manage Audition</h1>';
    html += '<div class="card"><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">';
    html += `<div><strong>Play:</strong> ${esc(a.play_title)}</div>`;
    html += `<div><strong>Student:</strong> ${esc(a.student_name||'N/A')}</div>`;
    html += `<div><strong>Role:</strong> ${esc(a.role_applied||'Any')}</div>`;
    html += `<div><strong>Date:</strong> ${a.audition_date?a.audition_date.toISOString().split('T')[0]:'TBD'}</div>`;
    html += `<div><strong>Status:</strong> <span style="font-weight:600">${esc(a.status)}</span></div>`;
    html += '</div></div>';
    html += '<div class="card"><h2 style="margin-bottom:12px">Update Audition</h2><form method="post" action="'+BASE+'/manage-audition/'+a.id+'"><div style="display:grid;gap:16px;max-width:500px">';
    html += `<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Status</label><select name="status">`;
    ['pending','accepted','rejected','waitlisted'].forEach(s => { html += `<option value="${s}" ${a.status===s?'selected':''}>${s.charAt(0).toUpperCase()+s.slice(1)}</option>`; });
    html += '</select></div>';
    html += `<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Feedback</label><textarea name="feedback" rows="3" placeholder="Director notes, audition feedback...">${esc(a.feedback||'')}</textarea></div>`;
    html += '<div style="display:flex;gap:12px"><button type="submit" class="btn">Update</button><a href="'+BASE+'/auditions" class="btn" style="background:'+GRAY+'">Cancel</a></div>';
    html += '</div></form></div>';
    res.send(page('Manage Audition', html));
  }));

  app.post(BASE+'/manage-audition/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { status, feedback } = req.body;
    await pool.query('UPDATE auditions SET status=$1,feedback=$2 WHERE id=$3 AND tenant_id=$4',
      [status, feedback, req.params.id, tid]);
    audit(req, 'audition_update', 'Updated audition #' + req.params.id + ' to ' + status);
    res.redirect(BASE + '/auditions');
  }));
};
