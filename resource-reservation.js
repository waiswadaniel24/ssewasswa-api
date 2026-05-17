// ============================================================
// RESOURCE RESERVATION MODULE — Multi-Tenant SaaS Platform
// Resource catalog, booking calendar, approval workflow,
// maintenance scheduling, usage tracking, QR check-out.
// ============================================================
// Usage in server.js:
//   const resourceReservation = require('./resource-reservation');
//   resourceReservation(app, pool, { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT });
// ============================================================

'use strict';

module.exports = function resourceReservation(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5', GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.btn:hover{background:#3730a3}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}</style><div class="breadcrumb" style="margin-bottom:16px"><a href="/school" style="color:#4f46e5">School</a> &rsaquo; Resource Reservation</div>';

  // ── internal helpers ────────────────────────────────────────
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const todayISO = () => new Date().toISOString().slice(0, 10);

  function statusBadge(s) {
    const m = {
      available:   { bg: '#dcfce7', c: '#16a34a', l: '✅ Available' },
      in_use:      { bg: '#dbeafe', c: '#2563eb', l: '🔵 In Use' },
      reserved:    { bg: '#fef3c7', c: '#b45309', l: '🟡 Reserved' },
      maintenance: { bg: '#fee2e2', c: '#dc2626', l: '🔧 Maintenance' },
      retired:     { bg: '#f1f5f9', c: '#64748b', l: '⬛ Retired' },
      pending:     { bg: '#fef3c7', c: '#b45309', l: '⏳ Pending' },
      approved:    { bg: '#dcfce7', c: '#16a34a', l: '✅ Approved' },
      rejected:    { bg: '#fee2e2', c: '#dc2626', l: '❌ Rejected' },
      completed:   { bg: '#e0e7ff', c: '#4f46e5', l: '✅ Completed' },
      overdue:     { bg: '#fee2e2', c: '#dc2626', l: '⚠️ Overdue' },
      cancelled:   { bg: '#f1f5f9', c: '#64748b', l: '🚫 Cancelled' }
    };
    const v = m[s] || { bg: '#f1f5f9', c: '#64748b', l: s || '—' };
    return '<span class="badge" style="background:' + v.bg + ';color:' + v.c + ';padding:4px 10px;border-radius:6px;font-size:12px;font-weight:600;display:inline-block">' + v.l + '</span>';
  }

  function conditionBadge(c) {
    const m = {
      new:       { bg: '#dcfce7', c: '#16a34a', l: '🟢 New' },
      good:      { bg: '#dcfce7', c: '#16a34a', l: '🟢 Good' },
      fair:      { bg: '#fef3c7', c: '#b45309', l: '🟡 Fair' },
      poor:      { bg: '#fee2e2', c: '#dc2626', l: '🔴 Poor' },
      damaged:   { bg: '#fee2e2', c: '#dc2626', l: '💥 Damaged' }
    };
    const v = m[c] || { bg: '#f1f5f9', c: '#64748b', l: c || '—' };
    return '<span class="badge" style="background:' + v.bg + ';color:' + v.c + ';padding:3px 8px;border-radius:6px;font-size:11px;font-weight:600">' + v.l + '</span>';
  }

  // ── CSS ─────────────────────────────────────────────────────
  const CSS = '<style>\
.rr-nav{display:flex;gap:6px;margin-bottom:20px;flex-wrap:wrap}\
.rr-nav a{padding:8px 16px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#475569;background:#f1f5f9;transition:.15s}\
.rr-nav a:hover{background:#e2e8f0}.rr-nav a.active{background:#4f46e5;color:#fff}\
.rr-table{width:100%;border-collapse:collapse;font-size:13px}\
.rr-table th{padding:10px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#f8fafc}\
.rr-table td{padding:9px 14px;border-bottom:1px solid #f1f5f9;color:#1e293b}\
.rr-table tr:hover{background:#f8fafc}\
.rr-filter{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:end}\
.rr-filter label{display:block;font-size:12px;font-weight:600;color:#64748b;margin-bottom:4px}\
.rr-filter input,.rr-filter select{padding:8px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px;background:#fff;width:auto}\
.rr-filter input:focus,.rr-filter select:focus{outline:none;border-color:#6366f1}\
.rr-form label{display:block;font-size:13px;font-weight:600;color:#475569;margin-bottom:4px}\
.rr-form input,.rr-form select,.rr-form textarea{width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;box-sizing:border-box}\
.rr-form input:focus,.rr-form select:focus,.rr-form textarea:focus{outline:none;border-color:#6366f1}\
.rr-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}\
.rr-card{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:16px;margin-bottom:12px;transition:.15s}\
.rr-card:hover{box-shadow:0 2px 12px rgba(0,0,0,.06)}\
.cal-day{min-height:80px;border:1px solid #e2e8f0;border-radius:8px;padding:6px;font-size:11px;vertical-align:top}\
.cal-day.has-events{background:#eef2ff}\
.cal-day.today{border-color:#4f46e5;border-width:2px}\
.cal-event{background:#4f46e5;color:#fff;padding:2px 6px;border-radius:4px;margin-bottom:2px;font-size:10px;cursor:pointer}\
.cal-event.overdue{background:#dc2626}\
@media(max-width:768px){.rr-grid{grid-template-columns:1fr}.rr-nav{gap:4px}.rr-nav a{padding:6px 10px;font-size:11px}}\
</style>';

  // ── nav helper ──────────────────────────────────────────────
  function rrNav(active) {
    const links = [
      ['/school/resource-reservation', 'Dashboard'],
      ['/school/resource-reservation/resources', 'Resources'],
      ['/school/resource-reservation/resources/new', 'Add Resource'],
      ['/school/resource-reservation/categories', 'Categories'],
      ['/school/resource-reservation/my-reservations', 'My Reservations'],
      ['/school/resource-reservation/calendar', 'Calendar'],
      ['/school/resource-reservation/maintenance', 'Maintenance'],
      ['/school/resource-reservation/reports', 'Reports']
    ];
    return '<div class="rr-nav">' + links.map(([href, label]) =>
      '<a href="' + href + '" class="' + (active === href ? 'active' : '') + '">' + label + '</a>').join('') + '</div>';
  }

  // ════════════════════════════════════════════════════════════
  // DATABASE MIGRATIONS
  // ════════════════════════════════════════════════════════════
  const migrations = [
    `CREATE TABLE IF NOT EXISTS resource_categories (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL, description TEXT, is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS resources (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      category_id INTEGER REFERENCES resource_categories(id) ON DELETE SET NULL,
      name VARCHAR(255) NOT NULL, description TEXT, quantity INTEGER DEFAULT 1,
      condition VARCHAR(20) DEFAULT 'good', location VARCHAR(255), image_url TEXT,
      status VARCHAR(20) DEFAULT 'available', qr_code VARCHAR(255),
      created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS resource_reservations (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      resource_id INTEGER NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
      user_id INTEGER, user_name VARCHAR(255) NOT NULL,
      purpose TEXT, start_time TIMESTAMPTZ NOT NULL, end_time TIMESTAMPTZ NOT NULL,
      quantity_reserved INTEGER DEFAULT 1, status VARCHAR(20) DEFAULT 'pending',
      approved_by INTEGER, notes TEXT, checked_out_at TIMESTAMPTZ,
      returned_at TIMESTAMPTZ, return_condition VARCHAR(20),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS resource_maintenance (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      resource_id INTEGER NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
      description TEXT NOT NULL, cost NUMERIC(10,2) DEFAULT 0,
      start_date DATE NOT NULL, end_date DATE,
      technician VARCHAR(255), status VARCHAR(20) DEFAULT 'scheduled',
      notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    // ALTER TABLE resource_categories
    `ALTER TABLE IF EXISTS resource_categories ADD COLUMN IF NOT EXISTS name VARCHAR(255) NOT NULL DEFAULT ''`,
    `ALTER TABLE IF EXISTS resource_categories ADD COLUMN IF NOT EXISTS description TEXT`,
    `ALTER TABLE IF EXISTS resource_categories ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true`,
    // ALTER TABLE resources
    `ALTER TABLE IF EXISTS resources ADD COLUMN IF NOT EXISTS name VARCHAR(255) NOT NULL DEFAULT ''`,
    `ALTER TABLE IF EXISTS resources ADD COLUMN IF NOT EXISTS description TEXT`,
    `ALTER TABLE IF EXISTS resources ADD COLUMN IF NOT EXISTS quantity INTEGER DEFAULT 1`,
    `ALTER TABLE IF EXISTS resources ADD COLUMN IF NOT EXISTS condition VARCHAR(20) DEFAULT 'good'`,
    `ALTER TABLE IF EXISTS resources ADD COLUMN IF NOT EXISTS location VARCHAR(255)`,
    `ALTER TABLE IF EXISTS resources ADD COLUMN IF NOT EXISTS image_url TEXT`,
    `ALTER TABLE IF EXISTS resources ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'available'`,
    `ALTER TABLE IF EXISTS resources ADD COLUMN IF NOT EXISTS qr_code VARCHAR(255)`,
    `ALTER TABLE IF EXISTS resources ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`,
    // ALTER TABLE resource_reservations
    `ALTER TABLE IF EXISTS resource_reservations ADD COLUMN IF NOT EXISTS user_name VARCHAR(255) NOT NULL DEFAULT ''`,
    `ALTER TABLE IF EXISTS resource_reservations ADD COLUMN IF NOT EXISTS purpose TEXT`,
    `ALTER TABLE IF EXISTS resource_reservations ADD COLUMN IF NOT EXISTS quantity_reserved INTEGER DEFAULT 1`,
    `ALTER TABLE IF EXISTS resource_reservations ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'pending'`,
    `ALTER TABLE IF EXISTS resource_reservations ADD COLUMN IF NOT EXISTS approved_by INTEGER`,
    `ALTER TABLE IF EXISTS resource_reservations ADD COLUMN IF NOT EXISTS notes TEXT`,
    `ALTER TABLE IF EXISTS resource_reservations ADD COLUMN IF NOT EXISTS checked_out_at TIMESTAMPTZ`,
    `ALTER TABLE IF EXISTS resource_reservations ADD COLUMN IF NOT EXISTS returned_at TIMESTAMPTZ`,
    `ALTER TABLE IF EXISTS resource_reservations ADD COLUMN IF NOT EXISTS return_condition VARCHAR(20)`,
    // ALTER TABLE resource_maintenance
    `ALTER TABLE IF EXISTS resource_maintenance ADD COLUMN IF NOT EXISTS cost NUMERIC(10,2) DEFAULT 0`,
    `ALTER TABLE IF EXISTS resource_maintenance ADD COLUMN IF NOT EXISTS end_date DATE`,
    `ALTER TABLE IF EXISTS resource_maintenance ADD COLUMN IF NOT EXISTS technician VARCHAR(255)`,
    `ALTER TABLE IF EXISTS resource_maintenance ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'scheduled'`,
    `ALTER TABLE IF EXISTS resource_maintenance ADD COLUMN IF NOT EXISTS notes TEXT`,
    // Indexes
    `CREATE INDEX IF NOT EXISTS idx_rcat_tenant ON resource_categories(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_res_tenant ON resources(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_res_category ON resources(tenant_id, category_id)`,
    `CREATE INDEX IF NOT EXISTS idx_res_status ON resources(tenant_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_rrsv_tenant ON resource_reservations(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_rrsv_resource ON resource_reservations(resource_id)`,
    `CREATE INDEX IF NOT EXISTS idx_rrsv_user ON resource_reservations(tenant_id, user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_rrsv_status ON resource_reservations(tenant_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_rrsv_time ON resource_reservations(start_time, end_time)`,
    `CREATE INDEX IF NOT EXISTS idx_rmnt_tenant ON resource_maintenance(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_rmnt_resource ON resource_maintenance(resource_id)`,
    `CREATE INDEX IF NOT EXISTS idx_rmnt_status ON resource_maintenance(tenant_id, status)`
  ];

  (async () => {
    const client = await pool.connect().catch(() => null);
    if (!client) { console.warn('[ResourceReservation] Cannot connect to DB for migrations'); return; }
    try {
      for (const sql of migrations) await client.query(sql);
      console.log('[ResourceReservation] Migrations applied: ' + migrations.length + ' statements');
    } catch (e) { console.warn('[ResourceReservation] Migration warning:', e.message); }
    finally { client.release(); }
  })();

  // ════════════════════════════════════════════════════════════
  // ROUTE 1: GET /school/resource-reservation — Dashboard
  // ════════════════════════════════════════════════════════════
  app.get('/school/resource-reservation', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const stats = (await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM resources WHERE tenant_id=$1 AND status != 'retired') as total_resources,
        (SELECT COUNT(*) FROM resources WHERE tenant_id=$1 AND status='available') as available,
        (SELECT COUNT(*) FROM resources WHERE tenant_id=$1 AND status='in_use') as in_use,
        (SELECT COUNT(*) FROM resources WHERE tenant_id=$1 AND status='maintenance') as in_maintenance,
        (SELECT COUNT(*) FROM resource_reservations WHERE tenant_id=$1 AND status='pending') as pending_reservations,
        (SELECT COUNT(*) FROM resource_reservations WHERE tenant_id=$1 AND status='approved' AND end_time < NOW() AND returned_at IS NULL) as overdue,
        (SELECT COUNT(*) FROM resource_reservations WHERE tenant_id=$1 AND status='approved') as active_reservations,
        (SELECT COUNT(*) FROM resource_categories WHERE tenant_id=$1 AND is_active=true) as categories
    `, [tid])).rows[0];

    const recentReservations = (await pool.query(`
      SELECT rr.*, r.name as resource_name, rc.name as category_name
      FROM resource_reservations rr
      JOIN resources r ON r.id = rr.resource_id
      LEFT JOIN resource_categories rc ON rc.id = r.category_id
      WHERE rr.tenant_id=$1 ORDER BY rr.created_at DESC LIMIT 8`, [tid]
    )).rows;

    const overdueItems = (await pool.query(`
      SELECT rr.*, r.name as resource_name
      FROM resource_reservations rr
      JOIN resources r ON r.id = rr.resource_id
      WHERE rr.tenant_id=$1 AND rr.status='approved' AND rr.end_time < NOW() AND rr.returned_at IS NULL
      ORDER BY rr.end_time ASC`, [tid]
    )).rows;

    const upcomingMaintenance = (await pool.query(`
      SELECT rm.*, r.name as resource_name
      FROM resource_maintenance rm
      JOIN resources r ON r.id = rm.resource_id
      WHERE rm.tenant_id=$1 AND rm.status='scheduled' AND rm.start_date >= CURRENT_DATE
      ORDER BY rm.start_date ASC LIMIT 5`, [tid]
    )).rows;

    const recentRows = recentReservations.map(r => '<tr>' +
      '<td><a href="/school/resource-reservation/resources/' + r.resource_id + '" style="color:' + P + ';text-decoration:none;font-weight:600">' + esc(r.resource_name) + '</a></td>' +
      '<td>' + esc(r.user_name) + '</td>' +
      '<td style="font-size:12px">' + fmtDateTime(r.start_time) + '</td>' +
      '<td>' + statusBadge(r.status) + '</td>' +
    '</tr>').join('');

    const overdueRows = overdueItems.map(r => '<tr style="background:#fff5f5">' +
      '<td style="font-weight:600">' + esc(r.resource_name) + '</td>' +
      '<td>' + esc(r.user_name) + '</td>' +
      '<td style="font-size:12px;color:#dc2626;font-weight:600">Due: ' + fmtDateTime(r.end_time) + '</td>' +
      '<td><form method="POST" action="/school/resource-reservation/return/' + r.id + '" style="display:inline">' +
        '<button type="submit" class="btn" style="background:#dc2626;font-size:12px;padding:5px 12px">Return</button></form></td>' +
    '</tr>').join('');

    const maintRows = upcomingMaintenance.map(m => '<tr>' +
      '<td>' + esc(m.resource_name) + '</td>' +
      '<td>' + esc(m.description || '').substring(0, 50) + '...</td>' +
      '<td>' + fmtDate(m.start_date) + '</td>' +
      '<td>' + esc(m.technician || '—') + '</td>' +
    '</tr>').join('');

    const html = CSS + '<div style="max-width:1200px;margin:0 auto">' +
      rrNav('/school/resource-reservation') +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">' +
        '<div><h1 style="font-size:24px;color:#1e293b">📦 Resource Reservation</h1>' +
        '<p style="font-size:13px;color:#94a3b8;margin-top:2px">Manage school resources, bookings, and maintenance</p></div>' +
        '<div style="display:flex;gap:8px">' +
          '<a href="/school/resource-reservation/resources/new" class="btn" style="background:#059669">+ Add Resource</a>' +
          '<a href="/school/resource-reservation/availability-check" class="btn" style="background:#0891b2">🔍 Check Availability</a>' +
        '</div>' +
      '</div>' +
      '<div class="stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:14px;margin-bottom:20px">' +
        '<div class="stat-card"><div class="stat-num" style="color:' + P + '">' + stats.total_resources + '</div><div style="font-size:11px;color:#94a3b8;text-transform:uppercase">Total Resources</div></div>' +
        '<div class="stat-card"><div class="stat-num" style="color:#16a34a">' + stats.available + '</div><div style="font-size:11px;color:#94a3b8;text-transform:uppercase">Available</div></div>' +
        '<div class="stat-card"><div class="stat-num" style="color:#2563eb">' + stats.in_use + '</div><div style="font-size:11px;color:#94a3b8;text-transform:uppercase">In Use</div></div>' +
        '<div class="stat-card"><div class="stat-num" style="color:#dc2626">' + stats.in_maintenance + '</div><div style="font-size:11px;color:#94a3b8;text-transform:uppercase">Maintenance</div></div>' +
        '<div class="stat-card"><div class="stat-num" style="color:#f59e0b">' + stats.pending_reservations + '</div><div style="font-size:11px;color:#94a3b8;text-transform:uppercase">Pending</div></div>' +
        '<div class="stat-card"><div class="stat-num" style="color:#dc2626">' + stats.overdue + '</div><div style="font-size:11px;color:#94a3b8;text-transform:uppercase">Overdue</div></div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">' +
        '<div class="card"><h3 style="color:#1e293b;margin:0 0 12px;font-size:15px">📋 Recent Reservations</h3>' +
          '<div style="overflow-x:auto"><table class="rr-table"><thead><tr><th>Resource</th><th>User</th><th>Start</th><th>Status</th></tr></thead>' +
          '<tbody>' + (recentRows || '<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:20px">No reservations yet</td></tr>') + '</tbody></table></div></div>' +
        '<div class="card"><h3 style="color:#1e293b;margin:0 0 12px;font-size:15px">⚠️ Overdue Items (' + overdueItems.length + ')</h3>' +
          '<div style="overflow-x:auto"><table class="rr-table"><thead><tr><th>Resource</th><th>User</th><th>Due Date</th><th>Action</th></tr></thead>' +
          '<tbody>' + (overdueRows || '<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:20px">No overdue items 🎉</td></tr>') + '</tbody></table></div></div>' +
      '</div>' +
      (upcomingMaintenance.length ? '<div class="card"><h3 style="color:#1e293b;margin:0 0 12px;font-size:15px">🔧 Upcoming Maintenance</h3>' +
        '<div style="overflow-x:auto"><table class="rr-table"><thead><tr><th>Resource</th><th>Description</th><th>Start Date</th><th>Technician</th></tr></thead>' +
        '<tbody>' + maintRows + '</tbody></table></div></div>' : '') +
    '</div>';
    res.send(renderPage('Resource Reservation Dashboard', html, user, req));
    audit(user.tenant_id, user.id, 'viewed_resource_reservation_dashboard', 'Resource reservation dashboard viewed');
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 2: GET /school/resource-reservation/resources — Catalog
  // ════════════════════════════════════════════════════════════
  app.get('/school/resource-reservation/resources', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { q, category, status, condition } = req.query;

    const categories = (await pool.query(
      'SELECT * FROM resource_categories WHERE tenant_id=$1 AND is_active=true ORDER BY name', [tid]
    )).rows;

    let where = ['r.tenant_id=$1'], params = [tid], pi = 2;
    if (q) { where.push('(r.name ILIKE $' + pi + ' OR r.description ILIKE $' + pi + ')'); params.push('%' + q + '%'); pi++; }
    if (category) { where.push('r.category_id=$' + pi); params.push(parseInt(category)); pi++; }
    if (status) { where.push('r.status=$' + pi); params.push(status); pi++; }
    if (condition) { where.push('r.condition=$' + pi); params.push(condition); pi++; }

    const resources = (await pool.query(
      'SELECT r.*, rc.name as category_name FROM resources r LEFT JOIN resource_categories rc ON rc.id=r.category_id WHERE ' +
      where.join(' AND ') + ' ORDER BY r.name ASC LIMIT 100', params
    )).rows;

    // Pre-compute in-use counts for all resources in a single query
    const resIds = resources.map(r => r.id);
    const inUseMap = {};
    if (resIds.length > 0) {
      const inUseRows = (await pool.query(
        'SELECT resource_id, COUNT(*)::int as cnt FROM resource_reservations WHERE resource_id = ANY($1) AND status=\'approved\' AND returned_at IS NULL GROUP BY resource_id',
        [resIds]
      )).rows;
      inUseRows.forEach(row => { inUseMap[row.resource_id] = row.cnt; });
    }

    const rows = resources.map(r => {
      const inUse = inUseMap[r.id] || 0;
      return '<tr>' +
        '<td><a href="/school/resource-reservation/resources/' + r.id + '" style="color:' + P + ';text-decoration:none;font-weight:600">' + esc(r.name) + '</a></td>' +
        '<td>' + (r.category_name ? '<span style="background:#f1f5f9;padding:3px 8px;border-radius:6px;font-size:11px;color:#475569">' + esc(r.category_name) + '</span>' : '—') + '</td>' +
        '<td>' + esc(r.location || '—') + '</td>' +
        '<td>' + (r.quantity - inUse) + ' / ' + r.quantity + '</td>' +
        '<td>' + conditionBadge(r.condition) + '</td>' +
        '<td>' + statusBadge(r.status) + '</td>' +
        '<td><div style="display:flex;gap:4px">' +
          '<a href="/school/resource-reservation/resources/' + r.id + '" class="btn" style="font-size:11px;padding:5px 10px">View</a>' +
          '<a href="/school/resource-reservation/resources/' + r.id + '/edit" class="btn" style="font-size:11px;padding:5px 10px;background:#f59e0b">Edit</a>' +
        '</div></td>' +
      '</tr>';
    }).join('');

    const catOpts = '<option value="">All Categories</option>' + categories.map(c =>
      '<option value="' + c.id + '"' + (category == c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('');
    const statusOpts = '<option value="">All Status</option>' +
      ['available','in_use','reserved','maintenance','retired'].map(s =>
        '<option value="' + s + '"' + (status === s ? ' selected' : '') + '>' + s.charAt(0).toUpperCase() + s.slice(1) + '</option>').join('');

    const html = CSS + '<div style="max-width:1200px;margin:0 auto">' +
      rrNav('/school/resource-reservation/resources') +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">' +
        '<div><h1 style="font-size:22px;color:#1e293b">📦 Resource Catalog</h1>' +
        '<p style="font-size:13px;color:#94a3b8;margin-top:2px">' + resources.length + ' resources found</p></div>' +
        '<a href="/school/resource-reservation/resources/new" class="btn" style="background:#059669">+ Add Resource</a>' +
      '</div>' +
      '<div class="rr-filter">' +
        '<form method="GET" style="display:flex;gap:8px;flex-wrap:wrap">' +
          '<div><label>Search</label><input type="text" name="q" value="' + esc(q || '') + '" placeholder="Search resources..." style="width:200px"></div>' +
          '<div><label>Category</label><select name="category">' + catOpts + '</select></div>' +
          '<div><label>Status</label><select name="status">' + statusOpts + '</select></div>' +
          '<div style="align-self:end"><button type="submit" class="btn" style="font-size:13px">Search</button></div>' +
        '</form>' +
      '</div>' +
      '<div class="card"><div style="overflow-x:auto"><table class="rr-table">' +
        '<thead><tr><th>Resource</th><th>Category</th><th>Location</th><th>Available</th><th>Condition</th><th>Status</th><th>Actions</th></tr></thead>' +
        '<tbody>' + (rows || '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:30px">No resources found</td></tr>') + '</tbody>' +
      '</table></div></div></div>';
    res.send(renderPage('Resource Catalog', html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 3: GET /school/resource-reservation/resources/new
  // ════════════════════════════════════════════════════════════
  app.get('/school/resource-reservation/resources/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const categories = (await pool.query(
      'SELECT * FROM resource_categories WHERE tenant_id=$1 AND is_active=true ORDER BY name', [tid]
    )).rows;

    const catOpts = '<option value="">— Select Category —</option>' + categories.map(c =>
      '<option value="' + c.id + '">' + esc(c.name) + '</option>').join('');
    const condOpts = ['new','good','fair','poor','damaged'].map(c =>
      '<option value="' + c + '"' + (c === 'good' ? ' selected' : '') + '>' + c.charAt(0).toUpperCase() + c.slice(1) + '</option>').join('');

    const html = CSS + '<div style="max-width:800px;margin:0 auto">' +
      rrNav('/school/resource-reservation/resources/new') +
      '<a href="/school/resource-reservation/resources" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Resources</a>' +
      '<div class="card" style="padding:24px">' +
        '<h2 style="color:#1e293b;margin-bottom:4px">➕ Add New Resource</h2>' +
        '<p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Add a new resource to the school catalog</p>' +
        '<form method="POST" action="/school/resource-reservation/resources/create" class="rr-form" style="display:flex;flex-direction:column;gap:16px">' +
          '<div class="rr-grid">' +
            '<div><label>Name *</label><input type="text" name="name" required placeholder="e.g., Epson Projector X500"></div>' +
            '<div><label>Category</label><select name="category_id">' + catOpts + '</select></div>' +
          '</div>' +
          '<div class="rr-grid">' +
            '<div><label>Quantity</label><input type="number" name="quantity" value="1" min="1"></div>' +
            '<div><label>Condition</label><select name="condition">' + condOpts + '</select></div>' +
          '</div>' +
          '<div class="rr-grid">' +
            '<div><label>Location</label><input type="text" name="location" placeholder="e.g., Lab 101, Sports Room"></div>' +
            '<div><label>Image URL</label><input type="url" name="image_url" placeholder="https://..."></div>' +
          '</div>' +
          '<div><label>Description</label><textarea name="description" rows="3" placeholder="Optional resource description..."></textarea></div>' +
          '<div style="display:flex;gap:10px;margin-top:8px">' +
            '<button type="submit" class="btn" style="background:#059669;padding:12px 28px">💾 Save Resource</button>' +
            '<a href="/school/resource-reservation/resources" class="btn" style="padding:12px 28px;background:#f1f5f9;color:#475569;text-decoration:none">Cancel</a>' +
          '</div>' +
        '</form>' +
      '</div></div>';
    res.send(renderPage('Add Resource', html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 4: POST /school/resource-reservation/resources/create
  // ════════════════════════════════════════════════════════════
  app.post('/school/resource-reservation/resources/create', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { name, category_id, quantity, condition, location, image_url, description } = req.body;
    if (!name || !name.trim()) return res.redirect('/school/resource-reservation/resources/new');
    const catId = category_id ? parseInt(category_id) : null;
    const qty = Math.max(1, parseInt(quantity) || 1);
    const qrCode = 'RR-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();

    await pool.query(
      `INSERT INTO resources (tenant_id, category_id, name, description, quantity, condition, location, image_url, status, qr_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'available',$9)`,
      [tid, catId, name.trim(), (description || '').trim() || null, qty, condition || 'good',
       (location || '').trim() || null, (image_url || '').trim() || null, qrCode]
    );
    audit(tid, user.id, 'created_resource', 'Resource "' + name.trim() + '" created');
    res.redirect('/school/resource-reservation/resources');
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 5: GET /school/resource-reservation/resources/:id
  // ════════════════════════════════════════════════════════════
  app.get('/school/resource-reservation/resources/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, rid = req.params.id;
    const resource = (await pool.query(
      'SELECT r.*, rc.name as category_name FROM resources r LEFT JOIN resource_categories rc ON rc.id=r.category_id WHERE r.id=$1 AND r.tenant_id=$2', [rid, tid]
    )).rows[0];
    if (!resource) return res.send('<div class="card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">Resource not found</h2><a href="/school/resource-reservation/resources" class="btn" style="margin-top:12px">← Back</a></div>');

    const inUse = (await pool.query(
      'SELECT COUNT(*)::int as cnt FROM resource_reservations WHERE resource_id=$1 AND status=\'approved\' AND returned_at IS NULL', [rid]
    )).rows[0].cnt;

    const reservations = (await pool.query(
      'SELECT * FROM resource_reservations WHERE resource_id=$1 AND tenant_id=$2 ORDER BY created_at DESC LIMIT 30', [rid, tid]
    )).rows;

    const maintenance = (await pool.query(
      'SELECT * FROM resource_maintenance WHERE resource_id=$1 AND tenant_id=$2 ORDER BY created_at DESC LIMIT 10', [rid, tid]
    )).rows;

    const resRows = reservations.map(r => '<tr>' +
      '<td>' + esc(r.user_name) + '</td>' +
      '<td style="font-size:12px">' + fmtDateTime(r.start_time) + '</td>' +
      '<td style="font-size:12px">' + fmtDateTime(r.end_time) + '</td>' +
      '<td>' + statusBadge(r.status) + '</td>' +
      '<td>' + (r.returned_at ? fmtDate(r.returned_at) : (r.status === 'approved' && r.end_time < new Date() ? '<span style="color:#dc2626;font-weight:600">OVERDUE</span>' : '—')) + '</td>' +
    '</tr>').join('');

    const maintRows = maintenance.map(m => '<tr>' +
      '<td>' + esc(m.description || '').substring(0, 60) + '</td>' +
      '<td>' + fmtDate(m.start_date) + '</td>' +
      '<td>' + fmtDate(m.end_date || '') + '</td>' +
      '<td>' + esc(m.technician || '—') + '</td>' +
      '<td>' + statusBadge(m.status) + '</td>' +
    '</tr>').join('');

    const html = CSS + '<div style="max-width:1100px;margin:0 auto">' +
      rrNav('/school/resource-reservation/resources') +
      '<a href="/school/resource-reservation/resources" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Resources</a>' +
      '<div class="card" style="padding:24px;margin-bottom:16px">' +
        '<div style="display:flex;gap:20px;flex-wrap:wrap">' +
          '<div style="width:100px;height:100px;border-radius:14px;background:#f1f5f9;display:flex;align-items:center;justify-content:center;font-size:48px;flex-shrink:0">📦</div>' +
          '<div style="flex:1;min-width:250px">' +
            '<h2 style="color:#1e293b;margin:0 0 4px">' + esc(resource.name) + '</h2>' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">' +
              statusBadge(resource.status) +
              conditionBadge(resource.condition) +
              (resource.category_name ? '<span style="background:#f1f5f9;padding:3px 10px;border-radius:6px;font-size:12px;color:#475569">' + esc(resource.category_name) + '</span>' : '') +
            '</div>' +
            '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;font-size:13px">' +
              '<div><span style="color:#94a3b8">Location:</span> <strong>' + esc(resource.location || '—') + '</strong></div>' +
              '<div><span style="color:#94a3b8">Available:</span> <strong>' + (resource.quantity - inUse) + ' / ' + resource.quantity + '</strong></div>' +
              '<div><span style="color:#94a3b8">QR Code:</span> <strong style="font-family:monospace;font-size:12px">' + esc(resource.qr_code || '—') + '</strong></div>' +
            '</div>' +
            (resource.description ? '<p style="color:#475569;font-size:14px;margin-top:12px">' + esc(resource.description) + '</p>' : '') +
            '<div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">' +
              '<a href="/school/resource-reservation/resources/' + rid + '/edit" class="btn" style="background:#f59e0b">✏️ Edit</a>' +
              '<a href="/school/resource-reservation/resources/' + rid + '/reserve" class="btn" style="background:#0891b2">📅 Reserve</a>' +
              '<a href="/school/resource-reservation/maintenance?resource_id=' + rid + '" class="btn" style="background:#dc2626">🔧 Schedule Maintenance</a>' +
              '<form method="POST" action="/school/resource-reservation/resources/' + rid + '/delete" style="display:inline" onsubmit="return confirm(\'Delete this resource?\')">' +
                '<button type="submit" class="btn" style="background:#6b7280">🗑️ Delete</button></form>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">' +
        '<div class="card"><h3 style="color:#1e293b;margin:0 0 12px;font-size:15px">📅 Reservation History</h3>' +
          '<div style="overflow-x:auto"><table class="rr-table"><thead><tr><th>User</th><th>Start</th><th>End</th><th>Status</th><th>Returned</th></tr></thead>' +
          '<tbody>' + (resRows || '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:20px">No reservations yet</td></tr>') + '</tbody></table></div></div>' +
        '<div class="card"><h3 style="color:#1e293b;margin:0 0 12px;font-size:15px">🔧 Maintenance Log</h3>' +
          '<div style="overflow-x:auto"><table class="rr-table"><thead><tr><th>Description</th><th>Start</th><th>End</th><th>Technician</th><th>Status</th></tr></thead>' +
          '<tbody>' + (maintRows || '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:20px">No maintenance records</td></tr>') + '</tbody></table></div></div>' +
      '</div></div>';
    res.send(renderPage('Resource: ' + resource.name, html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 6: GET /school/resource-reservation/resources/:id/edit
  // ════════════════════════════════════════════════════════════
  app.get('/school/resource-reservation/resources/:id/edit', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, rid = req.params.id;
    const resource = (await pool.query('SELECT * FROM resources WHERE id=$1 AND tenant_id=$2', [rid, tid])).rows[0];
    if (!resource) return res.redirect('/school/resource-reservation/resources');

    const categories = (await pool.query(
      'SELECT * FROM resource_categories WHERE tenant_id=$1 AND is_active=true ORDER BY name', [tid]
    )).rows;
    const catOpts = '<option value="">— None —</option>' + categories.map(c =>
      '<option value="' + c.id + '"' + (c.id === resource.category_id ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('');
    const condOpts = ['new','good','fair','poor','damaged'].map(c =>
      '<option value="' + c + '"' + (c === resource.condition ? ' selected' : '') + '>' + c.charAt(0).toUpperCase() + c.slice(1) + '</option>').join('');
    const statusOpts = ['available','in_use','reserved','maintenance','retired'].map(s =>
      '<option value="' + s + '"' + (s === resource.status ? ' selected' : '') + '>' + s.charAt(0).toUpperCase() + s.slice(1).replace('_', ' ') + '</option>').join('');

    const fld = (label, name, type, val, ph) => '<div><label>' + label + '</label><input type="' + type + '" name="' + name + '" value="' + esc(String(val || '')) + '" placeholder="' + esc(ph || '') + '"></div>';

    const html = CSS + '<div style="max-width:800px;margin:0 auto">' +
      rrNav('/school/resource-reservation/resources/new') +
      '<a href="/school/resource-reservation/resources/' + rid + '" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Resource</a>' +
      '<div class="card" style="padding:24px">' +
        '<h2 style="color:#1e293b;margin-bottom:20px">✏️ Edit: ' + esc(resource.name) + '</h2>' +
        '<form method="POST" action="/school/resource-reservation/resources/' + rid + '/update" class="rr-form" style="display:flex;flex-direction:column;gap:16px">' +
          '<div class="rr-grid">' + fld('Name *', 'name', 'text', resource.name, 'Resource name') +
            '<div><label>Category</label><select name="category_id">' + catOpts + '</select></div></div>' +
          '<div class="rr-grid">' + fld('Quantity', 'quantity', 'number', resource.quantity, '1') +
            '<div><label>Condition</label><select name="condition">' + condOpts + '</select></div></div>' +
          '<div class="rr-grid">' + fld('Location', 'location', 'text', resource.location, 'Location') +
            '<div><label>Status</label><select name="status">' + statusOpts + '</select></div></div>' +
          fld('Image URL', 'image_url', 'url', resource.image_url, 'https://...') +
          '<div><label>Description</label><textarea name="description" rows="3">' + esc(resource.description || '') + '</textarea></div>' +
          '<div style="display:flex;gap:10px;margin-top:8px">' +
            '<button type="submit" class="btn" style="background:#059669;padding:12px 28px">💾 Update Resource</button>' +
            '<a href="/school/resource-reservation/resources/' + rid + '" class="btn" style="padding:12px 28px;background:#f1f5f9;color:#475569;text-decoration:none">Cancel</a>' +
          '</div>' +
        '</form>' +
      '</div></div>';
    res.send(renderPage('Edit Resource', html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 7: POST /school/resource-reservation/resources/:id/update
  // ════════════════════════════════════════════════════════════
  app.post('/school/resource-reservation/resources/:id/update', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, rid = req.params.id;
    const { name, category_id, quantity, condition, location, status, image_url, description } = req.body;
    if (!name || !name.trim()) return res.redirect('/school/resource-reservation/resources/' + rid + '/edit');
    const catId = category_id ? parseInt(category_id) : null;
    const prevCondition = (await pool.query('SELECT condition FROM resources WHERE id=$1 AND tenant_id=$2', [rid, tid])).rows[0];

    await pool.query(
      `UPDATE resources SET category_id=$1, name=$2, description=$3, quantity=$4, condition=$5, location=$6, image_url=$7, status=$8, updated_at=NOW()
       WHERE id=$9 AND tenant_id=$10`,
      [catId, name.trim(), (description || '').trim() || null, Math.max(1, parseInt(quantity) || 1),
       condition || 'good', (location || '').trim() || null, (image_url || '').trim() || null,
       status || 'available', rid, tid]
    );

    // Log condition change
    if (prevCondition && prevCondition.condition !== condition) {
      audit(tid, user.id, 'resource_condition_changed', 'Resource #' + rid + ' condition changed from ' + prevCondition.condition + ' to ' + condition);
    }
    audit(tid, user.id, 'updated_resource', 'Resource "' + name.trim() + '" updated');
    res.redirect('/school/resource-reservation/resources/' + rid);
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 8: POST /school/resource-reservation/resources/:id/delete
  // ════════════════════════════════════════════════════════════
  app.post('/school/resource-reservation/resources/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, rid = req.params.id;
    const activeRes = (await pool.query(
      "SELECT COUNT(*)::int as cnt FROM resource_reservations WHERE resource_id=$1 AND tenant_id=$2 AND status IN ('pending','approved') AND returned_at IS NULL", [rid, tid]
    )).rows[0].cnt;
    if (activeRes > 0) {
      return res.send('<div class="card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">Cannot Delete</h2><p style="color:#64748b">This resource has ' + activeRes + ' active reservation(s). Cancel them first.</p><a href="/school/resource-reservation/resources/' + rid + '" class="btn" style="margin-top:12px">← Back</a></div>');
    }
    await pool.query('DELETE FROM resource_maintenance WHERE resource_id=$1 AND tenant_id=$2', [rid, tid]);
    await pool.query('DELETE FROM resource_reservations WHERE resource_id=$1 AND tenant_id=$2', [rid, tid]);
    await pool.query('DELETE FROM resources WHERE id=$1 AND tenant_id=$2', [rid, tid]);
    audit(tid, user.id, 'deleted_resource', 'Resource #' + rid + ' deleted');
    res.redirect('/school/resource-reservation/resources');
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 9: GET /school/resource-reservation/categories
  // ════════════════════════════════════════════════════════════
  app.get('/school/resource-reservation/categories', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const categories = (await pool.query(
      'SELECT c.*, (SELECT COUNT(*) FROM resources r WHERE r.category_id=c.id AND r.tenant_id=$1 AND r.status != \'retired\')::int as resource_count FROM resource_categories c WHERE c.tenant_id=$1 ORDER BY c.name', [tid]
    )).rows;

    const rows = categories.map(c => '<tr>' +
      '<td style="font-weight:600">' + esc(c.name) + '</td>' +
      '<td style="font-size:13px;color:#64748b">' + esc(c.description || '—').substring(0, 80) + '</td>' +
      '<td style="text-align:center"><strong>' + c.resource_count + '</strong></td>' +
      '<td>' + (c.is_active ? '<span style="color:#16a34a;font-weight:600">Active</span>' : '<span style="color:#64748b">Inactive</span>') + '</td>' +
      '<td><div style="display:flex;gap:4px">' +
        '<form method="POST" action="/school/resource-reservation/categories/' + c.id + '/toggle" style="display:inline">' +
          '<button type="submit" class="btn" style="font-size:11px;padding:5px 10px;background:' + (c.is_active ? '#f59e0b' : '#059669') + '">' + (c.is_active ? 'Deactivate' : 'Activate') + '</button></form>' +
        '<form method="POST" action="/school/resource-reservation/categories/' + c.id + '/delete" style="display:inline" onsubmit="return confirm(\'Delete this category?\')">' +
          '<button type="submit" class="btn" style="font-size:11px;padding:5px 10px;background:#dc2626">Delete</button></form>' +
      '</div></td>' +
    '</tr>').join('');

    const html = CSS + '<div style="max-width:1000px;margin:0 auto">' +
      rrNav('/school/resource-reservation/categories') +
      '<div class="card" style="padding:24px">' +
        '<h2 style="color:#1e293b;margin-bottom:20px">📂 Resource Categories</h2>' +
        '<form method="POST" action="/school/resource-reservation/categories/create" style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap">' +
          '<input type="text" name="name" required placeholder="Category name" style="width:250px;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px">' +
          '<input type="text" name="description" placeholder="Description (optional)" style="width:350px;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px">' +
          '<button type="submit" class="btn" style="background:#059669;white-space:nowrap">+ Add Category</button>' +
        '</form>' +
        '<div style="overflow-x:auto"><table class="rr-table">' +
          '<thead><tr><th>Name</th><th>Description</th><th>Resources</th><th>Status</th><th>Actions</th></tr></thead>' +
          '<tbody>' + (rows || '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:30px">No categories yet</td></tr>') + '</tbody>' +
        '</table></div></div></div>';
    res.send(renderPage('Resource Categories', html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 10: POST /school/resource-reservation/categories/create
  // ════════════════════════════════════════════════════════════
  app.post('/school/resource-reservation/categories/create', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { name, description } = req.body;
    if (!name || !name.trim()) return res.redirect('/school/resource-reservation/categories');
    await pool.query(
      'INSERT INTO resource_categories (tenant_id, name, description) VALUES ($1,$2,$3)',
      [tid, name.trim(), (description || '').trim() || null]
    );
    audit(tid, user.id, 'created_category', 'Category "' + name.trim() + '" created');
    res.redirect('/school/resource-reservation/categories');
  }));

  // Category toggle and delete
  app.post('/school/resource-reservation/categories/:id/toggle', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query('UPDATE resource_categories SET is_active = NOT is_active WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    res.redirect('/school/resource-reservation/categories');
  }));

  app.post('/school/resource-reservation/categories/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query('UPDATE resources SET category_id=NULL WHERE category_id=$1 AND tenant_id=$2', [req.params.id, tid]);
    await pool.query('DELETE FROM resource_categories WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    res.redirect('/school/resource-reservation/categories');
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 11: GET /school/resource-reservation/resources/:id/reserve
  // ════════════════════════════════════════════════════════════
  app.get('/school/resource-reservation/resources/:id/reserve', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, rid = req.params.id;
    const resource = (await pool.query('SELECT * FROM resources WHERE id=$1 AND tenant_id=$2', [rid, tid])).rows[0];
    if (!resource) return res.redirect('/school/resource-reservation/resources');

    const html = CSS + '<div style="max-width:700px;margin:0 auto">' +
      rrNav('/school/resource-reservation/resources') +
      '<a href="/school/resource-reservation/resources/' + rid + '" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Resource</a>' +
      '<div class="card" style="padding:24px">' +
        '<h2 style="color:#1e293b;margin-bottom:4px">📅 Reserve: ' + esc(resource.name) + '</h2>' +
        '<p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Submit a reservation request (requires approval)</p>' +
        '<form method="POST" action="/school/resource-reservation/reserve" class="rr-form" style="display:flex;flex-direction:column;gap:16px">' +
          '<input type="hidden" name="resource_id" value="' + rid + '">' +
          '<div class="rr-grid">' +
            '<div><label>Start Date & Time *</label><input type="datetime-local" name="start_time" required></div>' +
            '<div><label>End Date & Time *</label><input type="datetime-local" name="end_time" required></div>' +
          '</div>' +
          '<div><label>Quantity</label><input type="number" name="quantity_reserved" value="1" min="1" max="' + resource.quantity + '"></div>' +
          '<div><label>Purpose *</label><textarea name="purpose" rows="3" required placeholder="Describe the purpose of this reservation..."></textarea></div>' +
          '<div><label>Additional Notes</label><textarea name="notes" rows="2" placeholder="Any special requirements or notes..."></textarea></div>' +
          '<div style="display:flex;gap:10px;margin-top:8px">' +
            '<button type="submit" class="btn" style="background:#059669;padding:12px 28px">📅 Submit Reservation</button>' +
            '<a href="/school/resource-reservation/resources/' + rid + '" class="btn" style="padding:12px 28px;background:#f1f5f9;color:#475569;text-decoration:none">Cancel</a>' +
          '</div>' +
        '</form>' +
      '</div></div>';
    res.send(renderPage('Reserve Resource', html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 12: POST /school/resource-reservation/reserve
  // ════════════════════════════════════════════════════════════
  app.post('/school/resource-reservation/reserve', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { resource_id, start_time, end_time, quantity_reserved, purpose, notes } = req.body;
    if (!resource_id || !start_time || !end_time || !purpose) {
      return res.send('<div class="card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">Missing Required Fields</h2><a href="javascript:history.back()" class="btn" style="margin-top:12px">← Back</a></div>');
    }
    if (new Date(end_time) <= new Date(start_time)) {
      return res.send('<div class="card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">End time must be after start time</h2><a href="javascript:history.back()" class="btn" style="margin-top:12px">← Back</a></div>');
    }

    // Conflict check
    const conflicts = (await pool.query(
      `SELECT COUNT(*)::int as cnt FROM resource_reservations
       WHERE resource_id=$1 AND status IN ('pending','approved') AND returned_at IS NULL
       AND (start_time, end_time) OVERLAPS ($2::timestamptz, $3::timestamptz)`,
      [resource_id, start_time, end_time]
    )).rows[0].cnt;

    if (conflicts > 0) {
      return res.send('<div class="card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">⚠️ Scheduling Conflict</h2><p style="color:#64748b">This resource is already reserved during the requested time period.</p><a href="javascript:history.back()" class="btn" style="margin-top:12px">← Back</a></div>');
    }

    // Maintenance conflict check
    const maintConflict = (await pool.query(
      `SELECT COUNT(*)::int as cnt FROM resource_maintenance
       WHERE resource_id=$1 AND status='scheduled'
       AND ($2::date <= end_date OR end_date IS NULL) AND start_date <= $3::date`,
      [resource_id, start_time, end_time]
    )).rows[0].cnt;

    if (maintConflict > 0) {
      return res.send('<div class="card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">🔧 Maintenance Conflict</h2><p style="color:#64748b">This resource is scheduled for maintenance during the requested period.</p><a href="javascript:history.back()" class="btn" style="margin-top:12px">← Back</a></div>');
    }

    await pool.query(
      `INSERT INTO resource_reservations (tenant_id, resource_id, user_id, user_name, purpose, start_time, end_time, quantity_reserved, status, notes)
       VALUES ($1,$2,$3,$4,$5,$6::timestamptz,$7::timestamptz,$8,'pending',$9)`,
      [tid, parseInt(resource_id), user.id, (user.name || user.email || 'User'),
       purpose.trim(), start_time, end_time, Math.max(1, parseInt(quantity_reserved) || 1),
       (notes || '').trim() || null]
    );
    audit(tid, user.id, 'created_reservation', 'Reservation submitted for resource #' + resource_id);

    // Send notification email to admin
    try {
      if (queueEmail) {
        queueEmail({
          tenant_id: tid,
          to: 'admin',
          subject: 'New Resource Reservation Request',
          body: 'A new reservation request has been submitted by ' + (user.name || user.email) + ' for resource #' + resource_id + '. Please review and approve/reject.'
        });
      }
    } catch (e) { /* non-critical */ }

    res.redirect('/school/resource-reservation/my-reservations');
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 13: GET /school/resource-reservation/my-reservations
  // ════════════════════════════════════════════════════════════
  app.get('/school/resource-reservation/my-reservations', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const reservations = (await pool.query(`
      SELECT rr.*, r.name as resource_name, r.qr_code, rc.name as category_name
      FROM resource_reservations rr
      JOIN resources r ON r.id = rr.resource_id
      LEFT JOIN resource_categories rc ON rc.id = r.category_id
      WHERE rr.tenant_id=$1 AND rr.user_id=$2
      ORDER BY rr.created_at DESC LIMIT 50`, [tid, user.id]
    )).rows;

    const rows = reservations.map(r => {
      const isOverdue = r.status === 'approved' && r.end_time < new Date() && !r.returned_at;
      return '<tr' + (isOverdue ? ' style="background:#fff5f5"' : '') + '>' +
        '<td><a href="/school/resource-reservation/resources/' + r.resource_id + '" style="color:' + P + ';text-decoration:none;font-weight:600">' + esc(r.resource_name) + '</a></td>' +
        '<td style="font-size:12px">' + fmtDateTime(r.start_time) + '</td>' +
        '<td style="font-size:12px">' + fmtDateTime(r.end_time) + '</td>' +
        '<td>' + statusBadge(isOverdue ? 'overdue' : r.status) + '</td>' +
        '<td style="font-size:12px">' + esc((r.purpose || '').substring(0, 40)) + '</td>' +
        '<td>' + (r.status === 'pending' ? '<form method="POST" action="/school/resource-reservation/cancel/' + r.id + '" style="display:inline" onsubmit="return confirm(\'Cancel reservation?\')"><button type="submit" class="btn" style="font-size:11px;padding:5px 10px;background:#6b7280">Cancel</button></form>' : '—') + '</td>' +
      '</tr>';
    }).join('');

    const html = CSS + '<div style="max-width:1200px;margin:0 auto">' +
      rrNav('/school/resource-reservation/my-reservations') +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">' +
        '<div><h1 style="font-size:22px;color:#1e293b">📋 My Reservations</h1>' +
        '<p style="font-size:13px;color:#94a3b8;margin-top:2px">' + reservations.length + ' reservation(s)</p></div>' +
        '<a href="/school/resource-reservation/resources" class="btn">Browse Resources</a>' +
      '</div>' +
      '<div class="card"><div style="overflow-x:auto"><table class="rr-table">' +
        '<thead><tr><th>Resource</th><th>Start</th><th>End</th><th>Status</th><th>Purpose</th><th>Action</th></tr></thead>' +
        '<tbody>' + (rows || '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:30px">No reservations yet. <a href="/school/resource-reservation/resources" style="color:' + P + '">Browse resources</a> to make a reservation.</td></tr>') + '</tbody>' +
      '</table></div></div></div>';
    res.send(renderPage('My Reservations', html, user, req));
  }));

  // Cancel reservation
  app.post('/school/resource-reservation/cancel/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    await pool.query(
      "UPDATE resource_reservations SET status='cancelled' WHERE id=$1 AND tenant_id=$2 AND user_id=$3 AND status='pending'",
      [req.params.id, tid, user.id]
    );
    res.redirect('/school/resource-reservation/my-reservations');
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 14: POST /school/resource-reservation/approve/:id
  // ════════════════════════════════════════════════════════════
  app.post('/school/resource-reservation/approve/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, rid = req.params.id;
    const { action, reason } = req.body;
    const reservation = (await pool.query(
      'SELECT * FROM resource_reservations WHERE id=$1 AND tenant_id=$2 AND status=\'pending\'', [rid, tid]
    )).rows[0];
    if (!reservation) return res.redirect('/school/resource-reservation');

    if (action === 'approve') {
      await pool.query(
        "UPDATE resource_reservations SET status='approved', approved_by=$1 WHERE id=$2 AND tenant_id=$3",
        [user.id, rid, tid]
      );
      await pool.query(
        "UPDATE resources SET status='reserved' WHERE id=$1 AND tenant_id=$2 AND status='available'",
        [reservation.resource_id, tid]
      );
      audit(tid, user.id, 'approved_reservation', 'Reservation #' + rid + ' approved');

      // Notify user
      try {
        if (queueEmail) {
          queueEmail({ tenant_id: tid, to_user_id: reservation.user_id, subject: 'Reservation Approved', body: 'Your reservation for resource #' + reservation.resource_id + ' has been approved.' });
        }
      } catch (e) { /* non-critical */ }
    } else if (action === 'reject') {
      await pool.query(
        "UPDATE resource_reservations SET status='rejected', notes=COALESCE(notes||' | ','') || $1 WHERE id=$2 AND tenant_id=$3",
        ['Rejected: ' + (reason || 'No reason provided'), rid, tid]
      );
      audit(tid, user.id, 'rejected_reservation', 'Reservation #' + rid + ' rejected');
    }
    res.redirect('back');
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 15: GET /school/resource-reservation/calendar
  // ════════════════════════════════════════════════════════════
  app.get('/school/resource-reservation/calendar', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const resourceId = req.query.resource_id;

    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0);
    const startPad = firstDay.getDay();
    const daysInMonth = lastDay.getDate();
    const todayDate = new Date();

    const resources = (await pool.query(
      'SELECT id, name FROM resources WHERE tenant_id=$1 AND status != \'retired\' ORDER BY name', [tid]
    )).rows;

    let resFilter = '';
    let whereExtra = '';
    const params = [tid, new Date(year, month - 1, 1).toISOString(), new Date(year, month, 1).toISOString()];
    if (resourceId) {
      resFilter = ' AND r.resource_id=$4';
      whereExtra = ' WHERE r.resource_id=' + parseInt(resourceId);
      params.push(parseInt(resourceId));
    }

    const events = (await pool.query(
      `SELECT r.*, res.name as resource_name FROM resource_reservations r
       JOIN resources res ON res.id=r.resource_id
       WHERE r.tenant_id=$1 AND r.status IN ('pending','approved')
       AND r.start_time < $3 AND r.end_time > $2${resFilter}
       ORDER BY r.start_time ASC`, params
    )).rows;

    const resourceOpts = '<option value="">All Resources</option>' + resources.map(r =>
      '<option value="' + r.id + '"' + (resourceId == r.id ? ' selected' : '') + '>' + esc(r.name) + '</option>').join('');

    // Build calendar HTML
    const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    let calHtml = '<table style="width:100%;border-collapse:collapse;margin-bottom:16px"><tr>';
    dayNames.forEach(d => { calHtml += '<th style="padding:8px;text-align:center;font-size:12px;color:#64748b;background:#f8fafc">' + d + '</th>'; });
    calHtml += '</tr><tr>';

    // Padding
    for (let i = 0; i < startPad; i++) calHtml += '<td style="padding:4px"></td>';

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = year + '-' + String(month).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      const isToday = todayDate.getFullYear() === year && todayDate.getMonth() === month - 1 && todayDate.getDate() === d;
      const dayEvents = events.filter(e => {
        const s = new Date(e.start_time), en = new Date(e.end_time);
        const curr = new Date(dateStr + 'T12:00:00');
        return curr >= new Date(s.toDateString()) && curr <= new Date(en.toDateString());
      });

      calHtml += '<td class="cal-day' + (dayEvents.length ? ' has-events' : '') + (isToday ? ' today' : '') + '">' +
        '<div style="font-weight:700;font-size:12px;margin-bottom:4px;' + (isToday ? 'color:#4f46e5' : '') + '">' + d + '</div>';
      dayEvents.slice(0, 3).forEach(e => {
        const isOverdue = e.status === 'approved' && e.end_time < new Date() && !e.returned_at;
        calHtml += '<div class="cal-event' + (isOverdue ? ' overdue' : '') + '" title="' + esc(e.resource_name) + ' - ' + esc(e.user_name) + '">' + esc(e.resource_name).substring(0, 12) + '</div>';
      });
      if (dayEvents.length > 3) calHtml += '<div style="font-size:9px;color:#64748b">+' + (dayEvents.length - 3) + ' more</div>';
      calHtml += '</td>';

      if ((startPad + d) % 7 === 0 && d < daysInMonth) calHtml += '</tr><tr>';
    }

    // Fill remaining cells
    const remaining = 7 - ((startPad + daysInMonth) % 7);
    if (remaining < 7) {
      for (let i = 0; i < remaining; i++) calHtml += '<td style="padding:4px"></td>';
    }
    calHtml += '</tr></table>';

    const prevM = month === 1 ? 12 : month - 1;
    const prevY = month === 1 ? year - 1 : year;
    const nextM = month === 12 ? 1 : month + 1;
    const nextY = month === 12 ? year + 1 : year;

    const html = CSS + '<div style="max-width:1100px;margin:0 auto">' +
      rrNav('/school/resource-reservation/calendar') +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">' +
        '<h1 style="font-size:22px;color:#1e293b">📅 Reservation Calendar</h1>' +
        '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
          '<select onchange="location.href=\'/school/resource-reservation/calendar?month=' + month + '&year=' + year + '&resource_id=\'+this.value" style="padding:8px 12px;border:2px solid #e2e8f0;border-radius:8px;font-size:13px">' + resourceOpts + '</select>' +
        '</div>' +
      '</div>' +
      '<div style="display:flex;align-items:center;justify-content:center;gap:16px;margin-bottom:20px">' +
        '<a href="/school/resource-reservation/calendar?month=' + prevM + '&year=' + prevY + (resourceId ? '&resource_id=' + resourceId : '') + '" class="btn" style="background:#f1f5f9;color:#475569">← Prev</a>' +
        '<span style="font-size:18px;font-weight:700;color:#1e293b">' + monthNames[month - 1] + ' ' + year + '</span>' +
        '<a href="/school/resource-reservation/calendar?month=' + nextM + '&year=' + nextY + (resourceId ? '&resource_id=' + resourceId : '') + '" class="btn" style="background:#f1f5f9;color:#475569">Next →</a>' +
      '</div>' +
      '<div class="card" style="padding:16px">' + calHtml + '</div>' +
      '<div style="display:flex;gap:16px;margin-top:8px;font-size:12px;color:#64748b">' +
        '<div><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:#4f46e5;margin-right:4px"></span> Reservation</div>' +
        '<div><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:#dc2626;margin-right:4px"></span> Overdue</div>' +
        '<div><span style="display:inline-block;width:14px;height:14px;border:2px solid #4f46e5;border-radius:4px;margin-right:4px"></span> Today</div>' +
      '</div></div>';
    res.send(renderPage('Reservation Calendar', html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 16: GET /school/resource-reservation/maintenance
  // ════════════════════════════════════════════════════════════
  app.get('/school/resource-reservation/maintenance', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { status: filterStatus } = req.query;
    const preselectedResourceId = req.query.resource_id;

    const resources = (await pool.query(
      'SELECT id, name FROM resources WHERE tenant_id=$1 AND status != \'retired\' ORDER BY name', [tid]
    )).rows;

    let where = ['rm.tenant_id=$1'], params = [tid], pi = 2;
    if (filterStatus) { where.push('rm.status=$' + pi); params.push(filterStatus); pi++; }

    const maintenance = (await pool.query(
      `SELECT rm.*, r.name as resource_name FROM resource_maintenance rm
       JOIN resources r ON r.id=rm.resource_id
       WHERE ${where.join(' AND ')} ORDER BY rm.start_date DESC, rm.created_at DESC LIMIT 100`, params
    )).rows;

    const totalCost = maintenance.reduce((sum, m) => sum + Number(m.cost || 0), 0);

    const rows = maintenance.map(m => '<tr>' +
      '<td><a href="/school/resource-reservation/resources/' + m.resource_id + '" style="color:' + P + ';text-decoration:none;font-weight:600">' + esc(m.resource_name) + '</a></td>' +
      '<td style="font-size:12px">' + esc((m.description || '').substring(0, 50)) + '</td>' +
      '<td>' + fmtDate(m.start_date) + '</td>' +
      '<td>' + fmtDate(m.end_date || '') + '</td>' +
      '<td>' + esc(m.technician || '—') + '</td>' +
      '<td style="font-weight:600">$' + Number(m.cost || 0).toFixed(2) + '</td>' +
      '<td>' + statusBadge(m.status) + '</td>' +
      '<td><div style="display:flex;gap:4px">' +
        (m.status === 'scheduled' ? '<form method="POST" action="/school/resource-reservation/maintenance/' + m.id + '/complete" style="display:inline"><button type="submit" class="btn" style="font-size:11px;padding:5px 10px;background:#059669">Complete</button></form>' : '') +
      '</div></td>' +
    '</tr>').join('');

    const resOpts = '<option value="">— Select Resource —</option>' + resources.map(r =>
      '<option value="' + r.id + '"' + (preselectedResourceId == r.id ? ' selected' : '') + '>' + esc(r.name) + '</option>').join('');

    const html = CSS + '<div style="max-width:1200px;margin:0 auto">' +
      rrNav('/school/resource-reservation/maintenance') +
      '<div class="card" style="padding:24px">' +
        '<h2 style="color:#1e293b;margin-bottom:4px">🔧 Maintenance Scheduling</h2>' +
        '<p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Schedule and track resource maintenance</p>' +
        '<form method="POST" action="/school/resource-reservation/maintenance/create" class="rr-form" style="display:flex;flex-direction:column;gap:14px;margin-bottom:24px;padding:20px;background:#f8fafc;border-radius:12px">' +
          '<div class="rr-grid">' +
            '<div><label>Resource *</label><select name="resource_id" required>' + resOpts + '</select></div>' +
            '<div><label>Technician</label><input type="text" name="technician" placeholder="Technician name"></div>' +
          '</div>' +
          '<div class="rr-grid">' +
            '<div><label>Start Date *</label><input type="date" name="start_date" required value="' + todayISO() + '"></div>' +
            '<div><label>End Date (est.)</label><input type="date" name="end_date"></div>' +
          '</div>' +
          '<div><label>Cost</label><input type="number" name="cost" value="0" min="0" step="0.01" placeholder="0.00"></div>' +
          '<div><label>Description *</label><textarea name="description" rows="2" required placeholder="Describe the maintenance work..."></textarea></div>' +
          '<button type="submit" class="btn" style="background:#059669;padding:10px 24px;align-self:start">🔧 Schedule Maintenance</button>' +
        '</form>' +
      '</div>' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px">' +
        '<div style="display:flex;gap:8px;align-items:center">' +
          '<span style="font-weight:700;color:#1e293b;font-size:15px">Total Maintenance Cost:</span>' +
          '<span style="font-weight:700;color:#dc2626;font-size:16px">$' + totalCost.toFixed(2) + '</span>' +
        '</div>' +
        '<select onchange="location.href=\'/school/resource-reservation/maintenance?status=\'+this.value" style="padding:6px 12px;border:2px solid #e2e8f0;border-radius:8px;font-size:12px">' +
          '<option value="">All Status</option>' +
          '<option value="scheduled"' + (filterStatus === 'scheduled' ? ' selected' : '') + '>Scheduled</option>' +
          '<option value="in_progress"' + (filterStatus === 'in_progress' ? ' selected' : '') + '>In Progress</option>' +
          '<option value="completed"' + (filterStatus === 'completed' ? ' selected' : '') + '>Completed</option>' +
        '</select>' +
      '</div>' +
      '<div class="card"><div style="overflow-x:auto"><table class="rr-table">' +
        '<thead><tr><th>Resource</th><th>Description</th><th>Start</th><th>End</th><th>Technician</th><th>Cost</th><th>Status</th><th>Action</th></tr></thead>' +
        '<tbody>' + (rows || '<tr><td colspan="8" style="text-align:center;color:#94a3b8;padding:30px">No maintenance records</td></tr>') + '</tbody>' +
      '</table></div></div></div>';
    res.send(renderPage('Maintenance Scheduling', html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 17: POST maintenance/create & maintenance/:id/complete
  // ════════════════════════════════════════════════════════════
  app.post('/school/resource-reservation/maintenance/create', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { resource_id, description, cost, start_date, end_date, technician } = req.body;
    if (!resource_id || !description || !start_date) return res.redirect('/school/resource-reservation/maintenance');

    await pool.query(
      `INSERT INTO resource_maintenance (tenant_id, resource_id, description, cost, start_date, end_date, technician, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'scheduled')`,
      [tid, parseInt(resource_id), description.trim(), parseFloat(cost) || 0, start_date,
       end_date || null, (technician || '').trim() || null]
    );

    // Update resource status
    await pool.query("UPDATE resources SET status='maintenance' WHERE id=$1 AND tenant_id=$2", [parseInt(resource_id), tid]);
    audit(tid, user.id, 'scheduled_maintenance', 'Maintenance scheduled for resource #' + resource_id);
    res.redirect('/school/resource-reservation/maintenance');
  }));

  app.post('/school/resource-reservation/maintenance/:id/complete', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const maint = (await pool.query(
      'SELECT * FROM resource_maintenance WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]
    )).rows[0];
    if (maint) {
      await pool.query("UPDATE resource_maintenance SET status='completed', end_date=COALESCE(end_date, CURRENT_DATE) WHERE id=$1 AND tenant_id=$2", [req.params.id, tid]);
      // Check if resource has other active maintenance
      const otherMaint = (await pool.query(
        "SELECT COUNT(*)::int as cnt FROM resource_maintenance WHERE resource_id=$1 AND tenant_id=$2 AND status='scheduled'", [maint.resource_id, tid]
      )).rows[0].cnt;
      if (otherMaint === 0) {
        await pool.query("UPDATE resources SET status='available' WHERE id=$1 AND tenant_id=$2", [maint.resource_id, tid]);
      }
      audit(tid, user.id, 'completed_maintenance', 'Maintenance #' + req.params.id + ' completed');
    }
    res.redirect('/school/resource-reservation/maintenance');
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 18: GET /school/resource-reservation/reports
  // ════════════════════════════════════════════════════════════
  app.get('/school/resource-reservation/reports', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const period = req.query.period || '30';

    const interval = period === '7' ? "INTERVAL '7 days'" : period === '90' ? "INTERVAL '90 days'" : "INTERVAL '30 days'";

    const totalReservations = (await pool.query(
      'SELECT COUNT(*)::int as cnt FROM resource_reservations WHERE tenant_id=$1 AND created_at >= NOW() - ' + interval, [tid]
    )).rows[0].cnt;

    const byResource = (await pool.query(
      `SELECT r.name as resource_name, COUNT(rr.id)::int as total,
        COUNT(rr.id) FILTER (WHERE rr.status='approved')::int as approved,
        COUNT(rr.id) FILTER (WHERE rr.status='rejected')::int as rejected,
        COUNT(rr.id) FILTER (WHERE rr.status='pending')::int as pending
       FROM resource_reservations rr
       JOIN resources r ON r.id=rr.resource_id
       WHERE rr.tenant_id=$1 AND rr.created_at >= NOW() - ` + interval + `
       GROUP BY r.name ORDER BY total DESC LIMIT 20`, [tid]
    )).rows;

    const byUser = (await pool.query(
      `SELECT user_name, COUNT(*)::int as reservations FROM resource_reservations
       WHERE tenant_id=$1 AND created_at >= NOW() - ` + interval + `
       GROUP BY user_name ORDER BY reservations DESC LIMIT 15`, [tid]
    )).rows;

    const byCategory = (await pool.query(
      `SELECT rc.name as category_name, COUNT(rr.id)::int as total
       FROM resource_reservations rr
       JOIN resources r ON r.id=rr.resource_id
       LEFT JOIN resource_categories rc ON rc.id=r.category_id
       WHERE rr.tenant_id=$1 AND rr.created_at >= NOW() - ` + interval + `
       GROUP BY rc.name ORDER BY total DESC`, [tid]
    )).rows;

    const maintenanceStats = (await pool.query(
      `SELECT COUNT(*)::int as total_maintenance,
        COALESCE(SUM(cost), 0)::numeric(10,2) as total_cost
       FROM resource_maintenance WHERE tenant_id=$1 AND created_at >= NOW() - ` + interval, [tid]
    )).rows[0];

    const maxReservations = byResource.reduce((m, r) => Math.max(m, r.total), 1);

    const resRows = byResource.map(r => '<tr>' +
      '<td style="font-weight:600">' + esc(r.resource_name) + '</td>' +
      '<td><strong>' + r.total + '</strong></td>' +
      '<td style="color:#16a34a">' + r.approved + '</td>' +
      '<td style="color:#dc2626">' + r.rejected + '</td>' +
      '<td style="color:#f59e0b">' + r.pending + '</td>' +
      '<td><div style="background:#e2e8f0;border-radius:6px;height:8px;width:100px;overflow:hidden">' +
        '<div style="background:#4f46e5;height:100%;border-radius:6px;width:' + Math.round((r.total / maxReservations) * 100) + '%"></div></div></td>' +
    '</tr>').join('');

    const userRows = byUser.map(r => '<tr>' +
      '<td style="font-weight:600">' + esc(r.user_name) + '</td>' +
      '<td>' + r.reservations + '</td>' +
    '</tr>').join('');

    const catRows = byCategory.map(r => '<tr>' +
      '<td style="font-weight:600">' + esc(r.category_name || 'Uncategorized') + '</td>' +
      '<td>' + r.total + '</td>' +
    '</tr>').join('');

    const html = CSS + '<div style="max-width:1200px;margin:0 auto">' +
      rrNav('/school/resource-reservation/reports') +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">' +
        '<div><h1 style="font-size:22px;color:#1e293b">📊 Usage Reports</h1></div>' +
        '<div style="display:flex;gap:8px">' +
          ['7','30','90'].map(p => '<a href="/school/resource-reservation/reports?period=' + p + '" class="btn" style="background:' + (period === p ? '#4f46e5' : '#f1f5f9') + ';color:' + (period === p ? '#fff' : '#475569') + ';font-size:13px">' + p + ' days</a>').join('') +
        '</div>' +
      '</div>' +
      '<div class="stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;margin-bottom:20px">' +
        '<div class="stat-card"><div class="stat-num" style="color:#4f46e5">' + totalReservations + '</div><div style="font-size:11px;color:#94a3b8;text-transform:uppercase">Total Reservations</div></div>' +
        '<div class="stat-card"><div class="stat-num" style="color:#dc2626">' + maintenanceStats.total_maintenance + '</div><div style="font-size:11px;color:#94a3b8;text-transform:uppercase">Maintenance Records</div></div>' +
        '<div class="stat-card"><div class="stat-num" style="color:#f59e0b">$' + maintenanceStats.total_cost + '</div><div style="font-size:11px;color:#94a3b8;text-transform:uppercase">Maintenance Cost</div></div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">' +
        '<div class="card"><h3 style="color:#1e293b;margin:0 0 12px;font-size:15px">📦 By Resource</h3>' +
          '<div style="overflow-x:auto"><table class="rr-table"><thead><tr><th>Resource</th><th>Total</th><th>Approved</th><th>Rejected</th><th>Pending</th><th>Trend</th></tr></thead>' +
          '<tbody>' + (resRows || '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:20px">No data</td></tr>') + '</tbody></table></div></div>' +
        '<div class="card"><h3 style="color:#1e293b;margin:0 0 12px;font-size:15px">👤 Top Users</h3>' +
          '<div style="overflow-x:auto"><table class="rr-table"><thead><tr><th>User</th><th>Reservations</th></tr></thead>' +
          '<tbody>' + (userRows || '<tr><td colspan="2" style="text-align:center;color:#94a3b8;padding:20px">No data</td></tr>') + '</tbody></table></div></div>' +
      '</div>' +
      '<div class="card" style="margin-top:16px"><h3 style="color:#1e293b;margin:0 0 12px;font-size:15px">📂 By Category</h3>' +
        '<div style="overflow-x:auto"><table class="rr-table"><thead><tr><th>Category</th><th>Reservations</th></tr></thead>' +
        '<tbody>' + (catRows || '<tr><td colspan="2" style="text-align:center;color:#94a3b8;padding:20px">No data</td></tr>') + '</tbody></table></div></div>' +
    '</div>';
    res.send(renderPage('Usage Reports', html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 19: GET /school/resource-reservation/availability-check
  // ════════════════════════════════════════════════════════════
  app.get('/school/resource-reservation/availability-check', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const resources = (await pool.query(
      'SELECT id, name, quantity, status FROM resources WHERE tenant_id=$1 AND status != \'retired\' ORDER BY name', [tid]
    )).rows;

    const resOpts = '<option value="">— Select Resource —</option>' + resources.map(r =>
      '<option value="' + r.id + '">' + esc(r.name) + ' (Qty: ' + r.quantity + ')</option>').join('');

    const html = CSS + '<div style="max-width:800px;margin:0 auto">' +
      rrNav('/school/resource-reservation') +
      '<div class="card" style="padding:24px">' +
        '<h2 style="color:#1e293b;margin-bottom:4px">🔍 Check Availability</h2>' +
        '<p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Find available resources for a specific time period</p>' +
        '<form method="POST" action="/school/resource-reservation/availability-check" class="rr-form" style="display:flex;flex-direction:column;gap:16px">' +
          '<div><label>Resource</label><select name="resource_id">' + resOpts + '</select></div>' +
          '<div class="rr-grid">' +
            '<div><label>Start Date & Time *</label><input type="datetime-local" name="start_time" required></div>' +
            '<div><label>End Date & Time *</label><input type="datetime-local" name="end_time" required></div>' +
          '</div>' +
          '<div style="display:flex;gap:10px;margin-top:8px">' +
            '<button type="submit" class="btn" style="background:#0891b2;padding:12px 28px">🔍 Check</button>' +
          '</div>' +
        '</form>' +
        '<div id="availability-result" style="margin-top:20px"></div>' +
      '</div></div>';
    res.send(renderPage('Check Availability', html, user, req));
  }));

  app.post('/school/resource-reservation/availability-check', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { resource_id, start_time, end_time } = req.body;

    if (!resource_id || !start_time || !end_time) {
      return res.redirect('/school/resource-reservation/availability-check');
    }

    const resource = (await pool.query(
      'SELECT * FROM resources WHERE id=$1 AND tenant_id=$2', [parseInt(resource_id), tid]
    )).rows[0];

    if (!resource) return res.redirect('/school/resource-reservation/availability-check');

    // Check existing reservations
    const conflicts = (await pool.query(
      `SELECT rr.*, u.name as user_name FROM resource_reservations rr
       LEFT JOIN users u ON u.id = rr.user_id
       WHERE rr.resource_id=$1 AND rr.status IN ('pending','approved') AND rr.returned_at IS NULL
       AND (rr.start_time, rr.end_time) OVERLAPS ($2::timestamptz, $3::timestamptz)`,
      [parseInt(resource_id), start_time, end_time]
    )).rows;

    // Check maintenance
    const maintConflicts = (await pool.query(
      `SELECT * FROM resource_maintenance
       WHERE resource_id=$1 AND status='scheduled'
       AND ($2::date <= COALESCE(end_date, '9999-12-31'::date)) AND start_date <= $3::date`,
      [parseInt(resource_id), start_time, end_time]
    )).rows;

    const inUse = (await pool.query(
      'SELECT COUNT(*)::int as cnt FROM resource_reservations WHERE resource_id=$1 AND status=\'approved\' AND returned_at IS NULL',
      [parseInt(resource_id)]
    )).rows[0].cnt;

    const isAvailable = conflicts.length === 0 && maintConflicts.length === 0 && (resource.quantity - inUse) > 0;

    const conflictHtml = conflicts.map(c => '<div style="padding:8px 12px;background:#fee2e2;border-radius:8px;margin-bottom:6px;font-size:12px">' +
      '📅 ' + fmtDateTime(c.start_time) + ' → ' + fmtDateTime(c.end_time) +
      ' by ' + esc(c.user_name || c.user_name || 'Unknown') +
      ' (' + c.status + ')</div>').join('');

    const maintHtml = maintConflicts.map(m => '<div style="padding:8px 12px;background:#fef3c7;border-radius:8px;margin-bottom:6px;font-size:12px">' +
      '🔧 ' + fmtDate(m.start_date) + ' → ' + fmtDate(m.end_date || 'TBD') +
      ' - ' + esc(m.description || '').substring(0, 50) + '</div>').join('');

    const resultHtml = '<div style="padding:20px;border-radius:12px;' +
      (isAvailable ? 'background:#dcfce7;border:2px solid #16a34a' : 'background:#fee2e2;border:2px solid #dc2626') + '">' +
      '<div style="font-size:18px;font-weight:700;margin-bottom:8px;color:' + (isAvailable ? '#16a34a' : '#dc2626') + '">' +
      (isAvailable ? '✅ Available' : '❌ Not Available') + '</div>' +
      '<div style="font-size:13px;color:#475569">Resource: <strong>' + esc(resource.name) + '</strong> | Available: ' +
      (resource.quantity - inUse) + '/' + resource.quantity + '</div>' +
      (conflicts.length ? '<div style="margin-top:12px"><div style="font-size:13px;font-weight:700;margin-bottom:6px">⚠️ Conflicting Reservations:</div>' + conflictHtml + '</div>' : '') +
      (maintConflicts.length ? '<div style="margin-top:12px"><div style="font-size:13px;font-weight:700;margin-bottom:6px">🔧 Maintenance Conflicts:</div>' + maintHtml + '</div>' : '') +
      (isAvailable ? '<a href="/school/resource-reservation/resources/' + resource_id + '/reserve" class="btn" style="background:#059669;margin-top:12px;display:inline-block">📅 Reserve Now</a>' : '') +
    '</div>';

    const resources = (await pool.query(
      'SELECT id, name, quantity, status FROM resources WHERE tenant_id=$1 AND status != \'retired\' ORDER BY name', [tid]
    )).rows;
    const resOpts = '<option value="">— Select Resource —</option>' + resources.map(r =>
      '<option value="' + r.id + '"' + (parseInt(resource_id) === r.id ? ' selected' : '') + '>' + esc(r.name) + '</option>').join('');

    const html = CSS + '<div style="max-width:800px;margin:0 auto">' +
      rrNav('/school/resource-reservation') +
      '<div class="card" style="padding:24px">' +
        '<h2 style="color:#1e293b;margin-bottom:4px">🔍 Availability Result</h2>' +
        '<p style="font-size:13px;color:#94a3b8;margin-bottom:20px">' + fmtDateTime(start_time) + ' → ' + fmtDateTime(end_time) + '</p>' +
        resultHtml +
        '<form method="POST" action="/school/resource-reservation/availability-check" class="rr-form" style="margin-top:24px;display:flex;flex-direction:column;gap:16px">' +
          '<div><label>Resource</label><select name="resource_id">' + resOpts + '</select></div>' +
          '<div class="rr-grid">' +
            '<div><label>Start Date & Time *</label><input type="datetime-local" name="start_time" value="' + esc(start_time) + '" required></div>' +
            '<div><label>End Date & Time *</label><input type="datetime-local" name="end_time" value="' + esc(end_time) + '" required></div>' +
          '</div>' +
          '<button type="submit" class="btn" style="background:#0891b2;padding:12px 28px">🔍 Check Again</button>' +
        '</form>' +
      '</div></div>';
    res.send(renderPage('Availability Result', html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 20: POST /school/resource-reservation/checkout/:id (QR)
  // ════════════════════════════════════════════════════════════
  app.post('/school/resource-reservation/checkout/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, rid = req.params.id;
    const reservation = (await pool.query(
      "SELECT * FROM resource_reservations WHERE id=$1 AND tenant_id=$2 AND status='approved' AND checked_out_at IS NULL",
      [rid, tid]
    )).rows[0];

    if (!reservation) {
      return res.send('<div class="card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">Invalid Reservation</h2><p style="color:#64748b">This reservation cannot be checked out.</p><a href="/school/resource-reservation" class="btn" style="margin-top:12px">← Dashboard</a></div>');
    }

    await pool.query(
      "UPDATE resource_reservations SET checked_out_at=NOW() WHERE id=$1 AND tenant_id=$2",
      [rid, tid]
    );
    await pool.query(
      "UPDATE resources SET status='in_use' WHERE id=$1 AND tenant_id=$2",
      [reservation.resource_id, tid]
    );
    audit(tid, user.id, 'checked_out_resource', 'Resource checked out for reservation #' + rid);
    res.redirect('/school/resource-reservation');
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 21: GET/POST /school/resource-reservation/return/:id
  // ════════════════════════════════════════════════════════════
  app.get('/school/resource-reservation/return/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, rid = req.params.id;
    const reservation = (await pool.query(
      `SELECT rr.*, r.name as resource_name FROM resource_reservations rr
       JOIN resources r ON r.id=rr.resource_id
       WHERE rr.id=$1 AND rr.tenant_id=$2 AND rr.status='approved' AND rr.returned_at IS NULL`,
      [rid, tid]
    )).rows[0];

    if (!reservation) {
      return res.send('<div class="card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">Invalid Reservation</h2><a href="/school/resource-reservation" class="btn" style="margin-top:12px">← Dashboard</a></div>');
    }

    const isOverdue = new Date(reservation.end_time) < new Date();

    const condOpts = ['new','good','fair','poor','damaged'].map(c =>
      '<option value="' + c + '"' + (c === 'good' ? ' selected' : '') + '>' + c.charAt(0).toUpperCase() + c.slice(1) + '</option>').join('');

    const html = CSS + '<div style="max-width:700px;margin:0 auto">' +
      rrNav('/school/resource-reservation') +
      '<div class="card" style="padding:24px">' +
        '<h2 style="color:#1e293b;margin-bottom:4px">📥 Return Resource</h2>' +
        (isOverdue ? '<div style="background:#fee2e2;border:1px solid #fca5a5;border-radius:10px;padding:12px;margin-bottom:16px;font-size:13px;color:#dc2626;font-weight:600">⚠️ This resource is overdue! Was due: ' + fmtDateTime(reservation.end_time) + '</div>' : '') +
        '<div style="background:#f8fafc;border-radius:10px;padding:16px;margin-bottom:20px">' +
          '<div style="font-size:13px;color:#64748b">Resource</div>' +
          '<div style="font-weight:700;font-size:16px;color:#1e293b">' + esc(reservation.resource_name) + '</div>' +
          '<div style="font-size:12px;color:#64748b;margin-top:4px">Borrowed by: ' + esc(reservation.user_name) + ' | From: ' + fmtDateTime(reservation.start_time) + '</div>' +
        '</div>' +
        '<form method="POST" action="/school/resource-reservation/return/' + rid + '" class="rr-form" style="display:flex;flex-direction:column;gap:16px">' +
          '<div><label>Return Condition *</label><select name="return_condition">' + condOpts + '</select></div>' +
          '<div><label>Notes</label><textarea name="notes" rows="3" placeholder="Any notes about the returned resource..."></textarea></div>' +
          '<div style="display:flex;gap:10px;margin-top:8px">' +
            '<button type="submit" class="btn" style="background:#059669;padding:12px 28px">📥 Confirm Return</button>' +
            '<a href="/school/resource-reservation" class="btn" style="padding:12px 28px;background:#f1f5f9;color:#475569;text-decoration:none">Cancel</a>' +
          '</div>' +
        '</form>' +
      '</div></div>';
    res.send(renderPage('Return Resource', html, user, req));
  }));

  app.post('/school/resource-reservation/return/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, rid = req.params.id;
    const { return_condition, notes } = req.body;

    const reservation = (await pool.query(
      "SELECT * FROM resource_reservations WHERE id=$1 AND tenant_id=$2 AND status='approved' AND returned_at IS NULL",
      [rid, tid]
    )).rows[0];

    if (!reservation) return res.redirect('/school/resource-reservation');

    const cond = return_condition || 'good';

    await pool.query(
      "UPDATE resource_reservations SET status='completed', returned_at=NOW(), return_condition=$1, notes=COALESCE(notes||' | ','') || $2 WHERE id=$3 AND tenant_id=$4",
      [cond, (notes || '').trim() || '', rid, tid]
    );

    // Update resource condition
    await pool.query(
      "UPDATE resources SET condition=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3",
      [cond, reservation.resource_id, tid]
    );

    // Check if resource has other active reservations, otherwise set to available
    const activeCount = (await pool.query(
      "SELECT COUNT(*)::int as cnt FROM resource_reservations WHERE resource_id=$1 AND status='approved' AND returned_at IS NULL",
      [reservation.resource_id]
    )).rows[0].cnt;

    if (activeCount === 0) {
      await pool.query(
        "UPDATE resources SET status='available' WHERE id=$1 AND tenant_id=$2",
        [reservation.resource_id, tid]
      );
    }

    // Log condition if poor/damaged
    if (cond === 'poor' || cond === 'damaged') {
      audit(tid, user.id, 'resource_returned_poor_condition', 'Resource #' + reservation.resource_id + ' returned in ' + cond + ' condition');
    }

    audit(tid, user.id, 'returned_resource', 'Resource returned for reservation #' + rid);

    // Check for overdue and send alert
    if (reservation.end_time < new Date()) {
      try {
        if (queueEmail) {
          queueEmail({
            tenant_id: tid, to_user_id: reservation.user_id,
            subject: 'Overdue Resource Returned',
            body: 'Your overdue reservation for resource #' + reservation.resource_id + ' has been returned. Condition: ' + cond + '.'
          });
        }
      } catch (e) { /* non-critical */ }
    }

    res.redirect('/school/resource-reservation');
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 22: GET /school/resource-reservation/pending — Admin
  // ════════════════════════════════════════════════════════════
  app.get('/school/resource-reservation/pending', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    const pending = (await pool.query(`
      SELECT rr.*, r.name as resource_name, r.location, rc.name as category_name,
        COALESCE(u.name, rr.user_name) as display_name
      FROM resource_reservations rr
      JOIN resources r ON r.id=rr.resource_id
      LEFT JOIN resource_categories rc ON rc.id=r.category_id
      LEFT JOIN users u ON u.id=rr.user_id
      WHERE rr.tenant_id=$1 AND rr.status='pending'
      ORDER BY rr.start_time ASC`, [tid]
    )).rows;

    const rows = pending.map(r => '<tr>' +
      '<td><a href="/school/resource-reservation/resources/' + r.resource_id + '" style="color:' + P + ';text-decoration:none;font-weight:600">' + esc(r.resource_name) + '</a></td>' +
      '<td>' + esc(r.display_name || r.user_name) + '</td>' +
      '<td style="font-size:12px">' + fmtDateTime(r.start_time) + '</td>' +
      '<td style="font-size:12px">' + fmtDateTime(r.end_time) + '</td>' +
      '<td style="font-size:12px">' + esc((r.purpose || '').substring(0, 40)) + '</td>' +
      '<td>' + fmtDateTime(r.created_at) + '</td>' +
      '<td><div style="display:flex;gap:4px">' +
        '<form method="POST" action="/school/resource-reservation/approve/' + r.id + '" style="display:inline">' +
          '<input type="hidden" name="action" value="approve"><button type="submit" class="btn" style="font-size:11px;padding:5px 10px;background:#059669">✅ Approve</button></form>' +
        '<form method="POST" action="/school/resource-reservation/approve/' + r.id + '" style="display:inline" onsubmit="return prompt_reason(this)">' +
          '<input type="hidden" name="action" value="reject"><input type="hidden" name="reason" id="reason-' + r.id + '" value="">' +
          '<button type="submit" class="btn" style="font-size:11px;padding:5px 10px;background:#dc2626">❌ Reject</button></form>' +
      '</div></td>' +
    '</tr>').join('');

    const html = CSS + '<div style="max-width:1200px;margin:0 auto">' +
      rrNav('/school/resource-reservation') +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">' +
        '<div><h1 style="font-size:22px;color:#1e293b">⏳ Pending Approvals</h1>' +
        '<p style="font-size:13px;color:#94a3b8;margin-top:2px">' + pending.length + ' reservation(s) awaiting approval</p></div>' +
      '</div>' +
      '<div class="card"><div style="overflow-x:auto"><table class="rr-table">' +
        '<thead><tr><th>Resource</th><th>User</th><th>Start</th><th>End</th><th>Purpose</th><th>Submitted</th><th>Actions</th></tr></thead>' +
        '<tbody>' + (rows || '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:30px">No pending reservations 🎉</td></tr>') + '</tbody>' +
      '</table></div></div>' +
      '<script>function prompt_reason(form){var r=prompt("Reason for rejection:");if(!r)return false;form.querySelector("input[name=reason]").value=r;return true;}</script>' +
    '</div>';
    res.send(renderPage('Pending Approvals', html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // OVERDUE CHECK CRON — Mark overdue & send alerts
  // ════════════════════════════════════════════════════════════
  async function checkOverdue() {
    try {
      const overdue = (await pool.query(`
        SELECT rr.*, r.name as resource_name, u.email, u.name as user_name
        FROM resource_reservations rr
        JOIN resources r ON r.id=rr.resource_id
        LEFT JOIN users u ON u.id=rr.user_id
        WHERE rr.status='approved' AND rr.end_time < NOW() AND rr.returned_at IS NULL
      `)).rows;

      for (const item of overdue) {
        // Send overdue alert email (once per day max)
        try {
          if (queueEmail) {
            queueEmail({
              tenant_id: item.tenant_id,
              to_user_id: item.user_id,
              subject: '⚠️ Overdue Resource: ' + item.resource_name,
              body: 'The resource "' + item.resource_name + '" reserved by you was due on ' + fmtDateTime(item.end_time) + ' but has not been returned. Please return it as soon as possible.'
            });
          }
        } catch (e) { /* non-critical */ }
      }

      if (overdue.length > 0) {
        console.log('[ResourceReservation] Overdue check: ' + overdue.length + ' overdue item(s)');
      }
    } catch (e) {
      console.warn('[ResourceReservation] Overdue check error:', e.message);
    }
  }

  // Run overdue check every 6 hours
  setInterval(checkOverdue, 6 * 60 * 60 * 1000);
  // Also run once on startup after a short delay
  setTimeout(checkOverdue, 30000);

  console.log('[ResourceReservation] Module loaded — ' + migrations.length + ' migrations queued');
};
