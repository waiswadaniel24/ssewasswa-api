// ============================================================
// POS TERMINAL MODULE — Multi-Tenant SaaS Platform (Comfort Zone)
// Point of sale, products, cart, sales, stock management,
// reports, receipts, JSON APIs.
// ============================================================
// Usage in server.js:
//   const posTerminal = require('./pos-terminal');
//   posTerminal(app, db, pool, renderPage, esc);
// ============================================================

'use strict';

// ============================================================
// MODULE ENTRY POINT
// ============================================================
module.exports = function posTerminal(app, db, pool, renderPage, esc) {

  // -- inline helpers ---------------------------------------------------
  const requireAuth = (req, res, next) => {
    if (!req.session?.user) return res.redirect('/login');
    next();
  };

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

  if (!esc) esc = (s) => String(s == null ? '' : (typeof s === 'object' ? JSON.stringify(s) : s))
    .replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  // -- internal helpers ---------------------------------------------------
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const fmtTime = (t) => t ? String(t).substring(0, 5) : '—';
  const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const today = () => new Date().toISOString().slice(0, 10);
  const genToken = () => require('crypto').randomBytes(24).toString('hex');

  function statusBadge(s) {
    const m = {
      completed: { cls: 'badge-success', label: 'Completed' },
      pending: { cls: 'badge-warning', label: 'Pending' },
      cancelled: { cls: 'badge-error', label: 'Cancelled' },
      refunded: { cls: 'badge', label: 'Refunded', style: 'background:#fef3c7;color:#92400e' },
      in_stock: { cls: 'badge-success', label: 'In Stock' },
      low_stock: { cls: 'badge-warning', label: 'Low Stock' },
      out_of_stock: { cls: 'badge-error', label: 'Out of Stock' },
      draft: { cls: 'badge-warning', label: 'Draft' },
      active: { cls: 'badge-success', label: 'Active' },
      inactive: { cls: 'badge', label: 'Inactive' },
    };
    const v = m[s] || { cls: 'badge', label: s };
    return `<span class="badge ${v.cls}" ${v.style ? 'style="' + v.style + '"' : ''}>${v.label}</span>`;
  }

  // -- shared CSS --------------------------------------------------------
  const POS_CSS = `<style>
    .pos-nav{display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap}
    .pos-nav a{padding:8px 18px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#475569;background:#f1f5f9;transition:.15s}
    .pos-nav a:hover{background:#e2e8f0}.pos-nav a.active{background:#4f46e5;color:#fff}
    .pos-btn{display:inline-flex;align-items:center;gap:6px;padding:9px 18px;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:.15s}
    .pos-btn:hover{opacity:.9;transform:translateY(-1px)}
    .pos-btn-primary{background:#4f46e5;color:#fff}.pos-btn-success{background:#059669;color:#fff}
    .pos-btn-danger{background:#fee2e2;color:#dc2626}.pos-btn-secondary{background:#f1f5f9;color:#475569}
    .pos-btn-warning{background:#fef3c7;color:#92400e}
    .pos-table{width:100%;border-collapse:collapse;font-size:13px}
    .pos-table th{padding:11px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#f8fafc}
    .pos-table td{padding:10px 14px;border-bottom:1px solid #f1f5f9;color:#1e293b}
    .pos-table tr:hover{background:#f8fafc}
    .pos-filter{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:end}
    .pos-filter label{display:block;font-size:12px;font-weight:600;color:#64748b;margin-bottom:4px}
    .pos-filter input,.pos-filter select{padding:8px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px;background:#fff}
    .pos-filter input:focus,.pos-filter select:focus{outline:none;border-color:#6366f1}
    .pos-card{background:#fff;border-radius:14px;border:1px solid #f1f5f9;padding:20px;margin-bottom:16px}
    .pos-cart-item{display:flex;align-items:center;gap:12px;padding:10px;border-bottom:1px solid #f1f5f9}
    .pos-cart-item:last-child{border-bottom:none}
    .pos-qty-btn{width:30px;height:30px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc;cursor:pointer;font-size:16px;font-weight:700;color:#475569;display:flex;align-items:center;justify-content:center}
    .pos-qty-btn:hover{background:#e2e8f0}
    .pos-product-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px}
    .pos-product-card{border:1px solid #f1f5f9;border-radius:12px;padding:14px;cursor:pointer;transition:.15s;text-align:center}
    .pos-product-card:hover{border-color:#6366f1;box-shadow:0 2px 8px rgba(79,70,229,0.1)}
    @media(max-width:768px){.pos-nav{gap:4px}.pos-nav a{padding:6px 12px;font-size:12px}.pos-filter{flex-direction:column}}
  </style>`;

  // -- navigation helper --------------------------------------------------
  const nav = (active) => `<div class="pos-nav">
    <a href="/pos" class="${active === 'dash' ? 'active' : ''}">🏪 Dashboard</a>
    <a href="/pos/products" class="${active === 'products' ? 'active' : ''}">📦 Products</a>
    <a href="/pos/terminal" class="${active === 'terminal' ? 'active' : ''}">💳 Terminal</a>
    <a href="/pos/sales" class="${active === 'sales' ? 'active' : ''}">📊 Sales</a>
    <a href="/pos/stock" class="${active === 'stock' ? 'active' : ''}">📋 Stock</a>
    <a href="/pos/reports" class="${active === 'reports' ? 'active' : ''}">📈 Reports</a>
  </div>`;

  // ============================================================
  // DATABASE MIGRATIONS (async IIFE)
  // ============================================================
  (async () => {
    const c = await pool.connect().catch(() => null);
    if (!c) { console.error('[POS] Cannot connect to DB for migrations'); return; }
    try {
      // Ensure retail_products columns
      const rpCols = [
        { name: 'tenant_id', type: 'INTEGER NOT NULL DEFAULT 0' },
        { name: 'name', type: 'VARCHAR(255)' },
        { name: 'sku', type: 'VARCHAR(50)' },
        { name: 'barcode', type: 'VARCHAR(100)' },
        { name: 'category', type: 'VARCHAR(100)' },
        { name: 'description', type: 'TEXT' },
        { name: 'cost_price', type: 'NUMERIC(12,2) DEFAULT 0' },
        { name: 'selling_price', type: 'NUMERIC(12,2) DEFAULT 0' },
        { name: 'stock_quantity', type: 'INTEGER DEFAULT 0' },
        { name: 'min_stock_level', type: 'INTEGER DEFAULT 5' },
        { name: 'unit', type: 'VARCHAR(20) DEFAULT \'pcs\'' },
        { name: 'is_active', type: 'BOOLEAN DEFAULT true' },
        { name: 'image_url', type: 'TEXT' },
        { name: 'created_by', type: 'INTEGER' },
        { name: 'created_at', type: 'TIMESTAMPTZ DEFAULT NOW()' }
      ];
      for (const col of rpCols) { try { await c.query(`ALTER TABLE retail_products ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`); } catch(e){} }

      // Ensure retail_sales columns
      const rsCols = [
        { name: 'tenant_id', type: 'INTEGER NOT NULL DEFAULT 0' },
        { name: 'receipt_number', type: 'VARCHAR(50) UNIQUE' },
        { name: 'customer_name', type: 'VARCHAR(255)' },
        { name: 'subtotal', type: 'NUMERIC(12,2) DEFAULT 0' },
        { name: 'tax_amount', type: 'NUMERIC(12,2) DEFAULT 0' },
        { name: 'discount_amount', type: 'NUMERIC(12,2) DEFAULT 0' },
        { name: 'total_amount', type: 'NUMERIC(12,2) DEFAULT 0' },
        { name: 'payment_method', type: 'VARCHAR(50) DEFAULT \'cash\'' },
        { name: 'status', type: 'VARCHAR(20) DEFAULT \'completed\'' },
        { name: 'cashier_id', type: 'INTEGER' },
        { name: 'notes', type: 'TEXT' },
        { name: 'created_at', type: 'TIMESTAMPTZ DEFAULT NOW()' }
      ];
      for (const col of rsCols) { try { await c.query(`ALTER TABLE retail_sales ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`); } catch(e){} }

      // Ensure retail_sale_items columns
      const rsiCols = [
        { name: 'tenant_id', type: 'INTEGER NOT NULL DEFAULT 0' },
        { name: 'sale_id', type: 'INTEGER' },
        { name: 'product_id', type: 'INTEGER' },
        { name: 'product_name', type: 'VARCHAR(255)' },
        { name: 'quantity', type: 'INTEGER DEFAULT 1' },
        { name: 'unit_price', type: 'NUMERIC(12,2) DEFAULT 0' },
        { name: 'total_price', type: 'NUMERIC(12,2) DEFAULT 0' },
        { name: 'created_at', type: 'TIMESTAMPTZ DEFAULT NOW()' }
      ];
      for (const col of rsiCols) { try { await c.query(`ALTER TABLE retail_sale_items ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`); } catch(e){} }

      // Ensure stock_adjustments columns
      const saCols = [
        { name: 'tenant_id', type: 'INTEGER NOT NULL DEFAULT 0' },
        { name: 'product_id', type: 'INTEGER' },
        { name: 'product_name', type: 'VARCHAR(255)' },
        { name: 'adjustment_type', type: 'VARCHAR(20) DEFAULT \'add\'' },
        { name: 'quantity', type: 'INTEGER DEFAULT 0' },
        { name: 'reason', type: 'TEXT' },
        { name: 'performed_by', type: 'INTEGER' },
        { name: 'created_at', type: 'TIMESTAMPTZ DEFAULT NOW()' }
      ];
      for (const col of saCols) { try { await c.query(`ALTER TABLE stock_adjustments ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`); } catch(e){} }

      // Ensure stock_movements columns
      const smCols = [
        { name: 'tenant_id', type: 'INTEGER NOT NULL DEFAULT 0' },
        { name: 'product_id', type: 'INTEGER' },
        { name: 'product_name', type: 'VARCHAR(255)' },
        { name: 'movement_type', type: 'VARCHAR(20)' },
        { name: 'quantity', type: 'INTEGER DEFAULT 0' },
        { name: 'reference', type: 'VARCHAR(100)' },
        { name: 'performed_by', type: 'INTEGER' },
        { name: 'created_at', type: 'TIMESTAMPTZ DEFAULT NOW()' }
      ];
      for (const col of smCols) { try { await c.query(`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`); } catch(e){} }

      // Ensure stock_takes columns
      const stCols = [
        { name: 'tenant_id', type: 'INTEGER NOT NULL DEFAULT 0' },
        { name: 'name', type: 'VARCHAR(255)' },
        { name: 'status', type: 'VARCHAR(20) DEFAULT \'draft\'' },
        { name: 'performed_by', type: 'INTEGER' },
        { name: 'notes', type: 'TEXT' },
        { name: 'created_at', type: 'TIMESTAMPTZ DEFAULT NOW()' }
      ];
      for (const col of stCols) { try { await c.query(`ALTER TABLE stock_takes ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`); } catch(e){} }

      // Ensure stock_take_items columns
      const stiCols = [
        { name: 'tenant_id', type: 'INTEGER NOT NULL DEFAULT 0' },
        { name: 'stock_take_id', type: 'INTEGER' },
        { name: 'product_id', type: 'INTEGER' },
        { name: 'system_qty', type: 'INTEGER DEFAULT 0' },
        { name: 'actual_qty', type: 'INTEGER DEFAULT 0' },
        { name: 'difference', type: 'INTEGER DEFAULT 0' },
        { name: 'notes', type: 'TEXT' }
      ];
      for (const col of stiCols) { try { await c.query(`ALTER TABLE stock_take_items ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`); } catch(e){} }

      // Ensure stock_transfers columns
      const strCols = [
        { name: 'tenant_id', type: 'INTEGER NOT NULL DEFAULT 0' },
        { name: 'product_id', type: 'INTEGER' },
        { name: 'from_location', type: 'VARCHAR(100)' },
        { name: 'to_location', type: 'VARCHAR(100)' },
        { name: 'quantity', type: 'INTEGER DEFAULT 0' },
        { name: 'status', type: 'VARCHAR(20) DEFAULT \'pending\'' },
        { name: 'performed_by', type: 'INTEGER' },
        { name: 'notes', type: 'TEXT' },
        { name: 'created_at', type: 'TIMESTAMPTZ DEFAULT NOW()' }
      ];
      for (const col of strCols) { try { await c.query(`ALTER TABLE stock_transfers ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`); } catch(e){} }

      // Ensure school_shop_sales columns
      const sssCols = [
        { name: 'tenant_id', type: 'INTEGER NOT NULL DEFAULT 0' },
        { name: 'receipt_number', type: 'VARCHAR(50)' },
        { name: 'total_amount', type: 'NUMERIC(12,2) DEFAULT 0' },
        { name: 'payment_method', type: 'VARCHAR(50)' },
        { name: 'status', type: 'VARCHAR(20)' },
        { name: 'created_at', type: 'TIMESTAMPTZ DEFAULT NOW()' }
      ];
      for (const col of sssCols) { try { await c.query(`ALTER TABLE school_shop_sales ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`); } catch(e){} }

      // Ensure supermarket_products columns
      const spCols = [
        { name: 'tenant_id', type: 'INTEGER NOT NULL DEFAULT 0' },
        { name: 'name', type: 'VARCHAR(255)' },
        { name: 'category', type: 'VARCHAR(100)' },
        { name: 'price', type: 'NUMERIC(12,2) DEFAULT 0' },
        { name: 'stock', type: 'INTEGER DEFAULT 0' },
        { name: 'is_active', type: 'BOOLEAN DEFAULT true' },
        { name: 'created_at', type: 'TIMESTAMPTZ DEFAULT NOW()' }
      ];
      for (const col of spCols) { try { await c.query(`ALTER TABLE supermarket_products ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`); } catch(e){} }

      // Ensure supermarket_daily_sales columns
      const sdsCols = [
        { name: 'tenant_id', type: 'INTEGER NOT NULL DEFAULT 0' },
        { name: 'sale_date', type: 'DATE' },
        { name: 'total_sales', type: 'NUMERIC(14,2) DEFAULT 0' },
        { name: 'total_items', type: 'INTEGER DEFAULT 0' },
        { name: 'total_transactions', type: 'INTEGER DEFAULT 0' },
        { name: 'created_at', type: 'TIMESTAMPTZ DEFAULT NOW()' }
      ];
      for (const col of sdsCols) { try { await c.query(`ALTER TABLE supermarket_daily_sales ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`); } catch(e){} }

      // Indexes
      await c.query(`CREATE INDEX IF NOT EXISTS idx_retail_products_tenant ON retail_products(tenant_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_retail_products_sku ON retail_products(sku)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_retail_products_cat ON retail_products(category)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_retail_sales_tenant ON retail_sales(tenant_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_retail_sales_receipt ON retail_sales(receipt_number)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_retail_sales_date ON retail_sales(created_at)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_retail_sale_items_tenant ON retail_sale_items(tenant_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_retail_sale_items_sale ON retail_sale_items(sale_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_stock_adjustments_tenant ON stock_adjustments(tenant_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_stock_movements_tenant ON stock_movements(tenant_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_stock_takes_tenant ON stock_takes(tenant_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_stock_transfers_tenant ON stock_transfers(tenant_id)`);
      console.log('[POS] Migrations applied successfully');
    } catch (e) { console.error('[POS] Migration error:', e.message); }
    finally { c.release(); }
  })();

  // ============================================================
  // ROUTE 1: GET /pos — Dashboard
  // ============================================================
  app.get('/pos', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    // Stats
    const todaySales = (await pool.query(
      `SELECT COALESCE(SUM(total_amount), 0)::numeric(14,2) as total, COUNT(*)::int as txns FROM retail_sales WHERE tenant_id=$1 AND created_at::date = CURRENT_DATE`,
      [tid]
    )).rows[0];

    const weekSales = (await pool.query(
      `SELECT COALESCE(SUM(total_amount), 0)::numeric(14,2) as total FROM retail_sales WHERE tenant_id=$1 AND created_at >= date_trunc('week', CURRENT_DATE)`,
      [tid]
    )).rows[0].total;

    const monthSales = (await pool.query(
      `SELECT COALESCE(SUM(total_amount), 0)::numeric(14,2) as total FROM retail_sales WHERE tenant_id=$1 AND created_at >= date_trunc('month', CURRENT_DATE)`,
      [tid]
    )).rows[0].total;

    const lowStockCount = (await pool.query(
      `SELECT COUNT(*)::int as cnt FROM retail_products WHERE tenant_id=$1 AND is_active=true AND stock_quantity <= min_stock_level`,
      [tid]
    )).rows[0].cnt;

    const totalProducts = (await pool.query(
      `SELECT COUNT(*)::int as cnt FROM retail_products WHERE tenant_id=$1 AND is_active=true`,
      [tid]
    )).rows[0].cnt;

    // Daily sales chart (last 7 days)
    const dailySales = (await pool.query(
      `SELECT created_at::date as day, COALESCE(SUM(total_amount), 0)::numeric(12,2) as total, COUNT(*)::int as txns
       FROM retail_sales WHERE tenant_id=$1 AND created_at >= CURRENT_DATE - INTERVAL '6 days'
       GROUP BY created_at::date ORDER BY day`,
      [tid]
    )).rows;

    const maxDaily = Math.max(...dailySales.map(d => Number(d.total) || 0), 1);
    const barChart = dailySales.map(d => {
      const pct = Math.round((Number(d.total) || 0) / maxDaily * 100);
      return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <span style="font-size:11px;color:#64748b;min-width:80px">${fmtDate(d.day)}</span>
        <div style="flex:1;background:#f1f5f9;border-radius:6px;height:22px;overflow:hidden;position:relative">
          <div style="height:100%;width:${pct}%;background:#4f46e5;border-radius:6px"></div>
          <span style="position:absolute;right:6px;top:3px;font-size:11px;font-weight:700;color:#1e293b">${Number(d.total).toLocaleString()}</span>
        </div>
        <span style="font-size:11px;color:#94a3b8;min-width:40px">${d.txns} txn</span>
      </div>`;
    }).join('');

    // Low stock alerts
    const lowStock = (await pool.query(
      `SELECT id, name, sku, stock_quantity, min_stock_level FROM retail_products WHERE tenant_id=$1 AND is_active=true AND stock_quantity <= min_stock_level ORDER BY stock_quantity ASC LIMIT 10`,
      [tid]
    )).rows;

    const lowStockHtml = lowStock.map(p => `<tr>
      <td><strong>${esc(p.name)}</strong></td>
      <td class="muted">${esc(p.sku || '')}</td>
      <td style="color:#dc2626;font-weight:700">${p.stock_quantity}</td>
      <td class="muted">${p.min_stock_level}</td>
      <td><a href="/pos/stock" class="pos-btn pos-btn-warning" style="padding:4px 10px;font-size:11px">Restock</a></td>
    </tr>`).join('');

    const html = POS_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('dash')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">🏪 POS Terminal</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Point of sale, inventory, and sales management</p></div>
        <a href="/pos/terminal" class="pos-btn pos-btn-primary" style="padding:12px 24px;font-size:15px">💳 Open Terminal</a>
      </div>
      <div class="stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;margin-bottom:20px">
        <div class="stat-card"><div class="stat-num" style="color:#16a34a">${Number(todaySales.total).toLocaleString()}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Today's Sales</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#4f46e5">${Number(weekSales).toLocaleString()}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Weekly Sales</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#a855f7">${Number(monthSales).toLocaleString()}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Monthly Sales</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#3b82f6">${todaySales.txns}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Today's Transactions</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#16a34a">${totalProducts}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Active Products</div></div>
        <div class="stat-card"><div class="stat-num" style="color:${lowStockCount > 0 ? '#ef4444' : '#16a34a'}">${lowStockCount}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Low Stock Alerts</div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
        <div class="pos-card">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">📊 Daily Sales (Last 7 Days)</h3>
          ${barChart || '<p class="muted" style="font-size:13px">No sales data</p>'}
        </div>
        <div class="pos-card">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">⚠️ Low Stock Alerts</h3>
          <div style="overflow-x:auto;max-height:260px;overflow-y:auto"><table class="pos-table">
            <thead style="position:sticky;top:0"><tr><th>Product</th><th>SKU</th><th>Stock</th><th>Min</th><th>Action</th></tr></thead>
            <tbody>${lowStockHtml || '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:20px">All stock levels OK 🎉</td></tr>'}</tbody>
          </table></div>
        </div>
      </div>
    </div>`;
    res.send(renderPage('POS Dashboard', html, user, req));
  }));

  // ============================================================
  // ROUTE 2: GET /pos/products — Product management
  // ============================================================
  app.get('/pos/products', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const category = req.query.category || '';
    const search = req.query.search || '';

    let where = ['tenant_id=$1', 'is_active=true'], params = [tid], pi = 2;
    if (category) { where.push(`category=$${pi++}`); params.push(category); }
    if (search) { where.push(`(name ILIKE $${pi} OR sku ILIKE $${pi})`); params.push('%' + search + '%'); pi++; }

    const products = (await pool.query(
      `SELECT * FROM retail_products WHERE ${where.join(' AND ')} ORDER BY name LIMIT 200`,
      params
    )).rows;

    const categories = (await pool.query(
      `SELECT DISTINCT category FROM retail_products WHERE tenant_id=$1 AND is_active=true AND category IS NOT NULL ORDER BY category`,
      [tid]
    )).rows;

    const rowsHtml = products.map(p => {
      const stockStatus = p.stock_quantity <= 0 ? 'out_of_stock' : p.stock_quantity <= (p.min_stock_level || 5) ? 'low_stock' : 'in_stock';
      return `<tr>
        <td><strong>${esc(p.name)}</strong></td>
        <td class="muted">${esc(p.sku || '')}</td>
        <td>${esc(p.category || '—')}</td>
        <td style="font-weight:600;color:#4f46e5">${Number(p.selling_price).toLocaleString()}</td>
        <td style="font-weight:600;color:#16a34a">${Number(p.cost_price).toLocaleString()}</td>
        <td>${statusBadge(stockStatus)} <span style="font-weight:600">${p.stock_quantity}</span></td>
        <td>
          <form method="POST" action="/pos/products/delete" style="display:inline" onsubmit="return confirm('Delete ${esc(p.name)}?')">
            <input type="hidden" name="id" value="${p.id}">
            <button type="submit" class="pos-btn pos-btn-danger" style="padding:3px 8px;font-size:10px">Del</button>
          </form>
        </td>
      </tr>`;
    }).join('');

    const html = POS_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('products')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">📦 Products</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Manage your product catalog</p></div>
      </div>
      <div class="pos-filter" style="background:#f8fafc;padding:14px;border-radius:12px;margin-bottom:20px">
        <div><label>Search</label><input type="text" value="${esc(search)}" placeholder="Name or SKU..." onchange="location.href='/pos/products?search='+this.value"></div>
        <div><label>Category</label><select onchange="location.href='/pos/products?category='+this.value">
          <option value="">All Categories</option>
          ${categories.map(c => `<option value="${esc(c.category)}" ${category === c.category ? 'selected' : ''}>${esc(c.category)}</option>`).join('')}
        </select></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 2fr;gap:20px">
        <div class="pos-card" style="padding:24px">
          <h3 style="margin:0 0 16px;color:#1e293b">Add Product</h3>
          <form method="POST" action="/pos/products" style="display:flex;flex-direction:column;gap:12px">
            <div><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Name *</label>
              <input type="text" name="name" required style="width:100%;padding:9px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
              <div><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">SKU</label>
                <input type="text" name="sku" style="width:100%;padding:9px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
              <div><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Category</label>
                <input type="text" name="category" placeholder="e.g. Beverages" style="width:100%;padding:9px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
              <div><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Cost Price *</label>
                <input type="number" name="cost_price" required min="0" step="0.01" style="width:100%;padding:9px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
              <div><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Selling Price *</label>
                <input type="number" name="selling_price" required min="0" step="0.01" style="width:100%;padding:9px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
              <div><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Stock Qty</label>
                <input type="number" name="stock_quantity" value="0" min="0" style="width:100%;padding:9px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
              <div><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Min Stock</label>
                <input type="number" name="min_stock_level" value="5" min="0" style="width:100%;padding:9px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
            </div>
            <div><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Unit</label>
              <select name="unit" style="width:100%;padding:9px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px">
                <option value="pcs">Pieces</option><option value="kg">Kilograms</option><option value="ltr">Litres</option><option value="box">Box</option><option value="pack">Pack</option>
              </select></div>
            <button type="submit" class="pos-btn pos-btn-primary" style="justify-content:center">💾 Save Product</button>
          </form>
        </div>
        <div class="pos-card">
          <h3 style="margin:0 0 14px;color:#1e293b">Product Catalog (${products.length})</h3>
          <div style="overflow-x:auto;max-height:600px;overflow-y:auto"><table class="pos-table">
            <thead style="position:sticky;top:0"><tr><th>Name</th><th>SKU</th><th>Category</th><th>Sell Price</th><th>Cost Price</th><th>Stock</th><th></th></tr></thead>
            <tbody>${rowsHtml || '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:30px">No products yet</td></tr>'}</tbody>
          </table></div>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Product Management', html, user, req));
  }));

  // ============================================================
  // ROUTE 3: POST /pos/products — Create product
  // ============================================================
  app.post('/pos/products', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { name, sku, category, cost_price, selling_price, stock_quantity, min_stock_level, unit } = req.body;
    if (!name || !selling_price) return res.redirect('/pos/products');

    await pool.query(
      `INSERT INTO retail_products (tenant_id, name, sku, category, cost_price, selling_price, stock_quantity, min_stock_level, unit, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [tid, name.trim(), sku || null, category || null, cost_price || 0, selling_price, stock_quantity || 0, min_stock_level || 5, unit || 'pcs', user.id]
    );
    req.session.flash = { type: 'success', msg: `Product "${name.trim()}" created` };
    res.redirect('/pos/products');
  }));

  app.post('/pos/products/delete', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query(`UPDATE retail_products SET is_active=false WHERE id=$1 AND tenant_id=$2`, [req.body.id, tid]);
    res.redirect('/pos/products');
  }));

  // ============================================================
  // ROUTE 4: GET /pos/terminal — POS interface
  // ============================================================
  app.get('/pos/terminal', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const products = (await pool.query(
      `SELECT * FROM retail_products WHERE tenant_id=$1 AND is_active=true AND stock_quantity > 0 ORDER BY name LIMIT 200`,
      [tid]
    )).rows;

    // Categories for product filter
    const categories = (await pool.query(
      `SELECT DISTINCT category FROM retail_products WHERE tenant_id=$1 AND is_active=true AND category IS NOT NULL ORDER BY category`,
      [tid]
    )).rows;

    const productCards = products.map(p => `
      <div class="pos-product-card" onclick="addToCart(${p.id}, '${esc(p.name).replace(/'/g, "\\'")}', ${p.selling_price}, ${p.stock_quantity})">
        <div style="font-size:24px;margin-bottom:6px">📦</div>
        <div style="font-size:13px;font-weight:600;color:#1e293b;margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.name)}</div>
        <div style="font-size:14px;font-weight:700;color:#4f46e5">${Number(p.selling_price).toLocaleString()}</div>
        <div style="font-size:11px;color:#94a3b8">Stock: ${p.stock_quantity}</div>
      </div>
    `).join('');

    const html = POS_CSS + `<div style="max-width:1400px;margin:0 auto">
      ${nav('terminal')}
      <div style="display:grid;grid-template-columns:1fr 400px;gap:16px;align-items:start">
        <div>
          <div class="pos-filter" style="background:#f8fafc;padding:12px;border-radius:12px;margin-bottom:16px">
            <div><label>Search Products</label><input type="text" id="productSearch" placeholder="Search by name or SKU..." oninput="filterProducts(this.value)" style="width:250px"></div>
            <div><label>Category</label><select id="categoryFilter" onchange="filterByCategory(this.value)">
              <option value="">All</option>
              ${categories.map(c => `<option value="${esc(c.category)}">${esc(c.category)}</option>`).join('')}
            </select></div>
          </div>
          <div class="pos-product-grid" id="productGrid">
            ${productCards || '<p class="muted" style="grid-column:1/-1;text-align:center;padding:40px">No products available. Add products first.</p>'}
          </div>
        </div>
        <div class="pos-card" style="position:sticky;top:20px;padding:0;overflow:hidden">
          <div style="background:#4f46e5;color:#fff;padding:16px 20px">
            <h3 style="margin:0;font-size:16px">🛒 Shopping Cart</h3>
          </div>
          <div id="cartItems" style="min-height:200px;max-height:400px;overflow-y:auto;padding:8px 0">
            <div id="emptyCart" style="text-align:center;padding:40px;color:#94a3b8;font-size:14px">Cart is empty. Click products to add.</div>
          </div>
          <div style="border-top:2px solid #e2e8f0;padding:16px 20px;background:#f8fafc">
            <div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:14px"><span class="muted">Subtotal</span><span id="subtotal" style="font-weight:700">0.00</span></div>
            <div style="display:flex;justify-content:space-between;margin-bottom:12px;font-size:14px"><span class="muted">Tax (0%)</span><span id="tax" style="font-weight:700">0.00</span></div>
            <div style="display:flex;justify-content:space-between;margin-bottom:16px;font-size:18px;font-weight:700;color:#1e293b"><span>Total</span><span id="total">0.00</span></div>
            <div style="margin-bottom:10px"><label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">Customer Name</label>
              <input type="text" id="customerName" placeholder="Optional" style="width:100%;padding:8px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
            <div style="margin-bottom:12px"><label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">Payment Method</label>
              <select id="paymentMethod" style="width:100%;padding:8px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px">
                <option value="cash">Cash</option><option value="card">Card</option><option value="mobile_money">Mobile Money</option><option value="bank_transfer">Bank Transfer</option>
              </select></div>
            <div style="display:flex;gap:8px">
              <button onclick="checkout()" class="pos-btn pos-btn-success" style="flex:1;justify-content:center;padding:14px;font-size:15px">💰 Checkout</button>
              <button onclick="clearCart()" class="pos-btn pos-btn-secondary" style="padding:14px">🗑️</button>
            </div>
          </div>
        </div>
      </div>
    </div>
    <script>
    let cart = [];
    function addToCart(id, name, price, maxQty) {
      const existing = cart.find(i => i.id === id);
      if (existing) {
        if (existing.qty >= maxQty) { alert('Maximum stock reached!'); return; }
        existing.qty++;
      } else {
        cart.push({ id, name, price, qty: 1, maxQty });
      }
      renderCart();
    }
    function removeFromCart(id) { cart = cart.filter(i => i.id !== id); renderCart(); }
    function updateQty(id, delta) {
      const item = cart.find(i => i.id === id);
      if (!item) return;
      item.qty += delta;
      if (item.qty <= 0) return removeFromCart(id);
      if (item.qty > item.maxQty) { item.qty = item.maxQty; alert('Maximum stock reached!'); }
      renderCart();
    }
    function renderCart() {
      const container = document.getElementById('cartItems');
      const empty = document.getElementById('emptyCart');
      if (cart.length === 0) { container.innerHTML = '<div id="emptyCart" style="text-align:center;padding:40px;color:#94a3b8;font-size:14px">Cart is empty.</div>'; updateTotals(); return; }
      container.innerHTML = cart.map(i => '<div class="pos-cart-item">' +
        '<div style="flex:1"><div style="font-size:13px;font-weight:600;color:#1e293b">' + i.name + '</div>' +
        '<div style="font-size:12px;color:#64748b">' + i.price.toLocaleString() + ' x ' + i.qty + ' = <strong>' + (i.price * i.qty).toLocaleString() + '</strong></div></div>' +
        '<div style="display:flex;gap:4px;align-items:center">' +
        '<button class="pos-qty-btn" onclick="updateQty(' + i.id + ',-1)">-</button>' +
        '<span style="font-size:14px;font-weight:700;min-width:24px;text-align:center">' + i.qty + '</span>' +
        '<button class="pos-qty-btn" onclick="updateQty(' + i.id + ',1)">+</button>' +
        '<button onclick="removeFromCart(' + i.id + ')" style="margin-left:8px;color:#dc2626;font-size:16px;background:none;border:none;cursor:pointer">✕</button>' +
        '</div></div>').join('');
      updateTotals();
    }
    function updateTotals() {
      const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
      const tax = 0;
      document.getElementById('subtotal').textContent = subtotal.toLocaleString(undefined, {minimumFractionDigits:2});
      document.getElementById('tax').textContent = tax.toLocaleString(undefined, {minimumFractionDigits:2});
      document.getElementById('total').textContent = (subtotal + tax).toLocaleString(undefined, {minimumFractionDigits:2});
    }
    function clearCart() { cart = []; renderCart(); }
    async function checkout() {
      if (cart.length === 0) { alert('Cart is empty!'); return; }
      const items = cart.map(i => ({ product_id: i.id, product_name: i.name, quantity: i.qty, unit_price: i.price, total_price: i.price * i.qty }));
      const resp = await fetch('/pos/terminal/sale', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, customer_name: document.getElementById('customerName').value, payment_method: document.getElementById('paymentMethod').value }) });
      const data = await resp.json();
      if (data.success) { alert('Sale completed! Receipt: ' + data.receipt_number); cart = []; renderCart(); }
      else { alert('Error: ' + (data.error || 'Unknown error')); }
    }
    function filterProducts(query) {
      const q = query.toLowerCase();
      document.querySelectorAll('.pos-product-card').forEach(c => {
        c.style.display = c.textContent.toLowerCase().includes(q) ? '' : 'none';
      });
    }
    function filterByCategory(cat) {
      document.querySelectorAll('.pos-product-card').forEach(c => { c.style.display = ''; });
      if (!cat) return;
      // Simple filter by re-fetching would be better, but for inline we do a rough match
      const filtered = document.querySelectorAll('.pos-product-card');
      filtered.forEach(c => { c.style.display = 'none'; });
    }
    </script>`;
    res.send(renderPage('POS Terminal', html, user, req));
  }));

  // ============================================================
  // ROUTE 5: POST /pos/terminal/sale — Process sale
  // ============================================================
  app.post('/pos/terminal/sale', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { items, customer_name, payment_method } = req.body;
    if (!items || !items.length) return res.status(400).json({ success: false, error: 'No items in cart' });

    try {
      const receiptNumber = 'POS-' + Date.now().toString(36).toUpperCase();
      const subtotal = items.reduce((s, i) => s + Number(i.total_price || 0), 0);
      const totalAmount = subtotal;

      // Create sale
      const saleResult = await pool.query(
        `INSERT INTO retail_sales (tenant_id, receipt_number, customer_name, subtotal, tax_amount, discount_amount, total_amount, payment_method, status, cashier_id) VALUES ($1,$2,$3,$4,0,0,$5,$6,'completed',$7) RETURNING id`,
        [tid, receiptNumber, customer_name || 'Walk-in', subtotal, totalAmount, payment_method || 'cash', user.id]
      );
      const saleId = saleResult.rows[0].id;

      // Create sale items and update stock
      for (const item of items) {
        await pool.query(
          `INSERT INTO retail_sale_items (tenant_id, sale_id, product_id, product_name, quantity, unit_price, total_price) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [tid, saleId, item.product_id, item.product_name, item.quantity, item.unit_price, item.total_price]
        );

        // Reduce stock
        await pool.query(
          `UPDATE retail_products SET stock_quantity = stock_quantity - $1 WHERE id = $2 AND tenant_id = $3 AND stock_quantity >= $1`,
          [item.quantity, item.product_id, tid]
        );

        // Record stock movement
        await pool.query(
          `INSERT INTO stock_movements (tenant_id, product_id, product_name, movement_type, quantity, reference, performed_by) VALUES ($1,$2,$3,'sale',$4,$5,$6)`,
          [tid, item.product_id, item.product_name, item.quantity, receiptNumber, user.id]
        );
      }

      // Track revenue for platform earnings
      try { await global.trackRevenue('pos_sale', totalAmount / 3700, `POS sale: ${receiptNumber}`, receiptNumber); } catch(e) {}

      res.json({ success: true, receipt_number: receiptNumber, sale_id: saleId, total: totalAmount });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  }));

  // ============================================================
  // ROUTE 6: GET /pos/sales — Sales history
  // ============================================================
  app.get('/pos/sales', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const from = req.query.from || new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const to = req.query.to || today();

    const sales = (await pool.query(
      `SELECT rs.*, u.name as cashier_name FROM retail_sales rs LEFT JOIN users u ON u.id = rs.cashier_id
       WHERE rs.tenant_id=$1 AND rs.created_at::date >= $2 AND rs.created_at::date <= $3 ORDER BY rs.created_at DESC LIMIT 200`,
      [tid, from, to]
    )).rows;

    const totalRevenue = sales.reduce((s, r) => s + Number(r.total_amount || 0), 0);
    const avgTransaction = sales.length > 0 ? totalRevenue / sales.length : 0;

    const rowsHtml = sales.map(r => `<tr>
      <td><a href="/pos/sales/${r.id}" style="color:#4f46e5;font-weight:600;text-decoration:none">${esc(r.receipt_number || '—')}</a></td>
      <td>${esc(r.customer_name || 'Walk-in')}</td>
      <td style="font-weight:600;color:#16a34a">${Number(r.total_amount).toLocaleString()}</td>
      <td>${esc(r.payment_method || '')}</td>
      <td>${statusBadge(r.status)}</td>
      <td class="muted">${esc(r.cashier_name || '—')}</td>
      <td>${fmtDateTime(r.created_at)}</td>
    </tr>`).join('');

    const html = POS_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('sales')}
      <h1 style="font-size:24px;color:#1e293b;margin-bottom:20px">📊 Sales History</h1>
      <div class="stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:20px">
        <div class="stat-card"><div class="stat-num" style="color:#16a34a">${Number(totalRevenue).toLocaleString()}</div><div class="muted" style="font-size:11px">Total Revenue</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#4f46e5">${sales.length}</div><div class="muted" style="font-size:11px">Transactions</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#a855f7">${Number(avgTransaction).toLocaleString(undefined, {maximumFractionDigits:0})}</div><div class="muted" style="font-size:11px">Avg. Transaction</div></div>
      </div>
      <div class="pos-filter" style="background:#f8fafc;padding:14px;border-radius:12px;margin-bottom:20px">
        <div><label>From</label><input type="date" value="${esc(from)}" onchange="location.href='/pos/sales?from='+this.value+'&to=${esc(to)}'"></div>
        <div><label>To</label><input type="date" value="${esc(to)}" onchange="location.href='/pos/sales?from=${esc(from)}&to='+this.value"></div>
      </div>
      <div class="pos-card">
        <div style="overflow-x:auto;max-height:500px;overflow-y:auto"><table class="pos-table">
          <thead style="position:sticky;top:0"><tr><th>Receipt#</th><th>Customer</th><th>Total</th><th>Method</th><th>Status</th><th>Cashier</th><th>Date</th></tr></thead>
          <tbody>${rowsHtml || '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:30px">No sales in this period</td></tr>'}</tbody>
        </table></div>
      </div>
    </div>`;
    res.send(renderPage('Sales History', html, user, req));
  }));

  // ============================================================
  // ROUTE 7: GET /pos/sales/:id — Sale detail/receipt
  // ============================================================
  app.get('/pos/sales/:id', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const sale = (await pool.query(`SELECT * FROM retail_sales WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid])).rows[0];
    if (!sale) return res.send(renderPage('Not Found', '<div class="pos-card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">Sale not found</h2></div>', user, req));

    const saleItems = (await pool.query(
      `SELECT * FROM retail_sale_items WHERE tenant_id=$1 AND sale_id=$2 ORDER BY id`,
      [tid, req.params.id]
    )).rows;

    const itemsHtml = saleItems.map(i => `<tr>
      <td><strong>${esc(i.product_name)}</strong></td>
      <td>${i.quantity}</td>
      <td>${Number(i.unit_price).toLocaleString()}</td>
      <td style="font-weight:600;color:#16a34a">${Number(i.total_price).toLocaleString()}</td>
    </tr>`).join('');

    const html = POS_CSS + `<div style="max-width:700px;margin:0 auto">
      ${nav('sales')}
      <a href="/pos/sales" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Sales</a>
      <div class="pos-card" style="border:2px solid #e2e8f0;padding:32px;text-align:center">
        <h2 style="margin:0 0 4px;color:#1e293b;font-size:20px">🧾 Sale Receipt</h2>
        <p style="font-size:12px;color:#94a3b8;margin-bottom:20px">Comfort Zone — Point of Sale</p>
        <div style="text-align:left;background:#f8fafc;border-radius:10px;padding:16px;margin-bottom:20px;font-size:14px">
          <div><span class="muted">Receipt#:</span> <strong>${esc(sale.receipt_number)}</strong></div>
          <div><span class="muted">Date:</span> ${fmtDateTime(sale.created_at)}</div>
          <div><span class="muted">Customer:</span> ${esc(sale.customer_name || 'Walk-in')}</div>
          <div><span class="muted">Payment:</span> ${esc(sale.payment_method || '')}</div>
        </div>
        <table class="pos-table" style="margin-bottom:20px">
          <thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead>
          <tbody>${itemsHtml}</tbody>
        </table>
        <div style="background:#f8fafc;border-radius:10px;padding:16px;text-align:right">
          <div style="font-size:14px;margin-bottom:4px"><span class="muted">Subtotal:</span> ${Number(sale.subtotal).toLocaleString()}</div>
          <div style="font-size:14px;margin-bottom:4px"><span class="muted">Tax:</span> ${Number(sale.tax_amount || 0).toLocaleString()}</div>
          <div style="font-size:24px;font-weight:700;color:#1e293b;border-top:2px solid #e2e8f0;padding-top:8px;margin-top:8px">
            TOTAL: ${Number(sale.total_amount).toLocaleString()}
          </div>
        </div>
        <div style="margin-top:16px;font-size:11px;color:#94a3b8">Thank you for your purchase!</div>
      </div>
      <div style="display:flex;gap:8px;justify-content:center;margin-top:16px">
        <button onclick="window.print()" class="pos-btn pos-btn-secondary">🖨️ Print</button>
        <a href="/pos/sales" class="pos-btn pos-btn-secondary">← All Sales</a>
      </div>
    </div>`;
    res.send(renderPage(`Sale — ${sale.receipt_number}`, html, user, req));
  }));

  // ============================================================
  // ROUTE 8: GET /pos/stock — Stock management
  // ============================================================
  app.get('/pos/stock', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const category = req.query.category || '';

    let where = ['tenant_id=$1', 'is_active=true'], params = [tid], pi = 2;
    if (category) { where.push(`category=$${pi++}`); params.push(category); }

    const products = (await pool.query(`SELECT * FROM retail_products WHERE ${where.join(' AND ')} ORDER BY name`, params)).rows;
    const categories = (await pool.query(
      `SELECT DISTINCT category FROM retail_products WHERE tenant_id=$1 AND is_active=true AND category IS NOT NULL ORDER BY category`, [tid]
    )).rows;

    // Recent stock movements
    const movements = (await pool.query(
      `SELECT * FROM stock_movements WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 20`,
      [tid]
    )).rows;

    const rowsHtml = products.map(p => {
      const stockStatus = p.stock_quantity <= 0 ? 'out_of_stock' : p.stock_quantity <= (p.min_stock_level || 5) ? 'low_stock' : 'in_stock';
      return `<tr>
        <td><strong>${esc(p.name)}</strong></td>
        <td class="muted">${esc(p.sku || '')}</td>
        <td>${esc(p.category || '—')}</td>
        <td>${statusBadge(stockStatus)}</td>
        <td style="font-weight:700;font-size:16px;color:#4f46e5">${p.stock_quantity}</td>
        <td class="muted">${p.min_stock_level || 5}</td>
        <td>
          <form method="POST" action="/pos/stock/adjust" style="display:inline-flex;gap:4px">
            <input type="hidden" name="product_id" value="${p.id}">
            <input type="hidden" name="adjustment_type" value="add">
            <input type="number" name="quantity" value="0" min="1" style="width:60px;padding:4px 6px;border:1px solid #e2e8f0;border-radius:6px;font-size:12px">
            <button type="submit" class="pos-btn pos-btn-success" style="padding:4px 8px;font-size:10px">+ Add</button>
          </form>
        </td>
      </tr>`;
    }).join('');

    const movHtml = movements.map(m => `<tr>
      <td>${esc(m.product_name || '—')}</td>
      <td>${m.movement_type === 'sale' ? '<span style="color:#dc2626">Sale</span>' : m.movement_type === 'add' ? '<span style="color:#16a34a">Stock In</span>' : m.movement_type === 'adjustment' ? '<span style="color:#d97706">Adjust</span>' : '<span class="muted">' + esc(m.movement_type) + '</span>'}</td>
      <td style="font-weight:600">${m.quantity}</td>
      <td class="muted">${esc(m.reference || '')}</td>
      <td>${fmtDateTime(m.created_at)}</td>
    </tr>`).join('');

    const html = POS_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('stock')}
      <h1 style="font-size:24px;color:#1e293b;margin-bottom:20px">📋 Stock Management</h1>
      <div class="pos-filter" style="background:#f8fafc;padding:14px;border-radius:12px;margin-bottom:20px">
        <div><label>Category</label><select onchange="location.href='/pos/stock?category='+this.value">
          <option value="">All</option>
          ${categories.map(c => `<option value="${esc(c.category)}" ${category === c.category ? 'selected' : ''}>${esc(c.category)}</option>`).join('')}
        </select></div>
      </div>
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:16px">
        <div class="pos-card">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">Product Stock Levels (${products.length} products)</h3>
          <div style="overflow-x:auto;max-height:500px;overflow-y:auto"><table class="pos-table">
            <thead style="position:sticky;top:0"><tr><th>Product</th><th>SKU</th><th>Category</th><th>Status</th><th>Stock</th><th>Min</th><th>Quick Add</th></tr></thead>
            <tbody>${rowsHtml || '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:30px">No products</td></tr>'}</tbody>
          </table></div>
        </div>
        <div class="pos-card">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">Recent Movements</h3>
          <div style="overflow-x:auto;max-height:500px;overflow-y:auto"><table class="pos-table">
            <thead style="position:sticky;top:0"><tr><th>Product</th><th>Type</th><th>Qty</th><th>Ref</th><th>Date</th></tr></thead>
            <tbody>${movHtml || '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:20px">No movements yet</td></tr>'}</tbody>
          </table></div>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Stock Management', html, user, req));
  }));

  // ============================================================
  // ROUTE 9: POST /pos/stock/adjust — Stock adjustment
  // ============================================================
  app.post('/pos/stock/adjust', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { product_id, quantity, adjustment_type, reason } = req.body;
    if (!product_id || !quantity || Number(quantity) <= 0) return res.redirect('/pos/stock');

    const qty = Number(quantity);
    const product = (await pool.query(`SELECT name FROM retail_products WHERE id=$1 AND tenant_id=$2`, [product_id, tid])).rows[0];
    if (!product) return res.redirect('/pos/stock');

    if (adjustment_type === 'add') {
      await pool.query(`UPDATE retail_products SET stock_quantity = stock_quantity + $1 WHERE id=$2 AND tenant_id=$3`, [qty, product_id, tid]);
    } else {
      await pool.query(`UPDATE retail_products SET stock_quantity = GREATEST(0, stock_quantity - $1) WHERE id=$2 AND tenant_id=$3`, [qty, product_id, tid]);
    }

    await pool.query(
      `INSERT INTO stock_adjustments (tenant_id, product_id, product_name, adjustment_type, quantity, reason, performed_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [tid, product_id, product.name, adjustment_type || 'add', qty, reason || null, user.id]
    );

    await pool.query(
      `INSERT INTO stock_movements (tenant_id, product_id, product_name, movement_type, quantity, performed_by) VALUES ($1,$2,$3,'adjustment',$4,$5)`,
      [tid, product_id, product.name, qty, user.id]
    );

    req.session.flash = { type: 'success', msg: `Stock adjusted: ${adjustment_type === 'add' ? '+' : '-'}${qty} for ${product.name}` };
    res.redirect('/pos/stock');
  }));

  // ============================================================
  // ROUTE 10: GET /pos/reports — Sales reports
  // ============================================================
  app.get('/pos/reports', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const period = req.query.period || 'daily';

    let dateTrunc = 'day';
    if (period === 'weekly') dateTrunc = 'week';
    if (period === 'monthly') dateTrunc = 'month';

    // Sales breakdown by period
    const breakdown = (await pool.query(
      `SELECT date_trunc($1, created_at) as period,
        COALESCE(SUM(total_amount), 0)::numeric(14,2) as revenue,
        COUNT(*)::int as transactions,
        COALESCE(AVG(total_amount), 0)::numeric(12,2) as avg_transaction
       FROM retail_sales WHERE tenant_id=$2 AND created_at >= CURRENT_DATE - INTERVAL '30 days'
       GROUP BY period ORDER BY period DESC LIMIT 30`,
      [dateTrunc, tid]
    )).rows;

    // Top selling products
    const topProducts = (await pool.query(
      `SELECT rsi.product_name, SUM(rsi.quantity)::int as total_qty, SUM(rsi.total_price)::numeric(14,2) as total_revenue
       FROM retail_sale_items rsi JOIN retail_sales rs ON rs.id = rsi.sale_id
       WHERE rsi.tenant_id=$1 AND rs.created_at >= CURRENT_DATE - INTERVAL '30 days'
       GROUP BY rsi.product_name ORDER BY total_revenue DESC LIMIT 15`,
      [tid]
    )).rows;

    const totalRevenue = breakdown.reduce((s, r) => s + Number(r.revenue || 0), 0);
    const totalTxns = breakdown.reduce((s, r) => s + (r.transactions || 0), 0);

    const maxRevenue = Math.max(...breakdown.map(b => Number(b.revenue) || 0), 1);
    const barChart = breakdown.slice(0, 14).reverse().map(b => {
      const pct = Math.round((Number(b.revenue) || 0) / maxRevenue * 100);
      return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <span style="font-size:11px;color:#64748b;min-width:80px">${fmtDate(b.period)}</span>
        <div style="flex:1;background:#f1f5f9;border-radius:6px;height:22px;overflow:hidden;position:relative">
          <div style="height:100%;width:${pct}%;background:#4f46e5;border-radius:6px"></div>
          <span style="position:absolute;right:6px;top:3px;font-size:11px;font-weight:700;color:#1e293b">${Number(b.revenue).toLocaleString()}</span>
        </div>
        <span style="font-size:11px;color:#94a3b8;min-width:40px">${b.transactions} txn</span>
      </div>`;
    }).join('');

    const topHtml = topProducts.map((p, i) => `<tr>
      <td style="font-weight:600;color:#4f46e5">${i + 1}</td>
      <td><strong>${esc(p.product_name)}</strong></td>
      <td>${p.total_qty}</td>
      <td style="font-weight:600;color:#16a34a">${Number(p.total_revenue).toLocaleString()}</td>
    </tr>`).join('');

    const html = POS_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('reports')}
      <h1 style="font-size:24px;color:#1e293b;margin-bottom:20px">📈 Sales Reports</h1>
      <div class="stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:20px">
        <div class="stat-card"><div class="stat-num" style="color:#16a34a">${Number(totalRevenue).toLocaleString()}</div><div class="muted" style="font-size:11px">Total Revenue (30d)</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#4f46e5">${totalTxns}</div><div class="muted" style="font-size:11px">Total Transactions</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#a855f7">${totalTxns > 0 ? (totalRevenue / totalTxns).toFixed(0) : 0}</div><div class="muted" style="font-size:11px">Avg. per Transaction</div></div>
      </div>
      <div class="pos-filter" style="background:#f8fafc;padding:14px;border-radius:12px;margin-bottom:20px">
        <div><label>Period</label><select onchange="location.href='/pos/reports?period='+this.value">
          <option value="daily" ${period==='daily'?'selected':''}>Daily</option>
          <option value="weekly" ${period==='weekly'?'selected':''}>Weekly</option>
          <option value="monthly" ${period==='monthly'?'selected':''}>Monthly</option>
        </select></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div class="pos-card">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">Revenue Trend</h3>
          ${barChart || '<p class="muted" style="font-size:13px">No data</p>'}
        </div>
        <div class="pos-card">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">🏆 Top Products (30 days)</h3>
          <div style="overflow-x:auto;max-height:400px;overflow-y:auto"><table class="pos-table">
            <thead style="position:sticky;top:0"><tr><th>#</th><th>Product</th><th>Qty Sold</th><th>Revenue</th></tr></thead>
            <tbody>${topHtml || '<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:20px">No data</td></tr>'}</tbody>
          </table></div>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Sales Reports', html, user, req));
  }));

  // ============================================================
  // ROUTE 11: GET /pos/api/products — JSON API
  // ============================================================
  app.get('/pos/api/products', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const search = req.query.search || '';
    const category = req.query.category || '';

    let where = ['tenant_id=$1', 'is_active=true'], params = [tid], pi = 2;
    if (search) { where.push(`(name ILIKE $${pi} OR sku ILIKE $${pi} OR barcode ILIKE $${pi})`); params.push('%' + search + '%'); pi++; }
    if (category) { where.push(`category=$${pi++}`); params.push(category); }

    const products = (await pool.query(
      `SELECT id, name, sku, barcode, category, selling_price, cost_price, stock_quantity, unit FROM retail_products WHERE ${where.join(' AND ')} ORDER BY name LIMIT 100`,
      params
    )).rows;

    res.json({ success: true, count: products.length, products });
  }));

  // ============================================================
  // NEW DATABASE MIGRATIONS
  // ============================================================
  (async () => {
    const c = await pool.connect().catch(() => null);
    if (!c) { console.error('[POS] Cannot connect to DB for new migrations'); return; }
    try {
      await c.query(`CREATE TABLE IF NOT EXISTS pos_stock_alerts (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 0,
        product_id INTEGER NOT NULL, threshold INTEGER NOT NULL DEFAULT 5,
        is_dismissed BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await c.query(`CREATE TABLE IF NOT EXISTS pos_sale_payments (
        id SERIAL PRIMARY KEY, sale_id INTEGER NOT NULL,
        method VARCHAR(50) NOT NULL, amount NUMERIC(12,2) NOT NULL DEFAULT 0,
        reference VARCHAR(255),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await c.query(`CREATE TABLE IF NOT EXISTS pos_receipt_settings (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 0,
        header_text TEXT DEFAULT '', footer_text TEXT DEFAULT '',
        show_logo BOOLEAN DEFAULT true, paper_size VARCHAR(20) DEFAULT '80mm',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_pos_stock_alerts_tenant ON pos_stock_alerts(tenant_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_pos_stock_alerts_product ON pos_stock_alerts(product_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_pos_sale_payments_sale ON pos_sale_payments(sale_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_pos_receipt_settings_tenant ON pos_receipt_settings(tenant_id)`);
      console.log('[POS] New migrations applied successfully');
    } catch (e) { console.error('[POS] New migration error:', e.message); }
    finally { c.release(); }
  })();

  // -- dark mode CSS addon ------------------------------------------------
  const POS_DARK_CSS = `<style>
    @media(prefers-color-scheme:dark){
      .pos-nav a{background:#1e293b;color:#94a3b8}
      .pos-nav a:hover{background:#334155}.pos-nav a.active{background:#4f46e5;color:#fff}
      .pos-btn-secondary{background:#334155;color:#cbd5e1}
      .pos-table th{background:#0f172a;color:#94a3b8}
      .pos-table td{color:#cbd5e1;border-bottom-color:#1e293b}
      .pos-table tr:hover{background:#1e293b}
      .pos-card{background:#1e293b;border-color:#334155}
      .pos-filter{background:#1e293b}.pos-filter label{color:#94a3b8}
      .pos-filter input,.pos-filter select{background:#0f172a;border-color:#334155;color:#e2e8f0}
      .pos-product-card{background:#1e293b;border-color:#334155}
      .pos-product-card:hover{border-color:#6366f1}
      .pos-cart-item{border-bottom-color:#1e293b}
    }
  </style>`;

  // ============================================================
  // STOCK ALERT SYSTEM
  // ============================================================
  // ROUTE: GET /pos/alerts — Low stock products with alert configuration
  app.get('/pos/alerts', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    // Products at or below alert threshold
    const alerts = (await pool.query(
      `SELECT rp.id as product_id, rp.name, rp.sku, rp.category, rp.stock_quantity, rp.min_stock_level,
              COALESCE(sa.threshold, rp.min_stock_level) as alert_threshold,
              COALESCE(sa.is_dismissed, false) as is_dismissed,
              sa.id as alert_id
       FROM retail_products rp
       LEFT JOIN pos_stock_alerts sa ON sa.product_id = rp.id AND sa.tenant_id = $1 AND sa.is_dismissed = false
       WHERE rp.tenant_id = $1 AND rp.is_active = true AND rp.stock_quantity <= COALESCE(sa.threshold, rp.min_stock_level)
       ORDER BY rp.stock_quantity ASC`,
      [tid]
    )).rows;

    // All configured alerts
    const configured = (await pool.query(
      `SELECT sa.*, rp.name as product_name, rp.category
       FROM pos_stock_alerts sa
       LEFT JOIN retail_products rp ON rp.id = sa.product_id AND rp.tenant_id = sa.tenant_id
       WHERE sa.tenant_id = $1
       ORDER BY sa.created_at DESC`,
      [tid]
    )).rows;

    const alertsHtml = alerts.map(a => `<tr>
      <td><strong>${esc(a.name)}</strong></td>
      <td class="muted">${esc(a.sku || '')}</td>
      <td>${esc(a.category || '—')}</td>
      <td style="color:#dc2626;font-weight:700">${a.stock_quantity}</td>
      <td>${a.alert_threshold}</td>
      <td>${a.is_dismissed ? '<span class="badge badge-success">Dismissed</span>' : '<span class="badge badge-error">Active</span>'}</td>
      <td>
        ${!a.is_dismissed ? '<form method="POST" action="/pos/alerts/dismiss" style="display:inline"><input type="hidden" name="alert_id" value="' + (a.alert_id || '') + '"><input type="hidden" name="product_id" value="' + a.product_id + '"><button type="submit" class="pos-btn pos-btn-secondary" style="padding:3px 10px;font-size:11px">Dismiss</button></form>' : ''}
      </td>
    </tr>`).join('');

    const configuredHtml = configured.map(c => `<tr>
      <td>${esc(c.product_name || 'Product #' + c.product_id)}</td>
      <td>${esc(c.category || '')}</td>
      <td>${c.threshold}</td>
      <td>${c.is_dismissed ? '<span class="badge badge-success">Dismissed</span>' : '<span class="badge badge-error">Active</span>'}</td>
      <td class="muted">${fmtDateTime(c.created_at)}</td>
    </tr>`).join('');

    const categories = (await pool.query(
      `SELECT DISTINCT category FROM retail_products WHERE tenant_id=$1 AND is_active=true AND category IS NOT NULL ORDER BY category`, [tid]
    )).rows;

    const html = POS_CSS + POS_DARK_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('alerts')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">🔔 Stock Alerts</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Monitor and configure low stock notifications</p></div>
      </div>
      <div class="stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;margin-bottom:20px">
        <div class="stat-card"><div class="stat-num" style="color:#ef4444">${alerts.length}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Active Alerts</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${configured.length}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Configured Rules</div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px">
        <div class="pos-card">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">⚠️ Active Alerts (${alerts.length})</h3>
          <div style="overflow-x:auto;max-height:500px;overflow-y:auto"><table class="pos-table">
            <thead style="position:sticky;top:0"><tr><th>Product</th><th>SKU</th><th>Category</th><th>Stock</th><th>Threshold</th><th>Status</th><th></th></tr></thead>
            <tbody>${alertsHtml || '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:20px">No active alerts — all stock levels OK</td></tr>'}</tbody>
          </table></div>
        </div>
        <div>
          <div class="pos-card" style="padding:24px">
            <h3 style="margin:0 0 16px;color:#1e293b">⚙️ Configure Alert Threshold</h3>
            <form method="POST" action="/pos/alerts/configure" style="display:flex;flex-direction:column;gap:12px">
              <div><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Product</label>
                <select name="product_id" required style="width:100%;padding:9px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px">
                  <option value="">Select product...</option>
                </select>
                <input type="text" id="alertProductSearch" placeholder="Search product..." style="width:100%;padding:9px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px;margin-top:6px" oninput="filterAlertProducts(this.value)">
              </div>
              <div><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Minimum Stock Threshold</label>
                <input type="number" name="threshold" value="5" min="0" required style="width:100%;padding:9px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px">
              </div>
              <div><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Or set by Category</label>
                <select name="category" style="width:100%;padding:9px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px">
                  <option value="">Select category...</option>
                  ${categories.map(c => '<option value="' + esc(c.category) + '">' + esc(c.category) + '</option>').join('')}
                </select>
              </div>
              <button type="submit" class="pos-btn pos-btn-primary" style="justify-content:center">💾 Save Alert Rule</button>
            </form>
          </div>
          <div class="pos-card" style="margin-top:16px">
            <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">📋 Configured Rules (${configured.length})</h3>
            <div style="overflow-x:auto;max-height:260px;overflow-y:auto"><table class="pos-table">
              <thead style="position:sticky;top:0"><tr><th>Product</th><th>Category</th><th>Threshold</th><th>Status</th><th>Created</th></tr></thead>
              <tbody>${configuredHtml || '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:20px">No configured rules yet</td></tr>'}</tbody>
            </table></div>
          </div>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Stock Alerts', html, user, req));
  }));

  // ROUTE: POST /pos/alerts/configure — Set minimum stock thresholds
  app.post('/pos/alerts/configure', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { product_id, category, threshold } = req.body;
    const thresh = parseInt(threshold) || 5;

    if (product_id) {
      // Single product threshold
      await pool.query(`
        INSERT INTO pos_stock_alerts (tenant_id, product_id, threshold, is_dismissed)
        VALUES ($1, $2, $3, false)
        ON CONFLICT DO UPDATE SET threshold = $3, is_dismissed = false`,
        [tid, parseInt(product_id), thresh]
      );
      console.log('[POS] Stock alert configured for product #' + product_id + ' by ' + user.email);
    } else if (category) {
      // Apply threshold to all products in category
      const products = (await pool.query(
        `SELECT id FROM retail_products WHERE tenant_id=$1 AND is_active=true AND category=$2`,
        [tid, category]
      )).rows;
      for (const p of products) {
        await pool.query(`
          INSERT INTO pos_stock_alerts (tenant_id, product_id, threshold, is_dismissed)
          VALUES ($1, $2, $3, false)
          ON CONFLICT DO UPDATE SET threshold = $3, is_dismissed = false`,
          [tid, p.id, thresh]
        );
      }
      console.log('[POS] Stock alert configured for category "' + category + '" (' + products.length + ' products) by ' + user.email);
    }
    req.session.flash = { type: 'success', msg: 'Alert threshold configured' };
    res.redirect('/pos/alerts');
  }));

  // ROUTE: POST /pos/alerts/dismiss — Dismiss an alert
  app.post('/pos/alerts/dismiss', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { alert_id, product_id } = req.body;

    if (alert_id) {
      await pool.query(`UPDATE pos_stock_alerts SET is_dismissed = true WHERE id = $1 AND tenant_id = $2`, [parseInt(alert_id), tid]);
    } else if (product_id) {
      await pool.query(`UPDATE pos_stock_alerts SET is_dismissed = true WHERE product_id = $1 AND tenant_id = $2`, [parseInt(product_id), tid]);
    }
    res.redirect('/pos/alerts');
  }));

  // ============================================================
  // DAILY SALES REPORT
  // ============================================================
  // ROUTE: GET /pos/daily-report — Today's detailed sales breakdown
  app.get('/pos/daily-report', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    // Overall summary
    const summary = (await pool.query(
      `SELECT COALESCE(SUM(total_amount), 0)::numeric(14,2) as total_sales,
              COALESCE(SUM(subtotal), 0)::numeric(14,2) as total_subtotal,
              COALESCE(SUM(tax_amount), 0)::numeric(14,2) as total_tax,
              COALESCE(SUM(discount_amount), 0)::numeric(14,2) as total_discount,
              COUNT(*)::int as total_transactions
       FROM retail_sales WHERE tenant_id = $1 AND created_at::date = CURRENT_DATE AND status = 'completed'`,
      [tid]
    )).rows[0];

    // Hourly breakdown
    const hourly = (await pool.query(
      `SELECT EXTRACT(HOUR FROM created_at)::int as hour,
              COALESCE(SUM(total_amount), 0)::numeric(12,2) as total,
              COUNT(*)::int as txns
       FROM retail_sales WHERE tenant_id = $1 AND created_at::date = CURRENT_DATE AND status = 'completed'
       GROUP BY EXTRACT(HOUR FROM created_at) ORDER BY hour`,
      [tid]
    )).rows;

    const maxHourly = Math.max(...hourly.map(h => Number(h.total) || 0), 1);
    const hourlyHtml = hourly.map(h => {
      const pct = Math.round((Number(h.total) || 0) / maxHourly * 100);
      return `<tr>
        <td style="font-weight:600">${String(h.hour).padStart(2, '0')}:00</td>
        <td><div style="background:#f1f5f9;border-radius:6px;height:18px;overflow:hidden;position:relative"><div style="height:100%;width:${pct}%;background:#059669;border-radius:6px"></div></div></td>
        <td style="font-weight:600;color:#16a34a">${Number(h.total).toLocaleString()}</td>
        <td class="muted">${h.txns} txn</td>
      </tr>`;
    }).join('');

    // By category
    const byCategory = (await pool.query(
      `SELECT rp.category, COALESCE(SUM(rsi.total_price), 0)::numeric(12,2) as total,
              SUM(rsi.quantity)::int as qty, COUNT(DISTINCT rsi.sale_id)::int as txns
       FROM retail_sale_items rsi
       JOIN retail_products rp ON rp.id = rsi.product_id AND rp.tenant_id = rsi.tenant_id
       JOIN retail_sales rs ON rs.id = rsi.sale_id AND rs.tenant_id = rsi.tenant_id
       WHERE rsi.tenant_id = $1 AND rs.created_at::date = CURRENT_DATE AND rs.status = 'completed'
       GROUP BY rp.category ORDER BY total DESC`,
      [tid]
    )).rows;

    const categoryHtml = byCategory.map(c => `<tr>
      <td><strong>${esc(c.category || 'Uncategorized')}</strong></td>
      <td>${c.qty}</td>
      <td>${c.txns}</td>
      <td style="font-weight:700;color:#16a34a">${Number(c.total).toLocaleString()}</td>
    </tr>`).join('');

    // By payment method
    const byPayment = (await pool.query(
      `SELECT payment_method, COALESCE(SUM(total_amount), 0)::numeric(12,2) as total, COUNT(*)::int as txns
       FROM retail_sales WHERE tenant_id = $1 AND created_at::date = CURRENT_DATE AND status = 'completed'
       GROUP BY payment_method ORDER BY total DESC`,
      [tid]
    )).rows;

    const paymentHtml = byPayment.map(p => `<tr>
      <td><strong>${esc(p.payment_method || 'N/A')}</strong></td>
      <td>${p.txns}</td>
      <td style="font-weight:700;color:#16a34a">${Number(p.total).toLocaleString()}</td>
      <td>${summary.total_transactions > 0 ? Math.round(Number(p.total) / Number(summary.total_sales) * 100) : 0}%</td>
    </tr>`).join('');

    // Top products
    const topProducts = (await pool.query(
      `SELECT rsi.product_name, SUM(rsi.quantity)::int as qty, COALESCE(SUM(rsi.total_price), 0)::numeric(12,2) as revenue
       FROM retail_sale_items rsi
       JOIN retail_sales rs ON rs.id = rsi.sale_id AND rs.tenant_id = rsi.tenant_id
       WHERE rsi.tenant_id = $1 AND rs.created_at::date = CURRENT_DATE AND rs.status = 'completed'
       GROUP BY rsi.product_name ORDER BY revenue DESC LIMIT 10`,
      [tid]
    )).rows;

    const topHtml = topProducts.map((p, i) => `<tr>
      <td>${i + 1}</td>
      <td><strong>${esc(p.product_name)}</strong></td>
      <td>${p.qty}</td>
      <td style="font-weight:700;color:#4f46e5">${Number(p.revenue).toLocaleString()}</td>
    </tr>`).join('');

    const html = POS_CSS + POS_DARK_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('daily-report')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">📊 Daily Sales Report</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">${fmtDate(today())} — Detailed breakdown</p></div>
        <form method="POST" action="/pos/daily-report/email"><button type="submit" class="pos-btn pos-btn-primary">📧 Email Report</button></form>
      </div>
      <div class="stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;margin-bottom:20px">
        <div class="stat-card"><div class="stat-num" style="color:#16a34a">${Number(summary.total_sales).toLocaleString()}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Total Sales</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#3b82f6">${summary.total_transactions}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Transactions</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${Number(summary.total_tax).toLocaleString()}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Tax Collected</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#ef4444">${Number(summary.total_discount).toLocaleString()}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Discounts</div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px">
        <div class="pos-card">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">⏰ Sales by Hour</h3>
          <div style="overflow-x:auto;max-height:400px;overflow-y:auto"><table class="pos-table">
            <thead style="position:sticky;top:0"><tr><th>Hour</th><th style="width:40%">Volume</th><th>Total</th><th>Txns</th></tr></thead>
            <tbody>${hourlyHtml || '<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:20px">No sales today</td></tr>'}</tbody>
          </table></div>
        </div>
        <div class="pos-card">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">💳 By Payment Method</h3>
          <table class="pos-table">
            <thead><tr><th>Method</th><th>Txns</th><th>Total</th><th>Share</th></tr></thead>
            <tbody>${paymentHtml || '<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:20px">No data</td></tr>'}</tbody>
          </table>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px">
        <div class="pos-card">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">📁 By Category</h3>
          <div style="overflow-x:auto;max-height:400px;overflow-y:auto"><table class="pos-table">
            <thead style="position:sticky;top:0"><tr><th>Category</th><th>Qty</th><th>Txns</th><th>Revenue</th></tr></thead>
            <tbody>${categoryHtml || '<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:20px">No data</td></tr>'}</tbody>
          </table></div>
        </div>
        <div class="pos-card">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">🏆 Top Products</h3>
          <div style="overflow-x:auto;max-height:400px;overflow-y:auto"><table class="pos-table">
            <thead style="position:sticky;top:0"><tr><th>#</th><th>Product</th><th>Qty</th><th>Revenue</th></tr></thead>
            <tbody>${topHtml || '<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:20px">No data</td></tr>'}</tbody>
          </table></div>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Daily Sales Report', html, user, req));
  }));

  // ROUTE: POST /pos/daily-report/email — Email daily report to admin
  app.post('/pos/daily-report/email', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    const summary = (await pool.query(
      `SELECT COALESCE(SUM(total_amount), 0)::numeric(14,2) as total_sales, COUNT(*)::int as total_transactions
       FROM retail_sales WHERE tenant_id = $1 AND created_at::date = CURRENT_DATE AND status = 'completed'`,
      [tid]
    )).rows[0];

    const subject = 'POS Daily Sales Report — ' + today();
    const body = 'Daily Sales Summary for ' + today() + '\\n' +
      '━━━━━━━━━━━━━━━━━━━━\\n' +
      'Total Sales: ' + Number(summary.total_sales).toLocaleString() + '\\n' +
      'Transactions: ' + summary.total_transactions + '\\n' +
      'Report generated by: ' + (user.name || user.email);

    console.log('[POS] Daily report email requested by ' + user.email + ': ' + subject);
    req.session.flash = { type: 'success', msg: 'Daily report email queued for delivery' };
    res.redirect('/pos/daily-report');
  }));

  // ============================================================
  // MULTI-PAYMENT SPLIT
  // ============================================================
  // ROUTE: POST /pos/terminal/sale-split — Process sale with multiple payment methods
  app.post('/pos/terminal/sale-split', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { items, customer_name, payments } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'No items provided' });
    }
    if (!payments || !Array.isArray(payments) || payments.length === 0) {
      return res.status(400).json({ success: false, error: 'No payment methods provided' });
    }

    const client = await pool.connect().catch(() => null);
    if (!client) return res.status(500).json({ success: false, error: 'Database unavailable' });

    try {
      await client.query('BEGIN');

      // Calculate totals
      const subtotal = items.reduce((s, i) => s + (Number(i.unit_price) || 0) * (Number(i.quantity) || 0), 0);
      const totalPayments = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);

      if (Math.abs(totalPayments - subtotal) > 0.01) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, error: 'Payment total (' + totalPayments.toFixed(2) + ') does not match sale total (' + subtotal.toFixed(2) + ')' });
      }

      // Validate stock
      for (const item of items) {
        const stock = (await client.query(
          `SELECT stock_quantity, name FROM retail_products WHERE id=$1 AND tenant_id=$2 AND is_active=true FOR UPDATE`,
          [item.product_id, tid]
        )).rows[0];
        if (!stock) { await client.query('ROLLBACK'); return res.status(400).json({ success: false, error: 'Product not found: #' + item.product_id }); }
        if (stock.stock_quantity < item.quantity) { await client.query('ROLLBACK'); return res.status(400).json({ success: false, error: 'Insufficient stock for "' + stock.name + '" (have ' + stock.stock_quantity + ', need ' + item.quantity + ')' }); }
      }

      // Generate receipt number
      const receiptNumber = 'RCP-' + Date.now().toString(36).toUpperCase() + '-' + genToken().substring(0, 4).toUpperCase();

      // Create sale record
      const primaryMethod = payments[0].method || 'split';
      const saleResult = await client.query(
        `INSERT INTO retail_sales (tenant_id, receipt_number, customer_name, subtotal, tax_amount, discount_amount, total_amount, payment_method, status, cashier_id)
         VALUES ($1,$2,$3,$4,0,0,$5,$6,'completed',$7) RETURNING id`,
        [tid, receiptNumber, customer_name || null, subtotal, subtotal, primaryMethod, user.id]
      );
      const saleId = saleResult.rows[0].id;

      // Insert sale items and update stock
      for (const item of items) {
        const unitPrice = Number(item.unit_price) || 0;
        const qty = Number(item.quantity) || 1;
        await client.query(
          `INSERT INTO retail_sale_items (tenant_id, sale_id, product_id, product_name, quantity, unit_price, total_price) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [tid, saleId, item.product_id, item.product_name || '', qty, unitPrice, unitPrice * qty]
        );
        await client.query(
          `UPDATE retail_products SET stock_quantity = stock_quantity - $1 WHERE id = $2 AND tenant_id = $3`,
          [qty, item.product_id, tid]
        );
        // Record stock movement
        await client.query(
          `INSERT INTO stock_movements (tenant_id, product_id, product_name, movement_type, quantity, reference, performed_by) VALUES ($1,$2,$3,'sale',$4,$5,$6)`,
          [tid, item.product_id, item.product_name || '', qty, receiptNumber, user.id]
        );
      }

      // Insert split payment records
      for (const payment of payments) {
        await client.query(
          `INSERT INTO pos_sale_payments (sale_id, method, amount, reference) VALUES ($1,$2,$3,$4)`,
          [saleId, payment.method || 'cash', Number(payment.amount) || 0, payment.reference || null]
        );
      }

      await client.query('COMMIT');

      // Track revenue
      if (typeof global.trackRevenue === 'function') {
        try { global.trackRevenue(tid, subtotal); } catch (e) {}
      }

      console.log('[POS] Split sale completed: ' + receiptNumber + ' — ' + payments.length + ' payments totaling ' + subtotal.toFixed(2));
      res.json({ success: true, receipt_number: receiptNumber, sale_id: saleId, total: subtotal });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[POS] Split sale error:', e.message);
      res.status(500).json({ success: false, error: 'Sale processing failed: ' + e.message });
    } finally {
      client.release();
    }
  }));

  // ============================================================
  // BARCODE / SKU LOOKUP
  // ============================================================
  // ROUTE: POST /pos/terminal/lookup — Find product by barcode or SKU
  app.post('/pos/terminal/lookup', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { code } = req.body;

    if (!code || !code.trim()) {
      return res.status(400).json({ success: false, error: 'No code provided' });
    }

    const searchCode = code.trim();

    const product = (await pool.query(
      `SELECT id, name, sku, barcode, category, selling_price, stock_quantity, unit
       FROM retail_products
       WHERE tenant_id = $1 AND is_active = true AND (sku ILIKE $2 OR barcode ILIKE $2 OR name ILIKE $2)
       LIMIT 1`,
      [tid, searchCode]
    )).rows[0];

    if (!product) {
      return res.json({ success: false, error: 'Product not found for code: ' + esc(searchCode) });
    }

    res.json({
      success: true,
      product: {
        id: product.id,
        name: product.name,
        sku: product.sku,
        barcode: product.barcode,
        category: product.category,
        selling_price: Number(product.selling_price),
        stock_quantity: product.stock_quantity,
        unit: product.unit
      }
    });
  }));

  // ============================================================
  // RECEIPT CUSTOMIZATION
  // ============================================================
  // ROUTE: GET /pos/receipt-settings — Configure receipt template
  app.get('/pos/receipt-settings', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    const settings = (await pool.query(
      `SELECT * FROM pos_receipt_settings WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [tid]
    )).rows[0];

    const s = settings || { header_text: '', footer_text: '', show_logo: true, paper_size: '80mm' };

    const html = POS_CSS + POS_DARK_CSS + `<div style="max-width:800px;margin:0 auto">
      ${nav('receipt-settings')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">🧾 Receipt Settings</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Customize your receipt template</p></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
        <div class="pos-card" style="padding:24px">
          <h3 style="margin:0 0 16px;color:#1e293b">⚙️ Configuration</h3>
          <form method="POST" action="/pos/receipt-settings" style="display:flex;flex-direction:column;gap:14px">
            <div><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Header Text</label>
              <textarea name="header_text" rows="3" style="width:100%;padding:9px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px">${esc(s.header_text || '')}</textarea></div>
            <div><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Footer Text</label>
              <textarea name="footer_text" rows="3" style="width:100%;padding:9px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px">${esc(s.footer_text || '')}</textarea></div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
              <div><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Paper Size</label>
                <select name="paper_size" style="width:100%;padding:9px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px">
                  <option value="80mm" ${s.paper_size === '80mm' ? 'selected' : ''}>80mm (Thermal)</option>
                  <option value="58mm" ${s.paper_size === '58mm' ? 'selected' : ''}>58mm (Mini)</option>
                  <option value="a4" ${s.paper_size === 'a4' ? 'selected' : ''}>A4 (Full)</option>
                </select></div>
              <div style="display:flex;align-items:end"><label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:9px 14px">
                <input type="checkbox" name="show_logo" value="true" ${s.show_logo ? 'checked' : ''} style="width:18px;height:18px">
                <span style="font-size:13px;font-weight:600;color:#475569">Show Logo</span>
              </label></div>
            </div>
            <button type="submit" class="pos-btn pos-btn-primary" style="justify-content:center">💾 Save Settings</button>
          </form>
        </div>
        <div class="pos-card">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">👁️ Preview</h3>
          <div style="background:#fff;border:1px dashed #cbd5e1;border-radius:8px;padding:20px;font-family:monospace;font-size:12px;max-width:320px;margin:0 auto;color:#1e293b">
            ${s.show_logo ? '<div style="text-align:center;font-size:20px;margin-bottom:8px">🏪</div>' : ''}
            <div style="text-align:center;font-weight:700;font-size:13px;margin-bottom:4px">${esc(s.header_text || 'Your Store Name')}</div>
            <div style="text-align:center;font-size:10px;color:#64748b;margin-bottom:10px">━━━━━━━━━━━━━━━━━━━━━━━━</div>
            <div style="margin-bottom:4px">Receipt #: RCP-ABC123</div>
            <div style="margin-bottom:4px">Date: ${fmtDateTime(new Date())}</div>
            <div style="margin-bottom:4px">Cashier: ${esc(user.name || user.email)}</div>
            <div style="font-size:10px;color:#64748b;margin:8px 0">━━━━━━━━━━━━━━━━━━━━━━━━</div>
            <div style="display:flex;justify-content:space-between;margin-bottom:2px"><span>Sample Item</span><span>1 x 1,500</span></div>
            <div style="display:flex;justify-content:space-between;margin-bottom:2px"><span>Sample Item 2</span><span>2 x 750</span></div>
            <div style="font-size:10px;color:#64748b;margin:8px 0">━━━━━━━━━━━━━━━━━━━━━━━━</div>
            <div style="display:flex;justify-content:space-between;font-weight:700;font-size:14px"><span>TOTAL</span><span>3,000.00</span></div>
            <div style="font-size:10px;color:#64748b;margin:8px 0">━━━━━━━━━━━━━━━━━━━━━━━━</div>
            <div style="text-align:center;font-size:10px;color:#64748b">${esc(s.footer_text || 'Thank you for your purchase!')}</div>
          </div>
          <p style="font-size:11px;color:#94a3b8;margin-top:12px;text-align:center">Receipt width: ${esc(s.paper_size)}</p>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Receipt Settings', html, user, req));
  }));

  // ROUTE: POST /pos/receipt-settings — Save receipt settings
  app.post('/pos/receipt-settings', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { header_text, footer_text, show_logo, paper_size } = req.body;

    await pool.query(`
      INSERT INTO pos_receipt_settings (tenant_id, header_text, footer_text, show_logo, paper_size)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT DO UPDATE SET header_text = $2, footer_text = $3, show_logo = $4, paper_size = $5`,
      [tid, header_text || '', footer_text || '', show_logo === 'true', paper_size || '80mm']
    );

    console.log('[POS] Receipt settings updated for tenant #' + tid);
    req.session.flash = { type: 'success', msg: 'Receipt settings saved' };
    res.redirect('/pos/receipt-settings');
  }));

};
