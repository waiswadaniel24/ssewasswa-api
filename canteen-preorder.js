/**
 * Canteen Pre-Order Module
 * Online canteen meal pre-ordering system
 *
 * Features: Menu Management, Weekly Schedule, Student Pre-order,
 *           Order Dashboard, Dietary Preferences, Nutrition Dashboard, Canteen Wallet
 * Routes: 20+ • PostgreSQL • tenant_id scoped
 */
module.exports = function(app, pool, opts) {
  const esc = opts.esc || (s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'));
  const renderPage = opts.renderPage || ((t,c,u) => c);
  const ah = opts.ah || ((fn) => async (req,res,next) => { try { await fn(req,res,next); } catch(e) { res.status(500).send('Error: '+e.message); }});
  const requireAuth = opts.requireAuth || ((req,res,next) => { if(!req.session?.user) return res.redirect('/login'); next(); });
  const audit = opts.audit || (() => {});
  const trackRevenue = global.trackRevenue || (() => {});

  // ── Constants ──────────────────────────────────────────────────────────────
  const DAYS = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
  const DAY_LABELS = {monday:'Monday',tuesday:'Tuesday',wednesday:'Wednesday',thursday:'Thursday',friday:'Friday',saturday:'Saturday',sunday:'Sunday'};
  const CATEGORIES = ['breakfast','lunch','snack','dinner','beverage'];
  const CAT_LABELS = {breakfast:'Breakfast',lunch:'Lunch',snack:'Snack',dinner:'Dinner',beverage:'Beverage'};
  const ORDER_STATUSES = ['pending','confirmed','preparing','ready','collected','cancelled'];
  const PICKUP_SLOTS = ['07:30-08:00','08:00-08:30','08:30-09:00','12:00-12:30','12:30-13:00','13:00-13:30','17:00-17:30','17:30-18:00','18:00-18:30'];
  const COLORS = ['#4f46e5','#059669','#f59e0b','#ef4444','#8b5cf6','#ec4899','#06b6d4','#84cc16'];

  function fmtMoney(v) { return '$' + parseFloat(v || 0).toFixed(2); }
  function fmtDate(d) { return d ? new Date(d).toLocaleDateString() : '—'; }
  function getToday() { const jsDay = new Date().getDay(); return jsDay === 0 ? 'sunday' : DAYS[jsDay - 1]; }
  function getTomorrow() { const jsDay = new Date().getDay(); return DAYS[(jsDay === 6 ? 0 : jsDay) % 7]; }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).substr(2, 6); }

  // ── Database Migrations ────────────────────────────────────────────────────
  (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS canteen_menu_items (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        category VARCHAR(50) DEFAULT 'lunch',
        price NUMERIC(8,2) NOT NULL DEFAULT 0,
        image VARCHAR(500),
        available_days JSONB DEFAULT '[]'::jsonb,
        allergens JSONB DEFAULT '[]'::jsonb,
        nutritional_info JSONB DEFAULT '{}'::jsonb,
        is_available BOOLEAN DEFAULT true,
        is_vegan BOOLEAN DEFAULT false,
        is_halal BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS canteen_weekly_menu (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        day_of_week VARCHAR(10) NOT NULL,
        category VARCHAR(50) DEFAULT 'lunch',
        menu_item_id INTEGER NOT NULL REFERENCES canteen_menu_items(id) ON DELETE CASCADE,
        sort_order INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(tenant_id, day_of_week, category, menu_item_id)
      );

      CREATE TABLE IF NOT EXISTS canteen_orders (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        order_number VARCHAR(30) UNIQUE NOT NULL,
        student_id INTEGER,
        student_name VARCHAR(255) NOT NULL,
        order_date DATE NOT NULL,
        pickup_slot VARCHAR(30) NOT NULL,
        payment_method VARCHAR(20) DEFAULT 'wallet',
        payment_status VARCHAR(20) DEFAULT 'pending',
        total_amount NUMERIC(10,2) DEFAULT 0,
        status VARCHAR(20) DEFAULT 'pending',
        notes TEXT,
        dietary_notes TEXT,
        allergen_alert JSONB DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS canteen_order_items (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        order_id INTEGER NOT NULL REFERENCES canteen_orders(id) ON DELETE CASCADE,
        menu_item_id INTEGER NOT NULL REFERENCES canteen_menu_items(id) ON DELETE CASCADE,
        item_name VARCHAR(255) NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 1,
        unit_price NUMERIC(8,2) NOT NULL DEFAULT 0,
        subtotal NUMERIC(10,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS canteen_wallet (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL,
        user_name VARCHAR(255) NOT NULL,
        balance NUMERIC(12,2) NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(tenant_id, user_id)
      );
    `);

    // Safety ALTERs
    const alters = [
      'ALTER TABLE canteen_menu_items ADD COLUMN IF NOT EXISTS name VARCHAR(255) NOT NULL DEFAULT \'\';',
      'ALTER TABLE canteen_menu_items ADD COLUMN IF NOT EXISTS description TEXT;',
      'ALTER TABLE canteen_menu_items ADD COLUMN IF NOT EXISTS category VARCHAR(50) DEFAULT \'lunch\';',
      'ALTER TABLE canteen_menu_items ADD COLUMN IF NOT EXISTS price NUMERIC(8,2) NOT NULL DEFAULT 0;',
      'ALTER TABLE canteen_menu_items ADD COLUMN IF NOT EXISTS image VARCHAR(500);',
      'ALTER TABLE canteen_menu_items ADD COLUMN IF NOT EXISTS available_days JSONB DEFAULT \'[]\'::jsonb;',
      'ALTER TABLE canteen_menu_items ADD COLUMN IF NOT EXISTS allergens JSONB DEFAULT \'[]\'::jsonb;',
      'ALTER TABLE canteen_menu_items ADD COLUMN IF NOT EXISTS nutritional_info JSONB DEFAULT \'{}\'::jsonb;',
      'ALTER TABLE canteen_menu_items ADD COLUMN IF NOT EXISTS is_available BOOLEAN DEFAULT true;',
      'ALTER TABLE canteen_menu_items ADD COLUMN IF NOT EXISTS is_vegan BOOLEAN DEFAULT false;',
      'ALTER TABLE canteen_menu_items ADD COLUMN IF NOT EXISTS is_halal BOOLEAN DEFAULT false;',
      'ALTER TABLE canteen_menu_items ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();',
      'ALTER TABLE canteen_orders ADD COLUMN IF NOT EXISTS student_id INTEGER;',
      'ALTER TABLE canteen_orders ADD COLUMN IF NOT EXISTS student_name VARCHAR(255) NOT NULL DEFAULT \'\';',
      'ALTER TABLE canteen_orders ADD COLUMN IF NOT EXISTS order_date DATE;',
      'ALTER TABLE canteen_orders ADD COLUMN IF NOT EXISTS pickup_slot VARCHAR(30) NOT NULL DEFAULT \'\';',
      'ALTER TABLE canteen_orders ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20) DEFAULT \'wallet\';',
      'ALTER TABLE canteen_orders ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) DEFAULT \'pending\';',
      'ALTER TABLE canteen_orders ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT \'pending\';',
      'ALTER TABLE canteen_orders ADD COLUMN IF NOT EXISTS notes TEXT;',
      'ALTER TABLE canteen_orders ADD COLUMN IF NOT EXISTS dietary_notes TEXT;',
      'ALTER TABLE canteen_orders ADD COLUMN IF NOT EXISTS allergen_alert JSONB DEFAULT \'[]\'::jsonb;',
      'ALTER TABLE canteen_orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();',
      'ALTER TABLE canteen_wallet ADD COLUMN IF NOT EXISTS user_name VARCHAR(255) NOT NULL DEFAULT \'\';',
      'ALTER TABLE canteen_wallet ADD COLUMN IF NOT EXISTS balance NUMERIC(12,2) NOT NULL DEFAULT 0;',
      'ALTER TABLE canteen_wallet ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();',
    ];
    for (const sql of alters) { try { await pool.query(sql); } catch (_) {} }

    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_cmi_tenant ON canteen_menu_items(tenant_id);',
      'CREATE INDEX IF NOT EXISTS idx_cmi_category ON canteen_menu_items(category);',
      'CREATE INDEX IF NOT EXISTS idx_cmi_available ON canteen_menu_items(is_available);',
      'CREATE INDEX IF NOT EXISTS idx_cwm_tenant ON canteen_weekly_menu(tenant_id);',
      'CREATE INDEX IF NOT EXISTS idx_cwm_day ON canteen_weekly_menu(day_of_week);',
      'CREATE INDEX IF NOT EXISTS idx_co_tenant ON canteen_orders(tenant_id);',
      'CREATE INDEX IF NOT EXISTS idx_co_date ON canteen_orders(order_date);',
      'CREATE INDEX IF NOT EXISTS idx_co_status ON canteen_orders(status);',
      'CREATE INDEX IF NOT EXISTS idx_co_student ON canteen_orders(student_id);',
      'CREATE INDEX IF NOT EXISTS idx_coi_tenant ON canteen_order_items(tenant_id);',
      'CREATE INDEX IF NOT EXISTS idx_coi_order ON canteen_order_items(order_id);',
      'CREATE INDEX IF NOT EXISTS idx_cw_tenant ON canteen_wallet(tenant_id);',
      'CREATE INDEX IF NOT EXISTS idx_cw_user ON canteen_wallet(user_id);',
    ];
    for (const sql of indexes) { try { await pool.query(sql); } catch (_) {} }
  })();

  // ── Shared Navigation ──────────────────────────────────────────────────────
  function nav(active) {
    const links = [
      ['Menu Items', '/canteen-preorder/menu'],
      ['Weekly Schedule', '/canteen-preorder/schedule'],
      ['Pre-Order', '/canteen-preorder/order'],
      ['Order Dashboard', '/canteen-preorder/dashboard'],
      ['Dietary', '/canteen-preorder/dietary'],
      ['Nutrition', '/canteen-preorder/nutrition'],
      ['Wallet', '/canteen-preorder/wallet'],
    ];
    return '<nav style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:24px;" role="navigation" aria-label="Canteen navigation">' +
      links.map(([label, href]) => {
        const isActive = active === label;
        const bg = isActive ? '#059669' : '#4f46e5';
        return `<a href="${href}" role="button" aria-current="${isActive?'page':'false'}" style="padding:8px 18px;background:${bg};color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;transition:opacity 0.2s;">${esc(label)}</a>`;
      }).join('') + '</nav>';
  }

  function alertBox(msg, type) {
    const bg = type === 'success' ? '#d1fae5' : type === 'warning' ? '#fef3c7' : '#fee2e2';
    const border = type === 'success' ? '#059669' : type === 'warning' ? '#d97706' : '#ef4444';
    const color = type === 'success' ? '#065f46' : type === 'warning' ? '#92400e' : '#991b1b';
    return `<div style="padding:14px 20px;background:${bg};border:1px solid ${border};border-radius:10px;color:${color};margin-bottom:16px;" role="alert">${esc(msg)}</div>`;
  }

  function cardWrap(title, content, opts2) {
    return `<div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px;margin-bottom:20px;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
      <h3 style="margin:0 0 16px;color:#111827;font-size:18px;">${esc(title)}</h3>${content}</div>`;
  }

  function statCards(items) {
    return '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:14px;margin-bottom:24px;">' +
      items.map(({label, value, color}) => `<div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
        <div style="font-size:28px;font-weight:700;color:${color||'#4f46e5'};">${esc(String(value))}</div>
        <div style="font-size:13px;color:#6b7280;margin-top:4px;">${esc(label)}</div></div>`).join('') + '</div>';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FEATURE 1 — Menu Management (CRUD)
  // ═══════════════════════════════════════════════════════════════════════════

  // List all menu items
  app.get('/canteen-preorder/menu', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const catFilter = req.query.category || '';
    let where = 'tenant_id=$1';
    const params = [tid];
    if (catFilter) { where += ' AND category=$2'; params.push(catFilter); }

    const items = await pool.query(
      `SELECT * FROM canteen_menu_items WHERE ${where} ORDER BY category, name`, params);

    let html = nav('Menu Items');
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">';
    html += '<h2 style="margin:0;color:#111827;">Menu Items</h2>';
    html += `<a href="/canteen-preorder/menu/new" role="button" style="padding:10px 22px;background:#059669;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">+ Add Item</a></div>`;

    // Category filter
    html += '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px;">';
    html += `<a href="/canteen-preorder/menu" style="padding:6px 14px;background:${!catFilter?'#4f46e5':'#f3f4f6'};color:${!catFilter?'#fff':'#374151'};border-radius:6px;text-decoration:none;font-size:13px;">All</a>`;
    CATEGORIES.forEach(cat => {
      html += `<a href="/canteen-preorder/menu?category=${cat}" style="padding:6px 14px;background:${catFilter===cat?'#4f46e5':'#f3f4f6'};color:${catFilter===cat?'#fff':'#374151'};border-radius:6px;text-decoration:none;font-size:13px;">${esc(CAT_LABELS[cat]||cat)}</a>`;
    });
    html += '</div>';

    html += statCards([
      {label: 'Total Items', value: items.rows.length, color: '#4f46e5'},
      {label: 'Available', value: items.rows.filter(i=>i.is_available).length, color: '#059669'},
      {label: 'Vegan Options', value: items.rows.filter(i=>i.is_vegan).length, color: '#16a34a'},
      {label: 'Halal Options', value: items.rows.filter(i=>i.is_halal).length, color: '#d97706'},
    ]);

    if (items.rows.length) {
      html += '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:14px;"><thead><tr style="background:#f9fafb;">';
      html += '<th style="padding:12px 16px;text-align:left;border-bottom:2px solid #e5e7eb;">Item</th>';
      html += '<th style="padding:12px 16px;text-align:left;border-bottom:2px solid #e5e7eb;">Category</th>';
      html += '<th style="padding:12px 16px;text-align:left;border-bottom:2px solid #e5e7eb;">Price</th>';
      html += '<th style="padding:12px 16px;text-align:left;border-bottom:2px solid #e5e7eb;">Allergens</th>';
      html += '<th style="padding:12px 16px;text-align:left;border-bottom:2px solid #e5e7eb;">Diet</th>';
      html += '<th style="padding:12px 16px;text-align:left;border-bottom:2px solid #e5e7eb;">Status</th>';
      html += '<th style="padding:12px 16px;text-align:left;border-bottom:2px solid #e5e7eb;">Actions</th>';
      html += '</tr></thead><tbody>';
      items.rows.forEach(item => {
        const allergens = Array.isArray(item.allergens) ? item.allergens : (item.allergens ? JSON.parse(item.allergens) : []);
        const availDays = Array.isArray(item.available_days) ? item.available_days : (item.available_days ? JSON.parse(item.available_days) : []);
        const dietTags = [];
        if (item.is_vegan) dietTags.push('<span style="background:#dcfce7;color:#166534;padding:2px 8px;border-radius:4px;font-size:12px;">Vegan</span>');
        if (item.is_halal) dietTags.push('<span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:4px;font-size:12px;">Halal</span>');
        const statusBadge = item.is_available
          ? '<span style="background:#d1fae5;color:#065f46;padding:2px 10px;border-radius:10px;font-size:12px;">Available</span>'
          : '<span style="background:#fee2e2;color:#991b1b;padding:2px 10px;border-radius:10px;font-size:12px;">Unavailable</span>';

        html += `<tr style="border-bottom:1px solid #f3f4f6;">
          <td style="padding:12px 16px;">
            <div style="display:flex;align-items:center;gap:12px;">
              ${item.image ? `<img src="${esc(item.image)}" alt="${esc(item.name)}" style="width:48px;height:48px;object-fit:cover;border-radius:8px;" loading="lazy">` : '<div style="width:48px;height:48px;background:#f3f4f6;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#9ca3af;font-size:20px;">🍽</div>'}
              <div><strong style="color:#111827;">${esc(item.name)}</strong>
                ${item.description ? `<br><small style="color:#6b7280;">${esc(String(item.description).substring(0,60))}</small>` : ''}
                ${availDays.length ? `<br><small style="color:#9ca3af;">${availDays.map(d=>DAY_LABELS[d]||d).join(', ')}</small>` : ''}
              </div></div></td>
          <td style="padding:12px 16px;"><span style="background:#eef2ff;color:#4f46e5;padding:3px 10px;border-radius:6px;font-size:12px;">${esc(CAT_LABELS[item.category]||item.category)}</span></td>
          <td style="padding:12px 16px;font-weight:600;color:#059669;">${fmtMoney(item.price)}</td>
          <td style="padding:12px 16px;">${allergens.length ? allergens.map(a=>`<span style="background:#fee2e2;color:#991b1b;padding:2px 6px;border-radius:4px;font-size:11px;">${esc(a)}</span>`).join(' ') : '<span style="color:#9ca3af;">None</span>'}</td>
          <td style="padding:12px 16px;">${dietTags.join(' ') || '<span style="color:#9ca3af;">—</span>'}</td>
          <td style="padding:12px 16px;">${statusBadge}</td>
          <td style="padding:12px 16px;">
            <a href="/canteen-preorder/menu/${item.id}/edit" style="padding:5px 12px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:6px;font-size:12px;margin-right:4px;">Edit</a>
            <form method="POST" action="/canteen-preorder/menu/${item.id}/delete" style="display:inline;" onsubmit="return confirm('Delete ${esc(item.name)}?')">
              <button style="padding:5px 12px;background:#ef4444;color:#fff;border:none;border-radius:6px;font-size:12px;cursor:pointer;">Delete</button></form></td></tr>`;
      });
      html += '</tbody></table></div>';
    } else {
      html += cardWrap('No Items', '<p style="color:#6b7280;">No menu items found. Add your first item to get started.</p>');
    }

    res.send(renderPage('Canteen Menu Management', html, req.session.user));
  }));

  // New menu item form
  app.get('/canteen-preorder/menu/new', requireAuth, ah(async (req, res) => {
    let html = nav('Menu Items');
    html += cardWrap('Add Menu Item', renderMenuItemForm(''));
    res.send(renderPage('Add Menu Item', html, req.session.user));
  }));

  // Edit menu item form
  app.get('/canteen-preorder/menu/:id/edit', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const item = await pool.query('SELECT * FROM canteen_menu_items WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    if (!item.rows.length) return res.status(404).send('Menu item not found.');
    let html = nav('Menu Items');
    html += cardWrap('Edit Menu Item', renderMenuItemForm('', item.rows[0]));
    res.send(renderPage('Edit Menu Item', html, req.session.user));
  }));

  function renderMenuItemForm(action, item) {
    const i = item || {};
    const allergens = Array.isArray(i.allergens) ? i.allergens : (i.allergens ? JSON.parse(i.allergens) : []);
    const availDays = Array.isArray(i.available_days) ? i.available_days : (i.available_days ? JSON.parse(i.available_days) : []);
    const editId = i.id ? `<input type="hidden" name="id" value="${i.id}">` : '';
    const commonAllergens = ['Milk','Eggs','Fish','Shellfish','Tree Nuts','Peanuts','Wheat','Soy','Sesame','Gluten'];

    let h = `<form method="POST" action="/canteen-preorder/menu/save" style="max-width:700px;">
      ${editId}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        <div><label style="display:block;font-weight:600;margin-bottom:4px;font-size:14px;">Item Name *</label>
          <input name="name" value="${esc(i.name||'')}" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;" placeholder="e.g. Grilled Chicken Bowl"></div>
        <div><label style="display:block;font-weight:600;margin-bottom:4px;font-size:14px;">Category *</label>
          <select name="category" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;">
            ${CATEGORIES.map(c=>`<option value="${c}" ${i.category===c?'selected':''}>${CAT_LABELS[c]}</option>`).join('')}
          </select></div>
        <div style="grid-column:1/-1;"><label style="display:block;font-weight:600;margin-bottom:4px;font-size:14px;">Description</label>
          <textarea name="description" rows="2" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;" placeholder="Brief description...">${esc(i.description||'')}</textarea></div>
        <div><label style="display:block;font-weight:600;margin-bottom:4px;font-size:14px;">Price ($) *</label>
          <input name="price" type="number" step="0.01" min="0" value="${i.price||0}" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;"></div>
        <div><label style="display:block;font-weight:600;margin-bottom:4px;font-size:14px;">Image URL</label>
          <input name="image" value="${esc(i.image||'')}" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;" placeholder="https://..."></div>
        <div style="grid-column:1/-1;"><label style="display:block;font-weight:600;margin-bottom:8px;font-size:14px;">Available Days</label>
          <div style="display:flex;flex-wrap:wrap;gap:8px;">
            ${DAYS.map(d => `<label style="display:flex;align-items:center;gap:4px;font-size:14px;cursor:pointer;"><input type="checkbox" name="available_days" value="${d}" ${availDays.includes(d)?'checked':''}> ${DAY_LABELS[d]}</label>`).join('')}
          </div></div>
        <div style="grid-column:1/-1;"><label style="display:block;font-weight:600;margin-bottom:8px;font-size:14px;">Allergens</label>
          <div style="display:flex;flex-wrap:wrap;gap:8px;">
            ${commonAllergens.map(a => `<label style="display:flex;align-items:center;gap:4px;font-size:13px;cursor:pointer;"><input type="checkbox" name="allergens" value="${a}" ${allergens.includes(a)?'checked':''}> ${a}</label>`).join('')}
          </div></div>
        <div style="grid-column:1/-1;display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;"><input type="checkbox" name="is_available" ${i.is_available!==false?'checked':''}> <span style="font-size:14px;">Available</span></label>
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;"><input type="checkbox" name="is_vegan" ${i.is_vegan?'checked':''}> <span style="font-size:14px;">Vegan</span></label>
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;"><input type="checkbox" name="is_halal" ${i.is_halal?'checked':''}> <span style="font-size:14px;">Halal</span></label>
        </div>
        <div style="grid-column:1/-1;"><label style="display:block;font-weight:600;margin-bottom:8px;font-size:14px;">Nutritional Info (JSON)</label>
          <input name="nutritional_info" value="${esc(i.nutritional_info ? (typeof i.nutritional_info === 'string' ? i.nutritional_info : JSON.stringify(i.nutritional_info)) : '{}')}" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;box-sizing:border-box;font-family:monospace;" placeholder='{"calories":450,"protein":25,"carbs":40,"fat":15,"fiber":5}'>
        </div>
      </div>
      <div style="margin-top:20px;display:flex;gap:10px;">
        <button type="submit" style="padding:10px 24px;background:#059669;color:#fff;border:none;border-radius:8px;font-weight:600;cursor:pointer;font-size:14px;">Save Item</button>
        <a href="/canteen-preorder/menu" style="padding:10px 24px;background:#f3f4f6;color:#374151;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;">Cancel</a>
      </div></form>`;
    return h;
  }

  // Save menu item (create or update)
  app.post('/canteen-preorder/menu/save', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { id, name, description, category, price, image, is_available, is_vegan, is_halal, nutritional_info } = req.body;
    if (!name || !name.trim()) return res.send(alertBox('Item name is required.', 'error'));
    if (!price || parseFloat(price) < 0) return res.send(alertBox('Valid price is required.', 'error'));

    const availableDays = Array.isArray(req.body.available_days) ? req.body.available_days : (req.body.available_days ? [req.body.available_days] : []);
    const allergens = Array.isArray(req.body.allergens) ? req.body.allergens : (req.body.allergens ? [req.body.allergens] : []);
    let nutInfo = {};
    try { nutInfo = nutritional_info ? JSON.parse(nutritional_info) : {}; } catch (_) { nutInfo = {}; }

    if (id) {
      await pool.query(
        `UPDATE canteen_menu_items SET name=$1, description=$2, category=$3, price=$4, image=$5,
         available_days=$6::jsonb, allergens=$7::jsonb, nutritional_info=$8::jsonb,
         is_available=$9, is_vegan=$10, is_halal=$11, updated_at=NOW()
         WHERE id=$12 AND tenant_id=$13`,
        [name.trim(), description||null, category||'lunch', parseFloat(price), image||null,
         JSON.stringify(availableDays), JSON.stringify(allergens), JSON.stringify(nutInfo),
         is_available !== undefined && is_available !== 'false', is_vegan === 'on' || is_vegan === true,
         is_halal === 'on' || is_halal === true, id, tid]);
      audit('canteen_menu_update', {itemId: id, name: name.trim()}, req.session.user);
    } else {
      await pool.query(
        `INSERT INTO canteen_menu_items (tenant_id,name,description,category,price,image,
         available_days,allergens,nutritional_info,is_available,is_vegan,is_halal)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12)`,
        [tid, name.trim(), description||null, category||'lunch', parseFloat(price), image||null,
         JSON.stringify(availableDays), JSON.stringify(allergens), JSON.stringify(nutInfo),
         is_available !== undefined && is_available !== 'false', is_vegan === 'on' || is_vegan === true,
         is_halal === 'on' || is_halal === true]);
      audit('canteen_menu_create', {name: name.trim()}, req.session.user);
    }
    res.redirect('/canteen-preorder/menu');
  }));

  // Delete menu item
  app.post('/canteen-preorder/menu/:id/delete', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const result = await pool.query('DELETE FROM canteen_menu_items WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    if (result.rowCount === 0) return res.status(404).send('Item not found.');
    audit('canteen_menu_delete', {itemId: req.params.id}, req.session.user);
    res.redirect('/canteen-preorder/menu');
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // FEATURE 2 — Weekly Menu Schedule
  // ═══════════════════════════════════════════════════════════════════════════

  app.get('/canteen-preorder/schedule', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const allItems = await pool.query(
      'SELECT id, name, category, price, is_available FROM canteen_menu_items WHERE tenant_id=$1 AND is_available=true ORDER BY name', [tid]);
    const schedule = await pool.query(
      'SELECT wm.*, mi.name, mi.category, mi.price FROM canteen_weekly_menu wm JOIN canteen_menu_items mi ON mi.id=wm.menu_item_id WHERE wm.tenant_id=$1 AND wm.is_active=true ORDER BY wm.day_of_week, wm.sort_order', [tid]);

    // Group schedule by day
    const dayMenu = {};
    DAYS.forEach(d => { dayMenu[d] = {}; CATEGORIES.forEach(c => { dayMenu[d][c] = []; }); });
    schedule.rows.forEach(r => {
      if (dayMenu[r.day_of_week] && dayMenu[r.day_of_week][r.category]) {
        dayMenu[r.day_of_week][r.category].push(r);
      }
    });

    let html = nav('Weekly Schedule');
    const today = getToday();
    html += '<h2 style="margin:0 0 16px;color:#111827;">Weekly Menu Schedule</h2>';
    html += `<p style="color:#6b7280;margin-bottom:20px;">Today: <strong style="color:#4f46e5;">${DAY_LABELS[today]}</strong>. Assign menu items to each day of the week.</p>`;

    // Weekly grid table
    html += '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:13px;min-width:1000px;">';
    html += '<thead><tr><th style="padding:10px;text-align:left;border-bottom:2px solid #e5e7eb;background:#f9fafb;">Day</th>';
    CATEGORIES.forEach(c => { html += `<th style="padding:10px;text-align:left;border-bottom:2px solid #e5e7eb;background:#f9fafb;">${CAT_LABELS[c]}</th>`; });
    html += '</tr></thead><tbody>';

    DAYS.forEach(day => {
      const isToday = day === today;
      html += `<tr style="background:${isToday?'#f0fdf4':''};border-bottom:1px solid #e5e7eb;">`;
      html += `<td style="padding:10px;font-weight:600;color:${isToday?'#059669':'#111827'};border-right:1px solid #e5e7eb;white-space:nowrap;">
        ${DAY_LABELS[day]}${isToday ? ' <span style="background:#059669;color:#fff;padding:2px 8px;border-radius:10px;font-size:11px;">Today</span>' : ''}</td>`;
      CATEGORIES.forEach(cat => {
        const items = dayMenu[day][cat] || [];
        html += '<td style="padding:8px;vertical-align:top;min-width:160px;">';
        if (items.length) {
          items.forEach(it => {
            html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 6px;background:#f9fafb;border-radius:6px;margin-bottom:4px;">
              <span>${esc(it.name)}</span>
              <span style="color:#6b7280;font-size:12px;">${fmtMoney(it.price)}</span>
              <form method="POST" action="/canteen-preorder/schedule/remove" style="display:inline;">
                <input type="hidden" name="day_of_week" value="${day}">
                <input type="hidden" name="menu_item_id" value="${it.menu_item_id}">
                <button style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:14px;" title="Remove" aria-label="Remove ${esc(it.name)}">&times;</button></form>
            </div>`;
          });
        } else {
          html += '<span style="color:#d1d5db;font-size:12px;">—</span>';
        }
        html += '</td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table></div>';

    // Add to schedule form
    html += cardWrap('Add Item to Schedule', `
      <form method="POST" action="/canteen-preorder/schedule/add" style="display:flex;flex-wrap:wrap;gap:12px;align-items:end;">
        <div><label style="display:block;font-weight:600;margin-bottom:4px;font-size:13px;">Day *</label>
          <select name="day_of_week" required style="padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;">
            ${DAYS.map(d=>`<option value="${d}" ${d===getTomorrow()?'selected':''}>${DAY_LABELS[d]}</option>`).join('')}
          </select></div>
        <div><label style="display:block;font-weight:600;margin-bottom:4px;font-size:13px;">Category *</label>
          <select name="category" required style="padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;">
            ${CATEGORIES.map(c=>`<option value="${c}">${CAT_LABELS[c]}</option>`).join('')}
          </select></div>
        <div><label style="display:block;font-weight:600;margin-bottom:4px;font-size:13px;">Menu Item *</label>
          <select name="menu_item_id" required style="padding:10px;border:1px solid #d1d5db;border-radius:8px;min-width:250px;font-size:14px;">
            ${allItems.rows.map(mi=>`<option value="${mi.id}">${esc(mi.name)} (${CAT_LABELS[mi.category]||mi.category}) - ${fmtMoney(mi.price)}</option>`).join('')}
          </select></div>
        <button type="submit" style="padding:10px 22px;background:#4f46e5;color:#fff;border:none;border-radius:8px;font-weight:600;cursor:pointer;">Add</button>
      </form>`);

    res.send(renderPage('Weekly Menu Schedule', html, req.session.user));
  }));

  app.post('/canteen-preorder/schedule/add', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { day_of_week, category, menu_item_id } = req.body;
    if (!day_of_week || !category || !menu_item_id) return res.send(alertBox('All fields are required.', 'error'));
    try {
      await pool.query(
        `INSERT INTO canteen_weekly_menu (tenant_id, day_of_week, category, menu_item_id, sort_order)
         VALUES ($1, $2, $3, $4, (SELECT COALESCE(MAX(sort_order),0)+1 FROM canteen_weekly_menu WHERE tenant_id=$1 AND day_of_week=$2 AND category=$3))`,
        [tid, day_of_week, category, parseInt(menu_item_id)]);
      audit('canteen_schedule_add', {day: day_of_week, category, menuItemId: menu_item_id}, req.session.user);
    } catch (e) {
      if (e.message && e.message.includes('unique')) return res.send(alertBox('This item is already scheduled for this day and category.', 'warning'));
      throw e;
    }
    res.redirect('/canteen-preorder/schedule');
  }));

  app.post('/canteen-preorder/schedule/remove', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query(
      'DELETE FROM canteen_weekly_menu WHERE tenant_id=$1 AND day_of_week=$2 AND menu_item_id=$3',
      [tid, req.body.day_of_week, parseInt(req.body.menu_item_id)]);
    res.redirect('/canteen-preorder/schedule');
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // FEATURE 3 — Student Pre-Order
  // ═══════════════════════════════════════════════════════════════════════════

  app.get('/canteen-preorder/order', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid2 = req.session.user.id;
    const targetDay = getTomorrow();

    // Get dietary preferences
    const dietPrefs = await pool.query(
      'SELECT dietary_restrictions, allergies FROM user_profiles WHERE user_id=$1 AND tenant_id=$2', [uid2, tid]);

    // Get today's/tomorrow's scheduled menu items
    const scheduled = await pool.query(
      `SELECT wm.*, mi.name, mi.price, mi.description, mi.image, mi.is_vegan, mi.is_halal,
              mi.allergens, mi.nutritional_info, mi.category
       FROM canteen_weekly_menu wm
       JOIN canteen_menu_items mi ON mi.id=wm.menu_item_id
       WHERE wm.tenant_id=$1 AND wm.day_of_week=$2 AND wm.is_active=true AND mi.is_available=true
       ORDER BY wm.sort_order`, [tid, targetDay]);

    // Get wallet balance
    const wallet = await pool.query(
      'SELECT balance FROM canteen_wallet WHERE tenant_id=$1 AND user_id=$2', [tid, uid2]);
    const balance = parseFloat(wallet.rows[0]?.balance || 0);

    // Parse dietary restrictions
    const prefs = dietPrefs.rows[0] || {};
    const restrictions = Array.isArray(prefs.dietary_restrictions) ? prefs.dietary_restrictions : (prefs.dietary_restrictions ? JSON.parse(prefs.dietary_restrictions) : []);
    const userAllergies = Array.isArray(prefs.allergies) ? prefs.allergies : (prefs.allergies ? JSON.parse(prefs.allergies) : []);

    // Group by category
    const byCategory = {};
    CATEGORIES.forEach(c => { byCategory[c] = []; });
    scheduled.rows.forEach(r => {
      if (byCategory[r.category]) byCategory[r.category].push(r);
    });

    let html = nav('Pre-Order');
    html += '<h2 style="margin:0 0 8px;color:#111827;">Pre-Order Meals</h2>';
    html += `<p style="color:#6b7280;margin-bottom:20px;">Order meals for <strong style="color:#4f46e5;">${DAY_LABELS[targetDay]}</strong>. Select items and a pickup time.</p>`;

    // Wallet balance indicator
    html += `<div style="padding:12px 20px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:center;">
      <span style="color:#166534;font-weight:600;">Wallet Balance</span>
      <span style="color:#059669;font-size:20px;font-weight:700;">${fmtMoney(balance)}</span>
    </div>`;

    // Dietary alerts
    if (restrictions.length || userAllergies.length) {
      html += alertBox(`Your preferences: ${restrictions.join(', ')}${restrictions.length && userAllergies.length ? ' | ' : ''}Allergies: ${userAllergies.join(', ')}. Menu items flagged accordingly.`, 'warning');
    }

    if (scheduled.rows.length === 0) {
      html += cardWrap('No Menu Available', '<p style="color:#6b7280;">No menu items scheduled for ' + DAY_LABELS[targetDay] + '. Please check back later.</p>');
      res.send(renderPage('Pre-Order Meals', html, req.session.user));
      return;
    }

    // Menu items grid
    html += `<form method="POST" action="/canteen-preorder/order/place" id="preorder-form">`;
    CATEGORIES.forEach(cat => {
      const items = byCategory[cat];
      if (!items.length) return;
      html += cardWrap(CAT_LABELS[cat], `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px;">` +
        items.map(item => {
          const itemAllergens = Array.isArray(item.allergens) ? item.allergens : (item.allergens ? JSON.parse(item.allergens) : []);
          const conflict = itemAllergens.filter(a => userAllergies.map(x=>x.toLowerCase()).includes(a.toLowerCase()));
          const isRestricted = restrictions.includes('vegetarian') && !item.is_vegan && cat !== 'beverage';
          const warningStyle = conflict.length ? 'border:2px solid #ef4444;' : isRestricted ? 'border:2px solid #f59e0b;' : 'border:1px solid #e5e7eb;';

          let warningMsg = '';
          if (conflict.length) warningMsg = `<div style="background:#fee2e2;color:#991b1b;padding:8px;border-radius:6px;font-size:12px;margin-top:8px;">⚠ Allergen Alert: ${conflict.join(', ')}</div>`;
          else if (isRestricted) warningMsg = `<div style="background:#fef3c7;color:#92400e;padding:8px;border-radius:6px;font-size:12px;margin-top:8px;">⚠ May not match dietary preference</div>`;

          const nutInfo = item.nutritional_info ? (typeof item.nutritional_info === 'string' ? JSON.parse(item.nutritional_info) : item.nutritional_info) : {};

          return `<div style="background:#fff;${warningStyle}border-radius:12px;padding:16px;transition:box-shadow 0.2s;">
            <div style="display:flex;justify-content:space-between;align-items:start;">
              <label style="cursor:pointer;flex:1;">
                <div style="display:flex;align-items:center;gap:8px;">
                  <input type="checkbox" name="items" value="${item.menu_item_id}" data-price="${item.price}" data-name="${esc(item.name)}" onchange="updateCart()" style="width:18px;height:18px;accent-color:#4f46e5;">
                  <strong style="color:#111827;">${esc(item.name)}</strong></div>
                ${item.description ? `<p style="color:#6b7280;font-size:13px;margin:4px 0 0;">${esc(item.description)}</p>` : ''}
                <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;">
                  <span style="color:#059669;font-weight:700;font-size:15px;">${fmtMoney(item.price)}</span>
                  ${item.is_vegan ? '<span style="background:#dcfce7;color:#166534;padding:2px 6px;border-radius:4px;font-size:11px;">Vegan</span>' : ''}
                  ${item.is_halal ? '<span style="background:#fef3c7;color:#92400e;padding:2px 6px;border-radius:4px;font-size:11px;">Halal</span>' : ''}
                  ${nutInfo.calories ? `<span style="color:#9ca3af;font-size:11px;">${nutInfo.calories}kcal</span>` : ''}
                </div>
              </label></div>${warningMsg}
            <div style="margin-top:10px;"><label style="font-size:12px;color:#6b7280;">Qty:</label>
              <input type="number" name="qty_${item.menu_item_id}" value="1" min="1" max="10" data-item="${item.menu_item_id}" onchange="updateCart()" style="width:60px;padding:4px;border:1px solid #d1d5db;border-radius:4px;margin-left:4px;font-size:13px;"></div>
          </div>`;
        }).join('') + '</div>');
    });

    // Pickup time & payment
    html += cardWrap('Order Details', `
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;">
        <div><label style="display:block;font-weight:600;margin-bottom:4px;font-size:14px;">Pickup Time *</label>
          <select name="pickup_slot" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;">
            ${PICKUP_SLOTS.map(s => `<option value="${s}">${s}</option>`).join('')}
          </select></div>
        <div><label style="display:block;font-weight:600;margin-bottom:4px;font-size:14px;">Payment Method *</label>
          <select name="payment_method" id="payment_method" required onchange="updateCart()" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;">
            <option value="wallet" ${balance > 0 ? 'selected' : ''}>Wallet (${fmtMoney(balance)})</option>
            <option value="cash">Cash at Pickup</option>
          </select></div>
        <div><label style="display:block;font-weight:600;margin-bottom:4px;font-size:14px;">Notes</label>
          <input name="notes" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;" placeholder="Special requests..."></div>
      </div>
      <div style="margin-top:16px;padding:16px;background:#f9fafb;border-radius:10px;display:flex;justify-content:space-between;align-items:center;">
        <div><span style="font-size:14px;color:#6b7280;">Total:</span>
          <span id="cart-total" style="font-size:24px;font-weight:700;color:#059669;margin-left:8px;">$0.00</span></div>
        <button type="submit" style="padding:12px 32px;background:#059669;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer;font-size:16px;" id="place-order-btn">Place Pre-Order</button>
      </div>
      <div id="cart-warnings" style="margin-top:8px;"></div>
    `);
    html += '</form>';

    // Cart update script
    html += `<script>
    function updateCart() {
      let total = 0; let count = 0;
      document.querySelectorAll('input[name="items"]:checked').forEach(cb => {
        const price = parseFloat(cb.dataset.price) || 0;
        const itemEl = document.querySelector('input[data-item="'+cb.value+'"]');
        const qty = itemEl ? parseInt(itemEl.value) || 1 : 1;
        total += price * qty; count++;
      });
      document.getElementById('cart-total').textContent = '$' + total.toFixed(2);
      const pm = document.getElementById('payment_method');
      const walletOpt = pm.querySelector('option[value="wallet"]');
      walletOpt.textContent = 'Wallet (${fmtMoney(balance)})';
      const warnings = document.getElementById('cart-warnings');
      if (pm.value === 'wallet' && total > ${balance}) {
        warnings.innerHTML = '<div style="color:#ef4444;font-size:13px;">Insufficient wallet balance. Please top-up or select Cash payment.</div>';
      } else { warnings.innerHTML = ''; }
    }
    </script>`;

    res.send(renderPage('Pre-Order Meals', html, req.session.user));
  }));

  // Place order
  app.post('/canteen-preorder/order/place', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const userId = req.session.user.id;
    const userName = req.session.user.name || 'Student';
    const { pickup_slot, payment_method, notes } = req.body;

    if (!pickup_slot) return res.send(alertBox('Please select a pickup time.', 'error'));

    const selectedItemIds = Array.isArray(req.body.items) ? req.body.items : (req.body.items ? [req.body.items] : []);
    if (selectedItemIds.length === 0) return res.send(alertBox('Please select at least one item.', 'error'));

    // Build order items with quantities
    const orderLines = [];
    for (const itemId of selectedItemIds) {
      const qtyInput = req.body['qty_' + itemId];
      const qty = Math.min(Math.max(parseInt(qtyInput) || 1, 1), 10);
      orderLines.push({ menu_item_id: parseInt(itemId), quantity: qty });
    }

    // Fetch menu items and validate
    const itemIds = orderLines.map(l => l.menu_item_id);
    const menuResult = await pool.query(
      'SELECT * FROM canteen_menu_items WHERE id = ANY($1) AND tenant_id=$2 AND is_available=true',
      [itemIds, tid]);

    if (menuResult.rows.length !== itemIds.length) {
      return res.send(alertBox('Some selected items are no longer available.', 'error'));
    }

    const menuMap = {};
    menuResult.rows.forEach(r => { menuMap[r.id] = r; });

    let totalAmount = 0;
    const orderItemsData = orderLines.map(line => {
      const mi = menuMap[line.menu_item_id];
      const subtotal = parseFloat(mi.price) * line.quantity;
      totalAmount += subtotal;
      return { menu_item_id: line.menu_item_id, item_name: mi.name, quantity: line.quantity, unit_price: mi.price, subtotal };
    });

    // Check allergens
    const dietPrefs = await pool.query(
      'SELECT allergies FROM user_profiles WHERE user_id=$1 AND tenant_id=$2', [userId, tid]);
    const userAllergies = dietPrefs.rows[0]?.allergies ? (Array.isArray(dietPrefs.rows[0].allergies) ? dietPrefs.rows[0].allergies : JSON.parse(dietPrefs.rows[0].allergies)) : [];
    const allergenAlerts = [];
    orderItemsData.forEach(oi => {
      const mi = menuMap[oi.menu_item_id];
      const itemAllergens = Array.isArray(mi.allergens) ? mi.allergens : (mi.allergens ? JSON.parse(mi.allergens) : []);
      itemAllergens.forEach(a => {
        if (userAllergies.map(x=>x.toLowerCase()).includes(a.toLowerCase())) {
          allergenAlerts.push({ item: oi.item_name, allergen: a });
        }
      });
    });

    // Handle payment
    if (payment_method === 'wallet') {
      const wallet = await pool.query(
        'SELECT balance FROM canteen_wallet WHERE tenant_id=$1 AND user_id=$2 FOR UPDATE', [tid, userId]);
      const currentBalance = parseFloat(wallet.rows[0]?.balance || 0);
      if (currentBalance < totalAmount) {
        return res.send(alertBox('Insufficient wallet balance. Please top-up or select cash payment.', 'error'));
      }
      await pool.query(
        'UPDATE canteen_wallet SET balance=balance-$1, updated_at=NOW() WHERE tenant_id=$2 AND user_id=$3',
        [totalAmount, tid, userId]);
    }

    // Generate order number
    const orderNum = 'CPO-' + Date.now().toString(36).toUpperCase() + '-' + uid().toUpperCase();
    const tomorrowDate = new Date();
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const orderDate = tomorrowDate.toISOString().split('T')[0];

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const orderRes = await client.query(
        `INSERT INTO canteen_orders (tenant_id, order_number, student_id, student_name, order_date,
         pickup_slot, payment_method, payment_status, total_amount, status, notes, allergen_alert)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb) RETURNING id`,
        [tid, orderNum, userId, userName, orderDate, pickup_slot, payment_method,
         payment_method === 'wallet' ? 'paid' : 'pending', totalAmount, 'confirmed',
         notes || null, allergenAlerts.length ? JSON.stringify(allergenAlerts) : '[]']);

      const orderId = orderRes.rows[0].id;
      for (const oi of orderItemsData) {
        await client.query(
          `INSERT INTO canteen_order_items (tenant_id, order_id, menu_item_id, item_name, quantity, unit_price)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [tid, orderId, oi.menu_item_id, oi.item_name, oi.quantity, oi.unit_price]);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    trackRevenue('canteen_preorder', totalAmount, `Pre-order ${orderNum} by ${userName}`, orderNum);
    audit('canteen_order_placed', {orderNumber: orderNum, total: totalAmount, payment: payment_method}, req.session.user);

    // Show confirmation
    let html = nav('Pre-Order');
    html += cardWrap('Order Confirmed!', `
      <div style="text-align:center;padding:20px;">
        <div style="font-size:48px;margin-bottom:16px;">✅</div>
        <h2 style="color:#059669;margin:0 0 8px;">Order Placed Successfully</h2>
        <p style="color:#6b7280;margin-bottom:20px;">Your order <strong style="color:#111827;">${esc(orderNum)}</strong> has been confirmed.</p>
        ${allergenAlerts.length ? `<div style="background:#fee2e2;color:#991b1b;padding:14px;border-radius:10px;margin-bottom:16px;text-align:left;">
          <strong>⚠ Allergen Alerts:</strong><br>${allergenAlerts.map(a=>esc(a.item)+': '+esc(a.allergen)).join('<br>')}</div>` : ''}
        <div style="background:#f9fafb;border-radius:10px;padding:16px;text-align:left;margin-bottom:20px;">
          <p><strong>Order Date:</strong> ${esc(DAY_LABELS[getTomorrow()])} (${esc(orderDate)})</p>
          <p><strong>Pickup Time:</strong> ${esc(pickup_slot)}</p>
          <p><strong>Payment:</strong> ${esc(payment_method === 'wallet' ? 'Wallet (Paid)' : 'Cash at Pickup')}</p>
          <p><strong>Total:</strong> <span style="color:#059669;font-weight:700;font-size:18px;">${fmtMoney(totalAmount)}</span></p>
          <p><strong>Items:</strong></p>
          <ul style="margin:8px 0 0;padding-left:20px;">${orderItemsData.map(oi => `<li>${esc(oi.item_name)} x${oi.quantity} — ${fmtMoney(oi.subtotal)}</li>`).join('')}</ul>
        </div>
        <a href="/canteen-preorder/order" style="padding:10px 24px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">Place Another Order</a>
        <a href="/canteen-preorder/wallet" style="padding:10px 24px;background:#059669;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;margin-left:8px;">View Wallet</a>
      </div>`);

    res.send(renderPage('Order Confirmed', html, req.session.user));
  }));

  // Student order history
  app.get('/canteen-preorder/my-orders', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const userId = req.session.user.id;
    const orders = await pool.query(
      `SELECT o.* FROM canteen_orders o WHERE o.tenant_id=$1 AND o.student_id=$2 ORDER BY o.created_at DESC LIMIT 20`,
      [tid, userId]);

    let html = nav('Pre-Order');
    html += '<h2 style="margin:0 0 16px;color:#111827;">My Orders</h2>';
    if (orders.rows.length) {
      html += '<div style="display:flex;flex-direction:column;gap:12px;">';
      orders.rows.forEach(o => {
        const statusColor = o.status === 'collected' ? '#059669' : o.status === 'ready' ? '#059669' : o.status === 'cancelled' ? '#ef4444' : '#f59e0b';
        html += `<div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;display:flex;justify-content:space-between;align-items:center;">
          <div>
            <strong style="color:#111827;">${esc(o.order_number)}</strong>
            <span style="display:inline-block;margin-left:8px;background:${statusColor}20;color:${statusColor};padding:2px 10px;border-radius:10px;font-size:12px;text-transform:capitalize;">${esc(o.status)}</span>
            <br><small style="color:#6b7280;">${fmtDate(o.order_date)} · Pickup: ${esc(o.pickup_slot)}</small>
          </div>
          <div style="text-align:right;">
            <div style="font-weight:700;color:#059669;font-size:16px;">${fmtMoney(o.total_amount)}</div>
            <small style="color:#6b7280;">${esc(o.payment_method)}</small>
          </div></div>`;
      });
      html += '</div>';
    } else {
      html += cardWrap('No Orders', '<p style="color:#6b7280;">You have not placed any pre-orders yet.</p>');
    }
    res.send(renderPage('My Orders', html, req.session.user));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // FEATURE 4 — Order Dashboard (Kitchen Staff)
  // ═══════════════════════════════════════════════════════════════════════════

  app.get('/canteen-preorder/dashboard', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const dateFilter = req.query.date || new Date().toISOString().split('T')[0];

    const orders = await pool.query(
      `SELECT o.*, (SELECT json_agg(row_to_json(oi.*)) FROM canteen_order_items oi WHERE oi.order_id=o.id) AS items_json
       FROM canteen_orders o WHERE o.tenant_id=$1 AND o.order_date=$2
       ORDER BY o.pickup_slot, o.created_at`, [tid, dateFilter]);

    // Stats
    const statsRes = await pool.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status='pending')::int AS pending,
              COUNT(*) FILTER (WHERE status='confirmed')::int AS confirmed,
              COUNT(*) FILTER (WHERE status='preparing')::int AS preparing,
              COUNT(*) FILTER (WHERE status='ready')::int AS ready,
              COUNT(*) FILTER (WHERE status='collected')::int AS collected,
              COALESCE(SUM(total_amount) FILTER (WHERE payment_status='paid'),0)::numeric AS revenue
       FROM canteen_orders WHERE tenant_id=$1 AND order_date=$2`, [tid, dateFilter]);

    const stats = statsRes.rows[0];

    let html = nav('Order Dashboard');
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">';
    html += '<h2 style="margin:0;color:#111827;">Kitchen Order Dashboard</h2>';
    html += `<form method="GET" action="/canteen-preorder/dashboard" style="display:flex;gap:8px;align-items:center;">
      <label style="font-size:14px;font-weight:600;">Date:</label>
      <input type="date" name="date" value="${esc(dateFilter)}" style="padding:8px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;">
      <button type="submit" style="padding:8px 16px;background:#4f46e5;color:#fff;border:none;border-radius:8px;cursor:pointer;">Go</button>
    </form></div>`;

    html += statCards([
      {label: 'Total Orders', value: stats.total, color: '#4f46e5'},
      {label: 'Confirmed', value: stats.confirmed, color: '#f59e0b'},
      {label: 'Preparing', value: stats.preparing, color: '#d97706'},
      {label: 'Ready', value: stats.ready, color: '#059669'},
      {label: 'Collected', value: stats.collected, color: '#16a34a'},
      {label: 'Revenue', value: fmtMoney(stats.revenue), color: '#059669'},
    ]);

    // Group orders by pickup slot
    const bySlot = {};
    orders.rows.forEach(o => {
      if (!bySlot[o.pickup_slot]) bySlot[o.pickup_slot] = [];
      bySlot[o.pickup_slot].push(o);
    });

    const sortedSlots = Object.keys(bySlot).sort();
    if (sortedSlots.length === 0) {
      html += cardWrap('No Orders', `<p style="color:#6b7280;">No orders for ${esc(dateFilter)}.</p>`);
    } else {
      sortedSlots.forEach(slot => {
        const slotOrders = bySlot[slot];
        html += cardWrap(`Pickup: ${esc(slot)} (${slotOrders.length} orders)`, `
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px;">
          ${slotOrders.map(o => {
            const items = o.items_json || [];
            const itemsList = Array.isArray(items) ? items : (items ? JSON.parse(items) : []);
            const alertBullets = Array.isArray(o.allergen_alert) ? o.allergen_alert : (o.allergen_alert ? JSON.parse(o.allergen_alert) : []);
            const statusColor = o.status === 'collected' ? '#059669' : o.status === 'ready' ? '#059669' : o.status === 'preparing' ? '#d97706' : o.status === 'cancelled' ? '#ef4444' : '#f59e0b';

            return `<div style="border:1px solid #e5e7eb;border-radius:10px;padding:14px;${o.status==='ready'?'background:#f0fdf4;border-color:#86efac;':''}">
              <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px;">
                <div><strong style="color:#111827;">${esc(o.order_number)}</strong><br>
                  <small style="color:#6b7280;">${esc(o.student_name)}</small></div>
                <span style="background:${statusColor}20;color:${statusColor};padding:3px 10px;border-radius:10px;font-size:12px;text-transform:capitalize;font-weight:600;">${esc(o.status)}</span>
              </div>
              ${itemsList.map(it => `<div style="font-size:13px;padding:2px 0;">${esc(it.item_name)} x${it.quantity} <span style="color:#6b7280;">${fmtMoney(it.unit_price)}</span></div>`).join('')}
              ${alertBullets.length ? `<div style="margin-top:6px;background:#fee2e2;padding:6px 10px;border-radius:6px;font-size:12px;color:#991b1b;">
                ⚠ ${alertBullets.map(a=>esc(a.item)+': '+esc(a.allergen)).join('; ')}</div>` : ''}
              <div style="margin-top:8px;display:flex;justify-content:space-between;align-items:center;">
                <strong style="color:#059669;">${fmtMoney(o.total_amount)}</strong>
                <div style="display:flex;gap:4px;">
                  ${o.status === 'confirmed' ? `<form method="POST" action="/canteen-preorder/dashboard/status"><input type="hidden" name="id" value="${o.id}"><input type="hidden" name="status" value="preparing"><button style="padding:4px 10px;background:#d97706;color:#fff;border:none;border-radius:6px;font-size:12px;cursor:pointer;">Start</button></form>` : ''}
                  ${o.status === 'preparing' ? `<form method="POST" action="/canteen-preorder/dashboard/status"><input type="hidden" name="id" value="${o.id}"><input type="hidden" name="status" value="ready"><button style="padding:4px 10px;background:#059669;color:#fff;border:none;border-radius:6px;font-size:12px;cursor:pointer;">Ready</button></form>` : ''}
                  ${o.status === 'ready' ? `<form method="POST" action="/canteen-preorder/dashboard/status"><input type="hidden" name="id" value="${o.id}"><input type="hidden" name="status" value="collected"><button style="padding:4px 10px;background:#16a34a;color:#fff;border:none;border-radius:6px;font-size:12px;cursor:pointer;">Collected</button></form>` : ''}
                  ${o.status !== 'collected' && o.status !== 'cancelled' ? `<form method="POST" action="/canteen-preorder/dashboard/status" onsubmit="return confirm('Cancel this order?')"><input type="hidden" name="id" value="${o.id}"><input type="hidden" name="status" value="cancelled"><button style="padding:4px 10px;background:#ef4444;color:#fff;border:none;border-radius:6px;font-size:12px;cursor:pointer;">Cancel</button></form>` : ''}
                </div></div></div>`;
          }).join('')}
          </div>`);
      });
    }

    res.send(renderPage('Order Dashboard', html, req.session.user));
  }));

  // Update order status
  app.post('/canteen-preorder/dashboard/status', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { id, status } = req.body;
    if (!id || !status || !ORDER_STATUSES.includes(status)) {
      return res.send(alertBox('Invalid request.', 'error'));
    }
    const result = await pool.query(
      'UPDATE canteen_orders SET status=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3',
      [status, id, tid]);
    if (result.rowCount === 0) return res.status(404).send('Order not found.');
    audit('canteen_order_status', {orderId: id, status}, req.session.user);
    res.redirect('/canteen-preorder/dashboard');
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // FEATURE 5 — Dietary Preferences
  // ═══════════════════════════════════════════════════════════════════════════

  app.get('/canteen-preorder/dietary', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const userId = req.session.user.id;

    // Get current preferences
    const prefs = await pool.query(
      'SELECT dietary_restrictions, allergies FROM user_profiles WHERE user_id=$1 AND tenant_id=$2', [userId, tid]);

    const current = prefs.rows[0] || {};
    const restrictions = Array.isArray(current.dietary_restrictions) ? current.dietary_restrictions : (current.dietary_restrictions ? JSON.parse(current.dietary_restrictions) : []);
    const allergies = Array.isArray(current.allergies) ? current.allergies : (current.allergies ? JSON.parse(current.allergies) : []);

    const restrictionOptions = ['vegetarian','vegan','halal','gluten-free','dairy-free','nut-free','low-sodium','low-sugar','kosher','pescatarian'];
    const commonAllergies = ['Milk','Eggs','Fish','Shellfish','Tree Nuts','Peanuts','Wheat','Soy','Sesame','Gluten','Corn'];

    // Get recommended items based on preferences
    let filteredHtml = '';
    if (restrictions.length > 0 || allergies.length > 0) {
      const allItems = await pool.query(
        'SELECT * FROM canteen_menu_items WHERE tenant_id=$1 AND is_available=true ORDER BY category, name', [tid]);
      const safe = [];
      const caution = [];
      allItems.rows.forEach(mi => {
        const itemAllergens = Array.isArray(mi.allergens) ? mi.allergens : (mi.allergens ? JSON.parse(mi.allergens) : []);
        const hasConflict = itemAllergens.some(a => allergies.map(x=>x.toLowerCase()).includes(a.toLowerCase()));
        if (hasConflict) {
          caution.push({ ...mi, _allergens: itemAllergens.filter(a => allergies.map(x=>x.toLowerCase()).includes(a.toLowerCase())) });
        } else {
          safe.push(mi);
        }
      });

      filteredHtml = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:20px;">';
      filteredHtml += cardWrap(`Safe Items (${safe.length})`, safe.length ? `<div style="max-height:300px;overflow-y:auto;">${safe.map(mi =>
        `<div style="padding:6px 0;border-bottom:1px solid #f3f4f6;font-size:13px;">
          <strong style="color:#111827;">${esc(mi.name)}</strong>
          <span style="color:#6b7280;"> - ${CAT_LABELS[mi.category]||mi.category} - ${fmtMoney(mi.price)}</span></div>`).join('')}</div>` : '<p style="color:#6b7280;">No items match your dietary preferences.</p>');
      filteredHtml += cardWrap(`Caution — Contains Allergens (${caution.length})`, caution.length ? `<div style="max-height:300px;overflow-y:auto;">${caution.map(mi =>
        `<div style="padding:6px 0;border-bottom:1px solid #f3f4f6;font-size:13px;">
          <strong style="color:#ef4444;">${esc(mi.name)}</strong>
          <span style="color:#6b7280;"> - ${mi._allergens.join(', ')}</span></div>`).join('')}</div>` : '<p style="color:#059669;">No conflicts found!</p>');
      filteredHtml += '</div>';
    }

    let html = nav('Dietary');
    html += '<h2 style="margin:0 0 16px;color:#111827;">Dietary Preferences</h2>';
    html += alertBox('Set your dietary restrictions and allergies. The system will automatically flag menu items.', 'success');

    html += `<form method="POST" action="/canteen-preorder/dietary/save" style="max-width:600px;">
      <div style="margin-bottom:24px;">
        <label style="display:block;font-weight:600;margin-bottom:10px;font-size:15px;">Dietary Restrictions</label>
        <div style="display:flex;flex-wrap:wrap;gap:10px;">
          ${restrictionOptions.map(r => `<label style="display:flex;align-items:center;gap:6px;padding:8px 14px;border:1px solid ${restrictions.includes(r)?'#4f46e5':'#d1d5db'};border-radius:8px;cursor:pointer;background:${restrictions.includes(r)?'#eef2ff':'#fff'};font-size:14px;">
            <input type="checkbox" name="restrictions" value="${r}" ${restrictions.includes(r)?'checked':''} style="accent-color:#4f46e5;"> ${r.charAt(0).toUpperCase()+r.slice(1)}</label>`).join('')}
        </div></div>
      <div style="margin-bottom:24px;">
        <label style="display:block;font-weight:600;margin-bottom:10px;font-size:15px;">Allergies</label>
        <div style="display:flex;flex-wrap:wrap;gap:10px;">
          ${commonAllergies.map(a => `<label style="display:flex;align-items:center;gap:6px;padding:8px 14px;border:1px solid ${allergies.includes(a)?'#ef4444':'#d1d5db'};border-radius:8px;cursor:pointer;background:${allergies.includes(a)?'#fee2e2':'#fff'};font-size:14px;">
            <input type="checkbox" name="allergies" value="${a}" ${allergies.includes(a)?'checked':''} style="accent-color:#ef4444;"> ${a}</label>`).join('')}
        </div></div>
      <button type="submit" style="padding:10px 24px;background:#4f46e5;color:#fff;border:none;border-radius:8px;font-weight:600;cursor:pointer;">Save Preferences</button>
    </form>`;

    html += filteredHtml;
    res.send(renderPage('Dietary Preferences', html, req.session.user));
  }));

  app.post('/canteen-preorder/dietary/save', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const userId = req.session.user.id;
    const restrictions = Array.isArray(req.body.restrictions) ? req.body.restrictions : (req.body.restrictions ? [req.body.restrictions] : []);
    const allergies = Array.isArray(req.body.allergies) ? req.body.allergies : (req.body.allergies ? [req.body.allergies] : []);

    await pool.query(
      `INSERT INTO user_profiles (tenant_id, user_id, dietary_restrictions, allergies)
       VALUES ($1, $2, $3::jsonb, $4::jsonb)
       ON CONFLICT (tenant_id, user_id) DO UPDATE SET dietary_restrictions=$3::jsonb, allergies=$4::jsonb`,
      [tid, userId, JSON.stringify(restrictions), JSON.stringify(allergies)]);

    audit('canteen_dietary_save', {restrictions, allergies}, req.session.user);
    res.redirect('/canteen-preorder/dietary');
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // FEATURE 6 — Nutrition Dashboard
  // ═══════════════════════════════════════════════════════════════════════════

  app.get('/canteen-preorder/nutrition', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);

    // Average nutritional values from orders this week
    const nutritionData = await pool.query(
      `SELECT mi.nutritional_info, oi.quantity, o.order_date
       FROM canteen_order_items oi
       JOIN canteen_orders o ON o.id=oi.order_id
       JOIN canteen_menu_items mi ON mi.id=oi.menu_item_id
       WHERE oi.tenant_id=$1 AND o.order_date >= $2 AND o.status NOT IN ('cancelled')
       AND mi.nutritional_info IS NOT NULL`,
      [tid, weekAgo.toISOString().split('T')[0]]);

    // Calculate averages
    let totalCalories = 0, totalProtein = 0, totalCarbs = 0, totalFat = 0, totalFiber = 0, mealCount = 0;
    const nutritionMap = {};
    nutritionData.rows.forEach(r => {
      const info = r.nutritional_info ? (typeof r.nutritional_info === 'string' ? JSON.parse(r.nutritional_info) : r.nutritional_info) : {};
      const qty = r.quantity || 1;
      totalCalories += (parseFloat(info.calories) || 0) * qty;
      totalProtein += (parseFloat(info.protein) || 0) * qty;
      totalCarbs += (parseFloat(info.carbs) || 0) * qty;
      totalFat += (parseFloat(info.fat) || 0) * qty;
      totalFiber += (parseFloat(info.fiber) || 0) * qty;
      mealCount += qty;
    });
    const avgCal = mealCount ? Math.round(totalCalories / mealCount) : 0;
    const avgPro = mealCount ? (totalProtein / mealCount).toFixed(1) : 0;
    const avgCarb = mealCount ? (totalCarbs / mealCount).toFixed(1) : 0;
    const avgFat = mealCount ? (totalFat / mealCount).toFixed(1) : 0;
    const avgFib = mealCount ? (totalFiber / mealCount).toFixed(1) : 0;

    // Popular items this week
    const popularRes = await pool.query(
      `SELECT oi.item_name, SUM(oi.quantity)::int AS total_qty, SUM(oi.subtotal)::numeric AS revenue,
              COUNT(DISTINCT o.id)::int AS order_count
       FROM canteen_order_items oi
       JOIN canteen_orders o ON o.id=oi.order_id
       WHERE oi.tenant_id=$1 AND o.order_date >= $2 AND o.status NOT IN ('cancelled')
       GROUP BY oi.item_name ORDER BY total_qty DESC LIMIT 8`,
      [tid, weekAgo.toISOString().split('T')[0]]);
    const popularItems = popularRes.rows;

    // Allergy statistics
    const allergyStats = await pool.query(
      `SELECT allergies FROM user_profiles WHERE tenant_id=$1 AND allergies IS NOT NULL`, [tid]);
    const allergyCounts = {};
    allergyStats.rows.forEach(r => {
      const list = Array.isArray(r.allergies) ? r.allergies : (r.allergies ? JSON.parse(r.allergies) : []);
      list.forEach(a => { allergyCounts[a] = (allergyCounts[a] || 0) + 1; });
    });
    const allergyArr = Object.entries(allergyCounts).sort((a,b) => b[1]-a[1]).slice(0, 8);

    // Menu item allergen stats
    const menuAllergenRes = await pool.query(
      'SELECT allergens FROM canteen_menu_items WHERE tenant_id=$1 AND is_available=true', [tid]);
    const menuAllergenCounts = {};
    menuAllergenRes.rows.forEach(r => {
      const list = Array.isArray(r.allergens) ? r.allergens : (r.allergens ? JSON.parse(r.allergens) : []);
      list.forEach(a => { menuAllergenCounts[a] = (menuAllergenCounts[a] || 0) + 1; });
    });
    const menuAllergenArr = Object.entries(menuAllergenCounts).sort((a,b) => b[1]-a[1]).slice(0, 6);

    // Build SVG bar chart for popular items
    const maxQty = popularItems.length ? Math.max(...popularItems.map(p => p.total_qty)) : 1;
    const chartW = 700, chartH = 280, barW = 60, gap = 20;
    const startX = 80, maxBarH = chartH - 80;
    let barsSvg = '';
    popularItems.forEach((item, i) => {
      const barH = Math.round((item.total_qty / maxQty) * maxBarH);
      const x = startX + i * (barW + gap);
      const y = chartH - 40 - barH;
      const color = COLORS[i % COLORS.length];
      barsSvg += `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" rx="4" fill="${color}" opacity="0.9">
        <title>${esc(item.item_name)}: ${item.total_qty} qty</title></rect>`;
      barsSvg += `<text x="${x + barW/2}" y="${y - 6}" text-anchor="middle" fill="#374151" font-size="12" font-weight="600">${item.total_qty}</text>`;
      barsSvg += `<text x="${x + barW/2}" y="${chartH - 20}" text-anchor="middle" fill="#6b7280" font-size="10" transform="rotate(-30 ${x + barW/2} ${chartH - 20})">${esc(String(item.item_name).substring(0,12))}</text>`;
    });

    const popularChart = `<svg width="100%" viewBox="0 0 ${chartW} ${chartH}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Popular menu items bar chart" style="max-width:700px;margin:0 auto;display:block;">
      <rect width="100%" height="100%" fill="#fafafa" rx="12"/>
      <text x="${chartW/2}" y="24" text-anchor="middle" fill="#111827" font-size="15" font-weight="700">Popular Items This Week</text>
      ${Array.from({length:5}, (_, i) => {
        const yVal = Math.round((maxQty / 4) * i);
        const yPos = chartH - 40 - Math.round((i / 4) * maxBarH);
        return `<line x1="${startX - 4}" y1="${yPos}" x2="${chartW - 20}" y2="${yPos}" stroke="#e5e7eb" stroke-width="1"/>
                <text x="${startX - 8}" y="${yPos + 4}" text-anchor="end" fill="#9ca3af" font-size="10">${yVal}</text>`;
      }).join('')}
      ${barsSvg}
    </svg>`;

    // Build SVG donut chart for allergy stats
    const totalAllergy = allergyArr.reduce((s, [,c]) => s + c, 0) || 1;
    const donutR = 80, donutCx = 120, donutCy = 120, donutStroke = 35;
    let arcs = '';
    let cumAngle = -90;
    allergyArr.forEach(([name, count], i) => {
      const pct = count / totalAllergy;
      const angle = pct * 360;
      const x1 = donutCx + donutR * Math.cos(cumAngle * Math.PI / 180);
      const y1 = donutCy + donutR * Math.sin(cumAngle * Math.PI / 180);
      const x2 = donutCx + donutR * Math.cos((cumAngle + angle) * Math.PI / 180);
      const y2 = donutCy + donutR * Math.sin((cumAngle + angle) * Math.PI / 180);
      const largeArc = angle > 180 ? 1 : 0;
      const color = COLORS[i % COLORS.length];
      arcs += `<path d="M ${x1} ${y1} A ${donutR} ${donutR} 0 ${largeArc} 1 ${x2} ${y2}" fill="none" stroke="${color}" stroke-width="${donutStroke}"/>
               <text x="${280}" y="${40 + i * 22}" fill="#374151" font-size="12"><tspan fill="${color}" font-size="14">●</tspan> ${esc(name)} (${count})</text>`;
      cumAngle += angle;
    });

    const allergyChart = allergyArr.length ? `<svg width="100%" viewBox="0 0 450 240" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Student allergy statistics" style="max-width:450px;display:block;">
      <rect width="100%" height="100%" fill="#fafafa" rx="12"/>
      <text x="225" y="24" text-anchor="middle" fill="#111827" font-size="15" font-weight="700">Student Allergy Distribution</text>
      <circle cx="${donutCx}" cy="${donutCy + 10}" r="${donutR}" fill="none" stroke="#e5e7eb" stroke-width="${donutStroke}"/>
      ${arcs}
    </svg>` : '';

    // Build SVG radar-style chart for weekly nutrition averages
    const nutrients = [
      {label:'Calories', value: avgCal, max: 800, unit:'kcal'},
      {label:'Protein', value: parseFloat(avgPro), max: 50, unit:'g'},
      {label:'Carbs', value: parseFloat(avgCarb), max: 80, unit:'g'},
      {label:'Fat', value: parseFloat(avgFat), max: 40, unit:'g'},
      {label:'Fiber', value: parseFloat(avgFib), max: 15, unit:'g'},
    ];
    const radarCx = 160, radarCy = 140, radarR = 100;
    let radarPaths = '';
    let radarLabels = '';
    let radarGrid = '';
    for (let ring = 1; ring <= 4; ring++) {
      const r = (radarR / 4) * ring;
      const pts = nutrients.map((_, i) => {
        const angle = (i * 360 / nutrients.length - 90) * Math.PI / 180;
        return `${radarCx + r * Math.cos(angle)},${radarCy + r * Math.sin(angle)}`;
      }).join(' ');
      radarGrid += `<polygon points="${pts}" fill="none" stroke="#e5e7eb" stroke-width="1"/>`;
    }
    const radarDataPts = nutrients.map((n, i) => {
      const angle = (i * 360 / nutrients.length - 90) * Math.PI / 180;
      const val = Math.min(n.value / n.max, 1);
      return `${radarCx + radarR * val * Math.cos(angle)},${radarCy + radarR * val * Math.sin(angle)}`;
    }).join(' ');
    nutrients.forEach((n, i) => {
      const angle = (i * 360 / nutrients.length - 90) * Math.PI / 180;
      const lx = radarCx + (radarR + 25) * Math.cos(angle);
      const ly = radarCy + (radarR + 25) * Math.sin(angle);
      radarLabels += `<text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="middle" fill="#374151" font-size="11" font-weight="600">${n.label}</text>
                      <text x="${lx}" y="${ly + 14}" text-anchor="middle" fill="#6b7280" font-size="10">${n.value}${n.unit}</text>`;
    });
    const radarSvg = `<svg width="100%" viewBox="0 0 320 300" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Weekly nutrition radar" style="max-width:320px;display:block;">
      <rect width="100%" height="100%" fill="#fafafa" rx="12"/>
      <text x="160" y="24" text-anchor="middle" fill="#111827" font-size="15" font-weight="700">Avg Nutrition / Meal</text>
      ${radarGrid}
      <polygon points="${radarDataPts}" fill="#4f46e520" stroke="#4f46e5" stroke-width="2"/>
      ${nutrients.map((n, i) => {
        const angle = (i * 360 / nutrients.length - 90) * Math.PI / 180;
        const val = Math.min(n.value / n.max, 1);
        const dx = radarCx + radarR * val * Math.cos(angle);
        const dy = radarCy + radarR * val * Math.sin(angle);
        return `<circle cx="${dx}" cy="${dy}" r="4" fill="#4f46e5"/>`;
      }).join('')}
      ${radarLabels}
    </svg>`;

    // Build SVG horizontal bar chart for menu allergen prevalence
    const maxMenuAllergen = menuAllergenArr.length ? Math.max(...menuAllergenArr.map(([,c]) => c)) : 1;
    let menuAllergenBars = '';
    menuAllergenArr.forEach(([name, count], i) => {
      const barW2 = Math.round((count / maxMenuAllergen) * 300);
      const y = 10 + i * 30;
      const color = COLORS[i % COLORS.length];
      menuAllergenBars += `<text x="90" y="${y + 14}" text-anchor="end" fill="#374151" font-size="12">${esc(name)}</text>
        <rect x="100" y="${y}" width="${barW2}" height="20" rx="4" fill="${color}" opacity="0.85"/>
        <text x="${110 + barW2}" y="${y + 14}" fill="#374151" font-size="11" font-weight="600">${count}</text>`;
    });
    const menuAllergenChart = menuAllergenArr.length ? `<svg width="100%" viewBox="0 0 500 ${40 + menuAllergenArr.length * 30}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Menu allergen prevalence" style="max-width:500px;display:block;">
      <rect width="100%" height="100%" fill="#fafafa" rx="12"/>
      <text x="250" y="24" text-anchor="middle" fill="#111827" font-size="15" font-weight="700">Menu Allergen Prevalence</text>
      ${menuAllergenBars}
    </svg>` : '';

    let html = nav('Nutrition');
    html += '<h2 style="margin:0 0 16px;color:#111827;">Nutrition Dashboard</h2>';
    html += `<p style="color:#6b7280;margin-bottom:20px;">Weekly nutrition overview based on ${mealCount} ordered items.</p>`;

    html += statCards([
      {label: 'Avg Calories/Meal', value: avgCal + ' kcal', color: '#ef4444'},
      {label: 'Avg Protein', value: avgPro + 'g', color: '#4f46e5'},
      {label: 'Avg Carbs', value: avgCarb + 'g', color: '#f59e0b'},
      {label: 'Avg Fat', value: avgFat + 'g', color: '#ec4899'},
      {label: 'Avg Fiber', value: avgFib + 'g', color: '#059669'},
      {label: 'Meals Tracked', value: mealCount, color: '#4f46e5'},
    ]);

    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">';
    html += cardWrap('Popular Items', popularChart);
    html += cardWrap('Nutrition Radar', radarSvg);
    html += cardWrap('Student Allergies', allergyChart || '<p style="color:#6b7280;">No allergy data recorded.</p>');
    html += cardWrap('Menu Allergen Prevalence', menuAllergenChart || '<p style="color:#6b7280;">No allergens found in menu items.</p>');
    html += '</div>';

    // Nutrition detail table
    if (popularItems.length) {
      html += cardWrap('Popular Items Detail', `<table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead><tr style="background:#f9fafb;">
          <th style="padding:10px;text-align:left;border-bottom:2px solid #e5e7eb;">Item</th>
          <th style="padding:10px;text-align:center;border-bottom:2px solid #e5e7eb;">Orders</th>
          <th style="padding:10px;text-align:center;border-bottom:2px solid #e5e7eb;">Qty Sold</th>
          <th style="padding:10px;text-align:right;border-bottom:2px solid #e5e7eb;">Revenue</th>
        </tr></thead><tbody>
        ${popularItems.map(p => `<tr style="border-bottom:1px solid #f3f4f6;">
          <td style="padding:10px;">${esc(p.item_name)}</td>
          <td style="padding:10px;text-align:center;">${p.order_count}</td>
          <td style="padding:10px;text-align:center;font-weight:600;">${p.total_qty}</td>
          <td style="padding:10px;text-align:right;font-weight:600;color:#059669;">${fmtMoney(p.revenue)}</td></tr>`).join('')}
        </tbody></table>`);
    }

    res.send(renderPage('Nutrition Dashboard', html, req.session.user));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // FEATURE 7 — Canteen Wallet
  // ═══════════════════════════════════════════════════════════════════════════

  // Wallet overview and top-up
  app.get('/canteen-preorder/wallet', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const userId = req.session.user.id;
    const userName = req.session.user.name || 'User';

    // Ensure wallet exists
    await pool.query(
      `INSERT INTO canteen_wallet (tenant_id, user_id, user_name, balance)
       VALUES ($1, $2, $3, 0) ON CONFLICT (tenant_id, user_id) DO NOTHING`,
      [tid, userId, userName]);

    const wallet = await pool.query(
      'SELECT * FROM canteen_wallet WHERE tenant_id=$1 AND user_id=$2', [tid, userId]);
    const w = wallet.rows[0];
    const balance = parseFloat(w?.balance || 0);

    // Transaction history from orders
    const transactions = await pool.query(
      `SELECT o.order_number, o.total_amount, o.payment_method, o.payment_status, o.created_at,
              o.status AS order_status
       FROM canteen_orders o
       WHERE o.tenant_id=$1 AND o.student_id=$2 AND o.payment_method='wallet'
       ORDER BY o.created_at DESC LIMIT 20`, [tid, userId]);

    // Top-up history (from audit or orders)
    const topUps = await pool.query(
      `SELECT created_at, balance FROM canteen_wallet
       WHERE tenant_id=$1 AND user_id=$2 ORDER BY updated_at DESC LIMIT 1`, [tid, userId]);

    // Build SVG balance gauge
    const gaugeR = 60, gaugeCx = 70, gaugeCy = 75;
    const maxBalance = 200;
    const pct = Math.min(balance / maxBalance, 1);
    const endAngle = -90 + pct * 360;
    const x2 = gaugeCx + gaugeR * Math.cos(endAngle * Math.PI / 180);
    const y2 = gaugeCy + gaugeR * Math.sin(endAngle * Math.PI / 180);
    const balanceGauge = `<svg width="100%" viewBox="0 0 140 120" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Wallet balance gauge" style="max-width:140px;display:block;">
      <circle cx="${gaugeCx}" cy="${gaugeCy}" r="${gaugeR}" fill="none" stroke="#e5e7eb" stroke-width="12" stroke-dasharray="${Math.PI * gaugeR * 1.5} ${Math.PI * gaugeR * 0.5}" transform="rotate(135 ${gaugeCx} ${gaugeCy})"/>
      <circle cx="${gaugeCx}" cy="${gaugeCy}" r="${gaugeR}" fill="none" stroke="#059669" stroke-width="12" stroke-dasharray="${Math.PI * gaugeR * 1.5 * pct} ${Math.PI * gaugeR * 2}" transform="rotate(135 ${gaugeCx} ${gaugeCy})" stroke-linecap="round"/>
      <text x="${gaugeCx}" y="${gaugeCy - 4}" text-anchor="middle" fill="#111827" font-size="18" font-weight="700">${fmtMoney(balance)}</text>
      <text x="${gaugeCx}" y="${gaugeCy + 14}" text-anchor="middle" fill="#6b7280" font-size="11">Balance</text>
    </svg>`;

    let html = nav('Wallet');
    html += '<h2 style="margin:0 0 16px;color:#111827;">Canteen Wallet</h2>';

    html += '<div style="display:grid;grid-template-columns:auto 1fr;gap:20px;align-items:start;">';
    // Balance card
    html += `<div style="background:linear-gradient(135deg,#059669,#047857);border-radius:16px;padding:28px;color:#fff;text-align:center;min-width:250px;box-shadow:0 4px 12px rgba(5,150,105,0.3);">
      ${balanceGauge}
      <p style="margin:8px 0 0;font-size:13px;opacity:0.9;">${esc(userName)}'s Wallet</p></div>`;

    // Top-up & info
    html += cardWrap('Top Up Wallet', `
      <form method="POST" action="/canteen-preorder/wallet/topup" style="display:flex;gap:10px;align-items:end;flex-wrap:wrap;">
        <div style="flex:1;min-width:200px;">
          <label style="display:block;font-weight:600;margin-bottom:4px;font-size:14px;">Amount ($) *</label>
          <input name="amount" type="number" step="0.01" min="1" max="500" required placeholder="10.00" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;">
        </div>
        <div>
          <label style="display:block;font-weight:600;margin-bottom:4px;font-size:14px;">Method</label>
          <select name="topup_method" style="padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;">
            <option value="card">Card</option>
            <option value="bank_transfer">Bank Transfer</option>
            <option value="mobile_money">Mobile Money</option>
          </select></div>
        <button type="submit" style="padding:10px 28px;background:#059669;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer;font-size:14px;">Top Up</button>
      </form>
      <div style="display:flex;gap:8px;margin-top:14px;">
        ${[5,10,20,50].map(a => `<button type="button" onclick="document.querySelector('input[name=amount]').value='${a}'" style="padding:6px 14px;background:#f3f4f6;color:#374151;border:1px solid #d1d5db;border-radius:6px;cursor:pointer;font-size:13px;">$${a}</button>`).join('')}
      </div>`);

    html += '</div>';

    // Parent top-up URL
    html += cardWrap('Parent / Guardian Top-Up', `
      <p style="color:#6b7280;margin:0 0 10px;font-size:14px;">Share this link with parents to top up your wallet remotely:</p>
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:10px;display:flex;justify-content:space-between;align-items:center;">
        <code style="color:#4f46e5;font-size:13px;word-break:break-all;">${esc(req.protocol + '://' + req.get('host') + '/canteen-preorder/wallet/topup/' + userId)}</code>
        <button onclick="navigator.clipboard.writeText(this.parentElement.querySelector('code').textContent);this.textContent='Copied!';setTimeout(()=>this.textContent='Copy',2000);" style="padding:6px 12px;background:#4f46e5;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;white-space:nowrap;">Copy</button>
      </div>`);

    // Transaction history
    html += cardWrap('Transaction History', (() => {
      if (transactions.rows.length === 0) return '<p style="color:#6b7280;">No transactions yet. Top up your wallet to get started.</p>';
      let t = '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:14px;">';
      t += '<thead><tr style="background:#f9fafb;"><th style="padding:10px;text-align:left;border-bottom:2px solid #e5e7eb;">Date</th>';
      t += '<th style="padding:10px;text-align:left;border-bottom:2px solid #e5e7eb;">Order</th>';
      t += '<th style="padding:10px;text-align:left;border-bottom:2px solid #e5e7eb;">Status</th>';
      t += '<th style="padding:10px;text-align:right;border-bottom:2px solid #e5e7eb;">Amount</th></tr></thead><tbody>';
      transactions.rows.forEach(tr => {
        const isDebit = tr.payment_status === 'paid';
        const statusColor = tr.order_status === 'cancelled' ? '#ef4444' : tr.payment_status === 'paid' ? '#059669' : '#f59e0b';
        t += `<tr style="border-bottom:1px solid #f3f4f6;">
          <td style="padding:10px;color:#6b7280;">${tr.created_at ? new Date(tr.created_at).toLocaleString() : '—'}</td>
          <td style="padding:10px;"><strong style="color:#111827;">${esc(tr.order_number)}</strong></td>
          <td style="padding:10px;"><span style="color:${statusColor};font-size:12px;text-transform:capitalize;">${tr.order_status === 'cancelled' ? 'Refunded' : tr.payment_status}</span></td>
          <td style="padding:10px;text-align:right;font-weight:600;color:${isDebit ? '#ef4444' : '#059669'};">${isDebit ? '-' : '+'}${fmtMoney(tr.total_amount)}</td></tr>`;
      });
      t += '</tbody></table></div>';
      return t;
    })());

    res.send(renderPage('Canteen Wallet', html, req.session.user));
  }));

  // Top-up wallet
  app.post('/canteen-preorder/wallet/topup', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const userId = req.session.user.id;
    const userName = req.session.user.name || 'User';
    const { amount, topup_method } = req.body;
    const topAmount = parseFloat(amount);

    if (!topAmount || topAmount < 1) return res.send(alertBox('Minimum top-up amount is $1.00.', 'error'));
    if (topAmount > 500) return res.send(alertBox('Maximum single top-up is $500.00.', 'error'));

    await pool.query(
      `INSERT INTO canteen_wallet (tenant_id, user_id, user_name, balance)
       VALUES ($1, $2, $3, 0) ON CONFLICT (tenant_id, user_id) DO NOTHING`,
      [tid, userId, userName]);

    await pool.query(
      'UPDATE canteen_wallet SET balance=balance+$1, updated_at=NOW() WHERE tenant_id=$2 AND user_id=$3',
      [topAmount, tid, userId]);

    trackRevenue('canteen_wallet_topup', topAmount, `Wallet top-up by ${userName} via ${topup_method}`, 'wallet-topup-' + uid());
    audit('canteen_wallet_topup', {amount: topAmount, method: topup_method}, req.session.user);

    let html = nav('Wallet');
    html += cardWrap('Top-Up Successful', `
      <div style="text-align:center;padding:20px;">
        <div style="font-size:48px;margin-bottom:12px;">💰</div>
        <h2 style="color:#059669;margin:0 0 8px;">Wallet Top-Up Successful</h2>
        <p style="color:#6b7280;">${fmtMoney(topAmount)} has been added to your wallet via ${esc(topup_method)}.</p>
        <a href="/canteen-preorder/wallet" style="display:inline-block;margin-top:16px;padding:10px 24px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">View Wallet</a>
        <a href="/canteen-preorder/order" style="display:inline-block;margin-top:16px;margin-left:8px;padding:10px 24px;background:#059669;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">Order Now</a>
      </div>`);
    res.send(renderPage('Top-Up Success', html, req.session.user));
  }));

  // Parent/guardian top-up page (public-ish but requires login)
  app.get('/canteen-preorder/wallet/topup/:userId', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const targetUserId = parseInt(req.params.userId);

    const targetUser = await pool.query(
      'SELECT user_name, balance FROM canteen_wallet WHERE tenant_id=$1 AND user_id=$2', [tid, targetUserId]);

    if (!targetUser.rows.length) return res.status(404).send('Wallet not found for this user.');
    const target = targetUser.rows[0];

    let html = nav('Wallet');
    html += cardWrap('Top-Up for ' + esc(target.user_name), `
      <p style="color:#6b7280;margin-bottom:16px;">Current balance: <strong style="color:#059669;">${fmtMoney(target.balance)}</strong></p>
      <form method="POST" action="/canteen-preorder/wallet/topup-other" style="display:flex;gap:10px;align-items:end;flex-wrap:wrap;">
        <input type="hidden" name="target_user_id" value="${targetUserId}">
        <div><label style="display:block;font-weight:600;margin-bottom:4px;font-size:14px;">Amount ($) *</label>
          <input name="amount" type="number" step="0.01" min="1" max="500" required style="width:150px;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;"></div>
        <button type="submit" style="padding:10px 28px;background:#059669;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer;">Top Up</button>
      </form>`);
    res.send(renderPage('Top-Up for Student', html, req.session.user));
  }));

  app.post('/canteen-preorder/wallet/topup-other', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const targetUserId = parseInt(req.body.target_user_id);
    const amount = parseFloat(req.body.amount);
    if (!amount || amount < 1 || amount > 500) return res.send(alertBox('Invalid amount. Must be between $1 and $500.', 'error'));

    await pool.query(
      'UPDATE canteen_wallet SET balance=balance+$1, updated_at=NOW() WHERE tenant_id=$2 AND user_id=$3',
      [amount, tid, targetUserId]);

    trackRevenue('canteen_wallet_topup', amount, `Parent top-up for user ${targetUserId} by ${req.session.user.name}`, 'wallet-topup-' + uid());
    audit('canteen_wallet_parent_topup', {targetUserId, amount}, req.session.user);
    res.send(alertBox('Top-up successful! ' + fmtMoney(amount) + ' added.', 'success') +
      '<a href="/canteen-preorder/wallet" style="display:inline-block;margin-top:12px;padding:8px 20px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:8px;">Back to Wallet</a>');
  }));

  // ── API Endpoints (for AJAX) ──────────────────────────────────────────────

  // Today's menu (for display)
  app.get('/canteen-preorder/api/today-menu', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const today = getToday();
    const items = await pool.query(
      `SELECT mi.* FROM canteen_weekly_menu wm
       JOIN canteen_menu_items mi ON mi.id=wm.menu_item_id
       WHERE wm.tenant_id=$1 AND wm.day_of_week=$2 AND wm.is_active=true AND mi.is_available=true
       ORDER BY wm.category, wm.sort_order`, [tid, today]);
    res.json({day: today, items: items.rows.map(r => ({
      id: r.id, name: r.name, description: r.description, category: r.category,
      price: parseFloat(r.price), is_vegan: r.is_vegan, is_halal: r.is_halal,
      allergens: Array.isArray(r.allergens) ? r.allergens : (r.allergens ? JSON.parse(r.allergens) : []),
      nutritional_info: r.nutritional_info ? (typeof r.nutritional_info === 'string' ? JSON.parse(r.nutritional_info) : r.nutritional_info) : {},
    }))});
  }));

  // Wallet balance API
  app.get('/canteen-preorder/api/balance', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const userId = req.session.user.id;
    const wallet = await pool.query(
      'SELECT balance FROM canteen_wallet WHERE tenant_id=$1 AND user_id=$2', [tid, userId]);
    res.json({balance: parseFloat(wallet.rows[0]?.balance || 0)});
  }));

  // Order count API
  app.get('/canteen-preorder/api/stats', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const today = new Date().toISOString().split('T')[0];
    const stats = await pool.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status='pending')::int AS pending,
              COUNT(*) FILTER (WHERE status='confirmed')::int AS confirmed,
              COUNT(*) FILTER (WHERE status='preparing')::int AS preparing,
              COUNT(*) FILTER (WHERE status='ready')::int AS ready,
              COALESCE(SUM(total_amount) FILTER (WHERE payment_status='paid'),0)::numeric AS revenue
       FROM canteen_orders WHERE tenant_id=$1 AND order_date=$2`, [tid, today]);
    res.json(stats.rows[0] || {});
  }));

};
