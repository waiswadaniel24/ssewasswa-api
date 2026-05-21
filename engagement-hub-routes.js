// ============================================================
// ENGAGEMENT HUB ROUTES — B2C Member Portal
// Comfort Zone — Multi-tenant SaaS Platform
// ============================================================
module.exports = function(app, pool, opts) {
  const esc = (opts && opts.esc) || (s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'));
  const renderPage = (opts && opts.renderPage) || ((t,c,u) => c);
  const ah = (opts && opts.ah) || (fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(e => res.status(500).send('Error: '+e.message)));
  const requireAuth = (opts && opts.requireAuth) || ((req,res,next) => { if(!req.session?.user) return res.redirect('/login'); next(); });
  const audit = (opts && opts.audit) || (() => {});
  const tenantId = (req) => req.session?.user?.tenant_id || 0;

  // ============================================================
  // SHARED CSS
  // ============================================================
  const engCSS = `
    .eng-nav { display:flex; gap:4px; padding:16px 0; flex-wrap:wrap; }
    .eng-nav a { padding:8px 20px; border-radius:8px; font-size:13px; font-weight:600; color:#475569; text-decoration:none; transition:all .2s; }
    .eng-nav a:hover, .eng-nav a.active { background:#e11d48; color:#fff; }
    .eng-hero { background:linear-gradient(135deg,#e11d48,#be123c); color:#fff; padding:60px 24px; text-align:center; border-radius:16px; margin-bottom:32px; }
    .eng-hero h1 { font-size:32px; font-weight:800; margin-bottom:8px; }
    .eng-hero p { color:#fecdd3; font-size:16px; }
    .eng-stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:16px; margin-bottom:32px; }
    .eng-stat-card { background:#fff; border:1px solid #e2e8f0; border-radius:14px; padding:24px; text-align:center; }
    .eng-stat-card .num { font-size:28px; font-weight:800; color:#e11d48; }
    .eng-stat-card .label { font-size:13px; color:#64748b; margin-top:4px; }
    .eng-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:20px; }
    .eng-card { background:#fff; border:1px solid #e2e8f0; border-radius:14px; overflow:hidden; transition:all .25s; }
    .eng-card:hover { transform:translateY(-4px); box-shadow:0 12px 32px rgba(0,0,0,.08); }
    .eng-card-cover { height:100px; background-size:cover; background-position:center; position:relative; }
    .eng-card-body { padding:20px; }
    .eng-card-body h3 { font-size:16px; font-weight:700; margin-bottom:4px; }
    .eng-card-body .meta { font-size:12px; color:#94a3b8; margin-bottom:8px; }
    .eng-card-body .desc { font-size:13px; color:#64748b; line-height:1.6; }
    .eng-card-actions { padding:12px 20px; border-top:1px solid #f1f5f9; display:flex; gap:8px; }
    .eng-btn { padding:8px 16px; border-radius:8px; font-size:13px; font-weight:600; cursor:pointer; border:none; text-decoration:none; display:inline-block; text-align:center; transition:all .2s; }
    .eng-btn:hover { transform:translateY(-1px); }
    .eng-btn-primary { background:#e11d48; color:#fff; }
    .eng-btn-outline { background:transparent; color:#475569; border:1.5px solid #e2e8f0; }
    .eng-btn-sm { padding:6px 12px; font-size:12px; }
    .eng-tag { display:inline-block; padding:3px 10px; border-radius:12px; font-size:11px; font-weight:600; background:#fef2f2; color:#e11d48; }
    .eng-tag-green { background:#f0fdf4; color:#16a34a; }
    .eng-tag-blue { background:#eff6ff; color:#2563eb; }
    .eng-member-row { display:flex; align-items:center; gap:14px; padding:14px 0; border-bottom:1px solid #f1f5f9; }
    .eng-member-avatar { width:40px; height:40px; border-radius:50%; background:linear-gradient(135deg,#fecdd3,#e11d48); display:flex; align-items:center; justify-content:center; color:#fff; font-weight:700; font-size:14px; flex-shrink:0; }
    .eng-post-card { background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:20px; margin-bottom:16px; transition:all .2s; }
    .eng-post-card:hover { box-shadow:0 4px 16px rgba(0,0,0,.06); }
    .eng-event-card { background:#fff; border:1px solid #e2e8f0; border-radius:14px; overflow:hidden; }
    .eng-event-date { background:linear-gradient(135deg,#e11d48,#be123c); color:#fff; padding:16px; text-align:center; min-width:80px; }
    .eng-event-date .day { font-size:28px; font-weight:800; line-height:1; }
    .eng-event-date .month { font-size:12px; text-transform:uppercase; opacity:.8; }
    .eng-resource-item { display:flex; align-items:center; gap:16px; padding:16px; background:#fff; border:1px solid #e2e8f0; border-radius:12px; margin-bottom:10px; transition:all .2s; }
    .eng-resource-item:hover { box-shadow:0 4px 16px rgba(0,0,0,.06); }
    .eng-resource-icon { width:48px; height:48px; border-radius:12px; background:#fef2f2; display:flex; align-items:center; justify-content:center; font-size:22px; flex-shrink:0; }
    .eng-empty { text-align:center; padding:60px 20px; color:#94a3b8; }
    .eng-empty .icon { font-size:48px; margin-bottom:12px; }
    .eng-list-card { background:#fff; border:1px solid #e2e8f0; border-radius:14px; padding:24px; margin-bottom:16px; }
  `;

  const engNav = (active) => `
    <div class="eng-nav">
      <a href="/engagement" class="${active==='home'?'active':''}">🏠 Dashboard</a>
      <a href="/engagement/members" class="${active==='members'?'active':''}">👥 Members</a>
      <a href="/engagement/events" class="${active==='events'?'active':''}">📅 Events</a>
      <a href="/engagement/discussions" class="${active==='discussions'?'active':''}">💬 Discussions</a>
      <a href="/engagement/resources" class="${active==='resources'?'active':''}">📚 Resources</a>
      <a href="/engagement/my-communities" class="${active==='my'?'active':''}">⭐ My Communities</a>
    </div>
  `;

  // ============================================================
  // DB MIGRATIONS
  // ============================================================
  (async () => {
    const tables = [
      `CREATE TABLE IF NOT EXISTS engagement_communities (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        category VARCHAR(100),
        logo_url VARCHAR(500),
        cover_url VARCHAR(500),
        is_private BOOLEAN DEFAULT false,
        member_count INTEGER DEFAULT 0,
        max_members INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_eng_communities_tenant ON engagement_communities(tenant_id)`,
      `CREATE INDEX IF NOT EXISTS idx_eng_communities_category ON engagement_communities(category)`,

      `CREATE TABLE IF NOT EXISTS engagement_members (
        id SERIAL PRIMARY KEY,
        community_id INTEGER NOT NULL REFERENCES engagement_communities(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL,
        role VARCHAR(50) DEFAULT 'member',
        status VARCHAR(50) DEFAULT 'active',
        joined_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(community_id, user_id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_eng_members_user ON engagement_members(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_eng_members_community ON engagement_members(community_id)`,

      `CREATE TABLE IF NOT EXISTS engagement_posts (
        id SERIAL PRIMARY KEY,
        community_id INTEGER NOT NULL REFERENCES engagement_communities(id) ON DELETE CASCADE,
        author_id INTEGER NOT NULL,
        title VARCHAR(500),
        body TEXT,
        type VARCHAR(50) DEFAULT 'discussion',
        likes_count INTEGER DEFAULT 0,
        comments_count INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_eng_posts_community ON engagement_posts(community_id)`,
      `CREATE INDEX IF NOT EXISTS idx_eng_posts_type ON engagement_posts(type)`,
      `CREATE INDEX IF NOT EXISTS idx_eng_posts_created ON engagement_posts(created_at DESC)`,

      `CREATE TABLE IF NOT EXISTS engagement_events_hub (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        community_id INTEGER REFERENCES engagement_communities(id) ON DELETE SET NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        event_date DATE NOT NULL,
        event_time TIME,
        location VARCHAR(500),
        capacity INTEGER DEFAULT 0,
        registered_count INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_eng_events_tenant ON engagement_events_hub(tenant_id)`,
      `CREATE INDEX IF NOT EXISTS idx_eng_events_date ON engagement_events_hub(event_date)`
    ];
    for (const sql of tables) {
      try { await pool.query(sql); } catch (e) { /* ignore */ }
    }
  })().catch(e => console.error('[EngagementHub] Migration error:', e.message));

  // ============================================================
  // GET /engagement — Engagement hub dashboard
  // ============================================================
  app.get('/engagement', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const userId = req.session.user?.id || 0;

    const [communityCount, memberCount, postCount, eventCount, recentPosts, upcomingEvents] = await Promise.all([
      pool.query(`SELECT COUNT(*) as cnt FROM engagement_communities WHERE tenant_id = $1`, [tid]),
      pool.query(`SELECT COUNT(*) as cnt FROM engagement_members WHERE community_id IN (SELECT id FROM engagement_communities WHERE tenant_id = $1)`, [tid]),
      pool.query(`SELECT COUNT(*) as cnt FROM engagement_posts WHERE community_id IN (SELECT id FROM engagement_communities WHERE tenant_id = $1)`),
      pool.query(`SELECT COUNT(*) as cnt FROM engagement_events_hub WHERE tenant_id = $1 AND event_date >= CURRENT_DATE`),
      pool.query(`
        SELECT p.*, u.name as author_name, u.email as author_email, c.name as community_name
        FROM engagement_posts p
        LEFT JOIN users u ON u.id = p.author_id
        LEFT JOIN engagement_communities c ON c.id = p.community_id
        WHERE c.tenant_id = $1
        ORDER BY p.created_at DESC LIMIT 5
      `, [tid]),
      pool.query(`
        SELECT * FROM engagement_events_hub
        WHERE tenant_id = $1 AND event_date >= CURRENT_DATE
        ORDER BY event_date ASC LIMIT 5
      `, [tid])
    ]);

    const myCommunities = (await pool.query(`
      SELECT c.* FROM engagement_communities c
      JOIN engagement_members m ON m.community_id = c.id
      WHERE m.user_id = $1 AND m.status = 'active'
      ORDER BY c.name
    `, [userId])).rows;

    const content = `
      ${engNav('home')}
      <div class="eng-hero">
        <h1>🤝 Engagement Hub</h1>
        <p>Connect, collaborate, and grow with your community</p>
      </div>

      <div class="eng-stats">
        <div class="eng-stat-card"><div class="num">${communityCount.rows[0].cnt}</div><div class="label">Communities</div></div>
        <div class="eng-stat-card"><div class="num">${memberCount.rows[0].cnt}</div><div class="label">Members</div></div>
        <div class="eng-stat-card"><div class="num">${postCount.rows[0].cnt}</div><div class="label">Posts</div></div>
        <div class="eng-stat-card"><div class="num">${eventCount.rows[0].cnt}</div><div class="label">Upcoming Events</div></div>
      </div>

      <div style="display:grid;grid-template-columns:2fr 1fr;gap:24px">
        <div>
          <h2 style="font-size:18px;font-weight:700;margin-bottom:16px">💬 Recent Discussions</h2>
          ${recentPosts.rows.length > 0 ? recentPosts.rows.map(p => `
            <div class="eng-post-card">
              <div style="display:flex;justify-content:space-between;align-items:flex-start">
                <div>
                  <span class="eng-tag">${esc(p.type || 'discussion')}</span>
                  ${p.community_name ? `<span class="eng-tag-blue eng-tag" style="margin-left:6px">${esc(p.community_name)}</span>` : ''}
                  <h3 style="margin-top:8px;font-size:15px">${esc(p.title || 'Untitled')}</h3>
                </div>
                <span style="font-size:12px;color:#94a3b8;white-space:nowrap">${p.created_at ? new Date(p.created_at).toLocaleDateString() : ''}</span>
              </div>
              <p style="margin-top:6px;font-size:13px;color:#64748b">${esc((p.body || '').substring(0, 150))}${(p.body || '').length > 150 ? '...' : ''}</p>
              <div style="margin-top:8px;font-size:12px;color:#94a3b8">
                ${esc(p.author_name || p.author_email || 'Unknown')} · ❤️ ${p.likes_count || 0} · 💬 ${p.comments_count || 0}
              </div>
            </div>
          `).join('') : '<div class="eng-empty"><div class="icon">💬</div><h3>No discussions yet</h3><p>Start a conversation in your community!</p></div>'}
        </div>

        <div>
          <h2 style="font-size:18px;font-weight:700;margin-bottom:16px">📅 Upcoming Events</h2>
          ${upcomingEvents.rows.length > 0 ? upcomingEvents.rows.map(e => `
            <div style="display:flex;gap:12px;margin-bottom:12px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
              <div class="eng-event-date">
                <div class="day">${e.event_date ? new Date(e.event_date).getDate() : ''}</div>
                <div class="month">${e.event_date ? new Date(e.event_date).toLocaleDateString('en-US', {month:'short'}) : ''}</div>
              </div>
              <div style="padding:12px;flex:1">
                <h4 style="font-size:14px;font-weight:600">${esc(e.title)}</h4>
                <div style="font-size:12px;color:#94a3b8;margin-top:2px">${e.location ? '📍 ' + esc(e.location) : '📍 TBD'} · ${e.registered_count || 0}/${e.capacity || '∞'}</div>
              </div>
            </div>
          `).join('') : '<div class="eng-empty"><div class="icon">📅</div><h3>No upcoming events</h3></div>'}

          <h2 style="font-size:18px;font-weight:700;margin:24px 0 16px">⭐ My Communities</h2>
          ${myCommunities.length > 0 ? myCommunities.map(c => `
            <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid #f1f5f9">
              <div style="width:36px;height:36px;border-radius:10px;background:${c.logo_url ? `url(${esc(c.logo_url)}) center/cover` : 'linear-gradient(135deg,#fecdd3,#e11d48)'};flex-shrink:0"></div>
              <div>
                <div style="font-size:13px;font-weight:600">${esc(c.name)}</div>
                <div style="font-size:11px;color:#94a3b8">${c.member_count || 0} members</div>
              </div>
            </div>
          `).join('') : '<div style="font-size:13px;color:#94a3b8;padding:12px 0">You haven\'t joined any communities yet.</div><a href="/engagement/events" class="eng-btn eng-btn-primary eng-btn-sm" style="margin-top:8px">Explore Communities</a>'}
        </div>
      </div>
    `;
    res.send(renderPage('Engagement Hub', content, req.session.user));
  }));

  // ============================================================
  // GET /engagement/members — Member directory
  // ============================================================
  app.get('/engagement/members', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const communityId = req.query.community || '';

    const communities = (await pool.query(`SELECT * FROM engagement_communities WHERE tenant_id = $1 ORDER BY name`, [tid])).rows;

    let members = [];
    if (communityId) {
      members = (await pool.query(`
        SELECT m.*, u.name, u.email, c.name as community_name
        FROM engagement_members m
        LEFT JOIN users u ON u.id = m.user_id
        LEFT JOIN engagement_communities c ON c.id = m.community_id
        WHERE m.community_id = $1 AND m.status = 'active'
        ORDER BY m.joined_at DESC
      `, [communityId])).rows;
    } else {
      members = (await pool.query(`
        SELECT m.*, u.name, u.email, c.name as community_name
        FROM engagement_members m
        LEFT JOIN users u ON u.id = m.user_id
        LEFT JOIN engagement_communities c ON c.id = m.community_id
        WHERE c.tenant_id = $1 AND m.status = 'active'
        ORDER BY m.joined_at DESC
        LIMIT 50
      `, [tid])).rows;
    }

    const content = `
      ${engNav('members')}
      <div class="eng-hero" style="padding:40px 24px">
        <h1>👥 Member Directory</h1>
        <p>${members.length} active members across your communities</p>
      </div>

      <div style="display:flex;gap:8px;margin-bottom:24px;flex-wrap:wrap">
        <a href="/engagement/members" class="eng-btn ${!communityId ? 'eng-btn-primary' : 'eng-btn-outline'}">All Members</a>
        ${communities.map(c => `<a href="/engagement/members?community=${c.id}" class="eng-btn ${parseInt(communityId) === c.id ? 'eng-btn-primary' : 'eng-btn-outline'}">${esc(c.name)}</a>`).join('')}
      </div>

      <div class="eng-list-card">
        ${members.length > 0 ? members.map(m => `
          <div class="eng-member-row">
            <div class="eng-member-avatar">${(m.name || m.email || 'U').charAt(0).toUpperCase()}</div>
            <div style="flex:1">
              <div style="font-weight:600;font-size:14px">${esc(m.name || m.email || 'Unknown')}</div>
              <div style="font-size:12px;color:#94a3b8">${esc(m.community_name || '')} · <span class="eng-tag ${m.role === 'admin' ? '' : 'eng-tag-green'}">${esc(m.role)}</span> · Joined ${m.joined_at ? new Date(m.joined_at).toLocaleDateString() : ''}</div>
            </div>
          </div>
        `).join('') : '<div class="eng-empty"><div class="icon">👥</div><h3>No members found</h3></div>'}
      </div>
    `;
    res.send(renderPage('Member Directory — Engagement Hub', content, req.session.user));
  }));

  // ============================================================
  // GET /engagement/events — Community events
  // ============================================================
  app.get('/engagement/events', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const view = req.query.view || 'upcoming';

    const [upcoming, past] = await Promise.all([
      pool.query(`SELECT * FROM engagement_events_hub WHERE tenant_id = $1 AND event_date >= CURRENT_DATE ORDER BY event_date ASC`, [tid]),
      pool.query(`SELECT * FROM engagement_events_hub WHERE tenant_id = $1 AND event_date < CURRENT_DATE ORDER BY event_date DESC LIMIT 20`, [tid])
    ]);

    const events = view === 'past' ? past.rows : upcoming.rows;
    const communities = (await pool.query(`SELECT id, name FROM engagement_communities WHERE tenant_id = $1 ORDER BY name`, [tid])).rows;

    const content = `
      ${engNav('events')}
      <div class="eng-hero" style="padding:40px 24px">
        <h1>📅 Community Events</h1>
        <p>Stay connected with upcoming events and activities</p>
      </div>

      <div style="display:flex;gap:8px;margin-bottom:24px">
        <a href="/engagement/events?view=upcoming" class="eng-btn ${view === 'upcoming' ? 'eng-btn-primary' : 'eng-btn-outline'}">Upcoming (${upcoming.rows.length})</a>
        <a href="/engagement/events?view=past" class="eng-btn ${view === 'past' ? 'eng-btn-primary' : 'eng-btn-outline'}">Past Events</a>
      </div>

      <div class="eng-grid">
        ${events.map(e => {
          const communityName = communities.find(c => c.id === e.community_id);
          const isFull = e.capacity > 0 && e.registered_count >= e.capacity;
          return `
          <div class="eng-event-card">
            <div style="display:flex">
              <div class="eng-event-date">
                <div class="day">${e.event_date ? new Date(e.event_date).getDate() : '?'}</div>
                <div class="month">${e.event_date ? new Date(e.event_date).toLocaleDateString('en-US', {month:'short'}) : ''}</div>
              </div>
              <div style="padding:16px;flex:1">
                <h3 style="font-size:15px;font-weight:700">${esc(e.title)}</h3>
                ${communityName ? `<span class="eng-tag-blue eng-tag" style="margin-top:6px">${esc(communityName.name)}</span>` : ''}
                <p style="margin-top:8px;font-size:13px;color:#64748b;line-height:1.5">${esc((e.description || '').substring(0, 120))}${(e.description || '').length > 120 ? '...' : ''}</p>
                <div style="margin-top:10px;font-size:12px;color:#94a3b8">
                  ${e.event_time ? '🕐 ' + e.event_time.toISOString().substring(11, 16) + ' · ' : ''}
                  ${e.location ? '📍 ' + esc(e.location) + ' · ' : ''}
                  ${isFull ? '<span style="color:#ef4444;font-weight:600">Full</span>' : `<span>${e.registered_count || 0}/${e.capacity || '∞'} registered</span>`}
                </div>
              </div>
            </div>
          </div>`;
        }).join('')}
      </div>

      ${events.length === 0 ? '<div class="eng-empty"><div class="icon">📅</div><h3>No events yet</h3><p>Events will appear here when they are created.</p></div>' : ''}
    `;
    res.send(renderPage('Events — Engagement Hub', content, req.session.user));
  }));

  // ============================================================
  // GET /engagement/discussions — Discussion forums
  // ============================================================
  app.get('/engagement/discussions', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const type = req.query.type || '';
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 20;
    const offset = (page - 1) * limit;

    let where = ['c.tenant_id = $1'];
    let params = [tid];
    let idx = 2;

    if (type) {
      where.push(`p.type = $${idx}`);
      params.push(type);
      idx++;
    }

    const [countResult, posts] = await Promise.all([
      pool.query(`SELECT COUNT(*) as total FROM engagement_posts p JOIN engagement_communities c ON c.id = p.community_id WHERE ${where.join(' AND ')}`, params),
      pool.query(`
        SELECT p.*, u.name as author_name, u.email as author_email, c.name as community_name
        FROM engagement_posts p
        LEFT JOIN users u ON u.id = p.author_id
        LEFT JOIN engagement_communities c ON c.id = p.community_id
        WHERE ${where.join(' AND ')}
        ORDER BY p.created_at DESC
        LIMIT $${idx} OFFSET $${idx + 1}
      `, [...params, limit, offset])
    ]);

    const total = parseInt(countResult.rows[0].total);

    const content = `
      ${engNav('discussions')}
      <div class="eng-hero" style="padding:40px 24px">
        <h1>💬 Discussions</h1>
        <p>${total} posts across your communities</p>
      </div>

      <div style="display:flex;gap:8px;margin-bottom:24px;flex-wrap:wrap">
        <a href="/engagement/discussions" class="eng-btn ${!type ? 'eng-btn-primary' : 'eng-btn-outline'}">All</a>
        <a href="/engagement/discussions?type=discussion" class="eng-btn ${type === 'discussion' ? 'eng-btn-primary' : 'eng-btn-outline'}">Discussions</a>
        <a href="/engagement/discussions?type=question" class="eng-btn ${type === 'question' ? 'eng-btn-primary' : 'eng-btn-outline'}">Questions</a>
        <a href="/engagement/discussions?type=announcement" class="eng-btn ${type === 'announcement' ? 'eng-btn-primary' : 'eng-btn-outline'}">Announcements</a>
        <a href="/engagement/discussions?type=resource" class="eng-btn ${type === 'resource' ? 'eng-btn-primary' : 'eng-btn-outline'}">Resources</a>
      </div>

      ${posts.rows.map(p => `
        <div class="eng-post-card">
          <div style="display:flex;justify-content:space-between;align-items:flex-start">
            <div style="display:flex;align-items:center;gap:10px">
              <div class="eng-member-avatar" style="width:36px;height:36px;font-size:13px">${(p.author_name || p.author_email || 'U').charAt(0).toUpperCase()}</div>
              <div>
                <span style="font-weight:600;font-size:13px">${esc(p.author_name || p.author_email || 'Unknown')}</span>
                <span style="font-size:12px;color:#94a3b8;margin-left:6px">${p.created_at ? new Date(p.created_at).toLocaleDateString() : ''}</span>
              </div>
            </div>
            <div style="display:flex;gap:6px">
              <span class="eng-tag">${esc(p.type || 'discussion')}</span>
              ${p.community_name ? `<span class="eng-tag-blue eng-tag">${esc(p.community_name)}</span>` : ''}
            </div>
          </div>
          <h3 style="margin-top:10px;font-size:15px;font-weight:600">${esc(p.title || 'Untitled Post')}</h3>
          <p style="margin-top:6px;font-size:13px;color:#64748b;line-height:1.6">${esc((p.body || '').substring(0, 200))}${(p.body || '').length > 200 ? '...' : ''}</p>
          <div style="margin-top:10px;display:flex;gap:16px;font-size:12px;color:#94a3b8">
            <span>❤️ ${p.likes_count || 0} likes</span>
            <span>💬 ${p.comments_count || 0} comments</span>
          </div>
        </div>
      `).join('')}

      ${posts.rows.length === 0 ? '<div class="eng-empty"><div class="icon">💬</div><h3>No discussions yet</h3><p>Be the first to start a conversation!</p></div>' : ''}
    `;
    res.send(renderPage('Discussions — Engagement Hub', content, req.session.user));
  }));

  // ============================================================
  // GET /engagement/resources — Shared resources library
  // ============================================================
  app.get('/engagement/resources', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);

    const resources = (await pool.query(`
      SELECT p.*, u.name as author_name, c.name as community_name
      FROM engagement_posts p
      LEFT JOIN users u ON u.id = p.author_id
      LEFT JOIN engagement_communities c ON c.id = p.community_id
      WHERE c.tenant_id = $1 AND p.type = 'resource'
      ORDER BY p.created_at DESC
      LIMIT 50
    `, [tid])).rows;

    const content = `
      ${engNav('resources')}
      <div class="eng-hero" style="padding:40px 24px">
        <h1>📚 Resources Library</h1>
        <p>Shared documents, links, and materials from your communities</p>
      </div>

      ${resources.length > 0 ? resources.map(r => `
        <div class="eng-resource-item">
          <div class="eng-resource-icon">📄</div>
          <div style="flex:1;min-width:0">
            <h3 style="font-size:14px;font-weight:600">${esc(r.title || 'Untitled Resource')}</h3>
            <p style="font-size:13px;color:#64748b;margin-top:2px">${esc((r.body || '').substring(0, 150))}${(r.body || '').length > 150 ? '...' : ''}</p>
            <div style="font-size:12px;color:#94a3b8;margin-top:4px">${esc(r.community_name || '')} · by ${esc(r.author_name || 'Unknown')} · ❤️ ${r.likes_count || 0}</div>
          </div>
        </div>
      `).join('') : '<div class="eng-empty"><div class="icon">📚</div><h3>No resources yet</h3><p>Shared resources from your communities will appear here.</p></div>'}
    `;
    res.send(renderPage('Resources — Engagement Hub', content, req.session.user));
  }));

  // ============================================================
  // POST /engagement/join — Join a community
  // ============================================================
  app.post('/engagement/join', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const userId = req.session.user?.id || 0;
    const communityId = parseInt(req.body.community_id);

    if (!communityId) {
      return res.json({ success: false, message: 'Community ID is required' });
    }

    // Verify community belongs to tenant
    const community = (await pool.query(`SELECT * FROM engagement_communities WHERE id = $1 AND tenant_id = $2`, [communityId, tid])).rows[0];
    if (!community) {
      return res.json({ success: false, message: 'Community not found' });
    }

    // Check if already a member
    const existing = (await pool.query(`SELECT id FROM engagement_members WHERE community_id = $1 AND user_id = $2`, [communityId, userId])).rows[0];
    if (existing) {
      return res.json({ success: false, message: 'Already a member' });
    }

    // Check capacity
    if (community.max_members > 0 && community.member_count >= community.max_members) {
      return res.json({ success: false, message: 'Community is full' });
    }

    await pool.query(`INSERT INTO engagement_members (community_id, user_id, role, status) VALUES ($1, $2, 'member', 'active')`, [communityId, userId]);
    await pool.query(`UPDATE engagement_communities SET member_count = member_count + 1 WHERE id = $1`, [communityId]);
    audit('join_community', { communityId, userId, tenantId: tid });

    res.json({ success: true, message: `Joined "${community.name}" successfully!` });
  }));

  // ============================================================
  // GET /engagement/my-communities — User's communities
  // ============================================================
  app.get('/engagement/my-communities', requireAuth, ah(async (req, res) => {
    const userId = req.session.user?.id || 0;

    const myCommunities = (await pool.query(`
      SELECT c.*, m.role as my_role, m.joined_at as member_since,
        (SELECT COUNT(*) FROM engagement_members WHERE community_id = c.id AND status = 'active') as active_members
      FROM engagement_communities c
      JOIN engagement_members m ON m.community_id = c.id
      WHERE m.user_id = $1 AND m.status = 'active'
      ORDER BY c.name
    `, [userId])).rows;

    const myPostCount = (await pool.query(`
      SELECT COUNT(*) as cnt FROM engagement_posts
      WHERE author_id = $1 AND community_id IN (SELECT community_id FROM engagement_members WHERE user_id = $1)
    `, [userId])).rows[0].cnt;

    const content = `
      ${engNav('my')}
      <div class="eng-hero" style="padding:40px 24px">
        <h1>⭐ My Communities</h1>
        <p>You're a member of ${myCommunities.length} communities with ${myPostCount} posts</p>
      </div>

      ${myCommunities.length > 0 ? `
      <div class="eng-grid">
        ${myCommunities.map(c => `
          <div class="eng-card">
            <div class="eng-card-cover" style="height:80px;background:${c.cover_url ? `url(${esc(c.cover_url)})` : 'linear-gradient(135deg,#e11d48,#be123c)'}">
              ${c.is_private ? '<span class="badge" style="top:8px;left:8px;right:auto">🔒 Private</span>' : ''}
            </div>
            <div class="eng-card-body">
              <div style="display:flex;align-items:center;gap:12px">
                <div style="width:40px;height:40px;border-radius:10px;background:${c.logo_url ? `url(${esc(c.logo_url)}) center/cover` : 'linear-gradient(135deg,#fecdd3,#e11d48)'};flex-shrink:0"></div>
                <div>
                  <h3>${esc(c.name)}</h3>
                  <div class="meta">${c.active_members || 0} members · Joined ${c.member_since ? new Date(c.member_since).toLocaleDateString() : ''}</div>
                </div>
              </div>
              <p style="margin-top:10px;font-size:13px;color:#64748b;line-height:1.5">${esc((c.description || '').substring(0, 120))}${(c.description || '').length > 120 ? '...' : ''}</p>
              ${c.category ? `<span class="eng-tag" style="margin-top:8px">${esc(c.category)}</span>` : ''}
            </div>
            <div class="eng-card-actions" style="justify-content:space-between">
              <span style="font-size:12px;color:#64748b;padding:8px 0">Your role: <strong>${esc(c.my_role || 'member')}</strong></span>
              <span style="font-size:12px;color:#94a3b8;padding:8px 0">${c.max_members > 0 ? `${c.active_members || 0}/${c.max_members} capacity` : 'Unlimited'}</span>
            </div>
          </div>
        `).join('')}
      </div>` : `
      <div class="eng-empty">
        <div class="icon">🌟</div>
        <h3>You haven't joined any communities yet</h3>
        <p>Explore available communities and join to start collaborating!</p>
        <a href="/engagement/events" class="eng-btn eng-btn-primary" style="margin-top:16px">Explore Communities</a>
      </div>`}
    `;
    res.send(renderPage('My Communities — Engagement Hub', content, req.session.user));
  }));

  console.log('[EngagementHub] loaded — 4 tables, 7 routes');
};
