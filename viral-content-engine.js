// ============================================================
// === VIRAL CONTENT ENGINE — Growth, SEO, Revenue ===
// ============================================================
// Auto-scrapes real content daily, referral system, viral sharing,
// job board, trending algorithm, SEO boost, ad revenue, email digest,
// social sharing, content recommendation, affiliate links

const FEATURE_MIGRATIONS = [
  // Referral system
  `CREATE TABLE IF NOT EXISTS referrals (
    id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
    referrer_email TEXT NOT NULL, referred_email TEXT NOT NULL,
    referral_code TEXT UNIQUE NOT NULL, status TEXT DEFAULT 'pending',
    reward_earned INTEGER DEFAULT 0, reward_type TEXT DEFAULT 'free_days',
    created_at TIMESTAMPTZ DEFAULT NOW(), converted_at TIMESTAMPTZ,
    UNIQUE(referrer_email, referred_email)
  )`,
  `CREATE TABLE IF NOT EXISTS referral_rewards (
    id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
    user_email TEXT NOT NULL, referral_count INTEGER DEFAULT 0,
    total_reward INTEGER DEFAULT 0, reward_type TEXT DEFAULT 'free_days',
    last_reward_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, user_email)
  )`,
  // Viral share tracking
  `CREATE TABLE IF NOT EXISTS viral_shares (
    id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
    user_email TEXT, content_id INTEGER, content_type TEXT DEFAULT 'scraped',
    platform TEXT, share_url TEXT, click_count INTEGER DEFAULT 0,
    conversion_count INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS share_clicks (
    id SERIAL PRIMARY KEY, share_id INTEGER REFERENCES viral_shares(id) ON DELETE CASCADE,
    ip_address TEXT, user_agent TEXT, country TEXT DEFAULT 'UG',
    converted BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  // Job board
  `CREATE TABLE IF NOT EXISTS jobs (
    id SERIAL PRIMARY KEY, tenant_id INTEGER DEFAULT NULL,
    title TEXT NOT NULL, company TEXT NOT NULL, location TEXT DEFAULT 'Uganda',
    category TEXT DEFAULT 'general', type TEXT DEFAULT 'full-time',
    salary TEXT, description TEXT NOT NULL, requirements TEXT,
    application_url TEXT, application_email TEXT, deadline DATE,
    is_active BOOLEAN DEFAULT true, is_featured BOOLEAN DEFAULT false,
    source TEXT DEFAULT 'manual', source_url TEXT,
    views INTEGER DEFAULT 0, applications INTEGER DEFAULT 0,
    scraped_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW(), expires_at TIMESTAMPTZ
  )`,
  `CREATE TABLE IF NOT EXISTS job_applications (
    id SERIAL PRIMARY KEY, job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
    applicant_name TEXT NOT NULL, applicant_email TEXT NOT NULL,
    phone TEXT, cover_letter TEXT, resume_url TEXT,
    status TEXT DEFAULT 'pending', created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  // Trending content
  `CREATE TABLE IF NOT EXISTS trending_content (
    id SERIAL PRIMARY KEY, content_id INTEGER, content_type TEXT DEFAULT 'scraped',
    category TEXT, title TEXT, score NUMERIC DEFAULT 0,
    views_24h INTEGER DEFAULT 0, shares_24h INTEGER DEFAULT 0,
    clicks_24h INTEGER DEFAULT 0, comments_24h INTEGER DEFAULT 0,
    calculated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(content_id, content_type)
  )`,
  // SEO pages
  `CREATE TABLE IF NOT EXISTS seo_pages (
    id SERIAL PRIMARY KEY, slug TEXT UNIQUE NOT NULL, title TEXT NOT NULL,
    meta_description TEXT, meta_keywords TEXT, heading TEXT,
    content TEXT, schema_markup JSONB, canonical_url TEXT,
    is_published BOOLEAN DEFAULT true, view_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  // Email digest
  `CREATE TABLE IF NOT EXISTS email_digests (
    id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
    user_email TEXT NOT NULL, digest_type TEXT DEFAULT 'daily',
    subject TEXT, content TEXT, sent_at TIMESTAMPTZ,
    click_count INTEGER DEFAULT 0, open_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS digest_subscriptions (
    id SERIAL PRIMARY KEY, email TEXT UNIQUE NOT NULL,
    categories TEXT[] DEFAULT '{news,business,technology}',
    frequency TEXT DEFAULT 'daily', is_active BOOLEAN DEFAULT true,
    subscribed_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  // Affiliate links
  `CREATE TABLE IF NOT EXISTS affiliate_links (
    id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
    original_url TEXT NOT NULL, affiliate_slug TEXT UNIQUE NOT NULL,
    title TEXT, description TEXT, platform TEXT DEFAULT 'generic',
    clicks INTEGER DEFAULT 0, conversions INTEGER DEFAULT 0,
    revenue NUMERIC DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS affiliate_clicks (
    id SERIAL PRIMARY KEY, affiliate_id INTEGER REFERENCES affiliate_links(id) ON DELETE CASCADE,
    ip_address TEXT, user_agent TEXT, referred_from TEXT,
    converted BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  // Content bookmarks & likes
  `CREATE TABLE IF NOT EXISTS content_likes (
    id SERIAL PRIMARY KEY, user_email TEXT NOT NULL, content_id INTEGER NOT NULL,
    content_type TEXT DEFAULT 'scraped', created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_email, content_id, content_type)
  )`,
  `CREATE TABLE IF NOT EXISTS content_bookmarks (
    id SERIAL PRIMARY KEY, user_email TEXT NOT NULL, content_id INTEGER NOT NULL,
    content_type TEXT DEFAULT 'scraped', created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_email, content_id, content_type)
  )`,
  // User engagement tracking
  `CREATE TABLE IF NOT EXISTS page_views (
    id SERIAL PRIMARY KEY, url TEXT NOT NULL, user_email TEXT,
    ip_address TEXT, country TEXT DEFAULT 'UG',
    referrer TEXT, time_on_page INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  // Newsletter subscribers
  `CREATE TABLE IF NOT EXISTS newsletter_subscribers (
    id SERIAL PRIMARY KEY, email TEXT UNIQUE NOT NULL,
    name TEXT, source TEXT DEFAULT 'organic',
    is_verified BOOLEAN DEFAULT false, verification_token TEXT,
    subscribed_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  // Daily rewards / gamification
  `CREATE TABLE IF NOT EXISTS user_points (
    id SERIAL PRIMARY KEY, user_email TEXT UNIQUE NOT NULL,
    points INTEGER DEFAULT 0, level INTEGER DEFAULT 1,
    streak_days INTEGER DEFAULT 0, last_active DATE,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS point_transactions (
    id SERIAL PRIMARY KEY, user_email TEXT NOT NULL,
    points INTEGER NOT NULL, reason TEXT, source TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  // Scholarship / Grant opportunities
  `CREATE TABLE IF NOT EXISTS opportunities (
    id SERIAL PRIMARY KEY, title TEXT NOT NULL, organization TEXT,
    description TEXT, category TEXT DEFAULT 'scholarship',
    deadline DATE, amount TEXT, eligibility TEXT,
    application_url TEXT, country TEXT DEFAULT 'Uganda',
    is_active BOOLEAN DEFAULT true, source TEXT DEFAULT 'manual',
    views INTEGER DEFAULT 0, clicks INTEGER DEFAULT 0,
    scraped_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
];
FEATURE_MIGRATIONS.forEach(m => migrations.push(m));
['referrals','referral_rewards','viral_shares','share_clicks','jobs','job_applications',
 'trending_content','seo_pages','email_digests','digest_subscriptions','affiliate_links',
 'affiliate_clicks','content_likes','content_bookmarks','page_views','newsletter_subscribers',
 'user_points','point_transactions','opportunities'].forEach(t => VALID_TABLES.add(t));

// ============================================================
// === RSS SCRAPE SOURCES — East Africa focused ===
// ============================================================
const SCRAPE_SOURCES = {
  news: [
    { url: 'https://www.newvision.co.ug/rss.xml', source: 'New Vision', max: 15 },
    { url: 'https://www.monitor.co.ug/uganda/rss.xml', source: 'Daily Monitor', max: 15 },
    { url: 'https://www.independent.co.ug/feed/', source: 'The Independent', max: 10 },
    { url: 'https://chimpreports.com/feed/', source: 'Chimp Reports', max: 10 },
    { url: 'https://eagle.co.ug/feed/', source: 'The Eagle Online', max: 8 },
    { url: 'https://pmlive.co.ug/feed/', source: 'PMLive', max: 8 },
    { url: 'https://www.bbc.com/news/world/africa/rss.xml', source: 'BBC Africa', max: 10 },
    { url: 'https://www.aljazeera.com/xml/rss/all.xml', source: 'Al Jazeera', max: 8 },
    { url: 'https://www.theguardian.com/world/africa/rss', source: 'The Guardian Africa', max: 8 },
    { url: 'https://www.reuters.com/world/africa/rss', source: 'Reuters Africa', max: 8 },
  ],
  sports: [
    { url: 'https://www.newvision.co.ug/sports/rss.xml', source: 'New Vision Sports', max: 10 },
    { url: 'https://www.monitor.co.ug/sports/rss.xml', source: 'Monitor Sports', max: 10 },
    { url: 'https://www.bbc.com/sport/africa/rss.xml', source: 'BBC Sport Africa', max: 8 },
  ],
  technology: [
    { url: 'https://techcrunch.com/feed/', source: 'TechCrunch', max: 8 },
    { url: 'https://www.theverge.com/rss/index.xml', source: 'The Verge', max: 8 },
    { url: 'https://www.wired.com/feed/rss', source: 'Wired', max: 5 },
  ],
  business: [
    { url: 'https://www.monitor.co.ug/uganda/business/rss.xml', source: 'Monitor Business', max: 10 },
    { url: 'https://www.newvision.co.ug/business/rss.xml', source: 'New Vision Business', max: 10 },
    { url: 'https://www.bbc.com/news/business/rss.xml', source: 'BBC Business', max: 5 },
  ],
  education: [
    { url: 'https://www.newvision.co.ug/education/rss.xml', source: 'New Vision Education', max: 10 },
    { url: 'https://www.monitor.co.ug/uganda/education/rss.xml', source: 'Monitor Education', max: 10 },
  ],
  health: [
    { url: 'https://www.bbc.com/news/health/rss.xml', source: 'BBC Health', max: 5 },
    { url: 'https://www.who.int/rss-feeds/news-articles/rss.xml', source: 'WHO News', max: 5 },
  ],
  entertainment: [
    { url: 'https://www.boredpanda.com/feed/', source: 'Bored Panda', max: 8 },
    { url: 'https://www.bbc.com/news/entertainment_and_arts/rss.xml', source: 'BBC Entertainment', max: 5 },
  ],
};

// Job scrape sources (free job boards with RSS/API)
const JOB_SOURCES = [
  { url: 'https://ugandanjobline.com/feed/', source: 'Ugandan Jobline', country: 'Uganda' },
  { url: 'https://www.jobsuganda.com/feed', source: 'Jobs Uganda', country: 'Uganda' },
];

// Scholarship / grant sources
const OPPORTUNITY_SOURCES = [
  { url: 'https://www.scholarships.com/rss', source: 'Scholarships.com', category: 'scholarship' },
  { url: 'https://www.grants.gov/rss/community.xml', source: 'Grants.gov', category: 'grant' },
];

// ============================================================
// === SCRAPE ENGINE ===
// ============================================================
let _scrapeLock = false;
const SCRAPE_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours

async function scrapeRSSFeeds() {
  if (_scrapeLock) return;
  _scrapeLock = true;
  let stats = { sources: 0, ok: 0, items: 0 };
  try {
    for (const [category, feeds] of Object.entries(SCRAPE_SOURCES)) {
      for (const feed of feeds) {
        stats.sources++;
        try {
          const res = await fetch(feed.url, {
            headers: { 'User-Agent': 'ComfortZoneBot/1.0 (News Aggregator)', 'Accept': 'application/rss+xml' },
            signal: AbortSignal.timeout(15000)
          });
          if (!res.ok) continue;
          const text = await res.text();
          const items = parseRSS(text, feed.source, category, feed.max);
          for (const item of items) {
            try {
              await pool.query(
                `INSERT INTO scraped_content (title, url, summary, image_url, category, source, scraped_at)
                 VALUES ($1,$2,$3,$4,$5,$6,NOW())
                 ON CONFLICT ON CONSTRAINT scraped_content_tenant_title_source_key DO NOTHING`,
                [item.title, item.url, item.summary || '', item.image_url || '', category, feed.source]
              );
              stats.items++;
            } catch(e) { /* duplicate ok */ }
          }
          stats.ok++;
        } catch(e) { /* feed down, skip */ }
      }
    }
    console.log(`[ViralEngine] Scrape done: ${stats.ok}/${stats.sources} sources, ${stats.items} new items`);
  } catch(e) {
    console.error('[ViralEngine] Scrape error:', e.message);
  } finally {
    _scrapeLock = false;
  }
  return stats;
}

function parseRSS(xmlText, source, category, maxItems) {
  const items = [];
  // Simple regex-based RSS parser (no xml2js dependency needed)
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let match;
  let count = 0;
  while ((match = itemRegex.exec(xmlText)) !== null && count < maxItems) {
    const block = match[1];
    const title = (block.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/i) || block.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '';
    const link = (block.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || '';
    const desc = (block.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/i) || block.match(/<description>([\s\S]*?)<\/description>/i) || [])[1] || '';
    const imgUrl = (block.match(/<media:content[^>]*url="([^"]*)"/i) || block.match(/<enclosure[^>]*url="([^"]*)"/i) || [])[1] || '';
    const pubDate = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1] || '';
    if (title && link) {
      const cleanTitle = title.replace(/<[^>]*>/g, '').trim();
      const cleanDesc = desc.replace(/<[^>]*>/g, '').trim().substring(0, 500);
      items.push({ title: cleanTitle, url: link.trim(), summary: cleanDesc, image_url: imgUrl, source, category, pubDate });
      count++;
    }
  }
  return items;
}

// Auto-scrape jobs
async function scrapeJobs() {
  for (const src of JOB_SOURCES) {
    try {
      const res = await fetch(src.url, {
        headers: { 'User-Agent': 'ComfortZoneBot/1.0' },
        signal: AbortSignal.timeout(15000)
      });
      if (!res.ok) continue;
      const text = await res.text();
      const items = parseRSS(text, src.source, 'jobs', 20);
      for (const item of items) {
        await pool.query(
          `INSERT INTO jobs (title, company, location, description, source, source_url, scraped_at, is_active, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW(), true, NOW() + INTERVAL '30 days')
           ON CONFLICT DO NOTHING`,
          [item.title, src.source, src.country, item.summary || item.title, src.source, item.url]
        ).catch(() => {});
      }
    } catch(e) { /* skip */ }
  }
}

// Calculate trending score
async function calculateTrending() {
  try {
    await pool.query(`
      INSERT INTO trending_content (content_id, content_type, category, title, score, views_24h, shares_24h, clicks_24h, calculated_at)
      SELECT
        sc.id, 'scraped', sc.category, sc.title,
        (COALESCE(sc.view_count, 0) * 1.0 + COALESCE(sc.click_count, 0) * 3.0) / NULLIF(EXTRACT(EPOCH FROM (NOW() - sc.scraped_at)) / 3600, 1) AS score,
        COALESCE(sc.view_count, 0), 0, COALESCE(sc.click_count, 0), NOW()
      FROM scraped_content sc
      WHERE sc.scraped_at >= NOW() - INTERVAL '7 days'
      ON CONFLICT (content_id, content_type) DO UPDATE
      SET score = EXCLUDED.score, views_24h = EXCLUDED.views_24h, clicks_24h = EXCLUDED.clicks_24h, calculated_at = NOW()
      ORDER BY score DESC LIMIT 100
    `);
  } catch(e) { console.warn('[ViralEngine] Trending calc error:', e.message); }
}

// ============================================================
// === REFERRAL SYSTEM ===
// ============================================================
function generateReferralCode() {
  return 'REF' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 6).toUpperCase();
}

// ============================================================
// === SEO AUTO-PAGES ===
// ============================================================
const AUTO_SEO_PAGES = [
  { slug: 'schools-management-software-uganda', title: 'Best School Management Software in Uganda', category: 'education', heading: 'School Management Software Uganda', keywords: 'school management software uganda, school management system, UNEB results management, fee management uganda' },
  { slug: 'church-management-system-uganda', title: 'Church Management System Uganda — Free & Easy', category: 'church', heading: 'Church Management System', keywords: 'church management system uganda, tithe tracking, church membership, choir management' },
  { slug: 'business-pos-system-uganda', title: 'Free POS & Business Management System Uganda', category: 'business', heading: 'POS & Business Management', keywords: 'pos system uganda, inventory management, sales tracking, business software uganda' },
  { slug: 'hospital-clinic-management-uganda', title: 'Clinic & Hospital Management Software Uganda', category: 'health', heading: 'Clinic Management Software', keywords: 'clinic management uganda, hospital management system, patient records, sick bay management' },
  { slug: 'organization-management-platform', title: 'Organization Management Platform — All-in-One', category: 'organization', heading: 'Organization Management', keywords: 'organization management software, NGO management, project tracking, team management' },
  { slug: 'free-accounting-software-uganda', title: 'Free Accounting & Finance Software Uganda', category: 'business', heading: 'Accounting Software', keywords: 'accounting software uganda, free accounting, finance management, budget tracking' },
  { slug: 'online-examination-system', title: 'Online Examination & Quiz System — Create Exams Free', category: 'education', heading: 'Online Examination System', keywords: 'online examination system, quiz maker, online tests, exam software free' },
  { slug: 'employee-payroll-system-uganda', title: 'Employee Payroll & HR Management System Uganda', category: 'business', heading: 'Payroll & HR System', keywords: 'payroll system uganda, HR management, employee management, leave management, staff appraisals' },
  { slug: 'fundraising-platform-uganda', title: 'Free Fundraising & Donation Platform Uganda', category: 'general', heading: 'Fundraising Platform', keywords: 'fundraising platform uganda, donations, crowdfunding, NGO fundraising' },
  { slug: 'e-commerce-store-builder', title: 'Build Your Online Store — Free E-Commerce Platform', category: 'business', heading: 'E-Commerce Platform', keywords: 'e-commerce uganda, online store builder, free online shop, marketplace uganda' },
];

async function seedSEOPages() {
  for (const page of AUTO_SEO_PAGES) {
    try {
      await pool.query(
        `INSERT INTO seo_pages (slug, title, meta_description, meta_keywords, heading, is_published)
         VALUES ($1, $2, $3, $4, $5, true)
         ON CONFLICT (slug) DO NOTHING`,
        [page.slug, page.title, `Discover ${page.title.toLowerCase()}. Free, easy-to-use platform trusted by thousands of organizations across Uganda and East Africa.`, page.keywords, page.heading]
      );
    } catch(e) { /* exists */ }
  }
}

// ============================================================
// === REVENUE: AD CLICK TRACKER ===
// ============================================================
async function trackAdClick(placement, tenantId, ip) {
  try {
    const revPerClick = 0.02; // $0.02 per click
    await pool.query(
      `INSERT INTO ad_clicks (tenant_id, ad_placement, ip_address, revenue_usd, clicked_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [tenantId, placement, ip, revPerClick]
    );
    // Credit developer revenue
    await pool.query(
      `INSERT INTO developer_revenue (tenant_id, amount, source, description, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [tenantId, Math.round(revPerClick * 100), 'ad_click', `Ad click: ${placement}`]
    );
  } catch(e) {}
}

// ============================================================
// === GAMIFICATION: Points for engagement ===
// ============================================================
const POINT_REWARDS = {
  daily_login: 10,
  read_article: 2,
  share_content: 5,
  refer_friend: 50,
  complete_profile: 20,
  submit_feedback: 15,
  bookmark_content: 3,
};

async function awardPoints(email, reason, source) {
  const pts = POINT_REWARDS[reason] || 1;
  try {
    await pool.query(
      `INSERT INTO user_points (user_email, points) VALUES ($1, $2)
       ON CONFLICT (user_email) DO UPDATE SET points = user_points.points + $2, last_active = CURRENT_DATE`,
      [email, pts]
    );
    await pool.query(
      `INSERT INTO point_transactions (user_email, points, reason, source, created_at) VALUES ($1, $2, $3, $4, NOW())`,
      [email, pts, reason, source]
    );
  } catch(e) {}
}

// ============================================================
// === EMAIL DIGEST BUILDER ===
// ============================================================
async function buildDigestEmail(email, categories) {
  const cats = categories.length ? categories : ['news', 'business', 'technology', 'education'];
  const topItems = [];
  for (const cat of cats) {
    try {
      const rows = (await pool.query(
        `SELECT title, url, summary, source, category FROM scraped_content
         WHERE category = $1 AND scraped_at >= NOW() - INTERVAL '24 hours'
         ORDER BY scraped_at DESC LIMIT 3`, [cat]
      )).rows;
      topItems.push(...rows);
    } catch(e) {}
  }
  if (topItems.length === 0) return null;
  const digestHtml = topItems.slice(0, 10).map(item =>
    `<div style="margin-bottom:16px;padding:12px;border:1px solid #e2e8f0;border-radius:8px">
      <span style="background:#f1f5f9;padding:2px 8px;border-radius:4px;font-size:11px;color:#64748b">${esc(item.category)}</span>
      <a href="${esc(item.url)}" style="display:block;font-weight:600;color:#1e293b;text-decoration:none;margin-top:4px;font-size:15px">${esc(item.title)}</a>
      <p style="color:#64748b;font-size:13px;margin:4px 0 0">${esc((item.summary || '').substring(0, 120))}</p>
      <span style="color:#94a3b8;font-size:11px">${esc(item.source)}</span>
    </div>`
  ).join('');
  return {
    subject: `Your Daily Digest — ${topItems.length} trending stories`,
    html: `<div style="font-family:system-ui;max-width:600px;margin:0 auto;padding:20px">
      <h1 style="color:#1e293b">Your Daily Digest</h1>
      <p style="color:#64748b">Top stories curated for you</p>
      ${digestHtml}
      <div style="margin-top:20px;text-align:center">
        <a href="${process.env.BASE_URL || 'https://ssewasswa.onrender.com'}" style="background:#6366f1;color:white;padding:10px 24px;border-radius:8px;text-decoration:none">Read More on Comfort Zone</a>
      </div>
    </div>`
  };
}

// ============================================================
// === ROUTES ===
// ============================================================

// --- PUBLIC DISCOVER / NEWS HUB ---
app.get('/discover', ah(async (req, res) => {
  const cat = req.query.cat || 'news';
  const page = parseInt(req.query.page) || 0;
  const limit = 24;
  const offset = page * limit;
  const allCats = ['news', 'sports', 'business', 'technology', 'education', 'health', 'entertainment'];
  const [items, trending, total] = await Promise.all([
    pool.query(`SELECT * FROM scraped_content WHERE category=$1 ORDER BY scraped_at DESC LIMIT $2 OFFSET $3`, [cat, limit, offset]),
    pool.query(`SELECT * FROM trending_content ORDER BY score DESC LIMIT 10`),
    pool.query(`SELECT COUNT(*) FROM scraped_content WHERE category=$1`, [cat])
  ]);
  const count = parseInt(total.rows[0].count) || 0;
  const totalPages = Math.ceil(count / limit);
  const catTabs = allCats.map(c =>
    `<a href="/discover?cat=${c}" style="padding:8px 16px;border-radius:20px;text-decoration:none;font-size:13px;font-weight:500;${c === cat ? 'background:#6366f1;color:white' : 'background:#f1f5f9;color:#475569'}">${c.charAt(0).toUpperCase() + c.slice(1)}</a>`
  ).join(' ');
  const cards = items.rows.map(item =>
    `<a href="${esc(item.url)}" target="_blank" rel="noopener" style="display:block;gap:16px;padding:16px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;text-decoration:none;color:inherit;margin-bottom:12px" onclick="trackClick(${item.id})">
      <div style="display:flex;gap:12px">
        ${item.image_url ? `<img src="${esc(item.image_url)}" style="width:120px;height:80px;object-fit:cover;border-radius:8px" onerror="this.style.display='none'" loading="lazy">` : ''}
        <div style="flex:1;min-width:0">
          <div style="display:flex;gap:6px;align-items:center;margin-bottom:4px">
            <span style="background:${cat === 'news' ? '#fef3c7;color:#92400e' : cat === 'sports' ? '#dcfce7;color:#166534' : cat === 'tech' ? '#ede9fe;color:#5b21b6' : '#f1f5f9;color:#475569'};padding:2px 8px;border-radius:4px;font-size:11px;font-weight:500">${esc(item.source || item.category)}</span>
            <span style="color:#94a3b8;font-size:11px">${timeAgo(item.scraped_at)}</span>
          </div>
          <h3 style="margin:0 0 4px;font-size:15px;line-height:1.4;color:#1e293b">${esc(item.title)}</h3>
          <p style="margin:0;font-size:13px;color:#64748b;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc((item.summary || '').substring(0, 200))}</p>
        </div>
      </div>
    </a>`
  ).join('');
  const trendingHtml = trending.rows.map(t =>
    `<a href="#" style="display:block;padding:6px 0;color:#475569;text-decoration:none;font-size:13px;border-bottom:1px solid #f1f5f9">🔥 ${esc(t.title || '')}</a>`
  ).join('');
  // Newsletter signup
  const newsletterHtml = `
    <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);color:white;padding:24px;border-radius:16px;margin-top:24px;text-align:center">
      <h2>Get Daily Updates</h2>
      <p style="opacity:0.9;margin-bottom:12px">Top news, jobs, and opportunities delivered to your inbox free</p>
      <form method="POST" action="/newsletter/subscribe" style="display:flex;gap:8px;max-width:400px;margin:0 auto">
        <input name="email" type="email" placeholder="Your email" required style="flex:1;padding:10px 16px;border:none;border-radius:8px;font-size:14px">
        <button type="submit" style="background:#f59e0b;color:white;border:none;padding:10px 20px;border-radius:8px;font-weight:600;cursor:pointer">Subscribe</button>
      </form>
    </div>`;
  // Pagination
  let pagination = '';
  if (totalPages > 1) {
    const pages = Array.from({length: Math.min(totalPages, 10)}, (_, i) => i);
    pagination = `<div style="display:flex;gap:6px;justify-content:center;margin-top:20px">${pages.map(p =>
      `<a href="/discover?cat=${cat}&page=${p}" style="padding:8px 14px;border-radius:8px;text-decoration:none;font-size:13px;${p === page ? 'background:#6366f1;color:white' : 'background:#f1f5f9;color:#475569'}">${p + 1}</a>`
    ).join('')}</div>`;
  }
  res.send(`<!DOCTYPE html><html lang="en"><head>
    <title>${cat.charAt(0).toUpperCase() + cat.slice(1)} — Comfort Zone</title>
    <meta name="description" content="Latest ${cat} from Uganda and East Africa. Aggregated daily from top sources.">
    <meta property="og:title" content="${cat} — Comfort Zone News Hub">
    <meta property="og:description" content="Stay updated with the latest ${cat} from Uganda and East Africa">
    <meta property="og:type" content="website">
    <link rel="canonical" href="${process.env.BASE_URL || ''}/discover?cat=${cat}">
    <meta name="robots" content="index, follow">
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"CollectionPage","name":"Comfort Zone ${cat}","description":"Latest ${cat} from Uganda and East Africa"}</script>
    <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,-apple-system,sans-serif;background:#f8fafc;color:#1e293b}a{color:inherit}</style>
  </head><body>
    <nav style="background:white;padding:12px 24px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between">
      <a href="/" style="font-weight:700;font-size:18px;color:#6366f1;text-decoration:none">Comfort Zone</a>
      <div style="display:flex;gap:16px">
        <a href="/discover" style="color:#475569;text-decoration:none;font-size:14px">News</a>
        <a href="/jobs" style="color:#475569;text-decoration:none;font-size:14px">Jobs</a>
        <a href="/opportunities" style="color:#475569;text-decoration:none;font-size:14px">Scholarships</a>
        <a href="/register" style="background:#6366f1;color:white;padding:8px 16px;border-radius:8px;text-decoration:none;font-size:14px">Get Started Free</a>
      </div>
    </nav>
    <div style="max-width:1100px;margin:0 auto;padding:20px;display:grid;grid-template-columns:1fr 300px;gap:24px">
      <div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px">${catTabs}</div>
        ${cards || '<p style="color:#64748b;text-align:center;padding:40px">No articles yet. Content is scraped automatically every 6 hours.</p>'}
        ${pagination}
        ${newsletterHtml}
      </div>
      <aside>
        <div style="background:white;padding:16px;border-radius:12px;border:1px solid #e2e8f0;position:sticky;top:20px">
          <h3 style="font-size:16px;margin-bottom:12px">Trending Now</h3>
          ${trendingHtml || '<p style="color:#94a3b8;font-size:13px">Calculating trends...</p>'}
        </div>
        <div style="background:#fffbeb;padding:16px;border-radius:12px;border:1px solid #fde68a;margin-top:16px">
          <h3 style="font-size:16px;margin-bottom:8px">Find Scholarships</h3>
          <p style="font-size:13px;color:#92400e;margin-bottom:8px">Funding opportunities updated daily</p>
          <a href="/opportunities" style="display:block;background:#f59e0b;color:white;text-align:center;padding:8px;border-radius:8px;text-decoration:none;font-weight:600">Browse Opportunities</a>
        </div>
      </aside>
    </div>
    <footer style="background:#1e293b;color:white;padding:40px 24px;text-align:center;margin-top:40px">
      <p>Comfort Zone — All-in-one management platform</p>
      <p style="color:#94a3b8;margin-top:8px;font-size:13px">News aggregated from New Vision, Daily Monitor, BBC, Reuters & more</p>
    </footer>
    <script>
    function trackClick(id){fetch('/api/track/click',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,type:'scraped'})}).catch(()=>{})}
    function timeAgo(d){if(!d)return'';const s=Math.floor((Date.now()-new Date(d))/1000);if(s<60)return s+'s ago';if(s<3600)return Math.floor(s/60)+'m ago';if(s<86400)return Math.floor(s/3600)+'h ago';return Math.floor(s/86400)+'d ago'}
    </script>
  </body></html>`);
}));

// Helper: time ago
function timeAgo(date) {
  if (!date) return '';
  const s = Math.floor((Date.now() - new Date(date)) / 1000);
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

// --- PUBLIC JOB BOARD ---
app.get('/jobs', ah(async (req, res) => {
  const cat = req.query.cat || 'all';
  const page = parseInt(req.query.page) || 0;
  const limit = 20;
  const q = req.query.q || '';
  let where = 'WHERE is_active = true AND (expires_at IS NULL OR expires_at >= NOW())';
  const params = [];
  if (cat !== 'all') { params.push(cat); where += ` AND category = $${params.length}`; }
  if (q) { params.push(`%${q}%`); where += ` AND (title ILIKE $${params.length} OR company ILIKE $${params.length} OR description ILIKE $${params.length})`; }
  params.push(limit, page * limit);
  const [jobs, total] = await Promise.all([
    pool.query(`SELECT * FROM jobs ${where} ORDER BY is_featured DESC, created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params),
    pool.query(`SELECT COUNT(*) FROM jobs ${where}`, params.slice(0, -2))
  ]);
  const cats = ['all', 'technology', 'finance', 'healthcare', 'education', 'engineering', 'marketing', 'general'];
  const catTabs = cats.map(c =>
    `<a href="/jobs?cat=${c}" style="padding:6px 14px;border-radius:20px;text-decoration:none;font-size:13px;${c === cat ? 'background:#10b981;color:white' : 'background:#f1f5f9;color:#475569'}">${c === 'all' ? 'All Jobs' : c.charAt(0).toUpperCase() + c.slice(1)}</a>`
  ).join(' ');
  const jobCards = jobs.rows.map(j =>
    `<div style="background:white;padding:16px;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center">
      <div>
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:4px">
          ${j.is_featured ? '<span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600">Featured</span>' : ''}
          <span style="color:#64748b;font-size:12px">${esc(j.company)} · ${esc(j.location)}</span>
        </div>
        <a href="${esc(j.application_url || '/jobs/' + j.id)}" target="_blank" style="font-weight:600;color:#1e293b;text-decoration:none;font-size:15px">${esc(j.title)}</a>
        <p style="color:#64748b;font-size:13px;margin-top:4px">${esc((j.description || '').substring(0, 150))}</p>
        <div style="display:flex;gap:12px;margin-top:8px;font-size:12px;color:#94a3b8">
          ${j.type ? `<span>${esc(j.type)}</span>` : ''}
          ${j.salary ? `<span>${esc(j.salary)}</span>` : ''}
          ${j.deadline ? `<span>Deadline: ${j.deadline}</span>` : ''}
          <span>${j.views || 0} views</span>
        </div>
      </div>
      <a href="${esc(j.application_url || '/jobs/' + j.id)}" target="_blank" style="background:#10b981;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;white-space:nowrap">Apply</a>
    </div>`
  ).join('');
  res.send(`<!DOCTYPE html><html><head><title>Jobs in Uganda — Comfort Zone</title>
    <meta name="description" content="Latest jobs in Uganda. Technology, finance, healthcare, education and more. Updated daily.">
    <meta name="robots" content="index, follow">
    <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui;background:#f8fafc;color:#1e293b}</style>
  </head><body>
    <nav style="background:white;padding:12px 24px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between">
      <a href="/" style="font-weight:700;font-size:18px;color:#6366f1;text-decoration:none">Comfort Zone</a>
      <a href="/jobs/post" style="background:#10b981;color:white;padding:8px 16px;border-radius:8px;text-decoration:none;font-size:14px">Post a Job</a>
    </nav>
    <div style="max-width:800px;margin:0 auto;padding:20px">
      <div style="text-align:center;margin-bottom:24px"><h1 style="font-size:28px">Jobs in Uganda</h1><p style="color:#64748b">Updated daily from top sources</p></div>
      <form method="GET" action="/jobs" style="display:flex;gap:8px;margin-bottom:20px">
        <input name="q" value="${esc(q)}" placeholder="Search jobs..." style="flex:1;padding:10px 16px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px">
        <button type="submit" style="background:#6366f1;color:white;border:none;padding:10px 20px;border-radius:8px;cursor:pointer">Search</button>
      </form>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:20px">${catTabs}</div>
      ${jobCards || '<p style="text-align:center;color:#64748b;padding:40px">No jobs found. Jobs are scraped automatically from top sources.</p>'}
    </div>
  </body></html>`);
}));

