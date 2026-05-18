// ============================================================
// === ENTERTAINMENT SHORTS — TikTok-Style Shorts, Memes,     ===
// === Voice Rooms, Watch Parties                             ===
// ============================================================

'use strict';

module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit } = opts;
  const P = '#ec4899', A = '#f59e0b', DARK = '#0a0a0a', GRAY = '#9ca3af';

  // ── MEME TEMPLATES ────────────────────────────────────────
  const MEME_TEMPLATES = [
    { id: 'drake', name: 'Drake Hotline Bling', top: 'When you...', bottom: 'But then...', bg: '#f8f9fa', panels: 2, colors: ['#e74c3c','#2ecc71'] },
    { id: 'distracted', name: 'Distracted Boyfriend', top: 'Me looking at...', bottom: 'My current...', bg: '#ffeaa7', panels: 2, colors: ['#fd79a8','#0984e3'] },
    { id: 'changemymind', name: 'Change My Mind', top: '', bottom: '', bg: '#27ae60', panels: 1, colors: ['#fff'] },
    { id: 'twobuttons', name: 'Two Buttons', top: 'Button 1', bottom: 'Button 2', bg: '#636e72', panels: 2, colors: ['#e17055','#00b894'] },
    { id: 'brain', name: 'Expanding Brain', top: '', bottom: '', bg: '#2d3436', panels: 4, colors: ['#b2bec3','#dfe6e9','#74b9ff','#a29bfe'] },
    { id: 'thisisfine', name: 'This Is Fine', top: '', bottom: '', bg: '#d63031', panels: 1, colors: ['#ffeaa7'] },
    { id: 'simply', name: 'One Does Not Simply', top: 'One does not simply', bottom: '', bg: '#2c3e50', panels: 1, colors: ['#ecf0f1'] },
    { id: 'success', name: 'Success Kid', top: '', bottom: '', bg: '#00b894', panels: 1, colors: ['#fff'] },
    { id: 'batman', name: 'Batman Slapping Robin', top: '', bottom: '', bg: '#2d3436', panels: 2, colors: ['#fdcb6e','#74b9ff'] },
    { id: 'pikachu', name: 'Surprised Pikachu', top: '', bottom: '', bg: '#fdcb6e', panels: 1, colors: ['#2d3436'] }
  ];

  const MUSIC_TRACKS = [
    'Original Audio', 'Pop Vibes', 'Lo-Fi Chill', 'Hip Hop Beat', 'Dance Remix',
    'Acoustic Guitar', 'Piano Melody', 'EDM Drop', 'R&B Groove', 'Trap Beat',
    'Reggaeton Flow', 'Indie Folk', 'Jazz Smooth', 'Rock Anthem', 'Country Road'
  ];

  const VOICE_CATEGORIES = ['Music', 'Gaming', 'Study', 'General', 'Debate'];
  const SHORTS_PRIVACY = ['public', 'followers', 'private'];

  // ── HELPERS ───────────────────────────────────────────────
  const fmtDate = d => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
  const fmtAgo = d => {
    if (!d) return '';
    const s = Math.floor((Date.now() - new Date(d)) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  };
  const fmtDuration = s => { if (!s) return '0:00'; const m = Math.floor(s / 60); return m + ':' + String(Math.floor(s % 60)).padStart(2, '0'); };
  const genCode = () => Math.random().toString(36).substring(2, 8).toUpperCase();
  const navLink = (href, label, active, icon) => `<a href="${href}" style="padding:8px 18px;border-radius:12px;font-size:13px;font-weight:600;text-decoration:none;color:${active ? '#fff' : '#6b7280'};background:${active ? P : '#f3f4f6'};transition:.15s;white-space:nowrap">${icon ? icon + ' ' : ''}${label}</a>`;
  const statBox = (val, lbl, col) => `<div style="text-align:center;padding:16px;background:#fff;border:1px solid #f3f4f6;border-radius:14px"><div style="font-size:26px;font-weight:800;color:${col || P}">${val}</div><div style="font-size:11px;color:${GRAY};margin-top:4px;text-transform:uppercase;letter-spacing:.3px">${lbl}</div></div>`;
  const emojiBtn = (emoji, label, partyId) => `<button onclick="sendReaction('${esc(partyId)}','${emoji}')" style="background:none;border:2px solid #f3f4f6;border-radius:10px;padding:6px 12px;font-size:18px;cursor:pointer;transition:.15s" title="${label}">${emoji}</button>`;

  // ── CSS ───────────────────────────────────────────────────
  const CSS = `<style>
    .es-nav{display:flex;gap:6px;margin-bottom:20px;flex-wrap:wrap;align-items:center}
    .es-hero{background:linear-gradient(135deg,#ec4899,#f59e0b);border-radius:18px;padding:36px 28px;text-align:center;color:#fff;margin-bottom:24px}
    .es-hero h1{font-size:30px;margin:0 0 6px}.es-hero p{opacity:.9;margin:0;font-size:14px}
    .es-card{background:#fff;border:1px solid #f3f4f6;border-radius:14px;overflow:hidden;transition:.2s}
    .es-card:hover{box-shadow:0 4px 20px rgba(0,0,0,.08)}
    .es-btn{padding:10px 20px;border-radius:10px;border:none;font-size:13px;font-weight:600;cursor:pointer;transition:.15s;display:inline-flex;align-items:center;gap:6px}
    .es-btn:hover{transform:translateY(-1px)}.es-btn-primary{background:${P};color:#fff}.es-btn-primary:hover{background:#db2777}
    .es-btn-amber{background:${A};color:#fff}.es-btn-ghost{background:#f3f4f6;color:#374151}.es-btn-ghost:hover{background:#e5e7eb}
    .es-btn-danger{background:#dc2626;color:#fff}
    .es-input{width:100%;padding:10px 14px;border:2px solid #e5e7eb;border-radius:10px;font-size:14px;box-sizing:border-box;transition:.15s;font-family:inherit}
    .es-input:focus{outline:none;border-color:${P}}
    .es-label{display:block;font-size:12px;font-weight:600;color:#6b7280;margin-bottom:4px;text-transform:uppercase;letter-spacing:.3px}
    .es-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}
    .es-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin-bottom:20px}

    /* Shorts Feed - Dark Theme */
    .es-feed{max-width:420px;margin:0 auto;height:calc(100vh - 80px);overflow-y:auto;scroll-snap-type:y mandatory;background:${DARK};border-radius:18px;position:relative}
    .es-short{height:calc(100vh - 80px);scroll-snap-align:start;position:relative;background:${DARK};display:flex;flex-direction:column;justify-content:flex-end}
    .es-short-video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#111}
    .es-short-overlay{position:absolute;bottom:0;left:0;right:70px;padding:20px;z-index:2;background:linear-gradient(transparent,rgba(0,0,0,.85))}
    .es-short-actions{position:absolute;right:12px;bottom:100px;display:flex;flex-direction:column;gap:20px;z-index:3;align-items:center}
    .es-action-btn{display:flex;flex-direction:column;align-items:center;gap:2px;color:#fff;font-size:11px;cursor:pointer;background:none;border:none}
    .es-action-btn .icon{width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,.15);display:flex;align-items:center;justify-content:center;font-size:22px;backdrop-filter:blur(4px);transition:.2s}
    .es-action-btn .icon:hover{background:rgba(255,255,255,.3);transform:scale(1.1)}
    .es-action-btn.liked .icon{background:${P};color:#fff}
    .es-action-btn.bookmarked .icon{background:${A};color:#fff}

    /* Tabs */
    .es-tabs{display:flex;gap:0;background:#f3f4f6;border-radius:12px;padding:3px;margin-bottom:20px}
    .es-tab{flex:1;padding:10px 16px;border-radius:10px;text-align:center;font-size:13px;font-weight:600;cursor:pointer;color:#6b7280;transition:.2s;text-decoration:none}
    .es-tab.active{background:#fff;color:${P};box-shadow:0 1px 3px rgba(0,0,0,.1)}

    /* Meme */
    .es-meme-box{border-radius:14px;padding:24px;text-align:center;position:relative;overflow:hidden;min-height:280px;display:flex;flex-direction:column;justify-content:space-between}
    .es-meme-box .top-text{font-size:22px;font-weight:900;text-transform:uppercase;letter-spacing:1px;text-shadow:2px 2px 0 rgba(0,0,0,.3);padding:10px}
    .es-meme-box .bottom-text{font-size:22px;font-weight:900;text-transform:uppercase;letter-spacing:1px;text-shadow:2px 2px 0 rgba(0,0,0,.3);padding:10px}
    .es-meme-box .meme-icon{font-size:64px;margin:20px auto;filter:drop-shadow(0 4px 8px rgba(0,0,0,.2))}

    /* Voice Room */
    .es-room{background:#fff;border:1px solid #f3f4f6;border-radius:16px;overflow:hidden;transition:.2s}
    .es-room:hover{box-shadow:0 4px 20px rgba(0,0,0,.08)}
    .es-avatar{width:48px;height:48px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700;color:#fff;flex-shrink:0}
    .es-speaker-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(80px,1fr));gap:12px;justify-items:center}
    .es-speaker{text-align:center}.es-speaker .es-avatar{margin:0 auto 6px}
    .es-speaker .name{font-size:11px;color:#6b7280;max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

    /* Watch Party */
    .es-party-chat{height:300px;overflow-y:auto;padding:12px;background:#f9fafb;border-radius:12px;border:1px solid #f3f4f6;display:flex;flex-direction:column;gap:6px}
    .es-chat-msg{padding:8px 12px;background:#fff;border-radius:10px;font-size:13px;border:1px solid #f3f4f6;animation:fadeUp .3s}
    @keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}

    /* Floating Emoji */
    @keyframes floatUp{0%{opacity:1;transform:translateY(0) scale(1)}100%{opacity:0;transform:translateY(-200px) scale(1.5)}}
    .float-emoji{position:absolute;bottom:60px;font-size:32px;animation:floatUp 2s ease-out forwards;pointer-events:none;z-index:10}

    /* Comment panel */
    .es-comment-panel{background:#fff;border-radius:16px 16px 0 0;max-height:400px;overflow-y:auto}
    .es-comment{display:flex;gap:10px;padding:12px;border-bottom:1px solid #f3f4f6}
    .es-comment .avatar{width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,${P},${A});display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;font-weight:700;flex-shrink:0}

    /* Hashtag pills */
    .es-hashtag{display:inline-block;padding:4px 14px;border-radius:20px;font-size:13px;font-weight:600;text-decoration:none;background:#fce7f3;color:${P};transition:.15s;margin:2px}
    .es-hashtag:hover{background:${P};color:#fff}

    /* Responsive */
    @media(max-width:768px){.es-feed{height:calc(100vh - 60px)}.es-short{height:calc(100vh - 60px)}.es-grid{grid-template-columns:1fr}.es-hero h1{font-size:24px}}
  </style>`;

  const NAV_BAR = (active) => `<div class="es-nav">
    ${navLink('/entertainment/shorts', 'Shorts', active === 'shorts', '📱')}
    ${navLink('/entertainment/shorts/memes', 'Memes', active === 'memes', '😂')}
    ${navLink('/entertainment/shorts/voice-rooms', 'Voice Rooms', active === 'voice', '🎙️')}
    ${navLink('/entertainment/shorts/watch-party', 'Watch Party', active === 'watch', '🎬')}
    ${navLink('/entertainment/shorts/hashtags', 'Hashtags', active === 'hashtags', '#️⃣')}
    ${navLink('/entertainment/shorts/analytics', 'Analytics', active === 'analytics', '📊')}
  </div>`;

  // ── DATABASE MIGRATIONS ───────────────────────────────────
  (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS ent_shorts (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 0,
        creator_email TEXT NOT NULL, video_url TEXT, caption TEXT,
        hashtags TEXT[] DEFAULT '{}', music_track TEXT DEFAULT 'Original Audio',
        privacy TEXT DEFAULT 'public', views INTEGER DEFAULT 0,
        likes INTEGER DEFAULT 0, comment_count INTEGER DEFAULT 0,
        share_count INTEGER DEFAULT 0, duration INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS ent_shorts_comments (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 0,
        short_id INTEGER REFERENCES ent_shorts(id) ON DELETE CASCADE,
        author_email TEXT NOT NULL, comment TEXT NOT NULL,
        parent_id INTEGER REFERENCES ent_shorts_comments(id) ON DELETE CASCADE,
        likes INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS ent_shorts_likes (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 0,
        short_id INTEGER REFERENCES ent_shorts(id) ON DELETE CASCADE,
        user_email TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(tenant_id, short_id, user_email)
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS ent_shorts_bookmarks (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 0,
        short_id INTEGER REFERENCES ent_shorts(id) ON DELETE CASCADE,
        user_email TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(tenant_id, short_id, user_email)
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS ent_memes (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 0,
        creator_email TEXT NOT NULL, template_name TEXT NOT NULL,
        top_text TEXT DEFAULT '', bottom_text TEXT DEFAULT '',
        bg_color TEXT DEFAULT '#000000', text_color TEXT DEFAULT '#ffffff',
        likes INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS ent_voice_rooms (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 0,
        title TEXT NOT NULL, topic TEXT, category TEXT DEFAULT 'General',
        max_speakers INTEGER DEFAULT 5, host_email TEXT NOT NULL,
        status TEXT DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS ent_voice_room_participants (
        id SERIAL PRIMARY KEY, room_id INTEGER REFERENCES ent_voice_rooms(id) ON DELETE CASCADE,
        user_email TEXT NOT NULL, role TEXT DEFAULT 'listener',
        joined_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(room_id, user_email)
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS ent_voice_room_messages (
        id SERIAL PRIMARY KEY, room_id INTEGER REFERENCES ent_voice_rooms(id) ON DELETE CASCADE,
        user_email TEXT NOT NULL, message TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS ent_watch_parties (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 0,
        host_email TEXT NOT NULL, video_url TEXT, title TEXT NOT NULL,
        party_code TEXT UNIQUE, max_viewers INTEGER DEFAULT 10,
        status TEXT DEFAULT 'active', scheduled_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS ent_watch_party_participants (
        id SERIAL PRIMARY KEY, party_id INTEGER REFERENCES ent_watch_parties(id) ON DELETE CASCADE,
        user_email TEXT NOT NULL, joined_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(party_id, user_email)
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS ent_watch_party_chat (
        id SERIAL PRIMARY KEY, party_id INTEGER REFERENCES ent_watch_parties(id) ON DELETE CASCADE,
        user_email TEXT NOT NULL, message TEXT, emoji TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS ent_watch_party_reactions (
        id SERIAL PRIMARY KEY, party_id INTEGER REFERENCES ent_watch_parties(id) ON DELETE CASCADE,
        user_email TEXT NOT NULL, emoji TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      // Indexes
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_es_tenant ON ent_shorts(tenant_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_es_creator ON ent_shorts(creator_email)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_es_privacy ON ent_shorts(privacy)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_esc_short ON ent_shorts_comments(short_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_esl_short ON ent_shorts_likes(short_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_esb_short ON ent_shorts_bookmarks(short_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_em_tenant ON ent_memes(tenant_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_evr_tenant ON ent_voice_rooms(tenant_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_evrp_room ON ent_voice_room_participants(room_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_ewp_code ON ent_watch_parties(party_code)`);
      console.log('[EntertainmentShorts] Tables ready');
    } catch (e) { console.warn('[EntertainmentShorts] Migration warning:', e.message); }
  })();

  // ============================================================
  // 1. SHORTS FEED — TikTok-style vertical video
  // ============================================================
  app.get('/entertainment/shorts', ah(async (req, res) => {
    const tab = req.query.tab || 'foryou';
    const hashtag = req.query.hashtag || '';
    const user = req.session?.user;
    const email = user?.email;
    const tid = user?.tenant_id || 0;

    let shorts, where = ['s.privacy = $1'], params = ['public'], pi = 2;
    if (hashtag) {
      where.push(`$${pi} = ANY(s.hashtags)`);
      params.push(hashtag);
      pi++;
    }

    if (tab === 'following' && email) {
      // Followed creators — for demo, show user's own shorts + "followed" pattern
      where.push(`(s.creator_email = $${pi} OR s.privacy = 'public')`);
      params.push(email);
      pi++;
      shorts = (await pool.query(
        `SELECT s.*, u.name as creator_name FROM ent_shorts s LEFT JOIN users u ON u.email = s.creator_email WHERE ${where.join(' AND ')} ORDER BY s.created_at DESC LIMIT 50`, params
      )).rows;
    } else {
      // For You — algorithmically sorted by likes + recent
      shorts = (await pool.query(
        `SELECT s.*, u.name as creator_name FROM ent_shorts s LEFT JOIN users u ON u.email = s.creator_email WHERE ${where.join(' AND ')} ORDER BY (s.likes * 2 + s.views + EXTRACT(EPOCH FROM(NOW()-s.created_at))/3600 * 10) DESC LIMIT 50`, params
      )).rows;
    }

    // Fetch like/bookmark state for user
    let likedSet = new Set(), bookmarkSet = new Set();
    if (email && shorts.length) {
      const ids = shorts.map(s => s.id);
      const [likes, bookmarks] = await Promise.all([
        pool.query(`SELECT short_id FROM ent_shorts_likes WHERE tenant_id=$1 AND user_email=$2 AND short_id = ANY($3)`, [tid, email, ids]),
        pool.query(`SELECT short_id FROM ent_shorts_bookmarks WHERE tenant_id=$1 AND user_email=$2 AND short_id = ANY($3)`, [tid, email, ids])
      ]);
      likedSet = new Set(likes.rows.map(r => r.short_id));
      bookmarkSet = new Set(bookmarks.rows.map(r => r.short_id));
    }

    const shortsHtml = shorts.map(s => {
      const isLiked = likedSet.has(s.id);
      const isBookmarked = bookmarkSet.has(s.id);
      const initials = (s.creator_name || s.creator_email || '?').split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
      const hashtagsHtml = (s.hashtags || []).map(h => `<a href="/entertainment/shorts?tab=foryou&hashtag=${encodeURIComponent(esc(h))}" style="color:${A};text-decoration:none;font-size:12px">#${esc(h)}</a>`).join(' ');

      return `<div class="es-short">
        ${s.video_url
          ? `<video class="es-short-video" src="${esc(s.video_url)}" loop muted playsinline></video>`
          : `<div class="es-short-video" style="background:linear-gradient(135deg,${P}20,${A}20);display:flex;align-items:center;justify-content:center;font-size:80px">📱</div>`
        }
        <div class="es-short-overlay">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <div class="es-avatar" style="width:36px;height:36px;font-size:14px;background:linear-gradient(135deg,${P},${A})">${initials}</div>
            <div>
              <div style="font-size:13px;font-weight:700;color:#fff">${esc(s.creator_name || s.creator_email)}</div>
              ${s.music_track ? `<div style="font-size:11px;color:rgba(255,255,255,.7)">🎵 ${esc(s.music_track)}</div>` : ''}
            </div>
          </div>
          ${s.caption ? `<p style="font-size:14px;color:#fff;margin:6px 0;line-height:1.4">${esc(s.caption)}</p>` : ''}
          ${hashtagsHtml ? `<div style="margin-top:4px">${hashtagsHtml}</div>` : ''}
        </div>
        <div class="es-short-actions">
          ${email ? `<form method="POST" action="/entertainment/shorts/${s.id}/like" style="margin:0">
            <button type="submit" class="es-action-btn ${isLiked ? 'liked' : ''}" style="color:#fff;background:none;border:none;cursor:pointer">
              <div class="icon">${isLiked ? '❤️' : '🤍'}</div><span>${s.likes || 0}</span>
            </button></form>` : `<div class="es-action-btn"><div class="icon">🤍</div><span>${s.likes || 0}</span></div>`}
          <a href="/entertainment/shorts/${s.id}/comments" class="es-action-btn" style="color:#fff;text-decoration:none">
            <div class="icon">💬</div><span>${s.comment_count || 0}</span>
          </a>
          ${email ? `<form method="POST" action="/entertainment/shorts/${s.id}/share" style="margin:0">
            <button type="submit" class="es-action-btn" style="color:#fff;background:none;border:none;cursor:pointer">
              <div class="icon">↗️</div><span>${s.share_count || 0}</span>
            </button></form>` : `<div class="es-action-btn"><div class="icon">↗️</div><span>${s.share_count || 0}</span></div>`}
          ${email ? `<form method="POST" action="/entertainment/shorts/${s.id}/bookmark" style="margin:0">
            <button type="submit" class="es-action-btn ${isBookmarked ? 'bookmarked' : ''}" style="color:#fff;background:none;border:none;cursor:pointer">
              <div class="icon">${isBookmarked ? '🔖' : '📑'}</div><span>${isBookmarked ? 'Saved' : 'Save'}</span>
            </button></form>` : ''}
        </div>
      </div>`;
    }).join('');

    const total = shorts.length;
    const html = CSS + `
      <div style="max-width:1200px;margin:0 auto;padding:16px">
        ${NAV_BAR('shorts')}
        <div style="display:flex;justify-content:center;margin-bottom:16px">
          <div class="es-tabs" style="max-width:420px;width:100%">
            <a href="/entertainment/shorts?tab=foryou${hashtag ? '&hashtag=' + encodeURIComponent(hashtag) : ''}" class="es-tab ${tab === 'foryou' ? 'active' : ''}">🔥 For You</a>
            <a href="/entertainment/shorts?tab=following${hashtag ? '&hashtag=' + encodeURIComponent(hashtag) : ''}" class="es-tab ${tab === 'following' ? 'active' : ''}">👤 Following</a>
          </div>
        </div>
        ${hashtag ? `<div style="text-align:center;margin-bottom:12px">
          <a href="/entertainment/shorts" style="color:${GRAY};text-decoration:none;font-size:13px">← Clear filter</a>
          <span style="margin:0 8px;color:#d1d5db">|</span>
          <span style="color:${P};font-weight:600;font-size:14px">#${esc(hashtag)}</span>
        </div>` : ''}
        ${email ? `<div style="text-align:center;margin-bottom:16px">
          <a href="/entertainment/shorts/create" class="es-btn es-btn-primary">➕ Create Short</a>
        </div>` : ''}
        ${shorts.length
          ? `<div class="es-feed">${shortsHtml}</div>`
          : `<div style="text-align:center;padding:80px 20px">
              <div style="font-size:64px;margin-bottom:16px">📱</div>
              <h3 style="color:#374151;margin:0 0 8px">No shorts yet</h3>
              <p style="color:${GRAY}">Be the first to share a short!</p>
              ${email ? `<a href="/entertainment/shorts/create" class="es-btn es-btn-primary" style="margin-top:16px">Create Your First Short</a>` : ''}
            </div>`
        }
      </div>`;
    res.send(renderPage('Shorts', html, user, req));
  }));

  // ============================================================
  // 2. CREATE SHORT
  // ============================================================
  app.get('/entertainment/shorts/create', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const trackOpts = MUSIC_TRACKS.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
    const privacyOpts = SHORTS_PRIVACY.map(p => `<option value="${p}">${p.charAt(0).toUpperCase() + p.slice(1)}</option>`).join('');
    const html = CSS + `
      <div style="max-width:600px;margin:0 auto;padding:16px">
        ${NAV_BAR('shorts')}
        <div class="es-hero"><h1>📱 Create Short</h1><p>Share your vertical video with the world</p></div>
        <div class="es-card" style="padding:24px">
          <form method="POST" action="/entertainment/shorts/create" style="display:flex;flex-direction:column;gap:16px">
            <div><label class="es-label">Video URL</label>
              <input class="es-input" type="url" name="video_url" placeholder="https://example.com/video.mp4">
            </div>
            <div><label class="es-label">Caption <span style="color:${GRAY}">(max 150 chars)</span></label>
              <input class="es-input" type="text" name="caption" maxlength="150" placeholder="What's happening?">
            </div>
            <div><label class="es-label">Hashtags <span style="color:${GRAY}">(comma separated)</span></label>
              <input class="es-input" type="text" name="hashtags" placeholder="trending, funny, viral">
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
              <div><label class="es-label">Music Track</label>
                <select class="es-input" name="music_track">${trackOpts}</select></div>
              <div><label class="es-label">Privacy</label>
                <select class="es-input" name="privacy">${privacyOpts}</select></div>
            </div>
            <div><label class="es-label">Duration (seconds)</label>
              <input class="es-input" type="number" name="duration" value="15" min="1" max="180">
            </div>
            <div style="display:flex;gap:10px">
              <button type="submit" class="es-btn es-btn-primary" style="flex:1">🚀 Publish Short</button>
              <a href="/entertainment/shorts" class="es-btn es-btn-ghost">Cancel</a>
            </div>
          </form>
        </div>
      </div>`;
    res.send(renderPage('Create Short', html, user, req));
  }));

  app.post('/entertainment/shorts/create', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const { video_url, caption, hashtags, music_track, privacy, duration } = req.body;
    const hashArr = hashtags ? hashtags.split(',').map(h => h.trim().replace(/^#/, '')).filter(Boolean) : [];
    await pool.query(
      `INSERT INTO ent_shorts (tenant_id, creator_email, video_url, caption, hashtags, music_track, privacy, duration) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [user.tenant_id, user.email, video_url || null, (caption || '').substring(0, 150) || null, hashArr, music_track || 'Original Audio', privacy || 'public', parseInt(duration) || 15]
    );
    await audit(user.tenant_id, user.id, 'short_created', { caption: (caption || '').substring(0, 50) });
    res.redirect('/entertainment/shorts');
  }));

  // ============================================================
  // SHORTS ACTIONS: Like, Bookmark, Share
  // ============================================================
  app.post('/entertainment/shorts/:id/like', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const sid = req.params.id;
    const existing = (await pool.query(`SELECT id FROM ent_shorts_likes WHERE tenant_id=$1 AND short_id=$2 AND user_email=$3`, [user.tenant_id, sid, user.email])).rows[0];
    if (existing) {
      await pool.query('DELETE FROM ent_shorts_likes WHERE id=$1', [existing.id]);
      await pool.query('UPDATE ent_shorts SET likes = GREATEST(likes - 1, 0) WHERE id=$1', [sid]);
    } else {
      await pool.query('INSERT INTO ent_shorts_likes (tenant_id, short_id, user_email) VALUES ($1,$2,$3)', [user.tenant_id, sid, user.email]);
      await pool.query('UPDATE ent_shorts SET likes = likes + 1 WHERE id=$1', [sid]);
    }
    const ref = req.headers.referer || '/entertainment/shorts';
    res.redirect(ref);
  }));

  app.post('/entertainment/shorts/:id/bookmark', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const sid = req.params.id;
    const existing = (await pool.query(`SELECT id FROM ent_shorts_bookmarks WHERE tenant_id=$1 AND short_id=$2 AND user_email=$3`, [user.tenant_id, sid, user.email])).rows[0];
    if (existing) {
      await pool.query('DELETE FROM ent_shorts_bookmarks WHERE id=$1', [existing.id]);
    } else {
      await pool.query('INSERT INTO ent_shorts_bookmarks (tenant_id, short_id, user_email) VALUES ($1,$2,$3)', [user.tenant_id, sid, user.email]);
    }
    res.redirect(req.headers.referer || '/entertainment/shorts');
  }));

  app.post('/entertainment/shorts/:id/share', ah(async (req, res) => {
    await pool.query('UPDATE ent_shorts SET share_count = share_count + 1 WHERE id=$1', [req.params.id]);
    res.redirect(req.headers.referer || '/entertainment/shorts');
  }));

  // ============================================================
  // 3. SHORTS COMMENTS
  // ============================================================
  app.get('/entertainment/shorts/:id/comments', ah(async (req, res) => {
    const sid = req.params.id;
    const short = (await pool.query(`SELECT s.*, u.name as creator_name FROM ent_shorts s LEFT JOIN users u ON u.email=s.creator_email WHERE s.id=$1`, [sid])).rows[0];
    if (!short) return res.status(404).send(renderPage('Not Found', '<div style="text-align:center;padding:60px"><h2>Short not found</h2></div>'));
    await pool.query('UPDATE ent_shorts SET views = views + 1 WHERE id=$1', [sid]);

    const comments = (await pool.query(
      `SELECT c.*, u.name as author_name FROM ent_shorts_comments c LEFT JOIN users u ON u.email=c.author_email WHERE c.short_id=$1 AND c.parent_id IS NULL ORDER BY c.likes DESC, c.created_at DESC LIMIT 100`, [sid]
    )).rows;

    // Preload all replies for this short
    const allReplies = (await pool.query(
      `SELECT r.*, u.name as author_name FROM ent_shorts_comments r LEFT JOIN users u ON u.email=r.author_email WHERE r.short_id=$1 AND r.parent_id IS NOT NULL ORDER BY r.created_at ASC`, [sid]
    )).rows;

    const user = req.session?.user;
    const commentsHtml = comments.map(c => {
      const initial = (c.author_name || c.author_email || '?')[0].toUpperCase();
      const replies = allReplies.filter(r => r.parent_id === c.id);
      const repliesHtml = replies.map(r => `<div style="display:flex;gap:8px;padding:8px 0 8px 42px;border-bottom:1px solid #f9fafb">
        <div class="es-comment avatar" style="width:24px;height:24px;font-size:10px">${(r.author_name || r.author_email || '?')[0].toUpperCase()}</div>
        <div><span style="font-size:12px;font-weight:600">${esc(r.author_name || r.author_email)}</span>
        <span style="font-size:11px;color:${GRAY};margin-left:6px">${fmtAgo(r.created_at)}</span>
        <p style="font-size:12px;color:#374151;margin:2px 0 0">${esc(r.comment)}</p></div>
      </div>`).join('');

      return `<div class="es-comment">
        <div class="es-comment avatar">${initial}</div>
        <div style="flex:1">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <strong style="font-size:13px">${esc(c.author_name || c.author_email)}</strong>
            <span style="font-size:11px;color:${GRAY}">${fmtAgo(c.created_at)}</span>
          </div>
          <p style="font-size:13px;color:#374151;margin:4px 0;line-height:1.5">${esc(c.comment)}</p>
          <div style="display:flex;gap:12px;margin-top:4px">
            <form method="POST" action="/entertainment/shorts/comments/${c.id}/like" style="display:inline">
              <button style="background:none;border:none;cursor:pointer;font-size:12px;color:${GRAY}">👍 ${c.likes || 0}</button>
            </form>
            ${user ? `<form method="POST" action="/entertainment/shorts/${sid}/comment" style="display:inline-flex;gap:4px">
              <input type="hidden" name="parent_id" value="${c.id}">
              <input class="es-input" type="text" name="comment" placeholder="Reply..." style="width:160px;padding:4px 10px;font-size:12px" required>
              <button type="submit" class="es-btn" style="padding:4px 10px;font-size:11px;background:${P};color:#fff">Reply</button>
            </form>` : ''}
          </div>
          ${repliesHtml}
        </div>
      </div>`;
    }).join('');

    const html = CSS + `
      <div style="max-width:600px;margin:0 auto;padding:16px">
        <a href="/entertainment/shorts" style="color:${GRAY};text-decoration:none;font-size:14px;display:inline-block;margin-bottom:12px">← Back to Shorts</a>
        <div class="es-hero"><h1>💬 Comments</h1><p>${short.comment_count || 0} comments on this short</p></div>
        ${user ? `<form method="POST" action="/entertainment/shorts/${sid}/comment" style="display:flex;gap:8px;margin-bottom:20px">
          <input class="es-input" type="text" name="comment" placeholder="Add a comment..." required style="flex:1">
          <button type="submit" class="es-btn es-btn-primary">Post</button>
        </form>` : '<p style="color:${GRAY};text-align:center;margin-bottom:16px"><a href="/login" style="color:' + P + '">Log in</a> to comment</p>'}
        <div class="es-comment-panel">
          ${commentsHtml || '<div style="text-align:center;padding:40px;color:' + GRAY + '">No comments yet. Be the first!</div>'}
        </div>
      </div>`;
    res.send(renderPage('Comments', html, user, req));
  }));

  app.post('/entertainment/shorts/:id/comment', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const { comment, parent_id } = req.body;
    if (!comment || !comment.trim()) return res.redirect(req.headers.referer || '/entertainment/shorts');
    await pool.query(
      `INSERT INTO ent_shorts_comments (tenant_id, short_id, author_email, comment, parent_id) VALUES ($1,$2,$3,$4,$5)`,
      [user.tenant_id, req.params.id, user.email, comment.trim(), parent_id || null]
    );
    await pool.query('UPDATE ent_shorts SET comment_count = comment_count + 1 WHERE id=$1', [req.params.id]);
    res.redirect(`/entertainment/shorts/${req.params.id}/comments`);
  }));

  app.post('/entertainment/shorts/comments/:id/like', ah(async (req, res) => {
    await pool.query('UPDATE ent_shorts_comments SET likes = likes + 1 WHERE id=$1', [req.params.id]);
    res.redirect(req.headers.referer || '/entertainment/shorts');
  }));

  // ============================================================
  // 4. MEME GENERATOR
  // ============================================================
  app.get('/entertainment/shorts/memes', ah(async (req, res) => {
    const user = req.session?.user;
    const memes = (await pool.query(`SELECT m.*, u.name as creator_name FROM ent_memes m LEFT JOIN users u ON u.email=m.creator_email ORDER BY m.likes DESC, m.created_at DESC LIMIT 60`)).rows;

    const memesHtml = memes.map(m => {
      const tpl = MEME_TEMPLATES.find(t => t.id === m.template_name) || MEME_TEMPLATES[0];
      return `<div class="es-card">
        <div class="es-meme-box" style="background:${esc(m.bg_color || tpl.bg)};color:${esc(m.text_color || tpl.colors[0])}">
          ${m.top_text ? `<div class="top-text">${esc(m.top_text)}</div>` : '<div class="top-text"></div>'}
          <div class="meme-icon">${tpl.id === 'drake' ? '🙄' : tpl.id === 'distracted' ? '😤' : tpl.id === 'changemymind' ? '☕' : tpl.id === 'brain' ? '🧠' : tpl.id === 'thisisfine' ? '🔥' : tpl.id === 'simply' ? '🔮' : tpl.id === 'success' ? '✊' : tpl.id === 'batman' ? '🦇' : tpl.id === 'pikachu' ? '⚡' : tpl.id === 'twobuttons' ? '🔘' : '😂'}</div>
          ${m.bottom_text ? `<div class="bottom-text">${esc(m.bottom_text)}</div>` : '<div class="bottom-text"></div>'}
        </div>
        <div style="padding:14px;display:flex;justify-content:space-between;align-items:center">
          <div><div style="font-size:12px;font-weight:600">${esc(tpl.name)}</div>
            <div style="font-size:11px;color:${GRAY}">by ${esc(m.creator_name || m.creator_email)} · ${fmtAgo(m.created_at)}</div></div>
          <div style="display:flex;gap:8px;align-items:center">
            <span style="font-size:12px;color:${GRAY}">😂 ${m.likes || 0}</span>
            ${user ? `<form method="POST" action="/entertainment/shorts/memes/${m.id}/like"><button class="es-btn es-btn-ghost" style="padding:4px 12px;font-size:11px">😂 Like</button></form>` : ''}
          </div>
        </div>
      </div>`;
    }).join('');

    const html = CSS + `
      <div style="max-width:1200px;margin:0 auto;padding:16px">
        ${NAV_BAR('memes')}
        <div class="es-hero"><h1>😂 Meme Generator</h1><p>Create hilarious memes from trending templates</p></div>
        <div style="text-align:center;margin-bottom:20px">
          <a href="/entertainment/shorts/memes/create" class="es-btn es-btn-primary">✨ Create Meme</a>
        </div>
        <h3 style="color:#374151;margin:0 0 14px">🔥 Popular Memes</h3>
        <div class="es-grid">${memesHtml || '<div style="grid-column:1/-1;text-align:center;padding:60px;color:' + GRAY + '">No memes yet. Create the first one!</div>'}</div>
      </div>`;
    res.send(renderPage('Meme Generator', html, user, req));
  }));

  app.get('/entertainment/shorts/memes/create', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const templateCards = MEME_TEMPLATES.map(t => `<div class="template-card" onclick="selectTemplate('${t.id}')" style="cursor:pointer;border:3px solid transparent;border-radius:14px;padding:14px;text-align:center;background:${t.bg};color:${t.colors[0]};transition:.2s;min-height:100px;display:flex;flex-direction:column;align-items:center;justify-content:center" data-tpl="${t.id}">
      <div style="font-size:28px;margin-bottom:4px">${t.id === 'drake' ? '🙄' : t.id === 'distracted' ? '😤' : t.id === 'changemymind' ? '☕' : t.id === 'brain' ? '🧠' : t.id === 'thisisfine' ? '🔥' : t.id === 'simply' ? '🔮' : t.id === 'success' ? '✊' : t.id === 'batman' ? '🦇' : t.id === 'pikachu' ? '⚡' : '🔘'}</div>
      <div style="font-size:11px;font-weight:700;text-shadow:1px 1px 0 rgba(0,0,0,.2)">${esc(t.name)}</div>
    </div>`).join('');

    const html = CSS + `
      <div style="max-width:800px;margin:0 auto;padding:16px">
        ${NAV_BAR('memes')}
        <div class="es-hero"><h1>✨ Create Meme</h1><p>Pick a template, add your text, share the laughs</p></div>
        <div class="es-card" style="padding:24px;margin-bottom:20px">
          <label class="es-label">Choose Template</label>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:10px;margin-bottom:20px">${templateCards}</div>
          <input type="hidden" name="template_name" id="tplName" value="drake">
          <div style="display:flex;flex-direction:column;gap:16px">
            <div><label class="es-label">Top Text</label>
              <input class="es-input" type="text" id="topText" name="top_text" maxlength="100" placeholder="Top text..." oninput="previewMeme()">
            </div>
            <div><label class="es-label">Bottom Text</label>
              <input class="es-input" type="text" id="bottomText" name="bottom_text" maxlength="100" placeholder="Bottom text..." oninput="previewMeme()">
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
              <div><label class="es-label">Background Color</label>
                <input type="color" id="bgColor" value="#000000" style="width:60px;height:40px;border:none;cursor:pointer;border-radius:8px" onchange="previewMeme()"></div>
              <div><label class="es-label">Text Color</label>
                <input type="color" id="txtColor" value="#ffffff" style="width:60px;height:40px;border:none;cursor:pointer;border-radius:8px" onchange="previewMeme()"></div>
            </div>
            <div><label class="es-label">Preview</label>
              <div id="memePreview" class="es-meme-box" style="background:#000;color:#fff"><div class="top-text"></div><div class="meme-icon">🙄</div><div class="bottom-text"></div></div>
            </div>
            <form method="POST" action="/entertainment/shorts/memes/create" id="memeForm">
              <input type="hidden" name="template_name" id="memeTpl">
              <input type="hidden" name="bg_color" id="memeBg">
              <input type="hidden" name="text_color" id="memeTxt">
              <button type="submit" class="es-btn es-btn-primary" style="width:100%">🚀 Create Meme</button>
            </form>
          </div>
        </div>
      </div>
      <script>
        const TPLS = ${JSON.stringify(MEME_TEMPLATES)};
        let selectedTpl = 'drake';
        const tplColors = {}; TPLS.forEach(t => tplColors[t.id] = t.bg);
        function selectTemplate(id) {
          selectedTpl = id;
          document.querySelectorAll('.template-card').forEach(c => c.style.borderColor = c.dataset.tpl === id ? '${P}' : 'transparent');
          document.getElementById('memeTpl').value = id;
          const tpl = TPLS.find(t => t.id === id);
          if (tpl) {
            document.getElementById('bgColor').value = tpl.bg;
            document.getElementById('txtColor').value = tpl.colors[0];
          }
          previewMeme();
        }
        function previewMeme() {
          const top = document.getElementById('topText').value;
          const bot = document.getElementById('bottomText').value;
          const bg = document.getElementById('bgColor').value;
          const tc = document.getElementById('txtColor').value;
          const tpl = TPLS.find(t => t.id === selectedTpl) || TPLS[0];
          const icon = tpl.id === 'drake' ? '🙄' : tpl.id === 'distracted' ? '😤' : tpl.id === 'changemymind' ? '☕' : tpl.id === 'brain' ? '🧠' : tpl.id === 'thisisfine' ? '🔥' : tpl.id === 'simply' ? '🔮' : tpl.id === 'success' ? '✊' : tpl.id === 'batman' ? '🦇' : tpl.id === 'pikachu' ? '⚡' : '🔘';
          document.getElementById('memePreview').style.background = bg;
          document.getElementById('memePreview').style.color = tc;
          document.getElementById('memePreview').innerHTML = '<div class="top-text">' + (top || '') + '</div><div class="meme-icon">' + icon + '</div><div class="bottom-text">' + (bot || '') + '</div>';
          document.getElementById('memeBg').value = bg;
          document.getElementById('memeTxt').value = tc;
        }
        selectTemplate('drake');
      </script>`;
    res.send(renderPage('Create Meme', html, user, req));
  }));

  app.post('/entertainment/shorts/memes/create', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const { template_name, top_text, bottom_text, bg_color, text_color } = req.body;
    await pool.query(
      `INSERT INTO ent_memes (tenant_id, creator_email, template_name, top_text, bottom_text, bg_color, text_color) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [user.tenant_id, user.email, template_name || 'drake', top_text || '', bottom_text || '', bg_color || '#000000', text_color || '#ffffff']
    );
    await audit(user.tenant_id, user.id, 'meme_created', { template: template_name });
    res.redirect('/entertainment/shorts/memes');
  }));

  app.post('/entertainment/shorts/memes/:id/like', ah(async (req, res) => {
    await pool.query('UPDATE ent_memes SET likes = likes + 1 WHERE id=$1', [req.params.id]);
    res.redirect(req.headers.referer || '/entertainment/shorts/memes');
  }));

  // ============================================================
  // 5. VOICE ROOMS — Clubhouse-style
  // ============================================================
  app.get('/entertainment/shorts/voice-rooms', ah(async (req, res) => {
    const user = req.session?.user;
    const rooms = (await pool.query(
      `SELECT vr.*, hp.name as host_name,
        (SELECT COUNT(*)::int FROM ent_voice_room_participants vrp WHERE vrp.room_id=vr.id) as participant_count,
        (SELECT COUNT(*)::int FROM ent_voice_room_participants vrp WHERE vrp.room_id=vr.id AND vrp.role='speaker') as speaker_count
       FROM ent_voice_rooms vr LEFT JOIN users hp ON hp.email=vr.host_email
       WHERE vr.status='active'
       ORDER BY vr.created_at DESC LIMIT 50`
    )).rows;

    // Preload speakers for all rooms
    const allRoomSpeakers = (await pool.query(
      `SELECT vrp.*, u.name as user_name FROM ent_voice_room_participants vrp LEFT JOIN users u ON u.email=vrp.user_email WHERE vrp.room_id = ANY($1) AND vrp.role='speaker' ORDER BY vrp.joined_at`,
      [rooms.map(r => r.id)]
    )).rows;

    const catPills = VOICE_CATEGORIES.map(c => `<span class="es-hashtag" style="background:#fce7f3;color:${P}">${c}</span>`).join(' ');

    const roomsHtml = rooms.map(r => {
      const speakers = allRoomSpeakers.filter(s => s.room_id === r.id);
      const speakerAvatars = speakers.slice(0, 10).map(s => `<div class="es-avatar" style="width:36px;height:36px;font-size:13px;background:linear-gradient(135deg,${P},${A})" title="${esc(s.user_name || s.user_email)}">${(s.user_name || s.user_email || '?')[0].toUpperCase()}</div>`).join('');
      const isUserInRoom = user && speakers.some(s => s.user_email === user.email);

      return `<div class="es-room" style="padding:20px">
        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:12px">
          <div>
            <span style="display:inline-block;padding:2px 10px;border-radius:20px;font-size:10px;font-weight:700;background:#ede9fe;color:#7c3aed;text-transform:uppercase">${esc(r.category)}</span>
            <h3 style="font-size:16px;font-weight:700;color:#1e293b;margin:6px 0 2px">${esc(r.title)}</h3>
            ${r.topic ? `<p style="font-size:12px;color:${GRAY};margin:0">${esc(r.topic)}</p>` : ''}
          </div>
          <div style="text-align:right">
            <div style="font-size:11px;color:${GRAY}">Host: ${esc(r.host_name || r.host_email)}</div>
            <div style="font-size:11px;color:${GRAY};margin-top:2px">${fmtAgo(r.created_at)}</div>
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
          ${speakerAvatars || '<span style="font-size:12px;color:' + GRAY + '">No speakers yet</span>'}
          ${r.participant_count > 0 ? `<div class="es-avatar" style="width:36px;height:36px;font-size:11px;background:#f3f4f6;color:#374151">+${r.participant_count - r.speaker_count}</div>` : ''}
        </div>
        <div style="display:flex;gap:6px;font-size:11px;color:${GRAY};margin-bottom:14px">
          <span>👥 ${r.participant_count || 0} listeners</span>
          <span>🎤 ${r.speaker_count || 0}/${r.max_speakers || 5} speakers</span>
        </div>
        <div style="display:flex;gap:8px">
          <a href="/entertainment/shorts/voice-rooms/${r.id}" class="es-btn es-btn-primary" style="flex:1;text-align:center">🎤 Join Room</a>
          ${user && (r.host_email === user.email || isUserInRoom) ? `<form method="POST" action="/entertainment/shorts/voice-rooms/${r.id}/close" onsubmit="return confirm('Close this room?')"><button class="es-btn es-btn-danger">Close</button></form>` : ''}
        </div>
      </div>`;
    }).join('');

    const html = CSS + `
      <div style="max-width:800px;margin:0 auto;padding:16px">
        ${NAV_BAR('voice')}
        <div class="es-hero"><h1>🎙️ Voice Rooms</h1><p>Join live audio conversations with your community</p></div>
        ${user ? `<div style="text-align:center;margin-bottom:20px">
          <a href="/entertainment/shorts/voice-rooms/create" class="es-btn es-btn-amber">➕ Create Room</a>
        </div>` : ''}
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:20px">${catPills}</div>
        <h3 style="color:#374151;margin:0 0 14px">🏠 Active Rooms (${rooms.length})</h3>
        ${roomsHtml || '<div class="es-card" style="text-align:center;padding:60px"><div style="font-size:48px;margin-bottom:12px">🎙️</div><h3 style="color:#374151">No active rooms</h3><p style="color:' + GRAY + '">Create a room to start a conversation!</p></div>'}
      </div>`;
    res.send(renderPage('Voice Rooms', html, user, req));
  }));

  app.get('/entertainment/shorts/voice-rooms/create', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const catOpts = VOICE_CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join('');
    const html = CSS + `
      <div style="max-width:600px;margin:0 auto;padding:16px">
        ${NAV_BAR('voice')}
        <div class="es-hero"><h1>🎙️ Create Voice Room</h1><p>Start a live audio conversation</p></div>
        <div class="es-card" style="padding:24px">
          <form method="POST" action="/entertainment/shorts/voice-rooms/create" style="display:flex;flex-direction:column;gap:16px">
            <div><label class="es-label">Room Title *</label>
              <input class="es-input" type="text" name="title" required placeholder="What are we talking about?"></div>
            <div><label class="es-label">Topic</label>
              <input class="es-input" type="text" name="topic" placeholder="Brief description..."></div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
              <div><label class="es-label">Category</label><select class="es-input" name="category">${catOpts}</select></div>
              <div><label class="es-label">Max Speakers</label>
                <input class="es-input" type="number" name="max_speakers" value="5" min="2" max="20"></div>
            </div>
            <div style="display:flex;gap:10px">
              <button type="submit" class="es-btn es-btn-primary" style="flex:1">🎙️ Create Room</button>
              <a href="/entertainment/shorts/voice-rooms" class="es-btn es-btn-ghost">Cancel</a>
            </div>
          </form>
        </div>
      </div>`;
    res.send(renderPage('Create Voice Room', html, user, req));
  }));

  app.post('/entertainment/shorts/voice-rooms/create', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const { title, topic, category, max_speakers } = req.body;
    if (!title || !title.trim()) return res.redirect('/entertainment/shorts/voice-rooms/create');
    const result = await pool.query(
      `INSERT INTO ent_voice_rooms (tenant_id, title, topic, category, max_speakers, host_email) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [user.tenant_id, title.trim(), topic || null, category || 'General', parseInt(max_speakers) || 5, user.email]
    );
    // Host auto-joins as speaker
    await pool.query('INSERT INTO ent_voice_room_participants (room_id, user_email, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [result.rows[0].id, user.email, 'speaker']);
    await audit(user.tenant_id, user.id, 'voice_room_created', { title: title.trim() });
    res.redirect(`/entertainment/shorts/voice-rooms/${result.rows[0].id}`);
  }));

  app.get('/entertainment/shorts/voice-rooms/:id', ah(async (req, res) => {
    const user = req.session?.user;
    const room = (await pool.query(
      `SELECT vr.*, u.name as host_name FROM ent_voice_rooms vr LEFT JOIN users u ON u.email=vr.host_email WHERE vr.id=$1`, [req.params.id]
    )).rows[0];
    if (!room || room.status !== 'active') return res.status(404).send(renderPage('Not Found', '<div style="text-align:center;padding:60px"><h2>Room not found or closed</h2></div>'));

    const speakers = (await pool.query(
      `SELECT vrp.*, u.name as user_name FROM ent_voice_room_participants vrp LEFT JOIN users u ON u.email=vrp.user_email WHERE vrp.room_id=$1 AND vrp.role='speaker' ORDER BY vrp.joined_at`, [room.id]
    )).rows;
    const listeners = (await pool.query(
      `SELECT vrp.*, u.name as user_name FROM ent_voice_room_participants vrp LEFT JOIN users u ON u.email=vrp.user_email WHERE vrp.room_id=$1 AND vrp.role='listener' ORDER BY vrp.joined_at`, [room.id]
    )).rows;
    const messages = (await pool.query(
      `SELECT m.*, u.name as user_name FROM ent_voice_room_messages m LEFT JOIN users u ON u.email=m.user_email WHERE m.room_id=$1 ORDER BY m.created_at ASC LIMIT 200`, [room.id]
    )).rows;

    const speakerGrid = speakers.map(s => `<div class="es-speaker">
      <div class="es-avatar" style="background:linear-gradient(135deg,${P},${A})">${(s.user_name || s.user_email || '?')[0].toUpperCase()}</div>
      <div class="name">${esc(s.user_name || s.user_email)}</div>
      ${room.host_email === s.user_email ? '<div style="font-size:10px;color:' + P + ';font-weight:700">HOST</div>' : ''}
    </div>`).join('');

    const listenerList = listeners.map(l => `<div style="display:flex;align-items:center;gap:8px;padding:6px 0">
      <div class="es-avatar" style="width:28px;height:28px;font-size:11px;background:#f3f4f6;color:#374151">${(l.user_name || l.user_email || '?')[0].toUpperCase()}</div>
      <span style="font-size:12px;color:#6b7280">${esc(l.user_name || l.user_email)}</span>
    </div>`).join('');

    const chatMessages = messages.map(m => `<div class="es-chat-msg">
      <strong style="font-size:12px">${esc(m.user_name || m.user_email)}</strong>
      <span style="color:${GRAY};font-size:10px;margin-left:4px">${fmtAgo(m.created_at)}</span>
      <p style="font-size:13px;color:#374151;margin:2px 0 0">${esc(m.message)}</p>
    </div>`).join('');

    const isHost = user && room.host_email === user.email;
    const isSpeaker = user && speakers.some(s => s.user_email === user.email);
    const isInRoom = user && (speakers.some(s => s.user_email === user.email) || listeners.some(l => l.user_email === user.email));

    const html = CSS + `
      <div style="max-width:900px;margin:0 auto;padding:16px">
        <a href="/entertainment/shorts/voice-rooms" style="color:${GRAY};text-decoration:none;font-size:14px;display:inline-block;margin-bottom:12px">← Voice Rooms</a>
        <div class="es-hero">
          <span style="display:inline-block;padding:3px 12px;border-radius:20px;font-size:11px;font-weight:700;background:rgba(255,255,255,.2);margin-bottom:8px">${esc(room.category)} · LIVE</span>
          <h1>${esc(room.title)}</h1>
          ${room.topic ? `<p style="margin-top:4px">${esc(room.topic)}</p>` : ''}
          <p style="margin-top:8px;font-size:12px;opacity:.8">Hosted by ${esc(room.host_name || room.host_email)} · ${fmtAgo(room.created_at)}</p>
        </div>

        <div style="display:grid;grid-template-columns:1fr 320px;gap:16px">
          <div>
            <div class="es-card" style="padding:20px;margin-bottom:16px">
              <h3 style="margin:0 0 14px;font-size:15px">🎤 Speakers (${speakers.length}/${room.max_speakers})</h3>
              <div class="es-speaker-grid">${speakerGrid || '<p style="color:' + GRAY + ';font-size:13px">No speakers yet</p>'}</div>
            </div>

            ${user && !isInRoom ? `<div style="display:flex;gap:10px;margin-bottom:16px">
              <form method="POST" action="/entertainment/shorts/voice-rooms/${room.id}/join"><input type="hidden" name="role" value="speaker">
                <button type="submit" class="es-btn es-btn-primary" style="flex:1" ${speakers.length >= room.max_speakers ? 'disabled' : ''}>🎤 Join as Speaker</button></form>
              <form method="POST" action="/entertainment/shorts/voice-rooms/${room.id}/join"><input type="hidden" name="role" value="listener">
                <button type="submit" class="es-btn es-btn-amber" style="flex:1">👂 Join as Listener</button></form>
            </div>` : ''}

            ${isHost ? `<div style="display:flex;gap:8px;margin-bottom:16px">
              <form method="POST" action="/entertainment/shorts/voice-rooms/${room.id}/close" onsubmit="return confirm('Close room?')"><button class="es-btn es-btn-danger">🔒 Close Room</button></form>
            </div>` : ''}

            <div class="es-card" style="padding:16px">
              <h3 style="margin:0 0 12px;font-size:14px">💬 Chat (${messages.length})</h3>
              ${isInRoom ? `<form method="POST" action="/entertainment/shorts/voice-rooms/${room.id}/chat" style="display:flex;gap:8px;margin-bottom:12px">
                <input class="es-input" type="text" name="message" placeholder="Type a message..." required style="flex:1">
                <button type="submit" class="es-btn es-btn-primary" style="padding:8px 14px">Send</button>
              </form>` : ''}
              <div class="es-party-chat">${chatMessages || '<p style="color:' + GRAY + ';text-align:center;padding:20px">No messages yet</p>'}</div>
            </div>
          </div>

          <div>
            <div class="es-card" style="padding:16px">
              <h3 style="margin:0 0 12px;font-size:14px">👂 Listeners (${listeners.length})</h3>
              ${listenerList || '<p style="color:' + GRAY + ';font-size:12px">No listeners yet</p>'}
            </div>
          </div>
        </div>
      </div>`;
    res.send(renderPage(room.title, html, user, req));
  }));

  app.post('/entertainment/shorts/voice-rooms/:id/join', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const { role } = req.body;
    await pool.query('INSERT INTO ent_voice_room_participants (room_id, user_email, role) VALUES ($1,$2,$3) ON CONFLICT DO UPDATE SET role=$3', [req.params.id, user.email, role || 'listener']);
    res.redirect(`/entertainment/shorts/voice-rooms/${req.params.id}`);
  }));

  app.post('/entertainment/shorts/voice-rooms/:id/chat', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    if (!req.body.message || !req.body.message.trim()) return res.redirect('back');
    await pool.query('INSERT INTO ent_voice_room_messages (room_id, user_email, message) VALUES ($1,$2,$3)', [req.params.id, user.email, req.body.message.trim()]);
    res.redirect(`/entertainment/shorts/voice-rooms/${req.params.id}`);
  }));

  app.post('/entertainment/shorts/voice-rooms/:id/close', requireAuth, ah(async (req, res) => {
    await pool.query("UPDATE ent_voice_rooms SET status='closed' WHERE id=$1 AND host_email=$2", [req.params.id, req.session.user.email]);
    res.redirect('/entertainment/shorts/voice-rooms');
  }));

  // ============================================================
  // 6. WATCH PARTIES — Watch videos together
  // ============================================================
  app.get('/entertainment/shorts/watch-party', ah(async (req, res) => {
    const user = req.session?.user;
    const parties = (await pool.query(
      `SELECT wp.*, u.name as host_name,
        (SELECT COUNT(*)::int FROM ent_watch_party_participants wpp WHERE wpp.party_id=wp.id) as viewer_count
       FROM ent_watch_parties wp LEFT JOIN users u ON u.email=wp.host_email
       WHERE wp.status='active' ORDER BY wp.created_at DESC LIMIT 50`
    )).rows;

    const partiesHtml = parties.map(p => `<div class="es-room" style="padding:20px">
      <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:12px">
        <div>
          <span style="display:inline-block;padding:2px 10px;border-radius:20px;font-size:10px;font-weight:700;background:#dcfce7;color:#16a34a;text-transform:uppercase">${p.scheduled_at && new Date(p.scheduled_at) > new Date() ? 'SCHEDULED' : 'LIVE'}</span>
          <h3 style="font-size:16px;font-weight:700;color:#1e293b;margin:6px 0 2px">${esc(p.title)}</h3>
          <div style="font-size:12px;color:${GRAY}">Host: ${esc(p.host_name || p.host_email)} · 👥 ${p.viewer_count || 0}/${p.max_viewers || 10} viewers</div>
          ${p.scheduled_at ? `<div style="font-size:11px;color:${GRAY};margin-top:2px">📅 ${fmtDate(p.scheduled_at)}</div>` : ''}
        </div>
        <div style="background:linear-gradient(135deg,${P}20,${A}20);padding:8px 14px;border-radius:10px;text-align:center">
          <div style="font-size:18px;font-weight:800;color:${P}">${esc(p.party_code)}</div>
          <div style="font-size:9px;color:${GRAY}">CODE</div>
        </div>
      </div>
      <a href="/entertainment/shorts/watch-party/${p.id}" class="es-btn es-btn-primary" style="width:100%;text-align:center">🎬 Join Party</a>
    </div>`).join('');

    const html = CSS + `
      <div style="max-width:800px;margin:0 auto;padding:16px">
        ${NAV_BAR('watch')}
        <div class="es-hero"><h1>🎬 Watch Parties</h1><p>Watch videos together with friends in real-time</p></div>
        ${user ? `<div style="display:flex;gap:10px;margin-bottom:20px;justify-content:center;flex-wrap:wrap">
          <a href="/entertainment/shorts/watch-party/create" class="es-btn es-btn-amber">➕ Create Party</a>
          <form method="POST" action="/entertainment/shorts/watch-party/join-code" style="display:flex;gap:6px">
            <input class="es-input" type="text" name="party_code" placeholder="Enter party code..." required style="width:200px">
            <button type="submit" class="es-btn es-btn-primary">Join</button>
          </form>
        </div>` : ''}
        <h3 style="color:#374151;margin:0 0 14px">🏠 Active Parties (${parties.length})</h3>
        ${partiesHtml || '<div class="es-card" style="text-align:center;padding:60px"><div style="font-size:48px;margin-bottom:12px">🎬</div><h3 style="color:#374151">No active watch parties</h3><p style="color:' + GRAY + '">Create a party to start watching together!</p></div>'}
      </div>`;
    res.send(renderPage('Watch Parties', html, user, req));
  }));

  app.get('/entertainment/shorts/watch-party/create', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const html = CSS + `
      <div style="max-width:600px;margin:0 auto;padding:16px">
        ${NAV_BAR('watch')}
        <div class="es-hero"><h1>🎬 Create Watch Party</h1><p>Host a video watch party for your friends</p></div>
        <div class="es-card" style="padding:24px">
          <form method="POST" action="/entertainment/shorts/watch-party/create" style="display:flex;flex-direction:column;gap:16px">
            <div><label class="es-label">Party Title *</label>
              <input class="es-input" type="text" name="title" required placeholder="Movie night, tutorial watch, etc."></div>
            <div><label class="es-label">Video URL</label>
              <input class="es-input" type="url" name="video_url" placeholder="YouTube, Vimeo, or direct video URL">
              <span style="font-size:11px;color:${GRAY}">Supports YouTube, Vimeo, and direct video links</span></div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
              <div><label class="es-label">Max Viewers</label>
                <input class="es-input" type="number" name="max_viewers" value="10" min="2" max="100"></div>
              <div><label class="es-label">Schedule (optional)</label>
                <input class="es-input" type="datetime-local" name="scheduled_at"></div>
            </div>
            <div style="display:flex;gap:10px">
              <button type="submit" class="es-btn es-btn-primary" style="flex:1">🎬 Create Party</button>
              <a href="/entertainment/shorts/watch-party" class="es-btn es-btn-ghost">Cancel</a>
            </div>
          </form>
        </div>
      </div>`;
    res.send(renderPage('Create Watch Party', html, user, req));
  }));

  app.post('/entertainment/shorts/watch-party/create', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const { title, video_url, max_viewers, scheduled_at } = req.body;
    if (!title || !title.trim()) return res.redirect('/entertainment/shorts/watch-party/create');
    const code = genCode();
    const result = await pool.query(
      `INSERT INTO ent_watch_parties (tenant_id, host_email, video_url, title, party_code, max_viewers, scheduled_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [user.tenant_id, user.email, video_url || null, title.trim(), code, parseInt(max_viewers) || 10, scheduled_at || null]
    );
    // Host auto-joins
    await pool.query('INSERT INTO ent_watch_party_participants (party_id, user_email) VALUES ($1,$2) ON CONFLICT DO NOTHING', [result.rows[0].id, user.email]);
    await audit(user.tenant_id, user.id, 'watch_party_created', { title: title.trim(), code });
    res.redirect(`/entertainment/shorts/watch-party/${result.rows[0].id}`);
  }));

  app.post('/entertainment/shorts/watch-party/join-code', requireAuth, ah(async (req, res) => {
    const code = (req.body.party_code || '').trim().toUpperCase();
    const party = (await pool.query(`SELECT id FROM ent_watch_parties WHERE party_code=$1 AND status='active'`, [code])).rows[0];
    if (!party) {
      req.session.flash = { type: 'error', msg: 'Invalid party code' };
      return res.redirect('/entertainment/shorts/watch-party');
    }
    res.redirect(`/entertainment/shorts/watch-party/${party.id}`);
  }));

  function embedVideo(url) {
    if (!url) return '<div style="background:#1a1a2e;color:#f8fafc;padding:60px;text-align:center;border-radius:12px;font-size:16px">No video selected</div>';
    const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|live\/)|youtu\.be\/)([\w-]+)/);
    if (yt) return `<iframe src="https://www.youtube.com/embed/${yt[1]}" style="width:100%;aspect-ratio:16/9;border:none;border-radius:12px" allowfullscreen></iframe>`;
    const vm = url.match(/vimeo\.com\/(\d+)/);
    if (vm) return `<iframe src="https://player.vimeo.com/video/${vm[1]}" style="width:100%;aspect-ratio:16/9;border:none;border-radius:12px" allowfullscreen></iframe>`;
    return `<video src="${esc(url)}" controls style="width:100%;border-radius:12px;background:#000"></video>`;
  }

  app.get('/entertainment/shorts/watch-party/:id', ah(async (req, res) => {
    const user = req.session?.user;
    const party = (await pool.query(
      `SELECT wp.*, u.name as host_name FROM ent_watch_parties wp LEFT JOIN users u ON u.email=wp.host_email WHERE wp.id=$1`, [req.params.id]
    )).rows[0];
    if (!party || party.status !== 'active') return res.status(404).send(renderPage('Not Found', '<div style="text-align:center;padding:60px"><h2>Party not found or ended</h2></div>'));

    // Auto-join if authenticated
    if (user) {
      await pool.query('INSERT INTO ent_watch_party_participants (party_id, user_email) VALUES ($1,$2) ON CONFLICT DO NOTHING', [party.id, user.email]);
    }

    const participants = (await pool.query(
      `SELECT wpp.*, u.name as user_name FROM ent_watch_party_participants wpp LEFT JOIN users u ON u.email=wpp.user_email WHERE wpp.party_id=$1 ORDER BY wpp.joined_at`, [party.id]
    )).rows;
    const messages = (await pool.query(
      `SELECT wpc.*, u.name as user_name FROM ent_watch_party_chat wpc LEFT JOIN users u ON u.email=wpc.user_email WHERE wpc.party_id=$1 ORDER BY wpc.created_at ASC LIMIT 200`, [party.id]
    )).rows;

    const participantList = participants.map(p => `<div style="display:flex;align-items:center;gap:8px;padding:4px 0">
      <div class="es-avatar" style="width:28px;height:28px;font-size:11px;background:linear-gradient(135deg,${P},${A})">${(p.user_name || p.user_email || '?')[0].toUpperCase()}</div>
      <span style="font-size:12px;color:#6b7280">${esc(p.user_name || p.user_email)}</span>
      ${party.host_email === p.user_email ? '<span style="font-size:9px;background:' + A + ';color:#fff;padding:1px 6px;border-radius:8px;font-weight:700">HOST</span>' : ''}
    </div>`).join('');

    const chatHtml = messages.map(m => `<div class="es-chat-msg">
      ${m.emoji ? `<span style="font-size:20px">${esc(m.emoji)}</span>` : ''}
      <strong style="font-size:12px">${esc(m.user_name || m.user_email)}</strong>
      <span style="color:${GRAY};font-size:10px;margin-left:4px">${fmtAgo(m.created_at)}</span>
      ${m.message ? `<p style="font-size:13px;color:#374151;margin:2px 0 0">${esc(m.message)}</p>` : ''}
    </div>`).join('');

    const isHost = user && party.host_email === user.email;
    const emojis = ['😂', '❤️', '🔥', '👏', '🎉', '😍', '💯', '⭐'];

    const html = CSS + `
      <div style="max-width:1100px;margin:0 auto;padding:16px">
        <a href="/entertainment/shorts/watch-party" style="color:${GRAY};text-decoration:none;font-size:14px;display:inline-block;margin-bottom:12px">← Watch Parties</a>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:12px">
          <div>
            <h1 style="font-size:22px;color:#1e293b;margin:0">${esc(party.title)}</h1>
            <div style="font-size:13px;color:${GRAY};margin-top:4px">Host: ${esc(party.host_name || party.host_email)} · Code: <strong style="color:${P}">${esc(party.party_code)}</strong></div>
          </div>
          <div style="display:flex;gap:8px;font-size:13px;color:${GRAY}">
            <span>👥 ${participants.length}/${party.max_viewers || 10}</span>
            ${party.scheduled_at ? `<span>📅 ${fmtDate(party.scheduled_at)}</span>` : ''}
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 340px;gap:16px">
          <div>
            <!-- Video Player -->
            <div class="es-card" style="padding:0;overflow:hidden;margin-bottom:16px;position:relative" id="videoContainer">
              ${embedVideo(party.video_url)}
              ${isHost ? `<div style="position:absolute;bottom:12px;left:12px;display:flex;gap:6px">
                <button onclick="togglePlay()" class="es-btn" style="background:rgba(0,0,0,.7);color:#fff;padding:8px 14px" id="playBtn">⏸ Pause</button>
                <button onclick="syncViewers()" class="es-btn" style="background:rgba(0,0,0,.7);color:#fff;padding:8px 14px">🔄 Sync</button>
              </div>` : ''}
            </div>

            <!-- Emoji Reactions -->
            <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
              ${emojis.map(e => emojiBtn(e, e, party.id)).join('')}
            </div>

            <!-- Chat -->
            <div class="es-card" style="padding:16px">
              <h3 style="margin:0 0 12px;font-size:14px">💬 Live Chat</h3>
              ${user ? `<form method="POST" action="/entertainment/shorts/watch-party/${party.id}/chat" style="display:flex;gap:8px;margin-bottom:12px">
                <input class="es-input" type="text" name="message" placeholder="Say something..." style="flex:1">
                <button type="submit" class="es-btn es-btn-primary" style="padding:8px 14px">Send</button>
              </form>` : ''}
              <div class="es-party-chat" id="chatBox">${chatHtml || '<p style="color:' + GRAY + ';text-align:center;padding:20px">No messages yet. Say hi! 👋</p>'}</div>
            </div>
          </div>

          <!-- Sidebar -->
          <div>
            <div class="es-card" style="padding:16px;margin-bottom:16px">
              <h3 style="margin:0 0 12px;font-size:14px">👥 Viewers (${participants.length})</h3>
              ${participantList || '<p style="color:' + GRAY + ';font-size:12px">No viewers yet</p>'}
            </div>
            ${isHost ? `<div class="es-card" style="padding:16px">
              <h3 style="margin:0 0 12px;font-size:14px">🛡️ Host Controls</h3>
              <form method="POST" action="/entertainment/shorts/watch-party/${party.id}/end" onsubmit="return confirm('End this watch party?')">
                <button class="es-btn es-btn-danger" style="width:100%">🔒 End Party</button>
              </form>
            </div>` : ''}
          </div>
        </div>
      </div>
      <script>
        function sendReaction(partyId, emoji) {
          fetch('/entertainment/shorts/watch-party/' + partyId + '/react', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({emoji})
          }).then(() => {
            const container = document.getElementById('videoContainer');
            const el = document.createElement('div');
            el.className = 'float-emoji';
            el.textContent = emoji;
            el.style.left = (Math.random() * 80 + 10) + '%';
            container.appendChild(el);
            setTimeout(() => el.remove(), 2000);
          }).catch(() => {});
        }
        let isPaused = false;
        function togglePlay() {
          const video = document.querySelector('video');
          const btn = document.getElementById('playBtn');
          if (!video) return;
          if (isPaused) { video.play(); btn.textContent = '⏸ Pause'; }
          else { video.pause(); btn.textContent = '▶ Play'; }
          isPaused = !isPaused;
        }
        function syncViewers() { location.reload(); }
        // Auto-scroll chat
        const chatBox = document.getElementById('chatBox');
        if (chatBox) chatBox.scrollTop = chatBox.scrollHeight;
      </script>`;
    res.send(renderPage(party.title, html, user, req));
  }));

  app.post('/entertainment/shorts/watch-party/:id/chat', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const msg = (req.body.message || '').trim();
    if (!msg) return res.redirect('back');
    await pool.query('INSERT INTO ent_watch_party_chat (party_id, user_email, message) VALUES ($1,$2,$3)', [req.params.id, user.email, msg]);
    res.redirect(`/entertainment/shorts/watch-party/${req.params.id}`);
  }));

  app.post('/entertainment/shorts/watch-party/:id/react', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const { emoji } = req.body;
    if (!emoji) return res.json({ ok: true });
    await pool.query('INSERT INTO ent_watch_party_chat (party_id, user_email, emoji) VALUES ($1,$2,$3)', [req.params.id, user.email, emoji]);
    await pool.query('INSERT INTO ent_watch_party_reactions (party_id, user_email, emoji) VALUES ($1,$2,$3)', [req.params.id, user.email, emoji]);
    res.json({ ok: true });
  }));

  app.post('/entertainment/shorts/watch-party/:id/end', requireAuth, ah(async (req, res) => {
    await pool.query("UPDATE ent_watch_parties SET status='ended' WHERE id=$1 AND host_email=$2", [req.params.id, req.session.user.email]);
    res.redirect('/entertainment/shorts/watch-party');
  }));

  // ============================================================
  // 7. TRENDING HASHTAGS
  // ============================================================
  app.get('/entertainment/shorts/hashtags', ah(async (req, res) => {
    const user = req.session?.user;
    // Extract all hashtags and count usage
    const hashtags = (await pool.query(`
      SELECT unnest(hashtags) AS tag, COUNT(*)::int AS usage_count,
        MAX(created_at) AS last_used,
        (SELECT SUM(likes) FROM ent_shorts s2 WHERE $1 = ANY(s2.hashtags)) AS total_likes
      FROM ent_shorts
      WHERE hashtags <> '{}'
      GROUP BY tag
      ORDER BY usage_count DESC, total_likes DESC
      LIMIT 100
    `, [])).rows;

    // Calculate trend direction (compare recent 7 days vs before)
    const recentHashtags = (await pool.query(`
      SELECT unnest(hashtags) AS tag, COUNT(*)::int AS recent_count
      FROM ent_shorts
      WHERE hashtags <> '{}' AND created_at >= NOW() - INTERVAL '7 days'
      GROUP BY tag
    `, [])).rows;
    const recentMap = {};
    recentHashtags.forEach(r => { recentMap[r.tag] = r.recent_count; });

    const tagsHtml = hashtags.map((h, i) => {
      const trend = recentMap[h.tag] ? '↑' : '↓';
      const trendColor = recentMap[h.tag] ? '#16a34a' : '#dc2626';
      const size = Math.max(12, Math.min(28, 12 + h.usage_count));
      return `<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #f3f4f6;transition:.15s" class="hashtag-row" onmouseover="this.style.background='#fce7f3'" onmouseout="this.style.background='transparent'">
        <div style="display:flex;align-items:center;gap:12px">
          <span style="font-size:14px;color:${GRAY};min-width:30px">#${i + 1}</span>
          <a href="/entertainment/shorts?tab=foryou&hashtag=${encodeURIComponent(esc(h.tag))}" style="font-size:${size}px;font-weight:700;color:${P};text-decoration:none">#${esc(h.tag)}</a>
        </div>
        <div style="display:flex;align-items:center;gap:16px">
          <div style="text-align:right">
            <div style="font-size:13px;font-weight:600">${h.usage_count} posts</div>
            <div style="font-size:11px;color:${GRAY}">❤️ ${h.total_likes || 0} likes</div>
          </div>
          <span style="color:${trendColor};font-size:18px;font-weight:700">${trend}</span>
        </div>
      </div>`;
    }).join('');

    const html = CSS + `
      <div style="max-width:700px;margin:0 auto;padding:16px">
        ${NAV_BAR('hashtags')}
        <div class="es-hero"><h1>#️⃣ Trending Hashtags</h1><p>Discover what's trending in the community</p></div>
        <div class="es-stats" style="margin-bottom:20px">
          ${statBox(hashtags.length, 'Total Hashtags', P)}
          ${statBox(recentHashtags.length, 'Active This Week', '#16a34a')}
          ${statBox(hashtags.reduce((a, h) => a + (h.total_likes || 0), 0), 'Total Likes', A)}
        </div>
        <div class="es-card">
          ${tagsHtml || '<div style="text-align:center;padding:60px;color:' + GRAY + '"><div style="font-size:48px;margin-bottom:12px">#️⃣</div><h3>No hashtags yet</h3><p>Create shorts with hashtags to see trends!</p></div>'}
        </div>
      </div>`;
    res.send(renderPage('Trending Hashtags', html, user, req));
  }));

  // ============================================================
  // 8. SHORTS ANALYTICS — Creator Dashboard
  // ============================================================
  app.get('/entertainment/shorts/analytics', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;
    const email = user.email;

    const [stats, topShorts, recentShorts] = await Promise.all([
      pool.query(`SELECT
        COUNT(*)::int as total_shorts,
        COALESCE(SUM(views), 0)::int as total_views,
        COALESCE(SUM(likes), 0)::int as total_likes,
        COALESCE(SUM(comment_count), 0)::int as total_comments,
        COALESCE(SUM(share_count), 0)::int as total_shares,
        COALESCE(AVG(views), 0)::int as avg_views,
        COALESCE(AVG(likes), 0)::int as avg_likes,
        COALESCE(AVG(duration), 0)::int as avg_duration
      FROM ent_shorts WHERE tenant_id=$1 AND creator_email=$2`, [tid, email]),
      pool.query(`SELECT * FROM ent_shorts WHERE tenant_id=$1 AND creator_email=$2 ORDER BY likes DESC LIMIT 10`, [tid, email]),
      pool.query(`SELECT * FROM ent_shorts WHERE tenant_id=$1 AND creator_email=$2 ORDER BY created_at DESC LIMIT 5`, [tid, email])
    ]);

    // Views over time (last 7 days)
    const viewsByDay = (await pool.query(`
      SELECT DATE(created_at) as day, SUM(views)::int as views, COUNT(*)::int as shorts
      FROM ent_shorts WHERE tenant_id=$1 AND creator_email=$2 AND created_at >= NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at) ORDER BY day
    `, [tid, email])).rows;

    const s = stats.rows[0];
    const engagementRate = s.total_views > 0 ? ((s.total_likes + s.total_comments + s.total_shares) / s.total_views * 100).toFixed(1) : '0';

    // Bookmarks count
    const bookmarkCount = (await pool.query(`SELECT COUNT(*)::int as c FROM ent_shorts_bookmarks sb JOIN ent_shorts s ON s.id=sb.short_id WHERE s.tenant_id=$1 AND s.creator_email=$2`, [tid, email])).rows[0].c;

    const topShortsHtml = topShorts.rows.map((sh, i) => `<tr>
      <td><span style="font-size:12px;color:${i < 3 ? A : GRAY};font-weight:700">#${i + 1}</span></td>
      <td style="font-size:13px;font-weight:600">${esc((sh.caption || 'Untitled').substring(0, 40))}</td>
      <td style="font-size:12px">👁 ${sh.views || 0}</td>
      <td style="font-size:12px">❤️ ${sh.likes || 0}</td>
      <td style="font-size:12px">💬 ${sh.comment_count || 0}</td>
      <td style="font-size:12px">↗️ ${sh.share_count || 0}</td>
      <td style="font-size:12px;color:${GRAY}">${fmtAgo(sh.created_at)}</td>
    </tr>`).join('');

    // Simple bar chart using CSS
    const maxViews = Math.max(...viewsByDay.map(v => v.views), 1);
    const chartHtml = viewsByDay.map(v => {
      const pct = (v.views / maxViews * 100).toFixed(0);
      return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <span style="font-size:11px;color:${GRAY};min-width:60px">${fmtDate(v.day)}</span>
        <div style="flex:1;background:#f3f4f6;border-radius:6px;height:20px;overflow:hidden">
          <div style="width:${pct}%;height:100%;background:linear-gradient(90deg,${P},${A});border-radius:6px;transition:width .5s"></div>
        </div>
        <span style="font-size:11px;font-weight:600;min-width:40px;text-align:right">${v.views}</span>
      </div>`;
    }).join('');

    const html = CSS + `
      <div style="max-width:1000px;margin:0 auto;padding:16px">
        ${NAV_BAR('analytics')}
        <div class="es-hero"><h1>📊 Shorts Analytics</h1><p>Track your content performance and growth</p></div>

        <div class="es-stats">
          ${statBox(s.total_shorts, 'Total Shorts', P)}
          ${statBox(s.total_views, 'Total Views', '#3b82f6')}
          ${statBox(s.total_likes, 'Total Likes', '#ef4444')}
          ${statBox(s.total_comments, 'Comments', '#8b5cf6')}
          ${statBox(s.total_shares, 'Shares', '#10b981')}
          ${statBox(engagementRate + '%', 'Engagement Rate', A)}
          ${statBox(bookmarkCount, 'Bookmarks', '#f59e0b')}
          ${statBox(fmtDuration(s.avg_duration || 0), 'Avg Duration', '#6366f1')}
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
          <div class="es-card" style="padding:20px">
            <h3 style="margin:0 0 16px;font-size:15px">📈 Views (Last 30 Days)</h3>
            ${chartHtml || '<p style="color:' + GRAY + ';text-align:center;padding:20px;font-size:13px">No data yet</p>'}
          </div>
          <div class="es-card" style="padding:20px">
            <h3 style="margin:0 0 16px;font-size:15px">📊 Averages</h3>
            <div style="display:grid;gap:12px">
              <div style="display:flex;justify-content:space-between;padding:10px;background:#f9fafb;border-radius:10px">
                <span style="font-size:13px;color:#6b7280">Avg Views per Short</span>
                <span style="font-size:14px;font-weight:700;color:#374151">${s.avg_views || 0}</span>
              </div>
              <div style="display:flex;justify-content:space-between;padding:10px;background:#f9fafb;border-radius:10px">
                <span style="font-size:13px;color:#6b7280">Avg Likes per Short</span>
                <span style="font-size:14px;font-weight:700;color:#374151">${s.avg_likes || 0}</span>
              </div>
              <div style="display:flex;justify-content:space-between;padding:10px;background:#f9fafb;border-radius:10px">
                <span style="font-size:13px;color:#6b7280">Like-to-View Ratio</span>
                <span style="font-size:14px;font-weight:700;color:#374151">${s.total_views > 0 ? (s.total_likes / s.total_views * 100).toFixed(1) : 0}%</span>
              </div>
              <div style="display:flex;justify-content:space-between;padding:10px;background:#f9fafb;border-radius:10px">
                <span style="font-size:13px;color:#6b7280">Comment-to-View Ratio</span>
                <span style="font-size:14px;font-weight:700;color:#374151">${s.total_views > 0 ? (s.total_comments / s.total_views * 100).toFixed(1) : 0}%</span>
              </div>
              <div style="display:flex;justify-content:space-between;padding:10px;background:#f9fafb;border-radius:10px">
                <span style="font-size:13px;color:#6b7280">Avg Duration</span>
                <span style="font-size:14px;font-weight:700;color:#374151">${fmtDuration(s.avg_duration || 0)}</span>
              </div>
            </div>
          </div>
        </div>

        <div class="es-card" style="padding:20px;margin-bottom:20px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
            <h3 style="margin:0;font-size:15px">🏆 Top Performing Shorts</h3>
            <a href="/entertainment/shorts/create" class="es-btn es-btn-primary" style="font-size:12px">➕ New Short</a>
          </div>
          <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">
            <thead><tr>
              <th style="padding:10px;text-align:left;border-bottom:2px solid #f3f4f6;color:#6b7280;font-size:11px;text-transform:uppercase">Rank</th>
              <th style="padding:10px;text-align:left;border-bottom:2px solid #f3f4f6;color:#6b7280;font-size:11px;text-transform:uppercase">Short</th>
              <th style="padding:10px;text-align:left;border-bottom:2px solid #f3f4f6;color:#6b7280;font-size:11px;text-transform:uppercase">Views</th>
              <th style="padding:10px;text-align:left;border-bottom:2px solid #f3f4f6;color:#6b7280;font-size:11px;text-transform:uppercase">Likes</th>
              <th style="padding:10px;text-align:left;border-bottom:2px solid #f3f4f6;color:#6b7280;font-size:11px;text-transform:uppercase">Comments</th>
              <th style="padding:10px;text-align:left;border-bottom:2px solid #f3f4f6;color:#6b7280;font-size:11px;text-transform:uppercase">Shares</th>
              <th style="padding:10px;text-align:left;border-bottom:2px solid #f3f4f6;color:#6b7280;font-size:11px;text-transform:uppercase">Posted</th>
            </tr></thead>
            <tbody>${topShortsHtml || '<tr><td colspan="7" style="text-align:center;color:' + GRAY + ';padding:30px">No shorts yet. Create your first short!</td></tr>'}</tbody>
          </table></div>
        </div>

        ${recentShorts.rows.length > 0 ? `<div class="es-card" style="padding:20px">
          <h3 style="margin:0 0 14px;font-size:15px">🕐 Recent Shorts</h3>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px">
            ${recentShorts.rows.map(sh => `<div style="padding:12px;background:#f9fafb;border-radius:12px">
              <div style="font-size:13px;font-weight:600;margin-bottom:6px">${esc((sh.caption || 'Untitled').substring(0, 30))}</div>
              <div style="font-size:11px;color:${GRAY};display:flex;gap:8px">
                <span>👁 ${sh.views || 0}</span><span>❤️ ${sh.likes || 0}</span><span>💬 ${sh.comment_count || 0}</span>
              </div>
              <div style="font-size:10px;color:${GRAY};margin-top:4px">${fmtAgo(sh.created_at)}</div>
            </div>`).join('')}
          </div>
        </div>` : ''}
      </div>`;
    res.send(renderPage('Shorts Analytics', html, user, req));
  }));

};
