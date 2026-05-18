// ============================================================
// PUBLIC NEWSLETTER — Double opt-in, unsubscribe, preferences,
//   admin panel, campaign management, CSV export
// Comfort Platform - Multi-tenant SaaS for African Institutions
// ============================================================
module.exports = function(app, pool, bcrypt, ah, esc, renderPage, audit, sendEmail, queueEmail, logger) {

  const BASE = process.env.BASE_URL || 'https://ssewasswa.onrender.com';
  const YEAR = new Date().getFullYear();

  // === MIGRATIONS ===
  (async () => {
    const migs = [
      `CREATE TABLE IF NOT EXISTS newsletter_subscribers (
        id SERIAL PRIMARY KEY, email VARCHAR(255) UNIQUE NOT NULL, name VARCHAR(255),
        status VARCHAR(20) DEFAULT 'pending', confirm_token VARCHAR(255) UNIQUE,
        source VARCHAR(100) DEFAULT 'website', preferences TEXT[] DEFAULT '{}',
        subscribed_at TIMESTAMPTZ DEFAULT NOW(), confirmed_at TIMESTAMPTZ,
        unsubscribed_at TIMESTAMPTZ, last_opened TIMESTAMPTZ, open_count INT DEFAULT 0,
        ip_address VARCHAR(45)
      )`,
      `CREATE TABLE IF NOT EXISTS newsletter_campaigns (
        id SERIAL PRIMARY KEY, subject VARCHAR(500) NOT NULL, preview_text VARCHAR(500),
        content TEXT NOT NULL, status VARCHAR(20) DEFAULT 'draft',
        recipient_count INT DEFAULT 0, sent_count INT DEFAULT 0, open_count INT DEFAULT 0,
        click_count INT DEFAULT 0, created_by VARCHAR(255),
        created_at TIMESTAMPTZ DEFAULT NOW(), sent_at TIMESTAMPTZ,
        scheduled_at TIMESTAMPTZ
      )`,
      `CREATE TABLE IF NOT EXISTS newsletter_logs (
        id SERIAL PRIMARY KEY, subscriber_id INT REFERENCES newsletter_subscribers(id) ON DELETE SET NULL,
        campaign_id INT REFERENCES newsletter_campaigns(id) ON DELETE SET NULL,
        action VARCHAR(50) NOT NULL, metadata TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_nl_subs_email ON newsletter_subscribers(email)`,
      `CREATE INDEX IF NOT EXISTS idx_nl_subs_status ON newsletter_subscribers(status)`,
      `CREATE INDEX IF NOT EXISTS idx_nl_subs_token ON newsletter_subscribers(confirm_token)`,
      `CREATE INDEX IF NOT EXISTS idx_nl_camp_status ON newsletter_campaigns(status)`
    ];
    for (const sql of migs) { try { await pool.query(sql); } catch(e) {} }
  })();

  // Rate limiting map (in-memory, per IP)
  const rateLimits = {};

  // Shared nav & footer
  const nav = `<nav style="background:white;border-bottom:1px solid #e2e8f0;padding:12px 24px;display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;z-index:100;box-shadow:0 2px 8px rgba(0,0,0,0.04)"><div style="font-size:22px;font-weight:900;color:#4f46e5;cursor:pointer" onclick="location.href='/'">&#9670; Comfort</div><div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap"><a href="/" style="font-size:14px;font-weight:500;color:#475569;text-decoration:none;padding:6px 12px;border-radius:8px">Home</a><a href="/features" style="font-size:14px;font-weight:500;color:#475569;text-decoration:none;padding:6px 12px;border-radius:8px">Features</a><a href="/blog" style="font-size:14px;font-weight:500;color:#475569;text-decoration:none;padding:6px 12px;border-radius:8px">Blog</a><a href="/about" style="font-size:14px;font-weight:500;color:#475569;text-decoration:none;padding:6px 12px;border-radius:8px">About</a><a href="/contact" style="font-size:14px;font-weight:500;color:#475569;text-decoration:none;padding:6px 12px;border-radius:8px">Contact</a><a href="/login" style="font-size:14px;font-weight:500;color:#475569;text-decoration:none;padding:6px 12px;border-radius:8px">Login</a><a href="/register" style="font-size:14px;font-weight:600;color:white;text-decoration:none;padding:8px 20px;border-radius:10px;background:linear-gradient(135deg,#4f46e5,#7c3aed)">Start Free</a></div></nav>`;

  const footer = `<footer style="background:#1e293b;color:white;padding:48px 20px 24px;margin-top:60px"><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:32px;max-width:1200px;margin:0 auto"><div><h4 style="margin-bottom:12px;font-size:15px">&#9670; Comfort</h4><p style="color:#94a3b8;font-size:13px;line-height:1.8">The Operating System for African Institutions. One platform, all your operations.</p></div><div><h4 style="margin-bottom:12px;font-size:15px">Product</h4><a href="/#features" style="color:#94a3b8;font-size:13px;display:block;margin-bottom:6px;text-decoration:none">Features</a><a href="/pricing" style="color:#94a3b8;font-size:13px;display:block;margin-bottom:6px;text-decoration:none">Pricing</a><a href="/blog" style="color:#94a3b8;font-size:13px;display:block;margin-bottom:6px;text-decoration:none">Blog</a></div><div><h4 style="margin-bottom:12px;font-size:15px">Company</h4><a href="/about" style="color:#94a3b8;font-size:13px;display:block;margin-bottom:6px;text-decoration:none">About Us</a><a href="/contact" style="color:#94a3b8;font-size:13px;display:block;margin-bottom:6px;text-decoration:none">Contact</a><a href="/privacy" style="color:#94a3b8;font-size:13px;display:block;margin-bottom:6px;text-decoration:none">Privacy Policy</a><a href="/terms" style="color:#94a3b8;font-size:13px;display:block;margin-bottom:6px;text-decoration:none">Terms of Service</a></div><div><h4 style="margin-bottom:12px;font-size:15px">Connect</h4><a href="https://wa.me/256700000000" style="color:#94a3b8;font-size:13px;display:block;margin-bottom:6px;text-decoration:none">WhatsApp</a><a href="#" style="color:#94a3b8;font-size:13px;display:block;margin-bottom:6px;text-decoration:none">Twitter / X</a><a href="#" style="color:#94a3b8;font-size:13px;display:block;margin-bottom:6px;text-decoration:none">Facebook</a></div></div><div style="text-align:center;margin-top:32px;padding-top:24px;border-top:1px solid #334155;font-size:13px;color:#64748b">&copy; ${YEAR} Comfort Platform. Built with &#9829; in Uganda. All rights reserved.</div></footer>`;

  function nlPage(title, desc, body) {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} &#8212; Comfort</title><meta name="description" content="${esc(desc)}"><link rel="icon" href="/favicon.png"><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;color:#1e293b;line-height:1.6}a{color:#4f46e5;text-decoration:none}a:hover{text-decoration:underline}.btn{display:inline-block;padding:12px 28px;border-radius:10px;font-weight:700;font-size:15px;border:none;cursor:pointer;text-decoration:none;transition:0.3s}.btn:hover{transform:translateY(-1px);box-shadow:0 4px 12px rgba(0,0,0,0.15);text-decoration:none}.btn-primary{background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white}.btn-green{background:linear-gradient(135deg,#059669,#0d9488);color:white}.btn-outline{background:transparent;border:2px solid #e2e8f0;color:#475569}.card{background:white;border-radius:16px;padding:28px;box-shadow:0 2px 12px rgba(0,0,0,0.06);border:1px solid #e2e8f0;margin-bottom:20px}.container{max-width:900px;margin:0 auto;padding:0 20px}h1{font-size:28px;font-weight:900;margin-bottom:8px}h2{font-size:22px;font-weight:700;margin:24px 0 12px}p{color:#475569;font-size:15px;margin-bottom:16px}.admin-table{width:100%;border-collapse:collapse;font-size:14px}.admin-table th,.admin-table td{padding:12px;text-align:left;border-bottom:1px solid #e2e8f0}.admin-table th{font-weight:700;color:#475569;font-size:13px;text-transform:uppercase;background:#f8fafc}.admin-table tr:hover{background:#f8fafc}.badge{display:inline-block;padding:3px 10px;border-radius:8px;font-size:11px;font-weight:700}.badge-green{background:#dcfce7;color:#16a34a}.badge-red{background:#fee2e2;color:#dc2626}.badge-yellow{background:#fef3c7;color:#d97706}.badge-blue{background:#dbeafe;color:#2563eb}.stat-card{text-align:center;padding:24px}.stat-card .num{font-size:36px;font-weight:900;margin-bottom:4px}.stat-card .label{font-size:13px;color:#64748b}</style></head><body>${nav}<div style="padding:40px 20px"><div class="container">${body}</div></div>${footer}</body></html>`;
  }

  // ============================================================
  // PUBLIC SUBSCRIBE (Double Opt-In)
  // ============================================================
  app.post('/newsletter/subscribe', ah(async (req, res) => {
    const ip = req.ip || req.connection?.remoteAddress || '';
    // Rate limit: max 3 subscriptions per IP per hour
    const hour = Math.floor(Date.now() / 3600000);
    const key = ip + ':' + hour;
    rateLimits[key] = (rateLimits[key] || 0) + 1;
    if (rateLimits[key] > 3) {
      return res.status(429).json({ error: 'Too many subscription attempts. Please try again later.' });
    }

    const { email, name } = req.body;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Please provide a valid email address.' });
    }

    const confirmToken = require('crypto').randomBytes(32).toString('hex');

    try {
      // Check if already subscribed
      const existing = (await pool.query('SELECT id, status FROM newsletter_subscribers WHERE email = $1', [email])).rows[0];
      if (existing) {
        if (existing.status === 'active') {
          return res.json({ message: 'You are already subscribed! Thank you.' });
        }
        if (existing.status === 'pending') {
          // Resend confirmation
          await pool.query('UPDATE newsletter_subscribers SET confirm_token = $1, subscribed_at = NOW() WHERE id = $2', [confirmToken, existing.id]);
          await queueEmail(email, 'Confirm your Comfort newsletter subscription',
            `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:30px"><h2 style="color:#4f46e5">Confirm Your Subscription</h2><p>Please click the link below to confirm your email address and start receiving our newsletter.</p><a href="${BASE}/newsletter/confirm?token=${confirmToken}" style="display:inline-block;padding:14px 32px;background:#4f46e5;color:white;border-radius:10px;text-decoration:none;font-weight:700;margin:20px 0">Confirm Subscription</a><p style="color:#94a3b8;font-size:13px">If you did not request this subscription, you can safely ignore this email.</p></div>`);
          return res.json({ message: 'A new confirmation email has been sent. Please check your inbox.' });
        }
        // Previously unsubscribed — re-subscribe
        await pool.query('UPDATE newsletter_subscribers SET status = $1, confirm_token = $2, confirmed_at = NULL, unsubscribed_at = NULL, subscribed_at = NOW() WHERE id = $3', ['pending', confirmToken, existing.id]);
      } else {
        await pool.query('INSERT INTO newsletter_subscribers(email, name, status, confirm_token, source, ip_address) VALUES($1,$2,$3,$4,$5,$6)',
          [email, name || null, 'pending', confirmToken, req.body.source || 'website', ip]);
      }

      // Send confirmation email
      await queueEmail(email, 'Confirm your Comfort newsletter subscription',
        `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:30px"><h2 style="color:#4f46e5">Confirm Your Subscription</h2><p>Thank you for subscribing to the Comfort Platform newsletter! Please click the button below to confirm your email address.</p><a href="${BASE}/newsletter/confirm?token=${confirmToken}" style="display:inline-block;padding:14px 32px;background:#4f46e5;color:white;border-radius:10px;text-decoration:none;font-weight:700;margin:20px 0">Confirm Subscription</a><p style="color:#94a3b8;font-size:13px">If you did not request this subscription, you can safely ignore this email.</p></div>`);

      res.json({ message: 'A confirmation email has been sent to ' + email + '. Please check your inbox!' });
    } catch(e) {
      logger.error('[Newsletter] Subscribe error: ' + e.message);
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  }));

  // ============================================================
  // CONFIRM SUBSCRIPTION
  // ============================================================
  app.get('/newsletter/confirm', ah(async (req, res) => {
    const token = req.query.token;
    if (!token) return res.redirect('/');

    const sub = (await pool.query('SELECT id, email, name FROM newsletter_subscribers WHERE confirm_token = $1', [token])).rows[0];
    if (!sub) {
      return res.send(nlPage('Invalid Link', 'The confirmation link is invalid or has expired.',
        `<div style="text-align:center;padding:60px 0"><div style="font-size:48px;margin-bottom:16px">&#128533;</div><h1>Invalid Link</h1><p>This confirmation link is invalid or has expired.</p><a href="/" class="btn btn-primary" style="margin-top:20px">Go Home</a></div>`));
    }

    await pool.query('UPDATE newsletter_subscribers SET status = $1, confirmed_at = NOW(), confirm_token = NULL WHERE id = $2', ['active', sub.id]);
    await pool.query('INSERT INTO newsletter_logs(subscriber_id, action, metadata) VALUES($1,$2,$3)', [sub.id, 'confirmed', '{}']);

    res.send(nlPage('Subscribed!', 'Your newsletter subscription is confirmed.',
      `<div style="text-align:center;padding:60px 0"><div style="font-size:64px;margin-bottom:16px">&#127881;</div><h1 style="color:#059669">You're In!</h1><p>Thank you${sub.name ? ', <strong>' + esc(sub.name) + '</strong>' : ''}! Your subscription to the Comfort newsletter has been confirmed.</p><p>You will receive our latest updates, tips, and news directly in your inbox.</p><div style="display:flex;gap:12px;justify-content:center;margin-top:24px;flex-wrap:wrap"><a href="/blog" class="btn btn-primary">Read Our Blog</a><a href="/register" class="btn btn-green">Try Comfort Free</a></div></div>`));
  }));

  // ============================================================
  // UNSUBSCRIBE
  // ============================================================
  app.get('/newsletter/unsubscribe', ah(async (req, res) => {
    const token = req.query.token;
    const email = req.query.email;
    if (!email) return res.redirect('/');

    // If token provided, validate it
    if (token) {
      const sub = (await pool.query('SELECT id FROM newsletter_subscribers WHERE confirm_token = $1 AND email = $2', [token, email])).rows[0];
      if (sub) {
        await pool.query("UPDATE newsletter_subscribers SET status = 'unsubscribed', unsubscribed_at = NOW(), confirm_token = NULL WHERE id = $1", [sub.id]);
        await pool.query('INSERT INTO newsletter_logs(subscriber_id, action, metadata) VALUES($1,$2,$3)', [sub.id, 'unsubscribed', '{}']);
      }
    } else {
      // Direct unsubscribe by email (from mail header link)
      await pool.query("UPDATE newsletter_subscribers SET status = 'unsubscribed', unsubscribed_at = NOW() WHERE email = $1 AND status = 'active'", [email]);
    }

    res.send(nlPage('Unsubscribed', 'You have been unsubscribed from our newsletter.',
      `<div style="text-align:center;padding:60px 0"><div style="font-size:48px;margin-bottom:16px">&#128546;</div><h1>You've Been Unsubscribed</h1><p>We're sorry to see you go. You will no longer receive emails from Comfort Platform.</p><p>If this was a mistake, you can <a href="/">re-subscribe</a> at any time.</p><a href="/" class="btn btn-outline" style="margin-top:20px">Return to Home</a></div>`));
  }));

  // ============================================================
  // NEWSLETTER PREFERENCES
  // ============================================================
  app.get('/newsletter/preferences', ah(async (req, res) => {
    const token = req.query.token;
    if (!token) return res.redirect('/');
    const sub = (await pool.query('SELECT id, email, name, preferences FROM newsletter_subscribers WHERE confirm_token = $1', [token])).rows[0];
    if (!sub) return res.redirect('/');

    res.send(nlPage('Newsletter Preferences', 'Manage your email preferences.',
      `<div style="max-width:500px;margin:0 auto;padding:40px 0"><h1 style="text-align:center">Email Preferences</h1><p style="text-align:center;color:#64748b">Manage what you receive from Comfort Platform.</p><div class="card"><form method="POST" action="/newsletter/preferences"><input type="hidden" name="token" value="${esc(token)}"><div style="margin-bottom:20px"><label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:15px;font-weight:500"><input type="checkbox" name="pref_product_updates" ${(sub.preferences||[]).includes('product_updates')?'checked':''}> Product Updates &amp; New Features</label></div><div style="margin-bottom:20px"><label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:15px;font-weight:500"><input type="checkbox" name="pref_tips" ${(sub.preferences||[]).includes('tips')?'checked':''}> Tips &amp; How-To Guides</label></div><div style="margin-bottom:20px"><label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:15px;font-weight:500"><input type="checkbox" name="pref_promotions" ${(sub.preferences||[]).includes('promotions')?'checked':''}> Promotions &amp; Offers</label></div><div style="margin-bottom:20px"><label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:15px;font-weight:500"><input type="checkbox" name="pref_blog" ${(sub.preferences||[]).includes('blog')?'checked':''}> Blog Digest (weekly)</label></div><div style="display:flex;gap:12px;margin-top:24px"><button type="submit" class="btn btn-primary">Save Preferences</button><a href="/newsletter/unsubscribe?token=${esc(token)}&email=${esc(sub.email)}" style="display:inline-block;padding:12px 28px;color:#dc2626;font-size:14px;font-weight:600;text-decoration:none;align-self:center">Unsubscribe</a></div></form></div></div>`));
  }));

  app.post('/newsletter/preferences', ah(async (req, res) => {
    const token = req.body.token;
    if (!token) return res.redirect('/');
    const sub = (await pool.query('SELECT id FROM newsletter_subscribers WHERE confirm_token = $1', [token])).rows[0];
    if (!sub) return res.redirect('/');

    const prefs = [];
    if (req.body.pref_product_updates) prefs.push('product_updates');
    if (req.body.pref_tips) prefs.push('tips');
    if (req.body.pref_promotions) prefs.push('promotions');
    if (req.body.pref_blog) prefs.push('blog');

    await pool.query('UPDATE newsletter_subscribers SET preferences = $1 WHERE id = $2', [prefs, sub.id]);
    res.send(nlPage('Preferences Saved', 'Your email preferences have been updated.',
      `<div style="text-align:center;padding:60px 0"><div style="font-size:48px;margin-bottom:16px">&#9989;</div><h1>Preferences Saved</h1><p>Your email preferences have been updated successfully.</p><a href="/" class="btn btn-primary" style="margin-top:20px">Return to Home</a></div>`));
  }));

  // ============================================================
  // ADMIN DASHBOARD
  // ============================================================
  app.get('/newsletter/admin', ah(async (req, res) => {
    if (!req.session || !req.session.user) return res.redirect('/login');
    const [stats, recent, campaigns] = await Promise.all([
      pool.query(`SELECT
        COUNT(*) FILTER (WHERE status='active')::int AS active,
        COUNT(*) FILTER (WHERE status='pending')::int AS pending,
        COUNT(*) FILTER (WHERE status='unsubscribed')::int AS unsubscribed,
        COUNT(*)::int AS total,
        SUM(open_count)::int AS total_opens
      FROM newsletter_subscribers`),
      pool.query('SELECT email, name, status, subscribed_at, confirmed_at FROM newsletter_subscribers ORDER BY subscribed_at DESC LIMIT 10'),
      pool.query('SELECT id, subject, status, recipient_count, sent_count, open_count, created_at, sent_at FROM newsletter_campaigns ORDER BY created_at DESC LIMIT 5')
    ]);
    const s = stats.rows[0];
    res.send(nlPage('Newsletter Admin', 'Manage newsletter subscribers and campaigns.',
      `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;flex-wrap:wrap;gap:12px"><h1>Newsletter Admin</h1><div style="display:flex;gap:12px"><a href="/newsletter/admin/campaign/new" class="btn btn-primary">+ New Campaign</a><a href="/newsletter/admin/export" class="btn btn-outline">&#128190; Export CSV</a></div></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:16px;margin-bottom:24px">
        <div class="card stat-card"><div class="num" style="color:#4f46e5">${s.total||0}</div><div class="label">Total Subscribers</div></div>
        <div class="card stat-card"><div class="num" style="color:#16a34a">${s.active||0}</div><div class="label">Active</div></div>
        <div class="card stat-card"><div class="num" style="color:#d97706">${s.pending||0}</div><div class="label">Pending</div></div>
        <div class="card stat-card"><div class="num" style="color:#dc2626">${s.unsubscribed||0}</div><div class="label">Unsubscribed</div></div>
        <div class="card stat-card"><div class="num" style="color:#2563eb">${s.total_opens||0}</div><div class="label">Total Opens</div></div>
      </div>
      <div class="card" style="overflow-x:auto"><h2 style="margin-top:0">Recent Subscribers</h2><table class="admin-table"><thead><tr><th>Email</th><th>Name</th><th>Status</th><th>Subscribed</th></tr></thead><tbody>${recent.rows.map(r => `<tr><td>${esc(r.email)}</td><td>${esc(r.name||'—')}</td><td><span class="badge badge-${r.status==='active'?'green':r.status==='pending'?'yellow':'red'}">${r.status}</span></td><td>${r.subscribed_at?new Date(r.subscribed_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'—'}</td></tr>`).join('')}</tbody></table></div>
      ${campaigns.rows.length > 0 ? `<div class="card" style="overflow-x:auto"><h2>Recent Campaigns</h2><table class="admin-table"><thead><tr><th>Subject</th><th>Status</th><th>Sent</th><th>Opens</th><th>Date</th></tr></thead><tbody>${campaigns.rows.map(c => `<tr><td>${esc(c.subject.substring(0,50))}</td><td><span class="badge badge-${c.status==='sent'?'green':c.status==='draft'?'yellow':'blue'}">${c.status}</span></td><td>${c.sent_count}/${c.recipient_count}</td><td>${c.open_count||0}</td><td>${c.sent_at?new Date(c.sent_at).toLocaleDateString('en-US',{month:'short',day:'numeric'}):'—'}</td></tr>`).join('')}</tbody></table></div>` : ''}`));
  }));

  // ============================================================
  // ADMIN: NEW CAMPAIGN
  // ============================================================
  app.get('/newsletter/admin/campaign/new', ah(async (req, res) => {
    if (!req.session || !req.session.user) return res.redirect('/login');
    const activeCount = (await pool.query("SELECT COUNT(*)::int AS n FROM newsletter_subscribers WHERE status='active'")).rows[0].n;
    res.send(nlPage('New Campaign', 'Create a new newsletter campaign.',
      `<div style="max-width:700px;margin:0 auto"><h1>New Campaign</h1><p style="color:#64748b">This email will be sent to <strong>${activeCount}</strong> active subscribers.</p><div class="card"><form method="POST" action="/newsletter/admin/campaign/new">
        <label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Subject Line *</label>
        <input name="subject" required style="width:100%;padding:12px;border:2px solid #e2e8f0;border-radius:10px;font-size:15px;margin-bottom:12px" placeholder="e.g. What's New at Comfort This Month">
        <label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Preview Text</label>
        <input name="preview_text" style="width:100%;padding:12px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;margin-bottom:12px" placeholder="Brief preview shown in inbox...">
        <label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Content (HTML) *</label>
        <textarea name="content" rows="14" required style="width:100%;padding:12px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;font-family:monospace;margin-bottom:12px" placeholder="<h2>Heading</h2><p>Your content here...</p>"></textarea>
        <div style="display:flex;gap:12px"><button type="submit" name="action" value="send" class="btn btn-primary" onclick="return confirm('Send to ${activeCount} subscribers?')">Send Now</button><button type="submit" name="action" value="draft" class="btn btn-outline">Save as Draft</button><a href="/newsletter/admin" class="btn btn-outline">Cancel</a></div>
      </form></div></div>`));
  }));

  app.post('/newsletter/admin/campaign/new', ah(async (req, res) => {
    if (!req.session || !req.session.user) return res.redirect('/login');
    const { subject, preview_text, content, action } = req.body;
    if (!subject || !content) return res.send('Subject and content required');

    const status = action === 'send' ? 'sending' : 'draft';
    const result = await pool.query('INSERT INTO newsletter_campaigns(subject, preview_text, content, status, created_by) VALUES($1,$2,$3,$4,$5) RETURNING id',
      [subject, preview_text || null, content, status, req.session.user.email || 'admin']);
    const campaignId = result.rows[0].id;

    if (action === 'send') {
      // Send to active subscribers in background
      setImmediate(async () => {
        try {
          const subs = (await pool.query("SELECT id, email, name, confirm_token FROM newsletter_subscribers WHERE status='active'")).rows;
          await pool.query('UPDATE newsletter_campaigns SET recipient_count = $1 WHERE id = $2', [subs.length, campaignId]);

          // Generate unsubscribe tokens for subscribers who don't have one
          for (const sub of subs) {
            if (!sub.confirm_token) {
              const token = require('crypto').randomBytes(32).toString('hex');
              await pool.query('UPDATE newsletter_subscribers SET confirm_token = $1 WHERE id = $2', [token, sub.id]);
              sub.confirm_token = token;
            }
          }

          let sentCount = 0;
          for (const sub of subs) {
            try {
              const unsubLink = `${BASE}/newsletter/unsubscribe?token=${sub.confirm_token}&email=${encodeURIComponent(sub.email)}`;
              const prefLink = `${BASE}/newsletter/preferences?token=${sub.confirm_token}`;
              const htmlBody = content +
                `<hr style="border:none;border-top:1px solid #e2e8f0;margin:32px 0"><p style="font-size:12px;color:#94a3b8;text-align:center">You received this because you subscribed to Comfort Platform newsletter.</p><p style="font-size:12px;text-align:center"><a href="${unsubLink}" style="color:#dc2626">Unsubscribe</a> | <a href="${prefLink}" style="color:#64748b">Preferences</a></p>`;

              await queueEmail(sub.email, subject, htmlBody);
              sentCount++;
              await pool.query('INSERT INTO newsletter_logs(subscriber_id, campaign_id, action, metadata) VALUES($1,$2,$3,$4)',
                [sub.id, campaignId, 'sent', '{"email":"' + sub.email + '"}']);
            } catch(e) {
              logger.error('[Newsletter] Failed to send to ' + sub.email + ': ' + e.message);
            }
          }

          await pool.query("UPDATE newsletter_campaigns SET status = 'sent', sent_count = $1, sent_at = NOW() WHERE id = $2", [sentCount, campaignId]);
          logger.info('[Newsletter] Campaign ' + campaignId + ' sent to ' + sentCount + ' subscribers');
        } catch(e) {
          logger.error('[Newsletter] Campaign send error: ' + e.message);
          await pool.query("UPDATE newsletter_campaigns SET status = 'failed' WHERE id = $1", [campaignId]);
        }
      });
      res.redirect('/newsletter/admin');
    } else {
      res.redirect('/newsletter/admin');
    }
  }));

  // ============================================================
  // ADMIN: EXPORT CSV
  // ============================================================
  app.get('/newsletter/admin/export', ah(async (req, res) => {
    if (!req.session || !req.session.user) return res.redirect('/login');
    const subs = (await pool.query('SELECT email, name, status, preferences, subscribed_at, confirmed_at, unsubscribed_at, open_count FROM newsletter_subscribers ORDER BY subscribed_at DESC')).rows;
    const header = 'Email,Name,Status,Preferences,Subscribed At,Confirmed At,Unsubscribed At,Open Count';
    const rows = subs.map(s => [
      s.email, s.name || '', s.status,
      (s.preferences || []).join(';'),
      s.subscribed_at || '', s.confirmed_at || '', s.unsubscribed_at || '', s.open_count || 0
    ].map(v => '"' + String(v).replace(/"/g, '""') + '"').join(','));
    const csv = [header, ...rows].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=newsletter-subscribers-' + new Date().toISOString().split('T')[0] + '.csv');
    res.send(csv);
  }));

  // ============================================================
  // NEWSLETTER EMBED FORM (for use in other pages)
  // ============================================================
  app.get('/newsletter/embed', (req, res) => {
    res.type('html').send(`<!-- Comfort Newsletter Embed Form -->
<div id="comfort-newsletter-form" style="background:linear-gradient(135deg,#4f46e5,#7c3aed);border-radius:16px;padding:32px;text-align:center;color:white;max-width:500px;margin:20px auto">
  <h3 style="color:white;margin-bottom:4px;font-size:20px">Stay Updated</h3>
  <p style="color:rgba(255,255,255,0.85);font-size:14px;margin-bottom:16px">Get the latest tips, features, and news from Comfort Platform.</p>
  <form id="nl-embed-form" onsubmit="return nlSubscribe(event)">
    <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center">
      <input type="email" id="nl-embed-email" placeholder="Enter your email" required style="flex:1;min-width:200px;padding:12px 16px;border:none;border-radius:10px;font-size:14px;outline:none">
      <button type="submit" style="padding:12px 24px;background:#059669;color:white;border:none;border-radius:10px;font-weight:700;font-size:14px;cursor:pointer">Subscribe</button>
    </div>
  </form>
  <div id="nl-embed-msg" style="margin-top:12px;font-size:13px"></div>
</div>
<script>
function nlSubscribe(e){e.preventDefault();var email=document.getElementById('nl-embed-email').value;var msg=document.getElementById('nl-embed-msg');msg.textContent='Subscribing...';msg.style.color='rgba(255,255,255,0.9)';fetch('/newsletter/subscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:email})}).then(function(r){return r.json()}).then(function(d){msg.textContent=d.message||d.error;msg.style.color=d.error?'#fca5a5':'#86efac'}).catch(function(){msg.textContent='Something went wrong. Please try again.';msg.style.color='#fca5a5'});return false;}
</script>`);
  });

  console.log('[PublicNewsletter] Newsletter system loaded');
};
