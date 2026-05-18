// ============================================================
// FORUM MODULE — Multi-Tenant SaaS Platform "Comfort Zone"
// Discussion forums with topics, replies, categories, pinned
// posts, likes, search, activity stats, and moderation tools.
// ============================================================
'use strict';

module.exports = function forum(app, db, pool, renderPage, esc) {
  const requireAuth = (req, res, next) => {
    if (!req.session?.user) return res.redirect('/login');
    next();
  };
  const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  if (!esc) esc = (s) => String(s == null ? '' : (typeof s === 'object' ? JSON.stringify(s) : s))
    .replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const today = () => new Date().toISOString().slice(0, 10);
  const genToken = () => require('crypto').randomBytes(24).toString('hex');

  // -- helpers ---------------------------------------------------------
  function statusBadge(status) {
    const map = {
      open: { bg: '#dcfce7', c: '#16a34a', l: 'Open' },
      locked: { bg: '#fee2e2', c: '#dc2626', l: 'Locked' },
      archived: { bg: '#f1f5f9', c: '#64748b', l: 'Archived' }
    };
    const s = map[status] || map.open;
    return `<span class="badge" style="background:${s.bg};color:${s.c}">${s.l}</span>`;
  }
  function pinBadge(isPinned) {
    return isPinned ? '<span class="badge" style="background:#fef3c7;color:#b45309">📌 Pinned</span>' : '';
  }
  function timeAgo(d) {
    if (!d) return '';
    const diff = Date.now() - new Date(d).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    const days = Math.floor(hrs / 24);
    if (days < 7) return days + 'd ago';
    return fmtDate(d);
  }
  function truncate(str, len) {
    if (!str) return '';
    return str.length > len ? str.substring(0, len) + '...' : str;
  }

  // -- shared CSS -------------------------------------------------------
  const FM_CSS = `<style>
    .fm-nav{display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap;align-items:center}
    .fm-nav a{padding:8px 16px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#475569;background:#f1f5f9;transition:.15s}
    .fm-nav a:hover{background:#e2e8f0}.fm-nav a.active{background:#4f46e5;color:#fff}
    .fm-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:14px;margin-bottom:20px}
    .fm-stat{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:16px;text-align:center;transition:.15s}
    .fm-stat:hover{box-shadow:0 2px 12px rgba(0,0,0,.05)}
    .fm-stat-val{font-size:28px;font-weight:800;color:#1e293b}.fm-stat-lbl{font-size:11px;color:#94a3b8;margin-top:4px;text-transform:uppercase;letter-spacing:.3px}
    .fm-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px}
    .fm-cat-card{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:20px;transition:.2s;cursor:pointer;position:relative;overflow:hidden}
    .fm-cat-card:hover{box-shadow:0 4px 16px rgba(0,0,0,.07);transform:translateY(-2px)}
    .fm-cat-icon{font-size:28px;margin-bottom:10px}.fm-cat-name{font-size:16px;font-weight:700;color:#1e293b;margin-bottom:4px}
    .fm-cat-desc{font-size:12px;color:#94a3b8;line-height:1.5;margin-bottom:12px}
    .fm-cat-meta{display:flex;gap:14px;font-size:11px;color:#64748b}
    .fm-cat-color{position:absolute;top:0;left:0;width:4px;height:100%}
    .fm-filter{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:end}
    .fm-filter label{display:block;font-size:12px;font-weight:600;color:#64748b;margin-bottom:4px}
    .fm-filter input,.fm-filter select{padding:8px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px;background:#fff}
    .fm-filter input:focus,.fm-filter select:focus{outline:none;border-color:#4f46e5}
    .fm-table{width:100%;border-collapse:collapse;font-size:13px}
    .fm-table th{padding:10px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#f8fafc}
    .fm-table td{padding:10px 14px;border-bottom:1px solid #f1f5f9;color:#1e293b}.fm-table tr:hover{background:#f8fafc}
    .fm-table .pinned-row{background:#fffbeb}
    .fm-form label{display:block;font-size:13px;font-weight:600;color:#475569;margin-bottom:4px}
    .fm-form input,.fm-form select,.fm-form textarea{width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;box-sizing:border-box}
    .fm-form input:focus,.fm-form select:focus,.fm-form textarea:focus{outline:none;border-color:#4f46e5}
    .fm-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
    .fm-reply{padding:16px;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:12px;background:#fff}
    .fm-reply-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
    .fm-reply-author{font-size:14px;font-weight:700;color:#1e293b}
    .fm-reply-body{font-size:14px;color:#334155;line-height:1.7;white-space:pre-wrap}
    .fm-reply-actions{display:flex;gap:8px;margin-top:8px;align-items:center}
    .fm-like-btn{display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border:1px solid #e2e8f0;border-radius:20px;font-size:12px;color:#64748b;background:#fff;cursor:pointer;transition:.15s;text-decoration:none}
    .fm-like-btn:hover{background:#fef3c7;color:#b45309;border-color:#fbbf24}
    .fm-like-btn.liked{background:#fef3c7;color:#b45309;border-color:#fbbf24}
    .fm-topic-detail{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:24px;margin-bottom:16px}
    .fm-topic-body{font-size:15px;color:#334155;line-height:1.8;white-space:pre-wrap}
    .fm-bar{display:flex;height:8px;border-radius:4px;overflow:hidden;background:#f1f5f9;margin-top:6px}
    .fm-bar-seg{height:100%;transition:width .3s}
    @media(max-width:768px){.fm-grid{grid-template-columns:1fr}.fm-form-grid{grid-template-columns:1fr}.fm-stats{grid-template-columns:1fr 1fr}}
  </style>`;

  // -- navigation helper ------------------------------------------------
  const fmNav = (active) => `<div class="fm-nav">
    <a href="/forum" class="${active === 'dashboard' ? 'active' : ''}">🏠 Dashboard</a>
    <a href="/forum/topics" class="${active === 'topics' ? 'active' : ''}">📋 Topics</a>
    <a href="/forum/topics/new" class="${active === 'new' ? 'active' : ''}">➕ New Topic</a>
    <a href="/forum/my" class="${active === 'my' ? 'active' : ''}">👤 My Posts</a>
  </div>`;

  // ============================================================
  // DATABASE MIGRATIONS (async IIFE)
  // ============================================================
  (async () => {
    const c = await pool.connect().catch(() => null);
    if (!c) { console.error('[Forum] Cannot connect to DB for migrations'); return; }
    try {
      await c.query(`CREATE TABLE IF NOT EXISTS forum_categories (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name VARCHAR(255), description TEXT, icon VARCHAR(50),
        color VARCHAR(20) DEFAULT '#4f46e5', sort_order INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await c.query(`CREATE TABLE IF NOT EXISTS forum_likes (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id INTEGER, target_type VARCHAR(20) DEFAULT 'topic',
        target_id INTEGER, created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await c.query(`CREATE TABLE IF NOT EXISTS forum_topics (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        title VARCHAR(255), content TEXT, category_id INTEGER,
        author_id INTEGER, author_name VARCHAR(255),
        view_count INTEGER DEFAULT 0, reply_count INTEGER DEFAULT 0,
        is_pinned BOOLEAN DEFAULT false, is_locked BOOLEAN DEFAULT false,
        status VARCHAR(20) DEFAULT 'open', last_reply_at TIMESTAMPTZ,
        last_reply_by VARCHAR(255), created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await c.query(`CREATE TABLE IF NOT EXISTS forum_replies (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        topic_id INTEGER NOT NULL, author_id INTEGER, author_name VARCHAR(255),
        content TEXT, like_count INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      // ALTER TABLE columns
      const topicCols = [
        ['title', 'VARCHAR(255)'], ['content', 'TEXT'], ['category_id', 'INTEGER'],
        ['author_id', 'INTEGER'], ['author_name', 'VARCHAR(255)'],
        ['view_count', 'INTEGER DEFAULT 0'], ['reply_count', 'INTEGER DEFAULT 0'],
        ['is_pinned', 'BOOLEAN DEFAULT false'], ['is_locked', 'BOOLEAN DEFAULT false'],
        ['status', "VARCHAR(20) DEFAULT 'open'"], ['last_reply_at', 'TIMESTAMPTZ'],
        ['last_reply_by', 'VARCHAR(255)'], ['created_at', 'TIMESTAMPTZ DEFAULT NOW()'], ['updated_at', 'TIMESTAMPTZ DEFAULT NOW()']
      ];
      for (const [col, def] of topicCols) { try { await c.query(`ALTER TABLE forum_topics ADD COLUMN IF NOT EXISTS ${col} ${def}`); } catch (e) {} }
      const replyCols = [
        ['topic_id', 'INTEGER NOT NULL DEFAULT 0'], ['author_id', 'INTEGER'],
        ['author_name', 'VARCHAR(255)'], ['content', 'TEXT'],
        ['like_count', 'INTEGER DEFAULT 0'], ['created_at', 'TIMESTAMPTZ DEFAULT NOW()']
      ];
      for (const [col, def] of replyCols) { try { await c.query(`ALTER TABLE forum_replies ADD COLUMN IF NOT EXISTS ${col} ${def}`); } catch (e) {} }
      // Indexes
      await c.query(`CREATE INDEX IF NOT EXISTS idx_ft_tenant ON forum_topics(tenant_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_ft_category ON forum_topics(tenant_id, category_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_ft_status ON forum_topics(tenant_id, status)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_ft_pinned ON forum_topics(tenant_id, is_pinned DESC)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_fr_topic ON forum_replies(topic_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_fr_tenant ON forum_replies(tenant_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_fc_tenant ON forum_categories(tenant_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_fl_target ON forum_likes(tenant_id, target_type, target_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_fl_user ON forum_likes(user_id, target_type, target_id)`);
      console.log('[Forum] Migrations applied');
    } catch (e) { console.error('[Forum] Migration error:', e.message); }
    finally { c.release(); }
  })();

  // ============================================================
  // ROUTE 1: GET /forum — Forum Dashboard
  // ============================================================
  app.get('/forum', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const totalTopics = (await pool.query(`SELECT COUNT(*)::int as cnt FROM forum_topics WHERE tenant_id=$1`, [tid])).rows[0].cnt;
    const totalReplies = (await pool.query(`SELECT COUNT(*)::int as cnt FROM forum_replies WHERE tenant_id=$1`, [tid])).rows[0].cnt;
    const totalLikes = (await pool.query(`SELECT COUNT(*)::int as cnt FROM forum_likes WHERE tenant_id=$1`, [tid])).rows[0].cnt;
    const activeToday = (await pool.query(`SELECT COUNT(*)::int as cnt FROM forum_topics WHERE tenant_id=$1 AND created_at >= CURRENT_DATE`, [tid])).rows[0].cnt;
    const categories = (await pool.query(`SELECT fc.*, COUNT(ft.id)::int as topic_count, COALESCE(SUM(ft.reply_count),0)::int as reply_count FROM forum_categories fc LEFT JOIN forum_topics ft ON ft.category_id = fc.id AND ft.tenant_id = fc.tenant_id WHERE fc.tenant_id=$1 AND fc.is_active=true GROUP BY fc.id ORDER BY fc.sort_order, fc.name`, [tid])).rows;
    const recentTopics = (await pool.query(`SELECT ft.*, fc.name as cat_name, fc.color as cat_color FROM forum_topics ft LEFT JOIN forum_categories fc ON fc.id = ft.category_id WHERE ft.tenant_id=$1 ORDER BY ft.is_pinned DESC, ft.last_reply_at DESC NULLS LAST, ft.created_at DESC LIMIT 10`, [tid])).rows;
    const topContributors = (await pool.query(`SELECT author_name, COUNT(*)::int as posts FROM forum_topics WHERE tenant_id=$1 AND author_name IS NOT NULL GROUP BY author_name ORDER BY posts DESC LIMIT 5`, [tid])).rows;

    const catCards = categories.map(cat => {
      const icon = cat.icon || '📁';
      return `<div class="fm-cat-card" onclick="location.href='/forum/topics?category=${esc(cat.id)}'">
        <div class="fm-cat-color" style="background:${esc(cat.color)}"></div>
        <div class="fm-cat-icon">${icon}</div>
        <div class="fm-cat-name">${esc(cat.name || 'Uncategorized')}</div>
        <div class="fm-cat-desc">${esc(cat.description || 'No description')}</div>
        <div class="fm-cat-meta">
          <span>📋 ${cat.topic_count} topics</span>
          <span>💬 ${cat.reply_count} replies</span>
        </div>
      </div>`;
    }).join('');

    const recentRows = recentTopics.map(t => `<tr class="${t.is_pinned ? 'pinned-row' : ''}">
      <td>${pinBadge(t.is_pinned)} <a href="/forum/topic/${esc(t.id)}" style="color:#4f46e5;text-decoration:none;font-weight:600">${esc(truncate(t.title, 45))}</a></td>
      <td><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${t.cat_color || '#94a3b8'};margin-right:6px"></span><span style="font-size:12px">${esc(t.cat_name || 'General')}</span></td>
      <td style="font-size:12px">${esc(t.author_name || 'Anonymous')}</td>
      <td style="font-size:12px;text-align:center">${t.reply_count}</td>
      <td style="font-size:12px;color:#94a3b8">${timeAgo(t.last_reply_at || t.created_at)}</td>
    </tr>`).join('');

    const contributorHtml = topContributors.map((c, i) => `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;${i < topContributors.length - 1 ? 'border-bottom:1px solid #f1f5f9' : ''}">
      <div style="width:28px;height:28px;border-radius:50%;background:#e0e7ff;color:#4f46e5;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800">${i + 1}</div>
      <div style="flex:1"><span style="font-size:13px;font-weight:600;color:#1e293b">${esc(c.author_name)}</span></div>
      <span style="font-size:12px;color:#64748b">${c.posts} posts</span>
    </div>`).join('');

    const html = FM_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${fmNav('dashboard')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">🏠 Forum</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Community discussions and knowledge sharing</p></div>
        <a href="/forum/topics/new" class="btn btn-green">➕ New Topic</a>
      </div>
      <div class="fm-stats">
        <div class="fm-stat"><div class="fm-stat-val">${totalTopics}</div><div class="fm-stat-lbl">Total Topics</div></div>
        <div class="fm-stat"><div class="fm-stat-val" style="color:#f59e0b">${totalReplies}</div><div class="fm-stat-lbl">Total Replies</div></div>
        <div class="fm-stat"><div class="fm-stat-val" style="color:#ef4444">${totalLikes}</div><div class="fm-stat-lbl">Total Likes</div></div>
        <div class="fm-stat"><div class="fm-stat-val" style="color:#22c55e">${activeToday}</div><div class="fm-stat-lbl">New Today</div></div>
      </div>
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:20px">
        <div>
          <h2 style="font-size:18px;color:#1e293b;margin-bottom:14px">📂 Categories</h2>
          <div class="fm-grid">${catCards || '<div class="card" style="text-align:center;padding:40px;grid-column:1/-1"><p style="color:#94a3b8">No categories yet</p></div>'}</div>
          <h2 style="font-size:18px;color:#1e293b;margin:24px 0 14px">🕐 Recent Activity</h2>
          <div class="card"><div style="overflow-x:auto"><table class="fm-table">
            <thead><tr><th>Topic</th><th>Category</th><th>Author</th><th style="text-align:center">Replies</th><th>Last Activity</th></tr></thead>
            <tbody>${recentRows || '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:24px">No topics yet</td></tr>'}</tbody>
          </table></div></div>
        </div>
        <div>
          <h2 style="font-size:18px;color:#1e293b;margin-bottom:14px">🏆 Top Contributors</h2>
          <div class="card" style="padding:16px">${contributorHtml || '<p class="muted" style="text-align:center;padding:16px">No activity yet</p>'}</div>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Forum', html, user, req));
  }));

  // ============================================================
  // ROUTE 2: GET /forum/topics — Topic List
  // ============================================================
  app.get('/forum/topics', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 20, offset = (page - 1) * limit;
    const search = (req.query.search || '').trim();
    const category = req.query.category || '';
    const sort = req.query.sort || 'recent';

    let where = ['ft.tenant_id=$1'], params = [tid], pi = 2;
    if (category) { where.push(`ft.category_id=$${pi++}`); params.push(category); }
    if (search) { where.push(`(ft.title ILIKE $${pi} OR ft.content ILIKE $${pi})`); params.push(`%${search}%`); pi++; }

    const orderBy = sort === 'popular' ? 'ft.reply_count DESC, ft.view_count DESC' : 'ft.is_pinned DESC, ft.last_reply_at DESC NULLS LAST, ft.created_at DESC';
    const total = (await pool.query(`SELECT COUNT(*)::int as cnt FROM forum_topics ft WHERE ${where.join(' AND ')}`, params)).rows[0].cnt;
    const totalPages = Math.ceil(total / limit);
    const categories = (await pool.query(`SELECT * FROM forum_categories WHERE tenant_id=$1 AND is_active=true ORDER BY sort_order, name`, [tid])).rows;
    const topics = (await pool.query(
      `SELECT ft.*, fc.name as cat_name, fc.color as cat_color,
        (SELECT COUNT(*)::int FROM forum_likes WHERE target_type='topic' AND target_id=ft.id) as like_count
       FROM forum_topics ft LEFT JOIN forum_categories fc ON fc.id = ft.category_id
       WHERE ${where.join(' AND ')} ORDER BY ${orderBy} LIMIT $${pi} OFFSET $${pi + 1}`,
      [...params, limit, offset]
    )).rows;

    const rows = topics.map(t => `<tr class="${t.is_pinned ? 'pinned-row' : ''}">
      <td style="width:32px;text-align:center">${t.is_locked ? '🔒' : '💬'}</td>
      <td>
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          ${pinBadge(t.is_pinned)} ${statusBadge(t.status)}
        </div>
        <a href="/forum/topic/${esc(t.id)}" style="color:#4f46e5;text-decoration:none;font-weight:600;font-size:14px;display:block;margin-top:4px">${esc(t.title)}</a>
        <div style="font-size:11px;color:#94a3b8;margin-top:2px">by ${esc(t.author_name || 'Anonymous')} · ${fmtDate(t.created_at)}</div>
      </td>
      <td><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${t.cat_color || '#94a3b8'};margin-right:6px"></span><span style="font-size:12px">${esc(t.cat_name || 'General')}</span></td>
      <td style="text-align:center;font-size:13px;font-weight:600">${t.reply_count}</td>
      <td style="text-align:center;font-size:13px">${t.like_count}</td>
      <td style="text-align:center;font-size:12px;color:#64748b">${t.view_count}</td>
      <td style="font-size:12px;color:#94a3b8;white-space:nowrap">${esc(t.last_reply_by || '—')}<br>${timeAgo(t.last_reply_at || t.created_at)}</td>
    </tr>`).join('');

    const html = FM_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${fmNav('topics')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <h1 style="font-size:22px;color:#1e293b">📋 All Topics</h1>
        <a href="/forum/topics/new" class="btn btn-green">➕ New Topic</a>
      </div>
      <div class="fm-filter">
        <div><label>Category</label><select onchange="location.href='/forum/topics?category='+this.value+'&sort=${esc(sort)}'">
          <option value="">All Categories</option>
          ${categories.map(c => `<option value="${c.id}" ${category == c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
        </select></div>
        <div><label>Sort By</label><select onchange="location.href='/forum/topics?sort='+this.value+'&category=${esc(category)}'">
          <option value="recent" ${sort === 'recent' ? 'selected' : ''}>Most Recent</option>
          <option value="popular" ${sort === 'popular' ? 'selected' : ''}>Most Popular</option>
        </select></div>
        <div><label>Search</label><form method="GET" action="/forum/topics" style="display:flex;gap:6px">
          <input type="hidden" name="category" value="${esc(category)}">
          <input type="hidden" name="sort" value="${esc(sort)}">
          <input type="text" name="search" value="${esc(search)}" placeholder="Search topics..." style="width:220px">
          <button type="submit" class="btn btn-blue btn-sm">🔍</button>
        </form></div>
      </div>
      <div class="card"><div style="overflow-x:auto"><table class="fm-table">
        <thead><tr><th></th><th>Topic</th><th>Category</th><th style="text-align:center">Replies</th><th style="text-align:center">Likes</th><th style="text-align:center">Views</th><th>Last Reply</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:30px">No topics found. <a href="/forum/topics/new" style="color:#4f46e5">Create one!</a></td></tr>'}</tbody>
      </table></div></div>
      ${totalPages > 1 ? `<div style="display:flex;justify-content:center;gap:6px;margin-top:20px">
        ${page > 1 ? `<a href="/forum/topics?page=${page - 1}&category=${esc(category)}&sort=${esc(sort)}&search=${esc(search)}" class="btn btn-sm" style="background:#f1f5f9;color:#475569">← Prev</a>` : ''}
        <span style="padding:8px 14px;font-size:13px;color:#64748b">Page ${page} of ${totalPages}</span>
        ${page < totalPages ? `<a href="/forum/topics?page=${page + 1}&category=${esc(category)}&sort=${esc(sort)}&search=${esc(search)}" class="btn btn-blue btn-sm">Next →</a>` : ''}
      </div>` : ''}
    </div>`;
    res.send(renderPage('Forum Topics', html, user, req));
  }));

  // ============================================================
  // ROUTE 3: GET /forum/topics/new — New Topic Form
  // ============================================================
  app.get('/forum/topics/new', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const categories = (await pool.query(`SELECT * FROM forum_categories WHERE tenant_id=$1 AND is_active=true ORDER BY sort_order, name`, [tid])).rows;
    const html = FM_CSS + `<div style="max-width:800px;margin:0 auto">
      ${fmNav('new')}
      <a href="/forum/topics" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Topics</a>
      <div class="card" style="padding:28px">
        <h2 style="margin:0 0 4px;color:#1e293b">➕ Create New Topic</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:24px">Start a new discussion thread</p>
        <form method="POST" action="/forum/topics/new" class="fm-form" style="display:flex;flex-direction:column;gap:16px">
          <div><label>Title *</label><input type="text" name="title" required placeholder="Enter a descriptive topic title..." maxlength="255"></div>
          <div><label>Category</label><select name="category_id">
            <option value="">— Select Category —</option>
            ${categories.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}
          </select></div>
          <div><label>Content *</label><textarea name="content" rows="10" required placeholder="Write your topic content here... Markdown-like formatting is supported."></textarea></div>
          <div style="display:flex;gap:10px;margin-top:8px">
            <button type="submit" class="btn btn-green" style="padding:12px 28px">📤 Post Topic</button>
            <a href="/forum/topics" class="btn btn-sm" style="padding:12px 28px;background:#f1f5f9;color:#475569">Cancel</a>
          </div>
        </form>
      </div>
    </div>`;
    res.send(renderPage('New Topic', html, user, req));
  }));

  // ============================================================
  // ROUTE 4: POST /forum/topics/new — Save Topic
  // ============================================================
  app.post('/forum/topics/new', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { title, content, category_id } = req.body;
    if (!title || !title.trim() || !content || !content.trim()) return res.redirect('/forum/topics/new');
    const result = await pool.query(
      `INSERT INTO forum_topics (tenant_id, title, content, category_id, author_id, author_name, status) VALUES ($1,$2,$3,$4,$5,$6,'open') RETURNING id`,
      [tid, title.trim(), content.trim(), category_id || null, user.id, user.name || user.email]
    );
    res.redirect('/forum/topic/' + result.rows[0].id);
  }));

  // ============================================================
  // ROUTE 5: GET /forum/topic/:id — View Topic
  // ============================================================
  app.get('/forum/topic/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, topicId = req.params.id;
    await pool.query(`UPDATE forum_topics SET view_count = view_count + 1 WHERE id=$1 AND tenant_id=$2`, [topicId, tid]);
    const topic = (await pool.query(
      `SELECT ft.*, fc.name as cat_name, fc.color as cat_color,
        (SELECT COUNT(*)::int FROM forum_likes WHERE target_type='topic' AND target_id=ft.id) as like_count,
        (SELECT COUNT(*)::int FROM forum_likes WHERE target_type='topic' AND target_id=ft.id AND user_id=$2) as user_liked
       FROM forum_topics ft LEFT JOIN forum_categories fc ON fc.id = ft.category_id
       WHERE ft.id=$1 AND ft.tenant_id=$2`, [topicId, tid]
    )).rows[0];
    if (!topic) return res.send(renderPage('Not Found', '<div class="card" style="text-align:center;padding:48px"><h2 style="color:#dc2626">Topic not found</h2><a href="/forum" class="btn btn-sm" style="margin-top:12px">← Back to Forum</a></div>', user, req));

    const replies = (await pool.query(
      `SELECT fr.*, u.name as author_display,
        (SELECT COUNT(*)::int FROM forum_likes WHERE target_type='reply' AND target_id=fr.id) as like_count,
        (SELECT COUNT(*)::int FROM forum_likes WHERE target_type='reply' AND target_id=fr.id AND user_id=$2) as user_liked
       FROM forum_replies fr LEFT JOIN users u ON u.id = fr.author_id
       WHERE fr.topic_id=$1 AND fr.tenant_id=$2 ORDER BY fr.created_at ASC`, [topicId, tid]
    )).rows;

    const repliesHtml = replies.map(r => `<div class="fm-reply">
      <div class="fm-reply-header">
        <span class="fm-reply-author">${esc(r.author_name || r.author_display || 'Anonymous')}</span>
        <span style="font-size:12px;color:#94a3b8">${fmtDateTime(r.created_at)}</span>
      </div>
      <div class="fm-reply-body">${esc(r.content)}</div>
      <div class="fm-reply-actions">
        <a href="/forum/topic/${topicId}/like?target_type=reply&target_id=${r.id}" class="fm-like-btn ${r.user_liked ? 'liked' : ''}" style="text-decoration:none">👍 ${r.like_count}</a>
        ${user.id == r.author_id ? `<form method="POST" action="/forum/reply/${r.id}/delete" onsubmit="return confirm('Delete this reply?')" style="display:inline"><button class="btn btn-red btn-sm" style="padding:4px 10px;font-size:11px">Delete</button></form>` : ''}
      </div>
    </div>`).join('');

    const flash = req.session?.flash; req.session.flash = null;
    const html = FM_CSS + `<div style="max-width:900px;margin:0 auto">
      ${fmNav('')}
      <a href="/forum/topics" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Topics</a>
      ${flash ? `<div style="background:#dcfce7;color:#16a34a;padding:12px 18px;border-radius:10px;margin-bottom:16px;font-size:13px">${esc(flash.msg)}</div>` : ''}
      <div class="fm-topic-detail">
        <div style="display:flex;justify-content:space-between;align-items:start;flex-wrap:wrap;gap:10px;margin-bottom:16px">
          <div>
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:8px">
              ${pinBadge(topic.is_pinned)} ${statusBadge(topic.status)}
              ${topic.is_locked ? '<span class="badge" style="background:#fee2e2;color:#dc2626">🔒 Locked</span>' : ''}
              <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${topic.cat_color || '#94a3b8'};margin-left:6px"></span>
              <span style="font-size:12px;color:#64748b">${esc(topic.cat_name || 'General')}</span>
            </div>
            <h1 style="font-size:22px;color:#1e293b;line-height:1.3;margin:0">${esc(topic.title)}</h1>
          </div>
          <div style="display:flex;gap:6px">
            ${user.id == topic.author_id || user.role === 'admin' ? `
              <form method="POST" action="/forum/topic/${topicId}/pin" style="display:inline"><button class="btn btn-sm" style="background:#fef3c7;color:#b45309">${topic.is_pinned ? '📌 Unpin' : '📌 Pin'}</button></form>
              <form method="POST" action="/forum/topic/${topicId}/lock" style="display:inline"><button class="btn btn-sm" style="background:${topic.is_locked ? '#dcfce7' : '#fee2e2'};color:${topic.is_locked ? '#16a34a' : '#dc2626'}">${topic.is_locked ? '🔓 Unlock' : '🔒 Lock'}</button></form>
            ` : ''}
          </div>
        </div>
        <div style="display:flex;gap:16px;align-items:center;font-size:13px;color:#64748b;padding-bottom:14px;border-bottom:1px solid #e2e8f0;margin-bottom:16px;flex-wrap:wrap">
          <span>✍️ ${esc(topic.author_name || 'Anonymous')}</span>
          <span>📅 ${fmtDateTime(topic.created_at)}</span>
          <span>👁 ${topic.view_count} views</span>
          <span>💬 ${topic.reply_count} replies</span>
          <a href="/forum/topic/${topicId}/like?target_type=topic&target_id=${topicId}" class="fm-like-btn ${topic.user_liked ? 'liked' : ''}" style="text-decoration:none">👍 ${topic.like_count} likes</a>
        </div>
        <div class="fm-topic-body">${esc(topic.content)}</div>
      </div>
      <h3 style="font-size:16px;color:#1e293b;margin:24px 0 16px">💬 Replies (${replies.length})</h3>
      ${repliesHtml || '<div class="card" style="text-align:center;padding:32px"><p style="color:#94a3b8">No replies yet. Be the first to respond!</p></div>'}
      ${!topic.is_locked ? `
      <div class="card" style="padding:24px;margin-top:20px">
        <h3 style="font-size:15px;color:#1e293b;margin:0 0 12px">✍️ Post a Reply</h3>
        <form method="POST" action="/forum/topic/${topicId}/reply" class="fm-form" style="display:flex;flex-direction:column;gap:12px">
          <textarea name="content" rows="5" required placeholder="Write your reply..."></textarea>
          <button type="submit" class="btn btn-green" style="align-self:flex-start;padding:10px 24px">📤 Post Reply</button>
        </form>
      </div>` : '<div class="card" style="text-align:center;padding:24px;margin-top:20px;background:#fffbeb;border:1px solid #fde68a"><p style="color:#92400e;font-size:14px">🔒 This topic is locked. No new replies can be posted.</p></div>'}
    </div>`;
    res.send(renderPage(topic.title, html, user, req));
  }));

  // ============================================================
  // ROUTE 6: POST /forum/topic/:id/reply — Post Reply
  // ============================================================
  app.post('/forum/topic/:id/reply', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, topicId = req.params.id;
    const { content } = req.body;
    if (!content || !content.trim()) return res.redirect('/forum/topic/' + topicId);
    const topic = (await pool.query(`SELECT id, is_locked FROM forum_topics WHERE id=$1 AND tenant_id=$2`, [topicId, tid])).rows[0];
    if (!topic || topic.is_locked) { req.session.flash = { msg: 'This topic is locked.' }; return res.redirect('/forum/topic/' + topicId); }
    await pool.query(
      `INSERT INTO forum_replies (tenant_id, topic_id, author_id, author_name, content) VALUES ($1,$2,$3,$4,$5)`,
      [tid, topicId, user.id, user.name || user.email, content.trim()]
    );
    await pool.query(`UPDATE forum_topics SET reply_count = reply_count + 1, last_reply_at = NOW(), last_reply_by = $3, updated_at = NOW() WHERE id = $1 AND tenant_id = $2`, [topicId, tid, user.name || user.email]);
    res.redirect('/forum/topic/' + topicId);
  }));

  // ============================================================
  // ROUTE 7: GET /forum/topic/:id/like — Like/Unlike
  // ============================================================
  app.get('/forum/topic/:id/like', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, topicId = req.params.id;
    const { target_type, target_id } = req.query;
    const tt = target_type === 'reply' ? 'reply' : 'topic';
    const tidVal = tt === 'reply' ? parseInt(target_id) : parseInt(topicId);
    const existing = (await pool.query(`SELECT id FROM forum_likes WHERE tenant_id=$1 AND user_id=$2 AND target_type=$3 AND target_id=$4`, [tid, user.id, tt, tidVal])).rows[0];
    if (existing) {
      await pool.query(`DELETE FROM forum_likes WHERE id=$1`, [existing.id]);
      if (tt === 'reply') await pool.query(`UPDATE forum_replies SET like_count = GREATEST(0, like_count - 1) WHERE id=$1`, [tidVal]);
    } else {
      await pool.query(`INSERT INTO forum_likes (tenant_id, user_id, target_type, target_id) VALUES ($1,$2,$3,$4)`, [tid, user.id, tt, tidVal]);
      if (tt === 'reply') await pool.query(`UPDATE forum_replies SET like_count = like_count + 1 WHERE id=$1`, [tidVal]);
    }
    res.redirect('/forum/topic/' + topicId);
  }));

  // ============================================================
  // ROUTE 8: POST /forum/topic/:id/pin — Pin/Unpin
  // ============================================================
  app.post('/forum/topic/:id/pin', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, topicId = req.params.id;
    const topic = (await pool.query(`SELECT id, is_pinned FROM forum_topics WHERE id=$1 AND tenant_id=$2`, [topicId, tid])).rows[0];
    if (!topic) return res.redirect('/forum');
    await pool.query(`UPDATE forum_topics SET is_pinned = NOT is_pinned WHERE id=$1 AND tenant_id=$2`, [topicId, tid]);
    res.redirect('/forum/topic/' + topicId);
  }));

  // ============================================================
  // ROUTE 9: POST /forum/topic/:id/lock — Lock/Unlock
  // ============================================================
  app.post('/forum/topic/:id/lock', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, topicId = req.params.id;
    const topic = (await pool.query(`SELECT id, is_locked FROM forum_topics WHERE id=$1 AND tenant_id=$2`, [topicId, tid])).rows[0];
    if (!topic) return res.redirect('/forum');
    await pool.query(`UPDATE forum_topics SET is_locked = NOT is_locked, updated_at = NOW() WHERE id=$1 AND tenant_id=$2`, [topicId, tid]);
    res.redirect('/forum/topic/' + topicId);
  }));

  // ============================================================
  // ROUTE 10: POST /forum/reply/:id/delete — Delete Reply
  // ============================================================
  app.post('/forum/reply/:id/delete', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, replyId = req.params.id;
    const reply = (await pool.query(`SELECT id, topic_id FROM forum_replies WHERE id=$1 AND tenant_id=$2`, [replyId, tid])).rows[0];
    if (!reply) return res.redirect('/forum');
    await pool.query(`DELETE FROM forum_likes WHERE target_type='reply' AND target_id=$1`, [replyId]);
    await pool.query(`DELETE FROM forum_replies WHERE id=$1 AND tenant_id=$2`, [replyId, tid]);
    await pool.query(`UPDATE forum_topics SET reply_count = GREATEST(0, reply_count - 1) WHERE id=$1`, [reply.topic_id]);
    res.redirect('/forum/topic/' + reply.topic_id);
  }));

  // ============================================================
  // ROUTE 11: GET /forum/my — My Topics & Replies
  // ============================================================
  app.get('/forum/my', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const tab = req.query.tab || 'topics';
    const myTopics = (await pool.query(
      `SELECT ft.*, fc.name as cat_name, fc.color as cat_color FROM forum_topics ft LEFT JOIN forum_categories fc ON fc.id = ft.category_id WHERE ft.tenant_id=$1 AND ft.author_id=$2 ORDER BY ft.created_at DESC LIMIT 30`, [tid, user.id]
    )).rows;
    const myReplies = (await pool.query(
      `SELECT fr.*, ft.title as topic_title, ft.id as topic_id FROM forum_replies fr JOIN forum_topics ft ON ft.id = fr.topic_id WHERE fr.tenant_id=$1 AND fr.author_id=$2 ORDER BY fr.created_at DESC LIMIT 30`, [tid, user.id]
    )).rows;

    const topicRows = myTopics.map(t => `<tr>
      <td>${pinBadge(t.is_pinned)} <a href="/forum/topic/${esc(t.id)}" style="color:#4f46e5;text-decoration:none;font-weight:600">${esc(truncate(t.title, 50))}</a></td>
      <td style="font-size:12px">${esc(t.cat_name || 'General')}</td>
      <td style="text-align:center;font-size:13px">${t.reply_count}</td>
      <td style="font-size:12px;color:#94a3b8">${fmtDate(t.created_at)}</td>
    </tr>`).join('');

    const replyRows = myReplies.map(r => `<tr>
      <td><a href="/forum/topic/${esc(r.topic_id)}" style="color:#4f46e5;text-decoration:none;font-weight:600">${esc(truncate(r.topic_title, 40))}</a></td>
      <td style="font-size:13px;color:#334155">${esc(truncate(r.content, 60))}</td>
      <td style="font-size:12px;color:#94a3b8">${fmtDate(r.created_at)}</td>
    </tr>`).join('');

    const html = FM_CSS + `<div style="max-width:1100px;margin:0 auto">
      ${fmNav('my')}
      <h1 style="font-size:22px;color:#1e293b;margin-bottom:16px">👤 My Forum Activity</h1>
      <div style="display:flex;gap:6px;margin-bottom:16px">
        <a href="/forum/my?tab=topics" class="btn btn-sm ${tab === 'topics' ? 'btn-blue' : ''}" style="${tab !== 'topics' ? 'background:#f1f5f9;color:#475569' : ''}">📋 My Topics (${myTopics.length})</a>
        <a href="/forum/my?tab=replies" class="btn btn-sm ${tab === 'replies' ? 'btn-blue' : ''}" style="${tab !== 'replies' ? 'background:#f1f5f9;color:#475569' : ''}">💬 My Replies (${myReplies.length})</a>
      </div>
      <div class="card"><div style="overflow-x:auto">
        ${tab === 'topics' ? `<table class="fm-table">
          <thead><tr><th>Topic</th><th>Category</th><th style="text-align:center">Replies</th><th>Posted</th></tr></thead>
          <tbody>${topicRows || '<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:30px">No topics yet</td></tr>'}</tbody>
        </table>` : `<table class="fm-table">
          <thead><tr><th>In Topic</th><th>Reply</th><th>Date</th></tr></thead>
          <tbody>${replyRows || '<tr><td colspan="3" style="text-align:center;color:#94a3b8;padding:30px">No replies yet</td></tr>'}</tbody>
        </table>`}
      </div></div>
    </div>`;
    res.send(renderPage('My Forum Activity', html, user, req));
  }));

  // ============================================================
  // ROUTE 12: GET /forum/api/topics — JSON API
  // ============================================================
  app.get('/forum/api/topics', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const search = (req.query.search || '').trim();

    let where = ['ft.tenant_id=$1'], params = [tid], pi = 2;
    if (search) { where.push(`(ft.title ILIKE $${pi} OR ft.content ILIKE $${pi})`); params.push(`%${search}%`); pi++; }

    const total = (await pool.query(`SELECT COUNT(*)::int as cnt FROM forum_topics ft WHERE ${where.join(' AND ')}`, params)).rows[0].cnt;
    const topics = (await pool.query(
      `SELECT ft.id, ft.title, ft.category_id, ft.author_name, ft.reply_count, ft.view_count, ft.is_pinned, ft.is_locked, ft.status, ft.created_at, ft.last_reply_at, ft.last_reply_by,
        fc.name as category_name, fc.color as category_color,
        (SELECT COUNT(*)::int FROM forum_likes WHERE target_type='topic' AND target_id=ft.id) as like_count
       FROM forum_topics ft LEFT JOIN forum_categories fc ON fc.id = ft.category_id
       WHERE ${where.join(' AND ')} ORDER BY ft.is_pinned DESC, ft.last_reply_at DESC NULLS LAST, ft.created_at DESC LIMIT $${pi} OFFSET $${pi + 1}`,
      [...params, limit, offset]
    )).rows;

    res.json({ success: true, data: topics, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  }));
};
