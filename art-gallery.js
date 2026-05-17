module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5', GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.btn:hover{background:#3730a3}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}</style>';

  (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS artworks (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        title VARCHAR(255) NOT NULL,
        artist_id INTEGER NOT NULL,
        medium VARCHAR(100),
        dimensions VARCHAR(255),
        description TEXT,
        image_url VARCHAR(500),
        exhibition_id INTEGER,
        featured BOOLEAN DEFAULT FALSE,
        status VARCHAR(50) DEFAULT 'draft',
        created_at TIMESTAMP DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS exhibitions (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        start_date DATE,
        end_date DATE,
        venue VARCHAR(255),
        curator_id INTEGER,
        status VARCHAR(50) DEFAULT 'planning'
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS art_competitions (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        title VARCHAR(255) NOT NULL,
        theme VARCHAR(255),
        deadline DATE,
        judge_ids JSONB DEFAULT '[]',
        results JSONB DEFAULT '{}',
        status VARCHAR(50) DEFAULT 'open'
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS art_critiques (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        artwork_id INTEGER NOT NULL,
        reviewer_id INTEGER NOT NULL,
        rating INTEGER DEFAULT 0,
        comments TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )`);
      console.log('[ArtGallery] Tables ready');
    } catch(e) { console.warn('[ArtGallery] Migration warning:', e.message); }
  })();

  const BASE = '/school/art-gallery';
  const MEDIUMS = ['Painting','Sculpture','Digital','Photography','Mixed Media','Drawing','Printmaking','Ceramics'];

  function page(title, body) {
    return renderPage(title, SKIP + `<div style="max-width:1200px;margin:0 auto;padding:20px">${body}</div>`);
  }

  function nav(active) {
    const links = [
      ['Dashboard', BASE], ['Artworks', BASE+'/artworks'], ['Exhibitions', BASE+'/exhibitions'],
      ['Competitions', BASE+'/competitions'], ['Submit', BASE+'/submit-artwork'],
      ['Gallery View', BASE+'/gallery-view'], ['Featured', BASE+'/featured'], ['Critiques', BASE+'/critiques']
    ];
    let h = '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px;padding:12px;background:#f9fafb;border-radius:10px">';
    links.forEach(([l, u]) => { h += `<a href="${u}" style="padding:6px 14px;border-radius:6px;text-decoration:none;font-size:14px;${u===active?'background:'+P+';color:#fff':'background:#fff;color:'+GRAY+';border:1px solid #e5e7eb'}">${l}</a>`; });
    return h + '</div>';
  }

  // ---------- Dashboard ----------
  app.get(BASE, requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [artworks, exhibitions, competitions] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS c FROM artworks WHERE tenant_id=$1', [tid]),
      pool.query('SELECT COUNT(*)::int AS c FROM exhibitions WHERE tenant_id=$1', [tid]),
      pool.query("SELECT COUNT(*)::int AS c FROM art_competitions WHERE tenant_id=$1 AND status='open'", [tid])
    ]);
    const recentArt = await pool.query('SELECT a.*, u.name AS artist_name FROM artworks a LEFT JOIN users u ON u.id=a.artist_id WHERE a.tenant_id=$1 ORDER BY a.created_at DESC LIMIT 8', [tid]);
    const stats = [
      { label: 'Total Artworks', value: artworks.rows[0].c, color: P },
      { label: 'Exhibitions', value: exhibitions.rows[0].c, color: '#059669' },
      { label: 'Open Competitions', value: competitions.rows[0].c, color: '#d97706' }
    ];
    let html = nav(BASE) + '<h1 style="font-size:24px;margin-bottom:20px">🎨 Art Gallery Dashboard</h1>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px">';
    stats.forEach(s => {
      html += `<div class="card" style="border-left:4px solid ${s.color}"><div style="font-size:28px;font-weight:700;color:${s.color}">${s.value}</div><div style="color:${GRAY};font-size:14px">${s.label}</div></div>`;
    });
    html += '</div>';
    html += '<div class="card"><h2 style="margin-bottom:12px">Recent Artworks</h2>';
    if (recentArt.rows.length === 0) {
      html += '<p style="color:'+GRAY+'">No artworks yet. <a href="'+BASE+'/submit-artwork">Submit your first artwork</a>.</p>';
    } else {
      html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px">';
      recentArt.rows.forEach(a => {
        html += `<div style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden">
          ${a.image_url ? '<img src="'+esc(a.image_url)+'" style="width:100%;height:160px;object-fit:cover">' : '<div style="width:100%;height:160px;background:#f3f4f6;display:flex;align-items:center;justify-content:center;color:'+GRAY+'">No Image</div>'}
          <div style="padding:12px"><div style="font-weight:600;font-size:14px">${esc(a.title)}</div><div style="font-size:12px;color:'+GRAY+'">${esc(a.artist_name||'Unknown')} · ${esc(a.medium||'')}</div>
          ${a.featured?'<span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:4px;font-size:11px">⭐ Featured</span>':''}
          </div></div>`;
      });
      html += '</div>';
    }
    html += '</div>';
    res.send(page('Art Gallery', html));
  }));

  // ---------- Artworks List ----------
  app.get(BASE+'/artworks', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const medium = req.query.medium || '';
    let q = 'SELECT a.*, u.name AS artist_name FROM artworks a LEFT JOIN users u ON u.id=a.artist_id WHERE a.tenant_id=$1';
    const params = [tid];
    if (medium) { q += ' AND a.medium=$2'; params.push(medium); }
    q += ' ORDER BY a.created_at DESC LIMIT 50';
    const { rows } = await pool.query(q, params);
    let html = nav(BASE+'/artworks') + '<h1 style="font-size:24px;margin-bottom:20px">🖼️ Artworks</h1>';
    html += '<div class="card"><form method="get" style="display:flex;gap:12px;align-items:end"><div style="flex:1"><label style="font-size:13px;color:'+GRAY+'">Filter by Medium</label><select name="medium" style="width:100%"><option value="">All Mediums</option>';
    MEDIUMS.forEach(m => { html += `<option value="${m}" ${medium===m?'selected':''}>${m}</option>`; });
    html += '</select></div><button class="btn" type="submit">Filter</button><a href="'+BASE+'/submit-artwork" class="btn" style="background:#059669;text-decoration:none">+ Add Artwork</a></form></div>';
    html += '<div class="card"><table><thead><tr><th>Title</th><th>Artist</th><th>Medium</th><th>Status</th><th>Featured</th><th>Actions</th></tr></thead><tbody>';
    rows.forEach(a => {
      html += `<tr><td>${esc(a.title)}</td><td>${esc(a.artist_name||'N/A')}</td><td>${esc(a.medium||'-')}</td><td><span style="padding:3px 10px;border-radius:20px;font-size:12px;background:${a.status==='published'?'#d1fae5':'#fef3c7'};color:${a.status==='published'?'#065f46':'#92400e'}">${esc(a.status)}</span></td><td>${a.featured?'⭐ Yes':'No'}</td><td><a href="${BASE}/edit-artwork/${a.id}" class="btn" style="padding:4px 10px;font-size:12px">Edit</a></td></tr>`;
    });
    html += '</tbody></table></div>';
    res.send(page('Artworks', html));
  }));

  // ---------- Submit Artwork ----------
  app.get(BASE+'/submit-artwork', requireAuth, requireNotBanned, ah(async (req, res) => {
    let html = nav(BASE+'/submit-artwork') + '<h1 style="font-size:24px;margin-bottom:20px">🎨 Submit Artwork</h1>';
    html += '<div class="card"><form method="post" action="'+BASE+'/submit-artwork"><div style="display:grid;gap:16px">';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Title *</label><input name="title" required placeholder="Artwork title"></div>';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Medium *</label><select name="medium" required><option value="">Select medium</option>';
    MEDIUMS.forEach(m => { html += `<option value="${m}">${m}</option>`; });
    html += '</select></div>';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Dimensions</label><input name="dimensions" placeholder="e.g. 24x36 inches"></div>';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Description</label><textarea name="description" rows="4" placeholder="Describe your artwork"></textarea></div>';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Image URL</label><input name="image_url" placeholder="https://example.com/artwork.jpg"></div>';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Exhibition</label><select name="exhibition_id"><option value="">None</option></select></div>';
    html += '<div style="display:flex;gap:12px"><button type="submit" class="btn">Submit Artwork</button><button type="submit" name="status" value="published" class="btn" style="background:#059669">Submit & Publish</button></div>';
    html += '</div></form></div>';
    res.send(page('Submit Artwork', html));
  }));

  app.post(BASE+'/submit-artwork', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const { title, medium, dimensions, description, image_url, exhibition_id, status } = req.body;
    if (!title || !medium) return res.send(page('Error', '<p>Title and medium are required.</p><a href="'+BASE+'/submit-artwork">Go back</a>'));
    await pool.query('INSERT INTO artworks (tenant_id,title,artist_id,medium,dimensions,description,image_url,exhibition_id,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [tid, title, uid, medium, dimensions, description, image_url, exhibition_id || null, status || 'draft']);
    audit(req, 'art_submit', 'Submitted artwork: ' + title);
    res.redirect(BASE + '/artworks');
  }));

  // ---------- Edit Artwork ----------
  app.get(BASE+'/edit-artwork/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM artworks WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
    if (!rows.length) return res.status(404).send(page('Not Found', '<p>Artwork not found.</p>'));
    const a = rows[0];
    let html = nav(BASE+'/artworks') + '<h1 style="font-size:24px;margin-bottom:20px">✏️ Edit Artwork</h1>';
    html += '<div class="card"><form method="post" action="'+BASE+'/edit-artwork/'+a.id+'"><div style="display:grid;gap:16px">';
    html += `<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Title *</label><input name="title" value="${esc(a.title)}" required></div>`;
    html += `<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Medium *</label><select name="medium" required>`;
    MEDIUMS.forEach(m => { html += `<option value="${m}" ${a.medium===m?'selected':''}>${m}</option>`; });
    html += '</select></div>';
    html += `<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Dimensions</label><input name="dimensions" value="${esc(a.dimensions||'')}"></div>`;
    html += `<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Description</label><textarea name="description" rows="4">${esc(a.description||'')}</textarea></div>`;
    html += `<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Image URL</label><input name="image_url" value="${esc(a.image_url||'')}"></div>`;
    html += `<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Status</label><select name="status"><option value="draft" ${a.status==='draft'?'selected':''}>Draft</option><option value="published" ${a.status==='published'?'selected':''}>Published</option><option value="archived" ${a.status==='archived'?'selected':''}>Archived</option></select></div>`;
    html += `<div><label><input type="checkbox" name="featured" value="1" ${a.featured?'checked':''}> Mark as Featured</label></div>`;
    html += '<div style="display:flex;gap:12px"><button type="submit" class="btn">Save Changes</button><a href="'+BASE+'/artworks" class="btn" style="background:'+GRAY+'">Cancel</a></div>';
    html += '</div></form></div>';
    res.send(page('Edit Artwork', html));
  }));

  app.post(BASE+'/edit-artwork/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { title, medium, dimensions, description, image_url, status, featured } = req.body;
    await pool.query('UPDATE artworks SET title=$1,medium=$2,dimensions=$3,description=$4,image_url=$5,status=$6,featured=$7 WHERE id=$8 AND tenant_id=$9',
      [title, medium, dimensions, description, image_url, status, !!featured, req.params.id, tid]);
    audit(req, 'art_edit', 'Edited artwork: ' + title);
    res.redirect(BASE + '/artworks');
  }));

  // ---------- Delete Artwork ----------
  app.post(BASE+'/delete-artwork/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query('DELETE FROM artworks WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    audit(req, 'art_delete', 'Deleted artwork #' + req.params.id);
    res.redirect(BASE + '/artworks');
  }));

  // ---------- Exhibitions ----------
  app.get(BASE+'/exhibitions', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { rows } = await pool.query('SELECT e.*, u.name AS curator_name FROM exhibitions e LEFT JOIN users u ON u.id=e.curator_id WHERE e.tenant_id=$1 ORDER BY e.start_date DESC', [tid]);
    let html = nav(BASE+'/exhibitions') + '<h1 style="font-size:24px;margin-bottom:20px">🏛️ Exhibitions</h1>';
    html += '<a href="'+BASE+'/create-exhibition" class="btn" style="display:inline-block;margin-bottom:16px;background:#059669">+ Create Exhibition</a>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px">';
    rows.forEach(e => {
      const statusColor = e.status==='active'?'#059669':e.status==='upcoming'?'#2563eb':'#6b7280';
      html += `<div class="card" style="border-top:3px solid ${statusColor}">
        <h3 style="margin-bottom:4px">${esc(e.title)}</h3>
        <div style="font-size:12px;color:${GRAY};margin-bottom:8px">Curated by ${esc(e.curator_name||'N/A')} · ${esc(e.venue||'TBD')}</div>
        <p style="font-size:13px;color:${GRAY}">${esc(e.description||'No description')}</p>
        <div style="margin-top:8px;font-size:12px">${e.start_date ? esc(e.start_date.toISOString().split('T')[0]) : '?'} — ${e.end_date ? esc(e.end_date.toISOString().split('T')[0]) : '?'}</div>
        <span style="padding:2px 10px;border-radius:12px;font-size:11px;background:${statusColor}22;color:${statusColor};font-weight:600">${esc(e.status)}</span>
        <div style="margin-top:8px"><a href="${BASE}/edit-exhibition/${e.id}" class="btn" style="padding:4px 10px;font-size:12px">Edit</a></div>
      </div>`;
    });
    html += '</div>';
    res.send(page('Exhibitions', html));
  }));

  app.get(BASE+'/create-exhibition', requireAuth, requireNotBanned, ah(async (req, res) => {
    let html = nav(BASE+'/exhibitions') + '<h1 style="font-size:24px;margin-bottom:20px">🏛️ Create Exhibition</h1>';
    html += '<div class="card"><form method="post" action="'+BASE+'/create-exhibition"><div style="display:grid;gap:16px">';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Title *</label><input name="title" required placeholder="Exhibition title"></div>';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Description</label><textarea name="description" rows="3" placeholder="Exhibition description"></textarea></div>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Start Date</label><input type="date" name="start_date"></div><div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">End Date</label><input type="date" name="end_date"></div></div>';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Venue</label><input name="venue" placeholder="Gallery hall or location"></div>';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Status</label><select name="status"><option value="planning">Planning</option><option value="upcoming">Upcoming</option><option value="active">Active</option><option value="completed">Completed</option></select></div>';
    html += '<button type="submit" class="btn">Create Exhibition</button></div></form></div>';
    res.send(page('Create Exhibition', html));
  }));

  app.post(BASE+'/create-exhibition', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { title, description, start_date, end_date, venue, status } = req.body;
    await pool.query('INSERT INTO exhibitions (tenant_id,title,description,start_date,end_date,venue,curator_id,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [tid, title, description, start_date || null, end_date || null, venue, req.session.user.id, status || 'planning']);
    audit(req, 'exhibition_create', 'Created exhibition: ' + title);
    res.redirect(BASE + '/exhibitions');
  }));

  app.get(BASE+'/edit-exhibition/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM exhibitions WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
    if (!rows.length) return res.status(404).send(page('Not Found', '<p>Exhibition not found.</p>'));
    const e = rows[0];
    let html = nav(BASE+'/exhibitions') + '<h1 style="font-size:24px;margin-bottom:20px">✏️ Edit Exhibition</h1>';
    html += '<div class="card"><form method="post" action="'+BASE+'/edit-exhibition/'+e.id+'"><div style="display:grid;gap:16px">';
    html += `<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Title *</label><input name="title" value="${esc(e.title)}" required></div>`;
    html += `<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Description</label><textarea name="description" rows="3">${esc(e.description||'')}</textarea></div>`;
    html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Start Date</label><input type="date" name="start_date" value="${e.start_date?e.start_date.toISOString().split('T')[0]:''}"></div><div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">End Date</label><input type="date" name="end_date" value="${e.end_date?e.end_date.toISOString().split('T')[0]:''}"></div></div>`;
    html += `<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Venue</label><input name="venue" value="${esc(e.venue||'')}"></div>`;
    html += `<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Status</label><select name="status">`;
    ['planning','upcoming','active','completed'].forEach(s => { html += `<option value="${s}" ${e.status===s?'selected':''}>${s.charAt(0).toUpperCase()+s.slice(1)}</option>`; });
    html += '</select></div>';
    html += '<div style="display:flex;gap:12px"><button type="submit" class="btn">Save Changes</button><a href="'+BASE+'/exhibitions" class="btn" style="background:'+GRAY+'">Cancel</a></div>';
    html += '</div></form></div>';
    res.send(page('Edit Exhibition', html));
  }));

  app.post(BASE+'/edit-exhibition/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { title, description, start_date, end_date, venue, status } = req.body;
    await pool.query('UPDATE exhibitions SET title=$1,description=$2,start_date=$3,end_date=$4,venue=$5,status=$6 WHERE id=$7 AND tenant_id=$8',
      [title, description, start_date || null, end_date || null, venue, status, req.params.id, tid]);
    audit(req, 'exhibition_edit', 'Edited exhibition: ' + title);
    res.redirect(BASE + '/exhibitions');
  }));

  // ---------- Competitions ----------
  app.get(BASE+'/competitions', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { rows } = await pool.query('SELECT * FROM art_competitions WHERE tenant_id=$1 ORDER BY deadline DESC', [tid]);
    let html = nav(BASE+'/competitions') + '<h1 style="font-size:24px;margin-bottom:20px">🏆 Art Competitions</h1>';
    html += '<a href="'+BASE+'/create-competition" class="btn" style="display:inline-block;margin-bottom:16px;background:#d97706">+ Create Competition</a>';
    rows.forEach(c => {
      const isOpen = c.status === 'open';
      html += `<div class="card" style="border-left:4px solid ${isOpen?'#059669':'#6b7280'}">
        <div style="display:flex;justify-content:space-between;align-items:start">
          <div><h3>${esc(c.title)}</h3><div style="font-size:13px;color:${GRAY}">Theme: ${esc(c.theme||'Open')}</div></div>
          <span style="padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;background:${isOpen?'#d1fae5':'#f3f4f6'};color:${isOpen?'#065f46':'#6b7280'}">${esc(c.status)}</span>
        </div>
        <div style="margin-top:8px;font-size:13px">Deadline: ${c.deadline ? c.deadline.toISOString().split('T')[0] : 'None'}</div>
        ${isOpen && c.deadline && c.deadline < new Date() ? '<div style="color:#dc2626;font-size:12px;margin-top:4px">⚠️ Deadline has passed</div>' : ''}
        ${c.results && Object.keys(c.results).length ? '<div style="margin-top:8px;padding:8px;background:#f0fdf4;border-radius:6px;font-size:13px">🏅 Results published</div>' : ''}
        <div style="margin-top:8px"><a href="'+BASE+'/manage-competition/'+c.id+'" class="btn" style="padding:4px 10px;font-size:12px">Manage</a></div>
      </div>`;
    });
    res.send(page('Art Competitions', html));
  }));

  app.get(BASE+'/create-competition', requireAuth, requireNotBanned, ah(async (req, res) => {
    let html = nav(BASE+'/competitions') + '<h1 style="font-size:24px;margin-bottom:20px">🏆 Create Competition</h1>';
    html += '<div class="card"><form method="post" action="'+BASE+'/create-competition"><div style="display:grid;gap:16px">';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Title *</label><input name="title" required placeholder="Competition title"></div>';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Theme</label><input name="theme" placeholder="Competition theme or subject"></div>';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Deadline</label><input type="date" name="deadline"></div>';
    html += '<button type="submit" class="btn">Create Competition</button></div></form></div>';
    res.send(page('Create Competition', html));
  }));

  app.post(BASE+'/create-competition', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { title, theme, deadline } = req.body;
    await pool.query('INSERT INTO art_competitions (tenant_id,title,theme,deadline,status) VALUES ($1,$2,$3,$4,$5)',
      [tid, title, theme, deadline || null, 'open']);
    audit(req, 'competition_create', 'Created competition: ' + title);
    res.redirect(BASE + '/competitions');
  }));

  app.get(BASE+'/manage-competition/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const comp = await pool.query('SELECT * FROM art_competitions WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    if (!comp.rows.length) return res.status(404).send(page('Not Found', '<p>Competition not found.</p>'));
    const c = comp.rows[0];
    const entries = await pool.query('SELECT a.*, u.name AS artist_name FROM artworks a LEFT JOIN users u ON u.id=a.artist_id WHERE a.tenant_id=$1 ORDER BY a.created_at DESC', [tid]);
    let html = nav(BASE+'/competitions') + '<h1 style="font-size:24px;margin-bottom:20px">🏆 Manage: ' + esc(c.title) + '</h1>';
    html += '<div class="card"><h2 style="margin-bottom:12px">Details</h2><p>Theme: <strong>' + esc(c.theme||'Open') + '</strong></p><p>Deadline: ' + (c.deadline ? c.deadline.toISOString().split('T')[0] : 'None') + '</p><p>Status: <strong>' + esc(c.status) + '</strong></p>';
    html += '<div style="margin-top:12px"><form method="post" action="'+BASE+'/manage-competition/'+c.id+'"><select name="status"><option value="open" ' + (c.status==='open'?'selected':'') + '>Open</option><option value="judging" ' + (c.status==='judging'?'selected':'') + '>Judging</option><option value="closed" ' + (c.status==='closed'?'selected':'') + '>Closed</option></select><button type="submit" class="btn" style="margin-left:8px">Update Status</button></form></div></div>';
    html += '<div class="card"><h2 style="margin-bottom:12px">Eligible Artworks</h2><table><thead><tr><th>Artwork</th><th>Artist</th><th>Medium</th><th>Actions</th></tr></thead><tbody>';
    entries.rows.forEach(a => {
      html += `<tr><td>${esc(a.title)}</td><td>${esc(a.artist_name||'N/A')}</td><td>${esc(a.medium||'')}</td><td><a href="${BASE}/artist-profile/${a.artist_id}" class="btn" style="padding:4px 8px;font-size:12px">View Artist</a></td></tr>`;
    });
    html += '</tbody></table></div>';
    res.send(page('Manage Competition', html));
  }));

  app.post(BASE+'/manage-competition/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    await pool.query('UPDATE art_competitions SET status=$1 WHERE id=$2 AND tenant_id=$3', [req.body.status, req.params.id, req.session.user.tenant_id]);
    res.redirect(BASE + '/competitions');
  }));

  // ---------- Gallery View ----------
  app.get(BASE+'/gallery-view', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const medium = req.query.medium || '';
    let q = 'SELECT a.*, u.name AS artist_name FROM artworks a LEFT JOIN users u ON u.id=a.artist_id WHERE a.tenant_id=$1 AND a.status=\'published\'';
    const params = [tid];
    if (medium) { q += ' AND a.medium=$2'; params.push(medium); }
    q += ' ORDER BY a.created_at DESC LIMIT 100';
    const { rows } = await pool.query(q, params);
    let html = nav(BASE+'/gallery-view') + '<h1 style="font-size:24px;margin-bottom:20px">🖼️ Virtual Gallery</h1>';
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px"><a href="'+BASE+'/gallery-view" class="btn" style="padding:4px 12px;font-size:12px;background:'+(medium?'#fff;color:'+P:'')+'">All</a>';
    MEDIUMS.forEach(m => {
      const bg = medium === m ? P : '#fff';
      const col = medium === m ? '#fff' : P;
      html += '<a href="'+BASE+'/gallery-view?medium='+m+'" class="btn" style="padding:4px 12px;font-size:12px;background:'+bg+';color:'+col+'">'+m+'</a>';
    });
    html += '</div>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:20px">';
    rows.forEach(a => {
      html += `<div class="card" style="padding:0;overflow:hidden;transition:transform .2s">
        ${a.image_url ? '<img src="'+esc(a.image_url)+'" style="width:100%;height:200px;object-fit:cover">' : '<div style="width:100%;height:200px;background:linear-gradient(135deg,#667eea,#764ba2);display:flex;align-items:center;justify-content:center;color:#fff;font-size:24px">🎨</div>'}
        <div style="padding:14px"><h3 style="font-size:15px;margin-bottom:4px">${esc(a.title)}</h3>
        <p style="font-size:12px;color:'+GRAY+';margin-bottom:6px">by ${esc(a.artist_name||'Unknown')}</p>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-size:11px;background:#f3f4f6;padding:2px 8px;border-radius:4px">${esc(a.medium||'')}</span>
          ${a.featured?'<span style="font-size:11px;color:#d97706">⭐ Featured</span>':''}
        </div>
        ${a.dimensions?'<p style="font-size:11px;color:'+GRAY+';margin-top:4px">'+esc(a.dimensions)+'</p>':''}
        ${a.description?'<p style="font-size:12px;color:'+GRAY+';margin-top:6px">'+esc(a.description).substring(0,100)+'...</p>':''}
        </div></div>`;
    });
    html += '</div>';
    if (!rows.length) html += '<div class="card"><p style="text-align:center;color:'+GRAY+'">No published artworks in this collection yet.</p></div>';
    res.send(page('Virtual Gallery', html));
  }));

  // ---------- Artist Profile ----------
  app.get(BASE+'/artist-profile/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const artistId = req.params.id;
    const artist = await pool.query('SELECT id, name, email FROM users WHERE id=$1 AND tenant_id=$2', [artistId, tid]);
    if (!artist.rows.length) return res.status(404).send(page('Not Found', '<p>Artist not found.</p>'));
    const artworks = await pool.query('SELECT * FROM artworks WHERE artist_id=$1 AND tenant_id=$2 AND status=\'published\' ORDER BY created_at DESC', [artistId, tid]);
    const mediumStats = await pool.query('SELECT medium, COUNT(*)::int AS cnt FROM artworks WHERE artist_id=$1 AND tenant_id=$2 GROUP BY medium', [artistId, tid]);
    const critiqueStats = await pool.query('SELECT AVG(rating)::numeric(3,1) AS avg_rating, COUNT(*)::int AS total FROM art_critiques cr JOIN artworks a ON a.id=cr.artwork_id WHERE a.artist_id=$1 AND a.tenant_id=$2', [artistId, tid]);
    const ar = artist.rows[0];
    const cs = critiqueStats.rows[0];
    let html = nav(BASE) + '<div style="margin-bottom:20px"><a href="'+BASE+'" style="color:'+P+';font-size:14px">← Back to Gallery</a></div>';
    html += '<div class="card" style="display:flex;gap:20px;align-items:center"><div style="width:80px;height:80px;border-radius:50%;background:'+P+';display:flex;align-items:center;justify-content:center;color:#fff;font-size:32px;font-weight:700">'+esc((ar.name||'A').charAt(0).toUpperCase())+'</div>';
    html += '<div><h1 style="font-size:24px;margin-bottom:4px">'+esc(ar.name)+'</h1><p style="color:'+GRAY+'">'+esc(ar.email)+'</p>';
    html += '<div style="display:flex;gap:16px;margin-top:8px"><span style="font-size:13px"><strong>'+artworks.rows.length+'</strong> Artworks</span>';
    html += '<span style="font-size:13px"><strong>'+mediumStats.rows.length+'</strong> Mediums</span>';
    html += '<span style="font-size:13px"><strong>'+(cs.avg_rating||'N/A')+'</strong> Avg Rating ('+cs.total+' critiques)</span></div></div></div>';
    if (mediumStats.rows.length) {
      html += '<div class="card"><h2 style="margin-bottom:8px">Medium Breakdown</h2><div style="display:flex;gap:12px;flex-wrap:wrap">';
      mediumStats.rows.forEach(m => { html += `<span style="background:#eff6ff;color:${P};padding:4px 12px;border-radius:20px;font-size:13px">${esc(m.medium)}: ${m.cnt}</span>`; });
      html += '</div></div>';
    }
    html += '<div class="card"><h2 style="margin-bottom:12px">Portfolio</h2><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px">';
    artworks.rows.forEach(a => {
      html += `<div style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden">
        ${a.image_url ? '<img src="'+esc(a.image_url)+'" style="width:100%;height:160px;object-fit:cover">' : '<div style="width:100%;height:160px;background:#f3f4f6;display:flex;align-items:center;justify-content:center;color:'+GRAY+'">🎨</div>'}
        <div style="padding:10px"><div style="font-weight:600;font-size:13px">${esc(a.title)}</div><div style="font-size:11px;color:'+GRAY+'">${esc(a.medium||'')} ${a.dimensions?'· '+esc(a.dimensions):''}</div></div></div>`;
    });
    html += '</div></div>';
    res.send(page('Artist Profile', html));
  }));

  // ---------- Featured ----------
  app.get(BASE+'/featured', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { rows } = await pool.query('SELECT a.*, u.name AS artist_name FROM artworks a LEFT JOIN users u ON u.id=a.artist_id WHERE a.tenant_id=$1 AND a.featured=TRUE ORDER BY a.created_at DESC', [tid]);
    let html = nav(BASE+'/featured') + '<h1 style="font-size:24px;margin-bottom:20px">⭐ Featured Collection</h1>';
    if (!rows.length) {
      html += '<div class="card"><p style="text-align:center;color:'+GRAY+'">No featured artworks yet. Featured works showcase the best of our gallery.</p></div>';
    } else {
      html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:20px">';
      rows.forEach((a, i) => {
        html += `<div class="card" style="padding:0;overflow:hidden;border:2px solid #fbbf24">
          ${a.image_url ? '<img src="'+esc(a.image_url)+'" style="width:100%;height:220px;object-fit:cover">' : '<div style="width:100%;height:220px;background:linear-gradient(135deg,#f59e0b,#d97706);display:flex;align-items:center;justify-content:center;color:#fff;font-size:36px">⭐</div>'}
          <div style="padding:16px"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><h3 style="font-size:16px">${esc(a.title)}</h3><span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:4px;font-size:11px">Featured #${i+1}</span></div>
          <p style="font-size:13px;color:'+GRAY+'">by ${esc(a.artist_name||'Unknown')}</p>
          <p style="font-size:12px;color:'+GRAY+';margin-top:4px">${esc(a.medium||'')} ${a.dimensions?'· '+esc(a.dimensions):''}</p>
          ${a.description?'<p style="font-size:13px;margin-top:8px;color:#374151">'+esc(a.description).substring(0,120)+'${a.description.length>120?"...":""}</p>':''}
          </div></div>`;
      });
      html += '</div>';
    }
    res.send(page('Featured Collection', html));
  }));

  // ---------- Critiques ----------
  app.get(BASE+'/critiques', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { rows } = await pool.query('SELECT c.*, a.title AS artwork_title, u.name AS reviewer_name FROM art_critiques c JOIN artworks a ON a.id=c.artwork_id LEFT JOIN users u ON u.id=c.reviewer_id WHERE c.tenant_id=$1 ORDER BY c.created_at DESC LIMIT 50', [tid]);
    let html = nav(BASE+'/critiques') + '<h1 style="font-size:24px;margin-bottom:20px">💬 Art Critiques</h1>';
    html += '<div class="card"><form method="post" action="'+BASE+'/critiques" style="display:grid;gap:12px;max-width:500px">';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Artwork ID *</label><input name="artwork_id" type="number" required placeholder="Enter artwork ID"></div>';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Rating (1-10)</label><input name="rating" type="number" min="1" max="10" placeholder="1-10"></div>';
    html += '<div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Comments</label><textarea name="comments" rows="3" placeholder="Share your critique"></textarea></div>';
    html += '<button type="submit" class="btn">Submit Critique</button></form></div>';
    html += '<div class="card"><h2 style="margin-bottom:12px">Recent Critiques</h2>';
    if (!rows.length) {
      html += '<p style="color:'+GRAY+'">No critiques yet.</p>';
    } else {
      rows.forEach(c => {
        const stars = '★'.repeat(Math.min(c.rating || 0, 10));
        html += `<div style="border-bottom:1px solid #f3f4f6;padding:12px 0">
          <div style="display:flex;justify-content:space-between"><strong>${esc(c.artwork_title)}</strong><span style="font-size:12px;color:'+GRAY+'">${c.created_at ? c.created_at.toISOString().split('T')[0] : ''}</span></div>
          <div style="color:#f59e0b;font-size:14px;margin:4px 0">${stars} <span style="color:'+GRAY+';font-size:12px">${c.rating}/10</span></div>
          <p style="font-size:13px;color:#374151">${esc(c.comments||'No comments')}</p>
          <div style="font-size:11px;color:'+GRAY+'">by ${esc(c.reviewer_name||'Anonymous')}</div>
        </div>`;
      });
    }
    html += '</div>';
    res.send(page('Art Critiques', html));
  }));

  app.post(BASE+'/critiques', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { artwork_id, rating, comments } = req.body;
    if (!artwork_id) return res.redirect(BASE + '/critiques');
    await pool.query('INSERT INTO art_critiques (tenant_id,artwork_id,reviewer_id,rating,comments) VALUES ($1,$2,$3,$4,$5)',
      [tid, artwork_id, req.session.user.id, rating || 0, comments || null]);
    audit(req, 'critique_add', 'Added critique for artwork #' + artwork_id);
    res.redirect(BASE + '/critiques');
  }));

  // ---------- Art Statistics ----------
  app.get(BASE+'/statistics', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const totalArt = await pool.query('SELECT COUNT(*)::int AS c FROM artworks WHERE tenant_id=$1', [tid]);
    const publishedArt = await pool.query("SELECT COUNT(*)::int AS c FROM artworks WHERE tenant_id=$1 AND status='published'", [tid]);
    const featuredArt = await pool.query('SELECT COUNT(*)::int AS c FROM artworks WHERE tenant_id=$1 AND featured=TRUE', [tid]);
    const totalCritiques = await pool.query('SELECT COUNT(*)::int AS c FROM art_critiques WHERE tenant_id=$1', [tid]);
    const avgRating = await pool.query('SELECT COALESCE(AVG(rating),0)::numeric(3,1) AS avg FROM art_critiques WHERE tenant_id=$1', [tid]);
    const mediumBreakdown = await pool.query('SELECT medium, COUNT(*)::int AS cnt FROM artworks WHERE tenant_id=$1 GROUP BY medium ORDER BY cnt DESC', [tid]);
    const statusBreakdown = await pool.query('SELECT status, COUNT(*)::int AS cnt FROM artworks WHERE tenant_id=$1 GROUP BY status ORDER BY cnt DESC', [tid]);
    const monthlyTrend = await pool.query("SELECT DATE_TRUNC('month', created_at) AS month, COUNT(*)::int AS cnt FROM artworks WHERE tenant_id=$1 GROUP BY DATE_TRUNC('month', created_at) ORDER BY month DESC LIMIT 12", [tid]);
    const topArtists = await pool.query('SELECT a.artist_id, u.name, COUNT(*)::int AS works FROM artworks a LEFT JOIN users u ON u.id=a.artist_id WHERE a.tenant_id=$1 GROUP BY a.artist_id, u.name ORDER BY works DESC LIMIT 10', [tid]);
    let html = nav(BASE) + '<h1 style="font-size:24px;margin-bottom:20px">📊 Art Gallery Statistics</h1>';
    // Summary cards
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:24px">';
    const summaryStats = [
      { label: 'Total Artworks', value: totalArt.rows[0].c, color: P },
      { label: 'Published', value: publishedArt.rows[0].c, color: '#059669' },
      { label: 'Featured', value: featuredArt.rows[0].c, color: '#d97706' },
      { label: 'Critiques', value: totalCritiques.rows[0].c, color: '#dc2626' },
      { label: 'Avg Rating', value: avgRating.rows[0].avg + '/10', color: '#7c3aed' }
    ];
    summaryStats.forEach(s => {
      html += '<div class="card" style="text-align:center;border-top:3px solid '+s.color+'"><div style="font-size:24px;font-weight:700;color:'+s.color+'">'+s.value+'</div><div style="font-size:12px;color:'+GRAY+'">'+s.label+'</div></div>';
    });
    html += '</div>';
    // Medium breakdown
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px">';
    html += '<div class="card"><h2 style="margin-bottom:12px">🎨 By Medium</h2>';
    const maxMediumCnt = mediumBreakdown.rows.length ? mediumBreakdown.rows[0].cnt : 1;
    mediumBreakdown.rows.forEach(m => {
      const pct = Math.round((m.cnt / maxMediumCnt) * 100);
      html += '<div style="margin-bottom:8px"><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:2px"><span>'+esc(m.medium||'Unknown')+'</span><span style="font-weight:600">'+m.cnt+'</span></div>';
      html += '<div style="background:#f3f4f6;border-radius:4px;height:8px;overflow:hidden"><div style="background:'+P+';height:100%;width:'+pct+'%;border-radius:4px"></div></div></div>';
    });
    if (!mediumBreakdown.rows.length) html += '<p style="color:'+GRAY+';font-size:13px">No data yet.</p>';
    html += '</div>';
    // Status breakdown
    html += '<div class="card"><h2 style="margin-bottom:12px">📋 By Status</h2>';
    const statusColors = { published: '#059669', draft: '#d97706', archived: '#6b7280' };
    statusBreakdown.rows.forEach(s => {
      const sc = statusColors[s.status] || '#6b7280';
      html += '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f3f4f6;font-size:13px"><span style="color:'+sc+';font-weight:600">'+esc(s.status)+'</span><span>'+s.cnt+'</span></div>';
    });
    if (!statusBreakdown.rows.length) html += '<p style="color:'+GRAY+';font-size:13px">No data yet.</p>';
    html += '</div></div>';
    // Top artists
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px">';
    html += '<div class="card"><h2 style="margin-bottom:12px">🏆 Top Artists</h2>';
    if (topArtists.rows.length) {
      topArtists.rows.forEach((a, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i+1)+'.';
        html += '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f3f4f6;font-size:13px"><span>'+medal+' '+esc(a.name||'Unknown')+'</span><span style="font-weight:600">'+a.works+' works</span></div>';
      });
    } else {
      html += '<p style="color:'+GRAY+';font-size:13px">No artists yet.</p>';
    }
    html += '</div>';
    // Monthly trend
    html += '<div class="card"><h2 style="margin-bottom:12px">📈 Monthly Submissions</h2>';
    if (monthlyTrend.rows.length) {
      const maxMonth = monthlyTrend.rows[0].cnt;
      monthlyTrend.rows.forEach(m => {
        const pct = Math.round((m.cnt / Math.max(maxMonth, 1)) * 100);
        const monthStr = m.month ? m.month.toISOString().split('T')[0].substring(0, 7) : '?';
        html += '<div style="margin-bottom:6px"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:2px"><span>'+monthStr+'</span><span>'+m.cnt+'</span></div>';
        html += '<div style="background:#f3f4f6;border-radius:4px;height:6px;overflow:hidden"><div style="background:#7c3aed;height:100%;width:'+pct+'%;border-radius:4px"></div></div></div>';
      });
    } else {
      html += '<p style="color:'+GRAY+';font-size:13px">No data yet.</p>';
    }
    html += '</div></div>';
    res.send(page('Art Statistics', html));
  }));

  // ---------- Portfolio Builder ----------
  app.get(BASE+'/portfolio', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const myArt = await pool.query('SELECT * FROM artworks WHERE artist_id=$1 AND tenant_id=$2 AND status=\'published\' ORDER BY created_at DESC', [uid, tid]);
    const myCritiques = await pool.query('SELECT cr.*, a.title AS artwork_title FROM art_critiques cr JOIN artworks a ON a.id=cr.artwork_id WHERE a.artist_id=$1 AND a.tenant_id=$2', [uid, tid]);
    const avgRating = await pool.query('SELECT COALESCE(AVG(rating),0)::numeric(3,1) AS avg FROM art_critiques cr JOIN artworks a ON a.id=cr.artwork_id WHERE a.artist_id=$1 AND a.tenant_id=$2', [uid, tid]);
    const mediumBreakdown = await pool.query('SELECT medium, COUNT(*)::int AS cnt FROM artworks WHERE artist_id=$1 AND tenant_id=$2 GROUP BY medium ORDER BY cnt DESC', [uid, tid]);
    let html = nav(BASE) + '<h1 style="font-size:24px;margin-bottom:20px">🗂️ My Art Portfolio</h1>';
    // Portfolio header
    html += '<div class="card" style="background:linear-gradient(135deg,'+P+',#7c3aed);color:#fff">';
    html += '<h2 style="color:#fff;margin-bottom:8px">'+esc(req.session.user.name)+"'s Portfolio</h2>";
    html += '<div style="display:flex;gap:24px;font-size:14px;opacity:0.9">';
    html += '<span><strong>'+myArt.rows.length+'</strong> Published Works</span>';
    html += '<span><strong>'+myCritiques.rows.length+'</strong> Critiques Received</span>';
    html += '<span><strong>'+(avgRating.rows[0].avg)+'/10</strong> Avg Rating</span>';
    html += '</div></div>';
    // Medium skills
    if (mediumBreakdown.rows.length) {
      html += '<div class="card"><h2 style="margin-bottom:12px">🎨 Mediums Explored</h2><div style="display:flex;gap:10px;flex-wrap:wrap">';
      mediumBreakdown.rows.forEach(m => {
        html += '<span style="background:#eff6ff;color:'+P+';padding:6px 14px;border-radius:20px;font-size:13px;font-weight:500">'+esc(m.medium)+': <strong>'+m.cnt+'</strong></span>';
      });
      html += '</div></div>';
    }
    // Gallery grid
    html += '<div class="card"><h2 style="margin-bottom:12px">🖼️ Portfolio Gallery</h2>';
    if (!myArt.rows.length) {
      html += '<div style="text-align:center;padding:40px;color:'+GRAY+'"><div style="font-size:48px;margin-bottom:12px">🎨</div><p>Your portfolio is empty.</p><a href="'+BASE+'/submit-artwork" class="btn" style="margin-top:12px">Submit Your First Artwork</a></div>';
    } else {
      html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:20px">';
      myArt.rows.forEach(a => {
        html += '<div style="border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;transition:transform .15s">';
        if (a.image_url) {
          html += '<img src="'+esc(a.image_url)+'" style="width:100%;height:200px;object-fit:cover">';
        } else {
          html += '<div style="width:100%;height:200px;background:linear-gradient(135deg,#667eea,#764ba2);display:flex;align-items:center;justify-content:center;color:#fff;font-size:28px">🎨</div>';
        }
        html += '<div style="padding:14px">';
        html += '<h3 style="font-size:15px;margin-bottom:4px">'+esc(a.title)+'</h3>';
        html += '<p style="font-size:12px;color:'+GRAY+'">'+esc(a.medium||'')+'</p>';
        if (a.dimensions) html += '<p style="font-size:11px;color:'+GRAY+';margin-top:2px">'+esc(a.dimensions)+'</p>';
        if (a.description) html += '<p style="font-size:13px;color:#374151;margin-top:6px;line-height:1.4">'+esc(a.description).substring(0,120)+'</p>';
        if (a.featured) html += '<span style="display:inline-block;margin-top:6px;background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:4px;font-size:11px">⭐ Featured</span>';
        html += '</div></div>';
      });
      html += '</div>';
    }
    html += '</div>';
    // Critique history
    if (myCritiques.rows.length) {
      html += '<div class="card"><h2 style="margin-bottom:12px">💬 Critique History</h2>';
      myCritiques.rows.forEach(c => {
        const stars = '★'.repeat(Math.min(c.rating || 0, 10));
        html += '<div style="border-bottom:1px solid #f3f4f6;padding:10px 0">';
        html += '<div style="display:flex;justify-content:space-between;align-items:center"><strong style="font-size:14px">'+esc(c.artwork_title)+'</strong><span style="color:#f59e0b;font-size:13px">'+stars+'</span></div>';
        if (c.comments) html += '<p style="font-size:13px;color:#374151;margin-top:4px">'+esc(c.comments)+'</p>';
        html += '</div>';
      });
      html += '</div>';
    }
    res.send(page('My Portfolio', html));
  }));

  // ---------- Curator Tools ----------
  app.get(BASE+'/curator', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const draftArt = await pool.query("SELECT a.*, u.name AS artist_name FROM artworks a LEFT JOIN users u ON u.id=a.artist_id WHERE a.tenant_id=$1 AND a.status='draft' ORDER BY a.created_at DESC LIMIT 30", [tid]);
    const unfeaturedPublished = await pool.query("SELECT a.*, u.name AS artist_name FROM artworks a LEFT JOIN users u ON u.id=a.artist_id WHERE a.tenant_id=$1 AND a.status='published' AND a.featured=FALSE ORDER BY a.created_at DESC LIMIT 30", [tid]);
    const recentCritiques = await pool.query('SELECT c.*, a.title AS artwork_title, u.name AS reviewer_name FROM art_critiques c JOIN artworks a ON a.id=c.artwork_id LEFT JOIN users u ON u.id=c.reviewer_id WHERE c.tenant_id=$1 ORDER BY c.created_at DESC LIMIT 20', [tid]);
    let html = nav(BASE) + '<h1 style="font-size:24px;margin-bottom:20px">🔧 Curator Tools</h1>';
    // Pending review
    html += '<div class="card" style="border-left:4px solid #d97706"><h2 style="margin-bottom:12px">⏳ Pending Review ('+draftArt.rows.length+')</h2>';
    if (!draftArt.rows.length) {
      html += '<p style="color:'+GRAY+';font-size:13px">No pending artworks to review.</p>';
    } else {
      html += '<table><thead><tr><th>Title</th><th>Artist</th><th>Medium</th><th>Submitted</th><th>Actions</th></tr></thead><tbody>';
      draftArt.rows.forEach(a => {
        html += '<tr><td>'+esc(a.title)+'</td><td>'+esc(a.artist_name||'N/A')+'</td><td>'+esc(a.medium||'-')+'</td><td>'+(a.created_at?a.created_at.toISOString().split('T')[0]:'-')+'</td>';
        html += '<td><div style="display:flex;gap:4px">';
        html += '<form method="post" action="'+BASE+'/curator-publish" style="display:inline"><input type="hidden" name="id" value="'+a.id+'"><button class="btn" style="padding:3px 8px;font-size:11px;background:#059669">Publish</button></form>';
        html += '<a href="'+BASE+'/edit-artwork/'+a.id+'" class="btn" style="padding:3px 8px;font-size:11px;background:#6b7280">Edit</a>';
        html += '</div></td></tr>';
      });
      html += '</tbody></table>';
    }
    html += '</div>';
    // Feature candidates
    html += '<div class="card" style="border-left:4px solid #f59e0b"><h2 style="margin-bottom:12px">🌟 Feature Candidates ('+unfeaturedPublished.rows.length+')</h2>';
    if (!unfeaturedPublished.rows.length) {
      html += '<p style="color:'+GRAY+';font-size:13px">All published works are already featured or none available.</p>';
    } else {
      html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px">';
      unfeaturedPublished.rows.forEach(a => {
        html += '<div style="border:1px solid #e5e7eb;border-radius:8px;padding:10px">';
        if (a.image_url) html += '<img src="'+esc(a.image_url)+'" style="width:100%;height:100px;object-fit:cover;border-radius:6px;margin-bottom:6px">';
        html += '<div style="font-size:13px;font-weight:600">'+esc(a.title)+'</div><div style="font-size:11px;color:'+GRAY+'">'+esc(a.artist_name||'')+'</div>';
        html += '<form method="post" action="'+BASE+'/curator-feature" style="margin-top:6px"><input type="hidden" name="id" value="'+a.id+'"><button class="btn" style="padding:3px 8px;font-size:11px;width:100%;background:#f59e0b">⭐ Feature</button></form>';
        html += '</div>';
      });
      html += '</div>';
    }
    html += '</div>';
    // Recent critiques for review
    html += '<div class="card"><h2 style="margin-bottom:12px">💬 Recent Critiques</h2>';
    if (!recentCritiques.rows.length) {
      html += '<p style="color:'+GRAY+';font-size:13px">No critiques yet.</p>';
    } else {
      recentCritiques.rows.forEach(c => {
        html += '<div style="padding:6px 0;border-bottom:1px solid #f3f4f6;font-size:13px"><strong>'+esc(c.artwork_title)+'</strong> — <span style="color:#f59e0b">'+'★'.repeat(Math.min(c.rating||0,10))+'</span> by '+esc(c.reviewer_name||'Anonymous')+'</div>';
      });
    }
    html += '</div>';
    res.send(page('Curator Tools', html));
  }));

  app.post(BASE+'/curator-publish', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query("UPDATE artworks SET status='published' WHERE id=$1 AND tenant_id=$2", [req.body.id, tid]);
    audit(req, 'curator_publish', 'Published artwork #' + req.body.id);
    res.redirect(BASE + '/curator');
  }));

  app.post(BASE+'/curator-feature', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query('UPDATE artworks SET featured=TRUE WHERE id=$1 AND tenant_id=$2', [req.body.id, tid]);
    audit(req, 'curator_feature', 'Featured artwork #' + req.body.id);
    res.redirect(BASE + '/curator');
  }));

  // ---------- Collections ----------
  app.get(BASE+'/collections', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const medium = req.query.medium || '';
    const period = req.query.period || 'all';
    let q = "SELECT a.*, u.name AS artist_name FROM artworks a LEFT JOIN users u ON u.id=a.artist_id WHERE a.tenant_id=$1 AND a.status='published'";
    const params = [tid];
    if (medium) { q += ' AND a.medium=$2'; params.push(medium); }
    if (period === 'month') { q += ' AND a.created_at >= CURRENT_DATE - INTERVAL \'30 days\''; }
    else if (period === 'quarter') { q += ' AND a.created_at >= CURRENT_DATE - INTERVAL \'90 days\''; }
    else if (period === 'year') { q += ' AND a.created_at >= CURRENT_DATE - INTERVAL \'365 days\''; }
    q += ' ORDER BY a.created_at DESC LIMIT 100';
    const { rows } = await pool.query(q, params);
    let html = nav(BASE) + '<h1 style="font-size:24px;margin-bottom:20px">📚 Art Collections</h1>';
    // Filters
    html += '<div class="card"><form method="get" style="display:flex;gap:12px;align-items:end;flex-wrap:wrap">';
    html += '<div><label style="font-size:13px;color:'+GRAY+';display:block;margin-bottom:4px">Medium</label><select name="medium" style="width:auto"><option value="">All</option>';
    MEDIUMS.forEach(m => { html += '<option value="'+m+'" '+(medium===m?'selected':'')+'>'+m+'</option>'; });
    html += '</select></div>';
    html += '<div><label style="font-size:13px;color:'+GRAY+';display:block;margin-bottom:4px">Period</label><select name="period" style="width:auto"><option value="all" '+(period==='all'?'selected':'')+'>All Time</option><option value="month" '+(period==='month'?'selected':'')+'>Last Month</option><option value="quarter" '+(period==='quarter'?'selected':'')+'>Last Quarter</option><option value="year" '+(period==='year'?'selected':'')+'>Last Year</option></select></div>';
    html += '<button class="btn" type="submit">Apply</button></form></div>';
    html += '<div style="margin-bottom:12px;font-size:14px;color:'+GRAY+'">'+rows.length+' artwork(s) found</div>';
    // Masonry-like grid
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:16px">';
    rows.forEach(a => {
      html += '<div class="card" style="padding:0;overflow:hidden">';
      if (a.image_url) {
        html += '<img src="'+esc(a.image_url)+'" style="width:100%;height:200px;object-fit:cover">';
      } else {
        const gradients = ['#667eea,#764ba2','#f093fb,#f5576c','#4facfe,#00f2fe','#43e97b,#38f9d7','#fa709a,#fee140'];
        const grad = gradients[a.id % gradients.length];
        html += '<div style="width:100%;height:200px;background:linear-gradient(135deg,'+grad+');display:flex;align-items:center;justify-content:center;color:#fff;font-size:28px">🎨</div>';
      }
      html += '<div style="padding:12px">';
      html += '<h3 style="font-size:14px;margin-bottom:2px">'+esc(a.title)+'</h3>';
      html += '<p style="font-size:11px;color:'+GRAY+'">'+esc(a.artist_name||'Unknown')+' · '+esc(a.medium||'')+'</p>';
      if (a.description) html += '<p style="font-size:12px;color:#374151;margin-top:6px">'+esc(a.description).substring(0,80)+'</p>';
      html += '</div></div>';
    });
    html += '</div>';
    if (!rows.length) html += '<div class="card" style="text-align:center"><p style="color:'+GRAY+'">No artworks match these filters.</p></div>';
    res.send(page('Collections', html));
  }));
};
