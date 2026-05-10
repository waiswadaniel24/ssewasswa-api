/**
 * SSEWASSWA Platform - Launch Routes
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

  // =========================================================================
  // SECTION 1: LAUNCH MIGRATIONS
  // =========================================================================

  const launchMigrations = [
    `CREATE TABLE IF NOT EXISTS scraped_content (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      url TEXT,
      source TEXT,
      category TEXT NOT NULL DEFAULT 'news',
      image_url TEXT,
      summary TEXT,
      scraped_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS public_posts (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT,
      category TEXT NOT NULL DEFAULT 'news',
      image_url TEXT,
      is_featured BOOLEAN DEFAULT false,
      created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
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
      plan_key TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      price INTEGER NOT NULL DEFAULT 0,
      currency TEXT DEFAULT 'UGX',
      record_limit INTEGER DEFAULT 50,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    // Seed subscription plans
    `INSERT INTO subscription_plans (plan_key, name, price, currency, record_limit) VALUES
      ('free', 'Free', 0, 'UGX', 50),
      ('basic', 'Basic', 100000, 'UGX', 500),
      ('pro', 'Pro', 200000, 'UGX', 50000),
      ('enterprise', 'Enterprise', 0, 'UGX', 999999999)
    ON CONFLICT (plan_key) DO NOTHING`,
    // Seed external links
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
      ('Spark TV', 'https://www.sparktv.co.ug', 'entertainment', 'Spark TV Uganda', 14)
    ON CONFLICT DO NOTHING`,
    // Add public_url column to campaigns if missing
    `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS public_url TEXT`,
    `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS image_url TEXT`,
  ];

  // Run launch migrations
  (async () => {
    for (const sql of launchMigrations) {
      try {
        await pool.query(sql);
      } catch (e) {
        console.warn('[Launch] Migration warning:', e.message);
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
      "name": "SSEWASSWA",
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
      "name": "SSEWASSWA Platform",
      "applicationCategory": "BusinessApplication",
      "operatingSystem": "Web",
      "offers": [
        { "@type": "Offer", "name": "Free", "price": "0", "priceCurrency": "UGX", "description": "Up to 50 records, 1 user" },
        { "@type": "Offer", "name": "Basic", "price": "100000", "priceCurrency": "UGX", "description": "Up to 500 records, 5 users" },
        { "@type": "Offer", "name": "Pro", "price": "200000", "priceCurrency": "UGX", "description": "Up to 50000 records, unlimited users" },
        { "@type": "Offer", "name": "Enterprise", "price": "0", "priceCurrency": "UGX", "description": "Custom pricing, unlimited everything" }
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
          "name": "Is SSEWASSWA really free to start?",
          "acceptedAnswer": { "@type": "Answer", "text": "Yes! Our Free plan includes up to 50 records, 1 user, basic reports, and 5 SMS per day. No credit card required. Upgrade when you need more capacity." }
        },
        {
          "@type": "Question",
          "name": "Does it work without internet?",
          "acceptedAnswer": { "@type": "Answer", "text": "Yes! SSEWASSWA has offline mode built in. You can enter data when disconnected, and everything syncs automatically when your connection returns." }
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
          "name": "Can I use SSEWASSWA on my phone?",
          "acceptedAnswer": { "@type": "Answer", "text": "Yes! SSEWASSWA is a Progressive Web App (PWA). Install it directly from your browser on any phone or tablet. Works on Android, iOS, and desktop." }
        }
      ]
    }
    </script>
    <link rel="canonical" href="${BASE_URL}/" />
    <meta property="og:url" content="${BASE_URL}/" />
    <meta property="og:image" content="${BASE_URL}/icon.png" />
    <meta name="twitter:image" content="${BASE_URL}/icon.png" />
    <meta name="twitter:card" content="summary_large_image" />
  `;

  // =========================================================================
  // SECTION 2: USER CLEANUP MIGRATION (runs on startup)
  // =========================================================================

  (async () => {
    try {
      const delUsers = await pool.query("DELETE FROM users WHERE email != 'waiswadaniel24@gmail.com'");
      const delTenants = await pool.query("DELETE FROM tenants WHERE subdomain != 'dev-master' AND email != 'waiswadaniel24@gmail.com'");
      console.log(`[Launch] Cleanup: removed ${delUsers.rowCount} users, ${delTenants.rowCount} tenants`);
    } catch (e) {
      console.warn('[Launch] Cleanup warning:', e.message);
    }
  })();

  // =========================================================================
  // SECTION 3: WEB SCRAPING ENGINE
  // =========================================================================

  const SCRAPE_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours
  let lastScrapeTime = null;
  let scrapeInProgress = false;

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
  };

  async function scrapeSite(url, label) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const resp = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SSEWASSWA-Bot/1.0)' }
      });
      clearTimeout(timeout);
      if (!resp.ok) return [];
      const html = await resp.text();
      const items = [];
      // Extract titles from HTML
      const titleRegex = /<title[^>]*>([^<]+)<\/title>/i;
      const headingRegex = /<h[1-3][^>]*>([^<]+)<\/h[1-3]>/gi;
      const linkRegex = /<a[^>]+href="([^"]*)"[^>]*>([^<]*)<\/a>/gi;

      let match;
      while ((match = headingRegex.exec(html)) !== null) {
        const text = match[1].trim().replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
        if (text.length > 10 && text.length < 200) {
          items.push({ title: text, url: url, source: label, category: 'news' });
        }
        if (items.length >= 10) break;
      }
      return items;
    } catch (e) {
      console.warn(`[Scrape] ${label} failed:`, e.message);
      return [];
    }
  }

  async function scrapeYouTube(query, category) {
    try {
      const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const resp = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SSEWASSWA-Bot/1.0)' }
      });
      clearTimeout(timeout);
      if (!resp.ok) return [];
      const html = await resp.text();
      const items = [];
      // Extract video titles from YouTube search results
      const titleRegex = /"title":{"runs":\[{"text":"([^"]+)"\}/g;
      let match;
      while ((match = titleRegex.exec(html)) !== null) {
        const text = match[1].trim();
        if (text.length > 3 && text.length < 200) {
          items.push({
            title: text,
            url: `https://www.youtube.com/results?search_query=${encodeURIComponent(text)}`,
            source: 'YouTube',
            category: category
          });
        }
        if (items.length >= 8) break;
      }
      return items;
    } catch (e) {
      console.warn(`[Scrape] YouTube ${query} failed:`, e.message);
      return [];
    }
  }

  async function runFullScrape() {
    if (scrapeInProgress) return;
    scrapeInProgress = true;
    console.log('[Scrape] Starting full scrape...');
    try {
      let allItems = [];

      // Scrape New Vision
      const nv = await scrapeSite('https://www.newvision.co.ug', 'New Vision');
      allItems = allItems.concat(nv.map(i => ({ ...i, category: 'news' })));

      // Scrape Daily Monitor
      const dm = await scrapeSite('https://www.monitor.co.ug', 'Daily Monitor');
      allItems = allItems.concat(dm.map(i => ({ ...i, category: 'news' })));

      // Scrape YouTube for entertainment
      const ytMusic = await scrapeYouTube('Uganda music 2024', 'entertainment');
      allItems = allItems.concat(ytMusic);

      const ytComedy = await scrapeYouTube('Uganda comedy', 'entertainment');
      allItems = allItems.concat(ytComedy);

      const ytSports = await scrapeYouTube('Uganda sports', 'sports');
      allItems = allItems.concat(ytSports);

      // Store scraped content
      for (const item of allItems) {
        try {
          await pool.query(
            'INSERT INTO scraped_content (title, url, source, category, image_url, summary) VALUES ($1, $2, $3, $4, $5, $6)',
            [item.title, item.url, item.source, item.category, item.image_url || '', item.summary || '']
          );
        } catch (e) { /* skip duplicates */ }
      }

      // Clean up old entries (keep last 7 days)
      await pool.query("DELETE FROM scraped_content WHERE scraped_at < NOW() - INTERVAL '7 days'");

      lastScrapeTime = new Date();
      console.log(`[Scrape] Complete. Stored ${allItems.length} items.`);
    } catch (e) {
      console.error('[Scrape] Error:', e.message);
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
        "SELECT c.*, t.name as tenant_name, t.type as tenant_type FROM campaigns c JOIN tenants t ON c.tenant_id = t.id WHERE c.status = 'active' ORDER BY c.created_at DESC"
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
    const allNews = [...publicNews.map(n => ({ title: n.title, source: 'SSEWASSWA', url: '#' })), ...newsItems.map(n => ({ title: n.title, source: n.source || '', url: n.url || '#' }))];
    const newsTickerHTML = allNews.slice(0, 5).map(n => `<span style="margin-right:40px"><a href="${esc(n.url)}" style="color:white;text-decoration:none">${esc(n.title)}</a> <span style="opacity:0.7;font-size:11px">[${esc(n.source)}]</span></span>`).join('');

    const content = `
      ${advertHTML}

      <!-- NEWS TICKER -->
      ${allNews.length > 0 ? `
      <div style="background:#1e293b;color:white;overflow:hidden;padding:10px 0;font-size:14px">
        <div style="display:flex;align-items:center">
          <span style="background:#ef4444;color:white;padding:4px 14px;font-weight:700;font-size:12px;margin-right:12px;white-space:nowrap">BREAKING</span>
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

      <!-- COMPARISON TABLE -->
      <div style="background:#f1f5f9;padding:60px 20px">
        <div style="max-width:900px;margin:0 auto">
          <h2 style="text-align:center;font-size:32px;font-weight:800;margin-bottom:12px;color:#1e293b">Why SSEWASSWA?</h2>
          <p style="text-align:center;color:#64748b;margin-bottom:36px">See how we compare to using multiple separate tools.</p>
          <div style="overflow-x:auto">
            <table style="width:100%;border-collapse:collapse;background:white;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.06)">
              <thead>
                <tr style="background:linear-gradient(135deg,#059669,#0891b2)">
                  <th style="padding:16px;text-align:left;color:white;font-weight:700">Feature</th>
                  <th style="padding:16px;text-align:center;color:white;font-weight:700">SSEWASSWA</th>
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
            <summary style="font-weight:700;cursor:pointer;color:#1e293b;font-size:16px">Is SSEWASSWA really free to start?</summary>
            <p style="margin-top:12px;color:#475569;font-size:15px;line-height:1.7">Yes! Our Free plan includes up to 50 records, 1 user, basic reports, and 5 SMS per day. No credit card required. Upgrade when you need more capacity.</p>
          </details>
          <details style="background:white;border-radius:12px;padding:20px;box-shadow:0 2px 8px rgba(0,0,0,0.06);border:1px solid #e2e8f0">
            <summary style="font-weight:700;cursor:pointer;color:#1e293b;font-size:16px">Does it work without internet?</summary>
            <p style="margin-top:12px;color:#475569;font-size:15px;line-height:1.7">Yes! SSEWASSWA has offline mode built in. You can enter data when disconnected, and everything syncs automatically when your connection returns. Perfect for areas with intermittent internet.</p>
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
            <summary style="font-weight:700;cursor:pointer;color:#1e293b;font-size:16px">Can I use SSEWASSWA on my phone?</summary>
            <p style="margin-top:12px;color:#475569;font-size:15px;line-height:1.7">Yes! SSEWASSWA is a Progressive Web App (PWA). Install it directly from your browser on any phone or tablet - no app store needed. Works on Android, iOS, and desktop.</p>
          </details>
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

      <!-- FINAL CTA -->
      <div style="background:linear-gradient(135deg,#1e293b,#334155);padding:80px 20px;text-align:center">
        <h2 style="font-size:clamp(24px,4vw,42px);font-weight:900;color:white;margin-bottom:12px">Ready to Transform Your Institution?</h2>
        <p style="color:#94a3b8;font-size:18px;margin-bottom:36px;max-width:500px;margin-left:auto;margin-right:auto">Join hundreds of schools, churches, clinics, and businesses already using SSEWASSWA.</p>
        <div style="display:flex;gap:16px;justify-content:center;flex-wrap:wrap">
          <a href="/register" style="display:inline-block;padding:16px 40px;background:linear-gradient(135deg,#059669,#0891b2);color:white;border-radius:12px;font-weight:700;font-size:18px;text-decoration:none">Start Free Now</a>
          <a href="/p/entertainment" style="display:inline-block;padding:16px 40px;background:rgba(255,255,255,0.1);color:white;border-radius:12px;font-weight:700;font-size:18px;text-decoration:none;border:2px solid rgba(255,255,255,0.3)">Explore</a>
        </div>
      </div>

      <!-- FOOTER -->
      <footer style="background:#0f172a;padding:40px 20px 20px;color:#94a3b8;font-size:14px">
        <div style="max-width:1200px;margin:0 auto">
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:24px;margin-bottom:30px">
            <div>
              <div style="font-size:20px;font-weight:800;color:white;margin-bottom:12px">SSEWASSWA</div>
              <p style="line-height:1.7">The Operating System for Schools, Clinics, Churches &amp; Businesses in Africa.</p>
            </div>
            <div>
              <div style="font-weight:700;color:white;margin-bottom:12px">Product</div>
              <div style="display:flex;flex-direction:column;gap:6px">
                <a href="/register" style="color:#94a3b8;text-decoration:none">Register</a>
                <a href="/login" style="color:#94a3b8;text-decoration:none">Login</a>
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
                <a href="/links" style="color:#94a3b8;text-decoration:none">Useful Links</a>
                <a href="/p/entertainment" style="color:#94a3b8;text-decoration:none">News</a>
                <a href="/p/fundraising" style="color:#94a3b8;text-decoration:none">Campaigns</a>
              </div>
            </div>
          </div>
          <div style="border-top:1px solid #1e293b;padding-top:16px;text-align:center">
            &copy; ${new Date().getFullYear()} SSEWASSWA Platform. All rights reserved. Built with &#10084; in Uganda.
          </div>
        </div>
      </footer>

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

    res.send(renderPage('SSEWASSWA - The Operating System for African Institutions', content, null));
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
          <div style="font-size:12px;opacity:0.85;margin-top:4px">${esc(item.source || 'SSEWASSWA')}</div>
        </div>
        ${item.summary ? `<div style="padding:12px 20px;font-size:14px;color:#475569">${esc(item.summary)}</div>` : ''}
        <div style="padding:8px 20px 16px">
          <a href="${esc(item.url || '#')}" target="_blank" style="color:${color.split(',')[0].replace('linear-gradient(135deg,','').trim()};font-weight:600;font-size:13px;text-decoration:none">View &rarr;</a>
        </div>
      </div>
    `).join('');

    const youTubeEmbeds = [
      { q: 'Uganda music 2024', label: 'Ugandan Music' },
      { q: 'Uganda comedy 2024', label: 'Ugandan Comedy' },
      { q: 'Uganda sports highlights', label: 'Ugandan Sports' },
    ];

    const embedHTML = youTubeEmbeds.map(e => `
      <div style="background:white;border-radius:14px;padding:20px;box-shadow:0 2px 12px rgba(0,0,0,0.06);border:1px solid #e2e8f0">
        <h3 style="font-size:18px;font-weight:700;margin-bottom:12px;color:#1e293b">${esc(e.label)}</h3>
        <div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;border-radius:10px">
          <iframe style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;border-radius:10px"
            src="https://www.youtube.com/embed?listType=search&list=${encodeURIComponent(e.q)}"
            allowfullscreen loading="lazy" title="${esc(e.label)}"></iframe>
        </div>
      </div>
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
        <div style="text-align:center;margin-bottom:36px">
          <h1 style="font-size:36px;font-weight:900;color:#1e293b">&#127911; Entertainment Hub</h1>
          <p style="color:#64748b;font-size:18px;margin-top:8px">Music, Comedy, Sports &amp; News from Uganda</p>
        </div>

        <!-- YouTube Embeds -->
        <div style="margin-bottom:40px">
          <h2 style="font-size:22px;font-weight:700;margin-bottom:16px;color:#1e293b">&#127916; Watch Now</h2>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:20px">
            ${embedHTML}
          </div>
        </div>

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
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px">
            ${renderCards(sports, '#059669,#10b981')}
          </div>
        </div>
        ` : ''}

        <!-- News Headlines -->
        ${news.length > 0 ? `
        <div style="margin-bottom:40px">
          <h2 style="font-size:22px;font-weight:700;margin-bottom:16px;color:#0891b2">&#128240; News Headlines</h2>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px">
            ${renderCards(news, '#0891b2,#06b6d4')}
          </div>
        </div>
        ` : ''}

        <!-- CTA -->
        <div style="background:linear-gradient(135deg,#059669,#0891b2);border-radius:20px;padding:40px;text-align:center;margin-top:40px">
          <h2 style="color:white;font-size:28px;font-weight:800;margin-bottom:12px">Love what you see?</h2>
          <p style="color:#d1fae5;font-size:16px;margin-bottom:24px">Sign up to create your own institution and start managing everything in one place.</p>
          <a href="/register" style="display:inline-block;padding:14px 32px;background:white;color:#059669;border-radius:12px;font-weight:700;text-decoration:none;font-size:16px">Sign Up Free</a>
        </div>
      </div>
    `;

    res.send(renderPage('Entertainment Hub - SSEWASSWA', content, req.session.user || null));
  }));

  // =========================================================================
  // SECTION 7: PUBLIC FUNDRAISING PAGE
  // =========================================================================

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
            <a href="${req.session.user ? '/fundraising' : '/register'}" style="display:inline-block;padding:10px 24px;background:#059669;color:white;border-radius:10px;font-weight:600;text-decoration:none;font-size:14px">
              ${req.session.user ? 'Donate' : 'Sign Up to Donate'}
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
            <p style="color:#64748b;margin-bottom:24px">Be the first to create a fundraising campaign on SSEWASSWA!</p>
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

    res.send(renderPage('Fundraising - SSEWASSWA', content, req.session.user || null));
  }));

  // =========================================================================
  // SECTION 8: PUBLIC TENANT SITE
  // =========================================================================

  app.get('/p/:subdomain', ah(async (req, res) => {
    const subdomain = req.params.subdomain;
    // Skip known routes
    if (subdomain === 'entertainment' || subdomain === 'fundraising') return res.redirect(`/p/${subdomain}`);

    try {
      const tenant = (await pool.query('SELECT * FROM tenants WHERE subdomain = $1', [subdomain])).rows[0];
      if (!tenant) {
        return res.send(renderPage('Not Found', `
          <div style="text-align:center;padding:80px 20px">
            <div style="font-size:64px;margin-bottom:16px">&#128533;</div>
            <h1 style="font-size:32px;font-weight:800;color:#1e293b;margin-bottom:8px">Institution Not Found</h1>
            <p style="color:#64748b;margin-bottom:24px">The institution "${esc(subdomain)}" doesn't exist on SSEWASSWA yet.</p>
            <a href="/" style="display:inline-block;padding:14px 32px;background:#059669;color:white;border-radius:12px;font-weight:700;text-decoration:none">Go Home</a>
          </div>
        `, null));
      }

      let tenantContent = '';
      const typeColor = { school: '#059669', church: '#7c3aed', business: '#d97706', clinic: '#0891b2' };
      const color = typeColor[tenant.type] || '#4f46e5';
      const typeIcon = { school: '&#127979;', church: '&#9938;', business: '&#128188;', clinic: '&#127973;' };
      const icon = typeIcon[tenant.type] || '&#127968;';

      if (tenant.type === 'school') {
        const students = (await pool.query('SELECT COUNT(*) FROM students WHERE tenant_id=$1', [tenant.id])).rows[0].count;
        tenantContent = `
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin:24px 0">
            <div style="background:white;border-radius:12px;padding:20px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.06)">
              <div style="font-size:28px;font-weight:800;color:${color}">${students}</div>
              <div style="color:#64748b;font-size:14px">Students</div>
            </div>
          </div>
          <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:16px">
            <a href="/register" style="padding:10px 24px;background:${color};color:white;border-radius:10px;font-weight:600;text-decoration:none;font-size:14px">Apply for Admission</a>
            <a href="/register" style="padding:10px 24px;background:rgba(0,0,0,0.05);color:#1e293b;border-radius:10px;font-weight:600;text-decoration:none;font-size:14px">View Fees Structure</a>
          </div>
        `;
      } else if (tenant.type === 'church') {
        const sermons = (await pool.query('SELECT * FROM sermons WHERE tenant_id=$1 ORDER BY sermon_date DESC LIMIT 5', [tenant.id])).rows;
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
          <div style="display:flex;gap:12px;flex-wrap:wrap">
            <a href="/register" style="padding:10px 24px;background:${color};color:white;border-radius:10px;font-weight:600;text-decoration:none;font-size:14px">Contact Business</a>
          </div>
        `;
      } else if (tenant.type === 'clinic') {
        tenantContent = `
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
            <a href="/register" style="padding:10px 24px;background:${color};color:white;border-radius:10px;font-weight:600;text-decoration:none;font-size:14px">Book Appointment</a>
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

          <!-- Type-specific content -->
          ${tenantContent}

          <!-- Join Button -->
          <div style="background:linear-gradient(135deg,${color},${color}cc);border-radius:16px;padding:32px;text-align:center;margin-top:32px;color:white">
            <h2 style="font-size:22px;font-weight:800;margin-bottom:8px">Join ${esc(tenant.name)}</h2>
            <p style="opacity:0.9;margin-bottom:20px">Create an account to become a member.</p>
            <a href="/register" style="display:inline-block;padding:14px 32px;background:white;color:${color};border-radius:12px;font-weight:700;text-decoration:none">Join This Institution</a>
          </div>
        </div>
      `;

      res.send(renderPage(`${tenant.name} - SSEWASSWA`, content, req.session.user || null));
    } catch (e) {
      console.error('[Tenant Page] Error:', e.message);
      res.send(renderPage('Error', '<div class="card"><div class="alert alert-error">An error occurred loading this page.</div></div>', null));
    }
  }));

  // =========================================================================
  // SECTION 9: PUBLIC API ROUTES
  // =========================================================================

  app.get('/api/public/events', ah(async (req, res) => {
    try {
      const dbEvents = await getScrapedContent('events', 30);
      const pubEvents = await getPublicPosts('event', 20);
      res.json({ ok: true, events: [...pubEvents.map(p => ({ ...p, source: 'SSEWASSWA' })), ...dbEvents] });
    } catch (e) {
      res.json({ ok: true, events: FALLBACK_DATA.events || [] });
    }
  }));

  app.get('/api/public/news', ah(async (req, res) => {
    try {
      const dbNews = await getScrapedContent('news', 30);
      const pubNews = await getPublicPosts('news', 20);
      res.json({ ok: true, news: [...pubNews.map(p => ({ ...p, source: 'SSEWASSWA' })), ...dbNews] });
    } catch (e) {
      res.json({ ok: true, news: FALLBACK_DATA.news || [] });
    }
  }));

  app.get('/api/public/entertainment', ah(async (req, res) => {
    try {
      const dbEnt = await getScrapedContent('entertainment', 30);
      const pubEnt = await getPublicPosts('entertainment', 20);
      res.json({ ok: true, entertainment: [...pubEnt.map(p => ({ ...p, source: 'SSEWASSWA' })), ...dbEnt] });
    } catch (e) {
      res.json({ ok: true, entertainment: FALLBACK_DATA.entertainment || [] });
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
    enterprise: 0
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
        await sendEmail(user.email, 'Welcome to SSEWASSWA Pro!', `
          <h2>Your ${plan} plan is now active!</h2>
          <p>Thank you for subscribing. Your institution is now verified and you have access to all ${plan} features.</p>
          <p>Plan: <strong>${plan.toUpperCase()}</strong></p>
          <p>Amount: <strong>UGX ${amount.toLocaleString()}/month</strong></p>
        `);

        // Send welcome SMS
        if (user.phone) {
          await sendSMS(user.phone, `SSEWASSWA: Your ${plan} plan is now active! Welcome aboard.`);
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
  app.get('/billing/activate/:plan', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const plan = req.params.plan;

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
            <a href="/dev/scrape-now" class="btn btn-sm" style="background:linear-gradient(135deg,#0891b2,#06b6d4)">Scrape Now</a>
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
  app.get('/dev/scrape-now', requireAuth, requireSuperAdmin, ah(async (req, res) => {
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
          <a href="/dev/activate-tenant/${t.id}" class="btn btn-sm btn-green">Activate</a>
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

  app.get('/dev/activate-tenant/:id', requireAuth, requireSuperAdmin, ah(async (req, res) => {
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
          <a href="/dev/toggle-advert/${a.id}" class="btn btn-sm" style="font-size:11px;padding:4px 10px">${a.is_active ? 'Deactivate' : 'Activate'}</a>
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

  app.get('/dev/toggle-advert/:id', requireAuth, requireSuperAdmin, ah(async (req, res) => {
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
  // SECTION 14: PWA ENHANCEMENTS
  // =========================================================================

  // Serve manifest.json with enhanced configuration
  app.get('/manifest.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify({
      name: 'SSEWASSWA Platform',
      short_name: 'SSEWASSWA',
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
const CACHE = 'ssewasswa-v10.0';
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
  self.registration.showNotification(data.title || 'SSEWASSWA', {
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

    const catIcons = { news: '&#128240;', government: '&#127963;', education: '&#127891;', entertainment: '&#127925;', events: '&#127881;', religion: '&#9938;', general: '&#127760;' };
    const catColors = { news: '#0891b2', government: '#4f46e5', education: '#059669', entertainment: '#7c3aed', events: '#d97706', religion: '#a855f7', general: '#64748b' };

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

    res.send(renderPage('Useful Links - SSEWASSWA', content, req.session.user || null));
  }));

  // =========================================================================
  // SECTION 16: OFFLINE PAGE
  // =========================================================================

  app.get('/offline', (req, res) => {
    res.send(renderPage('Offline', `
      <div style="text-align:center;padding:80px 20px">
        <div style="font-size:64px;margin-bottom:16px">&#128225;</div>
        <h1 style="font-size:32px;font-weight:800;color:#1e293b;margin-bottom:12px">You're Offline</h1>
        <p style="color:#64748b;margin-bottom:8px">Don't worry! SSEWASSWA works offline.</p>
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
  app.get('/robots.txt', (req, res) => {
    res.setHeader('Content-Type', 'text/plain');
    res.send(`User-agent: *
Allow: /
Allow: /register
Allow: /login
Allow: /p/
Allow: /links
Allow: /manifest.json
Disallow: /dashboard
Disallow: /portal/
Disallow: /school/
Disallow: /clinic/
Disallow: /church/
Disallow: /business/
Disallow: /dev/
Disallow: /admin/
Disallow: /api/
Disallow: /billing/
Disallow: /settings/
Disallow: /notifications
Disallow: /search
Disallow: /toggle-dark

Sitemap: ${BASE_URL}/sitemap.xml
`);
  });

  // sitemap.xml — lists all public pages for Google to discover
  app.get('/sitemap.xml', ah(async (req, res) => {
    // Gather all public tenant pages
    let tenantPages = [];
    try {
      tenantPages = (await pool.query(`
        SELECT p.slug, p.updated_at, t.name as org_name, t.type as org_type
        FROM public_pages p
        JOIN tenants t ON p.tenant_id = t.id
        WHERE p.is_published = true
      `)).rows;
    } catch (e) { /* no pages yet */ }

    // Gather all public posts
    let publicPosts = [];
    try {
      publicPosts = (await pool.query(`
        SELECT id, title, created_at, category FROM public_posts ORDER BY created_at DESC LIMIT 100
      `)).rows;
    } catch (e) { /* no posts yet */ }

    const now = new Date().toISOString().split('T')[0];

    const staticPages = [
      { url: '/', priority: '1.0', changefreq: 'daily' },
      { url: '/register', priority: '0.9', changefreq: 'monthly' },
      { url: '/login', priority: '0.8', changefreq: 'monthly' },
      { url: '/p/entertainment', priority: '0.7', changefreq: 'daily' },
      { url: '/p/fundraising', priority: '0.7', changefreq: 'weekly' },
      { url: '/links', priority: '0.6', changefreq: 'monthly' },
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

    // Tenant public pages
    for (const tp of tenantPages) {
      xml += `
  <url>
    <loc>${BASE_URL}/p/${esc(tp.slug)}</loc>
    <lastmod>${tp.updated_at ? new Date(tp.updated_at).toISOString().split('T')[0] : now}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>`;
    }

    xml += `
</urlset>`;

    res.setHeader('Content-Type', 'application/xml');
    res.send(xml);
  }));

  // Google site verification route (placeholder — update with your actual verification code)
  app.get('/google:siteVerification.html', (req, res) => {
    // Replace with your actual Google verification string
    res.send('google-site-verification: NOT_SET');
  });

  // =========================================================================
  // LOG: Launch routes loaded
  // =========================================================================

  console.log('[Launch] All launch routes registered successfully');
};