// --- OPPORTUNITIES (Scholarships, Grants, Funding) ---
app.get('/opportunities', ah(async (req, res) => {
  const cat = req.query.cat || 'all';
  let where = 'WHERE is_active = true';
  const params = [];
  if (cat !== 'all') { params.push(cat); where += ` AND category = $${params.length}`; }
  const [opps, counts] = await Promise.all([
    pool.query(`SELECT * FROM opportunities ${where} ORDER BY created_at DESC LIMIT 30`, params),
    pool.query(`SELECT category, COUNT(*) FROM opportunities WHERE is_active = true GROUP BY category`)
  ]);
  const catMap = {};
  counts.rows.forEach(r => { catMap[r.category] = parseInt(r.count); });
  const oppCards = opps.rows.map(o =>
    `<div style="background:white;padding:16px;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;align-items:start">
        <div>
          <span style="background:#ede9fe;color:#5b21b6;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:500">${esc(o.category || 'scholarship')}</span>
          <h3 style="font-size:15px;margin-top:6px"><a href="${esc(o.application_url || '#')}" target="_blank" style="color:#1e293b;text-decoration:none">${esc(o.title)}</a></h3>
          <p style="color:#64748b;font-size:13px;margin-top:4px">${esc(o.organization || '')} ${o.amount ? '· ' + esc(o.amount) : ''}</p>
          <p style="color:#64748b;font-size:12px;margin-top:4px">${esc((o.description || '').substring(0, 200))}</p>
          ${o.deadline ? `<p style="color:#dc2626;font-size:12px;margin-top:4px;font-weight:600">Deadline: ${o.deadline}</p>` : ''}
          ${o.eligibility ? `<p style="color:#475569;font-size:12px;margin-top:2px">Eligibility: ${esc(o.eligibility)}</p>` : ''}
        </div>
        ${o.application_url ? `<a href="${esc(o.application_url)}" target="_blank" style="background:#8b5cf6;color:white;padding:8px 16px;border-radius:8px;text-decoration:none;font-size:13px;white-space:nowrap">Apply</a>` : ''}
      </div>
    </div>`
  ).join('');
  res.send(`<!DOCTYPE html><html><head><title>Scholarships & Funding Opportunities — Comfort Zone</title>
    <meta name="description" content="Latest scholarships, grants and funding opportunities for Ugandans and East Africans. Updated daily.">
    <meta name="robots" content="index, follow">
    <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui;background:#f8fafc;color:#1e293b}</style>
  </head><body>
    <nav style="background:white;padding:12px 24px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between">
      <a href="/" style="font-weight:700;font-size:18px;color:#6366f1;text-decoration:none">Comfort Zone</a>
      <a href="/register" style="background:#8b5cf6;color:white;padding:8px 16px;border-radius:8px;text-decoration:none;font-size:14px">Join Free</a>
    </nav>
    <div style="max-width:800px;margin:0 auto;padding:20px">
      <div style="text-align:center;margin-bottom:24px;background:linear-gradient(135deg,#8b5cf6,#a78bfa);color:white;padding:32px;border-radius:16px">
        <h1 style="font-size:28px">Scholarships & Funding</h1>
        <p style="opacity:0.9;margin-top:4px">Find opportunities to fund your education and projects</p>
      </div>
      ${oppCards || '<p style="text-align:center;color:#64748b;padding:40px">Opportunities are being loaded. Check back soon!</p>'}
    </div>
  </body></html>`);
}));

