// ============================================================
// NAVIGATION ROUTES — Unified portal-aware navigation system
// Comfort Zone — Multi-tenant SaaS Platform
// ============================================================
const { migrateQuery } = require('./db');
module.exports = function(app, pool, opts) {
  const esc = (opts && opts.esc) || (s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'));
  const renderPage = (opts && opts.renderPage) || ((t,c,u) => c);
  const ah = (opts && opts.ah) || (fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(e => res.status(500).send('Error: '+e.message)));
  const requireAuth = (opts && opts.requireAuth) || ((req,res,next) => { if(!req.session?.user) return res.redirect('/login'); next(); });
  const audit = (opts && opts.audit) || (() => {});
  const tenantId = (req) => req.session?.user?.tenant_id || 0;

  // ============================================================
  // PORTAL TYPE DEFINITIONS
  // ============================================================
  const PORTAL_MENUS = {
    school: {
      label: 'School',
      icon: '🏫',
      items: [
        { path: '/dashboard', label: 'Dashboard', icon: '📊' },
        { path: '/students', label: 'Students', icon: '👨‍🎓' },
        { path: '/classes', label: 'Classes', icon: '📚' },
        { path: '/fees', label: 'Fees & Payments', icon: '💰' },
        { path: '/attendance', label: 'Attendance', icon: '✅' },
        { path: '/exams', label: 'Exams', icon: '📝' },
        { path: '/reports', label: 'Reports', icon: '📋' },
        { path: '/timetable', label: 'Timetable', icon: '📅' },
        { path: '/transport', label: 'Transport', icon: '🚌' },
        { path: '/engagement', label: 'Engagement Hub', icon: '🤝' },
        { path: '/hub', label: 'Open Hub', icon: '🌐' }
      ]
    },
    clinic: {
      label: 'Clinic',
      icon: '🏥',
      items: [
        { path: '/dashboard', label: 'Dashboard', icon: '📊' },
        { path: '/patients', label: 'Patients', icon: '🤒' },
        { path: '/appointments', label: 'Appointments', icon: '📅' },
        { path: '/prescriptions', label: 'Prescriptions', icon: '💊' },
        { path: '/lab-results', label: 'Lab Results', icon: '🔬' },
        { path: '/billing', label: 'Billing', icon: '💰' },
        { path: '/inventory', label: 'Pharmacy Stock', icon: '📦' },
        { path: '/engagement', label: 'Engagement Hub', icon: '🤝' },
        { path: '/hub', label: 'Open Hub', icon: '🌐' }
      ]
    },
    church: {
      label: 'Church',
      icon: '⛪',
      items: [
        { path: '/dashboard', label: 'Dashboard', icon: '📊' },
        { path: '/members', label: 'Members', icon: '👥' },
        { path: '/tithes', label: 'Tithes & Offerings', icon: '🙏' },
        { path: '/events', label: 'Events', icon: '📅' },
        { path: '/sermons', label: 'Sermons', icon: '📖' },
        { path: '/groups', label: 'Cell Groups', icon: '🏠' },
        { path: '/engagement', label: 'Engagement Hub', icon: '🤝' },
        { path: '/hub', label: 'Open Hub', icon: '🌐' }
      ]
    },
    hotel: {
      label: 'Hotel',
      icon: '🏨',
      items: [
        { path: '/dashboard', label: 'Dashboard', icon: '📊' },
        { path: '/rooms', label: 'Rooms', icon: '🛏️' },
        { path: '/reservations', label: 'Reservations', icon: '📋' },
        { path: '/guests', label: 'Guests', icon: '👤' },
        { path: '/billing', label: 'Billing', icon: '💰' },
        { path: '/housekeeping', label: 'Housekeeping', icon: '🧹' },
        { path: '/engagement', label: 'Engagement Hub', icon: '🤝' },
        { path: '/hub', label: 'Open Hub', icon: '🌐' }
      ]
    },
    business: {
      label: 'Business',
      icon: '🏢',
      items: [
        { path: '/dashboard', label: 'Dashboard', icon: '📊' },
        { path: '/customers', label: 'Customers', icon: '👥' },
        { path: '/invoices', label: 'Invoices', icon: '📄' },
        { path: '/expenses', label: 'Expenses', icon: '💸' },
        { path: '/products', label: 'Products', icon: '📦' },
        { path: '/payroll', label: 'Payroll', icon: '👨‍💼' },
        { path: '/engagement', label: 'Engagement Hub', icon: '🤝' },
        { path: '/hub', label: 'Open Hub', icon: '🌐' }
      ]
    },
    individual: {
      label: 'Personal',
      icon: '👤',
      items: [
        { path: '/dashboard', label: 'Dashboard', icon: '📊' },
        { path: '/tasks', label: 'Tasks', icon: '✅' },
        { path: '/notes', label: 'Notes', icon: '📝' },
        { path: '/calendar', label: 'Calendar', icon: '📅' },
        { path: '/finance', label: 'Finance', icon: '💰' },
        { path: '/goals', label: 'Goals', icon: '🎯' },
        { path: '/engagement', label: 'Engagement Hub', icon: '🤝' },
        { path: '/hub', label: 'Open Hub', icon: '🌐' }
      ]
    }
  };

  // Admin-only sidebar items
  const ADMIN_ITEMS = [
    { path: '/admin/settings', label: 'Settings', icon: '⚙️' },
    { path: '/admin/users', label: 'User Management', icon: '👥' },
    { path: '/admin/roles', label: 'Roles & Permissions', icon: '🔐' },
    { path: '/admin/billing', label: 'Subscription', icon: '💳' },
    { path: '/admin/audit', label: 'Audit Log', icon: '🔍' },
    { path: '/admin/backup', label: 'Backup & Restore', icon: '💾' }
  ];

  // Common bottom items for all portals
  const COMMON_ITEMS = [
    { path: '/hub', label: 'Open Hub', icon: '🌐' },
    { path: '/engagement', label: 'Engagement Hub', icon: '🤝' },
    { path: '/profile', label: 'My Profile', icon: '👤' },
    { path: '/help', label: 'Help Center', icon: '❓' }
  ];

  // ============================================================
  // BREADCRUMB MAPPINGS
  // ============================================================
  const BREADCRUMB_MAP = {
    '/dashboard': [{ label: 'Dashboard' }],
    '/hub': [{ label: 'Hub' }],
    '/hub/search': [{ label: 'Hub', path: '/hub' }, { label: 'Search' }],
    '/hub/directory': [{ label: 'Hub', path: '/hub' }, { label: 'Directory' }],
    '/hub/categories': [{ label: 'Hub', path: '/hub' }, { label: 'Categories' }],
    '/engagement': [{ label: 'Engagement' }],
    '/engagement/members': [{ label: 'Engagement', path: '/engagement' }, { label: 'Members' }],
    '/engagement/events': [{ label: 'Engagement', path: '/engagement' }, { label: 'Events' }],
    '/engagement/discussions': [{ label: 'Engagement', path: '/engagement' }, { label: 'Discussions' }],
    '/engagement/resources': [{ label: 'Engagement', path: '/engagement' }, { label: 'Resources' }],
    '/engagement/my-communities': [{ label: 'Engagement', path: '/engagement' }, { label: 'My Communities' }],
    '/students': [{ label: 'Students' }],
    '/fees': [{ label: 'Fees & Payments' }],
    '/attendance': [{ label: 'Attendance' }],
    '/exams': [{ label: 'Exams' }],
    '/reports': [{ label: 'Reports' }],
    '/settings': [{ label: 'Settings' }],
    '/profile': [{ label: 'My Profile' }],
    '/help': [{ label: 'Help Center' }]
  };

  // ============================================================
  // DB MIGRATIONS
  // ============================================================
  (async () => {
    const tables = [
      `CREATE TABLE IF NOT EXISTS nav_favorites (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        item_path VARCHAR(500) NOT NULL,
        item_label VARCHAR(255),
        item_icon VARCHAR(10),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(tenant_id, user_id, item_path)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_nav_favorites_user ON nav_favorites(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_nav_favorites_tenant ON nav_favorites(tenant_id)`,

      `CREATE TABLE IF NOT EXISTS nav_recent (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        item_path VARCHAR(500) NOT NULL,
        item_label VARCHAR(255),
        visited_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_nav_recent_user ON nav_recent(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_nav_recent_visited ON nav_recent(visited_at DESC)`
    ];
    for (const sql of tables) {
      try { await migrateQuery(pool, 'NavigationRoutes', sql); } catch (e) { /* ignore */ }
    }
  })().catch(e => console.error('[NavRoutes] Migration error:', e.message));

  // Helper: track recent visit (fire-and-forget)
  const trackRecent = (userId, tid, path, label) => {
    if (!userId || !path) return;
    pool.query(`
      INSERT INTO nav_recent (tenant_id, user_id, item_path, item_label, visited_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT DO NOTHING
    `, [tid, userId, path, label]).catch(() => {});
    // Clean up: keep only 30 most recent per user
    pool.query(`
      DELETE FROM nav_recent WHERE user_id = $1 AND id NOT IN (
        SELECT id FROM nav_recent WHERE user_id = $1 ORDER BY visited_at DESC LIMIT 30
      )
    `, [userId]).catch(() => {});
  };

  // ============================================================
  // GET /api/nav/menu — Returns navigation menu based on portal type
  // ============================================================
  app.get('/api/nav/menu', ah(async (req, res) => {
    const user = req.session?.user;
    const tid = tenantId(req);
    const portalType = req.query.portal || 'business';

    // Try to get tenant type from DB
    let type = portalType;
    if (tid) {
      try {
        const tenant = (await pool.query(`SELECT sub_type, type FROM tenants WHERE id = $1`, [tid])).rows[0];
        if (tenant) {
          type = tenant.sub_type || tenant.type || portalType;
        }
      } catch (e) { /* use default */ }
    }

    const menuConfig = PORTAL_MENUS[type] || PORTAL_MENUS.business;

    // Track visit
    if (user) {
      trackRecent(user.id, tid, req.query.current || '/dashboard', req.query.current_label || 'Dashboard');
    }

    res.json({
      success: true,
      portal: type,
      portalLabel: menuConfig.label,
      portalIcon: menuConfig.icon,
      items: menuConfig.items,
      common: COMMON_ITEMS,
      isAdmin: user && user.role === 'admin',
      adminItems: (user && user.role === 'admin') ? ADMIN_ITEMS : []
    });
  }));

  // ============================================================
  // GET /api/nav/sidebar — Returns sidebar items based on role and portal
  // ============================================================
  app.get('/api/nav/sidebar', ah(async (req, res) => {
    const user = req.session?.user;
    const tid = tenantId(req);
    const portalType = req.query.portal || '';

    let type = portalType;
    if (tid && !portalType) {
      try {
        const tenant = (await pool.query(`SELECT sub_type, type FROM tenants WHERE id = $1`, [tid])).rows[0];
        if (tenant) type = tenant.sub_type || tenant.type || 'business';
      } catch (e) { /* use default */ }
    }

    const menuConfig = PORTAL_MENUS[type] || PORTAL_MENUS.business;
    let sections = [
      { label: 'Main', items: menuConfig.items }
    ];

    // Add admin section if user is admin
    if (user && user.role === 'admin') {
      sections.push({ label: 'Administration', items: ADMIN_ITEMS });
    }

    // Add favorites section
    let favorites = [];
    if (user && user.id) {
      try {
        const favs = (await pool.query(`
          SELECT item_path, item_label, item_icon FROM nav_favorites
          WHERE user_id = $1 AND tenant_id = $2
          ORDER BY created_at DESC
          LIMIT 10
        `, [user.id, tid])).rows;
        favorites = favs;
      } catch (e) { /* ignore */ }
    }

    if (favorites.length > 0) {
      sections.push({ label: 'Favorites', items: favorites.map(f => ({ path: f.item_path, label: f.item_label, icon: f.item_icon || '⭐' })) });
    }

    // Add common section
    sections.push({ label: 'Quick Links', items: COMMON_ITEMS });

    res.json({
      success: true,
      portal: type,
      sections,
      user: user ? { name: user.name, email: user.email, role: user.role } : null
    });
  }));

  // ============================================================
  // GET /api/nav/breadcrumbs — Returns breadcrumb trail
  // ============================================================
  app.get('/api/nav/breadcrumbs', ah(async (req, res) => {
    const path = req.query.path || '/dashboard';

    // Direct match
    if (BREADCRUMB_MAP[path]) {
      return res.json({ success: true, breadcrumbs: [{ label: 'Home', path: '/dashboard' }, ...BREADCRUMB_MAP[path]] });
    }

    // Dynamic path matching (e.g., /hub/tenant/123, /engagement/community/456)
    const segments = path.split('/').filter(Boolean);
    let breadcrumbs = [{ label: 'Home', path: '/dashboard' }];

    // Build breadcrumbs progressively
    let currentPath = '';
    for (let i = 0; i < segments.length; i++) {
      currentPath += '/' + segments[i];
      // Check for direct match first
      if (BREADCRUMB_MAP[currentPath]) {
        breadcrumbs.push(...BREADCRUMB_MAP[currentPath]);
        break;
      }
      // Check prefix match
      const prefixMatch = Object.keys(BREADCRUMB_MAP).find(k => currentPath.startsWith(k));
      if (prefixMatch && i > 0) {
        breadcrumbs = [...breadcrumbs, ...BREADCRUMB_MAP[prefixMatch]];
        // Add the dynamic segment as last crumb
        const remaining = path.substring(prefixMatch.length);
        if (remaining) {
          breadcrumbs.push({ label: remaining.split('/').filter(Boolean).pop() || 'Detail' });
        }
        break;
      }
    }

    // Fallback: just show the path segments
    if (breadcrumbs.length <= 1) {
      segments.forEach((seg, i) => {
        const segPath = '/' + segments.slice(0, i + 1).join('/');
        const label = seg.charAt(0).toUpperCase() + seg.slice(1).replace(/-/g, ' ');
        // Don't add ID segments as visible labels
        if (/^\d+$/.test(seg)) {
          breadcrumbs[breadcrumbs.length - 1].path = segPath;
        } else {
          breadcrumbs.push({ label, path: segPath });
        }
      });
    }

    res.json({ success: true, breadcrumbs });
  }));

  // ============================================================
  // POST /api/nav/favorites — Save favorite menu items
  // ============================================================
  app.post('/api/nav/favorites', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = tenantId(req);
    const { item_path, item_label, item_icon } = req.body;

    if (!item_path || !item_label) {
      return res.status(400).json({ success: false, message: 'item_path and item_label are required' });
    }

    // Max 20 favorites per user
    const count = (await pool.query(`SELECT COUNT(*) as cnt FROM nav_favorites WHERE user_id = $1 AND tenant_id = $2`, [user.id, tid])).rows[0].cnt;
    if (parseInt(count) >= 20) {
      return res.json({ success: false, message: 'Maximum 20 favorites allowed. Remove some first.' });
    }

    await pool.query(`
      INSERT INTO nav_favorites (tenant_id, user_id, item_path, item_label, item_icon)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (tenant_id, user_id, item_path) DO NOTHING
    `, [tid, user.id, item_path, item_label, item_icon || '⭐']);

    audit('add_favorite', { path: item_path, label: item_label, userId: user.id });

    res.json({ success: true, message: 'Favorite added' });
  }));

  // DELETE /api/nav/favorites — Remove a favorite
  app.delete('/api/nav/favorites', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = tenantId(req);
    const { item_path } = req.body;

    if (!item_path) {
      return res.status(400).json({ success: false, message: 'item_path is required' });
    }

    const result = await pool.query(`DELETE FROM nav_favorites WHERE user_id = $1 AND tenant_id = $2 AND item_path = $3`, [user.id, tid, item_path]);
    audit('remove_favorite', { path: item_path, userId: user.id });

    res.json({ success: true, removed: result.rowCount > 0 });
  }));

  // ============================================================
  // GET /api/nav/recent — Recently visited pages
  // ============================================================
  app.get('/api/nav/recent', ah(async (req, res) => {
    const user = req.session?.user;
    const tid = tenantId(req);
    const limit = Math.min(20, Math.max(1, parseInt(req.query.limit) || 10));

    if (!user || !user.id) {
      return res.json({ success: true, recent: [] });
    }

    const recent = (await pool.query(`
      SELECT item_path, item_label, visited_at
      FROM nav_recent
      WHERE user_id = $1 AND tenant_id = $2
      ORDER BY visited_at DESC
      LIMIT $3
    `, [user.id, tid, limit])).rows;

    res.json({
      success: true,
      recent: recent.map(r => ({
        path: r.item_path,
        label: r.item_label,
        visitedAt: r.visited_at
      }))
    });
  }));

  console.log('[NavRoutes] loaded — 2 tables, 6 routes');
};
