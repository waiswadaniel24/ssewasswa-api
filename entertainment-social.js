// ============================================================
// ENTERTAINMENT SOCIAL MODULE — Social Content & Community
// Instagram-style feed, stories, forums, polls, events, DMs,
// notifications, profiles, gallery, messaging, and more.
// ============================================================
// Usage in server.js:
//   const entSocial = require('./entertainment-social');
//   entSocial(app, pool, { esc, renderPage, ah, requireAuth, logger, audit });
// ============================================================
'use strict';

module.exports = function entertainmentSocial(app, pool, opts) {
  const esc = opts.esc || (s => String(s == null ? '' : (typeof s === 'object' ? JSON.stringify(s) : s))
    .replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])));
  const renderPage = opts.renderPage;
  const ah = opts.ah || (fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next));
  const requireAuth = opts.requireAuth || ((req, res, next) => { if (!req.session?.user) return res.redirect('/login'); next(); });
  const logger = opts.logger || { info: () => {}, warn: () => {}, error: () => {} };

  // ── helpers ──────────────────────────────────────────────
  const timeAgo = (d) => {
    if (!d) return '';
    const diff = Date.now() - new Date(d).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    const days = Math.floor(hrs / 24);
    if (days < 7) return days + 'd ago';
    if (days < 30) return Math.floor(days / 7) + 'w ago';
    return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  };
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const avatarInitial = (email) => email ? email.replace(/@.*/, '').split(/[._\-\s]+/).slice(0, 2).map(p => (p[0] || '').toUpperCase()).join('') : '?';
  const avatarColor = (str) => {
    if (!str) return '#6366f1';
    let h = 0;
    for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
    return ['#3b82f6','#8b5cf6','#ec4899','#f59e0b','#10b981','#ef4444','#06b6d4','#f97316','#14b8a6','#a855f7'][Math.abs(h) % 10];
  };
  const avatarHtml = (email, size) => {
    size = size || 40;
    return `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${avatarColor(email)};display:inline-flex;align-items:center;justify-content:center;color:#fff;font-size:${Math.round(size * 0.4)}px;font-weight:700;flex-shrink:0">${esc(avatarInitial(email))}</div>`;
  };
  const getUser = (req) => req.session.user;
  const TID = (req) => req.session.user.tenant_id;
  const EMAIL = (req) => req.session.user.email;

  // ── CSS ──────────────────────────────────────────────────
  const SC_CSS = `<style>
  .sc-hero{background:linear-gradient(135deg,#3b82f6,#8b5cf6);padding:28px 32px;border-radius:16px;color:#fff;margin-bottom:24px}
  .sc-hero h1{margin:0 0 4px;font-size:24px}.sc-hero p{margin:0;font-size:14px;opacity:.85}
  .sc-nav{display:flex;gap:6px;margin-bottom:20px;flex-wrap:wrap}
  .sc-nav a{padding:8px 16px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#475569;background:#f1f5f9;transition:.15s}
  .sc-nav a:hover{background:#e2e8f0}.sc-nav a.active{background:linear-gradient(135deg,#3b82f6,#8b5cf6);color:#fff}
  .sc-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:20px}
  .sc-stat{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:16px;text-align:center;transition:.15s}
  .sc-stat:hover{box-shadow:0 2px 12px rgba(0,0,0,.05)}
  .sc-stat-val{font-size:26px;font-weight:800;color:#1e293b}.sc-stat-lbl{font-size:11px;color:#94a3b8;margin-top:2px;text-transform:uppercase;letter-spacing:.3px}
  .sc-card{background:#fff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;transition:.15s;margin-bottom:16px}
  .sc-card:hover{box-shadow:0 4px 16px rgba(0,0,0,.06)}
  .sc-card-body{padding:18px}
  .sc-post-img{width:100%;max-height:500px;object-fit:cover;background:#f1f5f9}
  .sc-actions{display:flex;gap:16px;padding:12px 18px;border-top:1px solid #f1f5f9;align-items:center}
  .sc-act-btn{display:inline-flex;align-items:center;gap:6px;padding:6px 14px;border:1px solid #e2e8f0;border-radius:20px;font-size:13px;color:#64748b;background:#fff;cursor:pointer;transition:.15s;text-decoration:none}
  .sc-act-btn:hover{background:#f1f5f9;border-color:#cbd5e1}
  .sc-act-btn.liked{background:#fef2f2;color:#ef4444;border-color:#fca5a5}
  .sc-form label{display:block;font-size:13px;font-weight:600;color:#475569;margin-bottom:4px}
  .sc-form input,.sc-form select,.sc-form textarea{width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;box-sizing:border-box;transition:.15s}
  .sc-form input:focus,.sc-form select:focus,.sc-form textarea:focus{outline:none;border-color:#8b5cf6;box-shadow:0 0 0 3px rgba(139,92,246,.1)}
  .sc-btn{display:inline-flex;align-items:center;gap:6px;padding:10px 20px;border:none;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;text-decoration:none;transition:.15s}
  .sc-btn:hover{opacity:.9;transform:translateY(-1px)}
  .sc-btn-primary{background:linear-gradient(135deg,#3b82f6,#8b5cf6);color:#fff}
  .sc-btn-success{background:#059669;color:#fff}.sc-btn-danger{background:#ef4444;color:#fff}
  .sc-btn-ghost{background:#f1f5f9;color:#475569}
  .sc-fab{position:fixed;bottom:28px;right:28px;width:56px;height:56px;border-radius:50%;background:linear-gradient(135deg,#3b82f6,#8b5cf6);color:#fff;border:none;font-size:24px;cursor:pointer;box-shadow:0 4px 16px rgba(59,130,246,.4);display:flex;align-items:center;justify-content:center;z-index:50;transition:.2s}
  .sc-fab:hover{transform:scale(1.1)}
  .sc-story-ring{width:64px;height:64px;border-radius:50%;padding:3px;background:linear-gradient(135deg,#3b82f6,#8b5cf6,#ec4899);flex-shrink:0}
  .sc-story-ring.seen{background:#e2e8f0}
  .sc-story-inner{width:100%;height:100%;border-radius:50%;border:3px solid #fff;overflow:hidden;display:flex;align-items:center;justify-content:center;background:${avatarColor('default')};color:#fff;font-weight:700;font-size:18px}
  .sc-story-bar{display:flex;gap:14px;overflow-x:auto;padding:16px 0 8px;scrollbar-width:none}
  .sc-story-bar::-webkit-scrollbar{display:none}
  .sc-story-item{display:flex;flex-direction:column;align-items:center;gap:4px;cursor:pointer;min-width:72px}
  .sc-story-name{font-size:11px;color:#475569;max-width:68px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center}
  .sc-msg-row{display:flex;max-width:75%;margin-bottom:6px}
  .sc-msg-row.sent{align-self:flex-end}.sc-msg-row.received{align-self:flex-start}
  .sc-msg-bubble{padding:10px 14px;border-radius:18px;font-size:14px;line-height:1.5;word-wrap:break-word}
  .sc-msg-row.sent .sc-msg-bubble{background:linear-gradient(135deg,#3b82f6,#8b5cf6);color:#fff;border-bottom-right-radius:4px}
  .sc-msg-row.received .sc-msg-bubble{background:#f1f5f9;color:#1e293b;border-bottom-left-radius:4px}
  .sc-gallery{columns:3;column-gap:12px}.sc-gallery-item{break-inside:avoid;margin-bottom:12px;border-radius:12px;overflow:hidden;cursor:pointer;position:relative}
  .sc-gallery-item img{width:100%;display:block;transition:.2s}.sc-gallery-item:hover img{transform:scale(1.03)}
  .sc-gallery-overlay{position:absolute;inset:0;background:linear-gradient(transparent 60%,rgba(0,0,0,.5));opacity:0;transition:.2s;display:flex;align-items:flex-end;padding:12px}
  .sc-gallery-item:hover .sc-gallery-overlay{opacity:1}
  .sc-poll-bar{height:32px;border-radius:8px;min-width:4px;transition:width .4s;display:flex;align-items:center;padding:0 10px;font-size:13px;font-weight:600;color:#fff}
  .sc-cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:2px}
  .sc-cal-day{padding:8px 4px;text-align:center;font-size:12px;border-radius:8px;min-height:40px}
  .sc-cal-day.today{background:#eef2ff;color:#4f46e5;font-weight:700}
  .sc-cal-day.has-event{background:#dcfce7;color:#16a34a;font-weight:600}
  .sc-cal-hdr{padding:8px;text-align:center;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase}
  .sc-notif{display:flex;align-items:center;gap:14px;padding:14px 18px;border-bottom:1px solid #f1f5f9;transition:.1s}
  .sc-notif:hover{background:#f8fafc}.sc-notif.unread{background:#eef2ff}
  .sc-forum-cat{padding:14px 18px;border-bottom:1px solid #f1f5f9;cursor:pointer;transition:.1s}
  .sc-forum-cat:hover{background:#f8fafc}
  .sc-lightbox{position:fixed;inset:0;background:rgba(0,0,0,.9);z-index:100;display:flex;align-items:center;justify-content:center;cursor:pointer}
  .sc-lightbox img{max-width:90vw;max-height:85vh;border-radius:12px}
  @media(max-width:768px){.sc-stats{grid-template-columns:1fr 1fr}.sc-gallery{columns:2}.sc-hero h1{font-size:20px}}
  </style>`;

  // ── Navigation ───────────────────────────────────────────
  const scNav = (active, email) => `<div class="sc-nav">
    <a href="/entertainment/social/feed" class="${active === 'feed' ? 'active' : ''}">📰 Feed</a>
    <a href="/entertainment/social/stories" class="${active === 'stories' ? 'active' : ''}">📖 Stories</a>
    <a href="/entertainment/social/forums" class="${active === 'forums' ? 'active' : ''}">💬 Forums</a>
    <a href="/entertainment/social/polls" class="${active === 'polls' ? 'active' : ''}">📊 Polls</a>
    <a href="/entertainment/social/events" class="${active === 'events' ? 'active' : ''}">📅 Events</a>
    <a href="/entertainment/social/gallery" class="${active === 'gallery' ? 'active' : ''}">🖼 Gallery</a>
    <a href="/entertainment/social/messages" class="${active === 'messages' ? 'active' : ''}">✉️ Messages</a>
    <a href="/entertainment/social/notifications" class="${active === 'notifications' ? 'active' : ''}">🔔 Notifications</a>
    <a href="/entertainment/social/profile" class="${active === 'profile' ? 'active' : ''}">👤 Profile</a>
  </div>`;

  // ============================================================
  // DATABASE MIGRATIONS
  // ============================================================
  (async () => {
    let c = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      c = await pool.connect().catch(() => null);
      if (c) break;
      await new Promise(r => setTimeout(r, 2000 * attempt));
    }
    if (!c) { logger.warn('[EntSocial] DB connect failed after retries'); return; }
    try {
      const tables = [
        `CREATE TABLE IF NOT EXISTS ent_social_posts (
          id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL, author_email VARCHAR(255) NOT NULL,
          content TEXT, image_url TEXT, video_url TEXT, category TEXT DEFAULT 'General',
          likes INTEGER DEFAULT 0, comment_count INTEGER DEFAULT 0, share_count INTEGER DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW())`,
        `CREATE TABLE IF NOT EXISTS ent_social_comments (
          id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL, post_id INTEGER REFERENCES ent_social_posts(id) ON DELETE CASCADE,
          author_email VARCHAR(255) NOT NULL, comment TEXT NOT NULL,
          parent_id INTEGER REFERENCES ent_social_comments(id) ON DELETE CASCADE,
          created_at TIMESTAMPTZ DEFAULT NOW())`,
        `CREATE TABLE IF NOT EXISTS ent_social_likes (
          id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL, post_id INTEGER REFERENCES ent_social_posts(id) ON DELETE CASCADE,
          user_email VARCHAR(255) NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(tenant_id, post_id, user_email))`,
        `CREATE TABLE IF NOT EXISTS ent_social_stories (
          id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL, author_email VARCHAR(255) NOT NULL,
          image_url TEXT, text_overlay TEXT, created_at TIMESTAMPTZ DEFAULT NOW(),
          expires_at TIMESTAMPTZ)`,
        `CREATE TABLE IF NOT EXISTS ent_social_follows (
          id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL,
          follower_email VARCHAR(255) NOT NULL, following_email VARCHAR(255) NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(tenant_id, follower_email, following_email))`,
        `CREATE TABLE IF NOT EXISTS ent_social_profiles (
          id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL, user_email VARCHAR(255) NOT NULL,
          display_name VARCHAR(255), bio TEXT, avatar_url TEXT, created_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(tenant_id, user_email))`,
        `CREATE TABLE IF NOT EXISTS ent_social_forums (
          id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL, category VARCHAR(100) DEFAULT 'General',
          title VARCHAR(500) NOT NULL, content TEXT, author_email VARCHAR(255) NOT NULL,
          views INTEGER DEFAULT 0, is_pinned BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW())`,
        `CREATE TABLE IF NOT EXISTS ent_social_forum_replies (
          id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL, forum_id INTEGER REFERENCES ent_social_forums(id) ON DELETE CASCADE,
          author_email VARCHAR(255) NOT NULL, content TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW())`,
        `CREATE TABLE IF NOT EXISTS ent_social_polls (
          id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL, question TEXT NOT NULL,
          options JSONB DEFAULT '[]', votes JSONB DEFAULT '{}',
          expires_at TIMESTAMPTZ, created_by VARCHAR(255), created_at TIMESTAMPTZ DEFAULT NOW())`,
        `CREATE TABLE IF NOT EXISTS ent_social_events (
          id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL, title VARCHAR(500) NOT NULL,
          description TEXT, event_date DATE, event_time TIME, venue TEXT,
          image_url TEXT, created_by VARCHAR(255), rsvp_count INTEGER DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW())`,
        `CREATE TABLE IF NOT EXISTS ent_social_messages (
          id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL,
          sender_email VARCHAR(255) NOT NULL, receiver_email VARCHAR(255) NOT NULL,
          content TEXT NOT NULL, is_read BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW())`,
        `CREATE TABLE IF NOT EXISTS ent_social_notifications (
          id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL, user_email VARCHAR(255) NOT NULL,
          type VARCHAR(50), actor_email VARCHAR(255), reference_id INTEGER,
          message TEXT, is_read BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW())`
      ];
      for (const sql of tables) { try { await c.query(sql); } catch (e) { logger.warn('[EntSocial] Table error: ' + e.message); } }
      // Indexes
      const idxes = [
        `CREATE INDEX IF NOT EXISTS idx_esp_tenant ON ent_social_posts(tenant_id)`,
        `CREATE INDEX IF NOT EXISTS idx_esp_author ON ent_social_posts(tenant_id, author_email)`,
        `CREATE INDEX IF NOT EXISTS idx_esc_post ON ent_social_comments(post_id)`,
        `CREATE INDEX IF NOT EXISTS idx_esl_post ON ent_social_likes(post_id)`,
        `CREATE INDEX IF NOT EXISTS idx_ess_author ON ent_social_stories(author_email)`,
        `CREATE INDEX IF NOT EXISTS idx_esf_follower ON ent_social_follows(follower_email)`,
        `CREATE INDEX IF NOT EXISTS idx_esf_following ON ent_social_follows(following_email)`,
        `CREATE INDEX IF NOT EXISTS idx_esprof_email ON ent_social_profiles(user_email)`,
        `CREATE INDEX IF NOT EXISTS idx_esforum_cat ON ent_social_forums(tenant_id, category)`,
        `CREATE INDEX IF NOT EXISTS idx_esfr_forum ON ent_social_forum_replies(forum_id)`,
        `CREATE INDEX IF NOT EXISTS idx_esmsg_recv ON ent_social_messages(receiver_email)`,
        `CREATE INDEX IF NOT EXISTS idx_esnotif_user ON ent_social_notifications(user_email)`
      ];
      for (const sql of idxes) { try { await c.query(sql); } catch (e) {} }
      logger.info('[EntSocial] Migrations applied');
    } catch (e) { logger.error('[EntSocial] Migration error: ' + e.message); }
    finally { c.release(); }
  })();

  // ============================================================
  // FEATURE 1: NEWS FEED
  // ============================================================
  app.get('/entertainment/social/feed', requireAuth, ah(async (req, res) => {
    const u = getUser(req), tid = TID(req), email = EMAIL(req);
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 15, offset = (page - 1) * limit;
    const catFilter = req.query.category || '';

    let where = ['p.tenant_id=$1'], params = [tid], pi = 2;
    if (catFilter) { where.push(`p.category=$${pi++}`); params.push(catFilter); }

    const total = (await pool.query(`SELECT COUNT(*)::int as cnt FROM ent_social_posts p WHERE ${where.join(' AND ')}`, params)).rows[0].cnt;
    const posts = (await pool.query(
      `SELECT p.*, (SELECT COUNT(*)::int FROM ent_social_likes WHERE post_id=p.id AND user_email=$${pi}) as user_liked
       FROM ent_social_posts p WHERE ${where.join(' AND ')}
       ORDER BY p.created_at DESC LIMIT $${pi + 1} OFFSET $${pi + 2}`,
      [...params, email, limit, offset]
    )).rows;

    // Active stories for story bar
    const stories = (await pool.query(
      `SELECT DISTINCT ON (s.author_email) s.* FROM ent_social_stories s
       WHERE s.tenant_id=$1 AND s.expires_at > NOW() ORDER BY s.author_email, s.created_at DESC`, [tid]
    )).rows;

    const storyBar = stories.map(s => `
      <div class="sc-story-item" onclick="location.href='/entertainment/social/stories'">
        <div class="sc-story-ring ${s.author_email === email ? 'seen' : ''}">
          <div class="sc-story-inner">${esc(avatarInitial(s.author_email))}</div>
        </div>
        <div class="sc-story-name">${esc(s.author_email.split('@')[0])}</div>
      </div>`).join('');

    const storyBarHtml = stories.length ? `<div class="sc-story-bar">
      <div class="sc-story-item" onclick="location.href='/entertainment/social/stories/new'">
        <div class="sc-story-ring" style="background:#e2e8f0">
          <div class="sc-story-inner" style="font-size:28px;background:#f1f5f9;color:#64748b">+</div>
        </div>
        <div class="sc-story-name">Your Story</div>
      </div>
      ${storyBar}
    </div>` : '';

    const categories = ['General','Review','Meme','Question','Update','Fan Art','Discussion'];
    const catFilterHtml = categories.map(c =>
      `<a href="/entertainment/social/feed?category=${c}" class="sc-btn ${catFilter === c ? 'sc-btn-primary' : 'sc-btn-ghost'}" style="padding:5px 12px;font-size:12px;border-radius:20px">${c}</a>`
    ).join('');

    const postsHtml = posts.map(p => `
      <div class="sc-card">
        <div style="display:flex;align-items:center;gap:12px;padding:16px 18px">
          <a href="/entertainment/social/profile/${esc(p.author_email)}" style="text-decoration:none">${avatarHtml(p.author_email, 42)}</a>
          <div style="flex:1;min-width:0">
            <div style="font-size:14px;font-weight:700;color:#1e293b"><a href="/entertainment/social/profile/${esc(p.author_email)}" style="color:inherit;text-decoration:none">${esc(p.author_email.split('@')[0])}</a></div>
            <div style="font-size:12px;color:#94a3b8">${timeAgo(p.created_at)}</div>
          </div>
          <span style="font-size:11px;padding:3px 10px;border-radius:12px;background:#f1f5f9;color:#64748b">${esc(p.category)}</span>
        </div>
        ${p.content ? `<div style="padding:0 18px 12px;font-size:14px;line-height:1.7;color:#334155;white-space:pre-wrap">${esc(p.content)}</div>` : ''}
        ${p.image_url ? `<img src="${esc(p.image_url)}" class="sc-post-img" alt="Post image" onerror="this.style.display='none'">` : ''}
        ${p.video_url ? `<div style="padding:0 18px 12px"><video src="${esc(p.video_url)}" controls style="width:100%;border-radius:10px;max-height:400px"></video></div>` : ''}
        <div class="sc-actions">
          <form method="POST" action="/entertainment/social/post/${p.id}/like" style="display:inline">
            <button type="submit" class="sc-act-btn ${p.user_liked ? 'liked' : ''}">
              ${p.user_liked ? '❤️' : '🤍'} ${p.likes || 0}
            </button>
          </form>
          <a href="/entertainment/social/post/${p.id}/comments" class="sc-act-btn">💬 ${p.comment_count || 0}</a>
          <form method="POST" action="/entertainment/social/post/${p.id}/share" style="display:inline">
            <button type="submit" class="sc-act-btn">🔄 ${p.share_count || 0}</button>
          </form>
        </div>
      </div>`).join('');

    const totalPages = Math.ceil(total / limit);
    const paginationHtml = totalPages > 1 ? `<div style="display:flex;justify-content:center;gap:6px;margin-top:16px">
      ${page > 1 ? `<a href="/entertainment/social/feed?page=${page - 1}&category=${esc(catFilter)}" class="sc-btn sc-btn-ghost" style="padding:6px 14px">← Prev</a>` : ''}
      <span style="padding:8px 14px;font-size:13px;color:#64748b">Page ${page} of ${totalPages}</span>
      ${page < totalPages ? `<a href="/entertainment/social/feed?page=${page + 1}&category=${esc(catFilter)}" class="sc-btn sc-btn-ghost" style="padding:6px 14px">Next →</a>` : ''}
    </div>` : '';

    const html = SC_CSS + `<div style="max-width:640px;margin:0 auto">
      ${scNav('feed', email)}
      <div class="sc-hero"><h1>📰 Social Feed</h1><p>Stay connected with your community</p></div>
      ${storyBarHtml}
      <div style="display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap">${catFilterHtml}</div>
      ${postsHtml || '<div class="sc-card" style="text-align:center;padding:48px"><p style="color:#94a3b8;font-size:16px">No posts yet. Be the first to share!</p></div>'}
      ${paginationHtml}
      <a href="/entertainment/social/post/new" class="sc-fab" title="Create Post">✏️</a>
    </div>`;
    res.send(renderPage('Social Feed', html, u, req));
  }));

  // ============================================================
  // FEATURE 2: CREATE POST
  // ============================================================
  app.get('/entertainment/social/post/new', requireAuth, ah(async (req, res) => {
    const u = getUser(req);
    const categories = ['General','Review','Meme','Question','Update','Fan Art','Discussion'];
    const catOptions = categories.map(c => `<option value="${c}">${c}</option>`).join('');
    const html = SC_CSS + `<div style="max-width:600px;margin:0 auto">
      ${scNav('feed', EMAIL(req))}
      <a href="/entertainment/social/feed" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Feed</a>
      <div class="sc-card"><div class="sc-card-body">
        <h2 style="margin:0 0 4px;color:#1e293b;font-size:20px">✏️ Create Post</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Share something with your community</p>
        <form method="POST" action="/entertainment/social/post/new" class="sc-form" style="display:flex;flex-direction:column;gap:14px">
          <div><label>Category</label><select name="category">${catOptions}</select></div>
          <div><label>Content</label><textarea name="content" rows="5" required placeholder="What's on your mind?"></textarea></div>
          <div><label>Image URL (optional)</label><input type="url" name="image_url" placeholder="https://example.com/image.jpg"></div>
          <div><label>Video URL (optional)</label><input type="url" name="video_url" placeholder="https://example.com/video.mp4"></div>
          <div style="display:flex;gap:10px">
            <button type="submit" class="sc-btn sc-btn-primary">📤 Post</button>
            <a href="/entertainment/social/feed" class="sc-btn sc-btn-ghost">Cancel</a>
          </div>
        </form>
      </div></div>
    </div>`;
    res.send(renderPage('Create Post', html, u, req));
  }));

  app.post('/entertainment/social/post/new', requireAuth, ah(async (req, res) => {
    const tid = TID(req), email = EMAIL(req);
    const { content, image_url, video_url, category } = req.body;
    if (!content || !content.trim()) return res.redirect('/entertainment/social/post/new');
    await pool.query(
      `INSERT INTO ent_social_posts (tenant_id, author_email, content, image_url, video_url, category) VALUES ($1,$2,$3,$4,$5,$6)`,
      [tid, email, content.trim(), (image_url || '').trim() || null, (video_url || '').trim() || null, category || 'General']
    );
    res.redirect('/entertainment/social/feed');
  }));

  // ============================================================
  // FEATURE 3: STORIES
  // ============================================================
  app.get('/entertainment/social/stories', requireAuth, ah(async (req, res) => {
    const tid = TID(req), email = EMAIL(req);
    const stories = (await pool.query(
      `SELECT s.* FROM ent_social_stories s WHERE s.tenant_id=$1 AND s.expires_at > NOW() ORDER BY s.author_email, s.created_at DESC`, [tid]
    )).rows;

    const storiesByUser = {};
    stories.forEach(s => {
      if (!storiesByUser[s.author_email]) storiesByUser[s.author_email] = [];
      storiesByUser[s.author_email].push(s);
    });

    const storiesHtml = Object.entries(storiesByUser).map(([author, userStories]) => `
      <div class="sc-card" style="margin-bottom:16px">
        <div style="display:flex;align-items:center;gap:12px;padding:14px 18px;border-bottom:1px solid #f1f5f9">
          ${avatarHtml(author, 36)}
          <div>
            <div style="font-size:14px;font-weight:700;color:#1e293b">${esc(author.split('@')[0])}</div>
            <div style="font-size:12px;color:#94a3b8">${timeAgo(userStories[0].created_at)}</div>
          </div>
          <span style="margin-left:auto;font-size:12px;color:#94a3b8">${userStories.length} slide${userStories.length > 1 ? 's' : ''}</span>
        </div>
        ${userStories.map(s => `
          <div style="position:relative">
            ${s.image_url ? `<img src="${esc(s.image_url)}" style="width:100%;max-height:400px;object-fit:cover" onerror="this.style.display='none'">` : `<div style="height:200px;background:linear-gradient(135deg,#3b82f6,#8b5cf6);display:flex;align-items:center;justify-content:center;color:#fff;font-size:18px">${esc(s.text_overlay || 'Story')}</div>`}
            ${s.text_overlay ? `<div style="position:absolute;bottom:0;left:0;right:0;padding:16px;background:linear-gradient(transparent,rgba(0,0,0,.6));color:#fff;font-size:15px;font-weight:600">${esc(s.text_overlay)}</div>` : ''}
          </div>`).join('')}
      </div>`).join('');

    const html = SC_CSS + `<div style="max-width:640px;margin:0 auto">
      ${scNav('stories', email)}
      <div class="sc-hero"><h1>📖 Stories</h1><p>Content that disappears after 24 hours</p></div>
      <div style="margin-bottom:16px">
        <a href="/entertainment/social/stories/new" class="sc-btn sc-btn-primary">+ Add Story</a>
      </div>
      ${storiesHtml || '<div class="sc-card" style="text-align:center;padding:48px"><p style="color:#94a3b8;font-size:16px">No active stories right now</p></div>'}
    </div>`;
    res.send(renderPage('Stories', html, getUser(req), req));
  }));

  app.post('/entertainment/social/stories/new', requireAuth, ah(async (req, res) => {
    const tid = TID(req), email = EMAIL(req);
    const { image_url, text_overlay } = req.body;
    if (!image_url && !text_overlay) return res.redirect('/entertainment/social/stories');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await pool.query(
      `INSERT INTO ent_social_stories (tenant_id, author_email, image_url, text_overlay, expires_at) VALUES ($1,$2,$3,$4,$5)`,
      [tid, email, (image_url || '').trim() || null, (text_overlay || '').trim() || null, expiresAt]
    );
    res.redirect('/entertainment/social/stories');
  }));

  app.get('/entertainment/social/stories/new', requireAuth, ah(async (req, res) => {
    const html = SC_CSS + `<div style="max-width:500px;margin:0 auto">
      ${scNav('stories', EMAIL(req))}
      <a href="/entertainment/social/stories" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Stories</a>
      <div class="sc-card"><div class="sc-card-body">
        <h2 style="margin:0 0 16px;color:#1e293b">+ Add Story</h2>
        <form method="POST" action="/entertainment/social/stories/new" class="sc-form" style="display:flex;flex-direction:column;gap:14px">
          <div><label>Image URL</label><input type="url" name="image_url" placeholder="https://example.com/story.jpg"></div>
          <div><label>Text Overlay</label><input type="text" name="text_overlay" placeholder="Write something..." maxlength="200"></div>
          <button type="submit" class="sc-btn sc-btn-primary">Share Story</button>
        </form>
      </div></div>
    </div>`;
    res.send(renderPage('Add Story', html, getUser(req), req));
  }));

  // ============================================================
  // FEATURE 4: PROFILES
  // ============================================================
  app.get('/entertainment/social/profile/:email', requireAuth, ah(async (req, res) => {
    const u = getUser(req), tid = TID(req), profileEmail = req.params.email;
    const profile = (await pool.query(
      `SELECT * FROM ent_social_profiles WHERE tenant_id=$1 AND user_email=$2`, [tid, profileEmail]
    )).rows[0] || { display_name: profileEmail.split('@')[0], bio: '', avatar_url: '' };

    const followers = (await pool.query(`SELECT COUNT(*)::int as cnt FROM ent_social_follows WHERE tenant_id=$1 AND following_email=$2`, [tid, profileEmail])).rows[0].cnt;
    const following = (await pool.query(`SELECT COUNT(*)::int as cnt FROM ent_social_follows WHERE tenant_id=$1 AND follower_email=$2`, [tid, profileEmail])).rows[0].cnt;
    const postCount = (await pool.query(`SELECT COUNT(*)::int as cnt FROM ent_social_posts WHERE tenant_id=$1 AND author_email=$2`, [tid, profileEmail])).rows[0].cnt;
    const totalLikes = (await pool.query(`SELECT COALESCE(SUM(likes),0)::int as cnt FROM ent_social_posts WHERE tenant_id=$1 AND author_email=$2`, [tid, profileEmail])).rows[0].cnt;
    const isFollowing = u.email !== profileEmail && (await pool.query(
      `SELECT id FROM ent_social_follows WHERE tenant_id=$1 AND follower_email=$2 AND following_email=$3`, [tid, u.email, profileEmail]
    )).rows.length > 0;

    const tab = req.query.tab || 'posts';
    let tabContent = '';
    if (tab === 'posts') {
      const posts = (await pool.query(`SELECT * FROM ent_social_posts WHERE tenant_id=$1 AND author_email=$2 ORDER BY created_at DESC LIMIT 20`, [tid, profileEmail])).rows;
      tabContent = posts.map(p => `<div class="sc-card"><div class="sc-card-body">
        <div style="font-size:13px;color:#94a3b8;margin-bottom:6px">${timeAgo(p.created_at)} · ${esc(p.category)}</div>
        <div style="font-size:14px;color:#334155;line-height:1.6;white-space:pre-wrap">${esc(p.content || '')}</div>
        ${p.image_url ? `<img src="${esc(p.image_url)}" style="width:100%;border-radius:10px;margin-top:10px;max-height:300px;object-fit:cover" onerror="this.style.display='none'">` : ''}
        <div style="display:flex;gap:16px;margin-top:10px;font-size:13px;color:#64748b">
          <span>❤️ ${p.likes || 0}</span><span>💬 ${p.comment_count || 0}</span><span>🔄 ${p.share_count || 0}</span>
        </div>
      </div></div>`).join('');
    } else if (tab === 'liked') {
      const liked = (await pool.query(
        `SELECT p.* FROM ent_social_likes l JOIN ent_social_posts p ON p.id=l.post_id WHERE l.tenant_id=$1 AND l.user_email=$2 ORDER BY l.created_at DESC LIMIT 20`, [tid, profileEmail]
      )).rows;
      tabContent = liked.map(p => `<div class="sc-card"><div class="sc-card-body">
        <div style="font-size:13px;color:#94a3b8">by ${esc(p.author_email.split('@')[0])} · ${timeAgo(p.created_at)}</div>
        <div style="font-size:14px;color:#334155;line-height:1.6;white-space:pre-wrap">${esc(p.content || '')}</div>
      </div></div>`).join('');
    }

    const html = SC_CSS + `<div style="max-width:700px;margin:0 auto">
      ${scNav('profile', EMAIL(req))}
      <div class="sc-card" style="margin-bottom:20px">
        <div style="padding:28px;text-align:center">
          ${profile.avatar_url ? `<img src="${esc(profile.avatar_url)}" style="width:80px;height:80px;border-radius:50%;margin-bottom:12px">` : `<div style="width:80px;height:80px;border-radius:50%;background:${avatarColor(profileEmail)};display:inline-flex;align-items:center;justify-content:center;color:#fff;font-size:32px;font-weight:700;margin-bottom:12px">${esc(avatarInitial(profileEmail))}</div>`}
          <h2 style="margin:0 0 4px;color:#1e293b">${esc(profile.display_name)}</h2>
          <p style="font-size:13px;color:#64748b;margin-bottom:8px">${esc(profileEmail)}</p>
          <p style="font-size:14px;color:#475569;margin-bottom:16px;max-width:400px;margin-left:auto;margin-right:auto">${esc(profile.bio || 'No bio yet')}</p>
          <div style="display:flex;justify-content:center;gap:24px;margin-bottom:16px">
            <div><div style="font-size:20px;font-weight:800;color:#1e293b">${postCount}</div><div style="font-size:11px;color:#94a3b8">Posts</div></div>
            <div><div style="font-size:20px;font-weight:800;color:#1e293b">${followers}</div><div style="font-size:11px;color:#94a3b8">Followers</div></div>
            <div><div style="font-size:20px;font-weight:800;color:#1e293b">${following}</div><div style="font-size:11px;color:#94a3b8">Following</div></div>
            <div><div style="font-size:20px;font-weight:800;color:#ef4444">${totalLikes}</div><div style="font-size:11px;color:#94a3b8">Likes</div></div>
          </div>
          ${u.email !== profileEmail ? `
            <form method="POST" action="/entertainment/social/profile/${esc(profileEmail)}/${isFollowing ? 'unfollow' : 'follow'}" style="display:inline">
              <button type="submit" class="sc-btn ${isFollowing ? 'sc-btn-ghost' : 'sc-btn-primary'}">${isFollowing ? '✓ Following' : '+ Follow'}</button>
            </form>` : `
            <a href="/entertainment/social/profile/edit" class="sc-btn sc-btn-ghost">✏️ Edit Profile</a>`}
        </div>
      </div>
      <div style="display:flex;gap:6px;margin-bottom:16px">
        <a href="/entertainment/social/profile/${esc(profileEmail)}?tab=posts" class="sc-btn ${tab === 'posts' ? 'sc-btn-primary' : 'sc-btn-ghost'}" style="padding:6px 14px;font-size:13px;border-radius:20px">Posts</a>
        <a href="/entertainment/social/profile/${esc(profileEmail)}?tab=liked" class="sc-btn ${tab === 'liked' ? 'sc-btn-primary' : 'sc-btn-ghost'}" style="padding:6px 14px;font-size:13px;border-radius:20px">Liked</a>
      </div>
      ${tabContent || '<div class="sc-card" style="text-align:center;padding:40px"><p style="color:#94a3b8">No content yet</p></div>'}
    </div>`;
    res.send(renderPage('Profile — ' + profile.display_name, html, u, req));
  }));

  app.get('/entertainment/social/profile', requireAuth, ah(async (req, res) => {
    res.redirect('/entertainment/social/profile/' + EMAIL(req));
  }));

  app.get('/entertainment/social/profile/edit', requireAuth, ah(async (req, res) => {
    const tid = TID(req), email = EMAIL(req);
    const profile = (await pool.query(`SELECT * FROM ent_social_profiles WHERE tenant_id=$1 AND user_email=$2`, [tid, email])).rows[0];
    const html = SC_CSS + `<div style="max-width:500px;margin:0 auto">
      ${scNav('profile', email)}
      <a href="/entertainment/social/profile" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Profile</a>
      <div class="sc-card"><div class="sc-card-body">
        <h2 style="margin:0 0 16px;color:#1e293b">✏️ Edit Profile</h2>
        <form method="POST" action="/entertainment/social/profile/edit" class="sc-form" style="display:flex;flex-direction:column;gap:14px">
          <div><label>Display Name</label><input type="text" name="display_name" value="${esc(profile?.display_name || '')}" maxlength="100"></div>
          <div><label>Bio</label><textarea name="bio" rows="3" maxlength="500">${esc(profile?.bio || '')}</textarea></div>
          <div><label>Avatar URL</label><input type="url" name="avatar_url" value="${esc(profile?.avatar_url || '')}" placeholder="https://..."></div>
          <button type="submit" class="sc-btn sc-btn-primary">Save Changes</button>
        </form>
      </div></div>
    </div>`;
    res.send(renderPage('Edit Profile', html, getUser(req), req));
  }));

  app.post('/entertainment/social/profile/edit', requireAuth, ah(async (req, res) => {
    const tid = TID(req), email = EMAIL(req);
    const { display_name, bio, avatar_url } = req.body;
    await pool.query(
      `INSERT INTO ent_social_profiles (tenant_id, user_email, display_name, bio, avatar_url) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (tenant_id, user_email) DO UPDATE SET display_name=$3, bio=$4, avatar_url=$5`,
      [tid, email, (display_name || '').trim() || email.split('@')[0], (bio || '').trim(), (avatar_url || '').trim()]
    );
    res.redirect('/entertainment/social/profile');
  }));

  // ============================================================
  // FEATURE 5: FOLLOW SYSTEM
  // ============================================================
  app.post('/entertainment/social/profile/:email/follow', requireAuth, ah(async (req, res) => {
    const tid = TID(req), email = EMAIL(req), target = req.params.email;
    if (email === target) return res.redirect('/entertainment/social/profile/' + target);
    await pool.query(
      `INSERT INTO ent_social_follows (tenant_id, follower_email, following_email) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [tid, email, target]
    );
    await pool.query(
      `INSERT INTO ent_social_notifications (tenant_id, user_email, type, actor_email, message) VALUES ($1,$2,'follow',$3,$4) ON CONFLICT DO NOTHING`,
      [tid, target, email, `${email.split('@')[0]} started following you`]
    );
    const referer = req.header('Referer') || '/entertainment/social/profile/' + target;
    res.redirect(referer);
  }));

  app.post('/entertainment/social/profile/:email/unfollow', requireAuth, ah(async (req, res) => {
    const tid = TID(req), email = EMAIL(req), target = req.params.email;
    await pool.query(`DELETE FROM ent_social_follows WHERE tenant_id=$1 AND follower_email=$2 AND following_email=$3`, [tid, email, target]);
    const referer = req.header('Referer') || '/entertainment/social/profile/' + target;
    res.redirect(referer);
  }));

  // ============================================================
  // FEATURE 6: LIKES, COMMENTS, SHARES
  // ============================================================
  app.post('/entertainment/social/post/:id/like', requireAuth, ah(async (req, res) => {
    const tid = TID(req), email = EMAIL(req), postId = req.params.id;
    const existing = (await pool.query(`SELECT id FROM ent_social_likes WHERE tenant_id=$1 AND post_id=$2 AND user_email=$3`, [tid, postId, email])).rows[0];
    const post = (await pool.query(`SELECT author_email FROM ent_social_posts WHERE id=$1 AND tenant_id=$2`, [postId, tid])).rows[0];
    if (existing) {
      await pool.query(`DELETE FROM ent_social_likes WHERE id=$1`, [existing.id]);
      await pool.query(`UPDATE ent_social_posts SET likes=GREATEST(0,likes-1) WHERE id=$1 AND tenant_id=$2`, [postId, tid]);
    } else {
      await pool.query(`INSERT INTO ent_social_likes (tenant_id, post_id, user_email) VALUES ($1,$2,$3)`, [tid, postId, email]);
      await pool.query(`UPDATE ent_social_posts SET likes=likes+1 WHERE id=$1 AND tenant_id=$2`, [postId, tid]);
      if (post && post.author_email !== email) {
        await pool.query(
          `INSERT INTO ent_social_notifications (tenant_id, user_email, type, actor_email, reference_id, message) VALUES ($1,$2,'like',$3,$4,$5)`,
          [tid, post.author_email, email, postId, `${email.split('@')[0]} liked your post`]
        );
      }
    }
    res.redirect(req.header('Referer') || '/entertainment/social/feed');
  }));

  // Comments page
  app.get('/entertainment/social/post/:id/comments', requireAuth, ah(async (req, res) => {
    const tid = TID(req), email = EMAIL(req), postId = req.params.id;
    const post = (await pool.query(`SELECT * FROM ent_social_posts WHERE id=$1 AND tenant_id=$2`, [postId, tid])).rows[0];
    if (!post) return res.redirect('/entertainment/social/feed');
    const comments = (await pool.query(
      `SELECT c.* FROM ent_social_comments c WHERE c.post_id=$1 AND c.tenant_id=$2 ORDER BY c.created_at DESC`, [postId, tid]
    )).rows;

    const commentsHtml = comments.map(c => `
      <div style="display:flex;gap:10px;padding:12px 0;border-bottom:1px solid #f1f5f9">
        ${avatarHtml(c.author_email, 32)}
        <div style="flex:1">
          <div style="font-size:13px"><span style="font-weight:700;color:#1e293b">${esc(c.author_email.split('@')[0])}</span> <span style="color:#94a3b8;font-size:12px">${timeAgo(c.created_at)}</span></div>
          <div style="font-size:14px;color:#334155;margin-top:4px;line-height:1.5">${esc(c.comment)}</div>
          ${c.parent_id ? '' : `<form method="POST" action="/entertainment/social/post/${postId}/comment" style="margin-top:6px;display:flex;gap:6px">
            <input type="hidden" name="parent_id" value="${c.id}">
            <input type="text" name="comment" placeholder="Reply..." style="flex:1;padding:6px 10px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px">
            <button type="submit" class="sc-btn sc-btn-ghost" style="padding:6px 12px;font-size:12px">Reply</button>
          </form>`}
        </div>
      </div>`).join('');

    const html = SC_CSS + `<div style="max-width:640px;margin:0 auto">
      ${scNav('feed', email)}
      <a href="/entertainment/social/feed" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Feed</a>
      <div class="sc-card"><div class="sc-card-body">
        <div style="font-size:14px;color:#334155;line-height:1.6;white-space:pre-wrap;margin-bottom:16px">${esc(post.content || '')}</div>
        ${post.image_url ? `<img src="${esc(post.image_url)}" style="width:100%;border-radius:10px;margin-bottom:16px" onerror="this.style.display='none'">` : ''}
        <h3 style="margin:0 0 12px;color:#1e293b">💬 Comments (${comments.length})</h3>
        ${commentsHtml || '<p style="color:#94a3b8;font-size:14px">No comments yet</p>'}
      </div></div>
      <div class="sc-card"><div class="sc-card-body">
        <form method="POST" action="/entertainment/social/post/${postId}/comment" class="sc-form" style="display:flex;flex-direction:column;gap:10px">
          <input type="hidden" name="parent_id" value="">
          <textarea name="comment" rows="2" required placeholder="Write a comment..." style="font-size:14px"></textarea>
          <button type="submit" class="sc-btn sc-btn-primary" style="align-self:flex-end">Post Comment</button>
        </form>
      </div></div>
    </div>`;
    res.send(renderPage('Comments', html, getUser(req), req));
  }));

  app.post('/entertainment/social/post/:id/comment', requireAuth, ah(async (req, res) => {
    const tid = TID(req), email = EMAIL(req), postId = req.params.id;
    const { comment, parent_id } = req.body;
    if (!comment || !comment.trim()) return res.redirect('/entertainment/social/post/' + postId + '/comments');
    await pool.query(
      `INSERT INTO ent_social_comments (tenant_id, post_id, author_email, comment, parent_id) VALUES ($1,$2,$3,$4,$5)`,
      [tid, postId, email, comment.trim(), parent_id || null]
    );
    await pool.query(`UPDATE ent_social_posts SET comment_count=comment_count+1 WHERE id=$1 AND tenant_id=$2`, [postId, tid]);
    const post = (await pool.query(`SELECT author_email FROM ent_social_posts WHERE id=$1 AND tenant_id=$2`, [postId, tid])).rows[0];
    if (post && post.author_email !== email) {
      await pool.query(
        `INSERT INTO ent_social_notifications (tenant_id, user_email, type, actor_email, reference_id, message) VALUES ($1,$2,'comment',$3,$4,$5)`,
        [tid, post.author_email, email, postId, `${email.split('@')[0]} commented on your post`]
      );
    }
    res.redirect('/entertainment/social/post/' + postId + '/comments');
  }));

  app.post('/entertainment/social/post/:id/share', requireAuth, ah(async (req, res) => {
    const tid = TID(req), postId = req.params.id;
    await pool.query(`UPDATE ent_social_posts SET share_count=share_count+1 WHERE id=$1 AND tenant_id=$2`, [postId, tid]);
    res.redirect(req.header('Referer') || '/entertainment/social/feed');
  }));

  // ============================================================
  // FEATURE 7: FORUMS
  // ============================================================
  const FORUM_CATEGORIES = ['Movies & TV','Music','Gaming','Books','Sports','Technology','General'];

  app.get('/entertainment/social/forums', requireAuth, ah(async (req, res) => {
    const tid = TID(req), email = EMAIL(req);
    const catFilter = req.query.category || '';
    let where = ['f.tenant_id=$1'], params = [tid], pi = 2;
    if (catFilter) { where.push(`f.category=$${pi++}`); params.push(catFilter); }

    const forums = (await pool.query(
      `SELECT f.*, (SELECT COUNT(*)::int FROM ent_social_forum_replies WHERE forum_id=f.id) as reply_count
       FROM ent_social_forums f WHERE ${where.join(' AND ')}
       ORDER BY f.is_pinned DESC, f.created_at DESC`, params
    )).rows;

    const catTabs = FORUM_CATEGORIES.map(c =>
      `<a href="/entertainment/social/forums?category=${c}" class="sc-btn ${catFilter === c ? 'sc-btn-primary' : 'sc-btn-ghost'}" style="padding:5px 12px;font-size:12px;border-radius:20px">${c}</a>`
    ).join('');

    const forumsHtml = forums.map(f => `
      <a href="/entertainment/social/forums/${f.id}" style="text-decoration:none;color:inherit">
        <div class="sc-forum-cat">
          <div style="display:flex;align-items:center;gap:12px">
            ${f.is_pinned ? '<span style="font-size:16px">📌</span>' : '<span style="font-size:16px">💬</span>'}
            <div style="flex:1;min-width:0">
              <div style="font-size:15px;font-weight:700;color:#1e293b">${esc(f.title)}</div>
              <div style="font-size:12px;color:#94a3b8;margin-top:2px">by ${esc(f.author_email.split('@')[0])} · ${timeAgo(f.created_at)}</div>
            </div>
            <div style="text-align:right;flex-shrink:0">
              <div style="font-size:11px;padding:2px 10px;border-radius:10px;background:#f1f5f9;color:#64748b">${esc(f.category)}</div>
              <div style="font-size:12px;color:#94a3b8;margin-top:4px">${f.reply_count || 0} replies · ${f.views || 0} views</div>
            </div>
          </div>
        </div>
      </a>`).join('');

    const html = SC_CSS + `<div style="max-width:700px;margin:0 auto">
      ${scNav('forums', email)}
      <div class="sc-hero" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
        <div><h1 style="margin-bottom:2px">💬 Forums</h1><p>Discuss topics with your community</p></div>
        <a href="/entertainment/social/forums/new" class="sc-btn" style="background:rgba(255,255,255,.2);color:#fff;border-radius:10px">+ New Thread</a>
      </div>
      <div style="display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap">${catTabs}</div>
      <div class="sc-card" style="overflow:hidden">
        ${forumsHtml || '<div style="text-align:center;padding:40px;color:#94a3b8">No threads yet</div>'}
      </div>
    </div>`;
    res.send(renderPage('Forums', html, getUser(req), req));
  }));

  app.get('/entertainment/social/forums/new', requireAuth, ah(async (req, res) => {
    const catOptions = FORUM_CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join('');
    const html = SC_CSS + `<div style="max-width:600px;margin:0 auto">
      ${scNav('forums', EMAIL(req))}
      <a href="/entertainment/social/forums" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Forums</a>
      <div class="sc-card"><div class="sc-card-body">
        <h2 style="margin:0 0 16px;color:#1e293b">+ New Thread</h2>
        <form method="POST" action="/entertainment/social/forums/new" class="sc-form" style="display:flex;flex-direction:column;gap:14px">
          <div><label>Title</label><input type="text" name="title" required placeholder="Thread title..." maxlength="500"></div>
          <div><label>Category</label><select name="category">${catOptions}</select></div>
          <div><label>Content</label><textarea name="content" rows="8" required placeholder="Share your thoughts..."></textarea></div>
          <button type="submit" class="sc-btn sc-btn-primary">Create Thread</button>
        </form>
      </div></div>
    </div>`;
    res.send(renderPage('New Thread', html, getUser(req), req));
  }));

  app.post('/entertainment/social/forums/new', requireAuth, ah(async (req, res) => {
    const tid = TID(req), email = EMAIL(req);
    const { title, content, category } = req.body;
    if (!title || !title.trim() || !content || !content.trim()) return res.redirect('/entertainment/social/forums/new');
    const result = await pool.query(
      `INSERT INTO ent_social_forums (tenant_id, category, title, content, author_email) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [tid, category || 'General', title.trim(), content.trim(), email]
    );
    res.redirect('/entertainment/social/forums/' + result.rows[0].id);
  }));

  app.get('/entertainment/social/forums/:id', requireAuth, ah(async (req, res) => {
    const tid = TID(req), email = EMAIL(req), forumId = req.params.id;
    await pool.query(`UPDATE ent_social_forums SET views=views+1 WHERE id=$1 AND tenant_id=$2`, [forumId, tid]);
    const forum = (await pool.query(`SELECT * FROM ent_social_forums WHERE id=$1 AND tenant_id=$2`, [forumId, tid])).rows[0];
    if (!forum) return res.redirect('/entertainment/social/forums');
    const replies = (await pool.query(
      `SELECT * FROM ent_social_forum_replies WHERE forum_id=$1 AND tenant_id=$2 ORDER BY created_at ASC`, [forumId, tid]
    )).rows;

    const repliesHtml = replies.map(r => `
      <div style="display:flex;gap:10px;padding:14px 0;border-bottom:1px solid #f1f5f9">
        ${avatarHtml(r.author_email, 34)}
        <div style="flex:1">
          <div style="font-size:13px"><span style="font-weight:700;color:#1e293b">${esc(r.author_email.split('@')[0])}</span> <span style="color:#94a3b8;font-size:12px">${timeAgo(r.created_at)}</span></div>
          <div style="font-size:14px;color:#334155;margin-top:4px;line-height:1.6;white-space:pre-wrap">${esc(r.content)}</div>
        </div>
      </div>`).join('');

    const html = SC_CSS + `<div style="max-width:700px;margin:0 auto">
      ${scNav('forums', email)}
      <a href="/entertainment/social/forums" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Forums</a>
      <div class="sc-card"><div class="sc-card-body">
        ${forum.is_pinned ? '<span style="font-size:12px;padding:2px 10px;border-radius:10px;background:#fef3c7;color:#b45309">📌 Pinned</span>' : ''}
        <span style="font-size:12px;padding:2px 10px;border-radius:10px;background:#f1f5f9;color:#64748b;margin-left:6px">${esc(forum.category)}</span>
        <h2 style="margin:10px 0 4px;color:#1e293b;font-size:20px">${esc(forum.title)}</h2>
        <div style="font-size:12px;color:#94a3b8;margin-bottom:16px">by ${esc(forum.author_email.split('@')[0])} · ${fmtDateTime(forum.created_at)} · ${forum.views} views</div>
        <div style="font-size:14px;line-height:1.8;color:#334155;white-space:pre-wrap;padding:16px;background:#f8fafc;border-radius:10px">${esc(forum.content)}</div>
      </div></div>
      <div class="sc-card"><div class="sc-card-body">
        <h3 style="margin:0 0 12px;color:#1e293b">💬 Replies (${replies.length})</h3>
        ${repliesHtml || '<p style="color:#94a3b8;font-size:14px">No replies yet</p>'}
      </div></div>
      <div class="sc-card"><div class="sc-card-body">
        <form method="POST" action="/entertainment/social/forums/${forumId}/reply" class="sc-form" style="display:flex;flex-direction:column;gap:10px">
          <textarea name="content" rows="3" required placeholder="Write your reply..."></textarea>
          <button type="submit" class="sc-btn sc-btn-primary" style="align-self:flex-end">Post Reply</button>
        </form>
      </div></div>
    </div>`;
    res.send(renderPage(forum.title, html, getUser(req), req));
  }));

  app.post('/entertainment/social/forums/:id/reply', requireAuth, ah(async (req, res) => {
    const tid = TID(req), email = EMAIL(req), forumId = req.params.id;
    const { content } = req.body;
    if (!content || !content.trim()) return res.redirect('/entertainment/social/forums/' + forumId);
    await pool.query(`INSERT INTO ent_social_forum_replies (tenant_id, forum_id, author_email, content) VALUES ($1,$2,$3,$4)`, [tid, forumId, email, content.trim()]);
    res.redirect('/entertainment/social/forums/' + forumId);
  }));

  // ============================================================
  // FEATURE 8: POLLS & QUIZZES
  // ============================================================
  app.get('/entertainment/social/polls', requireAuth, ah(async (req, res) => {
    const tid = TID(req), email = EMAIL(req);
    const polls = (await pool.query(
      `SELECT p.*, (SELECT COUNT(DISTINCT (each(votes)).key)::int FROM (SELECT votes FROM ent_social_polls WHERE id=p.id) x) as voter_count
       FROM ent_social_polls p WHERE p.tenant_id=$1 ORDER BY p.created_at DESC`, [tid]
    )).rows;

    const pollsHtml = polls.map(p => {
      const options = Array.isArray(p.options) ? p.options : [];
      const votes = typeof p.votes === 'object' && p.votes !== null ? p.votes : {};
      const totalVotes = Object.values(votes).reduce((a, b) => a + (parseInt(b) || 0), 0);
      const hasExpired = p.expires_at && new Date(p.expires_at) < new Date();
      const userVoted = votes[email] !== undefined;

      const barsHtml = options.map((opt, i) => {
        const count = parseInt(votes[opt]) || 0;
        const pct = totalVotes > 0 ? Math.round(count / totalVotes * 100) : 0;
        return `<div style="margin-bottom:8px">
          <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:3px">
            <span style="color:#334155;font-weight:${userVoted || hasExpired ? '600' : '400'}">${esc(opt)}</span>
            <span style="color:#64748b">${pct}% (${count})</span>
          </div>
          <div style="background:#f1f5f9;border-radius:8px;overflow:hidden;height:32px">
            <div class="sc-poll-bar" style="width:${pct}%;background:linear-gradient(135deg,#3b82f6,#8b5cf6)"></div>
          </div>
        </div>`;
      }).join('');

      const voteForm = !userVoted && !hasExpired ? `
        <form method="POST" action="/entertainment/social/polls/${p.id}/vote" style="margin-top:12px;display:flex;flex-direction:column;gap:6px">
          ${options.map(opt => `<label style="display:flex;align-items:center;gap:8px;padding:8px 12px;border:1px solid #e2e8f0;border-radius:8px;cursor:pointer;font-size:14px;color:#334155;transition:.1s">
            <input type="radio" name="option" value="${esc(opt)}" style="accent-color:#8b5cf6"> ${esc(opt)}
          </label>`).join('')}
          <button type="submit" class="sc-btn sc-btn-primary" style="margin-top:4px">🗳 Vote</button>
        </form>` : '';

      return `<div class="sc-card"><div class="sc-card-body">
        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:4px">
          <span style="font-size:12px;padding:2px 10px;border-radius:10px;background:${hasExpired ? '#fee2e2;color:#dc2626' : '#dcfce7;color:#16a34a'}">${hasExpired ? 'Expired' : 'Active'}</span>
          <span style="font-size:12px;color:#94a3b8">${timeAgo(p.created_at)}</span>
        </div>
        <h3 style="margin:8px 0 4px;color:#1e293b;font-size:17px">${esc(p.question)}</h3>
        <div style="font-size:12px;color:#94a3b8;margin-bottom:14px">by ${esc((p.created_by || '').split('@')[0])} · ${totalVotes} vote${totalVotes !== 1 ? 's' : ''}${p.expires_at ? ' · ends ' + fmtDate(p.expires_at) : ''}</div>
        ${(userVoted || hasExpired) ? barsHtml : ''}
        ${voteForm}
      </div></div>`;
    }).join('');

    const html = SC_CSS + `<div style="max-width:600px;margin:0 auto">
      ${scNav('polls', email)}
      <div class="sc-hero" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
        <div><h1 style="margin-bottom:2px">📊 Polls</h1><p>Vote and see what the community thinks</p></div>
        <a href="/entertainment/social/polls/new" class="sc-btn" style="background:rgba(255,255,255,.2);color:#fff;border-radius:10px">+ Create Poll</a>
      </div>
      ${pollsHtml || '<div class="sc-card" style="text-align:center;padding:48px"><p style="color:#94a3b8;font-size:16px">No polls yet</p></div>'}
    </div>`;
    res.send(renderPage('Polls', html, getUser(req), req));
  }));

  app.get('/entertainment/social/polls/new', requireAuth, ah(async (req, res) => {
    const html = SC_CSS + `<div style="max-width:500px;margin:0 auto">
      ${scNav('polls', EMAIL(req))}
      <a href="/entertainment/social/polls" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Polls</a>
      <div class="sc-card"><div class="sc-card-body">
        <h2 style="margin:0 0 16px;color:#1e293b">📊 Create Poll</h2>
        <form method="POST" action="/entertainment/social/polls/new" class="sc-form" style="display:flex;flex-direction:column;gap:14px">
          <div><label>Question</label><input type="text" name="question" required placeholder="Ask a question..." maxlength="500"></div>
          <div id="poll-options">
            <label>Options</label>
            <input type="text" name="option_1" required placeholder="Option 1" style="margin-bottom:8px">
            <input type="text" name="option_2" required placeholder="Option 2" style="margin-bottom:8px">
          </div>
          <button type="button" class="sc-btn sc-btn-ghost" onclick="addPollOption()">+ Add Option (max 6)</button>
          <div><label>Expires At (optional)</label><input type="datetime-local" name="expires_at"></div>
          <button type="submit" class="sc-btn sc-btn-primary">Create Poll</button>
        </form>
      </div></div>
      <script>let optCount=2;function addPollOption(){if(optCount>=6)return;optCount++;const d=document.createElement('input');d.type='text';d.name='option_'+optCount;d.placeholder='Option '+optCount;d.required=true;d.style.marginBottom='8px';document.getElementById('poll-options').appendChild(d);if(optCount>=6)event.target.style.display='none'}</script>
    </div>`;
    res.send(renderPage('Create Poll', html, getUser(req), req));
  }));

  app.post('/entertainment/social/polls/new', requireAuth, ah(async (req, res) => {
    const tid = TID(req), email = EMAIL(req);
    const { question, expires_at } = req.body;
    const options = [];
    for (let i = 1; i <= 6; i++) {
      if (req.body['option_' + i] && req.body['option_' + i].trim()) options.push(req.body['option_' + i].trim());
    }
    if (!question || !question.trim() || options.length < 2) return res.redirect('/entertainment/social/polls/new');
    await pool.query(
      `INSERT INTO ent_social_polls (tenant_id, question, options, votes, expires_at, created_by) VALUES ($1,$2,$3,'{}',$4,$5)`,
      [tid, question.trim(), JSON.stringify(options), expires_at || null, email]
    );
    res.redirect('/entertainment/social/polls');
  }));

  app.post('/entertainment/social/polls/:id/vote', requireAuth, ah(async (req, res) => {
    const tid = TID(req), email = EMAIL(req), pollId = req.params.id;
    const { option } = req.body;
    if (!option) return res.redirect('/entertainment/social/polls');
    const poll = (await pool.query(`SELECT * FROM ent_social_polls WHERE id=$1 AND tenant_id=$2`, [pollId, tid])).rows[0];
    if (!poll) return res.redirect('/entertainment/social/polls');
    if (poll.expires_at && new Date(poll.expires_at) < new Date()) return res.redirect('/entertainment/social/polls');
    const votes = typeof poll.votes === 'object' && poll.votes !== null ? { ...poll.votes } : {};
    if (!votes[email]) {
      votes[email] = option;
      await pool.query(`UPDATE ent_social_polls SET votes=$1 WHERE id=$2 AND tenant_id=$3`, [JSON.stringify(votes), pollId, tid]);
    }
    res.redirect('/entertainment/social/polls');
  }));

  // ============================================================
  // FEATURE 9: EVENT CALENDAR
  // ============================================================
  app.get('/entertainment/social/events', requireAuth, ah(async (req, res) => {
    const tid = TID(req), email = EMAIL(req);
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
    const year = parseInt(req.query.year) || new Date().getFullYear();

    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0);
    const startPad = firstDay.getDay();
    const daysInMonth = lastDay.getDate();
    const today = new Date();
    const monthName = firstDay.toLocaleString('en-US', { month: 'long', year: 'numeric' });

    const events = (await pool.query(
      `SELECT * FROM ent_social_events WHERE tenant_id=$1 AND event_date >= $2 AND event_date <= $3 ORDER BY event_date, event_time`,
      [tid, firstDay.toISOString().slice(0, 10), lastDay.toISOString().slice(0, 10)]
    )).rows;
    const eventDates = {};
    events.forEach(e => { eventDates[e.event_date] = (eventDates[e.event_date] || []).concat(e); });

    // Build calendar grid
    let calCells = '';
    ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].forEach(d => {
      calCells += `<div class="sc-cal-hdr">${d}</div>`;
    });
    for (let i = 0; i < startPad; i++) calCells += '<div class="sc-cal-day"></div>';
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const isToday = today.getFullYear() === year && today.getMonth() + 1 === month && today.getDate() === d;
      const hasEvent = eventDates[dateStr];
      calCells += `<div class="sc-cal-day ${isToday ? 'today' : ''} ${hasEvent ? 'has-event' : ''}">
        <div>${d}</div>
        ${hasEvent ? `<div style="font-size:9px;margin-top:2px">${hasEvent.length} event${hasEvent.length > 1 ? 's' : ''}</div>` : ''}
      </div>`;
    }

    const upcoming = (await pool.query(
      `SELECT * FROM ent_social_events WHERE tenant_id=$1 AND event_date >= CURRENT_DATE ORDER BY event_date, event_time LIMIT 10`, [tid]
    )).rows;

    const upcomingHtml = upcoming.map(e => `
      <div class="sc-card"><div class="sc-card-body" style="display:flex;gap:14px;align-items:start">
        <div style="background:linear-gradient(135deg,#3b82f6,#8b5cf6);border-radius:10px;padding:10px 14px;text-align:center;color:#fff;flex-shrink:0">
          <div style="font-size:11px;font-weight:600;text-transform:uppercase">${e.event_date ? new Date(e.event_date + 'T00:00:00').toLocaleString('en-US', { month: 'short' }) : ''}</div>
          <div style="font-size:22px;font-weight:800;line-height:1">${e.event_date ? e.event_date.split('-')[2] : ''}</div>
        </div>
        <div style="flex:1">
          <div style="font-size:15px;font-weight:700;color:#1e293b">${esc(e.title)}</div>
          <div style="font-size:12px;color:#64748b;margin-top:4px">
            ${e.event_time ? `🕐 ${esc(e.event_time)}` : ''}
            ${e.venue ? ` · 📍 ${esc(e.venue)}` : ''}
            · 👥 ${e.rsvp_count || 0} RSVPs
          </div>
          ${e.description ? `<div style="font-size:13px;color:#475569;margin-top:6px;line-height:1.5">${esc(e.description.substring(0, 120))}${e.description.length > 120 ? '...' : ''}</div>` : ''}
        </div>
      </div></div>`).join('');

    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;

    const html = SC_CSS + `<div style="max-width:800px;margin:0 auto">
      ${scNav('events', email)}
      <div class="sc-hero" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
        <div><h1 style="margin-bottom:2px">📅 Events</h1><p>Community events and activities</p></div>
        <a href="/entertainment/social/events/new" class="sc-btn" style="background:rgba(255,255,255,.2);color:#fff;border-radius:10px">+ Create Event</a>
      </div>
      <div class="sc-card" style="margin-bottom:20px"><div class="sc-card-body">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
          <a href="/entertainment/social/events?month=${prevMonth}&year=${prevYear}" class="sc-btn sc-btn-ghost" style="padding:6px 12px">← Prev</a>
          <h3 style="margin:0;color:#1e293b">${esc(monthName)}</h3>
          <a href="/entertainment/social/events?month=${nextMonth}&year=${nextYear}" class="sc-btn sc-btn-ghost" style="padding:6px 12px">Next →</a>
        </div>
        <div class="sc-cal-grid">${calCells}</div>
      </div></div>
      <h3 style="margin:0 0 12px;color:#1e293b">Upcoming Events</h3>
      ${upcomingHtml || '<div class="sc-card" style="text-align:center;padding:40px"><p style="color:#94a3b8">No upcoming events</p></div>'}
    </div>`;
    res.send(renderPage('Events', html, getUser(req), req));
  }));

  app.get('/entertainment/social/events/new', requireAuth, ah(async (req, res) => {
    const html = SC_CSS + `<div style="max-width:500px;margin:0 auto">
      ${scNav('events', EMAIL(req))}
      <a href="/entertainment/social/events" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Events</a>
      <div class="sc-card"><div class="sc-card-body">
        <h2 style="margin:0 0 16px;color:#1e293b">📅 Create Event</h2>
        <form method="POST" action="/entertainment/social/events/new" class="sc-form" style="display:flex;flex-direction:column;gap:14px">
          <div><label>Title</label><input type="text" name="title" required placeholder="Event title..." maxlength="500"></div>
          <div><label>Description</label><textarea name="description" rows="3" placeholder="Event details..."></textarea></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div><label>Date</label><input type="date" name="event_date" required></div>
            <div><label>Time</label><input type="time" name="event_time"></div>
          </div>
          <div><label>Venue</label><input type="text" name="venue" placeholder="Event location..."></div>
          <div><label>Image URL</label><input type="url" name="image_url" placeholder="https://..."></div>
          <button type="submit" class="sc-btn sc-btn-primary">Create Event</button>
        </form>
      </div></div>
    </div>`;
    res.send(renderPage('Create Event', html, getUser(req), req));
  }));

  app.post('/entertainment/social/events/new', requireAuth, ah(async (req, res) => {
    const tid = TID(req), email = EMAIL(req);
    const { title, description, event_date, event_time, venue, image_url } = req.body;
    if (!title || !title.trim() || !event_date) return res.redirect('/entertainment/social/events/new');
    await pool.query(
      `INSERT INTO ent_social_events (tenant_id, title, description, event_date, event_time, venue, image_url, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [tid, title.trim(), (description || '').trim(), event_date, event_time || null, (venue || '').trim(), (image_url || '').trim() || null, email]
    );
    res.redirect('/entertainment/social/events');
  }));

  // ============================================================
  // FEATURE 10: GALLERY
  // ============================================================
  app.get('/entertainment/social/gallery', requireAuth, ah(async (req, res) => {
    const tid = TID(req), email = EMAIL(req);
    const catFilter = req.query.category || '';
    let where = ['p.tenant_id=$1', 'p.image_url IS NOT NULL', "p.image_url != ''"], params = [tid], pi = 2;
    if (catFilter) { where.push(`p.category=$${pi++}`); params.push(catFilter); }

    const posts = (await pool.query(
      `SELECT p.* FROM ent_social_posts p WHERE ${where.join(' AND ')} ORDER BY p.created_at DESC LIMIT 60`, params
    )).rows;

    const categories = ['General','Review','Meme','Question','Update','Fan Art','Discussion'];
    const catFilterHtml = categories.map(c =>
      `<a href="/entertainment/social/gallery?category=${c}" class="sc-btn ${catFilter === c ? 'sc-btn-primary' : 'sc-btn-ghost'}" style="padding:5px 12px;font-size:12px;border-radius:20px">${c}</a>`
    ).join('');

    const galleryHtml = posts.map(p => `
      <div class="sc-gallery-item" onclick="openLightbox('${esc(p.image_url)}')">
        <img src="${esc(p.image_url)}" alt="Gallery image" loading="lazy" onerror="this.parentElement.style.display='none'">
        <div class="sc-gallery-overlay">
          <div style="color:#fff;font-size:13px">
            <div style="font-weight:700">${esc((p.content || '').substring(0, 40))}${p.content && p.content.length > 40 ? '...' : ''}</div>
            <div>❤️ ${p.likes || 0} · by ${esc(p.author_email.split('@')[0])}</div>
          </div>
        </div>
      </div>`).join('');

    const html = SC_CSS + `<div style="max-width:900px;margin:0 auto">
      ${scNav('gallery', email)}
      <div class="sc-hero"><h1>🖼 Gallery</h1><p>Visual content from the community</p></div>
      <div style="display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap">${catFilterHtml}</div>
      <div class="sc-gallery">
        ${galleryHtml || '<p style="color:#94a3b8;text-align:center;padding:48px;column-span:all">No images in the gallery yet</p>'}
      </div>
    </div>
    <div id="sc-lightbox" class="sc-lightbox" style="display:none" onclick="this.style.display='none'">
      <img id="sc-lightbox-img" src="" alt="Full size">
      <div style="position:absolute;top:16px;right:20px;color:#fff;font-size:28px;cursor:pointer">✕</div>
    </div>
    <script>
    function openLightbox(url){document.getElementById('sc-lightbox-img').src=url;document.getElementById('sc-lightbox').style.display='flex'}
    document.addEventListener('keydown',function(e){if(e.key==='Escape')document.getElementById('sc-lightbox').style.display='none'});
    </script>`;
    res.send(renderPage('Gallery', html, getUser(req), req));
  }));

  // ============================================================
  // FEATURE 11: DIRECT MESSAGING
  // ============================================================
  app.get('/entertainment/social/messages', requireAuth, ah(async (req, res) => {
    const tid = TID(req), email = EMAIL(req);
    const conversations = (await pool.query(
      `SELECT DISTINCT ON (other_email) other_email,
        (SELECT content FROM ent_social_messages m2 WHERE m2.tenant_id=$1 AND ((m2.sender_email=$2 AND m2.receiver_email=m.other_email) OR (m2.sender_email=m.other_email AND m2.receiver_email=$2)) ORDER BY m2.created_at DESC LIMIT 1) as last_message,
        (SELECT m2.created_at FROM ent_social_messages m2 WHERE m2.tenant_id=$1 AND ((m2.sender_email=$2 AND m2.receiver_email=m.other_email) OR (m2.sender_email=m.other_email AND m2.receiver_email=$2)) ORDER BY m2.created_at DESC LIMIT 1) as last_time,
        (SELECT COUNT(*)::int FROM ent_social_messages WHERE tenant_id=$1 AND sender_email=m.other_email AND receiver_email=$2 AND is_read=false) as unread
       FROM (SELECT CASE WHEN sender_email=$2 THEN receiver_email ELSE sender_email END as other_email FROM ent_social_messages WHERE tenant_id=$1 AND (sender_email=$2 OR receiver_email=$2)) m
       ORDER BY last_time DESC NULLS LAST LIMIT 50`, [tid, email]
    )).rows;

    const convHtml = conversations.map(c => `
      <a href="/entertainment/social/messages/${encodeURIComponent(c.other_email)}" style="text-decoration:none;color:inherit;display:flex;align-items:center;gap:12px;padding:14px 18px;border-bottom:1px solid #f1f5f9;transition:.1s;cursor:pointer" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='transparent'">
        ${avatarHtml(c.other_email, 42)}
        <div style="flex:1;min-width:0">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span style="font-size:14px;font-weight:700;color:#1e293b">${esc(c.other_email.split('@')[0])}</span>
            <span style="font-size:11px;color:#94a3b8">${c.last_time ? timeAgo(c.last_time) : ''}</span>
          </div>
          <div style="font-size:13px;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px">${esc((c.last_message || '').substring(0, 50))}</div>
        </div>
        ${c.unread > 0 ? `<span style="background:#ef4444;color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px">${c.unread}</span>` : ''}
      </a>`).join('');

    const html = SC_CSS + `<div style="max-width:700px;margin:0 auto">
      ${scNav('messages', email)}
      <div class="sc-hero"><h1>✉️ Messages</h1><p>Direct messages with community members</p></div>
      <div class="sc-card" style="overflow:hidden">
        ${convHtml || '<div style="text-align:center;padding:48px;color:#94a3b8"><p style="font-size:16px">No conversations yet</p><p style="font-size:13px;margin-top:4px">Visit a profile and start chatting</p></div>'}
      </div>
    </div>`;
    res.send(renderPage('Messages', html, getUser(req), req));
  }));

  app.get('/entertainment/social/messages/:email', requireAuth, ah(async (req, res) => {
    const tid = TID(req), myEmail = EMAIL(req), otherEmail = decodeURIComponent(req.params.email);
    // Mark as read
    await pool.query(`UPDATE ent_social_messages SET is_read=true WHERE tenant_id=$1 AND sender_email=$2 AND receiver_email=$3 AND is_read=false`, [tid, otherEmail, myEmail]);

    const messages = (await pool.query(
      `SELECT * FROM ent_social_messages WHERE tenant_id=$1 AND ((sender_email=$2 AND receiver_email=$3) OR (sender_email=$3 AND receiver_email=$2)) ORDER BY created_at ASC LIMIT 100`,
      [tid, myEmail, otherEmail]
    )).rows;

    const msgHtml = messages.map(m => {
      const isSent = m.sender_email === myEmail;
      return `<div class="sc-msg-row ${isSent ? 'sent' : 'received'}">
        <div class="sc-msg-bubble">
          <div>${esc(m.content)}</div>
          <div style="font-size:10px;${isSent ? 'color:rgba(255,255,255,.7)' : 'color:#94a3b8'};margin-top:4px;text-align:${isSent ? 'right' : 'left'}">${timeAgo(m.created_at)}</div>
        </div>
      </div>`;
    }).join('');

    const html = SC_CSS + `<div style="max-width:700px;margin:0 auto">
      ${scNav('messages', myEmail)}
      <a href="/entertainment/social/messages" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:12px">← Back to Messages</a>
      <div class="sc-card" style="overflow:hidden">
        <div style="padding:14px 18px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;gap:12px">
          ${avatarHtml(otherEmail, 38)}
          <div>
            <div style="font-size:15px;font-weight:700;color:#1e293b">${esc(otherEmail.split('@')[0])}</div>
            <div style="font-size:12px;color:#94a3b8">${esc(otherEmail)}</div>
          </div>
        </div>
        <div style="max-height:500px;overflow-y:auto;padding:18px;display:flex;flex-direction:column;gap:4px;background:#fafafa" id="msg-area">
          ${msgHtml || '<div style="text-align:center;padding:40px;color:#94a3b8;font-size:14px">No messages yet. Say hello!</div>'}
        </div>
        <form method="POST" action="/entertainment/social/messages/${encodeURIComponent(otherEmail)}/send" style="display:flex;gap:8px;padding:14px 18px;border-top:1px solid #f1f5f9">
          <input type="text" name="content" required placeholder="Type a message..." style="flex:1;padding:10px 14px;border:2px solid #e2e8f0;border-radius:20px;font-size:14px;transition:.15s" onfocus="this.style.borderColor='#8b5cf6'" onblur="this.style.borderColor='#e2e8f0'">
          <button type="submit" class="sc-btn sc-btn-primary" style="border-radius:20px;padding:10px 18px">Send</button>
        </form>
      </div>
    </div>
    <script>var a=document.getElementById('msg-area');if(a)a.scrollTop=a.scrollHeight;</script>`;
    res.send(renderPage('Chat', html, getUser(req), req));
  }));

  app.post('/entertainment/social/messages/:email/send', requireAuth, ah(async (req, res) => {
    const tid = TID(req), email = EMAIL(req), otherEmail = decodeURIComponent(req.params.email);
    const { content } = req.body;
    if (!content || !content.trim()) return res.redirect('/entertainment/social/messages/' + encodeURIComponent(otherEmail));
    await pool.query(
      `INSERT INTO ent_social_messages (tenant_id, sender_email, receiver_email, content) VALUES ($1,$2,$3,$4)`,
      [tid, email, otherEmail, content.trim()]
    );
    res.redirect('/entertainment/social/messages/' + encodeURIComponent(otherEmail));
  }));

  // ============================================================
  // FEATURE 12: NOTIFICATIONS
  // ============================================================
  app.get('/entertainment/social/notifications', requireAuth, ah(async (req, res) => {
    const tid = TID(req), email = EMAIL(req);
    const notifications = (await pool.query(
      `SELECT * FROM ent_social_notifications WHERE tenant_id=$1 AND user_email=$2 ORDER BY is_read ASC, created_at DESC LIMIT 50`, [tid, email]
    )).rows;
    const unreadCount = notifications.filter(n => !n.is_read).length;

    const iconMap = { like: '❤️', comment: '💬', follow: '👤', mention: '📢', share: '🔄' };
    const typeLabels = { like: 'liked your post', comment: 'commented on your post', follow: 'started following you', mention: 'mentioned you', share: 'shared your post' };

    const notifHtml = notifications.map(n => `
      <div class="sc-notif ${n.is_read ? '' : 'unread'}">
        ${avatarHtml(n.actor_email || '', 40)}
        <div style="flex:1;min-width:0">
          <div style="font-size:14px;color:#1e293b">
            <strong>${esc((n.actor_email || '').split('@')[0])}</strong>
            <span style="color:#64748b"> ${esc(typeLabels[n.type] || n.type || '')}</span>
            ${n.reference_id && n.type !== 'follow' ? `<a href="/entertainment/social/post/${n.reference_id}/comments" style="color:#3b82f6;font-size:13px;text-decoration:none;margin-left:4px">View</a>` : ''}
          </div>
          <div style="font-size:12px;color:#94a3b8;margin-top:3px">${timeAgo(n.created_at)}</div>
        </div>
        ${!n.is_read ? `<a href="/entertainment/social/notifications/read/${n.id}" style="font-size:11px;color:#3b82f6;text-decoration:none;flex-shrink:0">Mark read</a>` : ''}
      </div>`).join('');

    const html = SC_CSS + `<div style="max-width:640px;margin:0 auto">
      ${scNav('notifications', email)}
      <div class="sc-hero" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
        <div><h1 style="margin-bottom:2px">🔔 Notifications</h1><p>${unreadCount > 0 ? `You have <strong>${unreadCount}</strong> unread notifications` : 'All caught up!'}</p></div>
        ${unreadCount > 0 ? `<a href="/entertainment/social/notifications/read-all" class="sc-btn" style="background:rgba(255,255,255,.2);color:#fff;border-radius:10px">Mark all read</a>` : ''}
      </div>
      <div class="sc-card" style="overflow:hidden">
        ${notifHtml || '<div style="text-align:center;padding:48px;color:#94a3b8"><p style="font-size:16px">No notifications</p></div>'}
      </div>
    </div>`;
    res.send(renderPage('Notifications', html, getUser(req), req));
  }));

  app.get('/entertainment/social/notifications/read/:id', requireAuth, ah(async (req, res) => {
    const tid = TID(req), notifId = req.params.id;
    await pool.query(`UPDATE ent_social_notifications SET is_read=true WHERE id=$1 AND tenant_id=$2`, [notifId, tid]);
    res.redirect('/entertainment/social/notifications');
  }));

  app.get('/entertainment/social/notifications/read-all', requireAuth, ah(async (req, res) => {
    const tid = TID(req), email = EMAIL(req);
    await pool.query(`UPDATE ent_social_notifications SET is_read=true WHERE tenant_id=$1 AND user_email=$2 AND is_read=false`, [tid, email]);
    res.redirect('/entertainment/social/notifications');
  }));

  logger.info('[EntSocial] Entertainment Social module loaded');
};