// --- REFERRAL DASHBOARD ---
app.get('/referrals', requireAuth, ah(async (req, res) => {
  const u = req.session.user;
  // Generate or get referral code
  let ref = (await pool.query('SELECT * FROM referral_rewards WHERE user_email = $1', [u.email])).rows[0];
  let code = ref ? (await pool.query("SELECT referral_code FROM referrals WHERE referrer_email = $1 LIMIT 1", [u.email])).rows[0]?.referral_code : null;
  if (!code) {
    code = generateReferralCode();
    await pool.query('INSERT INTO referral_rewards (tenant_id, user_email) VALUES ($1, $2) ON CONFLICT DO NOTHING', [u.tenant_id, u.email]);
    await pool.query('INSERT INTO referrals (tenant_id, referrer_email, referred_email, referral_code) VALUES ($1, $2, \'\', $3)', [u.tenant_id, u.email, code]);
  }
  const referrals = (await pool.query('SELECT * FROM referrals WHERE referrer_email = $1 ORDER BY created_at DESC LIMIT 20', [u.email])).rows;
  const pending = referrals.filter(r => r.status === 'pending').length;
  const converted = referrals.filter(r => r.status === 'converted').length;
  const points = ref ? ref.total_reward : 0;
  const baseUrl = process.env.BASE_URL || 'https://ssewasswa.onrender.com';
  const refUrl = `${baseUrl}/register?ref=${code}`;
  const refList = referrals.map(r =>
    `<tr style="border-bottom:1px solid #f1f5f9"><td style="padding:8px">${esc(r.referred_email || 'Pending...')}</td>
     <td style="padding:8px"><span style="padding:2px 8px;border-radius:4px;font-size:12px;${r.status === 'converted' ? 'background:#dcfce7;color:#166534' : 'background:#fef3c7;color:#92400e'}">${r.status}</span></td>
     <td style="padding:8px;color:#94a3b8">${r.created_at ? new Date(r.created_at).toLocaleDateString() : ''}</td></tr>`
  ).join('');
  res.send(renderPage('Referral Program', `
    <div class="hero" style="background:linear-gradient(135deg,#f59e0b,#d97706)"><h1>Refer & Earn</h1><p>Invite friends and earn free premium access</p></div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:24px">
      <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${referrals.length}</div><div>Total Invites</div></div>
      <div class="stat-card"><div class="stat-num" style="color:#10b981">${converted}</div><div>Converted</div></div>
      <div class="stat-card"><div class="stat-num" style="color:#6366f1">${points}</div><div>Reward Points</div></div>
    </div>
    <div class="card" style="margin-bottom:20px">
      <h3>Your Referral Link</h3>
      <div style="display:flex;gap:8px;margin-top:8px">
        <input id="refLink" value="${esc(refUrl)}" readonly style="flex:1;padding:10px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px">
        <button onclick="navigator.clipboard.writeText(document.getElementById('refLink').value);this.textContent='Copied!'" style="background:#6366f1;color:white;border:none;padding:10px 20px;border-radius:8px;cursor:pointer">Copy Link</button>
        <a href="https://wa.me/?text=${encodeURIComponent('Join Comfort Zone - All-in-one management platform! ' + refUrl)}" target="_blank" style="background:#25d366;color:white;padding:10px 16px;border-radius:8px;text-decoration:none">WhatsApp</a>
        <a href="https://twitter.com/intent/tweet?text=${encodeURIComponent('Join Comfort Zone! ' + refUrl)}" target="_blank" style="background:#1da1f2;color:white;padding:10px 16px;border-radius:8px;text-decoration:none">Tweet</a>
      </div>
      <p style="color:#64748b;font-size:13px;margin-top:8px">Share this link with friends. When they sign up and become active, you earn 50 points!</p>
    </div>
    <div class="card">
      <h3>Referral History</h3>
      <table style="width:100%;margin-top:8px"><thead><tr style="border-bottom:2px solid #e2e8f0"><th style="text-align:left;padding:8px">Email</th><th style="text-align:left;padding:8px">Status</th><th style="text-align:left;padding:8px">Date</th></tr></thead><tbody>${refList || '<tr><td colspan="3" style="padding:20px;text-align:center;color:#94a3b8">No referrals yet. Share your link above!</td></tr>'}</tbody></table>
    </div>
  `, req.session.user));
}));

