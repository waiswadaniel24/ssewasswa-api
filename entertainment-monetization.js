// ============================================================
// ENTERTAINMENT MONETIZATION MODULE — Comfort Zone SaaS
// Subscriptions, PPV, Ads, Creator Revenue, Tips, Merch, Tickets,
// Revenue Dashboard, Affiliates, Transaction History
// ============================================================

const fmtDate = d => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const fmtDT = d => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const genRef = () => 'ENT-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
const genTicketCode = () => 'TCK-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2, 8).toUpperCase();
const ugx = n => `UGX ${Number(n || 0).toLocaleString()}`;

// ============================================================
// DATABASE MIGRATIONS
// ============================================================
const ENT_MONETIZE_MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS ent_monetize_subscriptions (
    id SERIAL PRIMARY KEY, tenant_id INTEGER, user_email TEXT,
    plan TEXT DEFAULT 'free', amount NUMERIC DEFAULT 0,
    status TEXT DEFAULT 'active', started_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ, auto_renew BOOLEAN DEFAULT true
  )`,
  `CREATE TABLE IF NOT EXISTS ent_monetize_ppv_purchases (
    id SERIAL PRIMARY KEY, tenant_id INTEGER, user_email TEXT,
    content_type TEXT, content_id INTEGER, amount NUMERIC,
    purchased_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS ent_monetize_ads (
    id SERIAL PRIMARY KEY, tenant_id INTEGER, name TEXT,
    target_url TEXT, banner_url TEXT, impressions_goal INTEGER,
    budget NUMERIC, impressions INTEGER DEFAULT 0, clicks INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active', start_date DATE, end_date DATE,
    created_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS ent_monetize_creator_revenue (
    id SERIAL PRIMARY KEY, tenant_id INTEGER, creator_email TEXT,
    content_type TEXT, content_id INTEGER, views INTEGER DEFAULT 0,
    likes INTEGER DEFAULT 0, comments INTEGER DEFAULT 0,
    estimated_revenue NUMERIC DEFAULT 0, period TEXT,
    calculated_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS ent_monetize_tips (
    id SERIAL PRIMARY KEY, tenant_id INTEGER, sender_email TEXT,
    receiver_email TEXT, amount NUMERIC, message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS ent_monetize_products (
    id SERIAL PRIMARY KEY, tenant_id INTEGER, name TEXT,
    description TEXT, price NUMERIC, image_url TEXT, category TEXT,
    stock_quantity INTEGER DEFAULT 0, is_active BOOLEAN DEFAULT true,
    created_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS ent_monetize_orders (
    id SERIAL PRIMARY KEY, tenant_id INTEGER, user_email TEXT,
    product_id INTEGER REFERENCES ent_monetize_products(id),
    quantity INTEGER, total NUMERIC, status TEXT DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS ent_monetize_tickets (
    id SERIAL PRIMARY KEY, tenant_id INTEGER, event_id INTEGER,
    user_email TEXT, ticket_type TEXT, price NUMERIC,
    ticket_code TEXT UNIQUE, status TEXT DEFAULT 'valid',
    purchased_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS ent_monetize_transactions (
    id SERIAL PRIMARY KEY, tenant_id INTEGER, user_email TEXT,
    type TEXT, amount NUMERIC, description TEXT,
    status TEXT DEFAULT 'completed', reference TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS ent_monetize_withdrawals (
    id SERIAL PRIMARY KEY, tenant_id INTEGER, user_email TEXT,
    amount NUMERIC, method TEXT, status TEXT DEFAULT 'pending',
    requested_at TIMESTAMPTZ DEFAULT NOW(), processed_at TIMESTAMPTZ
  )`,
  `CREATE TABLE IF NOT EXISTS ent_monetize_affiliates (
    id SERIAL PRIMARY KEY, tenant_id INTEGER, product_name TEXT,
    affiliate_url TEXT, clicks INTEGER DEFAULT 0,
    conversions INTEGER DEFAULT 0, commission NUMERIC DEFAULT 0,
    referred_by TEXT, is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
];

const ENT_MONETIZE_TABLES = [
  'ent_monetize_subscriptions','ent_monetize_ppv_purchases','ent_monetize_ads',
  'ent_monetize_creator_revenue','ent_monetize_tips','ent_monetize_products',
  'ent_monetize_orders','ent_monetize_tickets','ent_monetize_transactions',
  'ent_monetize_withdrawals','ent_monetize_affiliates'
];

module.exports = function(app, pool, opts) {
  const esc = opts.esc;
  const renderPage = opts.renderPage;
  const ah = opts.ah;
  const requireAuth = opts.requireAuth || ((req, res, next) => next());
  const VALID_TABLES = opts.VALID_TABLES || new Set();
  const migrations = opts.migrations || [];

  // Register migrations
  ENT_MONETIZE_MIGRATIONS.forEach(m => { try { migrations.push(m); } catch(e) {} });
  ENT_MONETIZE_TABLES.forEach(t => { try { VALID_TABLES.add(t); } catch(e) {} });

  // Helper: log transaction
  async function logTransaction(tenantId, email, type, amount, desc, status, ref) {
    try {
      await pool.query(
        `INSERT INTO ent_monetize_transactions (tenant_id, user_email, type, amount, description, status, reference) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [tenantId, email, type, amount, desc, status || 'completed', ref || genRef()]
      );
    } catch(e) { /* silent */ }
  }

  const HERO = `background:linear-gradient(135deg,#059669,#10b981)`;

  // ============================================================
  // 1. PREMIUM SUBSCRIPTIONS
  // ============================================================
  const PLANS = [
    { key: 'free', name: 'Free', price: 0, color: '#94a3b8', features: ['Ad-supported streaming', 'Limited content library', 'SD quality only', '1 device'] },
    { key: 'silver', name: 'Silver', price: 50000, color: '#64748b', features: ['Ad-free music streaming', 'Full music library', 'HD audio quality', '2 devices'] },
    { key: 'gold', name: 'Gold', price: 100000, color: '#f59e0b', popular: true, features: ['All content access', 'Ad-free everything', 'Offline downloads', 'HD & 4K quality', '4 devices'] },
    { key: 'platinum', name: 'Platinum', price: 200000, color: '#8b5cf6', features: ['Everything in Gold', 'Early access to new releases', 'Exclusive behind-the-scenes', 'Priority support', 'Unlimited devices', 'Creator meet & greet access'] },
  ];

  app.get('/entertainment/monetize/subscriptions', ah(async (req, res) => {
    const u = req.session?.user;
    let currentPlan = 'free';
    if (u) {
      try {
        const row = (await pool.query(`SELECT plan, status, expires_at FROM ent_monetize_subscriptions WHERE user_email=$1 AND tenant_id=$2 AND status='active' ORDER BY started_at DESC LIMIT 1`, [u.email, u.tenant_id || 0])).rows[0];
        if (row) currentPlan = row.plan;
      } catch(e) {}
    }
    const html = `<div class="hero" style="${HERO};padding:32px;border-radius:16px;margin-bottom:28px;color:white">
      <h1 style="margin:0;font-size:28px">🎵 Premium Subscriptions</h1>
      <p style="opacity:0.9;margin-top:6px;font-size:15px">Choose the plan that fits your entertainment needs</p>
      ${u ? `<div style="margin-top:12px;display:inline-block;background:rgba(255,255,255,0.2);padding:6px 16px;border-radius:20px;font-size:13px;font-weight:600">Current Plan: ${PLANS.find(p=>p.key===currentPlan)?.name || 'Free'}</div>` : ''}
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:20px;max-width:1200px;margin:0 auto">
      ${PLANS.map(p => `
        <div class="card" style="padding:28px;border-radius:16px;border:2px solid ${currentPlan===p.key ? p.color : '#e2e8f0'};position:relative;${p.popular ? 'box-shadow:0 8px 30px rgba(245,158,11,0.15)' : ''}">
          ${p.popular ? '<div style="position:absolute;top:-12px;left:50%;transform:translateX(-50%);background:#f59e0b;color:white;padding:4px 16px;border-radius:12px;font-size:11px;font-weight:700;letter-spacing:1px">MOST POPULAR</div>' : ''}
          <div style="text-align:center;margin-bottom:20px">
            <div style="width:48px;height:48px;border-radius:50%;background:${p.color}20;display:flex;align-items:center;justify-content:center;margin:0 auto 12px"><span style="font-size:24px">${p.key==='free'?'🆓':p.key==='silver'?'🥈':p.key==='gold'?'🥇':'💎'}</span></div>
            <h3 style="margin:0;color:${p.color}">${p.name}</h3>
            <div style="margin-top:8px"><span style="font-size:32px;font-weight:800">${p.price > 0 ? ugx(p.price) : 'Free'}</span>${p.price > 0 ? '<span style="font-size:13px;color:#94a3b8">/month</span>' : ''}</div>
          </div>
          <ul style="list-style:none;padding:0;margin:0 0 20px">
            ${p.features.map(f => `<li style="padding:6px 0;font-size:13px;border-bottom:1px solid #f8fafc;display:flex;gap:8px"><span style="color:#22c55e">✓</span> ${f}</li>`).join('')}
          </ul>
          ${currentPlan === p.key
            ? `<button class="btn" style="width:100%;background:${p.color}20;color:${p.color};border:2px solid ${p.color};cursor:default;font-weight:600">✓ Current Plan</button>`
            : p.key === 'free'
              ? `<button class="btn" style="width:100%;background:#f1f5f9;color:#94a3b8;cursor:default">Downgrade</button>`
              : `<form method="POST" action="/entertainment/monetize/subscriptions/subscribe"><input type="hidden" name="plan" value="${p.key}"><button class="btn btn-green" style="width:100%">Subscribe ${ugx(p.price)}/mo</button></form>`
          }
        </div>`).join('')}
    </div>
    ${!u ? '<p style="text-align:center;margin-top:20px;color:#64748b"><a href="/login" style="color:#059669;font-weight:600">Sign in</a> to manage your subscription</p>' : ''}`;
    res.send(renderPage('Premium Subscriptions', html, u || null));
  }));

  app.post('/entertainment/monetize/subscriptions/subscribe', requireAuth, ah(async (req, res) => {
    const u = req.session.user;
    const { plan } = req.body;
    const planDef = PLANS.find(p => p.key === plan);
    if (!planDef || plan === 'free') return res.redirect('/entertainment/monetize/subscriptions');
    const tid = u.tenant_id || 0;
    const expiresAt = new Date(); expiresAt.setMonth(expiresAt.getMonth() + 1);
    try {
      // Deactivate previous subscriptions
      await pool.query(`UPDATE ent_monetize_subscriptions SET status='cancelled', auto_renew=false WHERE user_email=$1 AND tenant_id=$2 AND status='active'`, [u.email, tid]);
      await pool.query(
        `INSERT INTO ent_monetize_subscriptions (tenant_id, user_email, plan, amount, status, started_at, expires_at, auto_renew) VALUES ($1,$2,$3,$4,'active',NOW(),$5,true) RETURNING id`,
        [tid, u.email, plan, planDef.price, expiresAt]
      );
      await logTransaction(tid, u.email, 'subscription', planDef.price, `${planDef.name} Plan subscription (1 month)`);
    } catch(e) { /* silent */ }
    req.session.toast = { type: 'success', message: `Subscribed to ${planDef.name} plan!` };
    res.redirect('/entertainment/monetize/subscriptions');
  }));

  // ============================================================
  // 2. PAY-PER-VIEW
  // ============================================================
  const PPV_CONTENT = [
    { id: 1, type: 'movie', title: 'Kampala Nights: The Movie', genre: 'Drama', price: 5000, img: '🎬' },
    { id: 2, type: 'concert', title: 'Bobby Wine Live Concert', genre: 'Music', price: 15000, img: '🎤' },
    { id: 3, type: 'comedy', title: 'Uganda Laughs Comedy Special', genre: 'Comedy', price: 8000, img: '😂' },
    { id: 4, type: 'sports', title: 'URA FC vs KCCA FC Derby', genre: 'Sports', price: 10000, img: '⚽' },
    { id: 5, type: 'documentary', title: 'Pearl of Africa Wildlife', genre: 'Documentary', price: 3000, img: '🦁' },
    { id: 6, type: 'movie', title: 'The Last King of Scotland', genre: 'Thriller', price: 7000, img: '🎥' },
  ];

  app.get('/entertainment/monetize/ppv', ah(async (req, res) => {
    const u = req.session?.user;
    const tid = u?.tenant_id || 0;
    let purchased = [];
    if (u) {
      try {
        purchased = (await pool.query(`SELECT content_id FROM ent_monetize_ppv_purchases WHERE user_email=$1 AND tenant_id=$2`, [u.email, tid])).rows.map(r => r.content_id);
      } catch(e) {}
    }
    const html = `<div class="hero" style="${HERO};padding:32px;border-radius:16px;margin-bottom:28px;color:white">
      <h1 style="margin:0;font-size:28px">🎬 Pay-Per-View</h1>
      <p style="opacity:0.9;margin-top:6px;font-size:15px">Premium content available for individual purchase</p>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:20px">
      ${PPV_CONTENT.map(c => {
        const owned = purchased.includes(c.id);
        return `<div class="card" style="overflow:hidden;border-radius:16px">
          <div style="background:linear-gradient(135deg,#0f172a,#1e293b);padding:32px;text-align:center;font-size:56px;position:relative">
            ${c.img}
            ${owned ? '<div style="position:absolute;top:12px;right:12px;background:#22c55e;color:white;padding:4px 12px;border-radius:12px;font-size:11px;font-weight:700">OWNED</div>' : ''}
            <div style="position:absolute;top:12px;left:12px;background:rgba(255,255,255,0.15);color:white;padding:4px 10px;border-radius:8px;font-size:11px;text-transform:uppercase;font-weight:600">${esc(c.genre)}</div>
          </div>
          <div style="padding:20px">
            <h3 style="margin:0 0 4px">${esc(c.title)}</h3>
            <p style="font-size:12px;color:#94a3b8;text-transform:uppercase;margin-bottom:12px">${esc(c.type)}</p>
            ${owned
              ? `<button class="btn btn-green" style="width:100%" onclick="alert('Enjoy your content!')">▶ Watch Now</button>`
              : `<div style="display:flex;justify-content:space-between;align-items:center">
                <span style="font-size:20px;font-weight:800;color:#059669">${ugx(c.price)}</span>
                <form method="POST" action="/entertainment/monetize/ppv/${c.id}/purchase"><button class="btn btn-green">Purchase</button></form>
              </div>`}
          </div>
        </div>`;}).join('')}
    </div>
    ${!u ? '<p style="text-align:center;margin-top:20px;color:#64748b"><a href="/login" style="color:#059669;font-weight:600">Sign in</a> to purchase content</p>' : ''}`;
    res.send(renderPage('Pay-Per-View', html, u || null));
  }));

  app.post('/entertainment/monetize/ppv/:id/purchase', requireAuth, ah(async (req, res) => {
    const u = req.session.user;
    const contentId = parseInt(req.params.id);
    const content = PPV_CONTENT.find(c => c.id === contentId);
    if (!content) return res.status(404).json({ error: 'Content not found' });
    const tid = u.tenant_id || 0;
    try {
      const existing = (await pool.query(`SELECT id FROM ent_monetize_ppv_purchases WHERE user_email=$1 AND tenant_id=$2 AND content_id=$3`, [u.email, tid, contentId])).rows[0];
      if (existing) { req.session.toast = { type: 'info', message: 'You already own this content!' }; return res.redirect('/entertainment/monetize/ppv'); }
      await pool.query(`INSERT INTO ent_monetize_ppv_purchases (tenant_id, user_email, content_type, content_id, amount) VALUES ($1,$2,$3,$4,$5)`, [tid, u.email, content.type, contentId, content.price]);
      await logTransaction(tid, u.email, 'ppv', content.price, `PPV: ${content.title}`);
    } catch(e) { /* silent */ }
    req.session.toast = { type: 'success', message: `Purchased "${content.title}" for ${ugx(content.price)}!` };
    res.redirect('/entertainment/monetize/ppv');
  }));

  // ============================================================
  // 3. AD NETWORK DASHBOARD
  // ============================================================
  app.get('/entertainment/monetize/ads', ah(async (req, res) => {
    const u = req.session?.user;
    const tid = u?.tenant_id || 0;
    let ads = [];
    try { ads = (await pool.query(`SELECT * FROM ent_monetize_ads WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50`, [tid])).rows; } catch(e) {}
    const totalImpressions = ads.reduce((s, a) => s + (a.impressions || 0), 0);
    const totalClicks = ads.reduce((s, a) => s + (a.clicks || 0), 0);
    const totalBudget = ads.reduce((s, a) => s + Number(a.budget || 0), 0);
    const ctr = totalImpressions > 0 ? ((totalClicks / totalImpressions) * 100).toFixed(2) : '0.00';
    const html = `<div class="hero" style="${HERO};padding:32px;border-radius:16px;margin-bottom:28px;color:white">
      <h1 style="margin:0;font-size:28px">📊 Ad Network Dashboard</h1>
      <p style="opacity:0.9;margin-top:6px;font-size:15px">Create and manage advertising campaigns</p>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px">
      <div class="card" style="padding:20px;text-align:center"><div style="font-size:11px;color:#94a3b8;text-transform:uppercase;font-weight:600;margin-bottom:4px">Total Campaigns</div><div style="font-size:28px;font-weight:800">${ads.length}</div></div>
      <div class="card" style="padding:20px;text-align:center"><div style="font-size:11px;color:#94a3b8;text-transform:uppercase;font-weight:600;margin-bottom:4px">Impressions</div><div style="font-size:28px;font-weight:800;color:#3b82f6">${totalImpressions.toLocaleString()}</div></div>
      <div class="card" style="padding:20px;text-align:center"><div style="font-size:11px;color:#94a3b8;text-transform:uppercase;font-weight:600;margin-bottom:4px">Clicks</div><div style="font-size:28px;font-weight:800;color:#22c55e">${totalClicks.toLocaleString()}</div></div>
      <div class="card" style="padding:20px;text-align:center"><div style="font-size:11px;color:#94a3b8;text-transform:uppercase;font-weight:600;margin-bottom:4px">Avg CTR</div><div style="font-size:28px;font-weight:800;color:#f59e0b">${ctr}%</div></div>
      <div class="card" style="padding:20px;text-align:center"><div style="font-size:11px;color:#94a3b8;text-transform:uppercase;font-weight:600;margin-bottom:4px">Total Budget</div><div style="font-size:28px;font-weight:800;color:#8b5cf6">${ugx(totalBudget)}</div></div>
    </div>
    <div class="card" style="margin-bottom:24px;padding:24px">
      <h3 style="margin:0 0 16px">Create Ad Campaign</h3>
      <form method="POST" action="/entertainment/monetize/ads/create" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <input name="name" required placeholder="Campaign name" style="padding:10px;border:1px solid #e2e8f0;border-radius:8px">
        <input name="target_url" required placeholder="Target URL (https://...)" style="padding:10px;border:1px solid #e2e8f0;border-radius:8px">
        <input name="banner_url" placeholder="Banner image URL" style="padding:10px;border:1px solid #e2e8f0;border-radius:8px">
        <input name="impressions_goal" type="number" placeholder="Impressions goal" style="padding:10px;border:1px solid #e2e8f0;border-radius:8px">
        <input name="budget" type="number" step="0.01" placeholder="Budget (UGX)" style="padding:10px;border:1px solid #e2e8f0;border-radius:8px">
        <input name="start_date" type="date" style="padding:10px;border:1px solid #e2e8f0;border-radius:8px">
        <input name="end_date" type="date" style="padding:10px;border:1px solid #e2e8f0;border-radius:8px">
        <button class="btn btn-green" type="submit">Launch Campaign</button>
      </form>
    </div>
    <div class="card"><h3 style="margin:0 0 16px">Active Campaigns</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="border-bottom:2px solid #e2e8f0;text-align:left"><th style="padding:10px">Campaign</th><th style="padding:10px">Impressions</th><th style="padding:10px">Clicks</th><th style="padding:10px">CTR</th><th style="padding:10px">Budget</th><th style="padding:10px">Status</th><th style="padding:10px">Created</th></tr></thead>
        <tbody>${ads.map(a => `<tr style="border-bottom:1px solid #f1f5f9">
          <td style="padding:10px;font-weight:600">${esc(a.name)}</td>
          <td style="padding:10px">${(a.impressions||0).toLocaleString()}</td>
          <td style="padding:10px">${(a.clicks||0).toLocaleString()}</td>
          <td style="padding:10px;color:#f59e0b">${a.impressions > 0 ? ((a.clicks/a.impressions)*100).toFixed(2) : '0.00'}%</td>
          <td style="padding:10px">${ugx(a.budget)}</td>
          <td style="padding:10px"><span style="padding:3px 10px;border-radius:12px;font-size:11px;background:${a.status==='active'?'#dcfce7;color:#166534':'#fef3c7;color:#92400e'}">${a.status}</span></td>
          <td style="padding:10px;color:#94a3b8">${fmtDate(a.created_at)}</td>
        </tr>`).join('')}</tbody>
      </table>
      ${ads.length === 0 ? '<p style="text-align:center;color:#94a3b8;padding:20px">No ad campaigns yet</p>' : ''}
    </div>`;
    res.send(renderPage('Ad Network', html, u || null));
  }));

  app.post('/entertainment/monetize/ads/create', requireAuth, ah(async (req, res) => {
    const u = req.session.user;
    const tid = u.tenant_id || 0;
    const { name, target_url, banner_url, impressions_goal, budget, start_date, end_date } = req.body;
    try {
      await pool.query(
        `INSERT INTO ent_monetize_ads (tenant_id, name, target_url, banner_url, impressions_goal, budget, start_date, end_date, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [tid, name, target_url, banner_url, parseInt(impressions_goal)||10000, parseFloat(budget)||0, start_date, end_date, u.email]
      );
      if (parseFloat(budget) > 0) await logTransaction(tid, u.email, 'ad_campaign', parseFloat(budget), `Ad campaign: ${name}`, 'pending');
    } catch(e) { /* silent */ }
    req.session.toast = { type: 'success', message: 'Ad campaign created!' };
    res.redirect('/entertainment/monetize/ads');
  }));

  // ============================================================
  // 4. CREATOR REVENUE SHARE
  // ============================================================
  app.get('/entertainment/monetize/creators', ah(async (req, res) => {
    const u = req.session?.user;
    const tid = u?.tenant_id || 0;
    let creators = [];
    try {
      creators = (await pool.query(`
        SELECT creator_email,
          SUM(views) as total_views, SUM(likes) as total_likes, SUM(comments) as total_comments,
          SUM(estimated_revenue) as total_revenue, COUNT(DISTINCT content_id) as content_count
        FROM ent_monetize_creator_revenue WHERE tenant_id=$1 GROUP BY creator_email ORDER BY total_revenue DESC LIMIT 50
      `, [tid])).rows;
    } catch(e) {}
    const html = `<div class="hero" style="${HERO};padding:32px;border-radius:16px;margin-bottom:28px;color:white">
      <h1 style="margin:0;font-size:28px">🎤 Creator Revenue Share</h1>
      <p style="opacity:0.9;margin-top:6px;font-size:15px">Track creator earnings and engagement</p>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px">
      <div class="card" style="padding:20px;text-align:center"><div style="font-size:11px;color:#94a3b8;text-transform:uppercase;font-weight:600;margin-bottom:4px">Active Creators</div><div style="font-size:28px;font-weight:800;color:#059669">${creators.length}</div></div>
      <div class="card" style="padding:20px;text-align:center"><div style="font-size:11px;color:#94a3b8;text-transform:uppercase;font-weight:600;margin-bottom:4px">Total Views</div><div style="font-size:28px;font-weight:800;color:#3b82f6">${creators.reduce((s,c)=>s+(c.total_views||0),0).toLocaleString()}</div></div>
      <div class="card" style="padding:20px;text-align:center"><div style="font-size:11px;color:#94a3b8;text-transform:uppercase;font-weight:600;margin-bottom:4px">Total Revenue</div><div style="font-size:28px;font-weight:800;color:#22c55e">${ugx(creators.reduce((s,c)=>s+Number(c.total_revenue||0),0))}</div></div>
    </div>
    <div class="card">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="border-bottom:2px solid #e2e8f0;text-align:left"><th style="padding:10px">Creator</th><th style="padding:10px">Content</th><th style="padding:10px">Views</th><th style="padding:10px">Likes</th><th style="padding:10px">Comments</th><th style="padding:10px">Revenue</th><th style="padding:10px">Details</th></tr></thead>
        <tbody>${creators.map(c => `<tr style="border-bottom:1px solid #f1f5f9">
          <td style="padding:10px;font-weight:600">${esc(c.creator_email)}</td>
          <td style="padding:10px">${c.content_count || 0}</td>
          <td style="padding:10px">${(c.total_views||0).toLocaleString()}</td>
          <td style="padding:10px">${(c.total_likes||0).toLocaleString()}</td>
          <td style="padding:10px">${(c.total_comments||0).toLocaleString()}</td>
          <td style="padding:10px;font-weight:700;color:#059669">${ugx(c.total_revenue)}</td>
          <td style="padding:10px"><a href="/entertainment/monetize/creators/${encodeURIComponent(c.creator_email)}" class="btn btn-sm">View</a></td>
        </tr>`).join('')}</tbody>
      </table>
      ${creators.length === 0 ? '<p style="text-align:center;color:#94a3b8;padding:20px">No creator data yet</p>' : ''}
    </div>`;
    res.send(renderPage('Creator Revenue', html, u || null));
  }));

  app.get('/entertainment/monetize/creators/:email', ah(async (req, res) => {
    const u = req.session?.user;
    const tid = u?.tenant_id || 0;
    const email = req.params.email;
    let revenue = [];
    try {
      revenue = (await pool.query(`SELECT * FROM ent_monetize_creator_revenue WHERE tenant_id=$1 AND creator_email=$2 ORDER BY calculated_at DESC`, [tid, email])).rows;
    } catch(e) {}
    const totalRevenue = revenue.reduce((s, r) => s + Number(r.estimated_revenue || 0), 0);
    const totalViews = revenue.reduce((s, r) => s + (r.views || 0), 0);
    let pendingWithdrawal = 0;
    try {
      pendingWithdrawal = Number((await pool.query(`SELECT COALESCE(SUM(amount),0) as total FROM ent_monetize_withdrawals WHERE tenant_id=$1 AND user_email=$2 AND status='pending'`, [tid, email])).rows[0].total);
    } catch(e) {}
    const availableForWithdrawal = Math.max(0, totalRevenue - pendingWithdrawal);
    const html = `<div class="hero" style="${HERO};padding:28px;border-radius:16px;margin-bottom:24px;color:white">
      <h1 style="margin:0;font-size:24px">🎤 ${esc(email)}</h1>
      <p style="opacity:0.9;margin-top:4px;font-size:14px">Creator Revenue Breakdown</p>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:24px">
      <div class="card" style="padding:20px;text-align:center"><div style="font-size:11px;color:#94a3b8;text-transform:uppercase;margin-bottom:4px">Total Revenue</div><div style="font-size:24px;font-weight:800;color:#059669">${ugx(totalRevenue)}</div></div>
      <div class="card" style="padding:20px;text-align:center"><div style="font-size:11px;color:#94a3b8;text-transform:uppercase;margin-bottom:4px">Total Views</div><div style="font-size:24px;font-weight:800;color:#3b82f6">${totalViews.toLocaleString()}</div></div>
      <div class="card" style="padding:20px;text-align:center"><div style="font-size:11px;color:#94a3b8;text-transform:uppercase;margin-bottom:4px">Available</div><div style="font-size:24px;font-weight:800;color:#8b5cf6">${ugx(availableForWithdrawal)}</div></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px">
      <div class="card" style="padding:20px">
        <h3 style="margin:0 0 12px">Request Withdrawal</h3>
        <form method="POST" action="/entertainment/monetize/creators/${encodeURIComponent(email)}/withdraw" style="display:grid;gap:10px">
          <input name="amount" type="number" step="1" min="1000" placeholder="Amount (min 1,000 UGX)" style="padding:10px;border:1px solid #e2e8f0;border-radius:8px">
          <select name="method" style="padding:10px;border:1px solid #e2e8f0;border-radius:8px"><option value="mobile_money">MTN Mobile Money</option><option value="airtel_money">Airtel Money</option><option value="bank_transfer">Bank Transfer</option></select>
          <button class="btn btn-green" type="submit">Request Withdrawal</button>
        </form>
      </div>
      <div class="card" style="padding:20px">
        <h3 style="margin:0 0 12px">Revenue Formula</h3>
        <div style="font-size:13px;color:#64748b;line-height:2">
          <div><strong>Views:</strong> views × 1 UGX</div>
          <div><strong>Likes:</strong> likes × 5 UGX</div>
          <div><strong>Comments:</strong> comments × 10 UGX</div>
          <div style="margin-top:8px;padding:10px;background:#f0fdf4;border-radius:8px;color:#059669;font-weight:600">Total = (views × 1) + (likes × 5) + (comments × 10)</div>
        </div>
      </div>
    </div>
    <div class="card">
      <h3 style="margin:0 0 12px">Revenue History</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="border-bottom:2px solid #e2e8f0;text-align:left"><th style="padding:8px">Content Type</th><th style="padding:8px">Views</th><th style="padding:8px">Likes</th><th style="padding:8px">Comments</th><th style="padding:8px">Revenue</th><th style="padding:8px">Period</th></tr></thead>
        <tbody>${revenue.map(r => `<tr style="border-bottom:1px solid #f1f5f9">
          <td style="padding:8px">${esc(r.content_type||'—')}</td><td style="padding:8px">${(r.views||0).toLocaleString()}</td>
          <td style="padding:8px">${(r.likes||0).toLocaleString()}</td><td style="padding:8px">${(r.comments||0).toLocaleString()}</td>
          <td style="padding:8px;font-weight:600;color:#059669">${ugx(r.estimated_revenue)}</td><td style="padding:8px;color:#94a3b8">${esc(r.period||'—')}</td>
        </tr>`).join('')}</tbody>
      </table>
      ${revenue.length === 0 ? '<p style="text-align:center;color:#94a3b8;padding:16px">No revenue data yet</p>' : ''}
    </div>`;
    res.send(renderPage('Creator: ' + email, html, u || null));
  }));

  app.post('/entertainment/monetize/creators/:email/withdraw', requireAuth, ah(async (req, res) => {
    const u = req.session.user;
    const tid = u.tenant_id || 0;
    const email = req.params.email;
    const { amount, method } = req.body;
    const amt = parseFloat(amount);
    if (!amt || amt < 1000) { req.session.toast = { type: 'error', message: 'Minimum withdrawal is 1,000 UGX' }; return res.redirect(`/entertainment/monetize/creators/${encodeURIComponent(email)}`); }
    try {
      await pool.query(`INSERT INTO ent_monetize_withdrawals (tenant_id, user_email, amount, method) VALUES ($1,$2,$3,$4)`, [tid, email, amt, method]);
      await logTransaction(tid, email, 'withdrawal', amt, `Withdrawal request via ${method}`, 'pending');
    } catch(e) { /* silent */ }
    req.session.toast = { type: 'success', message: `Withdrawal of ${ugx(amt)} requested!` };
    res.redirect(`/entertainment/monetize/creators/${encodeURIComponent(email)}`);
  }));

  // ============================================================
  // 5. TIPPING & DONATIONS
  // ============================================================
  const PRESET_TIPS = [500, 1000, 2000, 5000];

  app.get('/entertainment/monetize/tip/:creator_email', ah(async (req, res) => {
    const u = req.session?.user;
    const tid = u?.tenant_id || 0;
    const creatorEmail = req.params.creator_email;
    let totalTips = 0;
    let tipCount = 0;
    try {
      const stats = (await pool.query(`SELECT COUNT(*) as cnt, COALESCE(SUM(amount),0) as total FROM ent_monetize_tips WHERE tenant_id=$1 AND receiver_email=$2`, [tid, creatorEmail])).rows[0];
      totalTips = Number(stats.total);
      tipCount = parseInt(stats.cnt);
    } catch(e) {}
    const html = `<div style="max-width:600px;margin:0 auto">
      <div class="hero" style="${HERO};padding:32px;border-radius:16px;margin-bottom:28px;color:white;text-align:center">
        <div style="font-size:56px;margin-bottom:8px">💝</div>
        <h1 style="margin:0;font-size:24px">Support ${esc(creatorEmail)}</h1>
        <p style="opacity:0.9;margin-top:6px;font-size:14px">Show your appreciation with a tip</p>
        <div style="display:flex;gap:24px;justify-content:center;margin-top:16px">
          <div><div style="font-size:20px;font-weight:800">${ugx(totalTips)}</div><div style="font-size:11px;opacity:0.8">Total Received</div></div>
          <div><div style="font-size:20px;font-weight:800">${tipCount}</div><div style="font-size:11px;opacity:0.8">Total Tips</div></div>
        </div>
      </div>
      ${u ? `<div class="card" style="padding:28px;text-align:center">
        <h3 style="margin:0 0 16px">Send a Tip</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">
          ${PRESET_TIPS.map(a => `<button class="btn preset-tip" onclick="document.getElementById('tip-amount').value=${a};highlightTip(this)" style="padding:16px;font-size:16px;font-weight:700;border:2px solid #e2e8f0;border-radius:12px;cursor:pointer">${ugx(a)}</button>`).join('')}
        </div>
        <form method="POST" action="/entertainment/monetize/tip/${encodeURIComponent(creatorEmail)}/send" style="display:grid;gap:12px">
          <input id="tip-amount" name="amount" type="number" min="100" placeholder="Custom amount (min 100 UGX)" style="padding:12px;border:2px solid #e2e8f0;border-radius:10px;font-size:16px;text-align:center">
          <textarea name="message" placeholder="Leave a supportive message (optional)" rows="3" style="padding:10px;border:1px solid #e2e8f0;border-radius:8px;resize:vertical"></textarea>
          <button class="btn btn-green" style="padding:14px;font-size:16px;font-weight:700;border-radius:10px">💝 Send Tip</button>
        </form>
      </div>` : `<div class="card" style="text-align:center;padding:40px"><p style="color:#64748b;margin-bottom:16px">Sign in to send a tip</p><a href="/login" class="btn btn-green">Sign In</a></div>`}
    </div>
    <script>
    function highlightTip(btn){document.querySelectorAll('.preset-tip').forEach(b=>{b.style.borderColor='#e2e8f0';b.style.background='white';b.style.color='#334155'});btn.style.borderColor='#059669';btn.style.background='#ecfdf5';btn.style.color='#059669';}
    </script>`;
    res.send(renderPage('Tip Creator', html, u || null));
  }));

  app.post('/entertainment/monetize/tip/:creator_email/send', requireAuth, ah(async (req, res) => {
    const u = req.session.user;
    const tid = u.tenant_id || 0;
    const creatorEmail = req.params.creator_email;
    const { amount, message } = req.body;
    const amt = parseFloat(amount);
    if (!amt || amt < 100) { req.session.toast = { type: 'error', message: 'Minimum tip is 100 UGX' }; return res.redirect(`/entertainment/monetize/tip/${encodeURIComponent(creatorEmail)}`); }
    try {
      await pool.query(`INSERT INTO ent_monetize_tips (tenant_id, sender_email, receiver_email, amount, message) VALUES ($1,$2,$3,$4,$5)`, [tid, u.email, creatorEmail, amt, message || null]);
      await logTransaction(tid, u.email, 'tip', amt, `Tip to ${creatorEmail}${message ? ': ' + message.substring(0, 50) : ''}`);
    } catch(e) { /* silent */ }
    req.session.toast = { type: 'success', message: `Sent ${ugx(amt)} tip to ${creatorEmail}!` };
    res.redirect(`/entertainment/monetize/tip/${encodeURIComponent(creatorEmail)}`);
  }));

  // ============================================================
  // 6. MERCHANDISE STORE
  // ============================================================
  const CATEGORIES = ['Apparel', 'Accessories', 'Stickers', 'Posters', 'Digital'];

  app.get('/entertainment/monetize/store', ah(async (req, res) => {
    const u = req.session?.user;
    const tid = u?.tenant_id || 0;
    let products = [];
    try { products = (await pool.query(`SELECT * FROM ent_monetize_products WHERE tenant_id=$1 AND is_active=true ORDER BY created_at DESC`, [tid])).rows; } catch(e) {}
    const catFilter = req.query.cat || '';
    const filtered = catFilter ? products.filter(p => p.category === catFilter) : products;
    const html = `<div class="hero" style="${HERO};padding:32px;border-radius:16px;margin-bottom:28px;color:white">
      <h1 style="margin:0;font-size:28px">🛍️ Merchandise Store</h1>
      <p style="opacity:0.9;margin-top:6px;font-size:15px">Official merchandise and digital goods</p>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap">
      <a href="/entertainment/monetize/store" class="btn ${!catFilter?'btn-green':''}" style="text-decoration:none">All</a>
      ${CATEGORIES.map(c => `<a href="/entertainment/monetize/store?cat=${encodeURIComponent(c)}" class="btn ${catFilter===c?'btn-green':''}" style="text-decoration:none">${c}</a>`).join('')}
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:20px">
      ${filtered.map(p => `<div class="card" style="overflow:hidden;border-radius:16px">
        ${p.image_url ? `<div style="height:180px;background:url('${esc(p.image_url)}') center/cover;display:flex;align-items:center;justify-content:center"><span style="font-size:48px;background:rgba(255,255,255,0.9);width:100%;height:100%;display:flex;align-items:center;justify-content:center">👕</span></div>` : `<div style="height:180px;background:linear-gradient(135deg,#f0fdf4,#dcfce7);display:flex;align-items:center;justify-content:center;font-size:56px">👕</div>`}
        <div style="padding:16px">
          <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:6px">
            <span style="font-size:11px;padding:3px 10px;border-radius:8px;background:#f0fdf4;color:#059669;font-weight:600">${esc(p.category)}</span>
            ${p.stock_quantity > 0 ? `<span style="font-size:11px;color:#64748b">${p.stock_quantity} left</span>` : '<span style="font-size:11px;color:#dc2626;font-weight:600">Out of stock</span>'}
          </div>
          <h3 style="margin:4px 0">${esc(p.name)}</h3>
          <p style="font-size:12px;color:#94a3b8;margin-bottom:12px">${esc(p.description || '').substring(0, 80)}${(p.description||'').length > 80 ? '...' : ''}</p>
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span style="font-size:20px;font-weight:800;color:#059669">${ugx(p.price)}</span>
            ${p.stock_quantity > 0 && u ? `<form method="POST" action="/entertainment/monetize/store/${p.id}/buy" style="display:flex;gap:6px;align-items:center">
              <input name="quantity" type="number" value="1" min="1" max="${p.stock_quantity}" style="width:60px;padding:6px;border:1px solid #e2e8f0;border-radius:6px;text-align:center">
              <button class="btn btn-green" type="submit">Buy</button>
            </form>` : p.stock_quantity > 0 ? `<a href="/login" class="btn btn-green" style="text-decoration:none">Login</a>` : '<button class="btn" disabled style="opacity:0.5">Sold Out</button>'}
          </div>
        </div>
      </div>`).join('')}
    </div>
    ${filtered.length === 0 ? '<div class="card" style="text-align:center;padding:40px"><p style="color:#94a3b8">No products available</p></div>' : ''}`;
    res.send(renderPage('Merchandise Store', html, u || null));
  }));

  app.post('/entertainment/monetize/store/:id/buy', requireAuth, ah(async (req, res) => {
    const u = req.session.user;
    const tid = u.tenant_id || 0;
    const productId = parseInt(req.params.id);
    const qty = Math.max(1, parseInt(req.body.quantity) || 1);
    try {
      const product = (await pool.query(`SELECT * FROM ent_monetize_products WHERE id=$1 AND tenant_id=$2 AND is_active=true`, [productId, tid])).rows[0];
      if (!product) { req.session.toast = { type: 'error', message: 'Product not found' }; return res.redirect('/entertainment/monetize/store'); }
      if (product.stock_quantity < qty) { req.session.toast = { type: 'error', message: 'Insufficient stock' }; return res.redirect('/entertainment/monetize/store'); }
      const total = Number(product.price) * qty;
      await pool.query(`INSERT INTO ent_monetize_orders (tenant_id, user_email, product_id, quantity, total, status) VALUES ($1,$2,$3,$4,$5,'completed')`, [tid, u.email, productId, qty, total]);
      await pool.query(`UPDATE ent_monetize_products SET stock_quantity = stock_quantity - $1 WHERE id=$2`, [qty, productId]);
      await logTransaction(tid, u.email, 'merch', total, `Order: ${product.name} × ${qty}`);
    } catch(e) { /* silent */ }
    req.session.toast = { type: 'success', message: 'Order placed successfully!' };
    res.redirect('/entertainment/monetize/store');
  }));

  // ============================================================
  // 7. EVENT TICKET SALES
  // ============================================================
  const SAMPLE_EVENTS = [
    { id: 1, name: 'Pearl Rhythm Festival', date: '2025-08-15', venue: 'National Theatre, Kampala', tiers: [{ type: 'VIP', price: 100000, available: 50 }, { type: 'Regular', price: 35000, available: 500 }, { type: 'Student', price: 15000, available: 200 }] },
    { id: 2, name: 'Comedy Night Uganda', date: '2025-07-20', venue: 'Serena Hotel, Kampala', tiers: [{ type: 'VIP', price: 75000, available: 30 }, { type: 'Regular', price: 25000, available: 150 }] },
    { id: 3, name: 'Afro Beats Live', date: '2025-09-10', venue: 'Colline Hotel, Mukono', tiers: [{ type: 'VIP', price: 120000, available: 40 }, { type: 'Regular', price: 40000, available: 300 }, { type: 'Student', price: 20000, available: 100 }] },
  ];

  app.get('/entertainment/monetize/events', ah(async (req, res) => {
    const u = req.session?.user;
    const tid = u?.tenant_id || 0;
    let purchasedTickets = [];
    if (u) {
      try { purchasedTickets = (await pool.query(`SELECT event_id, ticket_type FROM ent_monetize_tickets WHERE user_email=$1 AND tenant_id=$2`, [u.email, tid])).rows; } catch(e) {}
    }
    const html = `<div class="hero" style="${HERO};padding:32px;border-radius:16px;margin-bottom:28px;color:white">
      <h1 style="margin:0;font-size:28px">🎫 Event Tickets</h1>
      <p style="opacity:0.9;margin-top:6px;font-size:15px">Get your tickets to the hottest events</p>
    </div>
    <div style="display:grid;gap:24px;max-width:900px;margin:0 auto">
      ${SAMPLE_EVENTS.map(ev => `<div class="card" style="overflow:hidden;border-radius:16px">
        <div style="display:grid;grid-template-columns:120px 1fr;min-height:140px">
          <div style="background:linear-gradient(135deg,#0f172a,#1e293b);color:white;display:flex;flex-direction:column;align-items:center;justify-content:center">
            <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;opacity:0.7">${new Date(ev.date).toLocaleDateString('en-GB',{month:'short'})}</div>
            <div style="font-size:36px;font-weight:900;line-height:1">${new Date(ev.date).getDate()}</div>
            <div style="font-size:11px;opacity:0.7">${new Date(ev.date).getFullYear()}</div>
          </div>
          <div style="padding:20px">
            <h3 style="margin:0 0 6px;font-size:18px">${esc(ev.name)}</h3>
            <p style="font-size:13px;color:#64748b;margin-bottom:14px">📍 ${esc(ev.venue)}</p>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px">
              ${ev.tiers.map(t => {
                const owned = purchasedTickets.some(pt => pt.event_id === ev.id && pt.ticket_type === t.type);
                return `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px">
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                    <span style="font-weight:700;font-size:13px;color:${t.type==='VIP'?'#8b5cf6':'#334155'}">${t.type}</span>
                    <span style="font-size:12px;color:#94a3b8">${t.available} seats</span>
                  </div>
                  <div style="font-size:18px;font-weight:800;color:#059669;margin-bottom:8px">${ugx(t.price)}</div>
                  ${owned ? `<span style="display:block;text-align:center;padding:6px;background:#dcfce7;color:#166534;border-radius:6px;font-size:12px;font-weight:600">✓ Purchased</span>`
                    : u ? `<form method="POST" action="/entertainment/monetize/events/${ev.id}/buy-ticket"><input type="hidden" name="ticket_type" value="${t.type}"><input type="hidden" name="price" value="${t.price}"><button class="btn btn-green" style="width:100%;padding:8px;font-size:12px">Buy Ticket</button></form>`
                    : `<a href="/login" class="btn btn-green" style="display:block;text-align:center;padding:8px;font-size:12px;text-decoration:none">Login</a>`}
                </div>`;
              }).join('')}
            </div>
          </div>
        </div>
      </div>`).join('')}
    </div>`;
    res.send(renderPage('Event Tickets', html, u || null));
  }));

  app.post('/entertainment/monetize/events/:id/buy-ticket', requireAuth, ah(async (req, res) => {
    const u = req.session.user;
    const tid = u.tenant_id || 0;
    const eventId = parseInt(req.params.id);
    const { ticket_type, price } = req.body;
    const event = SAMPLE_EVENTS.find(e => e.id === eventId);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    const ticketCode = genTicketCode();
    try {
      await pool.query(`INSERT INTO ent_monetize_tickets (tenant_id, event_id, user_email, ticket_type, price, ticket_code) VALUES ($1,$2,$3,$4,$5,$6)`,
        [tid, eventId, u.email, ticket_type, parseFloat(price), ticketCode]);
      await logTransaction(tid, u.email, 'ticket', parseFloat(price), `Event ticket: ${event.name} (${ticket_type})`, 'completed', ticketCode);
    } catch(e) { /* silent */ }
    req.session.toast = { type: 'success', message: `Ticket purchased! Code: ${ticketCode}` };
    res.redirect('/entertainment/monetize/events');
  }));

  // ============================================================
  // 8. REVENUE DASHBOARD
  // ============================================================
  app.get('/entertainment/monetize/dashboard', ah(async (req, res) => {
    const u = req.session?.user;
    const tid = u?.tenant_id || 0;
    let transactions = [];
    try { transactions = (await pool.query(`SELECT type, amount, created_at FROM ent_monetize_transactions WHERE tenant_id=$1 AND status='completed' ORDER BY created_at DESC`, [tid])).rows; } catch(e) {}
    const totalRevenue = transactions.reduce((s, t) => s + Number(t.amount || 0), 0);

    // Revenue by source
    const bySource = {};
    transactions.forEach(t => { bySource[t.type] = (bySource[t.type] || 0) + Number(t.amount || 0); });

    // Monthly trend (last 6 months)
    const monthlyData = {};
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
      monthlyData[key] = 0;
    }
    transactions.forEach(t => {
      const d = new Date(t.created_at);
      const key = d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
      if (monthlyData[key] !== undefined) monthlyData[key] += Number(t.amount || 0);
    });

    const sourceLabels = { subscription: 'Subscriptions', ppv: 'Pay-Per-View', ad_campaign: 'Ads', tip: 'Tips', merch: 'Merchandise', ticket: 'Tickets', affiliate: 'Affiliates' };
    const sourceColors = { subscription: '#8b5cf6', ppv: '#3b82f6', ad_campaign: '#f59e0b', tip: '#ec4899', merch: '#22c55e', ticket: '#06b6d4', affiliate: '#f97316' };
    const maxMonthly = Math.max(...Object.values(monthlyData), 1);

    const recentTx = transactions.slice(0, 15);
    const html = `<div class="hero" style="${HERO};padding:32px;border-radius:16px;margin-bottom:28px;color:white">
      <h1 style="margin:0;font-size:28px">💰 Revenue Dashboard</h1>
      <p style="opacity:0.9;margin-top:6px;font-size:15px">Financial overview and analytics</p>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-bottom:24px">
      <div class="card" style="padding:24px;text-align:center;border-left:4px solid #22c55e">
        <div style="font-size:11px;color:#94a3b8;text-transform:uppercase;font-weight:600;margin-bottom:6px">Total Revenue</div>
        <div style="font-size:32px;font-weight:900;color:#059669">${ugx(totalRevenue)}</div>
      </div>
      <div class="card" style="padding:24px;text-align:center;border-left:4px solid #3b82f6">
        <div style="font-size:11px;color:#94a3b8;text-transform:uppercase;font-weight:600;margin-bottom:6px">Transactions</div>
        <div style="font-size:32px;font-weight:900;color:#3b82f6">${transactions.length}</div>
      </div>
      <div class="card" style="padding:24px;text-align:center;border-left:4px solid #8b5cf6">
        <div style="font-size:11px;color:#94a3b8;text-transform:uppercase;font-weight:600;margin-bottom:6px">Avg. Transaction</div>
        <div style="font-size:32px;font-weight:900;color:#8b5cf6">${ugx(transactions.length > 0 ? totalRevenue / transactions.length : 0)}</div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px">
      <div class="card" style="padding:24px">
        <h3 style="margin:0 0 16px">Revenue by Source</h3>
        ${Object.keys(bySource).length > 0 ? Object.entries(bySource).sort((a,b)=>b[1]-a[1]).map(([type, amount]) => {
          const pct = totalRevenue > 0 ? (amount / totalRevenue * 100) : 0;
          return `<div style="margin-bottom:12px">
            <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px">
              <span style="font-weight:600">${sourceLabels[type] || type}</span>
              <span style="color:#059669;font-weight:700">${ugx(amount)} (${pct.toFixed(1)}%)</span>
            </div>
            <div style="background:#f1f5f9;border-radius:8px;height:10px;overflow:hidden"><div style="height:100%;background:${sourceColors[type] || '#94a3b8'};width:${pct}%;border-radius:8px;transition:width .3s"></div></div>
          </div>`;
        }).join('') : '<p style="color:#94a3b8;text-align:center;padding:16px">No revenue data</p>'}
      </div>
      <div class="card" style="padding:24px">
        <h3 style="margin:0 0 16px">Monthly Trend</h3>
        <div style="display:flex;align-items:end;gap:8px;height:160px;padding-top:10px">
          ${Object.entries(monthlyData).map(([month, amount]) => {
            const h = Math.max(4, (amount / maxMonthly) * 130);
            return `<div style="flex:1;text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:end;height:100%">
              <div style="font-size:10px;color:#64748b;margin-bottom:4px">${amount > 0 ? (amount / 1000).toFixed(0) + 'K' : ''}</div>
              <div style="width:100%;max-width:40px;height:${h}px;background:linear-gradient(180deg,#059669,#10b981);border-radius:6px 6px 2px 2px;transition:height .3s"></div>
              <div style="font-size:10px;color:#94a3b8;margin-top:6px;font-weight:600">${month}</div>
            </div>`;
          }).join('')}
        </div>
      </div>
    </div>

    <div class="card">
      <h3 style="margin:0 0 12px">Recent Transactions</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="border-bottom:2px solid #e2e8f0;text-align:left"><th style="padding:10px">Type</th><th style="padding:10px">Amount</th><th style="padding:10px">Date</th></tr></thead>
        <tbody>${recentTx.map(t => `<tr style="border-bottom:1px solid #f1f5f9">
          <td style="padding:10px"><span style="padding:3px 10px;border-radius:8px;font-size:11px;background:${(sourceColors[t.type]||'#94a3b8')}20;color:${sourceColors[t.type]||'#94a3b8'};font-weight:600">${sourceLabels[t.type] || t.type}</span></td>
          <td style="padding:10px;font-weight:700;color:#059669">${ugx(t.amount)}</td>
          <td style="padding:10px;color:#94a3b8">${fmtDT(t.created_at)}</td>
        </tr>`).join('')}</tbody>
      </table>
      ${recentTx.length === 0 ? '<p style="text-align:center;color:#94a3b8;padding:20px">No transactions yet</p>' : ''}
    </div>`;
    res.send(renderPage('Revenue Dashboard', html, u || null));
  }));

  // ============================================================
  // 9. AFFILIATE MARKETPLACE
  // ============================================================
  const SAMPLE_AFFILIATES = [
    { id: 1, product: 'Premium Headphones', description: 'Noise-cancelling wireless headphones', price: 250000, commission: 25000, url: 'https://shop.example.com/headphones' },
    { id: 2, product: 'Music Streaming Device', description: 'Hi-fi portable music player', price: 180000, commission: 18000, url: 'https://shop.example.com/player' },
    { id: 3, product: 'Concert Merch Bundle', description: 'Limited edition tour merchandise', price: 85000, commission: 8500, url: 'https://shop.example.com/bundle' },
    { id: 4, product: 'Guitar Starter Kit', description: 'Acoustic guitar with accessories', price: 350000, commission: 35000, url: 'https://shop.example.com/guitar' },
    { id: 5, product: 'Studio Microphone', description: 'Professional recording microphone', price: 450000, commission: 45000, url: 'https://shop.example.com/mic' },
    { id: 6, product: 'Vinyl Record Collection', description: 'Curated vinyl record box set', price: 120000, commission: 12000, url: 'https://shop.example.com/vinyl' },
  ];

  app.get('/entertainment/monetize/affiliates', ah(async (req, res) => {
    const u = req.session?.user;
    const tid = u?.tenant_id || 0;
    let affiliates = [];
    try { affiliates = (await pool.query(`SELECT * FROM ent_monetize_affiliates WHERE tenant_id=$1 ORDER BY created_at DESC`, [tid])).rows; } catch(e) {}

    const totalClicks = affiliates.reduce((s, a) => s + (a.clicks || 0), 0);
    const totalConversions = affiliates.reduce((s, a) => s + (a.conversions || 0), 0);
    const totalCommission = affiliates.reduce((s, a) => s + Number(a.commission || 0), 0);

    const html = `<div class="hero" style="${HERO};padding:32px;border-radius:16px;margin-bottom:28px;color:white">
      <h1 style="margin:0;font-size:28px">🔗 Affiliate Marketplace</h1>
      <p style="opacity:0.9;margin-top:6px;font-size:15px">Earn commissions through product recommendations</p>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:24px">
      <div class="card" style="padding:20px;text-align:center"><div style="font-size:11px;color:#94a3b8;text-transform:uppercase;margin-bottom:4px">Total Clicks</div><div style="font-size:28px;font-weight:800;color:#3b82f6">${totalClicks.toLocaleString()}</div></div>
      <div class="card" style="padding:20px;text-align:center"><div style="font-size:11px;color:#94a3b8;text-transform:uppercase;margin-bottom:4px">Conversions</div><div style="font-size:28px;font-weight:800;color:#22c55e">${totalConversions.toLocaleString()}</div></div>
      <div class="card" style="padding:20px;text-align:center"><div style="font-size:11px;color:#94a3b8;text-transform:uppercase;margin-bottom:4px">Conv. Rate</div><div style="font-size:28px;font-weight:800;color:#f59e0b">${totalClicks > 0 ? ((totalConversions / totalClicks) * 100).toFixed(1) : '0.0'}%</div></div>
      <div class="card" style="padding:20px;text-align:center"><div style="font-size:11px;color:#94a3b8;text-transform:uppercase;margin-bottom:4px">Commission Earned</div><div style="font-size:28px;font-weight:800;color:#059669">${ugx(totalCommission)}</div></div>
    </div>

    <h3 style="margin:0 0 16px">Recommended Products</h3>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;margin-bottom:32px">
      ${SAMPLE_AFFILIATES.map(p => `<div class="card" style="padding:20px;border-radius:12px;border:1px solid #e2e8f0">
        <div style="display:flex;gap:12px;margin-bottom:12px">
          <div style="width:56px;height:56px;border-radius:10px;background:linear-gradient(135deg,#f0fdf4,#dcfce7);display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0">🎵</div>
          <div><h3 style="margin:0;font-size:15px">${esc(p.product)}</h3><p style="font-size:12px;color:#64748b;margin:2px 0 0">${esc(p.description)}</p></div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <span style="font-size:18px;font-weight:800">${ugx(p.price)}</span>
          <span style="font-size:12px;padding:4px 10px;background:#dcfce7;color:#166534;border-radius:8px;font-weight:600">Earn ${ugx(p.commission)}</span>
        </div>
        ${u ? `<form method="POST" action="/entertainment/monetize/affiliates/${p.id}/click" target="_blank"><input type="hidden" name="url" value="${esc(p.url)}"><button class="btn btn-green" style="width:100%" type="submit">🔗 Get Affiliate Link</button></form>` : '<a href="/login" class="btn btn-green" style="display:block;text-align:center;text-decoration:none">Login</a>'}
      </div>`).join('')}
    </div>

    ${affiliates.length > 0 ? `<div class="card"><h3 style="margin:0 0 12px">Your Affiliate Performance</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="border-bottom:2px solid #e2e8f0;text-align:left"><th style="padding:10px">Product</th><th style="padding:10px">Clicks</th><th style="padding:10px">Conversions</th><th style="padding:10px">Commission</th><th style="padding:10px">Status</th></tr></thead>
        <tbody>${affiliates.map(a => `<tr style="border-bottom:1px solid #f1f5f9">
          <td style="padding:10px;font-weight:600">${esc(a.product_name)}</td>
          <td style="padding:10px">${(a.clicks||0).toLocaleString()}</td>
          <td style="padding:10px">${a.conversions||0}</td>
          <td style="padding:10px;font-weight:700;color:#059669">${ugx(a.commission)}</td>
          <td style="padding:10px"><span style="padding:3px 10px;border-radius:12px;font-size:11px;background:${a.is_active?'#dcfce7;color:#166534':'#f1f5f9;color:#94a3b8'}">${a.is_active?'Active':'Inactive'}</span></td>
        </tr>`).join('')}</tbody>
      </table>
    </div>` : ''}`;
    res.send(renderPage('Affiliate Marketplace', html, u || null));
  }));

  app.post('/entertainment/monetize/affiliates/:id/click', requireAuth, ah(async (req, res) => {
    const u = req.session.user;
    const tid = u.tenant_id || 0;
    const affId = parseInt(req.params.id);
    const product = SAMPLE_AFFILIATES.find(p => p.id === affId);
    if (!product) return res.redirect('/entertainment/monetize/affiliates');
    try {
      const existing = (await pool.query(`SELECT id FROM ent_monetize_affiliates WHERE tenant_id=$1 AND product_name=$2 AND referred_by=$3`, [tid, product.product, u.email])).rows[0];
      if (existing) {
        await pool.query(`UPDATE ent_monetize_affiliates SET clicks = clicks + 1 WHERE id=$1`, [existing.id]);
      } else {
        await pool.query(`INSERT INTO ent_monetize_affiliates (tenant_id, product_name, affiliate_url, clicks, conversions, commission, referred_by) VALUES ($1,$2,$3,1,0,0,$4)`, [tid, product.product, product.url, u.email]);
      }
    } catch(e) { /* silent */ }
    res.redirect(product.url);
  }));

  // ============================================================
  // 10. TRANSACTION HISTORY
  // ============================================================
  app.get('/entertainment/monetize/transactions', ah(async (req, res) => {
    const u = req.session?.user;
    const tid = u?.tenant_id || 0;
    if (!u) return res.redirect('/login');

    const filterType = req.query.type || '';
    const filterStatus = req.query.status || '';
    const filterFrom = req.query.from || '';
    const filterTo = req.query.to || '';

    let where = ['tenant_id = $1'];
    const params = [tid];
    if (filterType) { where.push(`type = $${params.length + 1}`); params.push(filterType); }
    if (filterStatus) { where.push(`status = $${params.length + 1}`); params.push(filterStatus); }
    if (filterFrom) { where.push(`created_at >= $${params.length + 1}`); params.push(filterFrom); }
    if (filterTo) { where.push(`created_at <= $${params.length + 1}`); params.push(filterTo + ' 23:59:59'); }

    let transactions = [];
    let total = 0;
    try {
      transactions = (await pool.query(`SELECT * FROM ent_monetize_transactions WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT 200`, params)).rows;
      total = transactions.reduce((s, t) => s + Number(t.amount || 0), 0);
    } catch(e) {}

    const sourceLabels = { subscription: 'Subscription', ppv: 'Pay-Per-View', ad_campaign: 'Ad Campaign', tip: 'Tip', merch: 'Merchandise', ticket: 'Ticket', withdrawal: 'Withdrawal', affiliate: 'Affiliate' };
    const txTypes = ['subscription', 'ppv', 'ad_campaign', 'tip', 'merch', 'ticket', 'withdrawal', 'affiliate'];
    const statusColors = { completed: '#dcfce7;color:#166534', pending: '#fef3c7;color:#92400e', failed: '#fee2e2;color:#991b1b' };

    const html = `<div class="hero" style="${HERO};padding:32px;border-radius:16px;margin-bottom:28px;color:white">
      <h1 style="margin:0;font-size:28px">📋 Transaction History</h1>
      <p style="opacity:0.9;margin-top:6px;font-size:15px">${transactions.length} transaction(s) · Total: ${ugx(total)}</p>
    </div>

    <div class="card" style="padding:20px;margin-bottom:20px">
      <form method="GET" action="/entertainment/monetize/transactions" style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr auto;gap:10px;align-items:end">
        <div><label style="font-size:11px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Type</label><select name="type" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px">
          <option value="">All Types</option>${txTypes.map(t => `<option value="${t}" ${filterType===t?'selected':''}>${sourceLabels[t]||t}</option>`).join('')}
        </select></div>
        <div><label style="font-size:11px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Status</label><select name="status" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px">
          <option value="">All</option><option value="completed" ${filterStatus==='completed'?'selected':''}>Completed</option><option value="pending" ${filterStatus==='pending'?'selected':''}>Pending</option><option value="failed" ${filterStatus==='failed'?'selected':''}>Failed</option>
        </select></div>
        <div><label style="font-size:11px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">From</label><input name="from" type="date" value="${esc(filterFrom)}" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></div>
        <div><label style="font-size:11px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">To</label><input name="to" type="date" value="${esc(filterTo)}" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></div>
        <button class="btn btn-green" type="submit">Filter</button>
      </form>
      ${(filterType || filterStatus || filterFrom || filterTo) ? '<div style="margin-top:10px"><a href="/entertainment/monetize/transactions" style="font-size:12px;color:#64748b;text-decoration:none">✕ Clear filters</a></div>' : ''}
    </div>

    <div class="card" style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:13px;min-width:700px">
        <thead><tr style="border-bottom:2px solid #e2e8f0;text-align:left">
          <th style="padding:10px">Ref</th><th style="padding:10px">Type</th><th style="padding:10px">Description</th>
          <th style="padding:10px">Amount</th><th style="padding:10px">Status</th><th style="padding:10px">Date</th>
        </tr></thead>
        <tbody>${transactions.map(t => `<tr style="border-bottom:1px solid #f1f5f9">
          <td style="padding:10px;font-family:monospace;font-size:11px;color:#64748b">${esc(t.reference || '—')}</td>
          <td style="padding:10px"><span style="padding:3px 10px;border-radius:8px;font-size:11px;font-weight:600;background:#f1f5f9">${sourceLabels[t.type] || t.type}</span></td>
          <td style="padding:10px;max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.description || '—')}</td>
          <td style="padding:10px;font-weight:700;color:${t.type==='withdrawal'?'#dc2626':'#059669'}">${t.type==='withdrawal'?'-':'+'}${ugx(t.amount)}</td>
          <td style="padding:10px"><span style="padding:3px 10px;border-radius:12px;font-size:11px;background:${statusColors[t.status]||'#f1f5f9;color:#94a3b8'}">${t.status}</span></td>
          <td style="padding:10px;color:#94a3b8;white-space:nowrap">${fmtDT(t.created_at)}</td>
        </tr>`).join('')}</tbody>
      </table>
      ${transactions.length === 0 ? '<p style="text-align:center;color:#94a3b8;padding:24px">No transactions found</p>' : ''}
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-top:20px">
      <a href="/entertainment/monetize/dashboard" class="btn" style="text-decoration:none;text-align:center">📊 Revenue Dashboard</a>
      <a href="/entertainment/monetize/subscriptions" class="btn" style="text-decoration:none;text-align:center">🎵 Subscriptions</a>
      <a href="/entertainment/monetize/store" class="btn" style="text-decoration:none;text-align:center">🛍️ Store</a>
    </div>`;
    res.send(renderPage('Transactions', html, u));
  }));

  // ============================================================
  // NAVIGATION SIDEBAR LINKS
  // ============================================================
  app.get('/entertainment/monetize', ah(async (req, res) => {
    const u = req.session?.user;
    const html = `<div class="hero" style="${HERO};padding:40px;border-radius:16px;margin-bottom:32px;color:white;text-align:center">
      <h1 style="margin:0;font-size:32px">💰 Entertainment Monetization</h1>
      <p style="opacity:0.9;margin-top:8px;font-size:16px;max-width:600px;margin-left:auto;margin-right:auto">Complete revenue platform for content creators, advertisers, and entertainment businesses</p>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:20px;max-width:1100px;margin:0 auto">
      <a href="/entertainment/monetize/subscriptions" class="card" style="text-decoration:none;padding:28px;border-radius:16px;display:block;transition:transform .2s;cursor:pointer">
        <div style="font-size:36px;margin-bottom:12px">🎵</div><h3 style="margin:0 0 6px;color:#334155">Subscriptions</h3><p style="font-size:13px;color:#64748b;margin:0">Premium plans — Free, Silver, Gold, Platinum</p></a>
      <a href="/entertainment/monetize/ppv" class="card" style="text-decoration:none;padding:28px;border-radius:16px;display:block;transition:transform .2s;cursor:pointer">
        <div style="font-size:36px;margin-bottom:12px">🎬</div><h3 style="margin:0 0 6px;color:#334155">Pay-Per-View</h3><p style="font-size:13px;color:#64748b;margin:0">Premium content purchases</p></a>
      <a href="/entertainment/monetize/ads" class="card" style="text-decoration:none;padding:28px;border-radius:16px;display:block;transition:transform .2s;cursor:pointer">
        <div style="font-size:36px;margin-bottom:12px">📊</div><h3 style="margin:0 0 6px;color:#334155">Ad Network</h3><p style="font-size:13px;color:#64748b;margin:0">Create and manage ad campaigns</p></a>
      <a href="/entertainment/monetize/creators" class="card" style="text-decoration:none;padding:28px;border-radius:16px;display:block;transition:transform .2s;cursor:pointer">
        <div style="font-size:36px;margin-bottom:12px">🎤</div><h3 style="margin:0 0 6px;color:#334155">Creator Revenue</h3><p style="font-size:13px;color:#64748b;margin:0">Track creator earnings and engagement</p></a>
      <a href="/entertainment/monetize/tip/example@creator.com" class="card" style="text-decoration:none;padding:28px;border-radius:16px;display:block;transition:transform .2s;cursor:pointer">
        <div style="font-size:36px;margin-bottom:12px">💝</div><h3 style="margin:0 0 6px;color:#334155">Tipping</h3><p style="font-size:13px;color:#64748b;margin:0">Support creators with tips</p></a>
      <a href="/entertainment/monetize/store" class="card" style="text-decoration:none;padding:28px;border-radius:16px;display:block;transition:transform .2s;cursor:pointer">
        <div style="font-size:36px;margin-bottom:12px">🛍️</div><h3 style="margin:0 0 6px;color:#334155">Merchandise Store</h3><p style="font-size:13px;color:#64748b;margin:0">Official merchandise and digital goods</p></a>
      <a href="/entertainment/monetize/events" class="card" style="text-decoration:none;padding:28px;border-radius:16px;display:block;transition:transform .2s;cursor:pointer">
        <div style="font-size:36px;margin-bottom:12px">🎫</div><h3 style="margin:0 0 6px;color:#334155">Event Tickets</h3><p style="font-size:13px;color:#64748b;margin:0">VIP, Regular, and Student tickets</p></a>
      <a href="/entertainment/monetize/dashboard" class="card" style="text-decoration:none;padding:28px;border-radius:16px;display:block;transition:transform .2s;cursor:pointer">
        <div style="font-size:36px;margin-bottom:12px">💰</div><h3 style="margin:0 0 6px;color:#334155">Revenue Dashboard</h3><p style="font-size:13px;color:#64748b;margin:0">Financial overview and analytics</p></a>
      <a href="/entertainment/monetize/affiliates" class="card" style="text-decoration:none;padding:28px;border-radius:16px;display:block;transition:transform .2s;cursor:pointer">
        <div style="font-size:36px;margin-bottom:12px">🔗</div><h3 style="margin:0 0 6px;color:#334155">Affiliate Marketplace</h3><p style="font-size:13px;color:#64748b;margin:0">Earn commissions on referrals</p></a>
      <a href="/entertainment/monetize/transactions" class="card" style="text-decoration:none;padding:28px;border-radius:16px;display:block;transition:transform .2s;cursor:pointer">
        <div style="font-size:36px;margin-bottom:12px">📋</div><h3 style="margin:0 0 6px;color:#334155">Transactions</h3><p style="font-size:13px;color:#64748b;margin:0">Complete transaction history with filters</p></a>
    </div>`;
    res.send(renderPage('Entertainment Monetization', html, u || null));
  }));
};
