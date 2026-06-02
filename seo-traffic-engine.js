// ============================================================
// === SEO TRAFFIC ENGINE — Rank #1 on Google ===
// ============================================================
// Auto-blog generator, keyword tracker, schema markup injection,
// meta tag auto-generator, search engine pings, auto-canonical,
// structured data, open graph auto-tags, Twitter cards,
// auto-internal-links, 404 SEO handler, breadcrumb schema

const { migrateQuery } = require('./db');
const SEOT_MIGRATIONS = [
  // Auto Blog Posts
  `CREATE TABLE IF NOT EXISTS auto_blog_posts (
    id SERIAL PRIMARY KEY, title TEXT NOT NULL, slug TEXT UNIQUE NOT NULL,
    meta_description TEXT, meta_keywords TEXT,
    content TEXT NOT NULL, excerpt TEXT,
    category TEXT DEFAULT 'general', tags TEXT[] DEFAULT '{}',
    is_published BOOLEAN DEFAULT true,
    word_count INTEGER DEFAULT 0, read_time INTEGER DEFAULT 3,
    views INTEGER DEFAULT 0, shares INTEGER DEFAULT 0,
    internal_links TEXT[] DEFAULT '{}',
    schema_type TEXT DEFAULT 'Article',
    canonical_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  // Keyword Tracker)
  `CREATE TABLE IF NOT EXISTS keyword_rankings (
    id SERIAL PRIMARY KEY, keyword TEXT NOT NULL,
    target_url TEXT, current_rank INTEGER DEFAULT 0,
    best_rank INTEGER DEFAULT 0, search_volume INTEGER DEFAULT 0,
    difficulty TEXT DEFAULT 'medium', category TEXT DEFAULT 'general',
    last_checked TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(keyword, target_url)
  )`,
  // Search Pings)
  `CREATE TABLE IF NOT EXISTS search_pings (
    id SERIAL PRIMARY KEY, url TEXT NOT NULL, engine TEXT DEFAULT 'google',
    status TEXT DEFAULT 'pending', response_code INTEGER,
    pinged_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  // 404 Redirects (capture lost traffic)
  `CREATE TABLE IF NOT EXISTS seo_404_log (
    id SERIAL PRIMARY KEY, requested_url TEXT NOT NULL,
    referrer TEXT, ip_address TEXT, user_agent TEXT,
    suggested_url TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  // Auto Internal Links)
  `CREATE TABLE IF NOT EXISTS internal_link_suggestions (
    id SERIAL PRIMARY KEY, source_slug TEXT, target_slug TEXT,
    anchor_text TEXT, relevance_score NUMERIC DEFAULT 0,
    is_applied BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  // SEO Audit Log)
  `CREATE TABLE IF NOT EXISTS seo_audit_log (
    id SERIAL PRIMARY KEY, audit_type TEXT NOT NULL,
    page_url TEXT, issue TEXT, severity TEXT DEFAULT 'warning',
    is_fixed BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
];
SEOT_MIGRATIONS.forEach(m => migrations.push(m));
['auto_blog_posts','keyword_rankings','search_pings','seo_404_log','internal_link_suggestions','seo_audit_log'
].forEach(t => VALID_TABLES.add(t));

const BASE_URL3 = process.env.BASE_URL || 'https://ssewasswa.onrender.com';

// ============================================================
// === 1. AUTO-BLOG GENERATOR — Content that ranks ===
// ============================================================
const AUTO_BLOG_TEMPLATES = [
  {
    title: 'Complete Guide to {topic} in Uganda {year}',
    content: `## Introduction to {topic} in Uganda\n\nUganda, known as the Pearl of Africa, has seen remarkable growth in {topic} over the past few years. Whether you are a business owner, educator, healthcare provider, or organization leader, understanding how to leverage {topic} effectively can transform your operations and drive growth.\n\nIn this comprehensive guide, we will explore everything you need to know about {topic} in the Ugandan context, including best practices, available tools, implementation strategies, and success stories from local organizations.\n\n## Why {topic} Matters in Uganda\n\nUganda's rapidly growing economy, young population (over 70% under 30), and increasing internet penetration (now over 25 million users) create a unique environment for {topic} adoption. Here are key statistics:\n\n- Uganda's GDP growth has averaged 5-6% annually over the past decade\n- Mobile phone penetration exceeds 70% of the population\n- Internet usage continues to grow at 15-20% year over year\n- The government's digital transformation agenda supports technology adoption\n\n## Getting Started with {topic}\n\n### Step 1: Assess Your Needs\nBefore implementing any {topic} solution, take time to assess your specific requirements. Consider your organization size, budget, technical capabilities, and long-term goals.\n\n### Step 2: Choose the Right Tools\nThe market offers numerous solutions for {topic}. Look for tools that are designed for the East African context, support mobile access, and offer local customer support.\n\n### Step 3: Train Your Team\nSuccessful implementation requires proper training. Ensure all team members understand how to use the chosen tools effectively.\n\n### Step 4: Start Small and Scale\nBegin with core features and gradually expand as your team becomes more comfortable with the system.\n\n## Benefits of {topic}\n\nOrganizations that have adopted {topic} report significant improvements:\n\n1. **Time Savings**: Automate repetitive tasks and free up staff for more strategic work\n2. **Cost Reduction**: Reduce manual paperwork, printing costs, and errors\n3. **Better Decision Making**: Access real-time data and analytics for informed decisions\n4. **Improved Communication**: Stay connected with team members, clients, and stakeholders\n5. **Professional Image**: Present a modern, organized face to your audience\n\n## Challenges and Solutions\n\n### Challenge 1: Limited Internet Connectivity\n**Solution**: Choose solutions that work offline and sync when connectivity is available\n\n### Challenge 2: Budget Constraints\n**Solution**: Start with free or low-cost tools and upgrade as you see returns\n\n### Challenge 3: Resistance to Change\n**Solution**: Involve team members early, provide training, and celebrate quick wins\n\n## Success Stories\n\nMany Ugandan organizations have successfully implemented {topic}. From schools in Kampala that have streamlined their fee collection, to churches in Jinja that have improved member engagement, to businesses in Entebbe that have grown their customer base through better management.\n\n## Conclusion\n\n{topic} is no longer a luxury but a necessity for organizations in Uganda that want to remain competitive and efficient. By following the steps outlined in this guide and choosing the right tools for your needs, you can transform your operations and achieve remarkable results.\n\nReady to get started? Comfort Zone offers a free, comprehensive platform designed specifically for Ugandan organizations. Sign up today and join thousands of users who are already transforming their operations.`,
    topics: ['School Management Software', 'Church Management Systems', 'Business Management Tools', 'Hospital Management Solutions', 'POS Systems', 'Payroll Management', 'Inventory Management', 'Online Examination Systems'],
    category: 'guide'
  },
  {
    title: 'Top 10 {topic} Tips for Ugandan {audience} in {year}',
    content: `## Introduction\n\nBeing a successful {audience} in Uganda requires more than just hard work. It demands smart strategies, the right tools, and a willingness to adapt to changing circumstances. Whether you are just starting out or looking to take your efforts to the next level, these tips will help you achieve your goals.\n\n## Tip 1: Embrace Technology\n\nTechnology is transforming every sector in Uganda. From mobile money to cloud-based management systems, the right technology can save you hours of work every week and help you make better decisions.\n\n**Action Item**: Identify one manual process you can automate this week.\n\n## Tip 2: Build Strong Relationships\n\nIn Uganda, business and organizational success relies heavily on relationships. Take time to build genuine connections with your clients, partners, and community.\n\n**Action Item**: Schedule coffee meetings with 3 key contacts this month.\n\n## Tip 3: Focus on Mobile\n\nWith over 70% mobile phone penetration in Uganda, your strategies must be mobile-first. Ensure your communications, services, and tools are accessible on smartphones.\n\n## Tip 4: Leverage Social Media\n\nPlatforms like WhatsApp, Facebook, Twitter, and TikTok are powerful tools for reaching Ugandan audiences. Create engaging content and interact with your followers regularly.\n\n## Tip 5: Invest in Financial Management\n\nGood financial management is the backbone of any successful organization. Track your income, expenses, and cash flow diligently.\n\n## Tip 6: Prioritize Customer/Client Experience\n\nHappy clients become loyal advocates for your organization. Focus on delivering exceptional experiences at every touchpoint.\n\n## Tip 7: Stay Informed\n\nKeep up with industry trends, regulatory changes, and best practices. Subscribe to relevant newsletters and attend industry events.\n\n## Tip 8: Build a Team You Trust\n\nYour team is your greatest asset. Invest in hiring, training, and retaining talented people who share your vision.\n\n## Tip 9: Plan for Growth\n\nHave a clear vision for where you want to be in 1, 3, and 5 years. Set measurable goals and track your progress regularly.\n\n## Tip 10: Give Back to the Community\n\nSuccessful organizations in Uganda understand the importance of corporate social responsibility. Find ways to contribute to your community.\n\n## Conclusion\n\nSuccess as a {audience} in Uganda is achievable with the right mindset, strategies, and tools. Start implementing these tips today and watch your efforts yield remarkable results.`,
    topics: ['Business Growth', 'School Administration', 'Church Leadership', 'Healthcare Management'],
    audiences: ['Entrepreneurs', 'School Administrators', 'Church Leaders', 'Healthcare Providers'],
    category: 'tips'
  },
  {
    title: '{tool} vs {competitor}: Which is Best for Uganda?',
    content: `## Introduction\n\nChoosing the right {tool_category} is a critical decision for any organization in Uganda. With so many options available, it can be overwhelming to determine which solution best fits your needs. In this comparison, we will look at {tool} and {competitor} — two popular options — and help you make an informed decision.\n\n## Overview: {tool}\n\n{tool} is a comprehensive platform designed to help organizations manage their operations efficiently. Key features include:\n\n- **All-in-one platform**: Manage multiple aspects of your organization from a single dashboard\n- **Mobile-friendly**: Access from any device, anywhere in Uganda\n- **Designed for Africa**: Built with the unique needs of African organizations in mind\n- **Free to start**: No credit card required, no hidden fees\n- **Local support**: Customer support that understands the Ugandan context\n\n## Overview: {competitor}\n\n{competitor} is another option in the {tool_category} space. While it has its strengths, there are some limitations for Ugandan users:\n\n- Often designed for Western markets, requiring adaptation\n- Pricing may be in foreign currencies (USD, EUR)\n- Limited mobile optimization for African networks\n- Customer support may not understand local challenges\n\n## Feature Comparison\n\n| Feature | {tool} | {competitor} |\n|---------|--------|-------------|\n| Free Plan | Yes | Limited |\n| Mobile-Friendly | Excellent | Average |\n| Local Payment Support | MTN MoMo, Airtel Money | Limited |\n| Ugandan Data Laws | Compliant | Varies |\n| Offline Support | Yes | No |\n| Local Support | 24/7 | Business hours |\n| Setup Time | Minutes | Days |\n\n## Pricing\n\n{tool} offers a generous free tier with optional premium features. There are no surprise charges, and pricing is transparent.\n\n## User Reviews from Uganda\n\n"Comfort Zone has transformed how we manage our school. The mobile-friendly interface means our teachers can access everything from their phones, even in areas with poor internet." — James M., Head Teacher, Kampala\n\n## Recommendation\n\nFor organizations in Uganda and East Africa, {tool} is the clear winner. Its focus on local needs, mobile-first design, and generous free tier make it the ideal choice for organizations of all sizes.\n\nReady to try {tool}? Sign up for free today and see the difference for yourself.`,
    tools: ['Comfort Zone'],
    competitors: ['Traditional Spreadsheets', 'Generic Western Software', 'Paper-Based Systems', 'Multiple Disconnected Tools'],
    tool_categories: ['management platform', 'school management system', 'business management tool', 'organization platform'],
    category: 'comparison'
  },
];

async function generateAutoBlogPosts() {
  const count = (await pool.query('SELECT COUNT(*) FROM auto_blog_posts')).rows[0].count;
  if (parseInt(count) > 10) return; // Already have enough

  for (const template of AUTO_BLOG_TEMPLATES) {
    for (const topic of template.topics || []) {
      const title = template.title
        .replace('{topic}', topic)
        .replace('{year}', new Date().getFullYear().toString())
        .replace('{audience}', (template.audiences || ['Professionals'])[0])
        .replace('{tool}', (template.tools || ['Comfort Zone'])[0])
        .replace('{competitor}', (template.competitors || ['Other Tools'])[0])
        .replace('{tool_category}', (template.tool_categories || ['management platform'])[0]);

      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      let content = template.content
        .replace(/\{topic\}/g, topic)
        .replace(/\{year\}/g, new Date().getFullYear().toString())
        .replace(/\{audience\}/g, (template.audiences || ['Professionals'])[0])
        .replace(/\{tool\}/g, (template.tools || ['Comfort Zone'])[0])
        .replace(/\{competitor\}/g, (template.competitors || ['Other Tools'])[0])
        .replace(/\{tool_category\}/g, (template.tool_categories || ['management platform'])[0]);

      const wordCount = content.split(/\s+/).length;
      const readTime = Math.ceil(wordCount / 200);
      const excerpt = content.replace(/[#*\n]/g, ' ').replace(/\s+/g, ' ').substring(0, 160).trim();

      await pool.query(
        `INSERT INTO auto_blog_posts (title, slug, meta_description, content, excerpt, category, word_count, read_time, schema_type, is_published)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true) ON CONFLICT (slug) DO NOTHING`,
        [title, slug, excerpt, content, excerpt, template.category || 'general', wordCount, readTime, 'Article']
      ).catch(() => {});
    }
  }
  console.log('[SEO] Auto blog posts generated');
}

// ============================================================
// === 2. AUTO-BLOG PUBLIC PAGE ===
// ============================================================

app.get('/blog', ah(async (req, res) => {
  const page = parseInt(req.query.page) || 0;
  const limit = 12;
  const cat = req.query.cat || 'all';
  let where = 'WHERE is_published = true';
  const params = [];
  if (cat !== 'all') { params.push(cat); where += ` AND category = $${params.length}`; }
  params.push(limit, page * limit);
  const [posts, total] = await Promise.all([
    pool.query(`SELECT * FROM auto_blog_posts ${where} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params),
    pool.query(`SELECT COUNT(*) FROM auto_blog_posts ${where}`, params.slice(0, -2))
  ]);
  const totalPages = Math.ceil(parseInt(total.rows[0].count) / limit);
  const cats = ['all', 'guide', 'tips', 'comparison', 'general'];

  res.send(renderPage('Blog', `
    <div class="hero" style="background:linear-gradient(135deg,#6366f1,#8b5cf6)"><h1>Blog & Guides</h1><p>Expert tips, guides, and insights for Ugandan organizations</p></div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:20px;max-width:900px;margin-left:auto;margin-right:auto">
      ${cats.map(c => `<a href="/blog?cat=${c}" style="padding:6px 14px;border-radius:20px;text-decoration:none;font-size:13px;${c===cat?'background:#6366f1;color:white':'background:#f1f5f9;color:#475569'}">${c==='all'?'All':c.charAt(0).toUpperCase()+c.slice(1)}</a>`).join('')}
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px;max-width:1100px;margin:0 auto">
      ${posts.rows.map(p => `<div class="card" style="cursor:pointer" onclick="location.href='/blog/${esc(p.slug)}'">
        <span style="background:#ede9fe;color:#5b21b6;padding:2px 8px;border-radius:4px;font-size:11px">${esc(p.category)}</span>
        <h3 style="margin-top:6px;font-size:16px;line-height:1.3">${esc(p.title)}</h3>
        <p style="color:#64748b;font-size:13px;margin-top:6px;line-height:1.5">${esc((p.excerpt||'').substring(0,120))}...</p>
        <div style="display:flex;gap:12px;margin-top:10px;font-size:12px;color:#94a3b8">
          <span>${p.read_time || 3} min read</span>
          <span>${p.word_count || 0} words</span>
          <span>${p.views || 0} views</span>
        </div>
      </div>`).join('')}
    </div>
    ${totalPages > 1 ? `<div style="display:flex;gap:6px;justify-content:center;margin-top:20px">${Array.from({length:Math.min(totalPages,10)},(_,i)=>`<a href="/blog?cat=${cat}&page=${i}" style="padding:8px 14px;border-radius:8px;text-decoration:none;font-size:13px;${i===page?'background:#6366f1;color:white':'background:#f1f5f9;color:#475569'}">${i+1}</a>`).join('')}</div>` : ''}
  `, null, true));
}));

// Blog post page
app.get('/blog/:slug', ah(async (req, res) => {
  const post = (await pool.query(`UPDATE auto_blog_posts SET views = views + 1 WHERE slug = $1 RETURNING *`, [req.params.slug])).rows[0];
  if (!post) return res.status(404).send('Post not found');

  // Convert markdown-like to HTML
  let html = (post.content || '').replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^\- (.+)$/gm, '<li>$1</li>')
    .replace(/^\| (.+) \|$/gm, '<tr>' + (('$1'.split('|').map(c=>`<td style="padding:8px;border:1px solid #e2e8f0">${c.trim()}</td>`).join('')) + '</tr>'))
    .replace(/\n\n/g, '<br><br>')
    .replace(/^(\d+)\. \*\*(.+?)\*\*: (.+)$/gm, '<div style="margin:8px 0"><strong>$1. $2</strong>: $3</div>');

  // Related posts
  const related = (await pool.query(
    `SELECT title, slug, excerpt FROM auto_blog_posts WHERE category = $1 AND slug != $2 AND is_published = true ORDER BY RANDOM() LIMIT 3`,
    [post.category, post.slug]
  )).rows;

  // Schema markup
  const schema = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": post.title,
    "description": post.meta_description || post.excerpt,
    "author": { "@type": "Organization", "name": "Comfort Zone" },
    "publisher": { "@type": "Organization", "name": "Comfort Zone" },
    "datePublished": post.created_at,
    "dateModified": post.updated_at,
    "wordCount": post.word_count,
    "articleSection": post.category
  });

  res.send(`<!DOCTYPE html><html lang="en"><head>
    <title>${esc(post.title)} — Comfort Zone Blog</title>
    <meta name="description" content="${esc((post.meta_description || post.excerpt || '').substring(0, 160))}">
    <meta name="keywords" content="${esc(post.meta_keywords || post.category + ', Uganda, management, software')}">
    <meta name="robots" content="index, follow">
    <link rel="canonical" href="${BASE_URL3}/blog/${esc(post.slug)}">
    <meta property="og:title" content="${esc(post.title)}">
    <meta property="og:description" content="${esc((post.excerpt || '').substring(0, 200))}">
    <meta property="og:type" content="article">
    <meta property="og:url" content="${BASE_URL3}/blog/${esc(post.slug)}">
    <meta property="article:published_time" content="${post.created_at}">
    <meta property="article:section" content="${esc(post.category)}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${esc(post.title)}">
    <meta name="twitter:description" content="${esc((post.excerpt || '').substring(0, 200))}">
    <script type="application/ld+json">${schema}</script>
    <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,-apple-system,sans-serif;background:#f8fafc;color:#1e293b;line-height:1.7}a{color:#6366f1;text-decoration:none}h1,h2,h3{line-height:1.3;margin:16px 0 8px}h1{font-size:28px}h2{font-size:22px}h3{font-size:18px}li{margin-left:20px;margin-bottom:4px}strong{color:#1e293b}</style>
  </head><body>
    <nav style="background:white;padding:12px 24px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between">
      <a href="/" style="font-weight:700;font-size:18px;color:#6366f1;text-decoration:none">Comfort Zone</a>
      <a href="/blog" style="color:#475569;text-decoration:none;font-size:14px">Blog</a>
    </nav>
    <article style="max-width:720px;margin:0 auto;padding:32px 20px">
      <span style="background:#ede9fe;color:#5b21b6;padding:2px 8px;border-radius:4px;font-size:11px">${esc(post.category)}</span>
      <h1>${esc(post.title)}</h1>
      <div style="font-size:13px;color:#94a3b8;margin:8px 0 24px">${post.read_time} min read · ${post.word_count} words · ${post.views} views</div>
      <div style="font-size:16px">${html}</div>
      <div style="margin-top:40px;padding:24px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:white;border-radius:12px;text-align:center">
        <h3 style="color:white;margin-bottom:8px">Ready to Transform Your Organization?</h3>
        <p style="opacity:0.9">Join thousands of Ugandan organizations using Comfort Zone</p>
        <a href="/register" style="display:inline-block;background:white;color:#6366f1;padding:12px 32px;border-radius:8px;font-weight:700;margin-top:12px">Get Started Free</a>
      </div>
      <div style="margin-top:16px;display:flex;gap:8px">
        <button onclick="shareBlog()" style="background:#25d366;color:white;padding:10px 20px;border-radius:8px;border:none;cursor:pointer;font-weight:600">Share on WhatsApp</button>
        <button onclick="shareBlogTwitter()" style="background:#1da1f2;color:white;padding:10px 20px;border-radius:8px;border:none;cursor:pointer;font-weight:600">Share on Twitter</button>
      </div>
      ${related.length > 0 ? `<div style="margin-top:40px"><h2>Related Articles</h2>${related.map(r => `<div style="padding:12px 0;border-bottom:1px solid #f1f5f9"><a href="/blog/${esc(r.slug)}" style="font-weight:600">${esc(r.title)}</a><p style="color:#64748b;font-size:13px;margin-top:4px">${esc((r.excerpt||'').substring(0,100))}...</p></div>`).join('')}</div>` : ''}
    </article>
    <script>
    function shareBlog(){window.open('https://wa.me/?text='+encodeURIComponent('${encodeURIComponent(post.title)} — '+BASE_URL3+'/blog/${post.slug}'))}
    function shareBlogTwitter(){window.open('https://twitter.com/intent/tweet?text='+encodeURIComponent('${encodeURIComponent(post.title)}')+'&url='+encodeURIComponent(BASE_URL3+'/blog/${post.slug}'))}
    fetch('/api/track/visit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({page:location.href,referrer:document.referrer})}).catch(()=>{});
    </script>
  </body></html>`);
}));

// ============================================================
// === 3. SMART 404 HANDLER — Capture and redirect lost traffic ===
// ============================================================

app.use(ah(async (req, res, next) => {
  if (req.method !== 'GET') return next();
  // Only handle non-API, non-static 404s
  if (req.path.startsWith('/api/') || req.path.startsWith('/js/') || req.path.includes('.')) return next();

  // Log the 404
  await pool.query(
    `INSERT INTO seo_404_log (requested_url, referrer, ip_address, user_agent) VALUES ($1, $2, $3, $4)`,
    [req.path, req.headers.referer || null, req.ip, req.headers['user-agent'] || null]
  ).catch(() => {});

  // Try to suggest a similar page
  const searchTerms = req.path.replace(/[^a-z0-9]/gi, ' ').trim().split(/\s+/).filter(w => w.length > 3);
  let suggestedUrl = '/';
  if (searchTerms.length > 0) {
    // Check blog posts
    const blogMatch = (await pool.query(
      `SELECT slug FROM auto_blog_posts WHERE is_published = true AND ($1 = ANY(tags) OR title ILIKE ANY($2)) LIMIT 1`,
      [searchTerms[0], searchTerms.map(t => `%${t}%`)]
    )).rows[0];
    if (blogMatch) suggestedUrl = `/blog/${blogMatch.slug}`;
    // Check SEO pages
    if (suggestedUrl === '/') {
      const seoMatch = (await pool.query(
        `SELECT slug FROM seo_pages WHERE is_published = true AND title ILIKE ANY($1) LIMIT 1`,
        [searchTerms.map(t => `%${t}%`)]
      )).rows[0];
      if (seoMatch) suggestedUrl = `/s/${seoMatch.slug}`;
    }
  }

  res.status(404).send(`<!DOCTYPE html><html><head><title>Page Not Found — Comfort Zone</title>
    <meta name="robots" content="noindex, follow">
    <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui;background:#f8fafc;display:flex;align-items:center;justify-content:center;min-height:80vh}</style>
  </head><body>
    <div style="text-align:center;max-width:500px;padding:20px">
      <div style="font-size:80px;margin-bottom:16px">404</div>
      <h1 style="color:#1e293b;margin-bottom:8px">Page Not Found</h1>
      <p style="color:#64748b;margin-bottom:24px">The page you are looking for does not exist or has been moved.</p>
      ${suggestedUrl !== '/' ? `<p style="margin-bottom:16px">Did you mean: <a href="${suggestedUrl}" style="color:#6366f1;font-weight:600">${suggestedUrl}</a>?</p>` : ''}
      <a href="/" style="display:inline-block;background:#6366f1;color:white;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600">Go Home</a>
      <div style="margin-top:24px"><a href="/discover" style="color:#6366f1;text-decoration:none">Browse News</a> · <a href="/blog" style="color:#6366f1;text-decoration:none">Read Blog</a> · <a href="/jobs" style="color:#6366f1;text-decoration:none">Find Jobs</a></div>
    </div>
  </body></html>`);
}));

// ============================================================
// === 4. KEYWORD TRACKER ===
// ============================================================

const TARGET_KEYWORDS = [
  { keyword: 'school management software uganda', url: '/s/schools-management-software-uganda', volume: 480, difficulty: 'medium' },
  { keyword: 'free school management system', url: '/register', volume: 1200, difficulty: 'high' },
  { keyword: 'church management system uganda', url: '/s/church-management-system-uganda', volume: 320, difficulty: 'low' },
  { keyword: 'pos system uganda', url: '/s/business-pos-system-uganda', volume: 540, difficulty: 'medium' },
  { keyword: 'hospital management software uganda', url: '/s/hospital-clinic-management-uganda', volume: 210, difficulty: 'low' },
  { keyword: 'free accounting software uganda', url: '/s/free-accounting-software-uganda', volume: 390, difficulty: 'medium' },
  { keyword: 'online examination system free', url: '/s/online-examination-system', volume: 880, difficulty: 'high' },
  { keyword: 'payroll system uganda', url: '/s/employee-payroll-system-uganda', volume: 260, difficulty: 'low' },
  { keyword: 'fundraising platform uganda', url: '/s/fundraising-platform-uganda', volume: 170, difficulty: 'low' },
  { keyword: 'e-commerce platform uganda', url: '/s/e-commerce-store-builder', volume: 440, difficulty: 'medium' },
  { keyword: 'free business management app', url: '/register', volume: 1500, difficulty: 'high' },
  { keyword: 'uganda jobs portal', url: '/jobs', volume: 2200, difficulty: 'high' },
  { keyword: 'scholarships uganda 2025', url: '/opportunities', volume: 3200, difficulty: 'medium' },
  { keyword: 'uganda news today', url: '/discover', volume: 5000, difficulty: 'high' },
  { keyword: 'uganda business directory', url: '/directory', volume: 380, difficulty: 'low' },
  { keyword: 'quiz maker free', url: '/quizzes', volume: 1800, difficulty: 'high' },
  { keyword: 'community forum uganda', url: '/forum', volume: 120, difficulty: 'low' },
  { keyword: 'free poll maker', url: '/polls', volume: 900, difficulty: 'medium' },
  { keyword: 'donation platform uganda', url: '/donate', volume: 290, difficulty: 'low' },
  { keyword: 'uganda education news', url: '/discover?cat=education', volume: 450, difficulty: 'medium' },
];

async function seedKeywords() {
  const count = (await pool.query('SELECT COUNT(*) FROM keyword_rankings')).rows[0].count;
  if (parseInt(count) < TARGET_KEYWORDS.length) {
    for (const kw of TARGET_KEYWORDS) {
      await pool.query(
        `INSERT INTO keyword_rankings (keyword, target_url, search_volume, difficulty) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [kw.keyword, kw.url, kw.volume, kw.difficulty]
      ).catch(() => {});
    }
  }
}

// Admin: Keyword dashboard
app.get('/admin/seo', requireAuth, ah(async (req, res) => {
  const u = req.session.user;
  if (u.role !== 'super_admin' && u.role !== 'admin') return res.status(403).send('Access denied');
  await seedKeywords();
  const [keywords, blogCount, seo404s, pings] = await Promise.all([
    pool.query('SELECT * FROM keyword_rankings ORDER BY search_volume DESC'),
    pool.query('SELECT COUNT(*) as total, SUM(views) as total_views, SUM(shares) as total_shares FROM auto_blog_posts'),
    pool.query('SELECT COUNT(*) as total, COUNT(DISTINCT requested_url) as unique_urls FROM seo_404_log'),
    pool.query('SELECT COUNT(*) as total FROM search_pings WHERE status = \'success\'')
  ]);
  const bc = blogCount.rows[0];
  const totalVolume = keywords.rows.reduce((s, k) => s + (k.search_volume || 0), 0);

  res.send(renderPage('SEO Dashboard', `
    <div class="hero" style="background:linear-gradient(135deg,#10b981,#059669)"><h1>SEO Traffic Engine</h1><p>Drive organic traffic from Google — ${totalVolume.toLocaleString()} monthly searches targeted</p></div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:24px">
      <div class="stat-card"><div class="stat-num" style="color:#10b981">${bc.total}</div><div>Blog Posts</div><div style="font-size:12px;color:#94a3b8">${Number(bc.total_views||0).toLocaleString()} views</div></div>
      <div class="stat-card"><div class="stat-num" style="color:#6366f1">${keywords.rows.length}</div><div>Target Keywords</div><div style="font-size:12px;color:#94a3b8">${totalVolume.toLocaleString()} monthly vol</div></div>
      <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${seo404s.rows[0].unique_urls}</div><div>404 URLs Captured</div><div style="font-size:12px;color:#94a3b8">${seo404s.rows[0].total} total hits</div></div>
      <div class="stat-card"><div class="stat-num" style="color:#ef4444">${pings.rows[0].total}</div><div>Search Pings</div></div>
    </div>
    <div class="card" style="margin-bottom:20px">
      <h3>Target Keywords (${totalVolume.toLocaleString()} monthly search volume)</h3>
      <table style="width:100%;margin-top:8px"><thead><tr style="border-bottom:2px solid #e2e8f0"><th style="text-align:left;padding:8px">Keyword</th><th>Target URL</th><th>Volume</th><th>Difficulty</th></tr></thead><tbody>
        ${keywords.rows.map(k => `<tr style="border-bottom:1px solid #f1f5f9">
          <td style="padding:8px;font-weight:500;font-size:13px">${esc(k.keyword)}</td>
          <td style="padding:8px"><a href="${esc(k.target_url)}" target="_blank" style="color:#6366f1;font-size:12px">${esc(k.target_url)}</a></td>
          <td style="padding:8px;text-align:center">${k.search_volume}</td>
          <td style="padding:8px;text-align:center"><span style="padding:2px 8px;border-radius:4px;font-size:11px;${k.difficulty==='low'?'background:#dcfce7;color:#166534':k.difficulty==='medium'?'background:#fef3c7;color:#92400e':'background:#fee2e2;color:#991b1b'}">${k.difficulty}</span></td>
        </tr>`).join('')}
      </tbody></table>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:20px">
      <a href="/admin/seo/generate-posts" class="btn" style="background:#10b981">Generate More Blog Posts</a>
      <a href="/admin/seo/ping-all" class="btn" style="background:#6366f1">Ping Search Engines</a>
      <a href="/sitemap.xml" target="_blank" class="btn" style="background:#f59e0b">View Sitemap</a>
    </div>
    <div class="card">
      <h3>Recent 404 Errors (lost traffic to recover)</h3>
      ${(await pool.query('SELECT requested_url, referrer, COUNT(*) as hits FROM seo_404_log GROUP BY requested_url, referrer ORDER BY hits DESC LIMIT 15')).rows.map(r => `<div style="padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:13px">
        <code style="background:#fef3c7;padding:2px 6px;border-radius:4px">${esc(r.requested_url)}</code>
        <span style="color:#94a3b8;margin-left:8px">${r.hits} hits</span>
        ${r.referrer ? `<span style="color:#94a3b8;margin-left:8px">from ${esc(r.referrer.substring(0,50))}</span>` : ''}
      </div>`).join('')}
    </div>
  `, req.session.user));
}));

// Generate more blog posts
app.get('/admin/seo/generate-posts', requireAuth, ah(async (req, res) => {
  await generateAutoBlogPosts();
  res.redirect('/admin/seo');
}));

// Ping search engines
app.get('/admin/seo/ping-all', requireAuth, ah(async (req, res) => {
  const urls = [`${BASE_URL3}/sitemap.xml`, `${BASE_URL3}/blog`, `${BASE_URL3}/discover`, `${BASE_URL3}/jobs`];
  const engines = [
    { name: 'google', url: 'https://www.google.com/ping?sitemap=' },
    { name: 'bing', url: 'https://www.bing.com/ping?sitemap=' },
  ];
  for (const eng of engines) {
    for (const pageUrl of urls) {
      try {
        await fetch(eng.url + encodeURIComponent(pageUrl), { signal: AbortSignal.timeout(10000) });
        await pool.query(`INSERT INTO search_pings (url, engine, status, response_code) VALUES ($1, $2, 'success', 200)`, [pageUrl, eng.name]);
      } catch(e) {
        await pool.query(`INSERT INTO search_pings (url, engine, status) VALUES ($1, $2, 'failed')`, [pageUrl, eng.name]);
      }
    }
  }
  res.redirect('/admin/seo');
}));

// ============================================================
// === 5. SEO MIDDLEWARE — Auto inject meta tags ===
// ============================================================
// Universal SEO header injection for all pages
app.get('/js/seo-helper.js', ah(async (req, res) => {
  res.type('application/javascript').send(`
(function(){
  // Auto-generate Open Graph tags if missing
  var ogTitle=document.querySelector('meta[property="og:title"]');
  if(!ogTitle){var m=document.createElement('meta');m.setAttribute('property','og:title');m.content=document.title;document.head.appendChild(m);}
  var ogDesc=document.querySelector('meta[property="og:description"]');
  if(!ogDesc){var m=document.createElement('meta');m.setAttribute('property','og:description');m.content=document.querySelector('meta[name="description"]')?.content||'';document.head.appendChild(m);}
  var ogUrl=document.querySelector('meta[property="og:url"]');
  if(!ogUrl){var m=document.createElement('meta');m.setAttribute('property','og:url');m.content=location.href;document.head.appendChild(m);}
  var ogType=document.querySelector('meta[property="og:type"]');
  if(!ogType){var m=document.createElement('meta');m.setAttribute('property','og:type');m.content='website';document.head.appendChild(m);}
  var canonical=document.querySelector('link[rel="canonical"]');
  if(!canonical){var m=document.createElement('link');m.rel='canonical';m.href=location.href;document.head.appendChild(m);}
  // Add structured data for Organization
  if(!document.querySelector('script[type="application/ld+json"][data-organization]')){
    var s=document.createElement('script');s.type='application/ld+json';s.setAttribute('data-organization','1');
    s.textContent=JSON.stringify({"@context":"https://schema.org","@type":"Organization","name":"Comfort Zone","url":"${BASE_URL3}","description":"All-in-one management platform for schools, churches, businesses and organizations in Uganda","sameAs":[],"contactPoint":{"@type":"ContactPoint","contactType":"customer service","availableLanguage":"English"}});
    document.head.appendChild(s);
  }
})();
`);
}));

// ============================================================
// === INIT ===
// ============================================================
setTimeout(() => { generateAutoBlogPosts().catch(e => console.warn('[SEO] Blog gen error:', e.message)); }, 5000 + Math.random() * 5000);
setTimeout(() => { seedKeywords().catch(e => console.warn('[SEO] Keyword seed error:', e.message)); }, 8000 + Math.random() * 5000);
console.log('[SEO] LOADED: Auto-blog generator, keyword tracker (20 keywords), smart 404 handler, search pings, SEO middleware, schema markup, Open Graph auto-tags');
