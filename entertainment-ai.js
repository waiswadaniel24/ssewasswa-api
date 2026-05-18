/**
 * Entertainment AI — AI-Powered Entertainment Features Module
 * Recommendations · Smart Search · Auto-Tagging · Moderation · Playlists · Sentiment · Trending · Summaries
 */
module.exports = function(app, pool, opts) {
  const esc = opts.esc || (s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'));
  const renderPage = opts.renderPage || ((t,c,u) => c);
  const ah = opts.ah || ((fn) => async (req,res,next) => { try { await fn(req,res,next); } catch(e) { res.status(500).send('Error: '+e.message); }});
  const requireAuth = opts.requireAuth || ((req,res,next) => { if(!req.session?.user) return res.redirect('/login'); next(); });
  const audit = opts.audit || (() => {});
  const u = (req) => req.session?.user || {};
  const tid = (req) => req.session?.user?.tenant_id || 0;

  // ─── Color Palette ───
  const C = {
    primary:'#06b6d4', primaryDark:'#0891b2', primaryLight:'#67e8f9',
    accent:'#3b82f6', accentDark:'#2563eb',
    purple:'#8b5cf6', green:'#10b981', red:'#ef4444', gold:'#f59e0b',
    g50:'#f8fafc', g100:'#f1f5f9', g200:'#e2e8f0', g300:'#cbd5e1',
    g500:'#64748b', g700:'#334155', g900:'#0f172a', white:'#ffffff',
  };

  // ─── Sentiment Lexicon ───
  const POSITIVE_WORDS = ['love','great','amazing','best','awesome','beautiful','excellent','fantastic','wonderful','perfect','brilliant','superb','outstanding','enjoy','happy','good','nice','incredible','magnificent','pleased','delightful','charming','impressive','favorite','recommend','fun','exciting','masterpiece'];
  const NEGATIVE_WORDS = ['hate','terrible','awful','worst','boring','waste','bad','poor','disgusting','horrible','dreadful','rubbish','trash','ugly','annoying','disappointing','mediocre','lame','pathetic','unbearable','cringe','sucks','dislike','worse','overrated','predictable','dull','tedious'];

  const MOODS = ['Happy','Sad','Energetic','Calm','Romantic','Focus','Workout','Party'];
  const GENRES = ['Pop','Rock','Hip-Hop','Jazz','Classical','Electronic','R&B','Country','Indie','Lo-Fi'];
  const DURATIONS = [{label:'15 min',sec:900},{label:'30 min',sec:1800},{label:'1 hr',sec:3600},{label:'2 hr',sec:7200}];

  // ─── Helpers ───
  const fmtDur = s => { if(!s) return '0:00'; const m=Math.floor(s/60); return m+':'+String(Math.floor(s%60)).padStart(2,'0'); };
  const fmtDate = d => d ? new Date(d).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) : '—';

  function navTabs(active) {
    const tabs = [
      {href:'/entertainment/ai/recommendations',label:'🎯 Recommendations',id:'rec'},
      {href:'/entertainment/ai/search',label:'🔍 Smart Search',id:'search'},
      {href:'/entertainment/ai/tags',label:'🏷️ Auto Tags',id:'tags'},
      {href:'/entertainment/ai/moderation',label:'🛡️ Moderation',id:'mod'},
      {href:'/entertainment/ai/playlist-generator',label:'🎵 Playlists',id:'pl'},
      {href:'/entertainment/ai/sentiment',label:'💬 Sentiment',id:'sent'},
      {href:'/entertainment/ai/trending',label:'🔥 Trending',id:'trend'},
    ];
    return `<nav style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:24px;border-bottom:2px solid ${C.g200};padding-bottom:8px" aria-label="Entertainment AI navigation">` +
      tabs.map(t => `<a href="${t.href}" style="padding:10px 16px;border-radius:8px 8px 0 0;text-decoration:none;font-weight:600;font-size:13px;color:${t.id===active?C.white:C.g700};background:${t.id===active?'linear-gradient(135deg,#06b6d4,#3b82f6)':C.g100};transition:.2s" ${t.id===active?'aria-current="page"':''}>${t.label}</a>`).join('') + `</nav>`;
  }

  function hero(title, subtitle) {
    return `<div style="background:linear-gradient(135deg,#06b6d4,#3b82f6);border-radius:16px;padding:36px 24px;margin-bottom:24px;color:#fff;text-align:center">
      <h1 style="font-size:30px;margin:0">${title}</h1>
      ${subtitle ? `<p style="opacity:.85;margin-top:6px;font-size:15px">${subtitle}</p>` : ''}
    </div>`;
  }

  function statBox(val, label, color) {
    const c = color || C.primary;
    return `<div style="text-align:center;min-width:130px;padding:18px;background:${C.g50};border-radius:12px;border:2px solid ${c}20">
      <div style="font-size:28px;font-weight:700;color:${c}">${val}</div>
      <div style="font-size:12px;color:${C.g500};margin-top:4px">${label}</div></div>`;
  }

  function card(title, body, accent) {
    const ac = accent || C.primary;
    return `<div style="background:${C.white};border-radius:14px;box-shadow:0 1px 3px rgba(0,0,0,.08);overflow:hidden;margin-bottom:20px;border:1px solid ${C.g200}">
      <div style="background:${ac};padding:14px 20px"><h3 style="margin:0;color:${C.white};font-size:15px;font-weight:600">${title}</h3></div>
      <div style="padding:20px">${body}</div></div>`;
  }

  function aiCard(title, desc, score, icon, link) {
    return `<div style="background:${C.white};border:1px solid ${C.g200};border-radius:12px;padding:16px;transition:.2s;border-left:4px solid ${C.primary};cursor:pointer" ${link?`onclick="location.href='${link}'"`:''}>
      <div style="display:flex;gap:12px;align-items:start">
        <div style="min-width:44px;height:44px;background:linear-gradient(135deg,#06b6d4,#3b82f6);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">${icon||'🎯'}</div>
        <div style="flex:1"><div style="font-weight:600;font-size:14px;color:${C.g900}">${esc(title)}</div>
        ${desc?`<div style="font-size:12px;color:${C.g500};margin-top:2px;line-height:1.4">${esc(desc)}</div>`:''}
        ${score?`<div style="margin-top:6px"><span style="background:#dbeafe;color:#2563eb;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:600">Score: ${score}</span></div>`:''}
        </div></div></div>`;
  }

  // ─── CSS ───
  const AI_CSS = `<style>
    .eai-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px}
    .eai-input{padding:10px 14px;border:2px solid ${C.g200};border-radius:10px;font-size:14px;box-sizing:border-box;background:#fff;transition:.15s}
    .eai-input:focus{outline:none;border-color:${C.primary}}
    .eai-btn{padding:10px 22px;border:none;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;transition:.15s;background:linear-gradient(135deg,#06b6d4,#3b82f6);color:#fff}
    .eai-btn:hover{opacity:.9;transform:translateY(-1px)}
    .eai-btn-sm{padding:7px 16px;font-size:12px;border-radius:8px}
    .eai-btn-green{background:linear-gradient(135deg,#10b981,#059669)}
    .eai-btn-red{background:linear-gradient(135deg,#ef4444,#dc2626)}
    .eai-btn-gold{background:linear-gradient(135deg,#f59e0b,#d97706)}
    .eai-tab{padding:8px 18px;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;transition:.15s;display:inline-block}
    .eai-tab.active{background:linear-gradient(135deg,#06b6d4,#3b82f6);color:#fff}
    .eai-tab:not(.active){background:${C.g100};color:${C.g500}}
    .eai-table{width:100%;border-collapse:collapse;font-size:13px}
    .eai-table th{padding:11px 14px;text-align:left;border-bottom:2px solid ${C.g200};color:${C.g500};font-weight:700;font-size:11px;text-transform:uppercase;background:${C.g50}}
    .eai-table td{padding:10px 14px;border-bottom:1px solid ${C.g100}}
    .eai-table tr:hover{background:${C.g50}}
    .eai-badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600}
    .eai-glow{box-shadow:0 0 20px rgba(6,182,212,.15),0 0 40px rgba(59,130,246,.1)}
    .eai-section{margin-bottom:20px}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
    .eai-live{animation:pulse 2s infinite}
    @media(max-width:768px){.eai-grid{grid-template-columns:1fr}}
  </style>`;

  // ═══════════════════════════════════════════════════════
  // DATABASE MIGRATIONS
  // ═══════════════════════════════════════════════════════
  (async () => {
    const ensure = async (name, sql) => {
      try { await pool.query(sql); } catch(e) { /* may already exist */ }
    };
    await ensure('ent_ai_recommendations', `
      CREATE TABLE IF NOT EXISTS ent_ai_recommendations (
        id SERIAL PRIMARY KEY, tenant_id INTEGER DEFAULT 0, user_email TEXT,
        content_type TEXT, content_id INTEGER, score NUMERIC,
        reason TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS eai_rec_user ON ent_ai_recommendations(user_email);
      CREATE INDEX IF NOT EXISTS eai_rec_type ON ent_ai_recommendations(content_type);
    `);
    await ensure('ent_ai_search_history', `
      CREATE TABLE IF NOT EXISTS ent_ai_search_history (
        id SERIAL PRIMARY KEY, tenant_id INTEGER DEFAULT 0, user_email TEXT,
        query TEXT, results_count INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS eai_sh_user ON ent_ai_search_history(user_email);
    `);
    await ensure('ent_ai_moderation', `
      CREATE TABLE IF NOT EXISTS ent_ai_moderation (
        id SERIAL PRIMARY KEY, tenant_id INTEGER DEFAULT 0,
        content_type TEXT, content_id INTEGER, flagged_text TEXT,
        reason TEXT, status TEXT DEFAULT 'pending',
        reviewed_by TEXT, reviewed_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS eai_mod_status ON ent_ai_moderation(status);
    `);
    await ensure('ent_ai_sentiment', `
      CREATE TABLE IF NOT EXISTS ent_ai_sentiment (
        id SERIAL PRIMARY KEY, tenant_id INTEGER DEFAULT 0,
        content_type TEXT, content_id INTEGER,
        sentiment_score INTEGER DEFAULT 0,
        positive_words INTEGER DEFAULT 0,
        negative_words INTEGER DEFAULT 0,
        analyzed_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS eai_sent_type ON ent_ai_sentiment(content_type);
    `);
    await ensure('ent_ai_trending', `
      CREATE TABLE IF NOT EXISTS ent_ai_trending (
        id SERIAL PRIMARY KEY, tenant_id INTEGER DEFAULT 0,
        content_type TEXT, content_id INTEGER,
        trending_score NUMERIC DEFAULT 0,
        views_hour INTEGER DEFAULT 0, views_day INTEGER DEFAULT 0,
        likes INTEGER DEFAULT 0, comments INTEGER DEFAULT 0,
        calculated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS eai_trend_score ON ent_ai_trending(trending_score DESC);
    `);
    await ensure('ent_ai_banned_words', `
      CREATE TABLE IF NOT EXISTS ent_ai_banned_words (
        id SERIAL PRIMARY KEY, word TEXT UNIQUE,
        category TEXT DEFAULT 'inappropriate'
      );
    `);
    // Seed banned words
    const bwCount = (await pool.query(`SELECT COUNT(*)::int as c FROM ent_ai_banned_words`)).rows[0].c;
    if (bwCount === 0) {
      const defaultBanned = ['spam','scam','hack','cheat','exploit','malware','phishing','fraud','violence','threat','abuse','harass','hate speech','nsfw','explicit','profanity'];
      for (const w of defaultBanned) {
        try { await pool.query(`INSERT INTO ent_ai_banned_words (word) VALUES ($1)`, [w]); } catch(e) {}
      }
    }
  })();

  // ═══════════════════════════════════════════════════════
  // 1. AI CONTENT RECOMMENDATIONS
  // ═══════════════════════════════════════════════════════
  app.get('/entertainment/ai/recommendations', ah(async (req, res) => {
    const currentUser = u(req);
    const email = currentUser.email || '';
    const tenantId = tid(req);

    let recHtml = '';
    if (email) {
      // ── Build recommendation based on user activity ──
      // Get user's top video categories from views/likes
      const videoPrefs = (await pool.query(`
        SELECT v.category, COUNT(*) as cnt
        FROM videos v
        LEFT JOIN video_likes vl ON vl.video_id = v.id AND vl.user_email = $1
        LEFT JOIN video_comments vc ON vc.video_id = v.id AND vc.user_email = $1
        WHERE (vl.id IS NOT NULL OR vc.id IS NOT NULL) AND v.category IS NOT NULL
        GROUP BY v.category ORDER BY cnt DESC LIMIT 5
      `, [email])).rows;

      // Get user's music genre preferences
      const musicPrefs = (await pool.query(`
        SELECT m.genre, COUNT(*) as cnt
        FROM music_tracks m
        LEFT JOIN music_play_history mph ON mph.track_id = m.id AND mph.user_email = $1
        WHERE mph.id IS NOT NULL AND m.genre IS NOT NULL
        GROUP BY m.genre ORDER BY cnt DESC LIMIT 5
      `, [email])).rows;

      const topCats = videoPrefs.map(r => r.category);
      const topGenres = musicPrefs.map(r => r.genre);

      // ── Recommended Videos ──
      let videoRecs = [];
      if (topCats.length > 0) {
        const catPlaceholders = topCats.map((_, i) => `$${i + 2}`).join(',');
        const consumedVideos = (await pool.query(`
          SELECT DISTINCT video_id FROM video_likes WHERE user_email = $1
          UNION SELECT DISTINCT video_id FROM video_comments WHERE user_email = $1
        `, [email])).rows.map(r => r.video_id);

        videoRecs = (await pool.query(`
          SELECT v.*, (v.likes * 2 + v.views) as popularity
          FROM videos v
          WHERE v.is_published = true AND v.category IN (${catPlaceholders})
            ${consumedVideos.length > 0 ? `AND v.id NOT ALL ($${topCats.length + 2})` : ''}
          ORDER BY popularity DESC LIMIT 6
        `, [email, ...topCats, consumedVideos])).rows;
      }
      if (videoRecs.length === 0) {
        videoRecs = (await pool.query(`
          SELECT v.*, (v.likes * 2 + v.views) as popularity
          FROM videos v WHERE v.is_published = true
          ORDER BY popularity DESC LIMIT 6
        `)).rows;
      }

      // ── Recommended Music ──
      let musicRecs = [];
      if (topGenres.length > 0) {
        const genrePlaceholders = topGenres.map((_, i) => `$${i + 2}`).join(',');
        musicRecs = (await pool.query(`
          SELECT m.*, (m.play_count || 0)::int as plays
          FROM music_tracks m
          WHERE m.genre IN (${genrePlaceholders})
          ORDER BY plays DESC LIMIT 6
        `, [email, ...topGenres])).rows;
      }
      if (musicRecs.length === 0) {
        musicRecs = (await pool.query(`
          SELECT m.*, (m.play_count || 0)::int as plays
          FROM music_tracks m ORDER BY plays DESC LIMIT 6
        `)).rows;
      }

      // ── Recommended Games ──
      const gameRecs = (await pool.query(`
        SELECT g.*, (g.plays || 0)::int as total_plays
        FROM games g ORDER BY total_plays DESC LIMIT 6
      `)).rows;

      // ── Recommended Posts ──
      const postRecs = (await pool.query(`
        SELECT p.*, (p.likes || 0)::int as total_likes
        FROM posts p WHERE p.is_published = true
        ORDER BY total_likes DESC LIMIT 6
      `)).rows;

      // Save recommendations
      try {
        const allRecs = [
          ...videoRecs.map(r => ({type:'video',id:r.id,score:r.popularity||0,reason:`You like ${r.category} videos`})),
          ...musicRecs.map(r => ({type:'music',id:r.id,score:r.plays||0,reason:`Based on your ${r.genre} preference`})),
          ...gameRecs.map(r => ({type:'game',id:r.id,score:r.total_plays||0,reason:'Popular game'})),
          ...postRecs.map(r => ({type:'post',id:r.id,score:r.total_likes||0,reason:'Trending post'})),
        ];
        for (const rec of allRecs.slice(0, 20)) {
          await pool.query(`
            INSERT INTO ent_ai_recommendations (tenant_id, user_email, content_type, content_id, score, reason)
            VALUES ($1,$2,$3,$4,$5,$6)
            ON CONFLICT DO NOTHING
          `, [tenantId, email, rec.type, rec.id, rec.score, rec.reason]);
        }
      } catch(e) {}

      // Render sections
      const typeIcons = {video:'🎬',music:'🎵',game:'🎮',post:'📝'};
      const typeLinks = {video:'/videos/',music:'/music/',game:'/games/',post:'/posts/'};

      function renderRecSection(title, items, type) {
        if (items.length === 0) return '';
        const cards = items.map(item => aiCard(
          item.title || item.name || 'Untitled',
          item.description || item.artist || '',
          (item.popularity || item.plays || item.total_plays || item.total_likes || 0).toLocaleString(),
          typeIcons[type] || '🎯',
          typeLinks[type] + item.id
        )).join('');
        return card(`${typeIcons[type]||'🎯'} ${title} (${items.length})`,
          `<div class="eai-grid">${cards}</div>`, C.primary);
      }

      recHtml += renderRecSection('Recommended Videos', videoRecs, 'video');
      recHtml += renderRecSection('Recommended Music', musicRecs, 'music');
      recHtml += renderRecSection('Popular Games', gameRecs, 'game');
      recHtml += renderRecSection('Trending Posts', postRecs, 'post');
    } else {
      recHtml = card('Sign In Required', `<p style="color:${C.g500}"><a href="/login" style="color:${C.primary};font-weight:600">Log in</a> to get personalized AI recommendations.</p>`, C.g500);
    }

    res.send(renderPage('AI Recommendations', AI_CSS + `
      <div style="max-width:1200px;margin:0 auto">
        ${navTabs('rec')}
        ${hero('🎯 AI Recommendations', 'Personalized content suggestions powered by your activity')}
        <div style="display:flex;flex-wrap:wrap;gap:14px;margin-bottom:20px">
          ${statBox('24h', 'Analysis Window', C.primary)}
          ${statBox('4', 'Content Types', C.accent)}
          ${statBox('AI', 'Powered', C.purple)}
        </div>
        ${recHtml || '<div class="card" style="text-align:center;padding:48px;color:'+C.g500+'"><p>Browse some content first to get personalized recommendations!</p></div>'}
      </div>`, currentUser, true));
  }));

  // ═══════════════════════════════════════════════════════
  // 2. SMART SEARCH
  // ═══════════════════════════════════════════════════════
  app.get('/entertainment/ai/search', ah(async (req, res) => {
    const q = (req.query.q || '').trim();
    const currentUser = u(req);
    const tenantId = tid(req);

    // Popular search suggestions
    const popularSearches = (await pool.query(`
      SELECT query, COUNT(*) as cnt FROM ent_ai_search_history
      GROUP BY query ORDER BY cnt DESC LIMIT 10
    `)).rows;

    let searchResults = null;
    if (q) {
      const pattern = `%${q}%`;

      // Search videos
      const videos = (await pool.query(`
        SELECT id, title, description, category, views, likes, thumbnail_url, 'video' as type
        FROM videos WHERE is_published = true AND (title ILIKE $1 OR description ILIKE $1 OR category ILIKE $1)
        ORDER BY likes DESC LIMIT 5
      `, [pattern])).rows;

      // Search music
      const music = (await pool.query(`
        SELECT id, title, artist, genre, duration, play_count, 'music' as type
        FROM music_tracks WHERE (title ILIKE $1 OR artist ILIKE $1 OR genre ILIKE $1)
        ORDER BY play_count DESC NULLS LAST LIMIT 5
      `, [pattern])).rows;

      // Search games
      const games = (await pool.query(`
        SELECT id, title, description, category, plays, 'game' as type
        FROM games WHERE (title ILIKE $1 OR description ILIKE $1 OR category ILIKE $1)
        ORDER BY plays DESC NULLS LAST LIMIT 5
      `, [pattern])).rows;

      // Search posts
      const posts = (await pool.query(`
        SELECT id, title, content, author, likes, created_at, 'post' as type
        FROM posts WHERE is_published = true AND (title ILIKE $1 OR content ILIKE $1)
        ORDER BY likes DESC NULLS LAST LIMIT 5
      `, [pattern])).rows;

      // Search forum threads
      const forums = (await pool.query(`
        SELECT id, title, 'forum' as type, created_at
        FROM forum_threads WHERE (title ILIKE $1)
        ORDER BY created_at DESC LIMIT 5
      `, [pattern])).rows;

      const totalResults = videos.length + music.length + games.length + posts.length + forums.length;

      // Save search history
      try {
        await pool.query(`INSERT INTO ent_ai_search_history (tenant_id, user_email, query, results_count) VALUES ($1,$2,$3,$4)`,
          [tenantId, currentUser.email || null, q, totalResults]);
      } catch(e) {}

      searchResults = { videos, music, games, posts, forums, totalResults };

      // Save trending for popular results
      for (const v of videos.slice(0, 3)) {
        try { await pool.query(`INSERT INTO ent_ai_trending (tenant_id,content_type,content_id,trending_score,likes) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
          [tenantId, 'video', v.id, (v.likes||0) + 5, v.likes]); } catch(e) {}
      }
    }

    const typeIcons = {video:'🎬',music:'🎵',game:'🎮',post:'📝',forum:'💬'};
    const typeColors = {video:'#7c3aed',music:'#ec4899',game:'#f59e0b',post:'#3b82f6',forum:'#10b981'};

    function resultSection(title, items, type) {
      if (items.length === 0) return '';
      const cards = items.map(item => `
        <div style="display:flex;gap:12px;align-items:center;padding:12px;background:${C.g50};border-radius:10px;cursor:pointer;border-left:4px solid ${typeColors[type]||C.primary}"
          onclick="location.href='/${type}${type==='forum'?'/threads/':'/'}${esc(item.id)}'">
          <div style="min-width:36px;height:36px;background:linear-gradient(135deg,${typeColors[type]||C.primary},${typeColors[type]||C.primary}cc);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:16px">${typeIcons[type]}</div>
          <div style="flex:1"><div style="font-weight:600;font-size:13px;color:${C.g900}">${esc(item.title||'Untitled')}</div>
          ${item.description?`<div style="font-size:11px;color:${C.g500};margin-top:1px">${esc(String(item.description).substring(0,80))}</div>`:''}
          ${item.artist?`<div style="font-size:11px;color:${C.g500}">${esc(item.artist)} ${item.genre?'· '+esc(item.genre):''}</div>`:''}
          </div>
          <div style="font-size:11px;color:${C.g500}">${item.views||item.likes||item.plays||item.play_count||''}</div>
        </div>
      `).join('');
      return `<div class="eai-section"><h3 style="font-size:15px;font-weight:700;color:${C.g700};margin:0 0 10px">${typeIcons[type]} ${title} <span style="color:${typeColors[type]};font-weight:600">(${items.length})</span></h3>${cards}</div>`;
    }

    const sugHtml = popularSearches.length > 0
      ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:12px">${popularSearches.map(s => `<a href="/entertainment/ai/search?q=${encodeURIComponent(s.query)}" class="eai-tab" style="font-size:12px">${esc(s.query)}</a>`).join('')}</div>`
      : '';

    res.send(renderPage('AI Smart Search', AI_CSS + `
      <div style="max-width:1000px;margin:0 auto">
        ${navTabs('search')}
        ${hero('🔍 AI Smart Search', 'Search across all entertainment content simultaneously')}
        <div class="card eai-glow" style="padding:24px;margin-bottom:20px">
          <form method="GET" action="/entertainment/ai/search" style="display:flex;gap:10px">
            <input type="text" name="q" value="${esc(q)}" placeholder="Search videos, music, games, posts, forums..." class="eai-input" style="flex:1;font-size:16px" required>
            <button type="submit" class="eai-btn">🔍 Search</button>
            ${q ? `<a href="/entertainment/ai/search" class="eai-btn" style="background:${C.g100};color:${C.g500}">Clear</a>` : ''}
          </form>
          ${!q ? sugHtml : ''}
        </div>
        ${searchResults ? `
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
            <h2 style="font-size:18px;color:${C.g900};margin:0">Results for "${esc(q)}"</h2>
            <span class="eai-badge" style="background:#dbeafe;color:#2563eb">${searchResults.totalResults} found</span>
          </div>
          ${resultSection('Videos', searchResults.videos, 'video')}
          ${resultSection('Music', searchResults.music, 'music')}
          ${resultSection('Games', searchResults.games, 'game')}
          ${resultSection('Posts', searchResults.posts, 'post')}
          ${resultSection('Forums', searchResults.forums, 'forum')}
          ${searchResults.totalResults === 0 ? '<div style="text-align:center;padding:40px;color:'+C.g500+'"><p style="font-size:16px">No results found. Try different keywords.</p></div>' : ''}
        ` : ''}
      </div>`, currentUser, true));
  }));

  // ═══════════════════════════════════════════════════════
  // 3. AUTO CONTENT TAGGING
  // ═══════════════════════════════════════════════════════
  app.get('/entertainment/ai/tags', ah(async (req, res) => {
    res.send(renderPage('AI Auto Tags', AI_CSS + `
      <div style="max-width:900px;margin:0 auto">
        ${navTabs('tags')}
        ${hero('🏷️ AI Auto-Tagging', 'Automatically generate tags for your content')}
        <div class="card" style="padding:24px;margin-bottom:20px">
          <h3 style="font-size:15px;font-weight:700;color:${C.g900};margin:0 0 16px">Generate Tags for Content</h3>
          <form method="POST" action="/entertainment/ai/tags/auto-tag/video/0" id="tagForm" style="display:flex;flex-direction:column;gap:14px">
            <div><label style="font-size:12px;font-weight:600;color:${C.g500};display:block;margin-bottom:4px">Content Type</label>
              <select name="type" class="eai-input" style="width:200px" id="tagType">
                <option value="video">🎬 Video</option>
                <option value="music">🎵 Music</option>
                <option value="post">📝 Post</option>
              </select></div>
            <div><label style="font-size:12px;font-weight:600;color:${C.g500};display:block;margin-bottom:4px">Content ID</label>
              <input type="number" name="content_id" class="eai-input" style="width:200px" placeholder="Enter ID" id="tagId" min="1"></div>
            <div><label style="font-size:12px;font-weight:600;color:${C.g500};display:block;margin-bottom:4px">Or enter title directly</label>
              <input type="text" name="title" class="eai-input" placeholder="Enter title for tag analysis..." id="tagTitle"></div>
            <div><label style="font-size:12px;font-weight:600;color:${C.g500};display:block;margin-bottom:4px">Description (optional)</label>
              <textarea name="description" class="eai-input" rows="3" placeholder="Enter description..." id="tagDesc"></textarea></div>
            <button type="button" class="eai-btn" onclick="generateTags()">🏷️ Generate Tags</button>
          </form>
          <div id="tagResults" style="margin-top:20px"></div>
        </div>
        <script>
          function generateTags() {
            const type = document.getElementById('tagType').value;
            const title = document.getElementById('tagTitle').value;
            const desc = document.getElementById('tagDesc').value;
            if (!title && !desc) { alert('Please enter a title or description'); return; }
            const text = (title + ' ' + desc).toLowerCase();
            const allTags = [];
            const videoGenres = ['tutorial','documentary','vlog','review','comedy','drama','action','horror','sci-fi','romance','thriller','animation','music video','live','educational','entertainment','gaming','cooking','travel','fitness','sports'];
            const musicMoods = ['happy','sad','energetic','calm','romantic','dark','upbeat','melancholic','chill','intense','dreamy','aggressive','peaceful','epic','nostalgic','groovy','ambient','party','workout','focus'];
            const musicGenres = ['pop','rock','hip-hop','jazz','classical','electronic','r&b','country','indie','lo-fi','metal','punk','blues','folk','reggae','soul','funk','techno','house','trap'];
            const postCats = ['news','opinion','tutorial','review','discussion','question','announcement','story','photo','video','meme','poll','event','recommendation','rant','achievement'];
            const candidates = [...videoGenres,...musicMoods,...musicGenres,...postCats];
            candidates.forEach(tag => {
              if (text.includes(tag)) allTags.push({tag, confidence: 90 + Math.floor(Math.random()*10)});
            });
            const words = text.split(/[^a-z0-9]+/).filter(w => w.length > 3);
            const freq = {};
            words.forEach(w => freq[w] = (freq[w]||0)+1);
            Object.entries(freq).filter(([w,c]) => c >= 2).forEach(([w,c]) => {
              if (!allTags.find(t => t.tag === w)) allTags.push({tag: w, confidence: Math.min(95, 50 + c*15)});
            });
            if (allTags.length === 0) allTags.push({tag: 'general', confidence: 40});
            const container = document.getElementById('tagResults');
            container.innerHTML = '<h4 style="margin:0 0 12px;color:#334155">Suggested Tags (' + allTags.length + ')</h4>' +
              '<div style="display:flex;flex-wrap:wrap;gap:8px">' +
              allTags.sort((a,b)=>b.confidence-a.confidence).map(t =>
                '<span style="display:inline-flex;align-items:center;gap:4px;padding:6px 14px;border-radius:20px;font-size:12px;font-weight:600;background:linear-gradient(135deg,#06b6d4,#3b82f6);color:#fff">' +
                t.tag + ' <span style="background:rgba(255,255,255,.25);padding:1px 6px;border-radius:10px;font-size:10px">' + t.confidence + '%</span></span>'
              ).join('') + '</div>';
          }
        </script>
      </div>`, u(req), true));
  }));

  app.post('/entertainment/ai/tags/auto-tag/:type/:id', ah(async (req, res) => {
    const { type, id } = req.params;
    let title = '', desc = '';
    if (type === 'video') {
      const row = (await pool.query(`SELECT title, description, category FROM videos WHERE id=$1`, [id])).rows[0];
      if (row) { title = row.title || ''; desc = row.description || ''; }
    } else if (type === 'music') {
      const row = (await pool.query(`SELECT title, artist, genre FROM music_tracks WHERE id=$1`, [id])).rows[0];
      if (row) { title = row.title || ''; desc = (row.artist||'') + ' ' + (row.genre||''); }
    }
    res.json({ success: true, type, id, title, description: desc });
  }));

  // ═══════════════════════════════════════════════════════
  // 4. CONTENT MODERATION
  // ═══════════════════════════════════════════════════════
  app.get('/entertainment/ai/moderation', requireAuth, ah(async (req, res) => {
    const currentUser = u(req);
    const tenantId = tid(req);
    const tab = req.query.tab || 'pending';

    // Get banned words list
    const bannedWords = (await pool.query(`SELECT word, category FROM ent_ai_banned_words ORDER BY category, word`)).rows;
    const bannedList = bannedWords.map(r => r.word.toLowerCase());

    // Auto-scan recent posts for flagged content
    const recentPosts = (await pool.query(`
      SELECT id, title, content, author, created_at FROM posts
      WHERE is_published = true AND created_at > NOW() - INTERVAL '7 days'
      ORDER BY created_at DESC LIMIT 50
    `)).rows;
    for (const post of recentPosts) {
      const text = ((post.title || '') + ' ' + (post.content || '')).toLowerCase();
      const found = bannedList.filter(w => text.includes(w));
      if (found.length > 0) {
        try {
          await pool.query(`
            INSERT INTO ent_ai_moderation (tenant_id, content_type, content_id, flagged_text, reason, status)
            VALUES ($1,$2,$3,$4,$5,'pending')
            ON CONFLICT DO NOTHING
          `, [tenantId, 'post', post.id, post.content?.substring(0, 200) || post.title, 'Contains: ' + found.join(', ')]);
        } catch(e) {}
      }
    }

    // Auto-scan recent comments
    const recentComments = (await pool.query(`
      SELECT vc.id, vc.comment as content, vc.user_email as author, vc.video_id as content_id, 'video_comment' as source
      FROM video_comments vc WHERE vc.created_at > NOW() - INTERVAL '7 days'
      ORDER BY vc.created_at DESC LIMIT 100
    `)).rows;
    for (const c of recentComments) {
      if (!c.content) continue;
      const text = c.content.toLowerCase();
      const found = bannedList.filter(w => text.includes(w));
      if (found.length > 0) {
        try {
          await pool.query(`
            INSERT INTO ent_ai_moderation (tenant_id, content_type, content_id, flagged_text, reason, status)
            VALUES ($1,$2,$3,$4,$5,'pending')
            ON CONFLICT DO NOTHING
          `, [tenantId, 'comment', c.id, c.content.substring(0, 200), 'Comment contains: ' + found.join(', ')]);
        } catch(e) {}
      }
    }

    // Fetch moderation queue
    const whereClause = tab === 'all' ? '1=1' : `status = '${tab === 'pending' ? 'pending' : tab}'`;
    const items = (await pool.query(`
      SELECT * FROM ent_ai_moderation WHERE tenant_id = $1 AND ${whereClause}
      ORDER BY created_at DESC LIMIT 50
    `, [tenantId])).rows;

    const counts = (await pool.query(`
      SELECT status, COUNT(*)::int as cnt FROM ent_ai_moderation WHERE tenant_id = $1 GROUP BY status
    `, [tenantId])).rows;
    const countMap = {};
    counts.forEach(r => countMap[r.status] = r.cnt);

    const tabs = [
      {id:'pending',label:`Pending (${countMap.pending||0})`,color:C.gold},
      {id:'approved',label:`Approved (${countMap.approved||0})`,color:C.green},
      {id:'rejected',label:`Rejected (${countMap.rejected||0})`,color:C.red},
      {id:'all',label:`All (${items.length})`,color:C.accent},
    ];

    const rows = items.map(item => `<tr>
      <td><span class="eai-badge" style="background:${item.content_type==='post'?'#dbeafe':'#fce7f3'};color:${item.content_type==='post'?'#2563eb':'#db2777'}">${esc(item.content_type)}</span></td>
      <td style="font-size:12px;max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(item.flagged_text||'—')}</td>
      <td style="font-size:12px;color:${C.g500}">${esc(item.reason||'—')}</td>
      <td><span class="eai-badge" style="background:${item.status==='pending'?'#fef3c7':item.status==='approved'?'#dcfce7':'#fee2e2'};color:${item.status==='pending'?'#92400e':item.status==='approved'?'#16a34a':'#dc2626'}">${esc(item.status)}</span></td>
      <td style="font-size:11px;color:${C.g500}">${fmtDate(item.created_at)}</td>
      <td style="font-size:11px">${item.reviewed_by ? esc(item.reviewed_by) : '—'}</td>
      <td style="white-space:nowrap">
        ${item.status === 'pending' ? `
          <form method="POST" action="/entertainment/ai/moderation/${item.content_type}/${item.id}/review" style="display:inline">
            <input type="hidden" name="action" value="approve">
            <button type="submit" class="eai-btn eai-btn-sm eai-btn-green">✓</button>
          </form>
          <form method="POST" action="/entertainment/ai/moderation/${item.content_type}/${item.id}/review" style="display:inline">
            <input type="hidden" name="action" value="reject">
            <button type="submit" class="eai-btn eai-btn-sm eai-btn-red">✗</button>
          </form>
        ` : '<span style="color:'+C.g300+'">—</span>'}
      </td>
    </tr>`).join('');

    res.send(renderPage('AI Moderation', AI_CSS + `
      <div style="max-width:1200px;margin:0 auto">
        ${navTabs('mod')}
        ${hero('🛡️ AI Content Moderation', 'Automated content scanning and review queue')}
        <div style="display:flex;flex-wrap:wrap;gap:14px;margin-bottom:20px">
          ${statBox(countMap.pending||0, 'Pending Review', C.gold)}
          ${statBox(countMap.approved||0, 'Approved', C.green)}
          ${statBox(countMap.rejected||0, 'Rejected', C.red)}
          ${statBox(bannedWords.length, 'Banned Words', C.red)}
        </div>
        <div style="display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap">
          ${tabs.map(t => `<a href="/entertainment/ai/moderation?tab=${t.id}" class="eai-tab ${t.id===tab?'active':''}" style="color:${t.id===tab?'#fff':t.color}">${t.label}</a>`).join('')}
        </div>
        ${card('Moderation Queue', `
          <div style="overflow-x:auto"><table class="eai-table">
            <thead><tr><th>Type</th><th>Flagged Text</th><th>Reason</th><th>Status</th><th>Date</th><th>Reviewer</th><th>Actions</th></tr></thead>
            <tbody>${rows || `<tr><td colspan="7" style="text-align:center;color:${C.g500};padding:30px">No items in queue</td></tr>`}</tbody>
          </table></div>
        `, tab === 'pending' ? C.gold : C.accent)}
      </div>`, currentUser));
  }));

  app.post('/entertainment/ai/moderation/:type/:id/review', requireAuth, ah(async (req, res) => {
    const currentUser = u(req);
    const { id } = req.params;
    const action = req.body.action;
    if (action !== 'approve' && action !== 'reject') return res.status(400).json({error:'Invalid action'});

    await pool.query(`
      UPDATE ent_ai_moderation SET status = $1, reviewed_by = $2, reviewed_at = NOW() WHERE id = $3
    `, [action === 'approve' ? 'approved' : 'rejected', currentUser.email, id]);

    audit('ai_moderation_review', { action, modId: id, by: currentUser.email });
    res.redirect('/entertainment/ai/moderation');
  }));

  // ═══════════════════════════════════════════════════════
  // 5. AI PLAYLIST GENERATOR
  // ═══════════════════════════════════════════════════════
  app.get('/entertainment/ai/playlist-generator', ah(async (req, res) => {
    res.send(renderPage('AI Playlist Generator', AI_CSS + `
      <div style="max-width:900px;margin:0 auto">
        ${navTabs('pl')}
        ${hero('🎵 AI Playlist Generator', 'Create the perfect playlist based on your mood')}
        <div class="card eai-glow" style="padding:28px;margin-bottom:20px">
          <form method="POST" action="/entertainment/ai/playlist-generator/create" style="display:flex;flex-direction:column;gap:16px">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
              <div><label style="font-size:12px;font-weight:600;color:${C.g500};display:block;margin-bottom:4px">Mood</label>
                <select name="mood" class="eai-input" style="width:100%">
                  ${MOODS.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('')}
                </select></div>
              <div><label style="font-size:12px;font-weight:600;color:${C.g500};display:block;margin-bottom:4px">Genre</label>
                <select name="genre" class="eai-input" style="width:100%">
                  <option value="">Any Genre</option>
                  ${GENRES.map(g => `<option value="${esc(g)}">${esc(g)}</option>`).join('')}
                </select></div>
            </div>
            <div><label style="font-size:12px;font-weight:600;color:${C.g500};display:block;margin-bottom:4px">Duration</label>
              <select name="duration" class="eai-input" style="width:200px">
                ${DURATIONS.map(d => `<option value="${d.sec}">${esc(d.label)}</option>`).join('')}
              </select></div>
            <button type="submit" class="eai-btn" style="align-self:flex-start;padding:12px 32px;font-size:15px">🎶 Generate Playlist</button>
          </form>
        </div>
        <div id="playlistResult"></div>
      </div>`, u(req), true));
  }));

  app.post('/entertainment/ai/playlist-generator/create', ah(async (req, res) => {
    const { mood, genre, duration } = req.body;
    const maxDuration = parseInt(duration) || 1800;

    // Query tracks matching mood/genre from the database
    const moodGenreMap = {
      'Happy': ['Pop','Indie','Folk'],
      'Sad': ['Classical','Indie','Lo-Fi','Blues'],
      'Energetic': ['Electronic','Rock','Hip-Hop','House'],
      'Calm': ['Classical','Lo-Fi','Jazz','Ambient'],
      'Romantic': ['R&B','Jazz','Soul','Pop'],
      'Focus': ['Lo-Fi','Classical','Ambient','Electronic'],
      'Workout': ['Electronic','Hip-Hop','Rock','House','Trap'],
      'Party': ['Pop','Electronic','Hip-Hop','House','Techno','Funk'],
    };

    const preferredGenres = genre ? [genre] : (moodGenreMap[mood] || []);

    let tracks = [];
    if (preferredGenres.length > 0) {
      const placeholders = preferredGenres.map((_, i) => `$${i + 1}`).join(',');
      tracks = (await pool.query(`
        SELECT * FROM music_tracks
        WHERE genre IN (${placeholders})
        ORDER BY RANDOM()
        LIMIT 30
      `, preferredGenres)).rows;
    }
    // Fallback: get any tracks if mood match returns nothing
    if (tracks.length === 0) {
      tracks = (await pool.query(`SELECT * FROM music_tracks ORDER BY RANDOM() LIMIT 30`)).rows;
    }

    // Build playlist within duration budget
    const playlist = [];
    let totalDuration = 0;
    for (const t of tracks) {
      const trackDur = parseInt(t.duration) || 210;
      if (totalDuration + trackDur <= maxDuration) {
        playlist.push(t);
        totalDuration += trackDur;
      }
      if (totalDuration >= maxDuration) break;
    }

    const moodEmoji = {Happy:'😊',Sad:'😢',Energetic:'⚡',Calm:'🧘',Romantic:'💕',Focus:'🎯',Workout:'💪',Party:'🎉'};
    const emoji = moodEmoji[mood] || '🎵';

    res.send(renderPage('Generated Playlist', AI_CSS + `
      <div style="max-width:900px;margin:0 auto">
        ${navTabs('pl')}
        ${hero(`${emoji} Your ${esc(mood)} Playlist`, `${esc(genre||'Mixed')} · ${playlist.length} tracks · ${fmtDur(totalDuration)}`)}
        <div style="margin-bottom:20px">
          ${playlist.map((t, i) => `
            <div style="display:flex;gap:14px;align-items:center;padding:14px;background:${C.white};border:1px solid ${C.g200};border-radius:12px;margin-bottom:8px;border-left:4px solid ${i<3?'#f59e0b':C.primary}">
              <div style="min-width:32px;height:32px;background:linear-gradient(135deg,#06b6d4,#3b82f6);border-radius:8px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:13px;font-weight:700">${i+1}</div>
              <div style="flex:1">
                <div style="font-weight:600;font-size:14px;color:${C.g900}">${esc(t.title||'Untitled')}</div>
                <div style="font-size:12px;color:${C.g500}">${esc(t.artist||'Unknown Artist')} ${t.genre ? '· '+esc(t.genre) : ''}</div>
              </div>
              <div style="font-size:12px;color:${C.g500};min-width:50px;text-align:right">${fmtDur(t.duration)}</div>
              <button class="eai-btn eai-btn-sm" onclick="this.innerHTML=this.innerHTML==='▶'?'⏸':'▶'">▶</button>
            </div>
          `).join('')}
          ${playlist.length === 0 ? '<div style="text-align:center;padding:40px;color:'+C.g500+'">No tracks found. Add music to your library first!</div>' : ''}
        </div>
        <div style="display:flex;gap:12px">
          <a href="/entertainment/ai/playlist-generator" class="eai-btn">🔄 Generate Another</a>
        </div>
      </div>`, u(req), true));
  }));

  // ═══════════════════════════════════════════════════════
  // 6. SENTIMENT ANALYSIS DASHBOARD
  // ═══════════════════════════════════════════════════════
  function analyzeSentiment(text) {
    if (!text) return { score: 0, positive: 0, negative: 0, words: [] };
    const lower = text.toLowerCase();
    const words = lower.split(/[^a-z]+/).filter(w => w.length > 2);
    let positive = 0, negative = 0;
    const matchedPositive = [], matchedNegative = [];
    for (const w of words) {
      if (POSITIVE_WORDS.includes(w)) { positive++; matchedPositive.push(w); }
      if (NEGATIVE_WORDS.includes(w)) { negative++; matchedNegative.push(w); }
    }
    return { score: positive - negative, positive, negative, words: [...matchedPositive, ...matchedNegative] };
  }

  app.get('/entertainment/ai/sentiment', ah(async (req, res) => {
    const currentUser = u(req);
    const tenantId = tid(req);

    // Analyze video comments
    const videoComments = (await pool.query(`
      SELECT vc.id, vc.comment, vc.video_id, v.title as video_title, vc.user_email, vc.created_at
      FROM video_comments vc LEFT JOIN videos v ON v.id = vc.video_id
      ORDER BY vc.created_at DESC LIMIT 100
    `)).rows;

    // Analyze all comments and save sentiment
    const results = [];
    for (const c of videoComments) {
      const sent = analyzeSentiment(c.comment);
      results.push({ ...c, ...sent });
      try {
        await pool.query(`
          INSERT INTO ent_ai_sentiment (tenant_id, content_type, content_id, sentiment_score, positive_words, negative_words)
          VALUES ($1,'comment',$2,$3,$4,$5)
          ON CONFLICT DO NOTHING
        `, [tenantId, c.id, sent.score, sent.positive, sent.negative]);
      } catch(e) {}
    }

    // Stats
    const totalAnalyzed = results.length;
    const positiveCount = results.filter(r => r.score > 0).length;
    const negativeCount = results.filter(r => r.score < 0).length;
    const neutralCount = results.filter(r => r.score === 0).length;
    const avgSentiment = totalAnalyzed > 0 ? (results.reduce((s,r) => s + r.score, 0) / totalAnalyzed).toFixed(2) : 0;

    // Most positive / negative
    const mostPositive = results.filter(r => r.score > 0).sort((a,b) => b.score - a.score).slice(0, 5);
    const mostNegative = results.filter(r => r.score < 0).sort((a,b) => a.score - b.score).slice(0, 5);

    // CSS pie chart
    const posPct = totalAnalyzed > 0 ? Math.round((positiveCount / totalAnalyzed) * 100) : 0;
    const negPct = totalAnalyzed > 0 ? Math.round((negativeCount / totalAnalyzed) * 100) : 0;
    const neuPct = totalAnalyzed > 0 ? 100 - posPct - negPct : 0;

    function sentimentRow(item, type) {
      const isPos = type === 'positive';
      return `<div style="display:flex;gap:10px;align-items:center;padding:10px;background:${C.g50};border-radius:8px;margin-bottom:6px;border-left:4px solid ${isPos?C.green:C.red}">
        <span style="font-size:18px">${isPos?'😊':'😞'}</span>
        <div style="flex:1;font-size:13px;color:${C.g700};line-height:1.4">${esc(String(item.comment).substring(0,120))}</div>
        <span class="eai-badge" style="background:${isPos?'#dcfce7':'#fee2e2'};color:${isPos?'#16a34a':'#dc2626'}">${isPos?'+':''}${item.score}</span>
      </div>`;
    }

    res.send(renderPage('AI Sentiment Analysis', AI_CSS + `
      <div style="max-width:1100px;margin:0 auto">
        ${navTabs('sent')}
        ${hero('💬 Sentiment Analysis Dashboard', 'AI-powered comment and review sentiment analysis')}
        <div style="display:flex;flex-wrap:wrap;gap:14px;margin-bottom:20px">
          ${statBox(totalAnalyzed, 'Comments Analyzed', C.primary)}
          ${statBox(avgSentiment, 'Avg Score', parseFloat(avgSentiment) >= 0 ? C.green : C.red)}
          ${statBox(positiveCount, 'Positive', C.green)}
          ${statBox(negativeCount, 'Negative', C.red)}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px">
          ${card('Overall Sentiment', `
            <div style="display:flex;align-items:center;gap:20px">
              <div style="width:140px;height:140px;border-radius:50%;background:conic-gradient(${C.green} 0% ${posPct}%, ${C.g200} ${posPct}% ${posPct+neuPct}%, ${C.red} ${posPct+neuPct}% 100%);position:relative;flex-shrink:0">
                <div style="position:absolute;inset:20px;background:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-direction:column">
                  <div style="font-size:22px;font-weight:700;color:${C.g900}">${posPct}%</div>
                  <div style="font-size:10px;color:${C.g500}">Positive</div>
                </div>
              </div>
              <div style="font-size:13px;color:${C.g500}">
                <div>😊 Positive: <strong style="color:${C.green}">${positiveCount}</strong> (${posPct}%)</div>
                <div>😐 Neutral: <strong>${neutralCount}</strong> (${neuPct}%)</div>
                <div>😞 Negative: <strong style="color:${C.red}">${negativeCount}</strong> (${negPct}%)</div>
              </div>
            </div>
          `, C.accent)}
          ${card('Trend Over Time', `
            <div style="font-size:13px;color:${C.g500}">
              <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid ${C.g100}">
                <span>This Week</span><strong style="color:${parseFloat(avgSentiment)>=0?C.green:C.red}">${avgSentiment}</strong>
              </div>
              <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid ${C.g100}">
                <span>Positive Ratio</span><strong style="color:${C.green}">${posPct}%</strong>
              </div>
              <div style="display:flex;justify-content:space-between;padding:6px 0">
                <span>Negative Ratio</span><strong style="color:${C.red}">${negPct}%</strong>
              </div>
            </div>
          `, C.purple)}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
          ${card('😊 Most Positive', mostPositive.map(i => sentimentRow(i, 'positive')).join('') || '<p style="color:'+C.g500+';text-align:center">No positive comments</p>', C.green)}
          ${card('😞 Most Negative', mostNegative.map(i => sentimentRow(i, 'negative')).join('') || '<p style="color:'+C.g500+';text-align:center">No negative comments</p>', C.red)}
        </div>
      </div>`, currentUser, true));
  }));

  // ═══════════════════════════════════════════════════════
  // 7. TRENDING CONTENT ENGINE
  // ═══════════════════════════════════════════════════════
  app.get('/entertainment/ai/trending', ah(async (req, res) => {
    const tenantId = tid(req);
    const currentUser = u(req);

    // Calculate trending scores for videos
    try {
      await pool.query(`
        INSERT INTO ent_ai_trending (tenant_id, content_type, content_id, trending_score, views_day, likes, comments, calculated_at)
        SELECT $1, 'video', v.id,
          (COALESCE(v.views,0) * 1 + COALESCE(v.likes,0) * 2 +
           (SELECT COUNT(*) FROM video_comments vc WHERE vc.video_id = v.id) * 2) /
          GREATEST(EXTRACT(EPOCH FROM (NOW() - v.created_at)) / 3600, 1),
          COALESCE(v.views,0), COALESCE(v.likes,0),
          (SELECT COUNT(*) FROM video_comments vc WHERE vc.video_id = v.id),
          NOW()
        FROM videos v
        WHERE v.is_published = true AND v.created_at > NOW() - INTERVAL '30 days'
        ON CONFLICT DO NOTHING
      `, [tenantId]);
    } catch(e) {}

    // Fetch trending content
    const trendingItems = (await pool.query(`
      SELECT t.*,
        COALESCE(v.title, m.title, g.title, p.title) as title,
        COALESCE(v.category, m.genre, g.category) as category,
        v.thumbnail_url, m.artist, m.duration, g.plays
      FROM ent_ai_trending t
      LEFT JOIN videos v ON v.id = t.content_id AND t.content_type = 'video'
      LEFT JOIN music_tracks m ON m.id = t.content_id AND t.content_type = 'music'
      LEFT JOIN games g ON g.id = t.content_id AND t.content_type = 'game'
      LEFT JOIN posts p ON p.id = t.content_id AND t.content_type = 'post'
      WHERE t.tenant_id = $1
      ORDER BY t.trending_score DESC LIMIT 30
    `, [tenantId])).rows;

    // Classify: Rising (< 1 day old, high score), Hot (consistently popular), Trending Now
    const rising = trendingItems.filter(t => {
      const age = (Date.now() - new Date(t.calculated_at).getTime()) / 3600000;
      return age < 24 && (t.trending_score || 0) > 0;
    });
    const hot = trendingItems.filter(t => (t.trending_score || 0) > 5).slice(0, 10);
    const trendingNow = trendingItems.slice(0, 15);

    const typeIcons = {video:'🎬',music:'🎵',game:'🎮',post:'📝'};
    const typeColors = {video:'#7c3aed',music:'#ec4899',game:'#f59e0b',post:'#3b82f6'};

    function trendCard(item, rank) {
      return `<div style="display:flex;gap:12px;align-items:center;padding:14px;background:${C.white};border:1px solid ${C.g200};border-radius:12px;border-left:4px solid ${typeColors[item.content_type]||C.primary};transition:.15s;cursor:pointer" onclick="location.href='/${item.content_type==='post'?'posts':item.content_type}/${esc(item.content_id)}'">
        <div style="min-width:32px;height:32px;background:linear-gradient(135deg,${typeColors[item.content_type]||C.primary},${typeColors[item.content_type]||C.primary}cc);border-radius:8px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:14px">${rank}</div>
        <div style="min-width:36px;height:36px;background:${C.g100};border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:18px">${typeIcons[item.content_type]||'🎯'}</div>
        <div style="flex:1">
          <div style="font-weight:600;font-size:13px;color:${C.g900}">${esc(item.title||'Untitled')}</div>
          <div style="font-size:11px;color:${C.g500}">${item.artist?esc(item.artist)+' · ':''}${esc(item.category||item.content_type)} ${item.duration?'· '+fmtDur(item.duration):''}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:16px;font-weight:700;color:${C.primary}">${(item.trending_score||0).toFixed(1)}</div>
          <div style="font-size:10px;color:${C.g500}">score</div>
        </div>
      </div>`;
    }

    res.send(renderPage('AI Trending Engine', AI_CSS + `
      <div style="max-width:1000px;margin:0 auto">
        ${navTabs('trend')}
        ${hero('🔥 Trending Content Engine', 'Real-time trending algorithm powered by AI')}
        <div style="display:flex;flex-wrap:wrap;gap:14px;margin-bottom:20px">
          ${statBox(trendingNow.length, 'Trending', C.gold)}
          ${statBox(rising.length, 'Rising', C.green)}
          ${statBox(hot.length, 'Hot', C.red)}
          ${statBox('30d', 'Window', C.accent)}
        </div>
        <div style="display:grid;grid-template-columns:2fr 1fr;gap:20px">
          <div>
            ${card('🔥 Trending Now', trendingNow.map((t,i) => trendCard(t,i+1)).join('') || '<p style="color:'+C.g500+';text-align:center;padding:20px">No trending content yet</p>', C.gold)}
          </div>
          <div>
            ${card('📈 Rising', rising.slice(0,5).map((t,i) => trendCard(t,i+1)).join('') || '<p style="color:'+C.g500+';text-align:center">No rising content</p>', C.green)}
            ${card('♨️ Hot', hot.slice(0,5).map((t,i) => trendCard(t,i+1)).join('') || '<p style="color:'+C.g500+';text-align:center">No hot content</p>', C.red)}
          </div>
        </div>
      </div>`, currentUser, true));
  }));

  // ═══════════════════════════════════════════════════════
  // 8. CONTENT SUMMARIZATION
  // ═══════════════════════════════════════════════════════
  app.get('/entertainment/ai/summary/:type/:id', ah(async (req, res) => {
    const { type, id } = req.params;
    const currentUser = u(req);
    let summaryHtml = '';

    if (type === 'video') {
      const video = (await pool.query(`
        SELECT v.*, (SELECT COUNT(*)::int FROM video_comments vc WHERE vc.video_id = v.id) as comment_count
        FROM videos v WHERE v.id = $1
      `, [id])).rows[0];
      if (!video) return res.status(404).send(renderPage('Not Found', '<div class="card" style="text-align:center;padding:48px"><h2>Content not found</h2></div>', null, true));

      const comments = (await pool.query(`
        SELECT * FROM video_comments WHERE video_id = $1 ORDER BY created_at DESC LIMIT 10
      `, [id])).rows;

      const topComments = comments.slice(0, 3).map(c => `
        <div style="padding:10px;background:${C.g50};border-radius:8px;margin-bottom:6px">
          <div style="font-weight:600;font-size:12px;color:${C.g900}">${esc(c.user_name||'Anonymous')}</div>
          <div style="font-size:12px;color:${C.g500};line-height:1.4">${esc(c.comment)}</div>
        </div>
      `).join('');

      summaryHtml = card('🎬 Video Summary', `
        <div style="display:flex;gap:16px;align-items:center;margin-bottom:16px;flex-wrap:wrap">
          ${video.thumbnail_url ? `<img src="${esc(video.thumbnail_url)}" style="width:200px;border-radius:12px;object-fit:cover" alt="${esc(video.title)}">` : '<div style="width:200px;height:120px;background:linear-gradient(135deg,#06b6d4,#3b82f6);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:40px">🎬</div>'}
          <div>
            <h2 style="font-size:20px;color:${C.g900};margin:0 0 6px">${esc(video.title)}</h2>
            ${video.category ? `<span class="eai-badge" style="background:#dbeafe;color:#2563eb;margin-right:6px">${esc(video.category)}</span>` : ''}
            <span class="eai-badge" style="background:#f3e8ff;color:#7c3aed">${video.views||0} views</span>
            <span class="eai-badge" style="background:#fce7f3;color:#db2777">${video.likes||0} likes</span>
            ${video.duration ? `<div style="margin-top:6px;font-size:13px;color:${C.g500}">⏱ Duration: ${fmtDur(video.duration)}</div>` : ''}
            <div style="font-size:12px;color:${C.g500};margin-top:4px">📅 ${fmtDate(video.created_at)}</div>
          </div>
        </div>
        ${video.description ? `<div style="font-size:14px;color:${C.g500};line-height:1.7;padding:14px;background:${C.g50};border-radius:10px">${esc(video.description)}</div>` : ''}
        <div style="margin-top:16px"><h4 style="font-size:14px;color:${C.g900};margin:0 0 8px">💬 Top Comments (${comments.length})</h4>${topComments || '<p style="color:'+C.g500+';font-size:13px">No comments yet</p>'}</div>
      `, C.primary);

    } else if (type === 'post') {
      const post = (await pool.query(`SELECT * FROM posts WHERE id = $1`, [id])).rows[0];
      if (!post) return res.status(404).send(renderPage('Not Found', '<div class="card" style="text-align:center;padding:48px"><h2>Content not found</h2></div>', null, true));

      const content = post.content || '';
      const isLong = content.length > 300;
      const summary = isLong ? content.substring(0, 300) + '...' : content;

      summaryHtml = card('📝 Post Summary', `
        <h2 style="font-size:20px;color:${C.g900};margin:0 0 8px">${esc(post.title||'Untitled')}</h2>
        <div style="font-size:12px;color:${C.g500};margin-bottom:12px">
          By ${esc(post.author||'Unknown')} · ${fmtDate(post.created_at)}
          ${post.likes ? ` · ❤️ ${post.likes} likes` : ''}
        </div>
        <div style="font-size:14px;color:${C.g700};line-height:1.7;padding:14px;background:${C.g50};border-radius:10px">
          ${esc(summary)}
        </div>
        ${isLong ? `<a href="/posts/${esc(id)}" class="eai-btn eai-btn-sm" style="margin-top:12px;display:inline-block;text-decoration:none">📖 Read Full Post</a>` : ''}
      `, C.accent);

    } else if (type === 'forum') {
      const thread = (await pool.query(`
        SELECT ft.*, u.name as author_name FROM forum_threads ft
        LEFT JOIN users u ON u.id = ft.user_id
        WHERE ft.id = $1
      `, [id])).rows[0];
      if (!thread) return res.status(404).send(renderPage('Not Found', '<div class="card" style="text-align:center;padding:48px"><h2>Content not found</h2></div>', null, true));

      const replies = (await pool.query(`
        SELECT * FROM forum_replies WHERE thread_id = $1 ORDER BY created_at ASC LIMIT 3
      `, [id])).rows;

      const replyHtml = replies.map(r => `
        <div style="padding:10px;background:${C.g50};border-radius:8px;margin-bottom:6px">
          <div style="font-size:12px;font-weight:600;color:${C.g900}">${esc(r.author||'Anonymous')}</div>
          <div style="font-size:12px;color:${C.g500};line-height:1.4">${esc((r.content||'').substring(0,150))}</div>
        </div>
      `).join('');

      summaryHtml = card('💬 Forum Thread Summary', `
        <h2 style="font-size:20px;color:${C.g900};margin:0 0 8px">${esc(thread.title||'Untitled')}</h2>
        <div style="font-size:12px;color:${C.g500};margin-bottom:12px">
          By ${esc(thread.author_name||'Unknown')} · ${fmtDate(thread.created_at)}
        </div>
        ${thread.content ? `<div style="font-size:14px;color:${C.g700};line-height:1.7;padding:14px;background:${C.g50};border-radius:10px;margin-bottom:14px">${esc(thread.content)}</div>` : ''}
        <h4 style="font-size:14px;color:${C.g900};margin:0 0 8px">Top Replies</h4>
        ${replyHtml || '<p style="color:'+C.g500+';font-size:13px">No replies yet</p>'}
      `, C.green);

    } else if (type === 'podcast') {
      const podcast = (await pool.query(`SELECT * FROM podcasts WHERE id = $1`, [id])).rows[0];
      if (!podcast) return res.status(404).send(renderPage('Not Found', '<div class="card" style="text-align:center;padding:48px"><h2>Content not found</h2></div>', null, true));

      const episodes = (await pool.query(`
        SELECT * FROM podcast_episodes WHERE podcast_id = $1 ORDER BY season, episode_number
      `, [id])).rows;

      const epList = episodes.map(ep => `
        <div style="display:flex;gap:12px;align-items:center;padding:10px;background:${C.g50};border-radius:8px;margin-bottom:6px">
          <div style="min-width:40px;height:40px;background:linear-gradient(135deg,#ec4899,#be185d);border-radius:8px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;font-weight:700">S${ep.season||1}E${ep.episode_number||'?'}</div>
          <div style="flex:1">
            <div style="font-weight:600;font-size:13px;color:${C.g900}">${esc(ep.title)}</div>
            ${ep.description ? `<div style="font-size:11px;color:${C.g500}">${esc(ep.description.substring(0,80))}</div>` : ''}
          </div>
          <div style="font-size:12px;color:${C.g500}">${ep.duration ? fmtDur(ep.duration) : '—'}</div>
        </div>
      `).join('');

      summaryHtml = card('🎙 Podcast Summary', `
        <div style="display:flex;gap:16px;align-items:center;margin-bottom:16px;flex-wrap:wrap">
          ${podcast.cover_url ? `<img src="${esc(podcast.cover_url)}" style="width:120px;height:120px;border-radius:12px;object-fit:cover">` : '<div style="width:120px;height:120px;background:linear-gradient(135deg,#ec4899,#be185d);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:40px">🎙</div>'}
          <div>
            <h2 style="font-size:20px;color:${C.g900};margin:0 0 4px">${esc(podcast.title)}</h2>
            <div style="font-size:13px;color:${C.g500}">by ${esc(podcast.author||'Unknown')}</div>
            ${podcast.category ? `<span class="eai-badge" style="background:#fce7f3;color:#db2777;margin-top:6px">${esc(podcast.category)}</span>` : ''}
          </div>
        </div>
        ${podcast.description ? `<div style="font-size:14px;color:${C.g700};line-height:1.7;padding:14px;background:${C.g50};border-radius:10px;margin-bottom:14px">${esc(podcast.description)}</div>` : ''}
        <h4 style="font-size:14px;color:${C.g900};margin:0 0 8px">📋 Episodes (${episodes.length})</h4>
        ${epList || '<p style="color:'+C.g500+';font-size:13px">No episodes yet</p>'}
      `, '#ec4899');

    } else {
      summaryHtml = card('Unsupported Type', `<p style="color:${C.g500}">Summary not available for type: ${esc(type)}</p>`, C.g500);
    }

    res.send(renderPage('AI Content Summary', AI_CSS + `
      <div style="max-width:900px;margin:0 auto">
        ${navTabs('')}
        ${hero('🤖 AI Content Summary', 'Auto-generated summary for ' + esc(type) + ' #' + esc(id))}
        ${summaryHtml}
        <div style="margin-top:16px">
          <a href="/entertainment/ai/recommendations" class="eai-btn" style="text-decoration:none;margin-right:8px">🎯 Get Recommendations</a>
          <a href="/entertainment/ai/sentiment" class="eai-btn" style="background:linear-gradient(135deg,#10b981,#059669);text-decoration:none">💬 View Sentiment</a>
        </div>
      </div>`, currentUser, true));
  }));

  // ═══════════════════════════════════════════════════════
  // API: Calculate & Refresh Trending Scores
  // ═══════════════════════════════════════════════════════
  app.post('/api/entertainment/ai/trending/refresh', requireAuth, ah(async (req, res) => {
    const tenantId = tid(req);
    // Refresh video trending
    try {
      await pool.query(`
        INSERT INTO ent_ai_trending (tenant_id, content_type, content_id, trending_score, views_day, likes, comments, calculated_at)
        SELECT $1, 'video', v.id,
          (COALESCE(v.views,0) * 1 + COALESCE(v.likes,0) * 2 +
           (SELECT COUNT(*) FROM video_comments vc WHERE vc.video_id = v.id) * 2) /
          GREATEST(EXTRACT(EPOCH FROM (NOW() - v.created_at)) / 3600, 1),
          COALESCE(v.views,0), COALESCE(v.likes,0),
          (SELECT COUNT(*) FROM video_comments vc WHERE vc.video_id = v.id),
          NOW()
        FROM videos v WHERE v.is_published = true AND v.created_at > NOW() - INTERVAL '30 days'
        ON CONFLICT DO NOTHING
      `, [tenantId]);
    } catch(e) {}

    // Refresh post trending
    try {
      await pool.query(`
        INSERT INTO ent_ai_trending (tenant_id, content_type, content_id, trending_score, likes, comments, calculated_at)
        SELECT $1, 'post', p.id,
          (COALESCE(p.likes,0) * 2 + (SELECT COUNT(*) FROM post_comments pc WHERE pc.post_id = p.id) * 2) /
          GREATEST(EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 3600, 1),
          COALESCE(p.likes,0),
          (SELECT COUNT(*) FROM post_comments pc WHERE pc.post_id = p.id),
          NOW()
        FROM posts p WHERE p.is_published = true AND p.created_at > NOW() - INTERVAL '30 days'
        ON CONFLICT DO NOTHING
      `, [tenantId]);
    } catch(e) {}

    audit('ai_trending_refresh', { by: u(req).email });
    res.json({ success: true, message: 'Trending scores refreshed' });
  }));

  // ═══════════════════════════════════════════════════════
  // API: Get Quick Recommendations (JSON)
  // ═══════════════════════════════════════════════════════
  app.get('/api/entertainment/ai/recommendations', ah(async (req, res) => {
    const email = req.query.email || u(req).email || '';
    if (!email) return res.json({ success: true, recommendations: [] });

    const recs = (await pool.query(`
      SELECT * FROM ent_ai_recommendations
      WHERE user_email = $1
      ORDER BY score DESC LIMIT 20
    `, [email])).rows;

    res.json({ success: true, recommendations: recs });
  }));

  // ═══════════════════════════════════════════════════════
  // API: Sentiment Analysis Endpoint
  // ═══════════════════════════════════════════════════════
  app.post('/api/entertainment/ai/sentiment/analyze', ah(async (req, res) => {
    const { text } = req.body;
    if (!text) return res.json({ success: false, error: 'Text required' });
    const result = analyzeSentiment(text);
    res.json({ success: true, ...result });
  }));
};
