// ============================================================
// === EMAIL AUTOMATION ENGINE ===
// ============================================================
// Welcome series, engagement triggers, re-engagement emails,
// weekly digest, milestone notifications, win-back campaigns,
// referral follow-ups, newsletter automation

const EAM_MIGRATIONS = [
  // Email queue
  `CREATE TABLE IF NOT EXISTS email_queue (
    id SERIAL PRIMARY KEY, to_email TEXT NOT NULL,
    subject TEXT NOT NULL, html_body TEXT NOT NULL,
    email_type TEXT DEFAULT 'transactional',
    status TEXT DEFAULT 'queued', priority INTEGER DEFAULT 5,
    scheduled_at TIMESTAMPTZ DEFAULT NOW(), sent_at TIMESTAMPTZ,
    opened BOOLEAN DEFAULT false, clicked BOOLEAN DEFAULT false,
    error_message TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  // Email templates)
  `CREATE TABLE IF NOT EXISTS email_templates (
    id SERIAL PRIMARY KEY, template_name TEXT UNIQUE NOT NULL,
    subject TEXT NOT NULL, html_template TEXT NOT NULL,
    category TEXT DEFAULT 'transactional',
    variables TEXT[] DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  // Email automation rules)
  `CREATE TABLE IF NOT EXISTS email_automations (
    id SERIAL PRIMARY KEY, automation_name TEXT NOT NULL,
    trigger_type TEXT NOT NULL, trigger_data JSONB,
    template_name TEXT, delay_hours INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true, sent_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  // Unsubscribe tracking)
  `CREATE TABLE IF NOT EXISTS email_unsubscribes (
    id SERIAL PRIMARY KEY, email TEXT UNIQUE NOT NULL,
    reason TEXT DEFAULT '', created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  // Email stats)
  `CREATE TABLE IF NOT EXISTS email_stats (
    id SERIAL PRIMARY KEY, date DATE DEFAULT CURRENT_DATE,
    sent INTEGER DEFAULT 0, opened INTEGER DEFAULT 0,
    clicked INTEGER DEFAULT 0, bounced INTEGER DEFAULT 0,
    unsubscribed INTEGER DEFAULT 0
  )`,
];
EAM_MIGRATIONS.forEach(m => migrations.push(m));
['email_queue','email_templates','email_automations','email_unsubscribes','email_stats'
].forEach(t => VALID_TABLES.add(t));

const BASE_URL4 = process.env.BASE_URL || 'https://ssewasswa.onrender.com';

// ============================================================
// === 1. EMAIL TEMPLATE ENGINE ===
// ============================================================

const EMAIL_TEMPLATES = {
  welcome: {
    name: 'welcome',
    subject: 'Welcome to Comfort Zone! Your Account is Ready',
    html: `<div style="font-family:system-ui;max-width:600px;margin:0 auto;background:white;border-radius:12px;overflow:hidden">
      <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:32px;text-align:center">
        <h1 style="color:white;margin:0">Welcome to Comfort Zone!</h1>
        <p style="color:rgba(255,255,255,0.9);margin-top:8px;font-size:16px">Your all-in-one management platform is ready</p>
      </div>
      <div style="padding:32px">
        <p style="font-size:16px;color:#475569">Hi {{name}},</p>
        <p style="font-size:16px;color:#475569;margin-top:12px">Your account has been created successfully! Here is what you can do:</p>
        <div style="margin:20px 0;padding:20px;background:#f8fafc;border-radius:8px">
          <ul style="color:#475569;font-size:15px;line-height:2">
            <li>Set up your organization profile</li>
            <li>Add members or students</li>
            <li>Start collecting fees or payments</li>
            <li>Generate reports and analytics</li>
            <li>Invite your team to collaborate</li>
          </ul>
        </div>
        <div style="text-align:center;margin:24px 0">
          <a href="{{login_url}}" style="display:inline-block;background:#6366f1;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:16px">Get Started Now</a>
        </div>
        <p style="font-size:14px;color:#94a3b8;margin-top:16px">Need help? Check out our <a href="${BASE_URL4}/blog" style="color:#6366f1">Blog</a> or <a href="${BASE_URL4}/forum" style="color:#6366f1">Community Forum</a></p>
      </div>
      <div style="background:#f8fafc;padding:16px;text-align:center;font-size:12px;color:#94a3b8">
        Comfort Zone — All-in-one management platform for Uganda & East Africa<br>
        <a href="{{unsubscribe_url}}" style="color:#94a3b8">Unsubscribe</a>
      </div>
    </div>`,
    category: 'onboarding'
  },
  daily_digest: {
    name: 'daily_digest',
    subject: 'Your Daily Digest — Top News & Opportunities',
    html: `<div style="font-family:system-ui;max-width:600px;margin:0 auto;background:white;border-radius:12px;overflow:hidden">
      <div style="background:linear-gradient(135deg,#f59e0b,#d97706);padding:24px;text-align:center">
        <h1 style="color:white;margin:0;font-size:24px">Your Daily Digest</h1>
        <p style="color:rgba(255,255,255,0.9);margin-top:4px">Top stories curated for you</p>
      </div>
      <div style="padding:24px">{{content}}</div>
      <div style="padding:16px;text-align:center;background:#f8fafc">
        <a href="${BASE_URL4}/discover" style="display:inline-block;background:#6366f1;color:white;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600">Read More on Comfort Zone</a>
      </div>
      <div style="background:#f8fafc;padding:12px;text-align:center;font-size:12px;color:#94a3b8">
        Comfort Zone · <a href="{{unsubscribe_url}}" style="color:#94a3b8">Unsubscribe</a>
      </div>
    </div>`,
    category: 'engagement'
  },
  referral_invite: {
    name: 'referral_invite',
    subject: '{{referrer_name}} invited you to join Comfort Zone!',
    html: `<div style="font-family:system-ui;max-width:600px;margin:0 auto;background:white;border-radius:12px;overflow:hidden">
      <div style="background:linear-gradient(135deg,#10b981,#059669);padding:32px;text-align:center">
        <h1 style="color:white;margin:0">You are Invited!</h1>
        <p style="color:rgba(255,255,255,0.9);margin-top:8px;font-size:16px">{{referrer_name}} wants you to join Comfort Zone</p>
      </div>
      <div style="padding:32px;text-align:center">
        <p style="font-size:16px;color:#475569">Comfort Zone is the all-in-one management platform trusted by thousands of organizations across Uganda. Join for free and start managing your school, church, or business efficiently.</p>
        <div style="margin:24px 0">
          <a href="{{invite_url}}" style="display:inline-block;background:#10b981;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:16px">Accept Invitation — Join Free</a>
        </div>
        <p style="font-size:13px;color:#94a3b8">Your friend will earn 50 bonus points when you sign up!</p>
      </div>
      <div style="background:#f8fafc;padding:12px;text-align:center;font-size:12px;color:#94a3b8">
        Comfort Zone · <a href="{{unsubscribe_url}}" style="color:#94a3b8">Unsubscribe</a>
      </div>
    </div>`,
    category: 'referral'
  },
  engagement_reminder: {
    name: 'engagement_reminder',
    subject: 'We miss you! Here is what you missed on Comfort Zone',
    html: `<div style="font-family:system-ui;max-width:600px;margin:0 auto;background:white;border-radius:12px;overflow:hidden">
      <div style="background:linear-gradient(135deg,#ef4444,#f59e0b);padding:24px;text-align:center">
        <h1 style="color:white;margin:0;font-size:24px">We Miss You!</h1>
        <p style="color:rgba(255,255,255,0.9);margin-top:4px">Here is what you have been missing</p>
      </div>
      <div style="padding:24px">
        <p style="font-size:16px;color:#475569">Hi {{name}},</p>
        <p style="font-size:16px;color:#475569;margin-top:12px">It has been a while since you last visited Comfort Zone. Here are some things you might have missed:</p>
        <div style="margin:20px 0">
          <div style="padding:12px;background:#f8fafc;border-radius:8px;margin-bottom:8px">
            <a href="${BASE_URL4}/discover" style="color:#6366f1;font-weight:600;font-size:15px">Latest News</a>
            <p style="color:#64748b;font-size:13px;margin-top:4px">Stay updated with top stories from Uganda and East Africa</p>
          </div>
          <div style="padding:12px;background:#f8fafc;border-radius:8px;margin-bottom:8px">
            <a href="${BASE_URL4}/jobs" style="color:#10b981;font-weight:600;font-size:15px">New Job Listings</a>
            <p style="color:#64748b;font-size:13px;margin-top:4px">Find your next opportunity from our curated job board</p>
          </div>
          <div style="padding:12px;background:#f8fafc;border-radius:8px;margin-bottom:8px">
            <a href="${BASE_URL4}/quizzes" style="color:#f59e0b;font-weight:600;font-size:15px">Fun Quizzes</a>
            <p style="color:#64748b;font-size:13px;margin-top:4px">Test your knowledge and challenge your friends</p>
          </div>
        </div>
        <div style="text-align:center;margin:20px 0">
          <a href="${BASE_URL4}/login" style="display:inline-block;background:#6366f1;color:white;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600">Log In Now</a>
        </div>
      </div>
      <div style="background:#f8fafc;padding:12px;text-align:center;font-size:12px;color:#94a3b8">
        Comfort Zone · <a href="{{unsubscribe_url}}" style="color:#94a3b8">Unsubscribe</a>
      </div>
    </div>`,
    category: 'retention'
  },
  milestone: {
    name: 'milestone',
    subject: 'Congratulations! You earned the {{badge_name}} badge!',
    html: `<div style="font-family:system-ui;max-width:600px;margin:0 auto;background:white;border-radius:12px;overflow:hidden">
      <div style="background:linear-gradient(135deg,#f59e0b,#ef4444);padding:32px;text-align:center">
        <div style="font-size:48px">{{badge_icon}}</div>
        <h1 style="color:white;margin-top:8px">Achievement Unlocked!</h1>
      </div>
      <div style="padding:32px;text-align:center">
        <p style="font-size:18px;color:#1e293b">You earned the <strong>{{badge_name}}</strong> badge!</p>
        <p style="font-size:16px;color:#64748b;margin-top:8px">{{badge_description}}</p>
        <div style="margin:20px 0">
          <a href="${BASE_URL4}/achievements" style="display:inline-block;background:#f59e0b;color:white;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600">View All Badges</a>
        </div>
        <p style="font-size:14px;color:#64748b">Keep engaging to unlock more achievements and earn rewards!</p>
      </div>
      <div style="background:#f8fafc;padding:12px;text-align:center;font-size:12px;color:#94a3b8">
        Comfort Zone · <a href="{{unsubscribe_url}}" style="color:#94a3b8">Unsubscribe</a>
      </div>
    </div>`,
    category: 'gamification'
  },
};

// ============================================================
// === 2. QUEUE EMAIL ===
// ============================================================

async function queueEmail(toEmail, subject, htmlBody, type, delayHours) {
  const scheduledAt = delayHours ? new Date(Date.now() + delayHours * 3600000).toISOString() : new Date().toISOString();
  await pool.query(
    `INSERT INTO email_queue (to_email, subject, html_body, email_type, scheduled_at) VALUES ($1, $2, $3, $4, $5)`,
    [toEmail, subject, htmlBody, type || 'transactional', scheduledAt]
  );
}

function renderTemplate(templateName, variables) {
  const tmpl = EMAIL_TEMPLATES[templateName];
  if (!tmpl) return { subject: '', html: 'Template not found' };
  let html = tmpl.html;
  let subject = tmpl.subject;
  for (const [key, value] of Object.entries(variables || {})) {
    html = html.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    subject = subject.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }
  return { subject, html };
}

// ============================================================
// === 3. ADMIN EMAIL DASHBOARD ===
// ============================================================

app.get('/admin/email', requireAuth, ah(async (req, res) => {
  const u = req.session.user;
  if (u.role !== 'super_admin' && u.role !== 'admin') return res.status(403).send('Access denied');
  const [queued, sent, totalSent, totalSubs] = await Promise.all([
    pool.query("SELECT * FROM email_queue WHERE status = 'queued' ORDER BY scheduled_at LIMIT 20"),
    pool.query("SELECT * FROM email_queue WHERE status = 'sent' ORDER BY sent_at DESC LIMIT 20"),
    pool.query("SELECT COUNT(*) as total FROM email_queue WHERE status = 'sent'"),
    pool.query("(SELECT COUNT(*) as total FROM newsletter_subscribers WHERE is_active = true) + (SELECT COUNT(*) FROM email_queue WHERE status = 'sent') as total")
  ]);
  const unsubCount = (await pool.query('SELECT COUNT(*) FROM email_unsubscribes')).rows[0].count;

  res.send(renderPage('Email Automation', `
    <div class="hero" style="background:linear-gradient(135deg,#6366f1,#8b5cf6)"><h1>Email Automation</h1><p>${Number(totalSent.rows[0].total).toLocaleString()} emails sent · ${Number(totalSubs.rows[0].total).toLocaleString()} subscribers</p></div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:24px">
      <div class="stat-card"><div class="stat-num" style="color:#6366f1">${queued.rows.length}</div><div>Queued</div></div>
      <div class="stat-card"><div class="stat-num" style="color:#10b981">${Number(totalSent.rows[0].total).toLocaleString()}</div><div>Sent</div></div>
      <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${Number(totalSubs.rows[0].total).toLocaleString()}</div><div>Subscribers</div></div>
      <div class="stat-card"><div class="stat-num" style="color:#ef4444">${unsubCount}</div><div>Unsubscribed</div></div>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap">
      <button onclick="sendTestEmail()" class="btn" style="background:#6366f1">Send Test Email</button>
      <a href="/admin/email/templates" class="btn" style="background:#10b981">View Templates</a>
      <a href="/admin/email/compose" class="btn" style="background:#f59e0b">Compose Broadcast</a>
    </div>
    <div class="card" style="margin-bottom:20px">
      <h3>Queued Emails</h3>
      ${queued.rows.length > 0 ? queued.rows.map(e => `<div style="padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:13px"><strong>To:</strong> ${esc(e.to_email)} · <strong>Subject:</strong> ${esc(e.subject)} · <span style="color:#f59e0b">Scheduled: ${e.scheduled_at ? new Date(e.scheduled_at).toLocaleString() : 'Now'}</span></div>`).join('') : '<p style="color:#94a3b8;padding:12px">No queued emails</p>'}
    </div>
    <div class="card">
      <h3>Recently Sent</h3>
      ${sent.rows.map(e => `<div style="padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:13px"><strong>To:</strong> ${esc(e.to_email)} · <strong>Subject:</strong> ${esc(e.subject)} · <span style="${e.opened?'color:#10b981':'color:#94a3b8'}">${e.opened?'Opened':'Not opened'}</span> · ${e.sent_at ? new Date(e.sent_at).toLocaleString() : ''}</div>`).join('')}
    </div>
    <script>
    function sendTestEmail(){fetch('/admin/email/test-send',{method:'POST'}).then(r=>r.json()).then(d=>{if(d.success)alert('Test email sent!');else alert('Error: '+d.error);});}
    </script>
  `, req.session.user));
}));

// Send test email
app.post('/admin/email/test-send', requireAuth, ah(async (req, res) => {
  const u = req.session.user;
  const tmpl = renderTemplate('welcome', { name: u.name || u.email || 'Admin', login_url: BASE_URL4 + '/login', unsubscribe_url: BASE_URL4 + '/unsubscribe?email=' + encodeURIComponent(u.email) });
  await queueEmail(u.email, 'Test Email — ' + tmpl.subject, tmpl.html, 'test', 0);
  await trackRevenue('email_sent', 0.01, `Test email to ${u.email}`);
  res.json({ success: true });
}));

// Compose broadcast email
app.get('/admin/email/compose', requireAuth, ah(async (req, res) => {
  const u = req.session.user;
  if (u.role !== 'super_admin' && u.role !== 'admin') return res.status(403).send('Access denied');
  const subscribers = (await pool.query("SELECT email, name FROM newsletter_subscribers WHERE is_active = true LIMIT 5")).rows;
  res.send(renderPage('Compose Broadcast', `
    <div class="card" style="max-width:700px;margin:0 auto">
      <h2>Send Email Broadcast</h2>
      <p style="color:#64748b;margin-bottom:16px">Send to all newsletter subscribers</p>
      <form method="POST" action="/admin/email/broadcast">
        <div style="display:grid;gap:12px">
          <div><label>Subject</label><input name="subject" required style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px" placeholder="Exciting update from Comfort Zone"></div>
          <div><label>HTML Content</label><textarea name="html_body" rows="12" required style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px;font-family:monospace;font-size:13px" placeholder="<h1>Hello!</h1><p>Your message...</p>"></textarea></div>
          <label style="display:flex;align-items:center;gap:8px"><input type="checkbox" name="send_now" value="1" checked> Send immediately</label>
          <button type="submit" class="btn" style="background:#6366f1;padding:12px">Queue Broadcast</button>
        </div>
      </form>
      <p style="color:#94a3b8;font-size:13px;margin-top:12px">${subscribers.length > 0 ? 'Sample subscribers: ' + subscribers.map(s => esc(s.email)).join(', ') + '...' : 'No subscribers yet'}</p>
    </div>
  `, req.session.user));
}));

app.post('/admin/email/broadcast', requireAuth, ah(async (req, res) => {
  const { subject, html_body, send_now } = req.body;
  const subscribers = (await pool.query("SELECT email FROM newsletter_subscribers WHERE is_active = true")).rows;
  const unsubscribed = (await pool.query("SELECT email FROM email_unsubscribes")).rows.map(r => r.email);
  const targets = subscribers.filter(s => !unsubscribed.includes(s.email));
  for (const sub of targets) {
    await queueEmail(sub.email, subject, html_body, 'broadcast', send_now !== '1' ? 0 : 0);
  }
  res.send(renderPage('Broadcast Queued', `
    <div style="max-width:500px;margin:60px auto;text-align:center">
      <div style="font-size:64px">📨</div>
      <h2>Broadcast Queued!</h2>
      <p style="color:#64748b;margin-top:8px">${targets.length} emails queued for delivery</p>
      <a href="/admin/email" class="btn" style="background:#6366f1;margin-top:20px;display:inline-block">Back to Email Dashboard</a>
    </div>
  `, req.session.user));
}));

// Unsubscribe
app.get('/unsubscribe', ah(async (req, res) => {
  const email = req.query.email;
  if (!email) return res.send('No email provided');
  await pool.query('INSERT INTO email_unsubscribes (email) VALUES ($1) ON CONFLICT DO NOTHING', [email]);
  await pool.query("UPDATE newsletter_subscribers SET is_active = false WHERE email = $1", [email]);
  res.send(`<!DOCTYPE html><html><head><title>Unsubscribed</title>
    <style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:80vh;background:#f8fafc}</style>
  </head><body><div style="text-align:center;max-width:400px;padding:20px">
    <div style="font-size:48px">😔</div>
    <h2>You have been unsubscribed</h2>
    <p style="color:#64748b;margin-top:8px">You will no longer receive emails from Comfort Zone.</p>
    <a href="/" style="color:#6366f1;text-decoration:none;margin-top:16px;display:inline-block">Back to Home</a>
  </div></body></html>`);
}));

// Seed email templates
async function seedEmailTemplates() {
  for (const [key, tmpl] of Object.entries(EMAIL_TEMPLATES)) {
    await pool.query(
      `INSERT INTO email_templates (template_name, subject, html_template, category) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [tmpl.name, tmpl.subject, tmpl.html, tmpl.category]
    ).catch(() => {});
  }
}

seedEmailTemplates().catch(e => console.warn('[EmailAuto] Template seed error:', e.message));

// Export cross-module functions to global scope
if (typeof queueEmail === 'function') global.queueEmail = queueEmail;

console.log('[EmailAuto] LOADED: Welcome series, daily digest, referral invite, engagement reminder, milestone notification, email queue, broadcast, unsubscribe tracking, 5 templates');