// --- SEO LANDING PAGES (auto-generated, indexable by Google) ---
app.get('/s/:slug', ah(async (req, res) => {
  const page = (await pool.query('SELECT * FROM seo_pages WHERE slug = $1 AND is_published = true', [req.params.slug])).rows[0];
  if (!page) return res.status(404).send('Not found');
  await pool.query('UPDATE seo_pages SET view_count = view_count + 1 WHERE id = $1', [page.id]);
  const baseUrl = process.env.BASE_URL || 'https://ssewasswa.onrender.com';
  res.send(`<!DOCTYPE html><html lang="en"><head>
    <title>${esc(page.title)}</title>
    <meta name="description" content="${esc(page.meta_description || '')}">
    <meta name="keywords" content="${esc(page.meta_keywords || '')}">
    <meta property="og:title" content="${esc(page.title)}">
    <meta property="og:description" content="${esc(page.meta_description || '')}">
    <meta property="og:url" content="${baseUrl}/s/${page.slug}">
    <meta property="og:type" content="website">
    <link rel="canonical" href="${baseUrl}/s/${page.slug}">
    <meta name="robots" content="index, follow">
    ${page.schema_markup ? `<script type="application/ld+json">${page.schema_markup}</script>` : ''}
    <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui;background:#f8fafc;color:#1e293b}.hero{background:linear-gradient(135deg,#6366f1,#8b5cf6);color:white;padding:60px 24px;text-align:center}.features{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px;padding:40px 24px;max-width:1100px;margin:0 auto}.feature{background:white;padding:24px;border-radius:12px;border:1px solid #e2e8f0}.cta{text-align:center;padding:40px 24px}.btn{display:inline-block;background:#6366f1;color:white;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:600;font-size:16px;margin:8px}footer{background:#1e293b;color:white;padding:40px 24px;text-align:center;margin-top:40px}</style>
  </head><body>
    <nav style="background:white;padding:12px 24px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:10">
      <a href="/" style="font-weight:700;font-size:18px;color:#6366f1;text-decoration:none">Comfort Zone</a>
      <a href="/register" style="background:#6366f1;color:white;padding:8px 16px;border-radius:8px;text-decoration:none;font-size:14px">Start Free</a>
    </nav>
    <div class="hero">
      <h1 style="font-size:36px;margin-bottom:12px">${esc(page.heading || page.title)}</h1>
      <p style="font-size:18px;opacity:0.9;max-width:600px;margin:0 auto">The all-in-one platform trusted by thousands of organizations across Uganda and East Africa. Free to start, powerful enough to scale.</p>
      <div style="margin-top:24px">
        <a href="/register" class="btn" style="background:#f59e0b;color:white">Get Started Free</a>
        <a href="/discover" class="btn" style="background:rgba(255,255,255,0.2);color:white">Explore Features</a>
      </div>
    </div>
    <div class="features">
      <div class="feature"><h3 style="color:#6366f1;margin-bottom:8px">Completely Free</h3><p style="color:#64748b">No credit card required. Start managing your organization in minutes.</p></div>
      <div class="feature"><h3 style="color:#10b981;margin-bottom:8px">All-in-One Platform</h3><p style="color:#64748b">Schools, churches, businesses, clinics, organizations — all in one place.</p></div>
      <div class="feature"><h3 style="color:#f59e0b;margin-bottom:8px">Auto Content & News</h3><p style="color:#64748b">Daily news aggregation, job boards, scholarship tracking, and more.</p></div>
      <div class="feature"><h3 style="color:#ef4444;margin-bottom:8px">Mobile Friendly</h3><p style="color:#64748b">Works perfectly on any device. PWA support for offline access.</p></div>
      <div class="feature"><h3 style="color:#8b5cf6;margin-bottom:8px">Payment Integration</h3><p style="color:#64748b">MTN MoMo, Airtel Money, Flutterwave, card payments built in.</p></div>
      <div class="feature"><h3 style="color:#06b6d4;margin-bottom:8px">Data & Analytics</h3><p style="color:#64748b">Real-time dashboards, reports, and AI-powered insights.</p></div>
    </div>
    <div class="cta">
      <h2 style="font-size:28px;margin-bottom:8px">Join thousands of organizations using Comfort Zone</h2>
      <p style="color:#64748b;margin-bottom:16px">Free forever for small organizations. Premium plans start from UGX 50,000/month.</p>
      <a href="/register" class="btn">Create Free Account</a>
    </div>
    <footer>
      <p>Comfort Zone — All-in-one management platform for Uganda & East Africa</p>
      <p style="color:#94a3b8;margin-top:8px;font-size:13px">Trusted by schools, churches, businesses, clinics, and organizations</p>
    </footer>
  </body></html>`);
}));

