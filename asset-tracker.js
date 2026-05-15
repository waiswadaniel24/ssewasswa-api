// ============================================================
// FIXED ASSET TRACKER MODULE — Multi-Tenant SaaS Platform
// Asset lifecycle, depreciation, movements, maintenance,
// reports, CSV export. 14 routes.
// ============================================================
// Usage in server.js:
//   const assetTracker = require('./asset-tracker');
//   assetTracker(app, db, pool, renderPage, esc);
// ============================================================

'use strict';

module.exports = function assetTracker(app, db, pool, renderPage, esc) {

  // ── inline fallbacks ──────────────────────────────────────
  if (!esc) esc = (s) => String(s === null || s === undefined ? '' : (typeof s === 'object' ? JSON.stringify(s) : s)).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const requireAuth = (req, res, next) => { if (!req.session || !req.session.user) return res.redirect('/login'); next(); };
  const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const fmtMoney = (n) => '$' + Number(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '\u2014';
  const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '\u2014';

  // ── helpers ───────────────────────────────────────────────
  function statusBadge(status) {
    const map = {
      active:   { bg: '#dcfce7', c: '#16a34a', l: '\u2705 Active', cls: 'badge badge-success' },
      inactive: { bg: '#f1f5f9', c: '#64748b', l: '\u23f8 Inactive' },
      disposed: { bg: '#fee2e2', c: '#dc2626', l: '\u274c Disposed' },
      lost:     { bg: '#fef3c7', c: '#b45309', l: '\u26a0\ufe0f Lost', cls: 'badge badge-warning' },
      in_repair:{ bg: '#dbeafe', c: '#2563eb', l: '\U0001f527 In Repair' }
    };
    const s = map[status] || { bg: '#f1f5f9', c: '#64748b', l: status };
    return `<span class="${s.cls || 'badge'}" style="background:${s.bg};color:${s.c}">${s.l}</span>`;
  }

  const categoryColors = {
    'IT Equipment': '#4f46e5', 'Furniture': '#0891b2', 'Vehicles': '#ea580c',
    'Machinery': '#7c3aed', 'Real Estate': '#059669', 'Tools': '#ca8a04',
    'Electronics': '#db2777', 'Office Equipment': '#2563eb'
  };
  function catColor(cat) { return categoryColors[cat] || '#64748b'; }
  function catDot(cat) { return `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${catColor(cat)};margin-right:6px;vertical-align:middle"></span>`; }

  function depBar(purchase, current, rate) {
    const p = Number(purchase) || 0, c = Number(current) || 0;
    const pct = p > 0 ? Math.min(100, Math.max(0, Math.round(((p - c) / p) * 100))) : 0;
    const barC = pct > 80 ? '#dc2626' : pct > 50 ? '#f59e0b' : '#22c55e';
    return `<div style="display:flex;align-items:center;gap:8px">
      <div style="background:#e2e8f0;border-radius:10px;height:8px;width:80px;overflow:hidden"><div style="background:${barC};height:100%;border-radius:10px;width:${pct}%"></div></div>
      <span style="font-size:11px;font-weight:700;color:${barC}">${pct}%</span>
      <span class="muted" style="font-size:10px">${rate || 10}%/yr</span></div>`;
  }

  function maintenanceBadge(status) {
    const map = {
      scheduled: { bg: '#dbeafe', c: '#2563eb', l: 'Scheduled' },
      in_progress: { bg: '#fef3c7', c: '#b45309', l: 'In Progress', cls: 'badge badge-warning' },
      completed: { bg: '#dcfce7', c: '#16a34a', l: 'Completed', cls: 'badge badge-success' },
      overdue: { bg: '#fee2e2', c: '#dc2626', l: 'Overdue' }
    };
    const s = map[status] || { bg: '#f1f5f9', c: '#64748b', l: status };
    return `<span class="${s.cls || 'badge'}" style="background:${s.bg};color:${s.c}">${s.l}</span>`;
  }

  // ── CSS ───────────────────────────────────────────────────
  const ASSET_CSS = `<style>
.ast-nav{display:flex;gap:6px;margin-bottom:20px;flex-wrap:wrap}
.ast-nav a{padding:8px 16px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#475569;background:#f1f5f9;transition:.15s}
.ast-nav a:hover{background:#e2e8f0}.ast-nav a.active{background:#4f46e5;color:#fff}
.ast-tbl{width:100%;border-collapse:collapse;font-size:13px}
.ast-tbl th{padding:10px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#f8fafc}
.ast-tbl td{padding:9px 14px;border-bottom:1px solid #f1f5f9;color:#1e293b}
.ast-tbl tr:hover{background:#f8fafc}
.ast-filter{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:end}
.ast-filter label{display:block;font-size:12px;font-weight:600;color:#64748b;margin-bottom:4px}
.ast-filter input,.ast-filter select{padding:9px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px;background:#fff}
.ast-filter input:focus,.ast-filter select:focus{outline:none;border-color:#6366f1}
.ast-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.ast-grid .full{grid-column:1/-1}
.timeline{position:relative;padding-left:24px;margin:16px 0}
.timeline::before{content:'';position:absolute;left:8px;top:0;bottom:0;width:2px;background:#e2e8f0}
.timeline-item{position:relative;margin-bottom:14px;padding:12px 16px;background:#f8fafc;border-radius:10px;border-left:3px solid #cbd5e1}
.timeline-item.move{border-left-color:#4f46e5}.timeline-item.repair{border-left-color:#f59e0b}
.timeline-item.routine{border-left-color:#0891b2}.timeline-item.completed{border-left-color:#22c55e}
.timeline-item::before{content:'';position:absolute;left:-29px;top:16px;width:10px;height:10px;border-radius:50%;background:#94a3b8;border:2px solid #fff}
.timeline-item.move::before{background:#4f46e5}.timeline-item.repair::before{background:#f59e0b}
.timeline-item.routine::before{background:#0891b2}.timeline-item.completed::before{background:#22c55e}
.cal-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
.cal-card{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px;border-left:4px solid #4f46e5}
.cal-card.overdue{border-left-color:#dc2626;background:#fef2f2}
.cal-card.upcoming{border-left-color:#f59e0b;background:#fffbeb}
.bar-chart{display:flex;align-items:end;gap:8px;height:140px;padding:10px 0}
.bar-col{display:flex;flex-direction:column;align-items:center;gap:4px;flex:1}
.bar-fill{border-radius:6px 6px 0 0;min-width:20px;transition:.2s;background:linear-gradient(180deg,#4f46e5,#7c3aed)}
.bar-label{font-size:10px;color:#64748b;text-align:center;max-width:60px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bar-value{font-size:10px;font-weight:700;color:#1e293b}
@media(max-width:768px){.ast-grid{grid-template-columns:1fr}.ast-filter{flex-direction:column}}
</style>`;

  // ── MIGRATIONS ────────────────────────────────────────────
  const migrations = [
    `CREATE TABLE IF NOT EXISTS assets (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      asset_tag VARCHAR(50) UNIQUE, name VARCHAR(255) NOT NULL,
      category VARCHAR(100), description TEXT, serial_number VARCHAR(100),
      purchase_date DATE, purchase_price NUMERIC(12,2) DEFAULT 0,
      current_value NUMERIC(12,2) DEFAULT 0, depreciation_rate NUMERIC(5,2) DEFAULT 10,
      location VARCHAR(255), department VARCHAR(100),
      assigned_to VARCHAR(255), status VARCHAR(20) DEFAULT 'active',
      warranty_expiry DATE, next_maintenance DATE,
      notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS asset_movements (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      from_location VARCHAR(255), to_location VARCHAR(255),
      from_person VARCHAR(255), to_person VARCHAR(255),
      movement_type VARCHAR(30), notes TEXT,
      performed_by INTEGER, created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS asset_maintenance (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      maintenance_type VARCHAR(50) DEFAULT 'routine',
      description TEXT, cost NUMERIC(10,2) DEFAULT 0,
      performed_by VARCHAR(255), vendor VARCHAR(255),
      maintenance_date DATE, next_due DATE,
      status VARCHAR(20) DEFAULT 'completed', created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    // ALTER TABLE assets
    `ALTER TABLE IF EXISTS assets ADD COLUMN IF NOT EXISTS asset_tag VARCHAR(50)`,
    `ALTER TABLE IF EXISTS assets ADD COLUMN IF NOT EXISTS name VARCHAR(255) NOT NULL DEFAULT ''`,
    `ALTER TABLE IF EXISTS assets ADD COLUMN IF NOT EXISTS category VARCHAR(100)`,
    `ALTER TABLE IF EXISTS assets ADD COLUMN IF NOT EXISTS description TEXT`,
    `ALTER TABLE IF EXISTS assets ADD COLUMN IF NOT EXISTS serial_number VARCHAR(100)`,
    `ALTER TABLE IF EXISTS assets ADD COLUMN IF NOT EXISTS purchase_date DATE`,
    `ALTER TABLE IF EXISTS assets ADD COLUMN IF NOT EXISTS purchase_price NUMERIC(12,2) DEFAULT 0`,
    `ALTER TABLE IF EXISTS assets ADD COLUMN IF NOT EXISTS current_value NUMERIC(12,2) DEFAULT 0`,
    `ALTER TABLE IF EXISTS assets ADD COLUMN IF NOT EXISTS depreciation_rate NUMERIC(5,2) DEFAULT 10`,
    `ALTER TABLE IF EXISTS assets ADD COLUMN IF NOT EXISTS location VARCHAR(255)`,
    `ALTER TABLE IF EXISTS assets ADD COLUMN IF NOT EXISTS department VARCHAR(100)`,
    `ALTER TABLE IF EXISTS assets ADD COLUMN IF NOT EXISTS assigned_to VARCHAR(255)`,
    `ALTER TABLE IF EXISTS assets ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active'`,
    `ALTER TABLE IF EXISTS assets ADD COLUMN IF NOT EXISTS warranty_expiry DATE`,
    `ALTER TABLE IF EXISTS assets ADD COLUMN IF NOT EXISTS next_maintenance DATE`,
    `ALTER TABLE IF EXISTS assets ADD COLUMN IF NOT EXISTS notes TEXT`,
    `ALTER TABLE IF EXISTS assets ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`,
    // ALTER TABLE asset_movements
    `ALTER TABLE IF EXISTS asset_movements ADD COLUMN IF NOT EXISTS from_location VARCHAR(255)`,
    `ALTER TABLE IF EXISTS asset_movements ADD COLUMN IF NOT EXISTS to_location VARCHAR(255)`,
    `ALTER TABLE IF EXISTS asset_movements ADD COLUMN IF NOT EXISTS from_person VARCHAR(255)`,
    `ALTER TABLE IF EXISTS asset_movements ADD COLUMN IF NOT EXISTS to_person VARCHAR(255)`,
    `ALTER TABLE IF EXISTS asset_movements ADD COLUMN IF NOT EXISTS movement_type VARCHAR(30)`,
    `ALTER TABLE IF EXISTS asset_movements ADD COLUMN IF NOT EXISTS notes TEXT`,
    `ALTER TABLE IF EXISTS asset_movements ADD COLUMN IF NOT EXISTS performed_by INTEGER`,
    `ALTER TABLE IF EXISTS asset_movements ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`,
    // ALTER TABLE asset_maintenance
    `ALTER TABLE IF EXISTS asset_maintenance ADD COLUMN IF NOT EXISTS maintenance_type VARCHAR(50) DEFAULT 'routine'`,
    `ALTER TABLE IF EXISTS asset_maintenance ADD COLUMN IF NOT EXISTS description TEXT`,
    `ALTER TABLE IF EXISTS asset_maintenance ADD COLUMN IF NOT EXISTS cost NUMERIC(10,2) DEFAULT 0`,
    `ALTER TABLE IF EXISTS asset_maintenance ADD COLUMN IF NOT EXISTS performed_by VARCHAR(255)`,
    `ALTER TABLE IF EXISTS asset_maintenance ADD COLUMN IF NOT EXISTS vendor VARCHAR(255)`,
    `ALTER TABLE IF EXISTS asset_maintenance ADD COLUMN IF NOT EXISTS maintenance_date DATE`,
    `ALTER TABLE IF EXISTS asset_maintenance ADD COLUMN IF NOT EXISTS next_due DATE`,
    `ALTER TABLE IF EXISTS asset_maintenance ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'completed'`,
    `ALTER TABLE IF EXISTS asset_maintenance ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`,
    // Indexes
    `CREATE INDEX IF NOT EXISTS idx_assets_tenant ON assets(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_assets_category ON assets(category)`,
    `CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(tenant_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_assets_tag ON assets(asset_tag)`,
    `CREATE INDEX IF NOT EXISTS idx_amov_tenant ON asset_movements(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_amov_asset ON asset_movements(asset_id)`,
    `CREATE INDEX IF NOT EXISTS idx_amaint_tenant ON asset_maintenance(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_amaint_asset ON asset_maintenance(asset_id)`,
    `CREATE INDEX IF NOT EXISTS idx_amaint_status ON asset_maintenance(tenant_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_amaint_due ON asset_maintenance(tenant_id, next_due)`
  ];

  (async () => {
    const client = await pool.connect().catch(() => null);
    if (!client) { console.error('[Assets] Cannot connect to DB for migrations'); return; }
    try { for (const sql of migrations) await client.query(sql); console.log('[Assets] Migrations applied: ' + migrations.length + ' statements'); }
    catch (e) { console.error('[Assets] Migration error:', e.message); }
    finally { client.release(); }
  })();

  // ── helper: nav ───────────────────────────────────────────
  function nav(active) {
    const links = [
      ['/assets', 'Dashboard'], ['/assets/new', 'Add Asset'],
      ['/assets/maintenance', 'Maintenance'], ['/assets/report', 'Reports'],
      ['/assets/report/export', 'Export CSV']
    ];
    return '<div class="ast-nav">' + links.map(([href, label]) =>
      `<a href="${href}" class="${active === href ? 'active' : ''}">${label}</a>`).join('') + '</div>';
  }

  // ════════════════════════════════════════════════════════════
  // ROUTE 1: GET /assets — Dashboard
  // ════════════════════════════════════════════════════════════
  app.get('/assets', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { q, category, status, sort } = req.query;

    const stats = (await pool.query(`
      SELECT
        COUNT(*) as total_assets,
        COALESCE(SUM(purchase_price), 0) as total_purchase,
        COALESCE(SUM(current_value), 0) as total_current,
        COALESCE(SUM(purchase_price) - SUM(current_value), 0) as depreciated,
        COUNT(*) FILTER (WHERE next_maintenance <= CURRENT_DATE AND status = 'active') as maint_due,
        COUNT(*) FILTER (WHERE warranty_expiry <= CURRENT_DATE AND status = 'active') as warranty_expired
      FROM assets WHERE tenant_id=$1`, [tid])).rows[0];

    let where = ['tenant_id=$1'], params = [tid], pi = 2;
    if (q) { where.push(`(name ILIKE $${pi} OR asset_tag ILIKE $${pi} OR serial_number ILIKE $${pi})`); params.push('%' + q + '%'); pi++; }
    if (category) { where.push(`category=$${pi}`); params.push(category); pi++; }
    if (status) { where.push(`status=$${pi}`); params.push(status); pi++; }
    const orderMap = { name: 'name', value_desc: 'current_value DESC', value_asc: 'current_value ASC', created: 'created_at DESC', tag: 'asset_tag' };
    const orderSql = orderMap[sort] || orderMap.created;
    const assets = (await pool.query(
      `SELECT * FROM assets WHERE ${where.join(' AND ')} ORDER BY ${orderSql} LIMIT 100`, params
    )).rows;
    const categories = (await pool.query(`SELECT DISTINCT category FROM assets WHERE tenant_id=$1 AND category IS NOT NULL ORDER BY category`, [tid])).rows;

    const rows = assets.map(a => `<tr>
      <td><a href="/assets/${a.id}" style="color:#4f46e5;text-decoration:none;font-weight:600">${esc(a.name)}</a></td>
      <td style="font-family:monospace;font-size:12px;color:#64748b">${esc(a.asset_tag || '\u2014')}</td>
      <td>${catDot(a.category)}${esc(a.category || '\u2014')}</td>
      <td>${statusBadge(a.status)}</td>
      <td>${fmtMoney(a.purchase_price)}</td>
      <td>${fmtMoney(a.current_value)}</td>
      <td>${depBar(a.purchase_price, a.current_value, a.depreciation_rate)}</td>
      <td>${esc(a.location || '\u2014')}</td>
      <td>
        <a href="/assets/${a.id}" class="btn btn-sm btn-blue">View</a>
        <a href="/assets/${a.id}/edit" class="btn btn-sm btn-gold">Edit</a>
      </td>
    </tr>`).join('');

    const html = ASSET_CSS + `
    <div style="max-width:1200px;margin:0 auto">
      ${nav('/assets')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">\U0001f4bc Fixed Asset Tracker</h1>
        <p style="font-size:13px;color:#94a3b8;margin-top:2px">Track assets, depreciation, movements & maintenance</p></div>
        <div style="display:flex;gap:8px">
          <a href="/assets/new" class="btn btn-green">+ Add Asset</a>
          <a href="/assets/report/export" class="btn btn-blue">\U0001f4e5 Export CSV</a>
        </div>
      </div>
      <div class="stats">
        <div class="stat-card"><div class="stat-num" style="color:#4f46e5">${stats.total_assets}</div><div style="font-size:12px;color:#94a3b8;margin-top:2px">Total Assets</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#1e293b">${fmtMoney(stats.total_purchase)}</div><div style="font-size:12px;color:#94a3b8;margin-top:2px">Purchase Value</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#059669">${fmtMoney(stats.total_current)}</div><div style="font-size:12px;color:#94a3b8;margin-top:2px">Current Value</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#dc2626">${fmtMoney(stats.depreciated)}</div><div style="font-size:12px;color:#94a3b8;margin-top:2px">Depreciated</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${stats.maint_due}</div><div style="font-size:12px;color:#94a3b8;margin-top:2px">Maintenance Due</div></div>
      </div>
      <div class="card">
        <form method="GET" action="/assets" class="ast-filter">
          <div><label>Search</label><input type="text" name="q" value="${esc(q || '')}" placeholder="Name, tag, serial..."></div>
          <div><label>Category</label><select name="category"><option value="">All</option>${categories.map(c => `<option value="${esc(c.category)}" ${category === c.category ? 'selected' : ''}>${esc(c.category)}</option>`).join('')}</select></div>
          <div><label>Status</label><select name="status"><option value="">All</option><option value="active" ${status === 'active' ? 'selected' : ''}>Active</option><option value="inactive" ${status === 'inactive' ? 'selected' : ''}>Inactive</option><option value="disposed" ${status === 'disposed' ? 'selected' : ''}>Disposed</option><option value="lost" ${status === 'lost' ? 'selected' : ''}>Lost</option></select></div>
          <div><label>Sort</label><select name="sort"><option value="created" ${sort === 'created' ? 'selected' : ''}>Newest</option><option value="name" ${sort === 'name' ? 'selected' : ''}>Name</option><option value="value_desc" ${sort === 'value_desc' ? 'selected' : ''}>Value (High)</option><option value="value_asc" ${sort === 'value_asc' ? 'selected' : ''}>Value (Low)</option></select></div>
          <button type="submit" class="btn btn-sm btn-blue">Search</button>
        </form>
        <div style="overflow-x:auto"><table class="ast-tbl">
          <thead><tr><th>Asset</th><th>Tag</th><th>Category</th><th>Status</th><th>Purchase</th><th>Current</th><th>Depreciation</th><th>Location</th><th>Actions</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="9" style="text-align:center;color:#94a3b8;padding:40px">No assets found. <a href="/assets/new" style="color:#4f46e5">Add your first asset</a>.</td></tr>'}</tbody>
        </table></div>
      </div>
    </div>`;
    res.send(renderPage('Asset Dashboard', html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 2: GET /assets/new — Add Asset Form
  // ════════════════════════════════════════════════════════════
  app.get('/assets/new', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const categories = (await pool.query(`SELECT DISTINCT category FROM assets WHERE tenant_id=$1 AND category IS NOT NULL ORDER BY category`, [tid])).rows;
    const departments = (await pool.query(`SELECT DISTINCT department FROM assets WHERE tenant_id=$1 AND department IS NOT NULL ORDER BY department`, [tid])).rows;
    const fld = (label, name, type, placeholder) => `<div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">${label}</label>
      <input type="${type}" name="${name}" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;box-sizing:border-box" placeholder="${placeholder || ''}"></div>`;

    const html = ASSET_CSS + `
    <div style="max-width:800px;margin:0 auto">
      ${nav('/assets/new')}
      <a href="/assets" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">\u2190 Back to Assets</a>
      <div class="card" style="padding:24px">
        <h2 style="color:#1e293b;margin-bottom:4px">\U0001f4e6 Add New Asset</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Register a new fixed asset with details and depreciation info</p>
        <form method="POST" action="/assets/create" class="ast-grid">
          ${fld('Asset Name *', 'name', 'text', 'e.g. Dell Latitude 5540 Laptop')}
          ${fld('Asset Tag', 'asset_tag', 'text', 'Auto-generated if blank')}
          ${fld('Category', 'category', 'text', 'e.g. IT Equipment')}
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Department</label>
            <select name="department" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;box-sizing:border-box">
              <option value="">Select...</option>${departments.map(d => `<option value="${esc(d.department)}">${esc(d.department)}</option>`).join('')}
            </select></div>
          ${fld('Serial Number', 'serial_number', 'text', 'e.g. SN-12345ABC')}
          ${fld('Location', 'location', 'text', 'e.g. Building A, Floor 2')}
          ${fld('Assigned To', 'assigned_to', 'text', 'Person responsible')}
          ${fld('Purchase Date', 'purchase_date', 'date', '')}
          ${fld('Purchase Price ($)', 'purchase_price', 'number', '0')}
          ${fld('Current Value ($)', 'current_value', 'number', '0')}
          ${fld('Depreciation Rate (%/yr)', 'depreciation_rate', 'number', '10')}
          ${fld('Warranty Expiry', 'warranty_expiry', 'date', '')}
          ${fld('Next Maintenance', 'next_maintenance', 'date', '')}
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Status</label>
            <select name="status" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;box-sizing:border-box">
              <option value="active">Active</option><option value="inactive">Inactive</option>
              <option value="disposed">Disposed</option><option value="lost">Lost</option><option value="in_repair">In Repair</option>
            </select></div>
          <div class="full"><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Description</label>
            <textarea name="description" rows="3" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;box-sizing:border-box;resize:vertical" placeholder="Optional description..."></textarea></div>
          <div class="full"><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Notes</label>
            <textarea name="notes" rows="2" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;box-sizing:border-box;resize:vertical" placeholder="Additional notes..."></textarea></div>
          <div class="full" style="display:flex;gap:10px;margin-top:8px">
            <button type="submit" class="btn btn-green" style="padding:12px 28px">\U0001f4be Save Asset</button>
            <a href="/assets" class="btn" style="padding:12px 28px;background:#f1f5f9;color:#475569;text-decoration:none">Cancel</a>
          </div>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Add Asset', html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 3: POST /assets/create — Save Asset
  // ════════════════════════════════════════════════════════════
  app.post('/assets/create', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { name, asset_tag, category, description, serial_number, purchase_date,
      purchase_price, current_value, depreciation_rate, location, department,
      assigned_to, status, warranty_expiry, next_maintenance, notes } = req.body;
    if (!name || !name.trim()) return res.send('<div class="alert">Asset name is required.</div><a href="/assets/new" class="btn btn-blue">Back</a>');

    let tag = (asset_tag || '').trim() || null;
    if (!tag) {
      const prefix = 'AST';
      const count = (await pool.query(`SELECT COUNT(*)::int as cnt FROM assets WHERE tenant_id=$1`, [tid])).rows[0].cnt;
      tag = prefix + '-' + String(count + 1).padStart(5, '0');
    }

    await pool.query(
      `INSERT INTO assets (tenant_id, asset_tag, name, category, description, serial_number,
        purchase_date, purchase_price, current_value, depreciation_rate, location, department,
        assigned_to, status, warranty_expiry, next_maintenance, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [tid, tag, name.trim(), (category || '').trim() || null, (description || '').trim() || null,
        (serial_number || '').trim() || null, purchase_date || null,
        parseFloat(purchase_price) || 0, parseFloat(current_value) || 0,
        parseFloat(depreciation_rate) || 10, (location || '').trim() || null,
        (department || '').trim() || null, (assigned_to || '').trim() || null,
        status || 'active', warranty_expiry || null, next_maintenance || null,
        (notes || '').trim() || null]
    );
    res.redirect('/assets');
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 4: GET /assets/:id — Asset Detail
  // ════════════════════════════════════════════════════════════
  app.get('/assets/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, id = req.params.id;
    const asset = (await pool.query('SELECT * FROM assets WHERE id=$1 AND tenant_id=$2', [id, tid])).rows[0];
    if (!asset) return res.send('<div class="alert">Asset not found.</div><a href="/assets" class="btn btn-blue">Back</a>');

    const movements = (await pool.query(
      `SELECT am.*, u.name as performer FROM asset_movements am LEFT JOIN users u ON u.id=am.performed_by
       WHERE am.asset_id=$1 AND am.tenant_id=$2 ORDER BY am.created_at DESC LIMIT 50`, [id, tid])).rows;
    const maintenance = (await pool.query(
      `SELECT * FROM asset_maintenance WHERE asset_id=$1 AND tenant_id=$2 ORDER BY maintenance_date DESC NULLS LAST LIMIT 30`, [id, tid])).rows;

    const moveHtml = movements.map(m => `
      <div class="timeline-item move">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px">
          <div style="font-weight:600;color:#4f46e5">${esc(m.movement_type || 'Transfer')}</div>
          <span class="muted" style="font-size:12px">${fmtDateTime(m.created_at)}</span>
        </div>
        <div style="font-size:12px;color:#64748b;margin-top:4px">
          ${m.from_location ? `From: <strong>${esc(m.from_location)}</strong>` : ''} ${m.to_location ? `\u2192 To: <strong>${esc(m.to_location)}</strong>` : ''}
          ${m.from_person ? `\u00b7 Person: ${esc(m.from_person)}` : ''} ${m.to_person ? `\u2192 ${esc(m.to_person)}` : ''}
          ${m.notes ? `\u00b7 ${esc(m.notes)}` : ''} ${m.performer ? `\u00b7 by ${esc(m.performer)}` : ''}
        </div>
      </div>`).join('');

    const maintHtml = maintenance.map(m => `
      <div class="timeline-item ${m.maintenance_type === 'repair' ? 'repair' : m.status === 'completed' ? 'completed' : 'routine'}">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px">
          <div>${maintenanceBadge(m.status)} <strong style="color:#1e293b">${esc(m.maintenance_type || 'routine')}</strong>
            <span class="muted" style="font-size:12px;margin-left:6px">${fmtDate(m.maintenance_date)}</span></div>
          <span style="font-size:12px;font-weight:600;color:#1e293b">${fmtMoney(m.cost)}</span>
        </div>
        <div style="font-size:12px;color:#64748b;margin-top:4px">
          ${m.description ? esc(m.description) : 'No description'}
          ${m.vendor ? `\u00b7 Vendor: ${esc(m.vendor)}` : ''} ${m.performed_by ? `\u00b7 by ${esc(m.performed_by)}` : ''}
          ${m.next_due ? `\u00b7 Next due: ${fmtDate(m.next_due)}` : ''}
        </div>
      </div>`).join('');

    const warrantyDays = asset.warranty_expiry ? Math.ceil((new Date(asset.warranty_expiry) - new Date()) / 86400000) : null;
    const warrantyHtml = warrantyDays !== null
      ? (warrantyDays < 0 ? `<span class="badge badge-warning" style="background:#fee2e2;color:#dc2626">Expired ${Math.abs(warrantyDays)}d ago</span>`
        : warrantyDays < 30 ? `<span class="badge badge-warning">Expiring in ${warrantyDays}d</span>`
        : `<span class="badge badge-success">Valid (${warrantyDays}d remaining)</span>`)
      : '<span class="muted">No warranty</span>';

    const html = ASSET_CSS + `
    <div style="max-width:1000px;margin:0 auto">
      ${nav('/assets')}
      <a href="/assets" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">\u2190 Back to Assets</a>
      <div class="card" style="padding:24px;margin-bottom:20px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px">
          <div>
            <h2 style="color:#1e293b;margin-bottom:4px">\U0001f4bc ${esc(asset.name)}</h2>
            <p class="muted" style="font-size:13px">Tag: <strong style="color:#4f46e5">${esc(asset.asset_tag || 'N/A')}</strong> \u00b7 Serial: ${esc(asset.serial_number || 'N/A')} \u00b7 ${catDot(asset.category)}${esc(asset.category || 'N/A')}</p>
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            ${statusBadge(asset.status)}
            <a href="/assets/${id}/edit" class="btn btn-gold">\u270f\ufe0f Edit</a>
            <button onclick="if(confirm('Delete this asset?'))fetch('/assets/${id}',{method:'DELETE'}).then(r=>r.json()).then(d=>{if(d.ok)location.href='/assets'})" class="btn btn-sm btn-red">Delete</button>
          </div>
        </div>
        ${asset.description ? `<p style="color:#475569;font-size:14px;margin-top:12px">${esc(asset.description)}</p>` : ''}
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:14px;margin-top:20px">
          <div style="background:#f8fafc;padding:14px;border-radius:10px;text-align:center">
            <div style="font-size:20px;font-weight:800;color:#1e293b">${fmtMoney(asset.purchase_price)}</div><div style="font-size:12px;color:#94a3b8">Purchase Price</div></div>
          <div style="background:#f8fafc;padding:14px;border-radius:10px;text-align:center">
            <div style="font-size:20px;font-weight:800;color:#059669">${fmtMoney(asset.current_value)}</div><div style="font-size:12px;color:#94a3b8">Current Value</div></div>
          <div style="background:#f8fafc;padding:14px;border-radius:10px;text-align:center">
            <div style="margin-top:4px">${depBar(asset.purchase_price, asset.current_value, asset.depreciation_rate)}</div><div style="font-size:12px;color:#94a3b8;margin-top:6px">Depreciation</div></div>
          <div style="background:#f8fafc;padding:14px;border-radius:10px;text-align:center">
            <div style="font-size:16px;font-weight:800;color:#1e293b">${esc(asset.location || 'N/A')}</div><div style="font-size:12px;color:#94a3b8">Location</div></div>
          <div style="background:#f8fafc;padding:14px;border-radius:10px;text-align:center">
            <div style="font-size:16px;font-weight:800;color:#1e293b">${esc(asset.department || 'N/A')}</div><div style="font-size:12px;color:#94a3b8">Department</div></div>
          <div style="background:#f8fafc;padding:14px;border-radius:10px;text-align:center">
            <div style="font-size:16px;font-weight:800;color:#1e293b">${esc(asset.assigned_to || 'N/A')}</div><div style="font-size:12px;color:#94a3b8">Assigned To</div></div>
          <div style="background:#f8fafc;padding:14px;border-radius:10px;text-align:center">${warrantyHtml}<div style="font-size:12px;color:#94a3b8;margin-top:6px">Warranty</div></div>
          <div style="background:#f8fafc;padding:14px;border-radius:10px;text-align:center">
            <div style="font-size:16px;font-weight:800;color:#1e293b">${asset.next_maintenance ? fmtDate(asset.next_maintenance) : 'N/A'}</div><div style="font-size:12px;color:#94a3b8">Next Maintenance</div></div>
        </div>
      </div>
      <!-- Movement Form -->
      <div class="card" style="padding:20px;margin-bottom:20px">
        <h3 style="color:#1e293b;margin-bottom:12px">\U0001f680 Record Movement</h3>
        <form method="POST" action="/assets/${id}/move" class="ast-grid">
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">From Location</label><input type="text" name="from_location" value="${esc(asset.location || '')}" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;box-sizing:border-box"></div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">To Location</label><input type="text" name="to_location" required style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;box-sizing:border-box" placeholder="New location..."></div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">From Person</label><input type="text" name="from_person" value="${esc(asset.assigned_to || '')}" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;box-sizing:border-box"></div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">To Person</label><input type="text" name="to_person" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;box-sizing:border-box" placeholder="New assignee..."></div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Movement Type</label>
            <select name="movement_type" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;box-sizing:border-box">
              <option value="transfer">Transfer</option><option value="checkout">Checkout</option>
              <option value="return">Return</option><option value="deployment">Deployment</option>
            </select></div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Notes</label>
            <input type="text" name="move_notes" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;box-sizing:border-box" placeholder="Reason..."></div>
          <div class="full"><button type="submit" class="btn btn-blue">\U0001f680 Record Movement</button></div>
        </form>
      </div>
      <!-- Movement Timeline -->
      <div class="card" style="padding:24px;margin-bottom:20px">
        <h3 style="color:#1e293b;margin-bottom:12px">\U0001f4cb Movement History</h3>
        ${moveHtml || '<p class="muted" style="text-align:center;padding:20px">No movements recorded.</p>'}
      </div>
      <!-- Maintenance Log -->
      <div class="card" style="padding:24px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <h3 style="color:#1e293b">\U0001f527 Maintenance Log</h3>
          <a href="/assets/maintenance/new?asset_id=${id}" class="btn btn-sm btn-green">+ Schedule</a>
        </div>
        ${maintHtml || '<p class="muted" style="text-align:center;padding:20px">No maintenance records.</p>'}
      </div>
    </div>`;
    res.send(renderPage('Asset: ' + asset.name, html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 5: GET /assets/:id/edit — Edit Asset
  // ════════════════════════════════════════════════════════════
  app.get('/assets/:id/edit', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, id = req.params.id;
    const asset = (await pool.query('SELECT * FROM assets WHERE id=$1 AND tenant_id=$2', [id, tid])).rows[0];
    if (!asset) return res.send('<div class="alert">Asset not found.</div><a href="/assets" class="btn btn-blue">Back</a>');
    const fld = (label, name, type, val) => `<div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">${label}</label>
      <input type="${type}" name="${name}" value="${esc(String(val || ''))}" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;box-sizing:border-box"></div>`;

    const html = ASSET_CSS + `
    <div style="max-width:800px;margin:0 auto">
      ${nav('/assets')}
      <a href="/assets/${id}" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">\u2190 Back to Asset</a>
      <div class="card" style="padding:24px">
        <h2 style="color:#1e293b;margin-bottom:20px">\u270f\ufe0f Edit: ${esc(asset.name)}</h2>
        <form method="POST" action="/assets/${id}/update" class="ast-grid">
          ${fld('Asset Name *', 'name', 'text', asset.name)}
          ${fld('Asset Tag', 'asset_tag', 'text', asset.asset_tag)}
          ${fld('Category', 'category', 'text', asset.category)}
          ${fld('Serial Number', 'serial_number', 'text', asset.serial_number)}
          ${fld('Location', 'location', 'text', asset.location)}
          ${fld('Department', 'department', 'text', asset.department)}
          ${fld('Assigned To', 'assigned_to', 'text', asset.assigned_to)}
          ${fld('Purchase Date', 'purchase_date', 'date', asset.purchase_date)}
          ${fld('Purchase Price ($)', 'purchase_price', 'number', asset.purchase_price)}
          ${fld('Current Value ($)', 'current_value', 'number', asset.current_value)}
          ${fld('Depreciation Rate (%/yr)', 'depreciation_rate', 'number', asset.depreciation_rate)}
          ${fld('Warranty Expiry', 'warranty_expiry', 'date', asset.warranty_expiry)}
          ${fld('Next Maintenance', 'next_maintenance', 'date', asset.next_maintenance)}
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Status</label>
            <select name="status" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;box-sizing:border-box">
              ${['active','inactive','disposed','lost','in_repair'].map(s => `<option value="${s}" ${asset.status === s ? 'selected' : ''}>${s.charAt(0).toUpperCase() + s.slice(1).replace('_',' ')}</option>`).join('')}
            </select></div>
          <div class="full"><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Description</label>
            <textarea name="description" rows="3" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;box-sizing:border-box;resize:vertical">${esc(asset.description || '')}</textarea></div>
          <div class="full"><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Notes</label>
            <textarea name="notes" rows="2" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;box-sizing:border-box;resize:vertical">${esc(asset.notes || '')}</textarea></div>
          <div class="full" style="display:flex;gap:10px;margin-top:8px">
            <button type="submit" class="btn btn-green" style="padding:12px 28px">\U0001f4be Update Asset</button>
            <a href="/assets/${id}" class="btn" style="padding:12px 28px;background:#f1f5f9;color:#475569;text-decoration:none">Cancel</a>
          </div>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Edit Asset: ' + asset.name, html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 6: POST /assets/:id/update — Update Asset
  // ════════════════════════════════════════════════════════════
  app.post('/assets/:id/update', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, id = req.params.id;
    const { name, asset_tag, category, description, serial_number, purchase_date,
      purchase_price, current_value, depreciation_rate, location, department,
      assigned_to, status, warranty_expiry, next_maintenance, notes } = req.body;
    if (!name || !name.trim()) return res.send('<div class="alert">Asset name is required.</div><a href="javascript:history.back()" class="btn btn-blue">Back</a>');
    await pool.query(
      `UPDATE assets SET name=$1, asset_tag=$2, category=$3, description=$4, serial_number=$5,
        purchase_date=$6, purchase_price=$7, current_value=$8, depreciation_rate=$9,
        location=$10, department=$11, assigned_to=$12, status=$13,
        warranty_expiry=$14, next_maintenance=$15, notes=$16
       WHERE id=$17 AND tenant_id=$18`,
      [name.trim(), (asset_tag || '').trim() || null, (category || '').trim() || null,
        (description || '').trim() || null, (serial_number || '').trim() || null,
        purchase_date || null, parseFloat(purchase_price) || 0, parseFloat(current_value) || 0,
        parseFloat(depreciation_rate) || 10, (location || '').trim() || null,
        (department || '').trim() || null, (assigned_to || '').trim() || null,
        status || 'active', warranty_expiry || null, next_maintenance || null,
        (notes || '').trim() || null, id, tid]
    );
    res.redirect('/assets/' + id);
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 7: DELETE /assets/:id — Delete Asset
  // ════════════════════════════════════════════════════════════
  app.delete('/assets/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, id = req.params.id;
    const asset = (await pool.query('SELECT id, name FROM assets WHERE id=$1 AND tenant_id=$2', [id, tid])).rows[0];
    if (!asset) return res.json({ ok: false, error: 'Not found' });
    await pool.query('DELETE FROM asset_maintenance WHERE asset_id=$1 AND tenant_id=$2', [id, tid]);
    await pool.query('DELETE FROM asset_movements WHERE asset_id=$1 AND tenant_id=$2', [id, tid]);
    await pool.query('DELETE FROM assets WHERE id=$1 AND tenant_id=$2', [id, tid]);
    res.json({ ok: true, message: 'Asset deleted' });
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 8: POST /assets/:id/move — Record Movement
  // ════════════════════════════════════════════════════════════
  app.post('/assets/:id/move', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, id = req.params.id;
    const { from_location, to_location, from_person, to_person, movement_type, move_notes } = req.body;
    const asset = (await pool.query('SELECT id FROM assets WHERE id=$1 AND tenant_id=$2', [id, tid])).rows[0];
    if (!asset) return res.send('<div class="alert">Asset not found.</div><a href="/assets" class="btn btn-blue">Back</a>');

    await pool.query(
      `INSERT INTO asset_movements (tenant_id, asset_id, from_location, to_location, from_person, to_person, movement_type, notes, performed_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [tid, id, (from_location || '').trim() || null, (to_location || '').trim() || null,
        (from_person || '').trim() || null, (to_person || '').trim() || null,
        (movement_type || 'transfer').trim(), (move_notes || '').trim() || null, user.id]
    );
    // Update asset location and assignee if provided
    if (to_location) await pool.query('UPDATE assets SET location=$1 WHERE id=$2 AND tenant_id=$3', [to_location.trim(), id, tid]);
    if (to_person) await pool.query('UPDATE assets SET assigned_to=$1 WHERE id=$2 AND tenant_id=$3', [to_person.trim(), id, tid]);
    res.redirect('/assets/' + id);
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 9: GET /assets/maintenance — Maintenance Schedule
  // ════════════════════════════════════════════════════════════
  app.get('/assets/maintenance', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { status } = req.query;

    const overdue = (await pool.query(
      `SELECT m.*, a.name as asset_name, a.asset_tag, a.location
       FROM asset_maintenance m JOIN assets a ON a.id=m.asset_id
       WHERE m.tenant_id=$1 AND m.status='scheduled' AND m.next_due < CURRENT_DATE
       ORDER BY m.next_due ASC LIMIT 50`, [tid])).rows;

    const upcoming = (await pool.query(
      `SELECT m.*, a.name as asset_name, a.asset_tag, a.location
       FROM asset_maintenance m JOIN assets a ON a.id=m.asset_id
       WHERE m.tenant_id=$1 AND m.status='scheduled' AND m.next_due >= CURRENT_DATE
       ORDER BY m.next_due ASC LIMIT 50`, [tid])).rows;

    let allRecords = (await pool.query(
      `SELECT m.*, a.name as asset_name, a.asset_tag
       FROM asset_maintenance m JOIN assets a ON a.id=m.asset_id
       WHERE m.tenant_id=$1
       ORDER BY m.maintenance_date DESC NULLS LAST, m.created_at DESC LIMIT 100`, [tid])).rows;
    if (status) allRecords = allRecords.filter(r => r.status === status);

    const calCards = [...overdue.map(r => ({ ...r, cardClass: 'overdue' })), ...upcoming.map(r => ({ ...r, cardClass: 'upcoming' }))];

    const calHtml = calCards.map(c => `<div class="cal-card ${c.cardClass}">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span style="font-weight:700;font-size:13px;color:#1e293b">${esc(c.asset_name)}</span>
        ${c.cardClass === 'overdue' ? '<span class="badge badge-warning" style="background:#fee2e2;color:#dc2626">Overdue</span>' : '<span class="badge badge-warning">Upcoming</span>'}
      </div>
      <div style="font-size:12px;color:#64748b">${esc(c.maintenance_type)} \u00b7 Due: <strong style="color:#1e293b">${fmtDate(c.next_due)}</strong></div>
      <div style="font-size:12px;color:#64748b;margin-top:2px">${esc(c.description || 'No description')}</div>
      <form method="POST" action="/assets/maintenance/${c.id}/complete" style="margin-top:8px">
        <button type="submit" class="btn btn-sm btn-green">Mark Complete</button>
      </form>
    </div>`).join('');

    const rows = allRecords.map(m => `<tr>
      <td><a href="/assets/${m.asset_id}" style="color:#4f46e5;text-decoration:none;font-weight:600">${esc(m.asset_name)}</a></td>
      <td style="font-family:monospace;font-size:12px;color:#64748b">${esc(m.asset_tag || '\u2014')}</td>
      <td>${esc(m.maintenance_type || 'routine')}</td>
      <td>${fmtDate(m.maintenance_date)}</td>
      <td>${fmtDate(m.next_due)}</td>
      <td>${fmtMoney(m.cost)}</td>
      <td>${maintenanceBadge(m.status)}</td>
      <td>${m.status === 'scheduled' ? `<form method="POST" action="/assets/maintenance/${m.id}/complete" style="display:inline"><button class="btn btn-sm btn-green" type="submit">Complete</button></form>` : '\u2014'}</td>
    </tr>`).join('');

    const html = ASSET_CSS + `
    <div style="max-width:1200px;margin:0 auto">
      ${nav('/assets/maintenance')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">\U0001f527 Maintenance Schedule</h1>
        <p style="font-size:13px;color:#94a3b8;margin-top:2px">Track upcoming and overdue maintenance</p></div>
        <a href="/assets/maintenance/new" class="btn btn-green">+ Schedule Maintenance</a>
      </div>
      <div class="stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-bottom:20px">
        <div class="stat-card"><div class="stat-num" style="color:#dc2626">${overdue.length}</div><div style="font-size:12px;color:#94a3b8;margin-top:2px">Overdue</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${upcoming.length}</div><div style="font-size:12px;color:#94a3b8;margin-top:2px">Upcoming</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#4f46e5">${allRecords.length}</div><div style="font-size:12px;color:#94a3b8;margin-top:2px">Total Records</div></div>
      </div>
      ${calCards.length ? `<div style="margin-bottom:20px"><h3 style="color:#1e293b;margin-bottom:12px">\U0001f4c5 Calendar View</h3><div class="cal-grid">${calHtml}</div></div>` : ''}
      <div class="card">
        <div class="ast-filter">
          <div><label>Status</label><select onchange="location.href='/assets/maintenance?status='+this.value">
            <option value="">All</option><option value="scheduled" ${status === 'scheduled' ? 'selected' : ''}>Scheduled</option>
            <option value="completed" ${status === 'completed' ? 'selected' : ''}>Completed</option>
            <option value="in_progress" ${status === 'in_progress' ? 'selected' : ''}>In Progress</option></select></div>
        </div>
        <div style="overflow-x:auto"><table class="ast-tbl">
          <thead><tr><th>Asset</th><th>Tag</th><th>Type</th><th>Date</th><th>Next Due</th><th>Cost</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="8" style="text-align:center;color:#94a3b8;padding:40px">No maintenance records found.</td></tr>'}</tbody>
        </table></div>
      </div>
    </div>`;
    res.send(renderPage('Maintenance Schedule', html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 10: GET /assets/maintenance/new — Schedule Maintenance
  // ════════════════════════════════════════════════════════════
  app.get('/assets/maintenance/new', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const prefillId = req.query.asset_id || '';
    const assets = (await pool.query('SELECT id, name, asset_tag FROM assets WHERE tenant_id=$1 AND status=\'active\' ORDER BY name', [tid])).rows;

    const html = ASSET_CSS + `
    <div style="max-width:700px;margin:0 auto">
      ${nav('/assets/maintenance')}
      <a href="/assets/maintenance" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">\u2190 Back to Maintenance</a>
      <div class="card" style="padding:24px">
        <h2 style="color:#1e293b;margin-bottom:4px">\U0001f527 Schedule Maintenance</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Create a new maintenance record for an asset</p>
        <form method="POST" action="/assets/maintenance/create" class="ast-grid">
          <div class="full"><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Asset *</label>
            <select name="asset_id" required style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;box-sizing:border-box">
              <option value="">Select asset...</option>${assets.map(a => `<option value="${a.id}" ${String(a.id) === prefillId ? 'selected' : ''}>${esc(a.name)} (${esc(a.asset_tag || 'No tag')})</option>`).join('')}
            </select></div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Maintenance Type</label>
            <select name="maintenance_type" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;box-sizing:border-box">
              <option value="routine">Routine</option><option value="repair">Repair</option>
              <option value="inspection">Inspection</option><option value="calibration">Calibration</option>
              <option value="upgrade">Upgrade</option></select></div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Cost ($)</label>
            <input type="number" name="cost" step="0.01" min="0" value="0" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;box-sizing:border-box"></div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Maintenance Date</label>
            <input type="date" name="maintenance_date" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;box-sizing:border-box"></div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Next Due Date</label>
            <input type="date" name="next_due" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;box-sizing:border-box"></div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Performed By</label>
            <input type="text" name="performed_by" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;box-sizing:border-box" placeholder="Technician name"></div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Vendor</label>
            <input type="text" name="vendor" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;box-sizing:border-box" placeholder="Service vendor"></div>
          <div class="full"><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Description</label>
            <textarea name="description" rows="3" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;box-sizing:border-box;resize:vertical" placeholder="Describe the maintenance work..."></textarea></div>
          <div class="full" style="display:flex;gap:10px;margin-top:8px">
            <button type="submit" class="btn btn-green" style="padding:12px 28px">\U0001f4be Save Record</button>
            <a href="/assets/maintenance" class="btn" style="padding:12px 28px;background:#f1f5f9;color:#475569;text-decoration:none">Cancel</a>
          </div>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Schedule Maintenance', html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 11: POST /assets/maintenance/create — Save Record
  // ════════════════════════════════════════════════════════════
  app.post('/assets/maintenance/create', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { asset_id, maintenance_type, description, cost, performed_by, vendor, maintenance_date, next_due } = req.body;
    if (!asset_id) return res.send('<div class="alert">Please select an asset.</div><a href="/assets/maintenance/new" class="btn btn-blue">Back</a>');
    const status = maintenance_date ? 'completed' : 'scheduled';
    await pool.query(
      `INSERT INTO asset_maintenance (tenant_id, asset_id, maintenance_type, description, cost, performed_by, vendor, maintenance_date, next_due, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [tid, parseInt(asset_id), maintenance_type || 'routine', (description || '').trim() || null,
        parseFloat(cost) || 0, (performed_by || '').trim() || null, (vendor || '').trim() || null,
        maintenance_date || null, next_due || null, status]
    );
    // Update asset next_maintenance if next_due provided
    if (next_due) await pool.query('UPDATE assets SET next_maintenance=$1 WHERE id=$2 AND tenant_id=$3', [next_due, parseInt(asset_id), tid]);
    res.redirect('/assets/maintenance');
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 12: POST /assets/maintenance/:id/complete
  // ════════════════════════════════════════════════════════════
  app.post('/assets/maintenance/:id/complete', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, mid = req.params.id;
    const maint = (await pool.query(
      `UPDATE asset_maintenance SET status='completed', maintenance_date=COALESCE(maintenance_date, CURRENT_DATE)
       WHERE id=$1 AND tenant_id=$2 AND status='scheduled' RETURNING asset_id`, [mid, tid]
    ));
    if (maint.rows.length && maint.rows[0].asset_id) {
      res.redirect('/assets/' + maint.rows[0].asset_id);
    } else {
      res.redirect('/assets/maintenance');
    }
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 13: GET /assets/report — Reports
  // ════════════════════════════════════════════════════════════
  app.get('/assets/report', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    // By Category
    const byCategory = (await pool.query(
      `SELECT category, COUNT(*)::int as cnt, SUM(purchase_price) as purchase, SUM(current_value) as current_val
       FROM assets WHERE tenant_id=$1 AND category IS NOT NULL GROUP BY category ORDER BY purchase DESC LIMIT 15`, [tid])).rows;

    // By Department
    const byDept = (await pool.query(
      `SELECT department, COUNT(*)::int as cnt, SUM(purchase_price) as purchase, SUM(current_value) as current_val
       FROM assets WHERE tenant_id=$1 AND department IS NOT NULL GROUP BY department ORDER BY purchase DESC LIMIT 15`, [tid])).rows;

    // Depreciation Schedule
    const depSchedule = (await pool.query(
      `SELECT name, asset_tag, category, purchase_price, current_value, depreciation_rate,
        purchase_date, (purchase_price - current_value) as total_dep,
        CASE WHEN depreciation_rate > 0 AND purchase_price > 0
          THEN ROUND((current_value / (depreciation_rate / 100)) / 365)::int
          ELSE NULL END as days_remaining
       FROM assets WHERE tenant_id=$1 AND status='active' AND purchase_price > 0
       ORDER BY depreciation_rate DESC LIMIT 30`, [tid])).rows;

    // Value Summary
    const valueSummary = (await pool.query(`
      SELECT
        COUNT(*) as total,
        SUM(purchase_price) as total_purchase,
        SUM(current_value) as total_current,
        SUM(purchase_price - current_value) as total_dep,
        AVG(CASE WHEN purchase_price > 0 THEN ((purchase_price - current_value) / purchase_price * 100) ELSE 0 END)::numeric(5,1) as avg_dep_pct,
        MIN(current_value) as min_val,
        MAX(current_value) as max_val
      FROM assets WHERE tenant_id=$1`, [tid])).rows[0];

    const maxCatVal = Math.max(...byCategory.map(c => Number(c.purchase) || 0), 1);
    const catBars = byCategory.map(c => {
      const w = Math.max(5, Math.round((Number(c.purchase) / maxCatVal) * 100));
      return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        ${catDot(c.category)}<span style="font-size:13px;width:120px;flex-shrink:0">${esc(c.category)}</span>
        <div style="flex:1;background:#e2e8f0;border-radius:10px;height:20px;overflow:hidden">
          <div style="height:100%;width:${w}%;background:${catColor(c.category)};border-radius:10px;display:flex;align-items:center;justify-content:flex-end;padding-right:8px">
            <span style="font-size:10px;font-weight:700;color:#fff">${fmtMoney(c.purchase)}</span>
          </div>
        </div>
        <span style="font-size:11px;color:#64748b;width:60px;text-align:right">${c.cnt} assets</span>
      </div>`;
    }).join('');

    const depRows = depSchedule.map(d => `<tr>
      <td><a href="/assets/${d.id}" style="color:#4f46e5;text-decoration:none;font-weight:600">${esc(d.name)}</a></td>
      <td style="font-family:monospace;font-size:12px">${esc(d.asset_tag || '\u2014')}</td>
      <td>${catDot(d.category)}${esc(d.category || '\u2014')}</td>
      <td>${fmtMoney(d.purchase_price)}</td>
      <td>${fmtMoney(d.current_val)}</td>
      <td style="color:#dc2626;font-weight:600">${fmtMoney(d.total_dep)}</td>
      <td>${depBar(d.purchase_price, d.current_val, d.depreciation_rate)}</td>
      <td style="font-size:12px">${d.days_remaining ? d.days_remaining + ' days' : '\u221e'}</td>
    </tr>`).join('');

    const deptRows = byDept.map(d => `<tr>
      <td style="font-weight:600">${esc(d.department)}</td>
      <td>${d.cnt}</td>
      <td>${fmtMoney(d.purchase)}</td>
      <td>${fmtMoney(d.current_val)}</td>
      <td style="color:#dc2626">${fmtMoney(Number(d.purchase) - Number(d.current_val))}</td>
    </tr>`).join('');

    const html = ASSET_CSS + `
    <div style="max-width:1200px;margin:0 auto">
      ${nav('/assets/report')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">\U0001f4ca Asset Reports</h1>
        <p style="font-size:13px;color:#94a3b8;margin-top:2px">Category breakdown, depreciation schedule, value analysis</p></div>
        <a href="/assets/report/export" class="btn btn-blue">\U0001f4e5 Export CSV</a>
      </div>
      <!-- Value Summary -->
      <div class="stats" style="margin-bottom:20px">
        <div class="stat-card"><div class="stat-num">${valueSummary.total}</div><div style="font-size:12px;color:#94a3b8;margin-top:2px">Total Assets</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#1e293b">${fmtMoney(valueSummary.total_purchase)}</div><div style="font-size:12px;color:#94a3b8;margin-top:2px">Total Purchase</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#059669">${fmtMoney(valueSummary.total_current)}</div><div style="font-size:12px;color:#94a3b8;margin-top:2px">Current Value</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#dc2626">${fmtMoney(valueSummary.total_dep)}</div><div style="font-size:12px;color:#94a3b8;margin-top:2px">Total Depreciation</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${valueSummary.avg_dep_pct}%</div><div style="font-size:12px;color:#94a3b8;margin-top:2px">Avg Depreciation</div></div>
        <div class="stat-card"><div class="stat-num" style="font-size:16px">${fmtMoney(valueSummary.min_val)} \u2013 ${fmtMoney(valueSummary.max_val)}</div><div style="font-size:12px;color:#94a3b8;margin-top:2px">Value Range</div></div>
      </div>
      <div class="grid" style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px">
        <!-- Category Chart -->
        <div class="card" style="padding:24px">
          <h3 style="color:#1e293b;margin-bottom:16px">\U0001f3e2 By Category (Purchase Value)</h3>
          ${catBars || '<p class="muted">No data.</p>'}
        </div>
        <!-- Department Table -->
        <div class="card" style="padding:24px">
          <h3 style="color:#1e293b;margin-bottom:16px">\U0001f3eb By Department</h3>
          <table class="ast-tbl"><thead><tr><th>Dept</th><th>Count</th><th>Purchase</th><th>Current</th><th>Dep</th></tr></thead>
          <tbody>${deptRows || '<tr><td colspan="5" class="muted" style="text-align:center;padding:20px">No department data.</td></tr>'}</tbody></table>
        </div>
      </div>
      <!-- Depreciation Schedule -->
      <div class="card" style="padding:24px">
        <h3 style="color:#1e293b;margin-bottom:16px">\U0001f4c9 Depreciation Schedule (Active Assets)</h3>
        <div style="overflow-x:auto"><table class="ast-tbl">
          <thead><tr><th>Asset</th><th>Tag</th><th>Category</th><th>Purchase</th><th>Current</th><th>Depreciated</th><th>Progress</th><th>Useful Life</th></tr></thead>
          <tbody>${depRows || '<tr><td colspan="8" class="muted" style="text-align:center;padding:20px">No depreciating assets.</td></tr>'}</tbody>
        </table></div>
      </div>
    </div>`;
    res.send(renderPage('Asset Reports', html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 14: GET /assets/report/export — Export CSV
  // ════════════════════════════════════════════════════════════
  app.get('/assets/report/export', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const assets = (await pool.query(
      `SELECT asset_tag, name, category, serial_number, description, purchase_date,
        purchase_price, current_value, depreciation_rate, location, department,
        assigned_to, status, warranty_expiry, next_maintenance, notes
       FROM assets WHERE tenant_id=$1 ORDER BY name`, [tid])).rows;

    const headers = ['Asset Tag', 'Name', 'Category', 'Serial Number', 'Description', 'Purchase Date',
      'Purchase Price', 'Current Value', 'Depreciation Rate', 'Location', 'Department',
      'Assigned To', 'Status', 'Warranty Expiry', 'Next Maintenance', 'Notes'];
    const escapeCsv = (v) => {
      const s = String(v === null || v === undefined ? '' : v);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"';
      return s;
    };
    const csvRows = [headers.join(',')];
    for (const a of assets) {
      csvRows.push([a.asset_tag, a.name, a.category, a.serial_number, a.description,
        a.purchase_date, a.purchase_price, a.current_value, a.depreciation_rate,
        a.location, a.department, a.assigned_to, a.status, a.warranty_expiry,
        a.next_maintenance, a.notes
      ].map(escapeCsv).join(','));
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=assets-export-' + new Date().toISOString().slice(0, 10) + '.csv');
    res.send(csvRows.join('\n'));
  }));

  console.log('[Assets] Asset tracker loaded');
};
