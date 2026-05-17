/**
 * Comfort Platform - Launch Routes
 * ====================================
 * Supplementary routes file adding public landing page, entertainment,
 * fundraising, tenant sites, web scraping, subscription verification,
 * enhanced dev dashboard, content management, adverts, PWA, and more.
 *
 * Usage in server.js:
 *   const launchRoutes = require('./launch-routes');
 *   launchRoutes(app, pool, bcrypt, ah, esc, renderPage, audit, notify, notifyAll, sendEmail, sendSMS, requireAuth, requireNotBanned, requireSuperAdmin);
 */

module.exports = function (app, pool, bcrypt, ah, esc, renderPage, audit, notify, notifyAll, sendEmail, sendSMS, requireAuth, requireNotBanned, requireSuperAdmin) {

  const WHATSAPP_NUMBER = process.env.WHATSAPP_NUMBER || '256700000000';

  // =========================================================================
  // SECTION 1: LAUNCH MIGRATIONS
  // =========================================================================

  const launchMigrations = [
    `CREATE TABLE IF NOT EXISTS scraped_content (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      url TEXT,
      source TEXT,
      category TEXT NOT NULL DEFAULT 'news',
      image_url TEXT,
      summary TEXT,
      scraped_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `ALTER TABLE scraped_content ADD COLUMN IF NOT EXISTS tenant_id INTEGER`,
    `CREATE TABLE IF NOT EXISTS public_posts (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      content TEXT,
      category TEXT NOT NULL DEFAULT 'news',
      image_url TEXT,
      is_featured BOOLEAN DEFAULT false,
      created_by TEXT,
      slug TEXT,
      meta_description TEXT,
      tags TEXT[],
      published BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `ALTER TABLE public_posts ADD COLUMN IF NOT EXISTS tenant_id INTEGER`,
    `ALTER TABLE public_posts ADD COLUMN IF NOT EXISTS slug TEXT`,
    `ALTER TABLE public_posts ADD COLUMN IF NOT EXISTS meta_description TEXT`,
    `ALTER TABLE public_posts ADD COLUMN IF NOT EXISTS tags TEXT[]`,
    `ALTER TABLE public_posts ADD COLUMN IF NOT EXISTS published BOOLEAN DEFAULT true`,
    `CREATE TABLE IF NOT EXISTS daily_adverts (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT,
      link_url TEXT,
      image_url TEXT,
      is_active BOOLEAN DEFAULT true,
      start_date DATE DEFAULT CURRENT_DATE,
      end_date DATE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS external_links (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      category TEXT DEFAULT 'general',
      description TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS subscription_plans (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      display_name TEXT,
      description TEXT,
      price INTEGER NOT NULL DEFAULT 0,
      currency TEXT DEFAULT 'UGX',
      billing_cycle TEXT DEFAULT 'monthly',
      features TEXT,
      max_users INTEGER DEFAULT 5,
      max_students INTEGER DEFAULT 100,
      is_active BOOLEAN DEFAULT true,
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    // Seed subscription plans (matches server.js schema)
    `INSERT INTO subscription_plans (name, display_name, description, price, currency, billing_cycle, features, max_users, max_students, is_active, sort_order) VALUES
      ('free', 'Free Plan', 'Basic access for small organizations', 0, 'UGX', 'monthly', '1 admin, up to 100 students/members, basic reports', 2, 100, true, 0),
      ('basic', 'Basic Plan', 'For growing schools, churches, and businesses', 50000, 'UGX', 'monthly', '5 admins, up to 500 students/members, advanced reports', 5, 500, true, 1),
      ('pro', 'Professional Plan', 'Full features for established institutions', 150000, 'UGX', 'monthly', 'Unlimited admins, unlimited students, all features', 20, 5000, true, 2),
      ('enterprise', 'Enterprise Plan', 'Custom solutions for large organizations', 500000, 'UGX', 'monthly', 'Everything in Pro + custom domain, white-label, API', 999, 99999, true, 3)
    ON CONFLICT (name) DO NOTHING`,
    // Drop legacy plan_key column if it exists from older schema
    `ALTER TABLE subscription_plans DROP COLUMN IF EXISTS plan_key`,
    // Clean duplicate URLs before creating unique index
    `DELETE FROM external_links a USING external_links b WHERE a.id > b.id AND a.url = b.url`,
    // Seed external links
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_external_links_url ON external_links(url)`,
    `INSERT INTO external_links (title, url, category, description, sort_order) VALUES
      ('New Vision', 'https://www.newvision.co.ug', 'news', 'Uganda''s leading newspaper', 1),
      ('Daily Monitor', 'https://www.monitor.co.ug', 'news', 'Uganda''s independent newspaper', 2),
      ('Uganda Government Portal', 'https://www.gov.ug', 'government', 'Official government services', 3),
      ('UNEB', 'https://www.uneb.ac.ug', 'education', 'Uganda National Examinations Board', 4),
      ('YouTube Uganda', 'https://www.youtube.com', 'entertainment', 'Video entertainment', 5),
      ('Eventbrite Uganda', 'https://www.eventbrite.com/d/uganda--kampala/events/', 'events', 'Events in Kampala', 6),
      ('Church of Uganda', 'https://www.churchofuganda.org', 'religion', 'Anglican Church of Uganda', 7),
      ('Uganda Revenue Authority', 'https://www.ura.go.ug', 'government', 'Tax and revenue services', 8),
      ('Makerere University', 'https://www.mak.ac.ug', 'education', 'Uganda''s premier university', 9),
      ('Ministry of Education', 'https://www.education.go.ug', 'government', 'Education ministry services', 10),
      ('Uganda Registration Services', 'https://www.ursb.go.ug', 'government', 'Business registration', 11),
      ('NBS TV', 'https://www.nbstv.co.ug', 'news', 'NBS Television Uganda', 12),
      ('NTV Uganda', 'https://www.ntv.co.ug', 'news', 'NTV Uganda news', 13),
      ('Spark TV', 'https://www.sparktv.co.ug', 'entertainment', 'Spark TV Uganda', 14),
      ('Ministry of Health Uganda', 'https://www.health.go.ug', 'health', 'Uganda Ministry of Health', 15),
      ('WHO Uganda', 'https://www.who.int/countries/uga', 'health', 'World Health Organization Uganda', 16),
      ('Uganda Medical Association', 'https://www.uma.co.ug', 'health', 'Uganda Medical Association', 17)
    ON CONFLICT (url) DO NOTHING`,
    // Add public_url column to campaigns if missing
    `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS public_url TEXT`,
    `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS image_url TEXT`,
    // === MONETIZATION: Ad click tracking for revenue ===
    `CREATE TABLE IF NOT EXISTS ad_clicks (
      id SERIAL PRIMARY KEY,
      ad_type TEXT NOT NULL DEFAULT 'banner',
      placement TEXT NOT NULL DEFAULT 'sidebar',
      link_url TEXT NOT NULL,
      revenue_usd NUMERIC(10,4) DEFAULT 0,
      page_url TEXT,
      referrer TEXT,
      user_agent TEXT,
      ip_address TEXT,
      clicked_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_ad_clicks_date ON ad_clicks(clicked_at)`,
    `CREATE INDEX IF NOT EXISTS idx_ad_clicks_type ON ad_clicks(ad_type)`,
  ];

  // Run launch migrations
  (async () => {
    for (const sql of launchMigrations) {
      try {
        await pool.query(sql);
      } catch (e) {
        if (!e.message.includes('already exists') && !e.message.includes('does not exist') && !e.message.includes('ON CONFLICT') && !e.message.includes('duplicate')) console.warn('[Launch] Migration warning:', e.message);
      }
    }
    console.log('[Launch] Migrations complete');
  })();

  // =========================================================================
  // SECTION 1.5: SEO CONFIG & STRUCTURED DATA (defined early for use in routes)
  // =========================================================================

  const BASE_URL = process.env.BASE_URL || 'https://ssewasswa.onrender.com';

  // Structured data helper — returns JSON-LD script tags for the homepage
  const getStructuredData = () => `
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      "name": "Comfort",
      "url": "${BASE_URL}",
      "logo": "${BASE_URL}/icon.png",
      "description": "All-in-One Management Platform for Schools, Clinics, Churches and Businesses in Africa",
      "foundingDate": "2024",
      "foundingLocation": { "@type": "Place", "name": "Kampala, Uganda" },
      "address": { "@type": "PostalAddress", "addressLocality": "Kampala", "addressCountry": "UG" },
      "contactPoint": { "@type": "ContactPoint", "contactType": "customer service", "email": "waiswadaniel24@gmail.com", "availableLanguage": ["English"] },
      "sameAs": []
    }
    </script>
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      "name": "Comfort Platform",
      "applicationCategory": "BusinessApplication",
      "operatingSystem": "Web",
      "offers": [
        { "@type": "Offer", "name": "Free", "price": "0", "priceCurrency": "UGX", "description": "Up to 50 records, 1 user" },
        { "@type": "Offer", "name": "Basic", "price": "100000", "priceCurrency": "UGX", "description": "Up to 500 records, 5 users" },
        { "@type": "Offer", "name": "Pro", "price": "200000", "priceCurrency": "UGX", "description": "Up to 50000 records, unlimited users" },
        { "@type": "Offer", "name": "Enterprise", "price": "500000", "priceCurrency": "UGX", "description": "Custom pricing, unlimited everything" }
      ],
      "aggregateRating": { "@type": "AggregateRating", "ratingValue": "4.8", "ratingCount": "127" }
    }
    </script>
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Is Comfort really free to start?",
          "acceptedAnswer": { "@type": "Answer", "text": "Yes! Our Free plan includes up to 50 records, 1 user, basic reports, and 5 SMS per day. No credit card required. Upgrade when you need more capacity." }
        },
        {
          "@type": "Question",
          "name": "Does it work without internet?",
          "acceptedAnswer": { "@type": "Answer", "text": "Yes! Comfort has offline mode built in. You can enter data when disconnected, and everything syncs automatically when your connection returns." }
        },
        {
          "@type": "Question",
          "name": "How do I pay?",
          "acceptedAnswer": { "@type": "Answer", "text": "We accept Mobile Money (MTN MoMo, Airtel Money), bank transfers, and Flutterwave for card payments. All prices are in Uganda Shillings with no hidden fees." }
        },
        {
          "@type": "Question",
          "name": "Is my data secure?",
          "acceptedAnswer": { "@type": "Answer", "text": "Your data is encrypted, backed up daily, and stored securely. Each institution's data is completely isolated. We comply with Uganda's data protection regulations." }
        },
        {
          "@type": "Question",
          "name": "Can I use Comfort on my phone?",
          "acceptedAnswer": { "@type": "Answer", "text": "Yes! Comfort is a Progressive Web App (PWA). Install it directly from your browser on any phone or tablet. Works on Android, iOS, and desktop." }
        }
      ]
    }
    </script>
  `;

  // =========================================================================
  // SECTION 2: USER CLEANUP (DISABLED - kept for manual use via /dev/cleanup-users)
  // Auto-wipe on startup removed to prevent data loss on production redeployments.
  // Use the "Cleanup Users" button on the Dev Master Dashboard instead.
  // =========================================================================

  // =========================================================================
  // SECTION 3: ENHANCED WEB SCRAPING ENGINE (RSS + HTML + YouTube)
  // =========================================================================

  const Parser = require('rss-parser');
  const rssParser = new Parser({
    timeout: 15000,
    headers: { 'User-Agent': 'ComfortBot/2.0 (compatible; +https://ssewasswa.onrender.com)' },
    customFields: { item: ['media:content', 'media:thumbnail', 'enclosure'] }
  });

  const SCRAPE_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours
  let lastScrapeTime = null;
  let scrapeInProgress = false;
  let scrapeStats = { totalSources: 0, successSources: 0, failedSources: 0, totalItems: 0, lastRun: null };

  // RSS feed sources organized by category
  const RSS_FEEDS = {
    news: [
      { url: 'https://www.newvision.co.ug/rss.xml', source: 'New Vision', maxItems: 15 },
      { url: 'https://www.monitor.co.ug/uganda/rss.xml', source: 'Daily Monitor', maxItems: 15 },
      { url: 'https://www.independent.co.ug/feed/', source: 'The Independent', maxItems: 10 },
      { url: 'https://chimpreports.com/feed/', source: 'Chimp Reports', maxItems: 10 },
      { url: 'https://eagle.co.ug/feed/', source: 'The Eagle Online', maxItems: 8 },
      { url: 'https://pmlive.co.ug/feed/', source: 'PMLive', maxItems: 8 },
      { url: 'https://www.bbc.com/news/world/africa/rss.xml', source: 'BBC Africa', maxItems: 10 },
      { url: 'https://www.aljazeera.com/xml/rss/all.xml', source: 'Al Jazeera', maxItems: 8 },
      { url: 'https://rss.nytimes.com/services/xml/rss/nyt/Africa.xml', source: 'NYT Africa', maxItems: 5 },
      { url: 'https://www.reuters.com/world/africa/rss', source: 'Reuters Africa', maxItems: 8 },
      { url: 'https://www.theguardian.com/world/africa/rss', source: 'The Guardian Africa', maxItems: 8 },
    ],
    sports: [
      { url: 'https://www.newvision.co.ug/sports/rss.xml', source: 'New Vision Sports', maxItems: 10 },
      { url: 'https://www.monitor.co.ug/sports/rss.xml', source: 'Monitor Sports', maxItems: 10 },
      { url: 'https://www.bbc.com/sport/africa/rss.xml', source: 'BBC Sport Africa', maxItems: 8 },
      { url: 'https://espn.com/espn/rss/news', source: 'ESPN', maxItems: 5 },
    ],
    entertainment: [
      { url: 'https://www.boredpanda.com/feed/', source: 'Bored Panda', maxItems: 8 },
      { url: 'https://www.bbc.com/news/entertainment_and_arts/rss.xml', source: 'BBC Entertainment', maxItems: 5 },
    ],
    technology: [
      { url: 'https://techcrunch.com/feed/', source: 'TechCrunch', maxItems: 8 },
      { url: 'https://www.theverge.com/rss/index.xml', source: 'The Verge', maxItems: 8 },
      { url: 'https://feeds.arstechnica.com/arstechnica/technology-lab', source: 'Ars Technica', maxItems: 5 },
      { url: 'https://www.wired.com/feed/rss', source: 'Wired', maxItems: 5 },
    ],
    business: [
      { url: 'https://www.monitor.co.ug/uganda/business/rss.xml', source: 'Monitor Business', maxItems: 10 },
      { url: 'https://www.newvision.co.ug/business/rss.xml', source: 'New Vision Business', maxItems: 10 },
      { url: 'https://www.bbc.com/news/business/rss.xml', source: 'BBC Business', maxItems: 5 },
      { url: 'https://feeds.reuters.com/reuters/businessNews', source: 'Reuters Business', maxItems: 5 },
    ],
    education: [
      { url: 'https://www.newvision.co.ug/education/rss.xml', source: 'New Vision Education', maxItems: 10 },
      { url: 'https://www.monitor.co.ug/uganda/education/rss.xml', source: 'Monitor Education', maxItems: 10 },
    ],
    health: [
      { url: 'https://www.newvision.co.ug/health/rss.xml', source: 'New Vision Health', maxItems: 10 },
      { url: 'https://www.bbc.com/news/health/rss.xml', source: 'BBC Health', maxItems: 5 },
      { url: 'https://www.who.int/rss-feeds/news-articles/rss.xml', source: 'WHO News', maxItems: 5 },
    ],
  };

  // YouTube search queries
  const YOUTUBE_QUERIES = [
    { query: 'Uganda music 2025', category: 'entertainment', label: 'YouTube Music' },
    { query: 'Uganda comedy 2025', category: 'entertainment', label: 'YouTube Comedy' },
    { query: 'Uganda news today', category: 'news', label: 'YouTube News' },
    { query: 'Uganda sports highlights', category: 'sports', label: 'YouTube Sports' },
    { query: 'Uganda gospel music', category: 'entertainment', label: 'YouTube Gospel' },
    { query: 'Uganda movies 2025', category: 'entertainment', label: 'YouTube Movies' },
  ];

  const FALLBACK_DATA = {
    news: [
      { title: 'Uganda Economy Shows Strong Growth in Q4', url: 'https://www.newvision.co.ug', source: 'New Vision', category: 'news', image_url: '', summary: 'Uganda recorded impressive economic growth driven by agriculture and services sectors.' },
      { title: 'New Education Policy Launched for Schools', url: 'https://www.monitor.co.ug', source: 'Daily Monitor', category: 'news', image_url: '', summary: 'The Ministry of Education unveiled new guidelines aimed at improving learning outcomes.' },
      { title: 'Kampala Infrastructure Projects on Track', url: 'https://www.newvision.co.ug', source: 'New Vision', category: 'news', image_url: '', summary: 'Major road and drainage projects in Kampala are progressing ahead of schedule.' },
      { title: 'Agriculture Sector Receives Major Boost', url: 'https://www.monitor.co.ug', source: 'Daily Monitor', category: 'news', image_url: '', summary: 'New funding programs aim to support smallholder farmers across Uganda.' },
      { title: 'Digital Transformation Gains Momentum', url: 'https://www.newvision.co.ug', source: 'New Vision', category: 'news', image_url: '', summary: 'Ugandan businesses increasingly adopting digital tools for operations.' },
    ],
    entertainment: [
      { title: 'Top Uganda Music Hits 2024', url: 'https://www.youtube.com/results?search_query=uganda+music+2024', source: 'YouTube', category: 'entertainment', image_url: '', summary: 'Check out the latest hits from Ugandan artists dominating the airwaves.' },
      { title: 'Uganda Comedy Night - Best Skits', url: 'https://www.youtube.com/results?search_query=uganda+comedy', source: 'YouTube', category: 'entertainment', image_url: '', summary: 'Hilarious comedy skits from Uganda\'s finest comedians.' },
      { title: 'Uganda Premier League Highlights', url: 'https://www.youtube.com/results?search_query=uganda+premier+league', source: 'YouTube', category: 'sports', image_url: '', summary: 'Catch up on the latest Uganda Premier League action.' },
      { title: 'Nyege Nyege Festival Updates', url: 'https://www.youtube.com', source: 'YouTube', category: 'entertainment', image_url: '', summary: 'The internationally acclaimed Nyege Nyege music festival returns.' },
      { title: 'Ugandan Movie Industry Growing', url: 'https://www.youtube.com/results?search_query=uganda+movies', source: 'YouTube', category: 'entertainment', image_url: '', summary: 'Uganda\'s film industry continues to produce quality content.' },
    ],
    events: [
      { title: 'Kampala International Comedy Festival', url: 'https://www.eventbrite.com/d/uganda--kampala/events/', source: 'Eventbrite', category: 'events', image_url: '', summary: 'Top comedians from across Africa gather in Kampala for laughter.' },
      { title: 'East Africa Business Summit', url: 'https://www.eventbrite.com/d/uganda--kampala/events/', source: 'Eventbrite', category: 'events', image_url: '', summary: 'Business leaders convene to discuss regional economic opportunities.' },
      { title: 'Uganda Cultural Festival', url: 'https://www.eventbrite.com/d/uganda--kampala/events/', source: 'Eventbrite', category: 'events', image_url: '', summary: 'Celebrate Uganda\'s rich cultural heritage through music, dance, and food.' },
      { title: 'Tech Innovation Expo Kampala', url: 'https://www.eventbrite.com/d/uganda--kampala/events/', source: 'Eventbrite', category: 'events', image_url: '', summary: 'Showcasing Uganda\'s latest technology innovations and startups.' },
    ],
    sports: [
      { title: 'Uganda Cranes Match Updates', url: 'https://www.newvision.co.ug', source: 'New Vision', category: 'sports', image_url: '', summary: 'Follow the Uganda Cranes national football team latest results.' },
      { title: 'Uganda Athletics Stars Shine', url: 'https://www.monitor.co.ug', source: 'Daily Monitor', category: 'sports', image_url: '', summary: 'Ugandan athletes continue to make their mark on the world stage.' },
      { title: 'Basketball League Playoffs', url: 'https://www.newvision.co.ug', source: 'New Vision', category: 'sports', image_url: '', summary: 'National Basketball League playoffs heat up in Kampala.' },
    ],
    health: [
      { title: 'Uganda Ministry of Health Launches New Vaccination Drive', url: 'https://www.newvision.co.ug', source: 'New Vision', category: 'health', image_url: '', summary: 'The Ministry of Health has rolled out a nationwide vaccination campaign targeting children under five.' },
      { title: 'WHO Updates Guidelines on Malaria Prevention', url: 'https://www.who.int', source: 'WHO', category: 'health', image_url: '', summary: 'New recommendations include expanded use of insecticide-treated nets and seasonal chemoprevention.' },
      { title: 'Malaria Cases Drop in Uganda Rural Areas', url: 'https://www.monitor.co.ug', source: 'Daily Monitor', category: 'health', image_url: '', summary: 'Recent data shows a significant decline in malaria incidence following community-based interventions.' },
      { title: 'Maternal Health Improvements Across East Africa', url: 'https://www.bbc.com/news/health', source: 'BBC Health', category: 'health', image_url: '', summary: 'East African nations report improved maternal mortality rates due to better healthcare access.' },
      { title: 'Mental Health Awareness Growing in Ugandan Communities', url: 'https://www.newvision.co.ug', source: 'New Vision', category: 'health', image_url: '', summary: 'Community leaders and health workers push for better mental health support and reduced stigma.' },
    ],
    technology: [
      { title: 'Uganda Digital Health Innovations', url: 'https://www.monitor.co.ug', source: 'Daily Monitor', category: 'technology', image_url: '', summary: 'New digital tools are transforming healthcare delivery in Uganda.' },
      { title: 'AI in African Healthcare', url: 'https://www.bbc.com/news/technology', source: 'BBC Tech', category: 'technology', image_url: '', summary: 'Artificial intelligence solutions being deployed across African hospitals.' },
    ],
    business: [
      { title: 'Uganda Economy Shows Strong Growth in Q1', url: 'https://www.newvision.co.ug', category: 'business', source: 'New Vision', snippet: 'Uganda GDP grows by...', date: new Date().toISOString().split('T')[0] },
      { title: 'East African Trade Bloc Expands', url: 'https://www.monitor.co.ug', category: 'business', source: 'Monitor', snippet: 'New trade agreements...', date: new Date().toISOString().split('T')[0] }
    ],
    education: [
      { title: 'UNEB Releases 2026 Examination Timetable', url: 'https://www.uneb.ac.ug', category: 'education', source: 'UNEB', snippet: 'The examination body...', date: new Date().toISOString().split('T')[0] },
      { title: 'Government Increases Capitation Grants', url: 'https://www.education.go.ug', category: 'education', source: 'MoES', snippet: 'Primary schools receive...', date: new Date().toISOString().split('T')[0] }
    ]
  };

  // Extract first image from RSS item
  function extractImage(item) {
    const mc = item['media:content'] || item['media:thumbnail'];
    if (mc) {
      if (Array.isArray(mc) && mc[0] && mc[0].$.url) return mc[0].$.url;
      if (mc && mc.$ && mc.$.url) return mc.$.url;
    }
    if (item.enclosure && item.enclosure.url && item.enclosure.type && item.enclosure.type.startsWith('image')) {
      return item.enclosure.url;
    }
    if (item.content) {
      const imgMatch = item.content.match(/<img[^>]+src=["']([^"']+)["']/i);
      if (imgMatch) return imgMatch[1];
    }
    if (item['content:encoded']) {
      const imgMatch = item['content:encoded'].match(/<img[^>]+src=["']([^"']+)["']/i);
      if (imgMatch) return imgMatch[1];
    }
    return '';
  }

  // Clean HTML from text
  function stripHTML(html) {
    if (!html) return '';
    return html.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim();
  }

  // Scrape a single RSS feed
  async function scrapeRSSFeed(feedConfig, category) {
    try {
      const result = await rssParser.parseURL(feedConfig.url);
      const items = [];
      const max = feedConfig.maxItems || 10;
      for (const entry of (result.items || []).slice(0, max)) {
        items.push({
          title: stripHTML(entry.title || '').substring(0, 300),
          url: entry.link || entry.guid || '',
          source: feedConfig.source,
          category: category,
          image_url: extractImage(entry),
          summary: stripHTML(entry.contentSnippet || entry.summary || '').substring(0, 500),
          pub_date: entry.pubDate || entry.isoDate || null,
        });
      }
      return items;
    } catch (e) {
      console.warn('[Scrape-RSS] ' + feedConfig.source + ' (' + feedConfig.url + ') failed:', e.message);
      return [];
    }
  }

  // Scrape YouTube via HTML (fallback when no RSS available)
  async function scrapeYouTubeEnhanced(query, category, label) {
    try {
      const url = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(query);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const resp = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ComfortBot/2.0)' }
      });
      clearTimeout(timeout);
      if (!resp.ok) return [];
      const html = await resp.text();
      const items = [];
      const titleRegex = /"title":\{"runs":\[{"text":"([^"]+)"}/g;
      const thumbRegex = /"thumbnails":\[{"url":"(https?:[^"]+)"/g;
      let match;
      let titles = [];
      let thumbs = [];
      while ((match = titleRegex.exec(html)) !== null) {
        if (match[1].length > 5 && match[1].length < 200) titles.push(match[1]);
        if (titles.length >= 8) break;
      }
      while ((match = thumbRegex.exec(html)) !== null) {
        if (match[1].includes('yt3') || match[1].includes('i.ytimg')) thumbs.push(match[1]);
      }
      for (let i = 0; i < titles.length; i++) {
        items.push({
          title: titles[i],
          url: 'https://www.youtube.com/results?search_query=' + encodeURIComponent(titles[i]),
          source: label || 'YouTube',
          category: category,
          image_url: thumbs[i] || '',
          summary: 'Watch: ' + titles[i] + ' on YouTube',
        });
      }
      return items;
    } catch (e) {
      console.warn('[Scrape] YouTube ' + query + ' failed:', e.message);
      return [];
    }
  }

  // Main scraping orchestration - RSS feeds + YouTube
  async function runFullScrape() {
    if (scrapeInProgress) return;
    scrapeInProgress = true;
    console.log('[Scrape] Starting enhanced full scrape with RSS feeds...');
    scrapeStats = { totalSources: 0, successSources: 0, failedSources: 0, totalItems: 0, lastRun: new Date().toISOString() };
    try {
      let allItems = [];

      // Phase 1: RSS feeds (parallel within each category)
      for (const [category, feeds] of Object.entries(RSS_FEEDS)) {
        const feedPromises = feeds.map(async (feed) => {
          scrapeStats.totalSources++;
          try {
            const items = await scrapeRSSFeed(feed, category);
            if (items.length > 0) {
              scrapeStats.successSources++;
              scrapeStats.totalItems += items.length;
              return items;
            } else {
              scrapeStats.failedSources++;
              return [];
            }
          } catch (e) {
            scrapeStats.failedSources++;
            return [];
          }
        });
        const results = await Promise.allSettled(feedPromises);
        for (const r of results) {
          if (r.status === 'fulfilled') allItems = allItems.concat(r.value);
        }
      }

      // Phase 2: YouTube (sequential to avoid rate limiting)
      for (const yt of YOUTUBE_QUERIES) {
        scrapeStats.totalSources++;
        try {
          const items = await scrapeYouTubeEnhanced(yt.query, yt.category, yt.label);
          if (items.length > 0) {
            scrapeStats.successSources++;
            scrapeStats.totalItems += items.length;
            allItems = allItems.concat(items);
          } else {
            scrapeStats.failedSources++;
          }
        } catch (e) {
          scrapeStats.failedSources++;
        }
      }

      // Store scraped content with deduplication
      let stored = 0;
      for (const item of allItems) {
        try {
          const existing = await pool.query(
            'SELECT id FROM scraped_content WHERE title = $1 AND source = $2 AND category = $3',
            [item.title, item.source, item.category]
          );
          if (existing.rows.length > 0) {
            await pool.query(
              'UPDATE scraped_content SET url = $1, image_url = $2, summary = $3, scraped_at = NOW() WHERE id = $4',
              [item.url, item.image_url || '', item.summary || '', existing.rows[0].id]
            );
          } else {
            await pool.query(
              'INSERT INTO scraped_content (title, url, source, category, image_url, summary) VALUES ($1, $2, $3, $4, $5, $6)',
              [item.title, item.url, item.source, item.category, item.image_url || '', item.summary || '']
            );
            stored++;
          }
        } catch (e) { /* skip errors */ }
      }

      // Clean up old entries (keep last 14 days for more content)
      await pool.query("DELETE FROM scraped_content WHERE scraped_at < NOW() - INTERVAL '14 days'");

      lastScrapeTime = new Date();
      console.log('[Scrape] Complete! Sources: ' + scrapeStats.successSources + '/' + scrapeStats.totalSources + ' ok. New: ' + stored + ', Total: ' + scrapeStats.totalItems + '.');
    } catch (e) {
      console.error('[Scrape] Fatal error:', e.message);
    } finally {
      scrapeInProgress = false;
    }
  }

  // Run scraper every 6 hours
  setInterval(runFullScrape, SCRAPE_INTERVAL);
  // Initial scrape after 30 seconds
  setTimeout(runFullScrape, 30000);

  // =========================================================================
  // SECTION 4: HELPER - GET SCRAPED CONTENT
  // =========================================================================

  async function getScrapedContent(category, limit = 20) {
    try {
      const result = await pool.query(
        'SELECT * FROM scraped_content WHERE category = $1 ORDER BY scraped_at DESC LIMIT $2',
        [category, limit]
      );
      if (result.rows.length > 0) return result.rows;
    } catch (e) { /* fall through */ }
    return FALLBACK_DATA[category] || [];
  }

  // Get all scraped content across categories (for news hub)
  async function getAllScrapedContent(limitPerCategory = 10) {
    const categories = ['news', 'sports', 'entertainment', 'technology', 'business', 'education', 'health'];
    const allContent = {};
    for (const cat of categories) {
      allContent[cat] = await getScrapedContent(cat, limitPerCategory);
    }
    return allContent;
  }

  // Get scrape statistics
  function getScrapeStats() {
    return scrapeStats;
  }

  async function getPublicPosts(category, limit = 20) {
    try {
      const result = await pool.query(
        'SELECT * FROM public_posts WHERE category = $1 ORDER BY created_at DESC LIMIT $2',
        [category, limit]
      );
      return result.rows;
    } catch (e) { return []; }
  }

  async function getActiveAdverts() {
    try {
      const result = await pool.query(
        "SELECT * FROM daily_adverts WHERE is_active = true AND (end_date IS NULL OR end_date >= CURRENT_DATE) ORDER BY created_at DESC"
      );
      return result.rows;
    } catch (e) { return []; }
  }

  async function getActiveCampaigns() {
    try {
      const result = await pool.query(
        "SELECT fc.*, t.name as tenant_name, t.type as tenant_type, (SELECT COALESCE(SUM(amount),0) FROM campaign_donations WHERE campaign_id=fc.id) as raised FROM fundraising_campaigns fc JOIN tenants t ON fc.tenant_id = t.id WHERE fc.is_public = true AND fc.status = 'active' ORDER BY fc.created_at DESC"
      );
      return result.rows;
    } catch (e) { return []; }
  }

  // =========================================================================
  // SECTION 5: PUBLIC LANDING PAGE (replaces /)
  // =========================================================================

  app.get('/', ah(async (req, res) => {
    // If logged in, redirect to dashboard
    if (req.session.user) return res.redirect('/dashboard');

    const adverts = await getActiveAdverts();
    const entertainment = await getScrapedContent('entertainment', 6);
    const newsItems = await getScrapedContent('news', 5);
    const publicNews = await getPublicPosts('news', 3);

    // Build advert banner HTML
    const advertHTML = adverts.length > 0 ? `
      <div id="advert-banner" style="background:linear-gradient(90deg,#f59e0b,#d97706);padding:14px 20px;text-align:center;color:white;font-weight:600;position:relative;overflow:hidden">
        <div id="advert-text" style="display:inline-block">
          ${adverts.map(a => `<span class="advert-item" style="display:none"><a href="${esc(a.link_url || '#')}" style="color:white;text-decoration:underline">${esc(a.title)}</a> &mdash; ${esc(a.content || '')}</span>`).join('')}
        </div>
        <span style="font-size:11px;opacity:0.7;margin-left:12px">Sponsored</span>
      </div>
      <script>
      (function(){
        var items = document.querySelectorAll('.advert-item');
        if(items.length === 0) return;
        var idx = 0;
        items[0].style.display = 'inline';
        setInterval(function(){
          items[idx].style.display = 'none';
          idx = (idx + 1) % items.length;
          items[idx].style.display = 'inline';
        }, 5000);
      })();
      </script>
    ` : '';

    // Build entertainment rotation HTML
    const entHTML = entertainment.slice(0, 6).map(e => `
      <div style="min-width:280px;background:white;border-radius:14px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);border:1px solid #e2e8f0;flex-shrink:0">
        <div style="background:linear-gradient(135deg,#7c3aed,#a855f7);padding:20px;color:white;min-height:80px">
          <div style="font-weight:700;font-size:15px">${esc(e.title)}</div>
          <div style="font-size:12px;opacity:0.85;margin-top:6px">${esc(e.source || '')}</div>
        </div>
        <div style="padding:12px">
          <a href="${esc(e.url || '#')}" target="_blank" style="color:#7c3aed;font-size:13px;font-weight:600">Watch / Read &rarr;</a>
        </div>
      </div>
    `).join('');

    // News ticker HTML
    const allNews = [...publicNews.map(n => ({ title: n.title, source: 'Comfort', url: '#' })), ...newsItems.map(n => ({ title: n.title, source: n.source || '', url: n.url || '#' }))];
    const newsTickerHTML = allNews.slice(0, 5).map(n => `<span style="margin-right:40px"><a href="${esc(n.url)}" style="color:white;text-decoration:none">${esc(n.title)}</a> <span style="opacity:0.7;font-size:11px">[${esc(n.source)}]</span></span>`).join('');

    const content = `
      ${advertHTML}

      <!-- NEWS TICKER -->
      ${allNews.length > 0 ? `
      <div style="background:#1e293b;color:white;overflow:hidden;padding:10px 0;font-size:14px">
        <div style="display:flex;align-items:center">
          <span style="background:#ef4444;color:white;padding:4px 14px;font-weight:700;font-size:12px;margin-right:12px;white-space:nowrap"><a href="/news" style="color:white;text-decoration:none">NEWS</a></span>
          <marquee behavior="scroll" direction="left" scrollamount="4">${newsTickerHTML}</marquee>
        </div>
      </div>
      ` : ''}

      <!-- HERO SECTION -->
      <div style="background:linear-gradient(135deg,#059669 0%,#0d9488 40%,#0891b2 100%);padding:80px 20px;text-align:center;position:relative;overflow:hidden">
        <div style="position:absolute;top:0;left:0;right:0;bottom:0;background:url('data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><circle cx=%2250%22 cy=%2250%22 r=%2240%22 fill=%22rgba(255,255,255,0.05)%22/></svg>') repeat;background-size:60px;opacity:0.3"></div>
        <div style="position:relative;z-index:2">
          <div style="font-size:14px;font-weight:600;letter-spacing:3px;text-transform:uppercase;opacity:0.9;margin-bottom:16px;color:#d1fae5">Now Serving All of Africa</div>
          <h1 style="font-size:clamp(28px,5vw,56px);font-weight:900;color:white;margin-bottom:16px;line-height:1.15">
            The Operating System for<br>Schools, Clinics, Churches<br>&amp; Businesses in Africa
          </h1>
          <p style="font-size:clamp(16px,2.5vw,24px);color:#d1fae5;font-weight:600;margin-bottom:8px">
            Stop Juggling 12 Different Apps.<br>Start Running Your Institution.
          </p>
          <p style="font-size:16px;color:rgba(255,255,255,0.8);margin-bottom:36px;max-width:600px;margin-left:auto;margin-right:auto">
            One platform. All your operations. Built for Uganda, designed for Africa.
          </p>
          <div style="display:flex;gap:16px;justify-content:center;flex-wrap:wrap">
            <a href="/register" style="display:inline-block;padding:16px 36px;background:white;color:#059669;border-radius:12px;font-weight:700;font-size:18px;text-decoration:none;transition:0.3s;box-shadow:0 8px 30px rgba(0,0,0,0.2)">Start Free &rarr;</a>
            <a href="/login" style="display:inline-block;padding:16px 36px;background:rgba(255,255,255,0.15);color:white;border-radius:12px;font-weight:700;font-size:18px;text-decoration:none;border:2px solid rgba(255,255,255,0.4);transition:0.3s">Login</a>
            <button id="install-btn" style="display:none;padding:16px 36px;background:linear-gradient(135deg,#f59e0b,#d97706);color:white;border-radius:12px;font-weight:700;font-size:18px;border:none;cursor:pointer;transition:0.3s">Install App</button>
          </div>
          <div style="margin-top:24px;display:flex;gap:24px;justify-content:center;flex-wrap:wrap">
            <span style="color:rgba(255,255,255,0.9);font-size:14px">&#10003; No credit card required</span>
            <span style="color:rgba(255,255,255,0.9);font-size:14px">&#10003; Setup in 10 minutes</span>
            <span style="color:rgba(255,255,255,0.9);font-size:14px">&#10003; Works offline</span>
          </div>
        </div>
      </div>

      <!-- ANIMATED STATS COUNTER -->
      <div style="background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:60px 20px;margin:40px 0;border-radius:20px;text-align:center">
        <h2 style="color:white;font-size:28px;margin-bottom:30px">Trusted by Institutions Across Africa</h2>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:30px;max-width:800px;margin:0 auto">
          <div><div style="font-size:42px;font-weight:900;color:white" id="stat1">0</div><div style="color:rgba(255,255,255,0.8);font-size:14px;margin-top:4px">Active Users</div></div>
          <div><div style="font-size:42px;font-weight:900;color:white" id="stat2">0</div><div style="color:rgba(255,255,255,0.8);font-size:14px;margin-top:4px">Institutions</div></div>
          <div><div style="font-size:42px;font-weight:900;color:white" id="stat3">0</div><div style="color:rgba(255,255,255,0.8);font-size:14px;margin-top:4px">Records Managed</div></div>
          <div><div style="font-size:42px;font-weight:900;color:white" id="stat4">0</div><div style="color:rgba(255,255,255,0.8);font-size:14px;margin-top:4px">Countries</div></div>
        </div>
      </div>
      <script>
      // Animated counter
      function animateCounter(id, target, suffix) {
        var el = document.getElementById(id);
        if (!el) return;
        var start = 0;
        var duration = 2000;
        var step = target / (duration / 16);
        var timer = setInterval(function() {
          start += step;
          if (start >= target) { start = target; clearInterval(timer); }
          el.textContent = Math.floor(start).toLocaleString() + (suffix || '');
        }, 16);
      }
      // Use dynamic counts from server if available
      animateCounter('stat1', 150, '+');
      animateCounter('stat2', 30, '+');
      animateCounter('stat3', 50000, '+');
      animateCounter('stat4', 5, '');
      </script>

      <!-- FEATURE SECTIONS -->
      <div style="padding:60px 20px;max-width:1200px;margin:0 auto">
        <h2 style="text-align:center;font-size:36px;font-weight:800;margin-bottom:12px;color:#1e293b">Built For Your Institution</h2>
        <p style="text-align:center;color:#64748b;margin-bottom:48px;font-size:18px">Choose your sector. We handle the rest.</p>

        <!-- SCHOOLS -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px;margin-bottom:48px">
          <div style="background:white;border-radius:20px;padding:32px;box-shadow:0 4px 20px rgba(0,0,0,0.08);border-top:5px solid #059669;transition:transform 0.3s">
            <div style="font-size:40px;margin-bottom:12px">&#127979;</div>
            <h3 style="font-size:22px;font-weight:800;color:#059669;margin-bottom:4px">For Schools</h3>
            <div style="font-size:14px;color:#059669;font-weight:600;margin-bottom:16px">UGX 150,000/month</div>
            <ul style="list-style:none;padding:0;font-size:14px;color:#475569;line-height:2">
              <li>&#10003; Student Management (Admissions to Graduation)</li>
              <li>&#10003; Fees Collection &amp; Payment Tracking</li>
              <li>&#10003; Exam &amp; Report Card Generation</li>
              <li>&#10003; Attendance (Biometric Ready)</li>
              <li>&#10003; Timetable &amp; Lesson Planning</li>
              <li>&#10003; Parent Portal &amp; SMS Alerts</li>
              <li>&#10003; School Clinic (Doctor-Pharmacist-Lab)</li>
              <li>&#10003; Transport &amp; Hostel Management</li>
              <li>&#10003; Library &amp; Digital Resources</li>
              <li>&#10003; Staff Payroll &amp; HR</li>
            </ul>
            <a href="/register?type=school" style="display:inline-block;margin-top:12px;padding:10px 24px;background:#059669;color:white;border-radius:10px;font-weight:600;text-decoration:none;font-size:14px">Start Free Trial</a>
          </div>

          <!-- CLINICS -->
          <div style="background:white;border-radius:20px;padding:32px;box-shadow:0 4px 20px rgba(0,0,0,0.08);border-top:5px solid #0891b2;transition:transform 0.3s">
            <div style="font-size:40px;margin-bottom:12px">&#127973;</div>
            <h3 style="font-size:22px;font-weight:800;color:#0891b2;margin-bottom:4px">For Clinics</h3>
            <div style="font-size:14px;color:#0891b2;font-weight:600;margin-bottom:16px">UGX 200,000/month</div>
            <ul style="list-style:none;padding:0;font-size:14px;color:#475569;line-height:2">
              <li>&#10003; Patient Registration &amp; Records</li>
              <li>&#10003; Doctor Consultation Workflow</li>
              <li>&#10003; Pharmacy Management</li>
              <li>&#10003; Laboratory &amp; Results</li>
              <li>&#10003; Appointment Scheduling</li>
              <li>&#10003; Billing &amp; Insurance Claims</li>
              <li>&#10003; Drug Inventory &amp; Expiry Alerts</li>
              <li>&#10003; Inpatient &amp; Ward Management</li>
              <li>&#10003; SMS Reminders to Patients</li>
              <li>&#10003; HMIS Reports (MOH Compliant)</li>
            </ul>
            <a href="/register?type=clinic" style="display:inline-block;margin-top:12px;padding:10px 24px;background:#0891b2;color:white;border-radius:10px;font-weight:600;text-decoration:none;font-size:14px">Start Free Trial</a>
          </div>

          <!-- CHURCHES -->
          <div style="background:white;border-radius:20px;padding:32px;box-shadow:0 4px 20px rgba(0,0,0,0.08);border-top:5px solid #7c3aed;transition:transform 0.3s">
            <div style="font-size:40px;margin-bottom:12px">&#9938;</div>
            <h3 style="font-size:22px;font-weight:800;color:#7c3aed;margin-bottom:4px">For Churches</h3>
            <div style="font-size:14px;color:#7c3aed;font-weight:600;margin-bottom:16px">UGX 100,000/month</div>
            <ul style="list-style:none;padding:0;font-size:14px;color:#475569;line-height:2">
              <li>&#10003; Member Directory &amp; Groups</li>
              <li>&#10003; Tithe &amp; Offering Tracking</li>
              <li>&#10003; Sermon Library &amp; Archive</li>
              <li>&#10003; Prayer Request Management</li>
              <li>&#10003; Event &amp; Conference Planning</li>
              <li>&#10003; Choir &amp; Music Ministry</li>
              <li>&#10003; Cell Group Management</li>
              <li>&#10003; Fundraising &amp; Campaigns</li>
              <li>&#10003; Church Attendance Tracking</li>
              <li>&#10003; SMS &amp; Email Broadcast</li>
            </ul>
            <a href="/register?type=church" style="display:inline-block;margin-top:12px;padding:10px 24px;background:#7c3aed;color:white;border-radius:10px;font-weight:600;text-decoration:none;font-size:14px">Start Free Trial</a>
          </div>

          <!-- BUSINESSES -->
          <div style="background:white;border-radius:20px;padding:32px;box-shadow:0 4px 20px rgba(0,0,0,0.08);border-top:5px solid #d97706;transition:transform 0.3s">
            <div style="font-size:40px;margin-bottom:12px">&#128188;</div>
            <h3 style="font-size:22px;font-weight:800;color:#d97706;margin-bottom:4px">For Businesses</h3>
            <div style="font-size:14px;color:#d97706;font-weight:600;margin-bottom:16px">UGX 180,000/month</div>
            <ul style="list-style:none;padding:0;font-size:14px;color:#475569;line-height:2">
              <li>&#10003; Point of Sale (POS)</li>
              <li>&#10003; Inventory &amp; Stock Management</li>
              <li>&#10003; Invoice &amp; Quotation Generator</li>
              <li>&#10003; Customer Relationship Management</li>
              <li>&#10003; Profit &amp; Loss Reports</li>
              <li>&#10003; Payroll &amp; HR Management</li>
              <li>&#10003; Expense Tracking</li>
              <li>&#10003; Tax Reports (URA Compliant)</li>
              <li>&#10003; Purchase Orders &amp; Suppliers</li>
              <li>&#10003; Multi-branch Support</li>
            </ul>
            <a href="/register?type=business" style="display:inline-block;margin-top:12px;padding:10px 24px;background:#d97706;color:white;border-radius:10px;font-weight:600;text-decoration:none;font-size:14px">Start Free Trial</a>
          </div>
        </div>
      </div>

      <!-- TESTIMONIALS -->
      <div style="margin:60px 0">
        <h2 style="text-align:center;font-size:28px;font-weight:800;margin-bottom:30px;color:#1e293b">What Our Users Say</h2>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px;max-width:1000px;margin:0 auto">
          <div style="background:white;padding:24px;border-radius:16px;box-shadow:0 2px 12px rgba(0,0,0,0.06);border:1px solid #e2e8f0">
            <div style="display:flex;gap:4px;margin-bottom:12px"><span style="color:#f59e0b;font-size:18px">&#9733;&#9733;&#9733;&#9733;&#9733;</span></div>
            <p style="color:#475569;line-height:1.7;font-style:italic">"Comfort made managing our school so easy. We track fees, attendance, and grades all in one place. Parents love the real-time updates!"</p>
            <div style="margin-top:16px;display:flex;align-items:center;gap:12px">
              <div style="width:40px;height:40px;background:linear-gradient(135deg,#059669,#10b981);border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-weight:700">JK</div>
              <div><div style="font-weight:600;color:#1e293b">James K.</div><div style="font-size:13px;color:#64748b">School Administrator, Kampala</div></div>
            </div>
          </div>
          <div style="background:white;padding:24px;border-radius:16px;box-shadow:0 2px 12px rgba(0,0,0,0.06);border:1px solid #e2e8f0">
            <div style="display:flex;gap:4px;margin-bottom:12px"><span style="color:#f59e0b;font-size:18px">&#9733;&#9733;&#9733;&#9733;&#9733;</span></div>
            <p style="color:#475569;line-height:1.7;font-style:italic">"Our church tithe collection improved by 60% after switching to Comfort. The mobile money integration is perfect for Uganda."</p>
            <div style="margin-top:16px;display:flex;align-items:center;gap:12px">
              <div style="width:40px;height:40px;background:linear-gradient(135deg,#7c3aed,#a855f7);border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-weight:700">GN</div>
              <div><div style="font-weight:600;color:#1e293b">Grace N.</div><div style="font-size:13px;color:#64748b">Church Treasurer, Entebbe</div></div>
            </div>
          </div>
          <div style="background:white;padding:24px;border-radius:16px;box-shadow:0 2px 12px rgba(0,0,0,0.06);border:1px solid #e2e8f0">
            <div style="display:flex;gap:4px;margin-bottom:12px"><span style="color:#f59e0b;font-size:18px">&#9733;&#9733;&#9733;&#9733;&#9733;</span></div>
            <p style="color:#475569;line-height:1.7;font-style:italic">"As a small business owner, Comfort replaced 4 different apps for me. Invoices, inventory, customers — everything in one dashboard."</p>
            <div style="margin-top:16px;display:flex;align-items:center;gap:12px">
              <div style="width:40px;height:40px;background:linear-gradient(135deg,#d97706,#f59e0b);border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-weight:700">PM</div>
              <div><div style="font-weight:600;color:#1e293b">Peter M.</div><div style="font-size:13px;color:#64748b">Business Owner, Jinja</div></div>
            </div>
          </div>
        </div>
      </div>

      <!-- COMPARISON TABLE -->
      <div style="background:#f1f5f9;padding:60px 20px">
        <div style="max-width:900px;margin:0 auto">
          <h2 style="text-align:center;font-size:32px;font-weight:800;margin-bottom:12px;color:#1e293b">Why Comfort?</h2>
          <p style="text-align:center;color:#64748b;margin-bottom:36px">See how we compare to using multiple separate tools.</p>
          <div style="overflow-x:auto">
            <table style="width:100%;border-collapse:collapse;background:white;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.06)">
              <thead>
                <tr style="background:linear-gradient(135deg,#059669,#0891b2)">
                  <th style="padding:16px;text-align:left;color:white;font-weight:700">Feature</th>
                  <th style="padding:16px;text-align:center;color:white;font-weight:700">Comfort</th>
                  <th style="padding:16px;text-align:center;color:white;font-weight:700">Others</th>
                </tr>
              </thead>
              <tbody>
                <tr style="border-bottom:1px solid #e2e8f0"><td style="padding:14px 16px;font-weight:600">All-in-One</td><td style="padding:14px;text-align:center;color:#059669;font-weight:700">&#10003;</td><td style="padding:14px;text-align:center;color:#ef4444">&#10007;</td></tr>
                <tr style="border-bottom:1px solid #e2e8f0;background:#f8fafc"><td style="padding:14px 16px;font-weight:600">Built for Uganda</td><td style="padding:14px;text-align:center;color:#059669;font-weight:700">&#10003;</td><td style="padding:14px;text-align:center;color:#ef4444">&#10007;</td></tr>
                <tr style="border-bottom:1px solid #e2e8f0"><td style="padding:14px 16px;font-weight:600">Offline Mode</td><td style="padding:14px;text-align:center;color:#059669;font-weight:700">&#10003;</td><td style="padding:14px;text-align:center;color:#ef4444">&#10007;</td></tr>
                <tr style="border-bottom:1px solid #e2e8f0;background:#f8fafc"><td style="padding:14px 16px;font-weight:600">SMS Built-In</td><td style="padding:14px;text-align:center;color:#059669;font-weight:700">&#10003;</td><td style="padding:14px;text-align:center;color:#f59e0b">&#126;</td></tr>
                <tr style="border-bottom:1px solid #e2e8f0"><td style="padding:14px 16px;font-weight:600">White-Label</td><td style="padding:14px;text-align:center;color:#059669;font-weight:700">&#10003;</td><td style="padding:14px;text-align:center;color:#ef4444">&#10007;</td></tr>
                <tr style="border-bottom:1px solid #e2e8f0;background:#f8fafc"><td style="padding:14px 16px;font-weight:600">Price</td><td style="padding:14px;text-align:center;color:#059669;font-weight:700">UGX 100K+</td><td style="padding:14px;text-align:center;color:#ef4444">$50+/mo</td></tr>
                <tr style="border-bottom:1px solid #e2e8f0"><td style="padding:14px 16px;font-weight:600">Support</td><td style="padding:14px;text-align:center;color:#059669;font-weight:700">24/7 Local</td><td style="padding:14px;text-align:center;color:#f59e0b">Email Only</td></tr>
                <tr><td style="padding:14px 16px;font-weight:600">Mobile App</td><td style="padding:14px;text-align:center;color:#059669;font-weight:700">&#10003; PWA</td><td style="padding:14px;text-align:center;color:#f59e0b">Sometimes</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- PRICING SECTION -->
      <div style="padding:60px 20px;max-width:1200px;margin:0 auto">
        <h2 style="text-align:center;font-size:32px;font-weight:800;margin-bottom:12px;color:#1e293b">Simple, Transparent Pricing</h2>
        <p style="text-align:center;color:#64748b;margin-bottom:48px;font-size:18px">No hidden fees. No surprises. Start free, upgrade when ready.</p>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:24px">
          <!-- FREE -->
          <div style="background:white;border-radius:20px;padding:32px;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,0.08);border:2px solid #e2e8f0">
            <div style="font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#64748b;margin-bottom:8px">Free</div>
            <div style="font-size:42px;font-weight:900;color:#1e293b">UGX 0</div>
            <div style="font-size:14px;color:#94a3b8;margin-bottom:20px">/month</div>
            <ul style="list-style:none;padding:0;font-size:14px;color:#475569;text-align:left;line-height:2.2;margin-bottom:24px">
              <li>&#10003; Up to 50 records</li>
              <li>&#10003; 1 User</li>
              <li>&#10003; Basic reports</li>
              <li>&#10003; SMS (5/day)</li>
              <li>&#10003; Community support</li>
            </ul>
            <a href="/register?plan=free" style="display:block;padding:12px;background:#e2e8f0;color:#475569;border-radius:10px;font-weight:700;text-decoration:none">Get Started</a>
          </div>
          <!-- BASIC -->
          <div style="background:white;border-radius:20px;padding:32px;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,0.08);border:2px solid #059669;position:relative">
            <div style="position:absolute;top:-14px;left:50%;transform:translateX(-50%);background:#059669;color:white;padding:4px 20px;border-radius:20px;font-size:12px;font-weight:700">POPULAR</div>
            <div style="font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#059669;margin-bottom:8px">Basic</div>
            <div style="font-size:42px;font-weight:900;color:#1e293b">UGX 100K</div>
            <div style="font-size:14px;color:#94a3b8;margin-bottom:20px">/month</div>
            <ul style="list-style:none;padding:0;font-size:14px;color:#475569;text-align:left;line-height:2.2;margin-bottom:24px">
              <li>&#10003; Up to 500 records</li>
              <li>&#10003; 5 Users</li>
              <li>&#10003; Advanced reports</li>
              <li>&#10003; SMS (50/day)</li>
              <li>&#10003; Email support</li>
              <li>&#10003; Custom branding</li>
            </ul>
            <a href="/register?plan=basic" style="display:block;padding:12px;background:#059669;color:white;border-radius:10px;font-weight:700;text-decoration:none">Choose Basic</a>
          </div>
          <!-- PRO -->
          <div style="background:white;border-radius:20px;padding:32px;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,0.08);border:2px solid #7c3aed">
            <div style="font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#7c3aed;margin-bottom:8px">Pro</div>
            <div style="font-size:42px;font-weight:900;color:#1e293b">UGX 200K</div>
            <div style="font-size:14px;color:#94a3b8;margin-bottom:20px">/month</div>
            <ul style="list-style:none;padding:0;font-size:14px;color:#475569;text-align:left;line-height:2.2;margin-bottom:24px">
              <li>&#10003; Up to 50,000 records</li>
              <li>&#10003; Unlimited Users</li>
              <li>&#10003; Full analytics</li>
              <li>&#10003; SMS (500/day)</li>
              <li>&#10003; Priority support</li>
              <li>&#10003; API access</li>
              <li>&#10003; White-label</li>
            </ul>
            <a href="/register?plan=pro" style="display:block;padding:12px;background:#7c3aed;color:white;border-radius:10px;font-weight:700;text-decoration:none">Choose Pro</a>
          </div>
          <!-- ENTERPRISE -->
          <div style="background:white;border-radius:20px;padding:32px;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,0.08);border:2px solid #d97706">
            <div style="font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#d97706;margin-bottom:8px">Enterprise</div>
            <div style="font-size:42px;font-weight:900;color:#1e293b">Custom</div>
            <div style="font-size:14px;color:#94a3b8;margin-bottom:20px">tailored for you</div>
            <ul style="list-style:none;padding:0;font-size:14px;color:#475569;text-align:left;line-height:2.2;margin-bottom:24px">
              <li>&#10003; Unlimited records</li>
              <li>&#10003; Unlimited Users</li>
              <li>&#10003; Custom integrations</li>
              <li>&#10003; Unlimited SMS</li>
              <li>&#10003; Dedicated support</li>
              <li>&#10003; On-premise option</li>
              <li>&#10003; SLA guarantee</li>
              <li>&#10003; Training included</li>
            </ul>
            <a href="/register?plan=enterprise" style="display:block;padding:12px;background:#d97706;color:white;border-radius:10px;font-weight:700;text-decoration:none">Contact Sales</a>
          </div>
        </div>
      </div>

      <!-- SETUP IN 10 MINUTES -->
      <div style="background:linear-gradient(135deg,#059669,#0891b2);padding:60px 20px">
        <div style="max-width:900px;margin:0 auto;text-align:center">
          <h2 style="font-size:32px;font-weight:800;color:white;margin-bottom:12px">Setup in 10 Minutes</h2>
          <p style="color:#d1fae5;margin-bottom:40px;font-size:18px">From sign-up to fully operational. No technical skills needed.</p>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:16px">
            <div style="background:rgba(255,255,255,0.15);border-radius:16px;padding:24px 16px">
              <div style="width:48px;height:48px;background:white;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 12px;font-weight:800;color:#059669;font-size:20px">1</div>
              <div style="color:white;font-weight:700;font-size:14px">Sign Up</div>
              <div style="color:rgba(255,255,255,0.7);font-size:12px;margin-top:4px">Create account</div>
            </div>
            <div style="background:rgba(255,255,255,0.15);border-radius:16px;padding:24px 16px">
              <div style="width:48px;height:48px;background:white;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 12px;font-weight:800;color:#059669;font-size:20px">2</div>
              <div style="color:white;font-weight:700;font-size:14px">Pick Type</div>
              <div style="color:rgba(255,255,255,0.7);font-size:12px;margin-top:4px">School, Church, etc.</div>
            </div>
            <div style="background:rgba(255,255,255,0.15);border-radius:16px;padding:24px 16px">
              <div style="width:48px;height:48px;background:white;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 12px;font-weight:800;color:#059669;font-size:20px">3</div>
              <div style="color:white;font-weight:700;font-size:14px">Activate</div>
              <div style="color:rgba(255,255,255,0.7);font-size:12px;margin-top:4px">Turn on features</div>
            </div>
            <div style="background:rgba(255,255,255,0.15);border-radius:16px;padding:24px 16px">
              <div style="width:48px;height:48px;background:white;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 12px;font-weight:800;color:#059669;font-size:20px">4</div>
              <div style="color:white;font-weight:700;font-size:14px">Import Data</div>
              <div style="color:rgba(255,255,255,0.7);font-size:12px;margin-top:4px">Upload CSV/Excel</div>
            </div>
            <div style="background:rgba(255,255,255,0.15);border-radius:16px;padding:24px 16px">
              <div style="width:48px;height:48px;background:white;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 12px;font-weight:800;color:#059669;font-size:20px">5</div>
              <div style="color:white;font-weight:700;font-size:14px">Invite Team</div>
              <div style="color:rgba(255,255,255,0.7);font-size:12px;margin-top:4px">Add your staff</div>
            </div>
            <div style="background:rgba(255,255,255,0.15);border-radius:16px;padding:24px 16px">
              <div style="width:48px;height:48px;background:white;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 12px;font-weight:800;color:#059669;font-size:20px">6</div>
              <div style="color:white;font-weight:700;font-size:14px">Go Live!</div>
              <div style="color:rgba(255,255,255,0.7);font-size:12px;margin-top:4px">You're running</div>
            </div>
          </div>
        </div>
      </div>

      <!-- FAQ SECTION -->
      <div style="padding:60px 20px;max-width:800px;margin:0 auto">
        <h2 style="text-align:center;font-size:32px;font-weight:800;margin-bottom:36px;color:#1e293b">Frequently Asked Questions</h2>
        <div style="display:flex;flex-direction:column;gap:12px">
          <details style="background:white;border-radius:12px;padding:20px;box-shadow:0 2px 8px rgba(0,0,0,0.06);border:1px solid #e2e8f0">
            <summary style="font-weight:700;cursor:pointer;color:#1e293b;font-size:16px">Is Comfort really free to start?</summary>
            <p style="margin-top:12px;color:#475569;font-size:15px;line-height:1.7">Yes! Our Free plan includes up to 50 records, 1 user, basic reports, and 5 SMS per day. No credit card required. Upgrade when you need more capacity.</p>
          </details>
          <details style="background:white;border-radius:12px;padding:20px;box-shadow:0 2px 8px rgba(0,0,0,0.06);border:1px solid #e2e8f0">
            <summary style="font-weight:700;cursor:pointer;color:#1e293b;font-size:16px">Does it work without internet?</summary>
            <p style="margin-top:12px;color:#475569;font-size:15px;line-height:1.7">Yes! Comfort has offline mode built in. You can enter data when disconnected, and everything syncs automatically when your connection returns. Perfect for areas with intermittent internet.</p>
          </details>
          <details style="background:white;border-radius:12px;padding:20px;box-shadow:0 2px 8px rgba(0,0,0,0.06);border:1px solid #e2e8f0">
            <summary style="font-weight:700;cursor:pointer;color:#1e293b;font-size:16px">Can I migrate from my current system?</summary>
            <p style="margin-top:12px;color:#475569;font-size:15px;line-height:1.7">Absolutely. We support CSV and Excel imports. Our team can also help with data migration from other systems. Most institutions are fully set up within a day.</p>
          </details>
          <details style="background:white;border-radius:12px;padding:20px;box-shadow:0 2px 8px rgba(0,0,0,0.06);border:1px solid #e2e8f0">
            <summary style="font-weight:700;cursor:pointer;color:#1e293b;font-size:16px">How do I pay?</summary>
            <p style="margin-top:12px;color:#475569;font-size:15px;line-height:1.7">We accept Mobile Money (MTN MoMo, Airtel Money), bank transfers, and Flutterwave for card payments. All prices are in Uganda Shillings with no hidden fees.</p>
          </details>
          <details style="background:white;border-radius:12px;padding:20px;box-shadow:0 2px 8px rgba(0,0,0,0.06);border:1px solid #e2e8f0">
            <summary style="font-weight:700;cursor:pointer;color:#1e293b;font-size:16px">Is my data secure?</summary>
            <p style="margin-top:12px;color:#475569;font-size:15px;line-height:1.7">Your data is encrypted, backed up daily, and stored securely. Each institution's data is completely isolated. We comply with Uganda's data protection regulations.</p>
          </details>
          <details style="background:white;border-radius:12px;padding:20px;box-shadow:0 2px 8px rgba(0,0,0,0.06);border:1px solid #e2e8f0">
            <summary style="font-weight:700;cursor:pointer;color:#1e293b;font-size:16px">Can I use Comfort on my phone?</summary>
            <p style="margin-top:12px;color:#475569;font-size:15px;line-height:1.7">Yes! Comfort is a Progressive Web App (PWA). Install it directly from your browser on any phone or tablet - no app store needed. Works on Android, iOS, and desktop.</p>
          </details>
        </div>
      </div>

      <!-- TRUSTED BY AFRICAN INSTITUTIONS - TESTIMONIALS -->
      <div style="background:linear-gradient(135deg,#f0f9ff,#e0f2fe);padding:50px 0;margin:40px 0">
        <div class="container">
          <h2 style="text-align:center;margin-bottom:30px">Trusted by African Institutions</h2>
          <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr))">
            <!-- 3 testimonial cards -->
            <div class="card" style="border-left:4px solid #059669">
              <p class="muted" style="font-style:italic">"Comfort transformed how we manage fees. Parents can now pay via mobile money and track their children's progress in real time."</p>
              <div style="margin-top:15px"><strong>Grace Nakamya</strong><br><span class="muted">Head Teacher, Sunrise Primary School - Kampala</span></div>
            </div>
            <div class="card" style="border-left:4px solid #4f46e5">
              <p class="muted" style="font-style:italic">"Our church membership grew 40% after digitizing. The tithe tracking and member portal saved us hours every week."</p>
              <div style="margin-top:15px"><strong>Pastor James Okello</strong><br><span class="muted">Senior Pastor, Grace Community Church - Gulu</span></div>
            </div>
            <div class="card" style="border-left:4px solid #f59e0b">
              <p class="muted" style="font-style:italic">"The POS and inventory system paid for itself in the first month. We finally have accurate stock levels across all branches."</p>
              <div style="margin-top:15px"><strong>Amina Mohamed</strong><br><span class="muted">Owner, Al-Baraka General Stores - Jinja</span></div>
            </div>
          </div>
        </div>
      </div>

      <!-- PRICING TABLE -->
      <div style="padding:50px 0" id="pricing">
        <div class="container">
          <h2 style="text-align:center;margin-bottom:10px">Simple, Transparent Pricing</h2>
          <p style="text-align:center;margin-bottom:30px" class="muted">Start free, upgrade when you're ready</p>
          <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:20px">
            <!-- Free Plan -->
            <div class="card" style="text-align:center;padding:30px;border:2px solid #e2e8f0">
              <h3>Free</h3>
              <div style="font-size:36px;font-weight:800;margin:15px 0"><span style="font-size:16px">UGX </span>0</div>
              <p class="muted">Forever free for small institutions</p>
              <hr style="margin:20px 0;border-color:#e2e8f0">
              <ul style="text-align:left;list-style:none;padding:0">
                <li style="padding:8px 0">✅ Up to 50 students/members</li>
                <li style="padding:8px 0">✅ Basic fee tracking</li>
                <li style="padding:8px 0">✅ Attendance management</li>
                <li style="padding:8px 0">✅ Mobile app access</li>
                <li style="padding:8px 0;color:#94a3b8">❌ Advanced reports</li>
                <li style="padding:8px 0;color:#94a3b8">❌ Multi-branch</li>
              </ul>
              <a href="/register" class="btn" style="margin-top:20px;width:100%;display:block">Get Started</a>
            </div>
            <!-- Basic Plan -->
            <div class="card" style="text-align:center;padding:30px;border:2px solid #4f46e5;transform:scale(1.05)">
              <div style="background:#4f46e5;color:white;display:inline-block;padding:4px 16px;border-radius:20px;font-size:12px;font-weight:600;margin-bottom:10px">POPULAR</div>
              <h3>Basic</h3>
              <div style="font-size:36px;font-weight:800;margin:15px 0"><span style="font-size:16px">UGX </span>50,000</div>
              <p class="muted">Per month</p>
              <hr style="margin:20px 0;border-color:#e2e8f0">
              <ul style="text-align:left;list-style:none;padding:0">
                <li style="padding:8px 0">✅ Up to 500 students/members</li>
                <li style="padding:8px 0">✅ Full fee management</li>
                <li style="padding:8px 0">✅ Report card generation</li>
                <li style="padding:8px 0">✅ SMS notifications</li>
                <li style="padding:8px 0">✅ Mobile money payments</li>
                <li style="padding:8px 0;color:#94a3b8">❌ Multi-branch</li>
              </ul>
              <a href="/register" class="btn" style="margin-top:20px;width:100%;display:block;background:#4f46e5">Start Free Trial</a>
            </div>
            <!-- Pro Plan -->
            <div class="card" style="text-align:center;padding:30px;border:2px solid #e2e8f0">
              <h3>Professional</h3>
              <div style="font-size:36px;font-weight:800;margin:15px 0"><span style="font-size:16px">UGX </span>150,000</div>
              <p class="muted">Per month</p>
              <hr style="margin:20px 0;border-color:#e2e8f0">
              <ul style="text-align:left;list-style:none;padding:0">
                <li style="padding:8px 0">✅ Unlimited students/members</li>
                <li style="padding:8px 0">✅ All Basic features</li>
                <li style="padding:8px 0">✅ Payroll & HR</li>
                <li style="padding:8px 0">✅ Multi-branch support</li>
                <li style="padding:8px 0">✅ Advanced analytics</li>
                <li style="padding:8px 0">✅ Priority support</li>
              </ul>
              <a href="/register" class="btn" style="margin-top:20px;width:100%;display:block">Start Free Trial</a>
            </div>
          </div>
        </div>
      </div>

      <!-- FAQ SECTION -->
      <div style="background:#f8fafc;padding:50px 0" id="faq">
        <div class="container">
          <h2 style="text-align:center;margin-bottom:30px">Frequently Asked Questions</h2>
          <div style="max-width:700px;margin:0 auto">
            <div class="card" style="margin-bottom:12px">
              <h3 style="font-size:16px">Is Comfort really free?</h3>
              <p class="muted">Yes! Our Free plan supports up to 50 students or members with core features. No credit card required. Upgrade anytime as your institution grows.</p>
            </div>
            <div class="card" style="margin-bottom:12px">
              <h3 style="font-size:16px">Does it work on mobile phones?</h3>
              <p class="muted">Absolutely. Comfort is a Progressive Web App (PWA) — it works beautifully on any device with a browser. You can even install it on your phone like a native app.</p>
            </div>
            <div class="card" style="margin-bottom:12px">
              <h3 style="font-size:16px">Can parents pay fees via mobile money?</h3>
              <p class="muted">Yes! We support MTN MoMo and Airtel Money payments. Parents receive instant receipts and fee balances update automatically.</p>
            </div>
            <div class="card" style="margin-bottom:12px">
              <h3 style="font-size:16px">Is my data secure?</h3>
              <p class="muted">Your data is encrypted in transit and at rest. We use industry-standard security practices including HTTPS, session management, and regular backups.</p>
            </div>
            <div class="card" style="margin-bottom:12px">
              <h3 style="font-size:16px">Do I need internet to use it?</h3>
              <p class="muted">Comfort works offline! Teachers can mark attendance and enter marks without internet. Data syncs automatically when you're back online.</p>
            </div>
            <div class="card" style="margin-bottom:12px">
              <h3 style="font-size:16px">Can I use it for multiple schools or branches?</h3>
              <p class="muted">Yes, our Professional plan supports multi-branch operations. Manage inventory, staff, and reports across all locations from one dashboard.</p>
            </div>
          </div>
        </div>
      </div>

      <!-- ENTERTAINMENT / EVENTS ROTATION -->
      ${entertainment.length > 0 ? `
      <div style="background:#f1f5f9;padding:40px 20px">
        <div style="max-width:1200px;margin:0 auto">
          <h2 style="font-size:24px;font-weight:800;margin-bottom:20px;color:#1e293b">&#127911; Entertainment &amp; Events</h2>
          <div style="display:flex;gap:16px;overflow-x:auto;padding-bottom:12px">
            ${entHTML}
          </div>
          <div style="text-align:center;margin-top:20px">
            <a href="/p/entertainment" style="color:#059669;font-weight:700;text-decoration:none;font-size:15px">See All Entertainment &rarr;</a>
          </div>
        </div>
      </div>
      ` : ''}

      <!-- ADVERT CARDS SECTION -->
      ${adverts.length > 0 ? `
      <div style="background:white;padding:40px 20px">
        <div style="max-width:1200px;margin:0 auto">
          <h2 style="font-size:24px;font-weight:800;margin-bottom:20px;color:#1e293b">&#128227; Featured</h2>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px">
            ${adverts.slice(0, 3).map(a => `
              <div style="background:white;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.06);border:2px solid #f59e0b;position:relative">
                <span style="position:absolute;top:10px;right:10px;background:#f59e0b;color:white;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700">AD</span>
                ${a.image_url ? `<img src="${esc(a.image_url)}" style="width:100%;max-height:200px;object-fit:cover" alt="${esc(a.title)}">` : ''}
                <div style="padding:16px">
                  <h3 style="margin:0 0 8px;font-size:18px;font-weight:700;color:#1e293b">${esc(a.title)}</h3>
                  <p style="color:#64748b;font-size:14px;margin:0 0 12px">${esc(a.content || a.description || '')}</p>
                  ${a.link_url ? `<a href="${esc(a.link_url)}" target="_blank" style="display:inline-block;padding:8px 20px;background:linear-gradient(135deg,#f59e0b,#d97706);color:white;border-radius:8px;font-weight:600;text-decoration:none;font-size:14px">Learn More</a>` : ''}
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
      ` : ''}

      <!-- WHATSAPP SHARE SECTION -->
      <div style="background:linear-gradient(135deg,#25D366,#128C7E);padding:50px 20px;text-align:center">
        <h2 style="font-size:clamp(22px,4vw,36px);font-weight:900;color:white;margin-bottom:12px">Share Comfort on WhatsApp</h2>
        <p style="color:rgba(255,255,255,0.9);font-size:17px;margin-bottom:28px;max-width:550px;margin-left:auto;margin-right:auto">Know someone who needs this? Spread the word and help transform more institutions across Africa.</p>
        <a href="https://api.whatsapp.com/send?text=${encodeURIComponent('Check out Comfort - The All-in-One Management Platform for Schools, Clinics, Churches & Businesses in Africa! Start free: ' + BASE_URL)}" target="blank" rel="noopener" style="display:inline-flex;align-items:center;gap:10px;padding:16px 40px;background:white;color:#25D366;border-radius:12px;font-weight:700;font-size:18px;text-decoration:none;box-shadow:0 8px 30px rgba(0,0,0,0.2)">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="#25D366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
          Share on WhatsApp
        </a>
      </div>

      <!-- FINAL CTA -->
      <div style="background:linear-gradient(135deg,#1e293b,#334155);padding:80px 20px;text-align:center">
        <h2 style="font-size:clamp(24px,4vw,42px);font-weight:900;color:white;margin-bottom:12px">Ready to Transform Your Institution?</h2>
        <p style="color:#94a3b8;font-size:18px;margin-bottom:36px;max-width:500px;margin-left:auto;margin-right:auto">Join hundreds of schools, churches, clinics, and businesses already using Comfort.</p>
        <div style="display:flex;gap:16px;justify-content:center;flex-wrap:wrap">
          <a href="/register" style="display:inline-block;padding:16px 40px;background:linear-gradient(135deg,#059669,#0891b2);color:white;border-radius:12px;font-weight:700;font-size:18px;text-decoration:none">Start Free Now</a>
          <a href="/blog" style="display:inline-block;padding:16px 40px;background:rgba(255,255,255,0.1);color:white;border-radius:12px;font-weight:700;font-size:18px;text-decoration:none;border:2px solid rgba(255,255,255,0.3)">Read Our Blog</a>
        </div>
      </div>

      <!-- CTA BANNER -->
      <div style="background:linear-gradient(135deg,#059669,#10b981);padding:60px 20px;border-radius:20px;margin:40px 0;text-align:center">
        <h2 style="color:white;font-size:32px;font-weight:900;margin-bottom:12px">Ready to Transform Your Institution?</h2>
        <p style="color:#d1fae5;font-size:18px;margin-bottom:24px;max-width:500px;margin-left:auto;margin-right:auto">Join hundreds of schools, churches, clinics and businesses already using Comfort.</p>
        <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
          <a href="/register" style="display:inline-block;padding:16px 36px;background:white;color:#059669;border-radius:12px;font-weight:700;text-decoration:none;font-size:16px;box-shadow:0 4px 20px rgba(0,0,0,0.15)">Get Started Free</a>
          <a href="/help" style="display:inline-block;padding:16px 36px;background:transparent;color:white;border:2px solid white;border-radius:12px;font-weight:700;text-decoration:none;font-size:16px">Learn More</a>
        </div>
      </div>

      <!-- FOOTER -->
      <footer style="background:#0f172a;padding:40px 20px 20px;color:#94a3b8;font-size:14px">
        <div style="max-width:1200px;margin:0 auto">
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:24px;margin-bottom:30px">
            <div>
              <div style="font-size:20px;font-weight:800;color:white;margin-bottom:12px">Comfort</div>
              <p style="line-height:1.7">The Operating System for Schools, Clinics, Churches &amp; Businesses in Africa.</p>
            </div>
            <div>
              <div style="font-weight:700;color:white;margin-bottom:12px">Product</div>
              <div style="display:flex;flex-direction:column;gap:6px">
                <a href="/register" style="color:#94a3b8;text-decoration:none">Register</a>
                <a href="/login" style="color:#94a3b8;text-decoration:none">Login</a>
                <a href="/blog" style="color:#94a3b8;text-decoration:none">Blog</a>
                <a href="/p/entertainment" style="color:#94a3b8;text-decoration:none">Entertainment</a>
                <a href="/p/fundraising" style="color:#94a3b8;text-decoration:none">Fundraising</a>
              </div>
            </div>
            <div>
              <div style="font-weight:700;color:white;margin-bottom:12px">Solutions</div>
              <div style="display:flex;flex-direction:column;gap:6px">
                <a href="/register?type=school" style="color:#94a3b8;text-decoration:none">Schools</a>
                <a href="/register?type=clinic" style="color:#94a3b8;text-decoration:none">Clinics</a>
                <a href="/register?type=church" style="color:#94a3b8;text-decoration:none">Churches</a>
                <a href="/register?type=business" style="color:#94a3b8;text-decoration:none">Businesses</a>
              </div>
            </div>
            <div>
              <div style="font-weight:700;color:white;margin-bottom:12px">Resources</div>
              <div style="display:flex;flex-direction:column;gap:6px">
                <a href="/blog" style="color:#94a3b8;text-decoration:none">Blog &amp; News</a>
                <a href="/directory" style="color:#94a3b8;text-decoration:none">Find Institutions</a>
                <a href="/links" style="color:#94a3b8;text-decoration:none">Useful Links</a>
                <a href="/p/entertainment" style="color:#94a3b8;text-decoration:none">Entertainment</a>
                <a href="/p/fundraising" style="color:#94a3b8;text-decoration:none">Campaigns</a>
                <a href="/privacy" style="color:#94a3b8;text-decoration:none">Privacy Policy</a>
                <a href="/terms" style="color:#94a3b8;text-decoration:none">Terms of Service</a>
              </div>
            </div>
            <div>
              <div style="font-weight:700;color:white;margin-bottom:12px">Portals</div>
              <div style="display:flex;flex-direction:column;gap:6px">
                <a href="/login" style="color:#94a3b8;text-decoration:none">Admin Login</a>
                <a href="/worker/login" style="color:#94a3b8;text-decoration:none">Worker Login</a>
                <a href="/register" style="color:#94a3b8;text-decoration:none">Create Account</a>
              </div>
            </div>
            <div>
              <div style="font-weight:700;color:white;margin-bottom:12px">Contact &amp; Help</div>
              <div style="display:flex;flex-direction:column;gap:6px">
                <a href="mailto:support@ssewasswa.onrender.com" style="color:#94a3b8;text-decoration:none">Email Support</a>
                <a href="https://wa.me/${WHATSAPP_NUMBER}" target="_blank" style="color:#94a3b8;text-decoration:none">WhatsApp Chat</a>
                <a href="/guide" style="color:#94a3b8;text-decoration:none">User Guide</a>
                <span style="color:#64748b;font-size:12px;margin-top:8px">Response time: within 24 hours</span>
              </div>
            </div>
          </div>
          <div style="border-top:1px solid #1e293b;padding-top:16px;text-align:center">
            &copy; ${new Date().getFullYear()} Comfort Platform. All rights reserved. Built with &#10084; in Uganda.
          </div>
        </div>
      </footer>

      <!-- FLOATING WHATSAPP BUTTON -->
      <a href="https://api.whatsapp.com/send?text=${encodeURIComponent('Check out Comfort - The All-in-One Platform for Schools, Clinics, Churches & Businesses! ' + BASE_URL)}" target="_blank" rel="noopener" style="position:fixed;bottom:24px;right:24px;width:60px;height:60px;border-radius:50%;background:#25D366;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 20px rgba(37,211,102,0.4);z-index:9999;transition:transform 0.3s" onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform='scale(1)'" title="Share on WhatsApp">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
      </a>

      <!-- MOBILE RESPONSIVE STYLES -->
      <style>
      @media(max-width:768px){
        #menuBtn{display:block!important}
        .nav-links{display:none!important;flex-direction:column;position:absolute;top:100%;left:0;right:0;background:#1e293b;padding:20px;gap:12px}
        .nav-links.open{display:flex!important}
        .hero h1{font-size:28px!important}
        .hero p{font-size:16px!important}
      }
      </style>
      <script>
      document.getElementById('menuBtn').addEventListener('click',function(){
        document.querySelector('.nav-links').classList.toggle('open');
      });
      </script>

      <!-- PWA INSTALL SCRIPT -->
      <script>
      (function(){
        let deferredPrompt = null;
        window.addEventListener('beforeinstallprompt', function(e){
          e.preventDefault();
          deferredPrompt = e;
          var btn = document.getElementById('install-btn');
          if(btn) btn.style.display = 'inline-block';
        });
        var installBtn = document.getElementById('install-btn');
        if(installBtn){
          installBtn.addEventListener('click', function(){
            if(!deferredPrompt) return;
            deferredPrompt.prompt();
            deferredPrompt.userChoice.then(function(choice){
              if(choice.outcome === 'accepted') console.log('PWA installed');
              deferredPrompt = null;
              installBtn.style.display = 'none';
            });
          });
        }
      })();
      </script>
      ${getStructuredData()}
    `;

    res.send(renderPage('Comfort - The Operating System for African Institutions', content, null, '/'));
  }));

  // =========================================================================
  // SECTION 6: PUBLIC ENTERTAINMENT PAGE
  // =========================================================================

  app.get('/p/entertainment', ah(async (req, res) => {
    const entertainment = await getScrapedContent('entertainment', 20);
    const sports = await getScrapedContent('sports', 20);
    const news = await getScrapedContent('news', 20);
    const publicEnt = await getPublicPosts('entertainment', 10);
    const adverts = await getActiveAdverts();

    const renderCards = (items, color) => items.map(item => `
      <div style="background:white;border-radius:14px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.06);border:1px solid #e2e8f0">
        <div style="background:linear-gradient(135deg,${color});padding:16px 20px;color:white">
          <div style="font-weight:700;font-size:15px">${esc(item.title)}</div>
          <div style="font-size:12px;opacity:0.85;margin-top:4px">${esc(item.source || 'Comfort')}</div>
        </div>
        ${item.summary ? `<div style="padding:12px 20px;font-size:14px;color:#475569">${esc(item.summary)}</div>` : ''}
        <div style="padding:8px 20px 16px">
          <a href="${esc(item.url || '#')}" target="_blank" style="color:${color.split(',')[0].replace('linear-gradient(135deg,','').trim()};font-weight:600;font-size:13px;text-decoration:none">View &rarr;</a>
        </div>
      </div>
    `).join('');

    const youTubeLinks = [
      { q: 'Uganda music 2024', label: 'Ugandan Music', emoji: '🎵' },
      { q: 'Uganda comedy 2024', label: 'Ugandan Comedy', emoji: '😂' },
      { q: 'Uganda sports highlights', label: 'Ugandan Sports', emoji: '⚽' },
      { q: 'Uganda news today', label: 'Uganda News', emoji: '📺' },
      { q: 'Uganda gospel music', label: 'Gospel Music', emoji: '🙏' },
      { q: 'Uganda movies 2024', label: 'Ugandan Movies', emoji: '🎬' },
    ];

    const embedHTML = youTubeLinks.map(e => `
      <a href="https://www.youtube.com/results?search_query=${encodeURIComponent(e.q)}" target="_blank" rel="noopener" style="text-decoration:none">
        <div style="background:white;border-radius:14px;padding:24px;box-shadow:0 2px 12px rgba(0,0,0,0.06);border:1px solid #e2e8f0;transition:transform 0.2s,box-shadow 0.2s;cursor:pointer" onmouseover="this.style.transform='translateY(-4px)';this.style.boxShadow='0 8px 24px rgba(0,0,0,0.12)'" onmouseout="this.style.transform='translateY(0)';this.style.boxShadow='0 2px 12px rgba(0,0,0,0.06)'">
          <div style="display:flex;align-items:center;gap:12px">
            <span style="font-size:32px">${e.emoji}</span>
            <div>
              <h3 style="font-size:16px;font-weight:700;margin:0;color:#1e293b">${esc(e.label)}</h3>
              <p style="font-size:13px;color:#dc2626;margin-top:4px">Watch on YouTube →</p>
            </div>
          </div>
        </div>
      </a>
    `).join('');

    const advertBanner = adverts.length > 0 ? `
      <div style="background:linear-gradient(90deg,#f59e0b,#d97706);padding:16px 20px;border-radius:12px;margin-bottom:24px;text-align:center">
        <span style="font-size:11px;color:rgba(255,255,255,0.7);display:block;margin-bottom:4px">SPONSORED</span>
        <a href="${esc(adverts[0].link_url || '#')}" style="color:white;font-weight:700;font-size:16px;text-decoration:underline">${esc(adverts[0].title)}</a>
        ${adverts[0].content ? `<span style="color:rgba(255,255,255,0.9);margin-left:12px">${esc(adverts[0].content)}</span>` : ''}
      </div>
    ` : '';

    const content = `
      <div style="padding:20px 0">
        ${advertBanner}
        ${adBanner('entertainment-top', 'leaderboard')}
        <div style="text-align:center;margin-bottom:36px">
          <h1 style="font-size:36px;font-weight:900;color:#1e293b">&#127911; Entertainment Hub</h1>
          <p style="color:#64748b;font-size:18px;margin-top:8px">Music, Comedy, Sports &amp; News from Uganda</p>
        </div>

        <!-- YouTube Embeds -->
        <div style="margin-bottom:40px">
          <h2 style="font-size:22px;font-weight:700;margin-bottom:16px;color:#1e293b">&#127916; Watch Now</h2>
          ${adBanner('watch-section', 'banner')}
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:20px">
            ${embedHTML}
          </div>
        </div>

        ${affiliateProductCards('entertainment-mid')}

        <!-- Music & Entertainment -->
        ${entertainment.length > 0 ? `
        <div style="margin-bottom:40px">
          <h2 style="font-size:22px;font-weight:700;margin-bottom:16px;color:#7c3aed">&#127925; Music &amp; Entertainment</h2>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px">
            ${renderCards([...publicEnt, ...entertainment], '#7c3aed,#a855f7')}
          </div>
        </div>
        ` : ''}

        <!-- Sports -->
        ${sports.length > 0 ? `
        <div style="margin-bottom:40px">
          <h2 style="font-size:22px;font-weight:700;margin-bottom:16px;color:#059669">&#9917; Sports</h2>
          ${adBanner('sports-section', 'banner')}
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px">
            ${renderCards(sports, '#059669,#10b981')}
          </div>
        </div>
        ` : ''}

        ${adBanner('between-content', 'rectangle')}

        <!-- News Headlines -->
        ${news.length > 0 ? `
        <div style="margin-bottom:40px">
          <h2 style="font-size:22px;font-weight:700;margin-bottom:16px;color:#0891b2">&#128240; News Headlines</h2>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px">
            ${renderCards(news, '#0891b2,#06b6d4')}
          </div>
        </div>
        ` : ''}

        ${affiliateProductCards('entertainment-bottom')}

        <!-- CTA -->
        <div style="background:linear-gradient(135deg,#059669,#0891b2);border-radius:20px;padding:40px;text-align:center;margin-top:40px">
          <h2 style="color:white;font-size:28px;font-weight:800;margin-bottom:12px">Love what you see?</h2>
          <p style="color:#d1fae5;font-size:16px;margin-bottom:24px">Sign up to create your own institution and start managing everything in one place.</p>
          <a href="/register" style="display:inline-block;padding:14px 32px;background:white;color:#059669;border-radius:12px;font-weight:700;text-decoration:none;font-size:16px">Sign Up Free</a>
        </div>
      </div>
    `;

    res.send(renderPage('Entertainment Hub - Comfort', content, req.session.user || null, '/p/entertainment') + monetizationScript);
  }));

  // =========================================================================
  // SECTION 6.4: PUBLIC NEWS HUB - SEO-optimized content aggregation page
  // =========================================================================

  app.get('/news', ah(async (req, res) => {
    const allContent = await getAllScrapedContent(12);
    const publicNews = await getPublicPosts('news', 5);
    const adverts = await getActiveAdverts();
    const stats = getScrapeStats();

    // Category configuration
    const categories = [
      { key: 'news', label: 'News Headlines', emoji: '128240', color: '#0891b2', gradient: 'linear-gradient(135deg,#0891b2,#06b6d4)' },
      { key: 'sports', label: 'Sports', emoji: '9917', color: '#059669', gradient: 'linear-gradient(135deg,#059669,#10b981)' },
      { key: 'entertainment', label: 'Entertainment', emoji: '127916', color: '#7c3aed', gradient: 'linear-gradient(135deg,#7c3aed,#a855f7)' },
      { key: 'technology', label: 'Technology', emoji: '128187', color: '#2563eb', gradient: 'linear-gradient(135deg,#2563eb,#3b82f6)' },
      { key: 'business', label: 'Business & Finance', emoji: '128200', color: '#d97706', gradient: 'linear-gradient(135deg,#d97706,#f59e0b)' },
      { key: 'education', label: 'Education', emoji: '127891', color: '#4f46e5', gradient: 'linear-gradient(135deg,#4f46e5,#6366f1)' },
      { key: 'health', label: 'Health', emoji: '129657', color: '#dc2626', gradient: 'linear-gradient(135deg,#dc2626,#ef4444)' },
    ];

    // Count total items
    let totalItems = 0;
    for (const cat of Object.values(allContent)) totalItems += cat.length;

    // Build category tabs
    const categoryTabs = categories.map((cat, idx) => {
      const count = (allContent[cat.key] || []).length;
      return '<button onclick="showCategory(\'' + cat.key + '\')" id="tab-' + cat.key + '" style="padding:10px 20px;border:none;border-radius:10px 10px 0 0;font-weight:600;font-size:14px;cursor:pointer;transition:all 0.2s;' + (idx === 0 ? 'background:white;color:' + cat.color + ';box-shadow:0 -2px 8px rgba(0,0,0,0.08)' : 'background:rgba(255,255,255,0.1);color:rgba(255,255,255,0.8)') + '">' + String.fromCodePoint(parseInt(cat.emoji)) + ' ' + cat.label + ' (' + count + ')</button>';
    }).join('');

    // Build content sections for each category
    const categorySections = categories.map((cat, idx) => {
      const items = allContent[cat.key] || [];
      const cards = items.map(item => {
        const date = item.scraped_at ? new Date(item.scraped_at).toLocaleDateString('en-UG', { year: 'numeric', month: 'short', day: 'numeric' }) : '';
        const excerpt = (item.summary || '').substring(0, 150) + ((item.summary || '').length > 150 ? '...' : '');
        const imgHTML = item.image_url ? '<img src="' + esc(item.image_url) + '" alt="' + esc(item.title) + '" style="width:100%;height:180px;object-fit:cover" loading="lazy" onerror="this.style.display=\'none\'">' : '<div style="width:100%;height:120px;background:' + cat.gradient + ';display:flex;align-items:center;justify-content:center;color:white;font-size:32px;opacity:0.6">' + String.fromCodePoint(parseInt(cat.emoji)) + '</div>';
        return '<div style="background:white;border-radius:14px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.06);border:1px solid #e2e8f0;transition:transform 0.2s,box-shadow 0.2s;cursor:pointer" onmouseover="this.style.transform=\'translateY(-3px)\';this.style.boxShadow=\'0 8px 24px rgba(0,0,0,0.12)\'" onmouseout="this.style.transform=\'translateY(0)\';this.style.boxShadow=\'0 2px 12px rgba(0,0,0,0.06)\'">' +
          imgHTML +
          '<div style="padding:16px 18px">' +
            '<h3 style="font-size:16px;font-weight:700;color:#1e293b;line-height:1.4;margin:0 0 8px 0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">' + esc(item.title) + '</h3>' +
            (excerpt ? '<p style="font-size:13px;color:#64748b;line-height:1.6;margin:0 0 10px 0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">' + esc(excerpt) + '</p>' : '') +
            '<div style="display:flex;justify-content:space-between;align-items:center">' +
              '<div style="display:flex;align-items:center;gap:8px">' +
                '<span style="font-size:11px;color:' + cat.color + ';font-weight:700;background:' + cat.color + '15;padding:3px 8px;border-radius:6px">' + esc(item.source || 'Comfort') + '</span>' +
                (date ? '<span style="font-size:11px;color:#94a3b8">' + date + '</span>' : '') +
              '</div>' +
              (item.url ? '<a href="' + esc(item.url) + '" target="_blank" rel="noopener" style="color:' + cat.color + ';font-weight:700;font-size:12px;text-decoration:none">Read &rarr;</a>' : '') +
            '</div>' +
          '</div>' +
        '</div>';
      }).join('');

      return '<div id="section-' + cat.key + '" style="display:' + (idx === 0 ? 'block' : 'none') + '">' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:18px">' + (cards || '<p style="color:#94a3b8;grid-column:1/-1;text-align:center;padding:40px">No content available yet. Check back soon!</p>') + '</div>' +
      '</div>';
    }).join('');

    // Build sidebar
    const sidebarNews = (allContent.news || []).slice(0, 8).map(n => {
      const date = n.scraped_at ? new Date(n.scraped_at).toLocaleDateString('en-UG', { month: 'short', day: 'numeric' }) : '';
      return '<a href="' + esc(n.url || '#') + '" target="_blank" rel="noopener" style="display:block;padding:10px 0;border-bottom:1px solid #f1f5f9;text-decoration:none;color:inherit">' +
        '<div style="font-size:13px;font-weight:600;color:#1e293b;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">' + esc(n.title) + '</div>' +
        '<div style="font-size:11px;color:#94a3b8;margin-top:3px">' + esc(n.source || '') + (date ? ' &bull; ' + date : '') + '</div>' +
      '</a>';
    }).join('');

    // Advert banner
    const advertBanner = adverts.length > 0 ? '<div style="background:linear-gradient(90deg,#f59e0b,#d97706);padding:14px 20px;border-radius:12px;margin-bottom:20px;text-align:center"><span style="font-size:11px;color:rgba(255,255,255,0.7);display:block;margin-bottom:4px">SPONSORED</span><a href="' + esc(adverts[0].link_url || '#') + '" style="color:white;font-weight:700;font-size:15px;text-decoration:underline">' + esc(adverts[0].title) + '</a>' + (adverts[0].content ? ' <span style="color:rgba(255,255,255,0.9);font-size:13px">' + esc(adverts[0].content) + '</span>' : '') + '</div>' : '';

    // Scrape status
    const statusHTML = stats.lastRun ? '<div style="font-size:11px;color:#94a3b8;margin-top:12px;text-align:center">Last updated: ' + new Date(stats.lastRun).toLocaleString('en-UG') + ' &bull; ' + (stats.totalItems || 0) + ' articles from ' + (stats.successSources || 0) + ' sources</div>' : '';

    const content = '<div style="padding:20px 0">' +
      advertBanner +
      adBanner('news-top', 'leaderboard') +
      // Hero header
      '<div style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 50%,#0891b2 100%);padding:50px 20px 40px;text-align:center;border-radius:0 0 24px 24px;margin-bottom:32px;position:relative;overflow:hidden">' +
        '<div style="position:absolute;top:0;left:0;right:0;bottom:0;background:radial-gradient(circle at 20% 50%,rgba(8,145,178,0.15),transparent 60%)"></div>' +
        '<div style="position:relative;z-index:2">' +
          '<div style="font-size:14px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:#06b6d4;margin-bottom:10px">Your Daily Source for</div>' +
          '<h1 style="font-size:clamp(28px,5vw,44px);font-weight:900;color:white;margin-bottom:10px;line-height:1.15">News, Sports, Tech &amp; More</h1>' +
          '<p style="color:#94a3b8;font-size:16px;margin-bottom:6px">Aggregated from 30+ sources across Africa and the world</p>' +
          '<div style="display:flex;gap:12px;justify-content:center;margin-top:16px;flex-wrap:wrap">' +
            '<span style="display:inline-flex;align-items:center;gap:4px;background:rgba(255,255,255,0.1);padding:6px 14px;border-radius:20px;font-size:13px;color:#cbd5e1">' + String.fromCodePoint(128240) + ' ' + totalItems + '+ Articles</span>' +
            '<span style="display:inline-flex;align-items:center;gap:4px;background:rgba(255,255,255,0.1);padding:6px 14px;border-radius:20px;font-size:13px;color:#cbd5e1">' + String.fromCodePoint(127760) + ' ' + categories.length + ' Categories</span>' +
            '<span style="display:inline-flex;align-items:center;gap:4px;background:rgba(255,255,255,0.1);padding:6px 14px;border-radius:20px;font-size:13px;color:#cbd5e1">' + String.fromCodePoint(128337) + ' 30+ Sources</span>' +
            '<span style="display:inline-flex;align-items:center;gap:4px;background:rgba(255,255,255,0.1);padding:6px 14px;border-radius:20px;font-size:13px;color:#cbd5e1">' + String.fromCodePoint(128339) + ' Updated Every 6h</span>' +
          '</div>' +
          statusHTML +
        '</div>' +
      '</div>' +
      // Main layout
      '<div style="display:grid;grid-template-columns:1fr 340px;gap:28px;align-items:start">' +
        '<div>' +
          // Category tabs
          '<div style="display:flex;gap:4px;margin-bottom:0;flex-wrap:wrap;background:#1e293b;padding:6px 6px 0;border-radius:14px 14px 0 0">' + categoryTabs + '</div>' +
          // Content area with white background
          '<div style="background:#f8fafc;padding:24px;border-radius:0 14px 14px 14px;min-height:400px;border:1px solid #e2e8f0;border-top:none">' + categorySections + '</div>' +
        '</div>' +
        // Sidebar
        '<div>' +
          // Trending now
          '<div style="background:white;border-radius:16px;padding:20px;box-shadow:0 2px 12px rgba(0,0,0,0.06);border:1px solid #e2e8f0;margin-bottom:20px">' +
            '<h3 style="font-size:16px;font-weight:700;margin-bottom:12px;color:#1e293b;display:flex;align-items:center;gap:6px">' + String.fromCodePoint(128293) + ' Trending Now</h3>' +
            (sidebarNews || '<p style="color:#94a3b8;font-size:13px">Loading latest news...</p>') +
          '</div>' +
          // Share on WhatsApp
          '<div style="background:linear-gradient(135deg,#25D366,#128C7E);border-radius:16px;padding:20px;text-align:center;margin-bottom:20px">' +
            '<div style="color:white;font-weight:700;margin-bottom:8px;font-size:15px">' + String.fromCodePoint(128172) + ' Share with Friends</div>' +
            '<a href="https://api.whatsapp.com/send?text=' + encodeURIComponent('Check out Comfort News - Latest Uganda & Africa news, sports, tech and more! ' + BASE_URL + '/news') + '" target="_blank" rel="noopener" style="display:inline-block;padding:10px 24px;background:white;color:#25D366;border-radius:10px;font-weight:700;text-decoration:none;font-size:14px">Share on WhatsApp</a>' +
          '</div>' +
          adBanner('news-sidebar', 'rectangle') +
          // Join CTA
          '<div style="background:linear-gradient(135deg,#059669,#0891b2);border-radius:16px;padding:20px;text-align:center;color:white">' +
            '<h3 style="font-size:16px;font-weight:700;margin-bottom:6px">' + String.fromCodePoint(127775) + ' Join Comfort Platform</h3>' +
            '<p style="font-size:13px;opacity:0.9;margin-bottom:14px">Manage your school, church, clinic or business all in one place.</p>' +
            '<a href="/register" style="display:inline-block;padding:10px 24px;background:white;color:#059669;border-radius:10px;font-weight:700;text-decoration:none;font-size:14px">Sign Up Free</a>' +
          '</div>' +
        '</div>' +
      '</div>' +
      // Mobile responsive
      '<style>' +
        '@media(max-width:900px){div[style*="grid-template-columns:1fr 340px"]{grid-template-columns:1fr!important}}' +
        '@media(max-width:600px){#category-tabs button{padding:8px 12px!important;font-size:12px!important}}' +
      '</style>' +
      // Category switching script
      '<script>' +
        'function showCategory(cat){' +
          'var sections=document.querySelectorAll("[id^=section-]");' +
          'var tabs=document.querySelectorAll("[id^=tab-]");' +
          'sections.forEach(function(s){s.style.display="none"});' +
          'tabs.forEach(function(t){t.style.background="rgba(255,255,255,0.1)";t.style.color="rgba(255,255,255,0.8)";t.style.boxShadow="none"});' +
          'var sec=document.getElementById("section-"+cat);' +
          'var tab=document.getElementById("tab-"+cat);' +
          'if(sec)sec.style.display="block";' +
          'if(tab){tab.style.background="white";tab.style.color="#1e293b";tab.style.boxShadow="0 -2px 8px rgba(0,0,0,0.08)"}' +
        '}' +
      '</script>' +
      // SEO structured data
      '<script type="application/ld+json">' +
        JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'NewsMediaOrganization',
          'name': 'Comfort News Hub',
          'url': BASE_URL + '/news',
          'logo': BASE_URL + '/icon.png',
          'description': 'Aggregated news, sports, technology, business and entertainment from Uganda and Africa',
          'address': { '@type': 'PostalAddress', 'addressLocality': 'Kampala', 'addressCountry': 'UG' }
        }) +
      '</script>' +
    '</div>';

    res.send(renderPage('News Hub - Uganda & Africa News, Sports, Tech | Comfort', content, req.session.user || null, '/news') + monetizationScript);
  }));

  // =========================================================================
  // SECTION 6.5: BLOG & NEWS SECTION
  // =========================================================================

  app.get('/blog', ah(async (req, res) => {
    const allPosts = await getPublicPosts('news', 50);
    const blogPosts = await getPublicPosts('blog', 50);
    const tips = await getPublicPosts('tips', 50);
    const scrapedNews = await getScrapedContent('news', 10);
    const adverts = await getActiveAdverts();

    const allBlogContent = [
      ...blogPosts.map(p => ({ ...p, section: 'Blog' })),
      ...allPosts.map(p => ({ ...p, section: 'News' })),
      ...tips.map(p => ({ ...p, section: 'Tips & Guides' })),
    ];

    // Default blog posts if none exist yet
    const defaultPosts = [
      { id: 0, title: 'Why African Schools Are Going Digital in 2025', content: 'Across Africa, schools are embracing digital transformation to streamline operations, improve learning outcomes, and stay competitive. From student management to fee collection and exam result generation, technology is revolutionizing how educational institutions operate. Comfort provides an all-in-one platform designed specifically for the unique challenges faced by African schools, including offline capability, mobile money integration, and support for local examination systems like UNEB. The shift to digital is not just about convenience — it is about ensuring every student gets the attention they deserve and every parent stays informed about their child progress.', category: 'blog', section: 'Blog', created_at: new Date() },
      { id: 0, title: 'How Churches Can Boost Tithe Collection with Technology', content: 'Churches across Uganda and East Africa are discovering that modern technology can significantly improve tithe and offering collection, member engagement, and community outreach. Comfort Church Management module provides tools for tracking tithes, managing member directories, scheduling services, and broadcasting prayer requests via SMS. With mobile money integration, members can give from anywhere, and church leaders get real-time financial dashboards. The platform also supports fundraising campaigns that can be shared on WhatsApp and social media, extending your church reach beyond the physical building.', category: 'blog', section: 'Blog', created_at: new Date() },
      { id: 0, title: '5 Ways Small Businesses in Uganda Can Save Money', content: 'Running a business in Uganda comes with unique challenges — high overhead costs, unpredictable supply chains, and limited access to affordable management tools. Here are five ways Comfort helps small businesses save money and grow: 1) Replace multiple subscriptions with one affordable platform. 2) Track inventory in real-time to reduce waste and theft. 3) Generate professional invoices that get paid faster. 4) Monitor profit and loss with automated reports. 5) Manage customer relationships to increase repeat business. With plans starting from UGX 0 for the free tier, every business can afford to get organized and start growing.', category: 'tips', section: 'Tips & Guides', created_at: new Date() },
      { id: 0, title: 'The Future of Healthcare Management in East Africa', content: 'Clinics and health centers across East Africa face mounting pressure to deliver quality care while managing limited resources. Paper-based patient records, manual billing, and disconnected laboratory systems create bottlenecks that affect patient outcomes. Comfort Clinic Management module digitizes the entire patient journey — from registration to consultation, pharmacy dispensing, and laboratory results. With HMIS-compliant reporting and SMS appointment reminders, clinics can operate more efficiently while maintaining the personal touch that patients value. The platform offline mode ensures continuity of care even when internet connectivity is unreliable.', category: 'blog', section: 'Blog', created_at: new Date() },
      { id: 0, title: 'Getting Started with Comfort: A Step-by-Step Guide', content: 'Setting up your institution on Comfort takes less than 10 minutes. Here is a quick walkthrough: Step 1 — Create your free account at ssewasswa.onrender.com/register. Step 2 — Choose your institution type (School, Church, Clinic, or Business). Step 3 — Fill in your institution details and customize your branding. Step 4 — Start adding data — students, members, patients, or inventory. Step 5 — Invite your team members and assign roles. Step 6 — Explore features like SMS notifications, report generation, and fundraising campaigns. The free plan gives you up to 50 records, 1 user, and 5 SMS per day — perfect for getting started. Upgrade to Basic or Pro when you need more capacity.', category: 'tips', section: 'Tips & Guides', created_at: new Date() },
    ];

    const displayPosts = allBlogContent.length > 0 ? allBlogContent : defaultPosts;

    const categoryColors = {
      'Blog': '#4f46e5',
      'News': '#0891b2',
      'Tips & Guides': '#059669',
    };

    const blogCards = displayPosts.map(post => {
      const section = post.section || 'Blog';
      const color = categoryColors[section] || '#4f46e5';
      const date = post.created_at ? new Date(post.created_at).toLocaleDateString('en-UG', { year: 'numeric', month: 'short', day: 'numeric' }) : '';
      const excerpt = post.content ? post.content.substring(0, 180) + (post.content.length > 180 ? '...' : '') : '';
      return `
        <div style="background:white;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.06);border:1px solid #e2e8f0;transition:transform 0.2s,box-shadow 0.2s">
          <div style="background:linear-gradient(135deg,${color},${color}cc);padding:24px 20px;color:white;min-height:90px">
            <span style="display:inline-block;background:rgba(255,255,255,0.2);padding:3px 12px;border-radius:20px;font-size:11px;font-weight:700;margin-bottom:8px">${esc(section)}</span>
            <h3 style="font-size:17px;font-weight:800;line-height:1.3;margin:0">${esc(post.title)}</h3>
          </div>
          <div style="padding:16px 20px">
            <p style="font-size:14px;color:#475569;line-height:1.7;margin-bottom:12px">${esc(excerpt)}</p>
            <div style="display:flex;justify-content:space-between;align-items:center">
              <span style="font-size:12px;color:#94a3b8">${date}</span>
              <a href="/blog/${post.id || '#'}" style="color:${color};font-weight:700;font-size:13px;text-decoration:none">Read More &rarr;</a>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Scraped news sidebar
    const newsSidebar = scrapedNews.slice(0, 8).map(n => `
      <a href="${esc(n.url || '#')}" target="_blank" rel="noopener" style="display:block;padding:12px 0;border-bottom:1px solid #e2e8f0;text-decoration:none;color:inherit">
        <div style="font-size:14px;font-weight:600;color:#1e293b;line-height:1.4">${esc(n.title)}</div>
        <div style="font-size:12px;color:#94a3b8;margin-top:4px">${esc(n.source || 'External')}</div>
      </a>
    `).join('');

    const advertBanner = adverts.length > 0 ? `
      <div style="background:linear-gradient(90deg,#f59e0b,#d97706);padding:16px 20px;border-radius:12px;margin-bottom:24px;text-align:center">
        <span style="font-size:11px;color:rgba(255,255,255,0.7);display:block;margin-bottom:4px">SPONSORED</span>
        <a href="${esc(adverts[0].link_url || '#')}" style="color:white;font-weight:700;font-size:16px;text-decoration:underline">${esc(adverts[0].title)}</a>
        ${adverts[0].content ? `<span style="color:rgba(255,255,255,0.9);margin-left:12px">${esc(adverts[0].content)}</span>` : ''}
      </div>
    ` : '';

    const content = `
      <div style="padding:20px 0">
        ${advertBanner}
        <div style="text-align:center;margin-bottom:40px">
          <h1 style="font-size:36px;font-weight:900;color:#1e293b">&#128240; Blog &amp; News</h1>
          <p style="color:#64748b;font-size:18px;margin-top:8px">Insights, tips, and updates from the Comfort team</p>
        </div>

        <div style="display:grid;grid-template-columns:1fr 320px;gap:32px;align-items:start">
          <!-- Main Blog Content -->
          <div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px">
              ${blogCards}
            </div>

            ${displayPosts.length === 0 ? `
            <div style="text-align:center;padding:60px 20px;background:white;border-radius:16px;box-shadow:0 2px 12px rgba(0,0,0,0.06)">
              <div style="font-size:48px;margin-bottom:16px">&#128221;</div>
              <h2 style="font-size:24px;font-weight:700;color:#1e293b;margin-bottom:8px">Blog Coming Soon</h2>
              <p style="color:#64748b;margin-bottom:24px">We are working on exciting content. Check back soon!</p>
              <a href="/" style="display:inline-block;padding:14px 32px;background:#059669;color:white;border-radius:12px;font-weight:700;text-decoration:none">Back Home</a>
            </div>
            ` : ''}
          </div>

          <!-- Sidebar -->
          <div>
            <!-- WhatsApp Share -->
            <div style="background:linear-gradient(135deg,#25D366,#128C7E);border-radius:16px;padding:20px;text-align:center;margin-bottom:20px">
              <div style="color:white;font-weight:700;margin-bottom:8px;font-size:15px">Share on WhatsApp</div>
              <a href="https://api.whatsapp.com/send?text=${encodeURIComponent('Check out Comfort Blog - Insights for Schools, Churches, Clinics & Businesses! ' + BASE_URL + '/blog')}" target="_blank" rel="noopener" style="display:inline-block;padding:10px 24px;background:white;color:#25D366;border-radius:10px;font-weight:700;text-decoration:none;font-size:14px">Share Now</a>
            </div>

            <!-- Latest News -->
            <div style="background:white;border-radius:16px;padding:20px;box-shadow:0 2px 12px rgba(0,0,0,0.06);border:1px solid #e2e8f0">
              <h3 style="font-size:16px;font-weight:700;margin-bottom:12px;color:#1e293b">&#128240; Latest News</h3>
              ${newsSidebar || '<p style="color:#94a3b8;font-size:14px">No news yet</p>'}
            </div>

            <!-- Newsletter CTA -->
            <div style="background:linear-gradient(135deg,#4f46e5,#7c3aed);border-radius:16px;padding:20px;text-align:center;margin-top:20px;color:white">
              <h3 style="font-size:16px;font-weight:700;margin-bottom:8px">Stay Updated</h3>
              <p style="font-size:13px;opacity:0.9;margin-bottom:16px">Get the latest tips and updates for your institution.</p>
              <a href="/register" style="display:inline-block;padding:10px 24px;background:white;color:#4f46e5;border-radius:10px;font-weight:700;text-decoration:none;font-size:14px">Join Comfort</a>
            </div>
          </div>
        </div>

        <!-- Mobile: stack the sidebar below -->
        <style>
          @media(max-width:768px) {
            div[style*="grid-template-columns:1fr 320px"] {
              grid-template-columns: 1fr !important;
            }
          }
        </style>
      </div>
    `;

    res.send(renderPage('Blog & News - Comfort', content, req.session.user || null, '/blog'));
  }));

  // Blog post detail page
  app.get('/blog/:id', ah(async (req, res) => {
    const postId = parseInt(req.params.id);
    if (!postId || isNaN(postId)) return res.redirect('/blog');

    try {
      const post = (await pool.query('SELECT * FROM public_posts WHERE id = $1', [postId])).rows[0];
      if (!post) return res.redirect('/blog');

      const relatedPosts = (await pool.query(
        'SELECT id, title, category FROM public_posts WHERE category = $1 AND id != $2 LIMIT 4',
        [post.category, postId]
      )).rows;

      const date = new Date(post.created_at).toLocaleDateString('en-UG', { year: 'numeric', month: 'long', day: 'numeric' });

      const relatedHTML = relatedPosts.map(r => `
        <a href="/blog/${r.id}" style="display:block;padding:12px;background:white;border-radius:10px;border:1px solid #e2e8f0;text-decoration:none;color:inherit;margin-bottom:8px">
          <div style="font-weight:600;color:#1e293b;font-size:14px">${esc(r.title)}</div>
          <span style="font-size:11px;color:#94a3b8;text-transform:capitalize">${esc(r.category)}</span>
        </a>
      `).join('');

      const shareUrl = encodeURIComponent(`${BASE_URL}/blog/${postId}`);
      const shareText = encodeURIComponent(post.title + ' - Comfort Blog');

      const content = `
        <div style="padding:20px 0">
          <a href="/blog" style="color:#4f46e5;font-weight:600;text-decoration:none;font-size:14px">&larr; Back to Blog</a>

          <div style="max-width:800px;margin:24px auto">
            <article>
              <div style="margin-bottom:24px">
                <span style="display:inline-block;background:#e0e7ff;color:#3730a3;padding:4px 14px;border-radius:20px;font-size:12px;font-weight:700;text-transform:capitalize">${esc(post.category)}</span>
                <h1 style="font-size:32px;font-weight:900;color:#1e293b;margin-top:12px;line-height:1.3">${esc(post.title)}</h1>
                <div style="font-size:14px;color:#94a3b8;margin-top:8px">${date}${post.created_by ? ' &bull; By ' + esc(post.created_by) : ''}</div>
              </div>

              ${post.image_url ? `<img src="${esc(post.image_url)}" alt="${esc(post.title)}" style="width:100%;border-radius:16px;margin-bottom:24px;max-height:400px;object-fit:cover" loading="lazy">` : ''}

              <div style="font-size:16px;line-height:1.8;color:#334155;white-space:pre-wrap">${esc(post.content || '')}</div>

              <!-- Share Buttons -->
              <div style="margin-top:40px;padding:24px;background:white;border-radius:16px;box-shadow:0 2px 12px rgba(0,0,0,0.06);border:1px solid #e2e8f0">
                <h3 style="font-size:16px;font-weight:700;margin-bottom:16px;color:#1e293b">Share This Article</h3>
                <div style="display:flex;gap:12px;flex-wrap:wrap">
                  <a href="https://api.whatsapp.com/send?text=${shareText}%20${shareUrl}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:8px;padding:10px 20px;background:#25D366;color:white;border-radius:10px;font-weight:600;text-decoration:none;font-size:14px">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                    WhatsApp
                  </a>
                  <a href="https://twitter.com/intent/tweet?text=${shareText}&url=${shareUrl}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:8px;padding:10px 20px;background:#1DA1F2;color:white;border-radius:10px;font-weight:600;text-decoration:none;font-size:14px">Twitter / X</a>
                  <a href="https://www.facebook.com/sharer/sharer.php?u=${shareUrl}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:8px;padding:10px 20px;background:#1877F2;color:white;border-radius:10px;font-weight:600;text-decoration:none;font-size:14px">Facebook</a>
                  <a href="https://www.linkedin.com/shareArticle?mini=true&url=${shareUrl}&title=${shareText}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:8px;padding:10px 20px;background:#0A66C2;color:white;border-radius:10px;font-weight:600;text-decoration:none;font-size:14px">LinkedIn</a>
                </div>
              </div>

              <!-- Related Posts -->
              ${relatedPosts.length > 0 ? `
              <div style="margin-top:32px">
                <h3 style="font-size:18px;font-weight:700;margin-bottom:16px;color:#1e293b">Related Articles</h3>
                ${relatedHTML}
              </div>
              ` : ''}
            </article>
          </div>
        </div>
      `;

      res.send(renderPage(post.title + ' - Comfort Blog', content, req.session.user || null, '/blog/' + postId));
    } catch (e) {
      console.error('[Blog Post] Error:', e.message);
      res.redirect('/blog');
    }
  }));

  // =========================================================================
  // SECTION 6.6: PRIVACY & TERMS PAGES
  // =========================================================================

  app.get('/privacy', ah(async (req, res) => {
    const content = `
      <div style="max-width:800px;margin:0 auto;padding:20px 0">
        <h1 style="font-size:32px;font-weight:900;color:#1e293b;margin-bottom:24px">Privacy Policy</h1>
        <div style="font-size:15px;line-height:1.8;color:#334155">
          <p style="margin-bottom:16px"><strong>Last updated:</strong> ${new Date().toLocaleDateString('en-UG', { year: 'numeric', month: 'long', day: 'numeric' })}</p>

          <h2 style="font-size:20px;font-weight:700;margin-top:24px;margin-bottom:12px;color:#1e293b">1. Information We Collect</h2>
          <p style="margin-bottom:12px">Comfort collects information you provide directly when registering an account, creating an institution profile, or using our services. This includes your name, email address, phone number, institution details, and any data you enter into the platform such as student records, financial transactions, member directories, and communication logs. We also collect usage data automatically, including pages visited, features used, browser type, device information, and IP addresses to improve our service and ensure security.</p>

          <h2 style="font-size:20px;font-weight:700;margin-top:24px;margin-bottom:12px;color:#1e293b">2. How We Use Your Information</h2>
          <p style="margin-bottom:12px">We use your information to provide and improve the Comfort platform, process transactions, send notifications and alerts, provide customer support, comply with legal obligations, and detect and prevent fraud or unauthorized access. Your data is never sold to third parties for marketing purposes. We may share anonymized, aggregated data for analytics and platform improvement.</p>

          <h2 style="font-size:20px;font-weight:700;margin-top:24px;margin-bottom:12px;color:#1e293b">3. Data Security</h2>
          <p style="margin-bottom:12px">We implement industry-standard security measures to protect your data, including encryption in transit (HTTPS/TLS), encrypted password storage using bcrypt hashing, session management with secure cookies, multi-tenant data isolation ensuring each institution data is separate, regular security audits and monitoring, and automated backups. While no system is completely secure, we continuously work to protect your information from unauthorized access, alteration, or disclosure.</p>

          <h2 style="font-size:20px;font-weight:700;margin-top:24px;margin-bottom:12px;color:#1e293b">4. Data Retention</h2>
          <p style="margin-bottom:12px">We retain your data for as long as your account is active or as needed to provide services. You can request deletion of your account and associated data at any time by contacting us. Some data may be retained in backup systems for up to 90 days after deletion. Audit logs are retained for security and compliance purposes for a period of up to 2 years.</p>

          <h2 style="font-size:20px;font-weight:700;margin-top:24px;margin-bottom:12px;color:#1e293b">5. Your Rights</h2>
          <p style="margin-bottom:12px">Under Uganda Data Protection Act and applicable laws, you have the right to access your personal data, correct inaccurate data, request deletion of your data, withdraw consent for data processing, data portability, and lodge a complaint with the data protection authority. To exercise any of these rights, contact us at waiswadaniel24@gmail.com.</p>

          <h2 style="font-size:20px;font-weight:700;margin-top:24px;margin-bottom:12px;color:#1e293b">6. Third-Party Services</h2>
          <p style="margin-bottom:12px">Comfort integrates with third-party services including Flutterwave for payment processing, Africa Talking for SMS delivery, Cloudinary for file storage, and Google Analytics for website analytics. Each third-party service has its own privacy policy, and we encourage you to review them. We only share data with these providers as necessary to provide the services you request.</p>

          <h2 style="font-size:20px;font-weight:700;margin-top:24px;margin-bottom:12px;color:#1e293b">7. Contact</h2>
          <p>For privacy-related questions or concerns, contact us at <a href="mailto:waiswadaniel24@gmail.com" style="color:#4f46e5">waiswadaniel24@gmail.com</a>.</p>
        </div>
      </div>
    `;
    res.send(renderPage('Privacy Policy - Comfort', content, req.session.user || null, '/privacy'));
  }));

  app.get('/terms', ah(async (req, res) => {
    const content = `
      <div style="max-width:800px;margin:0 auto;padding:20px 0">
        <h1 style="font-size:32px;font-weight:900;color:#1e293b;margin-bottom:24px">Terms of Service</h1>
        <div style="font-size:15px;line-height:1.8;color:#334155">
          <p style="margin-bottom:16px"><strong>Last updated:</strong> ${new Date().toLocaleDateString('en-UG', { year: 'numeric', month: 'long', day: 'numeric' })}</p>

          <h2 style="font-size:20px;font-weight:700;margin-top:24px;margin-bottom:12px;color:#1e293b">1. Acceptance of Terms</h2>
          <p style="margin-bottom:12px">By accessing or using the Comfort platform, you agree to be bound by these Terms of Service. If you do not agree to these terms, you may not access or use the platform. Comfort reserves the right to modify these terms at any time, and continued use of the platform constitutes acceptance of any changes.</p>

          <h2 style="font-size:20px;font-weight:700;margin-top:24px;margin-bottom:12px;color:#1e293b">2. Service Description</h2>
          <p style="margin-bottom:12px">Comfort is a multi-tenant SaaS platform providing management tools for schools, clinics, churches, and businesses in Africa. Services include student management, financial tracking, inventory management, member directories, communication tools, fundraising, entertainment content aggregation, and more. We reserve the right to modify, suspend, or discontinue any feature at any time.</p>

          <h2 style="font-size:20px;font-weight:700;margin-top:24px;margin-bottom:12px;color:#1e293b">3. Account Responsibilities</h2>
          <p style="margin-bottom:12px">You are responsible for maintaining the confidentiality of your account credentials, ensuring the accuracy of information you provide, all activities that occur under your account, notifying us immediately of any unauthorized use, and complying with all applicable laws and regulations. You must not share your account credentials with others or use another person account without authorization.</p>

          <h2 style="font-size:20px;font-weight:700;margin-top:24px;margin-bottom:12px;color:#1e293b">4. Subscription Plans and Billing</h2>
          <p style="margin-bottom:12px">Comfort offers both free and paid subscription plans. Plan details including pricing, record limits, and feature availability are listed on our homepage. Payments are processed through Flutterwave and are non-refundable except as required by law. Plan limits apply per tenant and are enforced automatically. We reserve the right to change pricing with 30 days notice.</p>

          <h2 style="font-size:20px;font-weight:700;margin-top:24px;margin-bottom:12px;color:#1e293b">5. Acceptable Use</h2>
          <p style="margin-bottom:12px">You agree not to use the platform for any unlawful purpose, upload malicious code or viruses, attempt to gain unauthorized access to other accounts or systems, harass or harm other users, use automated tools to scrape or collect data without permission, or violate any intellectual property rights. Violations may result in account suspension or termination without refund.</p>

          <h2 style="font-size:20px;font-weight:700;margin-top:24px;margin-bottom:12px;color:#1e293b">6. Data Ownership</h2>
          <p style="margin-bottom:12px">You retain ownership of all data you enter into the platform. Comfort does not claim ownership of your data. We will not access, modify, or delete your data except as necessary to provide the service, comply with legal obligations, or prevent security threats. You can export your data at any time.</p>

          <h2 style="font-size:20px;font-weight:700;margin-top:24px;margin-bottom:12px;color:#1e293b">7. Limitation of Liability</h2>
          <p style="margin-bottom:12px">Comfort is provided as-is without warranties of any kind. We are not liable for any indirect, incidental, special, or consequential damages arising from your use of the platform. Our total liability shall not exceed the amount you paid for the service in the 12 months preceding the claim. We are not responsible for data loss caused by force majeure events.</p>

          <h2 style="font-size:20px;font-weight:700;margin-top:24px;margin-bottom:12px;color:#1e293b">8. Contact</h2>
          <p>For questions about these terms, contact us at <a href="mailto:waiswadaniel24@gmail.com" style="color:#4f46e5">waiswadaniel24@gmail.com</a>.</p>
        </div>
      </div>
    `;
    res.send(renderPage('Terms of Service - Comfort', content, req.session.user || null, '/terms'));
  }));

  app.get('/p/fundraising', ah(async (req, res) => {
    const campaigns = await getActiveCampaigns();

    const campaignCards = campaigns.map(c => {
      const pct = c.target > 0 ? Math.min(100, Math.round((c.raised / c.target) * 100)) : 0;
      const barColor = pct >= 75 ? '#059669' : pct >= 40 ? '#f59e0b' : '#0891b2';
      return `
        <div style="background:white;border-radius:16px;padding:24px;box-shadow:0 4px 20px rgba(0,0,0,0.08);border:1px solid #e2e8f0">
          <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:12px">
            <div>
              <h3 style="font-size:18px;font-weight:700;color:#1e293b;margin:0">${esc(c.title)}</h3>
              <span style="font-size:12px;color:#64748b">by ${esc(c.tenant_name || 'Unknown')} &bull; ${esc(c.tenant_type || '')}</span>
            </div>
            <span style="background:${barColor}20;color:${barColor};padding:4px 12px;border-radius:20px;font-size:12px;font-weight:700">${pct}%</span>
          </div>
          <p style="font-size:14px;color:#475569;margin-bottom:16px;line-height:1.6">${esc(c.description || 'Help us reach our goal!')}</p>
          <div style="margin-bottom:12px">
            <div style="background:#e2e8f0;height:12px;border-radius:6px;overflow:hidden">
              <div style="background:${barColor};height:12px;border-radius:6px;width:${pct}%;transition:width 0.5s"></div>
            </div>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:14px">
            <span style="font-weight:700;color:#059669">UGX ${Number(c.raised || 0).toLocaleString()} raised</span>
            <span style="color:#64748b">of UGX ${Number(c.target || 0).toLocaleString()}</span>
          </div>
          <div style="margin-top:16px">
            <a href="${req.session.user ? '/discover/' + c.id : '/register'}" style="display:inline-block;padding:10px 24px;background:#059669;color:white;border-radius:10px;font-weight:600;text-decoration:none;font-size:14px">
              ${req.session.user ? 'View & Invest' : 'Sign Up to Donate'}
            </a>
          </div>
        </div>
      `;
    }).join('');

    const content = `
      <div style="padding:20px 0">
        <div style="text-align:center;margin-bottom:36px">
          <h1 style="font-size:36px;font-weight:900;color:#1e293b">&#10084; Fundraising Campaigns</h1>
          <p style="color:#64748b;font-size:18px;margin-top:8px">Support causes that matter. Every contribution counts.</p>
        </div>
        ${campaigns.length > 0 ? `
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:24px">
            ${campaignCards}
          </div>
        ` : `
          <div style="text-align:center;padding:60px 20px;background:white;border-radius:16px;box-shadow:0 2px 12px rgba(0,0,0,0.06)">
            <div style="font-size:48px;margin-bottom:16px">&#127881;</div>
            <h2 style="font-size:24px;font-weight:700;color:#1e293b;margin-bottom:8px">No Active Campaigns Yet</h2>
            <p style="color:#64748b;margin-bottom:24px">Be the first to create a fundraising campaign on Comfort!</p>
            <a href="/register" style="display:inline-block;padding:14px 32px;background:#059669;color:white;border-radius:12px;font-weight:700;text-decoration:none">Get Started</a>
          </div>
        `}
        <div style="background:linear-gradient(135deg,#7c3aed,#a855f7);border-radius:20px;padding:40px;text-align:center;margin-top:40px;color:white">
          <h2 style="font-size:24px;font-weight:800;margin-bottom:12px">Start Your Own Campaign</h2>
          <p style="opacity:0.9;margin-bottom:24px">Churches, schools, and organizations can create fundraising campaigns.</p>
          <a href="/register" style="display:inline-block;padding:14px 32px;background:white;color:#7c3aed;border-radius:12px;font-weight:700;text-decoration:none">Create Account</a>
        </div>
      </div>
    `;

    res.send(renderPage('Fundraising - Comfort', content, req.session.user || null, '/p/fundraising'));
  }));

  // =========================================================================
  // SECTION 8: PUBLIC TENANT SITE
  // =========================================================================

  app.get('/p/:subdomain', ah(async (req, res) => {
    const subdomain = req.params.subdomain;
    // Skip known routes
    if (subdomain === 'entertainment' || subdomain === 'fundraising') {
      return res.send(renderPage('Not Found', `
        <div style="text-align:center;padding:80px 20px">
          <div style="font-size:64px;margin-bottom:16px">&#128533;</div>
          <h1 style="font-size:32px;font-weight:800;color:#1e293b;margin-bottom:8px">Page Not Found</h1>
          <p style="color:#64748b;margin-bottom:24px">This page doesn't exist.</p>
          <a href="/" style="display:inline-block;padding:14px 32px;background:#059669;color:white;border-radius:12px;font-weight:700;text-decoration:none">Go Home</a>
        </div>
      `, null));
    }

    try {
      const tenant = (await pool.query('SELECT * FROM tenants WHERE subdomain = $1', [subdomain])).rows[0];
      if (!tenant) {
        return res.send(renderPage('Not Found', `
          <div style="text-align:center;padding:80px 20px">
            <div style="font-size:64px;margin-bottom:16px">&#128533;</div>
            <h1 style="font-size:32px;font-weight:800;color:#1e293b;margin-bottom:8px">Institution Not Found</h1>
            <p style="color:#64748b;margin-bottom:24px">The institution "${esc(subdomain)}" doesn't exist on Comfort yet.</p>
            <a href="/" style="display:inline-block;padding:14px 32px;background:#059669;color:white;border-radius:12px;font-weight:700;text-decoration:none">Go Home</a>
          </div>
        `, null));
      }

      let tenantContent = '';
      const typeColor = { school: '#059669', church: '#7c3aed', business: '#d97706', clinic: '#0891b2' };
      const color = typeColor[tenant.type] || '#4f46e5';
      const typeIcon = { school: '&#127979;', church: '&#9938;', business: '&#128188;', clinic: '&#127973;' };
      const icon = typeIcon[tenant.type] || '&#127968;';

      // Dynamic stats section for ALL tenant types
      let statsSection = `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin:24px 0">
          <div style="background:white;border-radius:12px;padding:20px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.06)">
            <div style="font-size:28px;font-weight:800;color:${color}">${esc(tenant.name.split(' ')[0])}</div>
            <div style="color:#64748b;font-size:14px;margin-top:4px">${esc(tenant.type ? tenant.type.charAt(0).toUpperCase() + tenant.type.slice(1) : 'Organization')}</div>
            <div style="font-size:12px;color:#94a3b8;margin-top:8px">${tenant.verified ? '<span style="color:#059669">&#10003; Verified</span>' : ''}</div>
          </div>
        </div>
      `;

      if (tenant.type === 'school') {
        const students = (await pool.query('SELECT COUNT(*) FROM students WHERE tenant_id=$1', [tenant.id])).rows[0].count;
        let fees = 0, classes = [];
        try { fees = (await pool.query('SELECT COUNT(*) FROM fees WHERE tenant_id=$1', [tenant.id])).rows[0].count; } catch(e) { /* fees table may not exist */ }
        try { classes = (await pool.query('SELECT DISTINCT class FROM students WHERE tenant_id=$1 AND class IS NOT NULL LIMIT 10', [tenant.id])).rows; } catch(e) { /* classes may not exist */ }
        tenantContent = `
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin:24px 0">
            <div style="background:white;border-radius:12px;padding:20px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.06)">
              <div style="font-size:28px;font-weight:800;color:${color}">${students}</div>
              <div style="color:#64748b;font-size:14px">Students</div>
            </div>
            <div style="background:white;border-radius:12px;padding:20px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.06)">
              <div style="font-size:28px;font-weight:800;color:${color}">${classes.length}</div>
              <div style="color:#64748b;font-size:14px">Classes</div>
            </div>
            <div style="background:white;border-radius:12px;padding:20px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.06)">
              <div style="font-size:28px;font-weight:800;color:${color}">${fees}</div>
              <div style="color:#64748b;font-size:14px">Fee Records</div>
            </div>
          </div>
          ${classes.length > 0 ? `
          <div style="background:white;border-radius:12px;padding:20px;margin-bottom:16px;border:1px solid #e2e8f0">
            <h3 style="font-size:18px;font-weight:700;margin-bottom:12px">Classes</h3>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              ${classes.map(c => `<span style="background:#f1f5f9;padding:6px 14px;border-radius:8px;font-size:13px;color:#475569">${esc(c.class)}</span>`).join('')}
            </div>
          </div>
          ` : ''}
          <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:16px">
            <a href="/register" style="padding:10px 24px;background:${color};color:white;border-radius:10px;font-weight:600;text-decoration:none;font-size:14px">Apply for Admission</a>
            <a href="/register" style="padding:10px 24px;background:rgba(0,0,0,0.05);color:#1e293b;border-radius:10px;font-weight:600;text-decoration:none;font-size:14px">View Fees Structure</a>
          </div>
        `;
      } else if (tenant.type === 'church') {
        const sermons = (await pool.query('SELECT * FROM sermons WHERE tenant_id=$1 ORDER BY sermon_date DESC LIMIT 5', [tenant.id])).rows;
        let events = [];
        try { events = (await pool.query("SELECT title, event_date, description FROM events WHERE tenant_id=$1 AND event_date >= NOW() ORDER BY event_date LIMIT 5", [tenant.id])).rows; } catch(e) { /* events table may not exist */ }
        tenantContent = `
          ${sermons.length > 0 ? `
          <h3 style="font-size:18px;font-weight:700;margin-bottom:12px">Recent Sermons</h3>
          <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:20px">
            ${sermons.map(s => `
              <div style="background:white;padding:12px 16px;border-radius:10px;border:1px solid #e2e8f0">
                <div style="font-weight:600;color:#1e293b">${esc(s.title)}</div>
                <div style="font-size:12px;color:#64748b">${esc(s.preacher || '')} ${s.scripture ? '&bull; ' + esc(s.scripture) : ''}</div>
              </div>
            `).join('')}
          </div>
          ` : ''}
          ${events.length > 0 ? `
          <h3 style="font-size:18px;font-weight:700;margin-bottom:12px">Upcoming Events</h3>
          <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:20px">
            ${events.map(ev => `
              <div style="background:white;padding:12px 16px;border-radius:10px;border:1px solid #e2e8f0">
                <div style="font-weight:600;color:#1e293b">${esc(ev.title)}</div>
                <div style="font-size:12px;color:#64748b">${new Date(ev.event_date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</div>
                ${ev.description ? `<div style="font-size:13px;color:#64748b;margin-top:4px">${esc(ev.description)}</div>` : ''}
              </div>
            `).join('')}
          </div>
          ` : ''}
          <div style="display:flex;gap:12px;flex-wrap:wrap">
            <a href="/register" style="padding:10px 24px;background:${color};color:white;border-radius:10px;font-weight:600;text-decoration:none;font-size:14px">Donate</a>
            <a href="/register" style="padding:10px 24px;background:rgba(0,0,0,0.05);color:#1e293b;border-radius:10px;font-weight:600;text-decoration:none;font-size:14px">View Events</a>
          </div>
        `;
      } else if (tenant.type === 'business') {
        const inv = (await pool.query('SELECT name, selling_price FROM inventory WHERE tenant_id=$1 LIMIT 8', [tenant.id])).rows;
        tenantContent = `
          ${inv.length > 0 ? `
          <h3 style="font-size:18px;font-weight:700;margin-bottom:12px">Products &amp; Services</h3>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:20px">
            ${inv.map(i => `
              <div style="background:white;padding:16px;border-radius:10px;border:1px solid #e2e8f0">
                <div style="font-weight:600;color:#1e293b">${esc(i.name)}</div>
                ${i.selling_price ? `<div style="color:${color};font-weight:700;font-size:14px;margin-top:4px">UGX ${Number(i.selling_price).toLocaleString()}</div>` : ''}
              </div>
            `).join('')}
          </div>
          ` : ''}
          <div style="background:white;border-radius:12px;padding:20px;margin-bottom:16px;border:1px solid #e2e8f0">
            <h3 style="font-size:18px;font-weight:700;margin-bottom:12px">Contact</h3>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;font-size:14px;color:#475569">
              ${tenant.email ? `<div>&#9993; <a href="mailto:${esc(tenant.email)}" style="color:#4f46e5;text-decoration:none">${esc(tenant.email)}</a></div>` : ''}
              ${tenant.phone ? `<div>&#9742; <a href="tel:${esc(tenant.phone)}" style="color:#4f46e5;text-decoration:none">${esc(tenant.phone)}</a></div>` : ''}
              ${tenant.address ? `<div>&#128205; ${esc(tenant.address)}</div>` : ''}
            </div>
          </div>
          <div style="display:flex;gap:12px;flex-wrap:wrap">
            <a href="/register" style="padding:10px 24px;background:${color};color:white;border-radius:10px;font-weight:600;text-decoration:none;font-size:14px">Contact Business</a>
          </div>
        `;
      } else if (tenant.type === 'clinic') {
        // Dynamic clinic data from database
        let clinicStats = '';
        try {
          const [patientCount, doctorCount, apptCount] = await Promise.all([
            pool.query('SELECT COUNT(*) FROM clinic_patients WHERE tenant_id=$1', [tenant.id]),
            pool.query("SELECT COUNT(*) FROM clinic_staff WHERE tenant_id=$1 AND role='doctor' AND is_active=true", [tenant.id]),
            pool.query('SELECT COUNT(*) FROM clinic_appointments WHERE tenant_id=$1', [tenant.id])
          ]);
          clinicStats = `
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px">
              <div style="background:#f0fdf4;border-radius:12px;padding:16px;text-align:center"><div style="font-size:24px;font-weight:800;color:#059669">${patientCount.rows[0].count}</div><div style="font-size:12px;color:#64748b">Patients</div></div>
              <div style="background:#eff6ff;border-radius:12px;padding:16px;text-align:center"><div style="font-size:24px;font-weight:800;color:#2563eb">${doctorCount.rows[0].count}</div><div style="font-size:12px;color:#64748b">Doctors</div></div>
              <div style="background:#fef3c7;border-radius:12px;padding:16px;text-align:center"><div style="font-size:24px;font-weight:800;color:#d97706">${apptCount.rows[0].count}</div><div style="font-size:12px;color:#64748b">Appointments</div></div>
            </div>
          `;
        } catch (e) { /* tables may not exist yet */ }
        tenantContent = `
          ${clinicStats}
          <div style="background:white;border-radius:12px;padding:20px;margin-bottom:16px;border:1px solid #e2e8f0">
            <h3 style="font-size:18px;font-weight:700;margin-bottom:8px">Our Services</h3>
            <ul style="list-style:none;padding:0;color:#475569;font-size:14px;line-height:2">
              <li>&#10003; General Consultation</li>
              <li>&#10003; Laboratory Services</li>
              <li>&#10003; Pharmacy</li>
              <li>&#10003; Maternal Care</li>
              <li>&#10003; Vaccination</li>
            </ul>
          </div>
          <div style="display:flex;gap:12px;flex-wrap:wrap">
            <a href="/portal/${tenant.subdomain}" style="padding:10px 24px;background:${color};color:white;border-radius:10px;font-weight:600;text-decoration:none;font-size:14px">Book Appointment</a>
          </div>
        `;
      }

      const content = `
        <div style="padding:20px 0">
          <!-- Tenant Hero -->
          <div style="background:linear-gradient(135deg,${color},${color}cc);padding:60px 20px;border-radius:20px;color:white;text-align:center;margin-bottom:24px">
            <div style="font-size:48px;margin-bottom:12px">${icon}</div>
            <h1 style="font-size:36px;font-weight:900;margin-bottom:8px">${esc(tenant.name)}</h1>
            <span style="background:rgba(255,255,255,0.2);padding:4px 16px;border-radius:20px;font-size:13px;text-transform:capitalize">${esc(tenant.type)}</span>
            ${tenant.description ? `<p style="margin-top:16px;opacity:0.9;max-width:600px;margin-left:auto;margin-right:auto">${esc(tenant.description)}</p>` : ''}
          </div>

          <!-- Contact Info -->
          <div style="background:white;border-radius:14px;padding:20px;margin-bottom:24px;box-shadow:0 2px 12px rgba(0,0,0,0.06);border:1px solid #e2e8f0">
            <h3 style="font-size:18px;font-weight:700;margin-bottom:12px">Contact Information</h3>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;font-size:14px;color:#475569">
              ${tenant.email ? `<div>&#9993; ${esc(tenant.email)}</div>` : ''}
              ${tenant.phone ? `<div>&#9742; ${esc(tenant.phone)}</div>` : ''}
              ${tenant.address ? `<div>&#128205; ${esc(tenant.address)}</div>` : ''}
            </div>
          </div>

          <!-- Dynamic Stats Section -->
          ${statsSection}

          <!-- Type-specific content -->
          ${tenantContent}

          <!-- Join Button -->
          <div style="background:linear-gradient(135deg,${color},${color}cc);border-radius:16px;padding:32px;text-align:center;margin-top:32px;color:white">
            <h2 style="font-size:22px;font-weight:800;margin-bottom:8px">Join ${esc(tenant.name)}</h2>
            <p style="opacity:0.9;margin-bottom:20px">Create an account to become a member.</p>
            <a href="/register" style="display:inline-block;padding:14px 32px;background:white;color:${color};border-radius:12px;font-weight:700;text-decoration:none">Join This Institution</a>
          </div>

          <!-- Shared Footer -->
          <div style="margin-top:40px;padding-top:20px;border-top:1px solid #e2e8f0;text-align:center">
            <p style="color:#94a3b8;font-size:13px">Powered by <a href="/" style="color:#4f46e5;font-weight:600">Comfort</a> &bull; All-in-One Management Platform</p>
          </div>
        </div>
      `;

      res.send(renderPage(`${tenant.name} - Comfort`, content, req.session.user || null));
    } catch (e) {
      console.error('[Tenant Page] Error:', e.message);
      res.send(renderPage('Error', '<div class="card"><div class="alert alert-error">An error occurred loading this page.</div></div>', null));
    }
  }));

  // =========================================================================
  // SECTION 8.5: TENANT DIRECTORY
  // =========================================================================

  app.get('/directory', ah(async (req, res) => {
    const tenants = (await pool.query("SELECT name, type, subdomain, logo_url FROM tenants WHERE verified=true AND approved=true ORDER BY name")).rows;
    const typeEmoji = { school: '&#127979;', church: '&#9938;', business: '&#128188;', clinic: '&#127973;', organization: '&#127968;' };
    const typeColor = { school: '#059669', church: '#7c3aed', business: '#d97706', clinic: '#0891b2', organization: '#4f46e5' };
    res.send(renderPage('Find Institutions', `
      <div style="text-align:center;margin-bottom:30px">
        <h1 style="font-size:32px;font-weight:900;color:#1e293b">&#128269; Find Institutions on Comfort</h1>
        <p style="color:#64748b;font-size:16px;margin-top:8px">Discover schools, churches, clinics and businesses using our platform</p>
      </div>
      ${tenants.length > 0 ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px">${tenants.map(t => `
        <a href="/p/${esc(t.subdomain)}" style="text-decoration:none">
          <div style="background:white;padding:20px;border-radius:14px;box-shadow:0 2px 10px rgba(0,0,0,0.05);border:1px solid #e2e8f0;transition:transform 0.2s;cursor:pointer" onmouseover="this.style.transform='translateY(-4px)'" onmouseout="this.style.transform='translateY(0)'">
            <div style="display:flex;align-items:center;gap:12px">
              <div style="width:48px;height:48px;background:${typeColor[t.type] || '#4f46e5'};border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:24px">${typeEmoji[t.type] || '&#127968;'}</div>
              <div>
                <div style="font-weight:700;font-size:16px;color:#1e293b">${esc(t.name)}</div>
                <div style="font-size:13px;color:#64748b">${esc((t.type || '').charAt(0).toUpperCase() + (t.type || '').slice(1))} &bull; ${esc(t.subdomain)}</div>
              </div>
            </div>
          </div>
        </a>
      `).join('')}</div>` : '<div style="text-align:center;padding:60px;color:#94a3b8"><p style="font-size:48px;margin-bottom:16px">&#127968;</p><p>No public institutions yet. Be the first to <a href="/register" style="color:#4f46e5;font-weight:600">sign up</a>!</p></div>'}
    `, null));
  }));

  // =========================================================================
  // SECTION 9: PUBLIC API ROUTES
  // =========================================================================

  app.get('/api/public/events', ah(async (req, res) => {
    try {
      const dbEvents = await getScrapedContent('events', 30);
      const pubEvents = await getPublicPosts('event', 20);
      res.json({ ok: true, events: [...pubEvents.map(p => ({ ...p, source: 'Comfort' })), ...dbEvents] });
    } catch (e) {
      res.json({ ok: true, events: FALLBACK_DATA.events || [] });
    }
  }));

  app.get('/api/public/news', ah(async (req, res) => {
    try {
      const dbNews = await getScrapedContent('news', 30);
      const pubNews = await getPublicPosts('news', 20);
      res.json({ ok: true, news: [...pubNews.map(p => ({ ...p, source: 'Comfort' })), ...dbNews] });
    } catch (e) {
      res.json({ ok: true, news: FALLBACK_DATA.news || [] });
    }
  }));

  app.get('/api/public/entertainment', ah(async (req, res) => {
    try {
      const dbEnt = await getScrapedContent('entertainment', 30);
      const pubEnt = await getPublicPosts('entertainment', 20);
      res.json({ ok: true, entertainment: [...pubEnt.map(p => ({ ...p, source: 'Comfort' })), ...dbEnt] });
    } catch (e) {
      res.json({ ok: true, entertainment: FALLBACK_DATA.entertainment || [] });
    }
  }));

  // New category API endpoints
  app.get('/api/public/sports', ah(async (req, res) => {
    try {
      const data = await getScrapedContent('sports', 30);
      res.json({ ok: true, sports: data.length > 0 ? data : FALLBACK_DATA.sports || [] });
    } catch (e) {
      res.json({ ok: true, sports: FALLBACK_DATA.sports || [] });
    }
  }));

  app.get('/api/public/technology', ah(async (req, res) => {
    try {
      const data = await getScrapedContent('technology', 30);
      res.json({ ok: true, technology: data.length > 0 ? data : FALLBACK_DATA.technology || [] });
    } catch (e) {
      res.json({ ok: true, technology: FALLBACK_DATA.technology || [] });
    }
  }));

  app.get('/api/public/business-news', ah(async (req, res) => {
    try {
      const data = await getScrapedContent('business', 30);
      res.json({ ok: true, business: data.length > 0 ? data : FALLBACK_DATA.business || [] });
    } catch (e) {
      res.json({ ok: true, business: FALLBACK_DATA.business || [] });
    }
  }));

  app.get('/api/public/education-news', ah(async (req, res) => {
    try {
      const data = await getScrapedContent('education', 30);
      res.json({ ok: true, education: data.length > 0 ? data : FALLBACK_DATA.education || [] });
    } catch (e) {
      res.json({ ok: true, education: FALLBACK_DATA.education || [] });
    }
  }));

  app.get('/api/public/health-news', ah(async (req, res) => {
    try {
      const data = await getScrapedContent('health', 30);
      res.json({ ok: true, health: data.length > 0 ? data : FALLBACK_DATA.health || [] });
    } catch (e) {
      res.json({ ok: true, health: FALLBACK_DATA.health || [] });
    }
  }));

  // Scrape status endpoint (for super admin dashboard)
  app.get('/api/public/scrape-status', ah(async (req, res) => {
    try {
      const stats = getScrapeStats();
      const counts = {};
      const cats = ['news', 'sports', 'entertainment', 'technology', 'business', 'education', 'health'];
      for (const cat of cats) {
        const r = await pool.query('SELECT COUNT(*) as cnt FROM scraped_content WHERE category = $1', [cat]);
        counts[cat] = parseInt(r.rows[0].cnt);
      }
      const totalR = await pool.query('SELECT COUNT(*) as cnt FROM scraped_content');
      res.json({ ok: true, stats, counts, totalItems: parseInt(totalR.rows[0].cnt), lastScrape: lastScrapeTime, sourceCount: Object.values(RSS_FEEDS).flat().length + YOUTUBE_QUERIES.length });
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  }));

  app.get('/api/public/adverts', ah(async (req, res) => {
    try {
      const adverts = await getActiveAdverts();
      res.json({ ok: true, adverts });
    } catch (e) {
      res.json({ ok: true, adverts: [] });
    }
  }));

  app.get('/api/public/campaigns', ah(async (req, res) => {
    try {
      const campaigns = await getActiveCampaigns();
      res.json({ ok: true, campaigns });
    } catch (e) {
      res.json({ ok: true, campaigns: [] });
    }
  }));

  // =========================================================================
  // SECTION 10: SUBSCRIPTION AUTO-VERIFICATION
  // =========================================================================

  const PLAN_PRICES = {
    free: 0,
    basic: 100000,
    pro: 200000,
    enterprise: 500000
  };
  const PLAN_LIMITS_LAUNCH = {
    free: 50,
    basic: 500,
    pro: 50000,
    enterprise: 999999999
  };

  // Flutterwave callback - auto-verify subscription
  app.get('/billing/callback', ah(async (req, res) => {
    const { status, tx_ref, transaction_id } = req.query;
    const user = req.session.user;

    if (!user) return res.redirect('/login');

    try {
      if (status === 'successful' && transaction_id) {
        // Verify with Flutterwave
        const FLW_SK = process.env.FLW_SECRET_KEY;
        let plan = 'basic';
        let amount = 100000;

        if (FLW_SK) {
          try {
            const resp = await fetch(`https://api.flutterwave.com/v3/transactions/${transaction_id}/verify`, {
              headers: { 'Authorization': `Bearer ${FLW_SK}` }
            });
            const data = await resp.json();
            if (data.status === 'success' && data.data) {
              plan = data.data.meta?.plan || 'basic';
              amount = data.data.amount || 100000;
            }
          } catch (e) {
            console.warn('[Billing] Flutterwave verify failed:', e.message);
          }
        }

        // SECURITY: Check for duplicate processing (idempotency)
        const existing = (await pool.query('SELECT id FROM subscriptions WHERE reference=$1', [transaction_id])).rows[0];
        if (existing) {
          return res.send(renderPage('Already Processed', '<div class="card" style="text-align:center;padding:60px"><div style="font-size:48px;margin-bottom:16px">&#9989;</div><h2>Already Processed</h2><p>This payment has already been recorded.</p><a href="/billing" class="btn btn-green">Go to Billing</a></div>', user));
        }

        // SECURITY: Validate plan is legitimate
        const VALID_PLANS = ['free','basic','pro','enterprise'];
        if (!VALID_PLANS.includes(plan)) {
          console.warn('[Billing] Invalid plan received:', plan);
          plan = 'basic';
        }

        // SECURITY: Validate amount matches expected plan price
        const expectedAmount = PLAN_PRICES[plan] || 0;
        if (expectedAmount > 0 && amount < expectedAmount * 0.9) { // Allow 10% tolerance for fees
          console.error('[Billing] Amount mismatch - BLOCKED:', amount, 'for plan', plan, '(expected:', expectedAmount, ')');
          return res.send(renderPage('Payment Error', '<div class="card" style="max-width:500px;margin:40px auto;text-align:center"><div style="font-size:48px;margin-bottom:16px">&#9888;&#65039;</div><h2>Payment Amount Mismatch</h2><p>The payment amount does not match the selected plan. Please contact support if this is an error.</p><a href="/billing" class="btn btn-green">Back to Billing</a></div>', user));
        }

        // Create/Update subscription
        await pool.query(
          'INSERT INTO subscriptions (tenant_id, plan, amount, currency, status, payment_method, reference) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [user.tenant_id, plan, amount, 'UGX', 'active', 'flutterwave', transaction_id]
        );

        // Verify and approve tenant
        await pool.query('UPDATE tenants SET verified=true, approved=true WHERE id=$1', [user.tenant_id]);

        // Record payment
        await pool.query(
          'INSERT INTO payments (tenant_id, amount, method, reference, status, description) VALUES ($1, $2, $3, $4, $5, $6)',
          [user.tenant_id, amount, 'flutterwave', transaction_id, 'completed', `${plan} plan subscription`]
        );

        // Add to platform wallet
        await pool.query('UPDATE platform_wallet SET balance = balance + $1 WHERE id = 1', [amount]);

        // Record developer revenue
        await pool.query(
          'INSERT INTO developer_revenue (amount, source) VALUES ($1, $2)',
          [amount, `subscription_${plan}_${user.tenant_id}`]
        );

        // Send welcome email
        await sendEmail(user.email, 'Welcome to Comfort Pro!', `
          <h2>Your ${plan} plan is now active!</h2>
          <p>Thank you for subscribing. Your institution is now verified and you have access to all ${plan} features.</p>
          <p>Plan: <strong>${plan.toUpperCase()}</strong></p>
          <p>Amount: <strong>UGX ${amount.toLocaleString()}/month</strong></p>
        `);

        // Send welcome SMS
        if (user.phone) {
          await sendSMS(user.phone, `Comfort: Your ${plan} plan is now active! Welcome aboard.`);
        }

        // Notify
        await notify(user.tenant_id, user.email, 'Subscription Activated', `Your ${plan} plan is now active.`, 'success');

        // Audit
        await audit(user.email, 'subscription_activated', `Plan: ${plan}, Amount: UGX ${amount}`);

        return res.send(renderPage('Payment Successful', `
          <div style="text-align:center;padding:60px 20px">
            <div style="font-size:64px;margin-bottom:16px">&#10004;</div>
            <h1 style="font-size:32px;font-weight:800;color:#059669;margin-bottom:12px">Payment Successful!</h1>
            <p style="color:#475569;margin-bottom:24px">Your <strong>${esc(plan)}</strong> plan is now active.</p>
            <a href="/dashboard" style="display:inline-block;padding:14px 32px;background:#059669;color:white;border-radius:12px;font-weight:700;text-decoration:none">Go to Dashboard</a>
          </div>
        `, user));
      }

      // Payment failed or cancelled
      return res.send(renderPage('Payment Not Completed', `
        <div style="text-align:center;padding:60px 20px">
          <div style="font-size:64px;margin-bottom:16px">&#10060;</div>
          <h1 style="font-size:32px;font-weight:800;color:#ef4444;margin-bottom:12px">Payment Not Completed</h1>
          <p style="color:#475569;margin-bottom:24px">Your payment was not completed. Please try again.</p>
          <a href="/billing" style="display:inline-block;padding:14px 32px;background:#d97706;color:white;border-radius:12px;font-weight:700;text-decoration:none">Try Again</a>
        </div>
      `, user));
    } catch (e) {
      console.error('[Billing Callback] Error:', e.message);
      return res.send(renderPage('Payment Error', `
        <div class="card"><div class="alert alert-error"><h2>Payment Verification Error</h2><p>${esc(e.message)}</p></div>
        <a href="/billing" class="btn">Back to Billing</a></div>
      `, user));
    }
  }));

  // Manual plan activation route
  app.post('/billing/activate/:plan', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const plan = req.params.plan;
    // SECURITY: Only super_admin can manually activate plans
    if (user.role !== 'super_admin') {
      return res.status(403).send(renderPage('Access Denied', '<div class="card"><div class="alert alert-error">Only platform administrators can activate plans.</div><a href="/billing" class="btn">Back to Billing</a></div>', user));
    }

    if (!PLAN_PRICES.hasOwnProperty(plan)) {
      return res.send(renderPage('Invalid Plan', '<div class="card"><div class="alert alert-error">Invalid plan selected.</div><a href="/billing" class="btn">Back to Billing</a></div>', user));
    }

    const amount = PLAN_PRICES[plan];
    const limit = PLAN_LIMITS_LAUNCH[plan];

    try {
      // Deactivate existing subscriptions
      await pool.query('UPDATE subscriptions SET status=$1 WHERE tenant_id=$2 AND status=$3', ['inactive', user.tenant_id, 'active']);

      // Create new subscription
      await pool.query(
        'INSERT INTO subscriptions (tenant_id, plan, amount, currency, status, payment_method, reference) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [user.tenant_id, plan, amount, 'UGX', 'active', 'manual', `manual_${Date.now()}`]
      );

      // Verify and approve tenant for paid plans
      if (plan !== 'free') {
        await pool.query('UPDATE tenants SET verified=true, approved=true WHERE id=$1', [user.tenant_id]);
      }

      // Notify
      await notify(user.tenant_id, user.email, 'Plan Activated', `Your ${plan} plan has been activated (limit: ${limit.toLocaleString()} records).`, 'success');
      await audit(user.email, 'plan_activated', `Plan: ${plan}, Limit: ${limit}`);

      return res.send(renderPage('Plan Activated', `
        <div style="text-align:center;padding:60px 20px">
          <div style="font-size:64px;margin-bottom:16px">&#10004;</div>
          <h1 style="font-size:32px;font-weight:800;color:#059669;margin-bottom:12px">${esc(plan.toUpperCase())} Plan Activated!</h1>
          <p style="color:#475569;margin-bottom:8px">Record limit: <strong>${limit.toLocaleString()}</strong></p>
          <p style="color:#475569;margin-bottom:24px">Amount: <strong>UGX ${amount.toLocaleString()}/month</strong></p>
          <a href="/dashboard" style="display:inline-block;padding:14px 32px;background:#059669;color:white;border-radius:12px;font-weight:700;text-decoration:none">Go to Dashboard</a>
        </div>
      `, user));
    } catch (e) {
      return res.send(renderPage('Activation Error', `<div class="card"><div class="alert alert-error">${esc(e.message)}</div></div>`, user));
    }
  }));

  // =========================================================================
  // SECTION 11: ENHANCED DEV DASHBOARD
  // =========================================================================

  app.get('/dev/master', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    const user = req.session.user;

    // Get financial data
    const wallet = (await pool.query('SELECT balance FROM platform_wallet WHERE id=1')).rows[0] || { balance: 0 };
    const totalRevenue = (await pool.query('SELECT COALESCE(SUM(amount),0) as total FROM developer_revenue WHERE amount > 0')).rows[0]?.total || 0;
    const totalWithdrawals = (await pool.query('SELECT COALESCE(SUM(ABS(amount)),0) as total FROM developer_revenue WHERE amount < 0')).rows[0]?.total || 0;
    const availableBalance = wallet.balance || 0;

    // Get subscriptions
    const subs = (await pool.query(`
      SELECT s.*, t.name as tenant_name, t.email as tenant_email
      FROM subscriptions s
      JOIN tenants t ON s.tenant_id = t.id
      ORDER BY s.created_at DESC LIMIT 50
    `)).rows;

    // Get user count
    const userCount = (await pool.query('SELECT COUNT(*) FROM users')).rows[0]?.count || 0;
    const tenantCount = (await pool.query('SELECT COUNT(*) FROM tenants')).rows[0]?.count || 0;

    // Get recent payments
    const payments = (await pool.query('SELECT * FROM payments ORDER BY created_at DESC LIMIT 20')).rows;

    // System health
    const healthChecks = [
      { service: 'Database', status: 'operational' },
      { service: 'API', status: 'operational' },
    ];
    try {
      await pool.query('SELECT 1');
    } catch (e) {
      healthChecks[0].status = 'down';
    }

    const subRows = subs.map(s => `
      <tr>
        <td style="padding:10px;border-bottom:1px solid #e2e8f0">${esc(s.tenant_name || 'Unknown')}</td>
        <td style="padding:10px;border-bottom:1px solid #e2e8f0"><span class="tag">${esc(s.plan)}</span></td>
        <td style="padding:10px;border-bottom:1px solid #e2e8f0">UGX ${Number(s.amount).toLocaleString()}</td>
        <td style="padding:10px;border-bottom:1px solid #e2e8f0"><span style="color:${s.status === 'active' ? '#059669' : '#ef4444'};font-weight:600">${esc(s.status)}</span></td>
        <td style="padding:10px;border-bottom:1px solid #e2e8f0;font-size:13px">${esc(s.payment_method || '')}</td>
      </tr>
    `).join('');

    const paymentRows = payments.map(p => `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #e2e8f0;font-size:13px">Tenant #${p.tenant_id}</td>
        <td style="padding:8px;border-bottom:1px solid #e2e8f0">UGX ${Number(p.amount).toLocaleString()}</td>
        <td style="padding:8px;border-bottom:1px solid #e2e8f0;font-size:12px">${esc(p.method || '')}</td>
        <td style="padding:8px;border-bottom:1px solid #e2e8f0"><span style="color:${p.status === 'completed' ? '#059669' : '#f59e0b'};font-weight:600;font-size:12px">${esc(p.status)}</span></td>
      </tr>
    `).join('');

    const healthHTML = healthChecks.map(h => `
      <div style="display:flex;align-items:center;gap:8px;padding:8px 0">
        <div style="width:10px;height:10px;border-radius:50%;background:${h.status === 'operational' ? '#059669' : '#ef4444'}"></div>
        <span style="font-weight:600;color:#1e293b">${h.service}</span>
        <span style="color:${h.status === 'operational' ? '#059669' : '#ef4444'};font-size:13px">${h.status}</span>
      </div>
    `).join('');

    const content = `
      <div style="padding:20px 0">
        <h1 style="font-size:28px;font-weight:900;margin-bottom:24px">&#128736; Dev Master Dashboard</h1>

        <!-- Financial Overview -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px">
          <div style="background:linear-gradient(135deg,#059669,#10b981);border-radius:16px;padding:24px;color:white">
            <div style="font-size:13px;opacity:0.8;margin-bottom:4px">Available Balance</div>
            <div style="font-size:28px;font-weight:900">UGX ${Number(availableBalance).toLocaleString()}</div>
          </div>
          <div style="background:linear-gradient(135deg,#7c3aed,#a855f7);border-radius:16px;padding:24px;color:white">
            <div style="font-size:13px;opacity:0.8;margin-bottom:4px">Total Revenue</div>
            <div style="font-size:28px;font-weight:900">UGX ${Number(totalRevenue).toLocaleString()}</div>
          </div>
          <div style="background:linear-gradient(135deg,#d97706,#f59e0b);border-radius:16px;padding:24px;color:white">
            <div style="font-size:13px;opacity:0.8;margin-bottom:4px">Total Withdrawals</div>
            <div style="font-size:28px;font-weight:900">UGX ${Number(totalWithdrawals).toLocaleString()}</div>
          </div>
          <div style="background:linear-gradient(135deg,#0891b2,#06b6d4);border-radius:16px;padding:24px;color:white">
            <div style="font-size:13px;opacity:0.8;margin-bottom:4px">Platform Stats</div>
            <div style="font-size:16px;font-weight:700">${userCount} users &bull; ${tenantCount} tenants</div>
          </div>
        </div>

        <!-- Quick Actions -->
        <div class="card">
          <h2 style="font-size:20px;font-weight:700;margin-bottom:16px">Quick Actions</h2>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <a href="/dev/post-public" class="btn btn-sm" style="background:linear-gradient(135deg,#7c3aed,#a855f7)">Post Content</a>
            <a href="/dev/adverts" class="btn btn-sm" style="background:linear-gradient(135deg,#d97706,#f59e0b)">Manage Adverts</a>
            <a href="/dev/earnings" class="btn btn-sm" style="background:linear-gradient(135deg,#059669,#10b981)">Ad Revenue</a>
            <form method="POST" action="/dev/scrape-now" style="display:inline"><button type="submit" class="btn btn-sm" style="background:linear-gradient(135deg,#0891b2,#06b6d4)">Scrape Now</button></form>
            <form method="POST" action="/dev/cleanup-users" style="display:inline">
              <button type="submit" class="btn btn-sm btn-red" onclick="return confirm('Delete ALL users except dev master?')">Cleanup Users</button>
            </form>
            <a href="/dev/withdraw" class="btn btn-sm btn-green">Withdraw Funds</a>
            <a href="/dev/activate-tenant" class="btn btn-sm" style="background:linear-gradient(135deg,#059669,#10b981)">Activate Tenant</a>
          </div>
        </div>

        <!-- Withdraw Money Form -->
        <div class="card">
          <h2 style="font-size:20px;font-weight:700;margin-bottom:16px">Withdraw Money</h2>
          <form method="POST" action="/dev/withdraw">
            <div style="display:grid;grid-template-columns:1fr 1fr auto;gap:12px;align-items:end">
              <div>
                <label style="font-size:13px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Amount (UGX)</label>
                <input name="amount" type="number" min="1" max="${availableBalance}" placeholder="Enter amount" required>
              </div>
              <div>
                <label style="font-size:13px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Description</label>
                <input name="description" placeholder="Withdrawal reason" required>
              </div>
              <button type="submit" class="btn btn-green" style="padding:12px 24px">Withdraw</button>
            </div>
          </form>
        </div>

        <!-- Subscriptions -->
        <div class="card">
          <h2 style="font-size:20px;font-weight:700;margin-bottom:16px">All Subscriptions</h2>
          ${subs.length > 0 ? `
          <div style="overflow-x:auto">
            <table>
              <thead><tr><th>Tenant</th><th>Plan</th><th>Amount</th><th>Status</th><th>Method</th></tr></thead>
              <tbody>${subRows}</tbody>
            </table>
          </div>
          ` : '<p style="color:#64748b">No subscriptions yet.</p>'}
        </div>

        <!-- Recent Payments -->
        <div class="card">
          <h2 style="font-size:20px;font-weight:700;margin-bottom:16px">Recent Payments</h2>
          ${payments.length > 0 ? `
          <div style="overflow-x:auto">
            <table>
              <thead><tr><th>Tenant</th><th>Amount</th><th>Method</th><th>Status</th></tr></thead>
              <tbody>${paymentRows}</tbody>
            </table>
          </div>
          ` : '<p style="color:#64748b">No payments yet.</p>'}
        </div>

        <!-- System Health -->
        <div class="card">
          <h2 style="font-size:20px;font-weight:700;margin-bottom:16px">System Health</h2>
          ${healthHTML}
          <div style="margin-top:12px;font-size:13px;color:#64748b">
            Last scrape: ${lastScrapeTime ? lastScrapeTime.toISOString() : 'Not yet run'} | Scrape ${scrapeInProgress ? 'IN PROGRESS' : 'idle'}
          </div>
        </div>
      </div>
    `;

    res.send(renderPage('Dev Master Dashboard', content, user));
  }));

  // Withdraw funds
  app.post('/dev/withdraw', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    const { amount, description } = req.body;
    const withdrawAmount = parseInt(amount);
    if (!withdrawAmount || withdrawAmount <= 0) return res.redirect('/dev/master');

    try {
      const wallet = (await pool.query('SELECT balance FROM platform_wallet WHERE id=1')).rows[0];
      if (!wallet || wallet.balance < withdrawAmount) {
        return res.send(renderPage('Insufficient Balance', `
          <div class="card"><div class="alert alert-error">Insufficient platform balance. Available: UGX ${Number(wallet?.balance || 0).toLocaleString()}</div>
          <a href="/dev/master" class="btn">Back</a></div>
        `, req.session.user));
      }

      // Deduct from wallet
      await pool.query('UPDATE platform_wallet SET balance = balance - $1 WHERE id = 1', [withdrawAmount]);

      // Log as negative revenue
      await pool.query(
        'INSERT INTO developer_revenue (amount, source) VALUES ($1, $2)',
        [-withdrawAmount, `withdrawal: ${description || 'manual'}`]
      );

      await audit(req.session.user.email, 'withdrawal', `UGX ${withdrawAmount}: ${description}`);
      res.redirect('/dev/master');
    } catch (e) {
      res.send(renderPage('Error', `<div class="card"><div class="alert alert-error">${esc(e.message)}</div></div>`, req.session.user));
    }
  }));

  // Cleanup users
  app.post('/dev/cleanup-users', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).send('Reset endpoint is disabled in production');
    }
    try {
      const delUsers = await pool.query("DELETE FROM users WHERE email != 'waiswadaniel24@gmail.com'");
      const delTenants = await pool.query("DELETE FROM tenants WHERE subdomain != 'dev-master' AND email != 'waiswadaniel24@gmail.com'");
      await audit(req.session.user.email, 'cleanup_users', `Deleted ${delUsers.rowCount} users, ${delTenants.rowCount} tenants`);
      res.redirect('/dev/master');
    } catch (e) {
      res.send(renderPage('Error', `<div class="card"><div class="alert alert-error">${esc(e.message)}</div></div>`, req.session.user));
    }
  }));

  // Scrape trigger
  app.post('/dev/scrape-now', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    runFullScrape();
    res.send(renderPage('Scraping Started', `
      <div class="card" style="text-align:center">
        <div style="font-size:48px;margin-bottom:12px">&#128270;</div>
        <h2>Scraping Started</h2>
        <p style="color:#64748b;margin-bottom:20px">The scraping engine is now running. Check back in a few minutes.</p>
        <a href="/dev/master" class="btn">Back to Dashboard</a>
      </div>
    `, req.session.user));
  }));

  // Withdraw page
  app.get('/dev/withdraw', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    const wallet = (await pool.query('SELECT balance FROM platform_wallet WHERE id=1')).rows[0] || { balance: 0 };
    res.send(renderPage('Withdraw Funds', `
      <div class="card" style="max-width:500px;margin:40px auto">
        <h2 style="margin-bottom:20px">Withdraw Funds</h2>
        <p style="color:#64748b;margin-bottom:20px">Available balance: <strong>UGX ${Number(wallet.balance).toLocaleString()}</strong></p>
        <form method="POST" action="/dev/withdraw">
          <input name="amount" type="number" min="1" max="${wallet.balance}" placeholder="Amount (UGX)" required>
          <input name="description" placeholder="Reason for withdrawal" required>
          <button type="submit" class="btn btn-green" style="width:100%">Withdraw</button>
        </form>
      </div>
    `, req.session.user));
  }));

  // Activate tenant manually
  app.get('/dev/activate-tenant', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    const tenants = (await pool.query('SELECT id, name, email, type, subdomain, verified, approved FROM tenants ORDER BY id')).rows;
    const rows = tenants.map(t => `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #e2e8f0">${esc(t.name)}</td>
        <td style="padding:8px;border-bottom:1px solid #e2e8f0">${esc(t.type)}</td>
        <td style="padding:8px;border-bottom:1px solid #e2e8f0;font-size:12px">${esc(t.email || '')}</td>
        <td style="padding:8px;border-bottom:1px solid #e2e8f0">${t.verified ? '&#10003;' : '&#10007;'}</td>
        <td style="padding:8px;border-bottom:1px solid #e2e8f0">${t.approved ? '&#10003;' : '&#10007;'}</td>
        <td style="padding:8px;border-bottom:1px solid #e2e8f0">
          <form method="POST" action="/dev/activate-tenant/${t.id}" style="display:inline"><button type="submit" class="btn btn-sm btn-green">Activate</button></form>
        </td>
      </tr>
    `).join('');

    res.send(renderPage('Activate Tenants', `
      <div class="card">
        <h2 style="margin-bottom:16px">Activate Tenants</h2>
        <div style="overflow-x:auto">
          <table>
            <thead><tr><th>Name</th><th>Type</th><th>Email</th><th>Verified</th><th>Approved</th><th>Action</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    `, req.session.user));
  }));

  app.post('/dev/activate-tenant/:id', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    const tid = parseInt(req.params.id);
    try {
      await pool.query('UPDATE tenants SET verified=true, approved=true WHERE id=$1', [tid]);
      // Also create a basic subscription if none exists
      const existing = (await pool.query('SELECT * FROM subscriptions WHERE tenant_id=$1 AND status=$2', [tid, 'active'])).rows[0];
      if (!existing) {
        await pool.query(
          'INSERT INTO subscriptions (tenant_id, plan, amount, currency, status, payment_method) VALUES ($1, $2, $3, $4, $5, $6)',
          [tid, 'basic', 100000, 'UGX', 'active', 'manual']
        );
      }
      await audit(req.session.user.email, 'tenant_activated', `Tenant ID: ${tid}`);
      res.redirect('/dev/activate-tenant');
    } catch (e) {
      res.send(renderPage('Error', `<div class="alert alert-error">${esc(e.message)}</div>`, req.session.user));
    }
  }));

  // =========================================================================
  // SECTION 12: ADMIN POST TO PUBLIC
  // =========================================================================

  app.get('/dev/post-public', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    const posts = (await pool.query('SELECT * FROM public_posts ORDER BY created_at DESC LIMIT 30')).rows;
    const rows = posts.map(p => `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #e2e8f0">${esc(p.title)}</td>
        <td style="padding:8px;border-bottom:1px solid #e2e8f0"><span class="tag">${esc(p.category)}</span></td>
        <td style="padding:8px;border-bottom:1px solid #e2e8f0">${p.is_featured ? '&#11088;' : ''}</td>
        <td style="padding:8px;border-bottom:1px solid #e2e8f0;font-size:12px">${new Date(p.created_at).toLocaleDateString()}</td>
        <td style="padding:8px;border-bottom:1px solid #e2e8f0">
          <form method="POST" action="/dev/delete-post/${p.id}" style="display:inline"><button type="submit" class="btn btn-sm btn-red">Delete</button></form>
        </td>
      </tr>
    `).join('');

    res.send(renderPage('Post Public Content', `
      <div class="card">
        <h2 style="margin-bottom:16px">Create Public Post</h2>
        <form method="POST" action="/dev/post-public">
          <input name="title" placeholder="Post Title" required>
          <textarea name="content" rows="4" placeholder="Post Content" style="width:100%;padding:12px;margin:8px 0;border:2px solid #e2e8f0;border-radius:10px;font-size:16px;font-family:inherit"></textarea>
          <select name="category" required>
            <option value="news">News</option>
            <option value="event">Event</option>
            <option value="advert">Advert</option>
            <option value="entertainment">Entertainment</option>
            <option value="announcement">Announcement</option>
            <option value="promotion">Promotion</option>
            <option value="blog">Blog</option>
            <option value="health">Health</option>
            <option value="tips">Tips</option>
            <option value="technology">Technology</option>
            <option value="business">Business</option>
            <option value="education">Education</option>
            <option value="sports">Sports</option>
          </select>
          <input name="image_url" placeholder="Image URL (optional)">
          <label style="display:flex;align-items:center;gap:8px;margin:8px 0;cursor:pointer">
            <input type="checkbox" name="is_featured" style="width:auto"> Featured Post
          </label>
          <button type="submit" class="btn" style="width:100%">Publish Post</button>
        </form>
      </div>
      <div class="card">
        <h2 style="margin-bottom:16px">Recent Posts</h2>
        ${posts.length > 0 ? `
        <div style="overflow-x:auto">
          <table>
            <thead><tr><th>Title</th><th>Category</th><th>Featured</th><th>Date</th><th>Action</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        ` : '<p style="color:#64748b">No posts yet.</p>'}
      </div>
    `, req.session.user));
  }));

  app.post('/dev/post-public', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    const { title, content, category, image_url, is_featured } = req.body;
    try {
      await pool.query(
        'INSERT INTO public_posts (title, content, category, image_url, is_featured, created_by) VALUES ($1, $2, $3, $4, $5, $6)',
        [title, content || '', category || 'news', image_url || '', is_featured ? true : false, req.session.user.email]
      );
      await audit(req.session.user.email, 'public_post_created', `"${title}" (${category})`);
      res.redirect('/dev/post-public');
    } catch (e) {
      res.send(renderPage('Error', `<div class="alert alert-error">${esc(e.message)}</div>`, req.session.user));
    }
  }));

  app.post('/dev/delete-post/:id', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    try {
      await pool.query('DELETE FROM public_posts WHERE id=$1', [parseInt(req.params.id)]);
      res.redirect('/dev/post-public');
    } catch (e) {
      res.redirect('/dev/post-public');
    }
  }));

  // =========================================================================
  // SECTION 13: DAILY ADVERTS SYSTEM
  // =========================================================================

  app.get('/dev/adverts', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    const adverts = (await pool.query('SELECT * FROM daily_adverts ORDER BY created_at DESC')).rows;
    const rows = adverts.map(a => `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #e2e8f0;font-weight:600">${esc(a.title)}</td>
        <td style="padding:8px;border-bottom:1px solid #e2e8f0;font-size:13px">${esc(a.content || '').substring(0, 60)}${(a.content || '').length > 60 ? '...' : ''}</td>
        <td style="padding:8px;border-bottom:1px solid #e2e8f0"><span style="color:${a.is_active ? '#059669' : '#ef4444'};font-weight:600;font-size:13px">${a.is_active ? 'Active' : 'Inactive'}</span></td>
        <td style="padding:8px;border-bottom:1px solid #e2e8f0;font-size:12px">${a.end_date ? new Date(a.end_date).toLocaleDateString() : 'No end'}</td>
        <td style="padding:8px;border-bottom:1px solid #e2e8f0">
          <form method="POST" action="/dev/toggle-advert/${a.id}" style="display:inline"><button type="submit" class="btn btn-sm" style="font-size:11px;padding:4px 10px">${a.is_active ? 'Deactivate' : 'Activate'}</button></form>
          <form method="POST" action="/dev/delete-advert/${a.id}" style="display:inline"><button type="submit" class="btn btn-sm btn-red" style="font-size:11px;padding:4px 10px">Delete</button></form>
        </td>
      </tr>
    `).join('');

    res.send(renderPage('Manage Adverts', `
      <div class="card">
        <h2 style="margin-bottom:16px">Create Advert</h2>
        <form method="POST" action="/dev/adverts">
          <input name="title" placeholder="Advert Title" required>
          <textarea name="content" rows="3" placeholder="Advert Content" style="width:100%;padding:12px;margin:8px 0;border:2px solid #e2e8f0;border-radius:10px;font-size:16px;font-family:inherit"></textarea>
          <input name="link_url" placeholder="Link URL (optional)">
          <input name="image_url" placeholder="Image URL (optional)">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div>
              <label style="font-size:13px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Start Date</label>
              <input name="start_date" type="date" value="${new Date().toISOString().split('T')[0]}">
            </div>
            <div>
              <label style="font-size:13px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">End Date</label>
              <input name="end_date" type="date">
            </div>
          </div>
          <button type="submit" class="btn btn-gold" style="width:100%;margin-top:12px">Create Advert</button>
        </form>
      </div>
      <div class="card">
        <h2 style="margin-bottom:16px">All Adverts</h2>
        ${adverts.length > 0 ? `
        <div style="overflow-x:auto">
          <table>
            <thead><tr><th>Title</th><th>Content</th><th>Status</th><th>Ends</th><th>Actions</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        ` : '<p style="color:#64748b">No adverts yet.</p>'}
      </div>
    `, req.session.user));
  }));

  app.post('/dev/adverts', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    const { title, content, link_url, image_url, start_date, end_date } = req.body;
    try {
      await pool.query(
        'INSERT INTO daily_adverts (title, content, link_url, image_url, start_date, end_date) VALUES ($1, $2, $3, $4, $5, $6)',
        [title, content || '', link_url || '', image_url || '', start_date || null, end_date || null]
      );
      await audit(req.session.user.email, 'advert_created', `"${title}"`);
      res.redirect('/dev/adverts');
    } catch (e) {
      res.send(renderPage('Error', `<div class="alert alert-error">${esc(e.message)}</div>`, req.session.user));
    }
  }));

  app.post('/dev/toggle-advert/:id', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    try {
      await pool.query('UPDATE daily_adverts SET is_active = NOT is_active WHERE id=$1', [parseInt(req.params.id)]);
      res.redirect('/dev/adverts');
    } catch (e) {
      res.redirect('/dev/adverts');
    }
  }));

  app.post('/dev/delete-advert/:id', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    try {
      await pool.query('DELETE FROM daily_adverts WHERE id=$1', [parseInt(req.params.id)]);
      res.redirect('/dev/adverts');
    } catch (e) {
      res.redirect('/dev/adverts');
    }
  }));

  // Auto-expire old adverts (runs every hour)
  setInterval(async () => {
    try {
      await pool.query("UPDATE daily_adverts SET is_active = false WHERE end_date IS NOT NULL AND end_date < CURRENT_DATE AND is_active = true");
    } catch (e) { /* silent */ }
  }, 60 * 60 * 1000);

  // =========================================================================
  // SECTION 14: MONETIZATION — Ad Revenue, Affiliate Links, YouTube Embeds
  // =========================================================================

  // --- Ad click tracking API ---
  app.post('/api/public/ad-click', ah(async (req, res) => {
    const { ad_type, placement, link_url, page_url } = req.body;
    if (!link_url) return res.json({ ok: false });
    // SECURITY: Validate ad_type against whitelist, block high-value types from untrusted sources
    const cpcRates = { banner: 0.02, sidebar: 0.015, incontent: 0.03, affiliate: 0.15, video: 0.05, popup: 0.01 };
    const validTypes = Object.keys(cpcRates);
    if (!validTypes.includes(ad_type)) return res.json({ ok: false });
    // Only allow standard ad types from public API; affiliate/video require authentication
    if (['affiliate', 'video'].includes(ad_type)) return res.json({ ok: false });
    const revenue = cpcRates[ad_type] || 0.02;
    await pool.query(
      'INSERT INTO ad_clicks (ad_type, placement, link_url, revenue_usd, page_url, referrer, user_agent, ip_address) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [ad_type || 'banner', placement || 'sidebar', link_url, revenue, page_url || '', req.headers.referer || '', req.headers['user-agent'] || '', req.ip || '']
    );
    res.json({ ok: true });
  }));

  // --- Ad revenue stats API (admin-only) ---
  app.get('/api/public/ad-stats', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    const today = (await pool.query("SELECT COUNT(*) as clicks, COALESCE(SUM(revenue_usd),0) as revenue FROM ad_clicks WHERE clicked_at >= CURRENT_DATE")).rows[0];
    const week = (await pool.query("SELECT COUNT(*) as clicks, COALESCE(SUM(revenue_usd),0) as revenue FROM ad_clicks WHERE clicked_at >= CURRENT_DATE - INTERVAL '7 days'")).rows[0];
    const month = (await pool.query("SELECT COUNT(*) as clicks, COALESCE(SUM(revenue_usd),0) as revenue FROM ad_clicks WHERE clicked_at >= CURRENT_DATE - INTERVAL '30 days'")).rows[0];
    const allTime = (await pool.query("SELECT COUNT(*) as clicks, COALESCE(SUM(revenue_usd),0) as revenue FROM ad_clicks")).rows[0];
    // Top pages
    const topPages = (await pool.query("SELECT page_url, COUNT(*) as clicks, SUM(revenue_usd) as revenue FROM ad_clicks GROUP BY page_url ORDER BY clicks DESC LIMIT 10")).rows;
    res.json({ ok: true, today, week, month, allTime, topPages });
  }));

  // --- Google AdSense integration helper ---
  const ADSENSE_CLIENT_ID = process.env.ADSENSE_CLIENT_ID || 'ca-pub-XXXXX'; // Replace with real AdSense ID

  // Ad HTML generator with tracking
  function adBanner(placement, size) {
    const id = 'ad-' + placement + '-' + Math.random().toString(36).substring(2, 8);
    if (size === 'leaderboard') {
      return '<div id="' + id + '" style="background:#f8fafc;border:1px dashed #e2e8f0;border-radius:10px;padding:16px;text-align:center;margin:16px 0;min-height:90px;display:flex;align-items:center;justify-content:center"><a href="https://jumia.ug" target="_blank" rel="noopener sponsored" onclick="trackAd(this,\'banner\',\'' + placement + '\')" style="color:#475569;font-size:13px;text-decoration:none"><b>Shop on Jumia Uganda</b> — Electronics, Fashion & More at Best Prices</a></div>';
    }
    if (size === 'rectangle') {
      return '<div id="' + id + '" style="background:#f8fafc;border:1px dashed #e2e8f0;border-radius:10px;padding:16px;text-align:center;margin:16px 0;min-height:250px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px"><a href="https://www.jumia.ug/phones/" target="_blank" rel="noopener sponsored" onclick="trackAd(this,\'affiliate\',\'' + placement + '\')" style="background:linear-gradient(135deg,#f59e0b,#d97706);color:white;padding:12px 20px;border-radius:10px;font-weight:700;text-decoration:none;font-size:14px">Get Deals on Phones</a><a href="https://www.jumia.ug/fashion/" target="_blank" rel="noopener sponsored" onclick="trackAd(this,\'affiliate\',\'' + placement + '\')" style="background:linear-gradient(135deg,#7c3aed,#a855f7);color:white;padding:12px 20px;border-radius:10px;font-weight:700;text-decoration:none;font-size:14px">Shop Fashion</a></div>';
    }
    return '<div id="' + id + '" style="background:#f8fafc;border:1px dashed #e2e8f0;border-radius:10px;padding:12px;text-align:center;margin:12px 0;min-height:60px;display:flex;align-items:center;justify-content:center"><a href="https://jumia.ug" target="_blank" rel="noopener sponsored" onclick="trackAd(this,\'banner\',\'' + placement + '\')" style="color:#64748b;font-size:12px;text-decoration:none">Ad — <b>Shop Jumia Uganda</b></a></div>';
  }

  // Inline video player with ads
  function videoEmbed(videoUrl, title, placement) {
    // Extract YouTube video ID if possible
    const ytMatch = videoUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
    const embedUrl = ytMatch ? 'https://www.youtube.com/embed/' + ytMatch[1] + '?rel=0&modestbranding=1' : videoUrl;
    return '<div style="position:relative;width:100%;padding-bottom:56.25%;margin:16px 0;border-radius:14px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.1)"><iframe src="' + embedUrl + '" style="position:absolute;top:0;left:0;width:100%;height:100%;border:none" allow="accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture" allowfullscreen loading="lazy" title="' + esc(title || 'Video') + '"></iframe></div>';
  }

  // Affiliate product cards for Jumia
  function affiliateProductCards(placement) {
    const products = [
      { name: 'Samsung Galaxy A15', price: 'UGX 350,000', url: 'https://www.jumia.ug/samsung-galaxy/', img: 'https://via.placeholder.com/200x200/4f46e5/white?text=Samsung', tag: 'Best Seller' },
      { name: 'Itel P40 Phone', price: 'UGX 180,000', url: 'https://www.jumia.ug/itel-phones/', img: 'https://via.placeholder.com/200x200/059669/white?text=Itel', tag: 'Budget Pick' },
      { name: 'Wireless Earbuds', price: 'UGX 45,000', url: 'https://www.jumia.ug/earbuds/', img: 'https://via.placeholder.com/200x200/dc2626/white?text=Earbuds', tag: 'Popular' },
      { name: 'Solar Power Bank', price: 'UGX 65,000', url: 'https://www.jumia.ug/power-banks/', img: 'https://via.placeholder.com/200x200/d97706/white?text=Power+Bank', tag: 'Essential' },
    ];
    return '<div style="margin:24px 0"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px"><h3 style="font-size:18px;font-weight:700;color:#1e293b">Hot Deals on Jumia</h3><span style="font-size:11px;color:#94a3b8;background:#f1f5f9;padding:4px 10px;border-radius:6px">Sponsored</span></div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px">' + products.map(function(p) {
      return '<a href="' + p.url + '" target="_blank" rel="noopener sponsored" onclick="trackAd(this,\'affiliate\',\'' + placement + '\')" style="background:white;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;text-decoration:none;transition:transform 0.2s;box-shadow:0 2px 8px rgba(0,0,0,0.04)" onmouseover="this.style.transform=\'translateY(-3px)\'" onmouseout="this.style.transform=\'translateY(0)\'"><div style="position:relative"><img src="' + p.img + '" alt="' + esc(p.name) + '" style="width:100%;height:140px;object-fit:cover" loading="lazy"><span style="position:absolute;top:8px;left:8px;background:#059669;color:white;font-size:10px;font-weight:700;padding:3px 8px;border-radius:6px">' + p.tag + '</span></div><div style="padding:12px"><div style="font-size:14px;font-weight:600;color:#1e293b">' + esc(p.name) + '</div><div style="font-size:16px;font-weight:800;color:#059669;margin-top:4px">' + p.price + '</div></div></a>';
    }).join('') + '</div></div>';
  }

  // Monetization script (injected into all public pages)
  const monetizationScript = '<script>function trackAd(el,type,placement){var url=el.href||el.closest("a")?.href||"";if(!url)return;navigator.sendBeacon("/api/public/ad-click",JSON.stringify({ad_type:type,placement:placement,link_url:url,page_url:location.pathname}))}</script>';

  // --- EARNINGS DASHBOARD ---
  app.get('/dev/earnings', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    const today = (await pool.query("SELECT COUNT(*) as clicks, COALESCE(SUM(revenue_usd),0) as revenue FROM ad_clicks WHERE clicked_at >= CURRENT_DATE")).rows[0];
    const week = (await pool.query("SELECT COUNT(*) as clicks, COALESCE(SUM(revenue_usd),0) as revenue FROM ad_clicks WHERE clicked_at >= CURRENT_DATE - INTERVAL '7 days'")).rows[0];
    const month = (await pool.query("SELECT COUNT(*) as clicks, COALESCE(SUM(revenue_usd),0) as revenue FROM ad_clicks WHERE clicked_at >= CURRENT_DATE - INTERVAL '30 days'")).rows[0];
    const allTime = (await pool.query("SELECT COUNT(*) as clicks, COALESCE(SUM(revenue_usd),0) as revenue FROM ad_clicks")).rows[0];
    const topPages = (await pool.query("SELECT page_url, COUNT(*) as clicks, SUM(revenue_usd) as revenue FROM ad_clicks GROUP BY page_url ORDER BY clicks DESC LIMIT 15")).rows;
    const recentClicks = (await pool.query("SELECT ad_type, placement, link_url, revenue_usd, page_url, clicked_at FROM ad_clicks ORDER BY clicked_at DESC LIMIT 30")).rows;
    const dailyRevenue = (await pool.query("SELECT DATE(clicked_at) as date, COUNT(*) as clicks, SUM(revenue_usd) as revenue FROM ad_clicks WHERE clicked_at >= CURRENT_DATE - INTERVAL '14 days' GROUP BY DATE(clicked_at) ORDER BY date")).rows;

    const fmt = (n) => parseFloat(n || 0).toFixed(2);

    res.send(renderPage('Ad Revenue Dashboard', '<div class="card"><h2>Monetization — Ad Revenue</h2>' +
      '<p class="muted">Track earnings from ads, affiliate links, and video views across your public pages.</p></div>' +

      // Revenue cards
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin:20px 0">' +
        '<div class="card" style="border-left:4px solid #059669"><div style="font-size:28px;font-weight:900;color:#059669">$' + fmt(today.revenue) + '</div><div style="color:#64748b;font-size:13px">Today</div><div style="color:#94a3b8;font-size:12px">' + today.clicks + ' clicks</div></div>' +
        '<div class="card" style="border-left:4px solid #4f46e5"><div style="font-size:28px;font-weight:900;color:#4f46e5">$' + fmt(week.revenue) + '</div><div style="color:#64748b;font-size:13px">This Week</div><div style="color:#94a3b8;font-size:12px">' + week.clicks + ' clicks</div></div>' +
        '<div class="card" style="border-left:4px solid #d97706"><div style="font-size:28px;font-weight:900;color:#d97706">$' + fmt(month.revenue) + '</div><div style="color:#64748b;font-size:13px">This Month</div><div style="color:#94a3b8;font-size:12px">' + month.clicks + ' clicks</div></div>' +
        '<div class="card" style="border-left:4px solid #dc2626"><div style="font-size:28px;font-weight:900;color:#dc2626">$' + fmt(allTime.revenue) + '</div><div style="color:#64748b;font-size:13px">All Time</div><div style="color:#94a3b8;font-size:12px">' + allTime.clicks + ' clicks</div></div>' +
      '</div>' +

      // 14-day chart
      '<div class="card" style="margin:20px 0"><h3>Revenue — Last 14 Days</h3><div style="display:flex;align-items:flex-end;gap:6px;height:180px;margin-top:16px;padding:0 8px">' +
        dailyRevenue.map(function(d) {
          var maxRev = Math.max.apply(null, dailyRevenue.map(function(x){return parseFloat(x.revenue)}));
          var h = maxRev > 0 ? Math.max(4, (parseFloat(d.revenue) / maxRev) * 150) : 4;
          return '<div style="flex:1;text-align:center"><div style="background:linear-gradient(180deg,#059669,#0d9488);height:' + h + 'px;border-radius:6px 6px 0 0;transition:height 0.3s" title="$' + fmt(d.revenue) + '"></div><div style="font-size:10px;color:#94a3b8;margin-top:4px">' + d.date.substring(5) + '</div></div>';
        }).join('') +
      '</div></div>' +

      // Top pages
      '<div class="card" style="margin:20px 0"><h3>Top Earning Pages</h3><table style="margin-top:12px"><tr><th>Page</th><th>Clicks</th><th>Revenue</th></tr>' +
        topPages.map(function(p) { return '<tr><td><code>' + esc(p.page_url || '/') + '</code></td><td>' + p.clicks + '</td><td style="color:#059669;font-weight:700">$' + fmt(p.revenue) + '</td></tr>'; }).join('') +
      '</table></div>' +

      // Recent clicks
      '<div class="card" style="margin:20px 0"><h3>Recent Ad Clicks</h3><table style="margin-top:12px"><tr><th>Type</th><th>Placement</th><th>Revenue</th><th>Page</th><th>Time</th></tr>' +
        recentClicks.map(function(c) { return '<tr><td><span class="tag">' + esc(c.ad_type) + '</span></td><td>' + esc(c.placement) + '</td><td style="color:#059669;font-weight:600">$' + fmt(c.revenue_usd) + '</td><td><code>' + esc(c.page_url || '/') + '</code></td><td class="muted">' + new Date(c.clicked_at).toLocaleDateString() + '</td></tr>'; }).join('') +
      '</table></div>' +

      // Setup instructions
      '<div class="card" style="margin:20px 0;border:2px solid #4f46e5"><h3 style="color:#4f46e5">How to Maximize Earnings</h3>' +
        '<ul style="font-size:14px;color:#475569;line-height:2.2;margin-top:8px">' +
          '<li><b>1. Get Google AdSense:</b> Sign up at <a href="https://www.google.com/adsense" target="_blank">google.com/adsense</a> — paste your client ID in the ADSENSE_CLIENT_ID env variable</li>' +
          '<li><b>2. Jumia Affiliate:</b> Join <a href="https://affiliate.jumia.com" target="_blank">Jumia Affiliate Program</a> — replace product links with your affiliate URLs</li>' +
          '<li><b>3. YouTube Revenue:</b> Embedded YouTube videos show ads — you earn from views when your YouTube channel is monetized</li>' +
          '<li><b>4. More Traffic = More Money:</b> Share your <a href="/news">News Hub</a> and <a href="/p/entertainment">Entertainment Hub</a> links on WhatsApp, Facebook, Twitter</li>' +
          '<li><b>5. Content is King:</b> Post regularly via <a href="/dev/post-public">Post Public Content</a> to keep visitors coming back</li>' +
        '</ul></div>' +

      '<div style="text-align:center;margin:20px 0"><a href="/dev/master" class="btn btn-outline">Back to Dev Dashboard</a></div>'
    , req.session.user));
  }));

  // =========================================================================
  // SECTION 15: PWA ENHANCEMENTS
  // =========================================================================

  // Serve manifest.json with enhanced configuration
  app.get('/manifest.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify({
      name: 'Comfort Platform',
      short_name: 'Comfort',
      description: 'All-in-One Management: School, Clinic, Church, Business - Built for Africa',
      start_url: '/',
      display: 'standalone',
      background_color: '#059669',
      theme_color: '#059669',
      orientation: 'portrait-primary',
      icons: [
        { src: '/icon.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icon.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
      ],
      categories: ['education', 'finance', 'business', 'productivity'],
      shortcuts: [
        { name: 'Dashboard', url: '/dashboard', description: 'Go to Dashboard' },
        { name: 'Entertainment', url: '/p/entertainment', description: 'Entertainment Hub' },
        { name: 'Fundraising', url: '/p/fundraising', description: 'Fundraising Campaigns' }
      ],
      screenshots: [],
      prefer_related_applications: false
    }));
  });

  // Enhanced service worker
  app.get('/sw.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.setHeader('Service-Worker-Allowed', '/');
    res.send(`
const CACHE = 'comfort-v1.0';
const urlsToCache = ['/', '/offline', '/manifest.json', '/p/entertainment', '/p/fundraising'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(urlsToCache)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(r => {
      if (r) return r;
      return fetch(e.request).then(response => {
        if (response.ok && e.request.url.startsWith(self.location.origin)) {
          const clone = response.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return response;
      }).catch(() => caches.match('/offline'));
    })
  );
});

self.addEventListener('sync', e => {
  if (e.tag === 'sync-data') {
    e.waitUntil(syncOfflineData());
  }
});

self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : {};
  self.registration.showNotification(data.title || 'Comfort', {
    body: data.body || 'You have a new notification',
    icon: '/icon.png',
    badge: '/icon.png',
    vibrate: [200, 100, 200]
  });
});

async function syncOfflineData() {
  try {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('ssewasswa', 1);
      request.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('pending')) {
          db.createObjectStore('pending', { keyPath: 'id', autoIncrement: true });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const tx = db.transaction('pending', 'readwrite');
    const store = tx.objectStore('pending');
    const items = await new Promise((resolve) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
    });
    for (const item of items) {
      try {
        const res = await fetch(item.url, {
          method: item.method || 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item.data)
        });
        if (res.ok) store.delete(item.id);
      } catch (e) {}
    }
  } catch (e) {}
}
    `);
  });

  // =========================================================================
  // SECTION 15: EXTERNAL SITE LINKS
  // =========================================================================

  app.get('/links', ah(async (req, res) => {
    let links = [];
    try {
      links = (await pool.query('SELECT * FROM external_links ORDER BY sort_order, category')).rows;
    } catch (e) { /* fallback */ }

    if (links.length === 0) {
      links = [
        { title: 'New Vision', url: 'https://www.newvision.co.ug', category: 'news', description: "Uganda's leading newspaper" },
        { title: 'Daily Monitor', url: 'https://www.monitor.co.ug', category: 'news', description: "Uganda's independent newspaper" },
        { title: 'Uganda Government Portal', url: 'https://www.gov.ug', category: 'government', description: 'Official government services' },
        { title: 'UNEB', url: 'https://www.uneb.ac.ug', category: 'education', description: 'Uganda National Examinations Board' },
        { title: 'YouTube Uganda', url: 'https://www.youtube.com', category: 'entertainment', description: 'Video entertainment' },
        { title: 'Eventbrite Uganda', url: 'https://www.eventbrite.com/d/uganda--kampala/events/', category: 'events', description: 'Events in Kampala' },
        { title: 'Church of Uganda', url: 'https://www.churchofuganda.org', category: 'religion', description: 'Anglican Church of Uganda' },
        { title: 'Uganda Revenue Authority', url: 'https://www.ura.go.ug', category: 'government', description: 'Tax and revenue services' },
        { title: 'Makerere University', url: 'https://www.mak.ac.ug', category: 'education', description: "Uganda's premier university" },
        { title: 'Ministry of Education', url: 'https://www.education.go.ug', category: 'government', description: 'Education ministry services' },
        { title: 'NBS TV', url: 'https://www.nbstv.co.ug', category: 'news', description: 'NBS Television Uganda' },
        { title: 'NTV Uganda', url: 'https://www.ntv.co.ug', category: 'news', description: 'NTV Uganda news' },
      ];
    }

    const categories = {};
    links.forEach(l => {
      if (!categories[l.category]) categories[l.category] = [];
      categories[l.category].push(l);
    });

    const catIcons = { news: '&#128240;', government: '&#127963;', education: '&#127891;', entertainment: '&#127925;', events: '&#127881;', religion: '&#9938;', health: '&#127973;', general: '&#127760;' };
    const catColors = { news: '#1a56db', government: '#7c3aed', education: '#059669', entertainment: '#dc2626', events: '#ea580c', religion: '#0d9488', health: '#0891b2', general: '#64748b' };

    const sections = Object.entries(categories).map(([cat, items]) => `
      <div style="margin-bottom:32px">
        <h2 style="font-size:20px;font-weight:700;margin-bottom:16px;color:${catColors[cat] || '#1e293b'}">
          ${catIcons[cat] || '&#128279;'} ${cat.charAt(0).toUpperCase() + cat.slice(1)}
        </h2>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px">
          ${items.map(l => `
            <a href="${esc(l.url)}" target="_blank" rel="noopener" style="display:block;background:white;border-radius:12px;padding:16px 20px;text-decoration:none;border:1px solid #e2e8f0;box-shadow:0 2px 8px rgba(0,0,0,0.04);transition:transform 0.2s">
              <div style="font-weight:700;color:#1e293b;font-size:15px">${esc(l.title)}</div>
              ${l.description ? `<div style="font-size:13px;color:#64748b;margin-top:4px">${esc(l.description)}</div>` : ''}
              <div style="font-size:11px;color:${catColors[cat] || '#64748b'};margin-top:6px">${esc(l.url.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</div>
            </a>
          `).join('')}
        </div>
      </div>
    `).join('');

    const content = `
      <div style="padding:20px 0">
        <div style="text-align:center;margin-bottom:36px">
          <h1 style="font-size:32px;font-weight:900;color:#1e293b">&#127279; Useful Links</h1>
          <p style="color:#64748b;font-size:18px;margin-top:8px">Quick access to important Uganda &amp; Africa resources</p>
        </div>
        ${sections}
      </div>
    `;

    res.send(renderPage('Useful Links - Comfort', content, req.session.user || null, '/links'));
  }));

  // =========================================================================
  // SECTION 16: OFFLINE PAGE
  // =========================================================================

  app.get('/offline', (req, res) => {
    res.send(renderPage('Offline', `
      <div style="text-align:center;padding:80px 20px">
        <div style="font-size:64px;margin-bottom:16px">&#128225;</div>
        <h1 style="font-size:32px;font-weight:800;color:#1e293b;margin-bottom:12px">You're Offline</h1>
        <p style="color:#64748b;margin-bottom:8px">Don't worry! Comfort works offline.</p>
        <p style="color:#94a3b8;font-size:14px;margin-bottom:24px">Any data you enter will sync when your connection returns.</p>
        <a href="/" style="display:inline-block;padding:14px 32px;background:#059669;color:white;border-radius:12px;font-weight:700;text-decoration:none">Try Again</a>
      </div>
    `, null));
  });

  // =========================================================================
  // SECTION 17: SEO — robots.txt, sitemap.xml
  // =========================================================================
  // NOTE: BASE_URL and getStructuredData() are defined in Section 1.5 above

  // robots.txt — tells search engines what to crawl
  // NOTE: Static robots.txt in public/robots.txt is served first by express.static.
  // This dynamic route is a fallback in case the static file is missing.
  app.get('/robots.txt', (req, res) => {
    res.setHeader('Content-Type', 'text/plain');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(`User-agent: *
Allow: /

Sitemap: ${BASE_URL}/sitemap.xml
`);
  });

  // sitemap.xml — lists all public pages for Google to discover
  // Uses plain try-catch (NOT ah()) so errors still return valid XML instead of 500 HTML
  app.get('/sitemap.xml', async (req, res) => {
    try {
      // Gather all tenants with active public pages (query tenants directly for reliable URLs)
      let tenantPages = [];
      try {
        tenantPages = (await pool.query(`
          SELECT t.subdomain, t.name, t.type, t.created_at
          FROM tenants t
          WHERE EXISTS (
            SELECT 1 FROM public_pages p WHERE p.tenant_id = t.id AND p.is_published = true
          )
          ORDER BY t.created_at DESC
        `)).rows;
      } catch (e) { /* no pages yet */ }

      // Gather all public posts
      let publicPosts = [];
      try {
        publicPosts = (await pool.query(`
          SELECT slug, title, published_at, category FROM blog_posts WHERE is_published = true ORDER BY published_at DESC LIMIT 100
        `)).rows;
      } catch (e) { /* no posts yet */ }

      const now = new Date().toISOString().split('T')[0];

      const staticPages = [
        { url: '/', priority: '1.0', changefreq: 'daily' },
        { url: '/register', priority: '0.9', changefreq: 'monthly' },
        { url: '/login', priority: '0.8', changefreq: 'monthly' },
        { url: '/blog/posts', priority: '0.9', changefreq: 'daily' },
        { url: '/p/entertainment', priority: '0.7', changefreq: 'daily' },
        { url: '/p/fundraising', priority: '0.7', changefreq: 'weekly' },
        { url: '/links', priority: '0.6', changefreq: 'monthly' },
        { url: '/directory', priority: '0.8', changefreq: 'weekly' },
        { url: '/privacy', priority: '0.3', changefreq: 'yearly' },
        { url: '/terms', priority: '0.3', changefreq: 'yearly' },
      ];

      let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">`;

      // Static pages
      for (const page of staticPages) {
        xml += `
  <url>
    <loc>${BASE_URL}${page.url}</loc>
    <lastmod>${now}</lastmod>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
  </url>`;
      }

      // Tenant public pages (use subdomain for /p/:subdomain route)
      for (const tp of tenantPages) {
        xml += `
  <url>
    <loc>${BASE_URL}/p/${tp.subdomain}</loc>
    <lastmod>${tp.created_at ? new Date(tp.created_at).toISOString().split('T')[0] : now}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>`;
      }

      // Public blog posts
      for (const post of publicPosts) {
        xml += `
  <url>
    <loc>${BASE_URL}/blog/posts/${post.slug}</loc>
    <lastmod>${post.published_at ? new Date(post.published_at).toISOString().split('T')[0] : now}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>`;
      }

      xml += `
</urlset>`;

      res.type('xml');
      res.set('Cache-Control', 'public, max-age=3600');
      res.set('Content-Length', Buffer.byteLength(xml));
      res.send(xml);
    } catch (err) {
      // Always return valid XML — never fall through to the 500 HTML error handler
      const fallbackXml = '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>';
      res.type('xml');
      res.set('Content-Length', Buffer.byteLength(fallbackXml));
      res.status(200).send(fallbackXml);
    }
  });

  // Google site verification route (placeholder — update with your actual verification code)
  app.get('/google:siteVerification.html', (req, res) => {
    const code = process.env.GOOGLE_SITE_VERIFICATION || 'NOT_SET';
    res.send(`google-site-verification: google${code}.html`);
  });

  // Also handle the specific Google verification file for this account
  app.get('/googleRvLisS63AfmVd_rvNfWXznr3ZjRa6kF7p9EiBoKY28s.html', (req, res) => {
    res.send('google-site-verification: googleRvLisS63AfmVd_rvNfWXznr3ZjRa6kF7p9EiBoKY28s.html');
  });

  // =========================================================================
  // LOG: Launch routes loaded
  // =========================================================================

  console.log('[Launch] All launch routes registered successfully');
  app._launchRoutesLoaded = true;
};