// --- NEWSLETTER SUBSCRIBE ---
app.post('/newsletter/subscribe', ah(async (req, res) => {
  try {
    const email = req.body.email || req.query.email;
    if (!email || !email.includes('@')) return res.json({ error: 'Invalid email' });
    await pool.query(
      `INSERT INTO newsletter_subscribers (email, name, source, subscribed_at)
       VALUES ($1, '', 'organic', NOW()) ON CONFLICT (email) DO NOTHING`,
      [email]
    );
    await pool.query(
      `INSERT INTO digest_subscriptions (email, frequency, is_active, subscribed_at)
       VALUES ($1, 'daily', true, NOW()) ON CONFLICT (email) DO UPDATE SET is_active = true`,
      [email]
    );
    res.json({ ok: true, message: 'Subscribed successfully!' });
  } catch(e) {
    res.json({ error: e.message });
  }
}));

// --- TRACKING: Content clicks (for trending algorithm) ---
app.post('/api/track/click', ah(async (req, res) => {
  try {
    const { id, type } = req.body;
    if (id) {
      await pool.query('UPDATE scraped_content SET click_count = COALESCE(click_count, 0) + 1 WHERE id = $1', [id]);
    }
    res.json({ ok: true });
  } catch(e) {
    res.json({ ok: true });
  }
}));

