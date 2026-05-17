// ============================================================
// === MEDIA ENGINE — Video Hosting, Podcasts, Live Streaming ==
// === Comfort Zone SaaS Platform (Node.js/Express) =============
// ============================================================

const VIDEO_CATEGORIES = ['Education','Sermon','Tutorial','Event','Announcement','Entertainment','Sports','Documentary'];
const PODCAST_CATEGORIES = ['Religion','Education','News','Business','Health','Technology','Lifestyle','Entertainment'];
const STREAM_PLATFORMS = ['youtube','facebook','twitch'];

// ── MIGRATIONS ───────────────────────────────────────────────
const MEDIA_MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS videos (
    id SERIAL PRIMARY KEY, tenant_id INTEGER, title TEXT, description TEXT,
    video_url TEXT, thumbnail_url TEXT, duration INTEGER, views INTEGER DEFAULT 0,
    likes INTEGER DEFAULT 0, category TEXT, tags TEXT[], is_published BOOLEAN DEFAULT false,
    featured BOOLEAN DEFAULT false, created_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS video_comments (
    id SERIAL PRIMARY KEY, video_id INTEGER REFERENCES videos(id) ON DELETE CASCADE,
    user_email TEXT, user_name TEXT, comment TEXT, likes INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS video_likes (
    id SERIAL PRIMARY KEY, video_id INTEGER REFERENCES videos(id) ON DELETE CASCADE,
    user_email TEXT, created_at TIMESTAMPTZ, UNIQUE(video_id, user_email)
  )`,
  `CREATE TABLE IF NOT EXISTS podcasts (
    id SERIAL PRIMARY KEY, tenant_id INTEGER, title TEXT, description TEXT,
    cover_url TEXT, author TEXT, category TEXT, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS podcast_episodes (
    id SERIAL PRIMARY KEY, podcast_id INTEGER REFERENCES podcasts(id) ON DELETE CASCADE,
    title TEXT, description TEXT, audio_url TEXT, duration INTEGER,
    episode_number INTEGER, season INTEGER DEFAULT 1, publish_date DATE,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS live_streams (
    id SERIAL PRIMARY KEY, tenant_id INTEGER, title TEXT, description TEXT,
    stream_url TEXT, thumbnail_url TEXT, platform TEXT DEFAULT 'youtube',
    is_live BOOLEAN DEFAULT false, scheduled_at TIMESTAMPTZ, started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ, viewer_count INTEGER DEFAULT 0, max_viewers INTEGER DEFAULT 0,
    created_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS stream_chat (
    id SERIAL PRIMARY KEY, stream_id INTEGER REFERENCES live_streams(id) ON DELETE CASCADE,
    user_email TEXT, user_name TEXT, message TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
  )`
];
MEDIA_MIGRATIONS.forEach(m => migrations.push(m));
['videos','video_comments','video_likes','podcasts','podcast_episodes','live_streams','stream_chat']
  .forEach(t => VALID_TABLES.add(t));

// ── HELPERS ──────────────────────────────────────────────────
const fmtDate = d => d ? new Date(d).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) : '—';
const fmtDateTime = d => d ? new Date(d).toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';
const fmtDuration = s => { if(!s) return '0:00'; const m=Math.floor(s/60); return m+':'+String(Math.floor(s%60)).padStart(2,'0'); };

function embedVideo(url) {
  if (!url) return '';
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]+)/);
  if (yt) return `<iframe src="https://www.youtube.com/embed/${yt[1]}" style="width:100%;aspect-ratio:16/9;border:none;border-radius:12px" allowfullscreen></iframe>`;
  const vm = url.match(/vimeo\.com\/(\d+)/);
  if (vm) return `<iframe src="https://player.vimeo.com/video/${vm[1]}" style="width:100%;aspect-ratio:16/9;border:none;border-radius:12px" allowfullscreen></iframe>`;
  return `<video src="${esc(url)}" controls style="width:100%;border-radius:12px;background:#000"></video>`;
}

function embedLive(url, platform) {
  if (!url) return '<div style="background:#1a1a2e;color:#f8fafc;padding:40px;text-align:center;border-radius:12px">Stream URL not available</div>';
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|live\/)|youtu\.be\/)([\w-]+)/);
  if (yt || platform === 'youtube') return `<iframe src="https://www.youtube.com/embed/${yt?yt[1]:''}" style="width:100%;aspect-ratio:16/9;border:none;border-radius:12px" allowfullscreen></iframe>`;
  if (platform === 'twitch') return `<iframe src="https://player.twitch.tv/?channel=${esc(url)}&parent=${process.env.DOMAIN||'localhost'}" style="width:100%;aspect-ratio:16/9;border:none;border-radius:12px" allowfullscreen></iframe>`;
  if (platform === 'facebook') return `<iframe src="https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(url)}" style="width:100%;aspect-ratio:16/9;border:none;border-radius:12px" allowfullscreen></iframe>`;
  return `<iframe src="${esc(url)}" style="width:100%;aspect-ratio:16/9;border:none;border-radius:12px" allowfullscreen></iframe>`;
}

const MEDIA_CSS = `<style>
  .me-nav{display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap;align-items:center}
  .me-nav a{padding:8px 18px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#475569;background:#f1f5f9;transition:.15s}
  .me-nav a:hover{background:#e2e8f0}.me-nav a.active{background:#7c3aed;color:#fff}
  .me-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:18px}
  .me-card{background:#fff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;transition:.2s;cursor:pointer}
  .me-card:hover{box-shadow:0 4px 20px rgba(0,0,0,.08);transform:translateY(-2px)}
  .me-card-thumb{height:190px;background:linear-gradient(135deg,#ede9fe,#ddd6fe);position:relative;overflow:hidden}
  .me-card-thumb img{width:100%;height:100%;object-fit:cover}
  .me-card-thumb .ph{display:flex;align-items:center;justify-content:center;height:100%;color:#a78bfa;font-size:40px}
  .me-card-badge{position:absolute;top:10px;left:10px;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;color:#fff}
  .me-card-live{position:absolute;top:10px;right:10px;background:#ef4444;color:#fff;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;animation:pulse 2s infinite}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
  .me-card-body{padding:16px}
  .me-card-title{font-size:16px;font-weight:700;color:#1e293b;margin:0 0 6px;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .me-card-meta{font-size:12px;color:#94a3b8;display:flex;gap:12px;flex-wrap:wrap}
  .me-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:14px;margin-bottom:20px}
  .me-stat{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:16px;text-align:center}
  .me-stat-val{font-size:28px;font-weight:800;color:#1e293b}
  .me-stat-lbl{font-size:11px;color:#94a3b8;margin-top:4px;text-transform:uppercase;letter-spacing:.3px}
  .me-filter{display:flex;gap:10px;margin-bottom:18px;flex-wrap:wrap;align-items:end}
  .me-filter label{display:block;font-size:12px;font-weight:600;color:#64748b;margin-bottom:4px}
  .me-filter input,.me-filter select{padding:8px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px;background:#fff}
  .me-filter input:focus,.me-filter select:focus{outline:none;border-color:#7c3aed}
  .me-form label{display:block;font-size:13px;font-weight:600;color:#475569;margin-bottom:4px}
  .me-form input,.me-form select,.me-form textarea{width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;box-sizing:border-box}
  .me-form input:focus,.me-form select:focus,.me-form textarea:focus{outline:none;border-color:#7c3aed}
  .me-table{width:100%;border-collapse:collapse;font-size:13px}
  .me-table th{padding:11px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase;background:#f8fafc}
  .me-table td{padding:10px 14px;border-bottom:1px solid #f1f5f9}
  .me-table tr:hover{background:#f8fafc}
  .me-chat{height:320px;overflow-y:auto;padding:12px;background:#f8fafc;border-radius:10px;display:flex;flex-direction:column;gap:6px}
  .me-chat-msg{padding:6px 10px;background:#fff;border-radius:8px;font-size:13px;border:1px solid #e2e8f0}
  .me-player-wrap{background:#0f0f23;border-radius:16px;overflow:hidden;position:relative}
  .me-player-wrap iframe,.me-player-wrap video{display:block;width:100%;aspect-ratio:16/9;border:none}
  .me-cat-pill{display:inline-block;padding:3px 12px;border-radius:20px;font-size:12px;font-weight:600;text-decoration:none;transition:.15s}
  .me-cat-pill:hover{opacity:.8}
  @media(max-width:768px){.me-grid{grid-template-columns:1fr}.me-nav{gap:4px}.me-nav a{padding:6px 12px;font-size:12px}}
</style>`;

// ── 1. VIDEO HOSTING ─────────────────────────────────────────

// GET /videos — Public video gallery
app.get('/videos', ah(async (req, res) => {
  const cat = req.query.category || '';
  const search = (req.query.search || '').trim();
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = 12, offset = (page - 1) * limit;
  let where = ["is_published=true"], params = [], pi = 1;
  if (cat) { where.push(`category=$${pi++}`); params.push(cat); }
  if (search) { where.push(`(title ILIKE $${pi} OR description ILIKE $${pi})`); params.push(`%${search}%`); pi++; }
  const total = (await pool.query(`SELECT COUNT(*)::int as cnt FROM videos WHERE ${where.join(' AND ')}`, params)).rows[0].cnt;
  const videos = (await pool.query(`SELECT * FROM videos WHERE ${where.join(' AND ')} ORDER BY featured DESC, created_at DESC LIMIT $${pi} OFFSET $${pi+1}`, [...params, limit, offset])).rows;
  const catPills = VIDEO_CATEGORIES.map(c =>
    `<a href="/videos?category=${esc(c)}" class="me-cat-pill" style="background:${cat===c?'#7c3aed':'#f1f5f9'};color:${cat===c?'#fff':'#475569'}">${esc(c)}</a>`
  ).join('');
  const cards = videos.map(v => `<div class="me-card" onclick="location.href='/videos/${esc(v.id)}'">
    <div class="me-card-thumb">${v.thumbnail_url ? `<img src="${esc(v.thumbnail_url)}" alt="${esc(v.title)}" loading="lazy">` : '<div class="ph">🎬</div>'}
      ${v.featured ? '<div class="me-card-badge" style="background:#f59e0b">⭐ Featured</div>' : ''}</div>
    <div class="me-card-body">
      <div class="me-card-title">${esc(v.title)}</div>
      <div class="me-card-meta">
        <span>👁 ${v.views||0}</span><span>❤️ ${v.likes||0}</span>
        ${v.category ? `<span style="background:#ede9fe;color:#7c3aed;padding:2px 8px;border-radius:12px;font-size:11px">${esc(v.category)}</span>` : ''}
      </div></div></div>`).join('');
  const totalPages = Math.ceil(total / limit);
  res.send(renderPage('Videos', MEDIA_CSS + `
    <div style="max-width:1200px;margin:0 auto">
      <div style="text-align:center;padding:40px 20px;background:linear-gradient(135deg,#7c3aed,#4f46e5);border-radius:16px;margin-bottom:24px;color:#fff">
        <h1 style="font-size:32px;margin:0">🎬 Video Library</h1>
        <p style="opacity:.85;margin-top:6px">Browse ${total} videos across ${VIDEO_CATEGORIES.length} categories</p>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">${catPills}</div>
      <div class="me-filter"><div><label>Search</label>
        <form method="GET" action="/videos" style="display:flex;gap:6px">
          <input type="text" name="search" value="${esc(search)}" placeholder="Search videos..." style="width:260px">
          <button type="submit" class="btn btn-sm" style="background:#7c3aed;color:#fff">Search</button>
          ${(cat||search) ? `<a href="/videos" class="btn btn-sm" style="background:#f1f5f9;color:#475569">Clear</a>` : ''}
        </form></div></div>
      ${videos.length ? `<div class="me-grid">${cards}</div>` : '<div class="card" style="text-align:center;padding:48px"><p style="color:#94a3b8;font-size:16px">No videos found</p></div>'}
      ${totalPages > 1 ? `<div style="display:flex;justify-content:center;gap:6px;margin-top:24px">
        ${page>1?`<a href="/videos?page=${page-1}&category=${esc(cat)}&search=${esc(search)}" class="btn btn-sm" style="background:#f1f5f9">← Prev</a>`:''}
        <span style="padding:8px 14px;font-size:13px;color:#64748b">Page ${page} of ${totalPages}</span>
        ${page<totalPages?`<a href="/videos?page=${page+1}&category=${esc(cat)}&search=${esc(search)}" class="btn btn-sm" style="background:#7c3aed;color:#fff">Next →</a>`:''}
      </div>` : ''}
    </div>`, null, true));
}));

// GET /videos/:id — Video watch page
app.get('/videos/:id', ah(async (req, res) => {
  const video = (await pool.query(`SELECT * FROM videos WHERE id=$1`, [req.params.id])).rows[0];
  if (!video) return res.status(404).send(renderPage('Not Found', '<div class="card" style="text-align:center;padding:48px"><h2 style="color:#dc2626">Video not found</h2><a href="/videos" class="btn btn-sm" style="margin-top:12px">← Videos</a></div>', null, true));
  await pool.query(`UPDATE videos SET views = views + 1 WHERE id=$1`, [video.id]);
  const comments = (await pool.query(`SELECT * FROM video_comments WHERE video_id=$1 ORDER BY created_at DESC LIMIT 50`, [video.id])).rows;
  const userEmail = req.session?.user?.email;
  const userLiked = userEmail ? (await pool.query(`SELECT id FROM video_likes WHERE video_id=$1 AND user_email=$2`, [video.id, userEmail])).rows[0] : null;
  const related = (await pool.query(`SELECT * FROM videos WHERE is_published=true AND category=$1 AND id!=$2 ORDER BY created_at DESC LIMIT 6`, [video.category, video.id])).rows;
  const commentsHtml = comments.map(c => `<div style="display:flex;gap:10px;padding:12px 0;border-bottom:1px solid #f1f5f9">
    <div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#c4b5fd,#a78bfa);display:flex;align-items:center;justify-content:center;color:#fff;font-size:14px;font-weight:700;flex-shrink:0">${(c.user_name||'?')[0].toUpperCase()}</div>
    <div style="flex:1"><div style="display:flex;justify-content:space-between"><strong style="font-size:13px">${esc(c.user_name||'Anonymous')}</strong><span style="font-size:11px;color:#94a3b8">${fmtDate(c.created_at)}</span></div>
    <p style="font-size:13px;color:#475569;margin:4px 0 0;line-height:1.5">${esc(c.comment)}</p></div></div>`).join('');
  const relatedHtml = related.map(r => `<div class="me-card" onclick="location.href='/videos/${esc(r.id)}'" style="cursor:pointer">
    <div class="me-card-thumb" style="height:120px">${r.thumbnail_url?`<img src="${esc(r.thumbnail_url)}" loading="lazy">`:'<div class="ph">🎬</div>'}</div>
    <div class="me-card-body"><div class="me-card-title" style="font-size:14px">${esc(r.title)}</div>
    <div class="me-card-meta"><span>👁 ${r.views||0}</span></div></div></div>`).join('');
  res.send(renderPage(video.title, MEDIA_CSS + `
    <div style="max-width:1100px;margin:0 auto">
      <a href="/videos" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Video Library</a>
      <div class="me-player-wrap">${embedVideo(video.video_url)}</div>
      <div style="padding:20px 0">
        <h1 style="font-size:24px;color:#1e293b;margin:0 0 8px">${esc(video.title)}</h1>
        <div style="display:flex;gap:16px;align-items:center;font-size:13px;color:#64748b;flex-wrap:wrap;margin-bottom:12px">
          <span>👁 ${video.views} views</span><span>❤️ ${video.likes} likes</span>
          ${video.category?`<span style="background:#ede9fe;color:#7c3aed;padding:3px 10px;border-radius:12px;font-size:12px">${esc(video.category)}</span>`:''}
          ${video.duration?`<span>⏱ ${fmtDuration(video.duration)}</span>`:''}
          <span style="margin-left:auto">📅 ${fmtDate(video.created_at)}</span>
        </div>
        ${video.description ? `<p style="font-size:14px;color:#475569;line-height:1.7;margin-bottom:16px">${esc(video.description)}</p>` : ''}
        <div style="display:flex;gap:10px;margin-bottom:24px">
          ${userEmail ? `<form method="POST" action="/api/videos/${video.id}/like"><button class="btn btn-sm" style="background:${userLiked?'#fde68a;color:#92400e':'#f1f5f9;color:#475569'}">${userLiked?'💖 Liked':'🤍 Like'}</button></form>` : ''}
          ${(video.tags||[]).map(t => `<span style="background:#f1f5f9;color:#64748b;padding:3px 10px;border-radius:12px;font-size:12px">#${esc(t)}</span>`).join('')}
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 340px;gap:24px">
        <div>
          <h2 style="font-size:18px;color:#1e293b;margin-bottom:14px">💬 Comments (${comments.length})</h2>
          ${userEmail ? `<div class="card" style="padding:16px;margin-bottom:16px">
            <form method="POST" action="/api/videos/${video.id}/comment" style="display:flex;gap:8px">
              <input type="text" name="comment" placeholder="Add a comment..." required style="flex:1;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px">
              <button type="submit" class="btn btn-sm" style="background:#7c3aed;color:#fff">Post</button>
            </form></div>` : '<p class="muted" style="margin-bottom:12px"><a href="/login" style="color:#7c3aed">Log in</a> to comment</p>'}
          ${commentsHtml || '<p style="color:#94a3b8;text-align:center;padding:24px">No comments yet. Be the first!</p>'}
        </div>
        <div><h3 style="font-size:15px;color:#1e293b;margin-bottom:12px">📎 Related Videos</h3>
          ${relatedHtml || '<p style="color:#94a3b8;font-size:13px">No related videos</p>'}</div>
      </div>
    </div>`, req.session?.user, true));
}));

// POST /api/videos — Create video (auth)
app.post('/api/videos', requireAuth, ah(async (req, res) => {
  const user = req.session.user;
  const { title, description, video_url, thumbnail_url, duration, category, tags, is_published, featured } = req.body;
  if (!title || !title.trim()) return res.json({ success: false, error: 'Title required' });
  const tagArr = tags ? (typeof tags === 'string' ? tags.split(',').map(t=>t.trim()).filter(Boolean) : tags) : null;
  const result = await pool.query(
    `INSERT INTO videos (tenant_id,title,description,video_url,thumbnail_url,duration,category,tags,is_published,featured,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [user.tenant_id, title.trim(), description||null, video_url||null, thumbnail_url||null, parseInt(duration)||0, category||null, tagArr, is_published==='on', featured==='on', user.email]
  );
  res.json({ success: true, id: result.rows[0].id });
}));

// PUT /api/videos/:id — Update video (auth)
app.put('/api/videos/:id', requireAuth, ah(async (req, res) => {
  const user = req.session.user;
  const { title, description, video_url, thumbnail_url, duration, category, tags, is_published, featured } = req.body;
  const video = (await pool.query(`SELECT * FROM videos WHERE id=$1 AND created_by=$2`, [req.params.id, user.email])).rows[0];
  if (!video) return res.json({ success: false, error: 'Not found' });
  const tagArr = tags ? (typeof tags === 'string' ? tags.split(',').map(t=>t.trim()).filter(Boolean) : tags) : video.tags;
  await pool.query(
    `UPDATE videos SET title=$1,description=$2,video_url=$3,thumbnail_url=$4,duration=$5,category=$6,tags=$7,is_published=$8,featured=$9 WHERE id=$10`,
    [title||video.title, description??video.description, video_url??video.video_url, thumbnail_url??video.thumbnail_url, parseInt(duration)||video.duration, category??video.category, tagArr, is_published==='on', featured==='on', req.params.id]
  );
  res.json({ success: true });
}));

// DELETE /api/videos/:id — Delete video (creator only)
app.delete('/api/videos/:id', requireAuth, ah(async (req, res) => {
  const video = (await pool.query(`SELECT * FROM videos WHERE id=$1 AND created_by=$2`, [req.params.id, req.session.user.email])).rows[0];
  if (!video) return res.json({ success: false, error: 'Not found' });
  await pool.query('DELETE FROM video_comments WHERE video_id=$1', [req.params.id]);
  await pool.query('DELETE FROM video_likes WHERE video_id=$1', [req.params.id]);
  await pool.query('DELETE FROM videos WHERE id=$1', [req.params.id]);
  res.json({ success: true });
}));

// POST /api/videos/:id/like — Like/unlike video
app.post('/api/videos/:id/like', requireAuth, ah(async (req, res) => {
  const vid = req.params.id, email = req.session.user.email;
  const existing = (await pool.query(`SELECT id FROM video_likes WHERE video_id=$1 AND user_email=$2`, [vid, email])).rows[0];
  if (existing) {
    await pool.query('DELETE FROM video_likes WHERE id=$1', [existing.id]);
    await pool.query('UPDATE videos SET likes = GREATEST(likes - 1, 0) WHERE id=$1', [vid]);
    res.json({ success: true, liked: false });
  } else {
    await pool.query('INSERT INTO video_likes (video_id, user_email) VALUES ($1, $2)', [vid, email]);
    await pool.query('UPDATE videos SET likes = likes + 1 WHERE id=$1', [vid]);
    res.json({ success: true, liked: true });
  }
}));

// POST /api/videos/:id/comment — Add comment
app.post('/api/videos/:id/comment', requireAuth, ah(async (req, res) => {
  const user = req.session.user;
  if (!req.body.comment || !req.body.comment.trim()) return res.redirect('/videos/' + req.params.id);
  await pool.query(
    `INSERT INTO video_comments (video_id, user_email, user_name, comment) VALUES ($1, $2, $3, $4)`,
    [req.params.id, user.email, user.name || user.email, req.body.comment.trim()]
  );
  res.redirect('/videos/' + req.params.id);
}));

// GET /admin/videos/new — Create video form
app.get('/admin/videos/new', requireAuth, ah(async (req, res) => {
  const user = req.session.user;
  const catOpts = VIDEO_CATEGORIES.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  res.send(renderPage('New Video', MEDIA_CSS + `
    <div style="max-width:800px;margin:0 auto">
      <a href="/admin/videos" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Videos</a>
      <div class="card" style="padding:28px">
        <h2 style="margin:0 0 4px;color:#1e293b">🎬 Add New Video</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:24px">Supports YouTube, Vimeo URLs or direct video file URLs</p>
        <form method="POST" action="/api/videos" class="me-form" style="display:flex;flex-direction:column;gap:16px">
          <div><label>Video Title *</label><input type="text" name="title" required placeholder="Enter video title..."></div>
          <div><label>Description</label><textarea name="description" rows="3" placeholder="Video description..."></textarea></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div><label>Video URL *</label><input type="url" name="video_url" required placeholder="https://youtube.com/watch?v=..."></div>
            <div><label>Thumbnail URL</label><input type="url" name="thumbnail_url" placeholder="https://..."></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px">
            <div><label>Category</label><select name="category"><option value="">— Select —</option>${catOpts}</select></div>
            <div><label>Duration (seconds)</label><input type="number" name="duration" value="0" min="0"></div>
            <div><label>Tags (comma-sep)</label><input type="text" name="tags" placeholder="education, tutorial"></div>
          </div>
          <div style="display:flex;gap:16px;align-items:center">
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:#475569"><input type="checkbox" name="is_published" checked> Publish immediately</label>
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:#475569"><input type="checkbox" name="featured"> ⭐ Featured</label>
          </div>
          <div style="display:flex;gap:10px">
            <button type="submit" class="btn" style="background:#7c3aed;color:#fff;padding:12px 28px">🎬 Create Video</button>
            <a href="/admin/videos" class="btn btn-sm" style="padding:12px 20px;background:#f1f5f9;color:#475569">Cancel</a>
          </div>
        </form></div>
    </div>`, user, req));
}));

// GET /admin/videos — Admin video management
app.get('/admin/videos', requireAuth, ah(async (req, res) => {
  const user = req.session.user, tid = user.tenant_id;
  const stats = (await pool.query(`SELECT COUNT(*)::int as total, COALESCE(SUM(views),0)::int as views, COALESCE(SUM(likes),0)::int as likes, COUNT(*) FILTER (WHERE is_published=true)::int as published FROM videos WHERE tenant_id=$1 OR created_by=$2`, [tid, user.email])).rows[0];
  const videos = (await pool.query(`SELECT * FROM videos WHERE tenant_id=$1 OR created_by=$2 ORDER BY created_at DESC LIMIT 100`, [tid, user.email])).rows;
  const rows = videos.map(v => `<tr>
    <td><strong style="color:#7c3aed">${esc(v.title||'Untitled')}</strong></td>
    <td>${v.is_published?'<span class="badge" style="background:#dcfce7;color:#16a34a">Published</span>':'<span class="badge" style="background:#fef3c7;color:#a16207">Draft</span>'}
      ${v.featured?' <span class="badge" style="background:#fde68a;color:#92400e">⭐</span>':''}</td>
    <td style="font-size:12px">${esc(v.category||'—')}</td>
    <td style="font-size:12px">${v.views||0}</td><td style="font-size:12px">${v.likes||0}</td>
    <td style="font-size:12px;color:#94a3b8">${fmtDate(v.created_at)}</td>
    <td><a href="/videos/${v.id}" target="_blank" class="btn btn-sm" style="background:#7c3aed;color:#fff">View</a>
      <form method="POST" action="/api/videos/${v.id}/delete" style="display:inline" onsubmit="if(!confirm('Delete?'))return false;this.method='DELETE'">
        <button class="btn btn-sm btn-red" type="submit">Del</button></form></td></tr>`).join('');
  res.send(renderPage('Admin Videos', MEDIA_CSS + `
    <div style="max-width:1200px;margin:0 auto">
      <div class="me-nav"><a href="/admin/videos" class="active">🎬 Videos</a><a href="/admin/podcasts">🎙 Podcasts</a><a href="/admin/live-streams">📡 Live</a><a href="/admin/media">📂 Media Library</a></div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">🎬 Video Management</h1></div>
        <a href="/admin/videos/new" class="btn" style="background:#7c3aed;color:#fff">+ Add Video</a>
      </div>
      <div class="me-stats">
        <div class="me-stat"><div class="me-stat-val">${stats.total}</div><div class="me-stat-lbl">Videos</div></div>
        <div class="me-stat"><div class="me-stat-val" style="color:#7c3aed">${stats.published}</div><div class="me-stat-lbl">Published</div></div>
        <div class="me-stat"><div class="me-stat-val" style="color:#2563eb">${stats.views}</div><div class="me-stat-lbl">Total Views</div></div>
        <div class="me-stat"><div class="me-stat-val" style="color:#ef4444">${stats.likes}</div><div class="me-stat-lbl">Total Likes</div></div>
      </div>
      <div class="card"><div style="overflow-x:auto"><table class="me-table">
        <thead><tr><th>Title</th><th>Status</th><th>Category</th><th>Views</th><th>Likes</th><th>Date</th><th>Actions</th></tr></thead>
        <tbody>${rows||'<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:30px">No videos yet</td></tr>'}</tbody>
      </table></div></div>
    </div>`, user, req));
}));

// ── 2. PODCAST MODULE ────────────────────────────────────────

// GET /podcasts — Public podcast directory
app.get('/podcasts', ah(async (req, res) => {
  const cat = req.query.category || '';
  let where = ['is_published=true'], params = [], pi = 1;
  if (cat) { where.push(`category=$${pi++}`); params.push(cat); }
  const podcasts = (await pool.query(`SELECT p.*, (SELECT COUNT(*)::int FROM podcast_episodes pe WHERE pe.podcast_id=p.id) as ep_count FROM podcasts p WHERE ${where.join(' AND ')} ORDER BY p.created_at DESC`, params)).rows;
  const cards = podcasts.map(p => `<div class="me-card" onclick="location.href='/podcasts/${esc(p.id)}'">
    <div class="me-card-thumb" style="height:200px;background:linear-gradient(135deg,#fce7f3,#fbcfe8)">
      ${p.cover_url ? `<img src="${esc(p.cover_url)}" alt="${esc(p.title)}" loading="lazy">` : '<div class="ph" style="color:#ec4899">🎙</div>'}
      <div class="me-card-badge" style="background:#ec4899">${p.ep_count||0} episodes</div></div>
    <div class="me-card-body">
      <div class="me-card-title">${esc(p.title)}</div>
      <div class="me-card-meta"><span>🎙 ${esc(p.author||'Unknown')}</span>${p.category?`<span style="background:#fce7f3;color:#ec4899;padding:2px 8px;border-radius:12px;font-size:11px">${esc(p.category)}</span>`:''}</div>
    </div></div>`).join('');
  const catPills = PODCAST_CATEGORIES.map(c =>
    `<a href="/podcasts?category=${esc(c)}" class="me-cat-pill" style="background:${cat===c?'#ec4899':'#f1f5f9'};color:${cat===c?'#fff':'#475569'}">${esc(c)}</a>`
  ).join('');
  res.send(renderPage('Podcasts', MEDIA_CSS + `
    <div style="max-width:1200px;margin:0 auto">
      <div style="text-align:center;padding:40px 20px;background:linear-gradient(135deg,#ec4899,#be185d);border-radius:16px;margin-bottom:24px;color:#fff">
        <h1 style="font-size:32px;margin:0">🎙 Podcasts</h1><p style="opacity:.85;margin-top:6px">Listen to ${podcasts.length} shows</p></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">${catPills}</div>
      ${podcasts.length ? `<div class="me-grid">${cards}</div>` : '<div class="card" style="text-align:center;padding:48px"><p style="color:#94a3b8">No podcasts yet</p></div>'}
    </div>`, null, true));
}));

// GET /podcasts/:id — Podcast detail
app.get('/podcasts/:id', ah(async (req, res) => {
  const podcast = (await pool.query(`SELECT * FROM podcasts WHERE id=$1`, [req.params.id])).rows[0];
  if (!podcast) return res.status(404).send(renderPage('Not Found', '<div class="card" style="text-align:center;padding:48px"><h2 style="color:#dc2626">Podcast not found</h2></div>', null, true));
  const episodes = (await pool.query(`SELECT * FROM podcast_episodes WHERE podcast_id=$1 ORDER BY season, episode_number, created_at DESC`, [podcast.id])).rows;
  const epList = episodes.map(ep => `<div class="card" style="padding:16px;margin-bottom:10px;display:flex;gap:14px;align-items:center">
    <div style="min-width:48px;height:48px;background:linear-gradient(135deg,#fce7f3,#fbcfe8);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:18px;color:#ec4899;font-weight:700">S${ep.season||1}E${ep.episode_number||'?'}</div>
    <div style="flex:1"><div style="font-weight:600;font-size:14px;color:#1e293b">${esc(ep.title)}</div>
      <div style="font-size:12px;color:#94a3b8;margin-top:2px">${ep.description ? esc(ep.description).substring(0,80) : 'No description'}${ep.duration ? ' · '+fmtDuration(ep.duration) : ''}</div></div>
    <a href="/podcasts/${podcast.id}/episodes/${ep.id}" class="btn btn-sm" style="background:#ec4899;color:#fff">▶ Play</a></div>`).join('');
  res.send(renderPage(podcast.title, MEDIA_CSS + `
    <div style="max-width:800px;margin:0 auto">
      <a href="/podcasts" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Podcasts</a>
      <div class="card" style="padding:24px;margin-bottom:20px;display:flex;gap:20px;align-items:center;flex-wrap:wrap">
        <div style="width:120px;height:120px;border-radius:16px;background:linear-gradient(135deg,#fce7f3,#fbcfe8);display:flex;align-items:center;justify-content:center;font-size:48px;flex-shrink:0">
          ${podcast.cover_url ? `<img src="${esc(podcast.cover_url)}" style="width:100%;height:100%;object-fit:cover;border-radius:16px">` : '🎙'}</div>
        <div style="flex:1"><h1 style="font-size:24px;color:#1e293b;margin:0 0 4px">${esc(podcast.title)}</h1>
          <p style="font-size:13px;color:#64748b">by ${esc(podcast.author||'Unknown')}</p>
          ${podcast.description ? `<p style="font-size:14px;color:#475569;margin-top:8px;line-height:1.6">${esc(podcast.description)}</p>` : ''}
          <a href="/api/rss/podcast/${podcast.id}" class="btn btn-sm" style="background:#f59e0b;color:#fff;margin-top:8px">📡 RSS Feed</a></div>
      </div>
      <h2 style="font-size:18px;color:#1e293b;margin-bottom:14px">📋 Episodes (${episodes.length})</h2>
      ${epList || '<div class="card" style="text-align:center;padding:36px"><p style="color:#94a3b8">No episodes yet</p></div>'}
    </div>`, null, true));
}));

// GET /podcasts/:podcastId/episodes/:episodeId — Episode player
app.get('/podcasts/:podcastId/episodes/:episodeId', ah(async (req, res) => {
  const episode = (await pool.query(`SELECT pe.*, p.title as podcast_title, p.cover_url, p.author FROM podcast_episodes pe JOIN podcasts p ON p.id=pe.podcast_id WHERE pe.id=$1`, [req.params.episodeId])).rows[0];
  if (!episode) return res.status(404).send(renderPage('Not Found', '<div class="card" style="text-align:center;padding:48px"><h2 style="color:#dc2626">Episode not found</h2></div>', null, true));
  const allEpisodes = (await pool.query(`SELECT id, title, episode_number, season FROM podcast_episodes WHERE podcast_id=$1 ORDER BY season, episode_number`, [episode.podcast_id])).rows;
  const epNav = allEpisodes.map(ep => `<a href="/podcasts/${episode.podcast_id}/episodes/${ep.id}" class="btn btn-sm" style="background:${ep.id==episode.id?'#ec4899':'#f1f5f9'};color:${ep.id==episode.id?'#fff':'#475569'};margin:2px">S${ep.season||1}E${ep.episode_number||'?'}</a>`).join('');
  res.send(renderPage(episode.title, MEDIA_CSS + `
    <div style="max-width:700px;margin:0 auto">
      <a href="/podcasts/${episode.podcast_id}" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← ${esc(episode.podcast_title)}</a>
      <div class="card" style="padding:24px;margin-bottom:20px;background:linear-gradient(135deg,#ec4899,#be185d);color:#fff">
        <div style="font-size:12px;opacity:.8">Season ${episode.season||1} · Episode ${episode.episode_number||'?'}</div>
        <h1 style="font-size:22px;margin:8px 0">${esc(episode.title)}</h1>
        ${episode.publish_date ? `<div style="font-size:13px;opacity:.8">${fmtDate(episode.publish_date)}</div>` : ''}
      </div>
      <div class="card" style="padding:20px;margin-bottom:20px">
        ${episode.audio_url ? `<audio controls style="width:100%;border-radius:10px;margin-bottom:12px"><source src="${esc(episode.audio_url)}">Your browser does not support audio.</audio>` : '<p style="color:#94a3b8;text-align:center">No audio available</p>'}
        ${episode.description ? `<p style="font-size:14px;color:#475569;line-height:1.7">${esc(episode.description)}</p>` : ''}
      </div>
      <h3 style="font-size:14px;color:#1e293b;margin-bottom:10px">All Episodes</h3>
      <div style="display:flex;flex-wrap:wrap;gap:4px">${epNav}</div>
    </div>`, null, true));
}));

// POST /api/podcasts — Create podcast (auth)
app.post('/api/podcasts', requireAuth, ah(async (req, res) => {
  const user = req.session.user;
  const { title, description, cover_url, author, category } = req.body;
  if (!title || !title.trim()) return res.json({ success: false, error: 'Title required' });
  const result = await pool.query(
    `INSERT INTO podcasts (tenant_id,title,description,cover_url,author,category) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [user.tenant_id, title.trim(), description||null, cover_url||null, author||user.name||user.email, category||null]
  );
  res.json({ success: true, id: result.rows[0].id });
}));

// POST /api/podcasts/:id/episodes — Add episode (auth)
app.post('/api/podcasts/:id/episodes', requireAuth, ah(async (req, res) => {
  const { title, description, audio_url, duration, episode_number, season, publish_date } = req.body;
  if (!title || !title.trim()) return res.json({ success: false, error: 'Title required' });
  await pool.query(
    `INSERT INTO podcast_episodes (podcast_id,title,description,audio_url,duration,episode_number,season,publish_date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [req.params.id, title.trim(), description||null, audio_url||null, parseInt(duration)||0, parseInt(episode_number)||1, parseInt(season)||1, publish_date||null]
  );
  res.json({ success: true });
}));

// GET /api/rss/podcast/:id — RSS feed
app.get('/api/rss/podcast/:id', ah(async (req, res) => {
  const podcast = (await pool.query(`SELECT * FROM podcasts WHERE id=$1`, [req.params.id])).rows[0];
  if (!podcast) return res.status(404).send('Podcast not found');
  const episodes = (await pool.query(`SELECT * FROM podcast_episodes WHERE podcast_id=$1 ORDER BY season, episode_number DESC`, [podcast.id])).rows;
  const host = req.protocol + '://' + req.get('host');
  const rssItems = episodes.map(ep => `
    <item><title><![CDATA[${ep.title}]]></title>
    <description><![CDATA[${ep.description || ''}]]></description>
    ${ep.audio_url ? `<enclosure url="${ep.audio_url}" length="${ep.duration||0}" type="audio/mpeg"/>` : ''}
    <pubDate>${ep.publish_date ? new Date(ep.publish_date).toUTCString() : new Date(ep.created_at).toUTCString()}</pubDate>
    <itunes:episode>${ep.episode_number||1}</itunes:episode>
    <itunes:season>${ep.season||1}</itunes:season>
    <itunes:duration>${fmtDuration(ep.duration||0)}</itunes:duration></item>`).join('');
  res.type('application/rss+xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" version="2.0">
<channel><title><![CDATA[${podcast.title}]]></title>
<link>${host}/podcasts/${podcast.id}</link>
<description><![CDATA[${podcast.description || ''}]]></description>
<itunes:author><![CDATA[${podcast.author || ''}]]></itunes:author>
<language>en-us</language>${rssItems}</channel></rss>`);
}));

// GET /admin/podcasts/new — Create podcast form
app.get('/admin/podcasts/new', requireAuth, ah(async (req, res) => {
  const user = req.session.user;
  const catOpts = PODCAST_CATEGORIES.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  res.send(renderPage('New Podcast', MEDIA_CSS + `
    <div style="max-width:800px;margin:0 auto">
      <a href="/admin/podcasts" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Podcasts</a>
      <div class="card" style="padding:28px">
        <h2 style="margin:0 0 4px;color:#1e293b">🎙 Create New Podcast</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:24px">Start a new podcast series</p>
        <form method="POST" action="/api/podcasts" class="me-form" style="display:flex;flex-direction:column;gap:16px">
          <div><label>Podcast Title *</label><input type="text" name="title" required placeholder="Your podcast name..."></div>
          <div><label>Description</label><textarea name="description" rows="3" placeholder="What is this podcast about?"></textarea></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div><label>Cover Image URL</label><input type="url" name="cover_url" placeholder="https://..."></div>
            <div><label>Category</label><select name="category"><option value="">— Select —</option>${catOpts}</select></div>
          </div>
          <div style="display:flex;gap:10px">
            <button type="submit" class="btn" style="background:#ec4899;color:#fff;padding:12px 28px">🎙 Create Podcast</button>
            <a href="/admin/podcasts" class="btn btn-sm" style="padding:12px 20px;background:#f1f5f9;color:#475569">Cancel</a>
          </div>
        </form></div>
    </div>`, user, req));
}));

// GET /admin/podcasts — Admin podcast management
app.get('/admin/podcasts', requireAuth, ah(async (req, res) => {
  const user = req.session.user;
  const podcasts = (await pool.query(`SELECT p.*, (SELECT COUNT(*)::int FROM podcast_episodes pe WHERE pe.podcast_id=p.id) as ep_count FROM podcasts p WHERE p.tenant_id=$1 OR p.author=$2 ORDER BY p.created_at DESC`, [user.tenant_id, user.email])).rows;
  const rows = podcasts.map(p => `<tr>
    <td><strong style="color:#ec4899">${esc(p.title)}</strong></td>
    <td>${p.is_published?'<span class="badge" style="background:#dcfce7;color:#16a34a">Published</span>':'<span class="badge" style="background:#fef3c7;color:#a16207">Draft</span>'}</td>
    <td style="font-size:12px">${esc(p.category||'—')}</td>
    <td style="font-size:12px">${p.ep_count||0} episodes</td>
    <td style="font-size:12px;color:#94a3b8">${fmtDate(p.created_at)}</td>
    <td><a href="/podcasts/${p.id}" target="_blank" class="btn btn-sm" style="background:#ec4899;color:#fff">View</a></td></tr>`).join('');
  res.send(renderPage('Admin Podcasts', MEDIA_CSS + `
    <div style="max-width:1200px;margin:0 auto">
      <div class="me-nav"><a href="/admin/videos">🎬 Videos</a><a href="/admin/podcasts" class="active">🎙 Podcasts</a><a href="/admin/live-streams">📡 Live</a><a href="/admin/media">📂 Media Library</a></div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <h1 style="font-size:24px;color:#1e293b;margin:0">🎙 Podcast Management</h1>
        <a href="/admin/podcasts/new" class="btn" style="background:#ec4899;color:#fff">+ New Podcast</a>
      </div>
      <div class="me-stats">
        <div class="me-stat"><div class="me-stat-val" style="color:#ec4899">${podcasts.length}</div><div class="me-stat-lbl">Podcasts</div></div>
        <div class="me-stat"><div class="me-stat-val">${podcasts.reduce((s,p)=>s+(p.ep_count||0),0)}</div><div class="me-stat-lbl">Total Episodes</div></div>
      </div>
      <div class="card"><div style="overflow-x:auto"><table class="me-table">
        <thead><tr><th>Title</th><th>Status</th><th>Category</th><th>Episodes</th><th>Date</th><th>Actions</th></tr></thead>
        <tbody>${rows||'<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:30px">No podcasts yet</td></tr>'}</tbody>
      </table></div></div>
    </div>`, user, req));
}));

// ── 3. LIVE STREAMING ────────────────────────────────────────

// GET /live — Public live streams listing
app.get('/live', ah(async (req, res) => {
  const liveStreams = (await pool.query(`SELECT * FROM live_streams WHERE is_live=true ORDER BY viewer_count DESC`)).rows;
  const scheduled = (await pool.query(`SELECT * FROM live_streams WHERE is_live=false AND scheduled_at > NOW() AND ended_at IS NULL ORDER BY scheduled_at ASC`)).rows;
  const pastStreams = (await pool.query(`SELECT * FROM live_streams WHERE is_live=false AND ended_at IS NOT NULL ORDER BY ended_at DESC LIMIT 8`)).rows;
  const liveCards = liveStreams.map(s => `<div class="me-card" onclick="location.href='/live/${esc(s.id)}'">
    <div class="me-card-thumb" style="background:linear-gradient(135deg,#dc2626,#991b1b)">
      ${s.thumbnail_url?`<img src="${esc(s.thumbnail_url)}" loading="lazy">`:'<div class="ph" style="color:#fecaca">📡</div>'}
      <div class="me-card-live">🔴 LIVE</div></div>
    <div class="me-card-body"><div class="me-card-title">${esc(s.title)}</div>
      <div class="me-card-meta"><span>👁 ${s.viewer_count||0}</span><span>📡 ${esc(s.platform)}</span></div></div></div>`).join('');
  const schedCards = scheduled.map(s => `<div class="card" style="padding:16px;margin-bottom:10px;display:flex;gap:14px;align-items:center;cursor:pointer" onclick="location.href='/live/${esc(s.id)}'">
    <div style="min-width:80px;text-align:center;padding:10px;background:#dbeafe;border-radius:12px">
      <div style="font-size:22px;font-weight:800;color:#2563eb">${s.scheduled_at ? new Date(s.scheduled_at).toLocaleDateString('en-GB',{day:'numeric'}) : '?'}</div>
      <div style="font-size:11px;color:#2563eb">${s.scheduled_at ? new Date(s.scheduled_at).toLocaleDateString('en-GB',{month:'short'}) : ''}</div></div>
    <div style="flex:1"><div style="font-weight:600;font-size:14px">${esc(s.title)}</div>
      <div style="font-size:12px;color:#94a3b8;margin-top:2px">${s.scheduled_at?fmtDateTime(s.scheduled_at):''} · ${esc(s.platform)}</div></div>
    <span class="badge" style="background:#dbeafe;color:#2563eb">Upcoming</span></div>`).join('');
  const pastCards = pastStreams.map(s => `<div class="me-card" onclick="location.href='/live/${esc(s.id)}'" style="opacity:.75">
    <div class="me-card-thumb" style="height:140px;background:linear-gradient(135deg,#1e293b,#334155)">
      ${s.thumbnail_url?`<img src="${esc(s.thumbnail_url)}" loading="lazy">`:'<div class="ph" style="color:#64748b">📡</div>'}
      <div class="me-card-badge" style="background:#475569">Ended</div></div>
    <div class="me-card-body"><div class="me-card-title" style="font-size:14px">${esc(s.title)}</div>
      <div class="me-card-meta"><span>👁 ${s.max_viewers||0} peak</span><span>📡 ${esc(s.platform)}</span></div></div></div>`).join('');
  res.send(renderPage('Live Streams', MEDIA_CSS + `
    <div style="max-width:1200px;margin:0 auto">
      <div style="text-align:center;padding:40px 20px;background:linear-gradient(135deg,#dc2626,#991b1b);border-radius:16px;margin-bottom:24px;color:#fff">
        <h1 style="font-size:32px;margin:0">📡 Live Streams</h1>
        <p style="opacity:.85;margin-top:6px">${liveStreams.length} live now · ${scheduled.length} upcoming</p></div>
      ${liveStreams.length ? `<h2 style="font-size:18px;color:#1e293b;margin-bottom:14px">🔴 Live Now</h2><div class="me-grid" style="margin-bottom:28px">${liveCards}</div>` : ''}
      ${scheduled.length ? `<h2 style="font-size:18px;color:#1e293b;margin-bottom:14px">📅 Upcoming</h2><div style="margin-bottom:28px">${schedCards}</div>` : ''}
      ${!liveStreams.length && !scheduled.length ? '<div class="card" style="text-align:center;padding:48px;margin-bottom:28px"><p style="color:#94a3b8;font-size:16px">No live streams right now</p></div>' : ''}
      ${pastStreams.length ? `<h2 style="font-size:18px;color:#1e293b;margin-bottom:14px">📦 Past Streams</h2><div class="me-grid">${pastCards}</div>` : ''}
    </div>`, null, true));
}));

// GET /live/:id — Live stream watch page
app.get('/live/:id', ah(async (req, res) => {
  const stream = (await pool.query(`SELECT * FROM live_streams WHERE id=$1`, [req.params.id])).rows[0];
  if (!stream) return res.status(404).send(renderPage('Not Found', '<div class="card" style="text-align:center;padding:48px"><h2 style="color:#dc2626">Stream not found</h2></div>', null, true));
  const messages = (await pool.query(`SELECT * FROM stream_chat WHERE stream_id=$1 ORDER BY created_at DESC LIMIT 50`, [stream.id])).rows;
  const chatHtml = messages.reverse().map(m => `<div class="me-chat-msg">
    <strong style="color:#7c3aed;font-size:12px">${esc(m.user_name||'Anonymous')}</strong>
    <span style="font-size:12px;color:#475569;margin-left:6px">${esc(m.message)}</span></div>`).join('');
  res.send(renderPage(stream.title, MEDIA_CSS + `
    <div style="max-width:1100px;margin:0 auto">
      <a href="/live" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Live Streams</a>
      <div style="display:flex;gap:10px;align-items:center;margin-bottom:12px">
        ${stream.is_live?'<span style="background:#ef4444;color:#fff;padding:4px 14px;border-radius:20px;font-size:13px;font-weight:700;animation:pulse 2s infinite">🔴 LIVE</span>':'<span class="badge" style="background:#f1f5f9;color:#64748b">Offline</span>'}
        <h1 style="font-size:22px;color:#1e293b;margin:0">${esc(stream.title)}</h1>
        <span style="margin-left:auto;font-size:13px;color:#64748b">👁 ${stream.viewer_count||0} viewers</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 340px;gap:20px">
        <div class="me-player-wrap">${embedLive(stream.stream_url, stream.platform)}</div>
        <div>
          <div class="card" style="padding:16px">
            <h3 style="font-size:15px;color:#1e293b;margin:0 0 12px">💬 Live Chat</h3>
            <div class="me-chat" id="chatBox">${chatHtml||'<p style="color:#94a3b8;text-align:center;font-size:13px">No messages yet</p>'}</div>
            <form method="POST" action="/api/live/${stream.id}/chat" style="display:flex;gap:6px;margin-top:10px">
              <input type="text" name="message" placeholder="Send a message..." required style="flex:1;padding:8px 12px;border:2px solid #e2e8f0;border-radius:8px;font-size:13px">
              <button type="submit" class="btn btn-sm" style="background:#7c3aed;color:#fff">Send</button></form>
          </div>
          <div class="card" style="padding:14px;margin-top:12px">
            <h4 style="font-size:13px;color:#1e293b;margin:0 0 8px">Stream Info</h4>
            <div style="font-size:12px;color:#64748b;line-height:2">
              <div>📡 Platform: <strong>${esc(stream.platform)}</strong></div>
              ${stream.scheduled_at?`<div>📅 Scheduled: ${fmtDateTime(stream.scheduled_at)}</div>`:''}
              ${stream.started_at?`<div>▶️ Started: ${fmtDateTime(stream.started_at)}</div>`:''}
              <div>📈 Peak Viewers: ${stream.max_viewers||0}</div>
            </div></div>
        </div>
      </div>
      ${stream.description ? `<div class="card" style="padding:20px;margin-top:16px"><p style="font-size:14px;color:#475569;line-height:1.7;margin:0">${esc(stream.description)}</p></div>` : ''}
    </div>
    <script>setInterval(()=>{fetch('/api/live/${stream.id}/chat').then(r=>r.json()).then(d=>{if(d.messages){const box=document.getElementById('chatBox');box.innerHTML=d.messages.map(m=>'<div class=\\'me-chat-msg\\'><strong style=\\'color:#7c3aed;font-size:12px\\'>'+m.user_name+'</strong> <span style=\\'font-size:12px;color:#475569;margin-left:6px\\'>'+m.message+'</span></div>').join('');box.scrollTop=box.scrollHeight;}});},5000);</script>`, req.session?.user, true));
}));

// POST /api/live/:id/chat — Send chat message
app.post('/api/live/:id/chat', ah(async (req, res) => {
  if (!req.body.message || !req.body.message.trim()) return res.redirect('/live/' + req.params.id);
  const user = req.session?.user;
  await pool.query(
    `INSERT INTO stream_chat (stream_id, user_email, user_name, message) VALUES ($1, $2, $3, $4)`,
    [req.params.id, user?.email || 'guest', user?.name || 'Guest', req.body.message.trim().substring(0, 500)]
  );
  res.redirect('/live/' + req.params.id + '#chatBox');
}));

// GET /api/live/:id/chat — Get recent chat messages (polling)
app.get('/api/live/:id/chat', ah(async (req, res) => {
  const messages = (await pool.query(`SELECT user_name, message, created_at FROM stream_chat WHERE stream_id=$1 ORDER BY created_at DESC LIMIT 50`, [req.params.id])).rows;
  res.json({ messages: messages.reverse().map(m => ({ user_name: m.user_name, message: m.message, time: m.created_at })) });
}));

// POST /api/live/schedule — Schedule a stream (auth)
app.post('/api/live/schedule', requireAuth, ah(async (req, res) => {
  const user = req.session.user;
  const { title, description, stream_url, thumbnail_url, platform, scheduled_at } = req.body;
  if (!title || !title.trim()) return res.json({ success: false, error: 'Title required' });
  await pool.query(
    `INSERT INTO live_streams (tenant_id,title,description,stream_url,thumbnail_url,platform,scheduled_at,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [user.tenant_id, title.trim(), description||null, stream_url||null, thumbnail_url||null, platform||'youtube', scheduled_at||null, user.email]
  );
  res.json({ success: true });
}));

// POST /api/live/start/:id — Go live (auth)
app.post('/api/live/start/:id', requireAuth, ah(async (req, res) => {
  await pool.query(`UPDATE live_streams SET is_live=true, started_at=NOW() WHERE id=$1 AND created_by=$2`, [req.params.id, req.session.user.email]);
  res.json({ success: true });
}));

// POST /api/live/end/:id — End stream (auth)
app.post('/api/live/end/:id', requireAuth, ah(async (req, res) => {
  await pool.query(`UPDATE live_streams SET is_live=false, ended_at=NOW() WHERE id=$1 AND created_by=$2`, [req.params.id, req.session.user.email]);
  res.json({ success: true });
}));

// GET /admin/live-streams — Admin live stream management
app.get('/admin/live-streams', requireAuth, ah(async (req, res) => {
  const user = req.session.user;
  const streams = (await pool.query(`SELECT * FROM live_streams WHERE tenant_id=$1 OR created_by=$2 ORDER BY created_at DESC LIMIT 100`, [user.tenant_id, user.email])).rows;
  const rows = streams.map(s => `<tr>
    <td><strong style="color:${s.is_live?'#dc2626':'#1e293b'}">${esc(s.title)}</strong></td>
    <td>${s.is_live?'<span class="badge" style="background:#dcfce7;color:#16a34a;font-weight:700">🔴 LIVE</span>':s.ended_at?'<span class="badge" style="background:#f1f5f9;color:#64748b">Ended</span>':'<span class="badge" style="background:#dbeafe;color:#2563eb">Scheduled</span>'}</td>
    <td style="font-size:12px">${esc(s.platform)}</td>
    <td style="font-size:12px">${s.viewer_count||0}</td>
    <td style="font-size:12px;color:#94a3b8">${fmtDate(s.created_at)}</td>
    <td style="white-space:nowrap">
      <a href="/live/${s.id}" target="_blank" class="btn btn-sm" style="background:#dc2626;color:#fff">Watch</a>
      ${s.is_live ? `<form method="POST" action="/api/live/end/${s.id}" style="display:inline"><button class="btn btn-sm btn-red" type="submit">End</button></form>` : ''}</td></tr>`).join('');
  res.send(renderPage('Admin Live', MEDIA_CSS + `
    <div style="max-width:1200px;margin:0 auto">
      <div class="me-nav"><a href="/admin/videos">🎬 Videos</a><a href="/admin/podcasts">🎙 Podcasts</a><a href="/admin/live-streams" class="active">📡 Live</a><a href="/admin/media">📂 Media Library</a></div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <h1 style="font-size:24px;color:#1e293b">📡 Live Streams</h1>
        <button onclick="document.getElementById('schedForm').style.display=document.getElementById('schedForm').style.display==='none'?'block':'none'" class="btn btn-sm" style="background:#dc2626;color:#fff">+ Schedule Stream</button>
      </div>
      <div class="card" style="padding:20px;margin-bottom:20px;display:none" id="schedForm">
        <h3 style="font-size:15px;color:#1e293b;margin:0 0 12px">Schedule New Stream</h3>
        <form method="POST" action="/api/live/schedule" class="me-form" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div><label>Title *</label><input type="text" name="title" required placeholder="Stream title"></div>
          <div><label>Platform</label><select name="platform"><option value="youtube">YouTube Live</option><option value="facebook">Facebook Live</option><option value="twitch">Twitch</option></select></div>
          <div style="grid-column:1/-1"><label>Stream URL</label><input type="url" name="stream_url" placeholder="https://..."></div>
          <div><label>Scheduled At</label><input type="datetime-local" name="scheduled_at"></div>
          <div><label>Thumbnail URL</label><input type="url" name="thumbnail_url" placeholder="https://..."></div>
          <div style="grid-column:1/-1"><label>Description</label><textarea name="description" rows="2" placeholder="Stream description"></textarea></div>
          <div><button type="submit" class="btn" style="background:#dc2626;color:#fff;width:100%">Schedule</button></div>
        </form></div>
      <div class="card"><div style="overflow-x:auto"><table class="me-table">
        <thead><tr><th>Title</th><th>Status</th><th>Platform</th><th>Viewers</th><th>Date</th><th>Actions</th></tr></thead>
        <tbody>${rows||'<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:30px">No streams yet</td></tr>'}</tbody>
      </table></div></div>
    </div>`, user, req));
}));

// ── 4. MEDIA LIBRARY (Admin) ─────────────────────────────────

// GET /admin/media — Unified media library
app.get('/admin/media', requireAuth, ah(async (req, res) => {
  const user = req.session.user;
  const [videoStats, podcastStats, streamStats, commentCount] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int as total, COALESCE(SUM(views),0)::int as views, COALESCE(SUM(likes),0)::int as likes FROM videos WHERE tenant_id=$1 OR created_by=$2`, [user.tenant_id, user.email]),
    pool.query(`SELECT COUNT(*)::int as total, (SELECT COUNT(*)::int FROM podcast_episodes) as episodes FROM podcasts WHERE tenant_id=$1 OR author=$2`, [user.tenant_id, user.email]),
    pool.query(`SELECT COUNT(*)::int as total, COALESCE(SUM(viewer_count),0)::int as total_viewers FROM live_streams WHERE tenant_id=$1 OR created_by=$2`, [user.tenant_id, user.email]),
    pool.query(`SELECT COUNT(*)::int as total FROM video_comments`)
  ]);
  const vs = videoStats.rows[0], ps = podcastStats.rows[0], ss = streamStats.rows[0], cc = commentCount.rows[0];
  const mostPopular = (await pool.query(`SELECT id, title, views, 'video' as type FROM videos WHERE is_published=true ORDER BY views DESC LIMIT 5`)).rows;
  const popularHtml = mostPopular.map(v => `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f1f5f9">
    <span style="font-weight:700;color:#7c3aed;min-width:24px">#${mostPopular.indexOf(v)+1}</span>
    <div style="flex:1;font-size:13px;color:#1e293b">${esc(v.title)}</div>
    <span style="font-size:12px;color:#94a3b8">👁 ${v.views}</span></div>`).join('');
  res.send(renderPage('Media Library', MEDIA_CSS + `
    <div style="max-width:1200px;margin:0 auto">
      <div class="me-nav"><a href="/admin/videos">🎬 Videos</a><a href="/admin/podcasts">🎙 Podcasts</a><a href="/admin/live-streams">📡 Live</a><a href="/admin/media" class="active">📂 Media Library</a></div>
      <h1 style="font-size:24px;color:#1e293b;margin-bottom:20px">📂 Media Library</h1>
      <div class="me-stats">
        <div class="me-stat"><div class="me-stat-val" style="color:#7c3aed">${vs.total}</div><div class="me-stat-lbl">Videos</div></div>
        <div class="me-stat"><div class="me-stat-val" style="color:#ec4899">${ps.total}</div><div class="me-stat-lbl">Podcasts</div></div>
        <div class="me-stat"><div class="me-stat-val" style="color:#dc2626">${ss.total}</div><div class="me-stat-lbl">Streams</div></div>
        <div class="me-stat"><div class="me-stat-val" style="color:#2563eb">${vs.views}</div><div class="me-stat-lbl">Total Views</div></div>
        <div class="me-stat"><div class="me-stat-val" style="color:#ef4444">${vs.likes}</div><div class="me-stat-lbl">Total Likes</div></div>
        <div class="me-stat"><div class="me-stat-val" style="color:#f59e0b">${cc.total}</div><div class="me-stat-lbl">Comments</div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
        <div class="card" style="padding:20px">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">📊 Overview</h3>
          <div style="font-size:13px;color:#475569;line-height:2.2">
            <div>🎬 <strong>${vs.total}</strong> videos (${vs.published||0} published) · 👁 <strong>${vs.views}</strong> total views · ❤️ <strong>${vs.likes}</strong> likes</div>
            <div>🎙 <strong>${ps.total}</strong> podcasts · <strong>${ps.episodes}</strong> episodes</div>
            <div>📡 <strong>${ss.total}</strong> streams · 👁 <strong>${ss.total_viewers}</strong> total viewers</div>
          </div></div>
        <div class="card" style="padding:20px">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">🔥 Most Popular</h3>
          ${popularHtml || '<p style="color:#94a3b8;font-size:13px">No content yet</p>'}</div>
      </div>
    </div>`, user, req));
}));

// POST /api/media/upload — Generic media upload endpoint
app.post('/api/media/upload', requireAuth, ah(async (req, res) => {
  const user = req.session.user;
  const { type, title, url, thumbnail_url, description, category } = req.body;
  if (!type || !title || !title.trim()) return res.json({ success: false, error: 'Type and title required' });
  if (type === 'video') {
    await pool.query(
      `INSERT INTO videos (tenant_id,title,description,video_url,thumbnail_url,category,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [user.tenant_id, title.trim(), description||null, url||null, thumbnail_url||null, category||null, user.email]
    );
  } else if (type === 'podcast') {
    await pool.query(
      `INSERT INTO podcasts (tenant_id,title,description,cover_url,author,category) VALUES ($1,$2,$3,$4,$5,$6)`,
      [user.tenant_id, title.trim(), description||null, thumbnail_url||url||null, user.name||user.email, category||null]
    );
  } else {
    return res.json({ success: false, error: 'Invalid type. Use "video" or "podcast".' });
  }
  res.json({ success: true });
}));

// ── 5. PUBLIC MEDIA HUB ──────────────────────────────────────

// GET /media-hub — Public landing page for all media
app.get('/media-hub', ah(async (req, res) => {
  const search = (req.query.search || '').trim();
  const cat = req.query.category || '';
  // Featured videos
  const featuredVideos = (await pool.query(`SELECT * FROM videos WHERE is_published=true AND featured=true ORDER BY created_at DESC LIMIT 6`)).rows;
  // Recent videos
  const recentVideos = (await pool.query(`SELECT * FROM videos WHERE is_published=true ORDER BY created_at DESC LIMIT 6`)).rows;
  // Popular podcasts
  const topPodcasts = (await pool.query(`SELECT p.*, (SELECT COUNT(*)::int FROM podcast_episodes pe WHERE pe.podcast_id=p.id) as ep_count FROM podcasts p WHERE p.is_published=true ORDER BY p.created_at DESC LIMIT 4`)).rows;
  // Active/Upcoming live
  const liveNow = (await pool.query(`SELECT * FROM live_streams WHERE is_live=true ORDER BY viewer_count DESC LIMIT 3`)).rows;
  const upcomingStreams = (await pool.query(`SELECT * FROM live_streams WHERE is_live=false AND scheduled_at > NOW() AND ended_at IS NULL ORDER BY scheduled_at ASC LIMIT 3`)).rows;
  // Search across all
  let searchResults = [];
  if (search) {
    const s = `%${search}%`;
    const vr = (await pool.query(`SELECT id, title, description, 'video' as type FROM videos WHERE is_published=true AND (title ILIKE $1 OR description ILIKE $1) LIMIT 10`, [s])).rows;
    const pr = (await pool.query(`SELECT id, title, description, 'podcast' as type FROM podcasts WHERE is_published=true AND (title ILIKE $1 OR description ILIKE $1) LIMIT 10`, [s])).rows;
    const lr = (await pool.query(`SELECT id, title, description, 'stream' as type FROM live_streams WHERE title ILIKE $1 LIMIT 5`, [s])).rows;
    searchResults = [...vr, ...pr, ...lr];
  }

  const featuredCards = featuredVideos.map(v => `<div class="me-card" onclick="location.href='/videos/${esc(v.id)}'">
    <div class="me-card-thumb">${v.thumbnail_url?`<img src="${esc(v.thumbnail_url)}" loading="lazy">`:'<div class="ph">🎬</div>'}
      <div class="me-card-badge" style="background:#f59e0b">⭐ Featured</div></div>
    <div class="me-card-body"><div class="me-card-title">${esc(v.title)}</div>
      <div class="me-card-meta"><span>👁 ${v.views||0}</span></div></div></div>`).join('');
  const videoCards = recentVideos.map(v => `<div class="me-card" onclick="location.href='/videos/${esc(v.id)}'">
    <div class="me-card-thumb" style="height:160px">${v.thumbnail_url?`<img src="${esc(v.thumbnail_url)}" loading="lazy">`:'<div class="ph">🎬</div>'}</div>
    <div class="me-card-body"><div class="me-card-title" style="font-size:14px">${esc(v.title)}</div>
      <div class="me-card-meta"><span>👁 ${v.views||0}</span>${v.category?`<span style="background:#ede9fe;color:#7c3aed;padding:2px 8px;border-radius:12px;font-size:11px">${esc(v.category)}</span>`:''}</div></div></div>`).join('');
  const podcastCards = topPodcasts.map(p => `<div class="me-card" onclick="location.href='/podcasts/${esc(p.id)}'">
    <div class="me-card-thumb" style="height:180px;background:linear-gradient(135deg,#fce7f3,#fbcfe8)">
      ${p.cover_url?`<img src="${esc(p.cover_url)}" loading="lazy">`:'<div class="ph" style="color:#ec4899">🎙</div>'}
      <div class="me-card-badge" style="background:#ec4899">${p.ep_count||0} eps</div></div>
    <div class="me-card-body"><div class="me-card-title">${esc(p.title)}</div>
      <div class="me-card-meta"><span>🎙 ${esc(p.author||'')}</span></div></div></div>`).join('');
  const liveCards = liveNow.map(s => `<div class="me-card" onclick="location.href='/live/${esc(s.id)}'">
    <div class="me-card-thumb" style="height:140px;background:linear-gradient(135deg,#dc2626,#991b1b)">
      ${s.thumbnail_url?`<img src="${esc(s.thumbnail_url)}" loading="lazy">`:'<div class="ph" style="color:#fecaca">📡</div>'}
      <div class="me-card-live">🔴 LIVE</div></div>
    <div class="me-card-body"><div class="me-card-title" style="font-size:14px">${esc(s.title)}</div>
      <div class="me-card-meta"><span>👁 ${s.viewer_count||0}</span></div></div></div>`).join('');
  const searchHtml = searchResults.map(r => {
    const href = r.type==='video'?`/videos/${r.id}`:r.type==='podcast'?`/podcasts/${r.id}`:`/live/${r.id}`;
    const icon = r.type==='video'?'🎬':r.type==='podcast'?'🎙':'📡';
    const color = r.type==='video'?'#7c3aed':r.type==='podcast'?'#ec4899':'#dc2626';
    return `<a href="${href}" class="card" style="display:flex;gap:14px;align-items:center;padding:14px;margin-bottom:8px;text-decoration:none;color:#1e293b;transition:.15s;cursor:pointer">
      <div style="width:40px;height:40px;border-radius:10px;background:${color}22;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">${icon}</div>
      <div style="flex:1"><div style="font-weight:600;font-size:14px">${esc(r.title)}</div>
        <div style="font-size:12px;color:#94a3b8">${r.description?esc(r.description).substring(0,60):''}</div></div>
      <span style="font-size:11px;color:${color};font-weight:600;text-transform:uppercase">${r.type}</span></a>`;
  }).join('');

  const allCats = [...VIDEO_CATEGORIES, ...PODCAST_CATEGORIES.filter(c=>!VIDEO_CATEGORIES.includes(c))];
  const catPills = allCats.map(c =>
    `<a href="/media-hub?category=${esc(c)}" class="me-cat-pill" style="background:${cat===c?'#7c3aed':'#f1f5f9'};color:${cat===c?'#fff':'#475569'}">${esc(c)}</a>`
  ).join('');

  res.send(renderPage('Media Hub', MEDIA_CSS + `
    <div style="max-width:1200px;margin:0 auto">
      <div style="text-align:center;padding:50px 20px;background:linear-gradient(135deg,#7c3aed,#4f46e5,#ec4899);border-radius:16px;margin-bottom:24px;color:#fff">
        <h1 style="font-size:36px;margin:0">🎬 🎙 📡 Media Hub</h1>
        <p style="opacity:.85;margin-top:8px;font-size:16px">Videos, Podcasts & Live Streams — All in one place</p>
        <form method="GET" action="/media-hub" style="display:flex;gap:8px;max-width:500px;margin:20px auto 0">
          <input type="text" name="search" value="${esc(search)}" placeholder="Search all media..." style="flex:1;padding:12px 18px;border:none;border-radius:10px;font-size:15px">
          <button type="submit" style="padding:12px 24px;background:#f59e0b;color:#fff;border:none;border-radius:10px;font-weight:700;font-size:14px;cursor:pointer">Search</button></form>
      </div>
      ${search ? `<div style="margin-bottom:24px"><h2 style="font-size:18px;color:#1e293b;margin-bottom:12px">Search results for "${esc(search)}" (${searchResults.length})</h2>
        ${searchHtml||'<p style="color:#94a3b8;text-align:center;padding:24px">No results found</p>'}</div>` : ''}
      ${!search ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px">${catPills}</div>
      ${liveNow.length ? `<div style="margin-bottom:28px"><h2 style="font-size:20px;color:#1e293b;margin-bottom:14px">🔴 Live Now</h2><div class="me-grid">${liveCards}</div></div>` : ''}
      ${featuredVideos.length ? `<div style="margin-bottom:28px"><h2 style="font-size:20px;color:#1e293b;margin-bottom:14px">⭐ Featured Content</h2><div class="me-grid">${featuredCards}</div></div>` : ''}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <h2 style="font-size:20px;color:#1e293b">🎬 Latest Videos</h2>
        <a href="/videos" style="color:#7c3aed;font-size:13px;font-weight:600;text-decoration:none">View All →</a></div>
      <div class="me-grid" style="margin-bottom:28px">${videoCards||'<p style="color:#94a3b8;grid-column:1/-1;text-align:center;padding:24px">No videos yet</p>'}</div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <h2 style="font-size:20px;color:#1e293b">🎙 Top Podcasts</h2>
        <a href="/podcasts" style="color:#ec4899;font-size:13px;font-weight:600;text-decoration:none">View All →</a></div>
      <div class="me-grid" style="margin-bottom:28px">${podcastCards||'<p style="color:#94a3b8;grid-column:1/-1;text-align:center;padding:24px">No podcasts yet</p>'}</div>
      ${upcomingStreams.length ? `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <h2 style="font-size:20px;color:#1e293b">📅 Upcoming Streams</h2>
        <a href="/live" style="color:#dc2626;font-size:13px;font-weight:600;text-decoration:none">View All →</a></div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;margin-bottom:28px">
          ${upcomingStreams.map(s => `<div class="card" style="padding:14px;cursor:pointer" onclick="location.href='/live/${esc(s.id)}'">
            <div style="font-weight:600;font-size:14px;color:#1e293b">${esc(s.title)}</div>
            <div style="font-size:12px;color:#94a3b8;margin-top:4px">${fmtDateTime(s.scheduled_at)} · ${esc(s.platform)}</div></div>`).join('')}
        </div>` : ''}` : ''}
    </div>`, null, true));
}));

console.log('[MediaEngine] LOADED: Video hosting (' + VIDEO_CATEGORIES.length + ' categories), podcast module with RSS feeds, live streaming with chat, media library, media hub');
