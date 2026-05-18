// ============================================================
// INVENTORY PRO MODULE — Advanced Inventory Management
// Multi-tenant SaaS: CRUD, stock movements, transfers,
// categories, reports, CSV export, color-coded levels.
// ============================================================
// Usage in server.js:
//   const inventoryPro = require('./inventory-pro');
//   inventoryPro(app, db, pool, renderPage, esc);
// ============================================================

'use strict';

module.exports = function inventoryPro(app, db, pool, renderPage, esc) {

  // ── inline fallbacks ──────────────────────────────────────
  if (!esc) esc = (s) => String(s === null || s === undefined ? '' : (typeof s === 'object' ? JSON.stringify(s) : s)).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const requireAuth = (req, res, next) => { if (!req.session || !req.session.user) return res.redirect('/login'); next(); };
  const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  // -- subscription gate --------------------------------------------------
  const _PLAN_LEVELS = { free: 0, basic: 1, pro: 2 };
  const _SUB_PAGE = '<div style="max-width:600px;margin:60px auto;text-align:center"><h2>Subscription Required</h2><p>This feature requires a paid subscription.</p><a href="/billing" style="padding:12px 24px;background:#f59e0b;color:white;text-decoration:none;border-radius:8px;font-weight:700">Subscribe Now</a></div>';
  const requireSubscription = (minPlan) => async (req, res, next) => {
    if (req.session?.user?.role === 'super_admin') return next();
    try {
      const sub = await pool.query("SELECT plan FROM subscriptions WHERE tenant_id=$1 AND status='active'", [req.session.user.tenant_id]);
      const plan = sub.rows[0]?.plan || 'free';
      if ((_PLAN_LEVELS[plan] || 0) < (_PLAN_LEVELS[minPlan] || 0)) return res.send(_SUB_PAGE);
    } catch (e) { /* allow through on DB error */ }
    next();
  };
  const fmtNum = (n) => Number(n || 0).toLocaleString();
  const fmtMoney = (n) => '$' + Number(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

  function stockBadge(qty, reorder) {
    if (!qty || qty <= 0) return '<span class="badge badge-warning" style="background:#fee2e2;color:#dc2626">Out of Stock</span>';
    if (reorder && qty <= reorder) return '<span class="badge badge-warning" style="background:#fef3c7;color:#b45309">Low Stock</span>';
    return '<span class="badge badge-success">In Stock</span>';
  }

  function movementBadge(type) {
    const map = { stock_in: { bg: '#dcfce7', c: '#16a34a', l: 'Stock In' }, stock_out: { bg: '#fee2e2', c: '#dc2626', l: 'Stock Out' }, adjustment: { bg: '#fef3c7', c: '#b45309', l: 'Adjustment' }, transfer_in: { bg: '#dbeafe', c: '#2563eb', l: 'Transfer In' }, transfer_out: { bg: '#ede9fe', c: '#7c3aed', l: 'Transfer Out' } };
    const s = map[type] || map.adjustment;
    return `<span style="display:inline-block;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:600;background:${s.bg};color:${s.c}">${s.l}</span>`;
  }

  // ── CSS ───────────────────────────────────────────────────
  const INV_CSS = `<style>
.inv-nav{display:flex;gap:6px;margin-bottom:20px;flex-wrap:wrap}
.inv-nav a{padding:8px 16px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#475569;background:#f1f5f9;transition:.15s}
.inv-nav a:hover{background:#e2e8f0}.inv-nav a.active{background:#4f46e5;color:#fff}
.inv-filter{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:end}
.inv-filter label{display:block;font-size:12px;font-weight:600;color:#64748b;margin-bottom:4px}
.inv-filter input,.inv-filter select{padding:9px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px;background:#fff}
.inv-filter input:focus,.inv-filter select:focus{outline:none;border-color:#6366f1}
.inv-tbl{width:100%;border-collapse:collapse;font-size:13px}
.inv-tbl th{padding:11px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#f8fafc}
.inv-tbl td{padding:10px 14px;border-bottom:1px solid #f1f5f9;color:#1e293b}
.inv-tbl tr:hover{background:#f8fafc}
.timeline{position:relative;padding-left:24px;margin:16px 0}
.timeline::before{content:'';position:absolute;left:8px;top:0;bottom:0;width:2px;background:#e2e8f0}
.timeline-item{position:relative;margin-bottom:16px;padding:12px 16px;background:#f8fafc;border-radius:10px;border-left:3px solid #cbd5e1}
.timeline-item.stock_in{border-left-color:#22c55e}.timeline-item.stock_out{border-left-color:#ef4444}
.timeline-item.adjustment{border-left-color:#f59e0b}.timeline-item.transfer_in{border-left-color:#3b82f6}
.timeline-item.transfer_out{border-left-color:#8b5cf6}
.timeline-item::before{content:'';position:absolute;left:-29px;top:16px;width:10px;height:10px;border-radius:50%;background:#94a3b8;border:2px solid #fff}
.timeline-item.stock_in::before{background:#22c55e}.timeline-item.stock_out::before{background:#ef4444}
.timeline-item.adjustment::before{background:#f59e0b}
.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.form-grid .full{grid-column:1/-1}
@media(max-width:768px){.form-grid{grid-template-columns:1fr}.inv-filter{flex-direction:column}}
</style>`;

  // ── MIGRATIONS ────────────────────────────────────────────
  const migrations = [
    `CREATE TABLE IF NOT EXISTS inventory_items (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL, sku VARCHAR(50) UNIQUE, barcode VARCHAR(100),
      category VARCHAR(100), description TEXT, unit VARCHAR(20) DEFAULT 'pcs',
      cost_price NUMERIC(12,2) DEFAULT 0, selling_price NUMERIC(12,2) DEFAULT 0,
      quantity INTEGER DEFAULT 0, reorder_level INTEGER DEFAULT 10,
      max_stock INTEGER DEFAULT 0, warehouse_location VARCHAR(100),
      supplier VARCHAR(255), image_url TEXT, is_active BOOLEAN DEFAULT true,
      tags TEXT[], metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS stock_movements (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
      movement_type VARCHAR(20) NOT NULL, quantity INTEGER NOT NULL,
      reference VARCHAR(100), notes TEXT, previous_qty INTEGER,
      new_qty INTEGER, performed_by INTEGER REFERENCES users(id),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS inventory_categories (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      name VARCHAR(100) NOT NULL, description TEXT, parent_id INTEGER REFERENCES inventory_categories(id),
      color VARCHAR(20) DEFAULT '#3b82f6', is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    // ALTER TABLE IF NOT EXISTS — all columns
    ...[
      `ALTER TABLE IF EXISTS inventory_items ADD COLUMN IF NOT EXISTS sku VARCHAR(50)`,
      `ALTER TABLE IF EXISTS inventory_items ADD COLUMN IF NOT EXISTS barcode VARCHAR(100)`,
      `ALTER TABLE IF EXISTS inventory_items ADD COLUMN IF NOT EXISTS category VARCHAR(100)`,
      `ALTER TABLE IF EXISTS inventory_items ADD COLUMN IF NOT EXISTS description TEXT`,
      `ALTER TABLE IF EXISTS inventory_items ADD COLUMN IF NOT EXISTS unit VARCHAR(20) DEFAULT 'pcs'`,
      `ALTER TABLE IF EXISTS inventory_items ADD COLUMN IF NOT EXISTS cost_price NUMERIC(12,2) DEFAULT 0`,
      `ALTER TABLE IF EXISTS inventory_items ADD COLUMN IF NOT EXISTS selling_price NUMERIC(12,2) DEFAULT 0`,
      `ALTER TABLE IF EXISTS inventory_items ADD COLUMN IF NOT EXISTS quantity INTEGER DEFAULT 0`,
      `ALTER TABLE IF EXISTS inventory_items ADD COLUMN IF NOT EXISTS reorder_level INTEGER DEFAULT 10`,
      `ALTER TABLE IF EXISTS inventory_items ADD COLUMN IF NOT EXISTS max_stock INTEGER DEFAULT 0`,
      `ALTER TABLE IF EXISTS inventory_items ADD COLUMN IF NOT EXISTS warehouse_location VARCHAR(100)`,
      `ALTER TABLE IF EXISTS inventory_items ADD COLUMN IF NOT EXISTS supplier VARCHAR(255)`,
      `ALTER TABLE IF EXISTS inventory_items ADD COLUMN IF NOT EXISTS image_url TEXT`,
      `ALTER TABLE IF EXISTS inventory_items ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true`,
      `ALTER TABLE IF EXISTS inventory_items ADD COLUMN IF NOT EXISTS tags TEXT[]`,
      `ALTER TABLE IF EXISTS inventory_items ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'`,
      `ALTER TABLE IF EXISTS inventory_items ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`,
      `ALTER TABLE IF EXISTS inventory_items ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`,
      `ALTER TABLE IF EXISTS stock_movements ADD COLUMN IF NOT EXISTS reference VARCHAR(100)`,
      `ALTER TABLE IF EXISTS stock_movements ADD COLUMN IF NOT EXISTS notes TEXT`,
      `ALTER TABLE IF EXISTS stock_movements ADD COLUMN IF NOT EXISTS previous_qty INTEGER`,
      `ALTER TABLE IF EXISTS stock_movements ADD COLUMN IF NOT EXISTS new_qty INTEGER`,
      `ALTER TABLE IF EXISTS inventory_categories ADD COLUMN IF NOT EXISTS color VARCHAR(20) DEFAULT '#3b82f6'`,
      `ALTER TABLE IF EXISTS inventory_categories ADD COLUMN IF NOT EXISTS parent_id INTEGER`
    ],
    // Indexes)
    `CREATE INDEX IF NOT EXISTS idx_inv_items_tenant ON inventory_items(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_inv_items_sku ON inventory_items(sku)`,
    `CREATE INDEX IF NOT EXISTS idx_inv_items_category ON inventory_items(category)`,
    `CREATE INDEX IF NOT EXISTS idx_inv_items_active ON inventory_items(tenant_id, is_active)`,
    `CREATE INDEX IF NOT EXISTS idx_stock_mov_tenant ON stock_movements(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_stock_mov_item ON stock_movements(item_id)`,
    `CREATE INDEX IF NOT EXISTS idx_stock_mov_type ON stock_movements(movement_type)`,
    `CREATE INDEX IF NOT EXISTS idx_stock_mov_created ON stock_movements(created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_inv_cat_tenant ON inventory_categories(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_inv_cat_parent ON inventory_categories(parent_id)`
  ];

  (async () => {
    const client = await pool.connect().catch(() => null);
    if (!client) { console.error('[Inventory] Cannot connect to DB for migrations'); return; }
    try { for (const sql of migrations) await client.query(sql); console.log('[Inventory] Migrations applied: ' + migrations.length + ' statements'); }
    catch (e) { console.error('[Inventory] Migration error:', e.message); }
    finally { client.release(); }
  })();

  // ── helper: render with nav ───────────────────────────────
  function nav(active) {
    const links = [
      ['/', 'Dashboard'], ['/inventory/new', 'Add Item'], ['/inventory/categories', 'Categories'],
      ['/inventory/stock-transfer', 'Transfer'], ['/inventory/report', 'Reports'],
      ['/inventory/report/export', 'Export CSV']
    ];
    return '<div class="inv-nav">' + links.map(([href, label]) =>
      `<a href="${href}" class="${active === href ? 'active' : ''}">${label}</a>`).join('') + '</div>';
  }

  // ════════════════════════════════════════════════════════════
  // ROUTE 1: GET /inventory — Dashboard
  // ════════════════════════════════════════════════════════════
  app.get('/inventory', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { q, category, sort, status } = req.query;

    // Stats
    const stats = (await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE is_active) as total_items,
        COUNT(*) FILTER (WHERE is_active AND quantity <= reorder_level AND quantity > 0) as low_stock,
        COUNT(*) FILTER (WHERE is_active AND quantity <= 0) as out_of_stock,
        COALESCE(SUM(selling_price * quantity) FILTER (WHERE is_active), 0) as total_value,
        COALESCE(SUM(cost_price * quantity) FILTER (WHERE is_active), 0) as total_cost,
        (SELECT COUNT(*) FROM stock_movements WHERE tenant_id=$1 AND created_at >= date_trunc('day', NOW())) as movements_today
      FROM inventory_items WHERE tenant_id=$1`, [tid])).rows[0];

    // Items with filters
    let where = ['i.tenant_id=$1'], params = [tid], pi = 2;
    if (q) { where.push(`(i.name ILIKE $${pi} OR i.sku ILIKE $${pi} OR i.barcode ILIKE $${pi})`); params.push('%' + q + '%'); pi++; }
    if (category) { where.push(`i.category=$${pi}`); params.push(category); pi++; }
    if (status === 'low') { where.push(`i.quantity <= i.reorder_level AND i.quantity > 0`); }
    else if (status === 'out') { where.push(`i.quantity <= 0`); }
    else if (status === 'over') { where.push(`i.quantity > i.max_stock AND i.max_stock > 0`); }

    const orderBy = { name: 'i.name', qty_asc: 'i.quantity ASC', qty_desc: 'i.quantity DESC', value: '(i.selling_price * i.quantity) DESC', created: 'i.created_at DESC' };
    const orderSql = orderBy[sort] || orderBy.created;
    const items = (await pool.query(
      `SELECT i.* FROM inventory_items i WHERE ${where.join(' AND ')} AND i.is_active ORDER BY ${orderSql} LIMIT 100`, params
    )).rows;
    const categories = (await pool.query('SELECT DISTINCT name FROM inventory_categories WHERE tenant_id=$1 AND is_active ORDER BY name', [tid])).rows;

    const rows = items.map(i => `<tr>
      <td><a href="/inventory/${i.id}" style="color:#4f46e5;text-decoration:none;font-weight:600">${esc(i.name)}</a></td>
      <td style="font-family:monospace;font-size:12px;color:#64748b">${esc(i.sku || '—')}</td>
      <td>${esc(i.category || '—')}</td>
      <td><strong>${fmtNum(i.quantity)}</strong> ${esc(i.unit)}</td>
      <td>${stockBadge(i.quantity, i.reorder_level)}</td>
      <td>${fmtMoney(i.cost_price)}</td>
      <td>${fmtMoney(i.selling_price)}</td>
      <td>${fmtMoney(i.selling_price * i.quantity)}</td>
      <td>
        <a href="/inventory/${i.id}" class="btn btn-sm btn-blue">View</a>
        <a href="/inventory/${i.id}/edit" class="btn btn-sm btn-gold">Edit</a>
      </td>
    </tr>`).join('');

    const html = INV_CSS + `
    <div style="max-width:1200px;margin:0 auto">
      ${nav('/')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">📦 Inventory Management</h1>
        <p style="font-size:13px;color:#94a3b8;margin-top:2px">Track stock, movements, and values</p></div>
        <div style="display:flex;gap:8px">
          <a href="/inventory/new" class="btn btn-green">+ Add Item</a>
          <a href="/inventory/report/export" class="btn btn-blue">📥 Export CSV</a>
        </div>
      </div>
      <div class="stats">
        <div class="stat-card"><div class="stat-num" style="color:#4f46e5">${stats.total_items}</div><div style="font-size:12px;color:#94a3b8;margin-top:2px">Total Items</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${stats.low_stock + stats.out_of_stock}</div><div style="font-size:12px;color:#94a3b8;margin-top:2px">Low / Out of Stock</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#059669">${fmtMoney(stats.total_value)}</div><div style="font-size:12px;color:#94a3b8;margin-top:2px">Total Value (Sell)</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#0891b2">${stats.movements_today}</div><div style="font-size:12px;color:#94a3b8;margin-top:2px">Movements Today</div></div>
      </div>
      <div class="card">
        <form method="GET" action="/inventory" class="inv-filter">
          <div><label>Search</label><input type="text" name="q" value="${esc(q || '')}" placeholder="Name, SKU, Barcode..."></div>
          <div><label>Category</label><select name="category"><option value="">All Categories</option>${categories.map(c => `<option value="${esc(c.name)}" ${category === c.name ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
          <div><label>Status</label><select name="status"><option value="">All</option><option value="low" ${status === 'low' ? 'selected' : ''}>Low Stock</option><option value="out" ${status === 'out' ? 'selected' : ''}>Out of Stock</option><option value="over" ${status === 'over' ? 'selected' : ''}>Overstocked</option></select></div>
          <div><label>Sort</label><select name="sort"><option value="created" ${sort === 'created' ? 'selected' : ''}>Newest</option><option value="name" ${sort === 'name' ? 'selected' : ''}>Name</option><option value="qty_desc" ${sort === 'qty_desc' ? 'selected' : ''}>Qty (High)</option><option value="qty_asc" ${sort === 'qty_asc' ? 'selected' : ''}>Qty (Low)</option><option value="value" ${sort === 'value' ? 'selected' : ''}>Value</option></select></div>
          <button type="submit" class="btn btn-sm btn-blue">Search</button>
        </form>
        <div style="overflow-x:auto"><table class="inv-tbl">
          <thead><tr><th>Item</th><th>SKU</th><th>Category</th><th>Quantity</th><th>Status</th><th>Cost</th><th>Price</th><th>Value</th><th>Actions</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="9" style="text-align:center;color:#94a3b8;padding:40px">No items found. <a href="/inventory/new" style="color:#4f46e5">Add your first item</a>.</td></tr>'}</tbody>
        </table></div>
      </div>
    </div>`;
    res.send(renderPage('Inventory Dashboard', html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 2: GET /inventory/new — Add Item Form
  // ════════════════════════════════════════════════════════════
  app.get('/inventory/new', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const cats = (await pool.query('SELECT * FROM inventory_categories WHERE tenant_id=$1 AND is_active ORDER BY name', [tid])).rows;
    const html = INV_CSS + `
    <div style="max-width:800px;margin:0 auto">
      ${nav('/inventory/new')}
      <a href="/inventory" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Inventory</a>
      <div class="card" style="padding:24px">
        <h2 style="color:#1e293b;margin-bottom:4px">📦 Add New Item</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Create a new inventory item with pricing and stock details</p>
        <form method="POST" action="/inventory/create" class="form-grid">
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Item Name *</label>
            <input type="text" name="name" required style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px" placeholder="e.g. Widget Pro X1"></div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">SKU</label>
            <input type="text" name="sku" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px" placeholder="e.g. WP-X1-001"></div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Barcode</label>
            <input type="text" name="barcode" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px" placeholder="e.g. 8901234567890"></div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Category</label>
            <select name="category" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px">
              <option value="">Select category...</option>${cats.map(c => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('')}</select></div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Unit</label>
            <select name="unit" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px">
              <option value="pcs">Pieces (pcs)</option><option value="kg">Kilograms (kg)</option><option value="litre">Litres</option>
              <option value="meter">Meters</option><option value="box">Boxes</option><option value="pack">Packs</option></select></div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Supplier</label>
            <input type="text" name="supplier" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px" placeholder="Supplier name"></div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Cost Price ($)</label>
            <input type="number" name="cost_price" step="0.01" min="0" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px" value="0"></div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Selling Price ($)</label>
            <input type="number" name="selling_price" step="0.01" min="0" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px" value="0"></div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Initial Quantity</label>
            <input type="number" name="quantity" min="0" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px" value="0"></div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Reorder Level</label>
            <input type="number" name="reorder_level" min="0" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px" value="10"></div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Max Stock</label>
            <input type="number" name="max_stock" min="0" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px" value="0"></div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Warehouse Location</label>
            <input type="text" name="warehouse_location" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px" placeholder="e.g. Aisle 3, Shelf B"></div>
          <div class="full"><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Description</label>
            <textarea name="description" rows="3" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;resize:vertical" placeholder="Optional item description..."></textarea></div>
          <div class="full" style="display:flex;gap:10px;margin-top:8px">
            <button type="submit" class="btn btn-green" style="padding:12px 28px">💾 Save Item</button>
            <a href="/inventory" class="btn" style="padding:12px 28px;background:#f1f5f9;color:#475569;text-decoration:none">Cancel</a>
          </div>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Add Inventory Item', html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 3: POST /inventory/create
  // ════════════════════════════════════════════════════════════
  app.post('/inventory/create', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { name, sku, barcode, category, description, unit, cost_price, selling_price,
      quantity, reorder_level, max_stock, warehouse_location, supplier, tags } = req.body;
    if (!name || !name.trim()) return res.send('<div class="alert">Item name is required.</div><a href="/inventory/new" class="btn btn-blue">Back</a>');
    const result = await pool.query(
      `INSERT INTO inventory_items (tenant_id, name, sku, barcode, category, description, unit,
        cost_price, selling_price, quantity, reorder_level, max_stock, warehouse_location, supplier, tags)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
      [tid, name.trim(), (sku || '').trim() || null, (barcode || '').trim() || null,
        (category || '').trim() || null, (description || '').trim() || null,
        unit || 'pcs', parseFloat(cost_price) || 0, parseFloat(selling_price) || 0,
        parseInt(quantity) || 0, parseInt(reorder_level) || 10, parseInt(max_stock) || 0,
        (warehouse_location || '').trim() || null, (supplier || '').trim() || null,
        tags ? (Array.isArray(tags) ? tags : [tags]) : null]
    );
    if (parseInt(quantity) > 0) {
      await pool.query(
        `INSERT INTO stock_movements (tenant_id, item_id, movement_type, quantity, reference, notes, previous_qty, new_qty, performed_by)
         VALUES ($1,$2,'stock_in',$3,$4,$5,$6,$7,$8)`,
        [tid, result.rows[0].id, parseInt(quantity), 'INITIAL', 'Initial stock', 0, parseInt(quantity), user.id]);
    }
    res.redirect('/inventory');
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 4: GET /inventory/:id — Item Detail
  // ════════════════════════════════════════════════════════════
  app.get('/inventory/:id', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, id = req.params.id;
    const item = (await pool.query('SELECT * FROM inventory_items WHERE id=$1 AND tenant_id=$2', [id, tid])).rows[0];
    if (!item) return res.send('<div class="alert">Item not found.</div><a href="/inventory" class="btn btn-blue">Back</a>');

    const movements = (await pool.query(
      `SELECT sm.*, u.name as performer FROM stock_movements sm LEFT JOIN users u ON u.id=sm.performed_by
       WHERE sm.item_id=$1 AND sm.tenant_id=$2 ORDER BY sm.created_at DESC LIMIT 50`, [id, tid])).rows;

    const timelineHtml = movements.map(m => `
      <div class="timeline-item ${m.movement_type}">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px">
          <div>${movementBadge(m.movement_type)} <strong style="color:#1e293b">${fmtNum(Math.abs(m.quantity))} ${esc(item.unit)}</strong>
            ${m.reference ? `<span class="muted" style="font-size:12px;margin-left:8px">Ref: ${esc(m.reference)}</span>` : ''}</div>
          <span class="muted" style="font-size:12px">${fmtDateTime(m.created_at)}</span>
        </div>
        <div style="font-size:12px;color:#64748b;margin-top:4px">
          ${m.previous_qty !== null ? `${m.previous_qty} → <strong style="color:#1e293b">${m.new_qty}</strong> ${esc(item.unit)}` : ''}
          ${m.notes ? ` · ${esc(m.notes)}` : ''}
          ${m.performer ? ` · by ${esc(m.performer)}` : ''}
        </div>
      </div>`).join('');

    const stockPct = item.max_stock > 0 ? Math.min(100, Math.round((item.quantity / item.max_stock) * 100)) : null;
    const barColor = !item.quantity || item.quantity <= 0 ? '#dc2626' : (item.reorder_level && item.quantity <= item.reorder_level ? '#f59e0b' : '#22c55e');

    const html = INV_CSS + `
    <div style="max-width:1000px;margin:0 auto">
      ${nav('/')}
      <a href="/inventory" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Inventory</a>
      <div class="card" style="padding:24px;margin-bottom:20px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px">
          <div>
            <h2 style="color:#1e293b;margin-bottom:4px">📦 ${esc(item.name)}</h2>
            <p class="muted" style="font-size:13px">SKU: <strong>${esc(item.sku || 'N/A')}</strong> · Category: ${esc(item.category || 'N/A')} · Supplier: ${esc(item.supplier || 'N/A')}</p>
          </div>
          <div style="display:flex;gap:8px">
            <a href="/inventory/${id}/edit" class="btn btn-gold">✏️ Edit</a>
            <a href="/inventory/stock-transfer?from_id=${id}" class="btn btn-blue">↔ Transfer</a>
          </div>
        </div>
        ${item.description ? `<p style="color:#475569;font-size:14px;margin-top:12px">${esc(item.description)}</p>` : ''}
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:14px;margin-top:20px">
          <div style="background:#f8fafc;padding:14px;border-radius:10px;text-align:center">
            <div style="font-size:28px;font-weight:800;color:${barColor}">${fmtNum(item.quantity)}</div>
            <div style="font-size:12px;color:#94a3b8">${esc(item.unit)} in stock</div>
            ${stockPct !== null ? `<div style="margin-top:8px;height:6px;background:#e2e8f0;border-radius:3px;overflow:hidden"><div style="height:100%;width:${stockPct}%;background:${barColor};border-radius:3px;transition:.3s"></div></div><div class="muted" style="font-size:11px">${stockPct}% of max (${item.max_stock})</div>` : ''}
          </div>
          <div style="background:#f8fafc;padding:14px;border-radius:10px;text-align:center">
            <div style="font-size:20px;font-weight:800;color:#1e293b">${fmtMoney(item.cost_price)}</div>
            <div style="font-size:12px;color:#94a3b8">Cost Price</div>
          </div>
          <div style="background:#f8fafc;padding:14px;border-radius:10px;text-align:center">
            <div style="font-size:20px;font-weight:800;color:#059669">${fmtMoney(item.selling_price)}</div>
            <div style="font-size:12px;color:#94a3b8">Selling Price</div>
          </div>
          <div style="background:#f8fafc;padding:14px;border-radius:10px;text-align:center">
            <div style="font-size:20px;font-weight:800;color:#4f46e5">${fmtMoney(item.selling_price * item.quantity)}</div>
            <div style="font-size:12px;color:#94a3b8">Total Value</div>
          </div>
          <div style="background:#f8fafc;padding:14px;border-radius:10px;text-align:center">
            <div style="font-size:16px;font-weight:800;color:#1e293b">${esc(item.warehouse_location || 'N/A')}</div>
            <div style="font-size:12px;color:#94a3b8">Location</div>
          </div>
          <div style="background:#f8fafc;padding:14px;border-radius:10px;text-align:center">
            ${stockBadge(item.quantity, item.reorder_level)}
            <div style="font-size:12px;color:#94a3b8;margin-top:6px">Reorder at: ${fmtNum(item.reorder_level)}</div>
          </div>
        </div>
        <div style="margin-top:20px;display:flex;gap:8px">
          <form method="POST" action="/inventory/${id}/stock-in" style="display:inline-flex;gap:6px">
            <input type="number" name="qty" value="1" min="1" required style="width:70px;padding:6px 10px;border:2px solid #e2e8f0;border-radius:8px;font-size:13px">
            <input type="text" name="ref" placeholder="Ref (optional)" style="width:120px;padding:6px 10px;border:2px solid #e2e8f0;border-radius:8px;font-size:13px">
            <button type="submit" class="btn btn-sm btn-green">📥 Stock In</button>
          </form>
          <form method="POST" action="/inventory/${id}/stock-out" style="display:inline-flex;gap:6px">
            <input type="number" name="qty" value="1" min="1" required style="width:70px;padding:6px 10px;border:2px solid #e2e8f0;border-radius:8px;font-size:13px">
            <input type="text" name="ref" placeholder="Ref (optional)" style="width:120px;padding:6px 10px;border:2px solid #e2e8f0;border-radius:8px;font-size:13px">
            <button type="submit" class="btn btn-sm btn-red">📤 Stock Out</button>
          </form>
        </div>
      </div>
      <div class="card" style="padding:24px">
        <h3 style="color:#1e293b;margin-bottom:12px">📊 Stock Movement History</h3>
        ${timelineHtml || '<p class="muted" style="text-align:center;padding:20px">No movements recorded yet.</p>'}
      </div>
    </div>`;
    res.send(renderPage('Item: ' + item.name, html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 5: GET /inventory/:id/edit
  // ════════════════════════════════════════════════════════════
  app.get('/inventory/:id/edit', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, id = req.params.id;
    const item = (await pool.query('SELECT * FROM inventory_items WHERE id=$1 AND tenant_id=$2', [id, tid])).rows[0];
    if (!item) return res.send('<div class="alert">Item not found.</div><a href="/inventory" class="btn btn-blue">Back</a>');
    const cats = (await pool.query('SELECT * FROM inventory_categories WHERE tenant_id=$1 AND is_active ORDER BY name', [tid])).rows;
    const fld = (label, name, type, val) => `<div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">${label}</label>
      <input type="${type}" name="${name}" value="${esc(String(val || ''))}" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px"></div>`;

    const html = INV_CSS + `
    <div style="max-width:800px;margin:0 auto">
      ${nav('/')}
      <a href="/inventory/${id}" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Item</a>
      <div class="card" style="padding:24px">
        <h2 style="color:#1e293b;margin-bottom:20px">✏️ Edit: ${esc(item.name)}</h2>
        <form method="POST" action="/inventory/${id}/update" class="form-grid">
          ${fld('Item Name *', 'name', 'text', item.name)}
          ${fld('SKU', 'sku', 'text', item.sku)}
          ${fld('Barcode', 'barcode', 'text', item.barcode)}
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Category</label>
            <select name="category" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px">
              <option value="">None</option>${cats.map(c => `<option value="${esc(c.name)}" ${item.category === c.name ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
          ${fld('Unit', 'unit', 'text', item.unit)}
          ${fld('Supplier', 'supplier', 'text', item.supplier)}
          ${fld('Cost Price ($)', 'cost_price', 'number', item.cost_price)}
          ${fld('Selling Price ($)', 'selling_price', 'number', item.selling_price)}
          ${fld('Reorder Level', 'reorder_level', 'number', item.reorder_level)}
          ${fld('Max Stock', 'max_stock', 'number', item.max_stock)}
          ${fld('Warehouse Location', 'warehouse_location', 'text', item.warehouse_location)}
          <div class="full"><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Description</label>
            <textarea name="description" rows="3" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;resize:vertical">${esc(item.description || '')}</textarea></div>
          <div class="full" style="display:flex;gap:10px;margin-top:8px">
            <button type="submit" class="btn btn-green" style="padding:12px 28px">💾 Update Item</button>
            <a href="/inventory/${id}" class="btn" style="padding:12px 28px;background:#f1f5f9;color:#475569;text-decoration:none">Cancel</a>
          </div>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Edit Item: ' + item.name, html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 6: POST /inventory/:id/update
  // ════════════════════════════════════════════════════════════
  app.post('/inventory/:id/update', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, id = req.params.id;
    const { name, sku, barcode, category, description, unit, cost_price, selling_price,
      reorder_level, max_stock, warehouse_location, supplier } = req.body;
    if (!name || !name.trim()) return res.send('<div class="alert">Item name is required.</div><a href="javascript:history.back()" class="btn btn-blue">Back</a>');
    await pool.query(
      `UPDATE inventory_items SET name=$1, sku=$2, barcode=$3, category=$4, description=$5,
        unit=$6, cost_price=$7, selling_price=$8, reorder_level=$9, max_stock=$10,
        warehouse_location=$11, supplier=$12, updated_at=NOW()
       WHERE id=$13 AND tenant_id=$14`,
      [name.trim(), (sku || '').trim() || null, (barcode || '').trim() || null,
        (category || '').trim() || null, (description || '').trim() || null,
        unit || 'pcs', parseFloat(cost_price) || 0, parseFloat(selling_price) || 0,
        parseInt(reorder_level) || 10, parseInt(max_stock) || 0,
        (warehouse_location || '').trim() || null, (supplier || '').trim() || null, id, tid]
    );
    res.redirect('/inventory/' + id);
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 7: DELETE /inventory/:id
  // ════════════════════════════════════════════════════════════
  app.delete('/inventory/:id', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, id = req.params.id;
    const item = (await pool.query('SELECT id, name FROM inventory_items WHERE id=$1 AND tenant_id=$2', [id, tid])).rows[0];
    if (!item) return res.json({ ok: false, error: 'Not found' });
    await pool.query('DELETE FROM stock_movements WHERE item_id=$1 AND tenant_id=$2', [id, tid]);
    await pool.query('DELETE FROM inventory_items WHERE id=$1 AND tenant_id=$2', [id, tid]);
    res.json({ ok: true, message: 'Item deleted' });
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 8: POST /inventory/:id/stock-in
  // ════════════════════════════════════════════════════════════
  app.post('/inventory/:id/stock-in', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, id = req.params.id;
    const qty = parseInt(req.body.qty) || 0, ref = (req.body.ref || '').trim();
    if (qty <= 0) return res.redirect('/inventory/' + id);
    const item = (await pool.query('SELECT quantity, unit FROM inventory_items WHERE id=$1 AND tenant_id=$2', [id, tid])).rows[0];
    if (!item) return res.send('<div class="alert">Item not found.</div>');
    const prevQty = item.quantity, newQty = prevQty + qty;
    await pool.query('UPDATE inventory_items SET quantity=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3', [newQty, id, tid]);
    await pool.query(
      `INSERT INTO stock_movements (tenant_id, item_id, movement_type, quantity, reference, notes, previous_qty, new_qty, performed_by)
       VALUES ($1,$2,'stock_in',$3,$4,$5,$6,$7,$8)`,
      [tid, id, qty, ref || 'MANUAL', 'Stock added', prevQty, newQty, user.id]
    );
    res.redirect('/inventory/' + id);
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 9: POST /inventory/:id/stock-out
  // ════════════════════════════════════════════════════════════
  app.post('/inventory/:id/stock-out', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, id = req.params.id;
    const qty = parseInt(req.body.qty) || 0, ref = (req.body.ref || '').trim();
    if (qty <= 0) return res.redirect('/inventory/' + id);
    const item = (await pool.query('SELECT quantity, unit FROM inventory_items WHERE id=$1 AND tenant_id=$2', [id, tid])).rows[0];
    if (!item) return res.send('<div class="alert">Item not found.</div>');
    if (qty > item.quantity) return res.send(`<div class="alert">Cannot remove ${qty} ${item.unit}. Only ${item.quantity} available.</div><a href="/inventory/${id}" class="btn btn-blue">Back</a>`);
    const prevQty = item.quantity, newQty = prevQty - qty;
    await pool.query('UPDATE inventory_items SET quantity=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3', [newQty, id, tid]);
    await pool.query(
      `INSERT INTO stock_movements (tenant_id, item_id, movement_type, quantity, reference, notes, previous_qty, new_qty, performed_by)
       VALUES ($1,$2,'stock_out',$3,$4,$5,$6,$7,$8)`,
      [tid, id, qty, ref || 'MANUAL', 'Stock removed', prevQty, newQty, user.id]
    );
    res.redirect('/inventory/' + id);
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 10: GET /inventory/stock-transfer
  // ════════════════════════════════════════════════════════════
  app.get('/inventory/stock-transfer', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { from_id } = req.query;
    const items = (await pool.query('SELECT id, name, sku, quantity, unit FROM inventory_items WHERE tenant_id=$1 AND is_active AND quantity > 0 ORDER BY name', [tid])).rows;
    const html = INV_CSS + `
    <div style="max-width:700px;margin:0 auto">
      ${nav('/inventory/stock-transfer')}
      <a href="/inventory" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Inventory</a>
      <div class="card" style="padding:24px">
        <h2 style="color:#1e293b;margin-bottom:4px">↔ Stock Transfer</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Move stock quantity between items (e.g., repackaging)</p>
        <form method="POST" action="/inventory/stock-transfer/process" class="form-grid">
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Transfer From *</label>
            <select name="from_id" required style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px">
              <option value="">Select source item...</option>
              ${items.map(i => `<option value="${i.id}" ${from_id == i.id ? 'selected' : ''}>${esc(i.name)} (${i.sku || 'no SKU'}) — ${i.quantity} ${i.unit}</option>`).join('')}</select></div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Transfer To *</label>
            <select name="to_id" required style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px">
              <option value="">Select destination item...</option>
              ${items.map(i => `<option value="${i.id}">${esc(i.name)} (${i.sku || 'no SKU'})</option>`).join('')}</select></div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Quantity *</label>
            <input type="number" name="qty" required min="1" value="1" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px"></div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Reference</label>
            <input type="text" name="reference" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px" placeholder="e.g. Repack-001"></div>
          <div class="full"><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Notes</label>
            <textarea name="notes" rows="2" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;resize:vertical" placeholder="Reason for transfer..."></textarea></div>
          <div class="full" style="margin-top:8px">
            <button type="submit" class="btn btn-green" style="padding:12px 28px">🔄 Process Transfer</button>
          </div>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Stock Transfer', html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 11: POST /inventory/stock-transfer/process
  // ════════════════════════════════════════════════════════════
  app.post('/inventory/stock-transfer/process', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { from_id, to_id, qty, reference, notes } = req.body;
    const fId = parseInt(from_id), tId = parseInt(to_id), q = parseInt(qty);
    if (!fId || !tId || fId === tId || !q || q <= 0) {
      return res.send('<div class="alert">Invalid transfer parameters. Source and destination must differ and quantity must be positive.</div><a href="/inventory/stock-transfer" class="btn btn-blue">Back</a>');
    }
    const fromItem = (await pool.query('SELECT quantity, unit FROM inventory_items WHERE id=$1 AND tenant_id=$2', [fId, tid])).rows[0];
    if (!fromItem || fromItem.quantity < q) {
      return res.send('<div class="alert">Insufficient stock. Source only has ' + (fromItem ? fromItem.quantity : 0) + ' ' + (fromItem ? fromItem.unit : '') + '.</div><a href="/inventory/stock-transfer" class="btn btn-blue">Back</a>');
    }
    const toItem = (await pool.query('SELECT quantity FROM inventory_items WHERE id=$1 AND tenant_id=$2', [tId, tid])).rows[0];
    if (!toItem) return res.send('<div class="alert">Destination item not found.</div>');
    const ref = (reference || 'TRANSFER').trim();

    // Debit source
    const prevFrom = fromItem.quantity, newFrom = prevFrom - q;
    await pool.query('UPDATE inventory_items SET quantity=$1, updated_at=NOW() WHERE id=$2', [newFrom, fId]);
    await pool.query(`INSERT INTO stock_movements (tenant_id, item_id, movement_type, quantity, reference, notes, previous_qty, new_qty, performed_by) VALUES ($1,$2,'transfer_out',$3,$4,$5,$6,$7,$8)`,
      [tid, fId, q, ref, (notes || 'Transfer to item #' + tId).trim(), prevFrom, newFrom, user.id]);

    // Credit destination
    const prevTo = toItem.quantity, newTo = prevTo + q;
    await pool.query('UPDATE inventory_items SET quantity=$1, updated_at=NOW() WHERE id=$2', [newTo, tId]);
    await pool.query(`INSERT INTO stock_movements (tenant_id, item_id, movement_type, quantity, reference, notes, previous_qty, new_qty, performed_by) VALUES ($1,$2,'transfer_in',$3,$4,$5,$6,$7,$8)`,
      [tid, tId, q, ref, (notes || 'Transfer from item #' + fId).trim(), prevTo, newTo, user.id]);

    res.redirect('/inventory/' + fId);
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 12: GET /inventory/categories — Category Management
  // ════════════════════════════════════════════════════════════
  app.get('/inventory/categories', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const categories = (await pool.query(
      `SELECT c.*, p.name as parent_name, (SELECT COUNT(*) FROM inventory_items WHERE category=c.name AND tenant_id=$1 AND is_active) as item_count
       FROM inventory_categories c LEFT JOIN inventory_categories p ON p.id=c.parent_id
       WHERE c.tenant_id=$1 ORDER BY c.name`, [tid])).rows;

    const rows = categories.map(c => `<tr>
      <td><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${esc(c.color)};margin-right:8px"></span><strong>${esc(c.name)}</strong></td>
      <td>${esc(c.parent_name || '—')}</td>
      <td>${esc(c.description || '—')}</td>
      <td><span class="badge ${c.item_count > 0 ? 'badge-success' : ''}">${c.item_count} items</span></td>
      <td style="font-size:12px;color:#94a3b8">${fmtDate(c.created_at)}</td>
      <td>${c.is_active ? '<span class="badge badge-success">Active</span>' : '<span class="badge badge-warning">Inactive</span>'}</td>
    </tr>`).join('');

    const treeRows = categories.filter(c => !c.parent_id).map(parent => {
      const children = categories.filter(c => c.parent_id === parent.id);
      const childrenHtml = children.length ? `<ul style="list-style:none;padding-left:20px;margin:4px 0">${children.map(ch => `<li style="font-size:13px;padding:2px 0">└ ${esc(ch.name)} <span class="muted">(${ch.item_count})</span></li>`).join('')}</ul>` : '';
      return `<li style="font-size:14px;padding:4px 0"><strong>${esc(parent.name)}</strong> <span class="muted">(${parent.item_count})</span>${childrenHtml}</li>`;
    }).join('');

    const html = INV_CSS + `
    <div style="max-width:1000px;margin:0 auto">
      ${nav('/inventory/categories')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">📂 Categories</h1>
        <p style="font-size:13px;color:#94a3b8;margin-top:2px">Organize inventory with hierarchical categories</p></div>
      </div>
      <div class="card" style="padding:24px;margin-bottom:20px">
        <h3 style="color:#1e293b;margin-bottom:12px">+ Add Category</h3>
        <form method="POST" action="/inventory/categories/add" class="form-grid">
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Category Name *</label>
            <input type="text" name="name" required style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px" placeholder="e.g. Electronics"></div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Parent Category</label>
            <select name="parent_id" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px">
              <option value="">None (Top Level)</option>${categories.filter(c => !c.parent_id).map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Color</label>
            <input type="color" name="color" value="#3b82f6" style="width:60px;height:40px;border:2px solid #e2e8f0;border-radius:8px;cursor:pointer"></div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Description</label>
            <input type="text" name="description" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px" placeholder="Brief description"></div>
          <div class="full"><button type="submit" class="btn btn-green" style="padding:10px 24px">💾 Save Category</button></div>
        </form>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
        <div class="card">
          <h3 style="color:#1e293b;margin-bottom:12px">Category Tree</h3>
          <ul style="list-style:none;padding:0">${treeRows || '<li class="muted" style="padding:20px;text-align:center">No categories yet</li>'}</ul>
        </div>
        <div class="card">
          <h3 style="color:#1e293b;margin-bottom:12px">All Categories</h3>
          <div style="overflow-x:auto"><table class="inv-tbl">
            <thead><tr><th>Name</th><th>Parent</th><th>Description</th><th>Items</th><th>Created</th><th>Status</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:20px">No categories</td></tr>'}</tbody>
          </table></div>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Inventory Categories', html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 13: POST /inventory/categories/add
  // ════════════════════════════════════════════════════════════
  app.post('/inventory/categories/add', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { name, parent_id, color, description } = req.body;
    if (!name || !name.trim()) return res.send('<div class="alert">Category name is required.</div><a href="/inventory/categories" class="btn btn-blue">Back</a>');
    await pool.query(
      `INSERT INTO inventory_categories (tenant_id, name, parent_id, color, description) VALUES ($1,$2,$3,$4,$5)`,
      [tid, name.trim(), parent_id ? parseInt(parent_id) : null, (color || '#3b82f6').trim(), (description || '').trim()]
    );
    res.redirect('/inventory/categories');
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 14: GET /inventory/report — Reports Dashboard
  // ════════════════════════════════════════════════════════════
  app.get('/inventory/report', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    // Stock level distribution
    const levels = (await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE quantity > reorder_level) as safe,
        COUNT(*) FILTER (WHERE quantity > 0 AND quantity <= reorder_level) as low,
        COUNT(*) FILTER (WHERE quantity <= 0) as out_of_stock,
        COUNT(*) FILTER (WHERE max_stock > 0 AND quantity > max_stock) as overstocked
      FROM inventory_items WHERE tenant_id=$1 AND is_active`, [tid])).rows[0];

    // Value by category
    const catValues = (await pool.query(`
      SELECT category, COUNT(*) as items, SUM(quantity) as total_qty,
        SUM(cost_price * quantity) as total_cost, SUM(selling_price * quantity) as total_value
      FROM inventory_items WHERE tenant_id=$1 AND is_active GROUP BY category ORDER BY total_value DESC NULLS LAST`, [tid])).rows;

    // Recent movements summary
    const movSummary = (await pool.query(`
      SELECT movement_type, COUNT(*) as cnt, SUM(ABS(quantity)) as total_qty
      FROM stock_movements WHERE tenant_id=$1 AND created_at >= NOW() - INTERVAL '30 days'
      GROUP BY movement_type ORDER BY cnt DESC`, [tid])).rows;

    // Low stock alerts
    const lowStock = (await pool.query(`
      SELECT name, sku, quantity, reorder_level, unit FROM inventory_items
      WHERE tenant_id=$1 AND is_active AND quantity <= reorder_level AND quantity > 0
      ORDER BY quantity ASC LIMIT 20`, [tid])).rows;

    // Out of stock
    const outOfStock = (await pool.query(`
      SELECT name, sku, unit FROM inventory_items
      WHERE tenant_id=$1 AND is_active AND quantity <= 0
      ORDER BY name LIMIT 20`, [tid])).rows;

    const totalValue = catValues.reduce((s, c) => s + parseFloat(c.total_value || 0), 0);
    const totalCost = catValues.reduce((s, c) => s + parseFloat(c.total_cost || 0), 0);
    const potentialProfit = totalValue - totalCost;

    const catRows = catValues.map(c => {
      const pct = totalValue > 0 ? ((parseFloat(c.total_value || 0) / totalValue) * 100).toFixed(1) : 0;
      return `<tr>
        <td>${esc(c.category || 'Uncategorized')}</td>
        <td>${c.items}</td>
        <td>${fmtNum(c.total_qty)}</td>
        <td>${fmtMoney(c.total_cost)}</td>
        <td><strong>${fmtMoney(c.total_value)}</strong></td>
        <td><div style="display:flex;align-items:center;gap:8px"><div style="width:80px;height:6px;background:#e2e8f0;border-radius:3px;overflow:hidden"><div style="height:100%;width:${pct}%;background:#4f46e5;border-radius:3px"></div></div><span class="muted" style="font-size:11px">${pct}%</span></div></td>
      </tr>`;
    }).join('');

    const lowRows = lowStock.map(i => `<tr><td>${esc(i.name)}</td><td style="font-family:monospace">${esc(i.sku || '—')}</td>
      <td style="color:#f59e0b;font-weight:700">${i.quantity}</td><td>${i.reorder_level}</td><td>${esc(i.unit)}</td></tr>`).join('');
    const outRows = outOfStock.map(i => `<tr><td>${esc(i.name)}</td><td style="font-family:monospace">${esc(i.sku || '—')}</td><td>${esc(i.unit)}</td></tr>`).join('');

    const html = INV_CSS + `
    <div style="max-width:1200px;margin:0 auto">
      ${nav('/inventory/report')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">📊 Inventory Reports</h1>
        <p style="font-size:13px;color:#94a3b8;margin-top:2px">Stock levels, values, movements, and alerts</p></div>
        <a href="/inventory/report/export" class="btn btn-blue">📥 Export Full Report (CSV)</a>
      </div>
      <div class="stats">
        <div class="stat-card"><div class="stat-num" style="color:#22c55e">${levels.safe}</div><div style="font-size:12px;color:#94a3b8;margin-top:2px">Safe Stock</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${levels.low}</div><div style="font-size:12px;color:#94a3b8;margin-top:2px">Low Stock</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#dc2626">${levels.out_of_stock}</div><div style="font-size:12px;color:#94a3b8;margin-top:2px">Out of Stock</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#059669">${fmtMoney(totalValue)}</div><div style="font-size:12px;color:#94a3b8;margin-top:2px">Total Value</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#4f46e5">${fmtMoney(potentialProfit)}</div><div style="font-size:12px;color:#94a3b8;margin-top:2px">Potential Profit</div></div>
      </div>
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:20px;margin-bottom:20px">
        <div class="card">
          <h3 style="color:#1e293b;margin-bottom:12px">💰 Value by Category</h3>
          <div style="overflow-x:auto"><table class="inv-tbl">
            <thead><tr><th>Category</th><th>Items</th><th>Total Qty</th><th>Total Cost</th><th>Total Value</th><th>Share</th></tr></thead>
            <tbody>${catRows || '<tr><td colspan="6" class="muted" style="text-align:center;padding:20px">No data</td></tr>'}</tbody>
          </table></div>
        </div>
        <div class="card">
          <h3 style="color:#1e293b;margin-bottom:12px">📈 Movements (30d)</h3>
          <div style="display:flex;flex-direction:column;gap:8px">
            ${movSummary.map(m => `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px;background:#f8fafc;border-radius:8px">${movementBadge(m.movement_type)} <span style="font-weight:700">${m.cnt}</span> <span class="muted" style="font-size:12px">${fmtNum(m.total_qty)} units</span></div>`).join('') || '<p class="muted" style="text-align:center;padding:20px">No movements</p>'}
          </div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
        <div class="card">
          <h3 style="color:#1e293b;margin-bottom:12px">⚠️ Low Stock Alerts</h3>
          <div style="overflow-x:auto"><table class="inv-tbl">
            <thead><tr><th>Item</th><th>SKU</th><th>Qty</th><th>Reorder</th><th>Unit</th></tr></thead>
            <tbody>${lowRows || '<tr><td colspan="5" class="muted" style="text-align:center;padding:16px">All stock levels OK</td></tr>'}</tbody>
          </table></div>
        </div>
        <div class="card">
          <h3 style="color:#1e293b;margin-bottom:12px">🚫 Out of Stock</h3>
          <div style="overflow-x:auto"><table class="inv-tbl">
            <thead><tr><th>Item</th><th>SKU</th><th>Unit</th></tr></thead>
            <tbody>${outRows || '<tr><td colspan="3" class="muted" style="text-align:center;padding:16px">No out-of-stock items</td></tr>'}</tbody>
          </table></div>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Inventory Reports', html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 15: GET /inventory/report/export — CSV Export
  // ════════════════════════════════════════════════════════════
  app.get('/inventory/report/export', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const items = (await pool.query(
      `SELECT name, sku, barcode, category, unit, cost_price, selling_price, quantity,
        reorder_level, max_stock, warehouse_location, supplier, is_active, created_at, updated_at
       FROM inventory_items WHERE tenant_id=$1 AND is_active ORDER BY name`, [tid])).rows;

    const headers = ['Name', 'SKU', 'Barcode', 'Category', 'Unit', 'Cost Price', 'Selling Price', 'Quantity', 'Reorder Level', 'Max Stock', 'Total Value', 'Location', 'Supplier', 'Active', 'Created At', 'Updated At'];
    const csvRows = items.map(i => [
      i.name, i.sku || '', i.barcode || '', i.category || '', i.unit || 'pcs',
      i.cost_price, i.selling_price, i.quantity, i.reorder_level, i.max_stock,
      (i.selling_price * i.quantity).toFixed(2), i.warehouse_location || '', i.supplier || '',
      i.is_active ? 'Yes' : 'No', i.created_at, i.updated_at
    ].map(v => '"' + String(v === null || v === undefined ? '' : v).replace(/"/g, '""') + '"').join(','));

    const csv = [headers.map(h => '"' + h + '"').join(','), ...csvRows].join('\r\n');
    const timestamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="inventory-export-${timestamp}.csv"`);
    res.send(csv);
  }));
};

console.log('[Inventory] Advanced inventory management loaded');