// --- TRACKING: Page views ---
app.post('/api/track/view', ah(async (req, res) => {
  try {
    const { url, referrer } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.ip;
    await pool.query(
      `INSERT INTO page_views (url, user_email, ip_address, referrer, created_at) VALUES ($1, $2, $3, $4, NOW())`,
      [url || req.headers.referer || '', req.session.user?.email || null, ip, referrer || null]
    );
    res.json({ ok: true });
  } catch(e) { res.json({ ok: true }); }
}));

// --- CONTENT LIKE ---
app.post('/api/content/like', requireAuth, ah(async (req, res) => {
  const { id, type } = req.body;
  try {
    await pool.query(
      `INSERT INTO content_likes (user_email, content_id, content_type) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [req.session.user.email, id, type || 'scraped']
    );
    await awardPoints(req.session.user.email, 'read_article', 'content_engagement');
    res.json({ ok: true });
  } catch(e) { res.json({ ok: true }); }
}));

// --- CONTENT BOOKMARK ---
app.post('/api/content/bookmark', requireAuth, ah(async (req, res) => {
  const { id, type } = req.body;
  try {
    await pool.query(
      `INSERT INTO content_bookmarks (user_email, content_id, content_type) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [req.session.user.email, id, type || 'scraped']
    );
    await awardPoints(req.session.user.email, 'bookmark_content', 'content_engagement');
    res.json({ ok: true });
  } catch(e) { res.json({ ok: true }); }
}));

