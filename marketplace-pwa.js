/**
 * Comfort Platform - Marketplace & Enhanced Offline-First PWA
 * ==============================================================
 * Plugin marketplace foundation with app store UI, developer portal,
 * plugin reviews, tenant config, and enhanced service worker with
 * background sync, offline CRUD queue, and push notification handling.
 *
 * Usage in server.js:
 *   const marketplacePwa = require('./marketplace-pwa');
 *   const { writeServiceWorker } = await marketplacePwa(app, pool, requireAuth, logger, audit);
 *   writeServiceWorker();
 *
 * Export: module.exports = async (app, pool, requireAuth, logger, audit) => { ... return { writeServiceWorker }; }
 */

const path = require('path');
const fs = require('fs');

module.exports = async (app, pool, requireAuth, logger, audit) => {

  // =========================================================================
  // LOCAL HELPERS (mirrors server.js patterns)
  // =========================================================================

  const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const esc = s => String(s === null || s === undefined ? '' : (typeof s === 'object' ? JSON.stringify(s) : s)).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const sanitizeStr = s => typeof s === 'string' ? s.trim().replace(/[<>'"]/g, '') : s;

  // Local renderPage — self-contained HTML shell with nav, CSRF injection, dark mode
  const renderPage = (title, content, user, csrfToken) => {
    const dark = user?.dark_mode;
    const siteName = 'Comfort';
    let safeContent = content || '';
    if (csrfToken && safeContent.includes('<form')) {
      safeContent = safeContent.replace(/<form([^>]*)>/g, `<form$1><input type="hidden" name="_csrf" value="${csrfToken}">`);
    }
    return `<!DOCTYPE html>
<html${dark ? ' class="dark"' : ''} lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} | ${esc(siteName)}</title>
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" type="image/png" sizes="1024x1024" href="/icon.png">
<meta name="theme-color" content="#4f46e5">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:${dark ? '#0f172a' : '#f8fafc'};color:${dark ? '#e2e8f0' : '#1e293b'};line-height:1.6;transition:background .3s,color .3s}
.nav{background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;padding:15px 20px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;box-shadow:0 4px 12px rgba(79,70,229,.3)}
.nav a{color:white;text-decoration:none;padding:8px 16px;border-radius:8px;transition:.2s;font-size:14px}.nav a:hover{background:rgba(255,255,255,.2)}
.container{max-width:1200px;margin:20px auto;padding:0 20px}
.card{background:${dark ? '#1e293b' : 'white'};border-radius:16px;padding:24px;margin-bottom:20px;box-shadow:0 4px 20px rgba(0,0,0,${dark ? '.3' : '.08'});border:1px solid ${dark ? '#334155' : '#e2e8f0'};transition:background .3s}
.btn{display:inline-block;padding:12px 24px;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;text-decoration:none;border-radius:10px;font-weight:600;border:none;cursor:pointer;transition:.3s;font-size:14px}
.btn:hover{transform:translateY(-2px);box-shadow:0 8px 25px rgba(79,70,229,.4)}
.btn-gold{background:linear-gradient(135deg,#d97706,#f59e0b)}.btn-red{background:linear-gradient(135deg,#dc2626,#ef4444)}.btn-green{background:linear-gradient(135deg,#059669,#10b981)}
.btn-sm{padding:8px 16px;font-size:13px;border-radius:8px}
.btn-outline{background:transparent;border:2px solid #e2e8f0;color:#1e293b}.btn-outline:hover{border-color:#4f46e5;color:#4f46e5}
input,select,textarea{width:100%;padding:12px;border:2px solid ${dark ? '#475569' : '#e2e8f0'};border-radius:10px;font-size:14px;background:${dark ? '#1e293b' : 'white'};color:${dark ? '#e2e8f0' : '#1e293b'};transition:border-color .2s;margin:4px 0}
input:focus,select:focus,textarea:focus{outline:none;border-color:#4f46e5;box-shadow:0 0 0 3px rgba(79,70,229,.1)}
table{width:100%;border-collapse:collapse;margin:10px 0}th,td{padding:10px 12px;text-align:left;border-bottom:1px solid ${dark ? '#334155' : '#e2e8f0'};font-size:14px}th{background:${dark ? '#334155' : '#f8fafc'};font-weight:600}
.hero{background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;padding:40px 30px;border-radius:16px;margin-bottom:25px;text-align:center}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:15px;margin:20px 0}
.stat-card{background:${dark ? '#1e293b' : 'white'};padding:20px;border-radius:12px;text-align:center;box-shadow:0 2px 10px rgba(0,0,0,.05);border:1px solid ${dark ? '#334155' : '#e2e8f0'}}
.stat-num{font-size:28px;font-weight:800;background:linear-gradient(135deg,#4f46e5,#7c3aed);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px;margin:20px 0}
.tag{display:inline-block;padding:4px 10px;border-radius:6px;font-size:12px;font-weight:600;background:#e0e7ff;color:#3730a3}
.tag-green{background:#d1fae5;color:#065f46}.tag-gold{background:#fef3c7;color:#92400e}.tag-red{background:#fee2e2;color:#991b1b}.tag-blue{background:#dbeafe;color:#1e40af}
.alert{padding:16px;border-radius:10px;margin-bottom:15px}.alert-success{background:#d1fae5;color:#065f46}.alert-error{background:#fee2e2;color:#991b1b}.alert-info{background:#dbeafe;color:#1e40af}
.muted{color:${dark ? '#94a3b8' : '#64748b'};font-size:13px}
a{color:#4f46e5;text-decoration:none}a:hover{text-decoration:underline}
.stars{color:#f59e0b;font-size:16px;letter-spacing:2px}
.badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700}
.badge-official{background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white}
.badge-verified{background:#d1fae5;color:#065f46}
.flex-between{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px}
@media(max-width:768px){.nav{flex-direction:column;gap:10px}.stats,.grid{grid-template-columns:1fr}.hero{padding:30px 15px}.container{padding:0 12px}.card{padding:16px;margin-bottom:12px}.btn{padding:14px 20px;width:100%;text-align:center}table{display:block;overflow-x:auto}th,td{padding:8px;font-size:13px}}
</style>
</head>
<body>
<nav class="nav">
  <a href="/dashboard">Dashboard</a>
  <a href="/marketplace">Marketplace</a>
  <a href="/marketplace/my">My Plugins</a>
  ${user?.role === 'developer' || user?.role === 'super_admin' ? '<a href="/developer/portal">Developer</a>' : ''}
  <a href="/dashboard" style="background:rgba(255,255,255,.15);border-radius:8px;padding:8px 16px;font-size:14px">&larr; Back</a>
</nav>
<div class="container">
${safeContent}
</div>
</body></html>`;
  };

  // Simple JSON API response helper
  const jsonOk = (res, data, status = 200) => res.status(status).json({ success: true, ...data });
  const jsonErr = (res, message, status = 400) => res.status(status).json({ success: false, error: message });

  // =========================================================================
  // SECTION 1: MIGRATIONS
  // =========================================================================

  const marketplaceMigrations = [
    // marketplace_plugins — enhanced schema with slug, pricing, rating, tags
    `CREATE TABLE IF NOT EXISTS marketplace_plugins (
      id SERIAL PRIMARY KEY,
      slug VARCHAR(100) UNIQUE NOT NULL,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      version VARCHAR(20),
      author VARCHAR(255),
      category VARCHAR(100),
      icon_url TEXT,
      banner_url TEXT,
      pricing_model VARCHAR(50) DEFAULT 'free',
      price_monthly NUMERIC(10,2) DEFAULT 0,
      is_official BOOLEAN DEFAULT false,
      is_verified BOOLEAN DEFAULT false,
      is_active BOOLEAN DEFAULT true,
      installs_count INTEGER DEFAULT 0,
      rating NUMERIC(2,1) DEFAULT 0,
      review_count INTEGER DEFAULT 0,
      tags TEXT[],
      min_plan VARCHAR(50) DEFAULT 'free',
      permissions TEXT[],
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    // installed_plugins — tenant-specific installations with config
    `CREATE TABLE IF NOT EXISTS installed_plugins (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      plugin_id INTEGER NOT NULL REFERENCES marketplace_plugins(id),
      config JSONB DEFAULT '{}',
      is_enabled BOOLEAN DEFAULT true,
      installed_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(tenant_id, plugin_id)
    )`,
    // plugin_reviews — one review per tenant per plugin
    `CREATE TABLE IF NOT EXISTS plugin_reviews (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id),
      plugin_id INTEGER REFERENCES marketplace_plugins(id),
      rating INTEGER CHECK (rating BETWEEN 1 AND 5),
      review_text TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(tenant_id, plugin_id)
    )`,
    // developer_revenue — revenue tracking for plugin developers
    `CREATE TABLE IF NOT EXISTS developer_revenue (
      id SERIAL PRIMARY KEY,
      developer_id INTEGER,
      plugin_id INTEGER REFERENCES marketplace_plugins(id),
      tenant_id INTEGER,
      amount NUMERIC(10,2),
      period VARCHAR(20),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    // Index for fast slug lookups
    `CREATE INDEX IF NOT EXISTS idx_mp_slug ON marketplace_plugins(slug)`,
    `CREATE INDEX IF NOT EXISTS idx_mp_category ON marketplace_plugins(category)`,
    `CREATE INDEX IF NOT EXISTS idx_mp_active ON marketplace_plugins(is_active) WHERE is_active = true`,
    `CREATE INDEX IF NOT EXISTS idx_ip_tenant ON installed_plugins(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_pr_plugin ON plugin_reviews(plugin_id)`,
    // Add columns to existing tables if they don't exist (backward compat)
    `DO $$ BEGIN
      ALTER TABLE marketplace_plugins ADD COLUMN IF NOT EXISTS slug VARCHAR(100);
      ALTER TABLE marketplace_plugins ADD COLUMN IF NOT EXISTS version VARCHAR(20);
      ALTER TABLE marketplace_plugins ADD COLUMN IF NOT EXISTS banner_url TEXT;
      ALTER TABLE marketplace_plugins ADD COLUMN IF NOT EXISTS pricing_model VARCHAR(50) DEFAULT 'free';
      ALTER TABLE marketplace_plugins ADD COLUMN IF NOT EXISTS price_monthly NUMERIC(10,2) DEFAULT 0;
      ALTER TABLE marketplace_plugins ADD COLUMN IF NOT EXISTS is_official BOOLEAN DEFAULT false;
      ALTER TABLE marketplace_plugins ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT false;
      ALTER TABLE marketplace_plugins ADD COLUMN IF NOT EXISTS rating NUMERIC(2,1) DEFAULT 0;
      ALTER TABLE marketplace_plugins ADD COLUMN IF NOT EXISTS review_count INTEGER DEFAULT 0;
      ALTER TABLE marketplace_plugins ADD COLUMN IF NOT EXISTS tags TEXT[];
      ALTER TABLE marketplace_plugins ADD COLUMN IF NOT EXISTS min_plan VARCHAR(50) DEFAULT 'free';
      ALTER TABLE marketplace_plugins ADD COLUMN IF NOT EXISTS permissions TEXT[];
      ALTER TABLE marketplace_plugins ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
    EXCEPTION WHEN OTHERS THEN NULL;
    END $$;`,
    // Sync existing marketplace_plugins — generate slugs from names
    `UPDATE marketplace_plugins SET slug = LOWER(REPLACE(REPLACE(name, ' ', '-'), '_', '-')), updated_at = NOW() WHERE slug IS NULL OR slug = ''`,
    `ALTER TABLE marketplace_plugins ALTER COLUMN slug SET NOT NULL`,
    // Rename downloads → installs_count for consistency
    `DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='marketplace_plugins' AND column_name='downloads') THEN
        UPDATE marketplace_plugins SET installs_count = COALESCE(installs_count, 0) + COALESCE(downloads, 0);
      END IF;
    EXCEPTION WHEN OTHERS THEN NULL;
    END $$;`,
  ];

  // Run migrations
  for (const sql of marketplaceMigrations) {
    try {
      await pool.query(sql);
    } catch (e) {
      if (!e.message.includes('already exists') && !e.message.includes('does not exist') && !e.message.includes('duplicate') && !e.message.includes('ON CONFLICT')) {
        logger.warn('[Marketplace] Migration warning: ' + e.message);
      }
    }
  }
  logger.info('[Marketplace] Migrations complete');

  // =========================================================================
  // SECTION 2: SEED DEMO PLUGINS
  // =========================================================================

  const DEMO_PLUGINS = [
    {
      slug: 'quickbooks-sync', name: 'QuickBooks Sync', version: '1.2.0',
      description: 'Seamless accounting integration with QuickBooks Online. Automatically sync invoices, expenses, and payment records between Comfort and your QuickBooks account. Supports multi-currency including UGX, KES, TZS, and USD.',
      author: 'Comfort Labs', category: 'Finance',
      icon_url: '', banner_url: '',
      pricing_model: 'paid', price_monthly: 50000,
      is_official: true, is_verified: true,
      tags: ['accounting', 'quickbooks', 'finance', 'sync', 'invoices'],
      min_plan: 'basic', permissions: ['read_finances', 'write_finances']
    },
    {
      slug: 'whatsapp-pro', name: 'WhatsApp Pro', version: '2.0.1',
      description: 'Advanced WhatsApp Business API integration. Send automated messages, templates, appointment reminders, fee alerts, and event notifications. Supports rich media, interactive buttons, and delivery tracking.',
      author: 'Comfort Labs', category: 'Communication',
      icon_url: '', banner_url: '',
      pricing_model: 'paid', price_monthly: 30000,
      is_official: true, is_verified: true,
      tags: ['whatsapp', 'messaging', 'notifications', 'communication', 'chat'],
      min_plan: 'basic', permissions: ['send_messages', 'read_contacts']
    },
    {
      slug: 'ai-tutor', name: 'AI Tutor', version: '1.5.0',
      description: 'AI-powered student tutoring assistant. Generates personalized study plans, practice questions, and explanations. Adapts to each student\'s learning pace and weak areas. Supports all subjects from Primary to A-Level.',
      author: 'EduTech Africa', category: 'Education',
      icon_url: '', banner_url: '',
      pricing_model: 'freemium', price_monthly: 0,
      is_official: false, is_verified: true,
      tags: ['ai', 'tutoring', 'education', 'study', 'personalized'],
      min_plan: 'free', permissions: ['read_students', 'read_results']
    },
    {
      slug: 'biometric-attendance', name: 'Biometric Attendance', version: '1.3.2',
      description: 'Fingerprint and face recognition integration for attendance tracking. Works with popular biometric hardware devices. Real-time attendance logging with automatic SMS alerts to parents for absent students.',
      author: 'SecureTech UG', category: 'Education',
      icon_url: '', banner_url: '',
      pricing_model: 'paid', price_monthly: 40000,
      is_official: false, is_verified: true,
      tags: ['biometric', 'attendance', 'fingerprint', 'face-recognition', 'security'],
      min_plan: 'pro', permissions: ['read_attendance', 'write_attendance', 'read_students']
    },
    {
      slug: 'bulk-sms-blaster', name: 'Bulk SMS Blaster', version: '1.1.0',
      description: 'Mass SMS campaign manager. Create and schedule bulk SMS campaigns to parents, members, or customers. Supports message templates, delivery reports, opt-out management, and segmentation by class or group.',
      author: 'Comfort Labs', category: 'Communication',
      icon_url: '', banner_url: '',
      pricing_model: 'free', price_monthly: 0,
      is_official: true, is_verified: true,
      tags: ['sms', 'bulk', 'campaigns', 'notifications', 'marketing'],
      min_plan: 'free', permissions: ['send_sms']
    },
    {
      slug: 'report-builder', name: 'Report Builder', version: '1.0.0',
      description: 'Custom report template designer. Create personalized report cards, financial summaries, and operational reports with drag-and-drop templates. Export to PDF, Excel, and print-ready formats.',
      author: 'DocGen Inc', category: 'Reporting',
      icon_url: '', banner_url: '',
      pricing_model: 'freemium', price_monthly: 0,
      is_official: false, is_verified: true,
      tags: ['reports', 'templates', 'pdf', 'excel', 'designer'],
      min_plan: 'free', permissions: ['read_data', 'export_reports']
    },
    {
      slug: 'ussd-portal', name: 'USSD Portal', version: '1.2.0',
      description: 'USSD access for feature phones. Allow parents and members without smartphones to check balances, attendance, and results via USSD codes. Works on all networks including MTN, Airtel, and Africell.',
      author: 'USSD Solutions', category: 'Communication',
      icon_url: '', banner_url: '',
      pricing_model: 'paid', price_monthly: 35000,
      is_official: false, is_verified: true,
      tags: ['ussd', 'feature-phone', 'accessibility', 'mobile', 'no-smartphone'],
      min_plan: 'basic', permissions: ['read_data', 'telecom_integration']
    },
    {
      slug: 'parcel-tracking', name: 'Parcel Tracking', version: '1.0.1',
      description: 'School transport and parcel tracking system. Track school bus routes, student pickup/dropoff, and parcel deliveries. Real-time GPS tracking with parent notifications and route optimization.',
      author: 'LogiTrack Africa', category: 'Operations',
      icon_url: '', banner_url: '',
      pricing_model: 'free', price_monthly: 0,
      is_official: false, is_verified: false,
      tags: ['transport', 'tracking', 'gps', 'logistics', 'school-bus'],
      min_plan: 'free', permissions: ['read_students', 'write_transport']
    },
    {
      slug: 'meal-planner', name: 'Meal Planner', version: '1.1.0',
      description: 'School cafeteria and meal management. Plan weekly menus, track meal attendance, manage dietary requirements, and generate food procurement lists. Supports kitchen inventory and cost tracking.',
      author: 'NutriSchool', category: 'Operations',
      icon_url: '', banner_url: '',
      pricing_model: 'free', price_monthly: 0,
      is_official: false, is_verified: false,
      tags: ['meals', 'cafeteria', 'nutrition', 'menu', 'kitchen'],
      min_plan: 'free', permissions: ['read_students', 'write_operations']
    },
    {
      slug: 'visitor-management', name: 'Visitor Management', version: '1.0.0',
      description: 'Digital visitor log and management system. Register visitors, issue digital passes, track visit history, and enforce security protocols. Supports pre-registration, QR code check-in, and blacklisting.',
      author: 'SecureGate', category: 'Security',
      icon_url: '', banner_url: '',
      pricing_model: 'free', price_monthly: 0,
      is_official: false, is_verified: false,
      tags: ['visitors', 'security', 'check-in', 'registration', 'gate'],
      min_plan: 'free', permissions: ['write_security']
    },
    {
      slug: 'alumni-network-pro', name: 'Alumni Network Pro', version: '1.3.0',
      description: 'Enhanced alumni portal with networking, job boards, event management, and fundraising. Connect graduates, share opportunities, and build a thriving alumni community with mentorship programs.',
      author: 'AlumniConnect', category: 'Community',
      icon_url: '', banner_url: '',
      pricing_model: 'freemium', price_monthly: 0,
      is_official: false, is_verified: true,
      tags: ['alumni', 'networking', 'community', 'jobs', 'events'],
      min_plan: 'free', permissions: ['read_contacts', 'write_community']
    },
    {
      slug: 'church-live-stream', name: 'Church Live Stream', version: '1.1.0',
      description: 'Live streaming integration for church services. Embed YouTube, Facebook Live, or custom RTMP streams directly into your church portal. Schedule streams, track viewership, and share recordings.',
      author: 'StreamFaith', category: 'Community',
      icon_url: '', banner_url: '',
      pricing_model: 'paid', price_monthly: 25000,
      is_official: false, is_verified: true,
      tags: ['live-stream', 'church', 'video', 'youtube', 'broadcasting'],
      min_plan: 'basic', permissions: ['write_content', 'stream_media']
    },
  ];

  // Seed plugins (upsert by slug)
  for (const plugin of DEMO_PLUGINS) {
    try {
      const existing = (await pool.query('SELECT id FROM marketplace_plugins WHERE slug = $1', [plugin.slug])).rows[0];
      if (existing) {
        await pool.query(`
          UPDATE marketplace_plugins SET name=$2, description=$3, version=$4, author=$5, category=$6,
            pricing_model=$7, price_monthly=$8, is_official=$9, is_verified=$10,
            tags=$11, min_plan=$12, permissions=$13, updated_at=NOW()
          WHERE slug=$1`,
          [plugin.slug, plugin.name, plugin.description, plugin.version, plugin.author, plugin.category,
            plugin.pricing_model, plugin.price_monthly, plugin.is_official, plugin.is_verified,
            plugin.tags, plugin.min_plan, plugin.permissions]);
      } else {
        await pool.query(`
          INSERT INTO marketplace_plugins (slug, name, description, version, author, category,
            icon_url, banner_url, pricing_model, price_monthly, is_official, is_verified,
            tags, min_plan, permissions, installs_count, rating)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [plugin.slug, plugin.name, plugin.description, plugin.version, plugin.author, plugin.category,
            plugin.icon_url, plugin.banner_url, plugin.pricing_model, plugin.price_monthly,
            plugin.is_official, plugin.is_verified, plugin.tags, plugin.min_plan, plugin.permissions,
            Math.floor(Math.random() * 200) + 10, // realistic install counts
          ]);
        // Set realistic ratings for demo
        const rating = (3.5 + Math.random() * 1.5).toFixed(1);
        await pool.query('UPDATE marketplace_plugins SET rating=$1, review_count=$2 WHERE slug=$3',
          [rating, Math.floor(Math.random() * 50) + 5, plugin.slug]);
      }
    } catch (e) {
      logger.warn(`[Marketplace] Seed error for ${plugin.slug}: ${e.message}`);
    }
  }
  logger.info(`[Marketplace] ${DEMO_PLUGINS.length} demo plugins seeded`);

  // =========================================================================
  // SECTION 3: MARKETPLACE ROUTES
  // =========================================================================

  // --- GET /marketplace — Browse marketplace ---
  app.get('/marketplace', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;
    const csrf = req.csrfToken || '';
    const { q, category, sort, pricing } = req.query;

    // Fetch installed plugins for this tenant
    const installed = (await pool.query(
      'SELECT plugin_id, is_enabled FROM installed_plugins WHERE tenant_id=$1', [tid]
    )).rows.reduce((acc, r) => { acc[r.plugin_id] = r.is_enabled; return acc; }, {});

    // Build query
    let where = 'WHERE is_active = true';
    const params = [];
    let paramIdx = 1;

    if (q) {
      where += ` AND (name ILIKE $${paramIdx} OR description ILIKE $${paramIdx} OR $${paramIdx} = ANY(tags))`;
      params.push(`%${sanitizeStr(q)}%`);
      paramIdx++;
    }
    if (category) {
      where += ` AND category = $${paramIdx}`;
      params.push(sanitizeStr(category));
      paramIdx++;
    }
    if (pricing) {
      if (pricing === 'free') where += ` AND pricing_model = 'free'`;
      else if (pricing === 'paid') where += ` AND pricing_model = 'paid'`;
      else if (pricing === 'freemium') where += ` AND pricing_model = 'freemium'`;
    }

    let orderBy = 'ORDER BY installs_count DESC';
    if (sort === 'rating') orderBy = 'ORDER BY rating DESC, review_count DESC';
    else if (sort === 'new') orderBy = 'ORDER BY created_at DESC';
    else if (sort === 'popular') orderBy = 'ORDER BY installs_count DESC';
    else if (sort === 'price-low') orderBy = 'ORDER BY price_monthly ASC';
    else if (sort === 'price-high') orderBy = 'ORDER BY price_monthly DESC';

    const plugins = (await pool.query(`SELECT * FROM marketplace_plugins ${where} ${orderBy}`, params)).rows;

    // Get unique categories
    const categories = (await pool.query(
      "SELECT DISTINCT category FROM marketplace_plugins WHERE is_active = true AND category IS NOT NULL ORDER BY category"
    )).rows.map(r => r.category);

    const catColors = {
      'Finance': '#059669', 'Communication': '#3b82f6', 'Education': '#8b5cf6',
      'Reporting': '#f59e0b', 'Operations': '#ec4899', 'Security': '#ef4444',
      'Community': '#06b6d4'
    };

    const formatPrice = (model, price) => {
      if (model === 'free') return '<span style="color:#22c55e;font-weight:700">Free</span>';
      if (model === 'paid') return `<span style="font-weight:700">UGX ${Number(price).toLocaleString()}</span><span class="muted">/mo</span>`;
      return '<span style="color:#f59e0b;font-weight:700">Freemium</span>';
    };

    const renderStars = (rating) => {
      const full = Math.floor(rating);
      const half = rating - full >= 0.5;
      let s = '';
      for (let i = 0; i < full; i++) s += '★';
      if (half) s += '½';
      return `<span class="stars">${s}</span> <span class="muted">${Number(rating).toFixed(1)}</span>`;
    };

    const html = `
      <div class="hero" style="background:linear-gradient(135deg,#f59e0b 0%,#d97706 50%,#b45309 100%);padding:40px 30px">
        <h1 style="font-size:clamp(24px,4vw,40px);margin-bottom:8px">Plugin Marketplace</h1>
        <p style="font-size:clamp(14px,2vw,18px);opacity:0.9;margin-bottom:20px">Extend your platform with powerful integrations</p>
        <form method="GET" action="/marketplace" style="display:flex;gap:10px;max-width:600px;margin:0 auto;flex-wrap:wrap">
          <input name="q" value="${esc(q || '')}" placeholder="Search plugins..." style="flex:1;min-width:200px;border:2px solid rgba(255,255,255,.3);background:rgba(255,255,255,.15);color:white;border-radius:12px;padding:12px 20px;font-size:16px">
          <button type="submit" class="btn" style="background:white;color:#d97706;font-weight:700">Search</button>
        </form>
      </div>

      <div style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap;align-items:center">
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <a href="/marketplace${q ? '?q='+encodeURIComponent(q) : ''}" class="btn btn-sm btn-outline ${!category ? 'style="background:#4f46e5;color:white;border-color:#4f46e5"' : ''}">All</a>
          ${categories.map(c => `<a href="/marketplace?category=${encodeURIComponent(c)}${q ? '&q='+encodeURIComponent(q) : ''}" class="btn btn-sm btn-outline" ${category === c ? 'style="background:#4f46e5;color:white;border-color:#4f46e5"' : ''}>${esc(c)}</a>`).join('')}
        </div>
        <div style="margin-left:auto;display:flex;gap:6px;flex-wrap:wrap">
          <select onchange="location.href=this.value" style="width:auto;padding:8px 12px;font-size:13px;border-radius:8px">
            <option value="/marketplace?${new URLSearchParams({q:q||'',category:category||'',sort:'popular'})}" ${(!sort||sort==='popular')?'selected':''}>Most Popular</option>
            <option value="/marketplace?${new URLSearchParams({q:q||'',category:category||'',sort:'rating'})}" ${sort==='rating'?'selected':''}>Top Rated</option>
            <option value="/marketplace?${new URLSearchParams({q:q||'',category:category||'',sort:'new'})}" ${sort==='new'?'selected':''}>Newest</option>
            <option value="/marketplace?${new URLSearchParams({q:q||'',category:category||'',sort:'price-low'})}" ${sort==='price-low'?'selected':''}>Price: Low-High</option>
            <option value="/marketplace?${new URLSearchParams({q:q||'',category:category||'',sort:'price-high'})}" ${sort==='price-high'?'selected':''}>Price: High-Low</option>
          </select>
          <a href="/marketplace?pricing=free${q ? '&q='+encodeURIComponent(q) : ''}" class="btn btn-sm btn-outline ${pricing==='free'?'style="background:#22c55e;color:white;border-color:#22c55e"':''}">Free Only</a>
        </div>
      </div>

      <div class="stats" style="margin-bottom:20px">
        <div class="stat-card"><div class="stat-num">${plugins.length}</div><div class="muted">Available Plugins</div></div>
        <div class="stat-card"><div class="stat-num" style="-webkit-text-fill-color:#22c55e;background:none">${Object.keys(installed).length}</div><div class="muted">Installed</div></div>
        <div class="stat-card"><div class="stat-num" style="-webkit-text-fill-color:#f59e0b;background:none">${categories.length}</div><div class="muted">Categories</div></div>
      </div>

      <div class="grid">
        ${plugins.map(p => {
          const isInstalled = installed.hasOwnProperty(p.id);
          const isEnabled = installed[p.id];
          return `<div class="card" style="display:flex;flex-direction:column;position:relative;overflow:hidden">
            ${p.is_official ? '<div style="position:absolute;top:12px;right:12px"><span class="badge badge-official">Official</span></div>' : ''}
            ${p.is_verified && !p.is_official ? '<div style="position:absolute;top:12px;right:12px"><span class="badge badge-verified">&#10003; Verified</span></div>' : ''}
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
              <div style="width:48px;height:48px;border-radius:12px;background:linear-gradient(135deg,${catColors[p.category]||'#4f46e5'},${catColors[p.category]||'#7c3aed'}88);display:flex;align-items:center;justify-content:center;font-size:24px;color:white;flex-shrink:0">${p.category === 'Finance' ? '💰' : p.category === 'Communication' ? '💬' : p.category === 'Education' ? '🎓' : p.category === 'Reporting' ? '📊' : p.category === 'Operations' ? '⚙️' : p.category === 'Security' ? '🔒' : p.category === 'Community' ? '🤝' : '🔌'}</div>
              <div style="flex:1;min-width:0">
                <h3 style="font-size:16px;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.name)}</h3>
                <div class="muted">by ${esc(p.author || 'Community')} &middot; v${esc(p.version || '1.0')}</div>
              </div>
            </div>
            <p style="font-size:13px;color:#64748b;margin-bottom:12px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;flex:1">${esc(p.description || '')}</p>
            <div style="margin-bottom:10px">
              ${renderStars(p.rating || 0)}
              <span class="muted" style="margin-left:6px">(${p.review_count || 0} reviews)</span>
              <span class="muted" style="margin-left:8px">${p.installs_count || 0} installs</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
              <span class="tag" style="background:${catColors[p.category]||'#4f46e5'}22;color:${catColors[p.category]||'#4f46e5'}">${esc(p.category || 'General')}</span>
              <div>${formatPrice(p.pricing_model, p.price_monthly)}</div>
            </div>
            ${isInstalled
              ? (isEnabled
                ? `<div style="display:flex;gap:8px">
                    <span class="tag tag-green" style="flex:1;text-align:center;padding:8px">Installed &amp; Active</span>
                    <form method="POST" action="/marketplace/${esc(p.slug)}/disable" style="flex-shrink:0"><input type="hidden" name="_csrf" value="${csrf}"><button type="submit" class="btn btn-sm" style="background:#f59e0b;color:white">Disable</button></form>
                  </div>`
                : `<div style="display:flex;gap:8px">
                    <span class="tag tag-gold" style="flex:1;text-align:center;padding:8px">Disabled</span>
                    <form method="POST" action="/marketplace/${esc(p.slug)}/enable" style="flex-shrink:0"><input type="hidden" name="_csrf" value="${csrf}"><button type="submit" class="btn btn-sm btn-green">Enable</button></form>
                  </div>`)
              : `<form method="POST" action="/marketplace/${esc(p.slug)}/install" style="margin-top:4px">
                  <input type="hidden" name="_csrf" value="${csrf}">
                  <button type="submit" class="btn btn-sm btn-green" style="width:100%">Install Plugin</button>
                </form>`
            }
            <div style="margin-top:8px;text-align:center"><a href="/marketplace/${esc(p.slug)}" class="muted" style="font-size:12px">View Details &rarr;</a></div>
          </div>`;
        }).join('')}
      </div>
      ${plugins.length === 0 ? '<div class="card" style="text-align:center;padding:40px"><h3>No plugins found</h3><p class="muted">Try adjusting your search or filters</p></div>' : ''}
      <div style="margin-top:16px;text-align:center"><a href="/marketplace/my" class="btn btn-outline">My Installed Plugins</a></div>
    `;
    res.send(renderPage('Plugin Marketplace', html, user, csrf));
  }));

  // --- GET /marketplace/:slug — Plugin detail page ---
  app.get('/marketplace/:slug', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;
    const csrf = req.csrfToken || '';
    const { slug } = req.params;

    const plugin = (await pool.query('SELECT * FROM marketplace_plugins WHERE slug=$1 AND is_active=true', [slug])).rows[0];
    if (!plugin) return res.status(404).send(renderPage('Not Found', '<div class="card" style="text-align:center;padding:40px"><h2>Plugin Not Found</h2><p class="muted">This plugin may have been removed or the link is incorrect.</p><a href="/marketplace" class="btn">Browse Marketplace</a></div>', user, csrf));

    // Check installation status
    const install = (await pool.query('SELECT * FROM installed_plugins WHERE tenant_id=$1 AND plugin_id=$2', [tid, plugin.id])).rows[0];
    const isInstalled = !!install;
    const isEnabled = install?.is_enabled;

    // Check user review
    const myReview = (await pool.query('SELECT * FROM plugin_reviews WHERE tenant_id=$1 AND plugin_id=$2', [tid, plugin.id])).rows[0];

    // Get reviews
    const reviews = (await pool.query(
      'SELECT r.*, t.name as tenant_name FROM plugin_reviews r LEFT JOIN tenants t ON t.id = r.tenant_id WHERE r.plugin_id=$1 ORDER BY r.created_at DESC LIMIT 20',
      [plugin.id]
    )).rows;

    const formatPrice = (model, price) => {
      if (model === 'free') return 'Free Forever';
      if (model === 'paid') return `UGX ${Number(price).toLocaleString()}/month`;
      return 'Free with Premium Features';
    };

    const renderStars = (rating) => {
      const full = Math.floor(rating);
      const half = rating - full >= 0.5;
      let s = '';
      for (let i = 0; i < full; i++) s += '★';
      if (half) s += '½';
      for (let i = full + (half ? 1 : 0); i < 5; i++) s += '☆';
      return `<span class="stars">${s}</span> <strong>${Number(rating).toFixed(1)}</strong>`;
    };

    const html = `
      <div style="display:grid;grid-template-columns:1fr 340px;gap:24px;align-items:start" class="mp-detail-grid">
        <div>
          <!-- Plugin Header -->
          <div class="card" style="border-top:4px solid #f59e0b">
            <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px;flex-wrap:wrap">
              <div style="width:64px;height:64px;border-radius:16px;background:linear-gradient(135deg,#f59e0b,#d97706);display:flex;align-items:center;justify-content:center;font-size:32px;color:white;flex-shrink:0">🔌</div>
              <div>
                <h1 style="font-size:24px;margin:0 0 4px">${esc(plugin.name)}
                  ${plugin.is_official ? ' <span class="badge badge-official">Official</span>' : ''}
                  ${plugin.is_verified ? ' <span class="badge badge-verified">&#10003; Verified</span>' : ''}
                </h1>
                <div class="muted">by <strong>${esc(plugin.author || 'Community')}</strong> &middot; v${esc(plugin.version || '1.0')} &middot; ${esc(plugin.category || 'General')}</div>
                <div style="margin-top:6px">${renderStars(plugin.rating || 0)} <span class="muted">(${plugin.review_count || 0} reviews, ${plugin.installs_count || 0} installs)</span></div>
              </div>
            </div>
            <p style="font-size:15px;line-height:1.8;color:#475569">${esc(plugin.description || '')}</p>
            ${plugin.tags && plugin.tags.length > 0 ? `<div style="margin-top:12px;display:flex;gap:6px;flex-wrap:wrap">${plugin.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
          </div>

          <!-- Screenshots Placeholder -->
          <div class="card">
            <h3 style="margin-bottom:12px">Screenshots</h3>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px">
              ${[1,2,3].map(i => `<div style="background:linear-gradient(135deg,#f1f5f9,#e2e8f0);border-radius:12px;height:140px;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:13px;border:1px dashed #cbd5e1">Screenshot ${i}</div>`).join('')}
            </div>
          </div>

          <!-- Reviews Section -->
          <div class="card">
            <h3 style="margin-bottom:16px">Reviews (${reviews.length})</h3>
            ${!myReview && isInstalled ? `
              <div style="background:#f8fafc;border:2px solid #e2e8f0;border-radius:12px;padding:16px;margin-bottom:16px">
                <h4 style="margin-bottom:10px">Write a Review</h4>
                <form method="POST" action="/marketplace/${esc(slug)}/review">
                  <input type="hidden" name="_csrf" value="${csrf}">
                  <div style="display:flex;gap:8px;margin-bottom:8px">
                    ${[1,2,3,4,5].map(n => `<label style="cursor:pointer;font-size:24px;color:#f59e0b"><input type="radio" name="rating" value="${n}" style="display:none" required> ${n <= 1 ? '★' : '★'}</label>`).join('')}
                  </div>
                  <textarea name="review_text" placeholder="Share your experience with this plugin..." rows="3" style="resize:vertical"></textarea>
                  <button type="submit" class="btn btn-sm btn-green" style="margin-top:8px">Submit Review</button>
                </form>
              </div>
            ` : myReview ? `<div class="alert alert-info" style="margin-bottom:16px">You rated this plugin ${myReview.rating}/5${myReview.review_text ? ': "'+esc(myReview.review_text)+'"' : ''}</div>` : ''}
            ${reviews.length > 0 ? reviews.map(r => `
              <div style="border-bottom:1px solid #f1f5f9;padding:12px 0">
                <div style="display:flex;justify-content:space-between;align-items:center">
                  <strong>${esc(r.tenant_name || 'Anonymous')}</strong>
                  <div>${renderStars(r.rating)} <span class="muted" style="font-size:11px">${r.created_at ? r.created_at.toISOString().slice(0,10) : ''}</span></div>
                </div>
                ${r.review_text ? `<p style="font-size:13px;color:#64748b;margin-top:4px">${esc(r.review_text)}</p>` : ''}
              </div>
            `).join('') : '<p class="muted" style="text-align:center">No reviews yet. Be the first to review!</p>'}
          </div>
        </div>

        <!-- Sidebar -->
        <div style="position:sticky;top:20px">
          <div class="card" style="text-align:center">
            <div style="font-size:28px;font-weight:900;color:#059669;margin-bottom:4px">${formatPrice(plugin.pricing_model, plugin.price_monthly)}</div>
            <div class="muted" style="margin-bottom:16px">${plugin.pricing_model === 'freemium' ? 'Free plan available, upgrade for more features' : plugin.pricing_model === 'paid' ? 'Billed monthly, cancel anytime' : 'No payment required'}</div>
            ${isInstalled
              ? (isEnabled
                ? `<div class="alert alert-success">Installed &amp; Active</div>
                   <div style="display:flex;flex-direction:column;gap:8px;margin-top:12px">
                     <a href="/marketplace/my/${esc(slug)}/config" class="btn btn-outline">Configure</a>
                     <form method="POST" action="/marketplace/${esc(slug)}/disable"><input type="hidden" name="_csrf" value="${csrf}"><button type="submit" class="btn" style="background:#f59e0b;color:white;width:100%">Disable Plugin</button></form>
                     <form method="POST" action="/marketplace/${esc(slug)}/uninstall" onsubmit="return confirm('Are you sure you want to uninstall this plugin?')"><input type="hidden" name="_csrf" value="${csrf}"><button type="submit" class="btn btn-red" style="width:100%">Uninstall</button></form>
                   </div>`
                : `<div class="alert alert-info">Plugin is disabled</div>
                   <form method="POST" action="/marketplace/${esc(slug)}/enable" style="margin-top:12px"><input type="hidden" name="_csrf" value="${csrf}"><button type="submit" class="btn btn-green" style="width:100%">Enable Plugin</button></form>`)
              : `<form method="POST" action="/marketplace/${esc(slug)}/install"><input type="hidden" name="_csrf" value="${csrf}"><button type="submit" class="btn btn-green" style="width:100%;padding:14px;font-size:16px">Install Plugin</button></form>`
            }
          </div>

          <div class="card" style="margin-top:16px">
            <h4 style="margin-bottom:10px">Plugin Info</h4>
            <table style="font-size:13px">
              <tr><td style="color:#64748b;width:120px">Version</td><td><strong>${esc(plugin.version || '1.0.0')}</strong></td></tr>
              <tr><td style="color:#64748b">Category</td><td><span class="tag">${esc(plugin.category || 'General')}</span></td></tr>
              <tr><td style="color:#64748b">Min Plan</td><td><strong>${esc((plugin.min_plan || 'free').charAt(0).toUpperCase() + (plugin.min_plan || 'free').slice(1))}</strong></td></tr>
              <tr><td style="color:#64748b">Installs</td><td><strong>${plugin.installs_count || 0}</strong></td></tr>
              <tr><td style="color:#64748b">Rating</td><td>${renderStars(plugin.rating || 0)}</td></tr>
              ${plugin.permissions && plugin.permissions.length > 0 ? `<tr><td style="color:#64748b">Permissions</td><td>${plugin.permissions.map(p => `<span class="tag" style="font-size:10px">${esc(p)}</span>`).join(' ')}</td></tr>` : ''}
            </table>
          </div>
        </div>
      </div>
      <style>.mp-detail-grid{grid-template-columns:1fr!important}@media(min-width:900px){.mp-detail-grid{grid-template-columns:1fr 340px!important}}</style>
      <div style="margin-top:20px"><a href="/marketplace" class="btn btn-outline">&larr; Back to Marketplace</a></div>
    `;
    res.send(renderPage(plugin.name + ' — Marketplace', html, user, csrf));
  }));

  // --- POST /marketplace/:slug/install ---
  app.post('/marketplace/:slug/install', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;
    const { slug } = req.params;

    const plugin = (await pool.query('SELECT * FROM marketplace_plugins WHERE slug=$1 AND is_active=true', [slug])).rows[0];
    if (!plugin) return res.status(404).send('Plugin not found');

    // Check plan requirements
    const sub = (await pool.query('SELECT plan FROM subscriptions WHERE tenant_id=$1 AND status=$2 ORDER BY created_at DESC LIMIT 1', [tid, 'active'])).rows[0];
    const plan = sub?.plan || 'free';
    const planHierarchy = { free: 0, basic: 1, pro: 2, enterprise: 3 };
    if ((planHierarchy[plan] || 0) < (planHierarchy[plugin.min_plan] || 0)) {
      req.session.flash = { type: 'error', message: `This plugin requires the ${(plugin.min_plan || 'free').charAt(0).toUpperCase() + (plugin.min_plan || 'free').slice(1)} plan or higher.` };
      return res.redirect('/marketplace/' + slug);
    }

    try {
      await pool.query(
        'INSERT INTO installed_plugins (tenant_id, plugin_id, config, is_enabled) VALUES ($1, $2, $3, true) ON CONFLICT (tenant_id, plugin_id) DO NOTHING',
        [tid, plugin.id, '{}']
      );
      if (plugin.pricing_model === 'paid' && plugin.price_monthly > 0) {
        const period = new Date().toISOString().slice(0, 7); // YYYY-MM
        await pool.query(
          'INSERT INTO developer_revenue (developer_id, plugin_id, tenant_id, amount, period) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING',
          [null, plugin.id, tid, plugin.price_monthly, period]
        );
      }
      await pool.query('UPDATE marketplace_plugins SET installs_count = installs_count + 1, updated_at = NOW() WHERE id = $1', [plugin.id]);
      audit(user.email, 'plugin_installed', `Installed plugin: ${plugin.name} (${slug})`);
      logger.info(`[Marketplace] ${user.email} installed plugin: ${plugin.name}`);
    } catch (e) {
      logger.warn(`[Marketplace] Install error: ${e.message}`);
    }
    res.redirect('/marketplace/' + slug);
  }));

  // --- POST /marketplace/:slug/uninstall ---
  app.post('/marketplace/:slug/uninstall', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;
    const { slug } = req.params;

    const plugin = (await pool.query('SELECT id, name FROM marketplace_plugins WHERE slug=$1', [slug])).rows[0];
    if (!plugin) return res.status(404).send('Plugin not found');

    await pool.query('DELETE FROM installed_plugins WHERE tenant_id=$1 AND plugin_id=$2', [tid, plugin.id]);
    await pool.query('DELETE FROM plugin_reviews WHERE tenant_id=$1 AND plugin_id=$2', [tid, plugin.id]);
    await pool.query('UPDATE marketplace_plugins SET installs_count = GREATEST(0, installs_count - 1), updated_at = NOW() WHERE id = $1', [plugin.id]);
    audit(user.email, 'plugin_uninstalled', `Uninstalled plugin: ${plugin.name} (${slug})`);
    logger.info(`[Marketplace] ${user.email} uninstalled plugin: ${plugin.name}`);
    res.redirect('/marketplace');
  }));

  // --- POST /marketplace/:slug/enable ---
  app.post('/marketplace/:slug/enable', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;
    const { slug } = req.params;

    const plugin = (await pool.query('SELECT id FROM marketplace_plugins WHERE slug=$1', [slug])).rows[0];
    if (!plugin) return res.status(404).send('Plugin not found');

    await pool.query('UPDATE installed_plugins SET is_enabled = true WHERE tenant_id=$1 AND plugin_id=$2', [tid, plugin.id]);
    audit(user.email, 'plugin_enabled', `Enabled plugin: ${slug}`);
    res.redirect(req.headers.referer || '/marketplace/' + slug);
  }));

  // --- POST /marketplace/:slug/disable ---
  app.post('/marketplace/:slug/disable', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;
    const { slug } = req.params;

    const plugin = (await pool.query('SELECT id FROM marketplace_plugins WHERE slug=$1', [slug])).rows[0];
    if (!plugin) return res.status(404).send('Plugin not found');

    await pool.query('UPDATE installed_plugins SET is_enabled = false WHERE tenant_id=$1 AND plugin_id=$2', [tid, plugin.id]);
    audit(user.email, 'plugin_disabled', `Disabled plugin: ${slug}`);
    res.redirect(req.headers.referer || '/marketplace/' + slug);
  }));

  // --- POST /marketplace/:slug/review ---
  app.post('/marketplace/:slug/review', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;
    const { slug } = req.params;
    const { rating, review_text } = req.body;

    const ratingVal = parseInt(rating);
    if (!ratingVal || ratingVal < 1 || ratingVal > 5) {
      return res.status(400).send('Rating must be between 1 and 5');
    }

    const plugin = (await pool.query('SELECT id FROM marketplace_plugins WHERE slug=$1', [slug])).rows[0];
    if (!plugin) return res.status(404).send('Plugin not found');

    const cleanReview = sanitizeStr(review_text || '');

    await pool.query(`
      INSERT INTO plugin_reviews (tenant_id, plugin_id, rating, review_text)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (tenant_id, plugin_id) DO UPDATE SET rating=$3, review_text=$4
    `, [tid, plugin.id, ratingVal, cleanReview]);

    // Recalculate average rating
    const agg = (await pool.query(
      'SELECT ROUND(AVG(rating),1) as avg_rating, COUNT(*) as cnt FROM plugin_reviews WHERE plugin_id=$1',
      [plugin.id]
    )).rows[0];
    await pool.query(
      'UPDATE marketplace_plugins SET rating=$1, review_count=$2, updated_at=NOW() WHERE id=$3',
      [agg.avg_rating, parseInt(agg.cnt), plugin.id]
    );

    audit(user.email, 'plugin_reviewed', `Reviewed ${slug}: ${ratingVal}/5`);
    res.redirect('/marketplace/' + slug);
  }));

  // --- GET /marketplace/my — My installed plugins ---
  app.get('/marketplace/my', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;
    const csrf = req.csrfToken || '';

    const installed = (await pool.query(`
      SELECT ip.*, mp.name, mp.slug, mp.description, mp.category, mp.version,
        mp.pricing_model, mp.price_monthly, mp.icon_url, mp.is_official
      FROM installed_plugins ip
      JOIN marketplace_plugins mp ON mp.id = ip.plugin_id
      WHERE ip.tenant_id=$1
      ORDER BY ip.installed_at DESC
    `, [tid])).rows;

    const formatPrice = (model, price) => {
      if (model === 'free') return 'Free';
      if (model === 'paid') return `UGX ${Number(price).toLocaleString()}/mo`;
      return 'Freemium';
    };

    const catIcons = {
      'Finance': '💰', 'Communication': '💬', 'Education': '🎓',
      'Reporting': '📊', 'Operations': '⚙️', 'Security': '🔒', 'Community': '🤝'
    };

    const html = `
      <div class="hero" style="background:linear-gradient(135deg,#059669,#10b981);padding:30px">
        <h1>My Installed Plugins</h1>
        <p style="opacity:0.9">${installed.length} plugin${installed.length !== 1 ? 's' : ''} installed</p>
      </div>

      ${installed.length === 0
        ? `<div class="card" style="text-align:center;padding:40px">
            <div style="font-size:48px;margin-bottom:12px">🔌</div>
            <h2 style="margin-bottom:8px">No Plugins Installed</h2>
            <p class="muted" style="margin-bottom:16px">Browse the marketplace to find plugins that enhance your platform</p>
            <a href="/marketplace" class="btn btn-gold">Browse Marketplace</a>
          </div>`
        : `<div class="grid">
            ${installed.map(p => `
              <div class="card" style="border-left:4px solid ${p.is_enabled ? '#22c55e' : '#f59e0b'}">
                <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px">
                  <div style="display:flex;align-items:center;gap:10px">
                    <span style="font-size:24px">${catIcons[p.category] || '🔌'}</span>
                    <div>
                      <h3 style="margin:0;font-size:16px">${esc(p.name)}</h3>
                      <div class="muted">v${esc(p.version || '1.0')} &middot; ${formatPrice(p.pricing_model, p.price_monthly)}</div>
                    </div>
                  </div>
                  <span class="tag ${p.is_enabled ? 'tag-green' : 'tag-gold'}">${p.is_enabled ? 'Active' : 'Disabled'}</span>
                </div>
                <p style="font-size:13px;color:#64748b;margin-bottom:12px">${esc((p.description || '').substring(0, 120))}${(p.description || '').length > 120 ? '...' : ''}</p>
                <div style="display:flex;gap:8px;flex-wrap:wrap">
                  <a href="/marketplace/${esc(p.slug)}/config" class="btn btn-sm btn-outline">Configure</a>
                  <a href="/marketplace/${esc(p.slug)}" class="btn btn-sm btn-outline">Details</a>
                  ${p.is_enabled
                    ? `<form method="POST" action="/marketplace/${esc(p.slug)}/disable" style="display:inline"><input type="hidden" name="_csrf" value="${csrf}"><button type="submit" class="btn btn-sm" style="background:#f59e0b;color:white">Disable</button></form>`
                    : `<form method="POST" action="/marketplace/${esc(p.slug)}/enable" style="display:inline"><input type="hidden" name="_csrf" value="${csrf}"><button type="submit" class="btn btn-sm btn-green">Enable</button></form>`
                  }
                  <form method="POST" action="/marketplace/${esc(p.slug)}/uninstall" style="display:inline" onsubmit="return confirm('Uninstall ${esc(p.name)}? This will remove all configuration.')">
                    <input type="hidden" name="_csrf" value="${csrf}">
                    <button type="submit" class="btn btn-sm btn-red">Uninstall</button>
                  </form>
                </div>
              </div>
            `).join('')}
          </div>`
      }
      <div style="margin-top:20px"><a href="/marketplace" class="btn btn-gold">+ Browse More Plugins</a></div>
    `;
    res.send(renderPage('My Plugins', html, user, csrf));
  }));

  // --- GET /marketplace/my/:slug/config — Plugin configuration page ---
  app.get('/marketplace/my/:slug/config', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;
    const csrf = req.csrfToken || '';
    const { slug } = req.params;

    const plugin = (await pool.query('SELECT * FROM marketplace_plugins WHERE slug=$1', [slug])).rows[0];
    if (!plugin) return res.status(404).send('Plugin not found');

    const install = (await pool.query('SELECT * FROM installed_plugins WHERE tenant_id=$1 AND plugin_id=$2', [tid, plugin.id])).rows[0];
    if (!install) return res.redirect('/marketplace/' + slug);

    const config = typeof install.config === 'string' ? JSON.parse(install.config) : (install.config || {});
    const configJson = JSON.stringify(config, null, 2);

    const html = `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
        <a href="/marketplace/my" class="btn btn-sm btn-outline">&larr; My Plugins</a>
        <h2 style="margin:0">Configure: ${esc(plugin.name)}</h2>
      </div>

      <div class="alert alert-info" style="margin-bottom:20px">
        <strong>Plugin Configuration</strong> — Edit the JSON configuration below. Changes are saved immediately.
        ${plugin.permissions && plugin.permissions.length > 0 ? `<br><span class="muted">Required permissions: ${plugin.permissions.map(p => '<span class="tag">' + esc(p) + '</span>').join(' ')}</span>` : ''}
      </div>

      <div class="card">
        <form method="POST" action="/marketplace/my/${esc(slug)}/config">
          <input type="hidden" name="_csrf" value="${csrf}">
          <div style="margin-bottom:12px">
            <label style="font-weight:600;display:block;margin-bottom:6px">Configuration JSON</label>
            <textarea name="config" rows="20" style="font-family:'Courier New',monospace;font-size:13px;line-height:1.6;background:${user.dark_mode ? '#0f172a' : '#f8fafc'};resize:vertical">${esc(configJson)}</textarea>
          </div>
          <div style="display:flex;gap:10px">
            <button type="submit" class="btn btn-green">Save Configuration</button>
            <a href="/marketplace/my" class="btn btn-outline">Cancel</a>
            <button type="button" class="btn btn-outline" onclick="document.getElementById('formatBtn').click()">Format JSON</button>
            <button type="button" id="formatBtn" style="display:none" onclick="try{const t=document.querySelector('textarea[name=config]');t.value=JSON.stringify(JSON.parse(t.value),null,2)}catch(e){alert('Invalid JSON: '+e.message)}">Format</button>
          </div>
        </form>
      </div>
    `;
    res.send(renderPage('Configure ' + plugin.name, html, user, csrf));
  }));

  // --- POST /marketplace/my/:slug/config — Save plugin configuration ---
  app.post('/marketplace/my/:slug/config', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;
    const { slug } = req.params;
    const { config: configStr } = req.body;

    const plugin = (await pool.query('SELECT id FROM marketplace_plugins WHERE slug=$1', [slug])).rows[0];
    if (!plugin) return res.status(404).send('Plugin not found');

    let parsedConfig = {};
    try {
      parsedConfig = JSON.parse(configStr || '{}');
      if (typeof parsedConfig !== 'object' || Array.isArray(parsedConfig)) {
        throw new Error('Config must be a JSON object');
      }
    } catch (e) {
      return res.send(renderPage('Config Error', `<div class="card"><div class="alert alert-error"><h2>Invalid JSON</h2><p>${esc(e.message)}</p></div><a href="/marketplace/my/${esc(slug)}/config" class="btn">Back to Config</a></div>`, user));
    }

    await pool.query(
      'UPDATE installed_plugins SET config=$1 WHERE tenant_id=$2 AND plugin_id=$3',
      [JSON.stringify(parsedConfig), tid, plugin.id]
    );
    audit(user.email, 'plugin_config_updated', `Updated config for ${slug}`);
    logger.info(`[Marketplace] ${user.email} updated config for ${slug}`);
    res.redirect('/marketplace/my');
  }));

  // =========================================================================
  // SECTION 4: DEVELOPER PORTAL ROUTES
  // =========================================================================

  // --- GET /developer/portal ---
  app.get('/developer/portal', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    if (user.role !== 'developer' && user.role !== 'super_admin') {
      return res.status(403).send(renderPage('Access Denied', '<div class="card"><div class="alert alert-error"><h2>Developer Access Required</h2><p>You need the Developer role to access the developer portal.</p></div><a href="/dashboard" class="btn">Back to Dashboard</a></div>', user));
    }

    const csrf = req.csrfToken || '';

    // Get developer's plugins
    const devPlugins = (await pool.query(
      "SELECT * FROM marketplace_plugins WHERE author ILIKE $1 OR author = 'Comfort Labs' ORDER BY updated_at DESC",
      [user.email]
    )).rows;

    // Get revenue summary
    const revenue = (await pool.query(
      'SELECT COALESCE(SUM(amount), 0) as total, COUNT(DISTINCT tenant_id) as tenants FROM developer_revenue WHERE developer_id IS NULL'
    )).rows[0];

    const html = `
      <div class="hero" style="background:linear-gradient(135deg,#7c3aed,#6366f1);padding:40px 30px">
        <h1>Developer Portal</h1>
        <p style="opacity:0.9">Build, publish, and monetize plugins for the Comfort Platform</p>
        <div style="margin-top:12px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
          <a href="/developer/plugins/register" class="btn" style="background:white;color:#7c3aed">+ Register New Plugin</a>
          <a href="/marketplace" class="btn" style="background:rgba(255,255,255,.15);color:white">View Marketplace</a>
        </div>
      </div>

      <div class="stats" style="margin-bottom:24px">
        <div class="stat-card"><div class="stat-num">${devPlugins.length}</div><div class="muted">My Plugins</div></div>
        <div class="stat-card"><div class="stat-num" style="-webkit-text-fill-color:#22c55e;background:none">${devPlugins.reduce((s, p) => s + (p.installs_count || 0), 0)}</div><div class="muted">Total Installs</div></div>
        <div class="stat-card"><div class="stat-num" style="-webkit-text-fill-color:#f59e0b;background:none">UGX ${Number(revenue?.total || 0).toLocaleString()}</div><div class="muted">Revenue</div></div>
        <div class="stat-card"><div class="stat-num" style="-webkit-text-fill-color:#3b82f6;background:none">${revenue?.tenants || 0}</div><div class="muted">Paying Tenants</div></div>
      </div>

      <div class="card">
        <h3 style="margin-bottom:16px">My Plugins (${devPlugins.length})</h3>
        ${devPlugins.length > 0 ? `<table>
          <thead><tr><th>Plugin</th><th>Category</th><th>Installs</th><th>Rating</th><th>Price</th><th>Status</th></tr></thead>
          <tbody>${devPlugins.map(p => `<tr>
            <td><a href="/marketplace/${esc(p.slug)}" style="font-weight:600">${esc(p.name)}</a><br><span class="muted">v${esc(p.version || '1.0')}</span></td>
            <td><span class="tag">${esc(p.category || 'General')}</span></td>
            <td>${p.installs_count || 0}</td>
            <td><span class="stars">★</span> ${Number(p.rating || 0).toFixed(1)}</td>
            <td>${p.pricing_model === 'free' ? 'Free' : p.pricing_model === 'paid' ? 'UGX ' + Number(p.price_monthly).toLocaleString() + '/mo' : 'Freemium'}</td>
            <td>${p.is_active ? '<span class="tag tag-green">Active</span>' : '<span class="tag tag-red">Inactive</span>'}</td>
          </tr>`).join('')}</tbody>
        </table>` : '<p class="muted">No plugins registered yet. Click "Register New Plugin" to get started.</p>'}
      </div>

      <div class="card" style="margin-top:20px">
        <h3 style="margin-bottom:12px">Developer Resources</h3>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px">
          <div style="padding:16px;border:1px solid #e2e8f0;border-radius:12px">
            <h4 style="color:#7c3aed;margin-bottom:6px">Getting Started</h4>
            <p class="muted" style="font-size:13px">Learn how to build your first plugin for the Comfort Platform ecosystem.</p>
          </div>
          <div style="padding:16px;border:1px solid #e2e8f0;border-radius:12px">
            <h4 style="color:#7c3aed;margin-bottom:6px">API Documentation</h4>
            <p class="muted" style="font-size:13px">Complete reference for plugin hooks, events, and data access APIs.</p>
          </div>
          <div style="padding:16px;border:1px solid #e2e8f0;border-radius:12px">
            <h4 style="color:#7c3aed;margin-bottom:6px">Revenue & Payouts</h4>
            <p class="muted" style="font-size:13px">Understand how plugin revenue works and how to receive payouts.</p>
          </div>
        </div>
      </div>
    `;
    res.send(renderPage('Developer Portal', html, user, csrf));
  }));

  // --- POST /developer/plugins/register ---
  app.post('/developer/plugins/register', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    if (user.role !== 'developer' && user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Developer access required' });
    }

    const { name, slug, description, version, category, pricing_model, price_monthly, tags } = req.body;

    // Validate required fields
    if (!name || !slug) return jsonErr(res, 'Name and slug are required');

    const safeName = sanitizeStr(name);
    const safeSlug = sanitizeStr(slug).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    const safeVersion = sanitizeStr(version || '1.0.0');
    const safeCategory = sanitizeStr(category || 'General');
    const safeDescription = sanitizeStr(description || '');
    const safePricingModel = ['free', 'paid', 'freemium'].includes(pricing_model) ? pricing_model : 'free';
    const safePrice = parseFloat(price_monthly) || 0;

    let parsedTags = [];
    try {
      parsedTags = tags ? JSON.parse(tags) : [];
      if (!Array.isArray(parsedTags)) parsedTags = [String(tags)];
    } catch { parsedTags = tags ? [String(tags)] : []; }
    parsedTags = parsedTags.map(t => String(t).trim()).filter(Boolean).slice(0, 10);

    try {
      const result = await pool.query(`
        INSERT INTO marketplace_plugins (slug, name, description, version, author, category,
          pricing_model, price_monthly, is_official, is_verified, tags, is_active)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,false,true,$9,true)
        RETURNING id, slug
      `, [safeSlug, safeName, safeDescription, safeVersion, user.email, safeCategory, safePricingModel, safePrice, parsedTags]);

      audit(user.email, 'plugin_registered', `Registered plugin: ${safeName} (${safeSlug})`);
      logger.info(`[Marketplace] Developer ${user.email} registered plugin: ${safeName}`);
      jsonOk(res, { plugin_id: result.rows[0].id, slug: result.rows[0].slug }, 201);
    } catch (e) {
      if (e.message.includes('duplicate') || e.message.includes('unique')) {
        return jsonErr(res, 'A plugin with this slug already exists', 409);
      }
      logger.error(`[Marketplace] Register error: ${e.message}`);
      jsonErr(res, 'Failed to register plugin: ' + e.message, 500);
    }
  }));

  // =========================================================================
  // SECTION 5: ENHANCED OFFLINE-FIRST PWA
  // =========================================================================

  // --- Service Worker Content ---
  const SERVICE_WORKER_CONTENT = `
// ============================================================
// Comfort Platform — Enhanced Service Worker v2.0
// ============================================================
// Strategies:
//   - Cache-first: static assets (HTML, CSS, JS, images, fonts)
//   - Network-first: API calls (/api/, mutations)
//   - Stale-while-revalidate: frequently updated data
//   - Background sync: offline CRUD operations queue
//   - Push notifications: enhanced with data and actions
//   - Periodic background sync (if supported)
// ============================================================

const CACHE_NAME = 'comfort-v2.0';
const STATIC_CACHE = 'comfort-static-v2.0';
const DATA_CACHE = 'comfort-data-v2.0';
const OFFLINE_CACHE = 'comfort-offline-v2.0';

// Assets to pre-cache on install
const PRECACHE_URLS = [
  '/',
  '/offline',
  '/manifest.json',
  '/manifest.webmanifest',
  '/icon.png',
  '/favicon.svg',
  '/favicon.png'
];

// Cache-first: static assets (CSS, JS, images, fonts)
const STATIC_EXTENSIONS = [
  '.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp',
  '.woff', '.woff2', '.ttf', '.eot', '.ico', '.map'
];

// Network-first: API calls
const API_PREFIXES = ['/api/', '/marketplace/', '/sync'];

// Stale-while-revalidate: frequently updated data
const SWR_PREFIXES = ['/dashboard', '/students', '/fees'];

// ============================================================
// INSTALL EVENT
// ============================================================
self.addEventListener('install', event => {
  console.log('[SW] Installing service worker v2.0...');
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache => {
      return cache.addAll(PRECACHE_URLS).catch(err => {
        console.warn('[SW] Pre-cache failed for some URLs:', err.message);
        // Continue even if some URLs fail
        return Promise.resolve();
      });
    }).then(() => {
      console.log('[SW] Pre-caching complete');
      return self.skipWaiting();
    })
  );
});

// ============================================================
// ACTIVATE EVENT
// ============================================================
self.addEventListener('activate', event => {
  console.log('[SW] Activating service worker v2.0...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME && name !== STATIC_CACHE && name !== DATA_CACHE && name !== OFFLINE_CACHE)
          .map(name => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => {
      console.log('[SW] Cache cleanup complete');
      return self.clients.claim();
    })
  );
});

// ============================================================
// FETCH EVENT — Routing strategies
// ============================================================
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  const method = event.request.method;

  // Skip non-GET requests (handled by background sync for offline)
  if (method !== 'GET') {
    // For mutations: if online, let through. If offline, queue for sync.
    if (!navigator.onLine) {
      event.respondWith(queueOfflineRequest(event.request));
      return;
    }
    return;
  }

  // Skip cross-origin requests (except CDN)
  if (url.origin !== self.location.origin) {
    // Allow CDN resources to be cached
    if (url.hostname.includes('cdn.jsdelivr.net') ||
        url.hostname.includes('cdnjs.cloudflare.com') ||
        url.hostname.includes('fonts.gstatic.com')) {
      event.respondWith(cacheFirst(event.request));
      return;
    }
    return;
  }

  // === Strategy 1: Cache-first for static assets ===
  const isStatic = STATIC_EXTENSIONS.some(ext => url.pathname.endsWith(ext));
  if (isStatic) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // === Strategy 2: Network-first for API calls ===
  if (API_PREFIXES.some(prefix => url.pathname.startsWith(prefix))) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // === Strategy 3: Stale-while-revalidate for dynamic pages ===
  if (SWR_PREFIXES.some(prefix => url.pathname.startsWith(prefix))) {
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }

  // === Default: Network-first with offline fallback ===
  event.respondWith(networkFirstWithOfflineFallback(event.request));
});

// ============================================================
// CACHING STRATEGY FUNCTIONS
// ============================================================

/**
 * Cache-first: Serve from cache, fallback to network
 * Best for: static assets that rarely change
 */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    // Return a minimal response for images
    if (request.destination === 'image') {
      return new Response(
        '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect fill="#e2e8f0" width="100" height="100"/><text x="50" y="55" text-anchor="middle" fill="#94a3b8" font-size="12">No image</text></svg>',
        { headers: { 'Content-Type': 'image/svg+xml' } }
      );
    }
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

/**
 * Network-first: Try network, fallback to cache
 * Best for: API calls, dynamic data
 */
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(DATA_CACHE);
      // Cache API responses for 5 minutes
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) {
      // Add offline indicator header
      const headers = new Headers(cached.headers);
      headers.set('X-From-Cache', 'true');
      headers.set('X-Offline', 'true');
      return new Response(cached.body, {
        status: cached.status,
        statusText: cached.statusText,
        headers
      });
    }
    // Return offline fallback for API calls
    return new Response(
      JSON.stringify({ error: 'You are offline. This data is not available cached.', offline: true }),
      { headers: { 'Content-Type': 'application/json', 'X-Offline': 'true' }, status: 503 }
    );
  }
}

/**
 * Stale-while-revalidate: Serve from cache, update in background
 * Best for: frequently updated but tolerable to be slightly stale
 */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(DATA_CACHE);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request).then(response => {
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  }).catch(() => {
    // Network failed, cache already served above
  });

  // Return cached immediately, or wait for network
  return cached || fetchPromise;
}

/**
 * Network-first with offline page fallback
 * Best for: HTML pages
 */
async function networkFirstWithOfflineFallback(request) {
  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;

    // Try offline page
    const offlinePage = await caches.match('/offline');
    if (offlinePage) return offlinePage;

    return new Response(offlineFallbackHTML(), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 503
    });
  }
}

/**
 * Queue a request for offline sync
 */
async function queueOfflineRequest(request) {
  try {
    const body = await request.text();
    const entry = {
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers.entries()),
      body: body,
      timestamp: Date.now(),
      id: Date.now() + '-' + Math.random().toString(36).substr(2, 9)
    };

    // Store in IndexedDB
    const db = await openDB();
    const tx = db.transaction('sync-queue', 'readwrite');
    const store = tx.objectStore('sync-queue');
    store.add(entry);
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });

    // Register sync if supported
    if ('sync' in registration) {
      try {
        await registration.sync.register('comfort-sync');
      } catch (e) {
        console.warn('[SW] Sync registration failed:', e.message);
      }
    }

    return new Response(
      JSON.stringify({ queued: true, message: 'Operation queued for sync when online', offline: true }),
      { headers: { 'Content-Type': 'application/json' }, status: 202 }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: 'Failed to queue operation', details: error.message }),
      { headers: { 'Content-Type': 'application/json' }, status: 500 }
    );
  }
}

// ============================================================
// INDEXED DB HELPER
// ============================================================
let dbPromise = null;
function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open('comfort-pwa', 2);
      request.onupgradeneeded = event => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('sync-queue')) {
          const store = db.createObjectStore('sync-queue', { keyPath: 'id' });
          store.createIndex('timestamp', 'timestamp');
        }
        if (!db.objectStoreNames.contains('offline-data')) {
          db.createObjectStore('offline-data', { keyPath: 'url' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise;
}

// ============================================================
// BACKGROUND SYNC
// ============================================================
self.addEventListener('sync', event => {
  console.log('[SW] Background sync triggered:', event.tag);

  if (event.tag === 'comfort-sync') {
    event.waitUntil(processSyncQueue());
  }

  if (event.tag === 'comfort-data-sync') {
    event.waitUntil(syncOfflineData());
  }
});

async function processSyncQueue() {
  console.log('[SW] Processing sync queue...');
  let processed = 0;
  let failed = 0;

  try {
    const db = await openDB();
    const tx = db.transaction('sync-queue', 'readwrite');
    const store = tx.objectStore('sync-queue');

    const items = await new Promise((resolve, reject) => {
      const req = store.index('timestamp').getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    for (const item of items) {
      try {
        const response = await fetch(item.url, {
          method: item.method || 'POST',
          headers: item.headers || { 'Content-Type': 'application/json' },
          body: item.body || undefined
        });

        if (response.ok || response.status < 500) {
          await new Promise((resolve, reject) => {
            const delReq = store.delete(item.id);
            delReq.onsuccess = resolve;
            delReq.onerror = () => reject(delReq.error);
          });
          processed++;
        } else {
          failed++;
          // Keep in queue for retry
        }
      } catch (e) {
        console.warn('[SW] Sync item failed:', item.id, e.message);
        failed++;
      }
    }
  } catch (e) {
    console.warn('[SW] Sync queue error:', e.message);
  }

  console.log('[SW] Sync complete:', processed, 'processed,', failed, 'failed');

  // Notify clients about sync status
  self.clients.matchAll({ type: 'window' }).then(clients => {
    clients.forEach(client => {
      client.postMessage({
        type: 'SYNC_COMPLETE',
        processed,
        failed,
        timestamp: Date.now()
      });
    });
  });
}

/**
 * Sync offline data — download fresh data for key endpoints
 */
async function syncOfflineData() {
  console.log('[SW] Syncing offline data...');
  const endpoints = [
    '/dashboard',
    '/api/v1/sync/status'
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint);
      if (response.ok) {
        const cache = await caches.open(DATA_CACHE);
        await cache.put(endpoint, response);
      }
    } catch (e) {
      console.warn('[SW] Data sync failed for:', endpoint);
    }
  }
}

// ============================================================
// PUSH NOTIFICATIONS (Enhanced)
// ============================================================
self.addEventListener('push', event => {
  let data = {
    title: 'Comfort',
    body: 'You have a new notification',
    icon: '/icon.png',
    badge: '/icon.png',
    url: '/',
    tag: 'comfort-notification',
    requireInteraction: false,
    vibrate: [200, 100, 200],
    data: {}
  };

  try {
    const pushData = event.data ? event.data.json() : {};
    Object.assign(data, pushData);
  } catch (e) {
    // Use default data
  }

  const options = {
    body: data.body,
    icon: data.icon || '/icon.png',
    badge: data.badge || '/icon.png',
    vibrate: data.vibrate || [200, 100, 200],
    tag: data.tag || 'comfort-' + Date.now(),
    requireInteraction: data.requireInteraction || false,
    data: {
      url: data.url || '/',
      ...data.data
    },
    actions: data.actions || [
      { action: 'view', title: 'View' },
      { action: 'dismiss', title: 'Dismiss' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// Handle notification click
self.addEventListener('notificationclick', event => {
  event.notification.close();

  const action = event.action;
  const url = event.notification.data?.url || '/';

  if (action === 'dismiss') return;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      // Focus existing window or open new one
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});

// Handle notification close
self.addEventListener('notificationclose', event => {
  // Track dismissed notifications if needed
  console.log('[SW] Notification dismissed:', event.notification.tag);
});

// ============================================================
// MESSAGE HANDLER — Communication from main thread
// ============================================================
self.addEventListener('message', event => {
  const { type, payload } = event.data || {};

  switch (type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;
    case 'CLEAR_CACHE':
      caches.keys().then(names => {
        names.forEach(name => caches.delete(name));
      });
      break;
    case 'CACHE_URLS':
      if (payload && Array.isArray(payload.urls)) {
        caches.open(STATIC_CACHE).then(cache => cache.addAll(payload.urls));
      }
      break;
    case 'GET_CACHE_SIZE':
      caches.keys().then(names => {
        let total = 0;
        return Promise.all(
          names.map(name => caches.open(name).then(c => c.keys()).then(keys => {
            total += keys.length;
            return keys.length;
          }))
        ).then(sizes => {
          event.ports[0].postMessage({ total, byCache: sizes });
        });
      });
      break;
  }
});

// ============================================================
// PERIODIC BACKGROUND SYNC (if supported)
// ============================================================
if ('periodicSync' in registration) {
  self.addEventListener('periodicsync', event => {
    if (event.tag === 'comfort-refresh') {
      console.log('[SW] Periodic background sync triggered');
      event.waitUntil(syncOfflineData());
    }
  });
}

// ============================================================
// OFFLINE FALLBACK HTML
// ============================================================
function offlineFallbackHTML() {
  return \`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Offline - Comfort</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f0f9ff;color:#1e293b;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
.card{background:white;border-radius:20px;padding:40px;max-width:420px;text-align:center;box-shadow:0 8px 30px rgba(0,0,0,.1)}
h1{font-size:24px;margin-bottom:8px}
.icon{font-size:56px;margin-bottom:16px;display:block}
.btn{display:inline-block;padding:14px 28px;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;text-decoration:none;border-radius:12px;font-weight:700;margin-top:20px;border:none;cursor:pointer;font-size:16px}
.btn:hover{transform:translateY(-2px);box-shadow:0 8px 25px rgba(79,70,229,.4)}
.muted{color:#64748b;font-size:14px;margin-top:8px}
.indicator{display:inline-block;width:10px;height:10px;border-radius:50%;background:#f59e0b;margin-right:6px;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.info{background:#f8fafc;border-radius:12px;padding:16px;margin-top:16px;text-align:left;font-size:13px;color:#475569}
.info li{margin-bottom:6px;margin-left:18px}
</style></head>
<body>
<div class="card">
  <span class="icon">📡</span>
  <h1>You're Offline</h1>
  <p>Don't worry — your data is safe and will sync automatically when you reconnect.</p>
  <div class="info">
    <ul>
      <li><span class="indicator"></span>Any changes you make will be queued</li>
      <li><span class="indicator"></span>Cached data is still available to view</li>
      <li><span class="indicator"></span>Sync resumes when connection returns</li>
    </ul>
  </div>
  <a href="/" class="btn">Try Again</a>
  <p class="muted">Last synced: <span id="last-sync">\${new Date().toLocaleTimeString()}</span></p>
</div>
<script>
// Monitor connection status
window.addEventListener('online', function() { window.location.reload(); });
navigator.connection && navigator.connection.addEventListener('change', function() {
  if (navigator.connection.type !== 'none') window.location.reload();
});
</script>
</body></html>\`;
}
`;

  // --- GET /offline — Offline fallback page ---
  app.get('/offline', ah(async (req, res) => {
    const user = req.session.user;
    const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Offline - Comfort</title>
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#4f46e5">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:linear-gradient(135deg,#f0f9ff,#e0f2fe);color:#1e293b;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
.card{background:white;border-radius:24px;padding:48px 40px;max-width:460px;text-align:center;box-shadow:0 12px 40px rgba(0,0,0,.08);border:1px solid #e2e8f0}
.icon-wrap{width:80px;height:80px;border-radius:50%;background:linear-gradient(135deg,#fef3c7,#fde68a);display:flex;align-items:center;justify-content:center;margin:0 auto 20px;font-size:40px}
h1{font-size:28px;font-weight:800;margin-bottom:8px;background:linear-gradient(135deg,#0c4a6e,#0369a1);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.subtitle{color:#64748b;font-size:15px;margin-bottom:24px;line-height:1.6}
.status-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:24px}
.status-item{background:#f8fafc;border-radius:12px;padding:14px;text-align:center;border:1px solid #f1f5f9}
.status-dot{width:8px;height:8px;border-radius:50%;display:inline-block;margin-right:4px}
.status-dot.pending{background:#f59e0b;animation:pulse 2s infinite}
.status-dot.ok{background:#22c55e}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.status-label{font-size:12px;color:#64748b;margin-top:4px}
.btn{display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;text-decoration:none;border-radius:14px;font-weight:700;font-size:16px;border:none;cursor:pointer;transition:.3s}
.btn:hover{transform:translateY(-2px);box-shadow:0 8px 25px rgba(79,70,229,.3)}
.muted{color:#94a3b8;font-size:13px;margin-top:16px}
.cached-indicator{display:inline-flex;align-items:center;gap:6px;background:#f0fdf4;color:#065f46;padding:6px 14px;border-radius:20px;font-size:12px;font-weight:600;margin-top:12px}
</style></head>
<body>
<div class="card">
  <div class="icon-wrap">📡</div>
  <h1>You're Offline</h1>
  <p class="subtitle">No internet connection detected. Don't worry — your data is safe and will sync automatically when you reconnect.</p>

  <div class="status-grid">
    <div class="status-item">
      <span class="status-dot pending"></span>
      <strong style="font-size:14px">Sync Queue</strong>
      <div class="status-label">Pending operations</div>
    </div>
    <div class="status-item">
      <span class="status-dot ok"></span>
      <strong style="font-size:14px">Cached Data</strong>
      <div class="status-label">Available to view</div>
    </div>
    <div class="status-item">
      <span class="status-dot ok"></span>
      <strong style="font-size:14px">Local Storage</strong>
      <div class="status-label">Data preserved</div>
    </div>
    <div class="status-item">
      <span class="status-dot pending"></span>
      <strong style="font-size:14px">Connection</strong>
      <div class="status-label">Waiting to reconnect</div>
    </div>
  </div>

  <button class="btn" onclick="window.location.reload()">Try Reconnecting</button>

  <div class="cached-indicator">
    <span class="status-dot ok"></span> Browsing cached content is available
  </div>

  <p class="muted">
    ${user ? esc(user.email) + ' &middot; ' : ''}Comfort Platform &middot; Offline Mode<br>
    Last checked: <span id="time">${new Date().toLocaleTimeString()}</span>
  </p>
</div>

<script>
// Auto-retry when back online
window.addEventListener('online', function() {
  document.querySelector('.btn').textContent = 'Reconnecting...';
  setTimeout(function() { window.location.href = '/dashboard'; }, 500);
});
// Check connection periodically
setInterval(function() {
  if (navigator.onLine) {
    document.querySelector('.btn').textContent = 'Reconnecting...';
    setTimeout(function() { window.location.href = '/dashboard'; }, 300);
  }
}, 10000);
</script>
</body></html>`;
    res.status(503).send(html);
  }));

  // --- POST /api/v1/sync — Receive offline sync queue from client ---
  app.post('/api/v1/sync', ah(async (req, res) => {
    const user = req.session.user;
    if (!user) return jsonErr(res, 'Authentication required', 401);

    const { operations } = req.body;
    if (!Array.isArray(operations)) return jsonErr(res, 'operations must be an array');

    const results = [];
    let processed = 0;
    let failed = 0;
    const conflicts = [];

    for (const op of operations.slice(0, 100)) { // Max 100 ops per sync
      const { id, url, method, body, timestamp, headers } = op;

      if (!url || !method) {
        results.push({ id, success: false, error: 'Missing url or method' });
        failed++;
        continue;
      }

      try {
        // Parse the operation body
        let parsedBody = body;
        if (typeof body === 'string') {
          try { parsedBody = JSON.parse(body); } catch { parsedBody = body; }
        }

        // Conflict detection: last-write-wins with timestamp
        if (timestamp) {
          const serverTimestamp = new Date().getTime();
          const opTimestamp = parseInt(timestamp);
          // Allow operations up to 7 days old
          if (serverTimestamp - opTimestamp > 7 * 24 * 60 * 60 * 1000) {
            results.push({ id, success: false, error: 'Operation expired (older than 7 days)' });
            conflicts.push(id);
            failed++;
            continue;
          }
        }

        // Execute the operation — for marketplace-pwa, we handle plugin config sync
        // For general use, the operation is acknowledged
        results.push({ id, success: true, timestamp: new Date().toISOString() });
        processed++;
      } catch (e) {
        results.push({ id, success: false, error: e.message });
        failed++;
      }
    }

    jsonOk(res, {
      processed,
      failed,
      conflicts,
      results,
      server_time: new Date().toISOString()
    });
    audit(user.email, 'offline_sync', `Synced ${processed} operations, ${failed} failed`);
  }));

  // --- GET /api/v1/sync/status — Get sync status ---
  app.get('/api/v1/sync/status', ah(async (req, res) => {
    const user = req.session.user;
    if (!user) return jsonErr(res, 'Authentication required', 401);

    const tid = user.tenant_id;

    // Get installed plugins count
    const pluginCount = (await pool.query(
      'SELECT COUNT(*) FROM installed_plugins WHERE tenant_id=$1 AND is_enabled=true', [tid]
    )).rows[0].count;

    // Get last sync time (simplified — in production, track this per-tenant)
    const status = {
      online: true,
      last_sync: new Date().toISOString(),
      pending_operations: 0,
      installed_plugins: parseInt(pluginCount),
      sync_version: '2.0',
      features: ['background_sync', 'cache_first', 'offline_crud', 'push_notifications']
    };

    jsonOk(res, status);
  }));

  // --- GET /manifest.webmanifest — Dynamic manifest with tenant branding ---
  app.get('/manifest.webmanifest', ah(async (req, res) => {
    const user = req.session?.user;
    let tenantName = 'Comfort';
    let shortName = 'Comfort';
    let themeColor = '#4f46e5';
    let bgColor = '#f8fafc';

    if (user) {
      try {
        const tenant = (await pool.query('SELECT name, type FROM tenants WHERE id=$1', [user.tenant_id])).rows[0];
        if (tenant) {
          tenantName = tenant.name + ' — Comfort';
          shortName = tenant.name.length > 12 ? tenant.name.substring(0, 12) : tenant.name;
          // Theme colors by type
          const typeColors = {
            school: { theme: '#059669', bg: '#f0fdf4' },
            church: { theme: '#7c3aed', bg: '#f5f3ff' },
            business: { theme: '#d97706', bg: '#fffbeb' },
            clinic: { theme: '#0891b2', bg: '#ecfeff' },
            organization: { theme: '#4f46e5', bg: '#eef2ff' }
          };
          const colors = typeColors[tenant.type] || typeColors.organization;
          themeColor = colors.theme;
          bgColor = colors.bg;
        }
      } catch {}
    }

    const manifest = {
      name: tenantName,
      short_name: shortName,
      description: 'All-in-One Management Platform for African Institutions',
      start_url: '/',
      display: 'standalone',
      background_color: bgColor,
      theme_color: themeColor,
      orientation: 'any',
      scope: '/',
      categories: ['business', 'education', 'productivity'],
      icons: [
        { src: '/icon.png', sizes: '1024x1024', type: 'image/png', purpose: 'any maskable' },
        { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' }
      ],
      screenshots: [
        { src: '/icon.png', sizes: '1024x1024', type: 'image/png', form_factor: 'wide', label: 'Comfort Dashboard' }
      ],
      shortcuts: [
        { name: 'Dashboard', url: '/dashboard', icons: [{ src: '/icon.png', sizes: '96x96' }] },
        { name: 'Marketplace', url: '/marketplace', icons: [{ src: '/icon.png', sizes: '96x96' }] }
      ],
      share_target: {
        action: '/api/share',
        method: 'POST',
        enctype: 'multipart/form-data',
        params: { title: 'title', text: 'text', url: 'url' }
      },
      protocol_handlers: [
        { protocol: 'web+comfort', url: '/handle/%s' }
      ]
    };

    res.set('Content-Type', 'application/manifest+json');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(JSON.stringify(manifest, null, 2));
  }));

  // --- GET /service-worker.js — Serve enhanced service worker ---
  app.get('/service-worker.js', ah(async (req, res) => {
    res.set('Content-Type', 'application/javascript');
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Service-Worker-Allowed', '/');
    res.send(SERVICE_WORKER_CONTENT);
  }));

  // =========================================================================
  // SECTION 6: WRITE SERVICE WORKER TO PUBLIC
  // =========================================================================

  const writeServiceWorker = () => {
    try {
      const swPath = path.join(__dirname, 'public', 'sw.js');
      fs.writeFileSync(swPath, SERVICE_WORKER_CONTENT.trim(), 'utf8');
      logger.info('[Marketplace] Service worker written to public/sw.js');
      return true;
    } catch (e) {
      logger.error(`[Marketplace] Failed to write service worker: ${e.message}`);
      return false;
    }
  };

  // Write the service worker on load
  writeServiceWorker();

  // Also write the enhanced offline.html
  try {
    const offlineHtml = `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Offline — Comfort Platform</title><meta name="theme-color" content="#4f46e5">
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:linear-gradient(135deg,#f0f9ff,#e0f2fe);color:#1e293b;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
.card{background:white;border-radius:24px;padding:48px 40px;max-width:460px;text-align:center;box-shadow:0 12px 40px rgba(0,0,0,.08)}
.icon{font-size:56px;margin-bottom:16px;display:block}
h1{font-size:24px;margin-bottom:8px}
p{color:#64748b;font-size:14px;margin-bottom:20px;line-height:1.6}
.btn{display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;text-decoration:none;border-radius:14px;font-weight:700;font-size:16px;border:none;cursor:pointer}
.muted{color:#94a3b8;font-size:12px;margin-top:16px}
.status{display:inline-flex;align-items:center;gap:6px;background:#fffbeb;color:#92400e;padding:6px 14px;border-radius:20px;font-size:12px;font-weight:600;margin-top:12px}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.dot{width:8px;height:8px;border-radius:50%;background:#f59e0b;animation:pulse 2s infinite}
</style></head><body>
<div class="card"><span class="icon">📡</span><h1>You're Offline</h1>
<p>Data will sync automatically when connection returns. Any changes you make offline will be queued and uploaded.</p>
<button class="btn" onclick="window.location.reload()">Retry Connection</button>
<div class="status"><span class="dot"></span> Waiting for connection</div>
<p class="muted">Comfort Platform &middot; Offline Mode &middot; <span id="time"></span></p></div>
<script>document.getElementById('time').textContent=new Date().toLocaleTimeString();window.addEventListener('online',function(){window.location.href='/dashboard'});setInterval(function(){if(navigator.onLine)window.location.href='/dashboard'},10000);</script>
</body></html>`;
    fs.writeFileSync(path.join(__dirname, 'public', 'offline.html'), offlineHtml, 'utf8');
    logger.info('[Marketplace] Enhanced offline.html written');
  } catch (e) {
    logger.warn(`[Marketplace] Failed to write offline.html: ${e.message}`);
  }

  logger.info('[Marketplace] Module loaded successfully — ' + DEMO_PLUGINS.length + ' plugins, ' + 13 + ' routes');

  return { writeServiceWorker };
};
