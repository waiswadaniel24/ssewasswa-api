// ============================================================
// INVENTORY REORDER MODULE — Auto-Reorder & Alerts System
// Monitors stock levels, sends alerts when items are low,
// and auto-generates purchase orders based on thresholds.
// ============================================================
// Usage in server.js:
//   const inventoryReorder = require('./inventory-reorder');
//   inventoryReorder(app, db, pool, renderPage, esc);
// ============================================================

'use strict';

const { migrateQuery } = require('./db');
module.exports = function inventoryReorder(app, db, pool, renderPage, esc) {

  // ── inline fallbacks ──────────────────────────────────────
  if (!esc) esc = (s) => String(s === null || s === undefined ? '' : (typeof s === 'object' ? JSON.stringify(s) : s)).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const requireAuth = (req, res, next) => { if (!req.session || !req.session.user) return res.redirect('/login'); next(); };
  const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const fmtNum = (n) => Number(n || 0).toLocaleString();
  const fmtMoney = (n) => 'UGX ' + Number(n || 0).toLocaleString();
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const THEME = '#dc2626';

  // ── traffic light helpers ────────────────────────────────
  function stockLight(current, reorder) {
    if (!current || current <= 0) return { color: '#dc2626', bg: '#fee2e2', label: 'Out of Stock', icon: '🔴' };
    if (reorder && current <= reorder) return { color: '#d97706', bg: '#fef3c7', label: 'Low Stock', icon: '🟡' };
    const ratio = reorder ? current / reorder : 2;
    if (ratio < 1.5) return { color: '#d97706', bg: '#fef3c7', label: 'Warning', icon: '🟡' };
    return { color: '#16a34a', bg: '#dcfce7', label: 'OK', icon: '🟢' };
  }

  function stockBar(current, reorder) {
    if (!reorder || reorder <= 0) return '';
    const pct = Math.min(100, Math.round((current / reorder) * 100));
    const light = stockLight(current, reorder);
    return `<div style="margin-top:6px;height:6px;background:#e2e8f0;border-radius:3px;overflow:hidden;width:100%">
      <div style="height:100%;width:${Math.min(pct, 100)}%;background:${light.color};border-radius:3px;transition:.3s"></div>
    </div>`;
  }

  function alertBadge(type) {
    const map = {
      low_stock: { bg: '#fef3c7', c: '#b45309', l: '⚠️ Low Stock' },
      out_of_stock: { bg: '#fee2e2', c: '#dc2626', l: '🔴 Out of Stock' },
      auto_ordered: { bg: '#dbeafe', c: '#2563eb', l: '🔄 Auto Ordered' }
    };
    const s = map[type] || map.low_stock;
    return `<span style="display:inline-block;padding:3px 12px;border-radius:20px;font-size:12px;font-weight:600;background:${s.bg};color:${s.c}">${s.l}</span>`;
  }

  function statusBadge(status) {
    const map = {
      new: { bg: '#dbeafe', c: '#1d4ed8', l: 'New' },
      acknowledged: { bg: '#fef3c7', c: '#b45309', l: 'Acknowledged' },
      resolved: { bg: '#dcfce7', c: '#16a34a', l: 'Resolved' },
      active: { bg: '#dcfce7', c: '#16a34a', l: 'Active' },
      paused: { bg: '#f1f5f9', c: '#64748b', l: 'Paused' }
    };
    const s = map[status] || map.active;
    return `<span style="display:inline-block;padding:3px 12px;border-radius:20px;font-size:12px;font-weight:600;background:${s.bg};color:${s.c}">${s.l}</span>`;
  }

  // ── CSS ───────────────────────────────────────────────────
  const REORDER_CSS = `<style>
.ro-nav{display:flex;gap:6px;margin-bottom:20px;flex-wrap:wrap}
.ro-nav a{padding:8px 16px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#475569;background:#f1f5f9;transition:.15s}
.ro-nav a:hover{background:#e2e8f0}.ro-nav a.active{background:${THEME};color:#fff}
.ro-tbl{width:100%;border-collapse:collapse;font-size:13px}
.ro-tbl th{padding:11px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#f8fafc}
.ro-tbl td{padding:10px 14px;border-bottom:1px solid #f1f5f9;color:#1e293b}
.ro-tbl tr:hover{background:#f8fafc}
.ro-filter{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:end}
.ro-filter label{display:block;font-size:12px;font-weight:600;color:#64748b;margin-bottom:4px}
.ro-filter input,.ro-filter select{padding:9px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px;background:#fff}
.ro-filter input:focus,.ro-filter select:focus{outline:none;border-color:${THEME}}
.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.form-grid .full{grid-column:1/-1}
@media(max-width:768px){.form-grid{grid-template-columns:1fr}.ro-filter{flex-direction:column}}
.ro-banner{padding:16px 20px;border-radius:12px;margin-bottom:20px;display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.ro-banner-red{background:#fee2e2;border:1px solid #fca5a5;color:#991b1b}
.ro-banner-yellow{background:#fef3c7;border:1px solid #fcd34d;color:#92400e}
.ro-banner-green{background:#dcfce7;border:1px solid #86efac;color:#166534}
.ro-card{background:#fff;border-radius:14px;padding:20px;box-shadow:0 1px 4px rgba(0,0,0,0.06);border:1px solid #e2e8f0;margin-bottom:16px}
</style>`;

  // ── MIGRATIONS ────────────────────────────────────────────
  const migrations = [
    `CREATE TABLE IF NOT EXISTS reorder_rules (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      item_name VARCHAR(255) NOT NULL,
      item_id INTEGER,
      current_stock INTEGER DEFAULT 0,
      reorder_level INTEGER NOT NULL,
      reorder_quantity INTEGER NOT NULL,
      supplier_name VARCHAR(255),
      supplier_phone VARCHAR(20),
      supplier_email VARCHAR(255),
      unit_cost INTEGER,
      auto_order BOOLEAN DEFAULT false,
      last_ordered_at TIMESTAMPTZ,
      last_alert_at TIMESTAMPTZ,
      alert_count INTEGER DEFAULT 0,
      status VARCHAR(20) DEFAULT 'active',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS reorder_alerts (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      rule_id INTEGER REFERENCES reorder_rules(id) ON DELETE CASCADE,
      alert_type VARCHAR(30),
      item_name VARCHAR(255),
      current_stock INTEGER,
      reorder_level INTEGER,
      message TEXT,
      status VARCHAR(20) DEFAULT 'new',
      acknowledged_by INTEGER REFERENCES users(id),
      acknowledged_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    // Ensure purchase_orders table exists for auto-PO feature)
    `CREATE TABLE IF NOT EXISTS purchase_orders (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      po_number VARCHAR(50) UNIQUE,
      supplier_name VARCHAR(255),
      supplier_phone VARCHAR(20),
      supplier_email VARCHAR(255),
      status VARCHAR(20) DEFAULT 'pending',
      total_amount INTEGER DEFAULT 0,
      notes TEXT,
      created_by INTEGER REFERENCES users(id),
      source_rule_id INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS purchase_order_items (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      po_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
      item_name VARCHAR(255) NOT NULL,
      item_id INTEGER,
      quantity INTEGER NOT NULL,
      unit_cost INTEGER DEFAULT 0,
      total_cost INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS tenant_id INTEGER`,
    // ALTER fallbacks)
    `ALTER TABLE IF EXISTS reorder_rules ADD COLUMN IF NOT EXISTS item_id INTEGER`,
    `ALTER TABLE IF EXISTS reorder_rules ADD COLUMN IF NOT EXISTS current_stock INTEGER DEFAULT 0`,
    `ALTER TABLE IF EXISTS reorder_rules ADD COLUMN IF NOT EXISTS unit_cost INTEGER`,
    `ALTER TABLE IF EXISTS reorder_rules ADD COLUMN IF NOT EXISTS auto_order BOOLEAN DEFAULT false`,
    `ALTER TABLE IF EXISTS reorder_rules ADD COLUMN IF NOT EXISTS last_ordered_at TIMESTAMPTZ`,
    `ALTER TABLE IF EXISTS reorder_rules ADD COLUMN IF NOT EXISTS last_alert_at TIMESTAMPTZ`,
    `ALTER TABLE IF EXISTS reorder_rules ADD COLUMN IF NOT EXISTS alert_count INTEGER DEFAULT 0`,
    `ALTER TABLE IF EXISTS reorder_rules ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active'`,
    `ALTER TABLE IF EXISTS reorder_alerts ADD COLUMN IF NOT EXISTS acknowledged_by INTEGER`,
    `ALTER TABLE IF EXISTS reorder_alerts ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ`,
    `ALTER TABLE IF EXISTS purchase_orders ADD COLUMN IF NOT EXISTS source_rule_id INTEGER`,
    `ALTER TABLE IF EXISTS purchase_orders ADD COLUMN IF NOT EXISTS po_number VARCHAR(50)`,
    // Indexes
    `CREATE INDEX IF NOT EXISTS idx_reorder_rules_tenant ON reorder_rules(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_reorder_rules_item ON reorder_rules(item_id)`,
    `CREATE INDEX IF NOT EXISTS idx_reorder_rules_status ON reorder_rules(tenant_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_reorder_alerts_tenant ON reorder_alerts(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_reorder_alerts_rule ON reorder_alerts(rule_id)`,
    `CREATE INDEX IF NOT EXISTS idx_reorder_alerts_status ON reorder_alerts(tenant_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_reorder_alerts_created ON reorder_alerts(created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_po_tenant ON purchase_orders(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_po_status ON purchase_orders(tenant_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_poi_po ON purchase_order_items(po_id)`
  ];

  (async () => {
    try {
      for (const sql of migrations) await migrateQuery(pool, 'InventoryReorder', sql);
      console.log('[InventoryReorder] Migrations applied: ' + migrations.length + ' statements');
    } catch (e) { /* migration OK */ }
  })();

  // ── helper: sync stock from inventory_items ───────────────
  async function syncCurrentStock(tid) {
    try {
      await pool.query(`
        UPDATE reorder_rules r
        SET current_stock = COALESCE(i.quantity, 0)
        FROM inventory_items i
        WHERE r.tenant_id = $1 AND r.item_id = i.id AND r.item_id IS NOT NULL
      `, [tid]);
    } catch (e) { /* inventory_items table may not exist yet */ }
  }

  // ── helper: check thresholds & generate alerts ────────────
  async function checkThresholds(tid) {
    try {
      const rules = (await pool.query(
        `SELECT * FROM reorder_rules WHERE tenant_id = $1 AND status = 'active' AND item_id IS NOT NULL`, [tid]
      )).rows;

      for (const rule of rules) {
        // Sync current stock from inventory_items
        const item = (await pool.query(
          `SELECT quantity FROM inventory_items WHERE id = $1 AND tenant_id = $2`, [rule.item_id, tid]
        )).rows[0];
        if (!item) continue;

        const currentStock = item.quantity || 0;
        await pool.query(
          `UPDATE reorder_rules SET current_stock = $1 WHERE id = $2`, [currentStock, rule.id]
        );

        // Check if below threshold
        if (currentStock <= rule.reorder_level) {
          // Determine alert type
          const alertType = currentStock <= 0 ? 'out_of_stock' : 'low_stock';
          const alertMsg = currentStock <= 0
            ? `"${rule.item_name}" is OUT OF STOCK (0 units). Reorder level: ${rule.reorder_level}.`
            : `"${rule.item_name}" stock is LOW (${currentStock} units). Reorder level: ${rule.reorder_level}.`;

          // Create alert (only if no unresolved alert exists for this rule in the last hour)
          const existing = (await pool.query(
            `SELECT id FROM reorder_alerts WHERE rule_id = $1 AND status IN ('new','acknowledged') AND created_at > NOW() - INTERVAL '1 hour'`,
            [rule.id]
          )).rows;

          if (existing.length === 0) {
            await pool.query(
              `INSERT INTO reorder_alerts (tenant_id, rule_id, alert_type, item_name, current_stock, reorder_level, message)
               VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [tid, rule.id, alertType, rule.item_name, currentStock, rule.reorder_level, alertMsg]
            );
            await pool.query(
              `UPDATE reorder_rules SET last_alert_at = NOW(), alert_count = alert_count + 1 WHERE id = $1`, [rule.id]
            );
          }

          // Auto-order if enabled
          if (rule.auto_order && currentStock <= 0) {
            const autoOrdered = (await pool.query(
              `SELECT id FROM purchase_orders WHERE source_rule_id = $1 AND status = 'pending'`,
              [rule.id]
            )).rows;
            if (autoOrdered.length === 0) {
              const poNum = 'PO-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
              const totalCost = (rule.unit_cost || 0) * rule.reorder_quantity;
              const po = (await pool.query(
                `INSERT INTO purchase_orders (tenant_id, po_number, supplier_name, supplier_phone, supplier_email, status, total_amount, notes, source_rule_id, created_by)
                 VALUES ($1,$2,$3,$4,$5,'pending',$6,$7,$8,NULL) RETURNING id`,
                [tid, poNum, rule.supplier_name, rule.supplier_phone, rule.supplier_email, totalCost,
                 'Auto-generated reorder for ' + rule.item_name, rule.id]
              )).rows[0];
              await pool.query(
                `INSERT INTO purchase_order_items (po_id, item_name, item_id, quantity, unit_cost, total_cost)
                 VALUES ($1,$2,$3,$4,$5,$6)`,
                [po.id, rule.item_name, rule.item_id, rule.reorder_quantity, rule.unit_cost || 0, totalCost]
              );
              // Create auto_ordered alert
              await pool.query(
                `INSERT INTO reorder_alerts (tenant_id, rule_id, alert_type, item_name, current_stock, reorder_level, message)
                 VALUES ($1,$2,'auto_ordered',$3,$4,$5,$6)`,
                [tid, rule.id, rule.item_name, currentStock, rule.reorder_level,
                 `Auto-generated PO #${poNum} for ${rule.reorder_quantity} units of "${rule.item_name}" at ${fmtMoney(rule.unit_cost)}/unit.`]
              );
              await pool.query(
                `UPDATE reorder_rules SET last_ordered_at = NOW() WHERE id = $1`, [rule.id]
              );
            }
          }
        }
      }
    } catch (e) { /* silent — background process */ }
  }

  // Run background threshold check every 5 minutes
  setInterval(() => {
    (async () => {
      try {
        const tenants = (await pool.query(`SELECT DISTINCT tenant_id FROM reorder_rules WHERE status = 'active'`)).rows;
        for (const t of tenants) {
          await syncCurrentStock(t.tenant_id);
          await checkThresholds(t.tenant_id);
        }
      } catch (e) { /* silent */ }
    })();
  }, 5 * 60 * 1000);

  // ── helper: render with nav ───────────────────────────────
  function nav(active) {
    const links = [
      ['/inventory-reorder', 'Dashboard'],
      ['/inventory-reorder/rules', 'Reorder Rules'],
      ['/inventory-reorder/rules/new', 'New Rule'],
      ['/inventory-reorder/alerts', 'Alerts'],
      ['/inventory-reorder/auto-purchase', 'Auto PO']
    ];
    return '<div class="ro-nav">' + links.map(([href, label]) =>
      `<a href="${href}" class="${active === href ? 'active' : ''}">${label}</a>`).join('') + '</div>';
  }

  // ════════════════════════════════════════════════════════════
  // ROUTE 1: GET /inventory-reorder — Dashboard
  // ════════════════════════════════════════════════════════════
  app.get('/inventory-reorder', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    // Sync stock levels from inventory_items
    await syncCurrentStock(tid);
    await checkThresholds(tid);

    // Stats
    const stats = (await pool.query(`
      SELECT
        COUNT(*) AS total_rules,
        COUNT(*) FILTER (WHERE status = 'active') AS active_rules,
        COUNT(*) FILTER (WHERE current_stock <= 0) AS out_of_stock,
        COUNT(*) FILTER (WHERE current_stock > 0 AND current_stock <= reorder_level) AS low_stock,
        COUNT(*) FILTER (WHERE current_stock > reorder_level) AS healthy,
        COUNT(*) FILTER (WHERE auto_order = true) AS auto_order_count,
        COALESCE(SUM((unit_cost || 0)::INTEGER * reorder_quantity) FILTER (WHERE current_stock <= reorder_level), 0) AS pending_cost,
        (SELECT COUNT(*) FROM reorder_alerts WHERE tenant_id = $1 AND status = 'new') AS new_alerts,
        (SELECT COUNT(*) FROM purchase_orders po WHERE po.tenant_id = $1 AND po.status = 'pending'
         AND EXTRACT(MONTH FROM po.created_at) = EXTRACT(MONTH FROM NOW())
         AND EXTRACT(YEAR FROM po.created_at) = EXTRACT(YEAR FROM NOW())) AS auto_orders_this_month,
        (SELECT COALESCE(SUM(total_amount), 0) FROM purchase_orders po WHERE po.tenant_id = $1
         AND po.status = 'approved') AS total_po_value
      FROM reorder_rules WHERE tenant_id = $1
    `, [tid])).rows[0];

    // Critical items (out of stock)
    const criticalItems = (await pool.query(`
      SELECT * FROM reorder_rules WHERE tenant_id = $1 AND status = 'active'
        AND current_stock <= 0
      ORDER BY alert_count DESC LIMIT 10
    `, [tid])).rows;

    // Low stock items
    const lowStockItems = (await pool.query(`
      SELECT * FROM reorder_rules WHERE tenant_id = $1 AND status = 'active'
        AND current_stock > 0 AND current_stock <= reorder_level
      ORDER BY current_stock ASC LIMIT 10
    `, [tid])).rows;

    // Recent alerts
    const recentAlerts = (await pool.query(`
      SELECT a.*, u.name as ack_name
      FROM reorder_alerts a
      LEFT JOIN users u ON u.id = a.acknowledged_by
      WHERE a.tenant_id = $1
      ORDER BY a.created_at DESC LIMIT 8
    `, [tid])).rows;

    // Savings from bulk orders
    const savings = Number(stats.total_po_value || 0);
    const pendingCost = Number(stats.pending_cost || 0);

    // Build banner
    let bannerHtml = '';
    if (Number(stats.out_of_stock) > 0) {
      bannerHtml = `<div class="ro-banner ro-banner-red">
        <span style="font-size:28px">🚨</span>
        <div>
          <strong style="font-size:15px">${stats.out_of_stock} Item${Number(stats.out_of_stock) > 1 ? 's' : ''} Out of Stock!</strong>
          <p style="font-size:13px;margin:2px 0 0;opacity:.85">${criticalItems.map(i => esc(i.item_name)).join(', ')}</p>
        </div>
        <a href="/inventory-reorder/rules" class="btn" style="background:${THEME};color:#fff;padding:8px 18px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;margin-left:auto">Review Now →</a>
      </div>`;
    } else if (Number(stats.low_stock) > 0) {
      bannerHtml = `<div class="ro-banner ro-banner-yellow">
        <span style="font-size:28px">⚠️</span>
        <div>
          <strong style="font-size:15px">${stats.low_stock} Item${Number(stats.low_stock) > 1 ? 's' : ''} at Low Stock</strong>
          <p style="font-size:13px;margin:2px 0 0;opacity:.85">Stock levels are approaching reorder thresholds.</p>
        </div>
        <a href="/inventory-reorder/rules" class="btn" style="background:#d97706;color:#fff;padding:8px 18px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;margin-left:auto">View Details →</a>
      </div>`;
    } else {
      bannerHtml = `<div class="ro-banner ro-banner-green">
        <span style="font-size:28px">✅</span>
        <div><strong style="font-size:15px">All Stock Levels Healthy</strong>
        <p style="font-size:13px;margin:2px 0 0;opacity:.85">No items are below their reorder levels.</p></div>
      </div>`;
    }

    // Critical items table
    const criticalRows = criticalItems.map(r => {
      const light = stockLight(r.current_stock, r.reorder_level);
      return `<tr>
        <td><strong style="color:${light.color}">${esc(r.item_name)}</strong></td>
        <td style="text-align:center"><span style="font-size:20px;font-weight:800;color:${light.color}">${fmtNum(r.current_stock)}</span></td>
        <td style="text-align:center">${fmtNum(r.reorder_level)}</td>
        <td>${esc(r.supplier_name || '—')}</td>
        <td>${fmtMoney(r.unit_cost)}</td>
        <td>${r.auto_order ? '<span style="color:#2563eb;font-weight:600">✓ Auto</span>' : '<span style="color:#94a3b8">Manual</span>'}</td>
        <td>
          ${r.item_id ? `<a href="/inventory-reorder/auto-purchase" class="btn btn-sm" style="background:${THEME};color:#fff;text-decoration:none;border-radius:6px;padding:4px 10px;font-size:12px">Order Now</a>` : ''}
        </td>
      </tr>`;
    }).join('');

    // Alerts list
    const alertHtml = recentAlerts.map(a => `
      <div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid #f1f5f9">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            ${alertBadge(a.alert_type)}
            <strong style="font-size:13px;color:#1e293b">${esc(a.item_name)}</strong>
          </div>
          <p style="font-size:12px;color:#64748b;margin:2px 0 0">${esc(a.message || '')}</p>
        </div>
        <div style="text-align:right;flex-shrink:0">
          ${statusBadge(a.status)}
          <div style="font-size:11px;color:#94a3b8;margin-top:2px">${fmtDateTime(a.created_at)}</div>
        </div>
      </div>
    `).join('');

    const html = REORDER_CSS + `
    <div style="max-width:1200px;margin:0 auto">
      ${nav('/inventory-reorder')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div>
          <h1 style="font-size:24px;color:#1e293b">🔄 Inventory Auto-Reorder</h1>
          <p style="font-size:13px;color:#94a3b8;margin-top:2px">Monitor stock levels, alerts & auto-generate purchase orders</p>
        </div>
        <div style="display:flex;gap:8px">
          <a href="/inventory-reorder/rules/new" class="btn" style="background:${THEME};color:#fff;padding:10px 20px;border-radius:10px;text-decoration:none;font-weight:600;font-size:13px">+ New Reorder Rule</a>
          <a href="/inventory/reorder-check" class="btn" style="background:#f1f5f9;color:#475569;padding:10px 20px;border-radius:10px;text-decoration:none;font-weight:600;font-size:13px">🔍 Run Check</a>
        </div>
      </div>

      ${bannerHtml}

      <!-- Stats Cards -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;margin-bottom:20px">
        <div class="ro-card" style="text-align:center">
          <div style="font-size:32px;font-weight:800;color:${THEME}">${stats.active_rules}</div>
          <div style="font-size:12px;color:#94a3b8;margin-top:4px">Active Rules</div>
        </div>
        <div class="ro-card" style="text-align:center">
          <div style="font-size:32px;font-weight:800;color:#dc2626">${stats.out_of_stock}</div>
          <div style="font-size:12px;color:#94a3b8;margin-top:4px">Out of Stock</div>
        </div>
        <div class="ro-card" style="text-align:center">
          <div style="font-size:32px;font-weight:800;color:#d97706">${stats.low_stock}</div>
          <div style="font-size:12px;color:#94a3b8;margin-top:4px">Low Stock</div>
        </div>
        <div class="ro-card" style="text-align:center">
          <div style="font-size:32px;font-weight:800;color:#2563eb">${stats.new_alerts}</div>
          <div style="font-size:12px;color:#94a3b8;margin-top:4px">New Alerts</div>
        </div>
        <div class="ro-card" style="text-align:center">
          <div style="font-size:32px;font-weight:800;color:#7c3aed">${stats.auto_orders_this_month}</div>
          <div style="font-size:12px;color:#94a3b8;margin-top:4px">Auto POs This Month</div>
        </div>
        <div class="ro-card" style="text-align:center">
          <div style="font-size:32px;font-weight:800;color:#059669">${fmtMoney(savings)}</div>
          <div style="font-size:12px;color:#94a3b8;margin-top:4px">Total PO Value</div>
        </div>
      </div>

      <!-- Critical Items -->
      ${criticalItems.length > 0 ? `
      <div class="ro-card">
        <h3 style="color:#dc2626;margin:0 0 14px;font-size:16px">🚨 Items Out of Stock</h3>
        <div style="overflow-x:auto"><table class="ro-tbl">
          <thead><tr><th>Item</th><th style="text-align:center">Stock</th><th style="text-align:center">Reorder At</th><th>Supplier</th><th>Unit Cost</th><th>Mode</th><th>Action</th></tr></thead>
          <tbody>${criticalRows}</tbody>
        </table></div>
      </div>` : ''}

      <!-- Two column: Low Stock + Recent Alerts -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(380px,1fr));gap:16px;margin-top:16px">
        ${lowStockItems.length > 0 ? `
        <div class="ro-card">
          <h3 style="color:#d97706;margin:0 0 14px;font-size:16px">⚠️ Items at Low Stock</h3>
          ${lowStockItems.map(r => {
            const light = stockLight(r.current_stock, r.reorder_level);
            return `<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid #f1f5f9">
              <span style="font-size:20px">${light.icon}</span>
              <div style="flex:1;min-width:0">
                <strong style="font-size:13px;color:#1e293b">${esc(r.item_name)}</strong>
                <div style="display:flex;gap:12px;font-size:12px;color:#64748b;margin-top:2px">
                  <span>Stock: <strong style="color:${light.color}">${fmtNum(r.current_stock)}</strong></span>
                  <span>Reorder: ${fmtNum(r.reorder_level)}</span>
                </div>
                ${stockBar(r.current_stock, r.reorder_level)}
              </div>
              <div style="font-size:13px;font-weight:700;color:${light.color}">${Math.round((r.current_stock / r.reorder_level) * 100)}%</div>
            </div>`;
          }).join('')}
        </div>` : ''}

        <div class="ro-card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
            <h3 style="color:#1e293b;margin:0;font-size:16px">🔔 Recent Alerts</h3>
            <a href="/inventory-reorder/alerts" style="color:${THEME};font-size:13px;text-decoration:none;font-weight:600">View All →</a>
          </div>
          ${alertHtml || '<p style="color:#94a3b8;text-align:center;padding:20px;font-size:13px">No alerts yet. Stock levels are healthy.</p>'}
        </div>
      </div>

      <!-- Pending Cost -->
      ${pendingCost > 0 ? `
      <div class="ro-card" style="background:linear-gradient(135deg,#fef2f2,#fee2e2);border-color:#fca5a5;margin-top:16px">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
          <div>
            <h3 style="color:#991b1b;margin:0 0 4px;font-size:16px">💰 Estimated Reorder Cost</h3>
            <p style="color:#b91c1c;font-size:13px;margin:0">Total cost to restock all items below reorder level</p>
          </div>
          <div style="text-align:right">
            <div style="font-size:28px;font-weight:800;color:#dc2626">${fmtMoney(pendingCost)}</div>
            <a href="/inventory-reorder/auto-purchase" style="color:${THEME};font-size:13px;text-decoration:none;font-weight:600">Review & Approve →</a>
          </div>
        </div>
      </div>` : ''}
    </div>`;
    res.send(renderPage('Inventory Auto-Reorder', html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 2: GET /inventory-reorder/rules — List Reorder Rules
  // ════════════════════════════════════════════════════════════
  app.get('/inventory-reorder/rules', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { q, status, auto_order } = req.query;

    await syncCurrentStock(tid);

    // Build filter
    let where = ['r.tenant_id = $1'], params = [tid], pi = 2;
    if (q) { where.push(`(r.item_name ILIKE $${pi})`); params.push('%' + q + '%'); pi++; }
    if (status) { where.push(`r.status = $${pi}`); params.push(status); pi++; }
    if (auto_order === '1') { where.push(`r.auto_order = true`); }

    const rules = (await pool.query(
      `SELECT r.* FROM reorder_rules r WHERE ${where.join(' AND ')} ORDER BY
        CASE WHEN r.current_stock <= 0 THEN 0
             WHEN r.current_stock <= r.reorder_level THEN 1
             ELSE 2 END,
        r.current_stock ASC, r.created_at DESC
      LIMIT 100`, params
    )).rows;

    const rows = rules.map(r => {
      const light = stockLight(r.current_stock, r.reorder_level);
      const estCost = (r.unit_cost || 0) * r.reorder_quantity;
      return `<tr>
        <td>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:16px">${light.icon}</span>
            <div>
              <strong style="color:#1e293b">${esc(r.item_name)}</strong>
              ${r.item_id ? `<div style="font-size:11px;color:#94a3b8">ID: ${r.item_id}</div>` : ''}
            </div>
          </div>
        </td>
        <td>
          <span style="font-size:18px;font-weight:800;color:${light.color}">${fmtNum(r.current_stock)}</span>
          ${stockBar(r.current_stock, r.reorder_level)}
        </td>
        <td style="text-align:center">${fmtNum(r.reorder_level)}</td>
        <td style="text-align:center">${fmtNum(r.reorder_quantity)}</td>
        <td>${esc(r.supplier_name || '—')}</td>
        <td>${fmtMoney(r.unit_cost)}</td>
        <td style="font-weight:600;color:${THEME}">${fmtMoney(estCost)}</td>
        <td>
          ${r.auto_order ? '<span style="color:#2563eb;font-weight:600;font-size:12px">🔄 Auto</span>' : '<span style="color:#94a3b8;font-size:12px">Manual</span>'}
        </td>
        <td>${statusBadge(r.status)}</td>
        <td>
          <div style="display:flex;gap:4px;flex-wrap:wrap">
            <a href="/inventory-reorder/rules/${r.id}/edit" class="btn btn-sm" style="background:#f1f5f9;color:#475569;text-decoration:none;border-radius:6px;padding:4px 8px;font-size:11px">Edit</a>
            ${r.current_stock <= r.reorder_level && r.item_id ? `<form method="POST" action="/inventory-reorder/auto-purchase/${r.id}/approve" style="display:inline" onsubmit="return confirm('Create purchase order for ${esc(r.item_name)}?')"><input type="hidden" name="_csrf" value="${esc(req.csrfToken || '')}"><button type="submit" class="btn btn-sm" style="background:${THEME};color:#fff;border:none;border-radius:6px;padding:4px 8px;font-size:11px;cursor:pointer">Order</button></form>` : ''}
            <form method="POST" action="/inventory-reorder/rules/${r.id}/delete" style="display:inline" onsubmit="return confirm('Delete reorder rule for ${esc(r.item_name)}?')"><input type="hidden" name="_csrf" value="${esc(req.csrfToken || '')}"><button type="submit" class="btn btn-sm" style="background:#fee2e2;color:#dc2626;border:none;border-radius:6px;padding:4px 8px;font-size:11px;cursor:pointer">Del</button></form>
          </div>
        </td>
      </tr>`;
    }).join('');

    const html = REORDER_CSS + `
    <div style="max-width:1200px;margin:0 auto">
      ${nav('/inventory-reorder/rules')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div>
          <h1 style="font-size:24px;color:#1e293b">📋 Reorder Rules</h1>
          <p style="font-size:13px;color:#94a3b8;margin-top:2px">${rules.length} rule${rules.length !== 1 ? 's' : ''} configured</p>
        </div>
        <a href="/inventory-reorder/rules/new" class="btn" style="background:${THEME};color:#fff;padding:10px 20px;border-radius:10px;text-decoration:none;font-weight:600;font-size:13px">+ New Rule</a>
      </div>

      <div class="ro-card">
        <form method="GET" action="/inventory-reorder/rules" class="ro-filter">
          <div><label>Search</label><input type="text" name="q" value="${esc(q || '')}" placeholder="Item name..."></div>
          <div><label>Status</label><select name="status">
            <option value="">All</option>
            <option value="active" ${status === 'active' ? 'selected' : ''}>Active</option>
            <option value="paused" ${status === 'paused' ? 'selected' : ''}>Paused</option>
          </select></div>
          <div><label>Mode</label><select name="auto_order">
            <option value="">All</option>
            <option value="1" ${auto_order === '1' ? 'selected' : ''}>Auto-Order Only</option>
          </select></div>
          <button type="submit" class="btn btn-sm" style="background:${THEME};color:#fff;border:none;border-radius:8px;padding:9px 18px;font-size:13px;cursor:pointer">Search</button>
        </form>
        <div style="overflow-x:auto"><table class="ro-tbl">
          <thead><tr><th>Item</th><th>Stock</th><th style="text-align:center">Reorder At</th><th style="text-align:center">Qty</th><th>Supplier</th><th>Unit Cost</th><th>Est. Cost</th><th>Mode</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="10" style="text-align:center;color:#94a3b8;padding:40px">No reorder rules configured. <a href="/inventory-reorder/rules/new" style="color:' + THEME + '">Create your first rule</a>.</td></tr>'}</tbody>
        </table></div>
      </div>
    </div>`;
    res.send(renderPage('Reorder Rules', html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 3: GET /inventory-reorder/rules/new — Create Rule
  // ════════════════════════════════════════════════════════════
  app.get('/inventory-reorder/rules/new', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    // Fetch available inventory items
    let inventoryItems = [];
    try {
      inventoryItems = (await pool.query(
        `SELECT id, name, quantity, unit, cost_price, supplier, reorder_level FROM inventory_items WHERE tenant_id = $1 AND is_active = true ORDER BY name`,
        [tid]
      )).rows;
    } catch (e) { /* table may not exist */ }

    // Fetch existing rules to show what's already configured
    const existingRules = (await pool.query(
      `SELECT item_id, item_name FROM reorder_rules WHERE tenant_id = $1`, [tid]
    )).rows;
    const existingItemIds = new Set(existingRules.filter(r => r.item_id).map(r => r.item_id));

    const itemOptions = inventoryItems.map(item => {
      const alreadyConfigured = existingItemIds.has(item.id);
      return `<option value="${item.id}" ${alreadyConfigured ? '' : ''} data-name="${esc(item.name)}" data-cost="${item.cost_price || 0}" data-qty="${item.quantity || 0}" data-reorder="${item.reorder_level || 0}" data-supplier="${esc(item.supplier || '')}" ${alreadyConfigured ? 'disabled' : ''}>${esc(item.name)}${alreadyConfigured ? ' (already configured)' : ''} — Stock: ${fmtNum(item.quantity)} ${esc(item.unit || 'pcs')}</option>`;
    }).join('');

    const html = REORDER_CSS + `
    <div style="max-width:800px;margin:0 auto">
      ${nav('/inventory-reorder/rules/new')}
      <a href="/inventory-reorder/rules" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Rules</a>
      <div class="ro-card" style="padding:24px">
        <h2 style="color:#1e293b;margin-bottom:4px">➕ New Reorder Rule</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Set minimum stock levels, reorder quantity, and supplier details</p>
        <form method="POST" action="/inventory-reorder/rules/new">
          <input type="hidden" name="_csrf" value="${esc(req.csrfToken || '')}">
          <div class="form-grid">
            <div class="full">
              <label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Select Inventory Item</label>
              <select name="item_id" id="itemSelect" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px">
                <option value="">— Select item or type name below —</option>
                ${itemOptions}
              </select>
            </div>
            <div>
              <label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Item Name *</label>
              <input type="text" name="item_name" id="itemName" required style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px" placeholder="e.g. Exercise Books A4">
            </div>
            <div>
              <label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Current Stock</label>
              <input type="number" name="current_stock" id="currentStock" min="0" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;background:#f8fafc" value="0" readonly>
            </div>
            <div>
              <label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Reorder Level (alert threshold) *</label>
              <input type="number" name="reorder_level" id="reorderLevel" min="1" required style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px" placeholder="e.g. 50">
            </div>
            <div>
              <label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Reorder Quantity *</label>
              <input type="number" name="reorder_quantity" min="1" required style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px" placeholder="e.g. 200">
            </div>
            <div>
              <label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Supplier Name</label>
              <input type="text" name="supplier_name" id="supplierName" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px" placeholder="e.g. Uganda Stationeries Ltd">
            </div>
            <div>
              <label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Supplier Phone</label>
              <input type="text" name="supplier_phone" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px" placeholder="e.g. 0771234567">
            </div>
            <div>
              <label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Supplier Email</label>
              <input type="email" name="supplier_email" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px" placeholder="e.g. orders@supplier.co.ug">
            </div>
            <div>
              <label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Unit Cost (UGX)</label>
              <input type="number" name="unit_cost" id="unitCost" min="0" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px" placeholder="e.g. 5000" value="0">
            </div>
            <div class="full" style="display:flex;align-items:center;gap:10px;padding:12px 0">
              <input type="checkbox" name="auto_order" id="autoOrder" value="true" style="width:20px;height:20px;accent-color:${THEME};cursor:pointer">
              <label for="autoOrder" style="font-size:14px;color:#1e293b;cursor:pointer">
                <strong>Enable Auto-Order</strong> — Automatically generate a purchase order when stock hits zero
              </label>
            </div>
            <div class="full" style="display:flex;gap:10px;margin-top:8px">
              <button type="submit" class="btn" style="padding:12px 28px;background:${THEME};color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer">💾 Save Rule</button>
              <a href="/inventory-reorder/rules" class="btn" style="padding:12px 28px;background:#f1f5f9;color:#475569;text-decoration:none;border-radius:10px;font-size:14px">Cancel</a>
            </div>
          </div>
        </form>
      </div>
    </div>
    <script>
    (function(){
      var sel = document.getElementById('itemSelect');
      if (sel) {
        sel.addEventListener('change', function(){
          var opt = sel.options[sel.selectedIndex];
          if (opt && opt.value) {
            document.getElementById('itemName').value = opt.getAttribute('data-name') || '';
            document.getElementById('currentStock').value = opt.getAttribute('data-qty') || '0';
            document.getElementById('reorderLevel').value = opt.getAttribute('data-reorder') || '';
            document.getElementById('unitCost').value = opt.getAttribute('data-cost') || '0';
            document.getElementById('supplierName').value = opt.getAttribute('data-supplier') || '';
          }
        });
      }
    })();
    </script>`;
    res.send(renderPage('New Reorder Rule', html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 4: POST /inventory-reorder/rules/new — Save Rule
  // ════════════════════════════════════════════════════════════
  app.post('/inventory-reorder/rules/new', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { item_name, item_id, current_stock, reorder_level, reorder_quantity,
            supplier_name, supplier_phone, supplier_email, unit_cost, auto_order } = req.body;

    if (!item_name || !item_name.trim()) {
      return res.send(`<div class="ro-card"><div style="color:#dc2626;font-weight:600">Item name is required.</div>
        <a href="/inventory-reorder/rules/new" class="btn" style="background:${THEME};color:#fff;text-decoration:none;margin-top:10px;display:inline-block;padding:8px 16px;border-radius:8px">Back</a></div>`);
    }
    if (!reorder_level || parseInt(reorder_level) <= 0) {
      return res.send(`<div class="ro-card"><div style="color:#dc2626;font-weight:600">Reorder level must be greater than 0.</div>
        <a href="/inventory-reorder/rules/new" class="btn" style="background:${THEME};color:#fff;text-decoration:none;margin-top:10px;display:inline-block;padding:8px 16px;border-radius:8px">Back</a></div>`);
    }
    if (!reorder_quantity || parseInt(reorder_quantity) <= 0) {
      return res.send(`<div class="ro-card"><div style="color:#dc2626;font-weight:600">Reorder quantity must be greater than 0.</div>
        <a href="/inventory-reorder/rules/new" class="btn" style="background:${THEME};color:#fff;text-decoration:none;margin-top:10px;display:inline-block;padding:8px 16px;border-radius:8px">Back</a></div>`);
    }

    await pool.query(
      `INSERT INTO reorder_rules (tenant_id, item_name, item_id, current_stock, reorder_level, reorder_quantity,
        supplier_name, supplier_phone, supplier_email, unit_cost, auto_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [tid, item_name.trim(), item_id ? parseInt(item_id) : null,
       parseInt(current_stock) || 0, parseInt(reorder_level), parseInt(reorder_quantity),
       (supplier_name || '').trim() || null, (supplier_phone || '').trim() || null,
       (supplier_email || '').trim() || null, parseInt(unit_cost) || 0, auto_order === 'true']
    );

    res.redirect('/inventory-reorder/rules');
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 5: POST /inventory-reorder/rules/:id/edit — Update Rule
  // ════════════════════════════════════════════════════════════
  app.get('/inventory-reorder/rules/:id/edit', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, id = req.params.id;
    const rule = (await pool.query('SELECT * FROM reorder_rules WHERE id = $1 AND tenant_id = $2', [id, tid])).rows[0];
    if (!rule) return res.send(`<div class="ro-card"><div style="color:#dc2626">Rule not found.</div><a href="/inventory-reorder/rules" class="btn" style="background:${THEME};color:#fff;text-decoration:none;margin-top:10px;display:inline-block;padding:8px 16px;border-radius:8px">Back</a></div>`);

    await syncCurrentStock(tid);

    // Re-fetch to get synced stock
    const fresh = (await pool.query('SELECT * FROM reorder_rules WHERE id = $1 AND tenant_id = $2', [id, tid])).rows[0];

    const fld = (label, name, type, val, extra) => `<div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">${label}</label>
      <input type="${type}" name="${name}" value="${esc(String(val || ''))}" ${extra || ''} style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px"></div>`;

    const html = REORDER_CSS + `
    <div style="max-width:800px;margin:0 auto">
      ${nav('/inventory-reorder/rules')}
      <a href="/inventory-reorder/rules" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Rules</a>
      <div class="ro-card" style="padding:24px">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
          <span style="font-size:24px">${stockLight(fresh.current_stock, fresh.reorder_level).icon}</span>
          <div>
            <h2 style="color:#1e293b;margin:0">✏️ Edit: ${esc(rule.item_name)}</h2>
            <p style="font-size:13px;color:#94a3b8;margin:2px 0 0">Current stock: <strong style="color:${stockLight(fresh.current_stock, fresh.reorder_level).color}">${fmtNum(fresh.current_stock)}</strong> / Reorder at: ${fmtNum(rule.reorder_level)}</p>
          </div>
        </div>
        <form method="POST" action="/inventory-reorder/rules/${id}/edit">
          <input type="hidden" name="_csrf" value="${esc(req.csrfToken || '')}">
          <div class="form-grid">
            ${fld('Item Name *', 'item_name', 'text', rule.item_name, 'required')}
            ${fld('Current Stock', 'current_stock', 'number', fresh.current_stock, 'min="0" readonly style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;background:#f8fafc"')}
            ${fld('Reorder Level *', 'reorder_level', 'number', rule.reorder_level, 'min="1" required')}
            ${fld('Reorder Quantity *', 'reorder_quantity', 'number', rule.reorder_quantity, 'min="1" required')}
            ${fld('Supplier Name', 'supplier_name', 'text', rule.supplier_name)}
            ${fld('Supplier Phone', 'supplier_phone', 'text', rule.supplier_phone)}
            ${fld('Supplier Email', 'supplier_email', 'email', rule.supplier_email)}
            ${fld('Unit Cost (UGX)', 'unit_cost', 'number', rule.unit_cost, 'min="0"')}
            <div>
              <label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Status</label>
              <select name="status" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px">
                <option value="active" ${rule.status === 'active' ? 'selected' : ''}>Active</option>
                <option value="paused" ${rule.status === 'paused' ? 'selected' : ''}>Paused</option>
              </select>
            </div>
            <div style="display:flex;align-items:center;gap:10px;padding:20px 0 0">
              <input type="checkbox" name="auto_order" id="autoOrderEdit" value="true" ${rule.auto_order ? 'checked' : ''} style="width:20px;height:20px;accent-color:${THEME};cursor:pointer">
              <label for="autoOrderEdit" style="font-size:14px;color:#1e293b;cursor:pointer"><strong>Enable Auto-Order</strong></label>
            </div>
            <div class="full" style="display:flex;gap:10px;margin-top:8px">
              <button type="submit" class="btn" style="padding:12px 28px;background:${THEME};color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer">💾 Update Rule</button>
              <a href="/inventory-reorder/rules" class="btn" style="padding:12px 28px;background:#f1f5f9;color:#475569;text-decoration:none;border-radius:10px;font-size:14px">Cancel</a>
            </div>
          </div>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Edit Rule: ' + rule.item_name, html, user, req));
  }));

  app.post('/inventory-reorder/rules/:id/edit', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, id = req.params.id;
    const rule = (await pool.query('SELECT id FROM reorder_rules WHERE id = $1 AND tenant_id = $2', [id, tid])).rows[0];
    if (!rule) return res.redirect('/inventory-reorder/rules');

    const { item_name, reorder_level, reorder_quantity, supplier_name, supplier_phone,
            supplier_email, unit_cost, auto_order, status } = req.body;

    if (!item_name || !item_name.trim()) return res.redirect('/inventory-reorder/rules/' + id + '/edit');

    await pool.query(
      `UPDATE reorder_rules SET item_name = $1, reorder_level = $2, reorder_quantity = $3,
        supplier_name = $4, supplier_phone = $5, supplier_email = $6, unit_cost = $7,
        auto_order = $8, status = $9
       WHERE id = $10 AND tenant_id = $11`,
      [item_name.trim(), parseInt(reorder_level) || 10, parseInt(reorder_quantity) || 1,
       (supplier_name || '').trim() || null, (supplier_phone || '').trim() || null,
       (supplier_email || '').trim() || null, parseInt(unit_cost) || 0,
       auto_order === 'true', status || 'active', id, tid]
    );

    res.redirect('/inventory-reorder/rules');
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 6: POST /inventory-reorder/rules/:id/delete
  // ════════════════════════════════════════════════════════════
  app.post('/inventory-reorder/rules/:id/delete', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, id = req.params.id;
    const rule = (await pool.query('SELECT id, item_name FROM reorder_rules WHERE id = $1 AND tenant_id = $2', [id, tid])).rows[0];
    if (!rule) return res.redirect('/inventory-reorder/rules');
    await pool.query('DELETE FROM reorder_alerts WHERE rule_id = $1 AND tenant_id = $2', [id, tid]);
    await pool.query('DELETE FROM reorder_rules WHERE id = $1 AND tenant_id = $2', [id, tid]);
    res.redirect('/inventory-reorder/rules');
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 7: GET /inventory-reorder/alerts — View Alerts
  // ════════════════════════════════════════════════════════════
  app.get('/inventory-reorder/alerts', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { status, type, q } = req.query;

    await syncCurrentStock(tid);
    await checkThresholds(tid);

    let where = ['a.tenant_id = $1'], params = [tid], pi = 2;
    if (status) { where.push(`a.status = $${pi}`); params.push(status); pi++; }
    if (type) { where.push(`a.alert_type = $${pi}`); params.push(type); pi++; }
    if (q) { where.push(`(a.item_name ILIKE $${pi} OR a.message ILIKE $${pi})`); params.push('%' + q + '%'); pi++; }

    const alerts = (await pool.query(
      `SELECT a.*, u.name as ack_name
       FROM reorder_alerts a
       LEFT JOIN users u ON u.id = a.acknowledged_by
       WHERE ${where.join(' AND ')}
       ORDER BY a.created_at DESC LIMIT 100`, params
    )).rows;

    // Stats
    const alertStats = (await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'new') as new_count,
        COUNT(*) FILTER (WHERE status = 'acknowledged') as ack_count,
        COUNT(*) FILTER (WHERE status = 'resolved') as resolved_count,
        COUNT(*) FILTER (WHERE alert_type = 'out_of_stock') as oos_count,
        COUNT(*) FILTER (WHERE alert_type = 'low_stock') as low_count,
        COUNT(*) FILTER (WHERE alert_type = 'auto_ordered') as auto_count
      FROM reorder_alerts WHERE tenant_id = $1
    `, [tid])).rows[0];

    const rows = alerts.map(a => {
      return `<tr>
        <td>${alertBadge(a.alert_type)}</td>
        <td><strong style="color:#1e293b">${esc(a.item_name)}</strong></td>
        <td>
          <span style="font-size:16px;font-weight:700;color:${stockLight(a.current_stock, a.reorder_level).color}">${fmtNum(a.current_stock)}</span>
          <span style="color:#94a3b8;font-size:12px"> / ${fmtNum(a.reorder_level)}</span>
        </td>
        <td style="font-size:12px;color:#475569;max-width:250px">${esc(a.message || '—')}</td>
        <td>${statusBadge(a.status)}</td>
        <td style="font-size:12px;color:#64748b;white-space:nowrap">${fmtDateTime(a.created_at)}</td>
        <td style="font-size:12px;color:#64748b">${a.ack_name ? esc(a.ack_name) + '<br>' + fmtDateTime(a.acknowledged_at) : '—'}</td>
        <td>
          <div style="display:flex;gap:4px;flex-wrap:wrap">
            ${a.status === 'new' ? `<form method="POST" action="/inventory-reorder/alerts/${a.id}/acknowledge" style="display:inline"><input type="hidden" name="_csrf" value="${esc(req.csrfToken || '')}"><button type="submit" class="btn btn-sm" style="background:#fef3c7;color:#b45309;border:none;border-radius:6px;padding:4px 8px;font-size:11px;cursor:pointer">Ack</button></form>` : ''}
            ${a.status !== 'resolved' ? `<form method="POST" action="/inventory-reorder/alerts/${a.id}/acknowledge" style="display:inline"><input type="hidden" name="_csrf" value="${esc(req.csrfToken || '')}"><input type="hidden" name="resolve" value="true"><button type="submit" class="btn btn-sm" style="background:#dcfce7;color:#16a34a;border:none;border-radius:6px;padding:4px 8px;font-size:11px;cursor:pointer">Resolve</button></form>` : ''}
          </div>
        </td>
      </tr>`;
    }).join('');

    const html = REORDER_CSS + `
    <div style="max-width:1200px;margin:0 auto">
      ${nav('/inventory-reorder/alerts')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div>
          <h1 style="font-size:24px;color:#1e293b">🔔 Stock Alerts</h1>
          <p style="font-size:13px;color:#94a3b8;margin-top:2px">${alerts.length} alert${alerts.length !== 1 ? 's' : ''}</p>
        </div>
      </div>

      <!-- Alert Stats -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin-bottom:16px">
        <div class="ro-card" style="text-align:center;padding:14px">
          <div style="font-size:24px;font-weight:800;color:#2563eb">${alertStats.new_count}</div>
          <div style="font-size:11px;color:#94a3b8">New</div>
        </div>
        <div class="ro-card" style="text-align:center;padding:14px">
          <div style="font-size:24px;font-weight:800;color:#d97706">${alertStats.ack_count}</div>
          <div style="font-size:11px;color:#94a3b8">Acknowledged</div>
        </div>
        <div class="ro-card" style="text-align:center;padding:14px">
          <div style="font-size:24px;font-weight:800;color:#16a34a">${alertStats.resolved_count}</div>
          <div style="font-size:11px;color:#94a3b8">Resolved</div>
        </div>
        <div class="ro-card" style="text-align:center;padding:14px">
          <div style="font-size:24px;font-weight:800;color:#dc2626">${alertStats.oos_count}</div>
          <div style="font-size:11px;color:#94a3b8">Out of Stock</div>
        </div>
        <div class="ro-card" style="text-align:center;padding:14px">
          <div style="font-size:24px;font-weight:800;color:#d97706">${alertStats.low_count}</div>
          <div style="font-size:11px;color:#94a3b8">Low Stock</div>
        </div>
        <div class="ro-card" style="text-align:center;padding:14px">
          <div style="font-size:24px;font-weight:800;color:#7c3aed">${alertStats.auto_count}</div>
          <div style="font-size:11px;color:#94a3b8">Auto Ordered</div>
        </div>
      </div>

      <div class="ro-card">
        <form method="GET" action="/inventory-reorder/alerts" class="ro-filter">
          <div><label>Search</label><input type="text" name="q" value="${esc(q || '')}" placeholder="Item or message..."></div>
          <div><label>Status</label><select name="status">
            <option value="">All</option>
            <option value="new" ${status === 'new' ? 'selected' : ''}>New</option>
            <option value="acknowledged" ${status === 'acknowledged' ? 'selected' : ''}>Acknowledged</option>
            <option value="resolved" ${status === 'resolved' ? 'selected' : ''}>Resolved</option>
          </select></div>
          <div><label>Type</label><select name="type">
            <option value="">All</option>
            <option value="low_stock" ${type === 'low_stock' ? 'selected' : ''}>Low Stock</option>
            <option value="out_of_stock" ${type === 'out_of_stock' ? 'selected' : ''}>Out of Stock</option>
            <option value="auto_ordered" ${type === 'auto_ordered' ? 'selected' : ''}>Auto Ordered</option>
          </select></div>
          <button type="submit" class="btn btn-sm" style="background:${THEME};color:#fff;border:none;border-radius:8px;padding:9px 18px;font-size:13px;cursor:pointer">Filter</button>
          <a href="/inventory-reorder/alerts" class="btn btn-sm" style="background:#f1f5f9;color:#475569;text-decoration:none;border-radius:8px;padding:9px 18px;font-size:13px">Clear</a>
        </form>
        <div style="overflow-x:auto"><table class="ro-tbl">
          <thead><tr><th>Type</th><th>Item</th><th>Stock</th><th>Message</th><th>Status</th><th>Created</th><th>Acknowledged</th><th>Actions</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="8" style="text-align:center;color:#94a3b8;padding:40px">No alerts found. All stock levels are healthy! 🎉</td></tr>'}</tbody>
        </table></div>
      </div>
    </div>`;
    res.send(renderPage('Stock Alerts', html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 8: POST /inventory-reorder/alerts/:id/acknowledge
  // ════════════════════════════════════════════════════════════
  app.post('/inventory-reorder/alerts/:id/acknowledge', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, id = req.params.id;
    const resolve = req.body.resolve === 'true';

    const alert = (await pool.query('SELECT id FROM reorder_alerts WHERE id = $1 AND tenant_id = $2', [id, tid])).rows[0];
    if (!alert) return res.redirect('/inventory-reorder/alerts');

    await pool.query(
      `UPDATE reorder_alerts SET status = $1, acknowledged_by = $2, acknowledged_at = NOW() WHERE id = $3 AND tenant_id = $4`,
      [resolve ? 'resolved' : 'acknowledged', user.id, id, tid]
    );

    // Redirect back to alerts page
    const backUrl = req.headers.referer || '/inventory-reorder/alerts';
    res.redirect(backUrl);
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 9: GET /inventory-reorder/auto-purchase — Review POs
  // ════════════════════════════════════════════════════════════
  app.get('/inventory-reorder/auto-purchase', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    await syncCurrentStock(tid);
    await checkThresholds(tid);

    // Pending purchase orders
    const pendingPOs = (await pool.query(`
      SELECT po.*, json_agg(json_build_object('id', poi.id, 'item_name', poi.item_name, 'item_id', poi.item_id,
        'quantity', poi.quantity, 'unit_cost', poi.unit_cost, 'total_cost', poi.total_cost)) as items
      FROM purchase_orders po
      LEFT JOIN purchase_order_items poi ON poi.po_id = po.id
      WHERE po.tenant_id = $1 AND po.status = 'pending'
      GROUP BY po.id
      ORDER BY po.created_at DESC LIMIT 50
    `, [tid])).rows;

    // Items that need reordering (below threshold but no pending PO)
    const needsOrder = (await pool.query(`
      SELECT r.* FROM reorder_rules r
      WHERE r.tenant_id = $1 AND r.status = 'active'
        AND r.current_stock <= r.reorder_level AND r.item_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM purchase_orders po
          WHERE po.source_rule_id = r.id AND po.status = 'pending'
        )
      ORDER BY r.current_stock ASC
    `, [tid])).rows;

    // All POs history
    const allPOs = (await pool.query(`
      SELECT po.*, json_agg(json_build_object('item_name', poi.item_name, 'quantity', poi.quantity, 'unit_cost', poi.unit_cost, 'total_cost', poi.total_cost)) as items
      FROM purchase_orders po
      LEFT JOIN purchase_order_items poi ON poi.po_id = po.id
      WHERE po.tenant_id = $1
      GROUP BY po.id
      ORDER BY po.created_at DESC LIMIT 30
    `, [tid])).rows;

    const totalPending = pendingPOs.reduce((sum, po) => sum + Number(po.total_amount || 0), 0);

    // Pending POs HTML
    const pendingHtml = pendingPOs.map(po => {
      const items = typeof po.items === 'string' ? JSON.parse(po.items) : (po.items || []);
      const itemsHtml = items.filter(i => i.item_name).map(i => `
        <tr>
          <td>${esc(i.item_name)}</td>
          <td style="text-align:center">${fmtNum(i.quantity)}</td>
          <td>${fmtMoney(i.unit_cost)}</td>
          <td style="font-weight:600">${fmtMoney(i.total_cost)}</td>
        </tr>
      `).join('');
      return `<div class="ro-card">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;margin-bottom:12px">
          <div>
            <h3 style="color:#1e293b;margin:0;font-size:15px">${esc(po.po_number)}</h3>
            <p style="font-size:12px;color:#94a3b8;margin:2px 0 0">Created: ${fmtDateTime(po.created_at)} · ${po.supplier_name ? 'Supplier: ' + esc(po.supplier_name) : 'No supplier'}</p>
            ${po.source_rule_id ? '<span style="font-size:11px;color:#7c3aed;background:#ede9fe;padding:2px 8px;border-radius:10px">Auto-generated</span>' : ''}
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            <div style="text-align:right">
              <div style="font-size:20px;font-weight:800;color:${THEME}">${fmtMoney(po.total_amount)}</div>
              <div style="font-size:11px;color:#94a3b8">Total</div>
            </div>
            <form method="POST" action="/inventory-reorder/auto-purchase/${po.id}/approve" style="display:inline" onsubmit="return confirm('Approve PO ${esc(po.po_number)}?')">
              <input type="hidden" name="_csrf" value="${esc(req.csrfToken || '')}">
              <button type="submit" class="btn" style="background:#16a34a;color:#fff;border:none;border-radius:8px;padding:8px 16px;font-size:13px;font-weight:600;cursor:pointer">✓ Approve</button>
            </form>
          </div>
        </div>
        <div style="overflow-x:auto"><table class="ro-tbl" style="font-size:12px">
          <thead><tr><th>Item</th><th style="text-align:center">Qty</th><th>Unit Cost</th><th>Total</th></tr></thead>
          <tbody>${itemsHtml}</tbody>
        </table></div>
      </div>`;
    }).join('');

    // Items needing order HTML
    const needsOrderHtml = needsOrder.map(r => {
      const estCost = (r.unit_cost || 0) * r.reorder_quantity;
      const light = stockLight(r.current_stock, r.reorder_level);
      return `<tr>
        <td>
          <div style="display:flex;align-items:center;gap:8px">
            <span>${light.icon}</span>
            <strong style="color:#1e293b">${esc(r.item_name)}</strong>
          </div>
        </td>
        <td style="font-weight:700;color:${light.color}">${fmtNum(r.current_stock)}</td>
        <td>${fmtNum(r.reorder_level)}</td>
        <td>${fmtNum(r.reorder_quantity)}</td>
        <td>${esc(r.supplier_name || '—')}</td>
        <td style="font-weight:600;color:${THEME}">${fmtMoney(estCost)}</td>
        <td>
          <form method="POST" action="/inventory-reorder/auto-purchase/${r.id}/approve" style="display:inline" onsubmit="return confirm('Generate PO for ${esc(r.item_name)}?')">
            <input type="hidden" name="_csrf" value="${esc(req.csrfToken || '')}">
            <button type="submit" class="btn btn-sm" style="background:${THEME};color:#fff;border:none;border-radius:6px;padding:4px 10px;font-size:11px;cursor:pointer">Generate PO</button>
          </form>
        </td>
      </tr>`;
    }).join('');

    // PO History
    const historyHtml = allPOs.map(po => {
      const items = typeof po.items === 'string' ? JSON.parse(po.items) : (po.items || []);
      const poStatusMap = {
        pending: { bg: '#fef3c7', c: '#b45309', l: '⏳ Pending' },
        approved: { bg: '#dcfce7', c: '#16a34a', l: '✅ Approved' },
        rejected: { bg: '#fee2e2', c: '#dc2626', l: '❌ Rejected' },
        delivered: { bg: '#dbeafe', c: '#2563eb', l: '📦 Delivered' }
      };
      const ps = poStatusMap[po.status] || poStatusMap.pending;
      return `<tr>
        <td><strong style="font-family:monospace;font-size:12px">${esc(po.po_number)}</strong></td>
        <td style="font-size:12px">${items.filter(i => i.item_name).map(i => esc(i.item_name)).join(', ') || '—'}</td>
        <td style="font-weight:600">${fmtMoney(po.total_amount)}</td>
        <td><span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;background:${ps.bg};color:${ps.c}">${ps.l}</span></td>
        <td style="font-size:12px;color:#64748b;white-space:nowrap">${fmtDateTime(po.created_at)}</td>
      </tr>`;
    }).join('');

    const html = REORDER_CSS + `
    <div style="max-width:1200px;margin:0 auto">
      ${nav('/inventory-reorder/auto-purchase')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div>
          <h1 style="font-size:24px;color:#1e293b">🛒 Auto Purchase Orders</h1>
          <p style="font-size:13px;color:#94a3b8;margin-top:2px">Review and approve auto-generated purchase orders</p>
        </div>
      </div>

      <!-- Pending Summary -->
      ${pendingPOs.length > 0 ? `
      <div class="ro-banner ro-banner-yellow">
        <span style="font-size:24px">📋</span>
        <div><strong>${pendingPOs.length} Pending Order${pendingPOs.length > 1 ? 's' : ''}</strong>
        <p style="margin:2px 0 0;opacity:.85">Total pending value: <strong>${fmtMoney(totalPending)}</strong></p></div>
        <a href="#pending-pos" class="btn" style="background:#d97706;color:#fff;padding:8px 18px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;margin-left:auto">Review →</a>
      </div>` : ''}

      <!-- Pending POs -->
      <div id="pending-pos">
        ${pendingHtml || `<div class="ro-card" style="text-align:center;padding:40px;color:#94a3b8">
          <span style="font-size:48px;display:block;margin-bottom:12px">📭</span>
          <p style="font-size:15px;font-weight:600;color:#475569">No Pending Purchase Orders</p>
          <p style="font-size:13px;margin-top:4px">Auto-generated POs will appear here for review.</p>
        </div>`}
      </div>

      <!-- Items Needing Reorder -->
      ${needsOrder.length > 0 ? `
      <div class="ro-card" style="margin-top:16px">
        <h3 style="color:${THEME};margin:0 0 14px;font-size:16px">📦 Items Needing Reorder (No Pending PO)</h3>
        <div style="overflow-x:auto"><table class="ro-tbl">
          <thead><tr><th>Item</th><th>Stock</th><th>Reorder At</th><th>Order Qty</th><th>Supplier</th><th>Est. Cost</th><th>Action</th></tr></thead>
          <tbody>${needsOrderHtml}</tbody>
        </table></div>
      </div>` : ''}

      <!-- PO History -->
      ${allPOs.length > 0 ? `
      <div class="ro-card" style="margin-top:16px">
        <h3 style="color:#1e293b;margin:0 0 14px;font-size:16px">📜 Purchase Order History</h3>
        <div style="overflow-x:auto"><table class="ro-tbl">
          <thead><tr><th>PO #</th><th>Items</th><th>Total</th><th>Status</th><th>Created</th></tr></thead>
          <tbody>${historyHtml}</tbody>
        </table></div>
      </div>` : ''}
    </div>`;
    res.send(renderPage('Auto Purchase Orders', html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 10: POST /inventory-reorder/auto-purchase/:id/approve
  // ════════════════════════════════════════════════════════════
  app.post('/inventory-reorder/auto-purchase/:id/approve', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, id = req.params.id;

    // Check if this is a purchase_order or a reorder_rule
    const po = (await pool.query('SELECT id, po_number, status FROM purchase_orders WHERE id = $1 AND tenant_id = $2', [id, tid])).rows[0];

    if (po) {
      // Approve existing purchase order
      if (po.status !== 'pending') return res.redirect('/inventory-reorder/auto-purchase');
      await pool.query('UPDATE purchase_orders SET status = $1, created_by = $2 WHERE id = $3', ['approved', user.id, id]);

      // Add stock movement for approved PO
      const items = (await pool.query(
        `SELECT * FROM purchase_order_items WHERE po_id = $1`, [id]
      )).rows;

      for (const item of items) {
        if (item.item_id) {
          // Get current stock
          const invItem = (await pool.query(
            `SELECT quantity FROM inventory_items WHERE id = $1 AND tenant_id = $2`, [item.item_id, tid]
          )).rows[0];

          if (invItem) {
            const prevQty = invItem.quantity || 0;
            const newQty = prevQty + item.quantity;

            await pool.query(
              `UPDATE inventory_items SET quantity = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`,
              [newQty, item.item_id, tid]
            );

            try {
              await pool.query(
                `INSERT INTO stock_movements (tenant_id, item_id, movement_type, quantity, reference, notes, previous_qty, new_qty, performed_by)
                 VALUES ($1,$2,'stock_in',$3,$4,$5,$6,$7,$8)`,
                [tid, item.item_id, item.quantity, po.po_number, 'Auto-reorder PO approved', prevQty, newQty, user.id]
              );
            } catch (e) { /* stock_movements may not exist */ }

            // Update reorder rule stock
            await pool.query(
              `UPDATE reorder_rules SET current_stock = $1 WHERE item_id = $2 AND tenant_id = $3`,
              [newQty, item.item_id, tid]
            );
          }
        }
      }

      // Create alert
      await pool.query(
        `INSERT INTO reorder_alerts (tenant_id, rule_id, alert_type, item_name, current_stock, reorder_level, message)
         SELECT $1, source_rule_id, 'auto_ordered', $2, 0, 0, $3
         FROM purchase_orders WHERE id = $4`,
        [tid, 'PO ' + (po.po_number || id) + ' approved and stock updated.', id]
      );

    } else {
      // Generate a new PO from a reorder rule
      const rule = (await pool.query(
        `SELECT * FROM reorder_rules WHERE id = $1 AND tenant_id = $2`, [id, tid]
      )).rows[0];

      if (!rule) return res.redirect('/inventory-reorder/auto-purchase');

      // Check if a pending PO already exists
      const existingPO = (await pool.query(
        `SELECT id FROM purchase_orders WHERE source_rule_id = $1 AND status = 'pending' AND tenant_id = $2`, [id, tid]
      )).rows;

      if (existingPO.length > 0) return res.redirect('/inventory-reorder/auto-purchase');

      const poNum = 'PO-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
      const totalCost = (rule.unit_cost || 0) * rule.reorder_quantity;

      const newPO = (await pool.query(
        `INSERT INTO purchase_orders (tenant_id, po_number, supplier_name, supplier_phone, supplier_email, status, total_amount, notes, source_rule_id, created_by)
         VALUES ($1,$2,$3,$4,$5,'approved',$6,$7,$8,$9) RETURNING id`,
        [tid, poNum, rule.supplier_name, rule.supplier_phone, rule.supplier_email, totalCost,
         'Manual reorder for ' + rule.item_name, rule.id, user.id]
      )).rows[0];

      await pool.query(
        `INSERT INTO purchase_order_items (po_id, item_name, item_id, quantity, unit_cost, total_cost)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [newPO.id, rule.item_name, rule.item_id, rule.reorder_quantity, rule.unit_cost || 0, totalCost]
      );

      // Add stock movement
      if (rule.item_id) {
        const invItem = (await pool.query(
          `SELECT quantity FROM inventory_items WHERE id = $1 AND tenant_id = $2`, [rule.item_id, tid]
        )).rows[0];

        if (invItem) {
          const prevQty = invItem.quantity || 0;
          const newQty = prevQty + rule.reorder_quantity;
          await pool.query(
            `UPDATE inventory_items SET quantity = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`,
            [newQty, rule.item_id, tid]
          );

          try {
            await pool.query(
              `INSERT INTO stock_movements (tenant_id, item_id, movement_type, quantity, reference, notes, previous_qty, new_qty, performed_by)
               VALUES ($1,$2,'stock_in',$3,$4,$5,$6,$7,$8)`,
              [tid, rule.item_id, rule.reorder_quantity, poNum, 'Manual reorder from rule', prevQty, newQty, user.id]
            );
          } catch (e) { /* stock_movements may not exist */ }

          await pool.query(
            `UPDATE reorder_rules SET current_stock = $1, last_ordered_at = NOW() WHERE id = $2`,
            [newQty, rule.id]
          );
        }
      }

      // Create alert
      await pool.query(
        `INSERT INTO reorder_alerts (tenant_id, rule_id, alert_type, item_name, current_stock, reorder_level, message)
         VALUES ($1,$2,'auto_ordered',$3,$4,$5,$6)`,
        [tid, rule.id, rule.item_name, rule.current_stock, rule.reorder_level,
         `PO #${poNum} approved for ${rule.reorder_quantity} units of "${rule.item_name}" at ${fmtMoney(rule.unit_cost)}/unit. Total: ${fmtMoney(totalCost)}.`]
      );
    }

    res.redirect('/inventory-reorder/auto-purchase');
  }));

  // ════════════════════════════════════════════════════════════
  // BONUS: GET /inventory/reorder-check — Manual Threshold Check
  // ════════════════════════════════════════════════════════════
  app.get('/inventory/reorder-check', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    await syncCurrentStock(tid);
    await checkThresholds(tid);
    res.redirect('/inventory-reorder');
  }));

  console.log('[InventoryReorder] Module loaded — 10 routes registered');
};
