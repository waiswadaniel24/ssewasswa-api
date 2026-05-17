module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5', GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.btn:hover{background:#3730a3}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}</style>';

  (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS ar_markers (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, location_id INT,
        title VARCHAR(200) NOT NULL, ar_content_url TEXT, content_type VARCHAR(50) DEFAULT '3d_model',
        position JSONB DEFAULT '{}', description TEXT, qr_code TEXT,
        active BOOLEAN DEFAULT true, view_count INT DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS ar_tours (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL,
        title VARCHAR(200) NOT NULL, description TEXT,
        stops JSONB DEFAULT '[]', duration_min INT DEFAULT 30,
        difficulty VARCHAR(20) DEFAULT 'easy', language VARCHAR(10) DEFAULT 'en',
        cover_image TEXT, published BOOLEAN DEFAULT false,
        total_visitors INT DEFAULT 0, avg_rating NUMERIC(3,2) DEFAULT 0,
        created_by INT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS ar_analytics (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL,
        tour_id INT, visitor_id INT, visitor_name VARCHAR(100),
        completion_pct NUMERIC(5,2) DEFAULT 0, time_spent INT DEFAULT 0,
        stops_visited JSONB DEFAULT '[]', device_type VARCHAR(50),
        date DATE DEFAULT CURRENT_DATE, started_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ, rating INT
      )`);
      console.log('[Mod] ar-campus-tour OK');
    } catch(e) { console.warn('[Mod] ar-campus-tour Warn:', e.message); }
  })();

  /* ─── Dashboard ─── */
  app.get('/school/ar-campus-tour', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const [markers] = await pool.query('SELECT COUNT(*) AS c FROM ar_markers WHERE tenant_id=$1', [tid]);
    const [tours] = await pool.query('SELECT COUNT(*) AS c FROM ar_tours WHERE tenant_id=$1', [tid]);
    const [analytics] = await pool.query('SELECT COUNT(*) AS c FROM ar_analytics WHERE tenant_id=$1 AND date=CURRENT_DATE', [tid]);
    const [recent] = await pool.query('SELECT * FROM ar_analytics WHERE tenant_id=$1 ORDER BY started_at DESC LIMIT 5', [tid]);
    const [topTours] = await pool.query(
      'SELECT t.id, t.title, t.total_visitors, t.avg_rating FROM ar_tours t WHERE t.tenant_id=$1 ORDER BY t.total_visitors DESC LIMIT 5', [tid]);
    res.send(renderPage(req, 'AR Campus Tour', SKIP + `
      <div class="card"><h2 style="color:${P}">AR Campus Tour Dashboard</h2>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:20px 0">
        <div class="card" style="text-align:center"><h3 style="color:${P}">${markers.c}</h3><small>AR Markers</small></div>
        <div class="card" style="text-align:center"><h3 style="color:${P}">${tours.c}</h3><small>Tours</small></div>
        <div class="card" style="text-align:center"><h3 style="color:${P}">${analytics.c}</h3><small>Visitors Today</small></div>
        <div class="card" style="text-align:center"><h3 style="color:${P}">${topTours.length}</h3><small>Active Tours</small></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div class="card"><h3 style="color:${P}">Recent Visitors</h3>
          <table><tr><th>Visitor</th><th>Tour</th><th>Completion</th><th>Time</th></tr>
          ${recent.map(r => `<tr><td>${esc(r.visitor_name||'Anon')}</td><td>${r.tour_id||'-'}</td>
            <td>${r.completion_pct}%</td><td>${Math.round(r.time_spent/60)}m</td></tr>`).join('')}</table>
        </div>
        <div class="card"><h3 style="color:${P}">Top Tours</h3>
          <table><tr><th>Tour</th><th>Visitors</th><th>Rating</th></tr>
          ${topTours.map(t => `<tr><td>${esc(t.title)}</td><td>${t.total_visitors}</td>
            <td>${'★'.repeat(Math.round(t.avg_rating))}${'☆'.repeat(5-Math.round(t.avg_rating))}</td></tr>`).join('')}</table>
        </div>
      </div>
      <div style="margin-top:16px">
        <a class="btn" href="/school/ar-campus-tour/markers">Manage Markers</a>
        <a class="btn" href="/school/ar-campus-tour/tours" style="background:#059669">Manage Tours</a>
        <a class="btn" href="/school/ar-campus-tour/analytics" style="background:#d97706">Analytics</a>
        <a class="btn" href="/school/ar-campus-tour/qr" style="background:#7c3aed">QR Codes</a>
      </div></div>`, {activeNav: 'ar-campus-tour'}));
  }));

  /* ─── Markers List ─── */
  app.get('/school/ar-campus-tour/markers', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const [rows] = await pool.query(
      'SELECT * FROM ar_markers WHERE tenant_id=$1 ORDER BY created_at DESC', [tid]);
    res.send(renderPage(req, 'AR Markers', SKIP + `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <h2 style="color:${P}">AR Markers (${rows.length})</h2>
          <a class="btn" href="/school/ar-campus-tour/markers/new">+ Add Marker</a>
        </div>
        <table><tr><th>Title</th><th>Content Type</th><th>Location</th><th>Views</th><th>Status</th><th>Actions</th></tr>
        ${rows.map(r => `<tr>
          <td><strong>${esc(r.title)}</strong></td>
          <td><span style="background:#e0e7ff;color:${P};padding:2px 8px;border-radius:4px;font-size:12px">${esc(r.content_type)}</span></td>
          <td>${r.location_id || '-'}</td>
          <td>${r.view_count}</td>
          <td>${r.active ? '<span style="color:#059669">● Active</span>' : '<span style="color:#dc2626">● Inactive</span>'}</td>
          <td><a href="/school/ar-campus-tour/markers/${r.id}/edit" style="color:${P}">Edit</a> |
              <a href="/school/ar-campus-tour/markers/${r.id}/delete" style="color:#dc2626" onclick="return confirm('Delete?')">Delete</a></td>
        </tr>`).join('')}
      </table></div>`, {activeNav: 'ar-campus-tour'}));
  }));

  /* ─── New Marker ─── */
  app.get('/school/ar-campus-tour/markers/new', requireAuth, requireNotBanned, (req, res) => {
    res.send(renderPage(req, 'New AR Marker', SKIP + `
      <div class="card"><h2 style="color:${P}">Add AR Marker</h2>
      <form method="POST" action="/school/ar-campus-tour/markers/new">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div><label>Title</label><input name="title" required></div>
          <div><label>Content Type</label><select name="content_type">
            <option value="3d_model">3D Model</option><option value="video">Video</option>
            <option value="image">Image</option><option value="audio">Audio</option>
            <option value="info_panel">Info Panel</option></select></div>
          <div><label>AR Content URL</label><input name="ar_content_url" placeholder="https://..."></div>
          <div><label>Location ID</label><input name="location_id" type="number"></div>
          <div style="grid-column:span 2"><label>Description</label><textarea name="description" rows="3"></textarea></div>
          <div><label>Position JSON</label><textarea name="position" rows="4" placeholder='{"lat":0,"lng":0,"altitude":0}'></textarea></div>
          <div><label>Active</label><select name="active"><option value="1">Yes</option><option value="0">No</option></select></div>
        </div>
        <button class="btn" type="submit" style="margin-top:16px">Create Marker</button>
        <a href="/school/ar-campus-tour/markers" class="btn" style="background:${GRAY}">Cancel</a>
      </form></div>`, {activeNav: 'ar-campus-tour'}));
  });

  app.post('/school/ar-campus-tour/markers/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const { title, content_type, ar_content_url, location_id, description, position, active } = req.body;
    let pos = {};
    try { pos = JSON.parse(position || '{}'); } catch(e) { pos = {}; }
    await pool.query(
      `INSERT INTO ar_markers (tenant_id, title, content_type, ar_content_url, location_id, description, position, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [tid, title, content_type||'3d_model', ar_content_url, location_id||null, description, pos, active==='1']);
    await audit(req, 'ar_marker_created', { title });
    res.redirect('/school/ar-campus-tour/markers');
  }));

  /* ─── Edit Marker ─── */
  app.get('/school/ar-campus-tour/markers/:id/edit', requireAuth, requireNotBanned, ah(async (req, res) => {
    const [rows] = await pool.query('SELECT * FROM ar_markers WHERE id=$1 AND tenant_id=$2', [req.params.id, req.user.tenant_id]);
    if (!rows.length) return res.send('Not found');
    const m = rows[0];
    const posStr = typeof m.position === 'string' ? m.position : JSON.stringify(m.position);
    res.send(renderPage(req, 'Edit AR Marker', SKIP + `
      <div class="card"><h2 style="color:${P}">Edit: ${esc(m.title)}</h2>
      <form method="POST" action="/school/ar-campus-tour/markers/${m.id}/edit">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div><label>Title</label><input name="title" value="${esc(m.title)}" required></div>
          <div><label>Content Type</label><select name="content_type">
            ${['3d_model','video','image','audio','info_panel'].map(t => `<option value="${t}" ${m.content_type===t?'selected':''}>${t}</option>`).join('')}
          </select></div>
          <div><label>AR Content URL</label><input name="ar_content_url" value="${esc(m.ar_content_url||'')}"></div>
          <div><label>Location ID</label><input name="location_id" type="number" value="${m.location_id||''}"></div>
          <div style="grid-column:span 2"><label>Description</label><textarea name="description" rows="3">${esc(m.description||'')}</textarea></div>
          <div><label>Position JSON</label><textarea name="position" rows="4">${esc(posStr)}</textarea></div>
          <div><label>Active</label><select name="active">
            <option value="1" ${m.active?'selected':''}>Yes</option><option value="0" ${!m.active?'selected':''}>No</option></select></div>
        </div>
        <button class="btn" type="submit" style="margin-top:16px">Save Changes</button>
        <a href="/school/ar-campus-tour/markers" class="btn" style="background:${GRAY}">Cancel</a>
      </form></div>`, {activeNav: 'ar-campus-tour'}));
  }));

  app.post('/school/ar-campus-tour/markers/:id/edit', requireAuth, requireNotBanned, ah(async (req, res) => {
    const { title, content_type, ar_content_url, location_id, description, position, active } = req.body;
    let pos = {};
    try { pos = JSON.parse(position || '{}'); } catch(e) { pos = {}; }
    await pool.query(
      `UPDATE ar_markers SET title=$1, content_type=$2, ar_content_url=$3, location_id=$4,
       description=$5, position=$6, active=$7, updated_at=NOW() WHERE id=$8 AND tenant_id=$9`,
      [title, content_type||'3d_model', ar_content_url, location_id||null, description, pos, active==='1', req.params.id, req.user.tenant_id]);
    await audit(req, 'ar_marker_updated', { id: req.params.id, title });
    res.redirect('/school/ar-campus-tour/markers');
  }));

  /* ─── Delete Marker ─── */
  app.get('/school/ar-campus-tour/markers/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
    await pool.query('DELETE FROM ar_markers WHERE id=$1 AND tenant_id=$2', [req.params.id, req.user.tenant_id]);
    await audit(req, 'ar_marker_deleted', { id: req.params.id });
    res.redirect('/school/ar-campus-tour/markers');
  }));

  /* ─── Tours List ─── */
  app.get('/school/ar-campus-tour/tours', requireAuth, requireNotBanned, ah(async (req, res) => {
    const [rows] = await pool.query('SELECT * FROM ar_tours WHERE tenant_id=$1 ORDER BY created_at DESC', [req.user.tenant_id]);
    res.send(renderPage(req, 'AR Tours', SKIP + `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <h2 style="color:${P}">Campus Tours (${rows.length})</h2>
          <a class="btn" href="/school/ar-campus-tour/tours/new">+ New Tour</a>
        </div>
        <table><tr><th>Title</th><th>Duration</th><th>Difficulty</th><th>Visitors</th><th>Rating</th><th>Published</th><th>Actions</th></tr>
        ${rows.map(t => {
          const stops = Array.isArray(t.stops) ? t.stops : [];
          return `<tr>
            <td><strong>${esc(t.title)}</strong><br><small style="color:${GRAY}">${stops.length} stops</small></td>
            <td>${t.duration_min} min</td>
            <td><span style="text-transform:capitalize">${esc(t.difficulty)}</span></td>
            <td>${t.total_visitors}</td>
            <td>${'★'.repeat(Math.round(t.avg_rating))}${'☆'.repeat(5-Math.round(t.avg_rating))}</td>
            <td>${t.published ? '<span style="color:#059669">● Live</span>' : '<span style="color:${GRAY}">Draft</span>'}</td>
            <td><a href="/school/ar-campus-tour/tours/${t.id}/edit" style="color:${P}">Edit</a> |
                <a href="/school/ar-campus-tour/tours/${t.id}/analytics" style="color:#d97706">Stats</a> |
                <a href="/school/ar-campus-tour/tours/${t.id}/delete" style="color:#dc2626" onclick="return confirm('Delete?')">Delete</a></td>
          </tr>`;
        }).join('')}
      </table></div>`, {activeNav: 'ar-campus-tour'}));
  }));

  /* ─── New Tour ─── */
  app.get('/school/ar-campus-tour/tours/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    const [markers] = await pool.query('SELECT id, title FROM ar_markers WHERE tenant_id=$1 AND active=true', [req.user.tenant_id]);
    res.send(renderPage(req, 'New AR Tour', SKIP + `
      <div class="card"><h2 style="color:${P}">Create Campus Tour</h2>
      <form method="POST" action="/school/ar-campus-tour/tours/new">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div><label>Tour Title</label><input name="title" required></div>
          <div><label>Duration (min)</label><input name="duration_min" type="number" value="30" min="5"></div>
          <div><label>Difficulty</label><select name="difficulty">
            <option value="easy">Easy</option><option value="moderate">Moderate</option><option value="hard">Hard</option></select></div>
          <div><label>Language</label><select name="language">
            <option value="en">English</option><option value="es">Spanish</option><option value="fr">French</option></select></div>
          <div style="grid-column:span 2"><label>Description</label><textarea name="description" rows="3"></textarea></div>
          <div><label>Cover Image URL</label><input name="cover_image"></div>
          <div><label>Published</label><select name="published"><option value="0">Draft</option><option value="1">Publish Now</option></select></div>
        </div>
        <h3 style="color:${P};margin-top:20px">Tour Stops</h3>
        <p style="color:${GRAY};font-size:13px">Select markers to include as stops. Order matters.</p>
        <div id="stops-list">
          ${markers.map(m => `<label style="display:block;padding:6px 0;border-bottom:1px solid #f3f4f6">
            <input type="checkbox" name="stops" value="${m.id}"> ${esc(m.title)}
          </label>`).join('')}
        </div>
        <button class="btn" type="submit" style="margin-top:16px">Create Tour</button>
        <a href="/school/ar-campus-tour/tours" class="btn" style="background:${GRAY}">Cancel</a>
      </form></div>`, {activeNav: 'ar-campus-tour'}));
  }));

  app.post('/school/ar-campus-tour/tours/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const { title, description, duration_min, difficulty, language, cover_image, published } = req.body;
    const stops = Array.isArray(req.body.stops) ? req.body.stops.map(Number) : req.body.stops ? [Number(req.body.stops)] : [];
    await pool.query(
      `INSERT INTO ar_tours (tenant_id, title, description, stops, duration_min, difficulty, language, cover_image, published, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [tid, title, description, JSON.stringify(stops), duration_min||30, difficulty||'easy', language||'en', cover_image, published==='1', req.user.id]);
    await audit(req, 'ar_tour_created', { title });
    res.redirect('/school/ar-campus-tour/tours');
  }));

  /* ─── Edit Tour ─── */
  app.get('/school/ar-campus-tour/tours/:id/edit', requireAuth, requireNotBanned, ah(async (req, res) => {
    const [rows] = await pool.query('SELECT * FROM ar_tours WHERE id=$1 AND tenant_id=$2', [req.params.id, req.user.tenant_id]);
    if (!rows.length) return res.send('Not found');
    const t = rows[0];
    const [markers] = await pool.query('SELECT id, title FROM ar_markers WHERE tenant_id=$1 AND active=true', [req.user.tenant_id]);
    const currentStops = Array.isArray(t.stops) ? t.stops : (typeof t.stops === 'string' ? JSON.parse(t.stops||'[]') : []);
    res.send(renderPage(req, 'Edit AR Tour', SKIP + `
      <div class="card"><h2 style="color:${P}">Edit: ${esc(t.title)}</h2>
      <form method="POST" action="/school/ar-campus-tour/tours/${t.id}/edit">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div><label>Tour Title</label><input name="title" value="${esc(t.title)}" required></div>
          <div><label>Duration (min)</label><input name="duration_min" type="number" value="${t.duration_min}" min="5"></div>
          <div><label>Difficulty</label><select name="difficulty">
            ${['easy','moderate','hard'].map(d => `<option value="${d}" ${t.difficulty===d?'selected':''}>${d}</option>`).join('')}</select></div>
          <div><label>Language</label><select name="language">
            ${['en','es','fr'].map(l => `<option value="${l}" ${t.language===l?'selected':''}>${l}</option>`).join('')}</select></div>
          <div style="grid-column:span 2"><label>Description</label><textarea name="description" rows="3">${esc(t.description||'')}</textarea></div>
          <div><label>Cover Image URL</label><input name="cover_image" value="${esc(t.cover_image||'')}"></div>
          <div><label>Published</label><select name="published">
            <option value="0" ${!t.published?'selected':''}>Draft</option><option value="1" ${t.published?'selected':''}>Publish</option></select></div>
        </div>
        <h3 style="color:${P};margin-top:20px">Tour Stops (drag to reorder)</h3>
        <div id="stops-list">
          ${markers.map(m => `<label style="display:block;padding:6px 0;border-bottom:1px solid #f3f4f6">
            <input type="checkbox" name="stops" value="${m.id}" ${currentStops.includes(m.id)?'checked':''}> ${esc(m.title)}
            ${currentStops.includes(m.id) ? `<small style="color:${P}">Stop #${currentStops.indexOf(m.id)+1}</small>` : ''}
          </label>`).join('')}
        </div>
        <button class="btn" type="submit" style="margin-top:16px">Save Changes</button>
        <a href="/school/ar-campus-tour/tours" class="btn" style="background:${GRAY}">Cancel</a>
      </form></div>`, {activeNav: 'ar-campus-tour'}));
  }));

  app.post('/school/ar-campus-tour/tours/:id/edit', requireAuth, requireNotBanned, ah(async (req, res) => {
    const { title, description, duration_min, difficulty, language, cover_image, published } = req.body;
    const stops = Array.isArray(req.body.stops) ? req.body.stops.map(Number) : req.body.stops ? [Number(req.body.stops)] : [];
    await pool.query(
      `UPDATE ar_tours SET title=$1, description=$2, stops=$3, duration_min=$4, difficulty=$5,
       language=$6, cover_image=$7, published=$8, updated_at=NOW() WHERE id=$9 AND tenant_id=$10`,
      [title, description, JSON.stringify(stops), duration_min||30, difficulty, language, cover_image, published==='1', req.params.id, req.user.tenant_id]);
    await audit(req, 'ar_tour_updated', { id: req.params.id, title });
    res.redirect('/school/ar-campus-tour/tours');
  }));

  /* ─── Delete Tour ─── */
  app.get('/school/ar-campus-tour/tours/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
    await pool.query('DELETE FROM ar_tours WHERE id=$1 AND tenant_id=$2', [req.params.id, req.user.tenant_id]);
    await audit(req, 'ar_tour_deleted', { id: req.params.id });
    res.redirect('/school/ar-campus-tour/tours');
  }));

  /* ─── Tour Analytics ─── */
  app.get('/school/ar-campus-tour/tours/:id/analytics', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const [tours] = await pool.query('SELECT * FROM ar_tours WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    if (!tours.length) return res.send('Not found');
    const tour = tours[0];
    const [visitors] = await pool.query(
      'SELECT * FROM ar_analytics WHERE tenant_id=$1 AND tour_id=$2 ORDER BY date DESC LIMIT 50', [tid, req.params.id]);
    const [agg] = await pool.query(
      'SELECT COUNT(*) AS total, AVG(completion_pct)::numeric(5,2) AS avg_completion, AVG(time_spent)::int AS avg_time FROM ar_analytics WHERE tenant_id=$1 AND tour_id=$2',
      [tid, req.params.id]);
    const [byDevice] = await pool.query(
      'SELECT device_type, COUNT(*) AS c FROM ar_analytics WHERE tenant_id=$1 AND tour_id=$2 GROUP BY device_type ORDER BY c DESC', [tid, req.params.id]);
    const [dailyStats] = await pool.query(
      'SELECT date, COUNT(*) AS visitors, AVG(completion_pct)::numeric(5,2) AS avg_comp FROM ar_analytics WHERE tenant_id=$1 AND tour_id=$2 AND date > CURRENT_DATE - INTERVAL \'14 days\' GROUP BY date ORDER BY date DESC',
      [tid, req.params.id]);
    res.send(renderPage(req, 'Tour Analytics', SKIP + `
      <div class="card">
        <a href="/school/ar-campus-tour/tours" style="color:${P}">← Back to Tours</a>
        <h2 style="color:${P}">${esc(tour.title)} — Analytics</h2>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:16px 0">
          <div class="card" style="text-align:center"><h3 style="color:${P}">${agg.total}</h3><small>Total Visitors</small></div>
          <div class="card" style="text-align:center"><h3 style="color:#059669">${agg.avg_completion||0}%</h3><small>Avg Completion</small></div>
          <div class="card" style="text-align:center"><h3 style="color:#d97706">${Math.round((agg.avg_time||0)/60)}m</h3><small>Avg Time Spent</small></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div class="card"><h3 style="color:${P}">By Device</h3>
            <table><tr><th>Device</th><th>Count</th></tr>
            ${byDevice.map(d => `<tr><td>${esc(d.device_type||'Unknown')}</td><td>${d.c}</td></tr>`).join('')}</table>
          </div>
          <div class="card"><h3 style="color:${P}">Last 14 Days</h3>
            <table><tr><th>Date</th><th>Visitors</th><th>Avg Completion</th></tr>
            ${dailyStats.map(d => `<tr><td>${d.date}</td><td>${d.visitors}</td><td>${d.avg_comp}%</td></tr>`).join('')}</table>
          </div>
        </div>
        <div class="card" style="margin-top:16px"><h3 style="color:${P}">Recent Visitors</h3>
          <table><tr><th>Name</th><th>Completion</th><th>Time</th><th>Rating</th><th>Date</th></tr>
          ${visitors.slice(0, 20).map(v => `<tr>
            <td>${esc(v.visitor_name||'Anon')}</td>
            <td><div style="background:#e5e7eb;border-radius:4px;height:8px;width:100px;display:inline-block">
              <div style="background:${P};height:8px;border-radius:4px;width:${Math.min(v.completion_pct,100)}%"></div></div> ${v.completion_pct}%</td>
            <td>${Math.round(v.time_spent/60)}m</td>
            <td>${v.rating ? '★'.repeat(v.rating) : '-'}</td>
            <td>${v.date}</td></tr>`).join('')}
          </table></div>
      </div>`, {activeNav: 'ar-campus-tour'}));
  }));

  /* ─── QR Code Management ─── */
  app.get('/school/ar-campus-tour/qr', requireAuth, requireNotBanned, ah(async (req, res) => {
    const [rows] = await pool.query(
      'SELECT * FROM ar_markers WHERE tenant_id=$1 AND active=true ORDER BY title', [req.user.tenant_id]);
    const baseUrl = (req.headers['x-forwarded-proto'] || 'https') + '://' + req.headers.host;
    res.send(renderPage(req, 'QR Codes', SKIP + `
      <div class="card">
        <h2 style="color:${P}">QR Code Generator for AR Markers</h2>
        <p style="color:${GRAY}">Scan any QR code to trigger the AR experience at that location. Print and place at physical trigger points.</p>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:16px">
          ${rows.map(m => {
            const qrData = encodeURIComponent(JSON.stringify({ marker_id: m.id, action: 'launch_ar' }));
            const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(baseUrl + '/school/ar-campus-tour/trigger/' + m.id)}`;
            return `<div class="card" style="text-align:center">
              <img src="${qrUrl}" alt="QR" style="border:1px solid #e5e7eb;border-radius:8px;margin-bottom:8px">
              <strong>${esc(m.title)}</strong><br>
              <small style="color:${GRAY}">${esc(m.content_type)}</small><br>
              <a href="${qrUrl}" target="_blank" class="btn" style="margin-top:8px;font-size:12px;padding:4px 12px">Download</a>
            </div>`;
          }).join('')}
        </div>
        ${rows.length === 0 ? '<p style="color:${GRAY};text-align:center;padding:40px">No active markers. Create some first.</p>' : ''}
      </div>`, {activeNav: 'ar-campus-tour'}));
  }));

  /* ─── AR Trigger Endpoint (public) ─── */
  app.get('/school/ar-campus-tour/trigger/:markerId', ah(async (req, res) => {
    const [rows] = await pool.query('SELECT * FROM ar_markers WHERE id=$1 AND active=true', [req.params.markerId]);
    if (!rows.length) return res.send('Marker not found or inactive.');
    const m = rows[0];
    await pool.query('UPDATE ar_markers SET view_count = view_count + 1 WHERE id=$1', [m.id]);
    res.send(renderPage(req, `AR: ${m.title}`, SKIP + `
      <div class="card" style="text-align:center;max-width:600px;margin:40px auto">
        <h2 style="color:${P}">${esc(m.title)}</h2>
        <p style="color:${GRAY}">${esc(m.description || 'Point your camera at this marker to view AR content.')}</p>
        <div style="background:#f3f4f6;border-radius:12px;padding:40px;margin:20px 0">
          ${m.content_type === 'video' ? `<video controls style="max-width:100%;border-radius:8px"><source src="${esc(m.ar_content_url)}" type="video/mp4"></video>` :
            m.content_type === 'image' ? `<img src="${esc(m.ar_content_url)}" style="max-width:100%;border-radius:8px">` :
            m.content_type === 'audio' ? `<audio controls style="width:100%"><source src="${esc(m.ar_content_url)}"></audio>` :
            `<p style="font-size:48px">🔍</p><p>3D Model: <a href="${esc(m.ar_content_url||'#')}" target="_blank">${esc(m.ar_content_url || 'No URL')}</a></p>`}
        </div>
        <small>Marker ID: ${m.id} | Views: ${m.view_count}</small>
      </div>`));
  }));

  /* ─── Global Analytics ─── */
  app.get('/school/ar-campus-tour/analytics', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const [daily] = await pool.query(
      'SELECT date, COUNT(*) AS visitors, AVG(completion_pct)::numeric(5,2) AS avg_comp, AVG(time_spent)::int AS avg_time FROM ar_analytics WHERE tenant_id=$1 AND date > CURRENT_DATE - INTERVAL \'30 days\' GROUP BY date ORDER BY date DESC',
      [tid]);
    const [byTour] = await pool.query(
      'SELECT t.title, COUNT(a.id) AS visits, AVG(a.completion_pct)::numeric(5,2) AS avg_comp FROM ar_analytics a JOIN ar_tours t ON a.tour_id = t.id WHERE a.tenant_id=$1 GROUP BY t.title ORDER BY visits DESC LIMIT 10',
      [tid]);
    const [byDevice] = await pool.query(
      'SELECT device_type, COUNT(*) AS c FROM ar_analytics WHERE tenant_id=$1 GROUP BY device_type ORDER BY c DESC', [tid]);
    const [moodRatings] = await pool.query(
      'SELECT rating, COUNT(*) AS c FROM ar_analytics WHERE tenant_id=$1 AND rating IS NOT NULL GROUP BY rating ORDER BY rating', [tid]);
    const [topMarkers] = await pool.query(
      'SELECT id, title, view_count FROM ar_markers WHERE tenant_id=$1 ORDER BY view_count DESC LIMIT 10', [tid]);
    res.send(renderPage(req, 'AR Tour Analytics', SKIP + `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <h2 style="color:${P}">AR Campus Tour Analytics</h2>
          <a class="btn" href="/school/ar-campus-tour">← Dashboard</a>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div class="card"><h3 style="color:${P}">Last 30 Days Trend</h3>
            <table><tr><th>Date</th><th>Visitors</th><th>Avg Completion</th><th>Avg Time</th></tr>
            ${daily.slice(0, 15).map(d => `<tr><td>${d.date}</td><td>${d.visitors}</td>
              <td><div style="background:#e5e7eb;border-radius:4px;height:6px;width:80px;display:inline-block">
                <div style="background:#059669;height:6px;border-radius:4px;width:${d.avg_comp}%"></div></div> ${d.avg_comp}%</td>
              <td>${Math.round((d.avg_time||0)/60)}m</td></tr>`).join('')}
          </table></div>
          <div class="card"><h3 style="color:${P}">Performance by Tour</h3>
            <table><tr><th>Tour</th><th>Visits</th><th>Avg Completion</th></tr>
            ${byTour.map(t => `<tr><td>${esc(t.title)}</td><td>${t.visits}</td><td>${t.avg_comp}%</td></tr>`).join('')}
          </table></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px">
          <div class="card"><h3 style="color:${P}">By Device Type</h3>
            <table><tr><th>Device</th><th>Sessions</th></tr>
            ${byDevice.map(d => `<tr><td>${esc(d.device_type||'Unknown')}</td><td>${d.c}</td></tr>`).join('')}
          </table></div>
          <div class="card"><h3 style="color:${P}">Top Markers by Views</h3>
            <table><tr><th>Marker</th><th>Views</th></tr>
            ${topMarkers.map(m => `<tr><td>${esc(m.title)}</td><td>${m.view_count}</td></tr>`).join('')}
          </table></div>
        </div>
        <div class="card" style="margin-top:16px"><h3 style="color:${P}">Visitor Ratings Distribution</h3>
          <div style="display:flex;gap:12px;align-items:center;padding:12px">
            ${moodRatings.map(r => `<div style="text-align:center"><strong style="color:${P}">${r.c}</strong><br><small>${r.rating} ★</small></div>`).join('')}
          </div></div>
      </div>`, {activeNav: 'ar-campus-tour'}));
  }));

  /* ─── Multimedia Content Management ─── */
  app.get('/school/ar-campus-tour/content', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const [markers] = await pool.query(
      'SELECT id, title, content_type, ar_content_url, description, active, view_count FROM ar_markers WHERE tenant_id=$1 ORDER BY content_type, title', [tid]);
    const [byType] = await pool.query(
      'SELECT content_type, COUNT(*) AS c, SUM(view_count) AS total_views FROM ar_markers WHERE tenant_id=$1 GROUP BY content_type ORDER BY c DESC', [tid]);
    const [topViewed] = await pool.query(
      'SELECT id, title, content_type, view_count FROM ar_markers WHERE tenant_id=$1 ORDER BY view_count DESC LIMIT 5', [tid]);
    res.send(renderPage(req, 'AR Content Library', SKIP + `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <h2 style="color:${P}">AR Content Library (${markers.length} items)</h2>
          <a class="btn" href="/school/ar-campus-tour/markers/new">+ Add Content</a>
        </div>
        <div class="grid-4" style="margin-bottom:16px">
          ${byType.map(t => `<div class="card" style="text-align:center">
            <h3 style="color:${P}">${t.c}</h3><small>${esc(t.content_type)}</small>
            <div style="font-size:11px;color:${GRAY}">${t.total_views} views</div></div>`).join('')}
        </div>
        ${topViewed.length > 0 ? `<div class="card" style="margin-bottom:16px"><h3 style="color:${P}">Top Viewed Content</h3>
          <div style="display:flex;gap:8px">
            ${topViewed.map(m => `<div class="card" style="flex:1;text-align:center;padding:12px">
              <div style="font-size:16px;font-weight:600">${esc(m.title)}</div>
              <div class="badge badge-blue" style="margin:4px 0">${esc(m.content_type)}</div>
              <small style="color:${GRAY}">${m.view_count} views</small></div>`).join('')}
          </div></div>` : ''}
        <table><tr><th>Title</th><th>Type</th><th>URL</th><th>Views</th><th>Status</th><th>Actions</th></tr>
        ${markers.map(m => `<tr>
          <td><strong>${esc(m.title)}</strong><br><small style="color:${GRAY}">${esc((m.description||'').substring(0,60))}</small></td>
          <td><span class="badge badge-blue">${esc(m.content_type)}</span></td>
          <td><small>${m.ar_content_url ? `<a href="${esc(m.ar_content_url)}" target="_blank" style="color:${P}">${esc(m.ar_content_url.substring(0,40))}...</a>` : 'No URL'}</small></td>
          <td>${m.view_count}</td>
          <td>${m.active ? '<span style="color:#059669">● Active</span>' : '<span style="color:#dc2626">● Inactive</span>'}</td>
          <td><a href="/school/ar-campus-tour/markers/${m.id}/edit" style="color:${P}">Edit</a></td>
        </tr>`).join('')}
      </table></div>
      <div class="card" style="margin-top:16px">
        <h3 style="color:${P}">Content Type Guide</h3>
        <div class="grid-3">
          <div class="card" style="border-left:4px solid #059669"><strong>3D Model</strong><br><small style="color:${GRAY}">GLTF/GLB files for AR objects. Upload to hosting and paste URL.</small></div>
          <div class="card" style="border-left:4px solid #2563eb"><strong>Video</strong><br><small style="color:${GRAY}">MP4 videos that overlay on markers. Keep under 30 seconds for performance.</small></div>
          <div class="card" style="border-left:4px solid #7c3aed"><strong>Image</strong><br><small style="color:${GRAY}">PNG/JPG images with transparency for AR overlays.</small></div>
          <div class="card" style="border-left:4px solid #d97706"><strong>Audio</strong><br><small style="color:${GRAY}">MP3 audio files triggered by location proximity.</small></div>
          <div class="card" style="border-left:4px solid #dc2626"><strong>Info Panel</strong><br><small style="color:${GRAY}">Text-based informational panels with links and formatted content.</small></div>
        </div></div>`, {activeNav: 'ar-campus-tour'}));
  }));

  /* ─── API: Record Analytics ─── */
  app.post('/school/ar-campus-tour/api/track', ah(async (req, res) => {
    const tid = req.user ? req.user.tenant_id : req.body.tenant_id;
    if (!tid) return res.json({ error: 'tenant_id required' });
    const { tour_id, visitor_id, visitor_name, completion_pct, time_spent, stops_visited, device_type, rating } = req.body;
    let stops = [];
    try { stops = typeof stops_visited === 'string' ? JSON.parse(stops_visited) : (stops_visited || []); } catch(e) {}
    const [result] = await pool.query(
      `INSERT INTO ar_analytics (tenant_id, tour_id, visitor_id, visitor_name, completion_pct, time_spent, stops_visited, device_type, rating, started_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW()) RETURNING id`,
      [tid, tour_id, visitor_id, visitor_name, completion_pct||0, time_spent||0, JSON.stringify(stops), device_type, rating]);
    if (tour_id) {
      await pool.query('UPDATE ar_tours SET total_visitors = total_visitors + 1 WHERE id=$1 AND tenant_id=$2', [tour_id, tid]);
      if (rating) {
        await pool.query(
          'UPDATE ar_tours SET avg_rating = (avg_rating * total_visitors + $1) / (total_visitors + 1) WHERE id=$2 AND tenant_id=$3',
          [rating, tour_id, tid]);
      }
    }
    res.json({ success: true, id: result.insertId || result[0]?.id });
  }));

  /* ─── API: Marker Locations Map Data ─── */
  app.get('/school/ar-campus-tour/api/markers', requireAuth, ah(async (req, res) => {
    const [rows] = await pool.query(
      'SELECT id, title, content_type, position, ar_content_url, description, active, view_count FROM ar_markers WHERE tenant_id=$1 ORDER BY title',
      [req.user.tenant_id]);
    res.json(rows);
  }));

  /* ─── API: Tour Detail ─── */
  app.get('/school/ar-campus-tour/api/tours/:id', ah(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT t.*, (SELECT json_agg(json_build_object('id',m.id,'title',m.title,'content_type',m.content_type,'ar_content_url',m.ar_content_url,'position',m.position,'description',m.description))
       FROM jsonb_array_elements_text(t.stops::jsonb) AS sid JOIN ar_markers m ON m.id = sid::int) AS marker_details
       FROM ar_tours t WHERE t.id=$1 AND t.published=true`, [req.params.id]);
    if (!rows.length) return res.json({ error: 'Tour not found' });
    res.json(rows[0]);
  }));
};
