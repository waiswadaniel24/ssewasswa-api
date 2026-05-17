// ============================================================
// SCHOOL PORTAL v18 — PART 2 (Features 11-20)
// Multi-Tenant SaaS School Portal
// ============================================================
// Features:
//   11. School Public Website Pages
//   12. Comprehensive SEO Meta Tags
//   13. WCAG Accessibility Enhancement
//   14. Student Online Admission Form
//   15. School Bus GPS Tracking
//   16. Meal Plan Management
//   17. Sickbay Visit Tracking
//   18. School API Documentation
//   19. School Mobile App Web Manifest (PWA)
//   20. School Analytics & Insights Dashboard
// ============================================================

'use strict';

module.exports = function (app, pool, opts) {

  // ── Inline Helpers ──────────────────────────────────────────────────
  const esc = opts.esc || ((s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;'));
  const renderPage = opts.renderPage || ((t, c) => c);
  const requireAuth = opts.requireAuth || ((req, res, next) => {
    if (!req.session || !req.session.user) return res.redirect('/login');
    next();
  });
  const requireNotBanned = opts.requireNotBanned || ((req, res, next) => next());
  const trackRevenue = opts.trackRevenue || (() => {});
  const awardPoints = opts.awardPoints || (() => {});
  const queueEmail = opts.queueEmail || (() => {});
  const audit = opts.audit || (() => {});
  const uiT = opts.uiT || ((k) => k);

  const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const fmtMoney = (v) => '$' + parseFloat(v || 0).toFixed(2);
  const today = () => new Date().toISOString().slice(0, 10);
  const genToken = () => require('crypto').randomBytes(20).toString('hex');
  const cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';

  const COLORS = { primary: '#4f46e5', success: '#059669', warning: '#f59e0b', danger: '#dc2626' };

  function skipLink() {
    return '<a href="#main-content" style="position:absolute;left:-9999px;top:0;z-index:999;padding:8px 16px;background:#4f46e5;color:#fff;font-weight:600;text-decoration:none;" onfocus="this.style.left=\'0\'" onblur="this.style.left=\'-9999px\'">Skip to main content</a>';
  }

  function card(title, body, opts2) {
    const w = (opts2 && opts2.width) ? 'max-width:' + opts2.width + 'px;' : '';
    return '<div role="region" aria-label="' + esc(title) + '" style="background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.08);padding:24px;margin-bottom:20px;' + w + '">' +
      (title ? '<h2 style="font-size:18px;color:#1e293b;margin:0 0 16px;font-weight:700">' + title + '</h2>' : '') +
      body + '</div>';
  }

  function btn(label, href, color) {
    const bg = color || COLORS.primary;
    return '<a href="' + esc(href) + '" role="button" aria-label="' + esc(label) + '" style="display:inline-block;padding:9px 20px;background:' + bg + ';color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;cursor:pointer;transition:.15s">' + esc(label) + '</a>';
  }

  function badge(text, color) {
    return '<span role="status" style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;background:' + (color || '#e2e8f0') + ';color:#fff">' + esc(text) + '</span>';
  }

  function navBar(active, links) {
    return '<nav role="navigation" aria-label="Feature navigation" style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap">' +
      links.map(([label, href]) => {
        const isActive = active === label;
        return '<a href="' + esc(href) + '" aria-current="' + (isActive ? 'page' : 'false') + '" style="padding:8px 18px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:' + (isActive ? '#fff' : '#475569') + ';background:' + (isActive ? COLORS.primary : '#f1f5f9') + ';transition:.15s">' + esc(label) + '</a>';
      }).join('') + '</nav>';
  }

  function inputField(label, name, type, val, required, extra) {
    return '<div style="margin-bottom:14px"><label for="f_' + name + '" style="display:block;font-size:13px;font-weight:600;color:#475569;margin-bottom:4px">' + esc(label) + (required ? ' <span style="color:#dc2626">*</span>' : '') + '</label>' +
      '<input type="' + (type || 'text') + '" id="f_' + name + '" name="' + name + '" value="' + esc(val || '') + '" ' + (required ? 'required' : '') + ' style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;box-sizing:border-box" ' + (extra || '') + '></div>';
  }

  function selectField(label, name, options, val) {
    return '<div style="margin-bottom:14px"><label for="f_' + name + '" style="display:block;font-size:13px;font-weight:600;color:#475569;margin-bottom:4px">' + esc(label) + '</label>' +
      '<select id="f_' + name + '" name="' + name + '" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;box-sizing:border-box">' +
      options.map(([v, l]) => '<option value="' + esc(v) + '"' + (val === v ? ' selected' : '') + '>' + esc(l) + '</option>').join('') +
      '</select></div>';
  }

  function textAreaField(label, name, rows, val) {
    return '<div style="margin-bottom:14px"><label for="f_' + name + '" style="display:block;font-size:13px;font-weight:600;color:#475569;margin-bottom:4px">' + esc(label) + '</label>' +
      '<textarea id="f_' + name + '" name="' + name + '" rows="' + (rows || 3) + '" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;box-sizing:border-box">' + esc(val || '') + '</textarea></div>';
  }

  function dataTable(headers, rows) {
    const thStyle = 'padding:11px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#f8fafc';
    const tdStyle = 'padding:10px 14px;border-bottom:1px solid #f1f5f9;color:#1e293b;font-size:13px';
    let html = '<div style="overflow-x:auto" role="region" aria-label="Data table"><table role="table" style="width:100%;border-collapse:collapse"><thead><tr>' +
      headers.map(h => '<th scope="col" style="' + thStyle + '">' + esc(h) + '</th>').join('') + '</tr></thead><tbody>';
    if (rows && rows.length) {
      html += rows.map(r => '<tr>' + r.map(c => '<td style="' + tdStyle + '">' + c + '</td>').join('') + '</tr>').join('');
    } else {
      html += '<tr><td colspan="' + headers.length + '" style="' + tdStyle + 'text-align:center;color:#94a3b8;padding:30px">No data available</td></tr>';
    }
    html += '</tbody></table></div>';
    return html;
  }

  // ================================================================
  // FEATURE 12: SEO Helper (used globally)
  // ================================================================
  function generateSEO(title, description, url, image) {
    const baseUrl = (process.env.BASE_URL || 'https://school.example.com');
    const fullUrl = url ? (url.startsWith('http') ? url : baseUrl + url) : baseUrl;
    const img = image || baseUrl + '/public/icon.png';
    return [
      '<meta name="description" content="' + esc(description || title) + '">',
      '<meta property="og:title" content="' + esc(title) + '">',
      '<meta property="og:description" content="' + esc(description || title) + '">',
      '<meta property="og:image" content="' + esc(img) + '">',
      '<meta property="og:url" content="' + esc(fullUrl) + '">',
      '<meta property="og:type" content="website">',
      '<meta name="twitter:card" content="summary_large_image">',
      '<meta name="twitter:title" content="' + esc(title) + '">',
      '<meta name="twitter:description" content="' + esc(description || title) + '">',
      '<link rel="canonical" href="' + esc(fullUrl) + '">'
    ].join('\n');
  }

  // ================================================================
  // DATABASE MIGRATIONS
  // ================================================================
  (async () => {
    const c = await pool.connect().catch(() => null);
    if (!c) { console.error('[School-v18-b] Cannot connect to DB'); return; }
    try {
      // ── Feature 11: school_public_pages ──
      await c.query(`CREATE TABLE IF NOT EXISTS school_public_pages (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        slug VARCHAR(100) UNIQUE NOT NULL, title VARCHAR(255) NOT NULL,
        content TEXT DEFAULT '', meta_title VARCHAR(255), meta_description TEXT,
        status VARCHAR(20) DEFAULT 'published', sort_order INTEGER DEFAULT 0,
        created_by INTEGER, updated_at TIMESTAMPTZ DEFAULT NOW(), created_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      // ── Feature 13: user_accessibility_settings ──
      await c.query(`CREATE TABLE IF NOT EXISTS user_accessibility_settings (
        id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        font_size VARCHAR(10) DEFAULT 'medium', high_contrast BOOLEAN DEFAULT false,
        reduced_motion BOOLEAN DEFAULT false, screen_reader_optimized BOOLEAN DEFAULT false,
        focus_highlight BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      // ── Feature 14: public_admission_applications ──
      await c.query(`CREATE TABLE IF NOT EXISTS public_admission_applications (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        reference_number VARCHAR(20) UNIQUE NOT NULL,
        student_name VARCHAR(255) NOT NULL, date_of_birth DATE, gender VARCHAR(20),
        previous_school TEXT, class_applying VARCHAR(100),
        parent_name VARCHAR(255), parent_phone VARCHAR(50), parent_email VARCHAR(255),
        address TEXT, medical_conditions TEXT, emergency_contact_name VARCHAR(255),
        emergency_contact_phone VARCHAR(50),
        documents JSONB DEFAULT '[]',
        status VARCHAR(20) DEFAULT 'submitted', admin_notes TEXT,
        reviewed_by INTEGER, reviewed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      // ── Feature 15: bus_trips + bus_trip_logs ──
      await c.query(`CREATE TABLE IF NOT EXISTS bus_trips (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        route_id INTEGER REFERENCES transport_routes(id),
        vehicle_id INTEGER REFERENCES transport_vehicles(id),
        trip_date DATE NOT NULL DEFAULT CURRENT_DATE,
        direction VARCHAR(10) DEFAULT 'morning',
        status VARCHAR(20) DEFAULT 'planned',
        driver_name VARCHAR(255), driver_phone VARCHAR(50),
        started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ,
        total_students INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await c.query(`CREATE TABLE IF NOT EXISTS bus_trip_logs (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        trip_id INTEGER NOT NULL REFERENCES bus_trips(id) ON DELETE CASCADE,
        latitude NUMERIC(10,7), longitude NUMERIC(10,7),
        speed NUMERIC(5,2) DEFAULT 0, heading INTEGER,
        stop_name VARCHAR(255), students_onboard INTEGER DEFAULT 0,
        logged_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      // ── Feature 16: meal_plans, meal_schedules, meal_attendance ──
      await c.query(`CREATE TABLE IF NOT EXISTS meal_plans_v18 (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL, description TEXT, cost_per_term NUMERIC(10,2) DEFAULT 0,
        applicable_to VARCHAR(20) DEFAULT 'all', status VARCHAR(20) DEFAULT 'active',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await c.query(`CREATE TABLE IF NOT EXISTS meal_schedules (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        plan_id INTEGER REFERENCES meal_plans_v18(id) ON DELETE CASCADE,
        day_of_week VARCHAR(10) NOT NULL, meal_type VARCHAR(20) NOT NULL,
        menu_items TEXT NOT NULL, calories INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await c.query(`CREATE TABLE IF NOT EXISTS meal_attendance_v18 (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        plan_id INTEGER REFERENCES meal_plans_v18(id),
        student_id INTEGER, student_name VARCHAR(255),
        meal_date DATE NOT NULL DEFAULT CURRENT_DATE,
        meal_type VARCHAR(20) NOT NULL, items_consumed TEXT,
        served_by VARCHAR(255), created_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      // ── Feature 17: sickbay_visits, sickbay_medicine_inventory ──
      await c.query(`CREATE TABLE IF NOT EXISTS sickbay_visits (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        student_id INTEGER, student_name VARCHAR(255) NOT NULL,
        visit_date DATE NOT NULL DEFAULT CURRENT_DATE,
        time_in TIME NOT NULL DEFAULT CURRENT_TIME,
        time_out TIME, complaint TEXT NOT NULL,
        diagnosis TEXT, treatment TEXT,
        nurse_name VARCHAR(255), follow_up_needed BOOLEAN DEFAULT false,
        parent_notified BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await c.query(`CREATE TABLE IF NOT EXISTS sickbay_medicine_inventory (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        medicine_name VARCHAR(255) NOT NULL, category VARCHAR(50),
        quantity INTEGER DEFAULT 0, unit VARCHAR(20) DEFAULT 'tablets',
        reorder_level INTEGER DEFAULT 10, expiry_date DATE,
        supplier VARCHAR(255), notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      // ── Feature 18: api_keys (ensure exists) ──
      await c.query(`CREATE TABLE IF NOT EXISTS api_keys (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id),
        key_value VARCHAR(64) UNIQUE NOT NULL, key_name VARCHAR(100),
        permissions TEXT[] DEFAULT '{}', rate_limit INTEGER DEFAULT 100,
        last_used_at TIMESTAMPTZ, request_count INTEGER DEFAULT 0,
        status VARCHAR(20) DEFAULT 'active', expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      // ── Indexes ──
      const indexes = [
        'CREATE INDEX IF NOT EXISTS idx_spp_tenant ON school_public_pages(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_spp_slug ON school_public_pages(slug)',
        'CREATE INDEX IF NOT EXISTS idx_uas_user ON user_accessibility_settings(user_id)',
        'CREATE INDEX IF NOT EXISTS idx_paa_tenant ON public_admission_applications(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_paa_ref ON public_admission_applications(reference_number)',
        'CREATE INDEX IF NOT EXISTS idx_paa_status ON public_admission_applications(tenant_id,status)',
        'CREATE INDEX IF NOT EXISTS idx_bt_tenant ON bus_trips(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_btl_trip ON bus_trip_logs(trip_id)',
        'CREATE INDEX IF NOT EXISTS idx_mp_v18_tenant ON meal_plans_v18(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_ms_tenant ON meal_schedules(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_ma_v18_tenant ON meal_attendance_v18(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_sv_tenant ON sickbay_visits(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_smi_tenant ON sickbay_medicine_inventory(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_ak_tenant ON api_keys(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_ak_value ON api_keys(key_value)',
      ];
      for (const sql of indexes) { try { await c.query(sql); } catch (_) {} }

      console.log('[School-v18-b] Migrations applied successfully');
    } catch (e) {
      console.error('[School-v18-b] Migration error:', e.message);
    } finally {
      c.release();
    }
  })();

  // ================================================================
  // FEATURE 11: School Public Website Pages
  // ================================================================

  // 11a: Public page view (no auth required)
  app.get('/public/school/:slug', ah(async (req, res) => {
    const slug = req.params.slug;
    const page = (await pool.query(
      'SELECT * FROM school_public_pages WHERE slug=$1 AND status=$2', [slug, 'published']
    )).rows[0];
    if (!page) return res.status(404).send('<h1>Page Not Found</h1><p>The requested page does not exist.</p>');

    const tenantInfo = (await pool.query(
      'SELECT name FROM tenants WHERE id=$1', [page.tenant_id]
    )).rows[0];

    const seoTags = generateSEO(
      page.meta_title || page.title,
      page.meta_description || page.title.substring(0, 160),
      '/public/school/' + page.slug
    );

    const html = skipLink() +
      '<div id="main-content" role="main" style="max-width:900px;margin:0 auto;padding:20px">' +
      '<header role="banner" style="margin-bottom:30px">' +
      '<a href="/public/school" style="text-decoration:none;color:' + COLORS.primary + ';font-weight:700;font-size:14px">&larr; Back to School Pages</a>' +
      '<h1 style="font-size:32px;color:#1e293b;margin:12px 0 8px">' + esc(page.title) + '</h1>' +
      '<p style="font-size:13px;color:#94a3b8">' + esc(tenantInfo ? tenantInfo.name : '') + ' &middot; ' + fmtDate(page.updated_at) + '</p>' +
      '</header>' +
      '<article role="article" style="line-height:1.8;color:#334155;font-size:16px">' + page.content + '</article>' +
      '</div>';
    res.send(renderPage(page.title, html, null, req, seoTags));
  }));

  // 11b: Public pages index
  app.get('/public/school', ah(async (req, res) => {
    const tenantRows = (await pool.query(
      "SELECT spp.*, t.name as school_name FROM school_public_pages spp JOIN tenants t ON t.id=spp.tenant_id WHERE spp.status='published' ORDER BY t.name, spp.sort_order"
    )).rows;

    const grouped = {};
    tenantRows.forEach(p => {
      if (!grouped[p.school_name]) grouped[p.school_name] = [];
      grouped[p.school_name].push(p);
    });

    let pagesHtml = '';
    for (const [school, pages] of Object.entries(grouped)) {
      pagesHtml += '<div style="margin-bottom:24px"><h2 style="font-size:20px;color:#1e293b;margin:0 0 12px">' + esc(school) + '</h2>';
      pages.forEach(p => {
        pagesHtml += '<a href="/public/school/' + esc(p.slug) + '" role="link" style="display:block;padding:12px 16px;background:#f8fafc;border-radius:10px;margin-bottom:6px;text-decoration:none;color:#1e293b;font-weight:600;border:1px solid #e2e8f0;transition:.15s">' +
          esc(p.title) + '<span style="font-weight:400;color:#94a3b8;font-size:12px;margin-left:8px">' + esc(p.meta_description ? p.meta_description.substring(0, 80) + '...' : '') + '</span></a>';
      });
      pagesHtml += '</div>';
    }

    const seoTags = generateSEO('School Information Pages', 'Browse all public school pages, about us, mission, facilities, and contact information.');
    const html = skipLink() + '<div id="main-content" role="main" style="max-width:800px;margin:0 auto;padding:20px">' +
      '<h1 style="font-size:28px;color:#1e293b;margin-bottom:8px">' + uiT('school_pages') + '</h1>' +
      '<p style="color:#64748b;margin-bottom:24px">Browse school information pages</p>' +
      (pagesHtml || '<div role="status" style="text-align:center;color:#94a3b8;padding:40px">No public pages available yet.</div>') +
      '</div>';
    res.send(renderPage('School Pages', html, null, req, seoTags));
  }));

  // 11c: Admin page management dashboard
  app.get('/school/pages', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;
    const pages = (await pool.query(
      'SELECT * FROM school_public_pages WHERE tenant_id=$1 ORDER BY sort_order, title', [tid]
    )).rows;

    const rows = pages.map(p => [
      '<a href="/public/school/' + esc(p.slug) + '" style="color:' + COLORS.primary + ';font-weight:600;text-decoration:none">' + esc(p.title) + '</a>',
      '<code style="font-size:11px;color:#94a3b8">/' + esc(p.slug) + '</code>',
      badge(p.status === 'published' ? 'Published' : 'Draft', p.status === 'published' ? COLORS.success : '#94a3b8'),
      fmtDate(p.updated_at),
      '<form method="POST" action="/school/pages/' + p.id + '/delete" style="display:inline" onsubmit="return confirm(\'Delete ' + esc(p.title).replace(/'/g, "\\'") + '?\')">' +
      '<button type="submit" style="padding:5px 12px;background:#fee2e2;color:#dc2626;border:none;border-radius:6px;font-size:12px;cursor:pointer" aria-label="Delete page ' + esc(p.title) + '">Delete</button></form>'
    ]);

    const links = [['Page Manager', '/school/pages'], ['SEO Settings', '/school/seo'], ['Accessibility', '/school/accessibility']];
    const content = navBar('Page Manager', links) +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:12px">' +
      '<div><h1 style="font-size:22px;color:#1e293b">' + uiT('public_pages') + '</h1><p style="font-size:13px;color:#94a3b8">Manage public website pages</p></div>' +
      btn('Create Page', '/school/pages/new', COLORS.success) +
      '</div>' +
      card('', dataTable(['Title', 'Slug', 'Status', 'Updated', 'Actions'], rows));

    res.send(renderPage('Public Pages Manager', skipLink() + '<div id="main-content" role="main" style="max-width:1100px;margin:0 auto;padding:20px">' + content + '</div>', user, req));
  }));

  // 11d: Create page form
  app.get('/school/pages/new', requireAuth, requireNotBanned, (req, res) => {
    const user = req.session.user;
    const formHtml = '<form method="POST" action="/school/pages/create" role="form" aria-label="Create public page">' +
      inputField('Page Title', 'title', 'text', '', true, 'placeholder="e.g. About Us"') +
      inputField('URL Slug', 'slug', 'text', '', true, 'placeholder="e.g. about-us (lowercase, hyphens)"') +
      selectField('Status', 'status', [['draft', 'Draft'], ['published', 'Published']], 'published') +
      inputField('Meta Title', 'meta_title', 'text', '', false, 'placeholder="SEO title (optional)"') +
      inputField('Meta Description', 'meta_description', 'text', '', false, 'placeholder="SEO description (optional)"') +
      '<div style="margin-bottom:14px"><label for="f_content" style="display:block;font-size:13px;font-weight:600;color:#475569;margin-bottom:4px">Page Content</label>' +
      '<textarea id="f_content" name="content" rows="14" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;box-sizing:border-box;font-family:monospace" placeholder="HTML content allowed"></textarea></div>' +
      inputField('Sort Order', 'sort_order', 'number', '0', false, 'min="0"') +
      '<div style="display:flex;gap:10px;margin-top:8px">' +
      '<button type="submit" style="padding:11px 28px;background:' + COLORS.primary + ';color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer">Save Page</button>' +
      '<a href="/school/pages" style="padding:11px 28px;background:#f1f5f9;color:#475569;border-radius:10px;font-size:14px;font-weight:600;text-decoration:none">Cancel</a>' +
      '</div></form>';

    res.send(renderPage('Create Page', skipLink() + '<div id="main-content" role="main" style="max-width:800px;margin:0 auto;padding:20px">' +
      card('Create Public Page', formHtml) + '</div>', user, req));
  });

  // 11e: Save page
  app.post('/school/pages/create', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { title, slug, content, status, meta_title, meta_description, sort_order } = req.body;
    if (!title || !title.trim() || !slug || !slug.trim()) {
      return res.redirect('/school/pages/new');
    }
    const cleanSlug = slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-');
    try {
      await pool.query(
        `INSERT INTO school_public_pages (tenant_id,slug,title,content,meta_title,meta_description,status,sort_order,created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [tid, cleanSlug, title.trim(), content || '', meta_title || null, meta_description || null, status || 'draft', parseInt(sort_order) || 0, user.id]
      );
      audit(user.email, 'page_created', 'Created page: ' + title.trim());
    } catch (e) {
      if (e.code === '23505') {
        return res.send('<div style="padding:20px;color:#dc2626">A page with this slug already exists. <a href="/school/pages/new">Try again</a></div>');
      }
      throw e;
    }
    res.redirect('/school/pages');
  }));

  // 11f: Delete page
  app.post('/school/pages/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query('DELETE FROM school_public_pages WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    audit(req.session.user.email, 'page_deleted', 'Deleted page ID: ' + req.params.id);
    res.redirect('/school/pages');
  }));

  // ================================================================
  // FEATURE 12: SEO Meta Tags + Sitemap + Robots
  // ================================================================

  // 12a: Sitemap XML
  app.get('/sitemap.xml', ah(async (req, res) => {
    const pages = (await pool.query(
      "SELECT spp.slug, spp.updated_at, t.name FROM school_public_pages spp JOIN tenants t ON t.id=spp.tenant_id WHERE spp.status='published'"
    )).rows;

    const baseUrl = process.env.BASE_URL || 'https://school.example.com';
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
    xml += '  <url><loc>' + baseUrl + '/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>\n';
    xml += '  <url><loc>' + baseUrl + '/public/school</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>\n';
    pages.forEach(p => {
      const lastmod = p.updated_at ? p.updated_at.toISOString().split('T')[0] : today();
      xml += '  <url><loc>' + baseUrl + '/public/school/' + esc(p.slug) + '</loc><lastmod>' + lastmod + '</lastmod><changefreq>monthly</changefreq><priority>0.6</priority></url>\n';
    });
    xml += '</urlset>';
    res.set('Content-Type', 'application/xml');
    res.send(xml);
  }));

  // 12b: robots.txt
  app.get('/robots.txt', (req, res) => {
    const baseUrl = process.env.BASE_URL || 'https://school.example.com';
    const txt = 'User-agent: *\nAllow: /\nSitemap: ' + baseUrl + '/sitemap.xml\nDisallow: /admin/\nDisallow: /school/pages/new\n';
    res.set('Content-Type', 'text/plain');
    res.send(txt);
  });

  // 12c: SEO admin page
  app.get('/school/seo', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const pages = (await pool.query(
      'SELECT slug, title, meta_title, meta_description, status FROM school_public_pages WHERE tenant_id=$1 ORDER BY title', [tid]
    )).rows;

    const rows = pages.map(p => {
      const seoScore = (!p.meta_title ? 0 : 1) + (!p.meta_description ? 0 : 1);
      const scoreColor = seoScore >= 2 ? COLORS.success : seoScore === 1 ? COLORS.warning : COLORS.danger;
      return [
        '<a href="/public/school/' + esc(p.slug) + '" style="color:' + COLORS.primary + ';text-decoration:none;font-weight:600">' + esc(p.title) + '</a>',
        esc(p.meta_title || '<em style="color:#94a3b8">Missing</em>'),
        esc(p.meta_description ? p.meta_description.substring(0, 50) + '...' : '<em style="color:#94a3b8">Missing</em>'),
        badge(seoScore + '/2', scoreColor),
        badge(p.status, p.status === 'published' ? COLORS.success : '#94a3b8')
      ];
    });

    const links = [['Page Manager', '/school/pages'], ['SEO Settings', '/school/seo'], ['Accessibility', '/school/accessibility']];
    const content = navBar('SEO Settings', links) +
      '<h1 style="font-size:22px;color:#1e293b;margin-bottom:8px">' + uiT('seo_settings') + '</h1>' +
      '<p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Manage SEO meta tags for public pages</p>' +
      card('SEO Overview', '<p style="font-size:13px;color:#64748b;margin-bottom:16px">Each page should have a unique title and description for optimal search engine ranking. Score: 2/2 = fully optimized.</p>' +
        dataTable(['Page', 'Meta Title', 'Meta Description', 'Score', 'Status'], rows)) +
      card('Quick Links', '<div style="display:flex;gap:12px;flex-wrap:wrap">' +
        '<a href="/sitemap.xml" target="_blank" style="padding:10px 20px;background:#f1f5f9;border-radius:10px;text-decoration:none;color:#475569;font-weight:600">View sitemap.xml</a>' +
        '<a href="/robots.txt" target="_blank" style="padding:10px 20px;background:#f1f5f9;border-radius:10px;text-decoration:none;color:#475569;font-weight:600">View robots.txt</a>' +
        '</div>');

    res.send(renderPage('SEO Settings', skipLink() + '<div id="main-content" role="main" style="max-width:1100px;margin:0 auto;padding:20px">' + content + '</div>', user, req));
  }));

  // ================================================================
  // FEATURE 13: WCAG Accessibility Enhancement
  // ================================================================

  app.get('/school/accessibility', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user;
    const uid = user.id;

    let settings = (await pool.query(
      'SELECT * FROM user_accessibility_settings WHERE user_id=$1', [uid]
    )).rows[0];

    const links = [['Page Manager', '/school/pages'], ['SEO Settings', '/school/seo'], ['Accessibility', '/school/accessibility']];
    const formHtml = '<form method="POST" action="/school/accessibility/save" role="form" aria-label="Accessibility settings">' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">' +
      '<div>' + selectField('Font Size', 'font_size', [['small', 'Small (14px)'], ['medium', 'Medium (16px) — Default'], ['large', 'Large (18px)'], ['xlarge', 'Extra Large (20px)']], settings ? settings.font_size : 'medium') + '</div>' +
      '<div><label style="display:block;font-size:13px;font-weight:600;color:#475569;margin-bottom:4px">High Contrast Mode</label>' +
      '<label style="display:flex;align-items:center;gap:10px;padding:12px;background:#f8fafc;border-radius:10px;cursor:pointer">' +
      '<input type="checkbox" name="high_contrast" value="true" ' + (settings && settings.high_contrast ? 'checked' : '') + ' style="width:20px;height:20px" role="switch" aria-checked="' + (settings && settings.high_contrast ? 'true' : 'false') + '"> ' +
      '<span style="font-size:14px">Increase color contrast for better readability</span></label></div>' +
      '<div><label style="display:block;font-size:13px;font-weight:600;color:#475569;margin-bottom:4px">Reduced Motion</label>' +
      '<label style="display:flex;align-items:center;gap:10px;padding:12px;background:#f8fafc;border-radius:10px;cursor:pointer">' +
      '<input type="checkbox" name="reduced_motion" value="true" ' + (settings && settings.reduced_motion ? 'checked' : '') + ' style="width:20px;height:20px" role="switch" aria-checked="' + (settings && settings.reduced_motion ? 'true' : 'false') + '"> ' +
      '<span style="font-size:14px">Minimize animations and transitions</span></label></div>' +
      '<div><label style="display:block;font-size:13px;font-weight:600;color:#475569;margin-bottom:4px">Screen Reader Optimized</label>' +
      '<label style="display:flex;align-items:center;gap:10px;padding:12px;background:#f8fafc;border-radius:10px;cursor:pointer">' +
      '<input type="checkbox" name="screen_reader_optimized" value="true" ' + (settings && settings.screen_reader_optimized ? 'checked' : '') + ' style="width:20px;height:20px" role="switch" aria-checked="' + (settings && settings.screen_reader_optimized ? 'true' : 'false') + '"> ' +
      '<span style="font-size:14px">Enable enhanced ARIA labels and landmarks</span></label></div>' +
      '<div><label style="display:block;font-size:13px;font-weight:600;color:#475569;margin-bottom:4px">Focus Highlight</label>' +
      '<label style="display:flex;align-items:center;gap:10px;padding:12px;background:#f8fafc;border-radius:10px;cursor:pointer">' +
      '<input type="checkbox" name="focus_highlight" value="true" ' + (!settings || settings.focus_highlight ? 'checked' : '') + ' style="width:20px;height:20px" role="switch" aria-checked="' + (!settings || settings.focus_highlight ? 'true' : 'false') + '"> ' +
      '<span style="font-size:14px">Show visible focus indicators on all interactive elements</span></label></div>' +
      '</div>' +
      '<div style="margin-top:20px;display:flex;gap:10px">' +
      '<button type="submit" style="padding:11px 28px;background:' + COLORS.primary + ';color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer">Save Settings</button>' +
      '<button type="submit" name="reset" value="true" style="padding:11px 28px;background:#f1f5f9;color:#475569;border:none;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer">Reset to Defaults</button>' +
      '</div></form>';

    const content = navBar('Accessibility', links) +
      '<h1 style="font-size:22px;color:#1e293b;margin-bottom:8px">' + uiT('accessibility_settings') + '</h1>' +
      '<p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Customize your viewing experience to meet your accessibility needs</p>' +
      card('Display Preferences', formHtml) +
      card('Accessibility Guidelines', '<div style="font-size:14px;color:#475569;line-height:1.8">' +
      '<ul style="padding-left:20px">' +
      '<li><strong>Font Size:</strong> Adjust text size across the entire portal</li>' +
      '<li><strong>High Contrast:</strong> Increases text-to-background contrast ratio</li>' +
      '<li><strong>Reduced Motion:</strong> Disables CSS animations for vestibular disorders</li>' +
      '<li><strong>Screen Reader:</strong> Adds additional ARIA landmarks and descriptions</li>' +
      '<li><strong>Focus Highlight:</strong> Makes keyboard navigation focus visible</li>' +
      '</ul></div>');

    res.send(renderPage('Accessibility Settings', skipLink() + '<div id="main-content" role="main" style="max-width:900px;margin:0 auto;padding:20px">' + content + '</div>', user, req));
  }));

  app.post('/school/accessibility/save', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, uid = user.id;
    const { font_size, high_contrast, reduced_motion, screen_reader_optimized, focus_highlight, reset } = req.body;

    if (reset) {
      await pool.query('DELETE FROM user_accessibility_settings WHERE user_id=$1', [uid]);
    } else {
      const data = {
        font_size: font_size || 'medium',
        high_contrast: high_contrast === 'true',
        reduced_motion: reduced_motion === 'true',
        screen_reader_optimized: screen_reader_optimized === 'true',
        focus_highlight: focus_highlight !== 'false'
      };
      const existing = (await pool.query('SELECT id FROM user_accessibility_settings WHERE user_id=$1', [uid])).rows[0];
      if (existing) {
        await pool.query(
          'UPDATE user_accessibility_settings SET font_size=$1,high_contrast=$2,reduced_motion=$3,screen_reader_optimized=$4,focus_highlight=$5,updated_at=NOW() WHERE id=$6',
          [data.font_size, data.high_contrast, data.reduced_motion, data.screen_reader_optimized, data.focus_highlight, existing.id]
        );
      } else {
        await pool.query(
          'INSERT INTO user_accessibility_settings (user_id,font_size,high_contrast,reduced_motion,screen_reader_optimized,focus_highlight) VALUES ($1,$2,$3,$4,$5,$6)',
          [uid, data.font_size, data.high_contrast, data.reduced_motion, data.screen_reader_optimized, data.focus_highlight]
        );
      }
    }
    audit(user.email, 'accessibility_updated', 'Updated accessibility preferences');
    res.redirect('/school/accessibility');
  }));

  // ================================================================
  // FEATURE 14: Student Online Admission Form (Public)
  // ================================================================

  // 14a: Public application form
  app.get('/admissions/apply/:tenantSlug', ah(async (req, res) => {
    const tenantSlug = req.params.tenantSlug;
    const tenant = (await pool.query("SELECT id, name FROM tenants WHERE slug=$1", [tenantSlug])).rows[0];
    if (!tenant) return res.status(404).send('<h1>School Not Found</h1>');

    const classes = (await pool.query("SELECT name FROM classes WHERE tenant_id=$1 ORDER BY name", [tenant.id])).rows;
    const classOpts = classes.map(c => '<option value="' + esc(c.name) + '">' + esc(c.name) + '</option>').join('');

    const seoTags = generateSEO('Apply for Admission — ' + tenant.name, 'Submit your admission application to ' + tenant.name, '/admissions/apply/' + tenantSlug);

    const formHtml = '<form method="POST" action="/admissions/apply/' + esc(tenantSlug) + '/submit" role="form" aria-label="Admission application form" enctype="multipart/form-data">' +
      '<h2 style="font-size:20px;color:#1e293b;margin:0 0 20px">Student Information</h2>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">' +
      inputField('Student Full Name *', 'student_name', 'text', '', true, 'placeholder="First and Last Name"') +
      inputField('Date of Birth', 'date_of_birth', 'date', '', false) +
      selectField('Gender', 'gender', [['', 'Select Gender'], ['male', 'Male'], ['female', 'Female'], ['other', 'Other']], '') +
      selectField('Class Applying For *', 'class_applying', [['', 'Select Class']].concat(classes.map(c => [c.name, c.name])), '') +
      inputField('Previous School', 'previous_school', 'text', '', false) +
      inputField('Medical Conditions', 'medical_conditions', 'text', '', false, 'placeholder="Allergies, conditions, medications"') +
      '</div>' +
      '<h2 style="font-size:20px;color:#1e293b;margin:24px 0 20px">Parent / Guardian Information</h2>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">' +
      inputField('Parent Full Name *', 'parent_name', 'text', '', true) +
      inputField('Parent Phone *', 'parent_phone', 'tel', '', true) +
      inputField('Parent Email *', 'parent_email', 'email', '', true) +
      inputField('Emergency Contact Name', 'emergency_contact_name', 'text', '', false) +
      inputField('Emergency Contact Phone', 'emergency_contact_phone', 'tel', '', false) +
      '</div>' +
      textAreaField('Address', 'address', 3, '') +
      '<h2 style="font-size:20px;color:#1e293b;margin:24px 0 20px">Documents</h2>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px">' +
      '<div><label for="f_photo" style="display:block;font-size:13px;font-weight:600;color:#475569;margin-bottom:4px">Passport Photo</label>' +
      '<input type="file" id="f_photo" name="photo" accept="image/*" style="font-size:13px"></div>' +
      '<div><label for="f_birth_cert" style="display:block;font-size:13px;font-weight:600;color:#475569;margin-bottom:4px">Birth Certificate</label>' +
      '<input type="file" id="f_birth_cert" name="birth_cert" accept=".pdf,.jpg,.png" style="font-size:13px"></div>' +
      '<div><label for="f_reports" style="display:block;font-size:13px;font-weight:600;color:#475569;margin-bottom:4px">Previous Reports</label>' +
      '<input type="file" id="f_reports" name="reports" accept=".pdf,.jpg,.png" style="font-size:13px"></div>' +
      '</div>' +
      '<div style="margin-top:24px;padding:16px;background:#f0fdf4;border-radius:10px;border:1px solid #bbf7d0">' +
      '<p style="font-size:13px;color:#166534"><strong>Note:</strong> You will receive a reference number after submission to track your application status.</p></div>' +
      '<div style="margin-top:20px;display:flex;gap:10px">' +
      '<button type="submit" style="padding:12px 32px;background:' + COLORS.primary + ';color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer">Submit Application</button>' +
      '</div></form>';

    const html = skipLink() + '<div id="main-content" role="main" style="max-width:850px;margin:0 auto;padding:20px">' +
      '<div style="margin-bottom:20px">' +
      '<h1 style="font-size:28px;color:#1e293b">Apply for Admission</h1>' +
      '<p style="font-size:15px;color:#64748b;margin-top:4px">' + esc(tenant.name) + '</p>' +
      '</div>' +
      card('', formHtml) + '</div>';

    res.send(renderPage('Admission Application — ' + tenant.name, html, null, req, seoTags));
  }));

  // 14b: Submit application
  app.post('/admissions/apply/:tenantSlug/submit', ah(async (req, res) => {
    const tenantSlug = req.params.tenantSlug;
    const tenant = (await pool.query("SELECT id, name FROM tenants WHERE slug=$1", [tenantSlug])).rows[0];
    if (!tenant) return res.status(404).send('School not found');

    const { student_name, date_of_birth, gender, class_applying, previous_school, parent_name, parent_phone, parent_email, address, medical_conditions, emergency_contact_name, emergency_contact_phone } = req.body;

    if (!student_name || !student_name.trim() || !parent_name || !parent_name.trim() || !parent_phone || !parent_phone.trim() || !parent_email || !parent_email.trim()) {
      return res.redirect('/admissions/apply/' + tenantSlug);
    }

    // Validate email
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parent_email.trim())) {
      return res.redirect('/admissions/apply/' + tenantSlug);
    }

    const refNumber = 'ADM-' + Date.now().toString(36).toUpperCase().slice(-6) + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
    const docs = [];
    if (req.files && req.files.photo) docs.push({ type: 'passport_photo', name: req.files.photo.name });
    if (req.files && req.files.birth_cert) docs.push({ type: 'birth_certificate', name: req.files.birth_cert.name });
    if (req.files && req.files.reports) docs.push({ type: 'previous_reports', name: req.files.reports.name });

    await pool.query(
      `INSERT INTO public_admission_applications (tenant_id,reference_number,student_name,date_of_birth,gender,previous_school,class_applying,parent_name,parent_phone,parent_email,address,medical_conditions,emergency_contact_name,emergency_contact_phone,documents)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [tenant.id, refNumber, student_name.trim(), date_of_birth || null, gender || null, previous_school || null,
       class_applying || null, parent_name.trim(), parent_phone.trim(), parent_email.trim(),
       address || null, medical_conditions || null, emergency_contact_name || null, emergency_contact_phone || null, JSON.stringify(docs)]
    );

    // Send confirmation email
    if (queueEmail) {
      queueEmail(parent_email.trim(), 'Admission Application Received — ' + tenant.name,
        '<h2>Application Submitted Successfully</h2>' +
        '<p>Dear ' + esc(parent_name.trim()) + ',</p>' +
        '<p>Your admission application for <strong>' + esc(student_name.trim()) + '</strong> has been received by <strong>' + esc(tenant.name) + '</strong>.</p>' +
        '<p>Your reference number is: <strong style="font-size:18px;color:#4f46e5">' + refNumber + '</strong></p>' +
        '<p>Please keep this number for tracking your application status.</p>'
      );
    }

    res.send('<div style="max-width:600px;margin:60px auto;text-align:center;padding:20px">' +
      '<div style="font-size:60px;margin-bottom:16px">✅</div>' +
      '<h1 style="font-size:24px;color:#1e293b">Application Submitted!</h1>' +
      '<p style="color:#64748b;margin:12px 0;font-size:15px">Your application has been received successfully.</p>' +
      '<div style="background:#f0fdf4;border-radius:12px;padding:20px;margin:20px 0;border:1px solid #bbf7d0">' +
      '<p style="font-size:13px;color:#166534;margin:0 0 4px">Your Reference Number</p>' +
      '<p style="font-size:28px;font-weight:700;color:#059669;margin:0;letter-spacing:1px">' + refNumber + '</p>' +
      '</div>' +
      '<p style="font-size:13px;color:#94a3b8">Save this reference number. You can use it to track your application status.</p>' +
      '<a href="/admissions/track?ref=' + refNumber + '" style="display:inline-block;margin-top:20px;padding:11px 24px;background:#4f46e5;color:#fff;border-radius:10px;font-weight:600;text-decoration:none">Track Application</a>' +
      '</div>');
  }));

  // 14c: Track application
  app.get('/admissions/track', ah(async (req, res) => {
    const ref = req.query.ref || '';
    let appData = null;
    if (ref) {
      appData = (await pool.query(
        'SELECT paa.*, t.name as school_name FROM public_admission_applications paa JOIN tenants t ON t.id=paa.tenant_id WHERE paa.reference_number=$1', [ref.trim().toUpperCase()]
      )).rows[0];
    }

    const statusColors = { submitted: '#f59e0b', reviewing: '#3b82f6', accepted: '#059669', rejected: '#dc2626', waitlisted: '#94a3b8' };
    const html = skipLink() + '<div id="main-content" role="main" style="max-width:600px;margin:0 auto;padding:20px">' +
      '<h1 style="font-size:24px;color:#1e293b;text-align:center;margin-bottom:24px">Track Application</h1>' +
      '<form method="GET" action="/admissions/track" role="search" aria-label="Track application" style="display:flex;gap:10px;margin-bottom:30px">' +
      '<label for="f_ref" class="sr-only" style="position:absolute;left:-9999px">Reference Number</label>' +
      '<input type="text" id="f_ref" name="ref" value="' + esc(ref) + '" placeholder="Enter reference number (e.g. ADM-ABC123)" required style="flex:1;padding:12px 16px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;box-sizing:border-box">' +
      '<button type="submit" style="padding:12px 24px;background:' + COLORS.primary + ';color:#fff;border:none;border-radius:10px;font-weight:600;cursor:pointer">Track</button>' +
      '</form>';

    if (appData) {
      html += card('Application Found', '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:14px">' +
        '<div><span style="color:#94a3b8;font-size:12px;font-weight:600">STUDENT</span><br><strong>' + esc(appData.student_name) + '</strong></div>' +
        '<div><span style="color:#94a3b8;font-size:12px;font-weight:600">SCHOOL</span><br><strong>' + esc(appData.school_name) + '</strong></div>' +
        '<div><span style="color:#94a3b8;font-size:12px;font-weight:600">CLASS</span><br>' + esc(appData.class_applying || '—') + '</div>' +
        '<div><span style="color:#94a3b8;font-size:12px;font-weight:600">SUBMITTED</span><br>' + fmtDate(appData.created_at) + '</div>' +
        '<div style="grid-column:1/-1"><span style="color:#94a3b8;font-size:12px;font-weight:600">STATUS</span><br>' +
        badge(cap(appData.status), statusColors[appData.status] || '#94a3b8') + '</div>' +
        (appData.admin_notes ? '<div style="grid-column:1/-1"><span style="color:#94a3b8;font-size:12px;font-weight:600">ADMIN NOTES</span><br>' + esc(appData.admin_notes) + '</div>' : '') +
        '</div>');
    } else if (ref) {
      html += card('Not Found', '<p style="color:#dc2626;text-align:center">No application found with reference number: <strong>' + esc(ref) + '</strong></p>');
    }

    html += '</div>';
    res.send(renderPage('Track Application', html, null, req));
  }));

  // 14d: Admin admission review dashboard
  app.get('/school/admissions-form', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const statusFilter = req.query.status || '';

    let where = ['tenant_id=$1'], params = [tid], pi = 2;
    if (statusFilter) { where.push('status=$' + pi++); params.push(statusFilter); }

    const apps = (await pool.query(
      'SELECT * FROM public_admission_applications WHERE ' + where.join(' AND ') + ' ORDER BY created_at DESC LIMIT 200', params
    )).rows;

    const statusCounts = {};
    apps.forEach(a => { statusCounts[a.status] = (statusCounts[a.status] || 0) + 1; });

    const rows = apps.map(a => {
      const sc = { submitted: COLORS.warning, reviewing: '#3b82f6', accepted: COLORS.success, rejected: COLORS.danger, waitlisted: '#94a3b8' };
      return [
        '<strong>' + esc(a.reference_number) + '</strong>',
        '<a href="/school/admissions-form/' + a.id + '" style="color:' + COLORS.primary + ';text-decoration:none;font-weight:600">' + esc(a.student_name) + '</a>' +
        '<br><span style="font-size:11px;color:#94a3b8">' + esc(a.parent_email || '') + '</span>',
        esc(a.class_applying || '—'),
        badge(cap(a.status), sc[a.status] || '#94a3b8'),
        fmtDate(a.created_at)
      ];
    });

    const content = '<h1 style="font-size:22px;color:#1e293b;margin-bottom:8px">' + uiT('admissions_review') + '</h1>' +
      '<p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Review and manage admission applications</p>' +
      '<div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">' +
      btn('All (' + apps.length + ')', '/school/admissions-form', statusFilter === '' ? '#6366f1' : '#4f46e5') +
      btn('Submitted (' + (statusCounts.submitted || 0) + ')', '/school/admissions-form?status=submitted', '#f59e0b') +
      btn('Reviewing (' + (statusCounts.reviewing || 0) + ')', '/school/admissions-form?status=reviewing', '#3b82f6') +
      btn('Accepted (' + (statusCounts.accepted || 0) + ')', '/school/admissions-form?status=accepted', COLORS.success) +
      btn('Rejected (' + (statusCounts.rejected || 0) + ')', '/school/admissions-form?status=rejected', COLORS.danger) +
      '</div>' +
      card('', dataTable(['Reference', 'Student', 'Class', 'Status', 'Date'], rows));

    res.send(renderPage('Admissions Review', skipLink() + '<div id="main-content" role="main" style="max-width:1100px;margin:0 auto;padding:20px">' + content + '</div>', user, req));
  }));

  // 14e: Application detail + review
  app.get('/school/admissions-form/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const appData = (await pool.query(
      'SELECT * FROM public_admission_applications WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]
    )).rows[0];
    if (!appData) return res.redirect('/school/admissions-form');

    const detail = (label, value) => '<div><span style="font-size:11px;color:#94a3b8;font-weight:600;text-transform:uppercase">' + label + '</span><br><span style="color:#1e293b;font-weight:500">' + esc(value || '—') + '</span></div>';

    const reviewForm = '<form method="POST" action="/school/admissions-form/' + appData.id + '/review" role="form" aria-label="Review application">' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">' +
      selectField('Status', 'status', [['submitted', 'Submitted'], ['reviewing', 'Reviewing'], ['accepted', 'Accepted'], ['rejected', 'Rejected'], ['waitlisted', 'Waitlisted']], appData.status) +
      '</div>' +
      textAreaField('Admin Notes', 'admin_notes', 3, appData.admin_notes || '') +
      '<button type="submit" style="padding:11px 28px;background:' + COLORS.success + ';color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer">Update Status</button>' +
      '</form>';

    const content = '<a href="/school/admissions-form" style="color:#64748b;text-decoration:none;font-size:14px">&larr; Back to Applications</a>' +
      card('Application: ' + esc(appData.student_name),
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">' +
        detail('Reference Number', appData.reference_number) +
        detail('Submitted', fmtDateTime(appData.created_at)) +
        detail('Student Name', appData.student_name) +
        detail('Date of Birth', appData.date_of_birth ? fmtDate(appData.date_of_birth) : '—') +
        detail('Gender', appData.gender) +
        detail('Class Applying For', appData.class_applying) +
        detail('Previous School', appData.previous_school) +
        detail('Medical Conditions', appData.medical_conditions) +
        detail('Parent Name', appData.parent_name) +
        detail('Parent Phone', appData.parent_phone) +
        detail('Parent Email', appData.parent_email) +
        detail('Address', appData.address) +
        detail('Emergency Contact', appData.emergency_contact_name) +
        detail('Emergency Phone', appData.emergency_contact_phone) +
        '</div>') +
      card('Review Application', reviewForm);

    res.send(renderPage('Application Detail', skipLink() + '<div id="main-content" role="main" style="max-width:900px;margin:0 auto;padding:20px">' + content + '</div>', user, req));
  }));

  // 14f: Update application status
  app.post('/school/admissions-form/:id/review', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { status, admin_notes } = req.body;
    await pool.query(
      'UPDATE public_admission_applications SET status=$1,admin_notes=$2,reviewed_by=$3,reviewed_at=NOW() WHERE id=$4 AND tenant_id=$5',
      [status || 'submitted', admin_notes || null, user.id, req.params.id, tid]
    );
    audit(user.email, 'admission_reviewed', 'Updated application ' + req.params.id + ' to ' + status);
    res.redirect('/school/admissions-form/' + req.params.id);
  }));

  // ================================================================
  // FEATURE 15: School Bus GPS Tracking
  // ================================================================

  app.get('/school/transport/tracking', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    const routes = (await pool.query(
      "SELECT r.id, r.name, r.stops, r.estimated_time, v.plate_number, v.driver_name FROM transport_routes r LEFT JOIN transport_vehicles v ON v.id=r.vehicle_id WHERE r.tenant_id=$1 AND r.is_active=true ORDER BY r.name", [tid]
    )).rows;

    const activeTrips = (await pool.query(
      "SELECT bt.*, r.name as route_name FROM bus_trips bt JOIN transport_routes r ON r.id=bt.route_id WHERE bt.tenant_id=$1 AND bt.status IN ('in_progress','started') ORDER BY bt.trip_date DESC", [tid]
    )).rows;

    const recentTrips = (await pool.query(
      "SELECT bt.*, r.name as route_name FROM bus_trips bt JOIN transport_routes r ON r.id=bt.route_id WHERE bt.tenant_id=$1 ORDER BY bt.trip_date DESC LIMIT 20", [tid]
    )).rows;

    // Build SVG map for each route
    let mapHtml = '';
    if (routes.length > 0) {
      const route = routes[0];
      const stops = route.stops || [];
      const numStops = Math.max(stops.length, 2);

      // Simulated positions
      const points = stops.map((_, i) => ({
        x: 60 + (i / Math.max(numStops - 1, 1)) * 680,
        y: 60 + Math.sin(i * 1.2) * 80 + (i % 2 === 0 ? 20 : 60)
      }));

      // Add bus position (simulated as between first two stops)
      const busX = points.length > 1 ? (points[0].x + points[1].x) / 2 : 200;
      const busY = points.length > 1 ? (points[0].y + points[1].y) / 2 - 10 : 140;

      let pathD = points.map((p, i) => (i === 0 ? 'M' : 'L') + p.x + ',' + p.y).join(' ');

      mapHtml = '<svg viewBox="0 0 800 300" role="img" aria-label="Bus route map for ' + esc(route.name) + '" style="width:100%;max-width:800px;border-radius:12px;background:#f8fafc;border:1px solid #e2e8f0">' +
        '<text x="400" y="24" text-anchor="middle" font-size="14" fill="#64748b" font-weight="600">Route: ' + esc(route.name) + (route.plate_number ? ' — Bus: ' + esc(route.plate_number) : '') + '</text>' +
        '<path d="' + pathD + '" stroke="#e2e8f0" stroke-width="3" fill="none" stroke-dasharray="8,4"/>' +
        points.map((p, i) => {
          const isBusStop = i === 0;
          return '<circle cx="' + p.x + '" cy="' + p.y + '" r="8" fill="' + (isBusStop ? COLORS.primary : '#94a3b8') + '" stroke="#fff" stroke-width="2"/>' +
            '<text x="' + p.x + '" y="' + (p.y - 14) + '" text-anchor="middle" font-size="10" fill="#475569" font-weight="600">' + esc(stops[i] || 'Stop ' + (i + 1)) + '</text>';
        }).join('') +
        // Bus icon
        '<rect x="' + (busX - 16) + '" y="' + (busY - 12) + '" width="32" height="24" rx="6" fill="' + COLORS.primary + '"/>' +
        '<text x="' + busX + '" y="' + (busY + 5) + '" text-anchor="middle" font-size="11" fill="#fff" font-weight="700">🚌</text>' +
        '</svg>';
    }

    const tripRows = recentTrips.map(t => {
      const sc = { planned: '#94a3b8', started: '#3b82f6', in_progress: COLORS.success, completed: '#64748b' };
      return [
        '<strong>' + esc(t.route_name || '—') + '</strong>',
        esc(t.direction || '—'),
        fmtDate(t.trip_date),
        badge(cap(t.status || 'planned'), sc[t.status] || '#94a3b8'),
        esc(t.driver_name || '—'),
        String(t.total_students || 0)
      ];
    });

    const content = '<h1 style="font-size:22px;color:#1e293b;margin-bottom:8px">' + uiT('bus_tracking') + '</h1>' +
      '<p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Real-time school bus GPS tracking</p>' +
      '<div style="display:flex;gap:8px;margin-bottom:16px">' +
      badge(activeTrips.length + ' Active Trips', COLORS.success) +
      badge(routes.length + ' Routes', COLORS.primary) +
      '</div>' +
      (mapHtml ? card('Live Map — ' + esc(routes[0].name), mapHtml) : card('Map', '<p style="text-align:center;color:#94a3b8;padding:40px">No active routes configured</p>')) +
      card('Trip History', dataTable(['Route', 'Direction', 'Date', 'Status', 'Driver', 'Students'], tripRows));

    res.send(renderPage('Bus GPS Tracking', skipLink() + '<div id="main-content" role="main" style="max-width:1100px;margin:0 auto;padding:20px">' + content + '</div>', user, req));
  }));

  // ================================================================
  // FEATURE 16: Meal Plan Management
  // ================================================================

  const MEAL_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const MEAL_TYPES = ['breakfast', 'lunch', 'dinner'];

  app.get('/school/meals', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const plans = (await pool.query(
      'SELECT * FROM meal_plans_v18 WHERE tenant_id=$1 ORDER BY name', [tid]
    )).rows;

    const planRows = plans.map(p => [
      '<strong>' + esc(p.name) + '</strong><br><span style="font-size:11px;color:#94a3b8">' + esc(p.description || '') + '</span>',
      badge(cap(p.applicable_to || 'all'), p.applicable_to === 'all' ? COLORS.primary : COLORS.warning),
      fmtMoney(p.cost_per_term),
      badge(cap(p.status), p.status === 'active' ? COLORS.success : '#94a3b8'),
      '<div style="display:flex;gap:4px">' +
      '<a href="/school/meals/' + p.id + '/schedule" style="padding:4px 10px;background:#dbeafe;color:#1d4ed8;border-radius:6px;font-size:11px;text-decoration:none;font-weight:600">Schedule</a>' +
      '<form method="POST" action="/school/meals/' + p.id + '/delete" style="display:inline" onsubmit="return confirm(\'Delete ' + esc(p.name).replace(/'/g, "\\'") + '?\')">' +
      '<button style="padding:4px 10px;background:#fee2e2;color:#dc2626;border:none;border-radius:6px;font-size:11px;cursor:pointer">Delete</button></form></div>'
    ]);

    // Quick stats
    const todayStats = (await pool.query(
      "SELECT COUNT(*)::int as served_today FROM meal_attendance_v18 WHERE tenant_id=$1 AND meal_date=CURRENT_DATE", [tid]
    )).rows[0];

    const content = navBar('Meals', [['Meal Plans', '/school/meals'], ['Attendance', '/school/meals/attendance'], ['Reports', '/school/meals/reports']]) +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:12px">' +
      '<div><h1 style="font-size:22px;color:#1e293b">' + uiT('meal_plans') + '</h1>' +
      '<p style="font-size:13px;color:#94a3b8">Manage meal plans, schedules, and attendance</p></div>' +
      '<div style="display:flex;gap:8px">' +
      btn('New Meal Plan', '/school/meals/new', COLORS.success) +
      '</div></div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:14px;margin-bottom:20px">' +
      '<div style="background:#fff;border-radius:12px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,.08);text-align:center"><div style="font-size:24px;font-weight:700;color:' + COLORS.primary + '">' + plans.length + '</div><div style="font-size:12px;color:#94a3b8">Meal Plans</div></div>' +
      '<div style="background:#fff;border-radius:12px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,.08);text-align:center"><div style="font-size:24px;font-weight:700;color:' + COLORS.success + '">' + todayStats.served_today + '</div><div style="font-size:12px;color:#94a3b8">Served Today</div></div>' +
      '</div>' +
      card('Meal Plans', dataTable(['Plan', 'Applicable To', 'Cost/Term', 'Status', 'Actions'], planRows));

    res.send(renderPage('Meal Plan Management', skipLink() + '<div id="main-content" role="main" style="max-width:1100px;margin:0 auto;padding:20px">' + content + '</div>', user, req));
  }));

  app.get('/school/meals/new', requireAuth, requireNotBanned, (req, res) => {
    const user = req.session.user;
    const form = '<form method="POST" action="/school/meals/create" role="form" aria-label="Create meal plan">' +
      inputField('Plan Name *', 'name', 'text', '', true, 'placeholder="e.g. Standard Boarder Plan"') +
      textAreaField('Description', 'description', 2, '') +
      inputField('Cost Per Term ($)', 'cost_per_term', 'number', '0', false, 'step="0.01" min="0"') +
      selectField('Applicable To', 'applicable_to', [['all', 'All Students'], ['day_scholars', 'Day Scholars'], ['boarders', 'Boarders']], 'all') +
      selectField('Status', 'status', [['active', 'Active'], ['inactive', 'Inactive']], 'active') +
      '<button type="submit" style="padding:11px 28px;background:' + COLORS.primary + ';color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer">Create Plan</button></form>';

    res.send(renderPage('Create Meal Plan', skipLink() + '<div id="main-content" role="main" style="max-width:700px;margin:0 auto;padding:20px">' +
      card('New Meal Plan', form) + '</div>', user, req));
  });

  app.post('/school/meals/create', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { name, description, cost_per_term, applicable_to, status } = req.body;
    if (!name || !name.trim()) return res.redirect('/school/meals/new');
    await pool.query(
      'INSERT INTO meal_plans_v18 (tenant_id,name,description,cost_per_term,applicable_to,status) VALUES ($1,$2,$3,$4,$5,$6)',
      [tid, name.trim(), description || null, parseFloat(cost_per_term) || 0, applicable_to || 'all', status || 'active']
    );
    audit(req.session.user.email, 'meal_plan_created', 'Created meal plan: ' + name.trim());
    res.redirect('/school/meals');
  }));

  app.post('/school/meals/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
    await pool.query('DELETE FROM meal_plans_v18 WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
    res.redirect('/school/meals');
  }));

  // Meal schedule management
  app.get('/school/meals/:id/schedule', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const plan = (await pool.query('SELECT * FROM meal_plans_v18 WHERE id=$1 AND tenant_id=$2', [req.params.id, tid])).rows[0];
    if (!plan) return res.redirect('/school/meals');

    const schedules = (await pool.query(
      'SELECT * FROM meal_schedules WHERE tenant_id=$1 AND plan_id=$2 ORDER BY day_of_week, meal_type', [tid, plan.id]
    )).rows;

    const scheduleRows = schedules.map(s => [
      badge(cap(s.day_of_week), COLORS.primary),
      badge(cap(s.meal_type), '#3b82f6'),
      esc(s.menu_items),
      String(s.calories || 0),
      '<form method="POST" action="/school/meals/schedule/' + s.id + '/delete" style="display:inline" onsubmit="return confirm(\'Delete?\')"><button style="padding:4px 10px;background:#fee2e2;color:#dc2626;border:none;border-radius:6px;font-size:11px;cursor:pointer">Remove</button></form>'
    ]);

    const addForm = '<form method="POST" action="/school/meals/schedule/add" role="form" aria-label="Add meal schedule entry">' +
      '<input type="hidden" name="plan_id" value="' + plan.id + '">' +
      '<div style="display:grid;grid-template-columns:1fr 1fr 2fr 1fr auto;gap:10px;align-items:end">' +
      selectField('Day', 'day_of_week', MEAL_DAYS.map(d => [d, cap(d)]), '') +
      selectField('Meal', 'meal_type', MEAL_TYPES.map(m => [m, cap(m)]), '') +
      '<div><label for="f_items" style="display:block;font-size:12px;font-weight:600;color:#64748b;margin-bottom:4px">Menu Items</label>' +
      '<input type="text" id="f_items" name="menu_items" placeholder="e.g. Rice, Beans, Chicken" style="width:100%;padding:9px 12px;border:2px solid #e2e8f0;border-radius:8px;font-size:13px;box-sizing:border-box"></div>' +
      inputField('Calories', 'calories', 'number', '', false, 'min="0" style="width:80px"') +
      '<button type="submit" style="padding:9px 16px;background:' + COLORS.success + ';color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">Add</button>' +
      '</div></form>';

    const content = '<a href="/school/meals" style="color:#64748b;text-decoration:none;font-size:14px">&larr; Back to Plans</a>' +
      '<h2 style="font-size:20px;color:#1e293b;margin:12px 0">' + esc(plan.name) + ' — Weekly Schedule</h2>' +
      card('Add Schedule Entry', addForm) +
      card('Current Schedule', dataTable(['Day', 'Meal', 'Menu Items', 'Calories', ''], scheduleRows));

    res.send(renderPage('Meal Schedule', skipLink() + '<div id="main-content" role="main" style="max-width:1100px;margin:0 auto;padding:20px">' + content + '</div>', req.session.user, req));
  }));

  app.post('/school/meals/schedule/add', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { plan_id, day_of_week, meal_type, menu_items, calories } = req.body;
    if (!day_of_week || !meal_type || !menu_items) return res.redirect('back');
    await pool.query(
      'INSERT INTO meal_schedules (tenant_id,plan_id,day_of_week,meal_type,menu_items,calories) VALUES ($1,$2,$3,$4,$5,$6)',
      [tid, plan_id, day_of_week, meal_type, menu_items.trim(), parseInt(calories) || 0]
    );
    res.redirect('/school/meals/' + plan_id + '/schedule');
  }));

  app.post('/school/meals/schedule/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
    const sch = (await pool.query('SELECT plan_id FROM meal_schedules WHERE id=$1', [req.params.id])).rows[0];
    await pool.query('DELETE FROM meal_schedules WHERE id=$1', [req.params.id]);
    res.redirect('/school/meals/' + (sch ? sch.plan_id : '') + '/schedule');
  }));

  // Meal attendance
  app.get('/school/meals/attendance', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const dateFilter = req.query.date || today();
    const attendance = (await pool.query(
      'SELECT * FROM meal_attendance_v18 WHERE tenant_id=$1 AND meal_date=$2 ORDER BY meal_type, student_name', [tid, dateFilter]
    )).rows;

    const rows = attendance.map(a => [
      esc(a.student_name || '—'),
      badge(cap(a.meal_type), COLORS.primary),
      esc(a.items_consumed || '—'),
      esc(a.served_by || '—'),
      fmtDateTime(a.created_at)
    ]);

    const plans = (await pool.query('SELECT id, name FROM meal_plans_v18 WHERE tenant_id=$1 AND status=$2', [tid, 'active'])).rows;
    const planOpts = plans.map(p => '<option value="' + p.id + '">' + esc(p.name) + '</option>').join('');

    const content = navBar('Meals', [['Meal Plans', '/school/meals'], ['Attendance', '/school/meals/attendance'], ['Reports', '/school/meals/reports']]) +
      '<h2 style="font-size:20px;color:#1e293b;margin-bottom:16px">Meal Attendance</h2>' +
      card('Record Meal', '<form method="POST" action="/school/meals/attendance/record" role="form" aria-label="Record meal attendance">' +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:14px;align-items:end">' +
      inputField('Student Name *', 'student_name', 'text', '', true) +
      selectField('Meal Type *', 'meal_type', MEAL_TYPES.map(m => [m, cap(m)]), 'lunch') +
      inputField('Items Consumed', 'items_consumed', 'text', '', false, 'placeholder="Rice, Beans..."') +
      inputField('Served By', 'served_by', 'text', req.session.user.name || '') +
      '</div><input type="hidden" name="meal_date" value="' + esc(dateFilter) + '">' +
      '<button type="submit" style="margin-top:12px;padding:10px 24px;background:' + COLORS.success + ';color:#fff;border:none;border-radius:10px;font-weight:600;cursor:pointer">Record</button></form>') +
      '<div style="margin-bottom:16px"><form method="GET" action="/school/meals/attendance" style="display:flex;gap:8px;align-items:end">' +
      '<div><label for="f_date_att" style="display:block;font-size:12px;font-weight:600;color:#64748b;margin-bottom:4px">Filter Date</label>' +
      '<input type="date" id="f_date_att" name="date" value="' + esc(dateFilter) + '" style="padding:8px 14px;border:2px solid #e2e8f0;border-radius:8px;font-size:13px"></div>' +
      '<button type="submit" style="padding:8px 16px;background:' + COLORS.primary + ';color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">Filter</button></form></div>' +
      card('Attendance for ' + fmtDate(dateFilter) + ' (' + attendance.length + ' records)', dataTable(['Student', 'Meal', 'Items', 'Served By', 'Time'], rows));

    res.send(renderPage('Meal Attendance', skipLink() + '<div id="main-content" role="main" style="max-width:1100px;margin:0 auto;padding:20px">' + content + '</div>', req.session.user, req));
  }));

  app.post('/school/meals/attendance/record', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { student_name, meal_type, items_consumed, served_by, meal_date } = req.body;
    if (!student_name || !student_name.trim() || !meal_type) return res.redirect('/school/meals/attendance');
    await pool.query(
      'INSERT INTO meal_attendance_v18 (tenant_id,student_name,meal_date,meal_type,items_consumed,served_by) VALUES ($1,$2,$3,$4,$5,$6)',
      [tid, student_name.trim(), meal_date || today(), meal_type, items_consumed || null, served_by || null]
    );
    res.redirect('/school/meals/attendance?date=' + (meal_date || today()));
  }));

  // Meal reports
  app.get('/school/meals/reports', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;

    const dailyCounts = (await pool.query(
      "SELECT meal_date, meal_type, COUNT(*)::int as cnt FROM meal_attendance_v18 WHERE tenant_id=$1 AND meal_date >= CURRENT_DATE - INTERVAL '30 days' GROUP BY meal_date, meal_type ORDER BY meal_date DESC LIMIT 90", [tid]
    )).rows;

    const totalServed30 = dailyCounts.reduce((sum, r) => sum + r.cnt, 0);

    // SVG Bar chart
    const last7 = dailyCounts.filter(r => {
      const d = new Date(r.meal_date);
      const now = new Date();
      return (now - d) < 7 * 86400000;
    });
    const maxCount = Math.max(1, ...last7.map(r => r.cnt));

    let barsSvg = '';
    last7.forEach((r, i) => {
      const barH = (r.cnt / maxCount) * 120;
      const x = i * 40;
      const color = r.meal_type === 'breakfast' ? '#f59e0b' : r.meal_type === 'lunch' ? '#4f46e5' : '#059669';
      barsSvg += '<rect x="' + x + '" y="' + (140 - barH) + '" width="28" height="' + barH + '" rx="4" fill="' + color + '" opacity="0.8"><title>' + esc(r.meal_type) + ': ' + r.cnt + '</title></rect>' +
        '<text x="' + (x + 14) + '" y="' + (140 - barH - 6) + '" text-anchor="middle" font-size="9" fill="#475569">' + r.cnt + '</text>' +
        '<text x="' + (x + 14) + '" y="158" text-anchor="middle" font-size="8" fill="#94a3b8">' + r.meal_date.slice(5) + '</text>';
    });

    const content = navBar('Meals', [['Meal Plans', '/school/meals'], ['Attendance', '/school/meals/attendance'], ['Reports', '/school/meals/reports']]) +
      '<h2 style="font-size:20px;color:#1e293b;margin-bottom:16px">Meal Reports</h2>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-bottom:20px">' +
      '<div style="background:#fff;border-radius:12px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,.08);text-align:center"><div style="font-size:24px;font-weight:700;color:' + COLORS.primary + '">' + totalServed30 + '</div><div style="font-size:12px;color:#94a3b8">Meals (30 days)</div></div>' +
      '<div style="background:#fff;border-radius:12px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,.08);text-align:center"><div style="font-size:24px;font-weight:700;color:' + COLORS.success + '">' + (totalServed30 / 30).toFixed(0) + '</div><div style="font-size:12px;color:#94a3b8">Avg Daily</div></div>' +
      '</div>' +
      card('Meal Distribution (Last 7 Days)',
        '<svg viewBox="0 0 ' + Math.max(40 * last7.length, 200) + ' 170" role="img" aria-label="Meal distribution bar chart" style="width:100%;max-width:800px">' +
        '<rect width="100%" height="100%" fill="#f8fafc" rx="8"/>' +
        barsSvg +
        '<line x1="0" y1="140" x2="' + Math.max(40 * last7.length, 200) + '" y2="140" stroke="#e2e8f0" stroke-width="1"/>' +
        '</svg>');

    res.send(renderPage('Meal Reports', skipLink() + '<div id="main-content" role="main" style="max-width:1100px;margin:0 auto;padding:20px">' + content + '</div>', req.session.user, req));
  }));

  // ================================================================
  // FEATURE 17: Sickbay Visit Tracking
  // ================================================================

  app.get('/school/sickbay', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const dateFilter = req.query.date || today();

    const visits = (await pool.query(
      'SELECT * FROM sickbay_visits WHERE tenant_id=$1 AND visit_date=$2 ORDER BY time_in DESC', [tid, dateFilter]
    )).rows;

    const medicine = (await pool.query(
      'SELECT * FROM sickbay_medicine_inventory WHERE tenant_id=$1 ORDER BY medicine_name', [tid]
    )).rows;

    const lowStock = medicine.filter(m => m.quantity <= m.reorder_level);

    // Common complaints trend
    const trends = (await pool.query(
      "SELECT complaint, COUNT(*)::int as cnt FROM sickbay_visits WHERE tenant_id=$1 AND visit_date >= CURRENT_DATE - INTERVAL '30 days' GROUP BY complaint ORDER BY cnt DESC LIMIT 8", [tid]
    )).rows;

    const visitRows = visits.map(v => {
      const diag = v.diagnosis || '—';
      return [
        '<strong>' + esc(v.student_name) + '</strong>',
        esc(v.complaint || '—'),
        '<span style="font-size:12px">' + esc(diag.substring(0, 50)) + (diag.length > 50 ? '...' : '') + '</span>',
        (v.time_in || '').substring(0, 5) + ' — ' + ((v.time_out || '').substring(0, 5) || 'Ongoing'),
        v.parent_notified ? badge('Notified', COLORS.success) : badge('Pending', COLORS.warning),
        esc(v.nurse_name || '—')
      ];
    });

    const medRows = medicine.map(m => {
      const isLow = m.quantity <= m.reorder_level;
      return [
        '<strong>' + esc(m.medicine_name) + '</strong>',
        esc(m.category || '—'),
        badge(String(m.quantity), isLow ? COLORS.danger : COLORS.success),
        esc(m.unit),
        fmtDate(m.expiry_date),
        esc(m.supplier || '—')
      ];
    });

    const content = navBar('Sickbay', [['Visits', '/school/sickbay'], ['Medicine', '/school/sickbay/medicine']]) +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:12px">' +
      '<div><h1 style="font-size:22px;color:#1e293b">' + uiT('sickbay') + '</h1><p style="font-size:13px;color:#94a3b8">Track student health visits and medicine inventory</p></div>' +
      btn('New Visit', '/school/sickbay/new', COLORS.success) +
      '</div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:14px;margin-bottom:20px">' +
      '<div style="background:#fff;border-radius:12px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,.08);text-align:center"><div style="font-size:24px;font-weight:700;color:' + COLORS.primary + '">' + visits.length + '</div><div style="font-size:12px;color:#94a3b8">Visits Today</div></div>' +
      '<div style="background:#fff;border-radius:12px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,.08);text-align:center"><div style="font-size:24px;font-weight:700;color:' + COLORS.danger + '">' + lowStock.length + '</div><div style="font-size:12px;color:#94a3b8">Low Stock Meds</div></div>' +
      '<div style="background:#fff;border-radius:12px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,.08);text-align:center"><div style="font-size:24px;font-weight:700;color:' + COLORS.warning + '">' + medicine.length + '</div><div style="font-size:12px;color:#94a3b8">Total Medicines</div></div>' +
      '</div>';

    // Date filter
    content += '<form method="GET" style="display:flex;gap:8px;margin-bottom:16px;align-items:end">' +
      '<div><label for="f_sb_date" style="display:block;font-size:12px;font-weight:600;color:#64748b;margin-bottom:4px">Date</label>' +
      '<input type="date" id="f_sb_date" name="date" value="' + esc(dateFilter) + '" style="padding:8px 14px;border:2px solid #e2e8f0;border-radius:8px;font-size:13px"></div>' +
      '<button type="submit" style="padding:8px 16px;background:' + COLORS.primary + ';color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">Filter</button></form>';

    // Trend chart
    if (trends.length > 0) {
      const maxTrend = Math.max(1, ...trends.map(t => t.cnt));
      let trendBars = '';
      trends.slice(0, 6).forEach((t, i) => {
        const bw = (t.cnt / maxTrend) * 250;
        trendBars += '<div style="margin-bottom:8px"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:2px"><span style="color:#475569">' + esc(t.complaint.substring(0, 30)) + '</span><span style="font-weight:700;color:' + COLORS.primary + '">' + t.cnt + '</span></div>' +
          '<div style="background:#f1f5f9;border-radius:4px;height:18px;overflow:hidden"><div style="background:' + COLORS.primary + ';height:100%;width:' + bw + 'px;border-radius:4px;transition:width .3s"></div></div></div>';
      });
      content += card('Common Complaints (30 days)', trendBars);
    }

    content += card('Visits — ' + fmtDate(dateFilter), dataTable(['Student', 'Complaint', 'Diagnosis', 'Time', 'Parent', 'Nurse'], visitRows));

    res.send(renderPage('Sickbay Dashboard', skipLink() + '<div id="main-content" role="main" style="max-width:1100px;margin:0 auto;padding:20px">' + content + '</div>', user, req));
  }));

  app.get('/school/sickbay/new', requireAuth, requireNotBanned, (req, res) => {
    const user = req.session.user;
    const form = '<form method="POST" action="/school/sickbay/create" role="form" aria-label="Record sickbay visit">' +
      inputField('Student Name *', 'student_name', 'text', '', true) +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">' +
      inputField('Date', 'visit_date', 'date', today(), false) +
      inputField('Time In *', 'time_in', 'time', new Date().toTimeString().substring(0, 5), true) +
      inputField('Time Out', 'time_out', 'time', '', false) +
      inputField('Nurse Name', 'nurse_name', 'text', user.name || '', false) +
      '</div>' +
      textAreaField('Complaint *', 'complaint', 2, '', true) +
      textAreaField('Diagnosis', 'diagnosis', 2, '') +
      textAreaField('Treatment', 'treatment', 2, '') +
      '<div style="display:flex;gap:20px;align-items:center;margin-bottom:14px">' +
      '<label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" name="follow_up_needed" value="true" style="width:18px;height:18px"> Follow-up needed</label>' +
      '<label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" name="parent_notified" value="true" style="width:18px;height:18px"> Parent notified</label>' +
      '</div>' +
      '<button type="submit" style="padding:11px 28px;background:' + COLORS.primary + ';color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer">Record Visit</button></form>';

    res.send(renderPage('Record Sickbay Visit', skipLink() + '<div id="main-content" role="main" style="max-width:800px;margin:0 auto;padding:20px">' +
      card('New Sickbay Visit', form) + '</div>', user, req));
  });

  app.post('/school/sickbay/create', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { student_name, visit_date, time_in, time_out, complaint, diagnosis, treatment, nurse_name, follow_up_needed, parent_notified } = req.body;
    if (!student_name || !student_name.trim() || !complaint || !complaint.trim()) return res.redirect('/school/sickbay/new');

    await pool.query(
      'INSERT INTO sickbay_visits (tenant_id,student_name,visit_date,time_in,time_out,complaint,diagnosis,treatment,nurse_name,follow_up_needed,parent_notified) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [tid, student_name.trim(), visit_date || today(), time_in || null, time_out || null, complaint.trim(), diagnosis || null, treatment || null, nurse_name || null, follow_up_needed === 'true', parent_notified === 'true']
    );
    audit(req.session.user.email, 'sickbay_visit', 'Recorded visit for ' + student_name.trim());
    res.redirect('/school/sickbay');
  }));

  // Medicine inventory management
  app.get('/school/sickbay/medicine', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const meds = (await pool.query(
      'SELECT * FROM sickbay_medicine_inventory WHERE tenant_id=$1 ORDER BY medicine_name', [tid]
    )).rows;

    const medRows = meds.map(m => {
      const isLow = m.quantity <= m.reorder_level;
      return [
        '<strong>' + esc(m.medicine_name) + '</strong>',
        esc(m.category || '—'),
        badge(String(m.quantity), isLow ? COLORS.danger : COLORS.success),
        esc(m.unit),
        String(m.reorder_level),
        m.expiry_date ? (new Date(m.expiry_date) < new Date(Date.now() + 30 * 86400000) ? badge('Expiring', COLORS.warning) : fmtDate(m.expiry_date)) : '—',
        '<form method="POST" action="/school/sickbay/medicine/' + m.id + '/restock" style="display:flex;gap:4px" onsubmit="return confirm(\'Restock?\')">' +
        '<input name="qty" type="number" min="1" value="10" style="width:60px;padding:4px 8px;border:1px solid #e2e8f0;border-radius:6px;font-size:12px">' +
        '<button type="submit" style="padding:4px 10px;background:#dcfce7;color:#16a34a;border:none;border-radius:6px;font-size:11px;cursor:pointer;font-weight:600">+Restock</button></form>'
      ];
    });

    const content = navBar('Sickbay', [['Visits', '/school/sickbay'], ['Medicine', '/school/sickbay/medicine']]) +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:12px">' +
      '<h2 style="font-size:20px;color:#1e293b">Medicine Inventory</h2>' +
      btn('Add Medicine', '/school/sickbay/medicine/new', COLORS.success) +
      '</div>' +
      card('', dataTable(['Medicine', 'Category', 'Qty', 'Unit', 'Reorder', 'Expiry', 'Action'], medRows));

    res.send(renderPage('Medicine Inventory', skipLink() + '<div id="main-content" role="main" style="max-width:1100px;margin:0 auto;padding:20px">' + content + '</div>', req.session.user, req));
  }));

  app.get('/school/sickbay/medicine/new', requireAuth, requireNotBanned, (req, res) => {
    const user = req.session.user;
    const form = '<form method="POST" action="/school/sickbay/medicine/add" role="form" aria-label="Add medicine">' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">' +
      inputField('Medicine Name *', 'medicine_name', 'text', '', true) +
      inputField('Category', 'category', 'text', '', false, 'placeholder="e.g. Painkiller, Antiseptic"') +
      inputField('Quantity *', 'quantity', 'number', '100', true, 'min="0"') +
      inputField('Unit', 'unit', 'text', 'tablets', false) +
      inputField('Reorder Level', 'reorder_level', 'number', '10', false, 'min="0"') +
      inputField('Expiry Date', 'expiry_date', 'date', '', false) +
      '</div>' +
      inputField('Supplier', 'supplier', 'text', '', false) +
      textAreaField('Notes', 'notes', 2, '') +
      '<button type="submit" style="padding:11px 28px;background:' + COLORS.primary + ';color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer">Add Medicine</button></form>';

    res.send(renderPage('Add Medicine', skipLink() + '<div id="main-content" role="main" style="max-width:800px;margin:0 auto;padding:20px">' +
      card('Add New Medicine', form) + '</div>', user, req));
  });

  app.post('/school/sickbay/medicine/add', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { medicine_name, category, quantity, unit, reorder_level, expiry_date, supplier, notes } = req.body;
    if (!medicine_name || !medicine_name.trim()) return res.redirect('/school/sickbay/medicine/new');
    await pool.query(
      'INSERT INTO sickbay_medicine_inventory (tenant_id,medicine_name,category,quantity,unit,reorder_level,expiry_date,supplier,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [tid, medicine_name.trim(), category || null, parseInt(quantity) || 0, unit || 'tablets', parseInt(reorder_level) || 10, expiry_date || null, supplier || null, notes || null]
    );
    res.redirect('/school/sickbay/medicine');
  }));

  app.post('/school/sickbay/medicine/:id/restock', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const qty = parseInt(req.body.qty) || 0;
    if (qty <= 0) return res.redirect('/school/sickbay/medicine');
    await pool.query(
      'UPDATE sickbay_medicine_inventory SET quantity=quantity+$1 WHERE id=$2 AND tenant_id=$3', [qty, req.params.id, tid]
    );
    res.redirect('/school/sickbay/medicine');
  }));

  // ================================================================
  // FEATURE 18: School API Documentation
  // ================================================================

  app.get('/school/api/docs', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user;

    const endpoints = [
      { method: 'GET', path: '/school/pages', desc: 'List all public pages', auth: true },
      { method: 'POST', path: '/school/pages/create', desc: 'Create a new public page', auth: true },
      { method: 'GET', path: '/school/meals', desc: 'List meal plans', auth: true },
      { method: 'GET', path: '/school/meals/attendance', desc: 'Meal attendance records', auth: true },
      { method: 'GET', path: '/school/sickbay', desc: 'Sickbay visit records', auth: true },
      { method: 'POST', path: '/school/sickbay/create', desc: 'Record sickbay visit', auth: true },
      { method: 'GET', path: '/school/transport/tracking', desc: 'Bus GPS tracking data', auth: true },
      { method: 'GET', path: '/school/insights', desc: 'Analytics and insights', auth: true },
      { method: 'GET', path: '/public/school/:slug', desc: 'View public page by slug', auth: false },
      { method: 'POST', path: '/admissions/apply/:tenantSlug/submit', desc: 'Submit admission application', auth: false },
      { method: 'GET', path: '/admissions/track', desc: 'Track admission application', auth: false },
      { method: 'GET', path: '/sitemap.xml', desc: 'Sitemap XML for SEO', auth: false },
      { method: 'GET', path: '/robots.txt', desc: 'Robots.txt for crawlers', auth: false },
      { method: 'GET', path: '/manifest.json', desc: 'PWA manifest', auth: false },
    ];

    const methodColors = { GET: '#059669', POST: '#4f46e5', PUT: '#f59e0b', DELETE: '#dc2626' };

    const rows = endpoints.map(ep => [
      '<span style="display:inline-block;padding:3px 10px;border-radius:6px;font-size:11px;font-weight:700;color:#fff;background:' + (methodColors[ep.method] || '#94a3b8') + '">' + ep.method + '</span>',
      '<code style="font-size:12px;color:#1e293b;background:#f1f5f9;padding:3px 8px;border-radius:4px">' + esc(ep.path) + '</code>',
      esc(ep.desc),
      ep.auth ? badge('Auth Required', COLORS.warning) : badge('Public', COLORS.success)
    ]);

    const content = navBar('API', [['Documentation', '/school/api/docs'], ['API Keys', '/school/api/keys']]) +
      '<h1 style="font-size:22px;color:#1e293b;margin-bottom:8px">' + uiT('api_documentation') + '</h1>' +
      '<p style="font-size:13px;color:#94a3b8;margin-bottom:20px">API reference and endpoints for school portal integrations</p>' +
      card('Authentication', '<p style="font-size:14px;color:#475569;line-height:1.8">All authenticated endpoints require a valid session cookie or API key. API keys can be managed from the <a href="/school/api/keys" style="color:' + COLORS.primary + '">API Keys page</a>.</p>' +
      '<p style="font-size:14px;color:#475569;margin-top:8px"><strong>Rate Limiting:</strong> 100 requests per minute per API key. Exceeding this limit will return HTTP 429.</p>') +
      card('Request Format', '<p style="font-size:14px;color:#475569;margin-bottom:8px">All API requests should use the following headers:</p>' +
      '<pre style="background:#1e293b;color:#e2e8f0;padding:16px;border-radius:10px;font-size:13px;overflow-x:auto">Content-Type: application/json\nAuthorization: Bearer YOUR_API_KEY</pre>') +
      card('Endpoints (' + endpoints.length + ')', dataTable(['Method', 'Path', 'Description', 'Auth'], rows));

    res.send(renderPage('API Documentation', skipLink() + '<div id="main-content" role="main" style="max-width:1100px;margin:0 auto;padding:20px">' + content + '</div>', user, req));
  }));

  // API Keys management
  app.get('/school/api/keys', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const keys = (await pool.query(
      "SELECT * FROM api_keys WHERE tenant_id=$1 ORDER BY created_at DESC", [tid]
    )).rows;

    const keyRows = keys.map(k => {
      const maskedKey = k.key_value ? k.key_value.substring(0, 8) + '...' + k.key_value.substring(k.key_value.length - 4) : '—';
      return [
        '<strong>' + esc(k.key_name || 'Unnamed') + '</strong>',
        '<code style="font-size:11px;color:#64748b;background:#f1f5f9;padding:2px 6px;border-radius:4px">' + maskedKey + '</code>',
        badge(String(k.request_count || 0), COLORS.primary),
        badge(cap(k.status), k.status === 'active' ? COLORS.success : COLORS.danger),
        k.last_used_at ? fmtDateTime(k.last_used_at) : 'Never',
        k.status === 'active' ?
          '<form method="POST" action="/school/api/keys/' + k.id + '/revoke" style="display:inline" onsubmit="return confirm(\'Revoke this key?\')">' +
          '<button style="padding:4px 12px;background:#fee2e2;color:#dc2626;border:none;border-radius:6px;font-size:11px;cursor:pointer;font-weight:600">Revoke</button></form>' :
          '<span style="font-size:11px;color:#94a3b8">Revoked</span>'
      ];
    });

    const content = navBar('API', [['Documentation', '/school/api/docs'], ['API Keys', '/school/api/keys']]) +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:12px">' +
      '<h1 style="font-size:22px;color:#1e293b">API Keys</h1>' +
      btn('Generate New Key', '/school/api/keys/new', COLORS.success) +
      '</div>' +
      card('Your API Keys (' + keys.length + ')', dataTable(['Name', 'Key', 'Requests', 'Status', 'Last Used', 'Action'], keyRows)) +
      card('Usage Guide', '<div style="font-size:14px;color:#475569;line-height:1.8">' +
      '<p>Use your API key in the <code style="background:#f1f5f9;padding:2px 6px;border-radius:4px">Authorization</code> header:</p>' +
      '<pre style="background:#1e293b;color:#e2e8f0;padding:16px;border-radius:10px;font-size:13px;overflow-x:auto;margin-top:8px">curl -H "Authorization: Bearer YOUR_KEY" \\\n  https://your-school.com/school/meals</pre>' +
      '</div>');

    res.send(renderPage('API Keys', skipLink() + '<div id="main-content" role="main" style="max-width:1100px;margin:0 auto;padding:20px">' + content + '</div>', user, req));
  }));

  app.get('/school/api/keys/new', requireAuth, requireNotBanned, (req, res) => {
    const user = req.session.user;
    const form = '<form method="POST" action="/school/api/keys/generate" role="form" aria-label="Generate API key">' +
      inputField('Key Name *', 'key_name', 'text', '', true, 'placeholder="e.g. Integration Key"') +
      inputField('Rate Limit (per minute)', 'rate_limit', 'number', '100', false, 'min="1"') +
      textAreaField('Permissions (one per line)', 'permissions', 3, 'school:read\nmeals:read\nsickbay:read') +
      '<button type="submit" style="padding:11px 28px;background:' + COLORS.success + ';color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer">Generate Key</button></form>';

    res.send(renderPage('Generate API Key', skipLink() + '<div id="main-content" role="main" style="max-width:700px;margin:0 auto;padding:20px">' +
      card('Generate New API Key', '<p style="font-size:13px;color:#64748b;margin-bottom:16px">Your API key will be shown once after generation. Store it securely — it cannot be retrieved again.</p>' + form) + '</div>', user, req));
  });

  app.post('/school/api/keys/generate', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { key_name, rate_limit, permissions } = req.body;
    if (!key_name || !key_name.trim()) return res.redirect('/school/api/keys/new');

    const keyValue = 'sk_' + genToken();
    const perms = permissions ? permissions.split('\n').map(p => p.trim()).filter(Boolean) : [];

    await pool.query(
      'INSERT INTO api_keys (tenant_id,user_id,key_value,key_name,permissions,rate_limit) VALUES ($1,$2,$3,$4,$5,$6)',
      [tid, req.session.user.id, keyValue, key_name.trim(), perms, parseInt(rate_limit) || 100]
    );

    const content = card('API Key Generated', '<p style="font-size:13px;color:#64748b;margin-bottom:12px">Save this key now. You will not be able to see it again.</p>' +
      '<div style="background:#f0fdf4;border-radius:10px;padding:16px;border:1px solid #bbf7d0">' +
      '<code style="font-size:16px;word-break:break-all;color:#059669">' + esc(keyValue) + '</code></div>' +
      '<a href="/school/api/keys" style="display:inline-block;margin-top:16px;padding:10px 24px;background:' + COLORS.primary + ';color:#fff;border-radius:10px;text-decoration:none;font-weight:600">Back to API Keys</a>');

    res.send(renderPage('API Key Generated', skipLink() + '<div id="main-content" role="main" style="max-width:700px;margin:0 auto;padding:20px">' + content + '</div>', req.session.user, req));
  }));

  app.post('/school/api/keys/:id/revoke', requireAuth, requireNotBanned, ah(async (req, res) => {
    await pool.query("UPDATE api_keys SET status='revoked' WHERE id=$1 AND tenant_id=$2", [req.params.id, req.session.user.tenant_id]);
    res.redirect('/school/api/keys');
  }));

  // ================================================================
  // FEATURE 19: PWA Manifest + Service Worker
  // ================================================================

  app.get('/manifest.json', ah(async (req, res) => {
    const baseUrl = process.env.BASE_URL || 'https://school.example.com';
    const manifest = {
      name: 'School Portal',
      short_name: 'SchoolPortal',
      description: 'School Management Portal — Access your school dashboard, meals, sickbay, and more',
      start_url: baseUrl + '/dashboard',
      display: 'standalone',
      background_color: '#ffffff',
      theme_color: '#4f46e5',
      orientation: 'portrait-primary',
      scope: baseUrl + '/',
      icons: [
        { src: baseUrl + '/public/icon.png', sizes: '192x192', type: 'image/png' },
        { src: baseUrl + '/public/icon.png', sizes: '512x512', type: 'image/png' }
      ],
      categories: ['education', 'productivity'],
      shortcuts: [
        { name: 'Dashboard', url: baseUrl + '/dashboard', icons: [{ src: baseUrl + '/public/icon.png', sizes: '96x96' }] },
        { name: 'Meals', url: baseUrl + '/school/meals', icons: [{ src: baseUrl + '/public/icon.png', sizes: '96x96' }] },
        { name: 'Sickbay', url: baseUrl + '/school/sickbay', icons: [{ src: baseUrl + '/public/icon.png', sizes: '96x96' }] },
        { name: 'Bus Tracking', url: baseUrl + '/school/transport/tracking', icons: [{ src: baseUrl + '/public/icon.png', sizes: '96x96' }] }
      ]
    };
    res.set('Content-Type', 'application/manifest+json');
    res.json(manifest);
  }));

  app.get('/sw.js', (req, res) => {
    const sw = `
const CACHE_NAME = 'school-v18-' + Date.now();
const PRECACHE_URLS = ['/dashboard', '/school/meals', '/school/sickbay'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_URLS)));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
  )));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      const networkFetch = fetch(e.request).then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return response;
      }).catch(() => cached);
      return cached || networkFetch;
    })
  );
});`;
    res.set('Content-Type', 'application/javascript');
    res.send(sw);
  });

  // ================================================================
  // FEATURE 20: School Analytics & Insights Dashboard
  // ================================================================

  app.get('/school/insights', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const fromDate = req.query.from || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const toDate = req.query.to || today();

    // Enrollment data (simulated from various tables)
    const enrollmentData = (await pool.query(
      "SELECT DATE(created_at) as enroll_date, COUNT(*)::int as cnt FROM admission_applications WHERE tenant_id=$1 AND created_at >= $2 AND created_at <= $3 + INTERVAL '1 day' GROUP BY DATE(created_at) ORDER BY enroll_date", [tid, fromDate, toDate]
    )).rows;

    // Fee collection (simulated)
    const feeData = (await pool.query(
      "SELECT EXTRACT(MONTH FROM created_at)::int as month, COALESCE(SUM(amount),0)::numeric as total FROM fee_payments WHERE tenant_id=$1 AND created_at >= $2 GROUP BY EXTRACT(MONTH FROM created_at) ORDER BY month", [tid, fromDate]
    )).catch(() => ({ rows: [] }));

    // Attendance data (simulated)
    const attendanceData = (await pool.query(
      "SELECT EXTRACT(MONTH FROM created_at)::int as month, COUNT(*)::int as total, COUNT(*) FILTER (WHERE status='present')::int as present FROM attendance_records WHERE tenant_id=$1 AND created_at >= $2 GROUP BY EXTRACT(MONTH FROM created_at) ORDER BY month", [tid, fromDate]
    )).catch(() => ({ rows: [] }));

    // Sickbay stats
    const sickbayStats = (await pool.query(
      "SELECT complaint, COUNT(*)::int as cnt FROM sickbay_visits WHERE tenant_id=$1 AND visit_date >= $2 GROUP BY complaint ORDER BY cnt DESC LIMIT 6", [tid, fromDate]
    )).rows;

    // Meal stats
    const mealStats = (await pool.query(
      "SELECT meal_type, COUNT(*)::int as cnt FROM meal_attendance_v18 WHERE tenant_id=$1 AND meal_date >= $2 GROUP BY meal_type ORDER BY cnt DESC", [tid, fromDate]
    )).rows;

    // ── SVG Chart 1: Enrollment Trend (Line) ──
    const enrollMax = Math.max(1, ...enrollmentData.map(d => d.cnt));
    const enrollPoints = enrollmentData.map((d, i) => {
      const x = 50 + (i / Math.max(enrollmentData.length - 1, 1)) * 700;
      const y = 170 - (d.cnt / enrollMax) * 140;
      return x + ',' + y;
    });
    let enrollPath = '';
    if (enrollPoints.length > 1) {
      enrollPath = '<polyline points="' + enrollPoints.join(' ') + '" fill="none" stroke="' + COLORS.primary + '" stroke-width="2.5"/>' +
        '<circle cx="' + enrollmentData[enrollmentData.length - 1].x + '" cy="' + enrollmentData[enrollmentData.length - 1].y + '" r="4" fill="' + COLORS.primary + '"/>';
    }
    // Recalculate points for SVG
    const enrollSvgPoints = enrollmentData.map((d, i) => {
      const x = 50 + (i / Math.max(enrollmentData.length - 1, 1)) * 700;
      const y = 170 - (d.cnt / enrollMax) * 140;
      return { x, y, date: d.enroll_date, cnt: d.cnt };
    });
    const enrollLine = enrollSvgPoints.map(p => p.x + ',' + p.y).join(' ');
    const enrollDots = enrollSvgPoints.map(p =>
      '<circle cx="' + p.x + '" cy="' + p.y + '" r="4" fill="' + COLORS.primary + '"><title>' + fmtDate(p.date) + ': ' + p.cnt + '</title></circle>'
    ).join('');

    const enrollmentSvg = enrollmentData.length > 0 ?
      '<svg viewBox="0 0 800 220" role="img" aria-label="Enrollment trend chart" style="width:100%;max-width:800px">' +
      '<rect width="100%" height="100%" fill="#f8fafc" rx="8"/>' +
      '<text x="50" y="20" font-size="13" fill="#1e293b" font-weight="700">Enrollment Trend</text>' +
      '<text x="750" y="20" text-anchor="end" font-size="11" fill="#94a3b8">' + esc(fromDate) + ' to ' + esc(toDate) + '</text>' +
      '<line x1="50" y1="170" x2="750" y2="170" stroke="#e2e8f0" stroke-width="1"/>' +
      '<text x="40" y="35" text-anchor="end" font-size="9" fill="#94a3b8">' + enrollMax + '</text>' +
      '<text x="40" y="174" text-anchor="end" font-size="9" fill="#94a3b8">0</text>' +
      (enrollSvgPoints.length > 1 ? '<polyline points="' + enrollLine + '" fill="none" stroke="' + COLORS.primary + '" stroke-width="2.5" stroke-linejoin="round"/>' : '') +
      enrollDots +
      '</svg>' :
      '<p style="text-align:center;color:#94a3b8;padding:30px">No enrollment data available</p>';

    // ── SVG Chart 2: Attendance Distribution (Bar) ──
    const attMax = Math.max(1, ...attendanceData.rows.map(d => d.total || 0));
    const attSvg = attendanceData.rows.length > 0 ?
      '<svg viewBox="0 0 800 200" role="img" aria-label="Attendance bar chart" style="width:100%;max-width:800px">' +
      '<rect width="100%" height="100%" fill="#f8fafc" rx="8"/>' +
      '<text x="50" y="20" font-size="13" fill="#1e293b" font-weight="700">Monthly Attendance</text>' +
      '<line x1="50" y1="170" x2="750" y2="170" stroke="#e2e8f0" stroke-width="1"/>' +
      attendanceData.rows.map((d, i) => {
        const bw = Math.min(80, 600 / attendanceData.rows.length - 10);
        const x = 60 + i * (bw + 10);
        const totalH = Math.max(0, (d.total / attMax) * 130);
        const presH = Math.max(0, (d.present / attMax) * 130);
        return '<rect x="' + x + '" y="' + (170 - totalH) + '" width="' + bw + '" height="' + totalH + '" rx="4" fill="#e2e8f0"/>' +
          '<rect x="' + x + '" y="' + (170 - presH) + '" width="' + bw + '" height="' + presH + '" rx="4" fill="' + COLORS.success + '"><title>' + esc(cap(['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.month] || 'M' + d.month)) + ': ' + d.present + '/' + d.total + '</title></rect>' +
          '<text x="' + (x + bw / 2) + '" y="186" text-anchor="middle" font-size="9" fill="#94a3b8">' + esc(cap(['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.month] || 'M' + d.month)) + '</text>';
      }).join('') +
      '</svg>' :
      '<p style="text-align:center;color:#94a3b8;padding:30px">No attendance data available</p>';

    // ── SVG Chart 3: Meal Distribution (Pie) ──
    const mealTotal = mealStats.reduce((s, m) => s + m.cnt, 0);
    const mealColors = { breakfast: '#f59e0b', lunch: '#4f46e5', dinner: '#059669', snack: '#8b5cf6' };
    let cumAngle = 0;
    const mealPieSvg = mealStats.length > 0 ?
      '<svg viewBox="0 0 300 220" role="img" aria-label="Meal distribution pie chart" style="width:100%;max-width:300px">' +
      '<text x="150" y="16" text-anchor="middle" font-size="13" fill="#1e293b" font-weight="700">Meals by Type</text>' +
      mealStats.map(m => {
        const pct = mealTotal > 0 ? m.cnt / mealTotal : 0;
        const startAngle = cumAngle;
        cumAngle += pct * 2 * Math.PI;
        const endAngle = cumAngle;
        const cx = 120, cy = 120, r = 80;
        const x1 = cx + r * Math.cos(startAngle - Math.PI / 2);
        const y1 = cy + r * Math.sin(startAngle - Math.PI / 2);
        const x2 = cx + r * Math.cos(endAngle - Math.PI / 2);
        const y2 = cy + r * Math.sin(endAngle - Math.PI / 2);
        const largeArc = pct > 0.5 ? 1 : 0;
        const color = mealColors[m.meal_type] || '#94a3b8';
        const midAngle = (startAngle + endAngle) / 2 - Math.PI / 2;
        const lx = cx + (r + 30) * Math.cos(midAngle);
        const ly = cy + (r + 30) * Math.sin(midAngle);
        return '<path d="M' + cx + ',' + cy + ' L' + x1.toFixed(1) + ',' + y1.toFixed(1) + ' A' + r + ',' + r + ' 0 ' + largeArc + ',1 ' + x2.toFixed(1) + ',' + y2.toFixed(1) + ' Z" fill="' + color + '" stroke="#fff" stroke-width="2"><title>' + esc(m.meal_type) + ': ' + m.cnt + '</title></path>' +
          '<text x="' + lx.toFixed(1) + '" y="' + ly.toFixed(1) + '" text-anchor="middle" font-size="10" fill="#475569" font-weight="600">' + Math.round(pct * 100) + '%</text>';
      }).join('') +
      '</svg>' :
      '<p style="text-align:center;color:#94a3b8;padding:30px">No meal data</p>';

    // ── SVG Chart 4: Fee Collection Gauge ──
    const feeTotal = feeData.rows.reduce((s, f) => s + parseFloat(f.total || 0), 0);
    const feeTarget = Math.max(1, feeTotal * 1.2); // Simulate 120% target
    const feePercent = Math.min(100, (feeTotal / feeTarget) * 100);
    const gaugeAngle = (feePercent / 100) * 180;
    const gaugeColor = feePercent > 80 ? COLORS.success : feePercent > 50 ? COLORS.warning : COLORS.danger;

    const feeGaugeSvg =
      '<svg viewBox="0 0 300 180" role="img" aria-label="Fee collection gauge" style="width:100%;max-width:300px">' +
      '<text x="150" y="16" text-anchor="middle" font-size="13" fill="#1e293b" font-weight="700">Fee Collection</text>' +
      '<path d="M 30 150 A 120 120 0 0 1 270 150" fill="none" stroke="#e2e8f0" stroke-width="20" stroke-linecap="round"/>' +
      '<path d="M 30 150 A 120 120 0 0 1 ' + (30 + 240 * Math.cos(Math.PI - (gaugeAngle / 180) * Math.PI)).toFixed(1) + ' ' + (150 - 120 * Math.sin((gaugeAngle / 180) * Math.PI)).toFixed(1) + '" fill="none" stroke="' + gaugeColor + '" stroke-width="20" stroke-linecap="round"/>' +
      '<text x="150" y="130" text-anchor="middle" font-size="28" fill="' + gaugeColor + '" font-weight="800">' + Math.round(feePercent) + '%</text>' +
      '<text x="150" y="155" text-anchor="middle" font-size="11" fill="#94a3b8">' + fmtMoney(feeTotal) + ' collected</text>' +
      '</svg>';

    // ── SVG Chart 5: Sickbay Trends (Horizontal Bar) ──
    const sickMax = Math.max(1, ...sickbayStats.map(s => s.cnt));
    const sickSvg = sickbayStats.length > 0 ?
      '<svg viewBox="0 0 400 200" role="img" aria-label="Sickbay complaint trends" style="width:100%;max-width:400px">' +
      '<text x="200" y="16" text-anchor="middle" font-size="13" fill="#1e293b" font-weight="700">Top Complaints</text>' +
      sickbayStats.map((s, i) => {
        const bw = Math.max(0, (s.cnt / sickMax) * 250);
        const y = 30 + i * 28;
        return '<text x="8" y="' + (y + 12) + '" font-size="10" fill="#475569">' + esc(s.complaint.substring(0, 20)) + '</text>' +
          '<rect x="140" y="' + y + '" width="' + bw + '" height="18" rx="4" fill="' + COLORS.danger + '" opacity="0.8"><title>' + esc(s.complaint) + ': ' + s.cnt + '</title></rect>' +
          '<text x="' + (145 + bw) + '" y="' + (y + 13) + '" font-size="9" fill="#475569" font-weight="600">' + s.cnt + '</text>';
      }).join('') +
      '</svg>' :
      '<p style="text-align:center;color:#94a3b8;padding:30px">No sickbay data</p>';

    // Date filter form
    const filterForm = '<form method="GET" style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap;align-items:end">' +
      '<div><label for="f_from" style="display:block;font-size:12px;font-weight:600;color:#64748b;margin-bottom:4px">From</label>' +
      '<input type="date" id="f_from" name="from" value="' + esc(fromDate) + '" style="padding:8px 14px;border:2px solid #e2e8f0;border-radius:8px;font-size:13px"></div>' +
      '<div><label for="f_to" style="display:block;font-size:12px;font-weight:600;color:#64748b;margin-bottom:4px">To</label>' +
      '<input type="date" id="f_to" name="to" value="' + esc(toDate) + '" style="padding:8px 14px;border:2px solid #e2e8f0;border-radius:8px;font-size:13px"></div>' +
      '<button type="submit" style="padding:8px 20px;background:' + COLORS.primary + ';color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">Apply</button>' +
      '<a href="/school/insights" style="padding:8px 16px;background:#f1f5f9;color:#475569;border-radius:8px;font-size:13px;text-decoration:none;font-weight:600">Reset (30d)</a>' +
      '</form>';

    // Summary stats
    const totalEnrollments = enrollmentData.reduce((s, d) => s + d.cnt, 0);
    const totalMeals = mealStats.reduce((s, m) => s + m.cnt, 0);
    const totalSickbay = sickbayStats.reduce((s, v) => s + v.cnt, 0);

    const content = '<h1 style="font-size:22px;color:#1e293b;margin-bottom:4px">' + uiT('analytics_insights') + '</h1>' +
      '<p style="font-size:13px;color:#94a3b8;margin-bottom:20px">School performance metrics and data-driven insights</p>' +
      filterForm +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:14px;margin-bottom:24px">' +
      '<div style="background:#fff;border-radius:12px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,.08);text-align:center"><div style="font-size:24px;font-weight:700;color:' + COLORS.primary + '">' + totalEnrollments + '</div><div style="font-size:12px;color:#94a3b8">New Enrollments</div></div>' +
      '<div style="background:#fff;border-radius:12px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,.08);text-align:center"><div style="font-size:24px;font-weight:700;color:' + COLORS.success + '">' + fmtMoney(feeTotal) + '</div><div style="font-size:12px;color:#94a3b8">Fees Collected</div></div>' +
      '<div style="background:#fff;border-radius:12px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,.08);text-align:center"><div style="font-size:24px;font-weight:700;color:' + COLORS.warning + '">' + totalMeals + '</div><div style="font-size:12px;color:#94a3b8">Meals Served</div></div>' +
      '<div style="background:#fff;border-radius:12px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,.08);text-align:center"><div style="font-size:24px;font-weight:700;color:' + COLORS.danger + '">' + totalSickbay + '</div><div style="font-size:12px;color:#94a3b8">Sickbay Visits</div></div>' +
      '</div>' +
      // Charts row 1
      '<div style="display:grid;grid-template-columns:2fr 1fr;gap:20px;margin-bottom:20px">' +
      card('Enrollment Trend', enrollmentSvg) +
      card('Fee Collection Progress', feeGaugeSvg) +
      '</div>' +
      // Charts row 2
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px">' +
      card('Monthly Attendance', attSvg) +
      card('Meals by Type', mealPieSvg) +
      '</div>' +
      // Charts row 3
      card('Health Center — Top Complaints', sickSvg);

    res.send(renderPage('Analytics & Insights', skipLink() + '<div id="main-content" role="main" style="max-width:1200px;margin:0 auto;padding:20px">' + content + '</div>', user, req));
  }));

  // ================================================================
  // Console log on load
  // ================================================================
  console.log('[School-v18-b] Module loaded — Features 11-20 ready');

};
