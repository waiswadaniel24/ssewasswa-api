module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5', GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.btn:hover{background:#3730a3}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}</style>';

  (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS practice_rooms (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        name VARCHAR(255) NOT NULL,
        instruments JSONB DEFAULT '[]',
        capacity INTEGER DEFAULT 1,
        status VARCHAR(50) DEFAULT 'available',
        created_at TIMESTAMP DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS music_instruments (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        name VARCHAR(255) NOT NULL,
        type VARCHAR(100),
        brand VARCHAR(100),
        serial VARCHAR(100),
        condition VARCHAR(50) DEFAULT 'good',
        status VARCHAR(50) DEFAULT 'available'
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS band_groups (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        name VARCHAR(255) NOT NULL,
        genre VARCHAR(100),
        members JSONB DEFAULT '[]',
        conductor_id INTEGER,
        created_at TIMESTAMP DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS performances (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        title VARCHAR(255) NOT NULL,
        date DATE,
        venue VARCHAR(255),
        performers JSONB DEFAULT '[]',
        type VARCHAR(100),
        status VARCHAR(50) DEFAULT 'scheduled'
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS practice_logs (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        student_id INTEGER NOT NULL,
        instrument VARCHAR(100),
        duration_min INTEGER DEFAULT 0,
        pieces_practiced TEXT,
        notes TEXT,
        date DATE DEFAULT CURRENT_DATE
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS room_bookings (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        room_id INTEGER NOT NULL,
        student_id INTEGER NOT NULL,
        date DATE,
        start_time TIME,
        end_time TIME,
        purpose VARCHAR(255),
        status VARCHAR(50) DEFAULT 'confirmed'
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS sheet_music (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        title VARCHAR(255) NOT NULL,
        composer VARCHAR(255),
        instrument VARCHAR(100),
        difficulty VARCHAR(50),
        file_url VARCHAR(500),
        category VARCHAR(100)
      )`);
      console.log('[MusicStudio] Tables ready');
    } catch(e) { console.warn('[MusicStudio] Migration warning:', e.message); }
  })();

  const BASE = '/school/music-studio';
  const INSTRUMENT_TYPES = ['Piano','Guitar','Violin','Drums','Flute','Clarinet','Trumpet','Cello','Saxophone','Trombone','Viola','Bass','Percussion','Vocals'];
  const DIFFICULTY_LEVELS = ['Beginner','Intermediate','Advanced','Professional'];

  function page(title, body) {
    return renderPage(title, SKIP + `<div style="max-width:1200px;margin:0 auto;padding:20px">${body}</div>`);
  }

  function nav(active) {
    const links = [
      ['Dashboard', BASE], ['Rooms', BASE+'/rooms'], ['Instruments', BASE+'/instruments'],
      ['Bands', BASE+'/bands'], ['Book Room', BASE+'/book-room'], ['Performances', BASE+'/performances'],
      ['Practice Log', BASE+'/practice-log'], ['Sheet Music', BASE+'/sheet-music'],
      ['Scheduling', BASE+'/scheduling'], ['Recordings', BASE+'/recordings']
    ];
    let h = '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:20px;padding:12px;background:#f9fafb;border-radius:10px">';
    links.forEach(([l, u]) => { h += `<a href="${u}" style="padding:6px 12px;border-radius:6px;text-decoration:none;font-size:13px;${u===active?'background:'+P+';color:#fff':'background:#fff;color:'+GRAY+';border:1px solid #e5e7eb'}">${l}</a>`; });
    return h + '</div>';
  }

  // ---------- Dashboard ----------
  app.get(BASE, requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const [rooms, instruments, bands, perfs, logs] = await Promise.all([
      pool.query("SELECT COUNT(*)::int AS c FROM practice_rooms WHERE tenant_id=$1", [tid]),
      pool.query("SELECT COUNT(*)::int AS c FROM music_instruments WHERE tenant_id=$1 AND status='available'", [tid]),
      pool.query("SELECT COUNT(*)::int AS c FROM band_groups WHERE tenant_id=$1", [tid]),
      pool.query("SELECT COUNT(*)::int AS c FROM performances WHERE tenant_id=$1 AND status='scheduled'", [tid]),
      pool.query("SELECT COALESCE(SUM(duration_min),0)::int AS total FROM practice_logs WHERE tenant_id=$1 AND student_id=$2", [tid, uid])
    ]);
    const upcomingPerfs = await pool.query("SELECT * FROM performances WHERE tenant_id=$1 AND date >= CURRENT_DATE ORDER BY date ASC LIMIT 5", [tid]);
    const recentLogs = await pool.query("SELECT pl.*, u.name AS student_name FROM practice_logs pl LEFT JOIN users u ON u.id=pl.student_id WHERE pl.tenant_id=$1 ORDER BY pl.date DESC LIMIT 8", [tid]);
    const stats = [
      { label: 'Practice Rooms', value: rooms.rows[0].c, icon: '🏠', color: P },
      { label: 'Available Instruments', value: instruments.rows[0].c, icon: '🎸', color: '#059669' },
      { label: 'Band Groups', value: bands.rows[0].c, icon: '🎵', color: '#d97706' },
      { label: 'Upcoming Performances', value: perfs.rows[0].c, icon: '🎤', color: '#dc2626' },
      { label: 'Your Practice (min)', value: logs.rows[0].total, icon: '⏱️', color: '#7c3aed' }
    ];
    let html = nav(BASE) + '<h1 style="font-size:24px;margin-bottom:20px">🎵 Music Studio Dashboard</h1>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:24px">';
    stats.forEach(s => {
      html += `<div class="card" style="text-align:center;border-top:3px solid ${s.color}"><div style="font-size:28px">${s.icon}</div><div style="font-size:24px;font-weight:700;color:${s.color}">${s.value}</div><div style="font-size:12px;color:${GRAY}">${s.label}</div></div>`;
    });
    html += '</div>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">';
    html += '<div class="card"><h2 style="margin-bottom:12px">🎤 Upcoming Performances</h2>';
    if (upcomingPerfs.rows.length === 0) {
      html += '<p style="color:'+GRAY+';font-size:13px">No upcoming performances.</p>';
    } else {
      upcomingPerfs.rows.forEach(p => {
        html += `<div style="padding:8px 0;border-bottom:1px solid #f3f4f6"><strong>${esc(p.title)}</strong><div style="font-size:12px;color:${GRAY}">${p.date?p.date.toISOString().split('T')[0]:'TBD'} · ${esc(p.venue||'TBD')} · ${esc(p.type||'')}</div></div>`;
      });
    }
    html += '</div>';
    html += '<div class="card"><h2 style="margin-bottom:12px">📝 Recent Practice Logs</h2>';
    if (recentLogs.rows.length === 0) {
      html += '<p style="color:'+GRAY+';font-size:13px">No practice logs yet.</p>';
    } else {
      recentLogs.rows.forEach(l => {
        html += `<div style="padding:6px 0;border-bottom:1px solid #f3f4f6"><div style="font-size:13px"><strong>${esc(l.student_name||'N/A')}</strong> — ${esc(l.instrument||'N/A')}</div><div style="font-size:11px;color:${GRAY}">${l.date ? l.date.toISOString().split('T')[0] : ''} · ${l.duration_min} min</div></div>`;
      });
    }
    html += '</div></div>';
    res.send(page('Music Studio', html));
  }));

  // ---------- Practice Rooms ----------
  app.get(BASE+'/rooms', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { rows } = await pool.query('SELECT * FROM practice_rooms WHERE tenant_id=$1 ORDER BY name', [tid]);
    let html = nav(BASE+'/rooms') + '<h1 style="font-size:24px;margin-bottom:20px">🏠 Practice Rooms</h1>';
    html += '<a href="'+BASE+'/add-room" class="btn" style="display:inline-block;margin-bottom:16px;background:#059669">+ Add Room</a>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px">';
    rows.forEach(r => {
      const instList = Array.isArray(r.instruments) ? r.instruments.join(', ') : (r.instruments || 'None');
      const statusColor = r.status==='available'?'#059669':r.status==='occupied'?'#dc2626':'#d97706';
      html += `<div class="card" style="border-left:4px solid ${statusColor}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><h3 style="font-size:16px">${esc(r.name)}</h3><span style="padding:3px 10px;border-radius:12px;font-size:11px;font-weight:600;background:${statusColor}22;color:${statusColor}">${esc(r.status)}</span></div>
        <p style="font-size:13px;color:${GRAY}">Capacity: ${r.capacity} · Instruments: ${esc(instList)}</p>
        <div style="margin-top:8px;display:flex;gap:8px">
          <a href="${BASE}/book-room?room_id=${r.id}" class="btn" style="padding:4px 10px;font-size:12px">Book</a>
          <a href="${BASE}/edit-room/${r.id}" class="btn" style="padding:4px 10px;font-size:12px;background:#6b7280">Edit</a>
        </div></div>`;
    });
    html += '</div>';
    res.send(page('Practice Rooms', html));
  }));

  app.get(BASE+'/add-room', requireAuth, requireNotBanned, ah(async (req, res) => {
    let html = nav(BASE+'/rooms') + '<h1 style="font-size:24px;margin-bottom:20px">🏠 Add Practice Room</h1>';
    html += '<div class="card"><form method="post" action="'+BASE+'/add-room"><div style="display:grid;gap:16px">';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Room Name *</label><input name="name" required placeholder="e.g. Room A - Piano"></div>';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Capacity</label><input name="capacity" type="number" min="1" value="1"></div>';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Available Instruments (comma-separated)</label><input name="instruments" placeholder="Piano, Music Stand, Metronome"></div>';
    html += '<button type="submit" class="btn">Add Room</button></div></form></div>';
    res.send(page('Add Room', html));
  }));

  app.post(BASE+'/add-room', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { name, capacity, instruments } = req.body;
    const instArr = instruments ? instruments.split(',').map(s => s.trim()).filter(Boolean) : [];
    await pool.query('INSERT INTO practice_rooms (tenant_id,name,instruments,capacity) VALUES ($1,$2,$3,$4)',
      [tid, name, JSON.stringify(instArr), capacity || 1]);
    audit(req, 'room_add', 'Added practice room: ' + name);
    res.redirect(BASE + '/rooms');
  }));

  app.get(BASE+'/edit-room/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM practice_rooms WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
    if (!rows.length) return res.status(404).send(page('Not Found', '<p>Room not found.</p>'));
    const r = rows[0];
    const instList = Array.isArray(r.instruments) ? r.instruments.join(', ') : '';
    let html = nav(BASE+'/rooms') + '<h1 style="font-size:24px;margin-bottom:20px">✏️ Edit Room</h1>';
    html += '<div class="card"><form method="post" action="'+BASE+'/edit-room/'+r.id+'"><div style="display:grid;gap:16px">';
    html += `<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Room Name *</label><input name="name" value="${esc(r.name)}" required></div>`;
    html += `<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Capacity</label><input name="capacity" type="number" min="1" value="${r.capacity}"></div>`;
    html += `<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Instruments</label><input name="instruments" value="${esc(instList)}"></div>`;
    html += `<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Status</label><select name="status">`;
    ['available','occupied','maintenance'].forEach(s => { html += `<option value="${s}" ${r.status===s?'selected':''}>${s.charAt(0).toUpperCase()+s.slice(1)}</option>`; });
    html += '</select></div>';
    html += '<div style="display:flex;gap:12px"><button type="submit" class="btn">Save</button><a href="'+BASE+'/rooms" class="btn" style="background:'+GRAY+'">Cancel</a></div>';
    html += '</div></form></div>';
    res.send(page('Edit Room', html));
  }));

  app.post(BASE+'/edit-room/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { name, capacity, instruments, status } = req.body;
    const instArr = instruments ? instruments.split(',').map(s => s.trim()).filter(Boolean) : [];
    await pool.query('UPDATE practice_rooms SET name=$1,instruments=$2,capacity=$3,status=$4 WHERE id=$5 AND tenant_id=$6',
      [name, JSON.stringify(instArr), capacity || 1, status, req.params.id, tid]);
    audit(req, 'room_edit', 'Edited room: ' + name);
    res.redirect(BASE + '/rooms');
  }));

  // ---------- Book Room ----------
  app.get(BASE+'/book-room', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const rooms = await pool.query("SELECT id, name FROM practice_rooms WHERE tenant_id=$1 AND status='available'", [tid]);
    const bookings = await pool.query('SELECT rb.*, pr.name AS room_name, u.name AS student_name FROM room_bookings rb JOIN practice_rooms pr ON pr.id=rb.room_id LEFT JOIN users u ON u.id=rb.student_id WHERE rb.tenant_id=$1 ORDER BY rb.date DESC, rb.start_time ASC LIMIT 30', [tid]);
    let html = nav(BASE+'/book-room') + '<h1 style="font-size:24px;margin-bottom:20px">📅 Book a Practice Room</h1>';
    html += '<div class="card"><form method="post" action="'+BASE+'/book-room"><div style="display:grid;gap:16px;max-width:500px">';
    html += `<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Room *</label><select name="room_id" required><option value="">Select a room</option>`;
    rooms.rows.forEach(r => { html += `<option value="${r.id}" ${req.query.room_id==r.id?'selected':''}>${esc(r.name)}</option>`; });
    html += '</select></div>';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Date *</label><input type="date" name="date" required></div>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Start Time</label><input type="time" name="start_time" required></div><div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">End Time</label><input type="time" name="end_time" required></div></div>';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Purpose</label><input name="purpose" placeholder="e.g. Piano practice, Band rehearsal"></div>';
    html += '<button type="submit" class="btn">Book Room</button></div></form></div>';
    html += '<div class="card"><h2 style="margin-bottom:12px">Recent Bookings</h2><table><thead><tr><th>Room</th><th>Student</th><th>Date</th><th>Time</th><th>Purpose</th><th>Status</th></tr></thead><tbody>';
    bookings.rows.forEach(b => {
      html += `<tr><td>${esc(b.room_name)}</td><td>${esc(b.student_name||'N/A')}</td><td>${b.date?b.date.toISOString().split('T')[0]:'-'}</td><td>${b.start_time||''} - ${b.end_time||''}</td><td>${esc(b.purpose||'-')}</td><td>${esc(b.status)}</td></tr>`;
    });
    html += '</tbody></table></div>';
    res.send(page('Book Room', html));
  }));

  app.post(BASE+'/book-room', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { room_id, date, start_time, end_time, purpose } = req.body;
    if (!room_id || !date) return res.redirect(BASE + '/book-room');
    await pool.query('INSERT INTO room_bookings (tenant_id,room_id,student_id,date,start_time,end_time,purpose) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [tid, room_id, req.session.user.id, date, start_time, end_time, purpose]);
    audit(req, 'room_book', 'Booked room #' + room_id);
    res.redirect(BASE + '/book-room');
  }));

  // ---------- Instruments ----------
  app.get(BASE+'/instruments', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const typeFilter = req.query.type || '';
    let q = 'SELECT * FROM music_instruments WHERE tenant_id=$1';
    const params = [tid];
    if (typeFilter) { q += ' AND type=$2'; params.push(typeFilter); }
    q += ' ORDER BY name LIMIT 100';
    const { rows } = await pool.query(q, params);
    let html = nav(BASE+'/instruments') + '<h1 style="font-size:24px;margin-bottom:20px">🎸 Instrument Inventory</h1>';
    html += '<div style="display:flex;gap:12px;margin-bottom:16px;align-items:center">';
    html += '<a href="'+BASE+'/add-instrument" class="btn" style="background:#059669">+ Add Instrument</a>';
    html += '<form method="get" style="display:flex;gap:8px"><select name="type" style="width:auto;padding:6px 10px;border-radius:8px;border:1px solid #d1d5db"><option value="">All Types</option>';
    INSTRUMENT_TYPES.forEach(t => { html += `<option value="${t}" ${typeFilter===t?'selected':''}>${t}</option>`; });
    html += '</select><button class="btn" type="submit" style="padding:6px 12px">Filter</button></form></div>';
    html += '<div class="card"><table><thead><tr><th>Name</th><th>Type</th><th>Brand</th><th>Serial</th><th>Condition</th><th>Status</th><th>Actions</th></tr></thead><tbody>';
    rows.forEach(i => {
      const condColor = i.condition==='excellent'?'#059669':i.condition==='good'?'#2563eb':i.condition==='fair'?'#d97706':'#dc2626';
      html += `<tr><td>${esc(i.name)}</td><td>${esc(i.type||'-')}</td><td>${esc(i.brand||'-')}</td><td>${esc(i.serial||'-')}</td><td><span style="color:${condColor};font-weight:600">${esc(i.condition)}</span></td><td>${esc(i.status)}</td><td><a href="${BASE}/edit-instrument/${i.id}" class="btn" style="padding:4px 10px;font-size:12px">Edit</a></td></tr>`;
    });
    html += '</tbody></table></div>';
    res.send(page('Instruments', html));
  }));

  app.get(BASE+'/add-instrument', requireAuth, requireNotBanned, ah(async (req, res) => {
    let html = nav(BASE+'/instruments') + '<h1 style="font-size:24px;margin-bottom:20px">🎸 Add Instrument</h1>';
    html += '<div class="card"><form method="post" action="'+BASE+'/add-instrument"><div style="display:grid;gap:16px;max-width:500px">';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Name *</label><input name="name" required placeholder="e.g. Yamaha U1 Upright Piano"></div>';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Type *</label><select name="type" required><option value="">Select type</option>';
    INSTRUMENT_TYPES.forEach(t => { html += `<option value="${t}">${t}</option>`; });
    html += '</select></div>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Brand</label><input name="brand" placeholder="Brand"></div><div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Serial #</label><input name="serial" placeholder="Serial number"></div></div>';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Condition</label><select name="condition"><option value="excellent">Excellent</option><option value="good" selected>Good</option><option value="fair">Fair</option><option value="poor">Poor</option></select></div>';
    html += '<button type="submit" class="btn">Add Instrument</button></div></form></div>';
    res.send(page('Add Instrument', html));
  }));

  app.post(BASE+'/add-instrument', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { name, type, brand, serial, condition } = req.body;
    await pool.query('INSERT INTO music_instruments (tenant_id,name,type,brand,serial,condition) VALUES ($1,$2,$3,$4,$5,$6)',
      [tid, name, type, brand, serial, condition || 'good']);
    audit(req, 'instrument_add', 'Added instrument: ' + name);
    res.redirect(BASE + '/instruments');
  }));

  app.get(BASE+'/edit-instrument/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM music_instruments WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
    if (!rows.length) return res.status(404).send(page('Not Found', '<p>Instrument not found.</p>'));
    const i = rows[0];
    let html = nav(BASE+'/instruments') + '<h1 style="font-size:24px;margin-bottom:20px">✏️ Edit Instrument</h1>';
    html += '<div class="card"><form method="post" action="'+BASE+'/edit-instrument/'+i.id+'"><div style="display:grid;gap:16px;max-width:500px">';
    html += `<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Name *</label><input name="name" value="${esc(i.name)}" required></div>`;
    html += `<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Type *</label><select name="type" required>`;
    INSTRUMENT_TYPES.forEach(t => { html += `<option value="${t}" ${i.type===t?'selected':''}>${t}</option>`; });
    html += '</select></div>';
    html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Brand</label><input name="brand" value="${esc(i.brand||'')}"></div><div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Serial #</label><input name="serial" value="${esc(i.serial||'')}"></div></div>`;
    html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Condition</label><select name="condition">`;
    ['excellent','good','fair','poor'].forEach(c => { html += `<option value="${c}" ${i.condition===c?'selected':''}>${c.charAt(0).toUpperCase()+c.slice(1)}</option>`; });
    html += `</select></div><div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Status</label><select name="status">`;
    ['available','in-use','repair','retired'].forEach(s => { html += `<option value="${s}" ${i.status===s?'selected':''}>${s}</option>`; });
    html += '</select></div></div>';
    html += '<div style="display:flex;gap:12px;margin-top:16px"><button type="submit" class="btn">Save</button><a href="'+BASE+'/instruments" class="btn" style="background:'+GRAY+'">Cancel</a></div>';
    html += '</div></form></div>';
    res.send(page('Edit Instrument', html));
  }));

  app.post(BASE+'/edit-instrument/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { name, type, brand, serial, condition, status } = req.body;
    await pool.query('UPDATE music_instruments SET name=$1,type=$2,brand=$3,serial=$4,condition=$5,status=$6 WHERE id=$7 AND tenant_id=$8',
      [name, type, brand, serial, condition, status, req.params.id, tid]);
    audit(req, 'instrument_edit', 'Edited instrument: ' + name);
    res.redirect(BASE + '/instruments');
  }));

  // ---------- Bands ----------
  app.get(BASE+'/bands', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { rows } = await pool.query('SELECT bg.*, u.name AS conductor_name FROM band_groups bg LEFT JOIN users u ON u.id=bg.conductor_id WHERE bg.tenant_id=$1 ORDER BY bg.name', [tid]);
    let html = nav(BASE+'/bands') + '<h1 style="font-size:24px;margin-bottom:20px">🎵 Band & Orchestra Groups</h1>';
    html += '<a href="'+BASE+'/create-band" class="btn" style="display:inline-block;margin-bottom:16px;background:#7c3aed">+ Create Band</a>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px">';
    rows.forEach(b => {
      const members = Array.isArray(b.members) ? b.members : [];
      html += `<div class="card" style="border-left:4px solid #7c3aed">
        <h3 style="margin-bottom:4px">${esc(b.name)}</h3>
        <p style="font-size:12px;color:${GRAY}">Genre: ${esc(b.genre||'N/A')} · Conductor: ${esc(b.conductor_name||'N/A')}</p>
        <p style="font-size:12px;color:${GRAY};margin-top:4px">${members.length} member(s)</p>
        ${members.length ? '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:8px">' + members.map(m => `<span style="background:#f3f4f6;padding:2px 8px;border-radius:12px;font-size:11px">${esc(m)}</span>`).join('') + '</div>' : ''}
        <div style="margin-top:8px"><a href="${BASE}/edit-band/${b.id}" class="btn" style="padding:4px 10px;font-size:12px">Manage</a></div>
      </div>`;
    });
    html += '</div>';
    res.send(page('Band Groups', html));
  }));

  app.get(BASE+'/create-band', requireAuth, requireNotBanned, ah(async (req, res) => {
    let html = nav(BASE+'/bands') + '<h1 style="font-size:24px;margin-bottom:20px">🎵 Create Band Group</h1>';
    html += '<div class="card"><form method="post" action="'+BASE+'/create-band"><div style="display:grid;gap:16px;max-width:500px">';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Band Name *</label><input name="name" required placeholder="e.g. Jazz Ensemble"></div>';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Genre</label><input name="genre" placeholder="e.g. Jazz, Classical, Rock"></div>';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Members (comma-separated names)</label><input name="members" placeholder="John (Trumpet), Jane (Piano), ..."></div>';
    html += '<button type="submit" class="btn">Create Band</button></div></form></div>';
    res.send(page('Create Band', html));
  }));

  app.post(BASE+'/create-band', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { name, genre, members } = req.body;
    const memberArr = members ? members.split(',').map(s => s.trim()).filter(Boolean) : [];
    await pool.query('INSERT INTO band_groups (tenant_id,name,genre,members,conductor_id) VALUES ($1,$2,$3,$4,$5)',
      [tid, name, genre, JSON.stringify(memberArr), req.session.user.id]);
    audit(req, 'band_create', 'Created band: ' + name);
    res.redirect(BASE + '/bands');
  }));

  app.get(BASE+'/edit-band/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM band_groups WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
    if (!rows.length) return res.status(404).send(page('Not Found', '<p>Band not found.</p>'));
    const b = rows[0];
    const memberList = Array.isArray(b.members) ? b.members.join(', ') : '';
    let html = nav(BASE+'/bands') + '<h1 style="font-size:24px;margin-bottom:20px">✏️ Edit Band</h1>';
    html += '<div class="card"><form method="post" action="'+BASE+'/edit-band/'+b.id+'"><div style="display:grid;gap:16px;max-width:500px">';
    html += `<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Band Name *</label><input name="name" value="${esc(b.name)}" required></div>`;
    html += `<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Genre</label><input name="genre" value="${esc(b.genre||'')}"></div>`;
    html += `<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Members</label><textarea name="members" rows="3">${esc(memberList)}</textarea></div>`;
    html += '<div style="display:flex;gap:12px"><button type="submit" class="btn">Save</button><a href="'+BASE+'/bands" class="btn" style="background:'+GRAY+'">Cancel</a></div>';
    html += '</div></form></div>';
    res.send(page('Edit Band', html));
  }));

  app.post(BASE+'/edit-band/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { name, genre, members } = req.body;
    const memberArr = members ? members.split(',').map(s => s.trim()).filter(Boolean) : [];
    await pool.query('UPDATE band_groups SET name=$1,genre=$2,members=$3 WHERE id=$4 AND tenant_id=$5',
      [name, genre, JSON.stringify(memberArr), req.params.id, tid]);
    audit(req, 'band_edit', 'Edited band: ' + name);
    res.redirect(BASE + '/bands');
  }));

  // ---------- Performances ----------
  app.get(BASE+'/performances', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { rows } = await pool.query('SELECT * FROM performances WHERE tenant_id=$1 ORDER BY date DESC', [tid]);
    let html = nav(BASE+'/performances') + '<h1 style="font-size:24px;margin-bottom:20px">🎤 Performances & Concerts</h1>';
    html += '<a href="'+BASE+'/create-performance" class="btn" style="display:inline-block;margin-bottom:16px;background:#dc2626">+ Schedule Performance</a>';
    html += '<div class="card"><table><thead><tr><th>Title</th><th>Date</th><th>Venue</th><th>Type</th><th>Status</th><th>Actions</th></tr></thead><tbody>';
    rows.forEach(p => {
      const statusColor = p.status==='scheduled'?'#2563eb':p.status==='completed'?'#059669':p.status==='cancelled'?'#dc2626':'#6b7280';
      html += `<tr><td>${esc(p.title)}</td><td>${p.date?p.date.toISOString().split('T')[0]:'TBD'}</td><td>${esc(p.venue||'TBD')}</td><td>${esc(p.type||'-')}</td><td><span style="color:${statusColor};font-weight:600">${esc(p.status)}</span></td><td><a href="${BASE}/edit-performance/${p.id}" class="btn" style="padding:4px 10px;font-size:12px">Edit</a></td></tr>`;
    });
    html += '</tbody></table></div>';
    res.send(page('Performances', html));
  }));

  app.get(BASE+'/create-performance', requireAuth, requireNotBanned, ah(async (req, res) => {
    let html = nav(BASE+'/performances') + '<h1 style="font-size:24px;margin-bottom:20px">🎤 Schedule Performance</h1>';
    html += '<div class="card"><form method="post" action="'+BASE+'/create-performance"><div style="display:grid;gap:16px;max-width:500px">';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Title *</label><input name="title" required placeholder="e.g. Spring Concert 2025"></div>';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Date</label><input type="date" name="date"></div>';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Venue</label><input name="venue" placeholder="e.g. School Auditorium"></div>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Type</label><select name="type"><option value="concert">Concert</option><option value="recital">Recital</option><option value="festival">Festival</option><option value="competition">Competition</option><option value="assembly">Assembly</option></select></div><div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Status</label><select name="status"><option value="scheduled">Scheduled</option><option value="rehearsal">In Rehearsal</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select></div></div>';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Performers (comma-separated)</label><input name="performers" placeholder="Jazz Band, Choir Soloists"></div>';
    html += '<button type="submit" class="btn">Schedule Performance</button></div></form></div>';
    res.send(page('Create Performance', html));
  }));

  app.post(BASE+'/create-performance', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { title, date, venue, type, status, performers } = req.body;
    const perfArr = performers ? performers.split(',').map(s => s.trim()).filter(Boolean) : [];
    await pool.query('INSERT INTO performances (tenant_id,title,date,venue,performers,type,status) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [tid, title, date || null, venue, JSON.stringify(perfArr), type, status]);
    audit(req, 'performance_create', 'Scheduled performance: ' + title);
    res.redirect(BASE + '/performances');
  }));

  app.get(BASE+'/edit-performance/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM performances WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
    if (!rows.length) return res.status(404).send(page('Not Found', '<p>Performance not found.</p>'));
    const p = rows[0];
    const perfList = Array.isArray(p.performers) ? p.performers.join(', ') : '';
    let html = nav(BASE+'/performances') + '<h1 style="font-size:24px;margin-bottom:20px">✏️ Edit Performance</h1>';
    html += '<div class="card"><form method="post" action="'+BASE+'/edit-performance/'+p.id+'"><div style="display:grid;gap:16px;max-width:500px">';
    html += `<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Title *</label><input name="title" value="${esc(p.title)}" required></div>`;
    html += `<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Date</label><input type="date" name="date" value="${p.date?p.date.toISOString().split('T')[0]:''}"></div>`;
    html += `<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Venue</label><input name="venue" value="${esc(p.venue||'')}"></div>`;
    html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Type</label><select name="type">`;
    ['concert','recital','festival','competition','assembly'].forEach(t => { html += `<option value="${t}" ${p.type===t?'selected':''}>${t.charAt(0).toUpperCase()+t.slice(1)}</option>`; });
    html += `</select></div><div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Status</label><select name="status">`;
    ['scheduled','rehearsal','completed','cancelled'].forEach(s => { html += `<option value="${s}" ${p.status===s?'selected':''}>${s.charAt(0).toUpperCase()+s.slice(1)}</option>`; });
    html += '</select></div></div>';
    html += `<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Performers</label><input name="performers" value="${esc(perfList)}"></div>`;
    html += '<div style="display:flex;gap:12px"><button type="submit" class="btn">Save</button><a href="'+BASE+'/performances" class="btn" style="background:'+GRAY+'">Cancel</a></div>';
    html += '</div></form></div>';
    res.send(page('Edit Performance', html));
  }));

  app.post(BASE+'/edit-performance/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { title, date, venue, type, status, performers } = req.body;
    const perfArr = performers ? performers.split(',').map(s => s.trim()).filter(Boolean) : [];
    await pool.query('UPDATE performances SET title=$1,date=$2,venue=$3,performers=$4,type=$5,status=$6 WHERE id=$7 AND tenant_id=$8',
      [title, date || null, venue, JSON.stringify(perfArr), type, status, req.params.id, tid]);
    audit(req, 'performance_edit', 'Edited performance: ' + title);
    res.redirect(BASE + '/performances');
  }));

  // ---------- Practice Log ----------
  app.get(BASE+'/practice-log', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const logs = await pool.query('SELECT * FROM practice_logs WHERE tenant_id=$1 AND student_id=$2 ORDER BY date DESC LIMIT 50', [tid, uid]);
    const totalMin = await pool.query('SELECT COALESCE(SUM(duration_min),0)::int AS total FROM practice_logs WHERE tenant_id=$1 AND student_id=$2', [tid, uid]);
    let html = nav(BASE+'/practice-log') + '<h1 style="font-size:24px;margin-bottom:20px">📝 Practice Log</h1>';
    html += '<div class="card" style="border-left:4px solid #7c3aed"><div style="font-size:13px;color:'+GRAY+'">Total Practice Time</div><div style="font-size:28px;font-weight:700;color:#7c3aed">'+Math.floor(totalMin.rows[0].total/60)+'h '+totalMin.rows[0].total%60+'m</div></div>';
    html += '<div class="card"><h2 style="margin-bottom:12px">Log Practice Session</h2><form method="post" action="'+BASE+'/practice-log"><div style="display:grid;gap:12px;max-width:500px">';
    html += `<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Date</label><input type="date" name="date" value="${new Date().toISOString().split('T')[0]}"></div>`;
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Instrument *</label><select name="instrument" required><option value="">Select</option>';
    INSTRUMENT_TYPES.forEach(t => { html += `<option value="${t}">${t}</option>`; });
    html += '</select></div>';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Duration (minutes) *</label><input type="number" name="duration_min" min="1" required placeholder="30"></div>';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Pieces Practiced</label><textarea name="pieces_practiced" rows="2" placeholder="Sonata No. 3, Scales C major..."></textarea></div>';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Notes</label><textarea name="notes" rows="2" placeholder="Focus areas, difficulties..."></textarea></div>';
    html += '<button type="submit" class="btn">Log Session</button></div></form></div>';
    html += '<div class="card"><h2 style="margin-bottom:12px">Session History</h2>';
    if (!logs.rows.length) {
      html += '<p style="color:'+GRAY+'">No practice sessions logged yet.</p>';
    } else {
      html += '<table><thead><tr><th>Date</th><th>Instrument</th><th>Duration</th><th>Pieces</th><th>Notes</th></tr></thead><tbody>';
      logs.rows.forEach(l => {
        html += `<tr><td>${l.date?l.date.toISOString().split('T')[0]:'-'}</td><td>${esc(l.instrument)}</td><td>${l.duration_min} min</td><td>${esc((l.pieces_practiced||'').substring(0,50))}</td><td>${esc((l.notes||'').substring(0,50))}</td></tr>`;
      });
      html += '</tbody></table>';
    }
    html += '</div>';
    res.send(page('Practice Log', html));
  }));

  app.post(BASE+'/practice-log', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { date, instrument, duration_min, pieces_practiced, notes } = req.body;
    if (!instrument || !duration_min) return res.redirect(BASE + '/practice-log');
    await pool.query('INSERT INTO practice_logs (tenant_id,student_id,instrument,duration_min,pieces_practiced,notes,date) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [tid, req.session.user.id, instrument, duration_min, pieces_practiced, notes, date || new Date()]);
    audit(req, 'practice_log', 'Logged ' + duration_min + ' min of ' + instrument);
    res.redirect(BASE + '/practice-log');
  }));

  // ---------- Sheet Music ----------
  app.get(BASE+'/sheet-music', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { rows } = await pool.query('SELECT * FROM sheet_music WHERE tenant_id=$1 ORDER BY title', [tid]);
    let html = nav(BASE+'/sheet-music') + '<h1 style="font-size:24px;margin-bottom:20px">🎼 Sheet Music Library</h1>';
    html += '<a href="'+BASE+'/add-sheet-music" class="btn" style="display:inline-block;margin-bottom:16px;background:#0891b2">+ Add Sheet Music</a>';
    html += '<div class="card"><table><thead><tr><th>Title</th><th>Composer</th><th>Instrument</th><th>Difficulty</th><th>Category</th><th>Actions</th></tr></thead><tbody>';
    rows.forEach(s => {
      const diffColor = s.difficulty==='Beginner'?'#059669':s.difficulty==='Intermediate'?'#2563eb':s.difficulty==='Advanced'?'#d97706':'#dc2626';
      html += `<tr><td>${esc(s.title)}</td><td>${esc(s.composer||'-')}</td><td>${esc(s.instrument||'-')}</td><td><span style="color:${diffColor};font-weight:600">${esc(s.difficulty||'-')}</span></td><td>${esc(s.category||'-')}</td><td><a href="${BASE}/edit-sheet-music/${s.id}" class="btn" style="padding:4px 10px;font-size:12px">Edit</a></td></tr>`;
    });
    html += '</tbody></table></div>';
    res.send(page('Sheet Music', html));
  }));

  app.get(BASE+'/add-sheet-music', requireAuth, requireNotBanned, ah(async (req, res) => {
    let html = nav(BASE+'/sheet-music') + '<h1 style="font-size:24px;margin-bottom:20px">🎼 Add Sheet Music</h1>';
    html += '<div class="card"><form method="post" action="'+BASE+'/add-sheet-music"><div style="display:grid;gap:16px;max-width:500px">';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Title *</label><input name="title" required placeholder="Piece title"></div>';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Composer</label><input name="composer" placeholder="Composer name"></div>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Instrument</label><select name="instrument"><option value="">Any</option>';
    INSTRUMENT_TYPES.forEach(t => { html += `<option value="${t}">${t}</option>`; });
    html += '</select></div><div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Difficulty</label><select name="difficulty">';
    DIFFICULTY_LEVELS.forEach(d => { html += `<option value="${d}">${d}</option>`; });
    html += '</select></div></div>';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Category</label><input name="category" placeholder="e.g. Classical, Pop, Jazz, Folk"></div>';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">File URL</label><input name="file_url" placeholder="https://... (PDF link)"></div>';
    html += '<button type="submit" class="btn">Add Sheet Music</button></div></form></div>';
    res.send(page('Add Sheet Music', html));
  }));

  app.post(BASE+'/add-sheet-music', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { title, composer, instrument, difficulty, category, file_url } = req.body;
    await pool.query('INSERT INTO sheet_music (tenant_id,title,composer,instrument,difficulty,category,file_url) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [tid, title, composer, instrument, difficulty, category, file_url]);
    audit(req, 'sheet_music_add', 'Added sheet music: ' + title);
    res.redirect(BASE + '/sheet-music');
  }));

  app.get(BASE+'/edit-sheet-music/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM sheet_music WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
    if (!rows.length) return res.status(404).send(page('Not Found', '<p>Sheet music not found.</p>'));
    const s = rows[0];
    let html = nav(BASE+'/sheet-music') + '<h1 style="font-size:24px;margin-bottom:20px">✏️ Edit Sheet Music</h1>';
    html += '<div class="card"><form method="post" action="'+BASE+'/edit-sheet-music/'+s.id+'"><div style="display:grid;gap:16px;max-width:500px">';
    html += `<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Title *</label><input name="title" value="${esc(s.title)}" required></div>`;
    html += `<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Composer</label><input name="composer" value="${esc(s.composer||'')}"></div>`;
    html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Instrument</label><select name="instrument"><option value="">Any</option>`;
    INSTRUMENT_TYPES.forEach(t => { html += `<option value="${t}" ${s.instrument===t?'selected':''}>${t}</option>`; });
    html += '</select></div><div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Difficulty</label><select name="difficulty">';
    DIFFICULTY_LEVELS.forEach(d => { html += `<option value="${d}" ${s.difficulty===d?'selected':''}>${d}</option>`; });
    html += '</select></div></div>';
    html += `<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Category</label><input name="category" value="${esc(s.category||'')}"></div>`;
    html += `<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">File URL</label><input name="file_url" value="${esc(s.file_url||'')}"></div>`;
    html += '<div style="display:flex;gap:12px"><button type="submit" class="btn">Save</button><a href="'+BASE+'/sheet-music" class="btn" style="background:'+GRAY+'">Cancel</a></div>';
    html += '</div></form></div>';
    res.send(page('Edit Sheet Music', html));
  }));

  app.post(BASE+'/edit-sheet-music/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { title, composer, instrument, difficulty, category, file_url } = req.body;
    await pool.query('UPDATE sheet_music SET title=$1,composer=$2,instrument=$3,difficulty=$4,category=$5,file_url=$6 WHERE id=$7 AND tenant_id=$8',
      [title, composer, instrument, difficulty, category, file_url, req.params.id, tid]);
    res.redirect(BASE + '/sheet-music');
  }));

  // ---------- Scheduling ----------
  app.get(BASE+'/scheduling', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    const bookings = await pool.query('SELECT rb.*, pr.name AS room_name, u.name AS student_name FROM room_bookings rb JOIN practice_rooms pr ON pr.id=rb.room_id LEFT JOIN users u ON u.id=rb.student_id WHERE rb.tenant_id=$1 AND rb.date >= $2 AND rb.date <= $3 ORDER BY rb.date, rb.start_time', [tid, weekStart, weekEnd]);
    const performances = await pool.query('SELECT * FROM performances WHERE tenant_id=$1 AND date >= $2 AND date <= $3 ORDER BY date', [tid, weekStart, weekEnd]);
    let html = nav(BASE+'/scheduling') + '<h1 style="font-size:24px;margin-bottom:20px">📅 Weekly Schedule</h1>';
    html += `<div class="card" style="background:#eff6ff"><p style="font-size:14px"><strong>Week:</strong> ${weekStart.toISOString().split('T')[0]} — ${weekEnd.toISOString().split('T')[0]}</p></div>`;
    html += '<div class="card"><h2 style="margin-bottom:12px">Room Bookings</h2>';
    if (!bookings.rows.length) {
      html += '<p style="color:'+GRAY+'">No bookings this week.</p>';
    } else {
      const days = {};
      bookings.rows.forEach(b => {
        const d = b.date ? b.date.toISOString().split('T')[0] : 'Unknown';
        if (!days[d]) days[d] = [];
        days[d].push(b);
      });
      Object.keys(days).sort().forEach(day => {
        html += `<div style="margin-bottom:12px"><h4 style="color:${P};font-size:14px;margin-bottom:4px">${day}</h4>`;
        days[day].forEach(b => {
          html += `<div style="padding:6px 12px;background:#f9fafb;border-radius:6px;margin-bottom:4px;font-size:13px"><strong>${esc(b.room_name)}</strong> · ${b.start_time||''}-${b.end_time||''} · ${esc(b.student_name||'N/A')} · ${esc(b.purpose||'')}</div>`;
        });
        html += '</div>';
      });
    }
    html += '</div>';
    html += '<div class="card"><h2 style="margin-bottom:12px">Performances This Week</h2>';
    if (!performances.rows.length) {
      html += '<p style="color:'+GRAY+'">No performances this week.</p>';
    } else {
      performances.rows.forEach(p => {
        html += `<div style="padding:8px 0;border-bottom:1px solid #f3f4f6"><strong>${esc(p.title)}</strong><div style="font-size:12px;color:${GRAY}">${p.date?p.date.toISOString().split('T')[0]:'TBD'} · ${esc(p.venue||'TBD')}</div></div>`;
      });
    }
    html += '</div>';
    res.send(page('Scheduling', html));
  }));

  // ---------- Recordings ----------
  app.get(BASE+'/recordings', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    let html = nav(BASE+'/recordings') + '<h1 style="font-size:24px;margin-bottom:20px">🎙️ Recording Studio</h1>';
    html += '<div class="card" style="border-left:4px solid #7c3aed"><h3 style="margin-bottom:8px">Recording Studio Booking</h3>';
    html += '<form method="post" action="'+BASE+'/recordings"><div style="display:grid;gap:12px;max-width:500px">';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Project Name *</label><input name="project_name" required placeholder="e.g. My Piano Recital Recording"></div>';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Date *</label><input type="date" name="date" required></div>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Start Time</label><input type="time" name="start_time"></div><div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">End Time</label><input type="time" name="end_time"></div></div>';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Purpose</label><textarea name="purpose" rows="2" placeholder="Describe what you want to record"></textarea></div>';
    html += '<button type="submit" class="btn">Book Recording Session</button></div></form></div>';
    html += '<div class="card"><h2 style="margin-bottom:12px">Studio Guidelines</h2>';
    html += '<ul style="font-size:13px;color:'+GRAY+';padding-left:20px;line-height:1.8"><li>Maximum 2 hours per booking session</li><li>Please arrive 15 minutes early for setup</li><li>Bring your own sheet music and instruments (unless pre-arranged)</li><li>Recordings will be shared within 48 hours via email</li><li>Cancellations must be made 24 hours in advance</li><li>A technician will be available to assist with equipment</li></ul></div>';
    html += '<div class="card"><h2 style="margin-bottom:12px">Equipment Available</h2>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px">';
    const equipment = ['Professional Microphones','Audio Interface','Studio Monitors','MIDI Keyboard','Recording Software','Headphone Amp','Pop Filters','Acoustic Panels'];
    equipment.forEach(eq => {
      html += `<div style="padding:10px;background:#f9fafb;border-radius:8px;font-size:13px">🎙️ ${eq}</div>`;
    });
    html += '</div></div>';
    res.send(page('Recording Studio', html));
  }));

  app.post(BASE+'/recordings', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { project_name, date, start_time, end_time, purpose } = req.body;
    if (!project_name || !date) return res.redirect(BASE + '/recordings');
    audit(req, 'recording_book', 'Booked recording: ' + project_name);
    queueEmail(req.session.user.email, 'Recording Studio Booking Confirmed', `Your recording session "${project_name}" on ${date} has been confirmed.`);
    res.send(page('Recording Confirmed', SKIP + '<div style="max-width:600px;margin:40px auto;text-align:center"><div class="card"><div style="font-size:48px;margin-bottom:12px">✅</div><h2 style="margin-bottom:8px">Booking Confirmed!</h2><p style="color:'+GRAY+'">Your recording session "<strong>'+esc(project_name)+'</strong>" on '+esc(date)+' has been booked.</p><a href="'+BASE+'" class="btn" style="display:inline-block;margin-top:16px">Back to Dashboard</a></div></div>'));
  }));
};
