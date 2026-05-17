// ============================================================
// === REVENUE QUICKSTART — Start Earning Today ===
// ============================================================
// Ad placements, tip/donate jar, featured listings, paywall,
// marketplace commissions, SMS revenue, affiliate links,
// sponsored content, premium subscriptions

const REV_MIGRATIONS = [
  // Ad placements
  `CREATE TABLE IF NOT EXISTS ad_placements (
    id SERIAL PRIMARY KEY, position TEXT NOT NULL, type TEXT DEFAULT 'banner',
    content_html TEXT, link_url TEXT, image_url TEXT, advertiser TEXT,
    impressions INTEGER DEFAULT 0, clicks INTEGER DEFAULT 0,
    cpm_rate NUMERIC DEFAULT 500, cpc_rate NUMERIC DEFAULT 100,
    is_active BOOLEAN DEFAULT true, start_date DATE, end_date DATE,
    tenant_id INTEGER, created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  // Tip/donations
  `CREATE TABLE IF NOT EXISTS tips (
    id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
    from_name TEXT, from_email TEXT, from_phone TEXT,
    amount INTEGER NOT NULL, currency TEXT DEFAULT 'UGX',
    method TEXT DEFAULT 'momo', status TEXT DEFAULT 'pending',
    message TEXT, reference TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  // Sponsored content
  `CREATE TABLE IF NOT EXISTS sponsored_posts (
    id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
    title TEXT NOT NULL, content TEXT NOT NULL, image_url TEXT,
    link_url TEXT, category TEXT DEFAULT 'news',
    budget INTEGER DEFAULT 0, spent INTEGER DEFAULT 0,
    impressions INTEGER DEFAULT 0, clicks INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true, start_date DATE, end_date DATE,
    approved BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  // Marketplace commissions
  `CREATE TABLE IF NOT EXISTS platform_commissions (
    id SERIAL PRIMARY KEY, order_id INTEGER, tenant_id INTEGER,
    order_amount INTEGER NOT NULL, commission_rate NUMERIC DEFAULT 5.0,
    commission_amount INTEGER NOT NULL, currency TEXT DEFAULT 'UGX',
    status TEXT DEFAULT 'pending', paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  // SMS revenue
  `CREATE TABLE IF NOT EXISTS sms_revenue (
    id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
    sms_count INTEGER DEFAULT 0, cost_per_sms INTEGER DEFAULT 50,
    total_cost INTEGER DEFAULT 0, currency TEXT DEFAULT 'UGX',
    date DATE DEFAULT CURRENT_DATE, created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  // Paid content / paywall
  `CREATE TABLE IF NOT EXISTS premium_content (
    id SERIAL PRIMARY KEY, title TEXT NOT NULL, excerpt TEXT,
    full_content TEXT, category TEXT, image_url TEXT,
    price INTEGER DEFAULT 500, currency TEXT DEFAULT 'UGX',
    views INTEGER DEFAULT 0, purchases INTEGER DEFAULT 0,
    is_published BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS content_purchases (
    id SERIAL PRIMARY KEY, content_id INTEGER REFERENCES premium_content(id),
    buyer_email TEXT NOT NULL, buyer_name TEXT,
    amount INTEGER NOT NULL, method TEXT DEFAULT 'momo',
    reference TEXT, status TEXT DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  // Affiliate revenue
  `CREATE TABLE IF NOT EXISTS affiliate_revenue (
    id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
    affiliate_id INTEGER REFERENCES affiliate_links(id),
    program TEXT DEFAULT 'generic', product_name TEXT,
    commission INTEGER NOT NULL, currency TEXT DEFAULT 'UGX',
    status TEXT DEFAULT 'pending', paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  // Service packages (sell services)
  `CREATE TABLE IF NOT EXISTS service_packages (
    id SERIAL PRIMARY KEY, name TEXT NOT NULL, description TEXT,
    price INTEGER NOT NULL, currency TEXT DEFAULT 'UGX',
    features TEXT[], duration_days INTEGER DEFAULT 30,
    is_active BOOLEAN DEFAULT true, sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS service_purchases (
    id SERIAL PRIMARY KEY, package_id INTEGER REFERENCES service_packages(id),
    buyer_email TEXT NOT NULL, buyer_name TEXT, buyer_phone TEXT,
    tenant_id INTEGER, amount INTEGER NOT NULL, method TEXT,
    reference TEXT, status TEXT DEFAULT 'pending',
    activated_at TIMESTAMPTZ, expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
];
REV_MIGRATIONS.forEach(m => migrations.push(m));
['ad_placements','tips','sponsored_posts','platform_commissions','sms_revenue',
 'premium_content','content_purchases','affiliate_revenue','service_packages','service_purchases'
].forEach(t => VALID_TABLES.add(t));

// ============================================================
// === DEFAULT AD PLACEMENTS (auto-create) ===
// ============================================================
async function seedDefaultAds() {
  const defaults = [
    { position: 'discover_top', type: 'banner', advertiser: 'Comfort Zone', content_html: '<div style="text-align:center;padding:16px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:white;border-radius:12px"><h3 style="margin:0 0 4px">Manage Everything from One Platform</h3><p style="opacity:0.9;margin:0 0 8px;font-size:13px">Schools, Churches, Businesses, Clinics</p><a href="/register" style="background:white;color:#6366f1;padding:8px 20px;border-radius:6px;text-decoration:none;font-weight:600">Get Started Free</a></div>' },
    { position: 'discover_sidebar_1', type: 'sidebar', advertiser: 'Comfort Zone', content_html: '<div style="padding:16px;background:#fffbeb;border:1px solid #fde68a;border-radius:12px;text-align:center"><p style="font-weight:600;color:#92400e">Need a School System?</p><p style="font-size:12px;color:#92400e;margin:4px 0 8px">Complete school management — free to start</p><a href="/register" style="display:block;background:#f59e0b;color:white;padding:6px 16px;border-radius:6px;text-decoration:none;font-size:13px">Try Free</a></div>' },
    { position: 'jobs_top', type: 'banner', advertiser: 'Comfort Zone', content_html: '<div style="text-align:center;padding:16px;background:linear-gradient(135deg,#10b981,#059669);color:white;border-radius:12px"><h3 style="margin:0 0 4px">Looking for Staff?</h3><p style="opacity:0.9;margin:0 0 8px;font-size:13px">Post jobs and find talent fast</p><a href="/register" style="background:white;color:#10b981;padding:8px 20px;border-radius:6px;text-decoration:none;font-weight:600">Post a Job</a></div>' },
    { position: 'opportunities_top', type: 'banner', advertiser: 'Comfort Zone', content_html: '<div style="text-align:center;padding:16px;background:linear-gradient(135deg,#8b5cf6,#7c3aed);color:white;border-radius:12px"><h3 style="margin:0 0 4px">Fund Your Education</h3><p style="opacity:0.9;margin:0 0 8px;font-size:13px">Browse scholarships & grants daily</p><a href="/register" style="background:white;color:#8b5cf6;padding:8px 20px;border-radius:6px;text-decoration:none;font-weight:600">Join Free</a></div>' },
  ];
  for (const ad of defaults) {
    try {
      await pool.query(
        `INSERT INTO ad_placements (position, type, content_html, advertiser, is_active)
         VALUES ($1, $2, $3, $4, true) ON CONFLICT DO NOTHING`,
        [ad.position, ad.type, ad.content_html, ad.advertiser]
      );
    } catch(e) {}
  }
}

// Seed default service packages
async function seedServicePackages() {
  const packages = [
    { name: 'Starter Boost', description: 'Get 1000 SMS credits + priority support + custom branding', price: 50000, features: ['1000 SMS Credits', 'Custom Logo & Branding', 'Priority Email Support', 'Advanced Reports'], duration_days: 30, sort_order: 1 },
    { name: 'Business Pro', description: 'Full platform access + 5000 SMS + WhatsApp integration', price: 150000, features: ['5000 SMS Credits', 'WhatsApp Integration', 'All Premium Features', 'Multi-branch Support', 'API Access', 'Phone Support'], duration_days: 30, sort_order: 2 },
    { name: 'Enterprise', description: 'Unlimited everything + dedicated account manager', price: 500000, features: ['Unlimited SMS', 'All Integrations', 'White-label Options', 'Dedicated Manager', 'Custom Development', 'SLA Guarantee'], duration_days: 30, sort_order: 3 },
    { name: 'ID Card Printing Package', description: 'Generate & print 100 student/staff ID cards', price: 30000, features: ['100 ID Cards', 'Custom Templates', 'QR Code Integration', 'Bulk Generation'], duration_days: 365, sort_order: 4 },
    { name: 'Website Setup', description: 'Get a custom website + domain + SEO setup', price: 200000, features: ['Custom Website', 'Domain Registration', 'SEO Optimization', 'Google Analytics', 'Mobile Responsive'], duration_days: 365, sort_order: 5 },
  ];
  for (const pkg of packages) {
    try {
      await pool.query(
        `INSERT INTO service_packages (name, description, price, features, duration_days, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
        [pkg.name, pkg.description, pkg.price, pkg.features, pkg.duration_days, pkg.sort_order]
      );
    } catch(e) {}
  }
}

// ============================================================
// === ROUTE: Support / Tip Page (MoMo payments) ===
// ============================================================
app.get('/support', ah(async (req, res) => {
  const stats = (await pool.query(`SELECT
    (SELECT COUNT(*) FROM tips WHERE status='completed') as total_tips,
    (SELECT COALESCE(SUM(amount),0) FROM tips WHERE status='completed') as total_raised,
    (SELECT COUNT(DISTINCT from_email) FROM tips WHERE status='completed') as supporters
  `)).rows[0];
  const baseUrl = process.env.BASE_URL || 'https://ssewasswa.onrender.com';
  res.send(`<!DOCTYPE html><html><head><title>Support Comfort Zone</title>
    <meta name="description" content="Support Comfort Zone — the all-in-one management platform for Uganda">
    <meta property="og:title" content="Support Comfort Zone">
    <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui;background:#f8fafc;color:#1e293b}.hero{background:linear-gradient(135deg,#6366f1,#8b5cf6);color:white;padding:60px 24px;text-align:center}.card{background:white;padding:24px;border-radius:12px;border:1px solid #e2e8f0;margin:20px auto;max-width:500px}.btn{display:inline-block;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;cursor:pointer;border:none;font-size:14px}</style>
  </head><body>
    <nav style="background:white;padding:12px 24px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between">
      <a href="/" style="font-weight:700;font-size:18px;color:#6366f1;text-decoration:none">Comfort Zone</a>
      <a href="/discover" style="color:#475569;text-decoration:none;font-size:14px">News</a>
    </nav>
    <div class="hero">
      <h1 style="font-size:32px;margin-bottom:8px">Support Us</h1>
      <p style="font-size:18px;opacity:0.9;max-width:500px;margin:0 auto">Help us keep Comfort Zone free for thousands of organizations across Uganda and East Africa</p>
      <div style="display:flex;justify-content:center;gap:24px;margin-top:24px">
        <div><div style="font-size:28px;font-weight:700">${stats.supporters || 0}</div><div style="opacity:0.8;font-size:14px">Supporters</div></div>
        <div><div style="font-size:28px;font-weight:700">UGX ${(stats.total_raised || 0).toLocaleString()}</div><div style="opacity:0.8;font-size:14px">Raised</div></div>
      </div>
    </div>
    <div class="card">
      <h3 style="margin-bottom:12px">Make a Contribution</h3>
      <p style="color:#64748b;font-size:13px;margin-bottom:16px">Every contribution helps us serve more organizations. Choose an amount below or enter a custom amount.</p>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px">
        <button onclick="setAmount(1000)" class="btn" style="background:#f1f5f9;color:#475569">UGX 1,000</button>
        <button onclick="setAmount(5000)" class="btn" style="background:#f1f5f9;color:#475569">UGX 5,000</button>
        <button onclick="setAmount(10000)" class="btn" style="background:#f1f5f9;color:#475569">UGX 10,000</button>
        <button onclick="setAmount(25000)" class="btn" style="background:#f1f5f9;color:#475569">UGX 25,000</button>
        <button onclick="setAmount(50000)" class="btn" style="background:#f1f5f9;color:#475569">UGX 50,000</button>
        <button onclick="setAmount(100000)" class="btn" style="background:#f1f5f9;color:#475569">UGX 100,000</button>
      </div>
      <form method="POST" action="/support/tip">
        <input type="number" name="amount" id="tipAmount" value="5000" min="1000" required style="width:100%;padding:12px;border:1px solid #e2e8f0;border-radius:8px;font-size:16px;margin-bottom:8px" placeholder="Enter amount (UGX)">
        <input name="phone" type="tel" required placeholder="e.g. 256700000000" style="width:100%;padding:12px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;margin-bottom:8px">
        <input name="name" type="text" placeholder="Your name (optional)" style="width:100%;padding:12px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;margin-bottom:8px">
        <input name="email" type="email" placeholder="Your email (optional)" style="width:100%;padding:12px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;margin-bottom:8px">
        <textarea name="message" placeholder="Leave a message (optional)" rows="2" style="width:100%;padding:12px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;margin-bottom:12px;resize:none"></textarea>
        <button type="submit" class="btn" style="background:#10b981;color:white;width:100%;padding:14px;font-size:16px">Pay with MoMo</button>
      </form>
      <p style="text-align:center;color:#94a3b8;font-size:12px;margin-top:12px">Secure payment via MTN MoMo / Airtel Money</p>
    </div>
    <div class="card">
      <h3 style="margin-bottom:8px">Other Ways to Support</h3>
      <div style="display:flex;flex-direction:column;gap:8px">
        <a href="/register" class="btn" style="background:#6366f1;color:white;text-align:center">Create a Free Account</a>
        <a href="/referrals" class="btn" style="background:#f59e0b;color:white;text-align:center">Refer Friends & Earn</a>
        <a href="/pricing" class="btn" style="background:#8b5cf6;color:white;text-align:center">Upgrade to Premium</a>
      </div>
    </div>
    <script>function setAmount(v){document.getElementById('tipAmount').value=v}</script>
  </body></html>`);
}));

// Process tip/donation
app.post('/support/tip', ah(async (req, res) => {
  try {
    const { amount, phone, name, email, message } = req.body;
    if (!amount || !phone) return res.send('Amount and phone are required');
    const ref = 'TIP-' + Date.now();
    const amt = parseInt(amount);
    // Insert pending tip
    await pool.query(
      `INSERT INTO tips (from_name, from_email, from_phone, amount, method, reference, message, status)
       VALUES ($1, $2, $3, $4, 'momo', $5, $6, 'pending')`,
      [name || '', email || '', phone, amt, ref, message || '']
    );
    // Try MTN MoMo payment
    const payResult = await requestMtnPayment(phone, amt, ref, 'Support Comfort Zone', 'Tip/Donation');
    if (payResult && payResult.link) {
      res.redirect(payResult.link);
    } else {
      // Fallback: show instructions
      res.send(`<div style="text-align:center;padding:60px;font-family:system-ui">
        <h1>Thank You! 🎉</h1>
        <p>To complete your UGX ${amt.toLocaleString()} contribution:</p>
        <div style="background:#f1f5f9;padding:20px;border-radius:12px;max-width:400px;margin:20px auto;text-align:left">
          <p><strong>1.</strong> Open MoMo on your phone</p>
          <p><strong>2.</strong> Select "Send Money"</p>
          <p><strong>3.</strong> Enter phone: <strong>256700000000</strong></p>
          <p><strong>4.</strong> Amount: <strong>UGX ${amt.toLocaleString()}</strong></p>
          <p><strong>5.</strong> Reference: <strong>${ref}</strong></p>
        </div>
        <p style="color:#64748b">Your support means the world to us!</p>
        <a href="/" style="color:#6366f1">Back to Home</a>
      </div>`);
    }
  } catch(e) {
    res.send(`<div style="text-align:center;padding:60px"><h2>Something went wrong</h2><p>${esc(e.message)}</p><a href="/support">Try Again</a></div>`);
  }
}));

// ============================================================
// === ROUTE: Services / Pricing Page ===
// ============================================================
app.get('/pricing', ah(async (req, res) => {
  const packages = (await pool.query('SELECT * FROM service_packages WHERE is_active = true ORDER BY sort_order')).rows;
  const baseUrl = process.env.BASE_URL || 'https://ssewasswa.onrender.com';
  const pkgCards = packages.map((pkg, i) => {
    const isPopular = pkg.name === 'Business Pro';
    return `<div style="background:${isPopular ? 'linear-gradient(135deg,#6366f1,#8b5cf6);color:white' : 'white'};padding:28px;border-radius:16px;border:${isPopular ? 'none' : '1px solid #e2e8f0'};position:relative;${isPopular ? 'transform:scale(1.03);box-shadow:0 20px 40px rgba(99,102,241,0.3)' : ''}">
      ${isPopular ? '<div style="position:absolute;top:-12px;left:50%;transform:translateX(-50%);background:#f59e0b;color:white;padding:4px 16px;border-radius:20px;font-size:12px;font-weight:600">MOST POPULAR</div>' : ''}
      <h3 style="font-size:20px;margin-bottom:4px">${esc(pkg.name)}</h3>
      <p style="font-size:13px;${isPopular ? 'opacity:0.8' : 'color:#64748b'};margin-bottom:16px">${esc(pkg.description)}</p>
      <div style="margin-bottom:16px"><span style="font-size:36px;font-weight:700">UGX ${pkg.price.toLocaleString()}</span><span style="font-size:14px;${isPopular ? 'opacity:0.7' : 'color:#94a3b8'}">/${pkg.duration_days >= 365 ? 'year' : 'month'}</span></div>
      <ul style="list-style:none;padding:0;margin:0 0 20px">
        ${(pkg.features || []).map(f => `<li style="padding:6px 0;font-size:14px;${isPopular ? 'opacity:0.9' : 'color:#475569'}">&#10003; ${esc(f)}</li>`).join('')}
      </ul>
      <form method="POST" action="/pricing/buy">
        <input type="hidden" name="package_id" value="${pkg.id}">
        <input name="phone" type="tel" required placeholder="Phone (256...)" style="width:100%;padding:10px;border:${isPopular ? '2px solid rgba(255,255,255,0.3)' : '1px solid #e2e8f0'};border-radius:8px;margin-bottom:8px;font-size:14px;${isPopular ? 'background:rgba(255,255,255,0.1);color:white' : ''}">
        <input name="email" type="email" required placeholder="Email" style="width:100%;padding:10px;border:${isPopular ? '2px solid rgba(255,255,255,0.3)' : '1px solid #e2e8f0'};border-radius:8px;margin-bottom:8px;font-size:14px;${isPopular ? 'background:rgba(255,255,255,0.1);color:white' : ''}">
        <button type="submit" style="width:100%;padding:12px;border-radius:8px;font-weight:600;cursor:pointer;border:none;font-size:15px;background:${isPopular ? 'white' : '#6366f1'};color:${isPopular ? '#6366f1' : 'white'}">Get Started</button>
      </form>
    </div>`;
  }).join('');
  res.send(`<!DOCTYPE html><html><head><title>Pricing — Comfort Zone</title>
    <meta name="description" content="Affordable management platform pricing for Uganda. Plans from UGX 50,000/month.">
    <meta name="robots" content="index, follow">
    <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui;background:#f8fafc;color:#1e293b}</style>
  </head><body>
    <nav style="background:white;padding:12px 24px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between">
      <a href="/" style="font-weight:700;font-size:18px;color:#6366f1;text-decoration:none">Comfort Zone</a>
      <a href="/register" style="background:#6366f1;color:white;padding:8px 16px;border-radius:8px;text-decoration:none;font-size:14px">Start Free</a>
    </nav>
    <div style="text-align:center;padding:48px 24px">
      <h1 style="font-size:36px;margin-bottom:8px">Simple, Transparent Pricing</h1>
      <p style="color:#64748b;font-size:18px;max-width:500px;margin:0 auto">Free to start. Pay only when you need more power.</p>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px;max-width:1100px;margin:0 auto;padding:0 24px 48px">
      ${pkgCards}
    </div>
    <div style="text-align:center;padding:20px;background:#fffbeb;border-top:1px solid #fde68a;border-bottom:1px solid #fde68a">
      <p style="color:#92400e"><strong>Need a custom package?</strong> Contact us at <a href="mailto:support@comfortzone.ug" style="color:#6366f1">support@comfortzone.ug</a></p>
    </div>
  </body></html>`);
}));

// Purchase a package
app.post('/pricing/buy', ah(async (req, res) => {
  try {
    const { package_id, phone, email } = req.body;
    const pkg = (await pool.query('SELECT * FROM service_packages WHERE id = $1', [package_id])).rows[0];
    if (!pkg) return res.redirect('/pricing');
    const ref = 'PKG-' + Date.now();
    await pool.query(
      `INSERT INTO service_purchases (package_id, buyer_email, buyer_name, buyer_phone, amount, method, reference, status)
       VALUES ($1, $2, '', $3, $4, 'momo', $5, 'pending')`,
      [pkg.id, email, phone, pkg.price, ref]
    );
    const payResult = await requestMtnPayment(phone, pkg.price, ref, pkg.name, 'Service Package');
    if (payResult && payResult.link) {
      res.redirect(payResult.link);
    } else {
      res.send(`<div style="text-align:center;padding:60px;font-family:system-ui">
        <h1>Processing ${esc(pkg.name)}</h1>
        <p>Complete payment of UGX ${pkg.price.toLocaleString()}</p>
        <div style="background:#f1f5f9;padding:20px;border-radius:12px;max-width:400px;margin:20px auto;text-align:left">
          <p><strong>MoMo Payment Instructions:</strong></p>
          <p>1. Open MoMo</p><p>2. Send <strong>UGX ${pkg.price.toLocaleString()}</strong></p>
          <p>3. Reference: <strong>${ref}</strong></p>
        </div>
        <a href="/" style="color:#6366f1">Back to Home</a>
      </div>`);
    }
  } catch(e) {
    res.send(`<div style="text-align:center;padding:60px"><h2>Payment Error</h2><p>${esc(e.message)}</p><a href="/pricing">Try Again</a></div>`);
  }
}));

// ============================================================
// === ROUTE: Advertise With Us ===
// ============================================================
app.get('/advertise', ah(async (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Advertise — Comfort Zone</title>
    <meta name="description" content="Advertise your business to thousands of Ugandan users on Comfort Zone. Affordable rates.">
    <meta name="robots" content="index, follow">
    <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui;background:#f8fafc;color:#1e293b}.card{background:white;padding:24px;border-radius:12px;border:1px solid #e2e8f0;margin-bottom:16px}.btn{display:inline-block;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;cursor:pointer;border:none;font-size:14px}</style>
  </head><body>
    <nav style="background:white;padding:12px 24px;border-bottom:1px solid #e2e8f0">
      <a href="/" style="font-weight:700;font-size:18px;color:#6366f1;text-decoration:none">Comfort Zone</a>
    </nav>
    <div style="background:linear-gradient(135deg,#f59e0b,#d97706);color:white;padding:60px 24px;text-align:center">
      <h1 style="font-size:32px">Advertise With Us</h1>
      <p style="font-size:18px;opacity:0.9;max-width:500px;margin:8px auto 0">Reach thousands of Ugandan professionals, students, and business owners daily</p>
    </div>
    <div style="max-width:800px;margin:0 auto;padding:24px">
      <h2 style="margin-bottom:16px">Why Advertise on Comfort Zone?</h2>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:16px;margin-bottom:24px">
        <div class="card"><h3 style="color:#6366f1">Thousands of Daily Visitors</h3><p style="color:#64748b;font-size:14px;margin-top:4px">Our news hub, job board, and tools attract users from across Uganda</p></div>
        <div class="card"><h3 style="color:#10b981">Targeted Audience</h3><p style="color:#64748b;font-size:14px;margin-top:4px">Reach students, teachers, business owners, church leaders, health workers</p></div>
        <div class="card"><h3 style="color:#f59e0b">Affordable Rates</h3><p style="color:#64748b;font-size:14px;margin-top:4px">Starting from UGX 50,000/month for banner ads</p></div>
        <div class="card"><h3 style="color:#ef4444">Real Analytics</h3><p style="color:#64748b;font-size:14px;margin-top:4px">Track impressions, clicks, and conversions in real-time</p></div>
      </div>
      <h2 style="margin-bottom:16px">Ad Packages</h2>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:24px">
        <div class="card" style="text-align:center">
          <h3>Banner Ad</h3>
          <div style="font-size:28px;font-weight:700;color:#6366f1;margin:8px 0">UGX 50K</div>
          <p style="color:#94a3b8;font-size:13px">per month</p>
          <ul style="list-style:none;padding:0;margin:12px 0;text-align:left;font-size:13px;color:#475569">
            <li>One banner placement</li><li>Up to 10,000 impressions</li><li>Click tracking</li><li>Basic analytics</li>
          </ul>
          <a href="/register" class="btn" style="background:#6366f1;color:white;width:100%;display:block;text-align:center">Get Started</a>
        </div>
        <div class="card" style="text-align:center;border:2px solid #6366f1">
          <h3>Sponsored Post</h3>
          <div style="font-size:28px;font-weight:700;color:#6366f1;margin:8px 0">UGX 100K</div>
          <p style="color:#94a3b8;font-size:13px">per post</p>
          <ul style="list-style:none;padding:0;margin:12px 0;text-align:left;font-size:13px;color:#475569">
            <li>Featured in news feed</li><li>Custom image & text</li><li>Click & conversion tracking</li><li>7-day placement</li>
          </ul>
          <a href="/register" class="btn" style="background:#6366f1;color:white;width:100%;display:block;text-align:center">Get Started</a>
        </div>
        <div class="card" style="text-align:center">
          <h3>Premium Spotlight</h3>
          <div style="font-size:28px;font-weight:700;color:#6366f1;margin:8px 0">UGX 250K</div>
          <p style="color:#94a3b8;font-size:13px">per month</p>
          <ul style="list-style:none;padding:0;margin:12px 0;text-align:left;font-size:13px;color:#475569">
            <li>All banner placements</li><li>2 sponsored posts/month</li><li>Featured job listing</li><li>Full analytics dashboard</li>
          </ul>
          <a href="/register" class="btn" style="background:#6366f1;color:white;width:100%;display:block;text-align:center">Get Started</a>
        </div>
      </div>
      <div style="text-align:center;padding:32px;background:#f1f5f9;border-radius:12px">
        <h2>Ready to Grow Your Business?</h2>
        <p style="color:#64748b;margin:8px 0 16px">Create a free account to set up your first ad in minutes</p>
        <a href="/register" class="btn" style="background:#6366f1;color:white;font-size:16px;padding:14px 32px">Create Free Account</a>
      </div>
    </div>
  </body></html>`);
}));

// ============================================================
// === HELPER: Insert ad HTML into any page ===
// ============================================================
async function getAdHtml(position) {
  try {
    const ads = (await pool.query(
      `SELECT content_html FROM ad_placements WHERE position = $1 AND is_active = true
       AND (start_date IS NULL OR start_date <= CURRENT_DATE)
       AND (end_date IS NULL OR end_date >= CURRENT_DATE)
       ORDER BY RANDOM() LIMIT 1`, [position]
    )).rows;
    if (ads.length > 0 && ads[0].content_html) {
      await pool.query('UPDATE ad_placements SET impressions = COALESCE(impressions, 0) + 1 WHERE position = $1', [position]);
      return ads[0].content_html;
    }
  } catch(e) {}
  return '';
}

// Track ad click
app.post('/api/ad/click', ah(async (req, res) => {
  const { position } = req.body;
  try {
    await pool.query('UPDATE ad_placements SET clicks = COALESCE(clicks, 0) + 1 WHERE position = $1 AND is_active = true', [position]);
    res.json({ ok: true });
  } catch(e) { res.json({ ok: true }); }
}));

// ============================================================
// === ADMIN: Revenue Dashboard ===
// ============================================================
app.get('/admin/revenue', requireAuth, requireSuperAdmin, ah(async (req, res) => {
  const [stats, recentTips, recentPurchases, adPerformance, smsRev] = await Promise.all([
    pool.query(`SELECT
      (SELECT COALESCE(SUM(amount),0) FROM tips WHERE status='completed') as tip_revenue,
      (SELECT COALESCE(SUM(amount),0) FROM service_purchases WHERE status='completed') as package_revenue,
      (SELECT COALESCE(SUM(amount),0) FROM platform_commissions WHERE status='completed') as commission_revenue,
      (SELECT COALESCE(SUM(total_cost),0) FROM sms_revenue) as sms_revenue,
      (SELECT COUNT(*)) as total_users,
      (SELECT COUNT(*)) as newsletter_subs,
      (SELECT COUNT(*)) as paid_subscriptions,
      (SELECT COALESCE(SUM(impressions),0)) as total_ad_impressions,
      (SELECT COALESCE(SUM(clicks),0)) as total_ad_clicks
    `),
    pool.query('SELECT * FROM tips ORDER BY created_at DESC LIMIT 10'),
    pool.query('SELECT sp.*, s.name as package_name FROM service_purchases sp JOIN service_packages s ON sp.package_id = s.id ORDER BY sp.created_at DESC LIMIT 10'),
    pool.query('SELECT position, impressions, clicks FROM ad_placements ORDER BY impressions DESC LIMIT 10'),
    pool.query('SELECT DATE(date) as date, SUM(total_cost) as revenue FROM sms_revenue GROUP BY DATE(date) ORDER BY date DESC LIMIT 14')
  ]);
  const s = stats.rows[0];
  const totalRevenue = (parseInt(s.tip_revenue) || 0) + (parseInt(s.package_revenue) || 0) + (parseInt(s.commission_revenue) || 0) + (parseInt(s.sms_revenue) || 0);
  const tipRows = recentTips.rows.map(t =>
    `<tr style="border-bottom:1px solid #f1f5f9"><td style="padding:6px;font-size:13px">${esc(t.from_name || 'Anonymous')}</td>
     <td style="padding:6px">UGX ${(t.amount || 0).toLocaleString()}</td>
     <td style="padding:6px"><span style="padding:2px 8px;border-radius:4px;font-size:12px;${t.status === 'completed' ? 'background:#dcfce7;color:#166534' : 'background:#fef3c7;color:#92400e'}">${t.status}</span></td>
     <td style="padding:6px;color:#94a3b8">${t.created_at ? new Date(t.created_at).toLocaleDateString() : ''}</td></tr>`
  ).join('');
  res.send(renderPage('Revenue Dashboard', `
    <div class="hero" style="background:linear-gradient(135deg,#10b981,#059669)"><h1>Revenue Dashboard</h1><p>Track all income streams</p></div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:24px">
      <div class="stat-card"><div class="stat-num" style="color:#10b981">UGX ${totalRevenue.toLocaleString()}</div><div>Total Revenue</div></div>
      <div class="stat-card"><div class="stat-num" style="color:#6366f1">UGX ${(s.tip_revenue || 0).toLocaleString()}</div><div>Tips/Donations</div></div>
      <div class="stat-card"><div class="stat-num" style="color:#f59e0b">UGX ${(s.package_revenue || 0).toLocaleString()}</div><div>Service Sales</div></div>
      <div class="stat-card"><div class="stat-num" style="color:#ef4444">UGX ${(s.sms_revenue || 0).toLocaleString()}</div><div>SMS Revenue</div></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
      <div class="card"><h3>Recent Tips/Donations</h3><table style="width:100%;margin-top:8px"><thead><tr style="border-bottom:2px solid #e2e8f0"><th style="text-align:left;padding:6px">From</th><th>Amount</th><th>Status</th><th>Date</th></tr></thead><tbody>${tipRows || '<tr><td colspan="4" style="padding:12px;text-align:center;color:#94a3b8">No tips yet. Share /support page!</td></tr>'}</tbody></table></div>
      <div class="card"><h3>Ad Performance</h3><table style="width:100%;margin-top:8px"><thead><tr style="border-bottom:2px solid #e2e8f0"><th style="text-align:left;padding:6px">Position</th><th>Impressions</th><th>Clicks</th></tr></thead><tbody>${adPerformance.rows.map(a =>
        `<tr style="border-bottom:1px solid #f1f5f9"><td style="padding:6px;font-size:13px">${esc(a.position)}</td><td style="padding:6px;text-align:center">${a.impressions || 0}</td><td style="padding:6px;text-align:center;font-weight:600">${a.clicks || 0}</td></tr>`
      ).join('')}</tbody></table></div>
    </div>
  `, req.session.user));
}));

// ============================================================
// === PAYMENT CALLBACK: Mark tips & purchases as completed ===
// ============================================================
const origBillingCallback = null; // Don't override existing callback
// Instead, add a dedicated callback for tips and service purchases
app.get('/payment/callback/tip', ah(async (req, res) => {
  const ref = req.query.reference || req.query.tx_ref;
  if (ref) {
    await pool.query("UPDATE tips SET status = 'completed' WHERE reference = $1 AND status = 'pending'", [ref]).catch(() => {});
  }
  res.redirect('/support?thankyou=1');
}));

app.get('/payment/callback/package', ah(async (req, res) => {
  const ref = req.query.reference || req.query.tx_ref;
  if (ref) {
    await pool.query("UPDATE service_purchases SET status = 'completed', activated_at = NOW() WHERE reference = $1 AND status = 'pending'", [ref]).catch(() => {});
  }
  res.redirect('/pricing?thankyou=1');
}));

// ============================================================
// === SCHEDULED: Seed defaults on startup ===
// ============================================================
setTimeout(async () => {
  console.log('[Revenue] Seeding default ads and service packages...');
  try {
    await seedDefaultAds();
    await seedServicePackages();
    console.log('[Revenue] Ads and packages seeded');
  } catch(e) {
    console.error('[Revenue] Seed error:', e.message);
  }
}, 30000);

console.log('[Revenue] Revenue quickstart loaded — tips, pricing, ads, commissions ready');
