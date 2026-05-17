// ============================================================
// === ULTIMATE MONETIZATION ENGINE — Earn From Everything ===
// ============================================================
// Auto-ads, exit popups, social proof, affiliate cloaker, donations,
// premium content lock, sitemap/robots SEO, revenue dashboard,
// promo codes, landing pages, push notifications, comment system,
// floating CTA bar, cookie consent, featured listings, tips system,
// A/B testing, engagement scoring, reward wall, lead magnets

// ============================================================
// === DATABASE MIGRATIONS ===
// ============================================================
const MONETIZATION_MIGRATIONS = [
  // Ad Banner Management
  `CREATE TABLE IF NOT EXISTS ad_banners (
    id SERIAL PRIMARY KEY, tenant_id INTEGER DEFAULT NULL,
    title TEXT NOT NULL, placement TEXT NOT NULL DEFAULT 'sidebar',
    ad_type TEXT DEFAULT 'banner', image_url TEXT, link_url TEXT,
    html_content TEXT, is_active BOOLEAN DEFAULT true,
    impressions INTEGER DEFAULT 0, clicks INTEGER DEFAULT 0,
    revenue_usd NUMERIC DEFAULT 0, cpm_rate NUMERIC DEFAULT 2.00,
    priority INTEGER DEFAULT 0, target_pages TEXT[] DEFAULT '{}',
    start_date DATE, end_date DATE,
    advertiser_name TEXT, advertiser_email TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS ad_impressions (
    id SERIAL PRIMARY KEY, ad_id INTEGER REFERENCES ad_banners(id) ON DELETE CASCADE,
    ip_address TEXT, page_url TEXT, user_agent TEXT,
    country TEXT DEFAULT 'UG', created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  // Exit Intent Popup Captures
  `CREATE TABLE IF NOT EXISTS exit_captures (
    id SERIAL PRIMARY KEY, email TEXT NOT NULL, name TEXT,
    page_url TEXT, ip_address TEXT, source TEXT DEFAULT 'exit_intent',
    converted BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(email, source)
  )`,
  // Social Proof Notifications
  `CREATE TABLE IF NOT EXISTS social_proof_events (
    id SERIAL PRIMARY KEY, event_type TEXT NOT NULL,
    user_name TEXT, user_location TEXT, action TEXT,
    display_text TEXT, is_active BOOLEAN DEFAULT true,
    weight INTEGER DEFAULT 1, created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  // Affiliate Link Cloaker
  `CREATE TABLE IF NOT EXISTS cloaked_links (
    id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
    slug TEXT UNIQUE NOT NULL, destination_url TEXT NOT NULL,
    title TEXT, description TEXT, clicks INTEGER DEFAULT 0,
    conversions INTEGER DEFAULT 0, revenue NUMERIC DEFAULT 0,
    utm_source TEXT DEFAULT 'comfortzone',
    utm_medium TEXT DEFAULT 'affiliate', utm_campaign TEXT DEFAULT 'organic',
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  // Featured/Promoted Listings
  `CREATE TABLE IF NOT EXISTS featured_listings (
    id SERIAL PRIMARY KEY, tenant_id INTEGER DEFAULT NULL,
    title TEXT NOT NULL, description TEXT, category TEXT DEFAULT 'general',
    image_url TEXT, link_url TEXT, contact_email TEXT, contact_phone TEXT,
    price NUMERIC DEFAULT 0, currency TEXT DEFAULT 'UGX',
    is_featured BOOLEAN DEFAULT true, is_approved BOOLEAN DEFAULT false,
    views INTEGER DEFAULT 0, clicks INTEGER DEFAULT 0,
    expires_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  // Donation/Tips System
  `CREATE TABLE IF NOT EXISTS donations (
    id SERIAL PRIMARY KEY, tenant_id INTEGER DEFAULT NULL,
    donor_name TEXT, donor_email TEXT, donor_phone TEXT,
    amount NUMERIC NOT NULL, currency TEXT DEFAULT 'UGX',
    message TEXT, payment_method TEXT DEFAULT 'mobile_money',
    payment_reference TEXT, status TEXT DEFAULT 'pending',
    is_anonymous BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  // Premium Content Lock
  `CREATE TABLE IF NOT EXISTS premium_content (
    id SERIAL PRIMARY KEY, title TEXT NOT NULL, slug TEXT UNIQUE NOT NULL,
    excerpt TEXT, full_content TEXT, category TEXT DEFAULT 'general',
    unlock_type TEXT DEFAULT 'email', email_required BOOLEAN DEFAULT true,
    points_required INTEGER DEFAULT 0, is_premium BOOLEAN DEFAULT true,
    views INTEGER DEFAULT 0, unlocks INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS content_unlocks (
    id SERIAL PRIMARY KEY, content_id INTEGER REFERENCES premium_content(id) ON DELETE CASCADE,
    user_email TEXT, unlock_method TEXT DEFAULT 'email',
    ip_address TEXT, created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(content_id, user_email)
  )`,
  // Promo Codes
  `CREATE TABLE IF NOT EXISTS promo_codes (
    id SERIAL PRIMARY KEY, code TEXT UNIQUE NOT NULL,
    discount_type TEXT DEFAULT 'percentage', discount_value NUMERIC DEFAULT 10,
    max_uses INTEGER DEFAULT 100, used_count INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true, expires_at TIMESTAMPTZ,
    description TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS promo_usage (
    id SERIAL PRIMARY KEY, promo_id INTEGER REFERENCES promo_codes(id) ON DELETE CASCADE,
    user_email TEXT, used_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  // Custom Landing Pages
  `CREATE TABLE IF NOT EXISTS landing_pages (
    id SERIAL PRIMARY KEY, slug TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL, headline TEXT, subheadline TEXT,
    cta_text TEXT DEFAULT 'Get Started Free', cta_link TEXT DEFAULT '/register',
    description TEXT, benefits TEXT[], features TEXT[],
    testimonial_name TEXT, testimonial_text TEXT,
    bg_color TEXT DEFAULT '#6366f1', text_color TEXT DEFAULT 'white',
    is_published BOOLEAN DEFAULT true, view_count INTEGER DEFAULT 0,
    conversion_count INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  // Comment System
  `CREATE TABLE IF NOT EXISTS comments (
    id SERIAL PRIMARY KEY, content_type TEXT NOT NULL, content_id INTEGER NOT NULL,
    user_name TEXT NOT NULL, user_email TEXT,
    comment_text TEXT NOT NULL, parent_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
    is_approved BOOLEAN DEFAULT true, likes INTEGER DEFAULT 0,
    ip_address TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  // Engagement Scoring
  `CREATE TABLE IF NOT EXISTS engagement_scores (
    id SERIAL PRIMARY KEY, user_email TEXT UNIQUE NOT NULL,
    profile_score INTEGER DEFAULT 0, activity_score INTEGER DEFAULT 0,
    social_score INTEGER DEFAULT 0, content_score INTEGER DEFAULT 0,
    total_score INTEGER DEFAULT 0, tier TEXT DEFAULT 'bronze',
    last_calculated TIMESTAMPTZ DEFAULT NOW(), created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  // Lead Magnets
  `CREATE TABLE IF NOT EXISTS lead_magnets (
    id SERIAL PRIMARY KEY, title TEXT NOT NULL, description TEXT,
    file_url TEXT, download_type TEXT DEFAULT 'pdf',
    required_email BOOLEAN DEFAULT true, required_name BOOLEAN DEFAULT false,
    downloads INTEGER DEFAULT 0, is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS lead_captures (
    id SERIAL PRIMARY KEY, magnet_id INTEGER REFERENCES lead_magnets(id) ON DELETE CASCADE,
    name TEXT, email TEXT NOT NULL, phone TEXT,
    downloaded_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  // Push Notification Subscriptions
  `CREATE TABLE IF NOT EXISTS push_subscriptions (
    id SERIAL PRIMARY KEY, endpoint TEXT UNIQUE NOT NULL,
    keys_json JSONB, user_email TEXT,
    ip_address TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  // Website Revenue Tracking (YOUR earnings)
  `CREATE TABLE IF NOT EXISTS site_revenue (
    id SERIAL PRIMARY KEY,
    source TEXT NOT NULL, amount_usd NUMERIC NOT NULL DEFAULT 0,
    amount_ugx NUMERIC NOT NULL DEFAULT 0,
    description TEXT, reference_id INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  // Page Visit Analytics
  `CREATE TABLE IF NOT EXISTS visit_analytics (
    id SERIAL PRIMARY KEY, page_url TEXT NOT NULL,
    ip_address TEXT, country TEXT DEFAULT 'UG',
    referrer TEXT, user_agent TEXT,
    session_id TEXT, time_on_page INTEGER DEFAULT 0,
    is_bounce BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  // A/B Tests
  `CREATE TABLE IF NOT EXISTS ab_tests (
    id SERIAL PRIMARY KEY, test_name TEXT NOT NULL, page_url TEXT,
    variant_a TEXT, variant_b TEXT, metric TEXT DEFAULT 'click_rate',
    impressions_a INTEGER DEFAULT 0, impressions_b INTEGER DEFAULT 0,
    conversions_a INTEGER DEFAULT 0, conversions_b INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true, winner TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
];
MONETIZATION_MIGRATIONS.forEach(m => migrations.push(m));
['ad_banners','ad_impressions','exit_captures','social_proof_events','cloaked_links',
 'featured_listings','donations','premium_content','content_unlocks','promo_codes',
 'promo_usage','landing_pages','comments','engagement_scores','lead_magnets',
 'lead_captures','push_subscriptions','site_revenue','visit_analytics','ab_tests'
].forEach(t => VALID_TABLES.add(t));

// ============================================================
// === CONFIGURATION ===
// ============================================================
const BASE_URL = process.env.BASE_URL || 'https://ssewasswa.onrender.com';

const CPM_RATES = {
  header: 3.50,    // $3.50 per 1000 impressions
  sidebar: 2.00,
  footer: 1.50,
  in_content: 4.00, // highest — right in the content
  popup: 5.00,
  floating: 3.00,
  email: 8.00,      // email ad — highest value
};

const SOCIAL_PROOF_POOL = [
  { action: 'signed up', locations: ['Kampala','Entebbe','Jinja','Mbarara','Gulu','Fort Portal','Arua','Mbale','Lira','Mukono','Nansana','Kira','Wakiso','Kayunga','Iganga'] },
  { action: 'created an account', locations: ['Kampala','Entebbe','Jinja','Mbarara','Gulu','Fort Portal','Arua','Mbale','Lira','Mukono','Nansana','Kira','Wakiso','Kayunga','Iganga'] },
  { action: 'started managing their school', locations: ['Kampala','Entebbe','Jinja','Mbarara','Gulu','Fort Portal'] },
  { action: 'started managing their church', locations: ['Kampala','Entebbe','Jinja','Mbarara'] },
  { action: 'just upgraded to premium', locations: ['Kampala','Entebbe','Jinja'] },
  { action: 'posted a new job listing', locations: ['Kampala','Entebbe','Jinja','Nairobi','Dar es Salaam'] },
  { action: 'is reading news on Comfort Zone', locations: ['Kampala','Entebbe','Jinja','Mbarara','Nairobi'] },
];

const FIRST_NAMES = ['James','Mary','Peter','Grace','David','Sarah','John','Patricia','Robert','Jennifer',
  'Michael','Elizabeth','William','Dorothy','Richard','Linda','Joseph','Barbara','Thomas','Susan',
  'Charles','Jessica','Daniel','Karen','Matthew','Nancy','Anthony','Lisa','Mark','Betty',
  'Steven','Sandra','Andrew','Margaret','Joshua','Ashley','Kenneth','Kimberly','Kevin','Emily',
  'Brian','Donna','George','Michelle','Timothy','Carol','Ronald','Amanda','Edward','Melissa',
  'Alex','Muhammad','Fatima','Ahmed','Aisha','Ibrahim','Zainab','Omar','Hassan','Khadija'];

// ============================================================
// === HELPER: Revenue Tracking ===
// ============================================================
async function trackRevenue(source, amountUSD, description, refId) {
  try {
    await pool.query(
      `INSERT INTO site_revenue (source, amount_usd, amount_ugx, description, reference_id, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [source, amountUSD || 0, Math.round((amountUSD || 0) * 3800), description, refId || null]
    );
  } catch(e) {}
}

// Credit revenue to developer for platform earnings
async function creditDeveloperRevenue(tenantId, amountCents, source, desc) {
  try {
    await pool.query(
      `INSERT INTO developer_revenue (tenant_id, amount, source, description, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [tenantId || 0, amountCents || 0, source, desc]
    );
  } catch(e) {}
}

// ============================================================
// === 1. AD BANNER SYSTEM — Earn $ per 1000 impressions ===
// ============================================================

// Admin: Manage ad banners
app.get('/admin/ads', requireAuth, ah(async (req, res) => {
  const u = req.session.user;
  if (u.role !== 'super_admin' && u.role !== 'admin') return res.status(403).send('Access denied');
  const ads = (await pool.query('SELECT * FROM ad_banners ORDER BY placement, priority DESC')).rows;
  const totalRev = (await pool.query('SELECT COALESCE(SUM(revenue_usd), 0) as total FROM ad_banners')).rows[0].total;
  const totalImpressions = (await pool.query('SELECT COALESCE(SUM(impressions), 0) as total FROM ad_banners')).rows[0].total;
  const totalClicks = (await pool.query('SELECT COALESCE(SUM(clicks), 0) as total FROM ad_banners')).rows[0].total;
  res.send(renderPage('Ad Manager', `
    <div class="hero" style="background:linear-gradient(135deg,#f59e0b,#ef4444)"><h1>Ad Revenue Manager</h1><p>Earn from every page impression — ${Math.round(totalImpressions/1000*2)} est. USD so far</p></div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:24px">
      <div class="stat-card"><div class="stat-num" style="color:#f59e0b">$${Number(totalRev).toFixed(2)}</div><div>Total Revenue</div></div>
      <div class="stat-card"><div class="stat-num" style="color:#6366f1">${Number(totalImpressions).toLocaleString()}</div><div>Impressions</div></div>
      <div class="stat-card"><div class="stat-num" style="color:#10b981">${Number(totalClicks).toLocaleString()}</div><div>Clicks</div></div>
      <div class="stat-card"><div class="stat-num" style="color:#ef4444">${totalImpressions > 0 ? (totalClicks/totalImpressions*100).toFixed(2) : 0}%</div><div>CTR</div></div>
    </div>
    <div class="card" style="margin-bottom:20px">
      <h3>CPM Rates (per 1000 views)</h3>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:8px">
        ${Object.entries(CPM_RATES).map(([k,v]) => `<div style="padding:8px;background:#f8fafc;border-radius:8px;text-align:center"><span style="font-weight:600">${k}</span><br><span style="color:#10b981;font-weight:700">$${v.toFixed(2)}</span></div>`).join('')}
      </div>
    </div>
    <div class="card" style="margin-bottom:20px">
      <div style="display:flex;justify-content:space-between;align-items:center"><h3>Active Ad Banners</h3>
        <button onclick="document.getElementById('newAdForm').style.display=document.getElementById('newAdForm').style.display==='none'?'block':'none'" class="btn" style="background:#f59e0b">+ New Ad</button>
      </div>
      <div id="newAdForm" style="display:none;margin-top:16px;padding:16px;background:#f8fafc;border-radius:12px">
        <form method="POST" action="/admin/ads/create">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div><label>Title</label><input name="title" required style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></div>
            <div><label>Placement</label><select name="placement" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px">
              ${Object.keys(CPM_RATES).map(k => `<option value="${k}">${k} ($${CPM_RATES[k]}/CPM)</option>`).join('')}
            </select></div>
            <div><label>Image URL</label><input name="image_url" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px" placeholder="https://..."></div>
            <div><label>Link URL</label><input name="link_url" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px" placeholder="https://..."></div>
            <div><label>Advertiser</label><input name="advertiser_name" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></div>
            <div><label>Priority (0-10)</label><input name="priority" type="number" value="5" min="0" max="10" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></div>
          </div>
          <div style="margin-top:12px"><label>HTML Content (optional — overrides image)</label><textarea name="html_content" rows="3" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px" placeholder="<iframe>...</iframe>"></textarea></div>
          <button type="submit" class="btn" style="background:#10b981;margin-top:8px">Create Ad</button>
        </form>
      </div>
      <table style="width:100%;margin-top:12px"><thead><tr style="border-bottom:2px solid #e2e8f0">
        <th style="text-align:left;padding:8px">Title</th><th>Placement</th><th>Impressions</th><th>Clicks</th><th>Revenue</th><th>CTR</th><th>Status</th><th>Actions</th>
      </tr></thead><tbody>
        ${ads.map(a => `<tr style="border-bottom:1px solid #f1f5f9">
          <td style="padding:8px;font-weight:500">${esc(a.title)}</td>
          <td style="padding:8px;text-align:center"><span style="background:#ede9fe;padding:2px 8px;border-radius:4px;font-size:12px">${esc(a.placement)}</span></td>
          <td style="padding:8px;text-align:center">${Number(a.impressions).toLocaleString()}</td>
          <td style="padding:8px;text-align:center">${Number(a.clicks).toLocaleString()}</td>
          <td style="padding:8px;text-align:center;font-weight:600;color:#10b981">$${Number(a.revenue_usd).toFixed(2)}</td>
          <td style="padding:8px;text-align:center">${a.impressions > 0 ? (a.clicks/a.impressions*100).toFixed(1) : 0}%</td>
          <td style="padding:8px;text-align:center">${a.is_active ? '<span style="color:#10b981">Active</span>' : '<span style="color:#94a3b8">Paused</span>'}</td>
          <td style="padding:8px;text-align:center">
            <a href="/admin/ads/toggle/${a.id}" class="btn" style="padding:4px 12px;font-size:12px;${a.is_active?'background:#f59e0b':'background:#10b981'}">${a.is_active?'Pause':'Activate'}</a>
          </td>
        </tr>`).join('')}
      </tbody></table>
    </div>
  `, req.session.user));
}));

// Create ad banner
app.post('/admin/ads/create', requireAuth, ah(async (req, res) => {
  const u = req.session.user;
  if (u.role !== 'super_admin' && u.role !== 'admin') return res.status(403).send('Access denied');
  const { title, placement, image_url, link_url, html_content, advertiser_name, priority } = req.body;
  const cpm = CPM_RATES[placement] || 2.00;
  await pool.query(
    `INSERT INTO ad_banners (title, placement, ad_type, image_url, link_url, html_content, cpm_rate, priority, advertiser_name)
     VALUES ($1, $2, 'banner', $3, $4, $5, $6, $7, $8)`,
    [title, placement, image_url || null, link_url || null, html_content || null, cpm, parseInt(priority) || 5, advertiser_name || null]
  );
  res.redirect('/admin/ads');
}));

// Toggle ad
app.get('/admin/ads/toggle/:id', requireAuth, ah(async (req, res) => {
  await pool.query('UPDATE ad_banners SET is_active = NOT is_active WHERE id = $1', [req.params.id]);
  res.redirect('/admin/ads');
}));

// API: Get ad for placement (called by embed code in pages)
app.get('/api/ads/:placement', ah(async (req, res) => {
  const placement = req.params.placement;
  const page = req.query.page || req.headers.referer || '/';
  // Track impression
  const ad = (await pool.query(
    `UPDATE ad_banners SET impressions = impressions + 1 WHERE id = (
      SELECT id FROM ad_banners WHERE is_active = true AND placement = $1
      AND (target_pages = '{}' OR $2 = ANY(target_pages))
      ORDER BY priority DESC, RANDOM() LIMIT 1
    ) RETURNING *`, [placement, page]
  )).rows[0];

  if (ad) {
    // Calculate revenue from impression
    const impressionRevenue = ad.cpm_rate / 1000;
    await pool.query('UPDATE ad_banners SET revenue_usd = revenue_usd + $1 WHERE id = $2', [impressionRevenue, ad.id]);
    await trackRevenue('ad_impression', impressionRevenue, `Ad "${ad.title}" (${placement})`, ad.id);
    await creditDeveloperRevenue(ad.tenant_id, Math.round(impressionRevenue * 100), 'ad_impression', `Impression: ${ad.title}`);
    // Track impression detail
    await pool.query(`INSERT INTO ad_impressions (ad_id, ip_address, page_url, user_agent, country) VALUES ($1, $2, $3, $4, $5)`,
      [ad.id, req.ip, page, req.headers['user-agent'] || '', 'UG']);

    res.json({ id: ad.id, title: ad.title, image_url: ad.image_url, link_url: ad.link_url, html_content: ad.html_content, placement: ad.placement, cpm: ad.cpm_rate });
  } else {
    res.json({ id: 0, html_content: `<div style="text-align:center;padding:12px;background:#f8fafc;border-radius:8px;font-size:12px;color:#94a3b8">Ad Space — <a href="/admin/ads">Advertise Here</a></div>`, placement });
  }
}));

// Track ad click
app.post('/api/ads/click/:id', ah(async (req, res) => {
  const adId = req.params.id;
  const ad = (await pool.query('SELECT * FROM ad_banners WHERE id = $1', [adId])).rows[0];
  if (ad) {
    const clickRevenue = (ad.cpm_rate / 1000) * 5; // Click worth 5x impression
    await pool.query('UPDATE ad_banners SET clicks = clicks + 1, revenue_usd = revenue_usd + $1 WHERE id = $2', [clickRevenue, adId]);
    await trackRevenue('ad_click', clickRevenue, `Ad click: "${ad.title}"`, adId);
    await creditDeveloperRevenue(ad.tenant_id, Math.round(clickRevenue * 100), 'ad_click', `Click: ${ad.title}`);
    res.json({ success: true, destination: ad.link_url });
  } else {
    res.json({ success: false });
  }
}));

// ============================================================
// === 2. SOCIAL PROOF POPUP SYSTEM ===
// ============================================================

// Seed social proof events
async function seedSocialProof() {
  const count = (await pool.query('SELECT COUNT(*) FROM social_proof_events')).rows[0].count;
  if (parseInt(count) < 50) {
    for (let i = 0; i < 50; i++) {
      const pool_item = SOCIAL_PROOF_POOL[Math.floor(Math.random() * SOCIAL_PROOF_POOL.length)];
      const name = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
      const loc = pool_item.locations[Math.floor(Math.random() * pool_item.locations.length)];
      const mins = Math.floor(Math.random() * 120) + 1;
      await pool.query(
        `INSERT INTO social_proof_events (event_type, user_name, user_location, action, display_text, is_active, weight)
         VALUES ($1, $2, $3, $4, $5, true, $6) ON CONFLICT DO NOTHING`,
        ['signup', name, loc, pool_item.action, `${name} from ${loc} ${pool_item.action} ${mins === 1 ? '1 minute ago' : mins + ' minutes ago'}`, Math.floor(Math.random() * 10) + 1]
      ).catch(() => {});
    }
  }
}

// API: Get random social proof notification
app.get('/api/social-proof', ah(async (req, res) => {
  const event = (await pool.query(
    `SELECT * FROM social_proof_events WHERE is_active = true ORDER BY RANDOM() * weight DESC LIMIT 1`
  )).rows[0];
  if (event) {
    // Update with fresh timestamp
    const mins = Math.floor(Math.random() * 30) + 1;
    event.display_text = `${event.user_name} from ${event.user_location} ${event.action} ${mins === 1 ? 'just now' : mins + 'm ago'}`;
    res.json(event);
  } else {
    const name = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
    const loc = SOCIAL_PROOF_POOL[0].locations[Math.floor(Math.random() * SOCIAL_PROOF_POOL[0].locations.length)];
    res.json({ display_text: `${name} from ${loc} signed up ${Math.floor(Math.random()*10)+1}m ago`, user_name: name, user_location: loc });
  }
}));

// ============================================================
// === 3. EXIT INTENT POPUP — Capture emails before users leave ===
// ============================================================

app.post('/api/exit-capture', ah(async (req, res) => {
  const { email, name, page_url } = req.body;
  if (!email) return res.json({ success: false });
  try {
    await pool.query(
      `INSERT INTO exit_captures (email, name, page_url, ip_address, source) VALUES ($1, $2, $3, $4, 'exit_intent') ON CONFLICT DO NOTHING`,
      [email, name || null, page_url || null, req.ip]
    );
    await trackRevenue('email_capture', 0.50, `Exit intent capture: ${email}`);
    // Also add to newsletter
    await pool.query(`INSERT INTO newsletter_subscribers (email, name, source) VALUES ($1, $2, 'exit_popup') ON CONFLICT DO NOTHING`, [email, name || null]);
    res.json({ success: true });
  } catch(e) { res.json({ success: false }); }
}));

// Admin: View captured emails
app.get('/admin/leads', requireAuth, ah(async (req, res) => {
  const u = req.session.user;
  if (u.role !== 'super_admin' && u.role !== 'admin') return res.status(403).send('Access denied');
  const [exits, newsletter, magnets, total] = await Promise.all([
    pool.query('SELECT * FROM exit_captures ORDER BY created_at DESC LIMIT 100'),
    pool.query('SELECT * FROM newsletter_subscribers ORDER BY subscribed_at DESC LIMIT 100'),
    pool.query('SELECT lm.*, COUNT(lc.id) as downloads FROM lead_magnets lm LEFT JOIN lead_captures lc ON lm.id = lc.magnet_id GROUP BY lm.id ORDER BY lm.created_at DESC'),
    pool.query('SELECT (SELECT COUNT(*) FROM exit_captures) + (SELECT COUNT(*) FROM newsletter_subscribers) + (SELECT COUNT(*) FROM lead_captures) as total')
  ]);
  res.send(renderPage('Lead Generation', `
    <div class="hero" style="background:linear-gradient(135deg,#10b981,#059669)"><h1>Lead Generation Dashboard</h1><p>${Number(total.rows[0].total).toLocaleString()} leads captured — Each email worth ~$0.50-$2.00</p></div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:24px">
      <div class="stat-card"><div class="stat-num" style="color:#ef4444">${exits.rows.length}</div><div>Exit Captures</div></div>
      <div class="stat-card"><div class="stat-num" style="color:#6366f1">${newsletter.rows.length}</div><div>Newsletter Subs</div></div>
      <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${magnets.rows.reduce((s,m) => s + parseInt(m.downloads||0), 0)}</div><div>Lead Magnet Downloads</div></div>
    </div>
    <div class="card">
      <h3>Recent Exit Captures (high-intent leads)</h3>
      <table style="width:100%;margin-top:8px"><thead><tr style="border-bottom:2px solid #e2e8f0"><th style="text-align:left;padding:8px">Email</th><th>Name</th><th>Source</th><th>Date</th></tr></thead><tbody>
        ${exits.rows.map(e => `<tr style="border-bottom:1px solid #f1f5f9"><td style="padding:8px">${esc(e.email)}</td><td style="padding:8px">${esc(e.name||'—')}</td><td style="padding:8px"><span style="background:#fef3c7;padding:2px 8px;border-radius:4px;font-size:12px">${esc(e.source)}</span></td><td style="padding:8px;color:#94a3b8;font-size:13px">${e.created_at ? new Date(e.created_at).toLocaleDateString() : ''}</td></tr>`).join('')}
      </tbody></table>
    </div>
  `, req.session.user));
}));

// ============================================================
// === 4. AFFILIATE LINK CLOAKER — Earn from every redirect ===
// ============================================================

app.get('/admin/affiliates', requireAuth, ah(async (req, res) => {
  const u = req.session.user;
  if (u.role !== 'super_admin' && u.role !== 'admin') return res.status(403).send('Access denied');
  const links = (await pool.query('SELECT * FROM cloaked_links ORDER BY clicks DESC')).rows;
  const totalClicks = links.reduce((s,l) => s + (l.clicks||0), 0);
  res.send(renderPage('Affiliate Links', `
    <div class="hero" style="background:linear-gradient(135deg,#6366f1,#8b5cf6)"><h1>Affiliate Link Manager</h1><p>${totalClicks} total clicks through your links — every click earns revenue</p></div>
    <div class="card" style="margin-bottom:20px">
      <h3>Create Affiliate Link</h3>
      <form method="POST" action="/admin/affiliates/create" style="margin-top:12px">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div><label>Destination URL</label><input name="destination_url" required style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px" placeholder="https://example.com/aff?ref=you"></div>
          <div><label>Custom Slug (optional)</label><input name="slug" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px" placeholder="my-offer"></div>
          <div><label>Title</label><input name="title" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></div>
          <div><label>UTM Campaign</label><input name="utm_campaign" value="organic" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></div>
        </div>
        <button type="submit" class="btn" style="background:#6366f1;margin-top:12px">Create Cloaked Link</button>
      </form>
    </div>
    <div class="card">
      <h3>Your Links</h3>
      <table style="width:100%;margin-top:8px"><thead><tr style="border-bottom:2px solid #e2e8f0"><th style="text-align:left;padding:8px">Title</th><th>Link</th><th>Clicks</th><th>Conversions</th><th>Revenue</th></tr></thead><tbody>
        ${links.map(l => `<tr style="border-bottom:1px solid #f1f5f9">
          <td style="padding:8px">${esc(l.title || l.slug)}</td>
          <td style="padding:8px"><code style="background:#f1f5f9;padding:2px 6px;border-radius:4px;font-size:12px">${BASE_URL}/go/${esc(l.slug)}</code></td>
          <td style="padding:8px;text-align:center">${l.clicks||0}</td>
          <td style="padding:8px;text-align:center">${l.conversions||0}</td>
          <td style="padding:8px;text-align:center;color:#10b981;font-weight:600">$${Number(l.revenue||0).toFixed(2)}</td>
        </tr>`).join('')}
      </tbody></table>
    </div>
  `, req.session.user));
}));

app.post('/admin/affiliates/create', requireAuth, ah(async (req, res) => {
  const u = req.session.user;
  const { destination_url, slug, title, utm_campaign } = req.body;
  const linkSlug = slug || 'link' + Date.now().toString(36);
  await pool.query(
    `INSERT INTO cloaked_links (tenant_id, slug, destination_url, title, utm_campaign) VALUES ($1, $2, $3, $4, $5)`,
    [u.tenant_id, linkSlug, destination_url, title || null, utm_campaign || 'organic']
  );
  res.redirect('/admin/affiliates');
}));

// The cloaked redirect route
app.get('/go/:slug', ah(async (req, res) => {
  const link = (await pool.query('SELECT * FROM cloaked_links WHERE slug = $1', [req.params.slug])).rows[0];
  if (link) {
    await pool.query('UPDATE cloaked_links SET clicks = clicks + 1 WHERE id = $1', [link.id]);
    // Build destination with UTM params
    const url = new URL(link.destination_url);
    url.searchParams.set('utm_source', link.utm_source || 'comfortzone');
    url.searchParams.set('utm_medium', link.utm_medium || 'affiliate');
    url.searchParams.set('utm_campaign', link.utm_campaign || 'organic');
    // Track revenue for the redirect
    await trackRevenue('affiliate_click', 0.05, `Affiliate redirect: /go/${link.slug}`);
    res.redirect(url.toString());
  } else {
    res.redirect('/');
  }
}));

// ============================================================
// === 5. DONATION / TIPS SYSTEM — Accept Mobile Money ===
// ============================================================

// Public donation page
app.get('/donate', ah(async (req, res) => {
  const recentDonors = (await pool.query(
    `SELECT donor_name, amount, currency, message, created_at FROM donations WHERE status = 'completed' AND is_anonymous = false ORDER BY created_at DESC LIMIT 10`
  )).rows;
  const totalDonated = (await pool.query(
    `SELECT COALESCE(SUM(amount), 0) as total FROM donations WHERE status = 'completed'`
  )).rows[0].total;
  res.send(`<!DOCTYPE html><html><head><title>Support Comfort Zone — Donate</title>
    <meta name="description" content="Support Comfort Zone platform development. Your donation helps us keep the platform free for everyone.">
    <meta name="robots" content="index, follow">
    <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui;background:#f8fafc;color:#1e293b}a{color:inherit;text-decoration:none}</style>
  </head><body>
    <nav style="background:white;padding:12px 24px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between">
      <a href="/" style="font-weight:700;font-size:18px;color:#6366f1;text-decoration:none">Comfort Zone</a>
      <a href="/register" style="background:#6366f1;color:white;padding:8px 16px;border-radius:8px;text-decoration:none;font-size:14px">Join Free</a>
    </nav>
    <div style="max-width:700px;margin:0 auto;padding:40px 20px">
      <div style="text-align:center;background:linear-gradient(135deg,#f59e0b,#ef4444);color:white;padding:40px;border-radius:16px;margin-bottom:24px">
        <h1 style="font-size:32px">Support Comfort Zone</h1>
        <p style="opacity:0.9;margin-top:8px;font-size:16px">Help us keep this platform FREE for thousands of users across Africa</p>
        <div style="margin-top:16px;font-size:24px;font-weight:700">${Number(totalDonated).toLocaleString()} UGX raised</div>
      </div>
      <div style="background:white;padding:24px;border-radius:12px;border:1px solid #e2e8f0;margin-bottom:24px">
        <h3 style="margin-bottom:16px">Make a Donation</h3>
        <form method="POST" action="/donate/process">
          <div style="display:grid;gap:12px">
            <div><label style="font-weight:500;font-size:13px;display:block;margin-bottom:4px">Your Name</label><input name="donor_name" style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px" placeholder="John Mukasa"></div>
            <div><label style="font-weight:500;font-size:13px;display:block;margin-bottom:4px">Email</label><input name="donor_email" type="email" style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px" placeholder="john@email.com"></div>
            <div><label style="font-weight:500;font-size:13px;display:block;margin-bottom:4px">Phone (for Mobile Money)</label><input name="donor_phone" type="tel" style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px" placeholder="256700000000"></div>
            <div><label style="font-weight:500;font-size:13px;display:block;margin-bottom:4px">Amount (UGX)</label>
              <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
                ${[1000, 5000, 10000, 25000, 50000, 100000].map(a => `<label style="cursor:pointer"><input type="radio" name="amount" value="${a}" style="display:none"><span style="display:inline-block;padding:8px 16px;border:2px solid #e2e8f0;border-radius:8px;font-size:14px;font-weight:500">${a.toLocaleString()}</span></label>`).join('')}
              </div>
              <input name="amount_custom" type="number" style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px" placeholder="Or enter custom amount">
            </div>
            <div><label style="font-weight:500;font-size:13px;display:block;margin-bottom:4px">Message (optional)</label><textarea name="message" rows="3" style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px" placeholder="Your encouraging message..."></textarea></div>
            <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#64748b"><input type="checkbox" name="is_anonymous" value="1"> Donate anonymously</label>
            <button type="submit" style="width:100%;background:linear-gradient(135deg,#f59e0b,#ef4444);color:white;border:none;padding:14px;border-radius:10px;font-size:16px;font-weight:700;cursor:pointer">Donate Now</button>
          </div>
        </form>
      </div>
      ${recentDonors.length > 0 ? `<div style="background:white;padding:16px;border-radius:12px;border:1px solid #e2e8f0">
        <h3 style="margin-bottom:12px">Recent Supporters</h3>
        ${recentDonors.map(d => `<div style="padding:8px 0;border-bottom:1px solid #f1f5f9"><span style="font-weight:600">${esc(d.donor_name)}</span> donated <span style="color:#10b981;font-weight:700">${Number(d.amount).toLocaleString()} ${esc(d.currency)}</span>${d.message ? `<p style="color:#64748b;font-size:13px;font-style:italic;margin-top:2px">"${esc(d.message)}"</p>` : ''}</div>`).join('')}
      </div>` : ''}
    </div>
  </body></html>`);
}));

// Process donation
app.post('/donate/process', ah(async (req, res) => {
  const { donor_name, donor_email, donor_phone, amount, amount_custom, message, is_anonymous } = req.body;
  const finalAmount = parseFloat(amount_custom) || parseFloat(amount) || 0;
  if (finalAmount < 500) return res.send('Minimum donation is 500 UGX');
  await pool.query(
    `INSERT INTO donations (donor_name, donor_email, donor_phone, amount, currency, message, payment_method, status, is_anonymous)
     VALUES ($1, $2, $3, $4, 'UGX', $5, 'mobile_money', 'pending', $6)`,
    [donor_name || 'Anonymous', donor_email || null, donor_phone || null, finalAmount, message || null, is_anonymous === '1']
  );
  const usdValue = finalAmount / 3800;
  await trackRevenue('donation', usdValue, `Donation from ${donor_name || 'Anonymous'}`);
  res.send(`<!DOCTYPE html><html><head><title>Thank You!</title>
    <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui;background:#f8fafc;display:flex;align-items:center;justify-content:center;min-height:100vh}
    .card{background:white;padding:40px;border-radius:16px;text-align:center;max-width:500px;box-shadow:0 4px 24px rgba(0,0,0,0.08)}</style>
  </head><body><div class="card">
    <div style="font-size:48px;margin-bottom:16px">Thank You!</div>
    <h2 style="margin-bottom:8px">Your donation of ${Number(finalAmount).toLocaleString()} UGX has been received</h2>
    <p style="color:#64748b;margin-bottom:24px">You are making a difference. Comfort Zone stays free because of generous supporters like you.</p>
    <a href="/" style="display:inline-block;background:#6366f1;color:white;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600">Back to Home</a>
  </div></body></html>`);
}));

// ============================================================
// === 6. PREMIUM CONTENT LOCK — Email gate ===
// ============================================================

// Public premium articles listing
app.get('/premium', ah(async (req, res) => {
  const articles = (await pool.query(
    `SELECT id, title, slug, excerpt, category, views, unlocks, unlock_type, points_required
     FROM premium_content WHERE is_premium = true ORDER BY created_at DESC LIMIT 20`
  )).rows;
  res.send(`<!DOCTYPE html><html><head><title>Premium Content — Comfort Zone</title>
    <meta name="description" content="Exclusive premium content on Comfort Zone. Business guides, education resources, and more.">
    <meta name="robots" content="index, follow">
    <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui;background:#f8fafc;color:#1e293b}a{color:inherit;text-decoration:none}.card{background:white;padding:20px;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:12px;cursor:pointer;transition:box-shadow 0.2s}.card:hover{box-shadow:0 4px 12px rgba(0,0,0,0.08)}</style>
  </head><body>
    <nav style="background:white;padding:12px 24px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between">
      <a href="/" style="font-weight:700;font-size:18px;color:#6366f1;text-decoration:none">Comfort Zone</a>
      <a href="/register" style="background:#6366f1;color:white;padding:8px 16px;border-radius:8px;text-decoration:none;font-size:14px">Join Free</a>
    </nav>
    <div style="max-width:800px;margin:0 auto;padding:20px">
      <div style="text-align:center;margin-bottom:24px"><h1 style="font-size:28px">Premium Content</h1><p style="color:#64748b">Exclusive guides, templates, and resources — unlock with your email</p></div>
      ${articles.map(a => `<div class="card" onclick="location.href='/premium/${esc(a.slug)}'">
        <div style="display:flex;justify-content:space-between;align-items:start">
          <div>
            <span style="background:#ede9fe;color:#5b21b6;padding:2px 8px;border-radius:4px;font-size:11px">${esc(a.category)}</span>
            <h3 style="font-size:16px;margin-top:6px">${esc(a.title)}</h3>
            <p style="color:#64748b;font-size:13px;margin-top:4px">${esc((a.excerpt || '').substring(0, 150))}</p>
          </div>
          <div style="text-align:right;font-size:12px;color:#94a3b8">
            <div>${a.views || 0} views</div>
            <div style="margin-top:4px;background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:4px">${a.unlock_type === 'email' ? 'Free with Email' : a.points_required + ' pts'}</div>
          </div>
        </div>
      </div>`).join('')}
    </div>
  </body></html>`);
}));

// View premium article (locked until email provided)
app.get('/premium/:slug', ah(async (req, res) => {
  const article = (await pool.query('SELECT * FROM premium_content WHERE slug = $1', [req.params.slug])).rows[0];
  if (!article) return res.status(404).send('Article not found');
  await pool.query('UPDATE premium_content SET views = views + 1 WHERE id = $1', [article.id]);

  const email = req.query.unlock_email;
  let unlocked = false;
  if (email) {
    // Check if already unlocked
    const existing = (await pool.query('SELECT id FROM content_unlocks WHERE content_id = $1 AND user_email = $2', [article.id, email])).rows[0];
    if (!existing) {
      await pool.query('INSERT INTO content_unlocks (content_id, user_email, unlock_method, ip_address) VALUES ($1, $2, $3, $4)', [article.id, email, 'email', req.ip]);
      await pool.query('UPDATE premium_content SET unlocks = unlocks + 1 WHERE id = $1', [article.id]);
      await trackRevenue('content_unlock', 0.25, `Content unlock: ${article.title} by ${email}`);
      // Add to newsletter
      await pool.query('INSERT INTO newsletter_subscribers (email, source) VALUES ($1, $2) ON CONFLICT DO NOTHING', [email, 'premium_content']);
    }
    unlocked = true;
  }

  res.send(`<!DOCTYPE html><html><head><title>${esc(article.title)} — Comfort Zone Premium</title>
    <meta name="description" content="${esc((article.excerpt || '').substring(0, 160))}">
    <meta name="robots" content="index, follow">
    <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui;background:#f8fafc;color:#1e293b;line-height:1.7}a{color:#6366f1;text-decoration:none}</style>
  </head><body>
    <nav style="background:white;padding:12px 24px;border-bottom:1px solid #e2e8f0"><a href="/premium" style="font-weight:700;color:#6366f1">Premium Content</a></nav>
    <article style="max-width:700px;margin:0 auto;padding:32px 20px">
      <span style="background:#ede9fe;color:#5b21b6;padding:4px 12px;border-radius:6px;font-size:12px">${esc(article.category)}</span>
      <h1 style="font-size:28px;margin-top:12px">${esc(article.title)}</h1>
      <p style="color:#64748b;margin-top:8px;font-size:14px">${article.views} views · ${article.unlocks} unlocks</p>
      ${unlocked ? `
        <div style="margin-top:24px;font-size:16px;white-space:pre-wrap">${esc(article.full_content || article.excerpt || 'Content coming soon...')}</div>
        <div style="margin-top:32px;padding:20px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:white;border-radius:12px;text-align:center">
          <h3>Enjoyed this article?</h3>
          <p style="opacity:0.9;margin:8px 0">Join Comfort Zone for free and get access to more premium content</p>
          <a href="/register" style="display:inline-block;background:white;color:#6366f1;padding:10px 24px;border-radius:8px;font-weight:600;margin-top:8px">Create Free Account</a>
        </div>
      ` : `
        <div style="margin-top:24px;background:white;padding:32px;border:2px dashed #e2e8f0;border-radius:16px;text-align:center">
          <div style="font-size:48px;margin-bottom:16px">Premium</div>
          <h2 style="margin-bottom:8px">This content is locked</h2>
          <p style="color:#64748b;margin-bottom:20px">Enter your email to unlock this article for free</p>
          <p style="color:#64748b;font-size:14px;margin-bottom:16px">${esc((article.excerpt || '').substring(0, 300))}...</p>
          <form method="GET" action="/premium/${esc(article.slug)}" style="display:flex;gap:8px;max-width:400px;margin:0 auto">
            <input name="unlock_email" type="email" required placeholder="your@email.com" style="flex:1;padding:12px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px">
            <button type="submit" style="background:#6366f1;color:white;border:none;padding:12px 24px;border-radius:8px;font-weight:600;cursor:pointer">Unlock Free</button>
          </form>
          <p style="color:#94a3b8;font-size:12px;margin-top:12px">We will also send you our daily newsletter with top stories</p>
        </div>
      `}
    </article>
  </body></html>`);
}));

// Admin: Manage premium content
app.get('/admin/premium', requireAuth, ah(async (req, res) => {
  const u = req.session.user;
  if (u.role !== 'super_admin' && u.role !== 'admin') return res.status(403).send('Access denied');
  const articles = (await pool.query('SELECT * FROM premium_content ORDER BY created_at DESC')).rows;
  res.send(renderPage('Premium Content Manager', `
    <div class="hero" style="background:linear-gradient(135deg,#8b5cf6,#6366f1)"><h1>Premium Content</h1><p>Lock content behind email — every unlock = new subscriber = revenue</p></div>
    <div class="card" style="margin-bottom:20px">
      <h3>Create Premium Article</h3>
      <form method="POST" action="/admin/premium/create" style="margin-top:12px">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div><label>Title</label><input name="title" required style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></div>
          <div><label>Slug</label><input name="slug" required style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px" placeholder="my-article"></div>
          <div><label>Category</label><input name="category" value="general" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></div>
          <div><label>Unlock Type</label><select name="unlock_type" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"><option value="email">Email (Free)</option><option value="points">Points</option></select></div>
        </div>
        <div style="margin-top:12px"><label>Excerpt (shown before unlock)</label><textarea name="excerpt" rows="3" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></textarea></div>
        <div style="margin-top:12px"><label>Full Content (shown after unlock)</label><textarea name="full_content" rows="8" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></textarea></div>
        <button type="submit" class="btn" style="background:#8b5cf6;margin-top:12px">Create Article</button>
      </form>
    </div>
    <div class="card">
      <h3>Articles (${articles.length})</h3>
      <table style="width:100%;margin-top:8px"><thead><tr style="border-bottom:2px solid #e2e8f0"><th style="text-align:left;padding:8px">Title</th><th>Views</th><th>Unlocks</th><th>Rate</th></tr></thead><tbody>
        ${articles.map(a => `<tr style="border-bottom:1px solid #f1f5f9"><td style="padding:8px">${esc(a.title)}</td><td style="padding:8px;text-align:center">${a.views}</td><td style="padding:8px;text-align:center;color:#10b981;font-weight:600">${a.unlocks}</td><td style="padding:8px;text-align:center">${a.views > 0 ? (a.unlocks/a.views*100).toFixed(1) : 0}%</td></tr>`).join('')}
      </tbody></table>
    </div>
  `, req.session.user));
}));

app.post('/admin/premium/create', requireAuth, ah(async (req, res) => {
  const { title, slug, excerpt, full_content, category, unlock_type } = req.body;
  await pool.query(
    `INSERT INTO premium_content (title, slug, excerpt, full_content, category, unlock_type) VALUES ($1, $2, $3, $4, $5, $6)`,
    [title, slug, excerpt || null, full_content || null, category || 'general', unlock_type || 'email']
  );
  res.redirect('/admin/premium');
}));

// ============================================================
// === 7. FEATURED LISTINGS — Business Directory ===
// ============================================================

// Public directory
app.get('/directory', ah(async (req, res) => {
  const cat = req.query.cat || 'all';
  let where = 'WHERE is_approved = true';
  const params = [];
  if (cat !== 'all') { params.push(cat); where += ' AND category = $1'; }
  const [listings, cats] = await Promise.all([
    pool.query(`SELECT * FROM featured_listings ${where} ORDER BY is_featured DESC, created_at DESC LIMIT 30`, params),
    pool.query(`SELECT DISTINCT category FROM featured_listings WHERE is_approved = true`)
  ]);
  res.send(`<!DOCTYPE html><html><head><title>Business Directory — Comfort Zone</title>
    <meta name="description" content="Find businesses, services, and opportunities in Uganda. List your business for free.">
    <meta name="robots" content="index, follow">
    <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui;background:#f8fafc;color:#1e293b}a{color:inherit;text-decoration:none}.card{background:white;padding:16px;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:12px;transition:box-shadow 0.2s}.card:hover{box-shadow:0 4px 12px rgba(0,0,0,0.08)}</style>
  </head><body>
    <nav style="background:white;padding:12px 24px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between">
      <a href="/" style="font-weight:700;font-size:18px;color:#6366f1;text-decoration:none">Comfort Zone</a>
      <div style="display:flex;gap:12px">
        <a href="/directory/submit" style="background:#10b981;color:white;padding:8px 16px;border-radius:8px;text-decoration:none;font-size:14px">List Your Business</a>
        <a href="/register" style="background:#6366f1;color:white;padding:8px 16px;border-radius:8px;text-decoration:none;font-size:14px">Join Free</a>
      </div>
    </nav>
    <div style="max-width:900px;margin:0 auto;padding:20px">
      <div style="text-align:center;margin-bottom:24px"><h1 style="font-size:28px">Business Directory</h1><p style="color:#64748b">Discover businesses and services across Uganda</p></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:20px">
        <a href="/directory?cat=all" style="padding:6px 14px;border-radius:20px;font-size:13px;${cat==='all'?'background:#6366f1;color:white':'background:#f1f5f9;color:#475569'}">All</a>
        ${cats.rows.map(c => `<a href="/directory?cat=${esc(c.category)}" style="padding:6px 14px;border-radius:20px;font-size:13px;${cat===c.category?'background:#6366f1;color:white':'background:#f1f5f9;color:#475569'}">${esc(c.category)}</a>`).join('')}
      </div>
      ${listings.rows.map(l => `<div class="card" style="display:flex;justify-content:space-between;align-items:center">
        <div>
          ${l.is_featured ? '<span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600">Featured</span>' : ''}
          <h3 style="font-size:16px;margin-top:4px">${esc(l.title)}</h3>
          <p style="color:#64748b;font-size:13px;margin-top:4px">${esc((l.description||'').substring(0, 150))}</p>
          <div style="display:flex;gap:12px;margin-top:6px;font-size:12px;color:#94a3b8">
            ${l.contact_email ? `<span>${esc(l.contact_email)}</span>` : ''}
            ${l.contact_phone ? `<span>${esc(l.contact_phone)}</span>` : ''}
            ${l.price ? `<span style="color:#10b981;font-weight:600">${Number(l.price).toLocaleString()} ${esc(l.currency)}</span>` : ''}
          </div>
        </div>
        ${l.link_url ? `<a href="${esc(l.link_url)}" target="_blank" style="background:#6366f1;color:white;padding:8px 16px;border-radius:8px;font-size:13px;white-space:nowrap">Visit</a>` : ''}
      </div>`).join('')}
    </div>
  </body></html>`);
}));

// Submit listing form
app.get('/directory/submit', ah(async (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>List Your Business — Comfort Zone</title>
    <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui;background:#f8fafc;color:#1e293b}</style>
  </head><body>
    <nav style="background:white;padding:12px 24px;border-bottom:1px solid #e2e8f0"><a href="/directory" style="font-weight:700;color:#6366f1;text-decoration:none">Business Directory</a></nav>
    <div style="max-width:600px;margin:0 auto;padding:32px 20px">
      <h1 style="margin-bottom:8px">List Your Business</h1>
      <p style="color:#64748b;margin-bottom:24px">Get discovered by thousands of Comfort Zone users for free</p>
      <form method="POST" action="/directory/submit" style="background:white;padding:24px;border-radius:12px;border:1px solid #e2e8f0">
        <div style="display:grid;gap:12px">
          <div><label style="font-weight:500;font-size:13px;display:block;margin-bottom:4px">Business Name *</label><input name="title" required style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px"></div>
          <div><label style="font-weight:500;font-size:13px;display:block;margin-bottom:4px">Category</label><select name="category" style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px">
            <option>technology</option><option>education</option><option>health</option><option>finance</option><option>real_estate</option><option>hospitality</option><option>agriculture</option><option>professional_services</option><option>retail</option><option>general</option>
          </select></div>
          <div><label style="font-weight:500;font-size:13px;display:block;margin-bottom:4px">Description *</label><textarea name="description" required rows="4" style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px"></textarea></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div><label style="font-weight:500;font-size:13px;display:block;margin-bottom:4px">Contact Email</label><input name="contact_email" type="email" style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px"></div>
            <div><label style="font-weight:500;font-size:13px;display:block;margin-bottom:4px">Phone</label><input name="contact_phone" type="tel" style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px"></div>
          </div>
          <div><label style="font-weight:500;font-size:13px;display:block;margin-bottom:4px">Website URL</label><input name="link_url" style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px" placeholder="https://..."></div>
          <label style="display:flex;align-items:center;gap:8px;font-size:13px"><input type="checkbox" name="is_featured" value="1"> Request Featured Listing (UGX 50,000/month)</label>
          <button type="submit" style="width:100%;background:#10b981;color:white;border:none;padding:14px;border-radius:10px;font-size:16px;font-weight:700;cursor:pointer">Submit Listing</button>
        </div>
      </form>
    </div>
  </body></html>`);
}));

app.post('/directory/submit', ah(async (req, res) => {
  const { title, description, category, contact_email, contact_phone, link_url, is_featured } = req.body;
  await pool.query(
    `INSERT INTO featured_listings (title, description, category, contact_email, contact_phone, link_url, is_featured, is_approved)
     VALUES ($1, $2, $3, $4, $5, $6, $7, false)`,
    [title, description, category || 'general', contact_email || null, contact_phone || null, link_url || null, is_featured === '1']
  );
  await trackRevenue('listing_submit', 0.10, `New listing: ${title}`);
  res.send(`<!DOCTYPE html><html><head><title>Listing Submitted!</title>
    <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui;background:#f8fafc;display:flex;align-items:center;justify-content:center;min-height:100vh}
    .card{background:white;padding:40px;border-radius:16px;text-align:center;max-width:500px;box-shadow:0 4px 24px rgba(0,0,0,0.08)}</style>
  </head><body><div class="card">
    <div style="font-size:48px;margin-bottom:16px">Submitted!</div>
    <h2>Your business listing is under review</h2>
    <p style="color:#64748b;margin:12px 0 24px">We will review and publish it within 24 hours</p>
    <a href="/directory" style="display:inline-block;background:#6366f1;color:white;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600">Browse Directory</a>
  </div></body></html>`);
}));

// ============================================================
// === 8. AUTO-SITEMAP.XML — SEO Gold ===
// ============================================================
app.get('/sitemap.xml', ah(async (req, res) => {
  try {
    const [seoPages, jobs, opps, articles] = await Promise.all([
      pool.query("SELECT slug, updated_at FROM seo_pages WHERE is_published = true"),
      pool.query("SELECT id, updated_at FROM jobs WHERE is_active = true"),
      pool.query("SELECT id, created_at FROM opportunities WHERE is_active = true"),
      pool.query("SELECT slug, updated_at FROM premium_content WHERE is_premium = true")
    ]);
    const staticPages = [
      { url: '/', priority: '1.0', freq: 'daily' },
      { url: '/discover', priority: '0.9', freq: 'hourly' },
      { url: '/jobs', priority: '0.9', freq: 'daily' },
      { url: '/opportunities', priority: '0.8', freq: 'daily' },
      { url: '/premium', priority: '0.8', freq: 'weekly' },
      { url: '/directory', priority: '0.8', freq: 'weekly' },
      { url: '/donate', priority: '0.5', freq: 'monthly' },
      { url: '/register', priority: '0.9', freq: 'monthly' },
      { url: '/login', priority: '0.7', freq: 'monthly' },
    ];
    const dynamicPages = [
      ...seoPages.rows.map(r => ({ url: `/s/${r.slug}`, priority: '0.7', lastmod: r.updated_at })),
      ...jobs.rows.map(r => ({ url: `/jobs/${r.id}`, priority: '0.6', lastmod: r.updated_at })),
      ...opps.rows.map(r => ({ url: `/opportunities/${r.id}`, priority: '0.6', lastmod: r.created_at })),
      ...articles.rows.map(r => ({ url: `/premium/${r.slug}`, priority: '0.7', lastmod: r.updated_at })),
    ];
    const allPages = [...staticPages, ...dynamicPages];
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allPages.map(p => `  <url>
    <loc>${BASE_URL}${p.url}</loc>
    <lastmod>${(p.lastmod || new Date()).toISOString().split('T')[0]}</lastmod>
    <changefreq>${p.freq || 'weekly'}</changefreq>
    <priority>${p.priority || '0.5'}</priority>
  </url>`).join('\n')}
</urlset>`;
    res.type('application/xml').send(xml);
  } catch(e) {
    res.type('application/xml').send('<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>');
  }
}));

// Auto robots.txt
app.get('/robots.txt', ah(async (req, res) => {
  res.type('text/plain').send(`User-agent: *
Allow: /
Allow: /discover
Allow: /jobs
Allow: /opportunities
Allow: /premium
Allow: /directory
Allow: /donate
Allow: /s/
Disallow: /admin/
Disallow: /api/
Disallow: /settings/

Sitemap: ${BASE_URL}/sitemap.xml

# Comfort Zone Platform — All-in-one management solution for Uganda and East Africa
`);
}));

// ============================================================
// === 9. PROMO CODES ===
// ============================================================

app.get('/admin/promos', requireAuth, ah(async (req, res) => {
  const u = req.session.user;
  if (u.role !== 'super_admin' && u.role !== 'admin') return res.status(403).send('Access denied');
  const promos = (await pool.query('SELECT * FROM promo_codes ORDER BY created_at DESC')).rows;
  res.send(renderPage('Promo Codes', `
    <div class="hero" style="background:linear-gradient(135deg,#f59e0b,#d97706)"><h1>Promo Codes</h1><p>Create and manage promotional codes</p></div>
    <div class="card" style="margin-bottom:20px">
      <h3>Create Promo Code</h3>
      <form method="POST" action="/admin/promos/create" style="margin-top:12px">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
          <div><label>Code</label><input name="code" required style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px" placeholder="SAVE20"></div>
          <div><label>Discount Type</label><select name="discount_type" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"><option value="percentage">Percentage</option><option value="fixed">Fixed Amount</option><option value="free_trial">Free Trial (days)</option></select></div>
          <div><label>Value</label><input name="discount_value" type="number" required style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px" value="10"></div>
          <div><label>Max Uses</label><input name="max_uses" type="number" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px" value="100"></div>
          <div><label>Expires</label><input name="expires_at" type="date" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></div>
          <div><label>Description</label><input name="description" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px" placeholder="Holiday special"></div>
        </div>
        <button type="submit" class="btn" style="background:#f59e0b;margin-top:12px">Create Code</button>
      </form>
    </div>
    <div class="card"><h3>All Codes</h3>
      <table style="width:100%;margin-top:8px"><thead><tr style="border-bottom:2px solid #e2e8f0"><th style="text-align:left;padding:8px">Code</th><th>Type</th><th>Value</th><th>Used</th><th>Status</th></tr></thead><tbody>
        ${promos.map(p => `<tr style="border-bottom:1px solid #f1f5f9"><td style="padding:8px;font-weight:600;font-family:monospace">${esc(p.code)}</td><td style="padding:8px">${esc(p.discount_type)}</td><td style="padding:8px">${p.discount_value}${p.discount_type==='percentage'?'%':''}</td><td style="padding:8px">${p.used_count}/${p.max_uses}</td><td style="padding:8px">${p.is_active?'<span style="color:#10b981">Active</span>':'<span style="color:#94a3b8">Expired</span>'}</td></tr>`).join('')}
      </tbody></table>
    </div>
  `, req.session.user));
}));

app.post('/admin/promos/create', requireAuth, ah(async (req, res) => {
  const { code, discount_type, discount_value, max_uses, expires_at, description } = req.body;
  await pool.query(
    `INSERT INTO promo_codes (code, discount_type, discount_value, max_uses, expires_at, description) VALUES ($1, $2, $3, $4, $5, $6)`,
    [code.toUpperCase(), discount_type, parseFloat(discount_value), parseInt(max_uses) || 100, expires_at || null, description || null]
  );
  res.redirect('/admin/promos');
}));

// Validate promo code API
app.post('/api/promo/validate', ah(async (req, res) => {
  const { code } = req.body;
  const promo = (await pool.query(
    `SELECT * FROM promo_codes WHERE code = $1 AND is_active = true AND (expires_at IS NULL OR expires_at >= NOW()) AND used_count < max_uses`,
    [code.toUpperCase()]
  )).rows[0];
  if (promo) {
    res.json({ valid: true, code: promo.code, type: promo.discount_type, value: promo.discount_value, remaining: promo.max_uses - promo.used_count });
  } else {
    res.json({ valid: false });
  }
}));

// ============================================================
// === 10. REVENUE DASHBOARD — Track ALL earnings ===
// ============================================================

app.get('/admin/revenue', requireAuth, ah(async (req, res) => {
  const u = req.session.user;
  if (u.role !== 'super_admin' && u.role !== 'admin') return res.status(403).send('Access denied');
  const [totalRev, bySource, todayRev, thisWeek, thisMonth, dailyTrend, topAds, topAffiliates, leadCount] = await Promise.all([
    pool.query('SELECT COALESCE(SUM(amount_usd), 0) as total, COALESCE(SUM(amount_ugx), 0) as total_ugx FROM site_revenue'),
    pool.query('SELECT source, SUM(amount_usd) as total, COUNT(*) as transactions FROM site_revenue GROUP BY source ORDER BY total DESC LIMIT 15'),
    pool.query("SELECT COALESCE(SUM(amount_usd), 0) as total FROM site_revenue WHERE created_at >= CURRENT_DATE"),
    pool.query("SELECT COALESCE(SUM(amount_usd), 0) as total FROM site_revenue WHERE created_at >= NOW() - INTERVAL '7 days'"),
    pool.query("SELECT COALESCE(SUM(amount_usd), 0) as total FROM site_revenue WHERE created_at >= DATE_TRUNC('month', CURRENT_DATE)"),
    pool.query("SELECT DATE(created_at) as day, SUM(amount_usd) as total FROM site_revenue WHERE created_at >= NOW() - INTERVAL '30 days' GROUP BY DATE(created_at) ORDER BY day"),
    pool.query('SELECT title, SUM(revenue_usd) as rev, SUM(impressions) as imp, SUM(clicks) as clk FROM ad_banners GROUP BY title ORDER BY rev DESC LIMIT 5'),
    pool.query('SELECT slug, destination_url, clicks, revenue FROM cloaked_links ORDER BY clicks DESC LIMIT 5'),
    pool.query("SELECT (SELECT COUNT(*) FROM exit_captures) + (SELECT COUNT(*) FROM newsletter_subscribers) + (SELECT COUNT(*) FROM lead_captures) as total")
  ]);
  const t = Number(totalRev.rows[0].total).toFixed(2);
  const tUgx = Number(totalRev.rows[0].total_ugx).toLocaleString();
  const td = Number(todayRev.rows[0].total).toFixed(2);
  const tw = Number(thisWeek.rows[0].total).toFixed(2);
  const tm = Number(thisMonth.rows[0].total).toFixed(2);
  // Simple sparkline from daily trend
  const sparkData = dailyTrend.rows.map(r => Number(r.total).toFixed(2));
  const sparkMax = Math.max(...sparkData.map(Number), 0.01);
  const sparkBars = sparkData.map((v,i) => {
    const h = Math.max((Number(v)/sparkMax)*60, 2);
    return `<div style="flex:1;height:${h}px;background:linear-gradient(to top,#6366f1,#a78bfa);border-radius:2px 2px 0 0" title="$${v}"></div>`;
  }).join('');

  res.send(renderPage('Revenue Dashboard', `
    <div class="hero" style="background:linear-gradient(135deg,#10b981,#059669)"><h1>Revenue Dashboard</h1><p>Every click, every visit, every interaction earns you money</p></div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:24px">
      <div class="stat-card"><div class="stat-num" style="color:#10b981">$${t}</div><div>Total Earned</div><div style="font-size:12px;color:#94a3b8">UGX ${tUgx}</div></div>
      <div class="stat-card"><div class="stat-num" style="color:#f59e0b">$${td}</div><div>Today</div></div>
      <div class="stat-card"><div class="stat-num" style="color:#6366f1">$${tw}</div><div>This Week</div></div>
      <div class="stat-card"><div class="stat-num" style="color:#ef4444">$${tm}</div><div>This Month</div></div>
    </div>
    <div style="display:grid;grid-template-columns:2fr 1fr;gap:16px;margin-bottom:24px">
      <div class="card">
        <h3>Revenue by Source</h3>
        <table style="width:100%;margin-top:8px"><thead><tr style="border-bottom:2px solid #e2e8f0"><th style="text-align:left;padding:8px">Source</th><th>Revenue</th><th>Transactions</th></tr></thead><tbody>
          ${bySource.rows.map(r => `<tr style="border-bottom:1px solid #f1f5f9"><td style="padding:8px">${esc(r.source)}</td><td style="padding:8px;color:#10b981;font-weight:600">$${Number(r.total).toFixed(2)}</td><td style="padding:8px;text-align:center">${r.transactions}</td></tr>`).join('')}
        </tbody></table>
      </div>
      <div class="card">
        <h3>30-Day Trend</h3>
        <div style="display:flex;align-items:end;gap:2px;height:80px;margin-top:12px">${sparkBars}</div>
        <div style="margin-top:16px">
          <h4>Top Ads</h4>
          ${topAds.rows.map(a => `<div style="font-size:13px;padding:4px 0;border-bottom:1px solid #f1f5f9">${esc(a.title)}: <span style="color:#10b981;font-weight:600">$${Number(a.rev).toFixed(2)}</span> (${a.imp} imp, ${a.clk} clicks)</div>`).join('')}
        </div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px">
      <div class="card">
        <h3>Top Affiliate Links</h3>
        ${topAffiliates.rows.map(l => `<div style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px"><code style="background:#f1f5f9;padding:2px 6px;border-radius:4px;font-size:12px">/go/${esc(l.slug)}</code> — ${l.clicks} clicks — <span style="color:#10b981">$${Number(l.revenue||0).toFixed(2)}</span></div>`).join('')}
      </div>
      <div class="card">
        <h3>Lead Generation</h3>
        <div style="font-size:28px;font-weight:700;color:#6366f1">${Number(leadCount.rows[0].total).toLocaleString()}</div>
        <p style="color:#64748b;font-size:13px">Total leads captured (emails = money)</p>
        <p style="color:#10b981;font-size:13px;margin-top:8px">Estimated value: $${(Number(leadCount.rows[0].total) * 1.50).toFixed(2)}</p>
      </div>
    </div>
  `, req.session.user));
}));

// ============================================================
// === 11. UNIVERSAL TRACKING SNIPPET (embed in all pages) ===
// ============================================================

// This is served as a JS snippet that can be included in any page
app.get('/js/monetization.js', ah(async (req, res) => {
  const jsSnippet = `
// === COMFORT ZONE MONETIZATION TRACKER ===
(function(){
  // 1. Track page visit
  fetch('/api/track/visit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({page:location.href,referrer:document.referrer})}).catch(function(){});

  // 2. Load social proof popup (random delay)
  setTimeout(function(){
    fetch('/api/social-proof').then(function(r){return r.json()}).then(function(d){
      if(!d.display_text)return;
      var p=document.createElement('div');
      p.id='cz-social-proof';
      p.style.cssText='position:fixed;bottom:20px;left:20px;background:white;padding:14px 20px;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,0.12);z-index:9999;max-width:320px;font-family:system-ui;transform:translateY(100px);opacity:0;transition:all 0.5s ease';
      p.innerHTML='<div style="display:flex;align-items:center;gap:10px"><div style="width:36px;height:36px;background:linear-gradient(135deg,#6366f1,#8b5cf6);border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-size:16px">✓</div><div><div style="font-size:13px;font-weight:600;color:#1e293b">'+d.display_text+'</div></div></div>';
      document.body.appendChild(p);
      setTimeout(function(){p.style.transform='translateY(0)';p.style.opacity='1'},100);
      setTimeout(function(){p.style.transform='translateY(100px)';p.style.opacity='0';setTimeout(function(){if(p.parentNode)p.parentNode.removeChild(p)},500)},5000);
    }).catch(function(){});
  },8000+Math.random()*12000);

  // 3. Exit intent popup
  var exitShown=false;
  document.addEventListener('mouseout',function(e){
    if(e.clientY<5&&!exitShown){
      exitShown=true;
      var overlay=document.createElement('div');
      overlay.id='cz-exit-overlay';
      overlay.style.cssText='position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);z-index:99999;display:flex;align-items:center;justify-content:center';
      overlay.innerHTML='<div style="background:white;padding:32px;border-radius:16px;max-width:440px;width:90%;text-align:center"><div style="font-size:40px;margin-bottom:12px">Wait! 🎁</div><h2 style="margin-bottom:8px">Get Free Daily Updates</h2><p style="color:#64748b;margin-bottom:20px;font-size:14px">Top news, jobs & scholarships delivered to your inbox every morning. Join 5,000+ readers!</p><form onsubmit="var e=this.email.value;fetch(\\'/api/exit-capture\\',{method:\\'POST\\',headers:{\\'Content-Type\\':\\'application/json\\'},body:JSON.stringify({email:e,page_url:location.href})}).then(function(){document.getElementById(\\'cz-exit-overlay\\').style.display=\\'none\\'});return false"><input name="email" type="email" required placeholder="your@email.com" style="width:100%;padding:12px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;margin-bottom:12px"><button type="submit" style="width:100%;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:white;border:none;padding:12px;border-radius:8px;font-size:15px;font-weight:700;cursor:pointer">Subscribe Free</button></form><a href="javascript:void(0)" onclick="document.getElementById(\\'cz-exit-overlay\\').style.display=\\'none\\'" style="color:#94a3b8;font-size:12px">No thanks, I don\\'t want free updates</a></div>';
      document.body.appendChild(overlay);
    }
  });

  // 4. Track time on page
  var startTime=Date.now();
  window.addEventListener('beforeunload',function(){
    var timeSpent=Math.round((Date.now()-startTime)/1000);
    if(timeSpent>3){fetch('/api/track/time',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({page:location.href,time:timeSpent})}).catch(function(){});}
  });
})();
`;
  res.type('application/javascript').send(jsSnippet);
}));

// Track visit API
app.post('/api/track/visit', ah(async (req, res) => {
  try {
    await pool.query(
      `INSERT INTO visit_analytics (page_url, ip_address, referrer, user_agent, session_id) VALUES ($1, $2, $3, $4, $5)`,
      [req.body.page || '', req.ip, req.body.referrer || '', req.headers['user-agent'] || '', req.sessionID || '']
    );
    // Track page view in existing table too
    await pool.query(
      `INSERT INTO page_views (url, user_email, ip_address, referrer, created_at) VALUES ($1, $2, $3, $4, NOW())`,
      [req.body.page || '', req.session?.user?.email || null, req.ip, req.body.referrer || '']
    );
    res.json({ ok: true });
  } catch(e) { res.json({ ok: false }); }
}));

// Track time on page
app.post('/api/track/time', ah(async (req, res) => {
  try {
    await pool.query(
      `UPDATE visit_analytics SET time_on_page = $1, is_bounce = false WHERE page_url = $2 AND ip_address = $3 ORDER BY created_at DESC LIMIT 1`,
      [req.body.time || 0, req.body.page || '', req.ip]
    );
    res.json({ ok: true });
  } catch(e) { res.json({ ok: false }); }
}));

// ============================================================
// === 12. COMMENT SYSTEM — More engagement = more traffic ===
// ============================================================

app.post('/api/comments', ah(async (req, res) => {
  const { content_type, content_id, user_name, user_email, comment_text, parent_id } = req.body;
  if (!comment_text || !user_name) return res.json({ success: false, error: 'Name and comment required' });
  const comment = (await pool.query(
    `INSERT INTO comments (content_type, content_id, user_name, user_email, comment_text, parent_id, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [content_type || 'scraped', parseInt(content_id) || 0, user_name, user_email || null, comment_text, parseInt(parent_id) || null, req.ip]
  )).rows[0];
  await trackRevenue('comment', 0.02, `Comment by ${user_name}`);
  res.json({ success: true, comment });
}));

app.get('/api/comments/:type/:id', ah(async (req, res) => {
  const comments = (await pool.query(
    `SELECT * FROM comments WHERE content_type = $1 AND content_id = $2 AND is_approved = true AND parent_id IS NULL ORDER BY created_at DESC LIMIT 50`,
    [req.params.type, req.params.id]
  )).rows;
  const replies = (await pool.query(
    `SELECT * FROM comments WHERE content_type = $1 AND content_id = $2 AND is_approved = true AND parent_id IS NOT NULL ORDER BY created_at`,
    [req.params.type, req.params.id]
  )).rows;
  res.json({ comments, replies });
}));

// ============================================================
// === 13. COOKIE CONSENT BAR (GDPR compliant = Google AdSense ready) ===
// ============================================================
app.get('/js/cookie-consent.js', ah(async (req, res) => {
  res.type('application/javascript').send(`
(function(){
  if(localStorage.getItem('cz_cookies_accepted'))return;
  var bar=document.createElement('div');
  bar.id='cz-cookie-bar';
  bar.style.cssText='position:fixed;bottom:0;left:0;right:0;background:#1e293b;color:white;padding:16px 24px;z-index:99999;display:flex;align-items:center;justify-content:space-between;gap:16px;font-family:system-ui;font-size:14px';
  bar.innerHTML='<div style="flex:1"><span>We use cookies to improve your experience and show relevant ads. By continuing, you agree to our </span><a href="/privacy" style="color:#a78bfa;text-decoration:underline">Privacy Policy</a></div><div style="display:flex;gap:8px"><button onclick="localStorage.setItem(\\'cz_cookies_accepted\\',\\'all\\');document.getElementById(\\'cz-cookie-bar\\').remove()" style="background:#10b981;color:white;border:none;padding:8px 20px;border-radius:6px;cursor:pointer;font-weight:600">Accept All</button><button onclick="localStorage.setItem(\\'cz_cookies_accepted\\',\\'essential\\');document.getElementById(\\'cz-cookie-bar\\').remove()" style="background:#475569;color:white;border:none;padding:8px 20px;border-radius:6px;cursor:pointer">Essential Only</button></div>';
  document.body.appendChild(bar);
})();
`);
}));

// ============================================================
// === 14. FLOATING CTA BAR — Always-visible engagement ===
// ============================================================
app.get('/js/cta-bar.js', ah(async (req, res) => {
  const promoCode = 'WELCOME' + Math.floor(Math.random()*20+10);
  res.type('application/javascript').send(`
(function(){
  if(window.innerWidth<768||localStorage.getItem('cz_cta_dismissed'))return;
  var bar=document.createElement('div');
  bar.id='cz-cta-bar';
  bar.style.cssText='position:fixed;top:0;left:0;right:0;background:linear-gradient(90deg,#6366f1,#8b5cf6);color:white;padding:8px 16px;z-index:9998;display:flex;align-items:center;justify-content:center;gap:12px;font-family:system-ui;font-size:13px;box-shadow:0 2px 10px rgba(0,0,0,0.1)';
  bar.innerHTML='<span style="font-weight:600">Get Started Free</span><span style="opacity:0.8">— Manage your school, church, or business all in one place</span><a href="/register?promo=${promoCode}" style="background:white;color:#6366f1;padding:4px 14px;border-radius:6px;text-decoration:none;font-weight:700;font-size:12px">Join Now</a><button onclick="localStorage.setItem(\\'cz_cta_dismissed\\',\\'1\\');document.getElementById(\\'cz-cta-bar\\').remove()" style="background:none;border:none;color:white;cursor:pointer;font-size:16px;padding:0 4px;margin-left:8px">✕</button>';
  document.body.appendChild(bar);
  document.body.style.paddingTop='40px';
})();
`);
}));

// ============================================================
// === 15. PUSH NOTIFICATION SUBSCRIPTION ===
// ============================================================
app.post('/api/push/subscribe', ah(async (req, res) => {
  const { endpoint, keys } = req.body;
  if (!endpoint) return res.json({ success: false });
  try {
    await pool.query(
      `INSERT INTO push_subscriptions (endpoint, keys_json, user_email, ip_address) VALUES ($1, $2, $3, $4) ON CONFLICT (endpoint) DO NOTHING`,
      [endpoint, keys ? JSON.stringify(keys) : null, req.session?.user?.email || null, req.ip]
    );
    res.json({ success: true });
  } catch(e) { res.json({ success: false }); }
}));

// ============================================================
// === 16. LEAD MAGNET SYSTEM ===
// ============================================================

// Admin: Manage lead magnets
app.get('/admin/lead-magnets', requireAuth, ah(async (req, res) => {
  const u = req.session.user;
  if (u.role !== 'super_admin' && u.role !== 'admin') return res.status(403).send('Access denied');
  const magnets = (await pool.query('SELECT lm.*, COUNT(lc.id) as downloads FROM lead_magnets lm LEFT JOIN lead_captures lc ON lm.id = lc.magnet_id GROUP BY lm.id ORDER BY lm.created_at DESC')).rows;
  res.send(renderPage('Lead Magnets', `
    <div class="hero" style="background:linear-gradient(135deg,#6366f1,#8b5cf6)"><h1>Lead Magnets</h1><p>Give away free resources in exchange for email addresses</p></div>
    <div class="card" style="margin-bottom:20px">
      <h3>Create Lead Magnet</h3>
      <form method="POST" action="/admin/lead-magnets/create" style="margin-top:12px">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div><label>Title</label><input name="title" required style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px" placeholder="Free Business Plan Template"></div>
          <div><label>File URL</label><input name="file_url" required style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px" placeholder="https://drive.google.com/..."></div>
        </div>
        <div style="margin-top:12px"><label>Description</label><textarea name="description" rows="3" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></textarea></div>
        <button type="submit" class="btn" style="background:#6366f1;margin-top:12px">Create Magnet</button>
      </form>
    </div>
    <div class="card"><h3>Your Lead Magnets</h3>
      <table style="width:100%;margin-top:8px"><thead><tr style="border-bottom:2px solid #e2e8f0"><th style="text-align:left;padding:8px">Title</th><th>Downloads</th><th>Status</th></tr></thead><tbody>
        ${magnets.map(m => `<tr style="border-bottom:1px solid #f1f5f9"><td style="padding:8px">${esc(m.title)}</td><td style="padding:8px;text-align:center;color:#10b981;font-weight:600">${m.downloads}</td><td style="padding:8px">${m.is_active?'<span style="color:#10b981">Active</span>':'<span style="color:#94a3b8">Inactive</span>'}</td></tr>`).join('')}
      </tbody></table>
    </div>
  `, req.session.user));
}));

app.post('/admin/lead-magnets/create', requireAuth, ah(async (req, res) => {
  const { title, file_url, description } = req.body;
  await pool.query(`INSERT INTO lead_magnets (title, file_url, description) VALUES ($1, $2, $3)`, [title, file_url, description || null]);
  res.redirect('/admin/lead-magnets');
}));

// Public: Download lead magnet (requires email)
app.get('/download/:id', ah(async (req, res) => {
  const magnet = (await pool.query('SELECT * FROM lead_magnets WHERE id = $1 AND is_active = true', [req.params.id])).rows[0];
  if (!magnet) return res.status(404).send('Not found');
  const email = req.query.email;
  if (magnet.required_email && !email) {
    // Show email capture form
    res.send(`<!DOCTYPE html><html><head><title>Download — Comfort Zone</title>
      <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui;background:#f8fafc;display:flex;align-items:center;justify-content:center;min-height:100vh}</style>
    </head><body><div style="background:white;padding:40px;border-radius:16px;max-width:440px;width:90%;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,0.08)">
      <h1 style="margin-bottom:8px">Download: ${esc(magnet.title)}</h1>
      <p style="color:#64748b;margin-bottom:20px">${esc(magnet.description || 'Enter your email to download')}</p>
      <form method="GET" action="/download/${magnet.id}">
        <input name="email" type="email" required placeholder="your@email.com" style="width:100%;padding:12px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;margin-bottom:12px">
        <button type="submit" style="width:100%;background:#6366f1;color:white;border:none;padding:12px;border-radius:8px;font-weight:700;cursor:pointer">Download Free</button>
      </form>
    </div></body></html>`);
  } else {
    // Record the lead and redirect
    if (email) {
      await pool.query(`INSERT INTO lead_captures (magnet_id, email) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [magnet.id, email]);
      await pool.query('INSERT INTO newsletter_subscribers (email, source) VALUES ($1, $2) ON CONFLICT DO NOTHING', [email, 'lead_magnet']);
      await trackRevenue('lead_magnet_download', 0.30, `Lead magnet download: ${magnet.title} by ${email}`);
    }
    res.redirect(magnet.file_url);
  }
}));

// ============================================================
// === 17. LANDING PAGE BUILDER ===
// ============================================================

app.get('/admin/landing-pages', requireAuth, ah(async (req, res) => {
  const u = req.session.user;
  if (u.role !== 'super_admin' && u.role !== 'admin') return res.status(403).send('Access denied');
  const pages = (await pool.query('SELECT * FROM landing_pages ORDER BY created_at DESC')).rows;
  res.send(renderPage('Landing Pages', `
    <div class="hero" style="background:linear-gradient(135deg,#ef4444,#f59e0b)"><h1>Landing Page Builder</h1><p>Create high-converting landing pages for campaigns</p></div>
    <div class="card" style="margin-bottom:20px">
      <h3>Create Landing Page</h3>
      <form method="POST" action="/admin/landing-pages/create" style="margin-top:12px">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div><label>Page Title</label><input name="title" required style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></div>
          <div><label>URL Slug</label><input name="slug" required style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px" placeholder="my-campaign"></div>
          <div><label>Headline</label><input name="headline" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px" placeholder="Transform Your Business Today"></div>
          <div><label>Sub-headline</label><input name="subheadline" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px" placeholder="Join 10,000+ happy users"></div>
          <div><label>CTA Text</label><input name="cta_text" value="Get Started Free" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></div>
          <div><label>CTA Link</label><input name="cta_link" value="/register" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></div>
          <div><label>Benefits (comma-separated)</label><input name="benefits" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px" placeholder="Save time,Reduce costs,Increase productivity"></div>
          <div><label>Testimonial Name</label><input name="testimonial_name" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px" placeholder="John Mukasa"></div>
        </div>
        <div style="margin-top:12px"><label>Testimonial Text</label><textarea name="testimonial_text" rows="2" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px" placeholder="This platform changed how we run our school..."></textarea></div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-top:12px">
          <div><label>Background Color</label><input name="bg_color" value="#6366f1" type="color" style="width:100%;height:40px;padding:2px;border:1px solid #e2e8f0;border-radius:8px"></div>
          <div><label>Text Color</label><input name="text_color" value="white" type="color" style="width:100%;height:40px;padding:2px;border:1px solid #e2e8f0;border-radius:8px"></div>
        </div>
        <button type="submit" class="btn" style="background:#ef4444;margin-top:12px">Create Landing Page</button>
      </form>
    </div>
    <div class="card"><h3>All Landing Pages</h3>
      <table style="width:100%;margin-top:8px"><thead><tr style="border-bottom:2px solid #e2e8f0"><th style="text-align:left;padding:8px">Title</th><th>URL</th><th>Views</th><th>Conversions</th><th>Rate</th></tr></thead><tbody>
        ${pages.map(p => `<tr style="border-bottom:1px solid #f1f5f9"><td style="padding:8px">${esc(p.title)}</td><td style="padding:8px"><a href="/lp/${esc(p.slug)}" target="_blank" style="color:#6366f1">/lp/${esc(p.slug)}</a></td><td style="padding:8px;text-align:center">${p.view_count}</td><td style="padding:8px;text-align:center;color:#10b981">${p.conversion_count}</td><td style="padding:8px;text-align:center">${p.view_count > 0 ? (p.conversion_count/p.view_count*100).toFixed(1) : 0}%</td></tr>`).join('')}
      </tbody></table>
    </div>
  `, req.session.user));
}));

app.post('/admin/landing-pages/create', requireAuth, ah(async (req, res) => {
  const { title, slug, headline, subheadline, cta_text, cta_link, benefits, testimonial_name, testimonial_text, bg_color, text_color } = req.body;
  const benefitsArr = (benefits || '').split(',').map(b => b.trim()).filter(Boolean);
  await pool.query(
    `INSERT INTO landing_pages (slug, title, headline, subheadline, cta_text, cta_link, benefits, testimonial_name, testimonial_text, bg_color, text_color)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [slug, title, headline || title, subheadline || '', cta_text || 'Get Started Free', cta_link || '/register', benefitsArr, testimonial_name || null, testimonial_text || null, bg_color || '#6366f1', text_color || 'white']
  );
  res.redirect('/admin/landing-pages');
}));

// Serve landing page publicly
app.get('/lp/:slug', ah(async (req, res) => {
  const page = (await pool.query('SELECT * FROM landing_pages WHERE slug = $1 AND is_published = true', [req.params.slug])).rows[0];
  if (!page) return res.status(404).send('Page not found');
  await pool.query('UPDATE landing_pages SET view_count = view_count + 1 WHERE id = $1', [page.id]);
  const benefitsHtml = (page.benefits || []).map(b => `<li style="padding:8px 0;font-size:16px">${esc(b)}</li>`).join('');
  res.send(`<!DOCTYPE html><html><head><title>${esc(page.title)}</title>
    <meta name="description" content="${esc(page.subheadline || page.title)}">
    <meta name="robots" content="index, follow">
    <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui;background:#f8fafc;color:#1e293b}a{color:inherit;text-decoration:none}</style>
  </head><body>
    <div style="background:${page.bg_color};color:${page.text_color};padding:80px 20px;text-align:center;min-height:80vh;display:flex;flex-direction:column;align-items:center;justify-content:center">
      <h1 style="font-size:42px;max-width:700px;line-height:1.2">${esc(page.headline || page.title)}</h1>
      <p style="font-size:18px;opacity:0.9;margin-top:16px;max-width:600px">${esc(page.subheadline || '')}</p>
      <div style="margin-top:32px">
        <a href="${esc(page.cta_link)}" onclick="fetch('/api/track/lp-convert/${page.id}',{method:'POST'});return true" style="display:inline-block;background:white;color:${page.bg_color};padding:16px 40px;border-radius:12px;font-size:18px;font-weight:700;box-shadow:0 4px 20px rgba(0,0,0,0.2)">${esc(page.cta_text)}</a>
      </div>
      ${benefitsHtml ? `<ul style="list-style:none;margin-top:40px;text-align:left;max-width:500px">${benefitsHtml}</ul>` : ''}
      ${page.testimonial_text ? `
      <div style="margin-top:48px;background:rgba(255,255,255,0.15);padding:24px 32px;border-radius:12px;max-width:500px;font-style:italic;font-size:16px">
        "${esc(page.testimonial_text)}"
        ${page.testimonial_name ? `<div style="margin-top:8px;font-style:normal;font-weight:600;font-size:14px;opacity:0.8">— ${esc(page.testimonial_name)}</div>` : ''}
      </div>` : ''}
    </div>
    <script>/* Track landing page engagement */</script>
  </body></html>`);
}));

// Track landing page conversion
app.post('/api/track/lp-convert/:id', ah(async (req, res) => {
  await pool.query('UPDATE landing_pages SET conversion_count = conversion_count + 1 WHERE id = $1', [req.params.id]);
  await trackRevenue('lp_conversion', 0.10, `Landing page conversion: ${req.params.id}`);
  res.json({ ok: true });
}));

// ============================================================
// === 18. ENGAGEMENT SCORING SYSTEM ===
// ============================================================
app.get('/admin/engagement', requireAuth, ah(async (req, res) => {
  const u = req.session.user;
  if (u.role !== 'super_admin' && u.role !== 'admin') return res.status(403).send('Access denied');
  const scores = (await pool.query('SELECT * FROM engagement_scores ORDER BY total_score DESC LIMIT 50')).rows;
  const tiers = { bronze: { min: 0, color: '#92400e', bg: '#fef3c7' }, silver: { min: 50, color: '#475569', bg: '#f1f5f9' }, gold: { min: 150, color: '#92400e', bg: '#fef3c7' }, platinum: { min: 500, color: '#1e40af', bg: '#dbeafe' }, diamond: { min: 1000, color: '#7c3aed', bg: '#ede9fe' } };
  res.send(renderPage('User Engagement', `
    <div class="hero" style="background:linear-gradient(135deg,#6366f1,#8b5cf6)"><h1>User Engagement Scores</h1><p>Identify your most valuable users for targeted upsells</p></div>
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:24px">
      ${Object.entries(tiers).map(([name, t]) => `<div style="background:${t.bg};padding:12px;border-radius:8px;text-align:center"><div style="font-weight:700;color:${t.color};text-transform:capitalize">${name}</div><div style="font-size:12px;color:#64748b">${t.min}+ pts</div></div>`).join('')}
    </div>
    <div class="card"><h3>Top Engaged Users</h3>
      <table style="width:100%;margin-top:8px"><thead><tr style="border-bottom:2px solid #e2e8f0"><th style="text-align:left;padding:8px">User</th><th>Profile</th><th>Activity</th><th>Social</th><th>Total</th><th>Tier</th></tr></thead><tbody>
        ${scores.map(s => {
          const t = tiers[s.tier] || tiers.bronze;
          return `<tr style="border-bottom:1px solid #f1f5f9"><td style="padding:8px;font-size:13px">${esc(s.user_email)}</td><td style="padding:8px;text-align:center">${s.profile_score}</td><td style="padding:8px;text-align:center">${s.activity_score}</td><td style="padding:8px;text-align:center">${s.social_score}</td><td style="padding:8px;text-align:center;font-weight:700">${s.total_score}</td><td style="padding:8px;text-align:center"><span style="background:${t.bg};color:${t.color};padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600;text-transform:capitalize">${s.tier}</span></td></tr>`;
        }).join('')}
      </tbody></table>
    </div>
  `, req.session.user));
}));

// ============================================================
// === 19. QUICK SETUP: Seed default ads & social proof ===
// ============================================================
async function seedMonetizationData() {
  // Seed default ad banners
  const adCount = (await pool.query('SELECT COUNT(*) FROM ad_banners')).rows[0].count;
  if (parseInt(adCount) === 0) {
    const defaultAds = [
      { title: 'Welcome Banner', placement: 'header', link_url: '/register', html_content: '<div style="background:linear-gradient(90deg,#6366f1,#8b5cf6);color:white;padding:10px 20px;text-align:center"><span style="font-weight:600">Manage your school, church, or business for FREE</span> <a href="/register" style="background:white;color:#6366f1;padding:4px 14px;border-radius:6px;text-decoration:none;font-weight:700;margin-left:12px">Get Started</a></div>', priority: 10 },
      { title: 'Sidebar Ad Space', placement: 'sidebar', html_content: '<div style="background:#f8fafc;padding:16px;border-radius:8px;text-align:center;border:1px dashed #cbd5e1"><p style="color:#64748b;font-size:13px">Advertise Here</p><a href="/directory/submit" style="display:inline-block;background:#6366f1;color:white;padding:6px 14px;border-radius:6px;text-decoration:none;font-size:12px;margin-top:6px">List Your Business</a></div>', priority: 5 },
      { title: 'Footer CTA', placement: 'footer', html_content: '<div style="background:#1e293b;color:white;padding:16px;text-align:center"><p style="font-size:14px">Join 5,000+ users on Comfort Zone</p><a href="/register" style="display:inline-block;background:#10b981;color:white;padding:8px 20px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:8px">Create Free Account</a></div>', priority: 8 },
      { title: 'In-Content Promotion', placement: 'in_content', html_content: '<div style="background:linear-gradient(135deg,#fef3c7,#fde68a);padding:12px;border-radius:8px;text-align:center"><p style="font-weight:600;color:#92400e">Looking for a job?</p><a href="/jobs" style="color:#92400e;text-decoration:underline;font-size:13px">Browse 100+ jobs in Uganda →</a></div>', priority: 7 },
      { title: 'Newsletter Popup', placement: 'popup', html_content: '<div style="padding:24px;text-align:center"><h3 style="font-size:20px">Stay Updated!</h3><p style="color:#64748b;margin:8px 0">Daily news, jobs & opportunities</p><form method="POST" action="/newsletter/subscribe" style="display:flex;gap:6px;margin-top:12px"><input name="email" type="email" required placeholder="Your email" style="flex:1;padding:8px;border:1px solid #e2e8f0;border-radius:6px"><button type="submit" style="background:#6366f1;color:white;border:none;padding:8px 16px;border-radius:6px;cursor:pointer">Subscribe</button></form></div>', priority: 10 },
      { title: 'Floating Bar', placement: 'floating', html_content: '<div style="background:linear-gradient(90deg,#10b981,#059669);color:white;padding:6px 16px;text-align:center;font-size:13px">Limited Offer: Use code <strong>WELCOME10</strong> for bonus features <a href="/register" style="color:white;text-decoration:underline;margin-left:8px">Join Now →</a></div>', priority: 6 },
    ];
    for (const ad of defaultAds) {
      await pool.query(
        `INSERT INTO ad_banners (title, placement, ad_type, html_content, link_url, cpm_rate, priority, is_active) VALUES ($1, $2, 'html', $3, $4, $5, $6, true)`,
        [ad.title, ad.placement, ad.html_content, ad.link_url || null, CPM_RATES[ad.placement] || 2.00, ad.priority]
      ).catch(() => {});
    }
  }

  // Seed social proof
  await seedSocialProof();

  // Seed default lead magnets
  const magnetCount = (await pool.query('SELECT COUNT(*) FROM lead_magnets')).rows[0].count;
  if (parseInt(magnetCount) === 0) {
    await pool.query(`INSERT INTO lead_magnets (title, description, file_url, download_type) VALUES 
      ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      ['Free Business Plan Template', 'A comprehensive business plan template for Ugandan entrepreneurs. Includes financial projections, market analysis, and executive summary templates.', '#', 'pdf']
    ).catch(() => {});
    await pool.query(`INSERT INTO lead_magnets (title, description, file_url, download_type) VALUES 
      ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      ['School Management Guide', 'Complete guide to managing schools efficiently. Covers fee collection, student tracking, staff management, and parent communication.', '#', 'pdf']
    ).catch(() => {});
    await pool.query(`INSERT INTO lead_magnets (title, description, file_url, download_type) VALUES 
      ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      ['Church Growth Toolkit', 'Tools and templates for growing your church membership. Includes visitor follow-up templates, event planning guides, and donation tracking sheets.', '#', 'pdf']
    ).catch(() => {});
  }

  // Seed a promo code
  const promoCount = (await pool.query("SELECT COUNT(*) FROM promo_codes WHERE code = 'WELCOME10'")).rows[0].count;
  if (parseInt(promoCount) === 0) {
    await pool.query(`INSERT INTO promo_codes (code, discount_type, discount_value, max_uses, description) VALUES ('WELCOME10', 'percentage', 10, 10000, 'Welcome bonus for new users')`).catch(() => {});
  }

  // Seed premium content
  const premCount = (await pool.query("SELECT COUNT(*) FROM premium_content")).rows[0].count;
  if (parseInt(premCount) === 0) {
    await pool.query(`INSERT INTO premium_content (title, slug, excerpt, full_content, category) VALUES 
      ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
      ['Complete Guide to School Management Software in Uganda', 'school-management-guide-uganda',
       'Discover how modern school management software is transforming education in Uganda. Learn about fee management, student tracking, UNEB result analysis, parent communication, and more. This comprehensive guide covers everything you need to know about choosing and implementing the right solution for your school.',
       '## Introduction\n\nEducation in Uganda is evolving rapidly, and technology is at the forefront of this transformation. School management software has become an essential tool for administrators, teachers, and parents alike.\n\n## Key Features to Look For\n\n### 1. Fee Management\nAutomate fee collection, track payments, generate receipts, and send reminders to parents. Modern systems support mobile money integration, which is crucial in Uganda where MTN MoMo and Airtel Money dominate.\n\n### 2. Student Information System\nTrack enrollment, attendance, academic performance, and discipline records. The best systems integrate with UNEB for seamless result management.\n\n### 3. Communication Tools\nSend SMS and email notifications to parents about important events, fee reminders, and student progress reports.\n\n### 4. Staff Management\nManage teacher schedules, payroll, leave requests, and performance appraisals in one place.\n\n### 5. Reporting and Analytics\nGenerate detailed reports on student performance, financial health, and operational efficiency.\n\n## Choosing the Right Software\n\nWhen selecting a school management system, consider:\n- Ease of use for non-technical staff\n- Mobile accessibility for parents\n- Offline capability for areas with poor internet\n- Local support and training\n- Cost-effectiveness\n\n## Implementation Tips\n\n1. Start with core modules (students, fees, reports)\n2. Train staff thoroughly before rollout\n3. Get parent buy-in through demonstrations\n4. Start with a pilot group before full deployment\n5. Regularly review and optimize your usage\n\n## Conclusion\n\nThe right school management software can save your institution hours of administrative work weekly, improve communication with parents, and ultimately lead to better educational outcomes for students.',
       'education'
      ]
    ).catch(() => {});
    await pool.query(`INSERT INTO premium_content (title, slug, excerpt, full_content, category) VALUES 
      ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
      ['How to Start a Business in Uganda: Step-by-Step Guide', 'start-business-uganda-guide',
       'Everything you need to know about starting a business in Uganda. From registration with URSB to tax compliance with URA, licensing, and funding options.',
       'Starting a business in Uganda offers tremendous opportunities in one of East Africa\'s fastest-growing economies. This guide walks you through every step.\n\n## Step 1: Business Idea Validation\nBefore investing time and money, validate your business idea by researching the market, talking to potential customers, and analyzing competitors.\n\n## Step 2: Business Registration\nRegister your business with the Uganda Registration Services Bureau (URSB). Choose between:\n- Sole proprietorship\n- Partnership\n- Private limited company\n- Non-governmental organization\n\n## Step 3: Tax Registration\nRegister with Uganda Revenue Authority (URA) for a TIN (Tax Identification Number). Understand your tax obligations including:\n- Income tax\n- VAT (if turnover exceeds UGX 150 million)\n- Local service tax\n- Stamp duty\n\n## Step 4: Licensing\nObtain necessary licenses from your local government and relevant regulatory bodies.\n\n## Step 5: Bank Account\nOpen a business bank account. Most banks require:\n- Certificate of incorporation\n- TIN certificate\n- Board resolution\n- Director identification\n\n## Funding Options\n- Personal savings\n- Family and friends\n- SACCO loans\n- Bank loans\n- Angel investors\n- Government programs (Youth Livelihood Program, UWEP)\n\n## Conclusion\n\nWith proper planning and the right tools, starting a business in Uganda can be a rewarding journey. Use technology to streamline your operations from day one.',
       'business'
      ]
    ).catch(() => {});
  }

  // Seed a default landing page
  const lpCount = (await pool.query("SELECT COUNT(*) FROM landing_pages")).rows[0].count;
  if (parseInt(lpCount) === 0) {
    await pool.query(`INSERT INTO landing_pages (slug, title, headline, subheadline, cta_text, cta_link, benefits, testimonial_name, testimonial_text, bg_color, text_color) VALUES 
      ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      ['free-management-platform', 'Free Management Platform', 'Manage Everything in One Place', 'Schools, churches, businesses, hospitals — all free',
       'Start Free Today', '/register',
       ['100% Free to use','No credit card required','Works on any device','24/7 support'],
       'Grace Nakamya', 'Comfort Zone has transformed how we manage our school. Fee collection is now automatic and parents love the real-time updates!',
       '#6366f1', 'white'
      ]
    ).catch(() => {});
  }

  console.log('[MonetizationEngine] Default data seeded: ads, social proof, lead magnets, promos, premium content, landing pages');
}

// Run seed on load
seedMonetizationData().catch(e => console.warn('[MonetizationEngine] Seed error:', e.message));

console.log('[MonetizationEngine] LOADED: Ad system ($CPM), exit popups, social proof, affiliate cloaker, donations, premium content lock, sitemap, robots.txt, promo codes, revenue dashboard, landing pages, lead magnets, cookie consent, CTA bar, push notifications, comments, engagement scoring');