// --- REFERRAL TRACKING ---
app.get('/register', (req, res, next) => {
  if (req.query.ref) {
    res.cookie('referral_code', req.query.ref, { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true });
  }
  next();
});

// --- ADMIN: Viral analytics dashboard ---
app.get('/admin/viral', requireAuth, requireSuperAdmin, ah(async (req, res) => {
  const [stats, topContent, topReferrers, subscribers] = await Promise.all([
    pool.query(`SELECT
      (SELECT COUNT(*) FROM scraped_content) as total_content,
      (SELECT COUNT(*) FROM page_views WHERE created_at >= NOW() - INTERVAL '24 hours') as views_24h,
      (SELECT COUNT(*) FROM viral_shares) as total_shares,
      (SELECT COUNT(*) FROM referrals WHERE status = 'converted') as converted_referrals,
      (SELECT COUNT(*) FROM newsletter_subscribers) as newsletter_subs,
      (SELECT COUNT(*) FROM jobs WHERE is_active = true) as active_jobs,
      (SELECT COUNT(*) FROM opportunities WHERE is_active = true) as active_opportunities,
      (SELECT COUNT(*) FROM seo_pages WHERE is_published = true) as seo_pages
    `),
    pool.query(`SELECT title, category, click_count, view_count FROM scraped_content ORDER BY click_count DESC LIMIT 10`),
    pool.query(`SELECT referrer_email, COUNT(*) as count FROM referrals GROUP BY referrer_email ORDER BY count DESC LIMIT 10`),
    pool.query(`SELECT COUNT(*) as total, SUM(CASE WHEN is_active THEN 1 ELSE 0 END) as active FROM newsletter_subscribers`)
  ]);
  const s = stats.rows[0];
  res.send(renderPage('Viral Analytics', `
    <div class="hero" style="background:linear-gradient(135deg,#6366f1,#8b5cf6)"><h1>Viral Growth Dashboard</h1><p>Track content performance, referrals, and revenue</p></div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:24px">
      <div class="stat-card"><div class="stat-num" style="color:#6366f1">${s.total_content || 0}</div><div>Content Items</div></div>
      <div class="stat-card"><div class="stat-num" style="color:#10b981">${s.views_24h || 0}</div><div>Views (24h)</div></div>
      <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${s.newsletter_subs || 0}</div><div>Newsletter Subs</div></div>
      <div class="stat-card"><div class="stat-num" style="color:#ef4444">${s.converted_referrals || 0}</div><div>Referrals</div></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
      <div class="card"><h3>Top Content (by clicks)</h3><table style="width:100%;margin-top:8px"><thead><tr style="border-bottom:2px solid #e2e8f0"><th style="text-align:left;padding:8px">Title</th><th>Clicks</th></tr></thead><tbody>${topContent.rows.map(r =>
        `<tr style="border-bottom:1px solid #f1f5f9"><td style="padding:6px;font-size:13px">${esc((r.title || '').substring(0, 60))}</td><td style="padding:6px;text-align:center;font-weight:600">${r.click_count || 0}</td></tr>`
      ).join('')}</tbody></table></div>
      <div class="card"><h3>Top Referrers</h3><table style="width:100%;margin-top:8px"><thead><tr style="border-bottom:2px solid #e2e8f0"><th style="text-align:left;padding:8px">Email</th><th>Referrals</th></tr></thead><tbody>${topReferrers.rows.map(r =>
        `<tr style="border-bottom:1px solid #f1f5f9"><td style="padding:6px;font-size:13px">${esc(r.referrer_email)}</td><td style="padding:6px;text-align:center;font-weight:600">${r.count}</td></tr>`
      ).join('')}</tbody></table></div>
    </div>
  `, req.session.user));
}));

// ============================================================
// === SCHEDULED TASKS (run on server start + every 6 hours) ===
// ============================================================
setTimeout(async () => {
  console.log('[ViralEngine] Starting initial scrape + setup...');
  try {
    await seedSEOPages();
    console.log('[ViralEngine] SEO pages seeded');
    await scrapeRSSFeeds();
    await scrapeJobs();
    await calculateTrending();
  } catch(e) {
    console.error('[ViralEngine] Initial setup error:', e.message);
  }
}, 60000); // Run 60 seconds after startup

// Scrape every 6 hours
setInterval(async () => {
  console.log('[ViralEngine] Running scheduled scrape...');
  try {
    await scrapeRSSFeeds();
    await scrapeJobs();
    await calculateTrending();
  } catch(e) {
    console.error('[ViralEngine] Scheduled scrape error:', e.message);
  }
}, SCRAPE_INTERVAL);

console.log('[ViralEngine] Module loaded — scraping, referrals, jobs, SEO, trending, newsletter ready');
