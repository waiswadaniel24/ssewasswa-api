// ============================================================
// PHOTOGRAPHY CLUB MODULE — Multi-Tenant SaaS School Portal
// Photo gallery, contests, equipment checkout, critiques, portfolio
// ============================================================

'use strict';

module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5', GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.btn:hover{background:#3730a3}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}</style>';

  // -- internal helpers ---------------------------------------------------
  const fmtDate = d => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const today = () => new Date().toISOString().slice(0, 10);
  const nav = (active) => `<div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap">
    <a href="/school/photography-club" class="btn ${active==='dash'?'':'btn-outline'}" style="${active==='dash'?'background:#3730a3':''}">📸 Dashboard</a>
    <a href="/school/photography-club/gallery" class="btn ${active==='gallery'?'':'btn-outline'}" style="${active==='gallery'?'background:#3730a3':''}">🖼️ Gallery</a>
    <a href="/school/photography-club/submit-photo" class="btn ${active==='submit'?'':'btn-outline'}" style="${active==='submit'?'background:#3730a3':''}">📤 Submit</a>
    <a href="/school/photography-club/contests" class="btn ${active==='contests'?'':'btn-outline'}" style="${active==='contests'?'background:#3730a3':''}">🏆 Contests</a>
    <a href="/school/photography-club/equipment" class="btn ${active==='equip'?'':'btn-outline'}" style="${active==='equip'?'background:#3730a3':''}">📷 Equipment</a>
    <a href="/school/photography-club/photo-walks" class="btn ${active==='walks'?'':'btn-outline'}" style="${active==='walks'?'background:#3730a3':''}">🚶 Photo Walks</a>
    <a href="/school/photography-club/critiques" class="btn ${active==='critiques'?'':'btn-outline'}" style="${active==='critiques'?'background:#3730a3':''}">💬 Critiques</a>
    <a href="/school/photography-club/my-portfolio" class="btn ${active==='portfolio'?'':'btn-outline'}" style="${active==='portfolio'?'background:#3730a3':''}">📁 My Portfolio</a>
  </div>`;

  const statusBadge = s => {
    const m = { active: '#16a34a', upcoming: '#2563eb', completed: '#9ca3af', cancelled: '#dc2626', open: '#16a34a', closed: '#9ca3af', judging: '#f59e0b' };
    return `<span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;background:${m[s]||GRAY}20;color:${m[s]||GRAY}">${esc(s)}</span>`;
  };

  const statCard = (num, label, color) => `<div class="card" style="text-align:center;padding:16px"><div style="font-size:28px;font-weight:800;color:${color||P}">${num}</div><div style="font-size:12px;color:${GRAY};margin-top:4px">${esc(label)}</div></div>`;

  // ============================================================
  // DATABASE MIGRATIONS
  // ============================================================
  (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS photos (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        student_id INTEGER NOT NULL, title VARCHAR(255), description TEXT,
        image_url VARCHAR(500), category VARCHAR(100), camera_used VARCHAR(255),
        settings JSONB DEFAULT '{}', featured BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS photo_contests (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL, theme VARCHAR(255), deadline DATE,
        prizes TEXT, judge_ids JSONB DEFAULT '[]', status VARCHAR(20) DEFAULT 'open'
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS photography_equipment (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL, type VARCHAR(100), brand VARCHAR(100),
        condition VARCHAR(50) DEFAULT 'good', available BOOLEAN DEFAULT true, checked_out_by INTEGER
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS photo_walks (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        title VARCHAR(255), location TEXT, walk_date TIMESTAMPTZ, max_participants INTEGER DEFAULT 20,
        description TEXT, status VARCHAR(20) DEFAULT 'upcoming'
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS photo_walk_participants (
        id SERIAL PRIMARY KEY, walk_id INTEGER REFERENCES photo_walks(id) ON DELETE CASCADE,
        student_id INTEGER NOT NULL, tenant_id INTEGER NOT NULL, joined_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS photo_critiques (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        photo_id INTEGER REFERENCES photos(id) ON DELETE CASCADE,
        reviewer_id INTEGER NOT NULL, rating INTEGER DEFAULT 5,
        comments TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS photo_contest_entries (
        id SERIAL PRIMARY KEY, contest_id INTEGER REFERENCES photo_contests(id) ON DELETE CASCADE,
        photo_id INTEGER REFERENCES photos(id) ON DELETE CASCADE,
        student_id INTEGER NOT NULL, tenant_id INTEGER NOT NULL,
        submitted_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS photography_tutorials (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        title VARCHAR(255), category VARCHAR(100), content TEXT,
        difficulty VARCHAR(20), created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      // indexes
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_photos_tenant ON photos(tenant_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_photos_student ON photos(tenant_id, student_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_photos_category ON photos(tenant_id, category)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_pc_tenant ON photo_contests(tenant_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_pe_tenant ON photography_equipment(tenant_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_pw_tenant ON photo_walks(tenant_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_crit_tenant ON photo_critiques(tenant_id)`);
      console.log('[PhotographyClub] OK');
    } catch(e) { console.warn('[PhotographyClub] Warn:', e.message); }
  })();

  // ============================================================
  // ROUTE 1: GET /school/photography-club — Dashboard
  // ============================================================
  app.get('/school/photography-club', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, uid = user.id;
    const [photos, contests, equipment, walks, critiques] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int as c FROM photos WHERE tenant_id=$1`, [tid]),
      pool.query(`SELECT * FROM photo_contests WHERE tenant_id=$1 AND status='open' ORDER BY deadline LIMIT 5`, [tid]),
      pool.query(`SELECT * FROM photography_equipment WHERE tenant_id=$1 ORDER BY name`, [tid]),
      pool.query(`SELECT * FROM photo_walks WHERE tenant_id=$1 AND status='upcoming' ORDER BY walk_date LIMIT 5`, [tid]),
      pool.query(`SELECT COUNT(*)::int as c FROM photo_critiques WHERE tenant_id=$1 AND photo_id IN (SELECT id FROM photos WHERE student_id=$2)`, [tid, uid])
    ]);
    const totalPhotos = photos.rows[0].c;
    const totalEquipment = equipment.rows.length;
    const availableEquipment = equipment.rows.filter(e => e.available).length;
    const myCritiques = critiques.rows[0].c;
    const featuredPhotos = (await pool.query(`SELECT p.*, s.name as student_name FROM photos p LEFT JOIN students s ON s.id=p.student_id WHERE p.tenant_id=$1 AND p.featured=true ORDER BY p.created_at DESC LIMIT 6`, [tid])).rows;

    const featuredHtml = featuredPhotos.map(p => `<div class="card" style="padding:12px;text-align:center">
      ${p.image_url ? `<img src="${esc(p.image_url)}" style="width:100%;height:180px;object-fit:cover;border-radius:8px;margin-bottom:8px" alt="${esc(p.title)}">` : `<div style="width:100%;height:180px;background:#f3f4f6;border-radius:8px;display:flex;align-items:center;justify-content:center;color:${GRAY};font-size:40px">📷</div>`}
      <strong style="font-size:13px">${esc(p.title || 'Untitled')}</strong>
      <div style="font-size:11px;color:${GRAY}">by ${esc(p.student_name || 'Unknown')} · ${fmtDate(p.created_at)}</div>
      <div style="font-size:11px;color:${GRAY};margin-top:2px">${esc(p.category || 'General')} ${p.camera_used ? '· ' + esc(p.camera_used) : ''}</div>
    </div>`).join('');

    const contestsHtml = contests.rows.map(c => `<div class="card" style="padding:14px;display:flex;align-items:center;gap:14px">
      <div style="flex:1"><strong style="font-size:14px">${esc(c.title)}</strong><div style="font-size:12px;color:${GRAY};margin-top:2px">${esc(c.theme || 'Open theme')} · Deadline: ${fmtDate(c.deadline)}</div></div>
      ${statusBadge(c.status)}
      <a href="/school/photography-club/contests" class="btn" style="font-size:12px;padding:6px 12px">View</a>
    </div>`).join('');

    const walksHtml = walks.rows.map(w => `<div class="card" style="padding:14px;display:flex;align-items:center;gap:14px">
      <div style="font-size:28px">🚶</div>
      <div style="flex:1"><strong style="font-size:14px">${esc(w.title)}</strong><div style="font-size:12px;color:${GRAY};margin-top:2px">${esc(w.location || 'TBD')} · ${fmtDate(w.walk_date)}</div></div>
      ${statusBadge(w.status)}
    </div>`).join('');

    const html = SKIP + `<div style="max-width:1200px;margin:0 auto">${nav('dash')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;margin:0">📸 Photography Club</h1><p style="color:${GRAY};font-size:13px;margin:4px 0 0">Capture moments, build skills, share your vision</p></div>
        <a href="/school/photography-club/submit-photo" class="btn" style="padding:10px 20px;font-size:14px">📤 Submit Photo</a>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;margin-bottom:20px">
        ${statCard(totalPhotos, 'Total Photos', P)}
        ${statCard(contests.rows.length, 'Active Contests', '#16a34a')}
        ${statCard(totalEquipment, 'Equipment Items', '#f59e0b')}
        ${statCard(availableEquipment, 'Available', '#2563eb')}
        ${statCard(myCritiques, 'My Critiques', '#8b5cf6')}
        ${statCard(walks.rows.length, 'Upcoming Walks', '#ec4899')}
      </div>
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:16px;margin-bottom:20px">
        <div class="card"><h3 style="margin:0 0 14px;font-size:15px">🌟 Featured Photos</h3>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">${featuredHtml || '<p style="color:${GRAY};text-align:center;grid-column:1/-1;padding:20px">No featured photos yet</p>'}</div>
        </div>
        <div class="card"><h3 style="margin:0 0 14px;font-size:15px">🏆 Active Contests</h3>${contestsHtml || '<p style="color:${GRAY};text-align:center;padding:20px">No active contests</p>'}</div>
      </div>
      <div class="card"><h3 style="margin:0 0 14px;font-size:15px">🚶 Upcoming Photo Walks</h3>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px">${walksHtml || '<p style="color:${GRAY};text-align:center;padding:20px">No upcoming walks</p>'}</div>
      </div>
    </div>`;
    res.send(renderPage('Photography Club', html, user, req));
  }));

  // ============================================================
  // ROUTE 2: GET /school/photography-club/gallery — Gallery
  // ============================================================
  app.get('/school/photography-club/gallery', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const cat = req.query.category || '';
    const search = req.query.q || '';
    let where = ['p.tenant_id=$1'], params = [tid], pi = 2;
    if (cat) { where.push(`p.category=$${pi++}`); params.push(cat); }
    if (search) { where.push(`(p.title ILIKE $${pi} OR p.description ILIKE $${pi})`); params.push(`%${search}%`); pi++; }
    const photos = (await pool.query(
      `SELECT p.*, s.name as student_name FROM photos p LEFT JOIN students s ON s.id=p.student_id WHERE ${where.join(' AND ')} ORDER BY p.created_at DESC LIMIT 60`, params
    )).rows;
    const categories = (await pool.query(`SELECT DISTINCT category FROM photos WHERE tenant_id=$1 ORDER BY category`, [tid])).rows.map(r => r.category).filter(Boolean);

    const photosHtml = photos.map(p => `<div class="card" style="padding:0;overflow:hidden">
      ${p.image_url ? `<img src="${esc(p.image_url)}" style="width:100%;height:200px;object-fit:cover" alt="${esc(p.title)}">` : `<div style="width:100%;height:200px;background:#f3f4f6;display:flex;align-items:center;justify-content:center;font-size:48px">📷</div>`}
      <div style="padding:12px"><strong style="font-size:13px">${esc(p.title || 'Untitled')}</strong>
        <div style="font-size:11px;color:${GRAY};margin-top:4px">by ${esc(p.student_name || 'Unknown')}</div>
        <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">
          ${p.category ? `<span style="background:#eef2ff;color:${P};padding:2px 8px;border-radius:12px;font-size:10px">${esc(p.category)}</span>` : ''}
          ${p.camera_used ? `<span style="background:#fef3c7;color:#d97706;padding:2px 8px;border-radius:12px;font-size:10px">${esc(p.camera_used)}</span>` : ''}
          ${p.featured ? '<span style="background:#fef2f2;color:#dc2626;padding:2px 8px;border-radius:12px;font-size:10px">⭐ Featured</span>' : ''}
        </div>
      </div>
    </div>`).join('');

    const catTabs = ['', ...categories].map(c => `<a href="/school/photography-club/gallery?category=${encodeURIComponent(c)}" style="padding:6px 14px;border-radius:20px;font-size:12px;text-decoration:none;color:${GRAY};background:#f3f4f6;${cat===c?'background:'+P+';color:#fff':''}">${c ? esc(c) : 'All'}</a>`).join(' ');

    const html = SKIP + `<div style="max-width:1200px;margin:0 auto">${nav('gallery')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;margin:0">🖼️ Photo Gallery</h1><p style="color:${GRAY};font-size:13px;margin:4px 0 0">${photos.length} photos</p></div>
        <form method="GET" style="display:flex;gap:8px"><input type="text" name="q" value="${esc(search)}" placeholder="Search photos..." style="width:220px"><button class="btn" style="padding:8px 16px">Search</button></form>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap">${catTabs}</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:16px">${photosHtml || '<p style="color:${GRAY};text-align:center;padding:40px;grid-column:1/-1">No photos found</p>'}</div>
    </div>`;
    res.send(renderPage('Photo Gallery', html, user, req));
  }));

  // ============================================================
  // ROUTE 3: GET /school/photography-club/submit-photo — Submit
  // ============================================================
  app.get('/school/photography-club/submit-photo', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const contests = (await pool.query(`SELECT id, title FROM photo_contests WHERE tenant_id=$1 AND status='open'`, [tid])).rows;
    const categories = ['Landscape', 'Portrait', 'Street', 'Nature', 'Architecture', 'Sports', 'Macro', 'Abstract', 'Events', 'Other'];
    const catOpts = categories.map(c => `<option value="${c}">${c}</option>`).join('');
    const contestOpts = contests.map(c => `<option value="${c.id}">${esc(c.title)}</option>`).join('');
    const html = SKIP + `<div style="max-width:700px;margin:0 auto">${nav('submit')}
      <div class="card" style="padding:28px">
        <h2 style="margin:0 0 4px">📤 Submit a Photo</h2>
        <p style="color:${GRAY};font-size:13px;margin-bottom:24px">Share your best shots with the club</p>
        <form method="POST" action="/school/photography-club/submit-photo" style="display:flex;flex-direction:column;gap:16px">
          <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Title *</label><input type="text" name="title" required placeholder="Give your photo a title"></div>
          <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Description</label><textarea name="description" rows="3" placeholder="Tell the story behind this photo..."></textarea></div>
          <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Image URL *</label><input type="url" name="image_url" required placeholder="https://example.com/photo.jpg"></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Category</label><select name="category"><option value="">Select category</option>${catOpts}</select></div>
            <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Camera Used</label><input type="text" name="camera_used" placeholder="e.g., Canon EOS R5"></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px">
            <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Aperture</label><input type="text" name="aperture" placeholder="f/2.8"></div>
            <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Shutter Speed</label><input type="text" name="shutter" placeholder="1/250s"></div>
            <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">ISO</label><input type="text" name="iso" placeholder="400"></div>
          </div>
          <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Submit to Contest (optional)</label><select name="contest_id"><option value="">No contest</option>${contestOpts}</select></div>
          <button type="submit" class="btn" style="padding:12px 24px;font-size:15px">Submit Photo</button>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Submit Photo', html, user, req));
  }));

  // ============================================================
  // ROUTE 4: POST /school/photography-club/submit-photo
  // ============================================================
  app.post('/school/photography-club/submit-photo', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { title, description, image_url, category, camera_used, aperture, shutter, iso, contest_id } = req.body;
    if (!title || !title.trim() || !image_url || !image_url.trim()) {
      req.session.flash = { type: 'error', msg: 'Title and image URL are required' };
      return res.redirect('/school/photography-club/submit-photo');
    }
    const settings = {};
    if (aperture) settings.aperture = aperture.trim();
    if (shutter) settings.shutter = shutter.trim();
    if (iso) settings.iso = iso.trim();
    const photoResult = await pool.query(
      `INSERT INTO photos (tenant_id, student_id, title, description, image_url, category, camera_used, settings) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [tid, user.id, title.trim(), description ? description.trim() : null, image_url.trim(), category || null, camera_used ? camera_used.trim() : null, JSON.stringify(settings)]
    );
    if (contest_id) {
      await pool.query(`INSERT INTO photo_contest_entries (contest_id, photo_id, student_id, tenant_id) VALUES ($1,$2,$3,$4)`,
        [contest_id, photoResult.rows[0].id, user.id, tid]);
    }
    await audit(tid, user.id, 'photo_submit', { title: title.trim(), category });
    req.session.flash = { type: 'success', msg: 'Photo submitted successfully!' };
    res.redirect('/school/photography-club/gallery');
  }));

  // ============================================================
  // ROUTE 5: GET /school/photography-club/contests — Contests
  // ============================================================
  app.get('/school/photography-club/contests', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const contests = (await pool.query(`SELECT c.*, (SELECT COUNT(*)::int FROM photo_contest_entries ce WHERE ce.contest_id=c.id) as entry_count FROM photo_contests c WHERE c.tenant_id=$1 ORDER BY c.deadline DESC NULLS LAST`, [tid])).rows;

    const contestsHtml = contests.map(c => `<div class="card" style="padding:20px;display:flex;align-items:flex-start;gap:16px">
      <div style="width:56px;height:56px;border-radius:12px;background:${c.status==='open'?'#eef2ff':'#f3f4f6'};display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0">🏆</div>
      <div style="flex:1">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><strong style="font-size:15px">${esc(c.title)}</strong>${statusBadge(c.status)}</div>
        <div style="font-size:13px;color:${GRAY};margin-top:4px">Theme: <strong>${esc(c.theme || 'Open')}</strong> · Deadline: ${fmtDate(c.deadline)} · ${c.entry_count} entries</div>
        ${c.prizes ? `<div style="font-size:12px;color:${GRAY};margin-top:4px">🎁 Prizes: ${esc(c.prizes)}</div>` : ''}
      </div>
      <div style="display:flex;gap:8px">
        ${c.status === 'open' ? `<a href="/school/photography-club/submit-photo" class="btn" style="font-size:12px">Enter</a>` : ''}
      </div>
    </div>`).join('');

    const html = SKIP + `<div style="max-width:1000px;margin:0 auto">${nav('contests')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;margin:0">🏆 Photography Contests</h1><p style="color:${GRAY};font-size:13px;margin:4px 0 0">Compete, win prizes, showcase your talent</p></div>
        ${user.role === 'admin' || user.role === 'teacher' ? `<a href="/school/photography-club/contests/create" class="btn" style="background:#16a34a">+ Create Contest</a>` : ''}
      </div>
      ${contestsHtml || '<div class="card" style="text-align:center;padding:40px;color:${GRAY}"><p style="font-size:40px;margin-bottom:12px">🏆</p><p>No contests yet. Stay tuned!</p></div>'}
    </div>`;
    res.send(renderPage('Photo Contests', html, user, req));
  }));

  // ============================================================
  // ROUTE 6: GET /school/photography-club/contests/create
  // ============================================================
  app.get('/school/photography-club/contests/create', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user;
    if (user.role !== 'admin' && user.role !== 'teacher') return res.redirect('/school/photography-club/contests');
    const html = SKIP + `<div style="max-width:700px;margin:0 auto">${nav('contests')}
      <a href="/school/photography-club/contests" style="color:${GRAY};text-decoration:none;font-size:14px">← Back to Contests</a>
      <div class="card" style="padding:28px;margin-top:12px">
        <h2 style="margin:0 0 4px">🏆 Create Contest</h2>
        <p style="color:${GRAY};font-size:13px;margin-bottom:24px">Set up a new photography competition</p>
        <form method="POST" action="/school/photography-club/contests/create" style="display:flex;flex-direction:column;gap:16px">
          <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Contest Title *</label><input type="text" name="title" required placeholder="e.g., Spring Nature Photography"></div>
          <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Theme</label><input type="text" name="theme" placeholder="e.g., Wildlife in Spring"></div>
          <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Deadline *</label><input type="date" name="deadline" required></div>
          <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Prizes</label><textarea name="prizes" rows="2" placeholder="e.g., 1st: Camera bag, 2nd: Memory card..."></textarea></div>
          <button type="submit" class="btn" style="padding:12px 24px;font-size:15px;background:#16a34a">Create Contest</button>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Create Contest', html, user, req));
  }));

  // ============================================================
  // ROUTE 7: POST /school/photography-club/contests/create
  // ============================================================
  app.post('/school/photography-club/contests/create', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    if (user.role !== 'admin' && user.role !== 'teacher') return res.redirect('/school/photography-club/contests');
    const { title, theme, deadline, prizes } = req.body;
    if (!title || !title.trim() || !deadline) {
      req.session.flash = { type: 'error', msg: 'Title and deadline are required' };
      return res.redirect('/school/photography-club/contests/create');
    }
    await pool.query(`INSERT INTO photo_contests (tenant_id, title, theme, deadline, prizes) VALUES ($1,$2,$3,$4,$5)`,
      [tid, title.trim(), theme ? theme.trim() : null, deadline, prizes ? prizes.trim() : null]);
    await audit(tid, user.id, 'contest_create', { title: title.trim() });
    req.session.flash = { type: 'success', msg: 'Contest created!' };
    res.redirect('/school/photography-club/contests');
  }));

  // ============================================================
  // ROUTE 8: GET /school/photography-club/equipment — Equipment
  // ============================================================
  app.get('/school/photography-club/equipment', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const equipment = (await pool.query(`SELECT e.*, s.name as checked_by_name FROM photography_equipment e LEFT JOIN students s ON s.id=e.checked_out_by WHERE e.tenant_id=$1 ORDER BY e.name`, [tid])).rows;

    const rowsHtml = equipment.map(e => `<tr>
      <td><strong>${esc(e.name)}</strong></td>
      <td>${esc(e.type || '—')}</td>
      <td>${esc(e.brand || '—')}</td>
      <td><span style="padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;background:${e.condition==='excellent'?'#dcfce7':e.condition==='good'?'#fef9c3':'#fee2e2'};color:${e.condition==='excellent'?'#16a34a':e.condition==='good'?'#ca8a04':'#dc2626'}">${esc(e.condition || 'good')}</span></td>
      <td>${e.available ? '<span style="color:#16a34a;font-weight:600">✅ Available</span>' : `<span style="color:#dc2626">Checked out by ${esc(e.checked_by_name || 'Unknown')}</span>`}</td>
      <td>${e.available ? `<form method="POST" action="/school/photography-club/equipment/${e.id}/checkout"><button class="btn" style="font-size:11px;padding:4px 12px">Check Out</button></form>` : `<form method="POST" action="/school/photography-club/equipment/${e.id}/return"><button class="btn" style="font-size:11px;padding:4px 12px;background:#16a34a">Return</button></form>`}</td>
    </tr>`).join('');

    const html = SKIP + `<div style="max-width:1100px;margin:0 auto">${nav('equip')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;margin:0">📷 Equipment Library</h1><p style="color:${GRAY};font-size:13px;margin:4px 0 0">Borrow cameras, lenses, and accessories</p></div>
        ${(user.role === 'admin' || user.role === 'teacher') ? `<a href="/school/photography-club/equipment/add" class="btn" style="background:#16a34a">+ Add Equipment</a>` : ''}
      </div>
      <div class="card"><div style="overflow-x:auto"><table>
        <thead><tr><th>Item</th><th>Type</th><th>Brand</th><th>Condition</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>${rowsHtml || '<tr><td colspan="6" style="text-align:center;color:${GRAY};padding:30px">No equipment listed</td></tr>'}</tbody>
      </table></div></div>
    </div>`;
    res.send(renderPage('Equipment', html, user, req));
  }));

  // ============================================================
  // ROUTE 9: GET /school/photography-club/equipment/add
  // ============================================================
  app.get('/school/photography-club/equipment/add', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user;
    if (user.role !== 'admin' && user.role !== 'teacher') return res.redirect('/school/photography-club/equipment');
    const types = ['Camera', 'Lens', 'Tripod', 'Flash', 'Filter', 'Memory Card', 'Battery', 'Bag', 'Reflector', 'Other'];
    const html = SKIP + `<div style="max-width:600px;margin:0 auto">${nav('equip')}
      <a href="/school/photography-club/equipment" style="color:${GRAY};text-decoration:none;font-size:14px">← Back to Equipment</a>
      <div class="card" style="padding:28px;margin-top:12px">
        <h2 style="margin:0 0 20px">➕ Add Equipment</h2>
        <form method="POST" action="/school/photography-club/equipment/add" style="display:flex;flex-direction:column;gap:16px">
          <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Name *</label><input type="text" name="name" required placeholder="e.g., Canon EOS R6"></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Type</label><select name="type">${types.map(t => `<option value="${t}">${t}</option>`).join('')}</select></div>
            <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Brand</label><input type="text" name="brand" placeholder="e.g., Canon"></div>
          </div>
          <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Condition</label><select name="condition"><option value="excellent">Excellent</option><option value="good" selected>Good</option><option value="fair">Fair</option></select></div>
          <button type="submit" class="btn" style="background:#16a34a;padding:12px">Add Equipment</button>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Add Equipment', html, user, req));
  }));

  // ============================================================
  // ROUTE 10: POST /school/photography-club/equipment/add
  // ============================================================
  app.post('/school/photography-club/equipment/add', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    if (user.role !== 'admin' && user.role !== 'teacher') return res.redirect('/school/photography-club/equipment');
    const { name, type, brand, condition } = req.body;
    if (!name || !name.trim()) return res.redirect('/school/photography-club/equipment/add');
    await pool.query(`INSERT INTO photography_equipment (tenant_id, name, type, brand, condition) VALUES ($1,$2,$3,$4,$5)`,
      [tid, name.trim(), type || null, brand ? brand.trim() : null, condition || 'good']);
    await audit(tid, user.id, 'equip_add', { name: name.trim() });
    req.session.flash = { type: 'success', msg: 'Equipment added!' };
    res.redirect('/school/photography-club/equipment');
  }));

  // ============================================================
  // ROUTE 11: POST equipment checkout/return
  // ============================================================
  app.post('/school/photography-club/equipment/:id/checkout', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id, eid = req.params.id, uid = req.session.user.id;
    const eq = (await pool.query(`SELECT id, available FROM photography_equipment WHERE id=$1 AND tenant_id=$2`, [eid, tid])).rows[0];
    if (!eq || !eq.available) { req.session.flash = { type: 'error', msg: 'Item not available' }; return res.redirect('/school/photography-club/equipment'); }
    await pool.query(`UPDATE photography_equipment SET available=false, checked_out_by=$1 WHERE id=$2 AND tenant_id=$3`, [uid, eid, tid]);
    await audit(tid, uid, 'equip_checkout', { equipment_id: parseInt(eid) });
    req.session.flash = { type: 'success', msg: 'Equipment checked out!' };
    res.redirect('/school/photography-club/equipment');
  }));

  app.post('/school/photography-club/equipment/:id/return', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id, eid = req.params.id, uid = req.session.user.id;
    await pool.query(`UPDATE photography_equipment SET available=true, checked_out_by=NULL WHERE id=$1 AND tenant_id=$2`, [eid, tid]);
    await audit(tid, uid, 'equip_return', { equipment_id: parseInt(eid) });
    req.session.flash = { type: 'success', msg: 'Equipment returned!' };
    res.redirect('/school/photography-club/equipment');
  }));

  // ============================================================
  // ROUTE 12: GET /school/photography-club/photo-walks
  // ============================================================
  app.get('/school/photography-club/photo-walks', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const walks = (await pool.query(`SELECT pw.*, (SELECT COUNT(*)::int FROM photo_walk_participants pwp WHERE pwp.walk_id=pw.id) as participant_count FROM photo_walks pw WHERE pw.tenant_id=$1 ORDER BY pw.walk_date DESC NULLS LAST`, [tid])).rows;
    const myWalks = (await pool.query(`SELECT walk_id FROM photo_walk_participants WHERE tenant_id=$1 AND student_id=$2`, [tid, user.id])).rows.map(r => r.walk_id);

    const walksHtml = walks.map(w => {
      const joined = myWalks.includes(w.id);
      const spotsLeft = (w.max_participants || 20) - w.participant_count;
      return `<div class="card" style="padding:20px">
        <div style="display:flex;align-items:flex-start;gap:16px">
          <div style="font-size:36px">🚶</div>
          <div style="flex:1">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><strong style="font-size:16px">${esc(w.title)}</strong>${statusBadge(w.status)}</div>
            <div style="font-size:13px;color:${GRAY};margin-top:6px">📍 ${esc(w.location || 'TBD')} · 📅 ${fmtDate(w.walk_date)} · 👥 ${w.participant_count}/${w.max_participants || 20} participants</div>
            ${w.description ? `<div style="font-size:13px;margin-top:8px;color:#374151">${esc(w.description)}</div>` : ''}
            <div style="margin-top:10px;display:flex;gap:8px">
              ${w.status === 'upcoming' ? (joined
                ? `<span style="color:#16a34a;font-weight:600;font-size:13px">✅ Joined</span><form method="POST" action="/school/photography-club/photo-walks/${w.id}/leave"><button class="btn" style="font-size:11px;padding:4px 12px;background:#dc2626">Leave</button></form>`
                : (spotsLeft > 0 ? `<form method="POST" action="/school/photography-club/photo-walks/${w.id}/join"><button class="btn" style="font-size:11px;padding:4px 12px;background:#16a34a">Join Walk</button></form>` : '<span style="color:#dc2626;font-size:12px">Full</span>'))
                : ''}
            </div>
          </div>
        </div>
      </div>`;
    }).join('');

    const html = SKIP + `<div style="max-width:900px;margin:0 auto">${nav('walks')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;margin:0">🚶 Photo Walks</h1><p style="color:${GRAY};font-size:13px;margin:4px 0 0">Explore and photograph together</p></div>
        ${(user.role === 'admin' || user.role === 'teacher') ? `<a href="/school/photography-club/photo-walks/create" class="btn" style="background:#16a34a">+ Schedule Walk</a>` : ''}
      </div>
      ${walksHtml || '<div class="card" style="text-align:center;padding:40px;color:${GRAY}"><p style="font-size:40px;margin-bottom:12px">🚶</p>No photo walks scheduled yet</div>'}
    </div>`;
    res.send(renderPage('Photo Walks', html, user, req));
  }));

  // ============================================================
  // ROUTE 13: GET/POST photo-walks create, join, leave
  // ============================================================
  app.get('/school/photography-club/photo-walks/create', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user;
    if (user.role !== 'admin' && user.role !== 'teacher') return res.redirect('/school/photography-club/photo-walks');
    const html = SKIP + `<div style="max-width:700px;margin:0 auto">${nav('walks')}
      <a href="/school/photography-club/photo-walks" style="color:${GRAY};text-decoration:none;font-size:14px">← Back</a>
      <div class="card" style="padding:28px;margin-top:12px">
        <h2 style="margin:0 0 20px">➕ Schedule Photo Walk</h2>
        <form method="POST" action="/school/photography-club/photo-walks/create" style="display:flex;flex-direction:column;gap:16px">
          <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Title *</label><input type="text" name="title" required placeholder="e.g., Golden Hour at the Park"></div>
          <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Location *</label><input type="text" name="location" required placeholder="e.g., Central Park, Main Gate"></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Date & Time *</label><input type="datetime-local" name="walk_date" required></div>
            <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Max Participants</label><input type="number" name="max_participants" value="20" min="2"></div>
          </div>
          <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Description</label><textarea name="description" rows="3" placeholder="What to bring, meeting point, focus themes..."></textarea></div>
          <button type="submit" class="btn" style="background:#16a34a;padding:12px">Schedule Walk</button>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Schedule Photo Walk', html, user, req));
  }));

  app.post('/school/photography-club/photo-walks/create', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    if (user.role !== 'admin' && user.role !== 'teacher') return res.redirect('/school/photography-club/photo-walks');
    const { title, location, walk_date, max_participants, description } = req.body;
    if (!title?.trim() || !walk_date) return res.redirect('/school/photography-club/photo-walks/create');
    await pool.query(`INSERT INTO photo_walks (tenant_id, title, location, walk_date, max_participants, description) VALUES ($1,$2,$3,$4,$5,$6)`,
      [tid, title.trim(), location ? location.trim() : null, walk_date, max_participants ? parseInt(max_participants) : 20, description ? description.trim() : null]);
    await audit(tid, user.id, 'walk_create', { title: title.trim() });
    req.session.flash = { type: 'success', msg: 'Photo walk scheduled!' };
    res.redirect('/school/photography-club/photo-walks');
  }));

  app.post('/school/photography-club/photo-walks/:id/join', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id, uid = req.session.user.id, wid = req.params.id;
    const existing = (await pool.query(`SELECT id FROM photo_walk_participants WHERE walk_id=$1 AND student_id=$2 AND tenant_id=$3`, [wid, uid, tid])).rows[0];
    if (!existing) {
      await pool.query(`INSERT INTO photo_walk_participants (walk_id, student_id, tenant_id) VALUES ($1,$2,$3)`, [wid, uid, tid]);
      await audit(tid, uid, 'walk_join', { walk_id: parseInt(wid) });
    }
    res.redirect('/school/photography-club/photo-walks');
  }));

  app.post('/school/photography-club/photo-walks/:id/leave', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id, uid = req.session.user.id, wid = req.params.id;
    await pool.query(`DELETE FROM photo_walk_participants WHERE walk_id=$1 AND student_id=$2 AND tenant_id=$3`, [wid, uid, tid]);
    res.redirect('/school/photography-club/photo-walks');
  }));

  // ============================================================
  // ROUTE 14: GET /school/photography-club/critiques — Critiques
  // ============================================================
  app.get('/school/photography-club/critiques', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const recentPhotos = (await pool.query(`SELECT p.*, s.name as student_name FROM photos p LEFT JOIN students s ON s.id=p.student_id WHERE p.tenant_id=$1 ORDER BY p.created_at DESC LIMIT 20`, [tid])).rows;
    const existingCritiques = (await pool.query(`SELECT photo_id FROM photo_critiques WHERE tenant_id=$1 AND reviewer_id=$2`, [tid, user.id])).rows.map(r => r.photo_id);

    const photosHtml = recentPhotos.map(p => {
      const critiqued = existingCritiques.includes(p.id);
      return `<div class="card" style="padding:16px;display:flex;gap:14px">
        ${p.image_url ? `<img src="${esc(p.image_url)}" style="width:120px;height:90px;object-fit:cover;border-radius:8px;flex-shrink:0" alt="">` : '<div style="width:120px;height:90px;background:#f3f4f6;border-radius:8px;flex-shrink:0;display:flex;align-items:center;justify-content:center">📷</div>'}
        <div style="flex:1">
          <strong style="font-size:14px">${esc(p.title || 'Untitled')}</strong>
          <div style="font-size:12px;color:${GRAY};margin-top:2px">by ${esc(p.student_name || 'Unknown')} · ${fmtDate(p.created_at)}</div>
          ${p.description ? `<div style="font-size:12px;color:#4b5563;margin-top:4px">${esc(p.description.substring(0, 120))}${p.description.length > 120 ? '...' : ''}</div>` : ''}
          <div style="margin-top:8px">${critiqued ? '<span style="color:#16a34a;font-size:12px;font-weight:600">✅ Critiqued</span>' : `<form method="POST" action="/school/photography-club/critiques/${p.id}" style="display:flex;gap:8px;align-items:center">
            <select name="rating" style="width:80px"><option value="10">10</option><option value="9">9</option><option value="8" selected>8</option><option value="7">7</option><option value="6">6</option><option value="5">5</option><option value="4">4</option><option value="3">3</option><option value="2">2</option><option value="1">1</option></select>
            <input type="text" name="comments" placeholder="Your feedback..." style="flex:1">
            <button type="submit" class="btn" style="font-size:11px;padding:6px 12px">Submit</button>
          </form>`}</div>
        </div>
      </div>`;
    }).join('');

    const html = SKIP + `<div style="max-width:900px;margin:0 auto">${nav('critiques')}
      <div><h1 style="font-size:24px;margin:0">💬 Critique Sessions</h1><p style="color:${GRAY};font-size:13px;margin:4px 0 0">Give and receive constructive feedback</p></div>
      <div style="margin-top:20px">${photosHtml || '<div class="card" style="text-align:center;padding:40px;color:${GRAY}">No photos to critique yet</div>'}</div>
    </div>`;
    res.send(renderPage('Critique Sessions', html, user, req));
  }));

  // ============================================================
  // ROUTE 15: POST /school/photography-club/critiques/:id
  // ============================================================
  app.post('/school/photography-club/critiques/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id, uid = req.session.user.id, photoId = req.params.id;
    const { rating, comments } = req.body;
    const existing = (await pool.query(`SELECT id FROM photo_critiques WHERE tenant_id=$1 AND reviewer_id=$2 AND photo_id=$3`, [tid, uid, photoId])).rows[0];
    if (existing) { req.session.flash = { type: 'error', msg: 'Already critiqued this photo' }; return res.redirect('/school/photography-club/critiques'); }
    await pool.query(`INSERT INTO photo_critiques (tenant_id, photo_id, reviewer_id, rating, comments) VALUES ($1,$2,$3,$4,$5)`,
      [tid, photoId, uid, rating ? parseInt(rating) : 5, comments ? comments.trim() : null]);
    await audit(tid, uid, 'critique_submit', { photo_id: parseInt(photoId), rating: rating ? parseInt(rating) : 5 });
    req.session.flash = { type: 'success', msg: 'Critique submitted!' };
    res.redirect('/school/photography-club/critiques');
  }));

  // ============================================================
  // ROUTE 16: GET /school/photography-club/my-portfolio — Portfolio
  // ============================================================
  app.get('/school/photography-club/my-portfolio', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, uid = user.id;
    const photos = (await pool.query(`SELECT p.*, (SELECT AVG(rating)::numeric(3,1) FROM photo_critiques WHERE photo_id=p.id) as avg_rating, (SELECT COUNT(*)::int FROM photo_critiques WHERE photo_id=p.id) as critique_count FROM photos p WHERE p.tenant_id=$1 AND p.student_id=$2 ORDER BY p.created_at DESC`, [tid, uid])).rows;
    const totalCritiques = photos.reduce((s, p) => s + (p.critique_count || 0), 0);
    const avgRating = photos.length > 0 ? (photos.reduce((s, p) => s + parseFloat(p.avg_rating || 0), 0) / photos.length).toFixed(1) : '—';
    const featuredCount = photos.filter(p => p.featured).length;

    const photosHtml = photos.map(p => `<div class="card" style="padding:0;overflow:hidden">
      ${p.image_url ? `<img src="${esc(p.image_url)}" style="width:100%;height:180px;object-fit:cover" alt="${esc(p.title)}">` : `<div style="width:100%;height:180px;background:#f3f4f6;display:flex;align-items:center;justify-content:center;font-size:40px">📷</div>`}
      <div style="padding:12px">
        <div style="display:flex;align-items:center;justify-content:space-between"><strong style="font-size:13px">${esc(p.title || 'Untitled')}</strong>${p.featured ? '⭐' : ''}</div>
        <div style="font-size:11px;color:${GRAY};margin-top:4px">${esc(p.category || 'General')} ${p.camera_used ? '· ' + esc(p.camera_used) : ''} · ${fmtDate(p.created_at)}</div>
        <div style="font-size:12px;margin-top:6px;color:${P}">⭐ ${esc(p.avg_rating || '—')} (${p.critique_count || 0} critiques)</div>
        <div style="margin-top:8px;display:flex;gap:6px">
          <form method="POST" action="/school/photography-club/photos/${p.id}/toggle-feature" style="display:inline"><button class="btn" style="font-size:10px;padding:4px 10px;${p.featured ? 'background:#dc2626' : 'background:#16a34a'}">${p.featured ? 'Unfeature' : '⭐ Feature'}</button></form>
          <form method="POST" action="/school/photography-club/photos/${p.id}/delete" style="display:inline" onsubmit="return confirm('Delete this photo?')"><button class="btn" style="font-size:10px;padding:4px 10px;background:#dc2626">Delete</button></form>
        </div>
      </div>
    </div>`).join('');

    const html = SKIP + `<div style="max-width:1100px;margin:0 auto">${nav('portfolio')}
      <div><h1 style="font-size:24px;margin:0">📁 My Portfolio</h1><p style="color:${GRAY};font-size:13px;margin:4px 0 0">Your photography journey</p></div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-top:20px">
        ${statCard(photos.length, 'My Photos', P)}
        ${statCard(featuredCount, 'Featured', '#f59e0b')}
        ${statCard(totalCritiques, 'Critiques Received', '#16a34a')}
        ${statCard(avgRating, 'Avg Rating', '#8b5cf6')}
      </div>
      <div style="margin-top:20px;display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:16px">
        ${photosHtml || '<div class="card" style="text-align:center;padding:40px;color:${GRAY};grid-column:1/-1"><p style="font-size:40px;margin-bottom:12px">📸</p>You haven\'t submitted any photos yet.<br><a href="/school/photography-club/submit-photo" style="color:${P}">Submit your first photo</a></div>'}
      </div>
    </div>`;
    res.send(renderPage('My Portfolio', html, user, req));
  }));

  // ============================================================
  // ROUTE 17: POST portfolio actions
  // ============================================================
  app.post('/school/photography-club/photos/:id/toggle-feature', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id, uid = req.session.user.id, pid = req.params.id;
    const photo = (await pool.query(`SELECT id FROM photos WHERE id=$1 AND tenant_id=$2 AND student_id=$3`, [pid, tid, uid])).rows[0];
    if (!photo) return res.redirect('/school/photography-club/my-portfolio');
    await pool.query(`UPDATE photos SET featured = NOT featured WHERE id=$1`, [pid]);
    res.redirect('/school/photography-club/my-portfolio');
  }));

  app.post('/school/photography-club/photos/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id, uid = req.session.user.id, pid = req.params.id;
    await pool.query(`DELETE FROM photos WHERE id=$1 AND tenant_id=$2 AND student_id=$3`, [pid, tid, uid]);
    req.session.flash = { type: 'success', msg: 'Photo deleted' };
    res.redirect('/school/photography-club/my-portfolio');
  }));
};
