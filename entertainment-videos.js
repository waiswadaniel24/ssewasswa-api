// ============================================================
// === ENTERTAINMENT VIDEOS — Netflix-style Video Streaming ====
// === School Portal Platform (Node.js/Express) ================
// ============================================================

module.exports = function(app, pool, opts) {
  const esc = opts.esc;
  const renderPage = opts.renderPage;
  const ah = opts.ah || ((fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next));
  const requireAuth = opts.requireAuth || ((req, res, next) => req.session.user ? next() : res.redirect('/login'));
  const requireNotBanned = opts.requireNotBanned || ((req, res, next) => next());
  const trackRevenue = opts.trackRevenue;
  const awardPoints = opts.awardPoints;
  const queueEmail = opts.queueEmail;
  const wsBroadcast = opts.wsBroadcast;
  const uiT = opts.uiT;
  const audit = opts.audit || (() => {});

  const RED = '#dc2626', PINK = '#ec4899', DARK = '#0f0f23', GRAY = '#6b7280';
  const BASE = '/entertainment/videos';
  const CATEGORIES = ['Movies','Series','Documentary','Comedy','Drama','Tutorial','Music Video','Sports','News'];

  // ── HELPERS ──────────────────────────────────────────────────
  const fmtDate = d => d ? new Date(d).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) : '';
  const fmtDuration = s => { if(!s) return '0:00'; const h=Math.floor(s/3600); const m=Math.floor((s%3600)/60); const sec=Math.floor(s%60); return h>0 ? h+':'+String(m).padStart(2,'0')+':'+String(sec).padStart(2,'0') : m+':'+String(sec).padStart(2,'0'); };
  const starHtml = (rating) => { let s=''; for(let i=1;i<=5;i++) s+=`<span style="color:${i<=Math.round(rating||0)?'#f59e0b':'#d1d5db'};font-size:18px">${i<=Math.round(rating||0)?'★':'☆'}</span>`; return s; };
  const getUser = req => req.session.user;

  function embedVideo(url) {
    if (!url) return '<div style="background:#000;color:#999;padding:60px;text-align:center;border-radius:12px">No video URL provided</div>';
    const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]+)/);
    if (yt) return `<iframe src="https://www.youtube.com/embed/${yt[1]}" style="width:100%;aspect-ratio:16/9;border:none;border-radius:12px" allowfullscreen allow="autoplay; encrypted-media"></iframe>`;
    const vm = url.match(/vimeo\.com\/(\d+)/);
    if (vm) return `<iframe src="https://player.vimeo.com/video/${vm[1]}" style="width:100%;aspect-ratio:16/9;border:none;border-radius:12px" allowfullscreen></iframe>`;
    return `<video src="${esc(url)}" controls controlsList="nodownload" style="width:100%;border-radius:12px;background:#000"></video>`;
  }

  function videoCard(v, base) {
    const pct = v.progress_seconds && v.duration_seconds ? Math.min(100, Math.round(v.progress_seconds / v.duration_seconds * 100)) : 0;
    return `<div class="ev-card" onclick="location.href='${base||BASE}/${v.id}/watch'" style="cursor:pointer">
      <div class="ev-card-thumb">
        ${v.thumbnail_url ? `<img src="${esc(v.thumbnail_url)}" alt="${esc(v.title)}" loading="lazy">` : '<div class="ev-ph">🎬</div>'}
        ${v.duration ? `<div class="ev-dur">${fmtDuration(v.duration)}</div>` : ''}
        ${v.is_live ? '<div class="ev-live-badge">LIVE</div>' : ''}
        ${v.is_premium ? '<div class="ev-prem-badge">PREMIUM</div>' : ''}
        ${pct > 0 ? `<div class="ev-progress-bar"><div class="ev-progress-fill" style="width:${pct}%"></div></div>` : ''}
      </div>
      <div class="ev-card-body">
        <div class="ev-card-title">${esc(v.title)}</div>
        <div class="ev-card-meta">
          <span>👁 ${v.views||0}</span>
          ${v.rating>0 ? `<span>★ ${v.rating.toFixed(1)}</span>` : ''}
          ${v.category ? `<span class="ev-cat">${esc(v.category)}</span>` : ''}
        </div>
      </div>
    </div>`;
  }

  function evNav(active) {
    const links = [
      ['Dashboard', BASE], ['Search', BASE+'/search'], ['Trending', BASE+'/trending'],
      ['Categories', BASE+'/categories'], ['Playlists', BASE+'/playlists'],
      ['Continue Watching', BASE+'/continue'], ['Favorites', BASE+'/favorites'],
      ['History', BASE+'/history'], ['Live', BASE+'/live'], ['Monetize', BASE+'/monetize']
    ];
    let h = '<div class="ev-nav">';
    links.forEach(([l, u]) => { h += `<a href="${u}" class="${u===active?'ev-active':''}">${l}</a>`; });
    h += `<a href="${BASE}/upload" style="background:${RED};color:#fff">+ Upload</a></div>`;
    return h;
  }

  const EV_CSS = `<style>
    .ev-nav{display:flex;gap:6px;margin-bottom:20px;flex-wrap:wrap;align-items:center;padding:12px 16px;background:#f9fafb;border-radius:10px}
    .ev-nav a{padding:7px 14px;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;color:#475569;background:#fff;border:1px solid #e5e7eb;transition:.15s}
    .ev-nav a:hover{background:#f3f4f6}.ev-nav a.ev-active{background:${RED};color:#fff;border-color:${RED}}
    .ev-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:18px}
    .ev-card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;transition:.2s}
    .ev-card:hover{box-shadow:0 6px 24px rgba(0,0,0,.1);transform:translateY(-2px)}
    .ev-card-thumb{height:165px;background:linear-gradient(135deg,#1e1e3f,#2d2d5e);position:relative;overflow:hidden}
    .ev-card-thumb img{width:100%;height:100%;object-fit:cover}
    .ev-ph{display:flex;align-items:center;justify-content:center;height:100%;color:#ec4899;font-size:40px}
    .ev-dur{position:absolute;bottom:8px;right:8px;background:rgba(0,0,0,.8);color:#fff;padding:2px 7px;border-radius:4px;font-size:11px;font-weight:600}
    .ev-live-badge{position:absolute;top:8px;left:8px;background:${RED};color:#fff;padding:2px 10px;border-radius:10px;font-size:11px;font-weight:700;animation:evpulse 1.5s infinite}
    @keyframes evpulse{0%,100%{opacity:1}50%{opacity:.5}}
    .ev-prem-badge{position:absolute;top:8px;right:8px;background:#f59e0b;color:#fff;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700}
    .ev-progress-bar{position:absolute;bottom:0;left:0;right:0;height:3px;background:rgba(255,255,255,.3)}
    .ev-progress-fill{height:100%;background:#ec4899;border-radius:0 2px 0 0}
    .ev-card-body{padding:12px 14px}
    .ev-card-title{font-size:14px;font-weight:700;color:#1e293b;margin:0 0 6px;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    .ev-card-meta{font-size:12px;color:#94a3b8;display:flex;gap:10px;flex-wrap:wrap;align-items:center}
    .ev-cat{background:#fef2f2;color:${RED};padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600}
    .ev-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:14px;margin-bottom:20px}
    .ev-stat{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px;text-align:center}
    .ev-stat-val{font-size:26px;font-weight:800;color:#1e293b}
    .ev-stat-lbl{font-size:11px;color:#94a3b8;margin-top:4px;text-transform:uppercase;letter-spacing:.3px}
    .ev-form label{display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:4px}
    .ev-form input,.ev-form select,.ev-form textarea{width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;box-sizing:border-box;font-family:inherit}
    .ev-form input:focus,.ev-form select:focus,.ev-form textarea:focus{outline:none;border-color:${RED}}
    .ev-table{width:100%;border-collapse:collapse;font-size:13px}
    .ev-table th{padding:11px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase;background:#f8fafc}
    .ev-table td{padding:10px 14px;border-bottom:1px solid #f1f5f9}
    .ev-table tr:hover{background:#f8fafc}
    .ev-filter-bar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px;align-items:end}
    .ev-filter-bar label{display:block;font-size:11px;font-weight:600;color:#64748b;margin-bottom:3px}
    .ev-filter-bar input,.ev-filter-bar select{padding:7px 12px;border:2px solid #e2e8f0;border-radius:8px;font-size:13px}
    .ev-player-wrap{background:#0f0f23;border-radius:14px;overflow:hidden;position:relative}
    .ev-player-wrap iframe,.ev-player-wrap video{display:block;width:100%;aspect-ratio:16/9;border:none}
    .ev-comment{display:flex;gap:10px;padding:12px 0;border-bottom:1px solid #f3f4f6}
    .ev-comment-avatar{width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,${RED},${PINK});display:flex;align-items:center;justify-content:center;color:#fff;font-size:14px;font-weight:700;flex-shrink:0}
    .ev-reply{margin-left:46px;padding:10px 0;border-bottom:1px solid #f9fafb}
    .ev-hero{background:linear-gradient(135deg,${RED},${PINK});color:#fff;padding:40px 24px;border-radius:14px;text-align:center;margin-bottom:24px}
    .ev-trending-scroll{display:flex;gap:16px;overflow-x:auto;padding:8px 0 16px;scroll-snap-type:x mandatory}
    .ev-trending-scroll::-webkit-scrollbar{height:6px}.ev-trending-scroll::-webkit-scrollbar-thumb{background:#d1d5db;border-radius:3px}
    .ev-trending-scroll .ev-card{min-width:240px;max-width:240px;scroll-snap-align:start}
    .ev-share-bar{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}
    .ev-share-btn{padding:6px 14px;border-radius:8px;font-size:12px;font-weight:600;text-decoration:none;color:#fff;display:inline-block}
    .ev-qr{width:100px;height:100px;background:#fff;border:2px solid #e2e8f0;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:9px;color:#64748b;text-align:center;line-height:1.3;padding:6px}
    .ev-chat-box{height:300px;overflow-y:auto;padding:12px;background:#f8fafc;border-radius:10px;display:flex;flex-direction:column;gap:6px}
    .ev-chat-msg{padding:6px 10px;background:#fff;border-radius:8px;font-size:13px;border:1px solid #e2e8f0}
    .ev-cat-card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px;text-align:center;transition:.2s}
    .ev-cat-card:hover{box-shadow:0 4px 16px rgba(0,0,0,.08);transform:translateY(-1px)}
    @media(max-width:768px){.ev-grid{grid-template-columns:repeat(auto-fill,minmax(200px,1fr))}.ev-nav{gap:4px}.ev-nav a{padding:5px 10px;font-size:11px}}
  </style>`;

  function page(title, body) {
    return renderPage(title, EV_CSS + `<div style="max-width:1200px;margin:0 auto;padding:16px">${body}</div>`);
  }

  // ── MIGRATIONS ───────────────────────────────────────────────
  (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS ent_videos (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL, title TEXT NOT NULL, description TEXT,
        url TEXT, thumbnail_url TEXT, category TEXT, tags TEXT[], duration INTEGER DEFAULT 0,
        views INTEGER DEFAULT 0, likes INTEGER DEFAULT 0, dislikes INTEGER DEFAULT 0,
        rating NUMERIC(3,2) DEFAULT 0, rating_count INTEGER DEFAULT 0,
        is_premium BOOLEAN DEFAULT false, price NUMERIC(10,2) DEFAULT 0,
        is_live BOOLEAN DEFAULT false, live_started_at TIMESTAMPTZ, live_viewers INTEGER DEFAULT 0,
        uploader_email TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS ent_video_comments (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL, video_id INTEGER REFERENCES ent_videos(id) ON DELETE CASCADE,
        user_email TEXT NOT NULL, comment TEXT NOT NULL, parent_id INTEGER REFERENCES ent_video_comments(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS ent_video_playlists (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL, name TEXT NOT NULL, description TEXT,
        is_public BOOLEAN DEFAULT true, created_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS ent_video_playlist_items (
        id SERIAL PRIMARY KEY, playlist_id INTEGER REFERENCES ent_video_playlists(id) ON DELETE CASCADE,
        video_id INTEGER REFERENCES ent_videos(id) ON DELETE CASCADE, position INTEGER DEFAULT 0,
        UNIQUE(playlist_id, video_id)
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS ent_video_progress (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL, video_id INTEGER REFERENCES ent_videos(id) ON DELETE CASCADE,
        user_email TEXT NOT NULL, progress_seconds INTEGER DEFAULT 0, duration_seconds INTEGER DEFAULT 0,
        last_watched TIMESTAMPTZ DEFAULT NOW(), UNIQUE(tenant_id, video_id, user_email)
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS ent_video_favorites (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL, video_id INTEGER REFERENCES ent_videos(id) ON DELETE CASCADE,
        user_email TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(tenant_id, video_id, user_email)
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS ent_video_views (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL, video_id INTEGER REFERENCES ent_videos(id) ON DELETE CASCADE,
        user_email TEXT NOT NULL, viewed_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS ent_video_likes (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL, video_id INTEGER REFERENCES ent_videos(id) ON DELETE CASCADE,
        user_email TEXT NOT NULL, is_like BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(tenant_id, video_id, user_email)
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS ent_live_chat (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL, video_id INTEGER REFERENCES ent_videos(id) ON DELETE CASCADE,
        user_email TEXT NOT NULL, message TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      console.log('[EntertainmentVideos] All tables ready');
    } catch(e) { console.error('[EntertainmentVideos] Migration error:', e.message); }
  })();

  // ══════════════════════════════════════════════════════════════
  // 1. VIDEO DASHBOARD
  // ══════════════════════════════════════════════════════════════
  app.get(BASE, requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = getUser(req); const tid = user.tenant_id;
    const cat = req.query.cat || '';
    const q = (req.query.q || '').trim();
    let where = ['v.tenant_id=$1'], params = [tid], pi = 2;
    if (cat) { where.push(`v.category=$${pi++}`); params.push(cat); }
    if (q) { where.push(`(v.title ILIKE $${pi} OR v.description ILIKE $${pi})`); params.push(`%${q}%`); pi++; }
    const whereStr = where.join(' AND ');
    const [statsR, videosR] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS total, COALESCE(SUM(views),0)::int AS views, COALESCE(SUM(likes),0)::int AS likes, COUNT(*) FILTER (WHERE is_premium=true)::int AS premium FROM ent_videos WHERE tenant_id=$1', [tid]),
      pool.query(`SELECT v.* FROM ent_videos v WHERE ${whereStr} ORDER BY v.created_at DESC LIMIT 60`, params)
    ]);
    const stats = statsR.rows[0];
    const catTabs = ['All', ...CATEGORIES].map(c =>
      `<a href="${BASE}${c!=='All'?'?cat='+encodeURIComponent(c):''}" style="padding:6px 14px;border-radius:20px;font-size:12px;font-weight:600;text-decoration:none;${(!cat && c==='All') || cat===c ? 'background:'+RED+';color:#fff' : 'background:#f1f5f9;color:#475569'}">${esc(c)}</a>`
    ).join('');
    let html = evNav(BASE);
    html += `<div class="ev-hero"><h1 style="font-size:30px;margin:0">🎬 Entertainment Hub</h1><p style="opacity:.85;margin-top:8px">Watch, stream, and enjoy videos</p></div>`;
    html += '<div class="ev-stats">';
    html += `<div class="ev-stat"><div class="ev-stat-val">${stats.total}</div><div class="ev-stat-lbl">Videos</div></div>`;
    html += `<div class="ev-stat"><div class="ev-stat-val">${stats.views}</div><div class="ev-stat-lbl">Total Views</div></div>`;
    html += `<div class="ev-stat"><div class="ev-stat-val">${stats.likes}</div><div class="ev-stat-lbl">Total Likes</div></div>`;
    html += `<div class="ev-stat"><div class="ev-stat-val">${stats.premium}</div><div class="ev-stat-lbl">Premium</div></div>`;
    html += '</div>';
    html += '<form method="get" style="display:flex;gap:8px;margin-bottom:14px"><input name="q" value="'+esc(q)+'" placeholder="Search videos..." style="flex:1;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px"><button class="btn btn-green" type="submit">Search</button></form>';
    html += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:18px">' + catTabs + '</div>';
    html += videosR.rows.length ? '<div class="ev-grid">' + videosR.rows.map(v => videoCard(v)).join('') + '</div>'
      : '<div class="card" style="text-align:center;padding:48px"><p style="color:#94a3b8">No videos found</p></div>';
    res.send(page('Entertainment Videos', html));
  }));

  // ══════════════════════════════════════════════════════════════
  // 2. VIDEO UPLOAD
  // ══════════════════════════════════════════════════════════════
  app.get(BASE + '/upload', requireAuth, requireNotBanned, ah(async (req, res) => {
    let html = evNav(BASE + '/upload');
    html += '<div class="ev-hero"><h1 style="font-size:26px;margin:0">📹 Upload Video</h1><p style="opacity:.85;margin-top:6px">Share your content with the community</p></div>';
    html += '<div class="card" style="max-width:700px;margin:0 auto;padding:28px"><form method="post" action="'+BASE+'/upload" class="ev-form" style="display:flex;flex-direction:column;gap:16px">';
    html += '<div><label>Title *</label><input name="title" required placeholder="Video title"></div>';
    html += '<div><label>Description</label><textarea name="description" rows="3" placeholder="Describe your video..."></textarea></div>';
    html += '<div><label>Category</label><select name="category"><option value="">Select category</option>' + CATEGORIES.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('') + '</select></div>';
    html += '<div><label>Tags (comma-separated)</label><input name="tags" placeholder="funny, tutorial, highlights"></div>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px"><div><label>Thumbnail URL</label><input name="thumbnail_url" placeholder="https://..."></div><div><label>Duration (seconds)</label><input name="duration" type="number" min="0" value="0"></div></div>';
    html += '<div><label>Video URL *</label><input name="url" required placeholder="YouTube, Vimeo, or MP4 link"></div>';
    html += '<div style="display:flex;gap:16px;align-items:center"><label style="display:flex;align-items:center;gap:6px;font-size:13px;color:#374151"><input type="checkbox" name="is_premium" value="1"> Premium Content</label>';
    html += '<label style="display:flex;align-items:center;gap:6px;font-size:13px;color:#374151"><input type="checkbox" name="is_live" value="1"> Live Stream</label></div>';
    html += '<div style="display:flex;gap:10px"><button type="submit" class="btn btn-green" style="padding:12px 28px">Upload Video</button><a href="'+BASE+'" class="btn" style="padding:12px 20px;background:#f1f5f9;color:#475569">Cancel</a></div>';
    html += '</form></div>';
    res.send(page('Upload Video', html));
  }));

  app.post(BASE + '/upload', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = getUser(req); const tid = user.tenant_id;
    const { title, description, category, tags, thumbnail_url, url, duration, is_premium, is_live } = req.body;
    if (!title || !title.trim() || !url) return res.redirect(BASE + '/upload');
    const tagArr = tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [];
    await pool.query(
      `INSERT INTO ent_videos (tenant_id,title,description,url,thumbnail_url,category,tags,duration,is_premium,is_live,uploader_email) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [tid, title.trim(), description || null, url, thumbnail_url || null, category || null, tagArr.length ? tagArr : null, parseInt(duration) || 0, is_premium === '1', is_live === '1', user.email]
    );
    audit(req, 'video_upload', 'Uploaded: ' + title.trim());
    if (awardPoints) awardPoints(user.email, 10, 'video_upload');
    res.redirect(BASE);
  }));

  // ══════════════════════════════════════════════════════════════
  // 3. CUSTOM VIDEO PLAYER / WATCH PAGE
  // ══════════════════════════════════════════════════════════════
  app.get(BASE + '/:id/watch', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = getUser(req); const tid = user.tenant_id;
    const { rows: [v] } = await pool.query('SELECT * FROM ent_videos WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    if (!v) return res.status(404).send(page('Not Found', '<div class="card" style="text-align:center;padding:48px"><h2 style="color:'+RED+'">Video not found</h2><a href="'+BASE+'" class="btn" style="margin-top:12px">← Back</a></div>'));

    // Increment views
    await pool.query('UPDATE ent_videos SET views = views + 1 WHERE id=$1', [v.id]);
    await pool.query('INSERT INTO ent_video_views (tenant_id,video_id,user_email) VALUES ($1,$2,$3)', [tid, v.id, user.email]);

    // Load related data
    const [commentsR, relatedR, playlistsR, userLikeR, progressR] = await Promise.all([
      pool.query('SELECT c.*, u.name AS user_name FROM ent_video_comments c LEFT JOIN users u ON u.email=c.user_email WHERE c.video_id=$1 AND c.tenant_id=$2 AND c.parent_id IS NULL ORDER BY c.created_at DESC LIMIT 50', [v.id, tid]),
      pool.query('SELECT * FROM ent_videos WHERE tenant_id=$1 AND category=$2 AND id!=$3 ORDER BY views DESC LIMIT 8', [tid, v.category, v.id]),
      pool.query('SELECT * FROM ent_video_playlists WHERE tenant_id=$1 AND created_by=$2 ORDER BY name', [tid, user.email]),
      pool.query('SELECT is_like FROM ent_video_likes WHERE tenant_id=$1 AND video_id=$2 AND user_email=$3', [tid, v.id, user.email]),
      pool.query('SELECT progress_seconds, duration_seconds FROM ent_video_progress WHERE tenant_id=$1 AND video_id=$2 AND user_email=$3', [tid, v.id, user.email])
    ]);

    const comments = commentsR.rows;
    const related = relatedR.rows;
    const playlists = playlistsR.rows;
    const userLike = userLikeR.rows[0];
    const progress = progressR.rows[0];

    // Build comments with replies
    let commentsHtml = '';
    for (const c of comments) {
      const replies = (await pool.query('SELECT rc.*, u.name AS user_name FROM ent_video_comments rc LEFT JOIN users u ON u.email=rc.user_email WHERE rc.parent_id=$1 AND rc.tenant_id=$2 ORDER BY rc.created_at ASC', [c.id, tid])).rows;
      commentsHtml += `<div class="ev-comment">
        <div class="ev-comment-avatar">${(c.user_name || c.user_email || '?')[0].toUpperCase()}</div>
        <div style="flex:1">
          <div style="display:flex;justify-content:space-between"><strong style="font-size:13px">${esc(c.user_name || c.user_email || 'User')}</strong><span style="font-size:11px;color:#94a3b8">${fmtDate(c.created_at)}</span></div>
          <p style="font-size:13px;color:#475569;margin:4px 0">${esc(c.comment)}</p>
          <form method="post" action="${BASE}/${v.id}/comment/${c.id}/reply" style="display:flex;gap:6px;margin-top:6px">
            <input name="comment" placeholder="Reply..." required style="flex:1;padding:6px 10px;border:1px solid #e2e8f0;border-radius:6px;font-size:12px">
            <button type="submit" class="btn btn-sm" style="background:${GRAY};color:#fff;font-size:11px">Reply</button>
          </form>
          ${replies.map(r => `<div class="ev-reply">
            <div style="font-size:13px"><strong>${esc(r.user_name || r.user_email)}</strong> <span style="font-size:11px;color:#94a3b8">${fmtDate(r.created_at)}</span></div>
            <p style="font-size:12px;color:#475569;margin:2px 0">${esc(r.comment)}</p>
          </div>`).join('')}
        </div>
      </div>`;
    }

    const relatedHtml = related.map(r => videoCard(r, BASE)).join('');
    const playlistOpts = playlists.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
    const videoUrl = encodeURIComponent((req.protocol + '://' + req.get('host') + BASE + '/' + v.id + '/watch'));

    let html = `<a href="${BASE}" style="color:${GRAY};font-size:13px;text-decoration:none;display:inline-block;margin-bottom:14px">← Back to Videos</a>`;

    // Player
    html += `<div class="ev-player-wrap" id="playerWrap">${embedVideo(v.url)}</div>`;

    // Title & meta
    html += '<div style="padding:18px 0">';
    html += `<h1 style="font-size:22px;color:#1e293b;margin:0 0 8px">${esc(v.title)}</h1>`;
    html += '<div style="display:flex;gap:14px;align-items:center;font-size:13px;color:#64748b;flex-wrap:wrap;margin-bottom:10px">';
    html += `<span>👁 ${v.views}</span><span>👍 ${v.likes}</span><span>👎 ${v.dislikes}</span>`;
    html += starHtml(v.rating);
    html += `<span>${v.rating_count > 0 ? v.rating.toFixed(1) + '/5 ('+v.rating_count+')' : 'Not rated'}</span>`;
    if (v.duration) html += `<span>⏱ ${fmtDuration(v.duration)}</span>`;
    html += `<span>${fmtDate(v.created_at)}</span>`;
    if (v.category) html += `<span class="ev-cat">${esc(v.category)}</span>`;
    if (v.is_premium) html += '<span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700">PREMIUM</span>';
    html += '</div>';

    if (v.description) html += `<p style="font-size:14px;color:#475569;line-height:1.7;margin-bottom:12px">${esc(v.description)}</p>`;
    if (v.tags && v.tags.length) html += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">' + v.tags.map(t => `<span style="background:#f1f5f9;color:#475569;padding:3px 10px;border-radius:12px;font-size:12px">#${esc(t)}</span>`).join('') + '</div>';

    // Like/Dislike buttons
    html += '<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">';
    html += `<form method="post" action="${BASE}/${v.id}/like" style="display:inline"><button type="submit" class="btn btn-sm" style="background:${userLike && userLike.is_like ? '#dcfce7;color:#16a34a' : '#f1f5f9;color:#475569'}">👍 Like</button></form>`;
    html += `<form method="post" action="${BASE}/${v.id}/like?dislike=1" style="display:inline"><button type="submit" class="btn btn-sm" style="background:${userLike && !userLike.is_like ? '#fee2e2;color:#dc2626' : '#f1f5f9;color:#475569'}">👎 Dislike</button></form>`;
    html += `<form method="post" action="${BASE}/${v.id}/favorite" style="display:inline"><button type="submit" class="btn btn-sm" style="background:#f1f5f9;color:#475569">❤️ Favorite</button></form>`;
    html += `<form method="post" action="${BASE}/${v.id}/rate" style="display:inline-flex;align-items:center;gap:4px"><select name="rating" style="padding:4px 8px;border:1px solid #e2e8f0;border-radius:6px;font-size:13px">`;
    for (let i = 1; i <= 5; i++) html += `<option value="${i}">${i} Star${i>1?'s':''}</option>`;
    html += '</select><button type="submit" class="btn btn-sm" style="background:#f59e0b;color:#fff">Rate</button></form>';
    html += '</div>';

    // Add to playlist
    if (playlists.length) {
      html += `<form method="post" action="${BASE}/playlists/add-video" style="display:inline-flex;gap:6px;align-items:center;margin-bottom:12px">
        <select name="playlist_id" style="padding:6px 10px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px">${playlistOpts}</select>
        <input type="hidden" name="video_id" value="${v.id}">
        <button type="submit" class="btn btn-sm" style="background:#7c3aed;color:#fff">+ Playlist</button>
      </form>`;
    }

    // Share buttons
    html += '<div class="ev-share-bar">';
    html += `<a href="https://wa.me/?text=${videoUrl}" target="_blank" class="ev-share-btn" style="background:#25d366">WhatsApp</a>`;
    html += `<a href="https://twitter.com/intent/tweet?url=${videoUrl}&text=${encodeURIComponent(v.title)}" target="_blank" class="ev-share-btn" style="background:#1da1f2">Twitter</a>`;
    html += `<a href="https://www.facebook.com/sharer/sharer.php?u=${videoUrl}" target="_blank" class="ev-share-btn" style="background:#1877f2">Facebook</a>`;
    html += `<button onclick="navigator.clipboard.writeText(decodeURIComponent('${videoUrl}'));this.textContent='Copied!'" class="ev-share-btn" style="background:${GRAY}">Copy Link</button>`;
    html += '</div>';
    html += `<div style="display:flex;align-items:center;gap:10px;margin:8px 0 18px"><span style="font-size:12px;color:#94a3b8">QR Code:</span><div class="ev-qr">QR Code<br>${BASE}/${v.id}</div></div>`;
    html += '</div>';

    // Progress save script
    html += `<script>
    (function(){
      var lastSave = 0;
      function getVideoTime(){ var el = document.querySelector('#playerWrap video'); return el ? el.currentTime : 0; }
      function getVideoDuration(){ var el = document.querySelector('#playerWrap video'); return el ? el.duration : 0; }
      setInterval(function(){
        var t = getVideoTime();
        if(t > 0 && Date.now() - lastSave > 10000){
          lastSave = Date.now();
          fetch('${BASE}/${v.id}/progress',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({seconds:Math.floor(t),duration:Math.floor(getVideoDuration())})});
        }
      }, 5000);
    })();
    </script>`;

    // Comments section + Related sidebar
    html += '<div style="display:grid;grid-template-columns:1fr 320px;gap:24px">';
    html += '<div>';
    html += '<h2 style="font-size:18px;color:#1e293b;margin-bottom:14px">💬 Comments (' + comments.length + ')</h2>';
    html += `<form method="post" action="${BASE}/${v.id}/comment" style="margin-bottom:16px"><div style="display:flex;gap:8px">
      <input name="comment" placeholder="Add a comment..." required style="flex:1;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px">
      <button type="submit" class="btn btn-green">Post</button>
    </div></form>`;
    html += commentsHtml || '<p style="color:#94a3b8;text-align:center;padding:24px">No comments yet</p>';
    html += '</div>';
    html += '<div><h3 style="font-size:16px;color:#1e293b;margin-bottom:12px">📺 Related Videos</h3>';
    html += relatedHtml ? '<div style="display:flex;flex-direction:column;gap:14px">' + relatedHtml + '</div>' : '<p style="color:#94a3b8;font-size:13px">No related videos</p>';
    html += '</div></div>';
    res.send(page(v.title, html));
  }));

  // Save progress (POST, called via JS)
  app.post(BASE + '/:id/progress', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = getUser(req); const tid = user.tenant_id;
    const { seconds, duration } = req.body;
    await pool.query(`INSERT INTO ent_video_progress (tenant_id,video_id,user_email,progress_seconds,duration_seconds,last_watched)
      VALUES ($1,$2,$3,$4,$5,NOW()) ON CONFLICT (tenant_id,video_id,user_email) DO UPDATE SET progress_seconds=$4,duration_seconds=$5,last_watched=NOW()`,
      [tid, req.params.id, user.email, parseInt(seconds) || 0, parseInt(duration) || 0]);
    res.json({ ok: true });
  }));

  // ══════════════════════════════════════════════════════════════
  // 4. CONTINUE WATCHING
  // ══════════════════════════════════════════════════════════════
  app.get(BASE + '/continue', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = getUser(req); const tid = user.tenant_id;
    const { rows } = await pool.query(
      `SELECT v.*, p.progress_seconds, p.duration_seconds FROM ent_videos v
       JOIN ent_video_progress p ON p.video_id = v.id AND p.tenant_id = v.tenant_id
       WHERE p.tenant_id=$1 AND p.user_email=$2 AND p.progress_seconds > 0
       ORDER BY p.last_watched DESC LIMIT 30`, [tid, user.email]
    );
    let html = evNav(BASE + '/continue');
    html += '<div class="ev-hero"><h1 style="font-size:26px;margin:0">▶ Continue Watching</h1><p style="opacity:.85;margin-top:6px">Pick up where you left off</p></div>';
    if (rows.length) {
      html += '<div class="ev-grid">';
      rows.forEach(v => {
        const pct = v.duration_seconds ? Math.min(100, Math.round(v.progress_seconds / v.duration_seconds * 100)) : 0;
        const resumeUrl = BASE + '/' + v.id + '/watch?t=' + v.progress_seconds;
        html += `<div class="ev-card" style="cursor:pointer">
          <div class="ev-card-thumb" onclick="location.href='${resumeUrl}'">
            ${v.thumbnail_url ? `<img src="${esc(v.thumbnail_url)}" alt="${esc(v.title)}" loading="lazy">` : '<div class="ev-ph">🎬</div>'}
            ${v.duration ? `<div class="ev-dur">${fmtDuration(v.duration)}</div>` : ''}
            <div class="ev-progress-bar"><div class="ev-progress-fill" style="width:${pct}%"></div></div>
            <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:28px;color:#fff;text-shadow:0 2px 8px rgba(0,0,0,.5)">▶</div>
          </div>
          <div class="ev-card-body">
            <div class="ev-card-title">${esc(v.title)}</div>
            <div class="ev-card-meta"><span>${pct}% watched</span><span>⏱ ${fmtDuration(v.progress_seconds)} / ${fmtDuration(v.duration_seconds)}</span></div>
          </div>
        </div>`;
      });
      html += '</div>';
    } else {
      html += '<div class="card" style="text-align:center;padding:48px"><p style="color:#94a3b8">No videos in progress. Start watching something!</p><a href="'+BASE+'" class="btn btn-green" style="margin-top:12px">Browse Videos</a></div>';
    }
    res.send(page('Continue Watching', html));
  }));

  // ══════════════════════════════════════════════════════════════
  // 5. VIDEO PLAYLISTS
  // ══════════════════════════════════════════════════════════════
  app.get(BASE + '/playlists', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = getUser(req); const tid = user.tenant_id;
    const { rows } = await pool.query('SELECT p.*, (SELECT COUNT(*)::int FROM ent_video_playlist_items pi WHERE pi.playlist_id=p.id) AS video_count FROM ent_video_playlists p WHERE p.tenant_id=$1 AND p.created_by=$2 ORDER BY p.created_at DESC', [tid, user.email]);
    let html = evNav(BASE + '/playlists');
    html += '<div class="ev-hero"><h1 style="font-size:26px;margin:0">📋 My Playlists</h1><p style="opacity:.85;margin-top:6px">Organize your favorite videos</p></div>';
    html += `<form method="post" action="${BASE}/playlists/create" style="display:flex;gap:8px;margin-bottom:18px;max-width:500px">
      <input name="name" placeholder="New playlist name" required style="flex:1;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px">
      <input name="description" placeholder="Description (optional)" style="flex:1;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px">
      <button type="submit" class="btn btn-green">Create</button></form>`;
    if (rows.length) {
      html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px">';
      rows.forEach(p => {
        html += `<div class="card" style="border-left:4px solid ${RED}">
          <h3 style="margin:0 0 4px">${esc(p.name)}</h3>
          <p style="font-size:12px;color:#94a3b8;margin:0 0 8px">${esc(p.description || 'No description')} · ${p.video_count} video(s) · ${p.is_public ? '🌐 Public' : '🔒 Private'}</p>
          <div style="display:flex;gap:8px">
            <a href="${BASE}/playlists/${p.id}" class="btn btn-sm" style="background:${RED};color:#fff">View</a>
            <form method="post" action="${BASE}/playlists/${p.id}/toggle" style="display:inline"><button type="submit" class="btn btn-sm">${p.is_public ? '🔒 Make Private' : '🌐 Make Public'}</button></form>
          </div>
        </div>`;
      });
      html += '</div>';
    } else {
      html += '<div class="card" style="text-align:center;padding:48px"><p style="color:#94a3b8">No playlists yet. Create one above!</p></div>';
    }
    res.send(page('Playlists', html));
  }));

  app.post(BASE + '/playlists/create', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = getUser(req); const tid = user.tenant_id;
    const { name, description } = req.body;
    if (!name || !name.trim()) return res.redirect(BASE + '/playlists');
    await pool.query('INSERT INTO ent_video_playlists (tenant_id,name,description,created_by) VALUES ($1,$2,$3,$4)', [tid, name.trim(), description || null, user.email]);
    res.redirect(BASE + '/playlists');
  }));

  app.get(BASE + '/playlists/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = getUser(req); const tid = user.tenant_id;
    const { rows: [pl] } = await pool.query('SELECT * FROM ent_video_playlists WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    if (!pl) return res.status(404).send(page('Not Found', '<div class="card" style="text-align:center;padding:48px"><h2 style="color:'+RED+'">Playlist not found</h2></div>'));
    const { rows: items } = await pool.query(
      `SELECT v.*, pi.position FROM ent_videos v JOIN ent_video_playlist_items pi ON pi.video_id = v.id
       WHERE pi.playlist_id=$1 AND v.tenant_id=$2 ORDER BY pi.position ASC`, [pl.id, tid]
    );
    let html = evNav(BASE + '/playlists');
    html += `<a href="${BASE}/playlists" style="color:${GRAY};font-size:13px;text-decoration:none;display:inline-block;margin-bottom:14px">← All Playlists</a>`;
    html += `<div class="card" style="padding:24px;margin-bottom:20px;background:linear-gradient(135deg,${RED},${PINK});color:#fff">
      <h1 style="font-size:24px;margin:0 0 4px">${esc(pl.name)}</h1>
      <p style="opacity:.85;margin:0">${esc(pl.description || '')} · ${pl.is_public ? '🌐 Public' : '🔒 Private'} · ${items.length} video(s)</p>
    </div>`;
    if (items.length) {
      html += '<div class="ev-grid">' + items.map(v => videoCard(v, BASE)).join('') + '</div>';
    } else {
      html += '<div class="card" style="text-align:center;padding:36px"><p style="color:#94a3b8">This playlist is empty. Add videos from the watch page.</p></div>';
    }
    res.send(page(pl.name, html));
  }));

  // Add video to playlist
  app.post(BASE + '/playlists/add-video', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = getUser(req); const tid = user.tenant_id;
    const { playlist_id, video_id } = req.body;
    if (!playlist_id || !video_id) return res.redirect('back');
    const maxPos = (await pool.query('SELECT COALESCE(MAX(position),0)::int AS m FROM ent_video_playlist_items WHERE playlist_id=$1', [playlist_id])).rows[0].m;
    try {
      await pool.query('INSERT INTO ent_video_playlist_items (playlist_id,video_id,position) VALUES ($1,$2,$3)', [playlist_id, video_id, maxPos + 1]);
    } catch(e) { /* unique constraint - already in playlist */ }
    res.redirect('back');
  }));

  // Toggle public/private
  app.post(BASE + '/playlists/:id/toggle', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getUser(req).tenant_id;
    await pool.query('UPDATE ent_video_playlists SET is_public = NOT is_public WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    res.redirect(BASE + '/playlists');
  }));

  // Remove video from playlist
  app.post(BASE + '/playlists/:id/remove-video', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getUser(req).tenant_id;
    await pool.query('DELETE FROM ent_video_playlist_items WHERE playlist_id=$1 AND video_id=$2', [req.params.id, req.body.video_id]);
    res.redirect('back');
  }));

  // ══════════════════════════════════════════════════════════════
  // 6. VIDEO CATEGORIES & GENRES
  // ══════════════════════════════════════════════════════════════
  app.get(BASE + '/categories', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getUser(req).tenant_id;
    const { rows } = await pool.query(
      `SELECT category, COUNT(*)::int AS count, COALESCE(SUM(views),0)::int AS total_views, COALESCE(AVG(rating),0)::numeric(3,2) AS avg_rating
       FROM ent_videos WHERE tenant_id=$1 AND category IS NOT NULL GROUP BY category ORDER BY count DESC`, [tid]
    );
    const total = rows.reduce((s, r) => s + r.count, 0);
    let html = evNav(BASE + '/categories');
    html += '<div class="ev-hero"><h1 style="font-size:26px;margin:0">📂 Categories & Genres</h1><p style="opacity:.85;margin-top:6px">Explore content by category</p></div>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px">';
    const catColors = ['#dc2626','#ec4899','#7c3aed','#2563eb','#059669','#d97706','#64748b','#be185d','#0d9488'];
    rows.forEach((r, i) => {
      const col = catColors[i % catColors.length];
      const pct = total > 0 ? Math.round(r.count / total * 100) : 0;
      html += `<div class="ev-cat-card" style="border-top:3px solid ${col};cursor:pointer" onclick="location.href='${BASE}?cat=${encodeURIComponent(r.category)}'">
        <div style="font-size:20px;margin-bottom:4px">${r.category === 'Movies' ? '🎬' : r.category === 'Series' ? '📺' : r.category === 'Documentary' ? '📖' : r.category === 'Comedy' ? '😂' : r.category === 'Drama' ? '🎭' : r.category === 'Tutorial' ? '📚' : r.category === 'Music Video' ? '🎵' : r.category === 'Sports' ? '⚽' : '📰'}</div>
        <div style="font-size:16px;font-weight:700;color:#1e293b;margin-bottom:2px">${esc(r.category)}</div>
        <div style="font-size:24px;font-weight:800;color:${col}">${r.count}</div>
        <div style="font-size:11px;color:#94a3b8">${pct}% of all videos</div>
        <div style="font-size:11px;color:#94a3b8;margin-top:4px">👁 ${r.total_views} views · ★ ${r.avg_rating > 0 ? r.avg_rating.toFixed(1) : '-'}</div>
      </div>`;
    });
    html += '</div>';
    if (!rows.length) html += '<div class="card" style="text-align:center;padding:48px;margin-top:16px"><p style="color:#94a3b8">No categorized videos yet</p></div>';
    res.send(page('Categories', html));
  }));

  // ══════════════════════════════════════════════════════════════
  // 7. VIDEO SEARCH & DISCOVERY
  // ══════════════════════════════════════════════════════════════
  app.get(BASE + '/search', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getUser(req).tenant_id;
    const q = (req.query.q || '').trim();
    const cat = req.query.cat || '';
    const sort = req.query.sort || 'latest';
    const premium = req.query.premium || '';
    const minRating = parseFloat(req.query.minRating) || 0;

    let where = ['v.tenant_id=$1'], params = [tid], pi = 2;
    if (q) { where.push(`(v.title ILIKE $${pi} OR v.description ILIKE $${pi} OR v.tags::text ILIKE $${pi})`); params.push(`%${q}%`); pi++; }
    if (cat) { where.push(`v.category=$${pi++}`); params.push(cat); }
    if (premium === 'free') { where.push(`v.is_premium=false`); }
    else if (premium === 'premium') { where.push(`v.is_premium=true`); }
    if (minRating > 0) { where.push(`v.rating >= $${pi++}`); params.push(minRating); }

    const orderMap = { latest: 'v.created_at DESC', popular: 'v.views DESC', rated: 'v.rating DESC', title: 'v.title ASC' };
    const orderSql = orderMap[sort] || orderMap.latest;

    const { rows } = await pool.query(`SELECT v.* FROM ent_videos v WHERE ${where.join(' AND ')} ORDER BY ${orderSql} LIMIT 60`, params);

    let html = evNav(BASE + '/search');
    html += '<div class="ev-hero"><h1 style="font-size:26px;margin:0">🔍 Search & Discover</h1><p style="opacity:.85;margin-top:6px">Find your next favorite video</p></div>';

    html += '<form method="get" class="ev-form" style="margin-bottom:18px">';
    html += `<div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr 1fr;gap:12px;align-items:end">
      <div><label>Search</label><input name="q" value="${esc(q)}" placeholder="Keywords..."></div>
      <div><label>Category</label><select name="cat"><option value="">All</option>${CATEGORIES.map(c => `<option value="${esc(c)}" ${cat===c?'selected':''}>${esc(c)}</option>`).join('')}</select></div>
      <div><label>Sort By</label><select name="sort">
        <option value="latest" ${sort==='latest'?'selected':''}>Latest</option>
        <option value="popular" ${sort==='popular'?'selected':''}>Most Views</option>
        <option value="rated" ${sort==='rated'?'selected':''}>Top Rated</option>
        <option value="title" ${sort==='title'?'selected':''}>Title A-Z</option>
      </select></div>
      <div><label>Content</label><select name="premium">
        <option value="" ${premium===''?'selected':''}>All</option>
        <option value="free" ${premium==='free'?'selected':''}>Free</option>
        <option value="premium" ${premium==='premium'?'selected':''}>Premium</option>
      </select></div>
      <div><label>Min Rating</label><select name="minRating">
        <option value="0" ${minRating===0?'selected':''}>Any</option>
        ${[1,2,3,4].map(r => `<option value="${r}" ${minRating===r?'selected':''}>${r}+ ★</option>`).join('')}
      </select></div>
    </div>`;
    html += '<div style="display:flex;gap:10px;margin-top:12px"><button type="submit" class="btn btn-green">Search</button>';
    if (q || cat || premium || minRating) html += `<a href="${BASE}/search" class="btn" style="background:#f1f5f9;color:#475569">Clear Filters</a>`;
    html += '</div></form>';

    html += `<p style="font-size:13px;color:#94a3b8;margin-bottom:14px">${rows.length} result(s) found</p>`;
    html += rows.length ? '<div class="ev-grid">' + rows.map(v => videoCard(v)).join('') + '</div>'
      : '<div class="card" style="text-align:center;padding:48px"><p style="color:#94a3b8">No videos match your search. Try different filters.</p></div>';
    res.send(page('Search Videos', html));
  }));

  // ══════════════════════════════════════════════════════════════
  // 8. TRENDING VIDEOS
  // ══════════════════════════════════════════════════════════════
  app.get(BASE + '/trending', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getUser(req).tenant_id;
    const { rows } = await pool.query(
      `SELECT v.*, COALESCE(vc.recent_views, 0)::int AS recent_views
       FROM ent_videos v
       LEFT JOIN (SELECT video_id, COUNT(*)::int AS recent_views FROM ent_video_views WHERE viewed_at > NOW() - INTERVAL '7 days' GROUP BY video_id) vc ON vc.video_id = v.id
       WHERE v.tenant_id=$1 ORDER BY recent_views DESC, v.views DESC LIMIT 30`, [tid]
    );
    let html = evNav(BASE + '/trending');
    html += '<div class="ev-hero"><h1 style="font-size:26px;margin:0">🔥 Trending</h1><p style="opacity:.85;margin-top:6px">Most watched videos in the last 7 days</p></div>';
    if (rows.length) {
      html += '<div class="ev-trending-scroll">';
      rows.forEach((v, i) => {
        html += `<div class="ev-card" onclick="location.href='${BASE}/${v.id}/watch'" style="cursor:pointer">
          <div class="ev-card-thumb">
            ${v.thumbnail_url ? `<img src="${esc(v.thumbnail_url)}" alt="${esc(v.title)}" loading="lazy">` : '<div class="ev-ph">🎬</div>'}
            <div style="position:absolute;top:8px;left:8px;background:rgba(0,0,0,.7);color:#fff;padding:2px 8px;border-radius:6px;font-size:12px;font-weight:700">#${i+1}</div>
            ${v.duration ? `<div class="ev-dur">${fmtDuration(v.duration)}</div>` : ''}
          </div>
          <div class="ev-card-body">
            <div class="ev-card-title">${esc(v.title)}</div>
            <div class="ev-card-meta"><span>🔥 ${v.recent_views || 0} this week</span><span>👁 ${v.views}</span></div>
          </div>
        </div>`;
      });
      html += '</div>';
      html += '<h3 style="font-size:16px;margin:24px 0 14px">All Trending Videos</h3>';
      html += '<div class="ev-grid">' + rows.map(v => videoCard(v)).join('') + '</div>';
    } else {
      html += '<div class="card" style="text-align:center;padding:48px"><p style="color:#94a3b8">No trending videos this week</p></div>';
    }
    res.send(page('Trending Videos', html));
  }));

  // ══════════════════════════════════════════════════════════════
  // 9. VIDEO COMMENTS & REPLIES
  // ══════════════════════════════════════════════════════════════
  app.post(BASE + '/:id/comment', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = getUser(req); const tid = user.tenant_id;
    const comment = (req.body.comment || '').trim();
    if (!comment) return res.redirect('back');
    await pool.query('INSERT INTO ent_video_comments (tenant_id,video_id,user_email,comment) VALUES ($1,$2,$3,$4)',
      [tid, req.params.id, user.email, comment]);
    res.redirect(BASE + '/' + req.params.id + '/watch');
  }));

  app.post(BASE + '/:id/comment/:cid/reply', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = getUser(req); const tid = user.tenant_id;
    const comment = (req.body.comment || '').trim();
    if (!comment) return res.redirect('back');
    await pool.query('INSERT INTO ent_video_comments (tenant_id,video_id,user_email,comment,parent_id) VALUES ($1,$2,$3,$4,$5)',
      [tid, req.params.id, user.email, comment, req.params.cid]);
    res.redirect(BASE + '/' + req.params.id + '/watch');
  }));

  // ══════════════════════════════════════════════════════════════
  // 10. VIDEO LIKES/DISLIKES & RATINGS
  // ══════════════════════════════════════════════════════════════
  app.post(BASE + '/:id/like', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = getUser(req); const tid = user.tenant_id;
    const vid = req.params.id;
    const isDislike = req.query.dislike === '1';
    const isLike = !isDislike;
    const existing = (await pool.query('SELECT id, is_like FROM ent_video_likes WHERE tenant_id=$1 AND video_id=$2 AND user_email=$3', [tid, vid, user.email])).rows[0];
    if (existing) {
      if (existing.is_like === isLike) {
        // Remove vote
        await pool.query('DELETE FROM ent_video_likes WHERE id=$1', [existing.id]);
        await pool.query(isLike
          ? 'UPDATE ent_videos SET likes = GREATEST(likes - 1, 0) WHERE id=$1'
          : 'UPDATE ent_videos SET dislikes = GREATEST(dislikes - 1, 0) WHERE id=$1', [vid]);
      } else {
        // Switch vote
        await pool.query('UPDATE ent_video_likes SET is_like=$1 WHERE id=$2', [isLike, existing.id]);
        await pool.query('UPDATE ent_videos SET likes = likes + 1, dislikes = GREATEST(dislikes - 1, 0) WHERE id=$1', [vid]);
      }
    } else {
      await pool.query('INSERT INTO ent_video_likes (tenant_id,video_id,user_email,is_like) VALUES ($1,$2,$3,$4)', [tid, vid, user.email, isLike]);
      await pool.query(isLike
        ? 'UPDATE ent_videos SET likes = likes + 1 WHERE id=$1'
        : 'UPDATE ent_videos SET dislikes = dislikes + 1 WHERE id=$1', [vid]);
    }
    res.redirect(BASE + '/' + vid + '/watch');
  }));

  app.post(BASE + '/:id/rate', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = getUser(req); const tid = user.tenant_id;
    const vid = req.params.id;
    const rating = Math.min(5, Math.max(1, parseInt(req.body.rating) || 0));
    if (rating < 1) return res.redirect('back');
    const current = (await pool.query('SELECT rating, rating_count FROM ent_videos WHERE id=$1 AND tenant_id=$2', [vid, tid])).rows[0];
    if (!current) return res.redirect('back');
    const newCount = current.rating_count + 1;
    const newRating = ((current.rating * current.rating_count) + rating) / newCount;
    await pool.query('UPDATE ent_videos SET rating=$1, rating_count=$2, updated_at=NOW() WHERE id=$3 AND tenant_id=$4', [newRating, newCount, vid, tid]);
    res.redirect(BASE + '/' + vid + '/watch');
  }));

  // ══════════════════════════════════════════════════════════════
  // 11. VIDEO SHARING & EMBEDDING (share modal in watch page)
  // ══════════════════════════════════════════════════════════════
  // Share buttons are already embedded in the watch page (Feature 3).
  // QR code display is included as a simple div.

  // ══════════════════════════════════════════════════════════════
  // 12. VIDEO BOOKMARKS / FAVORITES
  // ══════════════════════════════════════════════════════════════
  app.post(BASE + '/:id/favorite', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = getUser(req); const tid = user.tenant_id;
    const existing = (await pool.query('SELECT id FROM ent_video_favorites WHERE tenant_id=$1 AND video_id=$2 AND user_email=$3', [tid, req.params.id, user.email])).rows[0];
    if (existing) {
      await pool.query('DELETE FROM ent_video_favorites WHERE id=$1', [existing.id]);
    } else {
      await pool.query('INSERT INTO ent_video_favorites (tenant_id,video_id,user_email) VALUES ($1,$2,$3)', [tid, req.params.id, user.email]);
      if (awardPoints) awardPoints(user.email, 2, 'video_favorite');
    }
    res.redirect(BASE + '/' + req.params.id + '/watch');
  }));

  app.get(BASE + '/favorites', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = getUser(req); const tid = user.tenant_id;
    const { rows } = await pool.query(
      `SELECT v.* FROM ent_videos v JOIN ent_video_favorites f ON f.video_id = v.id
       WHERE f.tenant_id=$1 AND f.user_email=$2 AND v.tenant_id=$1 ORDER BY f.created_at DESC`, [tid, user.email]
    );
    let html = evNav(BASE + '/favorites');
    html += '<div class="ev-hero"><h1 style="font-size:26px;margin:0">❤️ My Favorites</h1><p style="opacity:.85;margin-top:6px">Videos you saved for later</p></div>';
    if (rows.length) {
      html += '<div class="ev-grid">' + rows.map(v => videoCard(v)).join('') + '</div>';
    } else {
      html += '<div class="card" style="text-align:center;padding:48px"><p style="color:#94a3b8">No favorites yet. Click the heart icon on any video!</p><a href="'+BASE+'" class="btn btn-green" style="margin-top:12px">Browse Videos</a></div>';
    }
    res.send(page('Favorites', html));
  }));

  // ══════════════════════════════════════════════════════════════
  // 13. WATCH HISTORY
  // ══════════════════════════════════════════════════════════════
  app.get(BASE + '/history', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = getUser(req); const tid = user.tenant_id;
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (vw.video_id) v.*, vw.viewed_at
       FROM ent_video_views vw JOIN ent_videos v ON v.id = vw.video_id
       WHERE vw.tenant_id=$1 AND vw.user_email=$2 AND v.tenant_id=$1
       ORDER BY vw.video_id, vw.viewed_at DESC LIMIT 50`, [tid, user.email]
    );
    // Re-sort by viewed_at
    rows.sort((a, b) => new Date(b.viewed_at) - new Date(a.viewed_at));
    let html = evNav(BASE + '/history');
    html += '<div class="ev-hero"><h1 style="font-size:26px;margin:0">📜 Watch History</h1><p style="opacity:.85;margin-top:6px">Your viewing activity</p></div>';
    if (rows.length) {
      html += `<div style="margin-bottom:16px"><form method="post" action="${BASE}/history/clear" onsubmit="return confirm('Clear all watch history?')"><button type="submit" class="btn btn-red btn-sm">Clear All History</button></form></div>`;
      html += '<div class="card"><table class="ev-table"><thead><tr><th>Title</th><th>Category</th><th>Views</th><th>Rating</th><th>Watched</th><th>Actions</th></tr></thead><tbody>';
      rows.forEach(v => {
        html += `<tr>
          <td><a href="${BASE}/${v.id}/watch" style="color:${RED};font-weight:600;text-decoration:none">${esc(v.title)}</a></td>
          <td>${v.category ? `<span class="ev-cat">${esc(v.category)}</span>` : '-'}</td>
          <td>${v.views}</td>
          <td>${v.rating > 0 ? '★ ' + v.rating.toFixed(1) : '-'}</td>
          <td style="font-size:12px;color:#94a3b8">${fmtDate(v.viewed_at)}</td>
          <td><form method="post" action="${BASE}/history/delete" style="display:inline" onsubmit="return confirm('Remove from history?')"><input type="hidden" name="video_id" value="${v.id}"><button type="submit" class="btn btn-sm btn-red">Remove</button></form></td>
        </tr>`;
      });
      html += '</tbody></table></div>';
    } else {
      html += '<div class="card" style="text-align:center;padding:48px"><p style="color:#94a3b8">No watch history yet.</p><a href="'+BASE+'" class="btn btn-green" style="margin-top:12px">Browse Videos</a></div>';
    }
    res.send(page('Watch History', html));
  }));

  app.post(BASE + '/history/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = getUser(req); const tid = user.tenant_id;
    await pool.query('DELETE FROM ent_video_views WHERE tenant_id=$1 AND video_id=$2 AND user_email=$3', [tid, req.body.video_id, user.email]);
    res.redirect(BASE + '/history');
  }));

  app.post(BASE + '/history/clear', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = getUser(req); const tid = user.tenant_id;
    await pool.query('DELETE FROM ent_video_views WHERE tenant_id=$1 AND user_email=$2', [tid, user.email]);
    res.redirect(BASE + '/history');
  }));

  // ══════════════════════════════════════════════════════════════
  // 14. LIVE STREAMING
  // ══════════════════════════════════════════════════════════════
  app.get(BASE + '/live', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = getUser(req); const tid = user.tenant_id;
    const { rows: liveVideos } = await pool.query(
      "SELECT v.* FROM ent_videos v WHERE v.tenant_id=$1 AND v.is_live=true ORDER BY v.live_started_at DESC", [tid]
    );
    // End stale live streams (>24h old)
    await pool.query("UPDATE ent_videos SET is_live=false, live_viewers=0 WHERE is_live=true AND live_started_at < NOW() - INTERVAL '24 hours' AND tenant_id=$1", [tid]);

    let html = evNav(BASE + '/live');
    html += '<div class="ev-hero" style="background:linear-gradient(135deg,#ef4444,#f97316)"><h1 style="font-size:26px;margin:0">📡 Live Streams</h1><p style="opacity:.85;margin-top:6px">Watch and start live broadcasts</p></div>';

    html += `<form method="post" action="${BASE}/live/start" class="ev-form" style="max-width:600px;margin-bottom:24px;padding:20px;background:#fff;border-radius:12px;border:1px solid #e2e8f0">
      <h3 style="margin:0 0 14px">Start a Live Stream</h3>
      <div style="display:flex;flex-direction:column;gap:12px">
        <div><label>Stream Title *</label><input name="title" required placeholder="My Live Stream"></div>
        <div><label>Description</label><input name="description" placeholder="What's this about?"></div>
        <div><label>Stream URL *</label><input name="url" required placeholder="YouTube Live / Twitch URL"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div><label>Category</label><select name="category"><option value="">Select</option>${CATEGORIES.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select></div>
          <div><label>Thumbnail URL</label><input name="thumbnail_url" placeholder="https://..."></div>
        </div>
        <button type="submit" class="btn btn-red" style="padding:10px 24px">Go Live</button>
      </div></form>`;

    if (liveVideos.length) {
      html += '<h3 style="font-size:18px;margin-bottom:14px;color:#1e293b">🔴 Active Streams</h3>';
      html += '<div class="ev-grid">';
      liveVideos.forEach(v => {
        html += `<div class="ev-card" onclick="location.href='${BASE}/${v.id}/watch'" style="cursor:pointer;border:2px solid #ef4444">
          <div class="ev-card-thumb">
            ${v.thumbnail_url ? `<img src="${esc(v.thumbnail_url)}" alt="${esc(v.title)}" loading="lazy">` : '<div class="ev-ph">📡</div>'}
            <div class="ev-live-badge">LIVE</div>
            <div style="position:absolute;bottom:8px;left:8px;background:rgba(0,0,0,.7);color:#fff;padding:2px 8px;border-radius:6px;font-size:11px">👁 ${v.live_viewers||0} viewers</div>
          </div>
          <div class="ev-card-body">
            <div class="ev-card-title">${esc(v.title)}</div>
            <div class="ev-card-meta"><span>Started ${fmtDate(v.live_started_at)}</span></div>
          </div>
        </div>`;
      });
      html += '</div>';
    } else {
      html += '<div class="card" style="text-align:center;padding:36px"><p style="color:#94a3b8">No active live streams right now</p></div>';
    }

    // Live chat for active streams
    if (liveVideos.length > 0) {
      const activeVid = liveVideos[0];
      const { rows: chatMsgs } = await pool.query(
        'SELECT lc.*, u.name AS user_name FROM ent_live_chat lc LEFT JOIN users u ON u.email=lc.user_email WHERE lc.video_id=$1 AND lc.tenant_id=$2 ORDER BY lc.created_at DESC LIMIT 50',
        [activeVid.id, tid]
      );
      html += `<div class="card" style="padding:20px;margin-top:24px">
        <h3 style="margin:0 0 12px">💬 Live Chat — ${esc(activeVid.title)}</h3>
        <div class="ev-chat-box">`;
      chatMsgs.reverse().forEach(m => {
        html += `<div class="ev-chat-msg"><strong style="font-size:12px;color:${RED}">${esc(m.user_name || m.user_email)}</strong> <span style="font-size:11px;color:#94a3b8">${new Date(m.created_at).toLocaleTimeString()}</span><div style="margin-top:2px">${esc(m.message)}</div></div>`;
      });
      html += `</div>
        <form method="post" action="${BASE}/live/chat" style="display:flex;gap:8px;margin-top:10px">
          <input type="hidden" name="video_id" value="${activeVid.id}">
          <input name="message" placeholder="Send a message..." required style="flex:1;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px">
          <button type="submit" class="btn btn-green">Send</button>
        </form>
      </div>`;
    }

    res.send(page('Live Streams', html));
  }));

  app.post(BASE + '/live/start', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = getUser(req); const tid = user.tenant_id;
    const { title, description, url, category, thumbnail_url } = req.body;
    if (!title || !url) return res.redirect(BASE + '/live');
    await pool.query(
      `INSERT INTO ent_videos (tenant_id,title,description,url,thumbnail_url,category,is_live,live_started_at,live_viewers,uploader_email) VALUES ($1,$2,$3,$4,$5,$6,true,NOW(),0,$7)`,
      [tid, title.trim(), description || null, url, thumbnail_url || null, category || null, user.email]
    );
    audit(req, 'live_start', 'Started live: ' + title.trim());
    if (wsBroadcast) wsBroadcast(tid, { type: 'live_started', title: title.trim() });
    res.redirect(BASE + '/live');
  }));

  app.post(BASE + '/live/end', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = getUser(req); const tid = user.tenant_id;
    await pool.query('UPDATE ent_videos SET is_live=false, live_viewers=0 WHERE id=$1 AND tenant_id=$2 AND uploader_email=$3', [req.body.video_id, tid, user.email]);
    if (wsBroadcast) wsBroadcast(tid, { type: 'live_ended', video_id: req.body.video_id });
    res.redirect(BASE + '/live');
  }));

  app.post(BASE + '/live/chat', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = getUser(req); const tid = user.tenant_id;
    const { video_id, message } = req.body;
    if (!video_id || !message || !message.trim()) return res.redirect('back');
    await pool.query('INSERT INTO ent_live_chat (tenant_id,video_id,user_email,message) VALUES ($1,$2,$3,$4)',
      [tid, video_id, user.email, message.trim()]);
    if (wsBroadcast) wsBroadcast(tid, { type: 'live_chat', video_id, user: user.email, message: message.trim() });
    res.redirect('back');
  }));

  // ══════════════════════════════════════════════════════════════
  // 15. VIDEO MONETIZATION
  // ══════════════════════════════════════════════════════════════
  app.get(BASE + '/monetize', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getUser(req).tenant_id;
    const [premiumR, revenueR] = await Promise.all([
      pool.query('SELECT * FROM ent_videos WHERE tenant_id=$1 AND is_premium=true ORDER BY created_at DESC', [tid]),
      pool.query('SELECT COUNT(*)::int AS premium_count, COALESCE(SUM(price),0)::numeric(12,2) AS total_value, COALESCE(SUM(views),0)::int AS premium_views FROM ent_videos WHERE tenant_id=$1 AND is_premium=true', [tid])
    ]);
    const revStats = revenueR.rows[0];
    let html = evNav(BASE + '/monetize');
    html += '<div class="ev-hero" style="background:linear-gradient(135deg,#f59e0b,#d97706)"><h1 style="font-size:26px;margin:0">💰 Monetization</h1><p style="opacity:.85;margin-top:6px">Manage premium content and pricing</p></div>';

    html += '<div class="ev-stats">';
    html += `<div class="ev-stat"><div class="ev-stat-val" style="color:#f59e0b">${revStats.premium_count}</div><div class="ev-stat-lbl">Premium Videos</div></div>`;
    html += `<div class="ev-stat"><div class="ev-stat-val">$${revStats.total_value}</div><div class="ev-stat-lbl">Total Value</div></div>`;
    html += `<div class="ev-stat"><div class="ev-stat-val">${revStats.premium_views}</div><div class="ev-stat-lbl">Premium Views</div></div>`;
    html += '</div>';

    if (premiumR.rows.length) {
      html += '<div class="card"><table class="ev-table"><thead><tr><th>Title</th><th>Category</th><th>Price</th><th>Views</th><th>Rating</th><th>Actions</th></tr></thead><tbody>';
      premiumR.rows.forEach(v => {
        html += `<tr>
          <td><a href="${BASE}/${v.id}/watch" style="color:${RED};font-weight:600;text-decoration:none">${esc(v.title)}</a></td>
          <td>${v.category ? `<span class="ev-cat">${esc(v.category)}</span>` : '-'}</td>
          <td style="font-weight:700;color:#f59e0b">$${parseFloat(v.price||0).toFixed(2)}</td>
          <td>${v.views}</td>
          <td>${v.rating > 0 ? '★ '+v.rating.toFixed(1) : '-'}</td>
          <td>
            <form method="post" action="${BASE}/${v.id}/monetize" style="display:inline-flex;gap:6px">
              <input name="price" type="number" step="0.01" min="0" value="${parseFloat(v.price||0)}" style="width:80px;padding:4px 8px;border:1px solid #e2e8f0;border-radius:6px;font-size:13px">
              <button type="submit" class="btn btn-sm" style="background:#f59e0b;color:#fff">Update</button>
            </form>
          </td>
        </tr>`;
      });
      html += '</tbody></table></div>';
    } else {
      html += '<div class="card" style="text-align:center;padding:48px"><p style="color:#94a3b8">No premium videos set up yet. Go to any video to set pricing.</p></div>';
    }
    res.send(page('Monetization', html));
  }));

  app.post(BASE + '/:id/monetize', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = getUser(req); const tid = user.tenant_id;
    const vid = req.params.id;
    const price = parseFloat(req.body.price) || 0;
    const isPremium = price > 0;
    await pool.query('UPDATE ent_videos SET is_premium=$1, price=$2, updated_at=NOW() WHERE id=$3 AND tenant_id=$4', [isPremium, price, vid, tid]);
    audit(req, 'video_monetize', `Set video #${vid} premium=${isPremium} price=${price}`);
    if (trackRevenue && price > 0) trackRevenue(user.email, 'premium_video', vid, price);
    res.redirect(BASE + '/monetize');
  }));

  // ══════════════════════════════════════════════════════════════
  // DELETE VIDEO (Uploader only)
  // ══════════════════════════════════════════════════════════════
  app.post(BASE + '/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = getUser(req); const tid = user.tenant_id;
    const { rows: [v] } = await pool.query('SELECT * FROM ent_videos WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    if (!v) return res.status(404).send(page('Not Found', '<p>Video not found.</p>'));
    await pool.query('DELETE FROM ent_videos WHERE id=$1 AND tenant_id=$2 AND uploader_email=$3', [v.id, tid, user.email]);
    audit(req, 'video_delete', 'Deleted: ' + v.title);
    res.redirect(BASE);
  }));

  console.log('[EntertainmentVideos] Module loaded — 15+ features, 9 tables');
};
