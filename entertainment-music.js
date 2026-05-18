// ============================================================
// === ENTERTAINMENT MUSIC — Spotify-style Streaming Module ===
// === Comfort Zone SaaS Platform (Node.js/Express) ============
// ============================================================

module.exports = function(app, pool, opts) {
  const esc = opts.esc;
  const renderPage = opts.renderPage;
  const ah = opts.ah;
  const requireAuth = opts.requireAuth;
  const requireNotBanned = opts.requireNotBanned;
  const audit = opts.audit;

  const P = '#7c3aed';
  const PINK = '#ec4899';
  const GRAY = '#6b7280';
  const DARK = '#0f0f23';

  const GENRES = ['Hip Hop','R&B','Gospel','Pop','Rock','Jazz','Classical','Afrobeats','Reggae','Electronic','Acoustic','Workout','Study','Sleep','Party'];
  const MOODS = ['Happy','Sad','Energetic','Chill','Romantic','Focus','Party','Spiritual','Nostalgic','Motivational'];
  const RADIO_STATIONS = [
    { name:'Chill Vibes', genre:null, mood:'Chill', icon:'🎧', color:'#7c3aed' },
    { name:'Workout Energy', genre:null, mood:'Energetic', icon:'💪', color:'#ef4444' },
    { name:'Study Focus', genre:null, mood:'Focus', icon:'📚', color:'#2563eb' },
    { name:'Party Mix', genre:null, mood:'Party', icon:'🎉', color:'#f59e0b' },
    { name:'Gospel Hour', genre:'Gospel', mood:'Spiritual', icon:'⛪', color:'#059669' },
    { name:'Afrobeats Station', genre:'Afrobeats', mood:'Happy', icon:'🌍', color:'#dc2626' },
    { name:'Throwback Hits', genre:'Pop', mood:'Nostalgic', icon:'⏰', color:'#8b5cf6' }
  ];

  // ── MIGRATIONS (try-catch async IIFE) ─────────────────────
  (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS ent_music_albums (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        name VARCHAR(255) NOT NULL,
        artist VARCHAR(255),
        genre VARCHAR(100),
        cover_url TEXT,
        description TEXT,
        release_date DATE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS ent_music_tracks (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        title VARCHAR(255) NOT NULL,
        artist VARCHAR(255),
        album_id INTEGER REFERENCES ent_music_albums(id) ON DELETE SET NULL,
        genre VARCHAR(100),
        mood VARCHAR(100),
        audio_url TEXT,
        cover_url TEXT,
        lyrics TEXT,
        duration INTEGER DEFAULT 0,
        play_count INTEGER DEFAULT 0,
        likes INTEGER DEFAULT 0,
        is_explicit BOOLEAN DEFAULT false,
        uploader_email TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS ent_music_playlists (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        cover_url TEXT,
        is_public BOOLEAN DEFAULT true,
        is_collaborative BOOLEAN DEFAULT false,
        created_by TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS ent_music_playlist_tracks (
        id SERIAL PRIMARY KEY,
        playlist_id INTEGER REFERENCES ent_music_playlists(id) ON DELETE CASCADE,
        track_id INTEGER REFERENCES ent_music_tracks(id) ON DELETE CASCADE,
        position INTEGER,
        added_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS ent_music_likes (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        track_id INTEGER REFERENCES ent_music_tracks(id) ON DELETE CASCADE,
        user_email TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(tenant_id, track_id, user_email)
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS ent_music_play_history (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        track_id INTEGER REFERENCES ent_music_tracks(id) ON DELETE CASCADE,
        user_email TEXT,
        played_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS ent_music_podcasts (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        cover_url TEXT,
        artist VARCHAR(255),
        rss_url TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS ent_music_podcast_episodes (
        id SERIAL PRIMARY KEY,
        podcast_id INTEGER REFERENCES ent_music_podcasts(id) ON DELETE CASCADE,
        tenant_id INTEGER NOT NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        audio_url TEXT,
        duration INTEGER DEFAULT 0,
        episode_number INTEGER DEFAULT 1,
        published_at DATE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS ent_music_audiobooks (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        title VARCHAR(255) NOT NULL,
        author VARCHAR(255),
        narrator VARCHAR(255),
        cover_url TEXT,
        description TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS ent_music_audiobook_chapters (
        id SERIAL PRIMARY KEY,
        audiobook_id INTEGER REFERENCES ent_music_audiobooks(id) ON DELETE CASCADE,
        tenant_id INTEGER NOT NULL,
        title VARCHAR(255) NOT NULL,
        audio_url TEXT,
        duration INTEGER DEFAULT 0,
        chapter_number INTEGER DEFAULT 1
      )`);
      console.log('[EntertainmentMusic] All tables ready');
    } catch(e) { console.warn('[EntertainmentMusic] Migration warning:', e.message); }
  })();

  // ── HELPERS ────────────────────────────────────────────────
  const fmtDate = d => d ? new Date(d).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) : '—';
  const fmtDur = s => { if(!s) return '0:00'; const m=Math.floor(s/60); return m+':'+String(Math.floor(s%60)).padStart(2,'0'); };

  function miniPlayer(req) {
    const mp = req.session.miniPlayer;
    if (!mp || !mp.trackId) return '';
    return `<div id="mini-player" style="position:fixed;bottom:0;left:0;right:0;background:#181818;border-top:1px solid #333;z-index:9999;display:flex;align-items:center;padding:6px 16px;gap:12px" data-track-id="${esc(String(mp.trackId))}" data-title="${esc(mp.title||'')}" data-artist="${esc(mp.artist||'')}" data-audio-url="${esc(mp.audioUrl||'')}" data-cover-url="${esc(mp.coverUrl||'')}" data-current-time="0" data-duration="${esc(String(mp.duration||0))}">
      <img src="${esc(mp.coverUrl||'')}" onerror="this.style.display='none'" style="width:42px;height:42px;border-radius:6px;object-fit:cover">
      <div style="flex:1;min-width:0"><div style="font-size:13px;color:#fff;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(mp.title||'')}</div><div style="font-size:11px;color:#aaa;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(mp.artist||'')}</div></div>
      <button onclick="document.getElementById('mini-player').remove()" style="background:none;border:none;color:#888;cursor:pointer;font-size:18px">✕</button>
    </div>`;
  }

  // ── CSS ────────────────────────────────────────────────────
  const MUS_CSS = `<style>
    .mus-nav{display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap;align-items:center}
    .mus-nav a{padding:8px 18px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#475569;background:#f1f5f9;transition:.15s}
    .mus-nav a:hover{background:#e2e8f0}
    .mus-nav a.active{background:${P};color:#fff}
    .mus-hero{background:linear-gradient(135deg,${P},${PINK});border-radius:16px;padding:40px 28px;margin-bottom:24px;color:#fff;position:relative;overflow:hidden}
    .mus-hero::after{content:'';position:absolute;top:-50%;right:-20%;width:400px;height:400px;background:rgba(255,255,255,.06);border-radius:50%}
    .mus-hero h1{font-size:32px;margin:0 0 8px;position:relative;z-index:1}
    .mus-hero p{opacity:.85;font-size:14px;margin:0;position:relative;z-index:1}
    .mus-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:16px}
    .mus-card{background:#fff;border-radius:12px;overflow:hidden;transition:.2s;cursor:pointer;border:1px solid #e2e8f0}
    .mus-card:hover{box-shadow:0 4px 20px rgba(124,58,237,.12);transform:translateY(-2px)}
    .mus-card-img{height:180px;background:linear-gradient(135deg,#ede9fe,#fce7f3);position:relative;display:flex;align-items:center;justify-content:center}
    .mus-card-img img{width:100%;height:100%;object-fit:cover}
    .mus-card-img .ph{font-size:40px;color:#c4b5fd}
    .mus-card-body{padding:12px 14px}
    .mus-card-title{font-size:14px;font-weight:700;color:#1e293b;margin:0 0 3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .mus-card-sub{font-size:12px;color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .mus-pill{display:inline-block;padding:4px 14px;border-radius:20px;font-size:12px;font-weight:600;text-decoration:none;transition:.15s;margin:3px}
    .mus-pill:hover{opacity:.8}
    .mus-stat{background:#fff;border-radius:14px;padding:16px;text-align:center;border:1px solid #e2e8f0}
    .mus-stat-val{font-size:28px;font-weight:800;color:#1e293b}
    .mus-stat-lbl{font-size:11px;color:#94a3b8;margin-top:4px;text-transform:uppercase;letter-spacing:.3px}
    .mus-table{width:100%;border-collapse:collapse;font-size:13px}
    .mus-table th{padding:10px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase;background:#f8fafc}
    .mus-table td{padding:10px 14px;border-bottom:1px solid #f1f5f9}
    .mus-table tr:hover{background:#f8fafc}
    .mus-form label{display:block;font-size:13px;font-weight:600;color:#475569;margin-bottom:4px}
    .mus-form input,.mus-form select,.mus-form textarea{width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;box-sizing:border-box}
    .mus-form input:focus,.mus-form select:focus,.mus-form textarea:focus{outline:none;border-color:${P}}
    .mus-player-wrap{background:#0f0f23;border-radius:16px;overflow:hidden;color:#fff}
    .mus-progress{width:100%;height:4px;background:#444;border-radius:2px;cursor:pointer;position:relative}
    .mus-progress-fill{height:100%;background:linear-gradient(90deg,${P},${PINK});border-radius:2px;transition:width .1s}
    .mus-lyrics{max-height:300px;overflow-y:auto;padding:16px;background:#f8fafc;border-radius:12px;font-size:14px;line-height:2;color:#475569}
    .mus-lyrics .active-line{color:${P};font-weight:700;font-size:15px;background:rgba(124,58,237,.08);border-radius:6px;padding:2px 8px;display:inline-block}
    .mus-queue-item{display:flex;align-items:center;gap:10px;padding:10px;border-radius:8px;transition:.15s}
    .mus-queue-item:hover{background:#f3f4f6}
    .mus-scroll-row{display:flex;gap:16px;overflow-x:auto;padding-bottom:12px;scroll-snap-type:x mandatory}
    .mus-scroll-row::-webkit-scrollbar{height:6px}
    .mus-scroll-row::-webkit-scrollbar-thumb{background:${P};border-radius:3px}
    .mus-scroll-row .mus-card{min-width:180px;scroll-snap-align:start;flex-shrink:0}
    .mus-genre-tile{border-radius:14px;padding:20px;text-align:center;color:#fff;font-weight:700;font-size:14px;cursor:pointer;transition:.2s;text-decoration:none;display:block}
    .mus-genre-tile:hover{transform:scale(1.04);box-shadow:0 4px 16px rgba(0,0,0,.15)}
    @media(max-width:768px){.mus-grid{grid-template-columns:repeat(auto-fill,minmax(140px,1fr))}.mus-nav{gap:4px}.mus-nav a{padding:6px 12px;font-size:12px}.mus-hero{padding:24px 16px}.mus-hero h1{font-size:22px}}
  </style>`;

  // ── NAV BAR ────────────────────────────────────────────────
  const BASE = '/entertainment/music';
  function nav(active) {
    const links = [
      ['🎵 Home', BASE], ['📂 Albums', BASE+'/albums'], ['🎤 Artists', BASE+'/artists'],
      ['📋 Playlists', BASE+'/playlists'], ['🔍 Search', BASE+'/search'],
      ['📻 Radio', BASE+'/radio'], ['🎙 Podcasts', BASE+'/podcasts'],
      ['📖 Audiobooks', BASE+'/audiobooks'], ['📊 Charts', BASE+'/charts'],
      ['⬆️ Upload', BASE+'/upload']
    ];
    let h = '<div class="mus-nav">';
    links.forEach(([l,u]) => { h += `<a href="${u}" class="${u===active?'active':''}">${l}</a>`; });
    return h + '</div>';
  }

  function page(title, body, req) {
    return renderPage(title, MUS_CSS + `<div style="max-width:1200px;margin:0 auto;padding:20px;padding-bottom:80px">${body}</div>` + (req ? miniPlayer(req) : ''), req?.session?.user, req);
  }

  // ────────────────────────────────────────────────────────────
  // 1. MUSIC DASHBOARD
  // ────────────────────────────────────────────────────────────
  app.get(BASE, ah(async (req, res) => {
    const tid = req.session?.user?.tenant_id;
    const featured = (await pool.query('SELECT * FROM ent_music_tracks WHERE tenant_id=$1 ORDER BY play_count DESC LIMIT 1', [tid||0])).rows[0];
    const newReleases = (await pool.query('SELECT * FROM ent_music_tracks WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 12', [tid||0])).rows;
    const recentlyPlayed = (await pool.query('SELECT DISTINCT ON (t.id) t.* FROM ent_music_tracks t JOIN ent_music_play_history h ON h.track_id=t.id WHERE t.tenant_id=$1 ORDER BY t.id, h.played_at DESC LIMIT 10', [tid||0])).rows;
    const topCharts = (await pool.query('SELECT * FROM ent_music_tracks WHERE tenant_id=$1 ORDER BY play_count DESC LIMIT 10', [tid||0])).rows;

    let html = nav(BASE);
    // Hero
    html += `<div class="mus-hero">`;
    if (featured) {
      html += `<div style="display:flex;gap:24px;align-items:center;flex-wrap:wrap">
        <img src="${esc(featured.cover_url||'')}" onerror="this.style.display='none'" style="width:180px;height:180px;border-radius:14px;object-fit:cover;box-shadow:0 8px 32px rgba(0,0,0,.3)">
        <div><h1>${esc(featured.title)}</h1><p style="font-size:16px;margin-bottom:12px">${esc(featured.artist||'Unknown Artist')} · ${esc(featured.genre||'')}</p>
        <a href="${BASE}/${featured.id}/play" style="display:inline-flex;align-items:center;gap:8px;background:#fff;color:${P};padding:12px 28px;border-radius:30px;font-weight:700;text-decoration:none;font-size:15px">▶ Play Now</a></div></div>`;
    } else {
      html += `<h1>🎵 Music Streaming</h1><p>Upload and stream your favorite tracks, create playlists, and discover new music.</p>
      <a href="${BASE}/upload" style="display:inline-flex;align-items:center;gap:8px;background:#fff;color:${P};padding:12px 28px;border-radius:30px;font-weight:700;text-decoration:none;font-size:15px;margin-top:16px">⬆️ Upload Track</a>`;
    }
    html += '</div>';

    // New Releases
    html += '<h2 style="font-size:20px;color:#1e293b;margin-bottom:14px">🆕 New Releases</h2>';
    html += '<div class="mus-scroll-row" style="margin-bottom:28px">';
    newReleases.forEach(t => { html += trackCard(t); });
    html += '</div>';

    // Recently Played
    if (recentlyPlayed.length) {
      html += '<h2 style="font-size:20px;color:#1e293b;margin-bottom:14px">🕐 Recently Played</h2>';
      html += '<div class="mus-grid" style="margin-bottom:28px">';
      recentlyPlayed.forEach(t => { html += trackCard(t); });
      html += '</div>';
    }

    // Top Charts Preview
    if (topCharts.length) {
      html += '<h2 style="font-size:20px;color:#1e293b;margin-bottom:14px">🏆 Top Charts</h2>';
      html += '<div class="card" style="padding:0;overflow:hidden;margin-bottom:28px"><table class="mus-table"><thead><tr><th>#</th><th>Title</th><th>Artist</th><th>Plays</th><th></th></tr></thead><tbody>';
      topCharts.forEach((t,i) => {
        html += `<tr><td style="font-weight:700;color:${P}">${i+1}</td><td>${esc(t.title)}</td><td style="color:${GRAY}">${esc(t.artist||'')}</td><td>${t.play_count||0}</td><td><a href="${BASE}/${t.id}/play" style="color:${P};font-size:12px;font-weight:600">▶ Play</a></td></tr>`;
      });
      html += '</tbody></table></div>';
    }

    // Browse by Genre/Mood
    html += '<h2 style="font-size:20px;color:#1e293b;margin-bottom:14px">🎧 Browse by Genre & Mood</h2>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:12px">';
    const genreColors = ['#7c3aed','#ec4899','#2563eb','#ef4444','#f59e0b','#059669','#dc2626','#8b5cf6','#d97706','#06b6d4','#65a30d','#be123c','#6366f1','#6d28d9','#e11d48'];
    GENRES.forEach((g,i) => {
      html += `<a href="${BASE}/search?genre=${encodeURIComponent(g)}" class="mus-genre-tile" style="background:${genreColors[i%genreColors.length]}">${g}</a>`;
    });
    MOODS.forEach((m,i) => {
      html += `<a href="${BASE}/search?mood=${encodeURIComponent(m)}" class="mus-genre-tile" style="background:linear-gradient(135deg,${genreColors[(i+3)%genreColors.length]},${genreColors[(i+7)%genreColors.length]})">${m}</a>`;
    });
    html += '</div>';

    res.send(page('Music', html, req));
  }));

  function trackCard(t) {
    return `<div class="mus-card" onclick="location.href='${BASE}/${t.id}/play'">
      <div class="mus-card-img">${t.cover_url ? `<img src="${esc(t.cover_url)}" alt="${esc(t.title)}" loading="lazy">` : '<div class="ph">🎵</div>'}
        ${t.is_explicit ? '<span style="position:absolute;top:8px;right:8px;background:#1e293b;color:#fff;font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px">E</span>' : ''}</div>
      <div class="mus-card-body"><div class="mus-card-title">${esc(t.title)}</div><div class="mus-card-sub">${esc(t.artist||'Unknown')} ${t.duration ? '· '+fmtDur(t.duration) : ''}</div></div></div>`;
  }

  // ────────────────────────────────────────────────────────────
  // 2. AUDIO UPLOAD
  // ────────────────────────────────────────────────────────────
  app.get(BASE+'/upload', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const albums = (await pool.query('SELECT id, name FROM ent_music_albums WHERE tenant_id=$1 ORDER BY name', [tid])).rows;
    let albumOpts = '<option value="">— No Album —</option>';
    albums.forEach(a => { albumOpts += `<option value="${a.id}">${esc(a.name)}</option>`; });
    let genreOpts = '<option value="">Select genre</option>';
    GENRES.forEach(g => { genreOpts += `<option value="${esc(g)}">${esc(g)}</option>`; });
    let moodOpts = '<option value="">Select mood</option>';
    MOODS.forEach(m => { moodOpts += `<option value="${esc(m)}">${esc(m)}</option>`; });

    let html = nav(BASE+'/upload');
    html += `<h1 style="font-size:24px;margin-bottom:20px">⬆️ Upload Track</h1>
    <div class="card" style="padding:28px"><form method="post" action="${BASE}/upload" class="mus-form">
      <div style="display:grid;gap:16px;max-width:600px">
        <div><label>Track Title *</label><input name="title" required placeholder="Song title"></div>
        <div><label>Artist *</label><input name="artist" required placeholder="Artist name"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
          <div><label>Album</label><select name="album_id">${albumOpts}</select></div>
          <div><label>Genre</label><select name="genre">${genreOpts}</select></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
          <div><label>Mood</label><select name="mood">${moodOpts}</select></div>
          <div><label>Release Date</label><input type="date" name="release_date"></div>
        </div>
        <div><label>Audio URL (MP3/WAV link) *</label><input name="audio_url" type="url" required placeholder="https://example.com/track.mp3"></div>
        <div><label>Cover Art URL</label><input name="cover_url" type="url" placeholder="https://example.com/cover.jpg"></div>
        <div><label>Lyrics</label><textarea name="lyrics" rows="6" placeholder="Paste lyrics here..."></textarea></div>
        <div><label>Duration (seconds)</label><input name="duration" type="number" min="0" placeholder="210"></div>
        <label style="display:flex;align-items:center;gap:8px;font-size:13px"><input type="checkbox" name="is_explicit" value="true"> Contains explicit content</label>
        <div style="display:flex;gap:12px"><button type="submit" class="btn" style="background:${P};color:#fff;padding:12px 28px">🎵 Upload Track</button><a href="${BASE}" class="btn" style="padding:12px 20px;background:#f1f5f9;color:#475569">Cancel</a></div>
      </div></form></div>`;
    res.send(page('Upload Track', html, req));
  }));

  app.post(BASE+'/upload', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { title, artist, album_id, genre, mood, audio_url, cover_url, lyrics, duration, is_explicit, release_date } = req.body;
    if (!title || !audio_url) return res.redirect(BASE + '/upload');

    let resolvedAlbumId = album_id && album_id !== '' ? parseInt(album_id) : null;

    // If release_date provided and album doesn't exist, create album
    if (!resolvedAlbumId && release_date) {
      const albumRes = await pool.query(
        'INSERT INTO ent_music_albums (tenant_id,name,artist,genre,cover_url,release_date) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
        [tid, title + ' (Single)', artist, genre, cover_url, release_date || null]
      );
      resolvedAlbumId = albumRes.rows[0].id;
    }

    const result = await pool.query(
      `INSERT INTO ent_music_tracks (tenant_id,title,artist,album_id,genre,mood,audio_url,cover_url,lyrics,duration,is_explicit,uploader_email) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [tid, title, artist, resolvedAlbumId, genre, mood, audio_url, cover_url, lyrics, parseInt(duration)||0, is_explicit==='true', req.session.user.email]
    );
    audit(req, 'music_upload', 'Uploaded track: ' + title);
    res.redirect(BASE + '/' + result.rows[0].id + '/play');
  }));

  // ────────────────────────────────────────────────────────────
  // 3. CUSTOM AUDIO PLAYER
  // ────────────────────────────────────────────────────────────
  app.get(BASE+'/:id/play', ah(async (req, res) => {
    const tid = req.session?.user?.tenant_id;
    const track = (await pool.query('SELECT t.*, a.name as album_name FROM ent_music_tracks t LEFT JOIN ent_music_albums a ON a.id=t.album_id WHERE t.id=$1', [req.params.id])).rows[0];
    if (!track) return res.status(404).send(page('Not Found', '<div class="card" style="text-align:center;padding:48px"><h2 style="color:#dc2626">Track not found</h2><a href="'+BASE+'" class="btn" style="margin-top:12px;background:'+P+';color:#fff">← Home</a></div>', req));

    // Update play count & history
    await pool.query('UPDATE ent_music_tracks SET play_count = play_count + 1 WHERE id=$1', [track.id]);
    const userEmail = req.session?.user?.email;
    if (userEmail && tid) {
      await pool.query('INSERT INTO ent_music_play_history (tenant_id,track_id,user_email) VALUES ($1,$2,$3)', [tid, track.id, userEmail]);
    }

    // Mini player session
    req.session.miniPlayer = { trackId: track.id, title: track.title, artist: track.artist, audioUrl: track.audio_url, coverUrl: track.cover_url, duration: track.duration };

    // Album tracks
    const albumTracks = track.album_id ? (await pool.query('SELECT * FROM ent_music_tracks WHERE album_id=$1 ORDER BY id', [track.album_id])).rows : [];

    // Check like
    let liked = false;
    if (userEmail && tid) {
      liked = !!(await pool.query('SELECT id FROM ent_music_likes WHERE tenant_id=$1 AND track_id=$2 AND user_email=$3', [tid, track.id, userEmail])).rows.length;
    }

    // Playlists for add-to-playlist
    const playlists = (userEmail && tid) ? (await pool.query('SELECT id,name FROM ent_music_playlists WHERE tenant_id=$1 AND created_by=$2 ORDER BY name', [tid, userEmail])).rows : [];

    // Lyrics
    const lyricsLines = track.lyrics ? track.lyrics.split('\n').filter(l => l.trim()) : [];

    let html = nav(BASE);
    html += `<a href="${BASE}" style="color:${GRAY};font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Music Home</a>`;

    html += `<div style="display:grid;grid-template-columns:1fr 320px;gap:24px">
      <div>
        <!-- Player -->
        <div class="mus-player-wrap" style="padding:28px;margin-bottom:20px">
          <div style="display:flex;gap:24px;align-items:center;margin-bottom:24px">
            <img src="${esc(track.cover_url||'')}" onerror="this.style.display='none'" style="width:160px;height:160px;border-radius:14px;object-fit:cover;box-shadow:0 8px 32px rgba(0,0,0,.3);flex-shrink:0">
            <div>
              <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#aaa;margin-bottom:6px">Now Playing</div>
              <h1 style="font-size:24px;margin:0 0 6px">${esc(track.title)}</h1>
              <p style="font-size:15px;color:#bbb;margin:0 0 4px">${esc(track.artist||'Unknown Artist')}</p>
              <p style="font-size:12px;color:#888">${esc(track.genre||'')} ${track.album_name ? '· '+esc(track.album_name) : ''} ${track.is_explicit ? '· <span style="background:#fff;color:#000;padding:1px 4px;border-radius:3px;font-size:10px;font-weight:700">E</span>' : ''}</p>
            </div>
          </div>

          <!-- Audio element -->
          ${track.audio_url ? `<audio id="mainAudio" src="${esc(track.audio_url)}" preload="metadata" style="width:100%;margin-bottom:12px;border-radius:8px"></audio>` : ''}

          <!-- Progress bar -->
          <div style="margin-bottom:8px">
            <input type="range" id="seekBar" min="0" max="100" value="0" step="0.1" style="width:100%;accent-color:${PINK}">
            <div style="display:flex;justify-content:space-between;font-size:11px;color:#888;margin-top:4px">
              <span id="curTime">0:00</span><span id="totTime">${fmtDur(track.duration)}</span></div>
          </div>

          <!-- Controls -->
          <div style="display:flex;align-items:center;justify-content:center;gap:20px;margin-bottom:16px">
            <button onclick="document.getElementById('mainAudio').play()" style="background:none;border:none;color:#fff;cursor:pointer;font-size:32px">▶️</button>
            <button onclick="document.getElementById('mainAudio').pause()" style="background:none;border:none;color:#fff;cursor:pointer;font-size:32px">⏸</button>
            <button id="shuffleBtn" onclick="this.classList.toggle('active')" style="background:none;border:none;color:#888;cursor:pointer;font-size:20px" title="Shuffle">🔀</button>
            <button id="repeatBtn" onclick="toggleRepeat()" style="background:none;border:none;color:#888;cursor:pointer;font-size:20px" title="Repeat">🔁</button>
          </div>

          <!-- Volume -->
          <div style="display:flex;align-items:center;gap:10px;justify-content:center">
            <span style="color:#888;font-size:14px">🔈</span>
            <input type="range" id="volSlider" min="0" max="1" step="0.01" value="0.8" style="width:120px;accent-color:${P}">
            <span style="color:#888;font-size:14px">🔊</span>
          </div>

          <!-- Like & Add to Playlist -->
          <div style="display:flex;gap:10px;margin-top:16px;justify-content:center;flex-wrap:wrap">
            <form method="post" action="${BASE}/${track.id}/like"><button class="btn" style="background:${liked?'#fde68a':'rgba(255,255,255,.15)'};color:${liked?'#92400e':'#fff'};border:1px solid rgba(255,255,255,.2)">${liked?'💖 Liked':'🤍 Like'}</button></form>
            ${playlists.length ? `<select id="playlistSelect" style="padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:#333;color:#fff;font-size:13px"><option value="">+ Add to Playlist</option>${playlists.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>
            <button onclick="addToPlaylist(${track.id})" class="btn" style="background:rgba(255,255,255,.15);color:#fff;border:1px solid rgba(255,255,255,.2)">Add</button>` : ''}
            <a href="${BASE}/${track.id}/share" class="btn" style="background:rgba(255,255,255,.15);color:#fff;border:1px solid rgba(255,255,255,.2);text-decoration:none">🔗 Share</a>
          </div>
        </div>

        <!-- Lyrics -->
        ${lyricsLines.length ? `<div class="card" style="margin-bottom:20px">
          <h3 style="font-size:16px;margin-bottom:12px">📝 Lyrics</h3>
          <div class="mus-lyrics" id="lyricsBox">${lyricsLines.map((l,i) => `<div class="lyric-line" data-index="${i}">${esc(l)}</div>`).join('')}</div>
        </div>` : ''}

        <!-- Album Tracks -->
        ${albumTracks.length > 1 ? `<div class="card"><h3 style="font-size:16px;margin-bottom:12px">💿 More from ${esc(track.album_name||'Album')}</h3><table class="mus-table"><thead><tr><th>#</th><th>Title</th><th>Duration</th><th></th></tr></thead><tbody>${albumTracks.map((at,i) => `<tr style="${at.id===track.id?'background:rgba(124,58,237,.06)':''}"><td>${i+1}</td><td>${at.id===track.id?'<strong style="color:'+P+'">'+esc(at.title)+' ▶</strong>':esc(at.title)}</td><td>${fmtDur(at.duration)}</td><td><a href="${BASE}/${at.id}/play">▶</a></td></tr>`).join('')}</tbody></table></div>` : ''}
      </div>

      <!-- Sidebar: Up Next Queue -->
      <div>
        <div class="card" style="position:sticky;top:20px">
          <h3 style="font-size:16px;margin-bottom:12px">⏭ Up Next</h3>
          ${albumTracks.length > 1 ? albumTracks.filter(t => t.id !== track.id).slice(0,5).map(t => `<div class="mus-queue-item" onclick="location.href='${BASE}/${t.id}/play'">
            <img src="${esc(t.cover_url||'')}" onerror="this.style.display='none'" style="width:44px;height:44px;border-radius:8px;object-fit:cover">
            <div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(t.title)}</div><div style="font-size:11px;color:${GRAY}">${esc(t.artist||'')} · ${fmtDur(t.duration)}</div></div>
            <span style="color:${P};font-size:16px">▶</span></div>`).join('') : '<p style="color:'+GRAY+';font-size:13px">Play from an album to see queue</p>'}
        </div>
      </div>
    </div>`;

    // JS for player
    html += `<script>
      const audio=document.getElementById('mainAudio');
      const seek=document.getElementById('seekBar');
      const vol=document.getElementById('volSlider');
      const curTime=document.getElementById('curTime');
      const totTime=document.getElementById('totTime');
      let repeatMode=0;
      if(audio){
        audio.volume=0.8;
        vol.oninput=()=>audio.volume=parseFloat(vol.value);
        audio.ontimeupdate=()=>{if(audio.duration){seek.value=(audio.currentTime/audio.duration)*100;const m=Math.floor(audio.currentTime/60);curTime.textContent=m+':'+String(Math.floor(audio.currentTime%60)).padStart(2,'0');syncLyrics(audio.currentTime);}};
        seek.oninput=()=>{if(audio.duration)audio.currentTime=(seek.value/100)*audio.duration;};
        audio.onended=()=>{if(repeatMode===2){audio.currentTime=0;audio.play();}else if(repeatMode===1){audio.currentTime=0;audio.play();}};
        function toggleRepeat(){repeatMode=(repeatMode+1)%3;const btn=document.getElementById('repeatBtn');btn.textContent=repeatMode===0?'🔁':repeatMode===1?'🔂':'🔁 1';btn.style.color=repeatMode>0?'${PINK}':'#888';}
      }
      function syncLyrics(time){
        const lines=document.querySelectorAll('.lyric-line');if(!lines.length)return;
        const activeTime=time*2;
        lines.forEach((l,i)=>{l.classList.toggle('active-line',i===Math.floor(activeTime));});
      }
      function addToPlaylist(trackId){
        const sel=document.getElementById('playlistSelect');if(!sel||!sel.value)return;
        fetch('${BASE}/playlists/'+sel.value+'/add',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({track_id:trackId})}).then(r=>r.json()).then(d=>{if(d.success)alert('Added to playlist!');}).catch(()=>alert('Error adding to playlist'));
      }
    </script>`;

    res.send(page(track.title + ' — ' + (track.artist||''), html, req));
  }));

  // POST like track
  app.post(BASE+'/:id/like', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const email = req.session.user.email;
    const existing = (await pool.query('SELECT id FROM ent_music_likes WHERE tenant_id=$1 AND track_id=$2 AND user_email=$3', [tid, req.params.id, email])).rows[0];
    if (existing) {
      await pool.query('DELETE FROM ent_music_likes WHERE id=$1', [existing.id]);
      await pool.query('UPDATE ent_music_tracks SET likes = GREATEST(likes - 1, 0) WHERE id=$1', [req.params.id]);
    } else {
      await pool.query('INSERT INTO ent_music_likes (tenant_id,track_id,user_email) VALUES ($1,$2,$3)', [tid, req.params.id, email]);
      await pool.query('UPDATE ent_music_tracks SET likes = likes + 1 WHERE id=$1', [req.params.id]);
    }
    res.redirect('back');
  }));

  // ────────────────────────────────────────────────────────────
  // 4. ALBUM & ARTIST PAGES
  // ────────────────────────────────────────────────────────────
  app.get(BASE+'/albums/:id', ah(async (req, res) => {
    const album = (await pool.query('SELECT * FROM ent_music_albums WHERE id=$1', [req.params.id])).rows[0];
    if (!album) return res.status(404).send(page('Not Found', '<div class="card" style="text-align:center;padding:48px"><h2 style="color:#dc2626">Album not found</h2></div>', req));
    const tracks = (await pool.query('SELECT * FROM ent_music_tracks WHERE album_id=$1 ORDER BY id', [album.id])).rows;
    const totalDur = tracks.reduce((s,t) => s + (t.duration||0), 0);

    let html = nav(BASE);
    html += `<a href="${BASE}" style="color:${GRAY};font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Home</a>`;
    html += `<div style="display:flex;gap:24px;align-items:flex-end;margin-bottom:24px;flex-wrap:wrap">
      <img src="${esc(album.cover_url||'')}" onerror="this.style.display='none'" style="width:200px;height:200px;border-radius:14px;object-fit:cover;box-shadow:0 8px 32px rgba(0,0,0,.12)">
      <div><h1 style="font-size:28px;color:#1e293b;margin:0 0 4px">${esc(album.name)}</h1>
        <p style="font-size:15px;color:${GRAY};margin:0 0 8px">${esc(album.artist||'Various Artists')}</p>
        <p style="font-size:13px;color:#94a3b8">${esc(album.genre||'')} · ${tracks.length} tracks · ${fmtDur(totalDur)} · ${album.release_date ? fmtDate(album.release_date) : ''}</p>
        ${tracks.length ? `<a href="${BASE}/${tracks[0].id}/play" class="btn" style="background:${P};color:#fff;margin-top:12px">▶ Play All</a>` : ''}
      </div></div>`;
    if (album.description) html += `<p style="font-size:14px;color:#475569;line-height:1.7;margin-bottom:20px">${esc(album.description)}</p>`;
    html += '<div class="card"><table class="mus-table"><thead><tr><th>#</th><th>Title</th><th>Artist</th><th>Duration</th><th>Plays</th><th></th></tr></thead><tbody>';
    tracks.forEach((t,i) => {
      html += `<tr><td>${i+1}</td><td>${esc(t.title)} ${t.is_explicit?'<span style="background:#1e293b;color:#fff;font-size:9px;padding:1px 4px;border-radius:3px;font-weight:700">E</span>':''}</td><td style="color:${GRAY}">${esc(t.artist||'')}</td><td>${fmtDur(t.duration)}</td><td>${t.play_count||0}</td><td><a href="${BASE}/${t.id}/play" style="color:${P};font-weight:600">▶</a></td></tr>`;
    });
    html += '</tbody></table></div>';
    res.send(page(album.name, html, req));
  }));

  app.get(BASE+'/artists/:name', ah(async (req, res) => {
    const artistName = decodeURIComponent(req.params.name);
    const tracks = (await pool.query("SELECT * FROM ent_music_tracks WHERE artist ILIKE $1 ORDER BY created_at DESC", [artistName])).rows;
    const albums = (await pool.query("SELECT DISTINCT a.* FROM ent_music_albums a JOIN ent_music_tracks t ON t.album_id=a.id WHERE t.artist ILIKE $1 ORDER BY a.release_date DESC", [artistName])).rows;
    const totalPlays = tracks.reduce((s,t) => s + (t.play_count||0), 0);
    const topTracks = [...tracks].sort((a,b) => (b.play_count||0) - (a.play_count||0)).slice(0,5);

    let html = nav(BASE);
    html += `<a href="${BASE}" style="color:${GRAY};font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Home</a>`;
    html += `<div class="mus-hero" style="text-align:center">
      <div style="width:120px;height:120px;border-radius:60px;background:linear-gradient(135deg,#c4b5fd,#f9a8d4);margin:0 auto 16px;display:flex;align-items:center;justify-content:center;font-size:48px;color:#fff">${esc(artistName.charAt(0).toUpperCase())}</div>
      <h1>${esc(artistName)}</h1>
      <p>${tracks.length} tracks · ${albums.length} albums · ${totalPlays} plays</p>
    </div>`;

    html += '<h2 style="font-size:18px;margin-bottom:14px">🔥 Top Tracks</h2>';
    html += '<div style="display:grid;gap:8px;margin-bottom:24px">';
    topTracks.forEach((t,i) => {
      html += `<div class="mus-queue-item" style="padding:12px;border-radius:10px;border:1px solid #e2e8f0" onclick="location.href='${BASE}/${t.id}/play'">
        <span style="width:28px;text-align:center;font-weight:700;color:${P}">${i+1}</span>
        <div style="flex:1"><div style="font-weight:600;font-size:14px">${esc(t.title)}</div><div style="font-size:12px;color:${GRAY}">${esc(t.genre||'')} · ${fmtDur(t.duration)}</div></div>
        <span style="font-size:12px;color:${GRAY}">${t.play_count||0} plays</span></div>`;
    });
    html += '</div>';

    html += '<h2 style="font-size:18px;margin-bottom:14px">💿 Discography</h2>';
    html += '<div class="mus-grid">';
    albums.forEach(a => {
      html += `<div class="mus-card" onclick="location.href='${BASE}/albums/${a.id}'">
        <div class="mus-card-img">${a.cover_url ? `<img src="${esc(a.cover_url)}" loading="lazy">` : '<div class="ph">💿</div>'}</div>
        <div class="mus-card-body"><div class="mus-card-title">${esc(a.name)}</div><div class="mus-card-sub">${a.release_date ? fmtDate(a.release_date) : ''}</div></div></div>`;
    });
    html += '</div>';

    html += '<h2 style="font-size:18px;margin:24px 0 14px">🎵 All Tracks</h2>';
    html += '<div class="card"><table class="mus-table"><thead><tr><th>#</th><th>Title</th><th>Album</th><th>Duration</th><th></th></tr></thead><tbody>';
    tracks.forEach((t,i) => {
      html += `<tr><td>${i+1}</td><td>${esc(t.title)}</td><td style="color:${GRAY}">${t.album_id ? `<a href="${BASE}/albums/${t.album_id}" style="color:${P}">View Album</a>` : '—'}</td><td>${fmtDur(t.duration)}</td><td><a href="${BASE}/${t.id}/play">▶</a></td></tr>`;
    });
    html += '</tbody></table></div>';

    res.send(page(artistName, html, req));
  }));

  // ────────────────────────────────────────────────────────────
  // 5. PLAYLISTS
  // ────────────────────────────────────────────────────────────
  app.get(BASE+'/playlists', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const playlists = (await pool.query('SELECT p.*, (SELECT COUNT(*)::int FROM ent_music_playlist_tracks pt WHERE pt.playlist_id=p.id) as track_count FROM ent_music_playlists p WHERE p.tenant_id=$1 ORDER BY p.created_at DESC', [tid])).rows;
    let html = nav(BASE+'/playlists');
    html += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
      <h1 style="font-size:24px">📋 My Playlists</h1>
      <a href="${BASE}/playlists/create" class="btn" style="background:${P};color:#fff">+ Create Playlist</a></div>`;
    if (!playlists.length) {
      html += '<div class="card" style="text-align:center;padding:48px"><p style="color:'+GRAY+'">No playlists yet. Create one!</p></div>';
    } else {
      html += '<div class="mus-grid">';
      playlists.forEach(p => {
        html += `<div class="mus-card" onclick="location.href='${BASE}/playlists/${p.id}'">
          <div class="mus-card-img" style="height:140px;background:linear-gradient(135deg,#ede9fe,#fce7f3)">${p.cover_url ? `<img src="${esc(p.cover_url)}" loading="lazy">` : '<div class="ph">📋</div>'}</div>
          <div class="mus-card-body"><div class="mus-card-title">${esc(p.name)}</div><div class="mus-card-sub">${p.track_count} tracks ${p.is_collaborative?'· 👥 Collaborative':''}</div></div></div>`;
      });
      html += '</div>';
    }
    res.send(page('Playlists', html, req));
  }));

  app.get(BASE+'/playlists/create', requireAuth, ah(async (req, res) => {
    let html = nav(BASE+'/playlists');
    html += `<h1 style="font-size:24px;margin-bottom:20px">➕ Create Playlist</h1>
    <div class="card" style="padding:28px"><form method="post" action="${BASE}/playlists/create" class="mus-form">
      <div style="display:grid;gap:16px;max-width:500px">
        <div><label>Name *</label><input name="name" required placeholder="My Playlist"></div>
        <div><label>Description</label><textarea name="description" rows="3" placeholder="What's this playlist about?"></textarea></div>
        <div><label>Cover Image URL</label><input name="cover_url" type="url" placeholder="https://..."></div>
        <label style="display:flex;align-items:center;gap:8px;font-size:13px"><input type="checkbox" name="is_public" checked> Public</label>
        <label style="display:flex;align-items:center;gap:8px;font-size:13px"><input type="checkbox" name="is_collaborative"> Collaborative (others can add tracks)</label>
        <div style="display:flex;gap:12px"><button type="submit" class="btn" style="background:${P};color:#fff">Create Playlist</button><a href="${BASE}/playlists" class="btn" style="background:#f1f5f9;color:#475569">Cancel</a></div>
      </div></form></div>`;
    res.send(page('Create Playlist', html, req));
  }));

  app.post(BASE+'/playlists/create', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { name, description, cover_url, is_public, is_collaborative } = req.body;
    if (!name) return res.redirect(BASE + '/playlists/create');
    await pool.query(
      'INSERT INTO ent_music_playlists (tenant_id,name,description,cover_url,is_public,is_collaborative,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [tid, name, description, cover_url, is_public!=='on', is_collaborative==='on', req.session.user.email]
    );
    res.redirect(BASE + '/playlists');
  }));

  app.get(BASE+'/playlists/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const playlist = (await pool.query('SELECT * FROM ent_music_playlists WHERE id=$1 AND tenant_id=$2', [req.params.id, tid])).rows[0];
    if (!playlist) return res.status(404).send(page('Not Found', '<div class="card" style="text-align:center;padding:48px"><h2 style="color:#dc2626">Playlist not found</h2></div>', req));
    const tracks = (await pool.query('SELECT t.* FROM ent_music_tracks t JOIN ent_music_playlist_tracks pt ON pt.track_id=t.id WHERE pt.playlist_id=$1 ORDER BY pt.position, pt.added_at', [playlist.id])).rows;
    const totalDur = tracks.reduce((s,t) => s + (t.duration||0), 0);

    let html = nav(BASE+'/playlists');
    html += `<a href="${BASE}/playlists" style="color:${GRAY};font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Playlists</a>`;
    html += `<div style="display:flex;gap:20px;align-items:flex-end;margin-bottom:24px;flex-wrap:wrap">
      <img src="${esc(playlist.cover_url||'')}" onerror="this.style.display='none'" style="width:160px;height:160px;border-radius:14px;object-fit:cover;box-shadow:0 8px 32px rgba(0,0,0,.12)">
      <div><h1 style="font-size:26px;margin:0 0 4px">${esc(playlist.name)}</h1>
        <p style="font-size:13px;color:${GRAY};margin:0 0 8px">${esc(playlist.description||'')} ${playlist.is_collaborative?'· 👥 Collaborative':''}</p>
        <p style="font-size:12px;color:#94a3b8">${tracks.length} tracks · ${fmtDur(totalDur)}</p>
        ${tracks.length ? `<a href="${BASE}/${tracks[0].id}/play" class="btn" style="background:${P};color:#fff;margin-top:10px">▶ Play All</a>` : ''}
      </div></div>`;

    // Add track form
    html += `<div class="card" style="margin-bottom:20px;padding:16px"><form method="post" action="${BASE}/playlists/${playlist.id}/add" style="display:flex;gap:10px;align-items:end;flex-wrap:wrap">
      <div style="flex:1;min-width:200px"><label style="font-size:12px;font-weight:600;color:#64748b">Track ID to add</label><input name="track_id" type="number" required placeholder="Enter track ID" style="width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px"></div>
      <button type="submit" class="btn" style="background:${P};color:#fff">+ Add</button>
    </form></div>`;

    // Track list with reorder buttons
    html += '<div class="card"><table class="mus-table"><thead><tr><th>#</th><th>Title</th><th>Artist</th><th>Duration</th><th>Actions</th></tr></thead><tbody>';
    tracks.forEach((t,i) => {
      html += `<tr>
        <td style="font-weight:700;color:${P}">${i+1}</td>
        <td><a href="${BASE}/${t.id}/play" style="color:${P};font-weight:600;text-decoration:none">${esc(t.title)}</a></td>
        <td style="color:${GRAY}">${esc(t.artist||'')}</td>
        <td>${fmtDur(t.duration)}</td>
        <td style="white-space:nowrap">
          <form method="post" action="${BASE}/playlists/${playlist.id}/move" style="display:inline"><input type="hidden" name="track_id" value="${t.id}"><input type="hidden" name="direction" value="up"><button class="btn" style="padding:4px 8px;font-size:12px;background:#f1f5f9;color:#475569" ${i===0?'disabled':''}>▲</button></form>
          <form method="post" action="${BASE}/playlists/${playlist.id}/move" style="display:inline"><input type="hidden" name="track_id" value="${t.id}"><input type="hidden" name="direction" value="down"><button class="btn" style="padding:4px 8px;font-size:12px;background:#f1f5f9;color:#475569" ${i===tracks.length-1?'disabled':''}>▼</button></form>
          <form method="post" action="${BASE}/playlists/${playlist.id}/remove" style="display:inline" onsubmit="return confirm('Remove this track?')"><input type="hidden" name="track_id" value="${t.id}"><button class="btn" style="padding:4px 8px;font-size:12px;background:#fef2f2;color:#dc2626">✕</button></form>
        </td></tr>`;
    });
    if (!tracks.length) html += '<tr><td colspan="5" style="text-align:center;color:'+GRAY+';padding:24px">No tracks yet. Add some!</td></tr>';
    html += '</tbody></table></div>';

    // Delete playlist
    html += `<div style="margin-top:16px"><form method="post" action="${BASE}/playlists/${playlist.id}/delete" onsubmit="return confirm('Delete this playlist?')"><button class="btn" style="background:#fef2f2;color:#dc2626">🗑 Delete Playlist</button></form></div>`;

    res.send(page(playlist.name, html, req));
  }));

  // POST add track to playlist (form)
  app.post(BASE+'/playlists/:id/add', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { track_id } = req.body;
    const playlist = (await pool.query('SELECT * FROM ent_music_playlists WHERE id=$1 AND tenant_id=$2', [req.params.id, tid])).rows[0];
    if (!playlist || !track_id) return res.redirect(BASE + '/playlists/' + req.params.id);
    const maxPos = (await pool.query('SELECT COALESCE(MAX(position),0)+1 as np FROM ent_music_playlist_tracks WHERE playlist_id=$1', [req.params.id])).rows[0].np;
    await pool.query('INSERT INTO ent_music_playlist_tracks (playlist_id,track_id,position) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [req.params.id, track_id, maxPos]);
    res.redirect(BASE + '/playlists/' + req.params.id);
  }));

  // POST add track to playlist (JSON API)
  app.post(BASE+'/playlists/:id/add', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    if (req.is('json') || req.headers['content-type'] === 'application/json') {
      const { track_id } = req.body;
      if (!track_id) return res.json({ success: false });
      const playlist = (await pool.query('SELECT * FROM ent_music_playlists WHERE id=$1 AND tenant_id=$2', [req.params.id, tid])).rows[0];
      if (!playlist) return res.json({ success: false, error: 'Not found' });
      const maxPos = (await pool.query('SELECT COALESCE(MAX(position),0)+1 as np FROM ent_music_playlist_tracks WHERE playlist_id=$1', [req.params.id])).rows[0].np;
      await pool.query('INSERT INTO ent_music_playlist_tracks (playlist_id,track_id,position) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [req.params.id, track_id, maxPos]);
      return res.json({ success: true });
    }
    // fall through to form handler above
  }));

  app.post(BASE+'/playlists/:id/remove', requireAuth, ah(async (req, res) => {
    await pool.query('DELETE FROM ent_music_playlist_tracks WHERE playlist_id=$1 AND track_id=$2', [req.params.id, req.body.track_id]);
    res.redirect(BASE + '/playlists/' + req.params.id);
  }));

  app.post(BASE+'/playlists/:id/move', requireAuth, ah(async (req, res) => {
    const { track_id, direction } = req.body;
    const plId = parseInt(req.params.id);
    const tid = req.session.user.tenant_id;
    const current = (await pool.query('SELECT position FROM ent_music_playlist_tracks WHERE playlist_id=$1 AND track_id=$2', [plId, track_id])).rows[0];
    if (!current) return res.redirect(BASE + '/playlists/' + plId);
    const newPos = direction === 'up' ? current.position - 1 : current.position + 1;
    if (newPos < 1) return res.redirect(BASE + '/playlists/' + plId);
    const neighbor = (await pool.query('SELECT track_id FROM ent_music_playlist_tracks WHERE playlist_id=$1 AND position=$2', [plId, newPos])).rows[0];
    if (neighbor) {
      await pool.query('UPDATE ent_music_playlist_tracks SET position=$1 WHERE playlist_id=$2 AND track_id=$3', [current.position, plId, neighbor.track_id]);
      await pool.query('UPDATE ent_music_playlist_tracks SET position=$1 WHERE playlist_id=$2 AND track_id=$3', [newPos, plId, track_id]);
    }
    res.redirect(BASE + '/playlists/' + plId);
  }));

  app.post(BASE+'/playlists/:id/delete', requireAuth, ah(async (req, res) => {
    await pool.query('DELETE FROM ent_music_playlists WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
    res.redirect(BASE + '/playlists');
  }));

  // ────────────────────────────────────────────────────────────
  // 6. MUSIC SEARCH
  // ────────────────────────────────────────────────────────────
  app.get(BASE+'/search', ah(async (req, res) => {
    const tid = req.session?.user?.tenant_id;
    const q = (req.query.q || '').trim();
    const genre = req.query.genre || '';
    const mood = req.query.mood || '';
    let where = ['1=1'];
    const params = [];
    let pi = 1;
    if (tid) { where.push(`t.tenant_id=$${pi++}`); params.push(tid); }
    if (q) { where.push(`(t.title ILIKE $${pi} OR t.artist ILIKE $${pi} OR t.genre ILIKE $${pi})`); params.push(`%${q}%`); pi++; }
    if (genre) { where.push(`t.genre=$${pi++}`); params.push(genre); }
    if (mood) { where.push(`t.mood=$${pi++}`); params.push(mood); }

    const tracks = (await pool.query(`SELECT t.* FROM ent_music_tracks t WHERE ${where.join(' AND ')} ORDER BY t.play_count DESC LIMIT 100`, params)).rows;
    const albums = (await pool.query(`SELECT DISTINCT a.* FROM ent_music_albums a JOIN ent_music_tracks t ON t.album_id=a.id WHERE ${where.join(' AND ').replace(/t\./g,'t.')} ORDER BY a.name LIMIT 50`, params)).rows;
    const artists = (await pool.query(`SELECT DISTINCT artist FROM ent_music_tracks WHERE tenant_id=$1 AND artist IS NOT NULL AND artist != '' ${q ? 'AND artist ILIKE $2' : ''} ORDER BY artist LIMIT 30`, q ? [tid||0, `%${q}%`] : [tid||0])).rows;

    let html = nav(BASE+'/search');
    html += `<h1 style="font-size:24px;margin-bottom:20px">🔍 Search Music</h1>`;
    html += `<form method="get" action="${BASE}/search" style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap">
      <input name="q" value="${esc(q)}" placeholder="Search tracks, artists, albums..." style="flex:1;min-width:200px;padding:10px 16px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px">
      <select name="genre" style="padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"><option value="">All Genres</option>${GENRES.map(g => `<option value="${esc(g)}" ${genre===g?'selected':''}>${esc(g)}</option>`).join('')}</select>
      <select name="mood" style="padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"><option value="">All Moods</option>${MOODS.map(m => `<option value="${esc(m)}" ${mood===m?'selected':''}>${esc(m)}</option>`).join('')}</select>
      <button type="submit" class="btn" style="background:${P};color:#fff">Search</button>
      ${(q||genre||mood) ? `<a href="${BASE}/search" class="btn" style="background:#f1f5f9;color:#475569">Clear</a>` : ''}
    </form>`;

    if (artists.length) {
      html += '<h3 style="margin-bottom:10px">🎤 Artists</h3>';
      html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px">';
      artists.forEach(a => { html += `<a href="${BASE}/artists/${encodeURIComponent(a.artist)}" class="mus-pill" style="background:#ede9fe;color:${P}">${esc(a.artist)}</a>`; });
      html += '</div>';
    }
    if (albums.length) {
      html += '<h3 style="margin-bottom:10px">💿 Albums</h3>';
      html += '<div class="mus-scroll-row" style="margin-bottom:20px">';
      albums.forEach(a => { html += `<div class="mus-card" onclick="location.href='${BASE}/albums/${a.id}'"><div class="mus-card-img">${a.cover_url ? `<img src="${esc(a.cover_url)}" loading="lazy">` : '<div class="ph">💿</div>'}</div><div class="mus-card-body"><div class="mus-card-title">${esc(a.name)}</div><div class="mus-card-sub">${esc(a.artist||'')}</div></div></div>`; });
      html += '</div>';
    }
    html += `<h3 style="margin-bottom:10px">🎵 Tracks (${tracks.length})</h3>`;
    if (tracks.length) {
      html += '<div class="card"><table class="mus-table"><thead><tr><th>Title</th><th>Artist</th><th>Genre</th><th>Duration</th><th>Plays</th><th></th></tr></thead><tbody>';
      tracks.forEach(t => { html += `<tr><td>${esc(t.title)}</td><td><a href="${BASE}/artists/${encodeURIComponent(t.artist||'')}" style="color:${P}">${esc(t.artist||'')}</a></td><td style="color:${GRAY}">${esc(t.genre||'')}</td><td>${fmtDur(t.duration)}</td><td>${t.play_count||0}</td><td><a href="${BASE}/${t.id}/play">▶</a></td></tr>`; });
      html += '</tbody></table></div>';
    } else {
      html += '<div class="card" style="text-align:center;padding:36px"><p style="color:'+GRAY+'">No tracks found matching your search.</p></div>';
    }
    res.send(page('Search', html, req));
  }));

  // ────────────────────────────────────────────────────────────
  // 7. LYRICS DISPLAY (integrated in player — see feature 3)
  // ────────────────────────────────────────────────────────────

  // ────────────────────────────────────────────────────────────
  // 8. RADIO STATIONS
  // ────────────────────────────────────────────────────────────
  app.get(BASE+'/radio', ah(async (req, res) => {
    const tid = req.session?.user?.tenant_id;
    let html = nav(BASE+'/radio');
    html += `<div class="mus-hero" style="text-align:center"><h1>📻 Radio Stations</h1><p>Auto-play stations matching your mood and genre</p></div>`;
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px;margin-bottom:28px">';
    for (const station of RADIO_STATIONS) {
      const trackCount = (await pool.query(
        "SELECT COUNT(*)::int as c FROM ent_music_tracks WHERE tenant_id=$1 AND ($2::text IS NULL OR genre=$2) AND ($3::text IS NULL OR mood=$3)",
        [tid||0, station.genre, station.mood]
      )).rows[0].c;
      const sampleTrack = (await pool.query(
        "SELECT id, title, artist, cover_url, audio_url FROM ent_music_tracks WHERE tenant_id=$1 AND ($2::text IS NULL OR genre=$2) AND ($3::text IS NULL OR mood=$3) ORDER BY play_count DESC LIMIT 1",
        [tid||0, station.genre, station.mood]
      )).rows[0];
      html += `<div class="card" style="border-top:4px solid ${station.color}">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
          <div style="width:52px;height:52px;border-radius:14px;background:${station.color};display:flex;align-items:center;justify-content:center;font-size:24px;color:#fff">${station.icon}</div>
          <div><h3 style="font-size:16px;margin:0">${esc(station.name)}</h3><p style="font-size:12px;color:${GRAY};margin:0">${trackCount} tracks</p></div></div>
        ${sampleTrack ? `<p style="font-size:12px;color:${GRAY};margin-bottom:10px">Now featuring: <strong>${esc(sampleTrack.title)}</strong> — ${esc(sampleTrack.artist||'')}</p>
          <a href="${BASE}/${sampleTrack.id}/play" class="btn" style="background:${station.color};color:#fff;width:100%;text-align:center">▶ Play Station</a>` : `<p style="font-size:12px;color:${GRAY}">No matching tracks yet</p>`}
      </div>`;
    }
    html += '</div>';
    res.send(page('Radio', html, req));
  }));

  // ────────────────────────────────────────────────────────────
  // 9. PODCASTS
  // ────────────────────────────────────────────────────────────
  app.get(BASE+'/podcasts', ah(async (req, res) => {
    const tid = req.session?.user?.tenant_id;
    const podcasts = (await pool.query('SELECT p.*, (SELECT COUNT(*)::int FROM ent_music_podcast_episodes pe WHERE pe.podcast_id=p.id) as ep_count FROM ent_music_podcasts p WHERE p.tenant_id=$1 ORDER BY p.created_at DESC', [tid||0])).rows;
    let html = nav(BASE+'/podcasts');
    html += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px">
      <h1 style="font-size:24px">🎙 Podcasts</h1>
      ${req.session?.user ? `<a href="${BASE}/podcasts/new" class="btn" style="background:${PINK};color:#fff">+ New Podcast</a>` : ''}</div>`;
    if (!podcasts.length) {
      html += '<div class="card" style="text-align:center;padding:48px"><p style="color:'+GRAY+'">No podcasts yet.</p></div>';
    } else {
      html += '<div class="mus-grid">';
      podcasts.forEach(p => {
        html += `<div class="mus-card" onclick="location.href='${BASE}/podcasts/${p.id}'">
          <div class="mus-card-img" style="height:200px;background:linear-gradient(135deg,#fce7f3,#fbcfe8)">${p.cover_url ? `<img src="${esc(p.cover_url)}" loading="lazy">` : '<div class="ph" style="color:#ec4899">🎙</div>'}
            <span style="position:absolute;top:10px;left:10px;background:${PINK};color:#fff;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700">${p.ep_count} eps</span></div>
          <div class="mus-card-body"><div class="mus-card-title">${esc(p.title)}</div><div class="mus-card-sub">${esc(p.artist||'')} ${p.rss_url ? '· 📡 RSS' : ''}</div></div></div>`;
      });
      html += '</div>';
    }
    res.send(page('Podcasts', html, req));
  }));

  app.get(BASE+'/podcasts/new', requireAuth, ah(async (req, res) => {
    let html = nav(BASE+'/podcasts');
    html += `<h1 style="font-size:24px;margin-bottom:20px">🎙 New Podcast</h1>
    <div class="card" style="padding:28px"><form method="post" action="${BASE}/podcasts/new" class="mus-form">
      <div style="display:grid;gap:16px;max-width:500px">
        <div><label>Title *</label><input name="title" required placeholder="Podcast name"></div>
        <div><label>Host / Artist</label><input name="artist" placeholder="Host name"></div>
        <div><label>Description</label><textarea name="description" rows="3" placeholder="What's this about?"></textarea></div>
        <div><label>Cover URL</label><input name="cover_url" type="url" placeholder="https://..."></div>
        <div><label>RSS Feed URL</label><input name="rss_url" type="url" placeholder="https://..."></div>
        <div style="display:flex;gap:12px"><button type="submit" class="btn" style="background:${PINK};color:#fff">Create Podcast</button><a href="${BASE}/podcasts" class="btn" style="background:#f1f5f9;color:#475569">Cancel</a></div>
      </div></form></div>`;
    res.send(page('New Podcast', html, req));
  }));

  app.post(BASE+'/podcasts/new', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { title, artist, description, cover_url, rss_url } = req.body;
    if (!title) return res.redirect(BASE + '/podcasts/new');
    await pool.query('INSERT INTO ent_music_podcasts (tenant_id,title,artist,description,cover_url,rss_url) VALUES ($1,$2,$3,$4,$5,$6)', [tid, title, artist, description, cover_url, rss_url]);
    res.redirect(BASE + '/podcasts');
  }));

  app.get(BASE+'/podcasts/:id', ah(async (req, res) => {
    const podcast = (await pool.query('SELECT * FROM ent_music_podcasts WHERE id=$1', [req.params.id])).rows[0];
    if (!podcast) return res.status(404).send(page('Not Found', '<div class="card" style="text-align:center;padding:48px"><h2 style="color:#dc2626">Podcast not found</h2></div>', req));
    const episodes = (await pool.query('SELECT * FROM ent_music_podcast_episodes WHERE podcast_id=$1 ORDER BY episode_number DESC', [podcast.id])).rows;

    let html = nav(BASE+'/podcasts');
    html += `<a href="${BASE}/podcasts" style="color:${GRAY};font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Podcasts</a>`;
    html += `<div style="display:flex;gap:20px;align-items:flex-start;margin-bottom:24px;flex-wrap:wrap">
      <img src="${esc(podcast.cover_url||'')}" onerror="this.style.display='none'" style="width:160px;height:160px;border-radius:14px;object-fit:cover;box-shadow:0 8px 32px rgba(0,0,0,.12)">
      <div><h1 style="font-size:26px;margin:0 0 4px">${esc(podcast.title)}</h1>
        <p style="font-size:14px;color:${GRAY};margin:0 0 8px">by ${esc(podcast.artist||'Unknown')}</p>
        ${podcast.description ? `<p style="font-size:13px;color:#475569;line-height:1.6;margin-bottom:8px">${esc(podcast.description)}</p>` : ''}
        ${podcast.rss_url ? `<a href="${esc(podcast.rss_url)}" target="_blank" class="btn" style="background:#f59e0b;color:#fff;font-size:12px;margin-top:8px">📡 RSS Feed</a>` : ''}
      </div></div>`;

    // Add episode form
    if (req.session?.user) {
      html += `<div class="card" style="padding:16px;margin-bottom:20px"><form method="post" action="${BASE}/podcasts/${podcast.id}/episodes" class="mus-form">
        <div style="display:grid;gap:12px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div><label>Episode Title *</label><input name="title" required placeholder="Episode title"></div><div><label>Episode #</label><input name="episode_number" type="number" min="1" value="${episodes.length+1}"></div></div>
          <div><label>Description</label><textarea name="description" rows="2" placeholder="Show notes..."></textarea></div>
          <div style="display:grid;grid-template-columns:2fr 1fr;gap:12px"><div><label>Audio URL</label><input name="audio_url" type="url" placeholder="https://..."></div><div><label>Duration (sec)</label><input name="duration" type="number" min="0"></div></div>
          <button type="submit" class="btn" style="background:${PINK};color:#fff">+ Add Episode</button>
        </div></form></div>`;
    }

    // Episodes
    html += `<h2 style="font-size:18px;margin-bottom:14px">📋 Episodes (${episodes.length})</h2>`;
    if (!episodes.length) {
      html += '<div class="card" style="text-align:center;padding:36px"><p style="color:'+GRAY+'">No episodes yet.</p></div>';
    } else {
      html += '<div style="display:grid;gap:10px">';
      episodes.forEach(ep => {
        html += `<div class="card" style="padding:14px;display:flex;gap:14px;align-items:center">
          <div style="min-width:48px;height:48px;background:linear-gradient(135deg,#fce7f3,#fbcfe8);border-radius:12px;display:flex;align-items:center;justify-content:center;font-weight:700;color:${PINK};font-size:16px">E${ep.episode_number}</div>
          <div style="flex:1;min-width:0"><div style="font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(ep.title)}</div>
            <div style="font-size:12px;color:${GRAY}">${ep.published_at ? fmtDate(ep.published_at) : ''} ${ep.duration ? '· '+fmtDur(ep.duration) : ''}</div>
            ${ep.description ? `<div style="font-size:12px;color:#94a3b8;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(ep.description).substring(0,100)}</div>` : ''}</div>
          ${ep.audio_url ? `<a href="${BASE}/${ep.id}/play-episode" class="btn" style="background:${PINK};color:#fff;white-space:nowrap">▶ Play</a>` : ''}
        </div>`;
      });
      html += '</div>';
    }
    res.send(page(podcast.title, html, req));
  }));

  app.post(BASE+'/podcasts/:id/episodes', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { title, description, audio_url, duration, episode_number } = req.body;
    if (!title) return res.redirect(BASE + '/podcasts/' + req.params.id);
    await pool.query(
      'INSERT INTO ent_music_podcast_episodes (podcast_id,tenant_id,title,description,audio_url,duration,episode_number) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [req.params.id, tid, title, description, audio_url, parseInt(duration)||0, parseInt(episode_number)||1]
    );
    res.redirect(BASE + '/podcasts/' + req.params.id);
  }));

  // Episode player
  app.get(BASE+'/:id/play-episode', ah(async (req, res) => {
    const ep = (await pool.query('SELECT pe.*, p.title as podcast_title FROM ent_music_podcast_episodes pe JOIN ent_music_podcasts p ON p.id=pe.podcast_id WHERE pe.id=$1', [req.params.id])).rows[0];
    if (!ep) return res.status(404).send(page('Not Found', '<div class="card" style="text-align:center;padding:48px"><h2 style="color:#dc2626">Episode not found</h2></div>', req));
    let html = nav(BASE+'/podcasts');
    html += `<a href="${BASE}/podcasts/${ep.podcast_id}" style="color:${GRAY};font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← ${esc(ep.podcast_title)}</a>`;
    html += `<div class="mus-player-wrap" style="padding:28px;margin-bottom:20px">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#aaa;margin-bottom:6px">Episode ${ep.episode_number}</div>
      <h1 style="font-size:24px;margin:0 0 8px">${esc(ep.title)}</h1>
      ${ep.published_at ? `<p style="font-size:13px;color:#888;margin:0 0 16px">${fmtDate(ep.published_at)}</p>` : ''}
      ${ep.audio_url ? `<audio controls style="width:100%;border-radius:10px;margin-bottom:16px"><source src="${esc(ep.audio_url)}">Browser not supported.</audio>` : ''}
      ${ep.description ? `<div style="font-size:14px;color:#ccc;line-height:1.7;max-height:300px;overflow-y:auto">${esc(ep.description)}</div>` : ''}
    </div>`;
    res.send(page(ep.title, html, req));
  }));

  // ────────────────────────────────────────────────────────────
  // 10. AUDIOBOOKS
  // ────────────────────────────────────────────────────────────
  app.get(BASE+'/audiobooks', ah(async (req, res) => {
    const tid = req.session?.user?.tenant_id;
    const audiobooks = (await pool.query('SELECT a.*, (SELECT COUNT(*)::int FROM ent_music_audiobook_chapters ac WHERE ac.audiobook_id=a.id) as chapter_count FROM ent_music_audiobooks a WHERE a.tenant_id=$1 ORDER BY a.created_at DESC', [tid||0])).rows;
    let html = nav(BASE+'/audiobooks');
    html += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px">
      <h1 style="font-size:24px">📖 Audiobooks</h1>
      ${req.session?.user ? `<a href="${BASE}/audiobooks/new" class="btn" style="background:#2563eb;color:#fff">+ New Audiobook</a>` : ''}</div>`;
    if (!audiobooks.length) {
      html += '<div class="card" style="text-align:center;padding:48px"><p style="color:'+GRAY+'">No audiobooks yet.</p></div>';
    } else {
      html += '<div class="mus-grid">';
      audiobooks.forEach(ab => {
        html += `<div class="mus-card" onclick="location.href='${BASE}/audiobooks/${ab.id}'">
          <div class="mus-card-img" style="height:220px;background:linear-gradient(135deg,#dbeafe,#bfdbfe)">${ab.cover_url ? `<img src="${esc(ab.cover_url)}" loading="lazy">` : '<div class="ph" style="color:#2563eb">📖</div>'}
            <span style="position:absolute;top:10px;left:10px;background:#2563eb;color:#fff;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700">${ab.chapter_count} ch</span></div>
          <div class="mus-card-body"><div class="mus-card-title">${esc(ab.title)}</div><div class="mus-card-sub">${esc(ab.author||'')} ${ab.narrator ? '· narrated by '+esc(ab.narrator) : ''}</div></div></div>`;
      });
      html += '</div>';
    }
    res.send(page('Audiobooks', html, req));
  }));

  app.get(BASE+'/audiobooks/new', requireAuth, ah(async (req, res) => {
    let html = nav(BASE+'/audiobooks');
    html += `<h1 style="font-size:24px;margin-bottom:20px">📖 New Audiobook</h1>
    <div class="card" style="padding:28px"><form method="post" action="${BASE}/audiobooks/new" class="mus-form">
      <div style="display:grid;gap:16px;max-width:500px">
        <div><label>Title *</label><input name="title" required placeholder="Audiobook title"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px"><div><label>Author</label><input name="author" placeholder="Book author"></div><div><label>Narrator</label><input name="narrator" placeholder="Narrator name"></div></div>
        <div><label>Description</label><textarea name="description" rows="3" placeholder="Book description..."></textarea></div>
        <div><label>Cover URL</label><input name="cover_url" type="url" placeholder="https://..."></div>
        <div style="display:flex;gap:12px"><button type="submit" class="btn" style="background:#2563eb;color:#fff">Create Audiobook</button><a href="${BASE}/audiobooks" class="btn" style="background:#f1f5f9;color:#475569">Cancel</a></div>
      </div></form></div>`;
    res.send(page('New Audiobook', html, req));
  }));

  app.post(BASE+'/audiobooks/new', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { title, author, narrator, description, cover_url } = req.body;
    if (!title) return res.redirect(BASE + '/audiobooks/new');
    await pool.query('INSERT INTO ent_music_audiobooks (tenant_id,title,author,narrator,description,cover_url) VALUES ($1,$2,$3,$4,$5,$6)', [tid, title, author, narrator, description, cover_url]);
    res.redirect(BASE + '/audiobooks');
  }));

  app.get(BASE+'/audiobooks/:id', ah(async (req, res) => {
    const ab = (await pool.query('SELECT * FROM ent_music_audiobooks WHERE id=$1', [req.params.id])).rows[0];
    if (!ab) return res.status(404).send(page('Not Found', '<div class="card" style="text-align:center;padding:48px"><h2 style="color:#dc2626">Audiobook not found</h2></div>', req));
    const chapters = (await pool.query('SELECT * FROM ent_music_audiobook_chapters WHERE audiobook_id=$1 ORDER BY chapter_number', [ab.id])).rows;
    const totalDur = chapters.reduce((s,c) => s + (c.duration||0), 0);

    let html = nav(BASE+'/audiobooks');
    html += `<a href="${BASE}/audiobooks" style="color:${GRAY};font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Audiobooks</a>`;
    html += `<div style="display:flex;gap:20px;align-items:flex-start;margin-bottom:24px;flex-wrap:wrap">
      <img src="${esc(ab.cover_url||'')}" onerror="this.style.display='none'" style="width:160px;height:220px;border-radius:14px;object-fit:cover;box-shadow:0 8px 32px rgba(0,0,0,.12)">
      <div><h1 style="font-size:26px;margin:0 0 4px">${esc(ab.title)}</h1>
        <p style="font-size:14px;color:${GRAY};margin:0 0 8px">by ${esc(ab.author||'Unknown')} ${ab.narrator ? '· narrated by '+esc(ab.narrator) : ''}</p>
        <p style="font-size:12px;color:#94a3b8">${chapters.length} chapters · ${fmtDur(totalDur)}</p>
        ${ab.description ? `<p style="font-size:13px;color:#475569;line-height:1.6;margin-top:8px">${esc(ab.description)}</p>` : ''}
      </div></div>`;

    // Add chapter form
    if (req.session?.user) {
      html += `<div class="card" style="padding:16px;margin-bottom:20px"><form method="post" action="${BASE}/audiobooks/${ab.id}/chapters" class="mus-form">
        <div style="display:grid;gap:12px">
          <div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:12px"><div><label>Chapter Title *</label><input name="title" required placeholder="Chapter title"></div><div><label>Chapter #</label><input name="chapter_number" type="number" min="1" value="${chapters.length+1}"></div><div><label>Duration (sec)</label><input name="duration" type="number" min="0"></div></div>
          <div><label>Audio URL</label><input name="audio_url" type="url" placeholder="https://..."></div>
          <button type="submit" class="btn" style="background:#2563eb;color:#fff">+ Add Chapter</button>
        </div></form></div>`;
    }

    // Chapters with player
    html += `<h2 style="font-size:18px;margin-bottom:14px">📚 Chapters</h2>`;
    if (!chapters.length) {
      html += '<div class="card" style="text-align:center;padding:36px"><p style="color:'+GRAY+'">No chapters yet.</p></div>';
    } else {
      html += '<div style="display:grid;gap:8px">';
      chapters.forEach(ch => {
        html += `<div class="card" style="padding:14px" id="chapter-${ch.chapter_number}">
          <div style="display:flex;align-items:center;gap:12px">
            <span style="min-width:40px;text-align:center;font-weight:700;color:#2563eb;font-size:15px">${ch.chapter_number}</span>
            <div style="flex:1">
              <div style="font-weight:600;font-size:14px">${esc(ch.title)}</div>
              <div style="font-size:12px;color:${GRAY}">${fmtDur(ch.duration)}</div>
            </div>
            ${ch.audio_url ? `<audio controls preload="none" style="height:36px;max-width:280px"><source src="${esc(ch.audio_url)}"></audio>` : ''}
          </div></div>`;
      });
      html += '</div>';
      // Playback speed control
      html += `<div class="card" style="margin-top:16px;padding:14px;display:flex;align-items:center;gap:12px">
        <label style="font-size:13px;font-weight:600">⏱ Playback Speed:</label>
        <button onclick="setSpeed(0.75)" class="btn" style="padding:4px 12px;font-size:12px">0.75x</button>
        <button onclick="setSpeed(1)" class="btn" style="padding:4px 12px;font-size:12px;background:${P};color:#fff">1x</button>
        <button onclick="setSpeed(1.25)" class="btn" style="padding:4px 12px;font-size:12px">1.25x</button>
        <button onclick="setSpeed(1.5)" class="btn" style="padding:4px 12px;font-size:12px">1.5x</button>
        <button onclick="setSpeed(2)" class="btn" style="padding:4px 12px;font-size:12px">2x</button>
      </div>`;
      html += `<script>
        function setSpeed(rate){document.querySelectorAll('audio').forEach(a=>a.playbackRate=rate);}
        function bookmark(ch){const bm=JSON.parse(localStorage.getItem('audiobook_bookmarks')||'{}');const cur=JSON.parse(localStorage.getItem('audiobook_bookmark_'+${ab.id})||'0');localStorage.setItem('audiobook_bookmark_'+${ab.id},String(ch));alert('Bookmarked Chapter '+ch);}
      </script>`;
    }
    res.send(page(ab.title, html, req));
  }));

  app.post(BASE+'/audiobooks/:id/chapters', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { title, audio_url, duration, chapter_number } = req.body;
    if (!title) return res.redirect(BASE + '/audiobooks/' + req.params.id);
    await pool.query(
      'INSERT INTO ent_music_audiobook_chapters (audiobook_id,tenant_id,title,audio_url,duration,chapter_number) VALUES ($1,$2,$3,$4,$5,$6)',
      [req.params.id, tid, title, audio_url, parseInt(duration)||0, parseInt(chapter_number)||1]
    );
    res.redirect(BASE + '/audiobooks/' + req.params.id);
  }));

  // ────────────────────────────────────────────────────────────
  // 11. MUSIC CHARTS
  // ────────────────────────────────────────────────────────────
  app.get(BASE+'/charts', ah(async (req, res) => {
    const tid = req.session?.user?.tenant_id;
    const topWeek = (await pool.query('SELECT * FROM ent_music_tracks WHERE tenant_id=$1 AND created_at >= NOW() - INTERVAL \'7 days\' ORDER BY play_count DESC LIMIT 10', [tid||0])).rows;
    const mostPlayed = (await pool.query('SELECT * FROM ent_music_tracks WHERE tenant_id=$1 ORDER BY play_count DESC LIMIT 10', [tid||0])).rows;
    const trending = (await pool.query('SELECT * FROM ent_music_tracks WHERE tenant_id=$1 AND created_at >= NOW() - INTERVAL \'30 days\' ORDER BY play_count DESC, likes DESC LIMIT 10', [tid||0])).rows;
    const newEntries = (await pool.query('SELECT * FROM ent_music_tracks WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 10', [tid||0])).rows;

    let html = nav(BASE+'/charts');
    html += `<div class="mus-hero" style="text-align:center"><h1>📊 Music Charts</h1><p>Top tracks, trending hits, and new entries</p></div>`;

    function chartSection(title, icon, tracks) {
      let s = `<div class="card" style="margin-bottom:20px"><h3 style="font-size:18px;margin-bottom:14px">${icon} ${title}</h3>`;
      if (!tracks.length) { s += '<p style="color:'+GRAY+';text-align:center;padding:16px">No data</p>'; }
      else {
        s += '<table class="mus-table"><thead><tr><th>#</th><th>Title</th><th>Artist</th><th>Plays</th><th>Likes</th><th></th></tr></thead><tbody>';
        tracks.forEach((t,i) => {
          s += `<tr><td style="font-weight:700;color:${i<3?P:'#94a3b8'}">${i+1}</td><td>${esc(t.title)}</td><td style="color:${GRAY}">${esc(t.artist||'')}</td><td>${t.play_count||0}</td><td>${t.likes||0}</td><td><a href="${BASE}/${t.id}/play" style="color:${P};font-weight:600">▶</a></td></tr>`;
        });
        s += '</tbody></table>';
      }
      return s + '</div>';
    }

    html += chartSection('Top 10 This Week', '🏆', topWeek);
    html += chartSection('Most Played All Time', '🔥', mostPlayed);
    html += chartSection('Trending (Last 30 Days)', '📈', trending);
    html += chartSection('New Entries', '🆕', newEntries);

    res.send(page('Charts', html, req));
  }));

  // ────────────────────────────────────────────────────────────
  // 12. BACKGROUND PLAY (mini-player — see helper above)
  // ────────────────────────────────────────────────────────────

  // ────────────────────────────────────────────────────────────
  // 13. MUSIC SHARING
  // ────────────────────────────────────────────────────────────
  app.get(BASE+'/:id/share', ah(async (req, res) => {
    const track = (await pool.query('SELECT * FROM ent_music_tracks WHERE id=$1', [req.params.id])).rows[0];
    if (!track) return res.status(404).send(page('Not Found', '<div class="card" style="text-align:center;padding:48px"><h2 style="color:#dc2626">Track not found</h2></div>', req));
    const host = req.protocol + '://' + req.get('host');
    const shareUrl = host + BASE + '/' + track.id + '/play';
    const qrText = shareUrl; // QR text for QR code generators

    let html = nav(BASE);
    html += `<a href="${BASE}/${track.id}/play" style="color:${GRAY};font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Track</a>`;
    html += `<div style="max-width:500px;margin:0 auto">
      <div class="card" style="text-align:center;padding:32px;margin-bottom:20px">
        <div style="width:120px;height:120px;border-radius:14px;background:linear-gradient(135deg,${P},${PINK});margin:0 auto 16px;display:flex;align-items:center;justify-content:center;overflow:hidden">
          ${track.cover_url ? `<img src="${esc(track.cover_url)}" style="width:100%;height:100%;object-fit:cover">` : '<span style="font-size:48px">🎵</span>'}
        </div>
        <h1 style="font-size:22px;margin:0 0 4px">${esc(track.title)}</h1>
        <p style="font-size:14px;color:${GRAY}">${esc(track.artist||'')}</p>
      </div>
      <div class="card" style="padding:20px;margin-bottom:16px">
        <h3 style="font-size:14px;margin-bottom:10px">🔗 Share Link</h3>
        <div style="display:flex;gap:8px"><input type="text" value="${esc(shareUrl)}" readonly style="flex:1;padding:10px;border:2px solid #e2e8f0;border-radius:8px;font-size:13px" onclick="this.select()">
          <button onclick="navigator.clipboard.writeText('${esc(shareUrl)}');this.textContent='Copied!'" class="btn" style="background:${P};color:#fff;white-space:nowrap">Copy</button></div>
      </div>
      <div class="card" style="padding:20px;margin-bottom:16px">
        <h3 style="font-size:14px;margin-bottom:10px">📱 QR Code</h3>
        <div style="font-family:monospace;font-size:10px;background:#f8fafc;padding:16px;border-radius:8px;word-break:break-all;color:#475569;line-height:1.8">${esc(shareUrl)}</div>
        <a href="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(shareUrl)}" target="_blank" class="btn" style="background:#f1f5f9;color:#475569;margin-top:10px;display:inline-block">Generate QR Code</a>
      </div>
      <div class="card" style="padding:20px">
        <h3 style="font-size:14px;margin-bottom:12px">📤 Share On</h3>
        <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
          <a href="https://wa.me/?text=${encodeURIComponent('Check out: ' + track.title + ' by ' + (track.artist||'') + ' ' + shareUrl)}" target="_blank" class="btn" style="background:#25D366;color:#fff">💬 WhatsApp</a>
          <a href="https://twitter.com/intent/tweet?text=${encodeURIComponent('Check out: ' + track.title + ' by ' + (track.artist||''))}&url=${encodeURIComponent(shareUrl)}" target="_blank" class="btn" style="background:#1DA1F2;color:#fff">🐦 Twitter</a>
          <a href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}" target="_blank" class="btn" style="background:#1877F2;color:#fff">📘 Facebook</a>
        </div>
      </div></div>`;
    res.send(page('Share — ' + track.title, html, req));
  }));

  // ────────────────────────────────────────────────────────────
  // UTILITY: API endpoints for AJAX
  // ────────────────────────────────────────────────────────────

  // POST save mini-player to session (AJAX)
  app.post(BASE+'/api/mini-player', requireAuth, ah(async (req, res) => {
    req.session.miniPlayer = {
      trackId: req.body.trackId,
      title: req.body.title,
      artist: req.body.artist,
      audioUrl: req.body.audioUrl,
      coverUrl: req.body.coverUrl,
      duration: req.body.duration
    };
    res.json({ success: true });
  }));

  // GET track info API
  app.get(BASE+'/api/track/:id', ah(async (req, res) => {
    const track = (await pool.query('SELECT id,title,artist,audio_url,cover_url,duration,lyrics FROM ent_music_tracks WHERE id=$1', [req.params.id])).rows[0];
    if (!track) return res.json({ error: 'Not found' });
    res.json(track);
  }));

  // POST record play (AJAX)
  app.post(BASE+'/api/play', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query('UPDATE ent_music_tracks SET play_count = play_count + 1 WHERE id=$1', [req.body.track_id]);
    await pool.query('INSERT INTO ent_music_play_history (tenant_id,track_id,user_email) VALUES ($1,$2,$3)', [tid, req.body.track_id, req.session.user.email]);
    res.json({ success: true });
  }));

  // GET list albums API
  app.get(BASE+'/albums', ah(async (req, res) => {
    const tid = req.session?.user?.tenant_id;
    const albums = (await pool.query('SELECT * FROM ent_music_albums WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 100', [tid||0])).rows;
    let html = nav(BASE+'/albums');
    html += '<h1 style="font-size:24px;margin-bottom:20px">💿 Albums</h1>';
    if (!albums.length) {
      html += '<div class="card" style="text-align:center;padding:48px"><p style="color:'+GRAY+'">No albums yet. Upload tracks to create albums.</p></div>';
    } else {
      html += '<div class="mus-grid">';
      albums.forEach(a => {
        html += `<div class="mus-card" onclick="location.href='${BASE}/albums/${a.id}'">
          <div class="mus-card-img">${a.cover_url ? `<img src="${esc(a.cover_url)}" loading="lazy">` : '<div class="ph">💿</div>'}</div>
          <div class="mus-card-body"><div class="mus-card-title">${esc(a.name)}</div><div class="mus-card-sub">${esc(a.artist||'')} · ${a.genre||''} ${a.release_date ? '· '+fmtDate(a.release_date) : ''}</div></div></div>`;
      });
      html += '</div>';
    }
    res.send(page('Albums', html, req));
  }));

  // GET list artists API
  app.get(BASE+'/artists', ah(async (req, res) => {
    const tid = req.session?.user?.tenant_id;
    const artists = (await pool.query("SELECT DISTINCT artist, COUNT(*)::int as track_count FROM ent_music_tracks WHERE tenant_id=$1 AND artist IS NOT NULL AND artist != '' GROUP BY artist ORDER BY track_count DESC", [tid||0])).rows;
    let html = nav(BASE+'/artists');
    html += '<h1 style="font-size:24px;margin-bottom:20px">🎤 Artists</h1>';
    if (!artists.length) {
      html += '<div class="card" style="text-align:center;padding:48px"><p style="color:'+GRAY+'">No artists yet.</p></div>';
    } else {
      html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px">';
      artists.forEach(a => {
        html += `<a href="${BASE}/artists/${encodeURIComponent(a.artist)}" class="card" style="display:flex;align-items:center;gap:14px;text-decoration:none;padding:16px;transition:.2s;border:1px solid #e2e8f0">
          <div style="width:52px;height:52px;border-radius:50%;background:linear-gradient(135deg,${P},${PINK});display:flex;align-items:center;justify-content:center;font-size:22px;color:#fff;font-weight:700;flex-shrink:0">${esc(a.artist.charAt(0).toUpperCase())}</div>
          <div><div style="font-weight:700;font-size:15px;color:#1e293b">${esc(a.artist)}</div><div style="font-size:12px;color:${GRAY}">${a.track_count} tracks</div></div></a>`;
      });
      html += '</div>';
    }
    res.send(page('Artists', html, req));
  }));

  console.log('[EntertainmentMusic] Module loaded — ' + BASE);
};
