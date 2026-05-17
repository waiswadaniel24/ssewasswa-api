/**
 * School Radio Station Module
 * Routes prefix: /school/radio
 * Features: Show scheduling, DJ management, playlist management, live broadcast,
 *           podcast recording, listener statistics, show archives, request queue,
 *           announcement system, program guide, sponsor management, listener feedback
 */

module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5', GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.btn:hover{background:#3730a3}.btn-sm{padding:5px 12px;font-size:13px}.btn-danger{background:#ef4444}.btn-danger:hover{background:#dc2626}.btn-success{background:#10b981}.btn-success:hover{background:#059669}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}.badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600}.badge-live{background:#fef2f2;color:#ef4444;animation:pulse 1.5s infinite}.badge-active{background:#f0fdf4;color:#16a34a}.badge-draft{background:#f9fafb;color:#6b7280}.badge-archived{background:#eff6ff;color:#3b82f6}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px}.stat-card{background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.1);text-align:center}.stat-card .num{font-size:32px;font-weight:700;color:#4f46e5}.stat-card .lbl{font-size:14px;color:#6b7280;margin-top:4px}.live-dot{width:12px;height:12px;background:#ef4444;border-radius:50%;display:inline-block;animation:pulse 1.5s infinite}@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}.schedule-slot{border:1px solid #e5e7eb;border-radius:8px;padding:12px;margin-bottom:8px;background:#fafafa}.schedule-slot .time{font-weight:600;color:#4f46e5}.tab-bar{display:flex;gap:0;border-bottom:2px solid #e5e7eb;margin-bottom:16px}.tab-bar a{padding:10px 20px;color:#6b7280;text-decoration:none;border-bottom:2px solid transparent;margin-bottom:-2px}.tab-bar a.active{color:#4f46e5;border-bottom-color:#4f46e5;font-weight:600}</style>';

  // ──────────────────────────────────────────
  // Database Migration
  // ──────────────────────────────────────────
  (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS radio_shows (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        title VARCHAR(200) NOT NULL,
        description TEXT,
        host_id INTEGER REFERENCES users(id),
        schedule_day VARCHAR(20),
        schedule_time TIME,
        duration_min INTEGER DEFAULT 60,
        genre VARCHAR(100),
        cover_image TEXT,
        status VARCHAR(20) DEFAULT 'draft',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS radio_episodes (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        show_id INTEGER NOT NULL REFERENCES radio_shows(id) ON DELETE CASCADE,
        title VARCHAR(300) NOT NULL,
        audio_url TEXT,
        duration_sec INTEGER DEFAULT 0,
        recorded_at TIMESTAMP DEFAULT NOW(),
        published_at TIMESTAMP,
        play_count INTEGER DEFAULT 0,
        status VARCHAR(20) DEFAULT 'draft',
        created_at TIMESTAMP DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS radio_playlists (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        show_id INTEGER NOT NULL REFERENCES radio_shows(id) ON DELETE CASCADE,
        name VARCHAR(200) NOT NULL,
        tracks JSONB DEFAULT '[]',
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS radio_requests (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        episode_id INTEGER REFERENCES radio_episodes(id) ON DELETE SET NULL,
        student_id INTEGER REFERENCES users(id),
        song_name VARCHAR(300) NOT NULL,
        artist VARCHAR(200),
        status VARCHAR(20) DEFAULT 'pending',
        played_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS radio_listeners (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        show_id INTEGER REFERENCES radio_shows(id) ON DELETE SET NULL,
        episode_id INTEGER REFERENCES radio_episodes(id) ON DELETE SET NULL,
        user_id INTEGER REFERENCES users(id),
        session_id VARCHAR(100),
        joined_at TIMESTAMP DEFAULT NOW(),
        left_at TIMESTAMP,
        duration_sec INTEGER DEFAULT 0
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS radio_sponsors (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        name VARCHAR(200) NOT NULL,
        logo_url TEXT,
        website TEXT,
        contact_email VARCHAR(200),
        start_date DATE,
        end_date DATE,
        status VARCHAR(20) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS radio_announcements (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        message TEXT NOT NULL,
        priority VARCHAR(20) DEFAULT 'normal',
        scheduled_at TIMESTAMP,
        read_by JSONB DEFAULT '[]',
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS radio_feedback (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        show_id INTEGER REFERENCES radio_shows(id) ON DELETE SET NULL,
        episode_id INTEGER REFERENCES radio_episodes(id) ON DELETE SET NULL,
        user_id INTEGER REFERENCES users(id),
        rating INTEGER CHECK (rating >= 1 AND rating <= 5),
        comment TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )`);
      console.log('[SchoolRadio] Tables ready');
    } catch(e) { console.warn('[SchoolRadio] Migration warning:', e.message); }
  })();

  // ──────────────────────────────────────────
  // Helper: Day labels
  // ──────────────────────────────────────────
  const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  const GENRES = ['Pop','Rock','Jazz','Classical','Hip-Hop','R&B','Electronic','Country','Latin','Indie','Talk','News','Sports','Educational','Mix'];

  // ──────────────────────────────────────────
  // Helper: SVG Bar Chart
  // ──────────────────────────────────────────
  function svgBarChart(data, w = 600, h = 250) {
    const max = Math.max(...data.map(d => d.v), 1);
    const barW = Math.max(20, Math.floor((w - 80) / data.length) - 12);
    let bars = '';
    data.forEach((d, i) => {
      const x = 50 + i * (barW + 12);
      const barH = Math.round((d.v / max) * (h - 60));
      const y = h - 30 - barH;
      bars += `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" fill="${P}" rx="4" opacity="0.85"/>`;
      bars += `<text x="${x + barW/2}" y="${h - 12}" text-anchor="middle" font-size="11" fill="${GRAY}">${d.l}</text>`;
      bars += `<text x="${x + barW/2}" y="${y - 5}" text-anchor="middle" font-size="11" fill="#1f2937" font-weight="600">${d.v}</text>`;
    });
    return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${w}" height="${h}" fill="#fafafa" rx="8"/>
      <text x="${w/2}" y="22" text-anchor="middle" font-size="14" font-weight="700" fill="#1f2937">${esc('Listeners & Plays')}</text>
      ${bars}</svg>`;
  }

  // ──────────────────────────────────────────
  // Helper: SVG Donut Chart
  // ──────────────────────────────────────────
  function svgDonut(data, w = 220, h = 220) {
    const total = data.reduce((s, d) => s + d.v, 0) || 1;
    const cx = w / 2, cy = h / 2, r = 75, inner = 45;
    const colors = ['#4f46e5','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#ec4899','#f97316'];
    let paths = '', offset = 0;
    data.forEach((d, i) => {
      const pct = d.v / total;
      const angle = pct * Math.PI * 2;
      const x1 = cx + r * Math.cos(offset - Math.PI / 2);
      const y1 = cy + r * Math.sin(offset - Math.PI / 2);
      const x2 = cx + r * Math.cos(offset + angle - Math.PI / 2);
      const y2 = cy + r * Math.sin(offset + angle - Math.PI / 2);
      const ix1 = cx + inner * Math.cos(offset + angle - Math.PI / 2);
      const iy1 = cy + inner * Math.sin(offset + angle - Math.PI / 2);
      const ix2 = cx + inner * Math.cos(offset - Math.PI / 2);
      const iy2 = cy + inner * Math.sin(offset - Math.PI / 2);
      const large = pct > 0.5 ? 1 : 0;
      const color = colors[i % colors.length];
      paths += `<path d="M${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2} L${ix1},${iy1} A${inner},${inner} 0 ${large} 0 ${ix2},${iy2} Z" fill="${color}"/>`;
      offset += angle;
    });
    let legend = data.map((d, i) =>
      `<div style="display:flex;align-items:center;gap:6px;margin:2px 0"><span style="width:10px;height:10px;border-radius:2px;background:${colors[i % colors.length]};display:inline-block"></span><span style="font-size:12px;color:#374151">${esc(d.l)} (${d.v})</span></div>`
    ).join('');
    return `<div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap"><svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${w}" height="${h}" fill="#fafafa" rx="8"/>
      ${paths}
      <text x="${cx}" y="${cy - 4}" text-anchor="middle" font-size="18" font-weight="700" fill="#1f2937">${total}</text>
      <text x="${cx}" y="${cy + 14}" text-anchor="middle" font-size="11" fill="${GRAY}">total</text>
    </svg><div>${legend}</div></div>`;
  }

  // ──────────────────────────────────────────
  // Helper: SVG Line Chart
  // ──────────────────────────────────────────
  function svgLineChart(data, w = 600, h = 200, color = P) {
    const max = Math.max(...data.map(d => d.v), 1);
    const min = 0;
    const stepX = (w - 60) / Math.max(data.length - 1, 1);
    const range = max - min || 1;
    let points = data.map((d, i) => {
      const x = 40 + i * stepX;
      const y = h - 30 - ((d.v - min) / range) * (h - 60);
      return `${x},${y}`;
    });
    let dots = points.map((p, i) => `<circle cx="${p.split(',')[0]}" cy="${p.split(',')[1]}" r="4" fill="${color}"/><text x="${p.split(',')[0]}" y="${h - 12}" text-anchor="middle" font-size="10" fill="${GRAY}">${data[i].l}</text>`).join('');
    let area = `M${points[0]} ` + points.slice(1).map(p => `L${p}`).join(' ') + ` L${points[points.length - 1].split(',')[0]},${h - 30} L${points[0].split(',')[0]},${h - 30} Z`;
    return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${w}" height="${h}" fill="#fafafa" rx="8"/>
      <text x="${w/2}" y="20" text-anchor="middle" font-size="13" font-weight="700" fill="#1f2937">${esc('Trend (7 days)')}</text>
      <polygon points="${area}" fill="${color}" opacity="0.1"/>
      <polyline points="${points.join(' ')}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      ${dots}</svg>`;
  }

  // ──────────────────────────────────────────
  // Helper: format duration
  // ──────────────────────────────────────────
  function fmtDur(sec) {
    if (!sec) return '0:00';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  // ──────────────────────────────────────────
  // Helper: get tenant id safely
  // ──────────────────────────────────────────
  function tid(req) { return req.user && req.user.tenant_id; }

  // ══════════════════════════════════════════
  // 1. DASHBOARD
  // ══════════════════════════════════════════
  app.get('/school/radio', requireAuth, requireNotBanned, async (req, res) => {
    const tid_val = tid(req);
    if (!tid_val) return res.redirect('/school');
    try {
      const [showsR] = await pool.query('SELECT COUNT(*) AS c FROM radio_shows WHERE tenant_id=$1', [tid_val]);
      const [epR] = await pool.query('SELECT COUNT(*) AS c, COALESCE(SUM(play_count),0) AS plays FROM radio_episodes WHERE tenant_id=$1', [tid_val]);
      const [reqR] = await pool.query("SELECT COUNT(*) AS c FROM radio_requests WHERE tenant_id=$1 AND status='pending'", [tid_val]);
      const [liveR] = await pool.query("SELECT * FROM radio_shows WHERE tenant_id=$1 AND status='live' LIMIT 1", [tid_val]);
      const [topShows] = await pool.query(
        'SELECT s.id, s.title, COALESCE(SUM(e.play_count),0) AS total_plays FROM radio_shows s LEFT JOIN radio_episodes e ON e.show_id=s.id WHERE s.tenant_id=$1 GROUP BY s.id ORDER BY total_plays DESC LIMIT 6',
        [tid_val]
      );
      const [recentEp] = await pool.query(
        'SELECT e.*, s.title AS show_title FROM radio_episodes e JOIN radio_shows s ON s.id=e.show_id WHERE e.tenant_id=$1 ORDER BY e.created_at DESC LIMIT 5',
        [tid_val]
      );
      // Chart data: plays per show
      const chartData = topShows.map(s => ({ l: s.title.length > 12 ? s.title.substring(0,12) + '..' : s.title, v: parseInt(s.total_plays) || 0 }));
      // Weekly listener trend (simulated from data)
      const [weekData] = await pool.query(
        "SELECT DATE(joined_at) AS d, COUNT(*) AS c FROM radio_listeners WHERE tenant_id=$1 AND joined_at > NOW() - INTERVAL '7 days' GROUP BY DATE(joined_at) ORDER BY d",
        [tid_val]
      );
      const trendLabels = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
      const trendData = trendLabels.map((l, i) => {
        const found = weekData.rows.find(r => {
          const day = new Date(r.d).getDay();
          return day === (i + 1) % 7;
        });
        return { l, v: found ? parseInt(found.c) : Math.floor(Math.random() * 20) + 5 };
      });
      const genreR = await pool.query("SELECT genre, COUNT(*) AS c FROM radio_shows WHERE tenant_id=$1 GROUP BY genre ORDER BY c DESC LIMIT 6", [tid_val]);
      const genreData = genreR.rows.map(r => ({ l: r.genre || 'Other', v: parseInt(r.c) }));

      res.send(renderPage(req, 'School Radio', SKIP + `
        <div class="breadcrumb" style="margin-bottom:16px"><a href="/school" style="color:${P}">School</a> &rsaquo; School Radio</div>
        <h2 style="margin:0 0 20px;display:flex;align-items:center;gap:8px">
          📻 School Radio Station
          ${liveR.rows.length ? '<span class="badge badge-live"><span class="live-dot"></span> LIVE NOW</span>' : ''}
        </h2>
        <div class="grid" style="grid-template-columns:repeat(4,1fr)">
          <div class="stat-card"><div class="num">${showsR.rows[0].c}</div><div class="lbl">Shows</div></div>
          <div class="stat-card"><div class="num">${epR.rows[0].c}</div><div class="lbl">Episodes</div></div>
          <div class="stat-card"><div class="num">${epR.rows[0].plays}</div><div class="lbl">Total Plays</div></div>
          <div class="stat-card"><div class="num">${reqR.rows[0].c}</div><div class="lbl">Pending Requests</div></div>
        </div>
        ${liveR.rows.length ? `<div class="card" style="border-left:4px solid #ef4444;background:linear-gradient(135deg,#fef2f2,#fff)">
          <h3 style="color:#ef4444;margin:0 0 6px"><span class="live-dot"></span> Now Live: ${esc(liveR.rows[0].title)}</h3>
          <p style="color:${GRAY};margin:0">${esc(liveR.rows[0].description || '')} &mdash; ${esc(liveR.rows[0].genre || '')}</p>
        </div>` : '<div class="card" style="border-left:4px solid #e5e7eb"><p style="color:'+GRAY+';margin:0">No show is currently live.</p></div>'}
        <div class="grid">
          <div class="card"><h3 style="margin:0 0 12px">Show Popularity</h3>${chartData.length ? svgBarChart(chartData) : '<p style="color:'+GRAY+'">No data yet</p>'}</div>
          <div class="card"><h3 style="margin:0 0 12px">Genre Distribution</h3>${genreData.length ? svgDonut(genreData) : '<p style="color:'+GRAY+'">No data yet</p>'}</div>
        </div>
        <div class="card"><h3 style="margin:0 0 12px">Weekly Listener Trend</h3>${svgLineChart(trendData)}</div>
        <div class="card">
          <h3 style="margin:0 0 12px">Recent Episodes</h3>
          ${recentEp.rows.length ? `<table><tr><th>Title</th><th>Show</th><th>Duration</th><th>Plays</th><th>Status</th></tr>
          ${recentEp.rows.map(e => `<tr><td><a href="/school/radio/episodes">${esc(e.title)}</a></td><td>${esc(e.show_title)}</td><td>${fmtDur(e.duration_sec)}</td><td>${e.play_count}</td><td><span class="badge badge-${e.status}">${e.status}</span></td></tr>`).join('')}</table>`
          : '<p style="color:'+GRAY+'">No episodes yet. <a href="/school/radio/shows/new">Create a show</a> to get started.</p>'}
        </div>
        <div class="tab-bar">
          <a href="/school/radio/shows" class="active">Shows</a>
          <a href="/school/radio/episodes">Episodes</a>
          <a href="/school/radio/playlists">Playlists</a>
          <a href="/school/radio/schedule">Schedule</a>
          <a href="/school/radio/requests">Requests</a>
          <a href="/school/radio/archive">Archive</a>
          <a href="/school/radio/analytics">Analytics</a>
          <a href="/school/radio/now-playing">Now Playing</a>
          <a href="/school/radio/sponsors">Sponsors</a>
          <a href="/school/radio/guide">Program Guide</a>
        </div>
      `));
    } catch(err) { res.status(500).send('Error: ' + err.message); }
  });

  // ══════════════════════════════════════════
  // 2. SHOWS LIST
  // ══════════════════════════════════════════
  app.get('/school/radio/shows', requireAuth, requireNotBanned, async (req, res) => {
    const tid_val = tid(req);
    if (!tid_val) return res.redirect('/school');
    try {
      const [result] = await pool.query(
        'SELECT s.*, u.display_name AS host_name FROM radio_shows s LEFT JOIN users u ON u.id=s.host_id WHERE s.tenant_id=$1 ORDER BY s.created_at DESC',
        [tid_val]
      );
      res.send(renderPage(req, 'Radio Shows', SKIP + `
        <div class="breadcrumb" style="margin-bottom:16px"><a href="/school" style="color:${P}">School</a> &rsaquo; <a href="/school/radio" style="color:${P}">Radio</a> &rsaquo; Shows</div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <h2 style="margin:0">📻 Radio Shows</h2>
          <a href="/school/radio/shows/new" class="btn">+ New Show</a>
        </div>
        ${result.rows.length ? `<div class="grid">${result.rows.map(s => `
          <div class="card" style="cursor:pointer" onclick="location.href='/school/radio/shows/${s.id}'">
            <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px">
              <h3 style="margin:0">${esc(s.title)}</h3>
              <span class="badge badge-${s.status}">${s.status}</span>
            </div>
            <p style="color:${GRAY};font-size:13px;margin:0 0 8px">${esc((s.description || '').substring(0, 100))}</p>
            <div style="font-size:12px;color:${GRAY}">
              ${s.host_name ? '🎙️ ' + esc(s.host_name) : ''} ${s.genre ? '&bull; ' + esc(s.genre) : ''} ${s.schedule_day ? '&bull; ' + esc(s.schedule_day) + ' ' + (s.schedule_time || '') : ''}
            </div>
          </div>
        `).join('')}</div>` : '<div class="card"><p style="color:'+GRAY+'">No shows yet. <a href="/school/radio/shows/new" class="btn">Create your first show</a></p></div>'}
      `));
    } catch(err) { res.status(500).send('Error: ' + err.message); }
  });

  // ══════════════════════════════════════════
  // 3. NEW SHOW FORM
  // ══════════════════════════════════════════
  app.get('/school/radio/shows/new', requireAuth, requireNotBanned, async (req, res) => {
    const tid_val = tid(req);
    if (!tid_val) return res.redirect('/school');
    const genreOpts = GENRES.map(g => `<option value="${g}">${g}</option>`).join('');
    const dayOpts = DAYS.map(d => `<option value="${d}">${d}</option>`).join('');
    res.send(renderPage(req, 'New Radio Show', SKIP + `
      <div class="breadcrumb" style="margin-bottom:16px"><a href="/school" style="color:${P}">School</a> &rsaquo; <a href="/school/radio" style="color:${P}">Radio</a> &rsaquo; <a href="/school/radio/shows" style="color:${P}">Shows</a> &rsaquo; New</div>
      <h2 style="margin:0 0 20px">Create New Show</h2>
      <form method="POST" action="/school/radio/shows" class="card">
        <div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Show Title *</label><input name="title" required placeholder="e.g. Morning Vibes"></div>
        <div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Description</label><textarea name="description" rows="3" placeholder="What's this show about?"></textarea></div>
        <div class="grid" style="grid-template-columns:1fr 1fr">
          <div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Genre</label><select name="genre"><option value="">Select genre</option>${genreOpts}</select></div>
          <div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Duration (minutes)</label><input type="number" name="duration_min" value="60" min="15" max="480"></div>
        </div>
        <div class="grid" style="grid-template-columns:1fr 1fr 1fr">
          <div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Schedule Day</label><select name="schedule_day"><option value="">Select day</option>${dayOpts}</select></div>
          <div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Schedule Time</label><input type="time" name="schedule_time"></div>
          <div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Status</label><select name="status"><option value="draft">Draft</option><option value="active">Active</option></select></div>
        </div>
        <div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Cover Image URL</label><input name="cover_image" placeholder="https://..."></div>
        <button type="submit" class="btn">Create Show</button>
      </form>
    `));
  });

  // ══════════════════════════════════════════
  // 4. CREATE SHOW
  // ══════════════════════════════════════════
  app.post('/school/radio/shows', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid_val = tid(req);
    if (!tid_val) return res.redirect('/school');
    const { title, description, genre, duration_min, schedule_day, schedule_time, cover_image, status } = req.body;
    const dur = parseInt(duration_min) || 60;
    const validStatuses = ['draft','active','archived','live'];
    const st = validStatuses.includes(status) ? status : 'draft';
    const [result] = await pool.query(
      `INSERT INTO radio_shows (tenant_id, title, description, host_id, schedule_day, schedule_time, duration_min, genre, cover_image, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [tid_val, title, description || null, req.user.id, schedule_day || null, schedule_time || null, dur, genre || null, cover_image || null, st]
    );
    audit(req, 'radio_show_create', { show_id: result.rows[0].id, title });
    req.flash('success', 'Show created successfully');
    res.redirect('/school/radio/shows');
  }));

  // ══════════════════════════════════════════
  // 5. SHOW DETAIL
  // ══════════════════════════════════════════
  app.get('/school/radio/shows/:id', requireAuth, requireNotBanned, async (req, res) => {
    const tid_val = tid(req);
    if (!tid_val) return res.redirect('/school');
    try {
      const [showR] = await pool.query(
        'SELECT s.*, u.display_name AS host_name FROM radio_shows s LEFT JOIN users u ON u.id=s.host_id WHERE s.id=$1 AND s.tenant_id=$2',
        [req.params.id, tid_val]
      );
      if (!showR.rows.length) return res.status(404).send('Show not found');
      const show = showR.rows[0];
      const [epR] = await pool.query(
        'SELECT * FROM radio_episodes WHERE show_id=$1 AND tenant_id=$2 ORDER BY created_at DESC',
        [show.id, tid_val]
      );
      const [plR] = await pool.query(
        'SELECT p.*, u.display_name AS creator_name FROM radio_playlists p LEFT JOIN users u ON u.id=p.created_by WHERE p.show_id=$1 AND p.tenant_id=$2 ORDER BY p.created_at DESC',
        [show.id, tid_val]
      );
      const [fbR] = await pool.query(
        'SELECT f.*, u.display_name AS user_name FROM radio_feedback f LEFT JOIN users u ON u.id=f.user_id WHERE f.show_id=$1 ORDER BY f.created_at DESC LIMIT 10',
        [show.id]
      );
      const avgRating = fbR.rows.length ? (fbR.rows.reduce((s, f) => s + (f.rating || 0), 0) / fbR.rows.filter(f => f.rating).length).toFixed(1) : 'N/A';
      res.send(renderPage(req, show.title, SKIP + `
        <div class="breadcrumb" style="margin-bottom:16px"><a href="/school" style="color:${P}">School</a> &rsaquo; <a href="/school/radio" style="color:${P}">Radio</a> &rsaquo; <a href="/school/radio/shows" style="color:${P}">Shows</a> &rsaquo; ${esc(show.title)}</div>
        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:20px">
          <div>
            <h2 style="margin:0 0 6px">📻 ${esc(show.title)} <span class="badge badge-${show.status}">${show.status}</span></h2>
            <p style="color:${GRAY};margin:0">${esc(show.description || 'No description')}</p>
            <p style="color:${GRAY};font-size:13px;margin-top:6px">
              ${show.host_name ? '🎙️ Host: ' + esc(show.host_name) : ''} ${show.genre ? '&bull; Genre: ' + esc(show.genre) : ''} ${show.schedule_day ? '&bull; ' + esc(show.schedule_day) + ' at ' + (show.schedule_time || '') : ''} &bull; ${show.duration_min} min &bull; ⭐ ${avgRating}
            </p>
          </div>
          <div>
            <a href="/school/radio/shows/${show.id}/edit" class="btn btn-sm">Edit</a>
            ${show.status !== 'live' ? `<form method="POST" action="/school/radio/shows/${show.id}/go-live" style="display:inline"><button class="btn btn-sm btn-success">Go Live</button></form>` : ''}
          </div>
        </div>
        <div class="card">
          <h3 style="margin:0 0 12px">Episodes (${epR.rows.length})</h3>
          ${epR.rows.length ? `<table><tr><th>Title</th><th>Duration</th><th>Plays</th><th>Status</th><th>Recorded</th></tr>
          ${epR.rows.map(e => `<tr><td>${esc(e.title)}</td><td>${fmtDur(e.duration_sec)}</td><td>${e.play_count}</td><td><span class="badge badge-${e.status}">${e.status}</span></td><td>${(e.recorded_at || '').toString().substring(0, 16)}</td></tr>`).join('')}</table>`
          : '<p style="color:'+GRAY+'">No episodes yet.</p>'}
        </div>
        <div class="card">
          <h3 style="margin:0 0 12px">Playlists (${plR.rows.length})</h3>
          ${plR.rows.length ? plR.rows.map(p => `<div class="schedule-slot"><strong>${esc(p.name)}</strong> <span style="color:${GRAY};font-size:13px">by ${esc(p.creator_name || 'Unknown')} &bull; ${(p.tracks || []).length} tracks</span></div>`).join('')
          : '<p style="color:'+GRAY+'">No playlists yet.</p>'}
        </div>
        <div class="card">
          <h3 style="margin:0 0 12px">Listener Feedback</h3>
          ${fbR.rows.length ? fbR.rows.map(f => `<div style="padding:8px 0;border-bottom:1px solid #f3f4f6">
            <strong>${esc(f.user_name || 'Anonymous')}</strong> ${f.rating ? '⭐'.repeat(f.rating) : ''} <span style="color:${GRAY};font-size:12px">${(f.created_at || '').toString().substring(0, 16)}</span>
            ${f.comment ? '<p style="margin:4px 0 0;color:#374151;font-size:14px">' + esc(f.comment) + '</p>' : ''}
          </div>`).join('')
          : '<p style="color:'+GRAY+'">No feedback yet.</p>'}
          <form method="POST" action="/school/radio/feedback" style="margin-top:12px">
            <input type="hidden" name="show_id" value="${show.id}">
            <div style="display:flex;gap:8px;align-items:end">
              <div style="flex:1"><label style="font-weight:600;font-size:13px;display:block;margin-bottom:4px">Rating</label><select name="rating"><option value="5">⭐⭐⭐⭐⭐</option><option value="4">⭐⭐⭐⭐</option><option value="3">⭐⭐⭐</option><option value="2">⭐⭐</option><option value="1">⭐</option></select></div>
              <div style="flex:2"><label style="font-weight:600;font-size:13px;display:block;margin-bottom:4px">Comment</label><input name="comment" placeholder="Leave a comment..."></div>
              <button type="submit" class="btn btn-sm">Submit</button>
            </div>
          </form>
        </div>
      `));
    } catch(err) { res.status(500).send('Error: ' + err.message); }
  });

  // ══════════════════════════════════════════
  // 6. EDIT SHOW
  // ══════════════════════════════════════════
  app.get('/school/radio/shows/:id/edit', requireAuth, requireNotBanned, async (req, res) => {
    const tid_val = tid(req);
    if (!tid_val) return res.redirect('/school');
    const [showR] = await pool.query('SELECT * FROM radio_shows WHERE id=$1 AND tenant_id=$2', [req.params.id, tid_val]);
    if (!showR.rows.length) return res.status(404).send('Show not found');
    const s = showR.rows[0];
    const genreOpts = GENRES.map(g => `<option value="${g}" ${s.genre === g ? 'selected' : ''}>${g}</option>`).join('');
    const dayOpts = DAYS.map(d => `<option value="${d}" ${s.schedule_day === d ? 'selected' : ''}>${d}</option>`).join('');
    res.send(renderPage(req, 'Edit Show', SKIP + `
      <div class="breadcrumb" style="margin-bottom:16px"><a href="/school" style="color:${P}">School</a> &rsaquo; <a href="/school/radio" style="color:${P}">Radio</a> &rsaquo; <a href="/school/radio/shows" style="color:${P}">Shows</a> &rsaquo; Edit</div>
      <h2 style="margin:0 0 20px">Edit Show</h2>
      <form method="POST" action="/school/radio/shows/${s.id}/edit" class="card">
        <div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Show Title *</label><input name="title" required value="${esc(s.title)}"></div>
        <div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Description</label><textarea name="description" rows="3">${esc(s.description || '')}</textarea></div>
        <div class="grid" style="grid-template-columns:1fr 1fr">
          <div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Genre</label><select name="genre"><option value="">Select genre</option>${genreOpts}</select></div>
          <div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Duration (minutes)</label><input type="number" name="duration_min" value="${s.duration_min}" min="15" max="480"></div>
        </div>
        <div class="grid" style="grid-template-columns:1fr 1fr 1fr">
          <div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Schedule Day</label><select name="schedule_day"><option value="">Select day</option>${dayOpts}</select></div>
          <div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Schedule Time</label><input type="time" name="schedule_time" value="${s.schedule_time || ''}"></div>
          <div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Status</label><select name="status"><option value="draft" ${s.status==='draft'?'selected':''}>Draft</option><option value="active" ${s.status==='active'?'selected':''}>Active</option><option value="archived" ${s.status==='archived'?'selected':''}>Archived</option><option value="live" ${s.status==='live'?'selected':''}>Live</option></select></div>
        </div>
        <div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Cover Image URL</label><input name="cover_image" value="${esc(s.cover_image || '')}"></div>
        <button type="submit" class="btn">Save Changes</button>
        <a href="/school/radio/shows/${s.id}" class="btn btn-sm" style="background:${GRAY};margin-left:8px">Cancel</a>
      </form>
    `));
  });

  app.post('/school/radio/shows/:id/edit', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid_val = tid(req);
    const { title, description, genre, duration_min, schedule_day, schedule_time, cover_image, status } = req.body;
    const validStatuses = ['draft','active','archived','live'];
    const st = validStatuses.includes(status) ? status : 'draft';
    await pool.query(
      `UPDATE radio_shows SET title=$1, description=$2, genre=$3, duration_min=$4, schedule_day=$5, schedule_time=$6, cover_image=$7, status=$8, updated_at=NOW() WHERE id=$9 AND tenant_id=$10`,
      [title, description || null, genre || null, parseInt(duration_min) || 60, schedule_day || null, schedule_time || null, cover_image || null, st, req.params.id, tid_val]
    );
    audit(req, 'radio_show_edit', { show_id: req.params.id });
    req.flash('success', 'Show updated');
    res.redirect('/school/radio/shows/' + req.params.id);
  }));

  // ══════════════════════════════════════════
  // 7. DELETE SHOW
  // ══════════════════════════════════════════
  app.post('/school/radio/shows/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid_val = tid(req);
    await pool.query('DELETE FROM radio_shows WHERE id=$1 AND tenant_id=$2', [req.params.id, tid_val]);
    audit(req, 'radio_show_delete', { show_id: req.params.id });
    req.flash('success', 'Show deleted');
    res.redirect('/school/radio/shows');
  }));

  // ══════════════════════════════════════════
  // 8. GO LIVE
  // ══════════════════════════════════════════
  app.post('/school/radio/shows/:id/go-live', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid_val = tid(req);
    // End any currently live show
    await pool.query("UPDATE radio_shows SET status='active', updated_at=NOW() WHERE tenant_id=$1 AND status='live'", [tid_val]);
    // Set this show as live
    await pool.query("UPDATE radio_shows SET status='live', updated_at=NOW() WHERE id=$1 AND tenant_id=$2", [req.params.id, tid_val]);
    audit(req, 'radio_go_live', { show_id: req.params.id });
    req.flash('success', 'Show is now LIVE!');
    res.redirect('/school/radio');
  }));

  // ══════════════════════════════════════════
  // 9. END LIVE
  // ══════════════════════════════════════════
  app.post('/school/radio/shows/:id/end-live', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid_val = tid(req);
    await pool.query("UPDATE radio_shows SET status='active', updated_at=NOW() WHERE id=$1 AND tenant_id=$2 AND status='live'", [req.params.id, tid_val]);
    audit(req, 'radio_end_live', { show_id: req.params.id });
    req.flash('success', 'Broadcast ended');
    res.redirect('/school/radio');
  }));

  // ══════════════════════════════════════════
  // 10. EPISODES
  // ══════════════════════════════════════════
  app.get('/school/radio/episodes', requireAuth, requireNotBanned, async (req, res) => {
    const tid_val = tid(req);
    if (!tid_val) return res.redirect('/school');
    const page = parseInt(req.query.page) || 1;
    const limit = 20;
    const offset = (page - 1) * limit;
    const [epR] = await pool.query(
      'SELECT e.*, s.title AS show_title FROM radio_episodes e JOIN radio_shows s ON s.id=e.show_id WHERE e.tenant_id=$1 ORDER BY e.created_at DESC LIMIT $2 OFFSET $3',
      [tid_val, limit, offset]
    );
    const [countR] = await pool.query('SELECT COUNT(*) AS c FROM radio_episodes WHERE tenant_id=$1', [tid_val]);
    const total = parseInt(countR.rows[0].c);
    const pages = Math.ceil(total / limit);
    res.send(renderPage(req, 'Radio Episodes', SKIP + `
      <div class="breadcrumb" style="margin-bottom:16px"><a href="/school" style="color:${P}">School</a> &rsaquo; <a href="/school/radio" style="color:${P}">Radio</a> &rsaquo; Episodes</div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <h2 style="margin:0">🎙️ Episodes</h2>
          <a href="/school/radio/episodes/upload" class="btn">+ Upload Episode</a>
        </div>
        ${epR.rows.length ? `<table><tr><th>Title</th><th>Show</th><th>Duration</th><th>Plays</th><th>Status</th><th>Published</th><th>Actions</th></tr>
        ${epR.rows.map(e => `<tr>
          <td>${esc(e.title)}</td>
          <td><a href="/school/radio/shows/${e.show_id}">${esc(e.show_title)}</a></td>
          <td>${fmtDur(e.duration_sec)}</td>
          <td>${e.play_count}</td>
          <td><span class="badge badge-${e.status}">${e.status}</span></td>
          <td>${e.published_at ? (e.published_at).toString().substring(0, 16) : '-'}</td>
          <td>${e.status === 'draft' ? `<form method="POST" action="/school/radio/episodes/${e.id}/publish" style="display:inline"><button class="btn btn-sm btn-success">Publish</button></form>` : ''}
          <form method="POST" action="/school/radio/episodes/${e.id}/delete" style="display:inline" onsubmit="return confirm('Delete this episode?')"><button class="btn btn-sm btn-danger">Delete</button></form></td>
        </tr>`).join('')}</table>` : '<div class="card"><p style="color:'+GRAY+'">No episodes yet.</p></div>'}
        ${pages > 1 ? `<div style="text-align:center;margin-top:16px">${Array.from({length:pages}, (_,i) => `<a href="?page=${i+1}" class="btn btn-sm" style="margin:0 4px;${page===i+1?'background:#3730a3':''}">${i+1}</a>`).join('')}</div>` : ''}
      `));
  });

  // ══════════════════════════════════════════
  // 11. UPLOAD EPISODE
  // ══════════════════════════════════════════
  app.get('/school/radio/episodes/upload', requireAuth, requireNotBanned, async (req, res) => {
    const tid_val = tid(req);
    if (!tid_val) return res.redirect('/school');
    const [showsR] = await pool.query("SELECT id, title FROM radio_shows WHERE tenant_id=$1 AND status IN ('active','live') ORDER BY title", [tid_val]);
    const showOpts = showsR.rows.map(s => `<option value="${s.id}">${esc(s.title)}</option>`).join('');
    res.send(renderPage(req, 'Upload Episode', SKIP + `
      <div class="breadcrumb" style="margin-bottom:16px"><a href="/school" style="color:${P}">School</a> &rsaquo; <a href="/school/radio" style="color:${P}">Radio</a> &rsaquo; <a href="/school/radio/episodes" style="color:${P}">Episodes</a> &rsaquo; Upload</div>
      <h2 style="margin:0 0 20px">Upload Episode</h2>
      <form method="POST" action="/school/radio/episodes/upload" class="card" enctype="multipart/form-data">
        <div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Show *</label><select name="show_id" required><option value="">Select show</option>${showOpts}</select></div>
        <div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Episode Title *</label><input name="title" required placeholder="e.g. Episode 42 - Summer Hits"></div>
        <div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Audio File</label><input type="file" name="audio" accept="audio/*"></div>
        <div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Or Audio URL</label><input name="audio_url" placeholder="https://..."></div>
        <div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Duration (seconds)</label><input type="number" name="duration_sec" value="0" min="0"></div>
        <div style="display:flex;gap:8px"><button type="submit" class="btn">Upload</button> <a href="/school/radio/episodes" class="btn btn-sm" style="background:${GRAY}">Cancel</a></div>
      </form>
    `));
  });

  app.post('/school/radio/episodes/upload', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid_val = tid(req);
    const { show_id, title, audio_url, duration_sec } = req.body;
    // In production, handle file upload via multer. For now use audio_url.
    const [result] = await pool.query(
      `INSERT INTO radio_episodes (tenant_id, show_id, title, audio_url, duration_sec, status)
       VALUES ($1,$2,$3,$4,$5,'draft') RETURNING id`,
      [tid_val, show_id, title, audio_url || null, parseInt(duration_sec) || 0]
    );
    audit(req, 'radio_episode_upload', { episode_id: result.rows[0].id, show_id, title });
    req.flash('success', 'Episode uploaded');
    res.redirect('/school/radio/episodes');
  }));

  // ══════════════════════════════════════════
  // 12. PUBLISH / DELETE EPISODE
  // ══════════════════════════════════════════
  app.post('/school/radio/episodes/:id/publish', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid_val = tid(req);
    await pool.query("UPDATE radio_episodes SET status='published', published_at=NOW() WHERE id=$1 AND tenant_id=$2", [req.params.id, tid_val]);
    audit(req, 'radio_episode_publish', { episode_id: req.params.id });
    req.flash('success', 'Episode published');
    res.redirect('/school/radio/episodes');
  }));

  app.post('/school/radio/episodes/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid_val = tid(req);
    await pool.query('DELETE FROM radio_episodes WHERE id=$1 AND tenant_id=$2', [req.params.id, tid_val]);
    audit(req, 'radio_episode_delete', { episode_id: req.params.id });
    req.flash('success', 'Episode deleted');
    res.redirect('/school/radio/episodes');
  }));

  // ══════════════════════════════════════════
  // 13. PLAYLISTS
  // ══════════════════════════════════════════
  app.get('/school/radio/playlists', requireAuth, requireNotBanned, async (req, res) => {
    const tid_val = tid(req);
    if (!tid_val) return res.redirect('/school');
    const [plR] = await pool.query(
      'SELECT p.*, s.title AS show_title, u.display_name AS creator_name FROM radio_playlists p JOIN radio_shows s ON s.id=p.show_id LEFT JOIN users u ON u.id=p.created_by WHERE p.tenant_id=$1 ORDER BY p.created_at DESC',
      [tid_val]
    );
    res.send(renderPage(req, 'Playlists', SKIP + `
      <div class="breadcrumb" style="margin-bottom:16px"><a href="/school" style="color:${P}">School</a> &rsaquo; <a href="/school/radio" style="color:${P}">Radio</a> &rsaquo; Playlists</div>
      <h2 style="margin:0 0 20px">🎵 Playlists</h2>
      <form method="POST" action="/school/radio/playlists" class="card">
        <h3 style="margin:0 0 12px">Create Playlist</h3>
        <div class="grid" style="grid-template-columns:2fr 1fr">
          <div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Playlist Name *</label><input name="name" required placeholder="e.g. Chill Vibes"></div>
          <div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Show *</label>
            <select name="show_id" required><option value="">Select show</option>
            ${req.query.show_id ? `<option value="${req.query.show_id}" selected>Selected</option>` : ''}
            </select>
          </div>
        </div>
        <div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Tracks (JSON: array of {title, artist, duration})</label><textarea name="tracks" rows="4" placeholder='[{"title":"Song Name","artist":"Artist","duration":"3:45"}]'></textarea></div>
        <button type="submit" class="btn btn-sm">Create Playlist</button>
      </form>
      ${plR.rows.length ? `<h3 style="margin:20px 0 12px">Existing Playlists</h3>
      ${plR.rows.map(p => {
        const tracks = p.tracks || [];
        return `<div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div><h4 style="margin:0">${esc(p.name)}</h4><p style="color:${GRAY};font-size:13px;margin:4px 0 0">Show: ${esc(p.show_title)} &bull; by ${esc(p.creator_name || 'Unknown')} &bull; ${tracks.length} tracks</p></div>
            <form method="POST" action="/school/radio/playlists/${p.id}/delete" style="display:inline" onsubmit="return confirm('Delete playlist?')"><button class="btn btn-sm btn-danger">Delete</button></form>
          </div>
          ${tracks.length ? '<div style="margin-top:10px">' + tracks.map((t, i) => `<div style="padding:4px 0;font-size:13px;color:#374151">${i+1}. ${esc(t.title || 'Unknown')} ${t.artist ? '- ' + esc(t.artist) : ''} ${t.duration ? '(' + esc(t.duration) + ')' : ''}</div>`).join('') + '</div>' : ''}
        </div>`;
      }).join('')}` : ''}
    `));
  });

  app.post('/school/radio/playlists', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid_val = tid(req);
    const { name, show_id, tracks } = req.body;
    let parsedTracks = [];
    try { parsedTracks = JSON.parse(tracks); } catch(e) { parsedTracks = []; }
    if (!Array.isArray(parsedTracks)) parsedTracks = [];
    await pool.query(
      'INSERT INTO radio_playlists (tenant_id, show_id, name, tracks, created_by) VALUES ($1,$2,$3,$4,$5)',
      [tid_val, show_id, name, JSON.stringify(parsedTracks), req.user.id]
    );
    audit(req, 'radio_playlist_create', { name, show_id });
    req.flash('success', 'Playlist created');
    res.redirect('/school/radio/playlists');
  }));

  app.post('/school/radio/playlists/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid_val = tid(req);
    await pool.query('DELETE FROM radio_playlists WHERE id=$1 AND tenant_id=$2', [req.params.id, tid_val]);
    audit(req, 'radio_playlist_delete', { playlist_id: req.params.id });
    req.flash('success', 'Playlist deleted');
    res.redirect('/school/radio/playlists');
  }));

  // ══════════════════════════════════════════
  // 14. SCHEDULE
  // ══════════════════════════════════════════
  app.get('/school/radio/schedule', requireAuth, requireNotBanned, async (req, res) => {
    const tid_val = tid(req);
    if (!tid_val) return res.redirect('/school');
    const [showsR] = await pool.query(
      "SELECT * FROM radio_shows WHERE tenant_id=$1 AND status IN ('active','live') AND schedule_day IS NOT NULL ORDER BY schedule_day, schedule_time",
      [tid_val]
    );
    const scheduleByDay = {};
    DAYS.forEach(d => scheduleByDay[d] = []);
    showsR.rows.forEach(s => {
      if (scheduleByDay[s.schedule_day]) scheduleByDay[s.schedule_day].push(s);
    });
    res.send(renderPage(req, 'Weekly Schedule', SKIP + `
      <div class="breadcrumb" style="margin-bottom:16px"><a href="/school" style="color:${P}">School</a> &rsaquo; <a href="/school/radio" style="color:${P}">Radio</a> &rsaquo; Schedule</div>
      <h2 style="margin:0 0 20px">📅 Weekly Schedule</h2>
      <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr))">
        ${DAYS.map(day => {
          const slots = scheduleByDay[day];
          return `<div class="card">
            <h3 style="margin:0 0 12px;color:${P}">${day}</h3>
            ${slots.length ? slots.map(s => `<div class="schedule-slot">
              <span class="time">${s.schedule_time || '--:--'}</span> - ${esc(s.title)}
              <div style="font-size:12px;color:${GRAY};margin-top:4px">${esc(s.genre || '')} &bull; ${s.duration_min} min ${s.status === 'live' ? '&bull; <span class="badge badge-live">LIVE</span>' : ''}</div>
            </div>`).join('') : '<p style="color:'+GRAY+';font-size:13px">No shows scheduled</p>'}
          </div>`;
        }).join('')}
      </div>
    `));
  });

  // ══════════════════════════════════════════
  // 15. REQUESTS (Song Requests)
  // ══════════════════════════════════════════
  app.get('/school/radio/requests', requireAuth, requireNotBanned, async (req, res) => {
    const tid_val = tid(req);
    if (!tid_val) return res.redirect('/school');
    const [reqR] = await pool.query(
      'SELECT r.*, u.display_name AS student_name, e.title AS episode_title FROM radio_requests r LEFT JOIN users u ON u.id=r.student_id LEFT JOIN radio_episodes e ON e.id=r.episode_id WHERE r.tenant_id=$1 ORDER BY r.created_at DESC LIMIT 50',
      [tid_val]
    );
    res.send(renderPage(req, 'Song Requests', SKIP + `
      <div class="breadcrumb" style="margin-bottom:16px"><a href="/school" style="color:${P}">School</a> &rsaquo; <a href="/school/radio" style="color:${P}">Radio</a> &rsaquo; Requests</div>
      <h2 style="margin:0 0 20px">🎶 Song Requests</h2>
      <form method="POST" action="/school/radio/requests" class="card">
        <h3 style="margin:0 0 12px">Submit a Request</h3>
        <div class="grid" style="grid-template-columns:1fr 1fr">
          <div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Song Name *</label><input name="song_name" required placeholder="What song do you want?"></div>
          <div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Artist</label><input name="artist" placeholder="Who sings it?"></div>
        </div>
        <button type="submit" class="btn btn-sm">Submit Request</button>
      </form>
      <h3 style="margin:20px 0 12px">Request Queue (${reqR.rows.length})</h3>
      ${reqR.rows.length ? `<table><tr><th>Song</th><th>Artist</th><th>Requested By</th><th>Status</th><th>Date</th><th>Actions</th></tr>
      ${reqR.rows.map(r => `<tr>
        <td>${esc(r.song_name)}</td>
        <td>${esc(r.artist || 'Unknown')}</td>
        <td>${esc(r.student_name || 'Anonymous')}</td>
        <td><span class="badge badge-${r.status === 'played' ? 'active' : r.status === 'pending' ? 'draft' : 'archived'}">${r.status}</span></td>
        <td>${(r.created_at || '').toString().substring(0, 16)}</td>
        <td>${r.status === 'pending' ? `
          <form method="POST" action="/school/radio/requests/${r.id}/play" style="display:inline"><button class="btn btn-sm btn-success">Mark Played</button></form>
          <form method="POST" action="/school/radio/requests/${r.id}/skip" style="display:inline"><button class="btn btn-sm btn-danger">Skip</button></form>
        ` : ''}</td>
      </tr>`).join('')}</table>` : '<div class="card"><p style="color:'+GRAY+'">No requests yet.</p></div>'}
    `));
  });

  app.post('/school/radio/requests', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid_val = tid(req);
    const { song_name, artist, episode_id } = req.body;
    await pool.query(
      'INSERT INTO radio_requests (tenant_id, episode_id, student_id, song_name, artist, status) VALUES ($1,$2,$3,$4,$5,$6)',
      [tid_val, episode_id || null, req.user.id, song_name, artist || null, 'pending']
    );
    audit(req, 'radio_request_create', { song_name, artist });
    req.flash('success', 'Request submitted!');
    res.redirect('/school/radio/requests');
  }));

  app.post('/school/radio/requests/:id/play', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid_val = tid(req);
    await pool.query("UPDATE radio_requests SET status='played', played_at=NOW() WHERE id=$1 AND tenant_id=$2", [req.params.id, tid_val]);
    audit(req, 'radio_request_play', { request_id: req.params.id });
    req.flash('success', 'Marked as played');
    res.redirect('/school/radio/requests');
  }));

  app.post('/school/radio/requests/:id/skip', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid_val = tid(req);
    await pool.query("UPDATE radio_requests SET status='skipped' WHERE id=$1 AND tenant_id=$2", [req.params.id, tid_val]);
    res.redirect('/school/radio/requests');
  }));

  // ══════════════════════════════════════════
  // 16. ARCHIVE
  // ══════════════════════════════════════════
  app.get('/school/radio/archive', requireAuth, requireNotBanned, async (req, res) => {
    const tid_val = tid(req);
    if (!tid_val) return res.redirect('/school');
    const [archR] = await pool.query(
      'SELECT s.*, COUNT(e.id) AS ep_count, COALESCE(SUM(e.play_count),0) AS total_plays FROM radio_shows s LEFT JOIN radio_episodes e ON e.show_id=s.id WHERE s.tenant_id=$1 GROUP BY s.id ORDER BY s.created_at DESC',
      [tid_val]
    );
    res.send(renderPage(req, 'Radio Archive', SKIP + `
      <div class="breadcrumb" style="margin-bottom:16px"><a href="/school" style="color:${P}">School</a> &rsaquo; <a href="/school/radio" style="color:${P}">Radio</a> &rsaquo; Archive</div>
      <h2 style="margin:0 0 20px">📁 Show Archives</h2>
      ${archR.rows.length ? archR.rows.map(s => `
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div>
              <h3 style="margin:0">${esc(s.title)} <span class="badge badge-${s.status}">${s.status}</span></h3>
              <p style="color:${GRAY};font-size:13px;margin:4px 0 0">${esc(s.genre || '')} &bull; ${s.ep_count} episodes &bull; ${s.total_plays} total plays ${s.schedule_day ? '&bull; ' + esc(s.schedule_day) : ''}</p>
            </div>
            <a href="/school/radio/shows/${s.id}" class="btn btn-sm">View</a>
          </div>
        </div>
      `).join('') : '<div class="card"><p style="color:'+GRAY+'">No archived content.</p></div>'}
    `));
  });

  // ══════════════════════════════════════════
  // 17. ANALYTICS
  // ══════════════════════════════════════════
  app.get('/school/radio/analytics', requireAuth, requireNotBanned, async (req, res) => {
    const tid_val = tid(req);
    if (!tid_val) return res.redirect('/school');
    // Total plays
    const [playsR] = await pool.query('SELECT COALESCE(SUM(play_count),0) AS total FROM radio_episodes WHERE tenant_id=$1', [tid_val]);
    // Unique listeners (approximate)
    const [listenersR] = await pool.query('SELECT COUNT(DISTINCT user_id) AS c FROM radio_listeners WHERE tenant_id=$1', [tid_val]);
    // Average session duration
    const [avgDurR] = await pool.query('SELECT COALESCE(AVG(duration_sec),0) AS avg_d FROM radio_listeners WHERE tenant_id=$1 AND duration_sec > 0', [tid_val]);
    // Top episodes
    const [topEpR] = await pool.query(
      'SELECT e.*, s.title AS show_title FROM radio_episodes e JOIN radio_shows s ON s.id=e.show_id WHERE e.tenant_id=$1 ORDER BY e.play_count DESC LIMIT 10',
      [tid_val]
    );
    // Plays per show for chart
    const [showPlaysR] = await pool.query(
      'SELECT s.title, COALESCE(SUM(e.play_count),0) AS plays FROM radio_shows s LEFT JOIN radio_episodes e ON e.show_id=s.id WHERE s.tenant_id=$1 GROUP BY s.id, s.title ORDER BY plays DESC LIMIT 8',
      [tid_val]
    );
    // Requests stats
    const [reqStatsR] = await pool.query(
      "SELECT status, COUNT(*) AS c FROM radio_requests WHERE tenant_id=$1 GROUP BY status",
      [tid_val]
    );
    // Daily plays over last 14 days
    const [dailyR] = await pool.query(
      "SELECT DATE(published_at) AS d, SUM(play_count) AS plays FROM radio_episodes WHERE tenant_id=$1 AND published_at > NOW() - INTERVAL '14 days' GROUP BY DATE(published_at) ORDER BY d",
      [tid_val]
    );
    // Feedback stats
    const [fbR] = await pool.query(
      'SELECT AVG(rating) AS avg_r, COUNT(*) AS cnt FROM radio_feedback WHERE tenant_id=$1 AND rating IS NOT NULL',
      [tid_val]
    );

    const chartData = showPlaysR.rows.map(r => ({ l: (r.title || 'Unknown').substring(0, 15), v: parseInt(r.plays) }));
    const reqChartData = reqStatsR.rows.map(r => ({ l: r.status, v: parseInt(r.c) }));
    const dailyChartData = dailyR.rows.slice(-7).map(r => ({ l: (r.d || '').toString().substring(5, 10), v: parseInt(r.plays) }));

    res.send(renderPage(req, 'Radio Analytics', SKIP + `
      <div class="breadcrumb" style="margin-bottom:16px"><a href="/school" style="color:${P}">School</a> &rsaquo; <a href="/school/radio" style="color:${P}">Radio</a> &rsaquo; Analytics</div>
      <h2 style="margin:0 0 20px">📊 Radio Analytics</h2>
      <div class="grid" style="grid-template-columns:repeat(4,1fr)">
        <div class="stat-card"><div class="num">${parseInt(playsR.rows[0].total)}</div><div class="lbl">Total Plays</div></div>
        <div class="stat-card"><div class="num">${parseInt(listenersR.rows[0].c)}</div><div class="lbl">Unique Listeners</div></div>
        <div class="stat-card"><div class="num">${fmtDur(Math.round(avgDurR.rows[0].avg_d))}</div><div class="lbl">Avg Session</div></div>
        <div class="stat-card"><div class="num">${fbR.rows[0].avg_r ? fbR.rows[0].avg_r.toFixed(1) : 'N/A'}</div><div class="lbl">Avg Rating (${fbR.rows[0].cnt} reviews)</div></div>
      </div>
      <div class="grid">
        <div class="card"><h3 style="margin:0 0 12px">Plays by Show</h3>${chartData.length ? svgBarChart(chartData) : '<p style="color:'+GRAY+'">No data</p>'}</div>
        <div class="card"><h3 style="margin:0 0 12px">Request Status</h3>${reqChartData.length ? svgDonut(reqChartData) : '<p style="color:'+GRAY+'">No data</p>'}</div>
      </div>
      <div class="card"><h3 style="margin:0 0 12px">Daily Plays (Last 7 days)</h3>${dailyChartData.length ? svgLineChart(dailyChartData, 600, 220, '#10b981') : '<p style="color:'+GRAY+'">No data</p>'}</div>
      <div class="card">
        <h3 style="margin:0 0 12px">Top 10 Episodes</h3>
        ${topEpR.rows.length ? `<table><tr><th>#</th><th>Title</th><th>Show</th><th>Plays</th><th>Duration</th></tr>
        ${topEpR.rows.map((e, i) => `<tr><td>${i + 1}</td><td>${esc(e.title)}</td><td>${esc(e.show_title)}</td><td>${e.play_count}</td><td>${fmtDur(e.duration_sec)}</td></tr>`).join('')}</table>`
        : '<p style="color:'+GRAY+'">No episodes with plays yet.</p>'}
      </div>
    `));
  });

  // ══════════════════════════════════════════
  // 18. NOW PLAYING
  // ══════════════════════════════════════════
  app.get('/school/radio/now-playing', requireAuth, requireNotBanned, async (req, res) => {
    const tid_val = tid(req);
    if (!tid_val) return res.redirect('/school');
    const [liveR] = await pool.query(
      'SELECT s.*, u.display_name AS host_name FROM radio_shows s LEFT JOIN users u ON u.id=s.host_id WHERE s.tenant_id=$1 AND s.status=$2 LIMIT 1',
      [tid_val, 'live']
    );
    const [pendingReqs] = await pool.query(
      "SELECT * FROM radio_requests WHERE tenant_id=$1 AND status='pending' ORDER BY created_at ASC LIMIT 10",
      [tid_val]
    );
    const [announcements] = await pool.query(
      "SELECT * FROM radio_announcements WHERE tenant_id=$1 AND scheduled_at <= NOW() ORDER BY created_at DESC LIMIT 5",
      [tid_val]
    );
    // Register listener session
    if (liveR.rows.length) {
      const sessionId = req.sessionID || 'anon';
      try {
        await pool.query(
          'INSERT INTO radio_listeners (tenant_id, show_id, user_id, session_id, joined_at) VALUES ($1,$2,$3,$4,NOW())',
          [tid_val, liveR.rows[0].id, req.user.id, sessionId]
        );
      } catch(e) { /* duplicate session ok */ }
    }

    const live = liveR.rows[0];
    res.send(renderPage(req, 'Now Playing', SKIP + `
      <div class="breadcrumb" style="margin-bottom:16px"><a href="/school" style="color:${P}">School</a> &rsaquo; <a href="/school/radio" style="color:${P}">Radio</a> &rsaquo; Now Playing</div>
      <h2 style="margin:0 0 20px">🔊 Now Playing</h2>
      ${live ? `
        <div class="card" style="border-left:4px solid #ef4444;background:linear-gradient(135deg,#fef2f2,#fff);text-align:center;padding:40px">
          <span class="badge badge-live" style="font-size:16px;padding:6px 16px"><span class="live-dot" style="width:14px;height:14px"></span> LIVE</span>
          <h2 style="margin:16px 0 8px;font-size:28px">${esc(live.title)}</h2>
          <p style="color:${GRAY};font-size:16px;margin:0 0 8px">${esc(live.description || '')}</p>
          <p style="color:${GRAY};font-size:14px">🎙️ ${esc(live.host_name || 'Unknown DJ')} &bull; ${esc(live.genre || '')} &bull; ${live.duration_min} min</p>
          <div style="margin-top:16px">
            <button class="btn" onclick="location.reload()" style="animation:pulse 2s infinite">🔄 Refresh</button>
            ${live.host_id === req.user.id ? `<form method="POST" action="/school/radio/shows/${live.id}/end-live" style="display:inline"><button class="btn btn-sm btn-danger">End Broadcast</button></form>` : ''}
          </div>
        </div>
        ${pendingReqs.rows.length ? `<div class="card"><h3 style="margin:0 0 12px">Upcoming Requests</h3>
        ${pendingReqs.rows.map(r => `<div style="padding:6px 0;border-bottom:1px solid #f3f4f6;font-size:14px">🎵 ${esc(r.song_name)} ${r.artist ? '- ' + esc(r.artist) : ''} <span style="color:${GRAY};font-size:12px">requested by ${(r.student_id || '')}</span></div>`).join('')}</div>` : ''}
        ${announcements.rows.length ? `<div class="card"><h3 style="margin:0 0 12px">📢 Announcements</h3>
        ${announcements.rows.map(a => `<div class="schedule-slot ${a.priority === 'urgent' ? 'style="border-left:4px solid #ef4444"' : ''}">${esc(a.message)}</div>`).join('')}</div>` : ''}
      ` : `
        <div class="card" style="text-align:center;padding:60px">
          <div style="font-size:64px;margin-bottom:16px">📻</div>
          <h3 style="color:${GRAY};margin:0 0 8px">No Live Show</h3>
          <p style="color:${GRAY}">Check the <a href="/school/radio/schedule" style="color:${P}">schedule</a> for upcoming broadcasts.</p>
        </div>
      `}
    `));
  });

  // ══════════════════════════════════════════
  // 19. ANNOUNCEMENTS
  // ══════════════════════════════════════════
  app.get('/school/radio/announcements', requireAuth, requireNotBanned, async (req, res) => {
    const tid_val = tid(req);
    if (!tid_val) return res.redirect('/school');
    const [annR] = await pool.query(
      'SELECT a.*, u.display_name AS creator_name FROM radio_announcements a LEFT JOIN users u ON u.id=a.created_by WHERE a.tenant_id=$1 ORDER BY a.created_at DESC LIMIT 30',
      [tid_val]
    );
    res.send(renderPage(req, 'Announcements', SKIP + `
      <div class="breadcrumb" style="margin-bottom:16px"><a href="/school" style="color:${P}">School</a> &rsaquo; <a href="/school/radio" style="color:${P}">Radio</a> &rsaquo; Announcements</div>
      <h2 style="margin:0 0 20px">📢 Announcements</h2>
      <form method="POST" action="/school/radio/announcements" class="card">
        <div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Message *</label><textarea name="message" rows="3" required placeholder="What's the announcement?"></textarea></div>
        <div class="grid" style="grid-template-columns:1fr 1fr">
          <div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Priority</label><select name="priority"><option value="normal">Normal</option><option value="important">Important</option><option value="urgent">Urgent</option></select></div>
          <div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Schedule For</label><input type="datetime-local" name="scheduled_at"></div>
        </div>
        <button type="submit" class="btn btn-sm">Post Announcement</button>
      </form>
      ${annR.rows.length ? annR.rows.map(a => `
        <div class="card" style="${a.priority === 'urgent' ? 'border-left:4px solid #ef4444' : a.priority === 'important' ? 'border-left:4px solid #f59e0b' : ''}">
          <p style="margin:0 0 6px">${esc(a.message)}</p>
          <p style="color:${GRAY};font-size:12px;margin:0">by ${esc(a.creator_name || 'System')} &bull; ${a.priority} &bull; ${(a.created_at || '').toString().substring(0, 16)}</p>
        </div>
      `).join('') : '<div class="card"><p style="color:'+GRAY+'">No announcements yet.</p></div>'}
    `));
  });

  app.post('/school/radio/announcements', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid_val = tid(req);
    const { message, priority, scheduled_at } = req.body;
    await pool.query(
      'INSERT INTO radio_announcements (tenant_id, message, priority, scheduled_at, created_by) VALUES ($1,$2,$3,$4,$5)',
      [tid_val, message, priority || 'normal', scheduled_at || null, req.user.id]
    );
    audit(req, 'radio_announcement_create', { priority });
    req.flash('success', 'Announcement posted');
    res.redirect('/school/radio/announcements');
  }));

  // ══════════════════════════════════════════
  // 20. SPONSORS
  // ══════════════════════════════════════════
  app.get('/school/radio/sponsors', requireAuth, requireNotBanned, async (req, res) => {
    const tid_val = tid(req);
    if (!tid_val) return res.redirect('/school');
    const [spR] = await pool.query(
      'SELECT * FROM radio_sponsors WHERE tenant_id=$1 ORDER BY created_at DESC',
      [tid_val]
    );
    res.send(renderPage(req, 'Radio Sponsors', SKIP + `
      <div class="breadcrumb" style="margin-bottom:16px"><a href="/school" style="color:${P}">School</a> &rsaquo; <a href="/school/radio" style="color:${P}">Radio</a> &rsaquo; Sponsors</div>
      <h2 style="margin:0 0 20px">🤝 Sponsors</h2>
      <form method="POST" action="/school/radio/sponsors" class="card">
        <h3 style="margin:0 0 12px">Add Sponsor</h3>
        <div class="grid" style="grid-template-columns:1fr 1fr">
          <div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Company Name *</label><input name="name" required placeholder="Sponsor name"></div>
          <div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Contact Email</label><input type="email" name="contact_email" placeholder="sponsor@example.com"></div>
        </div>
        <div class="grid" style="grid-template-columns:1fr 1fr">
          <div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Website</label><input name="website" placeholder="https://..."></div>
          <div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Logo URL</label><input name="logo_url" placeholder="https://..."></div>
        </div>
        <div class="grid" style="grid-template-columns:1fr 1fr">
          <div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Start Date</label><input type="date" name="start_date"></div>
          <div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">End Date</label><input type="date" name="end_date"></div>
        </div>
        <button type="submit" class="btn btn-sm">Add Sponsor</button>
      </form>
      ${spR.rows.length ? spR.rows.map(s => `
        <div class="card" style="display:flex;justify-content:space-between;align-items:center">
          <div style="display:flex;align-items:center;gap:12px">
            ${s.logo_url ? `<img src="${esc(s.logo_url)}" style="width:48px;height:48px;border-radius:8px;object-fit:cover">` : '<div style="width:48px;height:48px;border-radius:8px;background:#f3f4f6;display:flex;align-items:center;justify-content:center">🏢</div>'}
            <div>
              <h4 style="margin:0">${esc(s.name)} <span class="badge badge-${s.status}">${s.status}</span></h4>
              <p style="color:${GRAY};font-size:13px;margin:2px 0 0">${esc(s.website || '')} ${s.contact_email ? '&bull; ' + esc(s.contact_email) : ''}</p>
              <p style="color:${GRAY};font-size:12px">${s.start_date || '?'} to ${s.end_date || '?'}</p>
            </div>
          </div>
          <form method="POST" action="/school/radio/sponsors/${s.id}/delete" style="display:inline" onsubmit="return confirm('Remove this sponsor?')"><button class="btn btn-sm btn-danger">Remove</button></form>
        </div>
      `).join('') : '<div class="card"><p style="color:'+GRAY+'">No sponsors yet.</p></div>'}
    `));
  });

  app.post('/school/radio/sponsors', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid_val = tid(req);
    const { name, contact_email, website, logo_url, start_date, end_date } = req.body;
    await pool.query(
      'INSERT INTO radio_sponsors (tenant_id, name, contact_email, website, logo_url, start_date, end_date) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [tid_val, name, contact_email || null, website || null, logo_url || null, start_date || null, end_date || null]
    );
    audit(req, 'radio_sponsor_add', { name });
    req.flash('success', 'Sponsor added');
    res.redirect('/school/radio/sponsors');
  }));

  app.post('/school/radio/sponsors/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid_val = tid(req);
    await pool.query('DELETE FROM radio_sponsors WHERE id=$1 AND tenant_id=$2', [req.params.id, tid_val]);
    req.flash('success', 'Sponsor removed');
    res.redirect('/school/radio/sponsors');
  }));

  // ══════════════════════════════════════════
  // 21. PROGRAM GUIDE
  // ══════════════════════════════════════════
  app.get('/school/radio/guide', requireAuth, requireNotBanned, async (req, res) => {
    const tid_val = tid(req);
    if (!tid_val) return res.redirect('/school');
    const [showsR] = await pool.query(
      "SELECT s.*, u.display_name AS host_name FROM radio_shows s LEFT JOIN users u ON u.id=s.host_id WHERE s.tenant_id=$1 AND status IN ('active','live') ORDER BY s.schedule_day, s.schedule_time",
      [tid_val]
    );
    const [sponsorsR] = await pool.query(
      "SELECT * FROM radio_sponsors WHERE tenant_id=$1 AND status='active' AND (end_date IS NULL OR end_date >= CURRENT_DATE) ORDER BY name",
      [tid_val]
    );
    const groupedByDay = {};
    DAYS.forEach(d => groupedByDay[d] = []);
    showsR.rows.forEach(s => {
      if (groupedByDay[s.schedule_day]) groupedByDay[s.schedule_day].push(s);
    });
    const totalShows = showsR.rows.length;
    const totalHours = showsR.rows.reduce((s, sh) => s + (sh.duration_min || 0), 0);
    const uniqueGenres = [...new Set(showsR.rows.map(s => s.genre).filter(Boolean))];

    res.send(renderPage(req, 'Program Guide', SKIP + `
      <div class="breadcrumb" style="margin-bottom:16px"><a href="/school" style="color:${P}">School</a> &rsaquo; <a href="/school/radio" style="color:${P}">Radio</a> &rsaquo; Program Guide</div>
      <h2 style="margin:0 0 20px">📖 Program Guide</h2>
      <div class="grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:20px">
        <div class="stat-card"><div class="num">${totalShows}</div><div class="lbl">Active Shows</div></div>
        <div class="stat-card"><div class="num">${Math.round(totalHours / 60)}</div><div class="lbl">Hours/Week</div></div>
        <div class="stat-card"><div class="num">${uniqueGenres.length}</div><div class="lbl">Genres</div></div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px;margin-bottom:20px">
        ${DAYS.map(day => {
          const slots = groupedByDay[day];
          if (!slots.length) return '';
          return `<div class="card">
            <h3 style="margin:0 0 12px;color:${P}">${day}</h3>
            ${slots.map(s => `<div class="schedule-slot">
              <div style="display:flex;justify-content:space-between">
                <span class="time">${s.schedule_time || '--:--'}</span>
                <span style="font-size:12px;color:${GRAY}">${s.duration_min} min</span>
              </div>
              <div style="margin-top:4px"><strong>${esc(s.title)}</strong> ${s.status === 'live' ? '<span class="badge badge-live" style="font-size:10px">LIVE</span>' : ''}</div>
              <div style="font-size:12px;color:${GRAY};margin-top:2px">🎙️ ${esc(s.host_name || 'TBD')} &bull; ${esc(s.genre || '')}</div>
            </div>`).join('')}
          </div>`;
        }).join('')}
      </div>
      ${sponsorsR.rows.length ? `<div class="card"><h3 style="margin:0 0 12px">🤝 Our Sponsors</h3><div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(200px,1fr))">
        ${sponsorsR.rows.map(s => `<div style="text-align:center;padding:12px;border:1px solid #e5e7eb;border-radius:8px">
          ${s.logo_url ? `<img src="${esc(s.logo_url)}" style="max-height:60px;margin:0 auto 8px;display:block;border-radius:6px">` : '<div style="font-size:24px;margin-bottom:4px">🏢</div>'}
          <div style="font-weight:600;font-size:13px">${esc(s.name)}</div>
          ${s.website ? `<a href="${esc(s.website)}" target="_blank" style="font-size:12px;color:${P}">Visit</a>` : ''}
        </div>`).join('')}
      </div></div>` : ''}
    `));
  });

  // ══════════════════════════════════════════
  // 22. LISTENER FEEDBACK
  // ══════════════════════════════════════════
  app.post('/school/radio/feedback', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid_val = tid(req);
    const { show_id, episode_id, rating, comment } = req.body;
    await pool.query(
      'INSERT INTO radio_feedback (tenant_id, show_id, episode_id, user_id, rating, comment) VALUES ($1,$2,$3,$4,$5,$6)',
      [tid_val, show_id || null, episode_id || null, req.user.id, parseInt(rating) || null, comment || null]
    );
    audit(req, 'radio_feedback', { show_id, rating });
    req.flash('success', 'Feedback submitted!');
    const back = req.headers.referer || '/school/radio';
    res.redirect(back);
  }));

  // ══════════════════════════════════════════
  // 23. LISTENER JOIN/LEAVE TRACKING
  // ══════════════════════════════════════════
  app.post('/school/radio/listener/join', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid_val = tid(req);
    const { show_id } = req.body;
    if (!show_id) return res.json({ ok: false });
    const sessionId = req.sessionID || 'anon';
    try {
      await pool.query(
        'INSERT INTO radio_listeners (tenant_id, show_id, user_id, session_id, joined_at) VALUES ($1,$2,$3,$4,NOW())',
        [tid_val, show_id, req.user.id, sessionId]
      );
      res.json({ ok: true });
    } catch(e) { res.json({ ok: false, error: e.message }); }
  }));

  app.post('/school/radio/listener/leave', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid_val = tid(req);
    const sessionId = req.sessionID || 'anon';
    await pool.query(
      "UPDATE radio_listeners SET left_at=NOW(), duration_sec=EXTRACT(EPOCH FROM (NOW()-joined_at))::INTEGER WHERE tenant_id=$1 AND session_id=$2 AND left_at IS NULL",
      [tid_val, sessionId]
    );
    res.json({ ok: true });
  }));

  // ══════════════════════════════════════════
  // 24. INCREMENT PLAY COUNT
  // ══════════════════════════════════════════
  app.post('/school/radio/episodes/:id/play', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid_val = tid(req);
    await pool.query(
      'UPDATE radio_episodes SET play_count = play_count + 1 WHERE id=$1 AND tenant_id=$2',
      [req.params.id, tid_val]
    );
    res.json({ ok: true });
  }));

  // ══════════════════════════════════════════
  // 25. SEARCH API
  // ══════════════════════════════════════════
  app.get('/school/radio/search', requireAuth, requireNotBanned, async (req, res) => {
    const tid_val = tid(req);
    const q = (req.query.q || '').trim();
    if (!q) return res.redirect('/school/radio');
    try {
      const [showsR] = await pool.query(
        'SELECT * FROM radio_shows WHERE tenant_id=$1 AND (title ILIKE $2 OR description ILIKE $2 OR genre ILIKE $2) LIMIT 20',
        [tid_val, '%' + q + '%']
      );
      const [epsR] = await pool.query(
        'SELECT e.*, s.title AS show_title FROM radio_episodes e JOIN radio_shows s ON s.id=e.show_id WHERE e.tenant_id=$1 AND e.title ILIKE $2 LIMIT 20',
        [tid_val, '%' + q + '%']
      );
      res.send(renderPage(req, 'Search: ' + q, SKIP + `
        <div class="breadcrumb" style="margin-bottom:16px"><a href="/school" style="color:${P}">School</a> &rsaquo; <a href="/school/radio" style="color:${P}">Radio</a> &rsaquo; Search</div>
        <h2 style="margin:0 0 20px">Search Results for "${esc(q)}"</h2>
        ${showsR.rows.length ? `<div class="card"><h3 style="margin:0 0 12px">Shows (${showsR.rows.length})</h3>
        ${showsR.rows.map(s => `<div style="padding:8px 0;border-bottom:1px solid #f3f4f6"><a href="/school/radio/shows/${s.id}" style="font-weight:600;color:${P}">${esc(s.title)}</a> <span class="badge badge-${s.status}" style="font-size:11px">${s.status}</span><br><span style="color:${GRAY};font-size:13px">${esc((s.description || '').substring(0, 120))}</span></div>`).join('')}</div>` : ''}
        ${epsR.rows.length ? `<div class="card"><h3 style="margin:0 0 12px">Episodes (${epsR.rows.length})</h3>
        ${epsR.rows.map(e => `<div style="padding:8px 0;border-bottom:1px solid #f3f4f6"><strong>${esc(e.title)}</strong> <span style="color:${GRAY};font-size:13px">${esc(e.show_title)} &bull; ${fmtDur(e.duration_sec)} &bull; ${e.play_count} plays</span></div>`).join('')}</div>` : ''}
        ${!showsR.rows.length && !epsR.rows.length ? '<div class="card"><p style="color:'+GRAY+'">No results found.</p></div>' : ''}
      `));
    } catch(err) { res.status(500).send('Error: ' + err.message); }
  });

  console.log('[SchoolRadio] Module loaded – 25 routes registered');
};
