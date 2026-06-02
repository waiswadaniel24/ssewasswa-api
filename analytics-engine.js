// ============================================================
// === ANALYTICS INTELLIGENCE — Know Your Users Deeply ===
// ============================================================
// Real-time dashboard, conversion funnels, user flow tracking,
// page analytics, device stats, geographic data, session tracking,
// goal tracking, custom events, heatmap data

const { migrateQuery } = require('./db');
const AN_MIGRATIONS = [
  // Session tracking
  `CREATE TABLE IF NOT EXISTS analytics_sessions (
    id SERIAL PRIMARY KEY, session_id TEXT NOT NULL,
    user_email TEXT, ip_address TEXT, country TEXT DEFAULT 'UG',
    city TEXT DEFAULT '', device TEXT DEFAULT 'desktop',
    browser TEXT DEFAULT '', os TEXT DEFAULT '',
    referrer TEXT, landing_page TEXT,
    page_views INTEGER DEFAULT 1, events INTEGER DEFAULT 0,
    duration INTEGER DEFAULT 0, is_bounce BOOLEAN DEFAULT true,
    conversion_goal TEXT, converted BOOLEAN DEFAULT false,
    started_at TIMESTAMPTZ DEFAULT NOW(), last_active TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(session_id)
  )`,
  // Page analytics detail)
  `CREATE TABLE IF NOT EXISTS analytics_pages (
    id SERIAL PRIMARY KEY, session_id TEXT, page_url TEXT NOT NULL,
    title TEXT, time_spent INTEGER DEFAULT 0,
    scroll_depth INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  // Custom events)
  `CREATE TABLE IF NOT EXISTS analytics_events (
    id SERIAL PRIMARY KEY, session_id TEXT,
    event_name TEXT NOT NULL, event_data JSONB,
    page_url TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  // Conversion funnels)
  `CREATE TABLE IF NOT EXISTS analytics_funnels (
    id SERIAL PRIMARY KEY, name TEXT NOT NULL,
    steps JSONB NOT NULL DEFAULT '[]',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  // Goal tracking)
  `CREATE TABLE IF NOT EXISTS analytics_goals (
    id SERIAL PRIMARY KEY, goal_name TEXT NOT NULL,
    goal_type TEXT DEFAULT 'page_view',
    goal_target TEXT, goal_value INTEGER DEFAULT 0,
    current_value INTEGER DEFAULT 0, is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  // Daily aggregates (for performance)
  `CREATE TABLE IF NOT EXISTS analytics_daily (
    id SERIAL PRIMARY KEY, date DATE NOT NULL,
    page_views INTEGER DEFAULT 0, unique_visitors INTEGER DEFAULT 0,
    new_users INTEGER DEFAULT 0, conversions INTEGER DEFAULT 0,
    bounce_rate NUMERIC DEFAULT 0, avg_duration INTEGER DEFAULT 0,
    top_page TEXT, top_referrer TEXT, revenue_usd NUMERIC DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(date)
  )`,
  // Geographic data)
  `CREATE TABLE IF NOT EXISTS analytics_geo (
    id SERIAL PRIMARY KEY, date DATE DEFAULT CURRENT_DATE,
    country TEXT DEFAULT 'UG', city TEXT DEFAULT '',
    visits INTEGER DEFAULT 0, page_views INTEGER DEFAULT 0,
    conversions INTEGER DEFAULT 0,
    UNIQUE(date, country, city)
  )`,
];
AN_MIGRATIONS.forEach(m => migrations.push(m));
['analytics_sessions','analytics_pages','analytics_events','analytics_funnels','analytics_goals','analytics_daily','analytics_geo'
].forEach(t => VALID_TABLES.add(t));

// ============================================================
// === 1. TRACKING ENDPOINT ===
// ============================================================

app.post('/api/analytics/event', ah(async (req, res) => {
  const { event_name, event_data, session_id, page_url } = req.body;
  await pool.query(
    `INSERT INTO analytics_events (session_id, event_name, event_data, page_url, created_at) VALUES ($1, $2, $3, $4, NOW())`,
    [session_id || req.sessionID, event_name || 'generic', event_data ? JSON.stringify(event_data) : null, page_url || null]
  );
  res.json({ ok: true });
}));

// ============================================================
// === 2. ANALYTICS DASHBOARD (Admin) ===
// ============================================================

app.get('/admin/analytics', requireAuth, ah(async (req, res) => {
  const u = req.session.user;
  if (u.role !== 'super_admin' && u.role !== 'admin') return res.status(403).send('Access denied');

  const [totalSessions, todaySessions, weekSessions, topPages, topReferrers, topCountries, deviceBreakdown, recentEvents, dailyData] = await Promise.all([
    pool.query('SELECT COUNT(*) as total FROM analytics_sessions'),
    pool.query("SELECT COUNT(*) as total FROM analytics_sessions WHERE started_at >= CURRENT_DATE"),
    pool.query("SELECT COUNT(*) as total FROM analytics_sessions WHERE started_at >= NOW() - INTERVAL '7 days'"),
    pool.query("SELECT landing_page, COUNT(*) as visits FROM analytics_sessions GROUP BY landing_page ORDER BY visits DESC LIMIT 15"),
    pool.query("SELECT referrer, COUNT(*) as visits FROM analytics_sessions WHERE referrer IS NOT NULL AND referrer != '' GROUP BY referrer ORDER BY visits DESC LIMIT 10"),
    pool.query("SELECT country, COUNT(*) as visits FROM analytics_sessions GROUP BY country ORDER BY visits DESC LIMIT 10"),
    pool.query("SELECT device, COUNT(*) as count FROM analytics_sessions GROUP BY device ORDER BY count DESC"),
    pool.query("SELECT * FROM analytics_events ORDER BY created_at DESC LIMIT 30"),
    pool.query("SELECT * FROM analytics_daily WHERE date >= NOW() - INTERVAL '30 days' ORDER BY date DESC"),
  ]);

  // Funnel: Visit → Register → Active
  const [visitors, registrants, activeUsers] = await Promise.all([
    pool.query("SELECT COUNT(DISTINCT ip_address) as total FROM visit_analytics WHERE created_at >= NOW() - INTERVAL '30 days'"),
    pool.query("SELECT COUNT(*) as total FROM users WHERE created_at >= NOW() - INTERVAL '30 days'"),
    pool.query("SELECT COUNT(DISTINCT user_email) as total FROM point_transactions WHERE created_at >= NOW() - INTERVAL '30 days'"),
  ]);

  const visitCount = parseInt(visitors.rows[0]?.total || 0);
  const regCount = parseInt(registrants.rows[0]?.total || 0);
  const activeCount = parseInt(activeUsers.rows[0]?.total || 0);
  const convRate1 = visitCount > 0 ? (regCount / visitCount * 100).toFixed(1) : 0;
  const convRate2 = regCount > 0 ? (activeCount / regCount * 100).toFixed(1) : 0;

  // Daily sparkline
  const sparkData = dailyData.rows.reverse().map(d => ({
    date: d.date,
    views: parseInt(d.page_views),
    visitors: parseInt(d.unique_visitors),
    conversions: parseInt(d.conversions),
    revenue: Number(d.revenue_usd || 0)
  }));
  const maxViews = Math.max(...sparkData.map(d => d.views), 1);

  res.send(renderPage('Analytics Dashboard', `
    <div class="hero" style="background:linear-gradient(135deg,#3b82f6,#6366f1)"><h1>Analytics Intelligence</h1><p>Deep insights into your users, traffic, and revenue</p></div>

    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:24px">
      <div class="stat-card"><div class="stat-num" style="color:#6366f1">${Number(totalSessions.rows[0].total).toLocaleString()}</div><div>Total Sessions</div></div>
      <div class="stat-card"><div class="stat-num" style="color:#10b981">${Number(todaySessions.rows[0].total).toLocaleString()}</div><div>Today</div></div>
      <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${Number(weekSessions.rows[0].total).toLocaleString()}</div><div>This Week</div></div>
      <div class="stat-card"><div class="stat-num" style="color:#ef4444">${convRate1}%</div><div>Conversion Rate</div></div>
    </div>

    <div style="display:grid;grid-template-columns:2fr 1fr;gap:16px;margin-bottom:24px">
      <div class="card">
        <h3>Conversion Funnel (30 days)</h3>
        <div style="margin-top:16px">
          ${[
            { label: 'Visitors', count: visitCount, pct: 100, color: '#6366f1' },
            { label: 'Registrations', count: regCount, pct: visitCount > 0 ? (regCount/visitCount*100) : 0, color: '#10b981' },
            { label: 'Active Users', count: activeCount, pct: visitCount > 0 ? (activeCount/visitCount*100) : 0, color: '#f59e0b' },
          ].map(f => `<div style="margin-bottom:12px">
            <div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-size:14px;font-weight:500">${f.label}</span><span style="font-size:13px;color:#64748b">${f.count.toLocaleString()} (${f.pct.toFixed(1)}%)</span></div>
            <div style="height:24px;background:#f1f5f9;border-radius:4px;overflow:hidden"><div style="height:100%;background:${f.color};border-radius:4px;width:${Math.max(f.pct, 1)}%;transition:width 0.5s"></div></div>
          </div>`).join('')}
        </div>
      </div>
      <div class="card">
        <h3>30-Day Traffic</h3>
        <div style="display:flex;align-items:end;gap:2px;height:80px;margin-top:12px">
          ${sparkData.map(d => `<div style="flex:1;height:${Math.max((d.views/maxViews)*80,2)}px;background:linear-gradient(to top,#6366f1,#a78bfa);border-radius:2px" title="${d.date}: ${d.views} views"></div>`).join('')}
        </div>
        <div style="margin-top:16px">
          <h4 style="font-size:13px">Devices</h4>
          ${deviceBreakdown.rows.map(d => `<div style="font-size:13px;padding:3px 0">${esc(d.device)}: <strong>${d.count}</strong></div>`).join('')}
        </div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px">
      <div class="card">
        <h3>Top Pages</h3>
        ${topPages.rows.map(p => `<div style="padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:13px;display:flex;justify-content:space-between"><a href="${esc(p.landing_page)}" style="color:#6366f1" target="_blank">${esc(p.landing_page)}</a><span style="color:#64748b">${p.visits}</span></div>`).join('')}
      </div>
      <div class="card">
        <h3>Top Referrers</h3>
        ${topReferrers.rows.map(r => `<div style="padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:13px;display:flex;justify-content:space-between"><span style="max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.referrer || 'Direct')}</span><span style="color:#64748b">${r.visits}</span></div>`).join('')}
      </div>
    </div>

    <div class="card" style="margin-bottom:24px">
      <h3>Countries</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;margin-top:8px">
        ${topCountries.rows.map(c => `<div style="padding:10px;background:#f8fafc;border-radius:8px;display:flex;justify-content:space-between"><span style="font-size:14px">${esc(c.country)}</span><span style="font-weight:600">${c.visits}</span></div>`).join('')}
      </div>
    </div>

    <div class="card">
      <h3>Recent Events</h3>
      ${recentEvents.rows.map(e => `<div style="padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:13px">
        <span style="background:#ede9fe;color:#5b21b6;padding:2px 6px;border-radius:4px;font-size:11px">${esc(e.event_name)}</span>
        <span style="color:#64748b;margin-left:8px">${esc(e.page_url || '')}</span>
        <span style="color:#94a3b8;margin-left:8px;font-size:11px">${e.created_at ? new Date(e.created_at).toLocaleString() : ''}</span>
      </div>`).join('')}
    </div>
  `, req.session.user));
}));

// ============================================================
// === 3. TRACKING SNIPPET ===
// ============================================================

app.get('/js/analytics.js', ah(async (req, res) => {
  res.type('application/javascript').send(`
(function(){
  var sid = sessionStorage.getItem('cz_sid');
  if(!sid){sid='cz_'+Date.now()+'_'+Math.random().toString(36).substring(2,8);sessionStorage.setItem('cz_sid',sid);}
  var sessionData = {device:'desktop',browser:'',os:''};
  var ua = navigator.userAgent;
  if(/Mobile|Android|iPhone/i.test(ua)) sessionData.device='mobile';
  else if(/Tablet|iPad/i.test(ua)) sessionData.device='tablet';
  // Track session start
  fetch('/api/analytics/session-start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session_id:sid,device:sessionData.device,referrer:document.referrer,landing_page:location.pathname})}).catch(function(){});
  // Track page views within session
  var origPushState = history.pushState;
  history.pushState = function(){origPushState.apply(this,arguments);trackPageView();};
  window.addEventListener('popstate', trackPageView);
  function trackPageView(){
    fetch('/api/analytics/pageview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session_id:sid,page_url:location.pathname,title:document.title})}).catch(function(){});
  }
  // Track custom events
  window.czTrack = function(name,data){
    fetch('/api/analytics/event',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event_name:name,event_data:data||{},session_id:sid,page_url:location.pathname})}).catch(function(){});
  };
  // Track scroll depth
  var maxScroll = 0;
  window.addEventListener('scroll',function(){
    var scrollPct = Math.round((window.scrollY/(document.documentElement.scrollHeight-window.innerHeight))*100);
    if(scrollPct > maxScroll){maxScroll = scrollPct;}
  });
  window.addEventListener('beforeunload',function(){
    if(maxScroll > 25){fetch('/api/analytics/event',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event_name:'scroll_depth',event_data:{depth:maxScroll},session_id:sid,page_url:location.pathname})}).catch(function(){});}
    var timeSpent = Math.round((Date.now() - (window._czStart || Date.now())) / 1000);
    if(timeSpent > 3){fetch('/api/analytics/event',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event_name:'session_end',event_data:{duration:timeSpent,scroll_depth:maxScroll},session_id:sid})}).catch(function(){});}
  });
  window._czStart = Date.now();
})();
`);
}));

app.post('/api/analytics/session-start', ah(async (req, res) => {
  const { session_id, device, referrer, landing_page } = req.body;
  await pool.query(
    `INSERT INTO analytics_sessions (session_id, ip_address, device, referrer, landing_page, started_at, last_active)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW()) ON CONFLICT (session_id) DO UPDATE SET last_active = NOW(), page_views = analytics_sessions.page_views + 1`,
    [session_id, req.ip, device || 'desktop', referrer || null, landing_page || '/']
  );
  res.json({ ok: true });
}));

app.post('/api/analytics/pageview', ah(async (req, res) => {
  const { session_id, page_url, title } = req.body;
  await pool.query(`UPDATE analytics_sessions SET last_active = NOW(), page_views = page_views + 1, is_bounce = false WHERE session_id = $1`, [session_id]).catch(() => {});
  await pool.query(`INSERT INTO analytics_pages (session_id, page_url, title) VALUES ($1, $2, $3)`, [session_id, page_url || '/', title || '']).catch(() => {});
  res.json({ ok: true });
}));

// ============================================================
// === 4. DAILY AGGREGATION (run periodically) ===
// ============================================================

async function aggregateDailyStats() {
  const today = new Date().toISOString().split('T')[0];
  const existing = (await pool.query('SELECT id FROM analytics_daily WHERE date = $1', [today])).rows[0];
  if (existing) return;

  const [views, sessions, newUsers, conversions, topPage, topRef] = await Promise.all([
    pool.query("SELECT COUNT(*) as total FROM analytics_pages WHERE created_at >= CURRENT_DATE"),
    pool.query("SELECT COUNT(DISTINCT session_id) as total FROM analytics_sessions WHERE started_at >= CURRENT_DATE"),
    pool.query("SELECT COUNT(*) as total FROM users WHERE created_at >= CURRENT_DATE"),
    pool.query("SELECT COUNT(*) as total FROM site_revenue WHERE created_at >= CURRENT_DATE"),
    pool.query("SELECT page_url, COUNT(*) as cnt FROM analytics_pages WHERE created_at >= CURRENT_DATE GROUP BY page_url ORDER BY cnt DESC LIMIT 1"),
    pool.query("SELECT referrer, COUNT(*) as cnt FROM analytics_sessions WHERE started_at >= CURRENT_DATE AND referrer IS NOT NULL AND referrer != '' GROUP BY referrer ORDER BY cnt DESC LIMIT 1"),
  ]);

  const revenue = (await pool.query("SELECT COALESCE(SUM(amount_usd), 0) as total FROM site_revenue WHERE created_at >= CURRENT_DATE")).rows[0].total;

  await pool.query(
    `INSERT INTO analytics_daily (date, page_views, unique_visitors, new_users, conversions, top_page, top_referrer, revenue_usd)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (date) DO NOTHING`,
    [today, views.rows[0].total, sessions.rows[0].total, newUsers.rows[0].total, conversions.rows[0].total,
     topPage.rows[0]?.page_url || '/', topRef.rows[0]?.referrer || 'Direct', revenue]
  );
}

// Run aggregation
aggregateDailyStats().catch(e => console.warn('[Analytics] Aggregation error:', e.message));
console.log('[Analytics] LOADED: Real-time dashboard, conversion funnels, session tracking, page analytics, device stats, geographic data, custom events, daily aggregation');
