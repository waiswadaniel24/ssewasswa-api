/**
 * Canteen / Meal Management Module
 * Multi-tenant SaaS platform (schools, organizations)
 *
 * Features: Menu planner, Ordering, Order queue, Inventory, Sales reports
 * 13 routes • PostgreSQL • tenant_id scoped
 */
module.exports = function canteen(app, db, pool, renderPage, esc) {

  // ── Helpers ────────────────────────────────────────────────────────────────
  const requireAuth = (req, res, next) => {
    if (!req.session || !req.session.user) return res.redirect('/login');
    next();
  };
  const navUrl = (action) => `/canteen${action}`;
  const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const DAYS = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
  const MEALS = ['breakfast','lunch','snack','dinner'];
  const STATUSES = ['pending','preparing','ready','fulfilled'];
  function fmtDate(d) { return d ? new Date(d).toISOString().split('T')[0] : '—'; }
  function fmtMoney(v) { return '$' + parseFloat(v || 0).toFixed(2); }
  function fmtStr(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // ── Migrations ─────────────────────────────────────────────────────────────
  async function migrate() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS canteen_menu (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        day_of_week VARCHAR(10), meal_type VARCHAR(20) DEFAULT 'lunch',
        item_name VARCHAR(255) NOT NULL, description TEXT, price NUMERIC(8,2) DEFAULT 0,
        calories INTEGER, is_available BOOLEAN DEFAULT true,
        tags TEXT[], is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS canteen_orders (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        order_number VARCHAR(20) UNIQUE, customer_name VARCHAR(255),
        items TEXT[], total_amount NUMERIC(10,2) DEFAULT 0,
        status VARCHAR(20) DEFAULT 'pending', payment_method VARCHAR(20),
        notes TEXT, ordered_at TIMESTAMPTZ DEFAULT NOW(),
        fulfilled_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS canteen_inventory (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        ingredient_name VARCHAR(255) NOT NULL, quantity NUMERIC(10,2),
        unit VARCHAR(20) DEFAULT 'kg', reorder_level NUMERIC(10,2) DEFAULT 5,
        supplier VARCHAR(255), last_restocked DATE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    const alters = [
      'ALTER TABLE canteen_menu ADD COLUMN IF NOT EXISTS day_of_week VARCHAR(10);',
      'ALTER TABLE canteen_menu ADD COLUMN IF NOT EXISTS meal_type VARCHAR(20) DEFAULT \'lunch\';',
      'ALTER TABLE canteen_menu ADD COLUMN IF NOT EXISTS item_name VARCHAR(255) NOT NULL DEFAULT \'\';',
      'ALTER TABLE canteen_menu ADD COLUMN IF NOT EXISTS description TEXT;',
      'ALTER TABLE canteen_menu ADD COLUMN IF NOT EXISTS price NUMERIC(8,2) DEFAULT 0;',
      'ALTER TABLE canteen_menu ADD COLUMN IF NOT EXISTS calories INTEGER;',
      'ALTER TABLE canteen_menu ADD COLUMN IF NOT EXISTS is_available BOOLEAN DEFAULT true;',
      'ALTER TABLE canteen_menu ADD COLUMN IF NOT EXISTS tags TEXT[];',
      'ALTER TABLE canteen_menu ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;',
      'ALTER TABLE canteen_orders ADD COLUMN IF NOT EXISTS order_number VARCHAR(20) UNIQUE;',
      'ALTER TABLE canteen_orders ADD COLUMN IF NOT EXISTS customer_name VARCHAR(255);',
      'ALTER TABLE canteen_orders ADD COLUMN IF NOT EXISTS items TEXT[];',
      'ALTER TABLE canteen_orders ADD COLUMN IF NOT EXISTS total_amount NUMERIC(10,2) DEFAULT 0;',
      'ALTER TABLE canteen_orders ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT \'pending\';',
      'ALTER TABLE canteen_orders ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20);',
      'ALTER TABLE canteen_orders ADD COLUMN IF NOT EXISTS notes TEXT;',
      'ALTER TABLE canteen_orders ADD COLUMN IF NOT EXISTS ordered_at TIMESTAMPTZ DEFAULT NOW();',
      'ALTER TABLE canteen_orders ADD COLUMN IF NOT EXISTS fulfilled_at TIMESTAMPTZ;',
      'ALTER TABLE canteen_inventory ADD COLUMN IF NOT EXISTS ingredient_name VARCHAR(255) NOT NULL DEFAULT \'\';',
      'ALTER TABLE canteen_inventory ADD COLUMN IF NOT EXISTS quantity NUMERIC(10,2);',
      'ALTER TABLE canteen_inventory ADD COLUMN IF NOT EXISTS unit VARCHAR(20) DEFAULT \'kg\';',
      'ALTER TABLE canteen_inventory ADD COLUMN IF NOT EXISTS reorder_level NUMERIC(10,2) DEFAULT 5;',
      'ALTER TABLE canteen_inventory ADD COLUMN IF NOT EXISTS supplier VARCHAR(255);',
      'ALTER TABLE canteen_inventory ADD COLUMN IF NOT EXISTS last_restocked DATE;',
    ];
    for (const sql of alters) { try { await pool.query(sql); } catch (_) { /* exists */ } }

    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_cm_tenant ON canteen_menu(tenant_id);',
      'CREATE INDEX IF NOT EXISTS idx_cm_day ON canteen_menu(day_of_week);',
      'CREATE INDEX IF NOT EXISTS idx_cm_meal ON canteen_menu(meal_type);',
      'CREATE INDEX IF NOT EXISTS idx_cm_active ON canteen_menu(is_active);',
      'CREATE INDEX IF NOT EXISTS idx_co_tenant ON canteen_orders(tenant_id);',
      'CREATE INDEX IF NOT EXISTS idx_co_status ON canteen_orders(status);',
      'CREATE INDEX IF NOT EXISTS idx_co_ordered ON canteen_orders(ordered_at);',
      'CREATE INDEX IF NOT EXISTS idx_ci_tenant ON canteen_inventory(tenant_id);',
    ];
    for (const sql of indexes) { try { await pool.query(sql); } catch (_) { /* exists */ } }
  }

  // ── Shared nav ─────────────────────────────────────────────────────────────
  function nav(active) {
    const links = [
      ['Dashboard', navUrl('')], ['Menu Planner', navUrl('/menu')],
      ['Place Order', navUrl('/order')], ['Order Queue', navUrl('/orders')],
      ['Inventory', navUrl('/inventory')], ['Reports', navUrl('/report')],
    ];
    return '<nav class="grid" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin-bottom:24px;">' +
      links.map(([label, href]) =>
        `<a href="${href}" class="btn btn-sm ${active === label ? 'btn-green' : 'btn-blue'}">${label}</a>`
      ).join('') + '</nav>';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 1 — Dashboard
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/canteen', requireAuth, async (req, res) => {
    const tid = req.session.user.tenant_id;
    const today = DAYS[new Date().getDay() === 0 ? 6 : new Date().getDay() - 1];

    const [menuToday, ordersToday, revenueRes, lowStock] = await Promise.all([
      pool.query(
        `SELECT * FROM canteen_menu
         WHERE tenant_id=$1 AND day_of_week=$2 AND is_active=true AND is_available=true
         ORDER BY meal_type, item_name`, [tid, today]),
      pool.query(
        `SELECT * FROM canteen_orders
         WHERE tenant_id=$1 AND ordered_at >= CURRENT_DATE
         ORDER BY ordered_at DESC`, [tid]),
      pool.query(
        `SELECT COALESCE(SUM(total_amount),0)::numeric AS total
         FROM canteen_orders
         WHERE tenant_id=$1 AND ordered_at >= CURRENT_DATE
         AND status IN ('fulfilled','ready')`, [tid]),
      pool.query(
        `SELECT * FROM canteen_inventory
         WHERE tenant_id=$1 AND quantity <= reorder_level
         ORDER BY quantity ASC LIMIT 10`, [tid]),
    ]);

    const orderCount = ordersToday.rows.length;
    const pendingCount = ordersToday.rows.filter(o => o.status === 'pending').length;
    const revenue = parseFloat(revenueRes.rows[0].total || 0);

    let html = nav('Dashboard');

    // Stats row
    html += '<div class="stats">';
    html += `<div class="stat-card"><div class="stat-num">${menuToday.rows.length}</div><div>Today's Menu Items</div></div>`;
    html += `<div class="stat-card"><div class="stat-num">${orderCount}</div><div>Orders Today</div></div>`;
    html += `<div class="stat-card"><div class="stat-num">${pendingCount}</div><div>Pending</div></div>`;
    html += `<div class="stat-card"><div class="stat-num">${fmtMoney(revenue)}</div><div>Revenue Today</div></div>`;
    html += `<div class="stat-card"><div class="stat-num">${lowStock.rows.length}</div><div>Low Stock Alerts</div></div>`;
    html += '</div>';

    html += '<div class="grid" style="grid-template-columns:1fr 1fr;gap:20px;">';

    // Today's menu card
    html += '<div class="card"><h3>Today\'s Menu (' + fmtStr(today) + ')</h3>';
    if (menuToday.rows.length) {
      html += '<table><tr><th>Meal</th><th>Item</th><th>Price</th><th>Calories</th></tr>';
      menuToday.rows.forEach(m => {
        const tagStr = (m.tags || []).length ? ' <small class="muted">[' + (m.tags||[]).join(', ') + ']</small>' : '';
        html += `<tr><td><span class="badge">${fmtStr(m.meal_type)}</span></td>
          <td>${esc(m.item_name)}${tagStr}</td>
          <td>${fmtMoney(m.price)}</td><td>${m.calories || '—'} kcal</td></tr>`;
      });
      html += '</table>';
    } else { html += '<p class="muted">No menu items for today. Visit the menu planner to add items.</p>'; }
    html += '</div>';

    // Low stock alerts
    html += '<div class="card"><h3>Low Stock Ingredients</h3>';
    if (lowStock.rows.length) {
      html += '<table><tr><th>Ingredient</th><th>Qty</th><th>Unit</th><th>Reorder Level</th><th>Action</th></tr>';
      lowStock.rows.forEach(i => {
        html += `<tr><td>${esc(i.ingredient_name)}</td>
          <td><span class="badge badge-warning">${parseFloat(i.quantity).toFixed(1)}</span></td>
          <td>${esc(i.unit)}</td><td>${parseFloat(i.reorder_level).toFixed(1)}</td>
          <td><a href="${navUrl('/inventory')}" class="btn btn-sm btn-gold">Restock</a></td></tr>`;
      });
      html += '</table>';
    } else { html += '<p class="muted">All ingredients are sufficiently stocked.</p>'; }
    html += '</div></div>';

    // Recent orders
    html += '<div class="card" style="margin-top:20px;"><h3>Recent Orders</h3>';
    if (ordersToday.rows.length) {
      html += '<table><tr><th>Order #</th><th>Customer</th><th>Items</th><th>Total</th><th>Status</th><th>Time</th></tr>';
      ordersToday.rows.slice(0, 10).forEach(o => {
        const sb = o.status === 'fulfilled' ? '<span class="badge badge-success">Fulfilled</span>'
          : o.status === 'ready' ? '<span class="badge badge-success">Ready</span>'
          : o.status === 'preparing' ? '<span class="badge badge-warning">Preparing</span>'
          : '<span class="badge">Pending</span>';
        const itemsPreview = (o.items || []).slice(0, 3).join(', ') + ((o.items||[]).length > 3 ? '…' : '');
        html += `<tr><td><strong>${esc(o.order_number || '#' + o.id)}</strong></td>
          <td>${esc(o.customer_name || '—')}</td><td>${esc(itemsPreview)}</td>
          <td>${fmtMoney(o.total_amount)}</td><td>${sb}</td>
          <td><small class="muted">${o.ordered_at ? new Date(o.ordered_at).toLocaleTimeString() : '—'}</small></td></tr>`;
      });
      html += '</table>';
    } else { html += '<p class="muted">No orders placed today.</p>'; }
    html += '</div>';

    res.send(renderPage('Canteen Dashboard', html, req.session.user, req));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 2 — Weekly Menu Planner
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/canteen/menu', requireAuth, async (req, res) => {
    const tid = req.session.user.tenant_id;
    const menuItems = await pool.query(
      `SELECT * FROM canteen_menu WHERE tenant_id=$1 AND is_active=true
       ORDER BY day_of_week, meal_type, item_name`, [tid]);

    // Group into a lookup: lookup[day][meal] = [items]
    const lookup = {};
    DAYS.forEach(d => { lookup[d] = {}; MEALS.forEach(m => { lookup[d][m] = []; }); });
    menuItems.rows.forEach(item => {
      const day = item.day_of_week || 'monday';
      const meal = item.meal_type || 'lunch';
      if (lookup[day] && lookup[day][meal]) lookup[day][meal].push(item);
    });

    let html = nav('Menu Planner');
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">' +
      '<h2>Weekly Menu Planner</h2>' +
      `<a href="#add-item" class="btn btn-green">+ Add Menu Item</a></div>`;

    // Weekly grid
    html += '<div style="overflow-x:auto;">';
    html += '<table style="min-width:900px;"><thead><tr><th style="width:100px;">Day / Meal</th>';
    MEALS.forEach(m => { html += `<th>${fmtStr(m)}</th>`; });
    html += '</tr></thead><tbody>';

    DAYS.forEach(day => {
      const isToday = day === DAYS[new Date().getDay() === 0 ? 6 : new Date().getDay() - 1];
      html += `<tr style="${isToday ? 'background:#f0f7ff;' : ''}">`;
      html += `<td><strong>${fmtStr(day)}</strong>${isToday ? ' <span class="badge badge-success">Today</span>' : ''}</td>`;
      MEALS.forEach(meal => {
        const items = lookup[day][meal] || [];
        html += '<td style="vertical-align:top;padding:8px;">';
        if (items.length) {
          items.forEach(item => {
            const availBadge = item.is_available
              ? ''
              : ' <span class="badge badge-warning">Off</span>';
            html += `<div style="margin-bottom:6px;padding:4px 0;border-bottom:1px solid #eee;">
              <strong>${esc(item.item_name)}</strong>${availBadge}<br>
              <small class="muted">${fmtMoney(item.price)}${item.calories ? ' · ' + item.calories + ' kcal' : ''}</small><br>
              <form method="POST" action="${navUrl('/menu/' + item.id + '/delete')}" style="display:inline;margin-top:2px;"
                onsubmit="return confirm('Remove ${esc(item.item_name)} from the menu?')">
                <button class="btn btn-sm btn-red">Remove</button></form></div>`;
          });
        } else {
          html += '<span class="muted">No items</span>';
        }
        html += '</td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table></div>';

    // Add menu item form
    html += `<div id="add-item" class="card" style="margin-top:24px;"><h3>Add Menu Item</h3>
      <form method="POST" action="${navUrl('/menu/add')}">
      <table>
        <tr><td><label>Item Name *</label></td>
          <td><input name="item_name" required style="width:300px;padding:8px;" placeholder="e.g. Grilled Chicken Bowl"></td></tr>
        <tr><td><label>Description</label></td>
          <td><textarea name="description" rows="2" style="width:100%;max-width:400px;padding:8px;"></textarea></td></tr>
        <tr><td><label>Day of Week</label></td>
          <td><select name="day_of_week" style="padding:8px;">
            ${DAYS.map(d => `<option value="${d}">${fmtStr(d)}</option>`).join('')}
          </select></td></tr>
        <tr><td><label>Meal Type</label></td>
          <td><select name="meal_type" style="padding:8px;">
            ${MEALS.map(m => `<option value="${m}">${fmtStr(m)}</option>`).join('')}
          </select></td></tr>
        <tr><td><label>Price ($)</label></td>
          <td><input name="price" type="number" step="0.01" min="0" value="0" style="width:120px;padding:8px;"></td></tr>
        <tr><td><label>Calories</label></td>
          <td><input name="calories" type="number" min="0" style="width:120px;padding:8px;" placeholder="e.g. 450"></td></tr>
        <tr><td><label>Tags</label></td>
          <td><input name="tags" style="width:300px;padding:8px;" placeholder="e.g. vegetarian,gluten-free"></td></tr>
      </table><br>
      <button type="submit" class="btn btn-green">Add to Menu</button>
    </form></div>`;

    res.send(renderPage('Weekly Menu Planner', html, req.session.user, req));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 3 — Add menu item
  // ═══════════════════════════════════════════════════════════════════════════
  app.post('/canteen/menu/add', requireAuth, async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { item_name, description, day_of_week, meal_type, price, calories, tags } = req.body;
    if (!item_name || !item_name.trim()) {
      return res.send('<div class="alert">Item name is required.</div><a href="javascript:history.back()">Go back</a>');
    }
    const tagsArr = tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [];
    await pool.query(
      `INSERT INTO canteen_menu (tenant_id,item_name,description,day_of_week,meal_type,price,calories,tags)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [tid, item_name.trim(), description || null, day_of_week || null,
        meal_type || 'lunch', parseFloat(price) || 0,
        calories ? parseInt(calories) : null, tagsArr]);
    res.redirect(navUrl('/menu'));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 4 — Delete menu item
  // ═══════════════════════════════════════════════════════════════════════════
  app.delete('/canteen/menu/:id', requireAuth, async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { id } = req.params;
    const result = await pool.query(
      'DELETE FROM canteen_menu WHERE id=$1 AND tenant_id=$2', [id, tid]);
    if (result.rowCount === 0) return res.status(404).send('Menu item not found.');
    res.json({ ok: true });
  });

  // ROUTE 5 — Save entire weekly menu
  // ═══════════════════════════════════════════════════════════════════════════
  app.post('/canteen/menu/weekly', requireAuth, async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { menu_data } = req.body;
    if (!menu_data) return res.send('<div class="alert">No menu data provided.</div><a href="javascript:history.back()">Go back</a>');
    let parsed;
    try { parsed = JSON.parse(menu_data); } catch (e) {
      return res.send('<div class="alert">Invalid menu data format.</div><a href="javascript:history.back()">Go back</a>');
    }
    await pool.query('UPDATE canteen_menu SET is_active=false WHERE tenant_id=$1', [tid]);
    for (const entry of parsed) {
      if (!entry.item_name || !entry.item_name.trim()) continue;
      const tagsArr = (entry.tags || []).map(t => String(t).trim()).filter(Boolean);
      await pool.query(
        `INSERT INTO canteen_menu (tenant_id,item_name,description,day_of_week,meal_type,price,calories,tags,is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true)`,
        [tid, entry.item_name.trim(), entry.description || null,
          entry.day_of_week || 'monday', entry.meal_type || 'lunch',
          parseFloat(entry.price) || 0, entry.calories ? parseInt(entry.calories) : null, tagsArr]);
    }
    res.redirect(navUrl('/menu'));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 6 — Order page (select from available items)
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/canteen/order', requireAuth, async (req, res) => {
    const tid = req.session.user.tenant_id;
    const today = DAYS[new Date().getDay() === 0 ? 6 : new Date().getDay() - 1];

    const availableItems = await pool.query(
      `SELECT * FROM canteen_menu
       WHERE tenant_id=$1 AND is_active=true AND is_available=true
       AND (day_of_week IS NULL OR day_of_week=$2)
       ORDER BY meal_type, item_name`, [tid, today]);

    // Group by meal type
    const byMeal = {};
    MEALS.forEach(m => { byMeal[m] = []; });
    availableItems.rows.forEach(item => {
      const meal = item.meal_type || 'lunch';
      if (byMeal[meal]) byMeal[meal].push(item);
    });

    let html = nav('Place Order');
    html += `<h2>Place an Order</h2>`;
    html += `<p class="muted">Today is <strong>${fmtStr(today)}</strong>. Select items from the available menu below.</p>`;

    html += `<form method="POST" action="${navUrl('/order/place')}">
      <table>
        <tr><td><label>Your Name *</label></td>
          <td><input name="customer_name" required value="${esc(req.session.user.name || '')}" style="width:300px;padding:8px;"></td></tr>
        <tr><td><label>Payment Method</label></td>
          <td><select name="payment_method" style="padding:8px;">
            <option value="cash">Cash</option>
            <option value="card">Card</option>
            <option value="mobile">Mobile Pay</option>
            <option value="meal_plan">Meal Plan</option>
          </select></td></tr>
        <tr><td><label>Notes</label></td>
          <td><input name="notes" style="width:300px;padding:8px;" placeholder="Allergies, special requests..."></td></tr>
      </table><br>`;

    MEALS.forEach(meal => {
      const items = byMeal[meal];
      if (!items.length) return;
      html += `<div class="card" style="margin-bottom:16px;"><h3>${fmtStr(meal)}</h3>`;
      html += '<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;">';
      items.forEach(item => {
        const tagStr = (item.tags || []).length ? '<br><small class="muted">' + (item.tags||[]).join(', ') + '</small>' : '';
        html += `<label class="card" style="cursor:pointer;display:block;padding:12px;">
          <input type="checkbox" name="items" value="${item.id}"> <strong>${esc(item.item_name)}</strong><br>
          <small>${esc(item.description || '')}</small>${tagStr}<br>
          ${fmtMoney(item.price)}${item.calories ? ' &middot; ' + item.calories + ' kcal' : ''}
        </label>`;
      });
      html += '</div></div>';
    });

    if (!availableItems.rows.length) {
      html += '<div class="card"><p class="muted">No menu items available for today. Check back later or contact the canteen manager.</p></div>';
    }

    html += `<button type="submit" class="btn btn-green" ${!availableItems.rows.length ? 'disabled' : ''}>Place Order</button>
    </form>`;

    res.send(renderPage('Place Order', html, req.session.user, req));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 7 — Place order
  // ═══════════════════════════════════════════════════════════════════════════
  app.post('/canteen/order/place', requireAuth, async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { customer_name, payment_method, notes, items } = req.body;

    if (!customer_name || !customer_name.trim()) {
      return res.send('<div class="alert">Your name is required.</div><a href="javascript:history.back()">Go back</a>');
    }
    const selectedItemIds = Array.isArray(items) ? items : (items ? [items] : []);
    if (selectedItemIds.length === 0) {
      return res.send('<div class="alert">Please select at least one item.</div><a href="javascript:history.back()">Go back</a>');
    }

    // Fetch selected items with prices
    const itemIds = selectedItemIds.map(id => parseInt(id));
    const menuResult = await pool.query(
      `SELECT id, item_name, price FROM canteen_menu
       WHERE id = ANY($1) AND tenant_id=$2 AND is_active=true AND is_available=true`,
      [itemIds, tid]);

    if (menuResult.rows.length === 0) {
      return res.send('<div class="alert">Selected items are no longer available.</div><a href="javascript:history.back()">Go back</a>');
    }

    const orderItems = menuResult.rows.map(r => r.item_name);
    const totalAmount = menuResult.rows.reduce((sum, r) => sum + parseFloat(r.price || 0), 0);

    // Generate order number
    const orderNum = 'ORD-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();

    await pool.query(
      `INSERT INTO canteen_orders (tenant_id,order_number,customer_name,items,total_amount,payment_method,notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [tid, orderNum, customer_name.trim(), orderItems, totalAmount,
        payment_method || 'cash', notes || null]);

    res.redirect(navUrl('/orders'));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 8 — Order queue with status management
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/canteen/orders', requireAuth, async (req, res) => {
    const tid = req.session.user.tenant_id;
    const statusFilter = req.query.status || '';

    let where = 'o.tenant_id=$1';
    const params = [tid];
    if (statusFilter) {
      where += ' AND o.status=$2';
      params.push(statusFilter);
    }

    const orders = await pool.query(
      `SELECT * FROM canteen_orders o WHERE ${where} ORDER BY o.ordered_at DESC`, params);

    // Status counts for filter tabs
    const countRes = await pool.query(
      `SELECT status, COUNT(*)::int AS c FROM canteen_orders
       WHERE tenant_id=$1 GROUP BY status`, [tid]);
    const countMap = {};
    countRes.rows.forEach(r => { countMap[r.status] = r.c; });

    let html = nav('Order Queue');
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">' +
      '<h2>Order Queue</h2></div>';

    // Filter tabs
    html += '<div style="margin-bottom:16px;">';
    html += `<a href="${navUrl('/orders')}" class="btn btn-sm ${!statusFilter ? 'btn-green' : ''}">All (${orders.rows.length})</a> `;
    STATUSES.forEach(s => {
      html += `<a href="${navUrl('/orders?status=' + s)}" class="btn btn-sm ${statusFilter === s ? 'btn-green' : ''}">${fmtStr(s)} (${countMap[s] || 0})</a> `;
    });
    html += '</div>';

    // Status progress summary
    html += '<div class="stats" style="margin-bottom:20px;">';
    STATUSES.forEach(s => {
      html += `<div class="stat-card"><div class="stat-num">${countMap[s] || 0}</div><div>${fmtStr(s)}</div></div>`;
    });
    html += '</div>';

    if (orders.rows.length) {
      html += '<table><tr><th>Order #</th><th>Customer</th><th>Items</th><th>Total</th>' +
        '<th>Payment</th><th>Status</th><th>Ordered</th><th>Actions</th></tr>';
      orders.rows.forEach(o => {
        const sb = o.status === 'fulfilled' ? '<span class="badge badge-success">Fulfilled</span>'
          : o.status === 'ready' ? '<span class="badge badge-success">Ready</span>'
          : o.status === 'preparing' ? '<span class="badge badge-warning">Preparing</span>'
          : '<span class="badge">Pending</span>';
        const itemStr = (o.items || []).join(', ');
        const noteHint = o.notes ? ' <span class="muted" title="' + esc(o.notes) + '">📝</span>' : '';
        const nextStatus = o.status === 'pending' ? 'preparing'
          : o.status === 'preparing' ? 'ready'
          : o.status === 'ready' ? 'fulfilled' : null;
        const actionBtn = nextStatus
          ? `<form method="POST" action="${navUrl('/orders/' + o.id + '/status')}" style="display:inline">
              <input type="hidden" name="status" value="${nextStatus}">
              <button class="btn btn-sm btn-green">${fmtStr(nextStatus)}</button></form>`
          : '<span class="muted">Done</span>';
        html += `<tr>
          <td><strong>${esc(o.order_number || '#' + o.id)}</strong></td>
          <td>${esc(o.customer_name || '—')}${noteHint}</td>
          <td style="max-width:250px;">${esc(itemStr)}</td>
          <td><strong>${fmtMoney(o.total_amount)}</strong></td>
          <td>${esc(o.payment_method || '—')}</td>
          <td>${sb}</td>
          <td><small class="muted">${o.ordered_at ? new Date(o.ordered_at).toLocaleString() : '—'}</small></td>
          <td>${actionBtn}</td></tr>`;
      });
      html += '</table>';
    } else {
      html += '<div class="card"><p class="muted">No orders found.</p></div>';
    }

    res.send(renderPage('Order Queue', html, req.session.user, req));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 9 — Update order status
  // ═══════════════════════════════════════════════════════════════════════════
  app.post('/canteen/orders/:id/status', requireAuth, async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { id } = req.params;
    const { status } = req.body;

    const validTransitions = {
      'pending': 'preparing',
      'preparing': 'ready',
      'ready': 'fulfilled',
    };

    if (!status || !STATUSES.includes(status)) {
      return res.send('<div class="alert">Invalid status.</div><a href="javascript:history.back()">Go back</a>');
    }

    // Get current status
    const orderRes = await pool.query(
      'SELECT status FROM canteen_orders WHERE id=$1 AND tenant_id=$2', [id, tid]);
    if (!orderRes.rows.length) return res.status(404).send('Order not found.');
    const current = orderRes.rows[0].status;

    // Validate transition
    if (validTransitions[current] !== status) {
      return res.send('<div class="alert">Cannot transition from ' + fmtStr(current) + ' to ' + fmtStr(status) + '.</div><a href="javascript:history.back()">Go back</a>');
    }

    const updateFields = status === 'fulfilled'
      ? 'status=$1, fulfilled_at=NOW()'
      : 'status=$1';
    await pool.query(
      `UPDATE canteen_orders SET ${updateFields} WHERE id=$2 AND tenant_id=$3`,
      [status, id, tid]);

    res.redirect(navUrl('/orders'));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 10 — Ingredient Inventory
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/canteen/inventory', requireAuth, async (req, res) => {
    const tid = req.session.user.tenant_id;
    const inventory = await pool.query(
      `SELECT * FROM canteen_inventory WHERE tenant_id=$1
       ORDER BY ingredient_name`, [tid]);

    const lowCount = inventory.rows.filter(i => parseFloat(i.quantity) <= parseFloat(i.reorder_level)).length;
    const totalItems = inventory.rows.length;

    let html = nav('Inventory');
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">' +
      '<h2>Ingredient Inventory</h2>' +
      `<a href="#add-ingredient" class="btn btn-green">+ Add Ingredient</a></div>`;

    html += '<div class="stats">';
    html += `<div class="stat-card"><div class="stat-num">${totalItems}</div><div>Total Ingredients</div></div>`;
    html += `<div class="stat-card"><div class="stat-num">${lowCount}</div><div>Low Stock</div></div>`;
    html += '</div>';

    if (inventory.rows.length) {
      html += '<table><tr><th>Ingredient</th><th>Quantity</th><th>Unit</th>' +
        '<th>Reorder Level</th><th>Supplier</th><th>Last Restocked</th><th>Status</th><th>Actions</th></tr>';
      inventory.rows.forEach(i => {
        const qty = parseFloat(i.quantity || 0);
        const reorder = parseFloat(i.reorder_level || 0);
        const isLow = qty <= reorder;
        const statusBadge = isLow
          ? '<span class="badge badge-warning">Low Stock</span>'
          : '<span class="badge badge-success">OK</span>';
        html += `<tr style="${isLow ? 'background:#fff8e1;' : ''}">
          <td><strong>${esc(i.ingredient_name)}</strong></td>
          <td>${qty.toFixed(1)}</td>
          <td>${esc(i.unit)}</td>
          <td>${reorder.toFixed(1)}</td>
          <td>${esc(i.supplier || '—')}</td>
          <td>${fmtDate(i.last_restocked)}</td>
          <td>${statusBadge}</td>
          <td>
            <form method="POST" action="${navUrl('/inventory/' + i.id + '/update')}" style="display:inline">
              <input name="quantity" type="number" step="0.1" min="0" value="${qty}" style="width:80px;padding:4px;">
              <button class="btn btn-sm btn-gold">Update</button></form>
          </td></tr>`;
      });
      html += '</table>';
    } else {
      html += '<div class="card"><p class="muted">No ingredients in inventory.</p></div>';
    }

    // Add ingredient form
    html += `<div id="add-ingredient" class="card" style="margin-top:24px;"><h3>Add / Restock Ingredient</h3>
      <form method="POST" action="${navUrl('/inventory/add')}">
      <table>
        <tr><td><label>Ingredient Name *</label></td>
          <td><input name="ingredient_name" required style="width:300px;padding:8px;" placeholder="e.g. Chicken Breast"></td></tr>
        <tr><td><label>Quantity</label></td>
          <td><input name="quantity" type="number" step="0.1" min="0" value="0" style="width:150px;padding:8px;"></td></tr>
        <tr><td><label>Unit</label></td>
          <td><select name="unit" style="padding:8px;">
            <option value="kg">Kg</option><option value="g">Grams</option><option value="litre">Litre</option>
            <option value="ml">ml</option><option value="pieces">Pieces</option><option value="dozen">Dozen</option>
            <option value="packs">Packs</option>
          </select></td></tr>
        <tr><td><label>Reorder Level</label></td>
          <td><input name="reorder_level" type="number" step="0.1" min="0" value="5" style="width:120px;padding:8px;"></td></tr>
        <tr><td><label>Supplier</label></td>
          <td><input name="supplier" style="width:300px;padding:8px;" placeholder="e.g. Fresh Farms Ltd"></td></tr>
      </table><br>
      <button type="submit" class="btn btn-green">Add Ingredient</button>
    </form></div>`;

    res.send(renderPage('Ingredient Inventory', html, req.session.user, req));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 11 — Add / Restock ingredient
  // ═══════════════════════════════════════════════════════════════════════════
  app.post('/canteen/inventory/add', requireAuth, async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { ingredient_name, quantity, unit, reorder_level, supplier } = req.body;
    if (!ingredient_name || !ingredient_name.trim()) {
      return res.send('<div class="alert">Ingredient name is required.</div><a href="javascript:history.back()">Go back</a>');
    }

    // Check if ingredient already exists — if so, update quantity
    const existing = await pool.query(
      'SELECT id FROM canteen_inventory WHERE tenant_id=$1 AND LOWER(ingredient_name)=LOWER($2)',
      [tid, ingredient_name.trim()]);

    if (existing.rows.length) {
      const addQty = parseFloat(quantity) || 0;
      await pool.query(
        `UPDATE canteen_inventory
         SET quantity = quantity + $1, last_restocked = CURRENT_DATE
         WHERE id=$2 AND tenant_id=$3`,
        [addQty, existing.rows[0].id, tid]);
    } else {
      await pool.query(
        `INSERT INTO canteen_inventory (tenant_id,ingredient_name,quantity,unit,reorder_level,supplier,last_restocked)
         VALUES ($1,$2,$3,$4,$5,$6,CURRENT_DATE)`,
        [tid, ingredient_name.trim(), parseFloat(quantity) || 0,
          unit || 'kg', parseFloat(reorder_level) || 5,
          supplier || null]);
    }
    res.redirect(navUrl('/inventory'));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 12 — Update ingredient quantity
  // ═══════════════════════════════════════════════════════════════════════════
  app.post('/canteen/inventory/:id/update', requireAuth, async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { id } = req.params;
    const { quantity } = req.body;

    const check = await pool.query(
      'SELECT id FROM canteen_inventory WHERE id=$1 AND tenant_id=$2', [id, tid]);
    if (!check.rows.length) return res.status(404).send('Ingredient not found.');

    const newQty = parseFloat(quantity) || 0;
    await pool.query(
      `UPDATE canteen_inventory SET quantity=$1, last_restocked=CURRENT_DATE
       WHERE id=$2 AND tenant_id=$3`,
      [newQty, id, tid]);

    res.redirect(navUrl('/inventory'));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 13 — Sales Reports
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/canteen/report', requireAuth, async (req, res) => {
    const tid = req.session.user.tenant_id;

    const [dailyRevenue, weeklyRevenue] = await Promise.all([
      pool.query(`SELECT DATE(ordered_at) AS order_date, COUNT(*)::int AS order_count,
        COALESCE(SUM(total_amount),0)::numeric AS revenue,
        COALESCE(AVG(total_amount),0)::numeric AS avg_order
        FROM canteen_orders WHERE tenant_id=$1 AND ordered_at >= CURRENT_DATE - INTERVAL '7 days'
        GROUP BY DATE(ordered_at) ORDER BY order_date DESC`, [tid]),
      pool.query(`SELECT DATE_TRUNC('week', ordered_at)::date AS week_start,
        COUNT(*)::int AS order_count, COALESCE(SUM(total_amount),0)::numeric AS revenue
        FROM canteen_orders WHERE tenant_id=$1 AND ordered_at >= CURRENT_DATE - INTERVAL '28 days'
        GROUP BY DATE_TRUNC('week', ordered_at) ORDER BY week_start DESC`, [tid]),
    ]);

    const [allOrders, paymentBreakdown, peakHours] = await Promise.all([
      pool.query(`SELECT items, total_amount FROM canteen_orders WHERE tenant_id=$1
        AND items IS NOT NULL AND items <> '{}' AND ordered_at >= CURRENT_DATE - INTERVAL '30 days'`, [tid]),
      pool.query(`SELECT payment_method, COUNT(*)::int AS c, COALESCE(SUM(total_amount),0)::numeric AS amount
        FROM canteen_orders WHERE tenant_id=$1 AND ordered_at >= CURRENT_DATE - INTERVAL '30 days'
        AND payment_method IS NOT NULL GROUP BY payment_method ORDER BY amount DESC`, [tid]),
      pool.query(`SELECT EXTRACT(HOUR FROM ordered_at)::int AS hour, COUNT(*)::int AS order_count
        FROM canteen_orders WHERE tenant_id=$1 AND ordered_at >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY EXTRACT(HOUR FROM ordered_at) ORDER BY order_count DESC LIMIT 8`, [tid]),
    ]);
    const itemPopularity = {};
    let totalRevenue30 = 0;
    allOrders.rows.forEach(o => {
      totalRevenue30 += parseFloat(o.total_amount || 0);
      (o.items || []).forEach(item => { itemPopularity[item.trim().toLowerCase()] = (itemPopularity[item.trim().toLowerCase()] || 0) + 1; });
    });
    const popularItems = Object.entries(itemPopularity).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([name, count]) => ({ name, count }));

    let html = nav('Reports');
    html += '<h2>Sales Reports</h2>';

    // 30-day summary
    const totalOrders30 = allOrders.rows.length;
    const avgOrder30 = totalOrders30 > 0 ? (totalRevenue30 / totalOrders30) : 0;

    html += '<div class="stats">';
    html += `<div class="stat-card"><div class="stat-num">${fmtMoney(totalRevenue30)}</div><div>Revenue (30 days)</div></div>`;
    html += `<div class="stat-card"><div class="stat-num">${totalOrders30}</div><div>Orders (30 days)</div></div>`;
    html += `<div class="stat-card"><div class="stat-num">${fmtMoney(avgOrder30)}</div><div>Avg Order Value</div></div>`;
    html += '</div>';

    html += '<div class="grid" style="grid-template-columns:1fr 1fr;gap:20px;">';

    html += '<div class="card"><h3>Daily Revenue (7 days)</h3>';
    if (dailyRevenue.rows.length) {
      html += '<table><tr><th>Date</th><th>Orders</th><th>Revenue</th><th>Avg Order</th></tr>';
      dailyRevenue.rows.forEach(r => {
        html += `<tr><td>${fmtDate(r.order_date)}</td><td>${r.order_count}</td><td><strong>${fmtMoney(r.revenue)}</strong></td><td>${fmtMoney(r.avg_order)}</td></tr>`;
      });
      html += '</table>'; } else { html += '<p class="muted">No data for the past 7 days.</p>'; }
    html += '</div>';

    html += '<div class="card"><h3>Weekly Revenue (4 weeks)</h3>';
    if (weeklyRevenue.rows.length) {
      html += '<table><tr><th>Week Starting</th><th>Orders</th><th>Revenue</th></tr>';
      weeklyRevenue.rows.forEach(r => {
        html += `<tr><td>${fmtDate(r.week_start)}</td><td>${r.order_count}</td><td><strong>${fmtMoney(r.revenue)}</strong></td></tr>`;
      });
      html += '</table>'; } else { html += '<p class="muted">No data for the past 4 weeks.</p>'; }
    html += '</div>';

    html += '<div class="card" style="margin-top:20px;"><h3>Popular Items (30 days)</h3>';
    if (popularItems.length) {
      html += '<table><tr><th>Rank</th><th>Item</th><th>Times Ordered</th></tr>';
      popularItems.forEach((item, idx) => {
        html += `<tr><td>${idx + 1}</td><td>${esc(item.name)}</td><td>${item.count}</td></tr>`;
      });
      html += '</table>'; } else { html += '<p class="muted">No order data.</p>'; }
    html += '</div>';

    html += '<div class="card" style="margin-top:20px;"><h3>Payment Methods (30 days)</h3>';
    if (paymentBreakdown.rows.length) {
      html += '<table><tr><th>Method</th><th>Orders</th><th>Revenue</th></tr>';
      paymentBreakdown.rows.forEach(r => {
        html += `<tr><td>${esc((r.payment_method||'cash').replace('_',' '))}</td><td>${r.c}</td><td>${fmtMoney(r.amount)}</td></tr>`;
      });
      html += '</table>'; } else { html += '<p class="muted">No payment data.</p>'; }
    html += '</div>';

    html += '<div class="card" style="margin-top:20px;"><h3>Peak Ordering Hours</h3>';
    if (peakHours.rows.length) {
      html += '<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;">';
      peakHours.rows.forEach(r => {
        const h = r.hour < 12 ? r.hour + ' AM' : r.hour === 12 ? '12 PM' : (r.hour - 12) + ' PM';
        html += `<div class="card" style="text-align:center;"><div class="stat-num">${r.order_count}</div><div>${h}</div></div>`;
      });
      html += '</div>'; } else { html += '<p class="muted">No peak hour data.</p>'; }
    html += '</div>';

    res.send(renderPage('Canteen Sales Reports', html, req.session.user, req));
  });

  // ── Boot ───────────────────────────────────────────────────────────────────
  migrate().then(() => {
    console.log('[Canteen] Meal management loaded');
  }).catch(err => {
    console.error('[Canteen] Migration failed:', err);
  });
};
