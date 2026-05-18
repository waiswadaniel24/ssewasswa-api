// ============================================================
// ENTERTAINMENT ADMIN MODULE — Admin Dashboard, Analytics & Moderation
// Provides: Content management, analytics, moderation, categories,
// notifications, reports, and portal settings for entertainment hub.
// ============================================================
// Usage in server.js:
//   const entAdmin = require('./entertainment-admin');
//   entAdmin(app, pool, { esc, renderPage, requireAuth });
// ============================================================

'use strict';

module.exports = function entertainmentAdmin(app, pool, opts) {
  const esc = opts.esc || ((s) => String(s == null ? '' : (typeof s === 'object' ? JSON.stringify(s) : s))
    .replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])));
  const renderPage = opts.renderPage || ((t, b, u) => b);
  const requireAuth = opts.requireAuth || ((req, res, next) => {
    if (!req.session?.user) return res.redirect('/login');
    next();
  });
  const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  // ── Internal helpers ──
  const fmtNum = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 1 });
  const fmtMoney = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

  // ── Activity logger ──
  const logAction = async (tenantId, actorEmail, action, targetType, targetId, details) => {
    try {
      await pool.query(
        `INSERT INTO ent_admin_activity_log (tenant_id, actor_email, action, target_type, target_id, details)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [tenantId, actorEmail, action, targetType || null, targetId || null, details || null]
      );
    } catch (e) { /* silent */ }
  };

  // ── Bar chart helper (CSS-based) ──
  const barChart = (data, maxVal, color) => {
    const mx = maxVal || Math.max(...data.map(d => Number(d.value || d.cnt || d.total || 0)), 1);
    return data.map(d => {
      const val = Number(d.value || d.cnt || d.total || 0);
      const pct = Math.min(100, Math.round(val / mx * 100));
      const label = d.label || d.name || d.period || d.title || String(d.key || '');
      return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px">
        <span style="font-size:11px;color:#64748b;min-width:100px;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(String(label))}</span>
        <div style="flex:1;background:#f1f5f9;border-radius:6px;height:24px;overflow:hidden;position:relative">
          <div style="height:100%;border-radius:6px;width:${pct}%;background:${color || '#4f46e5'};transition:.3s"></div>
          <span style="position:absolute;right:6px;top:3px;font-size:11px;font-weight:700;color:#1e293b">${d.fmt ? d.fmt(val) : fmtNum(val)}</span>
        </div>
      </div>`;
    }).join('');
  };

  // ── CSS line chart using divs ──
  const lineChart = (data, color) => {
    if (!data.length) return '<p style="color:#94a3b8;font-size:13px;padding:20px">No data</p>';
    const mx = Math.max(...data.map(d => Number(d.value || 0)), 1);
    const h = 120;
    const pts = data.map((d, i) => {
      const x = data.length > 1 ? (i / (data.length - 1)) * 100 : 50;
      const y = h - (Number(d.value || 0) / mx * h);
      return { x, y, label: d.label || '', value: Number(d.value || 0) };
    });
    const pathD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
    return `<div style="position:relative;height:${h + 40}px;width:100%">
      <svg width="100%" height="${h}" viewBox="0 0 100 ${h}" preserveAspectRatio="none" style="position:absolute;top:0;left:0">
        <path d="${pathD}" fill="none" stroke="${color || '#3b82f6'}" stroke-width="2" vector-effect="non-scaling-stroke"/>
        ${pts.map(p => `<circle cx="${p.x}" cy="${p.y}" r="3" fill="${color || '#3b82f6'}" vector-effect="non-scaling-stroke"/>`).join('')}
      </svg>
      <div style="position:absolute;bottom:0;left:0;right:0;display:flex;justify-content:space-between;font-size:10px;color:#94a3b8;padding-top:${h + 4}px">
        ${pts.map(p => `<span style="flex:1;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(String(p.label))}</span>`).join('')}
      </div>
    </div>`;
  };

  // ── Shared admin CSS ──
  const ADMIN_CSS = `<style>
    .ea-nav{display:flex;gap:6px;margin-bottom:20px;flex-wrap:wrap;background:#f8fafc;padding:12px;border-radius:12px;border:1px solid #e2e8f0}
    .ea-nav a{padding:7px 14px;border-radius:8px;font-size:12px;font-weight:600;text-decoration:none;color:#475569;background:#fff;border:1px solid #e2e8f0;transition:.15s}
    .ea-nav a:hover{background:#e2e8f0;border-color:#cbd5e1}
    .ea-nav a.active{background:#4f46e5;color:#fff;border-color:#4f46e5}
    .ea-card{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:20px;margin-bottom:16px}
    .ea-kpi{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:20px;text-align:center;transition:.2s}
    .ea-kpi:hover{box-shadow:0 4px 16px rgba(0,0,0,.06);transform:translateY(-2px)}
    .ea-kpi-val{font-size:28px;font-weight:800;margin:8px 0 4px}
    .ea-kpi-lbl{font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.5px;font-weight:600}
    .ea-table{width:100%;border-collapse:collapse;font-size:13px}
    .ea-table th{padding:10px 12px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#f8fafc}
    .ea-table td{padding:10px 12px;border-bottom:1px solid #f1f5f9;color:#1e293b}
    .ea-table tr:hover{background:#f8fafc}
    .ea-badge{padding:3px 10px;border-radius:6px;font-size:11px;font-weight:600;display:inline-block}
    .ea-btn{display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:.15s}
    .ea-btn:hover{opacity:.9;transform:translateY(-1px)}
    .ea-btn-primary{background:#4f46e5;color:#fff}
    .ea-btn-success{background:#059669;color:#fff}
    .ea-btn-danger{background:#dc2626;color:#fff}
    .ea-btn-warning{background:#f59e0b;color:#fff}
    .ea-btn-secondary{background:#f1f5f9;color:#475569}
    .ea-btn-sm{padding:5px 10px;font-size:11px}
    .ea-filter{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:end}
    .ea-filter label{display:block;font-size:11px;font-weight:600;color:#64748b;margin-bottom:3px}
    .ea-filter input,.ea-filter select,.ea-filter textarea{padding:7px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;background:#fff}
    .ea-filter input:focus,.ea-filter select:focus,.ea-filter textarea:focus{outline:none;border-color:#6366f1}
    @media(max-width:768px){.ea-nav{gap:4px}.ea-nav a{padding:5px 10px;font-size:11px}}
  </style>`;

  // ── Navigation helper ──
  const nav = (active) => `<div class="ea-nav">
    <a href="/entertainment/admin" class="${active === 'dashboard' ? 'active' : ''}">📊 Dashboard</a>
    <a href="/entertainment/admin/content" class="${active === 'content' ? 'active' : ''}">📋 Content</a>
    <a href="/entertainment/admin/analytics/users" class="${active === 'user-analytics' ? 'active' : ''}">👥 Users</a>
    <a href="/entertainment/admin/analytics/content" class="${active === 'content-analytics' ? 'active' : ''}">📈 Content</a>
    <a href="/entertainment/admin/analytics/revenue" class="${active === 'revenue' ? 'active' : ''}">💰 Revenue</a>
    <a href="/entertainment/admin/moderation" class="${active === 'moderation' ? 'active' : ''}">🛡 Moderation</a>
    <a href="/entertainment/admin/categories" class="${active === 'categories' ? 'active' : ''}">🏷 Categories</a>
    <a href="/entertainment/admin/notifications" class="${active === 'notifications' ? 'active' : ''}">🔔 Notifications</a>
    <a href="/entertainment/admin/reports" class="${active === 'reports' ? 'active' : ''}">📄 Reports</a>
    <a href="/entertainment/admin/settings" class="${active === 'settings' ? 'active' : ''}">⚙ Settings</a>
  </div>`;

  // ── Hero header helper ──
  const hero = (icon, title, subtitle) => `<div style="background:linear-gradient(135deg,#1e293b,#334155);padding:28px 32px;border-radius:16px;margin-bottom:20px;color:white">
    <h1 style="font-size:22px;margin:0">${icon} ${esc(title)}</h1>
    <p style="opacity:.8;margin-top:4px;font-size:13px">${esc(subtitle || '')}</p>
  </div>`;

  // ============================================================
  // DATABASE MIGRATIONS
  // ============================================================
  (async () => {
    const c = await pool.connect().catch(() => null);
    if (!c) { console.error('[EntAdmin] Cannot connect to DB for migrations'); return; }
    try {
      await c.query(`CREATE TABLE IF NOT EXISTS ent_admin_activity_log (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        actor_email TEXT NOT NULL,
        action TEXT,
        target_type TEXT,
        target_id INTEGER,
        details TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await c.query(`CREATE TABLE IF NOT EXISTS ent_admin_categories (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        content_type TEXT NOT NULL,
        name TEXT NOT NULL,
        icon TEXT DEFAULT '📁',
        color TEXT DEFAULT '#6366f1',
        description TEXT,
        is_active BOOLEAN DEFAULT true,
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await c.query(`CREATE TABLE IF NOT EXISTS ent_admin_notifications (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        message TEXT,
        target_type TEXT DEFAULT 'all',
        target_value TEXT,
        type TEXT DEFAULT 'info',
        sent_by TEXT,
        sent_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await c.query(`CREATE TABLE IF NOT EXISTS ent_admin_settings (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        setting_key TEXT NOT NULL,
        setting_value TEXT,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(tenant_id, setting_key)
      )`);
      await c.query(`CREATE TABLE IF NOT EXISTS ent_admin_banned_users (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        user_email TEXT NOT NULL,
        reason TEXT,
        banned_by TEXT,
        banned_at TIMESTAMPTZ DEFAULT NOW(),
        unbanned_at TIMESTAMPTZ
      )`);
      // Indexes
      await c.query(`CREATE INDEX IF NOT EXISTS idx_ea_log_tenant ON ent_admin_activity_log(tenant_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_ea_log_time ON ent_admin_activity_log(created_at DESC)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_ea_cat_tenant ON ent_admin_categories(tenant_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_ea_notif_tenant ON ent_admin_notifications(tenant_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_ea_set_tenant ON ent_admin_settings(tenant_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_ea_ban_tenant ON ent_admin_banned_users(tenant_id)`);
      console.log('[EntAdmin] Migrations applied successfully');
    } catch (e) { console.error('[EntAdmin] Migration error:', e.message); }
    finally { c.release(); }
  })();

  // ============================================================
  // 1. ADMIN DASHBOARD  (GET /entertainment/admin)
  // ============================================================
  app.get('/entertainment/admin', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;

    // Count queries with graceful fallbacks
    let totalVideos = 0, totalMusic = 0, totalGames = 0, totalPosts = 0, activeUsers = 0, revenueMonth = 0;
    try { totalVideos = (await pool.query(`SELECT COUNT(*)::int as c FROM videos WHERE tenant_id=$1`, [tid])).rows[0].c; } catch (e) {}
    try { totalMusic = (await pool.query(`SELECT COUNT(*)::int as c FROM music_tracks WHERE tenant_id=$1`, [tid])).rows[0].c; } catch (e) {}
    try { totalGames = (await pool.query(`SELECT COUNT(*)::int as c FROM games WHERE tenant_id=$1`, [tid])).rows[0].c; } catch (e) {}
    try { totalPosts = (await pool.query(`SELECT COUNT(*)::int as c FROM social_posts WHERE tenant_id=$1`, [tid])).rows[0].c; } catch (e) {}
    try { activeUsers = (await pool.query(`SELECT COUNT(DISTINCT user_email)::int as c FROM ent_admin_activity_log WHERE tenant_id=$1 AND created_at > NOW() - INTERVAL '30 days'`, [tid])).rows[0].c; } catch (e) {}
    try { revenueMonth = (await pool.query(`SELECT COALESCE(SUM(amount),0)::numeric as t FROM payments WHERE tenant_id=$1 AND created_at > NOW() - INTERVAL '30 days'`, [tid])).rows[0].t; } catch (e) {}

    // Recent activity feed
    let activity = [];
    try { activity = (await pool.query(`SELECT * FROM ent_admin_activity_log WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 10`, [tid])).rows; } catch (e) {}

    // Moderation stats
    let flaggedCount = 0;
    try {
      const tables = ['videos', 'music_tracks', 'social_posts'];
      for (const tbl of tables) {
        try { flaggedCount += (await pool.query(`SELECT COUNT(*)::int as c FROM ${tbl} WHERE tenant_id=$1 AND status='flagged'`, [tid])).rows[0].c; } catch (ee) {}
      }
    } catch (e) {}

    const html = ADMIN_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('dashboard')}
      ${hero('📊', 'Entertainment Admin Dashboard', 'Platform overview and quick actions')}
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;margin-bottom:20px">
        <div class="ea-kpi"><div class="ea-kpi-val" style="color:#4f46e5">${fmtNum(totalVideos)}</div><div class="ea-kpi-lbl">🎬 Total Videos</div></div>
        <div class="ea-kpi"><div class="ea-kpi-val" style="color:#a855f7">${fmtNum(totalMusic)}</div><div class="ea-kpi-lbl">🎵 Music Tracks</div></div>
        <div class="ea-kpi"><div class="ea-kpi-val" style="color:#3b82f6">${fmtNum(totalGames)}</div><div class="ea-kpi-lbl">🎮 Games Played</div></div>
        <div class="ea-kpi"><div class="ea-kpi-val" style="color:#f59e0b">${fmtNum(totalPosts)}</div><div class="ea-kpi-lbl">💬 Social Posts</div></div>
        <div class="ea-kpi"><div class="ea-kpi-val" style="color:#10b981">${fmtNum(activeUsers)}</div><div class="ea-kpi-lbl">👤 Active Users (30d)</div></div>
        <div class="ea-kpi"><div class="ea-kpi-val" style="color:#16a34a">$${fmtMoney(revenueMonth)}</div><div class="ea-kpi-lbl">💰 Revenue (Month)</div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div class="ea-card">
          <h3 style="font-size:15px;color:#1e293b;margin-bottom:12px">⚡ Quick Links</h3>
          <div style="display:flex;flex-direction:column;gap:6px">
            <a href="/entertainment/admin/content" class="ea-btn ea-btn-primary" style="justify-content:flex-start">📋 Content Manager</a>
            <a href="/entertainment/admin/moderation" class="ea-btn ea-btn-warning" style="justify-content:flex-start">🛡 Moderation Queue${flaggedCount > 0 ? ` <span style="background:#dc2626;color:#fff;padding:1px 6px;border-radius:8px;font-size:10px;margin-left:auto">${flaggedCount}</span>` : ''}</a>
            <a href="/entertainment/admin/analytics/users" class="ea-btn ea-btn-secondary" style="justify-content:flex-start">👥 User Analytics</a>
            <a href="/entertainment/admin/analytics/content" class="ea-btn ea-btn-secondary" style="justify-content:flex-start">📈 Content Analytics</a>
            <a href="/entertainment/admin/analytics/revenue" class="ea-btn ea-btn-secondary" style="justify-content:flex-start">💰 Revenue Analytics</a>
            <a href="/entertainment/admin/notifications" class="ea-btn ea-btn-success" style="justify-content:flex-start">🔔 Send Notification</a>
          </div>
        </div>
        <div class="ea-card">
          <h3 style="font-size:15px;color:#1e293b;margin-bottom:12px">🕐 Recent Activity</h3>
          <div style="max-height:280px;overflow-y:auto">
            ${activity.length ? activity.map(a => `<div style="padding:8px 0;border-bottom:1px solid #f1f5f9">
              <div style="display:flex;justify-content:space-between;align-items:center">
                <span style="font-size:12px;font-weight:600;color:#475569">${esc(a.actor_email || 'System')}</span>
                <span style="font-size:10px;color:#94a3b8">${fmtDateTime(a.created_at)}</span>
              </div>
              <div style="font-size:12px;color:#64748b;margin-top:2px">${esc(a.action || '')} ${a.target_type ? '→ ' + esc(a.target_type) + (a.target_id ? '#' + a.target_id : '') : ''}</div>
            </div>`).join('') : '<p style="color:#94a3b8;font-size:13px;text-align:center;padding:30px">No recent activity</p>'}
          </div>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Entertainment Admin', html, user));
  }));

  // ============================================================
  // 2. CONTENT MANAGER  (GET /entertainment/admin/content)
  // ============================================================
  app.get('/entertainment/admin/content', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;
    const search = (req.query.q || '').trim();
    const filterType = (req.query.type || '').trim();
    const filterStatus = (req.query.status || '').trim();
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 50;
    const offset = (page - 1) * limit;

    // Gather content from all tables
    let allContent = [];
    const queries = [
      { type: 'video', sql: `SELECT id, title, 'video' as content_type, created_by as author, status, views, created_at FROM videos WHERE tenant_id=$1` },
      { type: 'music', sql: `SELECT id, title, 'music' as content_type, created_by as author, status, play_count as views, created_at FROM music_tracks WHERE tenant_id=$1` },
      { type: 'game', sql: `SELECT id, title, 'game' as content_type, created_by as author, 'active' as status, play_count as views, created_at FROM games WHERE tenant_id=$1` },
      { type: 'post', sql: `SELECT id, title, 'post' as content_type, author, status, likes as views, created_at FROM social_posts WHERE tenant_id=$1` },
    ];
    for (const q of queries) {
      try { allContent.push(...(await pool.query(q.sql, [tid])).rows); } catch (e) {}
    }

    // Apply filters
    if (search) allContent = allContent.filter(c => (c.title || '').toLowerCase().includes(search.toLowerCase()) || (c.author || '').toLowerCase().includes(search.toLowerCase()));
    if (filterType) allContent = allContent.filter(c => c.content_type === filterType);
    if (filterStatus) allContent = allContent.filter(c => (c.status || 'active') === filterStatus);

    // Sort by date desc
    allContent.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

    const total = allContent.length;
    const paged = allContent.slice(offset, offset + limit);

    const typeBadge = (type) => {
      const colors = { video: '#4f46e5', music: '#a855f7', game: '#3b82f6', post: '#f59e0b' };
      const icons = { video: '🎬', music: '🎵', game: '🎮', post: '💬' };
      return `<span class="ea-badge" style="background:${colors[type] || '#64748b'};color:#fff">${icons[type] || '📄'} ${type}</span>`;
    };
    const statusColor = (s) => {
      const map = { active: '#16a34a', published: '#16a34a', flagged: '#dc2626', pending: '#f59e0b', archived: '#64748b' };
      return `<span class="ea-badge" style="background:${map[s] || '#64748b'}22;color:${map[s] || '#64748b'}">${esc(s || 'active')}</span>`;
    };

    const html = ADMIN_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('content')}
      ${hero('📋', 'Content Manager', `${total} total items across all content types`)}
      <form method="GET" class="ea-filter">
        <div style="flex:1;min-width:180px">
          <label>Search</label>
          <input name="q" value="${esc(search)}" placeholder="Title or author...">
        </div>
        <div>
          <label>Type</label>
          <select name="type"><option value="">All</option><option value="video" ${filterType === 'video' ? 'selected' : ''}>Video</option><option value="music" ${filterType === 'music' ? 'selected' : ''}>Music</option><option value="game" ${filterType === 'game' ? 'selected' : ''}>Game</option><option value="post" ${filterType === 'post' ? 'selected' : ''}>Post</option></select>
        </div>
        <div>
          <label>Status</label>
          <select name="status"><option value="">All</option><option value="active" ${filterStatus === 'active' ? 'selected' : ''}>Active</option><option value="pending" ${filterStatus === 'pending' ? 'selected' : ''}>Pending</option><option value="flagged" ${filterStatus === 'flagged' ? 'selected' : ''}>Flagged</option><option value="archived" ${filterStatus === 'archived' ? 'selected' : ''}>Archived</option></select>
        </div>
        <button class="ea-btn ea-btn-primary" type="submit">Search</button>
        <a href="/entertainment/admin/content" class="ea-btn ea-btn-secondary">Clear</a>
      </form>
      <div class="ea-card" style="padding:0;overflow:hidden">
        <div style="overflow-x:auto">
          <table class="ea-table">
            <thead><tr><th>Type</th><th>Title</th><th>Author</th><th>Status</th><th>Views/Plays</th><th>Created</th><th>Actions</th></tr></thead>
            <tbody>${paged.map(c => `<tr>
              <td>${typeBadge(c.content_type)}</td>
              <td style="font-weight:600">${esc(c.title || 'Untitled')}</td>
              <td style="color:#64748b">${esc(c.author || '—')}</td>
              <td>${statusColor(c.status)}</td>
              <td>${fmtNum(c.views || 0)}</td>
              <td style="font-size:12px;color:#94a3b8">${fmtDate(c.created_at)}</td>
              <td>
                <form method="POST" action="/entertainment/admin/content/action" style="display:inline">
                  <input type="hidden" name="type" value="${esc(c.content_type)}">
                  <input type="hidden" name="id" value="${c.id}">
                  <input type="hidden" name="action" value="archive">
                  <button class="ea-btn ea-btn-secondary ea-btn-sm" type="submit">Archive</button>
                </form>
              </td>
            </tr>`).join('') || '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:30px">No content found</td></tr>'}</tbody>
          </table>
        </div>
      </div>
      ${total > limit ? `<div style="text-align:center;margin-top:16px;font-size:13px;color:#64748b">Page ${page} · ${total} items total</div>` : ''}
    </div>`;
    res.send(renderPage('Content Manager', html, user));
  }));

  // POST bulk content action
  app.post('/entertainment/admin/content/action', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;
    const { type, id, action } = req.body;
    const safeId = parseInt(id);
    if (!safeId || !type) return res.redirect('/entertainment/admin/content');

    const tableMap = { video: 'videos', music: 'music_tracks', game: 'games', post: 'social_posts' };
    const tbl = tableMap[type];
    if (!tbl) return res.redirect('/entertainment/admin/content');

    try {
      if (action === 'archive') {
        await pool.query(`UPDATE ${tbl} SET status='archived' WHERE id=$1 AND tenant_id=$2`, [safeId, tid]);
      } else if (action === 'feature') {
        await pool.query(`UPDATE ${tbl} SET is_featured=true WHERE id=$1 AND tenant_id=$2`, [safeId, tid]);
      } else if (action === 'delete') {
        await pool.query(`DELETE FROM ${tbl} WHERE id=$1 AND tenant_id=$2`, [safeId, tid]);
      }
      await logAction(tid, user.email, `${action}_content`, type, safeId, `Content #${safeId} (${type})`);
    } catch (e) { /* silent */ }
    res.redirect('/entertainment/admin/content');
  }));

  // ============================================================
  // 3. USER ANALYTICS  (GET /entertainment/admin/analytics/users)
  // ============================================================
  app.get('/entertainment/admin/analytics/users', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;

    let topViewers = [], topListeners = [], topGamers = [], topPosters = [];
    try { topViewers = (await pool.query(`SELECT COALESCE(user_email,created_by) as email, SUM(views)::int as total FROM videos WHERE tenant_id=$1 AND created_by IS NOT NULL GROUP BY email ORDER BY total DESC LIMIT 10`, [tid])).rows; } catch (e) {}
    try { topListeners = (await pool.query(`SELECT COALESCE(user_email,created_by) as email, SUM(play_count)::int as total FROM music_tracks WHERE tenant_id=$1 AND created_by IS NOT NULL GROUP BY email ORDER BY total DESC LIMIT 10`, [tid])).rows; } catch (e) {}
    try { topGamers = (await pool.query(`SELECT COALESCE(user_email,created_by) as email, SUM(play_count)::int as total FROM games WHERE tenant_id=$1 AND created_by IS NOT NULL GROUP BY email ORDER BY total DESC LIMIT 10`, [tid])).rows; } catch (e) {}
    try { topPosters = (await pool.query(`SELECT COALESCE(author,'unknown') as email, COUNT(*)::int as total FROM social_posts WHERE tenant_id=$1 GROUP BY email ORDER BY total DESC LIMIT 10`, [tid])).rows; } catch (e) {}

    // Activity timeline
    let timeline = [];
    try { timeline = (await pool.query(`SELECT to_char(created_at,'Mon YYYY') as label, COUNT(*)::int as cnt FROM ent_admin_activity_log WHERE tenant_id=$1 AND created_at > NOW() - INTERVAL '6 months' GROUP BY label ORDER BY MIN(created_at)`, [tid])).rows; } catch (e) {}

    const html = ADMIN_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('user-analytics')}
      ${hero('👥', 'User Analytics', 'Activity breakdown by user segment')}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
        <div class="ea-card">
          <h3 style="font-size:15px;color:#1e293b;margin-bottom:12px">🎬 Top Viewers</h3>
          ${topViewers.length ? barChart(topViewers.map(v => ({ label: v.email, value: v.total })), null, '#4f46e5') : '<p style="color:#94a3b8;font-size:13px">No data</p>'}
        </div>
        <div class="ea-card">
          <h3 style="font-size:15px;color:#1e293b;margin-bottom:12px">🎵 Top Listeners</h3>
          ${topListeners.length ? barChart(topListeners.map(v => ({ label: v.email, value: v.total })), null, '#a855f7') : '<p style="color:#94a3b8;font-size:13px">No data</p>'}
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
        <div class="ea-card">
          <h3 style="font-size:15px;color:#1e293b;margin-bottom:12px">🎮 Top Gamers</h3>
          ${topGamers.length ? barChart(topGamers.map(v => ({ label: v.email, value: v.total })), null, '#3b82f6') : '<p style="color:#94a3b8;font-size:13px">No data</p>'}
        </div>
        <div class="ea-card">
          <h3 style="font-size:15px;color:#1e293b;margin-bottom:12px">💬 Top Posters</h3>
          ${topPosters.length ? barChart(topPosters.map(v => ({ label: v.email, value: v.total })), null, '#f59e0b') : '<p style="color:#94a3b8;font-size:13px">No data</p>'}
        </div>
      </div>
      <div class="ea-card">
        <h3 style="font-size:15px;color:#1e293b;margin-bottom:12px">📅 Activity Timeline (6 months)</h3>
        ${timeline.length ? barChart(timeline, null, '#16a34a') : '<p style="color:#94a3b8;font-size:13px">No activity data</p>'}
      </div>
    </div>`;
    res.send(renderPage('User Analytics', html, user));
  }));

  // ============================================================
  // 4. CONTENT ANALYTICS  (GET /entertainment/admin/analytics/content)
  // ============================================================
  app.get('/entertainment/admin/analytics/content', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;

    let topVideos = [], topMusic = [], topGames = [], topPosts = [];
    try { topVideos = (await pool.query(`SELECT title, views FROM videos WHERE tenant_id=$1 ORDER BY views DESC LIMIT 10`, [tid])).rows; } catch (e) {}
    try { topMusic = (await pool.query(`SELECT title, play_count as views FROM music_tracks WHERE tenant_id=$1 ORDER BY play_count DESC LIMIT 10`, [tid])).rows; } catch (e) {}
    try { topGames = (await pool.query(`SELECT title, play_count as views FROM games WHERE tenant_id=$1 ORDER BY play_count DESC LIMIT 10`, [tid])).rows; } catch (e) {}
    try { topPosts = (await pool.query(`SELECT title, likes as views FROM social_posts WHERE tenant_id=$1 ORDER BY likes DESC LIMIT 10`, [tid])).rows; } catch (e) {}

    const html = ADMIN_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('content-analytics')}
      ${hero('📈', 'Content Analytics', 'Top performing content across all types')}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
        <div class="ea-card">
          <h3 style="font-size:15px;color:#1e293b;margin-bottom:12px">🎬 Top Videos by Views</h3>
          ${topVideos.length ? barChart(topVideos.map(v => ({ label: v.title || 'Untitled', value: v.views })), null, '#4f46e5') : '<p style="color:#94a3b8;font-size:13px">No data</p>'}
        </div>
        <div class="ea-card">
          <h3 style="font-size:15px;color:#1e293b;margin-bottom:12px">🎵 Top Music by Plays</h3>
          ${topMusic.length ? barChart(topMusic.map(v => ({ label: v.title || 'Untitled', value: v.views })), null, '#a855f7') : '<p style="color:#94a3b8;font-size:13px">No data</p>'}
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
        <div class="ea-card">
          <h3 style="font-size:15px;color:#1e293b;margin-bottom:12px">🎮 Top Games by Sessions</h3>
          ${topGames.length ? barChart(topGames.map(v => ({ label: v.title || 'Untitled', value: v.views })), null, '#3b82f6') : '<p style="color:#94a3b8;font-size:13px">No data</p>'}
        </div>
        <div class="ea-card">
          <h3 style="font-size:15px;color:#1e293b;margin-bottom:12px">💬 Top Posts by Likes</h3>
          ${topPosts.length ? barChart(topPosts.map(v => ({ label: v.title || 'Untitled', value: v.views })), null, '#f59e0b') : '<p style="color:#94a3b8;font-size:13px">No data</p>'}
        </div>
      </div>
      <div class="ea-card">
        <h3 style="font-size:15px;color:#1e293b;margin-bottom:12px">📊 Content Performance Summary</h3>
        <table class="ea-table"><thead><tr><th>Type</th><th>Top Item</th><th>Views/Plays</th></tr></thead><tbody>
          <tr><td><span class="ea-badge" style="background:#4f46e5;color:#fff">🎬 Video</span></td><td>${esc(topVideos[0]?.title || '—')}</td><td>${fmtNum(topVideos[0]?.views || 0)}</td></tr>
          <tr><td><span class="ea-badge" style="background:#a855f7;color:#fff">🎵 Music</span></td><td>${esc(topMusic[0]?.title || '—')}</td><td>${fmtNum(topMusic[0]?.views || 0)}</td></tr>
          <tr><td><span class="ea-badge" style="background:#3b82f6;color:#fff">🎮 Game</span></td><td>${esc(topGames[0]?.title || '—')}</td><td>${fmtNum(topGames[0]?.views || 0)}</td></tr>
          <tr><td><span class="ea-badge" style="background:#f59e0b;color:#fff">💬 Post</span></td><td>${esc(topPosts[0]?.title || '—')}</td><td>${fmtNum(topPosts[0]?.views || 0)}</td></tr>
        </tbody></table>
      </div>
    </div>`;
    res.send(renderPage('Content Analytics', html, user));
  }));

  // ============================================================
  // 5. REVENUE ANALYTICS  (GET /entertainment/admin/analytics/revenue)
  // ============================================================
  app.get('/entertainment/admin/analytics/revenue', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;

    let bySource = [], monthly = [], topGenerators = [];
    try { bySource = (await pool.query(`SELECT COALESCE(source_type,'general') as label, COALESCE(SUM(amount),0)::numeric as total, COUNT(*)::int as cnt FROM payments WHERE tenant_id=$1 GROUP BY source_type ORDER BY total DESC`, [tid])).rows; } catch (e) {}
    try { monthly = (await pool.query(`SELECT to_char(created_at,'Mon YYYY') as label, COALESCE(SUM(amount),0)::numeric as value FROM payments WHERE tenant_id=$1 AND created_at > NOW() - INTERVAL '12 months' GROUP BY label ORDER BY MIN(created_at)`, [tid])).rows; } catch (e) {}
    try { topGenerators = (await pool.query(`SELECT COALESCE(description,'Payment') as label, COALESCE(SUM(amount),0)::numeric as total FROM payments WHERE tenant_id=$1 GROUP BY description ORDER BY total DESC LIMIT 10`, [tid])).rows; } catch (e) {}

    const totalRevenue = monthly.reduce((s, r) => s + Number(r.value), 0);
    const maxSrc = Math.max(...bySource.map(r => Number(r.total)), 1);
    const maxGen = Math.max(...topGenerators.map(r => Number(r.total)), 1);

    const sourceIcons = { subscription: '🔄', ppv: '🎬', ads: '📢', tips: '💝', merch: '🛍', general: '💰' };

    const html = ADMIN_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('revenue')}
      ${hero('💰', 'Revenue Analytics', `Total 12-month revenue: $${fmtMoney(totalRevenue)}`)}
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:20px">
        ${bySource.map(s => `<div class="ea-kpi">
          <div class="ea-kpi-val" style="color:#16a34a">$${fmtMoney(s.total)}</div>
          <div class="ea-kpi-lbl">${sourceIcons[s.label] || '💰'} ${esc(s.label)}</div>
          <div style="font-size:11px;color:#94a3b8">${s.cnt} transactions</div>
        </div>`).join('') || '<div class="ea-kpi"><div class="ea-kpi-val" style="color:#64748b">$0</div><div class="ea-kpi-lbl">No revenue data</div></div>'}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
        <div class="ea-card">
          <h3 style="font-size:15px;color:#1e293b;margin-bottom:12px">📊 Revenue by Source</h3>
          ${bySource.length ? barChart(bySource.map(s => ({ label: s.label, value: s.total, fmt: fmtMoney })), maxSrc, '#16a34a') : '<p style="color:#94a3b8;font-size:13px">No data</p>'}
        </div>
        <div class="ea-card">
          <h3 style="font-size:15px;color:#1e293b;margin-bottom:12px">📈 Monthly Revenue Trend</h3>
          ${monthly.length ? lineChart(monthly.map(m => ({ label: m.label, value: Number(m.value) })), '#3b82f6') : '<p style="color:#94a3b8;font-size:13px">No data</p>'}
        </div>
      </div>
      <div class="ea-card">
        <h3 style="font-size:15px;color:#1e293b;margin-bottom:12px">🏆 Top Revenue Generators</h3>
        ${topGenerators.length ? barChart(topGenerators.map(g => ({ label: g.label, value: g.total, fmt: fmtMoney })), maxGen, '#f59e0b') : '<p style="color:#94a3b8;font-size:13px">No data</p>'}
      </div>
    </div>`;
    res.send(renderPage('Revenue Analytics', html, user));
  }));

  // ============================================================
  // 6. MODERATION QUEUE  (GET /entertainment/admin/moderation)
  // ============================================================
  app.get('/entertainment/admin/moderation', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;

    // Gather flagged content
    let flagged = [];
    const tables = [
      { type: 'video', sql: `SELECT id, title, 'video' as content_type, flag_reason as reason, COALESCE(flagged_by,'unknown') as reporter, updated_at as flagged_at FROM videos WHERE tenant_id=$1 AND status='flagged'` },
      { type: 'music', sql: `SELECT id, title, 'music' as content_type, flag_reason as reason, COALESCE(flagged_by,'unknown') as reporter, updated_at as flagged_at FROM music_tracks WHERE tenant_id=$1 AND status='flagged'` },
      { type: 'post', sql: `SELECT id, title, 'post' as content_type, flag_reason as reason, COALESCE(flagged_by,'unknown') as reporter, updated_at as flagged_at FROM social_posts WHERE tenant_id=$1 AND status='flagged'` },
    ];
    for (const t of tables) {
      try { flagged.push(...(await pool.query(t.sql, [tid])).rows); } catch (e) {}
    }
    flagged.sort((a, b) => new Date(b.flagged_at || 0) - new Date(a.flagged_at || 0));

    // Banned users count
    let bannedCount = 0;
    try { bannedCount = (await pool.query(`SELECT COUNT(*)::int as c FROM ent_admin_banned_users WHERE tenant_id=$1 AND unbanned_at IS NULL`, [tid])).rows[0].c; } catch (e) {}

    // Stats
    let totalApproved = 0, totalRejected = 0;
    try { totalApproved = (await pool.query(`SELECT COUNT(*)::int as c FROM ent_admin_activity_log WHERE tenant_id=$1 AND action='approve_content'`, [tid])).rows[0].c; } catch (e) {}
    try { totalRejected = (await pool.query(`SELECT COUNT(*)::int as c FROM ent_admin_activity_log WHERE tenant_id=$1 AND action='reject_content'`, [tid])).rows[0].c; } catch (e) {}

    const typeIcon = (t) => ({ video: '🎬', music: '🎵', post: '💬', game: '🎮' }[t] || '📄');

    const html = ADMIN_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('moderation')}
      ${hero('🛡', 'Moderation Queue', `${flagged.length} flagged items awaiting review`)}
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:20px">
        <div class="ea-kpi"><div class="ea-kpi-val" style="color:#dc2626">${flagged.length}</div><div class="ea-kpi-lbl">⚠ Flagged Items</div></div>
        <div class="ea-kpi"><div class="ea-kpi-val" style="color:#16a34a">${fmtNum(totalApproved)}</div><div class="ea-kpi-lbl">✅ Approved</div></div>
        <div class="ea-kpi"><div class="ea-kpi-val" style="color:#f59e0b">${fmtNum(totalRejected)}</div><div class="ea-kpi-lbl">❌ Rejected</div></div>
        <div class="ea-kpi"><div class="ea-kpi-val" style="color:#64748b">${bannedCount}</div><div class="ea-kpi-lbl">🚫 Banned Users</div></div>
      </div>
      <div class="ea-card">
        ${flagged.length ? `<table class="ea-table">
          <thead><tr><th>Type</th><th>Title</th><th>Reason</th><th>Reporter</th><th>Date</th><th>Actions</th></tr></thead>
          <tbody>${flagged.map(f => `<tr>
            <td>${typeIcon(f.content_type)} ${esc(f.content_type)}</td>
            <td style="font-weight:600">${esc(f.title || 'Untitled')}</td>
            <td><span class="ea-badge" style="background:#fef2f2;color:#dc2626">${esc(f.reason || 'No reason')}</span></td>
            <td style="color:#64748b;font-size:12px">${esc(f.reporter)}</td>
            <td style="font-size:12px;color:#94a3b8">${fmtDate(f.flagged_at)}</td>
            <td style="white-space:nowrap">
              <form method="POST" action="/entertainment/admin/moderation/action" style="display:inline">
                <input type="hidden" name="type" value="${esc(f.content_type)}">
                <input type="hidden" name="id" value="${f.id}">
                <button class="ea-btn ea-btn-success ea-btn-sm" name="action" value="approve">✅ Approve</button>
                <button class="ea-btn ea-btn-danger ea-btn-sm" name="action" value="reject">❌ Reject</button>
                <button class="ea-btn ea-btn-sm" name="action" value="delete" style="background:#7f1d1d;color:#fff">🗑 Delete</button>
              </form>
            </td>
          </tr>`).join('')}</tbody>
        </table>` : '<div style="text-align:center;padding:40px"><div style="font-size:48px;margin-bottom:12px">✨</div><p style="color:#16a34a;font-weight:600;font-size:16px">All clear!</p><p style="color:#94a3b8;font-size:13px">No flagged content to review</p></div>'}
      </div>
    </div>`;
    res.send(renderPage('Moderation Queue', html, user));
  }));

  // POST moderation action
  app.post('/entertainment/admin/moderation/action', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;
    const { type, id, action } = req.body;
    const safeId = parseInt(id);
    if (!safeId || !type) return res.redirect('/entertainment/admin/moderation');

    const tableMap = { video: 'videos', music: 'music_tracks', post: 'social_posts', game: 'games' };
    const tbl = tableMap[type];
    if (!tbl) return res.redirect('/entertainment/admin/moderation');

    try {
      if (action === 'approve') {
        await pool.query(`UPDATE ${tbl} SET status='active', flag_reason=NULL WHERE id=$1 AND tenant_id=$2`, [safeId, tid]);
        await logAction(tid, user.email, 'approve_content', type, safeId, 'Content approved');
      } else if (action === 'reject') {
        await pool.query(`UPDATE ${tbl} SET status='archived' WHERE id=$1 AND tenant_id=$2`, [safeId, tid]);
        await logAction(tid, user.email, 'reject_content', type, safeId, 'Content rejected');
      } else if (action === 'delete') {
        await pool.query(`DELETE FROM ${tbl} WHERE id=$1 AND tenant_id=$2`, [safeId, tid]);
        await logAction(tid, user.email, 'delete_content', type, safeId, 'Content deleted via moderation');
      } else if (action === 'ban') {
        // Ban user associated with content
        const authorResult = await pool.query(`SELECT COALESCE(created_by, author) as author FROM ${tbl} WHERE id=$1 AND tenant_id=$2`, [safeId, tid]);
        const authorEmail = authorResult.rows[0]?.author;
        if (authorEmail) {
          await pool.query(`INSERT INTO ent_admin_banned_users (tenant_id, user_email, reason, banned_by) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [tid, authorEmail, 'Banned via moderation', user.email]);
          await logAction(tid, user.email, 'ban_user', 'user', null, `Banned ${authorEmail}`);
        }
      }
    } catch (e) { /* silent */ }
    res.redirect('/entertainment/admin/moderation');
  }));

  // ============================================================
  // 7. CATEGORY MANAGER  (GET + POST)
  // ============================================================
  app.get('/entertainment/admin/categories', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;

    let categories = [];
    try { categories = (await pool.query(`SELECT * FROM ent_admin_categories WHERE tenant_id=$1 ORDER BY content_type, sort_order, name`, [tid])).rows; } catch (e) {}

    const grouped = {};
    for (const c of categories) {
      if (!grouped[c.content_type]) grouped[c.content_type] = [];
      grouped[c.content_type].push(c);
    }

    const html = ADMIN_CSS + `<div style="max-width:1000px;margin:0 auto">
      ${nav('categories')}
      ${hero('🏷', 'Category Manager', `${categories.length} categories across all content types`)}
      <div class="ea-card">
        <h3 style="font-size:15px;color:#1e293b;margin-bottom:16px">➕ Add New Category</h3>
        <form method="POST" action="/entertainment/admin/categories/new" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;align-items:end">
          <div><label style="font-size:11px;font-weight:600;color:#64748b;display:block;margin-bottom:3px">Content Type</label>
            <select name="content_type" required><option value="video">🎬 Video</option><option value="music">🎵 Music</option><option value="game">🎮 Game</option></select></div>
          <div><label style="font-size:11px;font-weight:600;color:#64748b;display:block;margin-bottom:3px">Name</label>
            <input name="name" required placeholder="Category name"></div>
          <div><label style="font-size:11px;font-weight:600;color:#64748b;display:block;margin-bottom:3px">Icon (emoji)</label>
            <input name="icon" value="📁" maxlength="4" style="width:80px"></div>
          <div><label style="font-size:11px;font-weight:600;color:#64748b;display:block;margin-bottom:3px">Color</label>
            <input name="color" type="color" value="#6366f1" style="width:60px;height:36px;padding:2px"></div>
          <div><label style="font-size:11px;font-weight:600;color:#64748b;display:block;margin-bottom:3px">Sort Order</label>
            <input name="sort_order" type="number" value="0" style="width:80px"></div>
          <div><label style="font-size:11px;font-weight:600;color:#64748b;display:block;margin-bottom:3px">Description</label>
            <input name="description" placeholder="Optional description"></div>
          <button class="ea-btn ea-btn-primary" type="submit">Add Category</button>
        </form>
      </div>
      ${Object.entries(grouped).map(([type, cats]) => `
        <div class="ea-card">
          <h3 style="font-size:15px;color:#1e293b;margin-bottom:12px">${{ video: '🎬 Videos', music: '🎵 Music', game: '🎮 Games' }[type] || type} (${cats.length})</h3>
          <table class="ea-table"><thead><tr><th>Icon</th><th>Name</th><th>Description</th><th>Active</th><th>Sort</th><th>Actions</th></tr></thead>
          <tbody>${cats.map(c => `<tr>
            <td style="font-size:20px">${esc(c.icon || '📁')}</td>
            <td style="font-weight:600">${esc(c.name)} <span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${esc(c.color || '#6366f1')};vertical-align:middle;margin-left:6px"></span></td>
            <td style="color:#64748b;font-size:12px">${esc(c.description || '—')}</td>
            <td>${c.is_active ? '<span style="color:#16a34a;font-weight:600">✅</span>' : '<span style="color:#dc2626;font-weight:600">❌</span>'}</td>
            <td>${c.sort_order || 0}</td>
            <td>
              <form method="POST" action="/entertainment/admin/categories/toggle" style="display:inline">
                <input type="hidden" name="id" value="${c.id}">
                <button class="ea-btn ea-btn-secondary ea-btn-sm">${c.is_active ? 'Disable' : 'Enable'}</button>
              </form>
              <form method="POST" action="/entertainment/admin/categories/delete" style="display:inline" onsubmit="return confirm('Delete this category?')">
                <input type="hidden" name="id" value="${c.id}">
                <button class="ea-btn ea-btn-danger ea-btn-sm">Delete</button>
              </form>
            </td>
          </tr>`).join('')}</tbody></table>
        </div>
      `).join('') || '<div class="ea-card" style="text-align:center;padding:40px"><p style="color:#94a3b8">No categories created yet</p></div>'}
    </div>`;
    res.send(renderPage('Category Manager', html, user));
  }));

  app.post('/entertainment/admin/categories/new', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;
    const { content_type, name, icon, color, description, sort_order } = req.body;
    if (!name || !content_type) return res.redirect('/entertainment/admin/categories');

    try {
      await pool.query(
        `INSERT INTO ent_admin_categories (tenant_id, content_type, name, icon, color, description, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [tid, content_type, name, icon || '📁', color || '#6366f1', description || null, parseInt(sort_order) || 0]
      );
      await logAction(tid, user.email, 'create_category', 'category', null, `${content_type}: ${name}`);
    } catch (e) { /* silent */ }
    res.redirect('/entertainment/admin/categories');
  }));

  app.post('/entertainment/admin/categories/toggle', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;
    const safeId = parseInt(req.body.id);
    if (!safeId) return res.redirect('/entertainment/admin/categories');

    try {
      await pool.query(`UPDATE ent_admin_categories SET is_active = NOT is_active WHERE id=$1 AND tenant_id=$2`, [safeId, tid]);
      await logAction(tid, user.email, 'toggle_category', 'category', safeId, `Toggled category #${safeId}`);
    } catch (e) { /* silent */ }
    res.redirect('/entertainment/admin/categories');
  }));

  app.post('/entertainment/admin/categories/delete', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;
    const safeId = parseInt(req.body.id);
    if (!safeId) return res.redirect('/entertainment/admin/categories');

    try {
      await pool.query(`DELETE FROM ent_admin_categories WHERE id=$1 AND tenant_id=$2`, [safeId, tid]);
      await logAction(tid, user.email, 'delete_category', 'category', safeId, `Deleted category #${safeId}`);
    } catch (e) { /* silent */ }
    res.redirect('/entertainment/admin/categories');
  }));

  // ============================================================
  // 8. ANNOUNCEMENTS & NOTIFICATIONS  (GET + POST)
  // ============================================================
  app.get('/entertainment/admin/notifications', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;

    let history = [];
    try { history = (await pool.query(`SELECT * FROM ent_admin_notifications WHERE tenant_id=$1 ORDER BY sent_at DESC LIMIT 50`, [tid])).rows; } catch (e) {}

    const typeColors = { info: '#3b82f6', promo: '#a855f7', alert: '#dc2626', success: '#16a34a' };
    const typeIcons = { info: 'ℹ️', promo: '📢', alert: '🚨', success: '✅' };

    const html = ADMIN_CSS + `<div style="max-width:1000px;margin:0 auto">
      ${nav('notifications')}
      ${hero('🔔', 'Notifications & Announcements', `${history.length} notifications sent`)}

      <div class="ea-card">
        <h3 style="font-size:15px;color:#1e293b;margin-bottom:16px">📤 Send New Notification</h3>
        <form method="POST" action="/entertainment/admin/notifications/send" style="display:grid;gap:12px;max-width:600px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div><label style="font-size:11px;font-weight:600;color:#64748b;display:block;margin-bottom:3px">Target</label>
              <select name="target_type"><option value="all">All Users</option><option value="role:admin">Admins Only</option><option value="role:premium">Premium Users</option><option value="role:user">Standard Users</option></select></div>
            <div><label style="font-size:11px;font-weight:600;color:#64748b;display:block;margin-bottom:3px">Type</label>
              <select name="type"><option value="info">ℹ️ Info</option><option value="promo">📢 Promo</option><option value="alert">🚨 Alert</option><option value="success">✅ Success</option></select></div>
          </div>
          <div><label style="font-size:11px;font-weight:600;color:#64748b;display:block;margin-bottom:3px">Title</label>
            <input name="title" required placeholder="Notification title" style="width:100%"></div>
          <div><label style="font-size:11px;font-weight:600;color:#64748b;display:block;margin-bottom:3px">Message</label>
            <textarea name="message" rows="3" placeholder="Notification message..." style="width:100%;resize:vertical"></textarea></div>
          <div style="display:flex;gap:8px">
            <button class="ea-btn ea-btn-primary" type="submit">📤 Send Notification</button>
          </div>
        </form>
      </div>

      <div class="ea-card">
        <h3 style="font-size:15px;color:#1e293b;margin-bottom:12px">📜 Notification History</h3>
        ${history.length ? `<table class="ea-table">
          <thead><tr><th>Type</th><th>Title</th><th>Target</th><th>Sent By</th><th>Date</th></tr></thead>
          <tbody>${history.map(h => `<tr>
            <td><span class="ea-badge" style="background:${typeColors[h.type] || '#64748b'};color:#fff">${typeIcons[h.type] || '🔔'} ${esc(h.type)}</span></td>
            <td style="font-weight:600">${esc(h.title)}</td>
            <td style="color:#64748b;font-size:12px">${esc(h.target_type || 'all')}${h.target_value ? ': ' + esc(h.target_value) : ''}</td>
            <td style="color:#64748b;font-size:12px">${esc(h.sent_by || '—')}</td>
            <td style="font-size:12px;color:#94a3b8">${fmtDateTime(h.sent_at)}</td>
          </tr>`).join('')}</tbody>
        </table>` : '<p style="color:#94a3b8;font-size:13px;text-align:center;padding:20px">No notifications sent yet</p>'}
      </div>
    </div>`;
    res.send(renderPage('Notifications', html, user));
  }));

  app.post('/entertainment/admin/notifications/send', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;
    const { target_type, type, title, message } = req.body;
    if (!title) return res.redirect('/entertainment/admin/notifications');

    try {
      await pool.query(
        `INSERT INTO ent_admin_notifications (tenant_id, title, message, target_type, type, sent_by) VALUES ($1,$2,$3,$4,$5,$6)`,
        [tid, title, message || '', target_type || 'all', type || 'info', user.email]
      );
      await logAction(tid, user.email, 'send_notification', 'notification', null, `Sent: ${title} to ${target_type || 'all'}`);
    } catch (e) { /* silent */ }
    res.redirect('/entertainment/admin/notifications');
  }));

  // ============================================================
  // 9. REPORTS CENTER  (GET /entertainment/admin/reports)
  // ============================================================
  app.get('/entertainment/admin/reports', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;
    const now = new Date();
    const weekAgo = new Date(now - 7 * 86400000);
    const monthAgo = new Date(now - 30 * 86400000);
    const prevWeek = new Date(weekAgo - 7 * 86400000);
    const prevMonth = new Date(monthAgo - 30 * 86400000);

    // Gather metrics for different periods
    const metrics = {};

    // Daily summary (today vs yesterday)
    try { metrics.todayViews = (await pool.query(`SELECT COALESCE(SUM(views),0)::int as c FROM videos WHERE tenant_id=$1 AND created_at > $2`, [tid, weekAgo])).rows[0].c; } catch (e) { metrics.todayViews = 0; }
    try { metrics.todayPosts = (await pool.query(`SELECT COUNT(*)::int as c FROM social_posts WHERE tenant_id=$1 AND created_at > $2`, [tid, weekAgo])).rows[0].c; } catch (e) { metrics.todayPosts = 0; }
    try { metrics.todayRevenue = (await pool.query(`SELECT COALESCE(SUM(amount),0)::numeric as c FROM payments WHERE tenant_id=$1 AND created_at > $2`, [tid, weekAgo])).rows[0].c; } catch (e) { metrics.todayRevenue = 0; }

    // Weekly vs previous week
    try { metrics.weekViews = (await pool.query(`SELECT COALESCE(SUM(views),0)::int as c FROM videos WHERE tenant_id=$1 AND created_at BETWEEN $2 AND $3`, [tid, weekAgo, now])).rows[0].c; } catch (e) { metrics.weekViews = 0; }
    try { metrics.prevWeekViews = (await pool.query(`SELECT COALESCE(SUM(views),0)::int as c FROM videos WHERE tenant_id=$1 AND created_at BETWEEN $2 AND $3`, [tid, prevWeek, weekAgo])).rows[0].c; } catch (e) { metrics.prevWeekViews = 0; }

    // Monthly vs previous month
    try { metrics.monthRevenue = (await pool.query(`SELECT COALESCE(SUM(amount),0)::numeric as c FROM payments WHERE tenant_id=$1 AND created_at BETWEEN $2 AND $3`, [tid, monthAgo, now])).rows[0].c; } catch (e) { metrics.monthRevenue = 0; }
    try { metrics.prevMonthRevenue = (await pool.query(`SELECT COALESCE(SUM(amount),0)::numeric as c FROM payments WHERE tenant_id=$1 AND created_at BETWEEN $2 AND $3`, [tid, prevMonth, monthAgo])).rows[0].c; } catch (e) { metrics.prevMonthRevenue = 0; }

    try { metrics.monthPosts = (await pool.query(`SELECT COUNT(*)::int as c FROM social_posts WHERE tenant_id=$1 AND created_at BETWEEN $2 AND $3`, [tid, monthAgo, now])).rows[0].c; } catch (e) { metrics.monthPosts = 0; }
    try { metrics.prevMonthPosts = (await pool.query(`SELECT COUNT(*)::int as c FROM social_posts WHERE tenant_id=$1 AND created_at BETWEEN $2 AND $3`, [tid, prevMonth, monthAgo])).rows[0].c; } catch (e) { metrics.prevMonthPosts = 0; }

    // Content counts
    try { metrics.totalVideos = (await pool.query(`SELECT COUNT(*)::int as c FROM videos WHERE tenant_id=$1`, [tid])).rows[0].c; } catch (e) { metrics.totalVideos = 0; }
    try { metrics.totalMusic = (await pool.query(`SELECT COUNT(*)::int as c FROM music_tracks WHERE tenant_id=$1`, [tid])).rows[0].c; } catch (e) { metrics.totalMusic = 0; }

    // Helpers for comparison display
    const delta = (curr, prev) => {
      const c = Number(curr || 0), p = Number(prev || 0);
      if (p === 0) return { val: c > 0 ? 100 : 0, color: '#16a34a', arrow: '↑' };
      const pct = Math.round((c - p) / p * 100);
      return { val: Math.abs(pct), color: pct >= 0 ? '#16a34a' : '#dc2626', arrow: pct >= 0 ? '↑' : '↓' };
    };

    const weekDelta = delta(metrics.weekViews, metrics.prevWeekViews);
    const monthRevDelta = delta(metrics.monthRevenue, metrics.prevMonthRevenue);
    const monthPostsDelta = delta(metrics.monthPosts, metrics.prevMonthPosts);

    const html = ADMIN_CSS + `<div style="max-width:1100px;margin:0 auto">
      ${nav('reports')}
      ${hero('📄', 'Reports Center', 'Generated summaries and period comparisons')}

      <!-- Daily Summary -->
      <div class="ea-card">
        <h3 style="font-size:16px;color:#1e293b;margin-bottom:16px">📋 Daily Summary (Last 7 days)</h3>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px">
          <div style="text-align:center;padding:14px;background:#f8fafc;border-radius:10px">
            <div style="font-size:24px;font-weight:800;color:#4f46e5">${fmtNum(metrics.todayViews)}</div>
            <div style="font-size:12px;color:#64748b;margin-top:4px">Video Views</div>
          </div>
          <div style="text-align:center;padding:14px;background:#f8fafc;border-radius:10px">
            <div style="font-size:24px;font-weight:800;color:#f59e0b">${fmtNum(metrics.todayPosts)}</div>
            <div style="font-size:12px;color:#64748b;margin-top:4px">New Posts</div>
          </div>
          <div style="text-align:center;padding:14px;background:#f8fafc;border-radius:10px">
            <div style="font-size:24px;font-weight:800;color:#16a34a">$${fmtMoney(metrics.todayRevenue)}</div>
            <div style="font-size:12px;color:#64748b;margin-top:4px">Revenue</div>
          </div>
          <div style="text-align:center;padding:14px;background:#f8fafc;border-radius:10px">
            <div style="font-size:24px;font-weight:800;color:#3b82f6">${fmtNum(metrics.totalVideos)}</div>
            <div style="font-size:12px;color:#64748b;margin-top:4px">Total Videos</div>
          </div>
        </div>
      </div>

      <!-- Weekly Digest -->
      <div class="ea-card">
        <h3 style="font-size:16px;color:#1e293b;margin-bottom:16px">📊 Weekly Digest</h3>
        <table class="ea-table"><thead><tr><th>Metric</th><th>This Week</th><th>Last Week</th><th>Change</th></tr></thead>
        <tbody>
          <tr><td style="font-weight:600">Video Views</td><td>${fmtNum(metrics.weekViews)}</td><td>${fmtNum(metrics.prevWeekViews)}</td>
            <td style="color:${weekDelta.color};font-weight:700">${weekDelta.arrow} ${weekDelta.val}%</td></tr>
        </tbody></table>
      </div>

      <!-- Monthly Overview -->
      <div class="ea-card">
        <h3 style="font-size:16px;color:#1e293b;margin-bottom:16px">📅 Monthly Overview</h3>
        <table class="ea-table"><thead><tr><th>Metric</th><th>This Month</th><th>Last Month</th><th>Change</th></tr></thead>
        <tbody>
          <tr><td style="font-weight:600">Revenue</td><td>$${fmtMoney(metrics.monthRevenue)}</td><td>$${fmtMoney(metrics.prevMonthRevenue)}</td>
            <td style="color:${monthRevDelta.color};font-weight:700">${monthRevDelta.arrow} ${monthRevDelta.val}%</td></tr>
          <tr><td style="font-weight:600">Social Posts</td><td>${fmtNum(metrics.monthPosts)}</td><td>${fmtNum(metrics.prevMonthPosts)}</td>
            <td style="color:${monthPostsDelta.color};font-weight:700">${monthPostsDelta.arrow} ${monthPostsDelta.val}%</td></tr>
          <tr><td style="font-weight:600">Total Videos</td><td>${fmtNum(metrics.totalVideos)}</td><td>—</td><td style="color:#3b82f6">Total</td></tr>
          <tr><td style="font-weight:600">Total Music</td><td>${fmtNum(metrics.totalMusic)}</td><td>—</td><td style="color:#3b82f6">Total</td></tr>
        </tbody></table>
      </div>

      <div style="margin-top:16px">
        <a href="/entertainment/admin" class="ea-btn ea-btn-secondary">← Back to Dashboard</a>
      </div>
    </div>`;
    res.send(renderPage('Reports Center', html, user));
  }));

  // ============================================================
  // 10. SETTINGS  (GET + POST)
  // ============================================================
  app.get('/entertainment/admin/settings', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;

    // Fetch all settings
    let settings = {};
    try {
      const rows = (await pool.query(`SELECT setting_key, setting_value FROM ent_admin_settings WHERE tenant_id=$1`, [tid])).rows;
      for (const r of rows) settings[r.setting_key] = r.setting_value;
    } catch (e) {}

    const val = (key, def) => settings[key] !== undefined ? settings[key] : def;
    const checked = (key, def) => val(key, def) === 'true' || val(key, def) === true ? 'checked' : '';

    const html = ADMIN_CSS + `<div style="max-width:900px;margin:0 auto">
      ${nav('settings')}
      ${hero('⚙', 'Entertainment Settings', 'Configure portal features and policies')}

      <form method="POST" action="/entertainment/admin/settings/save">
        <!-- Feature Toggles -->
        <div class="ea-card">
          <h3 style="font-size:16px;color:#1e293b;margin-bottom:16px">🔌 Feature Toggles</h3>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <label style="display:flex;align-items:center;gap:10px;padding:12px;background:#f8fafc;border-radius:10px;cursor:pointer">
              <input type="checkbox" name="feature_videos" value="true" ${checked('feature_videos', 'true')} style="width:18px;height:18px">
              <div><strong style="font-size:13px">🎬 Videos</strong><br><span style="font-size:11px;color:#64748b">Enable video hosting and playback</span></div>
            </label>
            <label style="display:flex;align-items:center;gap:10px;padding:12px;background:#f8fafc;border-radius:10px;cursor:pointer">
              <input type="checkbox" name="feature_music" value="true" ${checked('feature_music', 'true')} style="width:18px;height:18px">
              <div><strong style="font-size:13px">🎵 Music</strong><br><span style="font-size:11px;color:#64748b">Enable music streaming</span></div>
            </label>
            <label style="display:flex;align-items:center;gap:10px;padding:12px;background:#f8fafc;border-radius:10px;cursor:pointer">
              <input type="checkbox" name="feature_games" value="true" ${checked('feature_games', 'true')} style="width:18px;height:18px">
              <div><strong style="font-size:13px">🎮 Games</strong><br><span style="font-size:11px;color:#64748b">Enable gaming section</span></div>
            </label>
            <label style="display:flex;align-items:center;gap:10px;padding:12px;background:#f8fafc;border-radius:10px;cursor:pointer">
              <input type="checkbox" name="feature_social" value="true" ${checked('feature_social', 'true')} style="width:18px;height:18px">
              <div><strong style="font-size:13px">💬 Social</strong><br><span style="font-size:11px;color:#64748b">Enable social posts and feeds</span></div>
            </label>
          </div>
        </div>

        <!-- General Settings -->
        <div class="ea-card">
          <h3 style="font-size:16px;color:#1e293b;margin-bottom:16px">🌐 General Settings</h3>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div><label style="font-size:11px;font-weight:600;color:#64748b;display:block;margin-bottom:3px">Default Currency</label>
              <input name="currency" value="${esc(val('currency', 'USD'))}" style="width:100%"></div>
            <div><label style="font-size:11px;font-weight:600;color:#64748b;display:block;margin-bottom:3px">Max Upload Size (MB)</label>
              <input name="max_upload_mb" type="number" value="${esc(val('max_upload_mb', '500'))}" style="width:100%"></div>
          </div>
        </div>

        <!-- Content Policies -->
        <div class="ea-card">
          <h3 style="font-size:16px;color:#1e293b;margin-bottom:16px">📜 Content Policies</h3>
          <div style="display:grid;gap:12px">
            <label style="display:flex;align-items:center;gap:10px;padding:12px;background:#f8fafc;border-radius:10px;cursor:pointer">
              <input type="checkbox" name="explicit_allowed" value="true" ${checked('explicit_allowed', 'false')} style="width:18px;height:18px">
              <div><strong style="font-size:13px">⚠ Explicit Content Allowed</strong><br><span style="font-size:11px;color:#64748b">Permit explicit/mature content with proper labeling</span></div>
            </label>
            <label style="display:flex;align-items:center;gap:10px;padding:12px;background:#f8fafc;border-radius:10px;cursor:pointer">
              <input type="checkbox" name="comments_allowed" value="true" ${checked('comments_allowed', 'true')} style="width:18px;height:18px">
              <div><strong style="font-size:13px">💬 Comments Allowed</strong><br><span style="font-size:11px;color:#64748b">Enable user comments on content</span></div>
            </label>
            <label style="display:flex;align-items:center;gap:10px;padding:12px;background:#f8fafc;border-radius:10px;cursor:pointer">
              <input type="checkbox" name="ratings_allowed" value="true" ${checked('ratings_allowed', 'true')} style="width:18px;height:18px">
              <div><strong style="font-size:13px">⭐ Ratings Allowed</strong><br><span style="font-size:11px;color:#64748b">Enable star ratings on content</span></div>
            </label>
          </div>
        </div>

        <!-- Terms of Service -->
        <div class="ea-card">
          <h3 style="font-size:16px;color:#1e293b;margin-bottom:12px">📝 Terms of Service</h3>
          <textarea name="terms_of_service" rows="8" style="width:100%;resize:vertical;font-size:13px;border:1.5px solid #e2e8f0;border-radius:8px;padding:10px">${esc(val('terms_of_service', ''))}</textarea>
        </div>

        <div style="display:flex;gap:8px;margin-top:16px">
          <button class="ea-btn ea-btn-primary" type="submit" style="padding:10px 28px">💾 Save Settings</button>
          <a href="/entertainment/admin" class="ea-btn ea-btn-secondary">← Cancel</a>
        </div>
      </form>
    </div>`;
    res.send(renderPage('Entertainment Settings', html, user));
  }));

  app.post('/entertainment/admin/settings/save', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;
    const fields = ['feature_videos', 'feature_music', 'feature_games', 'feature_social', 'currency', 'max_upload_mb', 'explicit_allowed', 'comments_allowed', 'ratings_allowed', 'terms_of_service'];

    try {
      for (const key of fields) {
        const value = req.body[key];
        if (value !== undefined) {
          await pool.query(
            `INSERT INTO ent_admin_settings (tenant_id, setting_key, setting_value, updated_at) VALUES ($1,$2,$3,NOW())
             ON CONFLICT (tenant_id, setting_key) DO UPDATE SET setting_value=$3, updated_at=NOW()`,
            [tid, key, String(value)]
          );
        }
      }
      await logAction(tid, user.email, 'update_settings', 'settings', null, 'Updated portal settings');
    } catch (e) { /* silent */ }
    res.redirect('/entertainment/admin/settings');
  }));

  // ============================================================
  // CONSOLE LOG
  // ============================================================
  console.log('[EntAdmin] Entertainment admin module loaded — 10 routes registered');
};
